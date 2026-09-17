import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The reveal's arithmetic, pinned against a duck-typed stub.
 *
 * `shared/lib/scroll.ts` owns the rule this repository had to learn twice: move
 * ONE scroll region and move nothing else. Until this file existed the rule was
 * pinned only by source TEXT — the call exists, the pane's ref exists, the
 * ancestor walk is gone (`composer-tabs.test.mjs`) — which left the arithmetic
 * itself free to rot silently: deleting `- region.clientTop`, replacing the
 * `region.scrollTop +` term with `0`, or measuring the target against the page
 * instead of the region all kept every gate green, and the only thing holding
 * the numbers was the evidence table in a README.
 *
 * The helper touches `scrollTop`, `getBoundingClientRect()` and `clientTop` and
 * nothing else, so a stub pins the whole contract without a DOM. This tree has a
 * stated reason for carrying no DOM harness; this test needs none.
 *
 * Each of the four terms is asserted by a case that fails if that term alone is
 * removed, which is the property that makes this a pin rather than a restatement:
 *
 *   offset = region.scrollTop + target.top - region.top - region.clientTop
 *
 * `region.clientTop` is the region's BORDER, and the term exists because a box's
 * `getBoundingClientRect()` starts at its border box while the scroll origin is
 * its padding box: without it the reveal lands one border too low.
 */

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/shared/lib/scroll";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { scrollRegionToTop } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/**
 * A scroll region, as much of one as the helper reads. `top` is the region's
 * border-box top in viewport coordinates, `clientTop` its top border width, and
 * `scroll` its current position; the returned object records what was assigned.
 */
const regionStub = ({ scroll = 0, top = 0, clientTop = 0 }) => ({
	scrollTop: scroll,
	clientTop,
	getBoundingClientRect: () => ({ top, left: 0 }),
});

/** A target, as much of one as the helper reads. */
const targetStub = (top) => ({
	getBoundingClientRect: () => ({ top, left: 0 }),
});

test("a target below the region's content top is brought to it", () => {
	// 120px below the region's padding-box top, with the region already 40px down
	// and a 1px top border: 40 + 221 - 100 - 1 = 160.
	const region = regionStub({ scroll: 40, top: 100, clientTop: 1 });
	scrollRegionToTop(region, targetStub(221));
	assert.equal(region.scrollTop, 160);
});

test("the region's own border is subtracted, not ignored", () => {
	// Same geometry with no border: 40 + 221 - 100 = 161. A helper that dropped
	// `clientTop` cannot answer both this and the case above.
	const region = regionStub({ scroll: 40, top: 100, clientTop: 0 });
	scrollRegionToTop(region, targetStub(221));
	assert.equal(region.scrollTop, 161);
});

test("the offset is measured inside the region, not from the page", () => {
	// The same target at the same viewport position under two regions parked at
	// different places: the answer moves with the REGION, which is what makes the
	// reveal scroll that box and no ancestor.
	const upper = regionStub({ scroll: 0, top: 100, clientTop: 0 });
	scrollRegionToTop(upper, targetStub(300));
	const lower = regionStub({ scroll: 0, top: 400, clientTop: 0 });
	scrollRegionToTop(lower, targetStub(300));
	assert.equal(upper.scrollTop, 200);
	assert.equal(lower.scrollTop, 0);
});

test("the current position is included in the measurement, not added to it", () => {
	// 40 + 260 - 100 - 0 = 200: the region is already 40px down and the target
	// sits 160px into its content box, so an assignment that dropped the
	// `region.scrollTop` term would land the section 40px short of the head.
	const region = regionStub({ scroll: 40, top: 100, clientTop: 0 });
	scrollRegionToTop(region, targetStub(260));
	assert.equal(region.scrollTop, 200);
});

test("a target above the content top assigns zero rather than a negative", () => {
	/*
	 * Round 2's R2-5, and the reason this case exists at all: the case that used to
	 * carry this name computed `40 + 60 - 100 - 0`, which is 0 with or WITHOUT the
	 * low clamp — so the term the name claimed was pinned by a case that could not
	 * fail on it. This one cannot pass with the clamp removed: the raw value is
	 * NEGATIVE (`40 + 20 - 100 = -40`), which is a `scrollTop` no box can hold, and
	 * the clamp is the only thing between the arithmetic and that assignment.
	 */
	const above = regionStub({ scroll: 0, top: 100, clientTop: 0 });
	scrollRegionToTop(above, targetStub(60));
	assert.equal(above.scrollTop, 0);
	const scrolled = regionStub({ scroll: 40, top: 100, clientTop: 0 });
	scrollRegionToTop(scrolled, targetStub(20));
	assert.equal(scrolled.scrollTop, 0);
});

test("a target already flush with the content top is a no-op", () => {
	// The target's top sits at the region's padding-box top (border 1), while the
	// region is scrolled to exactly that offset: 186 + 101 - 100 - 1 = 186, i.e. the
	// assignment is ABSOLUTE and re-applying it does not move anything.
	const region = regionStub({ scroll: 186, top: 100, clientTop: 1 });
	scrollRegionToTop(region, targetStub(101));
	assert.equal(region.scrollTop, 186);
});
