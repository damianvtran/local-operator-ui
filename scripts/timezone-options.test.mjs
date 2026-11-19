/**
 * The profile editor's timezone options follow the live locale (S16c).
 *
 *     node --test scripts/timezone-options.test.mjs
 *
 * The offset beside a zone is CLDR text (`GMT+5:30` in English, `UTC+5:30` in
 * French, `GMT +5:30` in Urdu), so it must change with the UI language, while
 * the SEARCH terms keep the en-US spellings so typing `GMT+5:30` or `EST`
 * still finds a zone whatever the language. `Asia/Calcutta` (the id `supportedValuesOf` lists
 * for Kolkata) and `Asia/Tokyo` have no DST, and the instant is fixed, so no assertion depends on the season.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export { timezoneOptions } from "./src/renderer/src/features/settings/components/timezone-options";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: { "@shared": "./src/renderer/src/shared" },
});
const { timezoneOptions } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const NOW = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
const option = (locale, zone) =>
	timezoneOptions(locale, NOW).find((candidate) => candidate.id === zone);

test("English keeps the offset it always showed", () => {
	const kolkata = option("en", "Asia/Calcutta");
	assert.equal(kolkata.description, "GMT+5:30");
	assert.equal(kolkata.name, "Asia/Calcutta");
	assert.equal(option("en-US", "Asia/Tokyo").description, "GMT+9");
});

test("the description is spelled in the live locale", () => {
	assert.equal(option("fr", "Asia/Calcutta").description, "UTC+5:30");
	assert.equal(option("fr", "Asia/Tokyo").description, "UTC+9");
	assert.equal(option("ur", "Asia/Calcutta").description, "GMT +5:30");
	assert.equal(option("ur", "Asia/Tokyo").description, "GMT +9");
});

test("search keeps BOTH the live-locale and the en-US spellings", () => {
	const fr = option("fr", "Asia/Calcutta").keywords;
	assert.ok(fr.includes("UTC+5:30"), `live-locale offset: ${fr}`);
	assert.ok(fr.includes("GMT+5:30"), `en-US offset still typeable: ${fr}`);
	const ur = option("ur", "Asia/Tokyo").keywords;
	assert.ok(ur.includes("GMT +9"), `live-locale offset: ${ur}`);
	assert.ok(ur.includes("GMT+9"), `en-US offset still typeable: ${ur}`);
	// The en-US short NAME is what people type for a US zone (EST/PST).
	const newYork = timezoneOptions("fr", NOW).find(
		(candidate) => candidate.id === "America/New_York",
	).keywords;
	assert.ok(newYork.includes("EST"), `EST still finds New York: ${newYork}`);
});

test("keywords carry no duplicates and never repeat the zone id", () => {
	for (const locale of ["en", "fr", "ur"]) {
		for (const candidate of timezoneOptions(locale, NOW)) {
			assert.equal(
				new Set(candidate.keywords).size,
				candidate.keywords.length,
				`${locale} ${candidate.id}`,
			);
			assert.ok(!candidate.keywords.includes(candidate.id));
		}
	}
});

test("UTC is offered and every zone has a description", () => {
	const options = timezoneOptions("fr", NOW);
	assert.ok(options.some((candidate) => candidate.id === "UTC"));
	assert.ok(options.every((candidate) => candidate.description));
});
