/**
 * FIRST OPEN READS THE LANDING CONVERSATION ALONGSIDE THE LIST
 * (bridge-instant-load; operator: "The whole thing should load in under 300ms").
 *
 *     node --test scripts/team-bridge-first-open.test.mjs
 *
 * THE MEASURED FAILURE. The instant-load bench (ui#1889, QA r4) opened Team
 * Bridge cold in 331.6 ms against the 300 ms bar: the timeline's history read
 * waits for `selected`, which resolves from the LOADED list, so the list read
 * (~200 ms) and the first history read (~150 ms) ran back to back - even when
 * the page knew at mount which conversation it would land on.
 *
 * Asserted here, through the shipped page (container, hooks, React Query, the
 * owner fence) with only the preload transport faked
 * (`fixtures/team-bridge-auth-owner-page.mjs`). The list read is HELD open with
 * `fixture.listGate`, so "before the list answers" is a fact, not a race:
 *
 * 1. A remembered conversation (with its tenant) starts its history read while
 *    the list is held, and the timeline renders from that entry with no second
 *    request once the list answers. (Fails on the pre-change page.)
 * 2. A conversation already in cache is not read again.
 * 3. A remembered conversation the list no longer holds is never shown, a
 *    `not_a_member` refusal on the parallel read stays silent and is not
 *    retried, and the landing falls back as before.
 * 4. An account switch mid-flight discards the read: the fence refuses it and
 *    nothing is shown to the next account.
 * 5. GUARD (passes on the pre-change page too): with no target, a cached list's
 *    default row is read alongside the list - by the landing effect and the
 *    timeline's own read, not by `prefetchTeamBridgeLanding` (ui#1895 R1).
 * 6. Nothing cached and nothing remembered: no read before the list answers.
 * 7. A deep link / notification click (`?conversation=&tenant=`) reads in
 *    parallel too (ui#1895 R2).
 * 8. A→B→A: the read the fence discarded on the way out leaves no backoff
 *    chain behind, so the return reads at once (ui#1895 QA Q1; fails on
 *    d38b2ab8, where the return waited ~1 s for the discarded read's retry).
 * 9. A cached status answer is enough to start the list: a status REFETCH in
 *    flight does not hold it (ui#1895 Q3; a guard, passes before this change).
 * 10. A 429 on the parallel read holds the next open's parallel read
 *    (ui#1895 R2). Last in the file: the hold lives on the shared client.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
process.env.TEAM_BRIDGE_PLAIN_MENUS = "1";
const { deferred, delay, mount, ui, until } = await import(
	"./fixtures/team-bridge-auth-owner-page.mjs"
);

const now = "2026-11-13T12:00:00Z";
const person = (id) => ({
	account_id: id,
	kind: "human",
	display_label: id,
	state: "active",
	role: "member",
});
const row = (id, tenant, patch = {}) => ({
	id,
	tenant_id: tenant,
	kind: "channel",
	name: id,
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: "acct_a",
	last_message_at: now,
	latest_seq: 2,
	members: [person("acct_a")],
	member: true,
	last_read_seq: 2,
	unread_count: 0,
	muted: false,
	...patch,
});
const ROWS = [
	row("gen_org_shared", "org_shared", { name: "general", builtin: "general" }),
	row("launch_shared", "org_shared", { name: "launch" }),
];
const msg = (conversation, seq) => ({
	id: `msg_${conversation}_${seq}`,
	conversation_id: conversation,
	seq,
	sender: person("acct_b"),
	body: `line ${seq} of ${conversation}`,
	origin: "human",
	created_at: now,
});
const ERROR_COPY = /could not be loaded|not open to you|unavailable/i;

/* Every conversation has history, including ones the list no longer holds. */
function scenario(fixture, rows = ROWS) {
	fixture.listFor = (request) => ({
		conversations: request.status === "archived" ? [] : rows,
	});
	for (const id of ["gen_org_shared", "launch_shared"])
		fixture.historyByConversation.set(id, [msg(id, 1), msg(id, 2)]);
	fixture.listGate = deferred();
}

/* The record a build with this change writes when the reader leaves #launch. */
function remember(view) {
	localStorage.setItem(
		"lo.teamBridge.view.v1",
		JSON.stringify({
			acct_a: { scope: "org_shared", scopes: { org_shared: view } },
		}),
	);
}
const LAUNCH = {
	target: { type: "conversation", id: "launch_shared" },
	tenantId: "org_shared",
};

const historyReads = (app, id) =>
	app.fixture.calls.filter(
		(call) =>
			call.op === "team_bridge.messages.list" &&
			call.conversation_id === id &&
			// The transport records each call twice: once on entry (with `owner`)
			// and once with its cursor. Count the entry, which is the request.
			call.owner !== undefined,
	);
const listReads = (app) =>
	app.fixture.calls.filter(
		(call) => call.op === "team_bridge.conversations.list",
	);

/* The gate and scope have answered, so the list request is out and HELD. */
async function untilListHeld(app) {
	await until(() => listReads(app).length > 0, "the list read is out");
	// Let every effect that could start a read run while the list is still held.
	for (let i = 0; i < 5; i++) await delay();
}

const selected = (app) =>
	app.host
		.querySelector('[aria-current="page"][data-conversation-id]')
		?.getAttribute("data-conversation-id") ?? null;

test("a remembered conversation reads its history while the list is still loading, once", async () => {
	const app = await mount({
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture);
			remember(LAUNCH);
		},
	});
	try {
		await untilListHeld(app);
		assert.equal(
			historyReads(app, "launch_shared").length,
			1,
			"the landing conversation's first page is requested before the list answers",
		);
		assert.equal(
			app.host.textContent.includes("line 2 of launch_shared"),
			false,
			"nothing is shown before the list confirms the selection",
		);
		await act(async () => app.fixture.listGate.resolve());
		await until(
			() => app.host.textContent.includes("line 2 of launch_shared"),
			"the timeline renders the landing conversation",
		);
		await delay();
		assert.equal(selected(app), "launch_shared");
		assert.equal(
			historyReads(app, "launch_shared").length,
			1,
			"the timeline adopted the parallel read: no second request",
		);
	} finally {
		await app.close();
	}
});

test("a remembered conversation already in cache is not read again", async () => {
	const app = await mount({
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ client, fixture }) => {
			scenario(fixture);
			remember(LAUNCH);
			client.setQueryData(
				ui.teamBridgeKeys.messages("launch_shared", "org_shared", "acct_a"),
				{
					messages: [msg("launch_shared", 1), msg("launch_shared", 2)],
					oldestSeq: 1,
					hasOlder: false,
				},
			);
		},
	});
	try {
		await untilListHeld(app);
		assert.equal(
			historyReads(app, "launch_shared").length,
			0,
			"a warm entry costs no read",
		);
	} finally {
		await app.close();
	}
});

test("a remembered conversation the list no longer holds is never shown, and a refusal stays silent", async () => {
	const app = await mount({
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			// Removed from #launch: the list answers without it, and its history
			// read is refused with the hub's typed 403.
			scenario(fixture, [ROWS[0]]);
			fixture.notAMember.add("launch_shared");
			remember(LAUNCH);
		},
	});
	try {
		await untilListHeld(app);
		assert.equal(
			historyReads(app, "launch_shared").length,
			1,
			"the parallel read went out",
		);
		await act(async () => app.fixture.listGate.resolve());
		await until(
			() => selected(app) === "gen_org_shared",
			"the landing falls back to #general",
		);
		await until(
			() => app.host.textContent.includes("line 2 of gen_org_shared"),
			"the fallback renders",
		);
		for (let i = 0; i < 10; i++) await delay();
		assert.ok(
			app.frames.every((frame) => !frame.text.includes("of launch_shared")),
			"no committed frame ever showed the removed conversation",
		);
		assert.equal(ERROR_COPY.test(app.host.textContent), false, "no error UI");
		assert.equal(
			historyReads(app, "launch_shared").length,
			1,
			"the refusal is not retried",
		);
		assert.equal(
			app.client.getQueryState(
				ui.teamBridgeKeys.messages("launch_shared", "org_shared", "acct_a"),
			),
			undefined,
			"the refused, unadopted entry is dropped rather than left in error",
		);
	} finally {
		await app.close();
	}
});

test("an account switch while the parallel read is in flight discards it", async () => {
	const history = deferred();
	const app = await mount({
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture);
			fixture.historyGate = history;
			remember(LAUNCH);
		},
	});
	try {
		await untilListHeld(app);
		assert.equal(historyReads(app, "launch_shared").length, 1);
		await app.changeAuth("acct_b");
		await act(async () => history.resolve());
		await act(async () => app.fixture.listGate.resolve());
		for (let i = 0; i < 10; i++) await delay();
		assert.equal(
			app.client.getQueryData(
				ui.teamBridgeKeys.messages("launch_shared", "org_shared", "acct_a"),
			),
			undefined,
			"the owner fence refused the late answer: account A's entry holds nothing",
		);
		assert.ok(
			app.frames
				.filter((frame) => frame.auth === "acct_b")
				.every((frame) => !frame.text.includes("of launch_shared")),
			"account B never sees account A's landing conversation",
		);
	} finally {
		await app.close();
	}
});

/* GUARD, not a speed-up this change makes: the landing effect sets `target`
   from the cached snapshot in its first flush, so the timeline reads the default
   row while the list is held on the pre-change page as well (ui#1895 R1). */
test("guard: with no target, a cached list's default row is read alongside the list", async () => {
	const app = await mount({
		lifecycle: [],
		path: "/team-bridge?tenant=org_shared",
		waitReady: false,
		seed: ({ client, fixture }) => {
			scenario(fixture);
			// Exactly what the shell's notification watcher leaves for this account.
			client.setQueryData(ui.teamBridgeKeys.conversations("all", "acct_a"), {
				conversations: ROWS,
				has_more: false,
			});
		},
	});
	try {
		await untilListHeld(app);
		assert.equal(
			historyReads(app, "gen_org_shared").length,
			1,
			"the default landing row's history is requested before the list answers",
		);
		await act(async () => app.fixture.listGate.resolve());
		await until(
			() => app.host.textContent.includes("line 2 of gen_org_shared"),
			"the timeline renders",
		);
		await delay();
		assert.equal(historyReads(app, "gen_org_shared").length, 1, "read once");
	} finally {
		await app.close();
	}
});

test("nothing cached and nothing remembered: no history read before the list answers", async () => {
	const app = await mount({
		lifecycle: [],
		path: "/team-bridge?tenant=org_shared",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture);
			// A record from a build that did not store the tenant: no parallel read.
			remember({ target: { type: "conversation", id: "launch_shared" } });
		},
	});
	try {
		await untilListHeld(app);
		assert.equal(
			app.fixture.calls.filter(
				(call) => call.op === "team_bridge.messages.list",
			).length,
			0,
			"no read is started without a known tenant",
		);
		await act(async () => app.fixture.listGate.resolve());
		await until(
			() => app.host.textContent.includes("line 2 of launch_shared"),
			"the open lands as before, once the list answers",
		);
		assert.equal(historyReads(app, "launch_shared").length, 1);
		// Going forward the record carries the tenant, read from the confirmed row.
		await app.leave();
		const view = JSON.parse(localStorage.getItem("lo.teamBridge.view.v1"))
			.acct_a.scopes.org_shared;
		assert.deepEqual(view.target, {
			type: "conversation",
			id: "launch_shared",
		});
		assert.equal(view.tenantId, "org_shared");
	} finally {
		await app.close();
	}
});

test("a deep link names its conversation and tenant: history is read alongside the list", async () => {
	const app = await mount({
		lifecycle: [],
		path: "/team-bridge?conversation=launch_shared&tenant=org_shared",
		waitReady: false,
		seed: ({ fixture }) => scenario(fixture),
	});
	try {
		await untilListHeld(app);
		assert.equal(
			historyReads(app, "launch_shared").length,
			1,
			"the linked conversation's first page is requested before the list answers",
		);
		await act(async () => app.fixture.listGate.resolve());
		await until(
			() => app.host.textContent.includes("line 2 of launch_shared"),
			"the timeline renders the linked conversation",
		);
		await delay();
		assert.equal(selected(app), "launch_shared");
		assert.equal(historyReads(app, "launch_shared").length, 1, "read once");
	} finally {
		await app.close();
	}
});

test("A→B→A: the return reads the landing conversation at once, not on a discarded read's backoff", async () => {
	const history = deferred();
	const app = await mount({
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture);
			fixture.historyGate = history;
			remember(LAUNCH);
		},
	});
	try {
		await untilListHeld(app);
		assert.equal(historyReads(app, "launch_shared").length, 1);
		await app.changeAuth("acct_b");
		// A's read answers after the switch: the owner fence refuses it.
		await act(async () => history.resolve());
		for (let i = 0; i < 5; i++) await delay();
		const back = performance.now();
		await app.changeAuth("acct_a");
		await until(
			() => historyReads(app, "launch_shared").length >= 2,
			"the return to A requests the landing conversation",
		);
		const waited = performance.now() - back;
		// The retry backoff starts at 1000 ms (`historyReadRetryDelay`); joining
		// the discarded read's chain cannot answer sooner than that.
		assert.ok(
			waited < 500,
			`the return's history request left ${waited.toFixed(1)} ms after returning (a joined retry chain waits >= 1000 ms)`,
		);
		// Only the history request is timed. The LIST read here was held across
		// the whole A→B→A trip, so its own fence refusal and default retry (a
		// pre-existing path this change does not touch) decide when A renders.
		await act(async () => app.fixture.listGate.resolve());
		await until(
			() => app.host.textContent.includes("line 2 of launch_shared"),
			"account A lands on its conversation",
		);
	} finally {
		await app.close();
	}
});

test("guard: a cached status answer starts the list while its refetch is still in flight", async () => {
	const statusGate = deferred();
	const app = await mount({
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		statusGate,
		seed: ({ client, fixture }) => {
			scenario(fixture);
			remember(LAUNCH);
			// What the shell's notification watcher (useTeamBridgeNotifications)
			// leaves under the same `statusFor` key, older than its 60 s staleTime.
			client.setQueryData(
				ui.teamBridgeKeys.statusFor("acct_a"),
				{
					capability: 1,
					state: "ready",
					read_only: false,
					account_id: "acct_a",
					tenant_id: "org_shared",
					surface_state: "D",
					visibility: {
						settings: true,
						inbox: true,
						account_door: true,
						onboarding: false,
					},
					update_required: false,
					local: { enabled: true, onboarding: "done", session: "present" },
					status: {
						tenants: [
							{
								tenant_id: "org_shared",
								tenant_name: "Shared",
								eligible: true,
								endpoint: null,
							},
							{
								tenant_id: "org_other",
								tenant_name: "Other",
								eligible: true,
								endpoint: null,
							},
						],
					},
					consent: null,
					error: null,
				},
				{ updatedAt: Date.now() - 120_000 },
			);
		},
	});
	try {
		await untilListHeld(app);
		assert.equal(
			app.client.getQueryState(ui.teamBridgeKeys.statusFor("acct_a"))
				?.fetchStatus,
			"fetching",
			"the stale status is being refetched (held)",
		);
		assert.equal(
			historyReads(app, "launch_shared").length,
			1,
			"and the landing read is out alongside the list",
		);
	} finally {
		await app.close();
	}
});

test("a 429 on the parallel read holds the next open's parallel read", async () => {
	const key = ui.teamBridgeKeys.messages(
		"launch_shared",
		"org_shared",
		"acct_a",
	);
	const app = await mount({
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			scenario(fixture);
			fixture.rateLimited.add("launch_shared");
			remember(LAUNCH);
		},
	});
	try {
		await untilListHeld(app);
		assert.equal(historyReads(app, "launch_shared").length, 1);
		await until(
			() => app.client.getQueryState(key) === undefined,
			"the rate-limited, unadopted entry is dropped (and the hold set)",
		);
		app.fixture.rateLimited.delete("launch_shared");
		// Leave and come back while the list is still held: a fresh open.
		await app.leave();
		await app.back();
		for (let i = 0; i < 5; i++) await delay();
		assert.equal(
			historyReads(app, "launch_shared").length,
			1,
			"under the hold the next open starts no parallel read",
		);
		// Control: the hold is the only thing stopping it.
		ui.resetTeamBridgePrefetch(app.client);
		await app.leave();
		await app.back();
		await until(
			() => historyReads(app, "launch_shared").length === 2,
			"without the hold the same open reads in parallel",
		);
	} finally {
		ui.resetTeamBridgePrefetch(app.client);
		await app.close();
	}
});
