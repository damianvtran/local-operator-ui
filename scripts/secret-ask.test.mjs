import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE SECRET ASK'S DOCKED FIELD, driven through the SHIPPED component.
 *
 * Why this file exists rather than more cases in `ask-options.test.mjs`: that
 * file renders the dock to STRING markup, which cannot see a single thing this
 * feature's acceptance list turns on - that typing enables the send control,
 * that a submit reaches the shipped answer path with the typed value, that the
 * value CLEARS when the answer was sent (and only then), and that the next
 * question of a multi-question ask starts from an empty field. Those are React
 * state transitions, so they need a DOM, and the repo's established shape for
 * that is a focused jsdom file with the modules bundled in memory (see
 * `credential-composer.test.mjs`, whose world setup this borrows).
 *
 * WHAT THIS IS NOT: proof of layout, of a real browser's implicit form
 * submission, or of focus. jsdom has no layout engine and does not synthesise
 * the Enter key's default action the way a browser does, so the submit below
 * goes through the form's own seam (`requestSubmit`), which is the same handler
 * path with the browser's part held as a constant. The browser halves - a
 * masked field that paints dots, an implicit Enter submit - are QA's pass and
 * the driver's frames. What IS proven here is the React state machine: the
 * attributes on the field, what a submit hands the answer path, and exactly
 * when the value is forgotten.
 *
 * The world is built BEFORE the bundle is imported, because `zustand/persist`
 * and the theme layer read `localStorage`/`window` at module scope.
 */

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
const { window } = dom;
const originals = new Map();
/*
 * ONE matchMedia OBJECT PER QUERY, because a fresh object per call is what
 * hung `credential-composer.test.mjs`'s centring case: a `useSyncExternalStore`
 * snapshot that changes identity every read re-renders forever. Nothing the
 * dock mounts here reads a media query today; the cache is so the day one does,
 * this stub is not the defect.
 */
const mediaQueries = new Map();
const matchMediaStub = (query) => {
	if (!mediaQueries.has(query)) {
		mediaQueries.set(query, {
			matches: false,
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		});
	}
	return mediaQueries.get(query);
};
for (const [key, value] of Object.entries({
	window,
	document: window.document,
	localStorage: window.localStorage,
	sessionStorage: window.sessionStorage,
	HTMLElement: window.HTMLElement,
	HTMLInputElement: window.HTMLInputElement,
	HTMLButtonElement: window.HTMLButtonElement,
	HTMLFormElement: window.HTMLFormElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	KeyboardEvent: window.KeyboardEvent,
	InputEvent: window.InputEvent,
	MouseEvent: window.MouseEvent,
	getComputedStyle: window.getComputedStyle.bind(window),
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (callback) => setTimeout(() => callback(0), 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	matchMedia: matchMediaStub,
})) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
/*
 * jsdom has no canvas, and a store in this bundle's import graph measures a
 * console cell at module load - jsdom answers the call with a loud "Not
 * implemented: HTMLCanvasElement.prototype.getContext" on stderr, which is not
 * this file's subject and reads like a failure in a green run. A null context
 * is what that caller's own guard already handles (it falls back to a
 * constant), so the stub only silences the noise.
 */
window.HTMLCanvasElement.prototype.getContext = () => null;

const bundle = await build({
	stdin: {
		contents: [
			'export { QuestionDock } from "./src/renderer/src/features/chat/components/trace/question-dock";',
			'export { answerGateSecret, createSendLock } from "./src/renderer/src/features/chat/ask-answer";',
			'export { desktopRequestSchema } from "./src/shared/desktop-contract";',
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
	// imports - two copies would give the component a different dispatcher than
	// the renderer this test drives.
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});

// Written to a real file rather than imported as a `data:` URL: React DOM's
// client build resolves its own CJS entry at import time, and a `data:` URL has
// no base path to resolve it from (the same trap `ask-options.test.mjs`
// records).
const bundlePath = new URL(`./_secret-ask-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;
const { QuestionDock, answerGateSecret, createSendLock, desktopRequestSchema } =
	await import(bundlePath.href);
// Unlinked as soon as the graph is evaluated, so no build artifact survives a
// crash mid-run and none can be committed by accident.
await unlink(bundlePath);

const document = window.document;

/** Flush the microtask queue the way the other jsdom rigs in this tree do. */
const settle = async () => {
	await act(async () => {
		await Promise.resolve();
	});
};

const SECRET_GATE = {
	request_id: "11111111-1111-4111-8111-111111111111",
	kind: "ask",
	title: "Paste the GitHub token",
	detail: "",
	options: [],
	secret: true,
	question_index: 0,
	question_total: 1,
};

/** A secret gate with overrides. */
const secretGate = (over = {}) => ({ ...SECRET_GATE, ...over });

/** The input inside the docked field, as the browser would find it. */
const fieldOf = () => document.querySelector("[data-ask-secret] input");

/** The Send control inside the docked field. */
const sendOf = () =>
	document.querySelector('[data-ask-secret] button[type="submit"]');

/** Type into the field the way a browser does: the native setter, then `input`. */
const type = async (value) => {
	const field = fieldOf();
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setter.call(field, value);
		field.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	await settle();
};

/** Submit the form the way the Send control does. */
const submit = async () => {
	const form = fieldOf().closest("form");
	await act(async () => {
		form.requestSubmit();
	});
	await settle();
};

/*
 * ONE ROOT FOR THE FILE, rendered and re-rendered like the app's own pane: the
 * dock persists across a gate advancing to its next question (the pane does not
 * remount it), which is exactly the case the per-question keying has to handle.
 */
let root;
const render = async ({ gate = secretGate(), ...props } = {}) => {
	root ??= createRoot(document.getElementById("root"));
	await act(async () => {
		root.render(h(QuestionDock, { gate, ...props }));
	});
	await settle();
};

after(async () => {
	await act(async () => {
		root?.unmount();
	});
	for (const [key, descriptor] of originals) {
		if (descriptor === undefined) delete globalThis[key];
		else Object.defineProperty(globalThis, key, descriptor);
	}
});

test("the docked field refuses the empty value, takes a typed one, and hands it to the shipped answer path", async () => {
	const wire = [];
	const lock = createSendLock();
	await render({
		gate: secretGate(),
		onAnswer: () => {},
		/*
		 * THE SHIPPED CHAIN, not a recorder: `SecretAnswer` -> `answerGateSecret`
		 * with a recording transport is what the pane wires when its send lock is
		 * free, so the body asserted below is the body this feature emits.
		 */
		onAnswerSecret: (value) =>
			void answerGateSecret(
				{
					gate: secretGate(),
					sessionId: "a1b2c3d4e5f6",
					epoch: "epoch-7",
					value,
					lock,
				},
				async (request) => void wire.push(request),
			),
	});
	const field = fieldOf();
	assert.ok(field, "the masked field mounts");
	assert.equal(field.type, "password", "masked on screen");
	assert.equal(field.autocomplete, "off", "no autocomplete");
	assert.equal(field.getAttribute("autocapitalize"), "none");
	assert.equal(field.getAttribute("autocorrect"), "off");
	assert.equal(field.getAttribute("spellcheck"), "false");
	assert.equal(field.placeholder, "Paste the secret");
	assert.equal(sendOf().disabled, true, "Send refuses the empty field");

	/* One typed character is enough to enable the control... */
	await type("g");
	assert.equal(sendOf().disabled, false, "a non-empty field sends");
	/* ...and the submit carries the typed value through the answer path, where
	   the trim that reaches the wire lives (the field hands over the raw value,
	   `answerGateSecret` trims - asserted module-level in `ask-options.test.mjs`
	   and here on the real chain). */
	await type("  ghp_not_a_real_token  ");
	await submit();
	assert.equal(wire.length, 1, "one submit is one request on the wire");
	const parsed = desktopRequestSchema.parse(wire[0]);
	assert.equal(parsed.op, "sessions.answer");
	assert.equal(parsed.value, "ghp_not_a_real_token", "trimmed on the way out");
	assert.equal(
		parsed.requestId,
		"11111111-1111-4111-8111-111111111111",
		"the gate's request id travels",
	);
	assert.equal(parsed.questionIndex, 0, "and the question's own index");
});

test("the value clears when the answer was SENT - and is kept while in flight, and after a refusal", async () => {
	const gate = secretGate();
	const answered = [];
	const props = () => ({
		gate,
		onAnswer: () => {},
		onAnswerSecret: (v) => answered.push(v),
	});
	await render(props());
	await type("ghp_not_a_real_token");

	/* In flight: the field refuses input and KEEPS the value, so a user can see
	   what they handed over and a failed send never eats the token. */
	await render({
		...props(),
		answering: true,
		answer: { sending: true, refused: null },
	});
	assert.equal(
		fieldOf().value,
		"ghp_not_a_real_token",
		"in flight, the value stays",
	);
	assert.equal(
		fieldOf().disabled,
		true,
		"and the field refuses edits mid-flight",
	);

	/* Refused: the same - the value stays with the card, which is the surface that
	   owns it now. WHICH refusal releases it is `retryable`'s business (the next
	   test): this fixture carries no classification, so it reads as HELD, and the
	   value is kept either way - clearing is only ever the SENT outcome's. */
	await render({
		...props(),
		answer: {
			sending: false,
			refused: "Your answer was not sent. The request could not be completed.",
		},
	});
	assert.equal(
		fieldOf().value,
		"ghp_not_a_real_token",
		"a refusal keeps the value",
	);

	/* Sent: now it clears - the ONE moment the field may forget it. */
	await render({ ...props(), answer: { sending: false, refused: null } });
	assert.equal(fieldOf().value, "", "a sent answer clears the field");
	assert.equal(sendOf().disabled, true, "and the empty field refuses again");
});

test("a definite refusal RELEASES the field for a retry; an unknowable outcome holds it", async () => {
	/*
	 * THE SPLIT THE ROUND-1 REVIEWS ASKED FOR (design D1; UX U1; QA Q-1). A refusal
	 * used to leave the field disabled with the value kept and no path back: the
	 * composer refuses input while a secret question waits, so the kept value was
	 * unreachable. `answerReport`'s `retryable` now says which arm a failure is -
	 * and the arms deserve opposite handlers:
	 *
	 * - DEFINITE (established not-sent; the same question is still live): the
	 *   field is RELEASED, so the kept value can be sent again;
	 * - UNKNOWABLE (the answer may have landed): the hold stays, because a retry
	 *   could send it twice, and the hint swaps to a sentence that names no dead
	 *   control.
	 */
	const gate = secretGate();
	const answered = [];
	const props = () => ({
		gate,
		onAnswer: () => {},
		onAnswerSecret: (v) => answered.push(v),
	});
	await render(props());
	await type("ghp_not_a_real_token");

	/* UNKNOWABLE: the hold stays. */
	await render({
		...props(),
		answer: {
			sending: false,
			refused:
				"Whether your answer landed is not knowable. The request could not be completed.",
			retryable: false,
		},
	});
	assert.equal(
		fieldOf().value,
		"ghp_not_a_real_token",
		"the held field keeps the value",
	);
	assert.equal(fieldOf().disabled, true, "and refuses edits");
	assert.equal(sendOf().disabled, true, "and nothing can send");
	assert.match(
		document.body.textContent ?? "",
		/Held while this answer's fate is unknown/,
		"the hint carries the held sentence",
	);
	assert.doesNotMatch(
		document.body.textContent ?? "",
		/Enter sends/,
		"and not the key that cannot send",
	);

	/* DEFINITE: the field is RELEASED. */
	await render({
		...props(),
		answer: {
			sending: false,
			refused: "Your answer was not sent. The request could not be completed.",
			retryable: true,
		},
	});
	assert.equal(
		fieldOf().value,
		"ghp_not_a_real_token",
		"the released field keeps the value",
	);
	assert.equal(fieldOf().disabled, false, "and takes input again");
	assert.equal(sendOf().disabled, false, "so the kept value can be sent again");
	assert.doesNotMatch(
		document.body.textContent ?? "",
		/Held while this answer's fate is unknown/,
		"the held sentence is gone: every control it would warn about works",
	);

	/* The retry is the SAME door as the first attempt. */
	await submit();
	assert.deepEqual(
		answered,
		["ghp_not_a_real_token"],
		"a retry hands the kept value over",
	);
});

test("a refusal with NO classification keeps the hold (the conservative default)", async () => {
	/* The `answer` prop's `retryable` is optional with the HOLD as its default: a
	   caller that did not classify its refusal is not entitled to reopen a send. */
	await render({
		gate: secretGate(),
		onAnswer: () => {},
		onAnswerSecret: () => {},
		answer: {
			sending: false,
			refused: "Your answer was not sent. The request could not be completed.",
		},
	});
	assert.equal(fieldOf().disabled, true, "an unclassified refusal stays held");
	assert.match(
		document.body.textContent ?? "",
		/Held while this answer's fate is unknown/,
	);
});

test("Esc and Show keep the typed secret, and Show hands focus back to the field", async () => {
	/*
	 * UX ROUND 1, U3 AND U4. The draft used to live in `SecretAnswer`'s own state
	 * and the collapsed pill unmounts that component, so Esc silently discarded a
	 * typed secret and Show returned an empty field; and the expand effect queried
	 * option buttons only, so Show dropped focus to `document.body` on a card with
	 * no options. The draft is the dock's now (keyed per question), and the focus
	 * query includes the masked field.
	 */
	await render({
		gate: secretGate(),
		onAnswer: () => {},
		onAnswerSecret: () => {},
	});
	await type("ghp_not_a_real_token");

	const card = document.querySelector(
		'[data-lo-question-dock="expanded"] section',
	);
	assert.ok(card, "the expanded card is up");
	await act(async () => {
		card.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	await settle();
	assert.ok(
		document.querySelector('[data-lo-question-dock="collapsed"]'),
		"Esc hides the card",
	);
	assert.equal(
		document.querySelector("[data-ask-secret]"),
		null,
		"the field is unmounted while hidden - the draft cannot live in it",
	);

	const show = document.querySelector(
		'[aria-label="Show the agent\'s question"]',
	);
	assert.ok(show, "the pill's Show control is up");
	await act(async () => {
		show.click();
	});
	await settle();
	assert.equal(
		fieldOf().value,
		"ghp_not_a_real_token",
		"Show returns the typed value (UX round 1, U3)",
	);
	assert.equal(
		document.activeElement,
		fieldOf(),
		"and focus lands on the field, not the body (UX round 1, U4)",
	);
});

test("every consumer of the secret reading goes through the one predicate", () => {
	/*
	 * AGENT REVIEW ROUND 1, NIT-1: `secret` was read with THREE spellings - the
	 * composer closed on `=== true`, the dock and the page's send refusal read
	 * truthiness, and `answerGateSecret` refused anything but `=== true` - and for
	 * a contract-violating truthy value that mix left the dock painting a masked
	 * field while the composer stayed OPEN, the exposure this feature removes.
	 * Pinned at the source, comments stripped, the way the other source pins in
	 * this tree are: every consumer calls `gateIsSecret`, and no old spelling
	 * survives anywhere that matters.
	 */
	const strip = (text) =>
		text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
	const read = (path) => strip(readFileSync(path, "utf8"));
	const sources = {
		"ask-answer.ts": read("src/renderer/src/features/chat/ask-answer.ts"),
		"question-dock.tsx": read(
			"src/renderer/src/features/chat/components/trace/question-dock.tsx",
		),
		"chat-page.tsx": read(
			"src/renderer/src/features/chat/components/chat-page.tsx",
		),
		"chat-content.tsx": read(
			"src/renderer/src/features/chat/components/chat-content.tsx",
		),
	};
	assert.match(
		sources["ask-answer.ts"],
		/export const gateIsSecret =/,
		"the predicate lives in ask-answer.ts",
	);
	assert.match(
		sources["ask-answer.ts"],
		/!gateIsSecret\(gate\)/,
		"the answer door reads it",
	);
	assert.match(
		sources["question-dock.tsx"],
		/gateIsSecret\(gate\)/,
		"the dock reads it",
	);
	assert.match(
		sources["chat-page.tsx"],
		/gateIsSecret\(gate\)/,
		"the page's send refusal reads it",
	);
	assert.match(
		sources["chat-content.tsx"],
		/gateIsSecret\(/,
		"the composer's closure reads it",
	);
	for (const [name, source] of Object.entries(sources)) {
		assert.doesNotMatch(
			source,
			/gate\.secret\b/,
			`${name}: the bare gate.secret read is gone - one predicate, or none`,
		);
		assert.doesNotMatch(
			source,
			/secret (===|!==) true/,
			`${name}: the strict spelling is gone with it`,
		);
	}
});

test("the next question of the same ask starts from a fresh field", async () => {
	const answered = [];
	await render({
		gate: secretGate({ question_index: 0, question_total: 2 }),
		onAnswer: () => {},
		onAnswerSecret: (v) => answered.push(v),
	});
	await type("first-question-token");
	assert.equal(fieldOf().value, "first-question-token");

	/* The ask advances: same request, next question - exactly the state the
	   pane renders by re-rendering this dock with a new gate. */
	await render({
		gate: secretGate({ question_index: 1, question_total: 2 }),
		onAnswer: () => {},
		onAnswerSecret: (v) => answered.push(v),
	});
	assert.equal(
		fieldOf().value,
		"",
		"the next question's field is empty: the value cannot leak across questions",
	);
	await type("second-question-token");
	await submit();
	assert.deepEqual(answered, ["second-question-token"]);
});

test("a surface that cannot answer gets a disabled field, not a live one nothing can take", async () => {
	await render({ gate: secretGate(), onAnswer: () => {} });
	assert.equal(fieldOf().disabled, true, "no handler, no input");
	assert.equal(sendOf().disabled, true);
});

test("the field is built from the shared primitives whose contrast rows already assert it", () => {
	/*
	 * `AGENTS.md`: "Adding a component with its own fill and border means
	 * adding a row to `CONTROLS`". This field adds no new triple - it is the
	 * shared `Input` (`surface` fill, `border-control` edge, `ink`) and the
	 * shared `Button` (`primary`: accent fill, `on-accent` ink) - and `CONTROLS`
	 * asserts both over all four grounds, `elevated` (this card's) included. So
	 * the claim to pin is that the field is built FROM those primitives rather
	 * than from bespoke classes that would carry an unmeasured fill: read off
	 * the shipped source, comments stripped, the way the other source pins in
	 * this tree are.
	 */
	const strip = (text) =>
		text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
	const dock = strip(
		readFileSync(
			"src/renderer/src/features/chat/components/trace/question-dock.tsx",
			"utf8",
		),
	);
	assert.match(
		dock,
		/<Input[\s\S]{0,400}?type="password"/,
		"the field is the shared Input",
	);
	assert.match(
		dock,
		/<Button[^>]*type="submit"[^>]*variant="primary"/,
		"the send control is the shared Button",
	);
	const contrast = readFileSync("scripts/contrast-contract.mjs", "utf8");
	assert.match(
		contrast,
		/name: "input field",\s*\n\s*on: GROUNDS,/,
		"and the shared Input's row asserts over every ground this card sits on",
	);
});
