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
	UV_ARCHIVE_EXTENSION,
	UV_NAMESPACE,
	UV_RELEASE_TRIPLES,
	UV_VERSION,
	uvArchiveMember,
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

/*
 * A PYTHON VERSION LITERAL, in the one shape a script PINS rather than mentions
 * (code review round 2, M-1): a quoted token that is the version and nothing
 * else. Prose that names the floor ("not a runnable Python 3.12+") is not a pin
 * and must stay writable - which is why the pattern anchors on the quote instead
 * of matching dotted numbers anywhere.
 */
const PYTHON_VERSION_TOKEN = /["']3\.\d[\w.]*["']/;

/*
 * AND THE THREE-PART LITERAL ANYWHERE, quoted or not (code review round 3,
 * N3-3): anchoring the pattern on the quote is what keeps the floor-mention prose
 * writable, and it is also what lost the pre-change scan's coverage of a bare
 * `3.14.7` written into code. This restores exactly that scan. The prose names a
 * two-part floor ("Python 3.12+"), which this cannot match by construction, and a
 * version glued to a word (`python3.14.7`) was never covered by the old scan
 * either - the realistic re-pin shapes are the assignment and the quoted token.
 */
const PYTHON_VERSION_BARE = /\b3\.\d+\.\d+\b/;

test("the Python-version guard catches every spelling of a pin", () => {
	/*
	 * The four forms a re-pin actually takes, mutation-checked here rather than in
	 * a reviewer's throwaway script: the three-part literal the old guard caught,
	 * and the two-part, wildcard and pre-release-part spellings it did not.
	 */
	for (const literal of ['"3.14.7"', '"3.14"', '"3.14.x"', '"3.14.7b1"'])
		assert.ok(
			PYTHON_VERSION_TOKEN.test(literal),
			`${literal} is a pin the guard must catch`,
		);
	/*
	 * And it stays quiet on what a script may legitimately carry: the floor as a
	 * tuple in a version probe, and the prose the shipped Windows script prints.
	 */
	for (const innocent of [
		"(3, 12)",
		"$PythonVersion = $env:LOCAL_OPERATOR_PYTHON_VERSION",
		'"WARNING: ... is not a runnable Python 3.12+; looking for another."',
	])
		assert.ok(!PYTHON_VERSION_TOKEN.test(innocent), `${innocent} is not a pin`);
	/*
	 * The bare scan's own cases (round 3, N3-3): a three-part literal in code is
	 * caught whether or not it is quoted, and the two shapes a script may keep
	 * using are not - the floor as a tuple, and the floor named in prose as a
	 * two-part version.
	 */
	for (const literal of [
		"3.14.7",
		"& $UvBin python install 3.14.7",
		"$v = 3.14.7",
	])
		assert.ok(PYTHON_VERSION_BARE.test(literal), `${literal} must be caught`);
	for (const innocent of ["(3, 12)", '"Python 3.12+ is available"'])
		assert.ok(!PYTHON_VERSION_BARE.test(innocent), `${innocent} is not a pin`);
});

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
	assert.equal(PYTHON_ABI, "3.14");
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
	// The spellings a standalone CPython tree uses, pinned to the real ones:
	// `bin/idle3.14` carries only the minor after the tool's own name while the
	// stdlib lives under `lib/python3.14`.
	//
	// WHY THIS IS A TEST AND NOT A COMMENT: one token for all three prunes NOTHING,
	// and it fails in the direction nobody sees. Measured on the first version of
	// this change: `bin/idle3.{pyver}` expanded to `bin/idle3.3.12`, which no tree
	// has, so the prune removed 8 of the 10 files it names and the release gate's
	// "the pruned paths are absent" assertion passed for the two that stayed - the
	// exact silent outcome the `{pyver}` token exists to prevent.
	//
	// NO 2to3 ENTRY IS EXPECTED any more, and its absence is asserted rather than
	// merely unlisted: CPython 3.13 removed both the `2to3` program and the
	// `lib2to3` module (whatsnew/3.13, cpython#104780), so the 3.14 tree has
	// `bin/2to3`, `bin/2to3-3.14` and `lib/python3.14/lib2to3` and none of them can
	// come back under a version this repository would pin. The three entries were
	// therefore DELETED from `prunedSeedPaths` rather than moved to
	// `prunedSeedPathsOptional`: a required entry must exist in the tree the
	// declared build produces (`pruneSeed` throws otherwise), and the optional list
	// is bound to the Tcl/Tk line by its own test below, which encodes what it is
	// for - content a build may ship under a versioned directory. A rollback to the
	// previous release is a revert of this change, which restores the three.
	for (const gone of [
		"bin/2to3",
		`bin/2to3-${PYTHON_ABI}`,
		`lib/python${PYTHON_ABI}/lib2to3`,
	])
		assert.ok(
			!PRUNED_SEED_PATHS.includes(gone),
			`${gone} was removed upstream before ${PYTHON_VERSION}; a required prune entry for it fails the build`,
		);
	for (const expected of [
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

test("the staging scripts stage every platform's uv triples from the pinned release", () => {
	const script = read("scripts/setup-python-resource.sh");
	const windowsScript = read("scripts/setup-python-resource.ps1");
	assert.ok(
		script.includes(
			'UV_RELEASE_BASE_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}"',
		),
		"the uv URL must be built from the pinned version, never `latest`",
	);
	// The Unix stager serves two platforms now, and which triple is staged is read
	// from the definition rather than spelled: a triple spelled here is one that
	// can disagree with the release it names.
	for (const selector of [
		'read_layout ".uv.releaseTriples.${LAYOUT_PLATFORM}.x64"',
		'read_layout ".uv.releaseTriples.${LAYOUT_PLATFORM}.arm64"',
	])
		assert.ok(
			script.includes(selector),
			`scripts/setup-python-resource.sh must read ${selector} rather than spell a triple`,
		);
	for (const spelled of ["x86_64-apple-darwin", "aarch64-apple-darwin"])
		assert.ok(
			!script.includes(`uv-${spelled}`),
			`scripts/setup-python-resource.sh must not spell the uv-${spelled} asset beside the definition`,
		);
	// And the definition carries all three platforms' triples, so the stagers'
	// reads have something to resolve.
	assert.deepEqual(Object.keys(LAYOUT.uv.releaseTriples).sort(), [
		"darwin",
		"linux",
		"win32",
	]);
	assert.deepEqual(Object.keys(LAYOUT.uv.releaseTriples.darwin).sort(), [
		"arm64",
		"x64",
	]);
	// The Windows stager is the same contract in PowerShell - both triples, read
	// from the definition, neither spelled beside it.
	assert.ok(
		windowsScript.includes("$Layout.uv.releaseTriples.$LayoutPlatform.x64") &&
			windowsScript.includes("$Layout.uv.releaseTriples.$LayoutPlatform.arm64"),
		"the Windows stager must read both triples from the definition",
	);
	for (const triple of ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"]) {
		assert.ok(
			!windowsScript.includes(`uv-${triple}`),
			`scripts/setup-python-resource.ps1 must not spell the uv-${triple} asset beside the definition`,
		);
		assert.ok(
			Object.values(LAYOUT.uv.releaseTriples.win32).includes(triple),
			`the definition must carry the ${triple} triple the Windows stager reads`,
		);
	}
	assert.ok(
		script.includes('read_layout ".uv.archiveExtension.${LAYOUT_PLATFORM}"'),
		"the Unix stager must read the archive extension from the definition: the tar and zip shapes differ",
	);
	assert.ok(
		script.includes('read_layout ".uv.archiveMember.${LAYOUT_PLATFORM}"') &&
			script.includes("UV_ARCHIVE_MEMBER//\\{triple\\}"),
		"the Unix stager must expand the archive member from the definition rather than assume the tar layout",
	);
	assert.ok(
		windowsScript.includes("Expand-Archive") &&
			windowsScript.includes("Get-FileHash") &&
			windowsScript.includes(".Replace('{triple}', $Triple)"),
		"the Windows stager must verify, extract and expand the member the same way",
	);
	// The checksum is what makes the pin the bytes rather than the URL, on both
	// scripts, and the published Windows zip is a different archive from the tar
	// releases - so both must fetch the digest beside their own asset.
	for (const [file, text] of [
		["scripts/setup-python-resource.sh", script],
		["scripts/setup-python-resource.ps1", windowsScript],
	]) {
		assert.ok(
			text.includes(".sha256"),
			`${file}: the published sha256 must be fetched`,
		);
		assert.ok(
			text.includes("ACTUAL_SHA") || text.includes("Get-FileHash"),
			`${file}: the staged archive must be checked against its published sha256`,
		);
	}
	// `uvx` is a tool runner this app never invokes, and it is a third of the
	// archive: it must not be copied into the staged tree - on either platform.
	assert.doesNotMatch(
		script,
		/cp .*uvx|"uvx"/,
		"only `uv` is staged; `uvx` is not needed and app size is a download every user pays",
	);
	assert.doesNotMatch(
		windowsScript,
		/Copy-Item .*uvx|"uvx"/,
		"only `uv.exe` is staged; `uvx.exe` is not needed and app size is a download every user pays",
	);
	// A download with no bound hangs the build; with no `--fail` a 404 writes its
	// error page into the tree as if it were the artifact.
	assert.match(script, /curl --fail --location/);
	assert.match(script, /--max-time/);
	assert.match(windowsScript, /--fail --location/);
	assert.match(windowsScript, /--max-time/);
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
			script.includes("-m pip install"),
			`${path}: the pip fallback is gone`,
		);
		/*
		 * AND IT NO LONGER UPGRADES PIP FIRST, nor runs `--verbose` (first-run
		 * onboarding, Q13). This assertion used to pin the opposite. The
		 * self-upgrade was a second resolve-and-download in front of the install
		 * that changed nothing (both creation paths already leave pip 24.2+), and
		 * removing it took the cold macOS fallback from 28.6 s to 25.0 s and the
		 * Linux one from 30.7 s to 27.0 s (measured 2026-10-08, empty caches).
		 */
		// Code lines only: the scripts' own comments name the removed command to
		// say why it is gone, and a comment is not an install.
		const code = script
			.split("\n")
			.filter((line) => !/^\s*#/.test(line))
			.join("\n");
		assert.ok(
			!code.includes("pip install --upgrade pip"),
			`${path}: the pip fallback upgrades pip again`,
		);
		assert.ok(
			!/pip install[^\n]*--verbose/.test(code),
			`${path}: the pip fallback is verbose again`,
		);
		/*
		 * THE INTERPRETER VERSION IS NOT SPELLED IN A SCRIPT (code review round 1,
		 * R5): the Windows script carried a literal `"3.14.7"` fallback, a second
		 * copy of this file's `python.version` that nothing compared against the
		 * layout and that only a hand-run reached. The app hands the version down
		 * (`LOCAL_OPERATOR_PYTHON_VERSION`, read from the layout in
		 * `backend-installer.ts`), and the script now fails loudly without it.
		 */
		if (path.endsWith(".ps1")) {
			assert.ok(
				!PYTHON_VERSION_TOKEN.test(code),
				`${path}: a Python version literal is a second pin - pass LOCAL_OPERATOR_PYTHON_VERSION instead`,
			);
			assert.ok(
				!PYTHON_VERSION_BARE.test(code),
				`${path}: an unquoted Python version literal is a second pin too`,
			);
			/*
			 * AND EVERY ASSIGNMENT IS THE ENV READ, checked line by line (code
			 * review round 2, M-1): the old guard was a three-part dotted literal,
			 * so a re-pin written as `"3.14"`, `"3.14.x"` or `"3.14.7b1"` - or as a
			 * conditional whose fallback branch is a literal - passed it silently.
			 * A pin the script ACTS on is always this assignment, so requiring its
			 * right-hand side to be exactly the app's variable is the check that
			 * cannot be spelled around.
			 */
			for (const line of code.split("\n")) {
				const assignment = /^\s*\$PythonVersion\s*=\s*(.*?)\s*$/.exec(line);
				if (assignment === null) continue;
				assert.equal(
					assignment[1],
					"$env:LOCAL_OPERATOR_PYTHON_VERSION",
					`${path}: $PythonVersion must read the app's variable, not a literal`,
				);
			}
			assert.ok(
				code.includes("LOCAL_OPERATOR_PYTHON_VERSION"),
				`${path}: the version must come from the app`,
			);
		}
		/*
		 * pip stays in the venv: the app's backend-update path runs
		 * `pip install --upgrade local-operator` inside this environment, so BOTH
		 * creation paths have to leave a pip behind - and the claims to hold them to
		 * it are the ones this guard exists to pin.
		 *
		 * The comment that used to stand here stated the constraint backwards: the
		 * BARE `uv venv` is what produces an environment with no pip, while the
		 * SEEDED form (`uv venv --seed`) installs one - so a guard that passed on
		 * `uv_run venv --seed` by an underscore's width would have hidden the very
		 * change that made the comment false. What is forbidden is the UNSEEDED
		 * form, not uv itself (an earlier review round's finding 6). Comments are
		 * stripped first, because the scripts explain this choice by naming, in
		 * prose, the command they deliberately do not use.
		 */
		const commands = script
			.split("\n")
			.filter((line) => !line.trimStart().startsWith("#"))
			.join("\n");
		assert.match(
			commands,
			/-m venv/,
			`${path}: the venv must keep being created with the interpreter's own venv module`,
		);
		for (const line of commands.split("\n")) {
			if (!/\buv[_a-z]*\s+venv\b/.test(line)) continue;
			assert.match(
				line,
				/--seed/,
				`${path}: uv may create the environment only seeded (\`uv venv --seed\`); a bare \`uv venv\` produces one with no pip, which the app's backend-update path needs`,
			);
		}
		/*
		 * And each script has to hold the result: macOS and Linux check `bin/pip`
		 * after creation, and Windows - whose venv pip is reached as a module of the
		 * venv's own interpreter - runs `<venv>\\Scripts\\python.exe -m pip`, which the fallback
		 * assertion above pins to the pip path. A creation path that stopped leaving
		 * pip behind fails on its own line rather than passing on the other path's
		 * claim.
		 */
		const pipHeld = {
			"src/main/backend/scripts/macos-install-script.sh": /bin\/pip/,
			"src/main/backend/scripts/linux-install-script.sh": /bin\/pip/,
			/*
			 * The venv's own interpreter, by path, running pip (first-run onboarding,
			 * Q13): stricter than the bare `python -m pip` this used to accept, which
			 * resolved through PATH and so could install into whatever Python came
			 * first rather than proving the created environment holds pip.
			 */
			"src/main/backend/scripts/windows-install-script.ps1":
				/Scripts\\python\.exe" -m pip/,
		}[path];
		assert.ok(
			pipHeld,
			`${path}: no pip expectation is defined for this script`,
		);
		assert.match(
			commands,
			pipHeld,
			`${path}: nothing holds pip in the created environment, so a creation path that lost it would pass`,
		);
	}
});

test("the app resolves the directory the packaging lists copy into, on every platform", () => {
	const config = JSON.parse(read("package.json")).build;
	const resources = tempDir("lo-uv-resolve-");
	// Every (arch, platform) pair the app can ask about, with the binary name
	// that platform resolves staged under the directory the app looks in.
	// `uvToolPath` answers null only when NOTHING is there (`F_OK` + `isFile()`);
	// the mode is `ensureUvToolExecutable`'s question now, and it REPAIRS a
	// missing bit rather than treating the file as absent (review R1-1 changed
	// that contract - a reader who restores `X_OK` here reinstates the silent
	// absence that finding was about).
	for (const arch of LAYOUT.architectures)
		for (const platform of ["darwin", "linux", "win32"]) {
			mkdirSync(join(resources, uvResourceDir(arch)), { recursive: true });
			const binary = join(
				resources,
				uvResourceDir(arch),
				uvBinaryName(platform),
			);
			writeFileSync(binary, "#!/bin/sh\nexit 0\n", "utf8");
			chmodSync(binary, 0o755);
		}

	for (const arch of LAYOUT.architectures) {
		const checkout = LAYOUT.uv.checkoutNames[arch];
		for (const [platform, scope] of [
			["darwin", "mac"],
			["win32", "win"],
			["linux", "linux"],
		]) {
			// Packaged: the namespace `extraResources` writes, for the architecture
			// that ships in that artifact - the same resolution on all three
			// platforms now that each of them stages and ships its own release.
			assert.equal(
				appResolvers.uvToolPath({ resources, packaged: true, arch, platform }),
				join(resources, uvResourceDir(arch), uvBinaryName(platform)),
			);
			// And the packaging list that writes it: every platform's copy list
			// names both architecture directories, sourced from the checkout
			// directories the staging script writes.
			const targets = (config[scope].extraResources ?? []).map(
				(entry) => entry.to,
			);
			assert.ok(
				targets.includes(uvResourceDir(arch)),
				`build.${scope}.extraResources has no entry writing ${uvResourceDir(arch)}`,
			);
			const sources = (config[scope].extraResources ?? []).map(
				(entry) => entry.from,
			);
			assert.ok(
				sources.includes(`resources/${checkout}`),
				`build.${scope} must copy resources/${checkout}, the tree its own staging step writes`,
			);
		}

		// Dev: the staged checkout directory, by the name the platform's staging
		// script writes and the app resolves without packaging.
		for (const platform of ["darwin", "linux", "win32"]) {
			mkdirSync(join(resources, checkout), { recursive: true });
			writeFileSync(
				join(resources, checkout, uvBinaryName(platform)),
				"#!/bin/sh\nexit 0\n",
				"utf8",
			);
			chmodSync(join(resources, checkout, uvBinaryName(platform)), 0o755);
			assert.equal(
				appResolvers.uvToolPath({
					resources,
					packaged: false,
					arch,
					platform,
				}),
				join(resources, checkout, uvBinaryName(platform)),
			);
		}
	}

	// And the absence case, which is what an artifact built before its platform
	// shipped a uv looks like: no file, no path, and the install script falls
	// back to pip.
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

	// Windows has no execute bit: every file reports bits without OWNER_EXECUTE,
	// so the repair above would claim a heal on every install of a bundle that
	// was never broken. The call must hand back the path and claim nothing.
	const winResources = tempDir("lo-uv-mode-win-");
	const winBinary = join(
		winResources,
		uvResourceDir("x64"),
		uvBinaryName("win32"),
	);
	mkdirSync(join(winResources, uvResourceDir("x64")), { recursive: true });
	writeFileSync(winBinary, "MZ\n");
	const win = appResolvers.ensureUvToolExecutable({
		resources: winResources,
		packaged: true,
		arch: "x64",
		platform: "win32",
	});
	assert.equal(win.path, winBinary);
	assert.equal(win.healed, false);
	assert.equal(win.reason, null);

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

test("the archive members expand from the definition, per platform", () => {
	// The released archives are NOT one shape: the Unix releases nest the binary
	// under `uv-<triple>/`, while the Windows zip is flat. Two stagers expand the
	// same template, so the OUTCOME is pinned here rather than trusted to two
	// spellings - and the wrong shape extracts nothing, failing with an ENOENT
	// that names the archive rather than the assumption.
	assert.equal(
		uvArchiveMember("darwin", "aarch64-apple-darwin"),
		"uv-aarch64-apple-darwin/uv",
	);
	assert.equal(
		uvArchiveMember("linux", "x86_64-unknown-linux-gnu"),
		"uv-x86_64-unknown-linux-gnu/uv",
	);
	assert.equal(uvArchiveMember("win32", "x86_64-pc-windows-msvc"), "uv.exe");
	assert.throws(() => uvArchiveMember("freebsd", "x"), /No uv archive member/);
	// The extension beside it, and the triples the stagers read: a stager that
	// guessed `tar.gz` on Windows fails on the asset name, and a triple spelled
	// in two places can disagree.
	assert.deepEqual(UV_ARCHIVE_EXTENSION, {
		darwin: "tar.gz",
		linux: "tar.gz",
		win32: "zip",
	});
	assert.deepEqual(UV_RELEASE_TRIPLES.win32, {
		x64: "x86_64-pc-windows-msvc",
		arm64: "aarch64-pc-windows-msvc",
	});
	assert.deepEqual(UV_RELEASE_TRIPLES.linux, {
		x64: "x86_64-unknown-linux-gnu",
		arm64: "aarch64-unknown-linux-gnu",
	});
});

test("the pinned uv release is named once, in the definition", () => {
	const sources = [
		"scripts/setup-python-resource.sh",
		"scripts/setup-python-resource.ps1",
		"scripts/verify-bundled-uv.mjs",
		"scripts/verify-macos-artifacts.mjs",
		"src/main/backend/uv-tool.ts",
		".github/workflows/install-scripts-check.yml",
		".github/workflows/publish.yml",
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
