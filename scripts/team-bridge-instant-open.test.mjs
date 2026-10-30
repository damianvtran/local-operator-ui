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
