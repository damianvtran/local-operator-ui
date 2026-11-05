/*
 * The pure half of the layered appearance picker (`src/shared/theme-engine/
 * picker.mjs`, `roles.mjs`) and the store actions and mini-view reader built on
 * it. Each test names the rule it holds and why that rule exists, so a failure
 * here reads as a product regression rather than a changed number.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { contrastCandidate } from "../src/shared/theme-engine/contrast.mjs";
import {
	ACCENT_ROLES,
	CONTRAST_SNAP_ZONE,
	PREVIEW_IDS,
	allAccents,
	curatedAccents,
	hexToLch,
	hueName,
	lchToHex,
	nearestPreset,
	nextPreset,
	onAccentPreview,
	presetAt,
	presetsAround,
	previewCss,
	sanitizeCustomAccentNames,
	snapContrast,
} from "../src/shared/theme-engine/picker.mjs";
import {
	PALETTE_ROLES,
	sanitizePaletteVars,
} from "../src/shared/theme-engine/roles.mjs";
import { loadPalettes } from "./palette-source.mjs";

const palettes = loadPalettes();
const byId = Object.fromEntries(palettes.map((p) => [p.id, p.palette]));

test("snapping: a pointer drag lands on presets inside the zone, keys never snap", () => {
	assert.equal(CONTRAST_SNAP_ZONE, 8);
	assert.equal(snapContrast(47), 50, "within 8 of Strong snaps to it");
	assert.equal(snapContrast(42), 50, "8 away is still inside the zone");
	assert.equal(snapContrast(41), 40, "9 away rounds to the step instead");
	assert.equal(snapContrast(-93), -100);
	assert.equal(snapContrast(25), 25, "midway stays fine-tuned");
	assert.equal(snapContrast(3, { snap: false }), 5, "keys: step only");
	assert.equal(snapContrast(-140), -100, "clamped");
	assert.equal(snapContrast(Number.NaN), 0, "garbage is Standard");
});

test("preset naming: on, between and nearest", () => {
	assert.equal(presetAt(50), "strong");
	assert.equal(presetAt(25), null);
	assert.deepEqual(presetsAround(25), ["standard", "strong"]);
	assert.deepEqual(presetsAround(-75), ["soft", "gentle"]);
	assert.equal(presetsAround(0), null);
	assert.equal(nearestPreset(20), "standard");
	assert.equal(nearestPreset(30), "strong");
	assert.equal(nearestPreset(25), "standard", "a tie goes toward Standard");
	assert.equal(nextPreset(25, 1), 50);
	assert.equal(nextPreset(50, 1), 100);
	assert.equal(nextPreset(100, 1), 100, "PageUp past High stays");
	assert.equal(nextPreset(-30, -1), -50);
});

test("hue names match what a reader calls common accents", () => {
	const named = {
		"#E53935": "red",
		"#F57C00": "orange",
		"#FDD835": "yellow",
		"#43A047": "green",
		"#009688": "teal",
		"#00BCD4": "cyan",
		"#2563EB": "blue",
		"#7AA2F7": "blue",
		"#3F51B5": "indigo",
		"#BD93F9": "violet",
		"#EC407A": "pink",
		"#A7A7AF": "neutral",
	};
	for (const [hex, name] of Object.entries(named))
		assert.equal(hueName(hex), name, hex);
});

test("curated accents: same mode only, distinct, the theme's own excluded", () => {
	const dark = curatedAccents(palettes, "dark", "dracula");
	assert.ok(dark.length >= 6 && dark.length <= 11, `${dark.length} swatches`);
	const ids = new Set(dark.map((a) => a.id));
	for (const id of ids) assert.equal(byId[id].mode, "dark", id);
	assert.equal(ids.has("dracula"), false, "the active theme is swatch one");
	assert.equal(
		new Set(dark.map((a) => a.hex)).size,
		dark.length,
		"no duplicate colours",
	);
	assert.ok(
		dark.every((a) => a.hex !== byId.dracula.accent.toUpperCase()),
		"another theme sharing the active accent is not a second copy of it",
	);
	assert.deepEqual(
		curatedAccents(palettes, "dark", "dracula"),
		dark,
		"deterministic",
	);
	const light = curatedAccents(palettes, "light", "paper");
	for (const { id } of light) assert.equal(byId[id].mode, "light", id);
	const all = allAccents(palettes, "light");
	assert.ok(all.length >= light.length);
	assert.equal(new Set(all.map((a) => a.hex)).size, all.length);
});

test("custom accent names survive only with their swatch, trimmed and capped", () => {
	const names = sanitizeCustomAccentNames(
		{
			"#3B82F6": "  Ocean\nblue  ",
			"#FFFFFF": "gone",
			"#111111": 42,
			"#222222": "x".repeat(80),
		},
		["#3B82F6", "#111111", "#222222"],
	);
	assert.deepEqual(Object.keys(names).sort(), ["#222222", "#3B82F6"]);
	assert.equal(names["#3B82F6"], "Ocean blue");
	assert.equal(names["#222222"].length, 40);
	assert.deepEqual(sanitizeCustomAccentNames(["x"], ["#3B82F6"]), {});
});

test("basic picker: LCh round-trips and stays in gamut", () => {
	for (const hex of ["#2563EB", "#FACC15", "#BD93F9", "#1A1A1B"]) {
		const back = lchToHex(hexToLch(hex));
		assert.match(back, /^#[0-9A-F]{6}$/);
		const d = [1, 3, 5].map(
			(i) =>
				Number.parseInt(hex.slice(i, i + 2), 16) -
				Number.parseInt(back.slice(i, i + 2), 16),
		);
		assert.ok(
			d.every((x) => Math.abs(x) <= 2),
			`${hex} -> ${back}`,
		);
	}
	assert.match(lchToHex({ l: 50, c: 400, h: 140 }), /^#[0-9A-F]{6}$/);
	assert.equal(onAccentPreview("#FACC15").ink, "#000000");
	assert.equal(onAccentPreview("#1D4ED8").ink, "#FFFFFF");
	assert.ok(onAccentPreview("#2563EB").ratio >= 4.5);
});

test("drag preview: scoped blocks only, the engine's candidate, accent carried", () => {
	const base = byId.obsidian;
	const css = previewCss(base, [
		{ id: PREVIEW_IDS.strip, contrast: 35 },
		{ id: PREVIEW_IDS.chip("high"), contrast: 100 },
		{ id: PREVIEW_IDS.chip("standard"), contrast: 0 },
		{ id: 'x"] { } :root [x="', contrast: 50 },
	]);
	assert.equal(css.includes(":root"), false, "an unsafe id is skipped");
	assert.equal(css.match(/\[data-theme=/g).length, 3);
	const strip = contrastCandidate(base, 35);
	assert.ok(
		css.includes(`--lo-canvas: ${strip.canvas};`),
		"the strip paints the engine's own candidate",
	);
	const overlay = { accent: "#2563EB" };
	assert.ok(
		previewCss(
			base,
			[{ id: PREVIEW_IDS.strip, contrast: 50 }],
			overlay,
		).includes("--lo-accent: #2563EB;"),
		"a custom accent stays visible during the drag",
	);
	assert.ok(ACCENT_ROLES.includes("onAccent"));
});

test("PALETTE_ROLES is exactly the roles every shipped palette carries", () => {
	const keys = new Set();
	for (const { palette } of palettes)
		for (const key of Object.keys(palette)) if (key !== "mode") keys.add(key);
	assert.deepEqual([...keys].sort(), [...PALETTE_ROLES].sort());
	for (const { id, palette } of palettes) {
		const { mode: _mode, ...roles } = palette;
		assert.deepEqual(
			sanitizePaletteVars(roles),
			roles,
			`${id}: a shipped palette passes its own sanitiser`,
		);
	}
});
