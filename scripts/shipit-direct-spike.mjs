#!/usr/bin/env node
/**
 * Does Squirrel's own installer, run WITHOUT launchd, still do a complete
 * install - and in the fast scheduling class?
 *
 * WHY THIS EXISTS. An in-app update on this machine holds the app closed for
 * ~4 min 30 s, and every one of those minutes is `ShipIt` sitting inside
 * `SecStaticCodeCheckValidityWithErrors` at ~4% CPU (100% of `sample`s in
 * `Security::Dispatch::Group::wait`). The same call on the same content costs a
 * third of a second from an ordinary process and minutes under the background
 * scheduling class (`scripts/sec-check.c` measures both), and Squirrel reaches
 * that class by submitting `ShipIt` to launchd itself (`SMJobSubmit`,
 * `Squirrel/SQRLUpdater.m:406`). So the proposed fix is to spawn Apple's
 * installer from the app instead of letting Squirrel submit it - and the whole
 * design rests on one unproven claim:
 *
 *   A `ShipIt` spawned as a DETACHED child of a process that then EXITS does a
 *   complete install, quickly, in the class the spawner had.
 *
 * The operator's own rehearsal (~/Library/Caches/.../ShipIt_stderr.log,
 * 2026-09-18 13:56) showed a direct spawn completing in 4.4 s with the swap
 * landing - but its caller was still alive for the whole run. The real caller
 * cannot be: the app has to QUIT, because the last thing `ShipIt` does before
 * it swaps is ask whether any instance of the target app is running, and one
 * running instance turns the whole wait into `App Still Running Error`
 * (`SQRLInstallerErrorDomain Code=-9`, this machine, 09:37). So the shape that
 * matters is the one this rig reproduces exactly:
 *
 *   prepare -> clone the installed app twice, write the state plist
 *   run     -> `spawn(..., { detached: true })`, print the pid, EXIT
 *   (the parent's whole lifetime is the `run` command's wall time: milliseconds)
 *   report  -> read the installer's own log and say what happened, and when
 *
 * WHAT IT MAY TOUCH. Nothing of the operator's. The clone source is read-only,
 * both bundles live under the scratch root it is given, the state plist is its
 * own file, and the bundle identifier in that plist is synthetic
 * (`com.local-operator.shipit-spike`) so `ShipIt`'s running-instance check and
 * its relaunch cannot reach the installed app, its launchd domain or its
 * sessions. There is NO launch path: `launchAfterInstallation` is written false,
 * and the plist is re-read and refused if it says otherwise - the launch is the
 * one thing that could put a window on the operator's screen. It refuses to
 * write anywhere else, refuses a scratch root it did not create (a mistyped
 * `--scratch` must not become an `rm -rf` of the operator's own directories),
 * and `cleanup` removes every tree it made, including the temp directories
 * `ShipIt` leaves behind.
 *
 * WHY IT IS NOT A TEST. It measures one machine at one load in one minute; the
 * numbers it prints are for a design note, and the verdict it prints is about
 * THAT run. The instrument a shipped change is judged by is
 * `scripts/update-window-report.mjs`, which reads the real installs' logs - and
 * this rig writes its installer log in the same shape (`ShipIt[pid:tid]` lines
 * from `NSLog`), so that instrument can be pointed at it:
 *
 *   node scripts/update-window-report.mjs --shipit-log <scratch>/ShipIt.log
 *
 * USAGE
 *
 *   node scripts/shipit-direct-spike.mjs prepare --scratch /tmp/lop-shipit-spike
 *   node scripts/shipit-direct-spike.mjs run     --scratch /tmp/lop-shipit-spike
 *   node scripts/shipit-direct-spike.mjs report  --scratch /tmp/lop-shipit-spike
 *   node scripts/shipit-direct-spike.mjs cleanup --scratch /tmp/lop-shipit-spike
 *
 *   --from <app>        clone source for the TARGET (default: the installed app)
 *   --update-from <app> clone source for the UPDATE bundle (default: --from)
 *   --spawner           spawn a wait-then-exec spawner instead of the installer
 *   --wait-pid <pid>    what that spawner waits for (default: this run's own pid)
 *   --background        spawn under `taskpolicy -b`, the class launchd's job ran in
 *   --timeout <sec>     how long `report` waits for the installer (default 900)
 */

import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir, loadavg } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isEntryPoint } from "./entry-point.mjs";

/**
 * The identifier the state plist carries.
 *
 * Synthetic, and that is the point: it is not `com.local-operator`, so
 * `ShipIt`'s own running-instance check and its relaunch phase name an app that
 * exists nowhere on this machine and cannot be the operator's.
 */
export const SPIKE_BUNDLE_ID = "com.local-operator.shipit-spike";

/**
 * Where `ShipIt` lives inside any app built by this repository.
 *
 * It is a plain executable inside the signed Squirrel framework, and it is
 * STARTED, never copied: the copy is the installed app's own, and replacing or
 * re-signing it is not something this rig does.
 */
export const SHIPIT_RELATIVE_PATH =
	"Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt";

const STATE_FILE = "state.plist";
const LOG_FILE = "ShipIt.log";
const EVIDENCE_FILE = "evidence.json";

/**
 * Columns of a `df` line, split the way this repository's other rigs split them.
 *
 * It was written and used without ever being defined, so `prepare` and `report`
 * died inside `freeSpace()` - the two modes that print the disk the run was
 * taken at. Defined here rather than inlined so the next reader sees the name
 * the rest of `scripts/` gives it (`new-chat-row.test.mjs` and its neighbours).
 */
const WHITESPACE = /\s+/;

function usage(problem) {
	if (problem) process.stderr.write(`shipit-direct-spike: ${problem}\n`);
	process.stderr.write(
		"usage: shipit-direct-spike.mjs <prepare|run|report|cleanup> --scratch <dir> [--from <app>] [--background] [--timeout <sec>]\n",
	);
	process.exitCode = problem ? 2 : 0;
}

function parseArgs(argv) {
	const options = {
		mode: argv[0] ?? "",
		scratch: null,
		from: "/Applications/Local Operator.app",
		// The bundle the UPDATE half is cloned from, when it is not the same as
		// the target's: the point of the option is a tree this app produced itself
		// (`ditto -x -k` of the staged zip) being handed to `ShipIt` unchanged.
		updateFrom: null,
		background: false,
		// The shape the design recommends: a tiny detached spawner that waits for
		// the app's pid to disappear and then `exec`s the installer in its own
		// process, so `ShipIt` never starts while an instance of the target app is
		// alive - and the pid the marker records is the installer's own.
		spawner: false,
		waitPid: null,
		timeoutSeconds: 900,
	};
	for (let index = 1; index < argv.length; index++) {
		const flag = argv[index];
		const value = () => argv[++index];
		if (flag === "--scratch") options.scratch = value();
		else if (flag === "--update-from") options.updateFrom = value();
		else if (flag === "--from") options.from = value();
		else if (flag === "--background") options.background = true;
		else if (flag === "--spawner") options.spawner = true;
		else if (flag === "--wait-pid") options.waitPid = Number(value());
		else if (flag === "--timeout") options.timeoutSeconds = Number(value());
		else {
			usage(`unknown argument ${flag}`);
			return null;
		}
	}
	if (!["prepare", "run", "report", "cleanup"].includes(options.mode)) {
		usage(options.mode ? `unknown mode ${options.mode}` : "no mode given");
		return null;
	}
	if (!options.scratch) {
		usage("--scratch is required");
		return null;
	}
	options.scratch = resolve(options.scratch);
	options.from = resolve(options.from);
	if (options.scratch === "/" || options.scratch === homedir()) {
		usage(`refusing to use ${options.scratch} as a scratch root`);
		return null;
	}
	return options;
}

const targetPath = (scratch, app) => join(scratch, "target", app);
const updatePath = (scratch, app) => join(scratch, "update", app);

/**
 * A deliberate refusal: a verdict this rig reached about its arguments, the plist in
 * front of it or the machine, as opposed to a bug in the rig itself.
 *
 * `main()` collapses these to the one sentence the reader needs, because someone who
 * mistyped `--scratch` does not want seven frames above it. Anything NOT marked this
 * way keeps its stack: a `TypeError` inside the rig must not read like a usage
 * refusal, which is the difference between a rig that refused and a rig that is broken
 * (review round 2, NIT 1).
 */
class Refusal extends Error {}

/**
 * The paths this rig is allowed to write, as one guard.
 *
 * A rig that swaps app bundles has exactly one way to be dangerous - pointing
 * `targetBundleURL` at something that is not a scratch copy - so every mode
 * states the rule rather than trusting its caller: the target is inside the
 * scratch root, and it is never the clone source.
 */
function assertInsideScratch(options, path) {
	if (!path.startsWith(`${options.scratch}/`)) {
		throw new Refusal(`${path} is outside the scratch root ${options.scratch}`);
	}
	if (path === options.from || path.startsWith(`${options.from}/`)) {
		throw new Refusal(`${path} is the clone source`);
	}
}

/** The path a `file://` URL in the plist names, or null when it is not one. */
function pathFromFileUrl(value) {
	if (typeof value !== "string") return null;
	try {
		return resolve(fileURLToPath(value));
	} catch {
		return null;
	}
}

/**
 * Refuse to hand `ShipIt` a plist that is not this rig's.
 *
 * `assertInsideScratch` checks the paths this file derives; this checks the file
 * the installer actually reads, and that file is what decides which bundle gets
 * swapped. It is written by `prepare` into the scratch root, but a stale or
 * hand-edited one left in that place would otherwise be enough to point
 * `targetBundleURL` at the operator's installed app - the one mistake this rig
 * cannot make and stay a rig. Both properties asserted here are load-bearing for
 * the design note as well: both bundles are copies under the scratch root and not
 * the clone source, and `ShipIt` is handed the synthetic label rather than a
 * label belonging to the operator's app.
 */
function assertPlistIsOurs(options, statePath) {
	// The plist's LOCATION as well as its contents: it is the file handed to
	// `ShipIt`, and `evidence.statePath` is read from wherever it points, so a
	// plist outside the scratch root would otherwise be accepted on the strength of
	// its label and URLs alone (review round 1, NIT 3).
	assertInsideScratch(options, resolve(statePath));
	let state;
	try {
		state = JSON.parse(readFileSync(statePath, "utf8"));
	} catch (error) {
		throw new Refusal(`${statePath} is not a readable state plist: ${error}`);
	}
	if (state.bundleIdentifier !== SPIKE_BUNDLE_ID) {
		throw new Refusal(
			`${statePath} names ${state.bundleIdentifier}, not the synthetic ${SPIKE_BUNDLE_ID}`,
		);
	}
	if (state.launchAfterInstallation === true) {
		throw new Refusal(
			`${statePath} asks ShipIt to launch an app; this rig never puts a window on the operator's screen`,
		);
	}
	for (const field of ["targetBundleURL", "updateBundleURL"]) {
		const path = pathFromFileUrl(state[field]);
		if (!path) throw new Refusal(`${statePath}: ${field} is not a file URL`);
		assertInsideScratch(options, path);
	}
}

/**
 * Refuse to use - and for `prepare` to wipe - a scratch root this rig did not make.
 *
 * `prepare` starts with `rm -rf <scratch>` and `cleanup` ends with the same call,
 * so a mistyped `--scratch` is the one way this file can destroy something that is
 * not its own: `--scratch ~/Library/Caches` passes the two refusals in `parseArgs`
 * and would then delete the operator's caches. A root this rig owns is a directory
 * that is empty or carries the `evidence.json` a previous `prepare` wrote; anything
 * else is refused rather than deleted, and the reader is told to pick another.
 */
function assertScratchIsOurs(scratch) {
	if (!existsSync(scratch)) return;
	if (!statSync(scratch).isDirectory()) {
		throw new Refusal(`${scratch} is not a directory`);
	}
	const entries = readdirSync(scratch);
	if (entries.length === 0 || entries.includes(EVIDENCE_FILE)) return;
	throw new Refusal(
		`${scratch} is not empty and carries no ${EVIDENCE_FILE}, so it is not this rig's to wipe - pick a fresh --scratch`,
	);
}

/** The evidence a previous `prepare` wrote, or a clean refusal to say `prepare` first. */
function readEvidence(options, { required } = {}) {
	const path = join(options.scratch, EVIDENCE_FILE);
	if (!existsSync(path)) {
		if (required) {
			process.stderr.write(
				`shipit-direct-spike: no ${EVIDENCE_FILE} in ${options.scratch} - run \`prepare --scratch ${options.scratch}\` first\n`,
			);
			process.exitCode = 2;
		}
		return null;
	}
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		// A corrupt or hand-edited evidence file is reported in the rig's own voice
		// rather than as a `SyntaxError` stack. `run` and `report` cannot proceed without
		// it and take the same exit code a missing file earns; `cleanup` removes the
		// trees it names itself - the scratch root, `ShipIt`'s cache and the preferences
		// file - so it warns and carries on instead of failing the cleanup over the one
		// line of its report the file provides (review round 3, MINOR b).
		process.stderr.write(
			`shipit-direct-spike: ${path} is not readable: ${error.message}\n`,
		);
		if (required) process.exitCode = 2;
		return null;
	}
}

/** `file://` spelling of a directory, as the plist Squirrel writes spells it. */
function fileUrl(path) {
	const url = pathToFileURL(path).href;
	return url.endsWith("/") ? url : `${url}/`;
}

/** The state plist, in the schema Squirrel's own `SQRLShipItState` uses. */
function statePlist(input) {
	return {
		bundleIdentifier: SPIKE_BUNDLE_ID,
		targetBundleURL: fileUrl(input.target),
		updateBundleURL: fileUrl(input.update),
		launchAfterInstallation: input.launchAfterInstallation === true,
		// The installed app's own plist carries this, and with it true `ShipIt`
		// keeps the update bundle's name in the target's directory rather than
		// renaming it. Both copies here share a name, so this changes nothing the
		// rig measures - it is here so the plist differs from Squirrel's only in
		// the identifier and the launch flag.
		useUpdateBundleName: true,
	};
}

function appSizeBytes(path) {
	const result = spawnSync("/usr/bin/du", ["-sk", path], { encoding: "utf8" });
	if (result.status !== 0) return null;
	return Number.parseInt(result.stdout.trim(), 10) * 1024;
}

function inodeOf(path) {
	try {
		return statSync(path).ino;
	} catch {
		return null;
	}
}

function loadLine() {
	const [a, b, c] = loadavg();
	return `load ${a.toFixed(2)} ${b.toFixed(2)} ${c.toFixed(2)}`;
}

function prepare(options) {
	const shipIt = join(options.from, SHIPIT_RELATIVE_PATH);
	if (!existsSync(shipIt)) {
		throw new Refusal(`no ShipIt at ${shipIt}`);
	}
	const app = basename(options.from);
	const target = targetPath(options.scratch, app);
	const update = updatePath(options.scratch, app);
	for (const path of [target, update]) assertInsideScratch(options, path);

	// A fresh scratch every time: a second prepare over a half-swapped tree would
	// measure the leftovers rather than the install. Only a root this rig owns may
	// be wiped - see `assertScratchIsOurs`.
	assertScratchIsOurs(options.scratch);
	rmSync(options.scratch, { recursive: true, force: true });
	mkdirSync(dirname(target), { recursive: true });
	mkdirSync(dirname(update), { recursive: true });

	/*
	 * APFS clones (`cp -Rc`), not copies. Two 376 MB bundles is 752 MB of real
	 * disk on a machine at 84% full; a clone shares the blocks until one of them
	 * is written, so the staging costs ~0 and the update bundle this rig hands
	 * `ShipIt` is byte-identical to the installed one - which is the content the
	 * measurement is about.
	 */
	const startedAt = Date.now();
	const clone = (from, to) => {
		const result = spawnSync("/bin/cp", ["-Rc", from, to], {
			encoding: "utf8",
		});
		if (result.status !== 0) {
			throw new Refusal(`cp -Rc ${from} ${to} failed: ${result.stderr}`);
		}
	};
	clone(options.from, target);
	clone(options.updateFrom ?? options.from, update);

	const state = statePlist({ target, update, launchAfterInstallation: false });
	const statePath = join(options.scratch, STATE_FILE);
	writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");

	const evidence = {
		preparedAt: new Date().toISOString(),
		load: loadLine(),
		cloneSource: options.from,
		updateCloneSource: options.updateFrom ?? options.from,
		shipIt,
		statePath,
		target,
		update,
		targetInodeBefore: inodeOf(target),
		appSizeBytes: appSizeBytes(options.from),
		copySeconds: (Date.now() - startedAt) / 1000,
		runs: [],
	};
	writeFileSync(
		join(options.scratch, EVIDENCE_FILE),
		`${JSON.stringify(evidence, null, 2)}\n`,
		"utf8",
	);

	process.stdout.write(
		[
			`prepared ${options.scratch}`,
			`  ${loadLine()}, disk free ${freeSpace()}`,
			`  target ${target}`,
			`  update ${update}`,
			`  ShipIt ${shipIt}`,
			`  state  ${statePath}`,
			`  clone of ${evidence.appSizeBytes} bytes in ${evidence.copySeconds.toFixed(1)} s (APFS clone)`,
			"",
		].join("\n"),
	);
}

function freeSpace() {
	const result = spawnSync("/bin/df", ["-h", "/System/Volumes/Data"], {
		encoding: "utf8",
	});
	const line = result.stdout.split("\n")[1] ?? "";
	const columns = line.split(WHITESPACE);
	return `${columns[3] ?? "?"} available`;
}

/**
 * Spawn `ShipIt` detached and leave.
 *
 * This is the whole experiment: the parent's lifetime is this command's, and it
 * is printed, so the claim "the installer completed after its spawner was gone"
 * is a pair of timestamps rather than a sentence. `detached: true` is what makes
 * the child its own session and re-parents it to launchd when this process
 * exits - and it is exactly what the app will do.
 */
function run(options) {
	const evidencePath = join(options.scratch, EVIDENCE_FILE);
	const evidence = readEvidence(options, { required: true });
	if (!evidence) return;
	const app = basename(evidence.target);
	const target = targetPath(options.scratch, app);
	const update = updatePath(options.scratch, app);
	assertInsideScratch(options, target);
	assertInsideScratch(options, update);
	// The plist, not only the paths above: it is the file `ShipIt` reads.
	assertPlistIsOurs(options, evidence.statePath);

	const logPath = join(options.scratch, LOG_FILE);
	// Appended, so a second `run` against the same scratch keeps the first run's
	// lines; each run's own entry in `evidence.runs` says which spawn it was.
	const log = existsSync(logPath) ? readFileSync(logPath, "utf8").length : 0;
	const out = openSync(logPath, "a");

	const argv = [SPIKE_BUNDLE_ID, evidence.statePath];
	/*
	 * The spawner's whole text, and the reason it is `exec` rather than a call:
	 * the process that waits BECOMES the installer, so the pid recorded here is
	 * the installer's own for the rest of its life, and the shell that waited is
	 * not an extra parent between the log and the process that is doing the work.
	 * `kill -0` on the app's pid is how the app's own watchdog already asks
	 * whether a process is gone (see `buildWatchdogPlan`), and the 0.2 s poll is
	 * the same order as its own 3 s interval.
	 */
	const spawnerScript = options.spawner
		? `while kill -0 ${options.waitPid ?? "PARENT"} 2>/dev/null; do sleep 0.2; done; exec "$0" "$@"`
		: null;
	/*
	 * `/usr/sbin/taskpolicy`, not `/usr/bin`: measured 2026-09-18, the util lives
	 * in `sbin` and `/usr/bin/taskpolicy` does not exist - which the first version
	 * of this rig found by dying on `ENOENT`.
	 */
	const shim = options.spawner
		? [
				"/bin/sh",
				"-c",
				spawnerScript.replace("PARENT", String(process.pid)),
				evidence.shipIt,
				...argv,
			]
		: null;
	const program = options.background
		? "/usr/sbin/taskpolicy"
		: (shim?.[0] ?? evidence.shipIt);
	// The installer's own path, never `program`: under `--background` the program
	// is `taskpolicy` and the thing it starts is this. Handing it `program` asks
	// it to run itself as `<bundle id>`, which is `posix_spawn: No such file or
	// directory` and no install at all - the mistake this rig made first.
	const args = options.background
		? ["-b", evidence.shipIt, ...argv]
		: (shim?.slice(1) ?? argv);

	const startedAt = new Date();
	const wallStart = Date.now();
	const child = spawn(program, args, {
		detached: true,
		stdio: ["ignore", out, out],
	});
	const spawnMilliseconds = Date.now() - wallStart;
	// A spawn that could not happen is reported rather than thrown: this rig is
	// run in the middle of a measurement, and a rig that dies on its own error
	// reports nothing about what it was measuring.
	let spawnError = null;
	child.on("error", (error) => {
		spawnError = String(error);
	});
	child.unref();

	if (spawnError) {
		process.stderr.write(`could not spawn ${program}: ${spawnError}\n`);
		process.exitCode = 1;
		return;
	}

	const record = {
		startedAt: startedAt.toISOString(),
		spawnedPid: child.pid,
		background: options.background,
		spawner: options.spawner,
		waitPid: options.waitPid ?? null,
		parentWallMs: spawnMilliseconds,
		logOffsetBytes: log,
		load: loadLine(),
	};
	evidence.runs.push(record);
	writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

	process.stdout.write(
		[
			`spawned ${child.pid}${options.background ? " (background class)" : ""}`,
			`  ${loadLine()}`,
			`  log ${logPath}`,
			`  this parent is exiting now, after ${spawnMilliseconds} ms: nothing the installer does from here has a parent to inherit from`,
			"",
		].join("\n"),
	);
}

const SHIPIT_LINE =
	/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3}) ShipIt\[(\d+):\d+\] (.*)$/;

/** Every line of a `ShipIt` log, parsed, in the shape its own `NSLog` writes. */
export function parseShipItLog(text) {
	const lines = [];
	for (const raw of text.split("\n")) {
		const match = SHIPIT_LINE.exec(raw);
		if (!match) continue;
		lines.push({
			at: `${match[1]} ${match[2]}`,
			pid: Number.parseInt(match[3], 10),
			message: match[4],
			raw,
		});
	}
	return lines;
}

const PHASES = [
	["request", /^Detected this as an install request$/],
	["beginning", /^Beginning installation$/],
	["move-started", /^Moving bundle from /],
	["swap-landed", /^Moved bundle contents from /],
	["completed", /^Installation completed successfully$/],
	["cancelled", /^(Installation cancelled|Aborting update attempt)/],
	["launching", /^On main thread and launching: /],
	["launched", /^Successfully launched application at /],
];

function millisOf(at) {
	// `YYYY-MM-DD HH:MM:SS.mmm` on one day's run; the date is carried so a run
	// that crosses midnight still orders, via `Date.parse` on a local stamp.
	return Date.parse(at.replace(" ", "T"));
}

function secondsBetween(a, b) {
	return ((b - a) / 1000).toFixed(1);
}

/**
 * What happened, from the installer's own log.
 *
 * The phase names are `update-window-report.mjs`'s, deliberately: the point of
 * this rig is a number that can be read beside the real installs' numbers, not
 * a number in a vocabulary of its own.
 */
export function summarise(lines, sinceIndex = 0) {
	const seen = new Map();
	for (const [index, line] of lines.entries()) {
		if (index < sinceIndex) continue;
		for (const [name, pattern] of PHASES) {
			if (pattern.test(line.message) && !seen.has(name)) seen.set(name, line);
		}
	}
	const at = (name) => seen.get(name) ?? null;
	const request = at("request");
	const beginning = at("beginning");
	const swap = at("swap-landed");
	const completed = at("completed");
	const cancelled = at("cancelled");
	const terminal = cancelled ?? completed;
	const rows = [];
	const row = (label, from, to) => {
		if (!from || !to) return;
		rows.push({
			label,
			from: from.at,
			to: to.at,
			seconds: Number(secondsBetween(millisOf(from.at), millisOf(to.at))),
		});
	};
	if (request && beginning)
		row("request -> Beginning installation", request, beginning);
	if (beginning && at("move-started"))
		row("Beginning installation -> bundle move", beginning, at("move-started"));
	if (at("move-started") && swap)
		row("bundle move -> swap landed", at("move-started"), swap);
	if (request && swap) row("request -> swap landed", request, swap);
	if (request && terminal) row("request -> terminal", request, terminal);
	return {
		seen,
		rows,
		verdict: cancelled ? "cancelled" : completed ? "installed" : "unfinished",
	};
}

function report(options) {
	const evidence = readEvidence(options, { required: true });
	if (!evidence) return;
	const logPath = join(options.scratch, LOG_FILE);
	const app = basename(evidence.target);
	const target = targetPath(options.scratch, app);
	assertInsideScratch(options, target);
	assertPlistIsOurs(options, evidence.statePath);

	const deadline = Date.now() + options.timeoutSeconds * 1000;
	let lines = [];
	let schedulingSample = null;
	let finished = false;

	// Polled rather than waited on: this process is not the installer's parent
	// (it has no parent), so there is nothing to wait FOR - the only evidence of
	// the install is the log, and the log is polled the way the watchdog polls.
	while (Date.now() < deadline) {
		lines = existsSync(logPath)
			? parseShipItLog(readFileSync(logPath, "utf8"))
			: [];
		const summary = summarise(lines);
		if (!schedulingSample) schedulingSample = sampleScheduling(evidence);
		if (summary.verdict !== "unfinished") {
			finished = true;
			break;
		}
		sleep(500);
	}

	const summary = summarise(lines);
	const lastRun = evidence.runs.at(-1) ?? null;
	const inodeAfter = inodeOf(target);
	const verdict = {
		scratch: options.scratch,
		finished,
		verdict: finished
			? summary.verdict
			: `unfinished after ${options.timeoutSeconds}s`,
		load: loadLine(),
		spawnedPid: lastRun?.spawnedPid ?? null,
		parentWallMs: lastRun?.parentWallMs ?? null,
		parentExitedAt: lastRun
			? new Date(
					Date.parse(lastRun.startedAt) + (lastRun.parentWallMs ?? 0),
				).toISOString()
			: null,
		installerFirstLineAt: lines[0]?.at ?? null,
		installerLastLineAt: lines.at(-1)?.at ?? null,
		rows: summary.rows,
		targetInodeBefore: evidence.targetInodeBefore,
		targetInodeAfter: inodeAfter,
		swapLanded:
			evidence.targetInodeBefore !== null &&
			inodeAfter !== null &&
			evidence.targetInodeBefore !== inodeAfter,
		schedulingSample,
	};

	const out = [];
	out.push(`install window (spike) - ${options.scratch}`);
	out.push(`  ${verdict.load}, disk free ${freeSpace()}`);
	out.push(
		`  spawned pid ${verdict.spawnedPid} - the spawning process exited ${verdict.parentExitedAt}, after ${verdict.parentWallMs} ms`,
	);
	out.push(`  installer first line ${verdict.installerFirstLineAt}`);
	if (schedulingSample) out.push(`  installer scheduling: ${schedulingSample}`);
	for (const row of verdict.rows) {
		out.push(
			`  ${row.label.padEnd(36)} ${row.from} -> ${row.to}   ${row.seconds} s`,
		);
	}
	out.push(`  VERDICT: ${verdict.verdict}`);
	out.push(
		`  swap landed: ${verdict.swapLanded ? "yes" : "no"} (target inode ${verdict.targetInodeBefore} -> ${verdict.targetInodeAfter})`,
	);
	out.push("");
	process.stdout.write(`${out.join("\n")}\n`);
	writeFileSync(
		join(options.scratch, "verdict.json"),
		`${JSON.stringify(verdict, null, 2)}\n`,
		"utf8",
	);
}

/**
 * The installer's own scheduling facts, while it runs.
 *
 * `scripts/update-window-report.mjs` prints these for a live install, and they
 * are the field that makes a slow one self-explanatory: `nice` and `pri` are
 * what the class shows up as, and the answer to "was this the class or a busy
 * machine" belongs beside the wall time rather than in a footnote.
 */
function sampleScheduling(evidence) {
	const pids = new Set();
	for (const run of evidence.runs) if (run.spawnedPid) pids.add(run.spawnedPid);
	for (const pid of pids) {
		const result = spawnSync(
			"/bin/ps",
			["-o", "pid=,nice=,pri=,pcpu=,etime=,command=", "-p", String(pid)],
			{ encoding: "utf8" },
		);
		const text = result.stdout.trim();
		if (text) return text.split("\n")[0].trim();
	}
	return null;
}

function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Remove everything this rig made, including what `ShipIt` left in the temp
 * directory and any cache directory its synthetic identifier claims.
 *
 * The last two are the ones a rig forgets: a swap moves the OLD bundle into a
 * `NSTemporaryDirectory()` of the installer's own making, which is ~376 MB
 * left on a machine at 84% full, and a bundle identifier of its own is a cache
 * directory of its own next to the operator's real one.
 */
function cleanup(options) {
	assertScratchIsOurs(options.scratch);
	const removed = [];
	// The evidence file names the app for the report line only - every tree removed here
	// is named by this rig's own constants plus the scratch root it was given - so an
	// unreadable one is warned about and then cleaned around, not thrown out of.
	const evidence = readEvidence(options, { required: false });
	const app = evidence?.target ? basename(evidence.target) : null;

	// What `ShipIt` itself leaves behind, named by the synthetic identifier so
	// nothing of the operator's can be in scope.
	const shipItTempRoot = process.env.TMPDIR ?? "/tmp";
	const targets = [
		options.scratch,
		join(homedir(), "Library", "Caches", `${SPIKE_BUNDLE_ID}.ShipIt`),
	];
	/*
	 * And the preferences file, which is the one this rig did not expect.
	 * `ShipIt` keys BOTH its persisted state and its install-attempt counter by
	 * the label it is handed in `argv[1]` (`SQRLShipItInstallationAttempts`, and
	 * the log's own `... for app: <label>`), so a run under a synthetic label
	 * writes `~/Library/Preferences/ByHost/<label>.<hardware uuid>.plist`. Found
	 * by looking for it after a run, not by assuming: the directory is swept for
	 * the label rather than the filename guessed, because the UUID suffix is the
	 * machine's.
	 */
	const byHost = join(homedir(), "Library", "Preferences", "ByHost");
	try {
		for (const entry of readdirSync(byHost)) {
			if (entry.startsWith(`${SPIKE_BUNDLE_ID}.`)) {
				targets.push(join(byHost, entry));
			}
		}
	} catch {
		// A machine without that directory is one this rig has nothing to clean on.
	}
	try {
		for (const entry of readdirSync(shipItTempRoot)) {
			if (entry.startsWith(SPIKE_BUNDLE_ID)) {
				targets.push(join(shipItTempRoot, entry));
			}
		}
	} catch {
		// A temp root that cannot be read is not an error here: the two names
		// above are the ones this rig owns.
	}

	for (const path of targets) {
		if (!existsSync(path)) continue;
		if (path !== options.scratch && !path.includes(SPIKE_BUNDLE_ID)) continue;
		rmSync(path, { recursive: true, force: true });
		removed.push(path);
	}
	process.stdout.write(
		[
			`cleaned ${removed.length} tree(s):`,
			...removed.map((path) => `  ${path}`),
			app ? `  (the ${app} clone source was never written to)` : "",
			"",
		]
			.filter(Boolean)
			.join("\n"),
	);
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options) return;
	try {
		if (options.mode === "prepare") prepare(options);
		else if (options.mode === "run") run(options);
		else if (options.mode === "report") report(options);
		else cleanup(options);
	} catch (error) {
		// Only a VERDICT gets the one-line treatment. Everything else is re-thrown so it
		// keeps its stack: an unconditional catch here would make a genuine bug inside
		// the rig print exactly like a refusal, which is how a broken rig looks healthy.
		// The exit code for a refusal stays 1, which is what it returned when the throw
		// was uncaught (review round 1, NIT 1; round 2, NIT 1).
		if (!(error instanceof Refusal)) throw error;
		process.stderr.write(`shipit-direct-spike: ${error.message}\n`);
		process.exitCode = 1;
	}
}

if (isEntryPoint(import.meta.url)) main();
