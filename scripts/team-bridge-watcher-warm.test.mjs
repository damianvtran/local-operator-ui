/**
 * THE SHELL WATCHER WARMS THE LANDING CONVERSATION BEFORE THE FIRST CLICK
 * (bridge-instant-load; operator, 2026-11-11: "The whole thing should load in
 * under 300ms ... loading and updating things in the background via a team
 * bridge daemon/process, so that clicking in is instant").
 *
 *     node --test scripts/team-bridge-watcher-warm.test.mjs
 *
 * THE MEASURED FAILURE. The native instant-load bench on v0.56.1: first open
 * 362.4 ms against the 300 ms bar, with the conversation list ALREADY cached by
 * the watcher and 6 blocking messages reads. The page's own landing read
 * (`prefetchTeamBridgeLanding`) starts only at mount, so the first click still
 * paid a full history round trip.
 *
 * Asserted here through the shipped page AND the shipped watcher
 * (`useTeamBridgeNotifications`, mounted beside the route with the fixture's
 * `watcher` option), with only the preload transport faked
 * (`fixtures/team-bridge-auth-owner-page.mjs`). Every scenario starts AWAY from
 * Team Bridge - the shell is up, the page is not - which is the state the
 * reader's first click starts from:
 *
 * 1. Default landing: the watcher reads #general's first page in the
 *    background; the page then mounts, lands on it and paints from cache with
 *    ZERO messages reads of its own. (Fails on origin/main: nothing is read
 *    until the page mounts.)
 * 2. Remembered landing: the remembered conversation (view memory, with its
 *    tenant) is warmed first, and the page lands on it from cache.
 * 3. Bounded: at most `TEAM_BRIDGE_BACKGROUND_WARM` (3) reads per list change,
 *    and an unchanged list answer re-reads nothing.
 * 4. A 429 on the warm holds every further warm for that account.
 * 5. `not_a_member` on the warm stays silent: one read, no retry, no toast.
 * 6. An account switch while the warm is out: the read is fenced and never
 *    retried; the return to the first account warms at once, from cache when
 *    it can.
 * 7. Off: with Team Bridge switched off on this machine, the watcher reads no
 *    history at all.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
process.env.TEAM_BRIDGE_PLAIN_MENUS = "1";
const { deferred, delay, mount, ui, until } = await import(
	"./fixtures/team-bridge-auth-owner-page.mjs"
);

const person = (id) => ({
	account_id: id,
	kind: "human",
	display_label: id,
	state: "active",
	role: "member",
});
/* Newest first by `last_message_at`; #general is the oldest on purpose, so
   "the default landing" and "the most recent rows" are different rows. */
const row = (id, minute, patch = {}) => ({
	id,
	tenant_id: "org_shared",
	kind: "channel",
	name: id,
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: "acct_a",
	last_message_at: `2026-11-13T12:${String(minute).padStart(2, "0")}:00Z`,
	latest_seq: 2,
	members: [person("acct_a")],
	member: true,
	last_read_seq: 2,
	unread_count: 0,
	muted: false,
	...patch,
});
const ROWS = [
	row("gen_org_shared", 0, { name: "general", builtin: "general" }),
	row("launch_shared", 10),
	row("recent_1", 50),
	row("recent_2", 40),
	row("recent_3", 30),
	row("recent_4", 20),
];
const msg = (conversation, seq) => ({
	id: `msg_${conversation}_${seq}`,
	conversation_id: conversation,
	seq,
	sender: person("acct_b"),
	body: `line ${seq} of ${conversation}`,
	origin: "human",
	created_at: "2026-11-13T12:00:00Z",
});

function scenario(fixture, rows = ROWS) {
	fixture.listFor = (request) => ({
		conversations: request.status === "archived" ? [] : rows,
	});
	for (const entry of rows)
		fixture.historyByConversation.set(entry.id, [
			msg(entry.id, 1),
			msg(entry.id, 2),
		]);
	// The reader is somewhere else in the app: the shell (and its watcher) is
	// mounted, the Team Bridge route is not.
	fixture.away = true;
}

function remember(view) {
	localStorage.setItem(
		"lo.teamBridge.view.v1",
		JSON.stringify({
			acct_a: { scope: "org_shared", scopes: { org_shared: view } },
		}),
	);
}

/* Every messages request, in dispatch order (the transport records each call
   twice; the entry carries `owner`). */
const historyReads = (app, filter = () => true) =>
	app.fixture.calls.filter(
		(call) =>
			call.op === "team_bridge.messages.list" &&
			call.owner !== undefined &&
			filter(call),
	);
const readsOf = (app, id) =>
	historyReads(app, (call) => call.conversation_id === id).length;

const selected = (app) =>
	app.host
		.querySelector('[aria-current="page"][data-conversation-id]')
		?.getAttribute("data-conversation-id") ?? null;

const quiet = async (beats = 10) => {
	for (let i = 0; i < beats; i++) await delay();
};

/* The page opens on `id` from the warm entry: selected and painted in the
   mount's own commit (no wait for any answer), and never read again. The page's
   OWN planned prefetch of other rows may follow; none of it is the landing. */
async function opensFromCache(app, id) {
	const before = readsOf(app, id);
	await app.back();
	assert.equal(selected(app), id, `the page lands on ${id}`);
	assert.ok(
		app.host.textContent.includes(`line 2 of ${id}`),
		"the landing paints in the mount's commit, from cache",
	);
	await quiet(5);
	assert.equal(
		readsOf(app, id),
		before,
		"the open waited on no messages read: the timeline adopted the warm entry",
	);
}

test("default landing: the watcher warms #general before the click and the page paints it from cache", async () => {
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => scenario(fixture),
	});
	try {
		await until(
			() => readsOf(app, "gen_org_shared") === 1,
			"the landing conversation is read in the background",
		);
		assert.equal(
			historyReads(app)[0].conversation_id,
			"gen_org_shared",
			"the landing goes first",
		);
		await quiet();
		await opensFromCache(app, "gen_org_shared");
	} finally {
		await app.close();
	}
});

test("remembered landing: the remembered conversation is warmed first and the page lands on it from cache", async () => {
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture);
			remember({
				target: { type: "conversation", id: "launch_shared" },
				tenantId: "org_shared",
			});
		},
	});
	try {
		await until(
			() => readsOf(app, "launch_shared") === 1,
			"the remembered conversation is read in the background",
		);
		assert.equal(historyReads(app)[0].conversation_id, "launch_shared");
		await quiet();
		await opensFromCache(app, "launch_shared");
	} finally {
		await app.close();
	}
});

test("bounded: three reads per list change (landing + two most recent), none for an unchanged list", async () => {
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => scenario(fixture),
	});
	try {
		await until(() => historyReads(app).length === 3, "the warm");
		await quiet();
		assert.deepEqual(
			historyReads(app).map((call) => call.conversation_id),
			["gen_org_shared", "recent_1", "recent_2"],
			"the landing, then the most recently active rows; nothing past the cap",
		);
		// The watcher's poll answers again with the same rows.
		await act(async () =>
			app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.conversationsPrefix,
			}),
		);
		await quiet();
		assert.equal(
			historyReads(app).length,
			3,
			"an unchanged list warms nothing",
		);
		// The KEY is what holds that, not only the cold-only rule: with the
		// landing's entry gone (the retention sweep, say), an unchanged list
		// still re-reads nothing...
		const landingKey = ui.teamBridgeKeys.messages(
			"gen_org_shared",
			"org_shared",
			"acct_a",
		);
		app.client.removeQueries({ queryKey: landingKey, exact: true });
		await act(async () =>
			app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.conversationsPrefix,
			}),
		);
		await quiet();
		assert.equal(readsOf(app, "gen_org_shared"), 1, "same id + latest_seq");
		// ...while a moved `latest_seq` is a change, and the cold entry is read.
		app.fixture.listFor = () => ({
			conversations: ROWS.map((entry) =>
				entry.id === "gen_org_shared" ? { ...entry, latest_seq: 3 } : entry,
			),
		});
		await act(async () =>
			app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.conversationsPrefix,
			}),
		);
		await until(() => readsOf(app, "gen_org_shared") === 2, "re-warmed");
		await quiet();
		assert.equal(historyReads(app).length, 4, "only the cold one");
	} finally {
		await app.close();
	}
});

test("a 429 on the background warm holds every further warm for the account", async () => {
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			// Two rows, so the warm is landing + one: concurrency 3 sends both.
			scenario(fixture, ROWS.slice(0, 2));
			fixture.rateLimited.add("gen_org_shared");
		},
	});
	try {
		await until(() => historyReads(app).length === 2, "the warm");
		await quiet();
		// A changed list (a new row) would normally warm the new row.
		const grown = [...ROWS.slice(0, 2), row("fresh_row", 59)];
		app.fixture.listFor = () => ({ conversations: grown });
		app.fixture.historyByConversation.set("fresh_row", [msg("fresh_row", 1)]);
		await act(async () =>
			app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.conversationsPrefix,
			}),
		);
		await quiet();
		assert.equal(readsOf(app, "fresh_row"), 0, "held: no warm after a 429");
		assert.equal(readsOf(app, "gen_org_shared"), 1, "and no retry of the 429");
		// Control: the hold is the only thing stopping it.
		ui.resetTeamBridgePrefetch(app.client);
		app.fixture.listFor = () => ({
			conversations: grown.map((entry) => ({ ...entry, latest_seq: 3 })),
		});
		await act(async () =>
			app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.conversationsPrefix,
			}),
		);
		await until(() => readsOf(app, "fresh_row") === 1, "unheld, it warms");
	} finally {
		ui.resetTeamBridgePrefetch(app.client);
		await app.close();
	}
});

test("not_a_member on the background warm stays silent: one read, no retry, no toast", async () => {
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture, ROWS.slice(0, 1));
			fixture.notAMember.add("gen_org_shared");
		},
	});
	try {
		await until(() => readsOf(app, "gen_org_shared") === 1, "the warm");
		// Longer than the history retry's first backoff would be.
		await quiet(40);
		assert.equal(readsOf(app, "gen_org_shared"), 1, "never retried");
		assert.deepEqual(ui.toasts, [], "nothing is surfaced from a guess");
	} finally {
		await app.close();
	}
});

test("account switch while the warm is out: fenced, never retried; the return warms at once", async () => {
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture, ROWS.slice(0, 1));
			fixture.historyGate = deferred();
		},
	});
	const readsFor = (owner) =>
		historyReads(app, (call) => call.owner === owner).length;
	try {
		await until(() => readsFor("acct_a") === 1, "A's warm is out (held)");
		await app.changeAuth("acct_b");
		await act(async () => app.fixture.historyGate.resolve());
		app.fixture.historyGate = null;
		await until(() => readsFor("acct_b") === 1, "B gets its own warm");
		await quiet(40);
		assert.equal(readsFor("acct_a"), 1, "A's fenced read is not retried");
		assert.equal(
			app.client.getQueryData(
				ui.teamBridgeKeys.messages("gen_org_shared", "org_shared", "acct_b"),
			)?.messages?.length,
			2,
			"B's warm landed under B's key",
		);
		await app.changeAuth("acct_a");
		await until(
			() => readsFor("acct_a") === 2,
			"back on A, the landing is warmed again at once",
		);
		await quiet();
		await opensFromCache(app, "gen_org_shared");
	} finally {
		await app.close();
	}
});

test("off: with Team Bridge switched off on this machine the watcher reads no history", async () => {
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture);
			fixture.enabled = false;
		},
	});
	try {
		await until(
			() => app.fixture.calls.some((call) => call.op === "team_bridge.status"),
			"the status read answered",
		);
		await quiet(20);
		assert.equal(historyReads(app).length, 0);
	} finally {
		await app.close();
	}
});
