import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";

/*
 * The canvas pane's Goals view: the settled-goal rows and the TRUNCATION NOTICE.
 *
 * The notice is why this file exists. A capped history and a complete one are
 * pixel-identical, so the flag the wire carries (`goal_history_truncated`) is the
 * only thing that can stop the pane from under-reporting a project record — and an
 * assertion on rendered markup is the only instrument that can see whether it
 * reached the paint. The rows' own rules (the strike, the tag, the order) are here
 * for the same reason: they are markup facts, not model facts.
 *
 * The idiom is `composer-tabs.test.mjs`'s, on `composer-readings.test.mjs`'s terms:
 * esbuild bundles the real TypeScript in memory, React stays external so the bundle
 * shares ONE copy with this file's own imports, and the renderer's `@shared` alias is
 * declared by hand because esbuild cannot read tsconfig paths. One instrument is a
 * SOURCE pin at the end, for the one rule that lives in the pane rather than in this
 * viewer: that the switcher's segment is the `Goals` view, last, with the count in
 * its accessible name and never a badge.
 */
const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import {
				CanvasGoalsViewer,
				goalHistoryTag,
			} from "./src/renderer/src/features/chat/components/canvas/canvas-goals-viewer";
			import { viewSegmentName } from "./src/renderer/src/features/chat/components/canvas/canvas-view-name";
			export const renderGoals = (props) =>
				renderToStaticMarkup(createElement(CanvasGoalsViewer, props));
			export { CanvasGoalsViewer, goalHistoryTag, viewSegmentName };
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
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});
const bundlePath = new URL("./_canvas-goals.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { renderGoals, goalHistoryTag, viewSegmentName } = await import(
	bundlePath.href
);
await unlink(bundlePath);

const entry = (fields) => ({
	id: fields.id ?? "h1",
	text: "Reconcile the March ledger",
	status: "done",
	created_at: "2026-09-20T09:00:00Z",
	settled_at: "2026-09-22T14:03:00Z",
	reason: "Every invoice matched against the ledger.",
	...fields,
});

/* ---------------------------------------------------------------- */
/* The rows                                                          */
/* ---------------------------------------------------------------- */

test("one row per entry, in the wire's order, struck only when done", () => {
	const markup = renderGoals({
		entries: [
			entry({ id: "a", text: "Ship the release", status: "done" }),
			entry({
				id: "b",
				text: "Draft the RFC",
				status: "superseded",
				reason: "",
			}),
		],
		truncated: false,
	});
	// The wire's order is the display order, and it is newest first on the wire.
	assert.ok(
		markup.indexOf("Ship the release") < markup.indexOf("Draft the RFC"),
		"rows keep the order the frame carries",
	);
	/*
	 * THE STRIKE IS THE SETTLED STATE'S, and it is one element per done row: the
	 * tag beside it is NOT struck (a tag that crossed out its own word would be
	 * unreadable exactly where it matters) and neither is the mark column.
	 */
	assert.equal((markup.match(/line-through/g) ?? []).length, 1);
	assert.match(
		markup,
		/<span class="[^"]*\bline-through\b[^"]*"[^>]*>Ship the release<\/span>/,
	);
	assert.doesNotMatch(
		markup,
		/<span class="[^"]*\bline-through\b[^"]*"[^>]*>Draft the RFC<\/span>/,
	);
	// The wire's word is printed verbatim, in the tag and nowhere paraphrased.
	assert.match(markup, /done · /);
	assert.match(markup, /superseded · /);
	// The count in the header is the ROWS', which is the only count the pane can see.
	assert.match(markup, /2 goals/);
});

test("the row tag is the wire's word plus the app's own short stamp", () => {
	/*
	 * The word is not mapped, translated or title-cased, and the stamp is
	 * `formatTurnTimestamp` — the app's one short form for a moment — rather than a
	 * new `Intl` call. A settled goal with no stamp at all is still a row: the tag
	 * then carries the word alone rather than a dangling separator.
	 */
	const now = new Date("2026-09-22T20:00:00Z");
	const tag = goalHistoryTag(entry({}), now);
	assert.ok(
		tag.startsWith("done · "),
		`tag leads with the wire's word: ${tag}`,
	);
	assert.match(tag, /\d/);
	assert.equal(
		goalHistoryTag({ id: "x", text: "t", status: "done" }, now),
		"done",
	);
	/*
	 * THE TAG CARRIES NO INSTANT, and the row is closed by default (the app's
	 * disclosure rule), so the exact ISO time is behind the trigger and the reason
	 * is not in a closed row's markup at all. Both are asserted below as source
	 * facts rather than as pixels this render cannot show: what the render CAN show
	 * is that neither leaked onto the closed row.
	 */
	const markup = renderGoals({ entries: [entry({})], truncated: false });
	assert.doesNotMatch(markup, /2026-09-22T14:03:00Z/);
	assert.doesNotMatch(markup, /Every invoice matched/);
});

/* ---------------------------------------------------------------- */
/* The truncation notice — the non-negotiable half                   */
/* ---------------------------------------------------------------- */

test("a truncated history says so, in words, beside the rows it truncated", () => {
	const markup = renderGoals({
		entries: [entry({ id: "a" })],
		truncated: true,
	});
	assert.match(
		markup,
		/Older settled goals are not carried here — this list is capped\./,
		"the pane states what is missing instead of silently under-reporting",
	);
	/*
	 * AND IT IS MEASURED (design review round 1, D10): the pane's own notices carry a
	 * measure, so its truncation notice does too, rather than running the pane's full
	 * width at the 400px dock floor.
	 */
	assert.match(markup, /<p class="[^"]*max-w-80[^"]*">Older settled goals/);
	// It is a NOTE beside the list, not the empty state: the row is still there.
	assert.match(markup, /Reconcile the March ledger/);
	assert.doesNotMatch(markup, /No goals completed yet/);
});

test("a truncated history that carried no entries at all is not 'no completed goals'", () => {
	/*
	 * `entries` empty with `truncated` true is a REAL state: every entry the wire
	 * would have carried was dropped by the bound. Rendering the empty state here
	 * would state a fact the backend never said — "no completed goals" — which is
	 * exactly the lie the flag exists to prevent, so the two are rendered
	 * independently rather than one standing in for the other.
	 */
	const markup = renderGoals({ entries: [], truncated: true });
	assert.match(markup, /this list is capped/);
	assert.doesNotMatch(markup, /No goals completed yet/);
});

test("an untruncated history says nothing about a cap", () => {
	const markup = renderGoals({
		entries: [entry({ id: "a" })],
		truncated: false,
	});
	assert.doesNotMatch(markup, /capped/);
});

/* ---------------------------------------------------------------- */
/* The empty state                                                   */
/* ---------------------------------------------------------------- */

test("the empty state names the next action rather than the absence", () => {
	const markup = renderGoals({ entries: [], truncated: false });
	assert.match(markup, /No goals completed yet/);
	/*
	 * THE APP'S OWN SPELLING OF THIS INVITATION (design review round 1, D9): the same
	 * words the TUI's goal panel uses, so two surfaces invite one act one way.
	 */
	assert.match(
		markup,
		/No goal set — \/goal &lt;text&gt; to set one\. Finished goals are kept here\./,
	);
	// No action button: the next action is typing, not a click.
	assert.doesNotMatch(markup, /<button/);
});

/* ---------------------------------------------------------------- */
/* The pane's own wiring (a source pin)                              */
/* ---------------------------------------------------------------- */

test("the switcher carries the Goals segment LAST, with the count in its name", () => {
	const pane = readFileSync(
		"src/renderer/src/features/chat/components/canvas/index.tsx",
		"utf8",
	);
	const source = pane
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
	/*
	 * LAST is a design decision with a reason (a history that has to be scrolled for
	 * is a history nobody reads), so it is pinned as ORDER rather than as presence.
	 */
	assert.ok(
		source.indexOf('value: "variables"') < source.indexOf('value: "goals"'),
		"the Goals segment is last in the switcher's own list",
	);
	assert.match(source, /Icon: Target/);
	assert.match(source, /tourTag: "canvas-goals-view-button"/);
	/*
	 * THE COUNT RIDES THE NAME, never a badge inside a 24px button — the Files
	 * segment's own recorded rule, applied to the second segment that can say a
	 * number.
	 */
	/*
	 * AND THE COUNT IS THE LIST THAT IS CARRIED, NOT A TOTAL (design review round 1,
	 * F5). The name is derived by `viewSegmentName`, which takes the cap; the pin here
	 * is that the pane passes it, and the truth table beside this test is what says the
	 * derived name admits it.
	 */
	assert.match(source, /viewSegmentName\(/);
	assert.match(source, /value === "goals" && goalTruncated/);
	assert.match(source, /goalTruncated=\{goalHistoryTruncated\}/);
	assert.match(source, /goalCount=\{goalHistory\.length\}/);
	assert.match(source, /entries=\{goalHistory\}/);
	assert.match(source, /truncated=\{goalHistoryTruncated\}/);
	/*
	 * The default is a stable identity, not a fresh `[]` per render: `Canvas` is
	 * memoised, and a literal default would defeat the memo on every frame.
	 */
	assert.match(
		source,
		/const EMPTY_GOAL_HISTORY: CanonicalGoalHistoryEntry\[\] = \[\];/,
	);
	assert.match(source, /goalHistory = EMPTY_GOAL_HISTORY/);
});

/*
 * THE FOURTH VIEW IS GATED ON THE SAME CAPABILITY READING AS THE CHIP (UX round 1, U4).
 *
 * The chip's `Done`/`Dismiss` controls have been gated on the wire's fields since they
 * were written; the pane was not, so an older backend got a segment over a view that
 * could never fill, whose empty state promises `Finished goals are kept here` about a
 * backend that keeps nothing. This is a SOURCE pin for the reason this file records at
 * its head: `canvas/index.tsx` cannot be rendered in isolation (it reads the canvas
 * store, a live session and the window bridge), so the instrument that can see the
 * wiring is the source - and the wiring is what the finding is about.
 */
test("the Goals view is gated on the chip's own capability reading, once", () => {
	const pane = readFileSync(
		"src/renderer/src/features/chat/components/canvas/index.tsx",
		"utf8",
	);
	const source = pane
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
	/*
	 * ONE DERIVATION: the capability arrives as a boolean, the segment list is built from
	 * it, and the ACTIVE view is resolved against that same list - so a view that is not
	 * offered cannot be the current one either, which is what stops a PERSISTED `goals`
	 * choice from stranding the pane on a backend that predates the lifecycle.
	 */
	assert.match(source, /goalCapable = false/);
	assert.match(
		source,
		/const canvasViews = \(goalCapable: boolean\): typeof VIEWS =>/,
	);
	assert.match(source, /canvasViews\(goalCapable\)/);
	assert.match(source, /views\.some\(\(view\) => view\.value === storedView\)/);
	/*
	 * AND BOTH READERS SPEND THAT ONE LIST: the switcher renders it, and the pane's own
	 * condition is the resolved view rather than a second `goalCapable` check. A second
	 * check is the shape that lets the two disagree, which is exactly the defect here.
	 */
	assert.match(source, /views=\{views\}/);
	assert.match(source, /\{views\.map\(/);
	assert.doesNotMatch(
		source,
		/"goals" && goalCapable|goalCapable && currentView/,
		"the pane is gated by the resolved view, not by a second capability check",
	);
	/*
	 * AND IT IS THE CHIP'S OWN PREDICATE, called once by the pane's owner on the snapshot
	 * the chip reads - not a re-reading of `goal_history` here, which is the second
	 * presence check U4 asks not to have.
	 */
	const page = readFileSync(
		"src/renderer/src/features/chat/components/chat-content.tsx",
		"utf8",
	);
	assert.match(
		page,
		/goalCapable=\{goalCapability\(canonical\?\.view\.frontend\)\}/,
	);
	assert.doesNotMatch(
		source,
		/goal_history/,
		"the pane reads the entries it is handed, not the wire field beside them",
	);
});

test("the Goals segment's name admits the cap when the history is truncated", () => {
	/*
	 * Design review round 1's F5, as a truth table rather than as a substring: the
	 * segment's number is a claim about a list, and the segment outside the pane was the
	 * one surface still speaking `goalHistory.length` as a total while the pane beside
	 * it said "this list is capped". A screen-reader user heard "Goals view, 3 goals" and
	 * only learned otherwise after opening the pane.
	 */
	assert.equal(
		viewSegmentName("Goals", "goal", 3, true),
		"Goals view, 3 goals shown — this list is capped",
		"a capped list says so in the name it is counted by",
	);
	assert.equal(
		viewSegmentName("Goals", "goal", 3),
		"Goals view, 3 goals",
		"an uncapped list is unchanged: the caveat is the cap's, not the count's",
	);
	assert.equal(
		viewSegmentName("Goals", "goal", 1, true),
		"Goals view, 1 goal shown — this list is capped",
		"the singular agrees with the same noun rule the count already used",
	);
	/*
	 * CAPPED AND EMPTY IS A REAL STATE — the wire can drop every entry it had — and it
	 * is the one where dropping the count would say the LEAST: there is nothing carried
	 * and something settled, which the clause is what states.
	 */
	assert.equal(
		viewSegmentName("Goals", "goal", 0, true),
		"Goals view, 0 goals shown — this list is capped",
	);
	// A segment with nothing to count and no cap keeps the shipped shape.
	assert.equal(viewSegmentName("Files", "file", 0), "Files view");
	assert.equal(viewSegmentName("Files", "file", 2), "Files view, 2 files");
});

test("the row's disclosed body carries the reason and the exact instant", () => {
	const viewer = readFileSync(
		"src/renderer/src/features/chat/components/canvas/canvas-goals-viewer.tsx",
		"utf8",
	);
	/*
	 * The body is closed by default (the app's disclosure rule), so a static render
	 * cannot photograph it. The pin is what a revert would have to come here and
	 * argue with: the judge's reason is clamped for the eye, TITLED for the pointer
	 * and twinned `sr-only` for assistive tech — the to-do row's own treatment for a
	 * variable-length sentence — and the exact ISO instant sits under the human
	 * stamp in `text-mono`, which `branding.md` reserves for a machine value.
	 */
	assert.match(viewer, /line-clamp-2/);
	assert.match(viewer, /title=\{entry\.reason\}/);
	assert.match(viewer, /className=\{cn\("sr-only"\)\}>\{entry\.reason\}</);
	assert.match(viewer, /text-mono/);
	assert.match(viewer, /\{entry\.settled_at\}/);
	/*
	 * AND NO DELETE, deliberately: no command deletes a history row, and this view
	 * adds no destructive capability to a session-scoped record. `id` stays on the
	 * wire as the hook for the day the operator asks for one. Asserted on the CODE,
	 * with the comments stripped: this file's own docblock argues the omission, and
	 * a pin that read the prose would fail on the argument rather than the control.
	 */
	const code = viewer
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
	assert.doesNotMatch(code, /onDelete|deleteGoal|ConfirmationModal|delete/i);
});
