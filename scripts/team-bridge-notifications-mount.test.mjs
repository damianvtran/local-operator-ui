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
const toastFixturePath = join(scratch, "toast-fixture.mjs");
writeFileSync(
	toastFixturePath,
	"export const toasts = []; export const showInfoToast = (message) => { toasts.push(message); }; export const showErrorToast = () => {}; export const showSuccessToast = () => {};",
);
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
			export { toasts } from "@shared/utils/toast-manager";
			export { useTeamBridgeNotificationOpen } from "./src/renderer/src/features/team-bridge/use-team-bridge-notification-open";
			export { beginRadientAuthoritySignOut, beginRadientAuthorityTransition, settleRadientAuthority } from "./src/renderer/src/shared/hooks/radient-account-authority";
			export { teamBridgeKeys, notifyMutationOptions } from "./src/renderer/src/features/team-bridge/use-team-bridge";
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
		"@shared/utils/toast-manager": toastFixturePath,
		"@shared/api/local-operator/team-bridge-api": apiFixturePath,
		"@features/agent-hub/hooks/use-memberships-query": membershipsFixturePath,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
});
writeFileSync(mountPath, bundled.outputFiles[0].text);

const api = await import(pathToFileURL(mountPath.pathname).href);
const { fixture } = api;

after(() => {
	try {
		unlinkSync(mountPath);
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

const mount = async () => {
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
	api.toasts.length = 0;
	const notifications = [];
	const authorities = [];
	const routes = [];
	let pendingOpen = null;
	let openListener;
	let routeEnabled = true;
	const navigate = (path) => routes.push(path);
	dom.window.api = {
		desktop: {
			teamBridge: {
				setAuthority: async (authority) => {
					authorities.push(authority);
				},
				notify: async (request) => {
					notifications.push(request);
					return { shown: true };
				},
				onOpen: (listener) => {
					openListener = listener;
					return () => {
						openListener = undefined;
					};
				},
				pendingOpen: async () => {
					const result = pendingOpen;
					pendingOpen = null;
					return result;
				},
			},
		},
	};
	const { createRoot } = await import("react-dom/client");
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 1_000 } },
	});
	// This policy fixture seeds an already-validated account in the REAL auth
	// cache. Auth commissioning/transitions are exercised separately by the
	// production-singleton team-bridge-auth-owner-mount lane, not claimed here.
	client.setQueryData(["radient-user", "user"], {
		account: { id: fixture.identity },
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
	const Probe = () => {
		api.useTeamBridgeNotifications(enabled);
		api.useTeamBridgeNotificationOpen(routeEnabled, navigate);
		return null;
	};
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
		authorities,
		routes,
		emitOpen: (target) => {
			pendingOpen = target;
			openListener?.();
		},
		setRouteEnabled: async (value) => {
			routeEnabled = value;
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

/**
 * Deferred real transport edges reproduce R1-2 through the mounted hook.
 *
 * The history arm keeps the pending-change race matrix; the reply path's
 * enrichment and owner screening have their own matrix after it.
 */
for (const pending of ["history", "directory"]) {
	for (const disable of ["setting", "capability", "mute", "none"]) {
		test(`history: a ${disable} change while ${pending} is pending is rechecked before IPC`, async () => {
			resetFixture();
			const org = {
				tenant_id: "tnt_race",
				tenant_name: "Race Org",
				unread: 0,
				eligible: true,
			};
			fixture.account = { total: 0, organizations: [org] };
			fixture.conversations = {
				conversations: [conversation("bcv_race", "tnt_race")],
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
					conversations: [{ ...notifyRow("bcv_race", 1), unread_count: 1 }],
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
				assert.deepEqual(fixture.calls.history[0], {
					id: "bcv_race",
					tenantId: "tnt_race",
					limit: 1,
				});
				assert.equal(fixture.calls.replies.length, 0);
				if (disable === "setting") {
					await act(async () =>
						mounted.client.setQueryData(["desktop", "settings"], {
							settings: [{ key: "display.notifications", value: false }],
						}),
					);
					await settle();
				} else if (disable === "capability") {
					await mounted.setEnabled(false);
				} else if (disable === "mute") {
					// Exercise the production mutation/cache write while enrichment is
					// gated, not a duplicate notification-policy decision in this test.
					api.TeamBridgeApi.setNotify = async () => ({ notify: "mute" });
					fixture.conversations.conversations[0] = {
						...fixture.conversations.conversations[0],
						notify: "mute",
						muted: true,
					};
					await act(async () => {
						const mutation = mounted.client
							.getMutationCache()
							.build(mounted.client, api.notifyMutationOptions(mounted.client));
						await mutation.execute({
							conversationId: "bcv_race",
							tenantId: "tnt_race",
							notify: "mute",
						});
					});
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
					assert.equal(mounted.notifications[0].body, "fixture message");
					assert.equal(mounted.notifications[0].tenantId, "tnt_race");
					assert.equal(mounted.notifications[0].seq, 1);
					assert.equal(mounted.notifications[0].threadId, undefined);
					assert.equal(
						api.teamBridgeOpenPath(mounted.notifications[0]),
						"/team-bridge?tenant=tnt_race&conversation=bcv_race",
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
				assert.equal(mounted.notifications.length, disable === "none" ? 1 : 0);
			} finally {
				release();
				await mounted.teardown();
			}
		});
	}
}

/*
 * REPLY ENRICHMENT, RESTORED WITH THE THREADS SURFACE. A reply banner reads its
 * preview from the thread (`listReplies`), with the delivery's own account as
 * the REQUIRED owner receipt (`expectedAccountId`), so a runtime signed in as
 * someone else refuses it. No fallback may reuse a different reply's body or
 * treat unvalidated cross-scope data as a sender; a refused or failed read
 * (`owner-refused`, `read-failed`) still raises the metadata-only banner.
 */
for (const scenario of [
	"known",
	"self",
	"wrong-root",
	"wrong-conversation",
	"wrong-reply-root",
	"later-seq",
	"read-failed",
	"owner-refused",
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
		if (scenario === "owner-refused")
			fixture.thread = Object.assign(new Error("account_mismatch"), {
				code: "account_mismatch",
			});
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
					expectedAccountId: "acct_alice",
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

const clickTarget = (owner = { accountId: "acct_alice", epoch: 0 }) => ({
	owner,
	conversationId: "bcv_click",
	tenantId: "tnt_click",
});

const switchAccount = async (mounted, accountId) => {
	await act(async () => {
		api.beginRadientAuthorityTransition(mounted.client);
		const pending = mounted.authorities.at(-1);
		assert.equal(
			pending.accountId,
			undefined,
			"native authority revoked synchronously before React commits",
		);
		api.settleRadientAuthority(mounted.client, pending.epoch, accountId);
		mounted.client.setQueryData(
			["radient-user", "user"],
			accountId ? { account: { id: accountId } } : null,
		);
	});
};

for (const account of ["acct_bob", undefined]) {
	test(`a native click pulled under A is dropped after ${account ?? "logout"}`, async () => {
		resetFixture();
		const mounted = await mount();
		try {
			let release;
			const pending = new Promise((resolve) => {
				release = resolve;
			});
			mounted.emitOpen(pending);
			await switchAccount(mounted, account);
			await act(async () => release(clickTarget()));
			await settle();
			assert.deepEqual(mounted.routes, []);
		} finally {
			await mounted.teardown();
		}
	});
}

test("capability-delayed click is discarded on owner change, while matching owner routes once", async () => {
	resetFixture();
	const mounted = await mount();
	try {
		await act(async () => mounted.emitOpen(clickTarget()));
		await settle();
		assert.deepEqual(mounted.routes, [
			"/team-bridge?tenant=tnt_click&conversation=bcv_click",
		]);
		await mounted.setRouteEnabled(false);
		await act(async () => mounted.emitOpen(clickTarget()));
		await switchAccount(mounted, "acct_bob");
		await mounted.setRouteEnabled(true);
		await settle();
		assert.equal(mounted.routes.length, 1);
		await act(async () =>
			mounted.emitOpen({ conversationId: "bcv_legacy", tenantId: "tnt_click" }),
		);
		await settle();
		assert.equal(mounted.routes.length, 1, "legacy missing owner never routes");
	} finally {
		await mounted.teardown();
	}
});

for (const outcome of ["failed", "successful", "none"]) {
	test(`R1 ${outcome} optimistic mute settles after enrichment`, async () => {
		resetFixture();
		const org = {
			tenant_id: "tnt_race",
			tenant_name: "Race Org",
			unread: 0,
			eligible: true,
		};
		fixture.account = { total: 0, organizations: [org] };
		fixture.conversations = {
			conversations: [conversation("bcv_race", "tnt_race")],
		};
		fixture.messages = {
			messages: [
				{
					id: "bcmsg_root",
					seq: 1,
					sender: {
						account_id: "acct_bob",
						kind: "human",
						display_label: "Bob",
					},
					body: "message",
					conversation_id: "bcv_race",
				},
			],
		};
		let release;
		fixture.historyGate = new Promise((resolve) => {
			release = resolve;
		});
		const mounted = await mount();
		try {
			await until(
				() =>
					fixture.calls.conversations > 0 &&
					fixture.calls.unread.includes("account"),
				"seed",
			);
			await settle();
			fixture.account = { total: 1, organizations: [{ ...org, unread: 1 }] };
			fixture.tenants.tnt_race = {
				total: 1,
				conversations: [notifyRow("bcv_race", 1)],
			};
			await act(async () =>
				mounted.client.invalidateQueries({
					queryKey: api.teamBridgeKeys.unreadPrefix,
				}),
			);
			await until(() => fixture.calls.history.length === 1, "history pending");
			let finishMute;
			let mutationResult;
			if (outcome !== "none") {
				api.TeamBridgeApi.setNotify = () =>
					new Promise((resolve, reject) => {
						finishMute = () =>
							outcome === "failed"
								? reject(new Error("mute refused"))
								: resolve({ notify: "mute" });
					});
				await act(async () => {
					const mutation = mounted.client
						.getMutationCache()
						.build(mounted.client, api.notifyMutationOptions(mounted.client));
					mutationResult = mutation
						.execute({
							conversationId: "bcv_race",
							tenantId: "tnt_race",
							notify: "mute",
						})
						.catch((e) => e);
				});
				await until(() => Boolean(finishMute), "mute pending");
			}
			await act(async () => release());
			await settle();
			if (outcome !== "none")
				assert.equal(
					mounted.notifications.length,
					0,
					"pending policy must not emit before settlement",
				);
			if (outcome !== "none") {
				if (outcome === "successful")
					fixture.conversations.conversations[0] = {
						...fixture.conversations.conversations[0],
						notify: "mute",
						muted: true,
					};
				await act(async () => {
					finishMute();
					await mutationResult;
				});
				await settle();
			}
			await act(async () =>
				mounted.client.invalidateQueries({
					queryKey: api.teamBridgeKeys.unreadPrefix,
				}),
			);
			await settle();
			const policies = mounted.client
				.getQueriesData({ queryKey: api.teamBridgeKeys.conversationsPrefix })
				.flatMap(([key, data]) =>
					(data?.conversations ?? [])
						.filter((row) => row.id === "bcv_race")
						.map((row) => ({ key, notify: row.notify, muted: row.muted })),
				);

			assert.ok(
				policies.length > 0,
				"observe actual owner-qualified conversation policy",
			);
			assert.ok(
				policies.every(
					(row) => row.notify === (outcome === "successful" ? "mute" : "all"),
				),
				"failed mute rolled back to successful all policy",
			);

			assert.equal(
				mounted.notifications.length,
				outcome === "successful" ? 0 : 1,
				"failed optimistic mute must not permanently consume candidate",
			);
			await act(async () =>
				mounted.client.invalidateQueries({
					queryKey: api.teamBridgeKeys.unreadPrefix,
				}),
			);
			await settle();
			assert.equal(
				mounted.notifications.length,
				outcome === "successful" ? 0 : 1,
				"reconciliation must neither replay muted seqs nor duplicate a delivered seq",
			);
		} finally {
			await mounted.teardown();
		}
	});
}

for (const { outcome, disable, firstSeed = false } of [
	{ outcome: "failed", disable: null },
	{ outcome: "successful", disable: null },
	{ outcome: "failed", disable: "setting" },
	{ outcome: "successful", disable: "setting" },
	{ outcome: "none", disable: "setting" },
	{ outcome: "failed", disable: "capability" },
	{ outcome: "successful", disable: "capability" },
	{ outcome: "none", disable: "capability" },
	{ outcome: "failed", disable: "setting", firstSeed: true },
	{ outcome: "none", disable: "setting", firstSeed: true },
]) {
	test(`${disable ? "R3" : "R1"} ${outcome} mute begins before new unread is discovered${disable ? `; ${disable} off-on${firstSeed ? "; first seed" : ""}` : ""}`, async () => {
		resetFixture();
		const org = {
			tenant_id: "tnt_race",
			tenant_name: "Race Org",
			unread: 0,
			eligible: true,
		};
		fixture.account = { total: 0, organizations: firstSeed ? [] : [org] };
		fixture.conversations = {
			conversations: [conversation("bcv_race", "tnt_race")],
		};
		fixture.messages = {
			messages: [
				{
					id: "bcmsg_root",
					seq: 1,
					sender: {
						account_id: "acct_bob",
						kind: "human",
						display_label: "Bob",
					},
					body: "message",
					conversation_id: "bcv_race",
				},
			],
		};
		let release;
		fixture.historyGate = new Promise((resolve) => {
			release = resolve;
		});
		const mounted = await mount();
		try {
			await until(
				() =>
					fixture.calls.conversations > 0 &&
					fixture.calls.unread.includes("account"),
				"seed",
			);
			await settle();
			let finishMute;
			let mutationResult;
			if (outcome !== "none") {
				api.TeamBridgeApi.setNotify = () =>
					new Promise((resolve, reject) => {
						finishMute = () =>
							outcome === "failed"
								? reject(new Error("mute refused"))
								: resolve({ notify: "mute" });
					});
				await act(async () => {
					const mutation = mounted.client
						.getMutationCache()
						.build(mounted.client, api.notifyMutationOptions(mounted.client));
					mutationResult = mutation
						.execute({
							conversationId: "bcv_race",
							tenantId: "tnt_race",
							notify: "mute",
						})
						.catch((e) => e);
				});
				await until(() => Boolean(finishMute), "mute pending");
			}
			fixture.account = { total: 1, organizations: [{ ...org, unread: 1 }] };
			fixture.tenants.tnt_race = {
				total: 1,
				conversations: [notifyRow("bcv_race", 1)],
			};
			await act(async () =>
				mounted.client.invalidateQueries({
					queryKey: api.teamBridgeKeys.unreadPrefix,
				}),
			);
			await settle();
			if (outcome !== "none" || firstSeed) {
				assert.equal(
					fixture.calls.history.length,
					0,
					"pending policy or first observation must not start enrichment",
				);
			} else {
				await until(
					() => fixture.calls.history.length === 1,
					"no-mute control is already planned",
				);
			}
			if (disable) {
				// Neither unread nor conversation data changes here. Both edges
				// must reach the planner despite its same-answer admission key.
				if (disable === "setting") {
					await act(async () =>
						mounted.client.setQueryData(["desktop", "settings"], {
							settings: [{ key: "display.notifications", value: false }],
						}),
					);
				} else await mounted.setEnabled(false);
				await settle();
				assert.equal(
					mounted.notifications.length,
					0,
					"disable consumes silently",
				);
				if (disable === "setting") {
					await act(async () =>
						mounted.client.setQueryData(["desktop", "settings"], {
							settings: [{ key: "display.notifications", value: true }],
						}),
					);
				} else await mounted.setEnabled(true);
				await settle();
			}
			await act(async () => release());
			await settle();
			if (outcome !== "none")
				assert.equal(
					mounted.notifications.length,
					0,
					"pending policy must not emit before settlement",
				);
			if (outcome !== "none") {
				if (outcome === "successful")
					fixture.conversations.conversations[0] = {
						...fixture.conversations.conversations[0],
						notify: "mute",
						muted: true,
					};
				await act(async () => {
					finishMute();
					await mutationResult;
				});
				await settle();
			}
			await act(async () =>
				mounted.client.invalidateQueries({
					queryKey: api.teamBridgeKeys.unreadPrefix,
				}),
			);
			await settle();
			const policies = mounted.client
				.getQueriesData({ queryKey: api.teamBridgeKeys.conversationsPrefix })
				.flatMap(([key, data]) =>
					(data?.conversations ?? [])
						.filter((row) => row.id === "bcv_race")
						.map((row) => ({ key, notify: row.notify, muted: row.muted })),
				);

			assert.ok(
				policies.length > 0,
				"observe actual owner-qualified conversation policy",
			);
			assert.ok(
				policies.every(
					(row) => row.notify === (outcome === "successful" ? "mute" : "all"),
				),
				"failed mute rolled back to successful all policy",
			);

			assert.equal(
				mounted.notifications.length,
				disable || firstSeed || outcome === "successful" ? 0 : 1,
				"disabled/first-observation rows stay consumed; otherwise failed mute resumes once",
			);
			await act(async () =>
				mounted.client.invalidateQueries({
					queryKey: api.teamBridgeKeys.unreadPrefix,
				}),
			);
			await settle();
			assert.equal(
				mounted.notifications.length,
				disable || firstSeed || outcome === "successful" ? 0 : 1,
				"reconciliation must neither replay muted seqs nor duplicate a delivered seq",
			);
		} finally {
			await mounted.teardown();
		}
	});
}

for (const next of ["acct_alice", "acct_bob", undefined]) {
	test(`D2 D3 click waits through credential refresh and answers ${next ?? "sign-out"}`, async () => {
		resetFixture();
		const mounted = await mount();
		try {
			await act(async () =>
				api.beginRadientAuthorityTransition(mounted.client),
			);
			const epoch = mounted.authorities.at(-1).epoch;
			await act(async () => mounted.emitOpen(clickTarget()));
			await settle();
			assert.deepEqual(mounted.routes, []);
			assert.deepEqual(
				api.toasts,
				[],
				"settling is not stale and must remain quiet",
			);
			await act(async () => {
				api.settleRadientAuthority(mounted.client, epoch, next);
				mounted.client.setQueryData(
					["radient-user", "user"],
					next ? { account: { id: next } } : null,
				);
			});
			await settle();
			assert.equal(mounted.routes.length, next === "acct_alice" ? 1 : 0);
			assert.deepEqual(
				api.toasts,
				next === "acct_alice"
					? []
					: ["That notification is no longer available on this account."],
			);
		} finally {
			await mounted.teardown();
		}
	});
}

test("D1 replacement document routes same-account click despite former epoch", async () => {
	resetFixture();
	const mounted = await mount();
	try {
		await act(async () =>
			mounted.emitOpen(clickTarget({ accountId: "acct_alice", epoch: 47 })),
		);
		await settle();
		assert.equal(mounted.routes.length, 1);
		assert.deepEqual(api.toasts, []);
	} finally {
		await mounted.teardown();
	}
});

test("D3 stale result shows neutral toast without routing private IDs", async () => {
	resetFixture();
	const mounted = await mount();
	try {
		await act(async () => mounted.emitOpen({ unavailable: true }));
		await settle();
		assert.deepEqual(mounted.routes, []);
		assert.deepEqual(api.toasts, [
			"That notification is no longer available on this account.",
		]);
	} finally {
		await mounted.teardown();
	}
});

test("D2 authority settlement before query commit remains held, not signed out", async () => {
	resetFixture();
	const mounted = await mount();
	try {
		await act(async () => {
			api.beginRadientAuthorityTransition(mounted.client);
			const epoch = mounted.authorities.at(-1).epoch;
			mounted.client.removeQueries({
				queryKey: ["radient-user", "user"],
				exact: true,
			});
			api.settleRadientAuthority(mounted.client, epoch, "acct_alice");
			assert.equal(
				mounted.authorities.at(-1).settling,
				true,
				"account result has not reached QueryClient yet",
			);
			mounted.client.setQueryData(["radient-user", "user"], {
				account: { id: "acct_alice" },
			});
			assert.equal(mounted.authorities.at(-1).settling, false);
		});
	} finally {
		await mounted.teardown();
	}
});

/*
 * Code review round 2 m2. A DELIBERATE sign-out must withdraw on the press, not
 * wait for a follow-up account read that may fail: the press is a known absence,
 * not an unresolved refresh. This is the publish the notifier sees.
 */
test("m2 a deliberate sign-out publishes settled absence, not a refresh hold", async () => {
	resetFixture();
	const mounted = await mount();
	try {
		await act(async () => api.beginRadientAuthoritySignOut(mounted.client));
		const published = mounted.authorities.at(-1);
		assert.equal(published.settling, false, "no hold to wait out");
		assert.equal(published.accountId, undefined);
	} finally {
		await mounted.teardown();
	}
});
