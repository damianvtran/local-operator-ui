/*
 * THE AGENT / TEAM MENU FOOTER COUNTS CORRECTLY IN EVERY SHIPPED LANGUAGE.
 *
 * Six messages (`ui.chat.header_identity.footer_{all,match,partial}_{agents,teams}`)
 * carry a count and a noun, so each one is an ICU `plural`. English only needs
 * `one`/`other`, and for a long time the footer was a hardcoded English template
 * literal that printed "1 agents". The translation lane's catalogues are the
 * ones that must name EVERY category the language's CLDR rules produce: French
 * and Spanish select `many` for 1,000,000 (the "de" partitive: "un million de
 * agentes"), Russian needs `few` and `many`, and a missing arm does not throw -
 * ICU silently falls back to `other`, which is grammatically wrong for exactly
 * the counts a reviewer is least likely to try. `locale-parity.test.mjs`
 * proves the arguments match English; it does not look at plural arms.
 *
 * What this pins, against the REAL catalogues (no fixtures standing in for them):
 *   1. every footer message parses and has the same argument names as English;
 *   2. its plural selector carries every category
 *      `Intl.PluralRules(locale).resolvedOptions().pluralCategories` lists for the
 *      language (fr/es: one,many,other; ru: one,few,many,other; ur/hi: one,other;
 *      vi/zh-CN: other) - derived from the runtime's CLDR data, not hand-typed;
 *   3. it formats for 1, 2, 5, 21 and 1000000 without throwing, with the number
 *      printed in Latin digits and ungrouped (`::group-off`): a number rendered
 *      "1,000,000" or in Arabic-Indic digits inside the footer sentence would
 *      read as a different token in a mixed-script line.
 * The mutation cases drop a category from an in-memory copy, never from disk, so
 * the category check is shown to fail when it should.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { TYPE, parse } from "@formatjs/icu-messageformat-parser";
import { IntlMessageFormat } from "intl-messageformat";

const CATALOGUES = join(process.cwd(), "src", "i18n", "catalogues");
const FOOTER_PREFIX = "ui.chat.header_identity.footer_";
const COUNTS = [1, 2, 5, 21, 1000000];

const readFooter = (locale) =>
	Object.fromEntries(
		Object.entries(
			JSON.parse(
				readFileSync(join(CATALOGUES, locale, "ui.chat.json"), "utf8"),
			),
		).filter(([key]) => key.startsWith(FOOTER_PREFIX)),
	);

const english = readFooter("en");
const locales = readdirSync(CATALOGUES).filter((name) => name !== "en");

/** Argument names, plural/select arms walked (the parity guard's shape). */
function argumentNames(message) {
	const names = new Set();
	const walk = (nodes) => {
		for (const node of nodes) {
			if (
				[
					TYPE.argument,
					TYPE.number,
					TYPE.plural,
					TYPE.select,
					TYPE.date,
					TYPE.time,
				].includes(node.type) &&
				typeof node.value === "string"
			)
				names.add(node.value);
			for (const option of Object.values(node.options ?? {}))
				if (Array.isArray(option?.value)) walk(option.value);
		}
	};
	walk(parse(message));
	return names;
}

/** Categories the message's TOP-LEVEL plural selector names (`=N` arms are not categories). */
function selectorCategories(message) {
	const plural = parse(message).find((node) => node.type === TYPE.plural);
	return plural
		? Object.keys(plural.options).filter((name) => !name.startsWith("="))
		: [];
}

const requiredCategories = (locale) =>
	new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);

const missingCategories = (message, locale) =>
	[...requiredCategories(locale)].filter(
		(category) => !selectorCategories(message).includes(category),
	);

test("six footer messages exist in English and every shipped locale (the guard is not vacuous)", () => {
	assert.equal(Object.keys(english).length, 6);
	assert.ok(locales.length >= 7, `locales: ${locales.join(",")}`);
	for (const locale of locales)
		assert.deepEqual(
			Object.keys(readFooter(locale)).sort(),
			Object.keys(english).sort(),
			`${locale} footer keys`,
		);
});

for (const locale of locales) {
	test(`${locale}: footer messages keep English's arguments and name every CLDR plural category`, () => {
		const footer = readFooter(locale);
		for (const [key, source] of Object.entries(english)) {
			const message = footer[key];
			assert.deepEqual(
				[...argumentNames(message)].sort(),
				[...argumentNames(source)].sort(),
				`${locale} ${key}: argument names`,
			);
			assert.deepEqual(
				missingCategories(message, locale),
				[],
				`${locale} ${key}: plural categories missing for ${[...requiredCategories(locale)].join(",")}`,
			);
		}
	});

	test(`${locale}: footer messages render for 1, 2, 5, 21, 1000000 in ungrouped Latin digits`, () => {
		for (const [key, message] of Object.entries(readFooter(locale))) {
			for (const count of COUNTS) {
				// `matches` <= `total` for the partial message; ignored by the others.
				const text = new IntlMessageFormat(message, locale).format({
					count,
					total: count,
					matches: Math.max(0, count - 1),
				});
				assert.equal(typeof text, "string", `${locale} ${key} ${count}`);
				assert.ok(text.trim().length > 0, `${locale} ${key} ${count}: empty`);
				assert.ok(
					!/[{}]|undefined|NaN/.test(text),
					`${locale} ${key} ${count}: unresolved placeholder in ${JSON.stringify(text)}`,
				);
				// Every decimal digit is ASCII 0-9 (no Arabic-Indic / Devanagari digits).
				assert.ok(
					![...text.matchAll(/\p{Nd}/gu)].some(
						([digit]) => !/[0-9]/.test(digit),
					),
					`${locale} ${key} ${count}: non-Latin digits in ${JSON.stringify(text)}`,
				);
				// No group separator: the number appears whole.
				assert.ok(
					text.includes(String(count)),
					`${locale} ${key} ${count}: number not printed whole in ${JSON.stringify(text)}`,
				);
				if (count === 1000000)
					assert.ok(
						text.includes("1000000"),
						`${locale} ${key}: million grouped in ${JSON.stringify(text)}`,
					);
			}
		}
	});
}

/** Remove one top-level plural arm from an in-memory copy of a message. */
const dropArm = (message, arm) =>
	message.replace(new RegExp(` ${arm} \\{(?:[^{}]|\\{[^{}]*\\})*\\}`), "");

test("negative control: dropping `many` from an es copy, or `few` from a ru copy, is caught", () => {
	for (const [locale, arm] of [
		["es", "many"],
		["fr", "many"],
		["ru", "few"],
		["ru", "many"],
	]) {
		for (const [key, message] of Object.entries(readFooter(locale))) {
			const mutated = dropArm(message, arm);
			assert.notEqual(
				mutated,
				message,
				`${locale} ${key}: arm ${arm} not found`,
			);
			assert.deepEqual(
				missingCategories(mutated, locale),
				[arm],
				`${locale} ${key}: the check must report exactly the dropped ${arm}`,
			);
		}
	}
});

test("negative control: the in-memory mutation did not touch the catalogue on disk", () => {
	for (const message of Object.values(readFooter("es")))
		assert.deepEqual(missingCategories(message, "es"), []);
});
