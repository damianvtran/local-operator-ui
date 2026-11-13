/* Permanent assembled-app evidence producer, run by the EXISTING macOS NPX job.
 * Local source tests never invoke main(). Both cases use stock Electron/main,
 * preload, renderer, HTTP transport, ChatLayout handlers and real store writers.
 * Only the backend's synthetic HTTP data is a fixture; no injected UI/bridge.
 */
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ASK_SESSION_IDS, startAsksAppFixture } from "./asks-app-fixture.mjs";
import { isEntryPoint } from "./entry-point.mjs";
import {
	modelUncertaintyCase,
	runOwnedModelCase,
	startModelBackend,
	verifyModelBuild,
} from "./model-uncertainty-native.mjs";
const execute = promisify(execFile);
// Hosted macOS arm64 has 7 GB RAM, but Node 22 defaults this isolated builder
// to ~2 GB: run 39671897399 aborted in control-renderer chunk generation at
// that V8 limit. Bound only this serial build to 4 GiB; global NODE_OPTIONS
// would also enlarge Electron/fixture processes and defeat their own budgets.
// This is a V8 heap allowance, not a replacement for process-group ceilings.
export const CONTROL_BUILD_NODE_ARGS = [
	"--max-old-space-size=4096",
	"--input-type=module",
];
/**
 * The pristine revision the control leg renders: the BASE THE CANDIDATE WAS BUILT
 * FROM, resolved per run rather than fixed at one commit.
 *
 * WHY IT IS DERIVED. The control exists so its frames differ from the candidate's
 * for one reason only - the change under test - which requires the two legs to
 * share main, preload, the vite config and the lockfile BYTE FOR BYTE. A pinned
 * historical commit stops being able to satisfy that the moment `main` moves: the
 * pinned tree's `src/main` is then older than the merged head's, `prepareControl`'s
 * identity assertion fails, and the producer dies before it renders anything.
 * Measured on run 38916579072: `control reuse mismatch src/main`, actual
 * `adc7fdcc6` against the pinned `2461cfa3f3`.
 *
 * WHY THE MERGE-BASE IS THE RIGHT DERIVATION. In CI this job checks out GitHub's
 * RECOMPUTED `refs/pull/N/merge`, whose first parent is `main` as of that run, and
 * `git merge-base origin/main HEAD` resolves to that same commit here. The candidate
 * is a descendant of it. When this branch touches none of the four reused parts
 * (`CONTROL_REUSE_PARTS`, proved by the property test) the byte-identity assertion
 * holds and main/preload are reused. When it DOES touch main, preload or the vite
 * config, the control builds its own main/preload from its own source instead
 * (`controlReusePlan`); a differing lockfile installs the control's own dependencies
 * from its own lockfile. The identical case is not weakened - the rebuild is the
 * branch for a change that has to differ.
 *
 * WHAT IS LOST, STATED PLAINLY. A pinned commit let the control be any historical
 * revision at all, including one whose renderer predates this line of work. The
 * merge-base gives up that freedom: the control is instead "main as merged into this
 * PR", which is exactly the baseline the change must be judged against, and the one
 * a reviewer can reproduce with one git command. `ASKS_CONTROL_PINNED` keeps the
 * historical revision that the branch's own first scenes were captured against, for
 * the provenance record rather than for the boot.
 */
export const ASKS_CONTROL_PINNED = "2461cfa3f3beaa1124727a9de93dfe01c4381b0d";

/**
 * The single fetch `resolveAsksControl` may make, bounded so a stalled or slow
 * remote degrades to the pinned revision instead of hanging the producer. It is a
 * FALLBACK on a path that must also work offline, never a requirement.
 *
 * WHERE THE NUMBER COMES FROM. MEASURED: `spawnSync`'s timeout is enforced on the
 * process group, not decorative - a 1000 ms cap returned at 1003 ms with `ETIMEDOUT`
 * even with a grandchild holding the inherited stdout pipe (review round 1), so this
 * bound really does end the fetch. CHOSEN, NOT MEASURED: 20 s. One ref at depth 1 on a
 * warm runner is seconds, and an optional fallback must stay far below the step's own
 * timeout rather than consume a macOS leg; there is no distribution of real fetch
 * times behind the exact value, so it is a policy ceiling and says so.
 */
const CONTROL_FETCH_TIMEOUT_MS = 20000;

/**
 * The control revision this run will boot, derived in an EXPLICIT order where every
 * branch is named in the log - including the degraded one.
 *
 * WHY THE PROBE AND NOT A TRY/CATCH. `git()` is `execFileSync`, which throws on git's
 * non-zero exit, and the catch here used to turn that into the pin. Two consequences,
 * both measured: (1) `execFileSync` INHERITS stderr, so a shallow checkout still
 * printed `fatal: Not a valid object name origin/main` into the CI log while the run
 * went on to succeed - run 42509070327 (job 128818578250, GREEN, 18:26:05Z) and run
 * 42512944112 (job 128830450208, RED, 19:14:16Z) both carry that exact line, so it is
 * a log defect and NOT what fails a step; (2) the degraded pin was swapped in
 * SILENTLY, so nothing in the log said which baseline was compared against. Asking
 * `rev-parse --verify --quiet` makes absence an ANSWER (exit 1, no output) instead of
 * an exception, and every branch below reports itself.
 *
 * WHY THE MERGE PARENT COMES BEFORE ANY FETCH. In CI this job checks out GitHub's
 * recomputed `refs/pull/N/merge`, and THAT COMMIT'S FIRST PARENT is main as of the
 * run - the base the candidate was built from, and the one baseline a fork PR cannot
 * mislead: on a fork PR the remote's `main` is the FORK's, which is why the sibling
 * asks step in ci.yml derives `HEAD^1` rather than consulting `origin/main`. Same rule
 * here, no network.
 *
 * WHY THAT PARENT IS NOT A PROPERTY OF THE CHECKOUT, AND WHAT SUPPLIES IT. This branch
 * does NOT fire on the raw checkout. MEASURED here: a depth-1 fetch of a merge commit
 * leaves BOTH parents unresolvable (`HEAD^1` and `HEAD^2` absent, `.git/shallow`
 * naming the merge commit), which is what ci.yml:1167-1171 states - "a depth-1
 * checkout carries neither". The parent exists only because the earlier asks step in
 * the same workspace runs `git fetch --no-tags --depth=2 origin $(git rev-parse HEAD)`
 * (ci.yml:1171) and the model-case step inherits the deepened clone. So this branch is
 * correct AND it DEPENDS on that fetch: delete the `--depth=2` line and the resolver
 * silently drops to the pinned baseline. The regression test builds the real depth-1
 * shape and then deepens it, so it fails for that deletion instead of describing it.
 *
 * WHY EVERY PROVENANCE LINE IS ON STDERR. This module is a release script with a
 * contract: `scripts/entry-point.test.mjs` pins its refusal path to `stdout: /^$/`,
 * and the resolution below runs at IMPORT time (`ASKS_CONTROL`), before the permission
 * door can refuse. Printing there turned that contract red on run 42515867037 (job
 * 128838711899) with 255 bytes of the DEGRADED line on stdout. stderr is where this
 * script's other diagnostics already go, and the contract's stderr assertion is a
 * SEARCH, so the branch stays named and stdout stays silent. The tests capture the two
 * streams separately and assert the split, so a line moving back to stdout fails a
 * source test rather than a required check.
 */
export function resolveAsksControl() {
	const override = process.env.ASKS_CONTROL_OVERRIDE;
	if (override) return override;

	const onMain = probeCommit("origin/main");
	if (onMain) {
		const merged = probeMergeBase("origin/main", "HEAD");
		if (merged) {
			console.error(
				`asks-app-regression: control derived from the merge base of origin/main and HEAD (${merged})`,
			);
			return merged;
		}
		console.error(
			`asks-app-regression: origin/main (${onMain}) shares no history with HEAD; falling through to the next control source`,
		);
	}

	/*
	 * The merge ref's first parent. Only when HEAD really is a MERGE COMMIT (`HEAD^2`
	 * exists): on a developer's ordinary branch `HEAD^1` is the previous commit, not
	 * main, so accepting it there would compare the change against itself.
	 *
	 * Both parents are present only because ci.yml deepened this clone before this step
	 * ran (`git fetch --depth=2 origin $(git rev-parse HEAD)`, ci.yml:1171). The `HEAD^2`
	 * guard is what keeps that from misfiring on an ordinary branch.
	 */
	if (probeCommit("HEAD^2")) {
		const parent = probeCommit("HEAD^1");
		if (parent) {
			console.error(
				`asks-app-regression: origin/main unavailable in this clone; comparing against the merge ref's first parent ${parent}`,
			);
			return parent;
		}
	}

	/*
	 * One bounded, best-effort fetch of the remote's main into a PRIVATE ref, for a bare
	 * depth-1 branch clone that has neither `origin/main` nor a merge parent. Never
	 * mandatory: `ASKS_CONTROL_NO_FETCH` opts out, a tree with no `origin` remote skips
	 * it, and a failure falls through to the pinned revision below. Only the PRODUCER
	 * fetches - `isEntryPoint` (or an explicit `ASKS_CONTROL_ALLOW_FETCH=1`, which the
	 * tests use to drive this branch against a local remote) keeps an importing suite
	 * off the network.
	 *
	 * NON-DESTRUCTIVE BY CONSTRUCTION (review round 1, R1-4). The fetch goes to `origin`'s
	 * URL rather than the remote name, writes only the private ref (see `fetchMainOnce`),
	 * and takes a depth only where the clone is already shallow - so a developer's
	 * `origin/main`, `FETCH_HEAD` and non-shallow history all survive the run. The
	 * alternative the reviewer offered - refuse to fetch at all in a developer checkout
	 * and take the pin - was rejected: it throws away the only real base available on
	 * that path, whereas a disposable ref answers the same question without the mutation.
	 */
	if (
		(process.env.ASKS_CONTROL_ALLOW_FETCH === "1" ||
			isEntryPoint(import.meta.url)) &&
		fetchMainOnce()
	) {
		const merged = probeMergeBase(ASKS_CONTROL_FETCH_REF, "HEAD");
		if (merged) {
			console.error(
				`asks-app-regression: origin/main was absent; fetched it once into ${ASKS_CONTROL_FETCH_REF} and comparing against the merge base ${merged}`,
			);
			return merged;
		}
	}

	console.error(
		`asks-app-regression: origin/main unavailable; comparing against pinned ${ASKS_CONTROL_PINNED} (DEGRADED: this clone has no origin/main, no merge parent and no usable fetch, so the control is the historical pin rather than this PR's base)`,
	);
	return ASKS_CONTROL_PINNED;
}

/**
 * The commit `rev` names in this clone, or null when it names none.
 *
 * `--verify --quiet` exits 1 and prints NOTHING for an absent revision, so this is
 * the probe the resolution above asks its questions with: a missing ref is an answer
 * here, never an exception to be caught (see `resolveAsksControl`).
 */
export function probeCommit(rev) {
	const out = spawnSync(
		"git",
		["rev-parse", "--verify", "--quiet", `${rev}^{commit}`],
		{
			encoding: "utf8",
		},
	);
	/*
	 * A SPAWN FAILURE IS NOT AN ANSWER ABOUT THE REVISION (review NIT R1-6). If `git`
	 * itself cannot be launched, every probe would read as "absent" and the real cause
	 * would surface much later as `assertControlPresent`'s "the control revision ... is
	 * not in this clone", which is the wrong reason and sends the reader to the wrong
	 * fix. Only a NON-ZERO EXIT means absent; an unlaunchable git is an environment
	 * failure and is named as one.
	 */
	if (out.error)
		throw new Error(
			`asks-app-regression: could not run git to probe ${rev}: ${out.error.message}`,
		);
	return out.status === 0 ? out.stdout.trim() || null : null;
}

/** The merge base of two revisions, or null when they have none (unrelated history). */
function probeMergeBase(left, right) {
	const out = spawnSync("git", ["merge-base", left, right], {
		encoding: "utf8",
	});
	return out.status === 0 ? out.stdout.trim() || null : null;
}

/**
 * The branch-private ref the fallback fetch writes.
 *
 * NOT `refs/remotes/origin/main` (review round 1, R1-4): that ref is read by people
 * and by other tools, and a `--depth=1` fetch through it both MOVES it - masking the
 * developer's own `origin/main` - and shallow-marks the clone. A ref under
 * `refs/asks-control/` is disposable, shadows nothing, and `--no-write-fetch-head`
 * keeps `FETCH_HEAD` from being replaced under a concurrent `git pull`.
 */
export const ASKS_CONTROL_FETCH_REF = "refs/asks-control/main";

/** Whether this repository is ALREADY shallow, per git itself. */
function repositoryIsShallow() {
	const out = spawnSync("git", ["rev-parse", "--is-shallow-repository"], {
		encoding: "utf8",
	});
	return out.status === 0 && out.stdout.trim() === "true";
}

/** `origin`'s URL, or null when this clone has no such remote. */
function remoteOriginUrl() {
	const out = spawnSync("git", ["remote", "get-url", "origin"], {
		encoding: "utf8",
	});
	return out.status === 0 ? out.stdout.trim() || null : null;
}

/**
 * Bounded, single, best-effort fetch of `origin`'s main into a PRIVATE ref. Returns
 * the fetched commit, or null. Never throws and never hangs: a missing remote, an
 * offline tree or `ASKS_CONTROL_NO_FETCH` all answer null.
 *
 * WHY IT FETCHES BY URL AND NOT BY REMOTE NAME. Naming the remote does not confine the
 * write to the refspec given: MEASURED here, `git fetch origin +refs/heads/main:refs/asks-control/main`
 * ALSO updated `refs/remotes/origin/main`, because the clone's `remote.origin.fetch`
 * mapping is applied on top of the command-line refspec - so a private refspec alone
 * still mutates the developer's clone. Fetching the URL writes no remote-tracking ref
 * at all, because there is no remote to update.
 *
 * WHY `--depth` IS CONDITIONAL, WHICH IS THE OTHER HALF OF R1-4. `--depth=1` SHALLOWS
 * the local repository whatever ref it lands in: MEASURED here, a full clone that
 * fetched one ref at depth 1 gained a `.git/shallow` naming that tip, and the file
 * outlives the process. A depth is only meaningful, and only harmless, where the clone
 * is already shallow; a full clone gets a normal fetch, which transfers nothing it does
 * not already have and keeps its history intact.
 */
function fetchMainOnce() {
	if (process.env.ASKS_CONTROL_NO_FETCH) return null;
	const url = remoteOriginUrl();
	if (!url) return null;
	const fetched = spawnSync(
		"git",
		[
			"fetch",
			"--no-tags",
			"--no-write-fetch-head",
			...(repositoryIsShallow() ? ["--depth=1"] : []),
			url,
			`+refs/heads/main:${ASKS_CONTROL_FETCH_REF}`,
		],
		{
			encoding: "utf8",
			timeout: CONTROL_FETCH_TIMEOUT_MS,
			/*
			 * A private or expired-credential https remote would otherwise block on an
			 * interactive username/password prompt until the cap expired (review R1-5).
			 * This script only ever runs unattended - on a hosted runner, or by a developer
			 * who is not watching a background step - so no prompt may survive.
			 */
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		},
	);
	return fetched.status === 0 ? probeCommit(ASKS_CONTROL_FETCH_REF) : null;
}

/**
 * Fail with the REASON when the control revision is not this clone, instead of the
 * bare `fatal: Not a valid object name <sha>` the caller would otherwise get from the
 * `rev-parse`/`archive` calls that consume `ASKS_CONTROL`. A shallow clone can hold
 * the merge base's commit object and still lack the pinned historical revision - and
 * a mis-spelled `ASKS_CONTROL_OVERRIDE` lands here too - so the message names the
 * revision and the two ways to supply it.
 */
export function assertControlPresent(control) {
	if (probeCommit(control)) return control;
	throw new Error(
		`asks-app-regression: the control revision ${control} is not in this clone, so its source cannot be read. Fetch it (git fetch --depth=1 origin ${control}) or name one with ASKS_CONTROL_OVERRIDE.`,
	);
}

const sha = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
export const ASKS_CONTROL = resolveAsksControl();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/*
 * A PRESS LANDS ONLY WHERE THE TARGET CAN RECEIVE IT (#1131's red leg).
 *
 * `press` used to wait for the target to EXIST, take its centre and dispatch one
 * mouse sequence - no hit test, no retry. That is enough while the tree is quiet and
 * silently wrong while it is not: the header-menu case switches session (the header is
 * re-keyed and re-rendered) and marks and presses almost immediately, so a press that
 * lands in that window is swallowed by an element about to be replaced, and the wait
 * for the menu that follows times out with nothing but the expression to go on.
 * Measured on run 38966398557: `header-menu/candidate` captured ZERO frames with
 * `Unsettled real UI: document.querySelectorAll('[role="menuitem"]').length > 0`,
 * while the same case's control leg - second, on a warm app - passed on identical
 * content.
 *
 * SO THE GATE IS ACTIONABILITY, NOT A RETRY OF THE PRESS: the point must hit-test to
 * the target itself or something it contains, and the target must be the same element
 * across two consecutive reads, before the ONE press is dispatched. The stability half
 * is what covers the session switch, and the claim that carries it is a JS property on
 * the node: invisible to the app and to CSS, and lost with the node it was set on,
 * which is exactly the identity question being asked.
 *
 * A press that is never deliverable FAILS NAMING THE OCCLUDER - the point, the element
 * that owns it and whether the target was still being replaced - so the next reader
 * knows it was occlusion rather than re-deriving it. Deliberately NOT a retry loop on
 * the press itself: a press delivered twice is a different bug from a press never
 * delivered, and the gate plus the stability read covers the way this one was
 * swallowed.
 */
let pressClaim = 0;

export function describePressRead(read) {
	if (!read) return "no read was taken";
	if (!read.present) return "the target left the document";
	if (!read.painted) return "the target has an empty box";
	const owner =
		read.at === "nothing"
			? "hit-tests to nothing (off-screen, or owned by a layer that paints nothing)"
			: `is covered by ${read.at}`;
	const settling = read.stable
		? ""
		: ", and the target is still being replaced (unstable across two reads)";
	return `the point (${read.x},${read.y}) ${owner}${settling}`;
}

export async function pressWhenActionable({
	selector,
	probe,
	dispatch,
	reads = 25,
	intervalMs = 60,
}) {
	let last = null;
	for (let taken = 1; taken <= reads; taken++) {
		last = await probe();
		if (last.present && last.painted && last.hit && last.stable) {
			await dispatch({ x: last.x, y: last.y });
			return { reads: taken, at: last };
		}
		if (taken < reads) await pause(intervalMs);
	}
	throw Error(
		`pointer target never became actionable after ${reads} bounded reads: ${selector} - ${describePressRead(last)}`,
	);
}

/*
 * WHAT A MENU TIMEOUT SHOULD SAY (same run): with a press that can be swallowed, "the
 * menu did not open" is ambiguous between a press that never landed and a menu that
 * never rendered, so the timeout reports where the trigger is and what owns that point.
 */
const MENU_TRIGGER_SEEN = `(()=>{const el=document.querySelector('[data-ci-menu]');if(!el)return 'the menu trigger is not in the document';const r=el.getBoundingClientRect();const x=Math.round(r.x+r.width/2);const y=Math.round(r.y+r.height/2);const at=document.elementFromPoint(x,y);const owner=at===el||el.contains(at)?'the trigger itself':(at?at.tagName.toLowerCase()+String(at.getAttribute('role')?'[role="'+at.getAttribute('role')+'"]':''):'nothing');return 'no menu items appeared; the trigger at ('+x+','+y+') hit-tests to '+owner})()`;
/*
 * WHAT THE RAIL'S CLOSE MEANS (#1079), AND WHY A CONTROL NO LONGER OWES THE
 * OPPOSITE OF IT (remediation round 1, stream A).
 *
 * The asks fix made a press on the lit rail item EMPTY the slot instead of handing
 * the borrowed pane back, so a control from before the fix restored the pane while a
 * candidate empties it - and this file used to encode exactly that as a per-leg
 * literal: `expectedRailClose("control") === true`. That literal is only true while
 * the control PREDATES the fix. The control is now DERIVED (the merge-base of
 * `origin/main` and `HEAD`), so on any head cut from a main that already carries the
 * fix - every head from 2026-10-16 on - the control empties the slot too, and the
 * literal failed a correct run. Measured on run 38951889082: the macOS leg died at
 * its FIRST case, `--case asks --leg control`, with `control rail-close wrong restore
 * policy: false !== true`, because the merge-base `a23faab0` already contains
 * `2424010d2ae4`.
 *
 * SO THE DECLARATION IS ONE VALUE, NOT ONE PER LEG: the post-state the fix promises.
 * A candidate must exhibit it, and a control that exhibits it too is a CORRECT,
 * PASSING outcome rather than a mismatch to assert against. What the control owes
 * instead is its READING, recorded in its frames beside the candidate's, so the pair
 * still shows which policy each revision has.
 */
export const ASKS_RAIL_CLOSE_POST_STATE = false;

/**
 * The policy assertion a leg owes, or `undefined` when it owes only a reading.
 *
 * Only the CANDIDATE owes the assertion: it is the revision under test, so a
 * candidate that restores the pane where it must empty the slot has to fail. The
 * control is a historical revision whose policy is whatever that revision does, so
 * asserting the literal failed every control that post-dates the fix - which, with
 * a derived control, is all of them.
 */
export function railCloseAssertion(kind) {
	assert(["control", "candidate"].includes(kind));
	return kind === "candidate" ? ASKS_RAIL_CLOSE_POST_STATE : undefined;
}

/**
 * What a leg's close actually did, in the words a reader of the artifact needs.
 *
 * BOTH BRANCHES ARE ORDINARY OUTCOMES, so this cannot be a pass/fail: a control that
 * EMPTIES the slot already carries the fix (`main` does) and a control that RESTORES
 * the pane is one from before it. Recording it is the point - the artifact says
 * which, instead of a reviewer inferring it from a frame's raw boolean.
 */
export function railCloseReading(kind, observed) {
	assert(["control", "candidate"].includes(kind));
	assert.equal(typeof observed, "boolean");
	return {
		leg: kind,
		observed,
		declaredPostState: ASKS_RAIL_CLOSE_POST_STATE,
		reading:
			observed === ASKS_RAIL_CLOSE_POST_STATE
				? "this revision EMPTIES the slot when the lit asks item closes - the #1079 policy is present"
				: "this revision RESTORES the displaced pane when the lit asks item closes - the pre-#1079 policy",
	};
}
function files(root) {
	return readdirSync(root).flatMap((name) => {
		const path = join(root, name);
		return readdirSync(root, { withFileTypes: true })
			.find((x) => x.name === name)
			.isDirectory()
			? files(path)
			: [path];
	});
}
/**
 * Whether the control may REUSE the candidate's built main + preload, or must
 * build its own.
 *
 * WHY IT IS A FUNCTION OF FOUR TREE IDS. The control leg exists so its frames differ
 * from the candidate's for ONE reason - the change under test. Reusing the
 * candidate's `out/main` and `out/preload` for the control is only honest when those
 * sources are byte-identical at both revisions; then the reuse saves a build and
 * changes nothing. A PR that changes main-process or preload code (a window option,
 * an IPC channel, a preload bridge) is exactly the PR whose frames most need a real
 * control, and used to die here with `control reuse mismatch src/main` before
 * rendering anything - so a main-touching change could not pass the one job that
 * photographs it. Now it takes the other branch: the control's main and preload are
 * BUILT from the control's own source, so the pair still differs by the change only.
 *
 * TWO PARTS ARE NOT PART OF "REUSE":
 *  - `pnpm-lock.yaml`: a differing lockfile means the control cannot share the
 *    candidate's `node_modules`; it installs its own from its own lockfile, so the
 *    comparison stays "base tree with base dependencies".
 *  - a missing tree: a revision whose source cannot be read stops dispatch.
 * The byte-identical case keeps its original assertion; only the mismatch of the
 * three build INPUTS (`src/main`, `src/preload`, `electron.vite.config.js`) is
 * redirected to a rebuild instead of a throw.
 */
export const CONTROL_REUSE_PARTS = [
	"src/main",
	"src/preload",
	"electron.vite.config.js",
	"pnpm-lock.yaml",
];
export function controlReusePlan(revParse, control, head) {
	const differing = CONTROL_REUSE_PARTS.filter(
		(part) => revParse(`${control}:${part}`) !== revParse(`${head}:${part}`),
	);
	return {
		reuse: differing.length === 0,
		differing,
		lockDiffers: differing.includes("pnpm-lock.yaml"),
	};
}
/** The provenance line for a plan: the manifest's `mainPreloadReuse`. */
export function describeMainPreloadReuse(plan) {
	if (plan.reuse) return "byte-identical source/config/lock";
	if (plan.lockDiffers) {
		return "rebuilt from control source (lockfile differs; control dependencies installed from its own lockfile)";
	}
	return `rebuilt from control source (main/preload differ: ${plan.differing.join(", ")})`;
}
/**
 * HOW A LOCKFILE-DIFFERING CONTROL GETS ITS ELECTRON EXECUTABLE.
 *
 * The control's own install (`prepareControl`, `lockDiffers`) runs with
 * `--ignore-scripts` so a base-revision dependency tree cannot execute arbitrary
 * lifecycle scripts on the runner. That also skips Electron's postinstall, so the
 * control's `node_modules/electron` has neither `dist/` nor `path.txt`, and the
 * control's `renderer-driver.mjs` -> `installedElectronBinary` refuses with
 * "native executable absent; proof harnesses never bootstrap Electron". Measured
 * on PR #1821 (CI run 42710783768, job 129481850011, NPX Sanity Check macOS):
 * any dependency-adding PR tripped it, while lockfile-identical PRs take the
 * symlink branch and never see it.
 *
 * Decision (pure, so it is unit-tested without launching anything):
 * - SAME Electron version on both sides: the control's JS stays "base tree with
 *   base deps", and the native runtime is the candidate's already-installed
 *   binary - byte-for-byte the runtime the control's own installer would fetch.
 *   It is handed to the control leg ONLY through that child's env
 *   (`ELECTRON_OVERRIDE_DIST_PATH`, the npm-documented override the pinned
 *   control's `installedElectronBinary` already honours), never via the global
 *   `process.env`, plus the candidate's `path.txt` marker, because the resolver
 *   needs the platform-relative executable path (`Electron.app/Contents/MacOS/
 *   Electron` on macOS) and would otherwise guess a bare `electron`.
 * - DIFFERENT versions: run ONLY Electron's own installer in the control root
 *   (CI feeds it from the restored Electron cache); every other dependency keeps
 *   `--ignore-scripts`. If that leaves no executable, fail naming both versions.
 */
export function controlElectronPlan({
	controlVersion,
	candidateVersion,
	candidateDist,
}) {
	if (controlVersion === candidateVersion) {
		return {
			action: "reuse-candidate-binary",
			env: { ELECTRON_OVERRIDE_DIST_PATH: candidateDist },
			describe: `candidate Electron ${candidateVersion} binary (same version as control)`,
		};
	}
	return {
		action: "run-electron-installer",
		installer: ["node_modules/electron/install.js"],
		env: {},
		describe: `control Electron ${controlVersion} via its own installer (candidate has ${candidateVersion})`,
	};
}
async function provisionControlElectron(root) {
	const electronDir = (base) =>
		dirname(
			createRequire(join(base, "package.json")).resolve(
				"electron/package.json",
			),
		);
	const controlDir = electronDir(root);
	const candidateDir = electronDir(process.cwd());
	const version = (dir) =>
		JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
	const controlVersion = version(controlDir);
	const candidateVersion = version(candidateDir);
	const plan = controlElectronPlan({
		controlVersion,
		candidateVersion,
		candidateDist: join(candidateDir, "dist"),
	});
	const marker = join(candidateDir, "path.txt");
	if (plan.action === "reuse-candidate-binary") {
		if (!existsSync(marker))
			throw new Error(
				`control Electron ${controlVersion} = candidate ${candidateVersion}, but the candidate has no installed runtime (${marker} missing)`,
			);
		// Written into the control's own scratch install only; the candidate's
		// tree and the shared store copies are never touched.
		writeFileSync(join(controlDir, "path.txt"), readFileSync(marker));
	} else {
		try {
			await execute(process.execPath, plan.installer, {
				cwd: root,
				env: { ...process.env, CI: "true" },
				timeout: 300000,
				maxBuffer: 8 * 1024 * 1024,
			});
		} catch (error) {
			throw new Error(
				`control Electron ${controlVersion} differs from candidate ${candidateVersion} and its installer failed: ${error.message}`,
			);
		}
		if (!existsSync(join(controlDir, "path.txt")))
			throw new Error(
				`control Electron ${controlVersion} differs from candidate ${candidateVersion} and its installer left no executable (${controlDir}/path.txt missing)`,
			);
	}
	return plan;
}
async function prepareControl(root, output) {
	// The control's source is read from its own revision; ask for it up front so a
	// clone that does not hold it fails with the reason instead of a bare
	// `fatal: Not a valid object name` out of the rev-parse/archive calls below.
	assertControlPresent(ASKS_CONTROL);
	// Real historical source, not a callback mutation. Main/preload are reused
	// from the candidate only when the source identities agree (`controlReusePlan`);
	// otherwise they are built from the control's own source below.
	const plan = controlReusePlan(
		(spec) => git("rev-parse", spec),
		ASKS_CONTROL,
		"HEAD",
	);
	const tar = join(output, "control-source.tar");
	execFileSync("git", [
		"archive",
		"--format=tar",
		`--output=${tar}`,
		ASKS_CONTROL,
		"src",
		"scripts",
		"resources",
		"build",
		"i18n",
		"package.json",
		"pnpm-lock.yaml",
		"pnpm-workspace.yaml",
		"electron.vite.config.js",
		"tsconfig.node.json",
		"tsconfig.app.json",
		"tsconfig.web.json",
		"tsconfig.json",
	]);
	mkdirSync(root);
	execFileSync("tar", ["-xf", tar, "-C", root]);
	/*
	 * A DEPENDENCY-ADDING PR IS STILL A VALID EXPERIMENT. The control normally
	 * shares the candidate's node_modules, which is only honest when the lockfile
	 * is byte-identical. When the lockfile differs, sharing would boot the control
	 * on dependencies it was not built for, so the control gets its OWN install
	 * from its own lockfile instead. That preserves the comparison (the control is
	 * the base tree with base dependencies) and lets a reviewed dependency addition
	 * run through the same gate rather than being forced to bypass it.
	 */
	if (plan.lockDiffers) {
		await execute(
			"pnpm",
			["install", "--frozen-lockfile", "--ignore-scripts"],
			{
				cwd: root,
				env: { ...process.env, CI: "true" },
				timeout: 300000,
				maxBuffer: 8 * 1024 * 1024,
			},
		);
	}
	const electron = plan.lockDiffers
		? await provisionControlElectron(root)
		: null;
	if (!plan.lockDiffers) {
		symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
	}
	if (plan.reuse) {
		for (const part of ["main", "preload"])
			cpSync(join("out", part), join(root, "out", part), { recursive: true });
	}
	/*
	 * Same `resolveConfig` approach as the renderer, run in the control's root so the
	 * control's own `electron.vite.config.js` and sources are what build. Main and
	 * preload are built only when they could not be reused; the renderer always is.
	 */
	const targets = plan.reuse
		? "renderer"
		: "main, c.config.preload, c.config.renderer";
	const code = `import {resolveConfig} from 'electron-vite';import {build} from 'vite';const c=await resolveConfig({},'build','production');for (const cfg of [c.config.${targets}]) await build(cfg);`;
	await execute(process.execPath, [...CONTROL_BUILD_NODE_ARGS, "-e", code], {
		cwd: root,
		env: { ...process.env, LOCAL_OPERATOR_UI_NO_BYTECODE: "true" },
		// A rebuild adds two bundles (main, preload) to the renderer build.
		timeout: plan.reuse ? 120000 : 240000,
		maxBuffer: 4 * 1024 * 1024,
	});
	return {
		commit: ASKS_CONTROL,
		srcTree: git("rev-parse", `${ASKS_CONTROL}:src`),
		mainPreloadReuse: describeMainPreloadReuse(plan),
		electronRuntime: electron?.describe ?? "shared candidate node_modules",
		// Not provenance: the control leg's child env, consumed (and removed) by main().
		legEnv: electron?.env ?? {},
		rendererOutputs: Object.fromEntries(
			files(join(root, "out/renderer")).map((p) => [
				p.slice(root.length + 1),
				sha(readFileSync(p)),
			]),
		),
	};
}
/**
 * Wait for the renderer to be READY for a verb: painted, with the dev-driver
 * bridge answering, on whichever driver tree this run imported.
 *
 * The candidate tree exports both waits and they are preferred; the pinned
 * historical control tree carries the same two functions INTERNALLY without
 * exporting them (verified at 2461cfa3: `waitForPage` at 1761, `waitForBridge`
 * at 1777, neither on the facade), so there the equivalent polls are repeated.
 * What the scene needs - a mounted page whose `__loDevDriver` answers `verbs()`
 * with `hello` - is the same requirement on both trees.
 */
async function waitForSceneReady(cdp, api, timeoutMs = 90_000) {
	if (
		typeof api?.waitForPage === "function" &&
		typeof api?.waitForBridge === "function"
	) {
		await api.waitForPage(cdp);
		await api.waitForBridge(cdp);
		return;
	}
	const started = Date.now();
	for (;;) {
		const state = await cdp
			.evaluate(
				"({ ready: document.readyState, mounted: Boolean(document.getElementById('app')?.childElementCount), verbs: typeof window.__loDevDriver?.verbs === 'function' ? window.__loDevDriver.verbs() : null })",
			)
			.catch(() => null);
		if (
			state?.ready === "complete" &&
			state.mounted &&
			Array.isArray(state.verbs) &&
			state.verbs.includes("hello")
		)
			return;
		if (Date.now() - started > timeoutMs)
			throw new Error(
				`the renderer never registered the dev driver verbs (last: ${JSON.stringify(state)})`,
			);
		await new Promise((resumed) => setTimeout(resumed, 250));
	}
}

/**
 * Wait for the app's own debugging port to ANSWER, whatever driver tree this run
 * imported.
 *
 * The candidate tree exports `waitForDevtools` on `rendererDriverApi` and is
 * preferred when present, so the shared implementation stays the one caller
 * contract. The control leg imports a pinned historical driver whose facade does
 * not carry it; there the equivalent bounded poll is repeated, because the
 * requirement is about the PORT being ready and not about which revision of the
 * driver is on disk.
 */
async function waitForDevtoolsPort(handle, api, timeoutMs = 60_000) {
	if (typeof api?.waitForDevtools === "function") {
		await api.waitForDevtools(handle, timeoutMs);
		return;
	}
	const started = Date.now();
	for (;;) {
		try {
			const response = await fetch(
				`http://127.0.0.1:${handle.port}/json/version`,
			);
			if (response.ok) return;
		} catch {
			/* not listening yet */
		}
		if (Date.now() - started > timeoutMs)
			throw new Error(
				`the app's debugging port ${handle.port} never answered in ${timeoutMs}ms`,
			);
		await new Promise((resumed) => setTimeout(resumed, 250));
	}
}

/* ------------------------------------------------------------------ *
 * THE CASE TABLE
 * ------------------------------------------------------------------ */
/**
 * Every assembled-app frame case this producer can run, keyed by the name
 * `--case` takes.
 *
 * WHY A TABLE RATHER THAN ANOTHER SCENE SCRIPT. The UI programme's design and UX
 * rounds are gated on frames of the REAL assembled app, and the asks scenario
 * proved the shape of that evidence: a candidate leg plus a control leg built
 * from a real historical revision, real pointer presses, state read back through
 * the dev driver, and PNGs a reviewer can look at. What differs from one UI head
 * to the next is only WHICH steps are driven, WHICH states must hold and WHICH
 * frames are worth capturing, so those are what a case declares and the runner
 * (launch, attach, control derivation, reaping, manifest) is shared rather than
 * copied per head.
 *
 * `purpose` is prose for the reviewer, not executed. `frames` IS a contract: the
 * runner asserts every promised label was captured, so a case that stops halfway
 * fails rather than publishing an artifact thinner than it claims. A case that
 * cannot run refuses loudly - `--case`/`--leg` outside this table, or missing
 * environment names, exit 1 before any artifact root exists or any Electron
 * binary is resolved.
 */
export const CASES = {
	"model-uncertainty": modelUncertaintyCase,
	asks: {
		purpose:
			"The asks rail's open/close policy, driven through every door the user has (rail item, drawer X, Escape, header menu, composer chip) with the browser pane underneath it. The first case, and the one the 1107 rounds were reviewed against.",
		route: "/chat",
		/*
		 * PER LEG, NOT ONE LIST, because the legs are not the same drive: the
		 * candidate runs the closers the change is about (the drawer's X, Escape,
		 * the header menu, the composer chip, the emptied queue, the connection
		 * error) while the control - a real historical revision that predates them -
		 * stops after the shared steps. One list would promise the control leg frames
		 * it cannot take, which is a red run for a correct case.
		 */
		frames: {
			control: [
				"session-loading",
				"before-browser",
				"populated-asks",
				"rail-close",
				"session-a-b-a",
			],
			candidate: [
				"session-loading",
				"before-browser",
				"populated-asks",
				"rail-close",
				"session-a-b-a",
				"header-menu",
				"x-close",
				"escape-give-back",
				"menu-close",
				"chip-close",
				"empty-session-queue",
				"connection-error",
			],
		},
		coverage:
			"real assembled app renderer/handlers/store; not native WCV compositor pixels or macOS z-order",
		/*
		 * THE LEGACY OUTPUT LAYOUT IS KEPT FOR THIS CASE ON PURPOSE: its frames sit
		 * at `<output>/control` and `<output>/candidate`, which is where the QA howto
		 * for the asks work points and where the review threads' artifact paths
		 * resolve. Moving every case to one `<case>/<leg>` scheme is mechanical and
		 * has its own blast radius (artifacts, docs, recorded howtos), so this slice
		 * deliberately does not do it.
		 */
		legacyOutputLayout: true,
		drive: async (ctx) => {
			const {
				kind,
				cdp,
				wait,
				press,
				pressEscape,
				waitFor,
				facts,
				frame,
				stamp,
				fixtureMode,
				session,
			} = ctx;
			/*
			 * OPEN THE BROWSER DOOR, AND WAIT FOR THE PANE RATHER THAN SAMPLING IT ONCE.
			 *
			 * The press is a real pointer press on the real rail item, and the store's
			 * `browser` arm sets `isBrowserPaneOpen` in one step with no gate
			 * (`panel-rail-actions.ts`), so the flag does follow the press - what is NOT
			 * synchronous is React's commit of it. Reading `facts()` once, immediately after
			 * the pointer events, samples the store at whatever moment the round trip lands
			 * on, and under load that moment can still be the pre-commit one: measured on run
			 * 38929174267, candidate leg, `Expected values to be strictly equal: false !== true`
			 * at the assertion below, with the pane not yet committed.
			 *
			 * WHY A BOUNDED POLL AND NOT A LONGER PAUSE. What is being waited FOR is a state
			 * change, so the same expression that reads it is the one that has to retry - the
			 * shape this file already uses for every other readiness wait (`wait`, and the
			 * two port/bridge polls above). The timeout keeps the failure mode honest: a door
			 * that never opens still fails, and the message carries the whole state plus what
			 * the press reported, so a genuine regression cannot be mistaken for slowness.
			 *
			 * THE PRESS'S OWN ANSWER IS KEPT. `press` returns nothing today, so the state is
			 * read back instead; if the item were absent or refused the flag would never
			 * settle and the refusal below names it with the state in hand.
			 */
			async function browser() {
				if ((await facts()).dom.ask) await pressEscape();
				if (!(await facts()).state.browserPaneOpen)
					await press('[data-panel-rail-item="browser"]');
				const opened = await waitFor(
					async () => (await facts()).state.browserPaneOpen === true,
					15_000,
				);
				assert.equal(
					opened.state.browserPaneOpen,
					true,
					`the browser door did not open its pane within 15s: browserPaneOpen=${opened.state.browserPaneOpen} state=${JSON.stringify(opened.state)}`,
				);
			}
			async function asks() {
				await press('[data-panel-rail-item="ask"]');
				await wait('!!document.querySelector("[data-ask-drawer]")');
			}
			async function closed(label, expected) {
				await wait('!document.querySelector("[data-ask-drawer]")');
				const x = await frame(label);
				/*
				 * NO POLICY IS OWED ON A CONTROL LEG (`railCloseAssertion`): the drawer being
				 * shut and the focus still connected are asserted either way, and the pane's
				 * state is left to the frame's `railClosePolicy` reading.
				 */
				if (expected !== undefined)
					assert.equal(
						x.state.browserPaneOpen,
						expected,
						`${kind} ${label} wrong restore policy`,
					);
				assert.equal(x.dom.focusedConnected, true);
				return x;
			}
			/*
			 * The conversation is opened by PRESSING THE ROW, not by a disclosure press
			 * first. `[data-tour-tag="chat-all-chats"]` was pressed here unguarded and
			 * that selector has NO home in `src/` at either this head or the pinned
			 * control one (the shared driver's own comment at its `--backend` scene says
			 * so, and `git grep` over `src` in both trees finds nothing), so the press
			 * waited fifteen seconds for an element the app never draws and the whole
			 * case died with `Unsettled real UI: Boolean(document.querySelector(
			 * "[data-tour-tag=\"chat-all-chats\"]"))` - measured on run 38846903646.
			 *
			 * `session()` below is the shape the driver's own scenes use instead: wait
			 * for the seeded row, mark it, press that. The rail this scene is about is
			 * on every route and needs no conversation at all.
			 */
			await session(0);
			await frame("session-loading");
			await fixtureMode("populated");
			await wait(
				'Boolean(document.querySelector("[data-panel-rail-item=ask]"))',
			);
			if ((await facts()).dom.ask) await pressEscape();
			await browser();
			await frame("before-browser");
			await asks();
			await frame("populated-asks");
			await press('[data-panel-rail-item="ask"]');
			/*
			 * THE CLOSE, WITH THE LEG'S OWN OBLIGATION: the candidate must empty the slot;
			 * the control is READ, not asserted, because a control that already carries the
			 * fix is a correct outcome. Its reading goes on the frame below, so the pair
			 * still records which policy each revision has.
			 */
			const railClose = await closed("rail-close", railCloseAssertion(kind));
			stamp(
				"railClosePolicy",
				railCloseReading(kind, railClose.state.browserPaneOpen),
			);
			await session(1);
			await session(0);
			/*
			 * A->B->A, AGAINST THIS RUN'S OWN CLOSE RATHER THAN A LITERAL (round 1, stream
			 * A). The pane's state after the sessions switch must equal what the close left:
			 * a revision that empties the slot must NOT bring the pane back when the
			 * conversation is re-entered (that is the memory the fix retracts), and a
			 * pre-fix revision that restored it must restore it again. Comparing against
			 * the observation keeps that a real gate on BOTH legs - a candidate whose close
			 * empties the slot but whose memory still restores it fails here - without
			 * hard-coding one revision's policy.
			 */
			assert.equal(
				(await facts()).state.browserPaneOpen,
				railClose.state.browserPaneOpen,
				`${kind}: the pane after A->B->A must equal what the rail's close left (${railClose.state.browserPaneOpen})`,
			);
			await frame("session-a-b-a");
			if (kind === "candidate") {
				await browser();
				await asks();
				await press('[data-tour-tag="close-asks-button"]');
				await closed("x-close", false);
				await browser();
				await asks();
				await pressEscape();
				await closed("escape-give-back", true);
				await asks();
				await cdp.evaluate(
					`(()=>{const h=document.querySelector('[data-tour-tag="chat-header"]');const e=[...h.querySelectorAll('button')].find(e=>e.getAttribute('aria-haspopup')==='menu');if(!e)throw Error('real header menu unavailable');e.setAttribute('data-ci-menu','')})()`,
				);
				await press("[data-ci-menu]");
				await cdp.evaluate(
					`(()=>{const e=[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='Close asks');if(!e)throw Error('real Close asks menu item absent');e.setAttribute('data-ci-close-asks','')})()`,
				);
				await frame("header-menu");
				await press("[data-ci-close-asks]");
				await closed("menu-close", false);
				await browser();
				await asks();
				await press('[data-status-asks][aria-expanded="true"]');
				await closed("chip-close", false);
				await session(1);
				await frame("empty-session-queue");
				await session(0);
				await fixtureMode("error");
				await wait(
					"/reconnect|connection|retry|unavailable|could not/i.test(document.body.innerText)",
				);
				await frame("connection-error");
			}
		},
	},
	/*
	 * THE LONG-ASK SCROLL CASE: the wheel, the page keys and Tab, on a four-decision
	 * ask whose every scroller overflows.
	 *
	 * WHAT IT IS FOR. A card taller than the drawer's scrollport did not scroll from a
	 * wheel over its own text: the question body and the option list carried
	 * `overscroll-behavior: contain`, and Chromium 156 stops the chain at such a box
	 * even when it has nothing left to scroll - so the drawer's LIST, the only thing
	 * that owns the scroll, never moved, and `Send answer` sat below the fold with
	 * nothing pinned to reach it from.
	 *
	 * THE LEGS ARE THE EVIDENCE PAIR, which is why the assertions are per-leg: the
	 * control leg IS this repository's derived pre-fix build, so asserting THERE that
	 * the list does not move and that `Send answer` is outside the port is the negative
	 * control running in CI forever; the candidate leg asserts the remedy. One fixture,
	 * one case, two revisions - no hand-run comparison that can go stale.
	 */
	"asks-scroll": {
		purpose:
			"A four-decision ask whose bodies and option lists all overflow: a wheel over the question text, an option row and the option list, and PageDown/Home/End/Space, have to move the drawer's LIST; each card's action row has to stay inside that list's port at the top of the scroll and at its maximum; and a Tab walk through the card must never leave a focused control covered by that pinned row. Wheel and key events go through Chromium's own input pipeline (CDP), never scrollIntoView.",
		route: "/chat",
		frames: {
			control: [
				"long-ask-440x1024",
				"long-ask-440x700",
				"long-ask-440x1400",
				"long-ask-440x600",
			],
			candidate: [
				"long-ask-440x1024",
				"long-ask-440x700",
				"long-ask-440x1400",
				"long-ask-440x600",
				/* The D4 frame: at the maximum, where the band's bottom edge is readable. */
				"long-ask-max-scroll-440x1024",
				/* The m3 frame: the region's ring, focused by the keyboard, inside its port. */
				"long-ask-focused-440x1024",
			],
		},
		coverage:
			"real assembled app renderer/handlers/store; wheel and key events through Chromium's input pipeline, not scrollIntoView",
		drive: async (ctx) => {
			const {
				kind,
				cdp,
				wait,
				press,
				pressEscape,
				facts,
				frame,
				fixtureMode,
				session,
				stamp,
			} = ctx;
			/*
			 * THE LIST, FOUND THE SAME WAY ON BOTH LEGS. The candidate marks the drawer's
			 * scroller (`data-lo-ask-list`, the contract the pinned row publishes its height
			 * to), and the control build predates the mark - so the control leg reads the same
			 * element by what it IS: inside the drawer, the first `overflow-y: auto` box whose
			 * content actually overflows. That is the list and not a card's body, because the
			 * list precedes every card in DOM order.
			 */
			const LIST = `(document.querySelector("[data-lo-ask-list]") ?? [...document.querySelectorAll("[data-ask-drawer] div")].find((el) => /^(auto|scroll)$/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight))`;
			const READ = `(() => {
				const list = ${LIST};
				if (!list) return { present: false };
				const box = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), height: Math.round(r.height) }; };
				const listBox = box(list);
				const body = document.querySelector("[data-lo-ask-scroll]");
				const opts = document.querySelector("[data-lo-ask-options-scroll]");
				const send = [...document.querySelectorAll("[data-lo-ask-row] button")].find((b) => /^(Send answer|Update answer)$/.test((b.textContent ?? "").trim())) ?? null;
				const active = document.activeElement;
				const labelled = list.getAttribute("aria-labelledby");
				return {
					present: true,
					list: {
						scrollTop: Math.round(list.scrollTop),
						max: list.scrollHeight - list.clientHeight,
						client: list.clientHeight,
						box: listBox,
						tabIndex: list.getAttribute("tabindex"),
						role: list.getAttribute("role"),
						ariaLabel: list.getAttribute("aria-label"),
						/* The EFFECTIVE name: aria-label on the candidate, aria-labelledby before it. */
						name:
							list.getAttribute("aria-label") ??
							(labelled
								? (document.getElementById(labelled)?.textContent ?? "").trim()
								: null),
						scope:
							(document.querySelector("[data-ask-scope]")?.textContent ?? "").trim() ||
							null,
						padding: getComputedStyle(list).scrollPaddingBottom,
						actionsVar: list.style.getPropertyValue("--lo-ask-actions-h"),
					},
					body: body ? { scrollTop: Math.round(body.scrollTop), max: body.scrollHeight - body.clientHeight, contain: getComputedStyle(body).overscrollBehaviorY } : null,
					options: opts ? { scrollTop: Math.round(opts.scrollTop), max: opts.scrollHeight - opts.clientHeight, contain: getComputedStyle(opts).overscrollBehaviorY } : null,
					pinned: document.querySelector("[data-lo-ask-actions]") ? box(document.querySelector("[data-lo-ask-actions]")) : null,
					send: send ? (() => { const b = box(send); return { box: b, disabled: send.disabled, inPort: b.top >= listBox.top - 1 && b.bottom <= listBox.bottom + 1 }; })() : null,
					active: active === null ? null : {
						isList: active === list,
						isBody: active === body,
						inDrawer: !!active.closest("[data-lo-ask-surfaces]"),
						what: active.tagName.toLowerCase() + "|" + (active.textContent ?? "").trim().slice(0, 24),
						box: active.getBoundingClientRect ? box(active) : null,
					},
				};
			})()`;
			const read = () => cdp.evaluate(READ);
			const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
			const resetScroll = () =>
				cdp.evaluate(
					`(() => { const l = ${LIST}; if (l) l.scrollTop = 0; const b = document.querySelector("[data-lo-ask-scroll]"); if (b) b.scrollTop = 0; const o = document.querySelector("[data-lo-ask-options-scroll]"); if (o) o.scrollTop = 0; })()`,
				);
			const focusOn = (selector) =>
				cdp.evaluate(
					`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return document.activeElement === el; })()`,
				);
			/* The list is an EXPRESSION, not a selector (see `LIST`), so it focuses itself. */
			const focusList = () =>
				cdp.evaluate(
					`(() => { const el = ${LIST}; if (!el) return false; el.focus(); return document.activeElement === el; })()`,
				);
			/*
			 * A POINT INSIDE THE TARGET'S VISIBLE PART OF THE PORT. `getBoundingClientRect`
			 * of a target that runs past the port is clipped to the port, so the wheel lands
			 * on a part of the target a reader can actually see - and the hit test is
			 * recorded, because a wheel aimed at "the question text" that really landed on
			 * the pinned bar would be measuring the wrong door.
			 */
			const pointOn = (selector) =>
				cdp.evaluate(`(() => {
					const el = document.querySelector(${JSON.stringify(selector)});
					const list = ${LIST};
					if (!el || !list) return null;
					const r = el.getBoundingClientRect();
					const l = list.getBoundingClientRect();
					const top = Math.max(r.top, l.top + 10);
					const bottom = Math.min(r.bottom, l.bottom - 10);
					if (bottom - top < 8) return null;
					const x = Math.round(Math.max(r.left, l.left) + Math.min(r.width, l.width) / 2);
					const y = Math.round((top + bottom) / 2);
					const hit = document.elementFromPoint(x, y);
					return { x, y, hit: hit ? hit.tagName.toLowerCase() + (hit.closest("[data-ask-option]") ? "[option-row]" : "") + (hit.closest("[data-lo-ask-actions]") ? "[pinned]" : "") : "nothing" };
				})()`);
			const WHEEL_DELTA = 240;
			const WHEEL_NOTCHES = 12;
			const wheelOver = async (target, selector) => {
				await resetScroll();
				await pause(150);
				const before = await read();
				const point = await pointOn(selector);
				if (point === null)
					throw Error(
						`${target}: ${selector} is not visible inside the drawer's port`,
					);
				for (let i = 0; i < WHEEL_NOTCHES; i += 1)
					await cdp.send("Input.dispatchMouseEvent", {
						type: "mouseWheel",
						x: point.x,
						y: point.y,
						deltaX: 0,
						deltaY: WHEEL_DELTA,
					});
				await pause(250);
				return { target, point, before, after: await read() };
			};
			const KEYS = {
				PageDown: {
					key: "PageDown",
					code: "PageDown",
					windowsVirtualKeyCode: 34,
				},
				End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
				Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
				Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
				Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
				/*
				 * SHIFT+SPACE IS THE UPSIDE-DOWN SPACE (agent review round 1, m2). `modifiers: 8`
				 * is Shift in the DevTools protocol's bitmask, so the key arrives with
				 * `shiftKey` true and the region has to page BACK rather than forward.
				 */
				ShiftSpace: {
					key: " ",
					code: "Space",
					windowsVirtualKeyCode: 32,
					modifiers: 8,
				},
			};
			/*
			 * A KEY'S READING, POLLED UNTIL IT SETTLES. Chromium animates keyboard scrolling
			 * on macOS even without `scroll-behavior: smooth` in the CSS, so a reading taken
			 * 180 ms after `Home` caught the tail of a 2220 px jump at 6 px (measured). The
			 * assertions are about where the key lands, not how fast the animation is, so
			 * each one polls its own destination and reports the settled numbers.
			 */
			const settle = async (predicate, timeoutMs = 2500) => {
				const deadline = Date.now() + timeoutMs;
				let state = await read();
				while (!predicate(state)) {
					/*
					 * THE BOUND IS REPORTED, NOT HIDDEN (review round 2, finding 3): returning the
					 * last reading silently made a key that never arrived indistinguishable from
					 * one that settled, so the failing assertion blamed the product without saying
					 * the measurement itself had given up.
					 */
					if (Date.now() > deadline) return { ...state, settled: false };
					await pause(120);
					state = await read();
				}
				return { ...state, settled: true };
			};
			/*
			 * THE NEXT KEY IS PRESSED ON A STILL SCROLLER. Chromium animates keyboard scrolling
			 * (measured), and a key delivered while that animation is in flight is DROPPED rather
			 * than queued: `End` after a PageDown landed short of the maximum on 1 of 24 measured
			 * runs at 440x700, on the base build too, and re-pressing on a still scroller landed it
			 * every time. Waiting for the list's reading (and the card's own scrollers') to hold
			 * still across two polls bounds that race; it cannot mask a real shortfall, because a
			 * key that lands short once everything is still fails exactly as before.
			 */
			const QUIET_POLLS = 2;
			const QUIET_WINDOW_MS = 700;
			const awaitQuiet = async (timeoutMs = QUIET_WINDOW_MS) => {
				const deadline = Date.now() + timeoutMs;
				let last = await read();
				let steady = 0;
				while (Date.now() < deadline) {
					await pause(120);
					const next = await read();
					if (!next.list) return { ...next, quiet: false };
					const moved =
						next.list.scrollTop !== last.list.scrollTop ||
						(next.body?.scrollTop ?? 0) !== (last.body?.scrollTop ?? 0) ||
						(next.options?.scrollTop ?? 0) !== (last.options?.scrollTop ?? 0);
					last = next;
					steady = moved ? 0 : steady + 1;
					if (steady >= QUIET_POLLS) return { ...last, quiet: true };
				}
				return { ...last, quiet: false };
			};
			const pressAndSettle = async (names, predicate) => {
				await keyPress(names);
				await awaitQuiet();
				return settle(predicate);
			};
			const keyPress = async (names) => {
				for (const [index, name] of names.entries()) {
					await cdp.send("Input.dispatchKeyEvent", {
						type: "rawKeyDown",
						...KEYS[name],
					});
					await cdp.send("Input.dispatchKeyEvent", {
						type: "keyUp",
						...KEYS[name],
					});
					await pause(180);
					/* BETWEEN SEVERAL PRESSES OF ONE GESTURE, EACH ONE HAS TO LAND. */
					if (index < names.length - 1) await awaitQuiet();
				}
			};
			/*
			 * THE WALK'S OWN READING: what the browser scrolled to (the focus scroll
			 * honours `scroll-padding-bottom`), whether the focused control is still covered by
			 * the pinned row (a hit test at its centre - the claim, not the geometry that
			 * could agree with a covered control), and whether it ended up wholly inside the
			 * port.
			 */
			const tabWalk = async (limit) => {
				const path = [];
				let left = null;
				for (let i = 0; i < limit; i += 1) {
					await keyPress(["Tab"]);
					const step = await cdp.evaluate(`(() => {
						const el = document.activeElement;
						const list = ${LIST};
						if (!el || el === document.body || !list) return null;
						if (!el.closest("[data-lo-ask-surfaces]"))
							return {
								left: true,
								what:
									el.tagName.toLowerCase() +
									"|" +
									(el.textContent ?? "").trim().slice(0, 40),
							};
						const r = el.getBoundingClientRect();
						const l = list.getBoundingClientRect();
						const x = Math.round(r.left + Math.min(r.width / 2, 16));
						const y = Math.round(r.top + r.height / 2);
						const at = document.elementFromPoint(x, y);
						return {
							what: el.tagName.toLowerCase() + "|" + (el.textContent ?? "").trim().slice(0, 24),
							covered: !(at === el || el.contains(at)),
							under: at ? at.tagName.toLowerCase() + (at.closest("[data-lo-ask-actions]") ? "[pinned]" : "") : "nothing",
							inside: r.top >= l.top - 1 && r.bottom <= l.bottom + 1,
							top: Math.round(r.top),
							bottom: Math.round(r.bottom),
							portTop: Math.round(l.top),
							portBottom: Math.round(l.bottom),
							scrollTop: Math.round(list.scrollTop),
						};
					})()`);
					if (step === null) break;
					if (step.left) {
						left = step;
						break;
					}
					path.push(step);
				}
				return { path, left };
			};
			const readings = {};
			await fixtureMode("long");
			await session(0);
			await wait(
				'Boolean(document.querySelector("[data-panel-rail-item=ask]"))',
			);
			if ((await facts()).dom.ask) {
				await pressEscape();
				await wait('!document.querySelector("[data-ask-drawer]")');
			}
			const dpr = await cdp.evaluate("window.devicePixelRatio");
			/*
			 * FOUR VIEWPORTS. 440 is the width the operator's own report came from - below the
			 * family's dock breakpoint the drawer is a right-anchored sheet - and 600 is the
			 * app's WINDOW FLOOR, the shortest a sheet can ever be. 700/1024/1400 are the
			 * short, laptop and tall ends the same question has to work at. The device scale
			 * factor is the window's own, so a frame's pixels and its `viewport` reading
			 * agree.
			 */
			for (const [width, height] of [
				[440, 1024],
				[440, 700],
				[440, 1400],
				/* THE APP'S WINDOW FLOOR (800x600): a sheet can never be shorter than this. */
				[440, 600],
			]) {
				const size = `${width}x${height}`;
				await cdp
					.send("Emulation.setDeviceMetricsOverride", {
						width,
						height,
						deviceScaleFactor: dpr,
						mobile: false,
					})
					.catch(() => null);
				await pause(400);
				if (!(await facts()).dom.ask)
					await press('[data-panel-rail-item="ask"]');
				await wait('Boolean(document.querySelector("[data-lo-ask-row]"))');
				/*
				 * THE FRAME IS OF THE UNTOUCHED SCROLL POSITION: the previous size's Tab walk
				 * leaves the keyboard (and the browser's focus scroll) deep inside the card, and
				 * a frame taken there shows the middle of a question rather than the state the
				 * pair is about - the top of the list, where the actions are out of the port on
				 * one revision and pinned inside it on the other.
				 */
				await cdp.evaluate(
					"(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); })()",
				);
				await resetScroll();
				await pause(250);
				await frame(`long-ask-${size}`);
				const open = await read();
				if (!open.present) throw Error(`${size}: the drawer's list is absent`);
				if (!(open.list.max > 0))
					throw Error(
						`${size}: the drawer's list does not overflow (scrollHeight ${open.list.client} vs client ${open.list.client}), so this case would prove nothing`,
					);
				const wheels = [
					await wheelOver("question text", "[data-lo-ask-scroll]"),
					await wheelOver("option row", "[data-ask-option]"),
					await wheelOver("option list", "[data-lo-ask-options-scroll]"),
				];
				/* The action row, at both ends of the scroll. */
				await resetScroll();
				await pause(200);
				const stickyTop = await read();
				await cdp.evaluate(
					`(() => { const l = ${LIST}; l.scrollTop = l.scrollHeight - l.clientHeight; })()`,
				);
				await pause(250);
				const stickyMax = await read();
				/*
				 * THE MAX-SCROLL FRAME (design round 1, D4), captured at the one scroll
				 * position the D3 reading is about: the card's own bottom is the port's, so a
				 * band that bleeds to the card's edge is flush with the port and one that does
				 * not leaves a strip. CANDIDATE ONLY - the control draws no pinned row at all
				 * (its `Send answer` sits ~2200 px down the card), so a "before" frame here
				 * would photograph an absence.
				 */
				if (kind === "candidate" && size === "440x1024")
					await frame("long-ask-max-scroll-440x1024");
				/*
				 * THE PAGE KEYS, from the LIST first - the stop the keyboard lands on - and then
				 * from the QUESTION BODY, which is where a reader who tabbed into the card
				 * actually is.
				 */
				await resetScroll();
				await pause(150);
				const listFocus = await focusList();
				const beforeKeys = await read();
				const afterPageDown = await pressAndSettle(
					["PageDown", "PageDown"],
					(state) => state.list.scrollTop > 0,
				);
				/*
				 * END IS READ AGAINST THE MAXIMUM FROM ITS OWN READING, and on the candidate leg a
				 * short landing gets ONE re-press that is recorded in the summary
				 * (`keys.endRetried`), never hidden. Both exist because the assertion used to compare
				 * this reading with the maximum taken before any key was pressed: the list's
				 * scrollable height is not constant across a run (a reflow changes it), so that pair
				 * could disagree even when End had reached the maximum of its own reading - and a key
				 * pressed while the previous scroll was still animating could be dropped. A retry
				 * that still falls short fails the assertion below, and the control leg has no End
				 * claim to retry for: its list is not a keyboard stop at all.
				 */
				const atListEnd = (state) =>
					Math.abs(state.list.scrollTop - state.list.max) <= 1;
				const afterEndFirst = await pressAndSettle(["End"], atListEnd);
				const afterEnd =
					kind === "candidate" && afterEndFirst.settled === false
						? { ...(await pressAndSettle(["End"], atListEnd)), retried: true }
						: { ...afterEndFirst, retried: false };
				const afterHome = await pressAndSettle(
					["Home"],
					(state) => state.list.scrollTop === 0,
				);
				const afterSpace = await pressAndSettle(
					["Space"],
					(state) => state.list.scrollTop > 0,
				);
				/*
				 * AND BACK UP WITH SHIFT (agent review round 1, m2): the region answered Space
				 * with a forward page whatever the modifiers were, so the platform's
				 * page-up gesture did nothing here. The reading is taken from where Space
				 * settled, not from the top, so it cannot pass on a no-op.
				 */
				const afterShiftSpace = await pressAndSettle(
					["ShiftSpace"],
					(state) => state.list.scrollTop < afterSpace.list.scrollTop,
				);
				const bodyFocus = await focusOn("[data-lo-ask-scroll]");
				await resetScroll();
				await pause(150);
				/*
				 * SIX PRESSES, not three: a page key chains to the list only once the body is
				 * ALREADY at its end when the key is pressed, so the count has to cover the
				 * body's own pages (measured: three reached its end at 440x700 and chained
				 * nothing, 878 px at 440x1024 where the body is shorter than their reach).
				 */
				const afterBodyPageDown = await pressAndSettle(
					[
						"PageDown",
						"PageDown",
						"PageDown",
						"PageDown",
						"PageDown",
						"PageDown",
					],
					(state) => state.list.scrollTop > 0,
				);
				const afterBodyEnd = await pressAndSettle(
					["End"],
					(state) =>
						Math.abs(state.list.scrollTop - state.list.max) <= 1 ||
						(state.active?.isBody === false && state.list.scrollTop > 0),
				);
				/* And the walk: Tab from the drawer's own chrome, then through the card. */
				await resetScroll();
				await pause(150);
				const chromeFocus = await focusOn(
					'[data-tour-tag="close-asks-button"]',
				);
				await keyPress(["Tab"]);
				const afterChromeTab = await read();
				/*
				 * THE FOCUSED FRAME (m3 = UX's U2), taken on the keyboard path: Tab from the
				 * drawer's chrome lands on the list, so `:focus-visible` is what put the ring
				 * on it (a programmatic `focus()` after a wheel does not always match). The
				 * ring is drawn INSET by its own width and offset now, and the claim the frame
				 * is here to make is geometric: all four of its edges paint inside the
				 * scrollport, where the outset ring lost two pixels a side to the clip.
				 * CANDIDATE ONLY: the control leg's ring IS the outset one, so its clipped
				 * corners are the defect rather than evidence of the fix.
				 */
				if (kind === "candidate" && size === "440x1024")
					await frame("long-ask-focused-440x1024");
				const tab = await tabWalk(40);
				readings[size] = {
					open,
					wheels,
					stickyTop,
					stickyMax,
					keys: {
						listFocus,
						bodyFocus,
						chromeFocus,
						beforeKeys,
						afterPageDown,
						afterEnd,
						afterHome,
						afterSpace,
						afterShiftSpace,
						afterBodyPageDown,
						afterBodyEnd,
					},
					afterChromeTab,
					tab,
				};
			}
			await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => null);
			const summary = Object.fromEntries(
				Object.entries(readings).map(([size, entry]) => [
					size,
					{
						list: {
							client: entry.open.list.client,
							max: entry.open.list.max,
							scrollTop: entry.open.list.scrollTop,
							tabIndex: entry.open.list.tabIndex,
							role: entry.open.list.role,
							name: entry.open.list.name,
							ariaLabel: entry.open.list.ariaLabel,
							scope: entry.open.list.scope,
							padding: entry.open.list.padding,
							actionsVar: entry.open.list.actionsVar,
						},
						containment: {
							body: entry.open.body?.contain,
							options: entry.open.options?.contain,
						},
						wheels: entry.wheels.map((wheel) => ({
							target: wheel.target,
							hit: wheel.point.hit,
							list: [wheel.before.list.scrollTop, wheel.after.list.scrollTop],
							body: [
								wheel.before.body?.scrollTop ?? null,
								wheel.after.body?.scrollTop ?? null,
							],
							options: [
								wheel.before.options?.scrollTop ?? null,
								wheel.after.options?.scrollTop ?? null,
							],
						})),
						sticky: {
							top: entry.stickyTop.send,
							max: entry.stickyMax.send,
							pinnedTop: entry.stickyTop.pinned,
							pinnedMax: entry.stickyMax.pinned,
							port: entry.stickyTop.list.box,
							portMax: entry.stickyMax.list.box,
						},
						keys: {
							listFocus: entry.keys.listFocus,
							bodyFocus: entry.keys.bodyFocus,
							pageDown: entry.keys.afterPageDown.list.scrollTop,
							end: entry.keys.afterEnd.list.scrollTop,
							/* THE SAME READ AS `end`, so the pair cannot disagree about the height. */
							endMax: entry.keys.afterEnd.list.max,
							endClient: entry.keys.afterEnd.list.client,
							endSettled: entry.keys.afterEnd.settled === true,
							endRetried: entry.keys.afterEnd.retried === true,
							home: entry.keys.afterHome.list.scrollTop,
							space: entry.keys.afterSpace.list.scrollTop,
							shiftSpace: entry.keys.afterShiftSpace.list.scrollTop,
							bodyPageDown: entry.keys.afterBodyPageDown.list.scrollTop,
							bodyEnd: entry.keys.afterBodyEnd.list.scrollTop,
						},
						chromeTab: {
							focus: entry.keys.chromeFocus,
							landedOnList: entry.afterChromeTab.active?.isList === true,
							landedOn: entry.afterChromeTab.active?.what ?? null,
						},
						tabWalk: {
							steps: entry.tab.path.length,
							covered: entry.tab.path.filter((step) => step.covered).length,
							outsidePort: entry.tab.path.filter((step) => !step.inside).length,
							sample: entry.tab.path.slice(0, 4),
							tail: entry.tab.path.slice(-4),
							/*
							 * THE FOCUS SCROLL ITSELF: the deepest scrollTop the walk reached, which
							 * is the list moving to bring a focused control into view (a walk that
							 * never moved it proves only that the card happened to fit).
							 */
							maxScroll: entry.tab.path.reduce(
								(max, step) => Math.max(max, step.scrollTop ?? 0),
								0,
							),
							leftAfter: entry.tab.left,
						},
					},
				]),
			);
			stamp("longAskScroll", summary);
			/*
			 * THE ASSERTIONS, per leg. The candidate has to show the remedy on every door; the
			 * control has to show the defect, or the pair has stopped proving anything.
			 */
			for (const [size, entry] of Object.entries(summary)) {
				for (const wheel of entry.wheels) {
					const [before, after] = wheel.list;
					if (kind === "candidate")
						assert(
							after > before,
							`${size}: a wheel over the ${wheel.target} must move the drawer's list (was ${before}, now ${after}; the nearest box is ${wheel.hit})`,
						);
					else
						assert.equal(
							after,
							before,
							`${size}: the pre-fix build's list must NOT move from a wheel over the ${wheel.target} - this reading is the defect the case exists for`,
						);
				}
				if (kind === "candidate") {
					assert.equal(
						entry.containment.body,
						"auto",
						`${size}: the question body must hand the gesture up (computed overscroll-behavior-y auto)`,
					);
					assert.equal(
						entry.containment.options,
						"auto",
						`${size}: the option list must hand the gesture up`,
					);
					assert.equal(
						entry.list.tabIndex,
						"0",
						`${size}: the drawer's list must be in the Tab walk while it overflows`,
					);
					assert.equal(
						entry.list.role,
						"region",
						`${size}: the stop must be a region`,
					);
					assert(
						entry.list.name !== null && entry.list.name.length > 0,
						`${size}: the stop must carry an accessible name`,
					);
					/*
					 * THE NAME IS THE CONTENT'S, NOT THE STATUS LINE (agent review round 1, U3):
					 * naming the region from the bar made it announce "1 question waiting" as if
					 * that were the box. It now reads the rail door's register, so it differs
					 * from the bar's own line above it and agrees with the control that opened
					 * the pane.
					 */
					assert.notEqual(
						entry.list.name,
						entry.list.scope,
						`${size}: the region's name must not be the status line (both read ${JSON.stringify(entry.list.name)})`,
					);
					assert(
						Number.parseFloat(entry.list.padding) > 0,
						`${size}: the list needs a scroll-padding-bottom that clears the pinned row (got ${entry.list.padding})`,
					);
					assert.equal(
						entry.sticky.top?.inPort,
						true,
						`${size}: Send answer must be inside the port at the top of the scroll`,
					);
					assert.equal(
						entry.sticky.max?.inPort,
						true,
						`${size}: Send answer must be inside the port at the maximum`,
					);
					/*
					 * FLUSH AT THE MAXIMUM (design round 1, D3): the card's own bottom IS the
					 * port's at that scroll position, so the band must reach it. `-my-2 py-2`
					 * stopped 4 px short and left a strip of question text under the bar; the
					 * 1 px slack is sub-pixel rounding, not the defect.
					 */
					assert(
						Math.abs(
							entry.sticky.pinnedMax.bottom - entry.sticky.portMax.bottom,
						) <= 1,
						`${size}: the pinned row must be flush with the port's bottom at the maximum (row bottom ${entry.sticky.pinnedMax.bottom}, port bottom ${entry.sticky.portMax.bottom})`,
					);
					assert(
						entry.keys.pageDown > 0,
						`${size}: PageDown on the list must scroll it (got ${entry.keys.pageDown})`,
					);
					assert(
						Math.abs(entry.keys.end - entry.keys.endMax) <= 1,
						`${size}: End on the list must reach its maximum (end read scrollTop ${entry.keys.end} of max ${entry.keys.endMax} at client ${entry.keys.endClient}, settled ${entry.keys.endSettled}, retry used ${entry.keys.endRetried}; the open read was scrollTop ${entry.list.scrollTop} of max ${entry.list.max}; the 1 px slack is sub-pixel layout, not a short scroll)`,
					);
					assert.equal(
						entry.keys.home,
						0,
						`${size}: Home on the list must return to its top`,
					);
					assert(
						entry.keys.space > entry.keys.home,
						`${size}: Space on the list must page it down`,
					);
					assert(
						entry.keys.shiftSpace < entry.keys.space,
						`${size}: Shift+Space on the list must page it back up (Space settled at ${entry.keys.space}, Shift+Space at ${entry.keys.shiftSpace})`,
					);
					assert(
						entry.keys.bodyPageDown > 0,
						`${size}: PageDown from the question body must reach the drawer's list (got ${entry.keys.bodyPageDown})`,
					);
					assert(
						entry.chromeTab.landedOnList,
						`${size}: Tab from the drawer's chrome must land on the list region (landed on ${entry.chromeTab.landedOn})`,
					);
					assert(
						entry.tabWalk.steps > 8,
						`${size}: the Tab walk left the card after ${entry.tabWalk.steps} stops, so it proved nothing`,
					);
					assert(
						entry.tabWalk.maxScroll > 0,
						`${size}: the Tab walk never scrolled the list, so it never carried focus past the fold`,
					);
					assert.equal(
						entry.tabWalk.covered,
						0,
						`${size}: ${entry.tabWalk.covered} focused control(s) ended up under the pinned row`,
					);
					assert.equal(
						entry.tabWalk.outsidePort,
						0,
						`${size}: ${entry.tabWalk.outsidePort} focused control(s) were not scrolled wholly into the port`,
					);
				} else {
					assert.equal(
						entry.containment.body,
						"contain",
						`${size}: the pre-fix build's question body must still contain the gesture`,
					);
					assert.equal(
						entry.sticky.top?.inPort,
						false,
						`${size}: the pre-fix build cannot have Send answer inside the port at the top - that is the clipping this case exists for`,
					);
					assert.equal(
						entry.chromeTab.landedOnList,
						false,
						`${size}: the pre-fix list is not a Tab stop`,
					);
				}
			}
		},
	},
	palette: {
		purpose:
			"The command palette: an INTERACTIVE surface with a real state, opened from its own sidebar row and closed with Escape, with commandPaletteOpen read from the store at each end so the pair shows one state reached and one left.",
		route: "/chat",
		frames: {
			control: ["palette-open", "palette-closed"],
			candidate: ["palette-open", "palette-closed"],
		},
		coverage:
			"real assembled app renderer/handlers/store; not native WCV compositor pixels or macOS z-order",
		drive: async (ctx) => {
			const {
				wait,
				press,
				pressEscape,
				waitFor,
				facts,
				frame,
				fixtureMode,
				session,
			} = ctx;
			await fixtureMode("populated");
			await session(0);
			/*
			 * THE SIDEBAR ROW IS THE DOOR THE SHARED DRIVER'S OWN PALETTE SCENES USE
			 * (`renderer-driver.mjs` presses `[data-command-palette-trigger]` and then
			 * asserts the dialog and the focused field), so this case drives the same
			 * control rather than inventing a second way in.
			 */
			await press("[data-command-palette-trigger]");
			const opened = await waitFor(
				async () => (await facts()).state.commandPaletteOpen === true,
				15_000,
			);
			assert.equal(
				opened.state.commandPaletteOpen,
				true,
				`the command palette never opened: commandPaletteOpen=${opened.state.commandPaletteOpen} state=${JSON.stringify(opened.state)}`,
			);
			await wait(
				'Boolean(document.querySelector("[data-tour-tag=command-palette-dialog]"))',
			);
			await frame("palette-open");
			/*
			 * ESCAPE IS THE PALETTE'S OWN CLOSE PATH (the dialog's `onOpenChange`
			 * writes `closeCommandPalette`), so the pair is a real open and a real
			 * close rather than a state poked from the driver.
			 */
			await pressEscape();
			const shut = await waitFor(
				async () => (await facts()).state.commandPaletteOpen === false,
				15_000,
			);
			assert.equal(
				shut.state.commandPaletteOpen,
				false,
				`the command palette never closed on Escape: commandPaletteOpen=${shut.state.commandPaletteOpen} state=${JSON.stringify(shut.state)}`,
			);
			await frame("palette-closed");
		},
	},
	"header-menu": {
		purpose:
			"The chat header's real menu: a COPY-ONLY surface. Its rows are still LITERAL English on this head - the chat-header extraction belongs to #1070's held scope - so this case does not claim extracted copy: it asserts that every row renders with copy at all (rather than a screenshot of an empty popup) and that the asks row is present, which is the 'the surface still renders' half of the i18n evidence pair.",
		route: "/chat",
		frames: {
			control: ["header-menu", "header-menu-closed"],
			candidate: ["header-menu", "header-menu-closed"],
		},
		coverage:
			"real assembled app renderer/handlers/store; not native WCV compositor pixels or macOS z-order",
		drive: async (ctx) => {
			const { cdp, wait, press, pressEscape, frame, fixtureMode, session } =
				ctx;
			await fixtureMode("populated");
			await session(0);
			/*
			 * THE MENU BUTTON IS FOUND THE WAY THE ASKS CASE FINDS IT - the header's
			 * own `aria-haspopup` control, marked so the press can address it - which
			 * keeps one way of reaching this control in the file.
			 */
			await cdp.evaluate(
				`(()=>{const h=document.querySelector('[data-tour-tag="chat-header"]');const e=[...h.querySelectorAll('button')].find(e=>e.getAttribute('aria-haspopup')==='menu');if(!e)throw Error('real header menu unavailable');e.setAttribute('data-ci-menu','')})()`,
			);
			await press("[data-ci-menu]");
			await wait(
				`document.querySelectorAll('[role="menuitem"]').length > 0`,
				MENU_TRIGGER_SEEN,
			);
			const labels = await cdp.evaluate(
				`[...document.querySelectorAll('[role="menuitem"]')].map(e=>e.textContent.trim())`,
			);
			assert(labels.length > 0, "the header menu rendered no rows");
			assert(
				labels.every((label) => label.length > 0),
				`a header menu row rendered empty copy: ${JSON.stringify(labels)}`,
			);
			/*
			 * THE ASKS ROW IS THE ONE ROW THIS CASE CAN NAME WITHOUT PINNING A
			 * DIRECTION: it reads "Open asks" or "Close asks" depending on whether the
			 * drawer is up, and the case does not open it. So what is asserted is that
			 * the row is there and that every row carries copy.
			 */
			assert(
				labels.some((label) => /asks/i.test(label)),
				`the header menu lost its asks row: ${JSON.stringify(labels)}`,
			);
			await frame("header-menu");
			await pressEscape();
			await wait(`document.querySelectorAll('[role="menuitem"]').length === 0`);
			await frame("header-menu-closed");
		},
	},
};

/**
 * Run one case's one leg, in its own process.
 *
 * The runner owns what every case needs and no case should re-implement: the
 * working directory the app launches from, the driver import (so a control leg
 * imports the HISTORICAL tree's driver), the launch and CDP attach, the
 * onboarding-script reload, the readiness waits, the frame/measurement store, and
 * a finally that reaps exactly the app this run started.
 */
async function runCase(
	scenarioName,
	kind,
	root,
	output,
	records,
	realBackend = null,
	verifiedElectronBinary = undefined,
) {
	process.chdir(root);
	process.argv.push(
		"--backend",
		"http://127.0.0.1:8080",
		"--backend-records",
		records,
		"--out",
		output,
	);
	const { rendererDriverApi: api } = await import(
		pathToFileURL(join(root, "scripts/renderer-driver.mjs"))
	);
	/*
	 * THE CASE IS RESOLVED BEFORE ANYTHING IS LAUNCHED, so a name outside the table
	 * cannot get as far as an artifact root, a fixture or an Electron binary.
	 */
	const scenario = CASES[scenarioName];
	assert(scenario, `unknown case ${scenarioName}`);
	let cdp;
	let rc = 1;
	const frames = [];
	const failures = [];
	let appDrain;
	const drainModelApp = (why) => {
		if (!appDrain)
			appDrain = (async () => {
				const receipt = await api.drainLiveBoots({ why });
				assert.equal(
					receipt.clean,
					true,
					"owned app exit/descendants not settled",
				);
				writeFileSync(
					join(output, "owned-app-exit.json"),
					JSON.stringify(receipt),
				);
			})();
		return appDrain;
	};
	for (const name of ["SIGTERM", "SIGINT"])
		process.once(name, () => {
			if (!realBackend) {
				void api.reapLiveBoots({ code: 143, why: `CI ${name}` });
				return;
			}
			void (async () => {
				try {
					try {
						try {
							cdp?.close();
						} finally {
							await drainModelApp(`CI ${name}`);
						}
					} finally {
						await realBackend.close();
					}
				} catch (error) {
					console.error("owned model case interruption cleanup failed", error);
				} finally {
					process.exit(143);
				}
			})();
		});
	const save = () =>
		writeFileSync(
			join(output, "measurements.json"),
			JSON.stringify({ case: scenarioName, kind, frames, failures }, null, 2),
		);
	/**
	 * Wait for a condition, and ON TIMEOUT SAY WHAT WAS SEEN (#1131). The bare expression
	 * is not enough to tell a press that never landed from a menu that never rendered, so
	 * a caller can pass a second expression read only on the failure path; a diagnostic
	 * that itself fails is reported as such rather than replacing the timeout.
	 */
	async function wait(expression, diagnose) {
		for (let i = 0; i < 150; i++) {
			if (await cdp.evaluate(expression)) return;
			await pause(100);
		}
		let seen = "";
		if (diagnose) {
			try {
				seen = ` - ${await cdp.evaluate(diagnose)}`;
			} catch (error) {
				seen = ` - the diagnostic read itself failed: ${error.message}`;
			}
		}
		throw Error(`Unsettled real UI: ${expression}${seen}`);
	}
	async function press(selector) {
		const target = JSON.stringify(selector);
		await wait(`Boolean(document.querySelector(${target}))`);
		const claim = JSON.stringify(`press-${++pressClaim}`);
		await pressWhenActionable({
			selector,
			/*
			 * The reading is taken IN THE PAGE, because the box, the hit test and the
			 * identity claim all live there. `stable` compares the claim this press set on
			 * the previous read: one press = one unique claim, so the first read is always
			 * unstable and the press waits for a read that sees its own claim still there.
			 */
			probe: async () =>
				cdp.evaluate(
					`(()=>{const el=document.querySelector(${target});if(!el)return{present:false};const r=el.getBoundingClientRect();const label=(n)=>n?[n.tagName.toLowerCase(),n.getAttribute("data-tour-tag")?'[data-tour-tag="'+n.getAttribute("data-tour-tag")+'"]':"",n.getAttribute("role")?'[role="'+n.getAttribute("role")+'"]':"",n.getAttribute("aria-label")?'[aria-label="'+n.getAttribute("aria-label")+'"]':""].join(""):"nothing";if(r.width<=0||r.height<=0)return{present:true,painted:false,at:label(el)};const x=r.x+r.width/2,y=r.y+r.height/2,at=document.elementFromPoint(x,y);const stable=el.__lopPressClaim===${claim};el.__lopPressClaim=${claim};return{present:true,painted:true,hit:at===el||el.contains(at),at:label(at),stable,x:Math.round(x),y:Math.round(y)}})()`,
				),
			dispatch: async (point) => {
				for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
					await cdp.send("Input.dispatchMouseEvent", {
						type,
						button: type === "mouseMoved" ? "none" : "left",
						clickCount: 1,
						...point,
					});
			},
		});
	}
	/**
	 * Poll `probe` until it answers true, and hand back the LAST state read.
	 *
	 * It does not raise: the caller's own assertion is the gate, so the requirement
	 * has exactly one failure path and that path can carry the diagnostics. On a
	 * timeout it simply returns what it last saw, which the caller reports.
	 */
	async function waitFor(probe, timeoutMs) {
		const started = Date.now();
		for (;;) {
			if (await probe()) return await facts();
			if (Date.now() - started > timeoutMs) return await facts();
			await pause(250);
		}
	}
	async function pressEscape() {
		for (const type of ["keyDown", "keyUp"])
			await cdp.send("Input.dispatchKeyEvent", {
				type,
				key: "Escape",
				code: "Escape",
				windowsVirtualKeyCode: 27,
			});
	}
	async function facts() {
		return {
			state: await api.verb(cdp, "state"),
			dom: await cdp.evaluate(
				`({ask:!!document.querySelector('[data-ask-drawer]'),focus:document.activeElement?.outerHTML.slice(0,400),focusedConnected:!!document.activeElement?.isConnected,panes:[...document.querySelectorAll('[data-ask-drawer],[data-tour-tag="browser-pane"]')].map(e=>({ask:e.hasAttribute('data-ask-drawer'),rect:e.getBoundingClientRect().toJSON(),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth})),text:document.body.innerText.slice(-1800)})`,
			),
		};
	}
	async function frame(label) {
		const first = await api.capture(cdp, `${kind}-${label}-first`, {
			assertPalette: false,
		});
		const firstFacts = await facts();
		await pause(180);
		const settled = await api.capture(cdp, `${kind}-${label}-settled`, {
			assertPalette: false,
		});
		const measured = await facts();
		for (const pane of measured.dom.panes)
			assert(
				pane.scrollWidth <= pane.clientWidth + 1,
				`${label} horizontal overflow`,
			);
		frames.push({ label, first, settled, firstFacts, ...measured });
		save();
		return measured;
	}
	/**
	 * Record a reading on the case's most recent frame - THE RUNNER'S OWN DOOR, because
	 * the frame store is this function's local and a case cannot reach it (round 2,
	 * Q-4).
	 *
	 * A case stamping `frames.at(-1).something = ...` itself compiles, reads as an
	 * ordinary mutation and dies only where `frames` does not exist: measured on run
	 * 38955215215 as `ReferenceError: frames is not defined at Object.drive
	 * (asks-app-regression.mjs:455:4)`, on the FIRST leg, before either new case had
	 * ever run. So the stamp goes through here, and the guard beside this file drives a
	 * real case against stub helpers so the same slip fails locally.
	 */
	function stamp(key, value) {
		assert(frames.length > 0, `stamp(${key}) with no frame captured yet`);
		frames.at(-1)[key] = value;
		save();
		return frames.at(-1);
	}
	async function fixtureMode(mode) {
		const response = await fetch("http://127.0.0.1:8080/__fixture/state", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ mode }),
		});
		assert.equal(response.status, 200);
	}
	async function session(index) {
		await wait(
			'document.querySelectorAll("[data-tour-tag=chat-session-row]").length===2',
		);
		await cdp.evaluate(
			`(()=>{const e=[...document.querySelectorAll('[data-tour-tag="chat-session-row"]')].find(e=>e.textContent.includes('Synthetic CI session ${index + 1}'));if(!e)throw Error('seeded session row missing');e.setAttribute('data-ci-session','${index}')})()`,
		);
		await press(`[data-ci-session="${index}"]`);
		/*
		 * The open is confirmed by READING the state through the driver, from Node,
		 * in a bounded poll. Calling `window.__loDevDriver.call('state')` inside a
		 * page expression and awaiting its `.then` does NOT work: the verb's return
		 * is not a page promise, so the expression threw
		 * `TypeError: window.__loDevDriver.call(...).then is not a function` (run
		 * 38849663528) and took the case down before any frame. `verb()` already
		 * resolves the answer over CDP - that is the documented door, and it is how
		 * the shared driver's own scenes read this exact field.
		 */
		const wanted = ASK_SESSION_IDS[index];
		const deadline = Date.now() + 20_000;
		for (;;) {
			const live = await api.verb(cdp, "state");
			if (live.activeSessionId === wanted) return;
			if (Date.now() > deadline)
				throw Error(
					`session ${index} never became active (active=${JSON.stringify(live.activeSessionId)})`,
				);
			await pause(250);
		}
	}
	/*
	 * WHAT A CASE DRIVES WITH: the generic helpers only. The asks-only doors
	 * (`browser`, `asks`, `closed`) live inside the asks case, because putting a
	 * case-specific door on a shared context is how a framework starts growing.
	 */
	const ctx = {
		kind,
		api,
		realBackend,
		get cdp() {
			return cdp;
		},
		wait,
		press,
		waitFor,
		pressEscape,
		facts,
		frame,
		stamp,
		fixtureMode,
		session,
	};
	try {
		if (realBackend)
			assert.equal(
				typeof api.drainLiveBoots,
				"function",
				"real-core case requires a non-exiting owned app drain",
			);
		if (realBackend)
			assert(
				verifiedElectronBinary,
				"model launch needs the preflight-verified executable",
			);
		api.prepareDriverContext({ apiUrl: "http://127.0.0.1:8080" });
		const app = await api.launchApp({
			armed: true,
			apiUrl: "http://127.0.0.1:8080",
			tag: `asks-ci-${kind}`,
			verifiedElectronBinary,
		});
		writeFileSync(
			join(output, "owned-app.json"),
			JSON.stringify({ pid: app.pid, inspector: app.inspectPort }),
		);
		/*
		 * The debugging endpoint answers `/json/version` before the app has a
		 * window, and `CdpClient.attach` then waits for the page TARGET - so the
		 * endpoint wait comes first, as it does at every other caller in the shared
		 * driver. Attaching straight after `launchApp` is the defect CI caught: the
		 * port was not listening yet, `fetch` REJECTED, and the rejection escaped
		 * the attach loop as a bare `TypeError: fetch failed`.
		 *
		 * WHY THIS IS NOT JUST `api.waitForDevtools`. This case runs against TWO
		 * driver trees: the candidate one from the checkout, and - in the control
		 * leg - the PINNED HISTORICAL tree unpacked from `control-source.tar`,
		 * which is imported from `root/scripts/renderer-driver.mjs` below. That
		 * historical facade exports six keys and no wait (2461cfa3), so calling
		 * the newer surface directly would make the control leg throw for a reason
		 * unrelated to the app. The wait is therefore resolved through the api when
		 * the tree offers it and otherwise repeated here, and what the control leg
		 * needs - a port that is listening before anybody attaches - holds either
		 * way. Same bounded poll, same 60s ceiling, same message.
		 */
		await waitForDevtoolsPort(app, api);
		cdp = await api.CdpClient.attach(app.port, "out/renderer/index.html");
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
			source:
				'localStorage.setItem("onboarding-storage",JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:"create_agent"},version:0}));',
		});
		await cdp.send("Page.reload", { ignoreCache: false });
		/*
		 * The page paint and the bridge registration, in the order every scene in
		 * the shared driver uses them. Waiting on `Boolean(window.__loDevDriver)`
		 * instead - which is what this did - is satisfied the moment the object
		 * EXISTS, before it has registered a single verb, and the first
		 * `api.verb(cdp, "navigate", …)` then failed with "no dev driver verb
		 * navigate (have: none yet)". Both waits go through the same api-else-poll
		 * resolution as the port wait above, because the control leg imports the
		 * pinned historical facade, which does not export them either.
		 */
		await waitForSceneReady(cdp, api);
		const windowFacts = await cdp.evaluate("window.__loDevDriver.facts()");
		assert.equal(windowFacts.visible, false);
		assert.equal(windowFacts.focused, false);
		await api.verb(cdp, "navigate", scenario.route);
		await scenario.drive(ctx);
		/*
		 * THE PROMISED FRAMES ARE A CONTRACT, not a wish: a case that stops early or
		 * loses a capture fails here rather than publishing an artifact thinner than
		 * it declares. The acceptance row is pushed after this check, so it cannot
		 * stand in for a missing frame.
		 */
		const promised = scenario.frames[kind];
		assert(
			Array.isArray(promised) && promised.length > 0,
			`${scenarioName}: no frames promised for the ${kind} leg`,
		);
		for (const label of promised)
			assert(
				frames.some((entry) => entry.label === label),
				`${scenarioName} ${kind}: promised frame ${JSON.stringify(label)} was not captured (have ${JSON.stringify(frames.map((entry) => entry.label))})`,
			);
		if (!realBackend)
			frames.push({
				label: "acceptance",
				verdict: "PASS",
				coverage: scenario.coverage,
			});
		save();
		rc = 0;
	} catch (error) {
		/*
		 * THE STACK GOES TO THE LOG AS WELL AS THE ARTIFACT. `rc` stays 1 here, so
		 * this catch is the only place a failing case can say why, and it used to
		 * say nothing: the stacks went into `measurements.json`, the process exited
		 * 1 from `reapLiveBoots`, and CI kept only whatever the caller printed. For
		 * the model-uncertainty case that caller is `runOwnedModelCase`, which
		 * re-throws the exit status as a bare `model case failed (1)`
		 * (`scripts/model-uncertainty-native.mjs:57-63`), so the real cause - an
		 * `AssertionError: required genuine carrier not captured` - had to be
		 * recovered by downloading the artifact and diffing two runs. Reading it
		 * off the CI log is the whole point of this line.
		 *
		 * STDERR, NEVER STDOUT. `scripts/entry-point.test.mjs` pins `stdout: /^$/`
		 * for this script's refusal, and stdout is the channel a case's own
		 * acceptance reading could be mistaken for. The artifact keeps the stacks
		 * unchanged: it is the durable evidence, and this only makes the log
		 * self-sufficient. Nothing parses this script's stderr - `ci.yml` runs it
		 * with no redirection - so the emission cannot move a verdict elsewhere.
		 */
		const stack = error?.stack ?? String(error);
		// Before `save()`: a failing artifact write must not swallow the reason.
		console.error(
			`asks-app-regression: runCase ${scenarioName} ${kind} failed; the stack below is also saved in ${join(output, "measurements.json")}\n${stack}`,
		);
		failures.push(stack);
		save();
	} finally {
		const why = `CI ${scenarioName} ${kind} case complete`;
		if (realBackend) {
			try {
				cdp?.close();
			} finally {
				await drainModelApp(why);
			}
		} else {
			cdp?.close();
			await api.reapLiveBoots({ code: rc, why });
		}
	}
	return rc;
}

async function main() {
	// This explicit opt-in never starts/widens the read-only asks fixture.
	if (
		process.argv[process.argv.indexOf("--case") + 1] === "model-uncertainty"
	) {
		assert.equal(
			process.argv[process.argv.indexOf("--leg") + 1],
			"candidate",
			"model case currently admits the reviewed candidate leg only",
		);
		assert(
			process.env.CI && process.platform === "darwin",
			"existing macOS native producer owns model-case execution",
		);
		const root = process.env.ASKS_APP_ROOT;
		const output = process.env.ASKS_OUTPUT;
		assert(root && output, "model case needs its frozen app root/output");
		// Carry the strict preflight's actual executable through to spawn. Merely
		// scrubbing the child env cannot constrain the parent's Electron resolver.
		const verifiedElectronBinary = verifyModelBuild(
			root,
			process.env.MODEL_CASE_BUILD_RECEIPT,
		);
		mkdirSync(output, { recursive: true });
		const backend = await startModelBackend({
			output,
			scratchParent: tmpdir(),
		});
		process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = backend.token;
		return runOwnedModelCase({
			backend,
			run: async () => {
				writeFileSync(
					join(output, "provenance.json"),
					JSON.stringify(
						{
							build: JSON.parse(
								readFileSync(process.env.MODEL_CASE_BUILD_RECEIPT),
							),
							core: (await backend.state()).identity,
							expectedPublishedTarget:
								"a8c96c2ac1d71b776f40ed68ae5a2322bbe3c1ed",
							coverage:
								"candidate compiled app with published real core; no historical native control or WCV compositor claim",
						},
						null,
						2,
					),
				);
				return await runCase(
					"model-uncertainty",
					"candidate",
					root,
					output,
					backend.records,
					backend,
					verifiedElectronBinary,
				);
			},
			accept: async () => {
				const receipt = JSON.parse(
					readFileSync(join(output, "owned-core-exit.json")),
				);
				assert.equal(
					receipt.clean,
					true,
					"required joined backend exit receipt missing",
				);
				const appExit = JSON.parse(
					readFileSync(join(output, "owned-app-exit.json")),
				);
				assert.equal(appExit.clean, true);
				assert.equal(appExit.stopped, 1, "single native app was not joined");
				const path = join(output, "measurements.json");
				const measurement = JSON.parse(readFileSync(path));
				measurement.frames.push({
					label: "acceptance",
					verdict: "PASS",
					coverage: modelUncertaintyCase.coverage,
					cleanup: receipt,
				});
				writeFileSync(path, JSON.stringify(measurement, null, 2));
			},
		});
	}
	if (process.argv.includes("--case")) {
		const i = process.argv.indexOf("--case");
		const scenario = process.argv[i + 1];
		const j = process.argv.indexOf("--leg");
		const kind = j >= 0 ? process.argv[j + 1] : undefined;
		const needed = ["ASKS_APP_ROOT", "ASKS_OUTPUT", "ASKS_RECORDS"];
		const missing = needed.filter((name) => !process.env[name]);
		if (
			!Object.hasOwn(CASES, scenario) ||
			!["control", "candidate"].includes(kind) ||
			missing.length > 0
		) {
			console.error(
				`asks-app-regression: --case needs <scenario> from ${Object.keys(CASES).join("|")} --leg control|candidate and ${needed.join(", ")} (missing ${missing.join(", ") || "none"})`,
			);
			process.exitCode = 1;
			return;
		}
		return runCase(
			scenario,
			kind,
			process.env.ASKS_APP_ROOT,
			process.env.ASKS_OUTPUT,
			process.env.ASKS_RECORDS,
		);
	}
	assert.equal(
		process.platform,
		"darwin",
		"Existing macOS NPX leg owns native execution; no Linux sandbox waiver",
	);
	assert(
		process.env.CI,
		"Native regression producer runs in normal CI only; source unit tests import exports",
	);
	const output = resolve("artifacts/asks-app");
	mkdirSync(output, { recursive: true });
	const scratch = join(tmpdir(), `asks-app-ci-${process.pid}`);
	mkdirSync(scratch);
	const token = randomBytes(24).toString("hex");
	const fixture = await startAsksAppFixture({ root: scratch, token });
	for (const entry of [
		"out/main/index.js",
		"out/preload/index.js",
		"out/renderer/index.html",
	])
		assert(existsSync(entry), `Production build missing ${entry}`);
	const manifest = {
		format: 1,
		requestedHead: process.env.QA_REQUESTED_HEAD,
		checkout: git("rev-parse", "HEAD"),
		sourceTree: git("rev-parse", "HEAD:src"),
		scriptsTree: git("rev-parse", "HEAD:scripts"),
		productionOutputs: Object.fromEntries(
			files(resolve("out")).map((p) => [
				p.slice(resolve("out").length + 1),
				sha(readFileSync(p)),
			]),
		),
		control: ASKS_CONTROL,
		cases: Object.keys(CASES).filter((name) => !CASES[name].optInOnly),
		captures: [],
		physical1106:
			"NOT COVERED: capturePage excludes sibling native WebContentsView/compositor",
		fixture: "owned loopback HTTP; no bridge or UI replacements",
	};
	let primaryError = null;
	try {
		const { legEnv: controlLegEnv, ...controlIdentity } = await prepareControl(
			join(scratch, "control-app"),
			output,
		);
		manifest.controlIdentity = controlIdentity;
		const controlArchive = join(output, "control-source.tar");
		manifest.controlSourceArchive = {
			path: "control-source.tar",
			sha256: sha(readFileSync(controlArchive)),
		};
		for (const [scenarioName, scenario] of Object.entries(CASES).filter(
			([, entry]) => !entry.optInOnly,
		)) {
			for (const kind of ["control", "candidate"]) {
				fixture.setMode("loading");
				const root =
					kind === "control" ? join(scratch, "control-app") : process.cwd();
				/*
				 * THE ASKS CASE KEEPS `<output>/control|candidate` (see its
				 * `legacyOutputLayout` note); every other case gets its own directory,
				 * so two cases cannot overwrite each other's measurements.
				 */
				const dir = scenario.legacyOutputLayout
					? join(output, kind)
					: join(output, scenarioName, kind);
				mkdirSync(dir, { recursive: true });
				await execute(
					process.execPath,
					[
						fileURLToPath(import.meta.url),
						"--case",
						scenarioName,
						"--leg",
						kind,
					],
					{
						cwd: root,
						env: {
							...process.env,
							LOCAL_OPERATOR_DESKTOP_TOKEN: token,
							LOCAL_OPERATOR_CONFIG_DIR: scratch,
							LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
							LOCAL_OPERATOR_UI_TELEMETRY: "off",
							ASKS_APP_ROOT: root,
							ASKS_OUTPUT: dir,
							ASKS_RECORDS: fixture.records,
							// Only the control leg gets its Electron runtime override.
							...(kind === "control" ? controlLegEnv : {}),
						},
						timeout: 150000,
						maxBuffer: 4 * 1024 * 1024,
					},
				);
				const measured = JSON.parse(
					readFileSync(join(dir, "measurements.json"), "utf8"),
				);
				assert(measured.frames.some((x) => x.verdict === "PASS"));
				/*
				 * A CASE'S RECORDED READINGS ARE LIFTED INTO THE MANIFEST, so a reviewer
				 * skimming `manifest.json` sees the evidence pair without unpacking every
				 * leg's `measurements.json`: the asks case records which close policy each
				 * revision has here, control beside candidate (remediation round 1, stream A).
				 */
				const readings = Object.fromEntries(
					measured.frames
						.filter((frame) => frame.railClosePolicy)
						.map((frame) => [frame.label, frame.railClosePolicy]),
				);
				manifest.captures.push({
					case: scenarioName,
					kind,
					...(Object.keys(readings).length > 0 ? { readings } : {}),
					files: files(dir).map((p) => ({
						path: p.slice(output.length + 1),
						sha256: sha(readFileSync(p)),
					})),
				});
			}
		}
	} catch (error) {
		primaryError = error;
		throw error;
	} finally {
		manifest.requests = fixture.requests;
		writeFileSync(
			join(output, "manifest.json"),
			JSON.stringify(manifest, null, 2),
		);
		/*
		 * THE CLOSE COMES BEFORE THE TRAFFIC ASSERTIONS, and that ordering is the
		 * fix for a measured hang rather than a tidiness preference. The assertions
		 * used to sit ahead of it, so the first one that threw skipped
		 * `fixture.close()` entirely: the fixture's HTTP listener stayed open, the
		 * child producer was left holding it, and the CI step ran on with nothing
		 * to do until GitHub killed it at its own 8-minute ceiling (measured on run
		 * 38844071896: the assertion failed at 03:30:46, the step was killed at
		 * 03:37:55, and `node` was then reaped as an orphan). A failed assertion is
		 * a verdict; a leaked listener is an outage that hides it.
		 *
		 * The assertions also do not run over a run that ALREADY failed: a second
		 * message about traffic says nothing the first failure did not, and burying
		 * a real failure under a derived one is the pattern this suite exists to
		 * remove.
		 */
		await fixture.close();
		if (primaryError === null) assertTrafficAllowed(fixture.requests);
	}
}

/**
 * Every request this run made of the fixture, against what the fixture is
 * allowed to have served.
 *
 * Reads only, plus the two modelled POSTs: `/watch`, the push subscription the
 * fixture answers, and `/__fixture/state`, its own control door. The Radient
 * proxy (`POST /v1/desktop/radient`) is a POST the app legitimately makes for its
 * quota notice and the fixture answers for the READ operations only, so it is
 * admitted here as a read door - the forbidden-write pattern below is what keeps
 * the turn and answer routes shut, and it is checked first.
 */
function assertTrafficAllowed(requests) {
	const forbidden =
		/\/(send|answer|answers|interrupt|steer|messages|turns)(\/|$|\?)/;
	for (const request of requests) {
		assert(
			!forbidden.test(request.path),
			`fixture traffic reached a forbidden write: ${request.method} ${request.path}`,
		);
		const allowedPost = [
			"/watch",
			"/__fixture/state",
			"/v1/desktop/radient",
		].some((suffix) => request.path.endsWith(suffix));
		assert(
			request.method === "GET" || allowedPost,
			`fixture traffic used an unmodelled method: ${request.method} ${request.path}`,
		);
		/*
		 * THE PROPERTY IS "NO UNAUTHENTICATED WRITE", NOT "EVERY READ CARRIES A
		 * BEARER", and the difference is measured rather than assumed. The app's
		 * desktop transport attaches `Authorization` only when it holds a token
		 * (`desktop-transport.ts`: the header is spread in `...(token ? … : {})`, and
		 * `request.op !== "capabilities" && !token` is an explicit no-token path), so
		 * a read issued before the app has resolved one is ordinary app behaviour -
		 * measured here as 7 unauthenticated requests out of 153 in run 38852393821,
		 * of them `/v1/credentials` (3) beside `/health` (4). The fixture answers
		 * those 401, so nothing unauthenticated is ever served.
		 *
		 * What the scene must refuse is an unauthenticated request that is not a
		 * READ, and that is what is asserted: a bare read is the app asking a
		 * question, while a bare write would be this fixture's door left open.
		 */
		assert(
			request.authenticated || request.method === "GET",
			`fixture traffic was an unauthenticated non-read: ${request.method} ${request.path}`,
		);
	}
}
if (isEntryPoint(import.meta.url))
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
