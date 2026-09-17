#!/usr/bin/env node
/**
 * Measures the command run's weight step from two frames, and writes the still.
 *
 *     node scripts/stroke-step-table.mjs \
 *       --before <frame.webp> --after <frame.webp> \
 *       --crop 640x54+60+138 --out docs/evidence/chat-slash-highlight/round3-stroke-step.png
 *
 * WHY THIS EXISTS. Round 2 published a table of "differing pixels" and an ink
 * delta for a 1x stroke pair, and a round-3 review could not reproduce either
 * (`D10`): the numbers had come from an ad-hoc ImageMagick invocation that lived
 * nowhere, on frames and a crop the table did not name, so the only artifact the
 * table pointed at was a PNG with no generator in the tree. A number a reader
 * cannot re-derive is worse than no number. Here the frames are named on the
 * command line, the crop is named on the command line, and both the table and the
 * still come out of this file.
 *
 * WHAT IT MEASURES, and against what. Coverage is measured against a palette's own
 * references — `--ground` (the field the run sits on) and `--ink` (the palette's
 * `ink`, full coverage) — rather than against the frame's own extremes, so the
 * numbers are comparable across arms and a reader can verify them with a colour
 * picker. `ink mass` is the sum of coverage over the crop, in device px² of full
 * ink. `>=0.9` counts the pixels filled to near-solid: the figure the design
 * round's D8 turns on, because a stroke width that starts filling glyph interiors
 * rather than edges is what closes a counter (the 'e' aperture, the 'm' stems).
 *
 * The two frames must be the SAME story, theme, raster and crop. This is a
 * comparison between stylesheets; anything else that differs is the measurement's
 * error, not the step's. Duplicate arms are expected to come back bit-identical
 * (`AE 0`), which is the control a difference image is worth.
 *
 * ImageMagick is the reader, as it already is for this repository's evidence
 * tooling (`check-evidence.mjs` reads histograms out of it), so nothing decodes
 * webp here.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Whitespace, hoisted: this file parses `magick -format` output on every read. */
const SPACES = /\s+/;

const arg = (name, fallback = null) => {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};

const BEFORE = arg("before");
const AFTER = arg("after");
const CROP = arg("crop", "640x54+60+138");
const OUT = arg("out");
const ZOOM = arg("zoom", "300%");
const GROUND = arg("ground", "#09090B");
const INK = arg("ink", "#FAFAFA");

if (!BEFORE || !AFTER) {
	console.error(
		"usage: node scripts/stroke-step-table.mjs --before <frame.webp> --after <frame.webp> [--crop WxH+X+Y] [--out still.png] [--ground #hex] [--ink #hex]",
	);
	process.exit(2);
}
for (const frame of [BEFORE, AFTER]) {
	if (!existsSync(frame)) {
		console.error(`no such frame: ${frame}`);
		process.exit(2);
	}
}

/** A colour as ImageMagick's own gray value (the weights its `gray` uses). */
const gray = (hex) => {
	const value = hex.replace("#", "");
	const channels = [0, 2, 4].map((at) =>
		Number.parseInt(value.slice(at, at + 2), 16),
	);
	return (
		(0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255
	);
};
const GROUND_G = gray(GROUND);
const INK_G = gray(INK);
/*
 * THE CROP IS RESCALED TO THE COVERAGE SPACE BEFORE ANYTHING IS COUNTED, which is
 * what makes one set of numbers work for a dark palette and a light one: the field
 * becomes 0, full ink becomes 1, and the `>=0.9` mask is then a statement about
 * coverage rather than about screen luminance.
 */
const LEVEL = `${(GROUND_G * 100).toFixed(2)}%,${(INK_G * 100).toFixed(2)}%`;

const magick = (args) => execFileSync("magick", args).toString();

const measure = (file) => {
	const stats = magick([
		file,
		"-crop",
		CROP,
		"+repage",
		"-colorspace",
		"gray",
		"-level",
		LEVEL,
		"-format",
		"%[fx:mean] %[fx:maxima] %[fx:standard_deviation] %[fx:mean*w*h]",
		"info:",
	])
		.trim()
		.split(SPACES)
		.map(Number);
	const solid = magick([
		file,
		"-crop",
		CROP,
		"+repage",
		"-colorspace",
		"gray",
		"-level",
		LEVEL,
		"-threshold",
		"90%",
		"-format",
		"%[fx:mean*w*h]",
		"info:",
	]).trim();
	return {
		mean: stats[0],
		max: stats[1],
		sd: stats[2],
		mass: stats[3],
		solid: Number(solid),
	};
};

const before = measure(BEFORE);
const after = measure(AFTER);
/*
 * `magick compare` reports `AE` on stderr and exits **1** when the images differ,
 * which is the normal case here rather than a failure: only 0 (identical) and 1
 * (differing) are answers, anything else is the tool refusing.
 */
const cmp = spawnSync(
	"magick",
	["compare", "-metric", "AE", BEFORE, AFTER, "null:"],
	{
		encoding: "utf8",
	},
);
if (cmp.status !== 0 && cmp.status !== 1) {
	throw new Error(`magick compare failed: ${cmp.stderr || cmp.status}`);
}
const differing = Number((cmp.stderr || cmp.stdout).trim().split(SPACES)[0]);

const pct = (a, b) => `${(((b - a) / a) * 100).toFixed(1)}%`;

console.log(
	[
		`frames   ${BEFORE}  ->  ${AFTER}`,
		`crop     ${CROP}   ground ${GROUND} (${GROUND_G.toFixed(4)})   ink ${INK} (${INK_G.toFixed(4)})`,
		"",
		"             mean      ink mass   >=0.9    peak    sd",
		`before      ${before.mean.toFixed(5)}   ${before.mass.toFixed(1).padStart(9)}   ${before.solid.toFixed(0).padStart(4)}    ${before.max.toFixed(3)}   ${before.sd.toFixed(3)}`,
		`after       ${after.mean.toFixed(5)}   ${after.mass.toFixed(1).padStart(9)}   ${after.solid.toFixed(0).padStart(4)}    ${after.max.toFixed(3)}   ${after.sd.toFixed(3)}`,
		"",
		`ink mass    ${pct(before.mass, after.mass)}`,
		`near-solid  ${before.solid.toFixed(0)} -> ${after.solid.toFixed(0)}  (${pct(before.solid, after.solid)})  <- the counter figure D8 is about`,
		`difference  ${differing} pixels over the whole frame`,
	].join("\n"),
);

if (OUT) {
	/*
	 * The still, out of the same two files and the same crop, so the picture cannot
	 * describe a different region than the table: before | after | amplified
	 * difference, appended left to right at `--zoom`. Labels are deliberately not
	 * drawn here — a font dependency in a measurement script is a way for a
	 * measurement to fail for uninteresting reasons — so the file name and the
	 * commit message carry the reading.
	 */
	const parts = `${OUT.replace(/\.[a-z]+$/, "")}-parts`;
	mkdirSync(dirname(join(parts, "x")), { recursive: true });
	const resize = ["-filter", "point", "-resize", ZOOM];
	const crop = ["-crop", CROP, "+repage"];
	magick([BEFORE, ...crop, ...resize, join(parts, "before.png")]);
	magick([AFTER, ...crop, ...resize, join(parts, "after.png")]);
	/* Both frames on one command line: `-composite` needs a sequence, so the crop
	   is applied to each and the difference is taken between them. */
	magick([
		BEFORE,
		AFTER,
		...crop,
		"-compose",
		"difference",
		"-composite",
		"-auto-level",
		...resize,
		join(parts, "difference.png"),
	]);
	magick([
		join(parts, "before.png"),
		join(parts, "after.png"),
		join(parts, "difference.png"),
		"+append",
		OUT,
	]);
	console.log(
		`\nstill     ${OUT}  (before | after | amplified difference, ${ZOOM} of ${CROP})`,
	);
	console.log(
		`          the three panels live in ${parts}/ as scratch: they are written so a reader can re-cut the composite, and they are not committed (the still is the artifact).`,
	);
}
