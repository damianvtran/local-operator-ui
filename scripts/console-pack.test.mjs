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
import { join } from "node:path";
import { after, test } from "node:test";
import {
	SPAWN_HELPER_MODE,
	consoleNativeRoot,
	ensureSpawnHelperMode,
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

test("a build with no helper fails loudly on the platforms that need one", () => {
	const root = fakePackage(scratch(), { plugins: ["darwin-x64"] });
	assert.throws(
		() => ensureSpawnHelperMode(root, { platform: "darwin", arch: "arm64" }),
		/no node-pty spawn-helper/,
	);
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
