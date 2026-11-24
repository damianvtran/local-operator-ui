/**
 * The project status menu and the create sheet's description seed follow the
 * ACTIVE locale, not the one that was active when the module loaded.
 *
 *     node --test scripts/project-status-options-i18n.test.mjs
 *
 * WHY THIS SUITE EXISTS. Two English leaks survived a switch to French:
 *
 * - E1: the status selects (create sheet and the detail's inline editor) read
 *   `PROJECT_STATUS_OPTIONS`, whose labels were resolved by `.map()` at module
 *   load - before the backend's language had been negotiated - so the menu said
 *   "Planning / Active / QA" while the chips beside it said "Planification /
 *   Actif". The fix is `projectStatusOptions()`, read at render time.
 * - E2: the create sheet seeded the description with the English skeleton
 *   "## Summary / ## Goals / ## Notes". The fix keys the three headings and
 *   builds the seed in the active locale when the sheet opens.
 *
 * HOW THE MODULE-LOAD BUG IS REPRODUCED: the bundle is imported while the store
 * is still English (as in the app before negotiation), and only THEN is the
 * locale switched to `fr`. A label captured at load is English here; a label
 * read at call time is French.
 *
 * The two families are independent tests so the status menu (whose French
 * labels already ship) does not wait on the heading translations. The heading
 * test reads its expectation from the shipped fr catalogue and FAILS until the
 * translators add the three `ui.projects.project_sheet_model.template_*` keys -
 * that is deliberate: a fr seed falling back to English is the defect.
 *
 * - N1: the key and tag validation sentences were English literals returned
 *   by the shared contract (`projectNameRule` / `projectTagRule`), so a ur or
 *   zh-CN title - which derives an EMPTY key by design - showed "Give the
 *   project a name." in a translated sheet. The contract now returns copy keys
 *   and the renderer's `project-edit-model.ts` resolves them at call time. The
 *   N1 tests, like the heading test, read the fr catalogue and FAIL until the
 *   three `ui.projects.project_edit_model.{name_required,name_grammar,
 *   tag_grammar}` translations land; they also fail on the pre-fix code
 *   because the message is the English literal.
 * - RTL: the description textareas carry `dir={userTextDir(...)}` so the seed
 *   line "## Summary" is not drawn "Summary ##" under ur. Asserted on source,
 *   the `user-text-dir` convention's own evidence is in `user-text-dir.ts`.
 *
 * WHAT IT DOES NOT PROVE: pixels, or the repaint itself. Both select call sites
 * sit in components that subscribe through `useI18nLocale()` and call
 * `projectStatusOptions()` during render; the reactivity of that pattern is
 * pinned by `scripts/i18n/locale-reactivity.test.mjs`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * as model from "./src/renderer/src/features/projects/project-model";',
			'export * as sheet from "./src/renderer/src/features/projects/project-sheet-model";',
			'export * as edit from "./src/renderer/src/features/projects/project-edit-model";',
			'export * as contract from "./src/shared/desktop-contract";',
			'export { setLocale, currentLocale } from "./src/i18n";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared/i18n": resolve("src/i18n/index.ts"),
		"@shared": resolve("src/renderer/src/shared"),
	},
});
const { model, sheet, edit, contract, setLocale, currentLocale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const catalogue = (locale) =>
	JSON.parse(
		readFileSync(
			resolve(`src/i18n/catalogues/${locale}/ui.projects.json`),
			"utf8",
		),
	);
const en = catalogue("en");
const fr = catalogue("fr");

const STATUSES = [
	"planning",
	"active",
	"qa",
	"validation",
	"done",
	"paused",
	"archived",
];

/*
 * Read through the call-time API when it exists, else through the old
 * module-load constant: on the pre-fix code this makes the failure an
 * assertion about ENGLISH LABELS (the user-visible defect) rather than a
 * TypeError about a missing export.
 */
const statusOptions = () =>
	typeof model.projectStatusOptions === "function"
		? model.projectStatusOptions()
		: model.PROJECT_STATUS_OPTIONS;
const descriptionTemplate = () =>
	typeof sheet.projectDescriptionTemplate === "function"
		? sheet.projectDescriptionTemplate()
		: sheet.PROJECT_DESCRIPTION_TEMPLATE;

/* Node's default tag is `en-US`; either way the bundle loads in English. */
assert.match(currentLocale(), /^en\b/, "the bundle loads before any switch");

afterEach(() => setLocale("en"));

test("E1: status options are French after a switch to fr (wire values and order unchanged)", () => {
	const english = statusOptions().map((option) => ({ ...option }));
	assert.deepEqual(
		english.map((option) => option.value),
		STATUSES,
	);
	setLocale("fr");
	const french = statusOptions();
	assert.deepEqual(
		french.map((option) => option.value),
		STATUSES,
		"wire values and lifecycle order are not localized",
	);
	for (const [index, value] of STATUSES.entries()) {
		const key = `ui.projects.project_model.${value}`;
		assert.equal(french[index].label, fr[key], `${value} label in fr`);
		assert.equal(english[index].label, en[key], `${value} label in en`);
		/* The menu must say what the chip says. */
		assert.equal(french[index].label, model.projectStatusMeta(value).label);
	}
	assert.notDeepEqual(
		french.map((option) => option.label),
		english.map((option) => option.label),
		"switching locale changes the menu",
	);
});

const HEADINGS = ["summary", "goals", "notes"].map(
	(name) => `ui.projects.project_sheet_model.template_${name}`,
);

test("E2: the create-sheet description seed is built in the active locale (fr)", () => {
	for (const key of HEADINGS) {
		assert.ok(
			typeof fr[key] === "string" && fr[key].length > 0,
			`fr catalogue carries ${key} (translation pending until the translator round lands)`,
		);
	}
	setLocale("fr");
	assert.equal(
		descriptionTemplate(),
		HEADINGS.map((key) => `## ${fr[key]}`).join("\n\n"),
	);
});

test("E2: the English seed keeps its shape", () => {
	assert.equal(descriptionTemplate(), "## Summary\n\n## Goals\n\n## Notes");
});

test("E2: an untouched seed stays untouched across a locale switch before submit", () => {
	assert.equal(
		typeof sheet.authoredProjectDescription,
		"function",
		"the submit's seed test is a model function, not an inline constant compare",
	);
	const seeded = descriptionTemplate();
	/* The operator switches language with the sheet open, then submits. */
	setLocale("fr");
	const authored = sheet.authoredProjectDescription;
	assert.equal(authored(seeded, seeded), undefined, "untouched seed");
	assert.equal(authored(`  ${seeded}\n`, seeded), undefined, "whitespace only");
	assert.equal(authored("", seeded), undefined, "emptied");
	assert.equal(
		authored(`${seeded} x`, seeded),
		`${seeded} x`,
		"any edit ships",
	);
	assert.equal(authored("  Mine  ", seeded), "Mine", "trimmed");
});

/*
 * N1. Read through the renderer edge when it exists, else the pre-fix shared
 * rule, so the failure on old code is "the sentence is the English literal".
 */
const nameRule = (name) =>
	typeof edit.projectNameRule === "function"
		? edit.projectNameRule(name)
		: contract.projectNameRule(name);
const N1 = {
	name_required: "Give the project a key.",
	name_grammar:
		"Keys start with a letter or digit and may use letters, digits, dot, underscore or dash.",
	tag_grammar:
		"Tags are 1-24 characters of lowercase letters, digits, underscore or dash.",
};
const n1Key = (name) => `ui.projects.project_edit_model.${name}`;

test("N1: English validation sentences keep their wording (null = valid)", () => {
	for (const [name, english] of Object.entries(N1)) {
		assert.equal(en[n1Key(name)], english, `${name} English source`);
	}
	assert.equal(nameRule(""), N1.name_required);
	assert.equal(nameRule("bad key!"), N1.name_grammar);
	assert.equal(nameRule("good-key"), null);
	assert.equal(edit.projectTagsFieldRule("Q4").error, N1.tag_grammar);
	assert.equal(edit.projectTagsFieldRule("q4").error, null);
});

test("N1: the empty-name, bad-name and bad-tag sentences are French in fr", () => {
	setLocale("fr");
	const actual = {
		name_required: nameRule(""),
		name_grammar: nameRule("bad key!"),
		tag_grammar: edit.projectTagsFieldRule("Q4").error,
	};
	for (const [name, english] of Object.entries(N1)) {
		assert.notEqual(actual[name], english, `${name} is still English in fr`);
		assert.equal(
			actual[name],
			fr[n1Key(name)],
			`${name} equals the fr catalogue (translation pending until the translator round lands)`,
		);
	}
	assert.equal(nameRule("good-key"), null, "valid stays null in fr");
});

/* Hoisted for `useTopLevelRegex`: the description textarea's JSX element. */
const DESCRIPTION_TEXTAREA =
	/<Textarea\b[^>]*?data-project-description=""[\s\S]*?\/>/;

test("RTL: both description textareas let the operator's text pick its direction", () => {
	for (const [file, value] of [
		["project-form-dialog.tsx", "form.description"],
		["project-editors.tsx", "api.draft"],
	]) {
		const source = readFileSync(
			resolve(`src/renderer/src/features/projects/components/${file}`),
			"utf8",
		);
		const area = source.match(DESCRIPTION_TEXTAREA);
		assert.ok(area, `${file}: the description textarea`);
		assert.ok(
			area[0].includes(`dir={userTextDir(${value})}`),
			`${file}: dir={userTextDir(${value})} on the description textarea`,
		);
	}
});
