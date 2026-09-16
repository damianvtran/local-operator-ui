import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer's status row: the goal disclosure and the plan count, above the
 * composer box (`docs/composer-status-tabs.md`, which is the design record).
 *
 * Three instruments, each for what it can actually see:
 *
 * 1. **Rendered markup**, from `renderToStaticMarkup` against the SHIPPED
 *    component with the app's own aliases. This is where the row's own rules
 *    live: a session with neither a goal nor a plan renders NOTHING rather than
 *    an empty 24px box above every composer in the app; a truncated snippet
 *    still carries its whole value in the accessible name; the plan's number is
 *    the model's clause and not a tally written here.
 * 2. **The store**, exercised directly, for the reveal request the plan chip
 *    files and the pane consumes. It is a one-shot request with a nonce, and the
 *    nonce is what keeps an older consumer from eating a newer request.
 * 3. **The shipped SOURCE**, comment-stripped, for everything that is placement
 *    or geometry: the row's mount point in `message-input.tsx`, the classes that
 *    stack it at the column floor, and the pane's consumption of the request.
 *    There is no jsdom in this tree and this change is not the place to add one
 *    (`ask-options.test.mjs` makes the same call for the same reason), so the
 *    interaction itself is measured where it can be: the live frames, and QA's
 *    independent pass. What a source pin buys is that a revert of the placement
 *    or of the consumption has to come here and say what replaced it.
 *
 * The rendering harness is `composer-readings.test.mjs`'s, for the reason that
 * file records: esbuild bundles the real TypeScript in memory, React stays
 * external so the bundle shares ONE copy with this file's own imports, and the
 * renderer's `@shared` alias is declared by hand because esbuild cannot read
 * tsconfig paths.
 */

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import {
				ComposerStatusRow,
				goalDisclosureLabel,
				planChipLabel,
			} from "./src/renderer/src/features/chat/components/composer-status-row";
			import {
				deriveRunDetails,
				todoClause,
			} from "./src/renderer/src/features/chat/components/run-details";
			import { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";

			export const renderRow = (props) =>
				renderToStaticMarkup(createElement(ComposerStatusRow, props));
			export { goalDisclosureLabel, planChipLabel, deriveRunDetails, todoClause, useUiPreferencesStore };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// React stays external so the bundle shares ONE copy with this file's own
	// imports. Two copies give the component a different React than the server
	// renderer uses, and every render throws on an invalid hook call.
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});

// Written to a real file rather than imported as a data: URL: React DOM's
// server build resolves its own CJS entry at import time, which a data: URL
// has no base path for.
const bundlePath = new URL("./_composer-tabs.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
/*
 * Node has no `localStorage`, and the store under test is persisted: zustand's
 * persist middleware writes through storage on every `setState`, and with
 * `globalThis.localStorage` undefined (Node 26's own default without
 * `--localstorage-file`) the write throws inside the middleware rather than
 * degrading. A three-method Map-backed shim is the API the browser provides, so
 * the store is exercised against the interface it actually has; the tests clear
 * it between cases so nothing carries over.
 */
const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};
const {
	renderRow,
	goalDisclosureLabel,
	planChipLabel,
	deriveRunDetails,
	todoClause,
	useUiPreferencesStore,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* ---------------------------------------------------------------- */
/* Fixtures                                                          */
/* ---------------------------------------------------------------- */

/** A frontend snapshot carrying only the field this row reads. */
const frontend = (goal) => ({ goal });

/**
 * A phase-shaped plan, from the wire shapes the backend publishes — the same
 * builder `run-detail-model.test.mjs` uses, so the fixture is the wire rather
 * than a plausible-looking invention.
 */
const plan = (statuses) => [
	{
		name: "Plan",
		items: statuses.map((s, i) => ({ text: `item ${i}`, status: s })),
	},
];

const detailsFor = (statuses) =>
	deriveRunDetails({ jobs: [], todos: plan(statuses) });

const LONG_GOAL =
	"Reconcile the March invoices against the payments ledger, group the unpaid rows by customer, confirm what 'pending' means with finance, then write reports/unpaid-march.md and publish the summary";

/**
 * The escaping React applies to an attribute value, so an expected string can be
 * compared against rendered markup. Hard-coded rather than imported: this is the
 * server renderer's own contract, and a helper from the component's side of the
 * fence could agree with the component and disagree with React.
 */
const attr = (value) =>
	value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

/**
 * The shipped source with its comments removed.
 *
 * A text match is satisfiable by text that is not code, and every claim below is
 * also quoted in a docblock somewhere in this change — so a comment left behind
 * by a revert would keep the pin green. The block strip is non-greedy and the
 * line strip skips the `://` in a URL, which is `ask-options.test.mjs`'s device.
 */
const code = (path) =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const ROW = "src/renderer/src/features/chat/components/composer-status-row.tsx";
const COMPOSER = "src/renderer/src/features/chat/components/message-input.tsx";
// Named for the band's own file in the round-1 findings; `COMPOSER` is the
// historical name for the same file in this suite's earlier assertions.
const MESSAGE_INPUT = COMPOSER;
const MEASURE = "src/renderer/src/features/chat/chat-measure.ts";
const SCROLL_BUTTON =
	"src/renderer/src/features/chat/components/scroll-to-bottom-button.tsx";
const PANEL =
	"src/renderer/src/features/chat/components/run-details/run-panel.tsx";

/* ---------------------------------------------------------------- */
/* The nothing state                                                 */
/* ---------------------------------------------------------------- */

test("a session with no goal and no plan renders NOTHING", () => {
	/*
	 * The state that most needs pinning, because an editor breaks it by accident:
	 * an empty row is still 24px of nothing above EVERY composer in the app, in
	 * every session that has no goal and no plan. `null`, not an empty box.
	 */
	assert.equal(
		renderRow({ frontend: frontend(""), runDetails: null }),
		"",
		"an empty goal and no plan must render nothing at all",
	);
	/*
	 * And the same for the two states the wire actually produces: a session whose
	 * goal is only whitespace (the picker's textarea accepts it), and a pane with
	 * no canonical frontend at all — a draft, or a legacy chat.
	 */
	assert.equal(
		renderRow({ frontend: frontend("   \n  "), runDetails: null }),
		"",
		"a whitespace-only goal is no goal",
	);
	assert.equal(
		renderRow({ frontend: null, runDetails: null }),
		"",
		"no frontend and no model renders nothing",
	);
});

test("a plan with no items renders nothing, and a plan of items does not", () => {
	assert.equal(
		renderRow({ frontend: frontend(""), runDetails: detailsFor([]) }),
		"",
	);
	assert.notEqual(
		renderRow({ frontend: frontend(""), runDetails: detailsFor(["done"]) }),
		"",
	);
});

/* ---------------------------------------------------------------- */
/* The goal chip                                                     */
/* ---------------------------------------------------------------- */

test("the goal chip's label, snippet and accessible name", () => {
	const markup = renderRow({
		frontend: frontend("Ship the composer status row"),
		runDetails: null,
	});
	assert.match(
		markup,
		/Goal:/,
		"the chip carries the picker's own field label",
	);
	assert.match(markup, /Ship the composer status row/);
	assert.doesNotMatch(
		markup,
		/data-status-plan/,
		"a session with no plan grows no plan chip",
	);
	/*
	 * The truncated snippet is a CSS ellipsis, so the full text has to have a
	 * second home before the click — the accessible name and the tooltip, which
	 * are one derived string here.
	 */
	assert.match(
		markup,
		/aria-label="Expand the session goal — Ship the composer status row"/,
		"the trigger's accessible name carries the goal in full",
	);
});

test("the goal truncation rule: CSS ellipsis on the snippet, whole value in the name", () => {
	const markup = renderRow({
		frontend: frontend(LONG_GOAL),
		runDetails: null,
	});
	/*
	 * The snippet truncates with `truncate` (overflow hidden, text-overflow
	 * ellipsis, nowrap) and NOT with a computed character count: there is no JS
	 * cell-measurement helper in this app, and the browser measures the real
	 * advance at the real font, size, zoom and theme.
	 */
	assert.match(markup, /class="[^"]*\btruncate\b[^"]*"/);
	assert.doesNotMatch(
		markup,
		/…/,
		"nothing truncates the value in JavaScript: the ellipsis is the browser's",
	);
	assert.ok(
		markup.includes(`Expand the session goal — ${attr(LONG_GOAL)}`),
		"the whole value is readable before the press",
	);
});

test("the goal chip is a disclosure, closed, with the primitive's own wiring", () => {
	const markup = renderRow({
		frontend: frontend("Ship it"),
		runDetails: null,
	});
	// Closed by default, per branding's disclosure rule, and it says so.
	assert.match(markup, /aria-expanded="false"/);
	assert.match(markup, /aria-controls="[^"]+"/);
	/*
	 * The body is mounted only while open, which is what keeps the tab stop this
	 * row adds (`tabIndex={0}` on the scrollable body) out of the ordinary
	 * composer: a closed chip has no body and therefore no stop.
	 */
	assert.doesNotMatch(markup, /data-status-goal-body/);
	assert.doesNotMatch(markup, /role="group"/);
});

test("the row's copy states the action that a press performs", () => {
	assert.equal(
		goalDisclosureLabel("Ship it", false),
		"Expand the session goal — Ship it",
	);
	assert.equal(
		goalDisclosureLabel("Ship it", true),
		"Collapse the session goal — Ship it",
	);
	// The action leads and the count follows, joined by the model's LABEL_SEAM.
	assert.equal(
		planChipLabel({ openTodos: 4, droppedTodos: 0 }),
		"Open the plan in run details — 4 to-dos open",
	);
	// The settled states are the same words the chip body prints (see below).
	assert.equal(
		planChipLabel({ openTodos: 0, droppedTodos: 0 }),
		"Open the plan in run details — All to-dos resolved",
	);
	assert.equal(
		planChipLabel({ openTodos: 0, droppedTodos: 2 }),
		"Open the plan in run details — All to-dos closed",
	);
});

/* ---------------------------------------------------------------- */
/* The plan count                                                    */
/* ---------------------------------------------------------------- */

test("the plan chip states the model's own clause, off the model's own counts", () => {
	/*
	 * Four items: one done, two pending, one blocked. The count is `openTodos`,
	 * i.e. pending PLUS blocked — the model's definition over the whole wire list
	 * — so 3, not 2. Nothing in the composer counts anything: a second tally here
	 * is exactly what the design record forbids, and this is the assertion that
	 * fails if someone writes one.
	 */
	const details = detailsFor(["done", "pending", "pending", "blocked"]);
	assert.equal(details.totalTodos, 4);
	assert.equal(details.openTodos, 3);
	const markup = renderRow({ frontend: frontend(""), runDetails: details });
	assert.match(markup, /data-status-plan/);
	assert.match(markup, /3 to-dos open/);
	assert.match(
		markup,
		/aria-label="Open the plan in run details — 3 to-dos open"/,
	);
	assert.doesNotMatch(
		markup,
		/Goal:/,
		"a session with no goal grows no goal chip",
	);
});

test("a finished plan still renders, and says so", () => {
	/*
	 * A settled plan keeps a clause rather than the chip vanishing: the row's
	 * height must not change when the last item closes, and a plan that ended is a
	 * fact worth keeping on screen. Two done, one dropped is the case that decides
	 * WHICH clause — nothing is open, so the count form cannot state it, and one
	 * item was abandoned, so `All to-dos resolved` would be a false claim about
	 * work that did not succeed.
	 */
	const details = detailsFor(["done", "done", "dropped"]);
	assert.equal(details.openTodos, 0);
	assert.ok(details.droppedTodos > 0);
	const markup = renderRow({ frontend: frontend(""), runDetails: details });
	assert.match(markup, /All to-dos closed/);
	assert.doesNotMatch(
		markup,
		/All to-dos resolved/,
		"a dropped item is not work that was resolved",
	);
	assert.match(
		markup,
		/aria-label="Open the plan in run details — All to-dos closed"/,
		"the name states the same settled words as the chip body",
	);
});

test("a plan with every item done is the one that reads as resolved", () => {
	const details = detailsFor(["done", "done", "done"]);
	assert.equal(details.openTodos, 0);
	assert.equal(details.droppedTodos, 0);
	const markup = renderRow({ frontend: frontend(""), runDetails: details });
	assert.match(markup, /All to-dos resolved/);
	assert.match(
		markup,
		/aria-label="Open the plan in run details — All to-dos resolved"/,
	);
	/*
	 * The settled case stops spelling a count at all: a chip that said
	 * `All to-dos resolved` beside a numeral would be two statements of one fact.
	 */
	assert.doesNotMatch(markup, /\d+ to-dos? open/);
});

test("the clause is the model's one spelling, for one, many and both settled states", () => {
	assert.equal(
		todoClause({ openTodos: 0, droppedTodos: 0 }),
		"All to-dos resolved",
	);
	assert.equal(
		todoClause({ openTodos: 0, droppedTodos: 2 }),
		"All to-dos closed",
	);
	assert.equal(todoClause({ openTodos: 1, droppedTodos: 0 }), "1 to-do open");
	assert.equal(todoClause({ openTodos: 2, droppedTodos: 0 }), "2 to-dos open");
	assert.equal(
		todoClause({ openTodos: 14, droppedTodos: 3 }),
		"14 to-dos open",
	);
	/*
	 * And the chip prints THAT function's output rather than a pluralisation of
	 * its own — the single-item case is the one a second copy gets wrong.
	 */
	assert.match(
		renderRow({ frontend: frontend(""), runDetails: detailsFor(["pending"]) }),
		/1 to-do open/,
	);
});

test("both chips, goal first in the DOM so paint order and tab order agree", () => {
	const markup = renderRow({
		frontend: frontend("Ship it"),
		runDetails: detailsFor(["pending", "done"]),
	});
	const goal = markup.indexOf("Goal:");
	const count = markup.indexOf("data-status-plan");
	assert.ok(goal > -1 && count > -1, "both chips render");
	assert.ok(
		goal < count,
		"the goal is the first chip in the DOM, which is also its order in the stacked arrangement",
	);
});

/* ---------------------------------------------------------------- */
/* The reveal request                                                */
/* ---------------------------------------------------------------- */

test("the plan chip files a one-shot request that both opens the pane and clears the canvas", () => {
	const store = useUiPreferencesStore;
	store.setState({
		runPanelReveal: null,
		isRunPanelOpen: false,
		isCanvasOpen: true,
	});
	store.getState().revealRunPanelSection("todos");
	const after = store.getState();
	assert.equal(after.runPanelReveal?.section, "todos");
	assert.equal(
		after.isRunPanelOpen,
		true,
		"the request opens the pane: nothing consumes it while the pane is closed",
	);
	assert.equal(
		after.isCanvasOpen,
		false,
		"one right pane at a time, enforced in the same update",
	);
});

test("the nonce makes two presses two requests, and a stale consumer cannot eat a newer one", () => {
	const store = useUiPreferencesStore;
	store.setState({ runPanelReveal: null });
	store.getState().revealRunPanelSection("todos");
	const first = store.getState().runPanelReveal;
	store.getState().revealRunPanelSection("todos");
	const second = store.getState().runPanelReveal;
	assert.notEqual(second.nonce, first.nonce, "each press is its own request");
	/*
	 * The effect that acted on the FIRST request must not retire the SECOND,
	 * which is what a nonce-checked clear buys: it is the guarantee a plain
	 * `set({ runPanelReveal: null })` loses the moment two presses overlap.
	 */
	store.getState().clearRunPanelReveal(first.nonce);
	assert.equal(
		store.getState().runPanelReveal?.nonce,
		second.nonce,
		"a stale nonce leaves the newer request alone",
	);
	store.getState().clearRunPanelReveal(second.nonce);
	assert.equal(store.getState().runPanelReveal, null);
	store.setState({ runPanelReveal: null });
});

/* ---------------------------------------------------------------- */
/* Placement and geometry, on the shipped source                     */
/* ---------------------------------------------------------------- */

test("the row mounts inside the form, ABOVE the alert and therefore above the box", () => {
	const source = code(COMPOSER);
	const row = source.indexOf("<ComposerStatusRow");
	const alert = source.indexOf('role="alert"');
	const box = source.indexOf("COMPOSER_BOX,");
	assert.ok(row > -1, "the composer mounts the row");
	assert.ok(
		alert > -1 && box > -1,
		"the alert and the box are where they were",
	);
	assert.ok(
		row < alert && alert < box,
		"band order is row, alert, box — the persistent context goes outboard of the transient one",
	);
	/*
	 * Keyed on the conversation, and that is a requirement rather than tidiness:
	 * the composer is not remounted on a session switch, so a goal expanded in one
	 * conversation would otherwise arrive expanded in the next.
	 */
	assert.match(
		source,
		/<ComposerStatusRow[\s\S]{0,240}?key=\{conversationId\}/,
	);
	/*
	 * A crash here must not cost the ability to type: the row renders inside an
	 * error boundary with an empty fallback, the readings strip's own treatment.
	 */
	assert.match(
		source,
		/<ErrorBoundary fallback=\{null\}>\s*<ComposerStatusRow/,
	);
	/*
	 * The counts come off the ONE derivation. `frontend` is the strip's own prop
	 * (the goal lives on it) and `runDetails` is the model the pane and the header
	 * trigger read — never a second `deriveRunDetails` call on this path.
	 */
	assert.match(source, /frontend=\{sessionStatus\?\.frontend\}/);
	assert.match(source, /runDetails=\{runDetails\}/);
	assert.doesNotMatch(
		source,
		/deriveRunDetails/,
		"the composer never derives the run model a second time",
	);
});

test("the composer's run model comes off the page's one derivation", () => {
	const content = code(
		"src/renderer/src/features/chat/components/chat-content.tsx",
	);
	assert.match(
		content,
		/runDetails=\{runDetails\}/,
		"the content component hands the composer the model it was given",
	);
	const page = code("src/renderer/src/features/chat/components/chat-page.tsx");
	assert.equal(
		page.match(/deriveRunDetails\(/g)?.length,
		1,
		"one derivation in the page, threaded to the pane, the trigger and now the composer",
	);
});

test("the row's own layout: the floor stacks it, and the alignment device is the alert's", () => {
	const source = code(ROW);
	/*
	 * TOKEN-level rather than whole-class-string pins, except where the exact
	 * string IS the finding (agent review round 1, M5): a pin on
	 * `"min-w-0 flex-1", COLUMN_GOAL` fails the moment anyone reorders or adds a
	 * class, which costs a review round for a cosmetic edit, while the property
	 * those classes carry is what a regression would remove.
	 */
	const tokens = (...names) =>
		assert.ok(
			names.every((name) => source.includes(name)),
			`expected the row's source to carry ${names.join(", ")}`,
		);

	// One line above 240px of column, a column at or below it.
	tokens("@max-[240px]/chatcol:flex-col");
	// The goal item is the flexible one and can shrink to nothing (`min-w-0`).
	tokens(
		"min-w-0",
		"flex-1",
		"COLUMN_GOAL",
		"@max-[240px]/chatcol:w-full",
		"@max-[240px]/chatcol:flex-none",
	);
	/*
	 * The label is VISIBLE in every arrangement (design review round 1, D4): the
	 * `sr-only` floor rule is gone, and the label's `shrink-0` is what makes the
	 * yield order hold where both chips share a line - the snippet yields, the
	 * count never does.
	 */
	assert.doesNotMatch(source, /chatcol:sr-only/);
	tokens('cn("shrink-0")', "{GOAL_LABEL}");

	/*
	 * The row owns the first-chip rule (design review round 1, D5): one constant,
	 * applied by the row to whichever chip renders first, so the two states the row
	 * can be in share one left edge.
	 */
	assert.match(source, /const FIRST_CHIP = "-ml-1\.5";/);
	assert.match(source, /showGoal \? undefined : FIRST_CHIP/);

	/*
	 * The two MEASURED overrides, byte-exact, because the numbers are the finding:
	 * without `max-w-full` the chip resolves to its content's max-content width
	 * (2026px inside an 868px item) and paints over the count with the snippet
	 * un-truncated; without `h-6 py-0` the two chips of one row differ by 1.7px
	 * (25.7px beside 24px).
	 */
	assert.match(source, /"w-fit max-w-full text-ink-muted/);
	assert.match(source, /rowClassName=\{cn\("h-6 rounded-sm px-1\.5 py-0"\)\}/);

	// The shared horizontal inset is the alert's own, not a second number.
	tokens("isSmallView ?", '"px-2 pb-1"', '"px-4 pb-2"', "CHAT_MEASURE");
	/*
	 * The plan chip is the readings' own control box, IMPORTED rather than
	 * restated: two chips over one box with two class strings is how two hover
	 * grounds and two focus offsets arrive.
	 */
	assert.match(
		source,
		/import \{ READING_BUTTON as CHIP_CONTROL \} from "\.\.\/session-status\/session-status-strip"/,
	);
	tokens("CHIP_CONTROL");
	assert.doesNotMatch(source, /bg-surface|border-control|bg-elevated/);
	/*
	 * The count's visible affordance mark (design review round 1, D1): the run
	 * pane's own glyph, leading the count, decorative to assistive tech because the
	 * accessible name already states the action.
	 */
	tokens("import { Info } from", "<Info aria-hidden={true}", "size-3.5");
});

test("the expanded body caps itself, keeps the author's breaks, and carries its own tab stop", () => {
	const source = code(ROW);
	/*
	 * The cap is the composer's SHARED whole-line device, not a local number
	 * (design review round 1, D2): `max-h-32` at `leading-5` ended 8px into a
	 * seventh line, so the paint was a row of letter tops under a complete line.
	 * The alert above the box uses the same constant.
	 */
	assert.match(source, /CAPPED_BLOCK/);
	assert.doesNotMatch(source, /max-h-32/);
	assert.match(source, /whitespace-pre-wrap break-words/);
	assert.match(source, /role="group"/);
	assert.match(source, /aria-label="Session goal"/);
	assert.match(source, /tabIndex=\{0\}/);
	/*
	 * The plan chip REVEALS and is not a toggle: no `aria-pressed` and no pressed
	 * ground, because a control whose effect depends on hidden pane state would
	 * close the pane for a user who pressed it looking for the plan.
	 */
	assert.doesNotMatch(source, /aria-pressed/);
	assert.match(source, /onClick=\{\(\) => revealPlan\("todos"\)\}/);
});

test("the composer's two capped blocks share one whole-line cap", () => {
	const measure = code(MEASURE);
	/* 120px is six whole lines at `leading-5`, and the leading is stated rather
	 * than inherited so the boundary cannot drift back through a line. */
	assert.match(measure, /max-h-\[7\.5rem\]/);
	assert.match(measure, /leading-5/);
	const input = code(MESSAGE_INPUT);
	// The send-error alert, which had the identical `max-h-32` and the identical
	// defect, now consumes the same constant.
	assert.match(input, /CAPPED_BLOCK/);
	assert.doesNotMatch(input, /max-h-32/);
});

test("the goal mirror follows the control it describes across a hide", () => {
	const source = code(ROW);
	/*
	 * `goalOpen` is a copy of the disclosure's state, used for the label's verb. It
	 * is never written from the caller, so it holds only while the primitive stays
	 * mounted - and the chip unmounts when there is no goal (`showGoal && <Disclosure>`),
	 * which is how `/goal`, `clear`, then a new goal announced "Collapse..." over a
	 * closed chip (agent review round 1, M1). A rendered test needs jsdom, which
	 * this tree does not have, so the reset is pinned at the source.
	 */
	assert.match(source, /if \(!showGoal\) setGoalOpen\(false\);/);
	assert.match(source, /\}, \[showGoal\]\);/);
});

test("the hidden scroll-to-bottom control is not hit-testable", () => {
	const source = code(SCROLL_BUTTON);
	/*
	 * Hit-testing ignores opacity, so the unconditionally re-enabled
	 * `pointer-events-auto` left an invisible 32x32 button over the composer at the
	 * column floor, where it swallowed real presses on the goal chip and part of the
	 * expanded body (QA round 1, Q1).
	 */
	assert.match(
		source,
		/visible \? "pointer-events-auto" : "pointer-events-none"/,
	);
	assert.doesNotMatch(source, /className="pointer-events-auto rounded-full/);
});

test("the empty-chat band keeps one wrapper, so a narrowing column cannot remount the row", () => {
	const source = code(MESSAGE_INPUT);
	/*
	 * The band used to swap between a centred prompt `<div>` and a bare
	 * `inputContent` on `!isSmallView`, a COLUMN measurement - so opening the pane
	 * or the canvas changed the element TYPE at that position and React replaced the
	 * subtree, including the plan chip the user had just pressed. Focus went to
	 * `<body>` (QA round 1, Q4). One wrapper at every state, classes only.
	 */
	assert.match(source, /const showEmptyChatPrompt =/);
	assert.doesNotMatch(
		source,
		/messages\.length === 0 && !isHydrating && !isSmallView \?/,
	);
	assert.match(source, /\{showEmptyChatPrompt \? \(/);
});

test("the pane consumes the request: leave a reader, scroll the plan in, retire it", () => {
	const source = code(PANEL);
	/*
	 * A reader replaces the panel's body wholesale, so the plan is not on screen
	 * inside one: it is left first and the request is HELD (the early `return`
	 * with no `clearReveal`) so the next render's effect can finish the job.
	 */
	assert.match(
		source,
		/if \(openChildId\) \{\s*onReaderChildChange\(null\);\s*return;\s*\}/,
	);
	assert.match(source, /target\.scrollIntoView\(\{ block: "start" \}\)/);
	assert.match(source, /clearReveal\(revealRequest\.nonce\)/);
	assert.match(
		source,
		/useUiPreferencesStore\(\(state\) => state\.runPanelReveal\)/,
	);
	// Focus is never taken: no `.focus()` on this path, and no `scroll-behavior`
	// animation either.
	assert.doesNotMatch(source, /scrollIntoView\(\{ block: "start", behavior/);
});

test("the todos section is the node the request scrolls to", () => {
	const todos = code(
		"src/renderer/src/features/chat/components/run-details/run-detail-todos.tsx",
	);
	assert.match(todos, /<section ref=\{sectionRef\}/);
	const panel = code(
		"src/renderer/src/features/chat/components/run-details/run-details-panel.tsx",
	);
	assert.match(panel, /sectionRef=\{todosSectionRef\}/);
	assert.match(panel, /todosSectionRef\?: Ref<HTMLElement>/);
});
