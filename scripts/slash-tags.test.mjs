import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * `/tag`'s row rules, executed as the code the app ships.
 *
 * This suite covers the half that can be decided without React: the local
 * command row, the applied-first order, membership/primary row shaping, the
 * explicit create row and its caps, the pick's action, and the promise that a
 * backend without the tag store is served exactly the registry it had before.
 *
 * The component wiring is covered where it lives: `slash-contract.test.mjs`
 * owns the keyboard gate this suite reuses (`slashRunAllowed`), and the merged
 * tag dialog suite owns the assignment hook's writes (`test:tag-dialogs`).
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/components/slash-argument-rows";',
			'export * from "./src/renderer/src/features/chat/components/slash-local-commands";',
			'export { slashRunAllowed } from "./src/renderer/src/features/chat/components/slash-contract";',
			'export { matchChoices } from "./src/renderer/src/features/chat/components/slash-rank";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	// `slash-argument-rows` reaches the renderer's shared provider catalogue.
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	write: false,
});
const {
	appliedFirstTagIds,
	argumentRows,
	effectiveInlineArgument,
	freezeTagOrder,
	matchChoices,
	slashRunAllowed,
	tagArgumentRows,
	tagCreateRow,
	tagPickAction,
	TAG_INLINE_ARGUMENT,
	withTagCommand,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const tag = (id, name) => ({ id, name });
const categories = [
	tag("t-a", "Alpha"),
	tag("t-b", "Beta"),
	tag("t-c", "Gamma"),
];

test("/tag is appended only when the tag store and a conversation apply", () => {
	const base = [
		{
			name: "model",
			description: "Model",
			aliases: [],
			arguments: "optional",
			echo: true,
			consumes_prompt: false,
			destination: "session.model",
			execution: "native",
		},
	];
	const withTag = withTagCommand(base, true, "Tags");
	assert.equal(withTag.length, 2);
	assert.deepEqual(withTag[0], base[0], "the backend row is not rewritten");
	const command = withTag[1];
	assert.equal(command.name, "tag");
	assert.equal(command.destination, "session.tags");
	assert.equal(command.arguments, "optional");
	assert.equal(command.argument_shape, "any");
	assert.equal(command.prefixes_text, true);
	assert.equal(command.execution, "native");

	// A backend without `session_tags` must receive the same array, not a copy:
	// every memo keyed on the registry keeps its identity.
	assert.equal(withTagCommand(base, false, "Tags"), base);
});

test("a backend catalogue row for the destination wins over the local one", () => {
	const backendRow = {
		name: "tag",
		description: "Tags",
		aliases: [],
		arguments: "optional",
		echo: true,
		consumes_prompt: false,
		destination: "session.tags",
		execution: "native",
	};
	const base = [backendRow];
	assert.equal(withTagCommand(base, true, "Tags"), base);
});

test("applied rows come first, registry order inside each partition", () => {
	// Beta and Gamma are applied: Beta keeps its registry place before Gamma,
	// and Alpha follows them. A selected id the registry no longer has cannot
	// reorder anything.
	assert.deepEqual(appliedFirstTagIds(categories, ["t-c", "t-b", "gone"]), [
		"t-b",
		"t-c",
		"t-a",
	]);
	assert.deepEqual(appliedFirstTagIds(categories, []), ["t-a", "t-b", "t-c"]);
});

test("two toggles over refetched registries keep the frozen order", () => {
	// Every successful assignment refetches the registry and the store installs
	// a FRESH array for identical content. The order must not re-partition under
	// the cursor across those refetches (review round 1, F1).
	const frozen = freezeTagOrder(null, "s-1", categories, []);
	assert.deepEqual(frozen.order, ["t-a", "t-b", "t-c"]);

	// First toggle: Beta applied; the refetch is an equal-content new array.
	const firstRefetch = categories.map((entry) => ({ ...entry }));
	const first = freezeTagOrder(frozen, "s-1", firstRefetch, ["t-b"]);
	assert.equal(first, frozen, "identical content keeps the frozen object");
	assert.deepEqual(first.order, ["t-a", "t-b", "t-c"]);
	assert.deepEqual(
		appliedFirstTagIds(firstRefetch, ["t-b"]),
		["t-b", "t-a", "t-c"],
		"the recomputation this freeze replaces would have moved the cursor",
	);

	// Second toggle: Gamma applied; another fresh array for the same content.
	const secondRefetch = categories.map((entry) => ({ ...entry }));
	const second = freezeTagOrder(first, "s-1", secondRefetch, ["t-b", "t-c"]);
	assert.deepEqual(second.order, ["t-a", "t-b", "t-c"]);
});

test("a reordered registry or another conversation re-partitions", () => {
	const frozen = freezeTagOrder(null, "s-1", categories, []);
	// A genuine content change: the registry's own order moved (a tag created,
	// deleted or reordered), so the signature changes and the list is rebuilt.
	const reordered = [categories[2], categories[0], categories[1]];
	assert.deepEqual(freezeTagOrder(frozen, "s-1", reordered, []).order, [
		"t-c",
		"t-a",
		"t-b",
	]);
	// Another conversation is a different scope even with the same registry.
	assert.notEqual(
		freezeTagOrder(frozen, "s-2", categories, []).signature,
		frozen.signature,
	);
});

test("rows carry membership, primary and a stable id", () => {
	const order = appliedFirstTagIds(categories, ["t-b"]);
	const rows = tagArgumentRows(categories, ["t-b"], "t-b", order);
	assert.deepEqual(
		rows.map((row) => [row.value, row.tagId, row.applied, row.primary]),
		[
			["Beta", "t-b", true, true],
			["Alpha", "t-a", false, false],
			["Gamma", "t-c", false, false],
		],
	);
});

test("a category added while the list is open is appended, not dropped", () => {
	const order = ["t-a"];
	const rows = tagArgumentRows(
		[...categories, tag("t-d", "Delta")],
		[],
		null,
		order,
	);
	assert.deepEqual(
		rows.map((row) => row.value),
		["Alpha", "Beta", "Gamma", "Delta"],
	);
});

test("the create row is offered only for a valid, novel, uncapped name", () => {
	const row = tagCreateRow(categories, [], "Work", "Create Work", "Shared");
	assert.equal(row?.value, "Work");
	assert.equal(row?.create, true);
	assert.equal(row?.name, "Create Work");

	// Existing names, case-insensitively, always win.
	assert.equal(tagCreateRow(categories, [], "alpha", "c", "d"), null);
	// Store-consistent validation and caps.
	assert.equal(tagCreateRow(categories, [], "  ", "c", "d"), null);
	assert.equal(tagCreateRow(categories, [], "untagged", "c", "d"), null);
	assert.equal(tagCreateRow(categories, [], "x".repeat(25), "c", "d"), null);
	assert.equal(
		tagCreateRow(
			Array.from({ length: 32 }, (_, index) => tag(`t-${index}`, `T${index}`)),
			[],
			"New",
			"c",
			"d",
		),
		null,
	);
	assert.equal(
		tagCreateRow(
			categories,
			["t-a", "t-b", "t-c", "t-1", "t-2", "t-3", "t-4", "t-5"],
			"New",
			"c",
			"d",
		),
		null,
	);
});

test("a pick toggles or creates only when the run gate says so", () => {
	const existing = tagArgumentRows(categories, [], null, ["t-a"])[0];
	assert.equal(tagPickAction(existing, false), "complete");
	assert.equal(tagPickAction(existing, true), "toggle");
	assert.equal(
		tagPickAction({ value: "New", name: "Create New", create: true }, true),
		"create",
	);
	// A malformed row cannot become a mutation.
	assert.equal(
		tagPickAction({ value: "Orphan", name: "Orphan" }, true),
		"none",
	);
});

test("filtering keeps the applied state on the surviving row", () => {
	const rows = tagArgumentRows(categories, ["t-b"], null, [
		"t-a",
		"t-b",
		"t-c",
	]);
	const matched = matchChoices("bet", rows).map((entry) => entry.choice);
	assert.equal(matched.length, 1);
	assert.equal(matched[0].value, "Beta");
	assert.equal(matched[0].applied, true);
	assert.equal(matched[0].primary, false);
	assert.deepEqual(matchChoices("zzz", rows), []);
});

test("the tag list's own inline declaration runs and needs the capability", () => {
	const inline = TAG_INLINE_ARGUMENT;
	// The `requires` field is additive: a backend that advertises the store
	// keeps the list, and one that does not drops it before any fetch.
	assert.deepEqual(
		effectiveInlineArgument(inline, {
			desktop_available: true,
			features: { session_tags: 1 },
		}),
		inline,
	);
	assert.equal(
		effectiveInlineArgument(inline, {
			desktop_available: true,
			features: { session_tags: 0 },
		}),
		undefined,
	);
});

test("the generic argument lists are unchanged by the new source", () => {
	const themes = [
		{ value: "dune", name: "Dune", description: "Sand" },
		{ value: "salt", name: "Salt", description: "Bright" },
	];
	assert.deepEqual(argumentRows("theme", themes, "dune"), [
		{ value: "dune", name: "Dune", description: "Sand", current: true },
		{ value: "salt", name: "Salt", description: "Bright", current: false },
	]);
	// The tag source has no generic shape: its rows carry membership and order
	// and are shaped by `tagArgumentRows` only.
	assert.deepEqual(argumentRows("session-tags", themes, null), []);
});

test("the shared run gate still refuses an implicit fuzzy survivor", () => {
	const rows = tagArgumentRows(categories, [], null, ["t-a", "t-b", "t-c"]);
	const [alpha, beta] = rows;
	const gate = (row, query, total, chosenByHand = false) =>
		slashRunAllowed({
			argumentQuery: query,
			value: row.value,
			total,
			destructive: false,
			chosenByHand,
		});
	assert.equal(gate(alpha, "alp", 1), true, "a single survivor");
	assert.equal(gate(beta, "alp", 2), false, "ambiguous, so Enter completes");
	assert.equal(gate(beta, "beta", 2), true, "the typed value names the row");
	assert.equal(
		gate(beta, "bet", 2),
		false,
		"a partial spelling of a two-row list completes",
	);
	assert.equal(gate(alpha, "", 3), false, "an empty query never runs");
	assert.equal(
		gate(beta, "alp", 3, true),
		true,
		"an explicit arrow move arms the row",
	);
});
