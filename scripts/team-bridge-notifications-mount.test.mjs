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
	tenants: {},
	conversations: { conversations: [] },
	listGate: null,
	historyGate: null,
	directoryGate: null,
	messages: { messages: [] },
	directoryMembers: [],
	calls: { identity: 0, conversations: 0, unread: [], history: [], directory: [] },
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
	async directory(tenantId) {
		fixture.calls.directory.push(tenantId);
		if (fixture.directoryGate) await fixture.directoryGate;
		return { members: fixture.directoryMembers };
	},
	async identity() {
		fixture.calls.identity += 1;
		return fixture.identity;
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
			export { useTeamBridgeNotifications } from "./src/renderer/src/features/team-bridge/use-team-bridge-notifications";
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
	const Probe = () => {
		api.useTeamBridgeNotifications(enabled);
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
	fixture.directoryGate = null;
	fixture.messages = { messages: [] };
	fixture.directoryMembers = [];
	fixture.releaseList = null;
	fixture.calls = {
		identity: 0,
		conversations: 0,
		unread: [],
		history: [],
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
for (const pending of ["history", "directory"]) {
	for (const disable of ["setting", "capability", "none"]) {
		test(`a ${disable} change while ${pending} is pending is rechecked before IPC`, async () => {
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
					assert.equal(mounted.notifications[0].title, "Bob ‹admin›");
					assert.equal(mounted.notifications[0].body, "fixture message");
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
