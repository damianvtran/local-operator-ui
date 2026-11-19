import assert from "node:assert/strict";
import { test } from "node:test";
import {
	ACCENT_FAMILIES,
	isAccentFamilyRole,
} from "../src/shared/theme-engine/accent-roles.mjs";
import { composeTheme } from "../src/shared/theme-engine/compose.mjs";
import {
	ESSENTIALS,
	customPaletteReadings,
	deriveCustomPalette,
	exportCustomTheme,
	parseThemeImport,
	readCustomThemeStorage,
	suggestCustomAdjustment,
	uniqueThemeName,
	validateCustomPalette,
} from "../src/shared/theme-engine/custom.mjs";
import {
	hexToOklch,
	oklchToHex,
	rgbToHex,
} from "../src/shared/theme-engine/oklch.mjs";
import { PALETTE_ROLES } from "../src/shared/theme-engine/roles.mjs";
import { loadPalettes } from "./palette-source.mjs";
const palettes = loadPalettes();
const known = (id) => palettes.some((p) => p.id === id);
const base = (id) => palettes.find((p) => p.id === id).palette;
const theme = (id = "localOperatorDark") => ({
	format: "local-operator-theme",
	version: 1,
	id: "custom-test",
	name: "Harbour",
	base: id,
	seeds: {},
	overrides: {},
	updatedAt: 123,
});

test("unmodified custom duplicates preserve every authored role and pass all 59 per-palette contracts", () => {
	for (const entry of palettes) {
		const draft = theme(entry.id);
		const derived = deriveCustomPalette(entry.palette, draft);
		assert.deepEqual(derived, entry.palette, entry.id);
		assert.deepEqual(validateCustomPalette(derived, entry.id), [], entry.id);
	}
});

test("six seeds derive from authored offsets; manual pins win and never mutate the built-in", () => {
	const original = structuredClone(base("localOperatorDark"));
	const draft = {
		...theme(),
		seeds: { canvas: "#201E1A", ink: "#EEEEEE" },
		overrides: { elevated: "#39322A" },
	};
	const derived = deriveCustomPalette(original, draft);
	assert.equal(derived.elevated, "#39322A");
	assert.equal(derived.canvas, "#201E1A");
	assert.notEqual(derived.surface, original.surface);
	assert.equal(original.canvas, base("localOperatorDark").canvas);
	assert.equal(ESSENTIALS.length, 6);
	const bad = { ...theme(), overrides: { ink: "#000000", canvas: "#000000" } };
	assert.ok(
		validateCustomPalette(deriveCustomPalette(original, bad), bad.base).length,
	);
	assert.equal(
		suggestCustomAdjustment(original, bad),
		null,
		"Adjust cannot silently repaint pinned manual colours",
	);
});

test("explicit adjustment is validated by the real contract across both modes", () => {
	for (const id of ["localOperatorDark", "localOperatorLight"]) {
		const draft = {
			...theme(id),
			seeds:
				id === "localOperatorDark"
					? { accent: "#3B82F6" }
					: { borderControl: "#AAAAAA" },
		};
		assert.ok(
			validateCustomPalette(deriveCustomPalette(base(id), draft), id).length,
		);
		const adjusted = suggestCustomAdjustment(base(id), draft);
		assert.ok(adjusted);
		assert.deepEqual(
			validateCustomPalette(deriveCustomPalette(base(id), adjusted), id),
			[],
		);
	}
});

test("numeric readings come from the shared evaluator including unrounded failures", () => {
	const result = customPaletteReadings(
		base("localOperatorDark"),
		"localOperatorDark",
	);
	assert.deepEqual(result.findings, []);
	assert.ok(result.readings.length > 100);
	assert.ok(
		result.readings.every(
			(row) => Number.isFinite(row.value) && Number.isFinite(row.floor),
		),
	);
	const bad = { ...base("localOperatorDark"), ink: "#000000" };
	assert.ok(customPaletteReadings(bad, "localOperatorDark").findings.length);
});

test("create/edit/save/reload/export/import data round trip keeps contrast and accent independent in dark and light", () => {
	for (const id of ["localOperatorDark", "localOperatorLight"]) {
		const draft = {
			...theme(id),
			name: "Edited Harbour",
			overrides: { ink: base(id).ink.toUpperCase() },
		};
		const loaded = readCustomThemeStorage(
			JSON.stringify({ version: 1, themes: [draft] }),
			known,
		)[0];
		assert.deepEqual(loaded, draft);
		const exported = exportCustomTheme(loaded);
		assert.equal(JSON.parse(exported).id, undefined);
		assert.equal(JSON.parse(exported).updatedAt, undefined);
		const imported = parseThemeImport(exported, known, {
			id: "custom-second",
			now: 456,
		});
		assert.equal(imported.id, "custom-second");
		assert.equal(imported.name, "Edited Harbour");
		assert.deepEqual(imported.overrides, draft.overrides);
		const appearance = {
			contrast: { dark: 50, light: -50 },
			accent: {
				dark: { kind: "custom", hex: "#3B82F6" },
				light: { kind: "theme" },
			},
		};
		const before = structuredClone(appearance);
		const palette = deriveCustomPalette(base(id), imported);
		const result = composeTheme(palette, {
			id,
			contrast: appearance.contrast[palette.mode],
			accent: appearance.accent[palette.mode],
		});
		assert.equal(result.palette.mode, palette.mode);
		assert.deepEqual(appearance, before);
		assert.equal("contrast" in JSON.parse(exported), false);
	}
});

test("hostile input rejects unsafe keys, nesting, invalid roles, versions, hex and oversized input", () => {
	const valid = JSON.parse(exportCustomTheme(theme()));
	const cases = [
		["{", "import_invalid_json"],
		[JSON.stringify({ ...valid, version: 2 }), "import_version"],
		[JSON.stringify({ ...valid, base: "missing" }), "import_base"],
		[JSON.stringify({ ...valid, name: "" }), "import_name"],
		[JSON.stringify({ ...valid, seeds: { canvas: "#12345" } }), "import_roles"],
		[
			JSON.stringify({
				...valid,
				seeds: { canvas: "#fff; } body {display:none}" },
			}),
			"import_roles",
		],
		[
			JSON.stringify({ ...valid, seeds: { surface: { nested: true } } }),
			"import_roles",
		],
		[
			JSON.stringify({ ...valid, overrides: { unknown: "#123456" } }),
			"import_roles",
		],
		[
			JSON.stringify({ ...valid, overrides: { scrim: "rgb(0 0 0 / .5)" } }),
			"import_roles",
		],
		[
			JSON.stringify({
				...valid,
				constructor: { prototype: { polluted: true } },
			}),
			"import_unsafe",
		],
		[
			JSON.stringify(valid).replace(
				'"seeds":{}',
				'"seeds":{"__proto__":"#123456"}',
			),
			"import_roles",
		],
		[" ".repeat(65537), "import_size"],
	];
	for (const [text, code] of cases)
		assert.throws(
			() => parseThemeImport(text, known),
			(e) => e.message === code,
			code,
		);
	assert.equal({}.polluted, undefined);
});

test("storage migrates the legacy array, isolates corrupt neighbours, deduplicates and caps 50", () => {
	const list = Array.from({ length: 60 }, (_, n) => ({
		...theme(),
		id: `custom-${n}`,
	}));
	assert.equal(readCustomThemeStorage(JSON.stringify(list), known).length, 50);
	assert.equal(
		readCustomThemeStorage(
			JSON.stringify([
				{},
				theme(),
				theme(),
				{ ...theme(), id: "custom-2", seeds: { ink: "bad" } },
			]),
			known,
		).length,
		1,
	);
	assert.throws(() => readCustomThemeStorage("{", known), /load_error/);
	assert.throws(
		() => readCustomThemeStorage('{"version":2,"themes":[]}', known),
		/load_error/,
	);
	assert.deepEqual(readCustomThemeStorage(null, known), []);
	assert.equal(uniqueThemeName("Harbour", [theme()]), "Harbour (2)");
});

test("overlay alpha is constrained data, round-trips, and cannot carry free CSS", () => {
	const draft = {
		...theme(),
		overrides: { scrim: "0.8", overlayShadow: "0.32" },
	};
	const imported = parseThemeImport(exportCustomTheme(draft), known);
	assert.equal(
		deriveCustomPalette(base(draft.base), imported).scrim,
		"rgb(0 0 0 / 0.8)",
	);
	assert.equal(
		readCustomThemeStorage(JSON.stringify([draft]), known)[0].overrides.scrim,
		"0.8",
	);
});

test("OKLCH round-trips sRGB, preserves hue at gamut edge, and validates RGB channels", () => {
	for (const hex of [
		"#000000",
		"#FFFFFF",
		"#FF0000",
		"#00FF00",
		"#0000FF",
		"#3B82F6",
		"#7AA2F7",
	])
		assert.equal(oklchToHex(hexToOklch(hex)).hex, hex);
	assert.equal(oklchToHex({ l: 0.7, c: 0.4, h: 300 }).clipped, true);
	assert.match(oklchToHex({ l: 0.7, c: 0.4, h: 300 }).hex, /^#[A-F0-9]{6}$/);
	assert.equal(rgbToHex([256, 0, 0]), null);
	assert.equal(rgbToHex([Number.NaN, 0, 0]), null);
	assert.equal(rgbToHex([255, 128, 0]), "#FF8000");
});

// Family roots are UI metadata, not a widened V1 seed grammar. Existing files
// must inherit secondary exactly, and existing pins must stay independently resettable.
test("accent families cover supported roles without inventing secondary states or seeds", () => {
	assert.deepEqual(
		ACCENT_FAMILIES.map((f) => f.role),
		["accent", "accentAlt"],
	);
	assert.deepEqual(ACCENT_FAMILIES[1].variants, ["accentAltWash"]);
	for (const family of ACCENT_FAMILIES) {
		for (const role of [family.role, ...family.variants]) {
			assert.ok(PALETTE_ROLES.includes(role));
			assert.ok(isAccentFamilyRole(role));
		}
	}
	assert.equal(isAccentFamilyRole("info"), false);
	assert.equal(ESSENTIALS.includes("accentAlt"), false);
	for (const id of ["localOperatorDark", "localOperatorLight"]) {
		const original = base(id);
		const legacy = { ...theme(id), seeds: { accent: original.accent } };
		const loaded = parseThemeImport(exportCustomTheme(legacy), known);
		assert.equal(
			deriveCustomPalette(original, loaded).accentAlt,
			original.accentAlt,
		);
		const pinned = {
			...loaded,
			overrides: {
				accentAlt: original.accentAlt,
				accentAltWash: original.accentAltWash,
			},
		};
		const imported = parseThemeImport(exportCustomTheme(pinned), known);
		assert.equal(
			imported.overrides.accentAlt.toLowerCase(),
			original.accentAlt.toLowerCase(),
		);
		assert.equal(
			imported.overrides.accentAltWash.toLowerCase(),
			original.accentAltWash.toLowerCase(),
		);
		assert.throws(
			() =>
				parseThemeImport(
					JSON.stringify({
						...legacy,
						seeds: { accentAlt: original.accentAlt },
					}),
					known,
				),
			/import_roles/,
		);
		for (const bad of [original.info, original.accent]) {
			const invalid = { ...legacy, overrides: { accentAlt: bad } };
			assert.ok(
				validateCustomPalette(deriveCustomPalette(original, invalid), id)
					.length,
			);
		}
		const reset = {
			...pinned,
			overrides: { accentAltWash: pinned.overrides.accentAltWash },
		};
		assert.equal(
			deriveCustomPalette(original, reset).accentAlt,
			original.accentAlt,
		);
		assert.equal(reset.overrides.accentAltWash, original.accentAltWash);
	}
});

test("custom global primary layer preserves secondary or refuses; built-in swap is unchanged", () => {
	for (const id of ["localOperatorDark", "localOperatorLight"]) {
		const original = base(id);
		for (const contrast of [0, -30, 30]) {
			const contrasted = composeTheme(original, { id, contrast }).palette;
			for (const accent of [
				{ kind: "theme-alt" },
				{ kind: "custom", hex: original.accent },
				{ kind: "custom", hex: "#8654B6" },
			]) {
				const result = composeTheme(original, {
					id,
					contrast,
					accent,
					preserveSecondary: true,
				});
				assert.equal(result.palette.accentAlt, contrasted.accentAlt);
				assert.equal(result.palette.accentAltWash, contrasted.accentAltWash);
				assert.deepEqual(validateCustomPalette(result.palette, id), []);
				if (accent.kind === "theme-alt")
					assert.equal(result.accentApplied, false);
			}
		}
		const builtin = composeTheme(original, {
			id,
			accent: { kind: "theme-alt" },
		});
		assert.equal(builtin.accentApplied, true);
		assert.notEqual(builtin.palette.accentAlt, original.accentAlt);
	}
});
