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
	unionFleetSnapshots,
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

test("the refusal's two arms are a lead line and an explanation, and name no command", () => {
	const busy = fleetRosterFromSessions(
		body([
			row("aaaaaaaaaaa1", "busy", { name: "Nightly enrichment" }),
			row("bbbbbbbbbbb2", "busy", { name: "Second turn" }),
		]),
	);
	assert.ok(busy);
	const sentence = fleetDrainRefusalSentence({
		kind: "refused",
		because: "busy",
		waitedMs: 600_000,
		busy,
	});
	/*
	 * THE LEAD IS THE COUNT AND THE NAMES (design D5): the actionable fact, rendered
	 * at full ink above the explanation rather than mid-paragraph in muted ink.
	 */
	const [lead, explanation] = sentence.split("\n\n");
	assert.match(lead, /2 sessions are still running a turn on this machine/);
	assert.match(lead, /Nightly enrichment, Second turn/);
	assert.doesNotMatch(
		lead,
		/\(/,
		"the names are the lead line, not a parenthesis",
	);
	assert.ok(
		explanation,
		"the explanation is its own part, on the producer's one blank line",
	);
	assert.match(explanation, /waited 10 minutes/);
	assert.match(
		explanation,
		/Nothing was installed and the server keeps running/,
	);
	assert.match(explanation, /will offer this update again/);
	/*
	 * THE COMMAND IS NOT IN THE SENTENCE (design D2). It travels as its own field so
	 * the panel can render the app's `CommandBlock`; printed here it would be
	 * backticks in body ink with no way to copy them.
	 */
	assert.doesNotMatch(sentence, /`/);
	assert.doesNotMatch(sentence, /uv tool upgrade/);
	/*
	 * The unreadable arm says what actually happened, and which unreadable it was:
	 * a server that answered 401 and a socket that never answered are the same
	 * verdict and different next steps (QA round 1, observation b).
	 */
	const unreachable = fleetDrainRefusalSentence({
		kind: "refused",
		because: "unknown",
		waitedMs: 600_000,
		busy: [],
	});
	assert.match(unreachable, /could not read which sessions are running/);
	assert.doesNotMatch(unreachable, /still running a turn/);
	assert.doesNotMatch(unreachable, /credentials/);
	const refusedCredentials = fleetDrainRefusalSentence({
		kind: "refused",
		because: "unknown",
		waitedMs: 600_000,
		busy: [],
		credentialsRefused: true,
	});
	assert.match(refusedCredentials, /refused this app's credentials/);
	/*
	 * THE ZERO-BUSY FALLBACK DOES NOT CLAIM A MEASUREMENT (review round 1, NIT n3):
	 * an empty `busy` at the end of the budget means the roster read failed, so the
	 * sentence may not assert a turn it never saw.
	 */
	const unnamed = fleetDrainRefusalSentence({
		kind: "refused",
		because: "busy",
		waitedMs: 60_000,
		busy: [],
	});
	assert.match(unnamed, /could not name the sessions/);
	assert.doesNotMatch(unnamed, /is still running a turn/);
});

test("a listing whose own liveness read failed is not a quiet fleet", () => {
	/*
	 * THE BLOCKER (review round 1, B1 = QA Q-1). `registry.scan()` raised, so every
	 * row carries the catalogue's DEFAULT `live_state: ""` - a string, which is why
	 * the old-daemon guard (which looks for the field's ABSENCE) never saw it - while
	 * the listing itself says which read failed. Those rows are evidence of nothing,
	 * so the verdict may not be `idle`: the press would otherwise restart the daemon
	 * under turns this app cannot see, and the invariant the whole gate exists for is
	 * that an unreadable probe means STAY.
	 */
	const degraded = {
		result: {
			sessions: [row("aaaaaaaaaaa1", ""), row("bbbbbbbbbbb2", "")],
			degraded: ["liveness"],
		},
	};
	assert.equal(servingWorkStateFromSessions(degraded), "unknown");
	assert.equal(
		fleetRosterFromSessions(degraded),
		null,
		"a degraded roster is no roster: the re-engage may not diff against it either",
	);
	/*
	 * AND THE OTHER DECORATIONS ARE NOT THIS. `wakes`/`attention` failing says
	 * nothing about work, and a gate that refused on them would be inert on any
	 * machine whose wake index is unreadable - which is the fail-closed direction
	 * taken one step too far.
	 */
	const wakesOnly = {
		result: {
			sessions: [row("aaaaaaaaaaa1", "idle"), row("bbbbbbbbbbb2", "")],
			degraded: ["wakes", "attention"],
		},
	};
	assert.equal(servingWorkStateFromSessions(wakesOnly), "idle");
});

test("a row whose live_state cannot be read is not a quiet row", () => {
	/*
	 * IDLE IS A CLAIM ABOUT EVERY ROW. A row with no `live_state` is a daemon
	 * predating the field, and a row with a spelling this build does not know is a
	 * fact it cannot interpret - neither is a row it may count as quiet, and one of
	 * them makes the whole roster unreadable rather than just itself.
	 */
	assert.equal(
		servingWorkStateFromSessions(
			body([row("aaaaaaaaaaa1", "idle"), { id: "bbbbbbbbbbb2", name: "b" }]),
		),
		"unknown",
		"a row with no live_state at all",
	);
	assert.equal(
		servingWorkStateFromSessions(
			body([row("aaaaaaaaaaa1", "idle"), row("bbbbbbbbbbb2", "starting")]),
		),
		"unknown",
		"a spelling this build has never heard of",
	);
	/*
	 * BLANK IS THE CATALOGUE'S OWN SPELLING for a row with no record at all - the
	 * shape most rows of a real store have - so it stays readable, and the degraded
	 * MARKER above is what separates a genuinely cold row from a defaulted one. A
	 * gate that refused on blank would never restart anything on this machine.
	 */
	assert.equal(
		servingWorkStateFromSessions(
			body([row("aaaaaaaaaaa1", "idle"), row("bbbbbbbbbbb2", "")]),
		),
		"idle",
	);
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

test("the re-engage does not end the wait while the wave is inside its settle window", async () => {
	/*
	 * THE RULE THIS REPLACES, AND WHY IT WAS WRONG (review round 1, M1 = QA Q-2).
	 * The old case handed the loop two identical rosters and asserted the engage
	 * happened after the SECOND read - which pinned "a repeated set means the wave is
	 * over". A repeated set is the opposite: a pre-swap runtime retires ITSELF, and
	 * only after the harness's build check, its settle window and its staggered
	 * slice (5 + 10 + 20 s, `local_operator/buildwatch.py`), so the set that repeats
	 * early is the set that still has retirements coming. The reference tool waits
	 * for the pre-update runtimes to LEAVE (`~/tools/lop-fleet-update`), bounded by a
	 * grace, and this now does the same.
	 */
	const time = clock();
	const before = fleetRosterFromSessions(
		body([row("aaaaaaaaaaa1", "idle"), row("bbbbbbbbbbb2", "idle")]),
	);
	assert.ok(before);
	let engagedAt = null;
	const engaged = [];
	const result = await reengageDisplacedSessions({
		before,
		// b2 is already gone on the first read, and the set never changes again.
		readRoster: async () =>
			fleetRosterFromSessions(body([row("aaaaaaaaaaa1", "idle")])),
		engage: async (entry) => {
			engaged.push(entry.sessionId);
			engagedAt = time.now();
			return true;
		},
		sleep: time.sleep,
		now: time.now,
		graceMs: 60_000,
		settleMs: 30_000,
		retirePollMs: 5_000,
		log: () => {},
	});
	assert.deepEqual(
		result.displaced.map((entry) => entry.sessionId),
		["bbbbbbbbbbb2"],
	);
	assert.deepEqual(engaged, ["bbbbbbbbbbb2"], "engaged once, sequentially");
	assert.ok(
		engagedAt !== null && engagedAt >= 30_000,
		`the engage must wait the harness's own stride for the wave, not one poll: engaged at ${engagedAt}ms`,
	);
});

test("a retirement that lands after the first look is still re-engaged", async () => {
	const time = clock();
	const before = fleetRosterFromSessions(
		body([row("aaaaaaaaaaa1", "idle"), row("bbbbbbbbbbb2", "idle")]),
	);
	assert.ok(before);
	/*
	 * THE SKIP THE OLD RULE MADE (review round 1, M1, first half). Nothing looks
	 * displaced on the first read - the ordinary shape immediately after a restart,
	 * because session runtimes are separate processes that survived the daemon bounce
	 * and retire on the BUILD change afterwards - and the old loop returned without
	 * waiting at all, so a runtime that went cold a moment later was never seen and
	 * the unwatched `daemon`-kind session was left with no runtime.
	 */
	let reads = 0;
	const engaged = [];
	const result = await reengageDisplacedSessions({
		before,
		readRoster: async () => {
			reads += 1;
			return fleetRosterFromSessions(
				body(
					reads < 3
						? [row("aaaaaaaaaaa1", "idle"), row("bbbbbbbbbbb2", "idle")]
						: [row("aaaaaaaaaaa1", "idle")],
				),
			);
		},
		engage: async (entry) => {
			engaged.push(entry.sessionId);
			return true;
		},
		sleep: time.sleep,
		now: time.now,
		graceMs: 60_000,
		settleMs: 30_000,
		retirePollMs: 5_000,
		log: () => {},
	});
	assert.deepEqual(engaged, ["bbbbbbbbbbb2"]);
	assert.deepEqual(result.failed, []);
});

test("a wave that never settles ends at the grace, and what is gone is still engaged", async () => {
	const time = clock();
	const before = fleetRosterFromSessions(
		body([row("aaaaaaaaaaa1", "idle"), row("bbbbbbbbbbb2", "idle")]),
	);
	assert.ok(before);
	const engaged = [];
	const result = await reengageDisplacedSessions({
		before,
		readRoster: async () =>
			fleetRosterFromSessions(body([row("aaaaaaaaaaa1", "idle")])),
		engage: async (entry) => {
			engaged.push(entry.sessionId);
			return true;
		},
		sleep: time.sleep,
		now: time.now,
		/*
		 * The grace is the OUTER bound for the shape only the clock can end: a
		 * pre-swap runtime that never retires at all (a session that went busy again
		 * after the drain). The wait stops there, and the repair still happens.
		 */
		graceMs: 10_000,
		settleMs: 30_000,
		retirePollMs: 5_000,
		log: () => {},
	});
	assert.ok(
		time.now() >= 10_000 && time.now() < 15_000,
		`the wait is bounded by the grace, not by the poll: ${time.now()}ms`,
	);
	assert.deepEqual(engaged, ["bbbbbbbbbbb2"]);
});

test("a roster read that fails during the wait is no information, not a wave", async () => {
	const time = clock();
	const before = fleetRosterFromSessions(
		body([row("aaaaaaaaaaa1", "idle"), row("bbbbbbbbbbb2", "idle")]),
	);
	assert.ok(before);
	const engaged = [];
	const result = await reengageDisplacedSessions({
		before,
		readRoster: async () => null,
		engage: async (entry) => {
			engaged.push(entry.sessionId);
			return true;
		},
		sleep: time.sleep,
		now: time.now,
		graceMs: 30_000,
		settleMs: 10_000,
		retirePollMs: 5_000,
		log: () => {},
	});
	/*
	 * An unreadable read is not "everything retired": treating it as an empty live
	 * set would call every session displaced and spawn a runtime for each. No
	 * information means no engage, and the wait still ends on a bound.
	 */
	assert.deepEqual(engaged, []);
	assert.deepEqual(result.displaced, []);
	assert.ok(time.now() >= 10_000);
});

test("a swap with nothing live before it has nothing to put back, and reads nothing", async () => {
	let reads = 0;
	let engagements = 0;
	const cold = fleetRosterFromSessions(body([row("ddddddddddd4", "")]));
	assert.ok(cold);
	const result = await reengageDisplacedSessions({
		before: cold,
		readRoster: async () => {
			reads += 1;
			return fleetRosterFromSessions(body([]));
		},
		engage: async () => {
			engagements += 1;
			return true;
		},
		sleep: async () => {},
		now: () => 0,
		log: () => {},
	});
	/*
	 * A machine whose sessions were all cold has no runtime to displace, so this is
	 * the one arm that may answer without a read. It is NOT the "first read shows
	 * nothing displaced" arm - that one waits (see the case above).
	 */
	assert.equal(reads, 0);
	assert.equal(engagements, 0);
	assert.deepEqual(result.displaced, []);
});

test("an engage the server answers false to is reported, never swallowed", async () => {
	const time = clock();
	const before = fleetRosterFromSessions(body([row("aaaaaaaaaaa1", "idle")]));
	assert.ok(before);
	const result = await reengageDisplacedSessions({
		before,
		readRoster: async () => fleetRosterFromSessions(body([])),
		engage: async () => false,
		sleep: time.sleep,
		now: time.now,
		graceMs: 1000,
		settleMs: 1000,
		retirePollMs: 1000,
		log: () => {},
	});
	assert.deepEqual(result.engaged, []);
	assert.equal(result.failed.length, 1);
	assert.match(result.failed[0].reason, /did not take the engage/);
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
	 * A BOUND STATED TWICE IS A BOUND THAT CAN DRIFT. Both places the panel states it
	 * - the offer's cost line before the press, and the draining phase's sentence
	 * during the wait - tell the reader how long the app may hold their press, and the
	 * gate is what decides it. Asserted as a match rather than left to review, because
	 * the failure mode is a panel promising ten minutes while the code waits two - or
	 * the reverse - and neither number is wrong on its own.
	 */
	const panel = readFileSync(
		join(
			process.cwd(),
			"src/renderer/src/shared/components/common/update-notification.tsx",
		),
		"utf8",
	);
	const words = { five: 5, ten: 10, fifteen: 15, thirty: 30, sixty: 60 };
	const stated = [...panel.matchAll(/waits up to (\w+) minutes/g)].map(
		(match) => match[1],
	);
	assert.ok(
		stated.length >= 2,
		"both the offer and the draining phase must state the bound they wait",
	);
	for (const word of stated) {
		assert.ok(
			Number.isFinite(words[word]),
			`a sentence names "${word} minutes", which this test cannot read as a number`,
		);
		assert.equal(
			words[word] * 60_000,
			FLEET_DRAIN_BUDGET_MS,
			`the panel says ${word} minutes and the gate waits ${FLEET_DRAIN_BUDGET_MS}ms`,
		);
	}
});

test("the before-side of a diff is the union of the snapshots that can hold the loss", () => {
	const first = fleetRosterFromSessions(
		body([row("aaaaaaaaaaa1", "idle"), row("bbbbbbbbbbb2", "busy")]),
	);
	const second = fleetRosterFromSessions(
		body([row("bbbbbbbbbbb2", "idle"), row("ccccccccccc3", "idle")]),
	);
	assert.ok(first && second);
	/*
	 * WHY A UNION (review round 1, M2). The install leg and the restart leg are
	 * separated by up to half an hour on the rebuild route, and a runtime the INSTALL
	 * killed is already gone by the time the pre-restart snapshot is read - so a diff
	 * taken only across the restart cannot see it, and one taken only across the
	 * install misses everything created in between. Every member of the union was live
	 * when ONE of the reads was taken, which is what keeps the diff about what vanished.
	 */
	assert.deepEqual(
		unionFleetSnapshots(first, second)?.map((entry) => entry.sessionId),
		["aaaaaaaaaaa1", "bbbbbbbbbbb2", "ccccccccccc3"],
		"the same session in both readings appears once, in the first snapshot's order",
	);
	/*
	 * An unreadable side contributes nothing rather than poisoning the pair: the
	 * readable half is still a true statement about what was live.
	 */
	assert.deepEqual(unionFleetSnapshots(null, second), second);
	assert.deepEqual(unionFleetSnapshots(first, null), first);
	assert.equal(unionFleetSnapshots(null, null), null);
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
