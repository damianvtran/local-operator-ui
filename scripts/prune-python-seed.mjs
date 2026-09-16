#!/usr/bin/env node
/**
 * Shrink what an in-place macOS update has to write: drop the seed content
 * nothing can reach, and clear the execute bits that mean nothing in a bundle.
 *
 * WHY THIS EXISTS. An in-app update closes the app while Squirrel.Mac's ShipIt
 * extracts, validates and swaps the bundle. Measured on this machine, the
 * `Beginning installation` -> `Moving bundle` phase of that swap ran 49.5 s and
 * 204.7 s for the same 380 MB / 2087-file artifact, on the same day, while
 * ShipIt used ~21 s of CPU across the 205 s - it is blocked on something per
 * file, per byte or per code object, and nobody has established which. The
 * bundle is 87% interpreter seed by file count, and a seed ships whole
 * standard-library trees (IDLE, its test data, the `2to3` toolchain) that the
 * backend can never import, plus ~50 files whose execute bit came from the
 * upstream tarball and means nothing here. This step removes work that is dead
 * under EVERY candidate explanation rather than guessing at the mechanism.
 *
 * WHAT IT DOES NOT DO. It does not decide whether tkinter, the seed's own
 * `site-packages/pip`, or `config-3.12-darwin/` are dead - each was measured
 * against a staged runtime before this list was written, and the ones that are
 * reachable stay (see `docs/` in the change that introduced this file, and the
 * comment on `pruneSeed` for the tkinter result).
 *
 * WHY THE EXECUTE BIT IS USELESS HERE. The seed is inert data: nothing executes
 * it in place. `prepareRuntime` `ditto`s a copy of it into
 * `managed-python/<packaged|dev>/runtimes/<identity>-<uuid>` outside every
 * `.app` and builds the venv against that copy (`managed-python.ts`), and the
 * only program ever executed is `<runtime>/bin/python3` -> `bin/python3.12`.
 * Python's import machinery does not consult the execute bit at all, so the
 * ~40 stdlib `.py` files that carry one are read, not run: the bit was copied
 * from the upstream tarball and describes a machine nobody ships. Mach-O files
 * keep theirs because the kernel and `codesign` do read it.
 *
 * WHERE IT RUNS. `scripts/setup-python-resource.sh`, on the tree that becomes
 * `Contents/Resources/python-runtime-seed/<arch>` - the only place the seed is
 * materialised, and the place its sibling "no `.pyc`" invariant already lives.
 * That is BEFORE signing, which is load-bearing: the seed is code-sealed as
 * part of the `.app`, so removing anything after signing would be a
 * `file missing:` violation, the class no update-time heal can repair.
 *
 * WHY THE PRUNE LIST IS NOT A FILTER IN `extraResources`: the seed is copied
 * whole into the checkout by `pnpm setup-python`, and the app's own
 * `verifyMachO`/`runtimeManifest` hash what it finds. Pruning where the tree is
 * assembled keeps the dev seed and the shipped seed identical, so what a
 * developer runs is what a release ships.
 *
 * WHAT THIS COSTS AN EXISTING INSTALL: NOTHING - and the obvious claim here
 * was wrong before this comment said otherwise. `runtimeManifest` records each
 * entry's mode and `runtimeId` is the sha256 of that manifest, so clearing
 * these bits DOES change the identity (measured: the unpruned seed hashes to
 * 03782941..., the pruned one to 3b120dac..., and between the two trees 0 files
 * differ in bytes while 23 differ in mode). It does not follow that an update
 * re-provisions. `prepareManagedPython` returns a published selection whose
 * `inspectManagedSelection` verdict is `ready` and never compares that runtime
 * to the CURRENT seed - `publishedRuntimeIsReusable`, the one comparison that
 * does, is read only on the missing/reap path - and on darwin the installer
 * never even reaches that call, because `BackendInstaller.isInstalled()` IS
 * `managedSelectionReady()`. So an install that already provisioned keeps the
 * runtime copied from the previous seed and pays nothing on first launch; the
 * pruned seed is what a FRESH provisioning copies (a new machine, or a wiped
 * `managed-python/`), at the new id.
 *
 * The identity still may not be normalised away, which is the decision the id
 * must carry: a repair after a broken runtime copies the CURRENT seed at its
 * id, `environments/<id>-<uuid>` names the generation, and the modes are inside
 * the signed tree the id is meant to describe. Normalising them would change
 * every id ever published and stop the identity covering what was signed.
 *
 * Usage: `node scripts/prune-python-seed.mjs <seed-root>` (setup-python calls
 * it). The exported functions are what the unit test and the release gate drive.
 */
import {
	chmodSync,
	closeSync,
	lstatSync,
	openSync,
	readSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { LAYOUT } from "./bundled-python-layout.mjs";
import { isEntryPoint } from "./entry-point.mjs";

/**
 * The Mach-O magics, read from the app's own layout definition.
 *
 * This is deliberately not a second copy of the test: `verifyMachO` in
 * `src/main/backend/managed-python.ts` reads the same list, because "is this
 * file a Mach-O" answers "may this file keep an execute bit" here and "must
 * this file verify against its signature" there, and two hand-kept lists for
 * one question is how a rule drifts.
 */
export const MACH_O_MAGICS = new Set(LAYOUT.machOMagics);

/** The seed content nothing can reach, relative to the seed root. */
export const PRUNED_SEED_PATHS = LAYOUT.prunedSeedPaths;

/**
 * The file that says this tree is the Python the prune list was written for.
 *
 * The list spells `lib/python3.12/...`, so a bump to another minor version
 * would otherwise turn every entry into a silent no-op - the paths would not
 * exist, nothing would be removed, and the release gate's "the pruned paths are
 * absent" assertion would pass trivially for exactly that reason. Requiring the
 * marker turns that into a build failure that names the file to update.
 */
export const SEED_STDLIB_MARKER = LAYOUT.seedStdlibMarker;

/** A file's first four bytes, as hex, or `null` when they cannot be read. */
function leadingMagic(path) {
	const fd = openSync(path, "r");
	try {
		const magic = Buffer.alloc(4);
		readSync(fd, magic, 0, 4, 0);
		return magic.toString("hex");
	} catch {
		return null;
	} finally {
		closeSync(fd);
	}
}

/** Whether a path is a Mach-O (or fat) file, by the app's own magic set. */
export function isMachO(path) {
	return MACH_O_MAGICS.has(leadingMagic(path));
}

/** Every entry under `root`, relative to it, without following symlinks. */
export function walk(root, relative = "") {
	const entries = [];
	for (const entry of readdirSync(join(root, relative), {
		withFileTypes: true,
	})) {
		const child = relative ? join(relative, entry.name) : entry.name;
		entries.push(child);
		// `isDirectory` is false for a symlink to a directory, which is what
		// keeps a link out of the walk: the seed's links are checked by the
		// release gate's own walk, and following one here could both duplicate
		// an entry and reach outside the tree.
		if (entry.isDirectory()) entries.push(...walk(root, child));
	}
	return entries;
}

/**
 * Every seed file carrying any execute bit, relative to `root`.
 *
 * Files only: a directory's execute bit is what lets anything traverse it, and a
 * symlink's mode is not ownable (`chmod` follows the link, `lchmod` is a no-op
 * on macOS).
 */
export function seedExecBitFiles(root) {
	const files = [];
	for (const relative of walk(root)) {
		const path = join(root, relative);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink() || !stat.isFile()) continue;
		if ((stat.mode & 0o111) !== 0) files.push(relative);
	}
	return files;
}

/**
 * Every seed file whose execute bit is not justified by a Mach-O header.
 *
 * One predicate, two callers: `clearIncidentalExecBits` is the fix and the
 * release gate is the assertion, so a seed that ships 53 execute bits again
 * fails the release rather than passing it quietly.
 */
export function seedModeViolations(root) {
	return seedExecBitFiles(root).filter(
		(relative) => !isMachO(join(root, relative)),
	);
}

/**
 * Clear the execute bit on seed files that are not Mach-O, keeping it on the
 * ones that are.
 *
 * Symlinks are skipped rather than followed: `chmod` on one follows the link
 * (so it would clear the bit on `bin/python3.12` through `bin/python3`) and
 * `lchmod` is a no-op on macOS, so the mode of a link is not a thing this or
 * any other step can own.
 */
export function clearIncidentalExecBits(root) {
	const cleared = [];
	for (const relative of seedModeViolations(root)) {
		const path = join(root, relative);
		const mode = lstatSync(path).mode;
		chmodSync(path, mode & ~0o111);
		cleared.push(relative);
	}
	return cleared;
}

/**
 * Delete the seed content nothing can reach, then normalise execute bits.
 *
 * The tkinter question, settled by running rather than by reading: this
 * standalone CPython builds `_tkinter` INTO the interpreter (measured on the
 * seed from the installed 0.25.15 app: `_tkinter` is in
 * `sys.builtin_module_names` and `tkinter.Tcl()` reports Tcl 8.6.14 even though
 * `lib-dynload` holds only `_crypt`), so `import tkinter`, `Tk()` and
 * `import turtle` all succeed. `lib/tk8.6` (minus its `demos` data),
 * `tkinter/` and `turtle.py` are therefore LIVE and are not on the list; only
 * the demo data and the IDLE/2to3/pydoc tooling are.
 */
export function pruneSeed(root, { log = console.log } = {}) {
	if (!lstatSync(join(root, SEED_STDLIB_MARKER), { throwIfNoEntry: false })) {
		throw new Error(
			`Refusing to prune ${root}: it has no ${SEED_STDLIB_MARKER}, so it is not the Python the prune list was written for. Update seedStdlibMarker and prunedSeedPaths in src/shared/bundled-python-layout.json together with the seed version.`,
		);
	}
	const removed = [];
	for (const relative of PRUNED_SEED_PATHS) {
		const path = join(root, relative);
		// `lstat`, not `exists`: a dangling symlink is content the bundle must
		// not carry either, and the list contains links (`bin/2to3`).
		if (!lstatSync(path, { throwIfNoEntry: false })) continue;
		rmSync(path, { recursive: true, force: true });
		removed.push(relative);
	}
	const cleared = clearIncidentalExecBits(root);
	const remaining = seedModeViolations(root);
	if (remaining.length > 0) {
		throw new Error(
			`Seed files still carry an execute bit without a Mach-O header after chmod: ${remaining.slice(0, 8).join(", ")}`,
		);
	}
	const machO = countMachO(root);
	log(
		`Pruned ${removed.length} seed path(s) and cleared ${cleared.length} incidental execute bit(s); ${machO} Mach-O file(s) keep theirs.`,
	);
	return { removed, cleared, machO };
}

/** Every Mach-O file under `root`, relative to it. */
export function machOFiles(root) {
	return walk(root).filter((relative) => {
		const stat = lstatSync(join(root, relative));
		return (
			!stat.isSymbolicLink() && stat.isFile() && isMachO(join(root, relative))
		);
	});
}

function countMachO(root) {
	return machOFiles(root).length;
}

if (isEntryPoint(import.meta.url)) {
	const root = process.argv[2];
	if (!root) {
		console.error("Usage: node scripts/prune-python-seed.mjs <seed-root>");
		process.exit(2);
	}
	pruneSeed(root, { log: (line) => console.log(line) });
}
