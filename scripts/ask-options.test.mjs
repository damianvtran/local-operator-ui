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
 * 4. **A press is reported from its own outcome, never from its card.** The
 *    verdict used to be a DOM read — "is the card still on screen?" — so a press
 *    the owner took was reported lost whenever its own success had already
 *    removed that card (the response and the owner's state push have no ordering
 *    between them; the measured margin is ~76 ms). `answerReport` is asserted in
 *    all four of its cases here, including the one the bug was: a `2xx` says
 *    nothing at all.
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
			'export { resolveNumericAnswer, answerValue, answerReport, answerRefusedWithoutACode, answerOutcomeIsUnknown, answerUnconfirmedMessage, SETTLED_ELSEWHERE_MESSAGE, QUESTION_MOVED_ON_MESSAGE, ANSWER_UNCONFIRMED_LEAD, ANSWER_LOST_TO_RECONNECT_MESSAGE, unsentAnswerMessage, shouldTabIntoAnswerOptions, composerFocusIsOurs, createSendLock, answerGateOption, errorCodeOf } from "./src/renderer/src/features/chat/ask-answer";',
			'export { DesktopControlError, UserFacingError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { buildSendPayload, ANSWER_NOT_SENT_CODE, UNCONFIRMED_SEND_CODE } from "./src/renderer/src/shared/store/canonical-sessions-store";',
			'export { DESKTOP_LOST_SIGHT_CODE } from "./src/shared/desktop-contract";',
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
	answerReport,
	answerRefusedWithoutACode,
	answerOutcomeIsUnknown,
	SETTLED_ELSEWHERE_MESSAGE,
	QUESTION_MOVED_ON_MESSAGE,
	answerUnconfirmedMessage,
	ANSWER_UNCONFIRMED_LEAD,
	ANSWER_LOST_TO_RECONNECT_MESSAGE,
	unsentAnswerMessage,
	shouldTabIntoAnswerOptions,
	composerFocusIsOurs,
	createSendLock,
	answerGateOption,
	errorCodeOf,
	DesktopControlError,
	UserFacingError,
	buildSendPayload,
	ANSWER_NOT_SENT_CODE,
	UNCONFIRMED_SEND_CODE,
	DESKTOP_LOST_SIGHT_CODE,
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
	if (node.props?.children !== undefined)
		accessibleText(node.props.children, out);
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
	const buttons = buttonsOf(
		render({ onAnswer: (label) => answered.push(label) }),
	);
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
	assert.equal(
		sent.length,
		1,
		"one answer in flight is one answer on the wire",
	);
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
		{
			gate: gate({ kind: "approval", options: [] }),
			sessionId: SESSION,
			epoch: EPOCH,
		},
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
		assert.equal(
			resolveNumericAnswer(g, text),
			text,
			`must not rewrite ${text}`,
		);
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
	assert.equal(payload, "<reply-to>Is the extension popup open?</reply-to>\n2");
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

test("the press's report is routed by the LIVE card's identity, at the call site the app ships", () => {
	/*
	 * Two things the `answerReport` assertions above cannot see, and both left this
	 * file green when they were sabotaged (code review round 1, m1 and m2):
	 *
	 * - the SWITCH that consumes the report. `chat-page.tsx` is unreachable from
	 *   this bundle's entry points, so swapping the `card` and `composer` arms —
	 *   writing the refusal where nothing renders — changed nothing here. The same
	 *   hole the `answerValue` call-site pin above was written for.
	 * - the VALUE handed to it. `document.querySelector('[aria-label="Answer
	 *   options"]') !== null` is true for ANY options card, including the card of
	 *   the NEXT question in the same ask, which cannot render this press's refusal
	 *   (design round 1, D1). The unit assertions take that boolean as an argument,
	 *   so they cannot see what the app passes.
	 *
	 * Pinned by reading the shipped source, comments stripped first so a quotation
	 * cannot satisfy it — the `window-mode.test.mjs` pattern this file already uses.
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	const code = source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

	// The live facts the report is built from, read from the refs the layout effect
	// keeps current — never from the closure this handler resumed in, which is the
	// value the deleted conjunct compared with itself. Both writes sit INSIDE a
	// `useLayoutEffect`: the render-body spelling ran inside commits React can
	// discard (StrictMode, Suspense), and a leaked newer key would render the
	// moved-on sentence for a question still on screen (agent review round 2,
	// MINOR-3). The effect is what keeps the liveness — it runs inside the commit,
	// after DOM mutation and before paint — without that hazard.
	assert.match(
		code,
		/useLayoutEffect\(\(\) => \{\s*\n\s*liveGateKey\.current = gateKey;\s*\n\s*liveOwnerEpoch\.current = canonical\.ownerEpoch;\s*\n\s*\}\);/,
		"both live facts must be written together, inside the commit and not during a render React can discard",
	);
	assert.doesNotMatch(
		code,
		/^\tliveGateKey\.current = gateKey;$/m,
		"the render-body write is the hazard the layout effect replaces",
	);
	// The frame: the DOM read, the live key against the press's own key, and the
	// two epochs. `sentEpoch` is the closure value ON PURPOSE (it is what the press
	// sent); everything else is live.
	assert.match(
		code,
		/liveGateKey: liveGateKey\.current,\s*\n\s*pressedGateKey: key,\s*\n\s*sentEpoch: canonical\.ownerEpoch,\s*\n\s*liveEpoch: liveOwnerEpoch\.current,\s*\n\s*cardOnScreen:/,
		"the report must be given the live key, the press's own key, the epoch it SENT and the live one",
	);
	assert.match(
		code,
		/cardOnScreen:\s*\n?\s*document\.querySelector\('\[aria-label="Answer options"\]'\) !== null,/,
		"the DOM read is the frame's cardOnScreen, and the identity is decided by the keys rather than by the query alone",
	);
	// The composer arm: the sentence AND the report's own code, in that arm.
	assert.match(
		code,
		/case "composer":[\s\S]{0,1200}?setSendError\(report\.message\);\s*\n\s*setSendErrorCode\(report\.code\);/,
		"the composer arm must write the report's message AND its code - the code is what stops the alert inheriting the draft's failure",
	);
	// The card arm writes to the card's own hold, and only with this press's key.
	// `report.refused` and not a sentence composed here: the register is the
	// outcome's, so the card carries the same string the composer would (UX round
	// 2, U7 / QA Q1).
	assert.match(
		code,
		/case "card":[\s\S]{0,600}?setAnswerState\(\{ key, sending: false, refused: report\.refused \}\);/,
		"the card arm must write the report's own sentence onto the press's card state",
	);
	assert.doesNotMatch(
		code,
		/refused:\s*unsentAnswerMessage\(/,
		"the card arm must not compose the definite sentence itself - that is what made an unknowable outcome claim a loss",
	);
	// The sent arm says nothing: no sentence is written on the winning path.
	assert.match(
		code,
		/case "sent":[\s\S]{0,900}?setAnswerState\(\{ key, sending: false, refused: null \}\);\s*\n\s*return;/,
		"the sent arm settles the card's hold and returns without a sentence",
	);
	assert.doesNotMatch(
		code,
		/setSendError\(\s*(?:QUESTION_MOVED_ON_MESSAGE|SETTLED_ELSEWHERE_MESSAGE|ANSWER_UNCONFIRMED_LEAD)/,
		"the sentence is chosen by `answerReport`, never written by the call site",
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
	assert.equal(
		composerFocusIsOurs(box({ value: "follow up" }), focused, false),
		false,
	);
	// Whitespace is content: the user is in the box, whatever they typed.
	assert.equal(
		composerFocusIsOurs(box({ value: "   " }), focused, false),
		false,
	);
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

test("a press is reported from its OWN outcome, never from its card", () => {
	/*
	 * The cases that discriminate, and the bug this replaces.
	 *
	 * The old verdict asked the DOM whether the card was still on screen, so a
	 * press the owner TOOK was reported lost whenever its own success had already
	 * removed that card — which is the ordering a busy turn produces, because the
	 * answer's response and the owner's state push have no ordering between them.
	 * The `sent` assertions below are that bug: they used to demand the sentence.
	 *
	 * `frame()` builds the live facts the caller reads at the moment the outcome
	 * lands, and its defaults are the state a refused press usually leaves: the
	 * card gone, no gate pending, and the epoch unmoved. Every arm below overrides
	 * only the fact it is about, so a sentence can only change for the reason its
	 * own case names.
	 */
	const UNSENT =
		"Your answer was not sent. The request could not be completed.";
	const EPOCH = "40d350af1fb84884833ad3a3e84a2c8d";
	const frame = (over = {}) => ({
		liveGateKey: null,
		pressedGateKey: "req-1:0",
		sentEpoch: EPOCH,
		liveEpoch: EPOCH,
		cardOnScreen: false,
		...over,
	});
	/*
	 * The owner's own refusal: 409, and no typed code. ALL THREE of the route's
	 * codeless refusals take this shape, which is why the status alone cannot pick
	 * the sentence and the live facts must (code review round 1, MAJOR-1): a
	 * settlement, an ask that advanced, and an epoch the previous runtime minted.
	 * The bodies are the route's own, measured.
	 */
	const settled = new DesktopControlError(
		409,
		"This question or approval is no longer pending",
	);
	const advanced = new DesktopControlError(
		409,
		"the answer does not match the current question",
	);
	const rolledOver = new DesktopControlError(
		409,
		"This answer belongs to an earlier session owner",
	);

	// (i) 2xx, with the store AND the card already cleared before the response
	// resolves. The owner has our value, so the composer says nothing at all —
	// the report is the same whatever the frame holds.
	assert.deepEqual(answerReport({ status: "sent" }, frame()), { to: "sent" });
	assert.deepEqual(
		answerReport({ status: "sent" }, frame({ cardOnScreen: true })),
		{ to: "sent" },
	);

	// (ii) all three refusals ARE the answer route's codeless refusal — the
	// predicate is about the shape, and the sentence is about the state.
	for (const error of [settled, advanced, rolledOver]) {
		assert.equal(
			answerRefusedWithoutACode(error),
			true,
			`${error.message} is the answer route refusing without a code`,
		);
	}

	// (iii) the SPLIT, which is the fix for MAJOR-1: the same status, three
	// states, three sentences — and each of them true of the state it renders in.
	// A. No gate pending and the epoch unmoved: something settled it, and it was
	// not this press (a press the owner took answers 2xx), so "somewhere else" is a
	// fact.
	assert.deepEqual(
		answerReport({ status: "failed", error: settled }, frame()),
		{
			to: "composer",
			message: SETTLED_ELSEWHERE_MESSAGE,
			code: ANSWER_NOT_SENT_CODE,
		},
	);
	// B. A gate pending that is a DIFFERENT question: the ask advanced past the
	// question this press answered.
	assert.deepEqual(
		answerReport(
			{ status: "failed", error: advanced },
			frame({ liveGateKey: "req-1:1" }),
		),
		{
			to: "composer",
			message: QUESTION_MOVED_ON_MESSAGE,
			code: ANSWER_NOT_SENT_CODE,
		},
	);
	// C. The epoch MOVED: the press was addressed to a runtime instance that is
	// gone, so nothing about who answered the question is established and the app
	// must not claim another front end did. The honest sentence carries the
	// backend's own reason — and this is the state the reviewer measured with the
	// question still pending and still answerable, which the old wording got wrong.
	assert.deepEqual(
		answerReport(
			{ status: "failed", error: rolledOver },
			frame({ liveEpoch: "ffffffffffffffffffffffffffffffff" }),
		),
		{
			to: "composer",
			message: ANSWER_LOST_TO_RECONNECT_MESSAGE,
			code: ANSWER_NOT_SENT_CODE,
		},
	);
	// D. The epoch moved with a gate still pending under the SAME key: the same
	// arm, because the rollover is checked first and it is the fact that makes
	// every other reading unusable. This is the state the reviewer measured.
	assert.deepEqual(
		answerReport(
			{ status: "failed", error: rolledOver },
			frame({
				liveEpoch: "ffffffffffffffffffffffffffffffff",
				liveGateKey: "req-1:0",
				cardOnScreen: false,
			}),
		),
		{
			to: "composer",
			message: ANSWER_LOST_TO_RECONNECT_MESSAGE,
			code: ANSWER_NOT_SENT_CODE,
		},
	);

	// (iv) the card carries the sentence only while it is the PRESSED card: on
	// screen AND the pressed question. Either half alone is a card this report
	// cannot use.
	const onPressedCard = (error, over = {}) =>
		answerReport(
			{ status: "failed", error },
			frame({ cardOnScreen: true, liveGateKey: "req-1:0", ...over }),
		);
	// The card is on screen but it is the NEXT question's (design round 1, D1):
	// the sentence goes to the composer, which is the surface that survives.
	assert.equal(
		answerReport(
			{ status: "failed", error: settled },
			frame({ cardOnScreen: true, liveGateKey: "req-1:1" }),
		).to,
		"composer",
	);
	// The pressed question is live but no card has painted it yet.
	assert.equal(
		answerReport(
			{ status: "failed", error: settled },
			frame({ cardOnScreen: false, liveGateKey: "req-1:0" }),
		).to,
		"composer",
	);

	// (v) THE REGISTER IS THE OUTCOME'S, NOT THE SURFACE'S (UX round 2, U7; QA
	// round 2, Q1). The deadline shape leaves the card up *precisely because* the
	// request is still in flight, so this is what a plain press reaches — and it
	// used to be told "Your answer was not sent" and then denied it in the next
	// clause. One error class, one claim, on whichever surface carries it.
	const deadline = new DesktopControlError(
		504,
		"The app waits up to 20 seconds for this request, and it was still running when the app stopped waiting. It may or may not have reached the server; check the result before repeating it.",
		undefined,
		"deadline_exceeded",
	);
	assert.deepEqual(onPressedCard(deadline), {
		to: "card",
		refused: answerUnconfirmedMessage(deadline),
	});
	// The card's copy does not assert a loss, which is the whole finding.
	assert.doesNotMatch(
		onPressedCard(deadline).refused,
		/your answer was not sent/i,
		"the card must not claim a loss for an outcome the module calls unknowable",
	);

	// (vi) THE ROLLOVER SENTENCE IS THE APP'S OWN, ON BOTH SURFACES (UX round 2,
	// U8; design round 2, D9). A rollover refusal arrives with the gate still
	// painted, so the card arm is the one a plain press reaches while the composer
	// arm is the one a race reaches; rendering the backend's raw `detail` on one and
	// an authored sentence on the other made the copy a function of a race the user
	// cannot see. Same string, both surfaces, and it is the app's voice rather than
	// the route's — the route's sentence names an owner the user has never met.
	assert.deepEqual(
		onPressedCard(rolledOver, {
			liveEpoch: "ffffffffffffffffffffffffffffffff",
		}),
		{
			to: "card",
			refused: ANSWER_LOST_TO_RECONNECT_MESSAGE,
		},
	);
	assert.equal(
		answerReport(
			{ status: "failed", error: rolledOver },
			frame({ liveEpoch: "ffffffffffffffffffffffffffffffff" }),
		).message,
		ANSWER_LOST_TO_RECONNECT_MESSAGE,
	);
	assert.doesNotMatch(
		ANSWER_LOST_TO_RECONNECT_MESSAGE,
		/earlier session owner|session owner/i,
		"the rollover sentence must not carry the backend's own vocabulary",
	);
	assert.match(
		ANSWER_LOST_TO_RECONNECT_MESSAGE,
		/\.$/,
		"the family's sentences end in a full stop, and this one did not",
	);

	// (vii) THE SIXTH STATE the enumeration used to leave unnamed (agent review
	// round 2, NIT-4): a codeless `409` with the pressed question STILL LIVE and its
	// card painted. A `409` never settled OUR value, so the not-sent half holds, and
	// with the gate still current the app has nothing better to say than what the
	// route said.
	assert.deepEqual(onPressedCard(settled), {
		to: "card",
		refused: `Your answer was not sent. ${settled.message}`,
	});

	// (v) NO HTTP RESPONSE AT ALL: the outcome is unknown, and the sentence says
	// so rather than asserting a loss (UX round 1, U1 — the owner HAD kept the
	// pressed label while the composer claimed it was not sent). The code is the
	// app's existing one for an unconfirmable send.
	for (const error of [
		new DesktopControlError(
			null,
			"Desktop controls could not reach the backend process.",
		),
		new Error("409"),
	]) {
		assert.equal(
			answerOutcomeIsUnknown(error),
			true,
			`${String(error.message)} carries no HTTP response, so the outcome is unknown`,
		);
		assert.deepEqual(answerReport({ status: "failed", error }, frame()), {
			to: "composer",
			message: answerUnconfirmedMessage(error),
			code: UNCONFIRMED_SEND_CODE,
		});
	}
	/*
	 * And the same arm for the failures the MAIN process and the DAEMON author: main's
	 * deadline (a `504` it synthesises, whose own sentence already says "It may or may
	 * not have reached the server; check the result before repeating it"), main's
	 * transport failure, and the daemon's own hop failure. All three are measured —
	 * `--hold-answers-ms` rendered the first against the committed rig — and all
	 * three would otherwise land in the definite arm on their status alone, which is
	 * the false claim this arm exists to stop (UX round 1, U1).
	 *
	 * The third is round 2's MAJOR-1: the answer route hands the value to the
	 * session's owner over a WRITE-THEN-AWAIT-ACK frame, so a lost or slow ack
	 * answers `503 {"code": "runtime_unreachable"}` — and the write happens before
	 * the wait, so the request may have arrived and settled with only its ack lost.
	 * That is the same fact `transport.failed` carries one hop up, and treating the
	 * two differently produced the definite sentence for an answer the owner kept.
	 */
	for (const error of [
		new DesktopControlError(
			504,
			"The app waits up to 20 seconds for this request, and it was still running when the app stopped waiting. It may or may not have reached the server; check the result before repeating it.",
			undefined,
			"deadline_exceeded",
		),
		new DesktopControlError(
			503,
			"Desktop controls could not reach the backend process.",
			undefined,
			"transport.failed",
		),
		new DesktopControlError(
			503,
			"Session owner is unavailable. Reconnect and reconcile before retrying.",
			undefined,
			DESKTOP_LOST_SIGHT_CODE.runtimeUnreachable,
		),
	]) {
		assert.equal(
			answerOutcomeIsUnknown(error),
			true,
			`${String(error.message)} is the app losing sight of the request, not the owner refusing it`,
		);
		assert.deepEqual(answerReport({ status: "failed", error }, frame()), {
			to: "composer",
			message: answerUnconfirmedMessage(error),
			code: UNCONFIRMED_SEND_CODE,
		});
	}
	/*
	 * The two the BACKEND authors are NOT this arm, whatever their status: a `503`
	 * the daemon sent (`pairing.plane-closed`) was answered and refused, and
	 * `pairing.no-credential` is main refusing to send the request at all.
	 */
	for (const error of [
		new DesktopControlError(
			503,
			"The daemon is running with its desktop plane shut.",
			undefined,
			"pairing.plane-closed",
		),
		new DesktopControlError(
			503,
			"This app holds no token for the daemon it can see.",
			undefined,
			"pairing.no-credential",
		),
	]) {
		assert.equal(
			answerOutcomeIsUnknown(error),
			false,
			`${String(error.message)} was a refusal, not a lost request`,
		);
	}

	// (vi) a status the backend really sent: it was heard and it refused, so
	// "your answer was not sent" is what the backend just said. A coded 409 keeps
	// its own code and its own remedies.
	for (const error of [
		new DesktopControlError(503, "Session owner is unavailable."),
		new DesktopControlError(
			409,
			"That message is too large to send.",
			undefined,
			"request_too_large",
		),
	]) {
		assert.equal(
			answerRefusedWithoutACode(error),
			false,
			`${String(error.message)} must not be read as the answer route's bare refusal`,
		);
		assert.equal(
			answerOutcomeIsUnknown(error),
			false,
			`${String(error.message)} is a response the backend sent`,
		);
		assert.deepEqual(answerReport({ status: "failed", error }, frame()), {
			to: "composer",
			message: unsentAnswerMessage(error),
			// The transport's own code where it carried one — `desktopResult`
			// attaches one for the statuses it classifies — and the report's own
			// otherwise, because the alert's hint must be a function of THIS
			// failure rather than of the draft's last one.
			code: errorCodeOf(error) ?? ANSWER_NOT_SENT_CODE,
		});
	}
	/*
	 * And the SETTLED sentence must not be rendered for a refusal the live facts
	 * do not establish — the wording is true only of the arm that has no gate
	 * pending, which is what the split above is for. Pinned here so a reinstatement
	 * is caught by the instrument rather than by a reader who would have to know
	 * the route's three bodies (code review round 1, MAJOR-1).
	 *
	 * The rollover's own sentence is the app's, not the route's (design round 2,
	 * D9), so the pin is also that the backend's `detail` never reaches a user here.
	 */
	assert.equal(
		answerReport(
			{ status: "failed", error: rolledOver },
			frame({ liveEpoch: "ffffffffffffffffffffffffffffffff" }),
		).message,
		ANSWER_LOST_TO_RECONNECT_MESSAGE,
		"the settled sentence must not be reached when the epoch moved",
	);
	/*
	 * The COPY of the two remaining sentences, pinned for what each may claim.
	 * A comparison against the imported constant cannot see a rewording, so these
	 * are the assertions that catch one — and each is about the arm the sentence
	 * actually renders in:
	 *
	 *   - the moved-on sentence must not name a cause it cannot establish. The ask
	 *     ADVANCING produces it too, and there is no other front end in that case.
	 *   - the unknown-outcome sentence must not assert a loss at all. That is the
	 *     whole reason it exists (UX round 1, U1).
	 */
	assert.doesNotMatch(
		QUESTION_MOVED_ON_MESSAGE,
		/somewhere else|another front end|other (?:device|window|tab)/i,
		"the moved-on sentence must not name a cause the ask advancing cannot establish",
	);
	assert.doesNotMatch(
		ANSWER_UNCONFIRMED_LEAD,
		/your answer was not sent/i,
		"the unknown-outcome sentence must not assert a loss the app cannot know",
	);

	// The reason is carried, and only authored copy is: a `UserFacingError` is a
	// sentence we wrote, while a runtime exception's `message` is not copy at all.
	assert.equal(
		unsentAnswerMessage(
			new UserFacingError("That message is too large to send."),
		),
		"Your answer was not sent. That message is too large to send.",
	);
	assert.equal(
		unsentAnswerMessage(new TypeError("fetch failed")),
		UNSENT,
		"a stack-trace fragment must never become the user's copy",
	);

	// And refused stays silent whatever the frame holds: nothing was sent, and the
	// holder of the lock is the surface that reports it.
	assert.deepEqual(answerReport({ status: "refused" }, frame()), {
		to: "refused",
	});
	assert.deepEqual(
		answerReport({ status: "refused" }, frame({ cardOnScreen: true })),
		{ to: "refused" },
	);
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
			// Required by this branch's hold work, and `false` for these fixtures: no page
			// is owed, so the pane paints no placeholder - whose `<output>` would
			// otherwise sit in every state this file asserts about the answer card.
			awaitingHydration: false,
			error: null,
			onAnswer: () => {},
		}),
	);
	// A `fieldset` rather than `role="group"`: the semantic element carries the
	// grouping, so this asserts the element and its label, not an ARIA role
	// restating it.
	assert.ok(markup.includes("<fieldset"), "the options are a labelled group");
	assert.ok(markup.includes('aria-label="Answer options"'));
	assert.ok(markup.includes("Popup is not open"), "every option label paints");
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
		// Required by this branch's hold work, and `false` for these fixtures: no page
		// is owed, so the pane paints no placeholder - whose `<output>` would otherwise
		// sit in every state this file asserts about the answer card.
		awaitingHydration: false,
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
				refused:
					"Your answer was not sent. The request could not be completed.",
			},
		}),
	);
	assert.ok(refused.includes("<output"));
	assert.ok(refused.includes("Your answer was not sent."));
});
