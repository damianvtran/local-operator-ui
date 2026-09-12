import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
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
	INSTALL_DISK_SLACK_BYTES,
	PENDING_INSTALL_MARKER_FILE,
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
	installFailurePayload,
	installedBundleSealBlock,
	lastInstallAttemptPath,
	matchArtifactMetadata,
	measureDirectoryBytes,
	parsePendingInstallMarker,
	parsePipShowVersion,
	pendingInstallMarkerPath,
	readLastInstallAttempt,
	readPendingInstallMarker,
	reapFailedInstall,
	recordInstallFailure,
	requiredDiskBytes,
	resolveGlobalInstallPlan,
	resolveStagedArtifactPath,
	shipItCacheDir,
	shipItJobLabel,
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

	assert.deepEqual(evaluateBundleSeal({ exitCode: 0, stdout: "", stderr: "" }), {
		kind: "sealed",
	});

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

/**
 * A marker whose target is OLDER than the running version is not a failed
 * install: the machine has moved past it. Reporting it as one told a user on
 * 0.17.0 that an install of 0.9.0 had failed (review Q2).
 */
test("a superseded marker is stale, not a failed update", () => {
	const marker = {
		targetVersion: "0.9.0",
		artifactPath: "/tmp/local-operator-ui-0.9.0-universal.zip",
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

test("the failed install is recorded so a dismiss is not the end of the record", () => {
	const dir = tempDir("lo-attempt-");
	assert.equal(readLastInstallAttempt(dir), null);

	const marker = {
		targetVersion: "0.18.0",
		artifactPath: "/tmp/local-operator-ui-0.18.0-universal.zip",
		startedAt: "2026-09-11T22:36:48.000Z",
		watchdogPid: 4242,
	};
	const payload = installFailurePayload(marker, "0.17.0");
	assert.equal(lastInstallAttemptPath(dir).endsWith("last-update-install.json"), true);

	const first = recordInstallFailure(dir, {
		payload,
		startedAt: marker.startedAt,
		detectedAt: "2026-09-12T00:00:00.000Z",
	});
	assert.equal(first.attempts, 1);
	const second = recordInstallFailure(dir, {
		payload,
		startedAt: marker.startedAt,
		detectedAt: "2026-09-12T01:00:00.000Z",
	});
	assert.equal(second.attempts, 2);
	assert.deepEqual(readLastInstallAttempt(dir), second);

	// A different target is a new record, not a third attempt at this one.
	const other = recordInstallFailure(dir, {
		payload: { ...payload, targetVersion: "0.19.0" },
		startedAt: null,
		detectedAt: "2026-09-12T02:00:00.000Z",
	});
	assert.equal(other.attempts, 1);

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
			artifactPath: "/tmp/local-operator-ui-0.18.0-universal.zip",
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
	assert.match(payload.detail, /local-operator-ui-0\.18\.0-universal\.zip/);
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
	assert.equal(plan.env.LO_UPDATE_WATCHDOG_SHIPIT_JOB, "com.local-operator.ShipIt");

	// No name probe survives in the executable part of the script (the comments
	// mention pgrep to explain why it is gone), and both real signals are in it:
	// the app's own pid, and the job label.
	const code = plan.script
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("#"))
		.join("\n");
	assert.doesNotMatch(code, /pgrep/);
	assert.match(code, /kill -0 "\$APP_PID"/);
	assert.match(code, /launchctl list "\$SHIPIT_JOB"/);

	// The relaunch attempt is not conditional on reaching the end of a wait: the
	// deadline path falls through to it (review Q1).
	assert.match(plan.script, /deadline=\$\(\( \$\(now\) \+ 900 \)\)/);
	assert.match(plan.script, /if app_running; then exit 0; fi\nif \[ -n "\$NAME" \]/);
	assert.match(plan.script, /open -a "\$BUNDLE"/);
	assert.match(plan.script, new RegExp(WATCHDOG_TOKEN));
	assert.equal(plan.timeoutSeconds, 900);

	const bounded = buildWatchdogPlan({
		appBundlePath: "/Applications/Local Operator.app",
		executableName: "Local Operator",
		appPid: 1,
		shipItJob: null,
		timeoutSeconds: 60,
		intervalSeconds: 1,
		settleSeconds: 1,
		appearSeconds: 2,
	});
	assert.match(bounded.script, /\+ 60 \)\)/);
	assert.match(bounded.script, /appear_deadline=\$\(\( \$\(now\) \+ 2 \)\)/);
	assert.match(bounded.script, /sleep 1/);
	// Without a label there is no job to ask about, and the script still waits on
	// the pid alone rather than falling back to a name.
	assert.equal(bounded.env.LO_UPDATE_WATCHDOG_SHIPIT_JOB, "");

	assert.equal(shipItJobLabel("com.local-operator"), "com.local-operator.ShipIt");
	assert.equal(
		shipItCacheDir("/Users/operator/Library/Caches", "com.local-operator"),
		"/Users/operator/Library/Caches/com.local-operator.ShipIt",
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

/** A fixture "app" bundle plus the two commands the watchdog shells out to. */
function makeWatchdogFixture(dir) {
	const log = join(dir, "launches.log");
	const bundle = join(dir, "Fixture.app");
	mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
	const executable = join(bundle, "Contents", "MacOS", "Fixture");
	writeFileSync(executable, "#!/bin/sh\nexit 0\n", "utf8");

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
	spawnSync("/bin/chmod", ["+x", openShim, launchctlShim, executable]);

	return {
		bundle,
		binDir,
		stateFile,
		launchLog: log,
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
	};
	const planFor = (pid, overrides = {}) =>
		buildWatchdogPlan({
			appBundlePath: fixture.bundle,
			executableName: "Fixture",
			appPid: pid,
			shipItJob: "com.local-operator.ShipIt",
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

	// 3. The hung install: the job never goes away. The watchdog must still try at
	//    its deadline rather than exiting with the user left with no app (Q1).
	{
		writeFileSync(fixture.stateFile, "loaded\n", "utf8");
		const app = startProcess("/bin/sleep", ["30"]);
		const plan = planFor(app.pid);
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
	writeFileSync(join(cacheDir, "ShipIt_stderr.log"), "Could not read update request\n", "utf8");

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
		removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
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
	assert.equal(needed, ARTIFACT.size + INSTALLED * 2 + INSTALL_DISK_SLACK_BYTES);
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
	writeFileSync(join(dir, "Contents", "MacOS", "Fixture"), "x".repeat(4096), "utf8");
	writeFileSync(join(dir, "Contents", "Info.plist"), "y".repeat(1024), "utf8");
	assert.equal(measureDirectoryBytes(dir), 5120);
	// A path that is not there is "could not measure", never zero: the difference
	// decides whether the free-space guard uses the app's footprint at all.
	assert.equal(measureDirectoryBytes(join(dir, "nope")), null);
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
	const kind = classifyGlobalInstall({
		path: shimPath,
		realPath,
		shebang: firstLine.startsWith("#!") ? firstLine : null,
	});
	assert.notEqual(kind, "global-unknown");
	const plan = resolveGlobalInstallPlan({
		identity: { path: shimPath, realPath, shebang: firstLine },
		lopUpdatePath: null,
	});
	assert.doesNotMatch(plan.updateCommand, /^pip install/);
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
 * `package.json` builds one universal dmg today, so checking only the first was
 * complete by accident rather than by construction - and `mac.target` already
 * lists both a dmg and a zip, so a per-arch matrix would leave images
 * unaudited (review R9).
 */
test("every discovered image is checked, and an unreadable entry fails cleanly", () => {
	const dir = tempDir("lo-dist-multi-");
	mkdirSync(join(dir, "mac-arm64"), { recursive: true });
	mkdirSync(join(dir, "mac-x64"), { recursive: true });
	mkdirSync(join(dir, "mac-arm64", "Local Operator.app"), { recursive: true });
	mkdirSync(join(dir, "mac-x64", "Local Operator.app"), { recursive: true });
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
			return { status: 0, stdout: "accepted", stderr: "" };
		},
		log: (line) => lines.push(line),
	});
	assert.equal(result.ok, true);
	// 3 app checks and 2 image checks per artifact: nothing is left unaudited.
	assert.equal(result.results.length, 2 * 3 + 2 * 2);
	assert.equal(checked.length, result.results.length);
	for (const target of [...discovered.apps, ...discovered.dmgs]) {
		assert.ok(checked.includes(target), `${target} was never checked`);
	}
	for (const target of [...discovered.apps, ...discovered.dmgs]) {
		assert.match(lines.join("\n"), new RegExp(target.replace(/[/.]/g, "\\$&")));
	}

	// A broken symlink where an image should be fails the check rather than
	// throwing out of discovery.
	const brokenDir = tempDir("lo-dist-broken-");
	mkdirSync(join(brokenDir, "mac-universal"), { recursive: true });
	spawnSync("/bin/ln", ["-s", "/nonexistent/dist", join(brokenDir, "mac-universal", "Ghost.app")]);
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
