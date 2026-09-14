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
		 * Until this check existed, nothing here asserted anything about that
		 * block, and the field understated a round twice: the capturer wrote the
		 * current run's totals rather than accumulating, so a pass narrowed into
		 * twelve per-story runs recorded `2 frames, 1 story` while 26 frames
		 * moved. The gate stayed green both times, because the counts above are
		 * about what is ON DISK and this field is about what a RUN did.
		 *
		 * The check is against the frames that actually MOVED at this head, read
		 * from git rather than from the block itself: `refreshedFrames` must
		 * account for at least the changed `.webp` files, because a pass cannot
		 * have rewritten a frame it does not claim to have captured. It is
		 * one-sided - a re-capture producing identical bytes leaves no trace in
		 * the diff, so the claim may legitimately EXCEED the diff - and it is
		 * skipped when git cannot answer, so THIS check adds no new dependency on
		 * a repository. It does not make the whole gate pass without one: the
		 * provenance checks above already fail on a tree with no `.git`, because
		 * a manifest that names commits nothing can resolve is exactly what they
		 * exist to catch.
		 *
		 * Frames inside a `supplementary` set are excluded from the denominator.
		 * Those sets are declared precisely because a sweep CANNOT produce them
		 * - a live-app capture, an older source tree, a state the app does not
		 * ship - so they arrive by a route that is not a capture run, and
		 * counting them would demand that this field claim frames no run wrote.
		 * The incident this check exists for is unaffected: it moved 25 frames,
		 * none of them in a declared set.
		 */
		const pc = manifest.partialCapture;
		if (pc && typeof pc === "object" && pc.refreshedAtHead) {
			// `addedFrames` is a SUBSET of `refreshedFrames` in the capturer's own
			// tally (`captured` counts every frame written, new or overwritten),
			// so summing the two here would double-count a new surface.
			const claimed = pc.refreshedFrames ?? 0;
			/*
			 * The denominator spans the whole PASS, not the last commit of it.
			 *
			 * `refreshedAtHead^..` measures one commit, and the capturer now sums
			 * a pass across commits (it carries the total forward while the old
			 * head is an ancestor), so a two-commit pass checked against its
			 * second commit alone would compare a round's total against a
			 * fraction of the round's diff - the two would agree and the earlier
			 * commit's frames would go unclaimed. `passStart` is the first commit
			 * of the pass when the capturer recorded one, and the recorded head
			 * otherwise, so a single-commit pass measures exactly as before.
			 */
			const passStart = pc.refreshedFromHead ?? pc.refreshedAtHead;
			const changed = gitOut([
				"diff",
				"--name-only",
				`${passStart}^`,
				"--",
				relative(ROOT, EVIDENCE),
			]);
			if (changed !== null) {
				const moved = changed
					.split("\n")
					.filter(
						(line) =>
							line.endsWith(".webp") &&
							!extra.some((set) =>
								line.startsWith(`${relative(ROOT, join(EVIDENCE, set.path))}/`),
							),
					).length;
				if (moved > claimed) {
					failures.push(
						`manifest.json: partialCapture claims ${claimed} refreshed frames, but ${moved} committed frames differ at ${pc.refreshedAtHead.slice(0, 9)} - a narrowed run overwrote the pass's total instead of accumulating it`,
					);
				}
			}
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
