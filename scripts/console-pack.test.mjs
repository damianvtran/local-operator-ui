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

/** A tree shaped like the published package: `pty.node` in each prebuild directory,
 * a `spawn-helper` beside the darwin ones at 0644, and a `.pdb` file in the batch
 * that gets pruned. */
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
 * installed package rather than written from memory: `darwin-*` and `win32-*`,
 * and no `linux-*` one - node-pty ships no Linux prebuild, so a Linux artifact
 * compiles from source with the same `binding.gyp`, whose `spawn-helper` target is
 * declared inside `['OS=="mac"', {...}]` alone. */
const TARBALL_PREBUILDS = [
	"darwin-arm64",
	"darwin-x64",
	"win32-arm64",
	"win32-x64",
];

/**
 * A tree shaped like a build node-pty's own gyp rules produce on one platform.
 *
 * `helper` is the whole platform question: gyp builds `spawn-helper` only for macOS,
 * so a source build on Linux (`node scripts/prebuild.js || node-gyp rebuild`) leaves
 * `pty.node` in `build/Release` with nothing beside it, while a macOS tree rebuilt by
 * `@electron/rebuild` leaves both. The helper arrives executable from gyp/make, and its
 * mode is a parameter because the ZIP-delivered update is the case the heal exists for.
 */
function sourceBuild(
	root,
	{ helperMode = 0o755, helper = true, debug = false } = {},
) {
	const dir = join(root, "build", debug ? "Debug" : "Release");
	mkdirSync(dir, { recursive: true });
	// The module whose directory decides where the helper is forked from.
	writeFileSync(join(dir, "pty.node"), Buffer.alloc(1024));
	if (!helper) return dir;
	writeFileSync(join(dir, "spawn-helper"), "#!/bin/sh\n");
	chmodSync(join(dir, "spawn-helper"), helperMode);
	return dir;
}

/** The unpacked-package root inside a scratch app output directory, so a fixture can be
 * handed to the hook the way `afterPack` hands it its own tree. */
function packedRoot(appOutDir, platform = "darwin") {
	return consoleNativeRoot(
		resourcesDirFor({ appOutDir, productFilename: "Local Operator", platform }),
	);
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
		unpack.some((entry) => entry.includes("node-pty/build/Release")),
		"the directory a source build puts its output in must be unpacked too: it is where the loader looks first, and where the helper of a Linux artifact comes from if the platform ever wants one",
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

test("a linux artifact needs no helper, and the guard says so instead of demanding one", () => {
	// THE FAILURE THIS PINS, measured on the publish of v0.29.12: node-pty's
	// `binding.gyp` declares the `spawn-helper` target inside `['OS=="mac"', {...}]`
	// and nowhere else - gyp evaluated with `-DOS=linux` generates `pty.target.mk`
	// alone, with `-DOS=mac` it also generates `spawn-helper.target.mk` - and
	// `src/unix/pty.cc` execs it only under `#if defined(__APPLE__)`, taking
	// `forkpty(3)` everywhere else. A Linux build therefore produces
	// `build/Release/pty.node` and NO helper, and the guard that demanded one threw
	// after `@electron/rebuild` had finished cleanly, so no Linux artifact shipped.
	const root = fakePackage(scratch(), { plugins: TARBALL_PREBUILDS });
	assert.equal(
		existsSync(prebuildDir(root, { platform: "linux", arch: "x64" })),
		false,
	);
	const builtDir = sourceBuild(root, { helper: false });
	const helper = ensureSpawnHelperMode(root, {
		platform: "linux",
		arch: "x64",
	});
	assert.equal(helper.required, false);
	assert.equal(helper.path, null);
	assert.equal(helper.mode, null);
	assert.equal(helper.healed, false);
	assert.deepEqual(helper.helpers, []);
	assert.match(helper.reason, /forks none/);
	// The module is there with nothing beside it: the real Linux shape, reported
	// rather than "fixed" by healing a file this platform never forks.
	assert.equal(existsSync(join(builtDir, "pty.node")), true);
	assert.equal(helper.moduleDirWithoutHelper, null);
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

test("a platform that forks a helper and has none still fails loudly", () => {
	// A foreign prebuild directory does not satisfy this target: `prebuilds/darwin-x64`
	// holds a helper for another architecture, and it is not in the list the loader for
	// arm64 searches. This is the throw that caught the defect before a user did, and it
	// stays fatal on exactly the platforms whose pty forks one.
	const root = fakePackage(scratch(), { plugins: ["darwin-x64"] });
	let error;
	try {
		ensureSpawnHelperMode(root, { platform: "darwin", arch: "arm64" });
	} catch (thrown) {
		error = thrown;
	}
	assert.match(error?.message ?? "", /no node-pty spawn-helper/);
	for (const dir of nativeDirs(root, { platform: "darwin", arch: "arm64" })) {
		assert.ok(
			error.message.includes(join(dir, "spawn-helper")),
			`the failure names ${dir}`,
		);
	}
});

test("a directory holding the module and no helper beside it is reported", () => {
	// The one shape a filesystem can show and the loader's choice cannot be read from:
	// the tarball's prebuild answers while `build/Release` holds a module with nothing
	// to fork. Reported in the report and on the hook's second line, never thrown - a
	// `pty.node` the running Electron cannot `dlopen` falls through at run time, so which
	// directory wins is not this step's to decide.
	const root = fakePackage(scratch());
	const builtDir = sourceBuild(root, { helper: false });
	const report = ensureSpawnHelperMode(root, {
		platform: "darwin",
		arch: "arm64",
	});
	assert.equal(
		report.path,
		join(
			prebuildDir(root, { platform: "darwin", arch: "arm64" }),
			"spawn-helper",
		),
	);
	assert.equal(report.moduleDirWithoutHelper, builtDir);
});

test("a platform that forks no helper reports the absence rather than failing", () => {
	// win32 is asserted beside linux because it is the same answer for the same
	// reason: both fork the user's shell directly, so an artifact with no helper is a
	// complete artifact and not a build to stop.
	const root = fakePackage(scratch(), { plugins: ["darwin-x64"] });
	for (const platform of ["linux", "win32"]) {
		const report = ensureSpawnHelperMode(root, { platform, arch: "x64" });
		assert.deepEqual(
			{
				path: report.path,
				mode: report.mode,
				required: report.required,
				healed: report.healed,
			},
			{ path: null, mode: null, required: false, healed: false },
		);
	}
});

test("a linux pack prepares its console-native tree end to end", () => {
	// The whole hook against the tree a Linux pack produces: the tarball's four
	// foreign prebuild directories, no `prebuilds/linux-x64`, and `build/Release`
	// holding the module gyp built for it - and nothing beside it, because this
	// platform forks no helper. The prune must still reclaim the foreign prebuilds,
	// the step must pass, and its one line must say what the absence is: a reader
	// comparing it against the artifact cannot otherwise tell "this platform needs
	// none" from "the helper went missing".
	const appOutDir = scratch();
	const root = fakePackage(packedRoot(appOutDir, "linux"), {
		plugins: TARBALL_PREBUILDS,
	});
	sourceBuild(root, { helper: false });
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
	assert.equal(report.helper.path, null);
	assert.equal(report.helper.required, false);
	assert.equal(report.helper.healed, false);
	// ONE line: the module-without-a-helper warning is a question for the platforms
	// that fork one, and Linux is not one of them.
	assert.equal(lines.length, 1);
	assert.match(lines[0], /kept prebuilds\/\(none\)/);
	assert.match(lines[0], /spawn-helper \(none, and linux-x64 forks none\)/);
});

test("the hook adds a line when a directory holds the module and no helper", () => {
	// macOS, where a helper IS required: a `build/Release/pty.node` with nothing to
	// fork is the state that would fail the first spawn if the loader took it, so the
	// build says so in a second line rather than passing quietly.
	const appOutDir = scratch();
	const root = fakePackage(packedRoot(appOutDir), {
		plugins: ["darwin-arm64"],
	});
	sourceBuild(root, { helper: false });
	const lines = [];
	const report = prepareConsoleNative({
		appOutDir,
		productFilename: "Local Operator",
		arch: "arm64",
		platform: "darwin",
		log: (line) => lines.push(line),
	});
	assert.equal(
		report.helper.moduleDirWithoutHelper,
		join(root, "build", "Release"),
	);
	assert.equal(lines.length, 2);
	assert.match(
		lines[1],
		/native module is at build\/Release with no spawn-helper beside it/,
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
