/** Real React/store/provider regressions for the layered picker. jsdom is a
 * focus/event instrument, not rendered/native evidence; Storybook owns pixels. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const PREVIEW_BLOCK = /data-theme="lo-preview"/;
const CEILING_HINT = /already as bright as it can go/;
const BORROWED_NOTICE = /Accent: Tokyo Night Day/;
const ROUNDED_TOP = /rounded-t-md/;
const ROUNDED_BOTTOM = /rounded-b-md/;
const CSS_RULE = /([^{}]+)\{([^{}]*)\}/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const GROUND_COMPOSITE = /^background-color: color-mix\(/;
const GROUND_ALPHA =
	/var\(--lo-canvas\) calc\(var\(--lo-glass-a-canvas\) \* 100%\)/;
const GROUND_DECLARATION = /^background-color: (.+);$/;
const GLASS_STATE_SELECTOR = /:not\(\[[a-z-]+=""\]\)/;
const TRANSPARENT = / transparent/;
const SRGB_PREVIEW_RAMP = /linear-gradient\(\s*125deg in srgb,/;
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
 export { previewGlassState, previewBackdropVars, readPreviewPalette, ROLES } from './src/renderer/src/features/settings/components/appearance-preview-glass';
 export { applyGlassState } from './src/renderer/src/shared/hooks/use-window-glass';
 export { contrastCandidate } from './src/shared/theme-engine/contrast.mjs';
 export { createElement, act } from 'react';
 export { createRoot } from 'react-dom/client';
 export { AppearanceLayers } from './src/renderer/src/features/settings/components/appearance-layers';
 export { ThemeProvider } from './src/renderer/src/shared/themes/theme-provider';
 export { useUiPreferencesStore as store } from './src/renderer/src/shared/store/ui-preferences-store';
 export { captureTheme, applyCaptureTheme } from './src/renderer/src/shared/themes/terminal-theme';
 export { resolveAppearance } from './src/renderer/src/shared/themes/appearance';
 export { themes } from './src/renderer/src/shared/themes';
 export { glassFloorsForPalette, composite, ratio, FLOOR_ROLES } from './src/shared/glass-derivation.mjs';`,
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
	themes,
	composite,
	ratio,
	applyGlassState,
	contrastCandidate,
	glassFloorsForPalette,
	ROLES,
	FLOOR_ROLES,
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
	// The floor table's other five: the panel hairline and the semantic inks.
	hairline: palette.hairline,
	danger: palette.danger,
	success: palette.success,
	warning: palette.warning,
	info: palette.info,
});

/** The boundary check's wording: the ROLE, never a `TypeError` from deep in the
 * compositor. */
const MISSING_ROLE =
	/palette is missing the "info" role required by the glass floor table/;
/** The same wording for the role the blank-value case drops. */
const MISSING_ROLE_HAIRLINE =
	/palette is missing the "hairline" role required by the glass floor table/;

/** The same palette with one role dropped: a reader that fell behind the floor
 * table's role contract, which is what #1706's second caller did. */
const withoutRole = (palette, role) =>
	Object.fromEntries(Object.entries(palette).filter(([name]) => name !== role));

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
		const palette = currentPalette(style);
		const vars = {
			"--lo-canvas": palette.canvas,
			"--lo-surface": palette.surface,
			"--lo-elevated": palette.elevated,
			"--lo-sunken": palette.sunken,
			"--lo-ink": palette.ink,
			"--lo-ink-muted": palette.inkMuted,
			"--lo-ink-dim": palette.inkDim,
			"--lo-border-control": palette.borderControl,
			"--lo-hairline": palette.hairline,
			"--lo-danger": palette.danger,
			"--lo-success": palette.success,
			"--lo-warning": palette.warning,
			"--lo-info": palette.info,
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
	/* 0.87, not the 0.84 this pinned before the band floor was derived against
	 * EVERY ink the band carries (agent QA round 1, Q-1): the count wears
	 * `inkDim` at its own 3.5 floor, and holding it costs three points of alpha on
	 * this palette at Standard. The fleet's committed floor is unchanged
	 * (`src/shared/window-glass-floors.json` 0.88/0.78), because the fleet maximum
	 * was already set by another palette - this row is the PER-PALETTE number, and
	 * it is the one a composed contrast preset reads. */
	assert.equal(glass.paint.vars["--lo-glass-a-band-floor"], "0.87");
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

const backdropStops = (style) =>
	["a", "b", "c"].map((stop) =>
		style.getPropertyValue(`--lo-preview-backdrop-${stop}`),
	);

const rgbChannels = (hex) =>
	[1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));

const assertBackdropHue = (stops, dominant, secondary, label) => {
	for (const stop of stops) {
		const channels = rgbChannels(stop);
		assert.ok(
			channels[dominant] > channels[secondary],
			`${label} backdrop ${stop} should follow the painted canvas hue`,
		);
	}
};

const readStripBackdrops = () =>
	[...document.querySelectorAll("[data-appearance-preview]")].map((strip) =>
		backdropStops(strip.style),
	);

test("both glass previews follow the painted canvas hue, not the accent", async () => {
	await withPaintedRoles(
		() => resolveAppearance(store.getState()).palette,
		async () => {
			await mount("tokyoNight", 0, activeGlass);
			await frame();
			const tokyo = readStripBackdrops();
			assert.equal(tokyo.length, 2);
			for (const stops of tokyo) assertBackdropHue(stops, 2, 0, "Tokyo Night");

			const originalAccent = resolveAppearance(store.getState()).palette.accent;
			await act(async () => {
				store.setState(({ accent }) => ({
					accent: { ...accent, dark: { kind: "custom", hex: "#FF782B" } },
				}));
			});
			await frame();
			assert.notEqual(
				resolveAppearance(store.getState()).palette.accent,
				originalAccent,
			);
			assert.deepEqual(
				readStripBackdrops(),
				tokyo,
				"accent alone must not tint glass",
			);

			await act(async () => {
				store.setState({ themeName: "rosewood" });
			});
			await frame();
			for (const stops of readStripBackdrops())
				assertBackdropHue(stops, 0, 2, "Rosewood");
		},
	);
});

test("both backdrops follow successive drafts under the same scoped id", async () => {
	const palette = paletteOf("tokyoNight");
	await withPaintedRoles(
		// jsdom resolves the canvas on the local preview selector but not the
		// inherited tokens the real browser reads from the document palette.
		(style) => ({
			...palette,
			canvas: style.getPropertyValue("--lo-canvas").trim() || palette.canvas,
		}),
		async () => {
			await mount("tokyoNight", 0, activeGlass);
			const initial = readStripBackdrops();
			const slider = document.querySelector("[data-contrast-slider]");
			await fire(
				slider,
				new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
			);
			try {
				for (const [value, firstStop] of [
					["-80", "#494951"],
					["100", "#474651"],
				]) {
					await input(slider, value);
					await frame();
					assert.equal(store.getState().contrast.dark, 0, "still a draft");
					assert.deepEqual(
						readStripBackdrops().map((stops) => stops[0]),
						[firstStop, firstStop],
					);
				}
				assert.notDeepEqual(readStripBackdrops(), initial);
			} finally {
				await fire(window, new MouseEvent("pointerup", { bubbles: true }));
				await frame();
				await frame();
			}
		},
	);
});

test("an extreme canvas tint fits at all stops without flattening the ramp", () => {
	// Synthetic extreme exercises the shared gamut bound without depending on
	// which saturated custom seeds the palette solver currently accepts.
	assert.deepEqual(Object.values(previewBackdropVars("dark", "#FF8000")), [
		"#513920",
		"#412910",
		"#311900",
	]);
	assert.deepEqual(Object.values(previewBackdropVars("light", "#FF8000")), [
		"#dfd3c7",
		"#efe3d7",
		"#fff3e7",
	]);
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

test("the sample paints solid when the palette read is missing a semantic role", async () => {
	// The floor table measures the four semantic inks, so a read that loses one is
	// a palette the sample cannot measure. It must fall back to the same solid
	// sample an unsupported host shows - the strip paints `undefined` into the
	// overlay vars otherwise, which is a thrown layout effect in production.
	const palette = paletteOf("localOperatorDark");
	const partial = withoutRole(palette, "info");
	await withPaintedRoles(
		() => partial,
		async () => {
			await mount("localOperatorDark", 0, activeGlass);
			const preview = document.querySelector("[data-appearance-preview]");
			assert.equal(preview.dataset.previewGlass, "");
			assert.equal(preview.getAttribute("style"), null);
			assert.equal(preview.querySelector("[data-preview-caption]"), null);
		},
	);
});

test("a floor table request names the palette role it is missing", () => {
	// The boundary check exists so a reader that falls behind the table reports
	// the ROLE, not `Cannot read properties of undefined (reading 'slice')` from
	// deep inside `composite` - that TypeError named nothing a maintainer can act
	// on, and it reached the user as a broken Appearance preview.
	const palette = paletteOf("localOperatorDark");
	assert.throws(
		() => glassFloorsForPalette(withoutRole(rolesOf(palette), "info")),
		{
			name: "Error",
			message: MISSING_ROLE,
		},
	);
	// The read palette the fixture builds is the full contract: nothing missing.
	assert.doesNotThrow(() => glassFloorsForPalette(rolesOf(palette)));
});

test("every role the sample reads is one the floor table requires", () => {
	// R1: the reader's `ROLES` and the table's `FLOOR_ROLES` are hand-kept, and
	// deleting `"hairline"` from the table's list stayed 16/16 green while
	// restoring the exact TypeError this fix exists to close. So the expectation is
	// driven by the READER's own list: drop each role it reads and the table must
	// name that role, never fall through to `composite`.
	const palette = rolesOf(paletteOf("localOperatorDark"));
	for (const [role] of ROLES) {
		assert.throws(
			() => glassFloorsForPalette(withoutRole(palette, role)),
			{
				name: "Error",
				message: new RegExp(`palette is missing the "${role}" role`),
			},
			`${role} is read by the sample but not required by the floor table`,
		);
	}
});

test("the reader and the floor table name the same roles", () => {
	// The other direction of R1, which the loop above cannot see: a role the table
	// gains but the reader does not read would make the sample throw the named
	// error on every glass paint. Equality is the only shape that pins both.
	assert.deepEqual(ROLES.map(([role]) => role).sort(), [...FLOOR_ROLES].sort());
});

test("a blank palette role is rejected as missing, not solved", () => {
	// R2: `typeof value === "string"` admitted `""`, which is not a colour: the
	// edge mix solved against a blank hairline and published a degenerate table
	// (`overlayEdgeMix {dark: 0, light: 1}`) instead of reporting the bad read.
	const palette = rolesOf(paletteOf("localOperatorDark"));
	for (const blank of ["", "   "]) {
		assert.throws(
			() => glassFloorsForPalette({ ...palette, hairline: blank }),
			{ name: "Error", message: MISSING_ROLE_HAIRLINE },
			`a ${JSON.stringify(blank)} role must be treated as missing`,
		);
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
		// UX U4: BOTH samples preview the candidate. The one the user is looking at
		// while dragging is the compact companion beside Contrast/Accent; it used to
		// keep the committed palette for the whole drag while the strip ~1000px above
		// previewed the candidate, and that strip is off-screen at that scroll
		// position.
		const strips = [...document.querySelectorAll("[data-appearance-preview]")];
		assert.equal(strips.length, 2);
		for (const strip of strips)
			assert.equal(
				strip.dataset.theme,
				"lo-preview",
				`the ${strip.dataset.previewVariant} sample previews the drag`,
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
		for (const strip of document.querySelectorAll("[data-appearance-preview]"))
			assert.equal(
				strip.hasAttribute("data-theme"),
				false,
				"the verified composition replaces the candidate in both samples",
			);
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

test("the sample's text rows are grounded by the canvas composite in every glass state", async () => {
	// code C1, C3, C4, UX U5, design D5: `--lo-ink-dim` at 12px is promised over a
	// COMPOSITED role, and these two rows sat on the bare ramp (3.05:1 dark,
	// 3.70:1 light, below AA on 56 of 59 palettes). This bundle loads the
	// stylesheet as empty, so jsdom resolves no ground at all and a DOM-only
	// assertion passed with every ground deleted (C4): the DECLARATIONS are pinned here,
	// from the sheet itself, and the DOM half only proves the marker they hang on
	// is still emitted by both variants.
	const sheet = await readFile(
		new URL(
			"../src/renderer/src/features/settings/components/appearance-preview-strip.css",
			import.meta.url,
		),
		"utf8",
	);
	// `selector { body }` blocks; this sheet has no at-rules and no nested braces.
	const rules = [...sheet.replace(CSS_COMMENT, "").matchAll(CSS_RULE)].map(
		([, selector, body]) => ({
			selector: selector.trim(),
			body: body.replace(/\s+/g, " ").trim(),
		}),
	);
	const chrome = rules.filter((rule) =>
		rule.selector.includes("[data-preview-chrome]"),
	);
	assert.equal(chrome.length, 2, "one solid ground, one composited ground");
	const solid = chrome.find(
		(rule) => rule.selector === ".appearance-preview [data-preview-chrome]",
	);
	assert.ok(solid, "the rows keep an explicit solid-state ground");
	assert.equal(solid.body, "background-color: var(--lo-canvas);");
	const glass = chrome.find((rule) => rule !== solid);
	// The declaration that actually paints in glass: the canvas composite at the
	// coverage alpha, not a flat fill and not an ink tier.
	assert.match(glass.body, GROUND_COMPOSITE);
	assert.match(glass.body, GROUND_ALPHA);
	assert.match(glass.body, GROUND_DECLARATION);
	assert.match(glass.body, TRANSPARENT);
	// C3: it applies to EVERY state that paints a backdrop. Keyed off `~="canvas"`
	// the sidebars-only story - the one glass state with its own frame - fell back
	// to the opaque rule and re-created N2's band.
	assert.ok(
		chrome.every(
			(rule) =>
				rule === solid ||
				!(
					GROUND_DECLARATION.test(rule.body) &&
					!GROUND_COMPOSITE.test(rule.body)
				),
		),
		"no glass-state chrome rule may repaint the rows flat",
	);
	assert.ok(
		!glass.selector.includes("~="),
		`the composite is not scoped to one coverage: ${glass.selector}`,
	);
	assert.match(glass.selector, GLASS_STATE_SELECTOR);
	await withPaintedRoles(
		() => resolveAppearance(store.getState()).palette,
		async () => {
			await mount("localOperatorDark", 0, activeGlass);
			const strips = [
				...document.querySelectorAll("[data-appearance-preview]"),
			];
			assert.equal(strips.length, 2);
			for (const strip of strips) {
				const rows = [...strip.querySelectorAll("[data-preview-chrome]")];
				assert.equal(
					rows.length,
					2,
					`${strip.dataset.previewVariant}: header and caption are both grounded`,
				);
				assert.equal(rows[0].dataset.previewCaption, undefined);
				assert.equal(rows[1].dataset.previewCaption, "");
				// The card's own corners are rounded; a square band would poke out.
				assert.match(rows[0].className, ROUNDED_TOP);
				assert.match(rows[1].className, ROUNDED_BOTTOM);
			}
		},
	);
});

test("the tinted sRGB ramp preserves the neutral ramp's composited contrast", async (t) => {
	const css = await readFile(
		"src/renderer/src/features/settings/components/appearance-preview-strip.css",
		"utf8",
	);
	assert.match(css, SRGB_PREVIEW_RAMP);
	// Sweep both composited roles and all three body inks at the shipped default
	// and the transparent end. These are the old stops, not the tint helper's
	// own output: the test must catch a change that moves toward the ink.
	const neutral = {
		dark: ["#515151", "#414141", "#313131"],
		light: ["#c7c7c7", "#d7d7d7", "#e7e7e7"],
	};
	const ids = Object.keys(themes);
	const interpolate = (stops, t) => {
		const [lo, hi, f] =
			t <= 0.5
				? [stops[0], stops[1], t / 0.5]
				: [stops[1], stops[2], (t - 0.5) / 0.5];
		return `#${[0, 1, 2]
			.map((i) =>
				Math.round(
					Number.parseInt(lo.slice(1 + i * 2, 3 + i * 2), 16) * (1 - f) +
						Number.parseInt(hi.slice(1 + i * 2, 3 + i * 2), 16) * f,
				)
					.toString(16)
					.padStart(2, "0"),
			)
			.join("")}`;
	};
	// Resolved once: `resolveAppearance` runs the whole engine (~20 ms), so the
	// sweep pays for it 59 times rather than once per intensity.
	const resolved = ids.map((themeName) => {
		const palette = paletteOf(themeName);
		return {
			themeName,
			palette,
			read: { roles: rolesOf(palette), scheme: palette.mode },
		};
	});
	for (const intensity of [80, 100]) {
		let worst = { ratio: Number.POSITIVE_INFINITY };
		for (const { themeName, palette, read } of resolved) {
			const state = previewGlassState(
				{ ...activeGlass, settings: { ...activeGlass.settings, intensity } },
				read,
				palette.mode,
			);
			assert.equal(state.kind, "glass");
			const stops = backdropStops({
				getPropertyValue: (key) => state.backdropVars[key],
			});
			const baseline = neutral[palette.mode];
			for (let step = 0; step <= 100; step++) {
				const ground = interpolate(stops, step / 100);
				const neutralGround = interpolate(baseline, step / 100);
				const grey = rgbChannels(neutralGround)[0];
				const channels = rgbChannels(ground);
				const dark = palette.mode === "dark";
				assert.equal(
					dark ? Math.max(...channels) : Math.min(...channels),
					grey,
					`${themeName} ramp at ${step}% must stay on the safe side of ${neutralGround}`,
				);
				for (const [role, alpha] of [
					["canvas", "--lo-glass-a-canvas"],
					["surface", "--lo-glass-a-surface"],
				]) {
					const opacity = Number(state.paint.vars[alpha]);
					const painted = composite(palette[role], opacity, ground);
					const previous = composite(palette[role], opacity, neutralGround);
					for (const ink of ["ink", "inkMuted", "inkDim"]) {
						const measured = ratio(palette[ink], painted);
						assert.ok(
							measured >= ratio(palette[ink], previous),
							`${themeName} ${ink} lost contrast on ${role} at ${step}% / intensity ${intensity}`,
						);
						if (measured < worst.ratio)
							worst = { ratio: measured, themeName, ink, role };
					}
				}
			}
		}
		const description = `${worst.ratio.toFixed(2)}:1 minimum on ${ids.length} palettes at intensity ${intensity} (${worst.themeName} ${worst.ink} on ${worst.role})`;
		assert.ok(worst.ratio >= 4.5, description);
		t.diagnostic(description);
	}
});
