#!/usr/bin/env node
/**
 * Generates `src/renderer/src/styles/themes.generated.css` from the palette
 * files.
 *
 *     node scripts/generate-theme-css.mjs           # write
 *     node scripts/generate-theme-css.mjs --check   # verify up to date, CI
 *
 * ## Why generate rather than hand-write
 *
 * Two systems need the same colours during this migration: MUI (still styling
 * most of the app) and Tailwind (styling everything already ported). If those
 * two read from different places they drift, and the drift shows up as a card
 * that is one shade off from the card beside it — the exact defect that makes
 * a half-migrated app look broken rather than in progress.
 *
 * So the palette TypeScript is the single source. MUI consumes it directly as
 * hex values, which matters because ~299 `alpha()` call sites need a real
 * colour and cannot take a `var()`. Tailwind consumes the CSS variables this
 * script emits. Same numbers, two consumers, no hand-copying.
 *
 * ## Why static CSS rather than setting variables at runtime
 *
 * The theme provider could set these on `document.documentElement` at boot.
 * Emitting them as static CSS instead means the correct palette is present in
 * the stylesheet before first paint, so switching themes is a class change
 * rather than a scripted restyle, and a cold start has no flash of the wrong
 * ramp.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PALETTE_DIR = join(ROOT, "src/renderer/src/shared/themes/palettes");
const OUT = join(ROOT, "src/renderer/src/styles/themes.generated.css");
const THEME_CSS = join(ROOT, "src/renderer/src/styles/index.css");

/** camelCase role -> kebab-case custom property suffix. */
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const loadPalettes = () => {
	const out = [];
	for (const file of readdirSync(PALETTE_DIR).filter((f) => f.endsWith(".ts"))) {
		const src = readFileSync(join(PALETTE_DIR, file), "utf8");
		for (const chunk of src.split(/\bid:\s*"/).slice(1)) {
			const id = chunk.slice(0, chunk.indexOf('"'));
			const pStart = chunk.indexOf("palette: {");
			if (pStart === -1) continue;
			const entries = {};
			for (const m of chunk.slice(pStart).matchAll(/(\w+):\s*"([^"]+)"/g)) {
				if (!(m[1] in entries)) entries[m[1]] = m[2];
			}
			out.push({ id, palette: entries });
		}
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
};

const palettes = loadPalettes();
if (palettes.length === 0) {
	console.error(`No palettes found in ${PALETTE_DIR}`);
	process.exit(1);
}

const block = ({ id, palette }) => {
	const lines = Object.entries(palette)
		.filter(([role]) => role !== "mode")
		.map(([role, value]) => `\t--lo-${kebab(role)}: ${value};`)
		.join("\n");
	/* `color-scheme` makes the platform paint native scrollbars, form controls
	   and the caret to match the palette. Without it a dark theme keeps a white
	   scrollbar track, which is the single most visible "unthemed" artefact in
	   an Electron app. */
	return `[data-theme="${id}"] {\n\tcolor-scheme: ${palette.mode};\n${lines}\n}`;
};

/**
 * Re-declare Tailwind's role variables inside any scoped theme subtree.
 *
 * THE DEFECT THIS FIXES. `@theme` emits `--color-canvas: var(--lo-canvas)` on
 * `:root`. A `var()` inside a custom property is substituted where the property
 * is DECLARED, not where it is used, so `--color-canvas` is frozen to the root
 * palette's value and every descendant inherits that already-resolved colour.
 * Putting `data-theme="dracula"` on a wrapper therefore rebinds `--lo-*` for
 * the subtree while every Tailwind role utility inside it keeps painting the
 * ACTIVE theme.
 *
 * Measured before this existed, with root dark and a light-scoped subtree:
 * `--lo-canvas` was #f7f4ee (correct) while `--color-canvas` was #16130e and
 * `bg-canvas` painted rgb(22,19,14). The twelve previews in the theme picker
 * were all showing the active theme.
 *
 * The pairs are parsed out of index.css rather than restated here, so adding a
 * role to `@theme` cannot silently leave scoped previews stale.
 */
const scopedRoleBlock = () => {
	const css = readFileSync(THEME_CSS, "utf8");
	const open = css.indexOf("@theme {");
	if (open === -1) throw new Error("no @theme block in styles/index.css");

	/* Find the block's real end by matching braces, not by the first "\n}".
	   A nested rule or an added media query inside @theme would truncate a
	   naive search and silently drop every declaration after it — the failure
	   mode being a scoped theme that is correct for the first N roles and
	   stale for the rest, which is far harder to spot than all of them being
	   wrong. */
	let depth = 0;
	let close = -1;
	for (let i = css.indexOf("{", open); i < css.length; i++) {
		if (css[i] === "{") depth++;
		else if (css[i] === "}") {
			depth--;
			if (depth === 0) {
				close = i;
				break;
			}
		}
	}
	if (close === -1) throw new Error("unterminated @theme block");

	/* Strip comments before harvesting, so a pair mentioned in prose is not
	   emitted as a declaration. */
	const block = css.slice(open, close).replace(/\/\*[\s\S]*?\*\//g, "");

	/* Match ANY custom property whose value is a single --lo-* reference, not
	   just --color-*. `--shadow-overlay: var(--lo-overlay-shadow)` is exactly
	   such a pair and was being dropped, so a scoped subtree kept the root
	   theme's shadow. */
	const pairs = [...block.matchAll(/(--[\w-]+):\s*var\((--lo-[\w-]+)\)\s*;/g)];
	if (pairs.length === 0) throw new Error("no --* -> --lo-* pairs found");

	const lines = pairs.map(([, name, src]) => `\t${name}: var(${src});`).join("\n");
	return [
		"/* Scoped theme subtrees: see scripts/generate-theme-css.mjs for why this",
		"   re-declaration is required rather than redundant. */",
		`[data-theme]:not(:root) {\n${lines}\n}`,
	].join("\n");
};

const body = [
	"/*",
	" * GENERATED FILE — do not edit.",
	" *",
	" * Regenerate with `node scripts/generate-theme-css.mjs` after changing any",
	" * palette in src/renderer/src/shared/themes/palettes/. `pnpm check-themes`",
	" * fails if this file is stale.",
	" *",
	" * Source of truth: the ThemePalette objects in that directory. The floors",
	" * these values must satisfy live in docs/branding.md § 3 and are enforced",
	" * by scripts/contrast-contract.mjs.",
	" */",
	"",
	...palettes.map(block),
	"",
	scopedRoleBlock(),
	"",
].join("\n");

if (process.argv.includes("--check")) {
	let current = "";
	try {
		current = readFileSync(OUT, "utf8");
	} catch {
		console.error(`${OUT} does not exist. Run: node scripts/generate-theme-css.mjs`);
		process.exit(1);
	}
	if (current !== body) {
		console.error(
			"themes.generated.css is stale. Run: node scripts/generate-theme-css.mjs",
		);
		process.exit(1);
	}
	console.log(`themes.generated.css is up to date (${palettes.length} themes).`);
} else {
	writeFileSync(OUT, body);
	console.log(
		`Wrote ${OUT} — ${palettes.length} themes, ${Object.keys(palettes[0].palette).length - 1} roles each.`,
	);
}
