import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import afterPack from "./after-pack.mjs";
import { pythonResourcesDir, sealPackagedPythonTrees } from "./seal-python-resource.mjs";

/*
 * Coverage for the build step that ships the interpreter trees write-sealed.
 *
 * Why this exists: the seal used to be applied at runtime only, by the app, and
 * that is the hole this step closes. Measured on the operator's machine - the
 * `backend-installer.log` has `Bundled interpreter trees sealed ... 134
 * directory path(s) selected and now refusing new entries` at 08:37:24, 08:38:23,
 * 09:03:28 and 09:32:10, an in-app update replaced the bundle at 09:48, and
 * nothing after it - because every in-place update swaps in a fresh copy that
 * carries no access-control entries. The shipped 0.22.2 app, copied out of the
 * signed disk image, has a bare mode line on `Contents/Resources/python_aarch64`
 * and on `.../lib/python3.12`, and `touch` succeeds in both. A build that can
 * write into its own interpreter trees unseals itself on first use, which is the
 * state macOS reports as a damaged app.
 *
 * What is real: the shipped step, the shipped app module it seals through
 * (bundled in memory, exactly as the step bundles it), and real directories on a
 * real filesystem. What is substituted: the electron-builder context, which
 * cannot be produced without a build.
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
			// Ignore: the OS reclaims /tmp.
		}
	}
});

/** A packaged app on disk with the interpreter trees the build would copy in. */
function makeApp(name, { trees = ["python_aarch64"] } = {}) {
	const appOutDir = tempDir("lo-seal-pack-");
	const resources = pythonResourcesDir(appOutDir, name);
	for (const tree of trees) {
		// Two levels, because the field break landed in a directory three levels
		// down (`lib/python3.12`) rather than at the tree root: a seal that only
		// covered the root would reproduce the failure this step exists to prevent.
		mkdirSync(join(resources, tree, "lib", "python3.12"), { recursive: true });
		writeFileSync(
			join(resources, tree, "lib", "python3.12", "webbrowser.py"),
			"# stdlib source\n",
			"utf8",
		);
	}
	return { appOutDir, resources };
}

test("the build seals every directory under the trees it ships", async (t) => {
	if (process.platform !== "darwin") {
		t.skip("the seal is an access-control entry, which only macOS has");
		return;
	}
	const { appOutDir, resources } = makeApp("Local Operator");
	const seal = await sealPackagedPythonTrees({
		appOutDir,
		productFilename: "Local Operator",
		log: () => {},
	});
	assert.deepEqual(seal.sealed, [join(resources, "python_aarch64")]);
	assert.deepEqual(seal.failures, []);
	assert.equal(seal.supported, true);
	// The root, `lib` and `lib/python3.12`: the last of those is the directory the
	// field break landed in, so a seal that stopped at the root would be the bug
	// restated.
	assert.equal(seal.directories, 3);

	// Measured rather than inferred, and both halves of the write a CPython cache
	// performs: creating the `__pycache__` directory (add_subdirectory) and
	// creating the `.pyc` in it (add_file). The deepest directory is the one the
	// field break landed in.
	const deepest = join(resources, "python_aarch64", "lib", "python3.12");
	assert.throws(
		() => mkdirSync(join(deepest, "__pycache__")),
		{ code: "EACCES" },
		"a sealed tree must refuse a new directory",
	);
	assert.throws(
		() => writeFileSync(join(deepest, "webbrowser.cpython-312.pyc"), "x", "utf8"),
		{ code: "EACCES" },
		"a sealed tree must refuse a new file",
	);
});

test("a build with no interpreter tree to seal reports it and packs anyway", async (t) => {
	// The local packaging path: `pnpm exec electron-builder --dir --arm64` on a
	// checkout that has not run `pnpm setup-python`. There is nothing that could
	// write into anything, the artifact gate refuses the app that comes out
	// (`app-one-bundled-python`), and failing the build here would break a command
	// this repository's AGENTS.md documents.
	if (process.platform !== "darwin") {
		t.skip("macOS only: the build step is a no-op elsewhere");
		return;
	}
	const appOutDir = tempDir("lo-seal-empty-");
	mkdirSync(pythonResourcesDir(appOutDir, "Local Operator"), { recursive: true });
	const logs = [];
	const seal = await sealPackagedPythonTrees({
		appOutDir,
		productFilename: "Local Operator",
		log: (line) => logs.push(line),
	});
	assert.deepEqual(seal.sealed, []);
	assert.deepEqual(seal.failures, []);
	assert.match(logs.join("\n"), /Nothing to seal: no bundled interpreter tree/);
	assert.match(logs.join("\n"), /pnpm setup-python/);
	assert.match(logs.join("\n"), /app-one-bundled-python/);
});

test("off macOS the step says so and touches nothing", async () => {
	const logs = [];
	const seal = await sealPackagedPythonTrees({
		appOutDir: "/tmp/does-not-matter",
		productFilename: "Local Operator",
		platform: "linux",
		log: (line) => logs.push(line),
	});
	assert.equal(seal.supported, false);
	assert.deepEqual(seal.sealed, []);
	assert.match(logs.join("\n"), /Skipping the interpreter tree seal: not macOS \(linux\)/);
});

test("the afterPack hook prunes the other architecture first, then seals what survived", async (t) => {
	// The order is load-bearing in both directions: sealing a tree that is about
	// to be deleted is wasted work, and sealing after signing would be too late
	// for anything that changed.
	const { appOutDir, resources } = makeApp("Local Operator", {
		trees: ["python", "python_aarch64"],
	});
	const context = {
		appOutDir,
		// `builder-util`'s Arch enum for arm64, as a real build passes it.
		arch: 3,
		packager: { appInfo: { productFilename: "Local Operator" } },
		electronPlatformName: "darwin",
	};
	const result = await afterPack(context);
	assert.equal(existsSync(join(resources, "python")), false, "the x64 tree is pruned");
	assert.equal(
		existsSync(join(resources, "python_aarch64", "lib", "python3.12")),
		true,
		"and the arm64 tree is kept",
	);
	assert.deepEqual(result.pruned, [join(resources, "python")]);
	if (process.platform !== "darwin") {
		t.diagnostic("seal arm skipped: the access-control entry is macOS only");
		return;
	}
	assert.deepEqual(result.seal.sealed, [join(resources, "python_aarch64")]);
	assert.deepEqual(result.seal.failures, []);
	assert.equal(
		canCreateFile(join(resources, "python_aarch64", "lib", "python3.12")),
		false,
		"the tree that survived must refuse a new entry",
	);

	await assert.rejects(
		afterPack({ appOutDir, arch: 3, packager: {}, electronPlatformName: "darwin" }),
		/no packager\.appInfo\.productFilename/,
	);
});

/** True when a file could be created in `dir`, i.e. the seal is not there. */
function canCreateFile(dir) {
	try {
		const probe = join(dir, ".seal-test-probe");
		writeFileSync(probe, "x", "utf8");
		rmSync(probe, { force: true });
		return true;
	} catch (error) {
		if (error.code === "EACCES" || error.code === "EPERM") return false;
		throw error;
	}
}
