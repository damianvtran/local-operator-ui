import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import {
	inEnforcedScope,
	ratchetFindings,
} from "../../../../../scripts/i18n/check-strings.mjs";
import { messageArguments } from "../../../../../scripts/i18n/generate.mjs";

// Execute the shipped helpers and the same catalogue runtime the renderer reads.
// This is English/source-fallback proof, not a native frame or translation audit.
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/i18n/messages";
			export * from "./src/i18n/locale";
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
	"configuration",
	"integrations",
	"model",
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

// Test each quantity, rather than only the English singular, because French's
// category for zero would produce a false singular if fallback used target rules.
test("settings helper quantities preserve English for 0, 1 and 2, including fallback", () => {
	for (const locale of ["en", "fr"]) {
		runtime.setLocale(locale);
		for (const count of [0, 1, 2]) {
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
		}
	}
	runtime.setLocale("en");
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
		`${runtime.t("ui.settings.configuration.backend_setting_row.needs")}automatic removal${runtime.t("ui.settings.configuration.backend_setting_row.on_nothing_here_is_saved_while_it_is_off")}`,
		"Needs automatic removal on. Nothing here is saved while it is off.",
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

test("zero-ceiling ratchet rejects a new literal and accepts the extracted control", () => {
	const path =
		"src/renderer/src/features/settings/components/settings-page.tsx";
	assert.deepEqual(ratchetFindings({ [path]: 1 }, {}), [
		{ path, count: 1, ceiling: null },
	]);
	assert.deepEqual(ratchetFindings({}, {}), []);
	// Settings ceilings are lowered here, not activated globally: this fixture
	// distinguishes a ratchet violation from the programme's enforced scope.
	assert.equal(
		inEnforcedScope(path, ["src/renderer/src/features/settings/"]),
		true,
	);
	assert.equal(inEnforcedScope(path, ["src/i18n/"]), false);
});
