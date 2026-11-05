/** Real React/store/provider regressions for the layered picker. jsdom is a
 * focus/event instrument, not rendered/native evidence; Storybook owns pixels. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const PREVIEW_BLOCK = /data-theme="lo-preview"/;
const CEILING_HINT = /already as bright as it can go/;
const BORROWED_NOTICE = /Accent: Tokyo Night Day/;
const dom = new JSDOM(
	"<!doctype html><html><head></head><body></body></html>",
	{ url: "http://localhost/" },
);
for (const key of [
	"window",
	"document",
	"HTMLElement",
	"HTMLInputElement",
	"Element",
	"DOMRect",
	"Node",
	"MutationObserver",
	"CustomEvent",
	"Event",
	"MouseEvent",
	"KeyboardEvent",
	"localStorage",
	"getComputedStyle",
])
	globalThis[key] =
		key === "getComputedStyle"
			? dom.window.getComputedStyle.bind(dom.window)
			: dom.window[key];
Object.defineProperty(globalThis, "navigator", {
	value: dom.window.navigator,
	configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.CSS = { supports: () => true };
HTMLElement.prototype.scrollIntoView = () => {};
HTMLElement.prototype.getBoundingClientRect = () =>
	new dom.window.DOMRect(0, 0, 100, 30);
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.setPointerCapture = () => {};
HTMLElement.prototype.releasePointerCapture = () => {};
let frames = [];
globalThis.requestAnimationFrame = window.requestAnimationFrame = (cb) => {
	frames.push(cb);
	return frames.length;
};
globalThis.cancelAnimationFrame = window.cancelAnimationFrame = () => {};
const bundle = await build({
	stdin: {
		contents: `
 export { previewGlassPaint } from './src/renderer/src/features/settings/components/appearance-preview-glass';
 export { applyGlassState } from './src/renderer/src/shared/hooks/use-window-glass';
 export { glassPaintFor } from './src/shared/window-glass';
 export { glassFloorsForPalette } from './src/shared/glass-derivation.mjs';
 export { contrastCandidate } from './src/shared/theme-engine/contrast.mjs';
 export { createElement, act } from 'react';
 export { createRoot } from 'react-dom/client';
 export { AppearanceLayers } from './src/renderer/src/features/settings/components/appearance-layers';
 export { ThemeProvider } from './src/renderer/src/shared/themes/theme-provider';
 export { useUiPreferencesStore as store } from './src/renderer/src/shared/store/ui-preferences-store';
 export { captureTheme, applyCaptureTheme } from './src/renderer/src/shared/themes/terminal-theme';
 export { resolveAppearance } from './src/renderer/src/shared/themes/appearance';`,
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	// DOM contracts do not claim CSS/pixel validation; the browser loads this sheet.
	loader: { ".css": "empty" },
	packages: "external",
	format: "cjs",
	platform: "node",
	write: false,
	define: { "import.meta.env": "{}" },
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@renderer": `${process.cwd()}/src/renderer/src`,
	},
	tsconfig: "tsconfig.app.json",
	logLevel: "silent",
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	createRequire(import.meta.url),
	module,
	module.exports,
);
const {
	createElement: h,
	act,
	createRoot,
	AppearanceLayers,
	ThemeProvider,
	store,
	captureTheme,
	applyCaptureTheme,
	resolveAppearance,
	previewGlassPaint,
	applyGlassState,
	glassPaintFor,
	glassFloorsForPalette,
	contrastCandidate,
} = module.exports;
const frame = async () => {
	const pending = frames;
	frames = [];
	await act(async () => {
		for (const cb of pending) cb(0);
	});
};
const fire = async (target, event) => {
	await act(async () => {
		target.dispatchEvent(event);
	});
};
const key = (target, name, extras = {}) =>
	fire(
		target,
		new KeyboardEvent("keydown", { key: name, bubbles: true, ...extras }),
	);
const input = async (target, value) => {
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
		target,
		value,
	);
	await fire(target, new Event("input", { bubbles: true }));
	await fire(target, new Event("change", { bubbles: true }));
};
const findButton = (text) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent.trim() === text,
	);
let root;
async function mount(themeName = "obsidian", contrast = 0, glass = null) {
	if (root) await act(async () => root.unmount());
	frames = [];
	document.body.innerHTML = '<div id="test-root"></div>';
	store.setState({
		themeName,
		contrast: { dark: contrast, light: contrast },
		accent: { dark: { kind: "theme" }, light: { kind: "theme" } },
		customAccents: ["#2563EB"],
		customAccentNames: {},
	});
	root = createRoot(document.getElementById("test-root"));
	await act(async () =>
		root.render(
			h(
				ThemeProvider,
				null,
				h(AppearanceLayers, { gallery: h("div", null, "Gallery"), glass }),
			),
		),
	);
}

const activeGlass = {
	active: true,
	restartRequired: false,
	capability: { supported: true, mechanism: "vibrancy" },
	settings: {
		enabled: true,
		coverage: "full",
		intensity: 100,
		material: "window",
	},
};

test("preview glass reuses production palette floors, not document alphas or saved enablement", () => {
	const palette = resolveAppearance(store.getState()).palette;
	const expected = glassPaintFor({
		...activeGlass.settings,
		mechanism: "vibrancy",
		scheme: palette.mode,
		floors: glassFloorsForPalette(palette),
	});
	assert.deepEqual(previewGlassPaint(activeGlass, palette), expected);
	assert.equal(previewGlassPaint(null, palette), null);
	assert.equal(
		previewGlassPaint({ ...activeGlass, active: false }, palette),
		null,
	);
	assert.equal(
		previewGlassPaint(
			{ ...activeGlass, capability: { supported: false, mechanism: "none" } },
			palette,
		),
		null,
	);
	assert.equal(
		previewGlassPaint({ ...activeGlass, restartRequired: true }, palette),
		null,
	);
	const frosted = previewGlassPaint(
		{ ...activeGlass, settings: { ...activeGlass.settings, intensity: 0 } },
		palette,
	);
	assert.notEqual(
		frosted.vars["--lo-glass-a-canvas"],
		expected.vars["--lo-glass-a-canvas"],
	);
});

test("restart-pending preview matches the production hook's unapplied ON and cleared OFF", () => {
	const palette = resolveAppearance(store.getState()).palette;
	// A Windows-style enable pending native reconstruction cannot paint glass.
	// Exercise the actual hook, not a second implementation of its guard.
	applyGlassState(null);
	const pendingOn = { ...activeGlass, restartRequired: true };
	applyGlassState(pendingOn);
	assert.equal(document.documentElement.hasAttribute("data-glass"), false);
	assert.equal(previewGlassPaint(pendingOn, palette), null);

	applyGlassState(activeGlass);
	assert.equal(document.documentElement.dataset.glass, "sidebar canvas pane");
	const pendingOff = {
		...activeGlass,
		active: false,
		restartRequired: true,
		settings: { ...activeGlass.settings, enabled: false },
	};
	applyGlassState(pendingOff);
	assert.equal(document.documentElement.hasAttribute("data-glass"), false);
	assert.equal(
		document.documentElement.style.getPropertyValue("--lo-glass-a-canvas"),
		"",
	);
	assert.equal(previewGlassPaint(pendingOff, palette), null);
});

test("active and draft preview use local production paint across schemes and coverage", async () => {
	for (const theme of ["obsidian", "localOperatorLight"]) {
		for (const coverage of ["full", "sidebars"]) {
			const glass = {
				...activeGlass,
				settings: { ...activeGlass.settings, coverage },
			};
			await mount(theme, 0, glass);
			const preview = document.querySelector("[data-appearance-preview]");
			const palette = resolveAppearance(store.getState()).palette;
			const expected = previewGlassPaint(glass, palette);
			assert.equal(preview.dataset.previewGlass, expected.kinds);
			for (const [name, value] of Object.entries(expected.vars))
				assert.equal(preview.style.getPropertyValue(name), value);
			const caption = preview.lastElementChild.textContent;
			assert.equal(caption, "Sample backdrop");
			const slider = document.querySelector("[data-contrast-slider]");
			document.documentElement.style.setProperty("--lo-glass-a-canvas", ".999");
			await fire(
				slider,
				new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
			);
			await input(slider, "100");
			await frame();
			const draftPaint = previewGlassPaint(
				glass,
				contrastCandidate(palette, 100),
			);
			assert.equal(
				store.getState().contrast[palette.mode],
				0,
				"draft is not committed",
			);
			assert.equal(
				preview.querySelector("[data-preview-samples]").hasAttribute("inert"),
				true,
			);
			for (const [name, value] of Object.entries(draftPaint.vars))
				assert.equal(
					preview.style.getPropertyValue(name),
					value,
					`${theme} ${coverage} ${name}`,
				);
			assert.equal(
				preview.lastElementChild.textContent,
				caption,
				"caption never toggles height with state",
			);
			await fire(window, new MouseEvent("pointerup", { bubbles: true }));
			await frame();
			await frame();
		}
	}
	document.documentElement.style.removeProperty("--lo-glass-a-canvas");
});

test("preview and its separator remain in flow with intrinsic compact samples", async () => {
	await mount();
	const preview = document.querySelector("[data-appearance-preview]");
	const section = preview.parentElement;
	assert.equal(
		section.classList.contains("sticky"),
		false,
		"preview must scroll away instead of covering gallery tiles",
	);
	assert.equal(
		section.classList.contains("-mx-1"),
		false,
		"preview must not reach into the scroll gutter",
	);
	assert.equal(
		section.classList.contains("border-b"),
		true,
		"separator belongs to the normal-flow section",
	);
	const samples = preview.querySelector("[aria-hidden]");
	assert.equal(
		samples.classList.contains("min-h-42"),
		false,
		"sample content determines height at every width",
	);
	assert.equal(samples.classList.contains("p-2"), true);
	assert.equal(samples.classList.contains("gap-2"), true);
	assert.equal(samples.hasAttribute("inert"), true);
});

test("a drag never persists; release retains thumb/preview until verified store commit", async () => {
	await mount();
	const slider = document.querySelector("[data-contrast-slider]");
	let writes = 0;
	const original = dom.window.Storage.prototype.setItem;
	dom.window.Storage.prototype.setItem = function (...args) {
		writes++;
		return original.apply(this, args);
	};
	try {
		await fire(
			slider,
			new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
		);
		await input(slider, "50");
		await frame();
		assert.equal(slider.value, "50");
		assert.equal(store.getState().contrast.dark, 0);
		assert.equal(
			writes,
			0,
			"negative control: pointer movement must not persist",
		);
		assert.match(
			document.getElementById("lo-appearance-preview").textContent,
			PREVIEW_BLOCK,
		);
		await fire(window, new MouseEvent("pointerup", { bubbles: true }));
		assert.equal(
			slider.value,
			"50",
			"release must not snap back before either rAF",
		);
		assert.equal(store.getState().contrast.dark, 0);
		await frame();
		assert.equal(slider.value, "50", "first pending frame retains candidate");
		assert.equal(writes, 0);
		await frame();
		assert.equal(store.getState().contrast.dark, 50);
		assert.equal(slider.value, "50");
		assert.equal(writes, 1, "one release, one persistence write");
		assert.equal(
			document.querySelectorAll("h3").length,
			3,
			"Theme/Contrast/Accent have one heading each",
		);
	} finally {
		dom.window.Storage.prototype.setItem = original;
	}
});

test("keyboard tiers announce live; AT non-pointer changes commit and remain per mode", async () => {
	await mount();
	const slider = document.querySelector("[data-contrast-slider]");
	await key(slider, "PageUp");
	assert.equal(slider.value, "50");
	assert.equal(
		document.querySelector('output[aria-live="polite"]').textContent,
		"Strong",
	);
	assert.equal(
		store.getState().contrast.dark,
		0,
		"keydown is still only a draft",
	);
	await fire(
		slider,
		new KeyboardEvent("keyup", { key: "PageUp", bubbles: true }),
	);
	await frame();
	await frame();
	assert.equal(store.getState().contrast.dark, 50);
	await input(slider, "55");
	assert.equal(
		slider.value,
		"55",
		"VoiceOver value-change action is accepted without pointerdown",
	);
	await frame();
	await frame();
	assert.equal(store.getState().contrast.dark, 55);
	assert.equal(store.getState().contrast.light, 0);
	await key(slider, "Home");
	assert.equal(slider.value, "-100");
	await fire(
		slider,
		new KeyboardEvent("keyup", { key: "Home", bubbles: true }),
	);
	await frame();
	await frame();
	assert.equal(store.getState().contrast.dark, -100);
});

test("light ceiling hint and borrowed-palette reminder describe actual composition", async () => {
	await mount("localOperatorLight", 100);
	assert.match(document.body.textContent, CEILING_HINT);
	await act(async () =>
		store
			.getState()
			.setAccent("light", { kind: "palette", id: "tokyoNightDay" }),
	);
	assert.match(document.body.textContent, BORROWED_NOTICE);
	assert.ok(findButton("Use theme accent"));
});

test("console replay transports composed roles and rejects hostile snapshots", async () => {
	const state = {
		...store.getState(),
		themeName: "obsidian",
		contrast: { dark: 100, light: 0 },
		accent: {
			dark: { kind: "custom", hex: "#2563EB" },
			light: { kind: "theme" },
		},
	};
	const resolved = resolveAppearance(state);
	const replay = new JSDOM(
		"<!doctype html><html><head></head><body></body></html>",
	);
	const target = replay.window.document.documentElement;
	applyCaptureTheme(captureTheme(resolved, state.themeName), target);
	assert.equal(target.dataset.theme, resolved.id);
	assert.ok(
		replay.window.document
			.getElementById("lo-capture-palette")
			.textContent.includes(resolved.palette.accent),
	);
	applyCaptureTheme(
		JSON.stringify({ id: 'x"]{}', mode: "dark", palette: resolved.palette }),
		target,
	);
	assert.equal(
		target.dataset.theme,
		resolved.id,
		"invalid id cannot mutate the existing composition",
	);
	applyCaptureTheme(
		JSON.stringify({
			id: "lo-hostile",
			mode: "dark",
			palette: { ...resolved.palette, accent: "red; } body { display:none" },
		}),
		target,
	);
	assert.equal(target.dataset.theme, resolved.id);
	await act(async () => root.unmount());
	root = null;
});
