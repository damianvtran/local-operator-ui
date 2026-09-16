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
 * 2. WHAT TEXT IT CARRIES (`quoteText`) - the reader's selection when they made
 *    one, otherwise the turn's own words, and never the `<reply-to>` transport
 *    markup.
 * 3. THE SELECTION RULE (`selectionTextIn`, `selectionClippedTo`) - which DOM
 *    selections count as a quote of THIS turn, and what happens to one that only
 *    partly lies in it. faked here rather than driven in a browser because the
 *    question is a comparison of node identities, not a paint.
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
/* `selectionTextIn` compares against `Node.ELEMENT_NODE`; node has no DOM. */
globalThis.Node = { ELEMENT_NODE: 1 };

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/quote-model";',
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
	quoteText,
	selectionTextIn,
	selectionClippedTo,
	QUOTE_TOOLKIT_ATTR,
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
 * `isQuotable` as the rows call it: the record, and the BODY it would stage.
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
	// `quoteText` answers null for an empty body. The rule reads the body.
	const row = userRow("<reply-to>x</reply-to>");
	const { remainingContent } = parseReplies(row.text);
	assert.equal(row.text.trim().length > 0, true);
	assert.equal(remainingContent, "");
	// The same record read the way the call site used to read it: the raw text
	// still says "there are words here", which is why the control mounted.
	assert.equal(isQuotable(row, row.text), true);
	// Read the body the toolkit would actually stage, the control is gone -
	// and pressing it would have done nothing anyway.
	assert.equal(isQuotable(row, remainingContent), false);
	assert.equal(quoteText(remainingContent, null), null);
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

/* ---- what text a quote carries ----------------------------------------- */

test("the reader's selection wins over the turn's whole text", () => {
	assert.equal(
		quoteText("the whole answer", "the second clause"),
		"the second clause",
	);
});

test("with no selection the turn's own words are quoted", () => {
	assert.equal(quoteText("the whole answer", null), "the whole answer");
});

test("a selection that is only whitespace falls back to the turn", () => {
	assert.equal(quoteText("the whole answer", "   \n "), "the whole answer");
});

test("a quote is trimmed at both ends and never empty", () => {
	assert.equal(quoteText("  padded  ", null), "padded");
	assert.equal(quoteText("   ", null), null);
});

/* ---- which selections count as a quote of this turn -------------------- */

/** The smallest tree `selectionTextIn` reads: identity, containment, ancestry. */
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
	};
	return self;
};
const select = (range) => {
	globalThis.window = {
		getSelection: () => ({
			rangeCount: range ? 1 : 0,
			isCollapsed: range?.collapsed === true,
			getRangeAt: () => range,
			toString: () => range?.text ?? "",
		}),
	};
};

/**
 * A range whose text is modelled as the three parts a clip has to choose between:
 * what lies BEFORE this turn, what lies INSIDE it, and what lies AFTER it.
 *
 * The existing fixtures hand `select` a plain `text` string because
 * `selectionTextIn` never asks which boundary a range has - it answers null and
 * is done. Clipping does ask, so the fake has to be able to say what was cut:
 * `toString()` on the clone returns `before + inside` once the end was clamped
 * to the turn, `inside + after` once the start was, and the whole thing when
 * neither was touched. That makes each assertion a statement about WHICH part
 * the returned quote contains - the turn's own words, never the neighbours'.
 *
 * This is the same faking the file already does for node identity, and it proves
 * the same class of thing: which boundaries the rule moved, not what Chromium
 * paints. The text a real `Range.toString()` yields after a real clamp is the
 * browser's, and that is measured on the running surface.
 */
const clippableRange = ({ before = "", inside = "", after = "", ...rest }) => {
	let clamped = null;
	return {
		...rest,
		text: before + inside + after,
		clamped: () => clamped,
		cloneRange: () => ({
			setStart: (element, offset) => {
				// The clip is only ever to THIS turn's own edge; a call with another
				// node would be clipping to something the reader did not select.
				assert.equal(element, rest.turn);
				assert.equal(offset, 0);
				clamped = "start";
			},
			setEnd: (element, offset) => {
				assert.equal(element, rest.turn);
				assert.equal(offset, rest.turn.childNodes.length);
				clamped = "end";
			},
			toString: () =>
				clamped === "start"
					? inside + after
					: clamped === "end"
						? before + inside
						: before + inside + after,
		}),
	};
};

test("a selection inside the turn is the quote", () => {
	const turn = node("div");
	const prose = node("p", turn);
	select({
		startContainer: prose,
		endContainer: prose,
		commonAncestorContainer: prose,
		text: "  the second clause  ",
	});
	assert.equal(selectionTextIn(turn), "the second clause");
});

test("a collapsed caret is not a selection", () => {
	const turn = node("div");
	const prose = node("p", turn);
	select({
		startContainer: prose,
		endContainer: prose,
		commonAncestorContainer: prose,
		text: "",
		collapsed: true,
	});
	assert.equal(selectionTextIn(turn), null);
});

test("a selection reaching into another turn is not this turn's quote", () => {
	const turn = node("div");
	const prose = node("p", turn);
	const otherTurn = node("div");
	const otherProse = node("p", otherTurn);
	select({
		startContainer: prose,
		endContainer: otherProse,
		commonAncestorContainer: node("body"),
		text: "across two turns",
	});
	assert.equal(selectionTextIn(turn), null);
});

test("a selection of the toolkit's own label is not a quote", () => {
	const turn = node("div");
	const toolkit = node("div", turn);
	toolkit.attr = true;
	const button = node("button", toolkit);
	select({
		startContainer: button,
		endContainer: button,
		commonAncestorContainer: button,
		text: "Quote",
	});
	assert.equal(selectionTextIn(turn), null);
});

test("a drag that starts in the prose and ends on the strip is not this turn's quote", () => {
	// The case the attribute exists for: the reader drags over the whole row.
	// The TURN is the common ancestor of that range, so a test of the common
	// ancestor asks the one node that cannot be inside the toolkit and lets the
	// strip's text through as this turn's words - which is what the shipped
	// implementation did until the endpoints were tested.
	const turn = node("div");
	const prose = node("p", turn);
	const toolkit = node("div", turn);
	toolkit.attr = true;
	const button = node("button", toolkit);
	select({
		startContainer: prose,
		endContainer: button,
		commonAncestorContainer: turn,
		text: "the second clause Quote",
	});
	assert.equal(selectionTextIn(turn), null);
});

test("the same drag from the strip back into the prose is excluded too", () => {
	const turn = node("div");
	const prose = node("p", turn);
	const toolkit = node("div", turn);
	toolkit.attr = true;
	const button = node("button", toolkit);
	select({
		startContainer: button,
		endContainer: prose,
		commonAncestorContainer: turn,
		text: "Quote the second clause",
	});
	assert.equal(selectionTextIn(turn), null);
});

test("no turn element and no selection both answer null", () => {
	const prose = node("p");
	select({
		startContainer: prose,
		endContainer: prose,
		commonAncestorContainer: prose,
		text: "orphan",
	});
	assert.equal(selectionTextIn(null), null);
	globalThis.window = { getSelection: () => null };
	assert.equal(selectionTextIn(prose), null);
});

/* ---- a selection that only partly lies in the turn --------------------- */

/*
 * `selectionClippedTo` is the half of the selection rule that keeps a press from
 * WIDENING the quote. These four tests are the four ways a range can relate to a
 * turn: overshooting past its end, starting before its start, never reaching it,
 * and lying wholly inside it - which is `selectionTextIn`'s answer and must not
 * be answered twice.
 */

test("a drag that overshoots the turn is clipped to it, not widened", () => {
	// The measured case (UX round 1, U3; QA round 1, Q3): a drag released below
	// the turn highlighted 132 characters and staged the WHOLE turn, because the
	// selection failed containment and the whole-turn fallback took over.
	const turn = node("div");
	const prose = node("p", turn);
	const beyond = node("p", node("div"));
	const range = clippableRange({
		turn,
		startContainer: prose,
		endContainer: beyond,
		commonAncestorContainer: node("body"),
		before: "",
		inside: "was null, and the new column is not null.",
		after: "\nThe next turn's words",
	});
	select(range);
	assert.equal(
		selectionClippedTo(turn),
		"was null, and the new column is not null.",
	);
	// And it got there by moving the ONE boundary that pointed outside the turn.
	assert.equal(range.clamped(), "end");
});

test("a drag that starts before the turn is clipped to the turn's start", () => {
	const turn = node("div");
	const prose = node("p", turn);
	const before = node("p", node("div"));
	const range = clippableRange({
		turn,
		startContainer: before,
		endContainer: prose,
		commonAncestorContainer: node("body"),
		before: "the previous turn's tail",
		inside: "The other four hundred rows were fine.",
		after: "",
	});
	select(range);
	assert.equal(
		selectionClippedTo(turn),
		"The other four hundred rows were fine.",
	);
	assert.equal(range.clamped(), "start");
});

test("a selection that never reaches the turn is not clipped into it", () => {
	// Neither endpoint inside: clipping would have to invent a boundary, and the
	// caller's whole-turn fallback is right for a selection somewhere else.
	const turn = node("div");
	node("p", turn);
	const elsewhere = node("p", node("div"));
	const range = clippableRange({
		turn,
		startContainer: elsewhere,
		endContainer: elsewhere,
		commonAncestorContainer: elsewhere,
		before: "",
		inside: "",
		after: "somewhere else entirely",
	});
	select(range);
	assert.equal(selectionClippedTo(turn), null);
	assert.equal(range.clamped(), null);
});

test("a selection wholly inside the turn is not clipped twice", () => {
	const turn = node("div");
	const prose = node("p", turn);
	const range = clippableRange({
		turn,
		startContainer: prose,
		endContainer: prose,
		commonAncestorContainer: prose,
		before: "",
		inside: "the second clause",
		after: "",
	});
	select(range);
	assert.equal(selectionClippedTo(turn), null);
	assert.equal(range.clamped(), null);
});

test("a clip never reaches into the toolkit", () => {
	// Refused rather than clamped: clamping this end to the turn's own end would
	// turn a drag to the strip into a quote of the prose the reader dragged away
	// from - the same widening, arrived at from the other side.
	const turn = node("div");
	const prose = node("p", turn);
	const toolkit = node("div", turn);
	toolkit.attr = true;
	const button = node("button", toolkit);
	const range = clippableRange({
		turn,
		startContainer: prose,
		endContainer: button,
		commonAncestorContainer: turn,
		before: "",
		inside: "the second clause ",
		after: "Quote",
	});
	select(range);
	assert.equal(selectionClippedTo(turn), null);
	assert.equal(range.clamped(), null);
});

test("a caret and a missing turn clip nothing", () => {
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
	assert.equal(selectionClippedTo(turn), null);
	globalThis.window = { getSelection: () => null };
	assert.equal(selectionClippedTo(prose), null);
	assert.equal(selectionClippedTo(null), null);
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
 * `quoteText` does not truncate, so a quote is normally several paragraphs and
 * the scan has to cross a newline to find the closing tag. Every quote in this
 * file used to be one line, which is the one shape that worked while the scan
 * was not dotall - so the suite was green on a path that failed for the common
 * case. Each test below is a shape that goes through the shipped functions.
 */

const PARAGRAPH =
	"Because that row's `tenant_id` was null, and the new column is `not null`.\n\nThe other four hundred rows were fine.";

test("a multi-paragraph quote survives the round trip", () => {
	const staged = quoteText(PARAGRAPH, null);
	assert.equal(staged, PARAGRAPH);
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
	// `selection.toString()` carries the newline between the lines, so the
	// second route into the same broken scan is a plain drag across a line break.
	const selected = "the second row was null\nand the new column is not null";
	const staged = quoteText("the whole answer\nover two paragraphs", selected);
	assert.equal(staged, selected);
	const { replies, remainingContent } = parseReplies(
		buildSendPayload("and then?", [{ text: staged }]),
	);
	assert.deepEqual(
		replies.map((reply) => reply.text),
		[selected],
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
	const staged = quoteText(
		"  a quoted line\n\nand its second paragraph  ",
		null,
	);
	assert.equal(staged, "a quoted line\n\nand its second paragraph");
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
	// What the toolkit stages for that turn: its BODY, not its raw text.
	const restaged = quoteText(remainingContent, null);
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
