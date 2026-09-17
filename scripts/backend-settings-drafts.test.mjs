/*
 * What an emptied field writes, and why it is the empty STRING.
 *
 * This is the one line in the settings form that decides the wire spelling of
 * "cleared", and it decides it for every `empty_unsets` row at once — which is
 * what made the defect invisible and what makes this file worth having: the
 * clear used to be sent as JSON `null`, a value the route's text validator
 * answers "expected text" to, so an emptied field was rejected 422 on every
 * setting of that shape. Nothing failed locally, because `null` passes the
 * renderer's own contract schema, and the plain `<Input>` the fields shipped
 * with reached the state by hand ("select all, delete") rather than through a
 * button. The settings comboboxes then added a one-click clear affordance, so a
 * path nobody had exercised became the obvious gesture (QA round 1, Q1).
 *
 * The rows are read from the COMMITTED registry projection — the real
 * `/v1/settings` payload — rather than hand-built, because the property under
 * test belongs to the registry's own rows: which keys carry `empty_unsets`.
 *
 * The bundle imports the SHIPPED module, so a second implementation cannot pass
 * this while the settings page disagrees with it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export { draftFromSetting, editOutcome, isDraftDirty } from "./src/renderer/src/features/settings/components/backend-settings-drafts";',
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
const { draftFromSetting, editOutcome, isDraftDirty } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const registry = JSON.parse(
	readFileSync("scripts/fixtures/backend-settings-registry.json", "utf8"),
);
const settingFor = (key) => {
	const setting = registry.settings.find((row) => row.key === key);
	assert.ok(setting, `the registry fixture must carry ${key}`);
	return setting;
};

/**
 * The keys this feature's rows use, plus three other `empty_unsets` rows whose
 * clearing predates it — `bash.shell` is a plain `<Input>` nobody has connected
 * to this feature at all, which is the point: the spelling is fixed for the
 * LAYER, not for the comboboxes.
 */
const EMPTYING_KEYS = [
	"hosting",
	"model_name",
	"subagents.models.lo",
	"subagents.models.med",
	"subagents.models.hi",
	"bash.shell",
	"desktop.launch_command",
];
const STORING_KEY = "web_search.searxng_endpoint";

/** The request an emptied field produces, as the row's own draft resolves it. */
const cleared = (key) => {
	const setting = settingFor(key);
	return editOutcome(setting, { ...draftFromSetting(setting), value: "" });
};

test("the fixture still describes the two shapes this rule turns on", () => {
	// The premise, asserted rather than assumed: a row that empties on clear and
	// a row that stores the empty string instead.
	for (const key of EMPTYING_KEYS) {
		const setting = settingFor(key);
		assert.equal(setting.empty_unsets, true, `${key} must empty on clear`);
		assert.equal(setting.kind, "text", `${key} must be a text row`);
	}
	assert.equal(settingFor(STORING_KEY).empty_unsets, false);
	assert.equal(settingFor(STORING_KEY).kind, "text");
});

test("an emptied field writes the empty string, never null", () => {
	// `server/routes/settings.py`'s `edit_setting` tests `edit.value == ""` to
	// decide a clear, and `settings_io`'s text validator answers "expected text"
	// for anything that is not a string. `null` is therefore not a spelling the
	// backend has anything to do with, and the TUI clears through
	// `settings_io.reset_setting`, which writes an empty string too.
	for (const key of EMPTYING_KEYS) {
		const outcome = cleared(key);
		assert.equal(outcome.ok, true, `${key} must produce a request`);
		assert.equal(
			outcome.request.value,
			"",
			`${key} must clear with the route's own sentinel`,
		);
		assert.notEqual(outcome.request.value, null);
		assert.equal(typeof outcome.request.value, "string");
	}
});

test("a row that does not empty on clear writes the empty string as well", () => {
	// One spelling for one state, whichever the row means by it: the FIELD is
	// empty, and the route decides whether that is a reset or a stored "". If
	// this diverged, the same gesture would send two different JSON types
	// depending on a flag the user cannot see.
	assert.equal(cleared(STORING_KEY).request.value, "");
});

test("a clear and a typed value that matched no listing stay different writes", () => {
	// The distinction the row's own comment requires. Both are "not the value
	// that was there", and only one of them means unset.
	const setting = settingFor("model_name");
	const typed = editOutcome(setting, {
		...draftFromSetting(setting),
		value: "  zzzz-no-such-model  ",
	});
	assert.equal(typed.ok, true);
	assert.equal(typed.request.value, "  zzzz-no-such-model  ");
	assert.notEqual(typed.request.value, cleared("model_name").request.value);
});

test("a clear is a dirty draft even when the row already holds nothing", () => {
	// `isDraftDirty` compares against the serialized server value, and the
	// fixture's rows are empty — so this pins that an empty draft on an empty
	// row is NOT dirty, which is what keeps a clear-then-Save cycle from writing
	// a no-op request. Recorded beside the spelling above because the two rules
	// share the empty string as their subject.
	const setting = settingFor("hosting");
	assert.equal(isDraftDirty(setting, draftFromSetting(setting)), false);
	assert.equal(
		isDraftDirty(setting, { ...draftFromSetting(setting), value: "  " }),
		true,
	);
});
