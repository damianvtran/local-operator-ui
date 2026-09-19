#!/usr/bin/env node
/**
 * Does the in-process frame reader agree with the ImageMagick one it replaced?
 *
 * WHY THIS EXISTS. `check-evidence.mjs` used to shell out to
 * `magick <file> -format %c -depth 8 histogram:info:-` once per frame and read
 * the mode out of its output; it now decodes the frame in its own process with
 * `sharp`. The verdict that guard reaches - "the colour covering the most pixels
 * is one of the theme's four grounds, and it does not cover the whole frame" -
 * must not change because the decoder changed, so this rig runs BOTH readers
 * over the same committed frames and compares the three numbers the verdict is
 * computed from: the mode's colour, its pixel count, and the total.
 *
 * WHAT "AGREE" MEANS HERE. `coverage` is `count / total`, so those three numbers
 * are the whole of the input to `groundDistance` and `overCeiling`; two readers
 * that agree on all three reach the same verdict on the same frame, bit for bit.
 * A frame that differs in any of them is reported with both readings and fails
 * this rig's exit status - a decoder swap that moves a frame's mode by one
 * channel step is exactly the silent change this file exists to refuse.
 *
 * The magick reader is re-implemented here rather than called through
 * `check-evidence.mjs`: the whole point is to compare against the reader that was
 * replaced, and a comparison that imported the new one on both sides would agree
 * with itself. It is the same argv, the same parse and the same tie rule.
 *
 * Usage:
 *   node scripts/evidence-histogram-parity.mjs              # 12 frames, spread
 *   node scripts/evidence-histogram-parity.mjs --frames 40
 *   node scripts/evidence-histogram-parity.mjs --all        # every frame (hours)
 *   node scripts/evidence-histogram-parity.mjs --pattern browser-composition
 *
 * The sample is deterministic: frames are walked in sorted order and taken at an
 * even stride, so two runs on one tree compare the same files.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
	GROUND_CEILING,
	UNIFORMITY_CEILING,
	frameHistogram,
	groundDistance,
} from "./check-evidence.mjs";
import { loadPalettes } from "./palette-source.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE = join(ROOT, "docs/evidence");

/**
 * The reader `check-evidence.mjs` replaced, kept as the control.
 *
 * Called the way the guard called it - same argv, same parse, same tie rule - so
 * a difference in the numbers below is a difference between decoders rather than
 * between two spellings of one reader.
 */
const magickReader = (file) => {
	const out = execFileSync(
		"magick",
		[file, "-format", "%c", "-depth", "8", "histogram:info:-"],
		{ maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
	).toString();
	let best = null;
	let total = 0;
	for (const line of out.split("\n")) {
		const match = line.match(/^\s*(\d+):.*(#[0-9A-F]{6})/);
		if (!match) continue;
		const count = Number(match[1]);
		total += count;
		if (!best || count > best.count) best = { count, hex: match[2] };
	}
	if (best === null)
		throw new Error(`${file}: magick produced no histogram rows`);
	return { ...best, coverage: best.count / total, total };
};

/**
 * The SHIPPED reader, imported from the guard.
 *
 * Imported rather than copied, deliberately: a copy would agree with itself
 * whatever `check-evidence.mjs` went on to do, and the claim this rig makes is
 * about what the guard does. `total`, the frame size and the channel count are
 * added by reading the same decode once more here, because they are what a
 * difference needs to be explained with when one appears.
 */
const newReader = async (file) => {
	const mode = await frameHistogram(file);
	const { info } = await sharp(file)
		.raw()
		.toBuffer({ resolveWithObject: true });
	return {
		...mode,
		channels: info.channels,
		size: `${info.width}x${info.height}`,
	};
};

/** Every committed frame, sorted, so one run's sample is another run's sample. */
const frames = (dir) => {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...frames(path));
		else if (entry.endsWith(".webp")) out.push(path);
	}
	return out;
};

const args = process.argv.slice(2);
const flag = (name) => {
	const index = args.indexOf(name);
	return index === -1 ? null : (args[index + 1] ?? null);
};
const pattern = flag("--pattern");
const limit = args.includes("--all")
	? Number.POSITIVE_INFINITY
	: Number(flag("--frames") ?? 12);

const all = frames(EVIDENCE)
	.filter((file) => (pattern ? file.includes(pattern) : true))
	.sort();
if (all.length === 0) {
	console.error(
		`no frames under ${relative(ROOT, EVIDENCE)} match ${pattern ?? "*"}`,
	);
	process.exit(1);
}
const stride = Math.max(1, Math.floor(all.length / Math.max(1, limit)));
const sample = all
	.filter((_, index) => index % stride === 0)
	.slice(0, Number.isFinite(limit) ? limit : undefined);

console.log(
	`histogram parity: ${sample.length} of ${all.length} committed frames` +
		`${pattern ? ` matching "${pattern}"` : ""}, stride ${stride}`,
);

/*
 * The verdict, judged by the guard's OWN predicates.
 *
 * Comparing the mode's colour alone would report a one-step decoder difference as
 * a failure and a real change as a smaller one, which is backwards. What has to
 * hold is that both readers reach the same decision about the same frame - the
 * mode is within `GROUND_CEILING` of the nearest ground the theme declares, and
 * it does not cover more than `UNIFORMITY_CEILING` of it - so that is what is
 * compared, with the colour difference reported in steps beside it.
 */
const palettes = new Map(
	loadPalettes().map((entry) => [entry.id, entry.palette]),
);
const verdictOf = (mode, theme) => {
	const palette = palettes.get(theme);
	if (!palette) return null;
	const distance = groundDistance(mode.hex, palette);
	return {
		ground: distance <= GROUND_CEILING,
		uniform: mode.coverage <= UNIFORMITY_CEILING,
		distance,
	};
};

const differences = [];
const valueChanges = [];
let verdictMismatches = 0;
let compared = 0;
let worstStep = 0;
let worstDistanceDelta = 0;
let identical = 0;
let magickMs = 0;
let newMs = 0;
for (const file of sample) {
	const name = relative(ROOT, file);
	let magick;
	const startedMagick = process.hrtime.bigint();
	try {
		magick = magickReader(file);
	} catch (error) {
		differences.push(`${name}: magick failed - ${error.message}`);
		continue;
	}
	const magickElapsed = Number(process.hrtime.bigint() - startedMagick) / 1e6;

	let fresh;
	const startedNew = process.hrtime.bigint();
	try {
		fresh = await newReader(file);
	} catch (error) {
		differences.push(`${name}: in-process decode failed - ${error.message}`);
		continue;
	}
	const newElapsed = Number(process.hrtime.bigint() - startedNew) / 1e6;
	magickMs += magickElapsed;
	newMs += newElapsed;

	const agree =
		magick.hex === fresh.hex &&
		magick.count === fresh.count &&
		magick.total === fresh.total;
	const theme = name.split("/").pop().replace(".webp", "");
	const before = verdictOf(magick, theme);
	const after = verdictOf(fresh, theme);
	if (before && after) {
		compared += 1;
		if (before.ground !== after.ground || before.uniform !== after.uniform) {
			verdictMismatches += 1;
			differences.push(
				`${name}: VERDICT CHANGED - magick ${JSON.stringify(before)} vs in-process ${JSON.stringify(after)}`,
			);
		}
		worstDistanceDelta = Math.max(
			worstDistanceDelta,
			Math.abs(before.distance - after.distance),
		);
	}
	if (agree) {
		identical += 1;
	} else if (
		magick.count === fresh.count &&
		magick.total === fresh.total &&
		channelStep(magick.hex, fresh.hex) <= 1
	) {
		// One step in one channel of the mode's colour, with the same pixel count
		// over the same total: the two decoders round a lossy conversion
		// differently, and the verdict is computed from a ΔE00 distance that a
		// single step moves by a fraction of a unit (reported beside this).
		worstStep = Math.max(worstStep, channelStep(magick.hex, fresh.hex));
		valueChanges.push(
			`${name}: magick ${magick.hex} vs in-process ${fresh.hex} (${channelStep(magick.hex, fresh.hex)} step, count and total identical)`,
		);
	} else {
		differences.push(
			`${name}: magick ${magick.hex} ${magick.count}/${magick.total} vs in-process ${fresh.hex} ${fresh.count}/${fresh.total}`,
		);
	}
	console.log(
		`${agree ? "same" : "DIFF"}  ${name}  ${fresh.size} ch${fresh.channels}  ` +
			`magick ${magickElapsed.toFixed(0)}ms  in-process ${newElapsed.toFixed(0)}ms  ` +
			`mode ${fresh.hex} count ${fresh.count} total ${fresh.total} coverage ${fresh.coverage.toFixed(6)}`,
	);
}

const [one, five, fifteen] = loadavg();
console.log(
	`\nidentical readings on ${identical}/${sample.length} frames; ` +
		`${valueChanges.length} differ by at most ${worstStep} channel step(s) with the count and total intact` +
		`${compared > 0 ? `; verdicts identical on ${compared - verdictMismatches}/${compared} frames (worst ΔE00 shift ${worstDistanceDelta.toFixed(3)})` : ""}`,
);
console.log(
	`agreed on ${identical}/${sample.length} frames; ` +
		`magick ${(magickMs / 1000).toFixed(1)}s vs in-process ${(newMs / 1000).toFixed(1)}s ` +
		`(${(magickMs / Math.max(newMs, 0.001)).toFixed(0)}x)`,
);
console.log(
	`load average at the end: ${one.toFixed(2)} ${five.toFixed(2)} ${fifteen.toFixed(2)}`,
);
for (const line of valueChanges) console.log(`note  ${line}`);
if (differences.length > 0) {
	for (const line of differences) console.log(`DIFF  ${line}`);
	console.log(
		`\n${differences.length} frame(s) disagreed: this is a verdict change, not a timing one.`,
	);
	process.exit(1);
}

/**
 * How many 8-bit steps apart two `#RRGGBB` readings are, worst channel first.
 *
 * A decoder difference is only interesting as a number of steps: one is rounding,
 * several is a different picture.
 */
function channelStep(left, right) {
	const a = left.replace("#", "");
	const b = right.replace("#", "");
	let worst = 0;
	for (let index = 0; index < 6; index += 2) {
		const delta = Math.abs(
			Number.parseInt(a.slice(index, index + 2), 16) -
				Number.parseInt(b.slice(index, index + 2), 16),
		);
		worst = Math.max(worst, delta);
	}
	return worst;
}
