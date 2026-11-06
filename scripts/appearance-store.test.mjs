import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The v5 appearance fields, through the REAL preferences store (issue: custom
 * themes, PR A). The pure sanitisers are pinned in `theme-engine.test.mjs`; this
 * file pins what a user's saved profile becomes - the migration step, the merge's
 * re-validation of a hand-edited blob, and the internal setters the settings
 * picker will call - by rehydrating the store from `localStorage` exactly as the
 * app does at launch. The bundling mirrors `right-slot-width.test.mjs`.
 */
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
		contents:
			'export { useUiPreferencesStore, migrateUiPreferences, UI_PREFERENCES_VERSION } from "./src/renderer/src/shared/store/ui-preferences-store";',
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
	},
	logLevel: "silent",
});
const {
	useUiPreferencesStore: store,
	migrateUiPreferences,
	UI_PREFERENCES_VERSION,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const KEY = "ui-preferences-storage";
const IDENTITY = {
	contrast: { dark: 0, light: 0 },
	accent: { dark: { kind: "theme" }, light: { kind: "theme" } },
	customAccents: [],
	customThemeId: null,
};
async function load(version, state) {
	memory.set(KEY, JSON.stringify({ version, state }));
	await store.persist.rehydrate();
	return store.getState();
}
const pick = (s) => ({
	contrast: s.contrast,
	accent: s.accent,
	customAccents: s.customAccents,
	customThemeId: s.customThemeId,
});

test("v5 is the appearance step", () => {
	assert.equal(UI_PREFERENCES_VERSION, 5);
});

test("a v4 profile migrates to the identity appearance and keeps its theme", async () => {
	const s = await load(4, { themeName: "dracula", rightSlotWidth: 700 });
	assert.equal(s.themeName, "dracula");
	assert.equal(s.rightSlotWidth, 700);
	assert.deepEqual(pick(s), IDENTITY);
	/* And it is written back at v5, so the step runs once. */
	store.getState().setContrast("dark", 0);
	assert.equal(JSON.parse(memory.get(KEY)).version, 5);
});

test("the v5 step is idempotent over values a newer build already wrote", () => {
	const blob = {
		contrast: { dark: 50, light: -100 },
		accent: {
			dark: { kind: "custom", hex: "#ff5733" },
			light: { kind: "theme-alt" },
		},
		customAccents: ["#ff5733"],
		customThemeId: "custom-abc",
	};
	assert.deepEqual(migrateUiPreferences(blob, 4), {
		contrast: { dark: 50, light: -100 },
		accent: {
			dark: { kind: "custom", hex: "#FF5733" },
			light: { kind: "theme-alt" },
		},
		customAccents: ["#FF5733"],
		customThemeId: "custom-abc",
	});
});

test("a hand-edited v5 blob is re-validated on load, never trusted", async () => {
	const s = await load(5, {
		themeName: "nord",
		contrast: { dark: 9000, light: "high" },
		accent: {
			dark: { kind: "custom", hex: "red; } body { display: none" },
			light: { kind: "palette", id: "notATheme" },
		},
		customAccents: ["#abc", "#AABBCC", "javascript:", 7],
		customThemeId: "../../etc",
	});
	assert.deepEqual(pick(s), {
		contrast: { dark: 100, light: 0 },
		accent: { dark: { kind: "theme" }, light: { kind: "theme" } },
		customAccents: ["#AABBCC"],
		customThemeId: null,
	});
	assert.equal(s.themeName, "nord");
});

test("setters: contrast per mode, accent per mode, swatches MRU, removal resets selection", async () => {
	await load(5, { themeName: "nord" });
	const st = () => store.getState();
	st().setContrast("dark", 49.6);
	st().setContrast("light", -300);
	assert.deepEqual(st().contrast, { dark: 50, light: -100 });
	st().setAccent("light", { kind: "palette", id: "dracula" });
	assert.deepEqual(st().accent.light, { kind: "palette", id: "dracula" });
	assert.deepEqual(st().accent.dark, { kind: "theme" });
	st().addCustomAccent("#112233");
	st().addCustomAccent("445566", "dark");
	assert.deepEqual(st().customAccents, ["#445566", "#112233"]);
	assert.deepEqual(st().accent.dark, { kind: "custom", hex: "#445566" });
	st().addCustomAccent("#112233");
	assert.deepEqual(st().customAccents, ["#112233", "#445566"]);
	st().removeCustomAccent("#445566");
	assert.deepEqual(st().customAccents, ["#112233"]);
	assert.deepEqual(st().accent.dark, { kind: "theme" });
	/* Persisted, and survives a reload. */
	await store.persist.rehydrate();
	assert.deepEqual(st().contrast, { dark: 50, light: -100 });
	assert.deepEqual(st().customAccents, ["#112233"]);
});

/*
 * The accent row's rename and "Edit colour…" (layered appearance picker).
 * Editing a swatch must REPLACE it in place - same slot, name kept, every mode
 * that had it selected moved to the new colour - not remove-then-add, which
 * would drop the selection to the theme accent for a frame and reorder the row.
 * Names are bounded by the swatch list: a name never outlives its swatch.
 */
test("custom accents: rename, replace in place, names follow their swatch", async () => {
	await load(5, { themeName: "nord" });
	const st = () => store.getState();
	st().addCustomAccent("#112233");
	st().addCustomAccent("#445566", "dark");
	st().addCustomAccent("#778899", "light");
	st().renameCustomAccent("#445566", "  Harbour  ");
	st().renameCustomAccent("#ABCDEF", "not a swatch");
	assert.deepEqual(st().customAccentNames, { "#445566": "Harbour" });

	st().replaceCustomAccent("#445566", "#2563eb");
	assert.deepEqual(st().customAccents, ["#778899", "#2563EB", "#112233"]);
	assert.deepEqual(st().accent.dark, { kind: "custom", hex: "#2563EB" });
	assert.deepEqual(st().customAccentNames, { "#2563EB": "Harbour" });

	st().replaceCustomAccent("#2563EB", "#778899");
	assert.deepEqual(
		st().customAccents,
		["#778899", "#112233"],
		"replacing onto an existing swatch merges rather than duplicating",
	);

	st().renameCustomAccent("#112233", "Ink");
	st().removeCustomAccent("#112233");
	assert.equal(st().customAccentNames["#112233"], undefined);

	/* A 13th swatch drops the oldest and its name with it. */
	st().renameCustomAccent("#778899", "Oldest");
	for (let i = 0; i < 12; i++) st().addCustomAccent(`#00000${i.toString(16)}`);
	assert.equal(st().customAccents.length, 12);
	assert.equal(st().customAccents.includes("#778899"), false);
	assert.deepEqual(st().customAccentNames, {});

	/* A hand-edited blob cannot keep names for swatches it does not have. */
	await load(5, {
		themeName: "nord",
		customAccents: ["#112233"],
		customAccentNames: { "#112233": "Ink", "#FFFFFF": "ghost" },
	});
	assert.deepEqual(st().customAccentNames, { "#112233": "Ink" });
});
