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
 * THE SECOND FAMILY IS THE ONE ROUND 1 MISSED (R1-1). The registry keeps ONE
 * description field per profile, and install writes the seed's ROUTING text
 * (`when_to_use`) into it, because that is what `search` embeds: every shipped
 * seed carries one, so an INSTALLED seed serves the routing sentence and only an
 * uninstalled one serves the blurb. The first version of this suite asserted the
 * installed shape as `row(name, "installed", SHIPPED[name])` - a wire shape the
 * backend never produces - so it was green while every installed seed rendered
 * English. The installed cases below now use the routing prose, which is what the
 * backend sends, and `ui.agents.routing.*` is the second key family.
 *
 * THE LOAD-BEARING CONSTRAINT IS THE OTHER DIRECTION, and it is what most of this
 * file measures: the SAME field carries what the operator wrote - an uploaded
 * agent's description, or an installed agent's description after an edit - and
 * that text must render exactly as written. A rule that localized the field
 * because the row "looks like a shipped agent" would rewrite user data, so every
 * refusal case below is asserted in a non-English locale: the raw sentence is the
 * expected output there too.
 *
 * HOW LOOKUP IS PROVED WITHOUT DEPENDING ON A MISSING LOCALE. The English
 * sentences are keyed; the translated values now ship in
 * `catalogues/<locale>/` for all seven locales, so no shipped locale can stand
 * in for "not translated yet". The test therefore registers a MARKER through
 * the served-catalogue seam (`registerCatalogue`) and asserts the row prints the
 * marker: that proves the call site reads the catalogue rather than the field,
 * which is the property under test. The per-key fallback case constructs its
 * missing entry the same way, on a tag this client ships no catalogue for.
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

/**
 * The same twelve seeds' `when_to_use` prose, verbatim from the same manifest.
 *
 * This is the field the CORE writes into a profile's description when a seed is
 * installed (`description = seed.when_to_use or seed.description`, so the
 * routing text is what an installed row serves), which is why these twelve are
 * keyed too: without them an installed seed - the shape the app actually shows
 * most of the time - could never match and stayed English.
 */
const SHIPPED_ROUTING = {
	aida: "Handing a request to a team or specialist, starting parallel work across agents, or asking for a status roll-up of everything in flight.",
	architect:
		"Deciding HOW to build something before writing it: comparing approaches or architectures, weighing trade-offs, planning a refactor, or writing an RFC or design document.",
	coder:
		"Writing or changing code: implementing a ticket, building a feature, fixing a bug, adding a function — an independent, well-specified slice that can proceed without further decisions.",
	"copy-reviewer":
		"Reviewing written copy before it ships: user-visible product copy (UI strings, emails, notifications, help/docs), and prose content for a general reader (blog essays, LinkedIn and X posts). Reader experience, comprehension, tone, plain language, claim support, and stripping AI-isms. Use on user-visible text, never on engineering prose or code comments.",
	designer:
		"Checking how something LOOKS to the user: reviewing a screen or terminal UI, whether a layout, spacing, colour or copy reads well, making an interface nicer — a design/UX round on a user-visible change.",
	librarian:
		"Organizing the Library — naming and tagging saved assets, finding what needs attention, or asking what the Library holds.",
	manager:
		"Coordinating and tracking multi-part work across several agents or repositories, chasing what is blocked, or producing a status roll-up or progress report.",
	"qa-tester":
		"Independently testing whether a pull request, patch or feature actually works end to end; reproducing a bug, validating side effects, or checking remediation regressions.",
	reviewer:
		"Reviewing a pull request, merge request, diff, commit range or patch for defects and bugs; auditing or critiquing code someone else (or another agent) wrote.",
	scout:
		"Answering a question about how something works, locating code, finding where a function or class is defined, tracing a flow, understanding existing behaviour, researching a library or an API on the web, or gathering evidence — read-only, nothing is modified.",
	"tui-designer":
		"Designing or reviewing terminal user interfaces: keyboard-first flows, layout and information density in small/fixed terminals, colour and unicode compatibility, progressive disclosure, and the UX of installers, daemons, and status dashboards for a CLI client.",
	"ux-reviewer":
		"Reviewing the user EXPERIENCE of a change — interaction flow, keyboard/input handling, discoverability, feedback and error messaging, copy tone, and whether a task can actually be completed smoothly — as distinct from a visual/design review of how it looks.",
};

/**
 * Two sentinels, one per key family. A single marker cannot tell WHICH family a
 * row resolved through, and "resolved to some key" is exactly the weaker claim
 * that let R1-1 through.
 */
const MARKER = "MARQUEUR-DE-CATALOGUE";
const ROUTING_MARKER = "MARQUEUR-DE-ROUTAGE";

/** A raw key on screen is the failure mode every assertion here excludes. */
const RAW_KEY = /ui\.agents\.(descriptions|routing)/;

/** A row as the roster builds it: the wire's three fields, nothing derived. */
const row = (name, source, description) => ({ name, source, description });

/** The detail pane and the roster read the same field; one helper serves both. */
const text = (profile) => lib.copy.agentDescriptionText(profile);

test("each shipped seed has a key for both of its texts, and each carries its own sentence", () => {
	lib.locale.setLocale("en");
	const { SEED_DESCRIPTION_KEYS, SEED_ROUTING_KEYS } = lib.copy;
	assert.equal(
		Object.keys(SEED_DESCRIPTION_KEYS).length,
		Object.keys(SHIPPED).length,
		"one description key per shipped seed",
	);
	assert.equal(
		Object.keys(SEED_ROUTING_KEYS).length,
		Object.keys(SHIPPED_ROUTING).length,
		"one routing key per shipped seed",
	);
	assert.deepEqual(
		Object.keys(SEED_ROUTING_KEYS).sort(),
		Object.keys(SEED_DESCRIPTION_KEYS).sort(),
		"the two families name the same twelve seeds",
	);
	for (const [name, sentence] of Object.entries(SHIPPED)) {
		const descriptionKey = SEED_DESCRIPTION_KEYS[name];
		const routingKey = SEED_ROUTING_KEYS[name];
		assert.ok(descriptionKey, `${name}: the seed has a description key`);
		assert.ok(routingKey, `${name}: the seed has a routing key`);
		assert.equal(
			lib.t(descriptionKey),
			sentence,
			`${name}: the description entry is the sentence the seed manifest serves`,
		);
		assert.equal(
			lib.t(routingKey),
			SHIPPED_ROUTING[name],
			`${name}: the routing entry is the when_to_use text the manifest carries`,
		);
		assert.equal(
			lib.copy.seedTextKey(row(name, "builtin", sentence)),
			descriptionKey,
			`${name}: the uninstalled row reads its description key`,
		);
		assert.equal(
			text(row(name, "builtin", sentence)),
			sentence,
			`${name}: English renders the same sentence, through the catalogue`,
		);
	}
});

/**
 * THE SHAPE R1-1 LEFT UNTESTED, asserted as the backend produces it.
 *
 * `install` writes `description = seed.when_to_use or seed.description`
 * (`local_operator/agent_profiles.py`, the `_fields` comment beside the write),
 * so this is what a profile row carries for a seed the operator installed and did
 * not edit. The first version of this file asserted `("installed", <description>)`
 * instead - a row no code path creates - and stayed green while every installed
 * card rendered English.
 */
test("every installed seed resolves through its routing text", () => {
	lib.locale.setLocale("en");
	for (const [name, routing] of Object.entries(SHIPPED_ROUTING)) {
		assert.equal(
			lib.copy.seedTextKey(row(name, "installed", routing)),
			lib.copy.SEED_ROUTING_KEYS[name],
			`${name}: the installed row reads its routing key`,
		);
		assert.equal(
			text(row(name, "installed", routing)),
			routing,
			`${name}: English renders the routing sentence through the catalogue`,
		);
	}
});

test("with a translation present, each shape prints its own family's catalogue", () => {
	lib.locale.setLocale("fr");
	lib.registerCatalogue("fr", {
		"ui.agents.descriptions.reviewer": MARKER,
		"ui.agents.routing.reviewer": ROUTING_MARKER,
	});
	assert.equal(
		text(row("reviewer", "builtin", SHIPPED.reviewer)),
		MARKER,
		"uninstalled: the roster prints the description catalogue, not the field",
	);
	assert.equal(
		text(row("reviewer", "installed", SHIPPED_ROUTING.reviewer)),
		ROUTING_MARKER,
		"installed from the seed, untouched: the routing sentence is shipped copy too",
	);
	lib.clearRegisteredCatalogues();
	lib.locale.setLocale("en");
});

test("only whitespace is forgiven when matching a shipped sentence", () => {
	/* The prose is authored in YAML frontmatter and arrives through a seed
	 * projection, so a folded line is transport, not a new sentence. BOTH families
	 * go through the same normalisation, so both are exercised. */
	const folded = (s) => `  ${s.replace(/ /g, "\n\t")}  `;
	lib.locale.setLocale("en");
	assert.equal(
		lib.copy.seedTextKey(row("reviewer", "builtin", folded(SHIPPED.reviewer))),
		lib.copy.SEED_DESCRIPTION_KEYS.reviewer,
		"description family: folded whitespace still matches",
	);
	assert.equal(
		lib.copy.seedTextKey(
			row("reviewer", "installed", folded(SHIPPED_ROUTING.reviewer)),
		),
		lib.copy.SEED_ROUTING_KEYS.reviewer,
		"routing family: folded whitespace still matches",
	);
	assert.equal(
		lib.copy.seedTextKey(
			row("reviewer", "installed", `${SHIPPED_ROUTING.reviewer} Ours too.`),
		),
		null,
		"a reworded sentence still does not match",
	);
});

test("a row with no description resolves to no key", () => {
	/* A bare `===` would compare `undefined` equal to a catalogue entry that does
	 * not exist (round 1, N1); the module's `typeof` guard is what keeps this null. */
	for (const absent of [undefined, null]) {
		assert.equal(
			lib.copy.seedTextKey({
				name: "reviewer",
				source: "installed",
				description: absent,
			}),
			null,
			`${String(absent)}: no text, no key`,
		);
	}
});

test("a user-uploaded agent renders its own description verbatim", () => {
	const uploaded = "Plans my data migrations and nothing else.";
	for (const tag of ["en", "fr", "ur"]) {
		lib.locale.setLocale(tag);
		const profile = row("my-architect", "custom", uploaded);
		assert.equal(
			lib.copy.seedTextKey(profile),
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
	/* BOTH families, because the second one is the newer way to be caught by this
	 * rule: an operator who uploads an agent of their own, names it after a seed and
	 * pastes either shipped text word for word is still showing their own text. The
	 * name-based refusal alone would translate it; `source === "custom"` is what
	 * stops that, which is why it is checked before any comparison. */
	lib.locale.setLocale("fr");
	lib.registerCatalogue("fr", {
		"ui.agents.descriptions.reviewer": MARKER,
		"ui.agents.routing.reviewer": ROUTING_MARKER,
	});
	for (const sentence of [SHIPPED.reviewer, SHIPPED_ROUTING.reviewer]) {
		assert.equal(
			text(row("reviewer", "custom", sentence)),
			sentence,
			"custom source outranks byte-identical shipped text: verbatim, never a marker",
		);
		assert.equal(
			lib.copy.seedTextKey(row("reviewer", "custom", sentence)),
			null,
			"no key either way for a custom row",
		);
	}
	lib.clearRegisteredCatalogues();
	lib.locale.setLocale("en");
});

test("an edited installed seed renders the operator's edit, not the shipped sentence", () => {
	const edited = `${SHIPPED_ROUTING.reviewer} Ours also checks migrations.`;
	lib.locale.setLocale("fr");
	lib.registerCatalogue("fr", {
		"ui.agents.routing.reviewer": ROUTING_MARKER,
	});
	const profile = row("reviewer", "installed", edited);
	assert.equal(lib.copy.seedTextKey(profile), null, "an edit drops the key");
	assert.equal(text(profile), edited, "the edit is shown as written");
	assert.notEqual(
		text(profile),
		ROUTING_MARKER,
		"never the catalogue's routing sentence",
	);
	lib.clearRegisteredCatalogues();
	lib.locale.setLocale("en");
});

test("a renamed seed copy falls back to raw text", () => {
	/* Renaming an installed row also invalidates the backend's `seed:*` tag,
	 * which validates the marker against the row's own name - so the rename is
	 * exactly the point where the row stops being the shipped identity. */
	const profile = row("team-reviewer", "installed", SHIPPED_ROUTING.reviewer);
	assert.equal(lib.copy.seedTextKey(profile), null, "no key for a rename");
	assert.equal(
		text(profile),
		SHIPPED_ROUTING.reviewer,
		"the untouched sentence renders as-is",
	);
});

test("a key the active locale does not carry falls back to English, never to the key", () => {
	/* The translator pass landed for every shipped locale, so the "missing entry"
	 * state cannot be observed through a shipped locale any more: it is built here
	 * through the served-catalogue seam instead. `de` names no catalogue of its
	 * own, so the one sentence registered for it answers while every other key
	 * still has to come from the English source - per key, never as a raw key. */
	lib.registerCatalogue("de", {
		"ui.agents.descriptions.reviewer": MARKER,
	});
	lib.locale.setLocale("de");
	assert.equal(
		text(row("reviewer", "builtin", SHIPPED.reviewer)),
		MARKER,
		"a key the served catalogue carries answers from it",
	);
	const rendered = text(row("manager", "builtin", SHIPPED.manager));
	assert.equal(rendered, SHIPPED.manager, "English fallback, per-key");
	assert.doesNotMatch(rendered, RAW_KEY, "never a raw key");
	lib.clearRegisteredCatalogues();
	lib.locale.setLocale("en");
});
