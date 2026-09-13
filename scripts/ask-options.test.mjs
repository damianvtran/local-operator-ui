import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The `ask` gate's clickable options, asserted against the SHIPPED modules.
 *
 * Three things are checked here, and each is a property that a screenshot
 * cannot prove and that a future edit could break silently:
 *
 * 1. **An option answers with its LABEL, through the real transport schema.**
 *    The wire contract is "answer with the label the model wrote"
 *    (`ask_picker.py`: "It answers with TEXT, not an index"), so a body
 *    carrying an index — or carrying the visible numeral — is the defect this
 *    change exists to remove. The request is validated by the REAL
 *    `desktopRequestSchema` and mapped by the REAL path mapper, so a change to
 *    either that broke the answer op would fail here rather than in QA.
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
			'export { resolveNumericAnswer } from "./src/shared/desktop-session-contract";',
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

test("an option answers with its label, and the body reaches the answer op", () => {
	const answered = [];
	const tree = render({ onAnswer: (label) => answered.push(label) });
	const buttons = buttonsOf(tree);
	assert.equal(buttons.length, 3, "one control per option");

	// The SECOND option, so a passing assertion cannot be an index-0 accident.
	buttons[1].props.onClick();
	assert.deepEqual(answered, ["Popup is not open"]);

	// The label travels as `value` on the real answer op. `questionIndex` is
	// the gate's own, not the option's position — answering question 2 of 3
	// with its first option must not report question 1.
	const request = {
		op: "sessions.answer",
		sessionId: "a1b2c3d4e5f6",
		epoch: "epoch-7",
		requestId: gate().request_id,
		value: answered[0],
		questionIndex: 1,
	};
	const parsed = desktopRequestSchema.parse(request);
	assert.equal(parsed.value, "Popup is not open");
	const wire = desktopEndpoint(parsed);
	assert.equal(
		wire.path,
		"/v1/desktop/sessions/a1b2c3d4e5f6/answers",
	);
	assert.equal(wire.method, "POST");
	assert.equal(wire.body.value, "Popup is not open");
	assert.equal(wire.body.question_index, 1);
	// An index would validate as a string and be meaningless to the model, so
	// the label is asserted positively rather than by absence of a number.
	assert.notEqual(wire.body.value, "2");
});

test("a bare numeral resolves to that option's label", () => {
	const g = gate();
	assert.equal(resolveNumericAnswer(g, "1"), OPTIONS[0].label);
	assert.equal(resolveNumericAnswer(g, "2"), OPTIONS[1].label);
	assert.equal(resolveNumericAnswer(g, "3"), OPTIONS[2].label);
	// Surrounding whitespace is still a bare numeral: the user pressed 1 and
	// Enter.
	assert.equal(resolveNumericAnswer(g, " 2 "), OPTIONS[1].label);
});

test("only a bare, in-range numeral on an options ask is resolved", () => {
	const g = gate();
	// Prose that merely contains a numeral is an answer the user meant
	// literally. Rewriting it would substitute an option they did not choose.
	for (const text of ["1 of them", "option 1", "1.", "11", "0", "-1", "one"]) {
		assert.equal(resolveNumericAnswer(g, text), text, `must not rewrite ${text}`);
	}
	// Out of range falls through unchanged: answering the seventh of three is
	// not something this can invent.
	assert.equal(resolveNumericAnswer(g, "7"), "7");
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

test("one card cannot post two answers", () => {
	// The app shares ONE in-flight flag between the composer and these options
	// (`SessionPanel.admitting`), so the moment an answer starts every option
	// is disabled and a second press — or a typed send racing a click — has no
	// live control to land on.
	const answered = [];
	const live = buttonsOf(render({ onAnswer: (l) => answered.push(l) }));
	assert.deepEqual(
		live.map((b) => Boolean(b.props.disabled)),
		[false, false, false],
		"options are live before an answer is in flight",
	);
	live[0].props.onClick();
	assert.equal(answered.length, 1);

	const inFlight = buttonsOf(
		render({ busy: true, onAnswer: (l) => answered.push(l) }),
	);
	assert.deepEqual(
		inFlight.map((b) => Boolean(b.props.disabled)),
		[true, true, true],
		"every option is disabled while an answer is in flight",
	);
	// Still one answer: the browser dispatches no click on a disabled control.
	assert.equal(answered.length, 1);
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
	// The multi-question prefix survives, and the hint names the new
	// affordance while keeping the free-text path honest.
	assert.ok(markup.includes("Question 1 of 2."));
	assert.ok(markup.includes("Choose an option, or type your own answer below."));
	// The old dead list must be gone: no `<li>` carrying an option.
	assert.ok(
		!/<li[^>]*>[^<]*Popup is not open/.test(markup),
		"options must not render as inert list items",
	);
});
