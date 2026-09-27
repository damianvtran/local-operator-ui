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

	/* Refused: the same - the value stays where a retry can use it, and the
	   refusal sentence is the card's business, not this field's. */
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
