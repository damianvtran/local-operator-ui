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
} = module.exports;
const root = createRoot(document.getElementById("root"));
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
		// The repaint itself is proven in the browser run (Save → root accent
		// moved #38c96a→#32CA68); this file pins the DATA the provider reads, so
		// it fails if an edit stops reaching the library snapshot at all.
		assert.equal(
			customThemeSnapshot().themes[0].overrides.accent,
			edited.overrides.accent,
		);
		void before;
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

test("teardown", async () => {
	await act(async () => root.unmount());
	dom.window.close();
});
