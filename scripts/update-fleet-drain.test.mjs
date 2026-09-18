import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The fleet gate's own rules, contract-checked against the shipped TypeScript.
 *
 * WHY THESE CASES EXIST. The desktop app's update path said the quiet part out
 * loud: "a turn that is in flight is dropped while the server comes back", and on
 * 2026-09-18 this machine lost 25 session runtimes mid-turn across four backend
 * generations. The rule that replaces it is the one the host tool
 * (`~/tools/lop-fleet-update`) already applies by hand - wait for the fleet to go
 * quiet, and put back what a move displaced - so what is pinned here is the
 * gate's own arithmetic: a bound that ends in a REFUSAL naming the sessions it
 * waited for, a wait that never restarts under work the app could not see, and a
 * re-engage that engages one at a time and reports what did not come back.
 *
 * The module is bundled in memory from the shipped TypeScript, the same way the
 * other update tests do, so these stay tests of the code that ships rather than
 * of a copy of it. Nothing here touches a real backend: `readWorkState`,
 * `readRoster`, `engage`, `sleep` and `now` are all injected, which is why the
 * gate's timing can be asserted exactly rather than measured.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/backend/fleet-drain"; export * from "./src/main/backend-version-drift";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const gate = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);
const {
	FLEET_DRAIN_BUDGET_MS,
	FLEET_DRAIN_POLL_MS,
	busyRosterRows,
	displacedSessions,
	fleetDrainRefusalSentence,
	fleetRosterFromSessions,
	reengageDisplacedSessions,
	servingWorkStateFromSessions,
	waitForFleetIdle,
} = gate;

/** A roster body in the route's own wire shape. */
const body = (rows) => ({ result: { sessions: rows } });

const row = (id, live_state, extra = {}) => ({
	id,
	name: `session ${id}`,
	kind: "tui",
	live_state,
	...extra,
});

/**
 * A clock and a sleeper that only move when somebody waits.
 *
 * Both are injected so a case can assert the WAIT ITSELF - how many polls it
 * took, and how much of the budget was spent - rather than how long the test
 * happened to run.
 */
const clock = () => {
	let now = 0;
	const sleeps = [];
	return {
		now: () => now,
		sleep: async (ms) => {
			sleeps.push(ms);
			now += ms;
		},
		sleeps,
	};
};

test("the busy spelling is the roster's own, shared with the version-drift gate", () => {
	/*
	 * ONE parse, two readers. The drift gate asks the roster for a verdict, the
	 * fleet gate asks it for names and before/after pairs, and a second spelling of
	 * `live_state === "busy"` would be a second answer to the same question.
	 */
	const rows = fleetRosterFromSessions(
		body([
			row("aaaaaaaaaaa1", "busy", { name: "Working" }),
			row("bbbbbbbbbbb2", "idle"),
			/*
			 * `wedged` is somebody else's silence - a live pid that stopped
			 * reporting - and does NOT hold the gate: holding on it would make the
			 * repair inert forever (`servingWorkStateFromSessions`).
			 */
			row("ccccccccccc3", "wedged"),
		]),
	);
	assert.ok(rows);
	assert.deepEqual(
		busyRosterRows(rows).map((entry) => entry.sessionId),
		["aaaaaaaaaaa1"],
	);
	assert.equal(busyRosterRows(rows)[0].name, "Working");
	/*
	 * The verdict and the rows come from one parse and agree: this is the whole
	 * reason `fleetRosterFromSessions` exists rather than a second reader.
	 */
	assert.equal(
		servingWorkStateFromSessions(
			body([row("aaaaaaaaaaa1", "busy"), row("bbbbbbbbbbb2", "idle")]),
		),
		"busy",
	);
});

test("a roster that is not there is null, which is not an empty fleet", () => {
	/*
	 * A read that could not be taken and a machine with no sessions are different
	 * facts, and the gate's refusal says which one it met.
	 */
	assert.equal(fleetRosterFromSessions({ result: { sessions: null } }), null);
	assert.equal(fleetRosterFromSessions({}), null);
	assert.equal(fleetRosterFromSessions(null), null);
	assert.deepEqual(fleetRosterFromSessions(body([])), []);
	/*
	 * A row from a daemon that predates `live_state` carries null rather than a
	 * verdict, and no row anywhere carrying the field at all is the build fact the
	 * drift gate reads as `unknown` - never as idle.
	 */
	const old = fleetRosterFromSessions(
		body([{ id: "aaaaaaaaaaa1", name: "x" }]),
	);
	assert.ok(old);
	assert.equal(old[0].liveState, null);
	assert.equal(
		servingWorkStateFromSessions(body([{ id: "aaaaaaaaaaa1" }])),
		"unknown",
	);
});

test("an idle fleet is not waited on at all", async () => {
	const time = clock();
	const outcome = await waitForFleetIdle({
		readWorkState: async () => "idle",
		readRoster: async () =>
			fleetRosterFromSessions(body([row("aaaaaaaaaaa1", "idle")])),
		sleep: time.sleep,
		now: time.now,
	});
	assert.equal(outcome.kind, "drained");
	assert.deepEqual(
		time.sleeps,
		[],
		"the ordinary machine pays one round trip and no wait",
	);
});

test("a busy fleet is polled until it is idle, and the wait is reported", async () => {
	const time = clock();
	const states = ["busy", "busy", "idle"];
	const waits = [];
	const outcome = await waitForFleetIdle({
		readWorkState: async () => states.shift() ?? "idle",
		readRoster: async () => null,
		sleep: time.sleep,
		now: time.now,
		pollMs: 1000,
		onWait: (elapsedMs, state) => waits.push([elapsedMs, state]),
	});
	assert.equal(outcome.kind, "drained");
	assert.deepEqual(
		time.sleeps,
		[1000, 1000],
		"one poll per read that was not idle, no more",
	);
	assert.deepEqual(
		waits,
		[
			[0, "busy"],
			[1000, "busy"],
		],
		"the panel is told BEFORE the wait, including the first one",
	);
});

test("a fleet that will not drain is refused, with the sessions named", async () => {
	const time = clock();
	const busy = fleetRosterFromSessions(
		body([
			row("aaaaaaaaaaa1", "busy", { name: "Nightly enrichment" }),
			row("bbbbbbbbbbb2", "busy", { name: "Second turn" }),
		]),
	);
	assert.ok(busy);
	const outcome = await waitForFleetIdle({
		readWorkState: async () => "busy",
		readRoster: async () => busy,
		sleep: time.sleep,
		now: time.now,
		budgetMs: 3000,
		pollMs: 1000,
	});
	assert.equal(outcome.kind, "refused");
	assert.equal(outcome.because, "busy");
	assert.equal(outcome.waitedMs, 3000);
	assert.deepEqual(
		outcome.busy.map((entry) => entry.sessionId),
		["aaaaaaaaaaa1", "bbbbbbbbbbb2"],
	);
	/*
	 * THE WAIT IS BOUNDED, which is the whole difference from the drift gate: a
	 * press cannot defer to the next check, so it waits out a budget and then says
	 * so. The budget is spent as polls, never as one unbounded sleep.
	 */
	assert.deepEqual(time.sleeps, [1000, 1000, 1000]);
});

test("a read that could not be taken is waited on and then refused as such", async () => {
	const time = clock();
	const outcome = await waitForFleetIdle({
		readWorkState: async () => "unknown",
		readRoster: async () => null,
		sleep: time.sleep,
		now: time.now,
		budgetMs: 2000,
		pollMs: 1000,
	});
	/*
	 * NOT idle, and NOT an immediate refusal either: a read that could not be taken
	 * is not evidence that the machine is quiet (the rule `servingWorkState` states),
	 * and a daemon that is rotating answers again a moment later. What it may never
	 * do is proceed.
	 */
	assert.equal(outcome.kind, "refused");
	assert.equal(outcome.because, "unknown");
	assert.equal(outcome.waitedMs, 2000);
	assert.deepEqual(outcome.busy, []);
});

test("the refusal names the sessions and offers the by-hand route only when there is one", () => {
	const busy = fleetRosterFromSessions(
		body([
			row("aaaaaaaaaaa1", "busy", { name: "Nightly enrichment" }),
			row("bbbbbbbbbbb2", "busy", { name: "Second turn" }),
		]),
	);
	assert.ok(busy);
	const sentence = fleetDrainRefusalSentence(
		{ kind: "refused", because: "busy", waitedMs: 600_000, busy },
		"lop update",
	);
	assert.match(sentence, /2 sessions on this machine are still running a turn/);
	assert.match(sentence, /Nightly enrichment, Second turn/);
	assert.match(sentence, /waited 10 minutes/);
	assert.match(sentence, /run `lop update` yourself/);
	/*
	 * An install the app could not classify has NO command (`resolveGlobalInstallPlan`
	 * may not invent one), and the clause is omitted rather than guessed.
	 */
	const unnamed = fleetDrainRefusalSentence(
		{
			kind: "refused",
			because: "busy",
			waitedMs: 60_000,
			busy: busy.slice(0, 1),
		},
		null,
	);
	assert.doesNotMatch(unnamed, /run `/);
	assert.match(unnamed, /will offer this update again/);
	/*
	 * The unreadable arm says what actually happened: it never saw a turn, so it may
	 * not claim one.
	 */
	const unreadable = fleetDrainRefusalSentence(
		{ kind: "refused", because: "unknown", waitedMs: 600_000, busy: [] },
		null,
	);
	assert.match(unreadable, /could not read which sessions are running/);
	assert.doesNotMatch(unreadable, /still running a turn/);
});

test("only the sessions that were live and are not now are displaced", () => {
	const before = fleetRosterFromSessions(
		body([
			row("aaaaaaaaaaa1", "busy"),
			row("bbbbbbbbbbb2", "idle"),
			row("ccccccccccc3", "idle"),
			row("ddddddddddd4", ""),
		]),
	);
	assert.ok(before);
	const after = fleetRosterFromSessions(
		body([row("aaaaaaaaaaa1", "idle"), row("ddddddddddd4", "")]),
	);
	const displaced = displacedSessions(before, after);
	assert.deepEqual(
		displaced.map((entry) => entry.sessionId),
		["bbbbbbbbbbb2", "ccccccccccc3"],
		"a live row that is now COLD or ABSENT is displaced; a cold row and a survivor are not",
	);
	/*
	 * No roster to compare against is not a pile of displaced sessions: a read that
	 * could not be taken may not license an engage.
	 */
	assert.deepEqual(displacedSessions(before, null), []);
});

test("the re-engage waits for the displace set to settle, then engages one at a time", async () => {
	const time = clock();
	const before = fleetRosterFromSessions(
		body([row("aaaaaaaaaaa1", "idle"), row("bbbbbbbbbbb2", "idle")]),
	);
	assert.ok(before);
	/*
	 * The first read after the move still shows the second session: a runtime that
	 * was about to retire has not retired yet, and engaging it then would race the
	 * writer lease. The second read is stable, so that is when the engages happen.
	 */
	const rosters = [
		[body([row("aaaaaaaaaaa1", "idle")]), body([row("aaaaaaaaaaa1", "idle")])],
	];
	const engaged = [];
	const result = await reengageDisplacedSessions({
		before,
		readRoster: async () => {
			const next = rosters.shift();
			if (!next)
				return fleetRosterFromSessions(body([row("aaaaaaaaaaa1", "idle")]));
			return fleetRosterFromSessions(next[0] ?? []);
		},
		engage: async (entry) => {
			engaged.push(entry.sessionId);
			return true;
		},
		sleep: time.sleep,
		now: time.now,
		graceMs: 10_000,
		retirePollMs: 1000,
		log: () => {},
	});
	assert.deepEqual(
		result.displaced.map((entry) => entry.sessionId),
		["bbbbbbbbbbb2"],
	);
	assert.deepEqual(
		engaged,
		["bbbbbbbbbbb2"],
		"sequentially, and only what is gone",
	);
	assert.deepEqual(result.engaged, ["bbbbbbbbbbb2"]);
	assert.deepEqual(result.failed, []);
});

test("a displace list that comes back on its own is not re-engaged at all", async () => {
	const time = clock();
	const before = fleetRosterFromSessions(body([row("aaaaaaaaaaa1", "idle")]));
	assert.ok(before);
	const engaged = [];
	let reads = 0;
	const result = await reengageDisplacedSessions({
		before,
		readRoster: async () => {
			reads += 1;
			/* The runtime noticed the new build and came back by the second read. */
			return fleetRosterFromSessions(
				body([row("aaaaaaaaaaa1", reads > 1 ? "idle" : "")]),
			);
		},
		engage: async (entry) => {
			engaged.push(entry.sessionId);
			return true;
		},
		sleep: time.sleep,
		now: time.now,
		graceMs: 10_000,
		retirePollMs: 1000,
		log: () => {},
	});
	assert.deepEqual(result.displaced, []);
	assert.deepEqual(
		engaged,
		[],
		"waiting is what makes this a repair rather than a second spawn",
	);
});

test("an engage the server does not take is reported, never swallowed", async () => {
	const time = clock();
	const before = fleetRosterFromSessions(body([row("aaaaaaaaaaa1", "idle")]));
	assert.ok(before);
	const result = await reengageDisplacedSessions({
		before,
		readRoster: async () => fleetRosterFromSessions(body([])),
		engage: async () => {
			throw new Error("the server answered 503");
		},
		sleep: time.sleep,
		now: time.now,
		graceMs: 1000,
		retirePollMs: 1000,
		log: () => {},
	});
	assert.deepEqual(result.engaged, []);
	assert.equal(result.failed.length, 1);
	assert.equal(result.failed[0].sessionId, "aaaaaaaaaaa1");
	assert.match(result.failed[0].reason, /503/);
});

test("the panel's own number for the wait is this gate's", () => {
	/*
	 * A BOUND STATED TWICE IS A BOUND THAT CAN DRIFT. The draining phase's sentence
	 * tells the reader how long the app may hold their press; the gate is what
	 * decides it. Asserted as a match rather than left to review, because the failure
	 * mode is a panel promising ten minutes while the code waits two - or the reverse
	 * - and neither number is wrong on its own.
	 */
	const panel = readFileSync(
		join(
			process.cwd(),
			"src/renderer/src/shared/components/common/update-notification.tsx",
		),
		"utf8",
	);
	const stated = /The update waits up to (\w+) minutes/.exec(panel);
	assert.ok(stated, "the draining phase must state the bound it waits");
	const words = { five: 5, ten: 10, fifteen: 15, thirty: 30, sixty: 60 };
	assert.ok(
		Number.isFinite(words[stated[1]]),
		`the sentence names "${stated[1]} minutes", which this test cannot read as a number`,
	);
	assert.equal(
		words[stated[1]] * 60_000,
		FLEET_DRAIN_BUDGET_MS,
		`the panel says ${stated[1]} minutes and the gate waits ${FLEET_DRAIN_BUDGET_MS}ms`,
	);
});

test("the shipped bounds are the host tool's own, not invented here", () => {
	/*
	 * A release is rarely urgent enough to cut off somebody's turn, and ten minutes
	 * is the number `lop-fleet-update` already chose (`DEFAULT_DRAIN_S`); the poll
	 * interval is its `POLL_S`. Pinned so a later reader who finds the wait long
	 * changes it in one place deliberately rather than drifting from the tool this
	 * mirrors.
	 */
	assert.equal(FLEET_DRAIN_BUDGET_MS, 600_000);
	assert.equal(FLEET_DRAIN_POLL_MS, 5_000);
});
