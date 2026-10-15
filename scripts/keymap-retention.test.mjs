/** R15: exercise the actual preferences store, not just the sanitizer. In-memory
 * storage never touches an operator profile. The frozen old reader is intentional:
 * a rollback promise requires the previous build to consume the SAVED result. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import {
	effectiveChord as oldEffective,
	sanitizeShortcutBindings as oldSanitize,
} from "./fixtures/keymap-pre-browser-8057f32.mjs";

const memory = new Map();
let writes = 0;
globalThis.localStorage = {
	getItem: (key) => memory.get(key) ?? null,
	setItem: (key, value) => {
		writes++;
		memory.set(key, String(value));
	},
	removeItem: (key) => memory.delete(key),
};
const root = process.cwd();
const bundle = await build({
	stdin: {
		contents: `export {useUiPreferencesStore, UI_PREFERENCES_VERSION} from "./src/renderer/src/shared/store/ui-preferences-store";
export {effectiveChord, buildChordMap, captureRefusal} from "./src/renderer/src/shared/keymap/keymap-chord";
export {LEGACY_BROWSER_CHORDS} from "./src/renderer/src/shared/keymap/keymap-registry";`,
		resolveDir: root,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": `${root}/src/renderer/src/shared`,
		"@features": `${root}/src/renderer/src/features`,
	},
	logLevel: "silent",
});
const {
	useUiPreferencesStore: store,
	UI_PREFERENCES_VERSION,
	effectiveChord,
	buildChordMap,
	captureRefusal,
	LEGACY_BROWSER_CHORDS,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const key = "ui-preferences-storage";
const bindings = () => store.getState().shortcutBindings;
const saved = () => JSON.parse(memory.get(key));
async function seed(chord, version = UI_PREFERENCES_VERSION) {
	memory.set(
		key,
		JSON.stringify({
			version,
			state: {
				shortcutBindings: {
					"panel.console": chord,
					"panel.canvas": "primary+shift+u",
					"panel.run": null,
				},
			},
		}),
	);
	writes = 0;
	await store.persist.rehydrate();
}
function checkRetained(chord) {
	assert.equal(bindings()["panel.console"], chord);
	assert.equal(effectiveChord("panel.console", bindings()), "primary+j");
	assert.equal(buildChordMap(bindings()).has(chord), false);
	assert.equal(bindings()["panel.canvas"], "primary+shift+u");
	assert.equal(bindings()["panel.run"], null);
	assert.equal(saved().state.shortcutBindings["panel.console"], chord);
}
test("R15 actual store: all15 survive hydration, unrelated saves, repeat loads and downgrade; edits supersede", async () => {
	for (const version of [UI_PREFERENCES_VERSION, 3]) {
		for (const chord of LEGACY_BROWSER_CHORDS) {
			await seed(chord, version);
			checkRetained(chord);
			assert.equal(writes, version === UI_PREFERENCES_VERSION ? 0 : 1);
			store.getState().setTheme(store.getState().theme);
			assert.ok(writes > 0);
			checkRetained(chord);
			await store.persist.rehydrate();
			checkRetained(chord);
			const old = oldSanitize(saved().state.shortcutBindings);
			assert.equal(
				oldEffective("panel.console", old),
				chord,
				"old build restores saved legacy mapping",
			);
			assert.ok(captureRefusal(chord, "panel.console", bindings()));
			// Refused assignment must not create a new legacy mapping on another action.
			store.getState().setShortcutBinding("panel.ask", chord);
			assert.equal(bindings()["panel.ask"], undefined);
			assert.equal(saved().state.shortcutBindings["panel.ask"], undefined);
		}
	}
	// Settings re-press of the displayed effective default is a UI no-op, NOT
	// Reset: it does not call the setter. Explicit Reset must discard raw data.
	for (const kind of ["reset", "clear", "rebind"]) {
		await seed("primary+t");
		if (kind === "reset")
			store.getState().setShortcutBinding("panel.console", null);
		if (kind === "clear")
			store.getState().clearShortcutBinding("panel.console");
		if (kind === "rebind")
			store.getState().setShortcutBinding("panel.console", "primary+shift+i");
		const expected =
			kind === "reset"
				? undefined
				: kind === "clear"
					? null
					: "primary+shift+i";
		assert.equal(bindings()["panel.console"], expected);
		await store.persist.rehydrate();
		store.getState().setTheme(store.getState().theme);
		assert.equal(
			saved().state.shortcutBindings["panel.console"],
			expected,
			"no legacy resurrection",
		);
	}
	console.log(
		"R15 actual store: 30 hydration/save/reload/downgrade cases + 3 explicit-edit roundtrips PASS; no live profile",
	);
});
