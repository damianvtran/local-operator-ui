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

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
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
const modalColour = (file, lockFd) => {
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
			{
				maxBuffer: 256 * 1024 * 1024,
				// Keep admission occupied if the sweep dies during image decoding.
				stdio: [
					"ignore",
					"pipe",
					"pipe",
					...(lockFd === undefined ? [] : [lockFd]),
				],
			},
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
const frameStoryId = (file) => {
	const segments = relative(ROOT, file).split("/").slice(2, -1);
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
const claimedStory = (id, surface, leaf) => {
	const cut = id.indexOf("--");
	if (cut === -1 || id.slice(0, cut) !== surface) return false;
	const name = id.slice(cut + 2);
	return name === leaf || overrideDirFor(id) === leaf;
};

/** Whether a committed evidence path sits inside a declared `supplementary` set. */
const inDeclaredSet = (file, declared) =>
	declared.some((dir) => file.startsWith(`${dir}/`));

/**
 * The story directory a committed frame's repository-relative path sits in, as
 * `refreshedStories` spells it (`<surface>--<leaf>`), or null for a path that
 * is not a frame at a story's depth.
 */
const storyOf = (file) => {
	const id = frameStoryId(join(ROOT, file));
	if (id === null) return null;
	const cut = id.indexOf("--");
	return { id, surface: id.slice(0, cut), leaf: id.slice(cut + 2) };
};

/** Whether some `refreshedStories` entry names the directory this frame is in. */
const namedByPass = (file, stories) => {
	const story = storyOf(file);
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
	 * (`.github/workflows/ci.yml:148`), so `db4add883^` in this manifest resolves
	 * to nothing there and the field was unguarded in the half CI runs (round 6,
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
			.filter(
				(line) => line.endsWith(".webp") && !inDeclaredSet(line, declared),
			);
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
 * It does NOT require `head` to equal the current HEAD. A tree-clean manifest
 * whose `head` is an older ancestor is honest and common: docs commits land
 * after a capture all the time, and forcing a re-stamp for them would train
 * people to re-stamp without re-capturing, which is the habit that produced
 * the defect in the first place.
 *
 * ## The two halves, and why the split is where it is
 *
 * `stampFailures` answers "does this file describe the tree under review":
 * `srcTree`/`scriptsTree` against the CURRENT `HEAD:src`/`HEAD:scripts`, and
 * `surfaces`/`themes` against the capturer's own lists. That is the staleness
 * question, and comparing TREES rather than commits is what the capture script's
 * own comment argues for - a docs-only commit moves `head` but not the trees,
 * and frames stay valid across it.
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
 * (round 3, M1: both tree hashes and `surfaces` named `origin/main`, and only
 * the full `pnpm check-evidence` sweep could see it, because that gate's image
 * loop runs over every committed frame and outran the reviewer's whole budget).
 * The stamp half needs nothing but `HEAD`'s trees, so `test:desktop` binds it
 * against the SHIPPED manifest in under a second, and that class is now caught
 * on every pull request. The citation half needs the cited commits to be present
 * in the clone, which a shallow CI checkout does not guarantee, so it keeps its
 * own tests on synthetic manifests.
 *
 * `provenanceFailures` is both halves in the order a reader reads them, and is
 * what the gate reports. Exported so `evidence-manifest.test.mjs` binds the
 * shipped functions rather than a copy of their reasoning (round 2, R7).
 *
 * ## The stamp half, in its own words
 *
 * It answers "do these stamps describe the tree the frames ship in": two tree
 * hashes and the three counts the manifest states about itself, read from
 * `HEAD`'s trees, the capturer's own lists and the committed frames themselves,
 * with no history needed.
 *
 * ## What the aggregate fields mean, and where a capture's own origin lives
 *
 * `head`, `capturedAt`, `srcTree` and `scriptsTree` describe the tree the frames
 * SHIP IN, not the pass that took them. `srcTree`/`scriptsTree` are read against
 * the current `HEAD`, so a value naming an earlier commit is exactly the
 * staleness this half reports, and history cannot live in them; `head` is a
 * commit of the branch under review, which the citation half already requires to
 * be an ancestor of the tip.
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
 * than read as one record (round 7's R35): `head`/`capturedAt` and
 * `srcTree`/`scriptsTree` are the inherited stamp block, preserved verbatim and
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
export const stampFailures = (manifest, git = gitOut) => {
	const out = [];

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

	/*
	 * `themes` must equal the theme list it names, for the same reason
	 * `surfaces` must: only a full sweep writes it, so a narrowed run carries
	 * the previous value forward and nothing reads it. Parsed the same way as
	 * the story count above rather than imported, so both halves of the
	 * manifest's self-description are falsifiable by one mechanism.
	 */
	if (capture !== null && typeof manifest.themes === "number") {
		const block = capture.slice(capture.indexOf("const THEMES = ["));
		const declared = (
			block.slice(0, block.indexOf("\n];")).match(/^\t"/gm) ?? []
		).length;
		if (declared > 0 && declared !== manifest.themes)
			out.push(
				`manifest.json: \`themes\` is ${manifest.themes} but capture-evidence.mjs declares ${declared} themes - a narrowed run carried the old value forward`,
			);
	}

	/*
	 * `frames` must equal the frames on disk OUTSIDE every declared set.
	 *
	 * The fourth stamp question, and until now the one only `main()` asked - a
	 * job no CI workflow runs, so a manifest could carry a stale swept count past
	 * a full green `test:desktop`. Reproduced: with the trees AND `surfaces`
	 * correct and `frames` set back to the previous sweep's `824`, the bound case
	 * stayed 14/14 green (code review round 4, m4).
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
			.map((set) => join(EVIDENCE, set.path));
		const swept = frames(EVIDENCE).filter(
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
 */
export const citationFailures = (manifest, git = gitOut) => {
	const out = [];
	const { resolves, reachable } = shaReaders(git);

	/*
	 * `head` first: it is the citation every other one is read beside, and the
	 * one a squash-merge leaves dangling when it names a commit of the branch
	 * that carried the frames.
	 */
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
			out.push(
				`manifest.json: partialCapture.${field} ${sha.slice(0, 9)} resolves to no commit in this repository`,
			);
		} else if (!reachable(sha)) {
			out.push(
				`manifest.json: partialCapture.${field} ${sha.slice(0, 9)} (${git(["log", "-1", "--format=%s", sha]) ?? "?"}) is reachable from no ref - it is a dangling commit that resolves only in this clone and dies at the next gc, so a reader cannot check these frames against it`,
			);
		}
	}
	return out;
};

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

// Exported only for the admitted worker's import; ordinary imports still never
// sweep frames (capture-evidence imports the single-frame predicates).
export const main = (lockFd) => {
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
		const mode = modalColour(file, lockFd);
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
		 * The arithmetic lives in `partialCaptureFailures` because this half of
		 * the gate runs behind the ImageMagick loop below and no CI workflow runs
		 * it, so a field guarded only here is a field with no guard (round 5,
		 * R5-2; round 4 said the same of the number itself). `stampFailures` -
		 * and through it `scripts/evidence-manifest.test.mjs` - calls the same
		 * function, so the denominator, the set exclusion and the two messages
		 * cannot drift between the halves.
		 */
		failures.push(...partialCaptureFailures(manifest));
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
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
			`const { main } = await import(${JSON.stringify(import.meta.url)}); main(3);`,
		],
		{ stdio: "inherit" },
	);
	if (result.error || result.signal) {
		console.error(
			`Evidence check BLOCKED: guarded worker failed: ${result.error?.message ?? result.signal}. Python 3 with POSIX flock is required.`,
		);
	}
	process.exitCode = result.status ?? 1;
}
