/**
 * NEVER-KEYED ENGLISH FOUND BY THE PACKAGED-APP CENSUS, and the one bidi fault.
 *
 * WHY THIS FILE EXISTS. The native census (QA tier 2, PR #1603) drove the built
 * app under fr/vi/ur and found English and a reversed glyph pair the scanner
 * cannot see, because none of it is JSX text or a copy attribute:
 *
 *   Q-T2-2  effort display labels (`Low`/`Medium`/`High`) come out of
 *           `effortDisplay`, a lookup table of string literals;
 *   Q-T2-3  `2 wakes armed` and `once` come out of template literals in the
 *           run-detail model;
 *   Q-T2-1  Urdu `(⌘R)` paints as `(R⌘)`: the glyph run sits between RTL
 *           letters and the bidi algorithm reverses it.
 *
 * (Q-T2-4, the empty tab title, is main-process code and is pinned in
 * `browser-host.test.mjs`, next to the host harness it needs.)
 *
 * WHAT IS ASSERTED, and the order matters. (1) ENGLISH IS UNCHANGED BYTE FOR
 * BYTE: translators already worked against sentences that embed these words
 * (`Keep as once`, `Reasoning effort: High.`), so a changed English string would
 * silently invalidate them. (2) A synthetic NON-English catalogue changes what is
 * painted - the marker values have a shape no English sentence has, so a literal
 * that never reached the catalogue stays visible. (3) The wire value is never
 * translated - `effortDisplay` is display-only - while every word the effort
 * table KNOWS is keyed copy and localizes; a token the table does not know, and
 * the sentinel `inherit`, pass through exactly as they arrive.
 *
 * NEGATIVE CONTROL. Against the unfixed model source the marker cases fail: `effortDisplay("high")` answers
 * `High` under the marker catalogue, `wakeClause(2)` answers `2 wakes armed`, and
 * `isolateLtr` does not exist. That is what distinguishes this file from one that
 * only re-states the English.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

// A source-only negative control, with the same new catalogue and assertions:
// CENSUS_CONTROL_BASE=origin/main node --test scripts/i18n/census-never-keyed.test.mjs
// replaces only the two models with their pre-fix bytes, without touching HEAD.
const controlBase = process.env.CENSUS_CONTROL_BASE;
const CONTROL_MODEL = /\/(?:session-model|run-detail-model)\.ts$/;
const bundle = await build({
	plugins: controlBase
		? [
				{
					name: "pre-fix-model-control",
					setup(builder) {
						builder.onLoad({ filter: CONTROL_MODEL }, ({ path }) => ({
							contents: execFileSync(
								"git",
								["show", `${controlBase}:${relative(process.cwd(), path)}`],
								{ encoding: "utf8" },
							),
							loader: "ts",
						}));
					},
				},
			]
		: [],
	stdin: {
		contents: `
			export { ShortcutText } from "./src/renderer/src/shared/i18n/shortcut-text";
            export { createElement } from "react";
            export { renderToStaticMarkup } from "react-dom/server";
            export { effortDisplay } from "./src/renderer/src/features/chat/session-status/session-model";
			export {
				formatWakeCadence,
				wakeClause,
			} from "./src/renderer/src/features/chat/components/run-details/run-detail-model";
			export {
				clearRegisteredCatalogues,
				isolateLtr,
				registerCatalogue,
				setLocale,
				t,
			} from "@shared/i18n";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	jsx: "automatic",
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(process.cwd() + "/package.json");',
	},
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	define: { "import.meta.env": "{}" },
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	ShortcutText,
	createElement,
	renderToStaticMarkup,
	t,
	clearRegisteredCatalogues,
	effortDisplay,
	formatWakeCadence,
	isolateLtr,
	registerCatalogue,
	setLocale,
	wakeClause,
} = mod;

/** Run `body` under a locale and always restore English and an empty registry. */
const withLocale = (locale, catalogue, body) => {
	registerCatalogue(locale, catalogue);
	setLocale(locale);
	try {
		body();
	} finally {
		clearRegisteredCatalogues();
		setLocale("en");
	}
};

const LEVELS = { low: "Low", medium: "Medium", high: "High" };

test("effort display words are unchanged in English, and case-insensitive on the wire value", () => {
	setLocale("en");
	for (const [wire, shown] of Object.entries(LEVELS)) {
		assert.equal(effortDisplay(wire), shown);
		assert.equal(effortDisplay(wire.toUpperCase()), shown);
		assert.equal(effortDisplay(`  ${wire} `), shown);
	}
	assert.equal(effortDisplay(""), "");
	assert.equal(effortDisplay("   "), "");
});

test("state words and raw inherit pass through untouched", () => {
	setLocale("en");
	// These are states/sentinels, not the three display labels extracted here.
	for (const word of ["unknown", "reasoning", "inherit"]) {
		assert.equal(effortDisplay(word), word);
	}
});

test("a translated catalogue changes the display word and nothing else", () => {
	/*
	 * EVERY word the effort table owns has to be covered by the marker, in both
	 * families it reads: `low`/`medium`/`high` are keyed in `session_status`, the
	 * rest in `session_readout` (the composer wave keyed those). A marker that
	 * covers one family only passes on the ENGLISH FALLBACK of the other, so it
	 * cannot tell a localized word from a missing one — which is the fault this
	 * file exists to catch.
	 */
	const readoutWords = [
		"auto",
		"none",
		"minimal",
		"xhigh",
		"max",
		"unknown",
		"reasoning",
	];
	const marker = Object.fromEntries([
		...Object.keys(LEVELS).map((wire) => [
			`ui.chat.session_status.effort_level.${wire}`,
			`FR[${wire}]`,
		]),
		...readoutWords.map((word) => [
			`ui.chat.session_readout.effort.level.${word}`,
			`FR[${word}]`,
		]),
	]);
	withLocale("fr", marker, () => {
		for (const wire of Object.keys(LEVELS)) {
			assert.equal(effortDisplay(wire), `FR[${wire}]`);
		}
		for (const word of readoutWords) {
			assert.equal(effortDisplay(word), `FR[${word}]`);
		}
		// A token the table does not know, and the sentinel `inherit`, stay as they
		// arrive: nothing is matched on this string.
		assert.equal(effortDisplay("inherit"), "inherit");
		assert.equal(effortDisplay("turbo"), "turbo");
	});
});

test("the wake count clause is unchanged in English at every boundary", () => {
	setLocale("en");
	assert.equal(wakeClause(0), "0 wakes armed");
	assert.equal(wakeClause(1), "1 wake armed");
	assert.equal(wakeClause(2), "2 wakes armed");
	assert.equal(wakeClause(16), "16 wakes armed");
	// Raw count_display preserves interpolation: bare `#` would print `1,000`.
	assert.equal(wakeClause(1000), "1000 wakes armed");
	for (const count of [-1, -1000, 1.25, 1000.12345, 1e21])
		assert.equal(wakeClause(count), `${count} wakes armed`);
});

test("the wake count clause takes the locale's own plural categories", () => {
	withLocale(
		"ru",
		{
			"ui.chat.run_details.wake.armed_count":
				"{count, plural, one {ONE:#} few {FEW:#} many {MANY:#} other {OTHER:#}}",
		},
		() => {
			// Russian needs three non-`other` categories; English's two arms
			// could not express them, which is why this is a plural and not a ternary.
			assert.equal(wakeClause(1), "ONE:1");
			assert.equal(wakeClause(2), "FEW:2");
			assert.equal(wakeClause(5), "MANY:5");
			assert.equal(wakeClause(21), "ONE:21");
		},
	);
});

test("wake cadence is unchanged in English for every shape the wire can carry", () => {
	setLocale("en");
	assert.equal(formatWakeCadence(null, null), "once");
	assert.equal(formatWakeCadence(null, 3), "once");
	assert.equal(formatWakeCadence(6 * 3_600_000, null), "every 6h");
	assert.equal(formatWakeCadence(6 * 3_600_000, 3), "every 6h · 3 left");
	assert.equal(formatWakeCadence(6 * 3_600_000, 1), "every 6h · 1 left");
	assert.equal(
		formatWakeCadence(6 * 3_600_000, 0),
		"every 6h · no deliveries left",
	);
	assert.equal(formatWakeCadence(5_400_000, null), "every 1h30m");
	// A count outside the derived clamp prints as the wire sent it.
	assert.equal(formatWakeCadence(6 * 3_600_000, -2), "every 6h · -2 left");
	assert.equal(formatWakeCadence(6 * 3_600_000, 1000), "every 6h · 1000 left");
});

const LRI = "\u2066";
const PDI = "\u2069";

test("isolateLtr is the identity outside right-to-left locales", () => {
	for (const locale of ["en", "fr", "es", "ru", "vi", "hi", "zh-CN", "en-US"]) {
		setLocale(locale);
		assert.equal(isolateLtr("⌘R"), "⌘R", locale);
		assert.equal(isolateLtr("Ctrl+["), "Ctrl+[", locale);
	}
	setLocale("en");
});

test("isolateLtr wraps the glyph run, and only the run, under Urdu", () => {
	setLocale("ur");
	try {
		assert.equal(isolateLtr("⌘R"), `${LRI}⌘R${PDI}`);
		assert.equal(isolateLtr("Ctrl+["), `${LRI}Ctrl+[${PDI}`);
		// The primary subtag decides direction, as it does for the document root.
		setLocale("ur-PK");
		assert.equal(isolateLtr("⌘R"), `${LRI}⌘R${PDI}`);
		// Nothing to isolate, nothing to wrap: no stray controls around "".
		assert.equal(isolateLtr(""), "");
	} finally {
		setLocale("en");
	}
});

// Exercise the shipped JSX presentation seam, not just the formatter's output.
test("a reload tooltip keeps English text unchanged and emits a real LTR bdi in Urdu", () => {
	const source = readFileSync(
		"src/renderer/src/features/browser/components/browser-url-bar.tsx",
		"utf8",
	);
	assert.ok(
		source.includes('text={t("ui.browser.browser_url_bar.reload_shortcut", {'),
	);
	assert.ok(source.includes("shortcut: isolateLtr(reload.glyph)"));
	setLocale("en");
	const english = t("ui.browser.browser_url_bar.reload_shortcut", {
		shortcut: isolateLtr("⌘R"),
	});
	assert.equal(
		renderToStaticMarkup(createElement(ShortcutText, { text: english })),
		"Reload (⌘R)",
	);
	setLocale("ur");
	try {
		const text = t("ui.browser.browser_url_bar.reload_shortcut", {
			shortcut: isolateLtr("⌘R"),
		});
		assert.equal(
			renderToStaticMarkup(createElement(ShortcutText, { text })),
			'دوبارہ لوڈ کریں (<bdi dir="ltr">⌘R</bdi>)',
		);
	} finally {
		setLocale("en");
	}
});

const SHORTCUT_SENTENCES = [
	["ui.browser.browser_url_bar.back_shortcut", { shortcut: "⌘[" }, "Back (⌘[)"],
	[
		"ui.browser.browser_url_bar.forward_shortcut",
		{ shortcut: "⌘]" },
		"Forward (⌘])",
	],
	[
		"ui.browser.browser_find_row.previous_match_shortcut",
		{ shortcut: "⌘⇧G" },
		"Previous match (⌘⇧G)",
	],
	[
		"ui.browser.browser_find_row.next_match_shortcut",
		{ shortcut: "⌘G" },
		"Next match (⌘G)",
	],
	[
		"ui.browser.browser_find_row.close_find_shortcut",
		{ shortcut: "Esc" },
		"Close find (Esc)",
	],
	[
		"ui.browser.browser_tab_strip.close_tab_shortcut",
		{ shortcut: "⌘W" },
		"Close tab (⌘W)",
	],
	[
		"ui.shell.sidebar_navigation.new_chat_shortcut",
		{ shortcut: "⌘N" },
		"New chat (⌘N)",
	],
	[
		"ui.shell.sidebar_navigation.search_accessible",
		{ everything: "⌘P", chats: "⌘K" },
		"Search (⌘P) — chats (⌘K)",
	],
	[
		"ui.shell.sidebar_navigation.search_tooltip",
		{ everything: "⌘P", chats: "⌘K" },
		"Search everything (⌘P) · your chats (⌘K)",
	],
	[
		"ui.chat.composer.start_recording_hint",
		{ shortcut: "⌘⇧Space", pushToTalk: "Left-Control" },
		"Start recording (⌘⇧Space or hold Left-Control)",
	],
	[
		"ui.canvas.inline_edit.start_recording_or_hold",
		{ shortcuttext: "⌘⇧Space", label: "Left-Control" },
		"Start recording (⌘⇧Space or hold Left-Control)",
	],
];
test("sibling shortcut-bearing tooltip and attribute sentences retain their exact English", () => {
	setLocale("en");
	for (const [key, params, expected] of SHORTCUT_SENTENCES) {
		const actual = t(
			key,
			Object.fromEntries(
				Object.entries(params).map(([name, value]) => [
					name,
					isolateLtr(value),
				]),
			),
		);
		assert.equal(actual, expected, key);
	}
});
