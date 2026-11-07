import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * TWO ENGLISH SOURCES THE CATALOGUE GUARD COULD NOT SEE, AND THE RULE BOTH FIXES SHARE.
 *
 * The 0-missing coverage gate counts KEYS. A sentence that never became a key is
 * not "missing" by its account, so both defects below shipped English in every
 * locale while the gate stayed green:
 *
 *  - C1: the secret-closure notice was a module-level `const` rendered as
 *    `{SECRET_CLOSURE_NOTICE}`, so `fr` drew the English sentence above the
 *    paused composer;
 *  - C4: `ARGUMENT_SOURCE_LABEL` was a module-level record of English words read
 *    straight into the slash popup's heading.
 *
 * A key table must hold KEYS and `t()` must resolve at CALL time, so a locale
 * switch redraws the copy. A table holding translated sentences would look green
 * in `en` and go stale the moment the reader switched language - which is why
 * every cycle here runs en -> fixture -> en and fails on either end.
 *
 * The English below is a frozen copy of what the code held before the move: this
 * is a KEYING change, not a copy change, and a translator's input has to be the
 * sentence and the words the product already showed.
 */

const ROOT = process.cwd();

const SECRET_NOTICE_KEY = "ui.chat.composer.secret_closure_notice";
const SECRET_NOTICE_EN =
	"Answer the secret request in the asks panel — this box is paused until it is answered, and your draft is kept.";

/** Every slash-argument source the popup can head, with its shipped English. */
const SLASH_SOURCE_EN = {
	model: "Models",
	effort: "Effort",
	approvals: "Approvals",
	team: "Teams",
	agent: "Agents",
	providers: "Providers",
	"provider-accounts": "Accounts",
	mcp: "Servers",
	theme: "Themes",
	"title-refresh": "Options",
	"session-tags": "Tags",
};

/** A fixture locale is the only way to see a stale module-level read. */
const FIXTURE_LOCALE = "xx-composer-fixture";

/** A message id is the only shape the table may hold (see the RFC's key grammar). */
const MESSAGE_KEY_RE = /^ui(?:\.[a-z0-9_]+)+$/;

const bundle = await build({
	stdin: {
		contents: `
			export { t, registerCatalogue, setLocale } from "@shared/i18n";
			export { ARGUMENT_SOURCE_LABEL } from "@features/chat/components/slash-argument-rows";
			export { phaseLabel } from "@features/chat/components/slash-contract";
		`,
		resolveDir: ROOT,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
assert.ok(bundle.outputFiles[0], "the composer copy bundle did not compile");
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const catalogue = (name) =>
	JSON.parse(readFileSync(join(ROOT, "src/i18n/catalogues/en", name), "utf8"));

const source = (path) => readFileSync(join(ROOT, path), "utf8");

test("the secret-closure notice is a keyed sentence resolved where it renders", () => {
	const file = source(
		"src/renderer/src/shared/components/composer/message-input.tsx",
	);
	assert.ok(
		!file.includes(SECRET_NOTICE_EN),
		"the notice sentence must live in the catalogue, not in the module",
	);
	assert.ok(
		file.includes(`t("${SECRET_NOTICE_KEY}")`),
		"the notice must be resolved by t() at the render site, so a locale switch redraws it",
	);
	assert.equal(
		catalogue("ui.chat.composer.json")[SECRET_NOTICE_KEY],
		SECRET_NOTICE_EN,
		"the catalogue must carry the exact sentence the product used to render",
	);
});

test("the notice follows the locale at call time and retains nothing between switches", () => {
	mod.setLocale("en");
	assert.equal(mod.t(SECRET_NOTICE_KEY), SECRET_NOTICE_EN);
	mod.registerCatalogue(FIXTURE_LOCALE, {
		[SECRET_NOTICE_KEY]: "fixture secret closure notice",
	});
	mod.setLocale(FIXTURE_LOCALE);
	assert.equal(mod.t(SECRET_NOTICE_KEY), "fixture secret closure notice");
	mod.setLocale("en");
	assert.equal(
		mod.t(SECRET_NOTICE_KEY),
		SECRET_NOTICE_EN,
		"switching back must not retain the fixture's copy",
	);
});

test("the slash-argument heading table holds message keys, not sentences", () => {
	const table = mod.ARGUMENT_SOURCE_LABEL;
	assert.deepEqual(
		Object.keys(table).sort(),
		Object.keys(SLASH_SOURCE_EN).sort(),
		"the table is exhaustive over the argument sources the popup can head",
	);
	const pickers = catalogue("ui.chat.pickers.json");
	for (const [source_, english] of Object.entries(SLASH_SOURCE_EN)) {
		const value = table[source_];
		assert.match(
			value,
			MESSAGE_KEY_RE,
			`${source_} must hold a message key, so one table serves every locale`,
		);
		assert.equal(
			pickers[value],
			english,
			`${value} must carry the exact heading the popup showed for ${source_}`,
		);
	}
});

test("the slash popup heading follows the locale at call time", () => {
	const fixture = Object.fromEntries(
		Object.keys(SLASH_SOURCE_EN).map((source_) => [
			mod.ARGUMENT_SOURCE_LABEL[source_],
			`fixture ${source_} heading`,
		]),
	);
	mod.setLocale("en");
	assert.equal(mod.phaseLabel("argument", "model"), "Models");
	mod.registerCatalogue(FIXTURE_LOCALE, fixture);
	mod.setLocale(FIXTURE_LOCALE);
	assert.equal(mod.phaseLabel("argument", "model"), "fixture model heading");
	// `/mcp`'s heading is per-SLOT: the verb slot says Commands, the server slot
	// says the source's own word (round 1, D6/U7) - so the fixture is read there.
	assert.equal(
		mod.phaseLabel("argument", "mcp", "login "),
		"fixture mcp heading",
	);
	mod.setLocale("en");
	assert.equal(
		mod.phaseLabel("argument", "model"),
		"Models",
		"switching back must not retain the fixture's heading",
	);
	// The two headings that are already keyed keep working beside the table:
	// a `/mcp`'s verb slot is a command list, not the server list.
	assert.equal(
		mod.phaseLabel("argument", "mcp", "list"),
		mod.t("ui.chat.pickers.commands.title"),
	);
});
