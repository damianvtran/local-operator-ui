/**
 * Shortcut overrides through the persistence boundary (#928).
 *
 *     node --test scripts/keymap-persistence.test.mjs
 *
 * WHY THIS FILE EXISTS. `localStorage` is not a trusted input: a hand edit, a
 * downgrade, or a blob written by an older build all arrive at
 * `mergePersistedUiPreferences`, and whatever survives it is loaded straight
 * into the dispatch map. The guard is `sanitizeShortcutBindings`, called from
 * the store's merge — and because it is the ONE boundary between disk and the
 * dispatcher, it is exercised here through the real store functions rather than
 * in isolation: `persistedUiPreferences` writes the field, the merge reads it
 * back, and the cells below are the two directions plus every class of entry
 * the sanitizer must drop.
 *
 * The store bundle is imported exactly as `right-slot-memory.test.mjs` imports
 * it (fake storage first, data: URL second) — the store's `persist` hydrates at
 * import, so the globals have to exist before the import runs.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};

const bundle = await build({
	stdin: {
		contents: [
			'export { useUiPreferencesStore, persistedUiPreferences, mergePersistedUiPreferences } from "./src/renderer/src/shared/store/ui-preferences-store";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": join(process.cwd(), "src/renderer/src/shared"),
		"@features": join(process.cwd(), "src/renderer/src/features"),
		"@assets": join(process.cwd(), "src/renderer/src/assets"),
	},
	logLevel: "silent",
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	useUiPreferencesStore,
	persistedUiPreferences,
	mergePersistedUiPreferences,
} = mod;

const prefs = () => useUiPreferencesStore.getState();

test("the field persists, and a blob without it rehydrates to no overrides", () => {
	useUiPreferencesStore.setState({
		shortcutBindings: { "panel.browser": "primary+i" },
	});
	const written = persistedUiPreferences(prefs());
	assert.deepEqual(written.shortcutBindings, { "panel.browser": "primary+i" });
	/*
	 * The zustand ^5 precedent the store records: a persisted blob that lacks a
	 * key rehydrates to the initial state's value for it — so an older blob
	 * (written before this field existed) produces `{}`, and there is nothing to
	 * migrate.
	 */
	const merged = mergePersistedUiPreferences(written, prefs());
	assert.deepEqual(merged.shortcutBindings, { "panel.browser": "primary+i" });
	const older = { ...written };
	// `Reflect.deleteProperty` rather than `delete`: the lint bans the operator
	// (its hidden-class cost), and the case is a blob that genuinely LACKS the
	// key, which is what an older build wrote.
	Reflect.deleteProperty(older, "shortcutBindings");
	assert.deepEqual(
		mergePersistedUiPreferences(older, prefs()).shortcutBindings,
		{},
	);
});

test("junk, unknown ids, reserved chords and duplicates are dropped at the boundary", () => {
	const current = prefs();
	const merge = (shortcutBindings) =>
		mergePersistedUiPreferences({ shortcutBindings }, current).shortcutBindings;
	// Non-objects and non-string values.
	assert.deepEqual(merge("junk"), {});
	assert.deepEqual(merge({ "panel.browser": 7 }), {});
	// Unknown ids.
	assert.deepEqual(merge({ "panel.nope": "primary+i" }), {});
	// Unparseable and reserved chords.
	assert.deepEqual(merge({ "panel.browser": "f13" }), {});
	assert.deepEqual(merge({ "panel.browser": "primary+k" }), {});
	// A primary-less chord (it could never dispatch — the router requires one —
	// and capture refuses it, so a hand edit may not arm it either).
	assert.deepEqual(merge({ "panel.browser": "j" }), {});
	// Duplicates keep the FIRST action in registry order.
	assert.deepEqual(
		merge({ "panel.canvas": "primary+i", "panel.browser": "primary+i" }),
		{ "panel.canvas": "primary+i" },
	);
	// ...and an override equal to another action's DEFAULT is a duplicate too.
	assert.deepEqual(merge({ "panel.browser": "primary+shift+c" }), {});
	// A valid binding survives, canonicalised.
	assert.deepEqual(merge({ "panel.browser": "cmd+i" }), {
		"panel.browser": "primary+i",
	});
});
