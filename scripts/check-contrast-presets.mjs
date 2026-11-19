#!/usr/bin/env node
/**
 * The contrast contract at every non-Standard contrast preset.
 *
 *     node scripts/check-contrast-presets.mjs        # Soft, Gentle, Strong, High
 *
 * WHY. The theme composition engine (`src/shared/theme-engine/`) lets a user
 * move any built-in palette's grounds along a contrast slider. Its guarantee is
 * that it never returns a palette the contract rejects - it caps instead - but a
 * guarantee that every preset is CAPPED to Standard would be green and useless.
 * So this leg runs the whole of `contrast-contract.mjs` over the 59 palettes as
 * composed at each named preset (`LO_CONTRAST_PRESET`) and additionally fails
 * when any palette did not REACH the preset: the shipped fleet must clear every
 * floor at every snap point, uncapped. A palette or floor change that makes a
 * preset unreachable fails here, in the PR that made it, rather than quietly
 * turning into "limited to Strong" on somebody's screen.
 *
 * What the contract does not assert on a composed run, and why, is in its own
 * header and in `src/shared/theme-engine/contrast.mjs`: the authored L* band,
 * the §5b fleet rules, pin/ledger staleness and window glass are claims about
 * the AUTHORED palettes. The Standard (authored) pass runs before this leg in
 * `pnpm check-themes` and keeps every one of them.
 *
 * Each preset runs in its own child, serially: the contract is a top-level
 * script that exits on failure, and four of them concurrently is memory this
 * host's budget does not have.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ratio } from "../src/shared/theme-engine/color.mjs";
import {
	CONTRAST_PRESETS,
	INK_ORDER_TOLERANCE,
	applyContrast,
} from "../src/shared/theme-engine/contrast.mjs";
import { loadPalettes } from "./palette-source.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = join(ROOT, "scripts", "contrast-contract.mjs");

const presets = Object.entries(CONTRAST_PRESETS).filter(([, c]) => c !== 0);
const authored = loadPalettes();
/* Every palette composed once at every snap point (Standard included, which is
   the authored palette), shared by the reach and the order legs below. */
const ladder = Object.entries(CONTRAST_PRESETS).sort(([, a], [, b]) => a - b);
const composed = new Map(
	authored.map(({ id, palette }) => [
		id,
		new Map(ladder.map(([, c]) => [c, applyContrast(palette, c, { id })])),
	]),
);
/* Legs are counted as they run rather than derived from `presets.length + 1`, so
   a leg added or removed later cannot make the summary's denominator lie. */
let legs = 0;
let failed = 0;
for (const [name, c] of presets) {
	/* Reached, not merely legible: a capped palette is a preset the fleet cannot
	   offer, and it is reported by name with how far it got. */
	const capped = authored
		.map(({ id }) => [id, composed.get(id).get(c).effectiveContrast])
		.filter(([, got]) => got !== c);
	const run = spawnSync(process.execPath, [CONTRACT], {
		encoding: "utf8",
		env: { ...process.env, LO_CONTRAST_PRESET: String(c) },
	});
	const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
	const summary =
		out.match(/Contrast contract (?:holds|FAILED)[^\n]*/)?.[0] ??
		"(no summary line)";
	const ok = run.status === 0 && capped.length === 0;
	console.log(`${ok ? "ok  " : "FAIL"} ${name} (${c}): ${summary}`);
	if (capped.length > 0) {
		console.log(
			`     ${capped.length} palette(s) capped below ${name}: ${capped.map(([id, got]) => `${id} -> ${got}`).join(", ")}`,
		);
	}
	if (run.status !== 0) {
		for (const line of out.split("\n").filter((l) => l.startsWith("FAIL")))
			console.log(`     ${line}`);
	}
	legs++;
	if (!ok) failed++;
}
/*
 * THE ORDER LEG (QA round 1, Q1/Q2 on #1674): reached has to mean the effect
 * happened. For every palette, `ink` on `canvas` is non-decreasing across
 * Soft -> Gentle -> Standard -> Strong -> High. Every floor held while light
 * High landed darker than Standard with less ink contrast (githubLight,
 * highContrastLight, oneLight), and dark Soft read sharper than Gentle (ayuDark,
 * nightfox, solarizedDark) - so legibility alone cannot see this. The one slack
 * is `INK_ORDER_TOLERANCE`, the engine's own: a hundredth of 8-bit quantisation
 * on palettes authored at the 8.0:1 canvas floor.
 */
const disordered = [];
for (const { id } of authored) {
	const steps = ladder.map(([name, c]) => {
		const p = composed.get(id).get(c).palette;
		return [name, ratio(p.ink, p.canvas)];
	});
	for (let i = 1; i < steps.length; i++) {
		const [[lo, a], [hi, b]] = [steps[i - 1], steps[i]];
		if (b < a - INK_ORDER_TOLERANCE)
			disordered.push(
				`${id}: ink/canvas ${a.toFixed(2)} at ${lo} > ${b.toFixed(2)} at ${hi}`,
			);
	}
}
console.log(
	`${disordered.length === 0 ? "ok  " : "FAIL"} order: ink on canvas non-decreasing Soft -> High on ${authored.length - new Set(disordered.map((d) => d.split(":")[0])).size} of ${authored.length} palettes`,
);
for (const line of disordered) console.log(`     ${line}`);
legs++;
if (disordered.length > 0) failed++;

if (failed > 0) {
	console.error(`\nContrast presets FAILED: ${failed} of ${legs} leg(s).`);
	process.exit(1);
}
console.log(
	`Contrast presets hold: ${presets.length} presets x ${authored.length} palettes, all reached uncapped and in order.`,
);
