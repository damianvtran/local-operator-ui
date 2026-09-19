import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

/**
 * The install the app starts ITSELF, rather than handing the launch to launchd.
 *
 * WHAT THIS FILE IS FOR. An in-app update used to end at
 * `autoUpdater.quitAndInstall`, which asks Squirrel.Mac to fetch the zip, unzip
 * it and SUBMIT ShipIt as a launchd job - and the job's scheduling class is what
 * makes Apple's own `SecStaticCodeCheckValidityWithErrors` over a 394 MB bundle
 * cost 4-13 minutes on this machine (measured 2026-09-18: 0.25-3.85 s from an
 * ordinary process, 33.3 s as a launchd job, 331-777 s under `taskpolicy -b`).
 * `src/main/update-shipit.ts` stages the same bundle and starts the same ShipIt
 * in the app's own context instead, and `update-service.ts` hands the install to
 * it when every precondition holds.
 *
 * The claim the change is JUDGED by is `scripts/update-window-report.mjs` over
 * real installs of `/Applications/Local Operator.app` - `request -> swap landed`
 * under 10 s, five consecutive installs, which no test can produce and this file
 * does not pretend to. What it does instead is exercise every step that can be
 * exercised on any machine: the staging (`ditto -x -k` into the app's own root,
 * the staged bundle's own seal probe, the state plist ShipIt is handed), the
 * spawner's wait-then-`exec` against a real process tree, the shipped handler's
 * two branches (direct, and the Squirrel fallback), and the liveness contracts
 * that decide what recovery and the relaunch watchdog believe about an install
 * that has no launchd job at all.
 *
 * WHY THE BUNDLES ARE BUNDLED. Both modules are the shipped TypeScript, compiled
 * in memory by esbuild and imported - the same dependency `update-robustness.test.mjs`
 * and `desktop-contract.test.mjs` use - so these are tests of the code that runs
 * rather than of a copy of it. `update-service.ts` pulls in Electron, so that one
 * is bundled with the fixture at the bottom of this file instead of launched.
 */

const tempDirs = [];
function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const bundleOf = async (entry) => {
	const bundle = await build({
		stdin: { contents: `export * from "${entry}";`, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
};

const shipit = await bundleOf("./src/main/update-shipit");
const install = await bundleOf("./src/main/update-install");

const {
	DITTO_PATH,
	EXTRACTION_TIMEOUT_MS,
	INSTALLER_POLL_SECONDS,
	INSTALLER_TOKEN,
	SHIPIT_RELATIVE_PATH,
	UPDATE_STAGING_DIR,
	buildInstallerSpawn,
	evaluateStagedBundle,
	extractionArguments,
	fileUrlForDirectory,
	installerElsewhere,
	installerIsAlive,
	installerLogPath,
	sameVolume,
	shipItPathInBundle,
	shipItStatePlist,
	stagingStatePath,
	updateStagingDir,
	updateStagingRoot,
} = shipit;

const {
	buildWatchdogPlan,
	installLivenessNow,
	installLivenessText,
	isInstallInFlight,
	parsePendingInstallMarker,
	requiredDiskBytes,
	shipItCacheDir,
	shipItJobLabel,
} = install;

/** A path in this run's scratch space, created on demand. */
const scratchDir = (name) => {
	const dir = join(tempDir("lo-shipit-test-"), name);
	mkdirSync(dir, { recursive: true });
	return dir;
};

/** Whether a pid is still there, without signalling it. */
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** `ps -o command= -p <pid>` as the app asks it. */
const commandLineOf = (pid) => {
	try {
		return execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], {
			encoding: "utf8",
		}).trim();
	} catch {
		return null;
	}
};

/**
 * `ps -Ao command= -ww` as the app asks it, for an answer about a process the test
 * has no pid for - a child that was killed before it could record one.
 */
const processList = () =>
	execFileSync("/bin/ps", ["-Ao", "command=", "-ww"], { encoding: "utf8" })
		.split("\n")
		.filter((line) => line.length > 0);

/** Kill a process by exact pid, and wait for the pid to actually be gone. */
const reap = async (pid) => {
	if (pid == null) return;
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Already gone: the only state this helper exists to produce.
	}
	for (let attempt = 0; attempt < 50 && alive(pid); attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 40));
	}
};

// ---------------------------------------------------------------------------
// The pieces, as decisions
// ---------------------------------------------------------------------------

/**
 * The installer is resolved INSIDE the running bundle, under the one spelling
 * that does not name a version.
 *
 * Design note, risk 7: the change is only safe while ShipIt is wherever the
 * running bundle keeps it, and a future Electron that renames or replaces
 * `Squirrel.framework`'s layout has to make this resolve to something that is not
 * there rather than to something else that is.
 */
test("the installer is the one inside the running bundle, under a versionless path", () => {
	const bundle = "/Applications/Local Operator.app";
	assert.equal(
		shipItPathInBundle(bundle),
		`${bundle}/Contents/Frameworks/Squirrel.framework/Versions/Current/Resources/ShipIt`,
	);
	assert.equal(SHIPIT_RELATIVE_PATH.includes("Versions/Current"), true);
	assert.equal(shipItPathInBundle(null), null);
	// Nothing platform-specific leaks in: the path is a join of the bundle and the
	// relative spelling, which is what makes it assertable off a Mac.
	assert.equal(SHIPIT_RELATIVE_PATH.startsWith("Contents"), true);
});

/**
 * One install's staging tree, named so a STALE one is recognisable as stale.
 *
 * The version leads so a human can see what it holds, and the attempt's nonce
 * follows because two attempts at one version must not share a tree: the second
 * extraction would rewrite the tree the first installer may still be reading.
 */
test("a staged tree is one attempt's, under the app's own staging root", () => {
	const userData = "/home/someone/Library/Application Support/Local Operator";
	assert.equal(updateStagingRoot(userData), join(userData, UPDATE_STAGING_DIR));
	const first = updateStagingDir({
		userDataDir: userData,
		version: "0.28.5",
		nonce: "aaaaaa",
	});
	const second = updateStagingDir({
		userDataDir: userData,
		version: "0.28.5",
		nonce: "bbbbbb",
	});
	assert.notEqual(first, second);
	assert.equal(first, join(userData, "update-staging", "0.28.5-aaaaaa"));
	// The state plist lives under the tree it describes, which is what lets the
	// liveness check recognise this install's installer by its own argv.
	assert.equal(stagingStatePath(first), join(first, "state.plist"));
});

/**
 * The extraction is Squirrel's own tool and argv, absolutely named.
 *
 * `ditto -x -k` is what `SQRLZipArchiver` runs, so the tree is the one Apple's
 * own path would have produced, and the absolute path is the watchdog's rule: an
 * update must not be unpacked by whichever `ditto` a `PATH` happens to resolve.
 */
test("the extraction is the tool and the argv Squirrel itself uses", () => {
	assert.equal(DITTO_PATH, "/usr/bin/ditto");
	assert.deepEqual(extractionArguments("/tmp/update.zip", "/tmp/staging"), [
		"-x",
		"-k",
		"/tmp/update.zip",
		"/tmp/staging",
	]);
	assert.ok(EXTRACTION_TIMEOUT_MS > 60_000);
});

/**
 * The state plist is Squirrel's own schema, key for key.
 *
 * The SCHEMA and the URL spellings are the ones this machine's own
 * `~/Library/Caches/com.local-operator.ShipIt/ShipItState.plist` carries - written
 * by the 2026-09-18 11:59 install and read back by ShipIt - so the comparison is
 * against the artifact rather than against a reading of the note. The staging path
 * is synthetic, of the shape the app builds rather than this machine's own home:
 * what the plist has to get right is the directory URL encoding, not whose home it
 * was written in (review NIT-1).
 */
test("the state plist is Squirrel's own schema", () => {
	const plist = shipItStatePlist({
		bundleIdentifier: "com.local-operator",
		targetBundlePath: "/Applications/Local Operator.app",
		updateBundlePath:
			"/Users/someone/Library/Application Support/Local Operator/update-staging/0.28.5-abc123/Local Operator.app",
	});
	assert.deepEqual(Object.keys(plist).sort(), [
		"bundleIdentifier",
		"launchAfterInstallation",
		"targetBundleURL",
		"updateBundleURL",
		"useUpdateBundleName",
	]);
	assert.equal(plist.bundleIdentifier, "com.local-operator");
	assert.equal(
		plist.targetBundleURL,
		"file:///Applications/Local%20Operator.app/",
	);
	assert.equal(
		plist.updateBundleURL,
		"file:///Users/someone/Library/Application%20Support/Local%20Operator/update-staging/0.28.5-abc123/Local%20Operator.app/",
	);
	// Relaunching the app after a successful swap is his own behaviour and the
	// reason the app's watchdog must stay BEHIND it rather than beside it.
	assert.equal(plist.launchAfterInstallation, true);
	assert.equal(plist.useUpdateBundleName, true);

	// And the URLs are the platform's own spelling of a directory.
	assert.equal(
		fileUrlForDirectory("/Applications/Local Operator.app"),
		"file:///Applications/Local%20Operator.app/",
	);
	assert.equal(fileUrlForDirectory("/tmp/x/"), "file:///tmp/x/");
});

/**
 * A staged bundle is judged by what it says about itself.
 *
 * Every refusal is a refusal to HAND OVER: the install then goes to Squirrel's
 * own path, which is slower and still correct, so the direction to be wrong in is
 * "do not stage". The one non-answer is architecture: a value `lipo` could not
 * produce is not evidence the bundle is wrong ("we could not ask" is not "the
 * bundle is bad", the same rule `readBundleSeal`'s retry exists for).
 */
test("a staged bundle is the app that was promised, or it is refused", () => {
	const reading = (overrides = {}) => ({
		appPath: "/staging/Local Operator.app",
		exists: true,
		bundleIdentifier: "com.local-operator",
		version: "0.28.5",
		executablePresent: true,
		architectures: ["arm64"],
		...overrides,
	});
	const judge = (overrides = {}) =>
		evaluateStagedBundle({
			reading: reading(overrides),
			expectedBundleIdentifier: "com.local-operator",
			expectedVersion: "0.28.5",
			runningArchitecture: "arm64",
		});

	assert.equal(judge().ok, true);
	for (const [what, overrides, expected] of [
		["no bundle", { exists: false }, /no bundle at/],
		[
			"another app",
			{ bundleIdentifier: "com.example.other" },
			/com\.example\.other, not com\.local-operator/,
		],
		["another version", { version: "0.28.4" }, /reports version 0\.28\.4/],
		["an unreadable version", { version: null }, /version unknown/],
		["no executable", { executablePresent: false }, /has no executable/],
		["another architecture", { architectures: ["x86_64"] }, /built for x86_64/],
	]) {
		const verdict = judge(overrides);
		assert.equal(verdict.ok, false, `${what} was accepted`);
		assert.match(verdict.detail, expected);
	}
	// Could not ask: accepted, and said so rather than silently.
	const unknown = judge({ architectures: null });
	assert.equal(unknown.ok, true);
	assert.equal(unknown.detail.includes("arm64"), false);
	// A universal build contains the running architecture.
	assert.equal(judge({ architectures: ["x86_64", "arm64"] }).ok, true);
});

/**
 * The installer's liveness is a pid AND a command line, never a process name.
 *
 * The pid has two lives, so the command line answers in two shapes - the waiting
 * spawner (`sh -c`, carrying the token) and ShipIt itself (its own argv naming
 * this app's ShipIt and a state plist under this app's staging root). Both halves
 * of the second rule are required: `reapFailedInstall`'s docstring records a
 * harness on this machine whose capture script was called `shipit-capture.sh`,
 * which is exactly what a name test would accept.
 */
test("the installer's liveness is a pid and a command line, never a process name", () => {
	const shipItPath =
		"/Applications/Local Operator.app/Contents/Frameworks/Squirrel.framework/Versions/Current/Resources/ShipIt";
	const stagingRoot =
		"/Users/someone/Library/Application Support/Local Operator/update-staging";
	const statePath = `${stagingRoot}/0.28.5-abc123/state.plist`;
	const ours = {
		pid: 4242,
		shipItPath,
		stagingRoot,
	};

	// The waiting spawner, whose command line is the script text.
	const spawnCommandLine = `sh -c #!/bin/sh\n# ${INSTALLER_TOKEN}\nwhile kill -0 "$1" 2>/dev/null; do\n\tsleep 0.2\ndone\nexec "$LO_UPDATE_INSTALLER_SHIPIT" "com.local-operator.ShipIt" "$LO_UPDATE_INSTALLER_STATE" >>"$LO_UPDATE_INSTALLER_LOG" 2>&1\nlo-update-installer 4242`;
	assert.equal(
		installerIsAlive({ ...ours, commandLine: spawnCommandLine }),
		true,
	);
	// The installer itself, after the exec.
	assert.equal(
		installerIsAlive({
			...ours,
			commandLine: `${shipItPath} com.local-operator.ShipIt ${statePath}`,
		}),
		true,
	);
	// A pid with nothing under it, and a pid that is something else entirely.
	assert.equal(installerIsAlive({ ...ours, commandLine: null }), false);
	assert.equal(
		installerIsAlive({ ...ours, pid: null, commandLine: "impossible" }),
		false,
	);
	assert.equal(installerIsAlive({ ...ours, commandLine: "sleep 300" }), false);
	assert.equal(
		installerIsAlive({
			...ours,
			commandLine: "/tmp/shipit-capture.sh com.local-operator.ShipIt",
		}),
		false,
	);
	// ANOTHER machine's install: the right ShipIt path is not enough on its own -
	// the plist has to be under THIS app's staging root - and neither is the root
	// on its own.
	assert.equal(
		installerIsAlive({
			...ours,
			commandLine: `${shipItPath} com.local-operator.ShipIt /tmp/somebody-elses/state.plist`,
		}),
		false,
	);
	assert.equal(
		installerIsAlive({
			...ours,
			commandLine:
				"/tmp/other/ShipIt com.local-operator.ShipIt /tmp/other/state.plist",
		}),
		false,
	);
	// An install from a bundle whose ShipIt cannot be resolved is still recognised
	// while it waits (the token half), which is what keeps a recovery running
	// beside a live install from calling it dead.
	assert.equal(
		installerIsAlive({
			pid: 1,
			shipItPath: null,
			stagingRoot,
			commandLine: spawnCommandLine,
		}),
		true,
	);
});

/**
 * The marker decides WHICH liveness signal an install has.
 *
 * `installLivenessNow` is the pid-first rule the whole change turns on: a marker
 * that records an installer pid has no launchd job to ask about, and a marker
 * from the older path (or from the fallback) has no pid. Asking launchctl first
 * would be wrong rather than redundant on this machine, where the app's ShipIt
 * job stays REGISTERED long after a successful install.
 */
test("a marker's own installer pid wins over the install job", () => {
	const shipItPath =
		"/Applications/Local Operator.app/Contents/Frameworks/Squirrel.framework/Versions/Current/Resources/ShipIt";
	const stagingRoot =
		"/Users/someone/Library/Application Support/Local Operator/update-staging";
	const markerOf = (installerPid) => ({
		targetVersion: "0.28.5",
		artifactPath: "/tmp/update.zip",
		startedAt: new Date().toISOString(),
		watchdogPid: null,
		installerPid,
	});
	let jobAsked = 0;
	const jobState = () => {
		jobAsked++;
		return "running";
	};
	let listAsked = 0;
	const livenessOf = (input) =>
		installLivenessNow({
			marker: input.marker,
			installerCommandLine: () => input.commandLine ?? null,
			installerElsewhere: () => {
				listAsked++;
				return input.elsewhere === true;
			},
			shipItPath,
			stagingRoot,
			jobState,
		});

	// A live installer: in flight, and launchd is not asked at all.
	assert.deepEqual(
		livenessOf({
			marker: markerOf(4242),
			commandLine: `${shipItPath} com.local-operator.ShipIt ${stagingRoot}/0.28.5-abc/state.plist`,
		}),
		{
			installerRunning: true,
			jobState: "unread",
			decidedBy: "installer-pid",
			installerSignal: "pid",
		},
	);
	assert.equal(jobAsked, 0);
	assert.equal(listAsked, 0);
	// Its installer is gone AND no process of ours is anywhere: NOT in flight,
	// whatever launchd says about a job this path never submits.
	assert.deepEqual(livenessOf({ marker: markerOf(4242), commandLine: null }), {
		installerRunning: false,
		jobState: "unread",
		decidedBy: "installer-pid",
		installerSignal: null,
	});
	assert.equal(jobAsked, 0);
	// The pid stopped being the installer, but an install it started is still being
	// carried out by a process that names our ShipIt and our staging root: alive
	// (review MINOR-3). This is the direction that must not read as dead, because
	// recovery's action on "dead" is to reap the tree a live installer is using.
	assert.deepEqual(
		livenessOf({ marker: markerOf(4242), commandLine: null, elsewhere: true }),
		{
			installerRunning: true,
			jobState: "unread",
			decidedBy: "installer-pid",
			installerSignal: "elsewhere",
		},
	);
	assert.equal(listAsked, 2);
	/*
	 * And the log line says WHICH process is holding: the pid the marker names is
	 * dead in that case, so a line that named it as the running process would send a
	 * reader to a pid that answers with nothing (review R2-2). The distinction is
	 * carried, not re-derived here.
	 */
	assert.equal(
		installLivenessText(
			{
				installerRunning: true,
				jobState: "unread",
				decidedBy: "installer-pid",
				installerSignal: "elsewhere",
			},
			4242,
		),
		"the install this app started is still running (pid 4242 has gone; its ShipIt is still at work)",
	);
	assert.equal(
		installLivenessText(
			livenessOf({
				marker: markerOf(4242),
				commandLine: `${shipItPath} com.local-operator.ShipIt ${stagingRoot}/0.28.5-abc/state.plist`,
			}),
			4242,
		),
		"the installer this app started (pid 4242) is still running",
	);
	/*
	 * And the DEAD-pid case gets its own sentence, because this function is called for
	 * every marker and not only for a live install (review R3-1). The false liveness
	 * claim here was the defect the `elsewhere` arm was fixed for, one case further
	 * out: `recovery`'s marker line runs BEFORE anything is classified, so the state
	 * it describes most often - an install that finished, or failed, with the marker
	 * still on disk at the next start - is exactly the pid that has gone. Pinned as
	 * TEXT rather than as values, which is what let R3-1 through in round 2: the
	 * values were asserted, and the sentence was not.
	 */
	const dead = {
		installerRunning: false,
		jobState: "unread",
		decidedBy: "installer-pid",
		installerSignal: null,
	};
	assert.equal(
		installLivenessText(dead, 4242),
		"the installer this app started (pid 4242) has gone",
	);
	assert.doesNotMatch(
		installLivenessText(dead, 4242),
		/still running/,
		"a marker whose installer has gone was described as a live install",
	);
	// The same contrast, made directly: two readings that disagree about the
	// machine's liveness must not share a sentence.
	assert.notEqual(
		installLivenessText(dead, 4242),
		installLivenessText(
			{
				installerRunning: true,
				jobState: "unread",
				decidedBy: "installer-pid",
				installerSignal: "elsewhere",
			},
			4242,
		),
	);
	// The older path, and the fallback: no pid, so the job is the answer - and the
	// listing is not read, because there is no pid to have lost.
	assert.deepEqual(livenessOf({ marker: markerOf(null), commandLine: null }), {
		installerRunning: false,
		jobState: "running",
		decidedBy: "install-job",
		installerSignal: null,
	});
	assert.equal(jobAsked, 1);
	assert.equal(listAsked, 2);

	/*
	 * And a stopped pid really is the installer when the LISTING says so, which is
	 * what the scan is: `installerIsAlive`'s own two facts, asked of every process.
	 * The line has to name this app's ShipIt AND this staging root, so another
	 * application's ShipIt - this machine has several - cannot answer for ours.
	 */
	const pidLine = `${shipItPath} com.local-operator.ShipIt ${stagingRoot}/0.28.5-abc/state.plist`;
	assert.equal(
		installerElsewhere({
			processList: `/sbin/launchd\n${pidLine}\n/usr/bin/ps -Ao command= -ww`,
			shipItPath,
			stagingRoot,
		}),
		true,
	);
	assert.equal(
		installerElsewhere({
			processList: `/sbin/launchd\n${shipItPath} com.local-operator.ShipIt /somewhere/else/state.plist`,
			shipItPath,
			stagingRoot,
		}),
		false,
	);
	assert.equal(
		installerElsewhere({
			processList: "/sbin/launchd\n/usr/bin/ps -Ao command= -ww",
			shipItPath,
			stagingRoot,
		}),
		false,
	);
	// A listing that could not be read answers false, which is the direction the
	// caller states rather than hides: unproven is treated as gone.
	assert.equal(
		installerElsewhere({ processList: null, shipItPath, stagingRoot }),
		false,
	);

	// And the predicate on top of it keeps its own three facts.
	const now = Date.now();
	assert.equal(
		isInstallInFlight({ marker: markerOf(1), installerRunning: true, now }),
		true,
	);
	assert.equal(
		isInstallInFlight({ marker: markerOf(1), installerRunning: false, now }),
		false,
	);
	assert.equal(
		isInstallInFlight({ marker: null, installerRunning: true }),
		false,
	);
	// An undated marker cannot be said to be live, so it is not (the failure path
	// reports it, which is the safe direction).
	assert.equal(
		isInstallInFlight({
			marker: { ...markerOf(1), startedAt: "" },
			installerRunning: true,
			now,
		}),
		false,
	);
});

/**
 * The disk guard pays for the tree the app extracts itself.
 *
 * The peak on the app's volume is the artifact, the staged copy, the extracted
 * tree the swap is performed against and the app being replaced. ShipIt used to
 * materialise the middle one under its own cache, which the app only paid for by
 * implication; it is the app's own directory now (design note, §5.6).
 */
test("the disk guard counts the extracted tree", () => {
	const artifactSize = 152_594_459;
	const bundleSize = 394_498_048;
	const slack = requiredDiskBytes({ artifactSize, installedBundleSize: 0 });
	assert.equal(slack, artifactSize + 256 * 1024 * 1024);
	assert.equal(
		requiredDiskBytes({ artifactSize, installedBundleSize: bundleSize }) -
			requiredDiskBytes({ artifactSize, installedBundleSize: 0 }),
		bundleSize * 3,
	);
});

/**
 * The spawner waits for the app's own pid, then BECOMES the installer.
 *
 * Shape assertions, deliberately, and the ones that carry the two decisions: the
 * wait is on the pid (not on a name - `pgrep -f` does not report its own
 * ancestors, which is what made the original watchdog relaunch into a live
 * install), and the second half is `exec`, so the pid the app recorded is the
 * installer's own for the rest of its life rather than a shell's.
 */
test("the spawner waits for the app's pid and then becomes the installer", () => {
	const plan = buildInstallerSpawn({
		appPid: 4242,
		shipItPath:
			"/Applications/Local Operator.app/Contents/Frameworks/Squirrel.framework/Versions/Current/Resources/ShipIt",
		label: "com.local-operator.ShipIt",
		statePath: "/staging/0.28.5-abc/state.plist",
		logPath: "/caches/com.local-operator.ShipIt/ShipIt_stderr.log",
	});

	assert.match(plan.script, /kill -0 "\$1" 2>\/dev\/null/);
	assert.match(plan.script, new RegExp(`sleep ${INSTALLER_POLL_SECONDS}`));
	assert.match(plan.script, /\nexec "\$LO_UPDATE_INSTALLER_SHIPIT"/);
	assert.match(plan.script, new RegExp(INSTALLER_TOKEN));
	// Both of the installer's streams go to Squirrel's own log, appended.
	assert.match(plan.script, />>"\$LO_UPDATE_INSTALLER_LOG" 2>&1/);
	// A pid that is a positional argument, and paths that travel in the
	// environment: `sh -c` exposes the script text as the process's command line,
	// and a script carrying the app's path would show up in a listing of it.
	assert.deepEqual(plan.args.slice(0, 2), ["-c", plan.script]);
	assert.equal(plan.args[2], "lo-update-installer");
	assert.equal(plan.args[3], "4242");
	assert.equal(plan.script.includes("/Applications/Local Operator.app"), false);
	assert.equal(plan.script.includes("/staging/0.28.5-abc"), false);
	assert.deepEqual(plan.env, {
		LO_UPDATE_INSTALLER_SHIPIT:
			"/Applications/Local Operator.app/Contents/Frameworks/Squirrel.framework/Versions/Current/Resources/ShipIt",
		LO_UPDATE_INSTALLER_LABEL: "com.local-operator.ShipIt",
		LO_UPDATE_INSTALLER_STATE: "/staging/0.28.5-abc/state.plist",
		LO_UPDATE_INSTALLER_LOG:
			"/caches/com.local-operator.ShipIt/ShipIt_stderr.log",
	});
	// The log is Squirrel's own file, resolved the way the app resolves it.
	assert.equal(
		installerLogPath(
			shipItCacheDir("/Users/x/Library/Caches", "com.local-operator"),
		),
		"/Users/x/Library/Caches/com.local-operator.ShipIt/ShipIt_stderr.log",
	);
	assert.equal(
		shipItJobLabel("com.local-operator"),
		"com.local-operator.ShipIt",
	);
});

// ---------------------------------------------------------------------------
// The pieces, really run
// ---------------------------------------------------------------------------

/**
 * The spawner, against a real process tree: it waits, and then it IS ShipIt.
 *
 * The stand-in for the app is a real process whose pid is handed to the script,
 * and the stand-in for ShipIt is a script that records its own pid and its own
 * arguments - which is how "exec, not a child" is provable rather than asserted:
 * the pid that runs the installer is the pid the app spawned. The first half is
 * the property the whole design rests on (ShipIt asks whether any instance of the
 * target app is running ONCE, as its last check before the swap, so the app has to
 * be gone before the installer starts), and it is measured here as "the installer
 * did nothing while the stand-in was alive".
 */
test(
	"the spawner really waits, and really execs",
	{ skip: process.platform !== "darwin" },
	async () => {
		const dir = scratchDir("spawn");
		const log = join(dir, "ShipIt_stderr.log");
		const record = join(dir, "installer.json");
		const installer = join(dir, "ShipIt");
		writeFileSync(
			installer,
			// The stand-in installer: its pid and argv are recorded, and its two
			// streams are written where the spawner redirected them - which is the
			// half of this test that says both went to Squirrel's own log.
			`#!/bin/sh\nprintf '%s\\n' "$$" "$@" >> "${record}"\necho "installer stdout"\necho "installer stderr" >&2\n`,
			"utf8",
		);
		execFileSync("/bin/chmod", ["+x", installer]);

		const app = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
		const plan = buildInstallerSpawn({
			appPid: app.pid,
			shipItPath: installer,
			label: "com.local-operator.shipit-test",
			statePath: join(dir, "state.plist"),
			logPath: log,
		});
		const child = spawn("/bin/sh", plan.args, {
			detached: true,
			stdio: "ignore",
			env: { ...process.env, ...plan.env },
		});
		child.unref();
		try {
			// The waiting process is ours, by the machine's own answer.
			await new Promise((resolve) => setTimeout(resolve, 400));
			assert.equal(alive(child.pid), true, "the spawner did not survive");
			assert.equal(
				installerIsAlive({
					pid: child.pid,
					commandLine: commandLineOf(child.pid),
					shipItPath: installer,
					stagingRoot: dir,
				}),
				true,
			);
			// And it has installed NOTHING while the app it is waiting for is alive.
			await new Promise((resolve) => setTimeout(resolve, 1000));
			assert.equal(
				existsSync(record),
				false,
				"the installer ran while the app was still alive",
			);

			app.kill();
			const deadline = Date.now() + 10_000;
			while (!existsSync(record) && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			assert.equal(existsSync(record), true, "the installer never ran");
			const lines = readFileSync(record, "utf8").trim().split("\n");
			// The pid that installed is the pid the app was told about: that is what
			// `exec` bought.
			assert.equal(lines[0], String(child.pid));
			assert.deepEqual(lines.slice(1, 3), [
				"com.local-operator.shipit-test",
				join(dir, "state.plist"),
			]);
			// Both streams went to Squirrel's own log, which is where the app's
			// failure detail and update-window-report.mjs look for them.
			assert.match(
				readFileSync(log, "utf8"),
				/installer stdout[\s\S]*installer stderr/,
			);
		} finally {
			await reap(child.pid);
			await reap(app.pid);
		}
	},
);

/**
 * A staged tree and a target bundle are on one volume, or the swap cannot land.
 *
 * ShipIt finishes by RENAMING the staged bundle into the target's directory, so
 * the volume identity is a precondition rather than a detail - and the check is
 * `st_dev` against the target, so a user who installed to an external disk gets
 * the fallback instead of an install that aborts after the wait.
 */
test("staging on the target's own volume is a precondition, not a preference", () => {
	assert.equal(sameVolume(42, 42), true);
	assert.equal(sameVolume(42, 43), false);
	// "Could not read it" is not "the same volume": the refusal direction is the
	// safe one, and the fallback is still a working install.
	assert.equal(sameVolume(null, 42), false);
	assert.equal(sameVolume(42, null), false);
	assert.equal(sameVolume(null, null), false);
});

/**
 * The state plist the app writes is read by the platform's own reader.
 *
 * JSON is not a guess: Squirrel writes the state plist as JSON on this machine,
 * and `plutil` is what the machine's own tooling reads it with. This writes the
 * shipped function's output to disk and asks that reader, so "ShipIt will be able
 * to read it" is a measurement rather than an inference from the schema.
 */
test(
	"the state plist the app writes is readable as a plist",
	{ skip: process.platform !== "darwin" },
	() => {
		const dir = scratchDir("plist");
		const statePath = join(dir, "state.plist");
		writeFileSync(
			statePath,
			JSON.stringify(
				shipItStatePlist({
					bundleIdentifier: "com.local-operator",
					targetBundlePath: "/Applications/Local Operator.app",
					updateBundlePath: join(dir, "Local Operator.app"),
				}),
			),
			"utf8",
		);
		const read = (key) =>
			execFileSync(
				"/usr/bin/plutil",
				["-extract", key, "raw", "-o", "-", statePath],
				{ encoding: "utf8" },
			).trim();
		assert.equal(read("bundleIdentifier"), "com.local-operator");
		assert.equal(
			read("targetBundleURL"),
			"file:///Applications/Local%20Operator.app/",
		);
		assert.equal(
			read("updateBundleURL"),
			`file://${encodeURI(join(dir, "Local Operator.app"))}/`,
		);
		assert.equal(read("launchAfterInstallation"), "true");
		assert.equal(read("useUpdateBundleName"), "true");
		/*
		 * And the whole file reads as a plist, not only key by key. JSON is what
		 * Squirrel's own plist on this machine is (`file` says `JSON data`), so
		 * `plutil -p` - the reader that shows it - is the honest check. `plutil
		 * -lint` is NOT asserted here: it refuses JSON (measured: `Unexpected
		 * character {`), while `-p` and `-extract` accept it, which is the same
		 * pair of behaviours ShipIt's own file has been relying on since the
		 * 2026-09-18 11:59 install.
		 */
		const printed = execFileSync("/usr/bin/plutil", ["-p", statePath], {
			encoding: "utf8",
		});
		assert.match(printed, /"bundleIdentifier" => "com\.local-operator"/);
		assert.match(printed, /"launchAfterInstallation" => true/);
	},
);

/**
 * The relaunch watchdog holds on the INSTALLER's pid, and a registered job is not
 * proof of a live install.
 *
 * Two facts, and both are machine measurements rather than preferences. The app's
 * own install has no launchd job at all, so a watchdog that asked launchd first
 * would decide the install was over the instant it started and relaunch the app
 * into ShipIt's running-instance check - the `Code=-9` abort this change exists
 * to make impossible. And on this machine the job stays registered long after a
 * successful install, so "registered" is not "running" in either direction.
 *
 * The script is really run: a `launchctl` that answers `113` (nothing loaded), a
 * `plutil` that reads the fixture bundle's version, an `open` that records the
 * relaunch, an `osascript` that swallows the notices, and an installer pid that
 * is a real process.
 */
test(
	"the watchdog holds on the installer's own pid while the job is not loaded",
	{ skip: process.platform !== "darwin" },
	async () => {
		const dir = scratchDir("watchdog");
		const bundle = join(dir, "Fixture.app");
		mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
		writeFileSync(
			join(bundle, "Contents", "MacOS", "Fixture"),
			"#!/bin/sh\nexit 0\n",
		);
		execFileSync("/bin/chmod", [
			"+x",
			join(bundle, "Contents", "MacOS", "Fixture"),
		]);
		writeFileSync(
			join(bundle, "Contents", "Info.plist"),
			`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>0.28.5</string></dict></plist>\n`,
			"utf8",
		);

		const binDir = join(dir, "bin");
		mkdirSync(binDir, { recursive: true });
		const launchLog = join(dir, "launches.log");
		const shims = {
			// Nothing is loaded: `launchctl list <label>` exits 113.
			launchctl: "#!/bin/sh\nexit 113\n",
			open: `#!/bin/sh\necho "open $*" >> "${launchLog}"\nexit 0\n`,
			osascript: "#!/bin/sh\nexit 0\n",
			// The plan names its own reader for the platform; this host's is real,
			// which is the point of the version file above.
			plutil: '#!/bin/sh\nexec /usr/bin/plutil "$@"\n',
		};
		for (const [name, contents] of Object.entries(shims)) {
			writeFileSync(join(binDir, name), contents, "utf8");
			execFileSync("/bin/chmod", ["+x", join(binDir, name)]);
		}

		const installer = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
		const plan = buildWatchdogPlan({
			appBundlePath: bundle,
			executableName: "Fixture",
			appPid: 1,
			shipItJob: "com.local-operator.ShipIt",
			installerPid: installer.pid,
			platform: "darwin",
			signals: {
				jobProbe: join(binDir, "launchctl"),
				plistReader: join(binDir, "plutil"),
			},
			timeoutSeconds: 3,
			hardTimeoutSeconds: 6,
			intervalSeconds: 1,
			settleSeconds: 1,
			appearSeconds: 1,
			announceSeconds: 1,
		});
		assert.equal(
			plan.env.LO_UPDATE_WATCHDOG_INSTALLER_PID,
			String(installer.pid),
		);

		const child = spawn("/bin/sh", ["-c", plan.script], {
			detached: true,
			stdio: "ignore",
			env: {
				...process.env,
				...plan.env,
				PATH: `${binDir}:${process.env.PATH ?? ""}`,
			},
		});
		child.unref();
		const exited = new Promise((resolve) =>
			child.on("exit", (code, signal) => resolve({ code, signal })),
		);
		try {
			// Past the soft bound with the job NOT loaded and the installer alive:
			// a registered-or-not job is not what this install's liveness is, so the
			// script must still be holding. Nothing may be relaunched.
			await new Promise((resolve) => setTimeout(resolve, 4_500));
			assert.equal(
				existsSync(launchLog),
				false,
				"the watchdog relaunched the app into a live install",
			);
			assert.equal(alive(child.pid), true, "the watchdog exited while holding");

			// The installer goes: the install is over, and the app comes back.
			installer.kill();
			const { code } = await exited;
			assert.equal(code, 0);
			/*
			 * The relaunch is BACKGROUNDED by the script (`open ... &`), so the file
			 * appearing is what is waited for rather than what is read - the script
			 * exits without waiting for it, which is deliberate on its side.
			 */
			const relaunchDeadline = Date.now() + 5_000;
			while (!existsSync(launchLog) && Date.now() < relaunchDeadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			assert.match(readFileSync(launchLog, "utf8"), /open -a .*Fixture\.app/);
		} finally {
			await reap(child.pid);
			await reap(installer.pid);
		}
	},
);

// ---------------------------------------------------------------------------
// The shipped handler, driven with Electron stubbed
// ---------------------------------------------------------------------------

/**
 * The main process, bundled the way the rest of this file bundles its modules,
 * with Electron and the updater replaced by fixtures.
 *
 * Why stubbed rather than launched: what these cases are about is what the
 * service DOES with a staged update bundle - extract it, probe it, record it,
 * start the installer, or fall back - and every one of those is observable
 * without a window. The bundle graph IS the app's main process, so the fixtures
 * below cover every surface it touches at import time. Every path it reads or
 * writes is redirected into a temp dir (`__loTestPaths` for Electron's own paths
 * and `LOCAL_OPERATOR_LOG_DIR` for the logger, which resolves from the account
 * home rather than from `userData`), so nothing of the operator's own install,
 * state or app is touched.
 */
async function loadUpdateServiceModule() {
	const fixture = (contents) => ({
		contents,
		loader: "js",
		resolveDir: process.cwd(),
	});
	const bundle = await build({
		stdin: {
			contents: 'export * from "./src/main/update-service";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		// The graph reaches CJS dependencies (dotenv, zod), which esbuild's ESM
		// output cannot `require` without this shim.
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
									get isPackaged() { return globalThis.__loTestAppIsPackaged ?? true; },
									getPath: (name) => paths[name] ?? paths.userData,
									getVersion: () => "0.0.0-test",
									getName: () => "Local Operator",
									getAppPath: () => process.cwd(),
									whenReady: async () => {},
									on: () => app,
									once: () => app,
									quit: () => { (globalThis.__loQuits ??= []).push("quit"); },
									relaunch: () => {},
									exit: () => { (globalThis.__loQuits ??= []).push("exit"); },
									isReady: () => true,
									commandLine: { appendSwitch: () => {} },
									setAsDefaultProtocolClient: () => true,
									requestSingleInstanceLock: () => true,
									releaseSingleInstanceLock: () => {},
								};
								export const ipcMain = {
									handle: (channel, fn) => { (globalThis.__loIpcHandlers ??= {})[channel] = fn; },
									on: () => {},
									once: () => {},
									removeHandler: (channel) => { delete (globalThis.__loIpcHandlers ?? {})[channel]; },
									removeAllListeners: () => {},
								};
								export class BrowserWindow {
									constructor() {
										this.webContents = { send: (channel, payload) => { (globalThis.__loSent ??= []).push({ channel, payload }); }, isDestroyed: () => false, on: () => {}, once: () => {}, setWindowOpenHandler: () => {} };
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
								export const net = { isOnline: () => true };
								export const powerMonitor = { on: () => powerMonitor };
							`);
						}
						if (args.path === "electron-updater") {
							return fixture(`
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
									checkForUpdates: async () => null,
									downloadUpdate: async () => [],
									// The half of Squirrel's path this change has to be able to
									// reach, and the half it must NOT reach when it stages the
									// update itself: recorded rather than ignored.
									quitAndInstall: (...args) => { (globalThis.__loQuitAndInstall ??= []).push(args); },
									setFeedURL: () => {},
									autoDownload: false,
									autoInstallOnAppQuit: false,
									logger: null,
								};
							`);
						}
						return fixture(`
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
	const serviceDir = tempDir("lo-shipit-service-");
	const serviceFile = join(serviceDir, "update-service.mjs");
	writeFileSync(serviceFile, bundle.outputFiles[0].text);
	return { service: await import(serviceFile) };
}

const FIXTURE_BUNDLE_ID = "com.local-operator.shipit-fixture";
const FIXTURE_APP_NAME = "Local Operator";

/**
 * An ad-hoc signed stand-in for the app, in the layout the real one has.
 *
 * The framework is the one Electron ships and codesign expects: `Versions/A`
 * holding the real content, `Current` and the two root symlinks pointing at it.
 * That shape matters rather than being scenery - a `.framework` directory that
 * does not follow it makes `codesign` refuse the whole app ("unsealed contents
 * present in the root directory of an embedded framework"), and then nothing in
 * this file could be tested against a sealed bundle.
 */
/**
 * A stand-in for the app's own executable.
 *
 * It has to be a Mach-O carrying THIS machine's architecture: the staging
 * pre-flight reads the staged bundle's architecture with `lipo -archs`, and
 * macOS's own `/bin/*` tools are `arm64e` rather than `arm64` (measured), which
 * that check correctly refuses. Three lines of C compiled with the toolchain the
 * machine already has is the cheapest honest answer; the interpreter this test is
 * already running on is the fallback for a host without one.
 */
function writeAppExecutable(target) {
	try {
		const source = `${target}.c`;
		writeFileSync(source, "int main(void) { return 0; }\n", "utf8");
		execFileSync("/usr/bin/cc", ["-o", target, source]);
		rmSync(source, { force: true });
		return;
	} catch {
		// Fall through: a bundle whose executable is the running interpreter
		// carries this machine's architecture too.
	}
	writeFileSync(target, readFileSync(process.execPath));
}

function writeBundleFixture(
	appPath,
	{
		version,
		withShipIt = true,
		shipItLog,
		// Which app this fixture claims to be, and whether it is tampered with AFTER
		// it was signed. The two are the staged tree's own verdicts (review
		// MINOR-2): a staged bundle that is not the app, and one whose seal is
		// broken, are the cases Squirrel's own path cannot do better on.
		bundleId = FIXTURE_BUNDLE_ID,
		tamper = false,
	},
) {
	const contents = join(appPath, "Contents");
	mkdirSync(join(contents, "MacOS"), { recursive: true });
	writeAppExecutable(join(contents, "MacOS", FIXTURE_APP_NAME));
	const framework = join(contents, "Frameworks", "Squirrel.framework");
	mkdirSync(join(framework, "Versions", "A", "Resources"), { recursive: true });
	writeFileSync(
		join(framework, "Versions", "A", "Squirrel"),
		readFileSync("/bin/echo"),
	);
	writeFileSync(
		join(framework, "Versions", "A", "Resources", "Info.plist"),
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.local-operator.Squirrel</string>
<key>CFBundleExecutable</key><string>Squirrel</string>
<key>CFBundlePackageType</key><string>FMWK</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>
`,
	);
	if (withShipIt) {
		const shipIt = join(framework, "Versions", "A", "Resources", "ShipIt");
		writeFileSync(
			shipIt,
			`#!/bin/sh\nprintf '%s\\n' "$$" "$@" >> "${shipItLog}"\n`,
		);
		execFileSync("/bin/chmod", ["+x", shipIt]);
	}
	writeFileSync(
		join(contents, "Info.plist"),
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>${FIXTURE_APP_NAME}</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`,
	);
	execFileSync("/bin/ln", ["-s", "A", join(framework, "Versions", "Current")]);
	execFileSync("/bin/ln", [
		"-s",
		"Versions/Current/Squirrel",
		join(framework, "Squirrel"),
	]);
	execFileSync("/bin/ln", [
		"-s",
		"Versions/Current/Resources",
		join(framework, "Resources"),
	]);
	// Ad-hoc, because a test has no Developer ID: the seal is real, the identity
	// is not, and nothing here cares which - every path under test reads the
	// verdict of `codesign --verify`, which an ad-hoc signature satisfies.
	execFileSync("/usr/bin/codesign", [
		"--force",
		"--deep",
		"--sign",
		"-",
		appPath,
	]);
	if (tamper) {
		// A file added to a SEALED bundle: `codesign --verify` reports it as a
		// sealed resource that is missing or invalid, which is the reading the
		// staging step makes and Apple's own validation would make too.
		writeFileSync(join(contents, "MacOS", "added-after-signing.txt"), "x");
	}
	return appPath;
}

/** The update artifact: the same app at `version`, zipped the way Squirrel zips. */
function writeUpdateZip(dir, { version, shipItLog, bundleId, tamper = false }) {
	const staged = join(dir, "update-tree");
	mkdirSync(staged, { recursive: true });
	writeBundleFixture(join(staged, `${FIXTURE_APP_NAME}.app`), {
		version,
		shipItLog,
		bundleId,
		tamper,
	});
	const zipPath = join(dir, `local-operator-ui-${version}-arm64.zip`);
	execFileSync("/usr/bin/ditto", [
		"-c",
		"-k",
		"--sequesterRsrc",
		"--keepParent",
		join(staged, `${FIXTURE_APP_NAME}.app`),
		zipPath,
	]);
	return zipPath;
}

/**
 * One service, one scratch world, and the record of what it did.
 *
 * The service is the shipped one; the world is a temp userData whose cache root
 * is the operator's own (`~/Library/Caches`, because that is where Squirrel's
 * log lives and the module resolves it from the account home), so the bundle id
 * is a synthetic one and its cache directory is removed by the caller.
 */
async function withUpdateService(run) {
	const home = tempDir("lo-shipit-home-");
	const userData = tempDir("lo-shipit-userdata-");
	const logDir = tempDir("lo-shipit-logs-");
	process.env.LOCAL_OPERATOR_LOG_DIR = logDir;
	globalThis.__loTestPaths = {
		home,
		userData,
		appData: userData,
		temp: tmpdir(),
	};
	globalThis.__loTestLogs = [];
	globalThis.__loQuitAndInstall = [];
	globalThis.__loQuits = [];
	const { service } = await loadUpdateServiceModule();
	const updateService = new service.UpdateService({
		isDestroyed: () => false,
		webContents: {
			send: (channel, payload) => {
				if (!globalThis.__loSent) globalThis.__loSent = [];
				globalThis.__loSent.push({ channel, payload });
			},
			on: () => {},
			once: () => {},
			isDestroyed: () => false,
		},
	});
	// The handlers are registered by the app's own start-up call, which is the
	// seam the renderer's `quit-and-install` invocation goes through.
	updateService.setupIpcHandlers();
	// Squirrel's own cache root, resolved the way the module resolves it - from
	// the account home rather than from userData - so the fixture's synthetic
	// bundle id is what keeps this off the operator's own install.
	const shipItCache = shipItCacheDir(
		join(process.env.HOME ?? "", "Library", "Caches"),
		FIXTURE_BUNDLE_ID,
	);
	try {
		return await run({ updateService, userData, home, shipItCache });
	} finally {
		if (updateService.updateCheckInterval) {
			clearInterval(updateService.updateCheckInterval);
		}
		rmSync(shipItCache, { recursive: true, force: true });
		rmSync(join(logDir), { recursive: true, force: true });
		// The override has to be ABSENT rather than empty: the logger treats an
		// unset variable as "use the default path" and an empty string as "not a
		// usable override".
		// biome-ignore lint/performance/noDelete: teardown of a fixture global.
		delete process.env.LOCAL_OPERATOR_LOG_DIR;
		// Every reader of these uses `??`/truthiness, and ABSENT is what "no
		// override for this case" means.
		for (const key of [
			"__loTestPaths",
			"__loTestLogs",
			"__loQuitAndInstall",
			"__loQuits",
			"__loSent",
			"__loIpcHandlers",
		]) {
			delete globalThis[key];
		}
	}
}

/** The updater's own view of the release a test staged. */
function releaseMetadata(zipPath, version) {
	const bytes = readFileSync(zipPath);
	return {
		version,
		path: zipPath,
		files: [
			{
				url: `local-operator-ui-${version}-arm64.zip`,
				size: bytes.length,
				sha512: createHash("sha512").update(bytes).digest("base64"),
			},
		],
	};
}

/**
 * The shipped handler stages the update itself, starts the installer and quits -
 * and never calls `quitAndInstall`.
 *
 * This is the change, end to end, as far as any machine but the operator's can
 * carry it: the REAL pre-flight (an ad-hoc sealed stand-in bundle, a real zip with
 * a real sha512), the REAL staging (`ditto -x -k` into the app's own
 * `update-staging` root, the staged bundle's own seal via `readBundleSeal`), the
 * REAL state plist, the REAL detached spawner, and the REAL marker - driven
 * through the `quit-and-install` handler the renderer invokes.
 *
 * What it cannot carry is the install itself: ShipIt is the fixture's own script
 * and the spawner is still waiting for THIS process to go, which is exactly the
 * state the app is in when it quits. So the assertions are about what the app has
 * done and handed over by then.
 */
test(
	"the handler stages the update, starts the installer, and quits instead of quitAndInstall",
	{ skip: process.platform !== "darwin" },
	async () => {
		const dir = scratchDir("handler");
		const shipItLog = join(dir, "shipit-argv.log");
		const runningBundle = writeBundleFixture(
			join(dir, "tree", `${FIXTURE_APP_NAME}.app`),
			{ version: "0.0.1", shipItLog },
		);
		const zipPath = writeUpdateZip(dir, { version: "0.0.2", shipItLog });

		let installerPid = null;
		await withUpdateService(async ({ updateService, userData }) => {
			updateService.runningBundleProbe = () => runningBundle;
			updateService.downloadedArtifactPath = zipPath;
			updateService.lastUpdateInfo = releaseMetadata(zipPath, "0.0.2");

			const handler = globalThis.__loIpcHandlers["quit-and-install"];
			assert.equal(typeof handler, "function");
			assert.equal(await handler(), true);

			// Squirrel's own path was NOT taken: that is the whole point.
			assert.deepEqual(globalThis.__loQuitAndInstall, []);
			assert.deepEqual(globalThis.__loQuits, ["quit"]);

			// The app staged the bundle itself, under its own root, on the target's
			// volume.
			const stagingRoot = updateStagingRoot(userData);
			const trees = readdirSync(stagingRoot);
			assert.equal(trees.length, 1, JSON.stringify(trees));
			const stagingDir = join(stagingRoot, trees[0]);
			assert.match(trees[0], /^0\.0\.2-[0-9a-f]+$/);
			const stagedApp = join(stagingDir, `${FIXTURE_APP_NAME}.app`);
			assert.equal(existsSync(join(stagedApp, "Contents", "Info.plist")), true);
			// The zip's own signature survived the extraction, which is the claim the
			// design makes about `ditto -x -k` rather than assumes.
			execFileSync("/usr/bin/codesign", [
				"--verify",
				"--deep",
				"--strict",
				stagedApp,
			]);
			// And the staged copy is the NEW version, not the one being replaced.
			assert.equal(
				execFileSync("/usr/bin/plutil", [
					"-extract",
					"CFBundleShortVersionString",
					"raw",
					"-o",
					"-",
					join(stagedApp, "Contents", "Info.plist"),
				])
					.toString()
					.trim(),
				"0.0.2",
			);

			// The state plist points ShipIt at the staged tree, with Squirrel's own
			// five keys and the app's relaunch instruction.
			const statePath = stagingStatePath(stagingDir);
			const state = JSON.parse(readFileSync(statePath, "utf8"));
			assert.deepEqual(state, {
				bundleIdentifier: FIXTURE_BUNDLE_ID,
				targetBundleURL: `file://${encodeURI(runningBundle)}/`,
				updateBundleURL: `file://${encodeURI(stagedApp)}/`,
				launchAfterInstallation: true,
				useUpdateBundleName: true,
			});

			// The marker names the installer, which is what every reader of "is an
			// install in flight" now turns on - and the pid in it is the pid the log
			// line names, so the two halves of the handover agree.
			const marker = install.readPendingInstallMarker(userData);
			assert.equal(marker.targetVersion, "0.0.2");
			assert.equal(typeof marker.installerPid, "number");
			installerPid = marker.installerPid;
			assert.ok(
				globalThis.__loTestLogs.some((line) =>
					line.includes(`installer pid ${installerPid}`),
				),
				JSON.stringify(globalThis.__loTestLogs),
			);
			assert.equal(alive(installerPid), true, "the installer was not started");

			// The three steps of the pre-quit work, in the order they happened (UX
			// U5): the pre-flight, the staging, and the spawn.
			assert.deepEqual(
				globalThis.__loSent.map((entry) => entry.payload?.phase),
				["verifying", "staging", "starting"],
			);
			// It is OUR installer, by the machine's own answer: a waiting spawner
			// whose command line carries the token.
			const commandLine = commandLineOf(installerPid);
			assert.match(commandLine, new RegExp(INSTALLER_TOKEN));
			assert.equal(
				installerIsAlive({
					pid: installerPid,
					commandLine,
					shipItPath: join(
						runningBundle,
						"Contents",
						"Frameworks",
						"Squirrel.framework",
						"Versions",
						"Current",
						"Resources",
						"ShipIt",
					),
					stagingRoot,
				}),
				true,
			);
		});
		await reap(installerPid);
	},
);

/**
 * With the installer missing, the handler falls back to Squirrel's own path.
 *
 * The fallback is the safety of this change, so it is asserted in the direction
 * that matters: a bundle whose `Squirrel.framework` cannot supply ShipIt still
 * installs, four minutes slower, with the marker the old path writes - and
 * nothing of the new path (no staging tree, no installer pid) is left half-done.
 */
test(
	"the handler falls back to Squirrel's own install path when it cannot stage",
	{ skip: process.platform !== "darwin" },
	async () => {
		const dir = scratchDir("fallback");
		const shipItLog = join(dir, "shipit-argv.log");
		const runningBundle = writeBundleFixture(
			join(dir, "tree", `${FIXTURE_APP_NAME}.app`),
			{ version: "0.0.1", withShipIt: false, shipItLog },
		);
		const zipPath = writeUpdateZip(dir, { version: "0.0.2", shipItLog });

		await withUpdateService(async ({ updateService, userData }) => {
			updateService.runningBundleProbe = () => runningBundle;
			updateService.downloadedArtifactPath = zipPath;
			updateService.lastUpdateInfo = releaseMetadata(zipPath, "0.0.2");

			// Absent rather than empty until something is sent: the rig creates the
			// record on the first push.
			assert.deepEqual(globalThis.__loSent ?? [], []);
			assert.equal(
				await globalThis.__loIpcHandlers["quit-and-install"](),
				true,
			);
			/*
			 * The wait is named as it happens (UX U5), and on this path it stops
			 * where the refusal does: the pre-flight, then the staging that could
			 * not proceed. No `starting` - nothing of ours starts here, and claiming
			 * a step that did not happen is exactly the kind of copy this change is
			 * removing.
			 */
			assert.deepEqual(
				globalThis.__loSent.map((entry) => entry.payload?.phase),
				["verifying", "staging"],
			);

			// Squirrel's own path, once, with its own arguments.
			assert.deepEqual(globalThis.__loQuitAndInstall, [[false, true]]);
			// `app.quit()` is what the direct path does, and it must NOT be what
			// happens here: Squirrel's `quitAndInstall` owns the quit on this path.
			assert.deepEqual(globalThis.__loQuits, []);

			const marker = install.readPendingInstallMarker(userData);
			assert.equal(marker.targetVersion, "0.0.2");
			assert.equal(marker.installerPid, null);
			// Nothing of the new path was started or staged.
			assert.equal(existsSync(updateStagingRoot(userData)), false);
			assert.ok(
				globalThis.__loTestLogs.some((line) =>
					/Not staging the update for the installer: .*ShipIt/.test(line),
				),
				JSON.stringify(globalThis.__loTestLogs),
			);
		});
	},
);

/**
 * The extraction is asynchronous, and the bound really stops a wedged one.
 *
 * `spawnSync` with a timeout spent the WHOLE bound (ten minutes, against a measured
 * ~5 s for the real artifact) frozen on the main process's own thread - the install
 * panel included - and the case the bound exists for is the one where that is worst:
 * a `ditto` wedged on a slow or nearly-full volume (review MINOR-5). The three cases
 * below are the three outcomes: it works, it fails with a reason, and a process that
 * will not finish is killed at the bound rather than outliving the decision to stop
 * waiting for it.
 */
test(
	"the extraction is async, reports why it failed, and kills one that will not finish",
	{ skip: process.platform !== "darwin" },
	async () => {
		const dir = scratchDir("extraction");
		const shipItLog = join(dir, "shipit-argv.log");
		const zipPath = writeUpdateZip(dir, { version: "0.0.2", shipItLog });

		// The module is loaded inside the rig because its logger resolves its
		// directory from the account home, exactly as it does in production.
		await withUpdateService(async () => {
			// The namespace the rig already loads, so what is driven is the shipped
			// function rather than a copy of it.
			const { service: module } = await loadUpdateServiceModule();

			// 1. The real artifact, through the shipped argv: the staged tree appears.
			const target = join(dir, "staged");
			mkdirSync(target, { recursive: true });
			assert.deepEqual(await module.runExtraction(zipPath, target), {
				ok: true,
			});
			assert.equal(existsSync(join(target, `${FIXTURE_APP_NAME}.app`)), true);

			// 2. A file that is not an archive: the failure carries `ditto`'s own words
			//    rather than an exit code alone, because that string is what the log
			//    line and the refusal panel are built from.
			const notAZip = join(dir, "not-a-zip.zip");
			writeFileSync(notAZip, "this is not an archive");
			const failed = await module.runExtraction(notAZip, join(dir, "failed"));
			assert.equal(failed.ok, false);
			assert.match(failed.reason, /ditto exited \d+/);

			// 3. A process that never finishes is killed at the bound, and the proof is
			//    taken from outside it as well as from its own record: a bound that
			//    leaves the child running leaks a process holding a half-written staging
			//    tree, and the child's own `echo` cannot be the only way to see that (it
			//    depends on the child having been scheduled far enough to write).
			const stuck = join(dir, "stuck.sh");
			const stuckPid = join(dir, "stuck.pid");
			writeFileSync(stuck, `#!/bin/sh\necho $$ > "${stuckPid}"\nsleep 300\n`);
			execFileSync("/bin/chmod", ["+x", stuck]);
			const started = Date.now();
			/*
			 * The bound is seconds, not milliseconds, and that is the fix for the
			 * flake rather than a loosening (review R3-2). The stand-in has to be
			 * forked, exec'd and SCHEDULED as far as its second line before the bound
			 * kills it, and none of that is bounded by anything this test controls: on
			 * a box at load 200 with two dozen sessions on it, a process can sit
			 * ready-but-unscheduled for seconds. Measured with the original 700 ms
			 * bound: 4 identical runs, pass, pass, fail, fail, each failing in the read
			 * below because the child had been killed before it reached its own
			 * `echo`. What this case is about is that the bound ENDS the wait instead
			 * of the shipped ten-minute default, and that is what the elapsed
			 * assertion measures - the bound's smallness was never the claim.
			 */
			const wedged = await module.runExtraction(zipPath, join(dir, "wedged"), {
				command: stuck,
				timeoutMs: 8000,
			});
			assert.equal(wedged.ok, false);
			assert.match(wedged.reason, /still running after 8000 ms/);
			assert.ok(
				Date.now() - started < 60000,
				"the wait ended on the shipped default rather than on the bound",
			);
			/*
			 * The kill is asserted from OUTSIDE the child as well as from its own
			 * record, because the record depends on the child having been scheduled far
			 * enough to write it: nothing running the stand-in's own path may be left,
			 * which is the claim the bound exists for (a half-written staging tree with
			 * a live process inside it is worse than no staging tree). The path is this
			 * run's own, so another session's processes cannot satisfy it - and it is
			 * polled, because a process killed by signal is reaped asynchronously just
			 * like the pid below.
			 */
			let survivors = processList().filter((line) => line.includes(stuck));
			for (let attempt = 0; attempt < 80 && survivors.length > 0; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				survivors = processList().filter((line) => line.includes(stuck));
			}
			assert.deepEqual(
				survivors,
				[],
				"the wedged extraction's process was still running after its bound",
			);
			/*
			 * And the sharper reading, whenever the stand-in did record itself: the pid it
			 * wrote must be gone. Polled rather than read once, because the signal is
			 * delivered synchronously but the child is reaped asynchronously - a killed
			 * process is still visible as a zombie for that moment, which is a fact about
			 * reaping rather than about whether the bound holds.
			 *
			 * The file MAY legitimately be absent, and this does not pretend otherwise:
			 * the child is killed at the bound whether or not it was ever scheduled as far
			 * as its own first line, and on this box (load 200, two dozen sessions) that is
			 * a real outcome rather than a bug in the bound. The listing above is then the
			 * whole proof of the kill, and it is unconditional.
			 */
			let pidText = null;
			for (let attempt = 0; attempt < 120 && pidText === null; attempt++) {
				if (existsSync(stuckPid)) pidText = readFileSync(stuckPid, "utf8");
				if (pidText === null) {
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
			}
			if (pidText !== null) {
				const pid = Number.parseInt(pidText.trim(), 10);
				let gone = false;
				for (let attempt = 0; attempt < 80 && !gone; attempt++) {
					gone = !alive(pid);
					if (!gone) await new Promise((resolve) => setTimeout(resolve, 50));
				}
				assert.equal(gone, true, "the wedged extraction outlived its bound");
			}
		});
	},
);

/**
 * The staged tree's OWN verdicts stop the install, and are not handed to Squirrel.
 *
 * WHY THIS IS NOT A FALLBACK (review MINOR-2). Squirrel's path would unpack the same
 * artifact and run the same validation, so for these two readings it reaches the same
 * answer - four minutes later, after the app has been closed for the whole of it, and
 * delivered as a failed install instead of a panel with a remedy. The three
 * *preconditions* (no ShipIt, another volume, a `ditto` that failed) are the opposite
 * case: Squirrel does that work itself and may well succeed, so those fall back.
 *
 * Both halves of the distinction are asserted here, on the shipped handler: the
 * refusal reaches the renderer as a block, and the marker - the record of an install
 * this app was about to run - is never written.
 */
test(
	"a staged tree that is not this app, or is not sealed, is blocked rather than handed to Squirrel",
	{ skip: process.platform !== "darwin" },
	async () => {
		const cases = [
			{
				name: "a staged bundle that is a different application",
				zip: (dir, shipItLog) =>
					writeUpdateZip(dir, {
						version: "0.0.2",
						shipItLog,
						bundleId: "com.local-operator.something-else",
					}),
				detail: /is not this application/,
			},
			{
				name: "a staged bundle whose seal was broken after it was signed",
				zip: (dir, shipItLog) =>
					writeUpdateZip(dir, {
						version: "0.0.2",
						shipItLog,
						tamper: true,
					}),
				detail: /seal reads `unsealed`/,
			},
		];
		for (const testCase of cases) {
			const dir = scratchDir(`blocked-${cases.indexOf(testCase)}`);
			const shipItLog = join(dir, "shipit-argv.log");
			const runningBundle = writeBundleFixture(
				join(dir, "tree", `${FIXTURE_APP_NAME}.app`),
				{ version: "0.0.1", shipItLog },
			);
			const zipPath = testCase.zip(dir, shipItLog);

			await withUpdateService(async ({ updateService, userData }) => {
				updateService.runningBundleProbe = () => runningBundle;
				updateService.downloadedArtifactPath = zipPath;
				updateService.lastUpdateInfo = releaseMetadata(zipPath, "0.0.2");
				globalThis.__loSent = [];

				assert.equal(
					await globalThis.__loIpcHandlers["quit-and-install"](),
					false,
					testCase.name,
				);
				// Neither installer ran, and the app is still here: nothing was quit
				// for an install that cannot succeed.
				assert.deepEqual(globalThis.__loQuitAndInstall, [], testCase.name);
				assert.deepEqual(globalThis.__loQuits, [], testCase.name);
				// No marker: no install was recorded, so recovery has nothing to
				// report as a failure on the next launch.
				assert.equal(
					install.readPendingInstallMarker(userData),
					null,
					testCase.name,
				);
				const block = globalThis.__loSent.find(
					(entry) => entry.channel === "update-install-blocked",
				);
				assert.ok(block, `${testCase.name}: no block reached the renderer`);
				assert.equal(block.payload.code, "download-verification-failed");
				assert.match(block.payload.detail, testCase.detail, testCase.name);
				assert.ok(
					globalThis.__loTestLogs.some((line) =>
						/Refusing to install the staged update: /.test(line),
					),
					`${testCase.name}: ${JSON.stringify(globalThis.__loTestLogs)}`,
				);
			});
		}
	},
);

/**
 * The installer's log is a precondition of the staging, checked before the quit.
 *
 * The redirect that opens it lives inside the spawner, after this process is gone
 * (review MINOR-1): `exec ... >>"$LOG" 2>&1` on a `sh` whose redirect fails ends the
 * shell, so ShipIt never starts, nothing is logged, and the user is left with a
 * marker naming a dead pid and a failure panel for an install that could not begin -
 * repeatable while the cache directory stays unwritable. Refusing instead costs the
 * fast path and still installs.
 */
test(
	"an installer log that cannot be opened refuses the staging instead of quitting into it",
	{ skip: process.platform !== "darwin" },
	async () => {
		const dir = scratchDir("log-refusal");
		const shipItLog = join(dir, "shipit-argv.log");
		const runningBundle = writeBundleFixture(
			join(dir, "tree", `${FIXTURE_APP_NAME}.app`),
			{ version: "0.0.1", shipItLog },
		);
		const zipPath = writeUpdateZip(dir, { version: "0.0.2", shipItLog });

		await withUpdateService(
			async ({ updateService, userData, shipItCache }) => {
				// The cache ROOT is a file, so the log's directory cannot be created -
				// the same failure an unwritable cache directory produces on a real
				// machine, without depending on permission bits a root-owned CI runner
				// would ignore.
				rmSync(shipItCache, { recursive: true, force: true });
				writeFileSync(shipItCache, "not a directory");

				updateService.runningBundleProbe = () => runningBundle;
				updateService.downloadedArtifactPath = zipPath;
				updateService.lastUpdateInfo = releaseMetadata(zipPath, "0.0.2");

				assert.equal(
					await globalThis.__loIpcHandlers["quit-and-install"](),
					true,
				);
				assert.deepEqual(globalThis.__loQuitAndInstall, [[false, true]]);
				assert.deepEqual(globalThis.__loQuits, []);
				assert.ok(
					globalThis.__loTestLogs.some((line) =>
						/Not staging the update for the installer: the installer's log .* could not be opened for appending/.test(
							line,
						),
					),
					JSON.stringify(globalThis.__loTestLogs),
				);
				// The fallback still records its install, exactly as Squirrel's path did.
				const marker = install.readPendingInstallMarker(userData);
				assert.equal(marker.targetVersion, "0.0.2");
				assert.equal(marker.installerPid, null);
			},
		);
	},
);

/**
 * Recovery: a marker whose installer is ALIVE is in flight and keeps everything;
 * one whose installer is gone is a failure, and reaps the staged tree it left.
 *
 * This is the predicate rewrite, driven through the shipped start-up path - and
 * the two directions are the two ways it can be wrong. Reading a live install as
 * failed reaps a tree ShipIt is reading (the 2026-09-13 class); reading a dead
 * one as live means a failed install is never reported and the tree is never
 * cleaned up. An install this app started has no launchd job, so on this machine
 * the job-based reading would call it over the instant it began.
 */
test(
	"recovery keeps a live installer's staged tree, and reaps a dead install's",
	{ skip: process.platform !== "darwin" },
	async () => {
		const dir = scratchDir("recovery");
		const runningBundle = writeBundleFixture(
			join(dir, "tree", `${FIXTURE_APP_NAME}.app`),
			{ version: "0.0.1", shipItLog: join(dir, "shipit-argv.log") },
		);

		// A stand-in for the waiting installer: a real process whose command line
		// is `sh -c <script carrying the token>`.
		const installer = spawn(
			"/bin/sh",
			[
				"-c",
				`# ${INSTALLER_TOKEN}\nwhile kill -0 "$1" 2>/dev/null; do sleep 0.2; done`,
				"lo-update-installer",
				String(process.pid),
			],
			{ stdio: "ignore" },
		);
		/*
		 * The wait is on the child's own `exit` and not on the pid going away.
		 * A killed process is a ZOMBIE until its parent reaps it, and a zombie
		 * still answers `kill -0` and still has a command line - so a test that
		 * polled the pid would be measuring the reap rather than the script, and
		 * `installerIsAlive` would be told a dead installer is alive.
		 */
		const installerGone = new Promise((resolve) =>
			installer.on("exit", resolve),
		);

		try {
			await withUpdateService(async ({ updateService, userData }) => {
				updateService.runningBundleProbe = () => runningBundle;
				const stagingDir = updateStagingDir({
					userDataDir: userData,
					version: "0.0.2",
					nonce: "abc123",
				});
				mkdirSync(stagingDir, { recursive: true });
				writeFileSync(join(stagingDir, "Local Operator.app"), "staged");
				install.writePendingInstallMarker(userData, {
					targetVersion: "0.0.2",
					artifactPath: "/tmp/update.zip",
					startedAt: new Date().toISOString(),
					watchdogPid: null,
					installerPid: installer.pid,
				});

				// The installer is alive: in flight, and nothing is reaped.
				updateService.recoverPendingInstall();
				assert.equal(existsSync(stagingDir), true);
				assert.notEqual(install.readPendingInstallMarker(userData), null);
				assert.ok(
					globalThis.__loTestLogs.some(
						(line) =>
							line.includes(`pid ${installer.pid}`) &&
							line.includes("still running"),
					),
					JSON.stringify(globalThis.__loTestLogs),
				);

				// The installer is gone: the install failed, and the tree it staged
				// is the app's to clean up.
				installer.kill();
				await installerGone;
				updateService.recoverPendingInstall();
				assert.equal(
					existsSync(stagingDir),
					false,
					"a failed install's staged tree was left behind",
				);
				/*
				 * The MARKER stays, deliberately: it is the only record that an
				 * install was attempted, and it is cleared when the failure notice
				 * is delivered rather than here (`recoverPendingInstall`'s own
				 * docstring). What must be here is the recorded failure - the app's
				 * account of what happened, which is what the panel renders.
				 */
				assert.notEqual(install.readPendingInstallMarker(userData), null);
				const attempt = readFileSync(
					join(userData, "last-update-install.json"),
					"utf8",
				);
				assert.match(attempt, /0\.0\.2/);
			});
		} finally {
			await reap(installer.pid);
		}
	},
);

/**
 * A completed install is SAID, once, on the launch after it (UX U4).
 *
 * The fast path's window is seconds, so the app coming back is no longer the report
 * that the update went in: the user saw a window vanish, a banner promising minutes
 * (before UX U1) and then their app again, on the new version, with nothing saying
 * so. Recovery is the one place the app learns an install landed - the marker's
 * target is the version it is now running - so it is the one place that can say it.
 *
 * What is asserted is the whole shape of the claim: the event carries the version the
 * install was FOR, it is sent once, and the marker is gone by then, so a second
 * launch cannot repeat it.
 */
test(
	"a completed install reports itself once, with the version it landed on",
	{ skip: process.platform !== "darwin" },
	async () => {
		const dir = scratchDir("succeeded");
		const runningBundle = writeBundleFixture(
			join(dir, "tree", `${FIXTURE_APP_NAME}.app`),
			{ version: "0.0.0-test", shipItLog: join(dir, "shipit-argv.log") },
		);

		await withUpdateService(async ({ updateService, userData }) => {
			updateService.runningBundleProbe = () => runningBundle;
			globalThis.__loSent = [];
			install.writePendingInstallMarker(userData, {
				// The version the app is RUNNING, which is the install having landed.
				targetVersion: "0.0.0-test",
				artifactPath: "/tmp/update.zip",
				startedAt: new Date().toISOString(),
				watchdogPid: null,
				installerPid: 987654,
			});

			updateService.recoverPendingInstall();
			assert.equal(install.readPendingInstallMarker(userData), null);

			// The delivery waits for the window (`did-finish-load`, with a 5 s
			// fallback), so the notice is waited for rather than read immediately.
			const deadline = Date.now() + 7_000;
			let succeeded = null;
			while (succeeded === null && Date.now() < deadline) {
				succeeded =
					globalThis.__loSent.find(
						(entry) => entry.channel === "update-install-succeeded",
					) ?? null;
				if (succeeded === null) {
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
			}
			assert.deepEqual(succeeded?.payload, { version: "0.0.0-test" });

			// Once, not on every pass: a second recovery of the same launch has
			// nothing left to report, because the marker it read is gone.
			globalThis.__loSent = [];
			updateService.recoverPendingInstall();
			await new Promise((resolve) => setTimeout(resolve, 5_200));
			assert.deepEqual(
				globalThis.__loSent.filter(
					(entry) => entry.channel === "update-install-succeeded",
				),
				[],
			);
		});
	},
);
