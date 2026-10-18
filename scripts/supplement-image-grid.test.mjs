/**
 * The image grid's disposition contract, asked of the SHIPPED tile.
 *
 * WHAT THIS FILE IS FOR (agent review round 1, R1): an image-kind callout has
 * THREE dispositions, and only two of the visible arms are states a frame can
 * name — the thumbnail and the glyph receipt; the reserved box is the loading
 * arm. The defect the round measured was a fourth, unintended one: the thumbnail
 * hook's INITIAL state is `loading` and a DISABLED read never leaves it, so a
 * tile whose probe resolves to no absolute target sat on the reserved box
 * forever while the module's own contract promised the receipt. The classes this
 * pins, one mount each:
 *
 *  - an unresolvable probe (a non-absolute `resolved`) -> the glyph receipt;
 *  - a probe that throws                              -> the glyph receipt;
 *  - a probe still in flight                          -> the reserved box with
 *    NO receipt: the receipt must not be a flash for a pending read;
 *  - a resolved path whose read is REFUSED            -> the glyph receipt (the
 *    pipeline's own `unavailable`, exercised through the real queue with only
 *    `readFileBytes` stubbed).
 *
 * WHY A MOUNT AND NOT STATIC MARKUP (the row suite's own reading, one file
 * over): every transition above happens in effects - the probe and the shared
 * queue's drain - so a static render can only ever see the initial
 * probe-pending arm. The READY arm (bytes decoded into a picture) needs a
 * decoder JSDOM does not have; it is the storybook frames' question and the
 * pipeline's own tests' question, not this file's.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";

const ROOT = process.cwd();
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
/*
 * The same synthetic-DOM surface the file-actions suite mounts under: the
 * shipped modules this bundle pulls reach for these globals at import time
 * (the persisted stores' storage, React's scheduler, the view hook's fail-open
 * reading of `IntersectionObserver`).
 */
for (const key of [
	"window",
	"document",
	"localStorage",
	"sessionStorage",
	"navigator",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"MutationObserver",
	"MouseEvent",
	"KeyboardEvent",
	"Event",
	"CustomEvent",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
]) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key],
	});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

const bundle = await build({
	mainFields: ["module", "main"],
	conditions: ["import"],
	stdin: {
		contents:
			'export { SupplementImageGrid } from "./src/renderer/src/features/chat/canonical/supplement-image-grid";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_supplement-image-grid-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(async () => {
	await unlink(bundlePath);
});
const { SupplementImageGrid } = await import(bundlePath.href);

const FILE = {
	path: "renders/one.png",
	name: "one.png",
	kind: "image",
	sizeBytes: 1024,
	mtime: 1_790_999_940,
	why: "written by write",
};

const settle = async (host) => {
	/*
	 * The probe resolves on a microtask and the queue's drain is one more; a
	 * bounded act-poll reads the OUTCOME rather than sleeping a fixed span.
	 */
	for (let attempt = 0; attempt < 100; attempt++) {
		if (
			host.querySelector("[data-supplement-image-fallback]") ||
			host.querySelector("img")
		)
			return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
	}
};

const mountTile = async ({ probe, read }) => {
	window.api = { ...(window.api ?? {}), probeFiles: probe };
	if (read) window.api.readFileBytes = read;
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () =>
		root.render(
			h(SupplementImageGrid, {
				files: [FILE],
				cwd: "/synthetic/cwd",
				pane: null,
			}),
		),
	);
	return { host, root };
};

const unmount = async ({ host, root }) => {
	await act(async () => root.unmount());
	host.remove();
};

test("an unresolvable path ends on the glyph receipt, never an empty box (R1)", async () => {
	const mounted = await mountTile({
		probe: async () => [
			{
				input: FILE.path,
				resolved: FILE.path,
				exists: false,
				isFile: false,
				sizeBytes: null,
				mtimeMs: null,
			},
		],
	});
	await settle(mounted.host);
	const receipt = mounted.host.querySelector(
		"[data-supplement-image-fallback]",
	);
	assert.ok(
		receipt,
		"the unresolvable tile must fall to the glyph receipt - the reserved box is not a terminal state",
	);
	assert.equal(mounted.host.querySelector("img"), null);
	await unmount(mounted);
});

test("a probe that throws ends on the glyph receipt too", async () => {
	const mounted = await mountTile({
		probe: async () => {
			throw new Error("synthetic probe failure");
		},
	});
	await settle(mounted.host);
	assert.ok(
		mounted.host.querySelector("[data-supplement-image-fallback]"),
		"a refused probe resolves to no target and must read as the receipt",
	);
	await unmount(mounted);
});

test("a probe still in flight keeps the reserved box, with no receipt", async () => {
	const mounted = await mountTile({
		probe: () => new Promise(() => {}),
	});
	await settle(mounted.host);
	assert.equal(
		mounted.host.querySelector("[data-supplement-image-fallback]"),
		null,
		"the receipt must not be a flash for a pending read",
	);
	assert.equal(mounted.host.querySelector("img"), null);
	await unmount(mounted);
});

test("a resolved path whose read is refused ends on the glyph receipt", async () => {
	const mounted = await mountTile({
		probe: async () => [
			{
				input: FILE.path,
				resolved: `/synthetic/cwd/${FILE.path}`,
				exists: true,
				isFile: true,
				sizeBytes: FILE.sizeBytes,
				mtimeMs: FILE.mtime * 1000,
			},
		],
		read: async () => ({
			success: false,
			code: "read_failed",
			error: "synthetic refusal",
			sizeBytes: 0,
		}),
	});
	await settle(mounted.host);
	assert.ok(
		mounted.host.querySelector("[data-supplement-image-fallback]"),
		"a refused read is the pipeline's own unavailable state and must read as the receipt",
	);
	await unmount(mounted);
});
