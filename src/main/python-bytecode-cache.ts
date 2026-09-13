import { spawnSync } from "node:child_process";
import { type Stats, lstatSync } from "node:fs";
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
 * design, so `sealPythonInterpreterTrees()` below makes the shipped tree itself
 * refuse the writes. Read its docstring before changing either half - it
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
	/**
	 * Directories `find` selected for the directory entry. A *selected* count,
	 * not a sealed one: compare it against {@link failures} before saying any of
	 * them now refuse a new entry - see {@link describePythonTreeSeal}, which is
	 * the only place that reads this pair into words.
	 */
	directories: number;
	/**
	 * Existing `.pyc` `find` selected for the rewrite entry, with the same
	 * selected-not-applied caveat as {@link directories}.
	 */
	bytecodeFiles: number;
	/**
	 * Paths the tool refused, with its own message (which names the path). Never
	 * thrown; a non-empty list is a partial seal.
	 */
	failures: string[];
	/**
	 * Whether this platform has the mechanism at all. False everywhere but
	 * macOS, where the harm and the access-control entries both exist; the
	 * caller must not read `sealed: []` as "no tree was there" without it.
	 */
	supported: boolean;
};

/**
 * The `find` and `chmod` the seal runs, by absolute path.
 *
 * Addressed absolutely because this runs before any window exists, on a
 * `PATH` that may have been inherited from the operator's own shell: which
 * `find` or `chmod` the app runs is not a decision that environment gets to
 * make. macOS ships both, and the seal is macOS-only.
 */
const FIND = "/usr/bin/find";
const CHMOD = "/bin/chmod";

/**
 * The access-control entries the seal applies, one per kind of path.
 *
 * These two rights sets are the entire mechanism and they are deliberately
 * different, because a directory and a file need opposite halves of the write
 * permission withheld:
 *
 * - a **directory** denies `add_file`/`add_subdirectory` - nothing new can be
 *   created inside it, which is the `__pycache__` directory and the `.pyc` both
 *   - while `delete_child` stays granted, so unlink and rmdir still work;
 * - an existing **`.pyc`** denies `write`/`append`, so a stale one cannot be
 *   rewritten (`file modified:`, the class the heal cannot repair) - and
 *   unlinking it is a directory operation, not a file one, so the heal still
 *   can.
 *
 * A mode cannot express this split: one write bit on a directory covers both
 * creating and unlinking its entries, which is why sealing by mode costs the
 * app its own deletion and its own repair (see the docstring below).
 */
const DIRECTORY_ACE = "everyone deny add_file,add_subdirectory";
const BYTECODE_ACE = "everyone deny write,append";

/**
 * Ceiling on the path list `find` prints back, which is only ever counted.
 *
 * The shipped trees are ~150 directories and ~1,800 files, so the real figure
 * is tens of kilobytes; a ceiling exists so a tree that has grown something
 * pathological cannot turn a spawn into an ENOBUFS that leaves the seal
 * half-applied and unattributed.
 */
const MAX_FIND_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * How many refused paths {@link describePythonTreeSeal} names before counting
 * the rest.
 *
 * A refusal is actionable because of *which* path it was, but the line goes to
 * an operator's log next to everything else the installer says, so it names a
 * few and counts the remainder rather than dumping hundreds of lines.
 */
const PARTIAL_SEAL_NAMED = 3;

/**
 * The one place a seal result is turned into operator-facing words, so a
 * *selected* count can never read as an applied one.
 *
 * The distinction this exists for: `directories` and `bytecodeFiles` are what
 * `find` selected, and only `failures` says whether the entry landed. The
 * wording this replaced said both things in one sentence on a bundle where
 * nothing was applied - "4 path(s) now refuse new entries, 1 refuse rewrites, 5
 * refused", measured on a read-only APFS volume, where all five were refused
 * and none of the four directories could have refused anything (Q4/R8). A
 * partial seal therefore reads as partial and names what was not sealed, and a
 * platform without the mechanism says that instead of reporting zeroes.
 */
export function describePythonTreeSeal(seal: PythonTreeSeal): string {
	if (!seal.supported) {
		return "Bundled interpreter bytecode seal is macOS-only (there is no code seal to protect elsewhere); the bytecode cache prefix still applies";
	}
	const trees = seal.sealed.join(", ") || "(none present)";
	if (seal.failures.length === 0) {
		return `Bundled interpreter trees sealed against bytecode writes: ${trees}; ${seal.directories} directory path(s) selected and now refusing new entries, ${seal.bytecodeFiles} bytecode file(s) selected and now refusing rewrites`;
	}
	const named = seal.failures.slice(0, PARTIAL_SEAL_NAMED).join("; ");
	const rest = seal.failures.length - PARTIAL_SEAL_NAMED;
	return `Bundled interpreter bytecode seal INCOMPLETE: ${trees}; ${seal.directories} directory path(s) and ${seal.bytecodeFiles} bytecode file(s) selected, ${seal.failures.length} refused and left with the access they had - bytecode writes into the bundle are not prevented on every path. First refusals: ${named}${rest > 0 ? ` (+${rest} more)` : ""}`;
}

/**
 * Make the bundled interpreter trees refuse new files, without making the app
 * undeletable.
 *
 * Why this exists beside `withPythonBytecodeCache` (measured on 2026-09-13,
 * macOS 25.6.0, against real copies of the shipped 0.19.2 interpreter tree):
 *
 * `PYTHONPYCACHEPREFIX` is an *environment variable*, so it protects only a
 * process that reads the environment - and the app does not spawn every process
 * that runs this interpreter. The backend virtual environment is created with
 * the bundled interpreter, which makes the venv's own `python` resolve its
 * stdlib to the tree inside the code-sealed `.app` (`pyvenv.cfg` carries
 * `home = <bundle>/Contents/Resources/python_aarch64/bin`), so *anything* that
 * starts that python itself - the operator's shell, a CLI script, launchd, an
 * agent - carries no `PYTHONPYCACHEPREFIX` at all. Measured: `python -c "import
 * json, uuid, argparse, csv"` from a venv over the bundled tree wrote 25 `.pyc`
 * into the tree. That is the class the operator's own install is in - 163
 * `.pyc` under `Contents/Resources/python_aarch64`, every one of them written
 * by a python the app's environment never reached.
 *
 * A child can also ignore the environment by design: `-E` and `-I` mean "do not
 * read `PYTHON*` variables", and the backend's evaluation supervisor spawns its
 * workers with `-I -s -E -B` (the `-B` is why those workers are safe today).
 * Measured against an unsealed control clone of the same bytes, with the prefix
 * set: `-I -c "import json, subprocess, uuid"` wrote 30 `.pyc` into the tree,
 * `-E -c "import json, csv, argparse"` 24, `-I -S` 25, a
 * `PYTHONDONTWRITEBYTECODE=1` environment 21, `-I -m ensurepip --root` 166, and
 * `-I -m compileall` over the tree 1,097.
 *
 * The install path is *not* in that class, and it is worth saying so because it
 * is easy to assume it is: 3.12's `venv` bootstraps pip by calling `ensurepip`
 * with `-m` and a copy of the environment, deliberately not `-I` - CPython's
 * gh-98251, "we do not want to just use -I because that masks legitimate user
 * preferences (such as not writing bytecode)" - so measured, `-m venv` with the
 * prefix set writes 0 `.pyc` into the tree. What the environment half cannot
 * reach is the child that never receives it, and no environment the app can set
 * changes that, so the refusal has to live at the *target*.
 *
 * Why access-control entries and not the obvious `chmod`: one write bit on a
 * directory covers both creating an entry and unlinking one, so clearing it
 * refuses the write at the cost of the two things the app still has to be able
 * to do. Measured on a mode-sealed copy of the same tree: `rm -rf` exits 1 with
 * `Permission denied` per entry and `Directory not empty`, so the tree survives
 * its own uninstall - emptying the Trash cannot reclaim it - and the app's own
 * repair comes back `healable=false removed=0`, because `healPythonBytecode`
 * (`update-install.ts`) heals an unsealed bundle by unlinking the `.pyc` CPython
 * added. A bundle the user cannot delete and the app cannot heal is a worse bug
 * than the one being fixed, so the seal withholds the two rights separately, as
 * {@link DIRECTORY_ACE} and {@link BYTECODE_ACE} state.
 *
 * Measured on those same copies, every class run from fresh clones of the same
 * bytes with the sealed column carrying the entries: the sealed column wrote
 * **0** `.pyc` in every class above and gained **0** entries of any kind - so
 * there is no legacy `foo.pyc` fallback beside the source either - while the
 * control column wrote the numbers above. The explicit compilers need their exit
 * attributed, because it belongs to the *no-prefix* arm: `-I -m compileall` over
 * the whole `lib/python3.12` (which tries to compile all ~1,800 sources) wrote 0
 * files and exited 1, and `-I` is what puts it in that arm - the flag means it
 * does not read `PYTHON*` variables, so the redirect the app sets is invisible to
 * it even with `PYTHONPYCACHEPREFIX` set (Q5). Measured on a sealed fixture tree,
 * with the cache directory outside the tree and the tree's entry count before
 * and after: `py_compile` rc=0 and 80 entries into the prefix with the prefix
 * visible, rc=1 with `-I`, rc=1 with no prefix; `compileall` rc=0 and 7 entries
 * into the prefix visible, rc=1 with `-I`. All four arms wrote 0 entries into the
 * tree. That exit is the shape of the mechanism rather than a fault: `py_compile`
 * and `compileall` are explicit compilers that raise on a refused write, where an
 * *import* through `SourceFileLoader.set_data` swallows it and simply does not
 * cache. Nothing on the app's paths calls either.
 *
 * The rest of the pair's properties, measured the same way: the interpreter in a
 * sealed tree still runs and still produces a working venv (`-I -m venv` exits 0
 * with pip 25.0.1 in it), every file's contents are unchanged (sha256 over every
 * path, before and after), and `codesign --verify --deep --strict` still exits 0
 * with 0 violations - an access-control entry is not a sealed resource, so this
 * cannot invalidate the signature it exists to protect. `rm -rf` of the sealed
 * tree exits 0, which is the property the mode seal could not have.
 *
 * `-B`/`PYTHONDONTWRITEBYTECODE` was the alternative belt and is deliberately
 * NOT used: it stops bytecode caching rather than redirecting it (every backend
 * and session-runtime launch would recompile its import graph), and in its
 * environment form it is ignored by exactly the isolated children it would need
 * to stop.
 *
 * macOS only, and deliberately: what this protects is a *code signature*, and
 * only macOS seals an `.app`'s resources, so on Linux and Windows there is
 * nothing to protect and nothing to do - the environment half is the whole
 * guarantee there. The mechanism is macOS's too: POSIX ACLs as Linux implements
 * them have no deny entries (the same "one right for both halves" problem), and
 * on Windows Node's `chmod` only sets a file's read-only attribute, which does
 * nothing to a directory's ability to gain entries. The previous revision ran
 * the mode seal on every platform, which chmod'ed ~2,000 real paths on Linux for
 * no benefit at all.
 *
 * Best-effort by design, and reported rather than hidden: a bundle on a volume
 * without access-control support, or one owned by another user, leaves the app
 * exactly as it was - the failures are named in the result and the environment
 * half of the pair still applies.
 *
 * Scope of the file half, stated so it is not mistaken for an oversight: only
 * `.pyc` is denied a rewrite. The sources themselves are not, because a write
 * to one is not something any spawn class performs - and a *new* file beside a
 * source, which is the one legacy form a write could take, is refused by the
 * directory it would land in (`-I -m compileall`, which tries to emit bytecode
 * for every source in the tree, created 0 files).
 */
export function sealPythonInterpreterTrees(
	trees: readonly string[],
): PythonTreeSeal {
	const result: PythonTreeSeal = {
		sealed: [],
		directories: 0,
		bytecodeFiles: 0,
		failures: [],
		supported: process.platform === "darwin",
	};
	if (!result.supported) return result;
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
		result.directories += applyAce(
			tree,
			["-type", "d"],
			DIRECTORY_ACE,
			result.failures,
		);
		result.bytecodeFiles += applyAce(
			tree,
			["-type", "f", "-name", "*.pyc"],
			BYTECODE_ACE,
			result.failures,
		);
	}
	return result;
}

/**
 * Apply `ace` to every path `selector` matches under `tree`, and return how
 * many `find` selected.
 *
 * `-exec ... {} +` batches the tool over as many paths as one argument list
 * holds instead of spawning once per path, which is what keeps this off the
 * second it would otherwise cost; `-print0` after it is what makes a count
 * possible at all, since the tool itself prints nothing on success. The count
 * is therefore *paths selected*, and {@link PythonTreeSeal.failures} is the
 * exceptions - a non-empty `failures` is a partial seal and reads as one.
 *
 * `find` does not follow symlinks, so `-type d`/`-type f` skip the tree's own
 * in-tree links (`bin/python3 -> python3.12`, `lib/pkgconfig/*.pc`, the man
 * pages) by construction, and a broken one is not an error here.
 */
function applyAce(
	tree: string,
	selector: readonly string[],
	ace: string,
	failures: string[],
): number {
	const run = spawnSync(
		FIND,
		[tree, ...selector, "-exec", CHMOD, "+a", ace, "{}", "+", "-print0"],
		{ encoding: "buffer", maxBuffer: MAX_FIND_OUTPUT_BYTES },
	);
	if (run.error) {
		failures.push(`${tree}: ${String(run.error)}`);
		return 0;
	}
	// A refused path comes back on stderr in the tool's own words, which name the
	// path; anything at all on stderr is a failure, including a selector this
	// `find` did not understand.
	for (const line of String(run.stderr).split("\n")) {
		if (line.trim().length > 0) failures.push(line.trim());
	}
	if (run.status !== 0 && String(run.stderr).trim().length === 0) {
		failures.push(`${tree}: ${FIND} exited ${run.status} with no explanation`);
	}
	let selected = 0;
	for (const byte of run.stdout) if (byte === 0) selected += 1;
	return selected;
}
