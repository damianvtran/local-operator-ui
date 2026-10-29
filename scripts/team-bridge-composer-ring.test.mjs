import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * Team Bridge's composer focus ring keeps the room it is drawn in.
 *
 * WHY THIS EXISTS. A composer draws its ring OUTSIDE the box (`outline-2` at
 * `outline-offset-2`: 2px wide, 2px out = 4px beyond it), and an overflow
 * container clips at its PADDING box. The page's box used to sit in an
 * `overflow-y-auto` container that bounded its recovery alerts; that container
 * had `px-4 pb-4` and no top padding, so the ring drew on three sides and lost
 * its top edge - the operator's report. `pt-1` (4px) was the room.
 *
 * WHAT CHANGED, AND WHY THIS FILE CHANGED WITH IT. The page no longer draws a
 * composer: it mounts the shared `MessageInput`, which draws its own box and
 * ring. The room is therefore no longer a padding question - it is a question of
 * whether ANY ancestor clips the band at all, and the answer this pins is NO
 * (design risk R3): the band that holds the composer has no `max-height` and no
 * `overflow`, so there is nothing to clip the ring and nothing that turns the
 * composer into a nested scroller. The recovery alerts that the old scroller
 * bounded sit above the box instead.
 *
 * WHAT THIS PINS, AND WHAT IT CANNOT: it reads the source, so it cannot tell
 * where the band lands on screen. The before/after frames and the geometry
 * readback in the PR are what answer that; this is what fails when someone
 * re-wraps the band in a scroller, which is how the ring loses an edge again
 * without anyone noticing (`integration-model.test.mjs` pins the same class for
 * the integration dialogs).
 */
const RING =
	"has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-solid";

const TOP_PADDING = /(?:^|\s)(?:pt|py|p)-(\d+(?:\.5)?)(?=\s|$)/g;
const OVERFLOW_Y_AUTO = /\boverflow-y-auto\b/;
const CX_4 = /\bpx-4\b/;
const PB_4 = /\bpb-4\b/;
const ANY_OVERFLOW = /\boverflow-/;
const ANY_MAX_HEIGHT = /\bmax-h-/;
const CONFLICTING_TOP_PADDING = /conflicting top padding utilities/;
const LITERAL_DIV_CLASS = /<div\s+className="([^"]*)"/g;
const IMPORT_MESSAGE_INPUT =
	/import\s*\{[^}]*\bMessageInput\b[^}]*\}\s*from\s*"@shared\/components\/composer"/;
const RENDER_MESSAGE_INPUT = /<MessageInput\b/;

const topPaddingPx = (className) => {
	const values = [...className.matchAll(TOP_PADDING)].map(
		(match) => Number(match[1]) * 4,
	);
	// Later Tailwind utilities can override earlier ones. Reading only the
	// first would let `pt-1 ... pt-0` pass while the ring is still clipped.
	assert.ok(
		new Set(values).size <= 1,
		`conflicting top padding utilities in (${className})`,
	);
	return values[0] ?? 0;
};

/** The className of the closest `overflow-*` element opened before `index`. */
const enclosingScroller = (source, index) => {
	const before = source.slice(0, index);
	const opens = [...before.matchAll(/className="([^"]*\boverflow-[^"]*)"/g)];
	return opens.at(-1)?.[1];
};

const page = readFileSync(
	"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
	"utf8",
);

test("the page mounts the shared composer instead of drawing one", () => {
	assert.match(
		page,
		IMPORT_MESSAGE_INPUT,
		"the page imports MessageInput from the shared composer",
	);
	assert.match(
		page,
		RENDER_MESSAGE_INPUT,
		"the page renders its own <MessageInput />",
	);
	// A second composer beside the shared one is the defect this change exists to
	// remove: the bespoke textarea, its strip and its attach button are all gone.
	assert.equal(
		page.match(/<textarea/g)?.length ?? 0,
		0,
		"the page draws no textarea of its own",
	);
	assert.equal(
		page.match(/TeamBridgeAttachButton/g)?.length ?? 0,
		0,
		"the page renders no bridge attach button",
	);
	assert.equal(
		page.match(/TeamBridgeAttachmentStrip/g)?.length ?? 0,
		0,
		"the page renders no bridge attachment strip",
	);
	assert.equal(
		page.indexOf(RING),
		-1,
		"the page no longer promotes the ring itself - the shared composer owns it",
	);
});

test("the composer's band clips nothing and pins no height (R3)", () => {
	const mount = page.indexOf("<MessageInput");
	assert.notEqual(mount, -1);
	// The band is the literal div that opens the block the composer sits in; the
	// alerts between the two are paragraphs, so this is that element.
	const band = [...page.slice(0, mount).matchAll(LITERAL_DIV_CLASS)].at(
		-1,
	)?.[1];
	assert.ok(band, "the composer has a band");
	assert.doesNotMatch(band, ANY_MAX_HEIGHT, `band pins a height (${band})`);
	assert.doesNotMatch(band, ANY_OVERFLOW, `band clips (${band})`);
	// Room is still owed: the ring paints 4px outside the box, and the band's own
	// padding box is where a clip would bite if one were ever added back.
	assert.ok(
		topPaddingPx(band) >= 4,
		`the band pads its top ${topPaddingPx(band)}px but the ring paints 4px outside the box (${band})`,
	);
	assert.match(band, CX_4);
	assert.match(band, PB_4);
	// The bounded scroller this change removed must not come back: it was the only
	// ancestor clipping at a height the composer did not control.
	assert.equal(
		page.indexOf("max-h-[60%]"),
		-1,
		"the old max-height scroller around the composer is gone",
	);
});

test("conflicting top-padding utilities fail the ring-room check", () => {
	assert.throws(
		() => topPaddingPx("overflow-y-auto px-4 pt-1 pb-4 pt-0"),
		CONFLICTING_TOP_PADDING,
	);
});

test("the thread pane composer keeps its own ring room if it clips", () => {
	const pane = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-thread-pane.tsx",
		"utf8",
	);
	const ring = pane.indexOf(RING);
	assert.notEqual(ring, -1, "the pane composer still draws the promoted ring");
	// The wrapper is the `shrink-0 px-4 pb-4` div right above it; if it ever
	// gains an overflow, it needs the same top room the page's band has.
	const wrapper = [...pane.slice(0, ring).matchAll(LITERAL_DIV_CLASS)].at(
		-1,
	)?.[1];
	assert.ok(wrapper, "the pane composer has a wrapper");
	if (ANY_OVERFLOW.test(wrapper))
		assert.ok(
			topPaddingPx(wrapper) >= 2 + 2,
			`the pane wrapper clips but pads its top only ${topPaddingPx(wrapper)}px (${wrapper})`,
		);
});

test("an overflow band above the composer is caught", () => {
	// Negative control for the assertion above: the same lookup, on a source shape
	// this change removed, must find the scroller.
	const removed = `<div className="min-h-0 max-h-[60%] shrink-0 overflow-y-auto px-4 pt-1 pb-4">
	<MessageInput />`;
	const found = enclosingScroller(removed, removed.indexOf("<MessageInput"));
	assert.ok(found, "the lookup still detects a scroller above the composer");
	assert.match(found, OVERFLOW_Y_AUTO);
});
