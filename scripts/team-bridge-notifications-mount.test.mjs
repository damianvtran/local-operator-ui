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
	// The bundle also links the rail's profile-card edge, which imports the rest
	// of the toast manager: stub the whole surface so the graph links (the suite
	// asserts what the watcher toasts, not these helpers).
	"export const toasts = []; export const showInfoToast = (message) => { toasts.push(message); }; export const showErrorToast = (message) => { toasts.push(message); }; export const showSuccessToast = () => {}; export const showWarningToast = () => {}; export const dismissToast = () => {};",
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

export const requireBridgeWriteAccount = (accountId) => {
	if (!accountId) throw new Error("Team Bridge write account required");
	return accountId;
};
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
	async markRead(id, options) {
		fixture.calls.markRead = [...(fixture.calls.markRead ?? []), { id, ...options }];
		if (fixture.markReadGate) await fixture.markReadGate;
		return { conversation_id: id, last_read_seq: options.seq, unread_count: 0, muted: false };
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
			export { teamBridgeKeys, notifyMutationOptions, useMarkTeamBridgeRead, useTeamBridgeConversations, useTeamBridgeStatus } from "./src/renderer/src/features/team-bridge/use-team-bridge";
			export { AttentionBadge } from "@shared/components/ui/attention-badge";
			export { cancelTeamBridgeUnreadReads, teamBridgeUnreadView, useTeamBridgeUnreadView, withSharedUnread } from "./src/renderer/src/features/team-bridge/team-bridge-unread-sync";
			export { useTeamBridgeNavItem } from "./src/renderer/src/features/team-bridge/team-bridge-nav";
			export { unreadRegister } from "./src/renderer/src/features/team-bridge/team-bridge-model";
			export { fixture, TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
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

const mount = async ({ Extra = null } = {}) => {
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
	/* What the cache held at the instant each notify IPC was made. */
	const cacheAtNotify = [];
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
					cacheAtNotify.push(
						client.getQueryData(
							api.teamBridgeKeys.messages(
								request.conversationId,
								request.tenantId,
								request.owner.accountId,
							),
						),
					);
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
		return Extra ? React.createElement(Extra) : null;
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
		cacheAtNotify,
		host: dom.window.document.getElementById("root"),
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
	fixture.markReadGate = null;
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
 * The history arm below keeps the race matrix; the guarded reply preview has
 * its own receipt-bearing test after it.
 */
// Directory is now a synchronous cache join, not a network edge. Keep the
// live-policy race matrix on history and prove no directory read below.
for (const pending of ["history"]) {
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
			mounted.client.setQueryData(
				api.teamBridgeKeys.directory("tnt_race", fixture.identity),
				{ members: fixture.directoryMembers },
			);
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
				// The timeline's own read (no `limit`): the banner's one history read
				// lands in the cache entry the page renders from.
				assert.deepEqual(fixture.calls.history[0], {
					id: "bcv_race",
					tenantId: "tnt_race",
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
					assert.deepEqual(fixture.calls.directory, []);
					assert.equal(
						mounted.notifications[0].sender.display_name,
						"Directory Bob",
					);
					assert.equal(mounted.notifications[0].title, "Directory Bob");
					assert.equal(mounted.notifications[0].body, "fixture message");
					assert.equal(mounted.notifications[0].tenantId, "tnt_race");
					assert.equal(mounted.notifications[0].seq, 1);
					assert.equal(mounted.notifications[0].threadId, undefined);
					assert.equal(mounted.notifications[0].messageId, "bcmsg_root");
					assert.equal(
						api.teamBridgeOpenPath(mounted.notifications[0]),
						"/team-bridge?tenant=tnt_race&conversation=bcv_race&message=bcmsg_root",
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
 * THE BANNER'S STATUS FENCE COMPARES AUTHORITY, NOT IDENTITY (fix/owner-audit-fence).
 *
 * The delivery predicate used to compare the cached status OBJECT captured at
 * planning time against the one in cache after the preview read. The status
 * query refetches on window focus, and the runtime's answer moves `checked_at` /
 * `fetched_at` on every check, so structural sharing never keeps the reference:
 * a refetch landing while a preview read was out dropped that banner silently.
 * It now shares `captureBridgeStatusAuthority` with the owner-read fence. Both
 * directions: a content-only refetch still banners; a genuine change does not.
 */
for (const [change, expectation] of [
	["a content-only", "still banners"],
	["a genuine authority", "drops the banner"],
]) {
	test(`${change} status refetch while the preview read is pending ${expectation}`, async () => {
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
					fixture.calls.unread.includes("account") &&
					mounted.client.getQueryData(
						api.teamBridgeKeys.statusFor(fixture.identity),
					) !== undefined,
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
			const key = api.teamBridgeKeys.statusFor(fixture.identity);
			const before = mounted.client.getQueryData(key);
			await act(async () => {
				await mounted.client.fetchQuery({
					queryKey: key,
					queryFn: async () => ({
						...before,
						checked_at: "2026-10-30T09:01:07.412Z",
						fetched_at: "2026-10-30T09:01:07.412Z",
						...(change === "a genuine authority"
							? { local: { enabled: false } }
							: {}),
					}),
					staleTime: 0,
				});
			});
			assert.notEqual(
				mounted.client.getQueryData(key),
				before,
				"the refetch must install a new status object, or nothing was exercised",
			);
			await act(async () => release());
			await settle();
			assert.equal(
				mounted.notifications.length,
				change === "a content-only" ? 1 : 0,
			);
		} finally {
			release();
			await mounted.teardown();
		}
	});
}

/*
 * A reply preview is a real thread read in the shipped build. Its query must
 * carry the observed account and candidate tenant, and the click retains the
 * same thread target rather than degrading to the conversation timeline.
 */
test("a reply candidate reads its guarded thread with the observed account and opens the reply", async () => {
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
		await until(
			() => mounted.notifications.length === 1,
			"the metadata banner",
		);
		await until(() => fixture.calls.replies.length === 1, "the thread read");
		await settle();
		assert.deepEqual(fixture.calls.replies, [
			{
				id: "bcv_reply",
				rootId: "bcmsg_root",
				tenantId: "tnt_reply",
				accountId: "acct_alice",
				afterSeq: 2,
				limit: 1,
			},
		]);
		assert.deepEqual(fixture.calls.history, []);
		const banner = mounted.notifications[0];
		assert.equal(banner.threadId, "bcmsg_root");
		assert.equal(banner.seq, 2);
		assert.equal(banner.tenantId, "tnt_reply");
		assert.match(banner.body, /Private reply preview/);
		assert.equal(
			api.teamBridgeOpenPath(banner),
			"/team-bridge?tenant=tnt_reply&conversation=bcv_reply&thread=bcmsg_root",
		);
	} finally {
		await mounted.teardown();
	}
});

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

/*
 * NOTIFY / CLICK / BADGE SYNC (operator report 2026-10-30). The banner's
 * message must already be in the cache a click renders from; a conversation
 * visited earlier must not paint a stale page; and the nav badge, the rows
 * and the org counts are one set of numbers.
 */
const message = (id, conversationId, seq, extra = {}) => ({
	id,
	conversation_id: conversationId,
	seq,
	sender: { account_id: "acct_bob", kind: "human", display_label: "Bob" },
	body: `body ${id}`,
	created_at: "2026-10-30T12:00:00Z",
	...extra,
});

/** Seed one org at zero, then let a first message arrive in `conversationId`. */
const arrive = async (mounted, org, rows) => {
	fixture.account = {
		total: rows.reduce(
			(sum, row) => sum + (row.muted ? 0 : row.unread_count),
			0,
		),
		organizations: [{ ...org, unread: rows.length ? 1 : 0 }],
	};
	fixture.tenants[org.tenant_id] = { total: 1, conversations: rows };
	await act(async () =>
		mounted.client.invalidateQueries({
			queryKey: api.teamBridgeKeys.unreadPrefix,
		}),
	);
};

test("write before notify: IPC fires only once the timeline cache holds the message, and names it", async () => {
	resetFixture();
	const org = {
		tenant_id: "tnt_w",
		tenant_name: "W",
		unread: 0,
		eligible: true,
	};
	fixture.account = { total: 0, organizations: [org] };
	// The list already names seq 2: the planner pairs list and unread rows on it.
	fixture.conversations = {
		conversations: [{ ...conversation("bcv_w", "tnt_w"), latest_seq: 2 }],
	};
	const stale = message("bcmsg_old", "bcv_w", 1);
	const fresh = message("bcmsg_new", "bcv_w", 2, { client_ref: "cref_new" });
	fixture.messages = { messages: [fresh, stale] };
	let release;
	fixture.historyGate = new Promise((resolve) => {
		release = resolve;
	});
	const mounted = await mount();
	// The reader visited this conversation earlier: a stale page is cached. It
	// carries a membership event line (#1539) the banner's fresh read omits.
	const key = api.teamBridgeKeys.messages("bcv_w", "tnt_w", "acct_alice");
	const joined = {
		id: "bcev_seen",
		event_seq: 1,
		kind: "joined",
		actor: { kind: "human", account_id: "acct_bob", display_label: "Bob" },
		targets: [],
		after_seq: 1,
		at: "2026-10-30T14:02:11.123Z",
	};
	mounted.client.setQueryData(key, { messages: [stale], events: [joined] });
	try {
		await until(
			() =>
				fixture.calls.conversations > 0 &&
				fixture.calls.unread.includes("account"),
			"seed reads",
		);
		await settle();
		await arrive(mounted, org, [
			{ ...notifyRow("bcv_w", 2), unread_count: 1, last_read_seq: 1 },
		]);
		await until(() => fixture.calls.history.length >= 1, "banner history read");
		await settle();
		assert.equal(
			mounted.notifications.length,
			0,
			"no IPC while the read is pending",
		);
		await act(async () => release());
		await until(() => mounted.notifications.length === 1, "the banner");
		const page = mounted.cacheAtNotify[0];
		assert.ok(
			page?.messages.some((row) => row.id === "bcmsg_new"),
			"the cache the page renders from held the message when IPC was made",
		);
		assert.equal(
			page.messages.find((row) => row.id === "bcmsg_new").client_ref,
			"cref_new",
			"rows keep client_ref (optimistic-send matching)",
		);
		/*
		 * ONE MERGE FOR EVERY CACHE WRITER. The banner's read goes through the same
		 * `teamBridgeMessagesQueryOptions` as the timeline, so #1539's event carry
		 * applies to it too: a fresh page that omits a line the reader already saw
		 * must not wipe it from the timeline the click opens. A watcher that fetched
		 * with its own queryFn would drop `bcev_seen` here.
		 */
		assert.deepEqual(
			(page.events ?? []).map((line) => line.id),
			["bcev_seen"],
			"the banner's write keeps event lines already on the page",
		);
		const banner = mounted.notifications[0];
		assert.equal(banner.conversationId, "bcv_w");
		assert.equal(banner.messageId, "bcmsg_new");
		assert.equal(
			api.teamBridgeOpenPath(banner),
			"/team-bridge?tenant=tnt_w&conversation=bcv_w&message=bcmsg_new",
		);
	} finally {
		release?.();
		await mounted.teardown();
	}
});

test("an unmounted, previously visited conversation is refreshed when latest_seq advances, even with nothing to banner", async () => {
	resetFixture();
	const org = {
		tenant_id: "tnt_u",
		tenant_name: "U",
		unread: 1,
		eligible: true,
	};
	fixture.account = { total: 1, organizations: [org] };
	const muted = {
		...conversation("bcv_u", "tnt_u"),
		notify: "mute",
		muted: true,
	};
	const never = conversation("bcv_never", "tnt_u");
	fixture.conversations = { conversations: [muted, never] };
	fixture.tenants.tnt_u = {
		total: 0,
		conversations: [
			{ ...notifyRow("bcv_u", 1), muted: true },
			notifyRow("bcv_never", 1),
		],
	};
	const mounted = await mount();
	const key = api.teamBridgeKeys.messages("bcv_u", "tnt_u", "acct_alice");
	mounted.client.setQueryData(key, {
		messages: [message("bcmsg_1", "bcv_u", 1)],
	});
	try {
		await until(
			() => fixture.calls.unread.includes("tnt_u"),
			"first tenant read",
		);
		await settle();
		assert.equal(
			fixture.calls.history.length,
			0,
			"first observation reads no history",
		);
		fixture.messages = {
			messages: [
				message("bcmsg_2", "bcv_u", 2),
				message("bcmsg_1", "bcv_u", 1),
			],
		};
		fixture.tenants.tnt_u = {
			total: 0,
			conversations: [
				{ ...notifyRow("bcv_u", 2), unread_count: 2, muted: true },
				{ ...notifyRow("bcv_never", 3), unread_count: 3 },
			],
		};
		await act(async () =>
			mounted.client.invalidateQueries({
				queryKey: api.teamBridgeKeys.unreadPrefix,
			}),
		);
		await until(
			() => mounted.client.getQueryData(key)?.messages.length === 2,
			"the cached timeline refreshed",
		);
		assert.deepEqual(
			fixture.calls.history.filter((call) => call.id === "bcv_u"),
			[{ id: "bcv_u", tenantId: "tnt_u" }],
			"exactly the changed key, once",
		);
		assert.equal(mounted.notifications.length, 0, "muted: nothing bannered");
		assert.equal(
			mounted.client.getQueryData(
				api.teamBridgeKeys.messages("bcv_never", "tnt_u", "acct_alice"),
			),
			undefined,
			"a never-visited conversation gets no history entry",
		);
		// The cached list rows took the unread rows' counts.
		const rows = mounted.client.getQueryData(
			api.teamBridgeKeys.conversations("all", "acct_alice"),
		).conversations;
		assert.equal(rows.find((row) => row.id === "bcv_u").unread_count, 2);
		// `latest_seq` stays the list's own: the planner pairs on it.
		assert.equal(rows.find((row) => row.id === "bcv_u").latest_seq, 1);
		assert.equal(rows.find((row) => row.id === "bcv_never").unread_count, 3);
	} finally {
		await mounted.teardown();
	}
});

/** A conversation row in any of the shapes the rail draws. */
const railRow = (id, tenantId, kind, unread, extra = {}) => ({
	...conversation(id, tenantId),
	kind,
	unread_count: unread,
	latest_seq: 10,
	last_read_seq: 10 - unread,
	...extra,
});

/*
 * The ARITHMETIC of the merge, across every row kind and organization. The
 * rendered claim - that the nav badge a reader sees equals the accent marks the
 * rows draw - is the test below (agent review round 1, n3: this one compares the
 * view with itself, which cannot catch a merge hole).
 */
test("the view attributes every row kind and organization to one total", async () => {
	/*
	 * The rail's categories: channel, built-in channel, group, DM, a chief-of-
	 * staff DM (an agent member), a conversation whose count is a thread reply
	 * (the hub folds replies into the conversation's counter), one in a second
	 * organization (other org / collapsed in a scoped view) and a muted one
	 * (its row shows the count; the badge never does).
	 */
	resetFixture();
	const a = { tenant_id: "tnt_a", tenant_name: "A", eligible: true };
	const b = { tenant_id: "tnt_b", tenant_name: "B", eligible: true };
	const rowsA = [
		railRow("bcv_ch", "tnt_a", "channel", 2),
		railRow("bcv_humans", "tnt_a", "channel", 1, { builtin: "humans" }),
		railRow("bcv_grp", "tnt_a", "group", 3),
		railRow("bcv_dm", "tnt_a", "dm", 1),
		railRow("bcv_cos", "tnt_a", "dm", 4, {
			members: [
				member("Alice", "human", "active", "acct_alice"),
				member("Aida", "agent", "active", "acct_bob"),
			],
		}),
		railRow("bcv_thread", "tnt_a", "group", 1, {
			last_thread_root_id: "bcmsg_root",
		}),
		railRow("bcv_muted", "tnt_a", "channel", 5, {
			notify: "mute",
			muted: true,
		}),
	];
	const rowsB = [railRow("bcv_other", "tnt_b", "group", 6)];
	const unreadRows = (rows) =>
		rows.map((row) => ({
			conversation_id: row.id,
			unread_count: row.unread_count,
			last_read_seq: row.last_read_seq,
			latest_seq: row.latest_seq,
			muted: row.muted,
		}));
	// The tenant-scoped list is OLDER than the unread poll: a's group gained one.
	const client = new QueryClient();
	const owner = "acct_alice";
	client.setQueryData(api.teamBridgeKeys.conversations("tnt_a", owner), {
		conversations: rowsA.map((row) =>
			row.id === "bcv_grp" ? { ...row, unread_count: 2 } : row,
		),
	});
	client.setQueryData(api.teamBridgeKeys.conversations("all", owner), {
		conversations: [...rowsA, ...rowsB].map((row) =>
			row.id === "bcv_grp" ? { ...row, unread_count: 2 } : row,
		),
	});
	await new Promise((resolve) => setTimeout(resolve, 2));
	client.setQueryData(api.teamBridgeKeys.unread("tnt_a", owner), {
		total: 12,
		conversations: unreadRows(rowsA),
	});
	client.setQueryData(api.teamBridgeKeys.unread("tnt_b", owner), {
		total: 6,
		conversations: unreadRows(rowsB),
	});
	client.setQueryData(api.teamBridgeKeys.unread("all", owner), {
		total: 18,
		organizations: [
			{ ...a, unread: 12 },
			{ ...b, unread: 6 },
		],
	});
	const view = api.teamBridgeUnreadView(client, owner);
	for (const scope of ["tnt_a", "all"]) {
		const shown = client
			.getQueryData(api.teamBridgeKeys.conversations(scope, owner))
			.conversations.map((row) => api.withSharedUnread(row, view));
		const badgeable = shown
			.filter((row) => !row.muted)
			.reduce((sum, row) => sum + row.unread_count, 0);
		if (scope === "all")
			assert.equal(view.total, badgeable, "badge == merged rail");
		else
			assert.equal(view.byTenant.get("tnt_a"), badgeable, "org A == its rail");
		assert.equal(
			shown.find((row) => row.id === "bcv_grp").unread_count,
			3,
			"the older list row takes the newer unread row's count",
		);
		assert.equal(shown.find((row) => row.id === "bcv_muted").unread_count, 5);
	}
	assert.equal(view.total, 18);
	assert.equal(view.byTenant.get("tnt_b"), 6);
	// A list row that landed AFTER the aggregate zeroed its org still counts:
	// the badge never claims less than a row shows.
	const late = new QueryClient();
	late.setQueryData(
		api.teamBridgeKeys.unread("all", owner),
		{
			total: 0,
			organizations: [
				{ tenant_id: "tnt_a", tenant_name: "A", unread: 0, eligible: true },
			],
		},
		{ updatedAt: 1 },
	);
	late.setQueryData(
		api.teamBridgeKeys.conversations("all", owner),
		{
			conversations: [railRow("bcv_late", "tnt_a", "group", 2)],
		},
		{ updatedAt: 2 },
	);
	assert.equal(api.teamBridgeUnreadView(late, owner).total, 2);
	// An org whose rows the watcher has not read keeps the aggregate's count.
	client.removeQueries({
		queryKey: api.teamBridgeKeys.unread("tnt_b", owner),
		exact: true,
	});
	assert.equal(
		api.teamBridgeUnreadView(client, owner).byTenant.get("tnt_b"),
		6,
	);
	// An aggregate that names no organization keeps the server total.
	const legacy = new QueryClient();
	legacy.setQueryData(api.teamBridgeKeys.unread("all", owner), {
		total: 7,
		organizations: [],
	});
	assert.equal(api.teamBridgeUnreadView(legacy, owner).total, 7);
});

/** Which attention marks a rendered subtree drew, by register. */
const marksIn = (host) => {
	const marks = [...host.querySelectorAll("[data-attention-register]")];
	const of = (register) =>
		marks
			.filter((mark) => mark.dataset.attentionRegister === register)
			.map((mark) => ({
				count: Number(mark.textContent.replace("+", "")),
				className: mark.className,
			}));
	return { accent: of("attention"), quiet: of("quiet") };
};

test("the rendered nav badge equals the rendered row marks, and a muted row's count is quiet", async () => {
	/*
	 * TWO RENDERED NUMBERS, NOT THE VIEW AGAINST ITSELF (agent review round 1,
	 * n3). The arithmetic test above maps rows through the same view it compares
	 * against, so a hole in the merge - or a category dropped from both sides -
	 * still passes. Here the badge is the production nav hook's number drawn by
	 * the shared `AttentionBadge`, and each row mark is drawn by that same shared
	 * component from the ROW's own production derivation (`withSharedUnread` over
	 * the conversation-list cache), so the two sides travel different code. The
	 * registers come from `unreadRegister`, the model function the rail row uses
	 * (`sidebar-attention-badge.test.mjs` pins that the row calls it), so this
	 * test cannot disagree with the shipped row.
	 *
	 * The classification half is design round 1's D1: an ACCENT row count is
	 * attention and sums to the nav badge; a muted row's count is a TOTAL, so it
	 * renders in the quiet numeral, stays visible, and is excluded from the
	 * badge. Before D1 both drew the accent pill, so a reader saw accent "1"s
	 * beside a nav 0.
	 */
	resetFixture();
	fixture.identity = "acct_alice";
	const rows = [
		railRow("bcv_ch", "tnt_a", "channel", 2),
		railRow("bcv_dm", "tnt_a", "dm", 1),
		{
			...railRow("bcv_muted", "tnt_a", "channel", 5),
			notify: "mute",
			muted: true,
		},
	];
	fixture.conversations = { conversations: rows };
	const unreadRows = rows.map((row) => ({
		conversation_id: row.id,
		unread_count: row.unread_count,
		last_read_seq: row.last_read_seq,
		latest_seq: row.latest_seq,
		muted: row.muted,
	}));
	// Three unmuted (2 + 1); the muted five stays on its row and out of the badge.
	fixture.account = {
		total: 3,
		organizations: [
			{ tenant_id: "tnt_a", tenant_name: "A", unread: 3, eligible: true },
		],
	};
	fixture.tenants.tnt_a = { total: 8, conversations: unreadRows };
	const Extra = () => {
		const status = api.useTeamBridgeStatus(true);
		const ready = status.data?.account_id === "acct_alice";
		const list = api.useTeamBridgeConversations("all", ready, "acct_alice");
		const nav = api.useTeamBridgeNavItem(true);
		const view = api.useTeamBridgeUnreadView(ready ? "acct_alice" : undefined);
		const rail = (list.data?.conversations ?? []).map((row) =>
			api.withSharedUnread(row, view),
		);
		return React.createElement(
			React.Fragment,
			null,
			React.createElement(api.AttentionBadge, {
				count: nav?.attention ?? 0,
				"data-testid": "nav-badge",
			}),
			React.createElement(
				"ul",
				{ "data-testid": "rows" },
				rail.map((row) =>
					React.createElement(
						"li",
						{ key: row.id, "data-conversation-id": row.id },
						React.createElement(api.AttentionBadge, {
							count: row.unread_count,
							register: api.unreadRegister(row),
						}),
					),
				),
			),
		);
	};
	const mounted = await mount({ Extra });
	try {
		const rowsHost = () => mounted.host.querySelector('[data-testid="rows"]');
		await until(
			() =>
				mounted.host.querySelector('[data-testid="nav-badge"]')?.textContent ===
					"3" && rowsHost().querySelectorAll("li").length === 3,
			"nav badge 3 beside three rail rows",
		);
		const nav = Number(
			mounted.host.querySelector('[data-testid="nav-badge"]').textContent,
		);
		const { accent, quiet } = marksIn(rowsHost());
		assert.equal(
			accent.reduce((total, mark) => total + mark.count, 0),
			nav,
			"the accent row counts are exactly the rendered nav badge",
		);
		assert.deepEqual(
			accent.map((mark) => mark.count).sort((a, b) => a - b),
			[1, 2],
			"the two unmuted rows wear the accent register",
		);
		for (const mark of accent) {
			assert.match(mark.className, /bg-accent/);
			assert.match(mark.className, /text-on-accent/);
		}
		assert.deepEqual(
			quiet.map((mark) => mark.count),
			[5],
			"the muted row's count is drawn, in the quiet register",
		);
		assert.match(quiet[0].className, /bg-elevated/);
		assert.match(quiet[0].className, /text-ink-dim/);
		assert.ok(
			!accent.some((mark) => mark.count === 5),
			"a muted count never takes the accent",
		);
		assert.equal(nav, 3, "the muted five is out of the badge");
	} finally {
		await mounted.teardown();
	}
});

test("cancelling a stale read leaves the conversation list successful, never errored", async () => {
	/*
	 * A CANCELLED READ IS NOT A FAILURE THE READER CAN ACT ON (quality review
	 * round 3, Q3/m1). `query.cancel()` without options leaves the entry in an
	 * error state in TanStack 5.73.3, so the cancel added in round 2 could flash
	 * the rail's `error_stale` line and a Retry control over rows already on
	 * screen. `cancel({ revert: true })` restores the state the fetch started
	 * from; this pin is that the rows AND the status survive it.
	 */
	const client = new QueryClient();
	const key = api.teamBridgeKeys.conversations("all", "acct_alice");
	client.setQueryData(key, {
		conversations: [railRow("bcv_cancel", "tnt_a", "channel", 2)],
	});
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const read = client
		.fetchQuery({
			queryKey: key,
			queryFn: async () => {
				await gate;
				return { conversations: [] };
			},
			staleTime: 0,
		})
		.catch((error) => error);
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (client.getQueryState(key).fetchStatus === "fetching") break;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.equal(
		client.getQueryState(key).fetchStatus,
		"fetching",
		"a read is genuinely in flight",
	);
	api.cancelTeamBridgeUnreadReads(client, "acct_alice");
	release();
	assert.ok((await read) instanceof Error, "the cancelled read rejects");
	const state = client.getQueryState(key);
	assert.equal(state.fetchStatus, "idle");
	assert.equal(
		state.status,
		"success",
		"no error state, so no stale-error row",
	);
	assert.equal(
		state.data.conversations.map((row) => row.id).join(),
		"bcv_cancel",
		"the rows on screen are the ones that were already there",
	);
});

test("a muted row keeps its quiet count when the aggregate reports its organization at zero (A/B)", async () => {
	/*
	 * THE AGGREGATE'S ZERO EXCLUDES MUTED ROWS BY CONTRACT, so it means "no
	 * UNMUTED unread", never "no unread" (design review round 2, D5). The
	 * zeroing rule still applies to un-muted rows - for them the org-level zero
	 * is authoritative and stale rows have to stop claiming otherwise - but it
	 * used to zero muted rows too, emptying the quiet numeral in exactly the state
	 * the quiet register exists for. A mute is the reader saying "do not interrupt
	 * me", so the muted conversation is very often the only thing waiting.
	 *
	 * A/B on ONE seed: identical cache shapes, only the `muted` flag differs. The
	 * muted row keeps its count; its un-muted twin is cleared; neither count
	 * reaches the badge.
	 */
	const owner = "acct_alice";
	const seeded = (muted) => {
		const client = new QueryClient();
		client.setQueryData(
			api.teamBridgeKeys.conversations("all", owner),
			{
				conversations: [
					railRow(
						"bcv_mute",
						"tnt_a",
						"channel",
						3,
						muted ? { muted: true, notify: "mute" } : {},
					),
				],
			},
			{ updatedAt: 100 },
		);
		client.setQueryData(
			api.teamBridgeKeys.unread("all", owner),
			{
				total: 0,
				organizations: [
					{ tenant_id: "tnt_a", tenant_name: "A", unread: 0, eligible: true },
				],
			},
			{ updatedAt: 200 },
		);
		return api.teamBridgeUnreadView(client, owner);
	};
	const key = "tnt_a\u0000bcv_mute";
	const quiet = seeded(true);
	assert.equal(
		quiet.rows.get(key).unread,
		3,
		"the muted conversation's own count survives the aggregate's zero",
	);
	assert.equal(quiet.total, 0, "and it still does not raise the badge");
	const unMuted = seeded(false);
	assert.equal(
		unMuted.rows.get(key).unread,
		0,
		"an un-muted row is still cleared by the newer org-level zero",
	);
	assert.equal(unMuted.total, 0);
});

test("mark-read decrements the row and the nav badge in the same render, and rolls back on refusal", async () => {
	for (const outcome of ["success", "refused"]) {
		resetFixture();
		const org = {
			tenant_id: "tnt_r",
			tenant_name: "R",
			unread: 3,
			eligible: true,
		};
		fixture.account = { total: 3, organizations: [org] };
		const row = {
			...conversation("bcv_r", "tnt_r"),
			latest_seq: 3,
			unread_count: 3,
		};
		fixture.conversations = { conversations: [row] };
		fixture.tenants.tnt_r = {
			total: 3,
			conversations: [{ ...notifyRow("bcv_r", 3), unread_count: 3 }],
		};
		let release;
		fixture.markReadGate = new Promise((resolve, reject) => {
			release =
				outcome === "success" ? resolve : () => reject(new Error("refused"));
		});
		const renders = [];
		let markRead;
		const Extra = () => {
			const nav = api.useTeamBridgeNavItem(true);
			const view = api.useTeamBridgeUnreadView("acct_alice");
			markRead = api.useMarkTeamBridgeRead("bcv_r", "tnt_r");
			const shown = view.rows.get("tnt_r\u0000bcv_r")?.unread;
			renders.push({ nav: nav?.attention, row: shown });
			return null;
		};
		const mounted = await mount({ Extra });
		try {
			await until(
				() => renders.at(-1)?.nav === 3 && renders.at(-1)?.row === 3,
				"badge and row at 3",
			);
			const before = renders.length;
			await act(async () => {
				markRead.mutate({ seq: 3 });
			});
			const after = renders.slice(before);
			assert.ok(after.length > 0);
			assert.ok(
				after.every((frame) => (frame.nav === 0) === (frame.row === 0)),
				`row and badge never disagree: ${JSON.stringify(after)}`,
			);
			assert.deepEqual(
				after.at(-1),
				{ nav: 0, row: 0 },
				"cleared together, before the server answers",
			);
			assert.equal(fixture.calls.markRead.length, 1);
			if (outcome === "refused") {
				// The server still says 3: a refused write restores both at once.
				await act(async () => release());
				await until(
					() => renders.at(-1)?.nav === 3 && renders.at(-1)?.row === 3,
					"rolled back together",
				);
			} else {
				// The server's answer after the read, on every route.
				fixture.account = { total: 0, organizations: [{ ...org, unread: 0 }] };
				fixture.conversations = {
					conversations: [{ ...row, unread_count: 0, last_read_seq: 3 }],
				};
				fixture.tenants.tnt_r = {
					total: 0,
					conversations: [
						{ ...notifyRow("bcv_r", 3), unread_count: 0, last_read_seq: 3 },
					],
				};
				await act(async () => release());
				await settle();
				assert.deepEqual(renders.at(-1), { nav: 0, row: 0 });
				assert.ok(
					renders
						.slice(before)
						.every((frame) => (frame.nav === 0) === (frame.row === 0)),
					"still never disagree after the server reconciles",
				);
			}
		} finally {
			release?.();
			await mounted.teardown();
		}
	}
});
