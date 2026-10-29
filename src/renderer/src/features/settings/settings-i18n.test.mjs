import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { TYPE, parse } from "@formatjs/icu-messageformat-parser";
import { build } from "esbuild";
import { ratchetFindings } from "../../../../../scripts/i18n/check-strings.mjs";
import { messageArguments } from "../../../../../scripts/i18n/generate.mjs";

// Execute the shipped helpers and the same catalogue runtime the renderer reads.
// This is English/source-fallback proof, not a native frame or translation audit.
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/i18n/messages";
			export * from "./src/i18n/locale";
			export { bundledCatalogues } from "./src/i18n/keys.gen";
			export { toolCountLabel, integrationCountLabel } from "./src/renderer/src/features/settings/components/integrations/integration-model";
			export { formatHours, rangeSentence, validateHours } from "./src/renderer/src/features/settings/retention-duration";
			export { providerOptions } from "./src/renderer/src/features/settings/model-setting-options";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});
const runtime = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const themes = [
	"account",
	"appearance",
	/* The window-glass copy lives in its own namespace file: a locale that already
	 * ships `ui.settings.appearance` (French) carries an audited ledger entry over
	 * that file's bytes, so new English keys beside it would make the entry stale. */
	"appearance.window_glass",
	"configuration",
	"integrations",
	"model",
	/* Default effort and the provider callout live in their own English-only
	 * namespace files: `ui.settings.model` ships French with an audited ledger
	 * entry over its bytes, so new copy beside it would make that entry stale. */
	"model.default_effort",
	"model.provider_callout",
	"navigation",
	"shortcuts",
	"speech",
	"updates",
];
const catalogue = Object.assign(
	{},
	...themes.map((theme) =>
		JSON.parse(
			readFileSync(`src/i18n/catalogues/en/ui.settings.${theme}.json`, "utf8"),
		),
	),
);

// Every English-source assertion starts from its own locale state. Cleanup must
// run even after an assertion fails: otherwise one French mismatch cascades into
// unrelated interpolation, retention, description and provider-heading failures.
beforeEach(() => runtime.setLocale("en"));
afterEach(() => {
	runtime.clearRegisteredCatalogues();
	runtime.setLocale("en");
});

// This private-use French tag is a test-only locale with no bundled messages,
// not a real rollout locale that will eventually acquire these namespaces. Its
// French zero category differs from English, so 0 still proves that fallback
// uses the source's plural rules rather than the requested locale's rules.
const fallbackLocale = "fr-x-source-fallback";
// Test each quantity, rather than only the English singular, because French's
// category for zero would produce a false singular if fallback used target rules.
test("settings helper quantities preserve English for 0, 1, 2 and 1000, including fallback", () => {
	assert.equal(Object.hasOwn(runtime.bundledCatalogues, fallbackLocale), false);
	for (const locale of ["en", fallbackLocale]) {
		runtime.setLocale(locale);
		assert.equal(runtime.currentLocale(), locale);
		for (const count of [0, 1, 2, 1000]) {
			assert.equal(
				runtime.toolCountLabel(count),
				`${count} ${count === 1 ? "tool" : "tools"}`,
			);
			assert.equal(
				runtime.integrationCountLabel(count),
				`${count} ${count === 1 ? "integration" : "integrations"}`,
			);
			assert.equal(
				runtime.t(
					"ui.settings.configuration.settings_filter_bar.unsaved_count",
					{ count },
				),
				`${count} unsaved ${count === 1 ? "change" : "changes"}`,
			);
			assert.equal(
				runtime.t(
					"ui.settings.configuration.settings_group_header.setting_count",
					{ count },
				),
				`${count} ${count === 1 ? "setting" : "settings"}`,
			);
			// Each of these reads a noun that must agree with the number; the English
			// singular is a real `one` arm, never an `other`-only "1 settings".
			assert.equal(
				runtime.t(
					"ui.settings.configuration.settings_filter_bar.advanced_shown",
					{ count },
				),
				count === 1
					? "1 advanced setting shown \u2014 Expand all to see it"
					: `${count} advanced settings shown \u2014 Expand all to see them`,
			);
			assert.equal(
				runtime.t(
					"ui.settings.configuration.settings_filter_bar.core_and_advanced",
					{ coreCount: count, advancedCount: count },
				),
				`${count} core ${count === 1 ? "setting" : "settings"}, ${count} advanced`,
			);
			assert.equal(
				runtime.t("ui.settings.speech.speech_section.missing_voice_rows", {
					count,
					rows: "pace",
				}),
				`This backend does not register pace yet, so ${count === 1 ? "that row is" : "those rows are"} not shown.`,
			);
			assert.equal(
				runtime.t(
					"ui.settings.integrations.integration_model.minutes_min_ago",
					{ minutes: count },
				),
				`${count} min ago`,
			);
		}
	}
});

test("real French settings helpers use French text and plural rules", () => {
	runtime.setLocale("fr");
	for (const count of [0, 1, 2]) {
		const plural = count > 1 ? "s" : "";
		assert.equal(runtime.toolCountLabel(count), `${count} outil${plural}`);
		assert.equal(
			runtime.integrationCountLabel(count),
			`${count} intégration${plural}`,
		);
		assert.equal(
			runtime.t("ui.settings.configuration.settings_filter_bar.unsaved_count", {
				count,
			}),
			`${count} modification${plural} non enregistrée${plural}`,
		);
		assert.equal(
			runtime.t(
				"ui.settings.configuration.settings_group_header.setting_count",
				{ count },
			),
			`${count} paramètre${plural}`,
		);
		assert.equal(runtime.formatHours(count), `${count} heure${plural}`);
	}
	assert.equal(
		runtime.t("ui.settings.configuration.settings_filter_bar.search_count", {
			matchCount: 1,
			sectionCount: 2,
		}),
		"1 résultat dans 2 sections",
	);
	assert.equal(
		runtime.t("ui.settings.model.settings_page.model_settings"),
		"Paramètres des modèles",
	);
});

test("whole messages keep interpolation and markup-adjacent spaces intact", () => {
	assert.equal(
		runtime.t("ui.settings.configuration.settings_filter_bar.search_count", {
			matchCount: 1,
			sectionCount: 2,
		}),
		"1 result in 2 sections",
	);
	assert.equal(
		runtime.t("ui.settings.configuration.settings_filter_bar.search_count", {
			matchCount: 2,
			sectionCount: 1,
		}),
		"2 results in 1 section",
	);
	assert.equal(
		runtime.t("ui.settings.configuration.settings_filter_bar.search_count", {
			matchCount: 1000,
			sectionCount: 1000,
		}),
		"1000 results in 1000 sections",
	);
	assert.equal(
		runtime.t(
			"ui.settings.configuration.backend_setting_row.use_default_for_label",
			{ label: "Default model" },
		),
		"Use default for Default model",
	);
	assert.equal(
		runtime.t(
			"ui.settings.integrations.integration_key_dialog.add_keys_heading",
			{ count: 1, name: "Example MCP" },
		),
		"Add the key for Example MCP",
	);
	assert.equal(
		runtime.t(
			"ui.settings.integrations.integration_key_dialog.add_keys_heading",
			{ count: 2, name: "Example MCP" },
		),
		"Add keys for Example MCP",
	);
	assert.equal(
		runtime.t("ui.settings.configuration.backend_setting_row.gate_note", {
			gate: "automatic removal",
		}),
		"Needs automatic removal on. Nothing here is saved while it is off.",
	);
	// Select arms carry the optional clauses, so a translator can reorder them.
	assert.equal(
		runtime.t(
			"ui.settings.configuration.retention_duration_control.idle_window_status",
			{ duration: "3 days", isDefault: "yes" },
		),
		"3 days with no activity (default)",
	);
	assert.equal(
		runtime.t(
			"ui.settings.configuration.retention_duration_control.idle_window_status",
			{ duration: "3 days", isDefault: "no" },
		),
		"3 days with no activity",
	);
	assert.equal(
		runtime.t(
			"ui.settings.integrations.integration_sign_in_dialog.browser_approval_notice",
			{ name: "Notion", replaces: "yes" },
		),
		"Local Operator opens your browser so you can approve access to Notion. This replaces the sign-in it has now.",
	);
	assert.equal(
		runtime.t(
			"ui.settings.integrations.integration_sign_in_dialog.browser_approval_notice",
			{ name: "Notion", replaces: "no" },
		),
		"Local Operator opens your browser so you can approve access to Notion.",
	);
});

test("retention duration and allowed-range helpers execute the new ICU path", () => {
	assert.equal(runtime.formatHours(0), "0 hours");
	assert.equal(runtime.formatHours(1), "1 hour");
	assert.equal(runtime.formatHours(48), "48 hours");
	assert.equal(runtime.formatHours(72), "3 days");
	assert.equal(runtime.formatHours(720), "1 month");
	assert.equal(
		runtime.rangeSentence({ min: 2, max: 720 }),
		"between 2 hours and 1 month (30 days)",
	);
	const invalid = runtime.validateHours("1", { min: 2, max: 720 });
	assert.equal(invalid.ok, false);
	assert.equal(
		invalid.error,
		"1 hour is too short. Choose a time between 2 hours and 1 month (30 days).",
	);
});

test("D2 model/configuration English descriptions remain exact", () => {
	assert.equal(
		runtime.t("ui.settings.model.settings_page.model_settings"),
		"Model settings",
	);
	assert.equal(
		runtime.t(
			"ui.settings.model.settings_page.configure_the_default_ai_model_and_hosting_providers_used_for_gen",
		),
		"Configure the default AI model and hosting providers used for generating responses. This will be used for all agents that don't have a specific model or hosting provider configured. You can override these settings for individual agents in the agent settings.",
	);
	assert.equal(
		runtime.t(
			"ui.settings.configuration.settings_page.configuration_information",
		),
		"Configuration information",
	);
	assert.equal(
		runtime.t(
			"ui.settings.configuration.settings_page.system_information_about_the_current_configuration",
		),
		"System information about the current configuration.",
	);
});

test("localized provider headings do not translate readiness discriminators or drop rows", () => {
	const provider = (id, overrides = {}) => ({
		id,
		name: id,
		storage_id: id,
		search_aliases: [],
		auth_methods: [],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: null,
		...overrides,
	});
	const providers = [
		provider("cloud-missing"),
		provider("local", {
			local: true,
			configured: true,
			credential_optional: true,
		}),
		provider("cloud-ready", { configured: true, has_credential: true }),
	];
	const english = runtime.providerOptions(providers);
	assert.deepEqual(
		english.map((row) => row.group),
		["Ready to use", "Needs a running server", "Needs sign-in"],
	);
	try {
		runtime.registerCatalogue("fr", {
			"ui.settings.model.model_setting_options.provider_group_0": "TEST_READY",
			"ui.settings.model.model_setting_options.provider_group_1": "TEST_LOCAL",
			"ui.settings.model.model_setting_options.provider_group_2": "TEST_AUTH",
		});
		runtime.setLocale("fr");
		const localized = runtime.providerOptions(providers);
		assert.deepEqual(
			localized.map((row) => row.id),
			english.map((row) => row.id),
		);
		assert.deepEqual(
			localized.map((row) => row.group),
			["TEST_READY", "TEST_LOCAL", "TEST_AUTH"],
		);
	} finally {
		runtime.clearRegisteredCatalogues();
		runtime.setLocale("en");
	}
});

test("new theme contexts cover every key, UI role, width and ICU placeholder", () => {
	for (const theme of themes) {
		const messages = JSON.parse(
			readFileSync(`src/i18n/catalogues/en/ui.settings.${theme}.json`, "utf8"),
		);
		const context = JSON.parse(
			readFileSync(
				`src/i18n/catalogues/en/ui.settings.${theme}.context.json`,
				"utf8",
			),
		);
		assert.deepEqual(Object.keys(context).sort(), Object.keys(messages).sort());
		for (const [key, message] of Object.entries(messages)) {
			for (const field of ["role", "tone", "length", "note"])
				assert.ok(context[key][field]?.trim(), `${key}: ${field}`);
			for (const [name] of messageArguments(message))
				assert.ok(context[key].placeholders?.[name]?.trim(), `${key}: ${name}`);
		}
	}
	assert.ok(Object.keys(catalogue).length > 400);
});

test("a missing baseline entry fails, and a file with no literals needs no entry", () => {
	const path =
		"src/renderer/src/features/settings/components/settings-page.tsx";
	assert.deepEqual(ratchetFindings({ [path]: 1 }, {}), [
		{ path, count: 1, ceiling: null },
	]);
	assert.deepEqual(ratchetFindings({}, {}), []);
	// Global since the scope list was removed: a missing entry fails in every
	// area, and a file with no literals (the extracted control) has nothing to
	// ratchet.
});

// A counted noun written as `{count} things` renders "1 things" in English and has no
// plural arm for ru/ar. Any count-like placeholder must therefore sit inside a real
// ICU plural carrying `one` and `other`; this walks every settings key so a later
// extraction cannot reintroduce the shape.
const COUNT_LIKE = /^(count|n|total|num|number|\w*Count|days|hours|minutes)$/;
test("every count-like placeholder in the settings catalogues is a real ICU plural", () => {
	const offenders = [];
	for (const [key, message] of Object.entries(catalogue)) {
		const plurals = new Map();
		const plain = new Set();
		const walk = (nodes) => {
			for (const node of nodes) {
				if (node.type === TYPE.plural) {
					plurals.set(node.value, Object.keys(node.options));
					for (const option of Object.values(node.options)) walk(option.value);
				} else if (node.type === TYPE.select) {
					for (const option of Object.values(node.options)) walk(option.value);
				} else if (node.type === TYPE.argument || node.type === TYPE.number) {
					plain.add(node.value);
				}
			}
		};
		walk(parse(message));
		for (const [name, arms] of plurals) {
			if (!(arms.includes("one") && arms.includes("other")))
				offenders.push(`${key}: {${name}} lacks one/other`);
		}
		for (const name of plain) {
			if (COUNT_LIKE.test(name) && !plurals.has(name))
				offenders.push(`${key}: {${name}} is not inside a plural`);
		}
	}
	assert.deepEqual(offenders, []);
});
