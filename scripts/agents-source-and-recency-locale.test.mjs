/**
 * Two remaining English leaks on the agents/hub surfaces, refused in the
 * languages the app actually ships (not in `en`, where they are invisible).
 *
 *     node --test scripts/agents-source-and-recency-locale.test.mjs
 *
 * WHY THIS SUITE EXISTS. Both strings were literals in a `.tsx`/`.ts` module, so
 * both rendered English over a fully translated page:
 *
 *   1. `sourceLabel` (`agents/components/detail-parts.tsx`) spelled
 *      "Built-in" / "Installed" / "Custom" beside the roster's rows, in the
 *      chip and in the detail header's meta line.
 *   2. `recencyOf` (`agent-hub/components/org-team-summary.ts`) printed
 *      date-fns' own `en-US` distance ("3 days ago") plus a literal "just now".
 *
 * WHAT IS MEASURED, and with which instrument.
 *
 * A. THE WORD IS THE CATALOGUE'S WORD, NOT A SECOND SPELLING. Each source
 *    label is compared with the key the page's own scope filter reads
 *    (`ui.agents.pages.scope.*`) under that locale, so a hand-written literal
 *    that happens to translate correctly still fails: the two would drift.
 *
 * B. THE CHIP IS RENDERED. `SourceChip` is the production component the roster
 *    mounts (`agents-page.tsx`), rendered here through `react-dom/server` in
 *    every locale; the assertion reads the visible text out of the markup, not
 *    out of the helper.
 *
 * C. THE RECENCY IS THE CATALOGUE'S PHRASE. `teamRecency().when` is compared
 *    with the `ui.hub.comments.age.*` message `comment-age.ts` resolves - the
 *    repository's settled answer to a strict date-fns distance - and with the
 *    hub's own "just now" (`ui.hub.updates.ago.now`). The mounted proof that the
 *    rosters prints that exact string is the sibling
 *    `scripts/org-teams-summary.test.mjs`; this file owns the per-locale
 *    vocabulary, including an RTL locale (`ur`).
 *
 * D. THE OLD SHAPE IS GONE, PROVABLY. For every non-English locale the string
 *    must DIFFER from the English one the pre-fix code printed ("3 days ago",
 *    "Built-in"), and must not contain it: that is the negative control, and
 *    reverting either call site turns it red. The English side of that
 *    comparison is read from the `en` catalogue at run time rather than pinned
 *    here, so a legitimately refined translation cannot fail a test whose
 *    subject - the call site - is correct.
 *
 * WHAT IT DOES NOT PROVE: pixels and the repaint on a live language switch. The
 * callers re-render through `useI18nLocale()` (`agents-page.tsx` for the roster
 * and detail pane, `org-teams-list.tsx` for the rows), and both modules read
 * `t()` at call time; the frames are in the PR.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * as summary from "./src/renderer/src/features/agent-hub/components/org-team-summary";',
			'export { SourceChip, sourceLabel } from "./src/renderer/src/features/agents/components/detail-parts";',
			'export * as locale from "./src/i18n/locale";',
			'export { t } from "./src/i18n/messages";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	loader: { ".css": "empty" },
	jsx: "automatic",
	// The app's config loader reads `import.meta.env` at import time.
	define: { "import.meta.env": "{}" },
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});

const bundlePath = new URL(
	`./_agents-source-recency-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const lib = await import(bundlePath.href);
await unlink(bundlePath).catch(() => {});

/** Every locale the catalogue tree ships (`src/i18n/catalogues/`). */
const SHIPPED = ["en", "es", "fr", "hi", "ru", "ur", "vi", "zh-CN"];

/** The two locales the brief asks for by name: French, and an RTL one. */
const AUDITED = ["fr", "ur"];

/** The English the pre-fix code printed, hoisted: Biome's `useTopLevelRegex`. */
const LEGACY_ENGLISH = /Built-in|Installed|Custom|\bago\b|just now/;

/** Latin letters, for the non-Latin script check: RTL Urdu carries none. */
const LATIN_LETTERS = /[A-Za-z]/;

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-30T12:00:00.000Z");

/** The provenance fixture: the roster's own row, updated 3 days and 3 h ago. */
const team = (overrides = {}) => ({
	id: "t1",
	tenant_id: "tenant-1",
	account_id: "acct-1",
	name: "Adverse media desk",
	description: "Screens onboarding subjects.",
	manager: "lead-screener",
	members: [{ role: "screener", kind: "role", count: 3 }],
	project: "Onboarding",
	version: "1.2.0",
	created_date: new Date(NOW - 41 * DAY).toISOString(),
	updated_at: new Date(NOW - (3 * DAY + 3 * 3_600_000)).toISOString(),
	account_metadata: { name: "Ana Perez", email: "ana@example.com" },
	...overrides,
});

/** The visible text of a rendered chip, without the wrapper's markup. */
const chipText = (source, appearance) => {
	const html = renderToStaticMarkup(
		createElement(lib.SourceChip, { source, appearance }),
	);
	const text = html.replace(/<[^>]*>/g, "").trim();
	assert.ok(text.length > 0, `${source}: the chip renders a word`);
	return text;
};

/* ------------------------------------------------------------- the chip */

test("the source chip paints the scope catalogue's word in every locale", () => {
	for (const tag of SHIPPED) {
		lib.locale.setLocale(tag);
		for (const [source, key] of [
			["builtin", "ui.agents.pages.scope.builtin"],
			["installed", "ui.agents.pages.scope.installed"],
			["custom", "ui.agents.pages.scope.custom"],
		]) {
			const word = lib.t(key);
			assert.equal(
				lib.sourceLabel(source),
				word,
				`${tag}/${source}: the label must be ${key}, not a literal`,
			);
			for (const appearance of ["chip", "text"]) {
				assert.equal(
					chipText(source, appearance),
					word,
					`${tag}/${source}/${appearance}: rendered word`,
				);
			}
		}
	}
});

test("the audited locales: the chip is the locale's word, never English", () => {
	/* NO SPELLINGS ARE PINNED HERE, deliberately. This test's claim is
	 * "differs from English", not "equals this word": an audit may legitimately
	 * refine a translation (fr's scope labels were singularised once it was
	 * found the same keys also label ONE agent on each roster row's chip), and
	 * a pinned word then fails on a refinement that left the behaviour under
	 * test correct - the exact rot the catalogue-derived assertion above this
	 * one exists to avoid. So every expectation is read from the catalogues:
	 * the locale's own value for the key, and the `en` value as the baseline
	 * the non-English locales must not have. */
	const KEYS = {
		builtin: "ui.agents.pages.scope.builtin",
		installed: "ui.agents.pages.scope.installed",
		custom: "ui.agents.pages.scope.custom",
	};
	lib.locale.setLocale("en");
	const english = {};
	for (const [source, key] of Object.entries(KEYS)) {
		english[source] = lib.t(key);
		/* The baseline is provably the pre-fix vocabulary: if `en` were ever
		 * reworded, the comparison would stop measuring the old shape. */
		assert.match(
			english[source],
			LEGACY_ENGLISH,
			`en/${source}: the catalogue still carries the pre-fix label`,
		);
	}
	for (const tag of AUDITED) {
		lib.locale.setLocale(tag);
		for (const [source, key] of Object.entries(KEYS)) {
			const rendered = chipText(source, "text");
			assert.equal(
				rendered,
				lib.t(key),
				`${tag}/${source}: the catalogue's word`,
			);
			assert.notEqual(
				rendered,
				english[source],
				`${tag}/${source}: the English label leaked through`,
			);
			assert.doesNotMatch(
				rendered,
				LEGACY_ENGLISH,
				`${tag}/${source}: still printing the hardcoded English label`,
			);
		}
	}
	/* Urdu is RTL and non-Latin, so Latin letters on that page are English by
	 * construction - a property no translation refinement can invalidate. */
	lib.locale.setLocale("ur");
	for (const source of Object.keys(KEYS)) {
		assert.doesNotMatch(
			chipText(source, "text"),
			LATIN_LETTERS,
			`ur/${source}: Latin letters on an Urdu page`,
		);
	}
});

/* ---------------------------------------------------------- the recency */

test("recency is the catalogue's phrase, per locale, on the fixture's clock", () => {
	for (const tag of SHIPPED) {
		lib.locale.setLocale(tag);
		const recency = lib.summary.teamRecency(team(), NOW);
		assert.equal(recency.label, "updated", `${tag}: updated_at wins`);
		assert.equal(
			recency.when,
			lib.t("ui.hub.comments.age.days", { count: 3 }),
			`${tag}: the row must print the age message, not date-fns' English`,
		);
	}
});

test("the audited locales: French and Urdu, never ago", () => {
	const expected = { fr: "il y a 3 jours", ur: "3 دن پہلے" };
	for (const [tag, want] of Object.entries(expected)) {
		lib.locale.setLocale(tag);
		const { when } = lib.summary.teamRecency(team(), NOW);
		assert.equal(when, want, `${tag} age`);
		assert.doesNotMatch(
			when,
			LEGACY_ENGLISH,
			`${tag}: still printing date-fns' ${JSON.stringify("3 days ago")}`,
		);
	}
});

test("a timestamp under a minute is the hub's own just now, translated", () => {
	const fresh = new Date(NOW - 5_000).toISOString();
	const expected = { en: "just now", fr: "à l’instant", ur: "ابھی" };
	for (const [tag, want] of Object.entries(expected)) {
		lib.locale.setLocale(tag);
		assert.equal(
			lib.summary.teamRecency(team({ updated_at: fresh }), NOW).when,
			want,
			`${tag}: the under-a-minute branch`,
		);
	}
	/* And it is the shared hub phrase, not a second copy of the same word. */
	lib.locale.setLocale("en");
	assert.equal(lib.t("ui.hub.updates.ago.now"), "just now");
});

test("a future timestamp stays an absolute date, in the reader's language", () => {
	lib.locale.setLocale("fr");
	const future = lib.summary.teamRecency(
		team({ updated_at: new Date(NOW + 2 * DAY).toISOString() }),
		NOW,
	);
	assert.equal(
		future.when,
		lib.summary.formatTeamDate(new Date(NOW + 2 * DAY)),
	);
	assert.doesNotMatch(future.when, LEGACY_ENGLISH);
	assert.notEqual(
		future.when,
		lib.t("ui.hub.comments.age.days", { count: 2 }),
		"clock skew is not -2 days ago",
	);
});

/** Leave the store as the rest of the suite expects to find it. */
test("the store is restored to English", () => {
	lib.locale.setLocale("en");
	assert.equal(lib.sourceLabel("custom"), "Custom");
	assert.equal(
		lib.summary.teamRecency(team(), NOW).when,
		"3 days ago",
		"English is unchanged in voice",
	);
	assert.ok(AUDITED.includes("fr") && AUDITED.includes("ur"));
});
