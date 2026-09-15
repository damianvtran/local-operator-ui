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
 * 3. THE SELECTION RULE (`selectionTextIn`) - which DOM selections count as a
 *    quote of THIS turn. faked here rather than driven in a browser because the
 *    question is a comparison of node identities, not a paint.
 * 4. THE ROUND TRIP through the shipped send path - `buildSendPayload` prefixes
 *    the markup and `parseReplies` takes it back out, so a staged quote really
 *    is what the next send carries and the sent turn really does render a quote
 *    block instead of raw tags. Asserted against the SHIPPED functions rather
 *    than against a copy of the format, because a copy is what drifts.
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

test("a user turn with words offers a quote", () => {
	assert.equal(isQuotable(userRow("Why did the second row fail?")), true);
});

test("a settled assistant answer offers a quote", () => {
	assert.equal(isQuotable(assistantRow("Because the schema moved.")), true);
});

test("a streaming assistant row does not: a prefix is not a claim", () => {
	assert.equal(
		isQuotable(assistantRow("Because the sch", { streaming: true })),
		false,
	);
});

test("a row with no text at all does not, on either kind", () => {
	assert.equal(isQuotable(userRow("   \n  ")), false);
	assert.equal(isQuotable(assistantRow("")), false);
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
		assert.equal(
			isQuotable(record),
			false,
			`${record.kind} must not offer Quote`,
		);
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
	const prose = node("p", turn);
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
	const payload = buildSendPayload("Why did it fail?", [{ text: "the failure" }]);
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
