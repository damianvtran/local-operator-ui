import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
// A SECOND, independent ICU implementation instance (the bundle above inlines
// its own copy): the locale expectations below are rendered here, never through
// `t()`, so a bug in the shipped lookup/format path cannot also corrupt the
// oracle it is judged against.
import { IntlMessageFormat } from "intl-messageformat";

// Only the shipped formatter is bundled, never a React/component dependency
// tree. Execute the actual call expressions below rather than duplicating their
// parameter objects: losing either the raw string or numeric selector must fail.
const bundle = await build({
	stdin: {
		contents:
			'export { t, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n/messages"; export { setLocale } from "./src/i18n/locale";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const { t, setLocale, registerCatalogue, clearRegisteredCatalogues } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
const ROOT = "src/renderer/src/features/chat/";
const SITES = [
	[
		"ask-queue.ts",
		"ui.chat.asks.outstanding_count",
		(n) => `${n} ask${n === 1 ? "" : "s"}`,
	],
	[
		"canonical/fold-media.tsx",
		"ui.chat.canonical.fold.images_aria",
		(n) => `${n} image${n === 1 ? "" : "s"} from this run`,
	],
	[
		"canonical/supplement-image-grid.tsx",
		"ui.chat.canonical.fold.images_aria",
		(n) => `${n} image${n === 1 ? "" : "s"} from this run`,
	],
	[
		"canonical/fold-media.tsx",
		"ui.chat.canonical.fold.more_images",
		(n) => `+${n} more image${n === 1 ? "" : "s"}`,
	],
	[
		"canonical/image-gen-card.tsx",
		"ui.chat.canonical.image_gen.batch_summary",
		(n) => `${n} items`,
	],
	[
		"canonical/image-group-lightbox.tsx",
		"ui.chat.canonical.lightbox.filmstrip_aria",
		(n) => `${n} images`,
	],
	[
		"components/run-details/run-detail-monitors.tsx",
		"ui.chat.run_details.monitors.more",
		(n) => `${n} more monitor${n === 1 ? "" : "s"}`,
	],
	[
		"components/run-details/run-detail-wakes.tsx",
		"ui.chat.run_details.wake.more",
		(n) => `${n} more wake${n === 1 ? "" : "s"}`,
	],
	[
		"components/chat-sidebar.tsx",
		"ui.chat.sidebar.search.count_tooltip",
		(n, clipped) =>
			`${clipped ? "At least " : ""}${n} chat${n === 1 ? " matches" : "s match"} this search${clipped ? "; the list stops there" : ""}`,
	],
];
const COUNTS = [0, 1, 2, 999, 1000, 1001, 1.25, 1000.12345, -1, -1000, 1e21];
const BATCH_FALLBACK =
	/view\.batchSummary\s*\?\?\s*t\("ui\.chat\.canonical\.image_gen\.batch_summary",\s*\{[^}]*\}\)/;
function checkedTranslation(key, params) {
	assert.equal(
		typeof params.count,
		"number",
		`${key}: CLDR selector stays numeric`,
	);
	assert.equal(
		params.count_display,
		String(params.count),
		`${key}: display stays raw`,
	);
	return t(key, params);
}
function calls(file, key) {
	const source = readFileSync(ROOT + file, "utf8");
	const escaped = key.replaceAll(".", "\\.");
	const matches = [
		...source.matchAll(new RegExp(`t\\("${escaped}",\\s*\\{[^}]*\\}\\)`, "g")),
	];
	assert.equal(
		matches.length,
		key === "ui.chat.canonical.fold.more_images" ? 2 : 1,
		`${file}: every production call remains keyed`,
	);
	return matches.map(
		([expression]) =>
			new Function(
				"t",
				"count",
				"open",
				"hidden",
				"more",
				"images",
				"files",
				"view",
				"clipped",
				`return ${expression};`,
			),
	);
}
for (const [file, key, baseline] of SITES) {
	test(`${file}: ${key} preserves raw English at every boundary`, (context) => {
		setLocale("en");
		context.diagnostic(
			JSON.stringify(
				COUNTS.map((count) => ({
					count,
					actual: t(key, {
						count,
						count_display: String(count),
						clipped: "no",
					}),
				})),
			),
		);
		for (const render of calls(file, key)) {
			for (const count of COUNTS) {
				for (const clipped of [false, true]) {
					const expected = baseline(count, clipped);
					assert.equal(
						t(key, {
							count,
							count_display: String(count),
							clipped: clipped ? "yes" : "no",
						}),
						expected,
						`formatter ${key} count=${count}`,
					);
					const actual = render(
						t,
						count,
						count,
						count,
						count,
						{ length: count },
						{ length: count },
						{ batch: { length: count } },
						clipped,
					);
					assert.equal(actual, expected, `production ${key} count=${count}`);
				}
			}
		}
	});
	test(`${file}: passes numeric CLDR selector separately from raw display`, () => {
		registerCatalogue("ru", {
			[key]:
				"{count, plural, one {one} few {few} many {many} other {other}}:{count_display}",
		});
		setLocale("ru");
		try {
			for (const render of calls(file, key)) {
				for (const count of COUNTS) {
					const expected = `${new Intl.PluralRules("ru").select(count)}:${String(count)}`;
					assert.equal(
						render(
							checkedTranslation,
							count,
							count,
							count,
							count,
							{ length: count },
							{ length: count },
							{ batch: { length: count } },
							false,
						),
						expected,
					);
				}
			}
		} finally {
			clearRegisteredCatalogues();
			setLocale("en");
		}
	});
}

test("batch fallback retains supplied summaries, including the empty string", () => {
	const source = readFileSync(`${ROOT}canonical/image-gen-card.tsx`, "utf8");
	const expression = source.match(BATCH_FALLBACK)?.[0];
	assert.ok(expression);
	const render = new Function("t", "view", `return ${expression};`);
	for (const batchSummary of ["provider summary", "", undefined, null]) {
		assert.equal(
			render(t, { batchSummary, batch: { length: 1 } }),
			batchSummary ?? "1 items",
		);
	}
});

// The seven non-English locales now ship all eight plural keys. These tests
// pin what each locale actually renders, using the locale's own catalogue
// message as the oracle (rendered by an independent `intl-messageformat`), plus
// hand-written literals for the CLDR arms, so neither a stale English fallback
// nor a wrong plural category can pass.
const LOCALES = ["fr", "es", "zh-CN", "ru", "vi", "ur", "hi"];
const PLURAL_KEYS = [...new Set(SITES.map(([, key]) => key))];
// `images_aria` has two call sites but is one key: assert the distinct key
// count so a dropped key cannot shrink this proof silently.
assert.equal(PLURAL_KEYS.length, 8, "eight distinct plural keys");
// Any Unicode decimal digit: catches localised digit systems, not only ASCII.
const ANY_DIGIT = /\p{Nd}/u;
const DISPLAY_COUNTS = [0, 1, 2, 5, 999, 1000, 1001, 12345];
const CATALOGUE_ROOT = "src/i18n/catalogues";
const catalogueCache = new Map();
function catalogueFor(locale) {
	let merged = catalogueCache.get(locale);
	if (merged === undefined) {
		merged = {};
		for (const file of readdirSync(`${CATALOGUE_ROOT}/${locale}`)) {
			if (!file.endsWith(".json")) continue;
			Object.assign(
				merged,
				JSON.parse(readFileSync(`${CATALOGUE_ROOT}/${locale}/${file}`, "utf8")),
			);
		}
		catalogueCache.set(locale, merged);
	}
	return merged;
}
function oracle(locale, key, params) {
	const message = catalogueFor(locale)[key];
	assert.equal(typeof message, "string", `${locale} ships ${key}`);
	return new IntlMessageFormat(message, locale).format(params);
}
function withLocale(locale, body) {
	setLocale(locale);
	try {
		body();
	} finally {
		clearRegisteredCatalogues();
		setLocale("en");
	}
}

for (const locale of LOCALES) {
	test(`[${locale}] every plural key resolves to the locale's own catalogue message`, () => {
		withLocale(locale, () => {
			const english = catalogueFor("en");
			for (const key of PLURAL_KEYS) {
				// A locale that silently fell back to English would match the
				// English message; the catalogue must differ for the proof to bite.
				assert.notEqual(
					catalogueFor(locale)[key],
					english[key],
					`${locale}:${key} is translated, not an English copy`,
				);
				for (const count of [...new Set([...COUNTS, ...DISPLAY_COUNTS])]) {
					for (const clipped of ["yes", "no"]) {
						const params = { count, count_display: String(count), clipped };
						assert.equal(
							t(key, params),
							oracle(locale, key, params),
							`${locale} ${key} count=${count} clipped=${clipped}`,
						);
					}
				}
			}
		});
	});

	test(`[${locale}] count_display is rendered verbatim, never localised or grouped`, () => {
		withLocale(locale, () => {
			for (const key of PLURAL_KEYS) {
				for (const count of DISPLAY_COUNTS) {
					const shown = String(count);
					const out = t(key, {
						count,
						count_display: shown,
						clipped: "no",
					});
					assert.ok(
						out.includes(shown),
						`${locale} ${key}: "${out}" shows ${shown}`,
					);
					// Whatever remains once the raw digits are removed must hold no
					// digit at all: "1,000", "1 000" or Arabic-Indic digits would
					// leave residue here.
					assert.doesNotMatch(
						out.replaceAll(shown, ""),
						ANY_DIGIT,
						`${locale} ${key} count=${count}: "${out}" altered the digits`,
					);
				}
			}
		});
	});

	test(`[${locale}] reused shipped key ui.common.actions.copied still resolves`, () => {
		withLocale(locale, () => {
			const common = catalogueFor(locale)["ui.common.actions.copied"];
			assert.equal(typeof common, "string");
			assert.equal(t("ui.common.actions.copied"), common);
			assert.notEqual(
				t("ui.common.actions.copied"),
				"ui.common.actions.copied",
			);
		});
	});
}

// Hand-written expectations, deliberately not derived from the catalogues or
// `Intl.PluralRules`: each row is [count, rendered] for the key named in the
// table. CLDR categories relied on: fr/es one=1 (and fr 0), many=10^6 multiples;
// ru one/few/many by the usual Slavic rule; vi/zh-CN have only `other`;
// ur/en-style =1 then other; hi one covers 0 and 1.
const ARMS = [
	[
		"ru",
		"ui.chat.asks.outstanding_count",
		[
			[1, "1 запрос"],
			[2, "2 запроса"],
			[5, "5 запросов"],
			[21, "21 запрос"],
			[22, "22 запроса"],
			[11, "11 запросов"],
		],
	],
	[
		"ru",
		"ui.chat.sidebar.search.count_tooltip",
		[
			[1, "По этому поиску найден 1 чат"],
			[2, "По этому поиску найдено 2 чата"],
			[5, "По этому поиску найдено 5 чатов"],
			[21, "По этому поиску найден 21 чат"],
		],
	],
	[
		"fr",
		"ui.chat.asks.outstanding_count",
		[
			[0, "0 demande"],
			[1, "1 demande"],
			[2, "2 demandes"],
			[5, "5 demandes"],
			[1000000, "1000000 de demandes"],
		],
	],
	[
		"es",
		"ui.chat.asks.outstanding_count",
		[
			[0, "0 consultas"],
			[1, "1 consulta"],
			[2, "2 consultas"],
			[5, "5 consultas"],
			[1000000, "1000000 de consultas"],
		],
	],
	[
		"zh-CN",
		"ui.chat.asks.outstanding_count",
		[
			[0, "0个请求"],
			[1, "1个请求"],
			[2, "2个请求"],
			[5, "5个请求"],
		],
	],
	[
		"vi",
		"ui.chat.asks.outstanding_count",
		[
			[0, "0 câu hỏi"],
			[1, "1 câu hỏi"],
			[2, "2 câu hỏi"],
			[5, "5 câu hỏi"],
		],
	],
	[
		"ur",
		"ui.chat.asks.outstanding_count",
		[
			[0, "0 سوالات"],
			[1, "1 سوال"],
			[2, "2 سوالات"],
			[5, "5 سوالات"],
		],
	],
	[
		"hi",
		"ui.chat.canonical.fold.more_images",
		[
			[0, "+0 और तस्वीर"],
			[1, "+1 और तस्वीर"],
			[2, "+2 और तस्वीरें"],
			[5, "+5 और तस्वीरें"],
		],
	],
];
for (const [locale, key, rows] of ARMS) {
	test(`[${locale}] ${key} selects the CLDR arm for ${rows.map(([n]) => n).join(", ")}`, () => {
		withLocale(locale, () => {
			for (const [count, expected] of rows) {
				assert.equal(
					t(key, { count, count_display: String(count), clipped: "no" }),
					expected,
					`${locale} ${key} count=${count}`,
				);
			}
		});
	});
}

// RFC §2.5 per-key English fallback, proved on a SYNTHETIC locale that
// deliberately lacks the plural keys (no real locale does any more). It also
// carries one unrelated key so the test shows the locale IS active and the
// plural keys fell through to English individually, not because the whole
// locale was ignored. English rules must format the fallback ("1 ask", not a
// foreign plural category).
test("a locale that lacks a plural key falls back to English with count_display", () => {
	// Registered inside the body: `withLocale` clears registrations on exit.
	withLocale("qq", () => {
		registerCatalogue("qq", { "ui.common.actions.copied": "synthetic-copied" });
		assert.equal(t("ui.common.actions.copied"), "synthetic-copied");
		for (const [, key, baseline] of SITES) {
			for (const count of COUNTS) {
				for (const clipped of [false, true]) {
					assert.equal(
						t(key, {
							count,
							count_display: String(count),
							clipped: clipped ? "yes" : "no",
						}),
						baseline(count, clipped),
						`fallback ${key} count=${count}`,
					);
				}
			}
		}
	});
});
