import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import afterPack, {
	PYTHON_RESOURCE_DIRS,
	archName,
	pythonResourcesDir,
	pruneUnshippedPythonResources,
} from "./prune-python-resource.mjs";
import seedAfterPack from "./after-pack.mjs";
import { LEGACY_RESOURCE_NAMES, seedResourceDir } from "./bundled-python-layout.mjs";

/*
 * Coverage for the `afterPack` step that keeps one bundled interpreter per
 * build.
 *
 * Why this file exists: the step is the only thing standing between a user and
 * ~47 MB of interpreter their machine cannot execute, and it fails in the
 * direction nothing notices - if it does nothing at all, the build succeeds,
 * the app runs, and the only symptom is a larger download. Every branch is
 * exercised here, including the two that must NOT remove anything.
 *
 * What is real: the shipped module, and real directories on a real filesystem.
 * What is substituted: nothing. The hook's whole job is filesystem effects, so
 * a fixture directory exercises the property rather than a model of it. What
 * the fixtures do not prove is that electron-builder passes the context this
 * module expects - only that context is resolved in a real release build, and
 * the `pnpm exec electron-builder --dir --arm64` evidence on the PR is where
 * that end is covered.
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

/** A packaged macOS app whose two interpreter trees each hold one real file. */
function makePackagedApp(dir, { trees = Object.values(PYTHON_RESOURCE_DIRS) } = {}) {
	const appOutDir = join(dir, "mac-arm64");
	const resources = join(appOutDir, "Local Operator.app", "Contents", "Resources");
	mkdirSync(resources, { recursive: true });
	for (const name of trees) {
		mkdirSync(join(resources, name, "lib", "python3.12"), { recursive: true });
		mkdirSync(join(resources, name, "bin"), { recursive: true });
		writeFileSync(join(resources, name, "bin", "python3"), "#!/bin/sh\n", "utf8");
		writeFileSync(
			join(resources, name, "lib", "python3.12", "os.py"),
			`# ${name}\n`,
			"utf8",
		);
	}
	return { appOutDir, resources };
}

test("an arm64 build ships only the aarch64 interpreter", () => {
	const { appOutDir, resources } = makePackagedApp(tempDir("lo-prune-"));

	const result = pruneUnshippedPythonResources({
		appOutDir,
		arch: "arm64",
		productFilename: "Local Operator",
		platform: "darwin",
		log: () => {},
	});

	assert.deepEqual(result.pruned, [join(resources, "python-runtime-seed/x64")]);
	assert.equal(existsSync(join(resources, "python-runtime-seed/x64")), false);
	assert.equal(existsSync(join(resources, "python-runtime-seed/arm64")), true);
	// The tree that stays is untouched, not rebuilt: the app's own probe reads
	// this directory at runtime, and pruning must not disturb what it finds.
	assert.deepEqual(readdirSync(join(resources, "python-runtime-seed/arm64", "lib", "python3.12")), [
		"os.py",
	]);
});

test("an x64 build ships only the x86_64 interpreter", () => {
	const { appOutDir, resources } = makePackagedApp(tempDir("lo-prune-"));

	const result = pruneUnshippedPythonResources({
		appOutDir,
		arch: "x64",
		productFilename: "Local Operator",
		platform: "darwin",
		log: () => {},
	});

	assert.deepEqual(result.pruned, [join(resources, "python-runtime-seed/arm64")]);
	assert.equal(existsSync(join(resources, "python-runtime-seed/arm64")), false);
	assert.equal(existsSync(join(resources, "python-runtime-seed/x64")), true);
});

test("a build that carries only its own interpreter is left alone", () => {
	const { appOutDir, resources } = makePackagedApp(tempDir("lo-prune-"), {
		trees: ["python-runtime-seed/arm64"],
	});

	const result = pruneUnshippedPythonResources({
		appOutDir,
		arch: "arm64",
		productFilename: "Local Operator",
		platform: "darwin",
		log: () => {},
	});

	assert.deepEqual(result.pruned, []);
	assert.equal(existsSync(join(resources, "python-runtime-seed/arm64")), true);
});

test("a non-macOS build is not touched", () => {
	// The two trees are mac standalone interpreters and only the macOS job
	// assembles them; leaving the other platforms' output identical is the
	// contract, so this branch removes nothing even when both trees exist.
	const dir = tempDir("lo-prune-win-");
	const appOutDir = join(dir, "win-unpacked");
	const resources = join(appOutDir, "resources");
	mkdirSync(join(resources, "python-runtime-seed/arm64"), { recursive: true });
	mkdirSync(join(resources, "python-runtime-seed/x64"), { recursive: true });

	const result = pruneUnshippedPythonResources({
		appOutDir,
		arch: "x64",
		productFilename: "Local Operator",
		platform: "win32",
		log: () => {},
	});

	assert.deepEqual(result.pruned, []);
	assert.equal(existsSync(join(resources, "python-runtime-seed/arm64")), true);
	assert.equal(existsSync(join(resources, "python-runtime-seed/x64")), true);
});

test("the numeric Arch enum an afterPack context carries is understood", () => {
	// Measured, not assumed: `--arm64` reaches the hook as `3`, the enum member
	// from builder-util, so a hook that only understood "arm64" failed the first
	// real build it saw.
	const { appOutDir, resources } = makePackagedApp(tempDir("lo-prune-"));

	const result = pruneUnshippedPythonResources({
		appOutDir,
		arch: 3,
		productFilename: "Local Operator",
		platform: "darwin",
		log: () => {},
	});

	assert.deepEqual(result.pruned, [join(resources, "python-runtime-seed/x64")]);
	assert.equal(existsSync(join(resources, "python-runtime-seed/arm64")), true);
});

test("an architecture with no bundled interpreter mapping fails loudly", () => {
	// Shipping both trees is otherwise a silent outcome, and so is deleting the
	// wrong one. A third architecture reaching this hook means `mac.target` and
	// PYTHON_RESOURCE_DIRS have diverged, which must stop the build.
	const { appOutDir, resources } = makePackagedApp(tempDir("lo-prune-"));
	assert.throws(
		() =>
			pruneUnshippedPythonResources({
				appOutDir,
				arch: "ia32",
				productFilename: "Local Operator",
				platform: "darwin",
				log: () => {},
			}),
		/Cannot prune bundled Python for arch "ia32"/,
	);
	// `universal` is the case that must never be quietly pruned: the same bundle
	// runs as either architecture on different machines.
	assert.throws(
		() =>
			pruneUnshippedPythonResources({
				appOutDir,
				arch: 4,
				productFilename: "Local Operator",
				platform: "darwin",
				log: () => {},
			}),
		/Cannot prune bundled Python for arch "universal"/,
	);
	assert.equal(existsSync(join(resources, "python-runtime-seed/x64")), true);
	assert.equal(existsSync(join(resources, "python-runtime-seed/arm64")), true);
});

test("the afterPack hook resolves the bundle from the packager context", async () => {
	const { appOutDir, resources } = makePackagedApp(tempDir("lo-prune-"));

	await afterPack({
		appOutDir,
		arch: "arm64",
		electronPlatformName: "darwin",
		packager: { appInfo: { productFilename: "Local Operator" } },
	});

	assert.equal(existsSync(join(resources, "python-runtime-seed/x64")), false);
	assert.equal(existsSync(join(resources, "python-runtime-seed/arm64")), true);
});

test("the hook refuses a context it cannot resolve a bundle from", async () => {
	await assert.rejects(
		async () => afterPack({ appOutDir: "/tmp", arch: "arm64", packager: {} }),
		/no packager\.appInfo\.productFilename/,
	);
});

test("the resources directory is the bundle's Contents/Resources on macOS only", () => {
	assert.equal(
		pythonResourcesDir({
			appOutDir: "/tmp/dist/mac-arm64",
			productFilename: "Local Operator",
			platform: "darwin",
		}),
		"/tmp/dist/mac-arm64/Local Operator.app/Contents/Resources",
	);
	assert.equal(
		pythonResourcesDir({
			appOutDir: "/tmp/dist/linux-unpacked",
			productFilename: "Local Operator",
			platform: "linux",
		}),
		"/tmp/dist/linux-unpacked/resources",
	);
});

test("the arch name is the one the app resolves its interpreter by", () => {
	assert.equal(archName(3), "arm64");
	assert.equal(archName(1), "x64");
	assert.equal(archName("arm64"), "arm64");
	// Unspellable values stay as they are rather than mapping to a nearby arch:
	// the caller refuses them against PYTHON_RESOURCE_DIRS.
	assert.equal(archName("mips"), "mips");
	assert.equal(archName(9), "9");
});

/*
 * The two halves a release nearly went out without, both of them in
 * `package.json` rather than in the modules above.
 *
 * Why these cases exist: the hook and the mapping were once correct together,
 * and a later merge of `main` dropped both from the config while every test in
 * this file stayed green - they drive the modules, not the thing that decides
 * whether the modules run. A build then carried a legacy tree and no seed at
 * all, which is exactly what `verify-macos-artifacts.mjs` refused on the v0.23.2
 * publish run. The gap is the config itself, so the config is what is asserted.
 */
test("the builder config stages the mac interpreters into the seed namespace", () => {
	const config = JSON.parse(
		readFileSync(join(process.cwd(), "package.json"), "utf8"),
	).build;
	assert.equal(
		config.afterPack,
		"scripts/after-pack.mjs",
		"the registered afterPack must be the hook that refuses a legacy alias, not the pruner alone",
	);
	// Every entry that applies to a macOS build, so a legacy name cannot come
	// back in through the top-level block instead of the `mac` one.
	const destinations = [];
	for (const scope of [config, config.mac]) {
		for (const entry of scope?.extraResources ?? []) destinations.push(entry.to);
	}
	assert.deepEqual(
		destinations.filter((to) => LEGACY_RESOURCE_NAMES.includes(to)),
		[],
		"a macOS-applicable extraResources entry may not write a legacy resource name: it ships beside the seed, and the gate and the hook both refuse it",
	);
	assert.deepEqual(
		(config.mac.extraResources ?? []).map((entry) => [entry.from, entry.to]),
		[
			["resources/python", seedResourceDir("x64")],
			["resources/python_aarch64", seedResourceDir("arm64")],
		],
		"the mac build copies each checkout tree into the seed directory its architecture resolves",
	);
});

test("the hook refuses a bundle that still carries a legacy alias, by name", async () => {
	const { appOutDir, resources } = makePackagedApp(tempDir("lo-alias-"), {
		trees: ["python_aarch64"],
	});
	await assert.rejects(
		async () =>
			seedAfterPack({
				appOutDir,
				arch: "arm64",
				electronPlatformName: "darwin",
				packager: { appInfo: { productFilename: "Local Operator" } },
			}),
		/legacy Python resource name\(s\): python_aarch64/,
		"the hook fails the build rather than warning: an incumbent venv naming the old path can reach the new bundle through an alias",
	);
	assert.equal(
		existsSync(join(resources, "python_aarch64")),
		true,
		"the hook does not delete the alias - the mapping is what has to stop producing it",
	);
});
