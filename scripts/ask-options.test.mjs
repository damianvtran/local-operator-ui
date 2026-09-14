import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The `ask` gate's clickable options, asserted against the SHIPPED modules.
 *
 * Three things are checked here, and each is a property that a screenshot
 * cannot prove and that a future edit could break silently:
 *
 * 1. **A pressed option posts exactly ONE answer, carrying its LABEL.**
 *    The wire contract is "answer with the label the model wrote"
 *    (`ask_picker.py`: "It answers with TEXT, not an index"), so a body
 *    carrying an index — or carrying the visible numeral — is the defect this
 *    change exists to remove. The request is validated by the REAL
 *    `desktopRequestSchema` and mapped by the REAL path mapper, so a change to
 *    either that broke the answer op would fail here rather than in QA.
 *
 * 1b. **One answer in flight means one request on the wire.** This is
 *    `answerGateOption`'s lock, held and interleaved on purpose. The round-1
 *    review found the previous version of this test asserting a `disabled` prop
 *    and never reaching the race at all, with the lock itself (`sendLock`) — the
 *    thing the comments in `chat-page.tsx` rest the claim on — exercised by no
 *    test anywhere.
 *
 * 2. **A bare numeral resolves to the option it names.** The card prints
 *    `1.`, `2.`, `3.`; typing `1` used to send the string "1". See
 *    `resolveNumericAnswer` for why the rule is as narrow as it is — the
 *    negative cases below are the contract, not an afterthought.
 *
 * 3. **`recommended` is read as OPTIONAL.** A backend older than the ask-picker
 *    contract omits the key, and defaulting it to 0 would badge the first
 *    option on every legacy ask. Absent, null, out-of-range and non-integer all
 *    have to mark nothing.
 *
 * ## Why the component is exercised as an element tree, not through a DOM
 *
 * There is no jsdom in this repo's tree and this change is not the place to
 * add one. So `AskOptions` is CALLED — it is a function of its props — and the
 * returned React element tree is walked for the real `<button>` nodes. Their
 * `onClick` is the shipped handler, and invoking it is what a click does after
 * React's event plumbing, so the value that reaches `onAnswer` is the value
 * the app sends. What this cannot see is the browser's own refusal to
 * dispatch a click on a `disabled` button; that half is asserted as the
 * `disabled` prop here and demonstrated for real in the live-renderer evidence
 * on the PR.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { AskOptions } from "./src/renderer/src/features/chat/components/trace/ask-options";',
			'export { resolveNumericAnswer, answerValue, lostAnswerMessage, shouldTabIntoAnswerOptions, composerFocusIsOurs, createSendLock, answerGateOption, errorCodeOf } from "./src/renderer/src/features/chat/ask-answer";',
			'export { buildSendPayload } from "./src/renderer/src/shared/store/canonical-sessions-store";',
			'export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";',
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
			'export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	jsx: "automatic",
	// React stays EXTERNAL so the bundle shares one copy with this file's own
	// imports. Bundled instead, `react-dom/server`'s CJS build reaches for a
	// dynamic `require("stream")` that esbuild's ESM output cannot satisfy, and
	// two React copies would give the component a different dispatcher than the
	// renderer this test imports.
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
	write: false,
});

// Written to a real file rather than imported as a `data:` URL: React DOM's
// server build resolves its own CJS entry at import time, and a `data:` URL
// has no base path to resolve it from (the same trap
// `backend-error-surfaces.test.mjs` records).
const bundlePath = new URL("./_ask-options.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const {
	AskOptions,
	resolveNumericAnswer,
	answerValue,
	lostAnswerMessage,
	shouldTabIntoAnswerOptions,
	composerFocusIsOurs,
	createSendLock,
	answerGateOption,
	errorCodeOf,
	buildSendPayload,
	desktopRequestSchema,
	desktopEndpoint,
	CanonicalTranscript,
	EMPTY_TRANSCRIPT,
} = await import(bundlePath.href);
// Unlinked as soon as the graph is evaluated, so no build artifact survives a
// crash mid-run and none can be committed by accident.
await unlink(bundlePath);

/** Every `<button>` in a rendered element tree, in document order. */
function buttonsOf(node, found = []) {
	if (node === null || node === undefined || typeof node !== "object") {
		return found;
	}
	if (Array.isArray(node)) {
		for (const child of node) buttonsOf(child, found);
		return found;
	}
	if (node.type === "button") found.push(node);
	if (node.props?.children !== undefined) buttonsOf(node.props.children, found);
	return found;
}

/** The visible text of an element tree, with the `aria-hidden` parts removed. */
function accessibleText(node, out = []) {
	if (node === null || node === undefined || typeof node === "boolean")
		return out;
	if (typeof node === "string" || typeof node === "number") {
		out.push(String(node));
		return out;
	}
	if (Array.isArray(node)) {
		for (const child of node) accessibleText(child, out);
		return out;
	}
	// Decoration is excluded exactly as a screen reader excludes it, which is
	// what makes the ordinal assertion below meaningful.
	if (node.props?.["aria-hidden"] === true) return out;
	if (node.props?.children !== undefined) accessibleText(node.props.children, out);
	return out;
}

/** Every text node in an element tree, `aria-hidden` decoration INCLUDED. */
function visibleText(node, out = []) {
	if (node === null || node === undefined || typeof node === "boolean")
		return out;
	if (typeof node === "string" || typeof node === "number") {
		out.push(String(node));
		return out;
	}
	if (Array.isArray(node)) {
		for (const child of node) visibleText(child, out);
		return out;
	}
	if (node.props?.children !== undefined) visibleText(node.props.children, out);
	return out;
}

const OPTIONS = [
	{
		label: "Popup is open — generate the pairing code",
		description: "I will read the code back to you.",
	},
	{ label: "Popup is not open", description: "Walk me through opening it." },
	{ label: "Something else" },
];

const gate = (over = {}) => ({
	request_id: "11111111-1111-4111-8111-111111111111",
	kind: "ask",
	title: "Is the extension popup open?",
	detail: "",
	options: OPTIONS,
	secret: false,
	question_index: 0,
	question_total: 1,
	...over,
});

const render = (props) =>
	AskOptions({
		options: OPTIONS,
		requestId: "req-1",
		onAnswer: () => {},
		...props,
	});

const SESSION = "a1b2c3d4e5f6";
const EPOCH = "epoch-7";

/** Run one press through the shipped answer path with a recording transport. */
const press = async ({ label, over = {}, send, lock = createSendLock() }) => {
	const sent = [];
	const outcome = await answerGateOption(
		{
			gate: gate(over),
			sessionId: SESSION,
			epoch: EPOCH,
			label,
			lock,
		},
		send ?? (async (request) => void sent.push(request)),
	);
	return { outcome, sent };
};

test("a pressed option answers with its label, and that label is what the wire carries", async () => {
	// Half one: the button's OWN handler, on the tree the shipped component
	// returns. This is what a click does after React's event plumbing.
	const answered = [];
	const buttons = buttonsOf(render({ onAnswer: (label) => answered.push(label) }));
	assert.equal(buttons.length, 3, "one control per option");

	// The SECOND option, so a passing assertion cannot be an index-0 accident.
	buttons[1].props.onClick();
	assert.deepEqual(answered, ["Popup is not open"]);

	// Half two: the SHIPPED answer path, carrying what the click produced. The
	// round-1 review found the old version of this test hand-building the
	// request object, which proved the schema and the endpoint mapper but not
	// that this path emits either of them.
	const { outcome, sent } = await press({
		label: answered[0],
		over: { question_index: 1 },
	});
	assert.equal(outcome.status, "sent");
	assert.equal(sent.length, 1);

	// The REAL schema and the REAL mapper, on the body this path built.
	const parsed = desktopRequestSchema.parse(sent[0]);
	assert.equal(parsed.value, "Popup is not open");
	const wire = desktopEndpoint(parsed);
	assert.equal(wire.path, `/v1/desktop/sessions/${SESSION}/answers`);
	assert.equal(wire.method, "POST");
	assert.equal(wire.body.value, "Popup is not open");
	// `questionIndex` is the GATE's own, not the option's position: answering
	// question 2 with its first option must not report question 1.
	assert.equal(wire.body.question_index, 1);
	// An index would validate as a string and be meaningless to the model, so
	// the label is asserted positively rather than by absence of a number.
	assert.notEqual(wire.body.value, "2");
});

test("one press is one answer: the second loses, and the lock lets go", async () => {
	const lock = createSendLock();
	const sent = [];
	const send = async (request) => void sent.push(request);

	// Two presses dispatched from ONE tick — a double click, or a click racing
	// a keyboard activation on the same question. This is the race a `disabled`
	// prop cannot express, and asserting the prop was all the previous version
	// of this test did (code review round 1).
	const [first, second] = await Promise.all([
		press({ label: OPTIONS[1].label, send, lock }),
		press({ label: OPTIONS[2].label, send, lock }),
	]);
	assert.deepEqual(
		[first.outcome.status, second.outcome.status],
		["sent", "refused"],
	);
	assert.equal(sent.length, 1, "one answer in flight is one answer on the wire");
	assert.equal(sent[0].value, OPTIONS[1].label);

	// The loser sends nothing at all: a refusal is not a failed request.
	assert.deepEqual(second.sent, []);
	// And the lock is free again, so the lock does not wedge the question after
	// a successful answer.
	assert.equal(lock.held, false);
	const third = await press({ label: OPTIONS[0].label, send, lock });
	assert.equal(third.outcome.status, "sent");
	assert.equal(sent.length, 2);
});

test("a question that cannot be addressed is never sent", async () => {
	const lock = createSendLock();
	for (const deps of [
		{ gate: gate({ kind: "approval", options: [] }), sessionId: SESSION, epoch: EPOCH },
		{ gate: gate(), sessionId: null, epoch: EPOCH },
		{ gate: gate(), sessionId: SESSION, epoch: null },
	]) {
		const sent = [];
		const outcome = await answerGateOption(
			{ ...deps, label: "whatever", lock },
			async (request) => void sent.push(request),
		);
		assert.equal(outcome.status, "refused");
		assert.deepEqual(sent, []);
		// A refusal must not hold the lock: taking it before the preconditions
		// would leave the composer disabled on a request that never left.
		assert.equal(lock.held, false);
	}
});

test("a failed answer reports the transport's own code, like a failed send", async () => {
	// One error surface: the click path used to drop `error.code`, so the
	// composer's alert could not offer the remedies that key off it for any
	// failure that came from pressing an option (code review round 1, R-MINOR).
	const coded = Object.assign(new Error("boom"), {
		code: "unresolved_attachment",
	});
	const lock = createSendLock();
	const outcome = await answerGateOption(
		{ gate: gate(), sessionId: SESSION, epoch: EPOCH, label: "x", lock },
		async () => {
			throw coded;
		},
	);
	assert.equal(outcome.status, "failed");
	assert.equal(errorCodeOf(outcome.error), "unresolved_attachment");
	assert.equal(errorCodeOf(new Error("no code")), undefined);
	assert.equal(errorCodeOf("not an error"), undefined);
	// A throw must release the lock too, or one transport blip wedges the
	// composer and the card together until a reload.
	assert.equal(lock.held, false);
});

test("a bare numeral resolves to that option's label", () => {
	const g = gate();
	assert.equal(resolveNumericAnswer(g, "1"), OPTIONS[0].label);
	assert.equal(resolveNumericAnswer(g, "2"), OPTIONS[1].label);
	assert.equal(resolveNumericAnswer(g, "3"), OPTIONS[2].label);
	// Surrounding whitespace is still a bare numeral: the user pressed 1 and
	// Enter.
	assert.equal(resolveNumericAnswer(g, " 2 "), OPTIONS[1].label);
	// And so is the spelling the card ITSELF prints. The ordinals render as
	// `1.` `2.` `3.`, so the most literal transcription of the option's own mark
	// was the one spelling that did not resolve, and it went to the model as
	// prose with no signal that the pick had not been taken (UX round 1, U5).
	assert.equal(resolveNumericAnswer(g, "1."), OPTIONS[0].label);
	assert.equal(resolveNumericAnswer(g, " 2. "), OPTIONS[1].label);
});

test("only a bare, in-range numeral on an options ask is resolved", () => {
	const g = gate();
	// Prose that merely contains a numeral is an answer the user meant
	// literally. Rewriting it would substitute an option they did not choose.
	// `01` and `11` are here rather than above because they are not ordinals the
	// card offers: `01` is a different string from `1` and `11` is not a rung.
	for (const text of [
		"1 of them",
		"option 1",
		"01",
		"11",
		"0",
		"-1",
		"one",
		"1,",
		"1..",
	]) {
		assert.equal(resolveNumericAnswer(g, text), text, `must not rewrite ${text}`);
	}
	// Out of range falls through unchanged: answering the seventh of three is
	// not something this can invent.
	assert.equal(resolveNumericAnswer(g, "7"), "7");
	assert.equal(resolveNumericAnswer(g, "7."), "7.");
	// A gate with no options is a free-text or secret ask, where a numeral is
	// very often the real answer.
	assert.equal(resolveNumericAnswer(gate({ options: [] }), "1"), "1");
	// Approvals are answered yes/no and carry no options; this must never
	// touch that path.
	assert.equal(
		resolveNumericAnswer(gate({ kind: "approval", options: [] }), "1"),
		"1",
	);
});

test("a staged reply's bare ordinal still resolves to the option's label", () => {
	/*
	 * The round-1 MAJOR, made assertable in round 2. The composer does not send
	 * what the user typed: `message-input.tsx` wraps it in `buildSendPayload`, so
	 * with a reply staged the box holds `2` while the wire would carry
	 * `<reply-to>…</reply-to>\n2`. Resolving the PAYLOAD — which is what shipped
	 * before the fix — leaves that wrapped numeral as the answer value of a
	 * one-shot gate, and the model receives it as prose. `answerValue` resolves the
	 * TYPED text; revert it to the payload and the middle assertion fails, which is
	 * the guard the round-1 fix shipped without (code review round 2, F1).
	 */
	const g = gate();
	const payload = buildSendPayload("2", [
		{ text: "Is the extension popup open?" },
	]);
	assert.equal(
		payload,
		"<reply-to>Is the extension popup open?</reply-to>\n2",
	);
	assert.equal(answerValue(g, "2", payload), OPTIONS[1].label);
	assert.equal(answerValue(g, " 1. ", payload), OPTIONS[0].label);
});

test("a reply-wrapped payload is not an ordinal, and is not rewritten", () => {
	/*
	 * The other half of the same decision. A caller with no separate typed text —
	 * the `typed ?? payload` fallback the suggestion grid and any prefix-free
	 * caller take — must not have a wrapped numeral rewritten into an option the
	 * user never picked, and prose must reach the wire exactly as typed whichever
	 * door it came through.
	 */
	const g = gate();
	const payload = buildSendPayload("2", [
		{ text: "Is the extension popup open?" },
	]);
	assert.equal(answerValue(g, undefined, payload), payload);
	assert.equal(answerValue(g, payload, payload), payload);
	for (const text of ["Something else", "1 of them", "option 2", "7", "01"]) {
		assert.equal(answerValue(g, text, text), text, `must not rewrite ${text}`);
	}
	// A payload-only caller holding a genuinely bare ordinal still resolves: that
	// is what the suggestion grid's two-argument call relies on.
	assert.equal(answerValue(g, undefined, "1"), OPTIONS[0].label);
});

test("the gate branch resolves the TYPED text at the call site the app ships", () => {
	/*
	 * The `answerValue` guard above is not the whole MAJOR: reverting the CALL
	 * SITE is the cheaper regression, and it left this file 17/17 green, because
	 * neither `chat-page.tsx` nor `message-input.tsx` is reachable from the entry
	 * points this bundle builds — esbuild walks only what those imports pull in,
	 * and the component that composes the answer is not one of them (code review
	 * round 3, m3).
	 *
	 * A rendered-component test would need a DOM this repo carries no jsdom for, so
	 * the call site is pinned the way `window-mode.test.mjs` pins the window-raise
	 * policy: by reading the shipped source and asserting the one expression that
	 * carries the decision. That is deliberately a pin on THIS expression rather
	 * than a general rule, so a rewrite of the gate branch has to come here and say
	 * what replaced it instead of quietly dropping the guard.
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	/*
	 * A text match is satisfiable by text that is not code, so the source is
	 * stripped of its comments before it is matched: a comment quoting the
	 * expression would otherwise leave the guard green through a revert that left
	 * the quotation behind (code review round 4, n5). The block-comment strip is
	 * non-greedy and the line-comment strip skips `://`, so a URL inside a string
	 * does not swallow the rest of its line.
	 */
	const code = source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
	assert.match(
		code,
		/value:\s*answerValue\(\s*gate,\s*typed,\s*content,?\s*\),\s*\n\s*questionIndex:/,
		"the ask branch must build its value as answerValue(gate, typed, content) - the typed text second, never the composed payload - and it must do so where the request body is built, beside questionIndex",
	);
	assert.equal(
		(code.match(/resolveNumericAnswer\(/g) ?? []).length,
		0,
		"the ordinal rule is reached through answerValue rather than called directly on a payload",
	);
});

test("the gate's focus restore refuses a composer the user has taken", () => {
	/*
	 * The delta's one new decision, and the one it added the hard way: handing
	 * focus to the composer at the press is what fixed U12, and the same hand-off
	 * is indistinguishable from a user CLICKING into an empty box unless the
	 * pointer interaction is tracked. Two measured failures came out of that
	 * (UX round 4): the restore stole the caret and the next `Space` answered the
	 * NEXT question for them (U13), and whether it moved at all depended on which
	 * of two asynchronous paths landed first (U14).
	 *
	 * It is a pure predicate over exactly those inputs - the box, what holds focus,
	 * and whether a pointer has landed since the hand-off - for the same reason
	 * `shouldTabIntoAnswerOptions` is: the DOM-reading caller cannot be asserted
	 * here, so the decision is lifted out of it (code review round 4, n6). Every
	 * row below is a state the rig produced, and the last one is the state it must
	 * MOVE in, so a predicate that always refused would fail here rather than pass.
	 */
	const box = (over = {}) => ({ value: "", ...over });
	const other = { value: "" };
	const focused = box();

	// The press's own hand-off: focused, empty, untouched. The restore moves.
	assert.equal(composerFocusIsOurs(focused, focused, false), true);
	// No composer in the tree at all.
	assert.equal(composerFocusIsOurs(null, null, false), false);
	// Focus is somewhere else entirely.
	assert.equal(composerFocusIsOurs(box(), other, false), false);
	// A follow-up typed during the hold - the case round 3's guard caught.
	assert.equal(composerFocusIsOurs(box({ value: "follow up" }), focused, false), false);
	// Whitespace is content: the user is in the box, whatever they typed.
	assert.equal(composerFocusIsOurs(box({ value: "   " }), focused, false), false);
	// U13: clicked into during the hold, still empty, still focused. The caret is
	// theirs, so the restore must leave it alone.
	assert.equal(composerFocusIsOurs(focused, focused, true), false);
});

test("forward Tab moves into the options only when the composer is done with", () => {
	const event = (over = {}) => ({
		key: "Tab",
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		...over,
	});
	const composer = (over = {}) => ({
		value: "hello",
		selectionStart: 5,
		selectionEnd: 5,
		...over,
	});
	const tab = (e = {}, c = {}, live = true) =>
		shouldTabIntoAnswerOptions(event(e), composer(c), live);
	// The route the round asked for, and the only one: an unmodified Tab, content
	// in the box, the caret at the end of it, and a live option to land on.
	assert.equal(tab(), true);
	// The guards the shipped handler did not have. Each was measured on the real
	// surface as a one-way door out of the composer — 22 consecutive forward Tabs
	// never left the composer/options cycle from an empty box or a mid-draft caret
	// (UX round 2, U7; code review round 2, F2).
	assert.equal(tab({}, { value: "" }), false);
	assert.equal(tab({}, { value: "   " }), false);
	assert.equal(tab({}, { selectionStart: 2, selectionEnd: 2 }), false);
	// A selection is not a caret at the end: the user is editing, not leaving.
	assert.equal(tab({}, { selectionStart: 1, selectionEnd: 4 }), false);
	// Every other chord, and every other key, keeps its native meaning.
	assert.equal(tab({ shiftKey: true }), false);
	assert.equal(tab({ ctrlKey: true }), false);
	assert.equal(tab({ altKey: true }), false);
	assert.equal(tab({ metaKey: true }), false);
	assert.equal(tab({ key: "Enter" }), false);
	// A held or absent card offers no live option, so Tab behaves natively — the
	// half of the old handler that was already right.
	assert.equal(tab({}, {}, false), false);
	// A selection the browser cannot report (no textarea) is not the end of the
	// text either.
	assert.equal(tab({}, { selectionStart: null, selectionEnd: null }), false);
});

test("the card prints no ordinal a user could not type against", () => {
	const twelve = Array.from({ length: 12 }, (_, index) => ({
		label: `Option ${String(index + 1)}`,
	}));
	const buttons = buttonsOf(render({ options: twelve }));
	assert.equal(buttons.length, 12);
	const textOf = (button) =>
		visibleText(button).join("").replace(/\s+/g, " ").trim();
	// 1-9 keep the ordinal, because typing one resolves to that label.
	assert.match(textOf(buttons[8]), /^9\./);
	// 10-12 do not, because `resolveNumericAnswer` is 1-9 and the terminal's
	// shortcut has no tenth rung: a numeral there is a key that cannot be pressed,
	// which is the class of lie this card exists to stop telling (UX round 2,
	// U11). The rows stay pressable.
	for (const index of [9, 10, 11]) {
		assert.doesNotMatch(textOf(buttons[index]), /^1[0-2]\./);
	}
});

test("an answer that lost the gate is reported, whichever status carried it", () => {
	/*
	 * The two shapes a press can lose in, and the two it must stay quiet in.
	 *
	 * The second of the losing shapes is the defect: the backend accepts an answer
	 * for a gate another front end already answered and returns 200, so the
	 * transport status cannot be the test — the gate having moved is. Revert the
	 * `sent` half and the user is told nothing at all, which is what the round
	 * measured (24 samples over 12s, all empty; QA round 2, F-A, UX round 2, U9).
	 */
	const refusal = lostAnswerMessage({ status: "sent" }, false);
	assert.match(refusal ?? "", /already answered somewhere else/);
	assert.match(
		lostAnswerMessage({ status: "failed", error: new Error("409") }, false) ?? "",
		/already answered somewhere else/,
	);
	// Quiet while the gate this press belonged to still stands: the card owns the
	// outcome there — the refusal sentence on a failure, the held card on a send.
	assert.equal(lostAnswerMessage({ status: "sent" }, true), null);
	assert.equal(
		lostAnswerMessage({ status: "failed", error: new Error("x") }, true),
		null,
	);
	// And quiet for a refused press whatever the gate did: nothing was sent, and
	// the holder of the lock is the surface that reports it.
	assert.equal(lostAnswerMessage({ status: "refused" }, false), null);
});

test("recommended is optional, and marks only a real index", () => {
	const marked = (props) =>
		buttonsOf(render(props)).map((button) =>
			accessibleText(button).join(" ").includes("Recommended"),
		);
	// The harness hoists the recommended option to index 0.
	assert.deepEqual(marked({ recommended: 0 }), [true, false, false]);
	assert.deepEqual(marked({ recommended: 2 }), [false, false, true]);
	// Absent (a backend older than the ask-picker contract), null, out of
	// range, and non-integer all mark nothing rather than defaulting to 0.
	assert.deepEqual(marked({}), [false, false, false]);
	assert.deepEqual(marked({ recommended: null }), [false, false, false]);
	assert.deepEqual(marked({ recommended: 9 }), [false, false, false]);
	assert.deepEqual(marked({ recommended: -1 }), [false, false, false]);
	assert.deepEqual(marked({ recommended: 1.5 }), [false, false, false]);
});

test("one answer at a time: every option is disabled while one is in flight", () => {
	// The RENDERED half of the property. `busy` is the composer's shared
	// in-flight flag, and `SessionPanel` also holds it after a press until the
	// gate itself moves — so there is no live control for a second press to
	// land on in either window.
	//
	// The RACE — two presses dispatched from one tick — is a different claim,
	// and it is asserted against the shipped handler in "one press is one
	// answer" above. A `disabled` prop cannot express it, which is exactly what
	// the round-1 review caught the previous version of this test asserting.
	const live = buttonsOf(render({ onAnswer: () => {} }));
	assert.deepEqual(
		live.map((b) => Boolean(b.props.disabled)),
		[false, false, false],
		"options are live before an answer is in flight",
	);
	const inFlight = buttonsOf(render({ busy: true, onAnswer: () => {} }));
	assert.deepEqual(
		inFlight.map((b) => Boolean(b.props.disabled)),
		[true, true, true],
		"every option is disabled while an answer is in flight",
	);
});

test("the accessible name is the label, not the numeral", () => {
	const buttons = buttonsOf(render({ recommended: 0 }));
	const first = accessibleText(buttons[0]).join(" ");
	// The ordinal is decoration and must not be read out: "1. Popup is open"
	// names a position the agent cannot use.
	assert.ok(!first.includes("1."), `ordinal leaked into the name: ${first}`);
	assert.ok(first.includes("Popup is open"));
	// The consequence line stays visible — both the phone card and the
	// terminal picker show it, and it is often what distinguishes two options.
	assert.ok(first.includes("I will read the code back to you."));
	// The third option has no description and must still render.
	assert.ok(accessibleText(buttons[2]).join(" ").includes("Something else"));
});

test("a secret ask renders no options at all", () => {
	// `secret: true` arrives with EMPTY options: the answer is a credential
	// pasted into the composer's masked input, and a clickable list has
	// nothing to offer it.
	assert.equal(render({ options: [] }), null);
});

test("the production transcript renders options as real controls", () => {
	// The regression this whole change is about: the gate used to paint an
	// inert `<ul>`. Rendered from the SHIPPED `CanonicalTranscript` so the
	// assertion is about what ships, not about a component in isolation.
	const markup = renderToStaticMarkup(
		createElement(CanonicalTranscript, {
			transcript: EMPTY_TRANSCRIPT,
			gate: gate({ recommended: 0, question_index: 0, question_total: 2 }),
			waiting: false,
			loadingOlder: false,
			onLoadOlder: async () => true,
			containerRef: { current: null },
			isSmallView: false,
			status: "live",
			// Required by this branch's hold work, and `true` for these fixtures: a
			// settled, empty conversation the reader has been told about. Without it the
			// pane paints its placeholder, whose `<output>` would then sit in every state
			// this file asserts about the answer card.
			hydrated: true,
			error: null,
			onAnswer: () => {},
		}),
	);
	// A `fieldset` rather than `role="group"`: the semantic element carries the
	// grouping, so this asserts the element and its label, not an ARIA role
	// restating it.
	assert.ok(markup.includes("<fieldset"), "the options are a labelled group");
	assert.ok(markup.includes('aria-label="Answer options"'));
	assert.ok(
		markup.includes("Popup is not open"),
		"every option label paints",
	);
	assert.ok(markup.includes("Recommended"), "the recommended option is marked");
	// The multi-question prefix survives, and the hint names the affordances
	// while keeping the free-text path honest. The digits are named because they
	// work and nothing else says so: the card draws `1.` `2.` `3.` and typing one
	// resolves to that label (UX round 1, U6). "type ... and send", not "press",
	// because a digit on its own does nothing — it is typed into the composer and
	// only sending resolves it (UX round 2, U10).
	assert.ok(markup.includes("Question 1 of 2."));
	assert.ok(
		markup.includes(
			"Choose an option, type 1-9 and send, or type your own answer below.",
		),
	);
	// The idles eyebrow, and no "sending" claim while nothing is in flight.
	assert.ok(markup.includes("Waiting for your answer"));
	assert.ok(!markup.includes("Sending your answer"));
	// The old dead list must be gone: no `<li>` carrying an option.
	assert.ok(
		!/<li[^>]*>[^<]*Popup is not open/.test(markup),
		"options must not render as inert list items",
	);
});

test("an answer in flight says so, and the card holds itself after a press", () => {
	// D3/U2: on a slow round trip the card was frozen for seconds with nothing
	// on it changing but a colour step the user never saw move. The eyebrow is
	// the sentence that says the press landed.
	const base = {
		transcript: EMPTY_TRANSCRIPT,
		gate: gate({ recommended: 0 }),
		waiting: false,
		loadingOlder: false,
		onLoadOlder: async () => true,
		containerRef: { current: null },
		isSmallView: false,
		status: "live",
		// Required by this branch's hold work, and `true` for these fixtures: a
		// settled, empty conversation the reader has been told about. Without it the
		// pane paints its placeholder, whose `<output>` would then sit in every state
		// this file asserts about the answer card.
		hydrated: true,
		error: null,
		onAnswer: () => {},
	};
	const sending = renderToStaticMarkup(
		createElement(CanonicalTranscript, {
			...base,
			answering: true,
			answer: { sending: true, refused: null },
		}),
	);
	assert.ok(sending.includes("Sending your answer…"));
	assert.ok(!sending.includes("Waiting for your answer"));

	// The hold after a press: options disabled, no second press, no sending
	// claim (the answer landed, the next stream frame has not arrived), and the
	// refusal itself is absent because this one was accepted.
	const held = renderToStaticMarkup(
		createElement(CanonicalTranscript, {
			...base,
			answer: { sending: false, refused: null },
		}),
	);
	assert.ok(held.includes("disabled"), "the card holds its options disabled");
	assert.ok(held.includes("Waiting for your answer"));
	assert.ok(!held.includes("<output"));

	// A refusal lands on the card the press was made on, outcome first (QA
	// round 1, Q3; UX round 1, U4), and the card stays held so it cannot be
	// repeated.
	const refused = renderToStaticMarkup(
		createElement(CanonicalTranscript, {
			...base,
			answer: {
				sending: false,
				refused: "Your answer was not sent. The request could not be completed.",
			},
		}),
	);
	assert.ok(refused.includes("<output"));
	assert.ok(refused.includes("Your answer was not sent."));
});
