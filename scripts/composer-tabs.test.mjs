import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { Fragment, act, createElement } from "react";

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

/*
 * React DOM FEATURE-DETECTS THE DOM AT IMPORT TIME, so a document has to exist
 * before anything imports it. This file's server-rendering tests do not need one,
 * but the driven test at the end of the file does, and the detection has already
 * run by then: with no document React concludes the browser needs its legacy
 * change-event polyfill, and the first focus of a textarea throws
 * `activeElement.attachEvent is not a function`. `suggestion-stack-react.test.mjs`
 * bootstraps one at the top of the file for the same reason.
 */
const bootstrapDOM = new JSDOM("<!doctype html>");
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import {
				ComposerStatusRow,
				shouldRestoreComposerFocus,
				goalDisclosureLabel,
				goalClearLabel,
				goalClearedText,
				loopActionLabel,
				loopAffordance,
				loopProgress,
				loopStatusWord,
				loopClause,
				loopIsRunning,
				planChipLabel,
				subagentChipLabel,
				jobChipLabel,
				wakeChipLabel,
			} from "./src/renderer/src/features/chat/components/composer-status-row";
			import {
				activityTally,
				deriveRunDetails,
				todoClause,
				busiestClause,
				childClause,
				jobClause,
				wakeClause,
			} from "./src/renderer/src/features/chat/components/run-details";
			import { RunDetailWakes } from "./src/renderer/src/features/chat/components/run-details/run-detail-wakes";
			import { ThemedToastContainer } from "./src/renderer/src/shared/components/common/themed-toast-container";
			import * as toasts from "./src/renderer/src/shared/utils/toast-manager";
			import { scrollRegionToTop } from "./src/renderer/src/shared/lib/scroll";
			import { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";

			export const renderRow = (props) =>
				renderToStaticMarkup(createElement(ComposerStatusRow, props));
			export const renderWakes = (props) =>
				renderToStaticMarkup(createElement(RunDetailWakes, props));
			export { toasts };
			export { ComposerStatusRow, ThemedToastContainer, shouldRestoreComposerFocus, busiestClause, goalDisclosureLabel, goalClearLabel, goalClearedText, loopActionLabel, loopAffordance, loopProgress, loopStatusWord, loopClause, loopIsRunning, planChipLabel, subagentChipLabel, jobChipLabel, wakeChipLabel, deriveRunDetails, activityTally, todoClause, childClause, jobClause, wakeClause, scrollRegionToTop, useUiPreferencesStore };
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
	ComposerStatusRow,
	shouldRestoreComposerFocus,
	renderWakes,
	goalDisclosureLabel,
	goalClearLabel,
	goalClearedText,
	ThemedToastContainer,
	toasts,
	loopActionLabel,
	loopAffordance,
	loopProgress,
	loopStatusWord,
	loopClause,
	loopIsRunning,
	planChipLabel,
	subagentChipLabel,
	jobChipLabel,
	wakeChipLabel,
	deriveRunDetails,
	activityTally,
	todoClause,
	busiestClause,
	childClause,
	jobClause,
	wakeClause,
	scrollRegionToTop,
	useUiPreferencesStore,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* ---------------------------------------------------------------- */
/* Fixtures                                                          */
/* ---------------------------------------------------------------- */

/** A frontend snapshot carrying only the field this row reads. */
const frontend = (goal) => ({ goal });

/**
 * A frontend snapshot carrying a GOAL and a LOOP, which are the two fields the
 * dismiss controls and the loop chip are gated on.
 *
 * `session_id` is real here rather than cast away: the dismiss controls address
 * the owner command to the session the row is drawn for, so the id the row reads
 * is part of what a markup assertion about the named goal is looking at.
 */
const frontendWith = (fields) => ({ goal: "", session_id: "s-1", ...fields });

/**
 * One wire loop state, in `DesktopLoopState`'s own shape.
 *
 * `idle` and a null field are both "no loop" for this row, so the fixture keeps
 * every field present and lets a case say `null` where it means absent — the
 * distinction the contract makes and the one the gate has to read.
 */
const wireLoop = (status, extra = {}) => ({
	status,
	completed: 0,
	iterations: null,
	goal: "",
	reason: "",
	...extra,
});

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

/**
 * One wire job, with only the fields the partition and the fold read.
 *
 * `type` is the row's own word: `task` is a delegated child, `bash` a tool job
 * (`harness/jobs.py:216`), and the two are the partition this suite is about.
 */
const wireJob = (id, type, status, label, queued = false) => ({
	id,
	type,
	status,
	queued,
	label,
	start_time: 1000,
	settled_at: null,
});

/** The model over a plan and a job list, so the chips' gates can be driven. */
const detailsWith = (jobs, statuses = []) =>
	deriveRunDetails({ jobs, todos: statuses.length > 0 ? plan(statuses) : [] });

/**
 * One ARMED wake schedule in the wire's own shape (`WakeState`).
 *
 * Epoch MILLISECONDS for `next_due_at`, which is the trap the contract names: the
 * job rows beside it carry epoch SECONDS. Built off a fixed base instant rather
 * than `Date.now()` so a clause's due label is reproducible.
 */
const WAKE_NOW_MS = Date.parse("2026-03-14T14:26:00Z");

const wireWake = (id, message, dueInMs, everyMs = null, limit = null) => ({
	id,
	message,
	next_due_at: WAKE_NOW_MS + dueInMs,
	created_at: WAKE_NOW_MS - 60_000,
	every_ms: everyMs,
	remaining: null,
	limit,
	fired_count: 0,
});

const HOUR_MS = 3_600_000;

/** The model over a wake list, so the chip's gate can be driven. */
const wakesOf = (wakes) =>
	deriveRunDetails({ jobs: [], todos: [], wakes, nowMs: WAKE_NOW_MS });

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
const CONTENT = "src/renderer/src/features/chat/components/chat-content.tsx";

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

test("the row's chips are ordered goal, loop, plan, wakes, subagents, jobs, in paint and tab order alike", () => {
	/*
	 * Six chips on one row and one DOM order, which the stacked arrangement at the
	 * column floor inherits: the row is a `flex-col` there, so the vertical order IS
	 * the DOM order. The two activity chips sit AFTER the plan chip, which is the
	 * operator's placement ("in the same row as the todos") and the reason their
	 * sections are `subagents` and `jobs` rather than a single activity control —
	 * and the WAKE chip sits between them and the plan, because the goal, the plan
	 * and the wakes are the session's standing facts while the subagents and jobs
	 * are what is moving now (`composer-status-row.tsx`'s `wakesFirst`).
	 *
	 * The LOOP chip is the sixth and it sits second, between the goal and the plan:
	 * it is the session's mode rather than a count of rows, it is paired with the goal
	 * (a count loop works the standing goal, a goal loop carries its own), and the two
	 * rejected placements are recorded in `docs/composer-status-tabs.md` § 13.
	 */
	const markup = renderRow({
		frontend: frontendWith({
			goal: "Ship it",
			loop: wireLoop("running", { completed: 2, iterations: 5 }),
		}),
		runDetails: deriveRunDetails({
			jobs: [
				wireJob("c1", "task", "running", "Audit the invoices"),
				wireJob("s1", "bash", "running", "bash: sleep 150"),
			],
			todos: plan(["pending", "done"]),
			wakes: [
				wireWake("w1", "Check the deploy", HOUR_MS),
				wireWake("w2", "Re-read the ledger", 2 * HOUR_MS, HOUR_MS, 3),
			],
		}),
	});
	const order = [
		markup.indexOf("Goal:"),
		markup.indexOf("data-status-loop-item"),
		markup.indexOf("data-status-plan"),
		markup.indexOf("data-status-wakes"),
		markup.indexOf("data-status-subagents"),
		markup.indexOf("data-status-jobs"),
	];
	assert.ok(
		order.every((at) => at > -1),
		"all six chips render",
	);
	assert.deepEqual(
		order,
		[...order].sort((a, b) => a - b),
		"the DOM order is the painted order",
	);
});

/* ---------------------------------------------------------------- */
/* The two activity chips                                            */
/* ---------------------------------------------------------------- */

test("each activity chip appears only when its own list has something open", () => {
	// A plan and nothing else: the row is the plan's, and no activity chip joins it.
	const planOnly = renderRow({
		frontend: frontend(""),
		runDetails: detailsFor(["pending"]),
	});
	assert.match(planOnly, /data-status-plan/);
	assert.doesNotMatch(planOnly, /data-status-subagents/);
	assert.doesNotMatch(planOnly, /data-status-jobs/);

	/*
	 * And a session whose rows have all SETTLED grows no chip either — which is the
	 * one place this row departs from the plan chip's "0 still renders" rule ("§ 5):
	 * `frontend.jobs` is swept minutes after a row settles, so `0 subagents running`
	 * would describe rows that are about to vanish, and it would put a chip above
	 * every composer on every session that has ever delegated anything.
	 */
	const settled = detailsWith([
		wireJob("c1", "task", "done", "Audit the invoices"),
		wireJob("s1", "bash", "completed", "bash: wc -l invoices/march.csv"),
	]);
	assert.equal(settled.openChildren, 0);
	assert.equal(settled.openJobs, 0);
	const settledMarkup = renderRow({
		frontend: frontend(""),
		runDetails: settled,
	});
	assert.equal(settledMarkup, "", "nothing to state, so nothing is stated");

	/*
	 * Each chip is gated on ITS OWN list, and the two are different lists: a child
	 * with no tool job beside it must not put a jobs chip on the row, and a shell
	 * job with no child must not put a subagents chip on it.
	 */
	const childOnly = renderRow({
		frontend: frontend(""),
		runDetails: detailsWith([wireJob("c1", "task", "running", "Audit")]),
	});
	assert.match(childOnly, /data-status-subagents/);
	assert.doesNotMatch(childOnly, /data-status-jobs/);

	const jobOnly = renderRow({
		frontend: frontend(""),
		runDetails: detailsWith([
			wireJob("s1", "bash", "running", "bash: sleep 150"),
		]),
	});
	assert.match(jobOnly, /data-status-jobs/);
	assert.doesNotMatch(jobOnly, /data-status-subagents/);
});

test("the activity chips state the model's clause and name the section they open", () => {
	const details = detailsWith(
		[
			wireJob("c1", "task", "running", "Audit the invoices"),
			wireJob("c2", "task", "running", "Summarise the findings"),
			wireJob("s1", "bash", "running", "bash: sleep 150 ; echo child-done"),
		],
		["pending"],
	);
	const markup = renderRow({ frontend: frontend(""), runDetails: details });
	assert.equal(details.openChildren, 2);
	assert.equal(details.openJobs, 1);
	// The visible count is the model's own clause, pluralised by the model, not here.
	assert.match(markup, />2 subagents running</);
	assert.match(markup, />1 job running</);
	assert.equal(
		childClause({ count: 2, mark: "running", markCount: 2 }),
		"2 subagents running",
	);
	assert.equal(
		jobClause({ count: 1, mark: "running", markCount: 1 }),
		"1 job running",
	);
	/*
	 * ...and the MIXED set, which is the ordinary case rather than an edge
	 * (`DEFAULT_MAX_RUNNING_JOBS = 15`, so a fan-out above fifteen children is
	 * parked against a running few): the count stays whole and the WORD becomes the
	 * family's, because the state word beside an open total would claim work that is
	 * not happening - design round 2's D6, where the chip read `40 subagents
	 * running` while the pane read `15 running · 25 queued · 17 interrupted ·
	 * 5 done` on the same screen.
	 */
	assert.equal(
		childClause({ count: 40, mark: "running", markCount: 15 }),
		"40 subagents open",
	);
	assert.equal(
		jobClause({ count: 3, mark: "queued", markCount: 1 }),
		"3 jobs open",
	);
	/*
	 * The narrow string is the SURFACE's; the accessible name and the tooltip have
	 * room for the busiest state, and the mark is `aria-hidden`, so without it a
	 * screen reader would hear the family word alone.
	 */
	assert.equal(
		subagentChipLabel({ count: 40, mark: "running", markCount: 15 }),
		"Open the subagents in run details — 40 subagents open, 15 running",
	);
	assert.equal(busiestClause({ count: 2, mark: "running", markCount: 2 }), "");
	// And the action leads the tooltip and the accessible name, one derived string.
	assert.match(
		markup,
		/aria-label="Open the subagents in run details — 2 subagents running"/,
	);
	assert.match(
		markup,
		/aria-label="Open the jobs in run details — 1 job running"/,
	);
	assert.equal(
		subagentChipLabel({ count: 2, mark: "running", markCount: 2 }),
		"Open the subagents in run details — 2 subagents running",
	);
	assert.equal(
		jobChipLabel({ count: 1, mark: "running", markCount: 1 }),
		"Open the jobs in run details — 1 job running",
	);
	/*
	 * Neither chip wears the plan chip's `Info`, and both wear the roster's state
	 * mark instead: one glyph in this row still means one thing, and the plan chip is
	 * still the only control whose glyph says "this opens the run pane".
	 */
	assert.match(markup, /lucide-info/);
	assert.equal(
		(markup.match(/lucide-info/g) ?? []).length,
		1,
		"the run pane's own mark is the plan chip's alone",
	);
});

test("a running activity chip carries the roster's spin, and only the running state does", () => {
	/*
	 * The mark IS the animation while active, and no still can prove it: the capture
	 * rig injects `animation: none !important` before every shutter
	 * (`capture-evidence.mjs:1851-1855`), so the spin is pinned in the rendered class
	 * string instead — where it is the roster's OWN contract,
	 * `motion-safe:animate-spin` for `running` and nothing else, with reduced motion
	 * leaving a shape that already distinguishes the state.
	 */
	const running = renderRow({
		frontend: frontend(""),
		runDetails: detailsWith([
			wireJob("c1", "task", "running", "Audit"),
			wireJob("s1", "bash", "running", "bash: sleep 150"),
		]),
	});
	assert.equal(
		(running.match(/motion-safe:animate-spin/g) ?? []).length,
		2,
		"both chips spin while both lists are working",
	);

	/*
	 * A QUEUED child says so, in the same word its mark shows, and that is design
	 * review round 1's D1 — found from this branch's own frame, where a chip leading
	 * with `Clock` said "1 subagent running" directly beneath it. The mark is
	 * `aria-hidden`, so the sentence was not a second opinion but the only reading
	 * assistive tech got: "running" for a child the capacity gate parked. Nothing
	 * spins here either, because nothing is running.
	 */
	const queued = renderRow({
		frontend: frontend(""),
		runDetails: detailsWith([wireJob("c1", "task", "running", "Parked", true)]),
	});
	assert.match(queued, />1 subagent queued</);
	assert.match(queued, /lucide-clock/);
	assert.doesNotMatch(queued, /motion-safe:animate-spin/);
	assert.doesNotMatch(
		queued,
		/running</,
		"a parked child is never spelled as work in progress",
	);

	/*
	 * A PAUSED child, the other open state, and the assertion is the point of the
	 * whole change: the word in the sentence is the word of the mark beside it, for
	 * every state the ladder can return. Driven from the model rather than listed
	 * here, so a state added to the ladder fails this test instead of escaping it.
	 */
	for (const [status, word, icon] of [
		["running", "running", "lucide-loader-circle"],
		["paused", "paused", "lucide-circle-pause"],
	]) {
		const rows = detailsWith([
			wireJob("c1", "task", status, "Audit"),
		]).subagents;
		const tally = activityTally(rows);
		assert.equal(tally?.mark, status);
		assert.equal(childClause(tally), `1 subagent ${word}`);
		assert.ok(
			childClause(tally).endsWith(tally.mark),
			"the clause's final word IS the mark's state, not a parallel claim",
		);
		const markup = renderRow({
			frontend: frontend(""),
			runDetails: detailsWith([wireJob("c1", "task", status, "Audit")]),
		});
		assert.match(markup, new RegExp(`>1 subagent ${word}<`));
		assert.match(markup, new RegExp(icon));
	}
});

test("the first chip cancels its own padding, whichever chip is first", () => {
	/*
	 * The row's alignment device, now ORDINAL: with five possible chips there are
	 * five states of "which one is first", and a rule written as a single boolean
	 * would put two chips' ink in the same 6px column the moment a session had an
	 * activity chip and no goal. The assertion is over the rendered class string, so
	 * it is the behaviour and not this file's belief about it.
	 */
	const firstClass = "-ml-1.5";
	const count = (markup) => (markup.match(/-ml-1\.5/g) ?? []).length;

	// No goal: the plan chip leads.
	const planFirst = renderRow({
		frontend: frontend(""),
		runDetails: detailsFor(["pending"]),
	});
	assert.equal(count(planFirst), 1);
	assert.ok(
		planFirst.indexOf("data-status-plan") < planFirst.indexOf(firstClass),
		"the padding is cancelled on the chip that renders first",
	);

	// No goal and no plan, but armed wakes: the wake chip leads.
	const wakesFirst = renderRow({
		frontend: frontend(""),
		runDetails: wakesOf([wireWake("w1", "Check the deploy", HOUR_MS)]),
	});
	assert.equal(count(wakesFirst), 1);
	assert.ok(
		wakesFirst.indexOf("data-status-wakes") < wakesFirst.indexOf(firstClass),
		"the wake chip renders before its own padding cancellation",
	);

	// No goal, no plan and no wakes: the subagents chip leads.
	const subagentsFirst = renderRow({
		frontend: frontend(""),
		runDetails: detailsWith([wireJob("c1", "task", "running", "Audit")]),
	});
	assert.equal(count(subagentsFirst), 1);
	assert.ok(
		subagentsFirst.indexOf(firstClass) >
			subagentsFirst.indexOf("data-status-subagents"),
	);
	assert.ok(
		subagentsFirst.indexOf(firstClass) < subagentsFirst.indexOf("</button>"),
	);

	// Only jobs open: the jobs chip leads.
	const jobsFirst = renderRow({
		frontend: frontend(""),
		runDetails: detailsWith([wireJob("s1", "bash", "running", "bash: sleep")]),
	});
	assert.equal(count(jobsFirst), 1);
	assert.ok(
		jobsFirst.indexOf("data-status-jobs") < jobsFirst.indexOf(firstClass),
	);

	// All five: exactly one cancellation, on the goal.
	const allFive = renderRow({
		frontend: frontend("Ship it"),
		runDetails: deriveRunDetails({
			jobs: [
				wireJob("c1", "task", "running", "Audit"),
				wireJob("s1", "bash", "running", "bash: sleep"),
			],
			todos: plan(["pending"]),
			wakes: [wireWake("w1", "Check the deploy", HOUR_MS)],
		}),
	});
	assert.equal(count(allFive), 1);
	assert.ok(allFive.indexOf(firstClass) < allFive.indexOf("data-status-plan"));

	// And the values are in the accessible names, never in a visible label.
	assert.ok(
		planFirst.includes(
			'aria-label="Open the plan in run details — 1 to-do open"',
		),
	);
});

test("each chip files its own section, and the store carries all four", () => {
	const store = useUiPreferencesStore;
	for (const section of ["subagents", "jobs", "wakes"]) {
		store.setState({
			runPanelReveal: null,
			isRunPanelOpen: false,
			isCanvasOpen: true,
		});
		store.getState().revealRunPanelSection(section);
		const after = store.getState();
		assert.equal(after.runPanelReveal?.section, section);
		assert.equal(after.isRunPanelOpen, true);
		assert.equal(after.isCanvasOpen, false);
	}
	store.setState({ runPanelReveal: null });
});

/* ---------------------------------------------------------------- */
/* The wake chip and the Wakes section (`docs/composer-wakes.md`)     */
/* ---------------------------------------------------------------- */

/** The section's own file, and the panel that owns its place in the list. */
const WAKES =
	"src/renderer/src/features/chat/components/run-details/run-detail-wakes.tsx";
const SECTION_LIST =
	"src/renderer/src/features/chat/components/run-details/run-details-panel.tsx";
const CHAT_PAGE = "src/renderer/src/features/chat/components/chat-page.tsx";

test("a session with no wakes renders no wake chip at all", () => {
	/*
	 * The gate, and it is the point rather than an optimisation: `frontend.wakes`
	 * is empty on every session that has never armed one, which is nearly all of
	 * them, so `0 wakes armed` would be a line of chrome above nearly every composer
	 * in the app. The assertion is over the shipped component's markup.
	 */
	const noWakes = renderRow({
		frontend: frontend("Ship it"),
		runDetails: detailsWith([], ["pending"]),
	});
	assert.doesNotMatch(noWakes, /data-status-wakes/);
	/*
	 * ...and the same session WITH the goal and the plan still renders, so the
	 * absence above is the wake chip's and not the whole row's.
	 */
	assert.match(noWakes, /data-status-plan/);
	assert.equal(
		renderRow({
			frontend: frontend(""),
			runDetails: deriveRunDetails({ jobs: [], todos: [] }),
		}),
		"",
		"no goal, no plan and no wakes is still the nothing state",
	);
});

test("the wake chip states the model's clause, off the model's own list", () => {
	const one = renderRow({
		frontend: frontend(""),
		runDetails: wakesOf([wireWake("w1", "Check the deploy", HOUR_MS)]),
	});
	assert.match(one, /data-status-wakes/);
	assert.match(one, /1 wake armed/, "the singular, spelled by the model");
	assert.doesNotMatch(one, /1 wakes armed/);

	const two = renderRow({
		frontend: frontend(""),
		runDetails: wakesOf([
			wireWake("w1", "Check the deploy", HOUR_MS),
			wireWake("w2", "Re-read the ledger", 2 * HOUR_MS, HOUR_MS, 3),
		]),
	});
	assert.match(two, /2 wakes armed/);
	/*
	 * The count is the MODEL's, so the clause the chip prints and the clause the
	 * section's tally prints are one string. Asserted as an identity rather than as
	 * two literals that happen to agree today.
	 */
	assert.equal(wakeClause(1), "1 wake armed");
	assert.equal(wakeClause(2), "2 wakes armed");
	assert.ok(one.includes(wakeClause(1)));
	/*
	 * LEADING with the wake's own mark, and not with the plan chip's `Info`: one
	 * glyph in this row means one thing. `AlarmClock` is lucide's alarm glyph; the
	 * assertion is over the rendered class, which is what the glyph arrives with.
	 */
	assert.match(one, /lucide-alarm-clock/);
	assert.doesNotMatch(one, /lucide-info/, "Info stays the plan chip's mark");
});

test("the wake chip names the section its press opens, and never toggles", () => {
	const markup = renderRow({
		frontend: frontend(""),
		runDetails: wakesOf([wireWake("w1", "Check the deploy", HOUR_MS)]),
	});
	assert.match(
		markup,
		/aria-label="Open the wakes in run details — 1 wake armed"/,
	);
	assert.equal(
		wakeChipLabel(1),
		"Open the wakes in run details — 1 wake armed",
		"ONE derived string, so the name and the tooltip cannot disagree",
	);
	/*
	 * It REVEALS, never toggles — `docs/composer-status-tabs.md` § 3.1 and the plan
	 * chip's own recorded reason: a control that closed the pane when pressed while
	 * looking for the wakes is one control with two meanings.
	 */
	assert.doesNotMatch(markup, /data-status-wakes[^>]*aria-pressed/);
	/*
	 * No `data-state` assertion: the button sits inside the shared `Tooltip`'s own
	 * trigger, which stamps its open/closed state on the element it wraps — so the
	 * plan chip carries it too, and it is the tooltip's fact rather than a control's
	 * press state. What must not be here is a PRESSED state, which is what
	 * `aria-pressed` would be.
	 */
});

test("the section renders one row per armed schedule, soonest first", () => {
	const late = wireWake("w2", "Re-read the ledger", 3 * HOUR_MS, HOUR_MS, 3);
	const soon = wireWake("w1", "Check the deploy", HOUR_MS);
	/*
	 * The wire order is the BACKEND's (creation order, `w1`..`w16`), and the row's
	 * order is the due instant's. Handed them reversed, so the assertion is about
	 * the sort and not about the input.
	 */
	const markup = renderWakes({ details: wakesOf([late, soon]) });
	assert.match(markup, />Wakes</);
	assert.ok(
		markup.indexOf('data-run-panel-row="w1"') <
			markup.indexOf('data-run-panel-row="w2"'),
		"the soonest fire leads, whatever order the wire published",
	);
	/*
	 * Each row states what a reader needs to decide whether the wake is what they
	 * intended: when it next fires, how often, and what it will say.
	 */
	assert.match(markup, /Check the deploy/);
	assert.match(
		markup,
		/once/,
		"a schedule with no `every_ms` is a single shot",
	);
	assert.match(markup, /every 1h/);
	assert.match(markup, /· 3 left/, "the limit-bounded form");
});

test("the section's tally is the chip's own clause, and its cap is a statement", () => {
	const two = renderWakes({
		details: wakesOf([
			wireWake("w1", "Check the deploy", HOUR_MS),
			wireWake("w2", "Re-read the ledger", 2 * HOUR_MS, HOUR_MS, 3),
		]),
	});
	assert.ok(
		two.includes(wakeClause(2)),
		"the heading's trailing tally is the same string the chip carries",
	);

	/*
	 * EVERY armed schedule renders, because the wire's own ceiling IS the cap (UX
	 * round 1's U1): at nine the section draws nine rows and no marker, so the
	 * operator's ask — "in there, we can see all the armed wakes" — holds for any
	 * payload a scheduler can actually hold. The marker survives as the footer for a
	 * payload PAST that ceiling, which is why the case below counts seventeen.
	 */
	const many = renderWakes({
		details: wakesOf(
			Array.from({ length: 9 }, (_, index) =>
				wireWake(
					`w${index + 1}`,
					`Wake ${index + 1}`,
					(index + 1) * HOUR_MS,
					HOUR_MS,
				),
			),
		),
	});
	assert.doesNotMatch(many, /more wakes/, "nothing is hidden at nine");
	assert.match(many, /data-run-panel-row="w9"/, "the last of nine renders");
	assert.match(many, /9 wakes armed/, "the tally counts the WHOLE list");
	/*
	 * One row past the wire's ceiling. The marker is a STATEMENT rather than a
	 * control — nothing in this pane can put a shed wake back — so it wears the
	 * shared `Disclosure` primitive's DISABLED branch, which is the plan's own
	 * treatment for its shed rows and not the roster's `Show N more`; and the
	 * section now names who CAN act on the list it just drew (UX round 1's U3).
	 */
	const over = renderWakes({
		details: wakesOf(
			Array.from({ length: 17 }, (_, index) =>
				wireWake(
					`o${index + 1}`,
					`Wake ${index + 1}`,
					(index + 1) * HOUR_MS,
					HOUR_MS,
				),
			),
		),
	});
	// The marker's noun inflects (UX round 2's U7): one hidden row reads `1 more wake`,
	// and the plural is pinned absent so the pair cannot drift back.
	assert.match(over, /1 more wake/);
	assert.doesNotMatch(over, /1 more wakes/);
	assert.match(over, /data-run-panel-row="o16"/);
	assert.doesNotMatch(over, /data-run-panel-row="o17"/, "the cap holds");
	assert.match(
		over,
		/ask the agent to cancel it/i,
		"the list names who can act on it",
	);
});

test("wakes are absent rather than empty: no section without armed wakes", () => {
	/*
	 * A source pin, and the only instrument that can see it: the panel decides
	 * whether the section exists at all, and an empty section is what a `>= 0` gate
	 * would ship — a `Wakes` heading with nothing under it on every session in the
	 * app. The rule is the panel's for every section ("an empty section is not a
	 * state anything renders").
	 */
	const panel = code(SECTION_LIST);
	assert.match(panel, /if \(details\.wakes\.length > 0\) \{/);
	assert.match(
		panel,
		/<RunDetailWakes details=\{details\} sectionRef=\{wakesSectionRef\} \/>/,
	);
	/*
	 * ...and the section is in the panel's fixed order: after the tool jobs and
	 * before the MCP servers, which `docs/run-sidebar.md` § 7.2 fixes as LAST.
	 *
	 * Two comparisons rather than one `||` (agent review round 1's nit 5): the
	 * first version compared against a literal that occurs nowhere in the panel
	 * (`{mcpServers.length > 0 &&`, where the file spells `if (...)`), so that arm
	 * was always false and the assertion passed on its second arm alone. The jobs
	 * half is checked now, which is what the comment beside it always claimed.
	 */
	assert.ok(
		panel.indexOf('key: "jobs"') < panel.indexOf('key: "wakes"'),
		"the wake section comes after the tool jobs",
	);
	assert.ok(
		panel.indexOf('key: "wakes"') < panel.indexOf("if (mcpServers.length > 0)"),
		"the MCP section is still last",
	);
});

test("the wake chip, the pane and the page are ONE derivation", () => {
	/*
	 * The chip counts `runDetails.wakes`, the section renders the same list, and the
	 * page reads the wire ONCE — so a wake armed in the app cannot be a chip on one
	 * surface and not a row in the other. Source pins, because what is being asserted
	 * is that there is no second read of `frontend.wakes` anywhere.
	 */
	const row = code(ROW);
	assert.match(row, /const wakes = runDetails\?\.wakes \?\? \[\];/);
	assert.match(row, /const showWakes = wakes\.length > 0;/);
	assert.match(row, /\{wakeClause\(wakes\.length\)\}/);

	const page = code(CHAT_PAGE);
	assert.match(page, /wakes: canonical\.frontend\.wakes,/);
	/*
	 * The page is the ONLY reader of the wire's field: a second `.wakes` read
	 * anywhere in the renderer is the second source of truth this pins against.
	 */
	assert.equal(
		(page.match(/canonical\.frontend\.wakes/g) ?? []).length,
		1,
		"one read of the wire, threaded into the one derivation",
	);

	/*
	 * And the pane threads a ref for it, in the `Record` whose whole point is that a
	 * fourth `RunPanelSection` member is a TYPE ERROR rather than a silently
	 * mis-scrolled pane (see `run-panel.tsx`).
	 */
	const panelSource = code(PANEL);
	assert.match(
		panelSource,
		/const wakesSectionRef = useRef<HTMLElement \| null>\(null\);/,
	);
	assert.match(panelSource, /wakes: wakesSectionRef,/);
	assert.match(panelSource, /wakesSectionRef=\{wakesSectionRef\}/);
});

test("nothing about the wakes ticks: no clock and no relative time", () => {
	/*
	 * The rule the design record states as a requirement: a wake carries an absolute
	 * local instant and a cadence, and neither is a function of when it is read, so
	 * the section takes the UNTIMED model and there is deliberately no "in 42m"
	 * form — a relative label would have to be repainted to stay true, which is the
	 * 1 Hz reflow `run-details-clock.ts` exists to keep off surfaces that do not
	 * need it.
	 */
	const source = code(WAKES);
	assert.doesNotMatch(
		source,
		/useEffect\(|setInterval|requestAnimationFrame|Date\.now\(\)/,
	);
	assert.doesNotMatch(source, /\bin \$?\{|minutes? from now|in \d+m/);
	/*
	 * ...and the panel hands it the untimed model, beside the plan, rather than the
	 * re-measured one the roster and the jobs list take.
	 */
	assert.match(code(SECTION_LIST), /<RunDetailWakes details=\{details\}/);
});

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

test("the trigger's dot is ONE mark in two inks, and the ink is the whole distinction", () => {
	/*
	 * The header trigger's dot gained a second fact, and this pins the shape of
	 * that: one element, one position, one rule for whether it renders, and the
	 * meaning carried by `bg-danger` against `bg-info` — which is the part no DOM
	 * assertion can see and no still can check twice. The activity term is LIVE
	 * state (`!listOnScreen && openChildren > 0`), never a third ledger, so the
	 * assertion that matters most is the last one: there is no `seen`-set for it.
	 */
	const trigger = code(
		"src/renderer/src/features/chat/components/run-details/run-details-trigger.tsx",
	);
	assert.equal(
		(trigger.match(/data-run-panel-dot=""/g) ?? []).length,
		1,
		"one dot, not one per ledger",
	);
	assert.match(trigger, /aria-hidden=\{true\}\s*data-run-panel-dot=""/);
	assert.match(trigger, /attention \|\| activity/);
	assert.match(trigger, /attention \? "bg-danger" : "bg-info"/);
	assert.match(
		trigger,
		/details !== null && !listOnScreen && details\.openChildren > 0/,
	);
	// The gate is the ledger's own term, which is what keeps this live state: the
	// ink clears the moment the pane paints the list, with nothing to remember.
	assert.match(trigger, /const activity =/);
	assert.doesNotMatch(trigger, /seenActivity|unseenActivity|activitySeen/);
});

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

	/*
	 * One line above 240px of column, a column at or below it — and WRAP above it,
	 * which the row needed the moment it could hold four chips: § 5.4 budgets ~168px
	 * of a 204px content box for one chip, so three of them cannot share a line, and
	 * the chips are `shrink-0`. The stacked arrangement turns wrap OFF in its own
	 * query, because in a COLUMN container `wrap` would wrap items into extra
	 * COLUMNS — horizontal overflow, the defect the wrap exists to remove. Five chips
	 * (the wake chip joined them) make the wrap do the same job one chip earlier; no
	 * geometry here changed with it.
	 */
	tokens("@max-[240px]/chatcol:flex-col");
	tokens("@max-[240px]/chatcol:flex-nowrap");
	tokens('"flex flex-wrap items-start gap-x-2 gap-y-0.5"');
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
	 * applied by the row to whichever chip renders first, so every state the row can
	 * be in shares one left edge. It is ORDINAL now that four chips can render —
	 * each chip asks whether IT is the first one, and the plan chip's own term still
	 * reads the same way it did with two chips.
	 */
	assert.match(source, /const FIRST_CHIP = "-ml-1\.5";/);
	/*
	 * The goal is no longer a chip that ASKS whether it is first: it is the row's
	 * first item whenever it renders, and the cancellation it wears is the same
	 * constant applied under that name. The four count chips ask inside the group
	 * (below), where "first" is a question about the group's own leading edge.
	 */
	assert.match(source, /groupIsFirst \? FIRST_CHIP : undefined/);
	assert.match(source, /loopFirst \? FIRST_CHIP : undefined/);
	assert.match(source, /wakesFirst \? FIRST_CHIP : undefined/);
	assert.match(source, /subagentsFirst \? FIRST_CHIP : undefined/);
	assert.match(source, /jobsFirst \? FIRST_CHIP : undefined/);
	/*
	 * THE GROUP, which is design review round 1's D2: with the count chips as
	 * siblings of the goal, the row's wrap regime tore them — the goal's `flex-1`
	 * box stretched the line it shared and pushed one chip to the right margin while
	 * its siblings started a left column below, and the 172px floor read better than
	 * the 240px band above it. As one item, the row wraps the goal's line and the
	 * counts' line and the chips wrap among themselves, left-aligned, in a column
	 * that cannot hold them.
	 */
	assert.match(
		source,
		/"flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0\.5"/,
	);
	// `min-w-0` and NOT `shrink-0`: the group has to be able to shrink to a narrow
	// column and wrap INSIDE it, which is what keeps the row free of overflow.
	assert.doesNotMatch(
		source,
		/"flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0\.5 shrink-0"/,
	);
	/*
	 * The goal's floor, which is what makes the row wrap the whole group rather than
	 * let the two share a squeezed line: flex resolves line breaking on each item's
	 * hypothetical size, so a floor here is a layout rule and not a nicety.
	 */
	assert.match(source, /min-w-\[140px\] flex-1/);
	assert.doesNotMatch(source, /cn\("min-w-0 flex-1", COLUMN_GOAL\)/);
	/*
	 * The goal's item is the WRAPPER around the disclosure, and the DISMISS is no
	 * longer its second child: the pair the reveal joins — the trigger and its control
	 * — is inside the primitive's own root (`trailing`), because the body is rendered
	 * there too and a wrapper outside the disclosure can hold one of the two and not
	 * the other (design review round 1's D1; the measurement is in § 12.3). The floor
	 * and the column switch stay on the item, and the item is NOT a `group` any more:
	 * the reveal's scope is the trigger's own line, so a pointer on the item's empty
	 * space no longer reveals the control (UX's U5).
	 */
	assert.match(
		source,
		/cn\("flex min-w-\[140px\] flex-1 items-center", COLUMN_GOAL\)/,
	);
	assert.doesNotMatch(
		source,
		/"group flex min-w-\[140px\]/,
		"the item is not the reveal's group: the trigger's own line is, so the ✕ cannot be revealed from the item's empty space",
	);
	assert.match(source, /trailing=\{/);
	assert.match(source, /className=\{cn\("min-w-0 flex-1"\)\}/);
	/*
	 * The first-chip chain, which had to grow an item: the loop chip is the second
	 * ITEM on the row (its own chip plus its dismiss, one wrapper), so the count group
	 * is first only when neither the goal nor the loop rendered. Six chips, five
	 * items, and the group's own leading chip is still decided inside the group.
	 */
	assert.match(source, /const loopFirst = !showGoal;/);
	assert.match(source, /const groupIsFirst = !showGoal && !showLoop;/);
	assert.match(source, /const wakesFirst = groupIsFirst && !showPlan;/);
	assert.match(source, /const subagentsFirst = wakesFirst && !showWakes;/);
	assert.match(source, /const jobsFirst = subagentsFirst && !children;/);

	/*
	 * The two MEASURED overrides, byte-exact, because the numbers are the finding:
	 * without `max-w-full` the chip resolves to its content's max-content width
	 * (2026px inside an 868px item) and paints over the count with the snippet
	 * un-truncated; without `h-6 py-0` the two chips of one row differ by 1.7px
	 * (25.7px beside 24px).
	 */
	assert.match(source, /"w-fit max-w-full min-w-0 text-ink-muted/);
	assert.match(source, /rowClassName=\{cn\("h-6 rounded-sm px-1\.5 py-0"\)\}/);

	// The shared horizontal inset is the alert's own, not a second number.
	tokens("isSmallView ?", '"px-2 pb-1"', '"px-4 pb-2"', "CHAT_MEASURE");
	/*
	 * The plan chip — and now the two dismiss controls — are the readings' own
	 * control box, IMPORTED rather than restated: two chips over one box with two
	 * class strings is how two hover grounds and two focus offsets arrive. The loop
	 * chip is the same story one box over, on the INERT form (`READING_LABEL as
	 * CHIP_READOUT`): a readout is not a control, and the difference between them is
	 * the ink role and the cursor rather than a second box.
	 */
	assert.match(
		source,
		/READING_BUTTON as CHIP_CONTROL,[\s\S]*?READING_LABEL as CHIP_READOUT,[\s\S]*?} from "\.\.\/session-status\/session-status-strip"/,
	);
	tokens("CHIP_CONTROL", "CHIP_READOUT");
	assert.doesNotMatch(source, /bg-surface|border-control|bg-elevated/);
	/*
	 * The count's visible affordance mark (design review round 1, D1): the run
	 * pane's own glyph, leading the count, decorative to assistive tech because the
	 * accessible name already states the action.
	 */
	tokens(
		"import { AlarmClock, Info, Repeat, X } from",
		"<Info aria-hidden={true}",
		"size-3.5",
	);
	/*
	 * ...and the wake chip leads with `AlarmClock` in the same call, from the same
	 * import: a mark on the third count chip that is a WAKE's rather than the plan's,
	 * because `Info` means "this opens the run pane" on one chip and one glyph in this
	 * row means one thing.
	 */
	tokens("<AlarmClock", "size-3.5 shrink-0");
	/*
	 * The two ACTIVITY chips lead with the roster's state mark instead, taken from
	 * the component that already owns the nine states' glyphs, inks and motion —
	 * imported, so there is no second table for a state to lose its mark in. `Info`
	 * stays the plan chip's alone: one glyph in this row still means one thing.
	 */
	assert.match(
		source,
		/import { SubagentStateIcon } from "\.\/run-details\/run-detail-row-parts"/,
	);
	assert.match(source, /<SubagentStateIcon status={children\.mark} \/>/);
	assert.match(source, /<SubagentStateIcon status={jobs\.mark} \/>/);
	assert.match(
		source,
		/const children = runDetails \? activityTally\(runDetails\.subagents\) : null;/,
	);
	assert.match(
		source,
		/const jobs = runDetails \? activityTally\(runDetails\.jobs\) : null;/,
	);
	/*
	 * The counts are the MODEL's, and nothing here tallies: these two clauses are the
	 * same functions the trigger's tooltip prints, and the numbers are the model's
	 * own fields.
	 */
	assert.match(source, /childClause\(children\)/);
	assert.match(source, /jobClause\(jobs\)/);
	/*
	 * And the clause cannot be handed a bare number, which is what makes the D1
	 * defect unrepeatable rather than merely fixed: there is no `count`-shaped
	 * argument in the row at all, so a sentence built here has a state by
	 * construction.
	 */
	assert.doesNotMatch(source, /childClause\(runDetails\./);
	assert.doesNotMatch(source, /jobClause\(runDetails\./);
	/*
	 * And nothing here counts: no filtering to an open slice and no length turned
	 * into a number. The row chooses which of the model's functions to print, which
	 * is the rule the plan chip already follows. The row's ONE status comparison USED
	 * to be the loop chip's own predicate; it is now the shared `loopIsRunning`
	 * (`pickers/session-commands.ts`), which the row imports rather than restating —
	 * so the line here is ZERO (agent review round 1, MINOR 1 required exactly that:
	 * one definition, in one module, read by the row and the `/loop` picker alike). A
	 * status vocabulary that creeps back into this file has to be argued for.
	 */
	assert.doesNotMatch(source, /\.filter\(/);
	assert.equal(
		(source.match(/=== "(running|judging)"/g) ?? []).length,
		0,
		"the row restates no status vocabulary: it reads the shared predicate",
	);
	assert.match(source, /loopIsRunning/);
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

/*
 * The wake chip files the WAKES request, and the store test above cannot see it
 * (agent review round 1's minor 2): driving `revealRunPanelSection` proves the
 * STORE can hold "wakes", not that the chip asks for it, so a chip wired to
 * `revealPlan("jobs")` — the one mistake this chip can make that a user notices
 * immediately — would pass the whole suite. This is the plan chip's own pin, one
 * chip over, and it is the assertion the PR's coverage claim rests on.
 */
test("the wake chip files the wakes section, not its nearest neighbour", () => {
	const source = code(ROW);
	assert.match(source, /onClick=\{\(\) => revealPlan\("wakes"\)\}/);
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
	assert.match(source, /scrollRegionToTop\(region, target\)/);
	/*
	 * And NOT `scrollIntoView`, which is the whole point of the change: its default
	 * `container: "all"` walks every scrolling ancestor, and in this layout the chat
	 * column's slot row is scrollable at the widths where the pane does not fit
	 * beside the column — measured 108px of slide at 1024x673 and 221px at 800x600,
	 * with this branch adding two more triggers for it (agent review round 1, M1).
	 * The helper assigns the region's own `scrollTop` instead
	 * (`shared/lib/scroll.ts`). Pinned as an ABSENCE as well as a presence, because
	 * the defect is one call away from returning.
	 */
	assert.doesNotMatch(source, /scrollIntoView/);
	assert.match(source, /const region = bodyRef\.current;/);
	assert.match(source, /ref=\{bodyRef\}/);
	/*
	 * The target is resolved through a SECTION→REF map rather than a chain of
	 * ternaries (agent review round 1, m2): as a chain the last arm was a catch-all,
	 * so a fourth `RunPanelSection` member would have compiled and silently scrolled
	 * the JOBS section for a destination that has none. A `Record` over the union
	 * makes that omission a type error, which is the guarantee this case is here for.
	 */
	assert.match(
		source,
		/const sectionRefs: Record<\s*RunPanelSection,\s*RefObject<HTMLElement \| null>\s*> = \{/,
	);
	assert.match(
		source,
		/const target = sectionRefs\[revealRequest\.section\]\.current;/,
	);
	assert.match(source, /todos: todosSectionRef,/);
	assert.match(source, /subagents: subagentsSectionRef,/);
	assert.match(source, /jobs: jobsSectionRef,/);
	assert.doesNotMatch(source, /revealRequest\.section === /);
	assert.match(
		source,
		/const todosSectionRef = useRef<HTMLElement \| null>\(null\);/,
	);
	assert.match(
		source,
		/const subagentsSectionRef = useRef<HTMLElement \| null>\(null\);/,
	);
	assert.match(
		source,
		/const jobsSectionRef = useRef<HTMLElement \| null>\(null\);/,
	);
	assert.match(source, /subagentsSectionRef=\{subagentsSectionRef\}/);
	assert.match(source, /jobsSectionRef=\{jobsSectionRef\}/);
	assert.match(source, /clearReveal\(revealRequest\.nonce\)/);
	assert.match(
		source,
		/useUiPreferencesStore\(\(state\) => state\.runPanelReveal\)/,
	);
	// Focus is never taken: no `.focus()` on this path, and no `scroll-behavior`
	// animation either.
	/*
	 * Focus is never taken and nothing animates, and both are read off the REVEAL
	 * ITSELF rather than off the file: this pane restores focus on its own Escape
	 * ladder (`:265`), so a file-wide absence assertion would either fail or, worse,
	 * be written loosely enough to pass while the reveal did move focus.
	 */
	const reveal = source.slice(
		source.indexOf("const sectionRefs"),
		source.indexOf("clearReveal(revealRequest.nonce)"),
	);
	assert.doesNotMatch(reveal, /\.focus\(/, "focus is never taken by a reveal");
	assert.doesNotMatch(reveal, /behavior/, "a reveal never animates the scroll");
	/*
	 * Focus is never taken and the move is never animated: `branding.md` § 5
	 * reserves motion for entrances, and a pane that glided its own reading
	 * position under someone already reading would move the text they are on. What
	 * is left to pin here is the smooth-scroll spelling that would not need
	 * `scrollIntoView` at all — `scroll-behavior: smooth` on the region, or a
	 * `behavior: "smooth"` option. The assertion that named
	 * `scrollIntoView({ block: "start", behavior… })` was dead weight once the ban
	 * above went in (round 1, N2): it could never fire.
	 */
	assert.doesNotMatch(source, /smooth/);
});

test("the escape ladder accepts the chip, which is a third way in", () => {
	const source = code(PANEL);
	/*
	 * Three controls open this pane: the header trigger, the composer's plan chip
	 * (the reveal path this change is about) and anything inside the pane. The
	 * ladder's guard named two of them, so the user who opened the pane the way
	 * this flow opens it had no `Escape` out of it at all (round 1, U2) — measured
	 * with the chip's own close control off-screen at 1024x673 in the round's
	 * frames. The composer's own `Escape` is untouched: the chip is a button in the
	 * status row, not the textarea that owns that key.
	 */
	assert.match(source, /closest\("\[data-status-plan\]"\)/);
	assert.match(source, /const mine = fromTrigger \|\| fromChip \|\| inPane;/);
});

test("the pane's floor is its contract minimum, not the user's preference", () => {
	const content = code(CONTENT);
	/*
	 * A preference pinned as a floor is not a floor: the pane asked for 420 and
	 * refused to render narrower, so at any window the row could not host 420 the
	 * pane's right edge - its close control and its scrollbar - sat past the window
	 * with the row's `overflow-hidden` hiding the difference (116px at 1024x673 with
	 * the rail expanded, 340px at the app's 800x600 floor; round 1, D1/U1). The fix
	 * is the canvas dock's own rule from this file, applied to this slot: the
	 * preference is the `width`, the rendered box has NO floor (`minWidth: 0`, which
	 * is also what lets a flex item shrink below its content minimum), and the 320
	 * stays where it belongs - as the divider's drag floor.
	 *
	 * Round 2 (U6) added the other half of that rule, because a drag floor the pane
	 * cannot render is a floor that lies: with the wrapper floored at 0, the pane
	 * renders `min(preference, what the row leaves)`, so a drag in a row that could
	 * not host the preference moved a stored number while the pane stood still. The
	 * divider's value is now the MEASURED width and its floor is the 320 only when
	 * the row can host it - otherwise the range collapses onto the drawn width and a
	 * write is refused (measured: seven real drags moved the preference 420 -> 360 ->
	 * 320 -> 440 -> 640 while the pane stayed 303px and the separator never moved).
	 */
	assert.match(content, /const RUN_PANEL_MIN_PX = 320;/);
	assert.match(
		content,
		/minWidth=\{\s*runPanelResizable \? RUN_PANEL_MIN_PX : runPanelDividerValue,?\s*\}/,
	);
	assert.match(content, /sidebarWidth=\{runPanelDividerValue\}/);
	assert.match(content, /minWidth: 0,/);
	assert.doesNotMatch(content, /minWidth: effectiveRunPanelWidth/);
	/*
	 * And the pane's width-derived layout (`tallyBudget`) is handed the width the
	 * pane is DRAWN at, measured on the wrapper, not the preference it asked for:
	 * a shrunk pane budgeted against 420 sheds for a width it does not have and
	 * truncates at the width it does.
	 */
	assert.match(content, /paneWidth=\{renderedRunPanelWidth\}/);
	assert.match(content, /new ResizeObserver\(measure\)/);
});

test("the reveal moves ONE region, and its arithmetic is the region's own", () => {
	/*
	 * `scrollRegionToTop` is pinned as arithmetic rather than only as a call site
	 * (agent review round 1, M1). The defect it exists to delete is a reveal that
	 * moved the FRAME: `scrollIntoView`'s `container: "all"` default walks every
	 * scrolling ancestor, and this layout's chat-column slot row is scrollable at the
	 * widths where the pane does not fit beside the column, so the assertion that
	 * matters is that the function touches exactly one element's `scrollTop` and
	 * derives the offset from rects.
	 *
	 * The fakes MODEL the scroll rather than pinning a rect: a target's viewport
	 * position is a function of where the region is scrolled to, and that is the
	 * whole reason the assignment is idempotent. A region whose border box starts at
	 * y=100 with 10px of border, holding a target 760px into its scroll content:
	 *
	 *   target viewport top = 100 + 10 + (760 - scrollTop)
	 *   offset = scrollTop + targetTop - regionTop - clientTop = 760
	 *
	 * which is the target's own position in the content — the section landing at the
	 * region's head, whatever the region's scroll position was when the press
	 * arrived.
	 */
	const region = {
		scrollTop: 120,
		clientTop: 10,
		getBoundingClientRect: () => ({ top: 100 }),
	};
	const target = {
		getBoundingClientRect: () => ({ top: 870 - region.scrollTop }),
	};
	scrollRegionToTop(region, target);
	assert.equal(region.scrollTop, 760);

	/*
	 * IDEMPOTENT, and this is the assertion that makes the comment above a property:
	 * calling it again lands the same section at the head instead of adding the
	 * offset twice, which matters because a re-mounted request re-runs this effect.
	 */
	scrollRegionToTop(region, target);
	assert.equal(region.scrollTop, 760);

	// A target above the region's own scroll origin never sends the region negative.
	region.scrollTop = 120;
	target.getBoundingClientRect = () => ({ top: -50 });
	scrollRegionToTop(region, target);
	assert.equal(region.scrollTop, 0);
});

/**
 * The shipped row in a DOM, beside the textarea the composer owns.
 *
 * `jsdom` is a devDependency this repo already renders shipped components with
 * (`suggestion-stack-react.test.mjs`), and `react-dom/client` is imported AFTER
 * the globals exist because it feature-detects `document` at import time.
 * `cleanup` restores every global it replaced, so the server-rendering tests in
 * this file are unaffected by the order they run in.
 */
async function rowInDom() {
	const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
	const { window } = dom;
	const originals = new Map();
	/** Every observer the mounted tree registered, in registration order. */
	const observers = [];
	/** Frames queued by the shim below, in request order. */
	const frames = [];
	const shims = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
		navigator: window.navigator,
		// The row's own reveal bus dispatches on `document`, and an `Event` built
		// from Node's global is a different realm's object: jsdom's
		// `dispatchEvent` refuses it ("parameter 1 is not of type 'Event'").
		Event: window.Event,
		CustomEvent: window.CustomEvent,
		// Radix measures its tooltip content through the global, not through
		// `window.`: unbound, the call is a ReferenceError inside a portal rather
		// than a skipped measurement.
		getComputedStyle: window.getComputedStyle.bind(window),
		// Floating UI (Radix's tooltip positioning) reaches for these globals by
		// name, not through `window.`, as soon as a tooltip's trigger mounts.
		Element: window.Element,
		SVGElement: window.SVGElement,
		MouseEvent: window.MouseEvent,
		KeyboardEvent: window.KeyboardEvent,
		FocusEvent: window.FocusEvent,
		// Deliberately NOT jsdom's own: with `pretendToBeVisual` its rAF is a
		// real frame loop, and floating-ui's `autoUpdate` keeps one running for as
		// long as a trigger is mounted — which leaves the process with a pending
		// frame forever and node:test never exits. The callbacks are QUEUED rather
		// than dropped, so a test can fire one frame on demand (the toast channel
		// schedules its own dismissal in a rAF, which is otherwise invisible here)
		// while nothing runs unless a test asks for it.
		requestAnimationFrame: (callback) => frames.push(callback),
		cancelAnimationFrame: () => {},
		IS_REACT_ACT_ENVIRONMENT: true,
		// Radix's tooltip only measures when it opens, but the shim costs nothing
		// and its absence is a crash deep inside a portal rather than a skip.
		/*
		 * The observer RECORDS its callbacks rather than dropping them, because the
		 * row's own fit rule measures through one (`itemFits`, QA round 2's Q4) and a
		 * shim that swallowed the callback would make that rule untestable in the one
		 * instrument that drives the shipped component. `resize()` fires the callbacks
		 * that observed a matching box, which is what a column change does in a browser.
		 * The Radix tooltips' own observers land in the same list and are left alone:
		 * they are only registered while a tooltip is open, and this file's tooltips are
		 * never opened.
		 *
		 * RECORDED, NOT FIXED (agent review round 3, MINOR 2): `disconnect()` below is a
		 * NO-OP, so an observer a component discarded is still driven by `resize()`. A
		 * faithful shim would drop the entry on `disconnect()` and leave only the live
		 * observer in the list. It is left as it is because the difference is not
		 * invisible to this file's own drives and changing it would silently re-point
		 * assertions written against today's behaviour: the rule's effect re-registers on
		 * every dependency change, so several superseded closures can answer one
		 * `resize()`, each with the `itemFits` its own render captured. Every drive below
		 * that depends on a re-measure therefore changes ONE dependency at a time, which
		 * keeps the stale entries in agreement with the live one; a future test that
		 * re-arms `itemFits` and drives `resize()` in the same step should fix the shim
		 * first rather than write around it.
		 */
		ResizeObserver: class {
			constructor(callback) {
				observers.push({ callback, targets: [] });
			}
			observe(target) {
				observers[observers.length - 1].targets.push(target);
			}
			unobserve() {}
			disconnect() {}
		},
	};
	for (const [key, value] of Object.entries(shims)) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(window.document.getElementById("root"));
	return {
		window,
		root,
		/** Run every frame the mounted tree has requested since the last one. */
		frame() {
			for (const callback of frames.splice(0)) callback(0);
		},
		/** Fire the observers that observed a box matching `selector`. */
		resize(selector) {
			for (const entry of observers) {
				if (
					entry.targets.some((target) => target.matches?.(selector) === true)
				) {
					entry.callback([]);
				}
			}
		},
		cleanup() {
			root.unmount();
			window.close();
			for (const [key, descriptor] of originals) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else delete globalThis[key];
			}
		},
	};
}

test("the refocus answers for the focused NODE, not for a chip count", () => {
	/*
	 * UX round 1's U1, observed live: `active=BUTTON/jobs` then `active=BODY/None`
	 * when the last running row settles. The row cannot restore focus itself — the
	 * composer's textarea is the parent's ref — so the parent passes the target in.
	 *
	 * AGENT REVIEW ROUND 2, m2, IS THE CASE A COUNT CANNOT SEE: `frontend.jobs` is
	 * polled, so a running job settling while a child starts moves the row 1 -> 1,
	 * the focused chip unmounts, and a count that never moved stays silent. The
	 * predicate is therefore about the node, and there is no count left in this
	 * path to be wrong about.
	 */
	const row = code(ROW);
	assert.match(
		row,
		/shouldRestoreComposerFocus\(\s*previouslyFocused\.current,\s*focusedInRow !== null,?\s*\)/,
	);
	// The remembered thing is the NODE, and it is dropped whenever the row stops
	// holding focus — which is what keeps the refocus conditional rather than a
	// magnet that pulls focus out of a transcript mid-sentence.
	assert.match(row, /previouslyFocused\.current = focusedInRow;/);
	assert.match(row, /rowRef\.current\?\.contains\(active\) === true/);
	// The prop is optional, so a story that renders the row alone need not
	// invent a focus target.
	assert.match(row, /onFocusComposer\?: \(\) => void;/);

	const composer = code(MESSAGE_INPUT);
	assert.match(
		composer,
		/onFocusComposer=\{\(\) => textareaRef\.current\?\.focus\(\)\}/,
	);

	/*
	 * The predicate's truth table, over the two facts the effect reads — exported
	 * so this half needs no renderer. An element that is still connected means the
	 * user is on a control that still exists; a row that still holds focus means
	 * they are on another control in it. Neither may move focus, and the swap is
	 * the first row of the table rather than a special case: it takes no count.
	 */
	assert.equal(
		shouldRestoreComposerFocus({ isConnected: false }, false),
		true,
		"the node is gone and the row lost focus: hand it back",
	);
	assert.equal(
		shouldRestoreComposerFocus(null, false),
		false,
		"nothing was focused here",
	);
	assert.equal(
		shouldRestoreComposerFocus({ isConnected: true }, false),
		false,
		"the node survives",
	);
	assert.equal(
		shouldRestoreComposerFocus({ isConnected: true }, true),
		false,
		"still in the row",
	);
	assert.equal(
		shouldRestoreComposerFocus({ isConnected: false }, true),
		false,
		"the row still holds it",
	);
});

test("the shipped row hands focus back on a same-count swap, driven", async () => {
	/*
	 * The driven half, on the SHIPPED component in a DOM, because m2 is about what
	 * a render does and a shape pin cannot say it. `jsdom` is a devDependency this
	 * repo already renders shipped components with (`suggestion-stack-react.test.mjs`).
	 *
	 * `document.activeElement` IS STUBBED, and that is the one thing this test
	 * fakes: focusing a Radix tooltip trigger in jsdom starts the popper's own loop,
	 * and every `act()` that follows then takes between thirty seconds and a minute
	 * (measured, with and without an rAF shim) — a cost no per-commit suite can pay
	 * for one assertion. The stub replaces exactly the platform read the effect
	 * makes; the render, the unmount, the chip's detachment, the effect and the
	 * parent's callback are all real, and the final assertion drops the stub and
	 * reads the browser's own `activeElement`, so the focus the callback asks for is
	 * observed and not assumed.
	 */
	const { window: dom, root, cleanup } = await rowInDom();
	/*
	 * Radix's tooltip provider settles a state update after a render returns, so
	 * React prints its own "not wrapped in act" notice. It is harness noise rather
	 * than evidence about the row, so it is collected and asserted to be exactly
	 * that — anything else React reports still fails this test.
	 */
	const quiet = [];
	const realError = console.error;
	console.error = (...args) => void quiet.push(String(args[0]));
	try {
		const h = createElement;
		let refocuses = 0;
		const composerField = () => dom.document.getElementById("composer");
		const element = (jobs) =>
			h(
				"div",
				null,
				h(ComposerStatusRow, {
					frontend: frontend(""),
					runDetails: detailsWith(jobs),
					onFocusComposer: () => {
						refocuses += 1;
						composerField().focus();
					},
				}),
				h("textarea", { id: "composer", readOnly: true }),
			);
		const running = () => [wireJob("s1", "bash", "running", "bash: sleep 60")];
		const delegate = () => [
			wireJob("c1", "task", "running", "Draft the summary"),
		];

		/*
		 * The stub is an OWN property so it shadows the prototype's getter, and the
		 * real one is kept to put back: `delete` is a lint error in this tree, and
		 * re-defining with the platform's own descriptor is what it was doing anyway.
		 */
		const realActiveElement = Object.getOwnPropertyDescriptor(
			dom.window.Document.prototype,
			"activeElement",
		);
		let active = null;
		Object.defineProperty(dom.document, "activeElement", {
			configurable: true,
			get: () => active,
		});

		await act(async () => void root.render(element(running())));
		const chip = dom.document.querySelector("[data-status-jobs]");
		assert.ok(chip, "a running tool job draws the jobs chip");

		// One tick with unchanged props is what records the focused control, the way
		// a press renders in the app.
		active = chip;
		await act(async () => void root.render(element(running())));
		assert.equal(refocuses, 0, "nothing is owed while the focused chip lives");

		/*
		 * THE SWAP, AT AN UNCHANGED COUNT — asserted here rather than grepped out of
		 * the component's source (round 3's m1'): the retired predicate compared a
		 * chip COUNT across commits, so the fact this case turns on is that the count
		 * does NOT move while the chip under the cursor does. A DOM count before and
		 * after is that fact; a regex over the component's text was only ever a proxy
		 * for it, and a proxy a comment naming the retired count would fail.
		 */
		const chips = () =>
			dom.document.querySelectorAll(
				"[data-status-subagents], [data-status-jobs]",
			).length;
		assert.equal(chips(), 1, "one activity chip before the swap");
		active = dom.document.body;
		await act(async () => void root.render(element(delegate())));
		assert.equal(chips(), 1, "and one after it: the count did not move");
		assert.ok(
			!dom.document.body.contains(chip),
			"the focused chip really unmounted, so this is the swap and not a reuse",
		);
		assert.equal(refocuses, 1, "the same-count swap hands focus back");
		Object.defineProperty(dom.document, "activeElement", realActiveElement);
		assert.equal(
			dom.document.activeElement,
			composerField(),
			"and the focus the callback asked for is the browser's own",
		);

		// The control: the focused chip STAYS while the one beside it goes, so the
		// row still holds focus and nothing may move.
		Object.defineProperty(dom.document, "activeElement", {
			configurable: true,
			get: () => active,
		});
		await act(
			async () => void root.render(element([...delegate(), ...running()])),
		);
		const held = dom.document.querySelector("[data-status-jobs]");
		active = held;
		await act(
			async () => void root.render(element([...delegate(), ...running()])),
		);
		assert.equal(refocuses, 1, "the row holds focus to begin with");
		active = composerField();
		await act(
			async () => void root.render(element([...delegate(), ...running()])),
		);
		assert.ok(
			dom.document.querySelector("[data-status-jobs]") === held,
			"the focused chip is the survivor of the two, so the node under test is real",
		);
		await act(async () => void root.render(element(running())));
		assert.equal(
			refocuses,
			1,
			"the chip beside the focused one went, and the row still holds focus",
		);

		/*
		 * The last control, and round 3's n2 is about what it actually pins: the
		 * USER IS IN THE COMPOSER. The remembered node is dropped the moment focus
		 * leaves the row, so a chip unmounting after that pulls nothing — which is the
		 * half that keeps every settle in a session where someone is typing from
		 * yanking them into the composer. The wire MOVES under it (one activity chip
		 * leaves), so the control is about where focus is and not about nothing
		 * happening.
		 */
		active = composerField();
		await act(async () => void root.render(element(running())));
		await act(async () => void root.render(element(delegate())));
		assert.equal(
			refocuses,
			1,
			"a chip unmounting while the user is in the composer pulls nothing",
		);
	} finally {
		console.error = realError;
		cleanup();
	}
	assert.ok(
		quiet.every((message) => message.includes("not wrapped in act")),
		`React reported something the harness does not expect: ${quiet.join(" | ")}`,
	);
});

test("each section is the node its own request resolves to", () => {
	const dir = "src/renderer/src/features/chat/components/run-details/";
	const todos = code(`${dir}run-detail-todos.tsx`);
	assert.match(todos, /<section ref=\{sectionRef\}/);
	const subagents = code(`${dir}run-detail-subagents.tsx`);
	assert.match(subagents, /<section ref=\{sectionRef\}/);
	const jobs = code(`${dir}run-detail-jobs.tsx`);
	assert.match(jobs, /<section ref=\{sectionRef\}/);
	const panel = code(`${dir}run-details-panel.tsx`);
	assert.match(panel, /sectionRef=\{todosSectionRef\}/);
	assert.match(panel, /todosSectionRef\?: Ref<HTMLElement>/);
	assert.match(panel, /sectionRef=\{subagentsSectionRef\}/);
	assert.match(panel, /subagentsSectionRef\?: Ref<HTMLElement>/);
	assert.match(panel, /sectionRef=\{jobsSectionRef\}/);
	assert.match(panel, /jobsSectionRef\?: Ref<HTMLElement>/);
});

test("the Jobs section draws the partition's rows, and nothing in it is pressable", () => {
	/*
	 * The section the jobs chip points at, and the reason it has to exist at all: the
	 * roster is a filter on `task`, so a chip pointing there would open a section
	 * that cannot show its own rows.
	 */
	const jobs = code(
		"src/renderer/src/features/chat/components/run-details/run-detail-jobs.tsx",
	);
	/*
	 * The slice is the MODEL's predicate, not a local status comparison, so the
	 * section and `openJobs` — the chip's number and the panel's gate — cannot come
	 * to different answers about which rows are still running.
	 */
	assert.match(jobs, /details\.jobs\.filter\(isOpenRow\)/);
	/*
	 * A QUIET row: an `li` with the shared row body and no control of any kind. A
	 * tool row has no `session_id`, so `childOpenable` is false for every one of
	 * them and there is no reader to open — a lit row that opens nothing is worse
	 * than a quiet one.
	 */
	assert.match(jobs, /<li[\s\S]*?data-run-panel-row=\{row\.id\}/);
	assert.match(jobs, /<SubagentRowBody row=\{row\} \/>/);
	assert.doesNotMatch(jobs, /<button/);
	assert.doesNotMatch(jobs, /onClick/);
	assert.doesNotMatch(jobs, /childOpenable/);
	assert.doesNotMatch(jobs, /use-child-transcript/);
	/*
	 * And the row body itself is ONE component now, shared with the roster, so the
	 * two lists cannot come to two row heights (`run-detail-row-parts.tsx`).
	 *
	 * Written across lines rather than on one: the row gained a `trailing` slot
	 * for the subagent-count mark (design review round 1's D2), and a one-line
	 * form with the three props `printWidth` allows is what the previous pin
	 * assumed — this asserts the SHAPE the intent needs (one shared body, the
	 * detail line passed as a prop) rather than one printer's output.
	 */
	const roster = code(
		"src/renderer/src/features/chat/components/run-details/run-detail-subagents.tsx",
	);
	assert.match(
		roster,
		/<SubagentRowBody\s+[\s\S]*?row=\{row\}[\s\S]*?detail=\{<DetailLine row=\{row\} \/>\}/,
	);
});

/* ---------------------------------------------------------------- */
/* The loop chip, and the row's two dismiss controls                 */
/* ---------------------------------------------------------------- */

/*
 * `docs/composer-status-tabs.md` § 12-13. Three instruments, on the file's own
 * division of labour: markup for what renders and what it says, the exported
 * derivations for the copy's own truth table, and a DRIVEN press for the one
 * claim no shape can make — that pressing a dismiss runs the owner's command,
 * with the flag the affordance's own word promises, and leaves the disclosure it
 * sits beside untouched.
 *
 * What none of these can see is the REVEAL: `:hover` and `:focus-within` are
 * browser state, and jsdom evaluates neither. So the classes that carry it are
 * asserted here as strings and the pixels are asserted in the frames
 * (`docs/evidence/composer-status-clear/goal-tab-revealed/` and `…/loop-tab-revealed/`
 * — the change's OWN set, not the swept set next door, which has none of these
 * states), which is this repo's rule for every other hover claim. What those frames
 * show is stated in that set's README and not here: the reveal on them is the
 * FOCUS-within path, because the `browser` tool has no hover verb — and it is the
 * same class string this file asserts, which the parity test below keeps true.
 */

test("a session with no loop renders no loop chip, and an idle loop is the same absence", () => {
	// Absent: the wire omits the field on a session that has never run a loop.
	const absent = renderRow({
		frontend: frontendWith({ goal: "Ship it" }),
		runDetails: null,
	});
	assert.doesNotMatch(absent, /data-status-loop/);
	/*
	 * Idle: the loop ran and was cleared, or never started on this connection. The
	 * row renders NOTHING for a session with an idle loop and no goal — the same
	 * branch, and the reason the gate is the status rather than the field's
	 * presence.
	 */
	const idle = renderRow({
		frontend: frontendWith({ goal: "", loop: wireLoop("idle") }),
		runDetails: null,
	});
	assert.equal(idle, "");
});

test("the loop chip states the wire's own status word, with the progress the wire carries", () => {
	/*
	 * The clause's truth table, over the exported derivation, because the chip's own
	 * sentence is the claim and a markup match would only be a second reading of it.
	 */
	assert.equal(
		loopClause(wireLoop("running", { completed: 2, iterations: 5 })),
		"running, 2 of 5 turns",
	);
	assert.equal(
		loopClause(wireLoop("running", { completed: 3 })),
		"running, 3 turns",
	);
	assert.equal(
		loopClause(wireLoop("running", { completed: 1 })),
		"running, 1 turn",
	);
	/*
	 * `judging` carries no count at all, deliberately: the judge is deciding the turn
	 * that just ended, so `completed` has already moved and a number beside the word
	 * would be a figure the reader cannot date.
	 */
	assert.equal(
		loopClause(wireLoop("judging", { completed: 4, iterations: 5 })),
		"judging",
	);
	/*
	 * The settled states print the wire's word and nothing else: they are the same
	 * vocabulary the picker's own `Status` row prints, and a prettier word here would
	 * be a second vocabulary for one fact.
	 */
	for (const status of [
		"achieved",
		"completed",
		"cancelled",
		"interrupted",
		"failed",
	]) {
		assert.equal(loopClause(wireLoop(status)), status);
	}
});

test("the loop's clause is one text flow, so the readings' gap cannot land inside it", () => {
	/*
	 * QA round 1's Q2, from the real app's own frames: the row painted `Loop:
	 * running , 1 of 25 turns`. The readout's box carries the readings' `gap-1.5`, the
	 * progress was its own FLEX ITEM, and the gap therefore landed between the status
	 * word and its own comma — while `textContent` stayed clean, which is why no
	 * assertion on the string could see it and why the clause's own unit test above
	 * passed throughout. The progress is INSIDE the label's span now: one text flow,
	 * still its own node (the stacked band has to be able to drop it) and no longer
	 * its own flex item.
	 */
	const markup = renderRow({
		frontend: frontendWith({
			goal: "Ship it",
			loop: wireLoop("running", { completed: 2, iterations: 5 }),
		}),
		runDetails: null,
	});
	assert.match(
		markup,
		/Loop: running<span class="[^"]*">, 2 of 5 turns<\/span><\/span>/,
	);
});

test("the loop's affordance is the state's own: Stop while it moves, Clear once it settles", () => {
	/*
	 * `args` is the ARGUMENT the press sends, and `null` on the settled half is the
	 * claim that the settled press sends NOTHING — there is no released spelling that
	 * clears a settled loop, and both spellings the companion adds start a loop on a
	 * backend that does not know them. The word and the argument are asserted together
	 * because they are one decision: a second derivation could print `Stop loop` and
	 * send a clear.
	 */
	assert.deepEqual(loopAffordance(wireLoop("running")), {
		text: "Stop loop",
		args: "stop",
		failure: "Could not stop the loop",
	});
	assert.deepEqual(loopAffordance(wireLoop("judging")), {
		text: "Stop loop",
		args: "stop",
		failure: "Could not stop the loop",
	});
	for (const status of [
		"achieved",
		"completed",
		"cancelled",
		"interrupted",
		"failed",
	]) {
		assert.deepEqual(
			loopAffordance(wireLoop(status)),
			{
				text: "Clear loop",
				args: null,
				failure: "Could not clear the loop",
			},
			`${status} is settled, so it is cleared rather than stopped`,
		);
	}
	/*
	 * The BOUNDARY, stated as a case: the running set is the wire's own two words,
	 * and a status this build cannot read is not claimed to be moving. Clearing is
	 * the command that is safe on a state the row does not recognise; offering
	 * `Stop` on one would be a claim the row cannot check.
	 */
	assert.equal(loopIsRunning("idle"), false);
	assert.equal(loopIsRunning("paused"), false);
});

test("the two dismisses are named with the action first and the value it will throw away", () => {
	// ONE derived string per control, for the tooltip AND the accessible name, and
	// the control's own printed word leads it — so the name a screen reader
	// announces contains what the control says (WCAG 2.5.3).
	assert.equal(goalClearLabel("Ship it"), "Clear goal — Ship it");
	assert.equal(
		loopActionLabel(wireLoop("running", { completed: 2, iterations: 5 })),
		"Stop loop — running, 2 of 5 turns",
	);
	assert.equal(
		loopActionLabel(wireLoop("failed", { completed: 4 })),
		"Clear loop — failed",
	);
});

test("the goal chip carries a dismiss that says which goal it clears", () => {
	const markup = renderRow({
		frontend: frontend("Reconcile the March invoices"),
		runDetails: null,
	});
	assert.match(markup, /data-status-goal-dismiss=""/);
	assert.match(
		markup,
		/aria-label="Clear goal — Reconcile the March invoices"/,
	);
	assert.match(markup, /Clear goal<\/span>/);
	// The X is the mark, not the name: the glyph is `aria-hidden` and the word is
	// the control's own text, so the button has one accessible name and it is the
	// derived string.
	assert.match(markup, /lucide-x/);
});

test("the loop chip is a READOUT and its dismiss is the row's only loop control", () => {
	const markup = renderRow({
		frontend: frontendWith({
			goal: "Ship it",
			loop: wireLoop("running", { completed: 2, iterations: 5 }),
		}),
		runDetails: null,
	});
	const item = markup.match(/data-status-loop-item[\s\S]*?<\/div>/)?.[0] ?? "";
	assert.notEqual(item, "", "the loop item renders");
	/*
	 * The chip itself is a `<span>`, in the readings' INERT box: the loop's standing
	 * state is a readout, and the only thing this row can DO with a loop is stop or
	 * clear it. So the item holds exactly one button, and it is the dismiss.
	 */
	assert.match(item, /<span data-status-loop=""/);
	assert.equal(
		(item.match(/<button/g) ?? []).length,
		1,
		"one control on the loop item, and it is the dismiss",
	);
	assert.match(item, /data-status-loop-dismiss=""/);
	// The mark is the one glyph whose meaning is fixed to this fact, and it does not
	// move: the row's motion is the roster's state mark on the activity chips.
	assert.match(item, /lucide-repeat/);
	assert.doesNotMatch(item, /animate-spin|animate-pulse/);
	// The readout's own box: no hover ground and no pointer, which is what keeps it
	// legible as a readout beside the controls on the same line.
	assert.match(item, /cursor-default/);
	// The word the state earns, printed on the control.
	assert.match(item, /Stop loop<\/span>/);
});

test("both dismisses hold their box and are revealed by hover and by keyboard focus", () => {
	const markup = renderRow({
		frontend: frontendWith({
			goal: "Ship it",
			loop: wireLoop("running", { completed: 2, iterations: 5 }),
		}),
		runDetails: null,
	});
	const dismisses =
		markup.match(/<button[^>]*data-status-(goal|loop)-dismiss=""[^>]*>/g) ?? [];
	assert.equal(
		dismisses.length,
		2,
		"the goal's dismiss and the loop's both render",
	);
	for (const dismiss of dismisses) {
		/*
		 * Held, not hidden: `opacity-0` with pointer events off rather than `hidden`,
		 * so the control keeps its box and the chip's snippet does not move under the
		 * pointer on every hover (`branding.md` § 5: hover is a colour step).
		 */
		assert.match(dismiss, /pointer-events-none/);
		assert.match(dismiss, /opacity-0/);
		assert.doesNotMatch(dismiss, /\shidden/);
		/*
		 * And REVEALED by both halves — `group-hover` for the pointer and
		 * `group-focus-within` for the keyboard. The second is not optional: a
		 * hover-only control is unusable by keyboard (WCAG 2.1.1), and taking focus on
		 * the chip is what reveals it.
		 */
		assert.match(dismiss, /group-hover:pointer-events-auto/);
		assert.match(dismiss, /group-hover:opacity-100/);
		assert.match(dismiss, /group-focus-within:pointer-events-auto/);
		assert.match(dismiss, /group-focus-within:opacity-100/);
		/*
		 * AND THE TWO HALVES ARE THE SAME UTILITIES, mechanically (agent review round 1,
		 * MINOR 3). The classes above are asserted one by one, which is what let the set
		 * drift: a `group-hover:`-only utility added later would pass every assertion here
		 * and leave the keyboard path behind. So the sets are compared as sets — whatever
		 * every `group-hover:` utility is, the `group-focus-within:` side carries it too,
		 * and vice versa.
		 */
		const revealUtilities = (prefix) =>
			new Set(
				(
					dismiss.match(new RegExp(`group-${prefix}:([^"\\s]+)`, "g")) ?? []
				).map((entry) => entry.slice(`group-${prefix}:`.length)),
			);
		assert.deepEqual(
			[...revealUtilities("hover")].sort(),
			[...revealUtilities("focus-within")].sort(),
			"the pointer and the keyboard reveal the same utilities, or one of the two paths is behind",
		);
		// The readings' own control box, so the dismiss is the same species as the
		// chips beside it rather than a second hover ground on one line.
		assert.match(dismiss, /hover:bg-accent-wash/);
		assert.match(dismiss, /focus-visible:outline-offset-1/);
		/*
		 * The disabled step, while a command is in flight (agent review round 1, MINOR 2;
		 * UX's U3): `branding.md` § 6 — a disabled control STEPS COLOUR to `ink-disabled`
		 * rather than fading, and it drops the hover ground it cannot honour.
		 */
		assert.match(dismiss, /disabled:text-ink-disabled/);
		assert.match(dismiss, /disabled:hover:bg-transparent/);
	}
});

test("the dismiss's word is dropped at the row's stacked band, and its name is not", () => {
	const markup = renderRow({
		frontend: frontendWith({
			goal: "Ship it",
			loop: wireLoop("achieved", { completed: 5, iterations: 5 }),
		}),
		runDetails: null,
	});
	/*
	 * At and below 240px the row is a column and the goal item takes the row's whole
	 * content box, so the word `Clear goal` beside the chip's own fixed ink would
	 * leave the snippet nothing: the X is the affordance's irreducible part and the
	 * word is what yields. The accessible name keeps it at every width, which is the
	 * half that decides whether the control is still describable.
	 */
	assert.match(markup, /@max-\[240px\]\/chatcol:hidden/);
	assert.match(markup, /aria-label="Clear loop — achieved"/);
});

test("the shipped dismisses run the owner's own command, and the goal's does not toggle the disclosure", async () => {
	/*
	 * THE DRIVEN HALF, and it is the half that decides whether the feature works:
	 * the markup says a button exists with a name, and only a press says what the
	 * press does. `jsdom` is this repo's existing instrument for that
	 * (`suggestion-stack-react.test.mjs`, and this file's own refocus test), and the
	 * bridge is stubbed at the seam the product uses — `window.api.desktop.request`,
	 * which is what `desktop-api.ts` reads first and the same seam
	 * `scripts/mcp-auth-complete-no-retry.test.mjs` stubs.
	 */
	const { window: dom, root, cleanup } = await rowInDom();
	const quiet = [];
	const realError = console.error;
	console.error = (...args) => void quiet.push(String(args[0]));
	try {
		const h = createElement;
		const requests = [];
		let answer = {
			status: 200,
			body: {
				result: {
					command: "goal",
					result: {
						kind: "notice",
						text: "Goal cleared.",
						style: "success",
						data: {},
					},
				},
			},
		};
		dom.api = {
			desktop: {
				request: async (request) => {
					requests.push(request);
					return answer;
				},
			},
		};
		const element = (loop) =>
			h(ComposerStatusRow, {
				frontend: frontendWith({
					goal: "Reconcile the March invoices",
					loop,
				}),
				runDetails: null,
			});
		const press = async (node) => {
			await act(async () => {
				node.click();
			});
		};

		await act(
			async () =>
				void root.render(
					element(wireLoop("running", { completed: 2, iterations: 5 })),
				),
		);
		const trigger = dom.document.querySelector(
			"[data-composer-status-row] button[aria-expanded]",
		);
		assert.equal(trigger.getAttribute("aria-expanded"), "false");

		const goalClearButton = dom.document.querySelector(
			"[data-status-goal-dismiss]",
		);
		assert.ok(goalClearButton, "the goal chip renders its dismiss");
		await press(goalClearButton);
		assert.equal(requests.length, 1, "one press, one command");
		assert.equal(requests[0].op, "sessions.command");
		assert.equal(
			requests[0].sessionId,
			"s-1",
			"the command is addressed to the session the row is drawn for",
		);
		assert.equal(requests[0].command, "goal");
		assert.equal(requests[0].args, "clear");
		/*
		 * THE PRESS THE CONTROL SITS NEXT TO IS UNTOUCHED. This is the property the
		 * sibling structure exists for: the dismiss is not a child of the disclosure's
		 * trigger, so the press cannot reach it and does not need
		 * `stopPropagation` — and the control on the other side of the chip still
		 * toggles, which is the half that says the assertion is about the structure
		 * rather than about a button that does nothing.
		 */
		assert.equal(
			trigger.getAttribute("aria-expanded"),
			"false",
			"the X does not open the goal",
		);
		await press(trigger);
		assert.equal(trigger.getAttribute("aria-expanded"), "true");
		assert.equal(
			requests.length,
			1,
			"and the disclosure's own press runs no command",
		);

		const stop = dom.document.querySelector("[data-status-loop-dismiss]");
		assert.match(stop.textContent, /Stop loop/);
		await press(stop);
		assert.equal(requests.length, 2);
		assert.equal(requests[1].command, "loop");
		assert.equal(requests[1].args, "stop");

		/*
		 * The loop SETTLES under the same wire the chip reads, so the affordance is
		 * re-derived rather than remembered: the word on the control moves to `Clear
		 * loop` off the same `loopAffordance` call. Its ARGUMENT is `null`, which is the
		 * claim the press below tests: the settled dismiss sends NOTHING.
		 */
		answer = {
			status: 200,
			body: {
				result: {
					command: "loop",
					result: {
						kind: "notice",
						text: "Loop cleared.",
						style: "success",
						data: {},
					},
				},
			},
		};
		await act(
			async () =>
				void root.render(element(wireLoop("achieved", { completed: 5 }))),
		);
		const clearLoop = dom.document.querySelector("[data-status-loop-dismiss]");
		assert.match(clearLoop.textContent, /Clear loop/);
		await press(clearLoop);
		assert.equal(
			requests.length,
			2,
			"the settled dismiss runs no command at all: no released backend has a spelling for it, and both spellings that clear a settled loop START one on a backend that does not know them",
		);
		/*
		 * And it does what it promises with the row's own state: the chip goes, which is
		 * the ACKNOWLEDGEMENT the row is making. The wire is untouched — the test's own
		 * element still holds `achieved` — so a re-render of the same state keeps it
		 * hidden, and a NEW loop (a different signature) brings its chip back.
		 */
		assert.equal(
			dom.document.querySelector("[data-status-loop-dismiss]"),
			null,
			"the settled chip is acknowledged off the row",
		);
		await act(
			async () =>
				void root.render(element(wireLoop("achieved", { completed: 5 }))),
		);
		assert.equal(
			dom.document.querySelector("[data-status-loop-dismiss]"),
			null,
			"the wire did not move, so the acknowledged settled state stays acknowledged",
		);
		await act(
			async () =>
				void root.render(
					element(wireLoop("running", { completed: 1, iterations: 5 })),
				),
		);
		assert.match(
			dom.document.querySelector("[data-status-loop-dismiss]").textContent,
			/Stop loop/,
			"a NEW loop is never hidden by the previous one's acknowledgement",
		);

		/*
		 * A REFUSAL goes to the app's toast channel rather than nowhere, and the case
		 * is here because the failure path is the one a stub can reach and a frame
		 * cannot easily: the transport answers 503 and the control must survive it —
		 * no throw out of the click handler, and the row still standing.
		 */
		answer = { status: 503, body: { detail: "the backend is not running" } };
		await press(dom.document.querySelector("[data-status-goal-dismiss]"));
		assert.equal(
			requests.length,
			3,
			"the refused press still reached the owner",
		);
		assert.equal(requests[2].args, "clear");
		assert.ok(
			dom.document.querySelector("[data-status-goal-dismiss]"),
			"and a refusal leaves the row as it was",
		);
	} finally {
		console.error = realError;
		cleanup();
	}
	assert.ok(
		quiet.every((message) => message.includes("not wrapped in act")),
		`React reported something the harness does not expect: ${quiet.join(" | ")}`,
	);
});

test("the two outcomes that speak do so in the person's own words", () => {
	/*
	 * A SOURCE pin, and the weakest instrument here, deliberately: whether sonner paints
	 * a toast in a bare jsdom document is not a fact about the row, and the channels are
	 * photographed in this change's own frame set (`docs/evidence/composer-status-clear/`
	 * — the refusal and the cleared goal, both held in the harness). What the pin buys is
	 * that a revert has to come here and say what replaced it.
	 */
	const row = code(ROW);
	/*
	 * A FAILURE still goes to the app's toast channel in the backend's own words, and
	 * the prefix is now the CONTROL'S (agent review round 1, U2): the person pressed a
	 * button, so the line may not name a slash command they never typed.
	 */
	assert.match(row, /if \(result\.result\.tone === "error"\)/);
	assert.match(row, /showErrorToast\(result\.result\.text\);/);
	for (const prefix of [
		"Could not clear the goal",
		"Could not stop the loop",
		"Could not clear the loop",
		"Could not restore the goal",
	]) {
		assert.match(
			row,
			new RegExp(`"${prefix}"`),
			`${prefix} is the failure prefix`,
		);
	}
	/*
	 * AND THE GOAL'S CLEAR IS THE ONE SUCCESS THAT ALSO SPEAKS (agent review round 1,
	 * U1): the dismissed text is the user's own prose and nothing else on the app still
	 * carries it, so the confirmation carries the one press that takes it back, and the
	 * restore runs through the same command channel with the CLEARED text.
	 */
	assert.match(
		row,
		/showInfoToast\(goalClearedText\(cleared\), \{/,
		"the confirmation names what it cleared (UX round 2, U7)",
	);
	assert.match(row, /label: GOAL_UNDO_TEXT,/);
	assert.match(row, /onClick: \(\) => void restoreGoal\(cleared\)/);
	assert.match(
		row,
		/goalCommand\.run\(GOAL_COMMAND, text, GOAL_UNDO_FAILURE\)/,
	);
	/*
	 * EACH CONTROL OWNS ITS OWN CHANNEL (agent review round 2, MINOR 2): one hook meant
	 * one `busy`, so a hung `Clear goal` disabled the control that stops a loop that is
	 * spending turns. The pin is that there are two instances and no shared one left.
	 */
	assert.match(
		row,
		/const goalCommand = useSessionCommand\(frontend\?\.session_id \?\? ""\);/,
	);
	assert.match(
		row,
		/const loopCommand = useSessionCommand\(frontend\?\.session_id \?\? ""\);/,
	);
	assert.doesNotMatch(row, /const command = useSessionCommand/);
	assert.match(row, /disabled=\{goalCommand\.busy\}/);
	assert.match(row, /disabled=\{loopCommand\.busy\}/);
	// The pair the two controls dispatch, and neither of them is a label.
	assert.match(
		row,
		/runDismiss\(\s*goalCommand,\s*GOAL_COMMAND,\s*GOAL_CLEAR_ARGS,\s*GOAL_CLEAR_FAILURE,\s*\)/,
	);
	assert.match(
		row,
		/void runDismiss\(loopCommand, LOOP_COMMAND, action\.args, action\.failure\)/,
	);
	assert.match(row, /dismissLoop\(loopAction\)/);
	/*
	 * AND NO `--`-PREFIXED ARGUMENT IS SENT FROM THIS APP AT ALL — the finding the round
	 * turned on, as a mechanical pin rather than a paragraph (agent review round 1,
	 * MAJOR 1): every `--`-prefixed spelling belongs to the companion's TUI/CLI
	 * vocabulary, and a released backend reads one as the VALUE the command takes.
	 */
	assert.doesNotMatch(
		row,
		/"--[a-z]+/,
		"the row sends no flag: the spellings it may send are the shared ones a released backend honours",
	);
});

test("one spelling per operation, and one moving-loop predicate, across the row and the pickers", () => {
	/*
	 * Agent review round 1's MINOR 1, as a pin rather than a paragraph: the SAME two
	 * operations were spelled twice in one app (the row sent `goal --clear` / `loop
	 * --stop` where the picker sent `goal clear` / `loop cancel`), and the moving-loop
	 * set had two definitions — the row's `loopIsRunning` and the picker's own inline
	 * pair of comparisons. One module now owns both, and both callers import it, so
	 * this asserts where the truth lives rather than what either caller happens to
	 * print today.
	 */
	const shared = code(
		"src/renderer/src/features/chat/pickers/session-commands.ts",
	);
	assert.match(shared, /export const GOAL_CLEAR_ARGS = "clear";/);
	assert.match(shared, /export const LOOP_STOP_ARGS = "stop";/);
	assert.match(shared, /export const loopIsRunning = /);
	/*
	 * AND THE NAMES (agent review round 2, NIT 2): the module owned the ARGUMENT while
	 * `"goal"`/`"loop"` stayed literals in three call sites, so its single-owner claim
	 * was true of half an operation. An operation is a name plus a value, and both
	 * halves are written here now.
	 */
	assert.match(shared, /export const GOAL_COMMAND = "goal";/);
	assert.match(shared, /export const LOOP_COMMAND = "loop";/);
	// And the released spellings are the only ones in it: no flag form is exported.
	assert.doesNotMatch(shared, /"--[a-z]+/);

	const row = code(ROW);
	assert.match(row, /"\.\.\/pickers\/session-commands"/);
	assert.match(row, /GOAL_COMMAND,/);
	assert.match(row, /LOOP_COMMAND,/);
	assert.doesNotMatch(
		row,
		/status === "running"/,
		"the row reads the shared predicate instead of restating it",
	);

	const pickers = code(
		"src/renderer/src/features/chat/pickers/destination-pickers.tsx",
	);
	assert.match(
		pickers,
		/import \{[\s\S]*?GOAL_CLEAR_ARGS,[\s\S]*?GOAL_COMMAND,[\s\S]*?LOOP_COMMAND,[\s\S]*?LOOP_STOP_ARGS,[\s\S]*?loopIsRunning,[\s\S]*?\} from "\.\/session-commands";/,
	);
	assert.match(pickers, /command\.run\(GOAL_COMMAND, GOAL_CLEAR_ARGS\)/);
	assert.match(pickers, /cancel\.run\(LOOP_COMMAND, LOOP_STOP_ARGS\)/);
	// And no call site in the app spells either half for itself any more.
	for (const site of [row, pickers]) {
		assert.doesNotMatch(site, /run\("goal"/);
		assert.doesNotMatch(site, /run\("loop"/);
	}
	assert.doesNotMatch(pickers, /run\("loop", "cancel"\)/);
	assert.doesNotMatch(
		pickers,
		/status === "judging"/,
		"the picker reads the shared predicate too",
	);
});

/* ---------------------------------------------------------------- */
/* The delta of the round that closed QA's Q4, code review's MINOR 1-3 and   */
/* UX's U7/U8: the fit rule, the idle re-arm, the per-control flags, the     */
/* scoped undo. Each is driven through the shipped component.               */
/* ---------------------------------------------------------------- */

/**
 * The two numbers the fit rule reads, as the TEST's fixture rather than the layout's.
 *
 * `jsdom` lays nothing out, so `clientWidth`/`scrollWidth` are always 0 and a rule
 * that compares them is untestable without them. What is under test is the
 * COMPARISON and the state it drives, not the pixels: the values below are QA round
 * 2's own measurements of the built app (`[data-status-loop-item]` 243px for
 * `Loop: running, 0 turns` and 275px for `Loop: running, 0 of 25 turns`, against a
 * 224px row content box at a 240px column), and the frames are where the pixels
 * themselves are evidence.
 */
const stubWidths = (dom, widths) => {
	Object.defineProperty(dom.HTMLElement.prototype, "clientWidth", {
		configurable: true,
		get() {
			return this.hasAttribute("data-composer-status-row") ? widths.row : 0;
		},
	});
	Object.defineProperty(dom.HTMLElement.prototype, "scrollWidth", {
		configurable: true,
		get() {
			return this.hasAttribute("data-status-loop-item") ? widths.item : 0;
		},
	});
};

test("the loop's figure is painted exactly while the row's own box carries it", async () => {
	/*
	 * QA round 2's Q4, as the rule rather than as the defect. The progress used to
	 * yield only at the STACKED band (`@max-[240px]`), while the pair it belongs to
	 * stops fitting above it: measured, the item is 243px/275px in a 224px content box
	 * at a 240px column, and the row painted 19px/52px past it. The yield is now the
	 * measurement the box model answers, so it holds at every width and for every
	 * clause the wire can print — including one wider than any of the recorded ones.
	 *
	 * The last two blocks are agent review round 3's MINOR 2 rewritten and MINOR 1's
	 * own sequence: the old final assertion set a 999px item in an 868px content box
	 * and asserted the wide column STILL carried the clause, which is the inverse of
	 * the rule — it passed only because nothing re-measured there, so the stale 275px
	 * demand answered for a 999px sentence. The rule is asserted instead, and the
	 * clause it is asserted about is the one the comment always claimed
	 * (`2 of 100000 turns`, i.e. figures no boundary was sized for) rather than the
	 * `iterations: 5` fixture that printed `2 of 5 turns`.
	 */
	const { window: dom, root, cleanup, resize } = await rowInDom();
	try {
		const widths = { row: 0, item: 0 };
		stubWidths(dom, widths);
		const h = createElement;
		const element = (iterations = 5) =>
			h(ComposerStatusRow, {
				frontend: frontendWith({
					goal: "",
					loop: wireLoop("running", { completed: 2, iterations }),
				}),
				runDetails: null,
			});
		const clause = () =>
			dom.document.querySelector("[data-status-loop]").textContent;

		// The composer's own column: 275px of item in an 868px content box.
		widths.row = 868;
		widths.item = 275;
		await act(async () => void root.render(element()));
		assert.match(clause(), /Loop: running, 2 of 5 turns/);

		// The 240px band: the same item in a 224px content box — Q4's own numbers.
		widths.row = 224;
		await act(async () => resize("[data-composer-status-row]"));
		assert.equal(
			clause(),
			"Loop: running",
			"the figure yields and the status word stays: nothing is cut mid-figure",
		);

		// A column that can carry it again gets it back, with no threshold involved.
		widths.row = 868;
		await act(async () => resize("[data-composer-status-row]"));
		assert.match(clause(), /, 2 of 5 turns/);

		/*
		 * THE TWO DIRECTIONS THE REMEMBERED DEMAND CAN BE WRONG IN (agent review round 3,
		 * MINOR 1), and they are separate drives on purpose: the demand is only re-derived
		 * while the figure is PAINTED, so a clause that changes under a suppressed figure is
		 * the only shape that can leave it stale — and `loopClauseText` is an effect
		 * dependency, so a clause that changes while the figure IS painted re-measures on
		 * its own. Both drives therefore start with the figure suppressed.
		 *
		 * The widths are the test's own stubs, so the numbers here are chosen for the gap
		 * rather than measured: 999px of item is the "figures no boundary was sized for"
		 * clause (`2 of 100000 turns`), 200px is a narrowed one, and 600px is a content box
		 * that carries the second and not the first.
		 */
		widths.item = 999;
		widths.row = 1200;
		await act(async () => void root.render(element(100000)));
		assert.match(clause(), /, 2 of 100000 turns/);

		// Suppressed: 999px of item in a 300px content box.
		widths.row = 300;
		await act(async () => resize("[data-composer-status-row]"));
		assert.equal(clause(), "Loop: running");

		/*
		 * AND THE CLAUSE NARROWS WHILE IT IS SUPPRESSED — the defect itself. The remembered
		 * 999px belongs to a sentence that is no longer on the wire, so a 200px item in a
		 * 600px box must paint: keeping it hidden there is the row yielding something its box
		 * demonstrably carries. This assertion fails on a demand that survives its clause.
		 */
		widths.item = 200;
		widths.row = 600;
		await act(async () => void root.render(element()));
		assert.match(
			clause(),
			/, 2 of 5 turns/,
			"a narrower clause re-derives the demand: the figure is not suppressed by the old one",
		);

		/*
		 * AND THE RULE ITSELF, stated as the rule: a 999px item in an 868px content box does
		 * NOT fit. The previous form of this assertion set exactly those numbers and claimed
		 * the wide column still carried the clause, which is the inverse — it passed only
		 * because nothing re-measured there, so the stale demand answered for a sentence it
		 * did not describe (MINOR 2). `resize()` is what a real column change does, and it is
		 * what makes this a measurement rather than a report of the last one.
		 */
		widths.item = 999;
		widths.row = 868;
		await act(async () => void root.render(element(100000)));
		assert.equal(
			clause(),
			"Loop: running",
			"a 999px item in an 868px content box does not fit: the figure yields",
		);
		widths.row = 1000;
		await act(async () => resize("[data-composer-status-row]"));
		assert.match(
			clause(),
			/, 2 of 100000 turns/,
			"and a box that carries it gets the clause back, whichever figures it prints",
		);
	} finally {
		cleanup();
	}
});

test("an idle reading is not a settled identity, so an acknowledged chip comes back", async () => {
	/*
	 * Agent review round 2's MINOR 1, as the sequence that reproduced it: settle,
	 * acknowledge, the wire reports `idle`, the SAME settled state returns. `idle` used
	 * to yield a non-null signature (`loopIsRunning("idle")` is false) while `showLoop`
	 * read it as "no loop", so the acknowledgement was never dropped and the chip that
	 * should return stayed hidden. A detached app or a replaced driver produces exactly
	 * that order without an observed `running` frame.
	 */
	const { window: dom, root, cleanup } = await rowInDom();
	const requests = [];
	dom.api = { desktop: { request: async (request) => requests.push(request) } };
	try {
		const h = createElement;
		const settled = () =>
			wireLoop("cancelled", { completed: 2, iterations: 5 });
		const element = (loop) =>
			h(ComposerStatusRow, {
				frontend: frontendWith({ goal: "", loop }),
				runDetails: null,
			});
		const chip = () => dom.document.querySelector("[data-status-loop-item]");

		await act(async () => void root.render(element(settled())));
		const dismiss = dom.document.querySelector("[data-status-loop-dismiss]");
		assert.match(dismiss.textContent, /Clear loop/);
		await act(async () => dismiss.click());
		assert.equal(
			chip(),
			null,
			"the press acknowledges the settled state off the row",
		);
		assert.equal(
			requests.length,
			0,
			"and sends nothing: no released spelling for it",
		);

		// The wire reports `idle`: neither state has a chip to show.
		await act(async () => void root.render(element(wireLoop("idle"))));
		assert.equal(chip(), null, "an idle loop is no loop at all");

		// The same settled state comes back. It is a re-arm, not a second chance.
		await act(async () => void root.render(element(settled())));
		assert.ok(
			chip(),
			"an idle reading between them re-arms the acknowledgement instead of hiding the chip",
		);
		assert.match(
			dom.document.querySelector("[data-status-loop-dismiss]").textContent,
			/Clear loop/,
		);

		/*
		 * The control, unchanged: with no idle reading in between, the same settled
		 * state stays acknowledged and does not grow a second press.
		 */
		await act(async () =>
			dom.document.querySelector("[data-status-loop-dismiss]").click(),
		);
		await act(async () => void root.render(element(settled())));
		assert.equal(chip(), null, "an identical re-render keeps it acknowledged");
	} finally {
		cleanup();
	}
});

test("each dismiss owns its own in-flight state, and the busy one stays painted", async () => {
	/*
	 * Agent review round 2's MINOR 2 and UX round 2's U8, driven together because they
	 * are the same two properties of the same two presses.
	 *
	 * MINOR 2: one `useSessionCommand` meant one `busy`, so a hung `Clear goal` disabled
	 * `Stop loop` — the control that stops a loop spending turns, dead while an
	 * unrelated receipt is outstanding.
	 *
	 * U8: `DISMISS_REVEAL` is keyed to the pointer, so a press followed by the pointer
	 * moving on left the control at `opacity: 0` with `disabled: true` until the command
	 * settled: a user who pressed and moved on got silence. The busy step is the second
	 * activator — one class — and it must not un-disable anything.
	 *
	 * The bridge is DEFERRED rather than stubbed-answered, because an in-flight command
	 * is the whole subject: a promise that never resolves is what a hung owner looks
	 * like to the renderer.
	 */
	const { window: dom, root, cleanup } = await rowInDom();
	const pending = [];
	const answer = {
		status: 200,
		body: {
			result: {
				command: "goal",
				result: { kind: "notice", text: "ran.", style: "success", data: {} },
			},
		},
	};
	dom.api = {
		desktop: {
			request: (request) =>
				new Promise((resolve) => pending.push({ request, resolve })),
		},
	};
	try {
		const h = createElement;
		const element = () =>
			h(ComposerStatusRow, {
				frontend: frontendWith({
					goal: "Reconcile the March invoices",
					loop: wireLoop("running", { completed: 2, iterations: 5 }),
				}),
				runDetails: null,
			});
		const goalDismiss = () =>
			dom.document.querySelector("[data-status-goal-dismiss]");
		const loopDismiss = () =>
			dom.document.querySelector("[data-status-loop-dismiss]");
		const settle = async () => {
			await act(async () => {
				for (const entry of pending.splice(0)) entry.resolve(answer);
			});
		};

		/*
		 * The reveal's classes are read as TOKENS, not as substrings: `opacity-100` is a
		 * substring of `group-hover:opacity-100`, and a matcher that cannot tell them apart
		 * would pass on the resting control and on the busy one alike.
		 */
		const tokens = (node) => node.className.split(/\s+/);

		await act(async () => void root.render(element()));
		assert.ok(
			tokens(goalDismiss()).includes("opacity-0"),
			"at rest the control is held: the reveal waits for a pointer or for busy",
		);
		assert.ok(!tokens(goalDismiss()).includes("opacity-100"));

		// The goal's command hangs. The loop's control is untouched by it.
		await act(async () => goalDismiss().click());
		assert.equal(pending.length, 1);
		assert.equal(
			goalDismiss().disabled,
			true,
			"the pressed control is disabled",
		);
		assert.equal(
			loopDismiss().disabled,
			false,
			"Stop loop is NOT disabled by the goal's command: the two presses are independent",
		);
		assert.ok(
			tokens(goalDismiss()).includes("opacity-100"),
			"and it stays PAINTED while it is busy (U8): the press is visible with the pointer gone",
		);
		assert.ok(!tokens(goalDismiss()).includes("opacity-0"));
		await settle();
		assert.equal(goalDismiss().disabled, false);
		assert.ok(
			!tokens(goalDismiss()).includes("opacity-100"),
			"and the busy step goes with the command: the held state is back",
		);

		// The other direction, which is the consequential one: a hung Stop loop must
		// leave `Clear goal` usable.
		await act(async () => loopDismiss().click());
		assert.equal(loopDismiss().disabled, true);
		assert.equal(
			goalDismiss().disabled,
			false,
			"Clear goal is not disabled by the loop's command",
		);
		assert.equal(pending[0].request.command, "loop");
		assert.equal(pending[0].request.args, "stop");
		await settle();
	} finally {
		cleanup();
	}
});

test("the goal's undo belongs to its own clearing, and the confirmation names it", async () => {
	/*
	 * UX round 2's U7, both measured facets, driven with the app's own toast host:
	 *
	 * 1. the offer is retired the moment the wire holds a goal again, so a goal the
	 *    AGENT set while the toast was up cannot be silently replaced by the cleared
	 *    text — the defect as the reviewer measured it (`/goal Reconcile the March
	 *    invoices…` over `A goal the agent set while the toast was up`);
	 * 2. a second clear's confirmation NAMES what it cleared, so two offers are two
	 *    things to the eye (`goalClearedText`), and each press returns its own text.
	 *
	 * The toast is the app's own container, mounted here because the row speaks through
	 * that channel and the assertion is about what a person could press.
	 */
	const { window: dom, root, cleanup, frame } = await rowInDom();
	const requests = [];
	dom.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				return {
					status: 200,
					body: {
						result: {
							command: request.command,
							result: {
								kind: "notice",
								text: "ran.",
								style: "success",
								data: {},
							},
						},
					},
				};
			},
		},
	};
	try {
		const h = createElement;
		const element = (goal) =>
			h(
				Fragment,
				null,
				h(ComposerStatusRow, {
					frontend: frontendWith({ goal }),
					runDetails: null,
				}),
				h(ThemedToastContainer, { duration: Number.POSITIVE_INFINITY }),
			);
		/*
		 * A toast that has been retired is still IN the document with `data-removed="true"`
		 * until sonner's exit animation ends, and `jsdom` runs no animations: the mark is
		 * what says the offer is gone, and waiting for the node to leave would be waiting
		 * for a frame this instrument never paints.
		 */
		const liveToasts = () =>
			[...dom.document.querySelectorAll("[data-sonner-toast]")].filter(
				(node) => node.getAttribute("data-removed") !== "true",
			);
		const toastText = () => liveToasts().map((node) => node.textContent ?? "");
		/*
		 * The toast channel schedules its own work in a `requestAnimationFrame`
		 * (`toast.dismiss` notifies its subscribers from one), and this harness's rAF is a
		 * queue: a frame has to be asked for. Three rounds is what the two state hops need —
		 * the store's notify, the Toaster's render, and the removal mark.
		 */
		const settle = async () => {
			for (let round = 0; round < 3; round += 1) {
				await act(async () => {});
				await act(async () => frame());
			}
		};
		/*
		 * A BOUNDED WAIT, because sonner paints through its own portal from its own store
		 * and in bare jsdom that render lands a frame or two after the press — lag this
		 * round's reviewer recorded too (they treated a missing toast as harness flake and
		 * re-ran). The wait is bounded and still fails on a WRONG confirmation or on one
		 * that never arrives, which is what the assertions are about.
		 */
		const waitForLive = async (needle) => {
			for (let round = 0; round < 12; round += 1) {
				if (toastText().some((text) => text.includes(needle))) return;
				await settle();
			}
			assert.fail(
				`no confirmation carrying ${needle}: ${JSON.stringify(toastText())}`,
			);
		};
		const waitForRetired = async () => {
			for (let round = 0; round < 12; round += 1) {
				if (liveToasts().length === 0) return;
				await settle();
			}
			assert.fail(
				`the offer was never retired: ${JSON.stringify(toastText())}`,
			);
		};
		const dismiss = () =>
			dom.document.querySelector("[data-status-goal-dismiss]");
		const pressUndo = async () => {
			const button = [
				...liveToasts().flatMap((node) => [...node.querySelectorAll("button")]),
			].find((node) => node.textContent === "Undo");
			assert.ok(button, "the confirmation offers the undo");
			await act(async () => button.click());
		};

		// The copy itself, as a value: one line, leading words, an ellipsis, nothing cut.
		assert.equal(
			goalClearedText("Reconcile the March invoices"),
			"Goal cleared · Reconcile the March invoices",
		);
		assert.equal(
			goalClearedText(
				"Reconcile the March invoices against the payments ledger",
			),
			"Goal cleared · Reconcile the March…",
			"the cut falls on a word, not inside one",
		);
		assert.equal(
			goalClearedText("Two lines\nof a goal"),
			"Goal cleared · Two lines of a goal",
			"a multi-line goal is one line in a toast",
		);

		// SEQUENCE 1: cleared, then a goal arrives while the confirmation is up.
		await act(
			async () => void root.render(element("Reconcile the March invoices")),
		);
		await act(async () => dismiss().click());
		await waitForLive("Goal cleared · Reconcile the March invoices");
		assert.equal(requests.length, 1);
		assert.equal(requests[0].args, "clear");
		await act(async () => void root.render(element("A goal the agent set")));
		await waitForRetired();
		assert.equal(
			liveToasts().length,
			0,
			"the offer is retired the moment the wire holds a goal: nothing can put the cleared text over it",
		);

		// SEQUENCE 2: two clears, each with its own text, each answering for itself.
		await act(async () => dismiss().click());
		await waitForLive("Goal cleared · A goal the agent set");
		assert.equal(requests.length, 2);
		assert.equal(requests[1].args, "clear");
		assert.equal(
			liveToasts().length,
			1,
			"and the second confirmation is the only one on screen",
		);
		// The wire's goal is now empty: the offer stands, and its press restores THAT text.
		await act(async () => void root.render(element("")));
		await pressUndo();
		assert.equal(requests[2].command, "goal");
		assert.equal(
			requests[2].args,
			"A goal the agent set",
			"the undo returns the text of ITS OWN clearing",
		);

		/*
		 * SEQUENCE 3 — THE OFFER OUTLIVING ITS OWN ROW (UX round 3, U9). A route change
		 * unmounts the row (measured in the app: `{route:"#/browser", row:false}`) while the
		 * confirmation stays up, because the toast host is the APP's and not the row's. The
		 * press then has to send NOTHING: the offer was taken from a wire that was empty, and
		 * with nothing watching that session no one can confirm it still is.
		 *
		 * `root.render` without the row IS the unmount — the same root, a tree that no longer
		 * contains it — so the row's cleanup runs and the session stops being observed. That
		 * release is the whole difference from the shipped defect: the precondition used to be
		 * a ref the row froze at its last mounted value, and a frozen `""` is indistinguishable
		 * from a live one. This is the assertion that fails if the press goes back to reading
		 * the row.
		 */
		/*
		 * A THIRD GOAL TEXT, and it has to be a third: `showInfoToast` dedupes on the
		 * message, so reusing SEQUENCE 2's would put the previous offer's id back rather
		 * than paint a new one (the same map that keeps two identical refusals from
		 * stacking).
		 */
		await act(
			async () => void root.render(element("Reconcile the April ledger")),
		);
		await waitForRetired();
		await act(async () => dismiss().click());
		await waitForLive("Goal cleared · Reconcile the April ledger");
		/*
		 * The wire is empty and the offer stands — the state the offer is only ever made in,
		 * and the one the press has to be able to trust. It is what a real clear leaves behind,
		 * and the last thing the row is shown holding before it goes away.
		 */
		await act(async () => void root.render(element("")));
		const beforeUnmount = requests.length;
		/*
		 * THE ROW'S SLOT GOES EMPTY AND THE TOAST HOST'S DOES NOT, which is the app's own
		 * shape: the row is the page's and the host is the window's. Rendering the host
		 * ALONE would reconcile it as a different tree and remount it, and a remounted
		 * Toaster is not the offer outliving its row — it is a second host.
		 */
		await act(
			async () =>
				void root.render(
					h(
						Fragment,
						null,
						null,
						h(ThemedToastContainer, { duration: Number.POSITIVE_INFINITY }),
					),
				),
		);
		await pressUndo();
		assert.equal(
			requests.length,
			beforeUnmount,
			"an offer whose row is gone sends nothing: no session is watching that wire",
		);
		await waitForRetired();
		assert.equal(
			liveToasts().length,
			0,
			"and the stale offer is taken back rather than left promising an undo it cannot keep",
		);
	} finally {
		cleanup();
	}
});
