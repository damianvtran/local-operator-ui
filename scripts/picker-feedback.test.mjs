/**
 * The model picker's feedback contract, executable.
 *
 *     node --test scripts/picker-feedback.test.mjs
 *
 * The operator's report was "insufficient feedback on hover, click, etc to
 * indicate that the model selection change has happened". The design audit
 * measured it: the active row's ground was the dialog's own ground (1.000:1,
 * ΔE00 0.00), so hover, the keyboard highlight and "which row will Enter pick"
 * were all invisible; a per-provider listing failure replaced 1450 usable rows
 * with 21 provider names; and an in-flight pick said only "Working" while a
 * cold backend bind ran 1.1-4.2 s.
 *
 * What this file asserts, and HOW, is a deliberate half of the surface:
 *
 *   - the ROW is rendered for real (`renderToStaticMarkup` over the shipped
 *     `PickerRow`), so the ground classes, the ARIA state and the picked mark
 *     are read off the component's own output rather than off a constant;
 *   - the DECISIONS the component runs — the pointer/pick transitions, the body
 *     state, the footer's two labels, the catalogue's partial-vs-total failure
 *     — are asserted on the same exported functions the component calls, which
 *     is the discipline `usage-view-model.ts` and `session-model.ts` follow;
 *   - the WIRING that a bundle cannot reach (which prop the adapter passes,
 *     where the optimistic paint sits relative to the await) is pinned as
 *     source text, exactly as `contrast-contract.mjs`'s `STRUCTURAL_CALL_SITES`
 *     and `session-status.test.mjs`'s picker check pin theirs.
 *
 * What it does NOT prove: that any of it is VISIBLE. Contrast and layout are
 * the theme gates' and the rendered frames' job (docs/evidence/
 * model-picker-feedback), and this file would stay green if every palette
 * collapsed to one colour. It also cannot prove the two-theme palette
 * divergence this change deliberately navigated around — see the note in
 * `contrast-contract.mjs` on the row's ground.
 *
 * Colours are asserted as ROLES and CLASSES, never as hexes: the same rule the
 * branding contract states, and the reason a palette edit must not be able to
 * break this file while a class edit must.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = process.cwd();

/*
 * React and react-dom stay OUT of the bundle, so the module under test uses
 * this process's own React — the one `renderToStaticMarkup` below is holding. A
 * second bundled copy would render a tree from a different React and quietly
 * test nothing (hook dispatchers and element symbols are per-instance).
 *
 * `packages: "external"` keeps every package import bare, and the bundle is
 * therefore written to a real file rather than handed to `import()` as a
 * `data:` URL: a bare specifier cannot be resolved from a data URL, which the
 * three files that external React get away with only because their modules
 * import React's TYPES and emit nothing. A file under `node_modules/.cache/`
 * resolves exactly what this process resolves, to the same paths, therefore to
the same React instance. */
const CACHE = join(ROOT, "node_modules/.cache/picker-feedback");
const bundleInto = async (name, contents) => {
	const bundle = await build({
		stdin: { contents, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		jsx: "automatic",
		packages: "external",
		loader: { ".css": "empty" },
		// The renderer's own aliases, from `electron.vite.config.js`.
		alias: {
			"@shared": resolve("src/renderer/src/shared"),
			"@renderer": resolve("src/renderer/src"),
		},
		write: false,
	});
	mkdirSync(CACHE, { recursive: true });
	const file = join(CACHE, `${name}.mjs`);
	writeFileSync(file, bundle.outputFiles[0].text);
	return import(pathToFileURL(file).href);
};

const {
	PickerRow,
	PICKER_LIST_INITIAL,
	pickerListReducer,
	pickerBodyKind,
	pickerFooterHint,
	pickerPrimaryLabel,
} = await bundleInto(
	"picker-host",
	`
	export {
		PickerRow,
		PICKER_LIST_INITIAL,
		pickerListReducer,
		pickerBodyKind,
		pickerFooterHint,
		pickerPrimaryLabel,
	} from "./src/renderer/src/features/chat/pickers/picker-host";
`,
);

const { catalogueListing, failedProviders } = await bundleInto(
	"catalogue-listing",
	`
	export { catalogueListing, failedProviders } from "./src/renderer/src/features/chat/pickers/model-catalogue-listing";
`,
);

const { modelSelector } = await bundleInto(
	"session-model",
	`
	export { modelSelector } from "./src/renderer/src/features/chat/session-status/session-model";
`,
);

const source = (rel) =>
	readFileSync(join(ROOT, "src/renderer/src", rel), "utf8");

/* ------------------------------------------------------------ the row */

const OPTION = {
	value: "anthropic/claude-opus-5",
	label: "Claude Opus 5",
	description: "anthropic",
	meta: "200k",
};

const rowHtml = (over = {}) =>
	renderToStaticMarkup(
		createElement(PickerRow, {
			id: "opt-0",
			option: OPTION,
			index: 0,
			isActive: false,
			isHovered: false,
			isPicked: false,
			onHover: () => {},
			onPick: () => {},
			...over,
		}),
	);

/** The row's own class list, off the rendered element. */
const classesOf = (html) =>
	html.match(/^<div[^>]*\bclass="([^"]*)"/)?.[1] ?? "";

test("the active row's ground is not the ground it is drawn on", () => {
	/*
	 * The defect D1 is exactly this comparison, so the test states it as one:
	 * the dialog's ground, read from the component that draws it, must not be
	 * the class the active row paints.
	 */
	const dialog = source("shared/components/ui/dialog.tsx");
	assert.match(
		dialog,
		/bg-elevated/,
		"the dialog's ground is `elevated`; if that moved, this test's premise did too",
	);

	const active = classesOf(rowHtml({ isActive: true }));
	assert.match(active, /\bbg-sunken\b/, "the active row paints a ground");
	assert.doesNotMatch(
		active,
		/\bbg-elevated\b/,
		"the active row cannot paint the dialog's own ground — that is 1.000:1 and ΔE00 0.00",
	);
});

test("the pointer's and the in-flight mark carry a floored role, not only a wash", () => {
	/*
	 * Design D12, stated as the role rather than as the class string.
	 *
	 * The pointer's tint is `accent-wash`, which collapses onto the dialog's own
	 * ground in obsidian (ΔE00 0.77) and is weak in three more themes — so a
	 * wash-only mark was NO mark at all in the theme the audit measured, which is
	 * the operator's original report surviving the fix. The structural half is
	 * `outline-control`: a role the contrast contract asserts at 3:1 against this
	 * same ground (`picker row pointer mark`), so the mark cannot be washed away
	 * by a palette. This test asserts the row RENDERS that role; the palette's
	 * half of the claim is the contract's, because a colour table cannot see a
	 * class and this file cannot see a palette (see the header).
	 */
	const hovered = classesOf(rowHtml({ isHovered: true }));
	assert.match(
		hovered,
		/\boutline-control\b/,
		"the pointer's mark carries a structural role; the wash alone is invisible in obsidian",
	);
	assert.match(
		hovered,
		/\bbg-accent-wash\b/,
		"and keeps the tint where it reads",
	);

	const picked = classesOf(rowHtml({ isPicked: true }));
	assert.match(
		picked,
		/\boutline-control\b/,
		"the in-flight row keeps its mark even after the pointer leaves it",
	);

	const idle = classesOf(rowHtml());
	assert.doesNotMatch(
		idle,
		/\boutline-control\b|\bbg-accent-wash\b|\bbg-sunken\b/,
		"an untouched row is still pixel-identical to the dialog",
	);

	// The contract is asserted here as well as in the theme gate, because a
	// palette edit cannot hide behind a green test and a class edit cannot hide
	// behind a green colour table: the two halves fail independently.
	const contract = readFileSync(
		join(ROOT, "scripts/contrast-contract.mjs"),
		"utf8",
	);
	assert.match(
		contract,
		/picker row pointer mark/,
		"the mark's role is asserted against the dialog's own ground in the theme gate",
	);
	assert.match(
		contract,
		/outline-solid outline-1 -outline-offset-1 outline-control/,
		"and the call site that renders it is pinned there too",
	);
});

test("the pointer's mark and the keyboard's mark are different states", () => {
	const hovered = rowHtml({ isHovered: true });
	const active = rowHtml({ isActive: true });
	assert.notEqual(
		classesOf(hovered),
		classesOf(active),
		"hover and the keyboard highlight must be distinguishable, or the user cannot tell which row Enter picks",
	);
	assert.match(classesOf(hovered), /\bbg-accent-wash\b/);
	assert.match(classesOf(active), /\bbg-sunken\b/);

	// D2's third case, and the one that reads wrongly if the two rules are not
	// exclusive: the pointer resting on the row the keyboard has ALSO selected
	// must not paint the pointer's tint on top of the selection ground, or the
	// dormant mark looks like the live one.
	assert.doesNotMatch(
		classesOf(rowHtml({ isHovered: true, isActive: true })),
		/\bbg-accent-wash\b/,
		"the pointer's tint is dropped on the row that already carries the selection",
	);

	// The pointer must not claim the selection: `aria-selected` is the keyboard's
	// row, and it is what a screen reader announces as "the row Enter picks".
	assert.match(hovered, /aria-selected="false"/);
	assert.match(active, /aria-selected="true"/);
	assert.match(hovered, /data-hovered="true"/);
	assert.doesNotMatch(active, /data-hovered/);
});

test("the pointer clears on leave; the picked mark survives it", () => {
	/*
	 * Two distinct lifetimes, which is the whole of D2/D3: leaving the list
	 * clears the POINTER's mark, and only the operation settling clears the
	 * PICKED one. Reverting to one `active` state — what the component did
	 * before — makes the first assertion impossible to satisfy: the highlight
	 * could no longer clear without also moving the selection.
	 */
	let state = pickerListReducer(PICKER_LIST_INITIAL, {
		type: "hover",
		index: 4,
	});
	assert.equal(state.hovered, 4);

	state = pickerListReducer(state, { type: "pick", value: OPTION.value });
	assert.deepEqual(state, { hovered: 4, picked: OPTION.value });

	state = pickerListReducer(state, { type: "leave" });
	assert.equal(state.hovered, null, "leaving the list clears the pointer");
	assert.equal(state.picked, OPTION.value, "and does not clear the pick");

	state = pickerListReducer(state, { type: "settle" });
	assert.equal(state.picked, null, "the operation settling clears the mark");
	assert.equal(
		pickerListReducer(state, { type: "reset" }),
		PICKER_LIST_INITIAL,
		"re-opening the picker clears both",
	);
});

test("the picked row carries a mark, in the meta slot, until it settles", () => {
	const idle = rowHtml();
	const picked = rowHtml({ isPicked: true });
	assert.match(idle, /200k/, "the row's meta slot is the machine detail");
	assert.doesNotMatch(
		picked,
		/200k/,
		"the mark REPLACES the meta slot rather than sitting beside it, so the row cannot change height while the answer is pending",
	);
	// The default names the change generically; an adapter that knows what it is
	// doing passes its own words (`/model` passes "Switching the model").
	assert.match(picked, /Applying the change/);
	assert.match(
		rowHtml({ isPicked: true, busyLabel: "Switching the model" }),
		/Switching the model/,
		"the adapter's own words reach the announcement",
	);
	// A visible spinner is not enough on its own: `Spinner` only carries meaning
	// in the accessibility tree when it is given a label.
	assert.match(picked, /role="status"/);
	assert.doesNotMatch(
		idle,
		/role="status"/,
		"nothing is in flight before a pick",
	);
});

/* --------------------------------------------------------- the footer */

test("the footer never advertises controls that do nothing, and names the pick", () => {
	assert.equal(
		pickerFooterHint({ busy: false, hasList: true, rowCount: 0 }),
		"Esc closes",
		"with no rows there is nothing to move through (design D6)",
	);
	assert.equal(
		pickerFooterHint({ busy: false, hasList: false, rowCount: 0 }),
		"Esc closes",
	);
	assert.equal(
		pickerFooterHint({ busy: false, hasList: true, rowCount: 12 }),
		"Arrows move, Enter picks, Esc closes",
	);
	assert.match(
		pickerFooterHint({ busy: true, hasList: true, rowCount: 12 }),
		/Applying the change/,
		"'Working' alone is not feedback for a 1.1-4.2 s wait (D3/U2)",
	);
	assert.match(
		pickerFooterHint({
			busy: true,
			hasList: true,
			rowCount: 12,
			busyText: "Switching the model…",
		}),
		/Switching the model/,
		"the adapter names the change; 'the backend' is the implementation's noun (D14)",
	);

	/*
	 * UX U1, as the invariant rather than as a suggestion: the row Enter acts on
	 * can be scrolled out of view — the audit scrolled 1800px and picked a row
	 * 1492px above the fold — so the footer NAMES that row. Hover does not steer
	 * it (design D2), so a word is the only thing that can say which row the key
	 * is about while the pointer rests elsewhere.
	 */
	assert.equal(
		pickerFooterHint({
			busy: false,
			hasList: true,
			rowCount: 12,
			activeLabel: "GPT-5.6 Sol",
		}),
		"Arrows move · Enter picks GPT-5.6 Sol · Esc closes",
	);
});

test("closing while busy is called Close, not Cancel", () => {
	// The dialog closing does not cancel the operation the owner is already
	// performing, so the word has to describe what the control does (D3), and
	// it is the same word the Esc hint uses — one action, one name (D15).
	assert.equal(pickerPrimaryLabel({ busy: true, result: null }), "Close");
	assert.equal(pickerPrimaryLabel({ busy: false, result: null }), "Close");
	assert.equal(
		pickerPrimaryLabel({
			busy: false,
			result: { tone: "success", text: "ok" },
		}),
		"Done",
	);
	assert.equal(
		pickerPrimaryLabel({ busy: false, result: { tone: "error", text: "no" } }),
		"Close",
	);
});

/* ----------------------------------------------------------- the body */

test("a partial listing failure keeps the list and only adds a note", () => {
	const rows = { models: [{ provider: "anthropic", model_id: "x" }] };
	const partial = catalogueListing(
		{
			...rows,
			source: "initial",
			errors: { openrouter: "no credential", zai: "timeout" },
			credentials_known: true,
		},
		{ isError: false, error: null },
		String,
	);
	assert.equal(
		partial.loadError,
		null,
		"a provider that failed is not a listing that failed — the rows are still there (D4)",
	);
	/*
	 * The note is the COUNT and the ids are the tooltip (D16, UX nit): the
	 * operator's own catalogue produced 21 of them, three wrapped lines at the top
	 * of the dialog before any row was reachable. Both halves are asserted,
	 * because a count with nowhere to put the names would be the same
	 * information deleted rather than moved.
	 */
	assert.match(partial.notice ?? "", /\(2\)/);
	assert.doesNotMatch(
		partial.notice ?? "",
		/openrouter/,
		"the ids are not the sentence any more",
	);
	assert.equal(partial.noticeDetail, "openrouter, zai");

	const clean = catalogueListing(
		{ ...rows, source: "initial", errors: {}, credentials_known: true },
		{ isError: false, error: null },
		String,
	);
	assert.deepEqual(clean, {
		loadError: null,
		notice: null,
		noticeDetail: null,
	});

	const total = catalogueListing(
		undefined,
		{
			isError: true,
			error: new Error("the transport refused it"),
		},
		(error) => (error instanceof Error ? error.message : String(error)),
	);
	assert.match(total.loadError ?? "", /transport refused/);
	assert.equal(total.notice, null);

	assert.deepEqual(failedProviders({ errors: { a: "x" } }), ["a"]);
	assert.deepEqual(failedProviders(undefined), []);
});

test("the body's four states are ordered, and a note is not one of them", () => {
	assert.equal(
		pickerBodyKind({ loading: true, loadError: "x", rowCount: 3 }),
		"loading",
	);
	assert.equal(
		pickerBodyKind({ loading: false, loadError: "x", rowCount: 3 }),
		"error",
	);
	assert.equal(
		pickerBodyKind({ loading: false, loadError: null, rowCount: 0 }),
		"empty",
	);
	// The 1450-row case the audit measured: rows present, one provider failed.
	assert.equal(
		pickerBodyKind({ loading: false, loadError: null, rowCount: 1450 }),
		"list",
	);
});

/* -------------------------------------------------- naming and wiring */

test("a spec with an empty half names nothing", () => {
	// D9: `This session runs /.` came from interpolating a half-empty spec.
	assert.equal(modelSelector({ provider: "", model_id: "gpt-5" }), null);
	assert.equal(modelSelector({ provider: "anthropic", model_id: "" }), null);
	assert.equal(modelSelector(null), null);
	assert.equal(modelSelector(undefined), null);
	assert.equal(
		modelSelector({ provider: "anthropic", model_id: "claude-opus-5" }),
		"anthropic/claude-opus-5",
	);
});

test("the adapter wires the decisions the tests above pin", () => {
	const picker = source("features/chat/pickers/destination-pickers.tsx");

	// D4: the partial note goes to `notice`, and only the query's own failure to
	// `loadError`. Both halves are asserted because the defect was passing the
	// note to the wrong prop while both props looked correct in isolation. The
	// ids travel beside it in `noticeDetail`, which is the tooltip (D16).
	assert.match(picker, /const listing = catalogueListing\(/);
	assert.match(picker, /notice=\{listing\.notice\}/);
	assert.match(picker, /noticeDetail=\{listing\.noticeDetail\}/);
	assert.match(picker, /loadError=\{listing\.loadError\}/);

	// U4: the live re-list must not blank the list it is refreshing.
	assert.match(picker, /placeholderData: keepPreviousData/);
	assert.match(
		picker,
		/import \{[\s\S]*keepPreviousData[\s\S]*\} from "@tanstack\/react-query"/,
	);

	// D8: a pending live fetch gets a pending label, and the label that says so
	// is the one this file's own copy assertion can see.
	assert.match(picker, /Refreshing…/);

	/*
	 * D13: the settled control must still DO something. `Live list` looked like an
	 * enabled button and `setLive(true)` on an already-live picker changed nothing
	 * and said nothing, so the label states a verb and the click re-lists.
	 */
	assert.match(picker, /catalogue\.refetch\(\)/);
	assert.match(picker, /Refresh from providers/);
	assert.doesNotMatch(
		picker,
		/"Live list"/,
		"a settled label that names a fact rather than an action is what D13 filed",
	);

	// D7: the checkbox's label states the consequence while it is ticked.
	assert.match(picker, /This pick also sets the default for new sessions/);

	/*
	 * D14: the in-flight copy names the change. Asserted on the props the adapter
	 * passes, because the words live in the host's defaults for every other
	 * destination.
	 */
	assert.match(picker, /busyText="Switching the model…"/);
	assert.match(picker, /busyLabel="Switching the model"/);

	/*
	 * UX U1's invariant has two halves, and this is the second: a CLICK moves the
	 * keyboard's row to the row it clicked. Without it the one row still marked as
	 * "selected" was one the user never chose, for the whole wait.
	 */
	assert.match(
		source("features/chat/pickers/picker-host.tsx"),
		/setActive\(index\);\n\t\tvoid pickRef\.current\(option\)/,
	);

	/*
	 * QA Q1: "switched and runnable" and "switched but needs sign-in" must not
	 * produce the same strip. The caveat is appended to the owner's own text and
	 * the tone steps off `success`; without both, the two outcomes read alike.
	 */
	assert.match(picker, /switchedNeedsSignIn/);
	assert.match(picker, /tone: "warning"/);
	assert.match(picker, /SIGN_IN_CAVEAT/);

	// QA Q2: the in-force check mark follows the receipt, not the next owner
	// frame, and is dropped once the authoritative selector agrees.
	assert.match(picker, /pickedCurrent/);
});

test("one binding answers which model the session is on", () => {
	/*
	 * UX U7. The ✓ and the header sentence read two different fields, so the
	 * dialog disagreed with itself for the whole window in which the owner's frame
	 * lagged a successful switch: the strip, the band and the row mark named the
	 * new model while the header still claimed the old one, measured over 100
	 * samples spanning 15.4 s and never resolving.
	 *
	 * The pin is the ONE binding both call sites read, plus the shape of the
	 * defect stated as a negative: a class edit or a refactor that re-derives
	 * either call site from `selected_model` alone has to delete the binding
	 * first, and that is the defect coming back.
	 */
	const picker = source("features/chat/pickers/destination-pickers.tsx");
	assert.match(
		picker,
		/const shownSelector = pickedCurrent \?\? currentSelector/,
		"the picker's one answer to which model this session is on",
	);
	const options = picker.slice(picker.indexOf("const options = useMemo"));
	assert.match(
		options,
		/current:\s*shownSelector === \(row\.selector \?\? row\.value\)/,
		"the in-force row mark reads that binding rather than a field of its own",
	);
	assert.match(
		picker,
		/description=\{\s*shownSelector\s*\?\s*`This session runs \$\{shownSelector\}/,
		"and so does the header sentence",
	);
	assert.doesNotMatch(
		picker,
		/This session runs \$\{currentSelector\}/,
		"the header cannot read the owner's field alone — that is UX U7",
	);
});

test("the pick is painted before the owner is awaited, and rolled back on refusal", () => {
	/*
	 * U1's ordering is the fix, so it is asserted as an ORDER rather than as
	 * three separate presences: a paint that happened after the await would still
	 * exist in the file and would register nothing until the round trip (1.1-4.2 s
	 * cold) had already finished.
	 *
	 * Two anchors, not a textual window. The window this test used to assert
	 * (`slice(await_ - 400, rollback)`) pinned the DISTANCE between three
	 * statements, so extracting a predicate or renaming a local moved it while the
	 * behaviour was intact (reviewer round 1, test design). Index comparison says
	 * the same thing without pinning the lines between.
	 */
	const picker = source("features/chat/pickers/destination-pickers.tsx");
	const onPick = picker.slice(picker.indexOf("const onPick = useCallback("));
	const paint = onPick.indexOf("canonical.paintPendingModel(model)");
	const await_ = onPick.indexOf('await command.run("model", value)');
	const rollback = onPick.indexOf("canonical.clearPendingModel()");
	assert.ok(
		paint > -1 && await_ > paint,
		"the optimistic paint must come before the command is awaited",
	);
	assert.ok(
		rollback > await_,
		"and the refusal path must drop it after the outcome is known",
	);

	/*
	 * UX U2, and the reason the outcome is no longer written on the close edge:
	 * closing during the wait is the natural response to a long one, and the
	 * refusal used to have no home by then. The note is written where the answer
	 * lands, from the same call's result, so the strip and the transcript cannot
	 * disagree.
	 */
	const note = onPick.indexOf("note(`The model was not changed.");
	assert.ok(note > rollback, "the failure is reported when the answer arrives");
	assert.match(onPick, /failure\.text/, "in the strip's own words");
	assert.doesNotMatch(
		picker,
		/closeWithOutcome/,
		"a write on the close edge is exactly the gap U2 filed",
	);
});

test("the handle reconciles the paint against the owner's own frames", () => {
	const hook = source("shared/hooks/use-canonical-session.ts");
	// The reconciliation is the other half of an optimistic value: without it the
	// pending mark would be permanent, and with a looser comparison it would be
	// dropped by the next unrelated frame instead.
	assert.match(hook, /modelSelector\(frontend\?\.selected_model\) === painted/);
	assert.match(
		hook,
		/modelSelector\(frontend\?\.effective_model\) === painted/,
	);
	assert.match(hook, /const PENDING_MODEL_TIMEOUT_MS/);
	assert.match(hook, /pendingModel: null,/);

	// And the strip is what draws it, from the prop the page passes.
	const page = source("features/chat/components/chat-page.tsx");
	assert.match(page, /pendingModel: canonical\.pendingModel/);
	const strip = source("features/chat/session-status/session-status-strip.tsx");
	/*
	 * Reviewer round 1, major 1: the paint outranks the IDENTITY reading only.
	 * The painted spec is a row — provider, model_id, display name — so
	 * `effortState` answers `null` for it (no `reasoning_efforts`), and the effort
	 * chip vanished for the whole 1.1-4.2 s pending window before this rule
	 * existed. The reading is now drawn from the in-force spec, which is also the
	 * honest reading for that window: that is the model the session is running.
	 */
	assert.match(strip, /bandReadings\(frontend, pendingModel\)/);
	assert.match(strip, /effortState\(readings\.effort\)/);
	assert.doesNotMatch(
		strip,
		/effortState\(model\)/,
		"the effort reading cannot be taken off the paint",
	);
	// The pending state is no longer colour-and-tooltip only (U3).
	assert.match(strip, /Switching the model/);
});

test("the band does not take a reading off the optimistic paint", async () => {
	/*
	 * The BEHAVIOUR behind the pin above, exercised on the shipped rule rather
	 * than described: a session running a model with a ladder, plus a paint built
	 * the way the adapter builds one, must leave the effort reading intact. The
	 * reviewer reached this defect by bundling `session-model.ts` and calling
	 * `effortState` directly; this does the same through `bandReadings`, which is
	 * the function that decides it.
	 */
	const { bandReadings, effortState } = await bundleInto(
		"band-readings",
		`
		export { bandReadings, effortState } from "./src/renderer/src/features/chat/session-status/session-model";
	`,
	);
	const IN_FORCE = {
		provider: "anthropic",
		model_id: "claude-opus-5",
		display_name: "Claude Opus 5",
		reasoning_effort: "high",
		reasoning_efforts: ["minimal", "low", "medium", "high"],
	};
	const frontend = {
		selected_model: IN_FORCE,
		effective_model: IN_FORCE,
	};
	// The paint the adapter makes, verbatim: a provider, an id and a row label.
	const paint = {
		provider: "openai",
		model_id: "gpt-5.6-sol",
		display_name: "GPT-5.6 Sol",
	};

	const readings = bandReadings(frontend, paint);
	assert.equal(
		readings.identity,
		paint,
		"the identity reading is the user's paint, so the pick registers at once",
	);
	assert.equal(
		readings.effort,
		IN_FORCE,
		"and the effort reading stays on the model the session is running",
	);
	assert.notEqual(
		effortState(readings.effort),
		null,
		"the chip survives the pending window",
	);
	assert.equal(
		effortState(paint),
		null,
		"which is the defect: the painted spec has no ladder to read",
	);

	// The settled case, unchanged: both readings off the owner's own spec.
	const settled = bandReadings(frontend, null);
	assert.equal(settled.identity, IN_FORCE);
	assert.equal(settled.effort, IN_FORCE);
});

test("the listbox owns the pointer, and clears it on the way out", () => {
	const host = source("features/chat/pickers/picker-host.tsx");
	assert.match(host, /onMouseLeave=\{clearHovered\}/);
	// The defect's exact shape, pinned so it cannot come back by copy-paste: the
	// row that painted the dialog's own ground.
	assert.doesNotMatch(host, /isActive && "bg-elevated"/);
	/*
	 * UX U5: the scroll container reached the tab sequence on its own (Chrome
	 * makes a scrollable region focusable), drew a focus ring that reads as "this
	 * region is in play", and then answered neither arrow key nor Enter. `-1`
	 * keeps it programmatically reachable and out of the tab order, which is what
	 * the comment beside it had always claimed.
	 */
	assert.match(host, /tabIndex=\{-1\}/);
	const contract = readFileSync(
		join(ROOT, "scripts/contrast-contract.mjs"),
		"utf8",
	);
	assert.match(
		contract,
		/picker option row selection ground/,
		"the call site is pinned in the theme gate too, where a palette edit cannot hide it",
	);
});
