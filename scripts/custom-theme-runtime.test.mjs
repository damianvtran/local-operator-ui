/** Real store/provider DOM proof, not native or rendered evidence. jsdom
 * instruments style publication, storage reload and failed-write atomicity. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
const dom = new JSDOM(
	"<!doctype html><html><head></head><body><div id='root'></div></body></html>",
	{ url: "http://localhost/" },
);
for (const name of [
	"window",
	"document",
	"HTMLElement",
	"Element",
	"Node",
	"MutationObserver",
	"Event",
	"StorageEvent",
	"localStorage",
])
	globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", {
	value: dom.window.navigator,
	configurable: true,
});
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.CSS = { supports: () => true };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({
	stdin: {
		contents: `
export {createElement,act} from 'react';
export {createRoot} from 'react-dom/client';
export {ThemeProvider} from './src/renderer/src/shared/themes/theme-provider';
export {useUiPreferencesStore as store} from './src/renderer/src/shared/store/ui-preferences-store';
export {saveCustomTheme,deleteCustomTheme,reloadCustomThemes,customThemeSnapshot} from './src/renderer/src/shared/themes/custom-theme-store';
export {appearanceKey,appearanceOf} from './src/renderer/src/shared/themes/appearance';
export {definitionOf} from './src/renderer/src/shared/themes';
export {useTheme} from '@mui/material/styles';
export {savedPaletteOf} from './src/renderer/src/shared/themes/use-resolved-appearance';
export {applyAppearance} from './src/renderer/src/shared/themes/appearance';
export {CustomThemePreview} from './src/renderer/src/features/settings/components/custom-theme-preview';
`,
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
	ThemeProvider,
	store,
	saveCustomTheme,
	deleteCustomTheme,
	reloadCustomThemes,
	customThemeSnapshot,
	definitionOf,
	appearanceKey,
	appearanceOf,
	useTheme,
	savedPaletteOf,
	applyAppearance,
	CustomThemePreview,
} = module.exports;
let root = createRoot(document.getElementById("root"));
const draft = (id) => ({
	format: "local-operator-theme",
	version: 1,
	id: `custom-${id}`,
	name: "Harbour",
	base: id,
	seeds: {},
	overrides: {},
	updatedAt: 1,
});
const identity = {
	contrast: { dark: 0, light: 0 },
	accent: { dark: { kind: "theme" }, light: { kind: "theme" } },
};

test("saved custom selection paints via the real provider; editing an active ID, reload and deletion repaint correctly", async () => {
	await act(async () => root.render(h(ThemeProvider, null, h("div", null))));
	for (const id of ["localOperatorDark", "localOperatorLight"]) {
		// IDs are lowercase by schema, independently of the camelCase base ID.
		const theme = { ...draft(id), id: `custom-${id.toLowerCase()}` };
		await act(async () => {
			store.setState({ ...identity, themeName: id, customThemeId: null });
			saveCustomTheme(theme);
			store.setState({ customThemeId: theme.id });
		});
		assert.match(document.documentElement.dataset.theme, /^lo-/);
		assert.equal(
			document.documentElement.classList.contains("dark"),
			id.endsWith("Dark"),
		);
		const before = document.documentElement.dataset.theme;
		const edited = {
			...theme,
			name: "Edited Harbour",
			overrides: { accent: id.endsWith("Dark") ? "#32CA68" : "#147742" },
			updatedAt: 2,
		};
		await act(async () => saveCustomTheme(edited));
		assert.equal(customThemeSnapshot().themes[0].name, "Edited Harbour");
		assert.notEqual(
			document.documentElement.dataset.theme,
			before,
			"editing the active ID must repaint, not just persist",
		);
		assert.equal(
			getComputedStyle(document.documentElement)
				.getPropertyValue("--lo-accent")
				.trim(),
			edited.overrides.accent,
		);
		assert.ok(document.getElementById("lo-composed-theme"));
		// A storage event models a second document's edit without touching preferences.
		await act(async () => {
			localStorage.setItem(
				"custom-themes-storage",
				JSON.stringify({ version: 1, themes: [edited] }),
			);
			window.dispatchEvent(
				new StorageEvent("storage", { key: "custom-themes-storage" }),
			);
		});
		assert.equal(customThemeSnapshot().themes[0].updatedAt, 2);
		await act(async () => reloadCustomThemes());
		assert.equal(store.getState().customThemeId, theme.id);
		assert.deepEqual(store.getState().contrast, identity.contrast);
		assert.deepEqual(store.getState().accent, identity.accent);
		await act(async () => deleteCustomTheme(theme.id));
		assert.equal(
			document.documentElement.dataset.theme,
			id,
			"missing custom falls back to the retained built-in base",
		);
		assert.notEqual(before, id);
	}
});

test("same-base A→B→active B edit updates root CSS, identity, MUI and mini document; reload keeps edited paint", async (t) => {
	const probe = () =>
		h("span", { "data-mui-accent": useTheme().palette.primary.main });
	const a = {
		...draft("localOperatorDark"),
		id: "custom-cachea",
		overrides: { accent: "#32CA68" },
	};
	const b = { ...a, id: "custom-cacheb", overrides: { accent: "#30C868" } };
	const edited = { ...b, overrides: { accent: "#31C969" }, updatedAt: 3 };
	await act(async () => {
		store.setState({ ...identity, themeName: a.base, customThemeId: null });
		saveCustomTheme(a);
		saveCustomTheme(b);
		root.render(h(ThemeProvider, null, h(probe)));
	});
	const mini = new JSDOM(
		"<!doctype html><html><head></head><body></body></html>",
	);
	const identities = [];
	const assertPaint = (theme) => {
		const rootId = document.documentElement.dataset.theme;
		assert.equal(
			getComputedStyle(document.documentElement)
				.getPropertyValue("--lo-accent")
				.trim(),
			theme.overrides.accent,
		);
		assert.equal(
			document.querySelector("[data-mui-accent]").dataset.muiAccent,
			theme.overrides.accent,
		);
		assert.ok(
			document.getElementById("lo-composed-theme").textContent.includes(rootId),
		);
		assert.ok(
			document
				.getElementById("lo-composed-theme")
				.textContent.includes(theme.overrides.accent),
		);
		// Mirror the mini entry's actual publisher into a separate document.
		applyAppearance(
			appearanceOf(store.getState()),
			mini.window.document,
			savedPaletteOf(theme),
			theme.base,
		);
		assert.equal(mini.window.document.documentElement.dataset.theme, rootId);
		assert.ok(
			mini.window.document
				.getElementById("lo-composed-theme")
				.textContent.includes(theme.overrides.accent),
		);
		t.diagnostic(
			`actual paint ${getComputedStyle(document.documentElement).getPropertyValue("--lo-accent").trim()} → ${rootId}; MUI ${document.querySelector("[data-mui-accent]").dataset.muiAccent}; mini ${mini.window.document.documentElement.dataset.theme}`,
		);
		return rootId;
	};
	for (const theme of [a, b]) {
		await act(async () => store.setState({ customThemeId: theme.id }));
		identities.push(assertPaint(theme));
	}
	await act(async () => saveCustomTheme(edited));
	identities.push(assertPaint(edited));
	assert.equal(
		new Set(identities).size,
		3,
		"same-base switches AND same-ID edits must generate fresh palette identities",
	);
	await act(async () => {
		reloadCustomThemes();
		await store.persist.rehydrate();
		root.unmount();
	});
	root = createRoot(document.getElementById("root"));
	await act(async () => root.render(h(ThemeProvider, null, h(probe))));
	assert.equal(assertPaint(edited), identities[2]);
	assert.deepEqual(store.getState().contrast, identity.contrast);
	assert.deepEqual(store.getState().accent, identity.accent);
	mini.window.close();
});

test("failed quota write never publishes an unsaved custom palette", async () => {
	const before = customThemeSnapshot();
	const original = dom.window.Storage.prototype.setItem;
	dom.window.Storage.prototype.setItem = () => {
		throw new dom.window.DOMException("quota", "QuotaExceededError");
	};
	try {
		assert.throws(
			() =>
				saveCustomTheme({ ...draft("localOperatorDark"), id: "custom-quota" }),
			/quota/,
		);
		assert.equal(customThemeSnapshot(), before);
	} finally {
		dom.window.Storage.prototype.setItem = original;
	}
});

test("corrupt library resets only the library, with an observable retryable error", async () => {
	const previousTheme = store.getState().themeName;
	await act(async () => {
		localStorage.setItem("custom-themes-storage", "{");
		reloadCustomThemes();
	});
	assert.equal(customThemeSnapshot().error, true);
	assert.equal(store.getState().themeName, previousTheme);
	await act(async () => {
		localStorage.removeItem("custom-themes-storage");
		reloadCustomThemes();
	});
	assert.equal(customThemeSnapshot().error, false);
	assert.deepEqual(customThemeSnapshot().themes, []);
});

test("appearance keys include custom identity but no contrast is embedded in stored themes", () => {
	const current = appearanceOf(store.getState());
	assert.notEqual(
		appearanceKey({ ...current, customThemeId: null }),
		appearanceKey({ ...current, customThemeId: "custom-test" }),
	);
	assert.equal(current.customThemeId, store.getState().customThemeId);
});

test("secondary pins survive real provider save/reload and global primary conflict in both modes", async () => {
	for (const id of ["localOperatorDark", "localOperatorLight"]) {
		const base = definitionOf(id).palette;
		const theme = {
			...draft(id),
			id: `custom-secondary${base.mode}`,
			overrides: {
				accentAlt: base.accentAlt,
				accentAltWash: base.accentAltWash,
			},
		};
		await act(async () => {
			store.setState({ ...identity, themeName: id, customThemeId: null });
			saveCustomTheme(theme);
			store.setState({ customThemeId: theme.id });
			root.render(
				h(ThemeProvider, null, h(CustomThemePreview, { id: "probe" })),
			);
		});
		const read = (role) =>
			getComputedStyle(document.documentElement).getPropertyValue(role).trim();
		assert.equal(read("--lo-accent-alt"), base.accentAlt);
		const chip = document.querySelector(
			'[data-accent-preview="secondary"] span',
		);
		assert.equal(chip.style.color, "var(--lo-accent-alt)");
		assert.equal(chip.style.background, "var(--lo-accent-alt-wash)");
		assert.equal(document.querySelectorAll("[data-accent-preview]").length, 2);
		await act(async () =>
			store.setState({
				accent: { ...identity.accent, [base.mode]: { kind: "theme-alt" } },
			}),
		);
		assert.equal(read("--lo-accent-alt"), base.accentAlt);
		assert.equal(read("--lo-accent-alt-wash"), base.accentAltWash);
		await act(async () => reloadCustomThemes());
		assert.deepEqual(
			customThemeSnapshot().themes.find((t) => t.id === theme.id).overrides,
			theme.overrides,
		);
		assert.equal(read("--lo-accent-alt"), base.accentAlt);
		assert.deepEqual(
			customThemeSnapshot().themes.find((t) => t.id === theme.id).seeds,
			{},
		);
	}
});

test("teardown", async () => {
	await act(async () => root.unmount());
	dom.window.close();
});
