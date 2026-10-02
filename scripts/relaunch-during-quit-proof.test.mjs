import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * THE PROOF RIG'S ISOLATION, pinned where it can be checked without booting it.
 *
 * QA round 1 (Q1) found the rig's premise check failing — and its isolation
 * claim not holding — on any checkout whose root `.env` pins the backend
 * manager: `src/main/backend/config.ts` folds `$CWD/.env` over the launch
 * environment (`override: true`), so the rig's free-port
 * `VITE_LOCAL_OPERATOR_API_URL` was overridden and the run probed the machine's
 * real port 1111. The fix is the RIG's: the app is launched with an ABSOLUTE
 * app path (this tree) and a working directory inside the run's own scratch
 * tree, where no `.env` exists. Both halves are pinned here at the source,
 * because what they protect is only observable by booting a whole app — which
 * is what the rig itself is for, not what this file can host. The rig's header
 * states the same contract in prose.
 */
const rig = readFileSync("scripts/relaunch-during-quit-proof.mjs", "utf8");

test("the rig boots the app with an absolute path and a working directory in its own scratch tree", () => {
	/*
	 * Either half alone is not enough: the ABSOLUTE path is what still finds
	 * this tree's `package.json`/`out` once the working directory moves, and the
	 * scratch cwd is what makes a checkout `.env` unreachable to the app's
	 * dotenv fold. `["."]` with `cwd: process.cwd()` is the spelling QA's Q1 was
	 * written against, so both regression spellings are refused explicitly.
	 */
	assert.match(
		rig,
		/const APP_ROOT = process\.cwd\(\);/,
		"the app root is captured once, as an absolute path",
	);
	assert.match(
		rig,
		/const APP_CWD = join\(SCRATCH, "app-cwd"\);/,
		"the app's working directory lives inside the run's scratch tree",
	);
	assert.match(rig, /cwd: APP_CWD,/, "and the spawn uses it");
	assert.ok(
		!/cwd: process\.cwd\(\)/.test(rig),
		"the checkout can never be the app's working directory",
	);
	assert.match(
		rig,
		/^\t\t\tAPP_ROOT,$/m,
		"the app path handed to Electron is APP_ROOT",
	);
	assert.ok(
		!/^\t\t\t"\."\s*,?$/m.test(rig),
		"and never the relative `.` — it resolves against cwd, which is scratch now",
	);
	assert.match(
		rig,
		/for \(const dir of \[HOME_DIR, CONFIG_DIR, LOG_DIR, USER_DATA, APP_CWD\]\)/,
		"the scratch tree creates the app's working directory before any launch",
	);
});

test("a missing build is refused by name, before anything is launched", () => {
	/*
	 * The requirement the README used to imply with "needs a BUILT tree": the
	 * built entrypoint the rig actually boots, `out/main/index.js`. The
	 * preflight turns it into one clear sentence instead of whatever fails
	 * first, minutes in.
	 */
	assert.match(
		rig,
		/if \(!existsSync\(join\(APP_ROOT, "out", "main", "index\.js"\)\)\)/,
		"the preflight checks the built entrypoint",
	);
	assert.ok(
		rig.includes("is not a BUILT tree - out/main/index.js is missing"),
		"and refuses by name",
	);
});

test("the header states the .env fold the working directory defends against", () => {
	/*
	 * The why, pinned so the cwd half cannot be "simplified" away by a future
	 * editor who reads only the code: the fold is `override: true`, so a
	 * checkout `.env` WINS over the rig's own free-port assignment unless the
	 * working directory is scratch.
	 */
	assert.ok(
		rig.includes("folds a `.env` from the process's working"),
		"the header names the fold and its rule",
	);
	assert.ok(
		rig.includes("QA round 1's Q1"),
		"and cites the round that found it, so the contract is traceable",
	);
});

test("the rig arms B's replayed inspect port and reads the successor there (#755)", () => {
	/*
	 * The completion rides on the REPLAY contract: B's argv carries
	 * `--inspect=<inspectS>` (given to B at launch), the refused reopen records
	 * that same command line, and the successor becomes observable on the same
	 * port — the replay contract is proven by S answering there at all. The
	 * port is also the negative's probe: while A still tears down and B is gone,
	 * nothing may listen on it, and only A may be on the scratch profile.
	 */
	assert.match(
		rig,
		/const inspectS = await freePort\(\);/,
		"the replay port is chosen once, before the arm branch",
	);
	const bLaunchAt = rig.indexOf("const b2 = launchApp");
	assert.ok(bLaunchAt > 0, "B's launch is still there");
	const bLaunch = rig.slice(bLaunchAt, rig.indexOf("});", bLaunchAt));
	assert.ok(
		bLaunch.includes("inspectPort: inspectS") && bLaunch.includes('label: "b"'),
		"B carries it in its argv",
	);
	assert.match(
		rig,
		/CdpClient\.attach\(inspectS, 30_000\)/,
		"the successor is read on it after A exits",
	);
	assert.match(
		rig,
		/portListening: await listeningOn\(inspectS\),/,
		"and the negative samples it while A still tears down",
	);
	assert.ok(
		rig.includes("no successor exists before A exits"),
		"the before-A-exits negative is asserted by name",
	);
	assert.ok(
		rig.includes("nothing is scheduled at refusal time"),
		"and so is the stale-spawn negative",
	);
});

test("the rig completes the hand-off end to end and reaps the successor by exact pid (#755)", () => {
	assert.match(
		rig,
		/REOPEN_DEFERRED\.test\(raiseLine\)/,
		"the refusal's completion token is asserted on A's line",
	);
	assert.match(
		rig,
		/hasSingleInstanceLock\(\)/,
		"the successor's lock is read back",
	);
	assert.ok(
		rig.includes("window list stays length 1"),
		"exactly-one-successor is asserted via lock + single window",
	);
	assert.match(
		rig,
		/process\.kill\(sPid, "SIGKILL"\)/,
		"the successor is reaped by the exact pid it proved it owns",
	);
	assert.match(
		rig,
		/await runNextLaunchControl\(windowWaitMs\);/,
		"and the next-launch control still runs after the whole hand-off",
	);
});

test("the control arm runs with nothing refused and pins the absence (#755)", () => {
	/*
	 * `--no-reopen`: the same quit with no relaunch during it. Nothing may be
	 * spawned — the negative that gives the main arm's successor its meaning.
	 * The designated port is the SECOND use of `inspectS`, the very port the
	 * main arm's successor would answer on, so the two arms read the same wire
	 * from opposite directions.
	 */
	assert.match(
		rig,
		/const NO_REOPEN = process\.argv\.includes\("--no-reopen"\);/,
		"the arm is a flag",
	);
	assert.ok(
		rig.includes("no successor appears when no reopen was refused"),
		"and its assertion is by name",
	);
	assert.match(
		rig,
		/const designatedPort = inspectS;/,
		"the designated port is the same replay port, untouched by this arm",
	);
	assert.match(
		rig,
		/quietViolation === null/,
		"the grace window is sampled, not glanced at",
	);
	assert.ok(
		rig.includes("nothing was even scheduled"),
		"and the token/schedule absence is pinned too",
	);
});
