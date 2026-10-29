import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * Team Bridge's composer focus ring keeps the room it is drawn in.
 *
 * WHY THIS EXISTS. A composer draws its ring OUTSIDE the box (`outline-2` at
 * `outline-offset-2`: 2px wide, 2px out = 4px beyond it), and an overflow
 * container clips at its PADDING box. The page's box used to sit in a bounded
 * scroller (`min-h-0 max-h-[60%] overflow-y-auto`) that clipped the ring's top
 * edge - the operator's report. `pt-1` (4px) was the room.
 *
 * WHAT CHANGED, AND WHY THIS FILE CHANGED WITH IT. The page no longer draws a
 * composer: it mounts the shared `MessageInput`, which draws its own box and ring
 * and BOUNDS ITS OWN growable parts, which is why hosting it inside a scroller is
 * wrong rather than merely tight - a bounded ancestor re-introduces the clipped
 * ring and nests a second scroller. So the assertion is about ANCESTORS: no
 * element that encloses the composer mount may be a bounded scroller
 * (`max-h-*` together with an `overflow-*` that actually clips y).
 *
 * FAIL-CLOSED, WHICH THE FIRST VERSION WAS NOT (review round 1, R1-5): it read
 * only the nearest literal div before the mount, so re-wrapping the band in a NEW
 * scroller (`max-h-[70%] overflow-y-auto`) left every test green while the header
 * claimed to catch exactly that. This version walks EVERY div that is still open
 * at the mount - an enclosing div is one with more `<div` than `</div>` between it
 * and the mount - and the negative control runs the same predicate over the shape
 * this change removed.
 *
 * WHAT THIS STILL CANNOT SEE: a component that renders a scroller (`<ScrollArea>`,
 * a panel primitive) is not a literal div here. The before/after frames and the
 * geometry readback in the PR are what answer the rendered question; this is what
 * fails when the band is re-wrapped by hand.
 */
const RING =
	"has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-solid";

const TOP_PADDING = /(?:^|\s)(?:pt|py|p)-(\d+(?:\.5)?)(?=\s|$)/g;
/** Utilities that actually clip the y axis. `overflow-hidden` on a panel root is
 * the app's standard panel clip and is not what this rule is about: it only bites a
 * box that is also bounded, which is the shape that clipped the ring. */
const CLIPS_Y = /\boverflow-(?:y-auto|y-scroll|y-hidden|auto|scroll|hidden)\b/;
const BOUNDED = /\bmax-h-/;
const LITERAL_DIV_OPEN = /<div\s+className="([^"]*)"/g;
const OPEN_DIV = /<div\b/g;
const CLOSE_DIV = /<\/div>/g;

/**
 * The px value of the FIRST top-padding utility - and a refusal to answer when the
 * class string carries more than one DISTINCT value.
 *
 * WHY A CONFLICT IS AN ERROR RATHER THAN "LAST WINS" (review round 2, R2-2). Taking
 * the first match made `pt-4 pt-0` read 16px and pass the ring-room assertion, which
 * is the fail-open shape: the box would have no room while the test said it did. A
 * conflict cannot be resolved honestly from source without reproducing Tailwind's
 * ordering rules, so the reader refuses instead - and the band assertion then fails
 * on a band nobody can measure.
 */
const CONFLICTING_PADDING = /conflicting padding utilities/;
const measure = (values, className) => {
	const distinct = [...new Set(values)];
	assert.ok(distinct.length <= 1, `${CONFLICTING_PADDING} in (${className})`);
	return distinct[0] ?? 0;
};
const topPaddingPx = (className) =>
	measure(
		[...className.matchAll(TOP_PADDING)].map((match) => Number(match[1]) * 4),
		className,
	);

const BOTTOM_PADDING = /(?:^|\s)(?:pb|py|p)-(\d+(?:\.5)?)(?=\s|$)/g;
const bottomPaddingPx = (className) =>
	measure(
		[...className.matchAll(BOTTOM_PADDING)].map(
			(match) => Number(match[1]) * 4,
		),
		className,
	);

/**
 * Every literal `<div className="…">` still OPEN at `index`, i.e. the ones that
 * enclose that point. Counted textually because this is a source pin: a div with
 * more opens than closes between its own tag and the index has not closed yet.
 */
const enclosingDivs = (source, index) => {
	const before = source.slice(0, index);
	const enclosing = [];
	for (const match of before.matchAll(LITERAL_DIV_OPEN)) {
		const body = before.slice(match.index);
		const opens = (body.match(OPEN_DIV) ?? []).length;
		const closes = (body.match(CLOSE_DIV) ?? []).length;
		if (opens > closes) enclosing.push(match[1]);
	}
	return enclosing;
};

/** The rule under test, over a source and the index of a composer mount. */
const boundedScrollersAround = (source, index) =>
	enclosingDivs(source, index).filter(
		(className) => BOUNDED.test(className) && CLIPS_Y.test(className),
	);

const page = readFileSync(
	"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
	"utf8",
);

const IMPORT_MESSAGE_INPUT =
	/import\s*\{[^}]*\bMessageInput\b[^}]*\}\s*from\s*"@shared\/components\/composer"/;
const RENDER_MESSAGE_INPUT = /<MessageInput\b/;
const PX_4 = /\bpx-4\b/;

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

test("no bounded scroller encloses the composer (R3)", () => {
	const mount = page.indexOf("<MessageInput");
	assert.notEqual(mount, -1);
	const bounded = boundedScrollersAround(page, mount);
	assert.deepEqual(
		bounded,
		[],
		`a bounded scroller encloses the composer: ${bounded.join(" | ")}`,
	);
	// Some div must enclose the mount, or the walk found nothing and the assertion
	// above would pass for the wrong reason.
	assert.ok(
		enclosingDivs(page, mount).length > 0,
		"the walk finds the composer's own band",
	);
});

test("the composer's band carries the ring room and adds no second bottom inset", () => {
	const mount = page.indexOf("<MessageInput");
	// The band is the literal div that opens the block the composer sits in; the
	// alerts between the two are paragraphs, so this is that element.
	const band = [...page.slice(0, mount).matchAll(LITERAL_DIV_OPEN)].at(-1)?.[1];
	assert.ok(band, "the composer has a band");
	assert.doesNotMatch(band, BOUNDED, `band pins a height (${band})`);
	assert.doesNotMatch(band, CLIPS_Y, `band clips (${band})`);
	// Room is still owed: the ring paints 4px outside the box, into the band's own
	// padding box.
	assert.ok(
		topPaddingPx(band) >= 4,
		`the band pads its top ${topPaddingPx(band)}px but the ring paints 4px outside the box (${band})`,
	);
	assert.match(band, PX_4);
	// ONE bottom inset (review round 1, R1-8): the composer's own band supplies it,
	// so the host band must not add a second.
	assert.equal(
		bottomPaddingPx(band),
		0,
		`the host band adds its own bottom padding on top of the composer's (${band})`,
	);
	assert.equal(page.indexOf("max-h-[60%]"), -1, "the old scroller is gone");
});

test("the padding readers measure what the utilities say", () => {
	assert.equal(topPaddingPx("px-4 pt-1 pb-4"), 4);
	assert.equal(bottomPaddingPx("px-4 pt-1 pb-4"), 16);
	assert.equal(bottomPaddingPx("px-4 py-2"), 8);
	assert.equal(bottomPaddingPx("px-4 pt-1"), 0);
});

test("a conflicting padding pair is refused, not read as room (negative control)", () => {
	// The fail-open shape R2-2 reproduced: `pt-4 pt-0` leaves the box with no room
	// while a first-match reader reports 16px.
	assert.throws(
		() => topPaddingPx("overflow-y-auto px-4 pt-4 pt-0 pb-4"),
		CONFLICTING_PADDING,
	);
	assert.throws(() => bottomPaddingPx("px-4 pb-4 pb-0"), CONFLICTING_PADDING);
	// A repeated identical value is not a conflict.
	assert.equal(topPaddingPx("px-4 pt-1 pt-1"), 4);
});

test("a re-wrapped band fails the ancestor rule (negative control)", () => {
	// The exact regression R1-5 reproduced: the band itself is untouched and a NEW
	// scroller is added around it. Both class strings below are the shapes this
	// change removed and the re-wrap the review tried.
	for (const wrapper of [
		"min-h-0 max-h-[60%] shrink-0 overflow-y-auto px-4 pt-1 pb-4",
		"min-h-0 max-h-[70%] shrink-0 overflow-y-auto",
	]) {
		const rewrapped = `<section>\n<div className="${wrapper}">\n<div className="flex min-w-0 shrink-0 flex-col gap-2 px-4 pt-1">\n<MessageInput />`;
		const found = boundedScrollersAround(
			rewrapped,
			rewrapped.indexOf("<MessageInput"),
		);
		assert.deepEqual(
			found,
			[wrapper],
			`the ancestor rule misses a band re-wrapped in (${wrapper})`,
		);
	}
	// And it must not fire on a plain column, or every future cleanup would chase a
	// false positive.
	const plain = `<section>\n<div className="flex min-h-0 min-w-0 flex-1 flex-col">\n<div className="flex min-w-0 shrink-0 flex-col gap-2 px-4 pt-1">\n<MessageInput />`;
	assert.deepEqual(
		boundedScrollersAround(plain, plain.indexOf("<MessageInput")),
		[],
	);
});

test("the thread pane composer keeps its own ring room if it clips", () => {
	const pane = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-thread-pane.tsx",
		"utf8",
	);
	const ring = pane.indexOf(RING);
	assert.notEqual(ring, -1, "the pane composer still draws the promoted ring");
	// The wrapper is the literal div right above it; if it ever gains a bounded
	// scroll of its own, it needs the same top room the page's band has.
	const wrapper = [...pane.slice(0, ring).matchAll(LITERAL_DIV_OPEN)].at(
		-1,
	)?.[1];
	assert.ok(wrapper, "the pane composer has a wrapper");
	if (CLIPS_Y.test(wrapper))
		assert.ok(
			topPaddingPx(wrapper) >= 2 + 2,
			`the pane wrapper clips but pads its top only ${topPaddingPx(wrapper)}px (${wrapper})`,
		);
});
