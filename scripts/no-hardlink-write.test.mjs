import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

/*
 * The shared-inode write guard, and the wiring that arms it for the whole
 * desktop suite.
 *
 * WHY THIS FILE EXISTS. On 2026-09-18 a `pnpm test:desktop` run replaced
 * `/Users/damian/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12`
 * — the interpreter every 3.12 venv on this host hardlinks (23 names then, 27
 * now) — with a 12-byte text file, and every venv on the machine stopped working
 * until it was reinstalled. The suite was killed rather than repeated, so the
 * offending call site was never reduced; what ships instead is a refusal at the
 * moment of the write.
 *
 * WHAT IS WORTH ASSERTING, and why each one is not decoration:
 *
 *   - the guard FIRES on the sentence every test file in this repo actually
 *     writes, `import { writeFileSync } from "node:fs"`. This is the whole risk:
 *     Node snapshots a CJS builtin's named exports at that module's first ESM
 *     import, so a guard that patches a default-imported object reports a clean
 *     run while the clobber happens. The NEGATIVE CONTROL is the other half —
 *     without the guard the same child must clobber the inode — because a
 *     positive result with no failing direction proves only that something threw;
 *   - EVERY surface that can retruncate the file is covered, one case each,
 *     because the ones that were missed are the reason this list is explicit:
 *     `copyFileSync` truncates its DESTINATION (so a guard checking `args[0]`
 *     inspects the stub being copied and lets the write through, which is
 *     literally "a test fakes an interpreter") and `createWriteStream(path,
 *     { flags: "w" })` hides the flag in an options object;
 *   - the namespace operations are NOT refused. `linkSync` increments a link
 *     count and `unlinkSync` decrements one; neither touches the content, so a
 *     refusal there is a false positive that reds legitimate harnesses — which
 *     is how a guard gets switched off;
 *   - the three exemptions hold (a directory is not a hard link; an in-temp link
 *     is the fixture's own ground; a read is not a write);
 *   - and the RUNNER arms it, enumerated over the real `test:desktop` list, so a
 *     new test file cannot arrive unguarded and the `--import` cannot be dropped
 *     without this file going red.
 *
 * The fixtures live under `node_modules/.cache/` rather than the OS temp
 * directory on purpose: the guard exempts `tmpdir()`, so a hard link made there
 * is precisely the case that does NOT fire and would prove nothing. That path is
 * git-ignored, so a run of this file cannot leave the tree dirty — the CI job
 * asserts exactly that.
 */

const REPO = process.cwd();
const GUARD = join(REPO, "scripts", "no-hardlink-write.mjs");
const PRELOAD = join(REPO, "scripts", "no-hardlink-write-preload.mjs");
const RUNNER = join(REPO, "scripts", "run-desktop-tests.mjs");
const SCRATCH = join(REPO, "node_modules", ".cache", "no-hardlink-write-test");
const CHILD_PATH = join(SCRATCH, "child.mjs");
const ORIGINAL = "ORIGINAL SHARED CONTENT";

/** Biome's `useTopLevelRegex`: every pattern this file matches on, named. */
const LINK_COUNT = /link count (\d+), shared inode (\d+)/;
const GUARDING = /no-hardlink-write: guarding \d+ fs entry points/;
const STANDING_DOWN = /STANDING DOWN/;
const TEST_DESKTOP = /^node scripts\/run-desktop-tests\.mjs (.*)$/;
const REPORTS_THE_LINK = /declared inside the temp ground/;
const IMPORT_FLAG = /--import=\$\{GUARD_PRELOAD\.href\}/;
const NAMES_THE_PATH = /refusing writeFileSync on /;
const CHMOD_OK = /chmod=ok/;
const READ_BACK = /read=ORIGINAL/;
const WILL_NOT_REFUSE = /will not be refused/;
const EVASION = /EVASION=refused/;
const EVASION_WROTE = /EVASION=wrote/;
const IN_TEMP_STAGED = /IN_TEMP=STAGED/;
const SHARED_INTACT = /SHARED=ORIGINAL SHARED CONTENT/;
const SIBLING_INTACT = /SIBLING=ORIGINAL SHARED CONTENT/;
const SHARED_STUBBED = /SHARED=STUB VIA TEMP GROUND/;
const WHITESPACE = /\s+/;

/**
 * The surfaces that can retruncate the target, each one exercised through the
 * EXACT import shape a test file uses. Driven from argv so one child covers all
 * of them and a new case cannot accidentally be written against a proxy.
 */
const CHILD = `import { writeFileSync, appendFileSync, chmodSync, truncateSync, copyFileSync, createWriteStream, linkSync, unlinkSync, openSync, closeSync } from "node:fs";
import { promises as fsp } from "node:fs";
const [dir, mode] = process.argv.slice(2);
const target = new URL(\`file://\${dir}/b\`);
const stub = new URL(\`file://\${dir}/stub\`);
const spare = new URL(\`file://\${dir}/spare\`);
const third = new URL(\`file://\${dir}/c\`);
const stream = (options) =>
	new Promise((done, fail) => {
		const out = options === undefined ? createWriteStream(target) : createWriteStream(target, options);
		out.on("error", fail);
		out.end("STUB", done);
	});
const cases = {
	writeFileSync: () => writeFileSync(target, "STUB"),
	appendFileSync: () => appendFileSync(target, "STUB"),
	truncateSync: () => truncateSync(target, 0),
	chmodSync: () => chmodSync(target, 0o600),
	promisesWriteFile: () => fsp.writeFile(target, "STUB"),
	promisesCopyFile: async () => {
		writeFileSync(stub, "STUB");
		await fsp.copyFile(stub, target);
	},
	copyFileSync: () => {
		writeFileSync(stub, "STUB");
		copyFileSync(stub, target);
	},
	createWriteStreamDefault: () => stream(),
	createWriteStreamFlags: () => stream({ flags: "w" }),
	openSyncWrite: () => closeSync(openSync(target, "w")),
	linkSync: () => linkSync(target, spare),
	unlinkSync: () => unlinkSync(third),
};
try {
	await cases[mode]();
	console.log(\`\${mode}=wrote\`);
} catch (error) {
	console.log(\`\${mode}=refused:\${error.name}:\${error.message}\`);
	if (!/SharedInodeWriteError/.test(error.name)) console.log("other:" + error.message);
}
`;

/** Every case that can modify the content or the metadata of the target. */
const MUST_REFUSE = [
	"writeFileSync",
	"appendFileSync",
	"truncateSync",
	"chmodSync",
	"promisesWriteFile",
	"copyFileSync",
	"promisesCopyFile",
	"createWriteStreamDefault",
	"createWriteStreamFlags",
	"openSyncWrite",
];

/** Every case that cannot: they move NAMES, never content. */
const MUST_ALLOW = ["linkSync", "unlinkSync"];

function scratch(name) {
	const dir = join(SCRATCH, `${name}-${process.pid}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * A real hard-linked trio OUTSIDE the temp ground, in its own directory.
 *
 * `b` and `c` are names of one inode, and `c` exists so the unlink case has
 * something to remove. The content is written ONCE, to a name that has not been
 * linked yet.
 */
function fixture(name) {
	const dir = scratch(name);
	writeFileSync(join(dir, "base"), ORIGINAL);
	linkSync(join(dir, "base"), join(dir, "a"));
	linkSync(join(dir, "a"), join(dir, "b"));
	linkSync(join(dir, "b"), join(dir, "c"));
	return dir;
}

/**
 * Put the fixture back to `ORIGINAL` without EVER writing through a link.
 *
 * This function is the reason the suite passes under the runner and not merely
 * under `node --test`, and getting it wrong is how the first revision of this
 * file reddened CI: the guard is armed by `run-desktop-tests.mjs` for every file
 * it runs, so a plain `writeFileSync(join(dir, "a"), ORIGINAL)` in a fixture is
 * itself refused — the test was performing the very write it exists to forbid.
 * A single-link target is not the hazard; writing through a linked one is.
 */
function reset(dir) {
	/*
	 * EVERY name goes, `base` included: leaving even one behind leaves `base`
	 * with nlink 2, and the write below then becomes a write through a link —
	 * refused by the guard this file tests, which is how the fixture's own leak
	 * surfaced instead of passing quietly.
	 */
	for (const name of ["base", "a", "b", "c", "spare"]) {
		rmSync(join(dir, name), { force: true });
	}
	writeFileSync(join(dir, "base"), ORIGINAL);
	assert.equal(
		statSync(join(dir, "base")).nlink,
		1,
		"the reset must write to a name nothing else reaches",
	);
	linkSync(join(dir, "base"), join(dir, "a"));
	linkSync(join(dir, "a"), join(dir, "b"));
	linkSync(join(dir, "b"), join(dir, "c"));
}

function run(dir, mode, { guard }) {
	const args = guard
		? [`--import=${PRELOAD}`, CHILD_PATH, dir, mode]
		: [CHILD_PATH, dir, mode];
	return spawnSync(process.execPath, args, { encoding: "utf8" });
}

/** Run one case against a freshly linked trio and report what the inode holds. */
function caseOnce(mode, { guard, dir }) {
	reset(dir);
	const result = run(dir, mode, { guard });
	return {
		result,
		output: result.stdout.trim().split("\n")[0],
		bytes: readFileSync(join(dir, "base"), "utf8"),
	};
}

/**
 * The callback, stream, open and rename surfaces, driven from one child so each
 * case is exercised through the import shape a test file uses.
 *
 * These exist because every one of them was a measured hole: the CALLBACK api was
 * unwrapped entirely, `createWriteStream(path, "utf8")` was misread as "not a
 * write" because a string second argument is the ENCODING there and not flags,
 * `open(p)` with no flag defaulted to "w" and refused a legitimate read, and
 * `rename` was refused on the wrong side of the namespace/content asymmetry.
 */
const SURFACES_CHILD = `import fs from "node:fs";
import { promises as fsp } from "node:fs";
const [dir, mode] = process.argv.slice(2);
const b = dir + "/b", stub = dir + "/stub", moved = dir + "/moved";
const cases = {
	callbackWriteFile: () => new Promise((res, rej) => fs.writeFile(b, "STUB", (e) => (e ? rej(e) : res()))),
	callbackAppendFile: () => new Promise((res, rej) => fs.appendFile(b, "STUB", (e) => (e ? rej(e) : res()))),
	callbackTruncate: () => new Promise((res, rej) => fs.truncate(b, 0, (e) => (e ? rej(e) : res()))),
	callbackChmod: () => new Promise((res, rej) => fs.chmod(b, 0o600, (e) => (e ? rej(e) : res()))),
	callbackCopyFile: () => {
		fs.writeFileSync(stub, "STUB");
		return new Promise((res, rej) => fs.copyFile(stub, b, (e) => (e ? rej(e) : res())));
	},
	callbackOpenWrite: () => new Promise((res, rej) => fs.open(b, "w", (e, fd) => (e ? rej(e) : fs.close(fd, () => res())))),
	streamEncoding: () => new Promise((res, rej) => {
		const out = fs.createWriteStream(b, "utf8");
		out.on("error", rej);
		out.end("STUB", res);
	}),
	openNoFlag: () => fs.closeSync(fs.openSync(b)),
	promisesOpenNoFlag: async () => (await fsp.open(b)).close(),
	openReadFlag: () => fs.closeSync(fs.openSync(b, "r")),
	renameOnto: () => { fs.writeFileSync(stub, "STUB"); fs.renameSync(stub, b); },
	renameAway: () => fs.renameSync(b, moved),
};
try { await cases[mode](); console.log(mode + "=allowed"); }
catch (error) { console.log(mode + "=refused:" + error.name); }
`;

/** Surfaces that can retruncate the file, reached through the callback form. */
const CALLBACK_MUST_REFUSE = [
	"callbackWriteFile",
	"callbackAppendFile",
	"callbackTruncate",
	"callbackChmod",
	"callbackCopyFile",
	"callbackOpenWrite",
	"streamEncoding",
];

/** Reached the same way, but they must NOT be refused. */
const CALLBACK_MUST_ALLOW = [
	"openNoFlag",
	"promisesOpenNoFlag",
	"openReadFlag",
	"renameOnto",
	"renameAway",
];

/** The same in-temp body, as a file the runner will collect. */
const RUNNER_DRIVER = `import { test } from "node:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("in-temp link write", () => {
	const ground = fs.mkdtempSync(join(tmpdir(), "lo-runner-exempt-"));
	fs.writeFileSync(join(ground, "binary"), "BINARY");
	fs.linkSync(join(ground, "binary"), join(ground, "Local Operator"));
	fs.writeFileSync(join(ground, "Local Operator"), "STAGED");
});
`;

const IN_TEMP_CHILD = `import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Both names inside the ground: the fixture declares the inode by building its
// own tree, which is what grants the exemption.
const ground = fs.mkdtempSync(join(tmpdir(), "lo-in-temp-"));
fs.writeFileSync(join(ground, "binary"), "BINARY");
fs.linkSync(join(ground, "binary"), join(ground, "Local Operator"));
// Staging writes THROUGH the link, which is the whole point of the cheap copy.
fs.writeFileSync(join(ground, "Local Operator"), "STAGED");
console.log("IN_TEMP=" + fs.readFileSync(join(ground, "binary"), "utf8"));
`;

const EVASION_CHILD = `import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [shared, sibling] = process.argv.slice(2);
const ground = fs.mkdtempSync(join(tmpdir(), "lo-evasion-"));
try {
	// Sanctioned call one: give the shared inode a name inside the temp ground.
	fs.linkSync(shared, join(ground, "linked"));
	// Sanctioned call two: write to it there.
	fs.writeFileSync(join(ground, "linked"), "STUB VIA TEMP GROUND");
	console.log("EVASION=wrote");
} catch (error) {
	console.log("EVASION=refused:" + error.name);
}
console.log("SHARED=" + fs.readFileSync(shared, "utf8"));
console.log("SIBLING=" + fs.readFileSync(sibling, "utf8"));
`;

const SURFACES_PATH = join(SCRATCH, "surfaces.mjs");
const IN_TEMP_PATH = join(SCRATCH, "in-temp.mjs");
const EVASION_PATH = join(SCRATCH, "evasion.mjs");

test.before(() => {
	rmSync(SCRATCH, { recursive: true, force: true });
	mkdirSync(SCRATCH, { recursive: true });
	writeFileSync(CHILD_PATH, CHILD);
	writeFileSync(SURFACES_PATH, SURFACES_CHILD);
	writeFileSync(EVASION_PATH, EVASION_CHILD);
	writeFileSync(IN_TEMP_PATH, IN_TEMP_CHILD);
});

test.after(() => {
	rmSync(SCRATCH, { recursive: true, force: true });
});

test("without the guard the child clobbers the shared inode (negative control)", () => {
	const dir = fixture("negative");
	assert.equal(statSync(join(dir, "base")).nlink, 4);
	const { output, bytes } = caseOnce("writeFileSync", { guard: false, dir });
	assert.equal(output, "writeFileSync=wrote");
	assert.equal(
		bytes,
		"STUB",
		"the unguarded write must reach the sibling names — this is the incident",
	);
});

test("with the guard every content-changing surface is refused", () => {
	const dir = fixture("positive");
	for (const mode of MUST_REFUSE) {
		const { result, output, bytes } = caseOnce(mode, { guard: true, dir });
		assert.ok(
			output.startsWith(`${mode}=refused:SharedInodeWriteError:`),
			`${mode} must be refused by the guard; got:\n${result.stdout}${result.stderr}`,
		);
		assert.equal(bytes, ORIGINAL, `${mode} must leave the inode untouched`);
	}
});

test("the guard reports what it armed, and names the path, count and inode", () => {
	const dir = fixture("message");
	const { result, output } = caseOnce("writeFileSync", { guard: true, dir });
	assert.match(
		result.stderr,
		GUARDING,
		"the preload must report what it armed",
	);
	const written = output.match(LINK_COUNT);
	assert.ok(written, `the message must carry both numbers; got:\n${output}`);
	assert.equal(Number(written[1]), 4);
	assert.equal(
		Number(written[2]),
		statSync(join(dir, "base")).ino,
		"the inode in the message must be the one the names share",
	);
	assert.match(output, NAMES_THE_PATH);
});

test("the namespace operations are allowed, because they move names not content", () => {
	const dir = fixture("namespace");
	for (const mode of MUST_ALLOW) {
		const { result, output, bytes } = caseOnce(mode, { guard: true, dir });
		assert.ok(
			output.startsWith(`${mode}=wrote`),
			`${mode} must not be refused; got:\n${result.stdout}${result.stderr}`,
		);
		assert.equal(bytes, ORIGINAL, `${mode} must leave the content alone`);
		assert.equal(result.status, 0, result.stderr);
	}
	// `linkSync` truly increments the count, and `unlinkSync` truly decrements it
	// without taking the content with it — the two facts that make them safe.
	const linked = fixture("namespace-count");
	run(linked, "linkSync", { guard: true });
	assert.equal(statSync(join(linked, "base")).nlink, 5);
	const unlinked = fixture("namespace-unlink");
	run(unlinked, "unlinkSync", { guard: true });
	assert.equal(statSync(join(unlinked, "base")).nlink, 3);
	assert.equal(readFileSync(join(unlinked, "base"), "utf8"), ORIGINAL);
});

test("a directory is not a hard link, so chmod is allowed", () => {
	const dir = scratch("directory");
	const parent = join(dir, "parent");
	mkdirSync(join(parent, "child"), { recursive: true });
	assert.ok(
		statSync(parent).nlink > 1,
		"fixture precondition: a directory with a subdirectory has nlink > 1",
	);
	const probe = join(dir, "chmod-probe.mjs");
	writeFileSync(
		probe,
		'import { chmodSync } from "node:fs";\nchmodSync(process.argv[2], 0o755);\nconsole.log("chmod=ok");\n',
	);
	const result = spawnSync(
		process.execPath,
		[`--import=${PRELOAD}`, probe, parent],
		{
			encoding: "utf8",
		},
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, CHMOD_OK);
});

test("a link the fixture builds inside the temp ground is exempt, and reported", () => {
	/*
	 * The legitimate case the exemption exists for, and it is granted by THIS
	 * process's own `linkSync`: both names are inside the ground, so the inode is
	 * declared and the write through the link is allowed. It must also be REPORTED,
	 * because an exemption nobody can see is the false green this repo rejects.
	 */
	const result = spawnSync(
		process.execPath,
		[`--import=${PRELOAD}`, IN_TEMP_PATH],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, IN_TEMP_STAGED);
	assert.match(
		result.stdout + result.stderr,
		REPORTS_THE_LINK,
		"the exemption must be REPORTED, never silently excused",
	);
});

test("a read-only open of a linked file is not a write", () => {
	const dir = fixture("readonly");
	const probe = join(dir, "read-probe.mjs");
	writeFileSync(
		probe,
		'import { openSync, readFileSync, closeSync } from "node:fs";\nconst fd = openSync(process.argv[2], "r");\nconsole.log("read=" + readFileSync(fd, "utf8").slice(0, 8));\ncloseSync(fd);\n',
	);
	const result = spawnSync(
		process.execPath,
		[`--import=${PRELOAD}`, probe, join(dir, "b")],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, READ_BACK);
	assert.equal(readFileSync(join(dir, "base"), "utf8"), ORIGINAL);
});

test("installing twice does not wrap the wrapper", async () => {
	const { installHardlinkWriteGuard } = await import("./no-hardlink-write.mjs");
	assert.ok(Array.isArray(installHardlinkWriteGuard()));
	assert.deepEqual(
		installHardlinkWriteGuard(),
		[],
		"a second install must wrap nothing, or a refusal arrives as a stack of identical errors",
	);
});

test("the decision is available without a patch, and every surface has a row", async () => {
	const { classifyCall, sharedInodeWrite, flagsAllowWrite } = await import(
		"./no-hardlink-write.mjs"
	);
	const dir = fixture("decision");
	const linked = join(dir, "b");
	assert.equal(sharedInodeWrite("writeFileSync", linked).nlink, 4);
	assert.equal(
		sharedInodeWrite("writeFileSync", join(dir, "absent")),
		null,
		"a path that does not exist cannot damage an inode",
	);
	assert.equal(classifyCall("openSync", [linked, "r"]).mayClobber, false);
	assert.ok(classifyCall("openSync", [linked, "w"]).hit);
	assert.ok(classifyCall("createWriteStream", [linked, { flags: "w" }]).hit);
	assert.ok(
		classifyCall("copyFileSync", [join(dir, "stub"), linked]).hit,
		"the DESTINATION of a copy is what gets truncated",
	);
	assert.equal(
		classifyCall("linkSync", [linked, join(dir, "d")]).mayClobber,
		false,
		"creating a name writes nothing",
	);
	assert.ok(flagsAllowWrite("a"));
	assert.ok(flagsAllowWrite("r+"));
	assert.ok(!flagsAllowWrite("r"));
});

test("the desktop runner arms the guard for every file in the test:desktop list", () => {
	const scripts = JSON.parse(
		readFileSync(join(REPO, "package.json"), "utf8"),
	).scripts;
	const command = scripts["test:desktop"];
	const match = command.match(TEST_DESKTOP);
	assert.ok(match, `test:desktop must go through the runner; got ${command}`);
	assert.match(
		readFileSync(RUNNER, "utf8"),
		IMPORT_FLAG,
		"the runner must pass --import to the child; dropping it disarms every file below",
	);

	/*
	 * EVERY file the list runs is enumerated here rather than a sample, and the
	 * runner spawns ONE child for the whole list (a single `spawn` call whose argv
	 * carries every file), so that one `--import` covers all of them. A new test
	 * file therefore cannot arrive unguarded: it joins this list, and this list is
	 * what the runner arms.
	 */
	const files = match[1].trim().split(WHITESPACE);
	assert.ok(
		files.length > 200,
		`expected the whole desktop list, got ${files.length}`,
	);
	for (const file of files) {
		assert.ok(
			existsSync(join(REPO, file)),
			`${file} is in test:desktop but missing`,
		);
	}
	assert.ok(
		!files.includes(relative(REPO, GUARD)),
		"the guard is a module, not a suite: it must not be listed as a test file",
	);
});

test("the preload reports its own stand-down, so an unguarded run is not silent", () => {
	const result = spawnSync(
		process.execPath,
		[`--import=${PRELOAD}`, "-e", "console.log('body')"],
		{
			encoding: "utf8",
			env: { ...process.env, LOCAL_OPERATOR_UI_NO_HARDLINK_GUARD: "1" },
		},
	);
	assert.match(result.stderr, STANDING_DOWN);
	assert.match(result.stderr, WILL_NOT_REFUSE);
	assert.doesNotMatch(result.stderr, GUARDING);
});

test("a name given to a shared inode inside the temp ground does not launder it", () => {
	/*
	 * THE EVASION, and the reason the exemption is keyed on an inode this process
	 * declared rather than on the path being written. Two sanctioned calls used to
	 * defeat the guard: link the shared file into the ground, then write to it
	 * there. The write's path is inside the ground, so the path-keyed form
	 * exempted it and the shared inode was clobbered.
	 */
	const dir = fixture("evasion");
	const shared = join(dir, "base");
	const sibling = join(dir, "b");
	for (const guard of [false, true]) {
		reset(dir);
		const args = guard
			? [`--import=${PRELOAD}`, EVASION_PATH, shared, sibling]
			: [EVASION_PATH, shared, sibling];
		const result = spawnSync(process.execPath, args, { encoding: "utf8" });
		if (guard) {
			assert.match(
				result.stdout,
				EVASION,
				`the evasion must be refused; got:\n${result.stdout}`,
			);
			assert.match(result.stdout, SHARED_INTACT);
			assert.match(result.stdout, SIBLING_INTACT);
		} else {
			assert.match(
				result.stdout,
				EVASION_WROTE,
				"the unguarded control must actually clobber, or this proves nothing",
			);
			assert.match(result.stdout, SHARED_STUBBED);
		}
	}
});

test("the callback, stream, open and rename surfaces each behave as declared", () => {
	const dir = fixture("surfaces");
	for (const mode of CALLBACK_MUST_REFUSE) {
		reset(dir);
		const result = spawnSync(
			process.execPath,
			[`--import=${PRELOAD}`, SURFACES_PATH, dir, mode],
			{ encoding: "utf8" },
		);
		assert.ok(
			result.stdout.startsWith(`${mode}=refused:SharedInodeWriteError`),
			`${mode} must be refused; got:\n${result.stdout}${result.stderr}`,
		);
		assert.equal(
			readFileSync(join(dir, "base"), "utf8"),
			ORIGINAL,
			`${mode} must leave the inode untouched`,
		);
	}
	for (const mode of CALLBACK_MUST_ALLOW) {
		reset(dir);
		const result = spawnSync(
			process.execPath,
			[`--import=${PRELOAD}`, SURFACES_PATH, dir, mode],
			{ encoding: "utf8" },
		);
		assert.ok(
			result.stdout.startsWith(`${mode}=allowed`),
			`${mode} must not be refused; got:\n${result.stdout}${result.stderr}`,
		);
		assert.equal(result.status, 0, result.stderr);
	}
});

test("the audit ledger is real, and records both refusals and exemptions", () => {
	/*
	 * The module's docstring promises this trail. It was once only a promise —
	 * `grep NLINK_GUARD_HITS` found the sentence and nothing else — which is the
	 * false green this guard exists to prevent, so the promise is pinned here.
	 */
	const dir = fixture("ledger");
	reset(dir);
	const ledger = join(SCRATCH, `ledger-${process.pid}.jsonl`);
	rmSync(ledger, { force: true });
	const result = spawnSync(
		process.execPath,
		[`--import=${PRELOAD}`, CHILD_PATH, dir, "writeFileSync"],
		{ encoding: "utf8", env: { ...process.env, NLINK_GUARD_HITS: ledger } },
	);
	assert.ok(
		result.stdout.startsWith("writeFileSync=refused:SharedInodeWriteError"),
		`the refusal must reach the ledger; got:\n${result.stdout}`,
	);
	const lines = readFileSync(ledger, "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l));
	assert.equal(lines.length, 1);
	assert.equal(lines[0].op, "writeFileSync");
	assert.equal(lines[0].nlink, 4);
	assert.equal(lines[0].ino, statSync(join(dir, "base")).ino);
	assert.equal(lines[0].mayClobber, true);
	assert.equal(lines[0].exemptInTempGround, false);

	// An exemption is the case a reader most needs to see, so it is recorded too.
	rmSync(ledger, { force: true });
	const exempt = spawnSync(
		process.execPath,
		[`--import=${PRELOAD}`, IN_TEMP_PATH],
		{ encoding: "utf8", env: { ...process.env, NLINK_GUARD_HITS: ledger } },
	);
	assert.equal(exempt.status, 0, exempt.stdout + exempt.stderr);
	const exemptLines = readFileSync(ledger, "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l));
	assert.equal(exemptLines.length, 1);
	assert.equal(exemptLines[0].exemptInTempGround, true);
});

test("the exemption is reported on BOTH invocation paths, not merely granted", () => {
	/*
	 * "Reported, never silently excused" is the property that makes the exemption
	 * auditable, and it is asserted on both paths because they route differently
	 * and only one of them is how CI runs:
	 *
	 *   - directly, the preload's line reaches stderr (stdout 0 / stderr 1);
	 *   - through the runner, `--test` folds the child's stderr into its TAP report
	 *     on STDOUT, so the line arrives there (stdout 1 / stderr 0).
	 *
	 * Asserting only one path is how a silent exemption hides: a probe run through
	 * the runner while the driver sits under `node_modules/` prints no line at all,
	 * because `node --test` refuses to run a file there and says `Could not find` —
	 * so the driver is written into the repo-visible scratch and run BOTH ways.
	 */
	const direct = spawnSync(
		process.execPath,
		[`--import=${PRELOAD}`, IN_TEMP_PATH],
		{ encoding: "utf8" },
	);
	assert.equal(direct.status, 0, direct.stdout + direct.stderr);
	assert.match(
		direct.stderr,
		REPORTS_THE_LINK,
		"direct: the line belongs on stderr",
	);
	assert.equal(
		direct.stdout.includes("declared inside the temp ground"),
		false,
		"direct: it must not be on stdout",
	);

	/*
	 * A driver the runner will actually run: outside node_modules and named
	 * `*.test.mjs`, so `node --test` collects it rather than answering
	 * `Could not find` — which is the whole reason a probe under node_modules
	 * appears to show "no exemption line".
	 */
	const runnerDriver = join(
		REPO,
		"scripts",
		"no-hardlink-write-exemption-fixture.test.mjs",
	);
	writeFileSync(runnerDriver, RUNNER_DRIVER);
	try {
		const viaRunner = spawnSync(
			process.execPath,
			[RUNNER, "--test-concurrency=1", runnerDriver],
			{ encoding: "utf8" },
		);
		assert.match(
			viaRunner.stdout + viaRunner.stderr,
			REPORTS_THE_LINK,
			`runner: the exemption must still be reported; got stdout=${JSON.stringify(viaRunner.stdout.slice(-300))} stderr=${JSON.stringify(viaRunner.stderr.slice(-300))}`,
		);
	} finally {
		rmSync(runnerDriver, { force: true });
	}
});
