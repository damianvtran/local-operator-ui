import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

import { withAbsentLocale } from "./absent-locale.mjs";

// A fixture-only pass misses a forgotten generated import. Exercise the actual
// bundled catalogues so locale publication cannot silently remain English.
const bundle = await build({
	stdin: {
		contents: [
			'export * as messages from "./src/i18n/messages";',
			'export * as locale from "./src/i18n/locale";',
		].join("\n"),
		resolveDir: new URL("../../", import.meta.url).pathname,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { messages, locale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("shipped Hindi covers all three surfaces and switches back to English", () => {
	locale.setLocale("hi");
	assert.equal(messages.t("ui.settings.page.title"), "सेटिंग्स");
	assert.equal(messages.t("ui.console.pane.label"), "कंसोल");
	assert.equal(
		messages.t("ui.onboarding.modal.step_of", { current: 2, total: 5 }),
		"चरण 2, कुल 5",
	);
	console.log("hi" + ": " + "सेटिंग्स" + " | " + "कंसोल" + " | " + "चरण 2, कुल 5");
	locale.setLocale("en");
	assert.equal(messages.t("ui.settings.page.title"), "Settings");
	assert.equal(messages.t("ui.console.pane.label"), "Console");
	console.log("en: Settings | Console");
});

test("counts render ungrouped (the #1131 fidelity rule); uncarried namespaces use the English source", () => {
	locale.setLocale("hi");
	// The count sinks carry ::group-off exactly as the English source has since
	// #1131: 1 / >1 / >=1000 all render the raw number, matching what the
	// pre-extraction source rendered (`1000`, never `1,000`).
	for (const [live, limit, expected] of [
		[1, 3, "1/3"],
		[64, 128, "64/128"],
		[1234567, 2000000, "1234567/2000000"],
	]) {
		assert.equal(
			messages.t("ui.console.capacity.summary_compact_bare", { live, limit }),
			expected,
		);
	}
	const formatted = messages.t("ui.console.capacity.summary_compact_bare", {
		live: 1234567,
		limit: 2000000,
	});
	const number = new Intl.NumberFormat("hi");
	assert.notEqual(
		formatted,
		`${number.format(1234567)}/${number.format(2000000)}`,
		"the group-off token must suppress Hindi grouping at >= 1000",
	);
	assert.equal(
		messages.t("ui.onboarding.modal.step_of", {
			current: 1234567,
			total: 2000000,
		}),
		"चरण 1234567, कुल 2000000",
	);
	// Canvas is not carried: the English source applies, including its own
	// group-off rule. Assert that on the shared synthetic tag, never on `hi` -
	// a real locale expires the assertion the day its tranche ships ui.canvas.
	// restoreLocale() switches the locale back; the empty fixture stays
	// registered under the tag and carries no keys.
	const restoreLocale = withAbsentLocale({
		currentLocale: locale.currentLocale,
		setLocale: locale.setLocale,
		registerCatalogue: messages.registerCatalogue,
	});
	try {
		const fallback = messages.t("ui.canvas.files.count", { count: 1234567 });
		assert.equal(fallback, "1234567 files");
		assert.equal(
			fallback,
			messages.translate("ui.canvas.files.count", { count: 1234567 }, "en"),
		);
		console.log(
			`hi counts ungrouped: ${formatted}; English fallback ui.canvas.files.count: ${fallback}`,
		);
	} finally {
		restoreLocale();
	}
});
const DOUBLED_SPACE = / {2,}/;
const UNRENDERED_PLACEHOLDER = /\{/;

const CAPACITY_CASES_hi = [
	[{ live: 64, archived: 33, limit: 128 }, "ऐप में 64 चालू, सीमा 128 · 33 रखे गए"],
	[{ live: 64, archived: 1, limit: 128 }, "ऐप में 64 चालू, सीमा 128 · 1 रखा गया"],
	[{ live: 64, archived: 0, limit: 128 }, "ऐप में 64 चालू, सीमा 128"],
	[
		{ live: 128, archived: 2, limit: 128 },
		"ऐप में 128 चालू, सीमा 128 · 2 रखे गए · सीमा पूरी",
	],
	[
		{ live: 1000, archived: 1, limit: 1000 },
		"ऐप में 1000 चालू, सीमा 1000 · 1 रखा गया · सीमा पूरी",
	],
	[
		{ live: 1234567, archived: 3000000, limit: 2000000 },
		"ऐप में 1234567 चालू, सीमा 2000000 · 3000000 रखे गए",
	],
];

/*
 * CLASS-4 COMPOSED-RENDER PIN (round-2 review).
 *
 * `console-pane.tsx` builds the capacity line by SPLICING three keys -
 * `ui.console.capacity.summary` + `.archived` + `.full` - around the counts, so
 * a value-only pin of one fragment cannot catch a doubled or absent separator
 * space. This pins the WHOLE sentence the user reads, through the real t(), at
 * archived 33/1/0 and at >=1000 counts (the #1131 fidelity rule), and at the
 * full-capacity state, appending `archived` only when > 0 and `full` only when
 * live >= limit, exactly as the component does.
 */
test("hi: the composed console capacity sentence reads as one sentence", () => {
	locale.setLocale("hi");
	const compose = (capacity) =>
		messages.t("ui.console.capacity.summary", capacity) +
		(capacity.archived > 0
			? messages.t("ui.console.capacity.archived", capacity)
			: "") +
		(capacity.live >= capacity.limit
			? messages.t("ui.console.capacity.full", capacity)
			: "");
	for (const [capacity, expected] of CAPACITY_CASES_hi) {
		const composed = compose(capacity);
		assert.equal(composed, expected);
		assert.doesNotMatch(composed, DOUBLED_SPACE, "no doubled space");
		assert.doesNotMatch(
			composed,
			UNRENDERED_PLACEHOLDER,
			"no unrendered placeholder",
		);
	}
	console.log(`hi composed: ${CAPACITY_CASES_hi[0][1]}`);
});
