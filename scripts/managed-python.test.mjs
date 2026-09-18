import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	closeSync,
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	statfsSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
	artifactArch,
	finalContainerChecks,
	finalMetadataChecks,
	heldAttachTargets,
	isVolumeAttached,
	mountedDevice,
	privatePythonSeedCheck,
	releaseAttachTargets,
} from "./python-artifact-layout.mjs";
import { bundledPythonCheck, spawnRunner } from "./verify-macos-artifacts.mjs";

const result = await build({
	stdin: {
		contents: 'export * from "./src/main/backend/managed-python";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const runtime = await import(
	`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const {
	runtimeManifest,
	runtimeId,
	runtimeIdentity,
	readManagedSelection,
	inspectManagedSelection,
	managedSelectionReady,
	publishedBackendVersion,
	managedSelectionSatisfies,
	prepareManagedPython,
	updateManagedPython,
	reapSupersededGenerations,
	managedPythonRoot,
	runtimesRoot,
	isLegacyManagedCommand,
	PYTHON_SEED_NAMESPACE,
} = runtime;
function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "lo-managed-python-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

/** Remove a fixture tree that holds the backing image of a volume the test
 * mounted - and only once that volume is really gone.
 *
 * THE ORDER IS LOAD-BEARING, AND SO IS THE STATE. The `.dmg` lives in `root`
 * while the mount point lives in the module's own scratch, so an unconditional
 * `rmSync` here deletes the backing file of a live volume whenever the detach
 * did not take, and a backing file removed under a still-attached volume is what
 * makes macOS show the operator "Disk Not Ejected Properly" on their desktop,
 * days later. `hdiutil`'s exit code cannot answer that question either way: it
 * exits 1 for a volume somebody else already ejected as well as for one it could
 * not remove. So the state decides, and a volume that is still up keeps its tree
 * for a human to eject.
 */
function removeVolumeTree(t, root, target) {
	if (target !== null) {
		if (isVolumeAttached(target))
			spawnRunner("/usr/bin/hdiutil", ["detach", "-force", "-quiet", target]);
		if (isVolumeAttached(target)) {
			t.diagnostic(
				`left ${root} in place: ${target} is still attached, so its backing image stays`,
			);
			return;
		}
	}
	rmSync(root, { recursive: true, force: true });
}
function options(support, packaged = true) {
	return { support, resources: "", packaged, arch: "arm64" };
}

/**
 * The macOS toolchain these tests drive, and why skipping one is not a pass.
 *
 * `prepareManagedPython` is a macOS path end to end and says so: the manifest it
 * writes is `platform: "darwin"`, the preparation lock is `/usr/bin/shlock`, and
 * `verifyMachO` refuses a seed with no Mach-O in it while running
 * `/usr/bin/codesign` and `/usr/bin/otool` over every one it does find. The seed
 * fixture that satisfies it therefore needs a REAL signed Mach-O, which
 * `signedMachO` makes by thinning `/usr/bin/true` with `lipo` and ad-hoc signing
 * it. `finalContainerChecks` needs the same shell from the other end: `ditto` to
 * build an archive, `hdiutil` to mount an image, `lipo` to read an app's
 * architecture.
 *
 * The suite runs on `ubuntu-latest` in CI, where none of those binaries exist, so
 * these tests were failing with `spawnSync /usr/bin/lipo ENOENT` rather than
 * reporting anything about the code. They are skipped on such a platform instead,
 * and the skip NAMES the tool it is missing: a green Linux run must not be
 * mistakable for coverage of this path. On macOS `skipUnlessDarwin` returns false
 * and the test runs to the end, unweakened - the parts of this file that assert
 * the same contracts without the toolchain are the tests that call
 * `runtimeManifest`/`runtimeIdentity`/`inspectManagedSelection` directly.
 */
const MACOS_SEED_TOOLCHAIN =
	"preparing an environment takes the shlock lock and verifies every Mach-O in the seed with codesign and otool, so the fixture seed is a real thinned, ad-hoc-signed binary (lipo, codesign)";
const MACOS_CONTAINER_TOOLCHAIN =
	"the container gate builds archives with ditto, mounts images with hdiutil and reads an app's architecture with lipo";
function skipUnlessDarwin(t, missing) {
	if (process.platform === "darwin") return false;
	t.skip(`macOS only: ${missing}`);
	return true;
}

test("runtime identity binds final file bytes, names, modes and internal link targets", (t) => {
	const root = fixture(t);
	mkdirSync(join(root, "bin"));
	writeFileSync(join(root, "bin", "python3.12"), "signed fixture bytes");
	symlinkSync("python3.12", join(root, "bin", "python3"));
	const id = runtimeId(runtimeManifest(root, "arm64"));
	assert.equal(runtimeId(runtimeManifest(root, "arm64")), id);
	assert.notEqual(runtimeId(runtimeManifest(root, "x64")), id);
	chmodSync(join(root, "bin", "python3.12"), 0o755);
	assert.notEqual(runtimeId(runtimeManifest(root, "arm64")), id);
	const executable = runtimeId(runtimeManifest(root, "arm64"));
	writeFileSync(
		join(root, "bin", "python3.12"),
		"changed signed fixture bytes",
	);
	assert.notEqual(runtimeId(runtimeManifest(root, "arm64")), executable);
});

test("new external caches are harmless but signed source modifications still fail identity", (t) => {
	const root = fixture(t);
	writeFileSync(join(root, "stdlib.py"), "pass\n");
	const expected = runtimeId(runtimeManifest(root, "arm64"));
	mkdirSync(join(root, "__pycache__"));
	writeFileSync(
		join(root, "__pycache__", "stdlib.cpython-312.pyc"),
		"new cache",
	);
	assert.equal(runtimeId(runtimeManifest(root, "arm64", true)), expected);
	writeFileSync(join(root, "stdlib.py"), "modified\n");
	assert.notEqual(runtimeId(runtimeManifest(root, "arm64", true)), expected);
});

test("external branding aliases preserve readiness but modified immutable bytes do not", (t) => {
	const root = fixture(t);
	const tree = join(root, "runtime");
	mkdirSync(tree);
	const binary = join(tree, "python");
	writeFileSync(binary, "signed binary bytes");
	const expected = runtimeId(runtimeManifest(tree, "arm64"));
	linkSync(binary, join(root, "Local Operator"));
	linkSync(binary, join(root, ".Local Operator.123.tmp"));
	assert.equal(runtimeId(runtimeManifest(tree, "arm64", true)), expected);
	assert.throws(() => runtimeManifest(tree, "arm64"), /hardlink/);
	writeFileSync(join(root, "Local Operator"), "modified through alias");
	assert.notEqual(runtimeId(runtimeManifest(tree, "arm64", true)), expected);
});

test("seed traversal rejects escaping links, hardlinks, special roots and invalid architecture", (t) => {
	const root = fixture(t);
	const tree = join(root, "tree");
	mkdirSync(tree);
	writeFileSync(join(root, "outside"), "user data");
	symlinkSync("../outside", join(tree, "escape"));
	assert.throws(() => runtimeManifest(tree, "arm64"), /escapes/);
	rmSync(join(tree, "escape"));
	linkSync(join(root, "outside"), join(tree, "hardlink"));
	assert.throws(() => runtimeManifest(tree, "arm64"), /hardlink/);
	assert.throws(() => runtimeManifest(tree, "universal"), /Unsupported/);
	assert.equal(readFileSync(join(root, "outside"), "utf8"), "user data");
});

test("packaged/dev selections are disjoint, and a pointer nobody can trust is 'unprepared' rather than an error", (t) => {
	const support = fixture(t);
	assert.notEqual(
		managedPythonRoot(options(support)),
		managedPythonRoot(options(support, false)),
	);
	assert.equal(readManagedSelection(options(support)), null);
	const root = managedPythonRoot(options(support));
	mkdirSync(root, { recursive: true });
	writeFileSync(
		join(root, "selected-environment.json"),
		JSON.stringify({
			format: 1,
			runtimeId: "a".repeat(64),
			runtime: "/tmp/not-owned",
			venv: "/tmp/not-owned",
			backendVersion: "0",
		}),
	);
	// A pointer naming paths outside this root is not usable, and it is not a
	// refusal either: the preparation path republishes over it (review R8). The
	// old contract threw here, which is what made every retry re-throw.
	assert.equal(readManagedSelection(options(support)), null);
	assert.equal(inspectManagedSelection(options(support)).kind, "unprepared");
	assert.match(
		inspectManagedSelection(options(support)).detail,
		/does not describe a managed environment/,
	);
	assert.equal(readManagedSelection(options(support, false)), null);
	assert.throws(
		() => managedPythonRoot(options(join(support, "Unsafe.app", "state"))),
		/outside every/,
	);
});

test("legacy PATH launchers and shebang aliases cannot bypass migration", (t) => {
	const support = fixture(t);
	const command = join(support, "alias");
	writeFileSync(
		command,
		`#!${support}/local-operator-venv/bin/python\nprint('legacy')\n`,
	);
	assert.equal(isLegacyManagedCommand(command, support), true);
	writeFileSync(command, "#!/usr/bin/python3\nprint('independent')\n");
	assert.equal(isLegacyManagedCommand(command, support), false);
	assert.equal(
		isLegacyManagedCommand(
			join(support, "local-operator-venv", "bin", "local-operator"),
			support,
		),
		true,
	);
});

test("final app gate rejects legacy aliases even if they are dangling", (t) => {
	const scratch = fixture(t);
	const app = join(scratch, "Candidate.app");
	const resources = join(app, "Contents", "Resources");
	const seed = join(resources, "python-runtime-seed", "arm64");
	mkdirSync(join(seed, "bin"), { recursive: true });
	mkdirSync(join(seed, "lib", "python3.12", "encodings"), { recursive: true });
	writeFileSync(join(seed, "bin", "python3"), "fixture");
	writeFileSync(
		join(seed, "lib", "python3.12", "encodings", "__init__.py"),
		"pass",
	);
	assert.equal(privatePythonSeedCheck(app).passed, true);
	symlinkSync("/missing-legacy-python", join(resources, "python_aarch64"));
	const rejected = privatePythonSeedCheck(app);
	assert.equal(rejected.passed, false);
	assert.match(rejected.output, /Legacy/);
});

test("metadata validation refuses bytes changed after release metadata was generated", (t) => {
	const root = fixture(t);
	writeFileSync(join(root, "candidate.zip"), "final delivered bytes");
	writeFileSync(
		join(root, "latest-mac.yml"),
		"version: 1.0.0\nfiles:\n  - url: candidate.zip\n    sha512: invalid\n    size: 21\n",
	);
	const results = finalMetadataChecks(root, [join(root, "candidate.zip")]);
	assert.equal(results[0].passed, false);
	assert.match(results[0].output, /Metadata bytes differ/);
});

/*
 * The container checks, driven against REAL containers.
 *
 * Why these are not mocked: R3 of the review found the gate asserting only
 * electron-builder's unpacked `dist` app, so the bundle a user downloads - the
 * one that decides whether the fix reaches anybody - was never asked. The
 * answer was `finalContainerChecks`, which mounts the image and copies the app
 * out. A test that stubbed the mount would re-open the same hole one level up,
 * so the fixtures below are a real ZIP and a real DMG built by the same tools
 * the gate uses.
 */

/**
 * The architectures `/usr/bin/true` carries, read the way the gate reads them.
 *
 * It is FAT on current macOS (`x86_64 + arm64e`), and `bundleArchitectures`
 * refuses a fat bundle - correctly, since `mac.target` builds one architecture
 * per artifact - so the fixture cannot simply copy it. It is thinned to ONE of
 * these architectures, and the preference order picks the first the platform
 * can actually thin to, keeping every architecture question a question about a
 * real Mach-O rather than about a stub.
 */
const SOURCE_ARCHS = spawnRunner("/usr/bin/lipo", ["-archs", "/usr/bin/true"])
	.stdout.trim()
	.split(/\s+/);
const MACHINE_LIPO_ARCH =
	["arm64", "x86_64"].find((arch) => SOURCE_ARCHS.includes(arch)) ??
	SOURCE_ARCHS[0];
/** The artifact filename spelling (`mac.artifactName`) of that architecture. */
const MACHINE_ARTIFACT_ARCH = MACHINE_LIPO_ARCH === "arm64" ? "arm64" : "x64";
const OTHER_ARTIFACT_ARCH = MACHINE_ARTIFACT_ARCH === "arm64" ? "x64" : "arm64";

/** One architecture of `/usr/bin/true`, written where the framework binary goes. */
function thinFrameworkBinary(destination) {
	const result = spawnRunner("/usr/bin/lipo", [
		"-thin",
		MACHINE_LIPO_ARCH,
		"-output",
		destination,
		"/usr/bin/true",
	]);
	assert.equal(
		result.status,
		0,
		`lipo could not thin the fixture binary: ${result.stdout}${result.stderr}`,
	);
	assert.equal(
		spawnRunner("/usr/bin/lipo", ["-archs", destination]).stdout.trim(),
		MACHINE_LIPO_ARCH,
	);
}

/**
 * A synthetic app bundle carrying a REAL, single-architecture Mach-O where the
 * framework binary is, so `bundleArchitectures` answers about this fixture
 * rather than about a stub. `seedArch` chooses which interpreter directory it
 * carries, which is how a bundle that ships the OTHER architecture's complete,
 * correct seed becomes expressible.
 */
function appBundle(
	root,
	{
		name = "Local Operator.app",
		seedArch = MACHINE_ARTIFACT_ARCH,
		legacyAlias = null,
	} = {},
) {
	const app = join(root, name);
	const resources = join(app, "Contents", "Resources");
	const framework = join(
		app,
		"Contents",
		"Frameworks",
		"Electron Framework.framework",
		"Versions",
		"A",
	);
	mkdirSync(framework, { recursive: true });
	thinFrameworkBinary(join(framework, "Electron Framework"));
	const seed = join(resources, "python-runtime-seed", seedArch);
	mkdirSync(join(seed, "bin"), { recursive: true });
	mkdirSync(join(seed, "lib", "python3.12", "encodings"), { recursive: true });
	writeFileSync(join(seed, "bin", "python3"), "fixture");
	writeFileSync(
		join(seed, "lib", "python3.12", "encodings", "__init__.py"),
		"pass",
	);
	if (legacyAlias)
		symlinkSync("/missing-legacy-python", join(resources, legacyAlias));
	return app;
}

/** The app checks a container's extracted bundle is held to, as the gate wires them. */
function containerAppChecks(app, arch) {
	return [
		bundledPythonCheck(app, { expectArch: arch }),
		privatePythonSeedCheck(app, { expectArch: arch }),
	];
}

/** Zip an app the way electron-builder does, with the bundle at the archive root. */
function zipApp(app, destination) {
	const result = spawnRunner("/usr/bin/ditto", [
		"-c",
		"-k",
		"--sequesterRsrc",
		"--keepParent",
		app,
		destination,
	]);
	assert.equal(
		result.status,
		0,
		`ditto could not build the fixture zip: ${result.stdout}${result.stderr}`,
	);
	return destination;
}

/** Run the container checks over one real archive, as `verify-macos-artifacts` does. */
function containerResults(archive) {
	return finalContainerChecks(archive, {
		run: spawnRunner,
		checkApp: containerAppChecks,
	});
}

function failures(results) {
	return results
		.filter((result) => !result.passed)
		.map((result) => `${result.id}: ${result.output}`);
}

/*
 * The filename is the ONLY statement of an artifact's architecture, and
 * `mac.artifactName` is where it is made. Pure string work, so it runs on every
 * platform - the half of this that needs the container tools is the test below.
 */
test("an artifact's filename is the only statement of its architecture", () => {
	assert.equal(artifactArch("/tmp/local-operator-ui-0.0.0-arm64.zip"), "arm64");
	assert.equal(artifactArch("/tmp/local-operator-ui-0.0.0-x64.dmg"), "x64");
	assert.equal(
		artifactArch("/tmp/Local Operator.app"),
		null,
		"an unpacked app claims no architecture",
	);
});

test("a container's filename architecture is cross-checked against the app inside it", (t) => {
	if (skipUnlessDarwin(t, MACOS_CONTAINER_TOOLCHAIN)) return;
	const scratch = fixture(t);
	const app = appBundle(scratch);
	const matched = containerResults(
		zipApp(
			app,
			join(scratch, `local-operator-ui-0.0.0-${MACHINE_ARTIFACT_ARCH}.zip`),
		),
	);
	assert.deepEqual(
		failures(matched),
		[],
		"a correctly named archive must pass; the checks below would mean nothing otherwise",
	);
	// The same bytes under the other architecture's name: the failure is invisible
	// inside the app, because an arm64 bundle named `-x64` extracts and launches on
	// the machine that built it - only the container's name knows it is wrong.
	const swapped = containerResults(
		zipApp(
			app,
			join(scratch, `local-operator-ui-0.0.0-${OTHER_ARTIFACT_ARCH}.zip`),
		),
	);
	assert.match(
		failures(swapped).join("\n"),
		/names x64 but the app inside it is arm64|names arm64 but the app inside it is x86_64/,
	);
	assert.match(
		failures(swapped).join("\n"),
		/names (x64|arm64) but ships the (arm64|x64) seed/,
	);
});

test("the container gate refuses a legacy interpreter alias and a seed for the wrong architecture", (t) => {
	if (skipUnlessDarwin(t, MACOS_CONTAINER_TOOLCHAIN)) return;
	const scratch = fixture(t);
	const legacy = appBundle(join(scratch, "legacy"), {
		legacyAlias: "python_aarch64",
	});
	const refused = containerResults(
		zipApp(legacy, join(scratch, "local-operator-ui-0.0.0-arm64.zip")),
	);
	assert.ok(
		failures(refused).some((line) =>
			/Legacy Python resource or alias exists: python_aarch64/.test(line),
		),
		failures(refused).join("\n"),
	);
	// A complete, valid seed for the OTHER architecture passes every check that
	// only reads the seed, which is why the filename has to travel this far.
	const wrongSeed = appBundle(join(scratch, "wrong-seed"), {
		seedArch: OTHER_ARTIFACT_ARCH,
	});
	const wrongSeedResults = containerResults(
		zipApp(
			wrongSeed,
			join(scratch, `local-operator-ui-0.0.0-${MACHINE_ARTIFACT_ARCH}.zip`),
		),
	);
	assert.ok(
		failures(wrongSeedResults).some((line) =>
			/ships the (arm64|x64) seed/.test(line),
		),
		failures(wrongSeedResults).join("\n"),
	);
});

test("the container gate names an archive with no application rather than passing", (t) => {
	if (
		skipUnlessDarwin(
			t,
			"the archive is built with ditto, which this platform does not have",
		)
	)
		return;
	const scratch = fixture(t);
	const empty = join(scratch, "empty");
	mkdirSync(empty, { recursive: true });
	writeFileSync(join(empty, "not-an-app.txt"), "nothing to check\n");
	const archive = join(
		scratch,
		`local-operator-ui-0.0.0-${MACHINE_ARTIFACT_ARCH}.zip`,
	);
	assert.equal(
		spawnRunner("/usr/bin/ditto", ["-c", "-k", empty, archive]).status,
		0,
	);
	const results = containerResults(archive);
	assert.equal(results.length, 1);
	assert.equal(results[0].passed, false);
	assert.match(results[0].output, /Expected exactly one application/);
});

test("the disk image path is exercised by mounting the real image, not by assertion", (t) => {
	if (
		skipUnlessDarwin(
			t,
			"the image is built and mounted with hdiutil, which this platform does not have",
		)
	)
		return;
	// Its own root rather than `fixture`'s, because the teardown has to DETACH
	// before it removes the tree and two owners' `t.after` hooks would race for
	// that order. The order is load-bearing: the .dmg in this tree is the backing
	// file of the volume `finalContainerChecks` mounts, and deleting it under a
	// volume that is still attached is what makes macOS show the operator "Disk
	// Not Ejected Properly". `removeVolumeTree` pins that order and the state
	// check, and `mountedVolume` below goes through the same helper.
	const scratch = mkdtempSync(join(tmpdir(), "lo-managed-python-image-"));
	let imageDevice = null;
	t.after(() => removeVolumeTree(t, scratch, imageDevice));
	const app = appBundle(scratch);
	const image = join(
		scratch,
		`local-operator-ui-0.0.0-${MACHINE_ARTIFACT_ARCH}.dmg`,
	);
	const created = spawnRunner("/usr/bin/hdiutil", [
		"create",
		"-quiet",
		"-volname",
		"Local Operator",
		"-srcfolder",
		app,
		"-format",
		"UDZO",
		image,
	]);
	assert.equal(
		created.status,
		0,
		`hdiutil could not build the fixture image: ${created.stdout}${created.stderr}`,
	);
	/*
	 * The runner is recorded because the mount has one requirement a fixture
	 * cannot reproduce: a SHIPPED image carries an end-user license agreement
	 * (`build/license_<lang>.txt` is electron-builder's convention), `hdiutil`
	 * reads the answer from stdin, and a bare attach on the real artifact answers
	 * `hdiutil: attach canceled` and verifies nothing. `hdiutil create` does not
	 * embed an agreement, so the input below is unused on this fixture - which is
	 * exactly why it is asserted here rather than inferred from a passing mount.
	 */
	const calls = [];
	const run = (command, args, input) => {
		calls.push({ command, args, input });
		const result = spawnRunner(command, args, input);
		// The DEVICE is remembered for the teardown - the same parse the module makes,
		// so the teardown detaches by device too, and a teardown that could not
		// detach leaves this tree (and the backing image in it) alone.
		if (command === "/usr/bin/hdiutil" && args[0] === "attach")
			imageDevice = mountedDevice(
				result.stdout,
				args[args.indexOf("-mountpoint") + 1],
			);
		return result;
	};
	const results = finalContainerChecks(image, {
		run,
		checkApp: containerAppChecks,
	});
	assert.deepEqual(
		failures(results),
		[],
		"the mounted image's app must pass the same checks the archive's app does",
	);
	assert.ok(
		results.some((result) => result.target.includes(":: Local Operator.app")),
		"the checks must name the app copied out of the image",
	);
	const attach = calls.find(
		(call) => call.command === "/usr/bin/hdiutil" && call.args[0] === "attach",
	);
	assert.ok(attach, "the image must be mounted, not read in place");
	assert.ok(
		attach.args.includes("-readonly") && attach.args.includes("-nobrowse"),
		"the mount is read-only and must not appear in anyone's Finder",
	);
	assert.equal(
		attach.input,
		"Y\n",
		"the attach must answer the shipped image's license agreement, or the app inside it is never verified",
	);
	// A real mount is the only place the device-name handshake can be exercised:
	// the detach has to name the loopback device attach reported, not the mount
	// path, or it is a second, independent name for the volume that can resolve
	// to a different one.
	const detach = calls.find(
		(call) => call.command === "/usr/bin/hdiutil" && call.args[0] === "detach",
	);
	assert.ok(
		detach,
		"the volume this test mounted must be detached by this test",
	);
	assert.match(
		detach.args[1],
		/^\/dev\/disk\d+(s\d+)?$/,
		`the detach must name the device attach reported: ${detach.args.join(" ")}`,
	);
});

// ---------------------------------------------------------------------------
// The mount the container gate owns may not outlive it

/**
 * A `.dmg` run built entirely from fakes, so the detach contract can be driven
 * to states a real `hdiutil` reaches too rarely to wait for, on every platform.
 *
 * `attach` claims the device the way `hdiutil` reports one and plants the app in
 * the mount, `ditto` plants it in the extracted tree, and `detach` is the
 * caller's script - the failures this file exists to pin are a mount something
 * holds open, a mount that will not come away, and a mount that is already gone.
 * NOTHING here is really attached, which is also what makes the fabricated
 * device name a test of its own: a claim must never be able to arm the exit
 * backstop, because the backstop detaches with the REAL `hdiutil`.
 */
function fakeImageRun(t, detach) {
	const root = mkdtempSync(join(tmpdir(), "lo-container-fake-"));
	const image = join(root, "local-operator-ui-0.0.0-arm64.dmg");
	writeFileSync(image, "fixture image bytes\n");
	let mount = null;
	t.after(() => {
		// `finalContainerChecks` keeps its scratch when it cannot detach, and that
		// tree holds the (never really mounted) mount point: remove it here so a
		// failing contract does not leak a temp tree into the run. Through the same
		// helper as the real fixtures, because "nothing here is attached" is exactly
		// what the helper checks rather than assumes.
		if (mount !== null) removeVolumeTree(t, dirname(mount), mount);
		removeVolumeTree(t, root, mount);
	});
	const calls = [];
	const run = (command, args, input) => {
		calls.push({ command, args, input });
		if (command === "/usr/bin/hdiutil" && args[0] === "attach") {
			mount = args[args.indexOf("-mountpoint") + 1];
			mkdirSync(join(mount, "Local Operator.app"), { recursive: true });
			// As hdiutil prints it: one line per entity, the volume last, the mount
			// path RESOLVED rather than the path the caller passed.
			return {
				status: 0,
				stdout: `/dev/disk9          \tApple_partition_scheme         \t\n/dev/disk9s2        \tApple_HFS                      \t${realpathSync(mount)}\n`,
				stderr: "",
			};
		}
		if (command === "/usr/bin/hdiutil" && args[0] === "detach")
			return detach(args);
		if (command === "/usr/bin/ditto" && args[0] !== "-x") {
			const [from, to] = args;
			if (existsSync(from)) mkdirSync(to, { recursive: true });
			return { status: 0, stdout: "", stderr: "" };
		}
		return { status: 0, stdout: "", stderr: "" };
	};
	return {
		image,
		calls,
		run,
		get mount() {
			return mount;
		},
	};
}

test("a busy mount is detached by device, then repaired with one forced retry", (t) => {
	const attempted = [];
	const fixtureRun = fakeImageRun(t, (args) => {
		attempted.push(args);
		// The graceful detach of a volume something still holds open fails the way
		// a real one does; `-force` is what wins.
		return args.includes("-force")
			? { status: 0, stdout: "", stderr: "" }
			: { status: 1, stdout: "", stderr: "Resource busy" };
	});
	const results = finalContainerChecks(fixtureRun.image, {
		run: fixtureRun.run,
		checkApp: () => [],
	});
	assert.deepEqual(
		failures(results),
		[],
		"a detach that succeeds on the forced retry is not a failure",
	);
	assert.deepEqual(
		attempted,
		[
			["detach", "/dev/disk9s2"],
			["detach", "-force", "/dev/disk9s2"],
		],
		"the device attach reported must be detached, gracefully and then once with -force",
	);
	const mount = fixtureRun.mount;
	assert.ok(mount !== null, "the fake attach must have been driven");
	assert.equal(
		existsSync(mount),
		false,
		"a mount that came away takes its scratch tree with it",
	);
});

test("a mount that will not detach is reported and its tree is left standing", (t) => {
	if (
		skipUnlessDarwin(
			t,
			"the check asks hdiutil what is attached, and hdiutil is this platform's tool",
		)
	)
		return;
	/*
	 * A REAL volume, because the failure row is owed only when the volume really
	 * is still attached: `hdiutil info` is asked, and a fabricated device name no
	 * longer produces one (the "already gone" test below covers that side). The
	 * runner forwards the attach to the real tool and refuses every detach, which
	 * is the state a busy volume is in and the state a caller has to survive.
	 */
	const root = mkdtempSync(join(tmpdir(), "lo-managed-python-refused-"));
	const app = join(root, "Local Operator.app");
	mkdirSync(app, { recursive: true });
	writeFileSync(join(app, "payload.txt"), "app\n");
	const image = join(root, "local-operator-ui-0.0.0-arm64.dmg");
	assert.equal(
		spawnRunner("/usr/bin/hdiutil", [
			"create",
			"-quiet",
			"-size",
			"16m",
			"-fs",
			"HFS+",
			"-volname",
			"lo-refused",
			"-srcfolder",
			app,
			"-format",
			"UDZO",
			image,
		]).status,
		0,
		"hdiutil could not build the fixture image",
	);
	let mount = null;
	let device = null;
	// The teardown detaches FOR REAL: the runner below refuses every detach, so
	// nothing else in this test will.
	t.after(() => removeVolumeTree(t, root, device ?? mount));
	const run = (command, args, input) => {
		if (command === "/usr/bin/hdiutil" && args[0] === "attach") {
			mount = args[args.indexOf("-mountpoint") + 1];
			const attached = spawnRunner(command, args, input);
			device = mountedDevice(attached.stdout, mount);
			return attached;
		}
		// Every detach is refused, which is what a busy volume does - and a refusal
		// that leaves the volume up is what the caller may not hide.
		if (command === "/usr/bin/hdiutil" && args[0] === "detach")
			return {
				status: 16,
				stdout: "",
				stderr: "hdiutil: couldn't unmount - Resource busy\n",
			};
		return spawnRunner(command, args, input);
	};
	const results = finalContainerChecks(image, { run, checkApp: () => [] });
	const refused = failures(results);
	assert.equal(
		refused.length,
		1,
		`a volume left attached is the only row a caller may see, so it cannot pass for a clean run: ${refused.join("\n")}`,
	);
	assert.match(refused[0], /^artifact-unmount: /);
	assert.ok(
		refused[0].includes(mount),
		`the failure must name the mount still attached: ${refused[0]}`,
	);
	assert.ok(
		device !== null && refused[0].includes(device),
		`and the device it could not detach: ${refused[0]}`,
	);
	assert.equal(
		isVolumeAttached(device),
		true,
		"the volume really is still attached, which is why the tree must stay",
	);
	assert.equal(
		existsSync(mount),
		true,
		"the scratch tree holds the live mount point and must NOT be deleted",
	);
	assert.equal(
		existsSync(image),
		true,
		"nor may anything delete the backing image of a volume that is still attached",
	);
});

test("a mount that is already gone is not reported as a failure", (t) => {
	/*
	 * THE STATE, NOT THE EXIT CODE. Measured on this machine: detaching a device
	 * that no longer exists exits 1 with `detach failed - No such file or
	 * directory` - plain, `-force` and `-force -quiet` alike. Reporting that as a
	 * failure would fail a run and leak a scratch tree over a volume nobody has
	 * attached, so the target has to be re-checked against `hdiutil info` before a
	 * failure is declared. The fabricated device below is not attached anywhere,
	 * on any platform, which is the whole of the case.
	 */
	const fixtureRun = fakeImageRun(t, () => ({
		status: 1,
		stdout: "",
		stderr: "hdiutil: detach failed - No such file or directory\n",
	}));
	const results = finalContainerChecks(fixtureRun.image, {
		run: fixtureRun.run,
		checkApp: () => [],
	});
	assert.deepEqual(
		failures(results),
		[],
		`a device that is not attached is not a failure: ${failures(results).join("\n")}`,
	);
	const mount = fixtureRun.mount;
	assert.ok(mount !== null, "the fake attach must have been driven");
	assert.equal(
		existsSync(mount),
		false,
		"and its scratch tree does not leak over a volume nobody has attached",
	);
});

test("a runner that only claims a device cannot arm the attach backstop", (t) => {
	/*
	 * THE BACKSTOP DETACHES WITH THE REAL `hdiutil`, so what it holds must be an
	 * attachment this process is shown to have made. `/dev/disk9s2` below is a
	 * device name in the shape the module parses, claimed by a runner and never
	 * attached by anything here; with the record armed from the runner's OUTPUT,
	 * this test would leave that name behind for the exit handler, which would then
	 * force-detach it - on this shared machine, whatever happens to hold it.
	 */
	releaseAttachTargets();
	// Sampled from INSIDE the detach, which is the first moment after the attach
	// has been recorded: asserting only at the end would be answered by the
	// release of a target that is not attached, not by whether the claim armed it.
	let armedAtDetach = null;
	const fixtureRun = fakeImageRun(t, () => {
		armedAtDetach = heldAttachTargets();
		return { status: 1, stdout: "", stderr: "Resource busy" };
	});
	finalContainerChecks(fixtureRun.image, {
		run: fixtureRun.run,
		checkApp: () => [],
	});
	assert.deepEqual(
		armedAtDetach,
		[],
		"a claim must not be recorded, or the exit handler force-detaches that name",
	);
	assert.deepEqual(
		heldAttachTargets(),
		[],
		"and nothing may be left recorded once the mount is dealt with",
	);
});

test("a claimed device cannot eject another process's live volume at exit", (t) => {
	if (
		skipUnlessDarwin(
			t,
			"the probe attaches a real image with hdiutil and hands its device to a child process",
		)
	)
		return;
	/*
	 * The reviewer's repro, encoded: a volume THIS test owns is really attached,
	 * and a child process is handed its device and driven through the fake path.
	 * The child's runner CLAIMS that device, every detach it makes fails, and it
	 * exits normally - so if a claim could arm the backstop, the child's exit would
	 * eject this test's volume, and this test would see it happen.
	 */
	const root = mkdtempSync(join(tmpdir(), "lo-managed-python-claim-"));
	const image = join(root, "claim.dmg");
	const mount = join(root, "mnt");
	mkdirSync(mount, { recursive: true });
	assert.equal(
		spawnRunner("/usr/bin/hdiutil", [
			"create",
			"-quiet",
			"-size",
			"16m",
			"-fs",
			"HFS+",
			"-volname",
			"lo-claim",
			"-srcfolder",
			mount,
			"-format",
			"UDZO",
			image,
		]).status,
		0,
		"hdiutil could not build the fixture image",
	);
	// No `-quiet`: the device table on stdout is the device this test hands over.
	const attached = spawnRunner("/usr/bin/hdiutil", [
		"attach",
		"-readonly",
		"-nobrowse",
		"-mountpoint",
		mount,
		image,
	]);
	assert.equal(
		attached.status,
		0,
		`hdiutil could not attach the volume: ${attached.stderr}`,
	);
	const device = mountedDevice(attached.stdout, mount);
	assert.ok(
		device !== null,
		"the attach must name the device this probe hands over",
	);
	t.after(() => removeVolumeTree(t, root, device));
	const probe = join(root, "claim-probe.mjs");
	writeFileSync(
		probe,
		/*
		 * The child is a separate process because the hazard is a PROCESS-EXIT one:
		 * its exit handler runs the real `hdiutil`. Its fabricated rows are built
		 * with String.fromCharCode rather than escape sequences, so this text can
		 * sit inside a template literal here without a backslash-n turning into a
		 * real newline inside the CHILD's own string literal, which does not parse.
		 */
		`import { mkdirSync } from "node:fs";
import { finalContainerChecks } from ${JSON.stringify(new URL("./python-artifact-layout.mjs", import.meta.url).href)};
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const [, , image, device] = process.argv;
const run = (command, args) => {
	if (command === "/usr/bin/hdiutil" && args[0] === "attach") {
		const mount = args[args.indexOf("-mountpoint") + 1];
		mkdirSync(mount + "/Local Operator.app", { recursive: true });
		const scheme = ["/dev/disk3", "Apple_partition_scheme", ""].join(TAB);
		return { status: 0, stdout: scheme + LF + [device, "Apple_HFS", mount].join(TAB) + LF, stderr: "" };
	}
	if (command === "/usr/bin/ditto") {
		mkdirSync(args[2], { recursive: true });
		return { status: 0, stdout: "", stderr: "" };
	}
	return { status: 1, stdout: "", stderr: "hdiutil: detach failed - No such file or directory" };
};
finalContainerChecks(image, { run, checkApp: () => [] });
`,
	);
	const ran = spawnRunner(process.execPath, [probe, image, device]);
	assert.equal(
		ran.status,
		0,
		`the probe process must exit normally: ${ran.stderr}`,
	);
	assert.equal(
		isVolumeAttached(device),
		true,
		"the child's exit must not eject a device it only claimed",
	);
});

/*
 * The attachment's device, read from the tool's own output rather than guessed.
 * Pure string work plus one symlink, so it runs wherever the tests do.
 */
test("the device is read from hdiutil's own output rather than assumed", (t) => {
	const root = mkdtempSync(join(tmpdir(), "lo-mounted-device-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const real = join(root, "mount-real");
	mkdirSync(real);
	const linked = join(root, "mount-link");
	symlinkSync(real, linked);
	// As `hdiutil attach -mountpoint` prints it: one line per entity, the mounted
	// volume last, and the mount path RESOLVED - which is the case that matters,
	// because the scratch mount lives under a symlinked `tmpdir` and what the
	// caller passed is not what hdiutil echoes back. The resolved form is taken
	// from realpathSync rather than written out, so on a platform whose tmpdir is
	// not a symlink the two strings coincide and this asserts the literal match.
	const resolved = realpathSync(linked);
	const printed = `/dev/disk11         \tApple_partition_scheme         \t\n/dev/disk11s1        \tApple_partition_map            \t\n/dev/disk11s2        \tApple_HFS                      \t${resolved}\n`;
	assert.equal(
		mountedDevice(printed, linked),
		"/dev/disk11s2",
		"a mount that was passed must be matched through its resolved form",
	);
	assert.equal(
		mountedDevice(printed, real),
		"/dev/disk11s2",
		"and the same path matched literally",
	);
	// NO FALLBACK to the last device line: a row that names some other mount can
	// belong to another volume of the same image - a slice - and detaching one
	// ejects the whole image. `null` says "this output did not name my volume", and
	// the caller then detaches the mount path it created itself.
	assert.equal(
		mountedDevice("/dev/disk2\tApple_HFS\t/Volumes/Other\n", "/Volumes/Mine"),
		null,
		"a row that names another mount must not hand back that mount's device",
	);
	assert.equal(
		mountedDevice("", "/Volumes/Mine"),
		null,
		"no attachment means no device, and the caller must fall back rather than invent one",
	);
});

// ---------------------------------------------------------------------------
// Retry has to be able to repair: review R8, QA Q1, review R12

/**
 * The published-selection verdict, built by hand so it needs no toolchain.
 *
 * `prepareManagedPython` is macOS-only (see `skipUnlessDarwin` above), but the
 * decision it acts on - is what is published still usable? - is a read of the
 * pointer, the record beside it, the two generations and the runtime's identity.
 * Building that state directly is what lets the contract R8 is about - "not
 * usable" is a VERDICT, not an exception - be checked on every platform, and it
 * is the state the five tests below break in five different ways.
 */
test("a published selection answers ready, missing or unprepared, and never throws", async (t) => {
	const support = fixture(t);
	const resources = join(support, "checkout");
	const arch = "arm64";
	const opts = { support, resources, packaged: true, arch };
	const root = managedPythonRoot(opts);
	const generation = "11111111-1111-4111-8111-111111111111";

	// A generation of the runtime, and the seed it was copied from, carrying the
	// same bytes - which is what lets the mismatch below name the file rather than
	// the verdict (QA Q1).
	const seed = join(resources, PYTHON_SEED_NAMESPACE, arch);
	const runtime = join(root, "runtimes", `staging-${generation}`);
	for (const tree of [seed, runtime]) {
		mkdirSync(join(tree, "bin"), { recursive: true });
		writeFileSync(join(tree, "bin", "python3.12"), "fixture bytes\n");
		writeFileSync(join(tree, "lib.py"), "pass\n");
	}
	const id = runtimeIdentity(runtime, arch);
	const placed = join(root, "runtimes", `${id}-${generation}`);
	renameSync(runtime, placed);

	const venv = join(
		root,
		"environments",
		`${id}-22222222-2222-4222-8222-222222222222`,
	);
	mkdirSync(join(venv, "bin"), { recursive: true });
	writeFileSync(join(venv, "bin", "local-operator"), "#!/bin/sh\n");
	writeFileSync(join(venv, "pyvenv.cfg"), `home = ${join(placed, "bin")}\n`);
	const selection = {
		format: 1,
		runtimeId: id,
		runtime: placed,
		venv,
		backendVersion: "0.0.0-fixture",
	};
	const record = `${JSON.stringify(selection)}\n`;
	// The filename the module writes and reads; not exported, and the point here is
	// that the record and the pointer hold the SAME bytes.
	writeFileSync(join(venv, "environment-ready.json"), record);
	writeFileSync(join(root, "selected-environment.json"), record);

	assert.equal(inspectManagedSelection(opts).kind, "ready");
	assert.deepEqual(readManagedSelection(opts), selection);
	assert.equal(await managedSelectionReady(opts), true);

	// A byte that was signed, changed under the runtime: named, and a verdict.
	writeFileSync(join(placed, "lib.py"), "changed\n");
	const changed = inspectManagedSelection(opts);
	assert.equal(changed.kind, "missing");
	assert.match(changed.detail, /lib\.py does not match the seed/);

	// The environment gone is the same answer from a different cause.
	writeFileSync(join(placed, "lib.py"), "pass\n");
	rmSync(venv, { recursive: true, force: true });
	assert.equal(inspectManagedSelection(opts).kind, "missing");
	assert.equal(await managedSelectionReady(opts), false);
	assert.equal(readManagedSelection(opts), null);

	// A pointer describing something this app does not own is not usable either,
	// and not an error: preparation republishes over it (review R8).
	writeFileSync(
		join(root, "selected-environment.json"),
		`${JSON.stringify({ format: 1, runtimeId: id, runtime: "/tmp/not-owned", venv: "/tmp/not-owned", backendVersion: "0" })}\n`,
	);
	const unowned = inspectManagedSelection(opts);
	assert.equal(unowned.kind, "unprepared");
	assert.match(unowned.detail, /does not describe a managed environment/);
});

/** A real, ad-hoc-signed Mach-O for this machine's architecture. */
function signedMachO(destination) {
	execFileSync("/usr/bin/lipo", [
		"-thin",
		MACHINE_LIPO_ARCH,
		"-output",
		destination,
		"/usr/bin/true",
	]);
	chmodSync(destination, 0o755);
	execFileSync("/usr/bin/codesign", ["-s", "-", "-f", destination], {
		stdio: "ignore",
	});
	execFileSync("/usr/bin/codesign", ["--verify", "--strict", destination]);
}

/**
 * A seed tree the provisioning path accepts.
 *
 * One signed Mach-O (a thinned, ad-hoc signed `/usr/bin/true`) plus the two files
 * that prove the tree is a complete interpreter, so `verifyMachO`'s "a seed with
 * no signed binary is not a seed" rule is satisfied by the same check a shipped
 * seed passes. `cache` plants the stray bytecode QA Q1 measured.
 */
function seedFixture(resources, arch, { cache = false, ballast = 0 } = {}) {
	const seed = join(resources, "python-runtime-seed", arch);
	mkdirSync(join(seed, "bin"), { recursive: true });
	mkdirSync(join(seed, "lib", "python3.12", "encodings"), { recursive: true });
	signedMachO(join(seed, "bin", "python3.12"));
	writeFileSync(join(seed, "bin", "python3"), "fixture launcher\n");
	writeFileSync(
		join(seed, "lib", "python3.12", "encodings", "__init__.py"),
		"pass\n",
	);
	if (cache) {
		mkdirSync(join(seed, "lib", "python3.12", "encodings", "__pycache__"));
		writeFileSync(
			join(
				seed,
				"lib",
				"python3.12",
				"encodings",
				"__pycache__",
				"__init__.cpython-312.pyc",
			),
			"stray bytecode\n",
		);
	}
	if (ballast > 0)
		// Makes the copy the repair has to make a size a full volume can refuse,
		// which is what the disk-full tests below assert about (not a Mach-O, so
		// `verifyMachO` walks past it).
		writeFileSync(join(seed, "ballast.bin"), Buffer.alloc(ballast, 0x62));
	return seed;
}

/**
 * A stand-in for the shipped install script.
 *
 * Why not the real one: `prepareManagedPython` ends in `smokeEnvironment`, which
 * runs the environment's python and then the backend itself, so the real script
 * would make these cases depend on a downloaded 47 MB interpreter, a network
 * `pip install` and a working backend - none of which is what R8 is about. The
 * two processes it does start are stood in for the same way: a shim that answers
 * the two `-c` calls with a version, and a shim that serves `/health` on the port
 * it is handed. The real end-to-end path is `scripts/verify-managed-python.mjs`.
 */
const standInPython = (version) =>
	`#!/bin/sh\n# Stand-in for the venv interpreter; smokeEnvironment's only two calls are\n# \`-c\` ones, and the second one's stdout becomes the selection's version.\necho "${version}"\n`;
function standInInstaller(venv, python, version = "0.0.0-fixture") {
	mkdirSync(join(venv, "bin"), { recursive: true });
	writeFileSync(join(venv, "bin", "python"), standInPython(version), {
		mode: 0o755,
	});
	writeFileSync(
		join(venv, "bin", "local-operator"),
		`#!/bin/sh\nport=""\nprev=""\nfor a in "$@"; do\n  if [ "$prev" = "--port" ]; then port="$a"; fi\n  prev="$a"\ndone\nPORT="$port" exec "${process.execPath}" -e 'require("node:http").createServer((q,s)=>s.end("ok")).listen(Number(process.env.PORT),"127.0.0.1");'\n`,
		{ mode: 0o755 },
	);
	writeFileSync(
		join(venv, "pyvenv.cfg"),
		`home = ${dirname(python)}\ninclude-system-site-packages = false\nversion = 3.12.10\n`,
	);
}

/** Provision once, then hand the caller a way to break it and retry. */
async function provisioned(t) {
	const support = fixture(t);
	const resources = fixture(t);
	const arch = MACHINE_ARTIFACT_ARCH;
	seedFixture(resources, arch);
	const opts = { support, resources, packaged: true, arch };
	const state = { installs: 0 };
	const install = async (venv, python) => {
		state.installs++;
		standInInstaller(venv, python);
		return true;
	};
	const first = await prepareManagedPython(opts, install);
	assert.equal(state.installs, 1);
	assert.equal(inspectManagedSelection(opts).kind, "ready");
	return { opts, install, state, first };
}

test("a selected runtime that changed out of band is rebuilt beside the old one", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, install, state, first } = await provisioned(t);
	writeFileSync(
		join(first.runtime, "lib", "python3.12", "stray.py"),
		"changed out of band\n",
	);
	const verdict = inspectManagedSelection(opts);
	assert.equal(verdict.kind, "missing");
	// The message names the file rather than the verdict (QA Q1).
	assert.match(verdict.detail, /stray\.py was added/);
	const rebuilt = await prepareManagedPython(opts, install);
	assert.equal(
		state.installs,
		2,
		"the retry arm must run rather than refuse forever",
	);
	assert.notEqual(rebuilt.runtime, first.runtime);
	assert.notEqual(rebuilt.venv, first.venv);
	// Nothing was overwritten: the changed generation is still exactly there.
	assert.equal(
		readFileSync(join(first.runtime, "lib", "python3.12", "stray.py"), "utf8"),
		"changed out of band\n",
	);
	assert.equal(inspectManagedSelection(opts).kind, "ready");
});

test("a selected environment that was removed is rebuilt, and the runtime is reused", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, install, state, first } = await provisioned(t);
	rmSync(first.venv, { recursive: true, force: true });
	assert.equal(inspectManagedSelection(opts).kind, "missing");
	const rebuilt = await prepareManagedPython(opts, install);
	assert.equal(state.installs, 2);
	assert.equal(
		rebuilt.runtime,
		first.runtime,
		"an intact runtime of the same identity is a candidate, so the 47 MB copy is not repeated",
	);
	assert.notEqual(rebuilt.venv, first.venv);
});

/*
 * THE UPDATE HALF OF THIS MODULE, and the defect it exists for.
 *
 * What was wrong, in one line: readiness answered "a usable generation is
 * published", the app read that as "this environment is up to date", and the only
 * in-place upgrade it had ran `pip install --upgrade` inside the PUBLISHED venv -
 * the tree a serving daemon and every session runtime import from. On the
 * operator's own machine that has happened at least twice: the pointer's record
 * says 0.55.7 while the tree it names holds 0.56.8, which is why a control that
 * promised to move the environment produced a byte-identical screen on every press.
 *
 * So these pin what the publish path has to have - the new generation lands BESIDE
 * the published one, the pointer moves only after a smoke passes, and what it
 * supersedes is still there as the rollback - plus the readiness comparison that
 * makes "behind" a thing the app can see at all.
 */

/** One generation's own ordering, as the app's comparator answers it. */
const isNewer = (candidate, subject) => {
	const parts = (value) =>
		String(value)
			.split(".")
			.map((n) => Number(n) || 0);
	const [a, b] = [parts(candidate), parts(subject)];
	for (let i = 0; i < Math.max(a.length, b.length, 3); i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	}
	return false;
};

/**
 * The install stand-in for one generation, reporting `version`.
 *
 * The RUNTIME interpreter is passed through rather than a path inside the venv,
 * because `standInInstaller` writes the venv's `pyvenv.cfg` home from it and the
 * selection is only well formed when that home is the runtime's own `bin`.
 */
function installReporting(state, version) {
	return async (venv, python) => {
		state.installs++;
		standInInstaller(venv, python, version);
		return true;
	};
}

test("a ready environment that is behind the app's release is not up to date", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, first } = await provisioned(t);
	// The structural verdict is TRUE, and it is not the question an update asks.
	assert.equal(await managedSelectionReady(opts), true);
	assert.equal(publishedBackendVersion(opts), first.backendVersion);
	assert.equal(
		managedSelectionSatisfies(opts, "0.2.0", isNewer),
		false,
		"a generation prepared behind the release the app is offering is exactly what the old readiness answered 'nothing to do' for",
	);
	assert.equal(
		managedSelectionSatisfies(opts, first.backendVersion, isNewer),
		true,
	);
	assert.equal(
		managedSelectionSatisfies(opts, null, isNewer),
		true,
		"a target nobody could read is not a version to move to",
	);
});

test("an environment whose own version cannot be read is not treated as current", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, first } = await provisioned(t);
	// Both records, because `ready` is the pointer and the record agreeing byte for
	// byte - the shape `publishGeneration` itself writes.
	const blank = `${JSON.stringify({ ...first, backendVersion: "" })}\n`;
	writeFileSync(join(first.venv, "environment-ready.json"), blank);
	writeFileSync(
		join(managedPythonRoot(opts), "selected-environment.json"),
		blank,
	);
	assert.equal(publishedBackendVersion(opts), "");
	assert.equal(
		managedSelectionSatisfies(opts, "0.2.0", isNewer),
		false,
		"'its version could not be read' is not evidence that it is current",
	);
	const unknown = `${JSON.stringify({ ...first, backendVersion: "Unknown" })}\n`;
	writeFileSync(join(first.venv, "environment-ready.json"), unknown);
	writeFileSync(
		join(managedPythonRoot(opts), "selected-environment.json"),
		unknown,
	);
	assert.equal(
		managedSelectionSatisfies(opts, "0.2.0", isNewer),
		false,
		"and the app's own sentinel for an unread version is not a version either",
	);
});

test("an update publishes a new generation beside the published one, and keeps it as the rollback", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, first } = await provisioned(t);
	const stale = readFileSync(
		join(first.venv, "environment-ready.json"),
		"utf8",
	);
	const root = managedPythonRoot(opts);
	const state = { installs: 0 };
	const pointer = join(root, "selected-environment.json");
	/*
	 * THE FLIP, OBSERVED WHILE IT HAPPENS (review R1).
	 *
	 * The suite asserted only that no `.selection-*` temporary was left behind, and
	 * that assertion holds just as well for a direct in-place write: the reviewer
	 * mutated the flip to `writeFile(pointer, bytes)` and the whole file stayed green
	 * (30/30), including the case whose comment claims "the pointer moved by rename,
	 * so no half-written record is ever observed". A claim a mutation cannot break is
	 * a restatement of the implementation, and a torn pointer is not a cosmetic
	 * failure: it parses as `unprepared`, which the app answers by publishing a
	 * generation from scratch.
	 *
	 * Two readers, because they fail differently:
	 *
	 *  - a concurrent loop that reads the pointer for the whole publish and asserts
	 *    every observation parsed and named one of the two generations. It catches a
	 *    torn write whenever the two syscalls of an in-place write are separated by a
	 *    scheduling point - real, because Node's `writeFile` truncates and writes as
	 *    separate asynchronous requests, but not guaranteed on any single run.
	 *  - the pointer's INODE, which is the same file before and after an in-place
	 *    write and a DIFFERENT file after a rename. That one is deterministic, and it
	 *    is the part that fails every time against the mutation above.
	 */
	const inodeBefore = statSync(pointer).ino;
	const observed = { reads: 0, failures: [], venvs: new Set() };
	let flipping = true;
	const reader = (async () => {
		while (flipping) {
			observed.reads += 1;
			try {
				const record = JSON.parse(await readFile(pointer, "utf8"));
				observed.venvs.add(record.venv);
			} catch (error) {
				observed.failures.push(String(error));
			}
		}
	})();

	const outcome = await updateManagedPython(
		opts,
		installReporting(state, "0.2.0"),
		{ target: "0.2.0", isNewer },
	);
	flipping = false;
	await reader;

	assert.equal(state.installs, 1);
	assert.equal(outcome.replaced, true);
	assert.equal(outcome.selection.backendVersion, "0.2.0");
	assert.equal(
		outcome.previous?.venv,
		first.venv,
		"what it supersedes is named, which is what the caller reports and what a restart onto a bad build falls back to",
	);

	// A SECOND generation exists, and the pointer names it.
	assert.notEqual(outcome.selection.venv, first.venv);
	assert.equal(
		readdirSync(join(root, "environments")).length,
		2,
		"the new generation lands BESIDE the published one, never over it",
	);
	assert.deepEqual(readManagedSelection(opts), outcome.selection);
	assert.equal(inspectManagedSelection(opts).kind, "ready");
	assert.equal(publishedBackendVersion(opts), "0.2.0");

	// The pointer moved by rename, so no half-written record is ever observed: the
	// temporary file it is written through is gone by the time this returns.
	assert.deepEqual(
		readdirSync(root).filter((name) => name.startsWith(".selection-")),
		[],
		"the pointer is published atomically, so nothing may be left mid-write",
	);
	/*
	 * ...AND THE SAME CLAIM, DISCRIMINATED. The inode is the deterministic half:
	 * `rename` publishes the temporary file's inode, an in-place `writeFile` keeps
	 * the published file's own - so this assertion is what a non-atomic flip breaks,
	 * every time, and the mutation the reviewer ran is what it was checked against.
	 */
	assert.notEqual(
		statSync(pointer).ino,
		inodeBefore,
		"the pointer must be REPLACED by rename, not rewritten in place: a reader either sees the old record or the new one, and an in-place write is the case where it can see neither",
	);
	assert.ok(
		observed.reads > 0,
		"the reader must have run while the publish was in flight, or it asserts nothing",
	);
	assert.deepEqual(
		observed.failures,
		[],
		`a reader never sees a half-written pointer: ${JSON.stringify(observed.failures.slice(0, 2))}`,
	);
	assert.deepEqual(
		[...observed.venvs].filter(
			(venv) => venv !== first.venv && venv !== outcome.selection.venv,
		),
		[],
		`every observation names one of the two published generations, never a tree this publish did not make: ${JSON.stringify([...observed.venvs])}`,
	);

	// The superseded generation survives, complete, with its own record untouched -
	// that is the rollback, and a file a running process has open is never rewritten.
	assert.ok(
		existsSync(join(first.venv, "bin", "local-operator")),
		"the generation it supersedes is still a usable environment",
	);
	assert.equal(
		readFileSync(join(first.venv, "environment-ready.json"), "utf8"),
		stale,
		"and nothing wrote into it: it is the tree the serving daemon has open",
	);
});

test("an update that finds the published environment already at the target installs nothing", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, first } = await provisioned(t);
	const state = { installs: 0 };

	const outcome = await updateManagedPython(
		opts,
		installReporting(state, "0.2.0"),
		{ target: first.backendVersion, isNewer },
	);

	assert.equal(
		state.installs,
		0,
		"nothing is installed over a published generation that is already the release the app means to run",
	);
	assert.equal(outcome.replaced, false);
	assert.deepEqual(readManagedSelection(opts), first);
	assert.equal(
		readdirSync(join(managedPythonRoot(opts), "environments")).length,
		1,
	);
});

test("an install that does not complete leaves the pointer and the published generation untouched", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, first } = await provisioned(t);
	const state = { installs: 0 };
	const install = async () => {
		state.installs++;
		return false;
	};

	await assert.rejects(
		() => updateManagedPython(opts, install, { target: "0.2.0", isNewer }),
		/did not complete/,
	);
	assert.equal(state.installs, 1);
	assert.deepEqual(readManagedSelection(opts), first);
	assert.equal(publishedBackendVersion(opts), first.backendVersion);
	assert.ok(existsSync(join(first.venv, "bin", "local-operator")));
});

test("a generation that does not smoke leaves the pointer untouched", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, first } = await provisioned(t);
	const state = { installs: 0 };
	/*
	 * An environment that installs and will not start. `smokeEnvironment`'s first
	 * probe is an import check through the environment's own interpreter, so a shim
	 * that exits non-zero fails it at once rather than at the health deadline - which
	 * is why this case is a second rather than a minute.
	 */
	const install = async (venv, python) => {
		state.installs++;
		standInInstaller(venv, python, "0.2.0");
		writeFileSync(join(venv, "bin", "python"), "#!/bin/sh\nexit 3\n", {
			mode: 0o755,
		});
		return true;
	};

	await assert.rejects(() =>
		updateManagedPython(opts, install, { target: "0.2.0", isNewer }),
	);

	// The pointer never moved, so every process that was reading the published tree
	// is still on the generation it loaded - and it is still usable.
	assert.deepEqual(readManagedSelection(opts), first);
	assert.equal(publishedBackendVersion(opts), first.backendVersion);
	assert.equal(inspectManagedSelection(opts).kind, "ready");
	assert.ok(existsSync(join(first.venv, "bin", "local-operator")));
});

test("an update keeps the generation it supersedes even when a stray generation is newer", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, first } = await provisioned(t);
	/*
	 * A newer, unselected, half-written generation - exactly what a failed attempt
	 * leaves behind, because a failed publish does not delete the tree it created.
	 *
	 * The retention rule keeps "what the caller named, plus the newest generation
	 * that is not named". A caller that named only the runtime would therefore let
	 * this debris outrank the environment it had just superseded and delete the
	 * ROLLBACK - the tree a bad build has to fall back to, and the one a still-running
	 * daemon has open. So the update names both generations, and the assertions below
	 * are the difference between the two behaviours.
	 */
	const root = managedPythonRoot(opts);
	const stray = join(
		root,
		"environments",
		`${first.runtimeId}-44444444-4444-4444-8444-444444444444`,
	);
	mkdirSync(stray, { recursive: true });
	writeFileSync(
		join(stray, "half-written"),
		"a generation that never smoked\n",
	);
	const now = Date.now();
	utimesSync(first.venv, new Date(now - 600_000), new Date(now - 600_000));
	utimesSync(stray, new Date(now - 60_000), new Date(now - 60_000));
	assert.ok(
		statSync(stray).mtimeMs > statSync(first.venv).mtimeMs,
		"the stray must be newer than the published generation or this test asserts nothing",
	);

	const state = { installs: 0 };
	const outcome = await updateManagedPython(
		opts,
		installReporting(state, "0.2.0"),
		{ target: "0.2.0", isNewer },
	);

	assert.equal(outcome.replaced, true);
	assert.ok(
		existsSync(join(first.venv, "bin", "local-operator")),
		"the superseded generation survives as the rollback, even with newer debris beside it",
	);
	assert.equal(
		readManagedSelection(opts).venv,
		outcome.selection.venv,
		"and the pointer names the new generation rather than the debris",
	);
});

/*
 * The same repair in the one configuration the test above cannot see: TWO
 * generations, whose SELECTED one is the OLDER by mtime.
 *
 * Why that is not exotic, and why this test exists: `reapSupersededGenerations`'
 * retention rule is "the selected generation plus the most recently modified
 * other", and its first call site - the one that runs before the copy - passed no
 * `keep` at all, so its only survivor was the NEWEST generation in the root,
 * which is not necessarily the selected one. Any downgrade leaves exactly this
 * state, and so does any pair of generations copied from two different seeds. The
 * repair then deleted the runtime it was about to reuse, re-`ditto`ed the seed and
 * re-ran `verifyMachO` over every Mach-O in it - turning a state that needed no
 * copy into one that needs a 47 MB copy, on the disk-full path this change writes
 * user copy for, and losing the generation the round-1 remediation promises is
 * preserved (review round 2, N4). The fixture above passes either way because a
 * single generation is always the newest, which is how this survived the round
 * that introduced it.
 */
test("a selected runtime older than an unselected generation survives the repair, and is reused", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, install, state, first } = await provisioned(t);
	const other = join(
		managedPythonRoot(opts),
		"runtimes",
		`${"b".repeat(64)}-33333333-3333-4333-8333-333333333333`,
	);
	mkdirSync(other, { recursive: true });
	writeFileSync(join(other, "python3"), "a different seed's runtime\n");
	// Ordered explicitly rather than by how fast the fixture ran.
	const now = Date.now();
	utimesSync(first.runtime, new Date(now - 600_000), new Date(now - 600_000));
	utimesSync(other, new Date(now - 60_000), new Date(now - 60_000));
	assert.ok(
		statSync(first.runtime).mtimeMs < statSync(other).mtimeMs,
		"the selected generation must be the older one, or this test asserts nothing",
	);

	// Only the environment is gone: the runtime is intact, and is the tree to reuse.
	rmSync(first.venv, { recursive: true, force: true });
	const verdict = inspectManagedSelection(opts);
	assert.equal(verdict.kind, "missing");
	assert.equal(
		verdict.published?.runtime,
		first.runtime,
		"the verdict names what was published, which is what the reaper is told to keep",
	);

	const rebuilt = await prepareManagedPython(opts, install);
	assert.equal(state.installs, 2);
	assert.ok(
		existsSync(first.runtime),
		"the selected generation survives whatever its mtime says next to an unselected one",
	);
	assert.equal(
		rebuilt.runtime,
		first.runtime,
		"and it is REUSED rather than re-copied from the seed",
	);
	assert.notEqual(rebuilt.venv, first.venv);
});

/*
 * A volume with almost nothing left on it, which no assertion can reach without
 * one: `ditto` asks the filesystem rather than this code, and what is under test
 * is WHAT THE REAP FREED BEFORE THE COPY (QA round 3, Q1).
 *
 * The image is 16 MB and the fixture's seed is 4 MB against QA's real 120 MB
 * interpreter and 40 MB runtime; the conjunction is the same one at a scale the
 * suite can afford, and `freeBytes` is asserted in both tests rather than assumed,
 * because each one is vacuous if the volume still has room for the copy.
 */
function mountedVolume(t, megabytes = 16) {
	// Its own directory rather than `fixture`'s, because the cleanup has to detach
	// BEFORE it removes the tree: a mounted volume under a directory makes that
	// directory non-empty, and the two hooks would otherwise race.
	const root = mkdtempSync(join(tmpdir(), "lo-managed-python-volume-"));
	const image = join(root, "volume.dmg");
	const mount = join(root, "mnt");
	mkdirSync(mount, { recursive: true });
	const created = spawnRunner("/usr/bin/hdiutil", [
		"create",
		"-size",
		`${megabytes}m`,
		"-fs",
		"HFS+",
		"-volname",
		"lo-full-volume",
		"-quiet",
		image,
	]);
	assert.equal(
		created.status,
		0,
		`hdiutil could not create the volume: ${created.stdout}${created.stderr}`,
	);
	const attached = spawnRunner("/usr/bin/hdiutil", [
		"attach",
		"-quiet",
		"-nobrowse",
		"-mountpoint",
		mount,
		image,
	]);
	assert.equal(
		attached.status,
		0,
		`hdiutil could not attach the volume: ${attached.stdout}${attached.stderr}`,
	);
	// Detached by DEVICE where `hdiutil` named one, and removed only once the
	// volume is really gone: `-quiet` silences the device table, so the mount path
	// is the fallback here - it is this call's own name for the volume.
	const device = mountedDevice(attached.stdout, mount);
	t.after(() => removeVolumeTree(t, root, device ?? mount));
	return mount;
}

function freeBytes(path) {
	const stats = statfsSync(path);
	return stats.bavail * stats.bsize;
}

/** Remove the free space, keeping `reserve` for the writes a repair makes around
 * the copy (a venv's config, the records) - and keeping it BELOW the copy's size,
 * which is the whole point of the fixture's ballast. */
function fillVolume(mount, reserve = 256 * 1024) {
	const target = freeBytes(mount) - reserve;
	assert.ok(
		target > 0,
		`the volume has no space to take: ${freeBytes(mount)} bytes free`,
	);
	const filler = openSync(join(mount, "filler.bin"), "w");
	try {
		const chunk = Buffer.alloc(256 * 1024, 0x61);
		let written = 0;
		while (written < target) {
			const size = Math.min(chunk.length, target - written);
			writeSync(filler, chunk, 0, size);
			written += size;
		}
	} finally {
		closeSync(filler);
	}
}

const COPY_BYTES = 4 * 1024 * 1024;

/** A second runtime generation, newer than the published one and not selected.
 * The retention rule keeps the NEWEST generation of a root, so the published tree
 * is only reapable at all while something else is more recent - the shape QA's
 * fixture had, and the reason the pre-fix code could reclaim it. */
function plantNewerGeneration(opts, first) {
	const other = join(
		managedPythonRoot(opts),
		"runtimes",
		`${"b".repeat(64)}-55555555-5555-4555-8555-555555555555`,
	);
	mkdirSync(other, { recursive: true });
	writeFileSync(join(other, "python3"), "a different seed's runtime\n");
	const now = Date.now();
	utimesSync(first.runtime, new Date(now - 600_000), new Date(now - 600_000));
	utimesSync(other, new Date(now - 60_000), new Date(now - 60_000));
}

function provisioningHarness(t, support, { ballast = 0 } = {}) {
	const resources = fixture(t);
	const arch = MACHINE_ARTIFACT_ARCH;
	seedFixture(resources, arch, { ballast });
	const state = { installs: 0 };
	const install = async (venv, python) => {
		state.installs++;
		standInInstaller(venv, python);
		return true;
	};
	return { opts: { support, resources, packaged: true, arch }, state, install };
}

/*
 * QA round 3's FAIL, which the N4 fix introduced: the pre-copy reap protected the
 * published runtime UNCONDITIONALLY, so when that runtime was itself broken the
 * reap freed nothing, `ditto` had nowhere to put the copy, and every retry failed
 * the same way - a state the pre-fix code completed, because a keep-less reap
 * reclaimed the unusable tree. The published runtime belongs in the keep set only
 * while a repair can reuse it.
 */
test("a full disk with an identity-broken published runtime is repaired by reclaiming it", async (t) => {
	if (
		skipUnlessDarwin(
			t,
			`${MACOS_SEED_TOOLCHAIN}, and the full volume is a mounted image (hdiutil)`,
		)
	)
		return;
	const mount = mountedVolume(t);
	const { opts, state, install } = provisioningHarness(
		t,
		join(mount, "support"),
		{ ballast: COPY_BYTES },
	);
	const first = await prepareManagedPython(opts, install);
	plantNewerGeneration(opts, first);

	// Broken out of band, and given ballast so the space it holds is larger than
	// the copy that replaces it - the volume is sized so the copy cannot fit
	// without it.
	writeFileSync(
		join(first.runtime, "lib", "python3.12", "stray.py"),
		"changed out of band\n",
	);
	writeFileSync(
		join(first.runtime, "ballast.bin"),
		Buffer.alloc(COPY_BYTES, 0x63),
	);
	const broken = first.runtime;
	const verdict = inspectManagedSelection(opts);
	assert.equal(verdict.kind, "missing");
	assert.equal(
		verdict.published.runtime,
		broken,
		"the verdict names the tree the reap has to judge",
	);
	assert.match(verdict.detail, /no longer the runtime that was published/);

	fillVolume(mount);
	assert.ok(
		freeBytes(mount) < COPY_BYTES,
		`the volume must have less room than the copy needs, or this test proves nothing: ${freeBytes(mount)} bytes`,
	);

	const repaired = await prepareManagedPython(opts, install);
	assert.equal(state.installs, 2);
	assert.notEqual(
		repaired.runtime,
		broken,
		"an identity-broken runtime is not reusable, so the seed is copied",
	);
	assert.equal(
		existsSync(broken),
		false,
		"and reclaiming it is what made room - protecting it is the Q1 failure",
	);
	assert.equal(inspectManagedSelection(opts).kind, "ready");
});

/*
 * The other half of the same conjunction, and the win that must survive the fix:
 * an INTACT published runtime on a full volume repairs by reuse, with no copy at
 * all. The copy is what a full volume cannot fit, so this test distinguishes reuse
 * from a re-copy by measurement rather than by intent.
 */
test("a full disk with a reusable published runtime repairs by reuse, with no copy at all", async (t) => {
	if (
		skipUnlessDarwin(
			t,
			`${MACOS_SEED_TOOLCHAIN}, and the full volume is a mounted image (hdiutil)`,
		)
	)
		return;
	const mount = mountedVolume(t);
	const { opts, state, install } = provisioningHarness(
		t,
		join(mount, "support"),
		{ ballast: COPY_BYTES },
	);
	const first = await prepareManagedPython(opts, install);

	// The ordinary repair: the environment is gone, the runtime is intact.
	rmSync(first.venv, { recursive: true, force: true });
	assert.equal(inspectManagedSelection(opts).kind, "missing");
	fillVolume(mount);
	assert.ok(
		freeBytes(mount) < COPY_BYTES,
		`the volume must have less room than the copy needs, or this test proves nothing: ${freeBytes(mount)} bytes`,
	);

	const repaired = await prepareManagedPython(opts, install);
	assert.equal(state.installs, 2);
	assert.equal(
		repaired.runtime,
		first.runtime,
		"the published runtime is reusable, so the reap protects it",
	);
	assert.equal(
		readdirSync(runtimesRoot(opts)).filter((name) =>
			/^[a-f0-9]{64}-/.test(name),
		).length,
		1,
		"one generation, so no copy was made at all",
	);
	assert.equal(inspectManagedSelection(opts).kind, "ready");
});

test("a selected runtime that was removed is reprinted from the seed", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, install, state, first } = await provisioned(t);
	rmSync(first.runtime, { recursive: true, force: true });
	assert.equal(inspectManagedSelection(opts).kind, "missing");
	const rebuilt = await prepareManagedPython(opts, install);
	assert.equal(state.installs, 2);
	assert.notEqual(rebuilt.runtime, first.runtime);
	assert.equal(inspectManagedSelection(opts).kind, "ready");
});

test("a published selection whose runtime and environment are both gone is recoverable", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	const { opts, install, state, first } = await provisioned(t);
	rmSync(first.runtime, { recursive: true, force: true });
	rmSync(first.venv, { recursive: true, force: true });
	assert.equal(readManagedSelection(opts), null);
	assert.equal(inspectManagedSelection(opts).kind, "missing");
	const rebuilt = await prepareManagedPython(opts, install);
	assert.equal(state.installs, 2);
	assert.equal(inspectManagedSelection(opts).kind, "ready");
	assert.equal(rebuilt.backendVersion, "0.0.0-fixture");
});

test("a seed that carries bytecode still yields a selection that stays usable", async (t) => {
	if (skipUnlessDarwin(t, MACOS_SEED_TOOLCHAIN)) return;
	// QA Q1: the published id counted cache files while every later comparison
	// ignored them, so one stray `.pyc` in the seed - which the unpackaged path's
	// `resources/python_aarch64` acquires from any python run over it - made the
	// selection permanently unusable and blamed the runtime.
	const support = fixture(t);
	const resources = fixture(t);
	const arch = MACHINE_ARTIFACT_ARCH;
	seedFixture(resources, arch, { cache: true });
	const opts = { support, resources, packaged: true, arch };
	assert.equal(
		runtimeIdentity(join(resources, "python-runtime-seed", arch), arch),
		runtimeIdentity(join(resources, "python-runtime-seed", arch), arch),
	);
	let installs = 0;
	const install = async (venv, python) => {
		installs++;
		standInInstaller(venv, python);
		return true;
	};
	const first = await prepareManagedPython(opts, install);
	assert.equal(installs, 1);
	assert.equal(
		await managedSelectionReady(opts),
		true,
		"the second start must reuse it, not refuse it",
	);
	assert.equal(inspectManagedSelection(opts).kind, "ready");
	// And the same seed still reuses rather than re-provisioning.
	const second = await prepareManagedPython(opts, () => {
		throw new Error("Reuse must not reinstall");
	});
	assert.deepEqual(second, first);
	// A byte the seed really does sign still changes the identity.
	writeFileSync(
		join(
			resources,
			"python-runtime-seed",
			arch,
			"lib",
			"python3.12",
			"encodings",
			"__init__.py",
		),
		"changed\n",
	);
	assert.notEqual(
		runtimeIdentity(join(resources, "python-runtime-seed", arch), arch),
		first.runtimeId,
	);
});

test("the reaper removes abandoned staging and superseded generations, and nothing else", (t) => {
	const support = fixture(t);
	const opts = { support, resources: "", packaged: true, arch: "arm64" };
	const runtimes = join(managedPythonRoot(opts), "runtimes");
	const environments = join(managedPythonRoot(opts), "environments");
	mkdirSync(runtimes, { recursive: true });
	mkdirSync(environments, { recursive: true });
	const id = "a".repeat(64);
	const generation = (root, suffix) => {
		const path = join(root, `${id}-${suffix}`);
		mkdirSync(path, { recursive: true });
		return path;
	};
	const selectedRuntime = generation(runtimes, "11111111");
	const previousRuntime = generation(runtimes, "22222222");
	const olderRuntime = generation(runtimes, "33333333");
	const selectedVenv = generation(environments, "11111111");
	const previousVenv = generation(environments, "22222222");
	// Order by mtime explicitly: the retention rule is "the selected one plus the
	// most recent other one", never "whatever the directory order happened to be".
	const now = Date.now();
	const at = (path, secondsAgo) =>
		utimesSync(
			path,
			new Date(now - secondsAgo * 1000),
			new Date(now - secondsAgo * 1000),
		);
	at(selectedRuntime, 10);
	at(previousRuntime, 20);
	at(olderRuntime, 30);
	at(selectedVenv, 10);
	at(previousVenv, 20);
	// Not ours: an operator's or a future version's directory must survive.
	const foreignRuntime = join(runtimes, "keep-me");
	mkdirSync(foreignRuntime, { recursive: true });
	// An abandoned staging tree, and one that is young enough to be a live
	// preparation (this runs inside the lock, so only the old one is abandoned).
	const abandoned = join(runtimes, ".preparing-abandoned");
	mkdirSync(abandoned, { recursive: true });
	at(abandoned, 600);
	const live = join(runtimes, ".preparing-live");
	mkdirSync(live, { recursive: true });

	const removed = reapSupersededGenerations(
		opts,
		{ runtime: [selectedRuntime], venv: [selectedVenv] },
		now,
	);
	assert.deepEqual(removed.sort(), [abandoned, olderRuntime].sort());
	assert.ok(
		existsSync(selectedRuntime) && existsSync(selectedVenv),
		"the selected generation is never reaped",
	);
	assert.ok(
		existsSync(previousRuntime) && existsSync(previousVenv),
		"one previous generation survives the switch",
	);
	assert.ok(
		existsSync(live),
		"a staging tree young enough to belong to a live preparation is left alone",
	);
	assert.ok(
		existsSync(foreignRuntime),
		"a name this module did not write is never removed",
	);
	assert.deepEqual(
		readdirSync(runtimes).sort(),
		[".preparing-live", `${id}-11111111`, `${id}-22222222`, "keep-me"].sort(),
	);
});
