/** Execute the mini entry's actual lifecycle fragments with synthetic event
 * targets. No Electron/daemon imports: this tests listener ownership, not pixels
 * or native IPC. Extracted source must match the explicit startup boundaries. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformSync } from "esbuild";

test("20 adopted appearance writes keep one custom-library listener, removed on document teardown", () => {
	const source = readFileSync(
		new URL("../src/renderer/src/mini-view/main.tsx", import.meta.url),
		"utf8",
	);
	const start = source.indexOf("const publishAppearance =");
	const cleanup =
		/window\.addEventListener\("beforeunload", unsubscribeCustomThemes,\s*\{\s*once: true,?\s*\}\);/.exec(
			source,
		);
	assert.ok(
		start >= 0 && cleanup && cleanup.index > start,
		"startup must own its sole library subscription and teardown",
	);
	const end = cleanup.index + cleanup[0].length;
	const startup = source.slice(start, end);
	const storageStart = source.indexOf("const preferencesStoreKey =");
	const storageEnd = source.indexOf("\n});", storageStart);
	assert.ok(storageStart > end && storageEnd > storageStart);
	const storage = source.slice(storageStart, storageEnd + 4);
	const listeners = new Set();
	const events = new Map();
	let publishes = 0;
	const state = {
		themeName: "localOperatorDark",
		customThemeId: "custom-synthetic",
		contrast: { dark: 0, light: 0 },
		accent: { dark: { kind: "theme" }, light: { kind: "theme" } },
	};
	const store = {
		getState: () => state,
		persist: {
			getOptions: () => ({ name: "ui-preferences-storage" }),
			rehydrate: () => {},
		},
	};
	const window = {
		addEventListener: (name, callback) => events.set(name, callback),
	};
	const capabilities = {
		window,
		document: {},
		useUiPreferencesStore: store,
		findCustomTheme: () => undefined,
		savedPaletteOf: () => undefined,
		appearanceOf: (s) => s,
		appearanceKey: (s) => JSON.stringify(s),
		applyAppearance: () => {
			publishes++;
		},
		resolveAppearance: () => ({}),
		syncGlassScheme: () => {},
		subscribeCustomThemes: (callback) => {
			listeners.add(callback);
			return () => listeners.delete(callback);
		},
		adoptPreferencesWrite: (options) => options.publish(),
	};
	const code = transformSync(`${startup}\n${storage}`, {
		loader: "ts",
		format: "cjs",
	}).code;
	new Function(...Object.keys(capabilities), code)(
		...Object.values(capabilities),
	);
	assert.equal(listeners.size, 1);
	assert.equal(publishes, 1, "boot publishes once");
	for (let n = 1; n <= 20; n++) {
		state.contrast.dark = n;
		events.get("storage")({
			key: "ui-preferences-storage",
			newValue: JSON.stringify({ state }),
		});
		assert.equal(
			listeners.size,
			1,
			`appearance write ${n} must not register another listener`,
		);
	}
	assert.equal(publishes, 21);
	for (const listener of listeners) listener();
	assert.equal(publishes, 22, "one library edit produces one repaint, not 21");
	events.get("beforeunload")();
	assert.equal(
		listeners.size,
		0,
		"document teardown releases the library callback",
	);
});
