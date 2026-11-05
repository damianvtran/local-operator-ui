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
async function mount(themeName = "obsidian", contrast = 0) {
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
				h(AppearanceLayers, { gallery: h("div", null, "Gallery") }),
			),
		),
	);
}

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
