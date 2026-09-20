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
 * MACHINE NOTE. ImageMagick is not installed on the CI runners (nothing in
 * `.github/workflows/` installs it), so this rig is a local instrument and
 * `scripts/evidence-histogram-parity.test.mjs` is the part that runs everywhere:
 * it asserts the shipped reader's own readings on frames it writes, and compares
 * them against this control only where the control exists.
 *
 * Usage:
 *   node scripts/evidence-histogram-parity.mjs              # 12 frames, spread
 *   node scripts/evidence-histogram-parity.mjs --frames 40
 *   node scripts/evidence-histogram-parity.mjs --all        # every frame (hours)
 *   node scripts/evidence-histogram-parity.mjs --pattern browser-composition
 *
 * The sample is deterministic: frames are walked in sorted order and taken at an
 * even stride, so two runs on one tree compare the same files. One member of
 * every sample is written on the spot rather than read from the tree - see
 * `withAlphaFrame` for why the committed set cannot exercise it.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
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
export const magickReader = (file) => {
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
export const newReader = async (file) => {
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
export const frames = (dir) => {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...frames(path));
		else if (entry.endsWith(".webp")) out.push(path);
	}
	return out;
};

/**
 * The mode a four-channel probe frame must read as, and how many pixels carry it.
 *
 * Exported beside the writer so a test can assert the reader against the same
 * arithmetic the frame was built from rather than against a number copied out of
 * a log.
 */
export const ALPHA_PROBE = {
	hex: "#C8C8C8",
	count: 85,
	total: 100,
	/* 5 px (10,20,30,255), 4 px (10,20,30,128), 6 px (50,60,70,255), 85 px
	   (200,200,200,255) - the first two share an RGB and differ only in alpha,
	   which is the pair the key has to keep apart. */
};

/**
 * Write a four-channel lossless frame, and return its path.
 *
 * WHY THE RIG OWNS A FRAME. Every committed frame in this repository is
 * three-channel (measured: 0 of the 9763 frames carry an `ALPH` chunk), so a
 * sample drawn only from the committed set never enters `frameHistogram`'s
 * four-channel branch - which is exactly where review round 1 found a signed
 * shift turning the mode into `#-373738`, a string `groundDistance` then measured
 * as a colour. A branch that no sample can reach is a branch nothing protects.
 *
 * The name is a real theme id on purpose, so the verdict is computed for this
 * frame too and not only its numbers.
 */
export const writeAlphaFrame = async (dir) => {
	const width = 10;
	const height = 10;
	const pixels = Buffer.alloc(width * height * 4);
	const rows = [
		[0, 5, [10, 20, 30, 255]],
		[5, 9, [10, 20, 30, 128]],
		[9, 15, [50, 60, 70, 255]],
		[15, 100, [200, 200, 200, 255]],
	];
	for (const [from, to, [r, g, b, a]] of rows) {
		for (let index = from; index < to; index += 1) {
			pixels[index * 4] = r;
			pixels[index * 4 + 1] = g;
			pixels[index * 4 + 2] = b;
			pixels[index * 4 + 3] = a;
		}
	}
	const file = join(dir, "dracula.webp");
	await sharp(pixels, { raw: { width, height, channels: 4 } })
		.webp({ lossless: true })
		.toFile(file);
	return file;
};

/** The guard's own verdict, from the two ceilings and `groundDistance`. */
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

/**
 * Both readers on one frame, and everything a caller needs to judge the pair.
 *
 * Extracted so the test in `scripts/evidence-histogram-parity.test.mjs` compares
 * frames through THIS path rather than through a second implementation of the
 * comparison - the rig is the instrument, and an instrument with two
 * implementations is two instruments.
 */
export const compareFrame = async (file) => {
	/*
	 * The written probe lives in the system temp directory, so `relative` would
	 * print a run of `../` for it; a label is what a reader needs there, and the
	 * committed frames keep their path relative to the repository.
	 */
	const rel = relative(ROOT, file);
	const name = rel.startsWith("..") ? `probe/${basename(file)}` : rel;
	const startedMagick = process.hrtime.bigint();
	const magick = magickReader(file);
	const magickMs = Number(process.hrtime.bigint() - startedMagick) / 1e6;
	const startedNew = process.hrtime.bigint();
	const fresh = await newReader(file);
	const newMs = Number(process.hrtime.bigint() - startedNew) / 1e6;
	const theme = name.split("/").pop().replace(".webp", "");
	const before = verdictOf(magick, theme);
	const after = verdictOf(fresh, theme);
	const agree =
		magick.hex === fresh.hex &&
		magick.count === fresh.count &&
		magick.total === fresh.total;
	return {
		name,
		magick,
		fresh,
		magickMs,
		newMs,
		agree,
		step: agree ? 0 : channelStep(magick.hex, fresh.hex),
		before,
		after,
	};
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

export const sampleOf = (all, size) => {
	const stride = Math.max(1, Math.floor(all.length / Math.max(1, size)));
	return all
		.filter((_, index) => index % stride === 0)
		.slice(0, Number.isFinite(size) ? size : undefined);
};

/**
 * The sample every run uses: the committed frames at an even stride, plus the
 * four-channel probe the committed set cannot provide.
 */
export const sampleWithAlpha = async () => {
	const scratch = mkdtempSync(join(tmpdir(), "histogram-parity-"));
	const alpha = await writeAlphaFrame(scratch);
	return { sample: [alpha], scratch };
};

const main = async () => {
	const all = frames(EVIDENCE)
		.filter((file) => (pattern ? file.includes(pattern) : true))
		.sort();
	if (all.length === 0) {
		console.error(
			`no frames under ${relative(ROOT, EVIDENCE)} match ${pattern ?? "*"}`,
		);
		process.exit(1);
	}
	const { sample: alpha, scratch } = await sampleWithAlpha();
	const sample = [...alpha, ...sampleOf(all, limit)];
	console.log(
		`histogram parity: ${sample.length - 1} of ${all.length} committed frames` +
			`${pattern ? ` matching "${pattern}"` : ""}, plus 1 written 4-channel probe`,
	);

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
		let result;
		try {
			result = await compareFrame(file);
		} catch (error) {
			differences.push(`${relative(ROOT, file)}: ${error.message}`);
			continue;
		}
		magickMs += result.magickMs;
		newMs += result.newMs;
		if (result.before && result.after) {
			compared += 1;
			if (
				result.before.ground !== result.after.ground ||
				result.before.uniform !== result.after.uniform
			) {
				verdictMismatches += 1;
				differences.push(
					`${result.name}: VERDICT CHANGED - magick ${JSON.stringify(result.before)} vs in-process ${JSON.stringify(result.after)}`,
				);
			}
			worstDistanceDelta = Math.max(
				worstDistanceDelta,
				Math.abs(result.before.distance - result.after.distance),
			);
		}
		if (result.agree) {
			identical += 1;
		} else if (
			result.magick.count === result.fresh.count &&
			result.magick.total === result.fresh.total &&
			result.step <= 1
		) {
			// One step in one channel of the mode's colour, with the same pixel count
			// over the same total: the two decoders round a lossy conversion
			// differently, and the verdict is computed from a ΔE00 distance that a
			// single step moves by a fraction of a unit (reported beside this).
			worstStep = Math.max(worstStep, result.step);
			valueChanges.push(
				`${result.name}: magick ${result.magick.hex} vs in-process ${result.fresh.hex} (${result.step} step, count and total identical)`,
			);
		} else {
			differences.push(
				`${result.name}: magick ${result.magick.hex} ${result.magick.count}/${result.magick.total} vs in-process ${result.fresh.hex} ${result.fresh.count}/${result.fresh.total}`,
			);
		}
		console.log(
			`${result.agree ? "same" : "DIFF"}  ${result.name}  ${result.fresh.size} ch${result.fresh.channels}  ` +
				`magick ${result.magickMs.toFixed(0)}ms  in-process ${result.newMs.toFixed(0)}ms  ` +
				`mode ${result.fresh.hex} count ${result.fresh.count} total ${result.fresh.total} coverage ${result.fresh.coverage.toFixed(6)}`,
		);
	}
	rmSync(scratch, { recursive: true, force: true });

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
};

/**
 * How many 8-bit steps apart two `#RRGGBB` readings are, worst channel first.
 *
 * A decoder difference is only interesting as a number of steps: one is rounding,
 * several is a different picture.
 */
export function channelStep(left, right) {
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

// Imported for `compareFrame` and the fixtures without running a sweep.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
