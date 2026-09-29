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
