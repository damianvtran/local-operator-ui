#!/usr/bin/env node
/**
 * Complete an evidence fold: resolve `docs/evidence/manifest.json` across a
 * merge, re-derive the fields that describe the merged tree, and stage the
 * result - so a fold is ONE commit that carries correct values.
 *
 * WHY THIS EXISTS. `docs/evidence/manifest.json` pins `srcTree`/`scriptsTree` to
 * `git rev-parse HEAD:src`/`HEAD:scripts` plus the counts derived from them, so
 * ANY commit anywhere that moves `src/` or `scripts/` invalidates the stamp for
 * every open branch. The old flow therefore cost two commits per fold (a
 * `chore(merge)` that took main's manifest whole, then a `docs(evidence)`
 * re-lay/re-derive) and the re-lay was a per-FIELD exercise done by hand, in a
 * file of ~500 keys, at the one moment nobody has time to read the rule - and
 * the rule itself has been broken at least three times in review (fold 10 and
 * fold 11 shipped stamps that named a neighbour's trees; the twelfth fold
 * dropped seven of a branch's own top-level records). This script is that
 * hand exercise, written down once and run.
 *
 * WHAT IT IS NOT. It does not weaken a guard. The stamps stay stored in the
 * manifest and are still compared against `HEAD` exactly as before
 * (`check-evidence.mjs` `stampFailures`, bound to the shipped file by
 * `scripts/evidence-manifest.test.mjs` inside `pnpm test:desktop`); the tool
 * WRITES what the guard demands and then RUNS the real guards over the result
 * before it stages anything, so a fold that cannot be resolved correctly fails
 * here rather than shipping a stale stamp. The alternative - stop storing the
 * stamps and derive them at read time - was rejected because it makes the check
 * vacuous: a stamp derived from the tree under review can never disagree with
 * it, and it could no longer catch the fold-10/11 class (values that look right
 * and describe another tree). The stored-versus-HEAD comparison IS the guarantee.
 *
 * THE FIVE GROUPS, implemented below as `mergeValue` and numbered as the two
 * other homes number them (the "A FOLD'S RESOLVER READS THIS BLOCK" comment in
 * `scripts/capture-evidence.mjs` and `citationConvention` in the manifest):
 *
 *   1. Pass-describing fields are THIS BRANCH's when both sides moved them:
 *      `head`, `headNote`, and `partialCapture`'s `refreshedAt`,
 *      `refreshedAtHead`, `refreshedFromHead`, `addedAt`, `addedAtHead`,
 *      `addedFrames`, `note`, `passScopeNote`, every per-pass `*Note`, and
 *      every other branch-authored top-level record. Main's values name main's
 *      pass, and taking them sends a verifier to a tree that does not carry this
 *      branch's frames. Implemented as the DEFAULT for a conflicted leaf or
 *      record, which is what almost every key in this file is.
 *   2. Listings are the UNION: `supplementary`'s ENTRIES (by `path`),
 *      `refreshedStories`, `refreshedThemes`, `addedSurfaces`. The merged tree
 *      carries both sides' work, so either side's list alone would claim a pass
 *      that did not run in it.
 *   3. Inside a `supplementary` entry both sides have, the AUTHORED keys come
 *      from ours and the listing-ish sub-arrays are unioned - an entry is a
 *      record this branch wrote, not a listing.
 *   4. Derived fields are RE-DERIVED from the merged tree and taken from neither
 *      side: `srcTree`, `scriptsTree`, `frames`, `surfaces`, `themes`,
 *      `partialCapture.refreshedFrames` and the LEADING paragraph of every
 *      `countsMean` cell.
 *   5. No key main has that this branch deleted is carried back, under any name
 *      (main's manifest still carries `refreshedAtHeadNote`, a spelling this
 *      lineage retired) - while every key THIS branch carries survives, which is
 *      the clause `BRANCH_RECORDS` in `scripts/evidence-manifest.test.mjs` now
 *      fails on. Implemented in `mergedKeys`.
 *
 * THE WRITE-TREE TECHNIQUE, AND WHY MID-MERGE `HEAD:` IS THE TRAP. `srcTree` and
 * `scriptsTree` must name the MERGED tree - the tree of the commit the manifest
 * will ride in - and mid-merge `git rev-parse HEAD:src` answers about the
 * PRE-merge head: real trees, so nothing looks wrong in the diff, just not this
 * one's. Fold 11 shipped exactly that. So while a merge is in progress the tree
 * is resolved from the INDEX instead: `git write-tree` hashes the staged tree
 * the merge commit is about to get, and `git rev-parse <that>:src` names it. The
 * manifest lives outside `src/` and `scripts/`, so staging it does not move
 * either hash, which is what makes "write the values, stage, commit" correct
 * without an amend. When the merge has already committed (the driver path
 * below), the technique is simply `HEAD`.
 *
 * THE DRIVER. `.gitattributes` marks this file `merge=evidence-fold`, and
 * `--install` points `merge.evidence-fold.driver` at `--driver %O %A %B` in the
 * clone's own config. Git then hands the three sides straight from its object
 * store and this script writes the merged file, so `git merge origin/main` does
 * not stop on a manifest conflict at all. The driver deliberately does NOT
 * re-derive group 4: at that moment the merge commit does not exist, and deriving
 * "the merged tree" from a working tree that is still being written is the
 * fold-10/11 defect with extra steps. It carries ours' stamp values and says so
 * on stderr; the merge commit's own re-derivation is the next step
 * (`pnpm evidence:fold`, state 2), which re-derives against the commit that now
 * exists and amends it - the amendment moves `docs/` only, so the value stays
 * true. Without the driver installed, `git merge` leaves the usual conflict and
 * the SAME command resolves it, because every side is read from the OBJECT
 * STORE rather than from the conflicted working file.
 *
 * WHEN IT REFUSES. (a) A side that is not JSON - the sides are read with `git
 * show`, so a file that does not parse is a state this script cannot reason
 * about, and guessing would be worse than the conflict git already showed.
 * (b) Other unmerged paths still in the index: the manifest is resolved and
 * staged, and the tool says which paths remain rather than deriving counts from
 * a half-merged tree. (c) A result that fails its own guards - it is not
 * written, and the guard's own text is printed.
 *
 * WHY THE DRIVER PATH MUST STAY IMPORT-LIGHT. `--driver` runs inside `git merge`,
 * potentially in a worktree with no `node_modules`; `check-evidence.mjs` imports
 * `sharp` at module scope for the frame walk. So the derived fields are reached
 * through a DYNAMIC import, taken only on the path that re-derives.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";

/*
 * The tree whose manifest this run resolves.
 *
 * Answered by GIT, from the directory the run happens in, rather than taken
 * from this file's own location - and the difference is not cosmetic. git
 * invokes a merge driver from the work tree it is merging, so a driver that
 * assumed "the repo this script lives in" would resolve the manifest of
 * whichever checkout the script was shipped in rather than the one being
 * folded; and a `pnpm evidence:fold` run from a subdirectory would look for
 * `docs/evidence/manifest.json` under that subdirectory. `--show-toplevel`
 * answers both, and the script's own parent directory is the fallback for a
 * directory git does not know (a vendored copy, a `--ignore-scripts` install).
 */
const ROOT = (() => {
	const here = join(dirname(fileURLToPath(import.meta.url)), "..");
	try {
		const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd: process.cwd(),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return top || here;
	} catch {
		return here;
	}
})();

/** The one tracked file this script resolves, repo-relative and in git's spelling. */
export const MANIFEST_PATH = "docs/evidence/manifest.json";

const EVIDENCE = join(ROOT, "docs", "evidence");

/** The driver's config key, and the command git should run for it. */
const DRIVER_KEY = "merge.evidence-fold.driver";
const DRIVER_COMMAND = "node scripts/evidence-fold.mjs --driver %O %A %B";

/** A ref path, `git show <rev>:<path>`, spelled once. */
const manifestAt = (rev) => `${rev}:${MANIFEST_PATH}`;

/*
 * Every git read is one `execFileSync`, returning trimmed stdout or null.
 *
 * The ceiling is not decoration: `git ls-tree -r` over this tree crossed Node's
 * 1 MiB `spawnSync` default at 14,162 frames (measured 2026-09-30, review round
 * 1 R-2 in `check-evidence.mjs`), and a read that throws is caught here and
 * reported as "cannot answer" - which for a DERIVATION is the one failure mode
 * that would silently produce a wrong stamp. So the buffer is generous and any
 * `null` from a read the derivation depends on is a refusal, not a default.
 */
const git = (args, cwd = ROOT) => {
	try {
		return execFileSync("git", args, {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
			maxBuffer: 128 * 1024 * 1024,
		}).trim();
	} catch {
		return null;
	}
};

const gitStatus = (args, cwd = ROOT) => {
	try {
		execFileSync("git", args, {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
		});
		return true;
	} catch {
		return false;
	}
};

/* ------------------------------------------------------------------ *
 * The resolution policy
 * ------------------------------------------------------------------ */

const isObject = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Structural equality, key order ignored - a merge must not be order-sensitive. */
export const deepEqual = (a, b) => {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
			return false;
		return a.every((item, index) => deepEqual(item, b[index]));
	}
	if (isObject(a) || isObject(b)) {
		if (!isObject(a) || !isObject(b)) return false;
		const keys = Object.keys(a);
		if (keys.length !== Object.keys(b).length) return false;
		return keys.every((key) => deepEqual(a[key], b[key]));
	}
	return false;
};

/*
 * Group (2): the keys whose value is a LISTING of what a side touched, unioned
 * rather than chosen. Named rather than inferred from the value being an array,
 * because an array that is not one of these is a record's own field (`declaredSet`
 * inside a capture record, `conflicted` inside a fold record) and unioning two
 * different records' fields is how a resolver invents a claim neither side made.
 */
const LISTING_KEYS = new Set([
	"supplementary",
	"refreshedStories",
	"refreshedThemes",
	"addedSurfaces",
]);

/*
 * Group (1), as the concrete names the two other homes spell out. Everything
 * else that is not a listing and not derived resolves to OUR side by default,
 * which is that group's rule stated once instead of as a list of ~120 `*Note`
 * keys that would go stale the first time a pass writes a new record.
 */
const PASS_KEYS = new Set([
	"head",
	"headNote",
	"refreshedAt",
	"refreshedAtHead",
	"refreshedFromHead",
	"addedAt",
	"addedAtHead",
	"addedFrames",
	"note",
	"passScopeNote",
]);

/** Group (4): re-derived from the merged tree, never carried from a side. */
const DERIVED_TOP = new Set([
	"srcTree",
	"scriptsTree",
	"frames",
	"surfaces",
	"themes",
]);

/*
 * The only containers a resolver descends into when both sides changed them.
 *
 * `partialCapture` has to be per-FIELD - it holds group 1's pass fields, group
 * 2's listings and group 4's `refreshedFrames` all at once, which is why the
 * manifest's own rule says "per FIELD and not per entry". Everything else in
 * this file is a record a pass wrote, and a record that both sides rewrote is
 * this branch's: descending into `preRebaseRecord` or a rename's note would
 * union two histories into one that never happened.
 */
const CONTAINERS = new Set(["partialCapture"]);

/**
 * The key set of the merged file (group 5, and its converse).
 *
 * Every key THIS branch carries survives - a resolver that starts from main's
 * schema drops the branch's own records without a word, which is what the
 * twelfth fold did to seven of them. A key main has that this branch does not
 * have at BASE is a record main wrote and this branch never saw, so it rides; a
 * key main still carries that this branch DELETED (present at base, absent from
 * ours) is a spelling this lineage retired and must not come back - main's
 * `refreshedAtHeadNote` is the named example.
 */
export const mergedKeys = (base, ours, theirs) => {
	const keys = Object.keys(ours);
	for (const key of Object.keys(theirs)) {
		if (key in ours) continue;
		if (key in base) continue; // this branch deleted it - group (5)
		keys.push(key);
	}
	return keys;
};

/** Union of two listings, ours first, by structural identity. */
const unionList = (ours = [], theirs = []) => {
	const out = [...ours];
	for (const item of theirs)
		if (!out.some((seen) => deepEqual(seen, item))) out.push(item);
	return out;
};

/**
 * `supplementary` unioned by entry IDENTITY, which is its `path`.
 *
 * By path and not structurally, because the entries on the two sides are
 * records taken at different heads: a structural union would keep both copies
 * of one set and the gate would then count its frames twice.
 */
const unionSets = (ours = [], theirs = []) => {
	const out = [...ours];
	for (const entry of theirs)
		if (!out.some((seen) => seen?.path === entry?.path)) out.push(entry);
	return out;
};

/**
 * One value across the three sides.
 *
 * The identity short-circuits are the ordinary 3-way rule and they are what
 * keeps this from being a policy free-for-all: a side that did not move its
 * value has nothing to say, and the side that moved wins. Everything below them
 * is a genuine both-changed case, where the groups decide.
 */
export const mergeValue = (key, base, ours, theirs, derived) => {
	/*
	 * Group (4) is asked FIRST and not after the identity short-circuits below,
	 * because a re-derivation must fire even when the two sides AGREE: a fold
	 * that only moved `main`'s tree leaves both copies at base's stale stamp,
	 * and `deepEqual(ours, theirs)` would then hand the stale value through as a
	 * unanimous answer. The driver passes no `derived` at all (the merged tree
	 * does not exist mid-merge) and falls through to the three-way rule.
	 */
	if (derived) {
		if (key === "refreshedFrames" && derived.refreshedFrames !== undefined)
			return derived.refreshedFrames;
		if (DERIVED_TOP.has(key) && derived[key] !== undefined) return derived[key];
	}
	/*
	 * Group (2) is asked here too, and for a reason the history validation
	 * found: the rule is a UNION of what both sides touched, not a three-way
	 * choice, so it must NOT sit behind `deepEqual(base, ours)`. A branch whose
	 * own manifest did not move has `ours === base` for the whole file, the
	 * short-circuit hands back MAIN's listing, and the sets this branch
	 * declared disappear from the merged tree - which is not a cosmetic loss:
	 * `frames` counts what is outside the declared sets, so the count then
	 * disagrees with the file that carries the sets (measured on the fold onto
	 * `490c2079fb`: 153 declared sets in the branch's copy, main's list alone
	 * left 23 of its frames "outside every set").
	 */
	if (key === "supplementary") {
		if (ours === undefined) return theirs;
		if (theirs === undefined) return ours;
		return Array.isArray(ours) && Array.isArray(theirs)
			? unionSets(ours, theirs)
			: ours;
	}
	if (LISTING_KEYS.has(key)) {
		if (ours === undefined) return theirs;
		if (theirs === undefined) return ours;
		return Array.isArray(ours) && Array.isArray(theirs)
			? unionList(ours, theirs)
			: ours;
	}
	if (theirs === undefined) return ours;
	if (ours === undefined) return theirs;
	if (deepEqual(ours, theirs)) return ours;
	if (deepEqual(base, ours)) return theirs;
	if (deepEqual(base, theirs)) return ours;

	// Both sides moved this key.
	if (CONTAINERS.has(key))
		return mergeObject(base ?? {}, ours, theirs, derived, key);
	return ours;
};

/**
 * An object merged key by key, with the CONTAINER's own key set rules.
 *
 * Above `partialCapture` the key set is `mergedKeys` (group 5). Inside an entry
 * of a supplementary set it is group 3's: the entry's authored keys come from
 * ours, and its own sub-arrays union.
 */
const mergeObject = (base, ours, theirs, derived, container) => {
	const out = {};
	for (const key of mergedKeys(base, ours, theirs)) {
		const value = mergeValue(
			key,
			base?.[key],
			ours?.[key],
			theirs?.[key],
			derived,
		);
		if (value !== undefined) out[key] = value;
	}
	if (container === "partialCapture" && derived?.refreshedFrames !== undefined)
		out.refreshedFrames = derived.refreshedFrames;
	return out;
};

/** A `supplementary` entry present on both sides: group (3). */
const mergeEntry = (base, ours, theirs) => {
	const out = {};
	for (const key of mergedKeys(base ?? {}, ours, theirs)) {
		const value = mergeValue(
			key,
			base?.[key],
			ours?.[key],
			theirs?.[key],
			null,
		);
		if (value !== undefined) out[key] = value;
	}
	return out;
};

/**
 * `countsMean`, whose HISTORY paragraphs are this branch's and whose LEADING
 * paragraph is derived (group 4).
 *
 * The leading paragraph is what `countsMeanFailures` reads, and it is rewritten
 * only when it does not already carry this tree's numbers - so a second run in
 * the same fold is a no-op rather than a second copy of the same sentence, and
 * the paragraphs below it (each of which says in its own words that it describes
 * an older tree) are kept. That is the same "lead the field with" repair the
 * guard's own failure message instructs, applied mechanically.
 */
export const resolveCountsMean = (base, ours, theirs, derived) => {
	if (!isObject(ours)) return ours;
	const out = {};
	for (const field of Object.keys(ours)) {
		const b = base?.[field];
		const o = ours[field];
		const t = theirs?.[field];
		const text =
			deepEqual(b, o) && typeof t === "string"
				? t
				: typeof o === "string"
					? o
					: t;
		const lead = derived?.countsMean?.[field];
		out[field] =
			typeof text === "string" && typeof lead === "string"
				? leadParagraph(text, lead)
				: text;
	}
	return out;
};

/** `text` led by `lead`, unless it already leads with it. */
/**
 * Whether a paragraph already carries the readings the new lead would state.
 *
 * The `countsMean` guard compares NUMBERS, not sentences - it parses the four
 * readings out of the leading paragraph and against the walk - so a lead that
 * is re-generated on every run would prepend a fresh sentence each time a fold
 * moved only a tree hash, claiming a re-derivation that changed no count. The
 * comparison is therefore on the readings alone: whitespace, wording and the
 * fold's own label are free to differ, the digits are not.
 */
const statesSameReadings = (current, lead) => {
	/*
	 * Backticked tokens go first: the lead's label is a commit SHA, so a raw
	 * digit scrape reads `054ea59fe5` and `213375c6af` as four different
	 * readings and declares every lead stale - it did exactly that on the
	 * first real run. A reading is a bare number in the sentence; a number
	 * inside backticks is a name, a path or a spelling.
	 */
	const readings = (value) =>
		(
			String(value ?? "")
				.replace(/`[^`]*`/g, " ")
				/* `\d[\d,]*` and not `[\d,]+`: a bare comma is a separator, not one of
				 * the readings, and matching it makes two sentences that state the same
				 * numbers differ by their punctuation. */
				.match(/\d[\d,]*/g) ?? []
		).join(" ");
	return readings(current) === readings(lead);
};

export const leadParagraph = (text, lead) => {
	const source = String(text ?? "");
	const trimmed = source.trim();
	const current = trimmed.split(/\n\s*\n/)[0];
	// Return the ORIGINAL string, not the trimmed one: a lead whose readings
	// already match is not an edit, and a rewrite that only normalises
	// whitespace would re-write a 10 kB file's cell on every run.
	if (current === lead || statesSameReadings(current, lead)) return source;
	return trimmed.length === 0 ? lead : `${lead}\n\n${trimmed}`;
};

/**
 * The whole file, from the three sides git already holds.
 *
 * `derived` is optional and its absence is a DISCLOSED state rather than a
 * silent one: the merge driver cannot know the merged tree (its commit does not
 * exist yet), so it leaves group 4 on our side and says so. Every other caller
 * passes it.
 */
export const resolveManifest = ({ base, ours, theirs, derived = null }) => {
	if (!isObject(ours) || !isObject(theirs))
		throw new Error("both sides of the manifest must be JSON objects");
	const out = {};
	for (const key of mergedKeys(base ?? {}, ours, theirs)) {
		if (key === "countsMean") {
			out[key] = resolveCountsMean(
				base?.countsMean,
				ours.countsMean,
				theirs.countsMean,
				derived,
			);
			continue;
		}
		const value = mergeValue(
			key,
			base?.[key],
			ours[key],
			theirs?.[key],
			derived,
		);
		if (value !== undefined) out[key] = value;
	}
	// `supplementary` entries both sides carry: group 3 inside them.
	if (Array.isArray(out.supplementary)) {
		const baseSets = new Map(
			(base?.supplementary ?? []).map((set) => [set?.path, set]),
		);
		const ourSets = new Map(
			(ours.supplementary ?? []).map((s) => [s?.path, s]),
		);
		const theirSets = new Map(
			(theirs.supplementary ?? []).map((set) => [set?.path, set]),
		);
		out.supplementary = out.supplementary.map((set) => {
			const o = ourSets.get(set?.path);
			const t = theirSets.get(set?.path);
			if (!o || !t) return set;
			return mergeEntry(baseSets.get(set?.path), o, t);
		});
	}
	return out;
};

/* ------------------------------------------------------------------ *
 * Re-derivation (group 4)
 * ------------------------------------------------------------------ */

/**
 * The group-4 values for the tree `target` names, read from git and from the
 * frame walk.
 *
 * `target` is a commit-ish or a tree-ish: `HEAD` after the merge has committed,
 * or the index's own tree (`git write-tree`) while it has not. `root` is
 * injectable so this can be exercised against a tree other than the live one.
 */
export const deriveFields = async ({
	root = ROOT,
	git: read = git,
	target,
	baseLabel,
	manifest,
}) => {
	const {
		claimedStory,
		declaredStoryRows,
		declaredThemeNames,
		frames: frameFiles,
	} = await import("./check-evidence.mjs");

	const evidenceDir = join(root, "docs", "evidence");
	const srcTree = read(["rev-parse", `${target}:src`]);
	const scriptsTree = read(["rev-parse", `${target}:scripts`]);
	const capture = read(["show", `${target}:scripts/capture-evidence.mjs`]);
	if (srcTree === null || scriptsTree === null || capture === null)
		throw new Error(
			`git could not read ${target}'s trees or capture-evidence.mjs, so the derived fields cannot be re-derived - refusing rather than writing a stamp from a partial read`,
		);

	const sets = (manifest.supplementary ?? []).filter(
		(set) => typeof set.path === "string" && set.path.length > 0,
	);
	const declaredDirs = sets.map((set) => join(evidenceDir, set.path));
	const onDisk = frameFiles(evidenceDir);
	const outside = onDisk.filter(
		(file) => !declaredDirs.some((dir) => file.startsWith(`${dir}/`)),
	);
	const stories = declaredStoryRows(capture);
	const themes = declaredThemeNames(capture);

	/*
	 * `refreshedFrames`, re-derived rather than carried: the frames standing in
	 * the directories `refreshedStories` names, at the tree under construction.
	 * The directory test is the guard's own `claimedStory`, shared rather than
	 * restated, so a story captured in a second state (a `dir` override, a
	 * width-suffixed directory) counts here exactly as it is checked there.
	 */
	const refreshedStories = manifest.partialCapture?.refreshedStories ?? [];
	const refreshedFrames = onDisk.filter((file) => {
		const segments = relative(evidenceDir, file).split("/");
		if (segments.length < 3) return false;
		const surface = segments[0];
		const leaf = segments[1].replace(/@\d+$/, "");
		return refreshedStories.some((entry) => claimedStory(entry, surface, leaf));
	}).length;

	return {
		srcTree,
		scriptsTree,
		frames: outside.length,
		surfaces: stories,
		themes,
		refreshedFrames,
		countsMean: {
			frames: `RE-DERIVED FOR THIS FOLD (this branch folded onto \`origin/main\` = \`${baseLabel}\`): ${outside.length} committed WebP files outside the ${sets.length} declared supplementary sets below, of ${onDisk.length} on disk (${onDisk.length - outside.length} of them inside the sets). Nothing in this fold touches a surface these stories render, so nothing was re-shot.`,
			surfaces: `RE-DERIVED FOR THIS FOLD: ${stories} rows in \`HEAD:scripts/capture-evidence.mjs\`'s STORIES literal, counted the way \`check-evidence.mjs\` counts them (\`^\t\[\` rows inside the block, parsed from the tree rather than taken from the writer).`,
			themes: `RE-DERIVED FOR THIS FOLD: ${themes} theme names in the \`THEMES\` literal, counted the same way.`,
		},
	};
};

/* ------------------------------------------------------------------ *
 * The guards, over the result rather than over a hope
 * ------------------------------------------------------------------ */

/**
 * The real guards, asked about the manifest this run is about to stage.
 *
 * The tree reads are pointed at `target` (the merged tree) rather than at
 * `HEAD`, because mid-merge `HEAD` is the PRE-merge head and the stamps are
 * SUPPOSED to describe the merged tree - asking the guard about the old head
 * would fail every fold. The citation half is asked of the real `HEAD`, since
 * "is this sha reachable" is a question about the repository, not about a tree.
 *
 * The frame and prose walks are pointed at `root`, so this can be run against a
 * tree other than the live one (`--root`, used by the validation rig). A
 * non-empty list is a refusal: nothing is written.
 */
export const runGuards = async ({ manifest, target, root = ROOT }) => {
	const { countsMeanFailures, partialCaptureFailures, stampFailures } =
		await import("./check-evidence.mjs");
	const at = (args) =>
		git(
			args.map((argument) =>
				argument === "HEAD"
					? target
					: argument.startsWith("HEAD:")
						? `${target}${argument.slice(4)}`
						: argument,
			),
		);
	return [
		...stampFailures(manifest, at, join(root, "docs", "evidence")),
		...countsMeanFailures(manifest, at, join(root, "docs", "evidence")),
		...partialCaptureFailures(manifest, at),
	];
};

/* ------------------------------------------------------------------ *
 * Reading and writing the file
 * ------------------------------------------------------------------ */

const readJson = (text, label) => {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`${label} is not JSON (${error.message})`);
	}
};

/** The manifest as written: two spaces, matching the capturer and every sibling writer. */
const serialize = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

const sideJson = (rev, label) => {
	const text = git(["show", manifestAt(rev)]);
	if (text === null)
		throw new Error(`${label} (${rev}) has no ${MANIFEST_PATH}`);
	return readJson(text, `${label} (${rev})`);
};

/** `docs/evidence/manifest.json` staged in the index, so the merge completes with it. */
const stageManifest = () => {
	gitStatus(["add", "--", MANIFEST_PATH]);
};

/**
 * The paths git has left unmerged, from BOTH places it answers.
 *
 * `ls-files -u --name-only` is the direct question and it is not always
 * answered: on git 2.5x it prints nothing at all in a conflicted merge, which
 * is measured here - the tool then believed every side was in and asked
 * `write-tree` for a merged tree that could not exist yet, and the author got
 * "git could not hash the index" instead of the name of the file to fix. The
 * working-tree diff's `U` filter answers the same question from the other side
 * and is the one the refusal path is tested against, so both are asked and the
 * union is reported.
 */
const unmergedPaths = () => {
	const paths = [
		...(git(["diff", "--name-only", "--diff-filter=U"]) ?? "").split("\n"),
		...(git(["ls-files", "-u", "--name-only"]) ?? "").split("\n"),
	];
	return [...new Set(paths.filter(Boolean))];
};

const stagedPaths = () =>
	(git(["diff", "--cached", "--name-only", "HEAD"]) ?? "")
		.split("\n")
		.filter(Boolean);

const isMergeCommit = (rev) => {
	const parents = (git(["rev-list", "--parents", "-n", "1", rev]) ?? "").split(
		" ",
	);
	return parents.length > 2;
};

/* ------------------------------------------------------------------ *
 * The states
 * ------------------------------------------------------------------ */

/**
 * State 1: a merge is in progress. Every side is read from the OBJECT STORE.
 *
 * That is the point of this state rather than a convenience: the working file
 * carries conflict markers, so reading it would mean parsing git's own markers
 * back out, and the three sides are already committed objects.
 */
const completeMerge = async ({ dryRun }) => {
	const theirs = git(["rev-parse", "MERGE_HEAD"]);
	const base = git(["merge-base", "HEAD", "MERGE_HEAD"]);
	if (!theirs || !base)
		throw new Error(
			"a merge is in progress but git cannot name MERGE_HEAD or the merge base",
		);
	const ours = sideJson("HEAD", "this branch");
	const theirSide = sideJson("MERGE_HEAD", "the incoming side");

	const baseSide = sideJson(base, "the merge base");
	let resolved = resolveManifest({ base: baseSide, ours, theirs: theirSide });
	const label = theirs.slice(0, 10);
	/*
	 * The manifest ITSELF is filtered out: it is the one conflict this tool
	 * exists to resolve, so leaving it in the list would have every fold report
	 * that the file it just resolved is still unmerged.
	 */
	const remaining = unmergedPaths().filter((path) => path !== MANIFEST_PATH);
	/*
	 * What the file said when this run started, before anything here writes it.
	 * It is the only honest no-op signal available: the resolution below is
	 * built from GIT OBJECTS and the merged tree, so by the time it exists the
	 * working file has already been rewritten with the group-1/2/3/5 half (the
	 * index has to be conflict-free before `write-tree` can name a merged
	 * tree). Comparing against the ENTRY text is what makes a second run report
	 * itself as a no-op instead of as an edit that rewrote identical bytes.
	 */
	const entryContent = readFileSync(join(ROOT, MANIFEST_PATH), "utf8");
	if (dryRun) {
		/*
		 * `write-tree` needs a conflict-free index, so a dry run mid-conflict
		 * reports the resolution without the derived fields and says which of
		 * the two it is - the alternative is reporting a value it cannot know.
		 */
		const tree = remaining.length === 0 ? git(["write-tree"]) : null;
		let derived = null;
		if (tree !== null) {
			derived = await deriveFields({
				target: tree,
				baseLabel: label,
				manifest: resolved,
			});
			resolved = resolveManifest({
				base: baseSide,
				ours,
				theirs: theirSide,
				derived,
			});
		}
		reportDiff(ours, resolved, {
			baseLabel: label,
			derived: derived !== null,
			note:
				remaining.length === 0
					? "dry run: nothing written, nothing staged"
					: `dry run: ${remaining.length} path(s) are still unmerged, so group 4 is NOT re-derived yet; nothing written, nothing staged`,
		});
		return 0;
	}
	/*
	 * STAGE THE RESOLUTION FIRST, THEN ASK AGAIN. `write-tree` cannot hash an
	 * index that still carries an unmerged entry, so the file has to be written
	 * and staged before the merged tree can be named at all - and the list is
	 * re-read after the staging, because staging this file is what removes IT.
	 */
	writeFileSync(join(ROOT, MANIFEST_PATH), serialize(resolved));
	stageManifest();
	const stillUnmerged = unmergedPaths();
	if (stillUnmerged.length > 0) {
		console.log(
			`evidence-fold: resolved ${MANIFEST_PATH} against MERGE_HEAD ${label} and staged it.`,
		);
		console.log(
			`evidence-fold: ${stillUnmerged.length} path(s) are still unmerged (${stillUnmerged
				.slice(0, 8)
				.join(
					", ",
				)}${stillUnmerged.length > 8 ? ", ..." : ""}) - resolve them, then re-run \`pnpm evidence:fold\` to re-derive the stamps over the merged tree.`,
		);
		return 1;
	}

	/*
	 * Every side is in. The stamps come from the INDEX, which is about to become
	 * the merge commit: `HEAD:src` here is the pre-merge head and would be the
	 * fold-11 defect.
	 */
	const tree = git(["write-tree"]);
	if (tree === null)
		throw new Error(
			"git could not hash the index (write-tree), so the merged tree cannot be named",
		);
	const derived = await deriveFields({
		target: tree,
		baseLabel: label,
		manifest: resolved,
	});
	resolved = resolveManifest({
		base: baseSide,
		ours,
		theirs: theirSide,
		derived,
	});
	const failures = await runGuards({ manifest: resolved, target: tree });
	if (failures.length > 0) {
		console.error(
			`evidence-fold: the resolved manifest fails its own guards, so it was NOT written:\n  - ${failures.join("\n  - ")}`,
		);
		return 1;
	}
	/*
	 * A second run in the same merge is the normal case, not an error: the first
	 * run staged the resolution, the author then resolved a conflict elsewhere
	 * and ran the tool again to re-derive. Re-writing the same bytes and
	 * re-staging them would be a no-op that reports itself as an edit, so the
	 * file already carrying this resolution is reported as such.
	 */
	const text = serialize(resolved);
	/*
	 * WRITTEN UNCONDITIONALLY, even when it is the text the file already held:
	 * the group-1/2/3/5 resolution above was written over it (that staging is
	 * what let `write-tree` answer), so skipping this write would leave the file
	 * holding the half-resolved copy. `alreadyResolved` decides only what the
	 * run REPORTS.
	 */
	const alreadyResolved = entryContent === text;
	writeFileSync(join(ROOT, MANIFEST_PATH), text);
	stageManifest();
	reportDiff(ours, resolved, {
		baseLabel: label,
		derived: true,
		note: alreadyResolved
			? "this resolution was already in the file; nothing was written or staged"
			: undefined,
	});
	const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "this branch";
	console.log(
		`evidence-fold: the merge is resolved${alreadyResolved ? "" : " and staged"}. Complete it with:\n  git commit --no-edit\n  (or \`git commit -m "chore(merge): fold origin/main (${label}) into ${branch})"\`)`,
	);
	return 0;
};

/**
 * State 2: the merge has committed (`HEAD` is a merge) and its manifest stamps
 * no longer describe `HEAD`'s trees.
 *
 * This is the driver's aftermath, and it is also the plain "I folded with a
 * driver and forgot the rest" case. The amend is sanctioned and narrow: it fires
 * only when the tip is a merge commit and the ONLY staged change is this file,
 * because then the amendment moves `docs/` alone and both tree stamps stay true
 * of the commit it produces. Anything else - a second staged path, a tip that is
 * not a merge - gets the values written and a `git commit` command instead.
 */
const restampAtHead = async ({ dryRun, amend }) => {
	const ours = sideJson("HEAD", "HEAD");
	const derived = await deriveFields({
		target: "HEAD",
		baseLabel: mergeBaseLabel(),
		manifest: ours,
	});
	const resolved = resolveManifest({
		base: ours,
		ours,
		theirs: ours,
		derived,
	});
	if (deepEqual(ours, resolved)) {
		console.log(
			"evidence-fold: the manifest already describes this tree - nothing to do.",
		);
		return 0;
	}
	const failures = await runGuards({ manifest: resolved, target: "HEAD" });
	if (failures.length > 0) {
		console.error(
			`evidence-fold: the re-derived manifest fails its own guards, so it was NOT written:\n  - ${failures.join("\n  - ")}`,
		);
		return 1;
	}
	if (dryRun) {
		reportDiff(ours, resolved, {
			baseLabel: mergeBaseLabel(),
			note: "dry run: nothing written, nothing staged",
		});
		return 0;
	}
	writeFileSync(join(ROOT, MANIFEST_PATH), serialize(resolved));
	stageManifest();
	reportDiff(ours, resolved, { baseLabel: mergeBaseLabel(), derived: true });

	if (!amend || !isMergeCommit("HEAD")) {
		console.log(
			`evidence-fold: write a re-stamp commit carrying the values:\n  git commit -m "docs(evidence): re-derive the stamp pair over the folded tree"`,
		);
		return 0;
	}
	const staged = stagedPaths();
	if (!(staged.length === 1 && staged[0] === MANIFEST_PATH)) {
		console.log(
			`evidence-fold: ${staged.length} staged path(s) (${staged.join(", ")}), so the tip is NOT amended. Commit them yourself, keeping this file's values with the tree they name.`,
		);
		return 0;
	}
	if (!gitStatus(["commit", "--amend", "--no-edit"])) {
		throw new Error(
			"the amend failed, so the merge commit still carries the carried-over stamps; re-run this script and commit the result",
		);
	}
	console.log(
		"evidence-fold: amended the merge commit at this tip with the re-derived stamps. The amendment moved docs/ only, so the values still describe the tree they name.",
	);
	return 0;
};

/** The main commit a merge folded in, for the prose's `origin/main` label. */
const mergeBaseLabel = () => {
	const line = git(["rev-list", "--parents", "-n", "1", "HEAD"]);
	if (line === null) return "unknown";
	const parents = line.split(" ").slice(1);
	return (parents[1] ?? parents[0] ?? "unknown").slice(0, 10);
};

const reportDiff = (before, after, { baseLabel, derived, note }) => {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	const changed = [...keys].filter(
		(key) => !deepEqual(before[key], after[key]),
	);
	console.log(
		`evidence-fold: folded onto \`origin/main\` = \`${baseLabel}\`${derived ? ", group 4 re-derived from the merged tree" : ""}.`,
	);
	console.log(
		changed.length === 0
			? "evidence-fold: no field changed."
			: `evidence-fold: ${changed.length} field(s) differ from this branch's copy: ${changed.slice(0, 24).join(", ")}${changed.length > 24 ? ", ..." : ""}`,
	);
	if (note) console.log(`evidence-fold: ${note}`);
};

/* ------------------------------------------------------------------ *
 * The merge driver
 * ------------------------------------------------------------------ */

/**
 * `--driver %O %A %B`: resolve the three sides and write the result to `%A`.
 *
 * Import-light on purpose (no `sharp`, no `check-evidence`) - this runs inside
 * `git merge`, in worktrees that may carry no `node_modules` at all. It carries
 * ours' group-4 values and says so, because the merged tree does not exist yet;
 * a mismatched stamp is then caught by `pnpm test:desktop` or repaired by one
 * `pnpm evidence:fold` after the merge commits.
 */
const driver = ([basePath, oursPath, theirsPath]) => {
	const readSide = (path, label) => {
		if (!existsSync(path)) throw new Error(`${label} (${path}) does not exist`);
		const text = readFileSync(path, "utf8").trim();
		if (text.length === 0) return {};
		return readJson(text, label);
	};
	const base = readSide(basePath, "the merge base");
	const ours = readSide(oursPath, "this branch's copy");
	const theirs = readSide(theirsPath, "the incoming copy");
	const resolved = resolveManifest({ base, ours, theirs });
	writeFileSync(oursPath, serialize(resolved));
	console.error(
		"evidence-fold: resolved docs/evidence/manifest.json mechanically (groups 1, 2, 3, 5). The stamps still name the PRE-merge tree on purpose - run `pnpm evidence:fold` after the merge commits to re-derive them against the commit this fold produces.",
	);
	return 0;
};

/* ------------------------------------------------------------------ *
 * Install / check
 * ------------------------------------------------------------------ */

const USAGE = [
	"usage: node scripts/evidence-fold.mjs [--dry-run] [--no-amend]",
	"       node scripts/evidence-fold.mjs --install | --check",
	"       node scripts/evidence-fold.mjs --driver <base> <ours> <theirs>",
	"",
	"  (no flags)   complete a fold: resolve docs/evidence/manifest.json against",
	"               the merge in progress, re-derive the fields that describe the",
	"               merged tree, run the guards over the result and stage it.",
	"  --dry-run    report the fields that would change; write and stage nothing.",
	"  --no-amend   write and stage the re-derived values, but never amend the",
	"               merge tip - print the commit command instead.",
	"  --install    point this clone's merge.evidence-fold.driver at this script,",
	"               so `git merge` does not stop on a manifest conflict.",
	"  --tolerate-failure",
	"               print a loud warning instead of failing when --install cannot",
	"               wire the driver. This is how `prepare` invokes it: an install",
	"               must never be broken by a helper, and `--check` is the",
	"               spelling that DOES fail.",
	"  --check      read-only: report whether that driver is installed, and exit",
	"               non-zero with what to run when it is not.",
	"  --driver     the merge driver git invokes; not for use by hand.",
	"",
	"After a fold the file is staged and the stamps describe the MERGED tree; the",
	"next step this script prints is the single commit that carries them.",
].join("\n");

/**
 * `--install`/`--check`, wrapped so the `prepare` path cannot be broken by it.
 *
 * The split mirrors `hooks-install.mjs`: an install that cannot be verified has
 * to say so, and an install must not be the reason `pnpm install` fails. Only
 * `--install` is tolerated - `--check` exists to FAIL, and is never run from
 * `prepare`.
 */
const installOrTolerate = (argv) => {
	try {
		return installDriver({ check: argv.includes("--check") });
	} catch (error) {
		if (!argv.includes("--tolerate-failure")) throw error;
		console.warn(`evidence-fold: ${error.message}`);
		console.warn(
			"evidence-fold: this is the `prepare` path, so the install is NOT failed by it. Run `pnpm evidence:fold:check` for the read-only answer, and `pnpm evidence:fold:install` once the cause is fixed.",
		);
		return 0;
	}
};

const installDriver = ({ check }) => {
	const current = git(["config", "--local", "--get", DRIVER_KEY]);
	if (check) {
		if (current === DRIVER_COMMAND) {
			console.log(
				`evidence-fold: the merge driver is installed (${DRIVER_KEY} = ${current}).`,
			);
			return 0;
		}
		console.error(
			`evidence-fold: ${DRIVER_KEY} is ${current === null ? "not set" : `"${current}"`} in this clone, so \`git merge\` will stop on a docs/evidence/manifest.json conflict (the same command still resolves it, but a conflict is a stop). Install it with:\n  pnpm evidence:fold:install`,
		);
		return 1;
	}
	if (current === DRIVER_COMMAND) {
		console.log(
			`evidence-fold: ${DRIVER_KEY} is already current in this clone.`,
		);
		return 0;
	}
	if (!gitStatus(["config", "--local", DRIVER_KEY, DRIVER_COMMAND]))
		throw new Error(
			`git config --local ${DRIVER_KEY} failed, so a fold would still stop on a manifest conflict`,
		);
	const after = git(["config", "--local", "--get", DRIVER_KEY]);
	if (after !== DRIVER_COMMAND)
		throw new Error(
			`${DRIVER_KEY} reads back as ${after}, not what was written - refusing to report a wired driver it cannot verify`,
		);
	console.log(`evidence-fold: set ${DRIVER_KEY} in this clone's local config.`);
	console.log(
		"evidence-fold: the rule that selects it is .gitattributes, which is tracked - a fresh clone needs `pnpm evidence:fold:install` once.",
	);
	return 0;
};

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

export const main = async (argv) => {
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(USAGE);
		return 0;
	}
	if (argv.includes("--install") || argv.includes("--check"))
		return installOrTolerate(argv);
	const driverIndex = argv.indexOf("--driver");
	if (driverIndex !== -1) return driver(argv.slice(driverIndex + 1));
	const dryRun = argv.includes("--dry-run");
	const unknown = argv.filter(
		(argument) => argument !== "--dry-run" && argument !== "--no-amend",
	);
	if (unknown.length > 0)
		throw new Error(`unknown argument(s) ${unknown.join(", ")}\n\n${USAGE}`);
	if (
		existsSync(join(ROOT, ".git", "MERGE_HEAD")) ||
		git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]) !== null
	)
		return completeMerge({ dryRun });
	return restampAtHead({ dryRun, amend: !argv.includes("--no-amend") });
};

if (isEntryPoint(import.meta.url)) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (error) {
		console.error(`evidence-fold: ${error.message}`);
		process.exitCode = 1;
	}
}
