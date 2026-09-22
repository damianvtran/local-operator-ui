import assert from "node:assert/strict";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import {
	LAYOUT,
	PRUNED_SEED_OPTIONAL_PATHS,
	PRUNED_SEED_PATHS,
	PYTHON_ABI,
	PYTHON_BUILD_DATE,
	PYTHON_MINOR,
	PYTHON_VERSION,
	SEED_STDLIB_MARKER,
	SEED_TK_DIR,
	UV_NAMESPACE,
	UV_VERSION,
	uvBinaryName,
	uvResourceDir,
} from "./bundled-runtime-layout.mjs";

/*
 * The bundled-runtime definition, and the four things that have to read it
 * rather than spell it again.
 *
 * Why this file exists: every version and every resource name in this area is
 * spelled in more than one language - JSON, bash, PowerShell and TypeScript -
 * and the failures are all quiet. A Python refresh that reaches the definition
 * but not the staging script ships the previous patch release; a uv version
 * written into the workflow instead of read from the definition stages a binary
 * nobody pinned; a resource namespace that the packaging list and the app's
 * resolver disagree about produces an app that runs, starts, and silently
 * installs its backend with pip forever.
 *
 * What is real here: the shipped definition, the shipped scripts as text, and
 * the app's own resolver bundled from its TypeScript. What is NOT proved here:
 * that electron-builder honours the copies (that is a real packaged build) or
 * that the install scripts run (that is `install-scripts-check.yml` on a real
 * runner, plus the local end-to-end run recorded on the pull request).
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

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

/**
 * The app's own `uvToolPath`, bundled in memory from the shipped TypeScript.
 *
 * Why bundled rather than a second copy of the layout in this test: the question
 * is whether the APP resolves the directory the packaging list copies into, and
 * a reimplementation here would answer about itself.
 */
const appResolvers = await (async () => {
	const bundle = await build({
		stdin: {
			contents: 'export * from "./src/main/backend/uv-tool";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
})();

test("the Tcl/Tk token expands from the declaration, and the seed directory it names is required", () => {
	// Review R2-5: `{tkver}`'s only other consumer is an OPTIONAL prune entry
	// (`lib/tk{tkver}/demos`), whose absence is the accepted outcome - so the token
	// itself has to be tied to something the tree must have. That is
	// `SEED_TK_DIR`, and `pruneSeed` refuses a tree without it; this asserts the
	// expansion so a token left on the previous Tcl/Tk line fails before the prune
	// ever runs.
	assert.equal(SEED_TK_DIR, `lib/tk${LAYOUT.python.tkVersion}`);
	assert.match(SEED_TK_DIR, /^lib\/tk\d+\.\d+$/);
	assert.doesNotMatch(
		read("src/shared/bundled-runtime-layout.json"),
		/lib\/tk\d/,
		"the Tk version belongs behind the {tkver} token, not spelled in a path",
	);
	// The demos entry and the required directory must agree: an optional entry
	// under a different Tcl/Tk line than the one the seed is asserted to carry is
	// the no-op this binding exists to prevent.
	assert.ok(
		PRUNED_SEED_OPTIONAL_PATHS.every((path) => path.startsWith(SEED_TK_DIR)),
		`every optional Tcl/Tk entry must live under ${SEED_TK_DIR}`,
	);
});

test("no version-bearing path in the definition spells a Python minor", () => {
	// The token, not a literal `python3.12`: a prune list that names the previous
	// minor is a prune that silently does nothing after a refresh, and the release
	// gate's "the pruned paths are absent" assertion passes trivially for exactly
	// that tree.
	const definition = read("src/shared/bundled-runtime-layout.json");
	assert.doesNotMatch(
		definition,
		/python\d+\.\d+/,
		"a version-bearing path in the definition spells its Python minor; it belongs behind the {pyver} token",
	);
	for (const relative of [
		LAYOUT.python.seedStdlibMarker,
		...LAYOUT.python.prunedSeedPaths,
	]) {
		if (/python\{pyver\}|-?\{pyver\}/.test(relative)) continue;
		// `lib/tk8.6/demos` and `bin/pydoc3` carry no version, and that is correct:
		// the assertion is that anything which DOES carry one derives it.
		assert.doesNotMatch(relative, /python\d/, relative);
	}
	assert.ok(
		LAYOUT.python.prunedSeedPaths.some((path) => path.includes("{pyver}")),
		"the prune list must derive at least its stdlib paths from the version",
	);
});

test("the version-bearing paths expand to the declared release", () => {
	assert.equal(PYTHON_ABI, "3.12");
	assert.equal(
		SEED_STDLIB_MARKER,
		`lib/python${PYTHON_ABI}/encodings/__init__.py`,
	);
	for (const relative of PRUNED_SEED_PATHS) {
		assert.doesNotMatch(relative, /\{pyver\}/, relative);
		if (relative.startsWith("lib/python"))
			assert.match(relative, new RegExp(`^lib/python${PYTHON_ABI}\\b`));
	}
	// The build date is the other half of the download URL, so a refresh that
	// changes one without the other fetches a URL that does not exist - which
	// `--fail` turns into a build error rather than a staged error page.
	assert.match(PYTHON_BUILD_DATE, /^\d{8}$/);
	assert.match(PYTHON_VERSION, /^\d+\.\d+\.\d+$/);
});

test("the prune list names the files the tree actually has", () => {
	// The three spellings a standalone CPython tree uses, pinned to the real ones:
	// `bin/2to3-3.12` carries the whole `<major>.<minor>`, while `bin/idle3.12` and
	// `bin/pydoc3.12` carry only the minor after the tool's own name, and the stdlib
	// lives under `lib/python3.12`.
	//
	// WHY THIS IS A TEST AND NOT A COMMENT: one token for all three prunes NOTHING,
	// and it fails in the direction nobody sees. Measured on the first version of
	// this change: `bin/idle3.{pyver}` expanded to `bin/idle3.3.12`, which no tree
	// has, so the prune removed 8 of the 10 files it names and the release gate's
	// "the pruned paths are absent" assertion passed for the two that stayed - the
	// exact silent outcome the `{pyver}` token exists to prevent.
	for (const expected of [
		`bin/2to3-${PYTHON_ABI}`,
		`bin/idle3.${PYTHON_MINOR}`,
		`bin/pydoc3.${PYTHON_MINOR}`,
		`lib/python${PYTHON_ABI}/idlelib`,
		`lib/python${PYTHON_ABI}/turtledemo`,
		`lib/python${PYTHON_ABI}/pydoc_data`,
	])
		assert.ok(
			PRUNED_SEED_PATHS.includes(expected),
			`the prune list must name ${expected}; a path derived with the wrong token matches nothing and prunes nothing`,
		);
});

test("the staging script takes its versions and its staging names from the definition", () => {
	const script = read("scripts/setup-python-resource.sh");
	for (const selector of [
		"read_layout '.python.version'",
		"read_layout '.python.buildDate'",
		"read_layout '.uv.version'",
		"read_layout '.python.checkoutSeedNames.arm64'",
		"read_layout '.uv.checkoutNames.arm64'",
	])
		assert.ok(
			script.includes(selector),
			`setup-python-resource.sh must read ${selector} from the definition rather than spelling it`,
		);
	// A version spelled in the script is the copy that goes stale, which is the
	// whole reason the definition exists.
	assert.doesNotMatch(script, /PYTHON_VERSION="[0-9]/);
	assert.doesNotMatch(script, /UV_VERSION="[0-9]/);
	assert.doesNotMatch(script, /\$\{RESOURCES_DIR\}\/uv/);
});

test("the staging script stages both uv triples from the pinned release", () => {
	const script = read("scripts/setup-python-resource.sh");
	assert.ok(
		script.includes(
			'UV_RELEASE_BASE_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}"',
		),
		"the uv URL must be built from the pinned version, never `latest`",
	);
	for (const triple of ["x86_64-apple-darwin", "aarch64-apple-darwin"])
		assert.ok(
			script.includes("setup_uv_arch") && script.includes(triple),
			`the ${triple} release must be staged`,
		);
	// The checksum is what makes the pin the bytes rather than the URL.
	assert.ok(script.includes(".sha256"), "the published sha256 must be fetched");
	assert.ok(
		script.includes("sha256_of") && script.includes("ACTUAL_SHA"),
		"the staged archive must be checked against its published sha256",
	);
	// `uvx` is a tool runner this app never invokes, and it is a third of the
	// archive: it must not be copied into the staged tree.
	assert.doesNotMatch(
		script,
		/cp .*uvx|"uvx"/,
		"only `uv` is staged; `uvx` is not needed and app size is a download every user pays",
	);
	// A download with no bound hangs the build; with no `--fail` a 404 writes its
	// error page into the tree as if it were the artifact.
	assert.match(script, /curl --fail --location/);
	assert.match(script, /--max-time/);
});

test("each install script installs with uv and keeps the pip path it had", () => {
	const scripts = [
		"src/main/backend/scripts/macos-install-script.sh",
		"src/main/backend/scripts/linux-install-script.sh",
		"src/main/backend/scripts/windows-install-script.ps1",
	];
	for (const path of scripts) {
		const script = read(path);
		// The uv path, handed down by the app - never a uv found on PATH, which is
		// a version and a configuration nobody in this repository chose.
		assert.ok(script.includes("LOCAL_OPERATOR_UV_BIN"), `${path}: no uv input`);
		assert.ok(
			script.includes("pip install --python"),
			`${path}: no uv install`,
		);
		assert.ok(
			script.includes("--upgrade local-operator"),
			`${path}: the uv install must ask for the same upgrade pip was asked for`,
		);
		// The hardening: uv's own configuration and its interpreter downloads
		// cannot change what this install does, and its cache lives under the
		// app's own support directory.
		assert.ok(script.includes("UV_NO_CONFIG"), `${path}: no UV_NO_CONFIG`);
		assert.ok(
			script.includes("UV_PYTHON_DOWNLOADS"),
			`${path}: no UV_PYTHON_DOWNLOADS`,
		);
		assert.ok(script.includes("UV_CACHE_DIR"), `${path}: no UV_CACHE_DIR`);
		assert.ok(
			script.includes("UV_*"),
			`${path}: the caller's UV_* namespace must be dropped, not merged`,
		);
		// The fallback is the path that shipped until now, and it has to survive:
		// without it a build with no uv fails to install a backend at all.
		assert.ok(
			script.includes("python -m pip install --upgrade pip"),
			`${path}: the pip fallback lost its pip upgrade`,
		);
		assert.ok(
			script.indexOf("UV_") < script.indexOf("pip install --upgrade pip") ||
				script.indexOf("Uv") < script.indexOf("pip install --upgrade pip"),
			`${path}: the pip upgrade must sit on the fallback path, after the uv decision - the uv path skips it deliberately`,
		);
		// pip stays in the venv: the app's backend-update path runs
		// `pip install --upgrade local-operator` inside this environment, and
		// `uv venv` would produce one with no pip at all. Comments are stripped
		// first, because the scripts explain this choice by naming the command they
		// deliberately do not use.
		const commands = script
			.split("\n")
			.filter((line) => !line.trimStart().startsWith("#"))
			.join("\n");
		assert.match(
			commands,
			/-m venv/,
			`${path}: the venv must keep being created with the interpreter's own venv module`,
		);
		assert.doesNotMatch(
			commands,
			/\buv\s+venv\b/,
			`${path}: the venv must not be created with uv; it would carry no pip, which the app's backend-update path needs`,
		);
	}
});

test("the app resolves the directory the packaging lists copy into", () => {
	const config = JSON.parse(read("package.json")).build;
	const resources = tempDir("lo-uv-resolve-");
	const name = uvBinaryName("darwin");
	// The two directories the packaged app can carry, with a binary in each.
	// `uvToolPath` answers null only when NOTHING is there (`F_OK` + `isFile()`);
	// the mode is `ensureUvToolExecutable`'s question now, and it REPAIRS a
	// missing bit rather than treating the file as absent (review R1-1 changed
	// that contract - a reader who restores `X_OK` here reinstates the silent
	// absence that finding was about).
	for (const arch of LAYOUT.architectures) {
		mkdirSync(join(resources, uvResourceDir(arch)), { recursive: true });
		const binary = join(resources, uvResourceDir(arch), name);
		writeFileSync(binary, "#!/bin/sh\nexit 0\n", "utf8");
		chmodSync(binary, 0o755);
	}

	for (const arch of LAYOUT.architectures) {
		// Packaged: the namespace `extraResources` writes, for the architecture
		// that ships in that artifact.
		const packaged = appResolvers.uvToolPath({
			resources,
			packaged: true,
			arch,
			platform: "darwin",
		});
		assert.equal(packaged, join(resources, uvResourceDir(arch), name));
		const macTargets = (config.mac.extraResources ?? []).map(
			(entry) => entry.to,
		);
		assert.ok(
			macTargets.includes(uvResourceDir(arch)),
			`build.mac.extraResources has no entry writing ${uvResourceDir(arch)}`,
		);
		// macOS ONLY, and that is the R1-3 correction: `setup-python-resource.sh`
		// stages the two `*-apple-darwin` triples and `publish.yml` runs it in
		// `build-macos` alone, so a win/linux entry naming these trees would ship
		// ~74 MB of macOS Mach-O into an artifact whose only use for it is an `exec
		// format error` and a pip fallback - when a dev's checkout had staged them.
		for (const scope of ["win", "linux"])
			assert.deepEqual(
				(config[scope].extraResources ?? []).filter((entry) =>
					String(entry.to).startsWith(UV_NAMESPACE),
				),
				[],
				`build.${scope}.extraResources must name no uv: nothing stages a ${scope} uv, and the copy lists are not architecture-aware`,
			);

		// Dev: the staged checkout directory, by the name the staging script reads
		// from the same definition.
		const checkout = LAYOUT.uv.checkoutNames[arch];
		mkdirSync(join(resources, checkout), { recursive: true });
		writeFileSync(
			join(resources, checkout, name),
			"#!/bin/sh\nexit 0\n",
			"utf8",
		);
		chmodSync(join(resources, checkout, name), 0o755);
		assert.equal(
			appResolvers.uvToolPath({
				resources,
				packaged: false,
				arch,
				platform: "darwin",
			}),
			join(resources, checkout, name),
		);
		const macSources = (config.mac.extraResources ?? []).map(
			(entry) => entry.from,
		);
		assert.ok(
			macSources.includes(`resources/${checkout}`),
			`the mac packaging list must copy resources/${checkout}, the tree the staging script writes and a dev instance resolves`,
		);
	}

	// And the absence case, which is what every artifact built before this change
	// looks like: no file, no path, and the install script falls back to pip.
	assert.equal(
		appResolvers.uvToolPath({
			resources: join(resources, "nothing-here"),
			packaged: true,
			arch: "arm64",
			platform: "darwin",
		}),
		null,
	);
});

test("a bundled uv that lost its execute bit is repaired at runtime", () => {
	// Review R1-1. The build sets the mode and the release gate asserts it, and
	// NEITHER covers the bundle that arrives by update: a ZIP drops modes, and
	// codesign's seal does not cover them, so a 0644 uv passes every signature
	// check. The install script's `[ -x ]` probe then fails, prints one WARNING and
	// installs with pip - the feature silently off for every update-installed user.
	// The console's own spawn-helper is repaired for exactly this reason; this is
	// the second file the app execs out of its own bundle.
	const resources = tempDir("lo-uv-mode-");
	const name = uvBinaryName("darwin");
	const binary = join(resources, uvResourceDir("arm64"), name);
	mkdirSync(join(resources, uvResourceDir("arm64")), { recursive: true });
	writeFileSync(binary, "#!/bin/sh\nexit 0\n");
	const options = {
		resources,
		packaged: true,
		arch: "arm64",
		platform: "darwin",
	};

	// The ordinary case: the mode survived, and nothing is touched.
	chmodSync(binary, 0o755);
	const intact = appResolvers.ensureUvToolExecutable(options);
	assert.equal(intact.healed, false);
	assert.equal(intact.mode, 0o755);
	assert.equal(intact.path, binary);

	// The bundle that arrived by update.
	chmodSync(binary, 0o644);
	const healed = appResolvers.ensureUvToolExecutable(options);
	assert.equal(healed.healed, true);
	assert.equal(healed.path, binary);
	assert.equal(
		statSync(binary).mode & 0o777,
		0o755,
		"the repair has to be on disk, not a claim in the return value",
	);
	// A second call is a no-op, because the mode is now there.
	assert.equal(appResolvers.ensureUvToolExecutable(options).healed, false);

	// No uv staged at all: no path, and the reason names which absence it is
	// rather than reporting a repair it did not make.
	const absent = appResolvers.ensureUvToolExecutable({
		...options,
		resources: join(resources, "nothing-here"),
	});
	assert.equal(absent.path, null);
	assert.equal(absent.healed, false);
	assert.match(absent.reason, /no bundled uv is staged/);
});

test("the pinned uv release is named once, in the definition", () => {
	const sources = [
		"scripts/setup-python-resource.sh",
		"scripts/verify-macos-artifacts.mjs",
		"src/main/backend/uv-tool.ts",
		".github/workflows/install-scripts-check.yml",
	];
	for (const path of sources) {
		const text = read(path);
		assert.ok(
			!text.includes(UV_VERSION),
			`${path} spells the pinned uv version (${UV_VERSION}); read it from src/shared/bundled-runtime-layout.json`,
		);
	}
	assert.equal(UV_NAMESPACE, "uv");
});
