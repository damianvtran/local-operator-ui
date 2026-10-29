import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE CONFIG COMPOSER NAMES ITS KIND IN THE READER'S LANGUAGE.
 *
 * WHY THIS EXISTS. `ui.agents.config.about` ("About {kind} {name}") and the
 * "({kind})" suffix of the summary rows were fed the raw wire kind -- the
 * English words `agent` and `team` -- so every other locale printed an English
 * noun mid-sentence ("Concerne : team shipping", "关于agent coder"). The
 * seven-locale union audit of PR #1439 measured it (es major; vi and zh-CN
 * findings point at the same cause). The fix keys the two kind words
 * (`ui.agents.config.kind.agent` / `.team`, the skill precedent) and routes
 * `kindWord` through them.
 *
 * WHAT IT PINS, in two halves that fail independently:
 *   1. CATALOGUE HALF -- in every shipped locale the keyed kind word composes
 *      into the About sentence and the summary suffix, and what it prints is
 *      the locale's own noun, not the English wire word. fr `agent` is the one
 *      legitimate cognate (the glossary term is spelled the same), so it is
 *      checked against `équipe` for team instead.
 *   2. CALL-SITE HALF -- the composer's `aboutLine` must not hand
 *      `about.kind` to `t()` again. A source assertion is the only cheap way to
 *      pin that: rendering the component costs a multi-minute desktop suite, and
 *      the English render is already covered by `agent-class-toggle.test.mjs`
 *      ("About agent aida"), which is why English stays byte-identical.
 *      `configSeedPrompt` keeps the raw wire word ON PURPOSE: it is the sentence
 *      sent to the model, not interface copy.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as messages from "./src/i18n/messages";',
			'export * as locale from "./src/i18n/locale";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { messages, locale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const LOCALES = ["fr", "es", "hi", "ru", "ur", "vi", "zh-CN"];
const WIRE_WORDS = ["agent", "team"];

function kindWord(kind) {
	return messages.t(`ui.agents.config.kind.${kind}`);
}

test("English still prints the wire words, so the English UI is byte-identical", () => {
	locale.setLocale("en");
	assert.equal(kindWord("agent"), "agent");
	assert.equal(kindWord("team"), "team");
	assert.equal(
		messages.t("ui.agents.config.about", {
			kind: kindWord("agent"),
			name: "aida",
		}),
		"About agent aida",
	);
});

for (const code of LOCALES) {
	test(`[${code}] the About line and summary suffix use the locale's own kind word`, () => {
		locale.setLocale(code);
		for (const kind of WIRE_WORDS) {
			const word = kindWord(kind);
			// A missing key degrades to the key id (never throws), so the key id
			// showing up is the failure this assertion names.
			assert.notEqual(
				word,
				`ui.agents.config.kind.${kind}`,
				`${code} has no ui.agents.config.kind.${kind}`,
			);
			const about = messages.t("ui.agents.config.about", {
				kind: word,
				name: "release-crew",
			});
			assert.ok(
				about.includes(word),
				`${code}: About line drops the kind word`,
			);
			assert.ok(
				about.includes("release-crew"),
				`${code}: About line drops the name`,
			);
			// `agent` is spelled the same in fr (glossary term), so only team is
			// the discriminating word there.
			if (!(code === "fr" && kind === "agent")) {
				assert.notEqual(
					word,
					kind,
					`${code}: kind.${kind} is still the English wire word`,
				);
			}
		}
		locale.setLocale("en");
	});
}

test("aboutLine passes the keyed kind word, never the raw wire kind", () => {
	const source = readFileSync(
		"src/renderer/src/features/agents/config-run/config-composer.tsx",
		"utf8",
	);
	const start = source.indexOf("function aboutLine(");
	assert.notEqual(start, -1, "aboutLine moved: re-point this guard");
	const body = source.slice(start, source.indexOf("\n}\n", start));
	assert.match(body, /kind:\s*kindWord\(about\)/);
	assert.doesNotMatch(body, /kind:\s*about\.kind/);
});
