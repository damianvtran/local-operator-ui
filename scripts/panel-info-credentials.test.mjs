/**
 * `/info`'s credential row: a host with NO credentials must say "none".
 *
 *     node --test scripts/panel-info-credentials.test.mjs
 *
 * Design round 3 (D19) found the value cell BLANK on a host with no stored
 * credentials. The row's own model computes `value: "none"` for an empty key
 * list, but the cell preferred `row.names` whenever it was set — and an EMPTY
 * ARRAY IS TRUTHY, so `[].join(", ")` won and the computed answer was never
 * reached. The rendered row said nothing at all where it meant to say "none",
 * which is the failure the panel set is otherwise careful about: "this row has
 * nothing to say" and "no credentials are recorded" must not read alike.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS SHAPED THIS WAY. The panel body is
 * portaled into `document.body` (`renderToStaticMarkup` returns an empty string
 * for it) and built inside `PickerHost`, so neither a static render nor an
 * element-tree walk reaches the cell, and this tree ships no DOM. Per the
 * discipline `picker-feedback.test.mjs` states — "the DECISIONS the component
 * runs are asserted on the same exported functions the component calls" — the
 * choice now lives in the exported `factValue`, and the test binds THAT,
 * together with the wiring that the cell calls it. A test written against the
 * model's rows instead would have stayed green through the entire bug, which is
 * exactly the shape this one exists to avoid.
 *
 * Colours are asserted as nothing at all: this file is about copy and about
 * which branch a row takes. Contrast and layout are the theme gates' and the
 * rendered frames' business (docs/evidence/panels-live/wire-environment).
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");

/*
 * The bundle is a real file under `node_modules/.cache` because a `data:` URL
 * cannot resolve a bare specifier; React stays external so the module under
 * test uses this process's React, as in `panel-chart-motion.test.mjs`.
 */
const CACHE = join(ROOT, "node_modules/.cache/panel-info-credentials");
const bundleInto = async (name, contents) => {
	const bundle = await build({
		stdin: { contents, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		jsx: "automatic",
		packages: "external",
		loader: { ".css": "empty" },
		alias: {
			"@shared": resolve("src/renderer/src/shared"),
			"@renderer": resolve("src/renderer/src"),
			"@features": resolve("src/renderer/src/features"),
		},
		write: false,
	});
	mkdirSync(CACHE, { recursive: true });
	const file = join(CACHE, `${name}.mjs`);
	writeFileSync(file, bundle.outputFiles[0].text);
	return import(pathToFileURL(file).href);
};

const PANEL = "src/renderer/src/features/chat/pickers/panels/info-panel.tsx";
const { factValue } = await bundleInto(
	"info-panel",
	`export { factValue } from "./${PANEL}";`,
);

test("a host with no stored credentials renders none, not a blank cell", () => {
	/*
	 * The regression, on the shipped function: the row `environmentRows`
	 * builds for a zero-credential host carries `names: []` and `value: "none"`.
	 * Before the fix this returned `{ text: "" }`.
	 */
	assert.deepEqual(
		factValue({ label: "Stored credentials", value: "none", names: [] }),
		{
			kind: "value",
			text: "none",
		},
	);
});

test("a host with stored credentials still lists every name", () => {
	assert.deepEqual(
		factValue({
			label: "Stored credentials",
			value: "2",
			names: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
		}),
		{ kind: "names", text: "ANTHROPIC_API_KEY, OPENAI_API_KEY" },
	);
});

test("a row with no names at all falls through to its computed value", () => {
	for (const row of [
		{ label: "Approval mode", value: "—" },
		{ label: "Started", value: "unknown", mono: true },
	]) {
		assert.equal(factValue(row).text, row.value);
		assert.equal(factValue(row).kind, "value");
	}
});

test("the cell takes its value from factValue, so the two cannot drift", () => {
	/*
	 * Pinned as source text for the reason `picker-feedback.test.mjs` pins its
	 * wiring: a bundle cannot reach which expression the cell renders, and a
	 * cell that stopped calling `factValue` would leave every assertion above
	 * green while the panel went back to a blank cell.
	 */
	const source = readFileSync(join(ROOT, PANEL), "utf8");
	assert.match(source, /const value = factValue\(row\);/);
	assert.match(source, /\{value\.text\}/);
	// The old truthiness test must not come back: `row.names` alone is the bug.
	assert.doesNotMatch(source, /row\.names \?/);
});
