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
 * same two parts (an aria-hidden pulsing dot and a visible label), the
 * announcing form is ONE named `<output>`, the non-announcing form carries no
 * live region, and a variant change re-uses the mounted element rather than
 * remounting it (a remount restarts the pulse and swaps the node under a
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
	test(`${variant}: one named live region holding the dot and the label`, () => {
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
		const dot = html.match(
			/<span aria-hidden="true" data-lo-loading-dot="true" class="([^"]*)"/,
		)?.[1];
		assert.ok(dot, "an aria-hidden dot");
		// Opacity-only liveness on the accent role (branding § 2 / § 3): never a
		// hex, never a layout property. `lo-intent-pulse` holds its trough at
		// 0.75, where `accent` still clears 3:1 on every palette; the skeleton's
		// `animate-pulse-visible` dips to 0.7, under it on eight light ones
		// (design review round 1, D1).
		assert.match(dot, /(^| )lo-intent-pulse( |$)/);
		assert.doesNotMatch(dot, /animate-pulse/);
		assert.match(dot, /(^| )bg-accent( |$)/);
		// Forced colours drop background colours; every accent status dot
		// repaints in `CanvasText` (design review round 1, D3).
		assert.match(dot, /(^| )forced-colors:bg-\[CanvasText\]( |$)/);
		assert.match(dot, /rounded-full/);
		assert.match(
			html,
			new RegExp(
				`<span class="[^"]*text-ink-muted[^"]*text-meta[^"]*">${label}</span>`,
			),
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
	assert.match(html, /data-lo-loading-dot="true"/);
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
	const dot = container.querySelector("[data-lo-loading-dot]");
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
			container.querySelector("[data-lo-loading-dot]"),
			dot,
			`${variant}: same dot node`,
		);
		assert.equal(region.textContent, LABELS[variant]);
		assert.equal(region.dataset.loConversationLoading, variant);
	}
	await act(async () => root.unmount());
});
