import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * WHICH PAINTS KEEP THE TRANSCRIPT'S TOP ANCHOR.
 *
 * The rule in one sentence: a pane showing a CACHED FRAGMENT - stale, seeded
 * from an entry the cache could not keep whole - must not top-anchor, because
 * the page that replaces it is taller and the auto margin that centred the
 * fragment would resolve to zero at that moment, moving every row by the
 * pane's leftover height (measured at 200.6 px for the first visible row,
 * 212.6 px for the last, in one frame). Everything else keeps today's layout:
 * a live pane, and a cached paint that is the whole conversation (a genuinely
 * short conversation belongs at the top).
 *
 * WHAT THIS FILE PINS is the truth table of the pure decision the transcript
 * column reads, with no DOM and no React - the mount that consumes it is
 * `transcript-stale-paint-anchor.test.mjs`'s subject.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/paint-top-anchor";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
});
const { paintKeepsTopAnchor } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("a stale pane holding an incomplete paint drops the top anchor", () => {
	assert.equal(
		paintKeepsTopAnchor({ stale: true, complete: false, hasEntry: true }),
		false,
		"the fragment must sit where the page will leave it: bottom-packed",
	);
});

test("a stale pane holding the whole conversation keeps the top anchor", () => {
	assert.equal(
		paintKeepsTopAnchor({ stale: true, complete: true, hasEntry: true }),
		true,
		"a genuinely short conversation is top-aligned today, and a complete paint cannot jump because there is no page left to land",
	);
});

test("a stale flag with no cached entry behind it keeps the top anchor", () => {
	assert.equal(
		paintKeepsTopAnchor({ stale: true, complete: false, hasEntry: false }),
		true,
		"the anchor is only dropped for a fragment the cache actually handed the pane; a caller that sets `stale` without a paint has no rows to place",
	);
});

test("once the paint is no longer stale the anchor is the ordinary one", () => {
	for (const complete of [true, false]) {
		assert.equal(
			paintKeepsTopAnchor({ stale: false, complete, hasEntry: true }),
			true,
			"after the snapshot the rows are the owner's, and the column's own 'only while it fits' rule is the only anchor left",
		);
	}
});
