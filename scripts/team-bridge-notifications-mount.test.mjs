/**
 * The Team Bridge notification hook, MOUNTED — not its helper functions.
 *
 * WHY THIS SUITE EXISTS. The N9 blocker was not a model bug: the model was
 * right, and every model test passed while the shipped hook read an answer
 * with no conversation rows and produced zero candidates. This suite mounts
 * the REAL `useTeamBridgeNotifications` in jsdom, against the REAL React Query
 * cache, and observes the tenant fan-out, the bound, the ordering, the
 * per-organization seeding and the tenant tag each row carries to the banner.
 *
 * WHAT IS STUBBED, AND ONLY THIS: the transport (`TeamBridgeApi`), the
 * membership query, and the preload's `notify`. Those are the hook's edges.
 * The hook itself, its query keys, its `useQueries` fan-out and its planning
 * effect are the shipped modules.
 */
import assert from "node:assert/strict";
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const scratch = mkdtempSync(join(tmpdir(), "team-bridge-notify-mount-"));
const apiFixturePath = join(scratch, "team-bridge-api-fixture.mjs");
const membershipsFixturePath = join(scratch, "memberships-fixture.mjs");
const mountPath = new URL(
	`./_team-bridge-notifications-mount-${process.pid}.mjs`,
	import.meta.url,
);

/*
 * The transport fixture: every payload the hook can receive, mutable between
 * polls. `calls` is the observable the assertions read; `listGate` lets a test
 * hold the conversation list unresolved while the unread answers move.
 */
writeFileSync(
	apiFixturePath,
	`
export const fixture = {
	identity: "acct_alice",
	account: { total: 0, organizations: [] },
 accountGate: null,
 accountError: false,
	tenants: {},
	conversations: { conversations: [] },
	listGate: null,
	historyGate: null,
	repliesGate: null,
	directoryGate: null,
	messages: { messages: [] },
	thread: { root: null, replies: [] },
	directoryMembers: [],
	calls: { identity: 0, conversations: 0, unread: [], history: [], replies: [], directory: [] },
	releaseList: null,
};

const tenantOf = (scope) =>
	typeof scope === "string" ? scope : scope.tenantId;

export const TeamBridgeApi = {
	async listMessages(id, options) {
		fixture.calls.history.push({ id, ...options });
		if (fixture.historyGate) await fixture.historyGate;
		return fixture.messages;
	},
	async listReplies(id, rootId, options) {
		fixture.calls.replies.push({ id, rootId, ...options });
		if (fixture.repliesGate) await fixture.repliesGate;
		if (fixture.thread instanceof Error) throw fixture.thread;
		return fixture.thread;
	},
	async directory(tenantId) {
		fixture.calls.directory.push(tenantId);
		if (fixture.directoryGate) await fixture.directoryGate;
		return { members: fixture.directoryMembers };
	},
	async status() {
 fixture.calls.identity += 1;
 return {account_id: fixture.identity, state: "ready", local: {enabled: true}, read_only: false};
 },
	async listConversations() {
		fixture.calls.conversations += 1;
		if (fixture.listGate) await fixture.listGate;
		return fixture.conversations;
	},
	async unread(scope) {
		const tenant = tenantOf(scope);
		fixture.calls.unread.push(tenant);
		if (tenant === "account") return fixture.account;
		return fixture.tenants[tenant] ?? { total: 0, conversations: [] };
	},
};
`,
);

writeFileSync(
	membershipsFixturePath,
	`
export function useMembershipsQuery() {
	return { data: { memberships: [] } };
}
`,
);

const bundled = await build({
	stdin: {
		contents: `
			export { useTeamBridgeNotifications } from "./src/renderer/src/features/team-bridge/use-team-bridge-notifications"; export { teamBridgeOpenPath } from "./src/shared/team-bridge-notify";
			export { teamBridgeKeys } from "./src/renderer/src/features/team-bridge/use-team-bridge";
			export { fixture, TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	write: false,
	alias: {
		"@shared/api/local-operator/team-bridge-api": apiFixturePath,
		"@features/agent-hub/hooks/use-memberships-query": membershipsFixturePath,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
});
writeFileSync(mountPath, bundled.outputFiles[0].text);

const api = await import(pathToFileURL(mountPath.pathname).href);
const { fixture } = api;

// The nav regression uses the production API parser and controlled preload,
// not the notification policy fixture's API replacement. Share React/Query
// instances with the actual mounted provider, and retain normal cleanup.
const navMountPath = new URL(
	`./_team-bridge-nav-mount-${process.pid}.mjs`,
	import.meta.url,
);
const navBundle = await build({
	stdin: {
		contents:
			'export { useTeamBridgeNavItem } from "./src/renderer/src/features/team-bridge/team-bridge-nav";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	write: false,
	tsconfig: "tsconfig.app.json",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
});
writeFileSync(navMountPath, navBundle.outputFiles[0].text);
const navApi = await import(navMountPath.href);

after(() => {
	try {
		unlinkSync(mountPath);
		unlinkSync(navMountPath);
	} catch {
		/* already gone */
	}
});

const member = (label, kind, state, accountId = `acct_${label}`) => ({
	account_id: accountId,
	kind,
	display_label: label,
	role: "member",
	state,
});

const conversation = (id, tenantId) => ({
	id,
	tenant_id: tenantId,
	kind: "group",
	name: `Conversation ${id}`,
	latest_seq: 1,
	members: [
		member("Alice", "human", "active", "acct_alice"),
		member("Bob", "human", "active", "acct_bob"),
	],
	member: true,
	notify: "all",
	muted: false,
	last_read_seq: 0,
	unread_count: 0,
});

const notifyRow = (conversationId, latestSeq) => ({
	conversation_id: conversationId,
	unread_count: latestSeq,
	last_read_seq: 0,
	latest_seq: latestSeq,
	muted: false,
});

const mount = async ({ nav = false } = {}) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
	};
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const notifications = [];
	dom.window.api = {
		desktop: {
			teamBridge: {
				notify: async (request) => {
					notifications.push(request);
					return { shown: true };
				},
				onOpen: () => () => undefined,
				pendingOpen: async () => null,
			},
		},
	};
	if (nav)
		dom.window.api.desktop.request = async (request) => {
			if (request.op === "team_bridge.status")
				return {
					status: 200,
					body: {
						result: {
							capability: 1,
							state: "ready",
							account_id: fixture.identity,
							tenant_id: "tnt_nav",
							surface_state: "D",
							visibility: {
								settings: true,
								inbox: true,
								account_door: true,
								onboarding: false,
							},
							update_required: false,
							local: { enabled: true, onboarding: "done", session: "present" },
							status: null,
							consent: null,
							error: null,
						},
					},
				};
			assert.equal(
				request.op,
				"team_bridge.unread",
				"only actual nav reads reach this preload",
			);
			assert.equal(
				request.scope,
				"account",
				"nav preserves the existing account aggregate",
			);
			fixture.calls.unread.push(request.scope);
			const answer = fixture.account;
			const refused = fixture.accountError;
			if (fixture.accountGate) await fixture.accountGate;
			return refused
				? { status: 503, body: { detail: "Controlled nav read refusal" } }
				: { status: 200, body: { result: answer } };
		};
	const { createRoot } = await import("react-dom/client");
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 1_000 } },
	});
	// Seed actual shared queries, not a replacement policy hook. App settings
	// writes update this same cache while history/directory can be pending.
	client.setQueryDefaults(["desktop", "capabilities"], {
		staleTime: Number.POSITIVE_INFINITY,
	});
	client.setQueryData(["desktop", "capabilities"], {
		desktop_available: true,
		features: { settings: 1 },
	});
	client.setQueryData(["desktop", "settings"], {
		settings: [{ key: "display.notifications", value: true }],
	});
	let enabled = true;
	const frames = [];
	const NotificationProbe = () => {
		api.useTeamBridgeNotifications(enabled);
		return null;
	};
	// Mount the shipped sidebar hook and its real query hooks. Only the API
	// boundary above is a fixture; neither the descriptor nor badge is reimplemented.
	const NavProbe = () => {
		const item = navApi.useTeamBridgeNavItem(enabled);
		return React.createElement(
			React.Profiler,
			{
				id: "real-nav-owner",
				onRender: () =>
					frames.push({
						account: client.getQueryData(api.teamBridgeKeys.status)?.account_id,
						attention: item?.attention ?? null,
					}),
			},
			React.createElement(
				"output",
				{ "data-nav-attention": item?.attention },
				item ? String(item.attention) : "hidden",
			),
		);
	};
	const Probe = nav ? NavProbe : NotificationProbe;
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(Probe),
			),
		);
	});
	return {
		client,
		notifications,
		frames,
		attention: () => dom.window.document.querySelector("output")?.textContent,
		async observeOwner(accountId) {
			fixture.identity = accountId;
			await act(async () =>
				client.setQueryData(api.teamBridgeKeys.status, {
					account_id: accountId,
					state: "ready",
					local: { enabled: true },
					read_only: false,
				}),
			);
		},
		setEnabled: async (value) => {
			enabled = value;
			await act(async () =>
				root.render(
					React.createElement(
						QueryClientProvider,
						{ client },
						React.createElement(Probe),
					),
				),
			);
		},
		teardown: async () => {
			await act(async () => root.unmount());
			client.clear();
			dom.window.close();
			globalThis.window = previous.window;
			globalThis.document = previous.document;
			globalThis.IS_REACT_ACT_ENVIRONMENT = false;
		},
	};
};

const until = async (predicate, label) => {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		if (predicate()) return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
	}
	assert.fail(`timed out waiting for ${label}`);
};

/**
 * One UI-scheduler beat, for effects React Query notified between assertions.
 * The 30 s poll never fires here, so every wait is bounded by the test.
 */
const settle = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});

const resetFixture = () => {
	fixture.identity = "acct_alice";
	fixture.account = { total: 0, organizations: [] };
	fixture.accountGate = null;
	fixture.accountError = false;
	fixture.tenants = {};
	fixture.conversations = { conversations: [] };
	fixture.listGate = null;
	fixture.historyGate = null;
	fixture.repliesGate = null;
	fixture.directoryGate = null;
	fixture.messages = { messages: [] };
	fixture.thread = { root: null, replies: [] };
	fixture.directoryMembers = [];
	fixture.releaseList = null;
	fixture.calls = {
		identity: 0,
		conversations: 0,
		unread: [],
		history: [],
		replies: [],
		directory: [],
	};
};

test("the mounted hook bounds the fan-out, orders by unread, filters eligibility, seeds per org and tags each row", async () => {
	resetFixture();
	/*
	 * NINE loud orgs plus a tie for the last slot. `tnt_a` and `tnt_b` both
	 * report five; the lexicographically smaller tenant must win the tenth slot.
	 * The ineligible org has the largest count and must not be read at all.
	 */
	const eligible = [
		/* Sorts below the top ten; a server-order slice would wrongly read it. */
		{ tenant_id: "tnt_low", tenant_name: "Low Org", unread: 1, eligible: true },
		...Array.from({ length: 9 }, (_, index) => ({
			tenant_id: `tnt_0${index + 1}`,
			tenant_name: `Org ${index + 1}`,
			unread: 10,
			eligible: true,
		})),
		{ tenant_id: "tnt_b", tenant_name: "Org B", unread: 5, eligible: true },
		{ tenant_id: "tnt_a", tenant_name: "Org A", unread: 5, eligible: true },
	];
	fixture.account = {
		total: 200,
		organizations: [
			...eligible,
			{
				tenant_id: "tnt_ineligible",
				tenant_name: "Ineligible Org",
				unread: 100,
				eligible: false,
			},
		],
	};
	fixture.tenants = Object.fromEntries(
		eligible.map((organization) => [
			organization.tenant_id,
			{
				total: 1,
				conversations: [notifyRow(`bcv_${organization.tenant_id}`, 1)],
			},
		]),
	);
	fixture.conversations = {
		conversations: eligible.map((organization) =>
			conversation(`bcv_${organization.tenant_id}`, organization.tenant_id),
		),
	};

	const mounted = await mount();
	try {
		await until(
			() =>
				fixture.calls.unread.filter((tenant) => tenant !== "account").length ===
				10,
			"ten tenant reads",
		);
		const readTenants = fixture.calls.unread.filter(
			(tenant) => tenant !== "account",
		);
		assert.equal(new Set(readTenants).size, 10, "the fan-out is bounded to 10");
		const expected = [
			"tnt_01",
			"tnt_02",
			"tnt_03",
			"tnt_04",
			"tnt_05",
			"tnt_06",
			"tnt_07",
			"tnt_08",
			"tnt_09",
			"tnt_a",
		];
		assert.deepEqual(
			[...new Set(readTenants)].sort(),
			[...expected].sort(),
			"loudest orgs first, the tenant-id tie-break fills the last slot, ineligible org not read",
		);
		assert.equal(
			fixture.calls.unread.includes("tnt_ineligible"),
			false,
			"an ineligible org is never read",
		);
		assert.equal(
			fixture.calls.unread.includes("tnt_low"),
			false,
			"a low-count org below the bound is not read",
		);
		assert.equal(
			mounted.notifications.length,
			0,
			"the first answered read seeds every organization without a banner",
		);
		await until(() => {
			const queries = mounted.client
				.getQueryCache()
				.findAll({ queryKey: api.teamBridgeKeys.unreadPrefix });
			return (
				queries.length === 11 &&
				queries.every((query) => query.state.status === "success")
			);
		}, "every seeded organization to answer before the second poll");
		await settle();

		fixture.conversations = {
			conversations: fixture.conversations.conversations.map((row) =>
				row.id === "bcv_tnt_01" || row.id === "bcv_tnt_a"
					? { ...row, latest_seq: 2 }
					: row,
			),
		};
		fixture.tenants.tnt_01.total = 2;
		fixture.tenants.tnt_01.conversations = [notifyRow("bcv_tnt_01", 2)];
		fixture.tenants.tnt_a.total = 2;
		fixture.tenants.tnt_a.conversations = [notifyRow("bcv_tnt_a", 2)];
		fixture.account.total = 202;
		fixture.account.organizations = fixture.account.organizations.map(
			(organization) =>
				organization.tenant_id === "tnt_01" ||
				organization.tenant_id === "tnt_a"
					? { ...organization, unread: 11 }
					: organization,
		);

		await act(async () => {
			await mounted.client.refetchQueries({
				queryKey: api.teamBridgeKeys.unreadPrefix,
			});
		});
		assert.equal(
			mounted.notifications.length,
			0,
			"unread seq2 must wait for a matching summary snapshot, not link a stale root",
		);
		await act(async () => {
			await mounted.client.refetchQueries({
				queryKey: api.teamBridgeKeys.conversationsPrefix,
			});
		});
		await until(
			() => mounted.notifications.length === 2,
			"one banner for each changed organization",
		);

		const byTenant = new Map(
			mounted.notifications.map((notification) => [
				notification.tenantId,
				notification,
			]),
		);
		assert.deepEqual(
			[...byTenant.keys()].sort(),
			["tnt_01", "tnt_a"],
			"each row is tagged with the organization it was read in",
		);
		assert.equal(byTenant.get("tnt_01").conversationId, "bcv_tnt_01");
		assert.equal(byTenant.get("tnt_a").conversationId, "bcv_tnt_a");
		assert.equal(byTenant.get("tnt_01").seq, 2);
		assert.equal(byTenant.get("tnt_a").seq, 2);
	} finally {
		await mounted.teardown();
	}
});

test("a zero-total org's first message before the conversation list resolves still banners", async () => {
	resetFixture();
	fixture.account = {
		total: 0,
		organizations: [
			{
				tenant_id: "tnt_zero",
				tenant_name: "Zero Org",
				unread: 0,
				eligible: true,
			},
		],
	};
	fixture.tenants.tnt_zero = { total: 0, conversations: [] };
	fixture.conversations = {
		conversations: [conversation("bcv_zero", "tnt_zero")],
	};
	/*
	 * The list read is held open across the first message: this is the race the
	 * old seed loop lost by sitting below the list guard.
	 */
	fixture.listGate = new Promise((resolve) => {
		fixture.releaseList = resolve;
	});

	const mounted = await mount();
	try {
		await until(
			() => fixture.calls.unread.includes("account"),
			"the first account answer",
		);
		assert.equal(
			fixture.calls.unread.includes("tnt_zero"),
			false,
			"a zero-total org is not read",
		);
		assert.equal(mounted.notifications.length, 0);
		// The seed from the account answer alone must have landed before the race.
		await settle();

		/* The message arrives while the conversation list is still unresolved. */
		fixture.account = {
			total: 1,
			organizations: [
				{
					tenant_id: "tnt_zero",
					tenant_name: "Zero Org",
					unread: 1,
					eligible: true,
				},
			],
		};
		fixture.tenants.tnt_zero = {
			total: 1,
			conversations: [notifyRow("bcv_zero", 1)],
		};
		await act(async () => {
			await mounted.client.refetchQueries({
				queryKey: api.teamBridgeKeys.unreadPrefix,
			});
		});
		await until(
			() => fixture.calls.unread.includes("tnt_zero"),
			"the org's first tenant read",
		);
		await settle();
		assert.equal(
			mounted.notifications.length,
			0,
			"no banner without conversation metadata",
		);

		fixture.releaseList();
		await act(async () => {
			await mounted.client.refetchQueries({
				queryKey: api.teamBridgeKeys.conversationsPrefix,
			});
		});
		await until(
			() => mounted.notifications.length === 1,
			"the banner after the list resolves",
		);
		assert.equal(mounted.notifications[0].conversationId, "bcv_zero");
		assert.equal(mounted.notifications[0].tenantId, "tnt_zero");
		assert.equal(mounted.notifications[0].seq, 1);
	} finally {
		await mounted.teardown();
	}
});

/** Deferred real transport edges reproduce R1-2 through the mounted hook. */
for (const transport of ["history", "replies"]) {
	for (const pending of [transport, "directory"]) {
		for (const disable of ["setting", "capability", "none"]) {
			test(`${transport}: a ${disable} change while ${pending} is pending is rechecked before IPC`, async () => {
				resetFixture();
				const org = {
					tenant_id: "tnt_race",
					tenant_name: "Race Org",
					unread: 0,
					eligible: true,
				};
				fixture.account = { total: 0, organizations: [org] };
				fixture.conversations = {
					conversations: [
						{
							...conversation("bcv_race", "tnt_race"),
							// A new reply is newer than its root-only history row. The
							// summary placeholder must yield to the tenant directory.
							...(transport === "replies"
								? {
										last_thread_root_id: "bcmsg_root",
										latest_seq: 2,
										last_sender_label: "Member",
									}
								: {}),
						},
					],
				};
				fixture.messages = {
					messages: [
						{
							id: "bcmsg_root",
							seq: 1,
							sender: {
								account_id: "acct_bob",
								kind: "human",
								display_label: "Bob\n<admin>\u202e\u0085",
							},
							body: "fixture **message**",
							conversation_id: "bcv_race",
						},
					],
				};
				fixture.thread = {
					root: fixture.messages.messages[0],
					replies: [
						{
							...fixture.messages.messages[0],
							id: "bcmsg_reply",
							seq: 2,
							thread_root_id: "bcmsg_root",
							sender: {
								account_id: "acct_bob",
								kind: "human",
								display_label: "Member",
							},
							body: "reply **preview**",
						},
					],
				};
				fixture.directoryMembers = [
					{
						account_id: "acct_bob",
						display_label: "Directory Bob",
						email: "bob@example.test",
					},
				];
				let release;
				fixture[`${pending}Gate`] = new Promise((resolve) => {
					release = resolve;
				});
				const mounted = await mount();
				try {
					await until(
						() =>
							fixture.calls.conversations > 0 &&
							fixture.calls.unread.includes("account"),
						"seed reads",
					);
					await settle();
					fixture.account = {
						total: 1,
						organizations: [{ ...org, unread: 1 }],
					};
					fixture.tenants.tnt_race = {
						total: 1,
						conversations: [
							{
								...notifyRow("bcv_race", transport === "replies" ? 2 : 1),
								unread_count: 1,
								last_read_seq: transport === "replies" ? 1 : 0,
							},
						],
					};
					await act(async () =>
						mounted.client.invalidateQueries({
							queryKey: api.teamBridgeKeys.unreadPrefix,
						}),
					);
					await until(
						() => fixture.calls[pending].length === 1,
						`pending ${pending} read`,
					);
					assert.equal(mounted.notifications.length, 0);
					assert.deepEqual(fixture.calls[transport][0], {
						id: "bcv_race",
						tenantId: "tnt_race",
						limit: 1,
						...(transport === "replies"
							? { rootId: "bcmsg_root", afterSeq: 2 }
							: {}),
					});
					assert.equal(
						fixture.calls[transport === "replies" ? "history" : "replies"]
							.length,
						0,
					);
					if (disable === "setting") {
						await act(async () =>
							mounted.client.setQueryData(["desktop", "settings"], {
								settings: [{ key: "display.notifications", value: false }],
							}),
						);
						await settle();
					} else if (disable === "capability") {
						await mounted.setEnabled(false);
					}
					await act(async () => release());
					await settle();
					assert.equal(
						mounted.notifications.length,
						disable === "none" ? 1 : 0,
						"only the enabled negative control may reach IPC",
					);
					if (disable === "none") {
						assert.deepEqual(fixture.calls.directory, ["tnt_race"]);
						assert.equal(mounted.notifications[0].title, "Directory Bob");
						assert.equal(
							mounted.notifications[0].body,
							transport === "replies" ? "reply preview" : "fixture message",
						);
						assert.equal(mounted.notifications[0].tenantId, "tnt_race");
						assert.equal(
							mounted.notifications[0].seq,
							transport === "replies" ? 2 : 1,
						);
						assert.equal(
							mounted.notifications[0].threadId,
							transport === "replies" ? "bcmsg_root" : undefined,
						);
						assert.equal(
							api.teamBridgeOpenPath(mounted.notifications[0]),
							`/team-bridge?tenant=tnt_race&conversation=bcv_race${transport === "replies" ? "&thread=bcmsg_root" : ""}`,
						);
					}
					// Cursors consume silenced seqs; re-enabling must not replay them.
					await mounted.setEnabled(true);
					await act(async () =>
						mounted.client.setQueryData(["desktop", "settings"], {
							settings: [{ key: "display.notifications", value: true }],
						}),
					);
					await act(async () =>
						mounted.client.invalidateQueries({
							queryKey: api.teamBridgeKeys.unreadPrefix,
						}),
					);
					await settle();
					assert.equal(
						mounted.notifications.length,
						disable === "none" ? 1 : 0,
					);
				} finally {
					release();
					await mounted.teardown();
				}
			});
		}
	}
}

// No fallback may reuse a different reply's body or treat unvalidated cross-scope
// data as a sender. A real failed read still raises the metadata-only banner.
for (const scenario of [
	"known",
	"self",
	"wrong-root",
	"wrong-conversation",
	"wrong-reply-root",
	"later-seq",
	"read-failed",
]) {
	test(`reply enrichment screens ${scenario} without leaking a preview`, async () => {
		resetFixture();
		const root = {
			id: "bcmsg_root",
			conversation_id: "bcv_reply",
			seq: 1,
			sender: {
				account_id: "acct_bob",
				kind: "human",
				display_label: "Root sender",
			},
			body: "Root-only history",
		};
		fixture.messages = { messages: [root] };
		fixture.thread = {
			root: { ...root },
			replies: [
				{
					...root,
					id: "bcmsg_reply",
					seq: 2,
					thread_root_id: root.id,
					body: "Private reply **preview**",
				},
			],
		};
		const reply = fixture.thread.replies[0];
		if (scenario === "self")
			reply.sender = { ...reply.sender, account_id: "acct_alice" };
		if (scenario === "wrong-root") fixture.thread.root.id = "bcmsg_foreign";
		if (scenario === "wrong-conversation")
			reply.conversation_id = "bcv_foreign";
		if (scenario === "wrong-reply-root") reply.thread_root_id = "bcmsg_foreign";
		if (scenario === "later-seq") reply.seq = 3;
		if (scenario === "read-failed")
			fixture.thread = new Error("reply endpoint unavailable");
		const org = {
			tenant_id: "tnt_reply",
			tenant_name: "Reply Org",
			unread: 0,
			eligible: true,
		};
		fixture.account = { total: 0, organizations: [org] };
		fixture.conversations = {
			conversations: [
				{
					...conversation("bcv_reply", "tnt_reply"),
					latest_seq: 2,
					last_thread_root_id: root.id,
					last_sender_label: "Member",
				},
			],
		};
		fixture.directoryMembers = [
			{
				account_id: "acct_bob",
				display_label: "Directory Bob",
				email: "bob@example.test",
			},
		];
		const mounted = await mount();
		try {
			await until(
				() =>
					fixture.calls.conversations > 0 &&
					fixture.calls.unread.includes("account"),
				"seed reads",
			);
			await settle();
			fixture.account = { total: 1, organizations: [{ ...org, unread: 1 }] };
			fixture.tenants.tnt_reply = {
				total: 1,
				conversations: [
					{ ...notifyRow("bcv_reply", 2), unread_count: 1, last_read_seq: 1 },
				],
			};
			await act(async () =>
				mounted.client.invalidateQueries({
					queryKey: api.teamBridgeKeys.unreadPrefix,
				}),
			);
			if (scenario === "known") {
				await until(
					() => mounted.notifications.length === 1,
					"enriched reply banner",
				);
				// Assert the visible symptom before transport bookkeeping, so the old
				// root-only reader reproduces the lost name/preview directly.
				assert.equal(mounted.notifications[0].title, "Directory Bob");
				assert.equal(mounted.notifications[0].body, "Private reply preview");
			}
			await until(
				() => fixture.calls.replies.length === 1,
				"one bounded reply read",
			);
			await settle();
			assert.deepEqual(fixture.calls.replies, [
				{
					id: "bcv_reply",
					rootId: "bcmsg_root",
					tenantId: "tnt_reply",
					afterSeq: 2,
					limit: 1,
				},
			]);
			assert.equal(fixture.calls.history.length, 0);
			assert.equal(
				fixture.calls.directory.length,
				scenario === "known" ? 1 : 0,
			);
			assert.equal(mounted.notifications.length, scenario === "self" ? 0 : 1);
			if (scenario !== "self") {
				const banner = mounted.notifications[0];
				if (scenario !== "known") {
					assert.equal(banner.title, "Conversation bcv_reply");
					assert.doesNotMatch(banner.body, /Private reply|Root-only history/);
				}
				assert.equal(banner.seq, 2);
				assert.equal(banner.tenantId, "tnt_reply");
				assert.equal(banner.threadId, "bcmsg_root");
			}
		} finally {
			await mounted.teardown();
		}
	});
}

// SEC-R2-1: d5 omitted accountId at the actual sidebar caller. A helper-only
// unread test missed it: the fail-closed reader refused before the API boundary.
test("real sidebar nav dispatches one owned aggregate and shows its unread total", async () => {
	resetFixture();
	fixture.account = { total: 7, organizations: [] };
	const mounted = await mount({ nav: true });
	try {
		await until(() => mounted.attention() === "7", "actual nav badge seven");
		assert.deepEqual(fixture.calls.unread, ["account"]);
		assert.equal(
			mounted.client.getQueryData(
				api.teamBridgeKeys.unread("all", "acct_alice"),
			).total,
			7,
		);
		assert.equal(
			mounted.client.getQueryData(api.teamBridgeKeys.unread("all")),
			undefined,
		);
		await mounted.setEnabled(false);
		assert.equal(mounted.attention(), "hidden");
		assert.deepEqual(fixture.calls.unread, ["account"]);
	} finally {
		await mounted.teardown();
	}
});

test("real nav switches away from a warm A badge and never falls back to unowned data", async () => {
	resetFixture();
	fixture.account = { total: 7, organizations: [] };
	const mounted = await mount({ nav: true });
	let release;
	try {
		await until(() => mounted.attention() === "7", "A badge seven");
		fixture.account = { total: 2, organizations: [] };
		fixture.accountGate = new Promise((resolve) => {
			release = resolve;
		});
		await mounted.observeOwner("acct_bob");
		await until(
			() => fixture.calls.unread.length === 2,
			"B owned aggregate dispatch",
		);
		assert.equal(mounted.attention(), "0");
		assert.ok(
			mounted.frames
				.filter((frame) => frame.account === "acct_bob")
				.every((frame) => frame.attention !== 7),
		);
		await act(async () => release());
		await until(() => mounted.attention() === "2", "B badge two");
		await mounted.observeOwner(null);
		await act(async () =>
			mounted.client.setQueryData(api.teamBridgeKeys.unread("all"), {
				total: 999,
				organizations: [],
			}),
		);
		await settle();
		assert.equal(mounted.attention(), "0");
		assert.equal(fixture.calls.unread.length, 2);
		assert.ok(
			mounted.frames
				.filter((frame) => frame.account == null)
				.every((frame) => frame.attention === 0),
		);
	} finally {
		release?.();
		await mounted.teardown();
	}
});

test("real nav rejects A's late aggregate after B owns the sidebar", async () => {
	resetFixture();
	fixture.account = { total: 7, organizations: [] };
	let release;
	fixture.accountGate = new Promise((resolve) => {
		release = resolve;
	});
	const mounted = await mount({ nav: true });
	try {
		await until(
			() => fixture.calls.unread.length === 1,
			"held A aggregate dispatch",
		);
		fixture.account = { total: 2, organizations: [] };
		fixture.accountGate = null;
		await mounted.observeOwner("acct_bob");
		await until(() => mounted.attention() === "2", "B aggregate admitted");
		await act(async () => release());
		await until(
			() =>
				mounted.client.getQueryState(
					api.teamBridgeKeys.unread("all", "acct_alice"),
				)?.fetchStatus === "idle",
			"old A read settled/refused",
		);
		assert.equal(mounted.attention(), "2");
		assert.equal(
			mounted.client.getQueryData(
				api.teamBridgeKeys.unread("all", "acct_alice"),
			),
			undefined,
		);
		assert.equal(fixture.calls.unread.length, 2);
		assert.ok(
			mounted.frames
				.filter((frame) => frame.account === "acct_bob")
				.every((frame) => frame.attention !== 7),
		);
	} finally {
		release?.();
		await mounted.teardown();
	}
});

test("real nav keeps a refused B aggregate empty until B's own read succeeds", async () => {
	resetFixture();
	fixture.account = { total: 7, organizations: [] };
	const mounted = await mount({ nav: true });
	try {
		await until(() => mounted.attention() === "7", "admitted A count");
		fixture.account = { total: 2, organizations: [] };
		fixture.accountError = true;
		await mounted.observeOwner("acct_bob");
		const key = api.teamBridgeKeys.unread("all", "acct_bob");
		await until(
			() => mounted.client.getQueryState(key)?.status === "error",
			"B read refused including its normal retry",
		);
		assert.equal(mounted.attention(), "0");
		assert.ok(
			mounted.frames
				.filter((frame) => frame.account === "acct_bob")
				.every((frame) => frame.attention !== 7),
		);
		fixture.accountError = false;
		await act(async () => mounted.client.invalidateQueries({ queryKey: key }));
		await until(
			() => mounted.attention() === "2",
			"B count from admitted B response",
		);
	} finally {
		fixture.accountError = false;
		await mounted.teardown();
	}
});
