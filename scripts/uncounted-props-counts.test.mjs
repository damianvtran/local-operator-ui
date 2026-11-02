import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

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

// These locales still lack the eight new keys. Pin their existing per-key
// English fallback and a reused shipped key without inventing translations.
test("existing locale catalogues and reused keys keep their resolution", () => {
	for (const locale of ["fr", "es", "zh-CN", "ru", "vi", "ur", "hi"]) {
		setLocale(locale);
		const common = JSON.parse(
			readFileSync(
				`src/i18n/catalogues/${locale}/ui.common.actions.json`,
				"utf8",
			),
		);
		assert.equal(
			t("ui.common.actions.copied"),
			common["ui.common.actions.copied"],
		);
		for (const [, key, baseline] of SITES) {
			for (const count of COUNTS) {
				assert.equal(
					t(key, { count, count_display: String(count), clipped: "no" }),
					baseline(count, false),
				);
			}
		}
	}
	setLocale("en");
});
