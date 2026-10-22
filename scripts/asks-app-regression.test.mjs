/* Cheap fixture/oracle controls. Native UI acceptance is ONLY the CI app run;
 * this suite never launches Electron or claims rendered evidence. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The checkout this suite ships in, for reading the pinned control revision. */
const REPO = dirname(
	dirname(fileURLToPath(new URL("./asks-app-regression.mjs", import.meta.url))),
);
import { test } from "node:test";
import {
	ASK_SESSION_IDS,
	askFixture,
	sessionSnapshot,
	startAsksAppFixture,
} from "./asks-app-fixture.mjs";
import {
	ASKS_CONTROL,
	ASKS_CONTROL_PINNED,
	ASKS_RAIL_CLOSE_POST_STATE,
	CASES,
	CONTROL_BUILD_NODE_ARGS,
	CONTROL_REUSE_PARTS,
	controlReusePlan,
	describeMainPreloadReuse,
	describePressRead,
	pressWhenActionable,
	railCloseAssertion,
	railCloseReading,
	resolveAsksControl,
} from "./asks-app-regression.mjs";
import { categoryOf, flagsFor } from "./ci-scope.mjs";

/*
 * THE PRESS GATE (#1131's red leg, hardened here). `press` must not dispatch input at a
 * point where the target cannot receive it, and it must not wait forever for a target
 * that is being replaced. These drive the exported gate directly with scripted readings
 * - the same technique as the stub-context guard below, one level down - so the failure
 * mode that cost a macOS run (a swallowed press, then a bare timeout) fails here at
 * unit cost.
 */
test("the press gate waits for actionability, presses once, and names what blocked it", async () => {
	/*
	 * NEVER HIT-TESTABLE: the gate must stop at its read bound rather than pressing, and
	 * the failure must NAME the occluder - the reader of a red CI log should not have to
	 * guess which element owned the point.
	 */
	let occludedReads = 0;
	await assert.rejects(
		() =>
			pressWhenActionable({
				selector: "[data-ci-menu]",
				probe: async () => {
					occludedReads++;
					return {
						present: true,
						painted: true,
						hit: false,
						at: '[role="menu"]',
						stable: true,
						x: 10,
						y: 20,
					};
				},
				dispatch: () => assert.fail("an occluded target must never be pressed"),
				reads: 3,
				intervalMs: 1,
			}),
		(error) => {
			assert.match(
				error.message,
				/never became actionable after 3 bounded reads/,
			);
			assert.match(error.message, /\[data-ci-menu\]/);
			assert.match(error.message, /\(10,20\) is covered by \[role="menu"\]/);
			return true;
		},
	);
	assert.equal(
		occludedReads,
		3,
		"the gate reads a bounded number of times and stops",
	);

	/*
	 * THE POINT THAT IS NOT THE TARGET (a portal painted over it, or a point that is
	 * nobody's): named as such rather than as a generic timeout.
	 */
	assert.match(
		describePressRead({
			present: true,
			painted: true,
			hit: false,
			at: "nothing",
			stable: true,
			x: 1,
			y: 2,
		}),
		/hit-tests to nothing/,
	);
	assert.match(
		describePressRead({ present: true, painted: false, at: "div" }),
		/empty box/,
	);
	assert.match(describePressRead({ present: false }), /left the document/);

	/*
	 * ACTIONABLE ON THE THIRD READ: exactly one dispatch, at the point the gate
	 * validated - not at a point read earlier, and not twice.
	 */
	let reads = 0;
	const dispatched = [];
	const verdict = await pressWhenActionable({
		selector: "[data-ci-menu]",
		probe: async () => {
			reads++;
			return reads < 3
				? {
						present: true,
						painted: true,
						hit: false,
						at: "div",
						stable: true,
						x: 1,
						y: 1,
					}
				: {
						present: true,
						painted: true,
						hit: true,
						at: "button",
						stable: true,
						x: 42,
						y: 24,
					};
		},
		dispatch: async (point) => dispatched.push(point),
		reads: 5,
		intervalMs: 1,
	});
	assert.equal(
		verdict.reads,
		3,
		"the gate must report how many reads it needed",
	);
	assert.deepEqual(
		dispatched,
		[{ x: 42, y: 24 }],
		"the press must be dispatched exactly once, at the validated point",
	);

	/*
	 * HIT-TESTABLE BUT STILL BEING REPLACED: not pressed. This is the session-switch
	 * window the header-menu case died in - the element answers the hit test and is gone
	 * a commit later, which is how a press gets swallowed.
	 */
	const settling = [];
	await assert.rejects(
		() =>
			pressWhenActionable({
				selector: "[data-ci-menu]",
				probe: async () => ({
					present: true,
					painted: true,
					hit: true,
					at: "button",
					stable: false,
					x: 5,
					y: 5,
				}),
				dispatch: async (point) => settling.push(point),
				reads: 2,
				intervalMs: 1,
			}),
		/unstable across two reads/,
	);
	assert.deepEqual(settling, [], "a target being replaced must not be pressed");
});

/*
 * THE DRIVE'S OWN SCOPE, GUARDED LOCALLY (round 2, Q-4). A case's `drive(ctx)` may
 * only touch what the runner hands it; reaching for a runner local compiles, reads as
 * an ordinary mutation, and dies only where that name does not exist - measured on
 * run 38955215215, where `frames.at(-1).railClosePolicy = ...` killed the FIRST leg
 * in CI (`ReferenceError: frames is not defined`) with no source test able to see it.
 *
 * SO A REAL CASE IS DRIVEN HERE against stub helpers: the asks case runs end to end
 * on BOTH legs and the reading it stamps must land on its OWN rail-close frame. The
 * stub is a scripted stand-in - not an app, and no native proof - and its job is
 * narrow: a scope slip, a wrong stamp target or a broken leg obligation fails in this
 * suite instead of on a thirty-five minute macOS run.
 */
function stubDriveContext(leg, { restoreOnRailClose = false } = {}) {
	const script = { browserOpen: false, askDrawer: false };
	const frames = [];
	const presses = [];
	const facts = async () => ({
		state: { browserPaneOpen: script.browserOpen },
		dom: { ask: script.askDrawer, focusedConnected: true, panes: [] },
	});
	return {
		frames,
		presses,
		ctx: {
			kind: leg,
			cdp: { evaluate: async () => null },
			wait: async () => {},
			fixtureMode: async () => {},
			session: async () => {},
			facts,
			/*
			 * Escape is the WITHDRAWAL while the drawer is up: it closes the drawer and
			 * gives the displaced pane back (UX round 1, U6) - the branch the candidate's
			 * `escape-give-back` frame exists to photograph.
			 */
			pressEscape: async () => {
				presses.push("escape");
				if (script.askDrawer) {
					script.askDrawer = false;
					script.browserOpen = true;
				}
			},
			press: async (selector) => {
				presses.push(selector);
				if (selector.includes('data-panel-rail-item="browser"')) {
					script.browserOpen = true;
				} else if (selector.includes('data-panel-rail-item="ask"')) {
					if (script.askDrawer) {
						/*
						 * THE LIT ITEM'S CLOSE EMPTIES THE SLOT (#1079) - unless the caller asked
						 * for the pre-fix policy, which is how the discrimination below is driven.
						 */
						script.askDrawer = false;
						script.browserOpen = restoreOnRailClose;
					} else {
						script.askDrawer = true;
					}
				} else if (
					selector.includes("close-asks-button") ||
					selector.includes("data-ci-close-asks") ||
					selector.includes("status-asks")
				) {
					script.askDrawer = false;
					script.browserOpen = false;
				}
			},
			waitFor: async (probe) => {
				await probe();
				return await facts();
			},
			frame: async (label) => {
				const measured = await facts();
				frames.push({ label, ...measured });
				return measured;
			},
			stamp: (key, value) => {
				frames.at(-1)[key] = value;
				return frames.at(-1);
			},
		},
	};
}

test("a case's drive touches only what the runner hands it, and stamps its own frame", async () => {
	for (const leg of ["control", "candidate"]) {
		const { ctx, frames, presses } = stubDriveContext(leg);
		await CASES.asks.drive(ctx);
		const railClose = frames.find((frame) => frame.label === "rail-close");
		assert(railClose, `${leg}: the drive captured no rail-close frame`);
		assert(
			railClose.railClosePolicy,
			`${leg}: the rail-close frame carries no reading - the stamp must land on the frame the runner owns`,
		);
		assert.equal(railClose.railClosePolicy.leg, leg);
		assert.equal(
			railClose.railClosePolicy.observed,
			false,
			`${leg}: this stub empties the slot, so the reading must say so`,
		);
		for (const label of CASES.asks.frames[leg])
			assert(
				frames.some((frame) => frame.label === label),
				`${leg}: promised frame ${JSON.stringify(label)} was not captured by the drive`,
			);
		assert(presses.length > 0, `${leg}: the drive pressed nothing`);
	}

	/*
	 * AND THE CANDIDATE'S OBLIGATION IS REAL, not decoration: the same drive against a
	 * stub whose lit-item close RESTORES the pane - the pre-fix policy - must FAIL on
	 * the candidate leg and PASS on the control leg, which only records. That pair is
	 * the discrimination the macOS leg makes, executed here at unit cost.
	 */
	const restoringCandidate = stubDriveContext("candidate", {
		restoreOnRailClose: true,
	});
	await assert.rejects(
		() => CASES.asks.drive(restoringCandidate.ctx),
		/candidate rail-close wrong restore policy/,
	);
	const restoringControl = stubDriveContext("control", {
		restoreOnRailClose: true,
	});
	await assert.doesNotReject(() => CASES.asks.drive(restoringControl.ctx));
	assert.match(
		restoringControl.frames.find((frame) => frame.label === "rail-close")
			.railClosePolicy.reading,
		/RESTORES the displaced pane/,
		"a pre-fix control must be recorded as pre-fix rather than failing",
	);
});

/*
 * THE TABLE IS A CONTRACT, so it is held to one here rather than trusted. A case
 * that declares no drive, no route, no readable purpose or no frames is a case
 * whose artifact a reviewer cannot read; a case that promises `acceptance` is
 * claiming a row the RUNNER pushes, which would make the runner's own verification
 * of "every promised frame was captured" circular.
 */
test("every case declares what it drives and the frames it promises", () => {
	const cases = Object.entries(CASES);
	assert(
		cases.length >= 3,
		`the table carries the asks case plus new ones, got ${cases.length}`,
	);
	for (const [name, scenario] of cases) {
		assert.equal(
			typeof scenario.drive,
			"function",
			`${name} declares no drive`,
		);
		assert.match(scenario.route, /^\//, `${name} declares no route`);
		assert(
			typeof scenario.purpose === "string" && scenario.purpose.length > 60,
			`${name} declares no purpose a reviewer could read`,
		);
		/*
		 * THE PROMISE IS PER LEG, and the control leg's list is a SUBSET of the
		 * candidate's: a control is a real historical revision, so a case whose
		 * candidate-only steps photograph closers that revision predates would be
		 * promising the control frames it cannot take - a red run for a correct case.
		 */
		for (const leg of ["control", "candidate"]) {
			const promised = scenario.frames[leg];
			assert(
				Array.isArray(promised) && promised.length > 0,
				`${name} promises no frames for the ${leg} leg`,
			);
			for (const label of promised)
				assert.equal(
					typeof label,
					"string",
					`${name} promises a non-string frame`,
				);
			assert(
				!promised.includes("acceptance"),
				`${name} must not promise the acceptance row: the runner pushes it, so promising it would make the runner's own check circular`,
			);
		}
		for (const label of scenario.frames.control)
			assert(
				scenario.frames.candidate.includes(label),
				`${name} promises the control leg a frame (${label}) the candidate does not take, so the two legs are not the same drive`,
			);
		/*
		 * AND EVERY LABEL A DRIVE CAPTURES IS PROMISED, PER LEG. A label nobody promised
		 * means the promise list has drifted from the drive - the failure mode the
		 * runner's own check cannot see, because it only asks whether the promised labels
		 * appeared. Comments are stripped first: a prose line naming `frame("...")` is not
		 * a capture, and reading them made this scan answer about the file's commentary
		 * instead of its steps (round 1, N2).
		 */
		const drive = scenario.drive
			.toString()
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		const captured = (text) =>
			[...text.matchAll(/frame\("([^"]+)"\)|closed\("([^"]+)"/g)].map(
				(match) => match[1] ?? match[2],
			);
		/*
		 * A LEG'S OBLIGATION IS WHAT IT PROMISES: the shared steps run on BOTH legs, so
		 * every label they capture must be promised by both, while the candidate-only
		 * block runs on one leg and needs the candidate's list alone (round 1, Q-2).
		 * Splitting on the drive's own gate keeps this about the steps rather than about
		 * a second copy of the drive.
		 */
		const gate = drive.indexOf('kind === "candidate"');
		const shared = gate === -1 ? drive : drive.slice(0, gate);
		/*
		 * ONE ASSERTION PER LABEL, NAMING THE LEGS THAT LACK IT (round 2, Q-5). The
		 * nested loop this replaces carried a candidate-side arm that could never fire:
		 * the subset check above pins control ⊆ candidate, so a shared label missing from
		 * control is the only case the loop can reach, and by the time it reaches the
		 * candidate it has already established the label is there. Computing the missing
		 * legs keeps the direction enforced without an arm that is dead by construction.
		 */
		for (const label of captured(shared)) {
			const missing = ["control", "candidate"].filter(
				(leg) => !scenario.frames[leg].includes(label),
			);
			assert.equal(
				missing.length,
				0,
				`${name}: a shared step captures ${JSON.stringify(label)} without promising it to ${missing.join(" and ")}`,
			);
		}
		if (gate !== -1)
			for (const label of captured(drive.slice(gate)))
				assert(
					scenario.frames.candidate.includes(label),
					`${name} captures ${JSON.stringify(label)} in a candidate-only step without promising it`,
				);
	}
	/*
	 * The asks case's frames stay where the QA howto and the review threads point
	 * (`<output>/control|candidate`); every other case gets its own directory. Pinned
	 * here because moving it silently would break paths outside this repository.
	 */
	assert.equal(
		CASES.asks.legacyOutputLayout,
		true,
		"the asks case must keep <output>/control|candidate, where its recorded howto points",
	);
	assert.equal(
		CASES.palette.legacyOutputLayout,
		undefined,
		"a new case must not claim the asks case's output layout",
	);
});

/*
 * THE REFUSAL IS DRIVEN, NOT READ. A case name outside the table must exit 1 with
 * the refusal on stderr and leave no artifact root behind - that is the property
 * "a case that cannot run refuses loudly, never silently skips" rests on, and it is
 * cheap to execute because it happens before any fixture, artifact root or Electron
 * binary is resolved.
 */
test("a case name outside the table refuses before any artifact root exists", () => {
	const root = mkdtempSync(join(tmpdir(), "asks-case-refusal-"));
	const out = join(root, "out");
	const result = spawnSync(
		process.execPath,
		[
			fileURLToPath(new URL("./asks-app-regression.mjs", import.meta.url)),
			"--case",
			"no-such-case",
			"--leg",
			"candidate",
		],
		{
			encoding: "utf8",
			env: {
				...process.env,
				ASKS_APP_ROOT: root,
				ASKS_OUTPUT: out,
				ASKS_RECORDS: join(root, "records"),
			},
			timeout: 30_000,
		},
	);
	assert.equal(
		result.status,
		1,
		`expected a refusal, got status ${result.status}`,
	);
	assert.match(
		result.stderr,
		/asks-app-regression: --case needs <scenario> from .+ --leg control\|candidate/,
	);
	assert(
		!existsSync(out),
		"the refusal must come before the artifact root exists, not after it",
	);
	rmSync(root, { recursive: true, force: true });
});

test("the rail's close declares ONE post-state, and only the candidate owes it", () => {
	assert.equal(ASKS_RAIL_CLOSE_POST_STATE, false);
	assert.equal(railCloseAssertion("candidate"), ASKS_RAIL_CLOSE_POST_STATE);
	/*
	 * A CONTROL OWES A READING, NOT THE LITERAL. The control is derived (the
	 * merge-base of `origin/main` and `HEAD`), so on every head cut from a main that
	 * carries the asks fix its close empties the slot too - and the old per-leg
	 * literal (`control` restores) failed a correct run. Run 38951889082 is the
	 * measurement: the macOS leg died at its FIRST case on `false !== true`, because
	 * the merge-base `a23faab0` already contains `2424010d2ae4`.
	 */
	assert.equal(
		railCloseAssertion("control"),
		undefined,
		"a control leg must not carry the pre-fix literal: with a derived control it post-dates the fix",
	);
	assert.throws(() => railCloseAssertion("invented"));

	/*
	 * AND THE GATE SURVIVES: a candidate that RESTORES the pane where it must empty
	 * the slot fails the case's own assertion. Driven as the same expression the drive
	 * uses - the discrimination the macOS leg makes, at unit cost.
	 */
	const restoredInstead = true;
	assert.throws(
		() => assert.equal(restoredInstead, railCloseAssertion("candidate")),
		"a candidate that restores the pane on the rail's close must fail the case",
	);
	assert.doesNotThrow(() =>
		assert.equal(false, railCloseAssertion("candidate")),
	);

	/*
	 * A POST-FIX CONTROL IS AN ORDINARY, PASSING OUTCOME, and its reading says which
	 * policy it has rather than throwing: both branches are correct answers, which is
	 * why the recording is the evidence and not a pass/fail.
	 */
	const postFix = railCloseReading("control", false);
	assert.equal(postFix.observed, false);
	assert.equal(postFix.declaredPostState, ASKS_RAIL_CLOSE_POST_STATE);
	assert.match(postFix.reading, /EMPTIES the slot/);
	const preFix = railCloseReading("control", true);
	assert.match(preFix.reading, /RESTORES the displaced pane/);
	assert.throws(() => railCloseReading("control", "nope"));
	// The PINNED historical revision is the provenance record; it is no longer
	// what boots (see the rule below), so this asserts the record held rather
	// than that the run uses it.
	assert.equal(ASKS_CONTROL_PINNED, "2461cfa3f3beaa1124727a9de93dfe01c4381b0d");
});

test("the control revision is DERIVED, and satisfies the reuse assertion by construction", () => {
	/*
	 * The rule that keeps the producer alive as `main` moves: the control is the
	 * base the candidate was built from, not a pinned historical commit. A pin
	 * cannot satisfy `prepareControl`'s byte-identity requirement once main has
	 * moved past it, which is exactly how run 38916579072 died
	 * (`control reuse mismatch src/main`).
	 *
	 * Driven against the real repository, not described: whatever
	 * `resolveAsksControl()` returns must be a revision whose four reused parts
	 * are byte-identical to this HEAD's. That is the same assertion the producer
	 * makes at boot, so this test fails for the same reason the producer would.
	 */
	// ASKS_CONTROL, not the resolver: the boot uses the CONSTANT, so asserting on
	// the function would let a caller swap in the pin and keep this green - which
	// is exactly the defect the test exists to catch (mutation-checked by pointing
	// ASKS_CONTROL at ASKS_CONTROL_PINNED, which fails it).
	assert.equal(
		ASKS_CONTROL,
		resolveAsksControl(),
		"the booted control must be the derived one, not a constant that bypasses the derivation",
	);
	const base = ASKS_CONTROL;
	assert.match(
		base,
		/^[0-9a-f]{40}$/,
		`the control must resolve to a full commit sha, got ${JSON.stringify(base)}`,
	);
	/*
	 * THE COMPARISON NEEDS BOTH TREES, AND A SHALLOW CLONE MAY NOT HAVE THE
	 * CONTROL'S. `pnpm test:desktop` runs under `actions/checkout`, whose default
	 * is a depth-1 (or depth-2) fetch: the control commit object is there - it is
	 * the merge base - but its TREE is not, so `git rev-parse <sha>:src/main` dies
	 * with `fatal: path 'src/main' exists on disk, but not in <sha>` and the test
	 * throws instead of reporting what it can. That is a property of the clone,
	 * not of the change: the same test is the real assertion in a full checkout
	 * (a developer's tree, or CI's own npX leg which fetches the control), and it
	 * is still worth running there.
	 *
	 * So the trees are PROBED first, and an unreadable one is reported as skipped
	 * with the reason rather than thrown. The probe is deliberately narrow: a
	 * clone that HAS both trees runs every assertion below unchanged, and the
	 * mutation check for this guard is what proves it still catches a genuine
	 * disagreement (see the PR discussion: pointing ASKS_CONTROL at a revision
	 * whose tree IS present fails it).
	 */
	const readable = [base, "HEAD"].every(
		(rev) =>
			spawnSync("git", ["cat-file", "-e", `${rev}^{tree}`], { cwd: REPO })
				.status === 0,
	);
	if (!readable) {
		console.log(
			`asks-app-regression: the control ${base} or HEAD has no readable tree in this clone (shallow checkout); the byte-identity assertion is skipped here and runs in a full checkout`,
		);
		return;
	}
	/*
	 * THE PLAN THE PRODUCER WILL TAKE, derived from the real trees with the same
	 * function it boots with. Two outcomes are both legitimate:
	 *  - reuse: the four parts are byte-identical, so the candidate's main/preload
	 *    ARE the control's and the producer copies them (the original assertion,
	 *    unchanged for this case);
	 *  - rebuild: this branch changes main, preload or the vite config (a window
	 *    option, an IPC channel), so the control builds its own from its own source.
	 * A differing lockfile is legitimate for a reviewed dependency addition: the
	 * control installs its own dependencies from its own lockfile instead of
	 * sharing the candidate's node_modules. The plan must still REPORT it so the
	 * manifest records which control experiment ran.
	 */
	const plan = controlReusePlan(
		(spec) =>
			execFileSync("git", ["rev-parse", spec], {
				encoding: "utf8",
				cwd: REPO,
			}).trim(),
		base,
		"HEAD",
	);
	const touched = execFileSync(
		"git",
		["diff", "--name-only", base, "HEAD", "--", ...CONTROL_REUSE_PARTS],
		{ encoding: "utf8", cwd: REPO },
	).trim();
	/* The plan and the diff are two spellings of one fact; they must agree. */
	assert.equal(
		plan.lockDiffers,
		touched.split("\n").includes("pnpm-lock.yaml"),
		`the lockfile plan (${plan.lockDiffers}) disagrees with the diff (${JSON.stringify(touched)})`,
	);
	assert.equal(
		plan.reuse,
		touched === "",
		`the reuse plan (${plan.reuse ? "reuse" : `rebuild: ${plan.differing.join(", ")}`}) disagrees with the diff of the reused parts (${JSON.stringify(touched)})`,
	);
});

test("the isolated control builder has a bounded heap without changing global NODE_OPTIONS", () => {
	assert.deepEqual(CONTROL_BUILD_NODE_ARGS, [
		"--max-old-space-size=4096",
		"--input-type=module",
	]);
	const source = readFileSync(
		new URL("./asks-app-regression.mjs", import.meta.url),
		"utf8",
	);
	assert.ok(
		source.includes(
			'await execute(process.execPath, [...CONTROL_BUILD_NODE_ARGS, "-e", code]',
		),
	);
	const inherited = process.env.NODE_OPTIONS;
	const env = { ...process.env, NODE_OPTIONS: "--max-old-space-size=128" };
	const code = `import v8 from 'node:v8';console.log(JSON.stringify({heap:v8.getHeapStatistics().heap_size_limit,options:process.env.NODE_OPTIONS}));`;
	const run = (args) => {
		const child = spawnSync(process.execPath, [...args, "-e", code], {
			encoding: "utf8",
			env,
			timeout: 15000,
		});
		assert.equal(child.status, 0, child.stderr);
		return JSON.parse(child.stdout);
	};
	// A real low-heap control proves the explicit builder flag takes effect;
	// reading V8's configured limit allocates no multi-gigabyte test heap.
	const low = run(["--input-type=module"]);
	const bounded = run(CONTROL_BUILD_NODE_ARGS);
	assert.ok(low.heap < 256 * 1024 ** 2, JSON.stringify(low));
	assert.ok(bounded.heap >= 4 * 1024 ** 3, JSON.stringify(bounded));
	assert.ok(bounded.heap < 4.25 * 1024 ** 3, JSON.stringify(bounded));
	assert.equal(bounded.options, env.NODE_OPTIONS);
	assert.equal(process.env.NODE_OPTIONS, inherited);
});

test("controlReusePlan: identical trees reuse; a main/preload/config change rebuilds; a lockfile change installs control dependencies", () => {
	const same = (spec) => `tree:${spec.split(":")[1]}`;
	const plan0 = controlReusePlan(same, "ctl", "HEAD");
	assert.deepEqual(plan0, { reuse: true, differing: [], lockDiffers: false });
	const changedMain = (spec) =>
		spec.startsWith("ctl:") && spec.endsWith(":src/main")
			? "other"
			: same(spec);

	/* A change in each BUILD INPUT is a rebuild, and names what differed. */
	for (const part of ["src/main", "src/preload", "electron.vite.config.js"]) {
		const changed = (spec) =>
			spec.startsWith("ctl:") && spec.endsWith(`:${part}`)
				? "other"
				: same(spec);
		const p = controlReusePlan(changed, "ctl", "HEAD");
		assert.equal(p.reuse, false, `${part} differing must not reuse`);
		assert.deepEqual(p.differing, [part]);
		assert.equal(p.lockDiffers, false, `${part} is a rebuild, not a refusal`);
	}

	/* A lockfile change rebuilds the control and installs its own dependencies. */
	const lock = (spec) =>
		spec.startsWith("ctl:") && spec.endsWith(":pnpm-lock.yaml")
			? "other"
			: same(spec);
	const l = controlReusePlan(lock, "ctl", "HEAD");
	assert.equal(l.reuse, false);
	assert.equal(l.lockDiffers, true);

	/*
	 * The provenance string is a function of the plan, so it is asserted through
	 * the producer's own export rather than by reading its source (review R7).
	 */
	assert.equal(
		describeMainPreloadReuse(plan0),
		"byte-identical source/config/lock",
	);
	assert.equal(
		describeMainPreloadReuse(controlReusePlan(changedMain, "ctl", "HEAD")),
		"rebuilt from control source (main/preload differ: src/main)",
	);
});
test("synthetic canonical snapshot is open, bounded and session-scoped", () => {
	const ask = askFixture(1000000000000);
	assert.equal(ask.expires_at - ask.created_at, 3600000);
	const a = sessionSnapshot(ASK_SESSION_IDS[0], ask);
	assert.equal(a.payload.frontend.state_version, 1);
	assert.equal(a.payload.frontend.snapshot.asks[0].status, "open");
	assert.equal(
		sessionSnapshot(ASK_SESSION_IDS[1], ask).payload.frontend.snapshot.asks
			.length,
		0,
	);
});
test("real loopback fixture refuses credentials and writes and serves canonical reads", async () => {
	const root = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir(), "asks-contract-"),
	);
	const fixture = await startAsksAppFixture({
		root,
		port: 0,
		token: "synthetic-local-only",
	});
	try {
		assert.equal(
			(await fetch(`${fixture.url}/v1/desktop/sessions`)).status,
			401,
		);
		const headers = { Authorization: "Bearer synthetic-local-only" };
		const sessions = await (
			await fetch(`${fixture.url}/v1/desktop/sessions`, { headers })
		).json();
		assert.deepEqual(
			sessions.result.sessions.map((x) => x.id),
			ASK_SESSION_IDS,
		);
		assert.equal(
			(
				await fetch(
					`${fixture.url}/v1/desktop/sessions/${ASK_SESSION_IDS[0]}/send`,
					{ method: "POST", headers },
				)
			).status,
			405,
		);
		const response = await fetch(
			`${fixture.url}/v1/desktop/sessions/${ASK_SESSION_IDS[0]}/events`,
			{ headers },
		);
		const reader = response.body.getReader();
		let wire = "";
		for (let i = 0; i < 4 && !wire.includes('"type":"snapshot"'); i++) {
			const { value, done } = await reader.read();
			if (done) break;
			wire += new TextDecoder().decode(value);
		}
		await reader.cancel();
		assert(wire.includes('"type":"snapshot"'));
		fixture.setMode("empty");
		assert.deepEqual(
			(
				await (
					await fetch(`${fixture.url}/v1/desktop/asks`, { headers })
				).json()
			).result.asks,
			[],
		);
		fixture.setMode("error");
		assert.equal(
			(await fetch(`${fixture.url}/v1/desktop/asks`, { headers })).status,
			503,
		);
	} finally {
		await fixture.close();
	}
});
test("future asks production and fixture-only deltas select the existing native job", () => {
	for (const path of [
		"src/renderer/src/features/chat/components/asks/ask-drawer.tsx",
		"src/renderer/src/shared/components/common/chat-layout.tsx",
		"src/renderer/src/shared/store/ui-preferences-store.ts",
		"scripts/asks-app-fixture.mjs",
		"scripts/asks-app-regression.mjs",
		"scripts/asks-app-regression.test.mjs",
	]) {
		const flags = flagsFor([categoryOf(path)], [path], false);
		assert.equal(flags.pack, true, `${path} must run native app regression`);
		assert.equal(flags.lint, true);
		assert.equal(flags.types, true);
	}
	const workflow = readFileSync(
		new URL("../.github/workflows/ci.yml", import.meta.url),
		"utf8",
	);
	assert(workflow.includes("needs.changes.outputs.pack != 'false'"));
	assert(
		workflow.includes(
			"needs.audit.result == 'success' || needs.audit.result == 'skipped'",
		),
	);
});
test("existing job performs real native capture and always uploads measurements", () => {
	const workflow = readFileSync(
		new URL("../.github/workflows/ci.yml", import.meta.url),
		"utf8",
	);
	assert(workflow.includes("node scripts/asks-app-regression.mjs"));
	assert(
		workflow.includes(
			"asks-app-regression-${{ github.event.pull_request.number }}",
		),
	);
	const source = readFileSync(
		new URL("./asks-app-regression.mjs", import.meta.url),
		"utf8",
	);
	assert(source.includes("api.launchApp"));
	assert(source.includes("api.capture"));
	assert(!source.includes("window.api ="));
	/*
	 * The order CI caught: attach straight after launch, before the debugging
	 * port was listening. `fetch` then rejected and the rejection escaped the
	 * attach loop as a bare `TypeError: fetch failed`. What is pinned here is the
	 * ORDER - the endpoint wait is called before any attach - and that the wait
	 * does not depend on which driver tree was imported, because the control leg
	 * loads a pinned historical facade that does not export one.
	 */
	/*
	 * The ordering that cost CI seven minutes: the traffic assertions sat AHEAD of
	 * `fixture.close()`, so the first one that threw left the fixture's HTTP
	 * listener open and the step ran on with nothing to do until GitHub killed it.
	 * The close must come first, and the assertions must not run at all over a run
	 * that already failed.
	 */
	const closeAt = source.indexOf(
		"await fixture.close();\n\t\tif (primaryError === null)",
	);
	assert(
		closeAt > 0,
		"the fixture must be closed before the traffic assertions",
	);
	const trafficCallAt = source.indexOf(
		"assertTrafficAllowed(fixture.requests)",
	);
	assert(
		trafficCallAt > closeAt,
		"the traffic assertions must follow the close, or a failure leaks the listener",
	);
	assert(
		source.includes("primaryError = error") &&
			source.includes("primaryError === null"),
		"traffic assertions must be skipped over a run that already failed",
	);
	/*
	 * The auth invariant is "no unauthenticated WRITE", not "every read carries a
	 * bearer": the app's transport omits the header when it holds no token, so a bare
	 * read is ordinary (measured: 7 of 153 requests, `/v1/credentials` and `/health`),
	 * and the fixture answers each 401. Pinned so the guard cannot be tightened back
	 * into a false failure or loosened into admitting a bare write.
	 */
	assert(
		source.includes('request.authenticated || request.method === "GET"'),
		"the auth guard must forbid unauthenticated WRITES, not unauthenticated reads",
	);
	// The Radient proxy is a POST this scene reaches; the fixture models its read
	// operations and the guard admits the route while the turn/answer pattern stays shut.
	assert(
		source.includes("/v1/desktop/radient"),
		"the traffic guard must admit the modelled radient read door",
	);
	const fixtureSource = readFileSync(
		new URL("./asks-app-fixture.mjs", import.meta.url),
		"utf8",
	);
	assert(
		fixtureSource.includes("READ_RADIENT_OPERATIONS") &&
			fixtureSource.includes("Fixture models no radient operation"),
		"the fixture must model the radient reads and refuse the rest by name",
	);

	/*
	 * EVERY `data-tour-tag` THIS PRODUCER PRESSES MUST EXIST IN `src/`. The press
	 * that cost run 38846903646 was `[data-tour-tag="chat-all-chats"]`, a selector
	 * the app has never drawn - `git grep` finds it in the shared driver's own
	 * comments and in NO source file, at this head or the pinned control one - so
	 * the scene waited fifteen seconds for an element that could not appear and the
	 * case died with `Unsettled real UI`. A scene that presses a tag the renderer
	 * does not carry is not a failing app, it is a wrong assertion, and it is
	 * decidable statically: the tags are in the source and the presses are here.
	 */
	// Comments are stripped first: this file describes the defect in prose (the
	// error string the page produced), and a scan that reads its own explanation as
	// an offence is a scan nobody can act on.
	const codeOnly = source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

	const pressedTags = [
		...codeOnly.matchAll(/press\(\s*'\[data-tour-tag="([^"]+)"\]/g),
	].map((match) => match[1]);
	assert(
		pressedTags.length > 0,
		"the scan must find the producer's tag presses, or it proves nothing",
	);
	for (const tag of pressedTags) {
		const hits = execFileSync(
			"git",
			["grep", "-l", `data-tour-tag="${tag}"`, "--", "src"],
			{ encoding: "utf8", cwd: REPO, maxBuffer: 32 * 1024 * 1024 },
		).trim();
		assert(
			hits.length > 0,
			`the producer presses [data-tour-tag="${tag}"], which no file under src/ carries`,
		);
	}

	/*
	 * THE BROWSER DOOR IS WAITED FOR, NOT SAMPLED ONCE. Run 38929174267 failed with
	 * `Expected values to be strictly equal: false !== true` on the wing's
	 * `browser()`: the press is synchronous to the store but React's commit of it is
	 * not, so a single immediate read can land on the pre-commit moment - and under
	 * load it did. The wait is bounded and the assertion remains the one gate, so a
	 * door that never opens still fails.
	 */
	const browserFn = source.slice(
		source.indexOf("async function browser()"),
		source.indexOf("async function asks()"),
	);
	assert(
		browserFn.includes("await waitFor("),
		"browser() must WAIT for the pane rather than read it once after the press",
	);
	assert(
		/press\('\[data-panel-rail-item="browser"\]'\)\s*;?\s*\n\s*const opened = await waitFor\(/.test(
			browserFn,
		),
		"the wait must follow the press, so the pane is waited FOR rather than assumed",
	);
	assert(
		browserFn.includes("assert.equal("),
		"the assertion stays the single gate, so a door that never opens still fails",
	);

	/*
	 * NO PAGE-SIDE `window.__loDevDriver.call(...)` WAIT. The verb's return is not a
	 * page promise, so awaiting `.then` inside an expression throws
	 * `TypeError: window.__loDevDriver.call(...).then is not a function` and takes
	 * the case down before any frame - measured on run 38849663528, at the session
	 * helper. State is read through `api.verb`/`cdp.evaluate` from Node, which is the
	 * documented door and what the shared driver's own scenes use.
	 */
	assert(
		!/__loDevDriver\.call\([^)]*\)\.then/.test(codeOnly),
		"a page-side .then on a driver verb is not a promise and throws; read state through the api instead",
	);

	const waitAt = codeOnly.indexOf("await waitForDevtoolsPort(app, api)");
	const attachAt = source.indexOf(
		'api.CdpClient.attach(app.port, "out/renderer/index.html")',
	);
	assert(waitAt > 0, "the producer must wait for the debugging port");
	assert(attachAt > waitAt, "the wait must precede the attach");
	assert(
		source.includes('typeof api?.waitForDevtools === "function"'),
		"the wait must fall back for the pinned historical driver the control leg imports",
	);
	assert(
		!source.includes('CdpClient.attach(app.port, "index.html")'),
		"the target must be the built renderer path the other callers use",
	);
	/*
	 * THE QUESTION IS ASKED OF THE PIN, NOT OF THE DERIVED CONTROL, and the
	 * difference is not cosmetic. The control became DERIVED (`resolveAsksControl`:
	 * the merge-base of `origin/main` and `HEAD`, the pin only when that cannot be
	 * resolved), so in a full clone the tree a leg boots is usually a RECENT one -
	 * at main it is main itself - and main's driver DOES export the wait. Asserting
	 * the absence on the derived control therefore asked about a revision the
	 * fallback does not serve. The pin is the tree the fallback exists for: it is
	 * what a shallow or detached clone degrades to, and it genuinely lacks the
	 * export, so the assertion still proves the fallback is exercised rather than
	 * dead code.
	 *
	 * Whether that revision is IN this clone is a property of the clone and not of
	 * the change: `pnpm test:desktop` runs under `actions/checkout`'s default
	 * depth-1, where 2461cfa3 is a commit this clone has never seen. Read it when it
	 * is here (a developer's tree), say so plainly when it is not, and never turn a
	 * shallow clone into a red test.
	 *
	 * maxBuffer, because the shared driver is a 45k-line file and the default
	 * 1 MiB ceiling turns reading it into an ENOBUFS that reads like a git fault.
	 */
	const present = spawnSync(
		"git",
		["cat-file", "-e", `${ASKS_CONTROL_PINNED}^{commit}`],
		{ cwd: REPO },
	).status;
	if (present === 0) {
		const historical = execFileSync(
			"git",
			["show", `${ASKS_CONTROL_PINNED}:scripts/renderer-driver.mjs`],
			{ encoding: "utf8", cwd: REPO, maxBuffer: 32 * 1024 * 1024 },
		);
		assert(
			!historical.includes("waitForDevtools,\n"),
			"the pinned control tree must really lack the exported wait, or the fallback above is untested",
		);
	} else {
		console.log(
			"asks-app-regression: pinned control commit not in this clone (shallow checkout); the fallback is asserted from source only",
		);
	}
});
