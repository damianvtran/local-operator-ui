/**
 * The waveform's geometry, its seek math and its accessibility text — as the
 * SHIPPED module, bundled with esbuild the way this repository's other pure-model
 * suites run.
 *
 * WHY PURE. `waveform-model.ts` owns every number the canvas, the hit-testing
 * and the aria text read, so asserting the numbers here is asserting what all
 * three surfaces will do — one implementation, three consumers, no second
 * spelling of a bar's height or a click's destination.
 *
 * NO AUDIO IS TOUCHED, CREATED OR PLAYED. Nothing in this file constructs an
 * element, a context or a decoder; peaks are arrays of numbers and the recipe is
 * arithmetic (the lane's audio-safety rule, and `audio-engine.test.mjs`'s guard
 * covers the suites that DO create an element).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/waveform-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	ALPHA_MAX,
	ALPHA_MIN,
	BAR_BASE,
	BAR_GAP,
	BAR_PITCH,
	BAR_RADIUS,
	BAR_WIDTH,
	EDGE_FADE_PX,
	VALUE_SCALE,
	ariaValueText,
	barCountForWidth,
	downsamplePeaks,
	edgeFade,
	formatClock,
	progressFraction,
	seekSecondsAt,
	waveformBars,
} = mod;

/* ------------------------------------------------------------- the recipe */

test("the recipe is the bar-wave constants the design spec names", () => {
	// The values, not just their names: a bar that grew to 6 px would still be
	// "BAR_WIDTH" and the surface would still pass a test that only read it.
	assert.equal(BAR_WIDTH, 4);
	assert.equal(BAR_GAP, 2);
	assert.equal(BAR_RADIUS, 2);
	assert.equal(BAR_BASE, 4);
	assert.equal(VALUE_SCALE, 0.8);
	assert.equal(EDGE_FADE_PX, 24);
	assert.equal(ALPHA_MIN, 0.3);
	assert.equal(ALPHA_MAX, 1);
	assert.equal(BAR_PITCH, BAR_WIDTH + BAR_GAP);
});

test("a width's bar count fills it without overrunning, and never reaches zero", () => {
	// Bars include the fade zones so the ramp changes drawn ink.
	assert.equal(barCountForWidth(300), 50);
	assert.equal(barCountForWidth(0), 1, "a zero-width box still has one bar");
	assert.equal(barCountForWidth(Number.NaN), 1);
	assert.equal(barCountForWidth(-40), 1);
	const narrow = barCountForWidth(40);
	assert.equal(narrow, 7, "narrow widths still draw through both fade zones");
});

test("the edge fade ramps from 0 at each edge to 1 at 24 px in", () => {
	assert.equal(edgeFade(0, 200), 0);
	assert.equal(edgeFade(200, 200), 0);
	assert.equal(edgeFade(24, 200), 1);
	assert.equal(edgeFade(176, 200), 1);
	assert.equal(edgeFade(100, 200), 1);
	// The middle of the ramp, measured from the nearer edge.
	assert.ok(Math.abs(edgeFade(12, 200) - 0.5) < 1e-9);
});

test("downsampling takes each bucket's maximum, so a transient survives", () => {
	// 4 peaks onto 2 bars: the loud sample in each bucket becomes the bar.
	assert.deepEqual(downsamplePeaks([0.1, 0.9, 0.2, 0.3], 2), [0.9, 0.3]);
	// Values outside 0..1 are clamped, never drawn out of the box.
	assert.deepEqual(downsamplePeaks([2, -1, 0.5, 0.5], 2), [1, 0.5]);
	// Non-finite entries read as silence rather than poisoning a bar's height.
	assert.deepEqual(downsamplePeaks([Number.NaN, 0.4], 2), [0, 0.4]);
	// A single peak onto many bars repeats it (the step floors to one sample).
	assert.deepEqual(downsamplePeaks([0.7], 3), [0.7, 0.7, 0.7]);
	assert.deepEqual(downsamplePeaks([], 2), [0, 0], "no peaks is silence");
	assert.deepEqual(downsamplePeaks([0.5], 0), []);
});

/* ------------------------------------------------------------- the bars */

test("no peaks draws the FLAT scrubber - never a fabricated envelope", () => {
	const flat = waveformBars(null, 300, 40);
	assert.equal(flat.length, barCountForWidth(300));
	for (const bar of flat) {
		assert.equal(
			bar.height,
			BAR_BASE,
			"every bar rests at the base height - a shape the audio does not have is a lie about the sound",
		);
	}
	// The alphas still ramp and fade, so the flat line reads as a waveform's
	// frame rather than a stray rule.
	assert.ok(flat[0].alpha < flat[Math.floor(flat.length / 2)].alpha);
});

test("a peak's bar is value x height x 0.8, floored at the base height", () => {
	const peaks = new Array(42).fill(0.5);
	const bars = waveformBars(peaks, 300, 40);
	assert.equal(bars.length, 50);
	assert.equal(bars[0].height, Math.round(0.5 * 40 * VALUE_SCALE));
	// A silent bucket still shows the base bar, so the wave has a baseline.
	const quiet = waveformBars(new Array(42).fill(0), 300, 40);
	assert.equal(quiet[0].height, BAR_BASE);
	// The tallest peak leaves a margin (0.8 of the box), never touching its edge.
	const loud = waveformBars(new Array(42).fill(1), 300, 40);
	assert.equal(loud[0].height, Math.round(40 * VALUE_SCALE));
	assert.ok(loud[0].height < 40);
});

test("bars are pitch-spaced through the fades, and the alpha ramp is 0.3 to 1.0", () => {
	const bars = waveformBars(new Array(42).fill(1), 300, 40);
	for (let i = 1; i < bars.length; i += 1) {
		assert.equal(bars[i].x - bars[i - 1].x, BAR_PITCH);
	}
	assert.equal(bars[0].x, 0);
	assert.ok(bars[0].alpha < ALPHA_MIN);
	/*
	 * The alpha ramp runs 0.3 at the FIRST bar to 1.0 at the LAST, across the
	 * whole wave (the recipe's left-to-right reading), and then the 24 px edge
	 * fade multiplies it down at both ends. The middle of a long wave therefore
	 * carries neither extreme: it is the ramp's own halfway value.
	 */
	const last = bars[bars.length - 1];
	const lastCentre = last.x + BAR_WIDTH / 2;
	assert.ok(Math.abs(last.alpha - edgeFade(lastCentre, 300)) < 1e-9);
	// The wave's middle is outside the fade, so it shows the ramp alone: for 42
	// bars that is 0.3 + 0.7 * (21 / (bars.length - 1)).
	const middle = bars[21];
	assert.ok(
		Math.abs(
			middle.alpha -
				(ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * (21 / (bars.length - 1))),
		) < 1e-9,
	);
	const single = waveformBars(null, 4, 40);
	assert.equal(single.length, 1);
	assert.ok(Math.abs(single[0].alpha - ALPHA_MIN * edgeFade(2, 4)) < 1e-9);
	for (const width of [340, 210, 100]) {
		const drawn = waveformBars(null, width, 44);
		assert.ok(edgeFade(drawn[0].x + BAR_WIDTH / 2, width) < 1);
		assert.ok(edgeFade(drawn.at(-1).x + BAR_WIDTH / 2, width) < 1);
	}
});

/* ------------------------------------------------------------- the clock */

test("formatClock reads minutes:seconds, and unknown reads 0:00", () => {
	assert.equal(formatClock(0), "0:00");
	assert.equal(formatClock(7.9), "0:07");
	assert.equal(formatClock(59.99), "0:59");
	assert.equal(formatClock(60), "1:00");
	assert.equal(formatClock(125.4), "2:05");
	assert.equal(formatClock(Number.NaN), "0:00");
	assert.equal(formatClock(-3), "0:00");
	assert.equal(formatClock(Number.POSITIVE_INFINITY), "0:00");
});

/* -------------------------------------------------------------- integers */

test("a click maps x across the full width to seconds, clamped", () => {
	assert.equal(seekSecondsAt(0, 200, 10), 0);
	assert.equal(seekSecondsAt(100, 200, 10), 5);
	assert.equal(seekSecondsAt(200, 200, 10), 10);
	assert.equal(seekSecondsAt(-30, 200, 10), 0, "outside the left edge clamps");
	assert.equal(seekSecondsAt(500, 200, 10), 10, "outside the right clamps");
	// No duration yet: there is nowhere to seek, and no invented one.
	assert.equal(seekSecondsAt(100, 200, 0), 0);
	assert.equal(seekSecondsAt(100, 200, Number.NaN), 0);
	assert.equal(seekSecondsAt(100, 0, 10), 0);
});

test("progressFraction is the played share, clamped to 0..1", () => {
	assert.equal(progressFraction(0, 10), 0);
	assert.equal(progressFraction(5, 10), 0.5);
	assert.equal(progressFraction(10, 10), 1);
	assert.equal(progressFraction(20, 10), 1);
	assert.equal(progressFraction(-1, 10), 0);
	// No duration: no progress, never a divide-by-zero.
	assert.equal(progressFraction(4, 0), 0);
	assert.equal(progressFraction(Number.NaN, 10), 0);
});

/* ------------------------------------------------------------ aria text */

test("the slider's value text is time-valued at BOTH ends", () => {
	assert.equal(ariaValueText(0, 0), "0:00 of 0:00");
	assert.equal(ariaValueText(7, 12), "0:07 of 0:12");
	assert.equal(ariaValueText(75, 130), "1:15 of 2:10");
	// A bare number would be indistinguishable from a bar index; the sentence
	// says which end it is at, which is what a screen reader announces on drag.
	assert.equal(ariaValueText(Number.NaN, 12), "0:00 of 0:12");
});
