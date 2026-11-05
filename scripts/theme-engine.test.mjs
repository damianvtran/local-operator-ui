import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	applyAccent,
	normalizeHex,
} from "../src/shared/theme-engine/accent.mjs";
import {
	CUSTOM_ACCENTS_LIMIT,
	DEFAULT_ACCENT,
	DEFAULT_CONTRAST,
	pushCustomAccent,
	sanitizeAccent,
	sanitizeContrast,
	sanitizeCustomAccents,
	sanitizeCustomThemes,
} from "../src/shared/theme-engine/appearance.mjs";
import { over, ratio } from "../src/shared/theme-engine/color.mjs";
import {
	composeTheme,
	paletteHash,
} from "../src/shared/theme-engine/compose.mjs";
import { ARRIVAL_BAND_ALPHA } from "../src/shared/theme-engine/contract-tables.mjs";
import {
	CONTRAST_PRESETS,
	INK_ORDER_TOLERANCE,
	applyContrast,
	composedFindings,
	contrastCandidate,
	pickOnAccent,
} from "../src/shared/theme-engine/contrast.mjs";
import {
	isSafePaletteValue,
	paletteBlock,
} from "../src/shared/theme-engine/css.mjs";
import { loadPalettes } from "./palette-source.mjs";

/*
 * The theme composition engine (src/shared/theme-engine/), at the pure level.
 *
 * WHAT IS PINNED HERE, and what is pinned elsewhere:
 *  - Standard is IDENTITY by reference for all 59 built-ins, and the CSS emitter
 *    is byte-identical to the committed generated file - so today's users run
 *    today's path.
 *  - The legibility guarantee: whatever compose/contrast/accent return, the
 *    contract's own per-palette assertions hold over it, on a sample of the fleet
 *    and a seeded set of custom accents. The FULL fleet at every preset, uncapped,
 *    is `node scripts/check-contrast-presets.mjs` in `pnpm check-themes`, which
 *    runs the whole contract - this file keeps the desktop suite fast.
 *  - The solver beats its own starting point: a raw (unrepaired) candidate fails
 *    the contract on the palettes the repair then fixes, so the repair is not a
 *    no-op that happens to be green.
 *  - Persistence: the v5 sanitisers. The store's migrate/merge use them and are
 *    exercised through the real store in `appearance-store.test.mjs`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const palettes = loadPalettes();
const byId = Object.fromEntries(palettes.map((e) => [e.id, e.palette]));
const paletteAccent = (id) => byId[id]?.accent;

/* A spread of the fleet: both brand palettes, the near-black and near-white
   monochromes, a low-chroma light theme and the palettes the solver found
   hardest during development (arcade's media well at High, gruvbox and
   tokyoNightStorm's hue pairs at Soft, duskfox's step ceiling). */
const SAMPLE = [
	"localOperatorDark",
	"localOperatorLight",
	"obsidian",
	"highContrastLight",
	"paper",
	"githubLight",
	"arcade",
	"gruvbox",
	"tokyoNightStorm",
	"duskfox",
];

test("Standard with the theme's accent is the built-in object itself, for all 59", () => {
	assert.equal(palettes.length, 59);
	for (const { id, palette } of palettes) {
		const r = composeTheme(palette, { id });
		assert.equal(r.identity, true, id);
		assert.equal(r.palette, palette, `${id}: not the same reference`);
		assert.equal(r.id, id);
		assert.equal(applyContrast(palette, 0).palette, palette);
	}
});

test("paletteBlock emits exactly the committed generated block for every built-in", () => {
	const css = readFileSync(
		join(ROOT, "src/renderer/src/styles/themes.generated.css"),
		"utf8",
	);
	for (const { id, palette } of palettes) {
		assert.ok(
			css.includes(paletteBlock(id, palette)),
			`${id}: runtime block differs from the static one`,
		);
	}
});

test("every named preset composes legibly and uncapped on the sample", () => {
	for (const id of SAMPLE) {
		for (const [name, c] of Object.entries(CONTRAST_PRESETS)) {
			if (c === 0) continue;
			const r = applyContrast(byId[id], c, { id });
			assert.equal(r.effectiveContrast, c, `${id} capped at ${name}`);
			assert.deepEqual(composedFindings(r.palette, id), [], `${id} @ ${name}`);
			assert.notEqual(r.palette, byId[id]);
		}
	}
});

test("the repair is doing real work: raw candidates fail where the solved ones pass", () => {
	let rawFailures = 0;
	for (const id of SAMPLE)
		for (const c of [-100, 100])
			rawFailures += composedFindings(
				contrastCandidate(byId[id], c),
				id,
			).length;
	assert.ok(rawFailures > 0, "the unrepaired candidate was already clean");
});

test("High darkens a dark canvas and Soft lifts it; light High brightens where it can and always sharpens", () => {
	const L = (hex) => {
		const v = Number.parseInt(hex.slice(1, 3), 16);
		return v;
	};
	const dark = byId.obsidian;
	const light = byId.localOperatorLight;
	const high = applyContrast(dark, 100, { id: "obsidian" }).palette;
	const soft = applyContrast(dark, -100, { id: "obsidian" }).palette;
	assert.ok(L(high.canvas) < L(dark.canvas), "High: darker canvas");
	assert.ok(L(soft.canvas) > L(dark.canvas), "Soft: lighter canvas");
	assert.ok(
		ratio(high.ink, high.canvas) > ratio(dark.ink, dark.canvas),
		"High: more contrast",
	);
	assert.ok(
		ratio(soft.ink, soft.canvas) < ratio(dark.ink, dark.canvas),
		"Soft: less contrast",
	);
	const lHigh = applyContrast(light, 100, {
		id: "localOperatorLight",
	}).palette;
	const lSoft = applyContrast(light, -100, {
		id: "localOperatorLight",
	}).palette;
	/* Light High never darkens the paper and always raises ink contrast. It
	   cannot always LIFT it: the brand light palette authors its message block
	   4.07 ΔE00 off the canvas on a 4.0 floor, with `elevated` at L* 99.3, so
	   there is no room under white (see CONTRAST_ANCHORS). Palettes with room
	   do rise - kanagawaLotus 85.6 -> 94.4 L*. */
	assert.ok(
		L(lHigh.canvas) >= L(light.canvas),
		"light High: never darker paper",
	);
	assert.ok(
		ratio(lHigh.ink, lHigh.canvas) > ratio(light.ink, light.canvas),
		"light High: more contrast",
	);
	const lotus = applyContrast(byId.kanagawaLotus, 100, {
		id: "kanagawaLotus",
	}).palette;
	assert.ok(
		L(lotus.canvas) > L(byId.kanagawaLotus.canvas) + 15,
		"light High lifts the paper where the ladder has room",
	);
	assert.ok(L(lSoft.canvas) < L(light.canvas), "light Soft: duller paper");
});

/* The order the presets gate asserts fleet-wide (QA round 1, Q1/Q2), on the
   palettes QA measured going the wrong way - a fast sample for the desktop suite. */
test("ink on canvas is non-decreasing Soft -> High on the palettes QA flagged", () => {
	for (const id of [
		"githubLight",
		"oneLight",
		"ayuDark",
		"localOperatorLight",
	]) {
		const steps = [-100, -50, 0, 50, 100].map((c) => {
			const p = applyContrast(byId[id], c, { id }).palette;
			return ratio(p.ink, p.canvas);
		});
		for (let i = 1; i < steps.length; i++)
			assert.ok(
				steps[i] >= steps[i - 1] - INK_ORDER_TOLERANCE,
				`${id}: ${steps.map((s) => s.toFixed(2)).join(" -> ")}`,
			);
		assert.ok(
			steps[4] > steps[2],
			`${id}: High has more ink contrast than Standard`,
		);
	}
});

test("the engine never mutates a built-in palette", () => {
	const before = JSON.stringify(byId.dracula);
	composeTheme(byId.dracula, {
		id: "dracula",
		contrast: 100,
		accent: { kind: "custom", hex: "#00AAFF" },
	});
	applyContrast(byId.dracula, -100, { id: "dracula" });
	assert.equal(JSON.stringify(byId.dracula), before);
});

test("contrast outside -100..100 or fractional is refused, not clamped silently", () => {
	assert.throws(() => applyContrast(byId.nord, 101), RangeError);
	assert.throws(() => applyContrast(byId.nord, 2.5), RangeError);
});

/* Seeded so a failure reproduces: the same 12 hexes every run. */
const seeded = (n, seed = 7) => {
	let s = seed;
	const next = () => {
		s = (Math.imul(s, 1103515245) + 12345) >>> 0;
		return s / 2 ** 32;
	};
	return Array.from(
		{ length: n },
		() =>
			`#${Math.floor(next() * 0xffffff)
				.toString(16)
				.padStart(6, "0")
				.toUpperCase()}`,
	);
};

test("accents: an applied accent always passes the contract; a refused one leaves the palette untouched", () => {
	/* A small seeded sample, so the desktop suite stays fast; the full property
	   sweep (every same-mode accent and 64 seeded hexes x 59 x 5 presets) is the
	   PR's recorded evidence, not a per-run cost. */
	const hexes = seeded(4);
	let applied = 0;
	for (const id of ["dracula", "localOperatorLight", "obsidian"]) {
		for (const c of [0, 100, -100]) {
			const base = applyContrast(byId[id], c, { id }).palette;
			for (const hex of hexes) {
				const r = applyAccent(
					base,
					{ kind: "custom", hex },
					{ authored: byId[id], id },
				);
				if (!r.applied) {
					assert.equal(
						r.palette,
						base,
						`${id} ${c} ${hex}: refused but changed`,
					);
					continue;
				}
				applied++;
				assert.deepEqual(
					composedFindings(r.palette, id),
					[],
					`${id} ${c} ${hex}`,
				);
				assert.ok(ratio(r.palette.onAccent, r.palette.accent) >= 4.5);
			}
		}
	}
	assert.ok(applied > 0, "no custom accent was ever applied");
});

/*
 * THE ARRIVAL BAND IS INSIDE THE ORACLE (agent review round 1, M1 on #1674).
 * The contract asserts the Team Bridge arrival band (accent at 12% over
 * `surface`) must outrank `rowSelected` and `rowHover`; before the band moved
 * into `evaluatePalette`, these custom accents were APPLIED although
 * `pnpm check-themes` rejected the result (nightfox: band 1.137 vs selected
 * 1.138; ocean at High: 1.095 vs 1.127). Each must now be re-solved into a
 * palette the contract accepts, or refused with the input palette returned.
 */
test("accents: the arrival band's rank is honoured (nightfox Standard, ocean High, #FF0000)", () => {
	for (const [id, contrast] of [
		["nightfox", 0],
		["ocean", 100],
	]) {
		const r = composeTheme(byId[id], {
			contrast,
			accent: { kind: "custom", hex: "#FF0000" },
			id,
		});
		assert.deepEqual(composedFindings(r.palette, id), [], `${id} ${contrast}`);
		const band = over(r.palette.accent, r.palette.surface, ARRIVAL_BAND_ALPHA);
		const arrival = ratio(band, r.palette.surface);
		assert.ok(
			arrival > ratio(r.palette.rowSelected, r.palette.surface),
			`${id} ${contrast}: the band outranks the selected row`,
		);
		if (!r.accentApplied) {
			const plain = applyContrast(byId[id], contrast, { id }).palette;
			assert.equal(
				r.palette.accent,
				plain.accent,
				`${id}: refused leaves the accent`,
			);
		}
	}
});

test("accents: every same-mode palette's accent applies on the brand palettes at Standard", () => {
	for (const host of ["localOperatorDark", "localOperatorLight"]) {
		const mode = byId[host].mode;
		const refused = [];
		for (const { id } of palettes) {
			if (id === host || byId[id].mode !== mode) continue;
			const r = composeTheme(byId[host], {
				id: host,
				accent: { kind: "palette", id },
				paletteAccent,
			});
			if (!r.accentApplied) refused.push(id);
			else assert.deepEqual(composedFindings(r.palette, host), []);
		}
		assert.deepEqual(refused, [], `${host} refused accents from ${refused}`);
	}
});

test("accent: the second-hue swap keeps two accents two", () => {
	const r = composeTheme(byId.dracula, {
		id: "dracula",
		accent: { kind: "theme-alt" },
	});
	assert.equal(r.accentApplied, true);
	assert.equal(r.palette.accentAlt, normalizeHex(byId.dracula.accent));
});

test("text on accent: authored ink first, then the theme's inks, then white/black", () => {
	assert.equal(pickOnAccent("#000000", ["#FFFFFF", "#000000"]), "#FFFFFF");
	assert.equal(pickOnAccent("#FFFFFF", ["#FFFFFF", "#111111"]), "#111111");
	assert.equal(pickOnAccent("#1D4ED8", ["#ffffff", "#000000"]), "#FFFFFF");
	/* No candidate clears 4.5: the strongest one, never an unreadable first. */
	assert.equal(pickOnAccent("#808080", ["#999999", "#000000"]), "#000000");
	/* Non-hex candidates (a scrim-like CSS value) are skipped, not parsed. */
	assert.equal(
		pickOnAccent("#000000", ["rgb(0 0 0 / 1)", "#FFFFFF"]),
		"#FFFFFF",
	);
});

test("a composition's id changes with its values and stays inside the overlay's sanitiser", () => {
	const a = composeTheme(byId.nord, { id: "nord", contrast: 50 });
	const b = composeTheme(byId.nord, { id: "nord", contrast: 100 });
	const a2 = composeTheme(byId.nord, { id: "nord", contrast: 50 });
	assert.notEqual(a.id, b.id);
	assert.equal(a.id, a2.id, "deterministic");
	for (const id of [a.id, b.id]) assert.match(id, /^lo-[0-9a-z]{1,8}$/);
	assert.equal(
		paletteHash({ b: "1", a: "2" }),
		paletteHash({ a: "2", b: "1" }),
	);
});

test("the CSS value grammar refuses anything that could escape a declaration", () => {
	for (const v of [
		"#1A2B3C",
		"rgb(3 3 7 / 0.65)",
		"0 12px 32px -12px rgb(3 3 7 / 0.8)",
	])
		assert.equal(isSafePaletteValue(v), true, v);
	for (const v of [
		"red",
		"#12345",
		"#1A2B3C; } body { x: y",
		"rgb(1 2 3)",
		"url(x)",
		"",
	])
		assert.equal(isSafePaletteValue(v), false, v);
	for (const { palette } of palettes)
		for (const [role, v] of Object.entries(palette))
			if (role !== "mode")
				assert.equal(
					isSafePaletteValue(v),
					true,
					`${role}=${v} is shipped but refused`,
				);
});

test("persistence sanitisers: defaults on garbage, clamps, de-dupes and caps", () => {
	assert.deepEqual(sanitizeContrast(undefined), DEFAULT_CONTRAST);
	assert.deepEqual(sanitizeContrast({ dark: 250, light: -7.6 }), {
		dark: 100,
		light: -8,
	});
	assert.deepEqual(sanitizeContrast({ dark: "50", light: Number.NaN }), {
		dark: 0,
		light: 0,
	});
	assert.deepEqual(sanitizeAccent(null), DEFAULT_ACCENT);
	const isThemeName = (id) => id in byId;
	assert.deepEqual(
		sanitizeAccent(
			{
				dark: { kind: "palette", id: "gone" },
				light: { kind: "custom", hex: "abc" },
			},
			isThemeName,
		),
		{ dark: { kind: "theme" }, light: { kind: "custom", hex: "#AABBCC" } },
	);
	assert.deepEqual(
		sanitizeAccent({ dark: { kind: "custom", hex: "red" } }).dark,
		{
			kind: "theme",
		},
	);
	assert.deepEqual(
		sanitizeCustomAccents(["#abc", "#AABBCC", "nope", 3, "#112233"]),
		["#AABBCC", "#112233"],
	);
	const many = seeded(20);
	assert.equal(sanitizeCustomAccents(many).length, CUSTOM_ACCENTS_LIMIT);
	assert.deepEqual(pushCustomAccent(["#112233", "#445566"], "#445566"), [
		"#445566",
		"#112233",
	]);
});

test("custom themes store: hex-only, known roles, valid base, unique ids", () => {
	const opts = {
		isThemeName: (id) => id in byId,
		isRole: (r) => r in byId.dracula,
	};
	const good = {
		format: "local-operator-theme",
		version: 1,
		id: "custom-abc123",
		name: "  Mine  ",
		base: "dracula",
		seeds: { canvas: "#101010", bogus: "#FFFFFF", ink: "white" },
		overrides: { scrim: "rgb(0 0 0 / 1); }", accent: "#ff00aa" },
		updatedAt: 5,
	};
	const [theme] = sanitizeCustomThemes(
		[good, { ...good }, { ...good, base: "nope", id: "custom-x" }],
		opts,
	);
	assert.deepEqual(theme, {
		...good,
		name: "Mine",
		seeds: { canvas: "#101010" },
		overrides: { accent: "#FF00AA" },
	});
	assert.equal(sanitizeCustomThemes([good, good], opts).length, 1);
	assert.deepEqual(sanitizeCustomThemes("corrupt", opts), []);
	assert.deepEqual(sanitizeCustomThemes([{ ...good, id: "../x" }], opts), []);
});

test("LO_CONTRAST_PRESET fails closed on a value it cannot honour", () => {
	for (const bad of ["abc", "101", "2.5"]) {
		const run = spawnSync(
			process.execPath,
			[join(ROOT, "scripts/contrast-contract.mjs")],
			{
				encoding: "utf8",
				env: { ...process.env, LO_CONTRAST_PRESET: bad },
			},
		);
		assert.notEqual(run.status, 0, `LO_CONTRAST_PRESET=${bad} ran`);
		assert.match(`${run.stderr}`, /LO_CONTRAST_PRESET/);
	}
});
