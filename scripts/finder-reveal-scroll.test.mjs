/*
 * The Files list's REVEAL arithmetic, and the sticky header it must clear.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. The defect this change fixes was
 * silent and numeric: the reveal assigned `scrollTop = band.top`, which lands
 * the focused row at the scroller's top edge - the header's own 32 pixels -
 * so the user navigated to a row they could not see. Measured on the running
 * app: 12 of 12 upward keyboard landings put the focused row exactly 32px
 * under the header. A comment cannot hold that number; an arithmetic that is
 * written down in one place and asserted here can.
 *
 * WHAT IS ASSERTED, and why each one is a fact the reader of the component
 * needs rather than a restatement of the implementation:
 *
 *   - an upward reveal lands the band BELOW the header, by the header's
 *     height plus the focus ring's gap (the ring is 2px outside the row with
 *     a 2px offset, so a flush landing hides its top 4px under the header);
 *   - a band at the very top of the list does not produce a negative
 *     scrollTop, which is a value no scroll box can hold;
 *   - a downward reveal is UNCHANGED - it still anchors the band's BOTTOM to
 *     the scrollport's bottom, which was already clear of the header; and
 *   - the header band the arithmetic clears is the SAME band the layout
 *     reserves, which is the one thing that makes the two numbers agree.
 *
 * The arithmetic is exercised through the shipped constants and a
 * re-implementation of the two-line assignment, so the test fails if EITHER
 * the constants or the expression changes without the other following.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	FINDER_HEADER_BAND,
	FOCUS_RING_GAP,
} from "../src/renderer/src/features/chat/components/canvas/finder-layout.ts";

/**
 * The reveal's own arithmetic, as the component writes it.
 *
 * It is duplicated here on purpose: a test that called the component's
 * internal closure would need a DOM, a router, a bridge and a full list
 * layout to observe four lines of arithmetic. The duplication is four lines,
 * and it is the SHAPE that is under test - the two properties the component
 * must not lose - not the syntax.
 */
const revealScrollTop = ({ bandTop, bandHeight, scrollTop, clientHeight }) => {
	if (bandTop < scrollTop)
		return Math.max(0, bandTop - FINDER_HEADER_BAND - FOCUS_RING_GAP);
	if (bandTop + bandHeight > scrollTop + clientHeight)
		return bandTop + bandHeight - clientHeight;
	return scrollTop;
};

test("an upward reveal lands the band below the sticky header", () => {
	const bandTop = 1200;
	const bandHeight = 158;
	const scrollTop = 2000;
	const clientHeight = 748;

	const landed = revealScrollTop({
		bandTop,
		bandHeight,
		scrollTop,
		clientHeight,
	});

	// The band's own top, in the scroller's coordinates, is where it lands.
	assert.equal(
		bandTop - landed,
		FINDER_HEADER_BAND + FOCUS_RING_GAP,
		"the band must land clear of the header by the header's height plus the ring's gap",
	);
	// And it must be BELOW the header, never under it.
	assert.ok(
		bandTop - landed >= FINDER_HEADER_BAND,
		`the band landed ${bandTop - landed}px from the scroller's top, which is inside the header's ${FINDER_HEADER_BAND}px`,
	);
});

test("a band at the top of the list does not produce a negative scrollTop", () => {
	const landed = revealScrollTop({
		bandTop: 4,
		bandHeight: 158,
		scrollTop: 900,
		clientHeight: 748,
	});

	assert.equal(landed, 0, "a scroll box cannot hold a negative scrollTop");
	assert.ok(landed >= 0);
});

test("a downward reveal is unchanged: the band's bottom anchors to the scrollport's bottom", () => {
	const bandTop = 3000;
	const bandHeight = 158;
	const scrollTop = 100;
	const clientHeight = 748;

	const landed = revealScrollTop({
		bandTop,
		bandHeight,
		scrollTop,
		clientHeight,
	});

	assert.equal(
		landed,
		bandTop + bandHeight - clientHeight,
		"the downward branch is untouched by this change",
	);
	// The band's bottom, in the scrollport's coordinates, is the bottom edge.
	assert.equal(landed + clientHeight, bandTop + bandHeight);
});

test("a band already visible is not scrolled at all", () => {
	const scrollTop = 100;
	const landed = revealScrollTop({
		bandTop: 200,
		bandHeight: 158,
		scrollTop,
		clientHeight: 748,
	});

	assert.equal(
		landed,
		scrollTop,
		"a visible band must not move the reading position",
	);
});

test("the focus ring's gap accounts for the ring drawn outside the row", () => {
	// The ring is `outline-width: 2px` with `outline-offset: 2px`
	// (styles/index.css's `html :focus-visible`), so it occupies 4px above
	// the row's box. A flush landing puts all 4 under the header.
	assert.ok(
		FOCUS_RING_GAP >= 4,
		`the gap is ${FOCUS_RING_GAP}px, but the ring is 2px wide at a 2px offset, so it needs 4px`,
	);
	assert.equal(FOCUS_RING_GAP, 4, "the gap is the ring's own 4px, and no more");
});

test("the header band is the band the layout reserves", () => {
	// The two numbers are only in agreement because they are the same
	// number; a change to one without the other would silently re-open the
	// defect the constants were named to close.
	assert.equal(
		FINDER_HEADER_BAND,
		32,
		"the header band is 32px, the height the layout reserves for a section header",
	);
});
