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
	{ name: "Plan", items: statuses.map((s, i) => ({ text: `item ${i}`, status: s })) },
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
const PANEL = "src/renderer/src/features/chat/components/run-details/run-panel.tsx";

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
	assert.match(markup, /Goal:/, "the chip carries the picker's own field label");
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
		planChipLabel(4),
		"Open the plan in run details — 4 to-dos open",
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
	assert.match(markup, /aria-label="Open the plan in run details — 3 to-dos open"/);
	assert.doesNotMatch(markup, /Goal:/, "a session with no goal grows no goal chip");
});

test("a finished plan still renders, and says so", () => {
	/*
	 * `0 to-dos open` rather than the chip vanishing: the row's height must not
	 * change when the last item closes, and a plan that completed is a fact worth
	 * keeping on screen.
	 */
	const details = detailsFor(["done", "done", "dropped"]);
	assert.equal(details.openTodos, 0);
	assert.match(
		renderRow({ frontend: frontend(""), runDetails: details }),
		/0 to-dos open/,
	);
});

test("the clause is the model's one spelling, for one, none and many", () => {
	assert.equal(todoClause(0), "0 to-dos open");
	assert.equal(todoClause(1), "1 to-do open");
	assert.equal(todoClause(2), "2 to-dos open");
	assert.equal(todoClause(14), "14 to-dos open");
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
	store.setState({ runPanelReveal: null, isRunPanelOpen: false, isCanvasOpen: true });
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
	assert.ok(alert > -1 && box > -1, "the alert and the box are where they were");
	assert.ok(
		row < alert && alert < box,
		"band order is row, alert, box — the persistent context goes outboard of the transient one",
	);
	/*
	 * Keyed on the conversation, and that is a requirement rather than tidiness:
	 * the composer is not remounted on a session switch, so a goal expanded in one
	 * conversation would otherwise arrive expanded in the next.
	 */
	assert.match(source, /<ComposerStatusRow[\s\S]{0,240}?key=\{conversationId\}/);
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
	const content = code("src/renderer/src/features/chat/components/chat-content.tsx");
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
	// One line above 240px of column, a column at or below it.
	assert.match(source, /"@max-\[240px\]\/chatcol:flex-col"/);
	// The goal item is the flexible one and can shrink to nothing (`min-w-0`).
	assert.match(source, /"min-w-0 flex-1", COLUMN_GOAL/);
	// At the floor it takes the row's own width and stops being a flex item that
	// could collapse in a column container.
	assert.match(source, /@max-\[240px\]\/chatcol:w-full/);
	assert.match(source, /@max-\[240px\]\/chatcol:flex-none/);
	// The label leaves the pixels but stays in the accessibility tree.
	assert.match(source, /@max-\[240px\]\/chatcol:sr-only/);
	// The chip's hover ground is chip-sized while the item keeps the free space.
	assert.match(source, /"w-fit max-w-full -ml-1\.5 /);
	/*
	 * `max-w-full` and `h-6 py-0` are both measured overrides rather than taste,
	 * and both are pinned because the frames are what found them: without the
	 * clamp the chip resolves to its content's max-content width and paints over
	 * the count, and without the height the two chips of one row differ by 1.7px.
	 */
	assert.match(source, /rowClassName=\{cn\("h-6 rounded-sm px-1\.5 py-0"\)\}/);
	// The shared horizontal inset is the alert's own, not a second number.
	assert.match(source, /isSmallView \? "px-2 pb-1" : "px-4 pb-2"/);
	assert.match(source, /CHAT_MEASURE/);
	/*
	 * The plan chip is the readings' own control box, IMPORTED rather than
	 * restated: two chips over one box with two class strings is how two hover
	 * grounds and two focus offsets arrive.
	 */
	assert.match(
		source,
		/import \{ READING_BUTTON as CHIP_CONTROL \} from "\.\.\/session-status\/session-status-strip"/,
	);
	assert.match(source, /className=\{CHIP_CONTROL\}/);
	assert.doesNotMatch(source, /bg-surface|border-control|bg-elevated/);
});

test("the expanded body caps itself, keeps the author's breaks, and carries its own tab stop", () => {
	const source = code(ROW);
	assert.match(source, /max-h-32 overflow-y-auto/);
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
