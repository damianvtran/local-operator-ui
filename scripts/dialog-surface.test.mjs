/**
 * THE DIALOG SURFACE (operator, 2026-11-24): every centred popup wears one
 * shared raised treatment - a subtle gradient, a soft outline and top edge, a
 * darker backdrop - defined once and applied by the shared `DialogContent`.
 *
 *  D-1  The primitive applies it: `DialogContent` (floating) carries
 *       `lo-dialog-surface` unless a caller opts out with `surface="plain"`, and
 *       the RENDERED `DialogOverlay` carries `lo-dialog-scrim` with no `bg-*`
 *       utility beside it - checked against the cascade, not the source string:
 *       the scrim rule lives in `@layer components`, which every utility
 *       outranks, so a `bg-scrim` on the same element painted the plain scrim
 *       while a class-presence check passed (review round 1, R2/D1/Q-2).
 *  D-2  It stays OFF the other floating surfaces the operator excluded:
 *       popovers, menus, sheets, toasts, tooltips.
 *  D-3  The stylesheet block draws the outline as INSET shadows through
 *       Tailwind's `--tw-inset-*` slots (so `shadow-overlay`, the one shadow, is
 *       composed with and never replaced) and declares no border (the floating-
 *       surface rule, `floating-surface-no-border.test.mjs`).
 *  D-4  The gradient never costs an ink its floor: for every shipped palette,
 *       each ink against the WORST gradient stop (the top sheen in dark
 *       palettes, the bottom settle in light ones, composited over `elevated`
 *       the way the browser paints it) clears 4.5:1 wherever it cleared it on
 *       the plain plate.
 *  D-5  The image lightbox, which is a picture rather than a panel, opts out.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { over, ratio } from "../src/shared/theme-engine/color.mjs";
import { loadPalettes } from "./palette-source.mjs";

const UI = "src/renderer/src/shared/components/ui";
const read = (path) => readFileSync(path, "utf8");
const css = read("src/renderer/src/styles/index.css");

/** The CSS block between the dialog-surface heading and its forced-colours rule. */
const surfaceBlock = (() => {
	const start = css.indexOf("THE DIALOG SURFACE - the one surface");
	assert.ok(start > 0, "the dialog surface block is missing from index.css");
	const end = css.indexOf("@media (forced-colors: active)", start);
	return css.slice(start, end);
})();

/*
 * The shipped overlay, rendered: its class list is what the browser cascades,
 * so it is read from markup rather than grepped out of the source.
 */
const overlayBundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { Dialog, DialogOverlay } from "./src/renderer/src/shared/components/ui/dialog";
			export const renderOverlay = (className) =>
				renderToStaticMarkup(
					createElement(Dialog, { open: true }, createElement(DialogOverlay, { className })),
				);
		`,
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": JSON.stringify({}) },
	write: false,
});
const overlayPath = new URL(
	`./_dialog-overlay-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(overlayPath, overlayBundle.outputFiles[0].text);
const { renderOverlay } = await import(overlayPath.href);
await unlink(overlayPath);

/** The class list of the first element in a markup string. */
const classesOf = (html) =>
	(html.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);

test("D-1 the shared Dialog applies the raised surface and the darker scrim", () => {
	const dialog = read(`${UI}/dialog.tsx`);
	assert.match(dialog, /surface === "raised" && "lo-dialog-surface"/);
	assert.match(dialog, /surface = "raised"/, "raised is the default");
	assert.match(dialog, /THIS IS THE ONE DIALOG SURFACE/);

	const classes = classesOf(renderOverlay(undefined));
	assert.ok(
		classes.includes("lo-dialog-scrim"),
		`the overlay carries lo-dialog-scrim: ${classes.join(" ")}`,
	);
	// The scrim's colour rule sits in `components`...
	const rules = surfaceBlock.replace(/\/\*[\s\S]*?\*\//g, "");
	const layer = rules.match(
		/@layer (\w+)\s*\{[\s\S]*\.lo-dialog-scrim\s*\{([^}]*)\}/,
	);
	assert.ok(layer, "the scrim rule is inside a cascade layer");
	assert.equal(layer[1], "components");
	assert.match(layer[2], /background-color\s*:/);
	// ...so ANY background utility on the same element wins the cascade
	// (utilities is the later layer) and the darker scrim never paints.
	const rivals = classes.filter((name) => /^bg-/.test(name));
	assert.deepEqual(
		rivals,
		[],
		"a bg-* utility beside lo-dialog-scrim outranks it (layer utilities > components)",
	);
	// A caller that owns the screen may still replace it, on purpose.
	assert.ok(
		classesOf(renderOverlay("bg-transparent")).includes("bg-transparent"),
	);
});

test("D-2 no other floating primitive wears the dialog surface", () => {
	const offenders = readdirSync(UI)
		.filter((file) => file.endsWith(".tsx") && file !== "dialog.tsx")
		.filter((file) => /lo-dialog-(surface|scrim)/.test(read(`${UI}/${file}`)));
	assert.deepEqual(offenders, []);
});

test("D-3 the outline is inset shadows in Tailwind's slots, never a border", () => {
	assert.match(surfaceBlock, /--tw-inset-shadow:\s*inset 0 1px 0/);
	assert.match(surfaceBlock, /--tw-inset-ring-shadow:\s*inset 0 0 0 1px/);
	// The block may not replace the composed shadow or add a stroke.
	const rules = surfaceBlock.replace(/\/\*[\s\S]*?\*\//g, "");
	assert.doesNotMatch(rules, /(^|[\s;{])box-shadow\s*:/);
	assert.doesNotMatch(rules, /(^|[\s;{])border(-[a-z]+)?\s*:/);
	// The defaults sit in `components`, so a caller's utility still wins.
	assert.match(rules, /@layer components\s*\{/);
});

/*
 * The gradient's worst stops, as the CSS writes them: dark palettes get white
 * at 4% over `elevated` at the top; light palettes get `sunken` at 35% over
 * `elevated` at the bottom. `over` composites in sRGB bytes, which is how the
 * browser paints a translucent gradient stop on an opaque ground.
 */
const worstStop = ({ mode, elevated, sunken }) =>
	mode === "dark"
		? over("#ffffff", elevated, 0.04)
		: over(sunken, elevated, 0.35);

test("D-4 every ink keeps its floor on the worst gradient stop, in every palette", () => {
	const palettes = loadPalettes();
	assert.ok(palettes.length >= 50, `only ${palettes.length} palettes parsed`);
	const failures = [];
	let worst = { value: Number.POSITIVE_INFINITY };
	for (const { id, palette } of palettes) {
		const stop = worstStop(palette);
		for (const ink of ["ink", "inkMuted", "inkDim"]) {
			const plain = ratio(palette[ink], palette.elevated);
			const graded = ratio(palette[ink], stop);
			if (graded < worst.value) worst = { value: graded, id, ink };
			if (plain >= 4.5 && graded < 4.5)
				failures.push(
					`${id} ${ink}: ${plain.toFixed(2)} -> ${graded.toFixed(2)}`,
				);
		}
	}
	assert.deepEqual(failures, [], "the gradient dropped an ink below 4.5:1");
	// Recorded for the PR: the lowest ink/stop ratio across the palettes.
	console.log(
		`worst ink on a gradient stop: ${worst.value.toFixed(2)} (${worst.id}, ${worst.ink})`,
	);
});

test("D-5 the image lightbox opts out: it is a picture, not a panel", () => {
	const lightbox = read(
		"src/renderer/src/shared/components/common/image-lightbox.tsx",
	);
	assert.match(lightbox, /surface="plain"/);
});
