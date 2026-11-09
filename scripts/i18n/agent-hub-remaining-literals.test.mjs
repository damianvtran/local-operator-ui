/**
 * The Agent Hub's publication copy is keyed, resolves in a language other than
 * English, and no longer exists as an English literal on the paths this change
 * touched.
 *
 *     node --test scripts/i18n/agent-hub-remaining-literals.test.mjs
 *
 * WHY THIS SUITE EXISTS. The Agent Hub page, its organization refusal alert and
 * its four empty-grid shapes were the last English left on the hub's publication
 * surface: `i18n/literal-allowance.json` carried fourteen ids for
 * `agent-hub-page.tsx` (the JSX-child shape the scanner records rather than
 * fixes), plus two sentences no ratchet could see — the load-failure lead passed
 * into `backendLoadErrorMessage`, and the `"this team"` name fallback the pull
 * error treatment builds its sentence around in both team libraries.
 *
 * WHAT IS MEASURED, and with which instrument.
 *
 * A. THE REAL RUNTIME, NOT A RE-STATEMENT OF THE CATALOGUE. `t` and `setLocale`
 *    are bundled from `src/i18n` with esbuild and called, so the assertion is on
 *    what the app would render. A key the runtime cannot resolve comes back as
 *    the KEY ITSELF (`messages.ts`'s `if (message === undefined) return key`), so
 *    "the value is not the id and is not empty" is a real resolution test in
 *    whichever language is active — and stays true once translators land, unlike
 *    an assertion on today's English text.
 *
 * B. `fr` IS THE WITNESS because it is a shipped language whose catalogue the
 *    runtime resolves per key: today these seventeen keys fall back to English
 *    there (the translator lane has not run yet), and after it runs the same
 *    assertion still holds against the French value. The suite deliberately does
 *    NOT pin French wording: that would pin one translator's sentence and would
 *    still pass if the call site had stopped routing through `t()`.
 *
 * C. THE LITERALS ARE ASSERTED ABSENT BY THEIR QUOTED FORM on the three touched
 *    files, WITH COMMENTS STRIPPED FIRST. A bare substring search would match the
 *    design and review comments that quote the old sentences to explain them —
 *    and several do ("filter, which is what \"Clear filter\" was written for");
 *    those comments are the reason the label exists and deleting them to satisfy
 *    a test would destroy the reasoning it protects. So the search runs over the
 *    file with block and whole-line comments removed, and each assertion names
 *    the literal as CODE spells it — `"…"` or a template's own leading fragment.
 *    The stripper is not a parser: a string containing `//` would be truncated,
 *    which is why no literal below contains one.
 *
 * WHAT IT DOES NOT PROVE: pixels. Wrapping, the empty panel's slot height and the
 * refusal alert's width are layout, covered by the context sidecars and the
 * rendered review of the surfaces they belong to.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const runtimeBundle = await build({
	stdin: {
		contents:
			'export { t } from "./src/i18n/messages"; export { setLocale } from "./src/i18n/locale";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { t, setLocale } = await import(
	`data:text/javascript;base64,${Buffer.from(runtimeBundle.outputFiles[0].text).toString("base64")}`
);

/** The keys this change added, with the parameters each one needs to format. */
const KEYS = [
	["ui.hub.pages.list_unreadable", undefined],
	["ui.hub.pages.org.plan_headline", undefined],
	["ui.hub.pages.org.no_access_headline", undefined],
	["ui.hub.pages.org.plan_body", { org: "Synthetic Org" }],
	["ui.hub.pages.org.no_access_body", { org: "Synthetic Org" }],
	["ui.hub.pages.org.that_organization", undefined],
	["ui.hub.pages.empty.org.title", undefined],
	["ui.hub.pages.empty.org.body", { org: "Synthetic Org" }],
	["ui.hub.pages.empty.category.title", { category: "Investment" }],
	["ui.hub.pages.empty.category.body", undefined],
	["ui.hub.pages.empty.search.title", undefined],
	["ui.hub.pages.empty.search.body", undefined],
	["ui.hub.pages.empty.public.title", undefined],
	["ui.hub.pages.empty.public.body", undefined],
	["ui.hub.pages.clear.filter", undefined],
	["ui.hub.pages.clear.search", undefined],
	["ui.hub.teams.unnamed_team", undefined],
];

/** The literals this change replaced, spelled as the source spelled them. */
const REMOVED_LITERALS = [
	'"That organization needs an active Team plan"',
	'"You do not have access to that organization"',
	"Sharing agents inside an organization is part of the Team plan.",
	"You are not a member of ${",
	'|| "this organization"',
	'|| "that organization"',
	'"This organization has no shared agents yet."',
	"No agents in ${",
	'"No agents match that search."',
	'"The hub is empty."',
	'"Nothing in this category yet. Clear the filter to see the whole hub."',
	'"No agent\'s name or description carries that. Clear it to see the whole hub."',
	'"Nobody has published an agent yet. Yours could be the first."',
	'"Clear filter"',
	'"Clear search"',
	'"The agent list could not be loaded."',
	'"this team"',
];

const TOUCHED = [
	"src/renderer/src/features/agent-hub/agent-hub-page.tsx",
	"src/renderer/src/features/agent-hub/components/public-teams-library.tsx",
	"src/renderer/src/features/agent-hub/components/org-teams-list.tsx",
];

const sources = new Map(
	TOUCHED.map((path) => [path, readFileSync(path, "utf8")]),
);

/** Source with comments removed, so the absence assertions are about CODE only. */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;
const UNSUBSTITUTED_PLACEHOLDER = /\{[a-zA-Z]+\}/;

const withoutComments = (source) =>
	source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");

for (const locale of ["en", "fr"]) {
	test(`every new Agent Hub key resolves in ${locale}, not to its own id`, () => {
		setLocale(locale);
		for (const [key, params] of KEYS) {
			const rendered = params === undefined ? t(key) : t(key, params);
			assert.notEqual(
				rendered,
				key,
				`${locale}: ${key} did not resolve — the runtime returned the key`,
			);
			assert.ok(
				rendered.trim().length > 0,
				`${locale}: ${key} resolved to an empty string`,
			);
		}
	});
}

test("the placeholders are interpolated, not left as braces in the sentence", () => {
	setLocale("en");
	for (const [key, params] of KEYS) {
		if (params === undefined) continue;
		const rendered = t(key, params);
		assert.ok(
			!UNSUBSTITUTED_PLACEHOLDER.test(rendered),
			`${key} rendered with an unsubstituted placeholder: ${rendered}`,
		);
		for (const value of Object.values(params)) {
			assert.ok(
				rendered.includes(value),
				`${key} dropped its ${JSON.stringify(value)} parameter: ${rendered}`,
			);
		}
	}
});

test("the English sentences are the ones that shipped on the surface", () => {
	setLocale("en");
	assert.equal(t("ui.hub.pages.empty.public.title"), "The hub is empty.");
	assert.equal(
		t("ui.hub.pages.empty.search.title"),
		"No agents match that search.",
	);
	assert.equal(
		t("ui.hub.pages.empty.category.title", { category: "Investment" }),
		"No agents in Investment.",
	);
	assert.equal(t("ui.hub.pages.clear.filter"), "Clear filter");
	assert.equal(t("ui.hub.pages.clear.search"), "Clear search");
	assert.equal(t("ui.hub.teams.unnamed_team"), "this team");
	assert.equal(
		t("ui.hub.pages.empty.org.body", { org: "Synthetic Org" }),
		"Agents published into Synthetic Org appear here for its members.",
	);
});

test("no keyed English literal survives on the touched paths", () => {
	for (const [path, source] of sources) {
		const code = withoutComments(source);
		for (const literal of REMOVED_LITERALS) {
			assert.ok(
				!code.includes(literal),
				`${path} still carries the English literal ${literal}`,
			);
		}
	}
});

test("each new key is called from a touched path", () => {
	const all = [...sources.values()].join("\n");
	for (const [key] of KEYS) {
		assert.ok(all.includes(`t("${key}"`), `no touched file calls t("${key}"`);
	}
});
