import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
	inlineEditChromeShown,
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

/*
 * The § 2.2 dirty-gate (design round 1, D2): the check/x exist only while the
 * draft differs from its base. The `editing` frame drew them on a merely
 * focused, unchanged title, which read as "you have an unsaved change" the
 * moment a field was clicked. `saving` and `error` keep their doors whatever
 * the dirty reading says - and the pinned cases below spell that out, because
 * a future simplification of this function to `dirty` alone would silently
 * close the retry's door in `error`.
 */
test("the chrome gate: check/x only on a dirty draft", () => {
	assert.equal(inlineEditChromeShown("editing", false), false);
	assert.equal(inlineEditChromeShown("editing", true), true);
	assert.equal(inlineEditChromeShown("saving", true), true);
	assert.equal(inlineEditChromeShown("error", true), true);
	assert.equal(inlineEditChromeShown("idle", false), false);
	assert.equal(inlineEditChromeShown("saved", false), false);
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
	/*
	 * AN ESCAPE ALREADY CONSUMED IS NOT THE FIELD'S (Scope A contract check,
	 * G1): Radix's `DismissableLayer` preventDefaults at the native capture
	 * phase when it closes a portalled menu, and react-dom copies that into
	 * the synthetic event - so this handler must stand down or one press
	 * closes the menu AND reverts the field, discarding the draft. The second
	 * press (nothing left to consume) reverts, which is why the two cases
	 * differ only by `defaultPrevented`.
	 */
	assert.equal(
		inlineEditKeyAction({ key: "Escape", defaultPrevented: true }, offEditor),
		null,
	);
	assert.equal(
		inlineEditKeyAction({ key: "Escape", defaultPrevented: false }, offEditor),
		"revert",
	);
	/*
	 * THE CHORD WORKS FROM THE FIELD'S OWN CHROME (round 1, n2): the
	 * description's Write|Preview toggle holds focus after a mode switch, and
	 * Cmd/Ctrl+Enter there means the same thing as in the textarea - while a
	 * BARE Enter off the editor stays the control's own activation, and the
	 * single-line rule keeps requiring the editor.
	 */
	const multiChrome = {
		multiline: true,
		keyboardCommit: true,
		onEditor: false,
	};
	assert.equal(
		inlineEditKeyAction({ key: "Enter", metaKey: true }, multiChrome),
		"accept",
	);
	assert.equal(
		inlineEditKeyAction({ key: "Enter", ctrlKey: true }, multiChrome),
		"accept",
	);
	assert.equal(inlineEditKeyAction({ key: "Enter" }, multiChrome), null);
	assert.equal(
		inlineEditKeyAction({ key: "Enter", metaKey: true }, offEditor),
		null,
	);
});

test("the tags comparator is two-argument: the never-clobber rule holds for tags", () => {
	/*
	 * The comparator the field passes to the machine is
	 * `(a, b) => tagsDraftEquals(parseProjectTags(a), b)` - BOTH sides are the
	 * draft-domain string. The defect this pins (round 1, M2): the field used
	 * to close over the live record, so `equals(base, fresh)` was vacuously
	 * true and the conflict could never fire. These two assertions exercise
	 * the comparator THROUGH the machine's reseed rule.
	 */
	const equals = (a, b) => tagsDraftEquals(parseProjectTags(a), b);
	const ask = (phase, base, draft, fresh) =>
		inlineEditReseed({ phase, base, draft, fresh, equals });

	/* Spacing is not a change, on either side of the comparison. */
	assert.equal(equals("q4, payments", "q4,payments"), true);
	assert.equal(equals("q4,payments", "q4, payments"), true);
	assert.equal(equals("q4", "q4, payments"), false);

	/* The record moves under a CLEAN draft: adopt silently, never revert. */
	assert.equal(ask("editing", "a, b", "a, b", "a, z"), "adopt");
	/* The record moves under a DIRTY draft that does not touch it: commit. */
	assert.equal(ask("editing", "a, b", "a, c", "a, b"), "none");
	/* The record moves under a DIRTY draft on the same list: hold. */
	assert.equal(ask("editing", "a, b", "a, c", "a, c, d"), "conflict");
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
	assert.equal(
		projectDateFieldRule("2026-9-30"),
		"Dates are YYYY-MM-DD, or empty.",
	);
	assert.equal(
		projectDateFieldRule("tomorrow"),
		"Dates are YYYY-MM-DD, or empty.",
	);
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
	/*
	 * The gate's OWN shape (design round 1, D4): the daemon's log-register head
	 * is rewritten in the app's sentence, the count and the names kept verbatim
	 * so the reader still learns exactly what blocks the close. Exact strings,
	 * because this is copy a reviewer measured.
	 */
	const gate = (count) =>
		`cannot set status 'done': ${count} milestone${count === 1 ? "" : "s"} still incomplete ('rig milestone') — complete them, or pass force_done=true to close with them open`;
	assert.equal(
		projectRefusalCopy({ message: gate(1) }),
		"This can't be marked done yet: 1 milestone is still incomplete ('rig milestone'). Complete or remove the incomplete milestones, then mark it done.",
	);
	assert.equal(
		projectRefusalCopy({ message: gate(2) }),
		"This can't be marked done yet: 2 milestones are still incomplete ('rig milestone'). Complete or remove the incomplete milestones, then mark it done.",
	);
	/* Anything else passes through; nothing at all falls back honestly. */
	assert.equal(
		projectRefusalCopy({ message: "target_date must not precede start_date" }),
		"target_date must not precede start_date",
	);
	assert.equal(
		projectRefusalCopy({ message: "" }),
		"The project was not saved.",
	);
});

/* ------------------------------------------- projects: the estimate pair */

test("the estimate draft's identity: value-compared, empty keeps", () => {
	assert.equal(
		estimateDraftEquals(
			{ number: "13", unit: "points" },
			{ number: "13", unit: "points" },
		),
		true,
	);
	/* "13.0" is not a change from "13". */
	assert.equal(
		estimateDraftEquals(
			{ number: "13", unit: "points" },
			{ number: "13.0", unit: "points" },
		),
		true,
	);
	assert.equal(
		estimateDraftEquals(
			{ number: "13", unit: "points" },
			{ number: "13", unit: "days" },
		),
		false,
	);
	/* An emptied number asks to KEEP the current value. */
	assert.equal(
		estimateDraftEquals(
			{ number: "13", unit: "points" },
			{ number: "", unit: "points" },
		),
		true,
	);
	assert.equal(
		estimateDraftEquals(
			{ number: "", unit: "points" },
			{ number: "5", unit: "points" },
		),
		false,
	);
});

test("the estimate reseed reads the draft second: an emptied draft adopts a moved record", () => {
	/*
	 * Round 2 m-A's exact case, through the real decision function: the user
	 * EMPTIED the number (draft ""), the record moved (13 -> 20). The emptied
	 * draft asks for no write, so there is nothing to hold - the reseed must
	 * adopt. The old call order passed the draft FIRST there
	 * (`equals(draft, base)`), the comparator's directional exception did not
	 * apply, and the field raised a "changed elsewhere" conflict over a
	 * request it would never send.
	 */
	const d = (number, unit = "points") => ({ number, unit });
	const reseed = (base, draft, fresh) =>
		inlineEditReseed({
			phase: "editing",
			base,
			draft,
			fresh,
			equals: estimateDraftEquals,
		});
	/* The emptied draft moved under a moved record: adopt, never hold. */
	assert.equal(reseed(d("13"), d(""), d("20")), "adopt");
	/* A clean draft over the same move: adopt (§ 2.4 case 1, preserved). */
	assert.equal(reseed(d("13"), d("13"), d("20")), "adopt");
	/* A dirty draft on the same field: the hold is real. */
	assert.equal(reseed(d("13"), d("15"), d("20")), "conflict");
	/* A born row, still empty, under a record that gained an estimate: adopt. */
	assert.equal(reseed(d(""), d(""), d("7")), "adopt");
	/* A born row WITH a typed value under a moved record: hold. */
	assert.equal(reseed(d(""), d("5"), d("7")), "conflict");
});

test("the estimate's changed fields: only what moved, never a fake clear", () => {
	const base = { estimate: 13, unit: "points" };
	/* A changed number travels alone. */
	assert.deepEqual(
		estimateChangedFields(base, { number: "7", unit: "points" }),
		{
			estimate: 7,
		},
	);
	/* A unit alone may change. */
	assert.deepEqual(
		estimateChangedFields(base, { number: "13", unit: "days" }),
		{
			estimate_unit: "days",
		},
	);
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
	assert.equal(
		estimateChangedFields(base, { number: "", unit: "points" }),
		null,
	);
	assert.deepEqual(estimateChangedFields(base, { number: "", unit: "days" }), {
		estimate_unit: "days",
	});
	/* From no estimate, a number is the change. */
	assert.deepEqual(
		estimateChangedFields(
			{ estimate: null, unit: "points" },
			{ number: "5", unit: "points" },
		),
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

/* ------------------------------------------------- the wiring guards */

/*
 * THE RETRY'S PRESS IS NOT A VALUE (QA round 1, Q2, 4/4 runs). `onClick`
 * hands the handler the MouseEvent, so `onClick={api.accept}` fed the event
 * into the machine AS the new value: the status arm's payload carried it to
 * the IPC boundary, died at structured clone, and surfaced as "could not
 * reach the backend" with the daemon never seeing a request - while the key
 * arm failed differently on the same wiring. The machine cannot police this
 * (its `next` is generic by design), so the contract lives in the wiring and
 * is pinned here at the source: an empty-call arrow, and no bare reference.
 * A source read rather than a render, deliberately: there is no DOM in this
 * suite, and the failure mode is exactly a one-character edit away.
 */
test("the feedback Retry never passes its press event as the value", () => {
	const source = readFileSync(
		"src/renderer/src/shared/components/inline-edit/inline-edit-feedback.tsx",
		"utf8",
	);
	assert.ok(
		source.includes("onClick={() => api.accept()}"),
		"the Retry button must call accept with no arguments",
	);
	assert.ok(
		!source.includes("onClick={api.accept}"),
		"onClick={api.accept} passes the MouseEvent as the new value (Q2)",
	);
});

/*
 * THE ESCAPE-CONSUMED GUARD'S STRUCTURAL SIBLING (Scope A, G1) is pinned in
 * the model's keyboard-contract test above; this guard is its wiring half:
 * the feedback's conflict doors are plain handlers with no arguments to
 * smuggle, and they must stay call-shaped if they ever grow one.
 */
test("the conflict doors are wired as calls, not references", () => {
	const source = readFileSync(
		"src/renderer/src/shared/components/inline-edit/inline-edit-feedback.tsx",
		"utf8",
	);
	assert.ok(source.includes("onClick={api.keepMine}"));
	assert.ok(source.includes("onClick={api.useTheirs}"));
});
