import assert from "node:assert/strict";
import { test } from "node:test";
import {
	LANE_BOUND_OVERRIDE_ENV,
	_BLIND_TICKS_WARN,
	_DEFAULT_BOUND_MS,
	computeLaneBound,
	createLaneBoundWatchdog,
	formatLaneBoundLine,
	formatLaneTripLine,
	laneProcesses,
	parseGroupTable,
} from "./desktop-test-lane-bound.mjs";

/*
 * The per-lane bound's arithmetic, its scoped pid selection, and the watchdog's
 * edges, pinned one input at a time.
 *
 * WHY THIS IS ASSERTED RATHER THAN LEFT TO THE SUITE: the thing it protects
 * against is a run that never ends, so a green end-to-end check cannot exercise
 * it - the wedge IS the absence of an end. Every interesting behaviour here is
 * therefore driven by injection (the process table, the clock, the kill, the
 * timer), and the two properties worth stating are:
 *
 *  - the kill is scoped by PROCESS GROUP and by the lane's OWN PATH ARGUMENT, so
 *    a bound can never reach a process this runner did not start (the incident
 *    this repository already carries is a `kill -9` aimed by name and an
 *    unscoped `pgrep -f`, which killed two other sessions' trees); and
 *  - a lane is killed ONCE, and reported before it is killed, so the one line a
 *    reader needs is never lost behind the process death.
 *
 * The end-to-end shape it produces - the killed file marked failed, the rest of
 * the suite finishing, the runner forwarding rc=1 - was measured against the
 * real runner over a hanging fixture pair; see `desktop-test-lane-bound.mjs`'s
 * docstring. This file pins the parts a fixture cannot make deterministic.
 */

/** One `ps -axo pid=,ppid=,pgid=,command=` line for the fixtures below. */
const row = (pid, ppid, pgid, command) =>
	`${String(pid).padStart(6)} ${String(ppid).padStart(6)} ${String(pgid).padStart(6)} ${command}`;

/*
 * The patterns the assertions below match on, hoisted once: these tests read the
 * two lines a human reads during an incident, so the pins are about those lines'
 * WORDS, and a literal rebuilt inside each assertion is noise biome rightly
 * flags (`useTopLevelRegex`).
 */
const PER_LANE_BOUND = /per-lane bound/;
const TEN_MINUTES = /10 min/;
const OFF_WARNING = /WARNING/;
const BOUND_OFF = /OFF/;
const BOUND_EXCEEDED = /LANE BOUND EXCEEDED/;
const BOARD_FOCUS_LANE = /scripts\/projects-board-focus\.test\.mjs/;
const TRIPPED_PID = /4242/;
const STILL_LANDS = /still lands/;

test("the default bound is a stall detector, not a ceiling on slow work", () => {
	const { boundMs, arm } = computeLaneBound({ override: null });
	assert.equal(arm, "default");
	assert.equal(boundMs, _DEFAULT_BOUND_MS);
	assert.ok(
		boundMs >= 60_000,
		"a bound under a minute would fire on honest lanes on a loaded machine",
	);
});

test("an explicit override is taken as milliseconds, and only when it is one", () => {
	assert.deepEqual(computeLaneBound({ override: "45000" }), {
		boundMs: 45_000,
		arm: "override",
	});
	assert.deepEqual(computeLaneBound({ override: " 45000 " }), {
		boundMs: 45_000,
		arm: "override",
	});
	assert.deepEqual(computeLaneBound({ override: "OFF" }), {
		boundMs: null,
		arm: "off",
	});
});

test("a malformed override is reported and ignored, never silently a bound", () => {
	// The case that matters: `parseInt` reads "8s" as 8, which would be a
	// sub-second bound nobody asked for and would kill honest lanes instantly.
	for (const typo of ["8s", "0", "-1", "1.5", "sixty", ""]) {
		const warnings = [];
		const original = console.warn;
		console.warn = (line) => warnings.push(String(line));
		const decision = computeLaneBound({ override: typo });
		console.warn = original;
		if (typo === "") {
			assert.equal(decision.arm, "default", `empty override: ${decision.arm}`);
			assert.equal(warnings.length, 0, "an empty override is not a typo");
			continue;
		}
		assert.equal(decision.arm, "default", `override ${typo}`);
		assert.equal(decision.boundMs, _DEFAULT_BOUND_MS, `override ${typo}`);
		assert.equal(warnings.length, 1, `override ${typo} must warn once`);
		assert.match(warnings[0], new RegExp(LANE_BOUND_OVERRIDE_ENV));
	}
});

test("the startup line names the bound, where it came from, and how to change it", () => {
	const line = formatLaneBoundLine(computeLaneBound({ override: "600000" }));
	assert.match(line, PER_LANE_BOUND);
	assert.match(line, TEN_MINUTES);
	assert.match(line, new RegExp(LANE_BOUND_OVERRIDE_ENV));
	const off = formatLaneBoundLine(computeLaneBound({ override: "off" }));
	assert.match(off, OFF_WARNING);
	assert.match(off, BOUND_OFF);
});

test("the trip line names the lane, the bound, and that the rest still lands", () => {
	const line = formatLaneTripLine({
		lane: "scripts/projects-board-focus.test.mjs",
		pid: 4242,
		elapsedMs: 601_000,
		boundMs: _DEFAULT_BOUND_MS,
	});
	assert.match(line, BOUND_EXCEEDED);
	assert.match(line, BOARD_FOCUS_LANE);
	assert.match(line, TEN_MINUTES);
	assert.match(line, TRIPPED_PID);
	assert.match(line, STILL_LANDS);
});

test("the process table parser reads ps rows and ignores anything else", () => {
	const rows = parseGroupTable(
		[
			row(101, 100, 100, "node --test --test-concurrency=7 a.test.mjs"),
			"",
			"not a row at all",
			row(102, 101, 100, "node --test-concurrency=0 b.test.mjs"),
		].join("\n"),
	);
	assert.deepEqual(
		rows.map((r) => r.pid),
		[101, 102],
		"a line that does not parse is skipped rather than guessed at",
	);
	assert.equal(rows[1].ppid, 101);
	assert.equal(rows[1].pgid, 100);
});

test("a lane is matched by its own path argument, and only inside the group", () => {
	const lanes = ["scripts/a.test.mjs", "scripts/a-more.test.mjs"];
	const table = parseGroupTable(
		[
			// the suite child itself: its argv carries EVERY lane path
			row(100, 1, 100, `node --test ${lanes.join(" ")}`),
			// the lane's own file process
			row(101, 100, 100, "node --test-concurrency=0 scripts/a.test.mjs"),
			// a deeper descendant repeating the argument: not the file process
			row(105, 101, 100, "node -e scripts/a.test.mjs"),
			// the neighbouring lane
			row(102, 100, 100, "node --test-concurrency=0 scripts/a-more.test.mjs"),
			// a process in another group that mentions the same path
			row(200, 1, 999, "node --test--other scripts/a.test.mjs"),
		].join("\n"),
	);
	const seen = laneProcesses(table, { leaderPid: 100, lanes });
	assert.deepEqual([...seen.keys()].sort(), [
		"scripts/a-more.test.mjs",
		"scripts/a.test.mjs",
	]);
	assert.equal(
		seen.get("scripts/a.test.mjs").pid,
		101,
		"the suite child's own child wins over a deeper descendant",
	);
	assert.equal(seen.get("scripts/a-more.test.mjs").pid, 102);
});

test("a lane whose path is a prefix of another lane's is not that lane", () => {
	const table = parseGroupTable(
		row(101, 100, 100, "node --test-concurrency=0 scripts/a.test.mjs"),
	);
	const seen = laneProcesses(table, {
		leaderPid: 100,
		lanes: ["scripts/a.test.mjs-more"],
	});
	assert.equal(seen.size, 0, "substring matching would have matched here");
});

/** A deterministic driver: no real timers, no real clock, no real kills. */
function driver({ tables, boundMs = 1_000, tickMs = 0 }) {
	/** The lanes this driver's suite covers, shared by the watchdog and its sampler. */
	const lanes = ["scripts/a.test.mjs", "scripts/b.test.mjs"];
	const state = {
		killed: [],
		trips: [],
		blinds: [],
		index: 0,
		clock: 0,
		timers: [],
		armed: () => state.timers.length,
	};
	const watchdog = createLaneBoundWatchdog({
		leaderPid: 100,
		lanes,
		boundMs,
		sample: async () => {
			const table = tables[Math.min(state.index, tables.length - 1)];
			state.index += 1;
			if (table === null) throw new Error("ps unreadable");
			// The same contract the default sampler has - a Map of lane path to the
			// pid carrying it. Returning the raw rows would let a mismatch between
			// the watchdog and its sampler hide behind the injection, which is the
			// one thing an injected sample must not do.
			return laneProcesses(parseGroupTable(table), { leaderPid: 100, lanes });
		},
		kill: (pid) => state.killed.push(pid),
		now: () => state.clock,
		onTrip: (trip) => state.trips.push(trip),
		onBlind: (ticks) => state.blinds.push(ticks),
		intervalMs: tickMs,
		setTimer: (fn) => {
			state.timers.push(fn);
			return state.timers.length;
		},
		clearTimer: () => {},
	});
	return { watchdog, state };
}

const laneA = row(
	101,
	100,
	100,
	"node --test-concurrency=0 scripts/a.test.mjs",
);
const laneB = row(
	102,
	100,
	100,
	"node --test-concurrency=0 scripts/b.test.mjs",
);

test("a lane under the bound is never touched", async () => {
	const { watchdog, state } = driver({ tables: [`${laneA}\n${laneB}`] });
	await watchdog._tick();
	state.clock = 900;
	await watchdog._tick();
	assert.deepEqual(state.killed, []);
	assert.deepEqual(state.trips, []);
});

test("a lane past the bound is named once, and only that pid is killed", async () => {
	const { watchdog, state } = driver({
		// B starts one tick LATER, so at t=1000 only A is past the bound: the point
		// of the assertion is that the sibling still running is left alone.
		tables: [laneA, `${laneA}\n${laneB}`],
		boundMs: 1_000,
	});
	await watchdog._tick();
	state.clock = 1_000;
	await watchdog._tick();
	assert.equal(state.trips.length, 1);
	assert.equal(state.trips[0].lane, "scripts/a.test.mjs");
	assert.equal(state.trips[0].pid, 101);
	assert.equal(state.trips[0].elapsedMs, 1_000);
	assert.deepEqual(
		state.killed,
		[101],
		"the sibling lane's process must not be killed with it",
	);
});

test("a second tick does not re-report or re-kill the same stall", async () => {
	const { watchdog, state } = driver({
		tables: [laneA, laneA, laneA],
		boundMs: 1_000,
	});
	await watchdog._tick();
	state.clock = 1_000;
	await watchdog._tick();
	state.clock = 2_000;
	await watchdog._tick();
	assert.equal(state.trips.length, 1, "one stall is one line");
	assert.deepEqual(state.killed, [101]);
});

test("a lane that finished is forgotten, so its slot is not charged to the next", async () => {
	const { watchdog, state } = driver({
		tables: [laneA, laneB, laneB],
		boundMs: 1_000,
	});
	await watchdog._tick();
	state.clock = 900;
	await watchdog._tick();
	assert.deepEqual(state.killed, [], "lane B appeared at t=900 and is young");
	state.clock = 1_500;
	await watchdog._tick();
	assert.deepEqual(state.killed, [], "B is timed from its own first sighting");
});

test("a lane whose process changed is re-timed rather than charged the old wait", async () => {
	const restarted = row(
		103,
		100,
		100,
		"node --test-concurrency=0 scripts/a.test.mjs",
	);
	const { watchdog, state } = driver({
		tables: [laneA, restarted, restarted, restarted],
		boundMs: 5_000,
	});
	await watchdog._tick(); // pid 101 first seen at t=0
	state.clock = 20_000; // long past the bound, but the pid CHANGED here
	await watchdog._tick();
	assert.deepEqual(state.killed, [], "a new pid starts its own clock");
	state.clock = 24_000; // the new pid is 4 s old: still under a 5 s bound
	await watchdog._tick();
	assert.deepEqual(state.killed, [], "and is charged only for its own life");
	state.clock = 26_000; // 6 s old: now it trips, on the NEW pid
	await watchdog._tick();
	assert.deepEqual(state.killed, [103]);
	assert.equal(state.trips[0].pid, 103);
});

test("an unreadable process table warns once, and blocks no later tick", async () => {
	const { watchdog, state } = driver({
		tables: [null, null, null, null, null, laneA],
		boundMs: 1_000,
	});
	for (let i = 0; i < _BLIND_TICKS_WARN; i += 1) await watchdog._tick();
	assert.deepEqual(state.blinds, [_BLIND_TICKS_WARN]);
	await watchdog._tick();
	assert.deepEqual(state.killed, [], "a blind stretch kills nothing");
	assert.equal(
		state.blinds.length,
		1,
		"the warning is once, not once per tick",
	);
});

test("stop() ends the sampling, so a finished suite is no longer watched", async () => {
	const { watchdog, state } = driver({ tables: [laneA] });
	watchdog.start();
	const before = state.index;
	watchdog.stop();
	await watchdog._tick();
	assert.equal(
		state.index,
		before,
		"a stopped watchdog takes no further sample",
	);
});
