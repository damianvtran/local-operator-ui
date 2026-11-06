#!/usr/bin/env node
/**
 * The declared composites: the app's own frames over ONE fixed wallpaper.
 *
 *     node scripts/notifications-glass-composite.mjs [--out <dir>] [--cell dark-80]
 *
 * WHY THIS EXISTS, AND WHAT IT IS NOT. A headless Electron window has no OS
 * compositor material behind it, so every other frame in this directory shows the
 * app's own alphas over black — the one condition the operator never saw, because
 * they photographed a bright desktop. This step recovers that condition honestly:
 * `Page.captureScreenshot` with `omitBackground: true` keeps the composition's own
 * alpha (measured on this set: 97.5 % of the frame's pixels are translucent, mean
 * alpha 168/255), and compositing that over a fixed wallpaper is arithmetic on
 * evidence, not a painted backdrop.
 *
 * IT IS STILL NOT AN OS CAPTURE, and the filenames and the README say so. There is
 * no window material, no wallpaper the OS chose, no focus state: two images - the
 * app's alpha frame and a synthetic wallpaper - multiplied together.
 *
 * IT REFUSES RATHER THAN FABRICATES. If an input frame has no translucent pixel (a
 * capture that lost its alpha channel), this exits non-zero and writes nothing: a
 * composite of an opaque frame is the frame, and calling it "over a wallpaper"
 * would be a claim the pixels do not support.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const argOf = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : fallback;
};
const outDir = resolve(
	argOf("out", join(repoRoot, "docs", "pr-evidence", "notifications-glass")),
);
const cell = argOf("cell", "dark-80");

/**
 * THE FIXED WALLPAPER. Synthetic and deterministic on purpose: a real desktop
 * photo cannot be committed, and a random gradient cannot be compared across runs.
 * Bright (the operator's own screenshot was a bright desktop), with a few soft
 * large shapes so a blur has something to smear - a flat colour would make the
 * band's `backdrop-filter` invisible.
 */
const WALLPAPER = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1314">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fdf6ec"/>
      <stop offset="45%" stop-color="#f7dcc8"/>
      <stop offset="100%" stop-color="#d9e6f5"/>
    </linearGradient>
  </defs>
  <rect width="2048" height="1314" fill="url(#sky)"/>
  <circle cx="420" cy="300" r="330" fill="#ffd9a0" opacity="0.75"/>
  <circle cx="1500" cy="220" r="260" fill="#ffb4a2" opacity="0.6"/>
  <circle cx="1180" cy="980" r="420" fill="#a8d0e6" opacity="0.55"/>
  <circle cx="1760" cy="1120" r="300" fill="#c7e9c0" opacity="0.5"/>
  <rect x="0" y="1080" width="2048" height="234" fill="#ffffff" opacity="0.35"/>
</svg>`;

const labels = [`base-${cell}`, `head-${cell}`];

const wallpaper = await sharp(Buffer.from(WALLPAPER)).png().toBuffer();
writeFileSync(join(outDir, "wallpaper-fixed.png"), wallpaper);

let refused = 0;
for (const label of labels) {
	const alphaPath = join(outDir, `${label}-alpha.png`);
	const { data, info } = await sharp(alphaPath)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const total = info.width * info.height;
	let translucent = 0;
	let alphaSum = 0;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] < 255) translucent++;
		alphaSum += data[i];
	}
	const coverage = (100 * translucent) / total;
	const meanAlpha = alphaSum / total;
	console.log(
		`[composite] ${label}: ${info.width}x${info.height}, translucent ${coverage.toFixed(2)}% of pixels, mean alpha ${meanAlpha.toFixed(1)}/255`,
	);
	if (translucent === 0) {
		console.error(
			`[composite] REFUSED: ${label}-alpha.png is fully opaque, so compositing it over a wallpaper would produce an image identical to the frame while claiming to show something else. No composite written.`,
		);
		refused++;
		continue;
	}
	const out = await sharp(wallpaper)
		.composite([{ input: readFileSync(alphaPath) }])
		.png()
		.toBuffer();
	const file = join(outDir, `${label}-on-wallpaper.png`);
	writeFileSync(file, out);
	console.log(`[composite] wrote ${file}`);
}

if (refused) process.exitCode = 1;
