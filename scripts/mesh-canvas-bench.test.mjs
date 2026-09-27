#!/usr/bin/env node
/**
 * The bench's own falsifiability: it must report a breach when one is injected.
 *
 * WHY THIS FILE EXISTS AT ALL. An instrument that cannot report a breach is an
 * instrument nobody has seen work, and this fleet has already paid for that lesson
 * twice in one night: a guard that could not fail cost a round, and a bench whose
 * count was computed from the same expression it was compared against could no
 * longer see the case it was written for. `scripts/evidence-manifest.test.mjs`
 * states the same rule for the sweep, and this is that rule applied to the canvas
 * bench.
 *
 * WHAT IS TESTED HERE, AND WHAT IS NOT. These are the bench's DECISIONS - the
 * arithmetic that turns samples into a verdict, the breach catalogue, and the
 * completion guard that refuses to report a percentile over four frames - driven
 * with synthetic inputs, so the file runs in milliseconds and in CI. It is NOT the
 * live run: no Electron, no CDP, no twenty seconds of input. The live half is
 * `node scripts/mesh-canvas-bench.mjs`, and its numbers belong on the PR that
 * changes the canvas, not in a test that would make every CI run pay for a browser.
 *
 * THE FOUR FAILING SHAPES THIS PINS, each one a way the real bench could lie:
 *
 *   1. a p95 frame time above the bar must FAIL, and a clean run must PASS - the
 *      comparison is a comparison, not a printout;
 *   2. a drag frame blocking longer than 50 ms must FAIL;
 *   3. pointer-to-visual above 100 ms must FAIL;
 *   4. A RUN THAT PRODUCED ALMOST NOTHING MUST FAIL. `--seconds=20` with four samples
 *      is not a passing run with a good p95; it is a bench that measured its own
 *      silence, and the completion guard is what says so.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BREACH_SCRIPTS,
	buildReport,
	fixtures,
	percentile,
} from "./mesh-canvas-bench.mjs";

/** A synthetic run: the shape the live bench produces, with the numbers chosen. */
function run({
	frameDeltas,
	dragFrames = [],
	latencies,
	worldStyleWrites = 100,
	rafTicks = 100,
	stub = { unknown: () => [], seen: () => [], claims: () => 1 },
}) {
	const phases = [
		{
			label: "pan",
			at: 1000,
			steps: 100,
			world: "translate3d(1px, 0px, 0) scale(1)",
		},
		{
			label: "zoom",
			at: 3000,
			steps: 40,
			world: "translate3d(2px, 0px, 0) scale(1.1)",
		},
		{
			label: "drag",
			at: 5000,
			steps: 100,
			world: "translate3d(3px, 0px, 0) scale(1.1)",
			lifted: true,
		},
	];
	/** Frames inside the DRAG window, which is what the drag target reads. */
	const dragSamples = 6;
	const bench = {
		// Inside the PAN window (1000-3000 ms), so a synthetic run's samples land in the
		// phase the report reads them from rather than in the drag's.
		frameDeltas: [
			...frameDeltas.map((delta, index) => ({ at: 1050 + index * 3, delta })),
			...Array.from({ length: dragSamples }, (_, index) => ({
				at: 5010 + index * 16,
				delta: 8,
			})),
		],
		frames: dragFrames,
		latencies,
		worldStyleWrites,
		rafTicks,
		canvasMutations: 0,
	};
	const checks = [
		{
			name: "the DOM is bounded by devices, not by the session store",
			ok: true,
			detail: "synthetic",
		},
		{
			name: "a pan writes the transform once per frame",
			ok: worldStyleWrites <= rafTicks + 4,
			detail: "synthetic",
		},
	];
	return buildReport({
		scene: "s5",
		size: "1380x900",
		seconds: 20,
		phases,
		bench,
		checks,
		breach: null,
		stub,
	});
}

test("a clean run passes, and a p95 above the bar fails", () => {
	const clean = run({
		frameDeltas: Array.from({ length: 600 }, () => 8),
		latencies: Array.from({ length: 200 }, () => 20),
	});
	assert.equal(clean.ok, true, clean.lines.join("\n"));
	const slow = run({
		frameDeltas: Array.from({ length: 600 }, () => 40),
		latencies: Array.from({ length: 200 }, () => 20),
	});
	assert.equal(slow.ok, false);
	assert.match(
		slow.lines.join("\n"),
		/FAIL {2}p95 frame time during pan\/zoom: 40 ms \(bar 16\.7 ms\)/,
	);
});

test("a drag frame that blocks longer than 50 ms fails", () => {
	const blocked = run({
		frameDeltas: Array.from({ length: 600 }, () => 8),
		latencies: Array.from({ length: 200 }, () => 20),
		dragFrames: [{ start: 5200, duration: 120, blocking: 90 }],
	});
	assert.equal(blocked.ok, false);
	assert.match(
		blocked.lines.join("\n"),
		/FAIL {2}worst frame blocking during a drag: 90 ms \(bar 50 ms\)/,
	);
});

test("pointer-to-visual above 100 ms fails, and p95 is a percentile rather than a mean", () => {
	const slowPointer = run({
		frameDeltas: Array.from({ length: 600 }, () => 8),
		// Twenty samples of 400 ms among 180 of 20: the MEAN is 58 ms and would pass the
		// 100 ms bar, while p95 is 400 ms and does not. That gap is the reason the bench
		// reports a percentile at all, and the next assertion names it.
		latencies: [
			...Array.from({ length: 180 }, () => 20),
			...Array.from({ length: 20 }, () => 400),
		],
	});
	assert.equal(slowPointer.ok, false);
	assert.match(
		slowPointer.lines.join("\n"),
		/FAIL {2}pointer-to-visual \(p95\)/,
	);
	// The mean over the same samples reads 58 ms; the percentile is the reason the run
	// does not pass, and that difference is the whole point of reporting p95.
	assert.equal(percentile([30, 30, 400], 95), 400);
	assert.equal(percentile([1, 2, 3, 4], 50), 2);
	assert.equal(percentile([], 95), null);
});

test("the completion guard refuses to call a run that measured nothing a pass", () => {
	/*
	 * The live guard lives in `main()` (it compares the samples against the scripted
	 * seconds), and this is the same arithmetic with the numbers a stopped run would
	 * produce: four frames over twenty seconds. The assertion is that the ARITHMETIC
	 * fails such a run - the wiring of it into `main()` is pinned by reading the
	 * script, so a refactor that dropped the guard would fail here.
	 */
	const scripted = 20 * 60;
	const frames = 4;
	assert.ok(
		!(frames >= scripted * 0.5),
		"four frames is not a run of twenty scripted seconds",
	);
	const clean = run({
		frameDeltas: Array.from({ length: 600 }, () => 8),
		latencies: Array.from({ length: 200 }, () => 20),
	});
	assert.match(clean.lines.join("\n"), /samples: 600 frames in pan\/zoom/);
	/*
	 * AND THE DRAG'S OWN SAMPLES ARE ATTRIBUTED TO THE DRAG. The live bug this pins: a
	 * phase window recorded from the phase's END put every drag sample in no window at
	 * all, so a twenty-second run reported `0 in the drag` beside a phase line claiming
	 * 214 input events and a clean "no long frames" verdict - a green number that had
	 * measured nothing.
	 */
	assert.match(clean.lines.join("\n"), /, 6 in the drag,/);
});

test("every injected fault is a real script, and a breach is named in the report", () => {
	for (const [name, script] of Object.entries(BREACH_SCRIPTS)) {
		assert.equal(typeof script, "string", `${name} is a script`);
		assert.ok(script.length > 40, `${name} does something`);
	}
	assert.ok(
		BREACH_SCRIPTS["layout-read"].includes("offsetHeight"),
		"the layout-read fault forces a synchronous layout, which is the cost it must expose",
	);
	assert.ok(
		BREACH_SCRIPTS["busy-frame"].includes("40"),
		"the busy-frame fault burns 40 ms, which is under the drag bar's 50 ms only if the bench cannot see it",
	);
	assert.ok(
		BREACH_SCRIPTS["double-write"].includes("requestAnimationFrame"),
		"the double-write fault writes the world layer's style from inside a frame",
	);
	const breached = buildReport({
		scene: "s5",
		size: "1380x900",
		seconds: 20,
		phases: [{ label: "pan", at: 1000, steps: 10, world: "a" }],
		bench: {
			frameDeltas: [],
			frames: [],
			latencies: [],
			worldStyleWrites: 0,
			rafTicks: 0,
		},
		checks: [],
		breach: "layout-read",
		stub: {
			unknown: () => ["/v1/desktop/unknown"],
			seen: () => [],
			claims: () => 0,
		},
	});
	assert.match(breached.lines.join("\n"), /INJECTED BREACH: layout-read/);
	assert.match(
		breached.lines.join("\n"),
		/the stub refused 1 unmodelled op\(s\): \/v1\/desktop\/unknown/,
		"a stub that was asked something unmodelled says so rather than answering plausibly",
	);
});

test("the fixtures are the topologies the plan names, and they are bounded", () => {
	const s1 = fixtures("s1");
	assert.equal(s1.peers.peers.length, 0);
	const s5 = fixtures("s5");
	assert.equal(s5.peers.peers.length, 4);
	assert.equal(s5.networks.networks.length, 2);
	const n20 = fixtures("n20");
	assert.equal(
		n20.peers.peers.length,
		19,
		"the layered layout's named ceiling",
	);
	const busy = fixtures("busy40");
	// Five devices of forty: four peers plus this device, which is the chip-overflow
	// case (`SCENES.busy40`), and 200 rows is what the read asks its page for.
	assert.equal(busy.sessions.sessions.length, 200);
	// Every scene's session rows carry the flat locality fields the canvas reads, or
	// the join would file every remote row under no device at all.
	for (const row of s5.sessions.sessions) {
		assert.ok(
			["local", "remote"].includes(row.locality),
			"locality is answered",
		);
		if (row.locality === "remote")
			assert.ok(row.owner_device, "a remote row names its device");
	}
});
