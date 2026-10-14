import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: 'export { t, setLocale } from "./src/i18n";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { t, setLocale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
setLocale("en");

// These strings are also expression defaults and option descriptions, which the
// JSX ratchet cannot see. Assert their real formatted output independently.
test("shared selectors preserve field labels, inheritance and typed identifiers", () => {
	assert.equal(
		t("ui.common.models.hosting_select.hosting_provider"),
		"Hosting provider",
	);
	assert.equal(t("ui.common.models.model_select.model"), "Model");
	assert.equal(t("ui.common.models.default"), "Default");
	assert.equal(t("ui.common.loading.page"), "Loading page");
	assert.equal(
		t("ui.common.models.hosting_select.select_a_hosting_provider"),
		"Select a hosting provider...",
	);
	assert.equal(
		t("ui.common.models.model_select.select_a_model"),
		"Select a model...",
	);
	assert.equal(
		t("ui.common.models.model_select.no_models_for", {
			name: "synthetic-provider/opaque-id",
		}),
		"No models for synthetic-provider/opaque-id",
	);
});

test("field chrome retains its caller-owned field name and current-value suffix", () => {
	assert.equal(
		t("ui.common.forms.autocomplete_field.save", { label: "Title" }),
		"Save Title",
	);
	assert.equal(
		t("ui.common.forms.autocomplete_field.cancel_editing", { label: "Title" }),
		"Cancel editing Title",
	);
	assert.equal(
		t("ui.common.forms.pagination.position", { page: "2", count: "3" }),
		"Page 2 of 3",
	);
	assert.equal(
		t("ui.common.forms.editable_field.current_value", {
			detail: "synthetic value",
			detail2: t("ui.common.forms.field.click_to_edit"),
		}),
		"Current value: synthetic value. Click to edit.",
	);
});

for (const count of [0, 1, 2]) {
	test(`pagination position at ${count} is a label, not a counted page noun`, () => {
		assert.equal(
			t("ui.common.forms.pagination.position", {
				page: "1",
				count: String(count),
			}),
			`Page 1 of ${count}`,
		);
		assert.equal(
			t("ui.common.forms.searchable_select.clear_value"),
			"Clear value",
		);
		assert.equal(
			t("ui.common.forms.searchable_select.no_matches"),
			"No matches",
		);
	});
}

test("conflict choices and account sign-in keep their distinct meanings", () => {
	assert.equal(
		t("ui.common.editing.conflict"),
		"This changed while you were editing",
	);
	assert.equal(t("ui.common.editing.keep_mine"), "Keep mine");
	assert.equal(t("ui.common.editing.use_theirs"), "Use theirs");
	assert.equal(
		t("ui.common.account.radient_auth_buttons.sign_in_to_radient"),
		"Sign in to Radient",
	);
});
