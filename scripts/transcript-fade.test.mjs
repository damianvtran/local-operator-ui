import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE FADE'S DEPTH IS ONE NUMBER ACROSS A BOUNDARY CSS CANNOT IMPORT ACROSS
 * (issue #680, design round 1's D1). The jump's landing inset and the rail's
 * reading line both derive from `TRANSCRIPT_TOP_FADE_PX`; `styles/index.css`
 * carries the same depth in three places - the scroll-linked ramp's `from`
 * stop, its `animation-range` offset, and the no-timeline fallback's mask
 * stop - because CSS cannot read a TS constant. This suite is the pin: edit
 * the fade and it fails until the constant moves with it. The failure mode it
 * exists to prevent is a landing that silently sits back inside the ramp (the
 * measured 189-vs-238 ink defect the design round rejected the first cut for).
 *
 * The constant is read from its module through esbuild (the pattern the other
 * bundles use); the stylesheet is read as text and the three spellings are
 * matched by their own shapes, not by line numbers.
 */

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/shared/lib/transcript-fade";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { TRANSCRIPT_TOP_FADE_PX } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const css = readFileSync("src/renderer/src/styles/index.css", "utf8");
const depth = `${TRANSCRIPT_TOP_FADE_PX}px`;

/* The three carriers, one pattern each, at the top level (the repo's
 * useTopLevelRegex rule: a regex built per call is the thing it forbids). */
const RAMP_STOP =
	/@keyframes transcript-top-fade\s*\{[\s\S]*?--lo-transcript-top-fade:\s*([\d.]+px)/;
const FALLBACK_STOP = /black\s+([\d.]+px),\s*\n?\s*black 100%/;
const RANGE_OFFSET = /animation-range:\s*calc\(100% - ([\d.]+px)\)\s+100%/;
const INERT_DEFAULT =
	/@property --lo-transcript-top-fade\s*\{[\s\S]*?initial-value:\s*0px/;

test("the stylesheet's fade depth is the shared constant, in all three carriers", () => {
	const ramp = RAMP_STOP.exec(css);
	assert.ok(ramp, "the scroll-linked ramp's from-stop is present");
	assert.equal(ramp[1], depth, "the ramp's depth");
	const fallback = FALLBACK_STOP.exec(css);
	assert.ok(fallback, "the no-timeline fallback's mask stop is present");
	assert.equal(fallback[1], depth, "the fallback's depth");
	const range = RANGE_OFFSET.exec(css);
	assert.ok(range, "the ramp's range offset is present");
	assert.equal(range[1], depth, "the range offset");
});

test("the registered property's inert default is zero, not the depth", () => {
	/*
	 * The `@property` initial value is the 'no fade' state (a short transcript
	 * or a scroll at the oldest end samples it), and the ramp carries the
	 * depth. A future edit that put the depth in the initial value would dim
	 * every non-overflowing conversation; this case makes that edit visible.
	 */
	assert.match(css, INERT_DEFAULT);
});
