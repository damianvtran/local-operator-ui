/**
 * The onboarding catalogue's committed contract, stated INDEPENDENTLY (review
 * R1-1). WHAT THIS FILE IS FOR: the extraction's own suites must not derive
 * their expected keys or expected sentences from the implementation's exports -
 * a wrong-key constant or a reworded catalogue value moves the implementation
 * and the oracle together, and the mutant passes (R1-1 proved three such
 * mutants pass the pre-existing suites). So every expected VALUE here is a
 * literal copy of the committed English, and every WIRING expectation is the
 * exact source substring a component must carry, per key. If the catalogue,
 * a wiring site or a param object drifts, this file fails and names the key.
 *
 * WHAT IT CANNOT PROVE: rendered layout or interaction - that is the render
 * suites' and QA's; and it pins the ENGLISH catalogue only.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CATALOGUE = "src/i18n/catalogues/en/ui.onboarding.json";
const BASE = "src/renderer/src/features/onboarding/components/";

/** key -> [committed English (byte-exact), wiring file, required source substring]. */
const CONTRACT = [
	[
		"ui.onboarding.connect.intro",
		"Local Operator needs an AI account to work. Radient is the easiest: one browser sign-in and nothing to paste. Already pay for ChatGPT or Claude? Sign in with that instead. Anything else is under More providers.",
		"steps/connect-provider-step.tsx",
		't("ui.onboarding.connect.intro")',
	],
	[
		"ui.onboarding.default_model.block.loading_models",
		"Loading the model list…",
		"steps/default-model-plan.ts",
		'"ui.onboarding.default_model.block.loading_models" as const',
	],
	[
		"ui.onboarding.default_model.block.pick_a_model",
		"Pick a model to continue.",
		"steps/default-model-plan.ts",
		'"ui.onboarding.default_model.block.pick_a_model" as const',
	],
	[
		"ui.onboarding.default_model.change",
		"Change",
		"steps/default-model-step.tsx",
		't("ui.onboarding.default_model.change")',
	],
	[
		"ui.onboarding.default_model.connected_pick",
		"{brand} is connected. Pick the model new chats should use.",
		"steps/default-model-step.tsx",
		't("ui.onboarding.default_model.connected_pick", {',
	],
	[
		"ui.onboarding.default_model.empty_helper",
		"No providers are connected yet. Go back a step to connect one.",
		"steps/default-model-step.tsx",
		't("ui.onboarding.default_model.empty_helper")',
	],
	[
		"ui.onboarding.default_model.fallback_name",
		"{brand}'s default model",
		"steps/default-model-step.tsx",
		't("ui.onboarding.default_model.fallback_name", {',
	],
	[
		"ui.onboarding.default_model.intro",
		"New chats use this model. Every agent can pick a different one later.",
		"steps/default-model-step.tsx",
		't("ui.onboarding.default_model.intro")',
	],
	[
		"ui.onboarding.default_model.loading",
		"Loading your models",
		"steps/default-model-step.tsx",
		't("ui.onboarding.default_model.loading")',
	],
	[
		"ui.onboarding.default_model.none_connected",
		"No provider is connected yet. Go back to connect one, or skip setup and connect one later from the chat.",
		"steps/default-model-step.tsx",
		't("ui.onboarding.default_model.none_connected")',
	],
	[
		"ui.onboarding.default_model.nothing_saved",
		"Nothing will be saved: your Local Operator can't list {brand} models yet, so setup finishes without a default model. Pick one in Settings before your first message.",
		"steps/default-model-step.tsx",
		't("ui.onboarding.default_model.nothing_saved", {',
	],
	[
		"ui.onboarding.default_model.provider_fallback",
		"this provider's",
		"steps/default-model-step.tsx",
		't("ui.onboarding.default_model.provider_fallback")',
	],
	[
		"ui.onboarding.default_model.tag.applied",
		"your default",
		"steps/default-model-step.tsx",
		't("ui.onboarding.default_model.tag.applied")',
	],
	[
		"ui.onboarding.default_model.tag.suggested",
		"suggested for your account",
		"steps/default-model-step.tsx",
		't("ui.onboarding.default_model.tag.suggested")',
	],
	[
		"ui.onboarding.dialog.setup",
		"Setup",
		"onboarding-dialog.tsx",
		't("ui.onboarding.dialog.setup")',
	],
	[
		"ui.onboarding.extras.greeting_done",
		"{name} is your chief of staff. Her conversation is where you pick up with her, and it is one keystroke away in the sidebar. You can also skip straight to a new chat.",
		"steps/extras-step.tsx",
		't("ui.onboarding.extras.greeting_done", { name: aidaName })',
	],
	[
		"ui.onboarding.extras.greeting_owed",
		"{name} is your chief of staff. She will say hello first, ask what to call you and what you would like help with, and show you around. You can also skip straight to a new chat.",
		"steps/extras-step.tsx",
		't("ui.onboarding.extras.greeting_owed", { name: aidaName })',
	],
	[
		"ui.onboarding.extras.next_meet",
		"Next: meet {name}",
		"steps/extras-step.tsx",
		't("ui.onboarding.extras.next_meet", { name: aidaName })',
	],
	[
		"ui.onboarding.modal.action.back",
		"Back",
		"onboarding-modal.tsx",
		't("ui.onboarding.modal.action.back")',
	],
	[
		"ui.onboarding.modal.action.continue",
		"Continue",
		"onboarding-modal.tsx",
		't("ui.onboarding.modal.action.continue")',
	],
	[
		"ui.onboarding.modal.action.finish",
		"Finish",
		"onboarding-modal.tsx",
		't("ui.onboarding.modal.action.finish")',
	],
	[
		"ui.onboarding.modal.action.meet",
		"Meet {name}",
		"onboarding-modal.tsx",
		't("ui.onboarding.modal.action.meet", { name: aidaName })',
	],
	[
		"ui.onboarding.modal.action.skip",
		"Skip",
		"onboarding-modal.tsx",
		't("ui.onboarding.modal.action.skip")',
	],
	[
		"ui.onboarding.modal.action.skip_for_now",
		"Skip for now",
		"onboarding-modal.tsx",
		't("ui.onboarding.modal.action.skip_for_now")',
	],
	[
		"ui.onboarding.modal.action.skip_to_chat",
		"Skip to chat",
		"onboarding-modal.tsx",
		't("ui.onboarding.modal.action.skip_to_chat")',
	],
	[
		"ui.onboarding.modal.error.aida_open_failed",
		"{name}'s conversation could not be opened, so you are in a new chat instead.",
		"onboarding-modal.tsx",
		't("ui.onboarding.modal.error.aida_open_failed", { name: aidaName })',
	],
	[
		"ui.onboarding.modal.title.connect_provider",
		"Connect an AI account",
		"onboarding-modal.tsx",
		'"ui.onboarding.modal.title.connect_provider"',
	],
	[
		"ui.onboarding.modal.title.default_model",
		"Your default model",
		"onboarding-modal.tsx",
		'"ui.onboarding.modal.title.default_model"',
	],
	[
		"ui.onboarding.modal.title.extras",
		"Web search (optional)",
		"onboarding-modal.tsx",
		'"ui.onboarding.modal.title.extras"',
	],
	[
		"ui.onboarding.modal.title.extras_with_name",
		"Web search, then meet {name}",
		"onboarding-modal.tsx",
		't("ui.onboarding.modal.title.extras_with_name", { name: aidaName })',
	],
	[
		"ui.onboarding.modal.title.fallback",
		"First-time setup",
		"onboarding-modal.tsx",
		't("ui.onboarding.modal.title.fallback")',
	],
	[
		"ui.onboarding.search.each_key_saved",
		"Each key is saved on your device as soon as you leave its field.",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.each_key_saved")',
	],
	[
		"ui.onboarding.search.intro",
		"Agents can look things up while they work — today's prices, this week's news — instead of relying on what the model already knows.",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.intro")',
	],
	[
		"ui.onboarding.search.mode.free",
		"Free",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.mode.free")',
	],
	[
		"ui.onboarding.search.mode.free_detail",
		"Uses a rotating pool of free providers — DuckDuckGo, Tavily's free tier, Exa and Parallel. No key needed; the pool is shared, so searches can be slower at busy times.",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.mode.free_detail")',
	],
	[
		"ui.onboarding.search.mode.keys",
		"Add API keys",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.mode.keys")',
	],
	[
		"ui.onboarding.search.mode.keys_detail",
		"Bring your own keys for the search providers you use.",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.mode.keys_detail")',
	],
	[
		"ui.onboarding.search.mode.label",
		"Search setup",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.mode.label")',
	],
	[
		"ui.onboarding.search.recommended",
		"Recommended",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.recommended")',
	],
	[
		"ui.onboarding.search.row.get_your",
		"Get your {name}",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.row.get_your", { name: credential.name })',
	],
	[
		"ui.onboarding.search.row.not_saved",
		"Not saved — {message}",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.row.not_saved", { message })',
	],
	[
		"ui.onboarding.search.row.placeholder",
		"Paste your API key",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.row.placeholder")',
	],
	[
		"ui.onboarding.search.row.save_failed",
		"The key could not be saved.",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.row.save_failed")',
	],
	[
		"ui.onboarding.search.row.saved",
		"Saved",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.row.saved")',
	],
	[
		"ui.onboarding.search.row.saving",
		"Saving {name}",
		"steps/search-api-step.tsx",
		't("ui.onboarding.search.row.saving", { name: credential.name })',
	],
];

test("every key's committed English is byte-exact in the catalogue, and the set is closed", () => {
	const catalogue = JSON.parse(readFileSync(CATALOGUE, "utf8"));
	assert.deepEqual(
		Object.keys(catalogue).sort(),
		CONTRACT.map(([key]) => key),
		"the catalogue's key set moved from the committed 45",
	);
	for (const [key, value] of CONTRACT) {
		assert.equal(
			catalogue[key],
			value,
			`${key} drifted from the committed sentence`,
		);
	}
});

test("every key is wired by the exact source form the contract names", () => {
	const files = new Map();
	/*
	 * Whitespace-insensitive: formatter wrapping is not a contract change,
	 * the tokens are.
	 */
	const slug = (s) => s.replace(/\s+/g, "").replace(/,}/g, "}");
	for (const [key, , file, need] of CONTRACT) {
		if (!files.has(file))
			files.set(file, slug(readFileSync(BASE + file, "utf8")));
		assert.ok(
			files.get(file).includes(slug(need)),
			`${key}: ${file} no longer wires ${JSON.stringify(need)}`,
		);
	}
});

test("the parameterised messages keep their parameter objects, and plain ones stay plain", () => {
	const catalogue = JSON.parse(readFileSync(CATALOGUE, "utf8"));
	for (const [key, value] of CONTRACT) {
		const placeholders = value.match(/\{\w+\}/g) ?? [];
		if (placeholders.length === 0) {
			assert.ok(
				!value.includes("{"),
				`${key}: unexpected brace in a plain value`,
			);
		} else {
			for (const p of placeholders)
				assert.ok(
					value.includes(p),
					`${key}: placeholder ${p} missing from its own sentence`,
				);
		}
	}
});

test("the rich contexts keep their structure: the link key sits inside its anchor, the greetings inside their paragraph", () => {
	const catalogue = JSON.parse(readFileSync(CATALOGUE, "utf8"));
	const search = readFileSync(`${BASE}steps/search-api-step.tsx`, "utf8");
	const call = search.indexOf('t("ui.onboarding.search.row.get_your"');
	assert.notEqual(call, -1, "the get-your-key call is gone");
	assert.ok(
		search
			.slice(Math.max(0, call - 900), call)
			.includes("href={credential.url}"),
		"the get-your-key call left its anchor (no credential.url anchor before it)",
	);
	assert.ok(
		search.slice(call, call + 200).includes("</a>"),
		"the get-your-key call left its anchor (no closing tag after it)",
	);
	const extras = readFileSync(`${BASE}steps/extras-step.tsx`, "utf8");
	const para = extras.slice(
		extras.indexOf('<p className="text-body text-ink-muted">'),
		extras.indexOf(
			"</p>",
			extras.indexOf('<p className="text-body text-ink-muted">'),
		),
	);
	assert.ok(
		para.includes('t("ui.onboarding.extras.greeting_owed"') &&
			para.includes('t("ui.onboarding.extras.greeting_done"'),
		"a greeting branch left its paragraph",
	);
	for (const key of [
		"ui.onboarding.extras.greeting_owed",
		"ui.onboarding.extras.greeting_done",
	]) {
		assert.ok(
			!catalogue[key].includes("<"),
			`${key}: catalogue values are parameter text, never markup`,
		);
	}
});

test("the plan consumes its key constants, and the modal consumes its title table", () => {
	const plan = readFileSync(`${BASE}steps/default-model-plan.ts`, "utf8");
	assert.ok(
		plan.includes("t(PICK_A_MODEL_KEY)") &&
			plan.includes("t(LOADING_MODELS_KEY)"),
		"the plan stopped translating its block reasons",
	);
	const modal = readFileSync(`${BASE}onboarding-modal.tsx`, "utf8");
	assert.ok(
		modal.includes("t(stepTitles[step])"),
		"the step titles stopped flowing through the table",
	);
});
