import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The table pager's range phrase is the one place a counted noun is selected by
 * a plural arm AND placed after a numeral the caller formats ("… из 3 сессий").
 * Those two facts together mean the noun pair cannot be the standalone form of
 * the noun: Russian governs the genitive after «из N», so the caller must hand
 * the pager the forms that fit that slot. This suite renders the REAL component
 * twice — once with the analytics panel's session pair taken from the Russian
 * catalogue, once with a second caller's pair — at counts that select every
 * Russian plural category, so a hardcoded «шт.» or a branch that ignores
 * {plurallabel} fails here rather than in a rendered frame.
 *
 * SSR rather than jsdom: nothing interactive is under test, `useI18nLocale`
 * has a server snapshot, and the markup is the whole contract. The bundling
 * idiom is `scripts/canvas-goals.test.mjs`'s: esbuild compiles the real TSX in
 * memory, React stays external so the bundle shares ONE copy with this file,
 * and the renderer's `@shared`/`@features` aliases are declared by hand.
 */
const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { TablePager } from "./src/renderer/src/features/chat/pickers/panels/primitives/table-pager";
			import { setLocale } from "./src/i18n/locale";
			export const renderPager = (props) =>
				renderToStaticMarkup(createElement(TablePager, props));
			export { setLocale };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});
const bundlePath = new URL("./_table-pager-range.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { renderPager, setLocale } = await import(bundlePath.href);
await unlink(bundlePath);

/**
 * The pair the analytics panel's sessions table passes to the pager, read from
 * the locale's real catalogue rather than copied here: the point of the ru case
 * is that the CATALOGUE carries genitive forms, and a hand-copied pair would
 * pass even if it did not.
 */
function pagerPair(locale) {
	const messages = JSON.parse(
		readFileSync(
			join(
				process.cwd(),
				"src/i18n/catalogues",
				locale,
				"ui.chat.pickers.json",
			),
			"utf8",
		),
	);
	return [
		messages["ui.chat.pickers.analytics_panel.session"],
		messages["ui.chat.pickers.analytics_panel.sessions"],
	];
}

const HARDCODED_PIECE = /шт\./;

function range({ label, pluralLabel, from, to, total }) {
	return renderPager({
		page: 0,
		pageCount: 1,
		from,
		to,
		total,
		label,
		pluralLabel,
		onPage: () => {},
	});
}

test("ru: the sessions caller's genitive pair is used in every plural arm", () => {
	setLocale("ru");
	try {
		const [label, pluralLabel] = pagerPair("ru");
		assert.equal(label, "сессии");
		assert.equal(pluralLabel, "сессий");
		for (const [total, from, to, expected] of [
			[1, 1, 1, "1–1 из 1 сессии"],
			[3, 1, 3, "1–3 из 3 сессий"],
			[5, 1, 5, "1–5 из 5 сессий"],
			[21, 21, 21, "21–21 из 21 сессии"],
		]) {
			const markup = range({ label, pluralLabel, from, to, total });
			assert.ok(
				markup.includes(expected),
				`total=${total} rendered without «${expected}»: ${markup}`,
			);
			assert.doesNotMatch(markup, HARDCODED_PIECE);
		}
	} finally {
		setLocale("en");
	}
});

test("ru: a second caller's pair drives the same arms (nothing hardcoded)", () => {
	setLocale("ru");
	try {
		for (const [total, from, to, expected] of [
			[1, 1, 1, "из 1 файла"],
			[5, 1, 5, "из 5 файлов"],
			[21, 21, 21, "из 21 файла"],
		]) {
			const markup = range({
				label: "файла",
				pluralLabel: "файлов",
				from,
				to,
				total,
			});
			assert.ok(
				markup.includes(expected),
				`total=${total} rendered without «${expected}»: ${markup}`,
			);
		}
	} finally {
		setLocale("en");
	}
});

test("en: the same component still reads the nominative pair", () => {
	setLocale("en");
	try {
		const [label, pluralLabel] = pagerPair("en");
		assert.equal(label, "session");
		assert.equal(pluralLabel, "sessions");
		const markup = range({ label, pluralLabel, from: 1, to: 5, total: 5 });
		assert.ok(
			markup.includes("1–5 of 5 sessions"),
			`en rendered without the nominative phrase: ${markup}`,
		);
	} finally {
		setLocale("en");
	}
});
