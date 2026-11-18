import assert from "node:assert/strict";
import { test } from "node:test";

import { sidecarSchemaViolations } from "./context-parity.mjs";
import {
	normalizeEntry,
	retainedStrings,
	retentionFailures,
} from "./normalize-context.mjs";

/*
 * EXECUTABLE CONTRACT FOR THE ONE-OFF SIDECAR MIGRATION.
 *
 * Each case is a drift kind the desktop sidecars actually carried on
 * origin/main 58cbcea2 (census, 2026-11-17). For every one the normalized entry
 * must (a) pass the writer-side schema guard core's reader mirrors, and (b)
 * keep every original string verbatim — the migration may rename and fold,
 * never drop.
 */
const CASES = [
	[
		"length_hint alone",
		{ role: "r", length_hint: "short" },
		{ role: "r", length: "short" },
	],
	[
		"length_hint after a length",
		{ length: "one line", length_hint: "≤ 20 chars" },
		{ length: "one line; ≤ 20 chars" },
	],
	[
		"length_hint before a length keeps the first slot",
		{ length_hint: "≤ 20 chars", role: "r", length: "one line" },
		{ length: "one line; ≤ 20 chars", role: "r" },
	],
	[
		"empty length is not prefixed",
		{ length: "", length_hint: "x" },
		{ length: "x" },
	],
	[
		"params merge into placeholders",
		{ description: "d", params: { count: "n" } },
		{ note: "Description: d", placeholders: { count: "n" } },
	],
	[
		"plural / plural_guidance / select_guidance / context / placeholder fold into note",
		{
			note: "base",
			plural: "p",
			plural_guidance: "pg",
			select_guidance: "sg",
			context: "c",
			placeholder: "{name} is a name",
		},
		{
			note: "base. Plural: p. Plural: pg. Select: sg. Context: c. Placeholder: {name} is a name",
		},
	],
	[
		"a clause before the note keeps the note first",
		{ plural: "p", note: "base." },
		{ note: "base. Plural: p" },
	],
	[
		"note as an object flattens",
		{ note: { amount: "a currency amount" }, placeholders: {} },
		{ note: "amount: a currency amount", placeholders: {} },
	],
	["placeholders as an empty list", { placeholders: [] }, { placeholders: {} }],
	[
		"placeholders as a non-empty list becomes a note clause",
		{ note: "n", placeholders: ["count"] },
		{ note: "n. Placeholders: count", placeholders: {} },
	],
	["a bare string entry", "just a note", { note: "just a note" }],
	[
		"a [role, tone, note] list entry",
		["button label", "plain", "does a thing"],
		{ role: "button label", tone: "plain", note: "does a thing" },
	],
	[
		"an already-valid entry is unchanged",
		{ role: "r", tone: "t", note: "n", maxCells: 4, placeholders: { a: "b" } },
		{ role: "r", tone: "t", note: "n", maxCells: 4, placeholders: { a: "b" } },
	],
];

for (const [name, input, expected] of CASES) {
	test(`normalize: ${name}`, () => {
		const out = normalizeEntry(input);
		assert.deepEqual(out, expected);
		// Key order is part of the contract (diffs stay reviewable).
		assert.deepEqual(Object.keys(out), Object.keys(expected));
		assert.deepEqual(sidecarSchemaViolations("f", { k: out }), []);
		assert.deepEqual(retentionFailures("f", { k: input }, { k: out }), []);
	});
}

test("normalize: input is never mutated", () => {
	const input = { length: "a", length_hint: "b", params: { x: "y" } };
	const copy = structuredClone(input);
	normalizeEntry(input);
	assert.deepEqual(input, copy);
});

test("normalize: an entry kind with no lossless rule throws", () => {
	assert.throws(() => normalizeEntry(42));
	assert.throws(() => normalizeEntry(null));
});

test("retention: a dropped string is caught (counterfactual)", () => {
	const original = { k: { role: "r", plural: "keep me" } };
	assert.deepEqual(retentionFailures("f", original, { k: { role: "r" } }), [
		"f: k: original string #1 not retained",
	]);
	assert.deepEqual(
		retentionFailures("f", original, { j: { role: "r", note: "keep me" } }),
		["f: key set or key order changed"],
	);
	// Field names are not content; nested placeholder names are.
	assert.deepEqual(retainedStrings({ params: { count: "n" } }), ["count", "n"]);
});
