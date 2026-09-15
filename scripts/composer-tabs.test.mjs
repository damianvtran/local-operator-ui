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
				subagentChipLabel,
				jobChipLabel,
			} from "./src/renderer/src/features/chat/components/composer-status-row";
			import {
				activityTally,
				deriveRunDetails,
				todoClause,
				childClause,
				jobClause,
			} from "./src/renderer/src/features/chat/components/run-details";
			import { scrollRegionToTop } from "./src/renderer/src/shared/lib/scroll";
			import { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";

			export const renderRow = (props) =>
				renderToStaticMarkup(createElement(ComposerStatusRow, props));
			export { goalDisclosureLabel, planChipLabel, subagentChipLabel, jobChipLabel, deriveRunDetails, activityTally, todoClause, childClause, jobClause, scrollRegionToTop, useUiPreferencesStore };
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
	subagentChipLabel,
	jobChipLabel,
	deriveRunDetails,
	activityTally,
	todoClause,
	childClause,
	jobClause,
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

test("the row's chips are ordered goal, plan, subagents, jobs, in paint and tab order alike", () => {
	/*
	 * Four chips on one row and one DOM order, which the stacked arrangement at the
	 * column floor inherits: the row is a `flex-col` there, so the vertical order IS
	 * the DOM order. Both activity chips sit AFTER the plan chip, which is the
	 * operator's placement ("in the same row as the todos") and the reason their
	 * sections are `subagents` and `jobs` rather than a single activity control.
	 */
	const markup = renderRow({
		frontend: frontend("Ship it"),
		runDetails: detailsWith(
			[
				wireJob("c1", "task", "running", "Audit the invoices"),
				wireJob("s1", "bash", "running", "bash: sleep 150"),
			],
			["pending", "done"],
		),
	});
	const order = [
		markup.indexOf("Goal:"),
		markup.indexOf("data-status-plan"),
		markup.indexOf("data-status-subagents"),
		markup.indexOf("data-status-jobs"),
	];
	assert.ok(
		order.every((at) => at > -1),
		"all four chips render",
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
		childClause({ count: 2, mark: "running" }),
		"2 subagents running",
	);
	assert.equal(jobClause({ count: 1, mark: "running" }), "1 job running");
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
		subagentChipLabel({ count: 2, mark: "running" }),
		"Open the subagents in run details — 2 subagents running",
	);
	assert.equal(
		jobChipLabel({ count: 1, mark: "running" }),
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
	 * The row's alignment device, now ORDINAL: with four possible chips there are
	 * four states of "which one is first", and a rule written as a single boolean
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

	// No goal and no plan: the subagents chip leads.
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

	// All four: exactly one cancellation, on the goal.
	const allFour = renderRow({
		frontend: frontend("Ship it"),
		runDetails: detailsWith(
			[
				wireJob("c1", "task", "running", "Audit"),
				wireJob("s1", "bash", "running", "bash: sleep"),
			],
			["pending"],
		),
	});
	assert.equal(count(allFour), 1);
	assert.ok(allFour.indexOf(firstClass) < allFour.indexOf("data-status-plan"));

	// And the values are in the accessible names, never in a visible label.
	assert.ok(
		planFirst.includes(
			'aria-label="Open the plan in run details — 1 to-do open"',
		),
	);
});

test("the activity chips file their own section, and the store carries all three", () => {
	const store = useUiPreferencesStore;
	for (const section of ["subagents", "jobs"]) {
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
	 * COLUMNS — horizontal overflow, the defect the wrap exists to remove.
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
	 * constant applied under that name. The three count chips ask inside the group
	 * (below), where "first" is a question about the group's own leading edge.
	 */
	assert.match(source, /groupIsFirst \? FIRST_CHIP : undefined/);
	assert.match(source, /subagentsFirst \? FIRST_CHIP : undefined/);
	assert.match(source, /jobsFirst \? FIRST_CHIP : undefined/);
	/*
	 * THE GROUP, which is design review round 1's D2: with the three count chips as
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
	assert.match(source, /const subagentsFirst = !showGoal && !showPlan;/);
	assert.match(source, /const jobsFirst = subagentsFirst && !children;/);

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
	 * And nothing here counts: no filtering to an open slice, no status word compared
	 * to "running", no length turned into a number. The row chooses which of the
	 * model's functions to print, which is the rule the plan chip already follows.
	 */
	assert.doesNotMatch(source, /\.filter\(/);
	assert.doesNotMatch(source, /=== "running"/);
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

test("the row hands focus back to the composer when a chip unmounts under it", () => {
	/*
	 * UX round 1's U1, observed live: `active=BUTTON/jobs` then `active=BODY/None`
	 * when the last running row settles. The row cannot restore focus itself — the
	 * composer's textarea is the parent's ref — so the parent passes the target in,
	 * and the assertion is that BOTH halves are wired: the conditional refocus in the
	 * row, and the parent's own `textareaRef` behind it.
	 */
	const row = code(ROW);
	assert.match(
		row,
		/if \(shrank && rowHeldFocus\.current && !holdsFocus\) onFocusComposer\?\.\(\);/,
	);
	// The condition's first half: only a SHRINKING row can have lost the chip.
	assert.match(row, /const shrank = chipCount < previousChipCount\.current;/);
	// Its second half: the row must have HELD focus last commit, because by the time
	// the effect runs the browser has already moved it to `<body>` and the evidence
	// is gone. Without this half every settle would yank focus mid-sentence.
	assert.match(row, /rowHeldFocus\.current = holdsFocus;/);
	// And the prop is optional, so a story that renders the row alone need not
	// invent a focus target.
	assert.match(row, /onFocusComposer\?: \(\) => void;/);

	const composer = code(MESSAGE_INPUT);
	assert.match(
		composer,
		/onFocusComposer=\{\(\) => textareaRef\.current\?\.focus\(\)\}/,
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
	 */
	const roster = code(
		"src/renderer/src/features/chat/components/run-details/run-detail-subagents.tsx",
	);
	assert.match(
		roster,
		/<SubagentRowBody row=\{row\} detail=\{<DetailLine row=\{row\} \/>\} \/>/,
	);
});
