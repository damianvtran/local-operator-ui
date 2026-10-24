import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * Live-locale regressions for the agents/hub extraction review.
 *
 * These are synthetic fixture messages, not French translations. The important
 * property is that a retained object is formatted again after setLocale("fr")
 * and returns to byte-identical English after setLocale("en"). Component source
 * bindings beside the behavioral checks prove that the memoized surfaces carry
 * the locale subscription needed to reach that formatter on a live switch.
 */
const bundle = await build({
	stdin: {
		contents: `
			export { createTourSteps } from "./src/renderer/src/features/onboarding/hooks/use-onboarding-tour";
			export { formatPublicationIssue, publicationIssues } from "./src/renderer/src/features/agents/utils/publication-validation";
			export { publicationTreatment } from "./src/renderer/src/features/agents/utils/publication-failure";
			export { diffCatalogue, formatRunChange, formatRunToolVerb, projectRunToolRow, snapshotCatalogue } from "./src/renderer/src/features/agents/config-run/summary";
			export { formatTeamDate } from "./src/renderer/src/features/agent-hub/components/org-team-summary";
			export { formatAgentDownloadCount } from "./src/renderer/src/features/agent-hub/components/agent-card";
			export { clearRegisteredCatalogues, registerCatalogue, setLocale, t } from "./src/i18n";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	loader: { ".css": "empty", ".png": "dataurl" },
	jsx: "automatic",
	define: { "import.meta.env": "__viteEnv" },
	banner: { js: "const __viteEnv = {};" },
	alias: {
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
});
const modulePath = new URL(
	`./_agents-i18n-locale-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(modulePath, bundle.outputFiles[0].text);
after(async () => {
	await unlink(modulePath).catch(() => {});
});
const lib = await import(modulePath.href);

const fixture = {};
for (const namespace of [
	"ui.onboarding.tour",
	"ui.agents.publication",
	"ui.agents.config",
	"ui.agents.team",
	"ui.agents.upload",
	"ui.hub.teams",
]) {
	const catalogue = JSON.parse(
		readFileSync(`src/i18n/catalogues/en/${namespace}.json`, "utf8"),
	);
	for (const [key, message] of Object.entries(catalogue)) {
		fixture[key] = `[fixture-fr] ${message}`;
	}
}
lib.clearRegisteredCatalogues();
lib.registerCatalogue("fr", fixture);
lib.setLocale("en");

after(() => {
	lib.clearRegisteredCatalogues();
	lib.setLocale("en");
});

function localeRoundTrip(render, expectedEnglish) {
	lib.setLocale("en");
	assert.equal(render(), expectedEnglish);
	lib.setLocale("fr");
	const french = render();
	assert.ok(
		french.includes("[fixture-fr]"),
		`the retained value did not repaint: ${french}`,
	);
	lib.setLocale("en");
	assert.equal(render(), expectedEnglish, "English must restore exactly");
}

const validDraft = {
	name: "reviewer",
	description: "Reviews code",
	instructions: "Review the diff",
	tools: ["read"],
};

test("tour steps are created at start and every Shepherd HTML body is clean across en-fr-en", () => {
	lib.setLocale("en");
	const english = lib.createTourSteps();
	assert.equal(english.length, 37);
	const source = readFileSync(
		"src/renderer/src/features/onboarding/hooks/use-onboarding-tour.ts",
		"utf8",
	);
	assert.ok(source.includes("const tourSteps = createTourSteps()"));
	const welcome = english.find((step) => step.id === "welcome");
	assert.equal(welcome.title, "Welcome to Local Operator");
	assert.ok(welcome.text.includes("Local Operator is an AI agents platform"));
	assert.ok(welcome.text.includes("<ul><li>Creating agents</li>"));

	lib.setLocale("fr");
	const french = lib.createTourSteps();
	assert.notEqual(french, english, "a start builds a fresh step array");
	assert.ok(
		french
			.find((step) => step.id === "welcome")
			.title.startsWith("[fixture-fr]"),
	);

	lib.setLocale("en");
	const restored = lib.createTourSteps();
	const visibleSteps = (steps) =>
		steps.map(({ id, title, text }) => ({ id, title, text }));
	assert.deepEqual(
		visibleSteps(restored),
		visibleSteps(english),
		"the original English tour restores",
	);
	for (const steps of [english, french, restored]) {
		for (const step of steps) {
			assert.equal(typeof step.text, "string", `${step.id} has HTML text`);
			assert.ok(
				!step.text.includes(">'<"),
				`${step.id} leaked an ICU quote boundary: ${step.text}`,
			);
			const document = new JSDOM(`<!doctype html><body>${step.text}</body>`)
				.window.document;
			assert.ok(!document.body.textContent.includes(">'<"));
		}
	}
	assert.ok(
		english.some((step) => step.text.includes("<ul><li>")),
		"the consolidated list is real markup, not visible tag text",
	);
});

test("publication issues retain rule IDs and numeric limits, then translate at display", () => {
	const issue = lib.publicationIssues({ ...validDraft, name: "-reviewer" })[0];
	assert.deepEqual(issue, {
		field: "name",
		rule: { id: "name_edge_punctuation" },
	});
	assert.equal("message" in issue, false);
	localeRoundTrip(
		() => lib.formatPublicationIssue(issue),
		'Name must not begin or end with "-" or ".".',
	);
	const tooLong = lib.publicationIssues({
		...validDraft,
		description: "x".repeat(2001),
	})[0];
	assert.deepEqual(tooLong.rule, { id: "max_characters", max: 2000 });
	localeRoundTrip(
		() => lib.formatPublicationIssue(tooLong),
		"Description must be at most 2000 characters.",
	);

	const source = readFileSync(
		"src/renderer/src/features/agents/components/upload-agent-dialog.tsx",
		"utf8",
	);
	assert.ok(source.includes("formatPublicationIssue(issue)"));
	assert.ok(source.includes("const reservedMessage = reserved"));
	assert.ok(!source.includes("list.unshift("));
	const reserved = { code: "name_reserved_builtin", message: "" };
	localeRoundTrip(
		() =>
			lib.publicationTreatment(reserved, {
				name: "Reviewer",
				hubAgentId: null,
			}).body,
		'"Reviewer" is the name of a built-in agent. Built-in names cannot be published to the hub.',
	);
});

test("public and organization pull treatments repaint and their memos subscribe to locale", () => {
	for (const path of [
		"src/renderer/src/features/agent-hub/components/public-teams-library.tsx",
		"src/renderer/src/features/agent-hub/components/org-teams-list.tsx",
	]) {
		const source = readFileSync(path, "utf8");
		assert.ok(source.includes("useI18nLocale()"), path);
		assert.ok(
			source.includes("const pullTreatment = isPublicationError(pull.error)"),
			path,
		);
		assert.ok(!source.includes("const pullTreatment = useMemo"), path);
		const error = {
			code: "team_plan_required",
			message: "backend English must not be translated by the client",
			details: { org_name: path.includes("public-") ? null : "Northwind" },
		};
		const context = {
			name: "Release crew",
			hubAgentId: null,
			surface: "pull",
		};
		localeRoundTrip(
			() => lib.publicationTreatment(error, context).body,
			"Reading an organization's teams is part of the Team plan. Ask an owner of the organization to activate it in the Radient console, then pull again.",
		);
	}
});

test("config activity and retained results stay language-neutral across en-fr-en", () => {
	const activity = lib.projectRunToolRow({
		toolName: "agent",
		args: { op: "create", name: "reviewer" },
		phase: "done",
		ts: 1,
	}).verb;
	assert.deepEqual(activity, {
		operation: "create",
		kind: "agent",
		name: "reviewer",
	});
	localeRoundTrip(
		() => lib.formatRunToolVerb(activity),
		"Creating agent reviewer",
	);

	const row = {
		name: "reviewer",
		kind: "role",
		source: "custom",
		agent_id: null,
		description: "Reads code",
		tools: null,
		effort: null,
		delegate: false,
	};
	const before = lib.snapshotCatalogue([row], []);
	const after = lib.snapshotCatalogue(
		[{ ...row, description: "Reads code and reports" }],
		[],
	);
	const result = lib.diffCatalogue(before, after, [
		{ kind: "agent", name: "reviewer" },
	])[0];
	assert.deepEqual(result.changes[0], {
		field: "description",
		before: "Reads code",
		after: "Reads code and reports",
	});
	assert.equal("label" in result.changes[0], false);
	localeRoundTrip(
		() =>
			lib.formatRunChange(
				result.changes[0].field,
				result.changes[0].before,
				result.changes[0].after,
			),
		"description changed",
	);
	const hook = readFileSync(
		"src/renderer/src/features/agents/config-run/use-config-run.ts",
		"utf8",
	);
	assert.ok(hook.includes("useI18nLocale()"));
});

test("team dates and card counts use the active formatter and restore English", () => {
	const date = new Date("2026-10-02T09:00:00.000Z");
	lib.setLocale("en");
	const englishDate = lib.formatTeamDate(date);
	lib.setLocale("fr");
	const frenchDate = lib.formatTeamDate(date);
	assert.notEqual(frenchDate, englishDate);
	lib.setLocale("en");
	assert.equal(lib.formatTeamDate(date), englishDate);

	lib.setLocale("en");
	const englishCount = lib.formatAgentDownloadCount(12345);
	assert.equal(englishCount, "12,345");
	lib.setLocale("fr");
	const frenchCount = lib.formatAgentDownloadCount(12345);
	assert.notEqual(frenchCount, englishCount);
	lib.setLocale("en");
	assert.equal(lib.formatAgentDownloadCount(12345), englishCount);
});

test("formerly split labels are complete ICU phrases across en-fr-en", () => {
	const cases = [
		[
			() => lib.t("ui.agents.upload.agent_label", { name: "Coder" }),
			"Agent: Coder",
		],
		[
			() => lib.t("ui.hub.teams.published_by", { author: "Ana" }),
			"Published by Ana",
		],
		[
			() => lib.t("ui.agents.config.you_asked", { topic: "Ship it" }),
			"You asked: Ship it",
		],
		[
			() =>
				lib.t("ui.hub.teams.member_with_kind", {
					name: "coder",
					kind: "agent",
				}),
			"coder (agent)",
		],
		[
			() => lib.t("ui.agents.team.member_count_with_team", { count: 2 }),
			"2 members · Includes a team",
		],
		[
			() => lib.t("ui.agents.team.not_found_prefix", { role: "reviewer" }),
			"Not found: reviewer",
		],
		[
			() =>
				lib.t("ui.agents.config.result_created", {
					name: "Coder",
					kind: "agent",
				}),
			"Created Coder (agent)",
		],
	];
	for (const [render, english] of cases) localeRoundTrip(render, english);
});
