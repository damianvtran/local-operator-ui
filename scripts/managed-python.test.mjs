import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { privatePythonSeedCheck, finalMetadataChecks } from "./python-artifact-layout.mjs";

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
