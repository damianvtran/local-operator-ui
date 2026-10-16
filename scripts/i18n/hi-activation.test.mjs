import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

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

test("local number placeholders and English-source fallback retain their own formatting", () => {
	locale.setLocale("hi");
	const formatted = messages.t("ui.console.capacity.summary_compact_bare", {
		live: 1234567,
		limit: 2000000,
	});
	const number = new Intl.NumberFormat("hi");
	assert.equal(
		formatted,
		`${number.format(1234567)}/${number.format(2000000)}`,
	);
	// Canvas is not carried: English source must use English number formatting,
	// even while the active locale uses different grouping or native digits.
	const fallback = messages.t("ui.canvas.files.count", { count: 1234567 });
	assert.equal(fallback, "1,234,567 files");
	assert.equal(
		fallback,
		messages.translate("ui.canvas.files.count", { count: 1234567 }, "en"),
	);
	console.log(
		`local placeholder: ${formatted}; English fallback ui.canvas.files.count: ${fallback}`,
	);
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
];

/*
 * CLASS-4 COMPOSED-RENDER PIN (round-2 review).
 *
 * `console-pane.tsx` builds the capacity line by SPLICING three keys -
 * `ui.console.capacity.summary` + `.archived` + `.full` - around the counts, so
 * a value-only pin of one fragment cannot catch a doubled or absent separator
 * space. This pins the WHOLE sentence the user reads, through the real t(), at
 * archived 33/1/0 and at the full-capacity state, appending `archived` only when
 * > 0 and `full` only when live >= limit, exactly as the component does.
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
