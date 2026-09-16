/**
 * The environment a python started from this repository's harnesses is handed.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS SHARED RATHER THAN A HELPER IN ONE TEST.
 * On 2026-09-15 the operator's installed `/Applications/Local Operator.app`
 * failed its code-seal check because a control run in `scripts/` spread
 * `process.env` into a real interpreter: the ambient `PYTHONPYCACHEPREFIX` in
 * that shell pointed INSIDE the installed app
 * (`.../Local Operator.app/Contents/Resources/python_aarch64/pycache`), so the
 * child mirrored 19 `.pyc` into the app, `codesign` reported every one as
 * `file added:`, and the app's start-up pass told the operator its copy needed
 * replacing. The prompt that pointed the prefix there was this shell, but the
 * write happened because a harness handed a child an environment it had not
 * decided anything about.
 *
 * So the rule is: a spawn of a REAL interpreter states the whole python
 * environment it measures or runs under, and inherits none of it.
 *
 *   - every inherited `PYTHON*` variable is dropped, and that is more than the
 *     two this file sets: `PYTHONPATH`, `PYTHONHOME` and `PYTHONSTARTUP` change
 *     what a child imports or where its stdlib lives, which is exactly the
 *     class of accident a harness must not be able to inherit;
 *   - the cache prefix is explicit, and the effective value is REFUSED if it is
 *     relative or names a path inside an `.app` bundle - the two values that
 *     put bytecode somewhere the caller did not choose (`insideAppBundle` cannot
 *     see a relative value, because it has no `.app` segment, and a relative one
 *     resolves against the child's own cwd, which may itself be inside a
 *     bundle: measured on this machine, cwd inside a bundle's python directory
 *     with `PYTHONPYCACHEPREFIX=relcache` wrote `<cwd>/relcache/opt/homebrew/...`);
 *   - `PYTHONDONTWRITEBYTECODE` is stated per run: the default is the refusal
 *     the app itself sets, and `write: true` states none at all so a harness
 *     that DELIBERATELY means to produce a write can still produce one. A run
 *     that means to write must say so, because an inherited refusal is what made
 *     the bytecode suite's control run incapable of writing in an agent shell.
 *
 * A python this file does not cover is a stub a fixture writes into a temp
 * directory (a shell script that prints a version and exits): it is not an
 * interpreter and carries no cache of its own. Every other site in `scripts/`
 * that starts a real interpreter goes through `pythonChildEnv`, and
 * `scripts/python-bytecode-cache.test.mjs` enumerates them so a new one cannot
 * quietly inherit instead.
 *
 * The per-process scratch root is a temp directory rather than the app's own
 * cache directory: these are harnesses, not the app, and a harness must not be
 * able to write into the state the app reads. It is removed on process exit, so
 * a harness that forgets about it leaks nothing, and a harness that wants its
 * own location passes `prefix`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Every `PYTHON*` variable, which is the set a harness refuses to inherit. */
const INHERITED_PYTHON_ENV = /^PYTHON/;

/**
 * `env` with every inherited `PYTHON*` variable removed.
 *
 * Exported for the one caller that must build an environment this module's own
 * rules forbid: the bytecode suite's fixture arm deliberately hands a real
 * interpreter a prefix inside a `Fake.app` it owns, so that its guarded arm
 * proves something about a live write target. That caller lives in the test file
 * and is named in that file's spawn table; the shared module itself stays
 * incapable of naming an in-bundle prefix.
 */
export function withoutInheritedPythonEnv(base = process.env) {
	const env = {};
	for (const [key, value] of Object.entries(base)) {
		if (INHERITED_PYTHON_ENV.test(key)) continue;
		env[key] = value;
	}
	return env;
}

/**
 * One root per process for the scratch cache directories this module hands out.
 *
 * Removed on `exit` rather than left for the OS: a harness that runs a suite of
 * these should not accumulate a directory per spawn, and a cleanup the caller
 * has to remember is one a future caller will not.
 */
let scratchRoot = null;
function pythonChildScratchRoot() {
	if (scratchRoot) return scratchRoot;
	scratchRoot = mkdtempSync(join(tmpdir(), "lo-python-child-"));
	process.once("exit", () => {
		rmSync(scratchRoot, { recursive: true, force: true });
	});
	return scratchRoot;
}

/**
 * A fresh directory a child may write bytecode into, outside every bundle.
 *
 * Fresh per call rather than shared: a case that asserts "the write landed under
 * the prefix it was given" is worth nothing against a directory an earlier spawn
 * already filled.
 */
function pythonChildScratchDir(label) {
	return mkdtempSync(join(pythonChildScratchRoot(), `${label}-`));
}

/**
 * Whether a path names something inside an `.app` bundle.
 *
 * A path-segment test rather than a `resolve()`-and-prefix test because the
 * bundle root is not known here: any segment ending in `.app` is a bundle, and
 * the value this is asked about may be an environment variable naming a
 * different application's bundle than ours. The shipped module
 * (`src/main/python-bytecode-cache.ts`) applies the same rule to the same
 * question; this copy exists because `scripts/` cannot import the bundled
 * TypeScript without a build step, and the rule is three lines.
 */
export function isInsideAppBundle(path) {
	return path
		.split(/[\\/]/)
		.some((segment) => segment.length > 4 && segment.endsWith(".app"));
}

/**
 * The environment to hand a python this repository's harnesses start.
 *
 * `base` defaults to `process.env` and everything in it except `PYTHON*` is
 * passed through untouched: a harness needs the operator's `PATH` to reach the
 * tools it shells out to, so this is additive, never a replacement.
 *
 * `prefix` is where the child may write bytecode, and it defaults to a fresh
 * scratch directory under this process's own temp root. `write: true` states no
 * `PYTHONDONTWRITEBYTECODE` at all, for a harness that means to produce a write
 * and must be able to. `extra` is applied last and an explicit `undefined`
 * REMOVES a key, which is how a caller reaches "the environment has no prefix,
 * so the script under test has to default it itself".
 */
export function pythonChildEnv({
	base = process.env,
	prefix,
	write = false,
	extra = {},
} = {}) {
	const env = withoutInheritedPythonEnv(base);
	env.PYTHONPYCACHEPREFIX = prefix ?? pythonChildScratchDir("cache");
	if (!write) env.PYTHONDONTWRITEBYTECODE = "1";
	for (const [key, value] of Object.entries(extra)) {
		if (value === undefined) delete env[key];
		else env[key] = value;
	}
	const effective = env.PYTHONPYCACHEPREFIX;
	if (effective !== undefined) {
		if (!isAbsolute(effective)) {
			throw new Error(
				`pythonChildEnv: ${effective} is relative, so the child would resolve it against its own cwd; state an absolute prefix`,
			);
		}
		if (isInsideAppBundle(effective)) {
			throw new Error(
				`pythonChildEnv: ${effective} is inside a bundle, which is the placement this whole harness tree exists to keep bytecode out of`,
			);
		}
	}
	return env;
}
