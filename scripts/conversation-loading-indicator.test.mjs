import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * The shared conversation-loading indicator, rendered (operator 2026-11-11:
 * "Give every conversation-loading case ... one consistent, clearly visible
 * loading indicator ... no layout shift or flicker").
 *
 * What this file owns: the component's own contract - every variant paints the
 * same two parts (an aria-hidden spinner and a visible label on its pill), the
 * announcing form is ONE named `<output>`, the non-announcing form carries no
 * live region, and a variant change re-uses the mounted element rather than
 * remounting it (a remount restarts the rotation and swaps the node under a
 * screen reader - the "flash" the request rules out). Where each case is wired
 * is asserted by `stale-caption.test.mjs` (cold, revalidating, remote in the
 * transcript) and `older-history-slot.test.mjs` (older, remote in the slot).
 *
 * jsdom for the remount case only: identity across renders is a DOM question,
 * so a server render cannot answer it. Layout is not claimed here.
 */

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bundle = await build({
	stdin: {
		contents:
			'export { ConversationLoadingIndicator } from "./src/renderer/src/features/chat/canonical/conversation-loading-indicator";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	// One React with the renderer this file mounts with.
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react-dom/server",
		"react/jsx-runtime",
	],
});
const bundlePath = new URL(
	"./_conversation-loading-indicator.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { createElement: h, act } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createRoot } = await import("react-dom/client");
const { ConversationLoadingIndicator } = await import(bundlePath.href);
await unlink(bundlePath);

const LABELS = {
	cold: "Loading conversation…",
	revalidating: "Checking for new messages…",
	older: "Loading earlier messages…",
	remote: "Syncing from your other device…",
};

for (const [variant, label] of Object.entries(LABELS)) {
	test(`${variant}: one named live region holding the spinner and the label`, () => {
		const html = renderToStaticMarkup(
			h(ConversationLoadingIndicator, { variant }),
		);
		assert.equal(html.match(/<output/g)?.length, 1, "exactly one live region");
		// Named only while nothing is painted: "Loading conversation" over rows the
		// reader can already see contradicts the screen, so the other variants are
		// unnamed and the status content (the label) is the statement (code review
		// round 1, C3).
		if (variant === "cold") {
			assert.match(html, /^<output aria-label="Loading conversation"/);
		} else {
			assert.match(html, /^<output data-lo-conversation-loading=/);
			assert.equal(html.includes("aria-label"), false, "no region name");
		}
		assert.match(html, new RegExp(`data-lo-conversation-loading="${variant}"`));
		// THE MARK is the shared Spinner ring, not a dot: a small accent dot
		// beside text read as presence, not loading (design review round 1,
		// D-M1). Exactly one ring, aria-hidden (the label is the announcement),
		// rotating, with the accent arc on the control track.
		const mark = html.match(
			/<span data-lo-loading-mark="true" class="[^"]*"><span aria-hidden="true" class="([^"]*)"><\/span><\/span>/,
		)?.[1];
		assert.ok(mark, "an aria-hidden spinner ring inside the mark");
		assert.equal(html.match(/animate-spin/g)?.length, 1, "exactly one ring");
		assert.match(mark, /(^| )animate-spin( |$)/);
		assert.match(mark, /(^| )border-control( |$)/);
		assert.match(mark, /(^| )border-t-accent( |$)/);
		assert.match(mark, /(^| )size-4( |$)/, "Spinner `sm`, 16px");
		// Forced colours flatten author borders to one system colour, which
		// would hide the arc; system colours survive there.
		assert.match(mark, /(^| )forced-colors:border-\[CanvasText\]( |$)/);
		assert.match(mark, /(^| )forced-colors:border-t-\[Highlight\]( |$)/);
		assert.equal(html.includes("lo-intent-pulse"), false, "no pulsing dot");
		assert.equal(html.includes("data-lo-loading-dot"), false);
		// THE PILL carries the label only - the spinner beside it keeps its track
		// on the slot's ground, where the contract holds it at 3:1. Translucent
		// accent tint, no border/shadow, and NO HEIGHT: no `py-*`, no `h-*`, no
		// `min-h-*`, so it stays one `text-meta` line and no slot grows.
		const pill = html.match(
			new RegExp(
				`<span data-lo-loading-pill="true" class="([^"]*)">${label}</span>`,
			),
		)?.[1];
		assert.ok(pill, "the label is the pill");
		assert.match(pill, /(^| )bg-accent\/10( |$)/);
		assert.match(pill, /(^| )rounded-full( |$)/);
		assert.match(pill, /(^| )px-2( |$)/);
		assert.match(pill, /(^| )text-ink-muted( |$)/);
		assert.match(pill, /(^| )text-meta( |$)/);
		assert.doesNotMatch(pill, /(^| )(py|pt|pb|p|h|min-h|leading)-/);
		assert.doesNotMatch(pill, /(^| )(border|shadow|ring)(-|$| )/);
		assert.equal(
			html.indexOf("data-lo-loading-mark") <
				html.indexOf("data-lo-loading-pill"),
			true,
			"spinner first, then the pill, in one row",
		);
	});
}

test("the non-announcing form is the same marks with no live region", () => {
	const html = renderToStaticMarkup(
		h(ConversationLoadingIndicator, { variant: "older", announce: false }),
	);
	assert.equal(html.includes("<output"), false);
	assert.equal(html.includes("aria-label"), false);
	assert.match(html, /^<span data-lo-conversation-loading="older"/);
	assert.match(html, /data-lo-loading-mark="true"/);
	assert.match(html, /data-lo-loading-pill="true"/);
	assert.ok(html.includes(LABELS.older));
});

test("the region's accessible name is the cold name only while cold", async () => {
	// The name a screen reader speaks on moving onto the region, read off the
	// mounted DOM as the variant changes in place: the cold name must not survive
	// into a state whose rows are painted, nor be missing when it returns.
	const container = document.getElementById("root");
	const root = createRoot(container);
	const names = {};
	for (const variant of ["cold", "revalidating", "remote", "cold"]) {
		await act(async () => {
			root.render(h(ConversationLoadingIndicator, { variant }));
		});
		const region = container.querySelector("output");
		names[variant] = region.getAttribute("aria-label");
		assert.equal(region.textContent, LABELS[variant], `${variant}: content`);
	}
	assert.deepEqual(names, {
		cold: "Loading conversation",
		revalidating: null,
		remote: null,
	});
	await act(async () => root.unmount());
});

test("a variant change updates the mounted element in place, never remounts it", async () => {
	const container = document.getElementById("root");
	const root = createRoot(container);
	await act(async () => {
		root.render(h(ConversationLoadingIndicator, { variant: "cold" }));
	});
	const region = container.querySelector("output");
	const mark = container.querySelector("[data-lo-loading-mark] > span");
	const pill = container.querySelector("[data-lo-loading-pill]");
	assert.equal(region.textContent, LABELS.cold);
	for (const variant of ["remote", "revalidating", "older"]) {
		await act(async () => {
			root.render(h(ConversationLoadingIndicator, { variant }));
		});
		assert.equal(
			container.querySelector("output"),
			region,
			`${variant}: same region node`,
		);
		assert.equal(
			container.querySelector("[data-lo-loading-mark] > span"),
			mark,
			`${variant}: same spinner node (its rotation does not restart)`,
		);
		assert.equal(
			container.querySelector("[data-lo-loading-pill]"),
			pill,
			`${variant}: same pill node`,
		);
		assert.equal(region.textContent, LABELS[variant]);
		assert.equal(region.dataset.loConversationLoading, variant);
	}
	await act(async () => root.unmount());
});
