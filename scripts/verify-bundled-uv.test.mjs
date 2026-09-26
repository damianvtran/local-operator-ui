import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	UV_NAMESPACE,
	uvBinaryName,
	uvResourceDir,
} from "./bundled-runtime-layout.mjs";
import {
	checkUnpackedUv,
	findUnpackedDirs,
	unpackedDirArch,
} from "./verify-bundled-uv.mjs";

/*
 * Coverage for the artifact-side check of the bundled uv on Windows and Linux.
 *
 * WHY THIS FILE EXISTS. The check is the only thing that fails a WINDOWS or LINUX
 * release build whose artifact lost its uv: the staging step's own assertions are
 * on the checkout, not on what packaging produced, and a dropped
 * `extraResources` entry or a stager that never ran both end at the same place -
 * a green build and every user's first install quietly back on the slower pip
 * path. The failure is silent in production, so the check that would catch it is
 * driven here against real directory trees rather than a model of them.
 *
 * The CLI case at the end runs the real entry point as a process, because the
 * exit status is the half the build job reads.
 */

const tempDirs = [];

function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

after(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Ignore: the OS reclaims the temp directory.
		}
	}
});

/** One unpacked app directory with the given uv trees staged under it. */
function makeUnpackedApp(
	dir,
	name,
	{ uvTrees = ["x64"], binary = true, platform = "win32" } = {},
) {
	const appDir = join(dir, name);
	const resources = join(appDir, "resources");
	mkdirSync(resources, { recursive: true });
	for (const arch of uvTrees) {
		const tree = join(resources, uvResourceDir(arch));
		mkdirSync(tree, { recursive: true });
		if (binary)
			writeFileSync(join(tree, uvBinaryName(platform)), "MZ fake uv\n");
	}
	return { appDir, resources };
}

test("a Windows app with its own architecture's uv passes and names the path", () => {
	const dir = tempDir("lo-verify-uv-");
	const { appDir } = makeUnpackedApp(dir, "win-unpacked", {
		uvTrees: ["x64"],
	});

	const result = checkUnpackedUv(appDir, {
		platform: "win32",
		expectedArch: "x64",
	});

	assert.match(result, /uv[\\/]x64[\\/]uv\.exe is the x64 uv/);
});

test("a Linux app must carry an executable uv", () => {
	const dir = tempDir("lo-verify-uv-");
	const { appDir, resources } = makeUnpackedApp(dir, "linux-unpacked", {
		uvTrees: ["x64"],
		platform: "linux",
	});
	const binary = join(resources, uvResourceDir("x64"), uvBinaryName("linux"));
	assert.equal(
		existsSync(binary),
		true,
		"the fixture writes the platform's own binary name, not win32's",
	);

	// The ZIP-loses-modes class, one platform over: present, correct, unrunnable.
	chmodSync(binary, 0o644);
	assert.throws(
		() => checkUnpackedUv(appDir, { platform: "linux", expectedArch: "x64" }),
		/carries no execute bit/,
	);

	chmodSync(binary, 0o755);
	assert.match(
		checkUnpackedUv(appDir, { platform: "linux", expectedArch: "x64" }),
		/is the x64 uv/,
	);
});

test("both architecture trees in one artifact fail - the prune never ran", () => {
	// The symptom of a prune that stops running is a larger download nobody
	// measures; the check turns it into a build failure instead.
	const dir = tempDir("lo-verify-uv-");
	const { appDir } = makeUnpackedApp(dir, "win-unpacked", {
		uvTrees: ["x64", "arm64"],
	});

	assert.throws(
		() => checkUnpackedUv(appDir, { platform: "win32", expectedArch: "x64" }),
		/found arm64, x64/,
	);
});

test("the other architecture's uv is refused by name", () => {
	const dir = tempDir("lo-verify-uv-");
	const { appDir } = makeUnpackedApp(dir, "win-arm64-unpacked", {
		uvTrees: ["x64"],
	});

	assert.throws(
		() => checkUnpackedUv(appDir, { platform: "win32", expectedArch: "arm64" }),
		/carries the x64 uv but its own name says arm64/,
	);
});

test("a missing directory, a missing binary and a fake binary all fail", () => {
	const dir = tempDir("lo-verify-uv-");
	const { appDir, resources } = makeUnpackedApp(dir, "win-unpacked", {
		uvTrees: ["x64"],
	});

	// No uv namespace at all: the stager never ran, or the copy list dropped it.
	assert.throws(
		() =>
			checkUnpackedUv(join(dir, "win-other-unpacked"), {
				platform: "win32",
				expectedArch: "x64",
			}),
		/ships no uv, so every install falls back to pip/,
	);

	// A missing binary inside a present tree.
	rmSync(join(resources, uvResourceDir("x64"), uvBinaryName("win32")));
	assert.throws(
		() => checkUnpackedUv(appDir, { platform: "win32", expectedArch: "x64" }),
		/ships no uv\.exe binary/,
	);

	// A symlink is not a file this app can execute out of its own artifact, and
	// neither is an empty file.
	writeFileSync(join(dir, "target.exe"), "MZ\n");
	symlinkSync(
		join(dir, "target.exe"),
		join(resources, uvResourceDir("x64"), uvBinaryName("win32")),
	);
	assert.throws(
		() => checkUnpackedUv(appDir, { platform: "win32", expectedArch: "x64" }),
		/is not a plain file/,
	);
	rmSync(join(resources, uvResourceDir("x64"), uvBinaryName("win32")));
	writeFileSync(
		join(resources, uvResourceDir("x64"), uvBinaryName("win32")),
		"",
	);
	assert.throws(
		() => checkUnpackedUv(appDir, { platform: "win32", expectedArch: "x64" }),
		/is empty/,
	);
});

test("the unpacked directories are found per platform and per name", () => {
	const dir = tempDir("lo-verify-uv-");
	for (const name of [
		"win-unpacked",
		"win-arm64-unpacked",
		"linux-unpacked",
		"mac-arm64",
		"win-unpacked.bak",
	])
		mkdirSync(join(dir, name), { recursive: true });
	writeFileSync(join(dir, "win-unpacked-file"), "not a directory");

	assert.deepEqual(
		findUnpackedDirs(dir, "win32").map((path) => path.split("/").pop()),
		["win-arm64-unpacked", "win-unpacked"],
	);
	assert.deepEqual(
		findUnpackedDirs(dir, "linux").map((path) => path.split("/").pop()),
		["linux-unpacked"],
	);
	// A missing dist directory is an empty list, which the CLI turns into its own
	// refusal rather than a vacuous pass.
	assert.deepEqual(findUnpackedDirs(join(dir, "nope"), "win32"), []);
	assert.throws(
		() => findUnpackedDirs(dir, "darwin"),
		/not one this check knows/,
	);
});

test("the arch a directory name carries is derived, with x64 as the unnamed default", () => {
	assert.equal(unpackedDirArch("win-unpacked"), "x64");
	assert.equal(unpackedDirArch("win-arm64-unpacked"), "arm64");
	assert.equal(unpackedDirArch("linux-unpacked"), "x64");
	assert.equal(unpackedDirArch("win-ia32-unpacked"), "ia32");
});

test("the CLI passes an artifact that has its uv, and fails the others", () => {
	const dir = tempDir("lo-verify-uv-cli-");
	const { appDir } = makeUnpackedApp(dir, "win-arm64-unpacked", {
		uvTrees: ["arm64"],
	});
	const ok = spawnSync(
		process.execPath,
		["scripts/verify-bundled-uv.mjs", "--dist", dir, "--platform", "win32"],
		{ cwd: process.cwd(), encoding: "utf8" },
	);
	assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
	assert.match(ok.stdout, /OK: 1 unpacked app directory carries the uv/);

	// The silent regression this script exists for: a tree with no unpacked app
	// at all must not read as a pass.
	const empty = spawnSync(
		process.execPath,
		[
			"scripts/verify-bundled-uv.mjs",
			"--dist",
			tempDir("lo-verify-uv-none-"),
			"--platform",
			"win32",
		],
		{ cwd: process.cwd(), encoding: "utf8" },
	);
	assert.equal(empty.status, 1);
	assert.match(empty.stderr, /found nothing in/);

	const broken = spawnSync(
		process.execPath,
		["scripts/verify-bundled-uv.mjs", "--dist", dir, "--platform", "linux"],
		{ cwd: process.cwd(), encoding: "utf8" },
	);
	assert.equal(broken.status, 1);
	assert.match(broken.stderr, /no linux-\*-unpacked directory/);
	// And the fixture itself is still there: nothing in this test edits the tree
	// it failed on.
	assert.equal(existsSync(join(appDir, "resources")), true);
	assert.equal(lstatSync(appDir).isDirectory(), true);
});

test("the artifact check reads its names from the one definition", () => {
	// A second spelling of the namespace or the binary name is how a check starts
	// asserting a directory the app does not resolve. The module imports the
	// layout, so what is asserted here is that it did not inline one: no literal
	// "uv/x64" or "uv.exe" string beside the imported names.
	const source = readFileSync(
		join(process.cwd(), "scripts/verify-bundled-uv.mjs"),
		"utf8",
	);
	assert.ok(source.includes('from "./bundled-runtime-layout.mjs"'));
	assert.doesNotMatch(source, /"uv\.exe"/);
	assert.doesNotMatch(source, /"uv\/x64"/);
	assert.equal(UV_NAMESPACE, "uv");
	assert.equal(uvBinaryName("win32"), "uv.exe");
});
