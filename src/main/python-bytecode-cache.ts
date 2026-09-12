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
 * Deliberately free of Electron imports so the contract tests bundle this
 * shipped module in memory (`pnpm test:desktop`), and pure so the decision is
 * testable without a process to spawn.
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
