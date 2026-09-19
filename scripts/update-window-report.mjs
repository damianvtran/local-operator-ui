#!/usr/bin/env node
/**
 * What an in-app update costs a user, measured from the two logs that record it.
 *
 * WHY THIS EXISTS. Every claim about the closed window - the minutes between the
 * app quitting for an install and the app coming back - has so far been argued
 * from anecdotes: one install took "a few minutes", a cancellation was "probably
 * the machine". Squirrel.Mac's own ShipIt writes every step of an install to
 * `~/Library/Caches/com.local-operator.ShipIt/ShipIt_stderr.log`, and this app
 * writes its side to `~/Library/Application Support/Local Operator/logs/
 * update-service.log`, so the whole window is on disk, per install, and can be
 * read instead of remembered. This is that reader. It is READ-ONLY: it opens two
 * logs and prints, and it touches no state of the operator's app.
 *
 * THE BASELINES IT WAS BUILT AGAINST (2026-09-18, this machine, ~150 load):
 *
 * - 11:59 install: `Detected this as an install request` 11:59:00.991 ->
 *   `Beginning installation` 11:59:03.330 -> `Moving bundle` 12:03:29.903 ->
 *   the app's own first line 12:03:40.686. A CLOSED WINDOW of ~4 min 30 s, of
 *   which 4 min 27 s is the phase between `Beginning installation` and the
 *   bundle move.
 * - A `sample` of the blocked ShipIt process during that phase put 100% of its
 *   samples in `SecStaticCodeCheckValidityWithErrors` ->
 *   `Security::CodeSigning::SecStaticCode::staticValidate` ->
 *   `Security::Dispatch::Group::wait` -> `__ulock_wait`, at 4.3% CPU over 4.5
 *   minutes (~11 s of CPU). It was BLOCKED, not computing.
 * - That exact call, with Squirrel's flags, takes 0.25-0.80 s on this machine on
 *   a freshly extracted copy of the same 376 MB bundle, warm and cold alike
 *   (`scripts/sec-check.c` measures it; `codesign --verify --strict --deep` is
 *   0.35-0.45 s). So the stall is NOT validation work and NOT a cold cache.
 * - It is the CONTEXT the install runs the call in, measured on 2026-09-18. The
 *   same call on the same content, from this machine, that day:
 *
 *       from an ordinary process (8 runs)            0.25 - 3.85 s
 *       submitted as a launchd job                   33.3 s
 *         (same bundle, one minute after a 3.45 s shell run)
 *       background class, `taskpolicy -b` (5 runs)   331 - 777 s
 *         (0.7-1.1 s of user CPU each)
 *       ShipIt, during the 11:59 install             4 min 27 s inside this call,
 *                                                    at 4.3% of a core
 *
 *   A warm-up changes nothing (two foreground validations at 0.34 s and 0.40 s
 *   still left a background run at 351 s), so this is not a cold cache. WHICH part
 *   of that context costs the time is NOT established and this report does not
 *   claim it: the installer's own job carries `nice = -1` with no background
 *   process type, and the live capture below prints a priority that reads as the
 *   ordinary class - while both a launchd submission and the background class
 *   reproduce the inflation. What the numbers say is where to look:
 *   `pnpm sec-check --via-launchd <path>` measures the submission, and
 *   `--background` measures the class.
 * - Not file count, either: a `ditto` of the full 1808-file bundle produced 19-21
 *   Gatekeeper scans and the same write with the Python seed removed (269 files)
 *   produced 32 and 17. A 6x smaller write bought no fewer scans, so the earlier
 *   "the trust path queues behind the install's own file flood" reading is refuted
 *   and does not belong in this report's explanations.
 * - Same-size installs the day before: 73 s -> 226 s, and on a calm machine
 *   1.7 s -> 15.6 s in that phase. The wall time tracks machine load, which is
 *   why every number this prints comes with the load average and the swap it was
 *   taken at, and why `ps` facts for a RUNNING install are printed with them.
 * - 09:37 install, CANCELLED after 4 minutes: `Aborting update attempt because
 *   there are 1 running instances of the target app` and `Installation
 *   cancelled: ... SQRLInstallerErrorDomain Code=-9 "App Still Running Error"`.
 *   The app's own log says why - it came back at 09:37:33 and again at 09:38:20
 *   while the install was live, and a running instance is what that check
 *   aborts on.
 *
 * WHAT WOULD ACTUALLY SHRINK IT, named so nobody has to rediscover it: nothing
 * about the bundle. The install has to stop running Apple's validation in the
 * context that inflates it - by spawning the installer ourselves rather than
 * submitting it to launchd, or by owning the swap - and the next change should
 * prove the move by measuring the window this report prints. Moving the 1818-file
 * Python seed out of the bundle and the 212-file locale strip (the second declined
 * by the operator) are separately worth doing and are NOT this: the file-count
 * measurement above says they will not shorten this window. The change this report
 * was written alongside is the launch-cancellation fix; this instrument is how the
 * window is read, and the live facts below are how a slow one is explained.
 *
 * USAGE
 *
 *   node scripts/update-window-report.mjs
 *   node scripts/update-window-report.mjs --limit 5
 *   node scripts/update-window-report.mjs --since 2026-09-17
 *   node scripts/update-window-report.mjs --json
 *   node scripts/update-window-report.mjs --shipit-log <path> --app-log <path>
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, loadavg } from "node:os";
import { join } from "node:path";

import { isEntryPoint } from "./entry-point.mjs";

/** Squirrel's own log for this bundle: every install step, one line each. */
export const DEFAULT_SHIPIT_LOG = join(
	homedir(),
	"Library",
	"Caches",
	"com.local-operator.ShipIt",
	"ShipIt_stderr.log",
);

/** This app's side of the same installs: the marker, the quit, the next start. */
export const DEFAULT_APP_LOG = join(
	homedir(),
	"Library",
	"Application Support",
	"Local Operator",
	"logs",
	"update-service.log",
);

/**
 * How far before an install's request the app's own log is searched for it.
 *
 * The app writes the pending-install marker and only then calls
 * `quitAndInstall`, and ShipIt's own process takes a couple of seconds to start
 * and log `Detected this as an install request` - measured 2.7-4.3 s apart on
 * this machine. So the marker line that NAMES the version belongs to the window
 * before the request, and 120 s is two orders of magnitude of room for a loaded
 * machine without reaching into the previous install.
 */
export const APP_LOG_LEAD_MS = 120_000;

const SHIPIT_LINE =
	/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3}) ShipIt\[\d+:\d+\] (.*)$/;
const APP_LINE =
	/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\] \[(\w+)\]\s+(.*)$/;

/**
 * The ShipIt lines that bound an install, in the order they can appear.
 *
 * Each is anchored: `Moving bundle from file:///Applications/... to file://`
 * appears TWICE per install - once out of `/Applications` and once back into it
 * from the staging tree - and only the first is the phase the user pays for, so
 * a substring match would report the wrong end of the longest phase.
 */
const SHIPIT_EVENTS = [
	{
		key: "request",
		test: (line) => line === "Detected this as an install request",
	},
	{ key: "beginning", test: (line) => line === "Beginning installation" },
	{
		key: "moveStart",
		test: (line) =>
			line.startsWith("Moving bundle from file:///Applications/") &&
			line.includes(" to file://"),
	},
	{
		key: "swapIn",
		test: (line) =>
			line.startsWith("Moved bundle contents from ") &&
			line.endsWith("Local%20Operator.app/"),
	},
	{
		key: "completed",
		test: (line) => line === "Installation completed successfully",
	},
	{
		key: "aborted",
		test: (line) =>
			line.startsWith("Aborting update attempt because there are ") &&
			line.endsWith(" running instances of the target app"),
		match:
			/^Aborting update attempt because there are (\d+) running instances of the target app$/,
	},
	{
		key: "cancelled",
		test: (line) => line.startsWith("Installation cancelled: "),
		match: /^Installation cancelled: (.*)$/,
	},
	{
		key: "launchRequest",
		test: (line) => line === "Detected this as a launch request",
	},
	{
		key: "launched",
		test: (line) =>
			line.startsWith(
				"Successfully launched application at file:///Applications/",
			),
	},
];

/** The app's own lines that say something about an install, and nothing else. */
const APP_EVENTS = [
	{
		kind: "marker",
		match:
			/^Pending install marker written for version (\S+) \(watchdog pid (.*)\)\.$/,
		fields: (match) => ({ version: match[1], watchdogPid: match[2] }),
	},
	{
		kind: "inFlightQuit",
		match:
			/^Quitting so the in-flight update install can finish(?: \((.*)\))?\.$/,
		fields: (match) => ({ context: match[1] ?? null }),
	},
	{
		kind: "appStarted",
		match: /^Update service initialized\. Dev mode: (true|false), NPX install:/,
		fields: (match) => ({ devMode: match[1] === "true" }),
	},
	{
		kind: "inFlightSeen",
		match: /^Update marker: the install of version (\S+) is still running/,
		fields: (match) => ({ version: match[1] }),
	},
	{
		kind: "failed",
		match: /^Update marker: install of version (\S+) did not complete/,
		fields: (match) => ({ version: match[1] }),
	},
];

/** A `YYYY-MM-DD HH:MM:SS.mmm` local stamp, as both logs write it. */
function parseStamp(day, time) {
	return new Date(`${day}T${time}`);
}

function shipItTimestamp(day, time) {
	const at = parseStamp(day, time);
	return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Read one log into timestamped lines, skipping anything that does not parse.
 *
 * A log with unparseable lines in it is normal rather than a failure: ShipIt
 * interleaves its own `ERROR: Unrecognized attribute string flag` noise from the
 * Objective-C runtime, and a truncated final line is what a grep of a live file
 * produces. Neither is an install step, so neither is reported as one.
 */
function readShipItLines(text) {
	const lines = [];
	for (const raw of text.split("\n")) {
		const match = SHIPIT_LINE.exec(raw);
		if (!match) continue;
		const at = shipItTimestamp(match[1], match[2]);
		if (!at) continue;
		lines.push({ at, message: match[3] });
	}
	return lines;
}

function readAppLines(text) {
	const lines = [];
	for (const raw of text.split("\n")) {
		const match = APP_LINE.exec(raw);
		if (!match) continue;
		const at = parseStamp(match[1].slice(0, 10), match[1].slice(11));
		if (Number.isNaN(at.getTime())) continue;
		lines.push({ at, level: match[2], message: match[3] });
	}
	return lines;
}

/**
 * Group ShipIt's lines into installs, one per `Detected this as an install
 * request`, and carry the app's own lines for the same window.
 *
 * The launch that follows an install comes from a SECOND ShipIt process (the
 * installer spawns one to launch the app), so it is not a group of its own: its
 * lines belong to the install that asked for them, which is why everything after
 * a request and before the next request is one record.
 */
export function buildInstalls({ shipitLines, appLines }) {
	const installs = [];
	for (const line of shipitLines) {
		const event = SHIPIT_EVENTS.find((candidate) =>
			candidate.test(line.message),
		);
		if (!event) continue;
		if (event.key === "request") {
			installs.push({ events: [], app: [] });
		}
		const install = installs[installs.length - 1];
		if (!install) continue;
		const match = event.match?.exec(line.message);
		install.events.push({
			key: event.key,
			at: line.at,
			detail: match ? match[1] : null,
		});
	}
	/*
	 * Each install's app-log window: the marker the app wrote just before its own
	 * request, up to where the NEXT install's own window starts. The windows tile
	 * the timeline, so no line is counted twice or dropped between two installs -
	 * and the boundary is the next install's lead, not its request, because the
	 * app's last act before calling `quitAndInstall` is the quit this path logs:
	 * ending a window at the next request would give that line to the install
	 * before it, which is the one install it cannot belong to.
	 */
	for (let index = 0; index < installs.length; index++) {
		const install = installs[index];
		const request = install.events[0].at;
		const next = installs[index + 1];
		const end = next
			? Math.max(
					request.getTime(),
					next.events[0].at.getTime() - APP_LOG_LEAD_MS,
				)
			: null;
		install.app = appLines.filter(
			(line) =>
				line.at.getTime() >= request.getTime() - APP_LOG_LEAD_MS &&
				(end === null || line.at.getTime() < end),
		);
	}
	return installs.map(summariseInstall);
}

function eventAt(events, key) {
	return events.find((event) => event.key === key)?.at ?? null;
}

function eventDetail(events, key) {
	return events.find((event) => event.key === key)?.detail ?? null;
}

/**
 * One install, as the numbers and the verdict a reader needs.
 *
 * `closedWindow` is the figure the whole report is about, and it is the app being
 * back rather than the install being over: the app's own first line when its log
 * has one (the relaunch watchdog starts it as soon as the swap has landed, which
 * is usually before ShipIt finishes its own bookkeeping), and ShipIt's own
 * `Successfully launched application` when it does not. Both are reported, so a
 * gap between them is visible rather than averaged away.
 */
export function summariseInstall(install, index) {
	const { events } = install;
	const request = eventAt(events, "request");
	const beginning = eventAt(events, "beginning");
	const moveStart = eventAt(events, "moveStart");
	const swapIn = eventAt(events, "swapIn");
	const completed = eventAt(events, "completed");
	const aborted = eventAt(events, "aborted");
	const cancelled = eventAt(events, "cancelled");
	const launched = eventAt(events, "launched");
	const appStarted = install.app.find((line) =>
		line.message.startsWith("Update service initialized. Dev mode: false"),
	)?.at;
	const terminal = cancelled ?? aborted ?? completed;
	/*
	 * The app's own line read as "it came back MID-INSTALL" only when the swap had
	 * not landed yet. The relaunch watchdog is what starts the app, and it starts as
	 * soon as the swap lands - so a start AFTER the swap is the install working as
	 * designed (and on 2026-09-18 11:59 it is what the app's own log records, 11 s
	 * after the bundle moved), while a start before it is the running instance
	 * ShipIt's final check aborts on.
	 */
	const startedDuringInstall =
		appStarted && (!swapIn || appStarted.getTime() < swapIn.getTime())
			? appStarted.toISOString()
			: null;
	const marker = install.app.find((line) =>
		line.message.startsWith("Pending install marker written for version "),
	);
	const markerMatch = marker ? APP_EVENTS[0].match.exec(marker.message) : null;
	const inFlightQuits = install.app.filter((line) =>
		line.message.startsWith(
			"Quitting so the in-flight update install can finish",
		),
	);
	return {
		index,
		requestAt: request?.toISOString() ?? null,
		status: completed
			? "completed"
			: cancelled || aborted
				? "cancelled"
				: "incomplete",
		targetVersion: markerMatch ? markerMatch[1] : null,
		reason:
			eventDetail(events, "cancelled") ??
			(eventDetail(events, "aborted")
				? `${eventDetail(events, "aborted")} running instance(s) of the target app`
				: null),
		terminalAt: terminal?.toISOString() ?? null,
		phases: {
			requestToBeginning: secondsBetween(request, beginning),
			beginningToMove: secondsBetween(beginning, moveStart),
			moveToSwapIn: secondsBetween(moveStart, swapIn),
			swapInToCompleted: secondsBetween(swapIn, completed),
			completedToLaunched: secondsBetween(completed, launched),
			/*
			 * For an install that never reached the swap this is the phase the user paid
			 * for, and it is the one a cancellation has to be read in: the 2026-09-18
			 * 09:37 install spent 3 min 50 s in it before Squirrel gave up.
			 */
			beginningToTerminal: secondsBetween(beginning, terminal),
		},
		closedWindow: {
			toTerminal: secondsBetween(request, terminal),
			toAppStart: secondsBetween(request, appStarted),
			toShipItLaunch: secondsBetween(request, launched),
			toSwapLanding: secondsBetween(request, swapIn),
		},
		appLog: {
			startedAt: appStarted?.toISOString() ?? null,
			startedDuringInstall,
			inFlightQuits: inFlightQuits.map((line) => line.at.toISOString()),
			lines: install.app.map((line) => ({
				at: line.at.toISOString(),
				level: line.level,
				message: line.message,
			})),
		},
		stamps: {
			request: request?.toISOString() ?? null,
			beginning: beginning?.toISOString() ?? null,
			moveStart: moveStart?.toISOString() ?? null,
			swapIn: swapIn?.toISOString() ?? null,
			completed: completed?.toISOString() ?? null,
			launched: launched?.toISOString() ?? null,
		},
	};
}

function secondsBetween(from, to) {
	if (!from || !to) return null;
	return (to.getTime() - from.getTime()) / 1000;
}

/**
 * The load and the swap this report is being read at.
 *
 * WHY THEY ARE IN THE OUTPUT: the same install takes 1.7 s on a calm machine and
 * 226 s on this one, so a duration with no machine state beside it cannot be
 * compared with the baselines in the header - a number that looks like a
 * regression may be a measurement taken on a machine that is already at load 400.
 */
export function machineState() {
	const [one, five, fifteen] = loadavg();
	return {
		loadAverage: { one, five, fifteen },
		swap: swapUsage(),
		shipit: shipItProcesses(),
	};
}

/**
 * The scheduling facts of an install that is running RIGHT NOW, if one is.
 *
 * WHY `ps` AND NOT THE LOGS: this is the field that makes the next slow install
 * self-explanatory. Squirrel submits its installer as a launchd job and the same
 * validation call costs seconds from an ordinary process and minutes in that
 * context (see the header). So a report read during an install should name the
 * process, its priority and its CPU, and the shape of the reading - minutes
 * elapsed against ~4% CPU - is what says "blocked on the system's code-signing
 * path" rather than "doing work". The priority is reported as it is, without
 * naming a scheduling class for it: measured on this machine, the installer's
 * priority reads as the ordinary class, so a class claim would not survive the
 * reading this line prints (review R1).
 *
 * Matched on `/Squirrel.framework/Resources/ShipIt`, which is the installer's own
 * path inside the app, rather than on the word `ShipIt`: measured on this machine,
 * a rig's capture script carrying `shipit` in its name is NOT an install and would
 * be reported as one by a loose match.
 */
export function parseShipItProcesses(psOutput) {
	const processes = [];
	for (const line of psOutput.split("\n")) {
		const match = /^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
		if (!match) continue;
		const [, pid, nice, priority, cpuPercent, command] = match;
		if (!command.includes("/Squirrel.framework/Resources/ShipIt")) continue;
		processes.push({
			pid: Number(pid),
			nice: Number(nice),
			priority: Number(priority),
			cpuPercent: Number(cpuPercent),
			command,
		});
	}
	return processes;
}

function shipItProcesses() {
	if (process.platform !== "darwin") return [];
	try {
		const result = spawnSync(
			"/bin/ps",
			["-eo", "pid=,ni=,pri=,pcpu=,command="],
			{ encoding: "utf8", timeout: 5000 },
		);
		if (result.error || result.status !== 0) return [];
		return parseShipItProcesses(result.stdout ?? "");
	} catch {
		return [];
	}
}

/** The two numbers `sysctl vm.swapusage` prints, in its own spelling. */
const SWAP_TOTAL = /total = ([\d.]+)([MG])/;
const SWAP_USED = /used = ([\d.]+)([MG])/;

function swapUsage() {
	if (process.platform !== "darwin") return null;
	try {
		const result = spawnSync("/usr/sbin/sysctl", ["-n", "vm.swapusage"], {
			encoding: "utf8",
			timeout: 5000,
		});
		if (result.error || result.status !== 0) return null;
		const text = (result.stdout ?? "").trim();
		const total = SWAP_TOTAL.exec(text);
		const used = SWAP_USED.exec(text);
		if (!total || !used) return text;
		const scale = (unit) => (unit === "G" ? 1 : 1 / 1024);
		return {
			totalGb: Number(total[1]) * scale(total[2]),
			usedGb: Number(used[1]) * scale(used[2]),
			raw: text,
		};
	} catch {
		return null;
	}
}

function formatDuration(seconds) {
	if (seconds === null) return "-";
	if (Math.abs(seconds) < 1) return `${Math.round(seconds * 1000)} ms`;
	if (seconds < 60) return `${seconds.toFixed(1)} s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds - minutes * 60;
	if (minutes < 60) return `${minutes} min ${rest.toFixed(1)} s`;
	const hours = Math.floor(minutes / 60);
	return `${hours} h ${minutes - hours * 60} min`;
}

function formatClock(iso) {
	if (!iso) return "-";
	const at = new Date(iso);
	const pad = (value, width = 2) => String(value).padStart(width, "0");
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
}

function renderText(report) {
	const out = [];
	const { machine } = report;
	const load = `load ${machine.loadAverage.one.toFixed(2)} ${machine.loadAverage.five.toFixed(2)} ${machine.loadAverage.fifteen.toFixed(2)}`;
	const swap = machine.swap
		? `swap ${machine.swap.usedGb.toFixed(1)} GB of ${machine.swap.totalGb.toFixed(1)} GB used`
		: "swap unknown";
	out.push(
		`Local Operator update windows - ${report.installs.length} install(s)`,
	);
	out.push(`  ShipIt log: ${report.logs.shipit}`);
	out.push(`  app log:    ${report.logs.app ?? "(not read)"}`);
	out.push(`  machine now: ${load}, ${swap}`);
	if (machine.shipit.length === 0) {
		out.push("  install now: none (no ShipIt process is running)");
	}
	for (const process_ of machine.shipit) {
		out.push(
			`  install now: pid ${process_.pid} nice ${process_.nice} priority ${process_.priority} cpu ${process_.cpuPercent}% - Squirrel's installer (the validation it is inside costs seconds from a shell and minutes in the context an install runs it in; measure that with sec-check)`,
		);
		out.push(`    ${process_.command}`);
	}
	out.push("");
	for (const install of report.installs) {
		const heading =
			install.status === "completed"
				? "installed"
				: install.status === "cancelled"
					? "CANCELLED"
					: "unfinished";
		out.push(
			`#${install.index}  ${formatClock(install.stamps.request)}  ${install.targetVersion ? `v${install.targetVersion}` : "version unknown"}  ${heading}`,
		);
		out.push(
			`  request -> Beginning installation      ${formatClock(install.stamps.beginning)}   ${formatDuration(install.phases.requestToBeginning)}`,
		);
		out.push(
			`  Beginning installation -> bundle move  ${formatClock(install.stamps.moveStart)}   ${formatDuration(install.phases.beginningToMove)}`,
		);
		out.push(
			`  bundle move -> swap landed             ${formatClock(install.stamps.swapIn)}   ${formatDuration(install.phases.moveToSwapIn)}`,
		);
		if (install.status === "completed") {
			out.push(
				`  swap landed -> Installation completed  ${formatClock(install.stamps.completed)}   ${formatDuration(install.phases.swapInToCompleted)}`,
			);
			out.push(
				`  Installation completed -> app launched ${formatClock(install.stamps.launched)}   ${formatDuration(install.phases.completedToLaunched)}`,
			);
		} else {
			out.push(
				`  Beginning installation -> ${install.status === "cancelled" ? "cancelled" : "last line"}   ${formatClock(install.terminalAt)}   ${formatDuration(install.phases.beginningToTerminal)}`,
			);
			if (install.reason) out.push(`    reason: ${install.reason}`);
		}
		out.push(
			`  CLOSED WINDOW  request -> swap landed  ${formatDuration(install.closedWindow.toSwapLanding)}`,
		);
		const appBack =
			install.closedWindow.toAppStart ?? install.closedWindow.toShipItLaunch;
		out.push(
			`                 request -> app back     ${formatDuration(appBack)}${install.closedWindow.toAppStart === null && install.closedWindow.toShipItLaunch !== null ? " (ShipIt's launch; the app's own log said nothing)" : ""}`,
		);
		if (install.status !== "completed") {
			out.push(
				`                 request -> terminal     ${formatDuration(install.closedWindow.toTerminal)}`,
			);
		}
		if (install.appLog.startedDuringInstall) {
			out.push(
				`  APP CAME BACK MID-INSTALL at ${formatClock(install.appLog.startedDuringInstall)} - a running instance is what ShipIt aborts on`,
			);
		}
		for (const at of install.appLog.inFlightQuits) {
			out.push(`    app quit for the in-flight install at ${formatClock(at)}`);
		}
		out.push("");
	}
	if (report.installs.length === 0) {
		out.push("no installs matched (see the window and limit flags)");
		out.push("");
	}
	return out.join("\n");
}

function parseDateArgument(value, label) {
	const at = new Date(value);
	if (Number.isNaN(at.getTime())) {
		throw new Error(
			`--${label} is not a date this can read: ${value} (try 2026-09-17 or "2026-09-18 09:00")`,
		);
	}
	return at;
}

export function parseArguments(argv) {
	const options = {
		json: false,
		limit: null,
		since: null,
		until: null,
		shipitLog: DEFAULT_SHIPIT_LOG,
		appLog: DEFAULT_APP_LOG,
		help: false,
	};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		switch (arg) {
			case "--json":
				options.json = true;
				break;
			case "--limit":
				options.limit = Number(argv[++index]);
				break;
			case "--since":
				options.since = parseDateArgument(argv[++index], "since");
				break;
			case "--until":
				options.until = parseDateArgument(argv[++index], "until");
				break;
			case "--shipit-log":
				options.shipitLog = argv[++index];
				break;
			case "--app-log":
				options.appLog = argv[++index];
				break;
			case "--no-app-log":
				options.appLog = null;
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	if (options.limit !== null && !(options.limit > 0)) {
		throw new Error(`--limit needs a positive number, got ${options.limit}`);
	}
	return options;
}

const USAGE = `usage: node scripts/update-window-report.mjs [options]

  --limit N            report the last N installs
  --since <date>       only installs requested at or after this local time
  --until <date>       only installs requested before this local time
  --json               machine-readable output, machine state included
  --shipit-log <path>  ShipIt's stderr log (default: this machine's)
  --app-log <path>     the app's update-service log; --no-app-log to skip it
  -h, --help           this text
`;

/**
 * Read both logs and report every install in the window.
 *
 * A missing log is reported rather than thrown: a machine that has never updated
 * has no ShipIt log, and "no installs" is the honest answer there.
 */
export function buildReport(options) {
	const shipitText = existsSync(options.shipitLog)
		? readFileSync(options.shipitLog, "utf8")
		: null;
	const appText =
		options.appLog && existsSync(options.appLog)
			? readFileSync(options.appLog, "utf8")
			: null;
	const appLines = appText === null ? [] : readAppLines(appText);
	const installs =
		shipitText === null
			? []
			: buildInstalls({
					shipitLines: readShipItLines(shipitText),
					appLines,
				});
	const inWindow = installs.filter((install) => {
		if (install.requestAt === null) return false;
		const at = new Date(install.requestAt).getTime();
		if (options.since && at < options.since.getTime()) return false;
		if (options.until && at >= options.until.getTime()) return false;
		return true;
	});
	const limited =
		options.limit === null ? inWindow : inWindow.slice(-options.limit);
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return {
		generatedAt: new Date().toISOString(),
		/*
		 * Which clock every stamp in this file is on (review Q4). The JSON carries
		 * UTC ISO-8601 and the text renderer prints the same instants in the
		 * machine's local zone; a reader comparing the two - or quoting one beside
		 * the other - needs to know that, and a tool whose whole purpose is quoting
		 * durations should not leave it to be inferred.
		 */
		times: {
			json: "UTC ISO-8601 (trailing Z)",
			text: `the machine's local wall clock (${timeZone})`,
			timeZone,
		},
		logs: {
			shipit: options.shipitLog,
			shipitRead: shipitText !== null,
			app: options.appLog,
			appRead: appText !== null,
		},
		machine: machineState(),
		installs: limited,
		totalInstallsInLog: installs.length,
	};
}

function main(argv) {
	const options = parseArguments(argv);
	if (options.help) {
		process.stdout.write(USAGE);
		return;
	}
	const report = buildReport(options);
	if (options.json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	process.stdout.write(`${renderText(report)}\n`);
}

if (isEntryPoint(import.meta.url)) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
		process.exitCode = 1;
	}
}
