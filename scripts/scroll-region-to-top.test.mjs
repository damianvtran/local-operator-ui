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
const { scrollRegionToTop, scrollRegionToCenter } = await import(
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

/*
 * ---- the reversed axis --------------------------------------------------
 *
 * The jump's landing (issue #680) calls this helper on the transcript's
 * `flex-col-reverse` scroller, where the low bound is not zero: the origin is
 * the BOTTOM (0 at the newest row, a negative bound at the oldest - the
 * measured contract in `use-scroll-paging.ts`). The clamp cases below pin that
 * the same offset arithmetic keeps its two legal shapes, the property
 * `scrollRegionToCenter` gained for the same reason (design round 1's D1).
 */

test("the inset lands the target's top below the region's, on both axes", () => {
	/*
	 * The jump passes `JUMP_ANCHOR_INSET_PX` (the transcript's top-fade depth,
	 * issue #680's D1): a row anchored at the bare top sits inside the mask's
	 * ramp and reads dimmed, so the helper places it `insetPx` BELOW the top.
	 * Normal axis: 0 + 124 - 0 - 0 - 24 = 100, i.e. the row's top (124) lands
	 * 24px under the region's top (100 - 100 + 24). Reversed axis: -600 +
	 * (-800 - 100 - 1) - 24 = -1525, the anchored landing plus the fade depth.
	 */
	const normal = regionStub({ scroll: 0, top: 0 });
	scrollRegionToTop(normal, targetStub(124), "normal", 24);
	assert.equal(normal.scrollTop, 100);
	const reversed = regionStub({ scroll: -600, top: 100, clientTop: 1 });
	scrollRegionToTop(reversed, targetStub(-800), "reversed", 24);
	assert.equal(reversed.scrollTop, -1525);
	/* The default stays the original place-at-the-top meaning. */
	const plain = regionStub({ scroll: 0, top: 0 });
	scrollRegionToTop(plain, targetStub(124));
	assert.equal(plain.scrollTop, 124);
});

test("the reversed axis takes the top-anchored offset and lets it go negative", () => {
	// The anchor's own geometry: the scroller parked at -600, the target row
	// 800px above it, a 1px border: -600 + (-800 - 100 - 1) = -1501, a value the
	// box CAN hold on this axis. A top anchor that clamped at zero here would be
	// the D1 no-op on the very axis the rail's jump lives on.
	const region = regionStub({ scroll: -600, top: 100, clientTop: 1 });
	scrollRegionToTop(region, targetStub(-800), "reversed");
	assert.equal(region.scrollTop, -1501);
});

test("the reversed axis clamps up at zero for a target toward the newest row", () => {
	// -100 + (500 - 100 - 0) = 300; on this axis the legal value nearest it is 0
	// (the newest-row origin), which is also the jump's documented boundary: a
	// target within a viewport of the newest rows lands at max scroll, the
	// closest achievable, rather than at an invented positive offset.
	const region = regionStub({ scroll: -100, top: 100 });
	scrollRegionToTop(region, targetStub(500), "reversed");
	assert.equal(region.scrollTop, 0);
});

/*
 * ---- the centre sibling -------------------------------------------------
 *
 * `scrollRegionToCenter` (the checkpoint rail's jump, design §D7 stage 3)
 * shares the walk and gains one term:
 *
 *   offset = region.scrollTop + target.top - region.top - region.clientTop
 *            - (region.clientHeight - target.height) / 2
 *
 * Each new term gets a case that fails if that term alone is removed, the
 * same property the cases above hold themselves to. The stubs grow the two
 * fields the extra term reads (`clientHeight`, `height`) and nothing else;
 * jsdom has no layout, so this is the whole geometry the helper can see.
 */

/** The same region stub, with the scrollport height the centre term reads. */
const regionCentreStub = ({
	scroll = 0,
	top = 0,
	clientTop = 0,
	clientHeight,
}) => ({
	scrollTop: scroll,
	clientTop,
	clientHeight,
	getBoundingClientRect: () => ({ top, left: 0 }),
});

/** The same target stub, with the height the centre term reads. */
const targetCentreStub = (top, height) => ({
	getBoundingClientRect: () => ({ top, left: 0, height }),
});

test("a target is brought to the region's middle, not its top", () => {
	// 439 is the top-aligned offset (40 + 500 - 100 - 1); centring a 100px target
	// in a 600px scrollport takes off (600 - 100) / 2 = 250 -> 189.
	const region = regionCentreStub({
		scroll: 40,
		top: 100,
		clientTop: 1,
		clientHeight: 600,
	});
	scrollRegionToCenter(region, targetCentreStub(500, 100));
	assert.equal(region.scrollTop, 189);
});

test("the region's own border is subtracted here too", () => {
	// Same geometry with no border: 40 + 500 - 100 = 440, less 250 -> 190. A
	// helper that dropped `clientTop` cannot answer both this and the case above.
	const region = regionCentreStub({
		scroll: 40,
		top: 100,
		clientTop: 0,
		clientHeight: 600,
	});
	scrollRegionToCenter(region, targetCentreStub(500, 100));
	assert.equal(region.scrollTop, 190);
});

test("the centre term reads BOTH heights", () => {
	// 500 - (300 - 40) / 2 = 370. Dropping the target's half yields 500 - 150 =
	// 350; dropping the region's yields 500 + 20 = 520. One number, both terms.
	const region = regionCentreStub({
		scroll: 0,
		top: 0,
		clientTop: 0,
		clientHeight: 300,
	});
	scrollRegionToCenter(region, targetCentreStub(500, 40));
	assert.equal(region.scrollTop, 370);
});

test("a target already at the region's middle is a no-op", () => {
	// The target's viewport top is exactly the centre term below the region's
	// padding-box top (351 - 100 - 1 = 250), while the region is scrolled to
	// that offset: the assignment is ABSOLUTE, like the top sibling's no-op.
	const region = regionCentreStub({
		scroll: 186,
		top: 100,
		clientTop: 1,
		clientHeight: 600,
	});
	scrollRegionToCenter(region, targetCentreStub(351, 100));
	assert.equal(region.scrollTop, 186);
});

test("a target above the middle clamps at zero rather than going negative", () => {
	// 40 + 20 - 100 - 0 - 250 = -290, which is a `scrollTop` no box can hold.
	const region = regionCentreStub({
		scroll: 40,
		top: 100,
		clientTop: 0,
		clientHeight: 600,
	});
	scrollRegionToCenter(region, targetCentreStub(20, 100));
	assert.equal(region.scrollTop, 0);
});

test("the reversed axis takes the same offset and lets it go negative", () => {
	// D1's own geometry on the transcript's axis: identical numbers to the
	// normal-axis clamp case above (40 + 20 - 100 - 0 - 250 = -290), but on a
	// `flex-col-reverse` box -290 is a value the box CAN hold (0 at the newest
	// row, a negative bound at the oldest), so the assignment must land it
	// rather than clamping to zero. That clamp was the defect design round 1
	// measured: the landing frames showed the wash painted off-screen over
	// pixel-identical bubble positions while the scene's attribute check
	// passed honestly.
	const region = regionCentreStub({
		scroll: 40,
		top: 100,
		clientTop: 0,
		clientHeight: 600,
	});
	scrollRegionToCenter(region, targetCentreStub(20, 100), "reversed");
	assert.equal(region.scrollTop, -290);
});

test("the reversed axis clamps up at zero for a target toward the newest row", () => {
	// -100 + 500 - 100 - 0 - 250 = 50; on this axis the legal value nearest it
	// is 0 (the newest-row origin), exactly as the browser's own bound would
	// hold it - not a value the caller invents.
	const region = regionCentreStub({
		scroll: -100,
		top: 100,
		clientTop: 0,
		clientHeight: 600,
	});
	scrollRegionToCenter(region, targetCentreStub(500, 100), "reversed");
	assert.equal(region.scrollTop, 0);
});
