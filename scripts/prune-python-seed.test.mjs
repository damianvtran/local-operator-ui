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
import { LAYOUT } from "./bundled-python-layout.mjs";
import {
	PRUNED_SEED_PATHS,
	SEED_STDLIB_MARKER,
	clearIncidentalExecBits,
	machOFiles,
	pruneSeed,
	seedExecBitFiles,
	seedModeViolations,
} from "./prune-python-seed.mjs";
import {
	electronLocaleCheck,
	prunedSeedCheck,
	seedBootstrapCheck,
	seedModeCheck,
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
 * `src/shared/bundled-python-layout.json`), and whether a Mach-O's signature
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

/** The four bytes `verifyMachO` tests, plus padding, with the execute bit set. */
function writeMachO(path) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		Buffer.concat([Buffer.from("cffaedfe", "hex"), Buffer.alloc(60)]),
	);
	chmodSync(path, 0o755);
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
		writeFile(join(dir, "lib/tk8.6/tk.tcl"));
	}
	writeFile(join(dir, SEED_STDLIB_MARKER));
	writeFile(join(dir, "lib/python3.12/venv/__init__.py"));
	writeFile(join(dir, "lib/python3.12/ensurepip/__init__.py"));
	writeFile(
		join(dir, "lib/python3.12/ensurepip/_bundled/pip-25.0.1-py3-none-any.whl"),
	);
	if (!pruned) writeFile(join(dir, "lib/python3.12/cgi.py"), { exec: true });
	writeMachO(join(dir, "bin/python3.12"));
	symlinkSync("python3.12", join(dir, "bin/python3"));
	return dir;
}

/**
 * A packaged app carrying one arm64 seed (already pruned) and the English
 * locale packs only - the shape the gate must pass.
 *
 * Every regression case below mutates a fresh copy of this, so a failing case
 * fails for the one thing it changed.
 */
function makePassingApp(dir) {
	const app = join(dir, "mac-arm64", "Local Operator.app");
	const resources = join(app, "Contents", "Resources");
	const framework = join(
		app,
		"Contents",
		"Frameworks",
		"Electron Framework.framework",
		"Versions",
		"A",
		"Resources",
	);
	makeSeed(join(resources, LAYOUT.seedNamespace, "arm64"), { pruned: true });
	// The three spellings the packer's family rule keeps (see
	// `electronLocaleCheck`): the bare code, a region variant and one of the
	// framework's gendered variants, so this file is pinned against the rule the
	// packer implements rather than against the two names it was estimated to
	// keep.
	for (const name of ["en", "en_US", "en_GB_NEUTER"]) {
		mkdirSync(join(resources, `${name}.lproj`), { recursive: true });
		mkdirSync(join(framework, `${name}.lproj`), { recursive: true });
	}
	writeFileSync(join(framework, "en.lproj", "locale.pak"), "");
	return {
		app,
		resources,
		framework,
		seed: join(resources, LAYOUT.seedNamespace, "arm64"),
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

test("the prune is idempotent, and a symlink is not a mode to own", () => {
	const seed = makeSeed(tempDir("lo-seed-"));
	pruneSeed(seed, { log: () => {} });
	// `bin/python3` is a link into `bin/python3.12`; it must still resolve, and
	// the walk must not have tried to own its mode (macOS has no `lchmod`, and
	// `chmod` on a link follows it).
	assert.equal(statSync(join(seed, "bin/python3")).mode & 0o111, 0o111);
	const second = pruneSeed(seed, { log: () => {} });
	assert.deepEqual(second.removed, []);
	assert.deepEqual(second.cleared, []);
	assert.equal(second.machO, 1);
	assert.deepEqual(machOFiles(seed), ["bin/python3.12"]);
	assert.deepEqual(seedExecBitFiles(seed), ["bin/python3.12"]);
});

test("the gate passes a pruned bundle and names each way it can regress", () => {
	const passing = makePassingApp(tempDir("lo-app-"));
	for (const check of [
		prunedSeedCheck(passing.app),
		seedModeCheck(passing.app),
		seedBootstrapCheck(passing.app),
		electronLocaleCheck(passing.app),
	])
		assert.equal(check.passed, true, `${check.id} must pass: ${check.output}`);
	assert.deepEqual(
		prunedSeedCheck(passing.app).output,
		`${PRUNED_SEED_PATHS.length} pruned path(s) absent`,
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

	// 3. A seed with no Mach-O at all: the subset test on its own is satisfied
	// by a seed whose interpreter is gone, which is why the count is asserted.
	const noMachO = makePassingApp(tempDir("lo-app-"));
	rmSync(join(noMachO.seed, "bin/python3.12"));
	const emptyModeCheck = seedModeCheck(noMachO.app);
	assert.equal(emptyModeCheck.passed, false);
	assert.match(emptyModeCheck.output, /No Mach-O file under the seed/);

	// 4. The venv bootstrap: the half an install cannot recover from.
	const noWheel = makePassingApp(tempDir("lo-app-"));
	rmSync(join(noWheel.seed, "lib/python3.12/ensurepip/_bundled"), {
		recursive: true,
	});
	const bootstrapCheck = seedBootstrapCheck(noWheel.app);
	assert.equal(bootstrapCheck.passed, false);
	assert.match(bootstrapCheck.output, /ensurepip\/_bundled\/pip-\*\.whl/);

	// 5. A locale the strip should have removed, in either directory.
	const strayLocales = makePassingApp(tempDir("lo-app-"));
	mkdirSync(join(strayLocales.framework, "de.lproj"));
	const strayCheck = electronLocaleCheck(strayLocales.app);
	assert.equal(strayCheck.passed, false);
	assert.match(strayCheck.output, /de\.lproj/);

	// 6. Every locale removed: a subset test alone would call this a pass.
	const strippedTooFar = makePassingApp(tempDir("lo-app-"));
	for (const dir of [strippedTooFar.resources, strippedTooFar.framework])
		for (const name of ["en", "en_US", "en_GB_NEUTER"])
			rmSync(join(dir, `${name}.lproj`), { recursive: true });
	const tooFarCheck = electronLocaleCheck(strippedTooFar.app);
	assert.equal(tooFarCheck.passed, false);
	assert.match(tooFarCheck.output, /no \.lproj survived/);

	// 7. A PARTIAL strip: the language directories went and their packs stayed
	// behind. One pack per surviving directory is the invariant, so this fails
	// without a hard-coded count.
	const strayPaks = makePassingApp(tempDir("lo-app-"));
	for (const name of ["en.lproj", "en_US.lproj"])
		writeFileSync(join(strayPaks.resources, name, "locale.pak"), "");
	for (const name of ["en_US", "en_GB_NEUTER"])
		writeFileSync(join(strayPaks.framework, `${name}.lproj`, "locale.pak"), "");
	// Two more where no language directory justifies one at all.
	writeFileSync(join(strayPaks.resources, "locale.pak"), "");
	writeFileSync(join(strayPaks.app, "Contents", "locale.pak"), "");
	// Six surviving directories, seven packs.
	const pakCheck = electronLocaleCheck(strayPaks.app);
	assert.equal(pakCheck.passed, false, pakCheck.output);
	assert.match(
		pakCheck.output,
		/7 locale\.pak for 6 surviving locale directories/,
	);
});

/*
 * The two halves the modules above cannot assert about themselves.
 *
 * Why these cases are here rather than in the modules: the prune and the gate
 * were once both correct while the step that RUNS them was missing from the
 * build, and every test in the sibling file stayed green because they drive the
 * modules rather than the thing that decides whether the modules run. The gap
 * was the config, so the config is what is asserted - the same lesson
 * `prune-python-resource.test.mjs` records for `afterPack`.
 */
test("the seeding script runs the prune, and the builder ships only English", () => {
	const script = readFileSync(
		join(process.cwd(), "scripts/setup-python-resource.sh"),
		"utf8",
	);
	assert.match(
		script,
		/node\s+"\$\(dirname "\$0"\)\/prune-python-seed\.mjs"/,
		"setup-python-resource.sh must run scripts/prune-python-seed.mjs: it is the only place the seed tree is materialised, and a prune nothing calls is a comment",
	);
	const build = JSON.parse(
		readFileSync(join(process.cwd(), "package.json"), "utf8"),
	).build;
	assert.deepEqual(
		build.mac.electronLanguages,
		["en", "en-US"],
		"build.mac.electronLanguages is what prunes the 220 locale packs before signing; app-builder-lib reads it from the mac block, and the gate fails the release without it",
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
	assert.match(source, /BUNDLED_PYTHON_LAYOUT\.machOMagics/);
	for (const magic of LAYOUT.machOMagics)
		assert.doesNotMatch(
			source,
			new RegExp(magic),
			`${magic} is written inline in managed-python.ts again; it belongs in src/shared/bundled-python-layout.json`,
		);
});
