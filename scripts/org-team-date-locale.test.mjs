/**
 * The Teams roster's Created / Updated dates are read in the READER'S
 * language (independent audit: a French user saw "10 Oct 2026").
 *
 *     node --test scripts/org-team-date-locale.test.mjs
 *
 * WHY THIS SUITE EXISTS. `formatTeamDate` printed
 * `format(date, "d MMM yyyy")` with no locale, so date-fns used its own
 * `en-US` data and spelled the month in English on a surface whose catalogue
 * strings (`detail.created` / `detail.updated`) are translated. The defect is
 * invisible in English, which is why the assertions below are written in the
 * locales the app ships and NOT in `en` alone: an English-only test passes
 * against the broken code.
 *
 * FOUR CLAIMS, each with the instrument that can falsify it.
 *
 * 1. THE MONTH IS THE LOCALE'S OWN. For each shipped locale the month token in
 *    the roster's date equals the month token `Intl.DateTimeFormat(tag,
 *    {day, month:"short", year})` produced for that instant - measured against
 *    the platform's CLDR data, not against a table this test could copy from
 *    the implementation.
 *
 * 2. IT IS THE FORMATTER LAYER'S OUTPUT, NOT A SECOND SPELLING. Every locale's
 *    string equals `Intl.DateTimeFormat(tag, {day, month:"short", year})`'s -
 *    the exact call `formatDate` makes - so a later hand-rolled formatter here
 *    fails even if its month names happen to be right.
 *
 * 3. A LIVE SWITCH IS FOLLOWED AT CALL TIME. `formatTeamDate` reads the store
 *    per call (as `t()` does), and `setLocale` notifies the subscribers that
 *    `useI18nLocale()` rides, so the roster's two date cells repaint without a
 *    reload. Asserted here as: format under `fr`, switch to `ru`, format
 *    again - and the second string is `ru`'s.
 *
 * 4. THE OLD SHAPE IS GONE, PROVABLY. date-fns' locale-less `d MMM yyyy` is
 *    imported and run on the same instant: for every non-English locale the
 *    roster's string must DIFFER from it. This is the negative control the
 *    suite carries itself - reverting `formatTeamDate` to the old expression
 *    turns claims 1, 2 and 4 red, not just one.
 *
 * WHAT IT DOES NOT PROVE: pixels, and the mount-level repaint. The sibling
 * `scripts/org-teams-summary.test.mjs` mounts the real roster; the repaint
 * rides `useI18nLocale()` in `org-teams-list.tsx` at both date call sites
 * (`teamRecency` and `teamDates`).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * as summary from "./src/renderer/src/features/agent-hub/components/org-team-summary";',
			'export * as locale from "./src/i18n/locale";',
			'export { format } from "date-fns";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	define: { "import.meta.env": "__viteEnv" },
	banner: { js: "const __viteEnv = {};" },
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
});
const { summary, locale, format } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** Local noon, so the calendar day is the 10th in every timezone. */
const INSTANT = new Date(2026, 9, 10, 12, 0, 0);

/** Every locale the catalogue tree ships (`src/i18n/catalogues/`). */
const SHIPPED = ["en", "es", "fr", "hi", "ru", "ur", "vi", "zh-CN"];

const DATE_OPTIONS = { day: "numeric", month: "short", year: "numeric" };

/* English's own tokens, hoisted: Biome's `useTopLevelRegex` is the repo's rule. */
const YEAR = /2026/;
const SHORT_OCTOBER = /Oct/;
const DAY_TEN = /\b10\b/;
const LONG_OCTOBER = /October/;

const layer = (tag) =>
	new Intl.DateTimeFormat(tag, DATE_OPTIONS).format(INSTANT);

/**
 * The month as the LOCALE SPELLS IT inside a date - read off the formatter's
 * own parts, not from a standalone `{ month: "short" }` call: CLDR carries two
 * forms, and Vietnamese ("thg 10" in a date, "Tháng 10" alone) is the shipped
 * locale where they differ.
 */
const monthIn = (tag) =>
	new Intl.DateTimeFormat(tag, DATE_OPTIONS)
		.formatToParts(INSTANT)
		.find((part) => part.type === "month").value;

/** What the roster printed before this fix: date-fns with no locale. */
const legacy = format(INSTANT, "d MMM yyyy");

test("every shipped locale spells the month its own way", () => {
	for (const tag of SHIPPED) {
		locale.setLocale(tag);
		const printed = summary.formatTeamDate(INSTANT);
		assert.ok(
			printed.includes(monthIn(tag)),
			`${tag}: ${JSON.stringify(printed)} does not carry the locale's own month ${JSON.stringify(monthIn(tag))}`,
		);
		assert.equal(
			printed,
			layer(tag),
			`${tag}: the roster must print the formatter layer's date, not a second spelling`,
		);
	}
});

test("the audited strings: French, Spanish and Russian are not English", () => {
	const expected = {
		fr: "10 oct. 2026",
		es: "10 oct 2026",
		ru: "10 окт. 2026 г.",
	};
	for (const [tag, want] of Object.entries(expected)) {
		locale.setLocale(tag);
		const printed = summary.formatTeamDate(INSTANT);
		assert.equal(printed, want, `${tag} date`);
		/* The negative control: the pre-fix expression prints THIS instead. */
		assert.notEqual(
			printed,
			legacy,
			`${tag}: still printing date-fns' locale-less ${JSON.stringify(legacy)}`,
		);
	}
});

test("English is unchanged in voice: numeric day, short month, year", () => {
	for (const tag of ["en", "en-US", "en-GB"]) {
		locale.setLocale(tag);
		assert.equal(
			summary.formatTeamDate(INSTANT),
			layer(tag),
			`${tag}: English routes through the same layer as everywhere else in the app`,
		);
	}
	locale.setLocale("en-US");
	const printed = summary.formatTeamDate(INSTANT);
	assert.match(printed, YEAR, "the year is present");
	assert.match(printed, SHORT_OCTOBER, "the month is spelled");
	assert.match(printed, DAY_TEN, "the day is present");
	/* No long month name: the row's measure is built on the abbreviated form. */
	assert.doesNotMatch(printed, LONG_OCTOBER);
});

test("a live language switch is followed on the next read", () => {
	locale.setLocale("fr");
	const before = summary.formatTeamDate(INSTANT);

	let notified = 0;
	const unsubscribe = locale.subscribeLocale(() => {
		notified += 1;
	});
	locale.setLocale("ru");
	unsubscribe();
	assert.equal(
		notified,
		1,
		"setLocale must notify the subscribers the hook rides",
	);

	const after = summary.formatTeamDate(INSTANT);
	assert.equal(before, "10 oct. 2026");
	assert.equal(after, "10 окт. 2026 г.");
});

test("the expanded body's created/updated cells localize too", () => {
	const team = {
		created_date: "2026-03-14T12:00:00.000Z",
		updated_at: "2026-09-25T12:00:00.000Z",
	};
	const want = (iso, tag) =>
		new Intl.DateTimeFormat(tag, DATE_OPTIONS).format(new Date(iso));

	for (const tag of SHIPPED) {
		locale.setLocale(tag);
		const dates = summary.teamDates(team);
		assert.equal(dates.created, want(team.created_date, tag), `${tag} created`);
		assert.equal(dates.updated, want(team.updated_at, tag), `${tag} updated`);
	}
});

test("the clock-skew path prints the same localized date", () => {
	/* A future stamp is printed as an absolute date rather than "-2 days ago". */
	const now = Date.parse("2026-10-01T12:00:00.000Z");
	const team = { updated_at: "2026-10-02T12:00:00.000Z" };

	for (const tag of SHIPPED) {
		locale.setLocale(tag);
		const recency = summary.teamRecency(team, now);
		assert.equal(
			recency.when,
			new Intl.DateTimeFormat(tag, DATE_OPTIONS).format(
				new Date(team.updated_at),
			),
			`${tag}: a future stamp is dated, and dated in the reader's language`,
		);
		assert.equal(recency.exact, recency.when);
	}
});
