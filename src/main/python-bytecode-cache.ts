import {
	type Dirent,
	type Stats,
	chmodSync,
	lstatSync,
	readdirSync,
} from "node:fs";
import { join } from "node:path";

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
 * The environment variable is only half the guarantee, and the smaller half:
 * an interpreter started with `-E`/`-I` ignores every `PYTHON*` variable by
 * design, so `sealPythonInterpreterTrees()` below removes the write bits from
 * the shipped tree itself. Read its docstring before changing either half - it
 * carries the measurements, and the two exist as a pair.
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
 * `env` with `PYTHONPYCACHEPREFIX` pointing outside the application bundle.
 *
 * Every other variable is passed through untouched - the backend needs the
 * operator's `PATH` to reach `gh` and `brew`, so a spawn environment is
 * additive here, never a replacement.
 *
 * An operator's own `PYTHONPYCACHEPREFIX` is kept when it points somewhere
 * outside an `.app` bundle: they have already solved this problem for
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
	if (existing && !insideAppBundle(existing)) return { ...env };
	return { ...env, PYTHONPYCACHEPREFIX: pythonBytecodeCacheDir(userDataDir) };
}

/**
 * The interpreter trees an app rooted at `resourcesPath` may ship.
 *
 * The same two directory names `backend-installer.ts` probes when it looks for
 * the bundled interpreter (`findPython`): the arm64 build ships
 * `python_aarch64`, every other build `python`. Kept here as one list so a new
 * spelling cannot appear beside it.
 */
export const BUNDLED_PYTHON_TREE_NAMES = ["python", "python_aarch64"] as const;

/** The candidate bundled-interpreter trees for a packaged app. */
export function bundledPythonTreePaths(resourcesPath: string): string[] {
	return BUNDLED_PYTHON_TREE_NAMES.map((name) => join(resourcesPath, name));
}

/** What {@link sealPythonInterpreterTrees} did, and what it could not do. */
export type PythonTreeSeal = {
	/** Trees that exist and were walked. */
	sealed: string[];
	/** Paths whose write bits were cleared by this call. */
	cleared: number;
	/** Paths that were already read-only, so this call left them alone. */
	alreadyReadOnly: number;
	/** Paths the walk refused to change, with the reason. Never thrown. */
	failures: { path: string; error: string }[];
};

/**
 * Take the write bit off every file and directory under each tree.
 *
 * Why this exists beside `withPythonBytecodeCache` (measured on 2026-09-13,
 * macOS 25.6.0, against the shipped 0.19.2 interpreter tree):
 *
 * `PYTHONPYCACHEPREFIX` is an *environment variable*, so it protects only a
 * process that reads the environment. A child started with `-E` or `-I` ignores
 * every `PYTHON*` variable by design - that is what the flags mean - and
 * CPython's own tooling uses them: `venv` bootstraps pip through `ensurepip`,
 * which inserts `-I` when it is already isolated, and this repository spawns its
 * own evaluation workers with `-I -s -E` (with `-B` precisely because of this).
 * Measured from the bundled tree, with the prefix pointing at userData:
 * `-I -c "import json, subprocess, uuid"` wrote **41** `.pyc` into the sealed
 * tree, `-E -c "import json, csv, argparse"` wrote **24**, and an environment
 * carrying `PYTHONDONTWRITEBYTECODE=1` was ignored the same way (30). So an
 * isolated or environment-stripped grandchild can still unseal the bundle, and
 * nothing the app sets in an environment can reach it.
 *
 * Making the *target* refuse the write is the one form of this guarantee that
 * does not depend on the child at all, and CPython already treats it as normal:
 * a `__pycache__` it cannot write is simply not cached, silently, with no error
 * and no behavioural change. Measured on a copy of the shipped tree: with the
 * tree read-only, a bare run and an isolated (`-I`) run wrote **0** files, the
 * tree's contents were unchanged, `python -m venv` still produced a working
 * environment with pip, and `codesign --verify --deep --strict` still exited 0 -
 * a mode change is not a sealed resource, so this does not invalidate the
 * signature it is protecting.
 *
 * `-B`/`PYTHONDONTWRITEBYTECODE` was the alternative belt and is deliberately
 * NOT used: it stops bytecode caching rather than redirecting it (every backend
 * and session-runtime launch would recompile its import graph), and in its
 * environment form it is ignored by exactly the isolated children it would need
 * to stop.
 *
 * Read-only rather than deleted: the tree is the interpreter's own stdlib, and
 * the app must never remove a sealed resource. Directories keep read+execute, so
 * the tree stays fully usable; only writes are refused. Best-effort by design -
 * a bundle on a read-only volume, or one owned by another user, must leave the
 * app exactly as it was, because the environment half of the pair still applies.
 */
export function sealPythonInterpreterTrees(
	trees: readonly string[],
): PythonTreeSeal {
	const result: PythonTreeSeal = {
		sealed: [],
		cleared: 0,
		alreadyReadOnly: 0,
		failures: [],
	};
	for (const tree of trees) {
		let root: Stats;
		try {
			root = lstatSync(tree);
		} catch {
			// Absent is the normal case for the tree this build does not ship
			// (x64 apps have `python`, arm64 apps `python_aarch64`) and for a dev
			// run, whose resources directory is an Electron install.
			continue;
		}
		if (!root.isDirectory()) continue;
		result.sealed.push(tree);
		clearWriteBits(tree, result);
	}
	return result;
}

/** Depth-first walk clearing write bits, tolerant of a tree that changes size. */
function clearWriteBits(path: string, result: PythonTreeSeal): void {
	let entries: Dirent[];
	try {
		entries = readdirSync(path, { withFileTypes: true });
	} catch (error) {
		result.failures.push({ path, error: String(error) });
		return;
	}
	for (const entry of entries) {
		const child = join(path, entry.name);
		// A symlink is not followed: the shipped tree links to itself and to
		// nothing outside it, and chmod through a link would reach a file this
		// tree does not own.
		if (entry.isDirectory()) clearWriteBits(child, result);
		if (entry.isSymbolicLink()) continue;
		clearWriteBit(child, result);
	}
	// The directory itself last, so the walk could still create nothing it
	// needed to: without its own write bit, new cache directories are refused.
	clearWriteBit(path, result);
}

/** Clear one path's write bits, recording rather than raising a failure. */
function clearWriteBit(path: string, result: PythonTreeSeal): void {
	try {
		const mode = lstatSync(path).mode & 0o777;
		const readOnly = mode & ~0o222;
		if (mode === readOnly) {
			result.alreadyReadOnly += 1;
			return;
		}
		chmodSync(path, readOnly);
		result.cleared += 1;
	} catch (error) {
		result.failures.push({ path, error: String(error) });
	}
}
