import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * Every `/settings?section=<id>` this tree can emit names a section that
 * actually EXISTS on the settings page.
 *
 * WHY THIS IS A FILE AND A SOURCE SCAN. `settings-page.tsx` resolves a deep
 * link against its own `sectionRefs` seed and, when the key is absent, returns
 * early — so the page silently stays at the top on `general` with no rail row
 * highlighted. Nothing throws, nothing logs, and the user asked for one section
 * and got another. That is exactly what `/accounts` did once this branch
 * deleted the `credentials` section: the route in `picker-registry.tsx` still
 * said `?section=credentials`, and the deep-link effect's `if (!targetSection ||
 * !ref) return undefined;` turned a live command's destination into a no-op
 * (review round 2 R6 / design D2). A green suite said nothing about it, because
 * no test joined a ROUTE to the REF it resolves against.
 *
 * The two halves are therefore both read from the SHIPPED source rather than
 * restated here: the live key set is the page's own `sectionRefs` seed, and the
 * routes are every literal `/settings?section=<id>` in `src/`. A route added
 * later is admitted by the scan without anyone remembering this file exists.
 *
 * WHAT IT DOES NOT COVER. The palette's `?section=${section.id}` is dynamic, so
 * no literal regex sees it; its source (`DEFAULT_SETTINGS_SECTIONS`) is checked
 * against the same key set instead, and any OTHER dynamic spelling is refused
 * outright — a `?section=` built from a variable is precisely the shape that
 * would re-open this defect while the literal scan stayed green.
 */

const root = process.cwd();

/** The tracked files under `src/`, so scratch trees and node_modules are out. */
function sourceFiles() {
	// Same default-buffer trap the whole-tree scans hit tonight (`ENOBUFS` at
	// Node's 1 MiB spawnSync default); scoped today, closed here with them.
	return execFileSync("git", ["ls-files", "-z", "src"], {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	})
		.split("\0")
		.filter((file) => /\.(ts|tsx)$/.test(file));
}

/**
 * The settings page's own live key set — the `sectionRefs` seed object.
 *
 * The seed is a `useRef<Record<string, RefObject<HTMLDivElement>>>({ … })`
 * whose keys are the ids a deep link may name. Read by slicing that literal
 * rather than regexing the whole file, because `sectionRefs.<id>` is also
 * referenced by every section that mounts a ref and those references are the
 * consequence, not the definition.
 */
function sectionRefKeys() {
	const source = readFileSync(
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"utf8",
	);
	const start = source.indexOf(
		"const sectionRefs = useRef<Record<string, RefObject<HTMLDivElement>>>({",
	);
	assert.notEqual(
		start,
		-1,
		"sectionRefs seed not found — did the page change shape?",
	);
	const body = source.slice(start);
	const end = body.indexOf("}).current;");
	assert.notEqual(end, -1, "sectionRefs seed has no closing `}).current;`");
	/*
	 * A section id may be a bare identifier or a quoted key: the settings
	 * section this branch added is "agent-messages", which is not a valid
	 * identifier. Accept both so the scanner compares every ref the seed
	 * declares, not only the ones that happen to be identifier-safe.
	 */
	const keys = [
		...body
			.slice(0, end)
			.matchAll(/^\t\t(?:"([^"]+)"|([a-zA-Z][\w]*)):\s*useRef</gm),
	].map((match) => match[1] ?? match[2]);
	assert.ok(keys.length > 0, "the sectionRefs seed parsed to no keys");
	return new Set(keys);
}

/** The rail's sections, which are the same destinations by construction. */
function defaultSectionIds() {
	const source = readFileSync(
		"src/renderer/src/features/settings/components/settings-sidebar.tsx",
		"utf8",
	);
	const start = source.indexOf("export const DEFAULT_SETTINGS_SECTIONS");
	assert.notEqual(start, -1, "DEFAULT_SETTINGS_SECTIONS not found");
	const ids = [...source.slice(start).matchAll(/^\t\tid:\s*"([^"]+)",$/gm)].map(
		(match) => match[1],
	);
	assert.ok(ids.length > 0, "DEFAULT_SETTINGS_SECTIONS parsed to no ids");
	/*
	 * The literal ends at the first `];` at column 0 after the declaration;
	 * `matchAll` over the tail would otherwise walk into the next array. The
	 * count check below is what makes that safe: an over-read would show up as
	 * an id that is not a section.
	 */
	return new Set(ids);
}

test("the rail's sections and the page's refs name the same set", () => {
	// The other half of the same defect: this branch removed the section from
	// BOTH, and a future deletion that removes only one leaves the rail offering
	// a row whose ref does not exist (or a ref with no rail row to reach it).
	const refs = sectionRefKeys();
	const sections = defaultSectionIds();
	assert.deepEqual(
		[...sections].sort(),
		[...refs].sort(),
		"the settings rail's sections and the page's sectionRefs disagree — a section was added to or removed from one side only",
	);
});

test("every literal /settings?section=<id> route names a live section", () => {
	const refs = sectionRefKeys();
	const offenders = [];
	const seen = [];
	for (const file of sourceFiles()) {
		const lines = readFileSync(file, "utf8").split("\n");
		for (let i = 0; i < lines.length; i++) {
			for (const match of lines[i].matchAll(
				/\/settings\?section=([a-zA-Z][\w-]*)/g,
			)) {
				seen.push(`${file}:${i + 1} → ${match[1]}`);
				if (!refs.has(match[1]))
					offenders.push(`${file}:${i + 1} → ${match[1]}`);
			}
		}
	}
	// A scan that found no routes would pass by emptiness; this is the guard
	// against a regex that stopped matching (the four literal routes this tree
	// shipped at the change's head: integrations, providers, backend, updates).
	assert.ok(
		seen.length >= 4,
		`the route scan found only ${seen.length} literal ?section= routes — the matcher has drifted, not the tree`,
	);
	assert.deepEqual(
		offenders,
		[],
		"a /settings?section= route names a key the settings page has no ref for, so the deep link silently lands on general: repoint it at a live section (see scripts/settings-section-routes.test.mjs)",
	);
});

test("no route builds a ?section= from a variable this scan cannot see", () => {
	/*
	 * The literal scan above is blind to `?section=${expr}`. One such route is
	 * legitimate — the palette builds every rail section's own deep link from
	 * `DEFAULT_SETTINGS_SECTIONS`, which the first test already binds to the
	 * refs. Anything else is refused by name, because that is how the `/accounts`
	 * defect would come back unnoticed.
	 */
	const ALLOWED = [
		"src/renderer/src/features/command-palette/palette-search.ts",
	];
	const offenders = [];
	for (const file of sourceFiles()) {
		const source = readFileSync(file, "utf8");
		if (!/\?section=\$\{/.test(source)) continue;
		if (!ALLOWED.includes(file)) offenders.push(file);
	}
	assert.deepEqual(
		offenders,
		[],
		"a file builds a ?section= route from an expression, which the literal route scan cannot check: either name the section literally or add the file here with the reason its source is bound to sectionRefs",
	);
});

test("a promoted setting key names a live section, and the page reads the same map", () => {
	/*
	 * The third half of the same family. A `?setting=<key>` link resolves to the
	 * Backend section by default, but a key whose control the page has PROMOTED
	 * elsewhere must resolve to where that control actually is — otherwise the
	 * link highlights a section that no longer contains the row (the defect this
	 * test's change fixed for `language`, which moved into General while its
	 * deep link still said `backend`).
	 *
	 * The binding is read from source rather than restated: the map is
	 * `promoted-setting-sections.ts`'s own `PROMOTED_SETTING_SECTIONS`, its
	 * destinations must be keys the page actually has a ref for, and the page
	 * must resolve through `sectionForSettingKey` rather than re-deciding.
	 */
	const refs = sectionRefKeys();
	const source = readFileSync(
		"src/renderer/src/features/settings/promoted-setting-sections.ts",
		"utf8",
	);
	const start = source.indexOf("export const PROMOTED_SETTING_SECTIONS");
	assert.notEqual(start, -1, "PROMOTED_SETTING_SECTIONS not found");
	const body = source.slice(start);
	const end = body.indexOf("};");
	assert.notEqual(end, -1, "PROMOTED_SETTING_SECTIONS has no closing `};`");
	/*
	 * The destination may be spelled as a string OR as a const the module
	 * exports (the map's own entries use `GENERAL_SECTION`), so the scan reads
	 * both spellings and resolves a named const against the module's own
	 * exported value — restating the table here would defeat the point.
	 */
	const literalOf = (name) => {
		const match = source.match(
			new RegExp(`export const ${name}\\s*=\\s*"([^"]+)"`),
		);
		return match?.[1];
	};
	const entries = [
		...body
			.slice(0, end)
			.matchAll(/\[([^\]]+)\]:\s*(?:"([^"]+)"|([A-Za-z_][\w]*))/g),
	].map(([, key, literal, named]) => [key, named ? literalOf(named) : literal]);
	assert.ok(
		entries.length > 0,
		"the promoted-section map parsed to no entries — the shape changed",
	);
	for (const [key, section] of entries) {
		assert.ok(
			section,
			`promoted key ${key} has a destination this scan could not resolve to a string`,
		);
		assert.ok(
			refs.has(section),
			`promoted key ${key} resolves to section "${section}", which the settings page has no ref for — the deep link would silently land elsewhere`,
		);
	}
	/*
	 * The page must route through the shared helper. A page that re-derived the
	 * map inline would drift the moment an entry is added, and this file would
	 * stay green while the link went stale.
	 */
	const page = readFileSync(
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"utf8",
	);
	assert.ok(
		page.includes("sectionForSettingKey("),
		"the settings page must resolve ?setting= targets through sectionForSettingKey so a promoted key needs one entry, not two edits",
	);
});

test("the promoted model_effort row is revealed and focused by its deep link", () => {
	/*
	 * The route-map test above proves a key link resolves to General. That alone
	 * lands the SECTION: the backend section's `focusKey` is suppressed for
	 * promoted keys, so without a hand-off the reader arrives at General's top
	 * and the row they named is neither scrolled to nor focused (round 2, m-A).
	 *
	 * The reveal is pinned at both ends of its source:
	 *  - the page hands the effort row the same boolean the language row gets;
	 *  - the row focuses its own combobox, which is also what scrolls it into
	 *    view natively, so "revealed and focused" is one mechanism rather than
	 *    an extra scroll that could disagree with the focus target.
	 */
	const page = readFileSync(
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"utf8",
	);
	const row = page.match(/<DefaultEffortSelect[\s\S]*?\/>/);
	assert.notEqual(row, null, "the page no longer renders DefaultEffortSelect");
	assert.match(
		row[0],
		/focus=\{settingFocusKey === MODEL_EFFORT_SETTING_KEY\}/,
		"the Default effort row must receive the deep link's focus target, or the promoted key lands General's top with nothing focused",
	);
	const component = readFileSync(
		"src/renderer/src/features/settings/components/default-effort-select.tsx",
		"utf8",
	);
	assert.match(
		component,
		/\[role=combobox\][\s\S]{0,80}\.focus\(/,
		"the row must focus its own combobox when the deep link names it",
	);
});
