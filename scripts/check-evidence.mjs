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
 *
 * WHAT A COMMITTED FRAME MUST BE CALLED, and why this is the place that says it.
 * A frame's expected ground is derived FROM ITS FILENAME - the stem of
 * `<set>/<stem>.<container>` is looked up in `PALETTES` - so a frame whose stem
 * is not a palette id fails `no palette named <stem>` however its set is
 * declared, and a set of driven frames named after their own states and
 * timestamps can therefore never be swept. Two dispositions are honest, and a
 * frame's pixels pick between them: MOVE the frame to `<set>/<stem>/<theme>.webp`
 * keeping its bytes (how the 60 frames of `manifest.paletteStemRenameNote` were
 * settled), or - for a frame the judgement above refuses outright, a bare ground
 * that is the whole image - commit it in a container whose INFERENCE names it:
 * this walk judges by NAME, not by container, so a bare ground is not judged
 * whatever it is packed in, and the frames that name no theme are counted by
 * `unjudgedFrames` (which is also why re-containering a failing frame no longer
 * hides it - judged frames are judged under their names). What is NOT honest is a
 * set landing as `.webp` under a stem this cannot resolve: it fails at the next
 * sweep, and until this check was wired into a workflow the next sweep never
 * came, so 20 such findings sat on `main` under a green CI.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
/*
 * The frame decoder, at module scope on purpose.
 *
 * `sharp` is a devDependency and is already how other rigs in this tree decode
 * WebP (see `desktop-renderer-transport.test.mjs`), so the histogram costs no
 * new package. Imported eagerly rather than per frame: a 9703-frame sweep must
 * not pay a module load per image, and the loader is synchronous anyway.
 */
import sharp from "sharp";

/*
 * The decoder's memory, BOUNDED ON PURPOSE.
 *
 * A whole-tree sweep decodes every frame in one process. Measured 2026-10-04 at
 * 200 / 800 / 1600 frames: resident set 500 / 586 / 735 MB with libvips' operation
 * cache on, and 424 / 431 / 599 MB with it off - so the cache is most of what
 * holds across a run, and turning it off is the bound that costs no throughput.
 * (The day's harness memory-guard figure of 177.3 GB for one such sweep is TOTAL
 * allocation, ~11 MB per decoded frame, not residency: it cannot be resident on a
 * 36 GB host, and the numbers above are the high-water marks that can.)
 * `sharp.concurrency(1)` was measured too and is deliberately NOT set: it flattens
 * the curve a little further and trades throughput the CI job needs (7 GB runner,
 * 11m27s measured) for memory it does not.
 *
 * The local path does not pay this at all - `evidence` is in `LOCAL_EXCLUSIONS`
 * (`ci-scope.mjs`), so `pnpm check-changed` never starts a whole-tree decode.
 */
sharp.cache(false);
/*
 * The capturer's own `dir` table, for `claimedStory` below - not to run it.
 *
 * This closes a cycle: `capture-evidence.mjs` imports this file for `frames`
 * and `assertFramePaints`. The cycle is safe only because nothing here reads a
 * `capture-evidence` binding while this module's body is evaluating - the table
 * is built on first USE, inside a function - which matters when the capturer is
 * the entry point: `node scripts/capture-evidence.mjs` then evaluates this
 * module while `capture-evidence`'s own bindings are still uninitialised, so a
 * module-scope `STORIES` read here would fail that command with a TDZ error.
 * Keep the read lazy, or that command breaks.
 */
import { STORIES } from "./capture-evidence.mjs";
import { deltaE, r2 } from "./color.mjs";
import { isEntryPoint } from "./entry-point.mjs";
import { loadPalettes } from "./palette-source.mjs";
import { pythonChildEnv } from "./python-child-env.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** One git read, or null when git cannot answer (unresolvable sha, no repo). */
const gitOut = (args) => {
	try {
		return execFileSync("git", args, {
			cwd: ROOT,
			stdio: ["ignore", "pipe", "ignore"],
			/*
			 * `git ls-tree -r --name-only HEAD -- docs/evidence` crossed Node's
			 * 1 MiB spawnSync default at 14,162 frames (1,054,602 bytes, measured
			 * 2026-09-30; review round 1, R-2): the throw was caught, the read
			 * returned null, and the refresh tally's term 1 stood down
			 * (`if (committed !== null)`), so the guard could not fail the very
			 * under-claim it exists for. Same default-buffer trap the whole-tree
			 * scans hit, closed the same way `no-websocket-plane.test.mjs` closes
			 * it: a ceiling above every tree this repo's evidence walk can reach
			 * (64 MiB now covers ~850k frames), so the read either answers or the
			 * command itself is broken.
			 */
			maxBuffer: 64 * 1024 * 1024,
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
export const GROUND_CEILING = 25;

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
export const UNIFORMITY_CEILING = 0.985;

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
 * The containers this repository commits frames in.
 *
 * `.webp` is the canonical one, `.png` what a rig frame the sweep cannot judge as
 * a picture is committed as, and the rest are named because a container this list
 * does NOT name is invisible to both the walk and the accounting at once - which
 * is the hole QA found for `.png`, one extension over. Measured 2026-10-04: the
 * tree commits none of these four today (`git ls-tree docs/evidence` is `.webp`
 * and `.png` only), so this costs nothing now and a format the repo starts
 * committing is counted the moment it lands - the numbers in `unjudgedFrames`
 * move, and the guard fails until they are re-derived.
 */
export const FRAME_CONTAINERS = [
	".webp",
	".png",
	".jpg",
	".jpeg",
	".avif",
	".gif",
];

const isFrameContainer = (name) =>
	FRAME_CONTAINERS.some((container) => name.endsWith(container));

/**
 * The strip regex DERIVED from the container list, so a format added above is
 * recognized here in the same commit rather than silently failing to match.
 */
const FRAME_CONTAINER_RE = new RegExp(
	`(${FRAME_CONTAINERS.map((c) => c.replace(".", "\\.")).join("|")})$`,
	"i",
);

/** The frame's name without its container - what a palette id is matched against. */
export const frameStem = (file) =>
	file.split("/").pop().replace(FRAME_CONTAINER_RE, "");

/**
 * Every frame this guard JUDGES: the ones whose filename NAMES A THEME, in any
 * container, plus every `.webp` (which has to name one - `main()` refuses a
 * `.webp` whose stem resolves to no palette, and that refusal is the reason this
 * file exists).
 *
 * WHY THE RULE IS ABOUT THE NAME AND NOT THE CONTAINER. It used to be `.webp`
 * and nothing else, and that made the container a hiding place: what a frame IS
 * is decided by its name, so re-containering one changes nothing about it - yet
 * the walk stepped over it. Measured when this changed (2026-10-04): 174
 * committed frames were theme-named `.png` app pictures across six surfaces,
 * never judged, in a repository whose evidence doctrine is that a frame is a
 * picture of its theme. The name is the claim; the container is only how the
 * pixels are packed (all 174 pass the same check, worst DELTA-E00 17.89).
 *
 * WHAT IT STILL DOES NOT JUDGE, and why that is a DECLARED scope rather than a
 * hole: a frame whose stem names no theme is not a picture of a theme and cannot
 * be judged as one - the compositor's PRE-PAINT buffers (`.png`, one flat
 * ground, which is what the uniformity ceiling exists to refuse), screenshots and
 * props. They are ACCOUNTED FOR by `unjudgedFrames` below instead, so one cannot
 * be added or moved without the manifest's numbers going stale.
 *
 * Exported because `capture-evidence.mjs` has to count frames the SAME way
 * this guard counts them when a narrowed run adds a surface: two walkers that
 * disagreed about what a frame is would produce a manifest that fails the
 * gate it was written to satisfy.
 */
/**
 * Is this path a frame this guard JUDGES? The ONE spelling of the rule, so the
 * walk, the accounting and the pass-claims below cannot disagree about what a
 * frame is.
 */
export const isJudgedFrame = (name, palettes = PALETTES) =>
	name.endsWith(".webp") || palettes.has(frameStem(name));

export const frames = (dir, palettes = PALETTES) => {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...frames(path, palettes));
		else if (isJudgedFrame(entry, palettes)) out.push(path);
	}
	return out;
};

/**
 * The sentence a manifest that carries no `unjudgedFrames.why` is written with,
 * so a fold onto an older `main` still produces a field a reader can read. The
 * shipped file carries its own, longer statement.
 */
export const UNJUDGED_FRAMES_WHY =
	"Frames in a container this repository commits whose filename names no theme, so they are not pictures of a theme and the ground check cannot judge them: the compositor's PRE-PAINT buffers (one flat colour covering 100.00% of the frame, which is exactly what the uniformity ceiling refuses), screenshots and props. They are ACCOUNTED rather than invisible - `unjudgedFrameFailures` fails when the tree disagrees with these counts.";

/**
 * The committed frames this guard does NOT judge: a frame file, in one of
 * `FRAME_CONTAINERS`, whose stem names no theme.
 *
 * `declared` is the same list of set DIRECTORIES the counts guards beside it
 * pass to `inDeclaredSet` (absolute, as `countsMeanFailures` builds it), so the
 * two cannot disagree about which frames sit inside a declared set. The returned
 * paths are repository-relative, because they are read in failure messages.
 *
 * WHY THIS EXISTS. Reading every container closed the escape for a frame that
 * CLAIMS a theme. The other half is the frame that claims nothing: it is not
 * judged in ANY container, so its container cannot hide a judgement it would
 * fail - what it can still be is INVISIBLE, which is why the manifest records
 * these counts and the walk fails when the tree disagrees with them. A frame
 * added here moves a number a reviewer reads.
 */
export const unjudgedFrames = (dir, declared = [], palettes = PALETTES) => {
	const inside = [];
	const outside = [];
	const walk = (current) => {
		for (const entry of readdirSync(current)) {
			const path = join(current, entry);
			if (statSync(path).isDirectory()) {
				walk(path);
				continue;
			}
			if (!isFrameContainer(entry)) continue;
			if (isJudgedFrame(entry, palettes)) continue;
			(inDeclaredSet(path, declared) ? inside : outside).push(
				relative(ROOT, path),
			);
		}
	};
	walk(dir);
	return { inside, outside };
};

/**
 * The colour covering the most pixels, decoded in this process.
 *
 * Exported as `frameHistogram` so `scripts/evidence-histogram-parity.mjs` can
 * compare THE SHIPPED READER against the ImageMagick one it replaced: a rig that
 * re-implemented this side would agree with itself whatever the guard did.
 *
 * WHY THE SUBPROCESS IS GONE. This used to shell out to
 * `magick <file> -format %c -depth 8 histogram:info:-` once per frame and read
 * the mode out of its sorted histogram. The sweep covers every committed frame -
 * 9763 of them on this tree - and the saving is real but it is a property of the
 * HOST, so the figures are quoted with the machine they were taken on: 8x-11x
 * over a 24-64 frame sample at load averages 58-84 (magick 31.8 s against 2.8 s
 * in process over 64 frames), 27x on one 1280x1404 frame at load 50 (18.5 s
 * against 0.69 s), and 3x at load 171, where the in-process leg is starved too.
 * `scripts/evidence-histogram-parity.mjs` is the re-runnable form of that
 * comparison - the same frames, both readers, back to back - and it also shows
 * the two readers agreeing on the mode, its count and the total. `sharp` was
 * already a devDependency and already decodes WebP for other rigs, so no
 * dependency is added.
 *
 * WHAT IS DELIBERATELY THE SAME. The verdict is still "the colour covering the
 * most pixels": one count per distinct 8-bit colour, the winner is the largest
 * count, and ties go to the colour met first in raster order - the order
 * ImageMagick builds its histogram dictionary in, so a tie resolves the same
 * way. `coverage` is still the mode's count over the total number of pixels, and
 * `hex` is still uppercase `#RRGGBB`, which is what `deltaE` and the palette
 * comparison downstream consume.
 *
 * A READ THAT FAILS MUST STILL SAY SO IN THOSE WORDS. "This tool could not read
 * the file" and "this frame is one flat colour" are different findings, and an
 * earlier version of the subprocess reader turned the first into the second
 * against 87 good frames. A decode that throws, or that yields no pixels, throws
 * here with the same wording the child used to produce, so every caller and
 * message downstream is unchanged.
 */
export const frameHistogram = async (file) => {
	let decoded;
	try {
		decoded = await sharp(file).raw().toBuffer({ resolveWithObject: true });
	} catch (err) {
		throw new Error(`${file}: could not read the image - ${err.message}`);
	}
	const { data, info } = decoded;
	if (!info.width || !info.height || data.length === 0) {
		throw new Error(
			`${file}: could not read the image - the decode produced no pixels`,
		);
	}
	/*
	 * Four-channel frames keep their alpha in the key, at 8 bits, exactly as
	 * `-depth 8` printed it: dropping it would merge two colours ImageMagick
	 * counted separately, and the mode could then be a colour the frame does not
	 * have. `channels` is 3 for every frame in this set today (measured over the
	 * sample the parity rig compares); the branch exists so an alpha-bearing
	 * capture cannot quietly change what the mode means.
	 */
	const hasAlpha = info.channels === 4;
	/*
	 * A buffer that is not a whole number of pixels is one this reader cannot
	 * count: the loop below would read past the last pixel and fold `undefined`
	 * into a key as `NaN`. Nothing produces that today, and the guard's rule is
	 * that a read it cannot perform says so in the words the subprocess used
	 * rather than inventing a mode (review round 1, MAJOR-1).
	 */
	if (info.channels < 3 || data.length % info.channels !== 0) {
		throw new Error(
			`${file}: could not read the image - the decode produced ${data.length} bytes across ${info.channels} channels, which is not a whole number of pixels`,
		);
	}
	const counts = new Map();
	let total = 0;
	for (
		let offset = 0;
		offset + info.channels <= data.length;
		offset += info.channels
	) {
		const rgb =
			(data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
		// The alpha byte is folded in only for a four-channel frame, so a
		// three-channel frame's key IS its `#RRGGBB` value and the shift below is
		// the only place the two shapes differ. Multiplying unconditionally - as
		// this did when the parity rig was first run - printed `#282A3700` for a
		// frame with no alpha at all, which the rig caught on its first sample.
		const key = hasAlpha ? rgb * 256 + data[offset + 3] : rgb;
		counts.set(key, (counts.get(key) ?? 0) + 1);
		total += 1;
	}
	let best = null;
	for (const [key, count] of counts) {
		if (best === null || count > best.count) best = { count, key };
	}
	if (best === null) return null;
	/*
	 * A four-channel key is `rgb * 256 + alpha`, which leaves 32-bit SIGNED range
	 * for any mode whose red channel is at or above 0x80, and the recovery below
	 * used to be `best.key >> 8`. That is exactly those frames: the shift returned
	 * a negative "colour" - `#-373738` on a 4-channel probe whose mode is
	 * `#C8C8C8` - and the count and total beside it were right, so the guard would
	 * have measured the garbage and judged the frame on it (on the dracula palette
	 * that reads ΔE00 29.13 against the ceiling of 25, so a legitimate frame is
	 * reported as a paint failure, and another palette lets a bad one through).
	 * Multiplication and `Math.floor` are exact inverses in double precision for
	 * every key this loop can produce, which `>> 8` was not. Review round 1,
	 * MAJOR-1; `scripts/evidence-histogram-parity.mjs` now writes a 4-channel
	 * frame of its own so the branch is exercised by the rig rather than by hope.
	 */
	const rgb = hasAlpha ? Math.floor(best.key / 256) : best.key;
	return {
		count: best.count,
		hex: `#${rgb.toString(16).padStart(6, "0").toUpperCase()}`,
		coverage: best.count / total,
		// Reported for `scripts/evidence-histogram-parity.mjs`, which explains a
		// disagreement with it; nothing in the guard reads it.
		total,
	};
};

/**
 * The same test, for one frame, so the capture can fail at the source.
 *
 * Throwing here costs one screenshot; discovering it in review costs a round
 * and leaves a set that reported a count it could not honour.
 */
export const assertFramePaints = async (file, theme) => {
	const palette = PALETTES.get(theme);
	if (!palette) throw new Error(`${file}: no palette named \`${theme}\``);
	const mode = await frameHistogram(file);
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

/**
 * Nearest of the four grounds, in ΔE00.
 *
 * Exported with the two ceilings so `scripts/evidence-histogram-parity.mjs`
 * judges a frame with THIS function rather than a copy: the question that rig
 * asks is whether the two decoders reach the same verdict, and a second
 * implementation of the verdict could only answer it about itself.
 */
export function groundDistance(hex, palette) {
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
 * The two questions every sha citation in this file is asked, defined once so
 * the stamp and citation halves cannot drift apart.
 *
 * REACHABLE, not merely resolvable. `rev-parse --verify` says yes to a dangling
 * object, which is precisely the sha that shipped: a pre-amend `wip:` commit
 * still resolves in the clone that created it and nowhere else. The property
 * that makes a citation durable is being reachable from a ref, because that is
 * what survives `git gc` and what a fresh clone can look up. `--all` covers
 * branches, remotes and tags; a sha reachable from none of them is one this
 * repository will forget.
 */
const shaReaders = (git) => ({
	resolves: (sha) =>
		git(["rev-parse", "--quiet", "--verify", `${sha}^{commit}`]) !== null,
	reachable: (sha) =>
		git(["merge-base", "--is-ancestor", sha, "HEAD"]) !== null ||
		(git([
			"for-each-ref",
			"--count=1",
			"--contains",
			sha,
			"--format=%(refname)",
		]) ?? "") !== "",
});

/**
 * The story id a committed frame's DIRECTORY names.
 *
 * `capture-evidence.mjs` writes `docs/evidence/<surface>/<leaf>/<theme>.webp`
 * and records the story behind it as `<surface>--<leaf>`, which is the form
 * `refreshedStories` is written in, so comparing the two means undoing the
 * capturer's own naming. A story swept at several WIDTHS writes one directory
 * per width (`<leaf>@<width>`, the suffix stripped here); an entry that names
 * its own `dir` writes a second state of one story under a name the story's id
 * only prefixes (`chat-tool-rows--expanded-overflow-narrow` writes
 * `expanded-overflow-narrow-end`), which `claimedStory` covers.
 */
const frameStoryId = (file, root = ROOT) => {
	const segments = relative(root, file).split("/").slice(2, -1);
	if (segments.length < 2) return null;
	const [surface, ...leaf] = segments;
	return `${surface}--${leaf.join("/").replace(/@\d+$/, "")}`;
};

/**
 * The directory the capturer writes a story into when it names one itself.
 *
 * `capture-evidence.mjs` writes `docs/evidence/<surface>/<leaf>` for a story id
 * `<surface>--<leaf>`, except where a STORIES tuple names its own `dir`: that is
 * how a story is captured in a SECOND state - a scroll position, browser state
 * a story cannot set - so the frames land in a directory the story's id only
 * prefixes (`chat-tool-rows--expanded-overflow-narrow` writes
 * `expanded-overflow-narrow-end`).
 *
 * Read from the capturer rather than copied here, because a copy is a second
 * definition of a thing the capturer OWNS: the gate would then disagree with
 * the writer it audits the first time someone adds an entry on one side only.
 * Built on first use, never at module scope - see the import above.
 */
let dirOverrides = null;
const overrideDirFor = (id) => {
	dirOverrides ??= new Map(
		STORIES.filter((entry) => entry?.[3]?.dir).map(([story, , , opts]) => [
			story,
			opts.dir,
		]),
	);
	return dirOverrides.get(id) ?? null;
};

/**
 * Whether a `refreshedStories` entry names the directory `surface`/`leaf` is,
 * or the one the capturer's `dir` override writes that story into.
 *
 * The override is the ONLY prefix relation this accepts. It used to accept any
 * extension of the entry's own name, which let an entry be satisfied without
 * naming a real directory: dropping `chat-run-panel--mcp-grant-running` and
 * adding `chat-run-panel--mcp-grant` left the guard green, because the shortened
 * entry claimed the dropped directory's frames (round 6, R6-2; the same hole one
 * round earlier, Q5). `refreshedStories` is what a reader follows to the frames,
 * so an entry that resolves to nothing describes a run that did not happen.
 */
export const claimedStory = (id, surface, leaf) => {
	const cut = id.indexOf("--");
	if (cut === -1 || id.slice(0, cut) !== surface) return false;
	const name = id.slice(cut + 2);
	return name === leaf || overrideDirFor(id) === leaf;
};

/**
 * Whether a committed evidence path sits inside a declared `supplementary` set.
 *
 * Exported because `evidence-fold.mjs` derives `partialCapture.refreshedFrames`
 * against this exact denominator: the derived field and the guard that reads it
 * back must agree about WHICH frames the field is a claim about, and two copies
 * of the rule would drift the first time a set is declared. A declared set is
 * declared precisely because a sweep cannot produce its frames, so a field that
 * claimed them would claim frames no run wrote.
 */
export const inDeclaredSet = (file, declared) =>
	declared.some((dir) => file.startsWith(`${dir}/`));

/**
 * The story directory a committed frame's repository-relative path sits in, as
 * `refreshedStories` spells it (`<surface>--<leaf>`), or null for a path that
 * is not a frame at a story's depth.
 *
 * `root` is injectable for the same reason `stampFailures` takes an evidence
 * directory: `evidence-fold.mjs` re-derives `partialCapture.refreshedFrames`
 * against a tree that is not this checkout, and the derived number must be the
 * number THIS matcher feeds the guard - a second walker would agree with itself
 * whatever the guard asked. It defaults to this repository's root, so every
 * caller here reads exactly what it always read.
 */
const storyOf = (file, root = ROOT) => {
	const id = frameStoryId(join(root, file), root);
	if (id === null) return null;
	const cut = id.indexOf("--");
	return { id, surface: id.slice(0, cut), leaf: id.slice(cut + 2) };
};

/**
 * Whether some `refreshedStories` entry names the directory this frame is in.
 *
 * Exported because the writer of `partialCapture.refreshedFrames` has to ask the
 * field's question with THIS predicate: the field and the guard that reads it
 * back must agree about which frames the pass claims, and restating the
 * directory rule in the writer is how the two drift (the first version of the
 * re-derivation matched a two-level `<leaf>/<state>` directory this matcher does
 * not, and so counted 62 frames the guard never sees).
 */
export const namedByPass = (file, stories, root = ROOT) => {
	const story = storyOf(file, root);
	return (
		story !== null &&
		stories.some((entry) => claimedStory(entry, story.surface, story.leaf))
	);
};

/**
 * `partialCapture` must not UNDERSTATE the pass it describes, in the half CI
 * runs.
 *
 * The requirement is `main()`'s and was written there first: the capturer once
 * wrote the current run's totals rather than accumulating them, so a pass
 * narrowed into twelve per-story runs recorded `2 frames, 1 story` while 26
 * frames moved, and the gate stayed green because every count in it is about
 * what is ON DISK while this block is about what a RUN did. `refreshedFrames`
 * must therefore account for at least what the run is recorded as having
 * rewritten, one-sided by design: a re-capture that reproduces identical bytes
 * leaves no trace in the diff, so the claim may legitimately EXCEED it.
 *
 * It lives here, beside `frames`, because it was in the wrong half for a whole
 * round (round 5, R5-2; round 4 said the same of the number itself): its only
 * comparison was `main()`'s, behind that function's ImageMagick loop, and no
 * CI workflow runs `main()` - so mutating `refreshedFrames` to 179 or 228 left
 * `scripts/evidence-manifest.test.mjs` 15/15 green. Nothing here needs an
 * image: it is two git reads over the evidence path - `ls-tree` of `HEAD` and
 * the pass's `diff` - plus the story-directory arithmetic that excludes the
 * declared sets, and `stampFailures` calls it, which is what binds it to the
 * SHIPPED manifest from the fast suite.
 *
 * `refreshedStories` is asked the same question, and it had no guard anywhere.
 * A pass rewrites whole story directories, so a list that lost one is a list
 * that no longer describes the run it is cited beside - the round-4 incident's
 * own shape, where the field named 17 of the 21 directories the pass rewrote
 * plus one whose frames had not moved at all. An entry also has to resolve to a
 * real directory rather than merely prefix one: see `claimedStory`.
 *
 * Frames inside a `supplementary` set are excluded from both terms: a set is
 * declared precisely because a sweep CANNOT produce its frames, so demanding
 * this field claim them would demand it claim frames no run wrote. Both terms
 * measure `HEAD` rather than the working tree, so an author with a capture in
 * flight is not reported as a defect the moment they run the fast suite, and
 * both are asked with git reads that stand down rather than fail when a
 * repository cannot answer - a tree with no `.git` at all reports nothing.
 *
 * The two terms are asked separately rather than one standing in for the other,
 * because they need different things of the clone and see different defects:
 * term 1 needs only `HEAD`'s tree and fires on every checkout including CI's
 * one-commit-deep one, term 2 needs the pass's commits and is the only thing
 * that can see a list narrowed together with its total.
 */
export const partialCaptureFailures = (manifest, git = gitOut) => {
	const out = [];
	const pc = manifest?.partialCapture;
	if (!pc || typeof pc !== "object" || typeof pc.refreshedAtHead !== "string")
		return out;
	const declared = (manifest.supplementary ?? [])
		.filter((set) => typeof set.path === "string" && set.path.length > 0)
		.map((set) => relative(ROOT, join(EVIDENCE, set.path)));
	const claimed = pc.refreshedFrames ?? 0;
	const stories = Array.isArray(pc.refreshedStories) ? pc.refreshedStories : [];
	const evidencePath = relative(ROOT, EVIDENCE);

	/*
	 * Term 1: asked of `HEAD`'s tree alone.
	 *
	 * This is the term that answers the field everywhere, and it exists because
	 * the previous version answered it only where the pass's commits were
	 * present: its single comparison stood down on `changed === null`, which is
	 * every CI checkout - `actions/checkout`'s default clone is one commit deep
	 * (`.github/workflows/ci.yml:148`), so the pass's parent commit - which this
	 * block cites as `partialCapture.refreshedFromHead` - resolves to nothing there,
	 * and the field was unguarded in the half CI runs (round 6,
	 * R6-1; round 5, R5-2 one layer up). `ls-tree` needs no ancestor of `HEAD`,
	 * so the question is answerable in a one-deep clone.
	 *
	 * What it can and cannot see, stated because it is not the same question as
	 * term 2: it counts the committed frames standing in the directories this
	 * block NAMES, so it catches a total overwritten downward while the list
	 * stays honest - the round-5 incident - and it cannot catch a list narrowed
	 * together with its total, which is what term 2 is for. The denominator is
	 * scoped to the named directories rather than to the whole swept set for
	 * exactly that reason: the field is a claim about a run, not about the tree.
	 */
	const committed = git([
		"ls-tree",
		"-r",
		"--name-only",
		"HEAD",
		"--",
		evidencePath,
	]);
	if (committed !== null) {
		const named = committed
			.split("\n")
			.filter(
				(file) =>
					file.endsWith(".webp") &&
					!inDeclaredSet(file, declared) &&
					namedByPass(file, stories),
			);
		if (named.length > claimed) {
			out.push(
				`manifest.json: partialCapture claims ${claimed} refreshed frames, but ${named.length} committed frames stand in the directories refreshedStories names at HEAD - a narrowed run overwrote the pass's total instead of accumulating it`,
			);
		}
	}

	/*
	 * Term 2: the pass's own commits, where this clone carries them.
	 *
	 * The stronger question - which directories a run actually rewrote is only in
	 * the diff - and the one that catches a list narrowed along with its total.
	 * It stands down in a one-commit-deep checkout, and it is no longer the only
	 * thing asking: term 1 above has already answered the field by then. A
	 * stand-down here is not a stand-down of the guard.
	 *
	 * The denominator spans the whole PASS, not the last commit of it.
	 *
	 * `refreshedAtHead^..` measures one commit, and the capturer sums a pass
	 * across commits (it carries the total forward while the old head is an
	 * ancestor), so a two-commit pass checked against its second commit alone
	 * would compare a round's total against a fraction of the round's diff and
	 * the earlier commit's frames would go unclaimed. `passStart` is the first
	 * commit of the pass when the capturer recorded one, and the recorded head
	 * otherwise, so a single-commit pass measures exactly as it always did.
	 */
	const passStart = pc.refreshedFromHead ?? pc.refreshedAtHead;
	const changed = git([
		"diff",
		"--name-only",
		`${passStart}^`,
		"HEAD",
		"--",
		evidencePath,
	]);
	if (changed !== null) {
		const moved = changed
			.split("\n")
			.filter((line) => isJudgedFrame(line) && !inDeclaredSet(line, declared));
		if (moved.length > claimed) {
			out.push(
				`manifest.json: partialCapture claims ${claimed} refreshed frames, but ${moved.length} committed frames differ at ${pc.refreshedAtHead.slice(0, 9)} - a narrowed run overwrote the pass's total instead of accumulating it`,
			);
		}
		const unclaimed = [];
		for (const line of moved) {
			if (namedByPass(line, stories)) continue;
			const story = storyOf(line);
			if (story === null || unclaimed.includes(story.id)) continue;
			unclaimed.push(story.id);
		}
		if (unclaimed.length > 0) {
			out.push(
				`manifest.json: partialCapture.refreshedStories misses ${unclaimed.length} story director${unclaimed.length === 1 ? "y" : "ies"} the pass's commit rewrote (${unclaimed.join(", ")}) - a narrowed run overwrote the pass's list instead of accumulating it`,
			);
		}
	}
	return out;
};

/**
 * The manifest's provenance verdict, in two halves.
 *
 * ## Why this exists
 *
 * `head` is the field this half still asks about provenance: a capture has to
 * name a commit that resolves and is an ancestor of the tip (the citation half's
 * question, below). The TREES the frames were shot from are no longer stored in
 * this file at all - see "The stamp half, in its own words" for what replaced
 * the retired `srcTree`/`scriptsTree` pair.
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
 * It does NOT require `head` to equal the current HEAD. A tree-clean manifest
 * whose `head` is an older ancestor is honest and common: docs commits land
 * after a capture all the time, and forcing a re-stamp for them would train
 * people to re-stamp without re-capturing, which is the habit that produced
 * the defect in the first place.
 *
 * ## The two halves, and why the split is where it is
 *
 * `stampFailures` answers "does this file describe the tree under review":
 * `surfaces`/`themes` against the capturer's own lists, `frames` against the
 * frames committed on disk outside every declared set, and the pass tallies
 * against the pass's own commits. Those counts are the staleness question a
 * stored tree hash used to be asked, and they are still compared against the
 * TREE rather than against a commit - a docs-only commit moves `head` and leaves
 * every count untouched, and frames stay valid across it.
 *
 * `citationFailures` answers "does every commit this file cites still exist, and
 * is it still reachable": `head`, `supplementary[].capturedAtHead`, and
 * `partialCapture`'s `addedAtHead`/`refreshedAtHead`. An unreachable sha is the
 * failure that cannot be recovered from later, because the object goes away.
 *
 * The boundary is what a REBASE corrupts on one side and what a squash-merge
 * leaves dangling on the other, and the two halves have different dependencies,
 * which is why the split is there rather than for readability. A rebase that
 * keeps upstream's top-level block while the branch's delta rewrites the
 * neighbouring `partialCapture` leaves a file certifying frames against a tree
 * they did not come from - and git reports NO conflict, so nothing local notices
 * (round 3, M1: `surfaces` and the then-stored tree hashes all named
 * `origin/main` while the branch's own `STORIES` list had moved nine entries).
 * The counts half needs nothing but `HEAD`'s trees and the committed frames, so
 * `test:desktop` binds it against the SHIPPED manifest in under a second, and
 * that class is now caught on every pull request. The citation half needs the
 * cited commits to be present in the clone, which a shallow CI checkout does not
 * guarantee - so it is LOCAL-ONLY and the wired job does not claim it: where the
 * history is present the walk fails closed and reds the run, and where it is not
 * the half is left unjudged rather than printed as a stand-down on every run
 * (see `citationWalk` for that rule, and for why the printing was the wrong
 * shape). Its code path is covered by synthetic manifests in
 * `evidence-manifest.test.mjs`.
 *
 * `provenanceFailures` is both halves in the order a reader reads them, and is
 * what the gate reports. Exported so `evidence-manifest.test.mjs` binds the
 * shipped functions rather than a copy of their reasoning (round 2, R7).
 *
 * ## The stamp half, in its own words
 *
 * It answers "do these counts describe the tree the frames ship in": the three
 * counts the manifest states about itself, read from `HEAD`'s trees, the
 * capturer's own lists and the committed frames themselves, with no history
 * needed.
 *
 * **What this file certifies, after the tree stamps were retired.**
 * `docs/evidence/manifest.json` no longer stores a hash of `src/` or `scripts/`.
 * It declares what it can be checked against: the frame count on disk outside
 * its declared sets, the story and theme counts parsed from
 * `scripts/capture-evidence.mjs`, the pass tallies, and the commit its frames
 * were captured at - which must still resolve and still be an ancestor of
 * `HEAD`. The single thing the repo can **no longer** catch for you is the one
 * the stored pair used to: a `src/` change landing after a capture that alters a
 * surface the committed frames render, with no re-capture. That class is now a
 * review question - look at the frames and the diff, and say so - not a gate.
 * Everything else the pair was credited with catching it in fact never caught:
 * every recorded re-derive in this repository is explicitly *"re-stamped, not
 * re-captured"*, so a stored pair never proved any frame was freshly shot. Its
 * load-bearing effect was to force a mechanical re-derive - any commit anywhere
 * that moved `src/` or `scripts/` made the stored value false for every open
 * branch - and that is exactly the cost this change removes. A stored hash of a
 * tree the file does not own cannot be kept true; the counts and the citations
 * can, so those are what is left.
 *
 * The pair was retired rather than fixed because the failure is the STORAGE, not
 * the comparison: `stampFailures` compared a stored hash to `HEAD:src`, and
 * *any* sibling landing a `src/` change made that false. Deriving it at read
 * time instead would make the check vacuous (a hash derived from the tree under
 * review cannot disagree with it), so the claim goes. The class the pair was
 * built to catch - fold 10 and fold 11 shipping values that named a neighbour's
 * trees - is caught by the counts now: `surfaces`/`themes`/`frames` name the
 * tree under review exactly as those folds got wrong, and
 * `check-fold-keys.mjs` still refuses a fold that drops a key either parent
 * carried.
 *
 * ## What the aggregate fields mean, and where a capture's own origin lives
 *
 * `head` and `capturedAt` describe the tree the frames SHIP IN, not the pass
 * that took them: `head` is a commit of the branch under review, which the
 * citation half already requires to be an ancestor of the tip. The retired
 * `srcTree`/`scriptsTree` pair was the other half of that claim and is not
 * stored any more; `check-evidence.mjs` PRINTS the tree under review as a
 * reading (`tree under review: src=… scripts=…`) so a reviewer still sees which
 * source the frames sit on without the file making a claim it cannot keep.
 *
 * The capture itself is recorded in `captureOrigin`, which no gate reads: the
 * commit and time the frames came from (`head`/`capturedAt`), the tree hashes the
 * aggregate fields carried before they were re-derived, and the capture's own
 * `dirtyWorkingTree`. That block exists because the two questions are different -
 * "do these stamps describe the tree under review" (gate) and "which tree did
 * these pixels come from" (record) - and re-deriving the first used to destroy the
 * second. The shipped `dirtyWorkingTree` is the CAPTURE's, deliberately not a
 * current value: a re-derivation does not make an older capture clean, and
 * reporting one would be the misrepresentation this field exists to prevent.
 *
 * TWO passes contribute to that block, which is why it is described here rather
 * than read as one record (round 7's R35): `head`/`capturedAt` and the tree
 * hashes the inherited stamp block carried are preserved verbatim and
 * self-consistent only at the upstream commit that wrote it - its tree hashes are
 * that commit's own trees and never the capture head's (`0f19ae5e2:src` is a
 * different tree) - while `dirtyWorkingTree` is this branch's own `8e8660808`-era
 * record of the scratch docgen override its capture needed. A reader asking which
 * pass a field belongs to should be able to answer it from this comment.
 *
 * A re-derivation is therefore not a recapture and must not be described as one:
 * no frame is re-taken, no theme sweep is run, and older frames are historical
 * captures of the trees they name. A branch whose own delta is not covered by
 * those frames declares the sets that do cover it, so the uncovered delta is
 * named rather than implied.
 */
export const stampFailures = (manifest, git = gitOut, dir = EVIDENCE) => {
	const out = [];

	/*
	 * The `srcTree`/`scriptsTree` loop stood here and is RETIRED, not moved: a
	 * stored hash of the shipping tree is false for every open branch the moment
	 * any commit anywhere moves that tree (measured 2026-10-03: 29 of the 32
	 * first-parent merges onto `origin/main` in 24 hours moved `src/` or
	 * `scripts/`), so keeping the comparison would keep forcing a re-derive per
	 * fold. The counts below are the half that can stay true, so they are what
	 * this function asserts; the tree under review is still PRINTED for a reader
	 * (see `main`), and the claim the pair used to make is stated in this file's
	 * header as a review question rather than as a gate.
	 */

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
	const capture = git(["show", "HEAD:scripts/capture-evidence.mjs"]);
	const stories = capture === null ? 0 : declaredStoryRows(capture);
	if (stories > 0 && typeof manifest.surfaces === "number") {
		if (stories !== manifest.surfaces)
			out.push(
				`manifest.json: \`surfaces\` is ${manifest.surfaces} but capture-evidence.mjs declares ${stories} stories - a narrowed run carried the old value forward`,
			);
	}

	/*
	 * `themes` must equal the theme list it names, for the same reason
	 * `surfaces` must: only a full sweep writes it, so a narrowed run carries
	 * the previous value forward and nothing reads it. Parsed the same way as
	 * the story count above rather than imported, so both halves of the
	 * manifest's self-description are falsifiable by one mechanism.
	 */
	const themes = capture === null ? 0 : declaredThemeNames(capture);
	if (themes > 0 && typeof manifest.themes === "number") {
		if (themes !== manifest.themes)
			out.push(
				`manifest.json: \`themes\` is ${manifest.themes} but capture-evidence.mjs declares ${themes} themes - a narrowed run carried the old value forward`,
			);
	}

	/*
	 * `frames` must equal the frames on disk OUTSIDE every declared set.
	 *
	 * The fourth stamp question, and the one `main()` used to be alone in asking
	 * (`pnpm check-evidence` is now a job in `ci.yml`, which is why the sweep is
	 * no longer the only reader of this number): a manifest carrying a stale swept
	 * count can no longer reach a green run, because the same question is asked
	 * HERE, in the fast half, by a walk that reads no image. Reproduced: with the
	 * trees AND `surfaces` correct and `frames` set back to the previous sweep's
	 * `824`, the bound case stayed 14/14 green (code review round 4, m4).
	 *
	 * It is the same check `main()` makes, asked here with the same exclusion, so
	 * the two cannot drift: a supplementary set is exactly the reason a frame is
	 * NOT part of the sweep, and the whole point of the count is that the sweep
	 * answers for everything no set claimed. Only the frames are walked - no
	 * image is read - which is why this belongs in the fast half rather than
	 * behind the ImageMagick loop: the declaration side can go wrong (a doubled
	 * `supplementary` entry, a set's frames re-counted) while the trees and the
	 * story list stay right, and that is a provenance failure, not a cosmetic one.
	 *
	 * Skipped when the manifest carries no count, so a fixture built for the other
	 * checks is not asked about a tree it does not describe.
	 */
	if (typeof manifest.frames === "number") {
		const declaredDirs = (manifest.supplementary ?? [])
			.filter((set) => typeof set.path === "string" && set.path.length > 0)
			.map((set) => join(dir, set.path));
		const swept = frames(dir).filter(
			(file) => !declaredDirs.some((dir) => file.startsWith(`${dir}/`)),
		).length;
		if (manifest.frames !== swept)
			out.push(
				`manifest.json: \`frames\` is ${manifest.frames} but ${swept} frames are on disk outside every declared supplementary set - re-derive the swept count from \`docs/evidence\` rather than carrying the previous pass's value forward`,
			);
	}

	/*
	 * And the pass's own tally, on the same terms (round 5, R5-2): the two fields
	 * above are asked about the TREE, `refreshedFrames`/`refreshedStories` about
	 * what the pass's commits WROTE, and until now only `main()` asked the second
	 * question - so the field could be mutated below its own denominator and the
	 * fast suite stayed green. `partialCaptureFailures` states the arithmetic.
	 */
	out.push(...partialCaptureFailures(manifest, git));

	/*
	 * And the PROSE the fields are explained by, which is what a reader checks a
	 * fold against (round 3, R3-1).
	 */
	out.push(...countsMeanFailures(manifest, git, dir));

	/*
	 * And the frames the gate ACCOUNTS FOR but does not judge. Asked here, in the
	 * half `test:desktop` runs, because the whole point of the count is that no
	 * committed frame is invisible: a walk that reads no image is enough to notice
	 * one appearing.
	 */
	out.push(...unjudgedFrameFailures(manifest, dir));

	return out;
};

/**
 * The frames in a committed container whose name claims no theme: declared, not
 * discovered.
 *
 * WHY IT IS A FIELD AND NOT A SILENCE. `frames()` judges by NAME, so a frame
 * that claims a theme is judged whatever its container - but a frame that claims
 * nothing is judged in no container, and before this field existed it was also
 * counted by nothing: 869 such frames are committed today (341 inside declared
 * sets, 528 outside), and a `.png` added to that pile was invisible to the walk,
 * the count and the manifest at once. The three of them see it now: the field
 * states both counts, this guard fails when the tree disagrees, and `why` has to
 * say what the class IS - the compositor's pre-paint buffers (one flat ground,
 * which is exactly what the uniformity ceiling exists to refuse), screenshots
 * and props - so a reader of a green run knows what was not judged and why.
 *
 * The counts are DERIVED (`unjudgedFrames`) and the failure names both the walk's
 * numbers and the field to lead with, so the fix is a paste.
 */
export const unjudgedFrameFailures = (manifest, dir = EVIDENCE) => {
	const out = [];
	/*
	 * Gated the way `countsMeanFailures` is, and for the same reason: a manifest
	 * that declares no counts is a fixture about one narrow question (a head
	 * citation, a stamp pair), not a description of a tree - and the tree this
	 * guard would walk is this repository's own, not the fixture's.
	 */
	if (!manifest.countsMean || typeof manifest.countsMean !== "object")
		return out;
	const declared = (manifest.supplementary ?? [])
		.filter((set) => typeof set.path === "string" && set.path.length > 0)
		.map((set) => join(dir, set.path));
	const counted = unjudgedFrames(dir, declared);
	const field = manifest.unjudgedFrames;
	if (!field || typeof field !== "object") {
		out.push(
			`manifest.json: \`unjudgedFrames\` is missing, so the frames this gate accounts for WITHOUT judging are counted nowhere - lead it with { "insideDeclaredSets": ${counted.inside.length}, "outsideDeclaredSets": ${counted.outside.length}, "why": "..." } and say what the class is`,
		);
		return out;
	}
	if (
		field.insideDeclaredSets !== counted.inside.length ||
		field.outsideDeclaredSets !== counted.outside.length
	)
		out.push(
			`manifest.json: \`unjudgedFrames\` says ${field.insideDeclaredSets} inside the declared sets and ${field.outsideDeclaredSets} outside, but the walk finds ${counted.inside.length} and ${counted.outside.length} - a frame was added, moved or re-containered, so re-derive both counts and say what moved`,
		);
	if (typeof field.why !== "string" || field.why.trim().length < 40)
		out.push(
			"manifest.json: `unjudgedFrames.why` does not say what the unjudged class is - a count a reader cannot read the MEANING of is the skip this field exists to prevent",
		);
	return out;
};

/**
 * The story rows `capture-evidence.mjs` declares, counted from its source.
 *
 * One function rather than two copies of the same parse: the number is asked
 * about by the `surfaces` field AND by the prose that explains it, and two
 * mechanisms reading one literal is how they drift.
 */
export const declaredStoryRows = (capture) => {
	const block = capture.slice(capture.indexOf("const STORIES = ["));
	return (block.slice(0, block.indexOf("\n];")).match(/^\t\[/gm) ?? []).length;
};

/** The theme names `capture-evidence.mjs` declares, counted the same way. */
export const declaredThemeNames = (capture) => {
	const block = capture.slice(capture.indexOf("const THEMES = ["));
	return (block.slice(0, block.indexOf("\n];")).match(/^\t"/gm) ?? []).length;
};

/*
 * The form each `countsMean` paragraph leads in, and the reading it names, in
 * the order the paragraph writes them.
 */
const FRAMES_READING =
	/([\d,]+)\s+committed frames outside the ([\d,]+)\s+declared supplementary sets[\s\S]*?\bof\s+([\d,]+)\s+on disk\s*\(([\d,]+)\s+of them inside the sets\)/;
const SURFACES_READING =
	/([\d,]+)\s+rows in `HEAD:scripts\/capture-evidence\.mjs`'s STORIES literal/;
const THEMES_READING = /([\d,]+)\s+theme names in the `THEMES` literal/;

/** `1,234` -> `1234`, for comparing prose against a count. */
const proseCount = (text) =>
	Number.parseInt(String(text).replaceAll(",", ""), 10);

/**
 * The numbers `countsMean` explains must be the numbers the walk finds.
 *
 * WHY THIS HALF EXISTS. The fields beside the prose are guarded - `frames`
 * against the frames on disk outside every declared set, `surfaces`/`themes`
 * against the literals they name - and the paragraphs that EXPLAIN those fields
 * were not, because prose cannot be compared by reading a number. So the
 * paragraph went stale at three consecutive folds (round 1 R5, round 2 R2-1,
 * round 3 R3-1), the third time in the very commit that moved the stamps: the
 * re-derivation is a step the fold author has to run and copy, and a step nobody
 * re-runs is a step nobody has. The walk is the authority for both readings, so
 * it is asked about the prose here, in the fast half of the gate - the half
 * `test:desktop` runs - and a fold that moves the stamps and leaves the
 * paragraph behind now breaks CI instead of waiting for a reviewer to re-walk
 * 3,400 lines of JSON.
 *
 * Only the LEADING paragraph of each field is checked. The paragraphs under it
 * are historical by construction - each says in its own words that it describes
 * an older tree - and demanding this tree's numbers of them would force history
 * to be deleted rather than kept, which is the practice `citationConvention`
 * group (4) exists to protect.
 *
 * The failure message carries the paragraph to lead with, derived from the same
 * walk, because the fix is a paste and a check that only says "stale" is one the
 * next fold author has to solve by hand.
 */
export const countsMeanFailures = (manifest, git = gitOut, dir = EVIDENCE) => {
	const out = [];
	const mean = manifest.countsMean;
	if (!mean || typeof mean !== "object") return out;

	const sets = (manifest.supplementary ?? []).filter(
		(set) => typeof set.path === "string" && set.path.length > 0,
	);
	const declaredDirs = sets.map((set) => join(dir, set.path));
	const onDisk = frames(dir);
	const outside = onDisk.filter(
		(file) => !declaredDirs.some((declared) => file.startsWith(`${declared}/`)),
	).length;

	/**
	 * Compare one field's leading paragraph against the walk.
	 *
	 * `said` is `{}` when the paragraph does not match the form at all, which
	 * falls out of the same comparison rather than needing its own branch: every
	 * reading is then wrong, and the message prints the paragraph to paste.
	 */
	const check = (field, prose, said, derived, form) => {
		if (typeof prose !== "string" || prose.trim().length === 0) return;
		const wrong = Object.keys(derived).filter(
			(key) => said[key] !== derived[key],
		);
		if (wrong.length === 0) return;
		out.push(
			`manifest.json: \`countsMean.${field}\`'s leading paragraph is stale (${wrong
				.map(
					(key) =>
						`${key} says ${said[key] ?? "nothing this check can read"}, the walk finds ${derived[key]}`,
				)
				.join(
					"; ",
				)}) - the paragraph and the field describe different trees. Lead the field with: "${form}"`,
		);
	};

	const stories = (() => {
		const capture = git(["show", "HEAD:scripts/capture-evidence.mjs"]);
		return capture === null ? null : declaredStoryRows(capture);
	})();
	const themes = (() => {
		const capture = git(["show", "HEAD:scripts/capture-evidence.mjs"]);
		return capture === null ? null : declaredThemeNames(capture);
	})();

	const leading = (field) =>
		String(mean[field] ?? "")
			.trim()
			.split(/\n\s*\n/)[0];

	const framesProse = leading("frames");
	const framesMatch = framesProse.match(FRAMES_READING);
	check(
		"frames",
		framesProse,
		framesMatch
			? {
					"/committed frames outside the declared sets/": proseCount(
						framesMatch[1],
					),
					"/declared supplementary sets/": proseCount(framesMatch[2]),
					"/committed frames/": proseCount(framesMatch[3]),
					"/inside the declared sets/": proseCount(framesMatch[4]),
				}
			: {},
		{
			"/committed frames outside the declared sets/": outside,
			"/declared supplementary sets/": sets.length,
			"/committed frames/": onDisk.length,
			"/inside the declared sets/": onDisk.length - outside,
		},
		`RE-DERIVED FOR THIS FOLD: ${outside} committed frames outside the ${sets.length} declared supplementary sets below, of ${onDisk.length} on disk (${onDisk.length - outside} of them inside the sets).`,
	);

	const surfacesProse = leading("surfaces");
	const surfacesMatch = surfacesProse.match(SURFACES_READING);
	if (stories !== null && stories > 0)
		check(
			"surfaces",
			surfacesProse,
			surfacesMatch
				? { "/rows in the STORIES literal/": proseCount(surfacesMatch[1]) }
				: {},
			{ "/rows in the STORIES literal/": stories },
			`RE-DERIVED FOR THIS FOLD: ${stories} rows in \`HEAD:scripts/capture-evidence.mjs\`'s STORIES literal, counted the way \`check-evidence.mjs\` counts them (\`^\t\\[\` rows inside the block, parsed from the tree rather than taken from the writer).`,
		);

	const themesProse = leading("themes");
	const themesMatch = themesProse.match(THEMES_READING);
	if (themes !== null && themes > 0)
		check(
			"themes",
			themesProse,
			themesMatch
				? { "/theme names in the THEMES literal/": proseCount(themesMatch[1]) }
				: {},
			{ "/theme names in the THEMES literal/": themes },
			`RE-DERIVED FOR THIS FOLD: ${themes} theme names in the \`THEMES\` literal, counted the same way.`,
		);

	return out;
};

/**
 * Whether every commit the manifest cites still exists and is still reachable.
 *
 * The other half of `provenanceFailures`, and the half a squash-merge leaves
 * behind: a branch commit that a citation names goes dangling the moment the
 * branch is deleted, so the citation has to be re-pointed at the commit that
 * carries the same content onto `main` (see the `addedAtHeadNote` convention).
 * Split out so the stamp half above can be asserted against the real tree by
 * `test:desktop` without this half's dependency on what a clone happens to
 * contain - a shallow CI checkout has every stamp and not necessarily every
 * cited branch commit.
 *
 * THAT DEPENDENCY DECIDES HOW IT FAILS, and the answer is that this half is
 * LOCAL-ONLY. `actions/checkout`'s default is ONE COMMIT DEEP, so a truncated
 * clone cannot answer the question at all: every citation in the file reads as
 * missing at once, which is evidence that the CLONE is truncated rather than
 * that the commits are gone. Judging that as a failure reds the gate on a
 * manifest that is fine, for a reason a reader cannot act on, which is how a
 * gate gets routed around.
 *
 * SO THE WIRED JOB DOES NOT CLAIM THIS HALF, and the walk does not judge it in a
 * truncated clone: the citations are LEFT ALONE rather than failed, and nothing
 * is printed for them. That second half of the rule is the load-bearing one - a
 * stand-down that appears on 100% of runs is a standing excuse that reads as a
 * covered check, which is the "green by absence" the sweep's own wiring was
 * added to remove, one level up. The scope is declared where a reader meets the
 * gate instead of restated per run: the `evidence` job's step name and comment
 * in `ci.yml`, and this paragraph.
 *
 * WHERE IT IS JUDGED INSTEAD - AND, ON THIS FLEET, WHERE IT IS NOT: the honest
 * statement is stronger and less comforting than "local-only" sounds, because
 * `actions/checkout` is one commit deep AND every checkout here is shallow too.
 * Measured 2026-10-04: `git rev-parse --is-shallow-repository` is `true` in this
 * repository's own checkout, so a developer's `pnpm check-evidence` stands this
 * half down exactly as CI does, and `evidence-manifest.test.mjs`'s ancestry test
 * SKIPS here for the same reason. So on this fleet the citation half is checked
 * NOWHERE today - not in CI and not locally - and the four citations known to be
 * reachable from no remote ref (recorded on the wiring's PR) are the consequence.
 * What does answer it: a clone that HAS the history (`git fetch --unshallow`),
 * where this walk fails closed and reds the run, and the synthetic manifests in
 * `evidence-manifest.test.mjs`, which cover the code path itself wherever the
 * objects exist. A green run - local or in CI - is not evidence about citations.
 */
const citationWalk = (manifest, git = gitOut) => {
	const { resolves, reachable } = shaReaders(git);
	/*
	 * The truncation question. Fail CLOSED: only an explicit `true` stands a
	 * citation down, so a repository this cannot read is judged rather than
	 * excused.
	 */
	const truncated = git(["rev-parse", "--is-shallow-repository"]) === "true";
	const failures = [];
	/*
	 * The ONE spelling of "this clone cannot answer for that object" - which in a
	 * truncated clone is NOT a finding and is NOT collected either, because the
	 * scope is declared in the paragraph above rather than re-stated per run.
	 *
	 * The reachability arms below are deliberately untouched by it: an object that
	 * IS present and that no ref contains is the dangling case, and a depth-1
	 * clone can judge it, because the object being there IS the clone answering.
	 */
	const missing = (citation, sha) => {
		if (truncated) return;
		failures.push(
			`manifest.json: ${citation} ${sha.slice(0, 9)} resolves to no commit in this repository`,
		);
	};

	/*
	 * `head` first: it is the citation every other one is read beside, and the
	 * one a squash-merge leaves dangling when it names a commit of the branch
	 * that carried the frames.
	 */
	if (typeof manifest.head !== "string" || manifest.head.length < 7) {
		failures.push("manifest.json: `head` is missing or not a sha");
	} else if (!resolves(manifest.head)) {
		missing("`head`", manifest.head);
	} else if (!reachable(manifest.head)) {
		failures.push(
			`manifest.json: \`head\` ${manifest.head.slice(0, 9)} (${git(["log", "-1", "--format=%s", manifest.head]) ?? "?"}) is reachable from no ref - it is a dangling commit that resolves only in this clone and dies at the next gc, so a reader cannot check these frames against it`,
		);
	}

	for (const set of manifest.supplementary ?? []) {
		const sha = set.capturedAtHead;
		if (typeof sha !== "string" || sha.length < 7) continue;
		if (!resolves(sha)) {
			missing(`supplementary[${set.path}].capturedAtHead`, sha);
		} else if (!reachable(sha)) {
			failures.push(
				`manifest.json: supplementary[${set.path}].capturedAtHead ${sha.slice(0, 9)} is reachable from no ref - it dies at the next gc`,
			);
		}
	}

	/*
	 * `partialCapture`'s head citations, on the same bar.
	 *
	 * These two name the commits a NARROWED pass took frames at - `addedAtHead`
	 * the pass that added the story's frames, `refreshedAtHead` the pass that
	 * re-took existing ones - and a reader chasing "which tree are these pixels
	 * from" reads them exactly as they read `head`. They were unchecked, and
	 * both rotted in exactly the way this gate exists to catch: after the
	 * force-push `addedAtHead` held `45b6dd635`, reachable from no ref, while the
	 * gate reported the manifest clean and the round's own note claimed every
	 * citation was reachable (round 4, R4-1). Reachability is the bar for every
	 * sha in this file; a field the checker skips is a field that rots alone.
	 */
	for (const field of ["addedAtHead", "refreshedAtHead"]) {
		const sha = manifest.partialCapture?.[field];
		if (typeof sha !== "string" || sha.length < 7) continue;
		if (!resolves(sha)) {
			missing(`partialCapture.${field}`, sha);
		} else if (!reachable(sha)) {
			failures.push(
				`manifest.json: partialCapture.${field} ${sha.slice(0, 9)} (${git(["log", "-1", "--format=%s", sha]) ?? "?"}) is reachable from no ref - it is a dangling commit that resolves only in this clone and dies at the next gc, so a reader cannot check these frames against it`,
			);
		}
	}
	return failures;
};

/**
 * The citations this CLONE can judge and that fail. `provenanceFailures` reads this.
 *
 * Empty on a truncated clone, where the half is not part of the run at all (see
 * `citationWalk`). Everywhere the history is present it is the verdict on the
 * MANIFEST, and the only thing here that can turn a run red.
 */
export const citationFailures = (manifest, git = gitOut) =>
	citationWalk(manifest, git);

/**
 * Whether the citations a REBASE moves still name commits in this history.
 *
 * `citationFailures` above asks whether a cited sha still exists and is
 * reachable from some ref. That bar is what a squash-merge needs, and it is
 * deliberately loose: it also passes a sha kept alive by a local backup branch
 * or a peer's scratch branch, none of which a reader of the pull request has.
 * So a rebase that replays this branch's commits onto a new base leaves the
 * manifest citing the PRE-rebase spellings - every one of which still resolves
 * on the machine that did the rebase (the backup ref the rebase left) and none
 * of which exists in what a reviewer fetches. Three rebases in a row broke this
 * file that way: the stamp half in round 3, `head` and
 * `partialCapture.addedAtHead` orphaned by a force-push in round 5, and both at
 * once on the v0.22.1 rebase. Each was found by a reviewer, by eye, and none by
 * a gate the author runs.
 *
 * This is the bar that catches it. The three citations a rebase moves must lie
 * in the history the branch carries, i.e. be ancestors of `HEAD` - which is
 * exactly the question a reader asks of them, "which tree did these pixels come
 * from, and can I fetch it".
 *
 * WHY ONLY THESE THREE. They are the fields whose meaning is "a commit of this
 * branch's own work": the pass that ran at `head`, the pass that added a set's
 * frames, the pass that re-took them. `supplementary[].capturedAtHead` is
 * deliberately not included, because main's own sets legitimately cite the
 * branch commit that landed their frames - which is not an ancestor of this
 * branch while the PR that landed it is still open (chat-run-panel-live cites
 * `9ad6a4274` from `design/129-r2` that way). A check that failed on main's
 * evidence, on every branch, is one everyone learns to skip.
 *
 * NOT reachable from CI, where the checkout is one commit deep and no ancestor
 * is present: `evidence-manifest.test.mjs` skips it on a shallow clone. It fires
 * on the machine the rebase happens on, which is where the defect is made.
 */
export const citationAncestryFailures = (manifest, git = gitOut) => {
	const out = [];
	const inHistory = (sha) =>
		git(["merge-base", "--is-ancestor", sha, "HEAD"]) !== null;
	for (const [field, sha] of [
		["head", manifest.head],
		["partialCapture.addedAtHead", manifest.partialCapture?.addedAtHead],
		[
			"partialCapture.refreshedAtHead",
			manifest.partialCapture?.refreshedAtHead,
		],
	]) {
		if (typeof sha !== "string" || sha.length < 7) continue;
		if (inHistory(sha)) continue;
		out.push(
			`manifest.json: \`${field}\` ${sha.slice(0, 9)} is not an ancestor of HEAD - it is a pre-rebase spelling of this branch's own work, still resolvable through a local ref that a reviewer does not have, so re-point it at the commit this lineage carries that change in`,
		);
	}
	return out;
};

/**
 * The manifest's whole provenance verdict, in the order a reader reads it: the
 * stamps that must describe the tree under review, then the citations that must
 * still resolve. Kept as one function because `check-evidence.mjs` reports it as
 * one list, and split internally so `test:desktop` can bind either half.
 */
export const provenanceFailures = (manifest, git = gitOut) => [
	...stampFailures(manifest, git),
	...citationFailures(manifest, git),
];

/*
 * The F3 advisory: the story file a set names against the stamp it was taken
 * at. See `storyDriftReadings` below for what it is and why it never gates.
 */

/**
 * The `*.stories.tsx` mention a set's own fields make, as a pattern that finds
 * a NAME and never a glob.
 *
 * The leading `[A-Za-z0-9_@]` is load-bearing: `update-report-accuracy`'s note
 * says "two `*.stories.tsx` files were edited after that capture", which names
 * the CLASS of story a running-app rig cannot photograph - not a file this
 * advisory could compare a commit against - and requiring at least one
 * filename character before `.stories.tsx` keeps that sentence out of the walk
 * while the shipped manifest's 21 real mentions stay in (22 sets contain the
 * string; 21 name a file).
 */
const STORY_MENTION = /[A-Za-z0-9_@][A-Za-z0-9_@./-]*\.stories\.tsx/g;

/**
 * Every name the set's own fields carry, deduplicated.
 *
 * All string fields are scanned, not just `source`: `ask-options-baseline`
 * names its story inside `why` (an array, so lists are walked element-wise),
 * and `model-picker-human-name-search` names the same file in `source` and in
 * a note - a name seen twice is one comparison.
 */
const storyNamesIn = (set) => {
	const names = new Set();
	for (const value of Object.values(set)) {
		for (const text of Array.isArray(value) ? value : [value]) {
			if (typeof text !== "string") continue;
			for (const match of text.matchAll(STORY_MENTION)) names.add(match[0]);
		}
	}
	return [...names];
};

/**
 * Where the story-file walk never descends, and why each is not the tree.
 *
 * `node_modules` is the shared dependency store - a worktree links it in as a
 * symlink and the walk only descends real directories, so the link is never
 * followed, while the name is skipped so the root checkout's store is not
 * walked either; `.git` stores no stories; `.worktrees` holds OTHER checkouts
 * of this repository, whose copies would double every basename the checkout
 * under review also carries; `out` and `dist` are build output, compiled
 * rather than authored.
 */
const STORY_WALK_SKIP = new Set([
	"node_modules",
	".git",
	".worktrees",
	"dist",
	"out",
]);

/**
 * Every `*.stories.tsx` in the tree, keyed by basename, in one walk.
 *
 * The basename is the key because most mentions ARE basenames
 * (`turn-collapse.stories.tsx`): the mention says which story the frames
 * picture and the tree says where that story lives. One walk serves every set -
 * a walk per set would pay for the index 169 times, which the design note's
 * "one `git log` per set" does not include - and the paths come back
 * root-relative, the form `git log` takes them in.
 */
const storyIndex = (root) => {
	const byBasename = new Map();
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!STORY_WALK_SKIP.has(entry.name)) walk(join(dir, entry.name));
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".stories.tsx")) continue;
			const file = relative(root, join(dir, entry.name));
			byBasename.set(entry.name, [...(byBasename.get(entry.name) ?? []), file]);
		}
	};
	if (existsSync(root)) walk(root);
	return byBasename;
};

/** Whether a path is a file - a directory is not a story a log can be asked of. */
const isFile = (path) => existsSync(path) && statSync(path).isFile();

/**
 * The one file in the tree a set's mention resolves to, or null.
 *
 * Three steps, because the mentions arrive in three shapes. A repository
 * relative path (`src/renderer/...`, how the settings sets spell it) resolves
 * as written. A bare basename (`turn-collapse.stories.tsx`) resolves when
 * exactly ONE file in the tree carries it; when several do, the set's own
 * directory gets its say before the advisory gives up, so an ambiguous name is
 * never silently pinned to a neighbour's file. And `harness/<name>` mentions -
 * the story a running-app rig was built from, committed beside its frames -
 * resolve under `docs/evidence/<set>/`. A name left unresolved is reported by
 * the caller as a record that does not agree with the tree.
 */
const storyFileFor = (name, setPath, index, root) => {
	const exact = join(root, name);
	if (isFile(exact)) return name;
	const candidates = index.get(basename(name)) ?? [];
	if (candidates.length === 1) return candidates[0];
	const beside = join("docs", "evidence", setPath, name);
	return isFile(join(root, beside)) ? beside : null;
};

/**
 * The F3 advisory: each set's `capturedAtHead` against the story file it names.
 *
 * WHAT IT IS. The stamp-removal design records, in its §4.2, the class a
 * reviewer has to catch by eye today: "a `src/` change that alters a rendered
 * surface without a re-capture (the `9a26e2d6f` page-ground lift is the
 * recorded case)". The cheap half of that guarantee is this comparison - the
 * last commit to touch the story file a set names should be an ANCESTOR of
 * the set's `capturedAtHead`, and when it is not, the frames may not picture
 * the story's current cut. It is a READING and not a verdict on purpose: a set
 * captured from the running app can legitimately name a story that moved
 * afterwards (a `-before` set's whole point is a state the current story no
 * longer draws), so a check that reddened those is one everyone learns to
 * skip. A gating version is deliberately out of scope.
 *
 * WHY IT CANNOT TURN A RUN RED, said where the decision can be checked: it
 * returns strings and nothing else. It is never composed into
 * `provenanceFailures`, its return is never pushed into `failures`, and
 * `main()` prints it as `NOTE` lines beside the tree under review - and the
 * exit paths there read `failures` alone, so nothing returned here has a path
 * into `process.exit(1)`. That independence IS the feature; do not compose
 * this into the gates "while we are here", and the case in
 * `scripts/evidence-run-guard.test.mjs` is what pins it end to end.
 *
 * WHAT IT ANSWERS, EXACTLY. For each supplementary set whose own string fields
 * name a `*.stories.tsx` file (`storyNamesIn`), the file is resolved against
 * the tree (`storyFileFor`). A name that resolves to nothing is reported on
 * its own - the record points at a story this tree does not carry, a
 * disagreement computable without a stamp (the shipped manifest's one miss,
 * `common-connectivity-banner-baseline`, is exactly a set with no
 * `capturedAtHead`), while the COMPARISON is skipped for sets whose
 * `capturedAtHead` is missing or shorter than a sha, since there is no stamp
 * to compare against. For a resolved name and a stamp, the stamp must first be
 * ANSWERABLE - `rev-parse --quiet --verify <sha>^{commit}`, the same
 * resolvability question `citationFailures` asks - because `merge-base
 * --is-ancestor` exits 1 for "not an ancestor" and 128 for "cannot answer"
 * (a missing object, e.g. a branch commit kept alive only by a local ref) and
 * the reader folds both to null: without the gate, a stamp this history has
 * never heard of fires as drift while the citation gate - the one that should
 * report it - is the loud half. Then `git log -1 --format=%H -- <file>` names
 * the last commit to touch the file, and the advisory fires when that commit
 * is not an ancestor of `capturedAtHead` - i.e. the file moved on a lineage
 * the capture does not include. A path git answers nothing for (untracked, or
 * outside this history) is left alone: the advisory speaks only when it can.
 *
 * THE RESOLUTION RULE, which is the part to hold against §4.2's intent ("the
 * story file the set names"): exact repository-relative path, else a basename
 * exactly one file in the tree carries, else the set's own directory
 * (`docs/evidence/<set>/`, how `harness/...` mentions are committed beside
 * their frames). 20 of the shipped manifest's 21 named files resolve that way;
 * the miss is the connectivity-banner set's own story, which is not in this
 * tree.
 *
 * THE INJECTION. `git` and `root` are parameters for the reason the other
 * exported checks take theirs: `scripts/evidence-manifest.test.mjs` drives
 * this against a synthetic tree and a fake git, and the relocated CLI in
 * `scripts/evidence-run-guard.test.mjs` drives the real one against an
 * isolated fixture - neither should have to stand up this repository's history
 * to ask what the function CONCLUDES.
 */
export const storyDriftReadings = (manifest, git = gitOut, root = ROOT) => {
	const out = [];
	const index = storyIndex(root);
	for (const set of manifest.supplementary ?? []) {
		if (typeof set.path !== "string") continue;
		const sha = set.capturedAtHead;
		for (const name of storyNamesIn(set)) {
			const file = storyFileFor(name, set.path, index, root);
			if (file === null) {
				out.push(
					`supplementary[${set.path}]: names ${name}, which does not resolve to one file in this tree`,
				);
				continue;
			}
			if (typeof sha !== "string" || sha.length < 7) continue;
			/*
			 * The stamp must be ANSWERABLE before its ancestry is asked about.
			 * `merge-base --is-ancestor` exits 1 for "not an ancestor" and 128
			 * for "cannot answer" (a missing object - e.g. a branch commit kept
			 * alive only by a local ref, which is `provider-setup-ux-before` in a
			 * clone that fetched only origin), and the reader folds both to null;
			 * without this gate the second reads as the first and manufactures a
			 * drift line. `rev-parse --quiet --verify` asks the resolvability
			 * question `citationFailures` asks (`shaReaders`), so a stamp this
			 * history cannot answer for stays silent here - the citation gate is
			 * what reports it, and this advisory must not guess.
			 */
			if (!git(["rev-parse", "--quiet", "--verify", `${sha}^{commit}`]))
				continue;
			const last = git(["log", "-1", "--format=%H", "--", file]);
			if (!last) continue;
			if (git(["merge-base", "--is-ancestor", last, sha]) !== null) continue;
			out.push(
				`supplementary[${set.path}]: capturedAtHead ${sha.slice(0, 9)} does not include ${last.slice(0, 9)}, the last commit to touch ${file} - the frames may not picture the story's current cut`,
			);
		}
	}
	return out;
};

// Exported only for the admitted worker's import; ordinary imports still never
// sweep frames (capture-evidence imports the single-frame predicates).
export const main = async () => {
	if (!existsSync(EVIDENCE)) {
		console.error(`No evidence at ${EVIDENCE}`);
		process.exit(1);
	}

	const files = frames(EVIDENCE);
	const failures = [];
	let checked = 0;
	let worst = { got: -1, file: "" };

	for (const file of files) {
		const theme = frameStem(file);
		const palette = PALETTES.get(theme);
		if (!palette) {
			failures.push(`${relative(ROOT, file)}: no palette named \`${theme}\``);
			continue;
		}
		const mode = await frameHistogram(file);
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
		 * into `frames` would make the sweep's count - and with it its `head` and
		 * `capturedAt`, which a reader uses to decide whether the
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

		/*
		 * `partialCapture` must not UNDERSTATE the pass it describes.
		 *
		 * The arithmetic lives in `partialCaptureFailures` because the half of the
		 * gate that reads it is the SWEEP - a whole-tree decode, minutes long - and
		 * the fast suite has to be able to answer the same question without one. A
		 * field guarded only there is a field a green `test:desktop` cannot see
		 * (round 5, R5-2; round 4 said the same of the number itself).
		 * `stampFailures` - and through it `scripts/evidence-manifest.test.mjs` -
		 * calls the same function, so the denominator, the set exclusion and the two
		 * messages cannot drift between the halves.
		 */
		failures.push(...partialCaptureFailures(manifest));

		/*
		 * THE TREE UNDER REVIEW, PRINTED AND NOT ASSERTED. The manifest declares
		 * its counts and its citations; it deliberately no longer stores a hash of
		 * `src/` or `scripts/` (see the header's "What this file certifies"), so a
		 * reviewer looking at committed frames still needs to know which source
		 * they sit on. Printing it costs two `rev-parse`s and keeps that answer
		 * available without making the file claim it - a claim a sibling's commit
		 * can falsify at any moment.
		 */
		const reviewed = ["src", "scripts"].map(
			(path) => gitOut(["rev-parse", `HEAD:${path}`]) ?? "unknown",
		);
		console.log(
			`tree under review: src=${reviewed[0].slice(0, 9)} scripts=${reviewed[1].slice(0, 9)}`,
		);

		/*
		 * THE F3 ADVISORY, PRINTED AS A READING AND NEVER ASSERTED. What it can
		 * see, and why that can never turn a run red, is `storyDriftReadings`'
		 * doc block; what this spot adds is the proof: the exit paths at the end
		 * of this function read `failures` and nothing else, so these lines print
		 * beside the tree under review and have no path into the exit code. That
		 * independence is the feature - do not later compose them into `failures`
		 * "while we are here".
		 */
		for (const note of storyDriftReadings(manifest))
			console.log(`NOTE  ${note}`);

		/*
		 * THE CITATION HALF IS NOT PRINTED HERE, and that is deliberate rather than an
		 * omission: it is local-only (see `citationWalk`), so on the wired job's
		 * depth-1 checkout it is not part of the run at all - and a stand-down notice
		 * that appeared on 100% of runs would read as a covered check, which is the
		 * green-by-absence this sweep was wired to remove. The scope is declared once,
		 * in the job's step name and comment, not re-stated per run.
		 */
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

if (isEntryPoint(import.meta.url)) {
	// A fixed host path shares capacity across worktrees and isolated HOME/TMPDIR
	// runs. Never unlink this file: flock, not its contents or PID, owns admission.
	// Python's stdlib supplies nonblocking flock on both macOS and Linux without
	// installing a native Node dependency. No locking support means no sweep.
	const result = spawnSync(
		"python3",
		[
			join(ROOT, "scripts", "evidence-run-guard.py"),
			"/tmp/local-operator-ui-check-evidence.lock",
			process.execPath,
			"--input-type=module",
			"--eval",
			`const { main } = await import(${JSON.stringify(import.meta.url)}); await main();`,
		],
		// The guard is a real interpreter, so it is handed an environment whose
		// `PYTHON*` variables this process decided (scripts/python-child-env.mjs)
		// rather than whatever the shell that ran the sweep carried: an ambient
		// prefix inside an installed `.app` is how a harness wrote a cache into one.
		{ env: pythonChildEnv(), stdio: "inherit" },
	);
	if (result.error || result.signal) {
		console.error(
			`Evidence check BLOCKED: guarded worker failed: ${result.error?.message ?? result.signal}. Python 3 with POSIX flock is required.`,
		);
	}
	process.exitCode = result.status ?? 1;
}
