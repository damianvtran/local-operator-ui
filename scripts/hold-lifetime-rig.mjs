#!/usr/bin/env node
/**
 * Measure how long a launch lives when it finds an install's marker on disk.
 *
 * WHY THIS EXISTS (review R4). The launch hold's whole argument is that the app's
 * exposure to ShipIt's final running-instance check shrinks from "however long a
 * person leaves a window open" to "a launch that exits by itself". That argument
 * is a WALL-CLOCK claim, and the unit tests bound the decisions and the deadlines
 * rather than the wall clock - so the number has to come from the packaged app,
 * and a number nobody can re-derive is not evidence. This rig is that measurement,
 * on a build of this repository, against the machine's own launchd.
 *
 * WHAT IT DRIVES, and what it substitutes (the honest split):
 *
 * - REAL: the packaged app and its own code path; the pending-install marker on
 *   disk, in the app's own userData; the launchd job question, answered by
 *   `/bin/launchctl list` (the app's probe is passed through to the real tool, and
 *   the job it asks about is one this rig submitted under the RIG BUNDLE's label);
 *   `app.isPackaged`; the quit; the process lifetime.
 * - SUBSTITUTED, and why: (a) `launchctl`'s SUBCOMMANDS OTHER THAN `list` fail, so
 *   the app cannot remove the job this rig submitted (a rig must not change the
 *   operator's launchd domain) - the app's own leftover-job reap logs the refusal
 *   and carries on; (b) the relaunch WATCHDOG is a stand-in that writes what it
 *   would have done instead of waiting on a real install, because the real one
 *   would sit on the machine for up to 30 minutes; (c) notifications are silenced
 *   through `LOCAL_OPERATOR_NO_NOTIFICATIONS`, because a rig must not put banners
 *   on the operator's screen.
 *
 * TWO WINDOW-MODE TRAPS THIS RIG HAS TO AVOID, and does: a STAGED `.app` resolves to a
 * visible window however it is piped unless the launch names a scratch profile or a
 * window mode - and an agent-driven launch must never take the operator's focus - so
 * this one passes `--user-data-dir` AND `LOCAL_OPERATOR_UI_WINDOW_MODE=headless`
 * together; and a launcher that constructs its own Electron window inherits none of
 * the app's guards, which is why this rig is a spawn of the bundled binary rather
 * than a probe.
 *
 * WHAT IT DOES NOT SHOW: that a window was not created. It runs the app under
 * `LOCAL_OPERATOR_UI_WINDOW_MODE=headless`, which suppresses windows on its own, so
 * "no window" is not this rig's finding. The discriminating facts are the process
 * lifetime and the ABSENCE of `Update service initialized` (the line a normal run
 * writes once it builds its window and backend) - and the structural argument that
 * the hold returns before any of that, which lives in `holdLaunchForLiveInstall`.
 *
 * THE NUMBERS IT PRODUCED, for comparison on a later run (this machine,
 * 2026-09-18, load 150-250):
 *
 *   held launch (job RUNNING, marker 45 s old)          793 ms, 2291 ms, 2477 ms
 *   the same, measured independently by QA round 1      4030 ms, 5980 ms
 *   a launch with the job REGISTERED but not running    opens normally (no hold)
 *   a completed install (marker target == app version)  opens normally (no hold)
 *   a failed install (target ahead, job not running)     opens and reports it
 *
 * The last three are the review-U1/U2 cases, and they are the point of the rig as
 * much as the lifetime is: on this machine a registered job outlives its install,
 * so a launch must not be held for one.
 *
 * USAGE
 *
 *   node scripts/hold-lifetime-rig.mjs --app /tmp/build/mac-arm64/"Local Operator.app"
 *   node scripts/hold-lifetime-rig.mjs --app <path> --job registered
 *   node scripts/hold-lifetime-rig.mjs --app <path> --target 0.28.4   # completed install
 *   node scripts/hold-lifetime-rig.mjs --app <path> --job absent --keep
 *
 * `--job` is what the machine says about the install's launchd job: `running` (a
 * live install, the hold), `registered` (the state a finished install leaves
 * behind), or `absent`. `--target` is the version the marker names, and defaults
 * to well above the app's own version, which is what a live install looks like;
 * passing the app's own version is the completed-install case.
 *
 * It exits non-zero when the launch did not do what the state says it should, and
 * it always reaps: the app by pid, the job by label, and the whole scratch tree
 * unless `--keep` asks for it.
 */

import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

/** `/bin/launchctl`, by absolute path: this is the machine's own answer. */
const LAUNCHCTL = "/bin/launchctl";

const USAGE = `usage: hold-lifetime-rig.mjs --app <path to a built .app> [options]

  --job running|registered|absent   what the launchd job is doing (default running)
  --target <version>                the version the marker names (default 99.0.0)
  --hold-ms <n>                     start the marker this many ms ago (default 45000)
  --max-ms <n>                      kill a launch that outlives this (default 60000)
  --root <dir>                      scratch root (default a fresh dir under TMPDIR)
  --keep                            keep the scratch tree, for inspection
`;

function parseArguments(argv) {
	const options = {
		app: null,
		job: "running",
		target: "99.0.0",
		holdMs: 45_000,
		/**
		 * How long a launch may live before the rig kills it and calls the run a
		 * failure. An app that OPENS is meant to keep running, and a rig that waited on
		 * it forever would hang the operator's machine for nothing; the hold path exits
		 * in seconds, so this is generous rather than tight.
		 */
		maxMs: 60_000,
		root: null,
		keep: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === "--app") {
			options.app = argv[++index];
		} else if (flag === "--job") {
			options.job = argv[++index];
		} else if (flag === "--target") {
			options.target = argv[++index];
		} else if (flag === "--hold-ms") {
			options.holdMs = Number(argv[++index]);
		} else if (flag === "--max-ms") {
			options.maxMs = Number(argv[++index]);
		} else if (flag === "--root") {
			options.root = argv[++index];
		} else if (flag === "--keep") {
			options.keep = true;
		} else if (flag === "--help" || flag === "-h") {
			options.help = true;
		} else {
			throw new Error(`unknown argument: ${flag}`);
		}
	}
	if (!["running", "registered", "absent"].includes(options.job)) {
		throw new Error(
			`--job must be running, registered or absent, not ${options.job}`,
		);
	}
	return options;
}

/** Read one key out of a bundle's Info.plist with the tool that owns that file. */
function plistValue(appPath, key) {
	const result = spawnSync(
		"/usr/bin/defaults",
		["read", join(appPath, "Contents", "Info.plist"), key],
		{ encoding: "utf8" },
	);
	return result.status === 0 ? result.stdout.trim() : null;
}

/** Run launchctl and answer with its status and output, without throwing. */
function launchctl(args) {
	const result = spawnSync(LAUNCHCTL, args, { encoding: "utf8" });
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

/**
 * What the app's watchdog starter would have spawned, captured instead of run.
 *
 * The starter is `spawn("sh", ["-c", plan.script], ...)` - `sh` by name, so PATH
 * decides what runs - and the plan's script is recognisable by the `LO_UPDATE_WATCHDOG_`
 * variables it opens with. The shim below records those invocations, prints what the
 * watchdog would have waited for, and exits; anything else that asks for `sh` is
 * passed through to the real one, so the rig only replaces the thing it means to.
 *
 * A captured invocation, rather than a real watchdog with a stub argv: the real one
 * would sit on this machine for up to thirty minutes waiting on an install that the
 * rig is not running, and "the rig left a process behind" is the one thing a rig on
 * a shared machine may not do.
 */
function writeShellShim(binDir, recordPath) {
	writeFileSync(
		join(binDir, "sh"),
		`#!/bin/sh
case "$*" in
	*LO_UPDATE_WATCHDOG_*)
		printf 'stub watchdog: %s\\n' "$*" >> ${JSON.stringify(recordPath)}
		exit 0
		;;
esac
exec /bin/sh "$@"
`,
		{ mode: 0o755 },
	);
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	if (options.help) {
		process.stdout.write(USAGE);
		return 0;
	}
	if (!options.app) {
		process.stderr.write(USAGE);
		return 2;
	}
	const appPath = resolve(options.app);
	if (!existsSync(appPath)) {
		process.stderr.write(`rig: no app at ${appPath}\n`);
		return 2;
	}
	const bundleId = plistValue(appPath, "CFBundleIdentifier");
	const appVersion = plistValue(appPath, "CFBundleShortVersionString");
	if (!bundleId || !appVersion) {
		process.stderr.write(
			`rig: ${basename(appPath)} has no bundle id or version\n`,
		);
		return 2;
	}
	/*
	 * Refused rather than guarded: the app's install job label is `<bundle id>.ShipIt`
	 * and the operator's OWN app uses `com.local-operator.ShipIt`. A rig that
	 * submitted or removed a job under that label would be impersonating a real
	 * install in the operator's launchd domain, so it declines to run against their
	 * bundle and says why.
	 */
	const jobLabel = `${bundleId}.ShipIt`;
	if (jobLabel === "com.local-operator.ShipIt") {
		process.stderr.write(
			"rig: refusing to drive a bundle whose install-job label is the operator's own " +
				"(com.local-operator.ShipIt) - build a copy with a different CFBundleIdentifier\n",
		);
		return 2;
	}

	const scratch = options.root
		? resolve(options.root)
		: join(tmpdir(), `lo-hold-rig-${process.pid}`);
	const userData = join(scratch, "userdata");
	const logsDir = join(scratch, "logs");
	const binDir = join(scratch, "bin");
	mkdirSync(userData, { recursive: true });
	mkdirSync(logsDir, { recursive: true });
	mkdirSync(binDir, { recursive: true });

	/*
	 * The launchctl shim: `list` is passed THROUGH to the machine's own tool, so the
	 * answer the app acts on is real, while every other subcommand fails, so the app
	 * cannot remove the job this rig submitted. The app logs that refusal and carries
	 * on; nothing in the operator's domain is touched.
	 */
	const shim = join(binDir, "launchctl");
	writeFileSync(
		shim,
		`#!/bin/sh
if [ "$1" = "list" ]; then exec ${LAUNCHCTL} "$@"; fi
echo "rig: launchctl $1 refused by the rig's shim (a rig must not change the operator's launchd domain)" >&2
exit 1
`,
		{ mode: 0o755 },
	);
	const watchdogRecord = join(scratch, "watchdog-plan.log");
	writeShellShim(binDir, watchdogRecord);

	const events = [];
	const log = (message) => {
		events.push(message);
		process.stdout.write(`${message}\n`);
	};

	let jobSubmitted = false;
	const cleanup = (exitCode) => {
		if (jobSubmitted) {
			launchctl(["remove", jobLabel]);
			jobSubmitted = false;
		}
		if (!options.keep) {
			rmSync(scratch, { recursive: true, force: true });
		}
		return exitCode;
	};

	try {
		// 1. The job, submitted for real, under the rig bundle's own label.
		launchctl(["remove", jobLabel]);
		if (options.job !== "absent") {
			// `running` is a job whose program outlives the app; `registered` is one
			// that has already finished, which is what a completed install leaves
			// behind. Both are the machine's own state, not a stub.
			const program = options.job === "running" ? "/bin/sleep" : "/bin/true";
			const args =
				options.job === "running"
					? ["submit", "-l", jobLabel, "--", program, "120"]
					: ["submit", "-l", jobLabel, "--", program];
			const submitted = launchctl(args);
			if (submitted.status !== 0) {
				process.stderr.write(
					`rig: launchctl submit failed: ${submitted.stderr}\n`,
				);
				return cleanup(2);
			}
			jobSubmitted = true;
			if (options.job === "registered") {
				// Wait for the trivial program to finish, so the job is registered and
				// NOT running - the state review U1 is about.
				spawnSync("/bin/sleep", ["1"]);
			}
			log(`job: ${jobLabel} submitted, ${options.job}`);
			log(
				`job: launchctl list says -> ${JSON.stringify(
					launchctl(["list", jobLabel])
						.stdout.split("\n")
						.filter((line) => line.includes("PID") || line.includes("Label"))
						.join(" "),
				)}`,
			);
		} else {
			log(
				`job: ${jobLabel} absent (list exits ${launchctl(["list", jobLabel]).status})`,
			);
		}

		// 2. The marker, in the app's own userData, dated so it is current.
		const marker = {
			targetVersion: options.target,
			artifactPath: join(
				scratch,
				`local-operator-${options.target}-universal.zip`,
			),
			startedAt: new Date(Date.now() - options.holdMs).toISOString(),
			watchdogPid: null,
		};
		const markerPath = join(userData, "pending-update-install.json");
		writeFileSync(markerPath, JSON.stringify(marker, null, 2));
		log(
			`marker: ${markerPath} target ${marker.targetVersion}, ${Math.round(options.holdMs / 1000)} s old`,
		);

		// 3. The launch, with every inherited session variable unset.
		const environment = { ...process.env };
		for (const key of Object.keys(environment)) {
			if (key.startsWith("CMUX_") || key.startsWith("LOP_"))
				delete environment[key];
		}
		Object.assign(environment, {
			HOME: scratch,
			PATH: `${binDir}:/usr/bin:/bin`,
			LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
			LOCAL_OPERATOR_LOG_DIR: logsDir,
			LOCAL_OPERATOR_CONFIG_DIR: join(scratch, "config"),
			/*
			 * "true", not "1": this build validates the variable as an enum of
			 * `true`/`false`, and a launch that passes something else dies in the backend
			 * config with `Invalid enum value. Expected 'true' | 'false', received '1'`
			 * before the window is ever considered (measured while building this rig).
			 */
			LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
			VITE_DISABLE_BACKEND_MANAGER: "true",
		});
		/*
		 * The executable's own name, from the bundle's Info.plist, not the .app's
		 * basename: a rig renames its copy (the install-job label must not collide with
		 * the operator's), and the two differ as soon as it does.
		 */
		const executableName =
			plistValue(appPath, "CFBundleExecutable") ?? basename(appPath, ".app");
		const executable = join(appPath, "Contents", "MacOS", executableName);
		const started = Date.now();
		const child = spawn(executable, [`--user-data-dir=${userData}`], {
			env: environment,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		const exited = new Promise((resolve) => {
			child.on("exit", (code, signal) => resolve({ code, signal }));
		});
		const capped = new Promise((resolve) => {
			const timer = setTimeout(() => {
				resolve({
					code: null,
					signal: `SIGKILL after ${options.maxMs} ms`,
					timedOut: true,
				});
			}, options.maxMs);
			timer.unref();
		});
		const outcome = await Promise.race([exited, capped]);
		if (outcome.timedOut) {
			/*
			 * An app that OPENED is meant to keep running, and an app on the hold path is
			 * not meant to outlive its notice - so either way the rig kills what it
			 * started, because "the rig left a process on the operator's machine" is the
			 * one outcome a rig may not produce.
			 */
			try {
				process.kill(child.pid, "SIGKILL");
			} catch {
				// Already gone, which is the point.
			}
		}
		const lifetimeMs = Date.now() - started;
		log(
			`launch: ${outcome.timedOut ? "killed" : "exited"} after ${lifetimeMs} ms (code ${outcome.code}, signal ${outcome.signal})`,
		);

		// 4. What the app's own log says it decided.
		const updateLog = join(logsDir, "update-service.log");
		const text = existsSync(updateLog) ? readFileSync(updateLog, "utf8") : "";
		for (const line of text.split("\n")) {
			if (
				line.includes("Holding this launch") ||
				line.includes("The notice for the install of version") ||
				line.includes("Update service initialized") ||
				line.includes("Update marker:") ||
				line.includes("Pending install marker for version") ||
				line.includes("watchdog")
			) {
				log(`log: ${line.replace(/^\[[^\]]*\]\s*/, "")}`);
			}
		}
		const held = text.includes("Holding this launch");
		const opened = text.includes("Update service initialized");
		log(`verdict: held=${held} opened=${opened}`);
		if (existsSync(watchdogRecord)) {
			/*
			 * The captured plan carries its values in the ENVIRONMENT the app hands the
			 * watchdog, not in the script text, so the script is quoted as it was
			 * written rather than parsed for numbers it does not contain. What this
			 * proves is the substitution: a real watchdog would have been spawned here
			 * and would sit on the machine for up to 30 minutes.
			 */
			const plan = readFileSync(watchdogRecord, "utf8");
			log(
				`watchdog: captured by the rig's \`sh\` shim instead of run (${plan.length} bytes of plan); the real one waits up to 30 minutes on this machine`,
			);
		}

		/*
		 * The expectation the state carries, stated here rather than inferred from
		 * the numbers: a RUNNING job is a live install and the launch must stand
		 * down; anything else is an install that is over (or never was) and the
		 * app must open and report it. Review U1 and U2 are the second and third of
		 * these, and they are why the rig exists at all.
		 */
		const expected = options.job === "running" ? "hold" : "open";
		const matched = expected === "hold" ? held : opened;
		log(`expectation: ${expected} -> ${matched ? "PASS" : "FAIL"}`);
		if (stdout.trim())
			log(`app stdout: ${stdout.trim().split("\n").slice(-3).join(" | ")}`);
		if (stderr.trim())
			log(`app stderr: ${stderr.trim().split("\n").slice(-3).join(" | ")}`);
		return cleanup(matched ? 0 : 1);
	} finally {
		// Nothing is left running, and the scratch tree is gone unless asked for:
		// this machine is shared and a rig that leaks is worse than no rig.
		if (jobSubmitted) launchctl(["remove", jobLabel]);
	}
}

process.exitCode = await main();
