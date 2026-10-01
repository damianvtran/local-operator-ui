/*
 * The combobox's behavioural rules, driven directly rather than through a frame.
 *
 * A frame can show that a list narrowed; it cannot show WHY, and none of these
 * rules is visible in a screenshot:
 *
 * 1. the FILTER — a case- and accent-insensitive substring match over the shown
 *    name, and the deliberate exception that makes clicking the field show the
 *    whole list instead of the one row already chosen;
 * 2. the ROWS — the options a query admits, then the row that carries the typed
 *    text, which is what keeps "assist, never constrain" true without the trap
 *    it used to set;
 * 3. what ENTER does — the resolved active row, where "resolved" means the
 *    stored highlight, an exact name match, or else the first row of a NARROWED
 *    list, and nothing at all for a field at rest or an empty buffer;
 * 4. the KEYWORDS — the second matchable term a row may carry beside its shown
 *    name (a team's slug when the row displays a label, an alias): it matches
 *    in the filter, suppresses the custom row when the typed text IS that term
 *    (the option's own row is then the typed value), and wins the exact arm of
 *    the keyboard resolution — so "type the key, press Enter" takes the row the
 *    key names (round 1, R1-1: the start-session dialog stopped answering a
 *    team's slug the moment its row started showing the label).
 *
 * Rule 3 is the whole of the keyboard contract, and it is the one this file
 * exists for: "type three characters, press Enter" used to commit the three
 * characters as a value — a stored provider that no registry had ever heard of,
 * with nothing on the page saying so (UX round 1, U1). Both halves of the fix
 * are pinned here, and each of them fails if the other is removed:
 *
 * - take the visible match → `resolveActiveIndex` gets no "first row" default;
 * - keep the typed value committable → `buildComboboxRows` gets no custom row.
 *
 * Every function is exported FROM the shipped component module, so this file
 * cannot pass while the component disagrees with it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export { buildComboboxRows, filterSearchableOptions, fold, navigableRowCount, resolveActiveIndex, resolveEnter } from "./src/renderer/src/shared/components/ui/searchable-select";',
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
const {
	buildComboboxRows,
	filterSearchableOptions,
	fold,
	navigableRowCount,
	resolveActiveIndex,
	resolveEnter,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const option = (id, name) => ({ id, name });
const OPTIONS = [
	option("gpt-4o", "openai/gpt-4o"),
	option("claude-opus-5", "anthropic/claude-opus-5"),
	option("gemini-ultra", "Google Gemini Ultra"),
	option("accented", "Café Modèle"),
];

/** The provider list the settings field shows: grouped, and with a shorter name
 * that contains a longer one, so "the first row" and "the exact row" differ. */
const GROUPED = [
	{ id: "lmstudio", name: "LM Studio", group: "Needs a running server" },
	{ id: "ollama", name: "Ollama", group: "Needs a running server" },
	{ id: "anthropic", name: "Anthropic", group: "Needs sign-in" },
	{
		id: "anthropic-max",
		name: "Anthropic (Claude Pro/Max)",
		group: "Needs sign-in",
	},
];

const names = (options) => options.map((entry) => entry.name);

/** The rows the listbox would draw for this state. */
const rowsFor = (options, query, selectedName = "", customRow = true) =>
	buildComboboxRows(options, query, selectedName, customRow);

/** The row the keyboard is on, with no arrow key pressed (`activeIndex` -1). */
const activeFor = (options, query, selectedName = "", customRow = true) => {
	const rows = rowsFor(options, query, selectedName, customRow);
	return resolveActiveIndex(rows, query, selectedName, -1);
};

/** What Enter commits for this state, driving the same three steps the
 * component does: build the rows, resolve the active row, read the answer. */
const enterFor = (
	options,
	query,
	selectedName = "",
	customRow = true,
	activeIndex = -1,
) => {
	const rows = rowsFor(options, query, selectedName, customRow);
	return resolveEnter(
		rows,
		resolveActiveIndex(rows, query, selectedName, activeIndex),
	);
};

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

test("a query that narrows the list makes its first row the active row", () => {
	// U1, first half. Nothing has been arrowed to, but the user is LOOKING at
	// one row, so that is the row Enter acts on.
	// `ant` admits two rows — `Anthropic` and `Anthropic (Claude Pro/Max)` —
	// and the active row is the first of them, in the keyboard's own numbering.
	assert.equal(activeFor(GROUPED, "ant"), 0);
	// A group heading is not a row and is never the answer: `ollama` admits one
	// option, which sits under a heading, and the answer is still 0.
	assert.equal(activeFor(GROUPED, "ollama"), 0);
	// And no typed-text row: the query already IS that option's name, so the
	// option's row is the value and a second row saying the same thing would be
	// two ways to commit one thing.
	assert.equal(navigableRowCount(rowsFor(GROUPED, "ollama")), 1);
});

test("typing a filter and pressing Enter takes the visible match, not the filter", () => {
	// The reported gesture, end to end: type `ant`, see one row, press Enter.
	// Before the fix this committed the string "ant" as the provider.
	assert.deepEqual(enterFor(GROUPED, "ant"), {
		kind: "option",
		option: GROUPED[2],
	});
});

test("an exact name match still wins over the first narrowed row", () => {
	// A list where the exact spelling is NOT the first row it narrows to: the
	// longer name comes first in the listing, so "first row" and "the row that
	// spells the query" are different answers.
	const longerFirst = [
		GROUPED[3],
		GROUPED[2],
		{
			id: "anthropic-vertex",
			name: "Anthropic on Vertex",
			group: "Needs sign-in",
		},
	];
	assert.equal(activeFor(longerFirst, "Anthropic"), 1);
	assert.deepEqual(enterFor(longerFirst, "anthropic"), {
		kind: "option",
		option: GROUPED[2],
	});
	// And the accent/case fold still decides which row is "exact".
	assert.deepEqual(enterFor(OPTIONS, "CAFÉ MODÈLE"), {
		kind: "option",
		option: OPTIONS[3],
	});
});

test("a field at rest keeps no active row, so Enter cannot re-pick for the user", () => {
	// The other half of the same rule, and the reason the default is not simply
	// "row 0": a field opened with its own value in it shows EVERY row, and the
	// first of those is arbitrary. Clicking the field and pressing Enter must
	// not silently replace the value with whatever happens to be first.
	assert.equal(activeFor(GROUPED, "Ollama", "Ollama"), -1);
	assert.equal(activeFor(GROUPED, "", ""), -1);
	assert.deepEqual(enterFor(GROUPED, "Ollama", "Ollama"), { kind: "none" });
	assert.deepEqual(enterFor(GROUPED, "", ""), { kind: "none" });
});

test("the typed text gets its own row, last, and only when free text is allowed", () => {
	const rows = rowsFor(OPTIONS, "my/custom-id");
	assert.equal(rows.at(-1).kind, "custom");
	assert.equal(rows.at(-1).text, "my/custom-id");
	// Its index is one past the last VISIBLE option, which is what the keyboard
	// numbering is in — no query matched, so it is row 0.
	assert.equal(rows.at(-1).index, 0);
	assert.equal(
		rowsFor(OPTIONS, "gpt").at(-1).index,
		filterSearchableOptions(OPTIONS, "gpt", "").length,
	);
	// A field that rejects free text must not offer the row …
	assert.equal(
		rowsFor(OPTIONS, "my/custom-id", "", false).some(
			(row) => row.kind === "custom",
		),
		false,
	);
	// … and neither must one whose query already IS a row's own name, because
	// then that option's row is the typed value.
	assert.equal(
		rowsFor(OPTIONS, "anthropic/claude-opus-5").some(
			(row) => row.kind === "custom",
		),
		false,
	);
});

test("the typed text is committed by its own row, and by nothing else", () => {
	// U1, second half. Enter on the filtered list takes the match; reaching the
	// last row takes the text. Both are visible gestures, which is what makes
	// "suggestions assist, they do not constrain" survivable.
	const rows = rowsFor(GROUPED, "zzz-not-a-provider");
	const last = navigableRowCount(rows) - 1;
	assert.deepEqual(
		enterFor(GROUPED, "  zzz-not-a-provider  ", "", true, last),
		{
			kind: "custom",
			text: "zzz-not-a-provider",
		},
	);
	// The same query with a row to match: the match is taken by default, and the
	// typed text only by explicitly reaching its row.
	assert.deepEqual(enterFor(GROUPED, "ant"), {
		kind: "option",
		option: GROUPED[2],
	});
	assert.deepEqual(
		enterFor(
			GROUPED,
			"ant",
			"",
			true,
			navigableRowCount(rowsFor(GROUPED, "ant")) - 1,
		),
		{ kind: "custom", text: "ant" },
	);
});

test("an empty buffer is nobody's, even with rows on screen", () => {
	// Clearing is a deliberate gesture with its own affordance; "delete the text
	// and press Enter" must not write the empty string by accident. The custom
	// row is keyed on non-empty text, so an empty buffer has no row to land on.
	assert.deepEqual(enterFor(OPTIONS, ""), { kind: "none" });
	assert.deepEqual(enterFor(OPTIONS, "   "), { kind: "none" });
});

/*
 * The KEYWORDS (round 1, R1-1). The rows below are the start-session dialog's
 * shape after the team-label change: the shown name is a human label and the
 * team's actual key rides as a keyword, the way that dialog now passes it.
 */
const TEAM_OPTIONS = [
	{
		id: "team:release-crew",
		name: "Release Engineering",
		keywords: ["release-crew"],
	},
	{ id: "team:docs-pod", name: "docs-pod" },
];

test("a keyword keeps a row findable when its name is a human label", () => {
	// The label matches through the name, as it always did …
	assert.deepEqual(
		names(filterSearchableOptions(TEAM_OPTIONS, "release", "")),
		["Release Engineering"],
	);
	// … and the SLUG the row no longer shows matches through its keyword — the
	// full hyphenated key, and a fragment of it.
	assert.deepEqual(
		names(filterSearchableOptions(TEAM_OPTIONS, "release-crew", "")),
		["Release Engineering"],
	);
	assert.deepEqual(names(filterSearchableOptions(TEAM_OPTIONS, "crew", "")), [
		"Release Engineering",
	]);
	// A row without a keyword keeps matching by its name alone: the mechanism is
	// additive, not a rewrite of the rule.
	assert.deepEqual(names(filterSearchableOptions(TEAM_OPTIONS, "docs", "")), [
		"docs-pod",
	]);
	assert.deepEqual(filterSearchableOptions(TEAM_OPTIONS, "zzz", ""), []);
});

test("typing a row's exact keyword commits that row, not a copy of the text", () => {
	// The custom row is suppressed: the typed text IS the option's own term,
	// so the option's row is the typed value and offering a second row would
	// make the same choice twice.
	assert.equal(
		rowsFor(TEAM_OPTIONS, "release-crew").some((row) => row.kind === "custom"),
		false,
	);
	// Enter takes it — an exact keyword match wins over "first visible", the
	// same deliberate-act rule an exact NAME has always had.
	assert.deepEqual(enterFor(TEAM_OPTIONS, "release-crew"), {
		kind: "option",
		option: TEAM_OPTIONS[0],
	});
	// Text that matches no term still gets its own row, keyworded or not.
	assert.deepEqual(enterFor(TEAM_OPTIONS, "release-plz"), {
		kind: "custom",
		text: "release-plz",
	});
});
