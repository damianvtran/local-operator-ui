import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * WHAT THE SETTINGS SEARCH KNOWS ABOUT — asserted in memory, without React.
 *
 * Two halves, and they are tested differently on purpose:
 *
 *  - the REGISTRY half is fed the real `scripts/fixtures/backend-settings-registry.json`,
 *    the same payload the Backend section is built against, so a key, label,
 *    help sentence, section title or choice label that the desktop really
 *    serves is what the assertions name;
 *  - the PAGE half is fed a jsdom tree carrying the attribute contract, so
 *    `buildRenderedEntries` is exercised against the shape a real row has
 *    (rendered text as the label, `data-search-terms` for words it does not
 *    print, a `data-search-section` ancestor for context).
 *
 * The examples the issue names (`theme`, `keyboard`, `shortcut`, `model`,
 * `effort`) are asserted over BOTH halves together, because that is the index
 * the page actually searches. The registry alone answers three of the five and
 * NOT `keyboard`/`shortcut` — the keyboard section is renderer-local (its
 * bindings live in `ui-preferences-store`, not in the backend), so this file
 * asserts that gap explicitly rather than pretending the registry covers it:
 * the page rows are the only honest source for it.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/settings/search/settings-search-index";\nexport { searchSettings } from "./src/renderer/src/features/settings/search/settings-search-match";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	buildRegistryEntries,
	buildRenderedEntries,
	buildSectionEntries,
	buildSettingsIndex,
	labelFromRenderedText,
	registrySectionTitles,
	searchSettings,
} = module;

/** The configured fixture: the wire the surface was built against. */
const payload = JSON.parse(
	readFileSync("scripts/fixtures/backend-settings-registry.json", "utf8"),
);

/** The index's own search, so "findable" means findable by the shipped ranker. */
const found = (entries, query) => searchSettings(entries, query, 500).results;
const hasKey = (entries, query, key) =>
	found(entries, query).some(({ entry }) => entry.settingKey === key);

const registry = buildRegistryEntries(payload);

test("a registry row is findable by its key, with the key folded", () => {
	assert.ok(hasKey(registry, "memory.enabled", "memory.enabled"));
	// `_` and `.` fold to spaces on BOTH sides, so the reader's spelling of a key
	// finds it (the fold the Backend section's own filter uses).
	assert.ok(hasKey(registry, "memory enabled", "memory.enabled"));
	const entry = registry.find((e) => e.settingKey === "memory.enabled");
	assert.equal(entry.fields.key, "memory enabled");
});

test("a registry row is findable by its label", () => {
	assert.ok(hasKey(registry, "scoped memory", "memory.enabled"));
});

test("a registry row is findable by its help text, and says so", () => {
	const hits = found(registry, "erase retained facts");
	assert.ok(hits.length > 0, "the help sentence is indexed");
	const hit = hits.find(({ entry }) => entry.settingKey === "memory.enabled");
	assert.ok(hit, "the row whose help carries the words is admitted");
	// The reason is the field that actually scored, not a default.
	assert.equal(
		hit.reason,
		"description",
		"the reason names the field that scored, not the label",
	);
});

test("a registry row is findable by its section title", () => {
	/*
	 * `appearance` rather than a section whose NAME is also every row's key
	 * prefix (`openrouter.*`): those rows legitimately report a KEY reason, and
	 * a section reason would be the wrong claim. The Appearance section is the
	 * clean case — its title is a word its rows do not put in their keys or
	 * labels — so this is the query that pins "matched the section".
	 */
	const hits = found(registry, "appearance");
	const bySection = hits.filter(({ reason }) => reason === "section");
	assert.ok(bySection.length > 0, "a section title admits its rows");
	for (const { entry } of bySection) {
		assert.equal(entry.fields.section.includes("appearance"), true);
		assert.equal(
			entry.fields.label.includes("appearance"),
			false,
			"a section match never hides a label that also matched",
		);
	}
	assert.ok(
		bySection.some(({ entry }) => entry.fields.label === "theme"),
		"the Theme row is admitted by its section",
	);
});

test("a registry row is findable by one of its choice labels", () => {
	const withChoices = payload.settings.find((s) => s.choices.length > 0);
	assert.ok(withChoices, "the fixture carries a choice-bearing row");
	const choice = withChoices.choices[0].label;
	assert.ok(hasKey(registry, choice, withChoices.key), choice);
});

test("a registry synonym is indexed, and a missing or empty list changes nothing", () => {
	const key = "memory.enabled";
	const withSynonym = {
		...payload,
		settings: payload.settings.map((s) =>
			s.key === key ? { ...s, synonyms: ["interwebs", "recollection"] } : s,
		),
	};
	assert.ok(hasKey(buildRegistryEntries(withSynonym), "interwebs", key));
	assert.equal(hasKey(registry, "interwebs", key), false);
	const withEmpty = {
		...payload,
		settings: payload.settings.map((s) => ({ ...s, synonyms: [] })),
	};
	/*
	 * The field is read with `?? []`, so absent and `[]` are the same corpus —
	 * asserted on the folded fields rather than on a count, so a future field
	 * cannot make them differ without failing here.
	 */
	const emptyIndex = buildRegistryEntries(withEmpty);
	assert.equal(emptyIndex.length, registry.length);
	for (let i = 0; i < registry.length; i += 1) {
		assert.deepEqual(emptyIndex[i].fields, registry[i].fields);
	}
});

test("the issue's five examples answer from the page's own index", () => {
	const dom = new JSDOM(`<!doctype html><html><body>
		<div data-settings-content>
			<section data-search-section="appearance"><h2>Appearance</h2>
				<div data-search-row="theme">
					<button data-search-control>Theme</button>
					<p>Customize the look and feel</p>
				</div>
			</section>
			<section data-search-section="keyboard">
				<h2>Keyboard shortcuts</h2>
				<label data-search-row="shortcut.console" data-search-terms="keyboard hotkey">
					<span>Console</span>
					<input data-search-control readonly />
				</label>
				<label data-search-row="shortcut.canvas" data-search-terms="keyboard hotkey">
					<span>Canvas</span>
					<input data-search-control readonly />
				</label>
			</section>
		</div>
	</body></html>`);
	const rendered = buildRenderedEntries(
		dom.window.document.querySelector("[data-settings-content]"),
	);
	const index = buildSettingsIndex({ registry: payload, rendered });
	for (const query of ["theme", "keyboard", "shortcut", "model", "effort"]) {
		assert.ok(found(index, query).length > 0, `"${query}" finds something`);
	}
	/*
	 * THE HONEST GAP, asserted rather than papered over. The registry fixture
	 * contains no word "keyboard" or "shortcut" in a label or section title —
	 * those bindings are renderer-local, so the section the page renders is
	 * their only source. A loose (subsequence) tier still admits a handful of
	 * registry rows whose HELP happens to spell k-e-y-b-o-a-r-d in order; that
	 * is the palette's shared tier doing what it does, and the page's own row is
	 * what must rank FIRST, which is what the assertion below pins.
	 */
	assert.ok(
		found(index, "keyboard")[0].entry.source === "page",
		"the keyboard row is the first answer, not a loose registry hit",
	);
	assert.ok(
		found(index, "shortcut")[0].entry.source === "page",
		"the shortcut rows are the first answers",
	);
	assert.equal(
		found(registry, "keyboard").every(({ reason }) => reason !== "label"),
		true,
		"no registry row CLAIMS a name match for a word its name does not hold",
	);
});

test("a rendered row's label is its own title, never the whole subtree", () => {
	const dom = new JSDOM(`<!doctype html><html><body>
		<div data-search-section="appearance"><h2>Appearance</h2>
			<div data-search-row="appearance.reasoning">
				<span>Show agent reasoning</span>
				<p>Adds the agent's reasoning rows to conversations</p>
			</div>
			<div data-search-row="appearance.theme" data-search-label="Theme">
				<h3>Dark</h3><button>Catppuccin Macchiato</button>
			</div>
			<div data-search-row="providers.anthropic">
				<h3>Anthropic</h3><span>Connected</span>
			</div>
		</div>
	</body></html>`);
	const [reasoning, theme, provider] = buildRenderedEntries(
		dom.window.document.body,
	);
	/*
	 * The concatenation this pins against: JSX emits no whitespace text node
	 * between siblings, so reading `textContent` produced
	 * "DarkLocal Operator DarkCatppuccin Macchiato…" (review round 1, M3).
	 */
	assert.equal(reasoning.label, "Show agent reasoning");
	assert.equal(
		theme.label,
		"Theme",
		"data-search-label is the explicit answer",
	);
	assert.equal(provider.label, "Anthropic", "else the row's own heading");
	assert.equal(reasoning.sectionLabel, "Appearance");
	assert.equal(reasoning.sectionId, "appearance");
	assert.equal(reasoning.source, "page");
});

test("data-search-terms adds words the row does not print", () => {
	const dom = new JSDOM(`<!doctype html><html><body>
		<div data-search-section="providers"><h2>Model providers</h2>
			<div data-search-row="providers.anthropic" data-search-terms="claude anthropic api key">Anthropic</div>
		</div>
	</body></html>`);
	const [entry] = buildRenderedEntries(dom.window.document.body);
	assert.deepEqual(found([entry], "claude"), [{ entry, reason: "synonym" }]);
	assert.deepEqual(found([entry], "anthropic"), [{ entry, reason: "label" }]);
});

test("a row outside any section root is still indexed, without context", () => {
	const dom = new JSDOM(
		`<!doctype html><html><body><div data-search-row="stray">Stray row</div></body></html>`,
	);
	const [entry] = buildRenderedEntries(dom.window.document.body);
	assert.equal(entry.label, "Stray row");
	assert.equal(entry.sectionId, "");
	assert.equal(entry.sectionLabel, "");
});

test("section entries are the sidebar's own labels, in rail order", () => {
	const entries = buildSectionEntries([
		{ id: "general", label: "General settings" },
		{ id: "appearance", label: "Appearance" },
	]);
	assert.deepEqual(
		entries.map((e) => [e.id, e.label, e.source]),
		[
			["section:general", "General settings", "section"],
			["section:appearance", "Appearance", "section"],
		],
	);
});

test("the registry index covers every row and section title the payload serves", () => {
	assert.equal(registry.length, payload.settings.length);
	const titles = registrySectionTitles(payload.sections);
	for (const section of payload.sections) {
		assert.equal(titles.get(section.name)?.label, section.title);
	}
	// A row whose section is not in the payload's own section list keeps the
	// raw name rather than dropping out of the section context entirely.
	const orphan = buildRegistryEntries({
		sections: [],
		settings: payload.settings.slice(0, 1),
	});
	assert.equal(orphan[0].fields.section, "memory");
});

test("labelFromRenderedText collapses whitespace and cuts long rows at a space", () => {
	assert.equal(labelFromRenderedText("  Theme\n\t picker "), "Theme picker");
	const long = labelFromRenderedText(
		"A very long row title that goes on and on and on past the eighty character limit for a label, with more",
	);
	assert.equal(long.endsWith("…"), true);
	assert.equal(long.length <= 81, true);
	assert.equal(
		/…\w/.test(long),
		false,
		"the cut lands on a space, never mid-word",
	);
});

test("a registry row's destination is the sidebar section its jump lands in", () => {
	/*
	 * The defect this pins (review round 1, M2 / design D2): every registry row
	 * used to carry `sectionId: "backend"` while its LABEL came from the
	 * registry's own sub-section, so the panel could head a group "Model" over
	 * network and memory rows — and a promoted key advertised a destination it
	 * never reached.
	 */
	const sidebar = [
		{ id: "general", label: "General settings" },
		{ id: "appearance", label: "Appearance" },
		{ id: "backend", label: "Backend settings" },
	];
	const entries = buildRegistryEntries(payload, { sections: sidebar });
	const byKey = (key) => entries.find((entry) => entry.settingKey === key);

	// An unpromoted key: Backend settings, with its registry sub-section as a
	// SECONDARY detail line that is not the heading.
	const theme = byKey("tui.theme");
	assert.equal(theme.sectionId, "backend");
	assert.equal(theme.sectionLabel, "Backend settings");
	assert.equal(theme.detail, "Appearance");

	// A promoted key: the section whose control actually takes the reader.
	const effort = byKey("model_effort");
	assert.equal(effort.sectionId, "general");
	assert.equal(effort.sectionLabel, "General settings");
	assert.equal(
		effort.fields.section.includes("model"),
		true,
		"the registry's own filing is still searchable",
	);
});

test("every entry in one group carries the same destination", () => {
	const sidebar = [
		{ id: "general", label: "General settings" },
		{ id: "backend", label: "Backend settings" },
	];
	const index = buildSettingsIndex({ registry: payload, sections: sidebar });
	const groups = new Map();
	for (const entry of index) {
		const group = groups.get(entry.sectionId) ?? new Set();
		group.add(entry.sectionLabel);
		groups.set(entry.sectionId, group);
	}
	for (const [sectionId, labels] of groups) {
		assert.equal(
			labels.size,
			1,
			`${sectionId} has one label, so a heading cannot disagree with its rows`,
		);
	}
});

test("choice DESCRIPTIONS are indexed, not only choice labels", () => {
	/*
	 * The backend's synonym hygiene rule forbids a synonym that repeats choice
	 * text because "the row is searchable by its choice copy" — so a word that
	 * lives only in an option's description must reach the row, or the two
	 * halves disagree (reviewer note, round 1).
	 */
	const themed = payload.settings.find(
		(setting) => setting.key === "tui.theme",
	);
	const described = {
		...payload,
		settings: [
			{
				...themed,
				choices: [
					...(themed.choices ?? []),
					{
						value: "brand",
						label: "Brand",
						description: "A warm colour ramp with the brand green",
					},
				],
			},
		],
	};
	const entries = buildRegistryEntries(described);
	const hit = searchSettings(entries, "colour").results[0];
	assert.ok(hit, '"colour" reaches the row through its option copy');
	assert.equal(hit.entry.settingKey, "tui.theme");
	assert.equal(hit.reason, "choice");
});

test("a promoted registry row is indexed once, as the page's own row", () => {
	/*
	 * m1: `setting:language` and `page:general.language` were two results for
	 * one control, under two different names. The promoted map is the dedupe
	 * key — a key that has a first-class control elsewhere is not also a
	 * registry result.
	 */
	const sidebar = [{ id: "general", label: "General settings" }];
	const index = buildSettingsIndex({
		registry: payload,
		sections: sidebar,
		rendered: [
			{
				id: "page:general.language",
				source: "page",
				label: "Interface language",
				sectionId: "general",
				sectionLabel: "General settings",
				order: 0,
				fields: {
					label: "interface language",
					synonym: "",
					key: "",
					choice: "",
					section: "general settings",
					description: "",
				},
			},
		],
	});
	assert.equal(
		index.some((entry) => entry.settingKey === "language"),
		false,
		"the registry row for a promoted key is not offered twice",
	);
	assert.equal(
		index.find((entry) => entry.id === "page:general.language")?.label,
		"Interface language",
	);
});
