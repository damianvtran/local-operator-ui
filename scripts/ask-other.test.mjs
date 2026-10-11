import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE EXPLICIT `Other` ANSWER, driven through the shipped panel (the replacement for
 * the main composer answering the ask - design 5.0's R7, reversed on 2026-10-07).
 *
 * WHAT THIS PINS, and why each is a property a frame cannot prove:
 *
 *  1. THE ROW IS ALWAYS THERE, AND ONLY WHERE IT BELONGS: trailing in a single-select
 *     and a multi-select list, absent on a secret question (the masked field IS its
 *     free-form entry - a plain box beside it is the credential-in-an-ordinary-box
 *     failure), and absent on a free-text-only question (a row that reveals the only
 *     possible input is ceremony; the field is simply open).
 *  2. THE WRITE RULES, by value: single-select Other and the option rows exclude each
 *     other and the typed text survives a mis-click; multi-select Other is additive and
 *     goes LAST; a selected-but-EMPTY Other is not an answer and never reaches the wire
 *     as an empty string.
 *  3. THE FIELD KEEPS WHAT WAS TYPED. The first design derived the field's text from the
 *     draft cell, and that cannot work: the cell is trimmed (so a space typed between two
 *     words vanished on the keystroke) and a text equal to an option's label stops being
 *     "Other" in the cell (so typing `No` beside an option `No` emptied the field). The
 *     two regressions are asserted by name below.
 *  4. NOTHING TAKES FOCUS BY ITSELF. The field takes focus only on the user's own press
 *     on the Other row; a mount - including one over a pre-filled draft, and the
 *     auto-open the next change adds - leaves `document.activeElement` alone.
 *  5. ENTER FOLLOWS THE SHARED COMPOSER'S CONVENTION (Enter sends, Shift+Enter is a
 *     newline), scoped to the field so it cannot misroute, and Cmd/Ctrl+Enter is never a
 *     trap: it does what Enter does, as in the composer.
 *  6. NO CONTROL LIES ABOUT AN ATTACHMENT. This field is text-only in this change, so a
 *     pasted image/file is REFUSED IN WORDS (and a dragged file gets the pointer's own
 *     "no drop"), never swallowed; the draft is untouched.
 *  7. THE WIRE IS UNCHANGED: the answer body built from an Other draft has the same keys
 *     and value types as one built from an option press.
 *
 * WHAT IT DOES NOT CLAIM: layout or paint (the frame rig's, under
 * `docs/evidence/ask-other/`), or a real OS drag (a dispatched event carries no pointer).
 */

const bootstrap = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

const bundle = await build({
	stdin: {
		contents: `
			export { AskDrawer } from "./src/renderer/src/features/chat/components/asks/ask-drawer";
			/*
			 * A NAMESPACE re-export, not a named list: a named re-export of a helper that
			 * does not exist fails the whole bundle at build time, so the file would go red
			 * as ONE error on a tree without the feature. This way each test fails on its
			 * own assertion, which is what makes "red on the old tree, green on the new" a
			 * per-state statement.
			 */
			export * from "./src/renderer/src/features/chat/ask-queue";
			export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";
		`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	/*
	 * EVERYTHING IS BUNDLED EXCEPT THE REACT FAMILY. The drawer reads the shared
	 * store since round-1 Q1 (`askOpenIntent`), and the store reaches `base-theme`,
	 * which imports `@mui/material/styles` - a directory import that Node's ESM
	 * loader refuses when it is left external; `ask-open-render.test.mjs` carries
	 * this same list and its derivation. React stays external so the hooks inside
	 * the bundle and the `react-dom/client` this file mounts with are ONE copy.
	 */
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"react/jsx-dev-runtime",
	],
	/* A CJS module inside the bundle calls `require("react")`, which an ESM bundle
	 * cannot satisfy on its own; the banner lets it reach the same React. */
	banner: {
		js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
	},
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	define: { "import.meta.env": "{}" },
	write: false,
	logLevel: "silent",
});
const bundlePath = new URL(`./_ask-other-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	await unlink(bundlePath).catch(() => {});
}
const {
	AskDrawer,
	askAnswerMap,
	askAnswerRequest,
	askClaimsEscape,
	askQueueView,
	ASK_ANSWER_MAX_CHARS,
	askCellWith,
	askOtherSeed,
	askQuestionIsAnswered,
	askTicks,
	otherValuesOf,
	COMPOSER_TEXTAREA_SELECTOR,
	desktopRequestSchema,
	desktopEndpoint,
} = mod;

/*
 * The assertions' own regex literals, HOISTED to the top level: this tree's
 * `useTopLevelRegex` rule charges a literal built inside a function, and `scripts/`
 * sits outside `pnpm lint`'s path list, so `pnpm lint:scripts` is the only gate that
 * would say so.
 */
const RE_QUESTION_TEXT = /What changed\?/;
const RE_CANT_ATTACH = /can't be attached/i;
const RE_PRE_WRAP = /whitespace-pre-wrap/;
const RE_BREAK_WORDS = /break-words/;
const RE_WHITESPACE_RUN = /\s+/g;

/**
 * THE ONE SENTENCE the Other row's hint and both fields' placeholders say (round 1, D4):
 * three phrasings of one prompt was copy drift. The literal is stated HERE, not imported
 * from the component: a test that reads the component's own constant would pass for any
 * sentence, including a regression back to two.
 */
const OTHER_HINT = "Type your answer";

const h = React.createElement;

/*
 * NODE COMPARISONS GO THROUGH THESE TWO, NEVER `assert.equal(<node>, <node>)`.
 *
 * A FAILING `assert.equal` builds its message by inspecting both operands. MEASURED on
 * 2026-10-08: with the focus guard removed from the Other field's layout effect, the
 * first failing `assert.equal(document.activeElement, <field>)` exhausted a 2 GB heap and
 * aborted the test process (SIGABRT) instead of reporting a failure; a probe that did the
 * same comparison on a React-rendered tree (120 rows) died under a 512 MB cap, while the
 * same comparison on plain jsdom nodes passed through and failed normally, and the
 * boolean spelling below failed in under a millisecond on both. The React-owned
 * properties on the node (`__reactFiber$...`, `__reactProps$...`) are the difference
 * the probe found; that they are what inflates the inspection is the likely mechanism,
 * not something the probe isolated. The consequence is what matters: a regression these
 * tests exist to catch could crash the machine instead of being reported (a reviewer's
 * mutation run of the focus tests was killed twice by the host's memory guard).
 */
const is = (actual, expected, message) =>
	assert.ok(actual === expected, message);
const isnt = (actual, unexpected, message) =>
	assert.ok(actual !== unexpected, message);
/** A session id the wire's own pattern accepts (`/^[a-f0-9]{12}$/`). */
const SESSION = "0f9c1e2d3a4b";
const TS = 1_760_000_000_000;
const NOW = TS + 60_000;

const question = (over = {}) => ({
	id: "target",
	question: "Which environment?",
	options: [{ label: "staging" }, { label: "production" }],
	...over,
});
const ask = (questions, over = {}) => ({
	ask_id: "a-7f3c",
	created_at: TS,
	expires_at: TS + 3_600_000,
	timeout_s: 3600,
	urgent: false,
	status: "open",
	delivered: false,
	questions,
	...over,
});
const frontend = (asks) => ({
	asks,
	asks_open: asks.filter((row) => row.status === "open").length,
	asks_truncated: null,
});

/* -------------------------------------------------------- the rig's hosts ---- */

const mounted = [];
/**
 * A stateful host for the drawer: the page owns the draft map (`chat-page.tsx`), so a
 * test that passed a frozen `drafts` would assert nothing about what a keystroke does.
 */
const mountPanel = async ({
	asks,
	initialDrafts = {},
	onRevise,
	door = false,
}) => {
	const calls = { answer: [], revise: [] };
	const state = { drafts: initialDrafts };
	const Host = () => {
		const [drafts, setDrafts] = React.useState(initialDrafts);
		state.drafts = drafts;
		return h(AskDrawer, {
			frontend: frontend(asks),
			scope: "session",
			nowMs: NOW,
			onClose: () => undefined,
			drafts,
			onDraftChange: (id, next) => setDrafts((all) => ({ ...all, [id]: next })),
			onAnswer: (id, answers) => calls.answer.push({ id, answers }),
			onRevise:
				onRevise === false
					? undefined
					: (id, answers) => calls.revise.push({ id, answers }),
			onDecline: () => undefined,
		});
	};
	let chip = null;
	if (door) {
		chip = document.createElement("button");
		chip.setAttribute("data-lo-ask-item-toggle", "");
		document.body.appendChild(chip);
		chip.focus();
	}
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(h(Host));
	});
	const view = {
		container,
		calls,
		state,
		chip,
		async unmount() {
			await act(async () => root.unmount());
			container.remove();
			chip?.remove();
		},
	};
	mounted.push(view);
	return view;
};
test.afterEach(async () => {
	while (mounted.length > 0) await mounted.pop().unmount();
});

const q = (view, selector) => view.container.querySelector(selector);
const qa = (view, selector) => [...view.container.querySelectorAll(selector)];
const other = (view) => q(view, "[data-ask-option-other]");
const field = (view) => q(view, "textarea[data-ask-other]");
const sendButton = (view) =>
	qa(view, "button").find((b) => b.textContent.trim() === "Send answer");
const press = async (el) => {
	await act(async () => {
		el.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
};
const type = async (el, text) => {
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype,
			"value",
		).set;
		setter.call(el, text);
		el.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};
/**
 * TYPING THE WAY A BROWSER DOES IT: the characters go in at the CARET and the caret ends
 * after them. `type` above replaces the whole value, which is right for most states and
 * says nothing about WHERE a keystroke lands - the one thing the caret findings are about.
 */
const typeAtCaret = async (el, chars) => {
	await act(async () => {
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const setter = Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype,
			"value",
		).set;
		setter.call(el, el.value.slice(0, start) + chars + el.value.slice(end));
		el.setSelectionRange(start + chars.length, start + chars.length);
		el.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};
const key = async (el, name, init = {}) => {
	const event = new window.KeyboardEvent("keydown", {
		key: name,
		bubbles: true,
		cancelable: true,
		...init,
	});
	await act(async () => {
		el.dispatchEvent(event);
	});
	return event;
};
const draftOf = (view, id = "target") => view.state.drafts["a-7f3c"]?.[id];

/* ----------------------------------------------------------- the pure rules ---- */

const LABELS = ["staging", "production"];

/** An open Other entry holding `text`, and a closed one that still remembers it. */
const OPEN = (text) => ({ open: true, text });
const CLOSED = (text = "") => ({ open: false, text });

test("askCellWith: single-select Other is the trimmed text alone, and an empty one is no answer", () => {
	assert.deepEqual(askCellWith([], false, OPEN("prod")), ["prod"]);
	// Whatever was chosen before, an open Other replaces it: the two are exclusive.
	assert.deepEqual(askCellWith(["staging"], false, OPEN("prod")), ["prod"]);
	// Selected but EMPTY (or only whitespace): the cell HOLDS ITS PLACE with a blank
	// entry, and a blank entry is no answer (round 1, D1) - never a sendable string.
	assert.deepEqual(askCellWith([], false, OPEN("")), [""]);
	assert.deepEqual(askCellWith([], false, OPEN("  \n ")), [""]);
	assert.equal(
		askQuestionIsAnswered(question(), {
			target: askCellWith([], false, OPEN("")),
		}),
		false,
	);
	// The text is trimmed into the draft and nowhere else.
	assert.deepEqual(askCellWith([], false, OPEN("  prod \n")), ["prod"]);
	// A CLOSED Other contributes nothing, even though it remembers its text.
	assert.deepEqual(askCellWith([], false, CLOSED("prod-eu")), []);
});

test("askCellWith: multi-select Other is additive beside the ticks and goes LAST", () => {
	assert.deepEqual(askCellWith(["staging"], true, OPEN("canary")), [
		"staging",
		"canary",
	]);
	// Press order is kept: ticking `production` after `staging` does not reorder them.
	assert.deepEqual(
		askCellWith(["production", "staging"], true, OPEN("canary")),
		["production", "staging", "canary"],
	);
	// A CLOSED Other leaves the ticks to answer the question alone.
	assert.deepEqual(askCellWith(["staging"], true, CLOSED("canary")), [
		"staging",
	]);
	// An OPEN but empty Other holds its place after the ticks (round 1, D1): the question
	// is incomplete until text is typed or the row is unticked, so a selected control is
	// never silently dropped from the answer that goes out.
	assert.deepEqual(askCellWith(["staging"], true, OPEN("")), ["staging", ""]);
	assert.deepEqual(askCellWith([], true, OPEN("   ")), [""]);
	assert.equal(
		askQuestionIsAnswered(question({ multi: true }), {
			target: askCellWith(["staging"], true, OPEN("")),
		}),
		false,
		"ticks beside an empty open Other are NOT a complete answer",
	);
});

test("askTicks reads the option rows' selections OUT of the cell, the Other entry excluded", () => {
	assert.deepEqual(askTicks(["staging", "canary"], LABELS, OPEN("canary")), [
		"staging",
	]);
	assert.deepEqual(askTicks(["staging"], LABELS, CLOSED()), ["staging"]);
	assert.deepEqual(askTicks([], LABELS, OPEN("canary")), []);
});

test("REGRESSION (label collision): typing a sentence that starts with a label never ticks that option", () => {
	/*
	 * Options [No, Yes], multi-select, nothing ticked. The user opens Other and types
	 * `No, thanks` one character at a time. When the field holds exactly `No` the text
	 * EQUALS an option's label, and a design that read the cell back to find the ticks
	 * took that transient `No` for a tick of the option - so the final answer was
	 * `["No", "No, thanks"]`, an option the user never chose.
	 *
	 * The card keeps the Other entry as its own state and derives the ticks from the
	 * cell MINUS the entry that wrote it, so the collision resolves the same way at every
	 * step. This loop is the card's own data flow (`writeOther`): read the ticks with the
	 * CURRENT entry, then build the next cell from the NEXT one.
	 */
	const labels = ["No", "Yes"];
	const type = (cell, other, text) => {
		const ticks = askTicks(cell, labels, other);
		const next = OPEN(text);
		return { cell: askCellWith(ticks, true, next), other: next };
	};
	let state = { cell: [], other: CLOSED() };
	for (const text of ["N", "No", "No,", "No, ", "No, t", "No, thanks"]) {
		state = type(state.cell, state.other, text);
	}
	assert.deepEqual(
		state.cell,
		["No, thanks"],
		"the typed sentence is the whole answer",
	);
	assert.deepEqual(
		askTicks(state.cell, labels, state.other),
		[],
		"and `No` is NOT quietly ticked",
	);

	// The collision at its sharpest: the field holds exactly the label.
	state = type(["Yes"], CLOSED(), "No");
	assert.deepEqual(state.cell, ["Yes", "No"], "Other is last, as always");
	assert.deepEqual(
		askTicks(state.cell, labels, state.other),
		["Yes"],
		"the trailing `No` is Other's, not a tick of the option",
	);
	// ...and it keeps resolving that way while the user goes on typing.
	state = type(state.cell, state.other, "No!");
	assert.deepEqual(state.cell, ["Yes", "No!"]);

	// The user REALLY ticked `No` AND typed `No`: the cell keeps BOTH entries so that
	// removing either one removes the right one; the WIRE carries it once.
	const both = type(["No"], CLOSED(), "No");
	assert.deepEqual(both.cell, ["No", "No"]);
	assert.deepEqual(
		askTicks(both.cell, labels, both.other),
		["No"],
		"the earlier entry is the tick",
	);
	const yesNo = [{ label: "No" }, { label: "Yes" }];
	assert.deepEqual(
		askAnswerMap(ask([question({ multi: true, options: yesNo })]), {
			target: both.cell,
		}),
		{ target: ["No"] },
		"deduplicated at the wire",
	);
	// Unticking Other removes Other's entry and leaves the real tick.
	assert.deepEqual(
		askCellWith(askTicks(both.cell, labels, both.other), true, CLOSED("No")),
		["No"],
	);
	// Unticking the option leaves Other's entry.
	assert.deepEqual(
		askCellWith(
			askTicks(both.cell, labels, both.other).filter((l) => l !== "No"),
			true,
			both.other,
		),
		["No"],
	);

	// A REAL tick plus a typed sentence that merely starts with it: both are answers.
	const sentence = type(["No"], CLOSED(), "No, thanks");
	assert.deepEqual(sentence.cell, ["No", "No, thanks"]);
	assert.deepEqual(askTicks(sentence.cell, labels, sentence.other), ["No"]);
});

test("askOtherSeed: a draft that holds out-of-list text opens Other with it; a label seeds as that option", () => {
	assert.deepEqual(askOtherSeed(["prod"], LABELS), {
		open: true,
		text: "prod",
	});
	assert.deepEqual(askOtherSeed(["staging"], LABELS), {
		open: false,
		text: "",
	});
	assert.deepEqual(askOtherSeed([], LABELS), { open: false, text: "" });
	assert.deepEqual(askOtherSeed([" "], LABELS), { open: false, text: "" });
	// The blank entry an open-but-empty Other writes seeds it OPEN again (round 1, D1):
	// a card that restored the cell without it would show Other unticked beside a Send
	// button that is disabled for a reason nothing on the card states.
	assert.deepEqual(askOtherSeed([""], LABELS), { open: true, text: "" });
	assert.deepEqual(askOtherSeed(["staging", ""], LABELS), {
		open: true,
		text: "",
	});
	// Several out-of-list values (a recorded answer from another surface) are all shown.
	assert.deepEqual(askOtherSeed(["a", "staging", "b"], LABELS), {
		open: true,
		text: "a\nb",
	});
});

test("askQuestionIsAnswered is the one rule the submit gate and Enter both read", () => {
	const plain = question();
	assert.equal(askQuestionIsAnswered(plain, {}), false);
	assert.equal(askQuestionIsAnswered(plain, { target: [] }), false);
	assert.equal(askQuestionIsAnswered(plain, { target: ["  "] }), false);
	assert.equal(askQuestionIsAnswered(plain, { target: ["staging"] }), true);
	// A blank ENTRY is an Other that is selected but empty: it holds the question open
	// even when other entries would answer it (round 1, D1).
	assert.equal(askQuestionIsAnswered(plain, { target: [""] }), false);
	assert.equal(
		askQuestionIsAnswered(plain, { target: ["staging", ""] }),
		false,
	);
	assert.equal(
		askQuestionIsAnswered(plain, { target: ["staging", "canary"] }),
		true,
	);
	const secret = question({ id: "key", options: undefined, secret: true });
	assert.equal(askQuestionIsAnswered(secret, {}, {}), false);
	assert.equal(askQuestionIsAnswered(secret, {}, { key: "x" }), true);
});

test("the answer cap the field enforces is the wire's own", () => {
	assert.equal(ASK_ANSWER_MAX_CHARS, 32768);
	const pending = ask([question({ options: undefined })]);
	const at = (n) =>
		desktopRequestSchema.safeParse(
			askAnswerRequest(pending, { target: ["x".repeat(n)] }, SESSION),
		).success;
	assert.equal(at(ASK_ANSWER_MAX_CHARS), true, "the cap itself is accepted");
	assert.equal(
		at(ASK_ANSWER_MAX_CHARS + 1),
		false,
		"one past it is refused by the schema",
	);
});

test("otherValuesOf: what the list did not offer, minus blanks", () => {
	assert.deepEqual(otherValuesOf(["staging", "prod", " "], LABELS), ["prod"]);
	assert.deepEqual(otherValuesOf([], LABELS), []);
	// With no options at all every value is the question's own free text.
	assert.deepEqual(otherValuesOf(["hello"], []), ["hello"]);
});

/* ---------------------------------------------------------- where it appears ---- */

test("single-select: Other is the LAST row of the radiogroup, labelled and hinted", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	const row = other(view);
	assert.ok(row, "the always-present Other row");
	assert.equal(row.getAttribute("role"), "radio");
	assert.equal(row.getAttribute("aria-checked"), "false");
	assert.ok(row.textContent.includes("Other"));
	assert.ok(
		row.textContent.includes(OTHER_HINT),
		"a first-time user is told what the row is for",
	);
	/*
	 * ONE REAL SPACE between the label and the hint (round 2, design D8 / UX U6):
	 * with only the `ml-1.5` margin between the two spans, the accessible-name
	 * computation concatenates them into one announced word - Chrome's AX tree
	 * read `OtherType your answer`. The space is what puts the boundary in the
	 * name, and `textContent` is where this host can see it.
	 */
	assert.equal(
		row.textContent.replace(/\s+/g, " ").trim(),
		`Other ${OTHER_HINT}`,
		"the announced name is two words, not one",
	);
	const group = row.closest('[role="radiogroup"]');
	assert.ok(group, "it is a member of the same radiogroup as the options");
	const rows = [...group.children];
	is(rows.at(-1), row, "trailing, after every option row");
	assert.equal(rows.length, 3, "two options and Other");
	is(field(view), null, "no field until Other is chosen");
});

test("multi-select: Other is the LAST checkbox of the group", async () => {
	const view = await mountPanel({
		asks: [ask([question({ multi: true })])],
	});
	const row = other(view);
	assert.ok(row);
	assert.equal(row.getAttribute("role"), "checkbox");
	assert.equal(row.getAttribute("aria-pressed"), "false");
	const group = row.closest('[role="group"]');
	is([...group.children].at(-1), row);
});

test("free-text-only: no Other row, the multi-line field is simply open and named", async () => {
	const view = await mountPanel({
		asks: [ask([question({ options: undefined, question: "What changed?" })])],
	});
	is(other(view), null, "a row that reveals the only input is ceremony");
	const box = field(view);
	assert.ok(box, "the field is open");
	assert.equal(
		box.tagName,
		"TEXTAREA",
		"multi-line, not the old single-line input",
	);
	is(q(view, 'input[type="text"]'), null, "the bare single-line input is gone");
	assert.match(box.getAttribute("aria-label"), RE_QUESTION_TEXT);
	assert.notEqual(box.getAttribute("aria-label"), "Message");
	assert.equal(
		box.matches(COMPOSER_TEXTAREA_SELECTOR),
		false,
		"it is never mistaken for the page's composer",
	);
	assert.ok(box.getAttribute("placeholder"), "and says where to type");
});

test("secret: the masked field stays, and there is NO Other row and NO plain box", async () => {
	const view = await mountPanel({
		asks: [ask([question({ options: undefined, secret: true })])],
	});
	assert.ok(q(view, "input[data-ask-secret]"), "the masked field is the entry");
	assert.equal(
		q(view, "input[data-ask-secret]").getAttribute("type"),
		"password",
	);
	is(other(view), null);
	is(
		field(view),
		null,
		"a plain text box beside a credential's field is the failure this avoids",
	);
});

test("a mixed ask draws each question's own shape", async () => {
	const view = await mountPanel({
		asks: [
			ask([
				question({ id: "env" }),
				question({
					id: "key",
					options: undefined,
					secret: true,
					question: "Key?",
				}),
				question({
					id: "note",
					options: undefined,
					question: "Anything else?",
				}),
			]),
		],
	});
	assert.equal(
		qa(view, "[data-ask-option-other]").length,
		1,
		"one Other, on the list",
	);
	assert.equal(qa(view, "input[data-ask-secret]").length, 1);
	assert.equal(
		qa(view, "textarea[data-ask-other]").length,
		1,
		"the free-text field",
	);
});

/* ----------------------------------------------------------- the write rules ---- */

test("single-select: choosing Other reveals the field, focuses it on the press, and an empty one is not an answer", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	assert.equal(
		document.activeElement === document.body,
		true,
		"nothing took focus",
	);
	await press(other(view));
	const box = field(view);
	assert.ok(box, "the field is revealed inside the card");
	is(
		document.activeElement,
		box,
		"the user's own press moves focus into the field it opened",
	);
	assert.equal(other(view).getAttribute("aria-checked"), "true");
	assert.equal(
		askQuestionIsAnswered(question(), { target: draftOf(view) ?? [] }),
		false,
		"nothing answered yet",
	);
	assert.equal(
		sendButton(view).disabled,
		true,
		"selected-but-empty is not an answer",
	);
	await type(box, "   ");
	assert.equal(
		sendButton(view).disabled,
		true,
		"whitespace is not an answer either",
	);
	assert.equal(
		askQuestionIsAnswered(question(), { target: draftOf(view) ?? [] }),
		false,
	);
});

test("single-select: typed text becomes the whole answer, and Send posts exactly that map", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	await press(other(view));
	await type(field(view), "prod");
	assert.deepEqual(draftOf(view), ["prod"]);
	assert.equal(sendButton(view).disabled, false);
	await press(sendButton(view));
	assert.deepEqual(view.calls.answer, [
		{ id: "a-7f3c", answers: { target: ["prod"] } },
	]);
});

test("single-select: choosing an option deselects Other but KEEPS what was typed (a mis-click is not destructive)", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	await press(other(view));
	await type(field(view), "prod-eu");
	await press(q(view, '[data-ask-option="staging"]'));
	assert.deepEqual(draftOf(view), ["staging"], "the option is the answer");
	assert.equal(
		other(view).getAttribute("aria-checked"),
		"false",
		"Other deselected",
	);
	assert.equal(
		q(view, '[data-ask-option="staging"]').getAttribute("aria-checked"),
		"true",
	);
	is(field(view), null, "the field folds away");
	await press(other(view));
	assert.equal(field(view).value, "prod-eu", "the text is still there");
	assert.deepEqual(
		draftOf(view),
		["prod-eu"],
		"and the answer follows it back",
	);
	assert.equal(
		q(view, '[data-ask-option="staging"]').getAttribute("aria-checked"),
		"false",
		"the two are exclusive",
	);
});

test("single-select: pressing Other over a chosen option clears the option until something is typed", async () => {
	const view = await mountPanel({
		asks: [ask([question()])],
		initialDrafts: { "a-7f3c": { target: ["staging"] } },
	});
	assert.equal(sendButton(view).disabled, false, "answered by the option");
	await press(other(view));
	assert.equal(
		askQuestionIsAnswered(question(), { target: draftOf(view) ?? [] }),
		false,
		"the option no longer counts",
	);
	assert.equal(sendButton(view).disabled, true);
});

test("REGRESSION: a space typed between words stays in the field (the cell is trimmed, the field is not)", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	await press(other(view));
	const box = field(view);
	await type(box, "not");
	await type(box, "not ");
	assert.equal(box.value, "not ", "the trailing space survives the keystroke");
	await type(box, "not yet");
	assert.equal(field(view).value, "not yet");
	assert.deepEqual(draftOf(view), ["not yet"]);
});

test("REGRESSION: text equal to an option's label keeps the field open and filled", async () => {
	const view = await mountPanel({
		asks: [ask([question({ options: [{ label: "No" }, { label: "Yes" }] })])],
	});
	await press(other(view));
	await type(field(view), "No");
	assert.ok(
		field(view),
		"the field did not unmount because the cell now equals a label",
	);
	assert.equal(field(view).value, "No");
	assert.equal(other(view).getAttribute("aria-checked"), "true");
	assert.equal(
		q(view, '[data-ask-option="No"]').getAttribute("aria-checked"),
		"false",
		"exclusive: the option row is not ALSO shown chosen",
	);
	await type(field(view), "No, because");
	assert.equal(field(view).value, "No, because");
});

test("REGRESSION (label collision, multi-select): typing `No, thanks` through the real card never ticks `No`", async () => {
	const view = await mountPanel({
		asks: [
			ask([
				question({
					multi: true,
					options: [{ label: "No" }, { label: "Yes" }],
				}),
			]),
		],
	});
	await press(other(view));
	let typed = "";
	for (const ch of "No, thanks") {
		typed += ch;
		await type(field(view), typed);
		if (typed === "No") {
			assert.equal(
				q(view, '[data-ask-option="No"]').getAttribute("aria-pressed"),
				"false",
				"at the moment the text EQUALS the label, the option is not ticked",
			);
		}
	}
	assert.equal(field(view).value, "No, thanks");
	assert.deepEqual(
		draftOf(view),
		["No, thanks"],
		"the sentence is the whole cell",
	);
	assert.equal(
		q(view, '[data-ask-option="No"]').getAttribute("aria-pressed"),
		"false",
		"the option row never gained a tick",
	);
	await press(sendButton(view));
	assert.deepEqual(view.calls.answer, [
		{ id: "a-7f3c", answers: { target: ["No, thanks"] } },
	]);
});

test("a REAL tick beside a typed sentence that starts with it: both answer, and either can be removed", async () => {
	const view = await mountPanel({
		asks: [
			ask([
				question({
					multi: true,
					options: [{ label: "No" }, { label: "Yes" }],
				}),
			]),
		],
	});
	await press(q(view, '[data-ask-option="No"]'));
	await press(other(view));
	await type(field(view), "No, thanks");
	assert.deepEqual(draftOf(view), ["No", "No, thanks"]);
	assert.equal(
		q(view, '[data-ask-option="No"]').getAttribute("aria-pressed"),
		"true",
	);
	// Make the text exactly the label too: the cell keeps both, the wire carries one.
	await type(field(view), "No");
	assert.deepEqual(draftOf(view), ["No", "No"]);
	await press(sendButton(view));
	assert.deepEqual(view.calls.answer, [
		{ id: "a-7f3c", answers: { target: ["No"] } },
	]);
	// Untick the OPTION: Other's entry stays; untick OTHER: the option's tick stays.
	await press(q(view, '[data-ask-option="No"]'));
	assert.deepEqual(draftOf(view), ["No"]);
	assert.equal(
		q(view, '[data-ask-option="No"]').getAttribute("aria-pressed"),
		"false",
	);
	assert.equal(other(view).getAttribute("aria-pressed"), "true");
	await press(q(view, '[data-ask-option="No"]'));
	assert.deepEqual(draftOf(view), ["No", "No"]);
	await press(other(view));
	assert.deepEqual(draftOf(view), ["No"]);
	assert.equal(
		q(view, '[data-ask-option="No"]').getAttribute("aria-pressed"),
		"true",
	);
});

test("multi-select: Other is additive beside ticks and last; selected but empty it HOLDS THE QUESTION OPEN (D1)", async () => {
	const view = await mountPanel({ asks: [ask([question({ multi: true })])] });
	await press(q(view, '[data-ask-option="staging"]'));
	assert.deepEqual(draftOf(view), ["staging"]);
	assert.equal(sendButton(view).disabled, false, "complete on its tick");
	await press(other(view));
	assert.equal(other(view).getAttribute("aria-pressed"), "true");
	is(document.activeElement, field(view), "focus follows the press");
	// THE FINDING: a ticked Other with an empty field used to leave Send ENABLED on the
	// other ticks, so the control the user had just selected was silently dropped from
	// the answer. It is incomplete now, and Send says so by being disabled.
	assert.equal(
		sendButton(view).disabled,
		true,
		"a selected-but-empty Other is not dropped: the question is incomplete",
	);
	assert.equal(
		askAnswerMap(ask([question({ multi: true })]), view.state.drafts["a-7f3c"]),
		null,
		"and no map can be built from it",
	);
	// Another tick does not clear it: the empty Other is still selected.
	await press(q(view, '[data-ask-option="production"]'));
	assert.equal(sendButton(view).disabled, true);
	await press(q(view, '[data-ask-option="production"]'));
	await type(field(view), "canary");
	assert.equal(sendButton(view).disabled, false, "text completes it");
	assert.deepEqual(draftOf(view), ["staging", "canary"]);
	// A tick AFTER the text still leaves Other last.
	await press(q(view, '[data-ask-option="production"]'));
	assert.deepEqual(draftOf(view), ["staging", "production", "canary"]);
	// Unticking Other drops it from the answer but keeps the text for the next tick.
	await press(other(view));
	assert.deepEqual(draftOf(view), ["staging", "production"]);
	is(field(view), null);
	await press(other(view));
	assert.equal(field(view).value, "canary");
	assert.deepEqual(draftOf(view), ["staging", "production", "canary"]);
	// Erasing the text of a TICKED Other takes the question back to incomplete (D1)...
	await type(field(view), "");
	assert.equal(sendButton(view).disabled, true, "erased: incomplete again");
	// ...and UNTICKING it is the way to send the ticks alone.
	await press(other(view));
	assert.equal(
		sendButton(view).disabled,
		false,
		"unticked: the ticks answer it",
	);
	assert.deepEqual(draftOf(view), ["staging", "production"]);
});

test("multi-select: an Other that is the ONLY selection and is empty is not an answer", async () => {
	const view = await mountPanel({ asks: [ask([question({ multi: true })])] });
	await press(other(view));
	assert.equal(sendButton(view).disabled, true);
	await type(field(view), "x");
	assert.equal(sendButton(view).disabled, false);
	await type(field(view), "");
	assert.equal(
		sendButton(view).disabled,
		true,
		"erasing it takes the answer back",
	);
});

test("free-text-only: typing writes the cell, keeps a typed space, and never sends an empty string", async () => {
	const view = await mountPanel({
		asks: [ask([question({ options: undefined, id: "note" })])],
	});
	const box = field(view);
	await type(box, "hello ");
	assert.equal(field(view).value, "hello ", "the space survives");
	assert.deepEqual(draftOf(view, "note"), ["hello"]);
	await type(field(view), "  ");
	assert.equal(
		askQuestionIsAnswered(question({ options: undefined, id: "note" }), {
			note: draftOf(view, "note") ?? [],
		}),
		false,
		"whitespace is not an answer",
	);
	assert.equal(sendButton(view).disabled, true);
	assert.equal(
		askAnswerMap(ask([question({ options: undefined, id: "note" })]), {
			note: draftOf(view, "note") ?? [],
		}),
		null,
		"and no map - so no empty string - can be built from it",
	);
});

test("a pre-filled draft mounts the Other field EXPANDED and UNFOCUSED, with its text", async () => {
	const view = await mountPanel({
		asks: [ask([question()])],
		initialDrafts: { "a-7f3c": { target: ["prod"] } },
	});
	assert.ok(field(view), "expanded");
	assert.equal(field(view).value, "prod");
	assert.equal(other(view).getAttribute("aria-checked"), "true");
	assert.equal(
		q(view, '[data-ask-option="production"]').getAttribute("aria-checked"),
		"false",
		"the option rows are not selected: the value came from the Other field",
	);
	is(document.activeElement, document.body, "focus was NOT taken");
});

/* ------------------------------------------------------------------- focus ---- */

test("F1: no mount, door landing or re-render moves focus into a field the user did not press", async () => {
	// A free-text-only ask with NO door focused: the mount leaves focus alone.
	const view = await mountPanel({
		asks: [ask([question({ options: undefined, id: "note" })])],
	});
	is(document.activeElement, document.body);
	await act(async () => {});
	is(document.activeElement, document.body, "and a settled re-render too");
	await view.unmount();
	mounted.pop();
	// A pre-filled Other behind a door: the door's landing is the first OPTION (#864's
	// rule, unchanged), never the field below it.
	const door = await mountPanel({
		asks: [ask([question()])],
		initialDrafts: { "a-7f3c": { target: ["prod"] } },
		door: true,
	});
	assert.equal(
		document.activeElement?.getAttribute("data-ask-option"),
		"staging",
		"the door landing is unchanged and does not reach the Other field",
	);
	isnt(document.activeElement, field(door));
});

test("F1: pressing Other when it is already open focuses the field again (the user's own press)", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	await press(other(view));
	document.activeElement.blur();
	is(document.activeElement, document.body);
	await press(other(view));
	is(document.activeElement, field(view));
	assert.equal(
		other(view).getAttribute("aria-checked"),
		"true",
		"a radio does not toggle off",
	);
});

/* --------------------------------------- round 1: caret, pending Other, copy ---- */

test("U1: pressing Other again after an option puts the caret at the END of the restored text, so typing continues it", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	await press(other(view));
	await type(field(view), "eu-central");
	await press(q(view, '[data-ask-option="staging"]'));
	await press(other(view));
	const box = field(view);
	is(document.activeElement, box, "the user's press focused the field");
	assert.equal(box.value, "eu-central", "the text came back");
	// THE FINDING: the caret landed at 0 in the restored text, so the next keystrokes
	// PREPENDED to it (`NoNo, thanks` was sent as typed).
	assert.equal(box.selectionStart, box.value.length, "caret at the end");
	assert.equal(box.selectionEnd, box.value.length, "nothing selected");
	await typeAtCaret(box, " (canary)");
	assert.equal(field(view).value, "eu-central (canary)");
	assert.deepEqual(draftOf(view), ["eu-central (canary)"]);
});

test("U1: the same in a multi-select - unticking and re-ticking Other restores the text with the caret after it", async () => {
	const view = await mountPanel({ asks: [ask([question({ multi: true })])] });
	await press(other(view));
	await type(field(view), "canary");
	await press(other(view));
	is(field(view), null, "unticked: the field folds away");
	await press(other(view));
	const box = field(view);
	is(document.activeElement, box);
	assert.equal(box.selectionStart, box.value.length);
	await typeAtCaret(box, " 5%");
	assert.equal(field(view).value, "canary 5%");
});

test("U1: pressing an Other that is ALREADY open re-focuses the field with the caret at the end, even one mounted unfocused over a draft", async () => {
	const view = await mountPanel({
		asks: [ask([question()])],
		initialDrafts: { "a-7f3c": { target: ["prod"] } },
	});
	is(document.activeElement, document.body, "mounted unfocused (F1)");
	await press(other(view));
	const box = field(view);
	is(document.activeElement, box, "the user's own press focuses it");
	assert.equal(
		box.selectionStart,
		"prod".length,
		"after the text, not before it",
	);
	await typeAtCaret(box, "-eu");
	assert.equal(field(view).value, "prod-eu");
});

test("D1: an Other that is selected but EMPTY is not dropped from a multi-select answer - Enter in its field sends nothing either", async () => {
	const view = await mountPanel({ asks: [ask([question({ multi: true })])] });
	await press(q(view, '[data-ask-option="staging"]'));
	await press(other(view));
	assert.equal(
		sendButton(view).disabled,
		true,
		"Send is disabled, not silently lossy",
	);
	await key(field(view), "Enter");
	assert.equal(
		view.calls.answer.length,
		0,
		"Enter reads the same rule as the button",
	);
	// Typing completes it; erasing it takes it back; unticking is the way to send the ticks.
	await type(field(view), "canary");
	assert.equal(sendButton(view).disabled, false);
	await type(field(view), " ");
	assert.equal(
		sendButton(view).disabled,
		true,
		"whitespace is still no answer",
	);
	await press(other(view));
	assert.equal(
		sendButton(view).disabled,
		false,
		"unticked: the ticks answer it",
	);
	await press(sendButton(view));
	assert.deepEqual(view.calls.answer, [
		{ id: "a-7f3c", answers: { target: ["staging"] } },
	]);
});

test("D1: an open-but-empty Other SURVIVES a drawer close and reopen - open, empty, unfocused, Send still disabled", async () => {
	const questions = [question({ multi: true })];
	const first = await mountPanel({ asks: [ask(questions)] });
	await press(q(first, '[data-ask-option="staging"]'));
	await press(other(first));
	const kept = first.state.drafts;
	await first.unmount();
	mounted.pop();
	const second = await mountPanel({
		asks: [ask(questions)],
		initialDrafts: kept,
	});
	assert.ok(field(second), "the Other field is open again");
	assert.equal(field(second).value, "");
	assert.equal(other(second).getAttribute("aria-pressed"), "true");
	assert.equal(
		q(second, '[data-ask-option="staging"]').getAttribute("aria-pressed"),
		"true",
		"and the tick is kept",
	);
	assert.equal(
		sendButton(second).disabled,
		true,
		"the gate and the card agree",
	);
	is(
		document.activeElement,
		document.body,
		"restored without taking focus (F1)",
	);
});

test("D1: the change form holds an emptied Other open too, so Update answer cannot silently drop it", async () => {
	const view = await mountPanel({
		asks: [
			answeredUndelivered([question({ multi: true })], {
				target: ["staging", "canary"],
			}),
		],
	});
	await press(
		qa(view, "button").find((b) => b.textContent.trim() === "Change answer"),
	);
	assert.equal(field(view).value, "canary", "seeded from the log");
	const update = () =>
		qa(view, "button").find((b) => b.textContent.trim() === "Update answer");
	assert.equal(update().disabled, false);
	await type(field(view), "");
	assert.equal(
		update().disabled,
		true,
		"an emptied Other is incomplete, not dropped",
	);
	await press(other(view));
	assert.equal(
		update().disabled,
		false,
		"unticked: the tick alone is the revision",
	);
});

test("D4: the Other row's hint and the field's placeholder are the SAME sentence, and the field is named by its question", async () => {
	const view = await mountPanel({
		asks: [ask([question({ question: "Which region?" })])],
	});
	const hint = other(view).textContent.replace("Other", "").trim();
	assert.equal(hint, OTHER_HINT);
	await press(other(view));
	assert.equal(
		field(view).getAttribute("placeholder"),
		hint,
		"one sentence, twice",
	);
	assert.equal(
		field(view).getAttribute("aria-label"),
		"Your answer to: Which region?",
	);
	const free = await mountPanel({
		asks: [
			ask(
				[
					question({
						options: undefined,
						id: "note",
						question: "What changed?",
					}),
				],
				{ ask_id: "a-free" },
			),
		],
	});
	const box = free.container.querySelector("textarea[data-ask-other]");
	assert.equal(
		box.getAttribute("placeholder"),
		hint,
		"the free-text-only field says it too",
	);
	assert.equal(box.getAttribute("aria-label"), "Your answer to: What changed?");
});

test("N1: what a drawer close KEEPS and what it DROPS - the live Other and its tick stay, text stashed off Other does not", async () => {
	const questions = [question({ multi: true })];
	// A live Other (ticked, with text) and a tick: both come back, Other open and unfocused.
	const live = await mountPanel({ asks: [ask(questions)] });
	await press(q(live, '[data-ask-option="staging"]'));
	await press(other(live));
	await type(field(live), "canary");
	const keptLive = live.state.drafts;
	await live.unmount();
	mounted.pop();
	const reopenedLive = await mountPanel({
		asks: [ask(questions)],
		initialDrafts: keptLive,
	});
	assert.equal(field(reopenedLive).value, "canary", "the live text came back");
	assert.equal(
		q(reopenedLive, '[data-ask-option="staging"]').getAttribute("aria-pressed"),
		"true",
		"and so did the tick",
	);
	await reopenedLive.unmount();
	mounted.pop();
	// Text STASHED after unticking Other lives in the card only: the draft holds answers,
	// and an unticked Other is not one. A drawer close drops it; the tick stands.
	const stashed = await mountPanel({ asks: [ask(questions)] });
	await press(q(stashed, '[data-ask-option="staging"]'));
	await press(other(stashed));
	await type(field(stashed), "stashed words");
	await press(other(stashed));
	is(
		field(stashed),
		null,
		"unticked: the field folds away, the text is stashed",
	);
	const keptStash = stashed.state.drafts;
	await stashed.unmount();
	mounted.pop();
	const reopenedStash = await mountPanel({
		asks: [ask(questions)],
		initialDrafts: keptStash,
	});
	is(field(reopenedStash), null, "the stashed text did not survive the close");
	assert.equal(
		other(reopenedStash).getAttribute("aria-pressed"),
		"false",
		"Other is unticked, as the user left it",
	);
	assert.equal(
		q(reopenedStash, '[data-ask-option="staging"]').getAttribute(
			"aria-pressed",
		),
		"true",
		"the tick stands",
	);
});

/* ------------------------------------------------------------------- keys ---- */

test("Enter sends a complete ask; Shift+Enter is a newline; composition is ignored", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	await press(other(view));
	await type(field(view), "prod");

	const shift = await key(field(view), "Enter", { shiftKey: true });
	assert.equal(
		shift.defaultPrevented,
		false,
		"Shift+Enter is left to the browser: a newline",
	);
	assert.equal(view.calls.answer.length, 0);

	const composing = await key(field(view), "Enter", { isComposing: true });
	assert.equal(
		composing.defaultPrevented,
		false,
		"an IME's Enter confirms a candidate",
	);
	assert.equal(view.calls.answer.length, 0);

	const plain = await key(field(view), "Enter");
	assert.equal(plain.defaultPrevented, true);
	assert.deepEqual(view.calls.answer, [
		{ id: "a-7f3c", answers: { target: ["prod"] } },
	]);
});

test("Cmd+Enter and Ctrl+Enter are never a trap: they do what Enter does", async () => {
	for (const chord of [{ metaKey: true }, { ctrlKey: true }]) {
		const view = await mountPanel({ asks: [ask([question()])] });
		await press(other(view));
		await type(field(view), "prod");
		const event = await key(field(view), "Enter", chord);
		assert.equal(event.defaultPrevented, true);
		assert.equal(view.calls.answer.length, 1, JSON.stringify(chord));
		await view.unmount();
		mounted.pop();
	}
});

test("Enter in an EMPTY Other field sends nothing and does not jump", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	await press(other(view));
	await key(field(view), "Enter");
	assert.equal(view.calls.answer.length, 0, "an empty Other is not an answer");
	is(document.activeElement, field(view), "and focus stays");
});

test("Enter on an incomplete ask moves to the next unanswered question instead of sending", async () => {
	const view = await mountPanel({
		asks: [
			ask([
				question({ id: "env" }),
				question({
					id: "region",
					question: "Which region?",
					options: [{ label: "eu" }, { label: "us" }],
				}),
			]),
		],
	});
	const first = q(view, '[data-lo-ask-question="env"]');
	await press(first.querySelector("[data-ask-option-other]"));
	await type(first.querySelector("textarea[data-ask-other]"), "prod");
	await key(first.querySelector("textarea[data-ask-other]"), "Enter");
	assert.equal(view.calls.answer.length, 0, "the ask is not complete yet");
	assert.equal(
		document.activeElement
			?.closest("[data-lo-ask-question]")
			?.getAttribute("data-lo-ask-question"),
		"region",
		"focus moved on to the question that still needs an answer",
	);
	assert.equal(
		document.activeElement?.getAttribute("data-ask-option"),
		"eu",
		"onto its first control",
	);
});

test("Escape in the field belongs to the ask lane (collapses the drawer) and not to the turn", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	await press(other(view));
	const box = field(view);
	assert.equal(
		askClaimsEscape({ key: "Escape", target: box }),
		true,
		"the field sits inside the ask surface",
	);
	assert.equal(
		box.matches(COMPOSER_TEXTAREA_SELECTOR),
		false,
		"so the interrupt ladder, which exempts only the composer, stands down",
	);
});

/* ------------------------------------------------- text only, and honest ---- */

const filePaste = (files) => {
	const event = new window.Event("paste", { bubbles: true, cancelable: true });
	event.clipboardData = {
		files,
		items: files.map(() => ({ kind: "file", type: "image/png" })),
		types: ["Files"],
		getData: () => "",
	};
	return event;
};

test("pasting an image or file is REFUSED IN WORDS, and the draft is untouched", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	await press(other(view));
	const box = field(view);
	is(q(view, "output"), null, "no notice before there is anything to refuse");
	// The draft AS IT STANDS before the paste (an open, empty Other holds its place in
	// the cell - round 1, D1), so "untouched" is a comparison and not a claim about how
	// emptiness is encoded.
	const beforePaste = JSON.stringify(draftOf(view) ?? null);
	await act(async () => {
		box.dispatchEvent(
			filePaste([{ name: "screenshot.png", type: "image/png" }]),
		);
	});
	const notice = q(view, "output");
	assert.ok(notice, "a visible, announced sentence: not a silent no-op");
	assert.match(notice.textContent, RE_CANT_ATTACH);
	assert.equal(
		JSON.stringify(draftOf(view) ?? null),
		beforePaste,
		"nothing was added to the answer",
	);
	assert.equal(
		askQuestionIsAnswered(question(), { target: draftOf(view) ?? [] }),
		false,
		"and the refused file did not make it an answer",
	);
	await type(field(view), "typed instead");
	is(q(view, "output"), null, "the sentence clears once the user types");
});

test("a TEXT paste raises no refusal", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	await press(other(view));
	const event = new window.Event("paste", { bubbles: true, cancelable: true });
	event.clipboardData = {
		files: [],
		items: [],
		types: ["text/plain"],
		getData: () => "hi",
	};
	await act(async () => {
		field(view).dispatchEvent(event);
	});
	is(q(view, "output"), null);
});

test("dragging a file over the field is answered with the pointer's own 'no drop'", async () => {
	const view = await mountPanel({ asks: [ask([question()])] });
	await press(other(view));
	const over = new window.Event("dragover", {
		bubbles: true,
		cancelable: true,
	});
	over.dataTransfer = { types: ["Files"], dropEffect: "copy", files: [] };
	await act(async () => {
		field(view).dispatchEvent(over);
	});
	assert.equal(
		over.defaultPrevented,
		true,
		"cancelled, so the page does not navigate to the file",
	);
	assert.equal(
		over.dataTransfer.dropEffect,
		"none",
		"and the cursor says it is refused",
	);
	// Dragging TEXT stays the browser's own insert-at-caret behaviour.
	const text = new window.Event("dragover", {
		bubbles: true,
		cancelable: true,
	});
	text.dataTransfer = { types: ["text/plain"], dropEffect: "copy", files: [] };
	await act(async () => {
		field(view).dispatchEvent(text);
	});
	assert.equal(text.defaultPrevented, false);
});

/* ------------------------------------------------------------- the wire ---- */

test("the answer body built from an Other draft has the shape an option press builds", () => {
	const pending = ask([question()]);
	const bodyFor = (cell) => {
		const request = askAnswerRequest(pending, { target: cell }, SESSION);
		// The REAL schema and the REAL endpoint mapper: a stray key (an `other`
		// flag, an `attachments` list) would be refused or carried here.
		desktopRequestSchema.parse(request);
		return { request, endpoint: desktopEndpoint(request) };
	};
	const viaOption = bodyFor(["staging"]);
	const viaOther = bodyFor(["prod"]);
	assert.deepEqual(Object.keys(viaOther.request).sort(), [
		"answers",
		"askId",
		"op",
		"sessionId",
	]);
	assert.deepEqual(
		Object.keys(viaOption.request),
		Object.keys(viaOther.request),
	);
	assert.deepEqual(viaOther.request.answers, { target: ["prod"] });
	assert.deepEqual(
		Object.keys(viaOther.endpoint),
		Object.keys(viaOption.endpoint),
	);
	assert.deepEqual(viaOther.endpoint.body.answers, { target: ["prod"] });
	assert.equal(typeof viaOther.endpoint.body.answers.target[0], "string");
	// And an empty Other can never reach the wire as an empty string.
	assert.equal(askAnswerRequest(pending, { target: [] }, SESSION), null);
	assert.equal(askAnswerRequest(pending, { target: [""] }, SESSION), null);
	assert.equal(
		askAnswerMap(pending, { target: askCellWith([], false, OPEN("  ")) }),
		null,
		"an open-but-empty Other builds no answer at all",
	);
	assert.ok(askQueueView({ asks: [pending] }).head);
});

/* ------------------------------------------- change-before-delivery neighbour ---- */

const answeredUndelivered = (questions, answers) =>
	ask(questions, { status: "answered", delivered: false, answers });

test("the change form seeds an Other answer into the Other field and Enter posts the whole map", async () => {
	const view = await mountPanel({
		asks: [answeredUndelivered([question()], { target: ["prod"] })],
	});
	await press(
		qa(view, "button").find((b) => b.textContent.trim() === "Change answer"),
	);
	assert.equal(field(view).value, "prod", "seeded from the log");
	assert.equal(other(view).getAttribute("aria-checked"), "true");
	/*
	 * U7 CHANGED THIS ON PURPOSE (round 2): the hand-off PREFERS the answer's own
	 * entry, so the press lands in the seeded field and misses no keystrokes. The
	 * old rule focused the form's first live control (the `staging` option here),
	 * and an `Input.insertText` there changed nothing.
	 */
	is(
		document.activeElement,
		field(view),
		"the seeded field, not an option row",
	);
	assert.equal(
		field(view).selectionStart,
		"prod".length,
		"the caret is after the seeded text",
	);
	await type(field(view), "prod-2");
	await key(field(view), "Enter");
	assert.deepEqual(view.calls.revise, [
		{ id: "a-7f3c", answers: { target: ["prod-2"] } },
	]);
	assert.equal(view.calls.answer.length, 0, "a revision, not a first answer");
});

test("F5: a free-text-only change form lands focus in the field, not on the body", async () => {
	const view = await mountPanel({
		asks: [
			answeredUndelivered([question({ options: undefined, id: "note" })], {
				note: ["hello"],
			}),
		],
	});
	await press(
		qa(view, "button").find((b) => b.textContent.trim() === "Change answer"),
	);
	is(document.activeElement, field(view));
	assert.equal(field(view).value, "hello");
	// U1's second door: the hand-off focuses a field that already holds text, and a
	// browser puts the caret at offset 0 there, so the next keystrokes would PREPEND.
	assert.equal(
		field(view).selectionStart,
		"hello".length,
		"the caret is after the seeded text",
	);
	await typeAtCaret(field(view), " world");
	assert.equal(field(view).value, "hello world");
});

/* -------------------------------------------------------- the answered card ---- */

test("an answered card keeps a multi-line answer's lines and tags only what the list did not offer", async () => {
	const view = await mountPanel({
		asks: [
			answeredUndelivered(
				[
					question({ multi: true }),
					question({
						id: "key",
						options: undefined,
						secret: true,
						question: "Key?",
					}),
				],
				{ target: ["staging", "line one\nline two"], key: ["[deploy_key]"] },
			),
		],
		onRevise: false,
	});
	const rows = qa(view, "div.flex-col.gap-0\\.5");
	const first = rows[0];
	const value = [...first.querySelectorAll("span")].find((s) =>
		s.textContent.includes("line one"),
	);
	assert.ok(value, "the value is drawn");
	assert.match(value.className, RE_PRE_WRAP, "newlines are kept");
	assert.match(value.className, RE_BREAK_WORDS);
	assert.ok(first.textContent.includes("Other"), "the typed value is tagged");
	assert.equal(
		first.textContent.split("Other").length - 1,
		1,
		"and only the typed one, not the option label",
	);
	// D2: the tag is a LABEL, not the last word of the user's sentence - a separator
	// stands between them, decoration only (a screen reader reads the word, not a dot).
	const dot = first.querySelector('[aria-hidden="true"]');
	assert.ok(dot, "a decorative separator precedes the tag");
	assert.equal(dot.textContent.trim(), "\u00b7");
	assert.equal(
		dot.parentElement.textContent.replace(RE_WHITESPACE_RUN, " ").trim(),
		"\u00b7 Other",
		"separator then word, in the tag's own element",
	);
	assert.notEqual(
		dot.parentElement,
		value,
		"the tag is its own element, not part of the value's text node",
	);
	assert.equal(
		rows[1].textContent.includes("Other"),
		false,
		"a secret's recorded key name is not an 'Other' answer",
	);
});
