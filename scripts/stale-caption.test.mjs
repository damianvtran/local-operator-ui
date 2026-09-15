import assert from "node:assert/strict";
import { test } from "node:test";
import { unlink, writeFile } from "node:fs/promises";
import { build } from "esbuild";

/*
 * The cached-paint caption, asserted as RENDERED MARKUP.
 *
 * WHY THIS FILE EXISTS (design review round 2, D10). Hoisting the caption out of
 * the scroll box so it survives a transcript taller than its pane (D1) left the
 * old in-scroll paragraph behind, so a cached paint rendered the same sentence
 * twice on every short pane: once pinned to the pane's top edge, once
 * immediately above the first bubble. A long transcript hid the second copy above
 * the fold — which is exactly why the overflowing fixture passed while the
 * ordinary and narrow ones regressed, and why "the frames look right" was not
 * evidence about this.
 *
 * A COUNT is the assertion, because the defect was a duplicate rather than a
 * wrong string: `markup.match(/the caption/g).length === 1`. It is rendered from
 * the SHIPPED `CanonicalTranscript` with `renderToStaticMarkup` — no jsdom, the
 * same instrument `ask-options.test.mjs` uses for the answer card — so it fails
 * on the component that ships rather than on a transcription of it, and it needs
 * no browser: the duplication is in the element tree, not in a scroll position.
 *
 * The second case keeps the D1 half honest. A fix for a duplicate that moved the
 * caption BACK inside the scroller would satisfy the count and reintroduce the
 * off-screen defect, so the caption's position relative to the scroll box is
 * asserted too — the caption must PRECEDE the element that scrolls.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
			'export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	jsx: "automatic",
	// React stays EXTERNAL so the bundle shares ONE copy with this file's own
	// imports — two copies give the component a different dispatcher than the
	// server renderer and every render throws on an invalid hook call.
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});

const bundlePath = new URL("./_stale-caption.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { CanonicalTranscript, EMPTY_TRANSCRIPT } = await import(bundlePath.href);
// Unlinked as soon as the graph is evaluated, so no build artifact survives a
// crash mid-run and none can be committed by accident — the same rule, and the
// same reason, as `ask-options.test.mjs`.
await unlink(bundlePath);

const CAPTION = "Showing the last saved view — checking for newer messages.";

/**
 * The pane in the state under test.
 *
 * `hydrated: true` so the pane is not holding its placeholder (the caption and
 * the loading state are different claims), and `missing: false` so the
 * conversation-gone branch, which replaces the whole status block, is not the
 * one taken.
 */
function renderPane({ stale, missing = false }) {
	return renderToStaticMarkup(
		createElement(CanonicalTranscript, {
			transcript: EMPTY_TRANSCRIPT,
			gate: null,
			waiting: false,
			loadingOlder: false,
			onLoadOlder: async () => true,
			containerRef: { current: null },
			isSmallView: false,
			status: "live",
			hydrated: true,
			stale,
			missing,
			error: null,
			onAnswer: () => {},
		}),
	);
}

const count = (markup) => markup.split(CAPTION).length - 1;

test("a cached paint states the caption exactly once", () => {
	const markup = renderPane({ stale: true });
	assert.equal(
		count(markup),
		1,
		"the caption is rendered twice: the hoisted copy and the legacy in-scroll one (design round 2, D10)",
	);
});

test("an authoritative paint states no caption at all", () => {
	// The control, so the count above is a fact about the duplication rather than
	// about the string happening to appear once for another reason.
	assert.equal(count(renderPane({ stale: false })), 0);
});

test("the caption sits OUTSIDE the element that scrolls", () => {
	// D1's half, kept beside D10's so a fix for the duplicate cannot be made by
	// moving the caption back inside the scroller — where a transcript taller than
	// its pane scrolls it off screen, which is the defect the hoist removed.
	const markup = renderPane({ stale: true });
	const captionAt = markup.indexOf(CAPTION);
	const scrollerAt = markup.indexOf("data-lo-canonical-transcript");
	assert.ok(captionAt >= 0, "the caption is painted");
	assert.ok(scrollerAt >= 0, "the scroll box is painted");
	assert.ok(
		captionAt < scrollerAt,
		"the caption is inside the scroll box again, so it scrolls away",
	);
});
