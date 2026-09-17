#!/usr/bin/env node
/**
 * Decide which CI jobs a diff can possibly affect, and run them locally.
 *
 * WHY THIS EXISTS
 * ---------------
 * `.github/workflows/ci.yml` used to run its whole job set on every pull
 * request: a one-line `docs/**` edit paid for a typecheck, a build, the
 * 108-file desktop suite and a two-runner pack + launch. That is the same
 * defect this repository already fixed twice at a smaller scale (`pnpm
 * lint:scripts`, `version-bump-guard`), one level up.
 *
 * The fix is not "run less on small PRs", which is unverifiable taste. It is a
 * *classifier* that answers one question per job: does anything in this diff
 * appear in what that job verifies? This module is that classifier, and it is
 * the SINGLE SOURCE OF TRUTH for both answers: `ci.yml`'s `changes` job exports
 * one output per flag from here, and `pnpm check-changed` runs the same module
 * to pick the local gates. A second, hand-written mapping in either place is
 * the defect this design exists to prevent (asserted by
 * `scripts/ci-scope.test.mjs`).
 *
 * This mirrors `scripts/ci_scope.py` in the backend repository
 * (`local-operator`), which landed the same design; the two repos share the
 * shape, the reasons and the assertion numbers.
 *
 * DESIGN RULES, AND WHY EACH ONE IS LOAD-BEARING
 * ----------------------------------------------
 * Fail OPEN, never closed. A path must *match* an inert rule to be skippable;
 * anything unrecognised counts as live (`categoryOf` returns `other`, and every
 * `other` path sets the code-suite flags). The opposite shape - a denylist of
 * code paths - goes green on the path nobody enumerated, which is exactly the
 * pathology `AGENTS.md` names: a guard nothing runs is indistinguishable from
 * no guard. Two independent fail-open layers exist: this module (which returns
 * every flag `true` when it cannot resolve a diff) and the workflow (every gate
 * reads `<flag> != 'false'`, so an output that was never written runs the job
 * rather than skipping it).
 *
 * Skipping must be LEGIBLE. `--summary` writes the base ref and its SHA, every
 * changed path with the category it got, every flag with its reason, and the
 * resulting run/skip job list into `$GITHUB_STEP_SUMMARY`. Without that, "the
 * PR was green" stops meaning anything, because a skipped guard leaves no
 * trace. A reviewer reads that summary and treats `skipped` as a claim to
 * check, not as a pass.
 *
 * NO INSTALL, AND NO RELATIVE IMPORTS BEYOND THE TWO NAMED BELOW. A classifier
 * that needs `pnpm install` goes red for reasons unrelated to classification -
 * the argument `scripts/version-bump-guard.mjs` already makes for itself - and
 * node builtins are the whole dependency set here. The `changes` job also runs
 * a COPY of this file from `$RUNNER_TEMP` (see `defaultRoot`), so every file
 * this one imports has to be copied beside it: `scripts/ci-scope.test.mjs`
 * derives this file's transitive relative-import closure and asserts the
 * workflow copies exactly that set, because a missing sibling makes the
 * classifier die before it writes a single output - and behind `!= 'false'`
 * that failure is SILENT, presenting as "every job ran" on every pull request
 * forever.
 *
 * INVOCATION
 * ----------
 * CI (`--github-output`/`--summary` are the Actions channel files)::
 *
 *   git show "$base:scripts/ci-scope.mjs" > "$RUNNER_TEMP/ci-scope.mjs"
 *   node "$RUNNER_TEMP/ci-scope.mjs" --event "$GITHUB_EVENT_NAME" --base "$base" \
 *     --root "$GITHUB_WORKSPACE" \
 *     --github-output "$GITHUB_OUTPUT" --summary "$GITHUB_STEP_SUMMARY"
 *
 * `--root` is passed EXPLICITLY by the workflow even though `defaultRoot`
 * resolves the repository on its own, and that redundancy is the point: the
 * step runs a copy of this file from outside the checkout, so a module that
 * trusted its own path would compute a directory that is inside no repository,
 * `git diff` would fail there, and the fail-open branch would set every flag
 * true on every pull request - correct classifier, dead gate. Two independent
 * fixes beat one clever default; see `defaultRoot` for the resolution order and
 * `scripts/ci-scope.test.mjs` for the test that drives the copy shape for real.
 *
 * Local (index + working tree + untracked, then run the selected gates)::
 *
 *   pnpm check-changed
 *
 * `--run` prints each job it will NOT run (see `LOCAL_EXCLUSIONS`) with the
 * reason, so a local green is never quietly narrower than it looks.
 *
 * Exit status is 0 for every classification outcome, including the fail-open
 * ones: this module's verdict is only "how much to run", and refusing would red
 * a PR for an infrastructure reason and teach people to route around the gate.
 * The two exceptions are a malformed flag value (the `$GITHUB_OUTPUT` writer
 * RAISES rather than emitting an empty string - see `flagValue`) and `--run`,
 * which reports the gates' own exit status.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";
import { newVersionFrom, versionLineChanges } from "./version-bump-guard.mjs";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
// One name per kind of path, produced by `categoryOf` with FIRST MATCH WINS in
// the order that function documents. The categories exist so the flag
// predicates can be written as set membership over *kinds* rather than as a
// second list of prefixes in each predicate - the drift that would otherwise
// let "is this a source change" and "does the desktop suite care" disagree.

/** Where the gating itself lives. Every flag is forced true (D14). */
const CAT_CI = "ci";

/**
 * Committed test fixtures under `docs/`. NOT inert, and this is the correction
 * that matters most in this repo's half of the design: several `test:desktop`
 * files read committed evidence at runtime - `evidence-manifest.test.mjs` reads
 * `docs/evidence/manifest.json`, `clear-search.test.mjs`,
 * `new-chat-row-evidence.test.mjs` and `evidence-run-guard.test.mjs` read their
 * own captured frames, and `chrome-keychain.test.mjs` walks the tree. Treating
 * `docs/**` as a whole as inert would stop running the desktop suite on a
 * change to that suite's own INPUT, which is a green PR that tested nothing.
 */
const CAT_EVIDENCE = "evidence";

/**
 * Prose. The one category no CI job reads: the 15 non-evidence `docs/` hits in
 * the desktop suite are comments (checked one by one) and root `*.md` appears
 * only as tmpdir fixtures (`capture-evidence.test.mjs`,
 * `check-scripts-lint.test.mjs`). `README.md` ships in the tarball, but no job
 * asserts anything about its content, so it stays inert.
 */
const CAT_DOCS = "docs";

/** `package.json`: what gets installed, and what the app declares. */
const CAT_MANIFEST = "manifest";

/** The install's resolved graph. */
const CAT_LOCK = "lock";

/** Anything not recognised: live, because unrecognised must fail open. */
const CAT_OTHER = "other";

/**
 * Every category `categoryOf` can return, in the order its table documents.
 * Exported for `scripts/ci-scope.test.mjs`, which proves the dependency
 * implication of A4 by evaluating `flagsFor` over every subset of these rather
 * than by comparing flag NAMES - `pack` and `lint` are different names for one
 * predicate, and only the predicate can answer whether a skipped dependency may
 * be treated as acceptable.
 */
export const CATEGORIES = [
	CAT_CI,
	CAT_EVIDENCE,
	CAT_DOCS,
	CAT_MANIFEST,
	CAT_LOCK,
	CAT_OTHER,
];

/** Inert: no job in `ci.yml` reads a path in these categories. */
const INERT_CATEGORIES = new Set([CAT_DOCS]);

/**
 * Not inert, but not a source change either: a *test input*. These set `unit`
 * (the desktop suite reads them) and nothing else - they are not compiled, not
 * linted by `pnpm lint`'s path list, and not packed into the tarball.
 */
const TEST_INPUT_CATEGORIES = new Set([CAT_EVIDENCE]);

const MANIFEST_PATHS = new Set(["package.json"]);
const LOCK_PATHS = new Set(["pnpm-lock.yaml", "pnpm-workspace.yaml"]);

/** `docs/evidence/**`, matched by prefix rather than by extension. */
const EVIDENCE_PREFIX = "docs/evidence/";

/**
 * The scripts the `runtime-deps` job's own step runs. Named so that a change to
 * either keeps that job selected: the check is the allowlist (`pnpm
 * check-runtime-deps`) executed through `scripts/require-report.sh` so a silent
 * success is refused rather than read as a pass, and a change to either the
 * allowlist or its wrapper is a change to what the job verifies.
 */
const RUNTIME_DEP_SCRIPTS = new Set([
	"scripts/check-runtime-deps.mjs",
	"scripts/require-report.sh",
]);

/**
 * A markdown file at the REPOSITORY ROOT only. `^[^/]+\.md$` - a markdown file
 * inside any other directory is live, because it lives next to code the gates
 * read and no other directory has an inertness argument recorded.
 */
const ROOT_MARKDOWN_RE = /^[^/]+\.md$/;

/**
 * The trees and files this table NAMES as live even though their category is
 * `other`, which is also the catch-all for "anything I did not enumerate".
 *
 * Why the distinction exists: `other` is BOTH the designed live bucket (`src/**`
 * and friends are `other` by the table) and the unknown-path harbour, so a
 * warning keyed on the category alone fires on essentially every real pull
 * request - and a warning that fires on `src/main/app.ts` trains people to
 * ignore the one that fires on a path nobody enumerated. The summary prints
 * every path with its category either way; `isNamedLivePath` is what separates
 * "we recognised this and ran the code suite" from "we did not recognise this,
 * so we ran the code suite anyway", and only the second earns a `::warning::`.
 *
 * Exported so `scripts/ci-scope.test.mjs` can assert every entry is still
 * categorised `other`: this list may only ever name LIVE paths, because an inert
 * path hidden here would be a skip nobody can see.
 */
export const KNOWN_LIVE_PREFIXES = [
	"src/",
	"bin/",
	"scripts/",
	"build/",
	"resources/",
];

/** The table's `tsconfig*.json`. */
export const KNOWN_LIVE_ROOT_RE = /^tsconfig[^/]*\.json$/;

/** The other root files the table names outright. */
export const KNOWN_LIVE_ROOT_FILES = new Set([
	"electron.vite.config.js",
	"biome.json",
]);

/**
 * Whether the category table NAMED this path's tree, rather than reaching its
 * answer through the `other` catch-all. See `KNOWN_LIVE_PREFIXES`.
 */
export function isNamedLivePath(path) {
	const p = normalise(path);
	return (
		KNOWN_LIVE_PREFIXES.some((prefix) => p.startsWith(prefix)) ||
		KNOWN_LIVE_ROOT_RE.test(p) ||
		KNOWN_LIVE_ROOT_FILES.has(p)
	);
}

/**
 * The repo-relative POSIX form of a path from git.
 *
 * `git diff --name-status` reports forward slashes on every platform, but a
 * caller can hand us a backslash; normalising here means the prefix rules
 * cannot silently miss.
 */
function normalise(path) {
	const trimmed = String(path ?? "")
		.replace(/\\/g, "/")
		.trim();
	// Only an exact leading `./` is stripped: `replace(/^[./]+/, "")` would eat
	// the dot of `.github/workflows/ci.yml` and drop the whole diff to `other`.
	return trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
}

/**
 * Classify one repo-relative path. FIRST MATCH WINS, and the order is the
 * contract rather than an implementation detail: `docs/evidence/x.md` must
 * reach the evidence branch before the inert `docs` one, and `.github/**` must
 * outrank everything because it is where the gating lives.
 */
export function categoryOf(path) {
	const p = normalise(path);
	if (!p) return CAT_OTHER;
	if (p === ".github" || p.startsWith(".github/")) return CAT_CI;
	if (p === "docs/evidence" || p.startsWith(EVIDENCE_PREFIX))
		return CAT_EVIDENCE;
	if (p.startsWith("docs/")) return CAT_DOCS;
	if (ROOT_MARKDOWN_RE.test(p)) return CAT_DOCS;
	if (MANIFEST_PATHS.has(p)) return CAT_MANIFEST;
	if (LOCK_PATHS.has(p)) return CAT_LOCK;
	return CAT_OTHER;
}

// ---------------------------------------------------------------------------
// Flags, the jobs they gate, and the local commands those jobs run
// ---------------------------------------------------------------------------

/**
 * The outputs the `changes` job exports, in the order they are written to
 * `$GITHUB_OUTPUT` and listed in the summary. `scripts/ci-scope.test.mjs`
 * asserts this set equals the `changes` job's `outputs:` keys, so a flag added
 * here and nowhere else fails rather than silently never gating anything.
 */
export const FLAGS = ["lint", "types", "unit", "runtime_deps", "audit", "pack"];

/**
 * job id in `ci.yml` -> the flags that gate it, in `ci.yml` job order (which is
 * also the order the summary prints). Every flag here must be one of `FLAGS`
 * and the job's `if:` must read each of them (asserted A1).
 *
 * `version-bump-guard` is deliberately absent: it is a job of its own workflow
 * (`version-bump-guard.yml`), gated on the EVENT rather than on a scope flag,
 * so that a PR cannot influence whether the guard that reads its own version
 * line runs. It is not part of this workflow's job set.
 */
export const JOB_FLAGS = {
	lint: ["lint"],
	"runtime-deps": ["runtime_deps"],
	"check-types": ["types"],
	test: ["unit"],
	audit: ["audit"],
	"npx-sanity-check": ["pack"],
};

/**
 * Jobs in `ci.yml` that take no scope flag, each with the reason. Everything in
 * `ci.yml` is either here or in `JOB_FLAGS`; a job in neither is a job that
 * pays full price unnoticed (asserted A1).
 */
export const UNGATED_JOBS = {
	changes:
		"always runs: it IS the classifier, and every gated job `needs:` it, so an " +
		"event condition here would collaterally skip the whole workflow on a push " +
		"to `main` (D7). The event-conditional behaviour lives inside this module, " +
		"which returns every flag true for anything that is not a `pull_request`.",
};

/**
 * Dependency pairs that may use the PERMISSIVE clause
 * (`needs.D.result == 'success' || needs.D.result == 'skipped'`) instead of the
 * strict `needs.D.result == 'success'`.
 *
 * The invariant `scripts/ci-scope.test.mjs` enforces (A4): for each
 * `(job, dependency)` pair, either this module guarantees
 * `types(job) => types(dependency)` - then the strict clause is required, and
 * the pair must NOT appear here - or the pair is listed here WITH A NON-EMPTY
 * REASON, and the workflow must use the permissive clause. Without that, a
 * deliberately skipped cheap gate silently skips the expensive job it guards.
 *
 * `npx-sanity-check` needs `lint` and `check-types` strictly (both are set by
 * every `pack`-setting diff, since `pack`, `lint` and `types` share one
 * predicate) and `audit` permissively: a `src/**` change must run the pack and
 * macOS-launch legs without paying for an audit of a lockfile that did not
 * move, and an audit that was deliberately SKIPPED carries no signal about
 * whether the tarball launches. A FAILED audit still blocks the pack.
 */
export const PERMISSIVE_DEPS = [
	{
		job: "npx-sanity-check",
		dependency: "audit",
		reason:
			"`audit` is set by `package.json` and the lockfile, `pack` by every source " +
			"change: requiring `success` here would run a registry audit on every " +
			"`src/**` change for no signal about the tarball, and would let a failed " +
			"audit block a pack that is otherwise clean. A failed audit still blocks.",
	},
];

/**
 * job id -> the commands a developer runs for that job, in CI order. These are
 * real local spellings: the `<job>` steps in `ci.yml` are the same commands, so
 * a developer's run and CI's run cannot drift into two opinions (A11 compares
 * this table against the workflow's `run:` blocks).
 */
export const JOB_COMMANDS = {
	lint: ["pnpm lint", "pnpm lint:scripts"],
	"runtime-deps": [
		// The CI spelling, wrapper and all, because the wrapper is part of what the
		// job verifies: `require-report.sh` refuses to read a silent success as a
		// pass, and a local spelling that skipped it would be a weaker check than
		// the one that gates the merge.
		'bash scripts/require-report.sh "Runtime dependency allowlist" node scripts/check-runtime-deps.mjs',
	],
	"check-types": [
		"pnpm check-types",
		"pnpm check-edit-diffs",
		// The release-contract step of that job, as one plain run and two
		// `node --test` invocations, in the order ci.yml runs them.
		// `ci-scope.test.mjs` rides in the first list so this classifier's own
		// assertions CANNOT stop running: a suite that leaves the job list and is
		// not noticed is the "guard nothing runs" defect this change is about.
		"node scripts/test-validate-release.mjs",
		"node --test scripts/test-release-safety.mjs scripts/test-publish-workflow.mjs scripts/test-version-bump-guard.mjs scripts/ci-scope.test.mjs",
		"node --test scripts/release-baseline.test.mjs scripts/release-candidate.test.mjs scripts/entry-point.test.mjs scripts/require-report.test.mjs",
		'bash scripts/require-report.sh "Build environment contracts" node scripts/check-build-env.mjs',
	],
	test: ["pnpm test:desktop"],
};

/**
 * Jobs in `JOB_FLAGS` that deliberately have no local spelling, each with the
 * reason it cannot be one. `--run` prints these, so a local green is never
 * quietly narrower than it looks.
 */
export const LOCAL_EXCLUSIONS = {
	audit:
		"no faithful local spelling. CI reads the critical-severity COUNT out of " +
		"`pnpm audit --json` and tolerates every other advisory; a bare local " +
		"`pnpm audit` exits non-zero on any advisory, so it would red " +
		"`check-changed` for findings the job deliberately allows, and it needs " +
		"the npm registry (offline would be a second false red). Excluded rather " +
		"than kept as a gate that cries wolf; the audit stays a CI check and the " +
		"classifier cannot skip it on any manifest or lockfile diff.",
	"npx-sanity-check":
		"it packs the npm-channel tarball and LAUNCHES it. The pack needs the four " +
		"`VITE_*` build secrets the vite plugin refuses to build without, and the " +
		"launch leg installs the tarball through `npx` on a macOS runner. Neither " +
		"belongs in a default local pass; `pnpm pack` and `node " +
		"scripts/npx-smoke-test.mjs <tarball>` remain the manual spellings.",
};

/**
 * Human-readable predicate per flag, written into the summary so the reason a
 * job ran - or did not - is recorded where a reviewer reads it (D13).
 */
export const FLAG_REASONS = {
	lint: "a changed path that is neither prose nor committed evidence",
	types: "a changed path that is neither prose nor committed evidence",
	unit: "a changed path that is neither prose nor committed evidence, or a `docs/evidence/**` change (the desktop suite reads committed evidence at runtime)",
	runtime_deps:
		"`package.json` or one of the scripts the runtime-dependency step executes (`scripts/check-runtime-deps.mjs`, `scripts/require-report.sh`)",
	audit: "`package.json` or a lockfile change",
	pack: "a changed path that is neither prose nor committed evidence",
};

/** A flag could not be rendered as `true`/`false`. See `flagValue`. */
export class ScopeError extends Error {}

/**
 * Render one flag for `$GITHUB_OUTPUT`; RAISE on anything but a boolean.
 *
 * Raised rather than degraded, deliberately: an output that was never written
 * read by `!= 'false'` still RUNS the job, so the fail-open direction is
 * covered - but an empty or malformed line in the Actions UI is
 * indistinguishable from a classifier that never ran, and this whole design
 * exists to remove "a green PR that silently ran nothing". A decision that
 * cannot be rendered is a bug in this module, not a scope verdict.
 */
export function flagValue(flag, flags) {
	const value = flags[flag];
	if (value === true) return "true";
	if (value === false) return "false";
	throw new ScopeError(
		`flag '${flag}' rendered as ${JSON.stringify(value)}; only true/false may reach $GITHUB_OUTPUT (an unknown or empty value is not a scope decision)`,
	);
}

// ---------------------------------------------------------------------------
// release_bump: a version-only `package.json` edit
// ---------------------------------------------------------------------------

/** The `+`/`-` body lines of a unified diff, with the file headers removed. */
function diffBodyLines(diff) {
	const removed = [];
	const added = [];
	for (const line of String(diff).split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added.push(line.slice(1));
		else if (line.startsWith("-")) removed.push(line.slice(1));
	}
	return { removed, added };
}

/**
 * True when the change is nothing but a version bump in `package.json`.
 *
 * `diff` is the unified diff of `package.json` ALONE (what
 * `git diff <base> [HEAD] -- package.json` produces). Passing a whole-repo diff
 * is safe - the other files' `+`/`-` lines make this return false - it simply
 * will not detect a bump.
 *
 * The test is the LINE PAIR, not the file: a dependency, metadata or
 * `scripts`-section edit in the same file must keep the whole job set, because
 * it changes what gets installed. Matching on the filename alone is how a
 * dependency edit would silently drop the audit and the suite from the PR that
 * changed the install.
 *
 * The line shape is NOT re-derived here: `versionLineChanges` is imported from
 * `scripts/version-bump-guard.mjs`, which is the same definition the guard
 * fails a PR with, so "is this a version line" cannot come to mean two things.
 * The reuse is also why this module has relative imports at all - see the
 * header on the `$RUNNER_TEMP` copy.
 */
export function isReleaseBump(paths, diff) {
	const unique = [...new Set(paths.map(normalise))];
	if (unique.length !== MANIFEST_PATHS.size) return false;
	if (!unique.every((path) => MANIFEST_PATHS.has(path))) return false;
	if (!diff) return false;
	const { removed, added } = diffBodyLines(diff);
	if (removed.length === 0 || added.length === 0) return false;
	// Every single body line has to be a version line; the guard's own filter is
	// what decides that, so a `"version":`-shaped edit the guard would not
	// recognise is not a bump here either.
	return versionLineChanges(diff).length === removed.length + added.length;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Every flag at one value, plus the non-output `release_bump` classification. */
function allFlags(value) {
	const flags = {};
	for (const flag of FLAGS) flags[flag] = value;
	flags.release_bump = false;
	return flags;
}

/**
 * The flag vector for a set of categories. Split out so the tests can pin a
 * predicate without constructing a diff.
 *
 * `live` is "a path that is neither prose nor committed evidence": those are
 * the only two kinds nothing in this job set compiles, types, runs or packs.
 * Widening is the fail-closed direction here, and it is what keeps the D8a
 * implication `pack => lint, types` true by construction rather than by
 * inspection - one predicate, three flags.
 */
export function flagsFor(categories, paths, releaseBump) {
	const cats = new Set(categories);
	const pathSet = new Set([...paths].map(normalise));

	// D14, as an explicit override rather than a derived category: a diff that
	// touches the workflow that does the gating must not be able to narrow
	// itself, and `.github/**` is also where every other workflow's trigger set
	// lives (`check-build-env.mjs` reads them at runtime).
	if (cats.has(CAT_CI)) return allFlags(true);

	// A version-only bump has exactly one thing to check, and it is not here:
	// the `version-bump-guard` job, which is gated on the event and therefore
	// cannot be narrowed by this classification. Every other flag is false, so
	// the job list says so out loud instead of implying a matrix ran.
	if (releaseBump) return allFlags(false);

	const live = [...cats].some(
		(cat) => !INERT_CATEGORIES.has(cat) && !TEST_INPUT_CATEGORIES.has(cat),
	);
	const unit = [...cats].some((cat) => !INERT_CATEGORIES.has(cat));
	const manifest = cats.has(CAT_MANIFEST);

	return {
		lint: live,
		types: live,
		unit,
		runtime_deps:
			manifest || [...pathSet].some((path) => RUNTIME_DEP_SCRIPTS.has(path)),
		audit: manifest || cats.has(CAT_LOCK),
		pack: live,
		release_bump: false,
	};
}

/**
 * Whether `job` may treat a SKIPPED `dependency` as acceptable (A4).
 *
 * For every other `(job, dependency)` pair this module must guarantee
 * `types(job) => types(dependency)`, so a skipped dependency means the
 * dependency was not needed in the first place.
 */
export function isPermissiveDependency(job, dependency) {
	return PERMISSIVE_DEPS.some(
		(pair) => pair.job === job && pair.dependency === dependency,
	);
}

/**
 * Flag vector for a change set.
 *
 * `paths` are repo-relative changed paths, BOTH SIDES of a rename - a rename
 * OUT of the inert set into source must set the code flags, so classifying only
 * the new path is a defect. `diff` is the `package.json` diff, used only to
 * refine the manifest category into `release_bump`.
 *
 * The returned mapping also carries `release_bump`, which is not a CI output
 * (nothing in this workflow's job set is gated on it) but is the classification
 * the summary prints, and is what "a bump PR runs only the guard" refers to.
 */
export function classify(paths, diff) {
	const norm = paths.map(normalise);
	const releaseBump = isReleaseBump(norm, diff);
	const flags = flagsFor(norm.map(categoryOf), norm, releaseBump);
	// Carried through for the summary only; `allFlags` clears it on the
	// fail-open paths, where no classification was attempted.
	flags.release_bump = releaseBump;
	return flags;
}

/** `(path, category)` pairs, in the order given, for the summary. */
export function categoriesOf(paths) {
	return paths.map((path) => [path, categoryOf(path)]);
}

// ---------------------------------------------------------------------------
// Git plumbing
// ---------------------------------------------------------------------------

/** Run git and keep its output apart from our own report. */
function git(args, cwd) {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return {
		status: result.error ? null : result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		error: result.error ?? null,
	};
}

/**
 * The merge base of `rev` and HEAD, falling back to `rev` itself.
 *
 * `--since origin/main` is how a developer thinks about it, and the merge base
 * is what makes the answer "this branch's own work" rather than "everything the
 * base has done since they diverged". `--since <sha>` (an already resolved
 * base) round-trips: the merge base of an ancestor and HEAD is that ancestor.
 *
 * `null` means git could not answer at all, which the caller must not read as
 * either "no changes" or "everything changed".
 */
export function resolveBase(rev, cwd) {
	let result = git(["merge-base", rev, "HEAD"], cwd);
	if (result.status === 0 && result.stdout.trim()) {
		return result.stdout.trim().split("\n")[0].trim();
	}
	result = git(["rev-parse", "--verify", `${rev}^{commit}`], cwd);
	if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
	return null;
}

/**
 * Changed paths from `git diff --name-status`, BOTH sides of a rename.
 *
 * A rename out of the inert set is the case this exists for: `R100 docs/a.md
 * src/a.ts` is a change to source, and dropping the old path would let a diff
 * that MOVED code be classified on its destination alone.
 */
export function parseNameStatus(stdout) {
	const paths = [];
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		const fields = line.split("\t");
		const status = fields[0] ?? "";
		if (status.startsWith("R") || status.startsWith("C")) {
			for (const path of fields.slice(1, 3)) {
				if (path) paths.push(normalise(path));
			}
		} else if (fields.length > 1) {
			paths.push(normalise(fields[1]));
		}
	}
	return paths;
}

/**
 * Changed paths between `base` and HEAD (CI) or the working tree (local).
 *
 * Returns `null` when git itself failed, which the caller turns into the
 * fail-open path rather than into an empty - and therefore all-skipping -
 * change set.
 */
export function collectPaths(base, local, cwd) {
	const target = local ? [] : ["HEAD"];
	const diffed = git(["diff", "--name-status", "-M", base, ...target], cwd);
	if (diffed.status !== 0) return null;
	const paths = parseNameStatus(diffed.stdout);
	if (local) {
		// Untracked files are changes a local gate must see (a new source file
		// nobody staged still has to be linted, typed and packed) and are
		// invisible to `git diff`.
		const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd);
		if (untracked.status !== 0) return null;
		for (const path of untracked.stdout.split("\n")) {
			if (path.trim()) paths.push(normalise(path));
		}
	}
	// De-duplicate but keep first-seen order so the summary reads stably.
	return [...new Set(paths.filter(Boolean))];
}

/** The `package.json` diff, or `null` when git failed (fail open). */
export function manifestDiff(base, local, cwd) {
	const target = local ? [] : ["HEAD"];
	const result = git(["diff", base, ...target, "--", "package.json"], cwd);
	if (result.status !== 0) return null;
	return result.stdout;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** An Actions annotation, plus the same text on stderr for a local run. */
function warn(message, title) {
	process.stdout.write(`::warning title=${title}::${message}\n`);
	process.stderr.write(`warning: ${message}\n`);
}

/**
 * job id -> 'run' | 'skip' for the whole workflow, in `ci.yml` order.
 *
 * Every gated job is gated on all of its flags, so a job with two flags runs
 * only when both are true. Nothing in this workflow inherits a skip: each
 * gated job's `if:` carries its own `!cancelled()` and its own result clauses,
 * so a skipped `lint` cannot silently skip `npx-sanity-check`.
 */
export function jobPlan(flags) {
	const plan = {};
	for (const job of Object.keys(UNGATED_JOBS)) plan[job] = "run";
	for (const [job, jobFlags] of Object.entries(JOB_FLAGS)) {
		plan[job] = jobFlags.every((flag) => flags[flag]) ? "run" : "skip";
	}
	return plan;
}

/** The `$GITHUB_STEP_SUMMARY` body (D13). */
export function summaryLines({ event, base, baseLabel, paths, flags, note }) {
	const lines = [
		"## Change classification",
		"",
		`- event: \`${event}\``,
		`- diff base: \`${baseLabel}\`${base ? ` (\`${base}\`)` : ""}`,
	];
	if (note) lines.push(`- **${note}**`);
	lines.push("", `### Changed paths (${paths.length})`, "");
	if (paths.length) {
		for (const [path, category] of categoriesOf(paths)) {
			lines.push(`- \`${path}\` -> \`${category}\``);
		}
	} else {
		lines.push("- (none)");
	}
	lines.push("", "### Flags", "");
	for (const flag of FLAGS) {
		const value = flags[flag] ? "true" : "false";
		lines.push(`- \`${flag}\` = **${value}** — ${FLAG_REASONS[flag]}`);
	}
	const releaseBump = Boolean(flags.release_bump);
	const releaseBumpWhy = releaseBump
		? "the diff is nothing but the `version` line pair in `package.json`, so `version-bump-guard` and this job are the only checks that have anything to read"
		: "this is not a version-only `package.json` diff, so the manifest keeps every gate a manifest change earns";
	lines.push(
		`- \`release_bump\` = **${releaseBump ? "true" : "false"}** — ${releaseBumpWhy}`,
	);
	lines.push("", "### Jobs", "");
	for (const [job, verdict] of Object.entries(jobPlan(flags))) {
		const why = UNGATED_JOBS[job]
			? UNGATED_JOBS[job]
			: JOB_FLAGS[job]
					.map((flag) => `${flag}=${flags[flag] ? "true" : "false"}`)
					.join(", ");
		lines.push(`- \`${job}\`: **${verdict}** — ${why}`);
	}
	lines.push("");
	lines.push(
		"A skipped job is a CLAIM, not a pass: read the flag rows above before " +
			"treating this run as evidence, and treat a skip a reviewer cannot " +
			"justify as a finding.",
	);
	return lines;
}

// ---------------------------------------------------------------------------
// Local execution
// ---------------------------------------------------------------------------

/** Run each selected job's local commands in order; return a shell status. */
export function runJobs(jobs, root) {
	const failures = [];
	for (const job of jobs) {
		for (const command of JOB_COMMANDS[job]) {
			process.stdout.write(`\n=== ${job}: ${command}\n`);
			const result = spawnSync(command, {
				shell: true,
				cwd: root,
				encoding: "utf8",
				stdio: "inherit",
			});
			if (result.status !== 0) {
				process.stdout.write(
					`!!! ${job} failed (rc=${result.status}): ${command}\n`,
				);
				failures.push(`${job}: ${command} (rc=${result.status})`);
			}
		}
	}
	process.stdout.write("\n");
	if (failures.length) {
		process.stdout.write(`${failures.length} command(s) failed:\n`);
		for (const failure of failures) {
			process.stdout.write(`  - ${failure}\n`);
		}
		return 1;
	}
	process.stdout.write("all selected gates passed\n");
	return 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * The repository to classify, resolved WITHOUT trusting where this file is.
 *
 * `dirname(fileURLToPath(import.meta.url))/..` is the tempting default and it
 * is wrong in exactly the place that matters: the `changes` step copies this
 * file (and its two siblings) to `$RUNNER_TEMP` and runs the COPY, so the
 * file's directory is `$RUNNER_TEMP` - inside no repository at all. `root` is
 * also the `cwd` of every git call, so that default makes `git diff` fail and
 * the fail-open branch set every flag true on every pull request: the
 * classifier is right and never engages. Nothing in a green CI run would have
 * revealed it; the backend repository's first version of this file shipped
 * exactly that defect and its own run passed every assertion while dead.
 *
 * So, in order: the git top level of the INVOCATION directory (the workflow
 * step runs with the workspace as its cwd), then the tree this file was shipped
 * inside, then the invocation directory. The CI step ALSO passes
 * `--root "$GITHUB_WORKSPACE"` explicitly, deliberately belt-and-braces: that
 * flag is what makes the workflow independent of this function's cleverness.
 */
export function defaultRoot(moduleFile, cwd = process.cwd()) {
	const fromCaller = git(["rev-parse", "--show-toplevel"], cwd);
	if (fromCaller.status === 0 && fromCaller.stdout.trim()) {
		return resolve(fromCaller.stdout.trim());
	}
	const shipped = resolve(moduleFile, "..", "..");
	const fromShipped = git(["rev-parse", "--show-toplevel"], shipped);
	if (fromShipped.status === 0 && fromShipped.stdout.trim()) {
		return resolve(fromShipped.stdout.trim());
	}
	return resolve(cwd);
}

/**
 * The Actions event name, or `null` when this is a LOCAL run.
 *
 * The distinction is load-bearing rather than cosmetic. "Every flag true" is
 * the answer for a real CI EVENT that is not a pull request (a push to `main`
 * must stay an unconditional full run: it is the safety net for the narrowed PR
 * matrix, and the one place a misclassification is ever contradicted). A local
 * `pnpm check-changed` has NO event and must classify; treating "not
 * pull_request" as the local default would make the local command a slower
 * spelling of "run everything", which is the defect this module exists to
 * remove.
 */
function githubEvent(args) {
	if (args.event) return args.event;
	const fromEnv = process.env.GITHUB_EVENT_NAME;
	return fromEnv ? fromEnv : null;
}

const USAGE = `usage: node scripts/ci-scope.mjs [options]

  --event <name>       the Actions event ($GITHUB_EVENT_NAME). Anything other than
                       \`pull_request\` runs every job: a push to \`main\` must stay an
                       unconditional full run, and it is the safety net for the
                       narrowed pull-request matrix.
  --base <sha>         CI: the EXACT diff base (the workflow passes HEAD^1). Diffed
                       against HEAD only.
  --since <ref>        local: a base ref (e.g. origin/main) resolved to its merge
                       base with HEAD; the diff includes the index, the working tree
                       and untracked files. \`pnpm check-changed\` uses this.
  --all                skip classification: every flag true. The fallback when no
                       classifier exists at the base revision.
  --root <dir>         repo root to inspect / run in. Passed explicitly by the
                       workflow; without it the root is resolved from the
                       invocation directory (see defaultRoot).
  --github-output <f>  write \`flag=value\` lines here ($GITHUB_OUTPUT).
  --summary <f>        append the human-readable report here ($GITHUB_STEP_SUMMARY).
  --run                run the local commands of every selected job.
  --verbose            print how the root, the shape and the base were resolved, to
                       stderr. The diagnostic for the copied-module shape.
  -h, --help           this text.`;

function parseArguments(argv) {
	const options = {
		event: "",
		base: "",
		since: "",
		all: false,
		root: "",
		githubOutput: "",
		summary: "",
		run: false,
		verbose: false,
		help: false,
	};
	const named = {
		"--event": "event",
		"--base": "base",
		"--since": "since",
		"--root": "root",
		"--github-output": "githubOutput",
		"--summary": "summary",
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			options.help = true;
			continue;
		}
		if (
			argument === "--all" ||
			argument === "--run" ||
			argument === "--verbose"
		) {
			options[argument.slice(2).replace(/-/g, "")] = true;
			continue;
		}
		const equals = argument.indexOf("=");
		const flag = equals === -1 ? argument : argument.slice(0, equals);
		if (flag in named) {
			const value =
				equals === -1 ? (argv[index + 1] ?? "") : argument.slice(equals + 1);
			if (equals === -1) index += 1;
			if (!value) throw new Error(`'${flag}' needs a value\n\n${USAGE}`);
			options[named[flag]] = value;
			continue;
		}
		throw new Error(`unknown argument '${argument}'\n\n${USAGE}`);
	}
	return options;
}

export function main(argv = process.argv.slice(2)) {
	const args = parseArguments(argv);
	if (args.help) {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}

	const root = args.root
		? resolve(args.root)
		: defaultRoot(fileURLToPath(import.meta.url));
	const ciEvent = githubEvent(args);
	const event = ciEvent ?? "local";

	let note = null;
	let base = null;
	let baseLabel = "(none)";
	let paths = [];
	let flags;
	// Which branch decided the flags. Reported by `--verbose`, because from the
	// outside "every flag true" and "classified correctly" look identical - which
	// is what made the copied-module defect invisible in the backend repository.
	let branch;

	if (args.all) {
		branch = "--all";
		flags = allFlags(true);
		note = "`--all`: every job runs (classification not attempted)";
	} else if (ciEvent !== null && ciEvent !== "pull_request") {
		branch = `event(${event})`;
		flags = allFlags(true);
		baseLabel = "(not read: every job runs for this event)";
		note = `event \`${event}\` is not a \`pull_request\`: every job runs. \`main\` is the safety net for the narrowed pull-request matrix, so its run stays unconditional.`;
	} else {
		const rev = args.base || args.since;
		if (!rev) {
			branch = "no-base";
			flags = allFlags(true);
			note = "no `--base`/`--since` given: every job runs";
			warn(
				"no diff base was given, so this diff cannot be classified. Running " +
					"every job rather than guessing.",
				"Change classification unavailable",
			);
		} else {
			baseLabel = rev;
			base = resolveBase(rev, root);
			if (base === null) {
				branch = "unresolvable-base";
				flags = allFlags(true);
				note = `base \`${rev}\` could not be resolved: every job runs`;
				warn(
					`the diff base \`${rev}\` could not be resolved, so this diff cannot be classified. Running every job rather than guessing.`,
					"Change classification unavailable",
				);
			} else {
				// `--base` is the CI shape and already names the exact revision the
				// checkout was built on, so the diff stops at HEAD. `--since` is the
				// local shape and must see the index, the working tree and untracked
				// files, which is what makes `pnpm check-changed` useful before a
				// commit exists.
				const local = !args.base;
				branch = local ? "local(--since)" : "ci(--base)";
				const collected = collectPaths(base, local, root);
				const diff =
					collected === null ? null : manifestDiff(base, local, root);
				if (collected === null || diff === null) {
					branch = "git-diff-failed";
					flags = allFlags(true);
					note = "`git diff` failed: every job runs";
					warn(
						"`git diff` failed, so this diff cannot be classified. Running every " +
							"job rather than guessing.",
						"Change classification unavailable",
					);
				} else {
					paths = collected;
					flags = classify(paths, diff);
					// Only a path the table does NOT name is worth an annotation. `other`
					// is this table's deliberate live bucket, so keying the warning on it
					// alone would fire on every `src/**` diff and teach people to skip
					// the warning that matters. See `KNOWN_LIVE_PREFIXES`.
					const unrecognised = paths.filter(
						(path) => categoryOf(path) === CAT_OTHER && !isNamedLivePath(path),
					);
					if (unrecognised.length) {
						warn(
							`this diff contains ${unrecognised.length} path(s) the category table does not name, so every code-suite job runs: ${unrecognised.join(", ")}`,
							"Path outside the category table",
						);
					}
				}
			}
		}
	}

	if (args.verbose) {
		process.stderr.write(
			`ci-scope: root=${root} event=${event} branch=${branch} module=${fileURLToPath(import.meta.url)}\n`,
		);
	}

	const text = summaryLines({
		event,
		base,
		baseLabel,
		paths,
		flags,
		note,
	}).join("\n");
	// The report goes to the LOG unconditionally and to the step summary as well
	// when `--summary` is given. Both, because the summary is what a reviewer is
	// told to read and the log is where anyone debugging a run actually looks.
	process.stdout.write(`${text}\n`);
	if (args.summary) appendFileSync(args.summary, `${text}\n`, "utf8");

	if (args.githubOutput) {
		let body = "";
		for (const flag of FLAGS) {
			// Rendered by a function that RAISES rather than emitting an empty
			// string: an output that was never written still runs the job, but a
			// malformed one is not a decision at all.
			body += `${flag}=${flagValue(flag, flags)}\n`;
		}
		appendFileSync(args.githubOutput, body, "utf8");
	}

	if (args.run) {
		const plan = jobPlan(flags);
		const selected = Object.entries(plan)
			.filter(([job, verdict]) => verdict === "run" && job in JOB_COMMANDS)
			.map(([job]) => job);
		for (const [job, reason] of Object.entries(LOCAL_EXCLUSIONS)) {
			process.stdout.write(`not run locally: ${job} — ${reason}\n`);
		}
		return runJobs(selected, root);
	}
	return 0;
}

if (isEntryPoint(import.meta.url)) {
	process.exit(main());
}
