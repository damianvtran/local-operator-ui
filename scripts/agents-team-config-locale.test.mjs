/**
 * The team pane's and the configuration composer's copy, read in a NON-English
 * locale, plus the one behaviour the translation could have broken.
 *
 *     node --test scripts/agents-team-config-locale.test.mjs
 *
 * WHY THIS SUITE EXISTS. Validation errors, the "New team" heading, the member
 * kind column, the picker's group headings, the run strip's headings, the
 * composer placeholder, the "Ask for a change" seed and PaneError's Retry
 * defaults were hardcoded English, so they stayed English in every locale.
 *
 * WHAT IS MEASURED.
 *  - SENTINELS, not shipped translations: a `fr` catalogue is registered over
 *    the real one with a marker per key, so an assertion proves the call site
 *    routes through the catalogue rather than pinning a translator's wording.
 *  - FILTERING SURVIVES TRANSLATION. Member pickers used to filter on
 *    `option.group === "Teams"`, the DISPLAY heading; under a translated heading
 *    that emptied every picker. `memberOptions` now filters on `kind`.
 *  - THE SEED ROUND-TRIPS. `typedTopic` must strip the seed in the locale it was
 *    written in, or a translated "You asked: …" would echo the seed back.
 *  - SERVER UPDATING WINS (UI #1952 R2-m1). `writeFailureSentence` is what the
 *    edit, install and create catch blocks call, each with its own fallback; a
 *    transport failure carrying main's `detail.updating` hint used to read as
 *    "the server did not answer" because the transport arm matched first.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const ROOT = process.cwd();
const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/agents",
});
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
for (const key of ["navigator", "HTMLElement", "Element", "Node"]) {
	if (!(key in globalThis))
		try {
			globalThis[key] = DOM.window[key];
		} catch {
			// jsdom accessors that refuse to be read out of scope.
		}
}
DOM.window.matchMedia = () => ({
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
});
globalThis.fetch = async () => ({
	ok: true,
	status: 200,
	json: async () => ({}),
});

const result = await build({
	stdin: {
		contents: [
			'export { memberOptions, managerOptions } from "../src/renderer/src/features/agents/components/team-detail";',
			'export { writeFailureSentence } from "../src/renderer/src/features/agents/components/agent-detail";',
			'export { PaneError } from "../src/renderer/src/features/agents/components/detail-parts";',
			'export { runTitle, configSeedPrompt } from "../src/renderer/src/features/agents/config-run/config-composer";',
			'export { typedTopic } from "../src/renderer/src/features/agents/config-run/use-config-run";',
			'export { DesktopControlError } from "../src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { DESKTOP_REFUSAL_CODE, DESKTOP_MACHINE_DETAIL } from "../src/shared/desktop-contract";',
			'export { createElement } from "react";',
			'export { renderToStaticMarkup } from "react-dom/server";',
			'export * as i18n from "../src/i18n";',
		].join("\n"),
		resolveDir: `${ROOT}/scripts`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
		"@assets": `${ROOT}/src/renderer/src/assets`,
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
	},
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
});
const bundlePath = new URL(
	`./_agents-team-config-locale-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, result.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const lib = await import(bundlePath.href);
const { i18n } = lib;

const FR = {
	"ui.agents.teams.group.agents": "FR Agents",
	"ui.agents.teams.group.teams": "FR Équipes",
	"ui.agents.config.title.working": "FR working",
	"ui.agents.config.title.stopping": "FR stopping",
	"ui.agents.config.title.finished": "FR finished",
	"ui.agents.config.title.finished_no_changes": "FR finished nothing",
	"ui.agents.config.title.stopped": "FR stopped",
	"ui.agents.config.title.stopped_error": "FR stopped error",
	"ui.agents.config.title.finished_error": "FR finished error",
	"ui.agents.config.state.did_not_finish": "FR did not finish",
	"ui.agents.config.seed_prompt":
		"FR Modifier {kind, select, agent {l’agent} team {l’équipe} skill {la compétence} other {la définition}} {name} : ",
	"ui.common.actions.retry": "FR Réessayer",
	"ui.agents.detail.read_state.retrying": "FR Nouvel essai…",
};

before(() => {
	i18n.registerCatalogue("fr", FR);
	i18n.setLocale("fr");
});
after(() => i18n.setLocale("en"));

const AGENTS = [
	{ name: "coder", description: "writes code" },
	{ name: "reviewer", description: "reads code" },
];
const TEAMS = [{ name: "shipping", description: "ships" }];

test("member pickers still filter by kind when the group headings are translated", () => {
	const all = lib.managerOptions(AGENTS, TEAMS);
	assert.deepEqual(
		all.map((option) => option.group),
		["FR Agents", "FR Agents", "FR Équipes"],
		"the headings are read from the catalogue",
	);
	assert.deepEqual(
		lib.memberOptions(AGENTS, TEAMS, "team").map((option) => option.id),
		["shipping"],
	);
	assert.deepEqual(
		lib.memberOptions(AGENTS, TEAMS, "agent").map((option) => option.id),
		["coder", "reviewer"],
	);
});

test("the run strip's headings follow the locale for every state", () => {
	const base = {
		step: undefined,
		results: [],
		turnFailed: false,
		canRetry: false,
	};
	const title = (over) => lib.runTitle({ ...base, ...over });
	assert.equal(title({ status: "running" }), "FR working");
	assert.equal(
		title({ status: "running", step: "Reading coder" }),
		"Reading coder",
	);
	assert.equal(title({ status: "stopping" }), "FR stopping");
	assert.equal(title({ status: "done", results: [{}] }), "FR finished");
	assert.equal(title({ status: "done" }), "FR finished nothing");
	assert.equal(title({ status: "stopped" }), "FR stopped");
	assert.equal(title({ status: "error", canRetry: true }), "FR stopped error");
	assert.equal(title({ status: "error" }), "FR finished error");
	assert.equal(
		title({ status: "error", turnFailed: true }),
		"FR did not finish",
	);
});

test("the Ask-for-a-change seed selects the kind and round-trips through typedTopic", () => {
	const team = { kind: "team", name: "shipping" };
	const seed = lib.configSeedPrompt(team);
	assert.equal(seed, "FR Modifier l’équipe shipping : ");
	assert.equal(
		lib.configSeedPrompt({ kind: "skill", name: "qa-notes" }),
		"FR Modifier la compétence qa-notes : ",
	);
	assert.equal(
		lib.typedTopic(`${seed}ajoute un relecteur`, team),
		"ajoute un relecteur",
	);
	assert.equal(
		lib.typedTopic(seed, team),
		seed.trim(),
		"a bare seed is kept whole",
	);
});

test("English seed is byte-identical to the old template", () => {
	i18n.setLocale("en");
	try {
		assert.equal(
			lib.configSeedPrompt({ kind: "agent", name: "coder" }),
			"Change the agent coder: ",
		);
	} finally {
		i18n.setLocale("fr");
	}
});

test("PaneError's default Retry labels come from the catalogue", () => {
	const html = (retrying) =>
		lib.renderToStaticMarkup(
			lib.createElement(lib.PaneError, {
				title: "t",
				what: "w",
				meaning: "m",
				onRetry: () => {},
				retrying,
			}),
		);
	assert.ok(html(false).includes("FR Réessayer"));
	assert.ok(html(true).includes("FR Nouvel essai…"));
});

test("a server-updating failure on the edit, install and create paths says updating", () => {
	const { DesktopControlError, DESKTOP_REFUSAL_CODE, DESKTOP_MACHINE_DETAIL } =
		lib;
	i18n.setLocale("en");
	try {
		const updating = i18n.t("ui.common.errors.desktop_refusal.server_updating");
		const fallbacks = {
			edit: i18n.t("ui.agents.detail.edit.error_generic"),
			install: i18n.t("ui.agents.detail.install.error_generic"),
			create: i18n.t("ui.agents.detail.create.error_generic"),
		};
		// A transport failure inside main's update window: the shape that used to
		// be swallowed by the transport arm.
		const hinted = new DesktopControlError(
			null,
			DESKTOP_MACHINE_DETAIL.transportFailed,
			undefined,
			DESKTOP_REFUSAL_CODE.transportFailed,
			undefined,
			{ updating: true },
		);
		const fenced = new DesktopControlError(
			503,
			"updating",
			undefined,
			DESKTOP_REFUSAL_CODE.serverUpdating,
		);
		const plain = new DesktopControlError(
			null,
			DESKTOP_MACHINE_DETAIL.transportFailed,
			undefined,
			DESKTOP_REFUSAL_CODE.transportFailed,
		);
		for (const [path, fallback] of Object.entries(fallbacks)) {
			assert.equal(lib.writeFailureSentence(hinted, fallback), updating, path);
			assert.equal(lib.writeFailureSentence(fenced, fallback), updating, path);
			// Control: without the hint the transport arm still owns the sentence.
			assert.equal(
				lib.writeFailureSentence(plain, fallback),
				i18n.t("ui.common.errors.desktop_transport_failed"),
				path,
			);
		}
	} finally {
		i18n.setLocale("fr");
	}
});
