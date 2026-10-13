import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

import { main as generateMain } from "./generate.mjs";

/*
 * FRENCH ACTIVATION — the bug this slice fixes, pinned.
 *
 * The operator switched the app language to Français, the store truthfully
 * reported `fr`, and every visible string stayed English, because the generated
 * module imported only `catalogues/en/*` and `t()` therefore had no French
 * message to return. This suite proves the mechanism half of the fix: a
 * `catalogues/fr/` message renders under locale `fr`, is invisible under `en`,
 * and a key present only in English falls back to the ENGLISH SOURCE with an
 * `en` FORMATTING tag (so an English plural string cannot pluralise by French
 * rules).
 *
 * It is a real, separately-built module — a fixture catalogue tree is generated
 * into a temp dir and bundled with the actual `src/i18n` runtime — not a mock.
 * A green `tsc` is not this proof: nothing compiles a message into a rendered
 * string, so only an executed lookup discriminates the bug from the fix.
 */

const REPO = join(import.meta.dirname, "..", "..");
const FIXTURES = join(import.meta.dirname, "fixtures", "locales");

async function loadRuntime() {
	const workdir = mkdtempSync(join(tmpdir(), "i18n-activation-"));
	cpSync(join(REPO, "src", "i18n"), join(workdir, "i18n"), { recursive: true });
	rmSync(join(workdir, "i18n", "catalogues"), { recursive: true, force: true });
	cpSync(join(FIXTURES, "catalogues"), join(workdir, "i18n", "catalogues"), {
		recursive: true,
	});
	symlinkSync(join(REPO, "node_modules"), join(workdir, "node_modules"), "dir");
	const exit = generateMain([
		"--catalogues",
		join(workdir, "i18n", "catalogues"),
		"--out",
		join(workdir, "i18n", "keys.gen.ts"),
	]);
	assert.equal(exit, 0, "the generator refused the locales fixture");
	const bundle = await build({
		stdin: {
			contents: [
				'export * as messages from "./i18n/messages";',
				'export * as locale from "./i18n/locale";',
			].join("\n"),
			resolveDir: workdir,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
	rmSync(workdir, { recursive: true, force: true });
	return mod;
}

const { messages, locale } = await loadRuntime();

test("a French catalogue message renders under locale fr", () => {
	locale.setLocale("fr");
	assert.equal(messages.t("demo.words.plain"), "texte simple, sans paramètres");
	assert.equal(
		messages.t("demo.words.hello", { name: "Damian" }),
		"Bonjour, Damian !",
	);
});

test("the same key renders English under locale en, so the lookup is by locale", () => {
	locale.setLocale("en");
	assert.equal(messages.t("demo.words.plain"), "plain text, no params");
	assert.equal(
		messages.t("demo.words.hello", { name: "Damian" }),
		"Hello, Damian!",
	);
});

test("French plural rules apply to a French message", () => {
	locale.setLocale("fr");
	// French treats 0 as singular (`one` covers 0 and 1); English does not.
	assert.equal(messages.t("demo.words.files", { count: 0 }), "0 fichier");
	assert.equal(messages.t("demo.words.files", { count: 1 }), "1 fichier");
	assert.equal(messages.t("demo.words.files", { count: 3 }), "3 fichiers");
});

test("a key absent from fr falls back to the ENGLISH source, not a raw key", () => {
	locale.setLocale("fr");
	// `demo.words.updated` exists only in en (fixture); fr must show the English
	// string — never the key, never a blank.
	const when = new Date("2026-03-04T00:00:00Z");
	const rendered = messages.t("demo.words.updated", { when });
	assert.match(rendered, /^Updated /);
	assert.notEqual(rendered, "demo.words.updated");
});

test("an en fallback formats with ENGLISH rules, not the active locale's", () => {
	/*
	 * The fallback must not only pick the English MESSAGE but format it with an
	 * English TAG. A French `short` date is day-first (`04/03/2026`); an English
	 * one is month-first. The value under `fr` must equal the value under `en`,
	 * which is what proves the tag switched with the catalogue.
	 */
	const when = new Date("2026-03-04T00:00:00Z");
	locale.setLocale("fr");
	const underFr = messages.t("demo.words.updated", { when });
	const underEn = messages.translate("demo.words.updated", { when }, "en");
	assert.equal(underFr, underEn);
	// Guard against the mixed-language bug: an English string must not be
	// formatted with French date rules.
	const withFrenchTag = messages.translate(
		"demo.words.updated",
		{ when },
		"fr",
	);
	assert.equal(withFrenchTag, underEn);
});
