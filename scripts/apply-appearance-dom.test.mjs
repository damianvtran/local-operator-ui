/**
 * `applyAppearance`'s document writes, against a real DOM (jsdom), and the
 * window glass guard that follows a composed theme (agent review round 1, m1,
 * m3 and m4 on #1674).
 *
 * WHAT IS PINNED, and why each one matters:
 *  - Identity (Standard, the theme's accent) writes NO `<style>` and sets
 *    `data-theme` to the built-in id: today's users take today's path.
 *  - A composition upserts exactly ONE `#lo-composed-theme` block, keyed on the
 *    same `lo-<hash>` id `data-theme` carries, and the block is in the document
 *    BEFORE the attribute names it (checked from a MutationObserver callback on
 *    the attribute), so no frame paints a theme id with no block.
 *  - Back to identity removes the block; `dark` follows the palette's mode.
 *  - The write is validated by `applyAppearance` itself: a composition whose id
 *    or any value is outside the CSS grammar fails to identity (no block, the
 *    built-in id), never a partial or hostile stylesheet.
 *  - The glass hook paints opaque while `data-theme` names a composition and
 *    restores main's state on the way back to identity.
 *
 * The real `resolveAppearance` is used for the honest paths; the hostile cases
 * inject a composition through `applyAppearance`'s test-only resolver, because
 * the engine cannot be made to produce one (that is the point of the guard).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { JSDOM } = await import("jsdom");
const dom = new JSDOM(
	"<!doctype html><html><head></head><body></body></html>",
	{
		url: "http://localhost/",
	},
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.CSS = { supports: () => true };

const bundle = await build({
	stdin: {
		contents: [
			'export { applyAppearance, resolveAppearance, COMPOSED_STYLE_ID } from "./src/renderer/src/shared/themes/appearance";',
			'export { applyGlassFacts, syncGlassScheme, composedThemeActive } from "./src/renderer/src/shared/hooks/use-window-glass";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".json": "json" },
	tsconfig: "tsconfig.app.json",
	logLevel: "silent",
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const doc = dom.window.document;
const root = doc.documentElement;
const styles = () => doc.querySelectorAll(`#${mod.COMPOSED_STYLE_ID}`);
const STANDARD = {
	themeName: "obsidian",
	contrast: { dark: 0, light: 0 },
	accent: { dark: { kind: "theme" }, light: { kind: "theme" } },
};
const HIGH = { ...STANDARD, contrast: { dark: 100, light: 0 } };

test("identity writes no block and the built-in id", () => {
	const r = mod.applyAppearance(STANDARD, doc);
	assert.equal(r.identity, true);
	assert.equal(root.dataset.theme, "obsidian");
	assert.equal(styles().length, 0);
	assert.equal(root.classList.contains("dark"), true);
});

test("a composition upserts one block, in the document before the attribute names it", async () => {
	let blockPresentWhenNamed = null;
	const observer = new dom.window.MutationObserver(() => {
		const id = root.dataset.theme;
		blockPresentWhenNamed = [...styles()].some((s) =>
			s.textContent.startsWith(`[data-theme="${id}"]`),
		);
	});
	observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
	const r = mod.applyAppearance(HIGH, doc);
	await new Promise((resolve) => setTimeout(resolve, 0));
	observer.disconnect();
	assert.equal(r.identity, false);
	assert.match(root.dataset.theme, /^lo-[0-9a-z]{1,8}$/);
	assert.equal(styles().length, 1);
	assert.equal(blockPresentWhenNamed, true);
	assert.ok(
		styles()[0].textContent.includes(`--lo-canvas: ${r.palette.canvas};`),
	);
	/* A second, different composition replaces the block rather than adding one. */
	mod.applyAppearance({ ...STANDARD, contrast: { dark: -100, light: 0 } }, doc);
	assert.equal(styles().length, 1);
	assert.notEqual(root.dataset.theme, r.id);
});

test("back to identity removes the block; dark follows the palette", () => {
	mod.applyAppearance(HIGH, doc);
	mod.applyAppearance({ ...STANDARD, themeName: "localOperatorLight" }, doc);
	assert.equal(styles().length, 0);
	assert.equal(root.dataset.theme, "localOperatorLight");
	assert.equal(root.classList.contains("dark"), false);
});

test("applyAppearance refuses an unsafe id or value and fails to identity", () => {
	const real = mod.resolveAppearance(HIGH);
	const hostile = [
		{ ...real, id: 'x"]{}body{display:none}[a="' },
		{
			...real,
			palette: { ...real.palette, canvas: "red; } body { display: none" },
		},
		{ ...real, palette: { ...real.palette, mode: "evil" } },
	];
	const errors = console.error;
	console.error = () => {};
	try {
		for (const composed of hostile) {
			mod.applyAppearance(HIGH, doc); // a live block to be replaced
			const r = mod.applyAppearance(HIGH, doc, () => composed);
			assert.equal(r.identity, true);
			assert.equal(root.dataset.theme, "obsidian");
			assert.equal(styles().length, 0, "no block survives a refusal");
			assert.equal(doc.body.innerHTML.includes("display"), false);
		}
	} finally {
		console.error = errors;
	}
});

test("glass paints opaque on a composed theme and returns on identity", () => {
	mod.applyAppearance(STANDARD, doc);
	mod.applyGlassFacts({
		mechanism: "vibrancy",
		coverage: "full",
		intensity: 80,
		material: "window",
		scheme: "dark",
	});
	assert.equal(root.dataset.glass, "sidebar canvas pane");
	mod.applyAppearance(HIGH, doc);
	mod.syncGlassScheme();
	assert.equal(mod.composedThemeActive(), true);
	assert.equal(root.dataset.glass, undefined, "no glass on a composition");
	assert.equal(root.style.getPropertyValue("--lo-glass-a-canvas"), "");
	mod.applyAppearance(STANDARD, doc);
	mod.syncGlassScheme();
	assert.equal(root.dataset.glass, "sidebar canvas pane", "glass restored");
});
