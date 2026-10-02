import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OUTPUT_PATH, renderSources } from "./generate-geometry-sources.mjs";

/**
 * The gate over the derived page-function sources.
 *
 * Why this exists: `src/main/browser/actions/geometry-sources.gen.ts` carries
 * the text the host injects into the isolated world, and it is DERIVED state —
 * the vendored driver changing without a regenerate would mean the app runs one
 * version of the caps while the extension runs another, silently. The vendored
 * file itself is protected by `check-vendored`; this is the layer between it
 * and the strings the app actually dispatches.
 *
 * The comparison is a re-derivation, not a timestamp: the generator imports the
 * vendored file through the same transpiler the test bundle uses, so "fresh"
 * means "would be byte-identical if regenerated now". The negative case proves
 * the comparison has bite — a changed driver must change the derived text.
 */

test("the committed geometry sources are what the generator derives today", async () => {
	const { text, hash } = await renderSources();
	const onDisk = readFileSync(OUTPUT_PATH, "utf8");
	assert.equal(
		onDisk,
		text,
		"geometry-sources.gen.ts is stale: run `node scripts/generate-geometry-sources.mjs`",
	);
	assert.ok(
		onDisk.includes(hash),
		"the header names the driver hash this file was derived from",
	);
});

test("a changed driver changes the derived text (the check has bite)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "lo-geometry-sources-"));
	try {
		const driver = join(dir, "geometry-read.ts");
		// Same export NAMES, different bodies: what a drift would look like.
		writeFileSync(
			driver,
			[
				"export const readStyles = (selector, properties) => ({ count: 0 });",
				"export const hitTest = (x, y) => ({ count: 0 });",
				"export const ancestors = (selector, depth) => ({ count: 0 });",
				"",
			].join("\n"),
		);
		const { text } = await renderSources({ driver });
		assert.notEqual(
			text,
			readFileSync(OUTPUT_PATH, "utf8"),
			"a different driver must derive different text, or the check cannot see drift",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
