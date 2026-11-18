import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import {
	deferred,
	delay,
	mount,
	ui,
	until,
} from "./fixtures/team-bridge-auth-owner-page.mjs";

/*
 * INSTANT OPEN (tb-instant-open), measured at the runner rather than argued from
 * a reading of the source.
 *
 * The report was "opening Team Bridge can take a few seconds with a loading
 * wheel". The cause was a serial waterfall in front of the first paint: the whole
 * page held a full-screen gate until `capabilities` and `team_bridge.status`
 * answered, and only then did the core reads start - with the account-scope
 * conversation list among them, which a single-organization account immediately
 * threw away in favour of its own organization's list.
 *
 * These numbers are STRUCTURAL: round trips removed, counted through the REAL
 * page, the REAL hooks and keys, and the REAL shipped QueryClient against a
 * controlled transport. Nothing here models production latency - the transport
 * answers on a timer, so a wall-clock reading would measure this fixture and not
 * the app. Only the preload transport is a fixture.
 */

const SHARED = {
	tenant_id: "org_shared",
	tenant_name: "Shared",
	eligible: true,
	endpoint: null,
};
const PLAN_TITLE = "Team Bridge requires a Radient Team plan";
const ROW = "Shared thread";

const row = (overrides = {}) => ({
	id: "bcv_shared",
	tenant_id: "org_shared",
	kind: "group",
	name: ROW,
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_a",
	last_message_at: "2026-10-23T12:00:00Z",
	latest_seq: 0,
	members: [
		{
			account_id: "acct_a",
			kind: "human",
			display_label: "acct_a",
			state: "active",
			role: "member",
		},
	],
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	...overrides,
});

/** Exactly the snapshot the shell's notification watcher leaves for this account. */
const seedWatcherSnapshot = ({ client, ui: bundle }) =>
	client.setQueryData(bundle.teamBridgeKeys.conversations("all", "acct_a"), {
		conversations: [row()],
		has_more: false,
	});

/** The list round trips the page has made, named by the scope it asked for. */
const listScopes = (app) =>
	app.fixture.calls
		.filter((call) => call.op === "team_bridge.conversations.list")
		.map((call) => (call.scope === "account" ? "account" : call.tenant_id));

test("a cold single-organization open asks for that organization's list once", async () => {
	/*
	 * THE NUMBER THIS TEST OWNS. Cold single-tenant open, mount to rail painted:
	 * before - ["account", "org_shared"], two round trips, the first discarded;
	 * after - ["org_shared"], one. The account-scope read is not narrowed, it is
	 * never issued: the organization set the hub already carries decides the scope
	 * before the first list request.
	 */
	const app = await mount({ path: "/team-bridge", tenants: [SHARED] });
	try {
		await until(
			() => app.host.textContent.includes(ROW),
			"the organization's rail row",
		);
		assert.deepEqual(
			listScopes(app),
			["org_shared"],
			`one organization-scope list read, saw ${JSON.stringify(listScopes(app))}`,
		);
	} finally {
		await app.close();
	}
});

test("the rail paints from the watcher's cache before the eligibility gate answers", async () => {
	/*
	 * MECHANISM 2, and the line it draws. The verdict decides whether this surface
	 * exists for the account, so an ineligible answer still wins (the test below);
	 * what the gate must no longer do is hide rows this account already read. Here
	 * the status read is held open, the watcher's snapshot is in cache, and the
	 * rail must be readable before the verdict lands - with no list request spent
	 * to get there, because the rows came from the watcher's own poll.
	 */
	const gate = deferred();
	const app = await mount({
		path: "/team-bridge",
		tenants: [SHARED],
		statusGate: gate,
		waitReady: false,
		seed: seedWatcherSnapshot,
	});
	try {
		await until(
			() => app.host.textContent.includes(ROW),
			"the cached rail row before the verdict",
		);
		assert.deepEqual(
			listScopes(app),
			[],
			"the paint spends no list request of its own",
		);
		/* The rows are painted but must not claim to be current: the affordance is
		   the honest half of painting from cache. */
		assert.ok(
			app.host.querySelector("[data-rail-refreshing]"),
			"a cached paint says it is not yet current",
		);
		/* Writes stay shut while the verdict is unknown: the shipped owner guard is
		   what refuses them, and it has not answered either. */
		assert.equal(
			app.host.querySelector('[aria-label="Send message"]')?.disabled ?? true,
			true,
			"no write is offered before the verdict",
		);
		gate.resolve();
		await until(
			() => listScopes(app).length === 1,
			"the organization's list read after the verdict",
		);
	} finally {
		gate.resolve();
		await app.close();
	}
});

test("an ineligible account is shown no cached surface at all", async () => {
	/*
	 * THE OTHER SIDE OF THE LINE. Same cached snapshot, same account, and the
	 * verdict says the plan does not include the bridge: the panel renders and not
	 * one cached row or control reaches the screen. A cache is a record of what this
	 * account could read, never permission to show a surface it may not have.
	 */
	const app = await mount({
		path: "/team-bridge",
		tenants: [SHARED],
		surfaceState: "A",
		waitReady: false,
		seed: seedWatcherSnapshot,
	});
	try {
		await until(
			() => app.host.textContent.includes(PLAN_TITLE),
			"the plan gate",
		);
		assert.equal(
			app.host.textContent.includes(ROW),
			false,
			"no cached row under an ineligible verdict",
		);
		assert.deepEqual(listScopes(app), [], "and no list read either");
	} finally {
		await app.close();
	}
});

/*
 * A MULTI-ORG ACCOUNT THAT MAY NOT READ STILL GETS ITS PANEL (review round 2, M3
 * on ui#1970). The opening hold waits for the default org, which memberships
 * answer, and memberships stay disabled once the verdict refuses reads. With two
 * hub tenants and a two-org watcher snapshot the hold used to win over the
 * eligibility branch and leave "Checking Team Bridge…" up for good. The test
 * above passes only because it is single-tenant; these are the two-tenant cases.
 */
const twoOrgSnapshot = ({ client, ui: bundle }) =>
	client.setQueryData(bundle.teamBridgeKeys.conversations("all", "acct_a"), {
		conversations: [
			row(),
			row({ id: "bcv_other", tenant_id: "org_other", name: "Other thread" }),
		],
		has_more: false,
	});
for (const { verdict, title, options } of [
	{
		verdict: "plan_required",
		title: PLAN_TITLE,
		options: { surfaceState: "A" },
	},
	{
		verdict: "rate_limited",
		title: "Slowing down requests",
		options: {
			statusState: "unavailable",
			statusError: { code: "rate_limited", message: "Too many requests" },
		},
	},
	{
		verdict: "unavailable",
		title: "Team Bridge is unavailable",
		options: { statusState: "unavailable" },
	},
]) {
	test(`a two-org ${verdict} account sees its panel, not an endless gate`, async () => {
		const app = await mount({
			path: "/team-bridge",
			waitReady: false,
			seed: twoOrgSnapshot,
			...options,
		});
		try {
			await until(
				() => app.host.textContent.includes(title),
				`the ${verdict} panel`,
			);
			assert.equal(
				app.host.textContent.includes(ROW),
				false,
				"no cached row under a refusing verdict",
			);
			assert.deepEqual(listScopes(app), [], "and no list read either");
		} finally {
			await app.close();
		}
	});
}

test("an unread refresh is visible, not a silently stale count", async () => {
	/*
	 * MECHANISM 4 for the one number a reader acts on. Cached rows stay on screen
	 * while the reads behind them settle, so the total and the per-row counts must
	 * say out loud that they are being re-read instead of presenting a stale count
	 * as current.
	 */
	const app = await mount();
	const gate = deferred();
	try {
		await until(() => app.host.textContent.includes(ROW), "the rail row");
		app.fixture.unreadGate = gate;
		await act(async () => {
			void app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.unreadPrefix,
			});
		});
		await until(
			() =>
				app.host
					.querySelector("[data-rail-refreshing]")
					?.getAttribute("data-rail-refreshing") === "unread",
			"a visible unread refresh",
		);
		/* Visible means both readings: the state is on screen and named for a
		   screen reader, and the rows it describes are still there. */
		assert.equal(app.host.textContent.includes(ROW), true);
		assert.equal(
			app.host.querySelector('[aria-busy="true"]') !== null,
			true,
			"the busy region is announced",
		);
		gate.resolve();
		await until(
			() => app.host.querySelector("[data-rail-refreshing]") === null,
			"the affordance clears once the count is current",
		);
	} finally {
		app.fixture.unreadGate = null;
		gate.resolve();
		await app.close();
	}
});

test("a re-entry keeps its rows while the reads behind them settle", async () => {
	/*
	 * MECHANISM 4 for the list: stale-while-revalidate, never a skeleton over a
	 * request that is merely slow. The organization's list is held open after the
	 * verdict lands; the last known rows stay readable, the affordance says they are
	 * being checked, and the read still lands.
	 */
	const listGate = deferred();
	const app = await mount();
	try {
		await until(() => app.host.textContent.includes(ROW), "the rail row");
		app.fixture.listGate = listGate;
		await act(async () => {
			void app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.conversationsPrefix,
			});
		});
		await delay();
		assert.equal(
			app.host.textContent.includes(ROW),
			true,
			"rows stay painted while the list is in flight",
		);
		assert.ok(
			app.host.querySelector("[data-rail-refreshing]"),
			"and the paint is labelled as refreshing",
		);
		listGate.resolve();
		app.fixture.listGate = null;
		await until(
			() => app.host.querySelector("[data-rail-refreshing]") === null,
			"the affordance clears once the list is current",
		);
	} finally {
		app.fixture.listGate = null;
		listGate.resolve();
		await app.close();
	}
});

/*
 * THE DEFAULT ORG IS WAITED FOR, NOT CORRECTED TO (agent review round 1, M1
 * and m2 on ui#1970). A multi-org account learns its organizations from the
 * status payload a round trip before `GET /v1/me/memberships` names the
 * default (`is_home`). Deciding in between painted yesterday's pick, read its
 * list, recorded it as this app session's scope and then jumped. Held
 * instead: no list read, no seed painted, nothing recorded - and then one read,
 * of the default org's list.
 */
test("multi-org restart: nothing of yesterday's pick paints or is read before the default org lands", async () => {
	const gate = deferred();
	const OTHER_ROW = "Other thread";
	const app = await mount({
		path: "/team-bridge",
		waitReady: false,
		membershipsGate: gate,
		memberships: [
			{
				tenant_id: "org_shared",
				tenant_name: "Shared",
				role: "member",
				status: "active",
				is_home: true,
				plan: { status: "active", seats: 5 },
			},
		],
		seed: ({ client, ui: bundle }) => {
			// Yesterday's durable pick, and the watcher's two-tenant snapshot.
			localStorage.setItem(
				"lo.teamBridge.scope.v1",
				JSON.stringify({ acct_a: "org_other" }),
			);
			client.setQueryData(
				bundle.teamBridgeKeys.conversations("all", "acct_a"),
				{
					conversations: [
						row(),
						row({ id: "bcv_other", tenant_id: "org_other", name: OTHER_ROW }),
					],
					has_more: false,
				},
			);
		},
	});
	const sessionScope = () =>
		JSON.parse(
			window.sessionStorage.getItem("lo.teamBridge.sessionScope.v1") ?? "{}",
		).acct_a;
	try {
		await until(
			() =>
				app.fixture.calls.some(
					(call) =>
						call.op === "radient.request" &&
						call.control?.operation === "memberships.list",
				),
			"the memberships read is in flight",
		);
		await delay(150);
		assert.deepEqual(listScopes(app), [], "no list read while held");
		assert.equal(
			app.host.textContent.includes(OTHER_ROW),
			false,
			"yesterday's org's rows never paint",
		);
		assert.equal(
			app.host.querySelector('button[aria-label="Organization: Other"]'),
			null,
			"yesterday's org's title never paints",
		);
		assert.equal(sessionScope(), undefined, "no interim session scope");

		await act(async () => gate.resolve());
		await until(
			() => app.host.querySelector('button[aria-label="Organization: Shared"]'),
			"the default org's title",
		);
		await until(() => app.host.textContent.includes(ROW), "its rail row");
		assert.deepEqual(
			listScopes(app),
			["org_shared"],
			"one read: the default org",
		);
		assert.equal(app.host.textContent.includes(OTHER_ROW), false);
		assert.equal(sessionScope(), "org_shared");
	} finally {
		await app.close();
	}
});
