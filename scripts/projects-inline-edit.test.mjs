import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The inline-edit slice's pure logic, executed in Node.
 *
 * Two modules under one file, because they are one contract seen from two
 * sides: `inline-edit-model.ts` is the machine shared by every surface (the
 * per-field contract of `docs/design/agents-inplace-shared-composer.md` § 2,
 * PR #725 — keyboard, dirty, re-seed, the never-clobber comparison), and
 * `project-edit-model.ts` is the projects lane's instance of it (the per-field
 * rules the wire enforces, the changed-fields computation the estimate row
 * needs, the refusal sentences). A future consumer (the agents/teams lane)
 * reuses the first and replaces the second, which is exactly why the two are
 * separate modules and this file keeps their cases separable.
 *
 * BUNDLED RATHER THAN IMPORTED (the `projects-sheet.test.mjs` pattern): these
 * are TypeScript modules in the renderer tree, and the app's tsconfig does not
 * run here. Both modules are importable without a DOM — the machine is pure by
 * construction and the projects model imports its DTOs with `import type` —
 * so nothing of React or Electron crosses into the bundle.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as machine from "./src/renderer/src/shared/components/inline-edit/inline-edit-model";',
			'export * as edit from "./src/renderer/src/features/projects/project-edit-model";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { machine, edit } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const {
	inlineEditAcceptSends,
	inlineEditDirty,
	inlineEditEditorShown,
	inlineEditKeyAction,
	inlineEditReseed,
} = machine;

const {
	estimateChangedFields,
	estimateDraftEquals,
	parseProjectTags,
	projectAttributionRule,
	projectDateFieldRule,
	projectDateOrderRule,
	projectDescriptionRule,
	projectEstimateNumberRule,
	projectRefusalCopy,
	projectTagsFieldRule,
	projectTitleRule,
	tagsDraftEquals,
} = edit;

/* ------------------------------------------------------------ the machine */

test("the dirty predicate is value-based, over any identity", () => {
	assert.equal(inlineEditDirty("a", "a"), false);
	assert.equal(inlineEditDirty("a", "b"), true);
	/* A non-primitive field says what identity means for it. */
	const equals = (a, b) => a.n === b.n;
	assert.equal(inlineEditDirty({ n: "1" }, { n: "1" }, equals), false);
	assert.equal(inlineEditDirty({ n: "1" }, { n: "2" }, equals), true);
});

test("the editor is shown for editing, saving and error - not for saved", () => {
	assert.equal(inlineEditEditorShown("editing"), true);
	assert.equal(inlineEditEditorShown("saving"), true);
	assert.equal(inlineEditEditorShown("error"), true);
	/* `saved` is the write having landed: the read view is back. */
	assert.equal(inlineEditEditorShown("saved"), false);
	assert.equal(inlineEditEditorShown("idle"), false);
});

test("the keyboard contract: Enter per field type, Escape always, modifiers", () => {
	const single = { multiline: false, keyboardCommit: true, onEditor: true };
	const multi = { multiline: true, keyboardCommit: true, onEditor: true };
	const select = { multiline: false, keyboardCommit: false, onEditor: true };
	const offEditor = { multiline: false, keyboardCommit: true, onEditor: false };

	assert.equal(inlineEditKeyAction({ key: "Enter" }, single), "accept");
	/* A bare Enter in a multiline field is a NEWLINE: not ours to claim. */
	assert.equal(inlineEditKeyAction({ key: "Enter" }, multi), null);
	assert.equal(
		inlineEditKeyAction({ key: "Enter", metaKey: true }, multi),
		"accept",
	);
	assert.equal(
		inlineEditKeyAction({ key: "Enter", ctrlKey: true }, multi),
		"accept",
	);
	/* A select trigger's Enter belongs to the trigger (its own activation). */
	assert.equal(inlineEditKeyAction({ key: "Enter" }, select), null);
	/* Enter on the check/x button stays the button's own activation. */
	assert.equal(inlineEditKeyAction({ key: "Enter" }, offEditor), null);
	/* Escape reverts the FIELD, from anywhere in it. */
	assert.equal(inlineEditKeyAction({ key: "Escape" }, offEditor), "revert");
	assert.equal(inlineEditKeyAction({ key: "Escape" }, multi), "revert");
	assert.equal(inlineEditKeyAction({ key: "a" }, single), null);
});

test("the accept sends only a change", () => {
	assert.equal(inlineEditAcceptSends("13", "13"), false);
	assert.equal(inlineEditAcceptSends("13", "14"), true);
});

test("the re-seed rule, all four cases of the note's § 2.4", () => {
	const equals = (a, b) => a === b;
	const ask = (phase, base, draft, fresh) =>
		inlineEditReseed({ phase, base, draft, fresh, equals });

	/* 1. not dirty: the record moves and the field adopts silently. */
	assert.equal(ask("editing", "old", "old", "new"), "adopt");
	assert.equal(ask("idle", "old", "old", "new"), "adopt");
	/* 2/3. dirty: unchanged-out-of-band commits normally (no conflict), the
	 * field's own move holds the commit. */
	assert.equal(ask("editing", "base", "draft", "base"), "none");
	assert.equal(ask("editing", "base", "draft", "other"), "conflict");
	/* A draft that already equals the fresh value has nothing to answer. */
	assert.equal(ask("editing", "base", "fresh", "fresh"), "adopt");
	/* The write in flight owns the field until it settles. */
	assert.equal(ask("saving", "base", "draft", "moved"), "none");
	assert.equal(ask("saved", "base", "draft", "moved"), "none");
	/* Error holds like a dirty editor. */
	assert.equal(ask("error", "base", "draft", "other"), "conflict");
});

/* ------------------------------------------------------- projects: rules */

test("the title rule: capped as the wire caps it, empty allowed (it clears)", () => {
	assert.equal(projectTitleRule("Short"), null);
	assert.equal(projectTitleRule(""), null);
	assert.equal(projectTitleRule("x".repeat(80)), null);
	assert.equal(
		projectTitleRule("x".repeat(81)),
		"Titles are at most 80 characters.",
	);
});

test("the description rule reads the shared constant", () => {
	assert.equal(projectDescriptionRule("ok"), null);
	assert.equal(
		projectDescriptionRule("x".repeat(241)),
		"Keep the description within 240 characters.",
	);
});

test("a date is YYYY-MM-DD or empty - nothing else", () => {
	assert.equal(projectDateFieldRule(""), null);
	assert.equal(projectDateFieldRule("2026-09-30"), null);
	assert.equal(projectDateFieldRule("2026-9-30"), "Dates are YYYY-MM-DD, or empty.");
	assert.equal(projectDateFieldRule("tomorrow"), "Dates are YYYY-MM-DD, or empty.");
});

test("the range rule fires only when both dates are set and backwards", () => {
	assert.equal(projectDateOrderRule("2026-09-01", "2026-09-30"), null);
	assert.equal(projectDateOrderRule("2026-09-01", ""), null);
	assert.equal(projectDateOrderRule("", "2026-09-30"), null);
	assert.equal(
		projectDateOrderRule("2026-09-30", "2026-09-01"),
		"The target date is before the start date.",
	);
	/* Equal days are not backwards. */
	assert.equal(projectDateOrderRule("2026-09-30", "2026-09-30"), null);
});

test("the estimate number: empty is valid (it keeps), 0 < n <= 1000", () => {
	assert.equal(projectEstimateNumberRule(""), null);
	assert.equal(projectEstimateNumberRule("  "), null);
	assert.equal(projectEstimateNumberRule("13"), null);
	assert.equal(projectEstimateNumberRule("0.5"), null);
	assert.equal(projectEstimateNumberRule("1000"), null);
	const sentence = "Estimates are greater than 0 and at most 1000.";
	assert.equal(projectEstimateNumberRule("0"), sentence);
	assert.equal(projectEstimateNumberRule("-3"), sentence);
	assert.equal(projectEstimateNumberRule("1001"), sentence);
	assert.equal(projectEstimateNumberRule("thirteen"), sentence);
});

test("the tags field: comma-parsed, capped at 8, grammar per tag, empty clears", () => {
	assert.deepEqual(projectTagsFieldRule(""), { tags: [], error: null });
	assert.deepEqual(projectTagsFieldRule("q4, payments"), {
		tags: ["q4", "payments"],
		error: null,
	});
	assert.deepEqual(projectTagsFieldRule(" q4 ,, payments , "), {
		tags: ["q4", "payments"],
		error: null,
	});
	/* The grammar's own sentence, from the shared rule. */
	assert.equal(
		projectTagsFieldRule("Q4").error,
		"Tags are 1-24 characters of lowercase letters, digits, underscore or dash.",
	);
	assert.equal(
		projectTagsFieldRule("Q4 Bad").error,
		"Tags are 1-24 characters of lowercase letters, digits, underscore or dash.",
	);
	const nine = Array.from({ length: 9 }, (_, i) => `t${i}`).join(", ");
	assert.equal(projectTagsFieldRule(nine).tags.length, 9);
	assert.equal(projectTagsFieldRule(nine).error, "Up to 8 tags.");
});

test("parseProjectTags is the one split both editors use", () => {
	assert.deepEqual(parseProjectTags("a, b ,c"), ["a", "b", "c"]);
	assert.deepEqual(parseProjectTags(","), []);
});

test("the attribution rule is the wire's 80, said per field", () => {
	assert.equal(projectAttributionRule("atlas", "owner"), null);
	assert.equal(
		projectAttributionRule("x".repeat(81), "owner"),
		"Owners are at most 80 characters.",
	);
	assert.equal(
		projectAttributionRule("x".repeat(81), "team"),
		"Teams are at most 80 characters.",
	);
});

/* ------------------------------------------------- projects: refusals */

test("a refused write, as the sentence beside the field", () => {
	assert.equal(
		projectRefusalCopy({
			code: "project_name_exists",
			message: "project 'x' already exists",
		}),
		"A project with this key already exists.",
	);
	/* The done-gate tail is re-spoken through refusalCopy. */
	const doneGate =
		"milestones paid, refunds are incomplete - complete them, or pass force_done=true to close with them open";
	assert.equal(
		projectRefusalCopy({ message: doneGate }),
		"milestones paid, refunds are incomplete - complete or remove the incomplete milestones, then mark it done",
	);
	/* Anything else passes through; nothing at all falls back honestly. */
	assert.equal(projectRefusalCopy({ message: "target_date must not precede start_date" }), "target_date must not precede start_date");
	assert.equal(projectRefusalCopy({ message: "" }), "The project was not saved.");
});

/* ------------------------------------------- projects: the estimate pair */

test("the estimate draft's identity: value-compared, empty keeps", () => {
	assert.equal(
		estimateDraftEquals({ number: "13", unit: "points" }, { number: "13", unit: "points" }),
		true,
	);
	/* "13.0" is not a change from "13". */
	assert.equal(
		estimateDraftEquals({ number: "13", unit: "points" }, { number: "13.0", unit: "points" }),
		true,
	);
	assert.equal(
		estimateDraftEquals({ number: "13", unit: "points" }, { number: "13", unit: "days" }),
		false,
	);
	/* An emptied number asks to KEEP the current value. */
	assert.equal(
		estimateDraftEquals({ number: "13", unit: "points" }, { number: "", unit: "points" }),
		true,
	);
	assert.equal(
		estimateDraftEquals({ number: "", unit: "points" }, { number: "5", unit: "points" }),
		false,
	);
});

test("the estimate's changed fields: only what moved, never a fake clear", () => {
	const base = { estimate: 13, unit: "points" };
	/* A changed number travels alone. */
	assert.deepEqual(estimateChangedFields(base, { number: "7", unit: "points" }), {
		estimate: 7,
	});
	/* A unit alone may change. */
	assert.deepEqual(estimateChangedFields(base, { number: "13", unit: "days" }), {
		estimate_unit: "days",
	});
	/* Both moved: both keys. */
	assert.deepEqual(estimateChangedFields(base, { number: "7", unit: "days" }), {
		estimate: 7,
		estimate_unit: "days",
	});
	/* Unchanged, in value terms, asks for nothing. */
	assert.equal(
		estimateChangedFields(base, { number: "13.0", unit: "points" }),
		null,
	);
	/* An EMPTIED number contributes nothing: the wire cannot clear one, and a
	 * save that claims it did would be the lie the hint exists to prevent. */
	assert.equal(estimateChangedFields(base, { number: "", unit: "points" }), null);
	assert.deepEqual(estimateChangedFields(base, { number: "", unit: "days" }), {
		estimate_unit: "days",
	});
	/* From no estimate, a number is the change. */
	assert.deepEqual(
		estimateChangedFields({ estimate: null, unit: "points" }, { number: "5", unit: "points" }),
		{ estimate: 5 },
	);
});

test("tagsDraftEquals compares the parsed list, so spacing alone is not a change", () => {
	assert.equal(tagsDraftEquals(["q4", "payments"], "q4,payments"), true);
	assert.equal(tagsDraftEquals(["q4", "payments"], "q4, payments"), true);
	assert.equal(tagsDraftEquals(["q4", "payments"], "q4"), false);
	assert.equal(tagsDraftEquals([], ""), true);
	assert.equal(tagsDraftEquals([], "q4"), false);
	assert.equal(tagsDraftEquals(["q4"], "q4, q4"), false);
});
