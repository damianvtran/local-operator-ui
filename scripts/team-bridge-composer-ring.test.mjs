import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * Team Bridge's composer focus ring keeps the room it is drawn in.
 *
 * WHY THIS EXISTS. The composer box draws its ring OUTSIDE itself
 * (`outline-2` at `outline-offset-2`: 2px wide, 2px out = 4px beyond the box),
 * promoted from the textarea via `:has`. On the page, the box sits in an
 * `overflow-y-auto` container (it bounds the recovery alerts so they cannot
 * eat the timeline), and an overflow container clips at its PADDING box. That
 * container had `px-4 pb-4` and no top padding, so the ring drew on three sides
 * and lost its top edge - the operator's report. `pt-1` (4px) is the room.
 *
 * WHAT THIS PINS, AND WHAT IT CANNOT: it reads the source, so it cannot tell
 * whether the padding lands on the element that clips. The before/after frames
 * and the geometry readback in the PR are what answer that; this is what fails
 * when the room is dropped in a refactor, which is how a ring loses an edge
 * without anyone noticing (`integration-model.test.mjs` pins the same class for
 * the integration dialogs).
 */
const RING =
	"has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-solid";

// Tailwind's spacing scale is 4px per unit; the ring needs width + offset.
const RING_EXTENT_PX = 2 + 2;
const TOP_PADDING = /(?:^|\s)(?:pt|py|p)-(\d+(?:\.5)?)(?=\s|$)/;
const OVERFLOW_Y_AUTO = /\boverflow-y-auto\b/;
const PX_4 = /\bpx-4\b/;
const PB_4 = /\bpb-4\b/;
const ANY_OVERFLOW = /\boverflow-/;
const topPaddingPx = (className) => {
	const match = className.match(TOP_PADDING);
	return match ? Number(match[1]) * 4 : 0;
};

/** The className of the closest `overflow-*` element opened before `index`. */
const enclosingScroller = (source, index) => {
	const before = source.slice(0, index);
	const opens = [...before.matchAll(/className="([^"]*\boverflow-[^"]*)"/g)];
	return opens.at(-1)?.[1];
};

test("the page composer's scroller pads its top edge for the ring", () => {
	const page = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		"utf8",
	);
	const ring = page.indexOf(RING);
	assert.notEqual(ring, -1, "the page composer still draws the promoted ring");
	const scroller = enclosingScroller(page, ring);
	assert.ok(scroller, "the composer still sits in its bounded scroller");
	assert.match(scroller, OVERFLOW_Y_AUTO);
	assert.ok(
		topPaddingPx(scroller) >= RING_EXTENT_PX,
		`the scroller's top padding is ${topPaddingPx(scroller)}px but the ring paints ${RING_EXTENT_PX}px outside the box (${scroller})`,
	);
	// The sides and bottom already had the room; keep them at least as wide.
	assert.match(scroller, PX_4);
	assert.match(scroller, PB_4);
});

test("the thread pane's composer is not inside a clipping container", () => {
	const pane = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-thread-pane.tsx",
		"utf8",
	);
	const ring = pane.indexOf(RING);
	assert.notEqual(ring, -1, "the pane composer still draws the promoted ring");
	// The wrapper is the `shrink-0 px-4 pb-4` div right above it; if it ever
	// gains an overflow, it needs the same top room the page's scroller has.
	const wrapper = [
		...pane.slice(0, ring).matchAll(/<div\s+className="([^"]*)"/g),
	].at(-1)?.[1];
	assert.ok(wrapper, "the pane composer has a wrapper");
	if (ANY_OVERFLOW.test(wrapper))
		assert.ok(
			topPaddingPx(wrapper) >= RING_EXTENT_PX,
			`the pane wrapper clips but pads its top only ${topPaddingPx(wrapper)}px (${wrapper})`,
		);
});
