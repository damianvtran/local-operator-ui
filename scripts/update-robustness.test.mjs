import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	rmdirSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

/**
 * Contract checks for the update path.
 *
 * Why these cases: the 0.17.0 auto-update quit the app and never brought it
 * back. Squirrel.Mac's ShipIt refused the *installed* bundle with
 * errSecCSBadBundleFormat (-67028, it was mid-replacement by a Finder copy),
 * `launchAfterInstallation` never ran, and no error reached the user. The
 * checks below are the ones whose absence produced that, and the DMG assertions
 * are the ones whose absence shipped an unsigned image (the "damaged and can't
 * be opened" report).
 *
 * The pure module is bundled in memory from the shipped TypeScript, the same way
 * `desktop-contract.test.mjs` uses the real transport, so these stay tests of
 * the code that ships rather than of a copy of it.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/update-install"; export * from "./src/main/server-update-copy";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const install = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);
const {
	INSTALL_DISK_SLACK_BYTES,
	LAUNCH_HOLD_END_MARGIN_SECONDS,
	PLIST_READ_TIMEOUT_SECONDS,
	PENDING_INSTALL_HANDOFF_SECONDS,
	PENDING_INSTALL_LAUNCH_HOLD_SECONDS,
	PENDING_INSTALL_MARKER_FILE,
	PENDING_INSTALL_RECENCY_MARGIN_SECONDS,
	PENDING_INSTALL_RECENCY_SECONDS,
	WATCHDOG_HARD_TIMEOUT_SECONDS,
	WATCHDOG_TOKEN,
	appBundleFromExecutable,
	buildPipUpgradeCommand,
	buildWatchdogPlan,
	classifyGlobalInstall,
	clearPendingInstallMarker,
	compareVersions,
	didUpgradeLand,
	evaluateBundleSeal,
	evaluateLaunchDuringInstall,
	evaluatePendingInstall,
	generationInstallRoot,
	healPythonBytecode,
	installFailurePayload,
	installInFlightPayload,
	installLaunchHoldNotice,
	installStartedText,
	installedBundleSealBlock,
	installLivenessNow,
	isInstallInFlight,
	isPythonBytecodePath,
	isSourceBuildRef,
	lastInstallAttemptPath,
	launchdJobPid,
	installJobState,
	matchArtifactMetadata,
	measureDirectoryBytes,
	parsePendingInstallMarker,
	parsePipShowVersion,
	serverUpdateFailureSentence,
	parseSealViolations,
	pendingInstallAgeSeconds,
	pendingInstallMarkerPath,
	planPythonBytecodeHeal,
	readLastInstallAttempt,
	readPendingInstallMarker,
	reapFailedInstall,
	reapStagedTree,
	recordInstallFailure,
	removeStagedTree,
	requiredDiskBytes,
	resolveDistributionMarkers,
	resolveGlobalInstallPlan,
	resolveStagedArtifactPath,
	shipItCacheDir,
	shipItJobLabel,
	verifyStagedArtifact,
	readInstallIdentity,
	resolveCommandPath,
	watchdogIsOurs,
	watchdogSignals,
	watchdogSwapTarget,
	writePendingInstallMarker,
} = install;

/**
 * The by-hand panel's clear rules, bundled from the shipped renderer module.
 *
 * Pure TypeScript with no React or DOM imports, so it runs here the way the
 * transcript reducer does. These rules decide whether a manual instruction stays
 * on screen, and both times they were wrong it was the rule rather than the
 * rendering: the panel could not clear after a successful upgrade (review U2),
 * and then could not clear at all on the machine this change was measured on
 * (review U12, round 3).
 */
const manualStateBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/components/common/update-manual-state";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	atLeastVersion,
	manualPanelClearedByAvailable,
	manualPanelClearedByCheck,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		manualStateBundle.outputFiles[0].text,
	).toString("base64")}`
);

const {
	dmgArtifacts,
	removeTransientZip,
	rewriteUpdateMetadata,
	updateUpdateYmlEntry,
} = await import("./notarize-artifacts.mjs");

/**
 * The disk image step's real code, bundled with the notarizer stubbed.
 *
 * The property this covers is the path the step hands the notarizer, and only a
 * stub can read it: the real `@electron/notarize` uploads to Apple, which no
 * developer machine and no CI runner can reach, so a wrong path there is a
 * failure that exists only in a release build. 0.17.2 shipped a relative one -
 * `@electron/notarize`'s `lib/notarytool.js` does `path.resolve(dir, opts.appPath)`
 * for a `.dmg`/`.pkg` with `dir` its own submission temp dir, so the image was
 * looked for inside that temp dir and the step reported "The file couldn't be
 * opened because it doesn't exist".
 *
 * Bundled rather than imported so the fixture can be substituted, the same
 * mechanic the Electron fixture below uses. Everything else in the bundle is the
 * shipped module: the discovery, the absolute-path resolution, the submit →
 * staple → re-hash → rewrite ordering, and the failure handling.
 */
const notarizeStepBundle = await build({
	stdin: {
		contents: 'export * from "./scripts/notarize-artifacts.mjs";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// `build-env.mjs` reaches dotenv, a CJS dependency esbuild cannot `require`
	// from ESM output without the shim the Electron fixture also carries.
	banner: {
		js: 'import { createRequire as __loCreateRequire } from "node:module"; const require = __loCreateRequire(import.meta.url);',
	},
	plugins: [
		{
			name: "notarize-fixture",
			setup(builder) {
				builder.onResolve({ filter: /^@electron\/notarize$/ }, () => ({
					path: "@electron/notarize",
					namespace: "notarize-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "notarize-fixture" }, () => ({
					loader: "js",
					contents: `
							export const notarize = async (opts) => {
								globalThis.__loNotarizeCalls.push({ appPath: opts.appPath, tool: opts.tool });
								const behavior = globalThis.__loNotarizeBehavior;
								if (behavior) await behavior(opts);
							};
						`,
				}));
			},
		},
	],
});
const notarizeStepDir = mkdtempSync(join(tmpdir(), "lo-notarize-step-"));
const notarizeStepFile = join(notarizeStepDir, "notarize-artifacts.mjs");
writeFileSync(notarizeStepFile, notarizeStepBundle.outputFiles[0].text);
// Imported from a real path rather than a `data:` URL: the banner shim needs an
// `import.meta.url` that `createRequire` can resolve.
const { notarizeArtifacts } = await import(notarizeStepFile);
rmSync(notarizeStepDir, { recursive: true, force: true });
const {
	artifactChecks,
	bundledPythonCheck,
	discoverApp,
	discoverDmg,
	discoverArtifacts,
	mainExecutablePath,
	profileAuthorizationCheck,
	profileAuthorizes,
	runChecks,
	summarize,
	verifyArtifacts,
} = await import("./verify-macos-artifacts.mjs");
// The policy module the GATE reads, imported beside the bundle the APP reads from
// (`install` above): the two implementations of one rule are only allowed to stay
// separate because a test asserts they agree, and that test needs both in scope.
const policy = await import("./macos-entitlement-policy.mjs");

const tempDirs = [];
function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}
after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Pre-flight: the installed bundle's seal
// ---------------------------------------------------------------------------

test("bundle path is derived from the running executable", () => {
	assert.equal(
		appBundleFromExecutable(
			"/Applications/Local Operator.app/Contents/MacOS/Local Operator",
		),
		"/Applications/Local Operator.app",
	);
	assert.equal(appBundleFromExecutable("/usr/local/bin/node"), null);
});

test("a broken seal refuses the install, a sealed bundle proceeds", () => {
	// ShipIt's own answer for a bundle it will not accept.
	const bad = evaluateBundleSeal({
		exitCode: 1,
		stdout: "",
		stderr:
			"code object is not signed at all\nIn subcomponent: /Applications/Local Operator.app",
	});
	assert.equal(bad.kind, "unsealed");
	assert.match(bad.detail, /not signed at all/);

	// -67028 is the code the operator's ShipIt logged.
	const badFormat = evaluateBundleSeal({
		exitCode: 1,
		stdout:
			"/Applications/Local Operator.app: not a valid code object (errSecCSBadBundleFormat)",
		stderr: "",
	});
	assert.equal(badFormat.kind, "unsealed");
	assert.match(badFormat.detail, /errSecCSBadBundleFormat/);

	// A sealed resource is the "damaged" reproduction from the release audit.
	const damaged = evaluateBundleSeal({
		exitCode: 1,
		stdout: "a sealed resource is missing or invalid",
		stderr: "",
	});
	assert.equal(damaged.kind, "unsealed");

	assert.deepEqual(
		evaluateBundleSeal({ exitCode: 0, stdout: "", stderr: "" }),
		{
			kind: "sealed",
		},
	);

	// A probe that never reached a verdict is neither of those: the pre-flight
	// retries it, and proceeds if it still cannot run. Treating it as a rejection
	// turned a transient hiccup into a permanent reinstall message (review R5).
	const timedOut = evaluateBundleSeal({
		exitCode: 1,
		stdout: "",
		stderr: "",
		ran: false,
	});
	assert.equal(timedOut.kind, "unavailable");
	assert.match(timedOut.detail, /did not complete/);

	const block = installedBundleSealBlock(
		"/Applications/Local Operator.app",
		"errSecCSBadBundleFormat",
		"0.18.0",
	);
	assert.equal(block.code, "installed-bundle-not-sealed");
	assert.match(block.message, /can't be updated in place/);
	// The refused version is named: it is what makes the refusal quotable.
	assert.match(block.message, /0\.18\.0/);
	// The remedy's first step is the one only the user can take.
	assert.match(block.remedy.text, /Quit Local Operator/);
	assert.equal(block.remedy.url, "https://local-operator.com/download");
});

test("the seal pre-flight is judged from a real codesign run, on macOS", async (t) => {
	if (process.platform !== "darwin") {
		t.skip("macOS only");
		return;
	}

	// A real bundle, really signed, really broken - because the pre-flight's
	// whole job is to read codesign's own output. An ad-hoc signature verifies
	// as well as a Developer ID one for this purpose, so this needs no
	// certificate and runs anywhere macOS does.
	const dir = tempDir("lo-bundle-");
	const app = join(dir, "Fixture.app");
	const contents = join(app, "Contents");
	mkdirSync(join(contents, "MacOS"), { recursive: true });
	mkdirSync(join(contents, "Resources"), { recursive: true });
	writeFileSync(
		join(contents, "Info.plist"),
		[
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<plist version="1.0"><dict>',
			"<key>CFBundleIdentifier</key><string>com.local-operator.fixture</string>",
			"<key>CFBundleExecutable</key><string>Fixture</string>",
			"<key>CFBundlePackageType</key><string>APPL</string>",
			"<key>CFBundleVersion</key><string>1</string>",
			"</dict></plist>",
			"",
		].join("\n"),
		"utf8",
	);
	const executable = join(contents, "MacOS", "Fixture");
	writeFileSync(executable, "#!/bin/sh\necho hi\n", "utf8");
	spawnSync("/bin/chmod", ["+x", executable]);
	writeFileSync(join(contents, "Resources", "asset.txt"), "payload\n", "utf8");
	spawnSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", app]);

	const probe = (target) => {
		// Exactly the probe the pre-flight runs. `--strict` is deliberately absent
		// from it (review R5), because it also rejects FinderInfo/detritus xattrs
		// that ShipIt tolerates - and the assertions below are what makes dropping
		// it safe: a tampered sealed resource still fails without it.
		const result = spawnSync(
			"/usr/bin/codesign",
			["--verify", "--deep", "--verbose=2", target],
			{ encoding: "utf8" },
		);
		return {
			exitCode: result.status ?? 1,
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			ran: result.error == null,
		};
	};

	assert.deepEqual(evaluateBundleSeal(probe(app)), { kind: "sealed" });

	// The release audit's "damaged" reproduction: a sealed resource changed
	// after signing. ShipIt refuses a bundle in this state, so the app must
	// refuse to quit for one.
	writeFileSync(join(contents, "Resources", "asset.txt"), "tampered\n", "utf8");
	const broken = evaluateBundleSeal(probe(app));
	assert.equal(broken.kind, "unsealed");
	assert.match(broken.detail, /a sealed resource is missing or invalid/);
});

// ---------------------------------------------------------------------------
// Healing a bytecode-cache seal break
// ---------------------------------------------------------------------------

/**
 * A real, signed bundle shaped like the shipped app: a bundled interpreter tree
 * that ALREADY holds one sealed `.pyc` under `encodings/__pycache__`.
 *
 * That sealed file is the whole reason this fixture exists rather than reusing
 * the one above. The shipped 0.17.0 bundle carries exactly three `.pyc`, all of
 * them there, and `encodings/__pycache__` is where the interpreter's own startup
 * imports land - so a heal that removes the *directory* takes a sealed file with
 * it, and a removed sealed file is `file missing:` and unhealable, where an
 * added one is recoverable.
 */
function makeBytecodeFixture(dir, { sealedBytecode = true } = {}) {
	const app = join(dir, "Fixture.app");
	const contents = join(app, "Contents");
	const pythonRoot = join(contents, "Resources", "python_aarch64");
	const encodings = join(pythonRoot, "lib", "python3.12", "encodings");
	mkdirSync(join(contents, "MacOS"), { recursive: true });
	mkdirSync(encodings, { recursive: true });
	writeFileSync(
		join(contents, "Info.plist"),
		[
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<plist version="1.0"><dict>',
			"<key>CFBundleIdentifier</key><string>com.local-operator.fixture</string>",
			"<key>CFBundleExecutable</key><string>Fixture</string>",
			"<key>CFBundlePackageType</key><string>APPL</string>",
			"<key>CFBundleVersion</key><string>1</string>",
			"</dict></plist>",
			"",
		].join("\n"),
		"utf8",
	);
	const executable = join(contents, "MacOS", "Fixture");
	writeFileSync(executable, "#!/bin/sh\necho hi\n", "utf8");
	spawnSync("/bin/chmod", ["+x", executable]);
	writeFileSync(join(contents, "Resources", "asset.txt"), "payload\n", "utf8");

	const sealedPyc = join(encodings, "__pycache__", "__init__.cpython-312.pyc");
	if (sealedBytecode) {
		mkdirSync(dirname(sealedPyc), { recursive: true });
		writeFileSync(sealedPyc, "sealed bytecode\n", "utf8");
	}

	const sign = spawnSync("/usr/bin/codesign", [
		"--force",
		"--deep",
		"--sign",
		"-",
		app,
	]);
	assert.equal(sign.status, 0, `codesign failed: ${sign.stderr}`);

	/** The exact probe the pre-flight runs, kept in one place. */
	const probe = () => {
		const result = spawnSync(
			"/usr/bin/codesign",
			["--verify", "--deep", "--verbose=2", app],
			{ encoding: "utf8" },
		);
		return {
			exitCode: result.status ?? 1,
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			ran: result.error == null,
		};
	};
	return { app, contents, pythonRoot, encodings, sealedPyc, probe };
}

/**
 * The watchdog seals the bundle the swap just installed, before it relaunches it.
 *
 * Why this is the closure of the in-app path's window (QA Q1): the zip Squirrel
 * installs does not carry access-control entries, so a freshly swapped bundle is
 * writable until something seals it, and the writers are pythons this app never
 * starts - measured on the operator's machine, where the field `.pyc` appeared 28
 * minutes after signing, into a bundle the app itself never got to seal. The only
 * thing alive in that window is this script, and it knows the bundle path already.
 *
 * Two halves: the generated script is asserted to carry the step, in the right
 * order and with the app's own rights interpolated; and the step is EXECUTED
 * against a bundle with the shipped layout, because a script that reads right and
 * seals nothing is the failure mode that matters here.
 */
test("the watchdog never depends on post-swap ACL repair", () => {
	const source = readFileSync(
		join(process.cwd(), "src/main/update-install.ts"),
		"utf8",
	);
	assert.doesNotMatch(source, /seal_interpreter_trees|chmod \+a/);
});

/** Write a `.pyc` the way the bundled interpreter does: after signing. */
function writeAddedPyc(directory, name) {
	const cacheDir = join(directory, "__pycache__");
	mkdirSync(cacheDir, { recursive: true });
	const path = join(cacheDir, name);
	writeFileSync(path, "added bytecode\n", "utf8");
	return path;
}

/**
 * Write a `.pyc` the way an interpreter under `PYTHONPYCACHEPREFIX` does.
 *
 * The layout is the prefix directory followed by the *absolute source path*
 * minus its root, so there is no `__pycache__` segment to recognise: the field
 * incident of 2026-09-15 was 19 of these under
 * `Contents/Resources/python_aarch64/pycache/`, and the predicate's old segment
 * test called every one of them "outside the bundled python trees". Written
 * under the bundle root given, so a fixture bundle is the only thing this can
 * touch.
 */
function writeMirroredAddedPyc(bundle, relativePath) {
	const path = join(bundle, relativePath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "added mirrored bytecode\n", "utf8");
	return path;
}

test("codesign's violation lines are parsed as codesign prints them", () => {
	// Real output, captured from `/usr/bin/codesign --verify --deep --verbose=2`
	// on a broken ad-hoc-signed fixture, including the canonicalised path.
	const output = [
		"file added: /private/tmp/sealfmt2/Broken.app/Contents/Resources/python_aarch64/lib/python3.12/json/__pycache__/__init__.cpython-312.pyc",
		"file modified: /private/tmp/sealfmt2/Broken.app/Contents/Resources/asset.txt",
		"file missing: /private/tmp/sealfmt2/Broken.app/Contents/Resources/gone.txt",
	].join("\n");
	assert.deepEqual(parseSealViolations(output), [
		{
			kind: "added",
			path: "/private/tmp/sealfmt2/Broken.app/Contents/Resources/python_aarch64/lib/python3.12/json/__pycache__/__init__.cpython-312.pyc",
		},
		{
			kind: "modified",
			path: "/private/tmp/sealfmt2/Broken.app/Contents/Resources/asset.txt",
		},
		{
			kind: "missing",
			path: "/private/tmp/sealfmt2/Broken.app/Contents/Resources/gone.txt",
		},
	]);

	// Blank lines are not violations, and anything codesign says that is not a
	// `file <kind>:` line is kept as `other` rather than dropped: unrecognised
	// output is a reason to refuse, never a reason to delete something.
	assert.deepEqual(
		parseSealViolations("\nfile added: /a/b.pyc\n\nIn subcomponent: /a/b\n"),
		[
			{ kind: "added", path: "/a/b.pyc" },
			{ kind: "other", path: "In subcomponent: /a/b" },
		],
	);
	assert.deepEqual(parseSealViolations("Fixture.app: valid on disk"), [
		{ kind: "other", path: "Fixture.app: valid on disk" },
	]);
});

test("the heal's decision table refuses everything but added bytecode", () => {
	const bundle = "/Applications/Local Operator.app";
	const pycUnder = (name) =>
		`${bundle}/Contents/Resources/python_aarch64/lib/python3.12/json/__pycache__/${name}`;
	const added = (path) => ({ kind: "added", path });

	// Healable: added bytecode inside our own bundled interpreter tree.
	const healable = planPythonBytecodeHeal(bundle, [
		added(pycUnder("__init__.cpython-312.pyc")),
		added(
			`${bundle}/Contents/Resources/python/lib/python3.12/json/__pycache__/decoder.cpython-312.pyc`,
		),
	]);
	assert.equal(healable.healable, true);
	assert.deepEqual(healable.paths, [
		pycUnder("__init__.cpython-312.pyc"),
		`${bundle}/Contents/Resources/python/lib/python3.12/json/__pycache__/decoder.cpython-312.pyc`,
	]);

	// A `file modified:` violation is unhealable by definition: deleting the
	// sealed file turns it into `file missing:` and the seal does not come back.
	const modified = planPythonBytecodeHeal(bundle, [
		added(pycUnder("__init__.cpython-312.pyc")),
		{
			kind: "modified",
			path: `${bundle}/Contents/Resources/python_aarch64/lib/python3.12/encodings/__pycache__/utf_8.cpython-312.pyc`,
		},
	]);
	assert.equal(modified.healable, false);
	assert.match(modified.reason, /modified/);

	// So is anything else codesign reported, and a bundle with nothing added.
	for (const violation of [
		{ kind: "missing", path: pycUnder("gone.cpython-312.pyc") },
		{ kind: "other", path: "resource envelope is obsolete" },
	]) {
		const refused = planPythonBytecodeHeal(bundle, [
			added(pycUnder("a.pyc")),
			violation,
		]);
		assert.equal(refused.healable, false);
	}
	assert.equal(planPythonBytecodeHeal(bundle, []).healable, false);

	// The path test is what keeps the heal to our own bytecode: an added file
	// outside the interpreter trees, and a non-bytecode file inside them, are each
	// refused.
	for (const path of [
		`${bundle}/Contents/Resources/extra.txt`,
		`${bundle}/Contents/Resources/python_aarch64/lib/python3.12/json/decoder.py`,
		`${bundle}/Contents/Resources/python_aarch64/lib/python3.12/json/__pycache__/decoder.cpython-312.pyc.txt`,
		"/Applications/Other.app/Contents/Resources/python_aarch64/lib/python3.12/json/__pycache__/x.cpython-312.pyc",
	]) {
		assert.equal(isPythonBytecodePath(bundle, path), false, path);
		const refused = planPythonBytecodeHeal(bundle, [added(path)]);
		assert.equal(refused.healable, false, path);
		assert.match(refused.reason, /outside the bundled python trees/);
	}

	// A `.pyc` directly inside the tree - no `__pycache__` anywhere - is still our
	// bytecode, and this is the shape a `PYTHONPYCACHEPREFIX` produces: the prefix
	// directory followed by the absolute source path minus its root. The field
	// incident of 2026-09-15 was 19 of these under
	// `Contents/Resources/python_aarch64/pycache/`, and the predicate's old
	// `__pycache__` segment test called every one of them "outside the bundled
	// python trees", which is how a bundle one file-deletion away from valid was
	// reported unrepairable and the user was sent to reinstall.
	const mirrored = [
		`${bundle}/Contents/Resources/python_aarch64/pycache/var/folders/qd/xyz/T/lo-guard-real-79tKWP/modules/lo_probe_module.cpython-314.pyc`,
		`${bundle}/Contents/Resources/python_aarch64/pycache/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/lib/python3.14/json/__init__.cpython-314.pyc`,
		`${bundle}/Contents/Resources/python/lib/python3.12/json/__init__.cpython-312.pyc`,
	];
	for (const path of mirrored) {
		assert.equal(isPythonBytecodePath(bundle, path), true, path);
		const plan = planPythonBytecodeHeal(bundle, [added(path)]);
		assert.equal(plan.healable, true, plan.reason);
		assert.deepEqual(plan.paths, [path]);
	}

	// The whole set the incident reported, in one plan: one removal per reported
	// file, and the `pycache/` mirror alongside the `__pycache__` writes the field
	// install also carried.
	const incident = planPythonBytecodeHeal(bundle, mirrored.map(added));
	assert.equal(incident.healable, true, incident.reason);
	assert.deepEqual(incident.paths, mirrored);
});

test("the heal knows the namespace the interpreter actually ships in", async () => {
	// Review R10 / QA Q2: this predicate keyed on the retired `python` and
	// `python_aarch64` names while the release gate's twin list had been updated to
	// the seed namespace, so on a bundle this branch builds every `.pyc` violation
	// was unhealable by construction and the user was sent to reinstall for a file
	// the app is entitled to delete. Both sides now read one definition, and this
	// asserts the two namespaces AND that the gate's list is that same definition.
	const bundle = "/Applications/Local Operator.app";
	const layout = JSON.parse(
		readFileSync(
			join(process.cwd(), "src/shared/bundled-python-layout.json"),
			"utf8",
		),
	);
	for (const name of [
		"python",
		"python_aarch64",
		...layout.architectures.map((arch) => `${layout.seedNamespace}/${arch}`),
	]) {
		const path = `${bundle}/Contents/Resources/${name}/lib/python3.12/encodings/__pycache__/__init__.cpython-312.pyc`;
		assert.equal(isPythonBytecodePath(bundle, path), true, path);
		const plan = planPythonBytecodeHeal(bundle, [{ kind: "added", path }]);
		assert.equal(plan.healable, true, plan.reason);
	}
	// Nothing else gained the entitlement: the seed's own namespace is only
	// healable for bytecode, not for a source file beside it.
	assert.equal(
		isPythonBytecodePath(
			bundle,
			`${bundle}/Contents/Resources/${layout.seedNamespace}/arm64/lib/python3.12/encodings/__init__.py`,
		),
		false,
	);
	const gate = readFileSync(
		join(process.cwd(), "scripts/verify-macos-artifacts.mjs"),
		"utf8",
	);
	assert.match(
		gate,
		/const BUNDLED_PYTHON_TREES = BYTECODE_TREE_NAMES;/,
		"the gate must walk the shared definition rather than a second spelling of its own",
	);
});

test("the heal removes exactly what was reported, through an injectable remover", () => {
	const bundle = "/Applications/Local Operator.app";
	const path = `${bundle}/Contents/Resources/python_aarch64/lib/python3.12/json/__pycache__/__init__.cpython-312.pyc`;
	const removed = [];
	const result = healPythonBytecode(
		bundle,
		[{ kind: "added", path }],
		(target) => removed.push(target),
	);
	assert.equal(result.healable, true);
	assert.deepEqual(removed, [path]);
	assert.deepEqual(result.removed, [path]);

	// A remover that throws is reported as not healed and says which path: the
	// caller's next step is a re-probe and a refusal, so a half-healed bundle it
	// believes in is the one outcome that must not happen.
	const failed = healPythonBytecode(bundle, [{ kind: "added", path }], () => {
		throw new Error("EROFS");
	});
	assert.equal(failed.healable, false);
	assert.match(failed.reason, /could not remove .*EROFS/);
	assert.deepEqual(failed.removed, []);

	// Nothing is removed when the plan refuses.
	const untouched = [];
	healPythonBytecode(
		bundle,
		[
			{ kind: "added", path },
			{ kind: "modified", path: `${bundle}/Contents/Resources/asset.txt` },
		],
		(target) => untouched.push(target),
	);
	assert.deepEqual(untouched, []);

	// Duplicates in codesign's output are one removal, not two.
	const deduped = [];
	healPythonBytecode(
		bundle,
		[
			{ kind: "added", path },
			{ kind: "added", path },
		],
		(target) => deduped.push(target),
	);
	assert.deepEqual(deduped, [path]);
});

test("a swap under the tree between the plan and the unlink refuses", () => {
	// Why this case exists (review round 1, R2): the per-file re-check is not a
	// stale-plan guard - no caller can supply a plan, and the plan was produced by
	// the same predicate - but it is not a tautology either, because
	// `isPythonBytecodePath` resolves `realpathSync` at the moment it is called. A
	// path whose directory is replaced, between the plan and the unlink, by a
	// symlink out of the bundle resolves somewhere else and is refused. This drives
	// that window and asserts the refusal, so the docstring's claim is bound to a
	// measurement rather than to prose.
	const root = tempDir("lo-recheck-");
	const bundlePath = join(root, "Fixture.app");
	const cached = join(
		bundlePath,
		"Contents",
		"Resources",
		"python_aarch64",
		"lib",
		"python3.12",
		"json",
		"__pycache__",
	);
	const elsewhere = join(root, "elsewhere");
	mkdirSync(cached, { recursive: true });
	mkdirSync(elsewhere, { recursive: true });
	const first = join(cached, "a.cpython-312.pyc");
	const second = join(cached, "b.cpython-312.pyc");
	writeFileSync(first, "added bytecode\n", "utf8");
	writeFileSync(second, "added bytecode\n", "utf8");
	const violations = [
		{ kind: "added", path: first },
		{ kind: "added", path: second },
	];
	// The plan itself is fine, which is the point: only the filesystem moved.
	assert.equal(planPythonBytecodeHeal(bundlePath, violations).healable, true);

	const removed = [];
	const result = healPythonBytecode(bundlePath, violations, (path) => {
		removed.push(path);
		if (path !== first) return;
		// Between the two unlinks: the directory the second path goes through
		// becomes a symlink out of the bundle, with a file of the same name behind
		// it, so the plan's path still exists and still resolves - elsewhere.
		rmSync(cached, { recursive: true, force: true });
		symlinkSync(elsewhere, cached);
		writeFileSync(
			join(elsewhere, "b.cpython-312.pyc"),
			"added bytecode\n",
			"utf8",
		);
	});

	assert.deepEqual(removed, [first], "nothing is unlinked after the refusal");
	assert.equal(result.healable, false);
	assert.match(result.reason, /refused to remove .*b\.cpython-312\.pyc/);
	assert.deepEqual(result.removed, [first]);
	assert.ok(
		existsSync(join(elsewhere, "b.cpython-312.pyc")),
		"the file the plan named is still there, and the heal did not chase it",
	);
});

test("a bytecode-broken bundle really heals, and a tampered one really does not", async (t) => {
	if (process.platform !== "darwin") {
		t.skip("macOS only");
		return;
	}

	// This is the round trip against the real tool, because the heal's whole
	// claim is about what `/usr/bin/codesign` says next: sign clean, let an
	// interpreter write bytecode into the bundle, watch the real probe fail with
	// `file added:`, remove exactly those files, and watch the real probe pass.
	//
	// The three writes cover the three shapes the field has produced: the ordinary
	// `__pycache__` write, one inside a directory that already holds a SEALED
	// `.pyc` (the case a directory-level `rm -rf` gets wrong), and the
	// `PYTHONPYCACHEPREFIX` mirror that the 2026-09-15 incident was made of.
	const fixture = makeBytecodeFixture(tempDir("lo-bytecode-"));
	assert.deepEqual(evaluateBundleSeal(fixture.probe()), { kind: "sealed" });

	const first = writeAddedPyc(
		join(fixture.pythonRoot, "lib", "python3.12", "json"),
		"__init__.cpython-312.pyc",
	);
	// Added inside the directory that already holds a SEALED `.pyc` - the case a
	// directory-level `rm -rf` gets wrong.
	const second = writeAddedPyc(
		join(fixture.pythonRoot, "lib", "python3.12", "encodings"),
		"aliases.cpython-312.pyc",
	);
	// And the incident's own shape: a cache the writing interpreter mirrored under
	// a prefix it was handed, so there is no `__pycache__` segment anywhere in the
	// path. `codesign` calls it `file added:` exactly like the two above, and the
	// heal refused it until `isPythonBytecodePath` stopped requiring that segment.
	const third = writeMirroredAddedPyc(
		fixture.app,
		join(
			"Contents",
			"Resources",
			"python_aarch64",
			"pycache",
			"var",
			"folders",
			"qd",
			"1q2xkcls0tg60vh97jjngxc40000gn",
			"T",
			"lo-guard-real-79tKWP",
			"modules",
			"lo_probe_module.cpython-314.pyc",
		),
	);

	const brokenProbe = fixture.probe();
	const broken = evaluateBundleSeal(brokenProbe);
	assert.equal(broken.kind, "unsealed");
	assert.match(broken.detail, /a sealed resource is missing or invalid/);

	const violations = parseSealViolations(brokenProbe.stdout);
	// All three added files, and nothing but them: the verdict on stderr is not a
	// violation, which is why the parse is over stdout.
	assert.deepEqual(
		violations.map((violation) => violation.kind),
		["added", "added", "added"],
	);
	// codesign reports canonical paths (`/private/var/...` for a `/var/...`
	// temporary directory), so a plain string comparison against the path we
	// created would not match. The heal's path test has to survive exactly that,
	// and this is the real tool saying so rather than a hand-written string.
	for (const violation of violations) {
		assert.ok(
			isPythonBytecodePath(fixture.app, violation.path),
			`the path test refused ${violation.path}`,
		);
	}
	assert.deepEqual(
		[...violations.map((violation) => violation.path)].sort(),
		[realpathSync(first), realpathSync(second), realpathSync(third)].sort(),
	);

	const heal = healPythonBytecode(fixture.app, violations);
	assert.equal(heal.healable, true, heal.reason);
	assert.equal(heal.removed.length, 3);

	// The seal is back, measured rather than inferred.
	assert.deepEqual(evaluateBundleSeal(fixture.probe()), { kind: "sealed" });
	// And the file that was SEALED is still there: the heal removed reported
	// files, not the directories that held them. The mirrored write's empty
	// directories are still there too, deliberately - an added empty directory is
	// not a violation, and the seal above is the proof.
	assert.ok(existsSync(fixture.sealedPyc));
	assert.ok(
		existsSync(join(fixture.pythonRoot, "pycache", "var", "folders", "qd")),
		"the heal leaves the directories the writes created, as its docstring says",
	);

	// The negative case, on the same bundle: once a sealed resource is modified,
	// the heal refuses and the bundle stays refused. A heal that "fixed" this by
	// deleting the modified file would leave `file missing:` and a bundle that
	// still fails - and would have deleted a file the user's install needs.
	const tampered = makeBytecodeFixture(tempDir("lo-bytecode-tamper-"));
	writeAddedPyc(
		join(tampered.pythonRoot, "lib", "python3.12", "json"),
		"__init__.cpython-312.pyc",
	);
	writeFileSync(
		join(tampered.contents, "Resources", "asset.txt"),
		"tampered\n",
		"utf8",
	);
	const tamperedProbe = tampered.probe();
	const tamperedViolations = parseSealViolations(tamperedProbe.stdout);
	assert.ok(
		tamperedViolations.some((violation) => violation.kind === "modified"),
		"the fixture must really produce a modified violation",
	);
	const refused = healPythonBytecode(tampered.app, tamperedViolations);
	assert.equal(refused.healable, false);
	assert.match(refused.reason, /unhealable violation class/);
	assert.deepEqual(refused.removed, []);
	assert.equal(evaluateBundleSeal(tampered.probe()).kind, "unsealed");
});

// ---------------------------------------------------------------------------
// Pending-install marker
// ---------------------------------------------------------------------------

test("pending marker survives a write, detects failure or success, and clears", () => {
	const dir = tempDir("lo-marker-");
	assert.equal(
		pendingInstallMarkerPath(dir).endsWith(PENDING_INSTALL_MARKER_FILE),
		true,
	);

	assert.equal(readPendingInstallMarker(dir), null);

	const marker = writePendingInstallMarker(dir, {
		targetVersion: "0.18.0",
		artifactPath: "/tmp/local-operator-ui-0.18.0-arm64.zip",
		startedAt: "2026-09-11T22:36:48.000Z",
		watchdogPid: 4242,
		// The pid of an install the app started itself. Null is Squirrel's own
		// path, which is what this case is about.
		installerPid: null,
	});
	assert.deepEqual(readPendingInstallMarker(dir), marker);

	// The old version is still running, so the install did not land: this is the
	// signal the operator never got.
	const failed = evaluatePendingInstall({ marker, runningVersion: "0.17.0" });
	assert.equal(failed.kind, "failed");
	const payload = installFailurePayload(marker, "0.17.0");
	assert.match(payload.message, /0\.18\.0 didn't finish/);
	assert.match(payload.message, /0\.17\.0 is still running/);
	assert.equal(payload.targetVersion, "0.18.0");

	const succeeded = evaluatePendingInstall({
		marker,
		runningVersion: "0.18.0",
	});
	assert.equal(succeeded.kind, "succeeded");
	assert.equal(
		evaluatePendingInstall({ marker: null, runningVersion: "0.18.0" }).kind,
		"none",
	);

	assert.equal(clearPendingInstallMarker(dir), true);
	assert.equal(readPendingInstallMarker(dir), null);
	assert.equal(clearPendingInstallMarker(dir), false);

	// A truncated marker must read as "nothing recorded" rather than throw.
	writeFileSync(pendingInstallMarkerPath(dir), "{not json", "utf8");
	assert.equal(readPendingInstallMarker(dir), null);
	assert.equal(parsePendingInstallMarker('{"targetVersion":""}'), null);
});

/**
 * A marker whose target is OLDER than the running version is not a failed
 * install: the machine has moved past it. Reporting it as one told a user on
 * 0.17.0 that an install of 0.9.0 had failed (review Q2).
 */
test("a superseded marker is stale, not a failed update", () => {
	const marker = {
		targetVersion: "0.9.0",
		artifactPath: "/tmp/local-operator-ui-0.9.0-arm64.zip",
		startedAt: "2026-08-01T10:00:00.000Z",
		watchdogPid: null,
	};
	assert.equal(
		evaluatePendingInstall({ marker, runningVersion: "0.17.0" }).kind,
		"stale",
	);
	assert.equal(
		evaluatePendingInstall({ marker, runningVersion: "0.9.0" }).kind,
		"succeeded",
	);
	assert.equal(
		evaluatePendingInstall({
			marker: { ...marker, targetVersion: "0.18.0" },
			runningVersion: "0.17.0",
		}).kind,
		"failed",
	);
	// A version this cannot order is never silently treated as stale: the failure
	// reading is the conservative one.
	assert.equal(
		evaluatePendingInstall({
			marker: { ...marker, targetVersion: "unknown" },
			runningVersion: "0.17.0",
		}).kind,
		"failed",
	);

	assert.equal(compareVersions("0.17.0", "0.9.0"), 1);
	assert.equal(compareVersions("0.9.0", "0.17.0"), -1);
	assert.equal(compareVersions("v0.18.0", "0.18.0"), 0);
	assert.equal(compareVersions("unknown", "0.18.0"), null);
});

/**
 * The incident of 2026-09-13 at the decision itself.
 *
 * The app came back 4:40 into its own install, so it was running the OLD version
 * while the marker named a newer one - and that is indistinguishable from a
 * failure to a version comparison. It used to be read as one: the marker was
 * cleared, the live install's launchd job was removed, and the user was told the
 * update had not completed, two seconds before ShipIt aborted the install on its
 * own final check.
 */
test("an install still in flight is not a failure, and a live installer signal alone is not an install", () => {
	const started = "2026-09-13T09:39:00.991Z";
	const marker = {
		targetVersion: "0.19.5",
		artifactPath:
			"/Users/operator/Library/Caches/local-operator-ui-updater/pending/local-operator-ui-0.19.5-universal.zip",
		startedAt: started,
		watchdogPid: 32413,
	};
	// The 2026-09-13 relaunch, to the second: 4:40 after the marker was written.
	const now = Date.parse(started) + 280 * 1000;

	assert.equal(
		isInstallInFlight({
			marker,
			jobState: "running",
			installerRunning: true,
			now,
		}),
		true,
	);
	assert.equal(
		evaluatePendingInstall({
			marker,
			runningVersion: "0.19.4",
			installInFlight: true,
		}).kind,
		"in-flight",
	);

	// Every fact is needed, and each one alone is wrong. A live installer signal
	// with no marker, a marker with no live installer signal, and the signal an old
	// failure left behind for hours (0.17.0: a job loaded with runs=3114) are all
	// decided by the version: that is a failure.
	assert.equal(
		isInstallInFlight({
			marker: null,
			jobState: "running",
			installerRunning: true,
			now,
		}),
		false,
	);
	assert.equal(
		isInstallInFlight({
			marker,
			jobState: "absent",
			installerRunning: false,
			now,
		}),
		false,
	);
	assert.equal(
		evaluatePendingInstall({ marker, runningVersion: "0.19.4" }).kind,
		"failed",
	);
	assert.equal(
		evaluatePendingInstall({
			marker,
			runningVersion: "0.19.4",
			installInFlight: false,
		}).kind,
		"failed",
	);
	// Recency is the line between a live install and a leftover job, and it must
	// sit ABOVE the watchdog's hard bound - at that bound the watchdog starts the
	// app, and the app it starts must not read the same install as a failure
	// before it has drawn a panel (UX U5). The margin is the gap between the two,
	// so the relationship is asserted rather than the two numbers.
	assert.equal(
		PENDING_INSTALL_RECENCY_SECONDS,
		WATCHDOG_HARD_TIMEOUT_SECONDS + PENDING_INSTALL_RECENCY_MARGIN_SECONDS,
	);
	assert.ok(
		PENDING_INSTALL_RECENCY_SECONDS > WATCHDOG_HARD_TIMEOUT_SECONDS,
		"recovery must outlive the watchdog's hold, or the two disagree at its bound",
	);
	// The overlap the margin removes, stated as the case that produced it: a
	// marker exactly at the hard bound is STILL an install here, where the two
	// constants being equal made it a failure.
	assert.equal(
		isInstallInFlight({
			marker,
			jobState: "running",
			installerRunning: true,
			now: Date.parse(started) + WATCHDOG_HARD_TIMEOUT_SECONDS * 1000,
		}),
		true,
	);
	assert.equal(
		isInstallInFlight({
			marker,
			jobState: "running",
			installerRunning: true,
			now: Date.parse(started) + PENDING_INSTALL_RECENCY_SECONDS * 1000,
		}),
		true,
	);
	assert.equal(
		isInstallInFlight({
			marker,
			jobState: "running",
			installerRunning: true,
			now: Date.parse(started) + (PENDING_INSTALL_RECENCY_SECONDS + 1) * 1000,
		}),
		false,
	);
	assert.equal(pendingInstallAgeSeconds(marker, now), 280);
	// A marker whose start time cannot be read cannot claim to be live either: the
	// failure path reports rather than hides, which is the safe way to be wrong.
	assert.equal(
		pendingInstallAgeSeconds({ ...marker, startedAt: "" }, now),
		null,
	);
	assert.equal(
		isInstallInFlight({
			marker: { ...marker, startedAt: "" },
			jobState: "running",
			installerRunning: true,
			now,
		}),
		false,
	);

	/*
	 * Review R6/R11, the hand-off: launchd reports the job's pid only once ShipIt is
	 * EXECUTING, and until then the job reads `registered` with no pid. The interval
	 * is NOT the submission-to-exec split - that is tenths of a second (the app's
	 * `app quit for the in-flight install` at 11:59:00.520 to ShipIt's first line at
	 * 11:59:00.991, and 256 ms and 380 ms on the two installs of 2026-09-18 measured
	 * the same way). It opens when the MARKER is written, because the app writes the
	 * marker and only then does Squirrel pull the staged artifact through the app's
	 * own local proxy before submitting anything. Measured across the fourteen
	 * installs of 2026-09-16..18 it runs 1.92 s to 13.32 s, and every age below is one
	 * of those installs rather than a round number:
	 *
	 *   2 s     09-17 08:30 v0.26.4,  hand-off 1.981 s  (the shortest measured)
	 *   6.43 s  09-18 16:32 v0.29.0,  hand-off 6.429 s  (past the five-second bound
	 *                                                    this test was first written
	 *                                                    against - review R11)
	 *   13.32 s 09-16 15:23 v0.25.14, hand-off 13.315 s (the longest measured)
	 */
	const aged = (seconds) => ({
		...marker,
		startedAt: new Date(now - seconds * 1000).toISOString(),
	});
	assert.equal(
		isInstallInFlight({ marker: aged(2), jobState: "registered", now }),
		true,
		"the shortest measured hand-off (09-17 08:30) is still the install",
	);
	assert.equal(
		isInstallInFlight({ marker: aged(6.43), jobState: "registered", now }),
		true,
		"the 09-18 16:32 hand-off outlasted five seconds and is still the install",
	);
	assert.equal(
		isInstallInFlight({ marker: aged(13.32), jobState: "registered", now }),
		true,
		"the longest measured hand-off (09-16 15:23) is still the install",
	);
	assert.equal(
		isInstallInFlight({
			marker: aged(PENDING_INSTALL_HANDOFF_SECONDS),
			jobState: "registered",
			now,
		}),
		true,
		"the bound is inclusive: at its own edge the hand-off may still be open",
	);
	assert.equal(
		isInstallInFlight({
			marker: aged(PENDING_INSTALL_HANDOFF_SECONDS + 1),
			jobState: "registered",
			now,
		}),
		false,
		"one second past the bound, a registration is the leftover it usually is",
	);
	// And the U1 case the bound must not resurrect: a COMPLETED install's marker is
	// minutes old, so its registration still opens the app.
	assert.equal(
		isInstallInFlight({ marker: aged(280), jobState: "registered", now }),
		false,
	);
	// An ABSENT job is not an install at any age - there is nothing to be handed.
	assert.equal(
		isInstallInFlight({ marker: aged(1), jobState: "absent", now }),
		false,
	);

	// The order at the decision: the swap landing beats a loaded job, because a
	// running version that has reached the target IS the install finishing; and a
	// superseded marker beats both.
	assert.equal(
		evaluatePendingInstall({
			marker,
			runningVersion: "0.19.5",
			installInFlight: true,
		}).kind,
		"succeeded",
	);
	assert.equal(
		evaluatePendingInstall({
			marker: { ...marker, targetVersion: "0.19.3" },
			runningVersion: "0.19.4",
			installInFlight: true,
		}).kind,
		"stale",
	);

	// What the user is told while it is still running: this is not a failure, and
	// the action that can still save the install is to quit. The message has to
	// name the COST of the other action - Squirrel abandons the install when an
	// instance of the app is running, so "the update can't finish while Local
	// Operator is open" alone reads as "quit later and it will finish", and the
	// panel's secondary action forfeits the install (review D1). It also no longer
	// opens by restating the panel's heading (review D4).
	const payload = installInFlightPayload(marker, "0.19.4");
	assert.equal(payload.targetVersion, "0.19.5");
	assert.match(payload.message, /Version 0\.19\.5 can't finish installing/);
	assert.match(payload.message, /keeping it open cancels the install/);
	assert.match(payload.message, /Quit and leave it closed/);
	assert.doesNotMatch(payload.message, /still being installed/);
	assert.match(payload.detail, /0\.19\.5-universal\.zip/);
	assert.match(payload.detail, /while version 0\.19\.4 was running/);
	// The Details line is read by a person and copied into a support thread, so it
	// carries the locale form of the start time rather than the marker's raw
	// ISO-8601 stamp - the same helper the failure payload uses, pinned by identity
	// instead of by re-deriving the locale string (review R1).
	assert.ok(payload.detail.includes(installStartedText(marker)));
	assert.doesNotMatch(payload.detail, /\d{4}-\d{2}-\d{2}T/);
});

/**
 * The job probe is launchd's exit status and nothing else.
 *
 * `launchctl list <label>` exits 0 while the job is loaded and 113 when it is
 * not, and "the probe could not run" has to read as not loaded: refusing to act
 * on a machine whose launchd is unreachable would strand the marker and the job
 * nobody ever clears.
 */
test("the install job probe separates a running installer from a registration left behind", () => {
	const asked = [];
	const probe = (label) => {
		asked.push(label);
		return { status: 0, output: `"PID" = 55322;` };
	};
	assert.equal(installJobState("com.local-operator.ShipIt", probe), "running");
	assert.deepEqual(asked, ["com.local-operator.ShipIt"]);
	// Registered, not running: the state a FINISHED install leaves behind on this
	// machine (measured 2026-09-18: launchd still lists the app's job 72 minutes
	// after a successful install, with no pid) - and the reading that, taken as
	// liveness, held every launch for ~29 minutes after an update.
	assert.equal(
		installJobState("com.local-operator.ShipIt", () => ({
			status: 0,
			output: `\t"Label" = "com.local-operator.ShipIt";\n\t"OnDemand" = false;`,
		})),
		"registered",
	);
	// launchd's other output shape for the same fact: the table form, where a job
	// it is not running has `-` in the pid column.
	assert.equal(launchdJobPid("55934\t0\tcom.local-operator.ShipIt"), 55934);
	assert.equal(launchdJobPid("-\t0\tcom.local-operator.ShipIt"), null);
	assert.equal(
		installJobState("com.local-operator.ShipIt", () => ({
			status: 0,
			output: "-\t0\tcom.local-operator.ShipIt",
		})),
		"registered",
	);
	// 113 is launchd's "no job of that name".
	assert.equal(
		installJobState("com.local-operator.ShipIt", () => ({
			status: 113,
			output: "",
		})),
		"absent",
	);
	// A probe that could not run is neither loaded nor running, and output this
	// cannot parse is not a licence to hold: the app opens and reports instead.
	assert.equal(
		installJobState("com.local-operator.ShipIt", () => null),
		"unread",
	);
	assert.equal(
		installJobState("com.local-operator.ShipIt", () => ({
			status: 0,
			output: "something this code has never seen",
		})),
		"registered",
	);
	// No job label means nothing to ask, which is not the same as asking.
	assert.equal(
		installJobState(null, () => ({ status: 0, output: "" })),
		"unread",
	);
});

test("the failed install is recorded so a dismiss is not the end of the record", () => {
	const dir = tempDir("lo-attempt-");
	assert.equal(readLastInstallAttempt(dir), null);

	const marker = {
		targetVersion: "0.18.0",
		artifactPath: "/tmp/local-operator-ui-0.18.0-arm64.zip",
		startedAt: "2026-09-11T22:36:48.000Z",
		watchdogPid: 4242,
	};
	const payload = installFailurePayload(marker, "0.17.0");
	assert.equal(
		lastInstallAttemptPath(dir).endsWith("last-update-install.json"),
		true,
	);

	const first = recordInstallFailure(dir, {
		payload,
		// The version the caller is running, which the panel above already named:
		// the record used to carry the PREVIOUS record's version forward and wrote
		// "unknown" on a first failure while the panel said "Version 0.17.0 is still
		// running" (QA Q1). Pinned here because Settings renders this field.
		runningVersion: "0.17.0",
		startedAt: marker.startedAt,
		detectedAt: "2026-09-12T00:00:00.000Z",
	});
	assert.equal(first.attempts, 1);
	assert.equal(first.runningVersion, "0.17.0");
	const second = recordInstallFailure(dir, {
		payload,
		// A later failure on a newer running version replaces it rather than
		// inheriting the first failure's.
		runningVersion: "0.17.1",
		startedAt: marker.startedAt,
		detectedAt: "2026-09-12T01:00:00.000Z",
	});
	assert.equal(second.attempts, 2);
	assert.equal(second.runningVersion, "0.17.1");
	assert.deepEqual(readLastInstallAttempt(dir), second);

	// A different target is a new record, not a third attempt at this one.
	const other = recordInstallFailure(dir, {
		payload: { ...payload, targetVersion: "0.19.0" },
		runningVersion: "0.17.1",
		startedAt: null,
		detectedAt: "2026-09-12T02:00:00.000Z",
	});
	assert.equal(other.attempts, 1);

	// The fallback stays honest about what it does not know: with nothing running
	// to name and nothing earlier to fall back on, the record says so.
	const blank = tempDir("lo-attempt-blank-");
	assert.equal(
		recordInstallFailure(blank, {
			payload,
			runningVersion: "",
			startedAt: null,
			detectedAt: "2026-09-12T03:00:00.000Z",
		}).runningVersion,
		"unknown",
	);

	// A corrupt record reads as "nothing recorded" rather than throwing.
	writeFileSync(lastInstallAttemptPath(dir), "{not json", "utf8");
	assert.equal(readLastInstallAttempt(dir), null);
});

/**
 * The remedy has to carry the page a user can actually reach, and the timestamp
 * has to be one a person reads - the ISO-8601 UTC stamp stayed in the log
 * (reviews U1, D3, D6).
 */
test("the install-failure payload names the manual download page", () => {
	const payload = installFailurePayload(
		{
			targetVersion: "0.18.0",
			artifactPath: "/tmp/local-operator-ui-0.18.0-arm64.zip",
			startedAt: "2026-09-11T22:36:48.000Z",
			watchdogPid: null,
		},
		"0.17.0",
		{ attempts: 3 },
	);
	assert.equal(payload.remedy.url, "https://local-operator.com/download");
	assert.match(payload.remedy.text, /replace it in Applications/);
	assert.equal(payload.attempts, 3);
	assert.doesNotMatch(payload.detail, /\d{4}-\d{2}-\d{2}T/);
	assert.match(payload.detail, /local-operator-ui-0\.18\.0-arm64\.zip/);
});

/**
 * The failure that names its cause.
 *
 * An install this process watched run and then not finish, on a machine whose
 * app was open for part of it, was cancelled by that relaunch: Squirrel's last
 * validation asks whether any instance of the target app is running, and the
 * 2026-09-13 install (App Still Running, SQRLInstallerErrorDomain -9) died on
 * the app the operator opened from Spotlight. "The update didn't finish" there
 * sends the user back to retry the one thing that cannot work.
 */
test("a failure after an install was in flight names the relaunch as the cause", () => {
	const marker = {
		targetVersion: "0.19.5",
		artifactPath:
			"/Users/operator/Library/Caches/local-operator-ui-updater/pending/local-operator-ui-0.19.5-universal.zip",
		startedAt: "2026-09-13T09:39:00.991Z",
		watchdogPid: 32413,
	};
	const generic = installFailurePayload(marker, "0.19.4");
	const cancelled = installFailurePayload(marker, "0.19.4", {
		cancelledByRelaunch: true,
	});
	assert.equal(cancelled.cancelledByRelaunch, true);
	assert.match(
		cancelled.message,
		/cancelled because Local Operator was opened while the update was installing/,
	);
	assert.match(cancelled.message, /0\.19\.4 is still running/);
	assert.match(
		cancelled.detail,
		/Squirrel cancels an install when an instance/,
	);
	assert.doesNotMatch(cancelled.detail, /\d{4}-\d{2}-\d{2}T/);
	// The remedy is still the download page: a user whose install will not settle
	// needs a working app, and telling them how to leave it closed is the only
	// thing that makes the retry different this time.
	assert.equal(cancelled.remedy.url, "https://local-operator.com/download");
	assert.match(
		cancelled.remedy.text,
		/leave it closed until the update finishes/,
	);
	// The generic sentence is what the flag exists to replace, and it stays the
	// default for a failure nobody watched run.
	assert.match(generic.message, /didn't finish/);
	assert.equal(generic.cancelledByRelaunch, undefined);
});

// ---------------------------------------------------------------------------
// What the renderer shows, pinned against what the main process sends
// ---------------------------------------------------------------------------

/**
 * The Storybook fixtures must carry the producer's strings verbatim.
 *
 * The committed evidence frames are captured from these fixtures, so a fixture
 * that drifts from its producer puts copy into the artefact the reviews sign off
 * on that the app cannot produce. That is what happened: the
 * cancelled-by-relaunch fixture kept the ` - ` the payload had already lost, so
 * the three committed frames rendered a sentence the app does not ship (reviews
 * R6 and D9; R1 for the same drift in the in-flight fixture). The frames cannot
 * be checked against the payload by a test because they are pixels - the
 * fixtures can, and the frames are a function of them. The server-update failure
 * sentence is the newest entry in the list below for exactly that reason: it was
 * the one fixture this case did not cover, and it had drifted (design review
 * round 2, D2).
 */
/**
 * The facts the failure fixture stands for, in one place so the sentence and the
 * output under it cannot be composed from different ones.
 *
 * The diagnosis is the same value the composer turns into its pointer clause and
 * the producer sends as `installerOutput` (`update-service.ts`), which is what makes
 * the pairing below a property rather than two independent strings.
 */
const SERVER_UPDATE_FAILURE_SENTENCE_INPUTS = (() => {
	const diagnosis = [
		"uv tool upgrade local-operator",
		"Resolved 55 packages in 1.02s",
		"Installed 1 package in 12ms",
		" + local-operator==0.55.10",
	].join("\n");
	return {
		diagnosis,
		sentence: serverUpdateFailureSentence({
			rebuildRoute: false,
			ran: true,
			exitCode: 0,
			groupSurvived: false,
			diagnosis,
			target: "0.55.10",
			after: "0.55.9",
			before: "0.55.9",
			updateCommand: "lop update",
		}),
	};
})();

test("the story fixtures carry the payload strings verbatim", () => {
	const stories = readFileSync(
		join(
			process.cwd(),
			"src/renderer/src/shared/components/common/update-notification.stories.tsx",
		),
		"utf8",
	);
	const marker = {
		targetVersion: "0.19.5",
		artifactPath:
			"/Users/operator/Library/Caches/local-operator-ui-updater/pending/local-operator-ui-0.19.5-universal.zip",
		startedAt: "2026-09-13T09:39:00.991Z",
		watchdogPid: 32413,
	};
	const inFlight = installInFlightPayload(marker, "0.19.4");
	const cancelled = installFailurePayload(marker, "0.19.4", {
		cancelledByRelaunch: true,
	});
	const startup = installedBundleSealBlock(
		"/Applications/Local Operator.app",
		"errSecCSBadBundleFormat: a sealed resource is missing or invalid",
		null,
		"startup",
	);
	// The other refusal on this panel, and the one the 0.29.6 incident produced:
	// the artifact macOS refuses to spawn. It is built by a different producer
	// (`stagedSignatureBlock`), so its fixture has to be held to that producer's
	// strings for the same reason as the two above - the design round signs off on
	// pixels, and a fixture that drifted renders a sentence the app never sends.
	const unlaunchable = install.stagedSignatureBlock({
		entitlementsPlist: V0296_SIGNATURE_ENTITLEMENTS,
		embeddedProfile: false,
		artifactName: "local-operator-ui-0.29.6-arm64.zip",
		version: "0.29.6",
	});
	assert.ok(unlaunchable, "the 0.29.6 signature must still be refused");
	// The OTHER arm of the same code, which no fixture covered until design round 1
	// (D3): a signature that could not be read, so the app knows only that it cannot
	// tell. Its heading, message and remedy are asserted the same way, because the
	// frame is the only place a reader sees which of the two states they are in.
	const unchecked = install.stagedSignatureBlock({
		entitlementsPlist: null,
		embeddedProfile: false,
		artifactName: "local-operator-ui-0.29.6-arm64.zip",
		version: "0.29.6",
	});
	assert.ok(
		unchecked,
		"an unreadable signature with no profile must be refused",
	);
	for (const [what, text] of [
		["the in-flight message", inFlight.message],
		["the cancelled-by-relaunch message", cancelled.message],
		["the cancelled-by-relaunch remedy", cancelled.remedy.text],
		// The start-up refusal, which is the R2 copy: the story has to carry the
		// builder's own strings, or the frame the design round looks at is a
		// fixture that drifted from what the app sends. All four, because D1-D3
		// changed the message AND gave the state its own heading and dismiss label,
		// and a fixture that carried only the message would look current while the
		// panel rendered the update-time wording it replaced.
		["the start-up refusal message", startup.message],
		["the start-up refusal heading", startup.heading],
		["the start-up refusal dismiss label", startup.dismissLabel],
		/*
		 * THE SERVER-UPDATE FAILURE SENTENCE AND THE OUTPUT IT POINTS AT, which
		 * this list never covered and which is why it drifted: the fixture stood for
		 * a payload whose sentence no arm of `serverUpdateFailureSentence` emits, and
		 * then for a pairing no shipped path composes - the "output is below" pointer
		 * with no output (design review round 2, D2; round 3, R3-1 = D4).
		 */
		[
			"the server-update failure message",
			SERVER_UPDATE_FAILURE_SENTENCE_INPUTS.sentence,
		],
		["the unlaunchable-artifact message", unlaunchable.message],
		["the unlaunchable-artifact remedy", unlaunchable.remedy.text],
		["the unlaunchable-artifact dismiss label", unlaunchable.dismissLabel],
		["the unchecked-artifact heading", unchecked.heading],
		["the unchecked-artifact message", unchecked.message],
		["the unchecked-artifact remedy", unchecked.remedy.text],
		["the unchecked-artifact dismiss label", unchecked.dismissLabel],
	]) {
		assert.ok(text, `${what} is missing from the payload the app sends`);
		assert.ok(
			stories.includes(text),
			`${what} is not in the story fixtures verbatim - the fixture has drifted from the payload the app sends:\n  expected: ${text}`,
		);
	}
	// The exact drift the rounds caught, named so a regression reads as itself
	// rather than as a generic mismatch.
	assert.ok(
		!stories.includes("from the app - and leave it closed"),
		"the cancelled-by-relaunch fixture carries the hyphen the payload replaced with an em dash",
	);
	// And the promise the start-up copy must not make: macOS refusing to open the
	// app is what an unhealed break leads to, not something this pass can assert
	// about a bundle it has only just measured (review R2).
	assert.doesNotMatch(startup.message, /will refuse/);

	/*
	 * D1's own regression guard, which the verbatim list cannot express because it is
	 * about a field that must be ABSENT. The refusal's remedy used to carry
	 * `DOWNLOAD_PAGE_URL`, whose every affordance resolves to `releases/latest` —
	 * the channel that staged the artifact being refused — so the primary action
	 * handed the reader the bundle the app had just declined to install. A frame
	 * cannot show that the button is wrong (it looks the same as the sibling's), so
	 * the guard is on the fixture's shape: no url in this state, and the dismiss
	 * label that does not promise a retry (design round 1, D1 and D6).
	 */
	const cannotLaunchBody = stories.slice(
		stories.indexOf("if (window.triggerUpdateInstallBlockedCannotLaunch)"),
	);
	const cannotLaunchFixture = cannotLaunchBody.slice(
		0,
		cannotLaunchBody.indexOf(
			"if (window.triggerUpdateInstallBlockedCannotCheck)",
		),
	);
	assert.ok(
		cannotLaunchFixture.length > 0,
		"the unlaunchable-artifact fixture was not found in the story file",
	);
	assert.doesNotMatch(
		cannotLaunchFixture,
		/url:/,
		"the refusal fixture must not offer the download page: it serves the artifact this state refused",
	);
	assert.match(cannotLaunchFixture, /dismissLabel: "Not now"/);

	/*
	 * The installer output is a shell transcript in the fixture - an array joined
	 * with "\n" - so it is matched line by line rather than as one literal, which is
	 * also what makes a line dropped from the transcript a failure rather than a
	 * still-passing substring.
	 */
	for (const line of SERVER_UPDATE_FAILURE_SENTENCE_INPUTS.diagnosis.split(
		"\n",
	)) {
		assert.ok(
			stories.includes(line),
			`the installer output line ${JSON.stringify(line)} is not in the story fixture - the block the sentence points at must carry the producer's own words`,
		);
	}

	/*
	 * THE PAIRING THE SENTENCE PROMISES (review round 3, R3-1 = design D4). The
	 * composer emits the "output is below" pointer only for a non-empty diagnosis,
	 * and the producer sends that same value as `installerOutput` - so a payload
	 * carrying that sentence without the output is a report the app cannot build,
	 * and the frame it renders promises a block nothing paints. The two are asserted
	 * together here, in the payload the frame is captured from.
	 */
	const sentence = SERVER_UPDATE_FAILURE_SENTENCE_INPUTS.sentence;
	assert.match(
		sentence,
		/The installer's own output is below\.$/,
		"this fixture stands for the arm whose pointer names the block beside it",
	);
	const failurePayload = stories.slice(
		stories.indexOf("if (window.triggerBackendUpdateError)"),
	);
	const payloadBody = failurePayload.slice(
		0,
		failurePayload.indexOf("return false;"),
	);
	assert.match(
		payloadBody,
		/message:\s*SERVER_UPDATE_FAILURE_MESSAGE/,
		"the failure listener must send the pinned sentence",
	);
	assert.match(
		payloadBody,
		/installerOutput:\s*SERVER_UPDATE_FAILURE_OUTPUT/,
		"the frame must carry the installer output its sentence points at - a pointer with no block is a pairing no shipped payload composes (R3-1)",
	);
	assert.doesNotMatch(startup.message, /the next time you start it/);
	// The remedy is stated ONCE, by the remedy line. D1: the message used to end
	// with the same instruction, 7px above the line that repeats it - measured, so
	// the two paragraphs read as one run and the first telling was the incomplete
	// one (it omitted "Quit Local Operator, then").
	assert.doesNotMatch(startup.message, /download a fresh copy/i);
	assert.doesNotMatch(startup.message, /replace the app/i);
	// D2 and D3: the panel does not answer an update question the user never
	// asked, and does not offer to defer an update that is not coming.
	assert.doesNotMatch(startup.heading, /update/i);
	assert.notEqual(
		startup.heading,
		installedBundleSealBlock(
			"/Applications/Local Operator.app",
			"errSecCSBadBundleFormat",
			"0.19.5",
		).heading,
		"the two contexts must not share a heading",
	);
	assert.equal(startup.dismissLabel, "Not now");
	assert.equal(
		installedBundleSealBlock(
			"/Applications/Local Operator.app",
			"errSecCSBadBundleFormat",
			"0.19.5",
		).dismissLabel,
		undefined,
		"the update-time panel keeps its own label, which is honest there",
	);
});

/**
 * A details line breaks at segment boundaries, and never inside a scheme or the
 * locale date.
 *
 * Both were reachable under the guard the round-2 frames were captured with: the
 * digit guard alone lets `//` through, so a URL or a UNC path got a break
 * opportunity between the two slashes - one a person would never choose - and a
 * break opportunity inside `13/09/2026` is the mid-token break the digit guard
 * exists to remove (review N4). The rule is bundled from the shipped module, so
 * this is a test of the code that renders rather than of a copy of it.
 */
test("a details line breaks at segment boundaries, never inside a scheme or the date", async () => {
	const bundled = await build({
		stdin: {
			contents: 'export * from "./src/renderer/src/shared/lib/path-breaks";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const { withPathBreaks } = await import(
		`data:text/javascript;base64,${Buffer.from(
			bundled.outputFiles[0].text,
		).toString("base64")}`
	);
	const zwsp = "\u200B";

	// A URL: the opportunities are after `https://` and after each segment
	// separator - never between the two slashes of the scheme.
	assert.equal(
		withPathBreaks("https://local-operator.com/download"),
		`https://${zwsp}local-operator.com/${zwsp}download`,
	);
	// A UNC-shaped path: the same at the double slash.
	assert.equal(
		withPathBreaks("//Volumes/Installers/x.zip"),
		`//${zwsp}Volumes/${zwsp}Installers/${zwsp}x.zip`,
	);
	// The locale date stays whole: a separator followed by a digit is not an
	// opportunity anywhere in the string, not only where the date is.
	assert.equal(withPathBreaks("13/09/2026, 09:39:00"), "13/09/2026, 09:39:00");
	// A digit-leading segment keeps the separators on either side of it.
	assert.equal(
		withPathBreaks("/Caches/0.19.5/x.zip"),
		`/${zwsp}Caches/0.19.5/${zwsp}x.zip`,
	);
	// What the copy button hands to the clipboard is the value untouched: the
	// inserted characters exist for the render only.
	assert.equal(withPathBreaks("a/b").replaceAll(zwsp, ""), "a/b");
});

// ---------------------------------------------------------------------------
// Relaunch watchdog
// ---------------------------------------------------------------------------

/**
 * The watchdog decides from two facts, and neither is a process name.
 *
 * Review R1 measured the previous version's failure: macOS `pgrep -f` does not
 * report its own ancestors, and the watchdog is the app's child, so the probe
 * that waited for the app to exit never matched while the app was running.
 */
test("the watchdog is built from the app's pid and the ShipIt job, not a name pattern", () => {
	const plan = buildWatchdogPlan({
		appBundlePath: "/Applications/Local Operator.app",
		executableName: "Local Operator",
		appPid: 4242,
		shipItJob: "com.local-operator.ShipIt",
		// The identity pair the script's second liveness question needs (review
		// R2-1). Synthetic paths, and they matter for the assertion below: they
		// travel in the environment like every other path here, so a listing the
		// script reads cannot match its own command line through them.
		shipItPath:
			"/Applications/Local Operator.app/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt",
		stagingRoot:
			"/Users/someone/Library/Application Support/Local Operator/update-staging",
	});

	// The paths travel in the environment: `sh -c` exposes the script text as the
	// process's own command line, and the old pgrep-based check would then match
	// the watchdog itself through the very check that waits for the app to exit.
	assert.equal(plan.script.includes("/Applications/Local Operator.app"), false);
	assert.equal(
		plan.script.includes(plan.env.LO_UPDATE_WATCHDOG_SHIPIT_PATH),
		false,
	);
	assert.equal(
		plan.script.includes(plan.env.LO_UPDATE_WATCHDOG_STAGING_ROOT),
		false,
	);
	assert.equal(plan.env.LO_UPDATE_WATCHDOG_APP_PID, "4242");
	assert.equal(
		plan.env.LO_UPDATE_WATCHDOG_SHIPIT_JOB,
		"com.local-operator.ShipIt",
	);

	// No name probe survives in the executable part of the script (the comments
	// mention pgrep to explain why it is gone), and both real signals are in it:
	// the app's own pid, and the job label - asked of the probe the plan resolved
	// for the platform it is planned for, which on macOS is `launchctl`. Naming
	// the command in the script is what made the darwin branch unassertable off a
	// Mac and what let the swap-landed case pass here and fail on ubuntu-latest.
	const code = plan.script
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("#"))
		.join("\n");
	assert.doesNotMatch(code, /pgrep/);
	assert.match(code, /kill -0 "\$APP_PID"/);
	assert.match(code, /"\$SHIPIT_PROBE" list "\$SHIPIT_JOB"/);
	assert.equal(plan.env.LO_UPDATE_WATCHDOG_SHIPIT_PROBE, "launchctl");
	assert.equal(plan.env.LO_UPDATE_WATCHDOG_PLIST_READER, "/usr/bin/plutil");

	// The relaunch attempt is not conditional on reaching the end of a wait: the
	// deadline path falls through to it (review Q1), and the decision it waits on
	// is made of the job going AND the swap landing on disk (review R11).
	assert.match(plan.script, /deadline=\$\(\( \$\(now\) \+ 600 \)\)/);
	/*
	 * The activation at the end, and what now stands in front of it (UX U7): a
	 * landed swap is the installer's to bring back - ShipIt relaunches the app
	 * itself - so the script must not front a window the user already has. The
	 * order is asserted, not just the presence, because "open -a anyway" is the
	 * defect: the swap check has to come first, and the old-pid check after it.
	 */
	assert.match(
		plan.script,
		/if swap_landed; then\n\tif \[ -n "\$NAME" \] && \[ -x "\$BUNDLE\/Contents\/MacOS\/\$NAME" \]; then\n\t\topen -g -a "\$BUNDLE"/,
	);
	assert.match(
		plan.script,
		/\nfi\nif app_running; then exit 0; fi\nif \[ -n "\$NAME" \]/,
	);
	assert.match(plan.script, /open -a "\$BUNDLE"/);
	assert.match(plan.script, new RegExp(WATCHDOG_TOKEN));
	// The on-disk half of the decision: the version in the target bundle's own
	// Info.plist, read by the platform's plist reader (`plutil` on macOS) rather
	// than through a preference domain.
	assert.match(
		plan.script,
		/"\$PLIST_READER" -extract CFBundleShortVersionString raw/,
	);
	assert.match(plan.script, /LO_UPDATE_WATCHDOG_TARGET_VERSION/);
	/*
	 * And that read is bounded, because it runs inside the poll loop: an
	 * unbounded read of a path on a mount that has stopped answering would
	 * outlive the script's own deadline and leave the user with no app (R17).
	 * The bound is the plan's, so a test can shorten it and the script holds no
	 * bare number.
	 */
	assert.match(
		plan.script,
		new RegExp(`-ge ${PLIST_READ_TIMEOUT_SECONDS} \\]; then`),
	);
	assert.match(plan.script, /kill -9 "\$_read_pid"/);
	assert.match(plan.script, /lo-update-watchdog-version-/);
	assert.equal(PLIST_READ_TIMEOUT_SECONDS, 5);
	/*
	 * At or beyond the target, not equal to it: the same question the renderer's
	 * own clear rule asks, so a bundle already past the target is not waited out
	 * to the bound (review Q6).
	 */
	assert.match(plan.script, /version_at_least "\$installed" "\$target"/);
	// Both halves reach a single decision, and the reload only happens after it.
	assert.match(plan.script, /decided\(\) \{/);
	assert.match(plan.script, /while :; do\n\tif decided; then break; fi/);
	assert.equal(plan.timeoutSeconds, 600);
	/*
	 * The second bound and the hold in front of it: the soft bound ends the wait
	 * only when there is no loaded job answering for the install, so a launch at
	 * 600 s cannot abort an install that is still working (2026-09-13). The hold
	 * waits on the same job signal the rest of the script does, and the notifier it
	 * uses is osascript - the app is dead, so there is nothing else to use.
	 */
	assert.equal(plan.hardTimeoutSeconds, WATCHDOG_HARD_TIMEOUT_SECONDS);
	assert.match(plan.script, /hard_deadline=\$\(\( \$\(now\) \+ 1800 \)\)/);
	// The hold is keyed on `install_live`, which is the installer's own pid for an
	// install this app started itself and `shipit_loaded` for one Squirrel
	// submitted - and NOT on the job when there is a pid, because this machine
	// keeps the job registered long after a successful install.
	assert.match(plan.script, /&& install_live; then\n\t\t\tholding=1/);
	/*
	 * And the script's own reader of the installer's pid asks the same second
	 * question the app does before it declares the installer gone (review R2-1):
	 * the pid, then a process listing matched on this app's ShipIt path AND this
	 * app's staging root. One fact alone is not enough - the machine runs other
	 * applications' ShipIt processes - and the two facts travel in the environment,
	 * like every other path here.
	 */
	assert.match(
		plan.script,
		/installer_running\(\) \{\n\t\[ -n "\$INSTALLER_PID" \] \|\| return 1/,
	);
	assert.match(
		plan.script,
		/if kill -0 "\$INSTALLER_PID" 2>\/dev\/null; then return 0; fi/,
	);
	assert.match(plan.script, /\tshipit_elsewhere\n\}/);
	assert.match(
		plan.script,
		/ps -Ao command= -ww 2>\/dev\/null \| grep -F "\$SHIPIT_PATH" \| grep -F "\$STAGING_ROOT"/,
	);
	assert.match(plan.env.LO_UPDATE_WATCHDOG_SHIPIT_PATH, /\/ShipIt$/);
	assert.match(plan.env.LO_UPDATE_WATCHDOG_STAGING_ROOT, /update-staging/);
	assert.match(plan.script, /if \[ "\$holding" -eq 1 \]; then/);
	assert.match(plan.script, /notify\(\) \{/);
	assert.match(plan.script, /osascript -e 'on run argv'/);
	// Backgrounded with its status dropped, so a notifier that fails, hangs or
	// does not exist cannot decide anything or hold the script open.
	assert.match(plan.script, /"Local Operator" >\/dev\/null 2>&1 &/);

	const bounded = buildWatchdogPlan({
		appBundlePath: "/Applications/Local Operator.app",
		executableName: "Local Operator",
		appPid: 1,
		shipItJob: null,
		targetVersion: "0.18.0",
		timeoutSeconds: 60,
		intervalSeconds: 1,
		settleSeconds: 1,
		appearSeconds: 2,
		plistReadTimeoutSeconds: 7,
	});
	assert.match(bounded.script, /\+ 60 \)\)/);
	assert.match(bounded.script, /appear_deadline=\$\(\( \$\(now\) \+ 2 \)\)/);
	assert.match(bounded.script, /-ge 7 \]; then/);
	assert.match(bounded.script, /sleep 1/);
	// The hard bound is carried whatever the job label says, because a platform
	// with no label still has a launch path to reach.
	assert.match(bounded.script, /hard_deadline=\$\(\( \$\(now\) \+ 1800 \)\)/);
	// Without a label there is no job to ask about, and the script still waits on
	// the pid alone rather than falling back to a name.
	assert.equal(bounded.env.LO_UPDATE_WATCHDOG_SHIPIT_JOB, "");
	// The installer's pid is the second signal, and empty is what "this install has
	// no installer of ours" means - which is what makes the script's liveness
	// signal the job here, exactly as it was before this field existed.
	assert.equal(bounded.env.LO_UPDATE_WATCHDOG_INSTALLER_PID, "");
	assert.equal(bounded.env.LO_UPDATE_WATCHDOG_TARGET_VERSION, "0.18.0");
	// And the appear window is only for an install that has not STARTED yet, which
	// is a question only the launchd path asks (review R14, UX U6): with no label
	// there is nothing to appear, and an installer this app spawned itself exists
	// before the quit, so "nothing there" is already an answer for it rather than
	// ${appearSeconds}s of pretending that ends in a relaunch with no evidence.
	assert.match(
		bounded.script,
		/if \[ "\$signal_known" -eq 1 \] && \[ -z "\$INSTALLER_PID" \]; then\n\tappear_deadline=/,
	);

	assert.equal(
		shipItJobLabel("com.local-operator"),
		"com.local-operator.ShipIt",
	);
	assert.equal(
		shipItCacheDir("/Users/operator/Library/Caches", "com.local-operator"),
		"/Users/operator/Library/Caches/com.local-operator.ShipIt",
	);
});

/**
 * The target the watchdog may be handed, which is not always the one the install
 * is for.
 *
 * The app used to fall back to its own running version when the updater named
 * none, and that target is already in place: the on-disk check would read the
 * bundle at the target path as "the swap landed" on its first poll, `decided()`
 * would return at once and the app would come back seconds into a live install -
 * the exact outcome that check exists to prevent (review R15).
 */
test("a target that is already installed is never handed to the watchdog", () => {
	assert.equal(
		watchdogSwapTarget({ target: "0.18.0", running: "0.17.0" }),
		"0.18.0",
	);
	// No nameable target: the job and the bound decide instead.
	assert.equal(watchdogSwapTarget({ target: null, running: "0.17.0" }), null);
	assert.equal(
		watchdogSwapTarget({ target: "0.17.0", running: "0.17.0" }),
		null,
	);
	assert.equal(
		watchdogSwapTarget({ target: "v0.17.0", running: "0.17.0" }),
		null,
	);
	// Already past it: with the at-or-beyond compare this target would answer yes
	// before the install begins, so it is dropped for the same reason (Q6).
	assert.equal(
		watchdogSwapTarget({ target: "0.16.0", running: "0.17.0" }),
		null,
	);
	// A target the running version cannot be ordered against is kept: the
	// script's own compare reads it as "not landed", which waits rather than
	// guesses.
	assert.equal(
		watchdogSwapTarget({ target: "0.18.0-rc1", running: "0.17.0" }),
		"0.18.0-rc1",
	);
});

/**
 * Run the script exactly as the app does - `spawn("/bin/sh", ["-c", script])`,
 * detached, with the plan's environment - against a real process tree.
 */
function runWatchdog({ plan, binDir }) {
	const child = spawn("/bin/sh", ["-c", plan.script], {
		detached: true,
		stdio: "ignore",
		env: {
			...process.env,
			...plan.env,
			PATH: `${binDir}:${process.env.PATH ?? ""}`,
		},
	});
	const exit = new Promise((resolve) =>
		child.on("exit", (code, signal) => resolve({ code, signal })),
	);
	return { child, exit };
}

/**
 * Whether the watchdog's own process group has been vacated.
 *
 * `runWatchdog` spawns the script detached, so it leads its own group and
 * anything it starts - the relaunch, a backgrounded read - is a member.
 * `kill(-pgid, 0)` raises ESRCH on an empty group, which is the check the branch
 * with no signals needs: its only route to a relaunch is the bound, and a bound
 * that leaves a process behind is the one thing that branch could add.
 */
function processGroupIsEmpty(pid) {
	try {
		process.kill(-pid, 0);
		return false;
	} catch (error) {
		return error.code === "ESRCH";
	}
}

/**
 * A fixture "app" bundle plus the two commands the watchdog shells out to.
 *
 * The bundle carries a real `Info.plist` because the swap's own state is read
 * from it: the watchdog compares the version there against the version the
 * update was for, which is half of what it waits on (review R11).
 */
function makeWatchdogFixture(dir, version = "0.17.0") {
	const log = join(dir, "launches.log");
	const bundle = join(dir, "Fixture.app");
	mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
	const executable = join(bundle, "Contents", "MacOS", "Fixture");
	writeFileSync(executable, "#!/bin/sh\nexit 0\n", "utf8");
	/** Rewrite the bundle's own version, i.e. land (or un-land) the swap. */
	const setVersion = (next) => {
		writeFileSync(
			join(bundle, "Contents", "Info.plist"),
			`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>CFBundleShortVersionString</key>\n\t<string>${next}</string>\n</dict>\n</plist>\n`,
			"utf8",
		);
	};
	setVersion(version);

	// `open` records the relaunch instead of starting an app.
	const binDir = join(dir, "bin");
	mkdirSync(binDir, { recursive: true });
	const openShim = join(binDir, "open");
	writeFileSync(
		openShim,
		`#!/bin/sh\necho "open $*" >> "${log}"\nexit 0\n`,
		"utf8",
	);
	// `launchctl list <label>` answers the way launchd does: 0 while the job is
	// loaded, 113 when it is not. The state file is the test's hand on that.
	const stateFile = join(dir, "shipit-loaded");
	const launchctlShim = join(binDir, "launchctl");
	writeFileSync(
		launchctlShim,
		`#!/bin/sh\nif [ "$1" = "list" ]; then\n\tif [ -f "${stateFile}" ]; then exit 0; fi\n\texit 113\nfi\nexit 0\n`,
		"utf8",
	);
	/*
	 * The plist reader, in the shape the script invokes it: `-extract
	 * CFBundleShortVersionString raw -o - <plist>`.
	 *
	 * Substituted rather than used for real, for the same reason `launchctl` is:
	 * the shipped one is `/usr/bin/plutil`, an absolute path that does not exist
	 * off macOS, and a probe a test cannot install is not one the script's
	 * behaviour can be asserted against. Taking it from the host is how the
	 * swap-landed case came to assert a macOS-only early exit on ubuntu-latest.
	 * The tags are stripped so the same shim reads the fixture's plist whether the
	 * key and its string share a line or not, and an invocation the script does
	 * not make is refused rather than answered.
	 */
	const plistReaderShim = join(binDir, "plutil");
	writeFileSync(
		plistReaderShim,
		`#!/bin/sh
case "$*" in
	*"-extract CFBundleShortVersionString raw"*) ;;
	*) echo "unexpected plutil invocation: $*" >&2; exit 1 ;;
esac
plist=""
for arg in "$@"; do plist="$arg"; done
[ -n "$plist" ] && [ -r "$plist" ] || exit 1
tr -d '\\n\\t' < "$plist" | sed -n 's|.*<key>CFBundleShortVersionString</key><string>\\([^<]*\\)</string>.*|\\1|p'
`,
		"utf8",
	);
	/*
	 * The notifier, substituted rather than used for real.
	 *
	 * The app is dead while the watchdog runs, so osascript is the only way it has
	 * to speak - and the platform's own is a GUI call that posts a banner on
	 * whoever's screen the suite is running on, which is exactly the thing an
	 * agent-driven run may not do. The script calls it by name (like `open`), so
	 * the shim catches it; the text travels as its own argument, so the log holds
	 * the whole notification. The exit status is the test's hand on the
	 * "notification failure changes nothing" path.
	 */
	const notifyLog = join(dir, "notifications.log");
	const notifierShim = join(binDir, "osascript");
	const setNotifierExit = (exitCode = 0) => {
		writeFileSync(
			notifierShim,
			`#!/bin/sh\necho "$*" >> "${notifyLog}"\nexit ${exitCode}\n`,
			"utf8",
		);
	};
	setNotifierExit();

	spawnSync("/bin/chmod", [
		"+x",
		openShim,
		launchctlShim,
		plistReaderShim,
		notifierShim,
		executable,
	]);

	return {
		bundle,
		binDir,
		stateFile,
		// Both probes, so the darwin plan can be driven on any host: the script
		// calls the command the plan names, and the plan is the platform's.
		probes: { jobProbe: launchctlShim, plistReader: plistReaderShim },
		launchLog: log,
		notifyLog,
		setNotifierExit,
		setVersion,
		notifications: () =>
			existsSync(notifyLog)
				? readFileSync(notifyLog, "utf8").trim().split("\n").filter(Boolean)
				: [],
		launches: () =>
			existsSync(log)
				? readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
				: [],
	};
}

/** A real process the watchdog can watch, killed when the case is over. */
function startProcess(command, args) {
	const child = spawn(command, args, { stdio: "ignore" });
	return child;
}

/**
 * Wait for the launch log to reach `count` lines.
 *
 * The script starts the app in the background (`open -a ... &`), so the log can
 * lag the watchdog's own exit by a few milliseconds - and asserting on it
 * immediately is how a passing relaunch reads as a missing one.
 */
async function waitForLaunches(fixture, count, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fixture.launches().length >= count) return true;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return fixture.launches().length >= count;
}

/**
 * The relaunch itself. Every case here failed in some form before: the first
 * version relaunched into a live swap and then exited for good, and the second
 * exited at its deadline without ever trying (reviews R1, Q1, Q3).
 */
test("the watchdog relaunches a real process tree and never exits without trying", async () => {
	const dir = tempDir("lo-watchdog-");
	const fixture = makeWatchdogFixture(dir);
	const fast = {
		timeoutSeconds: 4,
		intervalSeconds: 1,
		settleSeconds: 1,
		appearSeconds: 1,
		// The announcement is a few seconds in production; here it only has to be
		// observable, because every case below asserts the decision, not the wait.
		announceSeconds: 1,
	};
	const planFor = (pid, overrides = {}) =>
		buildWatchdogPlan({
			appBundlePath: fixture.bundle,
			executableName: "Fixture",
			appPid: pid,
			shipItJob: "com.local-operator.ShipIt",
			// The darwin plan, with both probes pointed at the fixtures above: the
			// branch under test is the platform's, and a test host has neither
			// `launchctl`'s domain to ask nor a `plutil` to read with.
			platform: "darwin",
			signals: fixture.probes,
			...fast,
			...overrides,
		});

	// 1. The install never started (no job): once the app is gone, the app is
	//    started again - exactly once - and the watchdog exits 0.
	{
		const app = startProcess("/bin/sleep", ["30"]);
		const plan = planFor(app.pid);
		const watchdog = runWatchdog({ plan, binDir: fixture.binDir });
		app.kill();
		const result = await watchdog.exit;
		assert.equal(result.code, 0);
		assert.equal(await waitForLaunches(fixture, 1), true);
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(fixture.launches().length, 1);
		assert.match(fixture.launches()[0], /open -a /);
	}

	// 2. Squirrel is mid-install: the job is loaded, so nothing is started while
	//    it is; when the job goes, the app is started.
	{
		writeFileSync(fixture.stateFile, "loaded\n", "utf8");
		const before = fixture.launches().length;
		const app = startProcess("/bin/sleep", ["30"]);
		const plan = planFor(app.pid, { timeoutSeconds: 20 });
		const watchdog = runWatchdog({ plan, binDir: fixture.binDir });
		app.kill();
		await new Promise((resolve) => setTimeout(resolve, 2500));
		// Still installing: the watchdog is waiting, not launching into a swap.
		assert.equal(fixture.launches().length, before);
		rmSync(fixture.stateFile, { force: true });
		const result = await watchdog.exit;
		assert.equal(result.code, 0);
		assert.equal(await waitForLaunches(fixture, before + 1), true);
	}

	// 3. The hung install: the job never goes away. The hard bound is where the
	//    watchdog still tries rather than exiting with the user left with no app
	//    (Q1) - and it is now the SECOND bound, because a launch at the first is
	//    what aborts a live install (2026-09-13). The hold this case passes
	//    through is asserted in its own test below; here it must still end in a
	//    relaunch.
	{
		writeFileSync(fixture.stateFile, "loaded\n", "utf8");
		const app = startProcess("/bin/sleep", ["30"]);
		const plan = planFor(app.pid, { hardTimeoutSeconds: 6 });
		const before = fixture.launches().length;
		const watchdog = runWatchdog({ plan, binDir: fixture.binDir });
		app.kill();
		const result = await watchdog.exit;
		rmSync(fixture.stateFile, { force: true });
		assert.equal(result.code, 0);
		assert.equal(await waitForLaunches(fixture, before + 1), true);
	}

	// 4. The app is still running when the deadline arrives (a user who cancelled
	//    the quit): nothing is started, so the single-instance lock is not asked to
	//    sort out a second launch.
	{
		const app = startProcess("/bin/sleep", ["30"]);
		const plan = planFor(app.pid, { timeoutSeconds: 2 });
		const before = fixture.launches().length;
		const watchdog = runWatchdog({ plan, binDir: fixture.binDir });
		const result = await watchdog.exit;
		assert.equal(result.code, 0);
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(fixture.launches().length, before);
		app.kill();
	}
});

/**
 * The exit that does not need Squirrel's job to go away.
 *
 * The 0.17.0 failure left its job loaded and respawning for hours (runs=3114), so
 * a watchdog that waited only on the job waited out its whole bound with the user
 * staring at nothing - the R1 outcome, fifteen minutes later (review R11). The
 * bundle at the target path reporting the version the update was for is the swap
 * saying it landed, and it is what makes leaving early safe rather than a guess.
 */
test("the watchdog leaves early when the swap has landed, job or no job", async () => {
	const dir = tempDir("lo-watchdog-swap-");
	const fixture = makeWatchdogFixture(dir, "0.17.0");
	const planFor = (pid, overrides = {}) =>
		buildWatchdogPlan({
			appBundlePath: fixture.bundle,
			executableName: "Fixture",
			appPid: pid,
			shipItJob: "com.local-operator.ShipIt",
			targetVersion: "0.18.0",
			// The darwin plan, with both probes pointed at the fixtures: the swap
			// this case waits on is read through the plist-reader shim, so the case
			// asserts the branch wherever it runs instead of only where `plutil`
			// happens to exist (which is how it passed on a Mac and failed on
			// ubuntu-latest).
			platform: "darwin",
			signals: fixture.probes,
			// A bound long enough that reaching it is distinguishable from leaving
			// on the swap: a pass here cannot be a pass by timeout.
			timeoutSeconds: 120,
			intervalSeconds: 1,
			settleSeconds: 1,
			appearSeconds: 1,
			announceSeconds: 1,
			...overrides,
		});

	// 1. The hung install that DID swap: the job stays loaded forever and the new
	//    app is in place. The app comes back in seconds, not at 120 s.
	{
		writeFileSync(fixture.stateFile, "loaded\n", "utf8");
		fixture.setVersion("0.18.0");
		const app = startProcess("/bin/sleep", ["30"]);
		const before = fixture.launches().length;
		const watchdog = runWatchdog({
			plan: planFor(app.pid),
			binDir: fixture.binDir,
		});
		const started = Date.now();
		app.kill();
		const result = await watchdog.exit;
		const elapsed = Date.now() - started;
		assert.equal(result.code, 0);
		assert.equal(await waitForLaunches(fixture, before + 1), true);
		assert.ok(
			elapsed < 15000,
			`expected the swap to end the wait, took ${elapsed}ms`,
		);
		rmSync(fixture.stateFile, { force: true });
	}

	// 2. The swap has NOT landed and the job is still loaded: nothing is launched
	//    into a live install, even past the point where the swap check would fire -
	//    and, since 2026-09-13, nothing is launched at the soft bound either. The
	//    script holds (telling the user the update is still going) until the hard
	//    bound, which stands in for an install that never settles.
	{
		fixture.setVersion("0.17.0");
		writeFileSync(fixture.stateFile, "loaded\n", "utf8");
		const app = startProcess("/bin/sleep", ["30"]);
		const before = fixture.launches().length;
		const watchdog = runWatchdog({
			plan: planFor(app.pid, { timeoutSeconds: 4, hardTimeoutSeconds: 6 }),
			binDir: fixture.binDir,
		});
		app.kill();
		await new Promise((resolve) => setTimeout(resolve, 2500));
		assert.equal(fixture.launches().length, before);
		const result = await watchdog.exit;
		assert.equal(result.code, 0);
		assert.equal(await waitForLaunches(fixture, before + 1), true);
		rmSync(fixture.stateFile, { force: true });
	}

	// 3. The label could not be read (R14): the job cannot be asked about, so the
	//    swap is the whole signal - and waiting for it must not be confused with
	//    relaunching on no evidence. No launch while the swap is pending.
	{
		fixture.setVersion("0.17.0");
		const app = startProcess("/bin/sleep", ["30"]);
		const before = fixture.launches().length;
		const watchdog = runWatchdog({
			plan: planFor(app.pid, { shipItJob: null, timeoutSeconds: 4 }),
			binDir: fixture.binDir,
		});
		app.kill();
		await new Promise((resolve) => setTimeout(resolve, 2500));
		assert.equal(fixture.launches().length, before);
		const result = await watchdog.exit;
		assert.equal(result.code, 0);
		assert.equal(await waitForLaunches(fixture, before + 1), true);
	}

	// 4. The swap has landed and gone PAST the target: a release that moved on
	//    between the offer and the install leaves a bundle reporting a version
	//    this update did not install, and the renderer's own clear rule is "not
	//    behind" - so both halves of this story answer the same question. Waiting
	//    out the bound here is what QA measured before this case existed (Q6).
	{
		fixture.setVersion("0.19.0");
		writeFileSync(fixture.stateFile, "loaded\n", "utf8");
		const app = startProcess("/bin/sleep", ["30"]);
		const before = fixture.launches().length;
		const watchdog = runWatchdog({
			plan: planFor(app.pid),
			binDir: fixture.binDir,
		});
		const started = Date.now();
		app.kill();
		const result = await watchdog.exit;
		const elapsed = Date.now() - started;
		assert.equal(result.code, 0);
		assert.equal(await waitForLaunches(fixture, before + 1), true);
		assert.ok(
			elapsed < 15000,
			`expected a superseded target to end the wait, took ${elapsed}ms`,
		);
		rmSync(fixture.stateFile, { force: true });
	}

	// 5. The label could not be read and the swap HAS landed: the app comes back
	//    at once. With a 30 s appear window in the plan, a prompt exit is the
	//    proof that the window was skipped rather than spent on a job the script
	//    cannot see (review R14).
	{
		fixture.setVersion("0.18.0");
		const app = startProcess("/bin/sleep", ["30"]);
		const before = fixture.launches().length;
		const watchdog = runWatchdog({
			plan: planFor(app.pid, { shipItJob: null, appearSeconds: 30 }),
			binDir: fixture.binDir,
		});
		const started = Date.now();
		app.kill();
		const result = await watchdog.exit;
		const elapsed = Date.now() - started;
		assert.equal(result.code, 0);
		assert.equal(await waitForLaunches(fixture, before + 1), true);
		assert.ok(elapsed < 10000, `expected no appear window, took ${elapsed}ms`);
	}
});

/**
 * The hold, and the notifications that go with it.
 *
 * This is the 2026-09-13 incident as a test. The install's job is loaded at the
 * soft bound, so the install is alive - ShipIt was still moving and
 * code-verifying a ~1 GiB bundle on a host at load ~95 - and an `open -a` at
 * that moment is what Squirrel answers with `App Still Running Error`
 * (SQRLInstallerErrorDomain -9), i.e. our own watchdog was the cause of the
 * failure the user was then told about. So the script must NOT launch while the
 * job is loaded, must tell the user what is going on at both moments, and must
 * still start the app at the hard bound rather than leave them with nothing.
 *
 * The notifications are asserted through the shim because that is what the user
 * gets in production: the app is dead by then, so osascript is the only channel
 * the watchdog has, and the copy is the part of this fix the operator asked for
 * ("nothing says don't reopen it").
 */
test("the watchdog holds while an install is loaded, says so, and starts the app at the hard bound", async () => {
	const dir = tempDir("lo-watchdog-hold-");
	const fixture = makeWatchdogFixture(dir);
	// The job stays loaded for the whole case: an install that never settles.
	writeFileSync(fixture.stateFile, "loaded\n", "utf8");
	const app = startProcess("/bin/sleep", ["30"]);
	const held = buildWatchdogPlan({
		appBundlePath: fixture.bundle,
		executableName: "Fixture",
		appPid: app.pid,
		shipItJob: "com.local-operator.ShipIt",
		platform: "darwin",
		signals: fixture.probes,
		timeoutSeconds: 3,
		hardTimeoutSeconds: 6,
		intervalSeconds: 1,
		settleSeconds: 1,
		appearSeconds: 1,
		announceSeconds: 1,
	});
	const before = fixture.launches().length;
	const watchdog = runWatchdog({ plan: held, binDir: fixture.binDir });
	app.kill();

	/*
	 * Past the soft bound with the job loaded: still no launch, and the HOLD is
	 * the fact asserted rather than a clock margin.
	 *
	 * This used to sleep a fixed 4.2 s and assert afterwards, and that is a race
	 * under the suite's own concurrency rather than a margin: the script reaches
	 * the soft bound only after several of its own forks - `date`, the launchctl
	 * shim, the osascript shim - and on a loaded host that stretch can carry the
	 * still-installing notification past any constant a test could pick, so the
	 * case failed for being slow rather than for the script deciding wrongly.
	 * Widening the constant does not fix that; it only moves the load at which
	 * it breaks, because the quantity is the host's scheduling and not the
	 * script's own bound.
	 *
	 * The notification IS the decision, so it is what this waits for: the script
	 * writes it on exactly one path - the soft bound taken with the install's job
	 * still loaded (`holding=1`) - and the negation of that decision is a launch.
	 * So poll for the decision to become observable, failing the moment a launch
	 * appears instead of at the end of a fixed window, and let the hard bound's
	 * own launch below be the other end of the assertion. The 60 s ceiling is
	 * only a bound on the wait, not the thing being asserted: the script's own
	 * hard bound is 6 s here, so a hold that never becomes observable and never
	 * launches is a hang, not a slow machine.
	 */
	const decisionDeadline = Date.now() + 60000;
	/*
	 * The still-installing notice, matched by its OWN sentence rather than by the
	 * phrase it shares with other copy. The hard bound's notice names the panel's
	 * instruction ("if it says the update is still installing, quit it and leave
	 * it closed"), so a bare /still installing/ counts two notices where this
	 * case is about there being exactly one (UX U10). The sentence is what the
	 * script writes on exactly one path, which is also what makes it the right
	 * thing to count.
	 */
	const stillInstalling = /The update is still installing\./;
	let holding = false;
	while (Date.now() < decisionDeadline) {
		assert.equal(
			fixture.launches().length,
			before,
			"the soft bound launched into a loaded install job",
		);
		holding = fixture
			.notifications()
			.some((line) => stillInstalling.test(line));
		if (holding) break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	const holdingNotes = fixture.notifications();
	assert.ok(
		holdingNotes.some((line) => stillInstalling.test(line)),
		`expected a still-installing notification, got ${JSON.stringify(holdingNotes)}`,
	);

	// The hard bound is the last resort: it starts the app, and says so.
	const result = await watchdog.exit;
	assert.equal(result.code, 0);
	assert.equal(await waitForLaunches(fixture, before + 1), true);
	/*
	 * Exactly one launch, not "at least one". `waitForLaunches` is a `>=` wait,
	 * so it cannot tell one launch from two - and two is what a hold whose
	 * decision is taken twice would produce: the soft bound's path and the hard
	 * bound's are the same question asked at two moments (review R13). The
	 * no-hold case above asserts the same equality on its own bound.
	 */
	assert.equal(fixture.launches().length, before + 1);
	const notes = fixture.notifications();
	// The first notification is the one the operator never got: the app has just
	// vanished, and this is the only warning that reopening it cancels the install.
	assert.ok(
		notes.some((line) =>
			/Keep Local Operator closed until it opens again/.test(line),
		),
		`expected the stay-closed notification, got ${JSON.stringify(notes)}`,
	);
	assert.ok(
		notes.some((line) => /taking longer than expected/.test(line)),
		`expected the hard-bound notification, got ${JSON.stringify(notes)}`,
	);
	// Once each, and named as this app: a banner the user cannot attribute is
	// worse than no banner.
	assert.equal(notes.filter((line) => stillInstalling.test(line)).length, 1);
	assert.ok(notes.every((line) => /Local Operator/.test(line)));

	// The plan carries both bounds, so the caller's log can promise both.
	assert.equal(held.hardTimeoutSeconds, 6);
	assert.equal(held.timeoutSeconds, 3);
	assert.equal(
		buildWatchdogPlan({
			appBundlePath: fixture.bundle,
			executableName: "Fixture",
			appPid: 1,
			shipItJob: null,
		}).hardTimeoutSeconds,
		WATCHDOG_HARD_TIMEOUT_SECONDS,
	);
});

/**
 * A probe that cannot answer is not an install that has ended.
 *
 * `launchctl list <label>` exits 0 for a loaded job and 113 for one launchd has
 * never heard of; every other status - the tool missing from `PATH`, a transient
 * launchd error - is not an answer at all. Read as "not loaded" it decided the
 * install was over, which is the relaunch direction the hold exists to prevent:
 * a probe that failed for an unrelated reason would start the app into a live
 * install and abort it, the 2026-09-13 defect through a different door (review
 * N3). So the unanswerable case holds, and the hard bound is still where a
 * genuinely hung install gives the user their app back - an unanswered probe
 * costs time, not the install.
 */
test("an unanswerable job probe holds rather than starting the app into the install", async () => {
	const dir = tempDir("lo-watchdog-probe-error-");
	const fixture = makeWatchdogFixture(dir);
	// A probe that fails for its own reasons rather than answering `113`: what the
	// fixture's own shim would say is beside the point here.
	const erroringProbe = join(fixture.binDir, "launchctl-error");
	writeFileSync(erroringProbe, "#!/bin/sh\nexit 64\n", "utf8");
	spawnSync("/bin/chmod", ["+x", erroringProbe]);
	const app = startProcess("/bin/sleep", ["30"]);
	const plan = buildWatchdogPlan({
		appBundlePath: fixture.bundle,
		executableName: "Fixture",
		appPid: app.pid,
		shipItJob: "com.local-operator.ShipIt",
		platform: "darwin",
		signals: {
			jobProbe: erroringProbe,
			plistReader: fixture.probes.plistReader,
		},
		timeoutSeconds: 3,
		hardTimeoutSeconds: 6,
		intervalSeconds: 1,
		settleSeconds: 1,
		appearSeconds: 1,
		announceSeconds: 1,
	});
	const before = fixture.launches().length;
	const watchdog = runWatchdog({ plan, binDir: fixture.binDir });
	app.kill();

	// Past the soft bound: no launch, because a probe error is not evidence that
	// the install's job has gone.
	await new Promise((resolve) => setTimeout(resolve, 4200));
	assert.equal(
		fixture.launches().length,
		before,
		"a probe that could not answer was read as the install being over",
	);

	// The bound is unchanged as the last resort, so the safe direction costs time
	// rather than leaving the user with no app.
	const result = await watchdog.exit;
	assert.equal(result.code, 0);
	assert.equal(await waitForLaunches(fixture, before + 1), true);
});

/**
 * A notification that cannot be delivered changes nothing.
 *
 * osascript can be blocked by policy, and a muted Notification Center discards
 * what it is sent - neither may turn into a different decision, a retry that does
 * not happen, or a non-zero exit the app's log would report as a failed watch.
 * The shim fails every call here (a missing notifier is the same case, since the
 * script drops the status either way) and the relaunch still happens.
 *
 * The install has to be LIVE at the moment of the announcement for this case to
 * mean anything, which is why the plan carries an installer pid here: since UX U1
 * the notice is raised only while an install is genuinely running, so a scenario
 * with nothing installing is a scenario in which no notifier is called at all -
 * and the assertion below would pass vacuously. The installer is killed mid-wait,
 * which is also what ends the wait: the pid going IS the install being over.
 */
test("a failed notification does not change the watchdog's decision or its exit status", async () => {
	const dir = tempDir("lo-watchdog-notify-");
	const fixture = makeWatchdogFixture(dir);
	fixture.setNotifierExit(1);
	const app = startProcess("/bin/sleep", ["30"]);
	const installer = startProcess("/bin/sleep", ["30"]);
	const plan = buildWatchdogPlan({
		appBundlePath: fixture.bundle,
		executableName: "Fixture",
		appPid: app.pid,
		shipItJob: "com.local-operator.ShipIt",
		installerPid: installer.pid,
		platform: "darwin",
		signals: fixture.probes,
		timeoutSeconds: 4,
		intervalSeconds: 1,
		settleSeconds: 1,
		appearSeconds: 1,
		announceSeconds: 1,
	});
	const before = fixture.launches().length;
	const watchdog = runWatchdog({ plan, binDir: fixture.binDir });
	app.kill();
	// Past the announcement, and past the poll that follows it: the failing
	// notifier has been called by now, and nothing has been decided by it.
	await new Promise((resolve) => setTimeout(resolve, 2500));
	assert.ok(
		fixture.notifications().length > 0,
		"the failing notifier was never called, so this proves nothing",
	);
	assert.equal(
		fixture.launches().length,
		before,
		"a failed notification turned into a launch into a live install",
	);
	installer.kill();
	const result = await watchdog.exit;
	assert.equal(result.code, 0);
	assert.equal(await waitForLaunches(fixture, before + 1), true);
});

/**
 * A job launchd is late to submit still gets the notice that says stay closed.
 *
 * WHY THIS IS DRIVEN RATHER THAN READ (QA round 2, Q1). `launchctl` answers 113
 * for the first seconds of every Squirrel install - the job is submitted as part
 * of the quit - so a notice whose gate is evaluated once, at the announcement,
 * can be suppressed by the very lateness the appear window exists to absorb. The
 * state file here is that lateness: it appears AFTER the announcement was due, so
 * a script that decided once at the announcement has nothing to say, and the one
 * banner the person was going to get ("the window vanished, don't reopen it")
 * never arrives.
 *
 * The assertion is the notice, not a call: the notifier shim writes what it was
 * asked to say, and the case also pins that nothing was launched while the
 * install was live - a notice bought with a relaunch into the swap would be a
 * worse bug than the silence it replaces.
 */
test("the stay-closed notice follows a job that launchd submits late", async () => {
	const dir = tempDir("lo-watchdog-late-job-");
	const fixture = makeWatchdogFixture(dir);
	const app = startProcess("/bin/sleep", ["30"]);
	const plan = buildWatchdogPlan({
		appBundlePath: fixture.bundle,
		executableName: "Fixture",
		appPid: app.pid,
		shipItJob: "com.local-operator.ShipIt",
		platform: "darwin",
		signals: fixture.probes,
		timeoutSeconds: 30,
		intervalSeconds: 1,
		settleSeconds: 1,
		appearSeconds: 20,
		announceSeconds: 2,
	});
	const before = fixture.launches().length;
	const watchdog = runWatchdog({ plan, binDir: fixture.binDir });
	app.kill();
	// The ordinary late submission: nothing is loaded when the announcement is
	// due, and the job appears a second or two into the appear window.
	await new Promise((resolve) => setTimeout(resolve, 3000));
	assert.equal(
		fixture.notifications().length,
		0,
		"nothing should be claimed before the job appears",
	);
	writeFileSync(fixture.stateFile, "loaded\n", "utf8");
	const deadline = Date.now() + 8000;
	const stayClosed = /Keep Local Operator closed until it opens again/;
	while (Date.now() < deadline) {
		if (fixture.notifications().some((line) => stayClosed.test(line))) break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.ok(
		fixture.notifications().some((line) => stayClosed.test(line)),
		`the job appeared late and the notice never followed: ${JSON.stringify(fixture.notifications())}`,
	);
	assert.equal(
		fixture.launches().length,
		before,
		"the app was started into an install that was still running",
	);

	// And the install ending is what ends the wait: the job goes, the app returns.
	rmSync(fixture.stateFile, { force: true });
	const result = await watchdog.exit;
	assert.equal(result.code, 0);
	assert.equal(await waitForLaunches(fixture, before + 1), true);
});

/**
 * The watchdog's own reader of "is the installer gone" is the app's reader.
 *
 * WHY THIS EXISTS (review R2-1). The script answered a marker's installer pid
 * with `kill -0` alone, while the app answers it with `installerIsAlive ||
 * installerElsewhere` - and `installerElsewhere` exists because one pid is a
 * snapshot: the spawner `exec`s ShipIt, so the common case keeps the pid, but a
 * ShipIt that re-execs or forks internally leaves the recorded pid dead while the
 * install it is carrying out continues. In that case the script read "the install
 * is over", the swap check failed, and it ran a plain `open -a` into the install
 * still running - the Code=-9 abort this change exists to remove. The pid here is
 * genuinely gone (started, killed, reaped); the install is a process whose
 * command line carries this app's own ShipIt AND a state plist under this app's
 * own staging root, which is the pair the app's predicate requires.
 *
 * The second half is the other direction, and it is why BOTH facts and not
 * either: a process naming only the ShipIt path is not this install's, so the
 * script must treat the install as over and bring the app back.
 */
test("a dead installer pid with this app's ShipIt still at work is a live install", async () => {
	const dir = tempDir("lo-watchdog-elsewhere-");
	const fixture = makeWatchdogFixture(dir);
	const shipItPath = join(
		fixture.bundle,
		"Contents",
		"Frameworks",
		"Squirrel.framework",
		"Versions",
		"A",
		"Resources",
		"ShipIt",
	);
	const stagingRoot = join(dir, "update-staging");
	mkdirSync(dirname(shipItPath), { recursive: true });
	/*
	 * The install's own installer, as a process: the resolved ShipIt path with a
	 * state plist under this app's staging root as its argument, which is the shape
	 * an installer's own argv has. Spawned DIRECTLY rather than through `sh -c`
	 * with the facts in a comment, and that is not a detail: `sh -c "sleep 30"`
	 * execs the sleep, so the process's own line is `sleep 30` and the two facts
	 * never reach a listing (measured - the first version of this case asserted a
	 * hold against a process that no longer named either).
	 */
	writeFileSync(shipItPath, "#!/bin/sh\nsleep 30\n", "utf8");
	spawnSync("/bin/chmod", ["+x", shipItPath]);
	const elsewhere = startProcess(shipItPath, [
		join(stagingRoot, "0.28.5-abc", "state.plist"),
	]);
	// The pid the marker names, genuinely gone: started, killed, reaped.
	const installer = startProcess("/bin/sleep", ["30"]);
	installer.kill();
	await new Promise((resolve) => installer.on("exit", resolve));
	const app = startProcess("/bin/sleep", ["30"]);
	const plan = buildWatchdogPlan({
		appBundlePath: fixture.bundle,
		executableName: "Fixture",
		appPid: app.pid,
		shipItJob: "com.local-operator.ShipIt",
		installerPid: installer.pid,
		shipItPath,
		stagingRoot,
		platform: "darwin",
		signals: fixture.probes,
		timeoutSeconds: 20,
		intervalSeconds: 1,
		settleSeconds: 1,
		appearSeconds: 1,
		announceSeconds: 1,
	});
	const before = fixture.launches().length;
	const watchdog = runWatchdog({ plan, binDir: fixture.binDir });
	app.kill();
	await new Promise((resolve) => setTimeout(resolve, 4000));
	assert.equal(
		fixture.launches().length,
		before,
		"the app was launched into an install a ShipIt was still carrying out",
	);

	/*
	 * And one fact alone is not this install's installer: the same ShipIt path with
	 * an argument outside our staging root is another application's install, so the
	 * script declares this install over and brings the app back even though that
	 * process is running.
	 */
	elsewhere.kill();
	const foreign = startProcess(shipItPath, [
		join(dir, "not-our-staging", "state.plist"),
	]);
	const result = await watchdog.exit;
	assert.equal(result.code, 0);
	assert.equal(await waitForLaunches(fixture, before + 1), true);
	foreign.kill();
});

/**
 * The branch for a platform with neither probe: the bound decides, and alone.
 *
 * Why this case is not decoration: the app's watchdog is macOS-only (its caller
 * refuses to plan one anywhere else), but the script's two probes were not stated
 * anywhere - they were whatever the host that generated the script happened to
 * have. `plutil` exists only on macOS, so the swap-landed case above asserted an
 * early exit that could not fire on the CI runner, and `main` went red on every
 * push from the commit that added it (runs 34695505505, 34695566539, 34696129340,
 * 34699012497: `expected the swap to end the wait, took 126265ms`). The fix is
 * that the platform is in the plan (see `watchdogSignals`), and this is the other
 * half of it: a plan for a platform without launchd or plutil must still behave,
 * and must not read "cannot ask" as an answer.
 *
 * The fixture is in the shape that ends the wait in seconds on the darwin branch -
 * the job's state file is loaded and the bundle already reports the target
 * version - so a false early exit here is visible as one. Neither tool is
 * provided to this run, and the assertions also pin that the script names
 * neither, so a later edit cannot quietly reintroduce a dependency on a tool the
 * platform lacks.
 */
test("without launchd or plutil the bound decides, and nothing is left behind", async () => {
	const dir = tempDir("lo-watchdog-nosignals-");
	const fixture = makeWatchdogFixture(dir, "0.18.0");
	const planFor = (pid, overrides = {}) =>
		buildWatchdogPlan({
			appBundlePath: fixture.bundle,
			executableName: "Fixture",
			appPid: pid,
			shipItJob: "com.local-operator.ShipIt",
			targetVersion: "0.18.0",
			timeoutSeconds: 4,
			intervalSeconds: 1,
			settleSeconds: 1,
			appearSeconds: 1,
			platform: "linux",
			...overrides,
		});

	// The resolution itself: a platform with neither tool gets neither probe.
	assert.deepEqual(watchdogSignals("linux"), {
		jobProbe: null,
		plistReader: null,
	});
	const shape = planFor(1);
	assert.equal(shape.env.LO_UPDATE_WATCHDOG_SHIPIT_PROBE, "");
	assert.equal(shape.env.LO_UPDATE_WATCHDOG_PLIST_READER, "");
	const code = shape.script
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("#"))
		.join("\n");
	assert.doesNotMatch(code, /launchctl|plutil/);

	// Both signals that end the wait early on macOS are in their "decided" shape
	// here - the job is loaded, the bundle reports the target version - and still
	// cannot end it: the bound is the only decider left, so the app comes back at
	// ~4s plus the settle, never before.
	writeFileSync(fixture.stateFile, "loaded\n", "utf8");
	const app = startProcess("/bin/sleep", ["30"]);
	const before = fixture.launches().length;
	const watchdog = runWatchdog({
		plan: planFor(app.pid),
		binDir: fixture.binDir,
	});
	const started = Date.now();
	app.kill();
	const result = await watchdog.exit;
	const elapsed = Date.now() - started;
	assert.equal(result.code, 0);
	assert.ok(
		elapsed >= 3000,
		`expected the bound to decide, exited after ${elapsed}ms`,
	);
	assert.equal(await waitForLaunches(fixture, before + 1), true);
	assert.equal(fixture.launches().length, before + 1);
	assert.match(fixture.launches()[before], /open -a /);
	// And nothing of the watchdog's own is left running: the script is spawned
	// detached, so it leads its own process group, and an empty group is the whole
	// of what "no orphan" means here.
	await new Promise((resolve) => setTimeout(resolve, 300));
	assert.equal(
		processGroupIsEmpty(watchdog.child.pid),
		true,
		"the watchdog left a process in its own group",
	);
	rmSync(fixture.stateFile, { force: true });
});

/**
 * The leftover a failed install leaves behind, which had to be removed by hand
 * on the operator's machine: a ShipIt launchd job respawning every ~2.5 s and
 * the staged update tree beside it.
 */
test("a failed install's job and staging tree are reaped, and nothing else", () => {
	const cacheRoot = tempDir("lo-cache-");
	const bundleId = "com.local-operator.fixture";
	const cacheDir = shipItCacheDir(cacheRoot, bundleId);
	mkdirSync(join(cacheDir, "update.abc"), { recursive: true });
	mkdirSync(join(cacheDir, "update.def"), { recursive: true });
	writeFileSync(
		join(cacheDir, "ShipIt_stderr.log"),
		"Could not read update request\n",
		"utf8",
	);

	const removedJobs = [];
	const logs = [];
	const result = reapFailedInstall({
		bundleId,
		cacheRoot,
		removeJob: (label) => {
			removedJobs.push(label);
			return { notFound: false, output: "" };
		},
		exists: (candidate) => existsSync(candidate),
		listDir: (dir) => readdirSync(dir),
		// The removal the service really performs, retry and all: a copy of it here
		// would let a fix for the staged tree pass this suite and still leave ~1 GiB
		// on the user's disk.
		removeDir: reapStagedTree,
		log: (message) => logs.push(message),
	});

	assert.deepEqual(removedJobs, ["com.local-operator.fixture.ShipIt"]);
	assert.equal(result.jobRemoved, true);
	assert.equal(result.removedStaging.length, 2);
	assert.equal(existsSync(join(cacheDir, "update.abc")), false);
	assert.equal(existsSync(join(cacheDir, "update.def")), false);
	// The ShipIt logs are the only record of why the install failed: kept.
	assert.equal(existsSync(join(cacheDir, "ShipIt_stderr.log")), true);
	assert.ok(logs.some((line) => /Removed the leftover install job/.test(line)));
	assert.ok(logs.some((line) => /staged update left behind/.test(line)));
	assert.deepEqual(result.errors, []);

	// A job that was never loaded is not a failure, and it is said so.
	const notLoadedLogs = [];
	const notLoaded = reapFailedInstall({
		bundleId,
		cacheRoot,
		removeJob: () => ({ notFound: true, output: "Could not find service" }),
		exists: (candidate) => existsSync(candidate),
		listDir: (dir) => readdirSync(dir),
		removeDir: () => {},
		log: (message) => notLoadedLogs.push(message),
	});
	assert.equal(notLoaded.jobRemoved, false);
	assert.ok(notLoadedLogs.some((line) => /was not loaded/.test(line)));

	// No bundle id: nothing is touched at all, rather than guessing at a label.
	const skipped = reapFailedInstall({
		bundleId: null,
		cacheRoot,
		removeJob: () => {
			throw new Error("must not remove anything without a bundle id");
		},
		exists: () => {
			throw new Error("must not read the cache without a bundle id");
		},
		listDir: () => {
			throw new Error("must not list the cache without a bundle id");
		},
		removeDir: () => {},
		log: () => {},
	});
	assert.deepEqual(skipped.removedStaging, []);
	assert.equal(skipped.jobLabel, null);
	assert.equal(skipped.jobRemoved, false);

	// A launchd domain that refuses to answer is reported, not thrown.
	const refused = reapFailedInstall({
		bundleId,
		cacheRoot,
		removeJob: () => {
			throw new Error("Operation not permitted");
		},
		exists: (candidate) => existsSync(candidate),
		listDir: (dir) => readdirSync(dir),
		removeDir: () => {},
		log: () => {},
	});
	assert.equal(refused.errors.length, 1);
	assert.match(refused.errors[0], /Operation not permitted/);

	// A staged tree that will not go is reported rather than passed over. This is
	// the run the operator's log carried as a confusing warning, and until it is
	// retried the user's disk is paying for ~1 GiB of staged update.
	mkdirSync(join(cacheDir, "update.ghi"), { recursive: true });
	const stubborn = reapFailedInstall({
		bundleId,
		cacheRoot,
		removeJob: () => ({ notFound: true, output: "" }),
		exists: (candidate) => existsSync(candidate),
		listDir: (dir) => readdirSync(dir),
		removeDir: () => {
			throw new Error("ENOTDIR: not a directory, rmdir '.../app.asar'");
		},
		log: () => {},
	});
	assert.equal(stubborn.errors.length, 1);
	assert.match(stubborn.errors[0], /ENOTDIR/);
	assert.equal(existsSync(join(cacheDir, "update.ghi")), true);
});

/**
 * The staged tree really goes, including through the race that beat `rmSync`.
 *
 * On 2026-09-13 the reap logged `ENOTDIR: not a directory, rmdir
 * '.../update.tsRsfCm/Local Operator.app/Contents/Resources/app.asar'` and left
 * the tree behind: ShipIt was moving that same tree into place at that instant
 * (the reap ran two seconds before the install aborted), so the path readdir had
 * just reported as a directory was a file by the time rmdir reached it. Node's
 * `rmSync` retries EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM and not ENOTDIR, so a
 * single call cannot remove a tree the install is working on.
 */
test("a staged update tree is removed through the ENOTDIR race, and a tree that will not go is reported", () => {
	const dir = tempDir("lo-staged-");
	const staged = join(dir, "update.tsRsfCm");
	const asar = join(
		staged,
		"Local Operator.app",
		"Contents",
		"Resources",
		"app.asar",
	);
	mkdirSync(dirname(asar), { recursive: true });
	writeFileSync(asar, "staged update bytes\n", "utf8");

	let attempts = 0;
	const sleeps = [];
	const racy = (path) => {
		attempts += 1;
		// The real call, on the real shape: a file where a directory was read.
		if (attempts === 1) rmdirSync(asar);
		rmSync(path, { recursive: true, force: true });
	};
	const removal = removeStagedTree({
		path: staged,
		remove: racy,
		exists: (candidate) => existsSync(candidate),
		sleep: (ms) => sleeps.push(ms),
	});
	assert.equal(removal.removed, true);
	assert.equal(removal.error, null);
	assert.equal(removal.attempts, 2);
	assert.equal(existsSync(staged), false);
	assert.deepEqual(sleeps, [250]);

	// Already gone is a removal, not a failure: the install may have consumed the
	// tree it staged, and calling that a failure is the warning the operator's log
	// carried while the disk was in fact clean.
	let goneAttempts = 0;
	const consumed = removeStagedTree({
		path: join(dir, "update.consumed"),
		remove: () => {
			goneAttempts += 1;
		},
		exists: () => false,
		sleep: () => {},
	});
	assert.equal(consumed.removed, true);
	assert.equal(consumed.attempts, 1);
	assert.equal(goneAttempts, 1);

	// A tree that survives every attempt is reported with the real error, and the
	// attempts stop - a retry loop that never ends is a start-up that never ends.
	let stubbornAttempts = 0;
	const stubborn = removeStagedTree({
		path: "/tmp/lo-staged-stubborn",
		remove: () => {
			stubbornAttempts += 1;
			throw new Error("ENOTDIR: not a directory, rmdir '.../app.asar'");
		},
		exists: () => true,
		attempts: 2,
		sleep: () => {},
	});
	assert.equal(stubborn.removed, false);
	assert.equal(stubborn.attempts, 2);
	assert.equal(stubbornAttempts, 2);
	assert.match(stubborn.error, /ENOTDIR/);
});

test("a recorded watchdog is only reaped when it is really ours and the install worked", () => {
	const ours = `sh -c ... # ${WATCHDOG_TOKEN} ...`;
	assert.equal(
		watchdogIsOurs({ alive: true, commandLine: ours, installSucceeded: true }),
		true,
	);
	// The install failed: the watchdog may be about to relaunch the app.
	assert.equal(
		watchdogIsOurs({ alive: true, commandLine: ours, installSucceeded: false }),
		false,
	);
	// A reused pid running something else is not ours to kill.
	assert.equal(
		watchdogIsOurs({
			alive: true,
			commandLine: "/usr/bin/some-other-helper",
			installSucceeded: true,
		}),
		false,
	);
	assert.equal(
		watchdogIsOurs({ alive: false, commandLine: null, installSucceeded: true }),
		false,
	);
});

// ---------------------------------------------------------------------------
// Staged artifact
// ---------------------------------------------------------------------------

const ARTIFACT = {
	url: "local-operator-ui-0.18.0-arm64.zip",
	sha512: "c2hhNTEyLWZpeHR1cmU=",
	size: 352792235,
};

test("artifact metadata is matched by file name, not by position", () => {
	assert.deepEqual(
		matchArtifactMetadata("/tmp/pending/local-operator-ui-0.18.0-arm64.zip", [
			{ url: "local-operator-ui-0.18.0-arm64.dmg", size: 1 },
			ARTIFACT,
		]),
		ARTIFACT,
	);
	assert.equal(matchArtifactMetadata("/tmp/unknown.zip", [ARTIFACT]), null);
});

test("size, sha512 and free space are each required before the install is offered", () => {
	// The app this update would replace: the operator's install measures 1.0 GiB.
	const INSTALLED = 1024 ** 3;
	const needed = requiredDiskBytes({
		artifactSize: ARTIFACT.size,
		installedBundleSize: INSTALLED,
	});
	const staged = (freeBytes, extra = {}) =>
		verifyStagedArtifact({
			filePath: `/tmp/${ARTIFACT.url}`,
			actualSize: ARTIFACT.size,
			actualSha512: ARTIFACT.sha512,
			metadata: ARTIFACT,
			freeBytes,
			installedBundleSize: INSTALLED,
			version: "0.18.0",
			...extra,
		});

	assert.equal(staged(needed).ok, true);

	const short = staged(needed, { actualSize: ARTIFACT.size - 1 });
	assert.equal(short.ok, false);
	assert.equal(short.block.code, "download-verification-failed");
	// The refused version is named, so the refusal is quotable (review U10).
	assert.match(short.block.message, /version 0\.18\.0/);

	const tampered = staged(needed, { actualSha512: "dGFtcGVyZWQ=" });
	assert.equal(tampered.ok, false);
	assert.equal(tampered.block.code, "download-verification-failed");

	/*
	 * The footprint is the install's, not the download's (review R4): the peak is
	 * the artifact plus the staged copy of the new app plus the app being
	 * replaced. The guard this replaced multiplied the ARTIFACT by three - about
	 * 0.98 GiB for this zip - and labelled it the install's footprint, below what
	 * the swap needs.
	 */
	assert.equal(
		needed,
		ARTIFACT.size + INSTALLED * 3 + INSTALL_DISK_SLACK_BYTES,
	);
	assert.ok(needed > ARTIFACT.size * 3);

	const full = staged(needed - 1);
	assert.equal(full.ok, false);
	assert.equal(full.block.code, "insufficient-disk-space");
	assert.match(full.block.message, /version 0\.18\.0/);
	assert.match(full.block.detail, /three 1\.0 GiB app copies/);

	// The old boundary would have passed here and failed inside the install.
	assert.equal(staged(ARTIFACT.size * 3).ok, false);

	// When the installed app cannot be measured, the guard says what it used
	// rather than implying the bigger number.
	const unmeasured = verifyStagedArtifact({
		filePath: `/tmp/${ARTIFACT.url}`,
		actualSize: ARTIFACT.size,
		actualSha512: ARTIFACT.sha512,
		metadata: ARTIFACT,
		freeBytes: 1024,
		installedBundleSize: null,
		version: "0.18.0",
	});
	assert.equal(unmeasured.block.code, "insufficient-disk-space");
	assert.match(unmeasured.block.detail, /could not be measured/);

	const unlisted = verifyStagedArtifact({
		filePath: "/tmp/mystery.zip",
		actualSize: 1,
		actualSha512: "x",
		metadata: null,
		freeBytes: Number.MAX_SAFE_INTEGER,
	});
	assert.equal(unlisted.ok, false);
	assert.equal(unlisted.block.code, "artifact-metadata-missing");
});

test("the installed app's size is measured from the real tree", () => {
	const dir = tempDir("lo-measure-");
	mkdirSync(join(dir, "Contents", "MacOS"), { recursive: true });
	writeFileSync(
		join(dir, "Contents", "MacOS", "Fixture"),
		"x".repeat(4096),
		"utf8",
	);
	writeFileSync(join(dir, "Contents", "Info.plist"), "y".repeat(1024), "utf8");
	assert.equal(measureDirectoryBytes(dir), 5120);
	// A path that is not there is "could not measure", never zero: the difference
	// decides whether the free-space guard uses the app's footprint at all.
	assert.equal(measureDirectoryBytes(join(dir, "nope")), null);
});

test("a staged artifact is resolved from the helper, then the pending cache", () => {
	const dir = tempDir("lo-pending-");
	const file = join(dir, "local-operator-ui-0.18.0-arm64.zip");
	writeFileSync(file, "fixture");

	assert.equal(
		resolveStagedArtifactPath({
			downloadHelperFile: file,
			pendingDir: dir,
			candidateNames: [ARTIFACT.url],
			listDir: () => [],
		}),
		file,
	);

	assert.equal(
		resolveStagedArtifactPath({
			downloadHelperFile: null,
			pendingDir: dir,
			candidateNames: [ARTIFACT.url],
			listDir: (path) => readdirSync(path),
		}),
		file,
	);

	assert.equal(
		resolveStagedArtifactPath({
			downloadHelperFile: null,
			pendingDir: join(dir, "absent"),
			candidateNames: [ARTIFACT.url],
			listDir: () => [],
		}),
		null,
	);
});

// ---------------------------------------------------------------------------
// Backend update planning
// ---------------------------------------------------------------------------

test("a global install is never pip'd into, and names its own updater", () => {
	/*
	 * The operator's own machine, as `which local-operator` really answers there:
	 * a symlink in `~/.local/bin` whose target is inside the uv tool environment.
	 * The printed path contains no `/uv/tools/` marker at all, which is why the
	 * old marker match called this install unknown and told its owner to run pip
	 * (review R2).
	 */
	const shimPath = "/Users/operator/.local/bin/local-operator";
	const uvIdentity = {
		path: shimPath,
		realPath:
			"/Users/operator/.local/share/uv/tools/local-operator/bin/local-operator",
		shebang:
			"#!/Users/operator/.local/share/uv/tools/local-operator/bin/python3",
	};
	assert.equal(classifyGlobalInstall(uvIdentity), "uv-tool");
	// The same install recognised from the receipt uv writes beside the env, and
	// from uv's own listing when the CLI is available.
	assert.equal(
		classifyGlobalInstall({
			path: "/opt/bin/local-operator",
			uvReceipt: "/opt/uv-receipt.toml",
		}),
		"uv-tool",
	);
	assert.equal(
		classifyGlobalInstall({
			path: "/opt/bin/local-operator",
			uvToolList:
				"local-operator v0.54.20\n- local-operator\n- lop\npy-spy v0.4.2\n",
		}),
		"uv-tool",
	);
	assert.equal(
		classifyGlobalInstall({
			path: shimPath,
			realPath:
				"/Users/operator/.local/pipx/venvs/local-operator/bin/local-operator",
		}),
		"pipx",
	);
	assert.equal(
		classifyGlobalInstall({
			path: "/opt/bin/local-operator",
			pipxList:
				"   package local-operator 0.54.20, installed using Python 3.12\n",
		}),
		"pipx",
	);
	// An ordinary pip install into a virtualenv: the one case pip is right for.
	assert.equal(
		classifyGlobalInstall({
			path: "/Users/operator/venv/bin/local-operator",
			venvPrefix: "/Users/operator/venv",
		}),
		"pip",
	);
	assert.equal(classifyGlobalInstall({ path: null }), "global-unknown");
	assert.equal(
		classifyGlobalInstall({ path: "/usr/local/bin/local-operator" }),
		"global-unknown",
	);

	// A source-built uv tool install is described as one, from the install's own
	// marker: the provenance is a fact about the INSTALL, where the signal it
	// replaced - a `lop-update` script existing on this machine - was a fact about
	// the machine, and told an install already replaced by a wheel that it was
	// still following a checkout.
	const sourceBuilt = resolveGlobalInstallPlan({
		identity: {
			...uvIdentity,
			sourceRef: "67586aa1f47eea6be7dad0cdde3e2462f96f465d",
		},
	});
	assert.equal(sourceBuilt.canManageUpdate, false);
	assert.equal(sourceBuilt.updateCommand, "lop update");
	assert.equal(sourceBuilt.sourceBuild, true);
	assert.match(sourceBuilt.detail, /install the published release over it/);

	// The remedy is the install's own front end in BOTH layouts. `lop-update` is
	// the release owner's out-of-tree script and `uv tool upgrade local-operator`
	// is documented in the harness as failing for a git-snapshot install or a
	// pinned receipt, so neither may be named again.
	const registryUv = resolveGlobalInstallPlan({ identity: uvIdentity });
	assert.equal(registryUv.canManageUpdate, false);
	assert.equal(registryUv.updateCommand, "lop update");
	assert.equal(registryUv.sourceBuild, false);
	assert.match(registryUv.remedy, /predates the non-disruptive installer/);

	const pipx = resolveGlobalInstallPlan({
		identity: {
			path: "/Users/operator/.local/pipx/venvs/local-operator/bin/local-operator",
		},
	});
	assert.equal(pipx.updateCommand, "pipx upgrade local-operator");
	assert.equal(pipx.canManageUpdate, false);

	const pip = resolveGlobalInstallPlan({
		identity: {
			path: "/Users/operator/venv/bin/local-operator",
			venvPrefix: "/Users/operator/venv",
		},
	});
	assert.equal(pip.updateCommand, "pip install --upgrade local-operator");

	// Every identified layout gets its own installer, and none of them is pip.
	for (const plan of [sourceBuilt, registryUv, pipx]) {
		assert.doesNotMatch(
			plan.updateCommand,
			/^pip install --upgrade local-operator$/,
		);
	}

	// The unidentified case names NO command. Shipping the pip line for an install
	// the app could not identify is exactly how a uv tool user was told to run pip
	// (reviews R2, U4, D4); "we could not tell" is a claim we can support.
	const unknown = resolveGlobalInstallPlan({
		identity: { path: null },
	});
	assert.equal(unknown.canManageUpdate, false);
	assert.equal(unknown.updateCommand, "");
	assert.match(unknown.remedy, /could not tell how/);
	assert.doesNotMatch(unknown.remedy, /pip install/);
	assert.match(unknown.detail, /was not found on PATH/);

	const unidentified = resolveGlobalInstallPlan({
		identity: { path: "/opt/bin/local-operator" },
	});
	assert.equal(unidentified.updateCommand, "");
	assert.match(unidentified.detail, /classified as global-unknown/);
});

/**
 * The live check, on the machine this incident happened on: whatever
 * `which local-operator` answers here has to be classified, not shrugged at.
 */
test("the operator's own install is classified rather than told to use pip", (t) => {
	const which = spawnSync("/usr/bin/which", ["local-operator"], {
		encoding: "utf8",
	});
	const shimPath = which.stdout?.trim();
	if (which.status !== 0 || !shimPath) {
		t.skip("no local-operator on this machine's PATH");
		return;
	}
	let realPath = null;
	try {
		realPath = realpathSync(shimPath);
	} catch {
		realPath = null;
	}
	const firstLine = readFileSync(shimPath, "utf8").split("\n", 1)[0] ?? "";
	// The markers the layout cannot answer, read from the real prefix on this
	// machine: the uv tool records `INSTALLER = uv`, which is exactly why the
	// pip class consults that file only for the value `pip` (review R13).
	const prefix = dirname(dirname(realPath ?? shimPath));
	const markers = resolveDistributionMarkers(prefix);
	assert.equal(markers.installer, "uv");
	assert.equal(markers.editable, false);
	const kind = classifyGlobalInstall({
		path: shimPath,
		realPath,
		shebang: firstLine.startsWith("#!") ? firstLine : null,
		...markers,
	});
	assert.equal(kind, "uv-tool");
	const plan = resolveGlobalInstallPlan({
		identity: { path: shimPath, realPath, shebang: firstLine },
	});
	assert.doesNotMatch(plan.updateCommand, /^pip install/);
	assert.equal(plan.updateCommand, "lop update");
});

/**
 * Where the install is found when the app was not started by a shell.
 *
 * The app is normally started by Finder or `open`, and macOS gives such a
 * process the launchd default PATH - `/usr/bin:/bin:/usr/sbin:/sbin`, with no
 * `~/.local/bin` in it. That is where uv and pipx link their console scripts and
 * where this machine's `lop-update` lives, so resolving the install with `which`
 * alone answered "nothing is installed" for the very install this whole
 * classification exists to describe: no path, so no kind, so a remedy carrying no
 * command at all - the empty-command panel nobody had rendered.
 */
test("the install resolves without the shell's PATH, and names the same remedy", (t) => {
	const home = homedir();
	// What the app's own environment looks like, against the login PATH a
	// terminal would give it.
	const appEnv = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home };
	const loginEnv = {
		PATH: [
			join(home, ".local", "bin"),
			"/opt/homebrew/bin",
			"/usr/local/bin",
			"/usr/bin",
			"/bin",
		].join(":"),
		HOME: home,
	};
	const userShim = join(home, ".local", "bin", "local-operator");

	// Which locations are searched: the inherited PATH first, then the
	// installers' own bin directories, then Homebrew's and the OS's.
	const tried = [];
	assert.equal(
		resolveCommandPath("local-operator", {
			env: appEnv,
			home,
			listDir: () => [],
			exists: (candidate) => {
				tried.push(candidate);
				return false;
			},
		}),
		null,
	);
	assert.equal(tried[0], "/usr/bin/local-operator");
	assert.ok(tried.includes(userShim));
	assert.ok(tried.includes("/opt/homebrew/bin/local-operator"));
	assert.ok(tried.includes("/usr/local/bin/local-operator"));

	// Found with the launchd PATH alone.
	assert.equal(
		resolveCommandPath("local-operator", {
			env: appEnv,
			home,
			listDir: () => [],
			exists: (candidate) => candidate === userShim,
		}),
		userShim,
	);

	// A `UV_TOOL_BIN_DIR` the installers were pointed at is searched too, and so
	// is the uv tool environment itself: `uv tool install` links a console script
	// into the bin dir, but a link that is gone still leaves `bin/<name>` beside
	// the receipt that names the install as a uv tool.
	const toolsRoot = join(home, ".local", "share", "uv", "tools");
	const toolBin = join(toolsRoot, "local-operator", "bin", "local-operator");
	const envShim = join(home, "custom-bin", "local-operator");
	assert.equal(
		resolveCommandPath("local-operator", {
			env: { ...appEnv, UV_TOOL_BIN_DIR: join(home, "custom-bin") },
			home,
			listDir: (dir) => (dir === toolsRoot ? ["local-operator"] : []),
			exists: (candidate) => candidate === toolBin,
		}),
		toolBin,
	);
	assert.equal(
		resolveCommandPath("local-operator", {
			env: { ...appEnv, UV_TOOL_BIN_DIR: join(home, "custom-bin") },
			home,
			listDir: () => [],
			exists: (candidate) => candidate === envShim,
		}),
		envShim,
	);

	// The real machine: both environments have to point at the same install, and
	// that install has to classify as the uv tool install the plan names the
	// harness's own command for - never a pip or pipx command.
	const underLaunchd = resolveCommandPath("local-operator", {
		env: appEnv,
		home,
	});
	const underLogin = resolveCommandPath("local-operator", {
		env: loginEnv,
		home,
	});
	if (!underLaunchd || !underLogin) {
		t.skip("no local-operator installed outside this machine's PATH");
		return;
	}
	assert.equal(underLaunchd, underLogin);
	assert.equal(
		classifyGlobalInstall(readInstallIdentity(underLogin)),
		"uv-tool",
	);

	// And the install the app found is the install the plan describes: the command
	// is the harness's own front end in every layout, and the version and the
	// provenance come from that install's metadata rather than from the daemon's
	// `/health` or from a script on this machine.
	const identity = readInstallIdentity(underLaunchd);
	const plan = resolveGlobalInstallPlan({ identity });
	assert.equal(plan.updateCommand, "lop update");
	assert.doesNotMatch(plan.updateCommand, /^pip /);
	assert.equal(plan.sourceBuild, isSourceBuildRef(identity.sourceRef));
	// Whether the app may RUN it is the layout predicate and nothing else, and
	// the reason has to be stated either way - this is the machine where the
	// in-place rewrite killed 36 sessions, so the sentence that explains a refusal
	// here is the one that matters most.
	const generationRoot = generationInstallRoot(identity);
	assert.equal(plan.canManageUpdate, generationRoot !== null);
	if (generationRoot === null) {
		/*
		 * The reason moved from the mono Details line into the sentence above the
		 * command it qualifies (reviews U8, N1): it is the fact that decides whether
		 * the reader runs the command at all, and it was trailing a resolved path in
		 * the copy-for-support blob. Details keeps the classification evidence, and
		 * must NOT carry the sentence any more.
		 */
		assert.match(plan.remedy, /rewrites the shared environment in place/);
		assert.match(plan.remedy, /predates the non-disruptive installer/);
		assert.doesNotMatch(
			plan.detail,
			/rewrites the shared environment in place/,
		);
		// The managed arm states the cost of the click instead, and states no colon:
		// the command well below it is visually distinct in both panels, while in
		// the by-hand panel the colon promised the command and delivered a version
		// line (review D5).
		assert.doesNotMatch(plan.remedy, /:$/);
	}
});

test("the bundled pip invocation is non-interactive and version-verified", () => {
	const pip = buildPipUpgradeCommand(
		"/Applications/Local Operator.app/venv/bin/python3",
	);
	assert.equal(
		pip.command,
		"/Applications/Local Operator.app/venv/bin/python3",
	);
	assert.deepEqual(pip.args, [
		"-m",
		"pip",
		"install",
		"--upgrade",
		"--no-input",
		"--disable-pip-version-check",
		"--no-cache-dir",
		"local-operator",
	]);
	assert.match(pip.display, /--no-input/);

	assert.equal(
		parsePipShowVersion("Name: local-operator\nVersion: 0.54.17\nSummary: x"),
		"0.54.17",
	);
	assert.equal(parsePipShowVersion("WARNING: Package(s) not found"), null);

	// "pip exited 0" is not evidence of an upgrade; an unchanged version is a
	// failure even when the command succeeded.
	assert.equal(
		didUpgradeLand({ before: "0.54.17", after: "0.54.17", target: "0.54.18" }),
		false,
	);
	assert.equal(
		didUpgradeLand({ before: "0.54.17", after: "0.54.18", target: "0.54.18" }),
		true,
	);
	assert.equal(didUpgradeLand({ before: "0.54.17", after: null }), false);
	// An unreadable starting point proves nothing: the target version is what the
	// reading afterwards is held to (review R6).
	assert.equal(
		didUpgradeLand({ before: null, after: "0.54.18", target: "0.54.18" }),
		true,
	);
	assert.equal(
		didUpgradeLand({ before: null, after: "0.54.17", target: "0.54.18" }),
		false,
	);
	assert.equal(
		didUpgradeLand({ before: null, after: "0.54.18", target: null }),
		false,
	);
});

/**
 * The stale-index defect, and the pin that makes it loud instead of silent.
 *
 * The operator's report (2026-09-15): the app's check read 0.55.10 from PyPI at
 * 22:08:58, the update service ran `pip install --upgrade local-operator` at
 * 22:09:53 and again at 22:10:50, pip printed "Requirement already satisfied:
 * local-operator ... (0.55.9)", exited 0, and the log recorded `version 0.55.9 ->
 * 0.55.9`. PyPI's own upload time for 0.55.10 is 2026-09-16T02:05:21Z, so both
 * runs resolved against a simple-index page that predated the release by four and
 * a half minutes - inside the `max-age=600` window such a page carries.
 *
 * The live pip cache cannot be re-measured: it was refreshed after that window and
 * now answers 0.55.10 with and without `--no-cache-dir`, so an earlier version of
 * this note citing `pip index versions` is no longer reproducible and was
 * corrected (review R1-3 / QA Q1). What the fix rests on is the two properties
 * asserted below, on a page reconstructed to be stale: the PIN is what turns the
 * silent no-op into a loud failure, and `--no-cache-dir` removes one of the two
 * stale sources (pip's own cache, not a CDN's copy).
 */
test("the bundled pip invocation bypasses pip's index cache and pins the promised release", () => {
	// The unpinned form is the compatibility banner's: it asks for "the current
	// server" and has no version to name.
	const unpinned = buildPipUpgradeCommand("/venv/bin/python3");
	assert.ok(
		unpinned.args.includes("--no-cache-dir"),
		JSON.stringify(unpinned.args),
	);
	assert.equal(unpinned.args.at(-1), "local-operator");

	const pinned = buildPipUpgradeCommand("/venv/bin/python3", "0.55.10");
	assert.deepEqual(pinned.args.slice(-2), [
		"--no-cache-dir",
		"local-operator==0.55.10",
	]);
	// The log line has to name the release too, or a reader cannot tell which
	// version an attempt was aiming at.
	assert.match(pinned.display, /local-operator==0\.55\.10$/);

	// A target that is not a release keeps the unpinned requirement rather than
	// reaching the command line: this value crosses IPC as an arbitrary string.
	for (const target of [
		null,
		undefined,
		"",
		"   ",
		"latest",
		"v0.55.10",
		"0.55.x",
		"0.55.10 --extra-index-url http://evil.example",
		"0.55.10;rm -rf /",
	]) {
		const built = buildPipUpgradeCommand("/venv/bin/python3", target);
		assert.equal(
			built.args.at(-1),
			"local-operator",
			`target ${JSON.stringify(target)} must not be pinned`,
		);
	}

	// The PEP 440 spellings a real release can carry still pin, because refusing
	// to pin them would send the pre-release case back to an unpinned resolve - and
	// an unpinned resolve against a FRESH index installs the newest release, which
	// can be newer than the one the app promised and then polls for, so the update
	// is reported as failed over a server that did move (review R1-3).
	for (const [target, requirement] of [
		["0.55.10", "local-operator==0.55.10"],
		[" 0.55.10 ", "local-operator==0.55.10"],
		["0.56.0b1", "local-operator==0.56.0b1"],
		["0.55.10.post1", "local-operator==0.55.10.post1"],
		// An epoch: publishable, and `isPinnableVersion` used to refuse it.
		["1!0.55.10", "local-operator==1!0.55.10"],
		// Segments after the release, in the order PEP 440 allows them.
		["0.55.10a1.post1", "local-operator==0.55.10a1.post1"],
		["0.55.10.post1.dev2", "local-operator==0.55.10.post1.dev2"],
		["0.55.10a1.dev2", "local-operator==0.55.10a1.dev2"],
		["0.55.10+macos.1", "local-operator==0.55.10+macos.1"],
	]) {
		assert.equal(
			buildPipUpgradeCommand("/venv/bin/python3", target).args.at(-1),
			requirement,
		);
	}

	// Widening the pattern did not turn it into a pass-through: a string that only
	// LOOKS like a version still does not reach the command line.
	for (const target of [
		"0.55.10.post1.dev2a1",
		"1!0.55.10 --extra-index-url http://evil.example",
		// The same two segments the other way round, which PEP 440 has no version
		// for - dev comes before post, never after.
		"0.55.10.dev2.post1",
		// And a segment repeated.
		"0.55.10.post1.post2",
	]) {
		assert.equal(
			buildPipUpgradeCommand("/venv/bin/python3", target).args.at(-1),
			"local-operator",
			`target ${JSON.stringify(target)} must not be pinned`,
		);
	}
});

// ---------------------------------------------------------------------------
// macOS artifact assertions
// ---------------------------------------------------------------------------

const APP = "/tmp/dist/mac-arm64/Local Operator.app";
const DMG = "/tmp/dist/local-operator-ui-0.18.0-arm64.dmg";
const _X64_DMG = "/tmp/dist/local-operator-ui-0.18.0-x64.dmg";

/**
 * The verdict `bundledPythonCheck` reaches for a bundle of one architecture that
 * carries the listed interpreter trees.
 *
 * The architecture comes from the injected runner rather than a real `lipo` call:
 * the fixture would otherwise have to be a genuine Mach-O of each architecture,
 * which is a copy of the check's own input rather than a test of its logic.
 */
function pythonTreeVerdict({ arch, trees }) {
	const dir = tempDir("lo-python-gate-");
	const app = join(dir, "Local Operator.app");
	const framework = join(
		app,
		"Contents",
		"Frameworks",
		"Electron Framework.framework",
		"Versions",
		"A",
		"Electron Framework",
	);
	mkdirSync(dirname(framework), { recursive: true });
	writeFileSync(framework, "binary fixture", "utf8");
	for (const tree of trees) {
		mkdirSync(
			join(
				app,
				"Contents",
				"Resources",
				"python-runtime-seed",
				tree === "python_aarch64" ? "arm64" : "x64",
			),
			{ recursive: true },
		);
	}
	return bundledPythonCheck(app, {
		run: () => ({ status: 0, stdout: `${arch}\n`, stderr: "" }),
	});
}

/**
 * The decisive branch of the interpreter gate (review F5, round 2 F7).
 *
 * "Exactly one tree" alone passes for an arm64 bundle that kept the x86_64
 * interpreter, and that bundle cannot start its backend at all - so the pairing
 * is what is asserted, and each way it can be wrong is asserted here.
 */
test("the interpreter gate refuses the other architecture's tree", () => {
	const wrongTree = pythonTreeVerdict({ arch: "arm64", trees: ["python"] });
	assert.equal(wrongTree.passed, false);
	assert.match(
		wrongTree.output,
		/the arm64 app ships Contents\/Resources\/python-runtime-seed\/x64, but it resolves Contents\/Resources\/python-runtime-seed\/arm64/,
	);

	const reversed = pythonTreeVerdict({
		arch: "x86_64",
		trees: ["python_aarch64"],
	});
	assert.equal(reversed.passed, false);
	assert.match(
		reversed.output,
		/the x86_64 app ships Contents\/Resources\/python-runtime-seed\/arm64, but it resolves Contents\/Resources\/python-runtime-seed\/x64/,
	);

	// Two trees is the state `afterPack` exists to prevent: the app runs, and half
	// the interpreter in the download is unrunnable.
	const both = pythonTreeVerdict({
		arch: "arm64",
		trees: ["python", "python_aarch64"],
	});
	assert.equal(both.passed, false);
	assert.match(
		both.output,
		/ships Contents\/Resources\/python-runtime-seed\/(?:arm64|x64), Contents\/Resources\/python-runtime-seed\/(?:arm64|x64)/,
	);

	// A fat bundle legitimately needs both, so it fails as its own case rather
	// than being rounded to one architecture.
	const fat = pythonTreeVerdict({
		arch: "arm64 x86_64",
		trees: ["python_aarch64"],
	});
	assert.equal(fat.passed, false);
	assert.match(fat.output, /not a single architecture/);

	// An architecture with no mapping is refused, not defaulted to `python`.
	const unmapped = pythonTreeVerdict({
		arch: "arm64e",
		trees: ["python_aarch64"],
	});
	assert.equal(unmapped.passed, false);
	assert.match(unmapped.output, /no bundled interpreter matches/);

	// And the pairing holds the right way round, so the cases above are failures
	// of the pairing rather than of the check.
	const right = pythonTreeVerdict({ arch: "arm64", trees: ["python_aarch64"] });
	assert.equal(right.passed, true);
	assert.match(
		right.output,
		/arm64 app ships only Contents\/Resources\/python-runtime-seed\/arm64/,
	);
});

test("the artifact assertions are the ones a user's Gatekeeper runs", () => {
	const checks = artifactChecks({ appPath: APP, dmgPath: DMG });
	assert.deepEqual(
		checks.map((check) => check.id),
		[
			"app-codesign",
			"app-spctl",
			"app-stapler",
			// The question no other check in this list asks, and the one that
			// bricked 0.29.6: will macOS actually spawn what we are about to ship?
			// Honoured only by executing the binary — amfid's refusal is invisible to
			// codesign, spctl and stapler alike (both measured on the real bundle).
			"app-spawn",
			// The cause behind it — a restricted entitlement with no profile to
			// authorize it — is NOT in this list: it is `profileAuthorizationCheck`,
			// which walks every executable in the bundle rather than reading the
			// launcher's signature once (review round 1, finding 1). Keeping the id
			// while widening the population is deliberate: a failure is still the
			// candidate's own, which is what `verify-signed-update.mjs` acts on.
			// The passkey entitlement, asserted on the SIGNED bundle: every failure
			// downstream of it is silent by design, so the release gate reads it off
			// the artifact rather than trusting the build (review round 1, finding 6).
			// Bidirectional since 0.29.6: absent is the shipped default, and present
			// is only acceptable when a profile authorizes it.
			"app-webauthn-entitlement",
			"dmg-spctl",
			"dmg-stapler",
		],
	);

	const codesign = checks.find((check) => check.id === "app-codesign");
	assert.deepEqual(codesign.args, [
		"--verify",
		"--deep",
		"--strict",
		"--verbose=2",
		APP,
	]);
	assert.equal(
		codesign.expect({ status: 1, stdout: "", stderr: "invalid signature" }),
		false,
	);

	const dmgSpctl = checks.find((check) => check.id === "dmg-spctl");
	assert.deepEqual(dmgSpctl.args, [
		"-a",
		"-vvv",
		"-t",
		"open",
		"--context",
		"context:primary-signature",
		DMG,
	]);
	assert.equal(
		dmgSpctl.expect({ status: 0, stdout: "rejected", stderr: "" }),
		false,
	);
	assert.equal(
		dmgSpctl.expect({
			status: 0,
			stdout: "accepted\nsource=Notarized Developer ID",
			stderr: "",
		}),
		true,
	);
});

test("an unsigned or unnotarized disk image fails the release assertions", () => {
	// The shape of the shipped 0.17.0 release: the app inside is signed,
	// notarized and stapled, and the image itself is none of those.
	const shippedV0170 = (command, args) => {
		const joined = args.join(" ");
		// The spawn probe executes the bundle's own main executable; a stub has to
		// answer for it like any other command this file runs.
		if (joined === "-p process.exit(0)") {
			return {
				status: 0,
				signal: null,
				timedOut: false,
				stdout: "",
				stderr: "",
			};
		}
		if (command === "/usr/bin/codesign") {
			return { status: 0, stdout: "", stderr: "" };
		}
		if (joined.includes("-t exec")) {
			return {
				status: 0,
				stdout: "accepted\nsource=Notarized Developer ID",
				stderr: "",
			};
		}
		if (joined.includes("-t open")) {
			return {
				status: 0,
				stdout: "rejected\nsource=no usable signature",
				stderr: "",
			};
		}
		if (joined.includes("stapler validate")) {
			return joined.endsWith(".app")
				? { status: 0, stdout: "The validate action worked!", stderr: "" }
				: {
						status: 65,
						stdout: "",
						stderr: "The staple and validate action failed! Error 65.",
					};
		}
		throw new Error(`unexpected command: ${command} ${joined}`);
	};

	const failing = summarize(
		runChecks({ appPath: APP, dmgPath: DMG, run: shippedV0170 }),
	);
	assert.equal(failing.ok, false);
	assert.deepEqual(
		failing.failures.map((result) => result.id),
		// The image is the only thing wrong here. 0.17.0's app signature carries no
		// WebAuthn group, which the gate reads off the artifact rather than trusting
		// the build (review round 1, finding 6) — and since 0.29.6 "no group" is the
		// SHIPPED arrangement rather than a failure, so that check passes here.
		["dmg-spctl", "dmg-stapler"],
	);
	assert.match(
		failing.failures.find((result) => result.id === "dmg-spctl").output,
		/no usable signature/,
	);

	// The same artifacts after the fix: image signed, notarized and stapled, app
	// group-free — which is what the release path ships while no provisioning
	// profile exists, and what a user can actually launch.
	const fixed = (command, args) => {
		const joined = args.join(" ");
		if (joined === "-p process.exit(0)") {
			return {
				status: 0,
				signal: null,
				timedOut: false,
				stdout: "",
				stderr: "",
			};
		}
		if (joined.includes("stapler validate")) {
			return { status: 0, stdout: "The validate action worked!", stderr: "" };
		}
		if (joined.includes("--entitlements")) {
			// The committed plist, read back off the artifact: sandbox and
			// hardened-runtime keys only, no restricted claim.
			return {
				status: 0,
				stdout:
					"<key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.network.client</key><true/>",
				stderr: "",
			};
		}
		if (command === "/usr/bin/codesign") {
			return { status: 0, stdout: "", stderr: "" };
		}
		return {
			status: 0,
			stdout: "accepted\nsource=Notarized Developer ID",
			stderr: "",
		};
	};
	assert.equal(
		summarize(runChecks({ appPath: APP, dmgPath: DMG, run: fixed })).ok,
		true,
	);
});

// ---------------------------------------------------------------------------
// The 0.29.6 class: a restricted entitlement with no profile behind it
// ---------------------------------------------------------------------------

/**
 * The real v0.29.6 release signature's entitlements, with the team id replaced.
 *
 * Captured with `codesign -d --entitlements - --xml` from the bundle the
 * operator's machine updated itself into on 2026-09-19, and sanitized in exactly
 * one respect: the team id is a release secret this repository does not publish,
 * so it is the synthetic id the other fixtures use. Everything else is what
 * shipped — thirteen unrestricted sandbox/hardened-runtime keys, and
 * `keychain-access-groups` carrying `<TEAM_ID>.<BUNDLE_ID>.webauthn`.
 *
 * This is the negative fixture both directions are asserted against. The same
 * signature answers `codesign --verify --deep --strict` with exit 0, `spctl -a
 * -vvv -t exec` with "accepted / Notarized Developer ID" and `stapler validate`
 * with success (all measured on the real bundle), which is why the checks below
 * have to ask a different question than the ones already in this file.
 */
const V0296_SIGNATURE_ENTITLEMENTS = `<plist version="1.0"><dict><key>com.apple.security.cs.allow-dyld-environment-variables</key><true/><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/><key>com.apple.security.cs.disable-library-validation</key><true/><key>com.apple.security.device.audio-input</key><true/><key>com.apple.security.device.camera</key><true/><key>com.apple.security.device.microphone</key><true/><key>com.apple.security.device.screen-capture</key><true/><key>com.apple.security.files.bookmarks.app-scope</key><true/><key>com.apple.security.files.downloads.read-write</key><true/><key>com.apple.security.files.user-selected.read-write</key><true/><key>com.apple.security.network.client</key><true/><key>com.apple.security.network.server</key><true/><key>keychain-access-groups</key><array><string>AB12CD34EF.com.local-operator.webauthn</string></array></dict></plist>`;

/** A bundle laid out enough for the gate: an Info.plist naming the executable and
 * the bundle id, and a file where that executable would be.
 *
 * The "executables" are four bytes of Mach-O magic with the execute bit, not the
 * literal word `fixture`, and that is load-bearing: `profileAuthorizationCheck`
 * finds the files it judges by walking for Mach-O headers, so a fixture holding
 * text would make the walk inspect nothing and pass for the wrong reason. The set
 * can be widened with `helpers` — the shape that matters here, since a bundle
 * whose launcher is clean and whose helpers are not is what 0.29.6 shipped.
 */
function gateFixtureBundle(prefix, { profile = null, helpers = [] } = {}) {
	const dir = tempDir(prefix);
	const app = join(dir, "Local Operator.app");
	mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
	writeFileSync(
		join(app, "Contents", "Info.plist"),
		"<key>CFBundleIdentifier</key><string>com.local-operator</string><key>CFBundleExecutable</key><string>Local Operator</string>",
	);
	writeMachO(join(app, "Contents", "MacOS", "Local Operator"));
	for (const helper of helpers) {
		const path = join(app, helper);
		mkdirSync(dirname(path), { recursive: true });
		writeMachO(path);
	}
	if (profile != null)
		writeFileSync(join(app, "Contents", "embedded.provisionprofile"), profile);
	return app;
}

/** The four bytes `machOFiles` reads, 64-bit little-endian (`cffaedfe`), plus
 * the execute bit that makes it a file the bundle can spawn. */
function writeMachO(path) {
	writeFileSync(path, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
	chmodSync(path, 0o755);
}

/**
 * A `run` that answers for a bundle everything except the spawn probe says yes
 * to, with the signature's entitlements supplied per case.
 *
 * The probe's answer is the one measured on the real 0.29.6 bundle: killed by a
 * signal at exec, no output (a shell reports that as `Killed: 9`, exit 137).
 * `spawnRunner` turns it into `status: null, signal: "SIGKILL"`; the stub
 * produces that same shape rather than a fabricated exit code, because the
 * predicate's whole point is that this shape is red — and because a signal death
 * has no exit status to report (QA round 1, Q1).
 *
 * `entitlements` is a plist string, or a function of the file being read when a
 * case needs to differ per executable: the authorization walk reads every
 * Mach-O in the bundle, and "the launcher is clean and the helper is not" is the
 * case that tells the walk apart from the single `codesign` call it replaced.
 */
function gateRunner({ entitlements, profileDump = null, spawnFails = false }) {
	const claimedIn = (path) =>
		typeof entitlements === "function" ? entitlements(path) : entitlements;
	return (command, args) => {
		const joined = args.join(" ");
		if (joined === "-p process.exit(0)") {
			return spawnFails
				? {
						status: null,
						signal: "SIGKILL",
						timedOut: false,
						stdout: "",
						stderr: "",
					}
				: { status: 0, signal: null, timedOut: false, stdout: "", stderr: "" };
		}
		if (command.endsWith("/security")) {
			return {
				status: profileDump ? 0 : 1,
				stdout: profileDump ?? "",
				stderr: "",
			};
		}
		if (joined.includes("--entitlements")) {
			return {
				status: 0,
				stdout: claimedIn(args[args.length - 1]),
				stderr: "",
			};
		}
		if (command === "/usr/bin/codesign")
			return { status: 0, stdout: "", stderr: "" };
		if (joined.includes("-t exec"))
			return {
				status: 0,
				stdout: "accepted\nsource=Notarized Developer ID",
				stderr: "",
			};
		if (joined.includes("stapler validate"))
			return { status: 0, stdout: "The validate action worked!", stderr: "" };
		throw new Error(`unexpected command: ${command} ${joined}`);
	};
}

test("every executable's claim is judged, not only the launcher's", () => {
	/*
	 * The shape this test exists for is the one 0.29.6 actually shipped and the
	 * first version of this gate got wrong: the launcher clean, the helpers not.
	 * Measured on the operator's real bundle, the group is on EIGHT of its sixteen
	 * executables — `ShipIt`, the four helpers, the crashpad handler and the
	 * bundled python among them — and `ShipIt` is the one the updater execs to
	 * relaunch, so a launcher-only check passes a bundle that dies exactly where
	 * 0.29.6 died. The assertion has to name the helper, not just fail.
	 */
	const helper =
		"Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt";
	const launcherClean = gateFixtureBundle("lo-gate-helper-", {
		helpers: [helper],
	});
	const clean = "<key>com.apple.security.cs.allow-jit</key><true/>";
	// `[authorization, readability]`, in that order. The split is not cosmetic:
	// `verify-signed-update.mjs` classifies by id, and the read half is the host's
	// capability question while the authorization half is the candidate's own
	// (review round 2).
	const [twoClaims, twoClaimsReadable] = profileAuthorizationCheck(
		launcherClean,
		{
			run: gateRunner({
				entitlements: (path) =>
					path.endsWith("ShipIt") ? V0296_SIGNATURE_ENTITLEMENTS : clean,
			}),
		},
	);
	assert.equal(twoClaims.passed, false);
	assert.equal(twoClaims.id, "app-profile-authorization");
	assert.match(twoClaims.output, /ShipIt claims keychain-access-groups/);
	// "1 of 2" rather than "an executable is suspicious": the launcher's clean signature
	// was read and PASSED in the same walk, which is what makes this a walk rather
	// than a lucky single read — the old single-`codesign` call saw the launcher only
	// and called this bundle clean.
	assert.match(twoClaims.output, /1 of 2 executable\(s\)/);
	// Every signature WAS readable, so the read row passes: the two are independent
	// questions and a bundle can only fail one of them.
	assert.equal(twoClaimsReadable.passed, true);
	assert.equal(twoClaimsReadable.id, "app-entitlements-readable");

	// The same bundle with the claim removed everywhere: the shipped default, and
	// green — the walk is not simply "helpers are suspicious".
	const [groupFree] = profileAuthorizationCheck(launcherClean, {
		run: gateRunner({ entitlements: clean }),
	});
	assert.equal(groupFree.passed, true);
	assert.match(groupFree.output, /2 executable\(s\) inspected/);

	// A profile that authorizes the claim: the passkey arrangement done right, and
	// the one state in which `ShipIt` may carry the group.
	const authorized = gateFixtureBundle("lo-gate-auth-", {
		helpers: [helper],
		profile: "synthetic\n",
	});
	const [withProfile] = profileAuthorizationCheck(authorized, {
		run: gateRunner({
			entitlements: V0296_SIGNATURE_ENTITLEMENTS,
			profileDump:
				"<plist><dict><key>Entitlements</key><dict><key>keychain-access-groups</key><array><string>AB12CD34EF.com.local-operator.webauthn</string></array></dict></dict></plist>",
		}),
	});
	assert.equal(withProfile.passed, true);

	// "We could not ask" is not "nothing is claimed": a signature whose
	// entitlements cannot be read is red here rather than an empty plist that
	// passes because `[].every()` is true (review round 1, finding 3) — and it is
	// the READ row that carries it, so the harness can bucket it as BLOCKED rather
	// than as a candidate failure (review round 2).
	const [unreadableClaim, unreadableRead] = profileAuthorizationCheck(
		launcherClean,
		{
			run: (command, args) =>
				args.join(" ").includes("--entitlements")
					? { status: 1, stdout: "", stderr: "bundle format unrecognized" }
					: gateRunner({ entitlements: clean })(command, args),
		},
	);
	assert.equal(unreadableRead.passed, false);
	assert.match(unreadableRead.output, /could not be read/);
	// An unreadable signature claims nothing this walk can see, so the
	// authorization row is silent: the two rows must not both shout about one cause.
	assert.equal(unreadableClaim.passed, true);

	// Fail-closed on an EMPTY population (review round 2, finding 3): a bundle
	// whose executables the walk cannot find has not been answered about, and
	// `[].every()` is how that reads as a pass. Measured case: the app directory
	// exists and holds no Mach-O at all.
	const emptyApp = join(tempDir("lo-gate-empty-"), "Local Operator.app");
	mkdirSync(join(emptyApp, "Contents", "Resources"), { recursive: true });
	const [noPopulation, noPopulationRead] = profileAuthorizationCheck(emptyApp, {
		run: () => ({ status: 0, stdout: "", stderr: "" }),
	});
	assert.equal(noPopulation.passed, false);
	assert.match(
		noPopulation.output,
		/no executable was found in the bundle to judge/,
	);
	assert.equal(noPopulationRead.passed, false);
	assert.match(noPopulationRead.output, /no executable was found to read/);

	// A bundle that cannot be walked reports a row rather than throwing out of the
	// gate: the release step asks for a report, and a stack trace is not one.
	const [unwalkable, unwalkableRead] = profileAuthorizationCheck(
		join(tempDir("lo-gate-missing-"), "Local Operator.app"),
		{ run: () => ({ status: 0, stdout: "", stderr: "" }) },
	);
	assert.equal(unwalkable.passed, false);
	assert.match(unwalkable.output, /could not be walked for executables/);
	assert.equal(unwalkableRead.passed, false);
	assert.match(unwalkableRead.output, /could not be walked for executables/);
});

test("the spawn probe owns its env, whatever signature the runner has", () => {
	/*
	 * Why this is asserted here rather than left to the runner: `env` is a parameter
	 * the runner has to forward, and a runner that does not forward it drops
	 * `ELECTRON_RUN_AS_NODE` SILENTLY — which turns the probe into a real app launch.
	 * QA round 2 measured that from a scratch harness: five stray executions of the
	 * app binary, every one of them raising and FOCUSING the operator's window (the
	 * app's own `[window-raise]` line for each). The check applies its own
	 * environment, so a runner of any signature — including one that ignores the
	 * parameters it is handed and inherits the process environment, which is what
	 * `spawnSync` does by default — sees the switch the probe depends on.
	 */
	const app = gateFixtureBundle("lo-gate-env-");
	const probeSaw = [];
	// A runner that takes the first three arguments and nothing else: the shape that
	// dropped the switch. It reads the process environment, which is what a
	// `spawnSync`-based runner does by default.
	const threeArgumentRunner = (command, args, input) => {
		void command;
		void input;
		if (args.join(" ").includes("process.exit(0)"))
			probeSaw.push(process.env.ELECTRON_RUN_AS_NODE ?? null);
		return { status: 0, signal: null, timedOut: false, stdout: "", stderr: "" };
	};
	const rows = runChecks({
		appPath: app,
		dmgPath: null,
		run: threeArgumentRunner,
	});
	assert.ok(rows.length > 0, "the checks did not run at all");
	// Exactly once, and with the switch: the probe is the only check that carries it,
	// so a null here is the switch being dropped on the way to the child.
	assert.deepEqual(
		probeSaw,
		["1"],
		"ELECTRON_RUN_AS_NODE did not reach the runner: a drop-in runner would launch the real app",
	);
	// And it is restored afterwards, so no later check inherits node mode.
	assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined);
});

test("the gate's own results carry the bundle-walk rows", () => {
	/*
	 * The walk left the censused `artifactChecks` list when it became a scan of the
	 * bundle, so nothing in the census asserts it any more — and dropping one of the
	 * three call sites (`checkApp`, the app loop, `verify-signed-update.mjs`) would
	 * leave a green suite, a step still printing plenty of output, and a gate that
	 * quietly stopped asking the question this change exists for. `require-report.sh`
	 * cannot see that either: it reads that a report was produced, not which
	 * questions it asked (review round 2, finding 1).
	 */
	const dist = tempDir("lo-dist-walk-");
	const app = join(dist, "mac-arm64", "Local Operator.app");
	mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
	writeFileSync(
		join(app, "Contents", "Info.plist"),
		"<key>CFBundleIdentifier</key><string>com.local-operator</string><key>CFBundleExecutable</key><string>Local Operator</string>",
	);
	writeMachO(join(app, "Contents", "MacOS", "Local Operator"));
	writeFileSync(join(dist, "local-operator-ui-0.0.0-arm64.dmg"), "x");

	const result = verifyArtifacts({
		dist,
		run: () => ({ status: 0, stdout: "accepted", stderr: "" }),
		log: () => {},
	});
	const ids = new Set(result.results.map((row) => row.id));
	// Both halves by id: the authorization row is what makes a candidate FAIL this
	// job, and the read row is what makes an unsigned one BLOCKED instead.
	for (const id of ["app-profile-authorization", "app-entitlements-readable"]) {
		assert.ok(
			ids.has(id),
			`${id} is declared but never reached: the gate ran ${JSON.stringify([...ids])}`,
		);
	}
	const walkRows = result.results.filter((row) =>
		["app-profile-authorization", "app-entitlements-readable"].includes(row.id),
	);
	assert.equal(
		walkRows.filter((row) => row.passed).length,
		walkRows.length,
		`a fixture bundle claiming no restricted entitlement must pass both rows: ${JSON.stringify(walkRows)}`,
	);
});

test("the gate's policy predicate and the app's agree on every key", () => {
	/*
	 * The JSON is shared, so a SPELLING can only be wrong once — but the PREDICATE
	 * (`includes` plus the prefix loop, and the empty-string-means-nothing rule)
	 * exists twice, in `scripts/macos-entitlement-policy.mjs` and in the app's
	 * `update-install.ts`, and nothing tied the two together: a change to one copy
	 * alone would leave the gate and the pre-flight disagreeing about which claims
	 * need a profile, which is the drift the shared file's own docstring says it
	 * exists to prevent (review round 1, finding 2). This is the tie.
	 */
	const keys = [
		...policy.POLICY.unrestrictedEntitlementKeys,
		...policy.POLICY.unrestrictedEntitlementPrefixes.map(
			(prefix) => `${prefix}something`,
		),
		// The real 0.29.6 claim, a synthetic restricted one, and one nobody has
		// invented yet — the fail-closed direction.
		"keychain-access-groups",
		"com.apple.developer.associated-domains",
		"com.apple.some.future.thing",
		"",
	];
	for (const key of keys) {
		assert.equal(
			install.isProfileBackedEntitlement(key),
			policy.isProfileBackedEntitlement(key),
			`the app and the gate disagree about ${JSON.stringify(key)}`,
		);
	}
	// The scan, over the same plist: both sides must pick the same keys out.
	assert.deepEqual(
		install.profileBackedEntitlementKeys(V0296_SIGNATURE_ENTITLEMENTS),
		policy.profileBackedEntitlementKeys(V0296_SIGNATURE_ENTITLEMENTS),
	);
	assert.deepEqual(
		install.profileBackedEntitlementKeys(""),
		policy.profileBackedEntitlementKeys(""),
	);
});

test("the gate refuses the 0.29.6 signature and passes the group-free one", () => {
	const bricked = gateFixtureBundle("lo-gate-brick-");
	// The real broken signature: a restricted claim, no profile, and a spawn the OS
	// refuses. Two findings from `runChecks` — the third question this bundle raises,
	// whether EVERY executable's claim is authorized rather than just the launcher's,
	// is the walk asserted on its own below.
	assert.deepEqual(
		summarize(
			runChecks({
				appPath: bricked,
				dmgPath: null,
				run: gateRunner({
					entitlements: V0296_SIGNATURE_ENTITLEMENTS,
					spawnFails: true,
				}),
			}),
		).failures.map((result) => result.id),
		["app-spawn", "app-webauthn-entitlement"],
	);

	// The shipped default: the committed plist, no restricted claim at all. This
	// is the bundle the release path produces while no profile exists, and it has
	// to pass — the old `app-webauthn-entitlement` failed exactly here.
	const groupFree = gateFixtureBundle("lo-gate-free-");
	assert.deepEqual(
		summarize(
			runChecks({
				appPath: groupFree,
				dmgPath: null,
				run: gateRunner({
					entitlements:
						"<key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.network.client</key><true/>",
				}),
			}),
		).ok,
		true,
	);

	// The passkey arrangement done right: the claim is present AND the embedded
	// profile authorizes exactly that group, which is the only state in which the
	// group may be signed in.
	const authorized = gateFixtureBundle("lo-gate-auth-", {
		profile: "synthetic\n",
	});
	assert.deepEqual(
		summarize(
			runChecks({
				appPath: authorized,
				dmgPath: null,
				run: gateRunner({
					entitlements: V0296_SIGNATURE_ENTITLEMENTS,
					profileDump:
						"<plist><dict><key>Entitlements</key><dict><key>keychain-access-groups</key><array><string>AB12CD34EF.com.local-operator.webauthn</string></array></dict></dict></plist>",
				}),
			}),
		).failures.map((result) => result.id),
		[],
	);

	// A profile that authorizes a DIFFERENT group is the other half of the rule: the
	// claim is authorized, so macOS spawns the app and `app-profile-authorization`
	// passes — what is wrong is the feature, which can never work because Chromium
	// asks for the exact group in the signature. That is `app-webauthn-entitlement`'s
	// job, and it is why the two checks are not one.
	const wrongProfile = gateFixtureBundle("lo-gate-wrong-", {
		profile: "synthetic\n",
	});
	assert.deepEqual(
		summarize(
			runChecks({
				appPath: wrongProfile,
				dmgPath: null,
				run: gateRunner({
					entitlements: V0296_SIGNATURE_ENTITLEMENTS,
					profileDump:
						"<plist><dict><key>Entitlements</key><dict><key>keychain-access-groups</key><array><string>AB12CD34EF.com.somebody-else.webauthn</string></array></dict></dict></plist>",
				}),
			}),
		).failures.map((result) => result.id),
		["app-webauthn-entitlement"],
	);

	// The predicate itself, so the cases above are not the only statement of it.
	assert.equal(
		profileAuthorizes(
			"<key>keychain-access-groups</key><array><string>AB12CD34EF.com.local-operator.webauthn</string></array>",
			"keychain-access-groups",
			"com.local-operator",
			"AB12CD34EF.com.local-operator.webauthn",
		),
		true,
	);
	assert.equal(profileAuthorizes(null, "keychain-access-groups"), false);
	assert.equal(
		profileAuthorizes("", "com.apple.developer.associated-domains"),
		false,
	);
});

test("the update pre-flight refuses the artifact macOS would not launch", () => {
	const block = install.stagedSignatureBlock({
		entitlementsPlist: V0296_SIGNATURE_ENTITLEMENTS,
		embeddedProfile: false,
		artifactName: "local-operator-ui-0.29.6-arm64.zip",
		version: "0.29.6",
	});
	assert.equal(block.code, "artifact-cannot-launch");
	assert.match(block.message, /update to version 0\.29\.6 can't be launched/);
	// The remedy is NOT the download page (design round 1, D1). Every affordance
	// behind `DOWNLOAD_PAGE_URL` resolves to `releases/latest`, which is the channel
	// that staged this artifact: sending the reader there hands them the bundle this
	// check just refused and asks them to install it by hand, past every gate added
	// to stop it. It names the version to avoid instead, which is true both when
	// `latest` is the broken build and when it is fine.
	assert.equal(block.remedy.url, undefined);
	assert.equal(block.remedy.command, undefined);
	assert.match(block.remedy.text, /skip version 0\.29\.6/);
	assert.match(block.remedy.text, /next release will be offered/);
	// The dismiss control must not promise a retry this state says cannot happen
	// (design round 1, D6), and this arm needs no heading override: it established
	// the refusal, so the renderer's heading map is the right one.
	assert.equal(block.dismissLabel, "Not now");
	assert.equal(block.heading, undefined);
	// The detail names the cause, not just the symptom: it is what a support thread
	// has to quote, and the entitlement alone would not say why it matters. Trimmed
	// to the facts a reader can check (design round 1, D4) — which archive, which
	// claim, which file is missing — because the full rule made the details block
	// 44% of the panel.
	assert.match(block.detail, /keychain-access-groups/);
	assert.match(block.detail, /embedded\.provisionprofile/);
	assert.ok(
		block.detail.length < 160,
		`detail is ${block.detail.length} characters; the panel's mono column is ~10 lines at 250`,
	);

	// The positive direction: the committed, group-free signature is what the
	// release path ships now, and it must install.
	assert.equal(
		install.stagedSignatureBlock({
			entitlementsPlist:
				"<key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.network.client</key><true/>",
			embeddedProfile: false,
			artifactName: "local-operator-ui-0.30.0-arm64.zip",
			version: "0.30.0",
		}),
		null,
	);
	// Passkeys enabled, profile embedded: the arrangement that works.
	assert.equal(
		install.stagedSignatureBlock({
			entitlementsPlist: V0296_SIGNATURE_ENTITLEMENTS,
			embeddedProfile: true,
			artifactName: "local-operator-ui-0.30.0-arm64.zip",
			version: "0.30.0",
		}),
		null,
	);
	// "We could not read the signature" is not "nothing is claimed": refused when
	// no profile is embedded, allowed when one is. It is also a DIFFERENT state from
	// the arm above, so it carries its own heading and its own remedy: the body
	// declines to assert that macOS refused anything, and a heading asserting it
	// would contradict the sentence under it (design round 1, D3).
	const unchecked = install.stagedSignatureBlock({
		entitlementsPlist: null,
		embeddedProfile: false,
		artifactName: "unknown.zip",
		version: "0.29.6",
	});
	assert.equal(unchecked?.code, "artifact-cannot-launch");
	assert.equal(unchecked?.heading, "The update couldn't be checked");
	assert.match(unchecked?.message, /can't be checked for launch/);
	assert.match(unchecked?.remedy.text, /Check for updates again/);
	assert.equal(unchecked?.remedy.url, undefined);
	assert.equal(unchecked?.dismissLabel, "Not now");
	assert.equal(
		install.stagedSignatureBlock({
			entitlementsPlist: null,
			embeddedProfile: true,
			artifactName: "unknown.zip",
		}),
		null,
	);

	// The policy the app and the gate share, stated once: the sandbox and
	// hardened-runtime families need no profile, and anything else does — including
	// spellings nobody has invented yet, which is the fail-closed direction.
	assert.equal(
		install.isProfileBackedEntitlement("com.apple.security.cs.allow-jit"),
		false,
	);
	assert.equal(
		install.isProfileBackedEntitlement("com.apple.security.device.camera"),
		false,
	);
	assert.equal(
		install.isProfileBackedEntitlement("keychain-access-groups"),
		true,
	);
	assert.equal(
		install.isProfileBackedEntitlement(
			"com.apple.developer.associated-domains",
		),
		true,
	);
	assert.equal(
		install.isProfileBackedEntitlement("com.apple.some.future.thing"),
		true,
	);
});

test("the artifact's own members decide, and the wrong binary is not read", () => {
	// A listing shaped like the real 0.29.6 archive: the helper bundles' own
	// Contents/MacOS entries come FIRST, and only the top-level app's executable is
	// the one launchd would run. Reading a helper would answer about the wrong
	// binary — and in this incident the helpers were refused too, for the same
	// reason, so a check bound to the wrong file could still look right.
	const listing = [
		"Local Operator.app/",
		"Local Operator.app/Contents/Frameworks/",
		"Local Operator.app/Contents/Frameworks/Local Operator Helper (GPU).app/Contents/MacOS/Local Operator Helper (GPU)",
		"Local Operator.app/Contents/Frameworks/Local Operator Helper (Renderer).app/Contents/MacOS/Local Operator Helper (Renderer)",
		"Local Operator.app/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt",
		"Local Operator.app/Contents/Info.plist",
		"Local Operator.app/Contents/MacOS/",
		"Local Operator.app/Contents/MacOS/Local Operator",
	].join("\n");
	assert.equal(
		install.zipMainExecutableEntry(listing),
		"Local Operator.app/Contents/MacOS/Local Operator",
	);
	assert.equal(install.zipListingHasEmbeddedProfile(listing), false);
	assert.equal(
		install.zipListingHasEmbeddedProfile(
			`${listing}\nLocal Operator.app/Contents/embedded.provisionprofile`,
		),
		true,
	);
	assert.equal(
		install.zipMainExecutableEntry("Local Operator.app/Contents/MacOS/"),
		null,
	);
	assert.equal(install.zipListingHasEmbeddedProfile(""), false);
});

test("missing artifacts fail rather than passing vacuously", () => {
	const dir = tempDir("lo-dist-");
	mkdirSync(join(dir, "mac-arm64"), { recursive: true });
	const app = join(dir, "mac-arm64", "Local Operator.app");
	mkdirSync(app, { recursive: true });

	assert.equal(discoverApp(dir), app);
	assert.equal(discoverDmg(dir), null);
	assert.deepEqual(discoverArtifacts(dir).apps, [app]);
	assert.deepEqual(discoverArtifacts(dir).errors, []);

	const lines = [];
	const result = verifyArtifacts({
		dist: dir,
		run: () => ({ status: 0, stdout: "accepted", stderr: "" }),
		log: (line) => lines.push(line),
	});
	assert.equal(result.ok, false);
	assert.match(lines.join("\n"), /No disk image found/);
});

/**
 * Every image the build produced is asserted, not the first one found.
 *
 * `mac.target` builds a dmg and a zip for each architecture, so checking only
 * the first of each was complete by accident rather than by construction, and a
 * malformed bundle or image for the second architecture would have shipped
 * unaudited (review R9).
 */
test("every discovered image is checked, and an unreadable entry fails cleanly", () => {
	const dir = tempDir("lo-dist-multi-");
	/** The `lipo -archs` answer per bundle, because the check reads the answer. */
	const lipoGroups = new Map();
	// `mac` is where an x64 build lands and `mac-arm64` where an arm64 one does:
	// electron-builder suffixes the app directory for every architecture except
	// the default one, so neither is `mac-x64`.
	mkdirSync(join(dir, "mac-arm64"), { recursive: true });
	mkdirSync(join(dir, "mac"), { recursive: true });
	for (const [archDir, tree, arch] of [
		["mac-arm64", "python-runtime-seed/arm64", "arm64"],
		["mac", "python-runtime-seed/x64", "x86_64"],
	]) {
		const app = join(dir, archDir, "Local Operator.app");
		mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
		// The framework binary the interpreter check reads the bundle's
		// architecture from, and the one interpreter `afterPack` leaves for it.
		const framework = join(
			app,
			"Contents",
			"Frameworks",
			"Electron Framework.framework",
			"Versions",
			"A",
			"Electron Framework",
		);
		mkdirSync(dirname(framework), { recursive: true });
		writeFileSync(framework, `binary for ${arch}`, "utf8");
		lipoGroups.set(framework, arch);
		const treeDir = join(app, "Contents", "Resources", tree);
		mkdirSync(treeDir, { recursive: true });
		// No access-control entry is planted here any more: the build-time seal is
		// retired (`scripts/after-pack.mjs`), and what this fixture asserts is the
		// structural property - exactly one private seed tree per architecture, under
		// the name that architecture resolves, with no legacy alias beside it.
	}
	writeFileSync(join(dir, "local-operator-ui-0.18.0-arm64.dmg"), "x");
	writeFileSync(join(dir, "local-operator-ui-0.18.0-x64.dmg"), "x");

	const discovered = discoverArtifacts(dir);
	assert.equal(discovered.apps.length, 2);
	assert.equal(discovered.dmgs.length, 2);

	const checked = [];
	const lines = [];
	const result = verifyArtifacts({
		dist: dir,
		run: (command, args) => {
			checked.push(args[args.length - 1]);
			// `lipo -archs` is the one command whose answer the check reads rather
			// than its status, and the answer is per bundle.
			if (command.endsWith("lipo")) {
				const group = lipoGroups.get(args[args.length - 1]);
				return { status: 0, stdout: `${group}\n`, stderr: "" };
			}
			return { status: 0, stdout: "accepted", stderr: "" };
		},
		log: (line) => lines.push(line),
	});
	// These are deliberately fake image bytes. Signing mocks cannot make the
	// final copied-out app check pass without an application in the container.
	assert.equal(result.ok, false);
	assert.equal(
		result.results.filter(
			(row) => row.id === "final-container-app" && !row.passed,
		).length,
		2,
	);
	// Named groups rather than one magic total: a total that silently absorbs a
	// new check is how a check nobody audited gets counted as covered.
	for (const appPath of discovered.apps) {
		for (const id of [
			"app-no-bundled-bytecode",
			"app-one-bundled-python",
			"app-private-python-seed",
		]) {
			assert.equal(
				result.results.filter((row) => row.id === id && row.target === appPath)
					.length,
				1,
				`${appPath}: ${id} must be asserted exactly once`,
			);
		}
	}
	// And every container the build produced is opened: the delivered ZIP and the
	// delivered DMG, not only the unpacked app electron-builder left in `dist`.
	assert.equal(
		result.results.filter((row) => row.id === "final-container-app").length,
		discovered.dmgs.length,
		"each disk image is copied out and its app asserted",
	);
	// Each artifact the build produced was opened by the injected runner rather
	// than by a real tool: the filesystem walks are the exception, and the target
	// assertions below are what proves the rest went through it.
	for (const target of [...discovered.apps, ...discovered.dmgs]) {
		assert.ok(checked.includes(target), `${target} was never checked`);
	}
	for (const target of [...discovered.apps, ...discovered.dmgs]) {
		assert.match(lines.join("\n"), new RegExp(target.replace(/[/.]/g, "\\$&")));
	}

	// A broken symlink where an image should be fails the check rather than
	// throwing out of discovery.
	const brokenDir = tempDir("lo-dist-broken-");
	mkdirSync(join(brokenDir, "mac-arm64"), { recursive: true });
	spawnSync("/bin/ln", [
		"-s",
		"/nonexistent/dist",
		join(brokenDir, "mac-arm64", "Ghost.app"),
	]);
	const brokenChecks = [];
	const brokenResult = verifyArtifacts({
		dist: brokenDir,
		run: () => ({ status: 0, stdout: "accepted", stderr: "" }),
		log: (line) => brokenChecks.push(line),
	});
	assert.equal(brokenResult.ok, false);
	assert.match(brokenChecks.join("\n"), /could not be read/);
});

test("the real macOS tools reject an unsigned image, on macOS", async (t) => {
	if (process.platform !== "darwin") {
		t.skip("macOS only");
		return;
	}

	const dir = tempDir("lo-artifact-");
	const source = join(dir, "payload");
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, "README.txt"), "fixture\n", "utf8");

	const dmg = join(dir, "local-operator-ui-0.0.0-arm64.dmg");
	const created = spawnSync(
		"/usr/bin/hdiutil",
		[
			"create",
			"-quiet",
			"-volname",
			"Local Operator Fixture",
			"-srcfolder",
			source,
			"-ov",
			"-format",
			"UDZO",
			dmg,
		],
		{ encoding: "utf8" },
	);
	assert.equal(created.status, 0, created.stderr);

	// An unsigned and unnotarized image, made on this machine: exactly the
	// property the 0.17.0 release shipped, and the assertions have to catch it.
	const checks = runChecks({
		appPath: null,
		dmgPath: dmg,
		run: (command, args) => {
			const result = spawnSync(command, args, { encoding: "utf8" });
			return {
				status: result.status ?? 1,
				stdout: result.stdout ?? "",
				stderr: result.stderr ?? "",
			};
		},
	});
	const verdict = summarize(checks);
	assert.equal(verdict.ok, false);
	assert.deepEqual(verdict.failures.map((result) => result.id).sort(), [
		"dmg-spctl",
		"dmg-stapler",
	]);

	// The operator's own downloaded 0.17.0 image is the real negative fixture.
	// It is 366 MB and machine-local, so it is checked only when it is there -
	// and the synthetic case above is what keeps this runnable in CI.
	const fixture =
		process.env.LO_UI_DMG_FIXTURE ??
		join(
			process.env.HOME ?? "",
			"Downloads",
			"local-operator-ui-0.17.0-universal.dmg",
		);
	if (!existsSync(fixture)) {
		console.log(
			`Skipped the shipped-artifact fixture: no image at ${fixture} (set LO_UI_DMG_FIXTURE to include it).`,
		);
		return;
	}
	const shippedChecks = summarize(
		runChecks({
			appPath: null,
			dmgPath: fixture,
			run: (command, args) => {
				const result = spawnSync(command, args, { encoding: "utf8" });
				return {
					status: result.status ?? 1,
					stdout: result.stdout ?? "",
					stderr: result.stderr ?? "",
				};
			},
		}),
	);
	assert.equal(shippedChecks.ok, false);
	assert.deepEqual(shippedChecks.failures.map((result) => result.id).sort(), [
		"dmg-spctl",
		"dmg-stapler",
	]);
});

// ---------------------------------------------------------------------------
// Disk image notarization step
// ---------------------------------------------------------------------------

test("the disk image step targets every image and leaves the app archives alone", () => {
	const artifacts = [
		"/dist/local-operator-ui-0.18.0-arm64.dmg",
		"/dist/local-operator-ui-0.18.0-arm64.zip",
		"/dist/local-operator-ui-0.18.0-x64.dmg",
		"/dist/local-operator-ui-0.18.0-x64.zip",
		"/dist/latest-mac.yml",
	];
	// Both architectures: `mac.target` builds one image per arch, and an image
	// nobody notarizes is the 0.17.0 Gatekeeper failure for that arch's users.
	assert.deepEqual(dmgArtifacts(artifacts), [
		"/dist/local-operator-ui-0.18.0-arm64.dmg",
		"/dist/local-operator-ui-0.18.0-x64.dmg",
	]);

	const dir = tempDir("lo-zip-");
	const dmg = join(dir, "app.dmg");
	writeFileSync(dmg, "image");
	assert.equal(removeTransientZip(dmg), null);
	const zip = `${dmg}.zip`;
	writeFileSync(zip, "transient");
	assert.equal(removeTransientZip(dmg), zip);
	assert.equal(existsSync(zip), false);
	assert.equal(existsSync(dmg), true);
});

test("stapling rewrites the image hash in the update metadata, and nothing else", () => {
	const yml = [
		"version: 0.18.0",
		"files:",
		"  - url: local-operator-ui-0.18.0-arm64.zip",
		"    sha512: ZIPHASH",
		"    size: 352792235",
		"  - url: local-operator-ui-0.18.0-arm64.dmg",
		"    sha512: PRE_STAPLE",
		"    size: 366211328",
		"path: local-operator-ui-0.18.0-arm64.zip",
		"sha512: ZIPHASH",
		"releaseDate: '2026-09-10T20:51:00.143Z'",
		"",
	].join("\n");

	const updated = updateUpdateYmlEntry(
		yml,
		"local-operator-ui-0.18.0-arm64.dmg",
		{ sha512: "POST_STAPLE", size: 366211329 },
	);
	assert.equal(updated.matched, true);
	assert.equal(updated.replaced, 2);
	assert.match(updated.text, /sha512: POST_STAPLE/);
	assert.match(updated.text, /size: 366211329/);
	assert.equal(updated.text.includes("PRE_STAPLE"), false);
	// The zip entry is the app archive the updater downloads: it must not move.
	assert.equal((updated.text.match(/sha512: ZIPHASH/g) ?? []).length, 2);
	assert.match(updated.text, /releaseDate: '2026-09-10T20:51:00\.143Z'/);

	// A stapled image with no entry in the metadata is reported as unmatched, not
	// silently left with its pre-staple hash: that is the failure that would ship
	// a stale sha512 with no signal (review R8).
	const missing = updateUpdateYmlEntry(yml, "some-other.dmg", {
		sha512: "X",
		size: 1,
	});
	assert.equal(missing.matched, false);
	assert.equal(missing.replaced, 0);
	assert.equal(missing.text, yml);
});

/**
 * The metadata rewrite's own decision, exercised on real files.
 *
 * The case that used to ship: the entry is there, its `sha512`/`size` lines have
 * drifted, nothing is rewritten, and the step passed with the PRE-staple hash
 * still in the file - a hash of bytes nobody downloads, for every user of the
 * release (review R12). `matched` alone cannot answer it, because it is true
 * whenever the `- url:` line exists.
 */
test("stapling fails when the entry is listed but nothing was rewritten", () => {
	const dir = tempDir("lo-yml-");
	const good = join(dir, "latest-mac.yml");
	const drifted = join(dir, "latest.yml");
	const unrelated = join(dir, "latest-linux.yml");
	const yml = (shaKey, sizeKey, hash) =>
		[
			"version: 0.18.0",
			"files:",
			"  - url: local-operator-ui-0.18.0-arm64.dmg",
			`    ${shaKey}: ${hash}`,
			`    ${sizeKey}: 366211328`,
			"",
		].join("\n");
	writeFileSync(good, yml("sha512", "size", "PRE_STAPLE"), "utf8");
	writeFileSync(drifted, yml("sha-512", "bytes", "PRE_STAPLE"), "utf8");
	writeFileSync(unrelated, "version: 0.18.0\nfiles: []\n", "utf8");

	// A matching entry that IS rewritten passes, and the rewrite lands on disk.
	const logs = [];
	rewriteUpdateMetadata({
		ymlPaths: [good],
		name: "local-operator-ui-0.18.0-arm64.dmg",
		sha512: "POST_STAPLE",
		size: 366211329,
		log: (line) => logs.push(line),
	});
	assert.match(readFileSync(good, "utf8"), /sha512: POST_STAPLE/);
	assert.equal(logs.length, 1);

	// Listed, matched, and nothing rewritten: that is a failure, and it names the
	// file rather than reporting a missing entry.
	assert.throws(
		() =>
			rewriteUpdateMetadata({
				ymlPaths: [drifted],
				name: "local-operator-ui-0.18.0-arm64.dmg",
				sha512: "POST_STAPLE",
				size: 366211329,
			}),
		/latest\.yml but its sha512\/size lines were not rewritten/,
	);
	assert.match(readFileSync(drifted, "utf8"), /PRE_STAPLE/);

	// Not listed anywhere, and no metadata at all: both fail, with the second
	// saying that nothing was there to re-hash it in (reviews R8, R12).
	assert.throws(
		() =>
			rewriteUpdateMetadata({
				ymlPaths: [unrelated],
				name: "local-operator-ui-0.18.0-arm64.dmg",
				sha512: "POST_STAPLE",
				size: 366211329,
			}),
		/has no entry in latest-linux\.yml/,
	);
	assert.throws(
		() =>
			rewriteUpdateMetadata({
				ymlPaths: [],
				name: "local-operator-ui-0.18.0-arm64.dmg",
				sha512: "POST_STAPLE",
				size: 366211329,
			}),
		/no update metadata was found to re-hash it in/,
	);
});

/**
 * The notarizer is handed an absolute path, whatever form `--dist` took.
 *
 * Why absolute is the assertion rather than "the file exists": the failure this
 * covers only shows up inside `@electron/notarize`, which resolves the path
 * against its own temp dir before uploading, so a relative path that is perfectly
 * valid from the working directory is invalid by the time it is used. 0.17.2's
 * publish run failed in the submission step with "The file couldn't be opened
 * because it doesn't exist" for a path under `T/electron-notarize-*`, which is
 * that temp dir - the image was never there. `--dist dist` is the default and
 * what CI runs, so the relative case is the one that shipped the bug; the
 * absolute case and a relative entry in `artifactPaths` are here because the two
 * spellings of the same directory must not disagree.
 *
 * The image is real (a few bytes) and the metadata is real, because the step
 * hashes and rewrites them after the staple; only the notarizer is a stub.
 */
test("the notarization step hands the notarizer an absolute path", async () => {
	const root = tempDir("lo-notarize-");
	const dist = join(root, "dist");
	mkdirSync(dist, { recursive: true });
	const imageName = "local-operator-ui-0.18.0-arm64.dmg";
	const imagePath = join(dist, imageName);
	writeFileSync(imagePath, "disk image");
	const ymlPath = join(dist, "latest-mac.yml");
	writeFileSync(
		ymlPath,
		[
			"version: 0.18.0",
			"files:",
			`  - url: ${imageName}`,
			"    sha512: PRE_STAPLE",
			"    size: 10",
			"",
		].join("\n"),
		"utf8",
	);

	const platform = Object.getOwnPropertyDescriptor(process, "platform");
	const savedEnv = {
		NOTARIZE: process.env.NOTARIZE,
		APPLE_ID: process.env.APPLE_ID,
		APPLE_ID_PASSWORD: process.env.APPLE_ID_PASSWORD,
		APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
	};
	try {
		// The step is darwin-only and `test:desktop` runs on Linux CI, but the bug
		// is a path resolution mistake with nothing macOS about it, so the platform
		// check is satisfied rather than skipped. Restored in the `finally`.
		Object.defineProperty(process, "platform", {
			value: "darwin",
			configurable: true,
		});
		process.env.NOTARIZE = "true";
		process.env.APPLE_ID = "test@example.invalid";
		process.env.APPLE_ID_PASSWORD = "test-app-specific-password";
		process.env.APPLE_TEAM_ID = "TESTTEAM01";
		globalThis.__loNotarizeCalls = [];
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loNotarizeBehavior;

		// The default CI invocation: `--dist` relative to the working directory.
		const relativeDist = relative(process.cwd(), dist);
		assert.equal(isAbsolute(relativeDist), false, relativeDist);
		await notarizeArtifacts({ dist: relativeDist, log: () => {} });
		assert.equal(globalThis.__loNotarizeCalls.length, 1);
		assert.equal(globalThis.__loNotarizeCalls[0].tool, "notarytool");
		assert.equal(
			isAbsolute(globalThis.__loNotarizeCalls[0].appPath),
			true,
			`a relative --dist reached the notarizer as ${globalThis.__loNotarizeCalls[0].appPath}`,
		);
		assert.equal(
			globalThis.__loNotarizeCalls[0].appPath,
			resolve(dist, imageName),
		);
		// The staple, hash and rewrite all finished on that same file: a wrong path
		// here would have thrown before the rewrite, leaving the pre-staple hash.
		assert.match(readFileSync(ymlPath, "utf8"), /sha512: [A-Za-z0-9+/=]{16}/);
		assert.equal(readFileSync(ymlPath, "utf8").includes("PRE_STAPLE"), false);

		// An absolute `--dist`, and a relative entry in `artifactPaths`, resolve to
		// the same absolute image.
		for (const invocation of [
			{ dist },
			{ dist, artifactPaths: [relative(process.cwd(), imagePath)] },
		]) {
			globalThis.__loNotarizeCalls.length = 0;
			await notarizeArtifacts({ ...invocation, log: () => {} });
			assert.equal(globalThis.__loNotarizeCalls.length, 1);
			assert.equal(globalThis.__loNotarizeCalls[0].appPath, resolve(imagePath));
		}
	} finally {
		if (platform) Object.defineProperty(process, "platform", platform);
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loNotarizeCalls;
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loNotarizeBehavior;
	}
});

/**
 * A rejected notarization fails the step, and the CLI exits non-zero.
 *
 * The release that hit this bug reported "Disk image notarization failed" and
 * failed the job, so the loud half is not the regression - it is the property the
 * fix must not trade away, and the reason it is asserted through the real
 * entrypoint (a child process running the shipped script with the notarizer
 * stubbed by a module resolution hook) rather than only through the exported
 * function: a catch added around the submission later would leave the first
 * assertion green and turn this step into a silent no-op that ships an
 * unnotarized image.
 *
 * The stub also records the path it was handed, so this doubles as a check that
 * the relative `--dist` the CI invocation uses reaches the notarizer absolute on
 * the real command line.
 */
test("a rejected notarization fails the step and exits non-zero", async () => {
	const root = tempDir("lo-notarize-fail-");
	const dist = join(root, "dist");
	mkdirSync(dist, { recursive: true });
	const imageName = "local-operator-ui-0.18.0-arm64.dmg";
	writeFileSync(join(dist, imageName), "disk image");
	const ymlPath = join(dist, "latest-mac.yml");
	const preStapleYml = [
		"version: 0.18.0",
		"files:",
		`  - url: ${imageName}`,
		"    sha512: PRE_STAPLE",
		"    size: 10",
		"",
	].join("\n");
	writeFileSync(ymlPath, preStapleYml, "utf8");

	const platform = Object.getOwnPropertyDescriptor(process, "platform");
	const savedEnv = {
		NOTARIZE: process.env.NOTARIZE,
		APPLE_ID: process.env.APPLE_ID,
		APPLE_ID_PASSWORD: process.env.APPLE_ID_PASSWORD,
		APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
	};
	try {
		Object.defineProperty(process, "platform", {
			value: "darwin",
			configurable: true,
		});
		process.env.NOTARIZE = "true";
		process.env.APPLE_ID = "test@example.invalid";
		process.env.APPLE_ID_PASSWORD = "test-app-specific-password";
		process.env.APPLE_TEAM_ID = "TESTTEAM01";
		globalThis.__loNotarizeCalls = [];
		globalThis.__loNotarizeBehavior = async () => {
			throw new Error("stubbed notarization rejected");
		};
		await assert.rejects(
			notarizeArtifacts({ dist, log: () => {} }),
			/stubbed notarization rejected/,
		);
		// Nothing after the submission ran: the image was not re-hashed, so its
		// metadata still describes the bytes on disk rather than a staple that never
		// happened.
		assert.equal(readFileSync(ymlPath, "utf8"), preStapleYml);
	} finally {
		if (platform) Object.defineProperty(process, "platform", platform);
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loNotarizeCalls;
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loNotarizeBehavior;
	}

	// A module resolution hook substitutes the notarizer for the child, because the
	// shipped script imports it directly; no build step or source rewrite is
	// involved, so the entrypoint under test is the file the release runs.
	const hookDir = join(root, "hook");
	mkdirSync(hookDir, { recursive: true });
	const probeFile = join(root, "notarized-path.txt");
	writeFileSync(
		join(hookDir, "register.mjs"),
		[
			'import { register } from "node:module";',
			// The step is darwin-only and this suite runs on Linux CI, so the platform
			// it checks is satisfied rather than skipped. The bug is a path resolution
			// mistake with nothing macOS about it: the submission never gets far enough
			// for Apple to be involved, and the stub answers instead of the service.
			'Object.defineProperty(process, "platform", { value: "darwin", configurable: true });',
			'register("./resolve.mjs", import.meta.url);',
			"",
		].join("\n"),
	);
	writeFileSync(
		join(hookDir, "resolve.mjs"),
		[
			"export async function resolve(specifier, context, next) {",
			'\tif (specifier === "@electron/notarize") {',
			'\t\treturn { url: new URL("./stub.mjs", import.meta.url).href, shortCircuit: true };',
			"\t}",
			"\treturn next(specifier, context);",
			"}",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(hookDir, "stub.mjs"),
		[
			'import { writeFileSync } from "node:fs";',
			"export async function notarize(opts) {",
			"\twriteFileSync(process.env.LO_NOTARIZE_PROBE_FILE, opts.appPath);",
			'\tthrow new Error("stubbed notarization rejected");',
			"}",
			"",
		].join("\n"),
	);

	const result = spawnSync(
		process.execPath,
		[
			"--import",
			join(hookDir, "register.mjs"),
			"scripts/notarize-artifacts.mjs",
			"--dist",
			relative(process.cwd(), dist),
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			env: {
				...process.env,
				NOTARIZE: "true",
				APPLE_ID: "test@example.invalid",
				APPLE_ID_PASSWORD: "test-app-specific-password",
				APPLE_TEAM_ID: "TESTTEAM01",
				LO_NOTARIZE_PROBE_FILE: probeFile,
			},
		},
	);
	assert.notEqual(
		result.status,
		0,
		`expected a non-zero exit, got ${result.status}`,
	);
	assert.match(result.stderr, /Disk image notarization failed/);
	assert.match(result.stderr, /stubbed notarization rejected/);
	assert.equal(isAbsolute(readFileSync(probeFile, "utf8")), true);
	assert.equal(readFileSync(probeFile, "utf8"), resolve(dist, imageName));
});

/**
 * The two markers a layout cannot answer, read from a prefix on disk.
 *
 * Both mirror `install_kind()` in `local_operator/update.py`: `INSTALLER` names
 * pip for a base-prefix install that writes no `pyvenv.cfg` (the #396 case),
 * and `direct_url.json`'s `dir_info.editable` is the only positive evidence that
 * a prefix is the repo checkout rather than an installed copy.
 */
test("a prefix's dist-info says which installer owns it, and whether it is a checkout", () => {
	/** A prefix with a `local_operator-<version>.dist-info` and a chosen shape. */
	const makePrefix = (name, { pythonDir = "python3.14", files = {} } = {}) => {
		const dir = tempDir(`lo-${name}-`);
		const distInfo = join(
			dir,
			"lib",
			pythonDir,
			"site-packages",
			"local_operator-0.54.20.dist-info",
		);
		mkdirSync(distInfo, { recursive: true });
		for (const [file, contents] of Object.entries(files)) {
			writeFileSync(join(distInfo, file), contents, "utf8");
		}
		return dir;
	};

	// pip's own marker, in a base prefix with no `pyvenv.cfg` at all: the shape
	// the app used to answer `global-unknown` for, naming no command (review R13).
	const basePrefixPip = makePrefix("pip", {
		files: { INSTALLER: "pip\n" },
	});
	assert.deepEqual(resolveDistributionMarkers(basePrefixPip), {
		installer: "pip",
		editable: false,
		// Both read from the same directory walk: the version out of the dist-info
		// name, the provenance out of the marker beside it (absent here).
		version: "0.54.20",
		sourceRef: null,
	});
	assert.equal(
		classifyGlobalInstall({
			path: "/usr/local/bin/local-operator",
			installer: "pip",
		}),
		"pip",
	);
	assert.equal(
		resolveGlobalInstallPlan({
			identity: { path: "/usr/local/bin/local-operator", installer: "pip" },
		}).updateCommand,
		"pip install --upgrade local-operator",
	);

	// The exact-value rule: uv writes `uv`, and that is not pip's answer.
	const uvOwned = makePrefix("uv", { files: { INSTALLER: "uv\n" } });
	assert.equal(resolveDistributionMarkers(uvOwned).installer, "uv");
	assert.equal(
		classifyGlobalInstall({
			path: "/usr/local/bin/local-operator",
			installer: "uv",
		}),
		"global-unknown",
	);

	// A checkout: `dir_info.editable` is the tell, and it outranks the venv layout
	// that pyvenv.cfg would otherwise report as an ordinary pip install (review Q5).
	const checkout = makePrefix("editable", {
		pythonDir: "python3.13",
		files: {
			INSTALLER: "uv\n",
			"direct_url.json": JSON.stringify({
				url: "file:///Users/operator/local-operator",
				dir_info: { editable: true },
			}),
		},
	});
	assert.equal(resolveDistributionMarkers(checkout).editable, true);
	assert.equal(
		classifyGlobalInstall({
			path: "/Users/operator/local-operator/.venv/bin/local-operator",
			venvPrefix: "/Users/operator/local-operator/.venv",
			editable: true,
		}),
		"editable",
	);
	// And an editable install is refused by name, with no command well at all -
	// the shape `editable_refusal()` produces on the Python side.
	const editablePlan = resolveGlobalInstallPlan({
		identity: {
			path: "/Users/operator/local-operator/.venv/bin/local-operator",
			realPath: "/Users/operator/local-operator/.venv/bin/local-operator",
			venvPrefix: "/Users/operator/local-operator/.venv",
			editable: true,
		},
	});
	assert.equal(editablePlan.updateCommand, "");
	assert.equal(editablePlan.sourceBuild, true);
	assert.match(editablePlan.remedy, /source checkout/);
	assert.match(editablePlan.detail, /classified as editable/);

	// A registry (non-editable) direct_url.json is an installed copy, not a checkout.
	const installed = makePrefix("installed", {
		files: {
			INSTALLER: "uv\n",
			"direct_url.json": JSON.stringify({
				url: "https://files.pythonhosted.org/local_operator-0.54.20-py3-none-any.whl",
			}),
		},
	});
	assert.equal(resolveDistributionMarkers(installed).editable, false);

	// A prefix with no distribution at all is not evidence of anything, so the
	// classifier's answer stays "unknown" rather than becoming a guess.
	assert.deepEqual(resolveDistributionMarkers(tempDir("lo-empty-")), {
		installer: null,
		editable: false,
		version: null,
		sourceRef: null,
	});
});

/**
 * The details line has to name the record that explains the failure.
 *
 * The app is dead while ShipIt installs, so the failure notice cannot quote a
 * reason the way the pre-flight refusal can - Squirrel's log is the only thing
 * that says why, and it is the line the copy button hands to a support thread
 * (review U14).
 */
test("the failure detail points at Squirrel's log when the caller has one", () => {
	const marker = {
		targetVersion: "0.18.0",
		artifactPath: "/tmp/local-operator-ui-0.18.0-arm64.zip",
		startedAt: "2026-09-11T22:36:48.000Z",
		watchdogPid: 4242,
	};
	const without = installFailurePayload(marker, "0.17.0");
	assert.equal(without.detail.includes("Squirrel"), false);
	const withLog = installFailurePayload(marker, "0.17.0", {
		shipItLogPath:
			"/Users/operator/Library/Caches/com.local-operator.ShipIt/ShipIt_stderr.log",
	});
	assert.match(
		withLog.detail,
		/Squirrel's own log is at \/Users\/operator\/Library\/Caches\/com\.local-operator\.ShipIt\/ShipIt_stderr\.log\.$/,
	);
	assert.match(withLog.detail, /Install started /);
});

// ---------------------------------------------------------------------------
// The by-hand panel's clear rules
// ---------------------------------------------------------------------------

/**
 * The source-build escape hatch has to end when the user does what it says.
 *
 * The panel's copy is "run this command, then check again". Its clear rule used
 * to live only in the "nothing newer is available" branch, and the install it
 * was written for never reaches that branch: this machine's checkout trails the
 * published release (0.54.14 against 0.54.20), so the next check reports an
 * update as AVAILABLE and the panel stayed up telling the user to run the
 * command they had just run, behind a button that visibly did nothing (review
 * U12, round 3). A five-minute background check, by contrast, must never dismiss
 * a panel out from under the reader.
 */
test("a source build's by-hand panel ends on the user's own check", () => {
	const sourceBuildPanel = { target: "0.54.20", sourceBuild: true };

	// The operator's own case: `lop-update` leaves the checkout on 0.54.14 and
	// the check that follows reports 0.54.20 as available.
	assert.equal(
		manualPanelClearedByAvailable({
			manual: true,
			currentVersion: "0.54.14",
			expectation: sourceBuildPanel,
		}),
		true,
	);
	// A release newer than the one the panel named is the same gap from the other
	// side, so the version cannot decide that case either.
	assert.equal(
		manualPanelClearedByAvailable({
			manual: true,
			currentVersion: "0.54.13",
			expectation: { target: "0.55.0", sourceBuild: true },
		}),
		true,
	);
	// The deliberate rule this must not regress: the periodic check sends no
	// `manual`, and the start-up check sends false - neither may clear.
	assert.equal(
		manualPanelClearedByAvailable({
			currentVersion: "0.54.14",
			expectation: sourceBuildPanel,
		}),
		false,
	);
	assert.equal(
		manualPanelClearedByAvailable({
			manual: false,
			currentVersion: "0.54.14",
			expectation: sourceBuildPanel,
		}),
		false,
	);

	// A reachable install is decided by the version the SERVER reports - the one
	// the panel is waiting for - not by the latest published one.
	const pipPanel = { target: "0.55.0", sourceBuild: false };
	assert.equal(
		manualPanelClearedByAvailable({
			manual: true,
			currentVersion: "0.55.1",
			expectation: pipPanel,
		}),
		true,
	);
	assert.equal(
		manualPanelClearedByAvailable({
			manual: true,
			currentVersion: "0.54.14",
			expectation: pipPanel,
		}),
		false,
	);
	// Work left to do and no version to measure it against: the panel stays up.
	assert.equal(
		manualPanelClearedByAvailable({
			manual: true,
			currentVersion: "0.54.14",
			expectation: { target: null, sourceBuild: false },
		}),
		false,
	);
});

test("a check's answer ends the by-hand panel once the server is not behind it", () => {
	// The "nothing newer" answer, which the main process only sends for a check
	// the user asked for.
	assert.equal(
		manualPanelClearedByCheck({
			reported: "0.55.0",
			expectation: { target: "0.55.0", sourceBuild: false },
		}),
		true,
	);
	assert.equal(
		manualPanelClearedByCheck({
			reported: "0.55.2",
			expectation: { target: "0.55.0", sourceBuild: false },
		}),
		true,
	);
	assert.equal(
		manualPanelClearedByCheck({
			reported: "0.54.14",
			expectation: { target: "0.55.0", sourceBuild: false },
		}),
		false,
	);
	// A prefixed tag on either side is the same version.
	assert.equal(
		manualPanelClearedByCheck({
			reported: "v0.55.0",
			expectation: { target: "0.55.0", sourceBuild: false },
		}),
		true,
	);
	// Nothing reported, nothing proven.
	assert.equal(
		manualPanelClearedByCheck({
			reported: null,
			expectation: { target: "0.55.0", sourceBuild: false },
		}),
		false,
	);
	assert.equal(atLeastVersion("0.10.0", "0.9.9"), true);
	// A pre-release that is not an exact match is not "beyond": the instruction
	// stays up rather than clearing over a real gap.
	assert.equal(atLeastVersion("0.55.0-rc1", "0.55.0"), false);
	assert.equal(atLeastVersion("0.55.0", "0.55.0-rc1"), false);
	assert.equal(atLeastVersion("0.55.0-rc1", "0.55.0-rc1"), true);
});

/**
 * The installers are resolved the way the platform resolves them.
 *
 * `resolveCommandPath` used to be POSIX-only by construction: an exact file name
 * checked with `existsSync`, and a uv tool environment's scripts looked for in
 * `<tool>/bin`. Both are wrong on Windows, where `uv` is `uv.exe` and uv keeps a
 * tool environment's console scripts in `Scripts` - so the two listing probes
 * the classifier falls back to (which are gated on resolving `uv` and `pipx`)
 * answered nothing, and a uv-tool or pipx install came out unidentifiable with
 * an empty command where the previous build named `uv tool upgrade` (review
 * round 4, M1). The XDG cases are the same defect class for an install
 * configured with a data home alone (review round 4, M2).
 *
 * The platform is injected, because this suite runs on the host and the rule is
 * what has to be asserted: which file names get tried inside each directory, and
 * which directories those are. Path separators come from the host's `join`,
 * so the assertions name the parts rather than reconstructed path strings.
 */
test("a Windows install and an XDG data home are searched by their own rules", () => {
	const home = join(tmpdir(), "lo-platform-home");
	const windows = {
		PATH: "/nonexistent-on-this-host",
		HOME: home,
		PATHEXT: ".COM;.EXE;.BAT;.CMD",
	};
	const tried = [];
	const misses = (candidate) => {
		tried.push(candidate);
		return false;
	};

	// POSIX keeps its exact-name search: no extension is invented for it.
	tried.length = 0;
	assert.equal(
		resolveCommandPath("uv", {
			env: { PATH: "/nonexistent-on-this-host", HOME: home },
			home,
			platform: "linux",
			listDir: () => [],
			exists: misses,
		}),
		null,
	);
	assert.ok(tried.every((candidate) => !candidate.endsWith(".EXE")));

	// Windows: the bare name is still tried, and every PATHEXT spelling follows,
	// in the order the platform tries them.
	tried.length = 0;
	assert.equal(
		resolveCommandPath("uv", {
			env: windows,
			home,
			platform: "win32",
			listDir: () => [],
			exists: misses,
		}),
		null,
	);
	assert.ok(tried.some((candidate) => candidate.endsWith(join("uv"))));
	assert.ok(tried.some((candidate) => candidate.endsWith("uv.EXE")));
	assert.ok(
		tried.indexOf(tried.find((c) => c.endsWith("uv.EXE"))) <
			tried.indexOf(tried.find((c) => c.endsWith("uv.BAT"))),
		"PATHEXT order is the platform's",
	);
	// And the hit is the `.exe`, which is what an install actually is there.
	const found = resolveCommandPath("uv", {
		env: windows,
		home,
		platform: "win32",
		listDir: () => [],
		exists: (candidate) => candidate.endsWith("uv.EXE"),
	});
	assert.ok(found?.endsWith("uv.EXE"), `expected an .exe, got ${found}`);
	// A machine whose environment carries no PATHEXT still resolves: the
	// documented default is used, because the app is a process that may not have
	// inherited a shell's environment at all.
	const noPathext = resolveCommandPath("pipx", {
		env: { PATH: "/nonexistent-on-this-host", HOME: home },
		home,
		platform: "win32",
		listDir: () => [],
		exists: (candidate) => candidate.endsWith("pipx.EXE"),
	});
	assert.ok(noPathext?.endsWith("pipx.EXE"), `${noPathext}`);

	// The tool environment's own scripts: `Scripts` on Windows, `bin` elsewhere.
	const toolRoot = join(home, "tools");
	const windowsTool = [];
	resolveCommandPath("local-operator", {
		env: { ...windows, UV_TOOL_DIR: toolRoot },
		home,
		platform: "win32",
		listDir: (dir) => (dir === toolRoot ? ["local-operator"] : []),
		exists: (candidate) => {
			windowsTool.push(candidate);
			return false;
		},
	});
	assert.ok(
		windowsTool.some((candidate) => candidate.includes("Scripts")),
		`windows tool envs keep Scripts: ${windowsTool.join(", ")}`,
	);
	const posixTool = [];
	resolveCommandPath("local-operator", {
		env: {
			PATH: "/nonexistent-on-this-host",
			HOME: home,
			UV_TOOL_DIR: toolRoot,
		},
		home,
		platform: "darwin",
		listDir: (dir) => (dir === toolRoot ? ["local-operator"] : []),
		exists: (candidate) => {
			posixTool.push(candidate);
			return false;
		},
	});
	assert.ok(posixTool.some((candidate) => candidate.includes(join("bin"))));
	assert.ok(posixTool.every((candidate) => !candidate.includes("Scripts")));

	// `XDG_DATA_HOME`: uv's shim dir is `$XDG_DATA_HOME/../bin` and its tool root
	// is `$XDG_DATA_HOME/uv/tools`, so an install configured with the data home
	// alone used to be searched nowhere under it.
	const dataHome = join(home, "xdg-data");
	const xdgTried = [];
	resolveCommandPath("local-operator", {
		env: {
			PATH: "/nonexistent-on-this-host",
			HOME: home,
			XDG_DATA_HOME: dataHome,
		},
		home,
		platform: "darwin",
		listDir: (dir) =>
			dir === join(dataHome, "uv", "tools") ? ["local-operator"] : [],
		exists: (candidate) => {
			xdgTried.push(candidate);
			return false;
		},
	});
	assert.ok(
		xdgTried.includes(join(dataHome, "..", "bin", "local-operator")),
		"the XDG shim dir is searched",
	);
	assert.ok(
		xdgTried.includes(
			join(dataHome, "uv", "tools", "local-operator", "bin", "local-operator"),
		),
		"the XDG tool root is searched",
	);
});

/**
 * The script's at-or-beyond rule and the renderer's are one rule.
 *
 * The disposition for the round-3 finding claimed the two halves agreed, and
 * they only did for equal-width dotted numerics: `0.18.0.1` against `0.18.0`
 * read as not-landed in the shell (the loop returned as soon as one side ran
 * out) and as landed in the renderer (which pads with zero), and a pre-release
 * against a higher numeric prefix differed the other way (review round 4, M3).
 * The direction was safe - the script waits rather than exiting early - but a
 * future reader "fixing" the shell half in that direction turns the wait into
 * a false early exit, which is why the rule rather than a comment is what gets
 * pinned here. The shell half is driven from the generated script, so the text
 * under test is the text the app writes. The single input the two still answer
 * differently - an absent operand - is asserted as itself at the end of the
 * test, and the script says in place why that one stays. The sweep below is 12
 * versions x 12 targets = 144 ordered pairs, plus the seven named pairs and
 * the two empty-operand cases; the rule is what gets fixed here, and 144 is
 * the whole of what this test compares - the commit that added it quoted a
 * wider figure, which the sweep never had.
 */
test("the script's version rule agrees with the renderer's, absent operands aside", () => {
	const script = buildWatchdogPlan({
		appBundlePath: "/Applications/Local Operator.app",
		executableName: "Local Operator",
		appPid: 1,
		shipItJob: null,
		targetVersion: "0.18.0",
	}).script;
	const rule = script.match(/^version_at_least\(\) \{\n[\s\S]*?^\}$/m);
	assert.ok(rule, "version_at_least is in the generated script");

	const versions = [
		"0.9.9",
		"0.10.0",
		"0.17.0",
		"0.18",
		"0.18.0",
		"0.18.0.0",
		"0.18.0.1",
		"0.18.1",
		"0.19.0",
		"1.0.0",
		"0.18.0-rc1",
		"0.18.0-beta.1",
	];
	const pairs = [];
	for (const installed of versions) {
		for (const target of versions) pairs.push([installed, target]);
	}
	// The two empty-operand cases are the one deliberate divergence and are
	// asserted as themselves below, not in the agreement sweep.

	const workDir = mkdtempSync(join(tmpdir(), "lo-version-rule-"));
	const ruleFile = join(workDir, "rule.sh");
	writeFileSync(
		ruleFile,
		`${rule[0]}\n${pairs
			.map(
				([installed, target]) =>
					`version_at_least '${installed}' '${target}'; echo $?`,
			)
			.join("\n")}\n`,
	);
	const output = spawnSync("/bin/sh", [ruleFile], { encoding: "utf8" });
	rmSync(workDir, { recursive: true, force: true });
	assert.equal(output.status, 0, output.stderr);
	const answers = output.stdout
		.trim()
		.split("\n")
		.map((line) => line.trim() === "0");
	assert.equal(answers.length, pairs.length);
	const byPair = new Map();
	pairs.forEach(([installed, target], index) => {
		byPair.set(`${installed}->${target}`, answers[index]);
	});

	const disagreeing = [];
	for (const [installed, target] of pairs) {
		const shell = byPair.get(`${installed}->${target}`);
		const renderer = atLeastVersion(installed, target);
		if (shell !== renderer) {
			disagreeing.push(
				`${installed} vs ${target}: shell=${shell} renderer=${renderer}`,
			);
		}
	}
	assert.deepEqual(disagreeing, []);

	// The measured pairs, as themselves: a regression names the case it broke.
	assert.equal(byPair.get("0.18.0.1->0.18.0"), true);
	assert.equal(byPair.get("0.18.0->0.18.0.1"), false);
	assert.equal(byPair.get("0.18->0.18.0"), true);
	assert.equal(byPair.get("0.18.0->0.18"), true);
	assert.equal(byPair.get("1.0.0->0.18.0-rc1"), false);
	assert.equal(byPair.get("0.18.0-rc1->0.18.0-rc1"), true);
	assert.equal(byPair.get("0.17.0->0.18.0"), false);
	/*
	 * The one input the two answer differently, and the one the shell's rule
	 * refuses on purpose: an absent operand. A relaunch is not started over a
	 * version nobody reported, and both callers prove the operand non-empty
	 * before the rule sees it - the script's `swap_landed` declines an empty
	 * target outright. The renderer pads it with zero instead.
	 */
	const emptyDriver = [
		rule[0],
		`version_at_least '' '0.18.0'; echo $?`,
		`version_at_least '0.18.0' ''; echo $?`,
	].join("\n");
	const emptyDir = mkdtempSync(join(tmpdir(), "lo-version-empty-"));
	const emptyFile = join(emptyDir, "rule.sh");
	writeFileSync(emptyFile, `${emptyDriver}\n`);
	const emptyOutput = spawnSync("/bin/sh", [emptyFile], { encoding: "utf8" });
	rmSync(emptyDir, { recursive: true, force: true });
	assert.deepEqual(
		emptyOutput.stdout
			.trim()
			.split("\n")
			.map((line) => line.trim() === "0"),
		[false, false],
	);
	assert.equal(atLeastVersion("", "0.18.0"), false);
});

/**
 * The bound stops the wait AND the read.
 *
 * The bound's promise is that the script does not wait on a path that stopped
 * answering, and the shipped read kept it while leaving the reader alive: the
 * backgrounded pid was a subshell whose job was to drop a completion marker, so
 * the `kill -9` landed on the wrapper and the `plutil` it had forked was
 * reparented to pid 1, still blocked - one more per poll, up to ~200 over the
 * bound (review round 4, Q7, measured at 5 survivors).
 *
 * The reader is substituted for `/bin/sleep` here, with its own unique duration
 * so the survivor scan cannot see anything else: what is under test is where the
 * kill lands, and a real `plutil` on a healthy volume answers in milliseconds so
 * it cannot be held open. Everything else in the driven function - the
 * readability pre-check, the redirect, the bound, the kill - is the generated
 * script's own text.
 */
test("a version read that never answers is killed, not left running", () => {
	const hangSeconds = "317";
	const plan = buildWatchdogPlan({
		appBundlePath: "/Applications/Local Operator.app",
		executableName: "Local Operator",
		appPid: 1,
		shipItJob: null,
		targetVersion: "0.18.0",
		plistReadTimeoutSeconds: 1,
	});
	const read = plan.script.match(/^bundle_version\(\) \{\n[\s\S]*?^\}$/m);
	assert.ok(read, "bundle_version is in the generated script");
	const substituted = read[0].replace(
		/"\$PLIST_READER" -extract CFBundleShortVersionString raw -o - "\$_plist"/,
		`/bin/sleep ${hangSeconds}`,
	);
	assert.notEqual(substituted, read[0], "the reader was substituted");

	const bundle = mkdtempSync(join(tmpdir(), "lo-read-bound-"));
	mkdirSync(join(bundle, "Contents"), { recursive: true });
	// The readability pre-check the function does before it starts anything.
	writeFileSync(join(bundle, "Contents", "Info.plist"), "not a plist");
	const driver = [
		"now() { date +%s; }",
		`BUNDLE=${bundle}`,
		`TMPDIR=${bundle}`,
		substituted,
		"bundle_version",
		'echo "rc=$?"',
	].join("\n");
	const started = Date.now();
	const output = spawnSync("/bin/sh", ["-c", driver], { encoding: "utf8" });
	const elapsed = Date.now() - started;
	const survivors = spawnSync("/bin/ps", ["-A", "-o", "pid=,command="], {
		encoding: "utf8",
	})
		.stdout.split("\n")
		.filter((line) => line.includes(`sleep ${hangSeconds}`));
	// Clean up a survivor before failing, so a regression does not leave the
	// suite's own `sleep` behind for the rest of the run.
	for (const line of survivors) {
		const pid = line.trim().split(/\s+/)[0];
		try {
			process.kill(Number(pid), "SIGKILL");
		} catch {
			// Already gone between the scan and the kill.
		}
	}
	rmSync(bundle, { recursive: true, force: true });

	assert.equal(output.stdout.includes("rc=1"), true, output.stdout);
	// The bound is the plan's (1s), not the read's (317s): the script stopped
	// waiting on its own deadline.
	assert.ok(elapsed < 30_000, `the read held the script for ${elapsed}ms`);
	assert.deepEqual(survivors, [], "the killed pid is the reader's");
});

/**
 * The shipped update service, bundled with Electron stubbed rather than launched.
 *
 * Extracted from the case that first needed it so a second one can drive the same
 * module: what both are about is behaviour inside `UpdateService`, not the window
 * it runs in. The bundled module graph IS the app's main process, so the fixtures
 * below cover every surface it touches at import time - `app.getPath` for the
 * logger and the pending-install marker, `electron-log`'s transports, and the
 * autoUpdater object the constructor configures.
 *
 * Returns the module and the directory it was written to. The import has to run
 * from a real path rather than a `data:` URL, because the Electron fixture needs
 * an `import.meta.url` that `createRequire` can resolve.
 *
 * `managedPython` replaces `src/main/backend/managed-python` in the graph, and it
 * exists for the app-owned cases (R5): that arm's whole subject is what the service
 * does AROUND `updateManagedPython` - the phase it announces, whether it stops
 * anything first, the restart decision, and the payload it reports - and every one
 * of those is unobservable from outside the process unless the publish can be
 * scripted. The fixture re-exports the shipped module, so a case that overrides one
 * function still runs the rest of the real one, and the override is what makes the
 * ordering assertable without a real pip install.
 */
const loadUpdateServiceModule = async ({ managedPython = null } = {}) => {
	/*
	 * `resolveDir` is set on every fixture module rather than only on the one that
	 * needs it: a virtual module has no directory of its own, so esbuild refuses to
	 * resolve ANY specifier inside it, including the absolute path the
	 * managed-python fixture re-exports the shipped module from. The other fixtures
	 * import nothing, so the field is inert for them.
	 */
	const fixture = (contents) => ({
		contents,
		loader: "js",
		resolveDir: process.cwd(),
	});
	const bundle = await build({
		stdin: {
			/*
			 * `venv-paths` is re-exported so a case can ask for the name the app gives an
			 * environment rather than re-deriving it: the sibling flavour's name is the
			 * subject of review round 2's R6, and a case that hard-coded the path would
			 * pass while the function the app calls answered something else.
			 */
			contents:
				'export * from "./src/main/update-service"; export * from "./src/main/backend/backend-service"; export * from "./src/main/backend/venv-paths"; export * from "./src/main/backend-version-drift"; export * from "./src/main/desktop-stream";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		// The graph reaches CJS dependencies (dotenv, zod), which esbuild's ESM
		// output cannot `require` without this shim; without it the bundle throws
		// "Dynamic require of \"fs\" is not supported" on first use.
		banner: {
			js: 'import { createRequire as __loCreateRequire } from "node:module"; const require = __loCreateRequire(import.meta.url);',
		},
		plugins: [
			{
				name: "electron-fixture",
				setup(builder) {
					builder.onResolve(
						{ filter: /^(electron|electron-updater|electron-log)$/ },
						(args) => ({ path: args.path, namespace: "fixture" }),
					);
					if (managedPython) {
						builder.onResolve({ filter: /backend\/managed-python$/ }, () => ({
							path: "managed-python-fixture",
							namespace: "fixture",
						}));
					}
					builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
						if (args.path === "managed-python-fixture") {
							return fixture(managedPython);
						}
						if (args.path === "electron") {
							return fixture(`
								const paths = globalThis.__loTestPaths;
								export const app = {
									// A getter rather than a literal, so a test can put the app on
									// the unpackaged side of the decisions gated on it - which is the
									// state the operator's own worktree instances run in, and the one
									// that must not act on the packaged app's install state.
									get isPackaged() {
										return globalThis.__loTestAppIsPackaged ?? true;
									},
									getPath: (name) => paths[name] ?? paths.userData,
									// A getter rather than a literal, so a case that is about the
									// version the app REPORTS (the retire rule's own input) can
									// set it; the default is unchanged for every other case.
									getVersion: () =>
										globalThis.__loTestAppVersion ?? "0.0.0-test",
									getName: () => "Local Operator",
									getAppPath: () => process.cwd(),
									whenReady: async () => {},
									on: () => app,
									once: () => app,
									quit: () => {},
									relaunch: () => {},
									exit: () => {},
									isReady: () => true,
									commandLine: { appendSwitch: () => {} },
									setAsDefaultProtocolClient: () => true,
									requestSingleInstanceLock: () => true,
									releaseSingleInstanceLock: () => {},
								};
								export const ipcMain = {
									/*
									 * handle() RECORDS as well as drops. Nothing in this fixture ever
									 * invokes a handler - this process is not Electron - but a test
									 * that needs to drive a path the app reaches only through IPC (the
									 * quit an in-flight panel offers, UX U8) has to be able to call
									 * the function the app would call, and a fixture that swallows
									 * them leaves that path unassertable.
									 */
									handle: (channel, fn) => { (globalThis.__loIpcHandlers ??= {})[channel] = fn; },
									on: () => {},
									once: () => {},
									removeHandler: (channel) => { delete (globalThis.__loIpcHandlers ?? {})[channel]; },
									removeAllListeners: () => {},
								};
								export class BrowserWindow {
									constructor() {
										this.webContents = { send: () => {}, isDestroyed: () => false, on: () => {}, once: () => {}, setWindowOpenHandler: () => {} };
									}
									isDestroyed() { return false; }
									static getAllWindows() { return []; }
									static getFocusedWindow() { return null; }
								}
								export const dialog = { showMessageBox: async () => ({ response: 0 }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showErrorBox: () => {} };
								export class Notification { static isSupported() { return false; } show() {} }
								export const shell = { openExternal: async () => {}, openPath: async () => {} };
								export const nativeTheme = { shouldUseDarkColors: false, on: () => {} };
								export const Menu = { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) };
								export const session = { defaultSession: { webRequest: { onHeadersReceived: () => {} } } };
								/*
								 * net.isOnline() is the pre-flight gate's reading (this machine
								 * believes it has no network), and it is answerable from a case
								 * through the same global the rest of the fixture uses: an ABSENT
								 * global means the stub does not answer, which the service reads as
								 * reachable, so every case that says nothing keeps the behaviour it
								 * had before the gate. No backticks in this comment: it lives inside
								 * a template literal, and one would end it here.
								 */
								export const net = {
									isOnline: () => globalThis.__loTestNetIsOnline ?? true,
								};
								/*
								 * powerMonitor RECORDS its listeners rather than dropping them:
								 * the wake-armed check is registered in the constructor, and a case
								 * that cannot fire the event could only assert that a line of source
								 * exists.
								 */
								export const powerMonitor = {
									on: (event, handler) => {
										(globalThis.__loPowerMonitorHandlers ??= {})[event] = handler;
										return powerMonitor;
									},
								};
							`);
						}
						if (args.path === "electron-updater") {
							return fixture(`
								/*
								 * A listener registry rather than the no-op methods this
								 * stub used to carry, so the service's OWN wiring is
								 * exercised: the renderer message a not-available check
								 * produces comes from the listener registered in the service's
								 * constructor rather than from the check itself, and a stub
								 * that swallowed registrations could not tell whether that
								 * path still works.
								 */
								const listeners = new Map();
								const register = (event, handler) => {
									listeners.set(event, [...(listeners.get(event) ?? []), handler]);
									return autoUpdater;
								};
								export const autoUpdater = {
									on: (event, handler) => register(event, handler),
									once: (event, handler) => register(event, handler),
									removeAllListeners: (event) => {
										if (event === undefined) listeners.clear();
										else listeners.delete(event);
										return autoUpdater;
									},
									listeners: (event) => listeners.get(event) ?? [],
									emit: (event, payload) => {
										for (const handler of [...(listeners.get(event) ?? [])]) handler(payload);
									},
									/*
									 * The library's own ORDER, which is the part that matters
									 * here: electron-updater emits update-not-available and only
									 * then resolves a result whose isUpdateAvailable is false,
									 * and resolves null only when isUpdaterActive() says the
									 * updater will not run at all. The outcome is driven through
									 * a global so a case can hand the check either thing. No
									 * backticks in this comment: it lives inside a template
									 * literal, and one would end it here.
									 */
									checkForUpdates: async () => {
										const result = globalThis.__loTestAppCheck
											? await globalThis.__loTestAppCheck()
											: null;
										if (result && !result.isUpdateAvailable) {
											autoUpdater.emit("update-not-available", {
												version: "0.0.0-test",
											});
										}
										return result;
									},
									downloadUpdate: async () => [],
									quitAndInstall: () => {},
									setFeedURL: () => {},
									autoDownload: false,
									autoInstallOnAppQuit: false,
									logger: null,
								};
								/*
								 * Reachable from a case, because the library's two halves
								 * of one failure are the point: doCheckForUpdates EMITS
								 * the error event on the updater and then rejects with it,
								 * so a case about one failure reported twice has to do
								 * both. Assigned HERE rather than above the object, since
								 * the declaration is below that point. No backticks in
								 * this comment: it lives inside a template literal, and
								 * one would end it here.
								 */
								globalThis.__loAutoUpdater = autoUpdater;
							`);
						}
						return fixture(`
							/*
							 * Captured when a case asks for it: the __loTestLogs global is set by the
							 * cases that assert on the LOG rather than on behaviour, and the drift's own
							 * claim is that every branch says what it did - including the branches that
							 * do nothing, which is where the first cut was silent (review round 1, R1
							 * and R7). Absent means the lines go nowhere, which is every other case.
							 * No backticks in this block either, for the same reason as the one above.
							 */
							const record = (level, message) => {
								if (globalThis.__loTestLogs) globalThis.__loTestLogs.push(level + ": " + String(message));
							};
							const logger = () => ({
								info: (message) => record("info", message),
								warn: (message) => record("warn", message),
								error: (message) => record("error", message),
								debug: () => {}, verbose: () => {}, silly: () => {},
								transports: {
									file: { resolvePath: () => "", level: "debug", format: "", maxSize: 0 },
									console: { level: "info" },
								},
							});
							const electronLog = logger();
							electronLog.create = () => logger();
							electronLog.initialize = () => {};
							export default electronLog;
						`);
					});
				},
			},
		],
	});

	const serviceDir = mkdtempSync(join(tmpdir(), "lo-service-bundle-"));
	const serviceFile = join(serviceDir, "update-service.mjs");
	writeFileSync(serviceFile, bundle.outputFiles[0].text);
	return { service: await import(serviceFile), serviceDir };
};

/**
 * The remedy the compatibility banner produces names the release the last check
 * read.
 *
 * This is the one defect class this change was reviewed for three times: a value
 * the code looks like it sets that never reaches the payload on the path that
 * matters (review U17). The panel's version sentence renders from
 * `latestVersion`, the banner's remedy calls `updateBackend()` with no target at
 * all, and the fallback to the published release the last check read is the
 * whole fix. It only had coverage through the real banner path, so a regression
 * in the fallback would look exactly like the original defect: a panel with no
 * version sentence on the path most users take.
 *
 * Driven against the SHIPPED main process, bundled the way the rest of this file
 * bundles its modules - but with Electron stubbed instead of launched, because
 * what is under test is one function's payload rather than a window. Every path
 * the module reads or writes is redirected into a temp dir and the health probe
 * is pointed at a closed port, so nothing of the operator's own install, state
 * or running server is touched.
 */
test("the banner's remedy names the release the last check read", async () => {
	const home = mkdtempSync(join(tmpdir(), "lo-service-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-service-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	const { service, serviceDir } = await loadUpdateServiceModule();
	const sent = [];
	let interval = null;
	try {
		const updateService = new service.UpdateService(
			{
				isDestroyed: () => false,
				webContents: {
					send: (channel, payload) => sent.push({ channel, payload }),
					isDestroyed: () => false,
				},
			},
			backendManagerStub(
				service.LocalOperatorStartupMode.GLOBAL_INSTALL,
				() => updateService,
			),
		);
		interval = updateService.updateCheckInterval;
		// Keep the health probe off anything real: the constructor derives this
		// URL from config, and a live server on that port would be a session this
		// test must not touch.
		updateService.backendUrl = "http://127.0.0.1:9";
		/*
		 * NO INSTALL, DECLARED. `updateBackend` reads the install's plan now, and the
		 * real read walks the machine's own PATH and home: on a box with a global
		 * install the plan becomes the automatic `lop update` one and the
		 * manual-required event this case is about is never sent - green on CI, red on
		 * the machine that ships it. Pinned to the identity the real read returns when
		 * nothing resolves, so the case's world is the one it declares, like every
		 * other fixture in this file.
		 */
		updateService.resolveInstallIdentity = async () => ({ path: null });
		// The field `checkForBackendUpdates` writes when a check read the published
		// release (`:2064`). Setting it here is the point of the case: the question
		// is whether the value reaches the payload, not how it was fetched.
		updateService.lastPublishedBackendVersion = "0.54.21";

		// The banner's own shape: no target at all.
		await updateService.updateBackend();
		const manual = sent.filter(
			({ channel }) => channel === "backend-update-manual-required",
		);
		assert.equal(manual.length, 1, JSON.stringify(sent));
		assert.equal(manual[0].payload.latestVersion, "0.54.21");
		assert.equal(manual[0].payload.currentVersion, null);

		// A caller that does name a target still wins, so the fallback cannot
		// shadow the version an explicit check asked about.
		sent.length = 0;
		await updateService.updateBackend("0.99.0");
		const targeted = sent.filter(
			({ channel }) => channel === "backend-update-manual-required",
		);
		assert.equal(targeted.length, 1, JSON.stringify(sent));
		assert.equal(targeted[0].payload.latestVersion, "0.99.0");
	} finally {
		if (interval) clearInterval(interval);
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// A failed server update has to SAY so, on the channel the renderer listens to
// ---------------------------------------------------------------------------

/**
 * `update-backend` reports its failure on `backend-update-error`, and RESOLVES
 * false rather than rejecting.
 *
 * Both halves are the operator's report of 2026-09-15. The channel carried every
 * failing branch's own sentence - pip's output, the missing environment, the
 * "version did not change" verdict - and had no subscriber at all, so all of it
 * was dropped; and because the failure crosses the IPC boundary as a resolved
 * `false`, a renderer that cleared its in-flight panel only in its `catch` kept
 * "Updating server" up forever. Nothing below asserts the renderer (that is the
 * sibling case's job): this pins the main-process half of the contract, through
 * the handler the renderer actually invokes.
 *
 * Two failing branches, chosen because one is reachable today and one is the
 * branch a future startup mode would fall into - the second had NO report at all
 * before this change, which is the trap this case exists to keep closed.
 */
test("a failed update-backend reports on backend-update-error and resolves false", async () => {
	const home = mkdtempSync(join(tmpdir(), "lo-backend-failure-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-backend-failure-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	const { service, serviceDir } = await loadUpdateServiceModule();
	const sent = [];
	let interval = null;
	try {
		for (const [name, startupMode] of [
			["no python server", service.LocalOperatorStartupMode.NOT_STARTED],
			["an unrecognised startup mode", "SOME_FUTURE_MODE"],
		]) {
			sent.length = 0;
			// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
			delete globalThis.__loIpcHandlers;
			const updateService = new service.UpdateService(
				{
					isDestroyed: () => false,
					webContents: {
						send: (channel, payload) => sent.push({ channel, payload }),
						isDestroyed: () => false,
					},
				},
				backendManagerStub(startupMode, () => updateService),
			);
			interval = updateService.updateCheckInterval;
			// Keep the health probe off anything real, as the sibling cases do.
			updateService.backendUrl = "http://127.0.0.1:9";
			try {
				updateService.setupIpcHandlers();
				const handler = globalThis.__loIpcHandlers?.["update-backend"];
				assert.equal(
					typeof handler,
					"function",
					"the renderer must have an update-backend handler to invoke",
				);

				// Resolved, not rejected: this is the shape every failing branch sends,
				// and the reason the renderer cannot leave its in-flight state to a
				// `catch` alone.
				const result = await handler({}, "0.55.10");
				assert.equal(result, false, name);

				const errors = sent.filter(
					({ channel }) => channel === "backend-update-error",
				);
				assert.equal(errors.length, 1, `${name}: ${JSON.stringify(sent)}`);
				assert.equal(
					errors[0].payload.phase,
					"update",
					`${name}: a report from the attempt itself must say so`,
				);
				assert.equal(typeof errors[0].payload.message, "string", name);
				assert.ok(errors[0].payload.message.trim().length > 0, name);
				// A failure is not a completion: the renderer's "up to date" path must
				// not be reachable from it.
				assert.ok(
					!sent.some(({ channel }) => channel === "backend-update-completed"),
					name,
				);
			} finally {
				if (interval) clearInterval(interval);
				interval = null;
			}
		}
	} finally {
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loIpcHandlers;
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// The one sentence a whole update check may earn
// ---------------------------------------------------------------------------

/**
 * Why this section exists: a user reported seeing, from ONE press of "Check for
 * updates", both "Server version 0.54.44 is available. You are currently using
 * version 0.54.43." and "You are up to date" - application 0.22.1 against
 * server 0.54.43, with 0.54.44 published. It happened "when there's an
 * available version on either the server or the UI", which is the shape of the
 * bug: each channel's own event was rendered as a sentence about the whole
 * installation, so exactly one trailing channel produced an offer and an
 * affirmation in the same turn, and which sentence the user saw was decided by
 * whichever event the main process happened to emit last.
 *
 * The rule under test (`src/main/update-check-verdict.ts`): the affirmation is
 * earned only by a check that positively proved BOTH channels current, never by
 * a channel with an update to offer and never by a channel that could not find
 * out. These cases drive the real service and assert the real renderer events,
 * so "the app channel said nothing newer" is asserted BESIDE the verdict that
 * refuses to affirm - which is the property the event-driven button lacked.
 *
 * What is real, and what is substituted - the bound on the claim:
 *
 * REAL: `UpdateService.checkForUpdates`, `checkForBackendUpdates` and
 * `checkForAllUpdates`, the server probe over real loopback HTTP (the shipped
 * `getInstalledBackendVersion` fetch, status handling and version parse), the
 * comparison that decides whether the server trails, and every renderer event
 * each channel sends.
 *
 * SUBSTITUTED: `electron`, `electron-updater` and `electron-log`, because this
 * process is not Electron (`loadUpdateServiceModule`'s fixture - the app
 * channel's outcome is handed in as the `UpdateCheckResult` the real updater
 * resolves), and `getLatestPypiVersion`, whose only source is a hard-coded
 * `https://pypi.org/pypi/local-operator/json` that no test can point at
 * loopback. The published version is an INPUT to the check rather than part of
 * the rule, so supplying it directly copies nothing the assertions rely on.
 */

/**
 * Drive one aggregate check against the shipped service.
 *
 * Returns the verdict the renderer receives and every event the check sent it,
 * because the defect is about the two TOGETHER: an event that means "nothing
 * newer on this channel" is legitimate, and only the sentence built from it was
 * not.
 *
 * `ipc` reaches the same check the way the RENDERER does - `setupIpcHandlers`
 * and then the registered `check-for-all-updates` handler, invoked with
 * `ipc.options` - rather than by calling the service method directly. That is
 * the boundary the silent flag crosses, so the two rules that live there (an
 * absent option runs non-silent, and `silent` is the only thing that suppresses
 * the events) are only reachable through it.
 */
/**
 * A stand-in for the two `BackendServiceManager` accessors this service reads.
 *
 * WHY A HELPER RATHER THAN A LITERAL PER FIXTURE: the check now reads both on the
 * ordinary path, and a stub that omits either one throws inside the check - which
 * the service reports as `unavailable`, i.e. a fixture bug that looks like a
 * version-reading bug. The real manager answers both, so the fixture does too.
 *
 * `getBackendUrl` is the LIVE address the manager rotates onto when it adopts a
 * daemon: the version read follows it rather than the configured URL, which is
 * what made an adopted daemon's reading fail (QA Q-2, UX U1).
 *
 * `service` is a GETTER, not the instance: the stub is an argument to the
 * constructor that binds the instance, so passing it directly is a temporal-dead-
 * zone ReferenceError, while a function called later resolves it.
 *
 * `isUsingExternalBackend` answers false - these fixtures' daemon is the app's own
 * - which is what decides whether the skew notice tells the user to restart Local
 * Operator or says the app will not touch a server it did not start
 * (review R1-3, UX U1).
 */
const backendManagerStub = (
	startupMode,
	service,
	/*
	 * What the manager's serving-install surface answers, and where a restart is
	 * recorded.
	 *
	 * The boot reading comes from the daemon's own serve record, which is a file no
	 * case in this fixture plants - so `null` ("the reading could not be taken") is
	 * what every existing case's world contains, and the drift decision does nothing
	 * there. A case about the skew names a `bootVersion` and reads `restarts` back.
	 *
	 * `successorBootVersion` is what the daemon reports AFTER a restart, and it exists
	 * because the repair's own honesty depends on it (QA round 1, Q1b/Q1c): a restart
	 * is not evidence that the served version moved, so the check reads the successor's
	 * own record and only claims what that reading shows. `undefined` means "the
	 * successor came back on the install" (the ordinary case), a string models a
	 * restart that came back on the SAME build, and `null` models a successor whose
	 * record cannot be read yet.
	 *
	 * The other fields are the rest of what the reading carries: `installPrefix` is
	 * the `sys.prefix` the record publishes (the fixture's synthetic install by
	 * default, which is what a `GLOBAL_INSTALL` daemon the app spawned reports),
	 * `owned` is the ownership answer the check reads - the process THIS app run
	 * holds, and nothing else - and `workState`/`sessionStreamOpen` are the two holds
	 * - a value or a function, because the cases about a DEFERRAL need their second
	 * check to see a different world from their first.
	 */
	{
		bootVersion = null,
		successorBootVersion = undefined,
		restarts = [],
		installPrefix = "",
		owned = {
			owned: true,
			because: "this app process started it and still holds the process",
			startedByEarlierAppRun: false,
		},
		workState = "idle",
		sessionStreamOpen = false,
	} = {},
) => {
	let servedBoot = bootVersion;
	/*
	 * THE UPDATE-IN-FLIGHT FLAG IS MODELLED, not stubbed away (review round 1, m1).
	 * It is what the periodic drift check reads as its `update-in-flight` hold, and
	 * `updateBackend` now raises it for the WHOLE press rather than around the
	 * restart alone - so the manager's own answer has to be the one the service set,
	 * or a case about a drift repair racing a press cannot be told from one about a
	 * machine with no press at all.
	 */
	let autoUpdating = false;
	return {
		getStartupMode: () => startupMode,
		getBackendUrl: () => service().backendUrl,
		isUsingExternalBackend: () => false,
		servingInstall: () => ({
			readings: {
				bootVersion: servedBoot,
				prefix: installPrefix,
				installKind: "pip",
				startedByApp: false,
			},
			owned,
		}),
		servingWorkState: async () =>
			typeof workState === "function" ? workState() : workState,
		hasOpenSessionStreams: () =>
			typeof sessionStreamOpen === "function"
				? sessionStreamOpen()
				: sessionStreamOpen,
		checkIsAutoUpdating: () => autoUpdating,
		setAutoUpdating: (value) => {
			autoUpdating = value;
		},
		/*
		 * The real manager's own stop-then-start. Recorded rather than performed, and
		 * the ONE thing it also does is move the reading the successor would report -
		 * without that, every case would model a restart that came back on the build it
		 * was meant to leave, and the settled-reading gate could not be told apart from
		 * the claim it replaces.
		 */
		restart: async () => {
			restarts.push(servedBoot);
			if (successorBootVersion !== undefined) servedBoot = successorBootVersion;
			return true;
		},
	};
};

/**
 * A synthetic install on disk: everything the readers actually consult.
 *
 * `resolveDistributionMarkers` reads the version out of the dist-info directory's
 * own NAME, the `pyvenv.cfg` is what makes the prefix a venv at all, and the
 * console script in `bin/` is what `readInstallIdentity` resolves a prefix from.
 * No interpreter, no `local-operator` package, no `pip show`: which is the point
 * of the read under test as well as of this fixture.
 */
const syntheticInstall = (root, version, options = {}) => {
	mkdirSync(join(root, "bin"), { recursive: true });
	const distInfo = join(
		root,
		"lib",
		"python3.12",
		"site-packages",
		`local_operator-${version}.dist-info`,
	);
	mkdirSync(distInfo, { recursive: true });
	/*
	 * `editable` writes the `direct_url.json` pip leaves behind for a source
	 * install, which is the whole difference between a dist-info whose version can
	 * be trusted and one that cannot: the NAME is written once at install time, so a
	 * checkout whose `pyproject.toml` moved keeps the old number forever - and the
	 * backend's `installed_version()` prefers the checkout's own pyproject for
	 * exactly this reason (review round 1, R2).
	 */
	if (options.editable) {
		writeFileSync(
			join(distInfo, "direct_url.json"),
			JSON.stringify({
				url: "file:///synthetic/checkout",
				dir_info: { editable: true },
			}),
		);
	}
	writeFileSync(
		join(root, "bin", "local-operator"),
		"#!/usr/bin/env python3\n",
	);
	writeFileSync(join(root, "pyvenv.cfg"), "home = /usr/bin\n");
	return root;
};

const loAggregateCheck = async ({
	appCheck,
	serverVersion,
	publishedVersion,
	serverAnswersVersion = true,
	devMode = false,
	ipc = null,
	/*
	 * The npx install is a channel of its own: it answers from the npm registry
	 * rather than from electron-updater, so a case reaches it by naming the
	 * version the registry would hand back (QA round 1, Q2 covers that channel
	 * too). Omitted means the app is not an npx install, which is every other
	 * case in this file.
	 */
	/*
	 * The version the INSTALL on disk reports, when a case needs it to differ from
	 * the running backend's `/health`.
	 *
	 * Why the fixture has to name the install at all: the check compares the install
	 * the app would UPDATE - that is what "check updates against that lop" means -
	 * and reads `/health` beside it. This fixture's world used to be complete
	 * without an install, because the daemon and the registry were the only two
	 * readings anything took; now that the check resolves the install, a case would
	 * silently pull the OPERATOR'S real `~/.local/bin/local-operator` (0.55.x on this
	 * machine) into a fixture whose every other number is 0.54.x.
	 *
	 * The default mirrors the daemon's own reading, which is the ordinary case: the
	 * app spawned the daemon it is attached to (#254), so one install answers both.
	 * A daemon that answers NO version leaves no reading anywhere - that is what the
	 * absence cases mean - and a case that wants the skew passes its own version.
	 */
	installVersion = serverAnswersVersion ? (serverVersion ?? null) : null,
	/*
	 * The version the daemon BOOTED with, from its own serve record, when a case is
	 * about a process serving older code than the install. Omitted leaves the
	 * reading absent, which is every other case in this file (see
	 * `backendManagerStub`).
	 */
	bootVersion = null,
	/** Restarts the check asked the manager for, in order. */
	restarts = [],
	/**
	 * `sys.prefix` both sides of the fixture's world report.
	 *
	 * One value for both sides is the ordinary case and the one the app is built
	 * around: the app spawned the daemon, so the install the plan would move is the
	 * install that process boots from (see `resolveInstallIdentity` below, whose stub
	 * reports this same prefix). A case about an ADOPTED daemon running a different
	 * install from the plan's names its own on `servingPrefix`.
	 */
	installPrefix = "/synthetic/venv",
	/**
	 * `sys.prefix` the SERVING daemon's own record reports, when it is not the
	 * plan's. Two names rather than one because the case R1 is about is exactly the
	 * pair being different: the plan describes the install an update would move, and
	 * an adopted daemon can be running a different one.
	 *
	 * A case whose serving daemon named NO prefix at all passes `servingPrefix: null`:
	 * that is the one shape #318 still falls back in, where the plan's version is the
	 * shim's install rather than the serving one, and the check refuses to compare
	 * (`driftInstallReading`).
	 */
	servingPrefix = installPrefix,
	/**
	 * What the successor daemon's own record reports after a restart. Left out, the
	 * successor comes back on the INSTALL reading, which is what a real repair
	 * produces; a case about a restart that did not take passes the version it is
	 * still serving, and one about a record that cannot be read yet passes `null`
	 * (`backendManagerStub`).
	 */
	successorBootVersion = undefined,
	/** The ownership answer the check reads, when a case is about that. */
	owned = null,
	/** The daemon's own work state; a function when a DEFERRAL needs it to change. */
	workState = "idle",
	/** Whether a conversation stream is open; likewise a value or a function. */
	sessionStreamOpen = false,
	/**
	 * Which startup mode the check runs in, BY NAME, resolved against the module the
	 * case is driving. `GLOBAL_INSTALL` by default, which is the mode whose plan
	 * carries an install version; `APP_BUNDLED_VENV` is the mode the app spawns its
	 * own daemon in, and #318 gives its plan the serving install's reading too
	 * (`serving.version`) - which is what lets the repair fire there, the mode the
	 * operator's log holds 66 rows of and the one round 1's R1 found inert.
	 */
	startupMode = "GLOBAL_INSTALL",
	npxVersion = null,
	/*
	 * The backoff between attempts at one app-channel feed fetch. The SHIPPED
	 * value is 1s then 3s (`UpdateService.appFeedRetryDelaysMs`, asserted as a
	 * value in its own case below); a case that is about what the retries DO
	 * narrows it here rather than spending four seconds per assertion.
	 */
	retryDelaysMs = [5, 5],
	/*
	 * What the machine's own network reading says, for the pre-flight gate.
	 * `null` leaves the stub answering `true`, which is every case from before
	 * the gate existed.
	 */
	netIsOnline = null,
	/*
	 * Drive the scheduled check instead of the aggregate one - the five-minute
	 * `checkForUpdates(true)` the operator's log opens with. This is the path
	 * whose silence the double report defeated.
	 */
	silentAppCheck = false,
	/*
	 * The updater stage a failure happens in. `idle` is an availability check;
	 * anything else is a download or an install the user asked for, which is the
	 * condition under which the `error` handler still reports during a check.
	 */
	stage = "idle",
	/*
	 * A hook that runs while the fixture is still standing, for the cases about
	 * the `error` event arriving when NO check is in flight - a state a case
	 * cannot reach from outside the helper, because the check is what it would
	 * have to interrupt. Its return value comes back as `probeResult`.
	 */
	probe = null,
	/*
	 * The install the SERVER reports it runs from (`/health`'s `prefix`), for the
	 * cases about the install that actually serves the app rather than the one
	 * `local-operator` resolves to on `PATH`.
	 *
	 * `appOwned` plants the synthetic root under the app's own managed tree in
	 * this fixture's home, which is the whole of what `update-service` reads
	 * ownership from; `kind` is the backend's own `install_kind`, echoed into the
	 * payload. Omitted means a server that names no install - the shape every case
	 * from before this parameter declares, and the shape an older backend answers.
	 *
	 * `appOwnedRoot` picks WHICH of the managed shapes that root is planted in,
	 * because they are not the same shape: `managed-python` is a parent the
	 * generations live under, while the pre-split `local-operator-venv` an older
	 * build left on disk IS a venv root. The containment test covered only the
	 * first, and the second answered "a package manager owns this" (review round
	 * 1, R1), so a case has to be able to plant a daemon in it.
	 */
	servingInstall = null,
}) => {
	const home = mkdtempSync(join(tmpdir(), "lo-verdict-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-verdict-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	/*
	 * The synthetic serving install, planted BEFORE the service is constructed so
	 * the check reads a world that is already in place. Under the managed tree when
	 * the case says the app owns it, and beside it otherwise - because ownership is
	 * decided by WHERE the root is, and a fixture that planted every root in one
	 * place could not tell the two remedies apart.
	 */
	const servingRoot = servingInstall
		? syntheticInstall(
				servingInstall.appOwned
					? servingInstall.appOwnedRoot === "legacy-venv"
						? /*
							 * The PRE-SPLIT environment an older build left on disk. A venv root
							 * in its own right rather than a parent of one, which is the shape the
							 * strict-descendant containment test could not see (R1).
							 */
							join(
								home,
								"Library",
								"Application Support",
								"Local Operator",
								"local-operator-venv",
							)
						: join(
								home,
								"Library",
								"Application Support",
								"Local Operator",
								"managed-python",
								"packaged",
								"environments",
								"synthetic-runtime-env",
							)
					: join(home, "synthetic-external-install"),
				servingInstall.version,
				{ editable: servingInstall.editable === true },
			)
		: null;
	/*
	 * The log lines the check writes, when a case asserts on them. The drift's own
	 * claim is that EVERY branch says what it did, including the ones that do nothing
	 * - the branch the first cut returned silently on (review round 1, R1 and R7) -
	 * and a claim about a log can only be checked by reading one.
	 */
	globalThis.__loTestLogs = [];
	const logs = globalThis.__loTestLogs;
	const { service, serviceDir } = await loadUpdateServiceModule();
	const sent = [];
	let interval = null;
	let health = null;
	if (netIsOnline !== null) globalThis.__loTestNetIsOnline = netIsOnline;
	try {
		health = createServer((request, response) => {
			if (!request.url?.startsWith("/health")) {
				response.writeHead(404);
				response.end();
				return;
			}
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(
				JSON.stringify({
					result: serverAnswersVersion
						? {
								version: serverVersion,
								/*
								 * The two fields a serving install is identified by, sent only when
								 * this case declared one: the install root, and the backend's own
								 * classification of the environment it runs in.
								 */
								...(servingRoot
									? {
											prefix: servingRoot,
											install_kind: servingInstall.kind ?? "pip",
										}
									: {}),
							}
						: {},
				}),
			);
		});
		const port = await new Promise((resolve) =>
			health.listen(0, "127.0.0.1", () => resolve(health.address().port)),
		);

		const updateService = new service.UpdateService(
			{
				isDestroyed: () => false,
				webContents: {
					send: (channel, payload) => sent.push({ channel, payload }),
					isDestroyed: () => false,
				},
			},
			backendManagerStub(
				service.LocalOperatorStartupMode[startupMode],
				() => updateService,
				{
					bootVersion,
					/*
					 * The successor's own reading, which is what makes the repair's claim
					 * checkable: left to `undefined` it comes back on the INSTALL reading the
					 * plan resolved, which is what a real restart onto an updated install
					 * produces.
					 */
					successorBootVersion:
						successorBootVersion === undefined
							? (installVersion ?? null)
							: successorBootVersion,
					restarts,
					installPrefix: servingPrefix,
					owned: owned ?? {
						owned: true,
						because: "this app process started it and still holds the process",
						startedByEarlierAppRun: false,
					},
					workState,
					sessionStreamOpen,
				},
			),
		);
		interval = updateService.updateCheckInterval;
		updateService.backendUrl = `http://127.0.0.1:${port}`;
		// The field the constructor derives from `app.isPackaged`, which the
		// fixture pins to a packaged app for every other case in this file.
		if (devMode) updateService.isDevMode = true;
		if (npxVersion !== null) {
			updateService.isNpxInstall = true;
			updateService.getLatestNpmVersion = async () => npxVersion;
		}
		updateService.getLatestPypiVersion = async () => publishedVersion ?? null;
		updateService.appFeedRetryDelaysMs = retryDelaysMs;
		updateService.updateStage = stage;
		/*
		 * The install, stubbed on the same terms as the registry above, and for the
		 * same reason: this fixture drives GLOBAL_INSTALL, so both the plan and the
		 * check resolve `local-operator` from the real PATH - which on the operator's
		 * machine is a real global install and in a clean checkout may be nothing at
		 * all. Pinned here so every case's world is the one it declared.
		 *
		 * ASYNC because the real one is (review R1-4): the installer probes it runs
		 * for an unclassifiable install are awaited off the main thread, so a
		 * synchronous stub would stop modelling the method it replaces.
		 */
		updateService.resolveInstallIdentity = async () => ({
			path: "/synthetic/bin/local-operator",
			realPath: "/synthetic/bin/local-operator",
			// The prefix a daemon spawned from this install reports in its own serve
			// record, which is what decides that the plan's reading IS the serving
			// install's reading (`driftInstallReading`).
			venvPrefix: installPrefix,
			version: installVersion,
		});
		globalThis.__loTestAppCheck = appCheck;
		/*
		 * The fixture's `ipcMain.handle` RECORDS the handlers (see its own comment),
		 * which is how a case can call the function the app would call - the same
		 * route the quit-for-update-install case above takes to its decision.
		 */
		let verdict;
		let probeResult;
		/** The error a handler rejected with, when the case drove one. */
		let rejected = null;
		if (silentAppCheck) {
			verdict = await updateService.checkForUpdates(true);
		} else if (ipc) {
			// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
			delete globalThis.__loIpcHandlers;
			updateService.setupIpcHandlers();
			/*
			 * Which handler the case drives. `check-for-all-updates` is the aggregate
			 * the button and the tiles use; `check-for-updates` is the app channel
			 * alone, which is what the failure alert's own retry calls - and the one
			 * whose rejection the renderer paints from.
			 */
			const channel = ipc.handler ?? "check-for-all-updates";
			const handler = globalThis.__loIpcHandlers?.[channel];
			assert.equal(
				typeof handler,
				"function",
				`${channel} must have a handler for the renderer to invoke`,
			);
			try {
				verdict = await handler({}, ipc.options);
			} catch (error) {
				/*
				 * A handler that REJECTS is an outcome a case has to be able to assert:
				 * `check-for-updates` answers a check the user asked for with a rejection,
				 * and that rejection is what the renderer's copy path runs on. Recorded
				 * rather than propagated, so a case can say which of the two it got.
				 */
				rejected = error;
			}
		} else {
			verdict = await updateService.checkForAllUpdates(false);
		}
		if (probe) {
			probeResult = await probe(updateService, sent);
		}
		/*
		 * Any wake-armed timer a probe left behind is cleared here: it is unref'd,
		 * but a case that fires the `resume` listener leaves a 20 s handle behind,
		 * and a suite whose timers outlive it is a suite whose teardown cannot be
		 * trusted.
		 */
		if (updateService.postWakeCheckTimer) {
			clearTimeout(updateService.postWakeCheckTimer);
			updateService.postWakeCheckTimer = null;
		}
		return {
			verdict,
			sent,
			probeResult,
			rejected,
			service: updateService,
			restarts,
			logs,
		};
	} finally {
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestAppCheck;
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loIpcHandlers;
		if (interval) clearInterval(interval);
		if (health) {
			health.closeAllConnections();
			health.close();
		}
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestNetIsOnline;
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestLogs;
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
};

/*
 * The app channel's fixtures carry `versionInfo`, because the real updater does.
 *
 * electron-updater's `AppUpdater.doCheckForUpdates` returns
 * `{isUpdateAvailable, versionInfo, updateInfo}` on BOTH of its outcomes - the
 * not-available return and the available one - with `versionInfo` the parsed
 * feed entry. A fixture that answered with the flag alone was modelling
 * something the library never produces, and it is exactly the shape QA round 1's
 * Q2 finding turns on: the channel now needs the READINGS, not just the flag
 * computed from them, so a missing `versionInfo` is refused rather than read as
 * "nothing newer".
 */
const APP_RUNNING_VERSION = "0.0.0-test";
const loAppCurrent = () => ({
	isUpdateAvailable: false,
	versionInfo: { version: APP_RUNNING_VERSION },
});
const loAppTrails = () => ({
	isUpdateAvailable: true,
	versionInfo: { version: "0.22.4" },
});

/**
 * The pure rule, bundled with NO fixture and no stubs.
 *
 * Kept out of `loadUpdateServiceModule` on purpose: the module's whole point is
 * that it has no electron import standing between it and its callers, and a
 * case that reaches it through the service's graph could not tell the two
 * apart. The caller removes the temp directory.
 */
const loadVerdictRule = async () => {
	const built = await build({
		stdin: {
			contents: 'export * from "./src/main/update-check-verdict";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const dir = mkdtempSync(join(tmpdir(), "lo-verdict-rule-"));
	const file = join(dir, "update-check-verdict.mjs");
	writeFileSync(file, built.outputFiles[0].text);
	return { rule: await import(file), dir };
};

/**
 * The operator's report, as a test: the app is current and the server trails
 * 0.54.43 -> 0.54.44.
 */
test("a server offer leaves the whole check with nothing to affirm", async () => {
	const { verdict, sent } = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.43",
		publishedVersion: "0.54.44",
	});

	/*
	 * Both halves of the reported pair really are produced, and that is the
	 * point: `update-not-available` is the app channel saying the app is
	 * current, and `backend-update-available` carries the server offer. The
	 * old button turned the FIRST of those into "You are up to date" and the
	 * notification panel rendered the second, so asserting only the absence of
	 * an affirmation would pass on a check that had stopped offering anything.
	 */
	const channels = sent.map(({ channel }) => channel);
	assert.ok(
		channels.includes("update-not-available"),
		JSON.stringify(channels),
	);
	assert.ok(
		channels.includes("backend-update-available"),
		JSON.stringify(channels),
	);

	// And the verdict - the only thing the renderer may read a sentence from -
	// affirms nothing, because half of this check found an update.
	assert.equal(verdict.app, "current");
	assert.equal(verdict.server, "available");
	assert.equal(verdict.affirmation, null);
});

/**
 * The mirror case, which the report also named ("either the server or the UI"):
 * the app trails and the server is current. The old renderer turned the server
 * channel's `backend-update-not-available` into "The server is up to date"
 * beside the app's own update offer.
 */
test("an app offer leaves the whole check with nothing to affirm", async () => {
	const { verdict, sent } = await loAggregateCheck({
		appCheck: loAppTrails,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
	});

	const channels = sent.map(({ channel }) => channel);
	assert.ok(
		channels.includes("backend-update-not-available"),
		JSON.stringify(channels),
	);
	// The event still exists and still means what it says about its own
	// channel; what changed is that no sentence about the installation is
	// built from it while the app has an update to offer.
	assert.equal(verdict.app, "available");
	assert.equal(verdict.server, "current");
	assert.equal(verdict.affirmation, null);
});

/** The one pair that earns a sentence, and it names both halves. */
test("a check that proved both channels current earns the affirmation", async () => {
	// The sentence is READ from the shipped module rather than retyped here, so
	// a copy change cannot pass an assertion that repeats the old words.
	const { rule, dir } = await loadVerdictRule();
	try {
		const { verdict, sent } = await loAggregateCheck({
			appCheck: loAppCurrent,
			serverVersion: "0.54.44",
			publishedVersion: "0.54.44",
		});

		assert.equal(verdict.app, "current");
		assert.equal(verdict.server, "current");
		assert.equal(verdict.affirmation, rule.UP_TO_DATE_AFFIRMATION);
		// Both channels' own "nothing newer" events are still emitted (the
		// notification panel clears a stale offer on them), so the sentence and
		// the events cannot have been the same mechanism by accident.
		const channels = sent.map(({ channel }) => channel);
		assert.ok(
			channels.includes("update-not-available"),
			JSON.stringify(channels),
		);
		assert.ok(
			channels.includes("backend-update-not-available"),
			JSON.stringify(channels),
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * The defect that cost the operator a day, as one case.
 *
 * The install on disk had moved to 0.54.44 while the daemon serving the app kept
 * running the build it booted with, 0.54.43 - and nothing acted on it, because the
 * check compared the install against the PUBLISHED release and never the process
 * against the install. The two readings here are the same pair, and the assertion
 * is that the check now asks the manager to restart the daemon onto the install.
 *
 * THIS CASE IS ALSO THE TRAP'S OWN PIN, and it has to stay that way: the reading
 * that says what the daemon is RUNNING is 0.54.43, while the reading that would be
 * convenient for it - the daemon's own `/health`, which this fixture scripts to
 * 0.54.44 - is the one a stale process answers with the on-disk version. If the
 * wiring ever reached for `/health` on the running side there would be no skew
 * here and this assertion would fail, which is the only behavioural way to hold
 * the rule `backend-version-drift.ts` states in prose (review round 1, R8: the
 * source-text slice that used to assert it failed on a formatter line-wrap).
 */
test("a server that booted from an older build is restarted onto the install", async () => {
	const { verdict, restarts, logs } = await loAggregateCheck({
		appCheck: loAppCurrent,
		// The install is current, so no update is offered - the state the operator's
		// log was in all day - and the daemon is still on the build it booted with.
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.43",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
		// A second check, after the successor has booted: nothing is restarted again
		// because the reading moved, which is what latching on the OBSERVED transition
		// buys (QA round 1, Q1c).
		probe: async (service) => service.checkForAllUpdates(false),
	});

	assert.deepEqual(
		restarts,
		["0.54.43"],
		"the check did not restart the server serving older code than the install",
	);
	// Nothing is claimed about the installation from a skew in the process: the
	// check's own verdict is still that the install is current.
	assert.equal(verdict.server, "current");
	/*
	 * AND THE CLAIM IS THE SETTLED READING (QA round 1, Q1b). The sentence is
	 * written from the successor's own record, so it names the build that came back -
	 * a claim that asserts a boot that did not happen is the defect this PR exists to
	 * delete, and the assertion is on the whole sentence rather than on its prefix.
	 */
	assert.ok(
		logs.some((line) =>
			line.includes(
				"Restarted the server onto the installed build: it booted on 0.54.44 (was 0.54.43, install is 0.54.44)",
			),
		),
		`the restart was not reported from the settled reading: ${logs.join(" | ")}`,
	);
});

/**
 * The same fixture with the readings agreeing, which is every ordinary machine.
 *
 * A restart here would be a process bounced for no reason on every check, and the
 * boot reading is what decides it - not the presence of a daemon.
 */
test("a server on the installed build is left alone", async () => {
	const { restarts } = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.44",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
	});

	assert.deepEqual(
		restarts,
		[],
		"a server on the installed build was restarted",
	);
});

/**
 * R1 of round 1, which is the mode the app actually runs in.
 *
 * `APP_BUNDLED_VENV` is the only mode where the app spawns its own daemon, and it
 * is the mode the operator's machine logged 66 times. The first cut could not
 * repair the drift there AT ALL: the install side of the comparison came from
 * `plan.installedInstallVersion`, which is null for every mode whose environment
 * the app owns, so the check computed no skew and returned before logging. The
 * install reading for this mode is the serving process's own environment, which
 * `/health` answers - and the boot reading below is still older than it, so the
 * repair fires.
 */
test("the app-owned mode repairs the drift, and says so", async () => {
	const { restarts, logs } = await loAggregateCheck({
		appCheck: loAppCurrent,
		startupMode: "APP_BUNDLED_VENV",
		// The daemon answers `/health` with the build installed on disk, which for
		// its own environment IS the install reading; the process itself booted on
		// 0.54.43.
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		bootVersion: "0.54.43",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
	});

	assert.deepEqual(
		restarts,
		["0.54.43"],
		"the app-owned mode left its own stale daemon serving the old build",
	);
	assert.ok(
		logs.some((line) => line.includes("booted on 0.54.43")),
		`the repair left no trace in the log: ${logs.join(" | ")}`,
	);
	assert.ok(
		logs.some((line) =>
			line.includes("Restarted the server onto the installed build"),
		),
		`the repair did not report the build that came back: ${logs.join(" | ")}`,
	);
});

/**
 * R2 of round 1: a restart may not kill a turn, and the guard has a real signal.
 *
 * A turn is running in the daemon when the first check fires (`workState`
 * "busy" -> the roster's `live_state`), so the restart is held - and the second
 * check, with the machine idle, is what lands it. The hold is unbounded on
 * purpose: a count that ran out mid-turn would restart into the turn it was
 * waiting for.
 */
test("a turn in flight defers the restart until the server is idle", async () => {
	let workState = "busy";
	const { restarts, logs } = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.43",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
		workState: () => workState,
		probe: async (service) => {
			workState = "idle";
			await service.checkForAllUpdates(false);
		},
	});

	assert.deepEqual(
		restarts,
		["0.54.43"],
		"the restart did not wait for the turn to finish, or never landed",
	);
	assert.ok(
		logs.some((line) => line.includes("a turn is running in the server")),
		`the deferred restart was not logged as deferred: ${logs.join(" | ")}`,
	);
});

/**
 * R4 of round 1: the read could not be taken, so nothing is restarted.
 *
 * `unknown` is not `idle`. A `sessions.list` that did not answer, or a daemon
 * too old to publish `live_state`, must not licence a restart that could land on
 * a turn this app cannot see - and the state is logged rather than passed over.
 */
test("an unreadable work state holds the restart instead of assuming quiet", async () => {
	const { restarts, logs } = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.43",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
		workState: "unknown",
	});

	assert.deepEqual(
		restarts,
		[],
		"a restart was landed on a work state this app could not read",
	);
	assert.ok(
		logs.some((line) => line.includes("work state could not be read")),
		`the unreadable state was not logged: ${logs.join(" | ")}`,
	);
});

/**
 * R4 of round 1: the deferral count, which had no test at all.
 *
 * An open conversation is a VIEW rather than a turn, so it defers exactly one
 * check and the next one restarts. Both halves of the count are driven here: the
 * first check increments it (`session-stream-open`), the second - with the
 * renderer having let go - restarts rather than deferring again forever.
 */
test("an open conversation defers one check, and the next one restarts", async () => {
	let open = true;
	const { restarts, logs } = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.43",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
		sessionStreamOpen: () => open,
		probe: async (service) => {
			open = false;
			await service.checkForAllUpdates(false);
		},
	});

	assert.deepEqual(restarts, ["0.54.43"]);
	assert.ok(
		logs.some((line) => line.includes("a conversation is open")),
		`the courtesy deferral was not logged: ${logs.join(" | ")}`,
	);
});

/**
 * Q1b/Q1c of QA round 1: a restart whose reading did not move is RETRIED, and then
 * left alone - and it is never claimed as a repair.
 *
 * The kill loop R4 pre-empted is real: a pair that survives its own restart would be
 * restarted every check. The first cut paid for that with a latch set BEFORE the
 * restart, which silenced a repair that had not happened at all (Q1's adopted
 * daemon). Here the reading is what is checked: a restart that came back on the same
 * build is reported as not having taken, retried once, and only then latched - and
 * the `Restarted ... it booted on` sentence never appears, because the successor's
 * own record contradicts it.
 */
test("a restart that did not move the server is retried, then left alone", async () => {
	const { restarts, logs } = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.43",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
		/*
		 * The successor comes back on the build the restart was meant to leave - the
		 * shape an installed-but-not-serving environment produces.
		 */
		successorBootVersion: "0.54.43",
		// Three checks: the first spends a restart, the second spends the retry (Q1c's
		// "a failed repair is retried rather than silenced"), the third finds the pair
		// halted.
		probe: async (service) => {
			await service.checkForAllUpdates(false);
			return service.checkForAllUpdates(false);
		},
	});

	assert.deepEqual(
		restarts,
		["0.54.43", "0.54.43"],
		"the retry bound is not two restarts for one unmoved pair",
	);
	assert.ok(
		logs.some((line) =>
			line.includes("still serving 0.54.43 after the restart meant to move it"),
		),
		`the unmoved restart was not reported as such: ${logs.join(" | ")}`,
	);
	assert.ok(
		logs.some((line) =>
			line.includes(
				"after 2 restarts for install 0.54.44; not restarting it again",
			),
		),
		`the halt was not logged: ${logs.join(" | ")}`,
	);
	assert.ok(
		!logs.some((line) =>
			line.includes("Restarted the server onto the installed build"),
		),
		`a restart that did not move the reading was claimed as a repair: ${logs.join(" | ")}`,
	);
});

/**
 * THE CASE QA'S Q1 IS ABOUT, and the one the operator's own machine is in: a daemon
 * this app did NOT start in this app run - an adopted `EXISTING_SERVER`, 400 rows of
 * the operator's log - serving a build older than the install.
 *
 * The app cannot move it: `restart()` is `stop(true)` + `start()` and there is no
 * generation to stop, so the repair is not attempted, nothing is claimed about it,
 * and the reason the refusal is what it is (this app run holds no process for that
 * daemon, though an earlier run started it) is IN the sentence rather than left for
 * the reader to guess. And it is stated on EVERY check: a latch on a pair nothing
 * moved would be the permanent silence this round removes.
 */
test("an adopted daemon is reported, not claimed as repaired", async () => {
	const { restarts, logs } = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.43",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
		owned: {
			owned: false,
			because:
				"it runs from /Users/someone/Library/Application Support/Local Operator/managed-python/packaged/environments/183b, an environment this app manages, but the process is not one this app run started and this app can only stop the generation it holds",
			startedByEarlierAppRun: true,
		},
		probe: async (service) => service.checkForAllUpdates(false),
	});

	assert.deepEqual(restarts, [], "an adopted daemon must not be restarted");
	assert.ok(
		!logs.some((line) =>
			line.includes("Restarted the server onto the installed build"),
		),
		`a repair that cannot happen was claimed: ${logs.join(" | ")}`,
	);
	assert.ok(
		logs.some((line) =>
			line.includes("the skew is reported and the process is left running"),
		),
		`the refusal was not logged: ${logs.join(" | ")}`,
	);
	assert.ok(
		logs.some((line) => line.includes("one an earlier app run started")),
		`the reader's own situation was not named: ${logs.join(" | ")}`,
	);
	// Both checks reported it: nothing latched a pair that never moved.
	assert.equal(
		logs.filter((line) =>
			line.includes("the skew is reported and the process is left running"),
		).length,
		2,
		`the second check went quiet instead of reporting the skew again: ${logs.join(" | ")}`,
	);
});

/**
 * THE USER-VISIBLE HALF OF THE CASE ABOVE (review round 2, T1): the refusal was
 * right and reached nobody.
 *
 * `settleBackendVersionDrift` sends nothing to the renderer, and the panel that
 * carries this state is fed by `/health` - the very reading this branch's own
 * module documents as blind to staleness. So on this machine (a process serving
 * 0.56.2 out of memory, an install already at 0.56.11) the event's two readings
 * were the SAME string, the renderer's `install === running` guard suppressed the
 * notice by construction, and the `restartable: false` copy that names the
 * reader's next step was unreachable. The event has to carry the serving
 * process's own record, which is also the pair the refusal above is about.
 *
 * Driven on the SILENT pass deliberately: the launch and the five-minute check
 * are the callers that told nobody anything, and the only thing that lets them
 * speak is the disagreement between these two readings.
 */
test("the skew an adopted daemon leaves reaches the renderer on a silent check", async () => {
	const { sent, restarts, logs, probeResult } = await loAggregateCheck({
		appCheck: loAppCurrent,
		// `/health` answers with the build installed on disk - the trap, exactly as
		// the operator's machine walked into it.
		serverVersion: "0.56.11",
		publishedVersion: "0.56.11",
		installVersion: "0.56.11",
		// What this process actually loaded, from its own serve record.
		bootVersion: "0.56.2",
		servingInstall: { version: "0.56.11", appOwned: true, kind: "pip" },
		owned: {
			owned: false,
			because:
				"it runs from /Users/someone/Library/Application Support/Local Operator/managed-python/packaged/environments/183b, an environment this app manages, but the process is not one this app run started and this app can only stop the generation it holds",
			startedByEarlierAppRun: true,
		},
		// The silent server check, which is `checkForBackendUpdates(true)` - the
		// caller behind every launch and every periodic pass.
		probe: async (service, sent) => {
			const before = sent.length;
			await service.checkForBackendUpdates(true);
			return sent.slice(before);
		},
	});

	assert.deepEqual(restarts, [], "an adopted daemon must not be restarted");
	const silent = probeResult.filter(
		({ channel }) => channel === "backend-update-not-available",
	);
	assert.equal(
		silent.length,
		1,
		`the silent check said nothing: ${JSON.stringify(probeResult.map(({ channel }) => channel))}`,
	);
	assert.equal(silent[0].payload.version, "0.56.11");
	/*
	 * THE RECORD'S READING, and the assertion that holds the whole fix: with the
	 * running side taken from `/health` again this is "0.56.11", the two readings
	 * are equal, and the renderer's guard mutes the notice - which is the state this
	 * round found.
	 */
	assert.equal(silent[0].payload.runningVersion, "0.56.2");
	/*
	 * And WHO CAN CLOSE THE GAP: false, because this app run holds no generation for
	 * that daemon - so the panel is the arm that names the reader's own step rather
	 * than promising a restart the app will not perform.
	 */
	assert.equal(silent[0].payload.restartable, false);
	assert.ok(
		logs.some((line) =>
			line.includes("the skew is reported and the process is left running"),
		),
		`the refusal was not logged: ${logs.join(" | ")}`,
	);
	// The check's own verdict is still about the INSTALL, which is what the event's
	// `version` field is, and the whole check still earns nothing: the install is
	// current, so there is no offer to carry the skew either.
	assert.ok(
		!sent.some(({ channel }) => channel === "backend-update-available"),
		JSON.stringify(sent.map(({ channel }) => channel)),
	);
});

/**
 * T3 of round 2: a restart that MOVED the reading but did not land on the install.
 *
 * `settledBoot !== drift.bootVersion` used to be the whole test for "landed on the
 * installed build", so a successor that came back on a THIRD build was announced
 * as being on the install with the contradiction inside the same sentence ("it
 * booted on 0.54.45 (was 0.54.43, install is 0.54.44)"). The claim is now made
 * from the comparison against the install, with its own line for the case that is
 * neither reading.
 */
test("a successor on a third build is not claimed as the installed one", async () => {
	const { restarts, logs } = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.43",
		successorBootVersion: "0.54.45",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
	});

	assert.deepEqual(restarts, ["0.54.43"], "the drift was not repaired");
	assert.ok(
		!logs.some((line) =>
			line.includes("Restarted the server onto the installed build"),
		),
		`a successor that did not land on the install was claimed as it: ${logs.join(" | ")}`,
	);
	assert.ok(
		logs.some(
			(line) =>
				line.includes("came back on 0.54.45") &&
				line.includes("neither the build it was serving"),
		),
		`the fourth sentence is missing: ${logs.join(" | ")}`,
	);
});

/**
 * R3 AGAIN, AND THIS TIME IT IS PINNED (QA round 2, MAJOR).
 *
 * The repair is purely local - the plan classifies an install on disk and the boot
 * reading comes from the daemon on this machine - so a machine that reports no
 * network must still move a process serving code the disk has already replaced.
 * The ordering is what makes that true: both reads and the settle sit ABOVE the
 * `networkIsReachable()` gate, and only the published-release read sits below it.
 * The #318 reconciliation onto `main` moved them below, which put an offline
 * machine back to skipping the whole server check and leaving the stale daemon
 * serving with nothing said. Nothing pinned it: the two cases in this file that
 * declare `netIsOnline: false` are about the APP channel, so the suite stayed
 * green while the drift repair was inert offline.
 *
 * The assertion is on the ORDER, not only on the restart: a run that restarts the
 * daemon and then skips the release read is the repair happening before the gate,
 * while a run that logs the skip first has skipped the repair with it.
 */
test("a machine that reports no network still repairs the drift", async () => {
	const { restarts, logs } = await loAggregateCheck({
		appCheck: loAppCurrent,
		// `net.isOnline()` false, which is what the check's own gate reads.
		netIsOnline: false,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.43",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
	});

	assert.deepEqual(
		restarts,
		["0.54.43"],
		"an offline machine left a process serving older code than the install",
	);
	const repaired = logs.findIndex((line) =>
		line.includes("Restarted the server onto the installed build"),
	);
	const skipped = logs.findIndex((line) =>
		line.includes("Skipping the server update check"),
	);
	assert.ok(
		repaired !== -1,
		`the repair was not reported: ${logs.join(" | ")}`,
	);
	assert.ok(
		skipped !== -1,
		`the release read was not skipped offline: ${logs.join(" | ")}`,
	);
	assert.ok(
		repaired < skipped,
		`the repair settled after the network gate: ${logs.join(" | ")}`,
	);
});

/**
 * Q3-1 (QA round 3, MINOR): the same offline machine, one state further out.
 *
 * The repair was moved above the network gate because both of its readings are
 * local (R3). The REPORT is about the same two readings - the install on disk and
 * the build the serving process loaded - so an offline machine can still be told
 * its daemon is a build behind, and the event that says so used to sit at the tail
 * of the success path, past the gate: an adopted daemon this app correctly refuses
 * to move was refused, logged, and left with no surface at all on the machine where
 * the reader cannot go looking. Same rig, same adopted daemon, same install bump as
 * the online case above - the ONE variable is the network reading - so this is the
 * A/B that prices the finding.
 *
 * Driven on the SILENT pass for the reason the online case states: the launch and
 * the five-minute check are the callers that told nobody anything, and the
 * disagreement between these two readings is what lets them speak.
 */
test("an offline machine still reports the skew an adopted daemon leaves", async () => {
	const { sent, restarts, logs, probeResult } = await loAggregateCheck({
		appCheck: loAppCurrent,
		// `net.isOnline()` false: the release read is skipped, the pair is not.
		netIsOnline: false,
		serverVersion: "0.56.11",
		publishedVersion: "0.56.11",
		installVersion: "0.56.11",
		// What this process actually loaded, from its own serve record - the reading
		// `/health` cannot give, because it answers with the disk.
		bootVersion: "0.56.2",
		servingInstall: { version: "0.56.11", appOwned: true, kind: "pip" },
		owned: {
			owned: false,
			because:
				"it runs from /Users/someone/Library/Application Support/Local Operator/managed-python/packaged/environments/183b, an environment this app manages, but the process is not one this app run started and this app can only stop the generation it holds",
			startedByEarlierAppRun: true,
		},
		probe: async (service, sent) => {
			const before = sent.length;
			await service.checkForBackendUpdates(true);
			return sent.slice(before);
		},
	});

	assert.deepEqual(
		restarts,
		[],
		"an adopted daemon must not be restarted, network or no network",
	);
	const notices = probeResult.filter(
		({ channel }) => channel === "backend-update-not-available",
	);
	assert.equal(
		notices.length,
		1,
		`the offline silent check said nothing: ${JSON.stringify(
			probeResult.map(({ channel }) => channel),
		)}`,
	);
	assert.equal(notices[0].payload.version, "0.56.11");
	assert.equal(
		notices[0].payload.runningVersion,
		"0.56.2",
		"the pair must carry the process's own reading, not `/health`'s",
	);
	assert.equal(notices[0].payload.restartable, false);
	/*
	 * AND IT SAYS NO RELEASE WAS READ, which is the half of this that is not the
	 * gate: the pair is measured locally, so it is worth reporting offline - but
	 * nothing on this pass compared the install against a published release, and the
	 * renderer's sentence names the install. A payload that omitted this would have
	 * the panel call an install "up to date" on a check that never looked.
	 */
	assert.equal(
		notices[0].payload.releaseRead,
		false,
		"an offline check must not let the panel call the install current",
	);
	// The skip sentence is still what the release read does, and it still happens.
	assert.ok(
		logs.some((line) => line.includes("Skipping the server update check")),
		`the release read was not skipped offline: ${logs.join(" | ")}`,
	);
	// Nothing was offered: the install is current, so the skew is the only news.
	assert.ok(
		!sent.some(({ channel }) => channel === "backend-update-available"),
		JSON.stringify(sent.map(({ channel }) => channel)),
	);
});

/**
 * AND THE REPAIR'S OWN OUTCOME IS STILL NOT ANNOUNCED AS A SKEW.
 *
 * The offline report reads the pair at the moment of the send, and the send now
 * sits directly after `settleBackendVersionDrift` - which may have just SIGTERMed
 * the stale daemon and booted a successor on the install. A pair captured before
 * that settle would put "The server is on an older build than the install" on the
 * screen one instant after the app closed that gap, which is the round-1/round-2
 * false-alarm shape returning on the patched path. So the app-owned offline case
 * asserts SILENCE, from the successor's own reading.
 */
test("an offline repair is not announced as a skew it has just closed", async () => {
	const { restarts, probeResult } = await loAggregateCheck({
		appCheck: loAppCurrent,
		netIsOnline: false,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.43",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
		probe: async (service, sent) => {
			const before = sent.length;
			await service.checkForBackendUpdates(true);
			return sent.slice(before);
		},
	});

	assert.deepEqual(restarts, ["0.54.43"], "the drift was not repaired");
	assert.equal(
		probeResult.filter(
			({ channel }) => channel === "backend-update-not-available",
		).length,
		0,
		`a closed skew was announced: ${JSON.stringify(
			probeResult.map(({ channel, payload }) => [channel, payload]),
		)}`,
	);
});

/**
 * R1 and R7 of round 1: the paths that do NOT act, and what they say.
 *
 * The first cut returned before logging anything for every non-stale reading,
 * which is how the repair sat inert on the machine that reported the incident
 * with nothing in the log to say so. Each of these is a different absence and
 * each has to name itself: an owned daemon deliberately left alone, a comparison
 * between two installs nobody has shown to be the same one, and a machine where
 * the readings simply agree.
 */
test("the checks that do not act say which reading they saw", async () => {
	// Not this app's daemon to bounce - and the refusal carries the ownership rule's
	// own answer rather than one sentence for every unowned daemon.
	const notOurs = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.43",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
		owned: {
			owned: false,
			because: "it runs from /usr/local/venv, which this app does not manage",
			startedByEarlierAppRun: false,
		},
	});
	assert.deepEqual(notOurs.restarts, []);
	assert.ok(
		notOurs.logs.some((line) =>
			line.includes("the skew is reported and the process is left running"),
		),
		`the refusal was not logged: ${notOurs.logs.join(" | ")}`,
	);
	assert.ok(
		notOurs.logs.some((line) =>
			line.includes("which this app does not manage"),
		),
		`the refusal did not say what it read: ${notOurs.logs.join(" | ")}`,
	);

	// The server named no install root, so the plan's reading is the shim's install
	// rather than the serving one - the one fallback #318 still makes, and the case
	// this check refuses to compare across.
	const twoInstalls = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.43",
		installPrefix: "/usr/local/venv",
	});
	assert.deepEqual(twoInstalls.restarts, []);
	assert.ok(
		twoInstalls.logs.some((line) => line.includes("cannot be told")),
		`an unanswerable comparison was not logged: ${twoInstalls.logs.join(" | ")}`,
	);

	// The ordinary machine: nothing to repair, stated rather than passed over.
	const agreeing = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
		bootVersion: "0.54.44",
		servingInstall: { version: "0.54.44", appOwned: true, kind: "pip" },
	});
	assert.deepEqual(agreeing.restarts, []);
	assert.ok(
		agreeing.logs.some(
			(line) =>
				line.includes("No server version drift to repair") &&
				line.includes("the server loaded the installed build"),
		),
		`the agreeing case left no trace: ${agreeing.logs.join(" | ")}`,
	);

	// And a daemon whose record carries no boot version at all - the state the
	// rest of this file's cases run in - says THAT, rather than nothing.
	assert.ok(
		agreeing.logs.some((line) =>
			line.includes("No server version drift to repair"),
		),
	);
	const noRecord = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		installVersion: "0.54.44",
	});
	assert.ok(
		noRecord.logs.some((line) => line.includes("carries no boot version")),
		`a record-less daemon left no trace: ${noRecord.logs.join(" | ")}`,
	);
});

/**
 * The same check, driven through the IPC handler the renderer actually invokes.
 *
 * Why this case exists (review round 1, R4): the six cases above reach
 * `UpdateService.checkForAllUpdates` and never `setupIpcHandlers`, so the rule
 * that decides whether a renderer-originated check is silent was asserted
 * nowhere - and `silent` is not a detail. It is what decides whether either
 * channel emits its own `*-not-available` event, which is the property
 * `update-notification.tsx` clears a stale offer and a by-hand panel on
 * (`:669`, `:827`), and it gates the npx registry read.
 *
 * Two invokes must run NON-silent: no options at all (the default this handler
 * had when it dropped `options` entirely, so no caller changed behaviour), and
 * `{manual: true}` (what every renderer caller sends). `{silent: true}` is the
 * only thing that suppresses the events - and it suppresses only the events: the
 * check still proved both channels current, so the invoke still resolves the
 * sentence.
 */
test("an invoke through the aggregate handler emits both channels' events unless it asks to be silent", async () => {
	const { rule, dir } = await loadVerdictRule();
	try {
		for (const options of [undefined, { manual: true }]) {
			const { verdict, sent } = await loAggregateCheck({
				appCheck: loAppCurrent,
				serverVersion: "0.54.44",
				publishedVersion: "0.54.44",
				ipc: { options },
			});
			const channels = sent.map(({ channel }) => channel);
			assert.ok(
				channels.includes("update-not-available"),
				`options=${JSON.stringify(options)}: ${JSON.stringify(channels)}`,
			);
			assert.ok(
				channels.includes("backend-update-not-available"),
				`options=${JSON.stringify(options)}: ${JSON.stringify(channels)}`,
			);
			assert.equal(verdict.affirmation, rule.UP_TO_DATE_AFFIRMATION);
		}

		const { verdict, sent } = await loAggregateCheck({
			appCheck: loAppCurrent,
			serverVersion: "0.54.44",
			publishedVersion: "0.54.44",
			ipc: { options: { silent: true } },
		});
		const channels = sent.map(({ channel }) => channel);
		assert.ok(
			!channels.includes("update-not-available"),
			JSON.stringify(channels),
		);
		assert.ok(
			!channels.includes("backend-update-not-available"),
			JSON.stringify(channels),
		);
		// Silence is about the EVENTS, not the answer: the check still proved both
		// channels current, so the invoke that asked for it still resolves the one
		// sentence such a check earns.
		assert.equal(verdict.affirmation, rule.UP_TO_DATE_AFFIRMATION);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * QA round 1, Q2: a status may not be derived from a version nobody can read.
 *
 * `isNewerVersion` splits on `.` and coerces with `Number`, so a part that is
 * not a number becomes `NaN`, every `NaN` comparison is false, and a malformed
 * pair reads as "nothing newer" - which then earned the WHOLE-installation
 * affirmation. Three shapes, one rule: an unreadable reading is the same
 * absence as one that never arrived.
 */
test("an unreadable server version reading cannot earn the affirmation", async () => {
	const { rule, dir } = await loadVerdictRule();
	try {
		// The installed version, from a real /health response whose payload
		// carries `999.invalid` - QA's first reproduction, verbatim.
		const installedUnreadable = await loAggregateCheck({
			appCheck: loAppCurrent,
			serverVersion: "999.invalid",
			publishedVersion: "0.54.43",
		});
		assert.equal(installedUnreadable.verdict.server, "unavailable");
		assert.equal(installedUnreadable.verdict.app, "current");
		assert.equal(installedUnreadable.verdict.affirmation, null);
		/*
		 * The reading was PRESENT - the health endpoint answered with a version
		 * string - so this is about the value rather than about a missing answer,
		 * which is what separates it from the no-version case above.
		 */
		assert.ok(
			installedUnreadable.sent.some(
				({ channel }) => channel === "backend-update-error",
			),
			JSON.stringify(installedUnreadable.sent.map(({ channel }) => channel)),
		);

		// The published version, which is the other side of the same comparison.
		const publishedUnreadable = await loAggregateCheck({
			appCheck: loAppCurrent,
			serverVersion: "0.54.43",
			publishedVersion: "invalid",
		});
		assert.equal(publishedUnreadable.verdict.server, "unavailable");
		assert.equal(publishedUnreadable.verdict.affirmation, null);

		/*
		 * And the direction QA also measured: an unreadable INSTALLED version used
		 * to produce an offer ("update to 0.54.44") for a server whose version
		 * could not be read at all - the same confusion that once produced a pip
		 * command for an unreadable server. No offer, and no status.
		 */
		const offerFromUnreadable = await loAggregateCheck({
			appCheck: loAppCurrent,
			serverVersion: "not-a-version",
			publishedVersion: "0.54.44",
		});
		assert.equal(offerFromUnreadable.verdict.server, "unavailable");
		assert.equal(offerFromUnreadable.verdict.affirmation, null);
		assert.ok(
			!offerFromUnreadable.sent.some(
				({ channel }) => channel === "backend-update-available",
			),
			JSON.stringify(offerFromUnreadable.sent.map(({ channel }) => channel)),
		);

		// The app channel: no `versionInfo` at all, then a malformed one.
		const appNoReading = await loAggregateCheck({
			appCheck: () => ({ isUpdateAvailable: false }),
			serverVersion: "0.54.44",
			publishedVersion: "0.54.44",
		});
		assert.equal(appNoReading.verdict.app, "unavailable");
		assert.equal(appNoReading.verdict.affirmation, null);

		const appUnreadable = await loAggregateCheck({
			appCheck: () => ({
				isUpdateAvailable: false,
				versionInfo: { version: "999.invalid" },
			}),
			serverVersion: "0.54.44",
			publishedVersion: "0.54.44",
		});
		assert.equal(appUnreadable.verdict.app, "unavailable");
		assert.equal(appUnreadable.verdict.affirmation, null);

		// The npx channel reads the npm registry instead of the updater.
		const npxUnreadable = await loAggregateCheck({
			appCheck: () => ({
				isUpdateAvailable: false,
				versionInfo: { version: "0.0.0-test" },
			}),
			npxVersion: "invalid",
			serverVersion: "0.54.44",
			publishedVersion: "0.54.44",
		});
		assert.equal(npxUnreadable.verdict.app, "unavailable");
		assert.equal(npxUnreadable.verdict.affirmation, null);

		// And the sentence is still reachable where the readings are real.
		const npxCurrent = await loAggregateCheck({
			appCheck: () => ({
				isUpdateAvailable: false,
				versionInfo: { version: "0.0.0-test" },
			}),
			npxVersion: "0.0.0-test",
			serverVersion: "0.54.44",
			publishedVersion: "0.54.44",
		});
		assert.equal(npxCurrent.verdict.app, "current");
		assert.equal(npxCurrent.verdict.affirmation, rule.UP_TO_DATE_AFFIRMATION);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * Review round 3 (R8): the unreadable-reading gate must not swallow the two
 * branches that name an ABSENT reading.
 *
 * The gate was first written ABOVE both of them, and `isReadableVersion("Unknown")`
 * is false - the sentinel is in this file's own pinned reject list below - so the
 * `"Unknown"` branch and the missing-reading branch above it could never run,
 * while the gate's own comment claimed the `Unknown` case kept its own, more
 * specific message. The STATUS is `unavailable` on all three paths, so the
 * ordering is visible only in the MESSAGE: it is what tells a reader which of the
 * three absences this check hit, and it is the surface this whole change exists to
 * stop misdescribing.
 */
test("an absent server reading keeps its own message, and an unparseable one takes the gate", async () => {
	// An older server's health answer, which carries no version at all: the
	// `"Unknown"` sentinel path.
	const unknown = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverAnswersVersion: false,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
	});
	assert.equal(unknown.verdict.server, "unavailable");
	assert.equal(unknown.verdict.affirmation, null);

	// A reading that arrived and cannot be parsed: the gate's own case.
	const unparseable = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "999.invalid",
		publishedVersion: "0.54.43",
	});
	assert.equal(unparseable.verdict.server, "unavailable");
	assert.equal(unparseable.verdict.affirmation, null);

	/*
	 * These reports come from `checkForBackendUpdates`, and the phase they carry is
	 * asserted rather than left to the reader: it is what keeps a check's sentence
	 * off the update attempt's failure panel when the check fails inside a running
	 * server update (review R2-1, QA Q2).
	 */
	const errorReports = (result) =>
		result.sent.filter(({ channel }) => channel === "backend-update-error");
	const errorMessages = (result) =>
		errorReports(result).map(({ payload }) => payload.message);
	const unknownMessage = errorMessages(unknown);
	const gateMessage = errorMessages(unparseable);
	for (const { payload } of [
		...errorReports(unknown),
		...errorReports(unparseable),
	]) {
		assert.equal(payload.phase, "check", JSON.stringify(payload));
	}
	assert.equal(
		unknownMessage.length,
		1,
		JSON.stringify(unknown.sent.map(({ channel }) => channel)),
	);
	assert.equal(
		gateMessage.length,
		1,
		JSON.stringify(unparseable.sent.map(({ channel }) => channel)),
	);
	/*
	 * The ordering, without retyping either sentence: if the gate preempted the
	 * sentinel branch, these would be the SAME message - the gate's - and the
	 * sentinel's own, user-visible remedy would be unreachable. They differ, and
	 * the sentinel's is the one that names the remedy.
	 */
	assert.notEqual(
		unknownMessage[0],
		gateMessage[0],
		"the sentinel path and the gate must not answer with the same sentence",
	);
	assert.match(unknownMessage[0], /Restart the app/);

	// The third absence is the mirror: a reading that IS readable and older must
	// still reach the offer, so the gate cannot be widened into the ordinary path.
	const older = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.43",
		publishedVersion: "0.54.44",
	});
	assert.equal(older.verdict.server, "available");
	assert.ok(
		older.sent.some(({ channel }) => channel === "backend-update-available"),
		JSON.stringify(older.sent.map(({ channel }) => channel)),
	);
});

/**
 * The requirement's own half, as a case: the version COMPARED is the install's.
 *
 * The app can be attached to a daemon that is not the install it would update -
 * discovery adopted a daemon this app did not start, or an update landed and the
 * daemon serving the old build has not been restarted - and the panel must not
 * describe one install as the other. The comparison follows the install, and the
 * backend still serving is named beside it.
 */
test("the check follows the install, and names the running backend beside it", async () => {
	const trail = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.42",
		installVersion: "0.54.43",
		publishedVersion: "0.54.44",
	});
	const offer = trail.sent.find(
		({ channel }) => channel === "backend-update-available",
	);
	assert.ok(offer, JSON.stringify(trail.sent.map(({ channel }) => channel)));
	// The version the update action would move, not the one the daemon serves.
	assert.equal(offer.payload.currentVersion, "0.54.43");
	/*
	 * BOTH READINGS AS FIELDS, not as a clause glued to `detail` (review D3). The
	 * clause form was what let the skew leave the screen: the managed branch never
	 * rendered `detail`, so the panel asserted the install's version as the one the
	 * reader was using while the sentence that corrected it was mounted nowhere
	 * (review R1-2). The renderer now builds the sentence from the pair, so the
	 * pair has to arrive - and `detail` keeps only the classification evidence.
	 */
	assert.equal(offer.payload.runningVersion, "0.54.42");
	assert.doesNotMatch(offer.payload.detail, /running backend reports/);
	assert.match(offer.payload.detail, /classified as /);
	assert.equal(trail.verdict.server, "available");

	// And the mirror: the install is current although the daemon trails it, so
	// there is nothing to offer - the check answers for what an update would move.
	const installCurrent = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.43",
		installVersion: "0.54.44",
		publishedVersion: "0.54.44",
	});
	/*
	 * `restart-required`, NOT `current`: the install is at the published release
	 * and the server actually serving this app is not, so there is nothing to
	 * install and nothing to affirm either. The status was `current` here, which
	 * let the whole check earn "The application and server are up to date" in the
	 * same turn as the skew notice below - the reported contradiction, one sentence
	 * further on. `restart-required` is the state the panel's notice is about, and
	 * it is what keeps the affirmation off this machine.
	 */
	assert.equal(installCurrent.verdict.server, "restart-required");
	assert.equal(installCurrent.verdict.affirmation, null);
	assert.ok(
		!installCurrent.sent.some(
			({ channel }) => channel === "backend-update-available",
		),
		JSON.stringify(installCurrent.sent.map(({ channel }) => channel)),
	);
	/*
	 * AND THE SKEW STILL ARRIVES, which is QA Q-1: with the install already latest
	 * there is no offer to carry it, so this event is the only vehicle - and it
	 * carried nothing, leaving a user whose runtime lags told nothing at all and no
	 * later check able to re-offer, since the install itself is up to date.
	 */
	const notAvailable = installCurrent.sent.find(
		({ channel }) => channel === "backend-update-not-available",
	);
	assert.ok(
		notAvailable,
		JSON.stringify(installCurrent.sent.map(({ channel }) => channel)),
	);
	assert.equal(notAvailable.payload.version, "0.54.44");
	assert.equal(notAvailable.payload.runningVersion, "0.54.43");
	/*
	 * And WHO CAN CLOSE THE GAP travels with it: this fixture's manager says the
	 * daemon is the app's own (`backendManagerStub`), so the notice may tell the
	 * user to restart Local Operator - while for an adopted daemon the same reading
	 * means the app deliberately will not touch the process
	 * (`isUsingExternalBackend`), which is a different sentence about the same
	 * numbers. The renderer picks between them from this flag.
	 */
	assert.equal(notAvailable.payload.restartable, true);
	/*
	 * AND WHOSE INSTALL A PRESS WOULD MOVE, which is a different question (design
	 * D5). This fixture drives GLOBAL_INSTALL: the app supervises the daemon (so
	 * `restartable` is true) while the install belongs to a uv tool or pipx, which
	 * is exactly the machine where the skew panel's `Restart the server` press would
	 * run the install's own updater - or land on the by-hand panel - rather than the
	 * restart its label names. The renderer gates the control on this reading, so
	 * the false arm is asserted here and the app-owned arm is asserted on the
	 * attempt's own completion below.
	 */
	assert.equal(notAvailable.payload.appOwnedEnvironment, false);
});

/**
 * THE REPORTED DEFECT, as a case: the install that is JUDGED is the one serving
 * the app.
 *
 * The operator's machine reported "The application and server are up to date"
 * while the panel's own Settings row printed a different version, because the
 * check classified the install `local-operator` resolves to - a uv tool install
 * at the published release - and compared THAT against PyPI, while an app-managed
 * environment three releases behind answered `/health`.
 *
 * The fixture's world is exactly that: the shim's install is at the published
 * release (so a check that judged it affirms the installation current), and the
 * server reports a DIFFERENT root, older than that, in `/health`'s `prefix`.
 */
test("the check judges the install that serves the app, not the one the shim names", async () => {
	const { verdict, sent } = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.56.8",
		publishedVersion: "0.56.11",
		// The install on PATH: current, and NOT the one answering this app.
		installVersion: "0.56.11",
		// The install the running server says it is serving from.
		servingInstall: { version: "0.56.8", appOwned: true, kind: "pip" },
	});

	assert.equal(verdict.server, "available");
	assert.equal(verdict.affirmation, null);

	const offer = sent.find(
		({ channel }) => channel === "backend-update-available",
	);
	assert.ok(offer, JSON.stringify(sent.map(({ channel }) => channel)));
	// The SERVING install's version, not the shim install's 0.56.11.
	assert.equal(offer.payload.currentVersion, "0.56.8");
	assert.equal(offer.payload.runningVersion, "0.56.8");
	assert.equal(offer.payload.latestVersion, "0.56.11");
	/*
	 * AND NO PACKAGE-MANAGER COMMAND, because this install is the app's own: the
	 * `pip install --upgrade local-operator` line a pip-classified venv would get
	 * would rewrite `site-packages` under the daemon serving this app, and the
	 * command that owns the GLOBAL install moves an install that is already
	 * current. An offer that told the reader to run either would be actionable and
	 * wrong, which is worse than the silence it replaces.
	 */
	assert.equal(offer.payload.canManageUpdate, false);
	assert.equal(offer.payload.updateCommand, "");
	assert.match(offer.payload.remedy, /managed environment/);
	assert.doesNotMatch(offer.payload.remedy, /pip install|lop update/);
	// The install it judged, named for the panel's Details line.
	assert.match(offer.payload.detail, /managed-python/);
	assert.match(offer.payload.detail, /0\.56\.8/);

	/*
	 * AND AN INSTALL THE APP DOES NOT OWN KEEPS THE COMMAND THAT OWNS IT. The
	 * exemption above is about WHERE the root is, not about the backend's
	 * self-report: an ordinary virtualenv elsewhere is still the reader's to
	 * update in their own terminal, and `resolveGlobalInstallPlan` names the pip
	 * line for it exactly as before. A check that answered "the app owns this"
	 * from the install's `pip` kind alone would refuse a remedy that works.
	 */
	const external = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.56.8",
		publishedVersion: "0.56.11",
		installVersion: "0.56.11",
		servingInstall: { version: "0.56.8", appOwned: false, kind: "pip" },
	});
	const externalOffer = external.sent.find(
		({ channel }) => channel === "backend-update-available",
	);
	assert.ok(
		externalOffer,
		JSON.stringify(external.sent.map(({ channel }) => channel)),
	);
	assert.equal(externalOffer.payload.currentVersion, "0.56.8");
	assert.equal(
		externalOffer.payload.updateCommand,
		"pip install --upgrade local-operator",
	);
	assert.match(
		externalOffer.payload.remedy,
		/pip install, so update it from your terminal/,
	);
	assert.doesNotMatch(externalOffer.payload.detail, /managed-python/);

	/*
	 * The mirror, and the reason this had to be the SERVING install rather than
	 * "whichever install is oldest": the shim's install is a release BEHIND while
	 * the server serving this app is at the published one. Nothing is behind on the
	 * machine the user is using, so there is nothing to offer - a check that judged
	 * the install on PATH would offer an update for an install nothing is running.
	 */
	const serving = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.56.11",
		publishedVersion: "0.56.11",
		installVersion: "0.56.8",
		servingInstall: { version: "0.56.11", appOwned: true, kind: "pip" },
	});
	assert.equal(serving.verdict.server, "current");
	/*
	 * The literal rather than `UP_TO_DATE_AFFIRMATION`: this case never loads the
	 * rule module, and the sentence is the thing on screen - a value import here
	 * would make the assertion a comparison of the module with itself.
	 */
	assert.equal(
		serving.verdict.affirmation,
		"The application and server are up to date",
	);
	assert.ok(
		!serving.sent.some(({ channel }) => channel === "backend-update-available"),
		JSON.stringify(serving.sent.map(({ channel }) => channel)),
	);

	/*
	 * AND THE OTHER SHAPE OF THE APP'S OWN TREE. `managed-python` is a PARENT the
	 * generations live under, but the pre-split `local-operator-venv` an older build
	 * left on disk IS a venv root - and it exists on the operator's own machine
	 * (`~/Library/Application Support/Local Operator/local-operator-venv`, holding a
	 * 0.54.x install), so a daemon can be serving from it today. The containment
	 * test required the prefix to be a STRICT descendant, which no root is, so this
	 * shape was answered "a package manager owns this" and the panel offered
	 * `pip install --upgrade local-operator` for a tree the app owns - the exact
	 * instruction this arm was added to remove (review round 1, R1).
	 */
	const legacyVenv = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.56.8",
		publishedVersion: "0.56.11",
		installVersion: "0.56.11",
		servingInstall: {
			version: "0.56.8",
			appOwned: true,
			appOwnedRoot: "legacy-venv",
			kind: "pip",
		},
	});
	assert.equal(legacyVenv.verdict.server, "available");
	const legacyOffer = legacyVenv.sent.find(
		({ channel }) => channel === "backend-update-available",
	);
	assert.ok(
		legacyOffer,
		JSON.stringify(legacyVenv.sent.map(({ channel }) => channel)),
	);
	assert.equal(legacyOffer.payload.currentVersion, "0.56.8");
	assert.equal(legacyOffer.payload.canManageUpdate, false);
	assert.equal(legacyOffer.payload.updateCommand, "");
	assert.match(legacyOffer.payload.detail, /local-operator-venv/);
});

/**
 * WHICH INSTALL THE COMPARISON IS ABOUT, in the two cases where neither reading
 * can be taken at face value.
 *
 * The same defect shape as the case above - the check judging something other
 * than the install serving the user - reached by two other roads: an install whose
 * dist-info number is stale by construction, and a server too old to name its
 * install at all. Both answered `available` for a machine whose server was at the
 * published release, so both offered an update for an install nobody was using
 * (review round 1, R2 and R3).
 */
test("the comparison's subject is the serving install, not a stale number or the shim", async () => {
	/*
	 * R2 - an EDITABLE serving install. Its `direct_url.json` says the environment
	 * follows a checkout, so the dist-info name (0.55.8) is a number pip wrote once
	 * and never refreshed, while `/health` carries the real one (0.56.11) - which is
	 * the reading the backend itself trusts: `installed_version()` prefers the
	 * checkout's own `pyproject.toml` for exactly this reason. Taking the dist-info
	 * as the subject answers `install-behind`, rendering both numbers in one
	 * sentence ("the install on this machine is at 0.55.8, and the server you are
	 * using is running 0.56.11 until it restarts") for a server that is current.
	 */
	const editable = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.56.11",
		publishedVersion: "0.56.11",
		installVersion: "0.56.11",
		servingInstall: {
			version: "0.55.8",
			appOwned: false,
			kind: "editable",
			editable: true,
		},
	});
	assert.equal(editable.verdict.server, "current");
	assert.equal(
		editable.verdict.affirmation,
		"The application and server are up to date",
	);
	assert.ok(
		!editable.sent.some(
			({ channel }) => channel === "backend-update-available",
		),
		JSON.stringify(editable.sent.map(({ channel }) => channel)),
	);

	/*
	 * R3 - a server that names NO install, which is what a backend older than
	 * v0.54.38 answers (that release added `prefix` to `/health`). The plan still
	 * resolves the shim, because it is the best available source for a REMEDY, and
	 * the comparison used to take that shim's version as its subject too: an offer
	 * about an install nothing is serving, while the pane's own Server version row
	 * printed the daemon the check had just read.
	 */
	const noPrefix = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.56.11",
		publishedVersion: "0.56.11",
		installVersion: "0.55.8",
	});
	assert.equal(noPrefix.verdict.server, "current");
	assert.equal(
		noPrefix.verdict.affirmation,
		"The application and server are up to date",
	);
	assert.ok(
		!noPrefix.sent.some(
			({ channel }) => channel === "backend-update-available",
		),
		JSON.stringify(noPrefix.sent.map(({ channel }) => channel)),
	);
});

/**
 * The ownership guard itself, over every shape it claims to cover - and over the
 * verdict that decides the remedy, not just the list it is taken from. Its own case
 * rather than another branch of the check above, because the guard is
 * the thing that was wrong and two of its three shapes are not reachable by
 * planting a tree on a darwin host: `managedVenvPath` answers under `userData` on
 * Windows and under `~/.config` on Linux, so the only way to assert those shapes
 * is to ask the roots function for that platform - which is why it takes a
 * `platform` and is exported at all. A case that planted a darwin tree would have
 * covered one shape out of three and passed while the other two stayed broken,
 * which is precisely how this shipped (review round 1, R1).
 *
 * BOTH FLAVOURS, and the verdict rather than the list (review round 2, R6): the
 * app's environment is named by `packaged`, so a list carrying only the asking
 * instance's name covered the sibling by accident on darwin - where both names sit
 * under `managed-python`, which shape 1 already contains - and not at all on win32
 * and linux, where the venv root is the platform's own and nothing else names it.
 * A daemon serving from the app's OTHER environment was therefore judged external
 * there, and the arm that resolves for an external install is the pip one: exactly
 * the instruction the guard exists to remove, offered for the app's own tree. The
 * verdict is asserted through `appOwnsInstallRoot`, the function the check itself
 * calls, because "which arm resolves" is the finding and the root list is only
 * how it was reached.
 */
test("the app's own install roots cover every shape, and a root is inside itself", async () => {
	/*
	 * The paths come first and the import after them: the service module builds its
	 * logger at import time, which reads `app.getPath("userData")`, so a case that
	 * imported first would fail on the fixture's own path table rather than on the
	 * guard.
	 */
	const home = mkdtempSync(join(tmpdir(), "lo-owned-roots-home-"));
	const appData = mkdtempSync(join(tmpdir(), "lo-owned-roots-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData: appData,
		appData,
		temp: tmpdir(),
	};
	const { service } = await loadUpdateServiceModule();
	const {
		appOwnedInstallRoots,
		appOwnsInstallRoot,
		isWithinAnyRoot,
		managedVenvPath,
	} = service;
	const support = join(
		home,
		"Library",
		"Application Support",
		"Local Operator",
	);
	for (const platform of ["darwin", "win32", "linux"]) {
		/*
		 * Every platform under BOTH flavours, because that pair is what R6 turned on:
		 * `managedVenvPath` answers one name per call, chosen by `packaged`, and the
		 * app's OTHER environment is the one the server actually reports on the
		 * machines where a dev instance adopts the installed app's daemon.
		 */
		for (const packaged of [true, false]) {
			const input = { platform, home, appDataPath: appData, packaged };
			const roots = appOwnedInstallRoots(input);
			/*
			 * Five entries, four shapes: the post-split parent, the two pre-split venv
			 * names, and the app's own environment under each flavour name. Asserted as a
			 * count so a root list that quietly lost one cannot pass by covering the
			 * others.
			 */
			assert.equal(
				roots.length,
				5,
				`${platform}/${packaged}: ${JSON.stringify(roots)}`,
			);
			for (const root of roots) {
				assert.ok(
					isWithinAnyRoot(roots, root),
					`${platform}/${packaged}: the root ITSELF is not read as inside: ${root}`,
				);
				assert.ok(
					isWithinAnyRoot(
						roots,
						join(root, "lib", "python3.12", "site-packages"),
					),
					`${platform}/${packaged}: a tree under ${root} is not read as inside`,
				);
			}
			/*
			 * Named this way round rather than by index, so a reordered list still has to
			 * contain each shape: the two pre-split names, a generation under the
			 * post-split parent, and the app's own environment on the platform whose answer
			 * is NOT under the parent - both flavours of it.
			 */
			for (const owned of [
				join(support, "managed-python"),
				join(support, "managed-python", "packaged", "environments", "x-y"),
				join(support, "local-operator-venv"),
				join(support, "local-operator-venv-dev"),
				managedVenvPath(input),
				managedVenvPath({ ...input, packaged: !packaged }),
			]) {
				assert.ok(
					isWithinAnyRoot(roots, owned),
					`${platform}/${packaged}: ${owned} is the app's own and is not read as inside`,
				);
			}
			/*
			 * The CONSEQUENCE, asked of the function the check itself calls. Ownership
			 * is what decides the remedy, so the app's own environment under EITHER
			 * flavour name has to answer owned - that is the arm where no package
			 * manager's command is offered for the app's tree (R6) - while a tree the app
			 * does not own, and a shared-prefix neighbour of the name beside it, answer
			 * false. The neighbour is the case a substring test would have matched: the
			 * same stem with one more component.
			 */
			for (const flavour of [true, false]) {
				const sibling = managedVenvPath({ ...input, packaged: flavour });
				assert.equal(
					appOwnsInstallRoot(input, sibling),
					true,
					`${platform}/${packaged}: the app's own environment (packaged=${flavour}) at ${sibling} must read as owned, or the check offers a package manager for the app's tree`,
				);
			}
			for (const external of [
				join(home, "synthetic-external-install"),
				/*
				 * The shared-prefix neighbour only discriminates where the venv root is the
				 * platform's OWN directory - `%APPDATA%\local-operator-venv-dev` on Windows,
				 * `~/.config/local-operator/...` on Linux - because the same stem with one
				 * more component is then a directory BESIDE it. On darwin the name lives
				 * under `managed-python`, which the app owns wholesale, so a name that
				 * merely starts with one of its children is genuinely inside.
				 */
				...(platform === "darwin" ? [] : [`${managedVenvPath(input)}-other`]),
			]) {
				assert.equal(
					appOwnsInstallRoot(input, external),
					false,
					`${platform}/${packaged}: ${external} is not the app's own and is read as inside`,
				);
			}
		}
	}

	const darwinRoots = appOwnedInstallRoots({
		platform: "darwin",
		home,
		appDataPath: appData,
		packaged: true,
	});
	/*
	 * And what is outside stays outside - including the shared-prefix neighbour the
	 * containment rule's own comment is about, which a substring test would have
	 * matched, and a tree that shares no root with any of them, where `path.relative`
	 * echoes its input back.
	 */ for (const outside of [
		join(home, "synthetic-external-install"),
		`${join(support, "managed-python")}-other`,
		join(support, "elsewhere"),
		"/tmp/not-the-apps-tree",
	]) {
		assert.equal(
			isWithinAnyRoot(darwinRoots, outside),
			false,
			`${outside} is not the app's own and is read as inside`,
		);
	}
});

/**
 * The four states of the server channel, decided by the rule that owns them.
 *
 * Driven through the pure module with no fixture, because these are the rule's own
 * cases: the whole defect was a check that reached the wrong CONCLUSION from the
 * right readings, and the rule is now the only place a conclusion is drawn.
 */
test("the server channel's rule names its four states from the readings", async () => {
	const { rule, dir } = await loadVerdictRule();
	try {
		/*
		 * The service's comparator, narrowed to what these readings need: the
		 * triple-by-triple ordering `isNewerVersion` performs, without its pre-release
		 * tail - which none of these versions carries. Written here rather than
		 * imported because the rule's own contract is the INJECTED comparison: it
		 * decides, and the app keeps one ordering for that decision.
		 */
		const isNewer = (candidate, subject) => {
			const parts = (value) => value.split(".").map(Number);
			const left = parts(candidate);
			const right = parts(subject);
			for (let i = 0; i < 3; i++) {
				const a = left[i] ?? 0;
				const b = right[i] ?? 0;
				if (a !== b) return a > b;
			}
			return false;
		};

		const behind = rule.serverChannelVerdict({
			installVersion: "0.56.8",
			runningVersion: "0.56.8",
			publishedVersion: "0.56.11",
			isNewer,
		});
		assert.deepEqual(behind, { status: "available", state: "install-behind" });

		/*
		 * The install is current and the process serving it is not: nothing to
		 * install, nothing to offer, and NOTHING TO AFFIRM either. The status was
		 * `current` in this state, which is what let "The application and server are up
		 * to date" be rendered beside a notice saying the server was on an older build.
		 */
		const stale = rule.serverChannelVerdict({
			installVersion: "0.56.11",
			runningVersion: "0.56.8",
			publishedVersion: "0.56.11",
			isNewer,
		});
		assert.deepEqual(stale, {
			status: "restart-required",
			state: "restart-required",
		});
		assert.equal(
			rule.updateCheckVerdict({ app: "current", server: stale.status })
				.affirmation,
			null,
		);

		const current = rule.serverChannelVerdict({
			installVersion: "0.56.11",
			runningVersion: "0.56.11",
			publishedVersion: "0.56.11",
			isNewer,
		});
		assert.deepEqual(current, { status: "current", state: "current" });

		/*
		 * An unreachable server is `unreadable`, and never `current`: the defect this
		 * rule's own module was written for is a surface treating "we could not find
		 * out" as an answer.
		 */
		for (const readings of [
			{
				installVersion: null,
				runningVersion: null,
				publishedVersion: "0.56.11",
			},
			{
				installVersion: "0.56.8",
				runningVersion: "Unknown",
				publishedVersion: "0.56.11",
			},
			{
				installVersion: "0.56.8",
				runningVersion: "0.56.8",
				publishedVersion: null,
			},
			{
				installVersion: "0.56.8",
				runningVersion: "0.56.8",
				publishedVersion: "999.invalid",
			},
		]) {
			assert.deepEqual(
				rule.serverChannelVerdict({ ...readings, isNewer }),
				{ status: "unavailable", state: "unreadable" },
				JSON.stringify(readings),
			);
		}

		/*
		 * And the fallback the subject picks: when the install's own metadata could not
		 * be read, the running process's reading stands in for it - the same install,
		 * since the process executes the code in the prefix it named. It is NOT a
		 * licence to affirm: a running build that trails the release is still behind.
		 */
		assert.deepEqual(
			rule.serverChannelVerdict({
				installVersion: null,
				runningVersion: "0.56.8",
				publishedVersion: "0.56.11",
				isNewer,
			}),
			{ status: "available", state: "install-behind" },
		);
		assert.deepEqual(
			rule.serverChannelVerdict({
				installVersion: null,
				runningVersion: "0.56.11",
				publishedVersion: "0.56.11",
				isNewer,
			}),
			{ status: "current", state: "current" },
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * The other half of Q2: the fix must not reclassify anything this product
 * actually publishes. These are the comparisons the update path has always
 * made, kept as themselves so a future tightening of the grammar names the
 * release form it broke.
 */
/**
 * A GLOBAL_INSTALL update attempt, driven end to end through `updateBackend`.
 *
 * WHAT IT STUBS, and why at these seams: the installer itself (a real
 * `lop update` would install a release over the operator's runtime, which no test
 * may do), the install's own version read (scripted before/after, the way the disk
 * changes under a real run) and the daemon's `/health` reading. Everything between
 * them - the landing rule, the ordering, the restart decision and the events the
 * renderer sees - is the shipped code.
 *
 * The plan is stubbed as well, and deliberately: what a given tree classifies as is
 * `resolveGlobalInstallPlan`'s own contract, covered over synthetic installs in
 * `update-global-install.test.mjs`. This fixture is about what the service DOES
 * with a managed plan, which is the half that had no case at all - and which is
 * why R1-1 (an install already at the target reported as a failed update) was a
 * green suite.
 *
 * `runGate` lets a case hold the installer open, which is how the in-flight guard
 * and the mid-attempt marker are driven.
 */
/*
 * A synthetic install as `readInstallIdentity` sees one: a console script under `bin`,
 * a `pyvenv.cfg` so the prefix is recognised as a venv, and a dist-info whose DIRECTORY
 * NAME carries the version - the same thing `importlib.metadata` reads on the Python
 * side, which is why no interpreter is involved.
 */
const makeInstall = (root, version) => {
	mkdirSync(join(root, "bin"), { recursive: true });
	writeFileSync(
		join(root, "bin", "local-operator"),
		`#!/bin/sh\nexec ${join(root, "bin", "python")} -m local_operator \"$@\"\n`,
		{ mode: 0o755 },
	);
	writeFileSync(join(root, "pyvenv.cfg"), "home = /usr/bin\n");
	const site = join(root, "lib", "python3.13", "site-packages");
	mkdirSync(site, { recursive: true });
	const distInfo = join(site, `local_operator-${version}.dist-info`);
	mkdirSync(distInfo, { recursive: true });
	writeFileSync(
		join(distInfo, "METADATA"),
		`Name: local-operator\nVersion: ${version}\n`,
	);
	return distInfo;
};
const moveInstall = (root, from, to) => {
	const site = join(root, "lib", "python3.13", "site-packages");
	renameSync(
		join(site, `local_operator-${from}.dist-info`),
		join(site, `local_operator-${to}.dist-info`),
	);
};

const driveGlobalUpdate = async ({
	before = "0.55.10",
	after = "0.56.0",
	exitCode = 0,
	ran = true,
	target = "0.56.0",
	external = false,
	daemonReports = null,
	/*
	 * The serving install's root, when the case needs `/health` to name a DIFFERENT
	 * install than the shim. `null` is every other case in this file: the server does
	 * not name its root, so the plan's own subject stands (review round 5, Q-1).
	 */
	servingPrefix = null,
	/*
	 * The shim the app resolved, when the case needs it to be a real file on disk
	 * rather than the fixture's synthetic path: a case that drives the SHIPPED evidence
	 * reads has to point them at a tree that exists (review round 6, M1).
	 */
	shimPath = "/synthetic/bin/local-operator",
	/*
	 * Leave `readGlobalInstallVersion` as the shipped one, so the verdict is computed from
	 * real files under real prefixes instead of from the scripted readings. This is the
	 * difference that makes the round-6 defect visible at all: the stub answers whatever the
	 * case says, so a press that verified the wrong install could not be caught.
	 */
	realEvidenceReads = false,
	restartOk = true,
	runGate = null,
	/*
	 * The post-restart version poll is stubbed by default: the shipped one waits up
	 * to 60 s, which no case should pay. `stubWait: false` runs the shipped poll
	 * against the scripted `/health` reading, which is what the R2-1 case needs - the
	 * comparison inside it is the thing under test.
	 */
	stubWait = true,
	/*
	 * THE FLEET THE GATE SEES. `workState` is the app's existing busy reading
	 * (`servingWorkState`), and a LIST is consumed one entry per read, which is how
	 * "busy, then idle" - the drain that had to wait - is driven. `fleet` is the
	 * roster itself, read for the refusal's names and for the before/after pair the
	 * re-engage compares.
	 */
	workState = "idle",
	fleet = [],
	drainBudgetMs = 5,
	drainPollMs = 1,
	/*
	 * The plan's own route reading, which the offer and the restart decision now
	 * both consult: `"entry-point"` is the harness's GENERATION layout - the one
	 * where the install lands beside every running process - and null is the
	 * fixture's default subject, an install whose updater the app runs in place.
	 */
	managedRoute = null,
} = {}) => {
	const home = mkdtempSync(join(tmpdir(), "lo-global-update-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-global-update-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	const { service, serviceDir } = await loadUpdateServiceModule();
	// The marker the attempt leaves: `markerDir()` is `app.getPath("userData")`,
	// which this fixture pins to its own temp directory.
	const markerPath = join(userData, "pending-server-update.json");
	const sent = [];
	const calls = {
		installers: [],
		/** The budget each reach for an installer was given, in the order taken. */
		budgets: [],
		restarts: 0,
		starts: 0,
	};
	const backend = {
		getStartupMode: () => service.LocalOperatorStartupMode.GLOBAL_INSTALL,
		getBackendUrl: () => "http://127.0.0.1:9",
		isUsingExternalBackend: () => external,
		setAutoUpdating: () => {},
		restart: async () => {
			calls.restarts += 1;
			return restartOk;
		},
		start: async () => {
			calls.starts += 1;
			return true;
		},
		/*
		 * The serving-install surface (`backend-version-drift.ts`), answered the way this
		 * fixture's world contains it: this adapter stands in for a manager attached to a
		 * daemon whose `/health` it scripts, and it plants no serve RECORD - so the boot
		 * reading is the absence a record-less daemon gives, and no case here changes
		 * behaviour because of it. A case about the skew names a `bootVersion` where the
		 * fixture builds one (`loAggregateCheck`, and the cases below it); `restarts`
		 * above is the same call recorder those cases read.
		 */
		servingInstall: () => ({
			readings: {
				bootVersion: null,
				prefix: "",
				installKind: "",
				startedByApp: false,
			},
			managedByThisApp: false,
			owned: { owned: !external, because: "this fixture's own answer" },
		}),
		servingWorkState: async () =>
			Array.isArray(workState) ? (workState.shift() ?? "idle") : workState,
		/*
		 * The roster, in the WIRE's own field names, converted by the shipped parse -
		 * the same read and the same shape the gate sees in the app.
		 */
		servingSessionFleet: async () =>
			service.fleetRosterFromSessions({ result: { sessions: fleet } }),
		hasOpenSessionStreams: () => false,
		checkIsAutoUpdating: () => false,
	};
	const updateService = new service.UpdateService(
		{
			isDestroyed: () => false,
			webContents: {
				send: (channel, payload) => sent.push({ channel, payload }),
				isDestroyed: () => false,
			},
		},
		backend,
	);
	const interval = updateService.updateCheckInterval;
	const dispose = () => {
		if (interval) clearInterval(interval);
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	};
	try {
		// Keep the health probe off anything real, as every case in this file does.
		updateService.backendUrl = "http://127.0.0.1:9";
		/*
		 * The drain's own bounds, on the arm whose press reaches the gate before it
		 * installs and again before it restarts.
		 */
		updateService.fleetDrainBudgetMs = drainBudgetMs;
		updateService.fleetDrainPollMs = drainPollMs;
		updateService.resolveBackendUpdatePlan = async () => ({
			canManageUpdate: true,
			updateCommand: "lop update",
			remedy:
				"The app updates this install and then restarts the server it started.",
			detail: "synthetic plan",
			sourceBuild: false,
			managedRoute,
			installedInstallVersion: before,
		});
		updateService.resolveLocalOperatorPath = () => shimPath;
		// The pre-run read and the post-run read, in the order the attempt takes
		// them; anything after those repeats the last one.
		const readings = [before, after];
		if (!realEvidenceReads) {
			/*
			 * The scripted reading, for the cases that are about what the service does with a
			 * version rather than about which install it came from: it ignores the install the
			 * caller names, deliberately - the read is now a REQUIRED argument (`installPath`),
			 * and the cases that need the shipped read use `realEvidenceReads` instead.
			 */
			updateService.readInstallVersionAt = () =>
				readings.length > 1 ? readings.shift() : after;
		}
		/*
		 * The command the attempt reaches for, recorded by its PATH rather than by the
		 * whole descriptor: the service hands `runGlobalUpdate` a `{ path, args }`
		 * pair, because a managed update is not always the entry point (`<console
		 * path> update`) any more - the source-build route runs `lop-update`, which
		 * takes no `update` argument. What this harness is asserting is unchanged:
		 * which install's own tool was reached for.
		 */
		updateService.runGlobalUpdate = async (command, budgetMs) => {
			calls.installers.push(command.path);
			calls.budgets.push(budgetMs);
			if (runGate) await runGate({ markerPath });
			return {
				exitCode,
				stdout: "",
				stderr:
					exitCode === 0
						? ""
						: "error: Failed to install: the index is unreachable\n\n  Caused by: network unreachable",
				ran,
				command: command.path,
			};
		};
		/*
		 * THE CHECK'S OWN READ, which is `readRunningBackend` since the check began
		 * judging the install that serves the app: `/health` carries the version and
		 * the install root in ONE answer, so the seam is the whole reading rather
		 * than its version. `prefix: null` is the server that does not name its
		 * install - the plan's own subject then stands, which this fixture stubs
		 * above - and every case here declares that shape.
		 *
		 * `getInstalledBackendVersion` still exists and delegates to this, so the
		 * cases that stub IT for the paths that ask only for a version are unchanged.
		 */
		updateService.readRunningBackend = async () => ({
			version: daemonReports,
			prefix: servingPrefix,
			installKind: null,
		});
		if (stubWait) {
			updateService.waitForBackendVersion = async () => daemonReports;
		}
		updateService.checkBackendHealth = async () => true;
		return { updateService, sent, calls, dispose, userData, markerPath };
	} catch (error) {
		dispose();
		throw error;
	}
};

const backendCompletion = (sent) =>
	sent.find(({ channel }) => channel === "backend-update-completed");
const backendErrors = (sent) =>
	sent.filter(({ channel }) => channel === "backend-update-error");
const backendPhases = (sent) =>
	sent
		.filter(({ channel }) => channel === "backend-update-progress")
		.map(({ payload }) => payload.phase);

test("the offer carries the reading that decides the sentence it renders", async () => {
	/*
	 * UX U9's own cause, at the producer: the managed arm's consequence sentence
	 * comes from the PLAN, which classifies the INSTALL and cannot know who started
	 * the daemon. Without the ownership reading here the panel promised a restart
	 * that cannot happen on a machine where discovery adopted a server - so the
	 * reading travels on this event, as it already did on the other two.
	 */
	const owned = await driveGlobalUpdate({ daemonReports: "0.55.10" });
	try {
		owned.updateService.getLatestPypiVersion = async () => "0.56.2";
		await owned.updateService.checkForBackendUpdates(true);
		const offer = owned.sent.find(
			({ channel }) => channel === "backend-update-available",
		);
		assert.ok(offer, JSON.stringify(owned.sent.map((c) => c.channel)));
		assert.equal(offer.payload.restartable, true);
		/*
		 * `restartable` true and `appOwnedEnvironment` false is the pair this
		 * fixture's own mode produces, and it is the whole of design D5: the app
		 * supervises a daemon whose INSTALL is a uv tool or pipx one, so the panel may
		 * describe what happens to the daemon but must not offer the press that only
		 * the app-owned arm performs as a restart.
		 */
		assert.equal(offer.payload.appOwnedEnvironment, false);
	} finally {
		owned.dispose();
	}

	const adopted = await driveGlobalUpdate({
		daemonReports: "0.55.10",
		external: true,
	});
	try {
		adopted.updateService.getLatestPypiVersion = async () => "0.56.2";
		await adopted.updateService.checkForBackendUpdates(true);
		const offer = adopted.sent.find(
			({ channel }) => channel === "backend-update-available",
		);
		assert.ok(offer, JSON.stringify(adopted.sent.map((c) => c.channel)));
		assert.equal(offer.payload.restartable, false);
	} finally {
		adopted.dispose();
	}
});

test("a silent check speaks when the two readings disagree, and not when they agree", async () => {
	/*
	 * UX U10: the launch check is silent, and silence swallowed the one event that
	 * carries the skew - so the state right after a landed install (install current,
	 * the daemon serving the app a build behind) was invisible until the user
	 * happened to press Check for updates, and no later check re-offers it because
	 * the install itself is up to date.
	 */
	const lurking = await driveGlobalUpdate({
		before: "0.56.2",
		daemonReports: "0.56.0",
	});
	try {
		lurking.updateService.getLatestPypiVersion = async () => "0.56.2";
		await lurking.updateService.checkForBackendUpdates(true);
		const event = lurking.sent.find(
			({ channel }) => channel === "backend-update-not-available",
		);
		assert.ok(event, JSON.stringify(lurking.sent.map((c) => c.channel)));
		assert.equal(event.payload.version, "0.56.2");
		assert.equal(event.payload.runningVersion, "0.56.0");
		assert.equal(event.payload.restartable, true);
	} finally {
		lurking.dispose();
	}

	// And a launch on a machine where the readings agree still says nothing: the
	// exception is the disagreement, not the silent caller.
	const agreeing = await driveGlobalUpdate({
		before: "0.56.2",
		daemonReports: "0.56.2",
	});
	try {
		agreeing.updateService.getLatestPypiVersion = async () => "0.56.2";
		await agreeing.updateService.checkForBackendUpdates(true);
		assert.equal(
			agreeing.sent.some(
				({ channel }) => channel === "backend-update-not-available",
			),
			false,
			JSON.stringify(agreeing.sent.map((c) => c.channel)),
		);
	} finally {
		agreeing.dispose();
	}
});

test("an update that lands installs first and restarts the app's own daemon after", async () => {
	const run = await driveGlobalUpdate({ daemonReports: "0.56.0" });
	try {
		const result = await run.updateService.updateBackend("0.56.0");
		assert.equal(result, true);
		// The install's OWN front end, from the resolution the plan classified.
		assert.deepEqual(run.calls.installers, ["/synthetic/bin/local-operator"]);
		// The ordering the design rests on: nothing is restarted before the install
		// lands, so a failed install never costs the daemon a restart.
		assert.deepEqual(backendPhases(run.sent), ["installing", "restarting"]);
		assert.equal(run.calls.restarts, 1);
		assert.deepEqual(backendErrors(run.sent), []);
		const completed = backendCompletion(run.sent);
		assert.ok(completed, JSON.stringify(run.sent.map((c) => c.channel)));
		assert.deepEqual(completed.payload, {
			installVersion: "0.56.0",
			runningVersion: "0.56.0",
			restarted: true,
		});
	} finally {
		run.dispose();
	}
});

test("an install already at the target is a success, not a failed update", async () => {
	/*
	 * The R1-1 state, reached from the panel's own button: the install is ahead of
	 * the daemon, so an update is offered - and `lop update` then prints "already
	 * latest" and exits 0 without moving anything. The landing rule demanded a
	 * CHANGE, so the app reported a machine that was already correct as "did not
	 * take effect", and "Try again" reproduced it.
	 */
	const run = await driveGlobalUpdate({
		before: "0.56.0",
		after: "0.56.0",
		daemonReports: "0.56.0",
	});
	try {
		const result = await run.updateService.updateBackend("0.56.0");
		assert.equal(result, true);
		assert.deepEqual(backendErrors(run.sent), []);
		assert.equal(run.calls.restarts, 1, "the daemon still has to move onto it");
		assert.equal(backendCompletion(run.sent)?.payload.restarted, true);
	} finally {
		run.dispose();
	}
});

test("an installer that exits 0 having moved nothing is not a landed update, and nothing restarts", async () => {
	const run = await driveGlobalUpdate({ before: "0.55.10", after: "0.55.10" });
	try {
		const result = await run.updateService.updateBackend("0.56.0");
		assert.equal(result, false);
		const errors = backendErrors(run.sent);
		assert.equal(errors.length, 1, JSON.stringify(run.sent));
		assert.equal(errors[0].payload.phase, "update");
		assert.match(errors[0].payload.message, /did not take effect/);
		// The proof nothing moved is that nothing is restarted: the daemon that was
		// serving still is, on the build it loaded.
		assert.equal(run.calls.restarts, 0);
		assert.equal(backendCompletion(run.sent), undefined);
		assert.deepEqual(backendPhases(run.sent), ["installing"]);
	} finally {
		run.dispose();
	}
});

test("a daemon that comes back past the target is a landing, not a timeout", async () => {
	/*
	 * The second half of R2-1, found by the app run that exercised the first: the
	 * landing rule learned to accept an install at-or-past the target, and the
	 * post-restart poll still demanded the EXACT string - so the same scenario (the
	 * offer names 0.56.0, `lop update` installs the 0.56.2 PyPI has now) went from
	 * "the update did not take effect" to "the server restarted but did not report
	 * version 0.56.0", sixty seconds later, over a machine that was correct.
	 */
	const run = await driveGlobalUpdate({
		daemonReports: "0.56.2",
		stubWait: false,
	});
	try {
		assert.equal(
			await run.updateService.waitForBackendVersion("0.56.0", 4000, 200),
			"0.56.2",
		);
		// A daemon that comes back BEHIND the target is still not the new build: the
		// same poll with a reading that never reaches it gives up.
		run.updateService.getInstalledBackendVersion = async () => "0.55.10";
		assert.equal(
			await run.updateService.waitForBackendVersion("0.56.0", 1200, 200),
			null,
		);
	} finally {
		run.dispose();
	}
});

test("a daemon the app did not start is reported with both readings and never restarted", async () => {
	/*
	 * R1-3, QA Q-2 and UX U1 in one case. The install moves; the daemon serving the
	 * conversation does not, and the app deliberately does not bounce a process it
	 * did not start. The completion used to be a NULL payload, so the renderer said
	 * "completed successfully" over a server still on the old build - and because
	 * the install is now latest, no later check ever offered the update again.
	 */
	const run = await driveGlobalUpdate({
		external: true,
		daemonReports: "0.55.10",
	});
	try {
		const result = await run.updateService.updateBackend("0.56.0");
		assert.equal(result, true);
		assert.equal(run.calls.restarts, 0, "not the app's process to bounce");
		assert.deepEqual(backendPhases(run.sent), ["installing"]);
		const completed = backendCompletion(run.sent);
		assert.ok(completed, JSON.stringify(run.sent.map((c) => c.channel)));
		assert.equal(completed.payload.installVersion, "0.56.0");
		assert.equal(completed.payload.runningVersion, "0.55.10");
		assert.equal(completed.payload.restarted, false);
		assert.equal(completed.payload.restartable, false);
	} finally {
		run.dispose();
	}
});

test("two update attempts cannot run beside each other, and the second says so", async () => {
	/*
	 * Review R1-8: the offer holds `checking` and the run panel holds
	 * `updatingBackend`, so a press on each reached this path twice and the second
	 * `lop update` ran beside the first against one install root.
	 */
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const run = await driveGlobalUpdate({
		daemonReports: "0.56.0",
		runGate: () => gate,
	});
	try {
		const first = run.updateService.updateBackend("0.56.0");
		// Let the first attempt reach the installer before the second arrives.
		await new Promise((resolve) => setTimeout(resolve, 20));
		const second = run.updateService.updateBackend("0.56.0");
		/*
		 * The gate is released BEFORE the second call is awaited, so an attempt that
		 * is NOT refused runs its installer and finishes rather than deadlocking on
		 * this test's own gate: the case then fails on the guard's own assertions
		 * instead of hanging the suite, which is the shape a missing guard should
		 * produce.
		 */
		await new Promise((resolve) => setTimeout(resolve, 20));
		release();
		assert.equal(await second, false);
		const refused = backendErrors(run.sent).find(({ payload }) =>
			/already running/.test(payload.message),
		);
		assert.ok(
			refused,
			JSON.stringify(
				run.sent.map(({ channel, payload }) => [channel, payload.message]),
			),
		);
		assert.equal(
			run.calls.installers.length,
			1,
			"the installer must be started once, not twice",
		);
		assert.equal(await first, true);
		assert.equal(run.calls.installers.length, 1);
	} finally {
		release();
		run.dispose();
	}
});

test("the attempt's marker exists only while nobody has seen its end", async () => {
	/*
	 * UX U6, both halves: the marker is what a later launch reads, so it has to be
	 * on disk DURING the install (the app can be killed while the installer's child
	 * keeps running) and gone the moment the attempt reaches its own verdict (the
	 * panel carries that outcome, and a later launch must not report it twice).
	 */
	let during = null;
	const run = await driveGlobalUpdate({
		daemonReports: "0.56.0",
		runGate: ({ markerPath }) => {
			during = existsSync(markerPath);
			return Promise.resolve();
		},
	});
	try {
		assert.equal(await run.updateService.updateBackend("0.56.0"), true);
		assert.equal(during, true, "the marker must be written before the spawn");
		assert.equal(
			existsSync(run.markerPath),
			false,
			"and cleared once this process has the verdict",
		);
	} finally {
		run.dispose();
	}
});

test("an attempt that landed while no app was watching is reported once, on the next check", async () => {
	const run = await driveGlobalUpdate({ daemonReports: "0.56.0" });
	try {
		const markerPath = join(run.userData, "pending-server-update.json");
		writeFileSync(
			markerPath,
			`${JSON.stringify({
				before: "0.55.10",
				target: "0.56.0",
				startedAt: new Date().toISOString(),
				installPath: run.updateService.resolveLocalOperatorPath(),
			})}\n`,
			"utf8",
		);
		/*
		 * The world the abandoned installer left behind: the install moved to the
		 * version it installed, the daemon serving the app is still on the old build,
		 * and the published release is the one that landed - so the check has nothing
		 * to offer and only this report can say anything about what happened.
		 */
		run.updateService.readInstallVersionAt = () => "0.56.0";
		run.updateService.getInstalledBackendVersion = async () => "0.55.10";
		run.updateService.getLatestPypiVersion = async () => "0.56.0";
		await run.updateService.checkForBackendUpdates(false);

		const completed = backendCompletion(run.sent);
		assert.ok(completed, JSON.stringify(run.sent.map((c) => c.channel)));
		assert.equal(completed.payload.installVersion, "0.56.0");
		assert.equal(completed.payload.unattended, true);
		assert.equal(completed.payload.before, "0.55.10");
		/*
		 * AND THE SERVING DAEMON'S OWN READING (UX U14). It used to travel as null by
		 * construction, which left the renderer unable to tell this state from the
		 * ordinary one - the app coming back and starting its daemon from the landed
		 * install - so the panel announced a skew it could not see.
		 */
		assert.equal(completed.payload.runningVersion, "0.55.10");
		assert.equal(completed.payload.restartable, true);
		assert.equal(existsSync(markerPath), false);

		// And once means once: the next check has nothing left to report.
		run.sent.length = 0;
		await run.updateService.checkForBackendUpdates(false);
		assert.equal(backendCompletion(run.sent), undefined);
	} finally {
		run.dispose();
	}
});

test("the readable-version grammar keeps every comparison it always made", async () => {
	const { rule, dir } = await loadVerdictRule();
	try {
		const equal = await loAggregateCheck({
			appCheck: loAppCurrent,
			serverVersion: "0.54.44",
			publishedVersion: "0.54.44",
		});
		assert.equal(equal.verdict.server, "current");
		assert.equal(equal.verdict.affirmation, rule.UP_TO_DATE_AFFIRMATION);

		const newer = await loAggregateCheck({
			appCheck: loAppCurrent,
			serverVersion: "0.54.44",
			publishedVersion: "0.54.45",
		});
		assert.equal(newer.verdict.server, "available");
		assert.equal(newer.verdict.affirmation, null);

		// The four-part form (the backend has published `0.18.0.1`) and the
		// pre-release form (the registry carries `0.55.0-rc1`), both readable.
		const fourPart = await loAggregateCheck({
			appCheck: loAppCurrent,
			serverVersion: "0.54.44.1",
			publishedVersion: "0.54.44.2",
		});
		assert.equal(fourPart.verdict.server, "available");

		const preRelease = await loAggregateCheck({
			appCheck: loAppCurrent,
			serverVersion: "0.55.0-rc1",
			publishedVersion: "0.55.0",
		});
		assert.equal(preRelease.verdict.server, "available");

		/*
		 * The grammar itself, over the forms the product publishes.
		 *
		 * What this case asserts is the two pinned lists below and nothing more: a
		 * representative sample of ACCEPTED published forms plus the REJECTED ones,
		 * so a tightening of the rule fails on a nameable form rather than in
		 * production. It does NOT re-check the published corpus - the sentence "a case
		 * in the suite re-checks that set" in the PR thread was stronger than what was
		 * committed (review round 3, R10).
		 *
		 * The corpus sweep was the DERIVATION, made once when the rule was written:
		 * every version then published for `local-operator` on PyPI and
		 * `local-operator-ui` on npm was run through it, and review round 3 re-derived
		 * that result from both registries - 561 of 561 accepted (452 PyPI releases
		 * plus 109 npm versions). Re-running it needs the two registries, so it is not
		 * part of this suite; these pinned lists are the standing regression.
		 *
		 * The rejects are QA's own inputs plus the shapes a truncating reader can
		 * produce.
		 */
		const readable = [
			"0.54.44",
			"0.18",
			"0.18.0.1",
			"v0.22.3",
			"0.0.0-test",
			"0.1.0-beta.1",
			"0.18.0-rc1",
			"0.1.3b0",
			"1.0.0.post1",
			"0.55.0.dev3",
		];
		const unreadable = [
			"999.invalid",
			"invalid",
			"not-a-version",
			"Unknown",
			"",
			"v",
			"1.2.3.4.5",
			"0.54.43-",
			"1.2.x",
			"0.1.0;rm -rf /",
		];
		for (const version of readable)
			assert.equal(
				rule.isReadableVersion(version),
				true,
				`${version} is a published form`,
			);
		for (const version of unreadable)
			assert.equal(
				rule.isReadableVersion(version),
				false,
				`${version} must not be compared`,
			);
		assert.equal(rule.isReadableVersion(null), false, "no reading");
		assert.equal(rule.isReadableVersion(undefined), false, "no reading");
		assert.equal(
			rule.isReadableVersion("  0.54.43  "),
			true,
			"trimmed, the way isNewerVersion normalises",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** Both trailing: an offer on each side and no sentence. */
test("two offers leave the whole check with nothing to affirm", async () => {
	const { verdict } = await loAggregateCheck({
		appCheck: loAppTrails,
		serverVersion: "0.54.43",
		publishedVersion: "0.54.44",
	});

	assert.equal(verdict.app, "available");
	assert.equal(verdict.server, "available");
	assert.equal(verdict.affirmation, null);
});

/**
 * A channel that could not find out is not a channel that found nothing, and it
 * may not supply the half of the affirmation the other channel is missing. This
 * is the repository's documented defect class - a surface treating "we could
 * not find out" as an answer - in the one place it decided a sentence.
 */
test("a channel that could not find out does not let the other one affirm", async () => {
	// The app channel errors (a real throw from the updater, which is what a
	// failed feed fetch does) while the server is positively current.
	const errored = await loAggregateCheck({
		appCheck: () => {
			throw new Error("net::ERR_INTERNET_DISCONNECTED");
		},
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
	});
	assert.equal(errored.verdict.app, "unavailable");
	assert.equal(errored.verdict.server, "current");
	assert.equal(errored.verdict.affirmation, null);
	// The failure is still reported to the user: the status replaces nothing.
	assert.ok(
		errored.sent.some(({ channel }) => channel === "update-error"),
		JSON.stringify(errored.sent.map(({ channel }) => channel)),
	);

	// A health endpoint that answers but carries no version: "Unknown" is the
	// absence of a reading, not an older version (the same confusion produced
	// a pip command for a server whose version could not be read at all).
	const unreadable = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverAnswersVersion: false,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
	});
	assert.equal(unreadable.verdict.server, "unavailable");
	assert.equal(unreadable.verdict.app, "current");
	assert.equal(unreadable.verdict.affirmation, null);

	// Development mode never runs the check at all, so it has nothing to say.
	const dev = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		devMode: true,
	});
	assert.equal(dev.verdict.app, "unavailable");
	assert.equal(dev.verdict.server, "unavailable");
	assert.equal(dev.verdict.affirmation, null);
});

/**
 * The rule itself, over every pair: the affirmation is a function of the two
 * channel statuses and of nothing else. Pinned as a table because the cases
 * above can only ever visit four of the nine pairs, and the sentence's own
 * content matters - it has to speak for both halves, since a sentence that
 * names one channel is the defect.
 */
test("the affirmation is earned by both channels current and by nothing else", async () => {
	const { rule, dir } = await loadVerdictRule();
	try {
		const {
			updateCheckVerdict: verdictFor,
			updateCheckAffirmation: affirmationFor,
			UP_TO_DATE_AFFIRMATION: sentence,
		} = rule;

		const statuses = ["available", "current", "unavailable"];
		let earned = 0;
		for (const app of statuses) {
			for (const server of statuses) {
				const verdict = verdictFor({ app, server });
				assert.equal(verdict.app, app);
				assert.equal(verdict.server, server);
				const bothCurrent = app === "current" && server === "current";
				assert.equal(
					verdict.affirmation,
					bothCurrent ? sentence : null,
					`${app}/${server}`,
				);
				assert.equal(affirmationFor({ app, server }), verdict.affirmation);
				if (bothCurrent) earned++;
			}
		}

		// Exactly one of the nine pairs earns a sentence, and the sentence
		// speaks for both halves - one that named a single channel is the
		// defect, stated as copy.
		assert.equal(earned, 1);
		assert.match(sentence, /app/i);
		assert.match(sentence, /server/i);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// One failure, one message: the transient transport classifier and its retries
// ---------------------------------------------------------------------------

/**
 * Why this section exists. The operator's machine showed a red alert over the
 * chat screen reading, exactly, `net::ERR_INTERNET_DISCONNECTED`, while it had
 * had continuous internet and everything worked. Their own
 * `~/Library/Application Support/Local Operator/logs/update-service.log` holds
 * the failure - a five-minute scheduled check, `silent mode: true`, whose feed
 * fetch died inside Electron's `net` module:
 *
 *     [2026-09-16 09:03:12.362] [info]  Running scheduled update check (every 5 minutes)
 *     [2026-09-16 09:03:12.362] [info]  Checking for updates... (silent mode: true)
 *     [2026-09-16 09:03:12.370] [error] Error: Error: net::ERR_INTERNET_DISCONNECTED
 *     [2026-09-16 09:03:12.370] [error] Update error: Error: net::ERR_INTERNET_DISCONNECTED
 *     [2026-09-16 09:03:12.370] [info]  Checking if error should be filtered: net::ERR_INTERNET_DISCONNECTED
 *     [2026-09-16 09:03:12.371] [error] Error checking for updates: Error: Error: net::ERR_INTERNET_DISCONNECTED
 *
 * and 90 such failures over four days (CONNECTION_RESET 36, TIMED_OUT 24,
 * CONNECTION_REFUSED 14, NETWORK_CHANGED 8, INTERNET_DISCONNECTED 8, plus a
 * `getaddrinfo ENOTFOUND pypi.org` at the same instant), every one of them
 * followed by a check five minutes later that succeeded.
 *
 * The cases below are the ones whose absence produced that, and each is about a
 * property of the shipped code rather than about the string: a transient
 * failure is RETRIED instead of reported, a background check reports nothing, a
 * failure has ONE owner so it cannot be reported twice, a download that dies is
 * still reported, and neither `net::ERR_*` nor an errno form can be the
 * sentence a person reads.
 */

/**
 * The pure modules this section drives, bundled with no fixture and no stubs.
 *
 * Kept beside the service rather than reached through it, for the same reason
 * `loadVerdictRule` is: the classifier is shared BY both processes, and a case
 * that reached it through the main-process graph could not tell the two apart.
 * The caller removes the temp directory.
 */
const loadPureModule = async (entry, prefix) => {
	const built = await build({
		stdin: {
			contents: `export * from "./${entry}";`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const dir = mkdtempSync(join(tmpdir(), `lo-${prefix}-`));
	const file = join(dir, `${prefix}.mjs`);
	writeFileSync(file, built.outputFiles[0].text);
	return { module: await import(file), dir };
};

/**
 * A feed fetch that fails the way the operator's log did.
 *
 * The library emits `error` on the updater AND rejects with the same error
 * (`AppUpdater.doCheckForUpdates`, AppUpdater.js:264-273). A fixture that only
 * rejected would not exercise the second producer at all, and that producer is
 * the one the operator's alert came from - which is why `attempts` is recorded
 * here rather than by the caller: the count is what says whether a transient
 * failure was retried.
 */
const loFailingFeed = (message, attempts) => () => {
	attempts.push(Date.now());
	const error = new Error(message);
	globalThis.__loAutoUpdater?.emit("error", error);
	throw error;
};

/** The wrapper shape one real log line carries, as an `err.message`. */
const LO_WRAPPED_FEED_FAILURE =
	"Cannot parse releases feed: Error: Unable to find latest version on GitHub (https://github.com/damianvtran/local-operator-ui/releases/latest), please ensure a production release exists: Error: net::ERR_NETWORK_CHANGED";

test("the skip-list the retries are measured against is the shipped one", async () => {
	const home = mkdtempSync(join(tmpdir(), "lo-retry-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-retry-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	const { service, serviceDir } = await loadUpdateServiceModule();
	let interval = null;
	try {
		const updateService = new service.UpdateService(
			{
				isDestroyed: () => false,
				webContents: { send: () => {}, isDestroyed: () => false },
			},
			{ getStartupMode: () => service.LocalOperatorStartupMode.GLOBAL_INSTALL },
		);
		interval = updateService.updateCheckInterval;
		/*
		 * The bound as a VALUE, because every other case in this section narrows
		 * it to milliseconds: without this one, the shipped backoff could become
		 * anything - including nothing - and the rest would still pass.
		 */
		assert.deepEqual(
			updateService.appFeedRetryDelaysMs,
			[1000, 3000],
			"two retries, so three attempts at one feed fetch",
		);
	} finally {
		if (interval) clearInterval(interval);
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
});

test("the classifier knows the family the log holds, and refuses the rest", async () => {
	const { module: transport, dir } = await loadPureModule(
		"src/shared/transport-failure",
		"transport",
	);
	try {
		/*
		 * Every Chromium code the log holds, plus the neighbours a resolver or a
		 * proxy produces the same way. The `net::` spelling is what Electron's
		 * `net.request` reports; the bare form is what a string that travelled
		 * through a page carries.
		 */
		const transient = [
			"net::ERR_INTERNET_DISCONNECTED",
			"net::ERR_NETWORK_CHANGED",
			"net::ERR_TIMED_OUT",
			"net::ERR_CONNECTION_RESET",
			"net::ERR_CONNECTION_REFUSED",
			"net::ERR_CONNECTION_CLOSED",
			"net::ERR_CONNECTION_FAILED",
			"net::ERR_CONNECTION_TIMED_OUT",
			"net::ERR_NAME_NOT_RESOLVED",
			"net::ERR_ADDRESS_UNREACHABLE",
			"net::ERR_NETWORK_IO_SUSPENDED",
			"net::ERR_PROXY_CONNECTION_FAILED",
			"ERR_INTERNET_DISCONNECTED",
			"Error: net::ERR_NETWORK_CHANGED",
			"Error: Error: net::ERR_TIMED_OUT",
			LO_WRAPPED_FEED_FAILURE,
			new Error("net::ERR_INTERNET_DISCONNECTED"),
			"getaddrinfo ENOTFOUND pypi.org",
			"connect ETIMEDOUT 140.82.121.4:443",
			"read ECONNRESET",
			"EAI_AGAIN api.github.com",
			"EHOSTUNREACH 2606:50c0:8000::153",
			"ENETUNREACH",
		];
		for (const value of transient) {
			assert.equal(
				transport.isTransientTransportFailure(value),
				true,
				`${String(value)} is a transient transport failure`,
			);
		}

		/*
		 * The negatives are the half that keeps the retry honest: a server that
		 * answered, a refusal that is about the peer rather than the network, and
		 * a certificate verdict are all failures no amount of retrying fixes.
		 * `ERR_SSL_PROTOCOL_ERROR` and the `ERR_CERT_*` family are in the request
		 * for exactly this reason - a TLS verdict is not a network blip.
		 */
		const notTransient = [
			"HttpError: 404 Not Found (latest-mac.yml)",
			"Cannot find latest-mac.yml in the latest release artifacts",
			"net::ERR_SSL_PROTOCOL_ERROR",
			"net::ERR_CERT_AUTHORITY_INVALID",
			"net::ERR_CERT_DATE_INVALID",
			"net::ERR_BLOCKED_BY_CLIENT",
			"Error: Invalid API key",
			"SDK error: bad credentials",
			"Failed to fetch conversation messages",
			"",
			null,
			undefined,
		];
		for (const value of notTransient) {
			assert.equal(
				transport.isTransientTransportFailure(value),
				false,
				`${String(value)} must not be retried or reported as transient`,
			);
		}

		/*
		 * The code comes back in its canonical spelling, and the offsets are
		 * offsets into the STRIPPED message: a consumer that keeps an authored
		 * prefix and replaces only the machine fragment computes its slice from
		 * these two numbers.
		 */
		assert.equal(
			transport.transientTransportCode(LO_WRAPPED_FEED_FAILURE),
			"net::ERR_NETWORK_CHANGED",
		);
		const wrapped = transport.stripErrorPrefixes(LO_WRAPPED_FEED_FAILURE);
		const fragment = transport.transientTransportFragment(wrapped);
		assert.deepEqual(
			wrapped.slice(fragment.start, fragment.end),
			"net::ERR_NETWORK_CHANGED",
		);
		// The doubled prefix, gone at the source: the log's own shape.
		assert.equal(
			transport.stripErrorPrefixes("Error: Error: net::ERR_TIMED_OUT"),
			"net::ERR_TIMED_OUT",
		);
		assert.equal(
			transport.stripErrorPrefixes("Parse Error: unexpected token"),
			"Parse Error: unexpected token",
			"prose with the word in it is not a prefix",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/*
 * The literals the update-copy assertions read, hoisted to module scope.
 *
 * `lint/performance/useTopLevelRegex` is this file's own lint rule, and the reason is
 * measurable here: a regex literal inside a test body adds a warning whose JSON form
 * carries the surrounding code, and this file's report is large enough that the
 * scripts gate's own buffer is a real constraint - it tripped `ENOBUFS` on the run
 * that first added these.
 */
const OFFLINE_CODE_PREFIX = /^net::ERR_INTERNET_DISCONNECTED\b/;
const NO_REQUEST_MADE = /no request was made/;
const TRANSPORT_CODE = /net::ERR_/;
const DOWNLOAD_LABEL = /^Error downloading/;
const STAGE_SENTENCE_CASES = [
	[
		"Error downloading update: net::ERR_TIMED_OUT",
		/could not be downloaded/i,
		/start the download again/i,
	],
	[
		"Error starting the update: net::ERR_CONNECTION_RESET",
		/could not be installed/i,
		/start it again from the update panel/i,
	],
	[
		"Error quitting for the update: net::ERR_TIMED_OUT",
		/could not quit to finish the install/i,
		/quit the app yourself/i,
	],
];

test("an update failure says what happened, and keeps the machine's words subordinate", async () => {
	const { module: copy, dir } = await loadPureModule(
		"src/renderer/src/shared/utils/update-error-copy",
		"update-copy",
	);
	try {
		/*
		 * The operator's alert, as copy: the sentence is a person's and the code
		 * is the machine's, on its own line. Asserted from the SHIPPED module, so
		 * a reworded sentence cannot pass an assertion that repeats old words.
		 */
		const bare = copy.updateErrorCopy("net::ERR_INTERNET_DISCONNECTED");
		assert.match(bare.sentence, /update server/i);
		assert.match(bare.sentence, /connection/i);
		assert.equal(bare.sentence.includes("net::"), false, bare.sentence);
		assert.equal(bare.detail, "net::ERR_INTERNET_DISCONNECTED");

		/*
		 * A PREFIX THE APP DOES NOT WRITE IS NOT COPY, and the CHECK-stage spelling is the
		 * case that proves it: `Error checking for updates:` is a line main's LOGGER writes
		 * (`update-service.ts`), not a message it sends, so a payload carrying it is one no
		 * producer emits - and the sentence stands alone rather than welding a label that
		 * came from nowhere onto the front of a sentence (review round 4, and the same
		 * condition that emptied `APP_AUTHORED_LABELS`).
		 */
		for (const unseenLabel of [
			"Error checking for updates: net::ERR_TIMED_OUT",
			"Error installing update: net::ERR_TIMED_OUT",
		]) {
			const unwritten = copy.updateErrorCopy(unseenLabel);
			assert.match(
				unwritten.sentence,
				/^The app could not reach the update server/,
			);
			assert.equal(unwritten.sentence.includes("Error "), false);
			assert.equal(unwritten.detail, "net::ERR_TIMED_OUT");
		}
		/*
		 * AND A PREFIX THAT IS NOT THE APP'S IS NOT COPY (design round 2, D-14). The
		 * rule is the app's own label set rather than a length, because short library
		 * narration passed the length: these two shapes are electron-updater's, not
		 * this app's, and the sentence has to stand alone over their code.
		 */
		for (const narration of [
			"Cannot parse releases feed: net::ERR_NETWORK_CHANGED",
			"Request timed out after 30000ms: net::ERR_CONNECTION_RESET",
		]) {
			const shown = copy.updateErrorCopy(narration);
			assert.match(
				shown.sentence,
				/^The app could not reach the update server/,
				`${narration} must not weld its narration onto the sentence`,
			);
			assert.equal(shown.sentence.includes("Cannot parse"), false);
			assert.equal(shown.sentence.includes("Request timed out"), false);
			assert.match(shown.detail, TRANSPORT_CODE);
		}

		/*
		 * The wrapped shape, which is where the surviving prefix turned out to be
		 * the defect (design round 1, D1; UX U2). electron-updater builds 200
		 * characters of parse narration around the code - a URL and an instruction
		 * for the release owner among them - and keeping it welded a paragraph to
		 * the front of a sentence written for a person.
		 */
		const wrapped = copy.updateErrorCopy(
			`Error invoking remote method 'check-for-updates': ${LO_WRAPPED_FEED_FAILURE}`,
		);
		assert.equal(
			wrapped.sentence,
			"The app could not reach the update server. Check this machine's connection, then try again.",
			"the sentence stands alone: nothing the machine wrapped it in survives",
		);
		assert.equal(wrapped.sentence.includes("github.com"), false);
		assert.equal(wrapped.detail, "net::ERR_NETWORK_CHANGED");
		assert.equal(
			wrapped.action,
			"check",
			'and its "then try again" has an owner',
		);

		/*
		 * An errno form, the shape the server channel really carries. The machine
		 * line keeps the phrase the token came from: a bare `ENOTFOUND` has no
		 * subject, and `Failed to fetch` says what the sentence above already said
		 * (design round 1, D8).
		 */
		const errno = copy.updateErrorCopy("getaddrinfo ENOTFOUND pypi.org");
		assert.equal(errno.sentence.includes("ENOTFOUND"), false, errno.sentence);
		assert.equal(errno.detail, "getaddrinfo ENOTFOUND pypi.org");
		assert.equal(
			copy.updateErrorCopy("Failed to fetch").detail,
			null,
			"an engine phrase the sentence has already said leaves no machine line",
		);

		/*
		 * A failure the classifier does not know still says what happened and what
		 * to do (review U4): a feed that answers 404 is not a transport failure, and
		 * it used to be painted as the developer's own string with no next step.
		 */
		const answered = copy.updateErrorCopy(
			"HttpError: 404 Not Found (latest-mac.yml)",
		);
		assert.equal(
			answered.sentence.includes("HttpError"),
			false,
			answered.sentence,
		);
		/*
		 * AND IT PROMISES NOTHING A RETRY CANNOT DELIVER (design round 2, D12). The
		 * classifier excludes this family precisely because another attempt does not
		 * fix it, so the copy says what is true - the check did not finish and the app
		 * will ask again on its own schedule - and offers no retry control.
		 */
		assert.match(answered.sentence, /could not finish/i);
		assert.match(answered.sentence, /next check/i);
		assert.equal(answered.action, null, "no retry it cannot deliver");
		assert.equal(answered.detail, "HttpError: 404 Not Found (latest-mac.yml)");
		// A certificate the machine refuses is the same shape, not the connection.
		const certificate = copy.updateErrorCopy("net::ERR_CERT_DATE_INVALID");
		assert.match(certificate.sentence, /could not finish/i);
		assert.equal(certificate.action, null);
		assert.equal(certificate.detail, "net::ERR_CERT_DATE_INVALID");
		// A status line the server really answered with, and the reason phrase is what
		// makes it a status rather than a number.
		const gateway = copy.updateErrorCopy("Error: 502 Bad Gateway");
		assert.match(gateway.sentence, /could not finish/i);
		assert.equal(gateway.action, null);
		/*
		 * R2-3: the mark that makes text "machine" used to be any three-digit 4xx/5xx
		 * number, which demoted a real remedy to the generic line - this exact sentence
		 * is the one the reviewer measured, and `400 MB` is not a status code.
		 */
		const diskSpace = copy.updateErrorCopy(
			"Not enough free disk space to install the update. Free at least 400 MB and try again.",
		);
		assert.match(
			diskSpace.sentence,
			/^Not enough free disk space/,
			"an authored sentence mentioning a size stays the sentence",
		);
		assert.equal(diskSpace.detail, null);

		/*
		 * A message the app WROTE for a person is already the sentence - no
		 * invented cause, and no machine line under it - and it arrives without
		 * the nesting the wrapper brought.
		 */
		const other = copy.updateErrorCopy(
			"Error: The installed server version could not be determined, so no update was offered. Restart the app to try again.",
		);
		assert.match(other.sentence, /^The installed server version/);
		assert.equal(other.detail, null);
		/*
		 * A download failure is not answered by another check, so the copy offers no
		 * control for it - and it must not instruct the reader to use one either
		 * (design round 2, D9; UX U9): the stage's sentence names the surface that
		 * DOES own the retry, which is the panel behind this alert.
		 */
		const download = copy.updateErrorCopy(
			"Error downloading update: net::ERR_TIMED_OUT",
		);
		assert.equal(download.action, null);
		assert.match(download.sentence, /could not be downloaded/i);
		assert.match(download.sentence, /start the download again/i);
		assert.equal(
			download.sentence.includes("then try again"),
			false,
			"no action the box cannot offer",
		);
		// The same sentence for the download stage's non-transport shapes.
		assert.match(
			copy.updateErrorCopy("Error downloading update: ENOENT: no such file")
				.sentence,
			/could not be downloaded/i,
		);
		/*
		 * ONE SENTENCE PER STAGE (design round 3, D-17; review R3-1). All three labels
		 * are live producers, and one sentence for the family told a reader whose
		 * download had already landed that the download failed - sending them to a
		 * control that re-downloads an artifact they already have.
		 */
		for (const [label, sentence, next] of STAGE_SENTENCE_CASES) {
			const stageCopy = copy.updateErrorCopy(label);
			assert.match(stageCopy.sentence, sentence, label);
			assert.match(
				stageCopy.sentence,
				next,
				`${label} names its own next step`,
			);
			assert.equal(stageCopy.action, null, `${label} offers no check control`);
			assert.match(
				stageCopy.detail,
				TRANSPORT_CODE,
				`${label} keeps the code subordinate`,
			);
			assert.equal(
				stageCopy.sentence.includes("could not be downloaded"),
				DOWNLOAD_LABEL.test(label),
				`${label} must not blame the download`,
			);
		}

		/*
		 * ONE verdict per message, on either channel: the release-artifact wording
		 * that is a known non-failure, and everything else. The `by-hand` route on
		 * the substring "manually" is gone (review R4): main's only producer of that
		 * wording was replaced by the structured `backend-update-manual-required`
		 * event, so the route could not match anything and read as a live rule.
		 */
		assert.equal(
			copy.updateMessageFate("Please update manually with pip"),
			"show",
		);
		assert.equal(
			copy.updateMessageFate(
				"Error: Cannot find latest-mac.yml in the latest release artifacts",
			),
			"muted",
		);
		assert.equal(
			copy.updateMessageFate("net::ERR_INTERNET_DISCONNECTED"),
			"show",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the invoke envelope is unwrapped rather than shown, once per nesting", async () => {
	const { module: ipc, dir } = await loadPureModule(
		"src/renderer/src/shared/utils/ipc-error-message",
		"ipc-message",
	);
	try {
		// The measured shape: Electron wraps the rejection, and the message inside
		// it already carries the error's own name prefix.
		assert.equal(
			ipc.unwrapIpcErrorMessage(
				new Error(
					"Error invoking remote method 'check-for-updates': Error: net::ERR_TIMED_OUT",
				),
			),
			"Error: net::ERR_TIMED_OUT",
		);
		// Nested, which happens when a handler's own work goes through another
		// invoke: unwrapped until there is nothing left to unwrap.
		assert.equal(
			ipc.unwrapIpcErrorMessage(
				"Error invoking remote method 'check-for-all-updates': Error invoking remote method 'check-for-updates': Error: net::ERR_TIMED_OUT",
			),
			"Error: net::ERR_TIMED_OUT",
		);
		// A thrown string, which is not an Error but is still a rejection.
		assert.equal(
			ipc.unwrapIpcErrorMessage(
				"Error invoking remote method 'update-backend': backend refused",
			),
			"backend refused",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a negative internet reading is not evidence until a second one agrees", async () => {
	const { module: offline, dir } = await loadPureModule(
		"src/renderer/src/shared/utils/offline-confirmation",
		"offline",
	);
	try {
		const grace = offline.OFFLINE_CONFIRMATION_GRACE_MS;
		// One reading - the Wi-Fi roam, the wake, the resolver switch - reports
		// nothing. This is the frame the operator saw: a banner over a machine
		// that was online.
		const first = offline.observeConnectivityReading(
			offline.noOfflineConfirmation(),
			{ isOnline: false, at: 1_000 },
		);
		assert.equal(first.report, false);
		// The same answer after the grace is what it is allowed to act on.
		const second = offline.observeConnectivityReading(first.state, {
			isOnline: false,
			at: 1_000 + grace,
		});
		assert.equal(second.report, true);
		// Still inside the grace, still nothing.
		assert.equal(
			offline.observeConnectivityReading(first.state, {
				isOnline: false,
				at: 1_000 + grace - 1,
			}).report,
			false,
		);
		// A positive reading clears immediately, from any state.
		assert.deepEqual(
			offline.observeConnectivityReading(second.state, {
				isOnline: true,
				at: 1_000 + grace + 1,
			}),
			{ state: offline.noOfflineConfirmation(), report: false },
		);
		/*
		 * The wait is measured from the FIRST negative reading, not from the most
		 * recent one: a poll that re-runs the effect must shorten the wait rather
		 * than push it away, or a genuinely offline machine would never be
		 * reported at all.
		 */
		assert.equal(
			offline.msUntilOfflineReportable(first.state, 1_000 + grace - 500),
			500,
		);
		assert.equal(
			offline.msUntilOfflineReportable(first.state, 1_000 + grace + 900),
			0,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * The operator's alert itself: a five-minute silent check whose feed fetch hit
 * a transport failure. It must produce NOTHING on the renderer - no
 * `update-error`, and nothing else a person could read - while still leaving
 * the check's conclusion honest.
 */
test("a transient failure on a background check tells the renderer nothing", async () => {
	const attempts = [];
	const { verdict, sent } = await loAggregateCheck({
		appCheck: loFailingFeed("net::ERR_INTERNET_DISCONNECTED", attempts),
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		silentAppCheck: true,
	});

	assert.equal(
		attempts.length,
		3,
		"three attempts: the fetch and its two retries",
	);
	assert.deepEqual(
		sent.map(({ channel }) => channel),
		[],
		"a silent check reports nothing at all, on any channel",
	);
	/*
	 * `checkForUpdates` answers with the CHANNEL status, and an unfetched feed is
	 * `unavailable` - never `current`. That distinction is the reason this change
	 * is a retry rather than an extra entry in the error filter, whose branch
	 * would have turned "could not find out" into "nothing newer".
	 */
	assert.equal(verdict, "unavailable");
});

/**
 * The retry that succeeds, which is what every one of the log's 90 failures was
 * followed by: a check five minutes later that answered normally. Nothing is
 * shown, and the check still concludes what it found.
 */
test("a transient failure that succeeds on retry tells the renderer nothing", async () => {
	const attempts = [];
	const { verdict, sent } = await loAggregateCheck({
		appCheck: () => {
			attempts.push(1);
			if (attempts.length === 1) {
				const error = new Error("net::ERR_NETWORK_CHANGED");
				globalThis.__loAutoUpdater?.emit("error", error);
				throw error;
			}
			return loAppCurrent();
		},
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
	});

	assert.equal(
		attempts.length,
		2,
		"the first attempt and the retry that worked",
	);
	assert.equal(verdict.app, "current", JSON.stringify(verdict));
	/*
	 * The trace a retried failure must leave is NONE of the failure: no
	 * `update-error`, and no offer either. `update-not-available` is legitimate
	 * here and is the positive half of the claim - the retry really did read the
	 * feed, which said nothing newer.
	 */
	assert.deepEqual(
		sent.filter(
			({ channel }) =>
				channel === "update-error" || channel === "update-available",
		),
		[],
		"a retried failure leaves no trace for the user",
	);
	assert.ok(
		sent.some(({ channel }) => channel === "update-not-available"),
		"the retry read the feed, which is what makes the first attempt's failure silent",
	);
});

/**
 * Retries exhausted on a check the user asked for: EXACTLY one message, and the
 * message is not the raw transport string. Both halves matter - the operator's
 * log reported one failure twice, and what reached the screen was the code.
 */
test("retries exhausted report once, in the app's own words", async () => {
	const { module: copy, dir } = await loadPureModule(
		"src/renderer/src/shared/utils/update-error-copy",
		"update-copy-reader",
	);
	try {
		const attempts = [];
		const { sent } = await loAggregateCheck({
			appCheck: loFailingFeed(
				"Cannot parse releases feed: Error: net::ERR_NETWORK_CHANGED",
				attempts,
			),
			serverVersion: "0.54.44",
			publishedVersion: "0.54.44",
		});

		assert.equal(attempts.length, 3);
		const errors = sent.filter(({ channel }) => channel === "update-error");
		assert.equal(
			errors.length,
			1,
			`exactly one message, not one per channel: ${JSON.stringify(sent.map(({ channel }) => channel))}`,
		);
		assert.equal(
			errors[0].payload,
			"Cannot parse releases feed: net::ERR_NETWORK_CHANGED",
			"the machine's own words, with the nested Error: prefix gone at the source",
		);
		// What the person reads, from the shipped copy rather than from a copy of it.
		const shown = copy.updateErrorCopy(errors[0].payload);
		assert.equal(shown.sentence.includes("net::"), false, shown.sentence);
		assert.match(shown.sentence, /update server/i);
		assert.equal(shown.detail, "net::ERR_NETWORK_CHANGED");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * The actionable path, which must not be silenced by the fix: a failure during
 * a download or an install the user asked for is reported even while an
 * availability check is in flight. That is the condition the `error` handler's
 * own gate tests first, and the check spends its whole retry sequence
 * in-flight - so this is the case that would go quiet if the gate were written
 * the other way round.
 */
test("a failure the user asked for is still reported during a check", async () => {
	const attempts = [];
	const { sent } = await loAggregateCheck({
		appCheck: () => {
			attempts.push(1);
			const error = new Error("net::ERR_CONNECTION_RESET");
			/*
			 * The download that died, ONCE - modelled by the `error` event the
			 * updater raises for it, inside the window the check is in flight for.
			 * A real download failure happens once; a fixture that raised it per
			 * attempt would report once per attempt, which is a property of this
			 * fixture rather than of the app.
			 */
			if (attempts.length === 1) {
				globalThis.__loAutoUpdater.emit("error", error);
			}
			throw error;
		},
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		silentAppCheck: true,
		stage: "downloading",
	});

	assert.equal(
		attempts.length,
		3,
		"the check still retried its own transient failure",
	);
	const errors = sent.filter(({ channel }) => channel === "update-error");
	assert.equal(
		errors.length,
		1,
		JSON.stringify(sent.map(({ channel }) => channel)),
	);
	assert.equal(
		errors[0].payload,
		"net::ERR_CONNECTION_RESET",
		"the actionable failure is reported even while a check is in flight",
	);
});

/**
 * An `error` event with NO check in flight - a failure from the updater's own
 * internals - still reports, and it reports the machine's words stripped of the
 * nested `Error: ` prefix rather than as the log wrote them.
 */
test("an error outside any check is reported, cleaned of its prefixes", async () => {
	const { sent, probeResult } = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		probe: async (service) => {
			globalThis.__loAutoUpdater.emit(
				"error",
				new Error("Error: net::ERR_CONNECTION_RESET"),
			);
			return service.appChecksInFlight;
		},
	});

	assert.equal(probeResult, 0, "the probe runs with no check in flight");
	const errors = sent.filter(({ channel }) => channel === "update-error");
	assert.equal(
		errors.length,
		1,
		JSON.stringify(sent.map(({ channel }) => channel)),
	);
	assert.equal(
		errors[0].payload,
		"net::ERR_CONNECTION_RESET",
		"the doubled prefix is fixed at the source, not only at the paint",
	);
});

/**
 * The other half of the retry's contract: a failure the network cannot fix gets
 * ONE attempt. A 404 for the channel file is the server having answered, and a
 * backoff there would delay a verdict it cannot change.
 */
test("a failure that is not transient is not retried", async () => {
	const attempts = [];
	const { sent } = await loAggregateCheck({
		appCheck: () => {
			attempts.push(1);
			throw new Error("HttpError: 404 Not Found (latest-mac.yml)");
		},
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
	});

	assert.equal(attempts.length, 1, "no retry for a failure a retry cannot fix");
	assert.equal(
		sent.filter(({ channel }) => channel === "update-error").length,
		1,
		"and it is still reported",
	);
});

/**
 * The same silence on the OTHER half, which review round 1 (R-2) found: a
 * background check reports nothing even when the failure is one no retry can
 * fix. That is the operator's rule rather than an accident of the gate - "if
 * updates can't be checked then that should be an error that only pops up if
 * clicking the button to check for updates" - and this case exists because the
 * gate's own comment used to claim the opposite ("if the retries are exhausted
 * its own path says so once"), which is true for a click and false here.
 */
test("a background check reports nothing even when the failure is not transient", async () => {
	const attempts = [];
	const { verdict, sent } = await loAggregateCheck({
		appCheck: () => {
			attempts.push(1);
			// Not a transport failure at all: a credential the release feed
			// refuses. Nothing about this changes five minutes later.
			throw new Error("Error: Invalid API key");
		},
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		silentAppCheck: true,
	});

	assert.equal(
		attempts.length,
		1,
		"the retry rule is unchanged: nothing a retry cannot fix is retried",
	);
	assert.deepEqual(
		sent.map(({ channel }) => channel),
		[],
		"an app-initiated check reports nothing, transient or not",
	);
	assert.equal(verdict, "unavailable", "and it still may not claim anything");
});

/**
 * The root cause, at the surface it was found on: the tick that lands during a
 * dark wake, before Wi-Fi is back. `net.isOnline()` answers "this machine
 * believes it has no network", and the check spends NO request and reports
 * nothing - leaving the verdict where a check that did not run belongs.
 *
 * Why this is the fix rather than three more retries: the operator's log has the
 * wake reason (`smc.sysState.Wake(0x70070000) wifibt`) in the same second as
 * `net::ERR_INTERNET_DISCONNECTED`, with the machine's own resolver answering
 * `getaddrinfo ENOTFOUND pypi.org` at that instant - a request made then cannot
 * succeed, and retrying it twice more only spends three failures.
 */
test("a check the machine has no network for spends no request", async () => {
	const attempts = [];
	const { verdict, sent } = await loAggregateCheck({
		appCheck: loFailingFeed("net::ERR_INTERNET_DISCONNECTED", attempts),
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		netIsOnline: false,
		silentAppCheck: true,
	});

	assert.equal(
		attempts.length,
		0,
		"the gate answers before the fetch, so not even the first attempt happens",
	);
	assert.deepEqual(
		sent.map(({ channel }) => channel),
		[],
		"an app-initiated check that could not run says nothing, on either channel",
	);
	assert.equal(
		verdict,
		"unavailable",
		"a check that did not run never reports nothing-newer (or current)",
	);
});

/**
 * R2-1: the click is the ONE path the operator's rule exists for, and the gate was
 * silently resolving it - `net.isOnline()` false returned before the ladder, the
 * invoke resolved, and a resolved invoke is not a failure, so the renderer's catch
 * never ran and the button painted nothing at all. The gate is now an ATTEMPT in
 * the ladder, so a manual check fails with the code the machine's own stack gives
 * for this state and is answered by the copy that already exists.
 */
test("a check the user asked for still reports when the machine has no network", async () => {
	const { module: copy, dir } = await loadPureModule(
		"src/renderer/src/shared/utils/update-error-copy",
		"offline-copy-reader",
	);
	try {
		const attempts = [];
		const { sent, rejected } = await loAggregateCheck({
			appCheck: loFailingFeed("net::ERR_INTERNET_DISCONNECTED", attempts),
			serverVersion: "0.54.44",
			publishedVersion: "0.54.44",
			netIsOnline: false,
			// The app channel alone: what the failure alert's own retry invokes.
			ipc: { handler: "check-for-updates", options: { manual: true } },
		});

		assert.equal(attempts.length, 0, "still no request spent while offline");
		assert.ok(
			rejected instanceof Error,
			"the click is answered with a failure, not a resolved invoke - a resolved one is how it said nothing at all",
		);
		assert.match(
			rejected.message,
			OFFLINE_CODE_PREFIX,
			"the code the machine's own stack gives for this state",
		);
		/*
		 * AND THE MESSAGE SAYS THE REQUEST WAS NEVER MADE (review round 3, R3-3): a
		 * grep for the code would otherwise find a line that reads like a fetch which
		 * went out and came back refused.
		 */
		assert.match(rejected.message, NO_REQUEST_MADE);
		/*
		 * And the renderer has copy for it: the same sentence the alert paints for a
		 * real fetch that failed this way, with the code subordinate.
		 */
		const shown = copy.updateErrorCopy(rejected.message);
		assert.match(shown.sentence, /could not reach the update server/i);
		assert.match(shown.detail, OFFLINE_CODE_PREFIX);
		assert.equal(shown.action, "check", "and the retry it names has an owner");
		assert.deepEqual(
			sent.map(({ channel }) => channel),
			[],
			"one owner: the rejection IS the report, so no event doubles it",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * The cost QA measured on a down network (round 1, Q-2): the renderer's mount
 * check and this process's own launch check both run at start-up, and with the
 * retries applied per check that was six fetches in 6.6 s where the base made
 * two. The fetch is the same request for the same feed, so the second check
 * rides the first one's attempt sequence.
 */
test("two overlapping checks share one attempt sequence", async () => {
	let fetches = 0;
	const { probeResult } = await loAggregateCheck({
		appCheck: async () => {
			fetches += 1;
			// Long enough that the second check is genuinely concurrent.
			await new Promise((resolve) => setTimeout(resolve, 25));
			return null;
		},
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		silentAppCheck: true,
		probe: async (service) => {
			const before = fetches;
			await Promise.all([
				service.checkForUpdates(true),
				service.checkForUpdates(true),
			]);
			return fetches - before;
		},
	});

	assert.equal(
		probeResult,
		1,
		"two concurrent checks made ONE fetch between them, not one each",
	);
});

/**
 * The wake half of the root cause: a resume arms ONE check a moment later, so
 * the tick that lands before the network is back is not the only one this
 * machine gets. What is pinned here is the bound - a night of maintenance wakes
 * cannot accumulate timers, which is the difference between arming a check and
 * building a storm.
 */
test("a resume arms one check, and a second resume adds no timer", async () => {
	const { probeResult } = await loAggregateCheck({
		appCheck: loAppCurrent,
		serverVersion: "0.54.44",
		publishedVersion: "0.54.44",
		probe: async (service) => {
			const handlers = globalThis.__loPowerMonitorHandlers;
			assert.equal(
				typeof handlers?.resume,
				"function",
				"the service must listen for this machine resuming",
			);
			handlers.resume();
			const first = service.postWakeCheckTimer;
			handlers.resume();
			return {
				armed: Boolean(first),
				sameTimer: service.postWakeCheckTimer === first,
			};
		},
	});

	assert.equal(probeResult.armed, true, "a resume arms a check");
	assert.equal(
		probeResult.sameTimer,
		true,
		"a second resume leaves that one timer alone rather than arming another",
	);
});

// ---------------------------------------------------------------------------
// Channel-file resolution and differential (delta) updates
// ---------------------------------------------------------------------------

/**
 * Why this section exists: differential updates have never worked in a
 * published release, and nothing in the repository could have said so. The
 * channel file `latest-mac.yml` resolved, the download succeeded, and the user
 * silently received the whole 353 MB zip every time - because the `.blockmap`
 * electron-updater needs to compute a delta was built by electron-builder and
 * then dropped at upload (publish.yml's artifact path lists carried
 * `dist/*.dmg`, `dist/*.zip` and `dist/latest*.yml`, and no release has ever
 * had a `.blockmap` asset). `differentialDownloadInstaller` therefore threw on
 * the first block-map fetch and fell back to the full download in a `catch`
 * whose only trace is a log line.
 *
 * The two properties asserted here are the ones a user feels: which artifact
 * the updater selects for this architecture, and how many bytes reach them.
 *
 * What is real, and what is substituted - the bound on the claim:
 *
 * REAL: `MacUpdater` itself, `ElectronHttpExecutor`, `Provider.resolveFiles`,
 * its block-map URL construction, `GenericDifferentialDownloader`, the
 * `sha512` verification of the downloaded file, and the block maps - generated
 * by electron-builder's own `buildBlockMap`, the same call
 * `differentialUpdateInfoBuilder.createBlockmap` makes - served over real
 * loopback HTTP with real `Range` requests.
 *
 * SUBSTITUTED: `require("electron")`, because this process is not Electron. The
 * stub supplies `net` (mapped onto `node:http`, whose request/response API
 * electron's mirrors), `autoUpdater` (an EventEmitter) and `session`;
 * `ElectronAppAdapter` is replaced by an adapter that reports version 0.19.6
 * and points the cache at a temp directory. `src/main/update-service.ts` is not
 * in the loop: what is covered here is the library the app drives, not the
 * app's own wiring of it.
 *
 * The feed is a generic provider with `useMultipleRangeRequest: false`, which
 * is not a convenience: `GitHubProvider` pins exactly that (`// because GitHib
 * uses S3`) because release assets are served from S3, so the single-range path
 * exercised here is the one every user's update takes.
 */
const loUpdaterBundle = await build({
	stdin: {
		contents: `export { MacUpdater } from "electron-updater/out/MacUpdater.js";
			export { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	banner: {
		js: [
			'import { createRequire as __loUpdaterCreateRequire } from "node:module";',
			// From an absolute path rather than `import.meta.url`: this bundle is
			// imported through a `data:` URL, which `createRequire` refuses.
			'const __loUpdaterRequire = __loUpdaterCreateRequire(process.cwd() + "/package.json");',
			"const require = (id) => __loUpdaterRequire(id);",
			"const __dirname = process.cwd();",
			'const __filename = "";',
		].join(" "),
	},
	plugins: [
		{
			/**
			 * `MacUpdater.doDownloadUpdate` decides which artifact is "its own" from
			 * two host probes, not from the channel file: `uname -a` (looking for
			 * "ARM") and `sysctl sysctl.proc_translated`, with `process.arch` as a
			 * fallback. Both branches have to be reachable on the machine running
			 * this suite - CI is Linux, where neither probe reports a Mac - so the
			 * probes are substituted here rather than the selection logic being
			 * copied into the test. The real `node:child_process` is reached through
			 * the unprefixed specifier, which is deliberately not redirected.
			 */
			name: "lo-updater-process-probe",
			setup(builder) {
				builder.onResolve({ filter: /^(node:)?child_process$/ }, (args) => ({
					path: args.path,
					namespace: "probe",
				}));
				builder.onLoad({ filter: /.*/, namespace: "probe" }, () => ({
					loader: "js",
					contents: `
						import * as __loReal from "child_process";
						export const execFileSync = (command, args, options) => {
							const stubbed = globalThis.__loUpdaterProbe?.(command, args);
							if (stubbed != null) return stubbed;
							return __loReal.execFileSync(command, args, options);
						};
						export const exec = __loReal.exec;
						export const execSync = __loReal.execSync;
						export const execFile = __loReal.execFile;
						export const spawn = __loReal.spawn;
						export const spawnSync = __loReal.spawnSync;
						export const fork = __loReal.fork;
						export default { ...__loReal, execFileSync };
					`,
				}));
			},
		},
		{
			/**
			 * The Electron module contract this process cannot provide. `net` is
			 * the load-bearing one: `ElectronHttpExecutor` builds every request
			 * through it, so mapping it onto `node:http` is what keeps the byte
			 * counting in this section honest.
			 */
			name: "lo-updater-electron-fixture",
			setup(builder) {
				builder.onResolve({ filter: /^electron$/ }, (args) => ({
					path: args.path,
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `
						import { EventEmitter } from "node:events";
						import * as __loHttp from "node:http";
						export const app = {
							getVersion: () => "0.0.0",
							getName: () => "Local Operator",
							getPath: () => process.cwd(),
							getAppPath: () => process.cwd(),
							isPackaged: true,
							whenReady: async () => {},
							on: () => {}, once: () => {}, quit: () => {}, relaunch: () => {},
						};
						export const autoUpdater = Object.assign(new EventEmitter(), {
							setFeedURL: () => {}, checkForUpdates: () => {}, quitAndInstall: () => {},
							logger: null, autoDownload: false, autoInstallOnAppQuit: false,
						});
						export const session = { fromPartition: () => ({}) };
						export const dialog = { showErrorBox: () => {}, showMessageBox: async () => ({ response: 0 }) };
						export class BrowserWindow {
							constructor() { this.webContents = { send: () => {}, on: () => {} }; }
							on() { return this; }
							once() { return this; }
							loadURL() {}
							show() {}
							close() {}
							isDestroyed() { return false; }
							static getAllWindows() { return []; }
						}
						export const net = {
							request(options) {
								return __loHttp.request({
									protocol: options.protocol,
									hostname: options.hostname,
									port: options.port,
									path: options.path,
									method: options.method ?? "GET",
									headers: options.headers,
								});
							},
						};
					`,
				}));
			},
		},
	],
});

const { MacUpdater, ElectronHttpExecutor } = await import(
	`data:text/javascript;base64,${Buffer.from(
		loUpdaterBundle.outputFiles[0].text,
	).toString("base64")}`
);

const loUpdaterRequire = createRequire(import.meta.url);

/**
 * electron-builder's own block-map implementation, resolved through the package
 * that depends on it (neither `electron-builder` nor `app-builder-lib` is
 * hoisted to the root by pnpm).
 *
 * This section used to shell out to `app-builder-bin`'s `blockmap` subcommand,
 * which WAS the shipped path then: `app-builder-lib`'s
 * `differentialUpdateInfoBuilder.createBlockmap` spawned that binary. 26.16
 * replaced it with `buildBlockMap` in JS (Rabin fingerprinting, streaming), and
 * `app-builder-bin` is no longer a dependency at all -- a clean install has no
 * such binary. That is how this file came to fail with `MODULE_NOT_FOUND:
 * app-builder-bin` on CI while passing on a working tree that still had one from
 * an older install, so fixtures are now built by the function the builder itself
 * calls, which is the whole point of the section.
 *
 * The path is app-builder-lib's internals, so the shape is asserted rather than
 * trusted: a reorganization fails here with a name instead of quietly testing
 * nothing.
 */
function loBlockmapBuilder() {
	const electronBuilder = loUpdaterRequire.resolve(
		"electron-builder/package.json",
	);
	const appBuilderLib = createRequire(electronBuilder).resolve(
		"app-builder-lib/package.json",
	);
	const modulePath = join(
		dirname(appBuilderLib),
		"out",
		"targets",
		"blockmap",
		"blockmap.js",
	);
	const { buildBlockMap } = loUpdaterRequire(modulePath);
	assert.equal(
		typeof buildBlockMap,
		"function",
		`electron-builder's block-map implementation moved or changed shape: ${modulePath} does not export buildBlockMap`,
	);
	return buildBlockMap;
}

const LO_MB = 1024 * 1024;

/**
 * The fixture artifact's size: 4 MB less 12345 bytes. The odd number keeps the
 * fixture shaped like a real archive, whose length is never an exact multiple of
 * the 32 KiB block size; it was originally load-bearing for a second reason, and
 * that one no longer applies. `app-builder blockmap` (the binary this section
 * used to shell out to) appended a zero-length final block for an exact multiple,
 * which electron-updater's plan builder turned into a zero-length COPY that
 * `createReadStream({start, end})` rejects - an upstream edge case. Measured on
 * 26.16's JS implementation: a 4 MiB input yields blocks that sum to exactly
 * 4 MiB with no trailing zero-length block, so the hazard is gone with the
 * binary that produced it and the odd size is now only fixture realism.
 */
const LO_ARTIFACT_SIZE = 4 * LO_MB - 12345;

/** A deterministic blob, optionally with one small region altered. */
function loBlob(size, { patchAt = null, patchLength = 0, seed = 7 } = {}) {
	const buffer = Buffer.alloc(size);
	for (let index = 0; index < size; index++) {
		buffer[index] = (index * 31 + seed) & 0xff;
	}
	for (let index = 0; index < patchLength; index++) {
		buffer[patchAt + index] = (index * 17 + 3) & 0xff;
	}
	return buffer;
}

function loSha512(filePath) {
	return createHash("sha512").update(readFileSync(filePath)).digest("base64");
}

/**
 * The block map for one artifact, written by electron-builder's own
 * implementation -- `buildBlockMap(file, "gzip", ...)`, the same call
 * `differentialUpdateInfoBuilder.createBlockmap` makes for a file artifact.
 *
 * It returns the same `{ size, sha512 }` the release metadata records, so the
 * fixture's channel file describes the bytes that were actually block-mapped
 * rather than a hash this test computed for itself.
 */
async function loWriteBlockmap(file) {
	const info = await loBlockmapBuilder()(file, "gzip", `${file}.blockmap`);
	return { size: info.size, sha512: info.sha512 };
}

/**
 * One release's macOS assets, as a release carries them: a zip per
 * architecture, its `.blockmap`, and the `latest-mac.yml` the updater resolves
 * against (shape copied from the v0.19.5 release's own channel file).
 */
async function loMakeRelease(dir, { version, bytes, blockmaps = true }) {
	const web = join(dir, version);
	mkdirSync(web, { recursive: true });
	const entries = [];
	for (const arch of ["arm64", "x64"]) {
		const name = `local-operator-ui-${version}-${arch}.zip`;
		const file = join(web, name);
		writeFileSync(file, bytes(arch));
		const info = await loWriteBlockmap(file);
		if (!blockmaps) rmSync(`${file}.blockmap`, { force: true });
		entries.push({ url: name, sha512: info.sha512, size: info.size });
	}
	writeFileSync(
		join(web, "latest-mac.yml"),
		[
			`version: ${version}`,
			"files:",
			...entries.flatMap((entry) => [
				`  - url: ${entry.url}`,
				`    sha512: ${entry.sha512}`,
				`    size: ${entry.size}`,
			]),
			`path: ${entries[0].url}`,
			`sha512: ${entries[0].sha512}`,
			`releaseDate: '2026-09-13T00:00:00.000Z'`,
			"",
		].join("\n"),
		"utf8",
	);
	return { web, entries };
}

/**
 * A static file server with single-range support, over real loopback HTTP.
 *
 * Every request is recorded and every byte counted, which is the only way to
 * tell a delta from a full download: both produce a correct file, and only the
 * transfer differs.
 */
function loServe(dir) {
	const requests = [];
	const bytes = new Map();
	const server = createServer((request, response) => {
		const name = basename(new URL(request.url, "http://local").pathname);
		const range = request.headers.range ?? null;
		requests.push({ name, range });
		const file = join(dir, name);
		if (!existsSync(file)) {
			response.writeHead(404);
			response.end();
			return;
		}
		const body = readFileSync(file);
		if (range == null) {
			response.writeHead(200, { "Content-Length": body.length });
			response.end(body);
			bytes.set(name, (bytes.get(name) ?? 0) + body.length);
			return;
		}
		const [start, end] = String(range)
			.replace(/^bytes=/, "")
			.split("-")
			.map((value) => Number.parseInt(value, 10));
		const last = Number.isNaN(end) ? body.length - 1 : end;
		const slice = body.subarray(start, last + 1);
		response.writeHead(206, {
			"Content-Length": slice.length,
			"Content-Range": `bytes ${start}-${last}/${body.length}`,
		});
		response.end(slice);
		bytes.set(name, (bytes.get(name) ?? 0) + slice.length);
	});
	return {
		server,
		requests,
		bytes,
		bytesFor: (name) => bytes.get(name) ?? 0,
		// `close()` alone waits for keep-alive sockets, and an updater's
		// connections would hold the test process open after its last assertion.
		close: () => {
			server.closeAllConnections();
			server.close();
		},
		listen: () =>
			new Promise((resolve) => {
				server.listen(0, "127.0.0.1", () => resolve(server.address().port));
			}),
	};
}

/**
 * The updater, wired the way the app wires it: a version to update from, the
 * on-disk update config that names the cache directory, and a real executor.
 */
function loMakeUpdater({ cacheRoot, version, feedUrl }) {
	const adapter = {
		get version() {
			return version;
		},
		get name() {
			return "Local Operator";
		},
		get isPackaged() {
			return true;
		},
		get appUpdateConfigPath() {
			return join(cacheRoot, "app-update.yml");
		},
		get userDataPath() {
			return cacheRoot;
		},
		get baseCachePath() {
			return cacheRoot;
		},
		whenReady: async () => {},
		quit: () => {},
		relaunch: () => {},
		onQuit: () => {},
	};
	// `null` options rather than `{}`: the constructor calls `setFeedURL` on any
	// non-null options object, and `{}` names no provider.
	const updater = new MacUpdater(null, adapter);
	updater.httpExecutor = new ElectronHttpExecutor(() => {});
	updater.autoDownload = false;
	// Resolves the download without handing a zip to Squirrel.Mac: there is no
	// native updater here, and the transfer is what this section measures.
	updater.autoInstallOnAppQuit = false;
	const lines = [];
	updater.logger = {
		info: (message) => lines.push(String(message)),
		warn: (message) => lines.push(String(message)),
		error: (message) => lines.push(String(message)),
		debug: () => {},
	};
	updater.setFeedURL({
		provider: "generic",
		url: feedUrl,
		// GitHubProvider pins this off for its S3-backed assets; the delta then
		// arrives as one `Range` per changed block instead of a multipart reply.
		useMultipleRangeRequest: false,
	});
	return { updater, lines };
}

/** The update config electron-builder ships beside the app. */
function loWriteUpdateConfig(cacheRoot, port) {
	mkdirSync(cacheRoot, { recursive: true });
	writeFileSync(
		join(cacheRoot, "app-update.yml"),
		[
			"provider: generic",
			`url: http://127.0.0.1:${port}/`,
			// The directory the app's own cache lives in, so the cached
			// `update.zip` a delta is computed against is placed where the real
			// updater looks for it.
			"updaterCacheDirName: local-operator-ui-updater",
			"",
		].join("\n"),
		"utf8",
	);
	return join(cacheRoot, "local-operator-ui-updater");
}

/**
 * A whole update scenario: the previous release's zip in the updater's cache,
 * both releases' assets on a local feed, and an updater pointed at it.
 */
async function loUpdateScenario({ blockmaps = true, patchLength = 4096 } = {}) {
	const dir = tempDir("lo-update-");
	// One seed per architecture, so that fetching the wrong architecture's build
	// cannot pass a hash check by accident: the two blobs are unrelated except
	// for their length.
	const seedFor = (arch) => (arch === "arm64" ? 1 : 2);
	const previous = (arch) => loBlob(LO_ARTIFACT_SIZE, { seed: seedFor(arch) });
	const current = (arch) =>
		loBlob(LO_ARTIFACT_SIZE, {
			seed: seedFor(arch),
			patchAt: 1 * LO_MB,
			patchLength,
		});
	const old = await loMakeRelease(dir, {
		version: "0.19.6",
		bytes: previous,
		blockmaps,
	});
	const next = await loMakeRelease(dir, {
		version: "0.19.7",
		bytes: current,
		blockmaps,
	});
	return { dir, old, next, previous, current };
}

/**
 * The host probes MacUpdater reads, spelled the way the real ones answer.
 *
 * The arm64 string is a real Apple Silicon `uname -a`, whose kernel release
 * string carries an uppercase "ARM" - that, not `process.arch`, is what makes
 * the library treat a machine as Apple Silicon.
 */
const LO_UNAME = {
	arm64:
		"Darwin fixture.local 25.6.0 Darwin Kernel Version 25.6.0: Thu Aug  7 22:06:29 PDT 2025; root:xnu-12377.1.9~1/RELEASE_ARM64_T6000 arm64",
	x64: "Darwin fixture.local 25.6.0 Darwin Kernel Version 25.6.0: Thu Aug  7 22:06:29 PDT 2025; root:xnu-12377.1.9~1/RELEASE_X86_64 x86_64",
};

/**
 * Run one update as the given architecture would experience it, with the probes
 * and `process.arch` restored afterwards whether it passed or threw.
 */
async function loAsArch(arch, run) {
	const originalArch = process.arch;
	const originalProbe = globalThis.__loUpdaterProbe;
	globalThis.__loUpdaterProbe = (command) => {
		if (command === "uname") return LO_UNAME[arch];
		if (command === "sysctl") return "sysctl.proc_translated: 0\n";
		return null;
	};
	Object.defineProperty(process, "arch", { value: arch, configurable: true });
	try {
		return await run();
	} finally {
		Object.defineProperty(process, "arch", {
			value: originalArch,
			configurable: true,
		});
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		if (originalProbe === undefined) delete globalThis.__loUpdaterProbe;
		else globalThis.__loUpdaterProbe = originalProbe;
	}
}

/**
 * A whole update run against the fixture feed.
 *
 * `blockmaps: false` removes every block map from the served release, which is
 * what a published release has looked like so far; `cachedOld` puts the
 * previous release's zip where the updater keeps the copy a delta is computed
 * against.
 */
async function loRunUpdate({
	arch,
	blockmaps = true,
	cachedOld = true,
	// `false` is the transition off the universal build: the release a user is
	// updating from published no block map at all.
	oldBlockmaps = true,
	// Overrides the cached diff base, for the universal-to-per-arch case where
	// the base is an artifact shape this release no longer produces.
	cacheBase = null,
	patchLength = 4096,
}) {
	const scenario = await loUpdateScenario({ blockmaps, patchLength });
	const state = loServe(scenario.next.web);
	if (cachedOld && oldBlockmaps) {
		// The previous release's block maps are theirs, not this release's: they
		// live on the older release, and the updater derives their URL from the
		// version it is running (`0.19.6`) rather than from the one it fetches.
		for (const name of readdirSync(scenario.old.web)) {
			if (!name.endsWith(".blockmap")) continue;
			writeFileSync(
				join(scenario.next.web, name),
				readFileSync(join(scenario.old.web, name)),
			);
		}
	}
	try {
		/*
		 * INSIDE the try, all of it: `listen()` starts the leak this catch exists
		 * for, and the writes below can throw (mkdirSync, writeFileSync, and the
		 * `scenario.previous(arch)` read behind them). Opening the try after them -
		 * which is what this looked like on the first pass - left the feed
		 * listening on any throw in between, which is the same hang by a narrower
		 * door.
		 */
		const port = await state.listen();
		const cacheRoot = join(scenario.dir, "cache");
		const updateCache = loWriteUpdateConfig(cacheRoot, port);
		if (cachedOld) {
			mkdirSync(updateCache, { recursive: true });
			writeFileSync(
				join(updateCache, "update.zip"),
				cacheBase ?? scenario.previous(arch),
			);
		}

		const result = await loAsArch(arch, async () => {
			const { updater, lines } = loMakeUpdater({
				cacheRoot,
				version: "0.19.6",
				feedUrl: `http://127.0.0.1:${port}/`,
			});
			try {
				await updater.checkForUpdates();
				const files = await updater.downloadUpdate();
				return { updater, lines, files };
			} finally {
				// Not cleanup for its own sake: `updateDownloaded` starts the proxy
				// server it would hand a zip to Squirrel.Mac with, and that listener
				// would otherwise hold this process open after the last assertion.
				//
				// IN A `finally`, because the failure path leaked it: a throw from
				// `checkForUpdates`/`downloadUpdate` used to skip this line, and the
				// proxy then held the file's process open for good.
				updater.closeServerIfExists();
			}
		});

		return {
			scenario,
			state,
			updateCache,
			...result,
			close: () => state.close(),
			downloadedPath: (name) => join(updateCache, "pending", name),
		};
	} catch (error) {
		/*
		 * THE FAILURE PATH MUST CLOSE THE FEED TOO, or one failing test hangs the
		 * whole suite instead of reporting.
		 *
		 * `close()` is handed to the CALLER, so a throw from inside this function
		 * means the caller never receives the object and its `finally` never runs -
		 * leaving the fixture feed listening on 127.0.0.1 for the life of this
		 * process. `node --test` waits for a file's process to exit, so the whole
		 * desktop suite then never returns at all: measured in CI, `Desktop Tests`
		 * silent for tens of minutes (43 in the first job I read, 185 in the
		 * longest) until the next push cancelled it, and reproduced in a Linux
		 * container where this file alone never exits and leaves five listeners
		 * behind.
		 *
		 * The defect is not that these tests can fail - they do, on a host whose
		 * channel file is not the one MacUpdater asks for - it is that failing
		 * HANGS the run, which is the one outcome a test must never have.
		 */
		try {
			state.close();
		} catch {
			// A close failure must not replace the error on its way out: the
			// assertion the reader needs is the original one, and a close that
			// throws has nothing to add to it.
		}
		throw error;
	}
}

/**
 * Skip a body that asserts MacUpdater behaviour when it is not running on macOS.
 *
 * The subject is MacUpdater: the feed these tests build is a mac release (per-arch
 * zips and `latest-mac.yml`), and off darwin the updater asks for that platform's
 * own channel file instead. They are red on Linux, and the mode depends on the
 * head rather than on the platform: job 103777903178 (run 34777397403, the last
 * `Desktop Tests` ever to complete) failed all six with `Cannot find module
 * 'app-builder-bin'` from the scenario builder it had then, before any feed
 * existed, while on this head - which builds its fixtures through `buildBlockMap`
 * - a `node:22` container fails them with `Cannot find channel
 * "latest-linux.yml"`, a 404 from the fixture. Six red tests on the only platform
 * this suite runs on is also what USED to leave `Desktop Tests` silent for tens of
 * minutes (43 in the first job I read, 185 in the longest) until the next push
 * cancelled it, because the failure path left the fixture feed listening
 * (`loRunUpdate`). That leak is fixed separately; this gate is what makes this
 * file honest about where it is evidence.
 *
 * Returns true when the caller must return immediately.
 */
function skipUnlessDarwin(t) {
	if (process.platform === "darwin") return false;
	t.skip("macOS only");
	return true;
}

test("the updater resolves the channel file, and both architectures are listed", async (t) => {
	if (skipUnlessDarwin(t)) return;

	const scenario = await loUpdateScenario();
	const state = loServe(scenario.next.web);
	try {
		const port = await state.listen();
		const cacheRoot = join(scenario.dir, "cache");
		loWriteUpdateConfig(cacheRoot, port);
		const { updater } = loMakeUpdater({
			cacheRoot,
			version: "0.19.6",
			feedUrl: `http://127.0.0.1:${port}/`,
		});
		const result = await updater.checkForUpdates();
		assert.equal(result.isUpdateAvailable, true);
		assert.equal(result.updateInfo.version, "0.19.7");
		// The file list is what MacUpdater filters by architecture, so a release
		// that ships one universal zip can only ever serve one of the two.
		assert.deepEqual(
			result.updateInfo.files.map((file) => file.url),
			scenario.next.entries.map((entry) => entry.url),
		);
		assert.ok(
			scenario.next.entries.some((entry) => entry.url.includes("-arm64.")) &&
				scenario.next.entries.some((entry) => entry.url.includes("-x64.")),
			"the channel file must describe both architectures",
		);
	} finally {
		state.close();
	}
});

for (const [arch, own, other] of [
	[
		"arm64",
		"local-operator-ui-0.19.7-arm64.zip",
		"local-operator-ui-0.19.7-x64.zip",
	],
	[
		"x64",
		"local-operator-ui-0.19.7-x64.zip",
		"local-operator-ui-0.19.7-arm64.zip",
	],
]) {
	test(`an ${arch} Mac downloads its own build, and only the changed blocks`, async (t) => {
		if (skipUnlessDarwin(t)) return;

		const run = await loRunUpdate({ arch });
		try {
			const entry = run.scenario.next.entries.find((it) => it.url === own);
			const downloaded = run.downloadedPath(own);
			assert.ok(existsSync(downloaded), `no download at ${downloaded}`);
			// The hash the channel file promises: the bytes the user ends up with
			// are the release's, not merely "something of the right size".
			assert.equal(loSha512(downloaded), entry.sha512);
			assert.equal(
				run.state.requests.some((request) => request.name === other),
				false,
				`the ${arch} updater fetched the other architecture's build`,
			);

			const transferred = run.state.bytesFor(own);
			assert.ok(
				run.lines.some((line) => line.includes("Download block maps")),
				`no block-map fetch was attempted: ${run.lines.join(" | ")}`,
			);
			assert.ok(
				transferred < entry.size * 0.2,
				`expected a delta, transferred ${transferred} of ${entry.size}`,
			);
			// A delta fetches ranges of the new archive; a fallback fetches all of
			// it, which is the distinction the transfer size alone cannot make.
			assert.ok(
				run.state.requests
					.filter((request) => request.name === own)
					.every((request) => request.range != null),
				"a delta must fetch ranges, not the whole file",
			);
			// The older release's block map, by URL, is what the delta is computed
			// against - the asset no release has ever carried.
			assert.ok(
				run.state.requests.some((request) =>
					request.name.startsWith("local-operator-ui-0.19.6-"),
				),
				`the previous release's block map was never fetched: ${run.state.requests.map((request) => request.name).join(", ")}`,
			);
			console.log(
				`${arch}: ${transferred} of ${entry.size} bytes transferred (${((transferred / entry.size) * 100).toFixed(2)}%)`,
			);
		} finally {
			run.close();
		}
	});
}

test("a build that changed across most of the file transfers most of it", async (t) => {
	if (skipUnlessDarwin(t)) return;

	// The honest counterpart to the delta above, and the reason the PR body does
	// not claim routine updates are small: the mechanism transfers the blocks
	// that changed, so a Chromium bump - which changes most of an archive - still
	// costs most of an archive. What it no longer costs is "all of it, always".
	const run = await loRunUpdate({
		arch: "arm64",
		patchLength: Math.round(LO_ARTIFACT_SIZE * 0.6),
	});
	try {
		const own = "local-operator-ui-0.19.7-arm64.zip";
		const entry = run.scenario.next.entries.find((it) => it.url === own);
		assert.equal(loSha512(run.downloadedPath(own)), entry.sha512);
		const transferred = run.state.bytesFor(own);
		assert.ok(
			transferred > entry.size * 0.4 && transferred < entry.size,
			`expected a large but partial transfer, got ${transferred} of ${entry.size}`,
		);
		console.log(
			`60% of the file changed: ${transferred} of ${entry.size} bytes transferred (${((transferred / entry.size) * 100).toFixed(2)}%)`,
		);
	} finally {
		run.close();
	}
});

test("the first update off a universal build falls back to a full download", async (t) => {
	if (skipUnlessDarwin(t)) return;

	// The state every existing macOS user is in for exactly one release: they run
	// a universal 0.19.6 whose zip sits in the cache as the diff base, and this
	// release ships per-arch zips. The old block-map URL the updater derives is
	// the *per-arch* name at the version it is running, which 0.19.6 never
	// published - so the fetch 404s and the update has to degrade safely rather
	// than diff a per-arch artifact against a universal base.
	const run = await loRunUpdate({
		arch: "arm64",
		oldBlockmaps: false,
		// Deliberately a different length from the release's own zip, so a diff
		// against the wrong base could not pass a size or hash check by accident.
		cacheBase: loBlob(LO_ARTIFACT_SIZE + 4096, { seed: 11 }),
	});
	try {
		const own = "local-operator-ui-0.19.7-arm64.zip";
		const entry = run.scenario.next.entries.find((it) => it.url === own);
		const oldBlockMap = "local-operator-ui-0.19.6-arm64.zip.blockmap";
		assert.ok(
			run.state.requests.some((request) => request.name === oldBlockMap),
			`the previous release's block map was not even attempted: ${run.state.requests.map((request) => request.name).join(", ")}`,
		);
		assert.ok(
			run.lines.some((line) => line.includes("Cannot download differentially")),
			`the fallback was not taken: ${run.lines.join(" | ")}`,
		);
		assert.equal(run.state.bytesFor(own), entry.size);
		// The property that makes the fallback the *safe* outcome: what lands is
		// this release's artifact, whole, verified against the channel file's
		// hash - not a per-arch zip with a universal diff base spliced into it.
		assert.equal(loSha512(run.downloadedPath(own)), entry.sha512);
	} finally {
		run.close();
	}
});

test("without the block maps a release offers, the updater transfers the whole file", async (t) => {
	if (skipUnlessDarwin(t)) return;

	// The world every release up to now lived in: electron-builder built a block
	// map for each archive and the publish job dropped it, so the first block-map
	// fetch 404s, the catch turns the update into the full download, and the only
	// trace is a log line. Asserted rather than described, so the difference
	// above is measured against the behaviour it replaces.
	const run = await loRunUpdate({ arch: "arm64", blockmaps: false });
	try {
		const own = "local-operator-ui-0.19.7-arm64.zip";
		const entry = run.scenario.next.entries.find((it) => it.url === own);
		const downloaded = run.downloadedPath(own);
		assert.equal(loSha512(downloaded), entry.sha512);
		assert.ok(
			run.lines.some((line) => line.includes("Cannot download differentially")),
			`the fallback was not taken: ${run.lines.join(" | ")}`,
		);
		assert.equal(run.state.bytesFor(own), entry.size);
		console.log(
			`no block maps: ${run.state.bytesFor(own)} of ${entry.size} bytes transferred (100.00%)`,
		);
	} finally {
		run.close();
	}
});

/**
 * A failure found on a re-check is delivered through the scheduler, and the
 * state it supersedes waits for that delivery.
 *
 * The re-check used to push the notice itself and stop there. A push is not a
 * delivery here: `sendToRenderer` answers true for any live `webContents`, so a
 * notice sent before the renderer's React effect subscribes still set
 * `installFailureDelivered` and nothing ever sent it again - while the branch had
 * already dropped the in-flight payload and cleared the marker, leaving a panel
 * that claims an install is still running for one that has failed (review R2).
 *
 * What this pins is that shape rather than the wording: the re-check itself
 * pushes nothing, the marker is still on disk while the notice is unsent, and
 * both the notice and the cleanup arrive when the scheduler's fallback fires.
 */
test("a re-check failure goes out through the delivery scheduler, not a bare push", async () => {
	const home = mkdtempSync(join(tmpdir(), "lo-service-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-service-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	const { service, serviceDir } = await loadUpdateServiceModule();
	const sent = [];
	let interval = null;
	try {
		const updateService = new service.UpdateService(
			{
				isDestroyed: () => false,
				webContents: {
					send: (channel, payload) => sent.push({ channel, payload }),
					isDestroyed: () => false,
					// A no-op window: the load event must not be what delivers the notice
					// here, so the case can only pass on the scheduler's own fallback.
					once: () => {},
				},
			},
			backendManagerStub(
				service.LocalOperatorStartupMode.GLOBAL_INSTALL,
				() => updateService,
			),
		);
		interval = updateService.updateCheckInterval;
		updateService.backendUrl = "http://127.0.0.1:9";

		// A marker for an install the running version never reached: the failure
		// this re-check reports once ShipIt's job has gone. Written AFTER the
		// constructor, which runs its own start-up recovery on an empty directory.
		writePendingInstallMarker(userData, {
			targetVersion: "0.19.5",
			artifactPath: "/tmp/local-operator-ui-0.19.5-universal.zip",
			startedAt: new Date(Date.now() - 60_000).toISOString(),
			watchdogPid: null,
		});
		// The in-flight reading that makes this a re-check rather than a start-up:
		// the panel is up, and the process has already told the renderer so.
		updateService.installWasInFlight = true;
		updateService.installInFlightDelivered = true;
		sent.length = 0;

		updateService.recoverPendingInstall();

		// Nothing is pushed by the re-check itself: delivery is the scheduler's.
		assert.deepEqual(
			sent.filter(({ channel }) => channel === "update-install-failed"),
			[],
		);
		// And the marker is still there to be re-reported until it is heard.
		assert.equal(existsSync(pendingInstallMarkerPath(userData)), true);

		// The scheduler's fallback - `did-finish-load` cannot fire on a stub - is
		// what delivers it, and only then does the superseded state go.
		await new Promise((resolve) => setTimeout(resolve, 5300));
		const failures = sent.filter(
			({ channel }) => channel === "update-install-failed",
		);
		assert.equal(failures.length, 1, JSON.stringify(sent));
		assert.match(
			failures[0].payload.detail,
			/local-operator-ui-0\.19\.5-universal\.zip/,
		);
		assert.equal(failures[0].payload.cancelledByRelaunch, true);
		// The durable record names the version the panel named, read from
		// `app.getVersion()` on this same pass - not the previous record's version
		// carried forward, which is what made a first failure say "unknown" while the
		// panel said otherwise (QA Q1). The harness stubs `getVersion` at
		// "0.0.0-test", so this is the service's own field reaching disk.
		assert.equal(readLastInstallAttempt(userData).runningVersion, "0.0.0-test");
		assert.equal(existsSync(pendingInstallMarkerPath(userData)), false);
	} finally {
		if (interval) clearInterval(interval);
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
});

/**
 * A quit while an install is in flight is a quit for the install, and an
 * ordinary quit stays ordinary.
 *
 * The macOS window close used to leave the app running with no window, which is
 * exactly the instance Squirrel's final validation aborts an install on - so the
 * red button cancelled the update silently, by the gesture every macOS user
 * reaches for first (UX U1). The relaunch promise was also button-shaped: only
 * the panel's own action ensured a watchdog (UX U2). Both are decided from the
 * machine - a current marker plus the install's launchd job - rather than from
 * what the renderer was told, so the decision holds when no panel was ever drawn.
 *
 * This pins the decision, not the wiring: that `window-all-closed` and
 * `before-quit` call it is `src/main/index.ts`, and the live-app run in the PR
 * exercises the gesture against a real process.
 */
test("a quit during an in-flight install takes the close over, and only then", async () => {
	const home = mkdtempSync(join(tmpdir(), "lo-service-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-service-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	const { service, serviceDir } = await loadUpdateServiceModule();

	// The window the service is built around is inert here, and that is the point
	// rather than a shortcut: this decision reads the machine - the marker on disk
	// and the install's launchd job - and never a panel. No marker exists while
	// these are built, so none of them runs start-up recovery over one.
	const buildService = () => {
		const updateService = new service.UpdateService(
			{
				isDestroyed: () => false,
				webContents: {
					send: () => {},
					isDestroyed: () => false,
					once: () => {},
				},
			},
			backendManagerStub(
				service.LocalOperatorStartupMode.GLOBAL_INSTALL,
				() => updateService,
			),
		);
		updateService.backendUrl = "http://127.0.0.1:9";
		return updateService;
	};
	const intervals = [];
	const withService = (jobState) => {
		const updateService = buildService();
		intervals.push(updateService.updateCheckInterval);
		updateService.installJobStateProbe = () => jobState;
		return updateService;
	};
	const idle = withService("running");
	const live = withService("running");
	const leftoverJob = withService("absent");
	const freshRegistration = withService("registered");
	const aged = withService("running");
	const writeMarker = (startedAt) =>
		writePendingInstallMarker(userData, {
			targetVersion: "0.19.5",
			artifactPath: "/tmp/local-operator-ui-0.19.5-universal.zip",
			startedAt,
			watchdogPid: null,
		});

	try {
		// No marker at all: this is the ordinary close, and macOS keeps its
		// behaviour of leaving the app in the dock.
		assert.equal(idle.quitForInFlightInstall("last window closed"), false);

		// A current marker with the install's job loaded: the close is taken over,
		// so the caller can quit rather than leave a window-less instance running
		// into Squirrel's validation.
		writeMarker(new Date().toISOString());
		assert.equal(live.quitForInFlightInstall("last window closed"), true);
		// The same quit arriving twice - the window close, then `before-quit` - is
		// still one takeover, and must not start a second watchdog.
		assert.equal(live.quitForInFlightInstall("app quit"), true);
		// Nothing was cleared to make the promise true: the marker is the record of
		// the install that is still running.
		assert.equal(existsSync(pendingInstallMarkerPath(userData)), true);

		// A marker whose install job is GONE is not an install. A FAILED install
		// leaves its launchd job REGISTERED for hours (0.17.0: runs=3114), which is
		// the leftover the probe and the recency rule exist to tell apart from a live
		// install - and the state this one asserts is the other one, no job at all.
		writeMarker(new Date().toISOString());
		assert.equal(
			leftoverJob.quitForInFlightInstall("last window closed"),
			false,
		);

		// A REGISTERED job under a marker inside the hand-off is still THIS install
		// rather than a leftover (review R6/R11): launchd has the job before ShipIt has
		// a pid, and a quit inside those seconds is taken over - that close, left
		// alone, would put a window-less instance into the install's running-instance
		// check. The marker is re-written HERE, two seconds old (the shortest hand-off
		// this machine's own installs show), because this path takes no `now`: an
		// assertion made against a marker written earlier in the test would be an
		// assertion about how fast the test ran rather than about the state it names
		// (review R13).
		writeMarker(new Date(Date.now() - 2000).toISOString());
		assert.equal(
			freshRegistration.quitForInFlightInstall("last window closed"),
			true,
		);

		// And a marker older than the recency bound is a failure's leftover too, so
		// the ordinary close behaviour stands there.
		writeMarker(
			new Date(
				Date.now() - (PENDING_INSTALL_RECENCY_SECONDS + 60) * 1000,
			).toISOString(),
		);
		assert.equal(aged.quitForInFlightInstall("last window closed"), false);
	} finally {
		for (const interval of intervals) {
			if (interval) clearInterval(interval);
		}
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
});

/**
 * One quit is one decision, whichever gesture asked for it.
 *
 * There are two ways into this decision and the user believes both are the same
 * act: the panel's own "Quit and let the update finish", which goes through the
 * `quit-for-update-install` IPC handler, and the window close / ordinary quit,
 * which go through `quitForInFlightInstall`. The app runs the second one again
 * on the way out, because `before-quit` asks the same question. So the handler
 * has to RECORD its decision exactly as the other path does - without that, one
 * quit is answered twice and the second answer starts a second relaunch
 * watchdog for one install, where the panel's gesture and the window gesture
 * would leave different numbers of watchdogs behind (UX U8).
 *
 * What is pinned is the service's own property, measured where the two paths
 * meet: the number of watchdogs ensured per quit. The gesture-to-handler wiring
 * lives in `src/main/index.ts` and `src/preload/index.ts`, and the live-app run
 * in the PR drives the gestures themselves.
 */
test("a quit through the panel's own handler decides once and ensures one watchdog", async () => {
	const home = mkdtempSync(join(tmpdir(), "lo-service-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-service-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	const { service, serviceDir } = await loadUpdateServiceModule();
	const intervals = [];

	try {
		// A current marker with the install's job loaded: the machine says an
		// install is in flight, so both gestures are the take-over case.
		writePendingInstallMarker(userData, {
			targetVersion: "0.19.5",
			artifactPath: "/tmp/local-operator-ui-0.19.5-universal.zip",
			startedAt: new Date().toISOString(),
			watchdogPid: null,
		});
		const updateService = new service.UpdateService(
			{
				isDestroyed: () => false,
				webContents: {
					send: () => {},
					isDestroyed: () => false,
					once: () => {},
				},
			},
			backendManagerStub(
				service.LocalOperatorStartupMode.GLOBAL_INSTALL,
				() => updateService,
			),
		);
		intervals.push(updateService.updateCheckInterval);
		updateService.backendUrl = "http://127.0.0.1:9";
		updateService.installJobStateProbe = () => "running";
		/*
		 * The seam is `launchWatchdog`, substituted rather than run for real.
		 *
		 * It is where an ensure ends (the marker carries no watchdog pid, so
		 * `watchdogIsOurs` answers no and every ensure starts one), so counting
		 * these calls is counting the watchdogs a quit would leave running - which
		 * is the thing a second decision produces a second of. Substituted rather
		 * than delegated because the real one spawns a detached process on a
		 * packaged darwin app, and a test must not leave a watchdog on the
		 * operator's machine; its own behaviour is driven against a real process
		 * tree by the cases above.
		 */
		const ensures = [];
		updateService.launchWatchdog = (targetVersion) => {
			ensures.push(targetVersion);
			return 4242;
		};

		updateService.setupIpcHandlers();
		const handler = globalThis.__loIpcHandlers?.["quit-for-update-install"];
		assert.equal(
			typeof handler,
			"function",
			"the panel's own quit must have a handler to reach the decision",
		);

		// The panel's gesture: one decision, one watchdog.
		assert.equal(handler(), true);
		assert.equal(ensures.length, 1);

		// And the app's own quit on the way out asks the same question again -
		// which is the whole reason the handler had to record its answer.
		assert.equal(updateService.quitForInFlightInstall("app quit"), true);
		assert.equal(ensures.length, 1);

		// The window-close gesture then behaves identically, so the two gestures
		// cannot drift apart again: same one decision, same one watchdog.
		const fromWindowClose = new service.UpdateService(
			{
				isDestroyed: () => false,
				webContents: {
					send: () => {},
					isDestroyed: () => false,
					once: () => {},
				},
			},
			backendManagerStub(
				service.LocalOperatorStartupMode.GLOBAL_INSTALL,
				() => fromWindowClose,
			),
		);
		intervals.push(fromWindowClose.updateCheckInterval);
		fromWindowClose.backendUrl = "http://127.0.0.1:9";
		fromWindowClose.installJobStateProbe = () => "running";
		const windowEnsures = [];
		fromWindowClose.launchWatchdog = (targetVersion) => {
			windowEnsures.push(targetVersion);
			return 4243;
		};
		assert.equal(
			fromWindowClose.quitForInFlightInstall("last window closed"),
			true,
		);
		assert.equal(fromWindowClose.quitForInFlightInstall("app quit"), true);
		assert.equal(windowEnsures.length, 1);

		// Nothing was cleared to make either promise true: the marker is the
		// record of the install that is still running.
		assert.equal(existsSync(pendingInstallMarkerPath(userData)), true);
	} finally {
		for (const interval of intervals) {
			if (interval) clearInterval(interval);
		}
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loIpcHandlers;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// The launch that finds its own install still running

/**
 * A launch FOR an install that is still running, against a launch that is not.
 *
 * WHY THIS IS THE DECISION AND NOT THE COPY: every part of this path is about one
 * question - is an instance of this app going to exist while ShipIt takes its
 * final check? - and the three ways of answering "open" are each a rule from an
 * earlier incident: no marker and a dead job are what keep a failed install's
 * leftover job (0.17.0: `runs=3114`) from holding every later launch forever, and
 * a marker past the hold bound is the relaunch watchdog's own hard-bound launch,
 * which exists so a user is never left with no app at all. A hold that swallowed
 * that last case would ensure a watchdog on its way out, wait out another hard
 * bound and do it again.
 *
 * The 2026-09-18 incident, verbatim from `ShipIt_stderr.log`: an install four
 * minutes in was aborted with `Aborting update attempt because there are 1 running
 * instances of the target app`, and the app's own log shows it had come back at
 * 09:37:33. The app being open is what that check answers on, so the launch that
 * comes back has to leave.
 */
test("a launch is held only for an install that is live, and never past the watchdog's hard bound", () => {
	const now = Date.now();
	const fresh = new Date(now - 60_000).toISOString();
	const withinHold = new Date(
		now - (PENDING_INSTALL_LAUNCH_HOLD_SECONDS - 60) * 1000,
	).toISOString();
	const pastHold = new Date(
		now - (PENDING_INSTALL_LAUNCH_HOLD_SECONDS + 60) * 1000,
	).toISOString();
	const marker = (startedAt) => ({
		targetVersion: "0.19.5",
		artifactPath: "/tmp/local-operator-ui-0.19.5-universal.zip",
		startedAt,
		watchdogPid: null,
	});

	// The bound is the watchdog's own, minus the margin the two clocks need: the
	// watchdog is spawned a few milliseconds before the marker is written, so a
	// hold that read the hard bound itself would hold the launch the watchdog
	// makes at it.
	assert.equal(
		PENDING_INSTALL_LAUNCH_HOLD_SECONDS + LAUNCH_HOLD_END_MARGIN_SECONDS,
		WATCHDOG_HARD_TIMEOUT_SECONDS,
	);

	const running = "0.19.4";

	/*
	 * The two facts the installer's identity check matches on, spelled the way the
	 * app spells them: its OWN ShipIt, resolved from the running bundle rather than
	 * from a constant, and its own staging root. Both are required together, which is
	 * what keeps another application's ShipIt from being read as this one's.
	 */
	const SHIPIT_IN_BUNDLE =
		"/Applications/Local Operator.app/Contents/Frameworks/Squirrel.framework/Versions/Current/Resources/ShipIt";
	const STAGING_ROOT =
		"/Users/someone/Library/Application Support/Local Operator/update-staging";

	/*
	 * The machine's two liveness answers, gathered the way production gathers them
	 * (`installLivenessNow`, management MAJOR-1): a case states the facts it is
	 * about - the marker's own installer pid, its command line, whether some other
	 * process is this app's installer, and what launchd says - and the classifier
	 * decides what they mean. Stating them here rather than inside the classifier is
	 * what makes the two paths assertable side by side.
	 */
	const livenessFor = (input) =>
		installLivenessNow({
			marker: input.marker ?? null,
			installerCommandLine: () => input.commandLine ?? null,
			installerElsewhere: () => input.elsewhere === true,
			shipItPath: SHIPIT_IN_BUNDLE,
			stagingRoot: STAGING_ROOT,
			jobState: () => input.jobState ?? "unread",
		});
	const liveness = (input) => livenessFor(input);

	assert.deepEqual(
		evaluateLaunchDuringInstall({
			marker: null,
			liveness: liveness({ jobState: "running" }),
			runningVersion: running,
			now,
		}),
		{ kind: "open" },
	);
	// A marker with no job: a failed install's leftover, which must never hold a
	// launch (the app has to be able to start to report the failure).
	assert.deepEqual(
		evaluateLaunchDuringInstall({
			marker: marker(fresh),
			liveness: liveness({ jobState: "absent" }),
			runningVersion: running,
			now,
		}),
		{ kind: "open" },
	);
	// An undated marker: nothing can say it is live, and opening normally reports
	// the install rather than hiding it behind a notice.
	assert.deepEqual(
		evaluateLaunchDuringInstall({
			marker: { ...marker(""), startedAt: "" },
			liveness: liveness({ jobState: "running" }),
			runningVersion: running,
			now,
		}),
		{ kind: "open" },
	);
	// The watchdog's own hard-bound launch, which must open normally.
	assert.deepEqual(
		evaluateLaunchDuringInstall({
			marker: marker(pastHold),
			liveness: liveness({ jobState: "running" }),
			runningVersion: running,
			now,
		}),
		{ kind: "open" },
	);

	/*
	 * THE SEAM WITH AN INSTALL THIS APP STARTED (management MAJOR-1, UX U2). Such an
	 * install has NO launchd job, so before this the hold read `jobState: "absent"`
	 * and opened the app straight into the swap - the 2026-09-18 cancellation, made
	 * likelier by a window that is now seconds long rather than minutes. The marker
	 * names the installer it spawned instead, and that pid is what holds the launch.
	 */
	const directMarker = { ...marker(fresh), installerPid: 998877 };
	const pidLine = `${SHIPIT_IN_BUNDLE} ${STAGING_ROOT}/0.19.5-abc/state.plist`;
	assert.deepEqual(
		evaluateLaunchDuringInstall({
			marker: directMarker,
			liveness: livenessFor({
				marker: directMarker,
				commandLine: pidLine,
				// The job is not consulted for this marker at all, so a leftover
				// registration is stated here precisely to prove it cannot decide.
				jobState: "registered",
			}),
			runningVersion: running,
			now,
		}),
		{ kind: "hold", marker: directMarker },
	);
	// The same install with its installer gone: nothing is installing, so the
	// launch opens and recovery explains what happened.
	assert.deepEqual(
		evaluateLaunchDuringInstall({
			marker: directMarker,
			liveness: livenessFor({ marker: directMarker, jobState: "registered" }),
			runningVersion: running,
			now,
		}),
		{ kind: "open" },
	);
	// A pid that stopped being the installer while an install it started is still
	// running: `installerElsewhere` finds it by the ShipIt path AND this staging
	// root, and the launch is held (review MINOR-3).
	assert.deepEqual(
		evaluateLaunchDuringInstall({
			marker: directMarker,
			liveness: livenessFor({ marker: directMarker, elsewhere: true }),
			runningVersion: running,
			now,
		}),
		{ kind: "hold", marker: directMarker },
	);
	// A COMPLETED direct install: the target is the running version, so the pid
	// that is still winding down must not hold anything - the app has to open so
	// recovery can clear the marker. This is the rule that made the app unreachable
	// after every successful update, kept intact through the pid (management
	// MAJOR-1).
	assert.deepEqual(
		evaluateLaunchDuringInstall({
			marker: { ...directMarker, targetVersion: running },
			liveness: livenessFor({
				marker: { ...directMarker, targetVersion: running },
				commandLine: pidLine,
			}),
			runningVersion: running,
			now,
		}),
		{ kind: "open" },
	);
	// Review U1's case, and the one a person meets after EVERY successful update:
	// the install landed, so the running version has reached the marker's target
	// while the job launchd holds is still there - `evaluatePendingInstall` calls
	// that `succeeded`, and this launch has to open so recovery can clear the
	// marker and report the install. Holding it left the app unreachable for ~29
	// minutes behind a banner promising it would come back by itself.
	assert.deepEqual(
		evaluateLaunchDuringInstall({
			marker: marker(fresh),
			liveness: liveness({ jobState: "running" }),
			runningVersion: "0.19.5",
			now,
		}),
		{ kind: "open" },
	);
	/*
	 * Review R6/R11 at the decision, which is where the window it closes lives: the
	 * same REGISTERED job read at the ages the machine's own fourteen installs span
	 * (see the in-flight test above for the install behind each number). Two of them
	 * outlasted the five-second bound this predicate first had, and a launch landing
	 * there opened into a live install; `fresh` is a minute old, which is an install
	 * that is over and must open so recovery reports it - the U2 case QA walked.
	 */
	assert.equal(
		evaluateLaunchDuringInstall({
			marker: marker(new Date(now - 2000).toISOString()),
			liveness: liveness({ jobState: "registered" }),
			runningVersion: running,
			now,
		}).kind,
		"hold",
		"the shortest measured hand-off is a live install",
	);
	assert.equal(
		evaluateLaunchDuringInstall({
			marker: marker(new Date(now - 6430).toISOString()),
			liveness: liveness({ jobState: "registered" }),
			runningVersion: running,
			now,
		}).kind,
		"hold",
		"the 09-18 16:32 hand-off (6.429 s) is a live install, and the old bound opened it",
	);
	assert.equal(
		evaluateLaunchDuringInstall({
			marker: marker(new Date(now - 13320).toISOString()),
			liveness: liveness({ jobState: "registered" }),
			runningVersion: running,
			now,
		}).kind,
		"hold",
		"the longest measured hand-off (09-16 15:23, 13.315 s) is a live install",
	);
	assert.equal(
		evaluateLaunchDuringInstall({
			marker: marker(fresh),
			liveness: liveness({ jobState: "registered" }),
			runningVersion: running,
			now,
		}).kind,
		"open",
		"and a minute past the bound the same registration is the leftover a finished install leaves",
	);
	// U1's own state, in the shape it was when it held the operator's app for half an
	// hour: a 280 s marker whose target the running version has ALREADY reached, with
	// the job still registered. `evaluatePendingInstall` answers `succeeded` before it
	// reads the job at all, so this opens at any age.
	assert.equal(
		evaluateLaunchDuringInstall({
			marker: marker(new Date(now - 280_000).toISOString()),
			liveness: liveness({ jobState: "registered" }),
			runningVersion: "0.19.5",
			now,
		}).kind,
		"open",
	);
	// And a live install, which is the case this exists for.
	const held = evaluateLaunchDuringInstall({
		marker: marker(fresh),
		liveness: liveness({ jobState: "running" }),
		runningVersion: running,
		now,
	});
	assert.equal(held.kind, "hold");
	assert.equal(held.marker.targetVersion, "0.19.5");
	const heldLate = evaluateLaunchDuringInstall({
		marker: marker(withinHold),
		liveness: liveness({ jobState: "running" }),
		runningVersion: running,
		now,
	});
	assert.equal(heldLate.kind, "hold");
});

/**
 * What the user is told when the launch they just made leaves again.
 *
 * A banner is the whole channel on this path - the process exits before a window
 * could render anything - so the sentence has to carry both facts the in-flight
 * PANEL used to carry over minutes of the user's attention: nothing is broken,
 * and they do not have to do anything. That second one is asserted as an absence:
 * the panel's copy told the user to quit the app, and this launch is doing the
 * quitting itself, so a "quit" in this body would be asking for an act the user
 * cannot perform on a window that never appears.
 */
test("the hold's notice names the version and the wait, states the click, and asks for nothing", () => {
	const marker = {
		targetVersion: "0.19.5",
		artifactPath: "/tmp/local-operator-ui-0.19.5-universal.zip",
		startedAt: new Date().toISOString(),
		watchdogPid: null,
	};
	const notice = installLaunchHoldNotice(marker);
	assert.match(notice.title, /still updating/);
	assert.ok(notice.body.includes("0.19.5"), notice.body);
	assert.match(notice.body, /will open by itself when the install finishes/);
	/*
	 * And NO duration, which is the one thing this copy had to lose (QA round 2,
	 * Q2): it carried "this can take a few minutes" - the words the watchdog's own
	 * notice used, and that notice dropped them for exactly this reason (UX U1).
	 * The path this banner is raised on cannot tell a seconds-long direct install
	 * from a minutes-long fallback one, so a figure here is either an overstatement
	 * by two orders of magnitude or a promise about a path it cannot see.
	 */
	assert.doesNotMatch(notice.body, /minute|second|hour/i);
	// What a click does (review U5): macOS activates the app, which is held again,
	// so the copy says so rather than leaving a control with no readable outcome.
	assert.match(notice.body, /Clicking this notice will not open it any sooner/);
	assert.doesNotMatch(notice.body, /[Qq]uit/);

	// And the branch that could not arrange a relaunch does not promise one
	// (review R2): the log says the app needs starting by hand, and the banner used
	// to say "do nothing" over it.
	const noRelaunch = installLaunchHoldNotice(marker, {
		relaunchEnsured: false,
	});
	assert.match(noRelaunch.body, /start Local Operator by hand/);
	assert.doesNotMatch(noRelaunch.body, /will open by itself/);
	// No duration on this branch either: the sentence that says the app
	// will not come back must not also promise a wait it cannot know.
	assert.doesNotMatch(noRelaunch.body, /minute|second|hour/i);
});

/**
 * The whole hold, driven through the shipped service module.
 *
 * WHAT IS REAL HERE: `holdLaunchForLiveInstall` itself, its reading of the marker
 * on disk and of `app.isPackaged`, `evaluateLaunchDuringInstall`, the notice
 * builder, `ensureRelaunchWatchdog`'s rule about a watchdog that is already ours,
 * and both of its deadlines. SUBSTITUTED: the launchd probe, the watchdog spawn
 * and the quit, because a test must not ask the operator's launchd about a job,
 * leave a detached watchdog on their machine, or quit a process that is not this
 * app. Those are the seams the other cases in this file use for the same reason.
 */
const holdLaunch = async ({
	marker = null,
	jobState = "running",
	runningVersion = "0.28.4",
	packaged = true,
	showNotice,
} = {}) => {
	const home = mkdtempSync(join(tmpdir(), "lo-launch-hold-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-launch-hold-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	globalThis.__loTestAppIsPackaged = packaged;
	const { service, serviceDir } = await loadUpdateServiceModule();
	const events = {
		order: [],
		notices: [],
		watchdogs: [],
		quits: 0,
		forceQuits: 0,
		logs: [],
	};
	try {
		if (marker) writePendingInstallMarker(userData, marker);
		const held = service.holdLaunchForLiveInstall({
			log: (message) => events.logs.push(message),
			jobState: () => jobState,
			runningVersion,
			startWatchdog: (targetVersion) => {
				events.order.push("watchdog");
				events.watchdogs.push(targetVersion);
				return 4242;
			},
			showNotice:
				showNotice ??
				((notice) => {
					events.order.push("notice");
					events.notices.push(notice);
					return Promise.resolve("raised by the test's own stub");
				}),
			quit: () => {
				events.order.push("quit");
				events.quits += 1;
			},
			forceQuit: () => {
				events.forceQuits += 1;
			},
		});
		return { held, events, markerDir: userData };
	} finally {
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		// biome-ignore lint/performance/noDelete: same, for the packaged-app switch the fixture reads with `?? true`.
		delete globalThis.__loTestAppIsPackaged;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
};

const liveMarker = () => ({
	targetVersion: "0.28.5",
	artifactPath: "/tmp/local-operator-ui-0.28.5-universal.zip",
	startedAt: new Date(Date.now() - 45_000).toISOString(),
	watchdogPid: null,
});

test("a launch that finds a live install tells the user, ensures the relaunch and quits", async () => {
	const { held, events } = await holdLaunch({ marker: liveMarker() });
	// The quit is held back by the flush grace, which is a real timer: the answer is
	// "the launch is held", and the quit follows a few hundred milliseconds later
	// so that the record of what the user was told lands first.
	assert.equal(events.quits, 0);
	await new Promise((resolve) => setTimeout(resolve, 600));

	assert.equal(held, true);
	assert.deepEqual(events.notices, [
		installLaunchHoldNotice(liveMarker(), { relaunchEnsured: true }),
	]);
	assert.equal(events.quits, 1);
	assert.equal(events.forceQuits, 0);
	// The promise comes before the quit, and the watchdog before both: the notice
	// says the app comes back, and the only thing that can keep that promise is a
	// watchdog already running when this process goes.
	assert.deepEqual(events.order, ["watchdog", "notice", "quit"]);
	assert.deepEqual(events.watchdogs, ["0.28.5"]);
	assert.ok(
		events.logs.some((line) => line.includes("Holding this launch")),
		JSON.stringify(events.logs),
	);
	// And the record review U3 asked for: what the system did with the notice, in
	// the same log, before the quit that ends the process which could write it.
	assert.ok(
		events.logs.some(
			(line) =>
				line.includes("The notice for the install of version 0.28.5") &&
				line.includes("raised by the test's own stub"),
		),
		JSON.stringify(events.logs),
	);
});

test("nothing is started, shown or quit for a launch that is not held", async () => {
	// No marker at all: the ordinary launch.
	const idle = await holdLaunch();
	assert.equal(idle.held, false);
	// A stale marker whose job is gone: a failed install's leftover, which has to
	// open so recovery can explain what happened.
	const deadJob = await holdLaunch({
		marker: liveMarker(),
		jobState: "registered",
	});
	assert.equal(deadJob.held, false);
	// A live marker, but this process is not the bundle an install replaces - the
	// state is the packaged app's and a worktree launch may not act on it.
	const unpackaged = await holdLaunch({
		marker: liveMarker(),
		packaged: false,
	});
	assert.equal(unpackaged.held, false);
	// A marker the watchdog's own hard bound has passed.
	const pastBound = await holdLaunch({
		marker: {
			...liveMarker(),
			startedAt: new Date(
				Date.now() - (WATCHDOG_HARD_TIMEOUT_SECONDS + 60) * 1000,
			).toISOString(),
		},
	});
	assert.equal(pastBound.held, false);

	for (const result of [idle, deadJob, unpackaged, pastBound]) {
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(result.events.notices, [], JSON.stringify(result.events));
		assert.deepEqual(result.events.watchdogs, []);
		assert.equal(result.events.quits, 0);
		assert.deepEqual(result.events.logs, []);
	}
});

/**
 * A notice the system never reports must not be what keeps the app open.
 *
 * The notice is a convenience; the quit is the point. So the hold's first bound is
 * the notice's own budget (the app's banner, then the install's own channel, then
 * the flush grace) and the second is the quit's own force deadline at 10 s, and
 * this case drives the first one: a system that never fires `show` - a muted
 * Notification Center, a policy that blocks the banner, no notifier at all - costs
 * the user the notice, not the install. Measured here rather than described,
 * because a timer nothing waits for is indistinguishable from one that never
 * fires. The substituted notice never settles at all, which is a harder case than
 * a system that never reports: the caller's own bound has to be what closes it.
 */
test("a notice that never reports itself does not hold the app open", async () => {
	const started = Date.now();
	const { held, events } = await holdLaunch({
		marker: liveMarker(),
		showNotice: () => new Promise(() => {}),
	});
	assert.equal(held, true);
	assert.equal(events.quits, 0, "the quit must wait for its bound, not a tick");
	const deadline = 9_000;
	const settled = await new Promise((resolve) => {
		const poll = setInterval(() => {
			if (events.quits > 0) {
				clearInterval(poll);
				resolve(Date.now() - started);
			}
		}, 25);
		setTimeout(() => {
			clearInterval(poll);
			resolve(null);
		}, deadline);
	});
	assert.ok(
		settled !== null,
		`no quit within ${deadline}ms of a notice that never settled`,
	);
	// The notice's budget rather than the quit's own force deadline: a quit that
	// arrived at 10 s would mean the caller's bound never fired at all, and the
	// force deadline is the backstop for a wedged QUIT rather than a wedged notice.
	assert.equal(
		events.forceQuits,
		0,
		"the force deadline closed this, not the notice bound",
	);
});

// ---------------------------------------------------------------------------
// The start-up seal pass, and who owns the packaged app's install state

/**
 * A start-up pass that repairs the bundle it runs from, and refuses when it can
 * not.
 *
 * Why this is a pass of its own rather than only the pre-flight's: the break is
 * created by the app RUNNING, not by the update, and macOS refuses to launch a
 * bundle whose seal is bad - so an install that breaks itself this way is refused
 * at its next launch with nothing of ours left to run. Probing at start-up is the
 * only point at which the app can catch it while it is still running, and the
 * pre-flight's heal stays as the second chance for a bundle that breaks later.
 */
test("the start-up seal pass heals the bundle it runs from, or refuses out loud", async (t) => {
	if (process.platform !== "darwin") {
		t.skip(
			"macOS only: the probe, the heal and their fixture all use codesign",
		);
		return;
	}
	const home = mkdtempSync(join(tmpdir(), "lo-startup-seal-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-startup-seal-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	const { service, serviceDir } = await loadUpdateServiceModule();
	const sent = [];
	const updateService = new service.UpdateService(
		{
			isDestroyed: () => false,
			webContents: {
				send: (channel, payload) => sent.push({ channel, payload }),
				isDestroyed: () => false,
				// No `did-finish-load` on a stub: the refusal can only arrive on the
				// scheduler's own fallback, which is the delivery this asserts.
				once: () => {},
			},
		},
		backendManagerStub(
			service.LocalOperatorStartupMode.GLOBAL_INSTALL,
			() => updateService,
		),
	);
	const interval = updateService.updateCheckInterval;
	try {
		// The field shape: a bundle signed clean that a python later wrote one
		// `__pycache__/*.pyc` into.
		const healedFixture = makeBytecodeFixture(tempDir("lo-startup-heal-"));
		writeAddedPyc(
			join(healedFixture.pythonRoot, "lib", "python3.12", "json"),
			"__init__.cpython-312.pyc",
		);
		assert.equal(
			healedFixture.probe().exitCode,
			1,
			"the fixture must start out broken, or the case proves nothing",
		);

		await updateService.repairRunningBundleSeal(healedFixture.app);

		assert.equal(
			healedFixture.probe().exitCode,
			0,
			"the start-up pass must leave the bundle it runs from sealed",
		);
		assert.deepEqual(
			sent.filter(({ channel }) => channel === "update-install-blocked"),
			[],
			"a bundle that healed is not a refusal the user has to be shown",
		);

		// The arm that cannot be healed: a sealed resource was rewritten, which
		// no deletion can undo (`file modified:`), so the user gets the remedy.
		const refusedFixture = makeBytecodeFixture(tempDir("lo-startup-refuse-"));
		writeAddedPyc(
			join(refusedFixture.pythonRoot, "lib", "python3.12", "json"),
			"__init__.cpython-312.pyc",
		);
		writeFileSync(
			join(refusedFixture.contents, "Resources", "asset.txt"),
			"tampered\n",
			"utf8",
		);
		await updateService.repairRunningBundleSeal(refusedFixture.app);

		// Scheduled rather than pushed: the window is loading when a start-up pass
		// runs, and a push no subscriber saw still reports success.
		assert.deepEqual(
			sent,
			[],
			"the refusal must wait for the delivery scheduler",
		);
		await new Promise((resolve) => setTimeout(resolve, 5300));
		const blocks = sent.filter(
			({ channel }) => channel === "update-install-blocked",
		);
		assert.equal(blocks.length, 1, JSON.stringify(sent));
		assert.equal(blocks[0].payload.code, "installed-bundle-not-sealed");
		assert.match(
			blocks[0].payload.detail,
			/a sealed resource is missing or invalid/,
		);
		assert.match(blocks[0].payload.remedy.text, /download a fresh copy/);
		// And the copy is about THIS moment: no update was attempted here, so the
		// update's sentence ("the update was stopped before the app quit") would tell
		// the user about something that never happened (review R2).
		assert.match(blocks[0].payload.message, /did not pass its integrity check/);
		assert.doesNotMatch(blocks[0].payload.message, /update was stopped/);
		assert.doesNotMatch(blocks[0].payload.message, /will refuse/);
	} finally {
		if (interval) clearInterval(interval);
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestIpcHandlers;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
});

/**
 * The two refusals are two sentences, and they are not interchangeable.
 *
 * The remedy is the same user action in both - quit, download a fresh copy,
 * replace - but the fact the sentence reports is not: an update that was stopped,
 * or a copy macOS will refuse to open. One payload builder serves both, so this
 * is where the split is pinned (review R2).
 */
test("the refusal says which it is: an update stopped, or a copy to replace", () => {
	const detail =
		"file added: Contents/Resources/python_aarch64/lib/python3.12/x.pyc";
	const update = install.installedBundleSealBlock(
		"/Applications/Local Operator.app",
		detail,
		"0.22.3",
	);
	const startup = install.installedBundleSealBlock(
		"/Applications/Local Operator.app",
		detail,
		null,
		"startup",
	);
	const versionless = install.installedBundleSealBlock(
		"/Applications/Local Operator.app",
		detail,
		null,
	);

	assert.match(
		update.message,
		/update to version 0\.22\.3 was stopped before the app quit/,
	);
	assert.doesNotMatch(versionless.message, /version/);
	assert.match(startup.message, /did not pass its integrity check/);
	assert.doesNotMatch(startup.message, /will refuse/);
	assert.doesNotMatch(startup.message, /update was stopped/);

	// One code and one remedy, so the renderer's heading and the user's next step do
	// not depend on which pass found it.
	assert.equal(startup.code, update.code);
	assert.deepEqual(startup.remedy, update.remedy);
	assert.equal(startup.detail, update.detail);
});

/**
 * An unpackaged instance leaves the packaged app's install state exactly as it
 * is.
 *
 * Why: those instances share the packaged app's log directory (measured - the
 * macOS log path is hardcoded, so one file interleaves the 09:48 packaged install
 * with every worktree's `Dev mode: true` start), and the marker, the ShipIt job
 * and the staged tree all describe an install of a bundle such an instance is
 * not. Acting on that state - clearing the marker, reaping the job, writing a
 * marker of its own - either destroys the only record of the packaged app's
 * install or invents one for an install that cannot happen.
 */
test("an unpackaged instance leaves the packaged app's install state alone", async () => {
	const home = mkdtempSync(join(tmpdir(), "lo-dev-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-dev-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	const originalPackaged = globalThis.__loTestAppIsPackaged;
	globalThis.__loTestAppIsPackaged = false;
	const { service, serviceDir } = await loadUpdateServiceModule();
	const sent = [];
	const updateService = new service.UpdateService(
		{
			isDestroyed: () => false,
			webContents: {
				send: (channel, payload) => sent.push({ channel, payload }),
				isDestroyed: () => false,
				once: () => {},
			},
		},
		backendManagerStub(
			service.LocalOperatorStartupMode.GLOBAL_INSTALL,
			() => updateService,
		),
	);
	const interval = updateService.updateCheckInterval;
	try {
		// The operator's own leftovers, reproduced: a marker for an install this
		// instance never ran, dated now so nothing about the age of it decides the
		// case.
		writePendingInstallMarker(userData, {
			targetVersion: "0.22.2",
			artifactPath: "/tmp/local-operator-ui-0.22.2-arm64.zip",
			startedAt: new Date().toISOString(),
			watchdogPid: 77355,
		});

		updateService.recoverPendingInstall();

		assert.equal(
			existsSync(pendingInstallMarkerPath(userData)),
			true,
			"an unpackaged instance must not clear the packaged app's marker",
		);
		assert.deepEqual(
			sent,
			[],
			"and must not report an install it cannot know the outcome of",
		);
		// The reaping half: a failure verdict is what removes ShipIt's job and the
		// staged tree, and it is reached only through `recoverPendingInstall`. Held
		// open from the outside - the method the failure branch calls - so the claim
		// is about this instance's decisions rather than about what `launchctl` does
		// on the machine running the tests.
		const reaped = [];
		updateService.reapFailedInstallLeftovers = () => reaped.push("reaped");
		// Run again with the same marker: a second pass must reach the same answer,
		// because nothing was cleared the first time round.
		updateService.recoverPendingInstall();
		assert.deepEqual(
			reaped,
			[],
			"an unpackaged instance must not reap the packaged app's install",
		);

		// And an install cannot be started from here either: the marker below is
		// written by the install path, so a refusal is what keeps this instance
		// from writing one for a bundle it is not.
		updateService.setupIpcHandlers();
		const quitAndInstall = globalThis.__loIpcHandlers["quit-and-install"];
		assert.equal(await quitAndInstall(), false);
		const marker = JSON.parse(
			readFileSync(pendingInstallMarkerPath(userData), "utf8"),
		);
		assert.equal(
			marker.targetVersion,
			"0.22.2",
			"the marker must still be the packaged app's own record",
		);
		assert.equal(marker.watchdogPid, 77355);
	} finally {
		if (interval) clearInterval(interval);
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		if (originalPackaged === undefined) delete globalThis.__loTestAppIsPackaged;
		else globalThis.__loTestAppIsPackaged = originalPackaged;
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loIpcHandlers;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
});

/*
 * ---- the APP-OWNED arm's own orchestration (review R5) ---------------------
 *
 * What had no case at all: `runAppOwnedUpdateAttempt` (the publish-then-restart
 * sequence this change adds) and `installEnvironmentInto` beneath it. The module
 * under them (`managed-python.test.mjs`) covers publish/pointer retention, and the
 * renderer's suites cover what the panel does with a payload - but nothing drove
 * the service's own decisions, so the ordering this arm leans on (publish, then
 * restart; nothing stopped before the write), the phase it announces, the space it
 * requires and the payload it reports on a restart that did not take were all
 * unasserted. That is review R5, and it is also why the CI gap it names matters:
 * `managed-python.test.mjs` is macOS-gated while Desktop Tests runs ubuntu, so the
 * cases below are deliberately free of the seed, pip and the filesystem - the
 * publish is scripted at the module boundary, which is the boundary the service
 * actually talks to.
 */

/**
 * A scripted `src/main/backend/managed-python`, re-exporting the shipped module.
 *
 * The three functions the app-owned arm uses are overridden and every other export
 * is the real one (an explicit local export shadows `export *`), so a case still
 * exercises the shipped code everywhere it does not name a stub.
 */
const managedPythonFixture = (realModulePath) => `
export * from ${JSON.stringify(realModulePath)};
export const publishedBackendVersion = () => globalThis.__loManagedPublished();
export const managedPythonRoot = () => globalThis.__loManagedRoot;
export const updateManagedPython = async (options, install, decision) =>
	globalThis.__loManagedUpdate({ options, install, decision });
`;

/**
 * A SYNTHETIC INTERPRETER for the app-owned publish, written into a scratch
 * directory of this case's own.
 *
 * Review R6 asked for the failing case to be driven through
 * `installEnvironmentInto`'s own pip branch rather than a hand-written error
 * string, and this is the smallest thing that does it: a shell script that answers
 * the `-m venv` step the way a working interpreter would (creating the new
 * environment's `bin/python` as a copy of itself) and then fails every later
 * invocation - the pip install, and the `pip show` read-back - with the machine's
 * own words. The shipped code starts it, captures its output and reports it, so the
 * text the assertions match on is the child's rather than the fixture's.
 *
 * WHY A PILOT RATHER THAN A REAL PIP: this case is about what the app does with a
 * failure, not about pip, and the real path needs ~450 MB of free space and a wheel
 * closure. The interpreter here is not a stub of the app - the app runs it for real.
 */
const writeInstallerPilot = ({ pipFailure = null, venvFailure = null }) => {
	const dir = mkdtempSync(join(tmpdir(), "lo-installer-pilot-"));
	const interpreter = join(dir, "python");
	/*
	 * TWO ARMS, because review R6 found the same gap on both failing steps of the
	 * publish: `venvFailure` makes the FIRST step fail (nothing is created), while
	 * `pipFailure` is the step that follows a successful creation - the ~100 MB
	 * environment and the wheel closure, which is where a disk that fills mid-update
	 * is most often met. Both write the machine's words to stderr and exit non-zero,
	 * which is what a real interpreter does.
	 */
	const script = venvFailure
		? `#!/bin/sh
cat >&2 <<'LO_PILOT_VENV_FAILURE'
${venvFailure}
LO_PILOT_VENV_FAILURE
exit 1
`
		: `#!/bin/sh
# A synthetic interpreter: venv creation succeeds (the environment's interpreter is
# a copy of this script, so the NEXT step is what fails), everything else is the pip
# step and fails with the machine's own output.
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
	mkdir -p "$3/bin"
	cp "$0" "$3/bin/python"
	chmod +x "$3/bin/python"
	exit 0
fi
cat >&2 <<'LO_PILOT_PIP_FAILURE'
${pipFailure}
LO_PILOT_PIP_FAILURE
exit 1
`;
	writeFileSync(interpreter, script, { mode: 0o755 });
	return { dir, interpreter };
};

/**
 * One app-owned update attempt, driven end to end through `updateBackend`.
 *
 * WHAT IS REAL HERE: the dispatch (`updateBackend`'s APP_BUNDLED_VENV branch), the
 * attempt's own guard, the target resolution, the phase decision, the restart
 * decision, the completion payloads and the failure copy. What is scripted: the
 * publish (`updateManagedPython`), the install callback's own work, the daemon's
 * `/health` readings and the free-space answer - each at the seam the service
 * itself calls, so an ordering assertion is about the service's code.
 *
 * `order` is the fixture's spine: every step the attempt takes that a bug could
 * reorder appends to it, which is how "nothing was stopped before the write" and
 * "the restart came after the publish" are asserted as sequences rather than as
 * two separate facts.
 */
/**
 * A loopback daemon that enforces the preconditions the real desktop daemon does.
 *
 * WHY THIS EXISTS AT ALL (review round 2, R2-M1). The engage this PR shipped posted
 * `sessions.watch` with a FRESHLY GENERATED subscription id, and every fixture in this
 * file answered 200 to it - so the committed cases passed on a call the real daemon
 * answers with a 404, and the recovery half of this change was a no-op nobody could
 * see. The two route contracts the engage has to satisfy are both modelled here rather
 * than stubbed away:
 *
 * - **an id only exists while a stream holds it.** `sessions.watch` hands its id to
 *   `DesktopSessionBridge.watch`, which looks it up in its subscriber table and raises
 *   `KeyError` for one it has never seen - so this answers 404 for any id that is not
 *   currently held by an OPEN events stream, and records the attempt.
 * - **a visible lease is what creates residency.** The real bridge warms for a live
 *   visible lease on a cold session (`refresh_watch`), which is why an accepted lease
 *   here is what makes the session's runtime appear in the roster - and a refused lease
 *   therefore cannot.
 *
 * The events stream is a REAL HTTP response over loopback and the `open` frame is
 * parsed by the app's own `DesktopStreamRelay`, so the subscription id travels the path
 * it travels in production: minted by the bridge, carried in the frame's payload, read
 * by the relay. The watch and warm legs are answered by the fixture's `requestDesktop`
 * (it replaces the transport, not the daemon), and both consult this object's state, so
 * a lease can only be accepted for an id a live stream is holding.
 */
const startFakeDesktopDaemon = async ({ refuseStreams = false } = {}) => {
	/** subscriptionId -> the session whose stream minted it, for as long as it is open. */
	const held = new Map();
	/** Every id this daemon has minted, in order, whether or not it is still held. */
	const mintedIds = [];
	/** The sessions whose runtime this daemon has started (warm, or an accepted lease). */
	const started = new Set();
	/** Every lease it accepted, so a case can assert WHICH id a lease was made on. */
	const acceptedLeases = [];
	/** Every lease it refused, with the id, so a case can assert WHY it was refused. */
	const refusedLeases = [];
	let minted = 0;
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const match =
			/^\/v1\/desktop\/sessions\/([a-f0-9]+)\/(events|watch|warm)$/.exec(
				url.pathname,
			);
		if (!match) {
			response.writeHead(404);
			response.end();
			return;
		}
		const [, sessionId, route] = match;
		if (route === "events") {
			if (refuseStreams) {
				/*
				 * THE SHAPE THE SESSION-GONE ARM TAKES. A stream the daemon will not open is
				 * the one way a caller with no id can be met without anything being wrong with
				 * the caller: there is no `open` frame, so there is nothing to lease.
				 */
				response.writeHead(404, { "Content-Type": "application/json" });
				response.end(
					JSON.stringify({
						detail:
							"Requested session, profile, team or subscription not found",
					}),
				);
				return;
			}
			/*
			 * The id the bridge mints. 32 lowercase hex, the contract's own pattern, and
			 * held only while this response is open - the `close` handler below is what
			 * makes a lease against a closed stream fail, which is the arm a caller that
			 * caches an id would hit.
			 */
			const subscriptionId = (++minted).toString(16).padStart(32, "0");
			mintedIds.push(subscriptionId);
			held.set(subscriptionId, sessionId);
			response.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-store",
			});
			response.write(
				`data: ${JSON.stringify({
					session_id: sessionId,
					epoch: "fixture",
					seq: 0,
					type: "open",
					payload: { subscription_id: subscriptionId, gap: false },
				})}\n\n`,
			);
			/*
			 * THE ID LIVES AS LONG AS THE CONNECTION. `IncomingMessage`'s own `close`
			 * fires when the REQUEST has completed, which for a GET is immediately - it
			 * would release the id before the caller could lease it, and every lease
			 * would 404 for a reason that has nothing to do with the caller. The SOCKET's
			 * close is the event that means "the client went away", which is exactly what
			 * the bridge's subscriber table does.
			 */
			request.socket.on("close", () => held.delete(subscriptionId));
			return;
		}
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ result: {} }));
	});
	/*
	 * EVERY SOCKET IS TRACKED AND REAPED BY NAME.
	 *
	 * WHY A FIXTURE THAT LEAVES A SOCKET OPEN IS A HANG RATHER THAN A WARNING: this file
	 * runs under `scripts/run-desktop-tests.mjs` with no `--test-force-exit`, so an open
	 * handle keeps the worker alive after the last test and the run never ends - measured
	 * here as "Promise resolution is still pending but the event loop has already
	 * resolved" with the file-level test as the only summary. The relay's stream and the
	 * keep-alive connection it leaves behind are both real sockets, so teardown destroys
	 * them rather than hoping `close()` is enough.
	 */
	const sockets = new Set();
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	await new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => resolve(undefined)),
	);
	/* A leaked server must not be able to hold the process open on its own. */
	server.unref();
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		held,
		mintedIds,
		started,
		acceptedLeases,
		refusedLeases,
		/**
		 * The route ladder for the two non-stream ops, spoken the way the app's own
		 * request object is shaped (`{op, sessionId, subscriptionId, visible, canNotify}`).
		 */
		requestDesktop: (request) => {
			if (request.op === "sessions.watch") {
				const holder = held.get(request.subscriptionId);
				if (holder !== request.sessionId) {
					refusedLeases.push({
						sessionId: request.sessionId,
						subscriptionId: request.subscriptionId ?? null,
						heldNow: [...held.entries()],
					});
					return {
						status: 404,
						body: {
							detail:
								"Requested session, profile, team or subscription not found",
						},
					};
				}
				/*
				 * RESIDENCY: a live visible lease on a cold session is what starts the
				 * runtime (`DesktopSessionBridge.refresh_watch`), so the roster below
				 * reports the session as live from here on.
				 */
				acceptedLeases.push({
					sessionId: request.sessionId,
					subscriptionId: request.subscriptionId,
				});
				started.add(request.sessionId);
				return { status: 200, body: { result: { lease_seconds: 45 } } };
			}
			if (request.op === "sessions.warm") {
				started.add(request.sessionId);
				return { status: 200, body: { result: { state: "warming" } } };
			}
			return { status: 200, body: { result: {} } };
		},
		close: () =>
			new Promise((resolve) => {
				for (const socket of sockets) socket.destroy();
				sockets.clear();
				server.close(() => resolve(undefined));
			}),
	};
};

const driveAppOwnedUpdate = async ({
	published = "0.56.8",
	target = "0.56.12",
	installVersion = target,
	replaced = true,
	/*
	 * THE REAL INSTALLER, DRIVEN (review R6). Null means the callback is stubbed
	 * (`calls.installCallbacks`), which is what every ordering case wants. A value
	 * means `installEnvironmentInto` itself runs, driven by a SYNTHETIC INTERPRETER
	 * written into this case's own scratch directory: it answers the `-m venv` step
	 * the way a working interpreter would (creating the environment's interpreter as
	 * a copy of itself) and then fails the pip step with the text below - which is
	 * {"pipFailure": "..."}. That is the only way to drive the branch a full disk is
	 * actually met on without a real pip and a real disk, and it is why the case no
	 * longer hands the service a hand-written error string: the string this asserts
	 * against is captured by the shipped code from a child it started.
	 */
	installerPilot = null,
	servingBeforeRestart = null,
	servingAfterRestart = installVersion,
	restartOk = true,
	healthy = true,
	freeBytes = Number.MAX_SAFE_INTEGER,
	installRuns = 1,
	/*
	 * The launch mode, and whether the install SERVING this app is the app's own.
	 *
	 * They are separate on purpose, and the pair is the operator's own machine: a
	 * GLOBAL_INSTALL launch whose daemon runs from the app's managed environment
	 * (#318's `serving.appOwned`). The routing case below asserts the two together.
	 */
	startupMode = "APP_BUNDLED_VENV",
	servingAppOwned = false,
	/*
	 * Whether this launch ADOPTED the daemon rather than starting it - the other half
	 * of `backendIsAppOwned()`, and the reading review R8 is about: an adopted daemon
	 * serving the app's own environment is an install the app may MOVE but not one it
	 * may RESTART.
	 */
	externalBackend = false,
	/*
	 * THE FLEET THE GATE SEES, on the arm where the app is the only thing that can
	 * wait for the move to be safe. `workState` is the app's own busy reading
	 * (`servingWorkState`), and a LIST is consumed one entry per read - which is how
	 * "busy, then idle" drives a drain that had to wait. `fleet` is the roster the
	 * refusal names and the re-engage compares, taken before the move; `fleetAfter`
	 * is the roster read AFTER it, and its default is `fleet` (nothing moved).
	 */
	workState = "idle",
	fleet = [],
	fleetAfter = null,
	/*
	 * The drain's own bounds, in milliseconds. The shipped ones are ten minutes and
	 * five seconds (`fleet-drain.ts`), which no case should pay, so the fixture
	 * drives them at the smallest values that still exercise a WAIT rather than a
	 * single read.
	 */
	drainBudgetMs = 5,
	drainPollMs = 1,
	/*
	 * HOW LONG THE PRE-SWAP FLEET MUST HOLD STILL before the re-engage puts back
	 * what left (`fleetRetireSettleMs`). The shipped value is the harness's own
	 * convergence stride - 30 s - and no case here should pay it; the rule itself is
	 * pinned on a virtual clock in `scripts/update-fleet-drain.test.mjs`.
	 */
	retireSettleMs = 5,
	retireGraceMs = 25,
	/*
	 * The engage's three bounds (`sessionEngageOpenMs` / `BeatMs` / `HoldMs`). Small
	 * rather than zero, so a case still exercises a wait rather than a single check -
	 * and generous enough that a loaded box (this suite runs under a concurrency cap
	 * on a shared machine) cannot turn a socket's own scheduling into a failure.
	 */
	engageOpenMs = 2_000,
	engageBeatMs = 50,
	engageHoldMs = 2_000,
	/*
	 * The roster as it reads BETWEEN THE PUBLISH AND THE RESTART, when a case needs the
	 * publish's own retirement wave to be visible before the drain (review round 2,
	 * R2-M3). Null is the default: nothing retires while the app waits, so the pre-restart
	 * read is the only before-side and the older cases are unchanged.
	 */
	fleetAfterPublish = null,
	/*
	 * A daemon that will not open the session's events stream, which is the arm a caller
	 * with no subscription id can meet without the caller being wrong (review round 2,
	 * R2-M1).
	 */
	refuseStreams = false,
	/*
	 * A LEDGER THAT ALREADY CARRIES AN EARLIER LEG'S WAIT, and the press that owns it. A
	 * rebuild press drains twice under ONE budget (round 1, m2), so the second leg starts
	 * with `spentMs > 0` and its own `outcome.waitedMs` near zero - which is the shape the
	 * refusal's number has to survive (review round 2, R2-m1 = design D9). Driving the
	 * rebuild route itself needs a checkout on PATH; this is its ledger, which is the
	 * only part of it the refusal reads.
	 */
	presetDrainSpentMs = 0,
	holdTakenElsewhere = false,
} = {}) => {
	const home = mkdtempSync(join(tmpdir(), "lo-app-owned-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-app-owned-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	/*
	 * The unpackaged side of the packaged/dev split, which `managedPythonOptions`
	 * reads for the interpreter seed's location: packaged, it resolves
	 * `process.resourcesPath`, and that global does not exist outside Electron - so
	 * the attempt would fail on a path read before it reached any assertion. The
	 * fixture's own lever states which side of that decision the case is on.
	 */
	const originalPackaged = globalThis.__loTestAppIsPackaged;
	globalThis.__loTestAppIsPackaged = false;
	const order = [];
	const sent = [];
	let fleetReads = 0;
	/** Whether the publish has happened yet, for the roster the reads answer with. */
	let publishedOnce = false;
	/** How many roster reads have happened since the publish, for the shape above. */
	let postPublishReads = 0;
	/*
	 * The fake desktop daemon and the app's own relay, assigned inside the `try` below
	 * once the service module is loaded (the relay is the shipped class, so it needs
	 * that import). Null here so a teardown that runs before they exist is a no-op.
	 */
	let daemon = null;
	let relay = null;
	/**
	 * Whether the manager's update-in-flight flag is up right now.
	 *
	 * Held by the fixture rather than assumed, for the reason `calls.autoUpdating`
	 * gives below: the service both raises and reads it, so a constant would hide
	 * exactly the window this records.
	 */
	let autoUpdating = false;
	const calls = {
		installers: [],
		installCallbacks: 0,
		stops: 0,
		restarts: 0,
		desktop: [],
		/*
		 * THE PRESS'S HOLD, recorded rather than dropped (review round 1, m1).
		 * `updateBackend` raises `isAutoUpdating` for the WHOLE press now - it is what
		 * the periodic drift check reads as its `update-in-flight` hold - and it used
		 * to be raised around `backend.restart()` alone, which left a ten-minute drain
		 * with no hold at all. `holdAtFleetRead` is that flag as it stood at each read
		 * the gate takes, which is the fact the case is about.
		 */
		autoUpdating: [],
		holdAtFleetRead: [],
	};
	// The synthetic interpreter, when this case drives the real installer: it is the
	// fixture's `python` argument, so the shipped `installEnvironmentInto` runs the
	// `venv` and pip steps itself (review R6).
	const pilot = installerPilot ? writeInstallerPilot(installerPilot) : null;
	if (pilot) globalThis.__loManagedPilot = pilot.interpreter;
	const extraScratch = pilot ? [pilot.dir] : [];
	globalThis.__loManagedRoot = join(userData, "managed-python");
	globalThis.__loManagedPublished = () => published;
	globalThis.__loManagedUpdate = async ({ install, decision }) => {
		order.push("publish");
		/*
		 * THE PUBLISH IS WHAT RETIRES A FLEET MEMBER ON THE RELEASE PATH: the new
		 * generation is on disk, so an idle runtime notices the build change on its own
		 * check and leaves - which is the wave the case for review round 2's R2-M3 waits
		 * through the drain. Recorded here because the roster switch below is keyed on it.
		 */
		publishedOnce = true;
		for (let index = 0; index < installRuns; index++) {
			calls.installers.push(decision.target);
			const landed = await install(
				`${globalThis.__loManagedRoot}/environments/g${index}`,
				globalThis.__loManagedPilot ?? "/synthetic/python",
			);
			/*
			 * THE MODULE'S OWN CONVERSION, reproduced because this fixture stands AT
			 * that boundary: the real `publishGeneration` turns the installer's `false`
			 * into this fixed sentence and throws it. A fixture that ignored the
			 * boolean - as this one did until review round 3 - let the attempt complete
			 * as a success over an installer that had failed, which is precisely the
			 * R6 defect: what the reader is told about a failure has to be asserted
			 * through the shape the module actually produces, or the case proves the
			 * wiring and not the behaviour.
			 */
			if (landed === false)
				throw new Error(
					"Backend preparation did not complete. Your previous environment and data were preserved.",
				);
		}
		return {
			selection: {
				format: "local-operator-managed-python",
				runtimeId: "a".repeat(64),
				runtime: `${globalThis.__loManagedRoot}/runtimes/a`,
				venv: `${globalThis.__loManagedRoot}/environments/g${installRuns - 1}`,
				backendVersion: installVersion,
			},
			replaced,
			previous: null,
		};
	};
	const { service, serviceDir } = await loadUpdateServiceModule({
		managedPython: managedPythonFixture(
			join(process.cwd(), "src/main/backend/managed-python.ts"),
		),
	});
	const updateService = new service.UpdateService(
		{
			isDestroyed: () => false,
			webContents: {
				send: (channel, payload) => sent.push({ channel, payload }),
				isDestroyed: () => false,
			},
		},
		{
			getStartupMode: () => service.LocalOperatorStartupMode[startupMode],
			getBackendUrl: () => "http://127.0.0.1:9",
			/*
			 * The launch's own answer about ADOPTION, which is still read on this path:
			 * `update-service.ts` declines to bounce a daemon the launch attached to
			 * instead of spawning, and it is the reading review R8 found the completions
			 * contradicting.
			 */
			isUsingExternalBackend: () => externalBackend,
			/*
			 * THE OWNERSHIP READING `backendIsAppOwned()` NOW ASKS FOR, and it is a
			 * second stub rather than a rename because the two answers are not the same
			 * question. #321 (review round 1, R1) replaced that method's
			 * `!isUsingExternalBackend()` body with the drift repair's own rule -
			 * `backend-service.ts`'s `servingInstall().owned`, "can THIS app run stop the
			 * process now" - so that the notice and the repair answer one way about one
			 * daemon. The fixture's two shapes cover both arms of it exactly: the press
			 * on a daemon this launch spawned is the app's to restart (`owned: true`),
			 * and the press on one it ADOPTED is not (`owned: false`), which is
			 * `servingInstallIsAppOwned`'s answer for a process this run does not hold
			 * and the reason `externalBackend` stays the lever these cases drive.
			 */
			servingInstall: () => ({
				readings: {
					bootVersion: servingBeforeRestart,
					prefix: `${globalThis.__loManagedRoot}/environments/g0`,
					installKind: "pip",
					startedByApp: externalBackend,
				},
				owned: {
					owned: !externalBackend,
					because: externalBackend
						? "the process is not one this app run started and this app can only stop the generation it holds"
						: "this app process started it and still holds the process",
					startedByEarlierAppRun: externalBackend,
				},
			}),
			setAutoUpdating: (value) => {
				autoUpdating = value;
				calls.autoUpdating.push(value);
			},
			checkIsAutoUpdating: () =>
				holdTakenElsewhere === true ? true : autoUpdating,
			/*
			 * The app's existing busy reading, and the ROSTER beside it - the two the fleet
			 * gate waits on (`drainFleetForUpdate`). A `workState` list is the machine that
			 * was busy when the press arrived and idle a poll later; absent defaults keep
			 * every older case in this file exactly where it was, because an idle first read
			 * is the drain that costs one round trip and changes nothing.
			 */
			servingWorkState: async () => {
				calls.holdAtFleetRead.push(autoUpdating);
				return Array.isArray(workState)
					? (workState.shift() ?? "idle")
					: workState;
			},
			/*
			 * The roster is read TWICE before the move now, and the switch is on the move
			 * itself rather than on a read count: the fleet gate reads it once for its own
			 * drain and once for the SNAPSHOT, which is taken at the moment of the restart
			 * (review round 1, M2) rather than before the install. Everything before
			 * `restart()` is therefore the machine as it was, and everything after it is
			 * what the move left behind. `fleetAfter === null` is the default - a machine
			 * where nothing moved - so every read answers the same roster. The rows are the
			 * WIRE's own (`id`/`name`/`kind`/`live_state`) and the shipped parse is what
			 * converts them, so a case cannot assert against a shape the route does not
			 * send.
			 */
			servingSessionFleet: async () => {
				fleetReads += 1;
				/*
				 * THREE SHAPES, in the order the press reads them: the drain's own read (the
				 * machine as it arrived), the PUBLISH-SIDE SNAPSHOT (what the publish has
				 * already retired), and the PRE-RESTART snapshot (what is left at the bounce).
				 * `fleetAfterPublish` is the middle one and is consumed once, because a case
				 * that made both post-publish reads answer it would describe a machine where
				 * nothing was left to displace at all - which is the opposite of what the
				 * case is about. `fleet` is every OTHER read, so the shape a case chooses for
				 * it decides which read carries the loss: the retirement case hands b2 to
				 * `fleetAfterPublish` alone (`fleet: []`), which is what makes the before-side
				 * exist only through the union (review round 3, R3-M1).
				 */
				const wire =
					fleetAfter === null
						? fleet
						: calls.restarts > 0
							? fleetAfter
							: publishedOnce && fleetAfterPublish !== null
								? ++postPublishReads === 1
									? fleetAfterPublish
									: fleet
								: fleet;
				if (wire === null) return null;
				/*
				 * A RUNTIME THE DAEMON HAS STARTED IS IN THE ROSTER. This is the read the
				 * engage's own verdict is made of (`sessionHasRuntime`), so the fixture has
				 * to answer for the sessions `daemon.started` holds - otherwise the engage
				 * could start a runtime and still read as a miss, and the case would be
				 * asserting the fixture's bookkeeping rather than the app's behaviour.
				 */
				const rows = [...wire];
				/*
				 * `daemon` is stood up after this stub exists (it is created just before the
				 * press, so nothing fallible can leak a listening socket), and the press makes
				 * one roster read before the drain - which is why the guard is here rather
				 * than an assumption that it is up.
				 */
				for (const id of daemon?.started ?? []) {
					if (rows.some((candidate) => candidate.id === id)) continue;
					rows.push({
						id,
						name: `engaged ${id}`,
						kind: "daemon",
						live_state: "idle",
					});
				}
				return service.fleetRosterFromSessions({ result: { sessions: rows } });
			},
			/*
			 * The app's own relay, over real loopback HTTP, so the subscription id the
			 * engage leases is one a LIVE STREAM minted rather than one this process made
			 * up - which is the whole difference between this change and its predecessor.
			 */
			getStreamRelay: () => {
				if (!relay) throw new Error("the fixture's relay is not up yet");
				return relay;
			},
			requestDesktop: async (request) => {
				calls.desktop.push(request);
				/*
				 * EVERY DESKTOP OP GOES THROUGH THE FAKE DAEMON, including the two the engage
				 * uses - which is what makes the lease precondition real: an id no live stream
				 * holds is answered 404 here, exactly as the bridge answers it.
				 */
				if (!daemon) throw new Error("the fixture's daemon is not up yet");
				return daemon.requestDesktop(request);
			},
			stop: async () => {
				calls.stops += 1;
				order.push("stop");
				return true;
			},
			restart: async () => {
				calls.restarts += 1;
				order.push("restart");
				return restartOk;
			},
			start: async () => true,
		},
	);
	const timer = updateService.updateCheckInterval;
	const dispose = () => {
		if (timer) clearInterval(timer);
		for (const name of [
			"__loTestPaths",
			"__loManagedRoot",
			"__loManagedPublished",
			"__loManagedUpdate",
			"__loManagedPilot",
		]) {
			// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
			delete globalThis[name];
		}
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		if (originalPackaged === undefined) delete globalThis.__loTestAppIsPackaged;
		else globalThis.__loTestAppIsPackaged = originalPackaged;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
		/*
		 * The relay first, so its open streams are aborted before the server they are
		 * against is closed, and both before the case returns: a stream left open is a
		 * socket the next case's server would inherit.
		 */
		if (relay) relay.dispose();
		if (daemon) void daemon.close();
		// By literal path, and only for a directory this run made: every teardown here
		// removes a `mkdtemp` root of its own and nothing else.
		for (const dir of extraScratch)
			rmSync(dir, { recursive: true, force: true });
	};
	try {
		updateService.backendUrl = "http://127.0.0.1:9";
		updateService.fleetDrainBudgetMs = drainBudgetMs;
		updateService.fleetDrainPollMs = drainPollMs;
		/*
		 * The retire wait's own window, on the cases that reach the re-engage: the
		 * shipped 30 s stride is the harness's real convergence and no case should pay
		 * it (the rule itself is pinned in `scripts/update-fleet-drain.test.mjs`, on a
		 * virtual clock). Small rather than zero, so a case still exercises a WAIT.
		 */
		updateService.fleetRetireSettleMs = retireSettleMs;
		/*
		 * AND ITS GRACE, which is also a bound a case must not pay: the wait now runs to
		 * the grace whenever the pre-swap runtimes never leave (the idle-gated arm, and the
		 * ordinary one where the wave has not started), so the shipped 60 s would put a
		 * minute on every case that reaches the re-engage.
		 */
		updateService.fleetRetireGraceMs = retireGraceMs;
		/*
		 * THE ENGAGE'S OWN BOUNDS, in milliseconds (review round 2, R2-M1). The shipped
		 * ones hold the session's stream for twenty seconds while the runtime comes up,
		 * which is the right number in production and no case here should pay: the
		 * fixture's daemon starts a runtime on the lease itself, so the wait is over on
		 * the first check.
		 */
		updateService.sessionEngageOpenMs = engageOpenMs;
		updateService.sessionEngageBeatMs = engageBeatMs;
		updateService.sessionEngageHoldMs = engageHoldMs;
		updateService.getLatestPypiVersion = async () => target;
		updateService.freeBytesAt = () => freeBytes;
		updateService.checkBackendHealth = async () => {
			order.push("health");
			return healthy;
		};
		// The reading the restart decision takes BEFORE the restart, and the one the
		// report takes after it - in the order the attempt takes them.
		const serving = [servingBeforeRestart, servingAfterRestart];
		updateService.getInstalledBackendVersion = async () => {
			order.push("read-serving");
			return serving.length > 1 ? serving.shift() : servingAfterRestart;
		};
		updateService.waitForBackendVersion = async () => {
			order.push("wait-version");
			return healthy && restartOk ? servingAfterRestart : null;
		};
		/*
		 * The installer is stubbed for every ordering case - the real one creates an
		 * environment and runs pip - and LEFT ALONE when the case supplied a pilot, so
		 * the shipped branch runs and its own captured output is what the case reads
		 * (review R6).
		 */
		if (!pilot)
			updateService.installEnvironmentInto = async () => {
				calls.installCallbacks += 1;
				order.push("install");
				return true;
			};
		/*
		 * The serving install's own identity, for the arms that resolve it: the
		 * routing case drives a global launch whose daemon runs from the app's
		 * managed environment, so the reading has to say so for the branch to be
		 * reachable at all.
		 */
		updateService.readRunningBackend = async () => ({
			version: servingBeforeRestart,
			prefix: `${globalThis.__loManagedRoot}/environments/g0`,
			installKind: "pip",
		});
		updateService.readServingInstall = () => ({
			prefix: `${globalThis.__loManagedRoot}/environments/g0`,
			version: servingBeforeRestart,
			installKind: "pip",
			appOwned: servingAppOwned,
		});
		/*
		 * THE DAEMON THE RE-ENGAGE ACTUALLY TALKS TO (review round 2, R2-M1), stood up
		 * LAST so no earlier failure can leak a listening socket: `getStreamRelay` is the
		 * app's own relay, and the daemon below is the only place a subscription id can
		 * come from - it is a real loopback HTTP server whose `open` frame the shipped
		 * relay parses.
		 *
		 * ASSIGNED, NOT DECLARED: the manager stub above closes over the `daemon` this
		 * function declares, and a `const` here would be a second binding that stub never
		 * sees - so every desktop op would throw "not up yet" while the fixture looked
		 * wired.
		 */
		daemon = await startFakeDesktopDaemon({ refuseStreams });
		relay = new service.DesktopStreamRelay(daemon.url, "fixture-token");
		/*
		 * THE LEDGER, SET BEFORE THE PRESS TAKES IT. `updateBackend` zeroes
		 * `fleetDrainSpentMs` only when IT takes the update-in-flight flag, so a press whose
		 * flag is already held carries the earlier leg's spend into its own drain - which is
		 * how the rebuild route reaches a restart leg with ~0 left of the budget.
		 */
		updateService.fleetDrainSpentMs = presetDrainSpentMs;
		const result = await updateService.updateBackend(target);
		return { result, sent, calls, order, updateService, daemon, dispose };
	} catch (error) {
		dispose();
		throw error;
	}
};

/** The completion events the renderer would receive, in order. */
const completions = (sent) =>
	sent.filter(({ channel }) => channel === "backend-update-completed");
const phases = (sent) =>
	sent
		.filter(({ channel }) => channel === "backend-update-progress")
		.map(({ payload }) => payload.phase);
const updateErrors = (sent) =>
	sent.filter(({ channel }) => channel === "backend-update-error");

test("an app-owned press publishes first and only then moves the daemon", async () => {
	const driven = await driveAppOwnedUpdate({
		published: "0.56.8",
		target: "0.56.12",
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: "0.56.12",
	});
	try {
		assert.equal(driven.result, true);
		/*
		 * THE ORDER IS THE SAFETY PROPERTY, and it is asserted as an order rather
		 * than as two facts: the publish (with the install inside it) comes before the
		 * restart, and nothing stopped the daemon on the way - which is what lets the
		 * running server keep serving while a new generation lands beside it.
		 */
		assert.deepEqual(
			driven.order.filter((step) => step !== "read-serving"),
			["publish", "install", "restart", "health", "wait-version"],
			JSON.stringify(driven.order),
		);
		assert.equal(
			driven.calls.stops,
			0,
			"nothing may stop the serving daemon before the write",
		);
		assert.deepEqual(
			phases(driven.sent),
			["installing", "restarting"],
			"a press that publishes announces the install it is doing, then the restart",
		);
		const completed = completions(driven.sent);
		assert.equal(completed.length, 1);
		assert.deepEqual(
			{
				...completed[0].payload,
			},
			{
				installVersion: "0.56.12",
				runningVersion: "0.56.12",
				restarted: true,
			},
			"a restart that came back on the new build is the success payload, unchanged",
		);
		assert.deepEqual(updateErrors(driven.sent), []);
	} finally {
		driven.dispose();
	}
});

test("a press with nothing to publish announces the restart, not an install", async () => {
	/*
	 * DESIGN D2, on the one press this panel's own control produces: the install IS
	 * the published release, so `updateManagedPython` returns `replaced: false`. The
	 * phase used to be announced unconditionally, so the panel told the reader
	 * "Installing the new server build ... This can take a minute or two" about work
	 * that cannot happen - and the only work that press does is the restart.
	 */
	const driven = await driveAppOwnedUpdate({
		published: "0.56.12",
		target: "0.56.12",
		installVersion: "0.56.12",
		replaced: false,
		installRuns: 0,
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: "0.56.12",
	});
	try {
		assert.deepEqual(
			phases(driven.sent),
			["restarting"],
			"nothing is installed, so the panel may not say it is",
		);
		assert.equal(driven.calls.installCallbacks, 0);
		assert.equal(driven.calls.restarts, 1, "the restart is the whole press");
	} finally {
		driven.dispose();
	}
});

test("a press that moved nothing and a daemon already on the build does not restart it", async () => {
	/*
	 * REVIEW R3: the restart used to be unconditional, so a press over an
	 * already-current environment terminated a live daemon for no gain - and the
	 * retire contract hands that process's in-process work to a shutdown that
	 * cancels it. The press is still ANSWERED (silence on a press is its own
	 * defect, review R2-3) with the two readings that made the restart pointless,
	 * which the renderer's funnel declines because they agree.
	 */
	const driven = await driveAppOwnedUpdate({
		published: "0.56.12",
		target: "0.56.12",
		installVersion: "0.56.12",
		replaced: false,
		installRuns: 0,
		servingBeforeRestart: "0.56.12",
	});
	try {
		assert.equal(driven.result, true);
		assert.equal(
			driven.calls.restarts,
			0,
			"nothing to move is nothing to restart",
		);
		const completed = completions(driven.sent);
		assert.equal(completed.length, 1, "the press is still answered");
		assert.equal(completed[0].payload.restarted, false);
		assert.equal(completed[0].payload.runningVersion, "0.56.12");
		assert.equal(
			completed[0].payload.serverDidNotComeBack,
			undefined,
			"a server that IS answering is not a server that did not come back",
		);
		assert.deepEqual(phases(driven.sent), ["restarting"]);
	} finally {
		driven.dispose();
	}
});

test("a restart that leaves the server down is reported as that, not as a success", async () => {
	/*
	 * UX U1, from the producer's side: the app performed the restart onto its own
	 * published environment, the health probe after it never answered, and the
	 * payload has to CARRY that - because the renderer's own guard cannot distinguish
	 * "no reading" (silence) from "the server did not come back" (the news), and
	 * reading it as the first is what produced a success toast about a stopped
	 * server.
	 */
	const driven = await driveAppOwnedUpdate({
		published: "0.56.12",
		target: "0.56.12",
		installVersion: "0.56.12",
		replaced: false,
		installRuns: 0,
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: null,
		restartOk: false,
	});
	try {
		assert.equal(driven.result, true);
		const completed = completions(driven.sent);
		assert.equal(completed.length, 1);
		assert.deepEqual(completed[0].payload, {
			installVersion: "0.56.12",
			runningVersion: null,
			restarted: false,
			restartable: true,
			appOwnedEnvironment: true,
			serverDidNotComeBack: true,
		});
		assert.deepEqual(
			updateErrors(driven.sent),
			[],
			"the attempt completed; what it has to say is on the completion",
		);
	} finally {
		driven.dispose();
	}
});

test("a publish whose pip step runs out of disk reaches the reader with the remedy", async () => {
	/*
	 * REVIEW R6, and what this case used to be is the finding. It handed the service a
	 * HAND-WRITTEN error string (`publishThrows`) - an assertion about the wiring one
	 * level above the behaviour, which is how the gap stayed green through round 1:
	 * the string the module actually threw for a mid-install failure was the fixed
	 * "Backend preparation did not complete..." sentence, which no entry in
	 * `SETUP_FAILURE_CAUSES` matches, so the disk-space remedy this product already
	 * owns was UNREACHABLE for the failure it was written for.
	 *
	 * Now the publish fails where a full disk actually stops it: the real
	 * `installEnvironmentInto` runs, its `python -m venv` step succeeds against the
	 * synthetic interpreter below, and its pip step (the ~100 MB environment plus the
	 * wheel closure) fails with the machine's own words. The assertions are on the
	 * message the READER receives, so they fail the moment that output stops travelling
	 * (shown red by returning `false` from the installer again, which is exactly the
	 * shipped shape this round removes).
	 */
	const driven = await driveAppOwnedUpdate({
		published: "0.56.8",
		target: "0.56.12",
		installerPilot: {
			pipFailure:
				"ERROR: Could not install packages due to an OSError: [Errno 28] No space left on device",
		},
	});
	try {
		assert.equal(driven.result, false);
		const errors = updateErrors(driven.sent);
		assert.equal(errors.length, 1);
		const [sentence, ...rest] = errors[0].payload.message.split("\n\n");
		assert.match(
			sentence,
			/did not install, so the environment serving this app was left as it was/,
		);
		assert.match(
			sentence,
			/ran out of disk space while setting up the backend\. Free some space and retry\./,
			sentence,
		);
		// The machine's own words, in their OWN block: `splitInstallerOutput` renders the
		// first blank line as the boundary between the app's sentence and the monospace
		// output a support conversation needs.
		assert.match(rest.join("\n\n"), /No space left on device/);
		assert.equal(
			driven.calls.restarts,
			0,
			"a failure to publish may not move the daemon",
		);
		assert.deepEqual(completions(driven.sent), []);
	} finally {
		driven.dispose();
	}
});

test("a publish whose venv step fails carries the child's output too", async () => {
	/*
	 * The other half of R6's chain, and the reason it is a pair rather than one case:
	 * BOTH failing steps used to `return false` and were converted, one level down,
	 * into a sentence no cause table can read. A reader whose disk filled while the
	 * environment was being created got the same remedy-less message as one whose pip
	 * step failed, so each arm is driven rather than one standing in for both.
	 */
	const driven = await driveAppOwnedUpdate({
		published: "0.56.8",
		target: "0.56.12",
		installerPilot: {
			venvFailure:
				"python3: could not create /tmp/venv: [Errno 28] No space left on device",
		},
	});
	try {
		assert.equal(driven.result, false);
		const errors = updateErrors(driven.sent);
		assert.equal(errors.length, 1);
		assert.match(
			errors[0].payload.message,
			/ran out of disk space while setting up the backend\. Free some space and retry\./,
			errors[0].payload.message,
		);
		assert.match(
			errors[0].payload.message,
			/No space left on device/,
			"and the child's own words travel with it",
		);
		assert.equal(driven.calls.restarts, 0);
		assert.deepEqual(completions(driven.sent), []);
	} finally {
		driven.dispose();
	}
});

test("a completion on an adopted daemon reads the ownership of the daemon it did not start", async () => {
	/*
	 * REVIEW R8, on the arm where the two readings inside one launch disagreed. An
	 * adopted daemon (`EXISTING_SERVER`, so `backendIsAppOwned()` is FALSE) that serves
	 * from the app's own environment IS an install this app may move - `appOwnsInstall`
	 * says so, and the press is routed to the publish path for exactly that reason. The
	 * three app-owned completions nonetheless asserted `restartable: true`, so the
	 * renderer offered "Restart the server" on a launch whose own answer about who owns
	 * the daemon is no: the "action that cannot act" class design D5 named, re-created
	 * from a hardcoded payload field rather than from the ownership predicate.
	 *
	 * This is the simplest of those three arms to reach - the press that published
	 * nothing because the published release is already the install - and the assertion
	 * is on the payload the renderer's control is gated by, so it fails while the field
	 * is hardcoded.
	 */
	const driven = await driveAppOwnedUpdate({
		startupMode: "EXISTING_SERVER",
		servingAppOwned: true,
		externalBackend: true,
		published: "0.56.12",
		target: "0.56.12",
		replaced: false,
		servingBeforeRestart: "0.56.12",
	});
	try {
		assert.equal(driven.result, true);
		const completed = completions(driven.sent);
		assert.equal(completed.length, 1);
		assert.equal(
			completed[0].payload.restartable,
			false,
			`an adopted daemon is not the app's to restart: ${JSON.stringify(completed[0].payload)}`,
		);
		assert.equal(
			completed[0].payload.appOwnedEnvironment,
			true,
			"while the ENVIRONMENT it serves from is still the app's own - the two readings differ on purpose",
		);
	} finally {
		driven.dispose();
	}
});

test("a publish without room to write is refused before it spends anything", async () => {
	/*
	 * REVIEW R2's precondition: measured, a publish holds a second environment plus
	 * the runtime copy and re-downloads the wheel closure into TMPDIR on the same
	 * volume (`--no-cache-dir`), so the app can name the remedy before it starts
	 * rather than after a half-written tree. Nothing is attempted, so nothing is
	 * reported as attempted either.
	 */
	const driven = await driveAppOwnedUpdate({
		published: "0.56.8",
		target: "0.56.12",
		freeBytes: 40 * 1024 * 1024,
	});
	try {
		assert.equal(driven.result, false);
		const errors = updateErrors(driven.sent);
		assert.equal(errors.length, 1);
		assert.match(
			errors[0].payload.message,
			/needs about 450 MB of free space on this disk, and 40 MB is free/,
			errors[0].payload.message,
		);
		assert.deepEqual(driven.order, [], "nothing may be attempted");
		assert.deepEqual(
			phases(driven.sent),
			[],
			"a refusal is not a phase of an attempt that never started",
		);
	} finally {
		driven.dispose();
	}
});

test("a global launch serving from the app's own environment is routed to the publish path", async () => {
	/*
	 * THE CONVERGENCE THIS FOLD FORCED. #318 landed on `main` while this branch was
	 * in review, and it is the change that answers WHO OWNS the install serving this
	 * app: for a daemon running out of the app's managed environment the plan says
	 * `canManageUpdate: false`, correctly - no package manager owns that tree - which
	 * would leave the app-owned publish path UNREACHABLE on the exact machine this
	 * change was written for (the operator's global launch, whose daemon serves from
	 * the app's own environment). The startup mode there is `GLOBAL_INSTALL`, so only
	 * the SERVING reading can route it.
	 *
	 * Both sides are asserted, because the routing is a gate and a gate that opens
	 * for everything is not one: the same fixture with `appOwned: false` must NOT
	 * reach the publish path.
	 */
	const routed = await driveAppOwnedUpdate({
		startupMode: "GLOBAL_INSTALL",
		servingAppOwned: true,
		published: "0.56.8",
		target: "0.56.12",
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: "0.56.12",
	});
	try {
		assert.equal(routed.result, true);
		assert.ok(
			routed.order.includes("publish"),
			`an app-owned serving install must be published, not told to use pip: ${JSON.stringify(routed.order)}`,
		);
		assert.equal(routed.calls.restarts, 1);
		const completed = completions(routed.sent);
		assert.equal(completed.length, 1);
		assert.deepEqual(
			{
				installVersion: completed[0].payload.installVersion,
				runningVersion: completed[0].payload.runningVersion,
				restarted: completed[0].payload.restarted,
			},
			{ installVersion: "0.56.12", runningVersion: "0.56.12", restarted: true },
			"and the daemon it restarted serves the published build",
		);
		assert.deepEqual(
			routed.sent.filter(
				({ channel }) => channel === "backend-update-manual-required",
			),
			[],
			"and it must not land on the by-hand panel, which is the state that can only describe",
		);
	} finally {
		routed.dispose();
	}

	const foreign = await driveAppOwnedUpdate({
		startupMode: "GLOBAL_INSTALL",
		servingAppOwned: false,
		published: "0.56.8",
		target: "0.56.12",
		servingBeforeRestart: "0.56.8",
	});
	try {
		assert.equal(
			foreign.order.includes("publish"),
			false,
			"a global install that is NOT the app's own must not be published by this path",
		);
	} finally {
		foreign.dispose();
	}
});

test("the app-owned offer states the restart and its cost, not the filler twice", async () => {
	/*
	 * UX U2's producer half. The app-owned plan's remedy used to be "Updating the
	 * server will improve AI functionality." - the same thing the panel's static line
	 * already says, in a shorter length, which is what made the offer read as a
	 * rendering fault and left the one sentence the reader needs (what the press does
	 * to their server) unsaid.
	 */
	const home = mkdtempSync(join(tmpdir(), "lo-plan-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-plan-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	const { service, serviceDir } = await loadUpdateServiceModule();
	/*
	 * The constructor arms its own check interval, and a fixture that leaves it
	 * armed never lets the process exit - the same teardown every other case in this
	 * file does, and the one this case lacked until it was caught.
	 */
	let interval = null;
	try {
		const updateService = new service.UpdateService(
			{
				isDestroyed: () => false,
				webContents: { send: () => {}, isDestroyed: () => false },
			},
			{
				getStartupMode: () => service.LocalOperatorStartupMode.APP_BUNDLED_VENV,
				getBackendUrl: () => "http://127.0.0.1:9",
				isUsingExternalBackend: () => false,
				setAutoUpdating: () => {},
			},
		);
		interval = updateService.updateCheckInterval;
		const plan = await updateService.resolveBackendUpdatePlan(
			service.LocalOperatorStartupMode.APP_BUNDLED_VENV,
			{
				prefix: `${userData}/managed-python/packaged/environments/synthetic`,
				version: null,
				installKind: "pip",
				appOwned: false,
			},
		);
		assert.doesNotMatch(
			plan.remedy,
			/improve AI functionality/i,
			"the benefit sentence is already on the panel above it",
		);
		assert.match(
			plan.remedy,
			/publishes the new build beside the one the server is using, waits for the turns already running on this machine to finish/,
			plan.remedy,
		);
		/*
		 * AND IT MAY NOT PROMISE A DROPPED TURN any more: this arm's whole press now
		 * drains the fleet first, so the sentence states that nothing in flight is
		 * cut off rather than admitting what it destroys.
		 */
		assert.doesNotMatch(plan.remedy, /turn that is in flight is dropped/);
		assert.equal(plan.canManageUpdate, true);
	} finally {
		if (interval) clearInterval(interval);
		// biome-ignore lint/performance/noDelete: teardown of a fixture global; every reader uses `?.`/`??`/truthiness, and ABSENT is what "no override for this case" means - `= undefined` would leave the property present.
		delete globalThis.__loTestPaths;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
});

/**
 * THE SERVER-UPDATE FAILURE SENTENCE IS THE APP'S OWN COPY, AND IT ARRIVES VERBATIM.
 *
 * WHY THIS CASE EXISTS. The panel used to run the composed sentence through the copy
 * classifier, whose only lever is a length: `AUTHORED_SENTENCE_MAX_LENGTH = 400` reads
 * anything longer as a machine dump and substitutes the check stage's sentence. The
 * composed payload measured 401, 467 and 481-483 characters on the three routes, so two
 * of them showed "The update check could not finish" under a heading saying the update
 * did not finish, and a cost clause that a whole review round was spent adding never
 * reached a reader. Nothing in the suite failed, because the classifier's rule was
 * working exactly as written - the defect was the rule's reach, and the guard has to be
 * about the promise instead: every route's sentence reaches the panel unchanged, it is
 * inside a budget a person would read, and the fixtures the frames are shot from are
 * strings this producer can actually emit (reviewer M1 = UX U1 = QA Q-1/Q-2, round 4).
 */
test("every server-update failure sentence reaches the panel verbatim, and the fixtures are producible", async () => {
	const bundleOf = async (entry) => {
		const built = await build({
			stdin: {
				contents: `export * from "${entry}";`,
				resolveDir: process.cwd(),
			},
			bundle: true,
			format: "esm",
			platform: "node",
			write: false,
		});
		return import(
			`data:text/javascript;base64,${Buffer.from(
				built.outputFiles[0].text,
			).toString("base64")}`
		);
	};
	const producer = await bundleOf("./src/main/server-update-copy");
	const panel = await bundleOf(
		"./src/renderer/src/shared/utils/update-error-copy",
	);
	const stories = readFileSync(
		join(
			process.cwd(),
			"src/renderer/src/shared/components/common/update-notification.stories.tsx",
		),
		"utf8",
	);
	const routes = [
		{
			name: "release",
			input: {
				rebuildRoute: false,
				ran: true,
				exitCode: 1,
				groupSurvived: false,
				diagnosis: "error: no matching distribution found for local-operator\n",
				target: "0.56.11",
				after: "0.56.10",
				before: "0.56.10",
				updateCommand: "lop update",
			},
		},
		{
			name: "rebuild-refusal",
			fixture: "SOURCE_BUILD_REFUSAL_SENTENCE",
			input: {
				rebuildRoute: true,
				ran: true,
				exitCode: 1,
				groupSurvived: false,
				diagnosis:
					"lop-update: REFUSING to release a stale ref.\nlocal  main = 2a0b473\n",
				target: "0.56.11",
				after: "0.56.10",
				before: "0.56.10",
				updateCommand: "lop-update",
			},
		},
		{
			name: "orphan",
			fixture: "ORPHANED_UPDATER_SENTENCE",
			input: {
				rebuildRoute: false,
				ran: false,
				exitCode: null,
				groupSurvived: true,
				diagnosis: "installer exited 127\n",
				target: "0.56.11",
				after: "0.56.10",
				before: "0.56.10",
				updateCommand: "lop update",
			},
		},
		{
			/*
			 * THE WORST ROUTE THE PRODUCER CAN REACH, and the one the previous version of
			 * this case never composed: a stopped rebuild, which carries every clause at
			 * once - the headline, the stopped-updater sentence, the stale-ref remedy, the
			 * output pointer and the escape hatch. It measured 386 characters against the
			 * classifier's 400, fourteen of luck rather than a design (review round 5, M1).
			 */
			name: "rebuild-stopped-worst-case",
			input: {
				rebuildRoute: true,
				ran: true,
				exitCode: 1,
				groupSurvived: true,
				diagnosis:
					"lop-update: REFUSING to release a stale ref.\nlocal  main = 2a0b473\n",
				target: "0.56.11-rc.1+build.20260918",
				after: "0.56.10-rc.1+build.20260917",
				before: "0.56.10-rc.1+build.20260917",
				updateCommand: "lop-update",
			},
		},
	];

	for (const route of routes) {
		const sentence = producer.serverUpdateFailureSentence(route.input);
		/*
		 * THE REAL PATH, not a pass-through. An earlier version of this case asserted
		 * `serverUpdateFailureCopy(sentence) === sentence` against a function that returns
		 * its input, so it could not fail - and it did not: the sentence was still being
		 * deleted on two other surfaces by the classifier it was supposed to be protected
		 * from (review round 5, M1). This asserts the phase-aware function the surfaces now
		 * call, and the second half proves the assertion CAN fail.
		 */
		assert.equal(
			panel.serverUpdateFailureReason({ message: sentence, phase: "update" }),
			sentence,
			`${route.name}: an attempt's report must reach the surface verbatim`,
		);
		assert.ok(
			sentence.length < 400,
			`${route.name}: the composed sentence is ${sentence.length} characters, over the copy budget`,
		);
		if (route.fixture) {
			assert.ok(
				stories.includes(sentence),
				`${route.fixture} is not the string the producer composes - re-shoot from a producible value`,
			);
		}
	}
	/*
	 * AND THE GUARD IS NOT VACUOUS. The same function classifies a CHECK's report, whose
	 * text is written around a caught value: a long machine string must come back changed,
	 * or this whole case would pass on a function that does nothing.
	 */
	const machine =
		"Error: getaddrinfo ENOTFOUND pypi.org while reading the version during a check, and the retry did not help either, so the check could not finish this time";
	assert.notEqual(
		panel.serverUpdateFailureReason({ message: machine, phase: "check" }),
		machine,
		"the classifier must still classify a check's report - a guard that cannot fail guards nothing",
	);
	// And a pass-through that ignored the phase would trip this instead.
	assert.equal(
		panel.serverUpdateFailureReason({ message: machine, phase: "update" }),
		machine,
	);
});

/**
 * ONE IDENTITY FOR ONE PRESS, asserted in both directions.
 *
 * WHY THIS CASE EXISTS. The fold that moved the CHECK onto the serving install's identity
 * (`/health` names the root) left the PRESS re-deciding from the shim, so on a machine where
 * the two differ the panel described one install and the press moved another: an offer
 * promising the checkout rebuild and its half-hour allowance while the press ran the entry
 * point with its 900 s budget, and the inverse - "a minute or two" plus a restart offered
 * while the press started a 1800 s in-place rebuild (review round 5, Q-1 = reviewer M2).
 *
 * WHAT MAKES IT ASSERTABLE. The tool the press reaches for is the observable: `command.path`
 * to `runGlobalUpdate`. A serving install with its own console script must be the path taken
 * when `/health` names that root; the shim's resolution is the path taken when it names none.
 * The route and its budget follow the same identity, so they are asserted too whenever the
 * machine has `lop-update` to classify the serving root as a source build against - the
 * conditional half is stated rather than hidden, because CI has no `lop-update` and a case
 * that silently skipped a direction would be the vacuity this round is about.
 */
test("the press acts on the install the panel described, in both directions", async () => {
	/*
	 * A synthetic serving install: a real directory, a real console script and a real
	 * `.lop-source`. Nothing here is installed or executed - the fixture stubs the runner -
	 * but every path the service reads exists, which is what makes the identity resolution
	 * take its real branch.
	 */
	const servingRoot = mkdtempSync(join(tmpdir(), "lo-serving-install-"));
	mkdirSync(join(servingRoot, "bin"), { recursive: true });
	const servingScript = join(servingRoot, "bin", "local-operator");
	writeFileSync(
		servingScript,
		'#!/bin/sh\nexec python -m local_operator "$@"\n',
		{
			mode: 0o755,
		},
	);
	/*
	 * The marker's real shape, one line of whitespace-separated tokens: the sha first, the
	 * ref second - what `lop-update` writes and what the plan parses. Getting it wrong here
	 * is how a synthetic world stops classifying as a source build, which is the state this
	 * fixture has to reach to pose the question at all.
	 */
	writeFileSync(
		join(servingRoot, ".lop-source"),
		"2a0b4730f1e2d3c4b5a69788796a5b4c3d2e1f00 main\n",
	);

	const seam = await driveGlobalUpdate({ servingPrefix: servingRoot });
	try {
		await seam.updateService.updateBackend("0.56.0");
		// The serving install's own front end, not the shim's: the press moved the tree the
		// panel described.
		assert.equal(seam.calls.installers[0], servingScript);
		assert.equal(seam.calls.installers.length, 1);
	} finally {
		seam.dispose();
	}

	const control = await driveGlobalUpdate({ servingPrefix: null });
	try {
		await control.updateService.updateBackend("0.56.0");
		// The server names no root, so the shim's resolution stands - which is what every
		// other case in this file declares, and what the seam is measured against.
		assert.equal(control.calls.installers[0], "/synthetic/bin/local-operator");
	} finally {
		control.dispose();
	}

	/*
	 * AND THE ROUTE FOLLOWS THE SAME SUBJECT BY CONSTRUCTION. `resolveGlobalInstallPlan` is
	 * given the identity asserted above, so the route and its budget are the plan's own
	 * contract for that install - covered over synthetic installs in
	 * `update-global-install.test.mjs`, which is where a `.lop-source`, a dist-info and a
	 * venv can be built exactly. An earlier draft of this case tried to assert the rebuild
	 * route here by pointing at a synthetic root with only a console script, which cannot
	 * classify as a source build; a conditional assertion on the machine's `lop-update`
	 * would have looked like a second direction while testing nothing, which is the vacuity
	 * this round is about. The two directions this case CAN pose - serving root vs shim -
	 * are both asserted above.
	 */
	rmSync(servingRoot, { recursive: true, force: true });
});

/**
 * THE VERDICT FOLLOWS THE INSTALL THE PRESS RAN, asserted in both directions.
 *
 * WHY THE STUB HAD TO GO. Every other case here scripts `readGlobalInstallVersion`, so the
 * press's evidence answers whatever the case declares and the question "which install did the
 * verdict read?" cannot be posed at all. Round 5 moved the COMMAND onto the serving install
 * and left the EVIDENCE on the shim; the suite could not see it, and two streams found it by
 * driving a synthetic host by hand (review round 6, M1 = QA Q-1). This case builds two real
 * installs on disk and lets the SHIPPED reads run.
 *
 * THREE DIRECTIONS, because two of them are the interesting ones:
 *   - the installer moves the install it ran  -> completed, no error;
 *   - nothing moves                            -> an error, never a success;
 *   - the SHIM moves and the install that ran does not -> an error, which is the shape a
 *     verdict read from the wrong tree turns into a false success.
 */
test("the verdict follows the install the press ran, in both directions", async () => {
	const run = async ({ shimRoot, servingRoot, moveShim, moveServing }) => {
		makeInstall(shimRoot, "0.55.10");
		makeInstall(servingRoot, "0.55.10");
		try {
			const drive = await driveGlobalUpdate({
				servingPrefix: servingRoot,
				shimPath: join(shimRoot, "bin", "local-operator"),
				realEvidenceReads: true,
				/*
				 * The daemon the app restarts reports the version the install now holds, which
				 * is what the post-restart poll waits for: this case is about which install the
				 * VERDICT read, and a daemon stuck on the old build would fail for an unrelated
				 * reason and hide the answer.
				 */
				daemonReports: moveServing ? "0.56.0" : "0.55.10",
				runGate: () => {
					if (moveServing) moveInstall(servingRoot, "0.55.10", "0.56.0");
					if (moveShim) moveInstall(shimRoot, "0.55.10", "0.56.0");
				},
			});
			try {
				const returned = await drive.updateService.updateBackend("0.56.0");
				return {
					returned,
					completed: backendCompletion(drive.sent),
					errors: backendErrors(drive.sent).length,
					channels: drive.sent.map(
						({ channel, payload }) => `${channel}:${payload?.phase ?? ""}`,
					),
					errorMessages: backendErrors(drive.sent).map(({ payload }) =>
						payload.message?.slice(0, 160),
					),
					dispose: drive.dispose,
				};
			} catch (error) {
				drive.dispose();
				throw error;
			}
		} finally {
			rmSync(shimRoot, { recursive: true, force: true });
			rmSync(servingRoot, { recursive: true, force: true });
		}
	};

	// The installer reached the serving install and moved it: that is a landed update.
	const landed = await run({
		shimRoot: mkdtempSync(join(tmpdir(), "lo-two-install-shim-")),
		servingRoot: mkdtempSync(join(tmpdir(), "lo-two-install-serving-")),
		moveServing: true,
	});
	try {
		assert.ok(
			landed.completed,
			`a landed update must be reported as completed (returned ${landed.returned}; channels ${JSON.stringify(landed.channels)}; errors ${JSON.stringify(landed.errorMessages)})`,
		);
		assert.equal(landed.errors, 0);
	} finally {
		landed.dispose();
	}

	// Nothing moved: the honest reading is a failure, and it must not be a success.
	const noop = await run({
		shimRoot: mkdtempSync(join(tmpdir(), "lo-two-install-shim-")),
		servingRoot: mkdtempSync(join(tmpdir(), "lo-two-install-serving-")),
	});
	try {
		assert.equal(
			noop.completed,
			undefined,
			"a no-op must never be reported as a success",
		);
		assert.ok(noop.errors > 0);
	} finally {
		noop.dispose();
	}

	/*
	 * THE FALSE-SUCCESS DIRECTION: the shim moves, the install that actually ran does not.
	 * A verdict read from the shim sees a version change and reports a success for an
	 * install nothing touched - which is the half of the defect the completed-event
	 * assertion above cannot catch.
	 */
	const wrongTree = await run({
		shimRoot: mkdtempSync(join(tmpdir(), "lo-two-install-shim-")),
		servingRoot: mkdtempSync(join(tmpdir(), "lo-two-install-serving-")),
		moveShim: true,
	});
	try {
		assert.equal(
			wrongTree.completed,
			undefined,
			"the shim moving while the install that ran did not is not a landed update",
		);
		assert.ok(wrongTree.errors > 0);
	} finally {
		wrongTree.dispose();
	}
});

/**
 * EVERY SURFACE THAT SHOWS AN ATTEMPT'S FAILURE USES THE ONE PHASE-AWARE RULE.
 *
 * Round 4 fixed the notification panel by handing the attempt's sentence to
 * `serverUpdateFailureCopy`, and two other surfaces kept running the same payload through
 * `updateErrorMessage`, whose 400-character reading of a long string as a machine dump
 * deleted it: the sentence was safe on one screen and deletable on two (review round 5,
 * M1). The behaviour test above proves the helper is right; this one proves the surfaces
 * still CALL it, which is the half a green behaviour test cannot see - and it is the half
 * that failed last round, because nothing pinned the call sites (review round 6, m1).
 *
 * It reads the sources rather than rendering them on purpose: the defect was a call site,
 * and a component that renders correctly in the story it is photographed in can still be
 * the one that drops the sentence in the arm the story does not cover.
 */
test("each surface that renders an attempt's failure calls the shared reason helper", async () => {
	const surfaces = [
		"src/renderer/src/shared/components/common/update-notification.tsx",
		"src/renderer/src/features/chat/components/run-details/run-panel.tsx",
		"src/renderer/src/shared/components/common/backend-compatibility-banner.tsx",
	];
	for (const relative of surfaces) {
		const source = readFileSync(join(process.cwd(), relative), "utf8");
		assert.ok(
			source.includes("serverUpdateFailureReason("),
			`${relative} must route an attempt's report through the shared helper`,
		);
		/*
		 * The exact shape the fix removed: the classifier applied to a report's message.
		 * A future edit that reintroduces it passes every behaviour test and still deletes
		 * the sentence on this surface.
		 */
		assert.ok(
			!source.includes("updateErrorMessage(report.message)"),
			`${relative} must not classify an attempt's report - that is what deleted the sentence`,
		);
	}
});

/**
 * THE UNATTENDED RECONCILIATION READS THE INSTALL THE RECORD NAMES.
 *
 * The launch-time path is the last place this seam was found (review round 7, M1), and it is the
 * one with no press in scope: the app comes back after dying mid-attempt and reads the record.
 * Pre-fix both sides of its comparison resolved the shim, so they agreed; once the press began
 * running the serving install, the reading had to come from the record, or the reconciliation
 * judged a tree the attempt never touched - a landed update reported as "did not move the
 * install", and a no-op reported as a success when only the shim had moved.
 */
test("the unattended reconciliation judges the install the record names", async () => {
	const markerFor = (installPath, before) => ({
		before,
		target: "0.56.0",
		startedAt: new Date().toISOString(),
		deadlineAt: new Date(Date.now() + 60_000).toISOString(),
		groupPid: null,
		groupStartedAt: null,
		installPath,
	});

	const scenario = async ({ moveServing = false, moveShim = false } = {}) => {
		const shimRoot = mkdtempSync(join(tmpdir(), "lo-unattended-shim-"));
		const servingRoot = mkdtempSync(join(tmpdir(), "lo-unattended-serving-"));
		const cleanup = () => {
			rmSync(shimRoot, { recursive: true, force: true });
			rmSync(servingRoot, { recursive: true, force: true });
		};
		makeInstall(shimRoot, "0.55.10");
		makeInstall(servingRoot, "0.55.10");
		if (moveServing) moveInstall(servingRoot, "0.55.10", "0.56.0");
		if (moveShim) moveInstall(shimRoot, "0.55.10", "0.56.0");
		const drive = await driveGlobalUpdate({
			servingPrefix: servingRoot,
			shimPath: join(shimRoot, "bin", "local-operator"),
			realEvidenceReads: true,
		});
		try {
			writeFileSync(
				drive.markerPath,
				JSON.stringify(
					markerFor(join(servingRoot, "bin", "local-operator"), "0.55.10"),
				),
			);
			await drive.updateService.reportUnattendedServerUpdate();
			return {
				completed: backendCompletion(drive.sent),
				markerStillThere: existsSync(drive.markerPath),
				dispose: () => {
					drive.dispose();
					cleanup();
				},
			};
		} catch (error) {
			drive.dispose();
			cleanup();
			throw error;
		}
	};

	// (a) The install the record names moved while nothing was watching: that is the report.
	const landed = await scenario({ moveServing: true });
	try {
		assert.ok(landed.completed, "a landed unattended update must be reported");
		assert.equal(landed.completed.payload.installVersion, "0.56.0");
		assert.equal(
			landed.markerStillThere,
			false,
			"the record is spent once it is reported",
		);
	} finally {
		landed.dispose();
	}

	/*
	 * (b) THE FALSE SUCCESS, and the reason this case exists: the shim moved, the install the
	 * record names did not. A reading taken from the shim sees the change and publishes a
	 * success for an attempt that changed nothing.
	 */
	const wrongTree = await scenario({ moveShim: true });
	try {
		assert.equal(
			wrongTree.completed,
			undefined,
			"a shim-only change is not the attempt landing",
		);
		assert.equal(wrongTree.markerStillThere, false);
	} finally {
		wrongTree.dispose();
	}
});

/**
 * THE INVARIANT THE FOUR INSTANCES SHARED, guarded the way the consumers are.
 *
 * Rounds 5, 6 and 7 each found one call site reading an install of its own - the press against
 * the check, the two evidence reads, then the unattended reconciliation - because every site was
 * free to resolve the shim. The behaviour cases cover the sites that exist; this covers the one
 * a future edit adds, by refusing a read that names no attempt. It reads the source on purpose:
 * the defect was a call site, and a call site is what a behaviour test cannot see.
 */
test("no attempt-scoped evidence read resolves an install of its own", async () => {
	const source = readFileSync(
		join(process.cwd(), "src/main/update-service.ts"),
		"utf8",
	);
	const callPattern = /read(?:InstallVersionAt|RebuildMarkerState)\(/g;
	let match = callPattern.exec(source);
	let calls = 0;
	let legacyFallbacks = 0;
	while (match !== null) {
		calls += 1;
		let depth = 1;
		let i = match.index + match[0].length;
		while (i < source.length && depth > 0) {
			if (source[i] === "(") depth += 1;
			if (source[i] === ")") depth -= 1;
			i += 1;
		}
		const argument = source.slice(match.index + match[0].length, i - 1);
		assert.ok(
			argument.includes("installPath") || argument.includes("recordPath"),
			`an attempt-scoped read must name the attempt's install, not resolve one: ${argument.trim()}`,
		);
		if (argument.includes("resolveLocalOperatorPath()")) {
			legacyFallbacks += 1;
			assert.ok(
				argument.includes("recordPath ?? this.resolveLocalOperatorPath()"),
				"the only permitted shim fallback is the reconciliation's legacy-record branch",
			);
		}
		match = callPattern.exec(source);
	}
	assert.ok(
		calls >= 5,
		`expected the attempt-scoped reads to be called, found ${calls}`,
	);
	assert.equal(
		legacyFallbacks,
		1,
		"exactly one caller may fall back to the shim: a record an older build wrote",
	);
});

/**
 * A GENERATION INSTALL CANNOT MOVE UNDER AN EVIDENCE READ, SO THE READ FOLLOWS THE POINTER.
 *
 * The operator's report of 2026-09-18: the press ran the serving install's own updater,
 * that updater created `generations/20260918T233919Z-0.59.7` and flipped `<stable>/current`
 * to it, and the app then told the user "The server update to 0.59.7 did not take effect:
 * the install still reports 0.59.6" - while Settings, reading the same install through the
 * shim one second later, printed 0.59.7.
 *
 * The mechanism was the layout's own point: the tree `/health` reports as the install root
 * is the generation the DAEMON started from, an install lands beside it and never touches
 * it, so `before` and `after` were two photographs of one frozen tree. `installPointerPath`
 * names the same install through `<stable>/current`, which is the one spelling that moves.
 *
 * These cases drive the SHIPPED press against a real generation layout (`realEvidenceReads`,
 * so the verdict comes from dist-info on disk and not from a scripted reading) and flip the
 * pointer from inside the run, which is exactly what `lop update` does.
 */

/** One generation of the install layout: the venv under `tools/local-operator`, and its own `bin`. */
const generationInstall = (stable, id, version) => {
	const root = join(stable, "generations", id);
	const venv = join(root, "tools", "local-operator");
	mkdirSync(join(venv, "bin"), { recursive: true });
	writeFileSync(join(venv, "bin", "local-operator"), "#!/bin/sh\nexit 0\n", {
		mode: 0o755,
	});
	writeFileSync(join(venv, "pyvenv.cfg"), "home = /usr/bin\n");
	writeFileSync(
		join(venv, "uv-receipt.toml"),
		'[tool]\nname = "local-operator"\n',
	);
	writeFileSync(join(venv, ".lop-source"), `pypi ${version}\n`, "utf8");
	const site = join(venv, "lib", "python3.13", "site-packages");
	const distInfo = join(site, `local_operator-${version}.dist-info`);
	mkdirSync(distInfo, { recursive: true });
	writeFileSync(
		join(distInfo, "METADATA"),
		`Name: local-operator\nVersion: ${version}\n`,
	);
	// The generation's console script is a symlink into its own venv (the layout's
	// § 2), so `<generation>/bin/local-operator` and the venv's script are one file.
	mkdirSync(join(root, "bin"), { recursive: true });
	symlinkSync(
		join("..", "tools", "local-operator", "bin", "local-operator"),
		join(root, "bin", "local-operator"),
	);
	return { root, venv, script: join(venv, "bin", "local-operator") };
};

/** Point `<stable>/current` at a generation, staged-then-renamed as `lop update` does. */
const flipPointer = (stable, root) => {
	const staged = join(stable, `current.tmp-${process.pid}`);
	symlinkSync(root, staged);
	renameSync(staged, join(stable, "current"));
};

test("a landed install behind a generation pointer is not reported as a failed update", async () => {
	const stable = realpathSync(
		mkdtempSync(join(tmpdir(), "lo-generation-stable-")),
	);
	const before = generationInstall(stable, "20260918T233135Z-0.59.6", "0.59.6");
	flipPointer(stable, before.root);
	const after = generationInstall(stable, "20260918T233919Z-0.59.7", "0.59.7");
	let markerDuring = null;
	const run = await driveGlobalUpdate({
		before: "0.59.6",
		after: "0.59.7",
		target: "0.59.7",
		// The install root `/health` reports: the generation the daemon came from.
		servingPrefix: before.venv,
		daemonReports: "0.59.7",
		realEvidenceReads: true,
		runGate: ({ markerPath }) => {
			// What the installer does while the app waits: build beside, then flip.
			markerDuring = JSON.parse(readFileSync(markerPath, "utf8"));
			flipPointer(stable, after.root);
		},
	});
	try {
		assert.equal(await run.updateService.updateBackend("0.59.7"), true);
		assert.deepEqual(
			backendErrors(run.sent),
			[],
			"an install that landed must not be reported as one that did not",
		);
		const completed = backendCompletion(run.sent);
		assert.ok(completed, JSON.stringify(run.sent.map((c) => c.channel)));
		assert.equal(completed.payload.installVersion, "0.59.7");
		/*
		 * The record the reconciliation reads later carries the POINTER spelling: a
		 * generation this attempt superseded is unreferenced and therefore prunable
		 * (`design-install-generations.md` § 3.3), and a record naming a pruned tree
		 * would read as "nothing moved" for an install that landed.
		 */
		assert.equal(
			markerDuring?.installPath,
			join(
				stable,
				"current",
				"tools",
				"local-operator",
				"bin",
				"local-operator",
			),
		);
	} finally {
		run.dispose();
		rmSync(stable, { recursive: true, force: true });
	}
});

test("the unattended reconciliation follows the pointer a record names", async () => {
	/*
	 * The same seam on the launch-time path, where there is no press in scope. The
	 * record this case writes carries the CONCRETE generation path, deliberately: that
	 * is the spelling every record written before this fix holds, so the case is about
	 * a marker an older build left as much as about one this build writes.
	 */
	const stable = realpathSync(
		mkdtempSync(join(tmpdir(), "lo-generation-record-")),
	);
	const before = generationInstall(stable, "20260918T233135Z-0.59.6", "0.59.6");
	flipPointer(stable, before.root);
	const landed = generationInstall(stable, "20260918T233919Z-0.59.7", "0.59.7");
	const drive = await driveGlobalUpdate({
		servingPrefix: before.venv,
		daemonReports: "0.59.7",
		realEvidenceReads: true,
	});
	try {
		// The install landed with nothing watching: the new generation exists and the
		// pointer names it, and the record was written before the flip.
		flipPointer(stable, landed.root);
		writeFileSync(
			drive.markerPath,
			JSON.stringify({
				before: "0.59.6",
				target: "0.59.7",
				startedAt: new Date().toISOString(),
				deadlineAt: new Date(Date.now() - 60_000).toISOString(),
				groupPid: null,
				groupStartedAt: null,
				installPath: before.script,
			}),
		);
		await drive.updateService.reportUnattendedServerUpdate();
		const completed = backendCompletion(drive.sent);
		assert.ok(
			completed,
			`a landed unattended update must be reported: ${JSON.stringify(drive.sent.map((c) => c.channel))}`,
		);
		assert.equal(completed.payload.installVersion, "0.59.7");
		assert.equal(completed.payload.unattended, true);
		assert.equal(existsSync(drive.markerPath), false);
	} finally {
		drive.dispose();
		rmSync(stable, { recursive: true, force: true });
	}
});

/**
 * THE RECORDED INSTALL FAILURE RETIRES ONCE THE MACHINE HAS ARRIVED.
 *
 * `last-update-install.json` outlives the notice by design (a dismissal must not be an
 * information loss), and nothing retired it when the install it complained about was
 * later reached: on 2026-09-18 the app ran 0.29.1 while the record still named a 0.28.3
 * install, so Settings printed "The last update to version 0.28.3 didn't finish. Version
 * 0.28.2 is running." - two versions stale, about a state the machine had left hours
 * earlier. The operator's rule is the rule here: cleared whenever the UI updates to a
 * newer version, successfully.
 */
test("the recorded install failure retires when the running version has reached its target", async () => {
	const recordFor = (targetVersion) => ({
		targetVersion,
		runningVersion: "0.28.2",
		startedAt: "2026-09-18T13:37:09.507Z",
		detectedAt: "2026-09-18T14:12:16.975Z",
		detail:
			"Install started. Squirrel cancels an install when an instance runs.",
		attempts: 1,
	});

	const at = async (appVersion, targetVersion) => {
		const userData = mkdtempSync(join(tmpdir(), "lo-last-install-userdata-"));
		globalThis.__loTestPaths = {
			home: userData,
			userData,
			appData: userData,
			temp: tmpdir(),
		};
		globalThis.__loTestAppVersion = appVersion;
		const { service, serviceDir } = await loadUpdateServiceModule();
		const markerDir = userData;
		writeFileSync(
			join(markerDir, "last-update-install.json"),
			`${JSON.stringify(recordFor(targetVersion), null, 2)}\n`,
		);
		const updateService = new service.UpdateService(
			{
				isDestroyed: () => false,
				webContents: {
					send: () => {},
					isDestroyed: () => false,
					// The launch-time recovery schedules the failure notice against the
					// load event, so the stub window carries the registration surface it
					// reaches for rather than a send-only object.
					once: () => {},
					on: () => {},
					removeListener: () => {},
				},
			},
			null,
		);
		return {
			updateService,
			path: join(markerDir, "last-update-install.json"),
			dispose: () => {
				clearInterval(updateService.updateCheckInterval);
				// biome-ignore lint/performance/noDelete: teardown of a fixture global; ABSENT is what "no override" means to the fixture's getters.
				delete globalThis.__loTestPaths;
				globalThis.__loTestAppVersion = undefined;
				rmSync(serviceDir, { recursive: true, force: true });
				rmSync(userData, { recursive: true, force: true });
			},
		};
	};

	// The operator's own state: a 0.28.3 record on a 0.29.1 app. Retired at the read,
	// and the FILE goes with it - a later launch, a `cat` and the panel agree.
	const stale = await at("0.29.1", "0.28.3");
	try {
		assert.equal(stale.updateService.lastInstallAttempt(), null);
		assert.equal(
			existsSync(stale.path),
			false,
			"the retirement is a removal, not a read-time mask",
		);
	} finally {
		stale.dispose();
	}

	// An install that reached its target exactly is the same fact: the record describes
	// a version this app is running.
	const exact = await at("0.29.0", "0.29.0");
	try {
		assert.equal(exact.updateService.lastInstallAttempt(), null);
	} finally {
		exact.dispose();
	}

	// The record still has something to say: the target is AHEAD of what is running, so
	// the failure it names is the state of this machine and the attempts count stands.
	const live = await at("0.29.1", "0.30.0");
	try {
		const record = live.updateService.lastInstallAttempt();
		assert.equal(record?.targetVersion, "0.30.0");
		assert.equal(record?.attempts, 1);
		assert.equal(existsSync(live.path), true);
	} finally {
		live.dispose();
	}

	/*
	 * AND THE PRE-RELEASE PAIR STAYS (review round 1, R1-2). `compareVersions` reads
	 * TRIPLES, so a target `0.1.2` against a running `0.1.2-beta.9` orders EQUAL -
	 * and the first spelling of the retire rule treated `order <= 0` as arrival, so
	 * the launch that had just written "the install of 0.1.2 didn't finish" deleted
	 * its own record on the way out, while the marker rule called that same pair a
	 * failure. The stand-in app version here IS the shape: this repository has shipped
	 * a `-beta.N` stamp, so it is a pair the update flow really produces.
	 */
	const prerelease = await at("0.1.2-beta.9", "0.1.2");
	try {
		const record = prerelease.updateService.lastInstallAttempt();
		assert.equal(
			record?.targetVersion,
			"0.1.2",
			"a machine reporting 0.1.2-beta.9 is not running 0.1.2, so the record must stay",
		);
		assert.equal(existsSync(prerelease.path), true);
	} finally {
		prerelease.dispose();
	}

	/*
	 * And nothing is dropped on a guess: a target the module cannot order is not
	 * evidence that the install landed, which is the direction `evaluatePendingInstall`
	 * takes for a marker it cannot order either.
	 */
	const unorderable = await at("0.29.1", "nightly");
	try {
		assert.equal(
			unorderable.updateService.lastInstallAttempt()?.targetVersion,
			"nightly",
		);
		assert.equal(existsSync(unorderable.path), true);
	} finally {
		unorderable.dispose();
	}
});

test("a start-up that observes an install arrived retires the record, and a failed one keeps it", async () => {
	/*
	 * The event-driven half of the same rule: the launch that observes the install
	 * having succeeded (or being superseded) is the moment the fact becomes true, and
	 * the two arms that report it are where the record is cleared. The arms that do
	 * NOT report arrival - an install still in flight, and one that failed - must leave
	 * it alone, or the record loses its only purpose.
	 */
	/*
	 * THE FILES ARE SEEDED AFTER THE SERVICE IS CONSTRUCTED, on purpose (QA Q-1).
	 * `UpdateService`'s own constructor calls `recoverPendingInstall()`, so a
	 * record written first would be retired by CONSTRUCTION and the case would
	 * assert about the constructor rather than about the call it narrates. Seeded
	 * after, the arms below are pinned by the explicit call, and each case asserts
	 * the record is still on disk before that call - which is what fails if the
	 * seeding order is ever reversed again.
	 */
	const scenario = async ({ markerTarget, appVersion, recordTarget }) => {
		const userData = mkdtempSync(join(tmpdir(), "lo-recover-userdata-"));
		globalThis.__loTestPaths = {
			home: userData,
			userData,
			appData: userData,
			temp: tmpdir(),
		};
		globalThis.__loTestAppVersion = appVersion;
		const { service, serviceDir } = await loadUpdateServiceModule();
		const recordPath = join(userData, "last-update-install.json");
		const updateService = new service.UpdateService(
			{
				isDestroyed: () => false,
				webContents: {
					send: () => {},
					isDestroyed: () => false,
					// The launch-time recovery schedules the failure notice against the
					// load event, so the stub window carries the registration surface it
					// reaches for rather than a send-only object.
					once: () => {},
					on: () => {},
					removeListener: () => {},
				},
			},
			null,
		);
		/*
		 * The seam that decides "is this target's install still running" is
		 * `installJobStateProbe` (the four-state probe `installJobState` answers);
		 * `absent` is a launchd with no job for this app, which is what lets the
		 * marker be judged by version alone. The stub this case used to install -
		 * `shipItInstallJobLoaded` - is not a member of the class at all, so it
		 * armed nothing (QA Q-1, measured).
		 */
		updateService.installJobStateProbe = () => "absent";
		writeFileSync(
			recordPath,
			JSON.stringify({
				targetVersion: recordTarget,
				runningVersion: "0.28.2",
				startedAt: "2026-09-18T13:37:09.507Z",
				detectedAt: "2026-09-18T14:12:16.975Z",
				detail:
					"Install started. Squirrel cancels an install when an instance runs.",
				attempts: 1,
			}),
		);
		writeFileSync(
			join(userData, "pending-update-install.json"),
			JSON.stringify({
				targetVersion: markerTarget,
				artifactPath: join(userData, "staged.zip"),
				startedAt: new Date().toISOString(),
				watchdogPid: null,
			}),
		);
		return {
			updateService,
			recordPath,
			dispose: () => {
				clearInterval(updateService.updateCheckInterval);
				// biome-ignore lint/performance/noDelete: teardown of a fixture global; ABSENT is what "no override" means to the fixture's getters.
				delete globalThis.__loTestPaths;
				globalThis.__loTestAppVersion = undefined;
				rmSync(serviceDir, { recursive: true, force: true });
				rmSync(userData, { recursive: true, force: true });
			},
		};
	};

	// The install arrived: the marker's target is what this app is running.
	const arrived = await scenario({
		markerTarget: "0.29.0",
		appVersion: "0.29.0",
		recordTarget: "0.29.0",
	});
	try {
		// The record is there BEFORE the call: construction alone must not have
		// touched it, or the assertion below would be about the constructor.
		assert.match(
			readFileSync(arrived.recordPath, "utf8"),
			/"targetVersion":"0.29.0"/,
			"the constructor's own recovery may not retire a record written after it",
		);
		arrived.updateService.recoverPendingInstall();
		assert.equal(
			existsSync(arrived.recordPath),
			false,
			"the launch that observed the install arrive is the end of the record",
		);
	} finally {
		arrived.dispose();
	}

	// And a failure is still a failure: the record it writes survives its own report,
	// with the attempts count the panel reads. The arm REPLACES the record with this
	// attempt's (that is what the count is for) - what it may not do is remove it,
	// which is the clearing the two arms above perform and this one must not.
	const failed = await scenario({
		markerTarget: "0.30.0",
		appVersion: "0.29.1",
		recordTarget: "0.28.3",
	});
	try {
		assert.equal(existsSync(failed.recordPath), true);
		failed.updateService.recoverPendingInstall();
		const record = failed.updateService.lastInstallAttempt();
		assert.equal(record?.targetVersion, "0.30.0");
		assert.equal(record?.runningVersion, "0.29.1");
	} finally {
		failed.dispose();
	}
});
/*
 * ---------------------------------------------------------------- the fleet gate
 *
 * THE RULE THESE CASES EXIST FOR, in the operator's words: "nothing should kill
 * runtimes en masse, ever". A restart of the server serving this app is
 * `stop(true)` - SIGTERM, ten seconds, SIGKILL - and the daemon's own `retire.py`
 * declines that exit for exactly this reason. So an update press now drains the
 * fleet first (`drainFleetForUpdate` -> `backend/fleet-drain.ts`), refuses rather
 * than cutting off a turn on a timer, and puts back what a move displaced.
 *
 * The busy signal is the app's EXISTING one - the roster's `live_state`, read by
 * `servingWorkState`, which the version-drift gate already asks for - so the
 * fixtures below answer the two readers the manager already has
 * (`servingWorkState`, `servingSessionFleet`) rather than a new notion of busy.
 */

test("a press that cannot drain does not restart the server, and says why", async () => {
	const driven = await driveAppOwnedUpdate({
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: "0.56.12",
		/*
		 * The machine the operator's own report describes: somebody else's turn is
		 * running when the press arrives, and a listed name, so the refusal can name
		 * it rather than saying "something is busy".
		 */
		workState: "busy",
		fleet: [
			{
				id: "aaaaaaaaaaa1",
				name: "Nightly enrichment",
				kind: "daemon",
				live_state: "busy",
			},
			{
				id: "bbbbbbbbbbb2",
				name: "Idle chat",
				kind: "tui",
				live_state: "idle",
			},
		],
	});
	try {
		assert.equal(
			driven.result,
			false,
			"an update that cannot drain is REFUSED, not forced",
		);
		assert.equal(
			driven.calls.restarts,
			0,
			"nothing may restart the daemon while a turn is in flight",
		);
		/*
		 * The phase is announced as a wait: a press that sits still for minutes
		 * behind an "installing" that has not started is the silence this panel's
		 * copy exists to remove.
		 */
		assert.ok(
			phases(driven.sent).includes("draining"),
			JSON.stringify(phases(driven.sent)),
		);
		const refused = updateErrors(driven.sent);
		assert.equal(refused.length, 1, JSON.stringify(refused));
		assert.match(refused[0].payload.message, /still running a turn/);
		assert.match(refused[0].payload.message, /Nightly enrichment/);
		/*
		 * The published environment IS on disk by then, and the sentence says so:
		 * telling the reader an update did not happen when one did is the mirror of
		 * the promise this change removes.
		 */
		assert.match(refused[0].payload.message, /install itself has landed/);
		/*
		 * AND THE HEADING'S FACT TRAVELS WITH IT (design round 2, D6). The panel cannot
		 * infer this from the sentence: two of the three refusal sites happen after the
		 * install landed, and a heading of "The update didn't start" over the sentence
		 * above is the frame contradicting itself in one paragraph. The field is also what
		 * keeps the OTHER clause out of this arm's sentence - they are alternatives, not
		 * additions.
		 */
		assert.equal(refused[0].payload.refusal.installLanded, true);
		assert.doesNotMatch(refused[0].payload.message, /Nothing was installed/);
		assert.deepEqual(
			completions(driven.sent),
			[],
			"a refused press reports the refusal, not a completion",
		);
	} finally {
		driven.dispose();
	}
});

test("a press that had to wait installs anyway once the fleet drains", async () => {
	const driven = await driveAppOwnedUpdate({
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: "0.56.12",
		/*
		 * Busy on the FIRST read and idle on the next: the drain is a wait rather
		 * than a refusal here, which is the whole difference between this case and
		 * the one above.
		 */
		workState: ["busy", "idle"],
		fleet: [
			{
				id: "aaaaaaaaaaa1",
				name: "Nightly enrichment",
				kind: "daemon",
				live_state: "busy",
			},
		],
	});
	try {
		assert.equal(driven.result, true);
		assert.equal(driven.calls.restarts, 1);
		assert.deepEqual(
			phases(driven.sent),
			["installing", "draining", "restarting"],
			JSON.stringify(phases(driven.sent)),
		);
		assert.deepEqual(updateErrors(driven.sent), []);
		const completed = completions(driven.sent);
		assert.equal(completed.length, 1);
		assert.equal(completed[0].payload.restarted, true);
	} finally {
		driven.dispose();
	}
});

test("the move re-engages the sessions it displaced, and only those", async () => {
	const driven = await driveAppOwnedUpdate({
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: "0.56.12",
		/*
		 * Three sessions before the move: one that was working, one unwatched
		 * `daemon`-kind session, and a COLD conversation with no runtime at all.
		 * After it, the working one and the cold one are as they were and the
		 * daemon-kind one is gone - which is the session nothing else revives, and
		 * the only one that may be engaged.
		 */
		fleet: [
			{ id: "aaaaaaaaaaa1", name: "Working", kind: "tui", live_state: "busy" },
			{
				id: "ccccccccccc3",
				name: "Delegated run",
				kind: "daemon",
				live_state: "idle",
			},
			{ id: "ddddddddddd4", name: "Cold chat", kind: "", live_state: "" },
		],
		fleetAfter: [
			{ id: "aaaaaaaaaaa1", name: "Working", kind: "tui", live_state: "idle" },
			{ id: "ddddddddddd4", name: "Cold chat", kind: "", live_state: "" },
		],
	});
	try {
		assert.equal(driven.result, true);
		assert.deepEqual(
			driven.calls.desktop.map(
				(request) => `${request.op}:${request.sessionId}`,
			),
			["sessions.watch:ccccccccccc3", "sessions.warm:ccccccccccc3"],
			JSON.stringify(driven.calls.desktop),
		);
		/*
		 * The lease is taken FIRST and is the route's own precondition: `warm`
		 * cancels itself when nothing else holds the bridge, so a warm without the
		 * lease would be a 200 that spawns nothing. Its id has to satisfy the
		 * transport's pattern, which a uuid's dashes do not.
		 */
		const watch = driven.calls.desktop[0];
		assert.match(watch.subscriptionId, /^[a-f0-9]{32}$/);
		assert.equal(watch.visible, true);
		assert.equal(watch.canNotify, false);
	} finally {
		driven.dispose();
	}
});

test("the re-engage leases the id the session's own stream minted, and nothing else", async () => {
	/*
	 * THE FIX FOR REVIEW ROUND 2'S R2-M1, ASSERTED AGAINST A DAEMON THAT ENFORCES THE
	 * PRECONDITION. The old engage generated a random subscription id per attempt, and
	 * the bridge answers one it has never seen with `KeyError` -> 404, so the recovery
	 * half of this PR was a no-op against the real daemon while every case here stayed
	 * green - because the fixture answered 200 to any id. The daemon behind this case
	 * holds ids only while a stream does, so `acceptedLeases` can only contain an id a
	 * LIVE events stream minted: an id this process made up is not in `mintedIds`, and
	 * a lease on one is refused and recorded in `refusedLeases`.
	 */
	const driven = await driveAppOwnedUpdate({
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: "0.56.12",
		fleet: [
			{ id: "aaaaaaaaaaa1", name: "Working", kind: "tui", live_state: "busy" },
			{
				id: "ccccccccccc3",
				name: "Delegated run",
				kind: "daemon",
				live_state: "idle",
			},
		],
		fleetAfter: [
			{ id: "aaaaaaaaaaa1", name: "Working", kind: "tui", live_state: "idle" },
		],
	});
	try {
		assert.equal(
			driven.result,
			true,
			JSON.stringify(updateErrors(driven.sent).map((e) => e.payload.message)),
		);
		assert.deepEqual(
			driven.daemon.refusedLeases,
			[],
			"no lease may be sent on an id no stream holds",
		);
		assert.deepEqual(
			driven.daemon.acceptedLeases.map((lease) => lease.sessionId),
			["ccccccccccc3"],
			"the displaced session is the one leased",
		);
		const lease = driven.daemon.acceptedLeases[0];
		assert.ok(
			driven.daemon.mintedIds.includes(lease.subscriptionId),
			`the lease id must be one an events stream minted, not one this process made up: ${lease.subscriptionId}`,
		);
		/*
		 * AND THE RUNTIME IS THE MEASURE OF SUCCESS, not the lease: `daemon.started` is
		 * the roster's own answer, which is what `engageSessionRuntime` returns true on.
		 * A fixture that answered 200 without starting anything would fail here.
		 */
		assert.ok(
			driven.daemon.started.has("ccccccccccc3"),
			"the engage must leave a runtime behind, not a receipt",
		);
	} finally {
		driven.dispose();
	}
});

test("a session whose stream cannot be opened is reported, never leased on an invented id", async () => {
	/*
	 * THE ARM THE OLD CODE COULD NOT TELL APART (review round 2, R2-M1). With no `open`
	 * frame there is no subscription id anywhere, so the only honest move is to stop:
	 * inventing one sends a call the daemon refuses, and - worse - reports a miss the app
	 * could have predicted rather than the reason it actually had. The daemon here refuses
	 * the stream, so this asserts that NO lease was attempted at all.
	 */
	const driven = await driveAppOwnedUpdate({
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: "0.56.12",
		refuseStreams: true,
		fleet: [
			{
				id: "ccccccccccc3",
				name: "Delegated run",
				kind: "daemon",
				live_state: "idle",
			},
		],
		fleetAfter: [],
	});
	try {
		assert.equal(
			driven.result,
			true,
			`the update itself still lands: ${JSON.stringify(updateErrors(driven.sent).map((e) => e.payload.message))}`,
		);
		assert.deepEqual(
			driven.calls.desktop.filter((request) => request.op === "sessions.watch"),
			[],
			"a lease with no subscription to name is not sent",
		);
		assert.deepEqual(driven.daemon.acceptedLeases, []);
		assert.deepEqual(driven.daemon.started, new Set());
	} finally {
		driven.dispose();
	}
});

test("a retirement during the drain, before the restart, is still re-engaged", async () => {
	/*
	 * THE HOLE THE ROUND-1 M2 FIX LEFT ON THIS ROUTE (review round 2, R2-M3). The
	 * before-side was the pre-restart read alone, and the publish happens minutes earlier
	 * in the same method: an idle runtime retires on the build skew while the app waits
	 * out a ten-minute drain, so it is gone before the only read that could name it and
	 * is never put back. The reading is now taken between the publish and the drain and
	 * unioned with the pre-restart one - which is the reading the rebuild route already
	 * kept for its own install leg.
	 *
	 * THE FIXTURE IS A READ SCHEDULE, NOT A MONOTONE MACHINE, and what this case is
	 * worth is WHICH READ NAMES b2 (review round 3, R3-M1). The publish-side snapshot is
	 * the only one of the press's reads that carries b2: the drain's own read and the
	 * pre-restart read both answer without it, so the before-side can hold b2 ONLY
	 * through the union, and reverting the union leaves nothing displaced at all. It used
	 * to hand b2 to the drain's read and to every read after the publish-side one, so the
	 * pre-restart snapshot named b2 by itself and this case passed with the union
	 * reverted - an evidence defect, not a behavioural one: the union is correct and was
	 * unguarded. The shape is `fleet: []` with `fleetAfterPublish: [b2]` for exactly that
	 * reason, and the union is what makes the difference.
	 */
	const driven = await driveAppOwnedUpdate({
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: "0.56.12",
		/* The press's reads other than the publish-side one: no b2 in any of them. */
		fleet: [],
		/* The publish-side read, and the ONLY read that names the retired session. */
		fleetAfterPublish: [
			{
				id: "bbbbbbbbbbb2",
				name: "Unwatched daemon",
				kind: "daemon",
				live_state: "idle",
			},
		],
		fleetAfter: [],
	});
	try {
		assert.equal(
			driven.result,
			true,
			JSON.stringify(updateErrors(driven.sent).map((e) => e.payload.message)),
		);
		assert.deepEqual(
			driven.daemon.acceptedLeases.map((lease) => lease.sessionId),
			["bbbbbbbbbbb2"],
			"a session the publish retired is displaced by this press and must come back",
		);
	} finally {
		driven.dispose();
	}
});

test("the refusal reports the press's wait, not the leg's", async () => {
	/*
	 * D9 = R2-m1: ONE JOURNEY, ONE NUMBER. The reading the reader watches (`draining`'s
	 * `waitedMs`) is the press's total - `spentMs + elapsedMs` - and the refusal used to
	 * report the SECOND leg's own elapsed, which is ~0 once the first leg has spent the
	 * budget. The ledger below carries a spent leg with the flag already held, which is
	 * the state the rebuild route reaches; the refusal's number must be the press's,
	 * which is at least everything the panel already showed.
	 */
	const driven = await driveAppOwnedUpdate({
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: "0.56.12",
		workState: "busy",
		fleet: [
			{
				id: "aaaaaaaaaaa1",
				name: "Nightly enrichment",
				kind: "daemon",
				live_state: "busy",
			},
		],
		presetDrainSpentMs: 240_000,
		holdTakenElsewhere: true,
	});
	try {
		assert.equal(driven.result, false);
		const refused = updateErrors(driven.sent);
		assert.equal(refused.length, 1, JSON.stringify(refused));
		assert.ok(
			refused[0].payload.refusal.waitedMs >= 240_000,
			`the refusal must carry the press's total, not this leg's share: ${refused[0].payload.refusal.waitedMs}`,
		);
	} finally {
		driven.dispose();
	}
});

test("the press holds the update-in-flight flag for the whole drain, not only the restart", async () => {
	const driven = await driveAppOwnedUpdate({
		servingBeforeRestart: "0.56.8",
		servingAfterRestart: "0.56.12",
		/*
		 * A fleet that is busy when the press arrives and idle a poll later, so the
		 * press really WAITS inside the gate - which is the window this case is about.
		 */
		workState: ["busy", "idle"],
		fleet: [
			{ id: "aaaaaaaaaaa1", name: "Working", kind: "tui", live_state: "busy" },
		],
		fleetAfter: [],
	});
	try {
		assert.equal(driven.result, true);
		/*
		 * THE HOLD COVERS EVERY FLEET READ OF THE PRESS (review round 1, m1). The flag
		 * is what the periodic drift check reads as its `update-in-flight` hold, and it
		 * used to be raised around `backend.restart()` alone - so a drain of up to ten
		 * minutes ran with no hold, and the moment it cleared the drift check could find
		 * the pair stale and the fleet idle and bounce the daemon ITSELF: under the
		 * press, with no snapshot of its own and no re-engage.
		 */
		assert.ok(
			driven.calls.holdAtFleetRead.length >= 2,
			`the press reads the fleet more than once: ${JSON.stringify(driven.calls.holdAtFleetRead)}`,
		);
		assert.ok(
			driven.calls.holdAtFleetRead.every((held) => held === true),
			`every fleet read happens under the hold: ${JSON.stringify(driven.calls.holdAtFleetRead)}`,
		);
		assert.deepEqual(
			driven.calls.autoUpdating,
			[true, false],
			"raised once at the top of the press and cleared once, at the end",
		);
	} finally {
		driven.dispose();
	}
});

/**
 * A harness GENERATION install on disk: `<root>/generations/<id>/tools/local-operator`,
 * with the `current` entry beside it that makes the layout one the app may move
 * (`generationInstallRoot`) and the venv markers `classifyGlobalInstall` reads.
 *
 * The route is RE-DECIDED inside the press from a real resolution, so a case about
 * the generation rule cannot stub it: the tree has to exist for the same reason it
 * has to exist in the app.
 */
/*
 * RENAMED AT THE REBASE ONTO `main` (round 4, PR #371). main grew its own
 * `generationInstall` while this branch had this one - a generation under a caller's
 * stable root for the pointer cases, against a synthetic generation in its own temp
 * root for the fleet-gate case - and the two are different fixtures rather than two
 * versions of one, so they cannot share the name. The new one is the file's own
 * vocabulary (`syntheticInstall`) applied to what this builds.
 */
const syntheticGenerationInstall = (id = "g0001") => {
	const root = tempDir("lo-generation-");
	mkdirSync(join(root, "generations", id), { recursive: true });
	writeFileSync(join(root, "current"), join(root, "generations", id), "utf8");
	const prefix = join(root, "generations", id, "tools", "local-operator");
	mkdirSync(join(prefix, "bin"), { recursive: true });
	writeFileSync(
		join(prefix, "bin", "local-operator"),
		`#!${join(prefix, "bin", "python3")}\n`,
		{
			mode: 0o755,
		},
	);
	writeFileSync(join(prefix, "bin", "python3"), "", { mode: 0o755 });
	writeFileSync(join(prefix, "pyvenv.cfg"), "home = /synthetic\n", "utf8");
	/*
	 * The uv receipt, because the ROUTE is chosen from the classification and not
	 * from the path: a generation root whose install classifies as an ordinary venv
	 * takes the legacy arm, and a fixture that skipped this line would assert the
	 * generation rule against a route that is not one.
	 */
	writeFileSync(
		join(prefix, "uv-receipt.toml"),
		'[tool]\nname = "local-operator"\n',
		"utf8",
	);
	const distInfo = join(
		prefix,
		"lib",
		"python3.12",
		"site-packages",
		"local_operator-0.56.0.dist-info",
	);
	mkdirSync(distInfo, { recursive: true });
	writeFileSync(
		join(distInfo, "METADATA"),
		"Metadata-Version: 2.1\nName: local-operator\nVersion: 0.56.0\n",
		"utf8",
	);
	writeFileSync(join(distInfo, "INSTALLER"), "uv\n", "utf8");
	return { root, prefix, script: join(prefix, "bin", "local-operator") };
};

test("a generation install announces and leaves the app-owned daemon on its build", async () => {
	/*
	 * The harness installs into per-generation roots behind a `current` pointer, and
	 * the daemon keeps serving the generation it booted from - the install lands in a
	 * tree no running process is reading. Restarting it would spend a bounce, and
	 * whatever is in flight, to buy nothing: the runtime adopts the new build at its
	 * own next idle. So the press reports the skew and leaves the process alone.
	 */
	const install = syntheticGenerationInstall();
	const run = await driveGlobalUpdate({
		before: "0.55.10",
		after: "0.56.0",
		target: "0.56.0",
		daemonReports: "0.55.10",
		servingPrefix: install.prefix,
	});
	try {
		assert.equal(await run.updateService.updateBackend("0.56.0"), true);
		assert.deepEqual(
			run.calls.installers,
			[install.script],
			"the generation layout takes the ENTRY POINT route - the serving install's own front end - not the rebuild",
		);
		assert.equal(
			run.calls.restarts,
			0,
			"a generation install may not restart the daemon it started",
		);
		const completed = backendCompletion(run.sent);
		assert.ok(completed, JSON.stringify(run.sent.map((c) => c.channel)));
		assert.equal(completed.payload.restarted, false);
		assert.equal(completed.payload.installVersion, "0.56.0");
		assert.equal(
			completed.payload.runningVersion,
			"0.55.10",
			"the server keeps running the build it loaded, and the payload says which",
		);
		assert.deepEqual(backendErrors(run.sent), []);
	} finally {
		run.dispose();
	}
});

test("a press with nothing left to install still moves the daemon, through the drain", async () => {
	/*
	 * The skew panel's own control: the install is already current, so there is
	 * nothing to install and the restart IS the work the reader asked for. It is the
	 * one press on the generation layout that moves the server, and it goes through
	 * the same drain as every other restart.
	 */
	const install = syntheticGenerationInstall("g0002");
	const run = await driveGlobalUpdate({
		before: "0.56.0",
		after: "0.56.0",
		target: "0.56.0",
		daemonReports: "0.56.0",
		servingPrefix: install.prefix,
		workState: ["busy", "idle"],
	});
	try {
		assert.equal(await run.updateService.updateBackend("0.56.0"), true);
		assert.equal(run.calls.restarts, 1);
		assert.ok(
			backendPhases(run.sent).includes("draining"),
			JSON.stringify(backendPhases(run.sent)),
		);
		const completed = backendCompletion(run.sent);
		assert.equal(completed.payload.restarted, true);
	} finally {
		run.dispose();
	}
});

test("the offer carries whether this press restarts the server", async () => {
	/*
	 * `restartable` answers whether the app STARTED the daemon and was used by every
	 * sentence that promised a restart - true on a generation install too, where the
	 * press no longer bounces anything. The second reading travels with it so the
	 * offer's cost sentence and the install phase's clause can ask the question they
	 * mean.
	 */
	const generation = await driveGlobalUpdate({
		daemonReports: "0.55.10",
		managedRoute: "entry-point",
	});
	try {
		generation.updateService.getLatestPypiVersion = async () => "0.56.2";
		await generation.updateService.checkForBackendUpdates(true);
		const offer = generation.sent.find(
			({ channel }) => channel === "backend-update-available",
		);
		assert.ok(offer, JSON.stringify(generation.sent.map((c) => c.channel)));
		assert.equal(offer.payload.restartsServer, false);
		assert.equal(
			offer.payload.restartable,
			true,
			"the ownership fact is unchanged - only the promise about THIS press differs",
		);
	} finally {
		generation.dispose();
	}

	const inPlace = await driveGlobalUpdate({ daemonReports: "0.55.10" });
	try {
		inPlace.updateService.getLatestPypiVersion = async () => "0.56.2";
		await inPlace.updateService.checkForBackendUpdates(true);
		const offer = inPlace.sent.find(
			({ channel }) => channel === "backend-update-available",
		);
		assert.ok(offer, JSON.stringify(inPlace.sent.map((c) => c.channel)));
		assert.equal(offer.payload.restartsServer, true);
	} finally {
		inPlace.dispose();
	}
});
