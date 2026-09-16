import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	rmdirSync,
	statSync,
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
		contents: 'export * from "./src/main/update-install";',
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
	PLIST_READ_TIMEOUT_SECONDS,
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
	evaluatePendingInstall,
	healPythonBytecode,
	installFailurePayload,
	installInFlightPayload,
	installStartedText,
	installedBundleSealBlock,
	isInstallInFlight,
	isPythonBytecodePath,
	lastInstallAttemptPath,
	launchdJobLoaded,
	matchArtifactMetadata,
	measureDirectoryBytes,
	parsePendingInstallMarker,
	parsePipShowVersion,
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
	runChecks,
	summarize,
	verifyArtifacts,
} = await import("./verify-macos-artifacts.mjs");

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
	// outside the interpreter trees, a non-bytecode file inside them, and a `.pyc`
	// outside a `__pycache__` directory are each refused.
	for (const path of [
		`${bundle}/Contents/Resources/extra.txt`,
		`${bundle}/Contents/Resources/python_aarch64/lib/python3.12/json/decoder.py`,
		`${bundle}/Contents/Resources/python_aarch64/lib/python3.12/json/handwritten.pyc`,
		"/Applications/Other.app/Contents/Resources/python_aarch64/lib/python3.12/json/__pycache__/x.cpython-312.pyc",
	]) {
		assert.equal(isPythonBytecodePath(bundle, path), false, path);
		const refused = planPythonBytecodeHeal(bundle, [added(path)]);
		assert.equal(refused.healable, false, path);
		assert.match(refused.reason, /outside the bundled python trees/);
	}
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

test("a bytecode-broken bundle really heals, and a tampered one really does not", async (t) => {
	if (process.platform !== "darwin") {
		t.skip("macOS only");
		return;
	}

	// This is the round trip against the real tool, because the heal's whole
	// claim is about what `/usr/bin/codesign` says next: sign clean, let an
	// interpreter write bytecode into the bundle, watch the real probe fail with
	// `file added:`, remove exactly those files, and watch the real probe pass.
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

	const brokenProbe = fixture.probe();
	const broken = evaluateBundleSeal(brokenProbe);
	assert.equal(broken.kind, "unsealed");
	assert.match(broken.detail, /a sealed resource is missing or invalid/);

	const violations = parseSealViolations(brokenProbe.stdout);
	// Both added files, and nothing but them: the verdict on stderr is not a
	// violation, which is why the parse is over stdout.
	assert.deepEqual(
		violations.map((violation) => violation.kind),
		["added", "added"],
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
		[realpathSync(first), realpathSync(second)].sort(),
	);

	const heal = healPythonBytecode(fixture.app, violations);
	assert.equal(heal.healable, true, heal.reason);
	assert.equal(heal.removed.length, 2);

	// The seal is back, measured rather than inferred.
	assert.deepEqual(evaluateBundleSeal(fixture.probe()), { kind: "sealed" });
	// And the file that was SEALED is still there: the heal removed reported
	// files, not the directories that held them.
	assert.ok(existsSync(fixture.sealedPyc));

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
test("an install still in flight is not a failure, and a loaded job alone is not an install", () => {
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

	assert.equal(isInstallInFlight({ marker, jobLoaded: true, now }), true);
	assert.equal(
		evaluatePendingInstall({
			marker,
			runningVersion: "0.19.4",
			installInFlight: true,
		}).kind,
		"in-flight",
	);

	// Every fact is needed, and each one alone is wrong. A job with no marker, a
	// marker with no job, and a job an old failure left loaded for hours (0.17.0:
	// runs=3114) are all decided by the version: that is a failure.
	assert.equal(
		isInstallInFlight({ marker: null, jobLoaded: true, now }),
		false,
	);
	assert.equal(isInstallInFlight({ marker, jobLoaded: false, now }), false);
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
			jobLoaded: true,
			now: Date.parse(started) + WATCHDOG_HARD_TIMEOUT_SECONDS * 1000,
		}),
		true,
	);
	assert.equal(
		isInstallInFlight({
			marker,
			jobLoaded: true,
			now: Date.parse(started) + PENDING_INSTALL_RECENCY_SECONDS * 1000,
		}),
		true,
	);
	assert.equal(
		isInstallInFlight({
			marker,
			jobLoaded: true,
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
			jobLoaded: true,
			now,
		}),
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
test("the install job probe reads launchd's exit status, and cannot run reads as not loaded", () => {
	const asked = [];
	const probe = (label) => {
		asked.push(label);
		return 0;
	};
	assert.equal(launchdJobLoaded("com.local-operator.ShipIt", probe), true);
	assert.deepEqual(asked, ["com.local-operator.ShipIt"]);
	assert.equal(
		launchdJobLoaded("com.local-operator.ShipIt", () => 113),
		false,
	);
	assert.equal(
		launchdJobLoaded("com.local-operator.ShipIt", () => null),
		false,
	);
	// No job label means nothing to ask, which is not the same as asking.
	assert.equal(
		launchdJobLoaded(null, () => 0),
		false,
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
 * fixtures can, and the frames are a function of them.
 */
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
	});

	// The paths travel in the environment: `sh -c` exposes the script text as the
	// process's own command line, and the old pgrep-based check would then match
	// the watchdog itself through the very check that waits for the app to exit.
	assert.equal(plan.script.includes("/Applications/Local Operator.app"), false);
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
	assert.match(
		plan.script,
		/if app_running; then exit 0; fi\nif \[ -n "\$NAME" \]/,
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
	assert.match(plan.script, /&& shipit_loaded; then\n\t\t\tholding=1/);
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
	assert.equal(bounded.env.LO_UPDATE_WATCHDOG_TARGET_VERSION, "0.18.0");
	// And with no label the appear window is skipped rather than spent pretending
	// to observe a job it cannot see, which used to end in a relaunch carrying no
	// evidence about the install at all (review R14).
	assert.match(
		bounded.script,
		/if \[ "\$job_known" -eq 1 \]; then\n\tappear_deadline=/,
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
 */
test("a failed notification does not change the watchdog's decision or its exit status", async () => {
	const dir = tempDir("lo-watchdog-notify-");
	const fixture = makeWatchdogFixture(dir);
	// No job: the first path, where the app is started as soon as it is gone.
	fixture.setNotifierExit(1);
	const app = startProcess("/bin/sleep", ["30"]);
	const plan = buildWatchdogPlan({
		appBundlePath: fixture.bundle,
		executableName: "Fixture",
		appPid: app.pid,
		shipItJob: "com.local-operator.ShipIt",
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
	const result = await watchdog.exit;
	assert.equal(result.code, 0);
	assert.equal(await waitForLaunches(fixture, before + 1), true);
	assert.ok(
		fixture.notifications().length > 0,
		"the failing notifier was never called, so this proves nothing",
	);
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
		ARTIFACT.size + INSTALLED * 2 + INSTALL_DISK_SLACK_BYTES,
	);
	assert.ok(needed > ARTIFACT.size * 3);

	const full = staged(needed - 1);
	assert.equal(full.ok, false);
	assert.equal(full.block.code, "insufficient-disk-space");
	assert.match(full.block.message, /version 0\.18\.0/);
	assert.match(full.block.detail, /two 1\.0 GiB app copies/);

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

	// A source-built uv tool install must not be upgraded from the registry: that
	// would replace the operator's own build with the stock package.
	const sourceBuilt = resolveGlobalInstallPlan({
		identity: uvIdentity,
		lopUpdatePath: "/Users/operator/.local/bin/lop-update",
	});
	assert.equal(sourceBuilt.canManageUpdate, false);
	assert.equal(sourceBuilt.updateCommand, "lop-update");

	const registryUv = resolveGlobalInstallPlan({
		identity: uvIdentity,
		lopUpdatePath: null,
	});
	assert.equal(registryUv.canManageUpdate, false);
	assert.equal(registryUv.updateCommand, "uv tool upgrade local-operator");
	assert.match(registryUv.remedy, /uv tool install/);

	const pipx = resolveGlobalInstallPlan({
		identity: {
			path: "/Users/operator/.local/pipx/venvs/local-operator/bin/local-operator",
		},
		lopUpdatePath: null,
	});
	assert.equal(pipx.updateCommand, "pipx upgrade local-operator");
	assert.equal(pipx.canManageUpdate, false);

	const pip = resolveGlobalInstallPlan({
		identity: {
			path: "/Users/operator/venv/bin/local-operator",
			venvPrefix: "/Users/operator/venv",
		},
		lopUpdatePath: null,
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
		lopUpdatePath: null,
	});
	assert.equal(unknown.canManageUpdate, false);
	assert.equal(unknown.updateCommand, "");
	assert.match(unknown.remedy, /could not tell how/);
	assert.doesNotMatch(unknown.remedy, /pip install/);
	assert.match(unknown.detail, /was not found on PATH/);

	const unidentified = resolveGlobalInstallPlan({
		identity: { path: "/opt/bin/local-operator" },
		lopUpdatePath: null,
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
		lopUpdatePath: null,
	});
	assert.doesNotMatch(plan.updateCommand, /^pip install/);
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
	// that install has to classify as the uv tool install whose remedy is the
	// source-build instruction rather than a pip or pipx command.
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

	const lopLaunchd = resolveCommandPath("lop-update", { env: appEnv, home });
	assert.equal(
		resolveCommandPath("lop-update", { env: loginEnv, home }),
		lopLaunchd,
	);
	if (!lopLaunchd) {
		t.diagnostic("no lop-update here: the source-build remedy is not nameable");
		return;
	}
	const plan = resolveGlobalInstallPlan({
		identity: readInstallIdentity(underLaunchd),
		lopUpdatePath: lopLaunchd,
	});
	assert.equal(plan.sourceBuild, true);
	assert.equal(plan.updateCommand, "lop-update");
	assert.equal(plan.canManageUpdate, false);
	assert.doesNotMatch(plan.updateCommand, /^pip /);
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
		["app-codesign", "app-spctl", "app-stapler", "dmg-spctl", "dmg-stapler"],
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
		["dmg-spctl", "dmg-stapler"],
	);
	assert.match(failing.failures[0].output, /no usable signature/);

	// The same artifacts after the fix: image signed, notarized and stapled.
	const fixed = (command, args) => {
		const joined = args.join(" ");
		if (joined.includes("stapler validate")) {
			return { status: 0, stdout: "The validate action worked!", stderr: "" };
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
		globalThis.__loNotarizeBehavior = undefined;

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
		globalThis.__loNotarizeCalls = undefined;
		globalThis.__loNotarizeBehavior = undefined;
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
		globalThis.__loNotarizeCalls = undefined;
		globalThis.__loNotarizeBehavior = undefined;
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
			lopUpdatePath: null,
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
		lopUpdatePath: null,
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
 */
const loadUpdateServiceModule = async () => {
	const fixture = (contents) => ({ contents, loader: "js" });
	const bundle = await build({
		stdin: {
			contents:
				'export * from "./src/main/update-service"; export * from "./src/main/backend/backend-service";',
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
					builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
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
									getVersion: () => "0.0.0-test",
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
							`);
						}
						return fixture(`
							const logger = () => ({
								info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
								verbose: () => {}, silly: () => {},
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
			{ getStartupMode: () => service.LocalOperatorStartupMode.GLOBAL_INSTALL },
		);
		interval = updateService.updateCheckInterval;
		// Keep the health probe off anything real: the constructor derives this
		// URL from config, and a live server on that port would be a session this
		// test must not touch.
		updateService.backendUrl = "http://127.0.0.1:9";
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
		globalThis.__loTestPaths = undefined;
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
			globalThis.__loIpcHandlers = undefined;
			const updateService = new service.UpdateService(
				{
					isDestroyed: () => false,
					webContents: {
						send: (channel, payload) => sent.push({ channel, payload }),
						isDestroyed: () => false,
					},
				},
				{ getStartupMode: () => startupMode },
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
		globalThis.__loIpcHandlers = undefined;
		globalThis.__loTestPaths = undefined;
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
	npxVersion = null,
}) => {
	const home = mkdtempSync(join(tmpdir(), "lo-verdict-home-"));
	const userData = mkdtempSync(join(tmpdir(), "lo-verdict-userdata-"));
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	const { service, serviceDir } = await loadUpdateServiceModule();
	const sent = [];
	let interval = null;
	let health = null;
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
					result: serverAnswersVersion ? { version: serverVersion } : {},
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
			{
				getStartupMode: () => service.LocalOperatorStartupMode.GLOBAL_INSTALL,
			},
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
		globalThis.__loTestAppCheck = appCheck;
		/*
		 * The fixture's `ipcMain.handle` RECORDS the handlers (see its own comment),
		 * which is how a case can call the function the app would call - the same
		 * route the quit-for-update-install case above takes to its decision.
		 */
		let verdict;
		if (ipc) {
			globalThis.__loIpcHandlers = undefined;
			updateService.setupIpcHandlers();
			const handler = globalThis.__loIpcHandlers?.["check-for-all-updates"];
			assert.equal(
				typeof handler,
				"function",
				"the aggregate check must have a handler for the renderer to invoke",
			);
			verdict = await handler({}, ipc.options);
		} else {
			verdict = await updateService.checkForAllUpdates(false);
		}
		return { verdict, sent };
	} finally {
		globalThis.__loTestAppCheck = undefined;
		globalThis.__loIpcHandlers = undefined;
		if (interval) clearInterval(interval);
		if (health) {
			health.closeAllConnections();
			health.close();
		}
		globalThis.__loTestPaths = undefined;
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
 * The other half of Q2: the fix must not reclassify anything this product
 * actually publishes. These are the comparisons the update path has always
 * made, kept as themselves so a future tightening of the grammar names the
 * release form it broke.
 */
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
		if (originalProbe === undefined) globalThis.__loUpdaterProbe = undefined;
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
			{ getStartupMode: () => service.LocalOperatorStartupMode.GLOBAL_INSTALL },
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
		globalThis.__loTestPaths = undefined;
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
			{ getStartupMode: () => service.LocalOperatorStartupMode.GLOBAL_INSTALL },
		);
		updateService.backendUrl = "http://127.0.0.1:9";
		return updateService;
	};
	const intervals = [];
	const withService = (jobLoaded) => {
		const updateService = buildService();
		intervals.push(updateService.updateCheckInterval);
		updateService.installJobLoadedProbe = () => jobLoaded;
		return updateService;
	};
	const idle = withService(true);
	const live = withService(true);
	const leftover = withService(false);
	const aged = withService(true);
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

		// A marker the job probe answers no for is not an install. A FAILED install
		// leaves its launchd job loaded for hours (0.17.0: runs=3114), which is the
		// leftover the probe and the recency rule exist to tell apart.
		assert.equal(leftover.quitForInFlightInstall("last window closed"), false);

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
		globalThis.__loTestPaths = undefined;
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
			{ getStartupMode: () => service.LocalOperatorStartupMode.GLOBAL_INSTALL },
		);
		intervals.push(updateService.updateCheckInterval);
		updateService.backendUrl = "http://127.0.0.1:9";
		updateService.installJobLoadedProbe = () => true;
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
			{ getStartupMode: () => service.LocalOperatorStartupMode.GLOBAL_INSTALL },
		);
		intervals.push(fromWindowClose.updateCheckInterval);
		fromWindowClose.backendUrl = "http://127.0.0.1:9";
		fromWindowClose.installJobLoadedProbe = () => true;
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
		globalThis.__loTestPaths = undefined;
		globalThis.__loIpcHandlers = undefined;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
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
		{ getStartupMode: () => service.LocalOperatorStartupMode.GLOBAL_INSTALL },
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
		globalThis.__loTestPaths = undefined;
		globalThis.__loTestIpcHandlers = undefined;
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
		{ getStartupMode: () => service.LocalOperatorStartupMode.GLOBAL_INSTALL },
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
		if (originalPackaged === undefined)
			globalThis.__loTestAppIsPackaged = undefined;
		else globalThis.__loTestAppIsPackaged = originalPackaged;
		globalThis.__loTestPaths = undefined;
		globalThis.__loIpcHandlers = undefined;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
});
