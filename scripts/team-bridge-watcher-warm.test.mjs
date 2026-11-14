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
 *
 * Review round 1 on ui#1917 added:
 * - R1/R4: every remembered target type resolves as the page resolves it
 *   (`targetConversation`): person, chief and one-recipient draft -> their DM;
 *   a person with no DM and an Archived-view conversation -> no landing warm;
 *   a stale record tenant does not matter (id alone).
 * - R2: a warm landing collected by React Query's GC is warmed again, once;
 *   an extra is not; a refused re-warm does not loop; nothing while off.
 * - R3/Q1 (per-tenant unread drives the `latest_seq` refresh): an unopened
 *   warm extra is not refreshed, the landing is; a row warmed because of a
 *   new message is read once.
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

const ARCHIVED_VIEW_LISTS_ARCH_1 = /Archived channels\s*arch_1/;

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

/* What React Query's GC timer does when it fires (`Removable.scheduleGc` ->
   `Query.optionalRemove`), without waiting the 30 minutes: remove an entry
   nobody observes and nothing is fetching. */
async function gc(app, id) {
	await act(async () => {
		const query = app.client.getQueryCache().find({
			queryKey: ui.teamBridgeKeys.messages(id, "org_shared", "acct_a"),
			exact: true,
		});
		assert.ok(query, `${id} has an entry to collect`);
		query.optionalRemove();
	});
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

/* REMEMBERED TARGETS OTHER THAN A CONVERSATION (review R1/R4 on ui#1917). The
   page resolves the remembered target with `targetConversation`: a person or
   chief is their DM, a one-recipient draft is that DM. The warm must land on
   the same row, or it spends its landing slot on #general while the open waits
   on the DM's cold read. */
const human = (id) => ({ ...person(id), kind: "human" });
const agent = (owner) => ({
	account_id: owner,
	kind: "agent",
	display_label: `${owner}'s chief`,
	state: "active",
	role: "member",
});
const dmRow = (id, members) =>
	row(id, 5, { kind: "dm", name: id, visibility: "private", members });
const DM_PERSON = dmRow("dm_b", [human("acct_a"), human("acct_b")]);
const DM_CHIEF = dmRow("dm_chief", [human("acct_a"), agent("acct_c")]);
const DM_ROWS = [...ROWS, DM_PERSON, DM_CHIEF];

/* The page opens on `id` (painted in the mount's commit) and reads it no
   further; selection is not asserted for a DM, whose rail row is the person. */
async function paintsFromCache(app, id) {
	const before = readsOf(app, id);
	await app.back();
	assert.ok(
		app.host.textContent.includes(`line 2 of ${id}`),
		`${id} paints in the mount's commit, from cache`,
	);
	await quiet(5);
	assert.equal(readsOf(app, id), before, `the open waited on no read of ${id}`);
}

for (const [label, target, dm] of [
	["person", { type: "person", accountId: "acct_b" }, "dm_b"],
	["chief", { type: "chief", accountId: "acct_c" }, "dm_chief"],
	[
		"one-recipient draft",
		{
			type: "compose",
			recipients: [{ kind: "human", accountId: "acct_b", label: "acct_b" }],
		},
		"dm_b",
	],
]) {
	test(`remembered ${label} target: the warm lands on the DM the page opens, not #general`, async () => {
		const app = await mount({
			watcher: true,
			lifecycle: [],
			path: "/team-bridge",
			waitReady: false,
			seed: ({ fixture }) => {
				scenario(fixture, DM_ROWS);
				// The page's restore validation keeps a person/chief target only
				// while the organization's directory still lists them.
				fixture.directoryMembers = ["acct_b", "acct_c"].map((id) => ({
					account_id: id,
					display_label: id,
					role: "member",
					bridge_enabled: true,
					bridge_state: "active",
				}));
				remember({ target, tenantId: null });
			},
		});
		try {
			await until(() => readsOf(app, dm) === 1, `${dm} is warmed`);
			assert.equal(historyReads(app)[0].conversation_id, dm, "landing first");
			assert.equal(readsOf(app, "gen_org_shared"), 0, "#general is not it");
			await quiet();
			await paintsFromCache(app, dm);
		} finally {
			await app.close();
		}
	});
}

test("remembered person with no DM yet: no landing warm (the page shows an empty DM), only the next likely clicks", async () => {
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture);
			// Still in the directory, so the page keeps the target (an empty DM).
			fixture.directoryMembers = [
				{
					account_id: "acct_z",
					display_label: "acct_z",
					role: "member",
					bridge_enabled: true,
					bridge_state: "active",
				},
			];
			remember({
				target: { type: "person", accountId: "acct_z" },
				tenantId: null,
			});
		},
	});
	try {
		await until(() => historyReads(app).length === 3, "the warm");
		await quiet();
		assert.deepEqual(
			historyReads(app).map((call) => call.conversation_id),
			["recent_1", "recent_2", "recent_3"],
			"no read is spent on #general, which the page does not show",
		);
		// The page's outcome: the person stays selected, no conversation is.
		await app.back();
		await quiet(20);
		assert.equal(selected(app), null, "the page lands on no conversation row");
	} finally {
		await app.close();
	}
});

test("remembered conversation with a stale tenant (R4): matched on id alone, like the page", async () => {
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture);
			remember({
				target: { type: "conversation", id: "launch_shared" },
				tenantId: "org_gone",
			});
		},
	});
	try {
		await until(() => readsOf(app, "launch_shared") === 1, "warmed");
		assert.equal(historyReads(app)[0].conversation_id, "launch_shared");
		await quiet();
		await opensFromCache(app, "launch_shared");
	} finally {
		await app.close();
	}
});

test("remembered archived conversation (Archived view): no landing warm; the page reopens the Archived view and reads arch_1 itself", async () => {
	const archived = row("arch_1", 1, { status: "archived" });
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture);
			fixture.listFor = (request) => ({
				conversations: request.status === "archived" ? [archived] : ROWS,
			});
			fixture.historyByConversation.set("arch_1", [
				msg("arch_1", 1),
				msg("arch_1", 2),
			]);
			remember({
				target: { type: "conversation", id: "arch_1" },
				tenantId: "org_shared",
				quickView: "archived",
			});
		},
	});
	try {
		await until(() => historyReads(app).length === 3, "the warm");
		await quiet();
		assert.equal(readsOf(app, "gen_org_shared"), 0, "#general is not shown");
		assert.equal(
			readsOf(app, "arch_1"),
			0,
			"the watcher holds no archived list",
		);
		await app.back();
		await until(() => readsOf(app, "arch_1") === 1, "the page reads arch_1");
		// What the page shows is the Archived channels view, not #general.
		await until(
			() => ARCHIVED_VIEW_LISTS_ARCH_1.test(app.host.textContent),
			"the Archived view lists arch_1",
		);
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
		// R2 (ui#1917): the landing's warm entry has no observer, so React Query
		// collects it after TEAM_BRIDGE_HISTORY_GC_MS. Collected, it is warmed
		// again - once - so a return after a quiet half hour still opens from
		// cache.
		await gc(app, "gen_org_shared");
		await until(() => readsOf(app, "gen_org_shared") === 2, "re-warmed");
		await quiet();
		assert.equal(historyReads(app).length, 4, "only the landing");
		await opensFromCache(app, "gen_org_shared");
		await app.leave();
		// An extra slot is a guess: collected, it stays cold...
		await gc(app, "recent_1");
		await quiet();
		assert.equal(
			readsOf(app, "recent_1"),
			1,
			"a collected extra is not re-read",
		);
		// ...until the list moves it, which is a change like any other.
		app.fixture.listFor = () => ({
			conversations: ROWS.map((entry) =>
				entry.id === "recent_1" ? { ...entry, latest_seq: 3 } : entry,
			),
		});
		await act(async () =>
			app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.conversationsPrefix,
			}),
		);
		await until(() => readsOf(app, "recent_1") === 2, "re-warmed on change");
		await quiet();
		assert.equal(
			readsOf(app, "gen_org_shared"),
			2,
			"the landing is not re-read",
		);
	} finally {
		await app.close();
	}
});

for (const [label, refuse] of [
	["not_a_member", (fixture) => fixture.notAMember.add("gen_org_shared")],
	["429", (fixture) => fixture.rateLimited.add("gen_org_shared")],
]) {
	test(`R2 re-warm refused (${label}): one read, and its own collection re-warms nothing (no loop)`, async () => {
		const app = await mount({
			watcher: true,
			lifecycle: [],
			path: "/team-bridge",
			waitReady: false,
			seed: ({ fixture }) => scenario(fixture, ROWS.slice(0, 1)),
		});
		try {
			await until(() => readsOf(app, "gen_org_shared") === 1, "the warm");
			await quiet();
			refuse(app.fixture);
			await gc(app, "gen_org_shared");
			await until(() => readsOf(app, "gen_org_shared") === 2, "the re-warm");
			await quiet(40);
			assert.equal(readsOf(app, "gen_org_shared"), 2, "not retried");
			// The refused entry holds no data; collecting it is not a re-warm.
			await gc(app, "gen_org_shared");
			await quiet(40);
			assert.equal(readsOf(app, "gen_org_shared"), 2, "no loop");
			assert.deepEqual(ui.toasts, [], "nothing surfaced");
		} finally {
			ui.resetTeamBridgePrefetch(app.client);
			await app.close();
		}
	});
}

test("R2 re-warm is off with the watcher: collected while Team Bridge is switched off, nothing is read", async () => {
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => scenario(fixture, ROWS.slice(0, 1)),
	});
	try {
		await until(() => readsOf(app, "gen_org_shared") === 1, "the warm");
		await quiet();
		app.fixture.enabled = false;
		await act(async () =>
			app.client.invalidateQueries({ queryKey: ui.teamBridgeKeys.status }),
		);
		await quiet(20);
		await gc(app, "gen_org_shared");
		await quiet(40);
		assert.equal(readsOf(app, "gen_org_shared"), 1, "inactive: no re-warm");
	} finally {
		await app.close();
	}
});

/* The watcher's `latest_seq` refresh, driven through per-tenant unread rows.
   `rows` is mutable: a "new message" moves a row's `latest_seq` (read on both
   the list and the unread answer) and adds that message to its history. Read
   by the reader already (last_read_seq = latest_seq), so no banner reads. */
function withUnread(fixture, rows) {
	fixture.listFor = (request) => ({
		conversations: request.status === "archived" ? [] : rows,
	});
	fixture.unreadFor = (request) =>
		request.tenant_id
			? {
					total: 0,
					conversations: rows.map((entry) => ({
						conversation_id: entry.id,
						unread_count: 0,
						last_read_seq: entry.latest_seq,
						latest_seq: entry.latest_seq,
						muted: false,
					})),
				}
			: {
					total: 0,
					organizations: [
						{
							tenant_id: "org_shared",
							tenant_name: "Shared",
							// Above 0, or the watcher never reads the tenant's rows
							// (`teamBridgeNotifyOrganizations`).
							unread: 1,
							eligible: true,
						},
					],
				};
}
async function newMessage(app, rows, id, minute) {
	const at = rows.findIndex((entry) => entry.id === id);
	rows[at] = row(id, minute, { ...rows[at], latest_seq: 3 });
	rows[at].last_message_at =
		`2026-11-13T12:${String(minute).padStart(2, "0")}:00Z`;
	app.fixture.historyByConversation.set(id, [
		msg(id, 1),
		msg(id, 2),
		msg(id, 3),
	]);
	await act(async () => {
		await app.client.invalidateQueries({
			queryKey: ui.teamBridgeKeys.unreadPrefix,
		});
		await app.client.invalidateQueries({
			queryKey: ui.teamBridgeKeys.conversationsPrefix,
		});
	});
}

test("Q1: a row warmed BECAUSE of a new message is read once, not warmed and then refreshed", async () => {
	const rows = [...ROWS];
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture, rows);
			withUnread(fixture, rows);
		},
	});
	try {
		await until(() => historyReads(app).length === 3, "the warm");
		await quiet(20);
		// recent_4 was cold and below the cap; its new message makes it the top.
		await newMessage(app, rows, "recent_4", 59);
		await until(() => readsOf(app, "recent_4") >= 1, "warmed with seq 3");
		await quiet(40);
		await act(async () =>
			app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.unreadPrefix,
			}),
		);
		await quiet(40);
		assert.equal(readsOf(app, "recent_4"), 1, "the warm already carried seq 3");
	} finally {
		await app.close();
	}
});

test("R3: only the landing (and visited conversations) are refreshed on a new message; an unopened warm extra is not", async () => {
	const rows = [...ROWS];
	const app = await mount({
		watcher: true,
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture, rows);
			withUnread(fixture, rows);
		},
	});
	try {
		await until(() => historyReads(app).length === 3, "the warm");
		await quiet(20);
		// recent_1 is a warm extra (never opened); #general is the landing.
		await newMessage(app, rows, "recent_1", 51);
		await newMessage(app, rows, "gen_org_shared", 0);
		await until(
			() => readsOf(app, "gen_org_shared") === 2,
			"the landing is refreshed (control: the refresh path runs)",
		);
		await quiet(40);
		assert.equal(readsOf(app, "recent_1"), 1, "the unopened extra is not");
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
