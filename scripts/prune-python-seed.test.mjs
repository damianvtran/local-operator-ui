import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { LAYOUT } from "./bundled-runtime-layout.mjs";
import {
	MACH_O_CPUTYPE,
	MACH_O_FILETYPE,
	PRUNED_SEED_OPTIONAL_PATHS,
	PRUNED_SEED_PATHS,
	SEED_STDLIB_MARKER,
	SEED_TK_DIR,
	clearIncidentalExecBits,
	isMachO,
	machOArchitectures,
	machOCpuType,
	machOExecutables,
	machOFileType,
	machOFiles,
	pruneSeed,
	seedExecBitFiles,
	seedModeViolations,
} from "./prune-python-seed.mjs";
import { bundledUvToolCheck } from "./python-artifact-layout.mjs";
import {
	prunedSeedCheck,
	seedBootstrapCheck,
	seedModeCheck,
	seedVersionCheck,
} from "./verify-macos-artifacts.mjs";

/*
 * Coverage for the seed pruning an in-app update pays for, and for the release
 * gate that has to notice when it stops happening.
 *
 * WHY THESE CASES EXIST. Every failure in this area is silent and lands on the
 * user rather than on the build: a prune that removes nothing still produces a
 * working app, still starts, and the only symptom is that every update writes
 * the content this change removed. The same is true of the gate's own checks -
 * a check nobody calls is a comment, and a check that is called but cannot fail
 * is worse, because it reads as evidence. So each case below drives the real
 * function over a real tree, and the gate cases assert both directions: the
 * passing bundle passes, and each regression that matters fails.
 *
 * WHAT IS REAL: the shipped modules, and real files on a real filesystem.
 * WHAT IS SUBSTITUTED: the Mach-O file is four magic bytes and padding rather
 * than a signed binary. The predicate under test IS those four bytes (the app's
 * `verifyMachO` reads the same set from
 * `src/shared/bundled-runtime-layout.json`), and whether a Mach-O's signature
 * verifies is `verifyMachO`'s assertion, exercised in `managed-python.test.mjs`
 * against a real seed. Synthesising it keeps this suite runnable on CI's Linux
 * runner, where the desktop suite runs.
 */

const tempDirs = [];

function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

after(() => {
	// Nothing here writes outside its own temp dir, so removal is a plain
	// recursive unlink; a failure to remove is not a test failure.
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Ignore: the OS reclaims /tmp.
		}
	}
});

/**
 * A Mach-O file: the magic `verifyMachO` tests, the `filetype` word the release
 * gate's exec-bit rule reads, and padding.
 *
 * The filetype is written rather than left as zeros because it is load-bearing
 * now: `MH_EXECUTE` (2) is the only filetype the kernel runs, `MH_DYLIB` (6) and
 * `MH_BUNDLE` (8) are read through `dlopen`, and a zero word is neither - a
 * fixture that left it out would be a file the gate refused as "no executable
 * here", which is a different assertion than the ones these cases make.
 */
function writeMachO(
	path,
	{
		fileType = MACH_O_FILETYPE.MH_EXECUTE,
		mode = 0o755,
		cpuType = MACH_O_CPUTYPE.ARM64,
	} = {},
) {
	mkdirSync(dirname(path), { recursive: true });
	const header = Buffer.alloc(64);
	Buffer.from("cffaedfe", "hex").copy(header, 0);
	header.writeUInt32LE(cpuType, 4);
	header.writeUInt32LE(fileType, 12);
	writeFileSync(path, header);
	chmodSync(path, mode);
}

/**
 * A fat (universal) Mach-O: `nfat_arch` then one `fat_arch` entry per slice,
 * `cputype` first in each.
 *
 * `bits` picks the entry STRIDE - 20 bytes for `fat_arch`, 32 for `fat_arch_64`,
 * whose `offset`/`size` are 64-bit - and the magic follows from it unless one is
 * named: `cafebabe` / `cafebabf` big-endian, `bebafeca` / `bfbafeca` the
 * byte-swapped twins. Both strides and both endiannesses are written in the cases
 * below, because a reader that assumes one does not fail on the other - it answers
 * a plausible number for the wrong file.
 */
function writeFatMachO(path, cpuTypes, { magic, bits = 32, count } = {}) {
	mkdirSync(dirname(path), { recursive: true });
	const stride = bits === 64 ? 32 : 20;
	const resolved = magic ?? (bits === 64 ? "cafebabf" : "cafebabe");
	const bigEndian = resolved === "cafebabe" || resolved === "cafebabf";
	const written = count ?? cpuTypes.length;
	const header = Buffer.alloc(8 + Math.max(written, 0) * stride);
	Buffer.from(resolved, "hex").copy(header, 0);
	if (bigEndian) header.writeUInt32BE(written, 4);
	else header.writeUInt32LE(written, 4);
	cpuTypes.forEach((cpuType, index) => {
		const at = 8 + index * stride;
		if (bigEndian) header.writeUInt32BE(cpuType, at);
		else header.writeUInt32LE(cpuType, at);
		if (stride !== 32) return;
		// A `fat_arch_64` is not just a longer entry: its `offset` and `size` are 64-bit
		// words, so the fields after the cputype pair must be written at the wide
		// offsets. They are filled with the values `lipo` writes (2^14-aligned
		// offsets, a real slice size, align 14) rather than left zero, because the
		// wrong-stride case below depends on what a stride-20 read of these bytes
		// would answer, and a table of zeros would let that read answer 0 weakly.
		if (bigEndian) {
			header.writeUInt32BE(3, at + 4);
			header.writeBigUInt64BE(BigInt(16384 * (index + 1)), at + 8);
			header.writeBigUInt64BE(81600n, at + 16);
			header.writeUInt32BE(14, at + 24);
		} else {
			header.writeUInt32LE(3, at + 4);
			header.writeBigUInt64LE(BigInt(16384 * (index + 1)), at + 8);
			header.writeBigUInt64LE(81600n, at + 16);
			header.writeUInt32LE(14, at + 24);
		}
	});
	writeFileSync(path, header);
}

/** A plain file, optionally carrying the execute bit the upstream tarball ships. */
function writeFile(path, { exec = false } = {}) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "# read, never run\n");
	if (exec) chmodSync(path, 0o755);
}

/**
 * A seed tree with everything the prune list names, one Mach-O interpreter, and
 * the venv bootstrap the gate requires. `pruned` says whether the content is
 * still there or has already been removed.
 */
function makeSeed(dir, { pruned = false } = {}) {
	mkdirSync(dir, { recursive: true });
	if (!pruned) {
		for (const relative of PRUNED_SEED_PATHS) {
			if (relative.startsWith("bin/")) {
				writeFile(join(dir, relative));
				continue;
			}
			// A tree in the list is a directory in the seed, and what a prune must
			// leave behind is its parents - so the fixture writes a directory with
			// real content, and the one the upstream tarball ships executable
			// carries the bit that has to be cleared.
			writeFile(join(dir, relative, "pyshell.py"), {
				exec: relative === "lib/python3.12/idlelib",
			});
		}
	} else {
		// What a prune leaves behind: the parent directories survive while the
		// pruned entries do not, which is why the gate checks the entries.
		writeFile(join(dir, "lib/python3.12/os.py"));
	}
	writeFile(join(dir, SEED_STDLIB_MARKER));
	// The Tcl/Tk tree, in BOTH states: it is content the prune deliberately keeps,
	// and it is what ties the `{tkver}` token to the build (review R2-5) - the
	// prune refuses a tree that does not carry it.
	writeFile(join(dir, SEED_TK_DIR, "tk.tcl"));
	writeFile(join(dir, "lib/python3.12/venv/__init__.py"));
	writeFile(join(dir, "lib/python3.12/ensurepip/__init__.py"));
	writeFile(
		join(dir, "lib/python3.12/ensurepip/_bundled/pip-25.0.1-py3-none-any.whl"),
	);
	if (!pruned) writeFile(join(dir, "lib/python3.12/cgi.py"), { exec: true });
	writeMachO(join(dir, "bin/python3.12"));
	symlinkSync("python3.12", join(dir, "bin/python3"));
	// The shape the `20260901` build ships and the `20250529` one did not: loadable
	// libraries, some of them at 0644 upstream (measured in the raw tarball). The
	// passing case carries them so the exec-bit rule is exercised in the direction
	// that made the old count equality false.
	writeMachO(join(dir, "lib/libpython3.12.dylib"), {
		fileType: MACH_O_FILETYPE.MH_DYLIB,
		mode: 0o755,
	});
	writeMachO(join(dir, "lib/itcl4.3.8/libitcl4.3.8.dylib"), {
		fileType: MACH_O_FILETYPE.MH_DYLIB,
		mode: 0o644,
	});
	return dir;
}

/**
 * A packaged app carrying one arm64 seed, already pruned - the shape the gate
 * must pass.
 *
 * Every regression case below mutates a fresh copy of this, so a failing case
 * fails for the one thing it changed.
 */
function makePassingApp(dir) {
	const app = join(dir, "mac-arm64", "Local Operator.app");
	const resources = join(app, "Contents", "Resources");
	makeSeed(join(resources, LAYOUT.python.seedNamespace, "arm64"), {
		pruned: true,
	});
	return {
		app,
		resources,
		seed: join(resources, LAYOUT.python.seedNamespace, "arm64"),
	};
}

test("the prune removes exactly the content the layout lists", () => {
	const seed = makeSeed(tempDir("lo-seed-"));
	const result = pruneSeed(seed, { log: () => {} });

	assert.deepEqual(result.removed.sort(), [...PRUNED_SEED_PATHS].sort());
	for (const relative of PRUNED_SEED_PATHS)
		assert.equal(
			existsSync(join(seed, relative)),
			false,
			`${relative} must be gone from the seed`,
		);
	// The interpreter, the stdlib and the bootstrap survive it: this is a prune,
	// not a strip, and the gate's other checks depend on all three.
	for (const relative of [
		"bin/python3.12",
		SEED_STDLIB_MARKER,
		"lib/python3.12/venv/__init__.py",
	])
		assert.equal(
			existsSync(join(seed, relative)),
			true,
			`${relative} must survive`,
		);
});

test("the prune refuses a tree that is not the Python the list was written for", () => {
	// A version bump is the silent failure this guards: every listed path would
	// simply not exist, nothing would be removed, and the release gate's "the
	// pruned paths are absent" assertion would pass for exactly that reason.
	const seed = makeSeed(tempDir("lo-seed-"), { pruned: true });
	rmSync(join(seed, SEED_STDLIB_MARKER));
	assert.throws(
		() => pruneSeed(seed, { log: () => {} }),
		(error) => error.message.includes(`no ${SEED_STDLIB_MARKER}`),
		"a seed with no 3.12 stdlib must fail the build, not prune nothing quietly",
	);
});

test("the execute bit survives on Mach-O files and nowhere else", () => {
	const seed = makeSeed(tempDir("lo-seed-"));
	assert.ok(
		seedModeViolations(seed).length > 0,
		"the fixture must start with the incidental bits a real seed ships",
	);

	const cleared = clearIncidentalExecBits(seed).sort();

	assert.deepEqual(cleared, [
		"lib/python3.12/cgi.py",
		"lib/python3.12/idlelib/pyshell.py",
	]);
	assert.equal(seedModeViolations(seed).length, 0);
	// Mach-O files keep the bit: the kernel and `codesign` read it.
	assert.equal(statSync(join(seed, "bin/python3.12")).mode & 0o111, 0o111);
	// Everything else keeps its read and write bits. The import machinery does
	// not read the execute bit, and a file whose mode changed in any other way
	// would be a different file to the runtime identity hash.
	assert.equal(
		statSync(join(seed, "lib/python3.12/cgi.py")).mode & 0o777,
		0o644,
	);
});

test("a second prune refuses, a symlink is not a mode to own, and the prune owns only the executable half", () => {
	const seed = makeSeed(tempDir("lo-seed-"));
	pruneSeed(seed, { log: () => {} });
	// `bin/python3` is a link into `bin/python3.12`; it must still resolve, and
	// the walk must not have tried to own its mode (macOS has no `lchmod`, and
	// `chmod` on a link follows it).
	assert.equal(statSync(join(seed, "bin/python3")).mode & 0o111, 0o111);
	// The prune is NOT idempotent, and that is the R1-6 decision rather than an
	// oversight: a tree the list's paths are all absent from is either one that
	// was already pruned or one the list no longer describes, and only the fresh
	// tree `pnpm setup-python` extracts tells those apart. A silent second pass
	// was the shape that let `lib/tk8.6/demos` prune nothing for a whole release.
	assert.throws(
		() => pruneSeed(seed, { log: () => {} }),
		/already been pruned|does not have/,
	);
	const second = pruneSeed(makeSeed(tempDir("lo-seed-")), {
		log: () => {},
	});
	// The tree this fixture models carries the interpreter AND the loadable
	// libraries the `20260901` build ships - `libpython3.12.dylib` at 0755
	// (upstream's mode) and two Tcl/Tk libraries at 0644 (also upstream's). What
	// the prune owns is the EXECUTABLE half: one file, and the one the app spawns.
	assert.deepEqual(second.removed.length, PRUNED_SEED_PATHS.length);
	assert.deepEqual(second.absentOptional, PRUNED_SEED_OPTIONAL_PATHS);
	assert.deepEqual(machOExecutables(seed), ["bin/python3.12"]);
	assert.equal(second.machO, 3);
	assert.deepEqual(machOFiles(seed).sort(), [
		"bin/python3.12",
		"lib/itcl4.3.8/libitcl4.3.8.dylib",
		"lib/libpython3.12.dylib",
	]);
	assert.deepEqual(seedExecBitFiles(seed).sort(), [
		"bin/python3.12",
		"lib/libpython3.12.dylib",
	]);
	assert.equal(
		machOFileType(join(seed, "bin/python3.12")),
		MACH_O_FILETYPE.MH_EXECUTE,
	);
	assert.equal(
		machOFileType(join(seed, "lib/itcl4.3.8/libitcl4.3.8.dylib")),
		MACH_O_FILETYPE.MH_DYLIB,
	);
	// The interpreter's bit, and nothing else's, is what the app needs; the
	// library that carries one carries it because upstream does.
	assert.equal(statSync(join(seed, "bin/python3.12")).mode & 0o111, 0o111);
	assert.equal(
		statSync(join(seed, "lib/itcl4.3.8/libitcl4.3.8.dylib")).mode & 0o111,
		0,
	);
});

test("the gate passes a pruned bundle and names each way it can regress", () => {
	const passing = makePassingApp(tempDir("lo-app-"));
	for (const check of [
		prunedSeedCheck(passing.app),
		seedModeCheck(passing.app),
		seedBootstrapCheck(passing.app),
	])
		assert.equal(check.passed, true, `${check.id} must pass: ${check.output}`);
	assert.deepEqual(
		prunedSeedCheck(passing.app).output,
		`${PRUNED_SEED_PATHS.length + PRUNED_SEED_OPTIONAL_PATHS.length} pruned path(s) absent`,
	);
	assert.match(
		seedModeCheck(passing.app).output,
		/executable\(s\) carrying the execute bit \(bin\/python3 among them\)/,
		"the exec-bit reading names the file the app spawns rather than counting Mach-O files",
	);

	// 1. Content the prune removes comes back.
	const restored = makePassingApp(tempDir("lo-app-"));
	writeFile(join(restored.seed, "lib/python3.12/idlelib/idle.py"));
	const restoredCheck = prunedSeedCheck(restored.app);
	assert.equal(restoredCheck.passed, false);
	assert.match(restoredCheck.output, /lib\/python3\.12\/idlelib/);

	// 2. An execute bit on something that is not Mach-O, named by path.
	const chmodded = makePassingApp(tempDir("lo-app-"));
	chmodSync(join(chmodded.seed, "lib/python3.12/os.py"), 0o755);
	const modeCheck = seedModeCheck(chmodded.app);
	assert.equal(modeCheck.passed, false);
	assert.match(modeCheck.output, /lib\/python3\.12\/os\.py/);

	// 2b. An EXECUTABLE that lost its bit. This is the failure the check exists
	// for (a packaging step that drops modes leaves an interpreter the OS refuses
	// to spawn), and it is the case the old count equality could MISS: a library
	// that gained a bit while the interpreter lost one kept the totals equal.
	const bitless = makePassingApp(tempDir("lo-app-"));
	chmodSync(join(bitless.seed, "bin/python3.12"), 0o644);
	const bitlessCheck = seedModeCheck(bitless.app);
	assert.equal(bitlessCheck.passed, false);
	assert.match(bitlessCheck.output, /bin\/python3\.12/);
	assert.match(bitlessCheck.output, /do not carry the execute bit/);

	// 2c. A library at 0644 is FINE, and this is the correction review round 1
	// forced on this check: `libitcl4.3.8/libitcl4.3.8.dylib` is `MH_DYLIB`
	// (loaded through `dlopen`, never exec'd) and upstream ships it without a bit
	// in the `20260901` build. The check must not demand a mode on it - and the
	// fixture's own passing case already carries one, so this case asserts the
	// absence explicitly rather than by construction.
	const library = makePassingApp(tempDir("lo-app-"));
	assert.equal(
		seedModeCheck(library.app).passed,
		true,
		"a loadable library without an execute bit must not fail the gate",
	);

	// 3. A seed with no Mach-O at all: the subset test on its own is satisfied by
	// a seed whose interpreter is gone, which is why the executables are named.
	const noMachO = makePassingApp(tempDir("lo-app-"));
	for (const gone of [
		"bin/python3.12",
		"lib/libpython3.12.dylib",
		"lib/itcl4.3.8/libitcl4.3.8.dylib",
	])
		rmSync(join(noMachO.seed, gone));
	const emptyModeCheck = seedModeCheck(noMachO.app);
	assert.equal(emptyModeCheck.passed, false);
	assert.match(emptyModeCheck.output, /No Mach-O file under the seed/);

	// 3b. A seed whose interpreter was replaced by a LIBRARY: Mach-O files are
	// present, none of them is a filetype the kernel runs, and the check says so
	// instead of passing on a count.
	const libraryOnly = makePassingApp(tempDir("lo-app-"));
	writeMachO(join(libraryOnly.seed, "bin/python3.12"), {
		fileType: MACH_O_FILETYPE.MH_DYLIB,
		mode: 0o755,
	});
	const libraryCheck = seedModeCheck(libraryOnly.app);
	assert.equal(libraryCheck.passed, false);
	assert.match(libraryCheck.output, /No executable Mach-O under the seed/);

	// 3c. The optional prune entry coming back is the build having skipped the
	// prune, exactly as a required one is (review R1-6 / QA's Q4 follow-up: the
	// optional half has to be asserted too, or "optional" reads as "unchecked").
	const optionalBack = makePassingApp(tempDir("lo-app-"));
	writeFile(join(optionalBack.seed, PRUNED_SEED_OPTIONAL_PATHS[0], "widget"));
	const optionalCheck = prunedSeedCheck(optionalBack.app);
	assert.equal(optionalCheck.passed, false);
	assert.match(optionalCheck.output, new RegExp(PRUNED_SEED_OPTIONAL_PATHS[0]));

	// 4. The venv bootstrap: the half an install cannot recover from.
	const noWheel = makePassingApp(tempDir("lo-app-"));
	rmSync(join(noWheel.seed, "lib/python3.12/ensurepip/_bundled"), {
		recursive: true,
	});
	const bootstrapCheck = seedBootstrapCheck(noWheel.app);
	assert.equal(bootstrapCheck.passed, false);
	assert.match(bootstrapCheck.output, /ensurepip\/_bundled\/pip-\*\.whl/);
});

/*
 * The two halves the modules above cannot assert about themselves.
 *
 * Why these cases are here rather than in the modules: the prune and the gate
 * were once both correct while the step that RUNS them was missing from the
 * build, and every test in the sibling file stayed green because they drive the
 * modules rather than the thing that decides whether the modules run. The gap
 * was the config, so the config is what is asserted - the same lesson
 * `prune-bundled-resources.test.mjs` records for `afterPack`.
 */
test("the Tcl/Tk token is bound to the tree, not only to an optional entry", () => {
	// Review R2-5. `{tkver}`'s only prune consumer is the OPTIONAL demos entry, so
	// before this binding a refresh that moved Tcl/Tk while the token stayed put
	// would prune nothing and look exactly like a correct build - the no-op class
	// R1-6 fixed, one token over. The tree is asserted to carry `lib/tk<declared>`.
	const seed = makeSeed(tempDir("lo-seed-"));
	pruneSeed(seed, { log: () => {} });
	assert.equal(
		existsSync(join(seed, SEED_TK_DIR)),
		true,
		"the prune keeps the Tk tree",
	);

	// A tree whose Tcl/Tk moved without the declaration moving with it.
	const stale = makeSeed(tempDir("lo-seed-"));
	rmSync(join(stale, SEED_TK_DIR), { recursive: true });
	writeFile(join(stale, "lib/tk8.6/tk.tcl"));
	assert.throws(
		() => pruneSeed(stale, { log: () => {} }),
		/lib\/tk\d+\.\d+/,
		"a tree whose Tcl/Tk is not the declared one must fail by name",
	);
});

test("a named path the tree does not have is refused, and an optional one is reported", () => {
	// The R1-6 guard, driven through the real function rather than the message:
	// `lib/tk8.6/demos` pruned nothing for a whole release because a stale
	// version token made it a no-op that read as success.
	const incomplete = makeSeed(tempDir("lo-seed-"));
	rmSync(join(incomplete, "lib/python3.12/turtledemo"), { recursive: true });
	assert.throws(
		() => pruneSeed(incomplete, { log: () => {} }),
		/lib\/python3\.12\/turtledemo/,
		"a required path that is missing must fail the build by name",
	);

	// An optional entry that is absent is reported rather than fatal, and one
	// that IS present is pruned like any other.
	const complete = makeSeed(tempDir("lo-seed-"));
	const result = pruneSeed(complete, { log: () => {} });
	assert.deepEqual(result.absentOptional, PRUNED_SEED_OPTIONAL_PATHS);
	assert.deepEqual(result.removed.length, PRUNED_SEED_PATHS.length);
	const withDemos = makeSeed(tempDir("lo-seed-"));
	writeFile(join(withDemos, PRUNED_SEED_OPTIONAL_PATHS[0], "widget"));
	const prunedDemos = pruneSeed(withDemos, { log: () => {} });
	assert.deepEqual(prunedDemos.absentOptional, []);
	assert.deepEqual(
		prunedDemos.removed.length,
		PRUNED_SEED_PATHS.length + PRUNED_SEED_OPTIONAL_PATHS.length,
	);
	assert.equal(
		existsSync(join(withDemos, PRUNED_SEED_OPTIONAL_PATHS[0])),
		false,
	);
});

/** A bundle whose seed claims to be a Python release. Drives the version gate. */
function makeVersionedApp(dir, version) {
	const app = join(dir, "mac-arm64", "Local Operator.app");
	const seed = join(
		app,
		"Contents",
		"Resources",
		LAYOUT.python.seedNamespace,
		"arm64",
	);
	mkdirSync(join(seed, "bin"), { recursive: true });
	// A stand-in for the interpreter: the check runs `bin/python3 -I -B --version`
	// and reads the release out of it, so what matters is what this prints.
	writeFileSync(
		join(seed, "bin", "python3"),
		`#!/bin/sh\necho "Python ${version}"\n`,
	);
	chmodSync(join(seed, "bin", "python3"), 0o755);
	return { app, seed };
}

test("the shipped seed's own version is asserted against the declaration", () => {
	// Review R1-5: this check had no committed test, and it is the only reading in
	// the repository that can see a PATCH level - the tree's own markers
	// (`lib/python3.12`, `_sysconfigdata`'s `VERSION`) carry the major.minor.
	const declared = JSON.parse(
		readFileSync(join("src", "shared", "bundled-runtime-layout.json"), "utf8"),
	).python.version;
	const matching = makeVersionedApp(tempDir("lo-app-"), declared);
	const pass = seedVersionCheck(matching.app);
	assert.equal(pass.passed, true, pass.output);
	assert.match(pass.output, new RegExp(declared.replace(/\./g, "\\.")));

	// A refresh that changes the declaration and never re-stages the seed is the
	// failure this exists for: the bundle ships the previous patch release under
	// the new number, and every other check is green.
	const stale = makeVersionedApp(tempDir("lo-app-"), "3.12.10");
	const fail = seedVersionCheck(stale.app);
	assert.equal(fail.passed, false);
	assert.match(fail.output, /3\.12\.10/);
	assert.match(fail.output, new RegExp(declared.replace(/\./g, "\\.")));
});

test("the bundled uv is asserted where it lives: one architecture, runnable", () => {
	// Review R1-5, and QA Q3 (the install script cannot detect a
	// wrong-architecture uv - this gate is what does). `lipo` is stubbed, because
	// this suite runs on CI's Linux runner and the point of these cases is the
	// gate's decisions rather than the Mach-O reader; the real runner is what
	// `pnpm verify-macos-artifacts` passes, and the real `lipo` reading of the real
	// binary is on the PR.
	const lipo = (archs) => () => ({
		status: 0,
		stdout: `${archs}\n`,
		stderr: "",
	});
	const makeApp = (dir, { arch = "arm64", mode = 0o755, file = true } = {}) => {
		const app = join(dir, "mac-arm64", "Local Operator.app");
		if (arch === null) return { app };
		const tree = join(app, "Contents", "Resources", "uv", arch);
		mkdirSync(tree, { recursive: true });
		if (file) {
			writeFileSync(join(tree, "uv"), "#!/bin/sh\nexit 0\n");
			chmodSync(join(tree, "uv"), mode);
		}
		return { app };
	};

	const pass = bundledUvToolCheck(makeApp(tempDir("lo-uv-")).app, {
		expectArch: "arm64",
		run: lipo("arm64"),
	});
	assert.equal(pass.passed, true, pass.output);
	assert.match(pass.output, /arm64 executable/);

	// The artifact's own name is what the uv must match: an x64-named artifact
	// carrying the arm64 uv runs on the machine it was built on and not on the one
	// it was built for.
	const named = bundledUvToolCheck(makeApp(tempDir("lo-uv-")).app, {
		expectArch: "x64",
		run: lipo("arm64"),
	});
	assert.equal(named.passed, false);
	assert.match(named.output, /names x64 but ships the arm64 uv/);

	// Present, one architecture, but not the one its directory claims - the case
	// the directories and the bytes disagree about.
	const mismatched = bundledUvToolCheck(makeApp(tempDir("lo-uv-")).app, {
		expectArch: "arm64",
		run: lipo("x86_64"),
	});
	assert.equal(mismatched.passed, false);
	assert.match(mismatched.output, /arm64 uv directory carries a x86_64 binary/);

	// Present, right architecture, no execute bit: the mode a ZIP would drop.
	const noBit = bundledUvToolCheck(
		makeApp(tempDir("lo-uv-"), { mode: 0o644 }).app,
		{ expectArch: "arm64", run: lipo("arm64") },
	);
	assert.equal(noBit.passed, false);
	assert.match(noBit.output, /no execute bit/);

	// Neither architecture: the bundle ships no uv at all.
	const none = bundledUvToolCheck(
		makeApp(tempDir("lo-uv-"), { arch: null }).app,
		{
			expectArch: "arm64",
			run: lipo("arm64"),
		},
	);
	assert.equal(none.passed, false);
	assert.match(none.output, /ships no uv/);
});

test("the seeding script runs the prune", () => {
	const script = readFileSync(
		join(process.cwd(), "scripts/setup-python-resource.sh"),
		"utf8",
	);
	assert.match(
		script,
		/node\s+"\$\(dirname "\$0"\)\/prune-python-seed\.mjs"/,
		"setup-python-resource.sh must run scripts/prune-python-seed.mjs: it is the only place the seed tree is materialised, and a prune nothing calls is a comment",
	);
});

test("the app and this step read one Mach-O magic set", () => {
	// R10 / QA Q2 cost a release: two hand-kept lists answering one question
	// drifted. The app's `verifyMachO` and the prune's `isMachO` must both read
	// the shared definition, and the way that stops holding is somebody
	// reinlining the hex list into the app.
	const source = readFileSync(
		join(process.cwd(), "src/main/backend/managed-python.ts"),
		"utf8",
	);
	assert.match(source, /BUNDLED_RUNTIME_LAYOUT\.machOMagics/);
	for (const magic of LAYOUT.machOMagics)
		assert.doesNotMatch(
			source,
			new RegExp(magic),
			`${magic} is written inline in managed-python.ts again; it belongs in src/shared/bundled-runtime-layout.json`,
		);
});

test("the Mach-O reader answers a slice SET, for fat files as well as thin", () => {
	// The release gate's native-component check asks whether a component's slices
	// INCLUDE the bundle's own architecture, which no thin-only reader can answer:
	// `machOCpuType` reads one `cputype` word and a fat file's live in `fat_arch`
	// entries, so it returns null there. Both shapes are read here, in the one
	// parser, because two readers would be two decisions about the magic set, the
	// endianness and the field offsets - and a wrong-endian read does not crash, it
	// answers a plausible number for the wrong file.
	const dir = tempDir("lo-macho-");
	const thin = join(dir, "thin");
	writeMachO(thin, { cpuType: MACH_O_CPUTYPE.ARM64 });
	assert.deepEqual(machOArchitectures(thin), [MACH_O_CPUTYPE.ARM64]);

	// FAT_MAGIC: big-endian fields, one `fat_arch` per slice, `cputype` first.
	const fat = join(dir, "fat");
	writeFatMachO(fat, [MACH_O_CPUTYPE.ARM64, MACH_O_CPUTYPE.X86_64]);
	assert.deepEqual(machOArchitectures(fat), [
		MACH_O_CPUTYPE.ARM64,
		MACH_O_CPUTYPE.X86_64,
	]);
	// The split that justifies a second entry point rather than a widened first
	// one: the universal file is a Mach-O (the walk finds it) and has no single
	// cputype (the spawn bound's per-file question has no answer for it).
	assert.equal(machOCpuType(fat), null);

	// FAT_CIGAM: the same header with little-endian fields.
	const swapped = join(dir, "fat-cigam");
	writeFatMachO(swapped, [MACH_O_CPUTYPE.X86_64, MACH_O_CPUTYPE.ARM64], {
		magic: "bebafeca",
	});
	assert.deepEqual(machOArchitectures(swapped), [
		MACH_O_CPUTYPE.X86_64,
		MACH_O_CPUTYPE.ARM64,
	]);

	// A header that stops mid-way, a count of zero, and a count no header could
	// have: all "could not ask", which the gate treats as a failure rather than as
	// a pass, so the reader must not answer a slice list for any of them.
	const cut = join(dir, "cut");
	writeFileSync(cut, Buffer.from("cffaedfe", "hex"));
	assert.equal(machOArchitectures(cut), null);
	const empty = join(dir, "fat-empty");
	writeFatMachO(empty, [], { count: 0 });
	assert.equal(machOArchitectures(empty), null);
	const absurd = join(dir, "fat-absurd");
	writeFatMachO(absurd, [MACH_O_CPUTYPE.ARM64], { count: 4096 });
	assert.equal(machOArchitectures(absurd), null);
	const truncatedFat = join(dir, "fat-truncated");
	writeFatMachO(truncatedFat, [MACH_O_CPUTYPE.ARM64, MACH_O_CPUTYPE.X86_64]);
	writeFileSync(truncatedFat, readFileSync(truncatedFat).subarray(0, 20));
	assert.equal(machOArchitectures(truncatedFat), null);

	// Not a Mach-O at all: no magic, no answer.
	const plain = join(dir, "plain");
	writeFileSync(plain, "# read, never run\n");
	assert.equal(machOArchitectures(plain), null);
});

test("a 64-bit fat component is recognised and read, not skipped", () => {
	// QA Q1 / review m2, and the reason this is a reverted decision rather than a
	// widened one: `cafebabf`/`bfbafeca` were left out of the shared magic set, so a
	// component carrying one was not merely unread - it was outside every Mach-O
	// question this repository asks. `machOFiles` did not return it, so the release
	// gate's sweep neither counted it nor failed it while `docs/BUILD.md` stated the
	// invariant unconditionally. The 64-bit header's ONLY difference is the entry
	// stride (`fat_arch_64` carries 64-bit `offset`/`size`), and `cputype` is still
	// the entry's first word - so the fix is recognition plus the stride, and both
	// directions are asserted here.
	const dir = tempDir("lo-macho64-");
	const fat64 = join(dir, "fat64");
	writeFatMachO(fat64, [MACH_O_CPUTYPE.ARM64, MACH_O_CPUTYPE.X86_64], {
		bits: 64,
	});
	// The walk sees it: this is the half that was missing, and `isMachO` is the
	// predicate `machOFiles` filters on.
	assert.equal(isMachO(fat64), true);
	assert.deepEqual(machOFiles(dir), ["fat64"]);
	assert.deepEqual(machOArchitectures(fat64), [
		MACH_O_CPUTYPE.ARM64,
		MACH_O_CPUTYPE.X86_64,
	]);
	// The byte-swapped 64-bit twin, whose fields are little-endian.
	const swapped = join(dir, "fat64-cigam");
	writeFatMachO(swapped, [MACH_O_CPUTYPE.X86_64, MACH_O_CPUTYPE.ARM64], {
		bits: 64,
		magic: "bfbafeca",
	});
	assert.deepEqual(machOArchitectures(swapped), [
		MACH_O_CPUTYPE.X86_64,
		MACH_O_CPUTYPE.ARM64,
	]);

	// THE STRIDE IS THE ASSERTION'S POINT, AND THIS IS THE CASE THAT PINS IT. A
	// two-entry 64-bit table is 8 + 2*32 = 72 bytes; a two-entry 32-bit table is
	// 8 + 2*20 = 48. So a prefix of 48 bytes is SHORT of the wide table and refuses,
	// while at the narrow stride that same 48 bytes is a COMPLETE table and the read
	// answers a second "architecture" out of the first entry's 64-bit `size` word.
	// Cutting this fixture to 40 bytes - as it was first written - would not
	// discriminate: 40 is short of both strides and answers `null` either way, so
	// the case would pass under a stride-20 reader and pin nothing (round 2, n4).
	const cutLastEntry = join(dir, "fat64-cut");
	writeFatMachO(cutLastEntry, [MACH_O_CPUTYPE.ARM64, MACH_O_CPUTYPE.X86_64], {
		bits: 64,
	});
	writeFileSync(cutLastEntry, readFileSync(cutLastEntry).subarray(0, 48));
	assert.equal(machOArchitectures(cutLastEntry), null);

	// The shared magic set carries all four fat spellings, which is what makes the
	// walk's recognition and the reader's stride agree about what this file is.
	for (const magic of ["cafebabe", "cafebabf", "bebafeca", "bfbafeca"])
		assert.ok(
			LAYOUT.machOMagics.includes(magic),
			`${magic} belongs in the shared magic set: a fat Mach-O the walk cannot see is one no reader is ever asked about`,
		);
});
