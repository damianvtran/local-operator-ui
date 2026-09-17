import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The rules behind the transcript's Quote toolkit, asserted rather than judged
 * from a frame.
 *
 * Four things live here, and they are the ones a frame cannot settle:
 *
 * 1. WHICH ROWS OFFER QUOTE (`isQuotable`) - prose only, nothing streaming,
 *    nothing empty. A frame shows the toolkit on one row; it cannot show its
 *    absence on the twenty kinds of row that must not have it.
 * 2. WHICH HIGHLIGHT IS A QUOTE OF WHICH TURN, WHAT IT CARRIES AND WHAT IT IS
 *    PLACED AGAINST (`quoteSelectionIn`) - the part of the reader's highlight
 *    that lies in this turn, only when the highlight BEGINS in it, never the
 *    `<reply-to>` transport markup, and the LINES the control is measured
 *    against, which are the whole highlight's and never this control's own box
 *    (round 1: M1, U9, Q27 - see the idempotence test below). faked here rather
 *    than driven in a browser because the question is a comparison of node
 *    identities and boxes, not a paint. The one rule
 *    replaces the three this file used to assert (`selectionTextIn`,
 *    `selectionClippedTo`, `quoteText`): nothing raises the control without a
 *    highlight now, so the whole-turn fallback those three existed to bound has
 *    no caller left, and the empty case they argued about is answered by there
 *    being no control at all.
 * 3. WHERE THAT CONTROL FLOATS (`placeQuoteControl`) - the flip when the
 *    highlight's own first line is at the pane's top edge, the clamps that keep
 *    it inside the scroller and the window, and the hide when that line is off
 *    screen. Pure boxes, so the cases a frame cannot reach - the row just above
 *    the fold - are asserted here instead.
 * 4. THE ROUND TRIP through the shipped send path - `buildSendPayload` prefixes
 *    the markup and `parseReplies` takes it back out, so a staged quote really
 *    is what the next send carries and the sent turn really does render a quote
 *    block instead of raw tags. Asserted against the SHIPPED functions rather
 *    than against a copy of the format, because a copy is what drifts. The
 *    shapes exercised are the ones that OCCUR - multi-paragraph quotes, a drag
 *    across a line break, and prose that merely MENTIONS the markup - because a
 *    guard built from the one input shape that works is not a guard.
 *
 * The store bundle below reuses `canonical-chat.test.mjs`'s fixture plugin: the
 * store's only outside contact is the desktop transport and the echo registry,
 * and both are aliased rather than mocked so the module under test is the
 * shipped one.
 */

const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
globalThis.__canonicalRequest = async () => ({});
globalThis.__canonicalEcho = () => undefined;
/* `toolkitAncestor` inside `quoteSelectionIn` tests `nodeType` against
 * `Node.ELEMENT_NODE`; node has no DOM. */
globalThis.Node = { ELEMENT_NODE: 1 };

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/quote-model";',
			'export * from "./src/renderer/src/features/chat/canonical/quote-anchor";',
			'export { parseReplies } from "./src/renderer/src/features/chat/utils/reply-utils";',
			'export { buildSendPayload } from "./src/renderer/src/shared/store/canonical-sessions-store";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "canonical-transport-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "fixture" }),
				);
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const discardPendingEchoes = () => undefined;`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = request => globalThis.__canonicalRequest(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const {
	isQuotable,
	quoteSelectionIn,
	QUOTE_TOOLKIT_ATTR,
	placeQuoteControl,
	overlap,
	QUOTE_CONTROL_GAP,
	parseReplies,
	buildSendPayload,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/* ---- fixtures ---------------------------------------------------------- */

const userRow = (text, extra = {}) => ({
	kind: "user",
	id: "u1",
	ts: 1,
	text,
	images: [],
	...extra,
});
const assistantRow = (text, extra = {}) => ({
	kind: "assistant",
	id: "a1",
	ts: 2,
	text,
	streaming: false,
	stopReason: null,
	error: false,
	complete: true,
	...extra,
});

/* ---- which rows offer Quote -------------------------------------------- */

/**
 * `isQuotable` as the rows call it: the record, and the BODY it would offer.
 *
 * The body is the row's text with the reply markup taken out, which is the same
 * string for every row that does not carry a reply - so it defaults to the text
 * and the tests that are about the body pass one explicitly.
 */
const offers = (record, body = record.text) => isQuotable(record, body);

test("a user turn with words offers a quote", () => {
	assert.equal(offers(userRow("Why did the second row fail?")), true);
});

test("a settled assistant answer offers a quote", () => {
	assert.equal(offers(assistantRow("Because the schema moved.")), true);
});

test("a streaming assistant row does not: a prefix is not a claim", () => {
	assert.equal(
		offers(assistantRow("Because the sch", { streaming: true })),
		false,
	);
});

test("a row with no text at all does not, on either kind", () => {
	assert.equal(offers(userRow("   \n  ")), false);
	assert.equal(offers(assistantRow("")), false);
});

test("a turn whose whole text is reply markup offers nothing to quote", () => {
	// A user who types the tag literally. Its RAW text is non-empty, so a rule
	// that read `record.text` mounted a control whose press was a silent no-op -
	// An empty body has no ink to highlight, so there is nothing to mount. The
	// rule reads the body for exactly that reason.
	const row = userRow("<reply-to>x</reply-to>");
	const { remainingContent } = parseReplies(row.text);
	assert.equal(row.text.trim().length > 0, true);
	assert.equal(remainingContent, "");
	// The same record read the way the call site used to read it: the raw text
	// still says "there are words here", which is why the control mounted.
	assert.equal(isQuotable(row, row.text), true);
	// Read the body the row actually offers, there is nothing to mount - and
	// there would be no ink to highlight under the pointer either.
	assert.equal(isQuotable(row, remainingContent), false);
});

test("ledger and receipt rows do not, whatever they carry", () => {
	const others = [
		{ kind: "tool", text: "reading file" },
		{ kind: "notice", text: "picked up where it left off" },
		{ kind: "peer", text: "another agent asked something" },
		{ kind: "wake", text: "woken by a schedule" },
		{ kind: "compaction", text: "compacted 40 messages" },
		{ kind: "custom", text: "a renderer-local line" },
	];
	for (const record of others) {
		assert.equal(offers(record), false, `${record.kind} must not offer Quote`);
	}
});

/* ---- which highlight is a quote of this turn --------------------------- */

/** The smallest tree `quoteSelectionIn` reads: identity, containment, ancestry. */
const node = (tag, parent = null) => {
	const self = {
		nodeType: 1,
		tagName: tag,
		parentElement: parent,
		children: [],
		childNodes: [],
		closest: (selector) => {
			if (selector === `[${QUOTE_TOOLKIT_ATTR}]` && self.attr) return self;
			return parent ? parent.closest(selector) : null;
		},
		contains: (other) => {
			for (let at = other; at; at = at.parentElement) {
				if (at === self) return true;
			}
			return false;
		},
		/*
		 * `contentEnd` reads the marker off the turn's CHILDREN rather than through
		 * `closest`, because it is looking for the control's own slot among them -
		 * the clip has to stop before it, and an ancestor search cannot answer
		 * "which child is it".
		 */
		hasAttribute: (name) => name === QUOTE_TOOLKIT_ATTR && Boolean(self.attr),
	};
	if (parent) {
		parent.children.push(self);
		parent.childNodes.push(self);
	}
	return self;
};

/**
 * The offset the clip is expected to stop at: the turn's own words, which end
 * at the control's own child slot when one is mounted and at the turn's end when
 * none is. The control is the turn's LAST child in the shipped rows, so this is
 * "one short of the end" on every path the app has.
 */
const contentEndOf = (turn) => {
	const at = turn.childNodes.findIndex((child) =>
		child.hasAttribute(QUOTE_TOOLKIT_ATTR),
	);
	return at === -1 ? turn.childNodes.length : at;
};

/** The reader's highlight, as the model reads it. */
const select = (range, controls = []) => {
	globalThis.window = {
		getSelection: () => ({
			rangeCount: range ? 1 : 0,
			isCollapsed: range?.collapsed === true,
			getRangeAt: () => range,
			toString: () => range?.text ?? "",
		}),
	};
	/*
	 * The mounted controls, for `highlightLines`' filter: a box and the marker
	 * that makes it the control's, which is what the DOM query answers on the
	 * running surface.
	 */
	globalThis.document = { querySelectorAll: () => controls };
};

/**
 * A range over the fake tree, whose clone reports what it holds once a boundary
 * has been clamped to this turn's own end.
 *
 * The three functions this file used to assert needed three different fakes;
 * one rule needs one. A range has a start container, an end container, and the
 * text between them - and because the start endpoint is what decides whether
 * the highlight belongs to this turn at all, the only boundary the rule can
 * move is the END. `after` is therefore the text on the far side of this turn's
 * end: it is what a caller would quote if the clip did not happen, so each
 * assertion is a statement about WHICH text comes back, the turn's own words
 * and never the neighbour's.
 *
 * This is the same faking the file already did for node identity, and it proves
 * the same class of thing: which boundary the rule moved, not what Chromium
 * paints. The text a real `Range.toString()` yields after a real clamp is the
 * browser's job, and that is measured on the running surface.
 *
 * `rects` are the boxes the reader's own range reports, one per visual line in
 * document order - including the control's own, when the highlight spans its
 * slot, which is the leak the filter in `highlightLines` exists for and which
 * the browser really does report (QA measured it to the pixel).
 */
const clippableRange = ({
	turn,
	startContainer,
	endContainer,
	inside = "",
	after = "",
	rects = [],
	...rest
}) => {
	let clamped = null;
	const clone = {
		setEnd: (element, offset) => {
			// The clip is only ever to THIS turn's own words; a call with another
			// node would be clipping to something the reader did not highlight.
			assert.equal(element, turn);
			assert.equal(offset, contentEndOf(turn));
			clamped = "end";
		},
		toString: () => (clamped === "end" ? inside : inside + after),
	};
	return {
		...rest,
		startContainer,
		endContainer,
		text: inside + after,
		cloneRange: () => clone,
		clone,
		clamped: () => clamped,
		getClientRects: () => rects,
	};
};

test("a highlight inside the turn is the quote, trimmed", () => {
	const turn = node("div");
	const prose = node("p", turn);
	const range = clippableRange({
		turn,
		startContainer: prose,
		endContainer: prose,
		inside: "  the second clause  ",
	});
	select(range);
	assert.equal(quoteSelectionIn(turn).text, "the second clause");
	assert.equal(range.clamped(), null);
});

/* The boxes these cases measure against. A local helper so the cases read as
   geometry; the anchor section below has its own for the same reason. */
const hbox = (top, left, right, bottom) => ({ top, left, right, bottom });

test("the TEXT is this turn's, and the LINES are the whole highlight's", () => {
	// Two questions, two ranges, and the difference is the round-1 defect
	// (review M1, UX U9, QA Q27). The TEXT is clipped to this turn, because only
	// this turn's words are quoted - but the LINES are the reader's own
	// highlight's, because the control is placed against what the reader
	// actually selected, and a drag that runs on into the next turn has
	// highlighted that turn too. Measured, not argued: taking the flip's anchor
	// from the clipped range put the control ON the highlighted continuation.
	const turn = node("div");
	const prose = node("p", turn);
	const beyond = node("p", node("div"));
	const first = hbox(310, 236, 500, 341);
	const continuation = hbox(370, 200, 900, 390);
	const range = clippableRange({
		turn,
		startContainer: prose,
		endContainer: beyond,
		inside: "was null, and the new column is not null.",
		after: "\nThe next turn's words",
		rects: [first, continuation],
	});
	select(range);
	const quoted = quoteSelectionIn(turn);
	assert.equal(quoted.text, "was null, and the new column is not null.");
	assert.deepEqual(quoted.lines, [first, continuation]);
	assert.equal(range.clamped(), "end");
});

/*
 * M1 (code review) / U9 (UX) / Q27 (QA) as an INSTRUMENT, because the round-1
 * suite is what let this through: every case above asserts which TEXT a
 * highlight yields, and not one of them asked where the control ends up.
 *
 * The defect, in one sentence: the control is a CHILD of the turn it belongs to,
 * so a range that reached the turn's own end also covered the control's box - and
 * the placement then read that box back as the highlight's last line. Measured on
 * the running surface by two independent instruments in round 1: the control
 * stepped exactly 40px (`gap + height`) down the pane per re-measuring event
 * while the pointer was still down (`440 → 480 → 520 → 560 → 600 → 640` in the
 * reviewer's arithmetic, `95.7 → 135.7 → 175.7` in the UX trace, `0,0,0,0,0,0,40,
 * 0,0,40,40,40` in QA's per-event deltas), walked 43px per 3px of scroll, and in
 * one trace painted ON the highlighted line it was quoting.
 *
 * Both halves of the fix are asserted here, and neither is a clamp: the control's
 * own box is dropped from the boxes (the `QUOTE_TOOLKIT_ATTR` filter), and the
 * flip's anchor is the highlight's own last line (the reader's range, not the
 * clipped one). What makes this an instrument rather than a note is the SECOND
 * pass: the control is re-measured with its box where the first pass put it,
 * which is exactly what a scroll or a `selectionchange` does, and the placement
 * has to be unchanged.
 */
/*
 * The pane and the control, stated here rather than imported from the anchor
 * section below: these cases are about the MEASUREMENT, and the numbers are the
 * ones round 1 measured on the running surface (a 540-high viewport, the tall
 * fixture's pane, a 38x32 shell).
 */
const HIGHLIGHT_PANE = hbox(16, 60, 962, 368);
const HIGHLIGHT_VIEWPORT = hbox(0, 0, 1024, 540);
const CONTROL_SIZE = { width: 38, height: 32 };

/** A mounted control, as `highlightLines` sees it: a box under the marker. */
const mounted = (at) => ({ getBoundingClientRect: () => at });

/** The control's own box, from a placement - what the next measure would read. */
const boxOfPlacement = (placed, size = CONTROL_SIZE) =>
	hbox(
		placed.top,
		placed.left,
		placed.left + size.width,
		placed.top + size.height,
	);

/**
 * One pass of the component's own measure: the reader's highlight in, a
 * viewport position out - the same two calls `quote-toolkit.tsx` makes.
 */
const measureControl = ({ turn, rects, controlAt }) => {
	const beyond = node("p", node("div"));
	const range = clippableRange({
		turn,
		startContainer: turn.childNodes[0],
		endContainer: beyond,
		inside: "the first clause, and the second",
		after: " and the next turn's opening words",
		rects,
	});
	select(range, controlAt ? [mounted(controlAt)] : []);
	const quoted = quoteSelectionIn(turn);
	assert.ok(quoted, "the fixture is a highlight of this turn");
	return placeQuoteControl({
		lines: quoted.lines,
		container: HIGHLIGHT_PANE,
		viewport: HIGHLIGHT_VIEWPORT,
		size: CONTROL_SIZE,
	});
};

/** The turn a control is a child of: prose first, the control's slot second. */
const quotableTurn = () => {
	const turn = node("div");
	const prose = node("p", turn);
	const toolkit = node("div", turn);
	toolkit.attr = true;
	return { turn, prose, toolkit };
};

test("the control's own box is not one of the lines it is placed against", () => {
	const { turn } = quotableTurn();
	const first = hbox(20, 236, 500, 37);
	const controlBox = hbox(52, 236, 274, 84);
	const continuation = hbox(96, 200, 900, 116);
	// The range's boxes as the browser reports them for the reader's own
	// highlight: the line the drag began on, this control's own box (it sits
	// inside the turn, in document order, between that line and the next turn),
	// and the highlighted continuation in the next turn.
	const placed = measureControl({
		turn,
		rects: [first, controlBox, continuation],
		controlAt: controlBox,
	});
	// Only one measurement is between the reader's highlight and this number, and
	// it is the LAST box of the highlight - not the last LINE of the turn, and not
	// the control's own previous position.
	assert.deepEqual(placed, {
		top: continuation.bottom + QUOTE_CONTROL_GAP,
		left: first.left,
		placement: "below",
	});
});

test("re-measuring with nothing changed does not move the control", () => {
	const { turn } = quotableTurn();
	const first = hbox(20, 236, 500, 37);
	const continuation = hbox(96, 200, 900, 116);
	const at = (control) => [first, control, continuation];
	const start = hbox(52, 236, 274, 84);
	const one = measureControl({ turn, rects: at(start), controlAt: start });
	const two = measureControl({
		turn,
		rects: at(boxOfPlacement(one)),
		controlAt: boxOfPlacement(one),
	});
	const three = measureControl({
		turn,
		rects: at(boxOfPlacement(two)),
		controlAt: boxOfPlacement(two),
	});
	assert.deepEqual(two, one);
	assert.deepEqual(three, one);
});

test("a clamp on a placement that reads its own box would still walk", () => {
	// The arithmetic of the defect, pinned so the fix cannot be mistaken for a
	// clamp: fed the leaked box set, the flip anchors to the control's own bottom,
	// so each pass adds `gap + height` and the clamp only stops the walk at the
	// pane's floor. This is the input `highlightLines` now refuses to produce.
	const at = (control) => [hbox(20, 236, 500, 37), control];
	const step = (control) =>
		placeQuoteControl({
			lines: at(control),
			container: HIGHLIGHT_PANE,
			viewport: HIGHLIGHT_VIEWPORT,
			size: CONTROL_SIZE,
		});
	const one = step(hbox(52, 236, 274, 84));
	const two = step(boxOfPlacement(one));
	assert.equal(two.top - one.top, QUOTE_CONTROL_GAP + CONTROL_SIZE.height);
	// And it stops only when the clamp pins it: 40px per event until the pane's
	// own floor, which is what round 1 measured as a 210px displacement from the
	// highlight it was quoting.
	let at2 = one;
	for (let i = 0; i < 20; i += 1) at2 = step(boxOfPlacement(at2));
	assert.equal(at2.top, HIGHLIGHT_PANE.bottom - CONTROL_SIZE.height);
});

test("a highlight that BEGINS in another turn is that turn's quote", () => {
	// The rule that makes one highlight raise exactly one control. The start
	// endpoint decides the owner and a range has exactly one of them, so this
	// turn - which the highlight passes through - answers null, and the turn it
	// begins in answers with the text.
	const turn = node("div");
	const prose = node("p", turn);
	const otherTurn = node("div");
	const otherProse = node("p", otherTurn);
	const range = clippableRange({
		turn,
		startContainer: otherProse,
		endContainer: prose,
		inside: "the next turn's opening words",
	});
	select(range);
	assert.equal(quoteSelectionIn(turn), null);
	// And it said so without moving a boundary: a refusal is not a clip.
	assert.equal(range.clamped(), null);
});

test("a highlight that never reaches the turn answers null", () => {
	const turn = node("div");
	node("p", turn);
	const elsewhere = node("p", node("div"));
	select(
		clippableRange({
			turn,
			startContainer: elsewhere,
			endContainer: elsewhere,
			inside: "somewhere else entirely",
		}),
	);
	assert.equal(quoteSelectionIn(turn), null);
});

test("a collapsed caret is not a highlight", () => {
	const turn = node("div");
	const prose = node("p", turn);
	select(
		clippableRange({
			turn,
			startContainer: prose,
			endContainer: prose,
			inside: "",
			collapsed: true,
		}),
	);
	assert.equal(quoteSelectionIn(turn), null);
});

test("a highlight that trims to nothing raises nothing", () => {
	// THE EMPTY BOUNDARY, and the case three streams read differently (code
	// review round 2, MINOR 2; UX round 2, U8; QA round 2, Q8). An in-turn clip
	// holding no character used to fall through the `??` chain to the turn's
	// WHOLE body - a longer quote than the reader highlighted. There is no
	// fallback to fall through to now: whitespace is not a highlight, so no
	// control is raised, and the press that widened the quote cannot happen.
	const turn = node("div");
	const prose = node("p", turn);
	select(
		clippableRange({
			turn,
			startContainer: prose,
			endContainer: prose,
			inside: "   \n ",
		}),
	);
	assert.equal(quoteSelectionIn(turn), null);
});

test("a highlight with an endpoint on the control is refused", () => {
	// The case `QUOTE_TOOLKIT_ATTR` exists for: a drag over the whole row would
	// otherwise hand the control's own label in as this turn's words. It is
	// defence in depth rather than a live path - the control only exists while a
	// highlight does - and both endpoints are tested, because whichever end is
	// asked, a drag that reached the control did not select prose.
	const turn = node("div");
	const prose = node("p", turn);
	const toolkit = node("div", turn);
	toolkit.attr = true;
	const button = node("button", toolkit);
	select(
		clippableRange({
			turn,
			startContainer: prose,
			endContainer: button,
			inside: "the second clause ",
			after: "Quote",
		}),
	);
	assert.equal(quoteSelectionIn(turn), null);
	select(
		clippableRange({
			turn,
			startContainer: button,
			endContainer: prose,
			inside: "Quote the second clause",
		}),
	);
	assert.equal(quoteSelectionIn(turn), null);
});

test("no turn element and no selection both answer null", () => {
	const prose = node("p");
	select(
		clippableRange({
			turn: prose,
			startContainer: prose,
			endContainer: prose,
			inside: "orphan",
		}),
	);
	assert.equal(quoteSelectionIn(null), null);
	globalThis.window = { getSelection: () => null };
	assert.equal(quoteSelectionIn(prose), null);
});

/* ---- where that control floats ----------------------------------------- */

/*
 * `placeQuoteControl` is the other half of the same rule, and it is asserted
 * here rather than judged from a frame for the reason the frame cannot reach:
 * the interesting cases are the row at the pane's own top edge and the clamp at
 * its own right edge, and a story can only photograph the states its fixture
 * happens to produce. All four numbers are viewport coordinates, so these are
 * plain arithmetic.
 */

const box = (top, left, right, bottom) => ({ top, left, right, bottom });
const VIEWPORT = box(0, 0, 1024, 800);
/** A transcript pane: below the header, above the composer, inset from the edges. */
const PANE = box(100, 40, 984, 700);
const CONTROL = { width: 38, height: 32 };
const place = (lines, over = {}) =>
	placeQuoteControl({
		lines,
		container: PANE,
		viewport: VIEWPORT,
		size: CONTROL,
		...over,
	});

test("a highlight with room above puts the control over its first line", () => {
	assert.deepEqual(place([box(300, 200, 500, 320)]), {
		top: 300 - QUOTE_CONTROL_GAP - CONTROL.height,
		left: 200,
		placement: "above",
	});
});

test("it aligns to where the highlight BEGINS, not to the line's own left edge", () => {
	// A wrapped highlight: the second line starts at the pane's left edge, so a
	// union box would put the control at 40 - pointing at a line the reader did
	// not begin on.
	const placed = place([box(300, 200, 900, 320), box(320, 40, 500, 340)]);
	assert.equal(placed.left, 200);
	assert.equal(placed.placement, "above");
});

test("the first row of a scrolled transcript flips the control below it", () => {
	// The case the operator's ask names: the highlight's own first line sits at
	// the pane's top edge, so there is no room above it - the control goes below
	// rather than hanging over the pane's header.
	assert.deepEqual(place([box(100, 200, 500, 120)]), {
		top: 120 + QUOTE_CONTROL_GAP,
		left: 200,
		placement: "below",
	});
});

test("a flip clears the highlight's LAST line, so it never lands on the text", () => {
	const placed = place([box(100, 200, 500, 120), box(120, 40, 900, 140)]);
	assert.equal(placed.placement, "below");
	assert.equal(placed.top, 140 + QUOTE_CONTROL_GAP);
});

test("a link below its row's first line is placed BELOW it, not over the line above", () => {
	/*
	 * The link toolbar's rule (round 1, design D2, UX U6): an 8px-above placement
	 * covers the line before a link that is not on its row's first line, and round 1
	 * measured it hiding 128px of the very path this change exists to make usable.
	 * The unit is the anchor's own line height, so this case is one line down from
	 * the row's top: below, cleared of its own LAST line.
	 */
	const row = box(300, 40, 984, 700);
	const secondLine = box(322, 200, 500, 344);
	assert.deepEqual(place([secondLine], { row, belowWhenOffFirstLine: true }), {
		top: 344 + QUOTE_CONTROL_GAP,
		left: 200,
		placement: "below",
	});
});

test("a link ON the row's first line keeps the clearance above it", () => {
	/*
	 * The other half of the same rule, and the case that must not regress: the first
	 * line of a row is where the 8px is the row's own leading, so nothing is covered
	 * and "above" is still the right side.
	 */
	const row = box(300, 40, 984, 700);
	const firstLine = box(300, 200, 900, 322);
	assert.deepEqual(place([firstLine], { row, belowWhenOffFirstLine: true }), {
		top: 300 - QUOTE_CONTROL_GAP - CONTROL.height,
		left: 200,
		placement: "above",
	});
});

test("the mid-row rule is the toolbar's choice, and off by default", () => {
	/* The quote control shows no `row` and no flag, and its placement is unchanged. */
	const offFirstLine = box(322, 200, 500, 344);
	assert.equal(place([offFirstLine]).placement, "above");
	assert.equal(
		place([offFirstLine], { row: box(300, 40, 984, 700) }).placement,
		"above",
	);
});

test("with no room below, the mid-row rule falls back above rather than to the clamp", () => {
	/*
	 * A link just above the pane's floor: taking the rule literally would push the
	 * flip past the pane and hand the position to the vertical clamp, which is how a
	 * control ends up over its own anchor's line. `above` has room there, so it wins.
	 */
	const nearFloor = box(640, 200, 500, 662);
	const placed = place([nearFloor], {
		row: box(300, 40, 984, 700),
		belowWhenOffFirstLine: true,
	});
	assert.deepEqual(placed, {
		top: 640 - QUOTE_CONTROL_GAP - CONTROL.height,
		left: 200,
		placement: "above",
	});
});

test("the mid-row flip is measured from a wrapped link's LAST line", () => {
	const row = box(300, 40, 984, 700);
	const wrapped = [box(322, 200, 900, 344), box(344, 40, 300, 366)];
	const placed = place(wrapped, { row, belowWhenOffFirstLine: true });
	assert.equal(placed.placement, "below");
	assert.equal(placed.top, 366 + QUOTE_CONTROL_GAP);
	assert.equal(placed.left, 200);
});

test("a highlight scrolled above the pane hides", () => {
	// Anchored to a line the reader can no longer see: there is nothing left for
	// the control to be about, so it reports null rather than pinning itself to
	// the pane's edge (the operator's third ask: it must not stick around).
	assert.equal(place([box(40, 200, 500, 60)]), null);
});

test("a highlight scrolled below the pane hides too", () => {
	assert.equal(place([box(720, 200, 500, 748)]), null);
});

test("the control is clamped inside the pane's own edges", () => {
	assert.equal(place([box(300, 970, 1000, 320)]).left, 984 - CONTROL.width);
	assert.equal(place([box(300, 10, 200, 320)]).left, 40);
});

test("the bounds are the pane AND the window, whichever is smaller", () => {
	// A short window: the pane reaches past it, and a flip measured from the
	// highlight's last line would put the control under the visible box. The
	// vertical clamp is what keeps the press reachable there.
	const placed = place([box(110, 200, 500, 130), box(380, 40, 900, 480)], {
		viewport: box(0, 0, 1024, 400),
	});
	assert.equal(placed.placement, "below");
	assert.equal(placed.top, 400 - CONTROL.height);
});

test("a pane shorter than the control pins it to the visible top", () => {
	// A degenerate clamp range - the control is taller than the space it is
	// clamped into - must not produce a negative offset that would put it under
	// the pane's own header.
	const placed = place([box(100, 200, 500, 118)], {
		container: box(100, 40, 984, 120),
	});
	assert.equal(placed.top, 100);
});

test("no line rects, and a pane the window does not touch, both answer null", () => {
	assert.equal(place([]), null);
	assert.equal(
		place([box(900, 200, 500, 920)], { container: box(900, 40, 984, 1000) }),
		null,
	);
});

test("touching boxes do not overlap", () => {
	// The hide's own boundary: a highlight whose bottom sits exactly on the
	// pane's top edge has no pixel of itself on screen.
	assert.equal(overlap(box(0, 0, 10, 10), box(10, 0, 20, 10)), null);
	assert.deepEqual(
		overlap(box(0, 0, 10, 10), box(5, 5, 20, 20)),
		box(5, 5, 10, 10),
	);
});

/* ---- the round trip through the shipped send path ---------------------- */

test("a staged quote survives buildSendPayload and comes back out of parseReplies", () => {
	const quoted = "The migration failed on the second row.";
	const payload = buildSendPayload("Why did it fail?", [{ text: quoted }]);
	// The markup is assembled at the send boundary, which is why the split on
	// the way back out has to exist: this string is what the transcript holds.
	assert.equal(payload, `<reply-to>${quoted}</reply-to>\nWhy did it fail?`);
	const { replies, remainingContent } = parseReplies(payload);
	assert.deepEqual(
		replies.map((reply) => reply.text),
		[quoted],
	);
	assert.equal(remainingContent, "Why did it fail?");
});

/*
 * THE CASE THE SINGLE-LINE ROUND TRIP ABOVE CANNOT SEE.
 *
 * The quote path does not truncate - the staged text is the reader's highlight,
 * verbatim - so a quote is normally several paragraphs and the scan has to cross
 * a newline to find the closing tag. Every quote in this
 * file used to be one line, which is the one shape that worked while the scan
 * was not dotall - so the suite was green on a path that failed for the common
 * case. Each test below is a shape that goes through the shipped functions.
 */

const PARAGRAPH =
	"Because that row's `tenant_id` was null, and the new column is `not null`.\n\nThe other four hundred rows were fine.";

test("a multi-paragraph quote survives the round trip", () => {
	// What the control stages for a highlight over that answer: the highlight
	// itself, unaltered. `quoteSelectionIn`'s own tests above pin that; these are
	// about what the SEND carries once it is staged.
	const staged = PARAGRAPH;
	const payload = buildSendPayload("Why did it fail there?", [
		{ text: staged },
	]);
	assert.equal(
		payload,
		`<reply-to>${PARAGRAPH}</reply-to>\nWhy did it fail there?`,
	);
	const { replies, remainingContent } = parseReplies(payload);
	assert.deepEqual(
		replies.map((reply) => reply.text),
		[PARAGRAPH],
	);
	assert.equal(remainingContent, "Why did it fail there?");
});

test("a selection dragged across two visual lines survives the same way", () => {
	// `selection.toString()` carries the newline between the lines, so a plain
	// drag across a line break stages exactly this.
	const staged = "the second row was null\nand the new column is not null";
	const { replies, remainingContent } = parseReplies(
		buildSendPayload("and then?", [{ text: staged }]),
	);
	assert.deepEqual(
		replies.map((reply) => reply.text),
		[staged],
	);
	assert.equal(remainingContent, "and then?");
});

test("stacked multi-line quotes each come back whole, in order", () => {
	const first = "one\n\ntwo";
	const second = "three\n\nfour";
	const { replies, remainingContent } = parseReplies(
		buildSendPayload("both, please", [{ text: first }, { text: second }]),
	);
	assert.deepEqual(
		replies.map((reply) => reply.text),
		[first, second],
	);
	assert.equal(remainingContent, "both, please");
});

test("whitespace and blank lines around the join belong to neither side", () => {
	// A highlight whose own ends are whitespace, trimmed by the rule that reads it.
	const staged = "a quoted line\n\nand its second paragraph";
	const { replies, remainingContent } = parseReplies(
		buildSendPayload("  spaced words  ", [{ text: staged }]),
	);
	assert.deepEqual(
		replies.map((reply) => reply.text),
		[staged],
	);
	assert.equal(remainingContent, "spaced words");
});

/*
 * WHERE THE MARKUP IS, WHICH IS THE OTHER HALF OF THE SAME CONTRACT.
 *
 * `buildSendPayload` is the only writer of this markup and it always PREFIXES
 * it, so a scan that matches the tag anywhere is reading prose as transport.
 */

test("an answer that only MENTIONS the markup keeps its words", () => {
	// The rendering lie this rules out: an assistant discussing the wire format
	// had the recited tags deleted from its body and re-painted as a quote.
	const body =
		"The composer prefixes `<reply-to>...</reply-to>` onto the payload.\nThat is why the row splits it out.";
	const { replies, remainingContent } = parseReplies(body);
	assert.deepEqual(replies, []);
	assert.equal(remainingContent, body);
});

test("an ECHOED prompt is still split, because an echo is a leading run", () => {
	const { replies, remainingContent } = parseReplies(
		"<reply-to>earlier words</reply-to>\nWhat did you mean?",
	);
	assert.deepEqual(
		replies.map((reply) => reply.text),
		["earlier words"],
	);
	assert.equal(remainingContent, "What did you mean?");
});

test("a quote that itself mentions the opening tag is not cut short", () => {
	const body = "the tag <reply-to> opens the block";
	const { replies, remainingContent } = parseReplies(
		buildSendPayload("noted", [{ text: body }]),
	);
	assert.deepEqual(
		replies.map((reply) => reply.text),
		[body],
	);
	assert.equal(remainingContent, "noted");
});

test("a literal closing tag inside a quote is the format's limit, pinned", () => {
	// Not papered over and not fixable here: the tag is not escapable, so a body
	// containing `</reply-to>` closes the block early and its tail becomes the
	// speaker's words. `buildSendPayload` would have to escape, which is a wire
	// format change on both writers and on the legacy path as well as this one.
	const payload = buildSendPayload("noted", [
		{ text: "write </reply-to> to close the block" },
	]);
	assert.equal(
		payload,
		"<reply-to>write </reply-to> to close the block</reply-to>\nnoted",
	);
	const { replies, remainingContent } = parseReplies(payload);
	assert.deepEqual(
		replies.map((reply) => reply.text),
		["write "],
	);
	assert.equal(remainingContent, "to close the block</reply-to>\nnoted");
});

test("several staged quotes stack, and each is recoverable", () => {
	const payload = buildSendPayload("Both of these, please.", [
		{ text: "first quote" },
		{ text: "second quote" },
	]);
	const { replies, remainingContent } = parseReplies(payload);
	assert.deepEqual(
		replies.map((reply) => reply.text),
		["first quote", "second quote"],
	);
	assert.equal(remainingContent, "Both of these, please.");
});

test("quoting a turn that was itself a reply does not nest the markup", () => {
	const payload = buildSendPayload("Why did it fail?", [
		{ text: "the failure" },
	]);
	const { remainingContent } = parseReplies(payload);
	// What the control stages for a highlight in that turn: its BODY, not its raw
	// text - a highlight can only be made over ink, and the markup is not ink.
	const restaged = remainingContent;
	assert.equal(restaged, "Why did it fail?");
	const second = buildSendPayload("Noted.", [{ text: restaged }]);
	assert.equal(second, "<reply-to>Why did it fail?</reply-to>\nNoted.");
	const back = parseReplies(second);
	assert.deepEqual(
		back.replies.map((reply) => reply.text),
		["Why did it fail?"],
	);
	assert.equal(back.remainingContent, "Noted.");
});

test("a turn with no quote renders its own text untouched", () => {
	const payload = buildSendPayload("a plain turn", []);
	assert.equal(payload, "a plain turn");
	assert.deepEqual(parseReplies(payload).replies, []);
});

/*
 * ---------------------------------------------------------------- the link toolbar
 *
 * The transcript gained a SECOND floating control when a link became pressable
 * (Copy / Open / Open folder, plus Quote when the reader's highlight lies inside
 * the link). It wears the same shell - and therefore the same
 * `QUOTE_TOOLKIT_ATTR` - as the turn's Quote control, so the exclusion above is
 * inherited rather than re-derived. That inheritance is asserted here instead of
 * trusted, because it is the difference between one attribute with one meaning
 * and two controls that happen to agree.
 *
 * The link toolbar is also the case the attribute's own comment predicted would
 * be reachable "the moment it carries a label": unlike the Quote control's lone
 * glyph, this strip renders text (a `No file at /tmp/x` note, and a `Copied`
 * state), so a drag that reaches it has real words to leak into a quote.
 */

test("a drag that ends on the LINK toolbar is not a quote of the turn", () => {
	const turn = node("div");
	const prose = node("p", turn);
	const link = node("a", turn);
	const toolbar = node("div", turn);
	// Both toolbars are found by the same attribute, which is the point.
	toolbar.attr = true;
	const button = node("button", toolbar);
	const label = node("span", button);
	label.text = "No file at /tmp/x";

	select(
		clippableRange({
			turn,
			startContainer: prose,
			endContainer: label,
			inside: "the second clause ",
			after: "No file at /tmp/x",
		}),
	);
	assert.equal(quoteSelectionIn(turn), null);
	select(
		clippableRange({
			turn,
			startContainer: label,
			endContainer: prose,
			inside: "No file at /tmp/x the second clause",
		}),
	);
	assert.equal(quoteSelectionIn(turn), null);
	// And the link itself is ordinary prose to this model: an anchor is not a
	// control, so a highlight over it is a quote of the turn's words.
	select(
		clippableRange({
			turn,
			startContainer: link,
			endContainer: link,
			inside: "~/x/report.xlsx",
		}),
	);
	assert.equal(quoteSelectionIn(turn).text, "~/x/report.xlsx");
});
