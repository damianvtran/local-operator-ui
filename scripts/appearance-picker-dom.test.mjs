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
 export { previewGlassState, previewBackdropVars, readPreviewPalette } from './src/renderer/src/features/settings/components/appearance-preview-glass';
 export { applyGlassState } from './src/renderer/src/shared/hooks/use-window-glass';
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
	previewGlassState,
	previewBackdropVars,
	applyGlassState,
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

const rolesOf = (palette) => ({
	canvas: palette.canvas,
	surface: palette.surface,
	elevated: palette.elevated,
	sunken: palette.sunken,
	ink: palette.ink,
	inkMuted: palette.inkMuted,
	inkDim: palette.inkDim,
	borderControl: palette.borderControl,
});

/** A named built-in's composed palette, independent of whatever the store holds. */
const paletteOf = (themeName) =>
	resolveAppearance({
		themeName,
		contrast: { dark: 0, light: 0 },
		accent: { dark: { kind: "theme" }, light: { kind: "theme" } },
	}).palette;

/** The preview section's inline custom properties (its painted alphas). */
const previewStyle = () =>
	document.querySelector("[data-appearance-preview]").style;

/**
 * Model what Chromium RESOLVES for the sample: the roles and `color-scheme` of the
 * palette the document is painting right now. jsdom resolves no custom properties,
 * so without this the strip exercises its solid branch and a stale-alpha regression
 * would be invisible.
 */
const withPaintedRoles = async (currentPalette, body) => {
	const real = globalThis.getComputedStyle;
	globalThis.getComputedStyle = (element, pseudo) => {
		const style = real(element, pseudo);
		const palette = currentPalette();
		const vars = {
			"--lo-canvas": palette.canvas,
			"--lo-surface": palette.surface,
			"--lo-elevated": palette.elevated,
			"--lo-sunken": palette.sunken,
			"--lo-ink": palette.ink,
			"--lo-ink-muted": palette.inkMuted,
			"--lo-ink-dim": palette.inkDim,
			"--lo-border-control": palette.borderControl,
			"color-scheme": palette.mode,
		};
		return new Proxy(style, {
			get(target, property) {
				if (property === "getPropertyValue")
					return (name) => vars[name] ?? target.getPropertyValue(name);
				const value = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	};
	try {
		return await body();
	} finally {
		globalThis.getComputedStyle = real;
	}
};

test("preview glass takes the production floors for the palette on screen", () => {
	// PUBLISHED NUMBERS, not a re-run of the implementation: `localOperatorDark` at
	// intensity 80, full coverage, vibrancy over the window material. A change that
	// drops the palette's own floor table fails on the number, not on a mirror.
	// Intensity 80 is the shipped default on this machine's sample glass.
	const glass80 = {
		...activeGlass,
		settings: { ...activeGlass.settings, intensity: 80 },
	};
	const palette = paletteOf("localOperatorDark");
	const read = { roles: rolesOf(palette), scheme: palette.mode };
	const glass = previewGlassState(glass80, read, "light");
	assert.equal(glass.kind, "glass");
	assert.equal(glass.paint.vars["--lo-glass-a-canvas"], "0.59");
	assert.equal(glass.paint.vars["--lo-glass-a-surface"], "0.65");
	assert.equal(glass.paint.vars["--lo-glass-a-elevated"], "0.74");
	assert.equal(glass.paint.vars["--lo-glass-a-band-floor"], "0.84");
	assert.equal(glass.paint.vars["--lo-glass-control-mix"], "0.1");
	// The tier comes off the palette that was READ, never the caller's fallback.
	assert.equal(glass.scheme, "dark");
	assert.equal(
		previewGlassState(glass80, read, "light").paint.vars["--lo-glass-a-canvas"],
		"0.59",
	);
	// The light palette at the same intensity takes ITS floors (0.62 / 0.55 / 0.50).
	const light = paletteOf("localOperatorLight");
	const lightGlass = previewGlassState(
		glass80,
		{ roles: rolesOf(light), scheme: light.mode },
		"dark",
	);
	assert.equal(lightGlass.paint.vars["--lo-glass-a-canvas"], "0.62");
	assert.equal(lightGlass.paint.vars["--lo-glass-a-surface"], "0.55");

	const solid = (state) => previewGlassState(state, read, "dark");
	// Every way the window can fail to paint glass collapses to the one solid
	// result: the sample has no backdrop, and the caption goes with it.
	for (const state of [
		null,
		{ ...activeGlass, active: false },
		{ ...activeGlass, capability: { supported: false, mechanism: "none" } },
		{ ...activeGlass, restartRequired: true },
	])
		assert.deepEqual(solid(state), { kind: "solid" });
	assert.deepEqual(previewGlassState(activeGlass, null, "dark"), {
		kind: "solid",
	});
	// The slider and a drag candidate both move the alphas off the committed set.
	const frosted = previewGlassState(
		{ ...glass80, settings: { ...glass80.settings, intensity: 0 } },
		read,
		"dark",
	);
	assert.notEqual(
		frosted.paint.vars["--lo-glass-a-canvas"],
		glass.paint.vars["--lo-glass-a-canvas"],
	);
	const draft = previewGlassState(
		glass80,
		{ roles: rolesOf(contrastCandidate(palette, 100)), scheme: "dark" },
		"dark",
	);
	assert.notEqual(
		draft.paint.vars["--lo-glass-a-canvas"],
		glass.paint.vars["--lo-glass-a-canvas"],
	);
});

test("the sample re-derives its glass when the palette under it is committed", async () => {
	// THE REGRESSION THIS TEST EXISTS FOR (code R1 / QA Q-1): the palette reaches
	// the strip as inherited `--lo-*`, and a theme or accent commit rewrites it
	// without changing the glass state or the preview id the effect used to depend
	// on. Mounted in the real `ThemeProvider` + real store, with the painted roles
	// modelled the way Chromium resolves them for the element.
	const result = await withPaintedRoles(
		() => resolveAppearance(store.getState()).palette,
		async () => {
			await mount("obsidian", 0, activeGlass);
			// The mount's own frame has long passed by the time a user switches
			// theme; flush it so the measurement is the committed state, not a
			// pending re-read that would mask the missing subscription.
			await frame();
			const before = previewStyle().getPropertyValue("--lo-glass-a-canvas");
			await act(async () => {
				store.setState({ themeName: "localOperatorLight" });
			});
			await frame();
			await frame();
			const after = previewStyle().getPropertyValue("--lo-glass-a-canvas");
			// The control: the same palette mounted cold.
			await mount("localOperatorLight", 0, activeGlass);
			await frame();
			return {
				before,
				after,
				fresh: previewStyle().getPropertyValue("--lo-glass-a-canvas"),
			};
		},
	);
	assert.equal(
		result.after,
		result.fresh,
		`after committing a light palette the sample painted ${result.after} where a fresh mount paints ${result.fresh} (it painted ${result.before} on the dark palette)`,
	);
	assert.notEqual(result.after, result.before);
});

test("the backdrop is a neutral material ramp, never the palette's accent", () => {
	// design D2 / code R2: the ground must not travel with the accent being judged.
	assert.deepEqual(previewBackdropVars("dark"), {
		"--lo-preview-backdrop-a": "#515151",
		"--lo-preview-backdrop-b": "#414141",
		"--lo-preview-backdrop-c": "#313131",
	});
	assert.deepEqual(previewBackdropVars("light"), {
		"--lo-preview-backdrop-a": "#c7c7c7",
		"--lo-preview-backdrop-b": "#d7d7d7",
		"--lo-preview-backdrop-c": "#e7e7e7",
	});
});
test("restart-pending preview matches the production hook's unapplied ON and cleared OFF", () => {
	const palette = resolveAppearance(store.getState()).palette;
	const read = { roles: rolesOf(palette), scheme: palette.mode };
	// A Windows-style enable pending native reconstruction cannot paint glass.
	// Exercise the actual hook, not a second implementation of its guard.
	applyGlassState(null);
	const pendingOn = { ...activeGlass, restartRequired: true };
	applyGlassState(pendingOn);
	assert.equal(document.documentElement.hasAttribute("data-glass"), false);
	assert.equal(previewGlassState(pendingOn, read, palette.mode).kind, "solid");

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
	assert.equal(previewGlassState(pendingOff, read, palette.mode).kind, "solid");
});

test("the sample paints solid when no palette role resolves in this host", async () => {
	// jsdom resolves no custom properties, so the read-back is the helper's null
	// branch: the same solid fallback an unsupported machine shows.
	for (const theme of ["obsidian", "localOperatorLight"]) {
		for (const coverage of ["full", "sidebars"]) {
			await mount(theme, 0, {
				...activeGlass,
				settings: { ...activeGlass.settings, coverage },
			});
			const preview = document.querySelector("[data-appearance-preview]");
			assert.equal(preview.dataset.previewGlass, "");
			assert.equal(preview.getAttribute("style"), null);
			// No palette read, so no backdrop: the caption must not claim one.
			assert.equal(preview.querySelector("[data-preview-caption]"), null);
			assert.equal(
				preview.querySelector("[data-preview-samples]").hasAttribute("inert"),
				true,
			);
		}
	}
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
	const samples = preview.querySelector("[data-preview-samples]");
	assert.equal(
		samples.classList.contains("min-h-42"),
		false,
		"sample content determines height at every width",
	);
	// M3: the narrow-width contract IS this track. A regression to
	// `minmax(200px,1fr)` - the overflow this PR fixes - must fail here.
	assert.equal(
		samples.classList.contains(
			"grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))]",
		),
		true,
		"tracks must shrink below their 200px minimum instead of overflowing",
	);
	assert.equal(samples.classList.contains("p-2"), true);
	assert.equal(samples.classList.contains("gap-2"), true);
	assert.equal(samples.hasAttribute("inert"), true);
	// The sample names itself, and the state line lives outside the picture.
	assert.equal(
		preview.firstElementChild.textContent,
		"Preview of the current appearance",
	);
	// The solid state has no backdrop, so it has no backdrop caption.
	assert.equal(preview.querySelector("[data-preview-caption]"), null);
});

test("the caption is painted only when there is a backdrop to name", async () => {
	// design D1: round 1 painted "Sample backdrop" in the three solid states, where
	// no backdrop is painted. UX U2's per-state reason is deferred (it needs an
	// audited receipt per locale), so the honest minimum ships: the caption exists
	// exactly where the claim is true.
	const painted = await withPaintedRoles(
		() => resolveAppearance(store.getState()).palette,
		async () => {
			await mount("localOperatorDark", 0, activeGlass);
			return document.querySelector("[data-preview-caption]").textContent;
		},
	);
	assert.equal(painted, "Sample backdrop");
	for (const state of [
		{ ...activeGlass, active: false },
		{ ...activeGlass, capability: { supported: false, mechanism: "none" } },
		{ ...activeGlass, restartRequired: true },
		null,
	]) {
		await mount("localOperatorDark", 0, state);
		assert.equal(document.querySelector("[data-preview-caption]"), null);
		assert.equal(
			document.querySelector("[data-appearance-preview]").dataset.previewGlass,
			"",
		);
	}
});

test("the compact sample is the controls' companion, not a second picture", async () => {
	// UX U1: the sample must share a screen with the controls it explains.
	await mount();
	const [full, compact] = [
		...document.querySelectorAll("[data-appearance-preview]"),
	];
	assert.equal(full.dataset.previewVariant, "full");
	assert.equal(compact.dataset.previewVariant, "compact");
	// One sample definition: both carry the chat pair and the sidebar rows.
	for (const node of [full, compact]) {
		assert.equal(node.querySelectorAll("[data-preview-block]").length, 1);
		assert.equal(
			node.querySelectorAll('[data-preview-region="sidebar"]').length,
			1,
		);
	}
	// Only the full one keeps the buttons/callouts column.
	assert.equal(
		full.querySelectorAll('[data-preview-region="canvas"]').length,
		2,
	);
	assert.equal(
		compact.querySelectorAll('[data-preview-region="canvas"]').length,
		1,
	);
	const contrast = document.querySelector('[data-appearance-layer="contrast"]');
	assert.equal(
		compact.parentElement,
		contrast.parentElement.parentElement,
		"the compact sample shares the controls' grid, so it is beside them at wide widths",
	);
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
