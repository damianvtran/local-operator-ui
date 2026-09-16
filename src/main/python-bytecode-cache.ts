import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * Keep CPython's bytecode cache out of the application bundle.
 *
 * Why this module exists: the app ships a standalone CPython as an
 * `extraResource` (`Contents/Resources/python_aarch64` for arm64,
 * `Contents/Resources/python` for x64), and the backend virtual environment is
 * created by that interpreter, so the venv's own `python` is the same in-bundle
 * tree. CPython writes `__pycache__/*.pyc` next to the sources it imports -
 * including its own stdlib startup imports - and next to the sources lives
 * *inside the code-sealed `.app`*. Every write is a change to a sealed
 * resource, and macOS answers `codesign --verify --deep` with
 * `a sealed resource is missing or invalid` (`errSecCSBadBundleFormat`).
 *
 * That is not cosmetic. Squirrel.Mac's ShipIt validates the installed bundle
 * with `SecStaticCodeCreateWithPath` before it swaps the new one in, so a
 * bundle that unsealed itself refuses the in-place update with -67028; measured
 * on this machine the operator's own install reports 308 `file added:` and 3
 * `file modified:` violations, every one of them `.pyc` under
 * `Contents/Resources/python_aarch64/lib/python3.12`, and the app's own
 * pre-flight then refused the 0.18.0 update with the reinstall dialog. The
 * count grows with use, which is the shape of the thing: it is one entry per
 * module the process has imported so far. Shipping a fresh copy therefore did
 * not help - every macOS install of 0.17.x unsealed itself again on first
 * launch.
 *
 * The two violation classes are not interchangeable, which is why the
 * install-time half of this lives in `update-install.ts`: a file codesign
 * reports as `file added:` can be deleted and the bundle verifies again
 * (`valid on disk`, exit 0), while a file it reports as `file modified:` cannot
 * - deleting that one turns it into `file missing:`, which still fails. So an
 * added `.pyc` is recoverable and a *rewritten* one - which is what a stale
 * shipped `.pyc` becomes - is not. Shipping no bytecode at all is load-bearing,
 * not tidiness (`scripts/setup-python-resource.sh`, and the release gate in
 * `scripts/verify-macos-artifacts.mjs`).
 *
 * `PYTHONPYCACHEPREFIX` is the supported way out: CPython redirects every
 * bytecode write of that process under the prefix, so the whole interpreter
 * keeps its cache - stdlib and venv site-packages alike, since the variable is
 * read at startup and applies to every module the process compiles - while
 * nothing is written into the bundle. Measured from a pristine copy of the
 * shipped 0.17.0 tree: `bin/python3 --version`, an `import json, logging,
 * xml.etree.ElementTree`, `-m venv --help` took the tree from 3 `.pyc` to 55
 * and rewrote all three shipped ones; the same sequence with the prefix set
 * left the tree byte-for-byte unchanged (1821 files) and cached 582 `.pyc`
 * under the prefix.
 *
 * `PYTHONDONTWRITEBYTECODE=1` rides beside the prefix on every spawn, and the
 * two are not redundant. The prefix is a *redirect*: it decides where a write
 * goes, so it protects the bundle only while the value is absolute, points
 * somewhere writable, and is still read by the interpreter that writes - which is
 * why `withPythonBytecodeCache` replaces an operator's *relative* value rather
 * than passing it through (a relative prefix resolves against the writing
 * process's own cwd, which can be inside a bundle; see `isUsablePrefix`). The
 * flag is a *refusal*: `sys.dont_write_bytecode` is true before the first import, so
 * such a process has nothing to redirect and nothing to lose if the prefix is
 * absent, relative, unwritable, or dropped by an intermediate shell. What the
 * pair costs is stated in `withPythonBytecodeCache`, which is where the
 * decision lives.
 *
 * The environment is the half no process can be relied on to receive, and the
 * smaller of the three:
 * an interpreter started with `-E`/`-I` ignores every `PYTHON*` variable by
 * design, and - the class that actually broke the operator's install - a python
 * nobody in this app started carries no environment at all. So
 * `ensureVenvBytecodeGuard()` puts the refusal inside the venv the app manages,
 * which is the interpreter anything else on the machine reaches. Read its
 * docstring before changing it; it carries the measurements.
 *
 * Deliberately free of Electron imports so the contract tests bundle this
 * shipped module in memory (`pnpm test:desktop`), and the environment decision
 * is a pure function so it is testable without a process to spawn.
 */

/**
 * Directory name of the cache under the app's userData directory.
 *
 * userData rather than the OS temp directory: the cache is per-user state the
 * interpreter reuses between runs, and a temp directory is what the OS is
 * allowed to delete from under a running process. Its location is never inside
 * an `.app` bundle - userData is `~/Library/Application Support/<app>` on
 * macOS - which is the property that matters.
 */
export const PYTHON_BYTECODE_CACHE_DIR_NAME = "python-bytecode-cache";

/**
 * Path separators enough for the platforms this module is asked about: the
 * `.app` test is what matters, and it is a POSIX and Windows question alike.
 */
const PATH_SEPARATORS = /[\\/]/;

/**
 * Whether a path names something inside an `.app` bundle.
 *
 * A path-segment test rather than a `resolve()`-and-prefix test because the
 * bundle root is not known here: any segment ending in `.app` is a bundle, and
 * the value this function is asked about is an environment variable that may
 * point into a different application's bundle than ours.
 */
function insideAppBundle(path: string): boolean {
	return path
		.split(PATH_SEPARATORS)
		.some((segment) => segment.length > 4 && segment.endsWith(".app"));
}

/** The bytecode cache directory for an app whose state lives in `userDataDir`. */
export function pythonBytecodeCacheDir(userDataDir: string): string {
	return join(userDataDir, PYTHON_BYTECODE_CACHE_DIR_NAME);
}

/**
 * `env` with bytecode writing disabled, and any cache it does write placed
 * outside the application bundle.
 *
 * Every other variable is passed through untouched - the backend needs the
 * operator's `PATH` to reach `gh` and `brew`, so a spawn environment is
 * additive here, never a replacement.
 *
 * Two variables, one invariant, and each answers a case the other does not:
 *
 * - `PYTHONDONTWRITEBYTECODE=1` refuses the write at the interpreter. It is set
 *   unconditionally, including over an operator's own value, because measured
 *   on CPython `0` and the empty string are the two falsy spellings a stray
 *   shell `export` can carry and a stale one would silently restore the writes
 *   this module exists to prevent. The cost is real and is the reason the two
 *   variables travel together rather than the flag alone: a process under the
 *   flag compiles its imports and keeps nothing, so every python the app starts
 *   recompiles its import graph per launch. Paying that on an app start is the
 *   trade this module makes against a bundle macOS refuses to open, and it is
 *   paid only by the pythons the app spawns - the app-managed venv, which is the
 *   environment anything else on the machine reaches, is covered by
 *   `ensureVenvBytecodeGuard` instead.
 * - `PYTHONPYCACHEPREFIX` is kept for the processes that write bytecode anyway:
 *   a python the app spawns is not the only python that runs under this
 *   environment (a `bash -c` child can spawn its own), and a redirected write is
 *   a cached module rather than a recompile. It defaults to a directory under
 *   `userData`, which is never inside the thing that gets signed and swapped.
 *
 * An operator's own `PYTHONPYCACHEPREFIX` is kept when it points somewhere
 * outside an `.app` bundle: they have already solved the placement problem for
 * themselves, and silently rewriting a variable they set would change where
 * their own bytecode lives for no gain. A value that *does* point inside a
 * bundle is replaced, because that is the exact configuration this module
 * exists to prevent - and it is reachable, since the backend service sources the
 * operator's shell rc files, so a stray `export` would otherwise be inherited
 * by every python the app runs.
 */
export function withPythonBytecodeCache(
	env: Record<string, string | undefined>,
	userDataDir: string,
): Record<string, string | undefined> {
	const existing = env.PYTHONPYCACHEPREFIX?.trim();
	const prefix = isUsablePrefix(existing)
		? existing
		: pythonBytecodeCacheDir(userDataDir);
	return {
		...env,
		PYTHONPYCACHEPREFIX: prefix,
		PYTHONDONTWRITEBYTECODE: "1",
	};
}

/**
 * Whether a `PYTHONPYCACHEPREFIX` the operator set is one that may be kept.
 *
 * Two conditions, and the second is the one the docstring above already
 * asserted while the code did not check it:
 *
 * - the value must not name a path inside an `.app` bundle, which is the
 *   configuration this module exists to prevent;
 * - and it must be **absolute**, because a relative value is resolved against
 *   whatever working directory the writing process happens to have. That is not
 *   a theoretical placement: `insideAppBundle` cannot see it (a relative value
 *   has no `.app` segment), so it used to pass straight through, and measured on
 *   this machine with the cwd inside a bundle's own python directory,
 *   `env -u PYTHONDONTWRITEBYTECODE PYTHONPYCACHEPREFIX=relcache python3 -c
 *   "import encodings"` wrote `<cwd>/relcache/opt/homebrew/...` - i.e. the
 *   redirect itself put bytecode into the sealed tree it exists to keep
 *   bytecode out of. A relative value is therefore replaced with the app's own
 *   cache directory, the same outcome as a value pointing into a bundle.
 *
 * The two conditions are checked here together rather than folded into
 * `insideAppBundle`, because that predicate answers a narrower question - is
 * this path inside a bundle - and a relative path is not what it is for.
 */
function isUsablePrefix(value: string | undefined): value is string {
	if (!value) return false;
	if (!isAbsolute(value)) return false;
	return !insideAppBundle(value);
}

/*
 * The build-time ACL seal that used to live here is gone, deliberately.
 *
 * It could not be a correctness mechanism: `ditto` carries an access-control
 * entry but the ZIP Squirrel stages does not, so a bundle that arrives by
 * in-app update is unsealed from the swap until something re-applies it, and
 * the writers in that window are pythons this app never starts. Re-applying it
 * at startup or from the update watchdog only narrows a race it cannot close.
 *
 * The durable fix is that no venv resolves its stdlib inside any `.app` at all
 * (`backend/managed-python.ts`), so there is nothing in a bundle left to
 * unseal. `withPythonBytecodeCache` and the venv guard below stay as
 * defense-in-depth for the processes we do start.
 */

/**
 * `sitecustomize.py`: the name CPython's `site` module imports from the venv's
 * own `site-packages` on every start, before any of the venv's packages.
 */
export const VENV_BYTECODE_GUARD_FILE = "sitecustomize.py";

/**
 * The sentinel line that marks the guard as ours.
 *
 * Needed because the file lives in the venv's `site-packages`, which is a
 * directory a user may put their own files in: content that does not carry this
 * line is somebody else's `sitecustomize.py`, and the app refuses to replace it
 * (see {@link ensureVenvBytecodeGuard}). Written without a trailing newline so
 * it can be a prefix test rather than a parse.
 */
const VENV_BYTECODE_GUARD_SENTINEL = "# Local Operator bytecode guard";

/**
 * What {@link ensureVenvBytecodeGuard} did.
 *
 * `written: false` is an ordinary outcome, not a failure: the guard is already
 * there, the venv does not exist yet, or the file belongs to the user. `reason`
 * is the log line in every case, because the caller's next question is always
 * "why not".
 */
export type VenvBytecodeGuard = {
	/** The file written, found, or refused, or null when there is no venv yet. */
	path: string | null;
	/** True when this call created or refreshed the file. */
	written: boolean;
	reason: string;
};

/**
 * The text of the guard, as one string so the test can pin it and the app has
 * exactly one copy.
 *
 * Why a file inside the venv at all: the app's environment variables reach only
 * the processes it spawns or that inherit from one, and the processes that write
 * bytecode beside a stdlib are not all ours. The environment this app manages used
 * to be built on the interpreter INSIDE the installed bundle - its `pyvenv.cfg`
 * recorded `home = /Applications/Local Operator.app/Contents/Resources/
 * python_aarch64/bin`, so any process that ran its python resolved the stdlib
 * inside the code-sealed `.app`, and one `__pycache__` write there was a change to
 * a sealed resource. Measured in the field on 2026-09-14: the install of 0.22.2
 * was refused by Gatekeeper one run after the update with exactly one added file,
 * `lib/python3.12/__pycache__/webbrowser.cpython-312.pyc`, written by a python
 * this app never spawned.
 *
 * That is no longer where the environment's stdlib is. Since the interpreter
 * moved out of the bundle, this venv resolves every import from a runtime copied
 * outside every `.app`, so the guard no longer stands between a process and a
 * code-sealed tree - what it protects now is the runtime's IDENTITY, which is the
 * sha256 of the signed bytes it was copied from and which a stray cache file must
 * not be able to disturb. The structural half is that nothing resolves an
 * interpreter inside a bundle at all; see `managed-python.ts`. This guard is the
 * cheap half and it is not sufficient alone - `site.py`'s own startup imports
 * (`encodings` and friends) are compiled before `sitecustomize` runs - and it is
 * confined to the venv this app creates: the operator's own environments are
 * theirs.
 */
export function venvBytecodeGuardSource(): string {
	return `${VENV_BYTECODE_GUARD_SENTINEL}. Do not edit; the app rewrites this file.
#
# Why this file exists: this virtual environment is built on the interpreter
# inside the Local Operator application bundle (see pyvenv.cfg), so every module
# this python imports has its source - and CPython's bytecode cache for it -
# inside a code-sealed .app. A __pycache__/*.pyc written there changes a sealed
# resource, and macOS then answers "the app is damaged" on the next launch and
# Squirrel refuses the next in-place update with -67028
# errSecCSBadBundleFormat.
#
# PYTHONDONTWRITEBYTECODE and PYTHONPYCACHEPREFIX reach only the processes the
# app started or that inherited its environment. This file reaches every process
# that uses this environment, including one started by a shell, a script or
# launchd, because site.py imports sitecustomize from site-packages on every
# start.
#
# The cost, stated rather than hidden: a process under this flag compiles its
# imports and caches nothing, so the backend recompiles its import graph on each
# start. That is the deliberate trade against an application bundle that macOS
# refuses to open, and it is confined to this venv.
import sys

sys.dont_write_bytecode = True
`;
}

/**
 * The `site-packages` directory of a virtual environment, if it has one.
 *
 * Both layouts are stated rather than probed with a glob: a venv is
 * `lib/python<X.Y>/site-packages` on POSIX and `Lib/site-packages` on Windows,
 * and the version is whatever interpreter built it - which is the point, since
 * this runs against a venv the app did not necessarily create in this process.
 */
function venvSitePackages(venvPath: string): string[] {
	const candidates: string[] = [join(venvPath, "Lib", "site-packages")];
	try {
		for (const entry of readdirSync(join(venvPath, "lib"))) {
			if (entry.startsWith("python")) {
				candidates.push(join(venvPath, "lib", entry, "site-packages"));
			}
		}
	} catch {
		// No `lib/` is the ordinary state of a venv that does not exist yet, and
		// of a Windows one. The Windows candidate above is still checked.
	}
	return candidates.filter((candidate) => existsSync(candidate));
}

/**
 * Put the bytecode refusal inside the app-managed venv, or say why not.
 *
 * Idempotent by content: the file is rewritten only when it differs from
 * {@link venvBytecodeGuardSource}, so a start-up call on every launch costs one
 * read. It is called at start-up and after an install, which is what makes the
 * field installs - whose venvs were created before this guard existed - covered
 * without a reinstall.
 *
 * A `sitecustomize.py` that is not ours is never replaced: the file sits in
 * `site-packages`, which is a place a user can legitimately own, and the app
 * deletes nothing it did not write. A file that carries the sentinel is ours
 * from a previous revision and is refreshed, which is what keeps the "one copy
 * of the text" property true across releases.
 */
export function ensureVenvBytecodeGuard(venvPath: string): VenvBytecodeGuard {
	const dirs = venvSitePackages(venvPath);
	if (dirs.length === 0) {
		return {
			path: null,
			written: false,
			reason: `no site-packages under ${venvPath} yet, so there is nothing to guard`,
		};
	}
	const path = join(dirs[0], VENV_BYTECODE_GUARD_FILE);
	const source = venvBytecodeGuardSource();
	let existing: string | null = null;
	try {
		existing = readFileSync(path, "utf8");
	} catch {
		// Absent is the case this function is for.
	}
	if (existing === source) {
		return {
			path,
			written: false,
			reason: `${path} already refuses bytecode writes`,
		};
	}
	if (existing !== null && !existing.startsWith(VENV_BYTECODE_GUARD_SENTINEL)) {
		return {
			path,
			written: false,
			reason: `${path} is not ours (no "${VENV_BYTECODE_GUARD_SENTINEL}" line), so it was left exactly as it is`,
		};
	}
	try {
		writeFileSync(path, source);
	} catch (error) {
		return {
			path,
			written: false,
			reason: `could not write ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	return {
		path,
		written: true,
		reason: `${path} now sets sys.dont_write_bytecode for every process using this venv`,
	};
}
