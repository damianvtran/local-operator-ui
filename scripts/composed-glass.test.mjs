/** Glass is measured against the composed VALUES and the actual alpha stack,
 * not the opaque theme contract or a generated name. Pure math coverage; this
 * is deliberately not an OS/native renderer claim. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import {
	BACKDROP_GRAY,
	GLASS_BLOCK_VEIL_STEP,
	GLASS_INKS,
	GLASS_LANE_STEP,
	GLASS_ROLES,
	GLASS_STATE_STEP,
	composite,
	glassFloorsForPalette,
	gray,
	ratio,
} from "../src/shared/glass-derivation.mjs";
import { deltaE } from "../src/shared/theme-engine/color.mjs";
import { composeTheme } from "../src/shared/theme-engine/compose.mjs";
import { loadPalettes } from "./palette-source.mjs";
const bundled = await build({
	stdin: {
		contents: 'export { glassPaintFor } from "./src/shared/window-glass";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
});
const { glassPaintFor } = await import(
	`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const byId = Object.fromEntries(
	loadPalettes().map(({ id, palette }) => [id, palette]),
);

/** Exercise the actual renderer paint, including the whole dependent stack.
 * Keep failures enumerated by input: a first throw must not hide later cases. */
function verifyGlassPaint(palette, label) {
	const floors = glassFloorsForPalette(palette);
	for (const [material, tier] of [
		["window", "under-window"],
		["menu", "menu"],
		["popover", "popover"],
	]) {
		for (const intensity of [0, 50, 80, 100]) {
			const { vars } = glassPaintFor({
				scheme: palette.mode,
				mechanism: "vibrancy",
				material,
				intensity,
				coverage: "full",
				floors,
			});
			const context = `${label}/${material}/${intensity}`;
			for (const role of GLASS_ROLES) {
				const alpha = Number(vars[`--lo-glass-a-${role}`]);
				assert.ok(alpha < 1 && alpha > 0, `${context}/${role}: alpha ${alpha}`);
				const ground = composite(
					palette[role],
					alpha,
					gray(BACKDROP_GRAY[tier][palette.mode]),
				);
				for (const ink of GLASS_INKS) {
					assert.ok(
						ratio(palette[ink], ground) >= 4.5,
						`${context}/${role}/${ink}: ground`,
					);
					for (const [state, a] of Object.entries(floors.stateAlpha)) {
						const stepped = composite(palette.ink, a, ground);
						assert.ok(
							ratio(palette[ink], stepped) >= (ink === "inkDim" ? 3.5 : 4.5),
							`${context}/${role}/${ink}/${state}: ${ratio(palette[ink], stepped)}`,
						);
						if (GLASS_STATE_STEP[state])
							assert.ok(
								deltaE(stepped, ground) >= GLASS_STATE_STEP[state],
								`${context}/${role}/${state}: visible step`,
							);
					}
				}
				assert.ok(
					ratio(palette.accent, ground) >= 3,
					`${context}/${role}: focus ring`,
				);
				if (role === "canvas") {
					const veil = composite(
						palette.ink,
						floors.blockVeil[palette.mode],
						ground,
					);
					assert.ok(
						deltaE(veil, ground) >= GLASS_BLOCK_VEIL_STEP,
						`${context}: block step`,
					);
					for (const ink of GLASS_INKS)
						assert.ok(
							ratio(palette[ink], veil) >= (ink === "inkDim" ? 3.5 : 4.5),
							`${context}/${ink}: block ink`,
						);
					const lane = composite(
						palette[floors.laneWash[palette.mode].role],
						Number(vars["--lo-glass-a-lane"]),
						ground,
					);
					assert.ok(
						deltaE(lane, ground) >= GLASS_LANE_STEP,
						`${context}: lane step`,
					);
				}
				const edge = composite(
					palette.ink,
					Number(vars["--lo-glass-control-mix"]),
					palette.borderControl,
				);
				assert.ok(ratio(edge, ground) >= 3, `${context}/${role}: control edge`);
			}
			const bandAlpha = Math.max(
				Number(vars["--lo-glass-a-elevated"]),
				Number(vars["--lo-glass-a-band-floor"]),
			);
			const band = composite(
				palette.elevated,
				bandAlpha,
				palette.mode === "dark" ? "#ffffff" : "#000000",
			);
			assert.ok(
				ratio(palette.inkMuted, band) >= 4.5,
				`${context}: sticky count`,
			);
		}
	}
}

for (const id of ["localOperatorDark", "localOperatorLight", "dracula"]) {
	test(`${id}: all contrast presets, continuous values and custom accents keep measured glass`, () => {
		for (const contrast of [-100, -50, 0, 50, 100, -73, 31]) {
			const palette = composeTheme(byId[id], {
				contrast,
				accent: { kind: "custom", hex: "#ff6644" },
			}).palette;
			verifyGlassPaint(palette, `${id}/${contrast}/custom`);
		}
	});
}

const PRESETS = [-100, -50, 0, 50, 100];
test("complete supported glass matrix: 295 authored compositions plus borrowed/custom accents and failing neighbors", () => {
	const cases = [];
	for (const id of Object.keys(byId))
		for (const contrast of PRESETS)
			cases.push({
				id,
				contrast,
				accent: { kind: "theme" },
				group: "authored",
			});
	/* UX's persisted borrowed-accent failure: High on the light brand is NOT
	 * equivalent to pristine High. Include every permitted palette accent. */
	for (const id of Object.keys(byId))
		cases.push({
			id: "localOperatorLight",
			contrast: 100,
			accent: { kind: "palette", id },
			group: "borrowed",
		});
	for (const [id, values] of [
		["linen", [-51, -50, -49, -1, 0, 1]],
		["mintLight", [-100, -99]],
		["localOperatorLight", [99, 100]],
	])
		for (const contrast of values)
			for (const accent of [
				{ kind: "palette", id: "radient" },
				{ kind: "custom", hex: "#ff6644" },
				{ kind: "custom", hex: "#2563eb" },
			])
				cases.push({ id, contrast, accent, group: "neighbors" });
	const failures = [];
	const counts = {};
	for (const { id, contrast, accent, group } of cases) {
		const label = `${id}/${contrast}/${JSON.stringify(accent)}`;
		counts[group] = (counts[group] ?? 0) + 1;
		try {
			const palette = composeTheme(byId[id], {
				contrast,
				accent,
				paletteAccent: (id) => byId[id]?.accent,
			}).palette;
			verifyGlassPaint(palette, label);
		} catch (error) {
			failures.push(`${label}: ${error.message}`);
		}
	}
	console.log(
		`Complete glass matrix ${JSON.stringify(counts)}; failures=${JSON.stringify(failures)}`,
	);
	assert.equal(counts.authored, 295);
	assert.deepEqual(
		failures,
		[],
		"every supported case must derive and keep actual paint floors",
	);
});

test("Mint Light Soft re-solves the canvas when its text-only floor cannot support a lane", () => {
	const palette = composeTheme(byId.mintLight, { contrast: -100 }).palette;
	const oldGround = composite(
		palette.canvas,
		0.22,
		gray(BACKDROP_GRAY["under-window"].light),
	);
	assert.ok(
		deltaE(composite(palette.surface, 0.23, oldGround), oldGround) <
			GLASS_LANE_STEP,
		"negative control: even the old maximum 1.04 scale misses the lane floor",
	);
	const floors = glassFloorsForPalette(palette);
	assert.ok(floors.alphaFloor["under-window"].light.canvas > 0.22);
	assert.ok(floors.alphaFloor["under-window"].light.canvas < 1);
	verifyGlassPaint(palette, "mintLight/-100/joint-ground");
});

test("Dracula Soft repairs the impossible authored selection rather than disabling glass", () => {
	const palette = composeTheme(byId.dracula, { contrast: -100 }).palette;
	assert.ok(
		ratio(palette.inkMuted, composite(palette.ink, 0.08, palette.elevated)) <
			4.5,
		"negative control: even opaque elevated cannot hold the old state overlay",
	);
	const floors = glassFloorsForPalette(palette);
	assert.equal(floors.stateAlpha.selected, 0.06);
	assert.ok(floors.alphaFloor.popover.dark.elevated < 1);
});

/* Source pins complement, not replace, the real Storybook alpha readbacks. The
 * duplicate opaque header and unmarked composer are the regressions they catch. */
const READING_COLUMN =
	/<section[\s\S]{0,300}data-glass-region="canvas-content"/;
const SPLIT_MARKER = /data-glass-split=/;
const HEADER_FILL = /<header[^>]*className="[^"]*bg-canvas/;
test("Bridge assigns the shared alpha owners without a second opaque header", () => {
	const base = "src/renderer/src/features/team-bridge/";
	const page = readFileSync(`${base}team-bridge-page.tsx`, "utf8");
	const thread = readFileSync(`${base}team-bridge-thread-pane.tsx`, "utf8");
	const composer = readFileSync(`${base}team-bridge-composer.tsx`, "utf8");
	assert.ok(page.includes('data-glass-split=""'));
	assert.match(page, READING_COLUMN);
	assert.doesNotMatch(page, HEADER_FILL);
	assert.ok(thread.includes('data-glass-region="page-sidebar"'));
	assert.ok(thread.includes('data-glass-region="composer"'));
	assert.ok(composer.includes('data-glass-region="composer"'));
	assert.doesNotMatch(
		page.replace('data-glass-split=""', ""),
		SPLIT_MARKER,
		"negative control: removing the split loses the single-alpha owner",
	);
});
