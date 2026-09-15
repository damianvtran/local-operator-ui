/*
 * The app -> backend hop, re-runnable, with a teardown that owns the whole tree.
 *
 * WHY THIS EXISTS. `docs/evidence/desktop-notifications-off/transcript-launch-hop.txt`
 * records a measurement that was taken by HAND: the app booted headless with
 * `harness/hop-probe.cjs` loaded into its main process, the probe's log read, and
 * the app stopped. Reading the source can only show that `backend/config.ts` folds
 * a `.env` over the launch; what the backend child actually ends up with is what
 * this instrument answers, and until this file existed that answer could only be
 * reproduced by re-typing a command from a transcript.
 *
 * WHY THE TEARDOWN IS THE POINT, AND THE MEASUREMENT IS THE REASON. The hand
 * command was `./node_modules/.bin/electron . --user-data-dir=/tmp/hop/user-data-$TAG …`
 * followed by a kill of THAT pid. `node_modules/.bin/electron` is a NODE SHIM
 * (`electron/cli.js`) whose child is the app, so the pid the shell held belonged to
 * the shim: the kill landed on the shim and the app it had started was re-parented
 * to launchd. Measured on the night this file was written: two runs left two
 * headless Electron trees alive - `/tmp/hop/user-data-before` and `-after`, eight
 * processes each, every root reporting `ppid 1` - while the transcript could
 * honestly say the app "is killed by exact pid afterwards". The next launch in the
 * same tree also inherits the app's SINGLE-INSTANCE LOCK, which is global rather
 * than per `--user-data-dir`, so a leaked tree turns the following run into
 * "Another instance is already running" - a failure the rig reports as its own
 * measurement. It is the third instance of this class in this repo:
 * `scripts/browser-chrome-proof.mjs::launchApp` and `scripts/renderer-driver.mjs`
 * both carry the same lesson in their own comments.
 *
 * So two things here are load-bearing and neither is cosmetic:
 *
 *   1. THE APP ITSELF IS SPAWNED, NOT THE SHIM. `require("electron")` from this
 *      repo's `package.json` returns the runtime BINARY, so `child.pid` is the
 *      app's own main process - and the backend the app spawns is
 *      `detached: false` (`backend-service.ts::startOwned`), i.e. inside the same
 *      group, which is what makes one signal reach it too.
 *   2. `detached: true` PUTS THE APP IN ITS OWN PROCESS GROUP, and the stop signals
 *      that GROUP (`process.kill(-child.pid, …)`) rather than the pid, escalating
 *      to SIGKILL. Electron's helpers (GPU, network, renderer, utility) are its own
 *      children, so a signal to the main process alone is not a stop.
 *
 * THE REAP-BY-PROFILE BACKSTOP, and why it is not a pattern kill. An app that
 * escaped the group no longer answers to any pid this run holds; the only way to
 * SEE it is its command line, which names this run's own `--user-data-dir`. So the
 * profile path is matched for DETECTION (`thisRunsProfile` below), and every
 * process it names is then killed by EXACT PID - never `pkill`, and never a bare
 * pattern. The path contains this run's pid, so a match cannot belong to the
 * operator's own app or to another session, and that is the property that makes
 * the question safe to ask at all. Any survivor whose parent is 1 is reported as
 * what it is: a reparented root, which is the exact signature of the leak above.
 *
 * Usage: node scripts/notification-hop-proof.mjs [--tag <name>] [--seconds <n>] [--keep]
 *
 *   Run it from the tree under measurement: the app, its `.env` and its built
 *   `out/` are all resolved from the working directory, which is also the
 *   convention every other rig here follows. Everything else is scratch: HOME, the
 *   config dir, the log dir and `--user-data-dir` are a `mktemp`-style tree removed
 *   on exit unless `--keep` is given, so the operator's own profile and app are not
 *   reachable from this run.
 */
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withNotificationsOff } from "./notifications-off.mjs";

const ROOT = process.cwd();
const REPO_FROM_SCRIPT = dirname(dirname(fileURLToPath(import.meta.url)));
/*
 * The probe ships with the evidence bundle that documents this measurement, so it
 * is resolved from THIS FILE's repo rather than from the working directory: a rig
 * pointed at another worktree (the normal case - a before/after pair comes from two
 * trees) still instruments the app with the committed probe.
 */
const PROBE = join(
	REPO_FROM_SCRIPT,
	"docs",
	"evidence",
	"desktop-notifications-off",
	"harness",
	"hop-probe.cjs",
);

const args = process.argv.slice(2);
const value = (flag, fallback) => {
	const at = args.indexOf(flag);
	return at === -1 ? fallback : args[at + 1];
};
const TAG = value("--tag", `hop-${process.pid}`);
const SETTLE_SECONDS = Number(value("--seconds", "20"));
const KEEP = args.includes("--keep");

const SCRATCH = join(tmpdir(), `lo-notification-hop-${TAG}-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const LOG_DIR = join(SCRATCH, "logs");
const USER_DATA = join(SCRATCH, "user-data");
const HOP_LOG = join(SCRATCH, `hop-${TAG}.log`);
const APP_LOG = join(SCRATCH, `app-${TAG}.log`);

const say = (line) => console.log(line);

/**
 * The Electron runtime BINARY, from the package that owns it.
 *
 * Resolved through the TREE UNDER MEASUREMENT's `package.json`, because that is the
 * runtime the app in that tree ships against; `require("electron")` is the
 * package's own documented answer and returns the executable path. The
 * `node_modules/.bin/electron` shim is deliberately not used - see the header.
 */
const ELECTRON_BIN = (() => {
	const resolveFromRoot = createRequire(join(ROOT, "package.json"));
	try {
		return resolveFromRoot("electron");
	} catch (error) {
		say(
			`cannot resolve the Electron runtime from ${ROOT} (${error?.message ?? error}); run this from the tree under measurement, after its install`,
		);
		process.exit(1);
	}
})();

if (!existsSync(join(ROOT, "out", "main", "index.js"))) {
	say(`${ROOT}/out is not built; this rig boots the built app (pnpm build)`);
	process.exit(1);
}
if (!existsSync(PROBE)) {
	say(`the hop probe is missing at ${PROBE}`);
	process.exit(1);
}

for (const dir of [HOME_DIR, CONFIG_DIR, LOG_DIR, USER_DATA])
	mkdirSync(dir, { recursive: true });
writeFileSync(HOP_LOG, "");

/*
 * The child environment: the launch the hop is measured FROM.
 *
 * The switch goes on for the reason every app-booting path in this repo sets it -
 * this rig launches the app, the app launches a backend, and a backend announcing a
 * parked gate ends at `osascript` in the operator's real Notification Center. The
 * measurement is about the environment the backend child is handed, not about
 * banners, so a run of this rig must not be the thing that posts one.
 *
 * `cmux`/`lop` variables are REMOVED rather than overwritten, the rule every rig
 * here carries: an inherited workspace id lets a headless run rename or drive the
 * windows somebody is using right now.
 */
const env = { ...process.env };
for (const key of Object.keys(env)) {
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
}
withNotificationsOff(env);
Object.assign(env, {
	HOME: HOME_DIR,
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
	LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
	LO_HOP_LOG: HOP_LOG,
	// `headless` because this run must not appear on the operator's screen, and
	// because it is a full-fidelity rendering path rather than a degraded one.
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	// Appended rather than assigned: a caller's own `--require` (a coverage hook,
	// say) must survive this rig, and the probe is additive - it records and calls
	// through.
	NODE_OPTIONS: [env.NODE_OPTIONS, `--require=${PROBE}`]
		.filter(Boolean)
		.join(" "),
});

say(`app root:    ${ROOT}`);
say(`runtime:     ${ELECTRON_BIN}`);
say(`scratch:     ${SCRATCH}${KEEP ? " (kept)" : ""}`);
say(`probe log:   ${HOP_LOG}`);

const child = spawn(
	ELECTRON_BIN,
	[".", `--user-data-dir=${USER_DATA}`, "--window-mode=headless"],
	{
		env,
		cwd: ROOT,
		stdio: ["ignore", "pipe", "pipe"],
		// Own the whole tree; see the header. Electron spawns helpers of its own, and
		// the backend this app starts is `detached: false`, so one group signal is
		// what reaches all of them.
		detached: true,
	},
);
const stream = [];
child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
const flush = () => writeFileSync(APP_LOG, stream.join(""));
const timer = setInterval(flush, 500);
child.on("exit", (code) => {
	clearInterval(timer);
	flush();
	child.exited = true;
	child.exitCode = code;
});

/**
 * Every process whose command line names THIS run's profile, with its parent.
 *
 * DETECTION ONLY, in the sense the header states: the callers below kill the pids
 * this returns, one at a time. The path carries this run's pid, so a match cannot
 * be another session's app - which is the only reason a pattern may be used to ask
 * the question at all. The boundary is explicit rather than incidental:
 * `--user-data-dir=/tmp/x/user-data` is a PREFIX of `--user-data-dir=/tmp/x/user-data-2`,
 * and Electron's own helper processes repeat the flag, so the match is anchored on
 * the flag and closed by whitespace or end-of-line.
 */
function thisRunsProfile() {
	const ps = spawnSync("ps", ["-eo", "pid,ppid,command"], { encoding: "utf8" });
	if (ps.error || ps.status !== 0) return null;
	const pattern = new RegExp(
		`(?:^|\\s)--user-data-dir=${USER_DATA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`,
	);
	return ps.stdout
		.split("\n")
		.slice(1)
		.map((line) => line.trim().match(PS_ROW))
		.filter((match) => match && pattern.test(match[3]))
		.map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]) }));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One `ps` row, split into pid, parent and command line. */
const PS_ROW = /^(\d+)\s+(\d+)\s+(.*)$/;

const alreadyGone = (pid) => {
	try {
		process.kill(pid, 0);
		return false;
	} catch {
		return true;
	}
};

/**
 * The stop: the process GROUP first, then the profile backstop.
 *
 * The group is the primary and the only one the normal case needs. The backstop
 * exists for the failure this rig was written after - an app re-parented out of the
 * group answers to no pid this run holds - and it is reported rather than silent,
 * because "the group kill worked" and "the backstop found two orphans" are
 * different facts about the run.
 */
async function stop() {
	say("\n=== teardown ===");
	const killGroup = (signal) => {
		try {
			process.kill(-child.pid, signal);
			return true;
		} catch {
			return false;
		}
	};
	killGroup("SIGTERM");
	const deadline = Date.now() + 5000;
	while (!child.exited && Date.now() < deadline) await wait(100);
	if (!child.exited) {
		killGroup("SIGKILL");
		await wait(500);
	}
	say(
		`group SIGTERM${child.exited ? "" : " then SIGKILL"}: app ${child.exited ? "exited" : "did not exit"}`,
	);

	await wait(500);
	const found = thisRunsProfile();
	if (found === null) {
		say(
			"by profile:  ps failed, so the backstop could not run; the group signal is all this run has",
		);
		return 1;
	}
	if (found.length === 0) {
		say("by profile:  0 processes still name this run's profile");
		say(
			`by pid:      ${alreadyGone(child.pid) ? "no process at the app's own pid" : "STILL ALIVE"}`,
		);
		return alreadyGone(child.pid) ? 0 : 1;
	}
	say(
		`by profile:  ${found.length} process(es) outlived the group signal, reaping by exact pid:`,
	);
	const reparented = found.filter((entry) => entry.ppid === 1);
	for (const entry of found) {
		try {
			process.kill(entry.pid, "SIGKILL");
			say(`  killed ${entry.pid} (ppid ${entry.ppid})`);
		} catch {
			say(`  ${entry.pid} had already gone`);
		}
	}
	if (reparented.length > 0)
		say(
			`  ${reparented.length} of them reported ppid 1, i.e. a root the run had already lost - the signature this rig exists to stop`,
		);
	await wait(500);
	const survivors = thisRunsProfile() ?? [];
	say(`by profile, after the reap: ${survivors.length} process(es) remain`);
	return survivors.length === 0 ? 0 : 1;
}

let reaping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, async () => {
		if (reaping) return;
		reaping = true;
		// A run stopped by hand gets the same teardown as one that finishes, because
		// the interruption is exactly when a tree is left behind.
		const code = await stop();
		cleanup();
		process.exit(code === 0 ? 0 : 1);
	});
}

function cleanup() {
	if (!KEEP) rmSync(SCRATCH, { recursive: true, force: true });
	else say(`kept: ${SCRATCH}`);
}

say(`\n=== the app, headless, for ${SETTLE_SECONDS}s (pid ${child.pid}) ===`);
await wait(SETTLE_SECONDS * 1000);
say(`--- ${HOP_LOG} ---`);
say(
	readFileSync(HOP_LOG, "utf8").trimEnd() ||
		"(nothing recorded: the probe never loaded)",
);
say(`--- app log: ${APP_LOG} ---`);
flush();

const code = await stop();
cleanup();
process.exit(code);
