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
 *      record this branch wrote, not a listing. A nested object INSIDE an entry
 *      is merged per key like every other object (round 3): the entry rule says
 *      which keys win, not how deep the merge stops.
 *   4. Derived fields are RE-DERIVED from the merged tree and taken from neither
 *      side: `srcTree`, `scriptsTree`, `frames`, `surfaces`, `themes`,
 *      `partialCapture.refreshedFrames` and the LEADING paragraph of every
 *      `countsMean` cell. `refreshedFrames` is re-derived whenever the merged
 *      file carries a `partialCapture` at all, not only when both sides moved
 *      the container: it is a count of the merged tree, so "which side moved the
 *      container" is not a question the field has an answer to, and a lane-only
 *      or main-only move used to carry a stale number through the identity
 *      short-circuits. It is also counted over the GUARD's own denominator -
 *      the frames named by `refreshedStories` and standing OUTSIDE every
 *      declared `supplementary` set (`inDeclaredSet`, shared with
 *      `check-evidence.mjs`), because a declared set is declared precisely
 *      because a sweep cannot produce its frames.
 *   5. No key main has that this branch deleted is carried back, under any name
 *      (main's manifest still carries `refreshedAtHeadNote`, a spelling this
 *      lineage retired) - while every key THIS branch carries survives, which is
 *      the clause `BRANCH_RECORDS` in `scripts/evidence-manifest.test.mjs` now
 *      fails on. Implemented in `mergedKeys`. A key the OTHER side deleted is
 *      KEPT (round 3, below) and both decisions are reported.
 *
 * NO KEY MAY BE LOST, AT ANY DEPTH (round 3, gated by
 * `scripts/check-fold-keys.mjs`). ANY non-array object both sides hold is merged
 * PER KEY, recursively and without a container list: `partialCapture`,
 * `captureOrigin`, nested records, entries inside `supplementary` - all of it.
 * It used to be taken WHOLESALE from whichever side moved it, unless the key was
 * one of a named few, so a nested key the other side still carried vanished:
 * `main` lost `partialCapture.addedSurfacesNote` at PR #748's merge
 * `8b2b499a13c` (another lane's silent fold loss), this branch still carried it,
 * and the next fold onto this branch handed the container back without it. Two
 * consequences worth stating, because they change what a fold KEEPS: a key the
 * other side deleted is now kept (its value resolved by the ordinary per-key
 * rules), and each such decision - and each of group (5)'s deliberate drops - is
 * PRINTED by the run (`kept <path> - the other side deleted it`,
 * `dropped <path> - this branch retired it`) so the fold's author states it
 * instead of leaving a reader to infer it. `main`'s own losses are still flagged
 * by the gate as `LOST[main]`, for the repair commit to answer.
 *
 * KEY ORDER IS DETERMINISTIC AND DOCUMENTED, because a resolver that reorders
 * a 500-key file makes every later fold's diff positional. `mergedKeys` returns
 * this branch's keys in THIS BRANCH's order first, then appends the keys only
 * main carries in main's order (it never re-sorts, and it never splices a
 * main-only key into the middle). So the FIRST fold into a branch produces a
 * large positional diff exactly once - main's records land at the end - and
 * every fold after it is a no-op for the keys neither side moved. That is why
 * main-only keys append rather than merging in place: honouring main's position
 * for a key this branch has never seen would have to reorder this branch's own
 * records around it, which is the same one-time diff paid against a different
 * side every fold.
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
 * THE DRIVER'S SIDE ASSIGNMENT IS ONLY TRUE INSIDE A MERGE, AND IT CHECKS.
 * `%A` is "this branch" for `git merge` and for nothing else: `git rebase`,
 * `pull --rebase`, cherry-pick, revert, `am` and stash-pop hand the driver the
 * UPSTREAM side as `%A` and the commit being replayed as `%B`, and git gives a
 * driver no way to tell. Resolving there would take the wrong side SILENTLY -
 * the lane's pass fields replaced by main's and a retired key resurrected, with
 * git reporting success, where before the driver existed the same operation
 * stopped on the conflict. So the driver resolves ONLY when git is running a real
 * merge, refuses otherwise (naming the operation wherever git records one),
 * writes git's own conflict markers and exits non-zero - see
 * `mergingForTheDriver`, which records what a merge actually exports:
 * `MERGE_HEAD` is written only AFTER the strategy finishes on git 2.55.0, so a
 * driver testing for it alone would refuse every merge, and the signals left are
 * the two `builtin/merge.c` sets for a real merge - `GITHEAD_<oid>` per merged
 * head and a `GIT_REFLOG_ACTION` beginning `merge` - neither of which a rebase,
 * `--rebase-merges`, cherry-pick or revert exports. A refused rebase is a stop
 * the author resolves by hand or by re-merging - never a mechanically resolved
 * manifest describing another side's tree.
 *
 * AND A REFUSAL SAYS WHY TWICE. Every non-zero driver exit prints the case it
 * could not handle - git relays a failed driver's stderr but says nothing itself
 * about the cause, and for a driver it cannot start the only line is the shell's
 * - and appends the same reason to `<git dir>/evidence-fold-driver.log`, because
 * once the terminal scrolls there is otherwise no record that a fold tool was
 * involved. See `refuseDriver` and `recordDriverFailure`.
 *
 * WHEN IT REFUSES. (a) A side that is not JSON - the sides are read with `git
 * show`, so a file that does not parse is a state this script cannot reason
 * about, and guessing would be worse than the conflict git already showed.
 * (b) Other unmerged paths still in the index: the manifest is resolved and
 * staged, and the tool says which paths remain rather than deriving counts from
 * a half-merged tree. (c) A result that fails its own guards: the conflict on the
 * manifest is RESTORED (`git checkout -m`), so `git status` shows the same
 * unresolved path the author had before the run and nothing half-resolved is
 * left staged for an accidental commit; the guard's own text is printed with the
 * way forward. (d) The merge driver, on any operation that is not a real merge -
 * see above: it names the operation wherever git records one, writes git's own
 * conflict markers into the working file and exits non-zero, so the stop the
 * author gets is the one they would have got without the driver installed.
 *
 * WHY THE DRIVER PATH MUST STAY IMPORT-LIGHT. `--driver` runs inside `git merge`,
 * potentially in a worktree with no `node_modules`; `check-evidence.mjs` imports
 * `sharp` at module scope for the frame walk. So the derived fields are reached
 * through a DYNAMIC import, taken only on the path that re-derives.
 */
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
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

/**
 * The clone's own git directory, ASKED OF GIT rather than spelled `${ROOT}/.git`.
 *
 * The difference is not cosmetic and it is not an edge case here: in a LINKED
 * WORKTREE `.git` is a FILE holding a `gitdir:` path, so `${ROOT}/.git/MERGE_HEAD`
 * never exists and `${ROOT}/.git/evidence-fold-driver.log` never lands in the
 * git directory at all. This repository is worked in linked worktrees and in
 * sibling checkouts, so a marker or a log written to a path derived from `ROOT`
 * would be written to the wrong place - or to nowhere - exactly where a fold
 * happens.
 */
const gitDirPath = () =>
	git(["rev-parse", "--absolute-git-dir"]) ?? join(ROOT, ".git");

/** Where a refused or failed driver run leaves its reason, inside the git dir. */
const DRIVER_LOG = "evidence-fold-driver.log";

/**
 * Record a driver failure where a person can still find it afterwards.
 *
 * WHY A FILE AND NOT ONLY STDERR. git DOES relay a failed merge driver's stderr
 * (measured on 2.55.0), but it relays it above its own `Auto-merging ...` /
 * `CONFLICT (content)` lines, and what git itself says about the failure names
 * no cause - for a driver it could not even start, the only line is the shell's
 * "command not found". Once the terminal scrolls, nothing records that a fold
 * tool was involved at all. The log is the durable half of the same message.
 *
 * A read-only or missing git directory must NOT turn a refusal into a crash -
 * refusing is the safe outcome and this is best-effort evidence - so the append
 * is guarded and the path is returned either way.
 */
const recordDriverFailure = (reason) => {
	const path = join(gitDirPath(), DRIVER_LOG);
	/*
	 * WHAT GIT ACTUALLY RAN, not the constant this file would install. A refusal
	 * is investigated in a clone whose `merge.evidence-fold.driver` may be a
	 * hand-written command, an older version's, or a wrapper - and "the driver
	 * said no" is only actionable next to the command that was configured to be
	 * the driver. `--local` is the scope `--install` writes; the constant is the
	 * fallback for a driver wired globally or from an environment that blocks the
	 * query.
	 */
	const configured =
		git(["config", "--local", "--get", DRIVER_KEY]) ?? DRIVER_COMMAND;
	try {
		appendFileSync(
			path,
			`[${new Date().toISOString()}] ${reason}\n  driver: ${DRIVER_KEY} = ${configured}\n  cwd: ${process.cwd()}\n`,
			"utf8",
		);
	} catch {
		// Best effort: the stderr line above is still the primary report.
	}
	return path;
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
 * Group (1) has no constant, deliberately.
 *
 * The rule is "a pass-describing field is THIS BRANCH's when both sides changed
 * it", and it is implemented as the DEFAULT for a conflicted key - which is
 * what almost every key in this file is. A named list of ~120 `*Note` keys
 * would go stale the first time a pass writes a new record, and a list that is
 * never READ (as this one used to be) reads like enforcement while enforcing
 * nothing. What must never be a default is the two cases below, so those are
 * the ones named.
 */

/** Group (4): re-derived from the merged tree, never carried from a side. */
const DERIVED_TOP = new Set([
	"srcTree",
	"scriptsTree",
	"frames",
	"surfaces",
	"themes",
]);

/*
 * NO CONTAINER LIST, deliberately, because the list was the defect.
 *
 * A resolver used to take the side that moved a key WHOLESALE unless the key
 * was one of a named few, so a nested key the other side still carried vanished:
 * `main` lost `partialCapture.addedSurfacesNote` from its own copy (PR #748's
 * merge `8b2b499a13c`, another lane's silent fold loss), this branch still had
 * it, and the fold that moved `partialCapture` handed the whole container back
 * with the key gone - the loss propagated, with `main`'s move as the excuse.
 *
 * So the rule is now structural and recursive: ANY non-array object both sides
 * hold is merged per key, at every depth. The key set comes from `mergedKeys`
 * (this branch's keys always survive; a key this branch RETIRED stays dropped;
 * a key the OTHER side deleted is kept, and reported). Values - strings,
 * numbers, arrays, and a key one side does not hold at all - still resolve by
 * the three-way rule below.
 */

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
 *
 * ORDER: this branch's keys first, in this branch's order, then the keys only
 * main carries, in main's order. Deterministic and deliberate - see the header's
 * `KEY ORDER IS DETERMINISTIC` paragraph for why main-only keys append rather
 * than splicing into main's position.
 */
export const mergedKeys = (base, ours, theirs, path = "", decisions = null) => {
	const keys = Object.keys(ours);
	for (const key of keys) {
		/*
		 * A key the OTHER side deleted that this branch still carries is KEPT - its
		 * value goes through the ordinary per-key rules - and the decision is
		 * RECORDED, because it is the one a reader has to state: the fold this
		 * resolver replaced took the moved side's container whole and the key
		 * disappeared with no line in the report (round-3 finding, kept from
		 * `main`'s `partialCapture.addedSurfacesNote`).
		 */
		if (decisions && !(key in theirs) && key in base)
			decisions.push({
				path: childPath(path, key),
				action: "kept",
				why: "the other side deleted it",
			});
	}
	for (const key of Object.keys(theirs)) {
		if (key in ours) continue;
		if (key in base) {
			// This branch deleted it - group (5), and a stated decision.
			if (decisions)
				decisions.push({
					path: childPath(path, key),
					action: "dropped",
					why: "this branch retired it",
				});
			continue;
		}
		keys.push(key);
	}
	return keys;
};

/** `a.b` (or `b` at the document root), for a key decision's path. */
const childPath = (path, key) => (path === "" ? key : `${path}.${key}`);

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
 *
 * Group (4)'s container-scoped field - `partialCapture.refreshedFrames` - is NOT
 * handled here: it must be re-derived whichever side moved the container, and
 * the identity short-circuit below is exactly the case that hides. It is applied
 * by `resolveManifest`, the only scope that can see the container surviving from
 * ANY side.
 */
export const mergeValue = (
	key,
	base,
	ours,
	theirs,
	derived,
	path = key,
	decisions = null,
) => {
	/*
	 * Group (4) is asked FIRST and not after the identity short-circuits below,
	 * because a re-derivation must fire even when the two sides AGREE: a fold
	 * that only moved `main`'s tree leaves both copies at base's stale stamp,
	 * and `deepEqual(ours, theirs)` would then hand the stale value through as a
	 * unanimous answer. The driver passes no `derived` at all (the merged tree
	 * does not exist mid-merge) and falls through to the three-way rule.
	 */
	if (derived && DERIVED_TOP.has(key) && derived[key] !== undefined)
		return derived[key];
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
	/*
	 * ANY OBJECT BOTH SIDES HOLD IS MERGED PER KEY, and this line has to sit
	 * BEFORE the identity short-circuits: those return one side's value WHOLE
	 * when the other side did not move it, which is how a nested key the other
	 * side still carries disappears (see the note where the container list used
	 * to be). Depth is unbounded - an object inside an object is another call -
	 * and the key set it uses is `mergedKeys`', so KEY policies are unchanged:
	 * this branch's keys always survive, a key this branch retired stays dropped,
	 * a key the other side deleted is kept and reported.
	 */
	if (isObject(ours) && isObject(theirs))
		return mergeObject(base ?? {}, ours, theirs, path, decisions);
	if (deepEqual(ours, theirs)) return ours;
	if (deepEqual(base, ours)) return theirs;
	if (deepEqual(base, theirs)) return ours;

	// Both sides moved this value, and it is not an object: group (1).
	return ours;
};

/**
 * An object merged key by key, at whatever depth the resolver reached it.
 *
 * The key set is `mergedKeys` at every level (group 5, and the round-3 rule
 * that a key the other side deleted is kept and reported). Inside an entry of a
 * supplementary set the entry's authored keys still come from ours and its own
 * sub-arrays still union - that is `mergedKeys` plus the listing rules, not a
 * separate policy.
 *
 * `null` for `derived`, deliberately: a key INSIDE an object is not the
 * top-level field of the same name, and handing the top-level derivation down
 * would replace a nested `frames` with the sweep's frame count.
 */
const mergeObject = (base, ours, theirs, path, decisions) => {
	const out = {};
	for (const key of mergedKeys(base, ours, theirs, path, decisions)) {
		const value = mergeValue(
			key,
			base?.[key],
			ours?.[key],
			theirs?.[key],
			null,
			childPath(path, key),
			decisions,
		);
		if (value !== undefined) out[key] = value;
	}
	return out;
};

/**
 * A `supplementary` entry present on both sides: group (3).
 *
 * `path` is the entry's identity in the report (`supplementary[<path>]`), and a
 * nested object inside an entry recurses through `mergeValue` like any other -
 * the entry rule says which keys win, not how deep the merge stops.
 */
const mergeEntry = (base, ours, theirs, path, decisions) => {
	const out = {};
	for (const key of mergedKeys(base ?? {}, ours, theirs, path, decisions)) {
		const value = mergeValue(
			key,
			base?.[key],
			ours?.[key],
			theirs?.[key],
			null,
			childPath(path, key),
			decisions,
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
 *
 * `decisions` is an optional array the caller supplies to COLLECT the one-sided
 * key decisions the merge made - `kept` (the other side deleted a key this
 * branch still carries) and `dropped` (this branch retired a key). The run report
 * prints them so the fold's author states them; nothing is decided differently
 * for being collected, and a caller that omits the array gets the same file.
 */
export const resolveManifest = ({
	base,
	ours,
	theirs,
	derived = null,
	decisions = [],
}) => {
	if (!isObject(ours) || !isObject(theirs))
		throw new Error("both sides of the manifest must be JSON objects");
	const out = {};
	for (const key of mergedKeys(base ?? {}, ours, theirs, "", decisions)) {
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
			key,
			decisions,
		);
		if (value === undefined) continue;
		/*
		 * The container's own derived field, applied HERE and not inside
		 * `mergeValue`, because the rule is "whenever the merged file carries a
		 * `partialCapture`" and the identity short-circuits cannot see that: a
		 * lane-only move and a main-only move both hand one side's container back,
		 * so a `refreshedFrames` derived inside the per-key merge would fire in the
		 * wrong subset of the four states.
		 *
		 * A COPY, never a mutation, for the case `mergeValue` legitimately returns
		 * ONE SIDE'S OBJECT: a key the other side does not hold at all is not an
		 * object-vs-object merge, so `value` can still be `ours.partialCapture`
		 * ITSELF - and writing through it would edit the caller's side object, which
		 * `--dry-run`'s diff reads.
		 */
		out[key] =
			key === "partialCapture" &&
			derived?.refreshedFrames !== undefined &&
			isObject(value)
				? { ...value, refreshedFrames: derived.refreshedFrames }
				: value;
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
		out.supplementary = out.supplementary.map((set, index) => {
			const o = ourSets.get(set?.path);
			const t = theirSets.get(set?.path);
			if (!o || !t) return set;
			return mergeEntry(
				baseSets.get(set?.path),
				o,
				t,
				`supplementary[${set?.path ?? index}]`,
				decisions,
			);
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
		declaredStoryRows,
		declaredThemeNames,
		frames: frameFiles,
		inDeclaredSet,
		namedByPass,
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
	// `inDeclaredSet` comes from the guard rather than being restated: this count
	// and the `frames` field beside it must exclude the same directories.
	const outside = onDisk.filter((file) => !inDeclaredSet(file, declaredDirs));
	const stories = declaredStoryRows(capture);
	const themes = declaredThemeNames(capture);

	/*
	 * `refreshedFrames`, re-derived rather than carried: the frames standing in
	 * the directories `refreshedStories` names, at the tree under construction.
	 * BOTH halves of the question are the guard's own, shared rather than
	 * restated - `namedByPass` for the directory (so a story captured in a second
	 * state, a `dir` override or a width-suffixed directory, counts here exactly
	 * as it is checked there) and `outside` for the pool.
	 *
	 * The pool is `outside`, NOT the whole walk: `partialCaptureFailures` asks
	 * this field its own denominator (`ls-tree` frames named by the pass and not
	 * in a declared set), so a field derived over a WIDER pool is a claim the
	 * guard cannot see - one-sided by design, so an over-count passes silently.
	 * Measured on this branch's shipped manifest (the fold onto `490c2079fb`):
	 * the un-excluded walk derived 10862 against the guard's own 10418, and a
	 * re-IMPLEMENTED directory matcher (rather than `namedByPass`) missed 62 more.
	 */
	const refreshedStories = manifest.partialCapture?.refreshedStories ?? [];
	const refreshedFrames = outside.filter((file) =>
		namedByPass(relative(root, file), refreshedStories, root),
	).length;

	return {
		srcTree,
		scriptsTree,
		frames: outside.length,
		surfaces: stories,
		themes,
		refreshedFrames,
		countsMean: {
			frames: `RE-DERIVED FOR THIS FOLD (this branch folded onto \`origin/main\` = \`${baseLabel}\`): ${outside.length} committed WebP files outside the ${sets.length} declared supplementary sets below, of ${onDisk.length} on disk (${onDisk.length - outside.length} of them inside the sets). Whether this fold moved any frame a story renders is the AUTHOR's statement to make, not this tool's - the numbers above are what the walk found.`,
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
 * tree other than the live one (the tests do exactly that).
 *
 * WHAT IS ACTUALLY ASKED, because the PR body and `AGENTS.md` used to name five
 * guards while three ran. `stampFailures` IS the tree half and is asked once: it
 * already folds `partialCaptureFailures` and `countsMeanFailures` in, and asking
 * those again here printed every one of their failures twice. `citationFailures`
 * - group 1's `head`/`refreshedAtHead`/`addedAtHead` reachability, which is
 * precisely the half those values exist for - is asked of the repository reader.
 * `citationAncestryFailures` cannot be answered in a SHALLOW clone (no ancestor
 * of HEAD is present), so that half stands down there and says so in `notes`
 * rather than reporting a failure it cannot know.
 *
 * Returns `{ failures, notes }`. A non-empty `failures` is a refusal: nothing is
 * written, and `completeMerge` puts the conflict back.
 */
export const runGuards = async ({
	manifest,
	target,
	root = ROOT,
	git: read = git,
}) => {
	const { citationAncestryFailures, citationFailures, stampFailures } =
		await import("./check-evidence.mjs");
	const at = (args) =>
		read(
			args.map((argument) =>
				argument === "HEAD"
					? target
					: argument.startsWith("HEAD:")
						? `${target}${argument.slice(4)}`
						: argument,
			),
		);
	const failures = [
		...stampFailures(manifest, at, join(root, "docs", "evidence")),
		...citationFailures(manifest, read),
	];
	const notes = [];
	if (read(["rev-parse", "--is-shallow-repository"]) === "true") {
		notes.push(
			"the citation-ancestry guard stood down: this is a shallow clone, so no ancestor of HEAD is present to ask about. That is NOT a failure - the stamps are still guarded here and on every clone - and CI's full clone asks it.",
		);
	} else {
		failures.push(...citationAncestryFailures(manifest, read));
	}
	return { failures, notes };
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
 * THE ONE PATH A FOLD CHOOSES TO WRITE, spelled once.
 *
 * Every fold state writes exactly this file and nothing else: the group-1/2/3/5
 * resolution, the re-derived stamps and the restamp all land here, and the only
 * other path this tool ever writes is the `%A` file git itself hands the driver
 * (which is git's, not ours, and exists only during a merge). Funnelling the
 * writes makes that invariant checkable in one place instead of argued from four
 * call sites - and the guard in the suite asserts it from the outside, over a
 * real fold run, rather than trusting this comment.
 */
const writeManifest = (text) => {
	const target = join(ROOT, MANIFEST_PATH);
	/*
	 * Compared with posix separators: `relative` answers with the platform's, so
	 * `docs\evidence\manifest.json` on Windows would not equal `MANIFEST_PATH` and
	 * the guard would refuse every fold there instead of the path it means to
	 * refuse.
	 */
	const relativePosix = relative(ROOT, target).split(sep).join("/");
	if (relativePosix !== MANIFEST_PATH)
		throw new Error(
			`refusing to write ${target}: a fold writes ${MANIFEST_PATH} and nothing else`,
		);
	writeFileSync(target, text);
	return target;
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

/**
 * Whether `rev` is already on a remote-tracking ref.
 *
 * `git branch -r --contains` answers it from the clone alone (no network call):
 * a non-empty list means the tip has been pushed or fetched, which is the state
 * `--amend` must refuse to rewrite.
 */
const reachesRemoteTracking = (rev) =>
	(git(["branch", "-r", "--contains", rev]) ?? "") !== "";

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
	const decisions = [];
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
				// The decision list belongs to the resolution the run reports.
				decisions,
			});
		}
		reportKeyDecisions(decisions);
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
	writeManifest(serialize(resolved));
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
		// Re-collected for THIS resolution - the one the run goes on to write.
		decisions,
	});
	const { failures, notes } = await runGuards({
		manifest: resolved,
		target: tree,
	});
	for (const note of notes) console.log(`evidence-fold: ${note}`);
	if (failures.length > 0) {
		/*
		 * PUT THE CONFLICT BACK, because by now the half-resolved manifest IS in
		 * the index: `write-tree` cannot hash an unmerged index, so the file was
		 * written and staged before the merged tree could be named at all. A
		 * refusal that simply returned would leave a conflict-free index whose
		 * next `git commit` succeeds - the opposite of what refusing means, and
		 * the reason this used to print "NOT written" about a file it had
		 * written. `git checkout -m` restores the three index stages and the
		 * markers, so the author sees exactly the state the run started in.
		 */
		const restored = gitStatus(["checkout", "-m", "--", MANIFEST_PATH]);
		console.error(
			`evidence-fold: the resolved manifest fails its own guards:\n  - ${failures.join("\n  - ")}`,
		);
		if (restored) {
			const staged = stagedPaths();
			/*
			 * WHAT IS STAGED, MEASURED: git lists the restored path in
			 * `diff --cached --name-only` as its UNMERGED entry, so a parenthetical
			 * saying the manifest is "not among" the staged paths was false (QA
			 * round-2 Q4). The distinction that matters is unmerged-vs-resolution,
			 * not present-vs-absent, and that is what this says.
			 */
			console.error(
				`evidence-fold: the resolution was NOT kept - ${MANIFEST_PATH} is back to the merge's unresolved state, so git will not commit it as a resolution. The ${staged.length} path(s) git lists as staged are the merge's own bookkeeping, and ${MANIFEST_PATH} appears among them as that UNMERGED path rather than as a resolved one.`,
			);
		} else {
			console.error(
				`evidence-fold: the conflict could NOT be restored, so the half-resolved copy IS STAGED at ${MANIFEST_PATH} - do not commit it as it stands.`,
			);
		}
		console.error(
			`evidence-fold: to proceed by hand, either fix the cause on this branch's HEAD and re-merge (main's copy is not the answer, and this tool cannot invent a record neither side carries), or resolve ${MANIFEST_PATH} yourself and commit WITHOUT this tool. A hand resolution is honoured only if the tool is not run again in this merge: every run re-resolves from the three git objects, so a re-run silently replaces a hand edit.`,
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
	writeManifest(text);
	stageManifest();
	reportKeyDecisions(decisions);
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
	const { failures, notes } = await runGuards({
		manifest: resolved,
		target: "HEAD",
	});
	for (const note of notes) console.log(`evidence-fold: ${note}`);
	if (failures.length > 0) {
		console.error(
			`evidence-fold: the re-derived manifest fails its own guards, so it was NOT written:\n  - ${failures.join("\n  - ")}`,
		);
		console.error(
			`evidence-fold: fix the cause on this branch's HEAD (a record neither side carries cannot be re-derived), or edit ${MANIFEST_PATH} yourself and commit that - a later run re-derives from git and would replace a hand edit.`,
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
	writeManifest(serialize(resolved));
	stageManifest();
	reportDiff(ours, resolved, { baseLabel: mergeBaseLabel(), derived: true });

	/*
	 * AMENDING A PUSHED TIP IS REFUSED, not warned about. The amend rewrites the
	 * merge commit's SHA, which needs a force-push and unpins any review round
	 * that names it (the fleet's own re-pinning rule exists for exactly that
	 * cost). The values are still written and staged - the state `--no-amend`
	 * leaves - so the author commits them on top instead.
	 */
	const mergeTip = amend && isMergeCommit("HEAD");
	const pushed = mergeTip && reachesRemoteTracking("HEAD");
	if (!mergeTip || pushed) {
		console.log(
			`evidence-fold: write a re-stamp commit carrying the values:\n  git commit -m "docs(evidence): re-derive the stamp pair over the folded tree"`,
		);
		if (pushed)
			console.log(
				"evidence-fold: and the tip was NOT amended - HEAD is already reachable from a remote-tracking ref, so an amend would rewrite published history and need a force-push, unpinning any review round that names that SHA. Run this before pushing; if it is already pushed, commit the values on top instead.",
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

/**
 * Name the one-sided key decisions this merge made.
 *
 * WHY THE FILE ALONE IS NOT ENOUGH: the round-3 policy keeps a key the OTHER
 * side deleted and drops one THIS branch retired, and both readings are only
 * correct if the fold's author says so. `main`'s copy lost
 * `partialCapture.addedSurfacesNote` at PR #748's merge `8b2b499a13c` - another
 * lane's silence - and the gate that caught it (`scripts/check-fold-keys.mjs`)
 * asks for a stated decision rather than a guess. So each one is printed:
 * `kept <path> - the other side deleted it`,
 * `dropped <path> - this branch retired it`.
 */
const reportKeyDecisions = (decisions, write = console.log) => {
	if (decisions.length === 0) return;
	write(
		`evidence-fold: ${decisions.length} one-sided key decision(s) in this merge (kept as stated here - the fold's record has to carry them):`,
	);
	for (const { path, action, why } of decisions.slice(0, 24))
		write(`evidence-fold:   ${action} ${path} - ${why}`);
	if (decisions.length > 24)
		write(`evidence-fold:   ... and ${decisions.length - 24} more`);
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

/**
 * The operation git is in the middle of, or null when it is in the middle of
 * none. `WHEN IT REFUSES` (d) above is why `driver()` asks.
 *
 * The markers are present WHILE the driver runs, measured on 2026-10-02 with
 * git 2.55.0 (`ls` inside the driver): a rebase leaves `rebase-merge/`, an `am`
 * leaves `rebase-apply/applying`, a multi-commit sequence leaves `sequencer/`.
 * A SINGLE-COMMIT cherry-pick, a revert and a stash-pop leave NONE of them (git
 * writes `CHERRY_PICK_HEAD`/`REVERT_HEAD` after the merge step it is running
 * now), which is why they cannot be NAMED - they are refused by the positive
 * test below instead.
 */
const operationInProgress = () => {
	const dir = gitDirPath();
	if (existsSync(join(dir, "rebase-merge"))) return "rebase (or pull --rebase)";
	if (existsSync(join(dir, "rebase-apply", "applying"))) return "git am";
	if (existsSync(join(dir, "rebase-apply"))) return "rebase";
	if (existsSync(join(dir, "CHERRY_PICK_HEAD"))) return "cherry-pick";
	if (existsSync(join(dir, "REVERT_HEAD"))) return "revert";
	if (existsSync(join(dir, "sequencer")))
		return "a cherry-pick/revert sequence";
	return null;
};

/**
 * Whether git is handing the driver the sides of a real merge.
 *
 * THE `MERGE_HEAD` TEST THAT THE RULE WAS WRITTEN WITH DOES NOT HOLD, measured
 * on 2026-10-02 with git 2.55.0: `MERGE_HEAD` is written only AFTER the merge
 * strategy finishes, so it is ABSENT for the whole time the driver runs - in a
 * real `git merge` exactly as in a rebase. A driver that required it would
 * refuse every merge, including the one this file exists to resolve. What a
 * merge DOES export, and what a rebase, a cherry-pick, a revert and a stash-pop
 * do NOT, is `GITHEAD_<sha>` (git names the other side for the merge machinery),
 * measured across all six operations; `git merge --squash` sets it too.
 *
 * So the test is POSITIVE, and its failure mode is a STOP: a clone whose git
 * exports neither `MERGE_HEAD` early nor either of merge.c's two variables gets
 * the driver refusing, git reports the conflict it would have reported without
 * this driver, and `pnpm evidence:fold` still resolves the file correctly
 * afterwards (the merge state exists by then). The alternative - resolving on a
 * signal we cannot verify - is the silent wrong-side resolution this whole check
 * exists to prevent.
 */
const mergingForTheDriver = () =>
	existsSync(join(gitDirPath(), "MERGE_HEAD")) ||
	git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]) !== null ||
	/*
	 * THE TWO THINGS `builtin/merge.c` SETS FOR A REAL MERGE, AND NOTHING ELSE
	 * DOES. Measured on git 2.55.0: right before the strategies run, merge.c does
	 * `setenv("GIT_REFLOG_ACTION", "merge <names>", 0)` and, per merged head,
	 * `setenv("GITHEAD_<oid>", "<name>", 1)` (builtin/merge.c, the block above the
	 * `use_strategies` loop). A rebase, a `rebase --rebase-merges`, a cherry-pick
	 * and a revert export NEITHER - checked by dumping the driver's own
	 * environment for all four - and git flags those separately through the
	 * marker files `operationInProgress` reads.
	 *
	 * WHY BOTH AND NOT JUST GITHEAD_. `GITHEAD_<oid>` is the load-bearing signal
	 * and it is why the driver can tell a merge from a cherry-pick at all: git
	 * writes NO marker file for a merge or for a single-commit cherry-pick, and
	 * `MERGE_HEAD` does not exist while a driver runs (merge.c writes it after the
	 * strategy returns). Relying on the pair means a merge is still recognised
	 * when something in the surrounding harness - a wrapper that scrubs the
	 * environment, a caller that never exported the per-head variables - has
	 * dropped one of them, which is the difference between resolving a legitimate
	 * merge and refusing it. `GIT_REFLOG_ACTION` is compared with its documented
	 * shape ("merge <names>"), so `git merge` from `git pull` still matches.
	 */
	/^merge(\s|$)/.test(process.env.GIT_REFLOG_ACTION ?? "") ||
	Object.keys(process.env).some((name) => name.startsWith("GITHEAD_"));

/**
 * Name the case a driver run cannot resolve, for the refusal message.
 *
 * The case has to be NAMED, not gestured at: `null` is the shape git gives a
 * single-commit cherry-pick, a revert and a stash-pop (it writes their marker
 * file only after the merge step the driver is running inside), and it is ALSO
 * the shape a real merge has when the surrounding harness scrubbed merge.c's
 * two variables - so the message says both readings rather than pretending to
 * know which one it is.
 */
const refusalCase = (operation) =>
	operation ??
	"an operation that is not a merge (a cherry-pick, revert or stash-pop, which git records no marker for until this step finishes - or a merge whose environment exported neither GITHEAD_* nor a merge GIT_REFLOG_ACTION)";

/**
 * Refuse a merge-driver run: say why, record why, and leave a conflict behind.
 *
 * WHY THE MESSAGE MUST NAME THE CASE. git relays a failed driver's stderr, but
 * its own output around it is only `Auto-merging ...` / `CONFLICT (content)` /
 * `Automatic merge failed`, none of which names a cause - and when the installed
 * driver command cannot even start, the one line is the shell's "command not
 * found". A refusal that says WHICH case it could not handle is the difference
 * between an author completing the merge and an author abandoning the tool for
 * the manual fold.
 *
 * WHY IT IS ALSO WRITTEN TO `<git dir>/evidence-fold-driver.log`. Stderr
 * scrolls: a lane that hits this mid-session, or a reviewer reading the
 * transcript afterwards, has nothing left to read. The log is the durable copy,
 * and the message names its path so a reader knows where to look.
 *
 * WHY THE MARKERS ARE WRITTEN EVEN THOUGH THIS REFUSED. Exiting non-zero is what
 * makes git record the conflict (all three index stages, so both `git commit`
 * and `rebase --continue` refuse), but a driver that exits WITHOUT writing
 * leaves the working file holding %A - one side's copy - which reads as a
 * resolution to the next person. Measured on git 2.55.0. Git's own text merge
 * writes markers there, so this writes them too: installed or not, the author
 * opens the same conflicted file. Writing to %A before a non-zero exit is
 * supported; git keeps the unmerged index either way.
 */
const refuseDriver = ({
	named,
	why,
	oursPath,
	theirsPath,
	operation = null,
}) => {
	const reason = `REFUSING to resolve ${MANIFEST_PATH} during ${named}: ${why}`;
	console.error(`evidence-fold: ${reason}`);
	console.error(
		`evidence-fold: the conflict is left exactly as it was before this driver existed - finish the operation, resolve ${MANIFEST_PATH} by hand if git stops on it, then re-derive with \`pnpm evidence:fold\`.`,
	);
	console.error(
		`evidence-fold: this reason is recorded at ${recordDriverFailure(reason)}`,
	);
	if (typeof oursPath !== "string" || typeof theirsPath !== "string") return 1;
	for (const path of [oursPath, theirsPath]) {
		if (!existsSync(path))
			throw new Error(
				`git handed the driver a path that does not exist (${path}), so the conflict could not be marked`,
			);
	}
	const withNewline = (text) => (text.endsWith("\n") ? text : `${text}\n`);
	/*
	 * The labels name the sides git actually handed us. `%A` is NOT this branch
	 * outside a merge - that is the whole reason this path refuses - and
	 * `operation` is null for the operations git records no marker for, so it
	 * must not be interpolated as if it were a name (that printed "the null
	 * upstream side").
	 */
	const oursLabel =
		operation === null
			? "git's %A - not this branch (no merge in progress)"
			: `git's %A, the upstream side during ${operation}`;
	const theirsLabel =
		"git's %B - the commit being replayed, or the stashed change";
	writeFileSync(
		oursPath,
		`<<<<<<< ${oursLabel}\n${withNewline(
			readFileSync(oursPath, "utf8"),
		)}=======\n${withNewline(
			readFileSync(theirsPath, "utf8"),
		)}>>>>>>> ${theirsLabel}\n`,
	);
	return 1;
};

const driver = (argv) => {
	const [basePath, oursPath, theirsPath] = argv;
	/*
	 * A CALL WHOSE PATHS ARE MISSING. `%O %A %B` are substituted by git, so fewer
	 * than three paths means `merge.evidence-fold.driver` is not the command
	 * `--install` writes - a hand-written driver, or one left by an older
	 * version. There is no working file to mark (the paths are what is missing),
	 * but refusing is still the whole answer: resolving from an invocation shape
	 * we do not understand is how a wrong-side stamp ships.
	 */
	if (
		typeof basePath !== "string" ||
		typeof oursPath !== "string" ||
		typeof theirsPath !== "string"
	) {
		return refuseDriver({
			named: `a driver invocation with ${argv.length} path argument(s) instead of three (%O %A %B)`,
			why: "the installed merge.evidence-fold.driver command is not the one this script installs, so there is no merge for it to resolve",
		});
	}
	const operation = operationInProgress();
	if (operation !== null || !mergingForTheDriver()) {
		return refuseDriver({
			named: refusalCase(operation),
			why: "outside a merge git hands a merge driver the UPSTREAM side as %A, so resolving here would take the wrong side without a word",
			oursPath,
			theirsPath,
			operation,
		});
	}
	const readSide = (path, label) => {
		if (!existsSync(path)) throw new Error(`${label} (${path}) does not exist`);
		const text = readFileSync(path, "utf8").trim();
		if (text.length === 0) return {};
		return readJson(text, label);
	};
	const base = readSide(basePath, "the merge base");
	const ours = readSide(oursPath, "this branch's copy");
	const theirs = readSide(theirsPath, "the incoming copy");
	const decisions = [];
	const resolved = resolveManifest({ base, ours, theirs, decisions });
	writeFileSync(oursPath, serialize(resolved));
	// The driver reports the same one-sided key decisions the fold does: git shows
	// this text beside the merge, which is where the author reads the fold.
	reportKeyDecisions(decisions, (line) => console.error(line));
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
	"               merge tip - print the commit command instead. The amend is",
	"               also refused when the tip is already on a remote-tracking",
	"               ref, since that would rewrite published history.",
	"  --install    point this clone's merge.evidence-fold.driver at this script,",
	"               so `git merge` does not stop on a manifest conflict.",
	"  --tolerate-failure",
	"               print a loud warning instead of failing when --install cannot",
	"               wire the driver. This is how `prepare` invokes it: an install",
	"               must never be broken by a helper, and `--check` is the",
	"               spelling that DOES fail.",
	"  --check      read-only: report whether that merge driver is installed,",
	"               and exit non-zero with what to run when it is not. It is the",
	"               driver wiring only - the push hook is a different wiring.",
	"  --driver     the merge driver git invokes; not for use by hand.",
	"",
	"After a fold the file is staged and the stamps describe the MERGED tree; the",
	"next step this script prints is the single commit that carries them.",
	"",
	"WHY THE SPELLING ABOVE IS `node` AND NOT `pnpm`. This script is plain Node",
	"with no dependencies - it reads git objects and writes one file - so a fold",
	"must never need an install. pnpm 11+ does not agree: `verifyDepsBeforeRun`",
	"defaults to `install`, so ANY `pnpm run` (including `pnpm evidence:fold`)",
	"installs first when node_modules looks stale, which in a lane's worktree means",
	"pruning node_modules, failing on unreviewed build scripts, and WRITING an",
	"`allowBuilds:` block into the tracked pnpm-workspace.yaml. `pnpm-workspace.yaml`",
	"turns that check off for this repository (it is read from there, not from",
	".npmrc, in pnpm 12), and `node scripts/evidence-fold.mjs` is the form that",
	"cannot reach a package manager in the first place. The `pnpm evidence:fold`",
	"and `pnpm evidence:fold:install` aliases still work.",
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

/**
 * The preflight both FOLD states run before they write anything.
 *
 * WHY IT IS SEPARATE FROM THE RESOLUTION. A run that cannot be completed has to
 * be stopped before the first write rather than discovered half-way through it,
 * because the merge state stages the manifest as part of naming the merged tree.
 * These are the conditions that make a run unsafe rather than merely unready -
 * no work tree to fold in, no manifest to fold, and an index git cannot read -
 * each of which would otherwise surface later as a confusing git failure with a
 * half-written file on disk.
 *
 * It is deliberately NOT a check on `node_modules`, a package manager or the
 * lockfile: this tool resolves a file with plain Node and git and must never
 * require - or trigger - an install to do it. That half of the guarantee lives
 * in `pnpm-workspace.yaml`'s `verifyDepsBeforeRun`, which is why the tool's
 * documented entry point is `node scripts/evidence-fold.mjs`.
 */
const preflightFold = () => {
	if (git(["rev-parse", "--is-inside-work-tree"]) !== "true")
		throw new Error(
			`this is not inside a git work tree, so there is no merged tree for ${MANIFEST_PATH} to describe. Run the fold from the checkout it belongs to.`,
		);
	if (!existsSync(join(ROOT, MANIFEST_PATH)))
		throw new Error(
			`${MANIFEST_PATH} does not exist in this work tree, so there is nothing to resolve. A fold RESOLVES AN EXISTING manifest across a merge - check the path and the branch before re-running; nothing has been written.`,
		);
	if (git(["diff", "--cached", "--name-only"]) === null)
		throw new Error(
			`git could not read this repository's index, and the merged tree the stamps describe is named from it, so a fold cannot run safely. Nothing has been written - fix the index (for example remove a stale index.lock) and re-run.`,
		);
};

export const main = async (argv) => {
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(USAGE);
		return 0;
	}
	if (argv.includes("--install") || argv.includes("--check"))
		return installOrTolerate(argv);
	const driverIndex = argv.indexOf("--driver");
	if (driverIndex !== -1) return driver(argv.slice(driverIndex + 1));
	/*
	 * THE PREFLIGHT, BEFORE ANY STATE IS CHOSEN AND BEFORE ANY WRITE. Both fold
	 * states write as soon as they have an answer (the merge state stages the
	 * manifest so `git write-tree` can name the merged tree), so a run that cannot
	 * be completed has to be stopped HERE rather than discovered half-way through.
	 * The driver path is deliberately past this point: it runs inside a merge git
	 * is still performing, where these questions are git's to answer.
	 */
	preflightFold();
	const dryRun = argv.includes("--dry-run");
	const unknown = argv.filter(
		(argument) => argument !== "--dry-run" && argument !== "--no-amend",
	);
	if (unknown.length > 0)
		throw new Error(`unknown argument(s) ${unknown.join(", ")}\n\n${USAGE}`);
	/*
	 * The non-merge branch is reached through the SAME question the driver asks,
	 * and for the same reason: during a conflicted rebase `HEAD` is the commit
	 * being rebased ONTO, so resolving from `HEAD` would take that side by
	 * default and stage a manifest that looks resolved while carrying another
	 * side's records. Both entry points refuse rather than resolve the wrong
	 * side; the author finishes the operation and re-derives afterwards. A clean
	 * checkout has no marker and falls through to the ordinary re-stamp.
	 */
	const operation = operationInProgress();
	if (operation !== null)
		throw new Error(
			`${operation} is in progress, and this tool resolves a MERGE only: while git is replaying a commit the sides it hands out are not "this branch" and "main" the way a merge's are, so a resolution now would take the wrong side without a word. Finish the ${operation} (resolving docs/evidence/manifest.json by hand if git stops on it), then run \`pnpm evidence:fold\` once it is done to re-derive the stamps over the result.`,
		);
	if (
		existsSync(join(gitDirPath(), "MERGE_HEAD")) ||
		git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]) !== null
	)
		return completeMerge({ dryRun });
	return restampAtHead({ dryRun, amend: !argv.includes("--no-amend") });
};

if (isEntryPoint(import.meta.url)) {
	const argv = process.argv.slice(2);
	try {
		process.exitCode = await main(argv);
	} catch (error) {
		console.error(`evidence-fold: ${error.message}`);
		/*
		 * A THROW INSIDE THE DRIVER IS STILL A NON-ZERO DRIVER EXIT, and git's
		 * output for it is the same four lines it prints for a refusal. Without this
		 * the fold's hardest failure - a crash while resolving under `git merge` -
		 * would be the one with no durable record at all.
		 */
		if (argv.includes("--driver"))
			console.error(
				`evidence-fold: this reason is recorded at ${recordDriverFailure(`FAILED during a driver run: ${error.message}`)}`,
			);
		process.exitCode = 1;
	}
}
