/**
 * The shipped agent's description is CATALOGUE COPY; the operator's is USER DATA.
 *
 *     node --test scripts/agents-seed-description-locale.test.mjs
 *
 * WHY THIS SUITE EXISTS. The Agents roster and the detail pane printed the
 * backend's `description` field verbatim, so a French page carried twelve English
 * sentences ("Explores a codebase and produces a design…") while the coverage
 * checker reported the screen complete - the string never was a UI key. The fix
 * routes the twelve shipped sentences through `ui.agents.descriptions.*`
 * (`features/agents/utils/agent-description.ts`).
 *
 * THE LOAD-BEARING CONSTRAINT IS THE OTHER DIRECTION, and it is what most of this
 * file measures: the SAME field carries what the operator wrote - an uploaded
 * agent's description, or an installed agent's description after an edit - and
 * that text must render exactly as written. A rule that localized the field
 * because the row "looks like a shipped agent" would rewrite user data, so every
 * refusal case below is asserted in a non-English locale: the raw sentence is the
 * expected output there too.
 *
 * HOW "LOCALIZED" IS PROVED WITHOUT SHIPPING A TRANSLATION. These keys have no
 * French values yet (this is the keying half; the translator pass follows), so the
 * test registers a MARKER through the served-catalogue seam
 * (`registerCatalogue`) and asserts the row prints the marker. That proves the
 * call site reads the catalogue rather than the field, which is the property under
 * test - it deliberately does NOT assert French copy nobody wrote.
 *
 * WHAT IT DOES NOT PROVE: pixels. The frames are on the PR; the repaint on a live
 * language switch is `useI18nLocale()` in `agents-page.tsx` and
 * `agent-detail.tsx`, and both call `agentDescriptionText()` at render time.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * as copy from "./src/renderer/src/features/agents/utils/agent-description";',
			'export * as locale from "./src/i18n/locale";',
			'export { registerCatalogue, clearRegisteredCatalogues, t } from "./src/i18n/messages";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});

const bundlePath = new URL(
	`./_agents-seed-description-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const lib = await import(bundlePath.href);
await unlink(bundlePath).catch(() => {});

/**
 * The twelve shipped sentences, AS THE CORE'S SEED MANIFEST STATES THEM
 * (`local_operator/agent_seeds/manifest.json`). Pinned here so the catalogue is
 * checked against the sentence the backend actually serves: a key typed with a
 * drifted sentence fails below, and a seed whose copy changes in the core shows up
 * as a deliberate diff to this fixture rather than as a silent English leak.
 */
const SHIPPED = {
	aida: "Your chief of staff: orchestrates agents and teams on your behalf, keeps an eye on everything in flight, and reports back.",
	architect:
		"Explores a codebase and produces a design or technical proposal with trade-offs; may draft documents but never modifies existing source.",
	coder:
		"Implements one bounded slice of work end to end with the full toolset, then reports what changed and how it was verified.",
	"copy-reviewer":
		"Review of written copy before it ships: user-visible product copy and prose for a general reader, on comprehension, tone, claim support and AI-isms; reports C-prefixed findings.",
	designer:
		"Design and UX review of a user-visible change, judged from rendered frames rather than source; reports D-prefixed findings.",
	librarian:
		"The Library's organizing agent: names, describes and tags the assets the operator keeps, learns their vocabulary, and keeps the global catalog usable.",
	manager:
		"Coordinates delegated work and reports honest status: what is done, what is in flight, what is blocked and on whom.",
	"qa-tester":
		"Independent execution proof for a change: preflights the rig, exercises real paths and negative cases, and reports a scoped QA matrix without editing the repository.",
	reviewer:
		"Independent code review of a diff, MR, or PR: finds defects, classifies them by severity, and never edits the code it reviews.",
	scout:
		"Read-only research: investigates a question across the workspace and on the web, and reports findings with evidence. Changes nothing.",
	"tui-designer":
		"Designing and reviewing terminal interfaces: keyboard-first flows, density in small fixed viewports, colour and unicode fallbacks, measured geometry; reports T-prefixed findings.",
	"ux-reviewer":
		"Walks a change's real flow end to end: discoverability, feedback, error recovery, keyboard paths and copy; reports U-prefixed findings.",
};

/** The other locales fall back to English until the translator pass lands. */
const MARKER = "MARQUEUR-DE-CATALOGUE";

/** A raw key on screen is the failure mode every assertion here excludes. */
const RAW_KEY = /ui\.agents\.descriptions/;

/** A row as the roster builds it: the wire's three fields, nothing derived. */
const row = (name, source, description) => ({ name, source, description });

/** The detail pane and the roster read the same field; one helper serves both. */
const text = (profile) => lib.copy.agentDescriptionText(profile);

test("each shipped seed maps to a key that carries its own sentence", () => {
	lib.locale.setLocale("en");
	const { SEED_DESCRIPTION_KEYS } = lib.copy;
	assert.equal(
		Object.keys(SEED_DESCRIPTION_KEYS).length,
		Object.keys(SHIPPED).length,
		"one key per shipped seed",
	);
	for (const [name, sentence] of Object.entries(SHIPPED)) {
		const key = SEED_DESCRIPTION_KEYS[name];
		assert.ok(key, `${name}: the seed has a key`);
		assert.equal(
			lib.t(key),
			sentence,
			`${name}: the catalogue entry is the sentence the seed manifest serves`,
		);
		assert.equal(
			lib.copy.seedDescriptionKey(row(name, "builtin", sentence)),
			key,
			`${name}: the built-in row reads its key`,
		);
		assert.equal(
			text(row(name, "builtin", sentence)),
			sentence,
			`${name}: English renders the same sentence, through the catalogue`,
		);
	}
});

test("with a translation present, the shipped row prints the catalogue", () => {
	const sentence = SHIPPED.reviewer;
	lib.locale.setLocale("fr");
	lib.registerCatalogue("fr", {
		"ui.agents.descriptions.reviewer": MARKER,
	});
	assert.equal(
		text(row("reviewer", "builtin", sentence)),
		MARKER,
		"builtin: the roster prints the catalogue, not the field",
	);
	assert.equal(
		text(row("reviewer", "installed", sentence)),
		MARKER,
		"installed from the seed, untouched: still shipped copy",
	);
	lib.clearRegisteredCatalogues();
	lib.locale.setLocale("en");
});

test("a user-uploaded agent renders its own description verbatim", () => {
	const uploaded = "Plans my data migrations and nothing else.";
	for (const tag of ["en", "fr", "ur"]) {
		lib.locale.setLocale(tag);
		const profile = row("my-architect", "custom", uploaded);
		assert.equal(
			lib.copy.seedDescriptionKey(profile),
			null,
			`${tag}: a custom row is never keyed`,
		);
		assert.equal(
			text(profile),
			uploaded,
			`${tag}: user text is not translated`,
		);
	}
	lib.locale.setLocale("en");
});

test("an uploaded agent that repeats a seed sentence is still user data", () => {
	const sentence = SHIPPED.reviewer;
	lib.locale.setLocale("fr");
	lib.registerCatalogue("fr", {
		"ui.agents.descriptions.reviewer": MARKER,
	});
	assert.equal(
		text(row("reviewer", "custom", sentence)),
		sentence,
		"custom source outranks a byte-identical description: verbatim, never the marker",
	);
	lib.clearRegisteredCatalogues();
	lib.locale.setLocale("en");
});

test("an edited installed seed renders the operator's edit, not the shipped sentence", () => {
	const edited = `${SHIPPED.reviewer} Our own reviewer also checks migrations.`;
	lib.locale.setLocale("fr");
	lib.registerCatalogue("fr", {
		"ui.agents.descriptions.reviewer": MARKER,
	});
	const profile = row("reviewer", "installed", edited);
	assert.equal(
		lib.copy.seedDescriptionKey(profile),
		null,
		"an edit drops the key",
	);
	assert.equal(text(profile), edited, "the edit is shown as written");
	assert.notEqual(text(profile), MARKER, "never the catalogue's sentence");
	lib.clearRegisteredCatalogues();
	lib.locale.setLocale("en");
});

test("a renamed seed copy falls back to raw text", () => {
	/* Renaming an installed row also invalidates the backend's `seed:*` tag,
	 * which validates the marker against the row's own name - so the rename is
	 * exactly the point where the row stops being the shipped identity. */
	const profile = row("team-reviewer", "installed", SHIPPED.reviewer);
	assert.equal(
		lib.copy.seedDescriptionKey(profile),
		null,
		"no key for a rename",
	);
	assert.equal(
		text(profile),
		SHIPPED.reviewer,
		"the untouched sentence renders as-is",
	);
});

test("a locale without the translation falls back to English, never to the key", () => {
	lib.locale.setLocale("ur");
	const rendered = text(row("manager", "builtin", SHIPPED.manager));
	assert.equal(rendered, SHIPPED.manager, "English fallback, per-key");
	assert.doesNotMatch(rendered, RAW_KEY, "never a raw key");
	lib.locale.setLocale("en");
});
