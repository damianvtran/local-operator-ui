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
const REPORTS_THE_LINK = /allowed inside the temp ground/;
const IMPORT_FLAG = /--import=\$\{GUARD_PRELOAD\.href\}/;
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
 * A real hard-linked pair OUTSIDE the temp ground, in a fresh directory, with the
 * child's driver file. `c` is pre-linked for the unlink case.
 */
function fixture(name) {
	const dir = scratch(name);
	writeFileSync(join(dir, "a"), ORIGINAL);
	linkSync(join(dir, "a"), join(dir, "b"));
	linkSync(join(dir, "b"), join(dir, "c"));
	return dir;
}

function run(dir, mode, { guard }) {
	const args = guard
		? [`--import=${PRELOAD}`, CHILD_PATH, dir, mode]
		: [CHILD_PATH, dir, mode];
	return spawnSync(process.execPath, args, { encoding: "utf8" });
}

/** Run one case against a freshly linked pair and report what the inode holds. */
function caseOnce(mode, { guard, dir }) {
	writeFileSync(join(dir, "a"), ORIGINAL);
	const result = run(dir, mode, { guard });
	return {
		result,
		output: result.stdout.trim().split("\n")[0],
		bytes: readFileSync(join(dir, "a"), "utf8"),
	};
}

test.before(() => {
	rmSync(SCRATCH, { recursive: true, force: true });
	mkdirSync(SCRATCH, { recursive: true });
	writeFileSync(CHILD_PATH, CHILD);
});

test.after(() => {
	rmSync(SCRATCH, { recursive: true, force: true });
});

test("without the guard the child clobbers the shared inode (negative control)", () => {
	const dir = fixture("negative");
	assert.equal(statSync(join(dir, "a")).nlink, 3);
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
	assert.equal(Number(written[1]), 3);
	assert.equal(
		Number(written[2]),
		statSync(join(dir, "a")).ino,
		"the inode in the message must be the one the names share",
	);
	assert.match(output, /refusing writeFileSync on /);
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
	assert.equal(statSync(join(linked, "a")).nlink, 4);
	const unlinked = fixture("namespace-unlink");
	run(unlinked, "unlinkSync", { guard: true });
	assert.equal(statSync(join(unlinked, "a")).nlink, 2);
	assert.equal(readFileSync(join(unlinked, "a"), "utf8"), ORIGINAL);
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
	assert.match(result.stdout, /chmod=ok/);
});

test("an in-temp hard link is the fixture's own ground, reported not refused", () => {
	const dir = mkdtempSync(join(tmpdir(), "lo-hardlink-guard-"));
	writeFileSync(join(dir, "a"), ORIGINAL);
	linkSync(join(dir, "a"), join(dir, "b"));
	const result = run(dir, "writeFileSync", { guard: true });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(
		result.stdout.trim().split("\n")[0],
		"writeFileSync=wrote",
		"the product hardlinks an interpreter inside its own temp ground on purpose",
	);
	assert.match(
		result.stderr,
		REPORTS_THE_LINK,
		"the exemption must be REPORTED, never silently excused",
	);
	rmSync(dir, { recursive: true, force: true });
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
	assert.match(result.stdout, /read=ORIGINAL/);
	assert.equal(readFileSync(join(dir, "a"), "utf8"), ORIGINAL);
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
	assert.equal(sharedInodeWrite("writeFileSync", linked).nlink, 3);
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
	assert.match(result.stderr, /will not be refused/);
	assert.doesNotMatch(result.stderr, GUARDING);
});
