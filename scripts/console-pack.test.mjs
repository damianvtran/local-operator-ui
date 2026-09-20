/**
 * Contract tests for the packaging step, on a fixture tree.
 *
 * WHY A FIXTURE RATHER THAN THE REAL BUILD: `afterPack` runs inside electron-builder,
 * and a step that can only be exercised by packing a whole app is a step nobody
 * exercises — which is how a packaging trap reaches a release. What this file drives
 * is the same functions the hook calls, against a tree shaped like the packed one.
 * The REAL packed tree is asserted by the host proof rig's packaged-tree cell
 * (`scripts/console-host-proof.mjs --packaged`), and the two are not substitutes:
 * this one pins the rules, that one pins what the build produced.
 */

import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, test } from "node:test";
import {
	SPAWN_HELPER_MODE,
	appOutDirFor,
	consoleNativeRoot,
	ensureSpawnHelperMode,
	nativeDirs,
	prebuildDir,
	prepareConsoleNative,
	pruneForeignPrebuilds,
	resourcesDirFor,
} from "./console-pack.mjs";

const scratchDirs = [];
function scratch(prefix = "console-pack-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratchDirs.push(dir);
	return dir;
}

after(() => {
	for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** A tree shaped like the published package: the helper at 0644, three platform
 * prebuild directories, and a `.pdb` file in the batch that gets pruned. */
function fakePackage(
	root,
	{
		helperMode = 0o644,
		plugins = ["darwin-arm64", "darwin-x64", "win32-x64"],
	} = {},
) {
	for (const plugin of plugins) {
		mkdirSync(join(root, "prebuilds", plugin), { recursive: true });
		writeFileSync(
			join(root, "prebuilds", plugin, "pty.node"),
			Buffer.alloc(1024),
		);
		if (plugin.startsWith("win32")) {
			writeFileSync(
				join(root, "prebuilds", plugin, "pty.pdb"),
				Buffer.alloc(4096),
			);
		}
		if (plugin.startsWith("darwin")) {
			writeFileSync(
				join(root, "prebuilds", plugin, "spawn-helper"),
				"#!/bin/sh\n",
			);
			chmodSync(join(root, "prebuilds", plugin, "spawn-helper"), helperMode);
		}
	}
	return root;
}

/** The prebuild directories the published tarball carries, measured from the
 * installed package rather than written from memory: there is no `linux-*` one,
 * which is the whole reason a Linux artifact compiles its helper from source. */
const TARBALL_PREBUILDS = [
	"darwin-arm64",
	"darwin-x64",
	"win32-arm64",
	"win32-x64",
];

/** A tree shaped like a source build: node-pty's own install script compiles one on
 * a platform the tarball ships no prebuild for, and `@electron/rebuild` does the
 * same to a tree being packed for the Electron ABI. The helper arrives executable
 * from gyp/make, and the mode is a parameter because the ZIP-delivered update is
 * the case the heal exists for. */
function sourceBuild(root, { helperMode = 0o755, debug = false } = {}) {
	const dir = join(root, "build", debug ? "Debug" : "Release");
	mkdirSync(dir, { recursive: true });
	// The module whose directory decides where the helper is forked from.
	writeFileSync(join(dir, "pty.node"), Buffer.alloc(1024));
	writeFileSync(join(dir, "spawn-helper"), "#!/bin/sh\n");
	chmodSync(join(dir, "spawn-helper"), helperMode);
	return dir;
}

test("the unpack list moves the native files, and never the whole package", () => {
	// A source-shape test for a trap that is invisible until a packaged app runs: node-pty
	// rewrites `app.asar` to `app.asar.unpacked` inside itself before it looks for
	// `spawn-helper`, and that rewrite is not idempotent. Unpacking the WHOLE package
	// puts `lib/*.js` on disk too, so the require resolves to an `app.asar.unpacked`
	// path, the rewrite appends a second `.unpacked`, and the first spawn dies
	// `posix_spawnp failed.` — measured, and the reason the proof rig's packaged cell
	// forks a real pty instead of only stating modes.
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	const unpack = pkg.build.asarUnpack;
	assert.ok(Array.isArray(unpack) && unpack.length > 0);
	assert.ok(
		unpack.some((entry) => entry.includes("node-pty/prebuilds")),
		"the native files must be unpacked",
	);
	assert.ok(
		!unpack.some((entry) => /node-pty\/\*\*$/.test(entry)),
		"the whole package must NOT be unpacked: it breaks node-pty's own archive rewrite",
	);
});

test("the resources directory follows the platform's packaging shape", () => {
	assert.equal(
		resourcesDirFor({
			appOutDir: "/dist/mac-arm64",
			productFilename: "Local Operator",
			platform: "darwin",
		}),
		"/dist/mac-arm64/Local Operator.app/Contents/Resources",
	);
	assert.equal(
		resourcesDirFor({
			appOutDir: "/dist/linux-unpacked",
			productFilename: "x",
			platform: "linux",
		}),
		"/dist/linux-unpacked/resources",
	);
	assert.equal(
		consoleNativeRoot("/res"),
		join("/res", "app.asar.unpacked", "node_modules", "node-pty"),
	);
});

test("a caller holding only the resources directory recovers the same shapes", () => {
	// The CLI's own entry: it is told where the packed resources are, and the pair
	// (appOutDir, productFilename) it derives has to round-trip through the split
	// above, or a hand run prepares an empty path and reports "nothing to prepare" -
	// which is what the released arithmetic did on Linux, the one platform whose
	// helper this file was failing to find.
	for (const [appOutDir, productFilename, platform] of [
		["/dist/mac-arm64", "Local Operator", "darwin"],
		["/dist/linux-unpacked", "Local Operator", "linux"],
		["/dist/win-unpacked", "Local Operator", "win32"],
	]) {
		const resourcesDir = resourcesDirFor({
			appOutDir,
			productFilename,
			platform,
		});
		const recovered = appOutDirFor({ resourcesDir, platform });
		assert.equal(recovered.appOutDir, appOutDir);
		assert.equal(
			resourcesDirFor({ ...recovered, platform }),
			resourcesDir,
			`the round trip holds for ${platform}`,
		);
	}
});

test("the prune keeps this artifact's prebuilds and reclaims the rest", () => {
	const root = fakePackage(scratch());
	const target = { platform: "darwin", arch: "arm64" };
	const report = pruneForeignPrebuilds(root, target);
	assert.deepEqual(report.kept, ["darwin-arm64"]);
	assert.deepEqual(report.removed.sort(), ["darwin-x64", "win32-x64"]);
	// The number is the point of the step: ~58 MB of win32 prebuilds and `.pdb`
	// files against ~136 KB of darwin-arm64.
	assert.ok(report.bytes >= 4096 + 1024);
	assert.deepEqual(readdirSync(join(root, "prebuilds")), ["darwin-arm64"]);
	// The target directory is KEPT even when it holds nothing, because its absence
	// is a different state to node-pty (its own prebuild check treats a missing
	// directory as "rebuild from source").
	const empty = scratch();
	mkdirSync(join(empty, "prebuilds", "linux-x64"), { recursive: true });
	const linuxReport = pruneForeignPrebuilds(empty, {
		platform: "linux",
		arch: "x64",
	});
	assert.deepEqual(linuxReport.kept, ["linux-x64"]);
	assert.deepEqual(linuxReport.removed, []);
});

test("the exec bit is asserted in the packed tree, and set only when it is missing", () => {
	const root = fakePackage(scratch());
	const target = { platform: "darwin", arch: "arm64" };
	const helper = join(prebuildDir(root, target), "spawn-helper");
	// The published tarball's own mode, which is what fails the first spawn with
	// `posix_spawnp failed.`
	assert.equal(statSync(helper).mode & 0o777, 0o644);
	const healed = ensureSpawnHelperMode(root, target);
	assert.equal(healed.healed, true);
	assert.equal(statSync(helper).mode & 0o777, SPAWN_HELPER_MODE);
	// Idempotent, so a rebuild in place does not report a heal it did not make.
	assert.equal(ensureSpawnHelperMode(root, target).healed, false);
});

test("a linux artifact's helper is found where the compiler put it, not only in prebuilds", () => {
	// THE FAILURE THIS PINS, measured on the publish of v0.29.12: the tarball ships
	// no `prebuilds/linux-x64`, so node-pty's install script compiles the helper into
	// `build/Release`, and a prebuild-only probe threw `The packaged app has no
	// node-pty spawn-helper for linux-x64 at .../prebuilds/linux-x64/spawn-helper`
	// after `@electron/rebuild` had built exactly the file it called missing.
	const root = fakePackage(scratch(), { plugins: TARBALL_PREBUILDS });
	assert.equal(
		existsSync(prebuildDir(root, { platform: "linux", arch: "x64" })),
		false,
	);
	const builtDir = sourceBuild(root, { helperMode: 0o644 });
	const target = { platform: "linux", arch: "x64" };
	const helper = ensureSpawnHelperMode(root, target);
	assert.equal(helper.path, join(builtDir, "spawn-helper"));
	assert.equal(helper.healed, true);
	assert.deepEqual(
		helper.helpers.map((entry) => entry.path),
		[helper.path],
	);
	assert.equal(statSync(helper.path).mode & 0o777, SPAWN_HELPER_MODE);
	// The mode fix is the same one the prebuild case gets, and it is idempotent here
	// too, so a rebuild in place does not report a heal it did not make.
	assert.equal(ensureSpawnHelperMode(root, target).healed, false);
});

test("the helper asserted is the one node-pty's own loader forks", () => {
	// Both directories are present in a tree packed for the Electron ABI (the
	// tarball's prebuild, and the tree `@electron/rebuild` built), and node-pty takes
	// the helper out of whichever one its module loaded from - `build/Release` first,
	// per its loader. So the report leads with that one; the prebuild is healed as
	// well, because a `build/Release/pty.node` the running Electron cannot `dlopen`
	// falls through to it at run time and nothing here can decide that from the
	// filesystem. Both are modelled at 0644 to make the difference visible.
	const root = fakePackage(scratch());
	const builtDir = sourceBuild(root, { helperMode: 0o644 });
	const prebuild = join(
		prebuildDir(root, { platform: "darwin", arch: "arm64" }),
		"spawn-helper",
	);
	assert.equal(statSync(prebuild).mode & 0o777, 0o644);
	const helper = ensureSpawnHelperMode(root, {
		platform: "darwin",
		arch: "arm64",
	});
	assert.equal(helper.path, join(builtDir, "spawn-helper"));
	assert.equal(helper.healed, true);
	assert.deepEqual(
		helper.helpers.map((entry) => relative(root, entry.path)),
		["build/Release/spawn-helper", "prebuilds/darwin-arm64/spawn-helper"],
	);
	assert.equal(statSync(prebuild).mode & 0o777, SPAWN_HELPER_MODE);
	assert.equal(
		statSync(join(builtDir, "spawn-helper")).mode & 0o777,
		SPAWN_HELPER_MODE,
	);
});

test("the search order is node-pty's, read from the package rather than assumed", () => {
	// The premise of the fix is external, so it is pinned to the installed package:
	// `lib/utils.js` names the directories its loader tries, in order, and
	// `lib/unixTerminal.js` forks the helper out of whichever one it loaded from. A
	// node-pty bump that changes either one has to meet this test rather than a stale
	// comment.
	const packageRoot = join("node_modules", "node-pty");
	const utils = join(packageRoot, "lib", "utils.js");
	const unixTerminal = join(packageRoot, "lib", "unixTerminal.js");
	if (!existsSync(utils) || !existsSync(unixTerminal)) {
		return; // A tree without the package cannot be asked what the package does.
	}
	const literal = readFileSync(utils, "utf8").match(
		/var dirs = \[([^\]]+)\]/,
	)?.[1];
	assert.ok(
		literal,
		"node-pty's loader still names its directories in one literal",
	);
	const loaderDirs = literal
		.replace(/process\.platform/g, "linux")
		.replace(/process\.arch/g, "x64")
		.replace(/["']/g, "")
		.replace(/\s*\+\s*/g, "")
		.split(",")
		.map((dir) => dir.trim());
	assert.deepEqual(
		loaderDirs,
		nativeDirs("/root", { platform: "linux", arch: "x64" }).map((dir) =>
			relative("/root", dir),
		),
	);
	assert.match(
		readFileSync(unixTerminal, "utf8"),
		/helperPath = native\.dir \+ '\/spawn-helper'/,
		"the helper is forked from the directory the native module loaded from",
	);
});

test("a build with no helper fails loudly on the platforms that need one", () => {
	const root = fakePackage(scratch(), { plugins: ["darwin-x64"] });
	assert.throws(
		() => ensureSpawnHelperMode(root, { platform: "darwin", arch: "arm64" }),
		/no node-pty spawn-helper/,
	);
	// Linux is the platform the same throw landed on in a real publish, and it is
	// asserted separately because its search list is the one with no prebuild
	// directory to fall back to: a throw here means the source build's helper was not
	// found either, which is still a broken artifact.
	let linuxError;
	try {
		ensureSpawnHelperMode(root, { platform: "linux", arch: "x64" });
	} catch (error) {
		linuxError = error;
	}
	assert.match(linuxError?.message ?? "", /no node-pty spawn-helper/);
	// The message names every directory searched, not just one of them: "the helper is
	// not where this looked" and "the helper is nowhere" are different failures, and
	// the second one is what a build must stop on.
	for (const dir of nativeDirs(root, { platform: "linux", arch: "x64" })) {
		assert.ok(
			linuxError.message.includes(join(dir, "spawn-helper")),
			`the failure names ${dir}`,
		);
	}
	// Windows has no helper — its binaries run by extension — so the absence there is
	// reported rather than fatal.
	const windows = ensureSpawnHelperMode(root, {
		platform: "win32",
		arch: "arm64",
	});
	assert.deepEqual(
		{ path: windows.path, mode: windows.mode, missing: windows.missing },
		{ path: null, mode: null, missing: false },
	);
});

test("a linux pack prepares its console-native tree end to end", () => {
	// The whole hook against the tree a Linux pack produces: the tarball's four
	// foreign prebuild directories, no `prebuilds/linux-x64`, and the helper under
	// `build/Release`. The prune must still reclaim the foreign prebuilds, the helper
	// must be found and healed, and the one report line must name where it came from —
	// a reader checking this line against an artifact cannot tell a source build from a
	// tarball prebuild otherwise.
	const appOutDir = scratch();
	const resources = resourcesDirFor({
		appOutDir,
		productFilename: "Local Operator",
		platform: "linux",
	});
	const root = fakePackage(consoleNativeRoot(resources), {
		plugins: TARBALL_PREBUILDS,
	});
	sourceBuild(root, { helperMode: 0o644 });
	const lines = [];
	const report = prepareConsoleNative({
		appOutDir,
		productFilename: "Local Operator",
		arch: "x64",
		platform: "linux",
		log: (line) => lines.push(line),
	});
	assert.equal(report.found, true);
	assert.deepEqual(report.prune.kept, []);
	assert.deepEqual(report.prune.removed.sort(), [...TARBALL_PREBUILDS].sort());
	assert.equal(report.helper.healed, true);
	assert.equal(lines.length, 1);
	assert.match(lines[0], /kept prebuilds\/\(none\)/);
	assert.match(
		lines[0],
		/spawn-helper build\/Release\/spawn-helper mode 0644 -> 0755/,
	);
});

test("the hook's own entry point prunes, heals and reports", () => {
	const appOutDir = scratch();
	const resources = resourcesDirFor({
		appOutDir,
		productFilename: "Local Operator",
		platform: "darwin",
	});
	const root = fakePackage(consoleNativeRoot(resources), {
		plugins: ["darwin-arm64", "win32-x64"],
	});
	const lines = [];
	const report = prepareConsoleNative({
		appOutDir,
		productFilename: "Local Operator",
		arch: "arm64",
		platform: "darwin",
		log: (line) => lines.push(line),
	});
	assert.equal(report.found, true);
	assert.equal(report.root, root);
	assert.deepEqual(report.prune.kept, ["darwin-arm64"]);
	assert.equal(report.helper.healed, true);
	assert.equal(lines.length, 1);
	assert.match(lines[0], /kept prebuilds\/darwin-arm64/);
	assert.match(lines[0], /0644 -> 0755/);

	// A build with no node-pty at all is reported rather than fatal: the dependency
	// can be absent from a tree (a stripped build), and the record's `console` field
	// is what tells the harness there is no console.
	const bare = prepareConsoleNative({
		appOutDir: scratch(),
		productFilename: "Local Operator",
		arch: "arm64",
		platform: "darwin",
		log: () => {},
	});
	assert.equal(bare.found, false);
	assert.equal(existsSync(bare.root), false);
});
