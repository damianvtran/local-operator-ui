import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	buildReport,
	parseArguments,
	parseShipItProcesses,
} from "./update-window-report.mjs";

/**
 * The install window, read back from the two logs that record it.
 *
 * WHY THESE CASES. Every number in the change this file lands beside is a claim
 * about how long a user waits with no app - 4 min 30 s on 2026-09-18, 1.7 s the
 * day before, and one install cancelled outright four minutes in - and until this
 * report existed, all of them were read out of a log by hand. A parser that
 * silently mis-reads a phase would make the next such claim wrong in the same
 * direction every time, so the cases below pin the numbers, the attribution and
 * the verdicts against REAL ShipIt output.
 *
 * THE FIXTURE IS THE REAL LOG, not a synthesised one: the lines below are the
 * 08:37 (fast), 09:37 (cancelled) and 11:59 (slow) installs of 2026-09-17/18
 * copied out of `ShipIt_stderr.log` and `update-service.log` verbatim, including
 * the Objective-C `ERROR: Unrecognized attribute string flag` noise ShipIt
 * interleaves and the two `Moving bundle` lines per install (out of
 * `/Applications` and back into it) whose order is what the longest phase is
 * measured between.
 *
 * WHAT IS NOT COVERED HERE: a live machine's log, which the PR's own evidence run
 * pastes instead, and macOS's own `codesign` timing, which is
 * `scripts/sec-check.c`'s job.
 */

const SHIPIT_FIXTURE = `2026-09-17 08:37:35.823 ShipIt[89050:38526915] Detected this as an install request
ERROR: Unrecognized attribute string flag '?' in attribute string "T@"NSString",?,R,C" for property debugDescription
ERROR: Unrecognized attribute string flag '?' in attribute string "T@"NSString",?,R,C" for property debugDescription
2026-09-17 08:37:35.983 ShipIt[89050:38526982] Beginning installation
2026-09-17 08:37:51.557 ShipIt[89050:38526981] Moving bundle from file:///Applications/Local%20Operator.app/ to file:///var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/com.local-operator.ShipIt.lMhv9onu/Local%20Operator.app
2026-09-17 08:37:51.601 ShipIt[89050:38526981] Moving bundles directly as SquirrelMacEnableDirectContentsWrite is disabled for app: com.local-operator.ShipIt
2026-09-17 08:37:51.624 ShipIt[89050:38526981] Moved bundle contents from file:///Applications/Local%20Operator.app/ to file:///var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/com.local-operator.ShipIt.lMhv9onu/Local%20Operator.app
2026-09-17 08:37:51.624 ShipIt[89050:38526981] Moving bundle from file:///var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/com.local-operator.ShipIt.y47pMMnW/Local%20Operator.app to file:///Applications/Local%20Operator.app/
2026-09-17 08:37:51.624 ShipIt[89050:38526981] Moving bundles directly as SquirrelMacEnableDirectContentsWrite is disabled for app: com.local-operator.ShipIt
2026-09-17 08:37:51.624 ShipIt[89050:38526981] Moved bundle contents from file:///var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/com.local-operator.ShipIt.y47pMMnW/Local%20Operator.app to file:///Applications/Local%20Operator.app/
2026-09-17 08:37:56.851 ShipIt[89050:38529568] On main thread and launching: file:///Applications/Local%20Operator.app/
2026-09-17 08:37:56.851 ShipIt[89050:38529568] Bundle URL is valid
2026-09-17 08:37:56.851 ShipIt[89050:38529568] Attempting to launch app on 11.0 or higher
2026-09-17 08:37:56.851 ShipIt[89050:38529568] Launching new ShipIt at /Applications/Local Operator.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt with instructions to launch file:///Applications/Local%20Operator.app/
2026-09-17 08:37:56.851 ShipIt[89050:38526981] Installation completed successfully
2026-09-17 08:37:56.855 ShipIt[89050:38529568] New ShipIt pid: 90421
2026-09-17 08:37:58.050 ShipIt[90421:38530765] Detected this as a launch request
2026-09-17 08:37:58.222 ShipIt[90421:38530765] Successfully launched application at file:///Applications/Local%20Operator.app/
2026-09-17 08:37:58.222 ShipIt[90421:38530765] ShipIt quitting
2026-09-17 08:37:58.223 ShipIt[89050:38529568] ShipIt status 0
2026-09-17 08:37:58.223 ShipIt[89050:38529568] New ShipIt exited
2026-09-17 08:37:58.224 ShipIt[89050:38529568] ShipIt quitting
2026-09-18 09:37:12.200 ShipIt[64040:68720787] Detected this as an install request
ERROR: Unrecognized attribute string flag '?' in attribute string "T@"NSString",?,R,C" for property debugDescription
ERROR: Unrecognized attribute string flag '?' in attribute string "T@"NSString",?,R,C" for property debugDescription
2026-09-18 09:37:14.767 ShipIt[64040:68720868] Beginning installation
2026-09-18 09:41:04.131 ShipIt[64040:68720868] Aborting update attempt because there are 1 running instances of the target app
2026-09-18 09:41:04.143 ShipIt[64040:68722464] Installation cancelled: Error Domain=SQRLInstallerErrorDomain Code=-9 "App Still Running Error" UserInfo={NSLocalizedDescription=App Still Running Error, NSLocalizedRecoverySuggestion=All instances of the target application should be quit during the update process}
2026-09-18 09:41:04.146 ShipIt[64040:68722464] ShipIt quitting
2026-09-18 11:59:00.991 ShipIt[73823:71609409] Detected this as an install request
ERROR: Unrecognized attribute string flag '?' in attribute string "T@"NSString",?,R,C" for property debugDescription
ERROR: Unrecognized attribute string flag '?' in attribute string "T@"NSString",?,R,C" for property debugDescription
2026-09-18 11:59:03.330 ShipIt[73823:71609591] Beginning installation
2026-09-18 12:03:29.903 ShipIt[73823:71609590] Moving bundle from file:///Applications/Local%20Operator.app/ to file:///var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/com.local-operator.ShipIt.VCAmx3QQ/Local%20Operator.app
2026-09-18 12:03:29.926 ShipIt[73823:71609590] Moving bundles directly as SquirrelMacEnableDirectContentsWrite is disabled for app: com.local-operator.ShipIt
2026-09-18 12:03:29.928 ShipIt[73823:71609590] Moved bundle contents from file:///Applications/Local%20Operator.app/ to file:///var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/com.local-operator.ShipIt.VCAmx3QQ/Local%20Operator.app
2026-09-18 12:03:29.928 ShipIt[73823:71609590] Moving bundle from file:///var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/com.local-operator.ShipIt.LtceYl0P/Local%20Operator.app to file:///Applications/Local%20Operator.app/
2026-09-18 12:03:29.929 ShipIt[73823:71609590] Moving bundles directly as SquirrelMacEnableDirectContentsWrite is disabled for app: com.local-operator.ShipIt
2026-09-18 12:03:29.930 ShipIt[73823:71609590] Moved bundle contents from file:///var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/com.local-operator.ShipIt.LtceYl0P/Local%20Operator.app to file:///Applications/Local%20Operator.app/
2026-09-18 12:04:24.946 ShipIt[73823:71707464] On main thread and launching: file:///Applications/Local%20Operator.app/
2026-09-18 12:04:24.969 ShipIt[73823:71707464] Bundle URL is valid
2026-09-18 12:04:24.969 ShipIt[73823:71707464] Attempting to launch app on 11.0 or higher
2026-09-18 12:04:24.951 ShipIt[73823:71609590] Installation completed successfully
2026-09-18 12:04:24.974 ShipIt[73823:71707464] Launching new ShipIt at /Applications/Local Operator.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt with instructions to launch file:///Applications/Local%20Operator.app/
2026-09-18 12:04:25.058 ShipIt[73823:71707464] New ShipIt pid: 1612
2026-09-18 12:04:25.413 ShipIt[1612:71714004] Detected this as a launch request
2026-09-18 12:04:27.173 ShipIt[1612:71714004] Successfully launched application at file:///Applications/Local%20Operator.app/
2026-09-18 12:04:27.173 ShipIt[1612:71714004] ShipIt quitting
2026-09-18 12:04:27.175 ShipIt[73823:71707464] ShipIt status 0
2026-09-18 12:04:27.176 ShipIt[73823:71707464] New ShipIt exited
2026-09-18 12:04:27.180 ShipIt[73823:71707464] ShipIt quitting`;

const APP_FIXTURE = `[2026-09-17 08:37:32.980] [info]  Pending install marker written for version 0.26.5 (watchdog pid 88780).
[2026-09-17 08:37:35.784] [info]  Quitting so the in-flight update install can finish (last window closed).
[2026-09-17 08:38:00.790] [info]  Update service initialized. Dev mode: false, NPX install: false
[2026-09-18 09:37:09.508] [info]  Pending install marker written for version 0.28.3 (watchdog pid 63891).
[2026-09-18 09:37:12.086] [info]  Quitting so the in-flight update install can finish (last window closed).
[2026-09-18 09:37:33.351] [info]  Update service initialized. Dev mode: false, NPX install: false
[2026-09-18 09:37:33.369] [info]  Update marker: the install of version 0.28.3 is still running (its install job is loaded). Leaving the marker, the install job and the relaunch watchdog in place.
[2026-09-18 09:37:43.771] [info]  Quitting so the in-flight update install can finish.
[2026-09-18 09:38:20.599] [info]  Update service initialized. Dev mode: false, NPX install: false
[2026-09-18 09:38:20.619] [info]  Update marker: the install of version 0.28.3 is still running (its install job is loaded). Leaving the marker, the install job and the relaunch watchdog in place.
[2026-09-18 11:58:56.054] [info]  Pending install marker written for version 0.28.4 (watchdog pid 73580).
[2026-09-18 11:59:00.520] [info]  Quitting so the in-flight update install can finish (last window closed).
[2026-09-18 12:03:40.686] [info]  Update service initialized. Dev mode: false, NPX install: false`;

/** Both fixture logs written into a scratch directory, and a way to remove it. */
const withFixtureLogs = (run) => {
	const dir = mkdtempSync(join(tmpdir(), "lo-update-window-"));
	const shipitLog = join(dir, "ShipIt_stderr.log");
	const appLog = join(dir, "update-service.log");
	writeFileSync(shipitLog, `${SHIPIT_FIXTURE}\n`);
	writeFileSync(appLog, `${APP_FIXTURE}\n`);
	try {
		return run({ shipitLog, appLog });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

/** The report over the fixture logs, with the window and limit a case asks for. */
const reportFor = (extra = {}) =>
	withFixtureLogs(({ shipitLog, appLog }) =>
		buildReport({
			json: true,
			limit: null,
			since: null,
			until: null,
			shipitLog,
			appLog,
			...extra,
		}),
	);

const near = (actual, expected, what, tolerance = 0.02) => {
	assert.ok(
		typeof actual === "number" && Math.abs(actual - expected) <= tolerance,
		`${what}: expected ${expected} +/- ${tolerance}, got ${actual}`,
	);
};

test("the 11:59 install reads as the four and a half minutes it cost", () => {
	return withFixtureLogs(({ shipitLog, appLog }) => {
		const report = buildReport({
			json: true,
			limit: null,
			since: null,
			until: null,
			shipitLog,
			appLog,
		});
		const slow = report.installs[2];
		assert.equal(slow.status, "completed");
		assert.equal(slow.targetVersion, "0.28.4");
		near(
			slow.phases.requestToBeginning,
			2.339,
			"request -> Beginning installation",
		);
		// The phase the whole report exists for: 4 min 27 s of it is here.
		near(
			slow.phases.beginningToMove,
			266.573,
			"Beginning installation -> bundle move",
		);
		near(slow.phases.moveToSwapIn, 0.027, "bundle move -> swap landed");
		near(
			slow.phases.swapInToCompleted,
			55.021,
			"swap landed -> Installation completed",
		);
		near(
			slow.phases.completedToLaunched,
			2.222,
			"Installation completed -> launched",
		);
		// Both readings of the window, because they answer different questions:
		// the swap is when the bundle on disk is the new one, and the app's own
		// first line is when the user has their app back.
		near(slow.closedWindow.toSwapLanding, 268.939, "request -> swap landed");
		near(slow.closedWindow.toAppStart, 279.695, "request -> app back");
		near(
			slow.closedWindow.toShipItLaunch,
			326.182,
			"request -> ShipIt's launch",
		);
		// The app came back AFTER the swap here, which is the install working: the
		// relaunch watchdog starts it as soon as the bundle on disk is the new one.
		assert.equal(slow.appLog.startedDuringInstall, null);
		assert.deepEqual(slow.appLog.inFlightQuits, [
			new Date("2026-09-18T11:59:00.520").toISOString(),
		]);
	});
});

test("the cancelled install reports Squirrel's own reason and the relaunch that caused it", () => {
	return withFixtureLogs(({ shipitLog, appLog }) => {
		const report = buildReport({
			json: true,
			limit: null,
			since: null,
			until: null,
			shipitLog,
			appLog,
		});
		const cancelled = report.installs[1];
		assert.equal(cancelled.status, "cancelled");
		assert.equal(cancelled.targetVersion, "0.28.3");
		assert.match(cancelled.reason, /SQRLInstallerErrorDomain Code=-9/);
		assert.match(cancelled.reason, /App Still Running Error/);
		assert.equal(cancelled.closedWindow.toSwapLanding, null);
		// 3 min 49 s of waiting before Squirrel gave up, which is the whole cost of
		// an install that never swaps anything.
		near(
			cancelled.phases.beginningToTerminal,
			229.376,
			"Beginning installation -> cancelled",
		);
		near(cancelled.closedWindow.toTerminal, 231.943, "request -> cancelled");
		/*
		 * And the cause, which is the app's own log rather than ShipIt's: a packaged
		 * app that started while the install was live, three lines before the
		 * cancellation Squirrel wrote four minutes later. This is the reading the
		 * fix in the same PR removes for a launch - and the one that proves the
		 * report can see it.
		 */
		assert.equal(
			cancelled.appLog.startedDuringInstall,
			new Date("2026-09-18T09:37:33.351").toISOString(),
		);
		assert.equal(cancelled.appLog.inFlightQuits.length, 2);
	});
});

test("an install's own pre-quit line belongs to it, not to the install before it", () => {
	return withFixtureLogs(({ shipitLog, appLog }) => {
		const report = buildReport({
			json: true,
			limit: null,
			since: null,
			until: null,
			shipitLog,
			appLog,
		});
		/*
		 * The app logs `Quitting so the in-flight update install can finish` a few
		 * hundred milliseconds BEFORE ShipIt logs the request it is quitting for, so
		 * a window that ended at the next request would hand that line to the
		 * previous install - the one install it cannot belong to, since its own
		 * marker was already consumed. The fixture holds exactly that pair.
		 */
		const [fast, cancelled, slow] = report.installs;
		const late = new Date("2026-09-18T11:59:00.520").toISOString();
		assert.ok(
			slow.appLog.inFlightQuits.includes(late),
			JSON.stringify(slow.appLog),
		);
		assert.ok(
			!cancelled.appLog.inFlightQuits.includes(late),
			`the 11:59 line leaked into the 09:37 install: ${JSON.stringify(cancelled.appLog.inFlightQuits)}`,
		);
		const early = new Date("2026-09-17T08:37:35.784").toISOString();
		assert.ok(fast.appLog.inFlightQuits.includes(early));
		assert.equal(fast.targetVersion, "0.26.5");
		near(fast.phases.beginningToMove, 15.574, "the calm-machine phase");
		near(fast.closedWindow.toAppStart, 24.967, "request -> app back");
	});
});

test("the window and limit flags select the installs a reader asks for", () => {
	const since = new Date("2026-09-18 09:00");
	const until = new Date("2026-09-18 10:00");
	const day = reportFor({ since, until });
	assert.deepEqual(
		day.installs.map((install) => install.targetVersion),
		["0.28.3"],
	);
	const last = reportFor({ limit: 1 });
	assert.deepEqual(
		last.installs.map((install) => install.targetVersion),
		["0.28.4"],
	);
	// A window that matches nothing is an empty LIST rather than an error: "no
	// installs in this window" is a real answer about a machine.
	const none = reportFor({
		since: new Date("2026-01-01"),
		until: new Date("2026-01-02"),
	});
	assert.deepEqual(none.installs, []);
});

test("without the app log the report says the version is unknown rather than inventing one", () => {
	const fixture = reportFor({ appLog: null });
	assert.equal(fixture.installs.length, 3);
	// Without the app log the version cannot be named, and the report says so
	// rather than inventing one: ShipIt's log does not carry it.
	assert.deepEqual(
		fixture.installs.map((install) => install.targetVersion),
		[null, null, null],
	);
	assert.equal(fixture.logs.appRead, false);
});

test("a machine that has never updated reports no installs rather than failing", () => {
	const report = buildReport({
		json: true,
		limit: null,
		since: null,
		until: null,
		shipitLog: join(tmpdir(), "lo-no-such-shipit-log"),
		appLog: join(tmpdir(), "lo-no-such-app-log"),
	});
	assert.deepEqual(report.installs, []);
	assert.equal(report.logs.shipitRead, false);
});

test("the CLI prints JSON carrying the machine state the window is read against", () => {
	return withFixtureLogs(({ shipitLog, appLog }) => {
		const result = spawnSync(
			process.execPath,
			[
				"scripts/update-window-report.mjs",
				"--json",
				"--limit",
				"1",
				"--shipit-log",
				shipitLog,
				"--app-log",
				appLog,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.installs.length, 1);
		assert.equal(parsed.installs[0].targetVersion, "0.28.4");
		assert.equal(typeof parsed.machine.loadAverage.one, "number");
		assert.ok(
			Array.isArray(parsed.machine.shipit),
			JSON.stringify(parsed.machine),
		);
		// The swap is macOS's (`sysctl vm.swapusage`); elsewhere the report says
		// nothing about it rather than printing zero.
		if (process.platform === "darwin") {
			assert.equal(typeof parsed.machine.swap.usedGb, "number");
		} else {
			assert.equal(parsed.machine.swap, null);
		}
	});
});

/**
 * A running install's scheduling facts, read from `ps`.
 *
 * WHY THIS CASE EXISTS. The last unexplained thing about a slow update was why a
 * third-of-a-second validation call takes minutes inside an install, and the
 * answer is the class the installer runs in (Squirrel submits it as a launchd job;
 * launchd runs that in the background class). So a report read DURING an install
 * has to name the process and its priority - and it has to not name the wrong
 * thing: this machine has a rig whose script is called `shipit-capture.sh`, and a
 * matcher keyed on the word would report it as somebody's install.
 */
test("a running installer is named with its scheduling facts, and a rig is not", () => {
	const ps = [
		"    1     0    37   2.0 /sbin/launchd",
		"  944     0    31   0.0 bash /tmp/shipit-capture.sh",
		"73823     0    31   4.3 /Applications/Local Operator.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt /Applications/Local Operator.app",
		"73823     0    31   4.3 /Applications/Local Operator.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt --launch-only /Applications/Local Operator.app",
		"",
	].join("\n");
	const processes = parseShipItProcesses(ps);
	assert.equal(processes.length, 2, JSON.stringify(processes));
	assert.deepEqual(processes[0], {
		pid: 73823,
		nice: 0,
		priority: 31,
		cpuPercent: 4.3,
		command:
			"/Applications/Local Operator.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt /Applications/Local Operator.app",
	});
	// The rig's script, and launchd itself, are not installs.
	assert.deepEqual(
		parseShipItProcesses(
			"  944     0    31   0.0 bash /tmp/shipit-capture.sh\n",
		),
		[],
	);
	assert.deepEqual(parseShipItProcesses(""), []);
});

test("the argument reader refuses what it cannot honour", () => {
	assert.throws(() => parseArguments(["--limit", "0"]), /positive number/);
	assert.throws(() => parseArguments(["--since", "not-a-date"]), /not a date/);
	assert.throws(() => parseArguments(["--nope"]), /unknown argument/);
	assert.equal(parseArguments(["--limit", "3"]).limit, 3);
});
