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
 * these bits DOES change the identity. Measured on the arm64 tree for the
 * `3.12.14` / `20260901` pin this refresh ships: the raw
 * `*-aarch64-apple-darwin-install_only` extraction hashes to
 * `7986018d...` and the pruned tree `setup-python-resource.sh` stages hashes to
 * `cd61602f...` - the difference being the 10 paths it removes and the 24
 * execute bits it clears, with no file's own content touched. Both values were re-measured for this pin (review round 1, QA Q8 - the
 * pair quoted here before them belonged to the previous seed and read as a
 * release fact). A digest names ONE exact tree and is not portable between
 * copies of the same seed - an install's own copy hashes to its own value - so a
 * digest quoted anywhere should say which tree it belongs to; `cd61602f...` is
 * the shipped arm64 seed, and the value an install records in
 * `selected-environment.json` when it provisions from it. None of that means an update re-provisions.
 * `prepareManagedPython` returns a published selection whose
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
import {
	LAYOUT,
	PRUNED_SEED_OPTIONAL_PATHS,
	PRUNED_SEED_PATHS,
	SEED_STDLIB_MARKER,
	SEED_TK_DIR,
} from "./bundled-runtime-layout.mjs";
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

/**
 * The four FAT magics, named apart from the set above because the two SHAPES are
 * read differently.
 *
 * `MACH_O_MAGICS` answers "is this a Mach-O" and holds every spelling, which is
 * what it should hold: a universal binary is a Mach-O and counts as one
 * everywhere here. What it does not say is which of the three HEADER SHAPES a
 * file carries, and that is not a detail a reader can skip - a thin file's fields
 * are the header's own second and fourth words, while a fat file's live in
 * `fat_arch` entries behind an `nfat_arch` count, so the same offsets read a
 * plausible number for the wrong file. `machOHeader` below refuses a fat file for
 * exactly that reason, and `machOArchitectures` reads the entries.
 *
 * BOTH the 32-bit and the 64-bit spellings are here, and that is a corrected
 * decision rather than a widened one. `cafebabf`/`bfbafeca` (`FAT_MAGIC_64`) were
 * absent from the shared magic set for a review round, on the argument that
 * nothing here produces the shape - which left a component carrying it OUTSIDE
 * every Mach-O question this repository asks, so the release gate's sweep neither
 * counted it nor failed it, and the doc that describes the sweep said the
 * opposite. A 64-bit fat header is a Mach-O, so it belongs in the one definition
 * like its 32-bit sibling; the difference is only the `fat_arch` STRIDE (see
 * `FAT_ARCH_STRIDE`), and a shape the walk can see is a shape the reader can be
 * asked about rather than one it silently skips.
 *
 * What that costs on the app's side, which reads the same list for
 * `verifyMachO`: a file whose first four bytes are one of these is now held to
 * `codesign --verify --strict` in the seed, exactly as a 32-bit fat binary always
 * was. That is the correct direction - the previous behaviour was to leave such a
 * file unverified - and it is the argument for the one-definition fix rather than
 * a second list in the sweep.
 */

/**
 * One `fat_arch` entry's size per fat magic, and whether its fields are
 * big-endian.
 *
 * WHY THE STRIDE IS PER MAGIC AND NOT A CONSTANT: `fat_arch` is five 32-bit
 * words (20 bytes) and `fat_arch_64` is the same `cputype`/`cpusubtype` pair
 * followed by 64-bit `offset`/`size`, so it is 32 bytes; reading a 64-bit header
 * with the 32-bit stride walks into the middle of the next entry and answers a
 * cputype that is really an offset or an align field. `cputype` is the first word
 * of both, so the choice of stride is the whole of the difference a slice SET
 * needs. `MAGIC` (the first of each pair) is written big-endian and `CIGAM` its
 * byte-swapped twin, which is why the endianness belongs here beside the stride
 * rather than in a third place.
 *
 * This table is the one spelling of the four fat magics; `MACH_O_FAT_MAGICS`
 * below is derived from it, so the two cannot disagree about which spellings are
 * fat.
 */
const FAT_ARCH_STRIDE = new Map([
	["cafebabe", { bytes: 20, bigEndian: true }],
	["cafebabf", { bytes: 32, bigEndian: true }],
	["bebafeca", { bytes: 20, bigEndian: false }],
	["bfbafeca", { bytes: 32, bigEndian: false }],
]);

/** The fat magics, read off the stride table so the two sets cannot drift. */
const MACH_O_FAT_MAGICS = new Set(FAT_ARCH_STRIDE.keys());

/**
 * The seed content nothing can reach, relative to the seed root, and the marker
 * that says a tree is the Python those paths were written for.
 *
 * Both DERIVED from the declared version rather than written out here: the list
 * used to spell `lib/python3.12/...` literally, so a bump to another minor
 * version turned every entry into a silent no-op - the paths would not exist,
 * nothing would be removed, and the release gate's "the pruned paths are absent"
 * assertion would pass trivially for exactly that reason. The `{pyver}` token in
 * the definition file (expanded by `bundled-runtime-layout.mjs`) is what makes
 * that impossible now, and the marker check below still refuses a tree that is
 * not the Python the list applies to at all.
 *
 * Re-exported here, not defined here: `verify-macos-artifacts.mjs` reads them
 * from this module, and the definition the app and the pack step also read is
 * `src/shared/bundled-runtime-layout.json`.
 */
export {
	PRUNED_SEED_PATHS,
	PRUNED_SEED_OPTIONAL_PATHS,
	SEED_STDLIB_MARKER,
	SEED_TK_DIR,
};

/** A file's leading bytes, or `null` when they cannot be read.
 *
 * WHY THE OPEN IS INSIDE THE `try`: it was outside it, so the `null` this
 * documents held for a file that could not be READ but not for one that could
 * not be OPENED - a missing path threw `ENOENT` out of a helper whose whole job
 * is to answer "I cannot tell" (the release gate reads a launcher's header off a
 * path it resolves from `Info.plist`, which is exactly the case where the file
 * may not be there). */
function leadingBytes(path, length) {
	try {
		const fd = openSync(path, "r");
		try {
			const bytes = Buffer.alloc(length);
			const read = readSync(fd, bytes, 0, length, 0);
			return bytes.subarray(0, read);
		} finally {
			closeSync(fd);
		}
	} catch {
		return null;
	}
}

/** A file's first four bytes, as hex, or `null` when they cannot be read.
 *
 * The open sits inside the `try` for the reason given on `leadingBytes`. */
function leadingMagic(path) {
	try {
		const fd = openSync(path, "r");
		try {
			const magic = Buffer.alloc(4);
			readSync(fd, magic, 0, 4, 0);
			return magic.toString("hex");
		} finally {
			closeSync(fd);
		}
	} catch {
		return null;
	}
}

/** Whether a path is a Mach-O (or fat) file, by the app's own magic set. */
export function isMachO(path) {
	return MACH_O_MAGICS.has(leadingMagic(path));
}

/**
 * The leading words of a thin Mach-O header, or `null` when they cannot be had.
 *
 * WHY ONE READER FOR TWO FIELDS: `cputype` and `filetype` are the second and
 * fourth 32-bit words of the same header, and the header's ENDIANNESS is a
 * property of the file rather than of the question asked of it - two parsers
 * would be two chances to decide that differently, and a wrong-endian read does
 * not crash, it answers a plausible number for the wrong file. `machOFileType`
 * ("may this keep an execute bit", below) and `machOCpuType` ("does this host
 * run it natively", in the release gate's own module) read the words; this reads
 * the header.
 *
 * Fat binaries answer `null`, because a fat file's fields live in each slice
 * rather than here.
 *
 * The 64-bit layouts are little-endian on both of this app's architectures
 * (`cffaedfe`/`feedfacf`), and the 32-bit magics are read with the endianness
 * their magic spells (`cefaedfe`/`feedface`).
 */
function machOHeader(path) {
	const bytes = leadingBytes(path, 16);
	if (bytes == null || bytes.length < 16) return null;
	const magic = bytes.toString("hex", 0, 4);
	if (!MACH_O_MAGICS.has(magic)) return null;
	// Fat files carry their fields in `fat_arch` entries, not here.
	if (MACH_O_FAT_MAGICS.has(magic)) return null;
	// `feedfacf`/`feedface` are the big-endian spellings, `cffaedfe`/`cefaedfe`
	// the little-endian ones.
	return { bytes, bigEndian: magic === "feedfacf" || magic === "feedface" };
}

/** One 32-bit header word, read in the header's own endianness. */
function machOWord(header, offset) {
	return header.bigEndian
		? header.bytes.readUInt32BE(offset)
		: header.bytes.readUInt32LE(offset);
}

/**
 * A Mach-O file's `filetype`, or `null` when the header does not answer.
 *
 * WHY THIS EXISTS BESIDE `isMachO`: "is this a Mach-O" and "is this an
 * EXECUTABLE" are two different questions, and the release gate used to conflate
 * them - it required the number of execute bits under the seed to equal the
 * number of Mach-O files. That held while every Mach-O in the tree was the
 * interpreter and its library; the `20260901` build ships loadable Tcl/Tk
 * libraries (`MH_DYLIB`, mode 0644, upstream's own modes - measured in the raw
 * tarball before any prune of ours) and the equality became false for a tree that
 * is perfectly correct. The `filetype` field is what separates the two: the app
 * spawns `MH_EXECUTE` files, and the loader `mmap`s everything else (measured:
 * `ctypes.CDLL` loads a 0644 dylib in this very seed).
 *
 * Fat binaries and unreadable headers answer `null`, and the conservative
 * reading of that is "this may be an executable", so `machOExecutables` treats
 * an unreadable one as executable. The seed is per-architecture and thins are
 * what upstream ships, so this is a guard rather than a case.
 */
export function machOFileType(path) {
	const header = machOHeader(path);
	return header == null ? null : machOWord(header, 12);
}

/** The Mach-O `cputype` values this app's two architectures answer. */
export const MACH_O_CPUTYPE = {
	X86_64: 0x01000007,
	ARM64: 0x0100000c,
};

/**
 * A Mach-O file's `cputype`, or `null` when the header does not answer - which
 * is every fat file and every file this cannot read.
 *
 * WHY IT EXISTS: the release gate EXECS a bundle's launcher and then has to say
 * whether this host runs that file natively or has to translate it, because a
 * translation is a one-time cost paid in wait rather than in work (measured on
 * the x64 launcher of a shipped bundle on an arm64 host: 24.7 s wall against
 * 0.5 s of user time on the first exec, 1.2 s on the second). That is a property
 * of the file the kernel loads, so it is read off that file's own header rather
 * than inferred from a filename, a bundle directory or a neighbouring binary.
 *
 * The 64-bit ABI flag is part of the value - `0x0100000c` is arm64, not
 * `0x0000000c` - so a caller compares against the full word.
 */
export function machOCpuType(path) {
	const header = machOHeader(path);
	return header == null ? null : machOWord(header, 4);
}

/**
 * EVERY architecture a Mach-O file carries, or `null` when its header cannot be
 * read.
 *
 * WHY A SET BESIDE `machOCpuType` RATHER THAN INSTEAD OF IT: the two answer
 * different questions and both are asked. `machOCpuType` answers for a THIN file
 * and returns `null` for a fat one, which is right for its caller - the release
 * gate's spawn bound asks whether THIS HOST has to translate the one file it is
 * about to exec, a per-file question about one architecture. The gate's
 * native-component check asks a different thing: whether a component's slices
 * INCLUDE the bundle's own architecture, so a universal component
 * (arm64 + x86_64) passes while an x86_64-only one fails. Making the thin reader
 * answer that would mean changing what `machOCpuType` means for its existing
 * caller; two parsers would mean two decisions about the magic set, the
 * endianness and the field offsets, and a wrong-endian read does not crash - it
 * answers a plausible number for the wrong file. So the fat case is added here,
 * in the one reader, and the thin case reuses the same header reader.
 *
 * THE FAT CASE READS BOTH STRIDES. A `fat_arch` is 20 bytes and a `fat_arch_64`
 * is 32 - the same `cputype`/`cpusubtype` pair followed by 64-bit `offset` and
 * `size` - so the stride and the endianness both come from `FAT_ARCH_STRIDE`
 * rather than from a constant here. `cputype` is the first word of either stride,
 * which is the whole of what a slice SET needs from the difference; reading a
 * 64-bit header at the 32-bit stride would answer an offset or an align word as if
 * it were an architecture.
 *
 * A count of zero expresses no architecture at all and an implausible count is a
 * header this cannot be trusted to have read, so both answer `null` - "could not
 * ask", which every caller here treats as a failure rather than as a pass.
 */
export function machOArchitectures(path) {
	const magic = leadingMagic(path);
	if (magic == null || !MACH_O_MAGICS.has(magic)) return null;
	const fat = FAT_ARCH_STRIDE.get(magic);
	if (fat) {
		const words = leadingBytes(path, 8);
		if (words == null || words.length < 8) return null;
		const count = fat.bigEndian ? words.readUInt32BE(4) : words.readUInt32LE(4);
		if (count === 0 || count > 64) return null;
		const bytes = leadingBytes(path, 8 + count * fat.bytes);
		if (bytes == null || bytes.length < 8 + count * fat.bytes) return null;
		const slices = [];
		for (let index = 0; index < count; index += 1) {
			const at = 8 + index * fat.bytes;
			slices.push(
				fat.bigEndian ? bytes.readUInt32BE(at) : bytes.readUInt32LE(at),
			);
		}
		return slices;
	}
	const header = machOHeader(path);
	return header == null ? null : [machOWord(header, 4)];
}

/** The Mach-O `filetype` values this app cares about. */
export const MACH_O_FILETYPE = {
	MH_EXECUTE: 2,
	MH_DYLIB: 6,
	MH_BUNDLE: 8,
};

/**
 * Every Mach-O file under `root` the app may EXECUTE.
 *
 * `MH_EXECUTE` is the filetype the kernel runs, and it is the only one whose
 * execute bit is load-bearing: `MH_DYLIB` and `MH_BUNDLE` are read through
 * `dlopen`, which mmaps them and never execs them (measured: a 0644 dylib from
 * this seed loads in the seed's own interpreter). A fat or unreadable-header
 * Mach-O is included, because "we could not tell" is not "it is a library".
 */
export function machOExecutables(root) {
	return machOFiles(root).filter((relative) => {
		const type = machOFileType(join(root, relative));
		return type == null || type === MACH_O_FILETYPE.MH_EXECUTE;
	});
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
 * `import turtle` all succeed. `lib/tk9.0` (minus its `demos` data, which the
 * `20260901` build no longer ships at all), `tkinter/` and `turtle.py` are
 * therefore LIVE and are not on the list; only the demo data and the
 * IDLE/2to3/pydoc tooling are.
 *
 * A NAMED PATH THAT IS NOT THERE IS A FAILURE, not a no-op. That is the fix for
 * the class this file has now been bitten by twice: `bin/idle3.{pyver}` expanded
 * to a name no tree has, and `lib/tk8.6/demos` was spelled for the previous Tcl/Tk
 * line while the `20260901` build moved to 9.0 and stopped shipping demos. Both
 * pruned nothing, both looked like success in the log (`Pruned 10 seed path(s)`),
 * and the release gate's "the pruned paths are absent" assertion is satisfied by a
 * path that never existed. The required list therefore has to exist, and the one
 * entry that may legitimately be missing is declared as optional and reported.
 */
export function pruneSeed(root, { log = console.log } = {}) {
	if (!lstatSync(join(root, SEED_STDLIB_MARKER), { throwIfNoEntry: false })) {
		throw new Error(
			`Refusing to prune ${root}: it has no ${SEED_STDLIB_MARKER}, so it is not the Python the prune list was written for. Update the python version and the seed paths in src/shared/bundled-runtime-layout.json together with the seed version.`,
		);
	}
	const removed = [];
	// Presence is checked for the WHOLE list before anything is removed, so a
	// stale declaration fails the build on an untouched tree rather than halfway
	// through one.
	// The Tcl/Tk token's own binding (review R2-5): its only other consumer is the
	// OPTIONAL demos entry, whose absence is the accepted outcome, so without this
	// reading a stale `tkVersion` would prune nothing and be indistinguishable
	// from a correct build. `lib/tk9.0` is content the prune keeps, which is
	// exactly why it can be required here.
	if (!lstatSync(join(root, SEED_TK_DIR), { throwIfNoEntry: false })) {
		throw new Error(
			`Refusing to prune ${root}: it has no ${SEED_TK_DIR}, so it is not the Tcl/Tk the declaration names. The tkVersion token would then make the optional demos entry prune nothing while looking correct - update the tkVersion key in src/shared/bundled-runtime-layout.json together with the seed.`,
		);
	}
	const missing = PRUNED_SEED_PATHS.filter(
		// `lstat`, not `exists`: a dangling symlink is content the bundle must not
		// carry either, and the list contains links (`bin/2to3`).
		(relative) => !lstatSync(join(root, relative), { throwIfNoEntry: false }),
	);
	if (missing.length > 0) {
		throw new Error(
			`The prune list names ${missing.length} path(s) this tree does not have: ${missing.join(", ")}. A name that matches nothing prunes nothing and reads as success, so it is refused here rather than reported. Either the declaration in src/shared/bundled-runtime-layout.json is stale (a version token, or a path upstream moved), or this tree has ALREADY been pruned - the prune is not idempotent by design, because "the paths are absent" is indistinguishable from "the list is wrong" and only the fresh tree that staging step extracts tells the two apart. Re-stage with it (pnpm setup-python) if that is the case. A path that may legitimately be absent belongs in prunedSeedPathsOptional with the reason.`,
		);
	}
	for (const relative of [
		...PRUNED_SEED_PATHS,
		...PRUNED_SEED_OPTIONAL_PATHS,
	]) {
		const path = join(root, relative);
		if (!lstatSync(path, { throwIfNoEntry: false })) continue;
		rmSync(path, { recursive: true, force: true });
		removed.push(relative);
	}
	const absentOptional = PRUNED_SEED_OPTIONAL_PATHS.filter(
		(relative) => !removed.includes(relative),
	);
	const cleared = clearIncidentalExecBits(root);
	const remaining = seedModeViolations(root);
	if (remaining.length > 0) {
		throw new Error(
			`Seed files still carry an execute bit without a Mach-O header after chmod: ${remaining.slice(0, 8).join(", ")}`,
		);
	}
	const machO = countMachO(root);
	const executables = machOExecutables(root);
	log(
		`Pruned ${removed.length} of ${PRUNED_SEED_PATHS.length + PRUNED_SEED_OPTIONAL_PATHS.length} named seed path(s)${absentOptional.length > 0 ? ` (${absentOptional.length} optional entry absent: ${absentOptional.join(", ")})` : ""} and cleared ${cleared.length} incidental execute bit(s); ${machO} Mach-O file(s), ${executables.length} of them executable, keep their modes.`,
	);
	return { removed, cleared, machO, executables, absentOptional };
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
