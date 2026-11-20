/*
 * ---------------------------------------------------------------------------
 * Focus: a mac-proof run must never take the operator's focus.
 * ---------------------------------------------------------------------------
 *
 * WHY THIS FILE EXISTS. Run 1907b (79's Mac, app v0.59.2, 2026-11-20) printed
 *   13:43:11.563 › [window-raise] trigger=initial-present mode=inactive requested=inactive applied=showInactive
 *   [window-mode] state: visible=true focused=true focusable=true size=1380x900 content=1380x900
 * `focused=` is `BrowserWindow.isFocused()` = `[window_ isKeyWindow]`, which an
 * inactive app cannot have, so the rig app WAS the active app: the operator's
 * keystrokes could have gone to it. Nothing on the app's own `showInactive` path
 * activates it (architect RCA, focus-rca.md section 0, Electron 45
 * native_window_mac.mm:448-463). The leading cause (RCA R1) is the launch
 * itself: the harness exec'd `Contents/MacOS/<binary>` directly, so the bundle
 * checked in with LaunchServices as an ordinary foreground app asking to come
 * forward, and macOS's cooperative activation granted it on some runs and not
 * others. Before this file, runs that open a conversation were blind to it: the
 * app's one `[window-mode] state` line is sampled before a held present shows
 * the window (src/main/index.ts:1318-1326 at v0.59.2), and it reads key state
 * only, never "the app is frontmost".
 *
 * WHAT THIS FILE DOES (operator rule: prevention ships, detection is the
 * backstop):
 *   1. PREVENTION (darwin): launch through LaunchServices with `open -g -n`
 *      (`buildOpenArgv`): `-g` is LS's no-front launch, `-n` a NEW instance.
 *      Without `-n`, `open -a` hands the request to the operator's running
 *      Local Operator, whose `activate` handler raises HIS window
 *      (index.ts:5623), so both are refused if absent (`openArgvProblem`).
 *      The env reaches the app by inheritance (open(1): "Opened applications
 *      inherit environment variables just as if you had launched the
 *      application directly"), never `--env` (the rig token would sit in `ps`).
 *      Inheritance is PROVEN from the app's own log lines (`envProof*`), not
 *      assumed.
 *   2. The app is now launchd's child, so: pid discovery by the rig's unique
 *      `--user-data-dir` (`discoverAppPid`), a reap by pid + start time, and a
 *      detached sentinel (`sentinelScript`) that reaps it if the harness dies
 *      (the app's own launcher watch turns off when its ppid is 1,
 *      window-mode.ts:849-861).
 *   3. INTER-RUN GATE (`interRunGateProblem`, RCA R2): no previous rig app may
 *      still be alive, or frontmost, when a run launches.
 *   4. WATCHDOG (`createFrontmostWatch`): `lsappinfo front` every 100 ms from
 *      just before launch until after the reap; the first sample whose front
 *      pid is the rig app or one of its helpers aborts the run.
 *
 * MATCHING IS BY PID ONLY (capture owner, measured on the Mac 2026-11-20): the
 * operator's own app was frontmost as "Local Operator", pid 18910, with no
 * --user-data-dir and NULL bundleID/paths in lsappinfo. The rig shares that
 * name, so a name or bundle-id match would abort on (or, in a reap, kill) the
 * operator's own app. The rig set is the discovered app pid plus any pid whose
 * argv carries the rig's exact `--user-data-dir=<rig>/profile` token.
 *
 * Everything here is pure or takes its commands as parameters, so the Linux
 * test suite drives it with fakes; nothing here runs `open` or `lsappinfo` on
 * Linux outside the test seam (`MAC_PROOF_TEST_LAUNCH`, mac-proof-capture.mjs).
 */

import { execFile, spawn, spawnSync } from "node:child_process";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

/** The absolute tools on macOS: never resolved through PATH, so a rig PATH cannot swap them. */
export const OPEN_BIN = "/usr/bin/open";
export const LSAPPINFO_BIN = "/usr/bin/lsappinfo";

/** The watchdog's sampling interval: the RCA's 100 ms (focus-rca.md section 3.i). */
export const FRONTMOST_INTERVAL_MS = 100;
/**
 * Consecutive unreadable samples before the run aborts as "watchdog blind"
 * (RCA section 3.i: "More than 5 consecutive UNKNOWN samples also aborts").
 * Half a second of blindness at 100 ms; a single slow tick never trips it.
 */
export const FRONTMOST_BLIND_LIMIT = 5;
/** One `lsappinfo` call's bound: RCA "a timeout over 1 s is an UNKNOWN sample". */
export const LSAPPINFO_TIMEOUT_MS = 1000;
/**
 * How long pid discovery polls `ps` for the launched app. Not a measured launch
 * latency (no LS-launched rig run has happened yet); the RCA's bound (section
 * 3.ii, "every 100 ms, for up to 10 s"), well above a cold Electron start's
 * check-in (1907b: harness launch to `[dev-driver] ARMED` well under 2 s).
 */
export const DISCOVERY_TIMEOUT_MS = 10_000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The ONE token that makes a process this run's: `--user-data-dir=<profile>`,
 * as a whole argument. `ps` joins argv with spaces, so the token ends at a space
 * or the end of the line; a longer path (`<profile>2`, `<profile>/x`) is
 * another profile and never matches.
 */
export function profileToken(profile) {
	return new RegExp(`(?:^|\\s)--user-data-dir=${escapeRe(profile)}(?=\\s|$)`);
}

/**
 * A rig-style profile of THIS harness anywhere (`<root>/mac-proof-XXXXXX/profile`,
 * makeRig's mkdtemp shape), or under one root when `rigRoot` is given. Used by
 * the inter-run gate. The negative-control tree (`mac-proof-negative-XXXXXX`)
 * never matches: six characters, then `/profile`.
 */
export function rigStyleProfilePattern(rigRoot = null) {
	const root = rigRoot === null ? ".*?" : escapeRe(rigRoot.replace(/\/+$/, ""));
	return new RegExp(
		`(?:^|\\s)--user-data-dir=${root}/mac-proof-[A-Za-z0-9]{6}/profile(?=\\s|$)`,
	);
}

/*
 * ---------------------------------------------------------------------------
 * 1. The LaunchServices launch.
 * ---------------------------------------------------------------------------
 */

/**
 * `open -g -n -a <app> --stdout <rig>/logs/app-stdout.log --stderr
 * <rig>/logs/app-stderr.log --args <app argv>`. Flags per open(1):
 * - `-g` "Do not bring the application to the foreground" (LS's no-front launch);
 * - `-n` "Open a new instance of the application(s) even if one is already
 *   running" - MANDATORY, see the file header;
 * - `--stdout`/`--stderr` take a PATH: a regular file, tailed by the harness
 *   (a FIFO would block LS's open until a reader exists);
 * - no `-W`: `open` returns once LS has launched the app, so there is no
 *   long-lived `open` process to reap, and no `--env` (the token stays off argv).
 */
export function buildOpenArgv({ appBundle, rig, appArgv }) {
	return [
		"-g",
		"-n",
		"-a",
		appBundle,
		"--stdout",
		join(rig, "logs", "app-stdout.log"),
		"--stderr",
		join(rig, "logs", "app-stderr.log"),
		"--args",
		...appArgv,
	];
}

/**
 * Refuse an `open` argv that could raise a window or leak the token. Run on the
 * built argv right before the spawn, so a later edit cannot drop a flag:
 * `-g` and `-n` among the options (before `--args`), an absolute `.app` after
 * `-a`, no `--env`/`-e`-style env injection, nothing token-shaped, and the
 * app's own argv carrying this rig's `--user-data-dir` (the identity pid
 * discovery and every reap select by).
 */
export function openArgvProblem(argv, { profile, token = null }) {
	if (!Array.isArray(argv)) return "the open argv is not a list";
	const at = argv.indexOf("--args");
	const options = at === -1 ? argv : argv.slice(0, at);
	const appArgs = at === -1 ? [] : argv.slice(at + 1);
	if (!options.includes("-g"))
		return "the open argv lacks -g: LaunchServices would bring the rig app to the foreground";
	if (!options.includes("-n"))
		return "the open argv lacks -n: open would hand the launch to the operator's running Local Operator and raise its window";
	const a = options.indexOf("-a");
	const bundle = a === -1 ? null : options[a + 1];
	if (
		typeof bundle !== "string" ||
		!bundle.startsWith("/") ||
		!bundle.endsWith(".app")
	)
		return `the open argv must name an absolute .app after -a (got ${bundle})`;
	if (
		options.some((o) => o === "--env" || o === "-e" || o.startsWith("--env="))
	)
		return "the open argv passes --env: the rig's env is inherited, never put on argv (ps shows it)";
	if (token && argv.some((x) => String(x).includes(token)))
		return "the open argv carries the rig token";
	if (!appArgs.includes(`--user-data-dir=${profile}`))
		return `the app argv after --args lacks this rig's --user-data-dir=${profile}`;
	return null;
}

/*
 * ---------------------------------------------------------------------------
 * 2. Env proof, from the app's OWN log lines.
 * ---------------------------------------------------------------------------
 */

/**
 * The line core's attach path logs once the app attached to the backend its
 * launch env named (src/main/backend/backend-service.ts:3078 at v0.59.2; 1907b's
 * log: `13:43:10.136 › Attached to the backend this launch named:
 * http://127.0.0.1:60317 (pid 1131, v0.108.5, uv-tool)`). The address is
 * matched anywhere in the line: the logger prefixes a timestamp.
 */
const ATTACHED_LINE =
	/Attached to the backend this launch named: (http:\/\/[^\s]+)/;
/** The app's present line (src/main/window-raise.ts): the window is being shown. */
export const PRESENT_LINE = /\[window-raise\] trigger=initial-present\b/;

/**
 * What the LaunchServices launch must prove came through the inherited env:
 * - `[dev-driver] ARMED` and `[dev-driver-script] ARMED`: the driver's env
 *   (`LOCAL_OPERATOR_UI_DEV_DRIVER_OUT`, `..._SCRIPT`) arrived;
 * - `Attached to the backend this launch named: <url>` with `<url>` EQUAL to
 *   the rig serve's URL: the attach URL arrived, and it is this rig's.
 * A fresh tracker per run; `feed` every app line; `missing()` lists what is not
 * proven yet, `wrongBackend` a backend line naming another address.
 */
export function createEnvProof({ backendUrl }) {
	const want = String(backendUrl).replace(/\/+$/, "");
	const state = {
		driverArmed: false,
		scriptArmed: false,
		backend: null,
		wrongBackend: null,
	};
	const feed = (line) => {
		if (line.startsWith("[dev-driver] ARMED")) state.driverArmed = true;
		else if (line.startsWith("[dev-driver-script] ARMED"))
			state.scriptArmed = true;
		else {
			const m = line.match(ATTACHED_LINE);
			if (m) {
				const got = m[1].replace(/\/+$/, "");
				if (got === want) state.backend = got;
				else state.wrongBackend ??= got;
			}
		}
	};
	const missing = () => [
		...(state.driverArmed ? [] : ["[dev-driver] ARMED"]),
		...(state.scriptArmed ? [] : ["[dev-driver-script] ARMED"]),
		...(state.backend
			? []
			: [`Attached to the backend this launch named: ${want}`]),
	];
	const record = () => ({
		verified: missing().length === 0,
		driverArmed: state.driverArmed,
		scriptArmed: state.scriptArmed,
		backend: state.backend,
		...(state.wrongBackend ? { wrongBackend: state.wrongBackend } : {}),
	});
	return { feed, missing, record, state };
}

/** The BLOCKED message: what is missing, and the next step (no --env fallback, by design). */
export function envNotInheritedMessage(missing, when, wrongBackend = null) {
	return `BLOCKED launch-env-not-inherited: the app launched through LaunchServices (open -g -n) did not prove its env ${when}: missing ${missing.join("; ")}${wrongBackend ? ` (it attached to ${wrongBackend} instead)` : ""}. The app was reaped before any capture. Next step: check that this macOS's open(1) passes the caller's environment to a new instance (man open, "inherit environment variables"); the harness never falls back to --env, which would put the rig token in ps`;
}

/*
 * ---------------------------------------------------------------------------
 * 3. Pid discovery and identity.
 * ---------------------------------------------------------------------------
 */

/** `ps -o pid=,ppid=,lstart=,command=` under the C locale (lstart = `Mon Nov 16 10:00:00 2026`). */
const PS_ROW =
	/^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.*)$/;

export function parsePsRows(text) {
	const rows = [];
	for (const line of String(text ?? "").split("\n")) {
		const m = line.match(PS_ROW);
		if (m)
			rows.push({
				pid: Number(m[1]),
				ppid: Number(m[2]),
				start: m[3].replace(/\s+/g, " "),
				command: m[4],
			});
	}
	return rows;
}

/** Every process's (pid, ppid, start, command), or null when `ps` could not run. */
export function psRows(run = defaultRun) {
	const r = run("ps", ["-A", "-ww", "-o", "pid=,ppid=,lstart=,command="]);
	return r.ok ? parsePsRows(r.stdout) : null;
}

/** One pid's C-locale start time (the identity the reap and the sentinel compare), or null. */
export function startOf(pid, run = defaultRun) {
	const r = run("ps", ["-o", "lstart=", "-p", String(pid)]);
	const start = r.ok ? r.stdout.trim().replace(/\s+/g, " ") : "";
	return start === "" ? null : start;
}

function defaultRun(cmd, args, timeout = 5000) {
	const r = spawnSync(cmd, args, {
		encoding: "utf8",
		timeout,
		env: { ...process.env, LC_ALL: "C", LANG: "C" },
	});
	return {
		ok: !r.error && r.status === 0,
		stdout: r.stdout ?? "",
		status: r.status,
	};
}

/**
 * The LS-launched app among `rows`: EXACTLY one process whose argv carries the
 * rig's `--user-data-dir` token, that is not an Electron helper (`--type=`,
 * Chromium's child-process switch) and whose parent is launchd (`launchdPid`, 1
 * on macOS; the test suite passes the reaper its Linux fakes are re-parented
 * to). Zero or several is a problem: the caller reaps every match and refuses.
 * A same-named process without the token (the operator's own Local Operator,
 * pid 18910 on the capture Mac) is never a candidate.
 */
export function discoverAppPid(rows, { profile, launchdPid = 1 }) {
	const token = profileToken(profile);
	const carrying = rows.filter((r) => token.test(r.command));
	const candidates = carrying.filter(
		(r) => !/(?:^|\s)--type=/.test(r.command) && r.ppid === launchdPid,
	);
	if (candidates.length === 1)
		return {
			pid: candidates[0].pid,
			start: candidates[0].start,
			candidates: 1,
			carrying,
		};
	return {
		pid: null,
		candidates: candidates.length,
		carrying,
		problem:
			candidates.length === 0
				? `no process carrying --user-data-dir=${profile} (and no --type=, ppid ${launchdPid}) appeared after the LaunchServices launch`
				: `${candidates.length} processes carry --user-data-dir=${profile} with no --type= and ppid ${launchdPid} (pids ${candidates.map((c) => c.pid).join(", ")}); refusing to guess which is the rig app`,
	};
}

/*
 * ---------------------------------------------------------------------------
 * 4. The inter-run gate (RCA R2).
 * ---------------------------------------------------------------------------
 */

/**
 * Before a launch: refuse when any process still carries a rig-style profile of
 * this harness (a previous run's app or helper, which LaunchServices could hand
 * activation to when it exits), or when the frontmost app is one. `front` is
 * the baseline sample (`{pid}` or null when unknown); `pattern` from
 * `rigStyleProfilePattern`.
 */
export function interRunGateProblem({ rows, front, pattern }) {
	if (rows === null)
		return "the inter-run gate could not list processes (ps failed); refusing to launch blind";
	const left = rows.filter((r) => pattern.test(r.command));
	if (left.length > 0)
		return `a previous mac-proof rig is still running (pids ${left.map((r) => r.pid).join(", ")}: ${left[0].command.slice(0, 200)}); wait for it to exit or reap it by exact pid before launching another, so no rig app is alive to be brought forward`;
	const frontRow =
		front?.pid != null ? rows.find((r) => r.pid === front.pid) : null;
	if (frontRow && pattern.test(frontRow.command))
		return `the frontmost app (pid ${front.pid}) is a mac-proof rig app; refusing to launch`;
	return null;
}

/*
 * ---------------------------------------------------------------------------
 * 5. The watchdog: lsappinfo front, by pid.
 * ---------------------------------------------------------------------------
 */

/**
 * `lsappinfo front` answers one ASN (`ASN:0x0-0x1a01a:`). Anything else
 * (`[ NULL ]`, an error text, empty) is an UNKNOWN sample.
 */
export function parseFrontAsn(stdout) {
	const line = String(stdout ?? "").trim();
	return /^ASN:0x[0-9a-f]+-0x[0-9a-f]+:$/i.test(line) ? line : null;
}

/**
 * `lsappinfo info [-only name] [-only pid] <ASN>`. Two shapes are read:
 * - `-only` keys, one per line: `"pid"=18910`, `"LSDisplayName"="Local Operator"`;
 * - the full block: `"Local Operator" ASN:0x0-0x1a01a:` then `pid = 18910 type=...`.
 * A `[ NULL ]` value (the capture Mac's bundleID and paths) is no value: it
 * neither parses as a pid nor matches anything. The name is for the receipt
 * only; nothing ever matches on it.
 */
export function parseAppInfo(stdout) {
	const text = String(stdout ?? "");
	const pid =
		text.match(/"(?:pid|LSPID)"\s*=\s*(\d+)/)?.[1] ??
		text.match(/(?:^|\s)pid\s*=\s*(\d+)/m)?.[1] ??
		null;
	const name =
		text.match(/"(?:LSDisplayName|name|LSName)"\s*=\s*"([^"]*)"/)?.[1] ??
		text.match(/^\s*"([^"]*)"\s+ASN:/m)?.[1] ??
		null;
	return { pid: pid === null ? null : Number(pid), name };
}

/** One async `lsappinfo` call, bounded; `{ok, stdout}`. */
export function lsappinfoRunner(bin = LSAPPINFO_BIN) {
	return (args) =>
		new Promise((resolve) => {
			execFile(
				bin,
				args,
				{
					timeout: LSAPPINFO_TIMEOUT_MS,
					encoding: "utf8",
					env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C" },
				},
				(error, stdout) => resolve({ ok: !error, stdout: stdout ?? "" }),
			);
		});
}

/**
 * One frontmost sample: `{asn, pid, name}` or `{unknown: reason}`. The pid comes
 * from `info` only when the ASN differs from the last one (`cache`), so a
 * steady tick is one spawn.
 */
export async function sampleFrontmost(lsappinfo, cache = new Map()) {
	const front = await lsappinfo(["front"]);
	const asn = front.ok ? parseFrontAsn(front.stdout) : null;
	if (!asn)
		return {
			unknown: `lsappinfo front answered ${JSON.stringify(String(front.stdout).trim().slice(0, 80))}`,
		};
	if (!cache.has(asn)) {
		const info = await lsappinfo([
			"info",
			"-only",
			"name",
			"-only",
			"pid",
			asn,
		]);
		const parsed = info.ok
			? parseAppInfo(info.stdout)
			: { pid: null, name: null };
		if (parsed.pid === null)
			return { unknown: `lsappinfo info gave no pid for ${asn}` };
		cache.clear();
		cache.set(asn, parsed);
	}
	return { asn, ...cache.get(asn) };
}

/** The receipt's `frontmost` before (or without) any sampling. */
export function emptyFrontmost(tool) {
	return {
		tool,
		intervalMs: tool === null ? null : FRONTMOST_INTERVAL_MS,
		baseline: null,
		samples: 0,
		unknown: 0,
		maxGapMs: 0,
		transitions: [],
		stolen: null,
	};
}

/**
 * The watch. `sample()` -> `{asn, pid, name}` | `{unknown}`; `isRig(pid)` ->
 * `{rig, helper}` (by PID: the app pid, or argv carrying the rig profile token).
 * `onSteal(stolen)` fires once, on the first rig sample; `onBlind(reason)` once,
 * after FRONTMOST_BLIND_LIMIT consecutive unknown samples. `record` is the
 * receipt's `frontmost`, filled in place.
 */
export function createFrontmostWatch({
	sample,
	isRig,
	onSteal = () => {},
	onBlind = () => {},
	now = Date.now,
	intervalMs = FRONTMOST_INTERVAL_MS,
	record = emptyFrontmost("lsappinfo"),
}) {
	let started = null;
	let launchedAt = null;
	let lastAt = null;
	let lastPid = null;
	let streak = 0;
	let blind = false;
	let running = false;
	let loop = null;
	const tick = async () => {
		const s = await sample();
		const at = now();
		if (lastAt !== null)
			record.maxGapMs = Math.max(record.maxGapMs, at - lastAt);
		lastAt = at;
		record.samples++;
		const atMs = at - started;
		if (s.unknown) {
			record.unknown++;
			streak++;
			if (streak > FRONTMOST_BLIND_LIMIT && !blind) {
				blind = true;
				onBlind(
					`the frontmost watchdog was blind for ${streak} consecutive samples (${s.unknown})`,
				);
			}
			return s;
		}
		streak = 0;
		if (record.baseline === null)
			record.baseline = { asn: s.asn, pid: s.pid, name: s.name, atMs };
		if (s.pid !== lastPid) {
			lastPid = s.pid;
			const who = await isRig(s.pid);
			record.transitions.push({
				atMs,
				sinceLaunchMs: launchedAt === null ? null : at - launchedAt,
				asn: s.asn,
				pid: s.pid,
				name: s.name,
				rig: who.rig,
			});
			if (who.rig && record.stolen === null) {
				record.stolen = {
					atMs,
					sinceLaunchMs: launchedAt === null ? null : at - launchedAt,
					pid: s.pid,
					asn: s.asn,
					helper: who.helper,
				};
				onSteal(record.stolen);
			}
		}
		return s;
	};
	return {
		record,
		/** One sample now (the preflight's baseline); answers the sample. */
		tick: async () => {
			started ??= now();
			return tick();
		},
		start() {
			started ??= now();
			running = true;
			loop = (async () => {
				while (running) {
					const t0 = now();
					await tick();
					const rest = intervalMs - (now() - t0);
					if (running && rest > 0)
						await new Promise((r) => setTimeout(r, rest));
				}
			})();
		},
		markLaunched() {
			launchedAt = now();
		},
		async stop() {
			running = false;
			await loop;
		},
	};
}

/**
 * `isRig` for the watch: the recorded app pid, else a pid whose argv carries
 * the rig profile token (a helper, or the app before discovery). Answers are
 * cached per pid; a ps failure answers not-rig for that pid (the poll goes on,
 * and `unknown` counts only unreadable FRONT samples).
 */
export function rigPidClassifier({ profile, appPid, argvOf }) {
	const token = profileToken(profile);
	const cache = new Map();
	return async (pid) => {
		const app = appPid();
		if (app !== null && pid === app) return { rig: true, helper: false };
		if (!cache.has(pid)) {
			const argv = await argvOf(pid);
			cache.set(pid, argv !== null && token.test(argv));
		}
		return cache.get(pid)
			? { rig: true, helper: app !== null }
			: { rig: false, helper: false };
	};
}

/** `ps -ww -o command= -p <pid>`, async; null when gone or unreadable. */
export function psArgvOf(pid) {
	return new Promise((resolve) => {
		execFile(
			"ps",
			["-ww", "-o", "command=", "-p", String(pid)],
			{
				timeout: LSAPPINFO_TIMEOUT_MS,
				encoding: "utf8",
				env: { ...process.env, LC_ALL: "C", LANG: "C" },
			},
			(error, stdout) => resolve(error ? null : String(stdout).trim() || null),
		);
	});
}

/*
 * ---------------------------------------------------------------------------
 * 6. The sentinel: the app's launcher watch, from the harness side.
 * ---------------------------------------------------------------------------
 */

/**
 * A plain `/bin/sh` loop (no installs): while the harness pid lives, exit as
 * soon as the app pid is gone (the normal reap); once the harness is gone, and
 * ONLY if the app pid still has the recorded start time (a recycled pid is a
 * stranger), TERM it, wait 3 s, KILL it. Argv: `$1` harness pid, `$2` app pid,
 * `$3` app start (C-locale `ps -o lstart=`). It never matches by name.
 */
export const SENTINEL_SCRIPT = [
	'h="$1"; a="$2"; s="$3"',
	'same() { [ "$(ps -o lstart= -p "$a" 2>/dev/null | tr -s " " | sed "s/^ //;s/ $//")" = "$s" ]; }',
	'while kill -0 "$h" 2>/dev/null; do kill -0 "$a" 2>/dev/null || exit 0; sleep 0.2; done',
	"same || exit 0",
	'kill -TERM "$a" 2>/dev/null',
	"i=0; while [ $i -lt 15 ]; do same || exit 0; sleep 0.2; i=$((i+1)); done",
	'same && kill -KILL "$a" 2>/dev/null',
	"exit 0",
].join("\n");

/**
 * Start the sentinel detached (its own session, no stdio), so a SIGKILL of the
 * harness (or its process group) does not take it along. `$0` names the rig, so
 * the rig sweep (`rigMatcher`, which matches the rig path in argv) is its
 * backstop. Answers the child; the caller records and reaps its pid.
 */
export function startSentinel({
	harnessPid,
	appPid,
	appStart,
	rig,
	sh = "/bin/sh",
}) {
	const child = spawn(
		sh,
		[
			"-c",
			SENTINEL_SCRIPT,
			`mac-proof-sentinel:${rig}`,
			String(harnessPid),
			String(appPid),
			appStart,
		],
		{
			detached: true,
			stdio: "ignore",
			cwd: "/",
			env: { PATH: "/bin:/usr/bin", LC_ALL: "C", LANG: "C" },
		},
	);
	child.unref();
	return child;
}

/*
 * ---------------------------------------------------------------------------
 * 7. Which launch a run uses, the log tail, and the reap of an LS-launched app.
 * ---------------------------------------------------------------------------
 */

/**
 * TEST-ONLY seam (the shape of `MAC_PROOF_TEST_OPERATOR_DOWNLOADS`): the
 * end-to-end cases run the harness as a child process, so only env reaches it.
 * - `direct`: the direct spawn on any platform, so a suite run ON A MAC never
 *   launches its fake bundles through the operator's LaunchServices;
 * - an absolute directory holding fake `open` and `lsappinfo`: the darwin
 *   launch path, on Linux, against those fakes; `MAC_PROOF_TEST_LAUNCHD_PID`
 *   names the pid the fakes' orphans are re-parented to (a Linux subreaper
 *   is often not pid 1), and the inter-run gate is scoped to the run's own rig
 *   root so concurrent cases do not see each other's rigs.
 * Honoured only under `node --test` (NODE_TEST_CONTEXT), else refused, so an
 * operator cannot switch the real Mac run off LaunchServices.
 */
export const TEST_LAUNCH_ENV = "MAC_PROOF_TEST_LAUNCH";
export const TEST_LAUNCHD_PID_ENV = "MAC_PROOF_TEST_LAUNCHD_PID";

export function launchMode(env = process.env, platform = process.platform) {
	const seam = env[TEST_LAUNCH_ENV];
	if (seam !== undefined && seam !== "") {
		if (!env.NODE_TEST_CONTEXT)
			return {
				problem: `${TEST_LAUNCH_ENV} is a test-only seam honoured only under node --test (NODE_TEST_CONTEXT); unset it - a Mac run always launches through LaunchServices`,
			};
		if (seam === "direct") return { kind: "direct", injected: true };
		if (!seam.startsWith("/"))
			return {
				problem: `${TEST_LAUNCH_ENV} must be "direct" or an absolute directory (got ${JSON.stringify(seam)})`,
			};
		const launchdPid = Number(env[TEST_LAUNCHD_PID_ENV] ?? 1);
		return {
			kind: "launchservices",
			open: join(seam, "open"),
			lsappinfo: join(seam, "lsappinfo"),
			launchdPid:
				Number.isInteger(launchdPid) && launchdPid > 0 ? launchdPid : 1,
			gateScopedToRigRoot: true,
			injected: true,
		};
	}
	if (platform === "darwin")
		return {
			kind: "launchservices",
			open: OPEN_BIN,
			lsappinfo: LSAPPINFO_BIN,
			launchdPid: 1,
			gateScopedToRigRoot: false,
			injected: false,
		};
	return { kind: "direct", injected: false };
}

/**
 * Read what a file gained since the last call (the app's `--stdout`/`--stderr`
 * file, written by the app itself under LaunchServices), split into whole
 * lines. Each file keeps its OWN partial-line buffer, so a stdout fragment is
 * never glued to a stderr one. A missing file reads as nothing yet.
 */
export function createFileTail(path) {
	let offset = 0;
	let partial = "";
	const read = ({ flush = false } = {}) => {
		const lines = [];
		let fd;
		try {
			fd = openSync(path, "r");
		} catch {
			return lines;
		}
		try {
			const size = fstatSync(fd).size;
			if (size < offset) offset = 0; // truncated: start over
			while (offset < size) {
				const buffer = Buffer.alloc(Math.min(1 << 16, size - offset));
				const n = readSync(fd, buffer, 0, buffer.length, offset);
				if (n <= 0) break;
				offset += n;
				partial += buffer.subarray(0, n).toString("utf8");
			}
		} finally {
			closeSync(fd);
		}
		let at = partial.indexOf("\n");
		while (at !== -1) {
			lines.push(partial.slice(0, at).replace(/\r$/, ""));
			partial = partial.slice(at + 1);
			at = partial.indexOf("\n");
		}
		if (flush && partial !== "") {
			lines.push(partial);
			partial = "";
		}
		return lines;
	};
	return { read };
}

const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
};

/** Still the process recorded at discovery: alive AND the same start time. */
export function sameProcess(pid, start, readStart = startOf) {
	if (!Number.isInteger(pid) || pid <= 1 || start === null) return false;
	return alive(pid) && readStart(pid) === start;
}

/**
 * Reap an LS-launched app. It is launchd's child, outside the harness's process
 * group, so it is signalled by PID, and only while its start time is the one
 * recorded at discovery (a recycled pid is a stranger): TERM, up to
 * `deadlineMs`, then KILL. Then every process carrying the rig's exact
 * `--user-data-dir` token (the helpers) is killed by pid. Nothing is ever
 * selected by name: the operator's own "Local Operator" carries no rig profile.
 * Same receipt shape as `stopAppTree`.
 */
export async function stopLaunchedApp({
	pid,
	start,
	profile,
	deadlineMs = 5000,
	readStart = startOf,
	rows = psRows,
}) {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const ours = () => sameProcess(pid, start, readStart);
	let signalled = false;
	let escalated = false;
	if (ours()) {
		try {
			process.kill(pid, "SIGTERM");
			signalled = true;
		} catch {}
		const deadline = Date.now() + deadlineMs;
		while (ours() && Date.now() < deadline) await wait(100);
		if (ours()) {
			escalated = true;
			try {
				process.kill(pid, "SIGKILL");
			} catch {}
			await wait(300);
		}
	}
	const token = profileToken(profile);
	const carrying = () => (rows() ?? []).filter((r) => token.test(r.command));
	const found = carrying();
	for (const r of found)
		try {
			process.kill(r.pid, "SIGKILL");
		} catch {}
	if (found.length > 0) await wait(300);
	const survivors = carrying();
	return {
		signalled,
		escalated,
		reaped: found.map((r) => r.pid),
		survivors: survivors.map((r) => r.pid),
		clean: survivors.length === 0 && !ours(),
	};
}

/**
 * The `process.on("exit")` backstop for an LS-launched app (the direct path's
 * `reapOnExit`, which signals a process GROUP the app is not in here). Sync, as
 * exit handlers must be: KILL the recorded pid only while its start matches,
 * then every pid carrying the rig profile token. The sentinel needs no kill
 * here: once this process is gone it finds the app gone too and exits.
 */
export function reapLaunchedOnExit({ pid, start, profile }) {
	process.on("exit", () => {
		try {
			if (sameProcess(pid, start)) process.kill(pid, "SIGKILL");
		} catch {}
		const token = profileToken(profile);
		for (const r of psRows() ?? [])
			if (token.test(r.command))
				try {
					process.kill(r.pid, "SIGKILL");
				} catch {}
	});
}
