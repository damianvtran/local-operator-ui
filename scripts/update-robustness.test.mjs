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
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
	resolveDistributionMarkers,
	resolveGlobalInstallPlan,
	resolveStagedArtifactPath,
	shipItCacheDir,
	shipItJobLabel,
	verifyStagedArtifact,
	readInstallIdentity,
	resolveCommandPath,
	watchdogIsOurs,
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
	// deadline path falls through to it (review Q1), and the decision it waits on
	// is made of the job going AND the swap landing on disk (review R11).
	assert.match(plan.script, /deadline=\$\(\( \$\(now\) \+ 600 \)\)/);
	assert.match(plan.script, /if app_running; then exit 0; fi\nif \[ -n "\$NAME" \]/);
	assert.match(plan.script, /open -a "\$BUNDLE"/);
	assert.match(plan.script, new RegExp(WATCHDOG_TOKEN));
	// The on-disk half of the decision: the version in the target bundle's own
	// Info.plist, read with plutil rather than through a preference domain.
	assert.match(plan.script, /plutil -extract CFBundleShortVersionString raw/);
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

	assert.equal(shipItJobLabel("com.local-operator"), "com.local-operator.ShipIt");
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
	assert.equal(watchdogSwapTarget({ target: "0.17.0", running: "0.17.0" }), null);
	assert.equal(watchdogSwapTarget({ target: "v0.17.0", running: "0.17.0" }), null);
	// Already past it: with the at-or-beyond compare this target would answer yes
	// before the install begins, so it is dropped for the same reason (Q6).
	assert.equal(watchdogSwapTarget({ target: "0.16.0", running: "0.17.0" }), null);
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
	spawnSync("/bin/chmod", ["+x", openShim, launchctlShim, executable]);

	return {
		bundle,
		binDir,
		stateFile,
		launchLog: log,
		setVersion,
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
			// A bound long enough that reaching it is distinguishable from leaving
			// on the swap: a pass here cannot be a pass by timeout.
			timeoutSeconds: 120,
			intervalSeconds: 1,
			settleSeconds: 1,
			appearSeconds: 1,
			...overrides,
		});

	// 1. The hung install that DID swap: the job stays loaded forever and the new
	//    app is in place. The app comes back in seconds, not at 120 s.
	{
		writeFileSync(fixture.stateFile, "loaded\n", "utf8");
		fixture.setVersion("0.18.0");
		const app = startProcess("/bin/sleep", ["30"]);
		const before = fixture.launches().length;
		const watchdog = runWatchdog({ plan: planFor(app.pid), binDir: fixture.binDir });
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
	//    into a live install, even past the point where the swap check would fire.
	{
		fixture.setVersion("0.17.0");
		writeFileSync(fixture.stateFile, "loaded\n", "utf8");
		const app = startProcess("/bin/sleep", ["30"]);
		const before = fixture.launches().length;
		const watchdog = runWatchdog({
			plan: planFor(app.pid, { timeoutSeconds: 4 }),
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
		const watchdog = runWatchdog({ plan: planFor(app.pid), binDir: fixture.binDir });
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
	const underLaunchd = resolveCommandPath("local-operator", { env: appEnv, home });
	const underLogin = resolveCommandPath("local-operator", { env: loginEnv, home });
	if (!underLaunchd || !underLogin) {
		t.skip("no local-operator installed outside this machine's PATH");
		return;
	}
	assert.equal(underLaunchd, underLogin);
	assert.equal(classifyGlobalInstall(readInstallIdentity(underLogin)), "uv-tool");

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
			"  - url: local-operator-ui-0.18.0-universal.dmg",
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
		name: "local-operator-ui-0.18.0-universal.dmg",
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
				name: "local-operator-ui-0.18.0-universal.dmg",
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
				name: "local-operator-ui-0.18.0-universal.dmg",
				sha512: "POST_STAPLE",
				size: 366211329,
			}),
		/has no entry in latest-linux\.yml/,
	);
	assert.throws(
		() =>
			rewriteUpdateMetadata({
				ymlPaths: [],
				name: "local-operator-ui-0.18.0-universal.dmg",
				sha512: "POST_STAPLE",
				size: 366211329,
			}),
		/no update metadata was found to re-hash it in/,
	);
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
		artifactPath: "/tmp/local-operator-ui-0.18.0-universal.zip",
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
	assert.ok(found && found.endsWith("uv.EXE"), `expected an .exe, got ${found}`);
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
	assert.ok(noPathext && noPathext.endsWith("pipx.EXE"), `${noPathext}`);

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
		env: { PATH: "/nonexistent-on-this-host", HOME: home, UV_TOOL_DIR: toolRoot },
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
		env: { PATH: "/nonexistent-on-this-host", HOME: home, XDG_DATA_HOME: dataHome },
		home,
		platform: "darwin",
		listDir: (dir) => (dir === join(dataHome, "uv", "tools") ? ["local-operator"] : []),
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
 * test, and the script says in place why that one stays.
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
			.map(([installed, target]) => `version_at_least '${installed}' '${target}'; echo $?`)
			.join("\n")}\n`,
	);
	const output = spawnSync("/bin/sh", [ruleFile], { encoding: "utf8" });
	rmSync(workDir, { recursive: true, force: true });
	assert.equal(output.status, 0, output.stderr);
	const answers = output.stdout.trim().split("\n").map((line) => line.trim() === "0");
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
			disagreeing.push(`${installed} vs ${target}: shell=${shell} renderer=${renderer}`);
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
		emptyOutput.stdout.trim().split("\n").map((line) => line.trim() === "0"),
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
		/\/usr\/bin\/plutil -extract CFBundleShortVersionString raw -o - "\$_plist"/,
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
	globalThis.__loTestPaths = { home, userData, appData: userData, temp: tmpdir() };
	// The bundled module graph is the app's main process, so the fixtures have to
	// cover every surface it touches at import time: `app.getPath` for the logger
	// and the pending-install marker, `electron-log`'s transports, and the
	// autoUpdater object the constructor configures.
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
									isPackaged: true,
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
								export const ipcMain = { handle: () => {}, on: () => {}, once: () => {}, removeHandler: () => {}, removeAllListeners: () => {} };
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
								export const autoUpdater = {
									on: () => {}, once: () => {}, removeAllListeners: () => {},
									checkForUpdates: async () => null,
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
	// Imported from a real path rather than a `data:` URL: the banner shim above
	// needs an `import.meta.url` that `createRequire` can resolve.
	const service = await import(serviceFile);
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
		delete globalThis.__loTestPaths;
		rmSync(serviceDir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(userData, { recursive: true, force: true });
	}
});
