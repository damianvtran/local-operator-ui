import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	PENDING_INSTALL_MARKER_FILE,
	WATCHDOG_TOKEN,
	appBundleFromExecutable,
	buildPipUpgradeCommand,
	buildWatchdogPlan,
	classifyGlobalInstall,
	clearPendingInstallMarker,
	didVersionChange,
	evaluateBundleSeal,
	evaluatePendingInstall,
	escapePgrepPattern,
	installFailurePayload,
	installedBundleSealBlock,
	matchArtifactMetadata,
	parsePendingInstallMarker,
	parsePipShowVersion,
	pendingInstallMarkerPath,
	readPendingInstallMarker,
	requiredDiskBytes,
	resolveGlobalInstallPlan,
	resolveStagedArtifactPath,
	verifyStagedArtifact,
	watchdogIsOurs,
	writePendingInstallMarker,
} = install;

const { dmgArtifacts, removeTransientZip, updateUpdateYmlEntry } = await import(
	"./notarize-artifacts.mjs"
);
const {
	artifactChecks,
	discoverApp,
	discoverDmg,
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
	assert.equal(bad.ok, false);
	assert.match(bad.detail, /not signed at all/);

	// -67028 is the code the operator's ShipIt logged.
	const badFormat = evaluateBundleSeal({
		exitCode: 1,
		stdout:
			"/Applications/Local Operator.app: not a valid code object (errSecCSBadBundleFormat)",
		stderr: "",
	});
	assert.equal(badFormat.ok, false);
	assert.match(badFormat.detail, /errSecCSBadBundleFormat/);

	// A sealed resource is the "damaged" reproduction from the release audit.
	const damaged = evaluateBundleSeal({
		exitCode: 1,
		stdout: "a sealed resource is missing or invalid",
		stderr: "",
	});
	assert.equal(damaged.ok, false);

	assert.deepEqual(evaluateBundleSeal({ exitCode: 0, stdout: "", stderr: "" }), {
		ok: true,
	});

	const block = installedBundleSealBlock(
		"/Applications/Local Operator.app",
		"errSecCSBadBundleFormat",
	);
	assert.equal(block.code, "installed-bundle-not-sealed");
	assert.match(block.message, /can't be updated in place/);
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
		const result = spawnSync(
			"/usr/bin/codesign",
			["--verify", "--deep", "--strict", "--verbose=2", target],
			{ encoding: "utf8" },
		);
		return {
			exitCode: result.status ?? 1,
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
		};
	};

	assert.deepEqual(evaluateBundleSeal(probe(app)), { ok: true });

	// The release audit's "damaged" reproduction: a sealed resource changed
	// after signing. ShipIt refuses a bundle in this state, so the app must
	// refuse to quit for one.
	writeFileSync(join(contents, "Resources", "asset.txt"), "tampered\n", "utf8");
	const broken = evaluateBundleSeal(probe(app));
	assert.equal(broken.ok, false);
	assert.match(broken.detail, /a sealed resource is missing or invalid/);
});

// ---------------------------------------------------------------------------
// Pending-install marker
// ---------------------------------------------------------------------------

test("pending marker survives a write, detects failure or success, and clears", () => {
	const dir = tempDir("lo-marker-");
	assert.equal(pendingInstallMarkerPath(dir).endsWith(PENDING_INSTALL_MARKER_FILE), true);

	assert.equal(readPendingInstallMarker(dir), null);

	const marker = writePendingInstallMarker(dir, {
		targetVersion: "0.18.0",
		artifactPath: "/tmp/local-operator-ui-0.18.0-universal.zip",
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

	const succeeded = evaluatePendingInstall({ marker, runningVersion: "0.18.0" });
	assert.equal(succeeded.kind, "succeeded");
	assert.equal(evaluatePendingInstall({ marker: null, runningVersion: "0.18.0" }).kind, "none");

	assert.equal(clearPendingInstallMarker(dir), true);
	assert.equal(readPendingInstallMarker(dir), null);
	assert.equal(clearPendingInstallMarker(dir), false);

	// A truncated marker must read as "nothing recorded" rather than throw.
	writeFileSync(pendingInstallMarkerPath(dir), "{not json", "utf8");
	assert.equal(readPendingInstallMarker(dir), null);
	assert.equal(parsePendingInstallMarker('{"targetVersion":""}'), null);
});

// ---------------------------------------------------------------------------
// Relaunch watchdog
// ---------------------------------------------------------------------------

test("watchdog waits for the app and ShipIt, then relaunches once, bounded", () => {
	const app = "/Applications/Local Operator.app/Contents/MacOS/Local Operator";
	const plan = buildWatchdogPlan({
		appExecutablePath: app,
		appBundlePath: "/Applications/Local Operator.app",
		executableName: "Local Operator",
	});

	// The paths travel in the environment: `sh -c` exposes the script text as the
	// process's own command line, and pgrep -f would then match the watchdog
	// itself through the very check that waits for the app to exit.
	assert.equal(plan.script.includes("/Applications/Local Operator.app"), false);
	assert.equal(plan.env.LO_UPDATE_WATCHDOG_APP_EXEC, escapePgrepPattern(app));

	// The pattern is escaped for pgrep's extended regex, so `.app` cannot match
	// an arbitrary character.
	assert.match(plan.env.LO_UPDATE_WATCHDOG_APP_EXEC, /\\\.app/);

	// Both waits, the settle, and the no-op guards are present.
	assert.match(plan.script, /while is_running "\$APP"; do/);
	assert.match(plan.script, /while is_running 'ShipIt'; do/);
	assert.match(plan.script, /if is_running "\$APP"; then exit 0; fi/);
	assert.match(plan.script, /deadline=\$\(\( \$\(date \+%s\) \+ 900 \)\)/);
	assert.match(plan.script, new RegExp(WATCHDOG_TOKEN));
	assert.match(plan.script, /open -a "\$BUNDLE"/);
	assert.equal(plan.timeoutSeconds, 900);

	const bounded = buildWatchdogPlan({
		appExecutablePath: app,
		appBundlePath: "/Applications/Local Operator.app",
		executableName: "Local Operator",
		timeoutSeconds: 60,
		intervalSeconds: 1,
		settleSeconds: 1,
	});
	assert.match(bounded.script, /\+ 60 \)\)/);
	assert.match(bounded.script, /sleep 1/);

	assert.equal(escapePgrepPattern("a.b[c](d)"), "a\\.b\\[c\\]\\(d\\)");
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
	url: "local-operator-ui-0.18.0-universal.zip",
	sha512: "c2hhNTEyLWZpeHR1cmU=",
	size: 352792235,
};

test("artifact metadata is matched by file name, not by position", () => {
	assert.deepEqual(
		matchArtifactMetadata(
			"/tmp/pending/local-operator-ui-0.18.0-universal.zip",
			[
				{ url: "local-operator-ui-0.18.0-universal.dmg", size: 1 },
				ARTIFACT,
			],
		),
		ARTIFACT,
	);
	assert.equal(matchArtifactMetadata("/tmp/unknown.zip", [ARTIFACT]), null);
});

test("size, sha512 and free space are each required before the install is offered", () => {
	const ok = verifyStagedArtifact({
		filePath: `/tmp/${ARTIFACT.url}`,
		actualSize: ARTIFACT.size,
		actualSha512: ARTIFACT.sha512,
		metadata: ARTIFACT,
		freeBytes: requiredDiskBytes(ARTIFACT.size),
	});
	assert.equal(ok.ok, true);

	const short = verifyStagedArtifact({
		filePath: `/tmp/${ARTIFACT.url}`,
		actualSize: ARTIFACT.size - 1,
		actualSha512: ARTIFACT.sha512,
		metadata: ARTIFACT,
		freeBytes: requiredDiskBytes(ARTIFACT.size),
	});
	assert.equal(short.ok, false);
	assert.equal(short.block.code, "download-verification-failed");

	const tampered = verifyStagedArtifact({
		filePath: `/tmp/${ARTIFACT.url}`,
		actualSize: ARTIFACT.size,
		actualSha512: "dGFtcGVyZWQ=",
		metadata: ARTIFACT,
		freeBytes: requiredDiskBytes(ARTIFACT.size),
	});
	assert.equal(tampered.ok, false);
	assert.equal(tampered.block.code, "download-verification-failed");

	// The install copies the whole app into a temp directory, so anything less
	// than three times the artifact is not enough room.
	const full = verifyStagedArtifact({
		filePath: `/tmp/${ARTIFACT.url}`,
		actualSize: ARTIFACT.size,
		actualSha512: ARTIFACT.sha512,
		metadata: ARTIFACT,
		freeBytes: requiredDiskBytes(ARTIFACT.size) - 1,
	});
	assert.equal(full.ok, false);
	assert.equal(full.block.code, "insufficient-disk-space");
	assert.equal(requiredDiskBytes(10), 30);

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

test("a staged artifact is resolved from the helper, then the pending cache", () => {
	const dir = tempDir("lo-pending-");
	const file = join(dir, "local-operator-ui-0.18.0-universal.zip");
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
	const uvPath = "/Users/operator/.local/share/uv/tools/local-operator/bin/local-operator";
	assert.equal(classifyGlobalInstall(uvPath), "uv-tool");
	assert.equal(
		classifyGlobalInstall("/Users/operator/.local/pipx/venvs/local-operator/bin/local-operator"),
		"pipx",
	);
	assert.equal(classifyGlobalInstall(null), "global-unknown");

	// A source-built uv tool install must not be upgraded from the registry: that
	// would replace the operator's own build with the stock package.
	const sourceBuilt = resolveGlobalInstallPlan({
		localOperatorPath: uvPath,
		lopUpdatePath: "/Users/operator/.local/bin/lop-update",
	});
	assert.equal(sourceBuilt.canManageUpdate, false);
	assert.equal(sourceBuilt.updateCommand, "lop-update");

	const registryUv = resolveGlobalInstallPlan({
		localOperatorPath: uvPath,
		lopUpdatePath: null,
	});
	assert.equal(registryUv.canManageUpdate, false);
	assert.equal(registryUv.updateCommand, "uv tool upgrade local-operator");

	const pipx = resolveGlobalInstallPlan({
		localOperatorPath: "/opt/pipx/venvs/local-operator/bin/python",
		lopUpdatePath: null,
	});
	assert.equal(pipx.updateCommand, "pipx upgrade local-operator");
	assert.equal(pipx.canManageUpdate, false);

	// The operator's report: GLOBAL_INSTALL with `pip install --upgrade`.
	const unknown = resolveGlobalInstallPlan({
		localOperatorPath: null,
		lopUpdatePath: null,
	});
	assert.equal(unknown.canManageUpdate, false);
	// Every identified layout gets its own installer, and none of them is pip.
	for (const plan of [sourceBuilt, registryUv, pipx]) {
		assert.doesNotMatch(plan.updateCommand, /^pip install --upgrade local-operator$/);
	}
	// An unidentified installer keeps the historical pip line (that is what a
	// plain pip install would need) but the app still refuses to run it itself,
	// and the log records that the installer could not be identified.
	assert.equal(unknown.updateCommand, "pip install --upgrade local-operator");
	assert.match(unknown.detail, /was not found on PATH/);
});

test("the bundled pip invocation is non-interactive and version-verified", () => {
	const pip = buildPipUpgradeCommand("/Applications/Local Operator.app/venv/bin/python3");
	assert.equal(pip.command, "/Applications/Local Operator.app/venv/bin/python3");
	assert.deepEqual(pip.args, [
		"-m",
		"pip",
		"install",
		"--upgrade",
		"--no-input",
		"--disable-pip-version-check",
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
	assert.equal(didVersionChange("0.54.17", "0.54.17"), false);
	assert.equal(didVersionChange("0.54.17", "0.54.18"), true);
	assert.equal(didVersionChange("0.54.17", null), false);
	assert.equal(didVersionChange(null, "0.54.18"), true);
});

// ---------------------------------------------------------------------------
// macOS artifact assertions
// ---------------------------------------------------------------------------

const APP = "/tmp/dist/mac-universal/Local Operator.app";
const DMG = "/tmp/dist/local-operator-ui-0.18.0-universal.dmg";

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
	assert.equal(dmgSpctl.expect({ status: 0, stdout: "rejected", stderr: "" }), false);
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
			return { status: 0, stdout: "accepted\nsource=Notarized Developer ID", stderr: "" };
		}
		if (joined.includes("-t open")) {
			return { status: 0, stdout: "rejected\nsource=no usable signature", stderr: "" };
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
		return { status: 0, stdout: `accepted\nsource=Notarized Developer ID`, stderr: "" };
	};
	assert.equal(summarize(runChecks({ appPath: APP, dmgPath: DMG, run: fixed })).ok, true);
});

test("missing artifacts fail rather than passing vacuously", () => {
	const dir = tempDir("lo-dist-");
	mkdirSync(join(dir, "mac-universal"), { recursive: true });
	const app = join(dir, "mac-universal", "Local Operator.app");
	mkdirSync(app, { recursive: true });

	assert.equal(discoverApp(dir), app);
	assert.equal(discoverDmg(dir), null);

	const lines = [];
	const result = verifyArtifacts({
		dist: dir,
		run: () => ({ status: 0, stdout: "accepted", stderr: "" }),
		log: (line) => lines.push(line),
	});
	assert.equal(result.ok, false);
	assert.match(lines.join("\n"), /No disk image found/);
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

	const dmg = join(dir, "local-operator-ui-0.0.0-universal.dmg");
	const created = spawnSync(
		"/usr/bin/hdiutil",
		["create", "-quiet", "-volname", "Local Operator Fixture", "-srcfolder", source, "-ov", "-format", "UDZO", dmg],
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
	assert.deepEqual(
		verdict.failures.map((result) => result.id).sort(),
		["dmg-spctl", "dmg-stapler"],
	);

	// The operator's own downloaded 0.17.0 image is the real negative fixture.
	// It is 366 MB and machine-local, so it is checked only when it is there -
	// and the synthetic case above is what keeps this runnable in CI.
	const fixture =
		process.env.LO_UI_DMG_FIXTURE ??
		join(process.env.HOME ?? "", "Downloads", "local-operator-ui-0.17.0-universal.dmg");
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
	assert.deepEqual(
		shippedChecks.failures.map((result) => result.id).sort(),
		["dmg-spctl", "dmg-stapler"],
	);
});

// ---------------------------------------------------------------------------
// Disk image notarization step
// ---------------------------------------------------------------------------

test("the disk image step targets images and leaves the app archive alone", () => {
	const artifacts = [
		"/dist/local-operator-ui-0.18.0-universal.dmg",
		"/dist/local-operator-ui-0.18.0-universal.zip",
		"/dist/latest-mac.yml",
	];
	assert.deepEqual(dmgArtifacts(artifacts), [
		"/dist/local-operator-ui-0.18.0-universal.dmg",
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
		"  - url: local-operator-ui-0.18.0-universal.zip",
		"    sha512: ZIPHASH",
		"    size: 352792235",
		"  - url: local-operator-ui-0.18.0-universal.dmg",
		"    sha512: PRE_STAPLE",
		"    size: 366211328",
		"path: local-operator-ui-0.18.0-universal.zip",
		"sha512: ZIPHASH",
		"releaseDate: '2026-09-10T20:51:00.143Z'",
		"",
	].join("\n");

	const updated = updateUpdateYmlEntry(
		yml,
		"local-operator-ui-0.18.0-universal.dmg",
		{ sha512: "POST_STAPLE", size: 366211329 },
	);
	assert.match(updated, /sha512: POST_STAPLE/);
	assert.match(updated, /size: 366211329/);
	assert.equal(updated.includes("PRE_STAPLE"), false);
	// The zip entry is the app archive the updater downloads: it must not move.
	assert.equal((updated.match(/sha512: ZIPHASH/g) ?? []).length, 2);
	assert.match(updated, /releaseDate: '2026-09-10T20:51:00\.143Z'/);

	assert.equal(
		updateUpdateYmlEntry(yml, "some-other.dmg", { sha512: "X", size: 1 }),
		yml,
	);
});
