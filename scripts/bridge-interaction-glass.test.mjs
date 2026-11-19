/** The pseudo-element, loading mark and floating strip must consume the shared
 * glass roles rather than duplicate palette colors. This guards the wiring;
 * browser evidence separately measures the real CSS paint and pointer paths. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import {
	BACKDROP_GRAY,
	composite,
	glassFloorsForPalette,
	gray,
	ratio,
} from "../src/shared/glass-derivation.mjs";
import { deltaE } from "../src/shared/theme-engine/color.mjs";
import { composeTheme } from "../src/shared/theme-engine/compose.mjs";
import { loadPalettes } from "./palette-source.mjs";

const read = (path) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("src/renderer/src/styles/index.css");
const row = read(
	"src/renderer/src/features/team-bridge/team-bridge-message-list.tsx",
);
const toolbar = read(
	"src/renderer/src/features/team-bridge/team-bridge-message-toolbar.tsx",
);
const skeleton = read("src/renderer/src/shared/components/ui/skeleton.tsx");

// Read the component's actual utility and its stylesheet keyframes. A hardcoded
// 0.7 once let this model pass while Tailwind's default pulse painted at 0.5.
const pulseClass = skeleton
	.match(/cn\("([^"]+)"/)?.[1]
	.split(/\s+/)
	.find((name) => name.startsWith("animate-"));
assert.ok(pulseClass, "Skeleton must declare its animation utility");
const pulseName = pulseClass.slice("animate-".length);
const pulseCss = css.includes(`--animate-${pulseName}:`)
	? css
	: read("node_modules/tailwindcss/theme.css");
const keyframeName = pulseCss.match(
	new RegExp(`--animate-${pulseName}:\\s*([\\w-]+)`),
)?.[1];
assert.ok(keyframeName, `${pulseClass}: missing animation definition`);
const keyframeStart = pulseCss.indexOf(`@keyframes ${keyframeName} {`);
assert.ok(keyframeStart >= 0, `${pulseClass}: missing keyframes`);
let keyframeEnd = pulseCss.indexOf("{", keyframeStart) + 1;
let depth = 1;
while (depth > 0 && keyframeEnd < pulseCss.length) {
	if (pulseCss[keyframeEnd] === "{") depth += 1;
	if (pulseCss[keyframeEnd] === "}") depth -= 1;
	keyframeEnd += 1;
}
assert.equal(depth, 0, `${pulseClass}: unterminated keyframes`);
const pulseOpacities = [
	...pulseCss
		.slice(keyframeStart, keyframeEnd)
		.matchAll(/opacity:\s*([\d.]+)/g),
].map((match) => Number(match[1]));
assert.ok(pulseOpacities.length > 0, `${pulseClass}: missing opacity stops`);
const pulseTrough = Math.min(...pulseOpacities);
const VISIBLE_PULSE_END = /100%\s*\{\s*opacity:\s*1\s*;/;

test("Skeleton's used animation and stylesheet share the visible pulse floor", () => {
	assert.equal(pulseClass, "animate-pulse-visible");
	assert.ok(pulseTrough >= 0.7, `actual ${pulseClass} trough ${pulseTrough}`);
	// The shared reduced-motion rule runs one near-instant iteration, so its
	// final frame must be visible rather than stranding a transparent mark.
	assert.match(pulseCss.slice(keyframeStart, keyframeEnd), VISIBLE_PULSE_END);
	assert.ok(css.includes("animation-duration: 0.01ms !important"));
	assert.ok(css.includes("animation-iteration-count: 1 !important"));
});

test("inset message hover and keyboard focus use the same shared glass roles", () => {
	for (const role of ["surface", "elevated"]) {
		assert.ok(row.includes(`hover:before:bg-row-hover-${role}`));
		assert.ok(row.includes(`focus-within:before:bg-row-hover-${role}`));
		// Opaque fallback routes through the themed `--color-<role>` token, not
		// `--lo-<role>`: scripts/generate-theme-css.mjs forbids aliasing one
		// `--lo-*` role twice, and #1700 already aliases these roles. The resolved
		// value is unchanged (same palette role on :root).
		assert.ok(css.includes(`--color-row-hover-${role}: var(--color-${role})`));
		assert.ok(
			css.includes(`--color-row-hover-${role}: var(--color-row-hover)`),
		);
	}
	assert.ok(row.includes("before:inset-x-2 before:inset-y-0"));
	assert.ok(row.includes("before:pointer-events-none"));
});

test("shared skeleton and floating toolbar preserve opaque fallbacks and independent ink", () => {
	assert.ok(
		skeleton.includes("animate-pulse-visible rounded-sm bg-placeholder"),
	);
	assert.ok(skeleton.includes('data-glass-placeholder=""'));
	assert.ok(
		css.includes(
			"[data-glass-placeholder] {\n\tbackground-color: var(--color-placeholder)",
		),
	);
	// Same one-to-one generator invariant as the row-hover fallbacks above.
	assert.ok(css.includes("--color-placeholder: var(--color-sunken)"));
	assert.ok(css.includes("--color-placeholder: var(--color-row-selected)"));
	assert.ok(toolbar.includes('data-glass-plane="floating"'));
	assert.ok(toolbar.includes("bg-floating p-0.5 shadow-overlay"));
	assert.ok(css.includes("--color-floating: var(--color-elevated)"));
	assert.ok(css.includes("backdrop-filter: var(--lo-floating-backdrop, none)"));
	assert.ok(toolbar.includes("pointer-events-none opacity-0"));
	assert.ok(toolbar.includes("group-focus-within/message:pointer-events-auto"));
	// These assignments must remain INSIDE the existing coverage-scoped role
	// block. html[data-glass] alone would also recolor uncovered solid panes.
	const start = css.indexOf(
		'html[data-glass~="sidebar"] [data-glass-region="sidebar"],',
		css.indexOf("STATES AND FIELDS ON GLASS"),
	);
	const scoped = css.slice(start, css.indexOf("\n}", start));
	for (const region of [
		"sidebar",
		"page-sidebar",
		"canvas",
		"canvas-backing",
		"panel",
		"pane",
	])
		assert.ok(scoped.includes(`data-glass-region="${region}"`));
	assert.ok(scoped.includes("--color-placeholder:"));
	assert.ok(scoped.includes("--color-floating:"));
	assert.ok(scoped.includes("--lo-target-wash: var(--color-row-selected)"));
	assert.ok(scoped.includes("--lo-target-hover-surface: transparent"));
	assert.ok(scoped.includes("--lo-target-hover-elevated: transparent"));
	assert.ok(
		css.includes(
			"--lo-target-wash,\n\t\tcolor-mix(in srgb, var(--color-accent) 12%, transparent)",
		),
	);
});

const bundle = await build({
	stdin: {
		contents: 'export {glassPaintFor} from "./src/shared/window-glass";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
});
const { glassPaintFor } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const byId = Object.fromEntries(
	loadPalettes().map(({ id, palette }) => [id, palette]),
);

test("floating strip and pulsing placeholder retain floors on their actual nested pane ground", () => {
	let minimum = Number.POSITIVE_INFINITY;
	let placeholderStep = Number.POSITIVE_INFINITY;
	let targetInk = Number.POSITIVE_INFINITY;
	for (const id of ["localOperatorDark", "localOperatorLight", "dracula"]) {
		for (const contrast of [-100, 0, 100, 31]) {
			const palette = composeTheme(byId[id], {
				contrast,
				accent: { kind: "custom", hex: "#ff6644" },
			}).palette;
			const floors = glassFloorsForPalette(palette);
			for (const intensity of [0, 50, 100]) {
				const { vars } = glassPaintFor({
					scheme: palette.mode,
					mechanism: "vibrancy",
					material: "window",
					intensity,
					coverage: "full",
					floors,
				});
				const alpha = (role) => Number(vars[`--lo-glass-a-${role}`]);
				for (const role of ["canvas", "surface"]) {
					const pane = composite(
						palette[role],
						alpha(role),
						gray(BACKDROP_GRAY["under-window"][palette.mode]),
					);
					const hover = composite(palette.ink, alpha("row-hover"), pane);
					const placeholder = composite(
						palette.ink,
						alpha("row-selected") * pulseTrough,
						pane,
					);
					placeholderStep = Math.min(
						placeholderStep,
						deltaE(placeholder, pane),
					);
					targetInk = Math.min(
						targetInk,
						ratio(
							palette.inkMuted,
							composite(palette.ink, alpha("row-selected"), pane),
						),
					);
					const floating = composite(
						palette.elevated,
						alpha("elevated"),
						hover,
					);
					const buttonHover = composite(
						palette.ink,
						alpha("row-hover"),
						floating,
					);
					const context = `${id}/${contrast}/${intensity}/${role}`;
					for (const ground of [floating, buttonHover]) {
						const measured = ratio(palette.inkMuted, ground);
						minimum = Math.min(minimum, measured);
						assert.ok(measured >= 4.5, `${context}: action ink ${measured}`);
						assert.ok(
							ratio(palette.accent, ground) >= 3,
							`${context}: focus outline`,
						);
					}
					// Skeletons contain no text. Their pulse must not fade a whole
					// pane; the selected-role alpha is a local placeholder mark only.
					assert.ok(alpha("row-selected") > 0 && alpha("row-selected") < 1);
				}
			}
		}
	}
	assert.ok(
		placeholderStep >= 2,
		`placeholder pulse trough step ${placeholderStep}`,
	);
	assert.ok(targetInk >= 4.5, `target pulse ink ${targetInk}`);
	console.log(
		`Nested action ink minimum ${minimum.toFixed(3)}:1; placeholder trough deltaE ${placeholderStep.toFixed(3)}; target ink ${targetInk.toFixed(3)}:1`,
	);
});
