#!/usr/bin/env node
/**
 * Assert that every committed frame is a picture of the app.
 *
 * Why this exists: `chat-trace/conversation/localOperatorDark.webp` shipped as
 * a loading spinner on a white page - 2,762 bytes against its siblings' 57KB,
 * 99.96% pure white - and three guards inside the capture passed it. Those
 * guards ask whether the DOM has nodes, whether Storybook rendered an error,
 * and whether the document carries the right theme. A story that mounts and
 * then sits on its own spinner answers yes to all three, so the set reported
 * 396 frames and one of them was of nothing.
 *
 * The check is a fact about a themed screenshot: whatever else is on it, the
 * colour covering the most pixels is one of that theme's four grounds. On a
 * real frame that is nearly exact - median ΔE00 0.62 across the set - and the
 * loosest legitimate case is a scrim over a modal at 18.10, because a scrim
 * dims the ground under it. 25 sits well clear of that and the failing frame
 * measures 79.41, so the two populations do not overlap.
 *
 * It runs over the COMMITTED set rather than only during capture, which is
 * the difference between a set that was checked once and a set that can be
 * falsified now. `pnpm check-evidence`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { deltaE, r2 } from "./color.mjs";
import { loadPalettes } from "./palette-source.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE = join(ROOT, "docs", "evidence");

/**
 * How far a frame's dominant colour may sit from the nearest ground of its own
 * theme. See the header for where the number comes from.
 */
const GROUND_CEILING = 25;

/**
 * How much of a frame one colour may cover before it stops being a picture.
 *
 * The ground check above cannot see an empty frame whose emptiness is the
 * right colour, and that is not hypothetical: a frame of pure `canvas` with
 * nothing rendered in it passed the ΔE00 test at distance 0. In the three
 * light palettes it is worse, because `#ffffff` sits ΔE00 1.13-2.49 from their
 * `elevated` - so Storybook's white spinner would read as a picture of the app
 * in 102 of the 408 frames, and the incident that started this was caught only
 * because the default theme happens to be dark.
 *
 * 98.5% is measured, not chosen. It is a ceiling: one colour may cover up to
 * this much and no more. Across the 408 frames the most uniform legitimate
 * ones are the security-notice states at 96.39-96.99% - a short callout on a
 * tall ground - and the median frame is 56%. The empty frame was 99.99% and a
 * white spinner page is 99.96%. So the ceiling sits 1.51 above the highest
 * legitimate frame and 1.46 below the lowest real failure: close to the middle
 * of the gap between the two populations, with the wider margin on the side
 * that must not fail.
 */
const UNIFORMITY_CEILING = 0.985;

/**
 * A failing coverage and the ceiling it broke, rendered so the first is
 * visibly larger than the second.
 *
 * Two decimals is right for almost every frame, but the smallest genuinely
 * failing pixel counts at the sizes in this set land within a rounding step of
 * the limit - 1649127/1674240 is 0.985000358, over the ceiling, and prints as
 * "98.50%" against a limit that also prints as "98.50%". A check whose message
 * reads like a passing measurement is worse than one with no message. Widening
 * both sides together until they differ keeps the common case short and makes
 * the boundary case legible.
 */
const overCeiling = (fraction) => {
	const value = fraction * 100;
	const limit = UNIFORMITY_CEILING * 100;
	let places = 2;
	while (places < 10 && value.toFixed(places) === limit.toFixed(places)) {
		places++;
	}
	return { got: `${value.toFixed(places)}%`, max: `${limit.toFixed(places)}%` };
};

const GROUNDS = ["canvas", "surface", "elevated", "sunken"];

/** Every `.webp` under the evidence root, with the theme its filename names. */
const frames = (dir) => {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...frames(path));
		else if (entry.endsWith(".webp")) out.push(path);
	}
	return out;
};

/**
 * The colour covering the most pixels.
 *
 * ImageMagick's histogram is already sorted by count, so the first row after
 * the header is the mode. Reading it out of `magick` rather than decoding webp
 * here keeps this script to one job.
 */
const modalColour = (file) => {
	/*
	 * A failed read must not be reported as a verdict about the picture.
	 *
	 * Under load - a capture still holding the machine - `magick` returns
	 * successfully with empty output, and an earlier version of this reader
	 * turned that into "no pixels" against 87 frames that were all fine and
	 * passed on a quiet machine moments later. A tool that cannot read a file
	 * has to say so in those words, because the alternative is a paint failure
	 * nobody can reproduce.
	 */
	let out;
	try {
		out = execFileSync(
			"magick",
			[file, "-format", "%c", "-depth", "8", "histogram:info:-"],
			{ maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
		).toString();
	} catch (err) {
		throw new Error(`${file}: could not read the image - ${err.message}`);
	}
	if (out.trim() === "") {
		throw new Error(
			`${file}: \`magick\` produced an empty histogram, which means the read failed rather than the frame being blank`,
		);
	}
	let best = null;
	let total = 0;
	for (const line of out.split("\n")) {
		const m = line.match(/^\s*(\d+):.*(#[0-9A-F]{6})/);
		if (!m) continue;
		const count = Number(m[1]);
		total += count;
		if (!best || count > best.count) best = { count, hex: m[2] };
	}
	return best ? { ...best, coverage: best.count / total } : null;
};

/**
 * The same test, for one frame, so the capture can fail at the source.
 *
 * Throwing here costs one screenshot; discovering it in review costs a round
 * and leaves a set that reported a count it could not honour.
 */
export const assertFramePaints = (file, theme) => {
	const palette = PALETTES.get(theme);
	if (!palette) throw new Error(`${file}: no palette named \`${theme}\``);
	const mode = modalColour(file);
	if (!mode) throw new Error(`${file}: no pixels`);
	const got = groundDistance(mode.hex, palette);
	if (got > GROUND_CEILING) {
		throw new Error(
			`${file}: dominant colour ${mode.hex} is ΔE00 ${r2(got)} from the nearest \`${theme}\` ground (max ${GROUND_CEILING}) — the story did not paint`,
		);
	}
	if (mode.coverage > UNIFORMITY_CEILING) {
		const over = overCeiling(mode.coverage);
		throw new Error(
			`${file}: ${over.got} of the frame is one colour (max ${over.max}) — the story painted its ground and nothing else`,
		);
	}
};

/** Nearest of the four grounds, in ΔE00. */
function groundDistance(hex, palette) {
	return Math.min(
		...GROUNDS.filter((g) => /^#[0-9a-fA-F]{6}$/.test(palette[g] ?? "")).map(
			(g) => deltaE(hex.toUpperCase(), palette[g].toUpperCase()),
		),
	);
}

const PALETTES = new Map(loadPalettes().map((p) => [p.id, p.palette]));

/* Sweeping the whole set is what `pnpm check-evidence` does; importing this
   module for `assertFramePaints` must not trigger it. */
const main = () => {
	if (!existsSync(EVIDENCE)) {
		console.error(`No evidence at ${EVIDENCE}`);
		process.exit(1);
	}

	const files = frames(EVIDENCE);
	const failures = [];
	let checked = 0;
	let worst = { got: -1, file: "" };

	for (const file of files) {
		const theme = file.split("/").pop().replace(".webp", "");
		const palette = PALETTES.get(theme);
		if (!palette) {
			failures.push(`${relative(ROOT, file)}: no palette named \`${theme}\``);
			continue;
		}
		const mode = modalColour(file);
		if (!mode) {
			failures.push(`${relative(ROOT, file)}: no pixels`);
			continue;
		}
		const got = groundDistance(mode.hex, palette);
		checked++;
		if (got > worst.got) worst = { got, file: relative(ROOT, file) };
		if (got > GROUND_CEILING) {
			failures.push(
				`${relative(ROOT, file)}: dominant colour ${mode.hex} is ΔE00 ${r2(got)} from the nearest \`${theme}\` ground (max ${GROUND_CEILING}) — this frame is not a picture of the app`,
			);
		}
		if (mode.coverage > UNIFORMITY_CEILING) {
			const over = overCeiling(mode.coverage);
			failures.push(
				`${relative(ROOT, file)}: ${over.got} of the frame is one colour (max ${over.max}) — this frame is a ground with nothing on it`,
			);
		}
	}

	const manifestPath = join(EVIDENCE, "manifest.json");
	if (existsSync(manifestPath)) {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (manifest.frames !== files.length) {
			failures.push(
				`manifest.json claims ${manifest.frames} frames; ${files.length} are on disk`,
			);
		}
	}

	for (const line of failures) console.log(`FAIL  ${line}`);
	if (failures.length > 0) {
		console.log(
			`\nEvidence check FAILED: ${failures.length} of ${files.length} frames.`,
		);
		process.exit(1);
	}
	console.log(
		`Evidence holds: ${checked} frames are pictures of their own theme (worst ΔE00 ${r2(worst.got)}, ${worst.file}).`,
	);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
	main();
