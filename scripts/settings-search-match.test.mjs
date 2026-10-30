import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE SETTINGS SEARCH'S RANKING, IN MEMORY.
 *
 * What this file pins, and why each is worth a test rather than a screenshot:
 *
 *  - **field weight order** — a label match outranks a description match for
 *    the same word, which is the difference between a usable palette-style list
 *    and an alphabetical dump;
 *  - **the reason is the field that scored** — a row that matched only on its
 *    help must not render "matched the name";
 *  - **no false reason** — when a field did not match, its reason cannot appear,
 *    which is asserted by constructing rows that match exactly one field at a
 *    time and reading the reason back;
 *  - **grouping** — headed blocks in best-first order, with the context-less
 *    bucket last;
 *  - **the cap** — the panel's 12 rows plus a total, so the UI can say "+N more"
 *    instead of rendering 230 nodes.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/settings/search/settings-search-match";\nexport { buildRegistryEntries, buildSettingsIndex } from "./src/renderer/src/features/settings/search/settings-search-index";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	SETTINGS_SEARCH_CAP,
	groupSettingResults,
	isBlankQuery,
	scoreEntry,
	searchSettings,
} = module;

/*
 * Entries carry PRE-FOLDED haystacks (that is the builders' contract), so this
 * helper folds what a test hands it: lowercase, non-alphanumerics to single
 * spaces. The real fold lives in `palette-search`'s `normalizeText`; the
 * builders are asserted against it in `settings-search-index.test.mjs`.
 */
const fold = (value) =>
	String(value)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

/** A minimal folded entry; `fields` is what the builders precompute. */
const entry = (id, fields, order = 0, extra = {}) => ({
	id,
	label: fields.label ?? id,
	sectionId: "general",
	sectionLabel: "General settings",
	order,
	fields: {
		label: "",
		synonym: "",
		key: "",
		choice: "",
		section: "",
		description: "",
		...Object.fromEntries(
			Object.entries(fields).map(([field, value]) => [field, fold(value)]),
		),
	},
	...extra,
});

test("a label match outranks a description match for the same word", () => {
	const onLabel = entry("label-hit", { label: "Theme" });
	const onDescription = entry("description-hit", {
		description: "How a conversation's theme is drawn",
	});
	const { results } = searchSettings([onDescription, onLabel], "theme");
	assert.deepEqual(
		results.map(({ entry: e }) => e.id),
		["label-hit", "description-hit"],
	);
});

test("the reason names the field that actually scored", () => {
	const cases = [
		[{ label: "Theme" }, "label"],
		[{ synonym: "dark mode colour scheme" }, "synonym"],
		[{ key: "tui.theme" }, "key"],
		[{ choice: "Always on" }, "choice"],
		[{ section: "Appearance" }, "section"],
		[{ description: "Colour ramp for the interface" }, "description"],
	];
	for (const [fields, reason] of cases) {
		const hit = scoreEntry(entry("x", fields), ["theme"]);
		if (reason === "label") {
			assert.equal(hit?.reason, "label", JSON.stringify(fields));
			continue;
		}
		/*
		 * The remaining fields cannot be isolated by the word "theme" alone
		 * (`tui.theme` folds to "tui theme"), so each is queried by a word ONLY
		 * that field holds — which is also what proves the reason is not a
		 * default.
		 */
		const word =
			{
				synonym: "colour",
				key: "tui",
				choice: "always",
				section: "appearance",
				description: "ramp",
			}[reason];
		const isolated = scoreEntry(entry("x", fields), [word]);
		assert.equal(isolated?.reason, reason, `${reason}: ${JSON.stringify(fields)}`);
	}
});

test("a field that did not match never produces its reason", () => {
	// The row's label does NOT contain the word; only its description does.
	const row = entry("x", { label: "Voice", description: "How the app speaks" });
	const hit = scoreEntry(row, ["speaks"]);
	assert.ok(hit, "the description admits the row");
	assert.equal(hit.reason, "description");
	// A word nothing holds admits nothing at all.
	assert.equal(scoreEntry(row, ["thermal"]), null);
});

test("every token must match: an AND query, not an OR one", () => {
	const row = entry("x", { label: "Show agent reasoning" });
	assert.ok(scoreEntry(row, ["agent", "reasoning"]));
	assert.equal(scoreEntry(row, ["agent", "thermal"]), null);
});

test("document order breaks ties, never the alphabet", () => {
	const first = entry("first", { label: "Alpha" }, 0);
	const second = entry("second", { label: "Alpha" }, 1);
	const { results } = searchSettings([second, first], "alpha");
	assert.deepEqual(
		results.map(({ entry: e }) => e.id),
		["first", "second"],
	);
});

test("the cap reports the total before the cut", () => {
	const rows = Array.from({ length: 40 }, (_, i) =>
		entry(`row-${i}`, { label: "Retention" }, i),
	);
	const page = searchSettings(rows, "retention");
	assert.equal(page.results.length, SETTINGS_SEARCH_CAP);
	assert.equal(page.total, 40);
	assert.equal(
		searchSettings(rows, "retention", 3).results.length,
		3,
		"an explicit cap wins",
	);
});

test("an empty or whitespace query admits nothing and has no cap", () => {
	const rows = [entry("a", { label: "Theme" })];
	assert.deepEqual(searchSettings(rows, "   "), { results: [], total: 0 });
	assert.equal(isBlankQuery(" \t "), true);
	assert.equal(isBlankQuery("theme"), false);
});

test("grouping heads each section and keeps the best row first", () => {
	const rows = [
		entry("theme", { label: "Theme" }, 0, { sectionId: "appearance", sectionLabel: "Appearance" }),
		entry("glass", { label: "Window glass", description: "Theme-tinted backdrop" }, 1, {
			sectionId: "appearance",
			sectionLabel: "Appearance",
		}),
		entry("name", { label: "Name" }, 2),
	];
	const { results } = searchSettings(rows, "theme");
	const groups = groupSettingResults(results);
	assert.deepEqual(
		groups.map((g) => [g.sectionLabel, g.results.map((r) => r.entry.id)]),
		[
			["Appearance", ["theme", "glass"]],
		],
	);
});

test("groups with no section context are shown last", () => {
	const rows = [
		entry("stray", { label: "Stray theme" }, 0, { sectionId: "", sectionLabel: "" }),
		entry("theme", { label: "Theme" }, 1, { sectionId: "appearance", sectionLabel: "Appearance" }),
	];
	const { results } = searchSettings(rows, "theme");
	assert.deepEqual(
		groupSettingResults(results).map((g) => g.sectionId),
		["appearance", ""],
	);
});

test("the registry index the page builds is searchable end-to-end", () => {
	const payload = {
		sections: [{ name: "appearance", title: "Appearance", scope: "live", description: "" }],
		settings: [
			{
				key: "tui.theme",
				section: "appearance",
				label: "Theme",
				kind: "enum",
				help: "Colour ramp. /theme switches it live.",
				value: "x",
				default: "x",
				is_default: true,
				minimum: null,
				maximum: null,
				members: [],
				choices: [{ value: "x", label: "Local Operator Dark", description: "" }],
				empty_unsets: false,
				redacted: false,
			},
		],
	};
	const index = module.buildSettingsIndex({ registry: payload });
	const { results } = searchSettings(index, "local operator dark");
	assert.equal(results.length, 1);
	assert.equal(results[0].reason, "choice");
	assert.equal(results[0].entry.settingKey, "tui.theme");
});
