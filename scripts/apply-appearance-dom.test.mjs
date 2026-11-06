/**
 * `applyAppearance`'s document writes, against a real DOM (jsdom), and the
 * palette-specific window glass paint that follows a composed theme.
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
 *  - Compositions retain native glass across contrast/accent/mode changes;
 *    actual values derive the floor, while inactive native state stays opaque.
 *
 * The real `resolveAppearance` is used for the honest paths; the hostile cases
 * inject a composition through `applyAppearance`'s test-only resolver, because
 * the engine cannot be made to produce one (that is the point of the guard).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
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
			'export { applyGlassFacts, syncGlassScheme } from "./src/renderer/src/shared/hooks/use-window-glass";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "cjs",
	packages: "external",
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
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	createRequire(import.meta.url),
	module,
	module.exports,
);
const mod = module.exports;

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

test("lane totality survives exact failing appearances, accent switches and direct slider neighbors", () => {
	const failures = [];
	const cases = [
		["mintLight", -100],
		["mintLight", -99],
		["linen", -50],
		["linen", -51],
		["linen", -49],
		["linen", 0],
		["linen", -1],
		["linen", 1],
		["localOperatorLight", 100],
		["localOperatorLight", 99],
	];
	for (const [themeName, contrast] of cases) {
		for (const accent of [
			{ kind: "theme" },
			{ kind: "palette", id: "radient" },
			{ kind: "custom", hex: "#ff6644" },
		]) {
			const appearance = {
				...STANDARD,
				themeName,
				contrast: { dark: contrast, light: contrast },
				accent: { dark: accent, light: accent },
			};
			mod.applyGlassFacts(null);
			mod.applyAppearance(appearance, doc);
			mod.syncGlassScheme(); // same-code off control must not throw
			try {
				mod.applyGlassFacts({
					mechanism: "vibrancy",
					coverage: "full",
					intensity: 100,
					material: "window",
					scheme: "light",
				});
				assert.equal(root.dataset.glass, "sidebar canvas pane");
				/* Keep active facts while switching to the next persisted appearance,
				 * exercising the exact provider layout-effect path, not just math. */
				mod.applyAppearance(
					{
						...appearance,
						contrast: {
							dark: contrast + (contrast < 100 ? 1 : -1),
							light: contrast + (contrast < 100 ? 1 : -1),
						},
					},
					doc,
				);
				mod.syncGlassScheme();
				assert.equal(root.dataset.glass, "sidebar canvas pane");
			} catch (error) {
				failures.push(
					`${themeName}/${contrast}/${JSON.stringify(accent)}: ${error.message}`,
				);
			}
		}
	}
	/* Preserve the borrowed accent across the actual UX sequence. An error
	 * during an intermediate layout effect must not be mistaken for a failure
	 * of only the final light/High palette. */
	const borrowed = { kind: "palette", id: "radient" };
	mod.applyGlassFacts(null);
	for (const [themeName, values] of [
		["localOperatorDark", [-100, -50, 0, 50, 100, 95]],
		["dracula", [95]],
		["localOperatorLight", [-100, -50, 0, 50, 100]],
	]) {
		for (const contrast of values) {
			try {
				mod.applyAppearance(
					{
						...STANDARD,
						themeName,
						contrast: { dark: contrast, light: contrast },
						accent: { dark: borrowed, light: borrowed },
					},
					doc,
				);
				mod.applyGlassFacts({
					mechanism: "vibrancy",
					coverage: "full",
					intensity: 100,
					material: "window",
					scheme: "light",
				});
				mod.syncGlassScheme();
				assert.equal(root.dataset.glass, "sidebar canvas pane");
			} catch (error) {
				failures.push(`UX sequence ${themeName}/${contrast}: ${error.message}`);
			}
		}
	}
	assert.deepEqual(
		failures,
		[],
		"every permitted switch must complete with active glass",
	);
});

test("glass follows actual composed colours across presets, continuous values, accents and restart", () => {
	for (const themeName of ["localOperatorDark", "localOperatorLight"]) {
		for (const contrast of [-100, -50, 0, 50, 100, -73, 31]) {
			const appearance = {
				...STANDARD,
				themeName,
				contrast: { dark: contrast, light: contrast },
			};
			mod.applyAppearance(appearance, doc);
			for (const intensity of [0, 50, 100]) {
				mod.applyGlassFacts({
					mechanism: "vibrancy",
					coverage: "full",
					intensity,
					material: "window",
					scheme: themeName.endsWith("Dark") ? "dark" : "light",
				});
				mod.syncGlassScheme();
				assert.equal(root.dataset.glass, "sidebar canvas pane");
				for (const role of ["canvas", "surface", "elevated"]) {
					const alpha = Number(
						root.style.getPropertyValue(`--lo-glass-a-${role}`),
					);
					assert.ok(
						alpha > 0 && alpha <= 1,
						`${themeName}/${contrast}/${intensity}/${role}: ${alpha}`,
					);
				}
			}
		}
		const custom = {
			...STANDARD,
			themeName,
			accent: {
				dark: { kind: "custom", hex: "#ff6644" },
				light: { kind: "custom", hex: "#ff6644" },
			},
		};
		const resolved = mod.applyAppearance(custom, doc);
		/* A custom palette need not carry the engine's lo-* ID prefix. */
		mod.applyAppearance(custom, doc, () => ({
			...resolved,
			identity: false,
			id: "arbitrary-custom-palette",
		}));
		mod.syncGlassScheme();
		assert.equal(root.dataset.glass, "sidebar canvas pane");
		mod.applyGlassFacts(null);
		assert.equal(
			root.dataset.glass,
			undefined,
			"off remains opaque for a composition",
		);
		mod.applyGlassFacts({
			mechanism: "vibrancy",
			coverage: "full",
			intensity: 80,
			material: "window",
			scheme: "dark",
		});
		mod.syncGlassScheme();
		assert.equal(
			root.dataset.glass,
			"sidebar canvas pane",
			"persisted launch facts restore composed glass",
		);
	}
	mod.applyAppearance(STANDARD, doc);
	mod.syncGlassScheme();
	assert.equal(
		root.dataset.glass,
		"sidebar canvas pane",
		"identity remains glass too",
	);
});
