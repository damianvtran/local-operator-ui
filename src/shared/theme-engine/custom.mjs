/** Custom themes are portable base-relative data, never snapshots of contrast.
 * Storage is forgiving of old/corrupt entries; import is deliberately strict so
 * an authored role is never silently lost at the trust boundary. No DOM or FS.
 */
import { normalizeHex } from "./accent.mjs";
import { CUSTOM_THEMES_LIMIT, sanitizeCustomTheme } from "./appearance.mjs";
import { composedFindings, pickOnAccent, repairPalette } from "./contrast.mjs";
import { createRun, evaluatePalette } from "./evaluate.mjs";
import { hexToLch, lchToHex } from "./picker.mjs";
import { PALETTE_ROLES } from "./roles.mjs";

export const ESSENTIALS = Object.freeze([
	"canvas",
	"surface",
	"ink",
	"inkMuted",
	"accent",
	"borderControl",
]);
export const COLOUR_ROLES = Object.freeze(
	PALETTE_ROLES.filter((r) => !["overlayShadow", "scrim"].includes(r)),
);
export const IMPORT_MAX_BYTES = 65536;
const HEX = /^#[0-9a-fA-F]{6}$/;
const own = (o, k) => Object.hasOwn(o, k);
const object = (o) =>
	o !== null &&
	typeof o === "object" &&
	!Array.isArray(o) &&
	[Object.prototype, null].includes(Object.getPrototypeOf(o));
const fail = (code) => {
	throw new Error(code);
};
const DEPENDENTS = {
	canvas: [
		"surface",
		"elevated",
		"sunken",
		"messageSurface",
		"mediaSurface",
		"rowHover",
		"rowSelected",
		"accentWash",
		"accentAltWash",
		"successWash",
		"warningWash",
		"dangerWash",
		"infoWash",
	],
	surface: ["elevated", "rowHover", "rowSelected"],
	ink: ["inkMuted", "inkDim", "inkDisabled"],
	inkMuted: ["inkDim"],
	accent: ["accentHover", "accentActive", "accentWash", "chartBarHover"],
	borderControl: ["hairline", "hairlineStrong"],
};

/** Reuse the base's authored LCh offsets rather than imposing a generic ladder.
 * Explicit seeds take precedence over inherited seeds; pins are applied LAST.
 * The editor reports the shared contract's failures instead of silently fixing
 * manual colours. Repair is an explicit, reviewable action only.
 */
export const deriveCustomPalette = (base, theme) => {
	const out = { ...base };
	for (const role of ESSENTIALS) {
		const seed = normalizeHex(theme.seeds?.[role]);
		if (!seed) continue;
		const old = hexToLch(base[role]);
		const next = hexToLch(seed);
		out[role] = seed;
		for (const dependent of DEPENDENTS[role]) {
			const authored = hexToLch(base[dependent]);
			out[dependent] = lchToHex({
				l: next.l + authored.l - old.l,
				c: old.c > 0.01 ? (next.c * authored.c) / old.c : authored.c,
				h: next.h + authored.h - old.h,
			});
		}
	}
	if (out.accent.toUpperCase() !== base.accent.toUpperCase())
		out.onAccent = pickOnAccent(out.accent, [
			base.onAccent,
			out.ink,
			out.canvas,
			"#000000",
			"#FFFFFF",
		]);
	for (const role of COLOUR_ROLES)
		if (HEX.test(theme.overrides?.[role] ?? ""))
			out[role] = theme.overrides[role];
	// Alpha roles are numbers, never imported CSS fragments; this closes the only
	// non-hex roles without preventing safe overlay customization.
	for (const role of ["overlayShadow", "scrim"]) {
		const alpha = theme.overrides?.[role];
		if (
			typeof alpha === "string" &&
			/^(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(alpha)
		)
			out[role] = base[role].replace(/\/\s*[\d.]+\)/, `/ ${alpha})`);
	}
	return out;
};

export const validateCustomPalette = (palette, baseId) =>
	composedFindings(palette, baseId);

/** An explicit suggestion must not overwrite any manually pinned role. If the
 * existing shared repair requires doing so, refuse it rather than lose work.
 */
export const suggestCustomAdjustment = (base, theme) => {
	const palette = deriveCustomPalette(base, theme);
	const repaired = repairPalette(palette, theme.base, base, {
		pinned: Object.keys(theme.overrides ?? {}),
		maxEvaluations: 320,
		lightnessOnly: true,
	}).palette;
	if (!repaired) return null;
	const pins = Object.keys(theme.overrides ?? {});
	if (pins.some((role) => repaired[role] !== palette[role])) return null;
	const overrides = { ...theme.overrides };
	for (const role of COLOUR_ROLES)
		if (repaired[role] !== palette[role]) overrides[role] = repaired[role];
	const candidate = { ...theme, overrides };
	return validateCustomPalette(deriveCustomPalette(base, candidate), theme.base)
		.length
		? null
		: candidate;
};

export const parseThemeImport = (
	text,
	isThemeName,
	{ id = "custom-import", now = Date.now() } = {},
) => {
	if (
		typeof text !== "string" ||
		new TextEncoder().encode(text).length > IMPORT_MAX_BYTES
	)
		fail("import_size");
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		fail("import_invalid_json");
	}
	if (!object(raw)) fail("import_format");
	const allowed = new Set([
		"format",
		"version",
		"name",
		"base",
		"seeds",
		"overrides",
		"id",
		"updatedAt",
	]);
	if (Object.keys(raw).some((k) => !allowed.has(k))) fail("import_unsafe");
	if (raw.format !== "local-operator-theme") fail("import_format");
	if (raw.version !== 1) fail("import_version");
	if (typeof raw.base !== "string" || !isThemeName(raw.base))
		fail("import_base");
	if (
		typeof raw.name !== "string" ||
		!raw.name.trim() ||
		raw.name.trim().length > 60
	)
		fail("import_name");
	const maps = {};
	for (const field of ["seeds", "overrides"]) {
		if (!own(raw, field) || !object(raw[field])) fail("import_roles");
		const map = {};
		for (const [role, value] of Object.entries(raw[field])) {
			const roles = field === "seeds" ? ESSENTIALS : PALETTE_ROLES;
			if (!roles.includes(role) || typeof value !== "string")
				fail("import_roles");
			if (["overlayShadow", "scrim"].includes(role)) {
				if (!/^(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(value))
					fail("import_roles");
				map[role] = value;
			} else {
				if (!HEX.test(value)) fail("import_roles");
				map[role] = value.toUpperCase();
			}
		}
		maps[field] = map;
	}
	return {
		format: "local-operator-theme",
		version: 1,
		id,
		name: raw.name.trim(),
		base: raw.base,
		...maps,
		updatedAt: now,
	};
};

/** Stored schemas are migrated through the same bounded parser. A bad entry
 * cannot poison preferences or discard valid neighbours. No recursive descent.
 */
export const readCustomThemeStorage = (text, isThemeName) => {
	if (text == null) return [];
	if (
		typeof text !== "string" ||
		text.length > IMPORT_MAX_BYTES * CUSTOM_THEMES_LIMIT
	)
		fail("load_error");
	let blob;
	try {
		blob = JSON.parse(text);
	} catch {
		fail("load_error");
	}
	const list = Array.isArray(blob)
		? blob
		: blob?.version === 1
			? blob.themes
			: null;
	if (!Array.isArray(list)) fail("load_error");
	const result = [];
	const ids = new Set();
	for (const entry of list.slice(0, CUSTOM_THEMES_LIMIT)) {
		try {
			const clean = sanitizeCustomTheme(entry, {
				isThemeName,
				isRole: (r) => PALETTE_ROLES.includes(r),
			});
			if (!clean || ids.has(clean.id)) continue;
			const theme = parseThemeImport(JSON.stringify(entry), isThemeName, {
				id: clean.id,
				now: clean.updatedAt,
			});
			result.push(theme);
			ids.add(theme.id);
		} catch {
			/* A malformed neighbour is isolated, not applied partially. */
		}
	}
	return result;
};

export const exportCustomTheme = (theme) =>
	JSON.stringify(
		{
			format: "local-operator-theme",
			version: 1,
			name: theme.name,
			base: theme.base,
			seeds: theme.seeds,
			overrides: theme.overrides,
		},
		null,
		2,
	);

export const uniqueThemeName = (name, themes) => {
	const names = new Set(themes.map((t) => t.name));
	if (!names.has(name)) return name;
	for (let n = 2; n <= CUSTOM_THEMES_LIMIT + 1; n++) {
		const candidate = `${name.slice(0, 54)} (${n})`;
		if (!names.has(candidate)) return candidate;
	}
	return name;
};

/** Numeric chips and blocking findings come from ONE evaluation, not a second
 * hand-written contrast table that could go green while the real gate fails. */
export const customPaletteReadings = (palette, id) => {
	const run = createRun({ composed: true, capturePairs: true });
	evaluatePalette(run, { id, palette });
	return { findings: run.log, readings: run.readings };
};
