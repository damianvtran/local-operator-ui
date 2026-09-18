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
	installRunningNow,
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
 * The values here are the ones this machine's own
 * `~/Library/Caches/com.local-operator.ShipIt/ShipItState.plist` carries - written
 * by the 2026-09-18 11:59 install and read back by ShipIt - so the comparison is
 * against the artifact rather than against a reading of the note.
 */
test("the state plist is Squirrel's own schema", () => {
	const plist = shipItStatePlist({
		bundleIdentifier: "com.local-operator",
		targetBundlePath: "/Applications/Local Operator.app",
		updateBundlePath:
			"/Users/damian/Library/Application Support/Local Operator/update-staging/0.28.5-abc123/Local Operator.app",
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
		"file:///Users/damian/Library/Application%20Support/Local%20Operator/update-staging/0.28.5-abc123/Local%20Operator.app/",
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
 * `installRunningNow` is the pid-first rule the whole change turns on: a marker
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
	const jobRunning = () => {
		jobAsked++;
		return true;
	};

	// A live installer: in flight, and launchd is not asked at all.
	assert.equal(
		installRunningNow({
			marker: markerOf(4242),
			installerCommandLine: `${shipItPath} com.local-operator.ShipIt ${stagingRoot}/0.28.5-abc/state.plist`,
			shipItPath,
			stagingRoot,
			jobRunning,
		}),
		true,
	);
	assert.equal(jobAsked, 0);
	// Its installer is gone: NOT in flight, whatever launchd says about the job.
	assert.equal(
		installRunningNow({
			marker: markerOf(4242),
			installerCommandLine: null,
			shipItPath,
			stagingRoot,
			jobRunning,
		}),
		false,
	);
	assert.equal(jobAsked, 0);
	// The older path, and the fallback: no pid, so the job is the answer.
	assert.equal(
		installRunningNow({
			marker: markerOf(null),
			installerCommandLine: null,
			shipItPath,
			stagingRoot,
			jobRunning,
		}),
		true,
	);
	assert.equal(jobAsked, 1);

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
		}),
		false,
	);
	// A marker written before this field existed parses as "ask the job".
	assert.equal(
		parsePendingInstallMarker(
			JSON.stringify({
				targetVersion: "0.28.5",
				artifactPath: "/tmp/update.zip",
				startedAt: new Date().toISOString(),
				watchdogPid: 9,
			}),
		).installerPid,
		null,
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
	{ version, withShipIt = true, shipItLog },
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
<key>CFBundleIdentifier</key><string>${FIXTURE_BUNDLE_ID}</string>
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
	return appPath;
}

/** The update artifact: the same app at `version`, zipped the way Squirrel zips. */
function writeUpdateZip(dir, { version, shipItLog }) {
	const staged = join(dir, "update-tree");
	mkdirSync(staged, { recursive: true });
	writeBundleFixture(join(staged, `${FIXTURE_APP_NAME}.app`), {
		version,
		shipItLog,
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

			assert.equal(
				await globalThis.__loIpcHandlers["quit-and-install"](),
				true,
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
							line.includes(`installer pid ${installer.pid}`) &&
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
