import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The wake due label's locale behaviour — `formatWakeDue` and the to-do
 * folded-row count, which are the two places English used to be hardcoded
 * INSIDE a sentence rather than in a catalogue.
 *
 * WHAT WAS WRONG. The label was built from a static `WAKE_MONTHS` table and a
 * fixed 12-hour clock, so `{due}` rendered `Mar 14 9:30 AM` in every locale —
 * month name and day period included — while the surrounding sentence came from
 * the catalogue. The folded-row statement under a to-do phase was a template
 * literal, `${count} hidden`, and stayed English the same way. Both are
 * asserted here against the SHIPPED bundle, because a catalogue entry proves
 * only that a key exists, not that the render path asks for it.
 *
 * THE ENGLISH REQUIREMENT IS BYTE-IDENTITY, not "still reads fine": this label
 * is embedded in sentences translators already worked against (`Cancel the wake
 * that fires {due}`), so an English change here would silently invalidate every
 * one of them. The assertions state the exact strings the pre-extraction code
 * produced, including the 12-hour boundaries and the comma-free year form, and
 * the count is asserted at 1, 5 and 1000 — the last one is what `::group-off`
 * in the message buys, since bare `#` would print `1,000`.
 *
 * NEGATIVE CONTROL. The French case must fail against the code as it was before
 * the fix. Reproduce it with the model from a ref that predates the locale
 * work, then run this SAME file against that source:
 *
 *   git show <base-sha>:src/renderer/src/features/chat/components/run-details/run-detail-model.ts \
 *     > "$LOCAL_OPERATOR_SCRATCHPAD/base-run-detail-model.ts"
 *   RUN_DETAIL_MODEL_SRC="$LOCAL_OPERATOR_SCRATCHPAD/base-run-detail-model.ts" \
 *     node --test scripts/run-detail-wake-label-locale.test.mjs
 *
 * It exits non-zero on `14 mars` (the base prints `Mar 14`) and on the 24-hour
 * clock (the base prints `2:05 PM`). `RUN_DETAIL_MODEL_SRC` exists for that
 * control only; the default is the tree's own model, so a normal run cannot
 * pass by testing a stale copy.
 */

const MODEL_SOURCE =
	process.env.RUN_DETAIL_MODEL_SRC ??
	"./src/renderer/src/features/chat/components/run-details/run-detail-model";

const bundle = await build({
	stdin: {
		contents: [
			`export * from ${JSON.stringify(MODEL_SOURCE)};`,
			// The locale store is the seam `formatWakeDue` reads; the control needs
			// to drive it, and one specifier keeps it the SAME module instance the
			// model sees (`@shared/i18n` re-exports this file).
			'export { currentLocale, setLocale, t } from "@shared/i18n";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	// esbuild cannot read tsconfig paths; the renderer's alias is declared by
	// hand exactly as `run-detail-model.test.mjs` does.
	alias: {
		"@shared": "./src/renderer/src/shared",
	},
	write: false,
});
const { currentLocale, formatWakeDue, setLocale, t } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The platform's own short zone name for `due`, in `locale`. */
const zoneFor = (locale, due) =>
	new Intl.DateTimeFormat(locale, { timeZoneName: "short" })
		.formatToParts(due)
		.find((part) => part.type === "timeZoneName")?.value;

/* Hoisted for `useTopLevelRegex`, the repo's lint rule for literals a callback
 * would rebuild on every call. */
const ENGLISH_MIDNIGHT = /^12:05 AM /;
const ENGLISH_NOON = /^12:00 PM /;
const DAY_PERIOD = /AM|PM/;

test("the English label is unchanged, byte for byte", () => {
	/*
	 * Built from LOCAL components so the assertions hold in whatever zone the
	 * machine runs in — the label is the local clock by design, and a test
	 * pinned to one zone would pass in that zone only.
	 */
	setLocale("en");
	const due = new Date(2026, 2, 14, 9, 30);
	const zone = zoneFor("en", due);
	const sameDay = new Date(2026, 2, 14, 20, 0).getTime();
	const laterDay = new Date(2026, 2, 20, 8, 0).getTime();
	const laterYear = new Date(2027, 2, 20, 8, 0).getTime();

	assert.equal(formatWakeDue(due.getTime(), sameDay), `9:30 AM ${zone}`);
	assert.equal(
		formatWakeDue(due.getTime(), laterDay),
		`Mar 14 9:30 AM ${zone}`,
		"an English month abbreviation, a space, and no comma",
	);
	assert.equal(
		formatWakeDue(due.getTime(), laterYear),
		`Mar 14 2026 9:30 AM ${zone}`,
		"the year joins the same token sequence rather than Intl's `Mar 14, 2026`",
	);

	/*
	 * The two 12-hour boundaries, which a locale-driven clock still has to get
	 * right for `en`: midday is `12:00 PM`, not `0:00 PM`, and midnight is
	 * `12:05 AM`.
	 */
	assert.match(
		formatWakeDue(new Date(2026, 2, 14, 0, 5).getTime(), sameDay),
		ENGLISH_MIDNIGHT,
	);
	assert.match(
		formatWakeDue(new Date(2026, 2, 14, 12, 0).getTime(), sameDay),
		ENGLISH_NOON,
	);

	/* The zone is always visible, so UTC is never implied. */
	assert.ok(formatWakeDue(due.getTime(), sameDay).endsWith(zone));
});

test("a French label takes the month name and the clock from the locale", () => {
	setLocale("fr");
	assert.equal(currentLocale(), "fr", "the store is what the model reads");

	const due = new Date(2026, 2, 14, 14, 5);
	const zone = zoneFor("fr", due);
	const sameDay = new Date(2026, 2, 14, 20, 0).getTime();
	const laterDay = new Date(2026, 2, 20, 8, 0).getTime();
	const laterYear = new Date(2027, 2, 20, 8, 0).getTime();

	/* Same day: the short, time-only form, in French's 24-hour clock. */
	assert.equal(formatWakeDue(due.getTime(), sameDay), `14:05 ${zone}`);
	assert.doesNotMatch(formatWakeDue(due.getTime(), sameDay), DAY_PERIOD);

	/* Older stamps add the date: day before month, the French month name. */
	assert.equal(
		formatWakeDue(due.getTime(), laterDay),
		`14 mars 14:05 ${zone}`,
		"day-before-month order and a French month name, not `Mar 14`",
	);
	assert.equal(
		formatWakeDue(due.getTime(), laterYear),
		`14 mars 2026 14:05 ${zone}`,
	);

	setLocale("en");
});

test("the folded-row count renders from the catalogue", () => {
	/*
	 * The statement under a partly-shed phase used to be `${count} hidden`. The
	 * key carries an ICU plural, so the SAME English text has to come back for
	 * every count — and `::group-off` keeps the raw integer the literal printed
	 * (bare `#` would give `1,000` at the last case).
	 */
	setLocale("en");
	const hidden = (count) =>
		t("ui.chat.run_details.todos.hidden_summary", { count });
	assert.equal(hidden(1), "1 hidden");
	assert.equal(hidden(5), "5 hidden");
	assert.equal(hidden(1000), "1000 hidden");
});
