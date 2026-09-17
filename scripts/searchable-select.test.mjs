/*
 * The combobox's two behavioural rules, driven directly rather than through a
 * frame.
 *
 * A frame can show that a list narrowed; it cannot show WHY, and neither of
 * these rules is visible in a screenshot at all:
 *
 * 1. the FILTER — a case- and accent-insensitive substring match over the shown
 *    name, and the deliberate exception that makes clicking the field show the
 *    whole list instead of the one row already chosen;
 * 2. what ENTER does — the highlighted row first, then an exact name match
 *    ahead of free text, then the free text itself, and nothing at all for an
 *    empty buffer.
 *
 * The second one is the whole of "suggestions assist, they do not constrain":
 * a field that could only store what a list knows would make an offline or
 * unlisted provider un-configurable, and the rule that prevents it is one
 * branch nobody would notice going missing.
 *
 * Both functions are exported FROM the shipped component module, so this file
 * cannot pass while the component disagrees with it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export { filterSearchableOptions, fold, resolveEnter } from "./src/renderer/src/shared/components/ui/searchable-select";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});
const { filterSearchableOptions, fold, resolveEnter } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const option = (id, name) => ({ id, name });
const OPTIONS = [
	option("gpt-4o", "openai/gpt-4o"),
	option("claude-opus-5", "anthropic/claude-opus-5"),
	option("gemini-ultra", "Google Gemini Ultra"),
	option("accented", "Café Modèle"),
];

const names = (options) => options.map((entry) => entry.name);

test("fold strips accents and case, as the MUI default filter did", () => {
	// Dropping the accent fold would quietly break names that arrive from the
	// API with combining marks.
	assert.equal(fold("Café"), "cafe");
	assert.equal(fold("CAFÉ"), "cafe");
	assert.equal(fold("Gemini Ultra"), "gemini ultra");
});

test("an empty query, and the query equal to the selection, show everything", () => {
	// The second half is what makes clicking an already-filled field show the
	// whole list instead of the single row that is chosen — the exception that
	// is easy to lose and reads to a user as "the list is empty".
	assert.deepEqual(
		names(filterSearchableOptions(OPTIONS, "", "openai/gpt-4o")),
		names(OPTIONS),
	);
	assert.deepEqual(
		names(filterSearchableOptions(OPTIONS, "openai/gpt-4o", "openai/gpt-4o")),
		names(OPTIONS),
	);
	assert.deepEqual(
		names(filterSearchableOptions(OPTIONS, "   ", "openai/gpt-4o")),
		names(OPTIONS),
	);
});

test("the filter is a case- and accent-insensitive substring match", () => {
	assert.deepEqual(names(filterSearchableOptions(OPTIONS, "ANTHROPIC", "")), [
		"anthropic/claude-opus-5",
	]);
	assert.deepEqual(names(filterSearchableOptions(OPTIONS, "cafe", "")), [
		"Café Modèle",
	]);
	// A substring, not a prefix: the settings rows show `provider/model`, so
	// typing the provider narrows while the accepted value stays bare.
	assert.deepEqual(names(filterSearchableOptions(OPTIONS, "opus", "")), [
		"anthropic/claude-opus-5",
	]);
	assert.deepEqual(
		filterSearchableOptions(OPTIONS, "nothing-mat\nches", ""),
		[],
	);
});

test("Enter takes the highlighted row before anything else", () => {
	const highlighted = OPTIONS[2];
	assert.deepEqual(resolveEnter(OPTIONS, "gpt", highlighted), {
		kind: "option",
		option: highlighted,
	});
});

test("Enter prefers an exact name match over free text", () => {
	// Typing a model's full name must select that model rather than save the
	// name as a custom id, and the match is folded so case and accents do not
	// change which row it is.
	assert.deepEqual(resolveEnter(OPTIONS, "anthropic/claude-opus-5", null), {
		kind: "option",
		option: OPTIONS[1],
	});
	assert.deepEqual(resolveEnter(OPTIONS, "CAFÉ MODÈLE", null), {
		kind: "option",
		option: OPTIONS[3],
	});
});

test("Enter on text no option matches is handed back verbatim", () => {
	assert.deepEqual(resolveEnter(OPTIONS, "  my/custom-id  ", null), {
		kind: "custom",
		text: "my/custom-id",
	});
});

test("Enter on an empty buffer does nothing at all", () => {
	// Clearing is a deliberate gesture with its own affordance; "delete the text
	// and press Enter" must not write the empty string by accident.
	assert.deepEqual(resolveEnter(OPTIONS, "", null), { kind: "none" });
	assert.deepEqual(resolveEnter(OPTIONS, "   ", null), { kind: "none" });
});
