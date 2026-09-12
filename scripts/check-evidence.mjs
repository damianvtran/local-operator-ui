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
import { STORIES, THEMES } from "./capture-evidence.mjs";
import { deltaE, r2 } from "./color.mjs";
import { loadPalettes } from "./palette-source.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** One git read, or null when git cannot answer (unresolvable sha, no repo). */
const gitOut = (args) => {
	try {
		return execFileSync("git", args, {
			cwd: ROOT,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch {
		return null;
	}
};
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
 * in the 105 light-palette frames, and the incident that started this was
 * caught only because the default theme happens to be dark.
 *
 * 98.5% is measured, not chosen. It is a ceiling: one colour may cover up to
 * this much and no more. Across the 420 frames the most uniform legitimate
 * ones are the security-notice states at 96.31-96.99% - a short callout on a
 * tall ground - and the median frame is 57.8%. The empty frame was 99.99% and
 * a white spinner page is 99.96%. So the ceiling sits 1.51 above the highest
 * legitimate frame and 1.46 below the lowest real failure: close to the middle
 * of the gap between the two populations, with the wider margin on the side
 * that must not fail.
 *
 * Re-measure these when the set changes size; the two load-bearing numbers are
 * the legitimate maximum and the margin above it.
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

/**
 * Every `.webp` under the evidence root, with the theme its filename names.
 *
 * Exported because `capture-evidence.mjs` has to count frames the SAME way
 * this guard counts them when a narrowed run adds a surface: two walkers that
 * disagreed about what a frame is would produce a manifest that fails the
 * gate it was written to satisfy.
 */
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

/**
 * Whether the manifest's stated provenance resolves to the tree under review.
 *
 * ## Why this exists
 *
 * `head`, `srcTree` and `scriptsTree` exist for exactly one purpose: letting a
 * reader decide whether committed frames are pictures of the CURRENT source.
 * Nothing read them. So the manifest could name a commit that was never pushed,
 * or lag a round behind, and every gate stayed green - which is how a stamp
 * pointing at a pre-amend `wip:` commit shipped through three rounds of review
 * (round 4, R1/D13). That commit was reachable from no ref and would have died
 * at the next `git gc`, leaving the audit trail permanently dead-ended.
 *
 * The manifest's own `countsMean.surfaces` note already admitted the shape of
 * this: it records that the field lags and that this script "does not read it,
 * which is how it went one round stale". A self-description nothing checks is a
 * comment, not a record.
 *
 * ## What it checks, and what it deliberately does not
 *
 * Three things, all cheap and all local:
 *
 * 1. `head` must RESOLVE to a commit. An unreachable sha is the failure that
 *    cannot be recovered from later, because the object goes away.
 * 2. `srcTree` / `scriptsTree` must equal the CURRENT `HEAD:src` / `HEAD:scripts`.
 *    This is the real staleness question - a docs-only commit moves `head` but
 *    not the trees, and frames stay valid across it. Comparing trees rather
 *    than commits is what the capture script's own comment argues for.
 * 3. Every `supplementary[].capturedAtHead` must resolve too, for the same
 *    reason as (1).
 *
 * It does NOT require `head` to equal the current HEAD. A tree-clean manifest
 * whose `head` is an older ancestor is honest and common: docs commits land
 * after a capture all the time, and forcing a re-stamp for them would train
 * people to re-stamp without re-capturing, which is the habit that produced
 * the defect in the first place.
 *
 * Returns a list of failure strings so the caller can report them beside the
 * frame failures; exported so `evidence-manifest.test.mjs` binds the shipped
 * function rather than a copy of its reasoning (round 2, R7).
 */
export const provenanceFailures = (manifest, git = gitOut) => {
	const out = [];
	/*
	 * REACHABLE, not merely resolvable.
	 *
	 * `rev-parse --verify` says yes to a dangling object, which is precisely the
	 * sha that shipped: a pre-amend `wip:` commit still resolves in the clone
	 * that created it and nowhere else. The property that makes a citation
	 * durable is being reachable from a ref, because that is what survives
	 * `git gc` and what a fresh clone can look up. `--all` covers branches,
	 * remotes and tags; a sha reachable from none of them is one this repository
	 * will forget.
	 */
	const reachable = (sha) =>
		git(["merge-base", "--is-ancestor", sha, "HEAD"]) !== null ||
		(git([
			"for-each-ref",
			"--count=1",
			"--contains",
			sha,
			"--format=%(refname)",
		]) ?? "") !== "";
	const resolves = (sha) =>
		git(["rev-parse", "--quiet", "--verify", `${sha}^{commit}`]) !== null;

	if (typeof manifest.head !== "string" || manifest.head.length < 7) {
		out.push("manifest.json: `head` is missing or not a sha");
	} else if (!resolves(manifest.head)) {
		out.push(
			`manifest.json: \`head\` ${manifest.head.slice(0, 9)} resolves to no commit in this repository`,
		);
	} else if (!reachable(manifest.head)) {
		out.push(
			`manifest.json: \`head\` ${manifest.head.slice(0, 9)} (${git(["log", "-1", "--format=%s", manifest.head]) ?? "?"}) is reachable from no ref - it is a dangling commit that resolves only in this clone and dies at the next gc, so a reader cannot check these frames against it`,
		);
	}

	for (const [field, path] of [
		["srcTree", "src"],
		["scriptsTree", "scripts"],
	]) {
		const actual = git(["rev-parse", `HEAD:${path}`]);
		if (actual === null) continue;
		if (manifest[field] !== actual) {
			out.push(
				`manifest.json: \`${field}\` is ${String(manifest[field]).slice(0, 9)} but HEAD:${path} is ${actual.slice(0, 9)} - the frames were captured from different ${path} than the tree under review, so re-capture and re-stamp`,
			);
		}
	}

	/*
	 * `surfaces` must equal the story list it names.
	 *
	 * Only a full sweep wrote this field, so a narrowed run carried the old
	 * value forward and it lagged its own source for two rounds - 48 against a
	 * STORIES of 58 (round 4, R3). Counting the list here rather than trusting
	 * the writer is what turns the manifest's self-description into something a
	 * gate can falsify, which is the root cause R1 and R3 share. Parsed rather
	 * than imported because importing the capture script pulls in its whole
	 * browser-driving surface for one number.
	 */
	const capture = gitOut(["show", "HEAD:scripts/capture-evidence.mjs"]);
	if (capture !== null && typeof manifest.surfaces === "number") {
		const block = capture.slice(capture.indexOf("const STORIES = ["));
		const declared = (
			block.slice(0, block.indexOf("\n];")).match(/^\t\[/gm) ?? []
		).length;
		if (declared > 0 && declared !== manifest.surfaces)
			out.push(
				`manifest.json: \`surfaces\` is ${manifest.surfaces} but capture-evidence.mjs declares ${declared} stories - a narrowed run carried the old value forward`,
			);
	}

	for (const set of manifest.supplementary ?? []) {
		const sha = set.capturedAtHead;
		if (typeof sha !== "string" || sha.length < 7) continue;
		if (!resolves(sha)) {
			out.push(
				`manifest.json: supplementary[${set.path}].capturedAtHead ${sha.slice(0, 9)} resolves to no commit in this repository`,
			);
		} else if (!reachable(sha)) {
			out.push(
				`manifest.json: supplementary[${set.path}].capturedAtHead ${sha.slice(0, 9)} is reachable from no ref - it dies at the next gc`,
			);
		}
	}
	return out;
};

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
		// A manifest that misdescribes itself is not evidence of anything, so
		// its provenance is checked before its arithmetic.
		failures.push(...provenanceFailures(manifest));
		/*
		 * `frames` is the SWEEP's own count, and it stays that way.
		 *
		 * Not every frame in this tree comes from `capture-evidence.mjs`. A
		 * surface whose claim is a pointer hover or a click that changes state
		 * cannot be photographed from Storybook, so those sets are captured
		 * from the running app and committed alongside the sweep. Folding them
		 * into `frames` would make the sweep's count - and with it its `head`,
		 * `srcTree` and `capturedAt`, which a reader uses to decide whether the
		 * set is current - describe frames it never took.
		 *
		 * So each such set declares itself in `supplementary` with its own
		 * provenance, and each declaration is checked AGAINST THE TREE rather
		 * than only against the total. A bare sum is not enough: two wrong
		 * terms cancel, so `{frames:436, supplementary:[{path:"nowhere",
		 * frames:40}]}` sums to the same 476 as the honest manifest and would
		 * pass. Each set must therefore name a directory that exists, hold
		 * exactly the frames it claims, and carry its provenance; and the
		 * sweep's own count is checked against the frames left OUTSIDE every
		 * declared set, so neither term can absorb the other's error.
		 */
		/*
		 * `surfaces` and `themes` are DERIVED, not transcribed.
		 *
		 * They are the sweep's own `STORIES.length` and `THEMES.length`, and
		 * nothing read them until now - which is how `surfaces` went a round
		 * stale, and how an explanatory sentence beside it came to say "the two
		 * `chat-tool-rows--diff-body*` entries" when the tree had three. A
		 * number a human retypes after editing a list is a number that is wrong
		 * the moment someone forgets, and prose about that number is wrong
		 * twice.
		 *
		 * Importing the lists is safe: `capture-evidence.mjs` only runs its
		 * sweep under an `import.meta.url === process.argv[1]` guard, so this
		 * import costs nothing but the module's own constants.
		 */
		if (manifest.surfaces !== STORIES.length) {
			failures.push(
				`manifest.json: surfaces says ${manifest.surfaces}; capture-evidence.mjs declares ${STORIES.length} stories`,
			);
		}
		if (manifest.themes !== THEMES.length) {
			failures.push(
				`manifest.json: themes says ${manifest.themes}; capture-evidence.mjs declares ${THEMES.length} themes`,
			);
		}

		const extra = manifest.supplementary ?? [];

		/*
		 * `source`/`why`/`capturedAt` are what make a set auditable by a
		 * reader who was not here - without them a declaration is just a
		 * number that buys silence from the gate.
		 */
		const PROVENANCE = ["source", "why", "capturedAt"];
		const declared = new Set();
		let accounted = 0;

		for (const [i, set] of extra.entries()) {
			const where = set.path
				? `supplementary[${i}] (${set.path})`
				: `supplementary[${i}]`;
			if (typeof set.path !== "string" || set.path.length === 0) {
				failures.push(`manifest.json: ${where} declares no path`);
				continue;
			}
			const dir = join(EVIDENCE, set.path);
			if (!existsSync(dir) || !statSync(dir).isDirectory()) {
				failures.push(
					`manifest.json: ${where} names a directory that is not in the tree`,
				);
				continue;
			}
			/*
			 * `accounted` sums per ENTRY while `swept` is computed from the set of
			 * directories, so two entries covering the same frames each pass their
			 * own tree check and the sweep term never notices the double count -
			 * the manifest can then claim more frames than exist. Overlap, not
			 * just equality: a declaration nested inside another declared
			 * directory counts its frames a second time in exactly the same way.
			 */
			const overlap = [...declared].find(
				(seen) =>
					seen === dir ||
					dir.startsWith(`${seen}/`) ||
					seen.startsWith(`${dir}/`),
			);
			if (overlap) {
				failures.push(
					`manifest.json: ${where} covers frames already declared by ${relative(EVIDENCE, overlap) || "."}`,
				);
				continue;
			}
			const missing = PROVENANCE.filter((field) => !set[field]);
			if (missing.length > 0) {
				failures.push(
					`manifest.json: ${where} does not say where it came from (missing ${missing.join(", ")})`,
				);
			}
			const onDisk = frames(dir).length;
			if (onDisk !== set.frames) {
				failures.push(
					`manifest.json: ${where} claims ${set.frames} frames; ${onDisk} are on disk`,
				);
			}
			declared.add(dir);
			accounted += onDisk;
		}

		/*
		 * The sweep's count answers for everything no supplementary set
		 * claimed, so an undeclared directory appearing on disk still fails -
		 * the property this check exists for.
		 */
		const swept = files.filter(
			(file) => ![...declared].some((dir) => file.startsWith(`${dir}/`)),
		).length;
		if (manifest.frames !== swept) {
			const parts = [`${manifest.frames} from the sweep`];
			for (const set of extra) parts.push(`${set.frames} from ${set.path}`);
			failures.push(
				`manifest.json accounts for ${manifest.frames + accounted} frames (${parts.join(", ")}); ${files.length} are on disk, ${swept} of them outside any declared set`,
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
