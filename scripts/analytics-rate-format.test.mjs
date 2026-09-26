/**
 * The tokens-per-second formatting rules, executable.
 *
 *     node --test scripts/analytics-rate-format.test.mjs
 *
 * These are the rules no frame can put on trial. A still image shows one row at
 * one rate; it cannot show that `—` and `0.0` are different answers, that a real
 * sub-tenth rate is not rounded into the stopped reading, or where the scaling
 * boundary sits. The analytics pane's `/usage`-style surfaces are covered by
 * stories and evidence frames, which is why the CELLS are judged there — but the
 * two-sided decimal rule and the unknown-versus-zero split are decisions, and
 * review round 1 on this repository's analytics PR found them unpinned (and, at
 * the bottom of the range, wrong: a genuine 0.0333 tok/s printed `0.0 tok/s`,
 * which is the stopped reading the rule exists to avoid).
 *
 * The module is BUNDLED in memory rather than re-implemented, the same way
 * `analytics-session-table.test.mjs` does it, so this suite fails when the
 * shipped function changes and not when a copy of it does.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/pickers/panels/formatters";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { UNKNOWN, formatTokensPerSecond, tokensPerSecond } = mod;

test("a rate with no samples is UNKNOWN, and a measured zero is not", () => {
	// The count is what disambiguates: no contributing calls means no rate, while
	// a call that really decoded at nothing is a measurement and prints as one.
	assert.equal(tokensPerSecond(0, 0, 0), null);
	assert.equal(tokensPerSecond(100, 0, 1), null);
	assert.equal(formatTokensPerSecond(null), UNKNOWN);
	assert.equal(formatTokensPerSecond(undefined), UNKNOWN);
	assert.equal(formatTokensPerSecond(0), "0.0 tok/s");
	assert.notEqual(formatTokensPerSecond(0), UNKNOWN);
});

test("a positive rate below the tenth boundary is not rounded into a stop", () => {
	// The trap one decimal below the docstring's own example: 1 token over a 30 s
	// window is 0.0333 tok/s, which toFixed(1) renders as `0.0 tok/s` — i.e. it
	// presents a slow call as a stopped one.
	assert.equal(
		formatTokensPerSecond(tokensPerSecond(1, 30_000_000, 1)),
		"<0.1 tok/s",
	);
	assert.equal(formatTokensPerSecond(0.049), "<0.1 tok/s");
	// At the boundary the ordinary spelling takes over, so the two rules meet
	// rather than overlapping.
	// `0.05` is the case a threshold misses: round-half-even sends its tenth to
	// `0.0`, so the guard tests the ROUNDED value rather than a hand-picked cut.
	assert.equal(formatTokensPerSecond(0.05), "<0.1 tok/s");
	assert.equal(formatTokensPerSecond(0.06), "0.1 tok/s");
	assert.equal(formatTokensPerSecond(0.4), "0.4 tok/s");
});

test("below ten keeps one decimal; at ten and above it is a whole count", () => {
	assert.equal(formatTokensPerSecond(9.94), "9.9 tok/s");
	assert.equal(formatTokensPerSecond(62.5), "62 tok/s");
	assert.equal(formatTokensPerSecond(1240), "1,240 tok/s");
	// Grouped digits, NOT a scale suffix: this pane deliberately prints `1,240`
	// where the TUI prints `1.2k`, and the difference is recorded on the PR rather
	// than quietly harmonised — the two surfaces have their own conventions.
	assert.equal(formatTokensPerSecond(12_400), "12,400 tok/s");
});

test("every value in the domain prints a string, and none of them is numeric", () => {
	// Totality matters because this string is dropped straight into a table cell:
	// a formatter that could throw or return a number would render `NaN` in the
	// one column this feature exists to show.
	for (const value of [null, undefined, 0, 0.0001, 0.05, 9.99, 10, 999, 1e9]) {
		const printed = formatTokensPerSecond(value);
		assert.equal(typeof printed, "string");
		assert.ok(printed.endsWith("tok/s") || printed === UNKNOWN, printed);
	}
});
