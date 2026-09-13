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
import { pathToFileURL } from "node:url";
import { test } from "node:test";
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
const classesOf = (html) => html.match(/^<div[^>]*\bclass="([^"]*)"/)?.[1] ?? "";

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
	assert.match(picked, /Waiting for the backend/);
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

test("the footer never advertises controls that do nothing", () => {
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
		/Waiting for the backend/,
		"'Working' alone is not feedback for a 1.1-4.2 s wait (D3/U2)",
	);
});

test("closing while busy is called Close, not Cancel", () => {
	// The dialog closing does not cancel the operation the owner is already
	// performing, so the word has to describe what the control does (D3).
	assert.equal(pickerPrimaryLabel({ busy: true, result: null }), "Close");
	assert.equal(pickerPrimaryLabel({ busy: false, result: null }), "Cancel");
	assert.equal(
		pickerPrimaryLabel({ busy: false, result: { tone: "success", text: "ok" } }),
		"Done",
	);
	assert.equal(
		pickerPrimaryLabel({ busy: false, result: { tone: "error", text: "no" } }),
		"Cancel",
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
	assert.match(partial.notice ?? "", /openrouter, zai/);

	const clean = catalogueListing(
		{ ...rows, source: "initial", errors: {}, credentials_known: true },
		{ isError: false, error: null },
		String,
	);
	assert.deepEqual(clean, { loadError: null, notice: null });

	const total = catalogueListing(undefined, {
		isError: true,
		error: new Error("the transport refused it"),
	}, (error) => (error instanceof Error ? error.message : String(error)));
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
	// note to the wrong prop while both props looked correct in isolation.
	assert.match(picker, /const listing = catalogueListing\(/);
	assert.match(picker, /notice=\{listing\.notice\}/);
	assert.match(picker, /loadError=\{listing\.loadError\}/);

	// D9: the shared selector, not a local expression that can regress.
	assert.match(picker, /const currentSelector = modelSelector\(selected\)/);

	// U4: the live re-list must not blank the list it is refreshing.
	assert.match(picker, /placeholderData: keepPreviousData/);
	assert.match(picker, /import \{[\s\S]*keepPreviousData[\s\S]*\} from "@tanstack\/react-query"/);

	// D8: a pending live fetch gets a pending label; the idle label is only for
	// idle.
	assert.match(picker, /const refreshing = live && catalogue\.isFetching/);
	assert.match(picker, /refreshing \? \(/);
	assert.match(picker, /Refreshing…/);

	// D7: the checkbox's label states the consequence while it is ticked.
	assert.match(picker, /This pick also sets the default for new sessions/);
});

test("the pick is painted before the owner is awaited, and rolled back on refusal", () => {
	/*
	 * U1's ordering is the fix, so it is asserted as an ORDER rather than as
	 * three separate presences: a paint that happened after the await would
	 * still exist in the file and would register nothing until the round trip
	 * (1.1-4.2 s cold) had already finished.
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
	assert.match(
		onPick.slice(await_ - 400, rollback),
		/outcome\.kind === "error"/,
		"a refused switch is what rolls the paint back",
	);
});

test("the handle reconciles the paint against the owner's own frames", () => {
	const hook = source("shared/hooks/use-canonical-session.ts");
	// The reconciliation is the other half of an optimistic value: without it the
	// pending mark would be permanent, and with a looser comparison it would be
	// dropped by the next unrelated frame instead.
	assert.match(hook, /modelSelector\(frontend\?\.selected_model\) === painted/);
	assert.match(hook, /modelSelector\(frontend\?\.effective_model\) === painted/);
	assert.match(hook, /const PENDING_MODEL_TIMEOUT_MS/);
	assert.match(hook, /pendingModel: null,/);

	// And the strip is what draws it, from the prop the page passes.
	const page = source("features/chat/components/chat-page.tsx");
	assert.match(page, /pendingModel: canonical\.pendingModel/);
	const strip = source("features/chat/session-status/session-status-strip.tsx");
	assert.match(strip, /pendingModel \?\? frontend\.effective_model/);
	assert.match(strip, /Waiting for the backend to confirm/);
});

test("the listbox owns the pointer, and clears it on the way out", () => {
	const host = source("features/chat/pickers/picker-host.tsx");
	assert.match(host, /onMouseLeave=\{clearHovered\}/);
	// The defect's exact shape, pinned so it cannot come back by copy-paste: the
	// row that painted the dialog's own ground.
	assert.doesNotMatch(host, /isActive && "bg-elevated"/);
	const contract = readFileSync(join(ROOT, "scripts/contrast-contract.mjs"), "utf8");
	assert.match(
		contract,
		/picker option row selection ground/,
		"the call site is pinned in the theme gate too, where a palette edit cannot hide it",
	);
});
