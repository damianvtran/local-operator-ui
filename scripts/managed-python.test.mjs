import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { artifactArch, privatePythonSeedCheck, finalContainerChecks, finalMetadataChecks } from "./python-artifact-layout.mjs";
import { bundledPythonCheck, spawnRunner } from "./verify-macos-artifacts.mjs";

const result = await build({ stdin: { contents: 'export * from "./src/main/backend/managed-python";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false });
const runtime = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const { runtimeManifest, runtimeId, readManagedSelection, managedPythonRoot, isLegacyManagedCommand } = runtime;
function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "lo-managed-python-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}
function options(support, packaged = true) { return { support, resources: "", packaged, arch: "arm64" }; }

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
	writeFileSync(join(root, "bin", "python3.12"), "changed signed fixture bytes");
	assert.notEqual(runtimeId(runtimeManifest(root, "arm64")), executable);
});

test("new external caches are harmless but signed source modifications still fail identity", (t) => {
	const root = fixture(t);
	writeFileSync(join(root, "stdlib.py"), "pass\n");
	const expected = runtimeId(runtimeManifest(root, "arm64"));
	mkdirSync(join(root, "__pycache__"));
	writeFileSync(join(root, "__pycache__", "stdlib.cpython-312.pyc"), "new cache");
	assert.equal(runtimeId(runtimeManifest(root, "arm64", true)), expected);
	writeFileSync(join(root, "stdlib.py"), "modified\n");
	assert.notEqual(runtimeId(runtimeManifest(root, "arm64", true)), expected);
});

test("external branding aliases preserve readiness but modified immutable bytes do not", (t) => {
	const root = fixture(t);
	const tree = join(root, "runtime"); mkdirSync(tree);
	const binary = join(tree, "python"); writeFileSync(binary, "signed binary bytes");
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
	const tree = join(root, "tree"); mkdirSync(tree);
	writeFileSync(join(root, "outside"), "user data");
	symlinkSync("../outside", join(tree, "escape"));
	assert.throws(() => runtimeManifest(tree, "arm64"), /escapes/);
	rmSync(join(tree, "escape"));
	linkSync(join(root, "outside"), join(tree, "hardlink"));
	assert.throws(() => runtimeManifest(tree, "arm64"), /hardlink/);
	assert.throws(() => runtimeManifest(tree, "universal"), /Unsupported/);
	assert.equal(readFileSync(join(root, "outside"), "utf8"), "user data");
});

test("packaged/dev selections are disjoint and missing readiness never adopts an executable", (t) => {
	const support = fixture(t);
	assert.notEqual(managedPythonRoot(options(support)), managedPythonRoot(options(support, false)));
	assert.equal(readManagedSelection(options(support)), null);
	const root = managedPythonRoot(options(support)); mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "selected-environment.json"), JSON.stringify({ format: 1, runtimeId: "a".repeat(64), runtime: "/tmp/not-owned", venv: "/tmp/not-owned", backendVersion: "0" }));
	assert.throws(() => readManagedSelection(options(support)), /Invalid managed/);
	assert.equal(readManagedSelection(options(support, false)), null);
	assert.throws(() => managedPythonRoot(options(join(support, "Unsafe.app", "state"))), /outside every/);
});

test("legacy PATH launchers and shebang aliases cannot bypass migration", (t) => {
	const support = fixture(t);
	const command = join(support, "alias");
	writeFileSync(command, `#!${support}/local-operator-venv/bin/python\nprint('legacy')\n`);
	assert.equal(isLegacyManagedCommand(command, support), true);
	writeFileSync(command, "#!/usr/bin/python3\nprint('independent')\n");
	assert.equal(isLegacyManagedCommand(command, support), false);
	assert.equal(isLegacyManagedCommand(join(support, "local-operator-venv", "bin", "local-operator"), support), true);
});

test("final app gate rejects legacy aliases even if they are dangling", (t) => {
	const scratch = fixture(t);
	const app = join(scratch, "Candidate.app");
	const resources = join(app, "Contents", "Resources");
	const seed = join(resources, "python-runtime-seed", "arm64");
	mkdirSync(join(seed, "bin"), { recursive: true });
	mkdirSync(join(seed, "lib", "python3.12", "encodings"), { recursive: true });
	writeFileSync(join(seed, "bin", "python3"), "fixture");
	writeFileSync(join(seed, "lib", "python3.12", "encodings", "__init__.py"), "pass");
	assert.equal(privatePythonSeedCheck(app).passed, true);
	symlinkSync("/missing-legacy-python", join(resources, "python_aarch64"));
	const rejected = privatePythonSeedCheck(app);
	assert.equal(rejected.passed, false);
	assert.match(rejected.output, /Legacy/);
});

test("metadata validation refuses bytes changed after release metadata was generated", (t) => {
	const root = fixture(t);
	writeFileSync(join(root, "candidate.zip"), "final delivered bytes");
	writeFileSync(join(root, "latest-mac.yml"), "version: 1.0.0\nfiles:\n  - url: candidate.zip\n    sha512: invalid\n    size: 21\n");
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
const SOURCE_ARCHS = spawnRunner("/usr/bin/lipo", ["-archs", "/usr/bin/true"]).stdout.trim().split(/\s+/);
const MACHINE_LIPO_ARCH = ["arm64", "x86_64"].find((arch) => SOURCE_ARCHS.includes(arch)) ?? SOURCE_ARCHS[0];
/** The artifact filename spelling (`mac.artifactName`) of that architecture. */
const MACHINE_ARTIFACT_ARCH = MACHINE_LIPO_ARCH === "arm64" ? "arm64" : "x64";
const OTHER_ARTIFACT_ARCH = MACHINE_ARTIFACT_ARCH === "arm64" ? "x64" : "arm64";

/** One architecture of `/usr/bin/true`, written where the framework binary goes. */
function thinFrameworkBinary(destination) {
	const result = spawnRunner("/usr/bin/lipo", ["-thin", MACHINE_LIPO_ARCH, "-output", destination, "/usr/bin/true"]);
	assert.equal(result.status, 0, `lipo could not thin the fixture binary: ${result.stdout}${result.stderr}`);
	assert.equal(spawnRunner("/usr/bin/lipo", ["-archs", destination]).stdout.trim(), MACHINE_LIPO_ARCH);
}

/**
 * A synthetic app bundle carrying a REAL, single-architecture Mach-O where the
 * framework binary is, so `bundleArchitectures` answers about this fixture
 * rather than about a stub. `seedArch` chooses which interpreter directory it
 * carries, which is how a bundle that ships the OTHER architecture's complete,
 * correct seed becomes expressible.
 */
function appBundle(root, { name = "Local Operator.app", seedArch = MACHINE_ARTIFACT_ARCH, legacyAlias = null } = {}) {
	const app = join(root, name);
	const resources = join(app, "Contents", "Resources");
	const framework = join(app, "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A");
	mkdirSync(framework, { recursive: true });
	thinFrameworkBinary(join(framework, "Electron Framework"));
	const seed = join(resources, "python-runtime-seed", seedArch);
	mkdirSync(join(seed, "bin"), { recursive: true });
	mkdirSync(join(seed, "lib", "python3.12", "encodings"), { recursive: true });
	writeFileSync(join(seed, "bin", "python3"), "fixture");
	writeFileSync(join(seed, "lib", "python3.12", "encodings", "__init__.py"), "pass");
	if (legacyAlias) symlinkSync("/missing-legacy-python", join(resources, legacyAlias));
	return app;
}

/** The app checks a container's extracted bundle is held to, as the gate wires them. */
function containerAppChecks(app, arch) {
	return [bundledPythonCheck(app, { expectArch: arch }), privatePythonSeedCheck(app, { expectArch: arch })];
}

/** Zip an app the way electron-builder does, with the bundle at the archive root. */
function zipApp(app, destination) {
	const result = spawnRunner("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, destination]);
	assert.equal(result.status, 0, `ditto could not build the fixture zip: ${result.stdout}${result.stderr}`);
	return destination;
}

/** Run the container checks over one real archive, as `verify-macos-artifacts` does. */
function containerResults(archive) {
	return finalContainerChecks(archive, { run: spawnRunner, checkApp: containerAppChecks });
}

function failures(results) {
	return results.filter((result) => !result.passed).map((result) => `${result.id}: ${result.output}`);
}

test("a container's filename architecture is cross-checked against the app inside it", (t) => {
	const scratch = fixture(t);
	const app = appBundle(scratch);
	assert.equal(artifactArch(`/tmp/local-operator-ui-0.0.0-${MACHINE_ARTIFACT_ARCH}.zip`), MACHINE_ARTIFACT_ARCH);
	assert.equal(artifactArch(`/tmp/local-operator-ui-0.0.0-${MACHINE_ARTIFACT_ARCH}.dmg`), MACHINE_ARTIFACT_ARCH);
	assert.equal(artifactArch("/tmp/Local Operator.app"), null, "an unpacked app claims no architecture");
	const matched = containerResults(zipApp(app, join(scratch, `local-operator-ui-0.0.0-${MACHINE_ARTIFACT_ARCH}.zip`)));
	assert.deepEqual(failures(matched), [], "a correctly named archive must pass; the checks below would mean nothing otherwise");
	// The same bytes under the other architecture's name: the failure is invisible
	// inside the app, because an arm64 bundle named `-x64` extracts and launches on
	// the machine that built it - only the container's name knows it is wrong.
	const swapped = containerResults(zipApp(app, join(scratch, `local-operator-ui-0.0.0-${OTHER_ARTIFACT_ARCH}.zip`)));
	assert.match(failures(swapped).join("\n"), /names x64 but the app inside it is arm64|names arm64 but the app inside it is x86_64/);
	assert.match(failures(swapped).join("\n"), /names (x64|arm64) but ships the (arm64|x64) seed/);
});

test("the container gate refuses a legacy interpreter alias and a seed for the wrong architecture", (t) => {
	const scratch = fixture(t);
	const legacy = appBundle(join(scratch, "legacy"), { legacyAlias: "python_aarch64" });
	const refused = containerResults(zipApp(legacy, join(scratch, "local-operator-ui-0.0.0-arm64.zip")));
	assert.ok(failures(refused).some((line) => /Legacy Python resource or alias exists: python_aarch64/.test(line)), failures(refused).join("\n"));
	// A complete, valid seed for the OTHER architecture passes every check that
	// only reads the seed, which is why the filename has to travel this far.
	const wrongSeed = appBundle(join(scratch, "wrong-seed"), { seedArch: OTHER_ARTIFACT_ARCH });
	const wrongSeedResults = containerResults(zipApp(wrongSeed, join(scratch, `local-operator-ui-0.0.0-${MACHINE_ARTIFACT_ARCH}.zip`)));
	assert.ok(failures(wrongSeedResults).some((line) => /ships the (arm64|x64) seed/.test(line)), failures(wrongSeedResults).join("\n"));
});

test("the container gate names an archive with no application rather than passing", (t) => {
	const scratch = fixture(t);
	const empty = join(scratch, "empty");
	mkdirSync(empty, { recursive: true });
	writeFileSync(join(empty, "not-an-app.txt"), "nothing to check\n");
	const archive = join(scratch, `local-operator-ui-0.0.0-${MACHINE_ARTIFACT_ARCH}.zip`);
	assert.equal(spawnRunner("/usr/bin/ditto", ["-c", "-k", empty, archive]).status, 0);
	const results = containerResults(archive);
	assert.equal(results.length, 1);
	assert.equal(results[0].passed, false);
	assert.match(results[0].output, /Expected exactly one application/);
});

test("the disk image path is exercised by mounting the real image, not by assertion", (t) => {
	const scratch = fixture(t);
	const app = appBundle(scratch);
	const image = join(scratch, `local-operator-ui-0.0.0-${MACHINE_ARTIFACT_ARCH}.dmg`);
	const created = spawnRunner("/usr/bin/hdiutil", ["create", "-quiet", "-volname", "Local Operator", "-srcfolder", app, "-format", "UDZO", image]);
	assert.equal(created.status, 0, `hdiutil could not build the fixture image: ${created.stdout}${created.stderr}`);
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
	const run = (command, args, input) => { calls.push({ command, args, input }); return spawnRunner(command, args, input); };
	const results = finalContainerChecks(image, { run, checkApp: containerAppChecks });
	assert.deepEqual(failures(results), [], "the mounted image's app must pass the same checks the archive's app does");
	assert.ok(results.some((result) => result.target.includes(":: Local Operator.app")), "the checks must name the app copied out of the image");
	const attach = calls.find((call) => call.command === "/usr/bin/hdiutil" && call.args[0] === "attach");
	assert.ok(attach, "the image must be mounted, not read in place");
	assert.ok(attach.args.includes("-readonly") && attach.args.includes("-nobrowse"), "the mount is read-only and must not appear in anyone's Finder");
	assert.equal(attach.input, "Y\n", "the attach must answer the shipped image's license agreement, or the app inside it is never verified");
});
