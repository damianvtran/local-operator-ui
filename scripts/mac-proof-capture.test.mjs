import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import {
	APP_ZIP_UNPACKED_CAP_BYTES,
	CAPTUREPAGE_METHOD,
	CODESIGN_CAP_MS,
	CREDENTIAL_SEGMENTS,
	DAEMON_ROUTES,
	DOWNLOAD_FILE_DEFAULT,
	DOWNLOAD_ITEM_SELECTOR,
	DOWNLOAD_OUTCOME_WAIT_MS,
	EXIT,
	FILES_READY,
	FORBIDDEN_DAEMON_PATH,
	MEASUREMENT_LIMITS,
	PREVIEW_FILE_DEFAULT,
	RUNNER_MAX_STEPS,
	Refusal,
	SCENES,
	SCENE_READY,
	SCREENCAPTURE_METHOD,
	SCREEN_RECORDING_PREFLIGHT_JXA,
	STARTUP_WINDOW_MS,
	UNKNOWN_START,
	WINDOW_WAIT_DEFAULT_S,
	WINDOW_WAIT_MAX_S,
	WINDOW_WAIT_SELECTOR,
	appNames,
	appZipListingProblem,
	appZipProblem,
	asksSceneSteps,
	backendUrlProblem,
	buildAppArgv,
	buildAppEnv,
	buildSteps,
	bundleInExtracted,
	cLocaleEnv,
	captureModeProblem,
	codesignVerdict,
	comparablePath,
	createSupervisor,
	credentialMaterial,
	daemonRequest,
	daemonRequestProblem,
	detailReadSelector,
	downloadDestinations,
	downloadFailureHint,
	downloadPreflight,
	downloadSceneSteps,
	downloadStepsProblem,
	duplicateFrameProblem,
	envGovernedBlockedMessage,
	extractedContainmentProblem,
	extractedSymlinkProblem,
	filePreviewSceneSteps,
	filePreviewSelector,
	frameMatchesWindow,
	imagePreviewCheck,
	inspectLanding,
	killRigMatched,
	landingNames,
	libraryProvenanceCheck,
	listNames,
	lopArgvProblem,
	manifestEntry,
	operatorDownloadsDir,
	operatorPathProblem,
	operatorRoots,
	parseArgs,
	parsePsFactsLine,
	physical,
	pngSize,
	portListenerOwned,
	previewFileProblem,
	processFacts,
	processFactsMany,
	quarantineProblem,
	readImagePreview,
	readLibraryProvenance,
	receiptLimits,
	redactEnv,
	relayPortFromConfig,
	relayPortProblem,
	releaseZipApp,
	rememberIdentities,
	resolveAppBundle,
	rigMatcher,
	screenRecordingGrantHint,
	screenRecordingVerdict,
	selectServeRecord,
	startupProblem,
	stepCountProblem,
	strayDownloadsProblem,
	tccHostFromPsTable,
	updateDetailSceneSteps,
	validateOptions,
	verifySeedRows,
	windowModeProblem,
	windowWaitStep,
} from "./mac-proof-capture.mjs";

/**
 * Contract tests for `scripts/mac-proof-capture.mjs`, the one-command Mac proof
 * harness. Everything Mac-only (the JXA window lookup, the Screen Recording
 * preflight, `screencapture -l`) is out of reach here and is stated so in
 * `docs/mac-proof-capture.md`; what this file proves on Linux is everything
 * around it:
 *
 *   - every refusal guard, against real directory trees with a FAKE home (equal,
 *     symlinked, nested and containing paths), so no operator directory is read;
 *   - the stdout protocol supervisor, line by line;
 *   - the spawn plan: allowlisted env, no inherited CMUX_/LOP_/LOCAL_OPERATOR_,
 *     switches after the absolute binary with no `--`, the token redacted;
 *   - END TO END against a FAKE app tree (a node script that speaks the
 *     `[window-mode]`/`[dev-driver]`/`[dev-driver-script]` protocol, RE-PARENTS a
 *     child carrying the profile and, when a case asks, IGNORES SIGTERM) and a
 *     FAKE `lop serve`:
 *     frames named `<scene>-<theme>.png`, the receipt, the token never on stdout,
 *     argv or in the receipt, and a reap that leaves no process behind.
 *
 * Every process a case starts is spawned `detached` by the harness and reaped by
 * it; the cases assert that, and `after` kills anything a failed case left by
 * exact pid from the fake's own pid files.
 */

const HARNESS = join(process.cwd(), "scripts", "mac-proof-capture.mjs");
const TREE = mkdtempSync(join(os.tmpdir(), "mac-proof-test-"));
const leftovers = [];

after(() => {
	for (const pid of leftovers) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
	}
	rmSync(TREE, { recursive: true, force: true });
});

/**
 * Every fixture process bounds its own life, because `after` (and the harness's
 * reap) run only while the test runner is alive. Measured on node2: an
 * OOM-killed runner left a fake `lop serve` and the re-parented helper running
 * with nothing left to reap them. So:
 *   - `FIXTURE_CAP_MS`: a hard lifetime cap on EVERY fixture (each case's
 *     fixtures live a few seconds; the slowest whole case measured 20.8 s);
 *   - `PARENT_WATCH`: processes whose parent is the harness or the runner exit
 *     as soon as that parent is gone (re-parented). The two processes that are
 *     MEANT to outlive their parent - the fake app's re-parented helper and the
 *     daemon's standby runtime, which exist to prove the harness's profile and
 *     config-root sweeps - carry only the cap, so those assertions stay
 *     discriminating (a self-exit would make "it was reaped" vacuous).
 */
const FIXTURE_CAP_MS = 60_000;
const CAP_ONLY = `setTimeout(()=>process.exit(0),${FIXTURE_CAP_MS});setInterval(()=>{},1000)`;
const PARENT_WATCH = `{ const first = process.ppid; setInterval(() => { if (process.ppid !== first) process.exit(0); }, 500); setTimeout(() => process.exit(0), ${FIXTURE_CAP_MS}); }`;

/** A 1x1 PNG, the frame the fake app "captures". */
const PNG_1X1 = Buffer.from(
	"89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
		"1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
	"hex",
);

/**
 * A fake `.app` bundle whose executable is a node script. `behaviour` lands in
 * a JSON file beside it, because the harness passes the app an ALLOWLISTED env
 * and nothing a test exported could reach it - which is itself under test.
 *
 * `behaviour.ignoreTerm` makes the app a WEDGED one that ignores SIGTERM, so the
 * reap must escalate to SIGKILL. It is opt-in, not the default, because that
 * escalation costs the harness's full SIGTERM grace (`stopAppTree`: 5 s) on
 * EVERY run that uses it: measured on this file, the default-wedged fake made
 * the suite 197 s and pushed `Desktop Tests shard (2/5)` past its bound (Full
 * Test Suite run 44748413720). The cases whose SUBJECT is the escalation keep
 * it - the isolated end-to-end (asserts `reap.app.escalated`) and the
 * --timeout/SIGTERM/SIGHUP interruption case (a hung renderer is the shape
 * those paths clean up after) - and every other case's reap assertions
 * (`clean`, the re-parented helper found by its profile, nothing left running)
 * do not depend on how the leader died.
 */
function fakeApp(name, behaviour = {}) {
	const app = join(TREE, `${name}.app`);
	const macos = join(app, "Contents", "MacOS");
	mkdirSync(macos, { recursive: true });
	writeFileSync(
		join(app, "Contents", "Info.plist"),
		`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Local Operator</string>
<key>CFBundleShortVersionString</key><string>0.0.0-fake</string>
</dict></plist>`,
	);
	writeFileSync(join(macos, "behaviour.json"), JSON.stringify(behaviour));
	const exe = join(macos, "Local Operator");
	writeFileSync(
		exe,
		`#!${process.execPath}
${PARENT_WATCH}
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const behaviour = JSON.parse(fs.readFileSync(path.join(__dirname, "behaviour.json"), "utf8"));
const arg = (name) => (process.argv.find((a) => a.startsWith(name + "=")) || "").slice(name.length + 1);
const mode = behaviour.reportMode || arg("--window-mode");
const profile = arg("--user-data-dir");
const out = process.env.LOCAL_OPERATOR_UI_DEV_DRIVER_OUT;
const rig = path.dirname(profile);
// Facts for the test, never the token itself: key names, its hash, argv.
fs.writeFileSync(path.join(rig, "fake-app-seen.json"), JSON.stringify({
  argv: process.argv.slice(2),
  envKeys: Object.keys(process.env).sort(),
  tokenSha: process.env.LOCAL_OPERATOR_DESKTOP_TOKEN ? crypto.createHash("sha256").update(process.env.LOCAL_OPERATOR_DESKTOP_TOKEN).digest("hex") : null,
  attachUrl: process.env.LOCAL_OPERATOR_UI_ATTACH_BACKEND_URL,
  home: process.env.HOME,
  cwd: process.cwd(),
}));
if (behaviour.ignoreTerm) process.on("SIGTERM", () => {}); // a wedged app: the harness must escalate
const log = (line) => process.stdout.write(line + "\\n");
log("[window-mode] window mode " + mode + ": 1380x900, never shown, page throttling off");
log("[dev-driver] ARMED; frames are written to " + out);
// noScript: a release that predates the S1 step runner never prints this.
if (!behaviour.noScript) log("[dev-driver-script] ARMED; steps from " + process.env.LOCAL_OPERATOR_UI_DEV_DRIVER_SCRIPT);
// The re-parented helper: its own group, carrying the profile, outliving us.
const child = spawn(process.execPath, ["-e", ${JSON.stringify(CAP_ONLY)}, "--", "--user-data-dir=" + profile], { detached: true, stdio: "ignore" });
child.unref();
fs.writeFileSync(path.join(rig, "fake-child.pid"), String(child.pid));
fs.writeFileSync(path.join(rig, "fake-app.pid"), String(process.pid));
setTimeout(() => {
  log("[window-mode] state: visible=" + (mode === "inactive") + " focused=" + Boolean(behaviour.focused) + " focusable=false size=1380x900 content=1380x872");
  // A wedged renderer: armed, shown, and then nothing - the shape the
  // harness's --timeout and SIGTERM paths have to clean up after.
  if (behaviour.hang) return;
  // A pre-S1 build has no step runner at all: it boots and idles.
  if (behaviour.noScript) return;
  const steps = JSON.parse(fs.readFileSync(process.env.LOCAL_OPERATOR_UI_DEV_DRIVER_SCRIPT, "utf8")).steps;
  log("[dev-driver-script] ready verbs=8");
  steps.forEach((step, i) => {
    const n = i + 1;
    if (behaviour.failVerb === step.verb) { log("[dev-driver-script] step=" + n + " verb=" + step.verb + " error: fake failure"); log("[dev-driver-script] FAILED step=" + n); return; }
    if (step.verb === "shutter") {
      const file = path.join(out, step.payload.label + ".png");
      // Distinct bytes per label (trailing after IEND; pngSize reads only IHDR),
      // as real scenes differ; behaviour.sameFrame reproduces #1907's stale shot.
      const png = Buffer.from("${PNG_1X1.toString("hex")}", "hex");
      fs.writeFileSync(file, behaviour.sameFrame ? png : Buffer.concat([png, Buffer.from(step.payload.label)]));
      log("[dev-driver-script] SHUTTER label=" + step.payload.label + " capture=capturepage path=" + file + " width=1 height=1 visible=false focused=false");
      log("[dev-driver-script] step=" + n + " verb=shutter ok {}");
      return;
    }
    // downloadPost: the press on the Download entry sends what the real app
    // sends (desktop op sessions.files.download) - from the APP, with the
    // app's own token, to the backend it attached to; the harness never does.
    if (behaviour.downloadPost && step.verb === "press" && String(step.payload && step.payload.selector).includes('data-remote-action="download"')) {
      const url = process.env.LOCAL_OPERATOR_UI_ATTACH_BACKEND_URL + "/v1/desktop/sessions/" + arg("--open-session") + "/files/f1/download";
      const post = require("node:child_process").spawnSync(process.execPath, ["-e", "fetch(process.argv[1], { method: 'POST', headers: { authorization: 'Bearer ' + process.env.T } }).then(async (r) => { process.stdout.write(String(r.status)); })", url], { env: { T: process.env.LOCAL_OPERATOR_DESKTOP_TOKEN }, encoding: "utf8", timeout: 10000 });
      fs.writeFileSync(path.join(rig, "fake-download-post.txt"), post.stdout || "none");
    }
    const value = step.verb === "state" ? { activeSessionId: behaviour.activeSessionId ?? (arg("--open-session") || null) } : { ok: true };
    log("[dev-driver-script] step=" + n + " verb=" + step.verb + " ok " + JSON.stringify(value));
  });
  if (!behaviour.failVerb) log("[dev-driver-script] DONE steps=" + steps.length);
}, 200);
setInterval(() => {}, 1000);
`,
	);
	chmodSync(exe, 0o755);
	return app;
}

/**
 * A fake `lop` with the two invocations the harness may make:
 *   - `serve --host H --port P`: answers /health and /v1/desktop/sessions (bearer
 *     checked against its env token, the session rows appearing only from the
 *     third read - the empty-then-filled cache node2 measured), records what it
 *     saw, and spawns a STANDBY RUNTIME in its OWN process group carrying the
 *     config root in its env, the shape the real daemon has (4 extra pgids);
 *   - `network serve --port P`: a relay that just listens, recording its pid.
 * Sessions to list come from `<config>/fake-sessions.json` when present.
 *
 * The two --seed read-backs answer from the SEEDED FILES the way core does:
 * `GET /v1/desktop/asks` from `<config>/asks/*.json` (index only), and
 * `GET /v1/desktop/notifications/<id>` from `<config>/notifications.db` through
 * node:sqlite. `dropSeed` makes both answer as if nothing were seeded (an empty
 * list, a 404) - the drift the harness must BLOCK on.
 */
/**
 * Written ONCE per variant: the script is deterministic, and the end-to-end
 * cases run concurrently (see `it`), so rewriting it per call would
 * truncate a file another run's harness may be exec'ing at that moment.
 */
const fakeLops = new Map();
function fakeLop({ dropSeed = false } = {}) {
	const lop = join(TREE, dropSeed ? "fake-lop-dropseed" : "fake-lop");
	if (fakeLops.has(lop)) return lop;
	fakeLops.set(lop, true);
	writeFileSync(
		lop,
		`#!${process.execPath}
${PARENT_WATCH}
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const argv = process.argv.slice(2);
const port = Number(argv[argv.indexOf("--port") + 1]);
const config = process.env.LOCAL_OPERATOR_CONFIG_DIR;
fs.mkdirSync(config, { recursive: true });
const sha = (v) => v ? crypto.createHash("sha256").update(v).digest("hex") : null;
if (argv[0] === "network") {
  fs.writeFileSync(path.join(config, "fake-relay-seen.json"), JSON.stringify({ argv, pid: process.pid, home: process.env.HOME, tokenSha: sha(process.env.LOCAL_OPERATOR_DESKTOP_TOKEN) }));
  net.createServer((s) => s.end()).listen(port, "127.0.0.1");
  return;
}
fs.writeFileSync(path.join(config, "fake-serve-seen.json"), JSON.stringify({
  argv, port, home: process.env.HOME, config,
  tmpdir: process.env.TMPDIR, gitConfigSystem: process.env.GIT_CONFIG_SYSTEM,
  gitTerminalPrompt: process.env.GIT_TERMINAL_PROMPT, ghConfigDir: process.env.GH_CONFIG_DIR,
  tokenSha: sha(process.env.LOCAL_OPERATOR_DESKTOP_TOKEN),
  configEntries: fs.readdirSync(config),
  pid: process.pid,
}));
// The standby runtime: detached = its own process group, outside serve's.
const standby = spawn(process.execPath, ["-e", ${JSON.stringify(CAP_ONLY)}], { detached: true, stdio: "ignore", env: process.env });
standby.unref();
fs.writeFileSync(path.join(config, "fake-standby.pid"), String(standby.pid));
let reads = 0;
const requests = [];
http.createServer((req, res) => {
  requests.push(req.method + " " + req.url);
  fs.writeFileSync(path.join(config, "fake-serve-requests.json"), JSON.stringify(requests));
  res.setHeader("content-type", "application/json");
  if (req.url === "/health") return res.end(JSON.stringify({ status: 200, message: "ok", result: { version: "0.0.0-fake", pid: process.pid } }));
  const authorized = req.headers.authorization === "Bearer " + process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
  if (req.url === "/v1/desktop/asks") {
    if (!authorized) { res.statusCode = 401; return res.end("{}"); }
    const dir = path.join(config, "asks");
    const rows = [];
    if (!${dropSeed} && fs.existsSync(dir))
      for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
        const entry = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        for (const ask of entry.asks) rows.push({ ...ask, session_id: name.slice(0, -5), cwd: entry.cwd });
      }
    return res.end(JSON.stringify({ status: 200, message: "ok", result: { asks: rows } }));
  }
  if (req.url.startsWith("/v1/desktop/notifications/")) {
    if (!authorized) { res.statusCode = 401; return res.end("{}"); }
    const id = req.url.split("/").pop();
    const file = path.join(config, "notifications.db");
    if (${dropSeed} || !fs.existsSync(file)) { res.statusCode = 404; return res.end("{}"); }
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(file);
    const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id);
    const history = db.prepare("SELECT revision, at, title, excerpt FROM item_history WHERE item_id = ? ORDER BY revision DESC").all(id);
    db.close();
    if (!item) { res.statusCode = 404; return res.end("{}"); }
    return res.end(JSON.stringify({ status: 200, message: "ok", result: { item, history, asks: [] } }));
  }
  // The files download route, landing like core (remote_session_files.py
  // downloads_dir): $HOME/Downloads when a directory, else <config>/downloads.
  // The bytes come from <config>/fake-download.json {name, text}.
  if (req.method === "POST" && req.url.startsWith("/v1/desktop/sessions/") && req.url.includes("/files/") && req.url.endsWith("/download")) {
    if (!authorized) { res.statusCode = 401; return res.end("{}"); }
    const spec = JSON.parse(fs.readFileSync(path.join(config, "fake-download.json"), "utf8"));
    const home = path.join(process.env.HOME, "Downloads");
    const dir = fs.existsSync(home) && fs.statSync(home).isDirectory() ? home : path.join(config, "downloads");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, spec.name), spec.text);
    return res.end(JSON.stringify({ status: 200, message: "ok", result: { path: path.join(dir, spec.name), name: spec.name, created: true } }));
  }
  if (req.url.startsWith("/v1/desktop/sessions?")) {
    if (req.headers.authorization !== "Bearer " + process.env.LOCAL_OPERATOR_DESKTOP_TOKEN) { res.statusCode = 401; return res.end("{}"); }
    reads++;
    const file = path.join(config, "fake-sessions.json");
    const rows = reads >= 3 && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    return res.end(JSON.stringify({ status: 200, message: "ok", result: { sessions: rows } }));
  }
  // The Library provenance read-back: a PEER row unless the rig's config
  // carries fake-library.json (a row to serve instead, e.g. a local one).
  if (req.url.startsWith("/v1/desktop/library/assets")) {
    if (req.headers.authorization !== "Bearer " + process.env.LOCAL_OPERATOR_DESKTOP_TOKEN) { res.statusCode = 401; return res.end("{}"); }
    const file = path.join(config, "fake-library.json");
    const row = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : { id: "la_00000000000000aa", ref: { type: "path", path: null }, origin: "generated", remote: { device_id: "d1", device_name: "Owner" } };
    const result = req.url.startsWith("/v1/desktop/library/assets?") ? { state: "ready", rows: [row] } : row;
    return res.end(JSON.stringify({ status: 200, message: "ok", result }));
  }
  res.statusCode = 404;
  res.end("{}");
}).listen(port, argv[argv.indexOf("--host") + 1]);
`,
	);
	chmodSync(lop, 0o755);
	return lop;
}

function harnessEnv(env = {}) {
	return {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		// Present on purpose: the harness must not forward any of these.
		CMUX_SURFACE_ID: "leak-me",
		LOP_SESSION: "leak-me",
		NODE_OPTIONS: "--max-old-space-size=64",
		ELECTRON_RUN_AS_NODE: "1",
		LOCAL_OPERATOR_FAKE_LEAK: "leak-me",
		...env,
	};
}

function runHarness(args, env = {}) {
	const run = spawnSync(process.execPath, [HARNESS, ...args], {
		encoding: "utf8",
		timeout: 120_000,
		env: harnessEnv(env),
	});
	return { ...run, all: `${run.stdout}\n${run.stderr}` };
}

/**
 * `runHarness` without blocking the event loop, for the concurrent end-to-end
 * cases: a `spawnSync` in one of them would stall every other case's exit
 * events and timers (and inflate the elapsed-time bounds they assert). Same
 * env, same 120 s bound and SIGTERM as `spawnSync`'s `timeout`, same result
 * shape (`status`, `signal`, `stdout`, `stderr`, `all`).
 */
function runHarnessAsync(args, env = {}) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [HARNESS, ...args], {
			env: harnessEnv(env),
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (c) => {
			stdout += c;
		});
		child.stderr.setEncoding("utf8").on("data", (c) => {
			stderr += c;
		});
		const bound = setTimeout(() => child.kill("SIGTERM"), 120_000);
		// `close`, not `exit`: both pipes drained, so `all` is the whole output.
		child.on("close", (status, signal) => {
			clearTimeout(bound);
			resolve({ status, signal, stdout, stderr, all: `${stdout}\n${stderr}` });
		});
	});
}

/**
 * `it(name, [options], fn)`: an END-TO-END case (a real harness run against the
 * fake app and fake lop). Same signature as node:test's `test` - whose own `it`
 * alias is deliberately NOT imported here - but the case is DEFERRED and run, at
 * the end of the file, inside ONE bounded concurrent group. The name is `it` so
 * the formatter lays these calls out as test calls, exactly like the `test`
 * cases around them. Why the group: each run is wall-clock bound, not CPU bound - the
 * shared teardown's fixed settles (`stopAppTree`: 500 ms twice), the harness's
 * real windows (the 20 s startup window, the 10 s seed read-back, a 6 s
 * --timeout) - so run one after another they summed to ~116 s of a 121 s file
 * and pushed `Desktop Tests shard (2/5)` past its bound (Full Test Suite run
 * 44748413720). Nothing in a case is shortened: each keeps its own rig root,
 * out dir and fake app, every sweep is scoped to its own rig / config root
 * (`rigMatcher`), and fixtures are written once (`fakeLop`). The bound keeps
 * the extra process load modest (each run is ~5 node processes) on a CI
 * runner that is already running other test files beside this one.
 */
const E2E_CONCURRENCY = 4;
const e2eCases = [];
function it(...args) {
	e2eCases.push(args);
}

/** Every fixture pid a run left a record of: app, re-parented helper, daemon, standby. */
function fixturePids(rig, configRoot = join(rig, "config")) {
	const pids = {};
	for (const [name, file] of [
		["app", join(rig, "fake-app.pid")],
		["reparented", join(rig, "fake-child.pid")],
		["standby", join(configRoot, "fake-standby.pid")],
	])
		if (existsSync(file)) pids[name] = Number(readFileSync(file, "utf8"));
	const served = join(configRoot, "fake-serve-seen.json");
	if (existsSync(served))
		pids.serve = JSON.parse(readFileSync(served, "utf8")).pid;
	return pids;
}

const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
};

function rigOf(rigRoot) {
	const rigs = readdirSync(rigRoot).filter((n) => n.startsWith("mac-proof-"));
	assert.equal(rigs.length, 1, `one rig under ${rigRoot}: ${rigs}`);
	return join(rigRoot, rigs[0]);
}

function trackPids(rig, configRoot = join(rig, "config")) {
	for (const file of [
		join(rig, "fake-child.pid"),
		join(rig, "fake-app.pid"),
		join(configRoot, "fake-standby.pid"),
	]) {
		if (existsSync(file)) leftovers.push(Number(readFileSync(file, "utf8")));
	}
	for (const file of ["fake-serve-seen.json", "fake-relay-seen.json"]) {
		const p = join(configRoot, file);
		if (existsSync(p)) leftovers.push(JSON.parse(readFileSync(p, "utf8")).pid);
	}
}

/* ---------------------------------------------------------------- guards */

test("the operator-root names are derived from package.json, and pinned", () => {
	// Design risk 9: a rename would silently weaken the guard. If this fails,
	// re-derive operatorRoots' expectations for the new names on purpose.
	assert.deepEqual(appNames(), {
		productName: "Local Operator",
		name: "local-operator-ui",
	});
	const roots = operatorRoots({ homes: ["/h"] });
	for (const expected of [
		"/h/Library/Application Support/Local Operator",
		"/h/Library/Application Support/local-operator-ui",
		"/h/Library/Application Support/Electron",
		"/h/.config/Local Operator",
		"/h/.local-operator",
	])
		assert.ok(roots.includes(expected), expected);
});

test("operator paths refuse when equal, symlinked, nested or containing - and only then", () => {
	const home = join(TREE, "guard-home");
	const profile = join(
		home,
		"Library",
		"Application Support",
		"Local Operator",
	);
	mkdirSync(profile, { recursive: true });
	mkdirSync(join(home, ".local-operator", "sessions", "s1", "scratchpad"), {
		recursive: true,
	});
	const link = join(TREE, "guard-link");
	symlinkSync(profile, link);
	const roots = operatorRoots({ homes: [home] });
	assert.match(operatorPathProblem("p", profile, roots), /is the operator's/);
	assert.match(operatorPathProblem("p", link, roots), /is the operator's/);
	assert.match(
		operatorPathProblem("p", join(link, "nested", "deeper"), roots),
		/inside it/,
	);
	assert.match(
		operatorPathProblem("p", join(home, "Library"), roots),
		/contains/,
	);
	assert.match(operatorPathProblem("p", home, roots), /contains/);
	assert.match(operatorPathProblem("p", "relative/dir", roots), /absolute/);
	// The scratchpad carve-out: allowed for rig/out, never for a config root.
	const pad = join(
		home,
		".local-operator",
		"sessions",
		"s1",
		"scratchpad",
		"rig",
	);
	assert.equal(operatorPathProblem("p", pad, roots), null);
	assert.match(
		operatorPathProblem("p", pad, roots, { allowScratchpad: false }),
		/inside it/,
	);
	assert.match(
		operatorPathProblem("p", join(home, ".local-operator", "run"), roots),
		/inside it/,
	);
	assert.equal(operatorPathProblem("p", join(TREE, "clear"), roots), null);
});

test("operator paths: a dangling symlink is followed to its target (QA r1 Q1-1)", () => {
	const home = join(TREE, "dangle-home");
	mkdirSync(home, { recursive: true });
	const roots = operatorRoots({ homes: [home], xdgConfigHome: undefined });
	const missing = join(home, ".config", "Local Operator");
	const link = join(TREE, "dangle-link");
	symlinkSync(missing, link);
	assert.equal(existsSync(missing), false, "the target does not exist yet");
	assert.equal(physical(link), physical(missing));
	assert.equal(
		physical(join(link, "mac-proof-x")),
		join(physical(missing), "mac-proof-x"),
	);
	assert.match(
		operatorPathProblem("rig root", link, roots),
		/is the operator's/,
	);
	// A relative dangling link resolves against its own directory.
	const rel = join(TREE, "dangle-rel");
	symlinkSync(join("dangle-home", ".local-operator"), rel);
	assert.match(
		operatorPathProblem("rig root", rel, roots),
		/is the operator's/,
	);
	// A cycle terminates (and is clear of the operator's roots).
	symlinkSync(join(TREE, "cycle-b"), join(TREE, "cycle-a"));
	symlinkSync(join(TREE, "cycle-a"), join(TREE, "cycle-b"));
	assert.equal(
		operatorPathProblem("rig root", join(TREE, "cycle-a"), roots),
		null,
	);
});

test("operator paths: case variants refuse under the darwin rule, and only there (review r1 R1-3)", () => {
	const home = join(TREE, "case-home");
	const profile = join(
		home,
		"Library",
		"Application Support",
		"Local Operator",
	);
	mkdirSync(profile, { recursive: true });
	const roots = operatorRoots({ homes: [home], xdgConfigHome: undefined });
	const variant = join(
		home,
		"Library",
		"Application Support",
		"local operator",
	);
	assert.match(
		operatorPathProblem("rig root", variant, roots, { platform: "darwin" }),
		/is the operator's/,
	);
	assert.match(
		operatorPathProblem("cfg", join(home, ".Local-Operator", "x"), roots, {
			platform: "darwin",
		}),
		/inside it/,
	);
	// Linux filesystems are case-sensitive: a different spelling is a different dir.
	assert.equal(
		operatorPathProblem("rig root", variant, roots, { platform: "linux" }),
		null,
	);
	assert.equal(comparablePath("/A/\u0065\u0301", "darwin"), "/a/\u00e9");
	assert.equal(comparablePath("/A/B", "linux"), "/A/B");
});

test("operator paths: Linux userData under $XDG_CONFIG_HOME is an operator root (QA r1 Q1-2)", () => {
	const home = join(TREE, "xdg-home");
	const xdg = join(TREE, "xdg-config");
	const roots = operatorRoots({ homes: [home], xdgConfigHome: xdg });
	assert.ok(roots.includes(join(xdg, "Local Operator")));
	assert.ok(
		roots.includes(join(home, ".config", "Local Operator")),
		"~/.config stays",
	);
	assert.match(
		operatorPathProblem("rig root", join(xdg, "Local Operator", "r"), roots),
		/inside it/,
	);
	assert.ok(
		!operatorRoots({ homes: [home], xdgConfigHome: "relative/x" }).some((r) =>
			r.startsWith("relative"),
		),
	);
	// And the real entry point reads the variable: a dry run into it refuses.
	const run = runHarness(
		[
			"--app",
			fakeApp("XdgDry"),
			"--out",
			join(TREE, "xdg-out"),
			"--rig-root",
			join(xdg, "Local Operator"),
			"--capture",
			"capturepage",
			"--lop",
			fakeLop(),
			"--dry-run",
		],
		{ XDG_CONFIG_HOME: xdg },
	);
	assert.equal(run.status, 2, run.all);
	assert.match(run.all, /operator's/);
});

test("only inactive and headless are run, and screencapture needs inactive on darwin", () => {
	for (const ok of ["inactive", "headless"])
		assert.equal(windowModeProblem(ok), null);
	for (const bad of ["normal", "", "focus", undefined, "INACTIVE"])
		assert.match(windowModeProblem(bad), /refused/);
	assert.match(captureModeProblem("screencapture", "headless"), /inactive/);
	assert.match(
		captureModeProblem("flash", "inactive"),
		/screencapture or capturepage/,
	);
	assert.equal(captureModeProblem("capturepage", "headless"), null);
	if (process.platform !== "darwin")
		assert.match(
			captureModeProblem("screencapture", "inactive"),
			/only on macOS/,
		);
});

test("the app path must be an absolute .app bundle with a real executable", () => {
	assert.throws(() => resolveAppBundle("Local Operator.app"), Refusal);
	assert.throws(() => resolveAppBundle(null), Refusal);
	assert.throws(() => resolveAppBundle(process.execPath), /\.app bundle/);
	const empty = join(TREE, "Empty.app");
	mkdirSync(empty, { recursive: true });
	assert.throws(() => resolveAppBundle(empty), /Info\.plist/);
	const app = fakeApp("Resolve");
	const resolved = resolveAppBundle(app);
	assert.equal(
		resolved.executable,
		join(app, "Contents", "MacOS", "Local Operator"),
	);
	assert.equal(resolved.version, "0.0.0-fake");
	assert.equal(resolved.kind, "built");
});

test("backend URLs: loopback http origins only, and never :1111 for an isolated daemon", () => {
	assert.match(
		backendUrlProblem("http://127.0.0.1:1111", { isolated: true }),
		/never uses port 1111/,
	);
	assert.equal(
		backendUrlProblem("http://127.0.0.1:1111", { isolated: false }),
		null,
	);
	assert.match(
		backendUrlProblem("http://10.0.0.5:4000", { isolated: false }),
		/loopback/,
	);
	assert.match(
		backendUrlProblem("https://127.0.0.1:4000", { isolated: false }),
		/http:/,
	);
	assert.match(
		backendUrlProblem("http://127.0.0.1:4000/v1", { isolated: false }),
		/origin/,
	);
	assert.match(
		backendUrlProblem("http://u:p@127.0.0.1:4000", { isolated: false }),
		/credentials/,
	);
	assert.match(
		backendUrlProblem("http://127.0.0.1", { isolated: false }),
		/port/,
	);
});

test("attach takes the token only from a CLAIMED record; env-governed is BLOCKED, unclaimed refused", () => {
	const live = () => true;
	assert.deepEqual(
		selectServeRecord(
			[{ port: 1111, pid: 42, desktop: true, claim_key: "k-claimed" }],
			1111,
			live,
		),
		{ kind: "token", token: "k-claimed", pid: 42 },
	);
	const blocked = selectServeRecord(
		[{ port: 1111, pid: 42, desktop: true, claim_key: "" }],
		1111,
		live,
	);
	assert.equal(blocked.kind, "blocked");
	assert.equal(blocked.message, envGovernedBlockedMessage(1111));
	assert.match(
		blocked.message,
		/^BLOCKED: .*registry\.py:498.*backend-service\.ts:241\/4391/,
	);
	assert.equal(
		selectServeRecord(
			[{ port: 1111, pid: 42, desktop: false, claim_key: "k" }],
			1111,
			live,
		).kind,
		"refused",
	);
	assert.equal(
		selectServeRecord(
			[{ port: 1111, pid: 42, desktop: true, claim_key: "k" }],
			1111,
			() => false,
		).kind,
		"refused",
		"a dead record is not a daemon",
	);
	assert.equal(
		selectServeRecord(
			[{ port: 2222, pid: 42, desktop: true, claim_key: "k" }],
			1111,
			live,
		).kind,
		"refused",
	);
});

test("a seed template carrying credential material is found, segment by segment", () => {
	const seed = join(TREE, "seed-dirty");
	for (const rel of [
		"secrets/x",
		"vault/x",
		"network/credentials",
		"network/identity/device",
		"auth.db",
		"auth-cache.json",
		"account.json",
		"network/create-keys.json",
		"mcp_oauth_refresh_1.lock",
		"desktop-token",
		"tls/server.key",
		"tls/server.pem",
		".env",
	]) {
		mkdirSync(join(seed, rel, ".."), { recursive: true });
		writeFileSync(join(seed, rel), "x");
	}
	const found = credentialMaterial(seed);
	for (const expected of [
		"secrets",
		"vault",
		"network/credentials",
		"network/identity",
		"auth.db",
		"auth-cache.json",
		"account.json",
		"network/create-keys.json",
		"mcp_oauth_refresh_1.lock",
		"desktop-token",
		"tls/server.key",
		"tls/server.pem",
		".env",
	])
		assert.ok(found.includes(expected), `${expected} in ${found}`);
	assert.equal(CREDENTIAL_SEGMENTS.length, 13);
	const clean = join(TREE, "seed-clean");
	mkdirSync(join(clean, "asks"), { recursive: true });
	writeFileSync(join(clean, "config.yml"), "x: 1\n");
	writeFileSync(join(clean, "asks", "a.json"), "{}");
	assert.deepEqual(credentialMaterial(clean), []);
});

test("the token-from-profile opt-in is attach-only and off by default", () => {
	const base = ["--app", "/x.app", "--out", "/tmp/o"];
	assert.equal(parseArgs(base).tokenFromOperatorProfile, false);
	assert.throws(
		() =>
			validateOptions(parseArgs([...base, "--token-from-operator-profile"])),
		/only with --backend attach/,
	);
	assert.throws(
		() => validateOptions(parseArgs([...base, "--backend", "attach"])),
		/needs --backend-url/,
	);
	assert.throws(
		() => validateOptions(parseArgs([...base, "--scene", "files"])),
		/need --session/,
	);
	assert.throws(
		() => validateOptions(parseArgs([...base, "--session", "XYZ"])),
		/12 lowercase hex/,
	);
	assert.throws(
		() => validateOptions(parseArgs([...base, "--window-mode", "normal"])),
		/refused/,
	);
});

/* ---------------------------------------------------------------- plan */

test("the app env is built from an allowlist, never inherited, and the token is redacted", () => {
	const env = buildAppEnv({
		base: {
			PATH: "/bin",
			CMUX_X: "1",
			LOP_Y: "1",
			LOCAL_OPERATOR_Z: "1",
			NODE_OPTIONS: "x",
			ELECTRON_RUN_AS_NODE: "1",
			SECRET: "s",
		},
		rig: "/r",
		backendUrl: "http://127.0.0.1:5000",
		token: "tok",
		windowMode: "inactive",
	});
	for (const key of Object.keys(env)) {
		assert.ok(!key.startsWith("CMUX_") && !key.startsWith("LOP_"), key);
		assert.notEqual(key, "NODE_OPTIONS");
		assert.notEqual(key, "ELECTRON_RUN_AS_NODE");
		assert.notEqual(key, "SECRET");
	}
	assert.equal(env.LOCAL_OPERATOR_Z, undefined);
	assert.equal(env.HOME, "/r/home");
	assert.equal(env.VITE_DISABLE_BACKEND_MANAGER, "true");
	assert.equal(env.LOCAL_OPERATOR_UI_TELEMETRY, "off");
	assert.equal(env.LOCAL_OPERATOR_UI_DEV_DRIVER_SCRIPT, "/r/steps.json");
	assert.equal(redactEnv(env).LOCAL_OPERATOR_DESKTOP_TOKEN, "<redacted>");
	const argv = buildAppArgv({
		rig: "/r",
		windowMode: "inactive",
		size: "1380x900",
		session: "ce618964c88e",
	});
	assert.ok(!argv.includes("--"));
	assert.ok(argv.every((a) => a.startsWith("--")));
	assert.ok(argv.includes(MOCK_KEYCHAIN_SWITCH));
	assert.ok(argv.includes("--user-data-dir=/r/profile"));
	assert.ok(argv.includes("--open-session=ce618964c88e"));
	assert.ok(!argv.join(" ").includes("tok"));
});

test("one launch covers every scene x theme, one shutter each, named <scene>-<theme>", () => {
	const { steps } = buildSteps({
		scenes: ["conversation", "files", "library"],
		themes: ["dark", "light"],
		session: "ce618964c88e",
		capture: "screencapture",
	});
	const shutters = steps
		.filter((s) => s.verb === "shutter")
		.map((s) => s.payload.label);
	assert.deepEqual(shutters, [
		"conversation-dark",
		"files-dark",
		"library-dark",
		"conversation-light",
		"files-light",
		"library-light",
	]);
	assert.ok(
		steps
			.filter((s) => s.verb === "shutter")
			.every((s) => s.payload.capture === "external"),
	);
	assert.equal(steps[0].verb, "skipOnboarding");
	assert.ok(steps.length <= 64, "within the runner's step cap");
	const all = buildSteps({
		scenes: ["conversation", "files", "canvas", "library", "notifications"],
		themes: ["dark", "light"],
		session: "ce618964c88e",
		capture: "capturepage",
	});
	assert.ok(all.steps.length <= 64, `${all.steps.length} steps`);
	assert.equal(stepCountProblem(all.steps), null);
	const every = buildSteps({
		scenes: [...SCENES],
		themes: ["dark", "light"],
		session: "fa1907000001",
		notificationId: "n_macproofdetailaa",
		capture: "capturepage",
	});
	assert.ok(every.steps.length > RUNNER_MAX_STEPS);
	assert.match(
		stepCountProblem(every.steps),
		/caps it at 64; split the --scene list/,
	);
});

test("route-only scenes wait for a positive selector of their settled state before the shutter (#1907 stale frame)", () => {
	const { steps } = buildSteps({
		scenes: ["notification-detail", "notifications", "library"],
		themes: ["light"],
		session: null,
		notificationId: "n_macproofdetailaa",
		capture: "capturepage",
	});
	for (const scene of ["notifications", "library"]) {
		const shutter = steps.findIndex(
			(s) => s.verb === "shutter" && s.payload.label === `${scene}-light`,
		);
		const before = steps[shutter - 1];
		assert.equal(before.verb, "waitFor", scene);
		assert.equal(before.payload.selector, SCENE_READY[scene]);
		assert.notEqual(before.optional, true);
		assert.deepEqual(steps[shutter - 2], {
			verb: "navigate",
			payload: `/${scene}`,
		});
	}
	// Only markup that exists in the target state, never the previous detail.
	assert.match(
		SCENE_READY.notifications,
		/^\[data-notifications-page\]:not\(:has\(\[data-notification-detail\], \[data-notification-open\]\)\)/,
	);
	assert.match(
		SCENE_READY.notifications,
		/\[data-notifications-list\], \[data-notifications-empty\]/,
	);
	// The RESULTS settled, never the header alone (it paints before the rows).
	assert.equal(
		SCENE_READY.library,
		'[data-library-page]:not(:has([data-library-building], [data-library-skeleton])) [data-library-results][aria-busy="false"]',
	);
	// The detail scene waits for the read-on-open to settle (design D7).
	const detailShutter = steps.findIndex(
		(s) => s.payload?.label === "notification-detail-light",
	);
	assert.equal(
		steps[detailShutter - 1].payload.selector,
		detailReadSelector("n_macproofdetailaa"),
	);
	assert.equal(
		detailReadSelector("n_macproofdetailaa"),
		'[data-notifications-page]:not(:has([data-notification-row="n_macproofdetailaa"][data-notification-unread])) [data-notification-detail="n_macproofdetailaa"] [data-notification-toggle-read] svg.lucide-circle',
	);
	// Every verb is one the v0.59.2 runner ships.
	const shipped = new Set([
		"navigate",
		"setTheme",
		"press",
		"state",
		"waitFor",
		"openCanvas",
		"skipOnboarding",
		"shutter",
	]);
	assert.ok(steps.every((s) => shipped.has(s.verb)));
});

test("update-detail: the drawer's Updates tab -> View details -> in-drawer detail, guarded presses, shipped verbs only", () => {
	const id = "n_macproofdetailaa";
	const steps = updateDetailSceneSteps(id);
	const shipped = new Set([
		"navigate",
		"setTheme",
		"press",
		"state",
		"waitFor",
		"openCanvas",
		"skipOnboarding",
		"shutter",
	]);
	assert.ok(steps.every((s) => shipped.has(s.verb)));
	// Toggles are pressed only from the state they would change, and optionally.
	const optional = steps.filter((s) => s.optional);
	assert.deepEqual(
		optional.map((s) => s.payload.selector),
		[
			'[data-panel-rail-item="ask"][aria-pressed="false"]',
			'[data-drawer-tab="updates"][aria-selected="false"]',
		],
	);
	// The required tail: tab selected, the row's details pressed, the drawer detail
	// painted and its read settled.
	const required = steps
		.filter((s) => !s.optional)
		.map((s) => s.payload?.selector ?? s.payload);
	assert.deepEqual(required.slice(-4), [
		'[data-drawer-tab="updates"][aria-selected="true"]',
		`[data-drawer-update="${id}"] [data-row-action="details"]`,
		`[data-drawer-detail="${id}"] [data-notification-detail-title]`,
		`[data-drawer-detail="${id}"] [data-notification-toggle-read] svg.lucide-circle`,
	]);
	assert.equal(steps.at(-3).verb, "press");
	const { steps: built } = buildSteps({
		scenes: ["update-detail"],
		themes: ["dark"],
		session: "fa1907000001",
		notificationId: id,
		capture: "capturepage",
	});
	assert.equal(built.at(-1).payload.label, "update-detail-dark");
	assert.equal(built.at(-2).payload.selector, steps.at(-1).payload.selector);
	// Prerequisites: a conversation and an item.
	assert.throws(
		() =>
			validateOptions(
				parseArgs([
					"--app",
					"/x.app",
					"--out",
					"/tmp/o",
					"--scene",
					"update-detail",
					"--notification-id",
					id,
				]),
			),
		/update-detail scenes need --session/,
	);
	assert.throws(
		() =>
			validateOptions(
				parseArgs([
					"--app",
					"/x.app",
					"--out",
					"/tmp/o",
					"--scene",
					"update-detail",
					"--session",
					"fa1907000001",
				]),
			),
		/update-detail scenes need --notification-id/,
	);
});

/*
 * The window wait (79's first default-mode Mac run: `the window is not visible
 * at the shutter (... visible=false focused=false ...)`, 0 frames). A window
 * opened for --session is held until its conversation paints, bounded by
 * CONVERSATION_PAINT_FALLBACK_MS = 3 s (src/main/index.ts:1252/2347); the
 * readiness steps finished inside that hold. The harness spends one bounded wait
 * in the app's own runner before the first scene and NEVER shows or focuses.
 */
describe("window wait before the first shutter", () => {
	// validateOptions refuses screencapture off macOS, so the range checks run
	// on a capturepage argv; the flag's bound does not depend on the capture.
	const argv = [
		"--app",
		"/x.app",
		"--out",
		"/tmp/o",
		"--capture",
		"capturepage",
		"--window-mode",
		"headless",
	];
	const onMac = (opts) => ({ ...opts, capture: "screencapture" });
	const waitIndex = (steps) =>
		steps.findIndex((s) => s.payload?.selector === WINDOW_WAIT_SELECTOR);

	test("default --window-wait 6: one optional never-matching waitFor after the readiness state, before every scene", () => {
		const opts = parseArgs(argv);
		assert.equal(opts.windowWaitS, 6);
		assert.equal(WINDOW_WAIT_DEFAULT_S, 6);
		validateOptions(opts);
		const { steps } = buildSteps({
			scenes: ["conversation", "library"],
			themes: ["dark", "light"],
			session: "ce618964c88e",
			capture: "screencapture",
			windowWaitS: opts.windowWaitS,
		});
		const i = waitIndex(steps);
		assert.equal(
			steps.filter((s) => s.payload?.selector === WINDOW_WAIT_SELECTOR).length,
			1,
		);
		assert.equal(
			steps[i - 1].verb,
			"state",
			"after the conversation is verified",
		);
		assert.ok(
			i < steps.findIndex((s) => s.verb === "shutter"),
			"before the first shutter",
		);
		assert.deepEqual(steps[i], {
			verb: "waitFor",
			payload: { selector: ":not(*)", timeoutMs: 6000 },
			timeoutMs: 11000,
			optional: true,
		});
		// The scene's own positive selector stays the last step before its frame.
		const first = steps.findIndex((s) => s.verb === "shutter");
		assert.equal(
			steps[first - 1].payload.selector,
			'[data-chat-region="header"]',
		);
		// buildSteps' own default is the same wait, so no caller can drop it by omission.
		assert.deepEqual(
			buildSteps({
				scenes: ["conversation"],
				themes: ["dark"],
				session: "ce618964c88e",
				capture: "screencapture",
			}).steps[i],
			steps[i],
		);
		// A selector that can never match: the step can end only by its own bound.
		assert.equal(WINDOW_WAIT_SELECTOR, ":not(*)");
		// capturepage is headless and never visible: no wait is spent there.
		assert.equal(
			windowWaitStep({ capture: "capturepage", windowWaitS: 6 }),
			null,
		);
		assert.equal(
			waitIndex(
				buildSteps({
					scenes: ["conversation"],
					themes: ["dark"],
					session: "ce618964c88e",
					capture: "capturepage",
					windowWaitS: 6,
				}).steps,
			),
			-1,
		);
	});

	test("max --window-wait 15 is accepted; above it, negative or non-numeric is refused", () => {
		assert.equal(WINDOW_WAIT_MAX_S, 15);
		const max = parseArgs([...argv, "--window-wait", "15"]);
		validateOptions(max);
		assert.deepEqual(windowWaitStep(onMac(max)), {
			verb: "waitFor",
			payload: { selector: ":not(*)", timeoutMs: 15000 },
			timeoutMs: 20000,
			optional: true,
		});
		for (const bad of ["15.5", "16", "-1", "soon"])
			assert.throws(
				() => validateOptions(parseArgs([...argv, "--window-wait", bad])),
				/--window-wait must be between 0 and 15 seconds/,
				bad,
			);
	});

	const lines = [
		"[window-mode] window mode inactive: 1380x900, window shown without activating the app",
		"[dev-driver] ARMED; frames",
		"[dev-driver-script] ARMED; steps",
		"[dev-driver-script] ready verbs=8",
		"[dev-driver-script] step=1 verb=skipOnboarding ok {}",
		"[dev-driver-script] step=2 verb=waitFor ok {}",
		"[dev-driver-script] step=3 verb=waitFor ok {}",
		'[dev-driver-script] step=4 verb=state ok {"activeSessionId":"ce618964c88e"}',
	];
	const clocked = (windowWait) => {
		let t = 1000;
		const clock = {
			set: (ms) => {
				t = ms;
			},
		};
		const sup = createSupervisor({
			windowMode: "inactive",
			session: "ce618964c88e",
			capture: "screencapture",
			framesDir: "/o",
			labels: ["conversation-dark"],
			windowWait,
			now: () => t,
		});
		for (const line of lines) assert.equal(sup.feed(line), null, line);
		return { sup, clock };
	};
	const shutter = (visible, focused = false) =>
		`[dev-driver-script] SHUTTER label=conversation-dark media=window:7139:0 visible=${visible} focused=${focused} ack=/o/conversation-dark.ack`;

	test("still hidden after the bound: the run fails naming the elapsed wait and the last facts", () => {
		const { sup, clock } = clocked({ step: 5, s: 6 });
		clock.set(7012);
		assert.equal(
			sup.feed(
				"[dev-driver-script] step=5 verb=waitFor skipped (optional): nothing matches :not(*) after 6000ms of waiting",
			),
			null,
		);
		const { abort } = sup.feed(shutter(false));
		assert.match(
			abort,
			/^the window is not visible at the shutter after a 6012 ms window wait \(--window-wait 6\): visible=false focused=false; /,
		);
		assert.match(
			abort,
			/retry with a longer --window-wait \(max 15\) - never a focused or normal-mode run/,
		);
		assert.deepEqual(sup.state.windowWait, {
			waitedMs: 6012,
			visibleAtShutter: false,
		});
		// The run's exit for any supervisor abort.
		assert.equal(EXIT.FAILED, 1);
	});

	test("visible as soon as the wait is spent: the frame is taken, the receipt records the wait", () => {
		const { sup, clock } = clocked({ step: 5, s: 6 });
		clock.set(7100);
		sup.feed(
			"[dev-driver-script] step=5 verb=waitFor skipped (optional): nothing matches :not(*) after 6000ms of waiting",
		);
		assert.deepEqual(sup.feed(shutter(true)), {
			shutter: {
				label: "conversation-dark",
				windowId: 7139,
				ack: "/o/conversation-dark.ack",
			},
		});
		assert.deepEqual(sup.state.windowWait, {
			waitedMs: 6100,
			visibleAtShutter: true,
		});
	});

	test("visibility already there and --window-wait 0: no wait step, no delay, the frame is taken", () => {
		const opts = parseArgs([...argv, "--window-wait", "0"]);
		validateOptions(opts);
		assert.equal(windowWaitStep(onMac(opts)), null);
		const withWait = buildSteps({
			scenes: ["conversation"],
			themes: ["dark"],
			session: "ce618964c88e",
			capture: "screencapture",
			windowWaitS: 6,
		}).steps;
		const none = buildSteps({
			scenes: ["conversation"],
			themes: ["dark"],
			session: "ce618964c88e",
			capture: "screencapture",
			windowWaitS: 0,
		}).steps;
		assert.equal(waitIndex(none), -1);
		assert.deepEqual(
			none,
			withWait.filter((s) => s.payload?.selector !== WINDOW_WAIT_SELECTOR),
		);
		const { sup } = clocked(null);
		assert.deepEqual(sup.feed(shutter(true)).shutter.windowId, 7139);
		assert.deepEqual(sup.state.windowWait, {
			waitedMs: 0,
			visibleAtShutter: true,
		});
		// And the hidden case without a wait still names that there was none.
		const { sup: bare } = clocked(null);
		assert.match(
			bare.feed(shutter(false)).abort,
			/not visible at the shutter with no window wait \(--window-wait 0\): visible=false focused=false/,
		);
	});

	test("the wait never relaxes the focus guard", () => {
		const { sup, clock } = clocked({ step: 5, s: 6 });
		clock.set(7012);
		sup.feed(
			"[dev-driver-script] step=5 verb=waitFor skipped (optional): nothing matches :not(*) after 6000ms of waiting",
		);
		assert.match(
			sup.feed(shutter(true, true)).abort,
			/the window is focused at the shutter/,
		);
	});
});

test("the supervisor aborts on normal, focus, early shutters and the wrong conversation", () => {
	const sup = (session = null) =>
		createSupervisor({
			windowMode: "inactive",
			session,
			capture: "screencapture",
			framesDir: "/o",
			labels: ["a-dark", "b-dark"],
		});
	assert.match(
		sup().feed("[window-mode] window mode normal: 1380x900, shown").abort,
		/not "inactive"/,
	);
	assert.match(
		sup().feed("[window-mode] state: visible=true focused=true focusable=true")
			.abort,
		/took focus/,
	);
	assert.match(sup().feed("[dev-driver] not armed: x").abort, /did not arm/);
	assert.match(sup().feed("[dev-driver-script] refused: y").abort, /refused/);
	assert.match(
		sup().feed(
			"[dev-driver-script] SHUTTER label=a-dark media=window:7:0 visible=true focused=false ack=/o/a.ack",
		).abort,
		/before/,
	);
	const s = sup("ce618964c88e");
	for (const line of [
		"[window-mode] window mode inactive: 1380x900",
		"[dev-driver] ARMED; frames",
		"[dev-driver-script] ARMED; steps",
	])
		assert.equal(s.feed(line), null);
	assert.match(
		s.feed(
			'[dev-driver-script] step=4 verb=state ok {"activeSessionId":"aaaaaaaaaaaa"}',
		).abort,
		/not --session/,
	);
	const ok = sup("ce618964c88e");
	for (const line of [
		"[window-mode] window mode inactive: 1380x900",
		"[dev-driver] ARMED; frames",
		"[dev-driver-script] ARMED; steps",
		'[dev-driver-script] step=4 verb=state ok {"activeSessionId":"ce618964c88e"}',
	])
		assert.equal(ok.feed(line), null);
	assert.match(
		ok.feed(
			"[dev-driver-script] SHUTTER label=a-dark media=window:7:0 visible=true focused=true ack=/o/a.ack",
		).abort,
		/focused/,
	);
	assert.match(
		ok.feed(
			"[dev-driver-script] SHUTTER label=a-dark media=window:7:0 visible=false focused=false ack=/o/a.ack",
		).abort,
		/not visible/,
	);
	assert.deepEqual(
		ok.feed(
			"[dev-driver-script] SHUTTER label=a-dark media=window:7:0 visible=true focused=false ack=/o/a.ack",
		),
		{
			// Derived as <framesDir>/<label>.ack, never the printed `/o/a.ack`.
			shutter: { label: "a-dark", windowId: 7, ack: "/o/a-dark.ack" },
		},
	);
	// Each frame at most once.
	assert.match(
		ok.feed(
			"[dev-driver-script] SHUTTER label=a-dark media=window:7:0 visible=true focused=false ack=/o/a-dark.ack",
		).abort,
		/second SHUTTER/,
	);
	// Only frames this run asked for: a label outside the set never names a file.
	assert.match(
		ok.feed(
			"[dev-driver-script] SHUTTER label=zz-dark media=window:7:0 visible=true focused=false ack=/o/zz-dark.ack",
		).abort,
		/did not ask for/,
	);
	assert.match(
		ok.feed("[dev-driver-script] step=9 verb=press error: nope").abort,
		/failed/,
	);
	assert.deepEqual(ok.feed("[dev-driver-script] DONE steps=9"), { done: true });
	assert.deepEqual(pngSize(PNG_1X1), { width: 1, height: 1 });
});

test("SHUTTER paths are derived by the harness, so a rig root with a space cannot redirect the ack", () => {
	// Review r1 R1-2: the ack path used to be the `ack=` field split on spaces;
	// under `~/Desktop/proof runs` it came back as `~/Desktop/proof` and the
	// harness wrote there. The harness now builds <framesDir>/<label>.ack itself.
	const framesDir = "/Users/x/Desktop/proof runs/mac-proof-abc123/frames";
	const ready = (capture) => {
		const s = createSupervisor({
			windowMode: capture === "screencapture" ? "inactive" : "headless",
			session: null,
			capture,
			framesDir,
			labels: ["library-dark"],
		});
		for (const line of [
			`[window-mode] window mode ${capture === "screencapture" ? "inactive" : "headless"}: 1380x900`,
			"[dev-driver] ARMED; frames",
			"[dev-driver-script] ARMED; steps",
		])
			assert.equal(s.feed(line), null);
		return s;
	};
	assert.deepEqual(
		ready("screencapture").feed(
			`[dev-driver-script] SHUTTER label=library-dark media=window:42:0 visible=true focused=false ack=${framesDir}/library-dark.ack`,
		),
		{
			shutter: {
				label: "library-dark",
				windowId: 42,
				ack: `${framesDir}/library-dark.ack`,
			},
		},
	);
	// Even a printed ack naming somewhere else is never the one written.
	assert.equal(
		ready("screencapture").feed(
			"[dev-driver-script] SHUTTER label=library-dark media=window:42:0 visible=true focused=false ack=/Users/x/Desktop/proof",
		).shutter.ack,
		`${framesDir}/library-dark.ack`,
	);
	// capturepage: the facts after a spaced path still parse, the path is derived.
	assert.deepEqual(
		ready("capturepage").feed(
			`[dev-driver-script] SHUTTER label=library-dark capture=capturepage path=${framesDir}/library-dark.png width=2760 height=1800 visible=false focused=false`,
		),
		{
			shutter: {
				label: "library-dark",
				path: `${framesDir}/library-dark.png`,
				width: 2760,
				height: 1800,
			},
		},
	);
	assert.match(
		ready("capturepage").feed(
			`[dev-driver-script] SHUTTER label=library-dark capture=capturepage path=${framesDir}/library-dark.png width=2760 height=1800 visible=false focused=true`,
		).abort,
		/focused/,
	);
	assert.throws(
		() =>
			createSupervisor({
				windowMode: "inactive",
				session: null,
				capture: "screencapture",
			}),
		/framesDir/,
	);
});

test("Screen Recording: only an explicit boolean from the preflight is an answer", () => {
	// Review r1 R1-1: an unavailable CGPreflightScreenCaptureAccess is BLOCKED,
	// never inferred from window names (system UI has names without permission).
	assert.equal(screenRecordingVerdict('{"granted":true}'), "granted");
	assert.equal(screenRecordingVerdict('{"granted":false}'), "denied");
	assert.equal(screenRecordingVerdict('{"granted":null}'), "unknown");
	assert.equal(screenRecordingVerdict("{}"), "unknown");
	assert.equal(screenRecordingVerdict('{"granted":"yes"}'), "unknown");
	assert.equal(screenRecordingVerdict("not json"), "unknown");
	const source = readFileSync(HARNESS, "utf8");
	const probe = source.slice(
		source.indexOf("export function screenRecordingGranted"),
		source.indexOf("export function screenRecordingVerdict"),
	);
	assert.doesNotMatch(probe, /kCGWindowName|CGWindowListCopyWindowInfo/);
	assert.doesNotMatch(probe, /CGRequest/);
	assert.match(
		source,
		/verdict === "unknown"[\s\S]{0,800}return EXIT\.BLOCKED/,
	);
});

/**
 * Run the JXA preflight source in a vm with a fake `ObjC`/`$`, the way
 * osascript would: its completion value is what `jxa()` prints.
 */
function runPreflight({
	bridged,
	bindable = true,
	answer = true,
	callThrows = false,
}) {
	const calls = [];
	const $ = {};
	const fn = () => {
		calls.push("call");
		if (callThrows) throw new Error("bridge");
		return answer;
	};
	if (bridged) $.CGPreflightScreenCaptureAccess = fn;
	const ObjC = {
		import: (name) => calls.push(`import:${name}`),
		bindFunction: (name, signature) => {
			calls.push(`bind:${name}:${JSON.stringify(signature)}`);
			if (!bindable) throw new Error("no symbol");
			$[name] = fn;
		},
	};
	const out = vm.runInNewContext(SCREEN_RECORDING_PREFLIGHT_JXA, { ObjC, $ });
	return { out, calls };
}

test("Screen Recording preflight JXA: bridged, then ObjC.bindFunction, never a request, only {granted}", () => {
	assert.match(
		SCREEN_RECORDING_PREFLIGHT_JXA,
		/ObjC\.bindFunction\('CGPreflightScreenCaptureAccess', \['bool', \[\]\]\)/,
	);
	assert.doesNotMatch(SCREEN_RECORDING_PREFLIGHT_JXA, /CGRequest/);
	assert.doesNotMatch(
		SCREEN_RECORDING_PREFLIGHT_JXA,
		/kCGWindowName|CGWindowList/,
	);
	// The one output is the last statement and carries one key.
	assert.match(
		SCREEN_RECORDING_PREFLIGHT_JXA.trim(),
		/JSON\.stringify\(\{granted: granted\}\);$/,
	);
	assert.equal(
		SCREEN_RECORDING_PREFLIGHT_JXA.match(/JSON\.stringify/g).length,
		1,
	);
	// Older macOS: the bridged symbol answers; no binding is attempted.
	let r = runPreflight({ bridged: true, answer: false });
	assert.equal(r.out, '{"granted":false}');
	assert.ok(!r.calls.some((c) => c.startsWith("bind:")));
	// macOS 27 (79's measurement: bindFunction returned {"granted":true}).
	r = runPreflight({ bridged: false, answer: true });
	assert.equal(r.out, '{"granted":true}');
	assert.ok(
		r.calls.includes('bind:CGPreflightScreenCaptureAccess:["bool",[]]'),
	);
	assert.equal(screenRecordingVerdict(r.out), "granted");
	// The C bool as 0/1 is still an answer.
	assert.equal(
		runPreflight({ bridged: false, answer: 0 }).out,
		'{"granted":false}',
	);
	// Unknowns stay unknown -> BLOCKED.
	for (const opts of [
		{ bridged: false, bindable: false },
		{ bridged: false, callThrows: true },
		{ bridged: true, callThrows: true },
		{ bridged: false, answer: null },
		{ bridged: false, answer: "yes" },
	]) {
		const { out } = runPreflight(opts);
		assert.equal(out, '{"granted":null}', JSON.stringify(opts));
		assert.equal(screenRecordingVerdict(out), "unknown");
	}
	assert.ok(
		!runPreflight({ bridged: false, bindable: false }).calls.includes("call"),
	);
});

test("TCC host: nearest .app up the ppid chain, else the top non-launchd process (79's real chain)", () => {
	// Measured by 79 on the Mac (Darwin 27.2): no .app ancestor, a renamed title.
	const lopChain = [
		"    1     0 /sbin/launchd",
		"20192     1 Local Operator [session] id=79bddc26",
		"48300 20192 /opt/homebrew/bin/bash",
		"48400 48300 node",
	].join("\n");
	assert.deepEqual(tccHostFromPsTable(lopChain, 48400), {
		host: "Local Operator [session] id=79bddc26",
		kind: "process",
		pid: 20192,
	});
	const terminal = [
		"    1     0 /sbin/launchd",
		"  500     1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
		"  600   500 login",
		"  700   600 -zsh",
		"  800   700 node",
	].join("\n");
	assert.deepEqual(tccHostFromPsTable(terminal, 800), {
		host: "Terminal.app",
		kind: "app",
		pid: 500,
	});
	// A nested helper bundle names its outer app.
	assert.equal(
		tccHostFromPsTable(
			"1 0 /sbin/launchd\n10 1 /Applications/Local Operator.app/Contents/Frameworks/Local Operator Helper.app/Contents/MacOS/Local Operator Helper\n11 10 node\n",
			11,
		).host,
		"Local Operator.app",
	);
	// Nearest .app wins over an outer one; a cycle or a missing pid ends the walk.
	assert.equal(
		tccHostFromPsTable(
			"1 0 launchd\n2 1 /Applications/iTerm.app/Contents/MacOS/iTerm2\n3 2 /Applications/cmux.app/Contents/MacOS/cmux\n4 3 node\n",
			4,
		).host,
		"cmux.app",
	);
	assert.equal(tccHostFromPsTable("5 6 a\n6 5 b\n", 5).host, "b");
	assert.equal(tccHostFromPsTable("", 5), null);
	assert.match(
		screenRecordingGrantHint({ host: "Terminal.app", kind: "app", pid: 500 }),
		/^grant Screen & System Audio Recording to Terminal\.app in System Settings > Privacy & Security/,
	);
	assert.match(
		screenRecordingGrantHint(tccHostFromPsTable(lopChain, 48400)),
		/to Local Operator \[session\] id=79bddc26 \(pid 20192, .*no \.app ancestor/,
	);
	assert.match(screenRecordingGrantHint(null), /could not be read/);
	assert.doesNotMatch(
		readFileSync(HARNESS, "utf8"),
		/tccutil|CGRequestScreenCaptureAccess\(/,
	);
});

test("stale frames: two scenes with one sha256 fail; one scene's themes do not (run #1907 receipt)", () => {
	// The real #1907 receipt's frames (sha256 abbreviated past the first 8 is fine).
	const frames = [
		{ label: "notification-detail-dark", theme: "dark", sha256: "5bdf872c" },
		{ label: "notifications-dark", theme: "dark", sha256: "bc2ba447" },
		{ label: "notification-detail-light", theme: "light", sha256: "cbbbcdc5" },
		{ label: "notifications-light", theme: "light", sha256: "cbbbcdc5" },
	];
	assert.match(
		duplicateFrameProblem(frames),
		/notification-detail-light and notifications-light are byte-identical \(sha256 cbbbcdc5\)/,
	);
	assert.equal(duplicateFrameProblem(frames.slice(0, 3)), null);
	assert.equal(
		duplicateFrameProblem([
			{ label: "asks-dark", theme: "dark", sha256: "aa" },
			{ label: "asks-light", theme: "light", sha256: "aa" },
		]),
		null,
		"the same scene in two themes is not a stale route",
	);
	assert.equal(duplicateFrameProblem([]), null);
});

test("a screencapture frame must measure the window's bounds at one backing scale", () => {
	const bounds = { X: 10, Y: 20, Width: 1380, Height: 900 };
	assert.equal(frameMatchesWindow({ width: 1380, height: 900 }, bounds), 1);
	assert.equal(frameMatchesWindow({ width: 2760, height: 1800 }, bounds), 2);
	assert.equal(frameMatchesWindow({ width: 2761, height: 1799 }, bounds), 2);
	// Mixed scales, the whole display, a shadowed or truncated frame: refused.
	assert.equal(frameMatchesWindow({ width: 2760, height: 900 }, bounds), null);
	assert.equal(frameMatchesWindow({ width: 3024, height: 1964 }, bounds), null);
	assert.equal(frameMatchesWindow({ width: 2900, height: 1940 }, bounds), null);
	assert.equal(frameMatchesWindow({ width: 1, height: 1 }, bounds), null);
	assert.equal(frameMatchesWindow({ width: 1380, height: 900 }, null), null);
	assert.equal(
		frameMatchesWindow({ width: 1380, height: 900 }, { Width: 0, Height: 0 }),
		null,
	);
	assert.equal(
		SCREENCAPTURE_METHOD,
		"screencapture -l (real vibrancy, pending Mac measurement)",
	);
	const source = readFileSync(HARNESS, "utf8");
	assert.doesNotMatch(source, /"screencapture -x -o -l[^"]*: real vibrancy"/);
});

/* ---------------------------------------------------------------- CLI */

test("--negative-control runs every refusal against the real guards and exits 0", () => {
	const run = runHarness(["--negative-control"]);
	assert.equal(run.status, 0, run.all);
	assert.doesNotMatch(run.stdout, /^FAIL/m);
	assert.match(run.stdout, /negative control: (\d+)\/\1 refused/);
	for (const name of [
		"symlink to the operator's profile",
		"nested inside",
		"contains the operator's",
		"--window-mode normal",
		"focused=true",
		"port 1111",
		"relative app path",
		"--app together with --app-zip",
		"relative --app-zip",
		"--app-zip that is not a .zip",
		"--app-zip that does not exist",
		"--app-zip that is a directory",
		"an extracted zip with no .app",
		"an extracted zip with two .app bundles",
		"predates S1",
	])
		assert.match(
			run.stdout,
			new RegExp(
				`PASS refuses: .*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
			),
		);
});

test("--dry-run prints the plan with the token redacted and spawns nothing", () => {
	const app = fakeApp("DryRun");
	const rigRoot = join(TREE, "dry-rig");
	const run = runHarness([
		"--app",
		app,
		"--out",
		join(TREE, "dry-out"),
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--scene",
		"library",
		"--dry-run",
	]);
	assert.equal(run.status, 0, run.all);
	const plan = JSON.parse(run.stdout.slice(run.stdout.indexOf("{")));
	assert.equal(plan.env.LOCAL_OPERATOR_DESKTOP_TOKEN, "<redacted>");
	assert.equal(
		plan.backend.serve.env.LOCAL_OPERATOR_DESKTOP_TOKEN,
		"<redacted>",
	);
	assert.equal(plan.command, join(app, "Contents", "MacOS", "Local Operator"));
	assert.ok(!plan.argv.includes("--"));
	assert.ok(
		!Object.keys(plan.env).some(
			(k) =>
				k.startsWith("CMUX_") ||
				k.startsWith("LOP_") ||
				k === "NODE_OPTIONS" ||
				k === "LOCAL_OPERATOR_FAKE_LEAK",
		),
	);
	assert.deepEqual(plan.frames, ["library-dark.png", "library-light.png"]);
	assert.ok(
		!existsSync(rigRoot) || readdirSync(rigRoot).length === 0,
		"no rig was made",
	);
});

it("stale frame: two scenes photographed to the same bytes fail the run (exit 1), naming both", async () => {
	const app = fakeApp("SameFrame", { sameFrame: true });
	const rigRoot = join(TREE, "same-rig");
	const out = join(TREE, "same-out");
	const seed = join(TREE, "same-seed");
	mkdirSync(join(seed, "asks"), { recursive: true });
	writeFileSync(join(seed, "config.yml"), "synthetic: true\n");
	const run = await runHarnessAsync([
		"--app",
		app,
		"--out",
		out,
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--seed-config",
		seed,
		"--session",
		"ce618964c88e",
		"--scene",
		"conversation",
		"--scene",
		"files",
		"--theme",
		"dark",
	]);
	trackPids(rigOf(rigRoot));
	assert.equal(run.status, 1, run.all);
	assert.match(
		run.all,
		/frames conversation-dark and files-dark are byte-identical \(sha256 [0-9a-f]{64}\)/,
	);
	const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
	assert.notEqual(receipt.verdict, "captured");
	assert.equal(receipt.exit, 1);
});

it("library provenance: a LOCAL first row fails the run (exit 1) with the judged subset in the receipt", async () => {
	const app = fakeApp("LocalLibrary");
	const rigRoot = join(TREE, "locallib-rig");
	const out = join(TREE, "locallib-out");
	const seed = join(TREE, "locallib-seed");
	mkdirSync(seed, { recursive: true });
	writeFileSync(join(seed, "config.yml"), "synthetic: true\n");
	// The fake daemon serves this row instead of its default peer row.
	writeFileSync(
		join(seed, "fake-library.json"),
		JSON.stringify({
			id: "la_00000000000000bb",
			ref: { type: "path", path: "/Users/rig/report.pdf" },
			origin: "mentioned",
			remote: null,
		}),
	);
	const run = await runHarnessAsync([
		"--app",
		app,
		"--out",
		out,
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--seed-config",
		seed,
		"--scene",
		"library",
		"--theme",
		"dark",
	]);
	trackPids(rigOf(rigRoot));
	assert.equal(run.status, 1, run.all);
	assert.match(
		run.all,
		/library provenance: library row la_00000000000000bb is not a peer row \(remote is null\)/,
	);
	const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
	assert.equal(receipt.exit, 1);
	assert.deepEqual(receipt.libraryProvenance, {
		assetId: "la_00000000000000bb",
		remote: false,
		localPath: true,
		source: "mentioned",
		pass: false,
		problem:
			"library row la_00000000000000bb is not a peer row (remote is null)",
	});
	// S1: a boolean, never the absolute local path, anywhere in the receipt.
	assert.ok(
		!readFileSync(join(out, "receipt.json"), "utf8").includes("/Users/rig"),
	);
	// NEW (release owner): the run's known measurement limits, by scene.
	assert.deepEqual(
		receipt.limits.map((l) => l.id),
		["selectors-fixture-proven"],
	);
});

test("receipt limits: each run lists exactly the known measurement limits its scenes hit", () => {
	const ids = (scenes) => receiptLimits(scenes).map((l) => l.id);
	assert.deepEqual(ids(["file-preview"]), [
		"files-paging-caption",
		"files-attachments-only",
		"preview-first-screen",
		"preview-no-decode-wait",
		"selectors-fixture-proven",
	]);
	assert.deepEqual(ids(["files"]), [
		"files-paging-caption",
		"files-attachments-only",
		"selectors-fixture-proven",
	]);
	assert.deepEqual(ids(["library"]), ["selectors-fixture-proven"]);
	assert.deepEqual(ids(["conversation", "canvas"]), []);
	for (const limit of receiptLimits(SCENES)) {
		assert.deepEqual(Object.keys(limit), ["id", "text"]);
		assert.ok(limit.text.length > 0 && limit.text.length <= 200, limit.id);
	}
	// Every scene a limit names is a real scene.
	for (const limit of MEASUREMENT_LIMITS)
		for (const scene of limit.scenes) assert.ok(SCENES.includes(scene));
});

it("isolated: our own lop serve + the fake app -> every frame, a receipt, no token leak, nothing left running", async () => {
	const app = fakeApp("Isolated", { ignoreTerm: true });
	const rigRoot = join(TREE, "iso-rig");
	const out = join(TREE, "iso-out");
	const seed = join(TREE, "iso-seed");
	mkdirSync(join(seed, "asks"), { recursive: true });
	writeFileSync(join(seed, "config.yml"), "synthetic: true\n");
	const run = await runHarnessAsync([
		"--app",
		app,
		"--out",
		out,
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--seed-config",
		seed,
		"--session",
		"ce618964c88e",
		"--scene",
		"conversation",
		"--scene",
		"files",
		"--theme",
		"dark,light",
	]);
	const rig = rigOf(rigRoot);
	trackPids(rig);
	assert.equal(run.status, 0, run.all);
	for (const frame of [
		"conversation-dark",
		"files-dark",
		"conversation-light",
		"files-light",
	])
		assert.deepEqual(
			pngSize(readFileSync(join(out, `${frame}.png`))),
			{ width: 1, height: 1 },
			frame,
		);
	const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
	assert.equal(receipt.verdict, "captured");
	assert.equal(receipt.frames.length, 4);
	assert.ok(receipt.frames.every((f) => f.method === CAPTUREPAGE_METHOD));
	assert.equal(receipt.reap.app.clean, true, JSON.stringify(receipt.reap));
	assert.equal(
		receipt.reap.app.escalated,
		true,
		"the fake ignores SIGTERM, so the reap had to escalate",
	);
	assert.ok(
		receipt.reap.app.reaped >= 1,
		"the re-parented helper was found by its profile and killed",
	);
	assert.equal(receipt.reap.serve.clean, true);
	// The standby runtime ran in its OWN process group: only the config-root
	// sweep / recorded descendants can reach it, and they did.
	assert.equal(receipt.reap.lop.clean, true, JSON.stringify(receipt.reap.lop));
	assert.equal(
		alive(
			Number(readFileSync(join(rig, "config", "fake-standby.pid"), "utf8")),
		),
		false,
		"the standby runtime was reaped",
	);
	// The daemon: scratch HOME and config root, a non-1111 port, the seed copied in.
	const served = JSON.parse(
		readFileSync(join(rig, "config", "fake-serve-seen.json"), "utf8"),
	);
	assert.equal(served.home, join(rig, "home"));
	assert.equal(served.config, join(rig, "config"));
	assert.notEqual(served.port, 1111);
	assert.equal(served.tmpdir, join(rig, "tmp"));
	assert.equal(served.gitConfigSystem, "/dev/null");
	assert.equal(served.gitTerminalPrompt, "0");
	assert.equal(served.ghConfigDir, join(rig, "home", ".gh"));
	assert.ok(
		served.configEntries.includes("config.yml"),
		"the synthetic seed was copied before serve started",
	);
	// The app: the SAME token as the daemon, via env only; scratch HOME; cwd = rig.
	const seen = JSON.parse(
		readFileSync(join(rig, "fake-app-seen.json"), "utf8"),
	);
	assert.equal(seen.tokenSha, served.tokenSha);
	assert.ok(seen.tokenSha, "a token was minted");
	assert.equal(seen.attachUrl, `http://127.0.0.1:${served.port}`);
	assert.equal(seen.home, join(rig, "home"));
	assert.equal(seen.cwd, rig);
	assert.ok(
		!seen.envKeys.some(
			(k) =>
				k.startsWith("CMUX_") ||
				k.startsWith("LOP_") ||
				k === "NODE_OPTIONS" ||
				k === "ELECTRON_RUN_AS_NODE" ||
				k === "LOCAL_OPERATOR_FAKE_LEAK",
		),
		seen.envKeys.join(","),
	);
	assert.ok(
		seen.argv.includes(MOCK_KEYCHAIN_SWITCH) && !seen.argv.includes("--"),
	);
	// The token is nowhere a reader looks: stdout, stderr, receipt, logs, argv.
	const sha = (text) => createHash("sha256").update(text).digest("hex");
	for (const word of [
		...run.all.split(/\s+/),
		...JSON.stringify(receipt).split(/[\s",]+/),
		...seen.argv,
	])
		assert.notEqual(sha(word), seen.tokenSha, "the token leaked");
	for (const log of readdirSync(join(out, "logs"))) {
		for (const word of readFileSync(join(out, "logs", log), "utf8").split(
			/\s+/,
		))
			assert.notEqual(sha(word), seen.tokenSha, `the token leaked into ${log}`);
	}
	// Nothing survives: the app, its re-parented helper, the daemon.
	assert.equal(
		alive(Number(readFileSync(join(rig, "fake-app.pid"), "utf8"))),
		false,
	);
	assert.equal(
		alive(Number(readFileSync(join(rig, "fake-child.pid"), "utf8"))),
		false,
	);
	assert.equal(alive(served.pid), false);
});

it("an app that announces a normal window is aborted and reaped", async () => {
	const app = fakeApp("Normal", { reportMode: "normal" });
	const rigRoot = join(TREE, "normal-rig");
	const run = await runHarnessAsync([
		"--app",
		app,
		"--out",
		join(TREE, "normal-out"),
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
	]);
	const rig = rigOf(rigRoot);
	trackPids(rig);
	assert.equal(run.status, 1, run.all);
	assert.match(run.all, /resolved window mode "normal"/);
	assert.equal(
		alive(Number(readFileSync(join(rig, "fake-app.pid"), "utf8"))),
		false,
	);
	assert.equal(
		alive(Number(readFileSync(join(rig, "fake-child.pid"), "utf8"))),
		false,
	);
});

it("an app whose window takes focus, or whose step fails, is aborted before any frame", async () => {
	for (const [name, behaviour, why] of [
		["Focused", { focused: true }, /took focus/],
		["StepFails", { failVerb: "setTheme" }, /setTheme\) failed/],
		["WrongSession", { activeSessionId: "aaaaaaaaaaaa" }, /not --session/],
	]) {
		const app = fakeApp(name, behaviour);
		const rigRoot = join(TREE, `${name}-rig`);
		const out = join(TREE, `${name}-out`);
		const run = await runHarnessAsync([
			"--app",
			app,
			"--out",
			out,
			"--rig-root",
			rigRoot,
			"--capture",
			"capturepage",
			"--lop",
			fakeLop(),
			"--session",
			"ce618964c88e",
		]);
		const rig = rigOf(rigRoot);
		trackPids(rig);
		assert.equal(run.status, 1, `${name}: ${run.all}`);
		assert.match(run.all, why, name);
		assert.ok(
			!readdirSync(out).some((f) => f.endsWith(".png")),
			`${name}: no frame claims a state that failed`,
		);
		assert.equal(
			alive(Number(readFileSync(join(rig, "fake-child.pid"), "utf8"))),
			false,
			name,
		);
	}
});

it("attach: an env-governed daemon is BLOCKED (exit 3) and no app is launched; a claimed one attaches", async () => {
	// A fake daemon on a free port, with a serve record beside it.
	const lop = fakeLop();
	const cfg = join(TREE, "attach-daemon-cfg");
	const port = 20000 + Math.floor(Math.random() * 20000);
	const daemon = spawn(
		lop,
		["serve", "--host", "127.0.0.1", "--port", String(port)],
		{
			// The claimed record's key is the token the harness attaches with, so
			// the Library provenance read-back (an authorized GET) can answer.
			env: {
				PATH: process.env.PATH,
				LOCAL_OPERATOR_CONFIG_DIR: cfg,
				LOCAL_OPERATOR_DESKTOP_TOKEN: "synthetic-claim-key-0123456789",
			},
			stdio: "ignore",
		},
	);
	leftovers.push(daemon.pid);
	try {
		for (
			let i = 0;
			i < 50 && !existsSync(join(cfg, "fake-serve-seen.json"));
			i++
		)
			await new Promise((r) => setTimeout(r, 100));
		await new Promise((r) => setTimeout(r, 200));
		const records = join(TREE, "attach-records");
		mkdirSync(records, { recursive: true });
		const record = (fields) =>
			writeFileSync(
				join(records, "serve.json"),
				JSON.stringify({ pid: daemon.pid, port, ...fields }),
			);

		record({ desktop: true, claim_key: "" });
		const app = fakeApp("Attach");
		const blockedRig = join(TREE, "attach-blocked-rig");
		const blocked = await runHarnessAsync([
			"--app",
			app,
			"--out",
			join(TREE, "attach-blocked-out"),
			"--rig-root",
			blockedRig,
			"--capture",
			"capturepage",
			"--backend",
			"attach",
			"--backend-url",
			`http://127.0.0.1:${port}`,
			"--serve-record-dir",
			records,
		]);
		assert.equal(blocked.status, 3, blocked.all);
		assert.ok(
			blocked.all.includes(envGovernedBlockedMessage(port)),
			blocked.all,
		);
		// Raised after the rig exists, yet still reads as BLOCKED, not a run
		// failure (QA r1 nit).
		assert.doesNotMatch(blocked.all, /FAILED:|\bfailed:/);
		assert.match(blocked.all, /\[mac-proof\] blocked/);
		assert.ok(
			!existsSync(join(rigOf(blockedRig), "fake-app-seen.json")),
			"no app was launched",
		);

		record({ desktop: true, claim_key: "synthetic-claim-key-0123456789" });
		const claimedRig = join(TREE, "attach-claimed-rig");
		const claimedOut = join(TREE, "attach-claimed-out");
		const claimed = await runHarnessAsync([
			"--app",
			app,
			"--out",
			claimedOut,
			"--rig-root",
			claimedRig,
			"--capture",
			"capturepage",
			"--backend",
			"attach",
			"--backend-url",
			`http://127.0.0.1:${port}`,
			"--serve-record-dir",
			records,
			"--scene",
			"library",
			"--theme",
			"dark",
		]);
		const rig = rigOf(claimedRig);
		trackPids(rig);
		assert.equal(claimed.status, 0, claimed.all);
		// The Library frame's row was read back as a PEER row, and recorded.
		assert.deepEqual(
			JSON.parse(readFileSync(join(claimedOut, "receipt.json"), "utf8"))
				.libraryProvenance,
			{
				assetId: "la_00000000000000aa",
				remote: true,
				localPath: false,
				source: "generated",
				pass: true,
			},
		);
		// S1: the peer's device id/name never reach the (public) receipt.
		const claimedReceipt = readFileSync(
			join(claimedOut, "receipt.json"),
			"utf8",
		);
		assert.ok(!claimedReceipt.includes('"Owner"'), "no device name");
		assert.ok(!claimedReceipt.includes('"d1"'), "no device id");
		const seen = JSON.parse(
			readFileSync(join(rig, "fake-app-seen.json"), "utf8"),
		);
		assert.equal(
			seen.tokenSha,
			createHash("sha256")
				.update("synthetic-claim-key-0123456789")
				.digest("hex"),
		);
		assert.ok(
			!claimed.all.includes("synthetic-claim-key"),
			"the key never reaches stdout",
		);
		assert.ok(
			!readFileSync(join(claimedOut, "receipt.json"), "utf8").includes(
				"synthetic-claim-key",
			),
		);
		assert.equal(
			alive(daemon.pid),
			true,
			"attach never stops the daemon it attached to",
		);
	} finally {
		trackPids(join(TREE, "none"), cfg);
		daemon.kill("SIGKILL");
	}
});

test("seed and config-root refusals: credentials in a seed, a config root inside ~/.local-operator", () => {
	const app = fakeApp("Refuse");
	const seed = join(TREE, "refuse-seed");
	mkdirSync(join(seed, "network"), { recursive: true });
	writeFileSync(join(seed, "network", "credentials"), "x");
	const dirty = runHarness([
		"--app",
		app,
		"--out",
		join(TREE, "refuse-out"),
		"--rig-root",
		join(TREE, "refuse-rig"),
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--seed-config",
		seed,
	]);
	assert.equal(dirty.status, 2, dirty.all);
	assert.match(dirty.all, /credential material.*network\/credentials/);

	const home = join(TREE, "refuse-home");
	const inside = join(home, ".local-operator", "rig-device");
	mkdirSync(inside, { recursive: true });
	const config = runHarness(
		[
			"--app",
			app,
			"--out",
			join(TREE, "refuse-out2"),
			"--rig-root",
			join(TREE, "refuse-rig2"),
			"--capture",
			"capturepage",
			"--lop",
			fakeLop(),
			"--backend-config-root",
			inside,
		],
		{ HOME: home },
	);
	assert.equal(config.status, 2, config.all);
	assert.match(config.all, /--backend-config-root .*inside it/);
	assert.ok(
		!existsSync(join(TREE, "refuse-rig2")) ||
			readdirSync(join(TREE, "refuse-rig2")).length === 0,
		"refused before a rig was made",
	);
});

/* ------------------------------------------- read-only daemon, relay, config root */

test("the daemon client: its allowlist holds no prompt/send/engage path, and it refuses one before sending", async () => {
	// The reason (docs/mac-proof-capture.md): on core origin/main
	// network/types.py `net_session_engage` needs only "view", so a read-role rig
	// device could start a runtime on the owner. The harness reads; it never acts.
	for (const route of DAEMON_ROUTES) {
		assert.equal(route.method, "GET", route.path);
		assert.doesNotMatch(route.path, FORBIDDEN_DAEMON_PATH, route.path);
		assert.doesNotMatch(
			route.path,
			/prompt|send|engage|message|runs?|resume/i,
			route.path,
		);
	}
	assert.deepEqual(DAEMON_ROUTES.map((r) => r.path).sort(), [
		"/health",
		"/v1/desktop/asks",
		"/v1/desktop/library/assets",
		"/v1/desktop/library/assets/{id}",
		"/v1/desktop/notifications/{id}",
		"/v1/desktop/sessions",
		"/v1/desktop/sessions/{id}/files",
	]);
	// The --seed read-backs: the aggregate with no query, one notification id
	// (one segment, core's own id shape), nothing past it.
	assert.equal(daemonRequestProblem("GET", "/v1/desktop/asks"), null);
	assert.equal(
		daemonRequestProblem("GET", "/v1/desktop/notifications/n_macproofdetailaa"),
		null,
	);
	for (const [method, path] of [
		["GET", "/v1/desktop/asks?session_id=fa1902000001"],
		["POST", "/v1/desktop/asks"],
		["GET", "/v1/desktop/notifications/n_macproofdetailaa/read"],
		["GET", "/v1/desktop/notifications/n_short"],
		["GET", "/v1/desktop/notifications/N_MACPROOFDETAILAA"],
		["GET", "/v1/desktop/notifications/ask:fa1902000001:a-1902"],
		["GET", "/v1/desktop/notifications/"],
		["GET", "/v1/desktop/notifications"],
		["PATCH", "/v1/desktop/notifications/n_macproofdetailaa"],
		["GET", "/v1/desktop/notifications/n_macproofdetailaa?x=1"],
	])
		assert.ok(
			daemonRequestProblem(method, path),
			`${method} ${path} must be refused`,
		);
	assert.equal(daemonRequestProblem("GET", "/health"), null);
	assert.equal(
		daemonRequestProblem(
			"GET",
			"/v1/desktop/sessions?include_peers=true&limit=500",
		),
		null,
	);
	for (const [method, path] of [
		["GET", "/v1/desktop/sessions/ce618964c88e/engage"],
		["POST", "/v1/desktop/sessions/ce618964c88e/prompt"],
		["POST", "/v1/desktop/sessions/ce618964c88e/messages"],
		["POST", "/v1/desktop/sessions/ce618964c88e/resume"],
		["GET", "/v1/desktop/runs"],
		["POST", "/v1/desktop/sessions"],
		["GET", "/v1/desktop/sessions?q=x"],
		["GET", "/v1/desktop/config"],
	])
		assert.ok(
			daemonRequestProblem(method, path),
			`${method} ${path} must be refused`,
		);
	// And the client itself throws before a byte leaves: a counting server sees nothing.
	const lop = fakeLop();
	const cfg = join(TREE, "client-cfg");
	const port = 20000 + Math.floor(Math.random() * 20000);
	const daemon = spawn(
		lop,
		["serve", "--host", "127.0.0.1", "--port", String(port)],
		{
			env: { PATH: process.env.PATH, LOCAL_OPERATOR_CONFIG_DIR: cfg },
			stdio: "ignore",
		},
	);
	leftovers.push(daemon.pid);
	try {
		for (
			let i = 0;
			i < 50 &&
			!(await daemonRequest(`http://127.0.0.1:${port}`, "GET", "/health"));
			i++
		)
			await new Promise((r) => setTimeout(r, 100));
		await assert.rejects(
			daemonRequest(
				`http://127.0.0.1:${port}`,
				"POST",
				"/v1/desktop/sessions/ce618964c88e/prompt",
			),
			Refusal,
		);
		const seen = JSON.parse(
			readFileSync(join(cfg, "fake-serve-requests.json"), "utf8"),
		);
		assert.ok(
			seen.every((r) => r === "GET /health"),
			seen.join(","),
		);
	} finally {
		trackPids(join(TREE, "none"), cfg);
		daemon.kill("SIGKILL");
	}
});

test("validateOptions: themes are an own-property allowlist, repeats refused; config-root needs its root", () => {
	const base = [
		"--app",
		"/x.app",
		"--out",
		"/tmp/o",
		"--capture",
		"capturepage",
	];
	for (const theme of [
		"constructor",
		"toString",
		"__proto__",
		"hasOwnProperty",
	])
		assert.throws(
			() => validateOptions(parseArgs([...base, "--theme", theme])),
			(e) => e instanceof Refusal && /unknown --theme/.test(e.message),
			theme,
		);
	assert.throws(
		() => validateOptions(parseArgs([...base, "--theme", "dark,dark"])),
		(e) => e instanceof Refusal && /--theme is repeated/.test(e.message),
	);
	assert.doesNotThrow(() =>
		validateOptions(parseArgs([...base, "--theme", "light,dark"])),
	);
	// Review r1 R1-8: a Refusal naming the flag, not a TypeError from join(null).
	assert.throws(
		() => validateOptions(parseArgs([...base, "--backend", "config-root"])),
		(e) =>
			e instanceof Refusal && /needs --backend-config-root/.test(e.message),
	);
	const run = runHarness([
		"--app",
		fakeApp("CrNoRoot"),
		"--out",
		join(TREE, "cr-noroot-out"),
		"--capture",
		"capturepage",
		"--backend",
		"config-root",
	]);
	assert.equal(run.status, 2, run.all);
	assert.match(run.all, /needs --backend-config-root/);
	assert.doesNotMatch(run.all, /must be of type string/);
});

test("the daemon client never leaves the configured backend's origin", async () => {
	// Review r1 R1-9 / QA r1 Q5-1: an absolute URL, `//host` or `/\\host` used to
	// pass the pathname allowlist and go to that host with the bearer token.
	for (const p of [
		"http://10.255.255.1:9/health",
		"https://example.com/health",
		"//10.255.255.1/health",
		"/\\10.255.255.1/health",
		"health",
		"",
	])
		assert.match(
			daemonRequestProblem("GET", p),
			/only a path on the configured loopback backend/,
			JSON.stringify(p),
		);
	assert.equal(daemonRequestProblem("GET", "/health"), null);
	// The client throws before any connection is attempted (a counting server
	// on the "other" origin would see nothing; here no socket is opened at all).
	const listener = createServer((socket) => socket.destroy());
	let hits = 0;
	listener.on("connection", () => hits++);
	await new Promise((r) => listener.listen(0, "127.0.0.1", r));
	const other = `http://127.0.0.1:${listener.address().port}`;
	try {
		await assert.rejects(
			daemonRequest("http://127.0.0.1:9", "GET", `${other}/health`),
			Refusal,
		);
		await assert.rejects(
			daemonRequest(
				"http://127.0.0.1:9",
				"GET",
				`//127.0.0.1:${listener.address().port}/health`,
			),
			Refusal,
		);
		assert.equal(hits, 0);
	} finally {
		listener.close();
	}
});

test("the stray-pid backstop kills only rig-matched pids, and a group only when its leader is one", async () => {
	// Review r1 R1-10: every swept or recorded pid also got `kill(-pid)`, widening
	// one stray into its whole group. Here a NON-rig leader L owns a group with a
	// non-rig member M and a rig member R (cwd inside the rig). Passing [L, R]
	// must kill R alone; L (not rig-matched) and M (shares the pgid) survive.
	const rig = join(TREE, "backstop-rig", "mac-proof-zzzzzz");
	const elsewhere = join(TREE, "backstop-elsewhere");
	mkdirSync(rig, { recursive: true });
	mkdirSync(elsewhere, { recursive: true });
	const pidsFile = join(elsewhere, "pids.json");
	const keep = `setTimeout(()=>process.exit(0),${FIXTURE_CAP_MS});setInterval(()=>{},1000)`;
	const leaderSrc = `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const keep = ${JSON.stringify(keep)};
const m = spawn(process.execPath, ["-e", keep], { cwd: ${JSON.stringify(elsewhere)}, stdio: "ignore" });
const r = spawn(process.execPath, ["-e", keep], { cwd: ${JSON.stringify(rig)}, stdio: "ignore" });
fs.writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify({ m: m.pid, r: r.pid }));
${PARENT_WATCH}`;
	const leader = spawn(process.execPath, ["-e", leaderSrc], {
		cwd: elsewhere,
		detached: true,
		stdio: "ignore",
	});
	leftovers.push(leader.pid);
	let pids = null;
	for (let i = 0; i < 100 && !pids; i++) {
		if (existsSync(pidsFile)) pids = JSON.parse(readFileSync(pidsFile, "utf8"));
		else await new Promise((r) => setTimeout(r, 50));
	}
	assert.ok(pids, "fixture started");
	leftovers.push(pids.m, pids.r);
	try {
		const matches = rigMatcher({ rig });
		assert.equal(processFacts(pids.r).pgid, leader.pid, "R shares L's group");
		assert.equal(processFacts(pids.m).pgid, leader.pid, "M shares L's group");
		assert.equal(matches(processFacts(pids.r)), true);
		assert.equal(matches(processFacts(leader.pid)), false);
		const left = await killRigMatched([leader.pid, pids.r], matches);
		assert.deepEqual(left, []);
		assert.equal(alive(pids.r), false, "the rig process is killed");
		assert.equal(alive(leader.pid), true, "a non-rig leader is not killed");
		assert.equal(
			alive(pids.m),
			true,
			"a non-rig process sharing the group survives",
		);
		// The env and argv rules: HOME inside the rig, or the run's config root.
		assert.equal(
			matches({ cwd: "/", text: `\0node\0HOME=${rig}/home\0` }),
			true,
		);
		assert.equal(
			matches({ cwd: "/", text: `\0node\0HOME=${rig}-other/home\0` }),
			false,
			"a sibling path that merely starts with the rig's name is not the rig",
		);
		assert.equal(
			rigMatcher({ rig, configRoot: "/d/cfg" })({
				cwd: "/",
				text: "\0LOCAL_OPERATOR_CONFIG_DIR=/d/cfg\0",
			}),
			true,
		);
		assert.equal(matches(null), false);
	} finally {
		for (const pid of [pids?.m, pids?.r, leader.pid])
			try {
				process.kill(pid, "SIGKILL");
			} catch {}
	}
});

test("relay ownership: every listener on the port must be one of the given pids", async () => {
	const server = createServer();
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const { port } = server.address();
	try {
		assert.equal(portListenerOwned(port, [process.pid]), true);
		assert.equal(portListenerOwned(port, [process.ppid]), false);
	} finally {
		await new Promise((r) => server.close(r));
	}
	assert.equal(
		portListenerOwned(port, [process.pid]),
		false,
		"nothing listens now",
	);
});

test("config-root: a port someone else already listens on is refused before the rig exists", async () => {
	// Review r1 R1-5: a foreign listener on network.port made the loop think the
	// relay was up while ours died with EADDRINUSE.
	const squatter = createServer();
	await new Promise((r) => squatter.listen(0, "127.0.0.1", r));
	const { port } = squatter.address();
	const device = rigDevice(
		"cr-busyport",
		`values:\n  network:\n    port: ${port}\n`,
	);
	const rigRoot = join(TREE, "cr-busyport-rig");
	try {
		const run = spawnSync(
			process.execPath,
			[
				HARNESS,
				"--app",
				fakeApp("CrBusyPort"),
				"--out",
				join(TREE, "cr-busyport-out"),
				"--rig-root",
				rigRoot,
				"--capture",
				"capturepage",
				"--lop",
				fakeLop(),
				"--backend-config-root",
				device.config,
				"--session",
				"ce618964c88e",
			],
			{ encoding: "utf8", timeout: 60_000, env: harnessEnv() },
		);
		const all = `${run.stdout}\n${run.stderr}`;
		assert.equal(run.status, 2, all);
		assert.match(all, new RegExp(`already listens on 127\\.0\\.0\\.1:${port}`));
		assert.ok(
			!existsSync(rigRoot) || readdirSync(rigRoot).length === 0,
			"no rig was made",
		);
		assert.ok(
			!existsSync(join(device.config, "fake-relay-seen.json")),
			"no relay spawned",
		);
	} finally {
		squatter.close();
	}
});

test("a rig root that is a dangling symlink into an operator root refuses with exit 2 (QA r1 Q1-1)", () => {
	const home = join(TREE, "dangle-cli-home");
	mkdirSync(home, { recursive: true });
	const target = join(home, ".config", "Local Operator");
	const link = join(TREE, "dangle-cli-link");
	symlinkSync(target, link);
	for (const extra of [[], ["--dry-run"]]) {
		const run = runHarness(
			[
				"--app",
				fakeApp("DangleCli"),
				"--out",
				join(TREE, "dangle-cli-out"),
				"--rig-root",
				link,
				"--capture",
				"capturepage",
				"--lop",
				fakeLop(),
				...extra,
			],
			{ HOME: home },
		);
		assert.equal(run.status, 2, run.all);
		assert.match(run.all, /refused: .*operator's/);
		assert.doesNotMatch(run.all, /ENOENT|\n\s+at /);
	}
	assert.equal(existsSync(target), false, "the operator dir was not created");
});

it("a rig root and --out containing spaces capture normally (review r1 R1-2)", async () => {
	const rigRoot = join(TREE, "proof runs", "rig root");
	const out = join(TREE, "proof runs", "out dir");
	const run = await runHarnessAsync([
		"--app",
		fakeApp("Spaced"),
		"--out",
		out,
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--scene",
		"library",
	]);
	const rig = rigOf(rigRoot);
	trackPids(rig);
	assert.equal(run.status, 0, run.all);
	for (const theme of ["dark", "light"])
		assert.deepEqual(pngSize(readFileSync(join(out, `library-${theme}.png`))), {
			width: 1,
			height: 1,
		});
	// Nothing was written beside the spaced directory (the old truncation target).
	assert.equal(existsSync(join(TREE, "proof")), false);
	for (const [name, pid] of Object.entries(fixturePids(rig)))
		assert.equal(alive(pid), false, `${name} (pid ${pid}) survived`);
});

test("lop is only ever run as `serve` or `network serve`", () => {
	assert.equal(
		lopArgvProblem(["serve", "--host", "127.0.0.1", "--port", "4123"]),
		null,
	);
	assert.equal(lopArgvProblem(["network", "serve", "--port", "4197"]), null);
	for (const bad of [
		["network", "init"],
		["network", "install"],
		["network", "start"],
		["network", "restart"],
		["serve", "--host", "0.0.0.0", "--port", "1"],
		["session", "send", "x"],
	])
		assert.ok(lopArgvProblem(bad), bad.join(" "));
});

test("network.port: only values.network.port, as lop writes and core reads; anything else refuses", () => {
	// The layout `lop config edit network.port 14097` writes (core config.py
	// reads parsed["values"]; settings_io.py path ("network", "port")).
	const lopWritten = "values:\n  network:\n    port: 14097\n";
	assert.equal(relayPortFromConfig(lopWritten), 14097);
	assert.equal(relayPortProblem(relayPortFromConfig(lopWritten)), null);
	assert.equal(
		relayPortFromConfig(
			"# rig device\nversion: 3\nvalues:\n  ui:\n    port: 9\n  network:\n    enabled: true\n    # the rig's relay\n    port: '4198' # rig\n    peers:\n      port: 4000\n  other: 1\nmeta:\n  port: 7\n",
		),
		4198,
		"comments, a quoted port, siblings and a deeper peers.port",
	);
	assert.equal(
		relayPortFromConfig('values:\r\n    network:\r\n        port: "14099"\r\n'),
		14099,
		"four-space indent, CRLF, double quotes",
	);
	// Refusals: nested 4097 is a real port, and still the operator's.
	assert.match(
		relayPortProblem(
			relayPortFromConfig("values:\n  network:\n    port: 4097\n"),
		),
		/4097/,
	);
	for (const [why, text] of [
		["top-level only (core ignores it)", "network:\n  port: 14097\n"],
		["values: with no network", "values:\n  ui:\n    theme: dark\n"],
		["network with no port", "values:\n  network:\n    enabled: true\n"],
		[
			"port under another parent",
			"values:\n  network:\n    peers:\n      port: 4000\n",
		],
		["port under values directly", "values:\n  port: 14097\n"],
		["dotted key", "values:\n  network.port: 14097\n"],
		["flow values", "values: {network: {port: 14097}}\n"],
		["flow network", "values:\n  network: {port: 14097}\n"],
		["anchor", "values:\n  network: &n\n    port: 14097\n"],
		["alias port", "values:\n  network:\n    port: *p\n"],
		["tab indentation", "values:\n\tnetwork:\n\t\tport: 14097\n"],
		[
			"duplicated values",
			"values:\n  ui: {}\nvalues:\n  network:\n    port: 14097\n",
		],
		[
			"duplicated network",
			"values:\n  network:\n    port: 14097\n  network:\n    port: 14098\n",
		],
		[
			"duplicated port",
			"values:\n  network:\n    port: 14097\n    port: 14098\n",
		],
		["document marker", "---\nvalues:\n  network:\n    port: 14097\n"],
		[
			"indent steps back",
			"values:\n    network:\n      port: 14097\n  ui: 1\n",
		],
		["port not decimal", "values:\n  network:\n    port: 14097x\n"],
		["port leading zero", "values:\n  network:\n    port: 014097\n"],
		["empty", ""],
	])
		assert.equal(relayPortFromConfig(text), null, why);
	assert.match(relayPortProblem(null), /network\.port/);
	assert.match(relayPortProblem(null), /values:/);
	assert.match(relayPortProblem(4097), /4097/);
	assert.equal(relayPortProblem(4197), null);
});

/** A prepared rig-device root: `<base>/config` with network.port, and `<base>/home`. */
function rigDevice(name, configYml) {
	const base = join(TREE, name);
	mkdirSync(join(base, "config"), { recursive: true });
	mkdirSync(join(base, "home"), { recursive: true });
	if (configYml !== null)
		writeFileSync(join(base, "config", "config.yml"), configYml);
	return { base, config: join(base, "config"), home: join(base, "home") };
}

it("config-root: relay on network.port, then serve, then the remote row; frames; every lop process reaped", async () => {
	const relayPort = 20000 + Math.floor(Math.random() * 20000);
	const device = rigDevice(
		"cr-ok",
		`values:\n  network:\n    port: ${relayPort}\n`,
	);
	writeFileSync(
		join(device.config, "fake-sessions.json"),
		JSON.stringify([{ id: "ce618964c88e", locality: "remote" }]),
	);
	const app = fakeApp("ConfigRoot");
	const rigRoot = join(TREE, "cr-ok-rig");
	const out = join(TREE, "cr-ok-out");
	const run = await runHarnessAsync([
		"--app",
		app,
		"--out",
		out,
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--backend-config-root",
		device.config,
		"--session",
		"ce618964c88e",
		"--scene",
		"conversation",
		"--theme",
		"dark",
		"--peer-wait",
		"30",
	]);
	const rig = rigOf(rigRoot);
	trackPids(rig, device.config);
	assert.equal(run.status, 0, run.all);
	const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
	assert.equal(receipt.backend.mode, "config-root");
	assert.equal(receipt.backend.relay.port, relayPort);
	assert.equal(receipt.backend.remoteSession.locality, "remote");
	assert.ok(
		receipt.backend.remoteSession.reads >= 3,
		"polled past the empty first reads",
	);
	const relay = JSON.parse(
		readFileSync(join(device.config, "fake-relay-seen.json"), "utf8"),
	);
	assert.deepEqual(relay.argv, [
		"network",
		"serve",
		"--port",
		String(relayPort),
	]);
	assert.equal(relay.home, device.home, "HOME is the root's sibling home");
	assert.equal(relay.tokenSha, null, "the relay never gets the desktop token");
	const served = JSON.parse(
		readFileSync(join(device.config, "fake-serve-seen.json"), "utf8"),
	);
	assert.equal(served.home, device.home);
	assert.equal(served.tmpdir, join(rig, "tmp"));
	assert.equal(served.ghConfigDir, join(device.home, ".gh"));
	const requests = JSON.parse(
		readFileSync(join(device.config, "fake-serve-requests.json"), "utf8"),
	);
	assert.ok(
		requests.every(
			(r) => r === "GET /health" || r.startsWith("GET /v1/desktop/sessions?"),
		),
		requests.join(","),
	);
	assert.ok(existsSync(join(out, "conversation-dark.png")));
	for (const pid of [
		relay.pid,
		served.pid,
		Number(readFileSync(join(device.config, "fake-standby.pid"), "utf8")),
	])
		assert.equal(alive(pid), false, `pid ${pid} survived`);
	assert.equal(receipt.reap.relay.clean, true);
	assert.equal(receipt.reap.lop.clean, true, JSON.stringify(receipt.reap.lop));
});

it("config-root: a session that never shows as remote fails the run before the app launches", async () => {
	const relayPort = 20000 + Math.floor(Math.random() * 20000);
	const device = rigDevice(
		"cr-miss",
		`values:\n  network:\n    port: ${relayPort}\n`,
	);
	writeFileSync(
		join(device.config, "fake-sessions.json"),
		JSON.stringify([{ id: "ce618964c88e", locality: "local" }]),
	);
	const rigRoot = join(TREE, "cr-miss-rig");
	const run = await runHarnessAsync([
		"--app",
		fakeApp("Miss"),
		"--out",
		join(TREE, "cr-miss-out"),
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--backend-config-root",
		device.config,
		"--session",
		"ce618964c88e",
		"--peer-wait",
		"4",
	]);
	const rig = rigOf(rigRoot);
	trackPids(rig, device.config);
	assert.equal(run.status, 1, run.all);
	assert.match(
		run.all,
		/did not appear as a remote row.*last seen: local.*not capturing/,
	);
	assert.ok(
		!existsSync(join(rig, "fake-app-seen.json")),
		"no app was launched",
	);
	assert.equal(
		alive(
			Number(readFileSync(join(device.config, "fake-standby.pid"), "utf8")),
		),
		false,
	);
});

test("config-root refusals happen before ANY lop process: port unset, 4097, real home, busy root", () => {
	const lop = fakeLop();
	const app = fakeApp("CrRefuse");
	const cases = [
		[
			"unset",
			rigDevice("cr-unset", "values:\n  network:\n    enabled: true\n"),
			[],
			/network\.port/,
		],
		["no config.yml", rigDevice("cr-none", null), [], /network\.port/],
		[
			// Core reads only `values:`; a top-level block leaves the relay on 4097.
			"top-level only",
			rigDevice("cr-toplevel", "network:\n  port: 4557\n"),
			[],
			/network\.port/,
		],
		[
			"4097",
			rigDevice("cr-4097", "values:\n  network:\n    port: 4097\n"),
			[],
			/4097/,
		],
		[
			"real home",
			rigDevice("cr-home", "values:\n  network:\n    port: 4555\n"),
			["--backend-home", os.userInfo().homedir],
			/real home/,
		],
	];
	for (const [name, device, extra, pattern] of cases) {
		const run = runHarness([
			"--app",
			app,
			"--out",
			join(TREE, `cr-out-${name}`),
			"--rig-root",
			join(TREE, `cr-rig-${name}`),
			"--capture",
			"capturepage",
			"--lop",
			lop,
			"--backend-config-root",
			device.config,
			...extra,
		]);
		assert.equal(run.status, 2, `${name}: ${run.all}`);
		assert.match(run.all, pattern, name);
		assert.ok(
			!existsSync(join(device.config, "fake-relay-seen.json")) &&
				!existsSync(join(device.config, "fake-serve-seen.json")),
			`${name}: no lop process ran`,
		);
	}
	// A root another process already runs on is refused, so the sweep can never kill it.
	const busy = rigDevice("cr-busy", "values:\n  network:\n    port: 4556\n");
	const squatter = spawn(process.execPath, ["-e", CAP_ONLY], {
		env: { PATH: process.env.PATH, LOCAL_OPERATOR_CONFIG_DIR: busy.config },
		stdio: "ignore",
	});
	leftovers.push(squatter.pid);
	try {
		const run = runHarness([
			"--app",
			app,
			"--out",
			join(TREE, "cr-out-busy"),
			"--rig-root",
			join(TREE, "cr-rig-busy"),
			"--capture",
			"capturepage",
			"--lop",
			lop,
			"--backend-config-root",
			busy.config,
		]);
		assert.equal(run.status, 2, run.all);
		assert.match(
			run.all,
			new RegExp(`already in use by pid\\(s\\) .*${squatter.pid}`),
		);
		assert.equal(alive(squatter.pid), true, "the refusal killed nothing");
	} finally {
		squatter.kill("SIGKILL");
	}
});

/* ------------------------------------------- interruption: SIGTERM and --timeout */

it("--timeout and SIGTERM mid-run both reap the app, its re-parented helper, the daemon and its standby", async () => {
	const lop = fakeLop();
	const app = fakeApp("Hang", { hang: true, ignoreTerm: true });
	const common = ["--app", app, "--capture", "capturepage", "--lop", lop];

	// 1. The timeout path: a wedged app, --timeout 6 (whole-run: it includes the daemon start, so the app is up well before it).
	const timeoutRoot = join(TREE, "hang-timeout-rig");
	const timedOut = await runHarnessAsync([
		...common,
		"--out",
		join(TREE, "hang-timeout-out"),
		"--rig-root",
		timeoutRoot,
		"--timeout",
		"6",
	]);
	const timeoutRig = rigOf(timeoutRoot);
	trackPids(timeoutRig);
	assert.equal(timedOut.status, 1, timedOut.all);
	assert.match(timedOut.all, /exceeded --timeout 6 s/);
	const timeoutPids = fixturePids(timeoutRig);
	assert.deepEqual(
		Object.keys(timeoutPids).sort(),
		["app", "reparented", "serve", "standby"],
		"every fixture started",
	);
	for (const [name, pid] of Object.entries(timeoutPids))
		assert.equal(alive(pid), false, `timeout: ${name} (pid ${pid}) survived`);

	// The receipt names the cause, not the knock-on "app exited" (QA r1 Q4-2).
	const timeoutReceipt = JSON.parse(
		readFileSync(join(TREE, "hang-timeout-out", "receipt.json"), "utf8"),
	);
	assert.match(timeoutReceipt.error, /exceeded --timeout 6 s/);
	assert.deepEqual(timeoutReceipt.endedBy, { timeoutS: 6 });

	// 2. The signal paths: SIGTERM, and SIGHUP (a closed terminal or dropped
	// ssh), which used to kill the harness with no teardown and leak the daemon
	// and its standby (QA r1 Q4-1, review r1 R1-4).
	for (const sig of ["SIGTERM", "SIGHUP"]) {
		const tag = sig.toLowerCase();
		const termRoot = join(TREE, `hang-${tag}-rig`);
		const termOut = join(TREE, `hang-${tag}-out`);
		mkdirSync(termRoot, { recursive: true });
		const harness = spawn(
			process.execPath,
			[
				HARNESS,
				...common,
				"--out",
				termOut,
				"--rig-root",
				termRoot,
				"--timeout",
				"60",
			],
			{
				env: harnessEnv(),
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		leftovers.push(harness.pid);
		let output = "";
		harness.stdout.on("data", (c) => {
			output += c;
		});
		harness.stderr.on("data", (c) => {
			output += c;
		});
		const exited = new Promise((done) =>
			harness.on("exit", (code, signal) => done({ code, signal })),
		);
		let pids = {};
		for (let i = 0; i < 200; i++) {
			const rigs = readdirSync(termRoot).filter((n) =>
				n.startsWith("mac-proof-"),
			);
			if (rigs.length === 1) {
				pids = fixturePids(join(termRoot, rigs[0]));
				if (Object.keys(pids).length === 4) break;
			}
			await new Promise((r) => setTimeout(r, 100));
		}
		trackPids(rigOf(termRoot));
		assert.deepEqual(
			Object.keys(pids).sort(),
			["app", "reparented", "serve", "standby"],
			output,
		);
		for (const [name, pid] of Object.entries(pids))
			assert.equal(alive(pid), true, `${name} is up before ${sig}`);
		harness.kill(sig);
		const { code, signal } = await exited;
		// Exit status 1 (not death by signal) proves the harness's own interruption
		// path ran the teardown rather than dying with the tree still up.
		assert.equal(signal, null, output);
		assert.equal(code, 1, output);
		assert.match(output, new RegExp(`interrupted by ${sig}`));
		// The re-parented helper and the standby carry only the fixture cap (no
		// parent watch), so for those two this is the harness's reap or nothing.
		for (const [name, pid] of Object.entries(pids))
			assert.equal(alive(pid), false, `${sig}: ${name} (pid ${pid}) survived`);
		const receipt = JSON.parse(
			readFileSync(join(termOut, "receipt.json"), "utf8"),
		);
		assert.equal(receipt.error, `interrupted by ${sig}`);
		assert.deepEqual(receipt.endedBy, { signal: sig });
		assert.equal(receipt.verdict, "failed");
		assert.ok(
			receipt.reap.serve && receipt.reap.lop,
			JSON.stringify(receipt.reap),
		);
	}
});

it("--timeout bounds the WHOLE run from harness start, not just the app phase", async () => {
	// A config-root run whose remote row never appears: --peer-wait 30 would
	// wait 30 s, but the whole-run --timeout 3 stops it first, before any app
	// launch (review r1 R1-6, QA r1 Q4-3; before, `--timeout 5` measured 16 s).
	const relayPort = 20000 + Math.floor(Math.random() * 20000);
	const device = rigDevice(
		"cr-wholerun",
		`values:\n  network:\n    port: ${relayPort}\n`,
	);
	const rigRoot = join(TREE, "cr-wholerun-rig");
	const out = join(TREE, "cr-wholerun-out");
	const began = Date.now();
	const run = await runHarnessAsync([
		"--app",
		fakeApp("WholeRun"),
		"--out",
		out,
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--backend-config-root",
		device.config,
		"--session",
		"ce618964c88e",
		"--scene",
		"conversation",
		"--theme",
		"dark",
		"--peer-wait",
		"30",
		"--timeout",
		"3",
	]);
	const elapsed = Date.now() - began;
	const rig = rigOf(rigRoot);
	trackPids(rig, device.config);
	assert.equal(run.status, 1, run.all);
	// Whichever pre-app phase it was in when the bound hit (on node2: the
	// remote-session wait); never the app phase.
	assert.match(run.all, /exceeded --timeout 3 s \((waiting|starting) /);
	assert.ok(!existsSync(join(rig, "fake-app.pid")), "no app was launched");
	// 3 s of work plus the reap (two 5 s group deadlines at most); far under 30.
	assert.ok(elapsed < 20_000, `took ${elapsed} ms`);
	const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
	assert.deepEqual(receipt.endedBy, { timeoutS: 3 });
	for (const [name, pid] of Object.entries(fixturePids(rig, device.config)))
		assert.equal(alive(pid), false, `${name} (pid ${pid}) survived`);
});

test("a child that cannot be spawned ends the run through the full teardown, not a crash", () => {
	// A non-executable --lop: spawn emits 'error' (EACCES). With no listener
	// that was an uncaught exception, so no receipt and none of the async reaps
	// (review r1 R1-4). Now it is a clean FAILED with a receipt naming it.
	const lop = join(TREE, "lop-not-executable");
	writeFileSync(lop, "#!/bin/sh\nexit 0\n");
	chmodSync(lop, 0o644);
	const out = join(TREE, "spawn-error-out");
	const run = runHarness([
		"--app",
		fakeApp("SpawnError"),
		"--out",
		out,
		"--rig-root",
		join(TREE, "spawn-error-rig"),
		"--capture",
		"capturepage",
		"--lop",
		lop,
		"--timeout",
		"20",
	]);
	assert.equal(run.status, 1, run.all);
	assert.doesNotMatch(run.all, /Uncaught|node:internal|\n\s+at /);
	assert.match(run.all, /FAILED: lop serve could not run: .*EACCES/);
	const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
	assert.match(receipt.error, /lop serve could not run: .*EACCES/);
	assert.equal(receipt.verdict, "failed");
});

/*
 * --app-zip: the Mac leg downloads a release zip instead of building. On Linux
 * the harness extracts with `unzip` (darwin: /usr/bin/ditto); the test zips a
 * fake `.app` with `zip -qry` (symlinks kept, like electron-builder's
 * `ditto -c -k`), so both tools must be on PATH or the end-to-end cases skip.
 */
const HAVE_ZIP_TOOLS =
	spawnSync("zip", ["-v"], { stdio: "ignore" }).status === 0 &&
	spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0;

/** Zip `entries` (names relative to `from`) into `zipPath`, keeping modes and symlinks. */
function zipTree(from, entries, zipPath) {
	const run = spawnSync("zip", ["-qry", zipPath, ...entries], {
		cwd: from,
		encoding: "utf8",
	});
	assert.equal(run.status, 0, run.stderr);
	return zipPath;
}

test("--app-zip: path refusals, one top-level .app, and exclusive with --app", () => {
	assert.match(appZipProblem("dl/x.zip"), /absolute/);
	assert.match(appZipProblem(join(TREE, "x.tar.gz")), /\.zip/);
	assert.match(appZipProblem(join(TREE, "missing.zip")), /does not exist/);
	mkdirSync(join(TREE, "a-dir.zip"), { recursive: true });
	assert.match(appZipProblem(join(TREE, "a-dir.zip")), /regular file/);
	writeFileSync(join(TREE, "real.zip"), "PK");
	assert.equal(appZipProblem(join(TREE, "real.zip")), null);

	const none = join(TREE, "extract-none");
	mkdirSync(join(none, "__MACOSX"), { recursive: true });
	writeFileSync(join(none, "README.app"), "a FILE named .app is not a bundle");
	assert.throws(() => bundleInExtracted(none), /exactly one \.app.*found 0/);
	const two = join(TREE, "extract-two");
	mkdirSync(join(two, "A.app"), { recursive: true });
	mkdirSync(join(two, "B.app"), { recursive: true });
	assert.throws(() => bundleInExtracted(two), /found 2: A\.app, B\.app/);
	const one = join(TREE, "extract-one");
	mkdirSync(join(one, "Local Operator.app"), { recursive: true });
	assert.equal(bundleInExtracted(one), join(one, "Local Operator.app"));

	const both = parseArgs([
		"--app",
		"/x.app",
		"--app-zip",
		"/x.zip",
		"--out",
		"/tmp/o",
	]);
	assert.throws(() => validateOptions(both), /mutually exclusive/);
	assert.throws(
		() => validateOptions(parseArgs(["--app-zip", "x.zip", "--out", "/tmp/o"])),
		/--app-zip must be an absolute path/,
	);
	assert.equal(parseArgs(["--keep-rig"]).keepRig, true);
	assert.equal(parseArgs([]).keepRig, false);
	// Refused at exit 2 by the real CLI, before any rig or spawn.
	const rigRoot = join(TREE, "zip-refuse-rig");
	const run = runHarness([
		"--app-zip",
		join(TREE, "x.tar.gz"),
		"--out",
		join(TREE, "zip-refuse-out"),
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
	]);
	assert.equal(run.status, 2, run.all);
	assert.match(run.all, /refused: --app-zip must name a \.zip/);
	assert.equal(existsSync(rigRoot), false, "no rig for a refused zip");
});

test("startup window: a build with no [dev-driver-script] ARMED is named as predating S1", () => {
	const armed = {
		windowModeLine: "[window-mode] window mode inactive",
		scriptArmed: true,
	};
	assert.equal(startupProblem(armed, STARTUP_WINDOW_MS + 1), null);
	assert.equal(
		startupProblem({ ...armed, scriptArmed: false }, STARTUP_WINDOW_MS),
		null,
		"nothing is judged inside the window",
	);
	assert.match(
		startupProblem({ ...armed, scriptArmed: false }, STARTUP_WINDOW_MS + 1),
		/predates the step runner \(S1\).*first release after PR #1936/,
	);
	assert.match(
		startupProblem(
			{ windowModeLine: null, scriptArmed: false },
			STARTUP_WINDOW_MS + 1,
		),
		/no \[window-mode\] line within 20 s/,
	);
});

it(
	"--app-zip end to end: extracted into the rig, receipt names the zip, removed after a clean reap",
	{
		skip: HAVE_ZIP_TOOLS ? false : "zip/unzip not on PATH",
	},
	async () => {
		const app = fakeApp("Zipped");
		const zip = zipTree(
			TREE,
			["Zipped.app"],
			join(TREE, "local-operator-ui-0.0.0-fake-arm64.zip"),
		);
		const zipSha = createHash("sha256").update(readFileSync(zip)).digest("hex");
		const rigRoot = join(TREE, "zip-rig");
		const out = join(TREE, "zip-out");
		const run = await runHarnessAsync([
			"--app-zip",
			zip,
			"--out",
			out,
			"--rig-root",
			rigRoot,
			"--capture",
			"capturepage",
			"--lop",
			fakeLop(),
			"--scene",
			"library",
			"--theme",
			"dark",
		]);
		const rig = rigOf(rigRoot);
		trackPids(rig);
		assert.equal(run.status, 0, run.all);
		assert.match(
			run.all,
			/launching ONE headless window \(release-zip 0\.0\.0-fake\)/,
		);
		const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
		assert.equal(receipt.verdict, "captured");
		assert.equal(receipt.app.kind, "release-zip");
		assert.equal(receipt.app.version, "0.0.0-fake");
		assert.equal(
			receipt.app.zip.basename,
			"local-operator-ui-0.0.0-fake-arm64.zip",
		);
		assert.equal(receipt.app.zip.sha256, zipSha);
		assert.deepEqual(receipt.app.codesign, {
			ran: false,
			reason: "not darwin",
		});
		// The app that ran is the EXTRACTED copy inside the rig, not the source tree.
		assert.equal(receipt.app.realpath, join(rig, "app", "Zipped.app"));
		assert.notEqual(receipt.app.realpath, app);
		assert.deepEqual(receipt.app.extracted, { removed: join(rig, "app") });
		assert.equal(existsSync(join(rig, "app")), false);
		assert.equal(receipt.frames.length, 1);
		assert.equal(receipt.reap.app.clean, true, JSON.stringify(receipt.reap));
		for (const pid of Object.values(fixturePids(rig)))
			assert.equal(alive(pid), false, `pid ${pid} survived`);

		// --keep-rig keeps the extracted bundle; a zip of TWO bundles is refused
		// (exit 2) after extraction and before any app is launched.
		const keptRoot = join(TREE, "zip-keep-rig");
		const kept = await runHarnessAsync([
			"--app-zip",
			zip,
			"--keep-rig",
			"--out",
			join(TREE, "zip-keep-out"),
			"--rig-root",
			keptRoot,
			"--capture",
			"capturepage",
			"--lop",
			fakeLop(),
			"--scene",
			"library",
			"--theme",
			"dark",
		]);
		const keptRig = rigOf(keptRoot);
		trackPids(keptRig);
		assert.equal(kept.status, 0, kept.all);
		assert.ok(
			existsSync(join(keptRig, "app", "Zipped.app", "Contents", "Info.plist")),
		);

		fakeApp("Second");
		const twoZip = zipTree(
			TREE,
			["Zipped.app", "Second.app"],
			join(TREE, "two-apps.zip"),
		);
		const twoRoot = join(TREE, "zip-two-rig");
		const two = await runHarnessAsync([
			"--app-zip",
			twoZip,
			"--out",
			join(TREE, "zip-two-out"),
			"--rig-root",
			twoRoot,
			"--capture",
			"capturepage",
			"--lop",
			fakeLop(),
		]);
		const twoRig = rigOf(twoRoot);
		trackPids(twoRig);
		assert.equal(two.status, 2, two.all);
		assert.match(
			two.all,
			/REFUSED: --app-zip must hold exactly one \.app.*found 2/,
		);
		assert.equal(
			existsSync(join(twoRig, "fake-app.pid")),
			false,
			"no app was launched",
		);
		assert.equal(existsSync(join(TREE, "zip-two-out", "receipt.json")), true);
	},
);

it("a build that never arms the step runner fails inside the startup window, named as predating S1", async () => {
	const app = fakeApp("PreS1", { noScript: true });
	const rigRoot = join(TREE, "pre-s1-rig");
	const started = Date.now();
	const run = await runHarnessAsync([
		"--app",
		app,
		"--out",
		join(TREE, "pre-s1-out"),
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--timeout",
		"120",
	]);
	const rig = rigOf(rigRoot);
	trackPids(rig);
	assert.equal(run.status, 1, run.all);
	assert.match(
		run.all,
		/FAILED: no \[dev-driver-script\] ARMED line within 20 s: this build predates the step runner/,
	);
	// The startup window, not --timeout (120 s), ended it.
	assert.ok(Date.now() - started < 60_000, `took ${Date.now() - started} ms`);
	assert.equal(
		alive(Number(readFileSync(join(rig, "fake-app.pid"), "utf8"))),
		false,
	);
});

/* ------------------------------------------------- seeds (#1902, #1907) */

test("Q2-1: a control character anywhere in a daemon path is refused by the predicate alone", () => {
	for (const path of [
		"/\t/127.0.0.1:9/health",
		"/\n/127.0.0.1:9/health",
		"/\r\n/127.0.0.1:9/health",
		"/health\u0000",
		"/v1/desktop/asks\u007f",
		"/v1/desktop/\tasks",
	])
		assert.match(
			daemonRequestProblem("GET", path) ?? "",
			/control character|only a path/,
			JSON.stringify(path),
		);
	assert.equal(daemonRequestProblem("GET", "/health"), null);
});

test("--seed defaults --session and --notification-id to the seed's own ids; an explicit flag wins", () => {
	const ask = parseArgs([
		"--app",
		"/x.app",
		"--out",
		"/o",
		"--seed",
		"ask-command",
	]);
	assert.equal(ask.session, "fa1902000001");
	assert.equal(ask.notificationId, null);
	const detail = parseArgs([
		"--app",
		"/x.app",
		"--out",
		"/o",
		"--seed",
		"notification-details",
		"--scene",
		"notification-detail",
	]);
	assert.equal(detail.session, "fa1907000001");
	assert.equal(detail.notificationId, "n_macproofdetailaa");
	validateOptions(detail);
	const explicit = parseArgs([
		"--app",
		"/x.app",
		"--out",
		"/o",
		"--seed",
		"ask-command",
		"--session",
		"abcdefabcdef",
	]);
	assert.equal(explicit.session, "abcdefabcdef");
});

test("--seed refusals: unknown scenario, with --seed-config, off the isolated backend; scene prerequisites", () => {
	const base = ["--app", "/x.app", "--out", "/o"];
	const refuses = (argv, pattern) =>
		assert.throws(
			() => validateOptions(parseArgs([...base, ...argv])),
			(error) => error instanceof Refusal && pattern.test(error.message),
			argv.join(" "),
		);
	refuses(["--seed", "nope"], /unknown --seed nope/);
	// QA r1 Q1-1: the scenario is named before the scene prerequisites it would
	// have satisfied (a valid --seed supplies --session).
	refuses(
		["--seed", "bogus-scenario", "--scene", "asks"],
		/unknown --seed bogus-scenario/,
	);
	refuses(["--seed", "ask-command", "--seed-config", "/s"], /alternatives/);
	refuses(
		[
			"--seed",
			"ask-command",
			"--backend",
			"attach",
			"--backend-url",
			"http://127.0.0.1:9",
		],
		/isolated backend|do not apply/,
	);
	refuses(
		["--seed", "ask-command", "--backend-config-root", "/r"],
		/isolated backend/,
	);
	refuses(["--scene", "asks"], /need --session/);
	refuses(["--scene", "notification-detail"], /need --notification-id/);
	refuses(
		["--scene", "notification-detail", "--notification-id", "n_bad"],
		/n_ \+ 16/,
	);
	// The happy shapes pass.
	validateOptions(
		parseArgs([...base, "--scene", "asks", "--session", "fa1902000001"]),
	);
	validateOptions(
		parseArgs([
			...base,
			"--scene",
			"notification-detail",
			"--notification-id",
			"n_macproofdetailaa",
		]),
	);
});

test("the asks and notification-detail scenes: exact steps, required waits on the seeded state, no optional shutter", () => {
	const { steps } = buildSteps({
		scenes: ["asks", "notification-detail"],
		themes: ["dark"],
		session: "fa1902000001",
		capture: "capturepage",
		notificationId: "n_macproofdetailaa",
	});
	const scene = steps.slice(5); // after skipOnboarding, 2 waits, state, setTheme
	assert.deepEqual(scene, [
		...asksSceneSteps(),
		{
			verb: "shutter",
			payload: { label: "asks-dark", capture: "capturepage" },
		},
		{ verb: "navigate", payload: "/notifications/n_macproofdetailaa" },
		{
			verb: "waitFor",
			payload: {
				selector: '[data-notification-detail="n_macproofdetailaa"]',
				timeoutMs: 20000,
			},
			timeoutMs: 25000,
		},
		{
			verb: "waitFor",
			payload: {
				selector:
					'[data-notification-detail="n_macproofdetailaa"] [data-notification-detail-title]',
			},
		},
		{
			// Design D7: the read-on-open settled before the shutter.
			verb: "waitFor",
			payload: {
				selector:
					'[data-notifications-page]:not(:has([data-notification-row="n_macproofdetailaa"][data-notification-unread])) [data-notification-detail="n_macproofdetailaa"] [data-notification-toggle-read] svg.lucide-circle',
				timeoutMs: 10000,
			},
			timeoutMs: 15000,
		},
		{
			verb: "shutter",
			payload: { label: "notification-detail-dark", capture: "capturepage" },
		},
	]);
	const asks = asksSceneSteps();
	// Only the auto-open probe and the conditional press may be skipped; the
	// drawer and its command block are REQUIRED, so an empty drawer fails the run.
	assert.deepEqual(
		asks.filter((s) => s.optional).map((s) => s.verb),
		["waitFor", "press"],
	);
	assert.equal(
		asks.find((s) => s.verb === "press").payload.selector,
		'[data-status-asks][data-lo-ask-item="minimized"]',
	);
	const required = asks.filter((s) => !s.optional && s.verb === "waitFor");
	assert.deepEqual(
		required.map((s) => s.payload.selector),
		[
			"[data-status-asks]",
			"[data-lo-ask-surfaces]",
			"[data-lo-ask-surfaces] [data-ask-command]",
		],
	);
	assert.ok(
		steps.filter((s) => s.verb === "shutter").every((s) => !s.optional),
	);
});

it("--seed ask-command end to end: generated into the rig, read back from the daemon, then the asks frame", async () => {
	const rigRoot = join(TREE, "seed-ask-rig");
	const out = join(TREE, "seed-ask-out");
	const run = await runHarnessAsync([
		"--app",
		fakeApp("SeedAsk"),
		"--out",
		out,
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--seed",
		"ask-command",
		"--scene",
		"asks",
		"--theme",
		"dark",
	]);
	const rig = rigOf(rigRoot);
	trackPids(rig);
	assert.equal(run.status, 0, run.all);
	const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
	assert.equal(receipt.verdict, "captured");
	assert.equal(receipt.seed.scenario, "ask-command");
	assert.deepEqual(receipt.seed.files, [
		"asks/fa1902000001.json",
		"sessions/fa1902000001/asks.jsonl",
		"sessions/fa1902000001/created_at.json",
		"sessions/fa1902000001/desktop.json",
		"sessions/fa1902000001/title.json",
		"sessions/fa1902000001/transcript.jsonl",
	]);
	assert.equal(receipt.seed.check.ok, true);
	assert.equal(receipt.seed.check.path, "/v1/desktop/asks");
	assert.equal(receipt.backend.seeded, true);
	// Copied into the daemon's config root before serve started.
	const seen = JSON.parse(
		readFileSync(join(rig, "config", "fake-serve-seen.json"), "utf8"),
	);
	assert.ok(seen.configEntries.includes("asks"), seen.configEntries.join(","));
	assert.ok(seen.configEntries.includes("sessions"));
	const requests = JSON.parse(
		readFileSync(join(rig, "config", "fake-serve-requests.json"), "utf8"),
	);
	assert.ok(requests.includes("GET /v1/desktop/asks"), requests.join(","));
	// The app opened the seed's conversation (the --session default).
	const app = JSON.parse(readFileSync(join(rig, "fake-app-seen.json"), "utf8"));
	assert.ok(
		app.argv.includes("--open-session=fa1902000001"),
		app.argv.join(" "),
	);
	assert.deepEqual(
		receipt.frames.map((f) => f.label),
		["asks-dark"],
	);
	for (const pid of Object.values(fixturePids(rig)))
		assert.equal(alive(pid), false, `pid ${pid} survived`);
});

it(
	"--seed notification-details end to end: the detail is read back through the daemon, then the detail frame",
	{
		skip:
			Number(process.versions.node.split(".")[0]) >= 23 ||
			/^22\.(1[3-9]|[2-9]\d)/.test(process.versions.node)
				? false
				: "node:sqlite needs Node >= 22.13",
	},
	async () => {
		const rigRoot = join(TREE, "seed-detail-rig");
		const out = join(TREE, "seed-detail-out");
		const run = await runHarnessAsync([
			"--app",
			fakeApp("SeedDetail"),
			"--out",
			out,
			"--rig-root",
			rigRoot,
			"--capture",
			"capturepage",
			"--lop",
			fakeLop(),
			"--seed",
			"notification-details",
			"--scene",
			"notification-detail",
			"--theme",
			"dark",
		]);
		const rig = rigOf(rigRoot);
		trackPids(rig);
		assert.equal(run.status, 0, run.all);
		const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
		assert.equal(
			receipt.seed.check.path,
			"/v1/desktop/notifications/n_macproofdetailaa",
		);
		assert.ok(receipt.seed.files.includes("notifications.db"));
		assert.ok(
			!receipt.seed.files.some((f) => /-wal$|-shm$|-journal$/.test(f)),
			receipt.seed.files.join(","),
		);
		const steps = JSON.parse(
			readFileSync(join(rig, "steps.json"), "utf8"),
		).steps;
		assert.ok(
			steps.some(
				(s) =>
					s.verb === "navigate" &&
					s.payload === "/notifications/n_macproofdetailaa",
			),
		);
		assert.deepEqual(
			receipt.frames.map((f) => f.label),
			["notification-detail-dark"],
		);
	},
);

it("--seed whose rows the daemon does not read back is BLOCKED (exit 3) before any app launches", async () => {
	const rigRoot = join(TREE, "seed-blocked-rig");
	const out = join(TREE, "seed-blocked-out");
	const run = await runHarnessAsync([
		"--app",
		fakeApp("SeedBlocked"),
		"--out",
		out,
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop({ dropSeed: true }),
		"--seed",
		"ask-command",
		"--scene",
		"asks",
		"--theme",
		"dark",
	]);
	const rig = rigOf(rigRoot);
	trackPids(rig);
	assert.equal(run.status, 3, run.all);
	assert.match(
		run.all,
		/BLOCKED: the rig daemon did not read the --seed ask-command rows back/,
	);
	assert.match(run.all, /does not list ask a-1902 of session fa1902000001/);
	assert.doesNotMatch(run.all, /BLOCKED: BLOCKED/);
	assert.equal(
		existsSync(join(rig, "fake-app.pid")),
		false,
		"no app was launched",
	);
	const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
	assert.equal(receipt.exit, 3);
	// The receipt's word is the closing line's ("blocked (...)"), not "failed".
	assert.equal(receipt.verdict, "blocked");
	assert.match(run.all, /\[mac-proof\] blocked \(/);
	assert.equal(receipt.frames.length, 0);
	assert.equal(receipt.reap.serve.clean, true, JSON.stringify(receipt.reap));
	for (const pid of Object.values(fixturePids(rig)))
		assert.equal(alive(pid), false, `pid ${pid} survived`);
});

test("verifySeedRows: retries until the deadline, then a BLOCKED Refusal naming what is missing", async () => {
	const lop = fakeLop({ dropSeed: true });
	const cfg = join(TREE, "verify-cfg");
	mkdirSync(cfg, { recursive: true });
	const port = await new Promise((done) => {
		const srv = createServer().listen(0, "127.0.0.1", () => {
			const p = srv.address().port;
			srv.close(() => done(p));
		});
	});
	const token = "t".repeat(64);
	const child = spawn(
		lop,
		["serve", "--host", "127.0.0.1", "--port", String(port)],
		{
			env: {
				PATH: process.env.PATH,
				LOCAL_OPERATOR_CONFIG_DIR: cfg,
				LOCAL_OPERATOR_DESKTOP_TOKEN: token,
			},
			detached: true,
			stdio: "ignore",
		},
	);
	leftovers.push(child.pid);
	try {
		for (let i = 0; i < 100; i++) {
			if (existsSync(join(cfg, "fake-serve-seen.json"))) break;
			await new Promise((r) => setTimeout(r, 50));
		}
		await new Promise((r) => setTimeout(r, 200));
		const started = Date.now();
		await assert.rejects(
			verifySeedRows(
				`http://127.0.0.1:${port}`,
				token,
				{
					scenario: "notification-details",
					path: "/v1/desktop/notifications/n_macproofdetailaa",
					notificationId: "n_macproofdetailaa",
					historyRevisions: [1, 2],
				},
				{ deadline: Date.now() + 600, pollMs: 100 },
			),
			(error) =>
				error instanceof Refusal &&
				error.code === 3 &&
				/answered no result/.test(error.message) &&
				/read\(s\)/.test(error.message),
		);
		assert.ok(Date.now() - started >= 500, "it retried up to the deadline");
		const requests = JSON.parse(
			readFileSync(join(cfg, "fake-serve-requests.json"), "utf8"),
		);
		assert.ok(
			requests.filter(
				(r) => r === "GET /v1/desktop/notifications/n_macproofdetailaa",
			).length >= 2,
			requests.join(","),
		);
	} finally {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {}
		try {
			const standby = Number(
				readFileSync(join(cfg, "fake-standby.pid"), "utf8"),
			);
			process.kill(standby, "SIGKILL");
		} catch {}
	}
});

/* ------------------------------------- #1936 deferred hardening (R2/R3/Q2/Q3) */

/** Spawn `count` idle node fixtures with `opts`; answer their pids. */
function idleFixtures(count, opts) {
	const keep = `setTimeout(()=>process.exit(0),${FIXTURE_CAP_MS});setInterval(()=>{},1000)`;
	const kids = [];
	for (let i = 0; i < count; i++) {
		const child = spawn(process.execPath, ["-e", keep], {
			stdio: "ignore",
			...opts,
		});
		leftovers.push(child.pid);
		kids.push(child);
	}
	return kids;
}

test("R2-2: processFactsMany reads every pid in one pass, with a start time; processFacts agrees", () => {
	const kids = idleFixtures(3, { cwd: TREE });
	try {
		const pids = kids.map((k) => k.pid);
		const facts = processFactsMany([...pids, 999_999_999, -1, 1.5]);
		assert.deepEqual([...facts.keys()].sort(), [...pids].sort());
		for (const pid of pids) {
			const f = facts.get(pid);
			assert.equal(f.cwd, TREE);
			assert.match(String(f.start), /\S/);
			assert.equal(processFacts(pid).start, f.start, "same identity both ways");
		}
		// Identity only (no cwd read), the shape rememberIdentities asks for.
		assert.equal(processFactsMany(pids, { cwd: false }).get(pids[0]).cwd, null);
		assert.equal(processFactsMany([]).size, 0);
	} finally {
		for (const k of kids) k.kill("SIGKILL");
	}
});

test("R2-1: a RECORDED pid with no rig trace is killed and counted; a recycled identity is never touched", async () => {
	const rig = join(TREE, "identity-rig", "mac-proof-iiiiii");
	const elsewhere = join(TREE, "identity-elsewhere");
	mkdirSync(rig, { recursive: true });
	mkdirSync(elsewhere, { recursive: true });
	// Both look like strangers: cwd outside the rig, nothing of the rig in env.
	const [scrubbed, recycled] = idleFixtures(2, {
		cwd: elsewhere,
		env: { PATH: process.env.PATH },
	});
	try {
		const matches = rigMatcher({ rig });
		assert.equal(
			matches(processFacts(scrubbed.pid)),
			false,
			"the content matcher alone would skip it",
		);
		const identities = rememberIdentities(new Map(), [scrubbed.pid]);
		assert.ok(identities.has(scrubbed.pid));
		// The recycled case: recorded under a start time that is not this process's.
		identities.set(recycled.pid, "not-its-start-time");
		const left = await killRigMatched([scrubbed.pid, recycled.pid], matches, {
			identities,
		});
		assert.deepEqual(left, []);
		assert.equal(
			alive(scrubbed.pid),
			false,
			"the recorded child is killed by identity",
		);
		assert.equal(
			alive(recycled.pid),
			true,
			"a pid whose start time changed is a stranger",
		);
	} finally {
		for (const k of [scrubbed, recycled]) k.kill("SIGKILL");
	}
});

test("R2-3: a sweep-only rig pid that leads its group is killed alone; a RECORDED leader takes its group", async () => {
	const rig = join(TREE, "group-rig", "mac-proof-gggggg");
	const elsewhere = join(TREE, "group-elsewhere");
	mkdirSync(rig, { recursive: true });
	mkdirSync(elsewhere, { recursive: true });
	const startLeader = async (name) => {
		const pidsFile = join(elsewhere, `${name}.json`);
		const keep = `setTimeout(()=>process.exit(0),${FIXTURE_CAP_MS});setInterval(()=>{},1000)`;
		const src = `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const c = spawn(process.execPath, ["-e", ${JSON.stringify(keep)}], { cwd: ${JSON.stringify(elsewhere)}, stdio: "ignore" });
fs.writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify({ child: c.pid }));
${PARENT_WATCH}`;
		const leader = spawn(process.execPath, ["-e", src], {
			cwd: rig,
			detached: true,
			stdio: "ignore",
		});
		leftovers.push(leader.pid);
		for (let i = 0; i < 100 && !existsSync(pidsFile); i++)
			await new Promise((r) => setTimeout(r, 50));
		const { child } = JSON.parse(readFileSync(pidsFile, "utf8"));
		leftovers.push(child);
		return { leader: leader.pid, child };
	};
	const swept = await startLeader("swept");
	const recorded = await startLeader("recorded");
	try {
		const matches = rigMatcher({ rig });
		assert.equal(processFacts(swept.child).pgid, swept.leader);
		// Sweep-only (no identity): the leader dies, its non-rig child does not.
		assert.deepEqual(await killRigMatched([swept.leader], matches), []);
		assert.equal(alive(swept.leader), false);
		assert.equal(alive(swept.child), true, "a sweep never widens to the group");
		// Recorded by this run: the whole group goes.
		const identities = rememberIdentities(new Map(), [recorded.leader]);
		assert.deepEqual(
			await killRigMatched([recorded.leader], matches, { identities }),
			[],
		);
		assert.equal(alive(recorded.leader), false);
		assert.equal(
			alive(recorded.child),
			false,
			"a recorded leader's group is ours",
		);
	} finally {
		for (const pid of [
			swept.leader,
			swept.child,
			recorded.leader,
			recorded.child,
		])
			try {
				process.kill(pid, "SIGKILL");
			} catch {}
	}
});

test("R3-1/Q3-1: an extracted bundle whose Contents resolves elsewhere is refused; a real one passes", () => {
	const dest = join(TREE, "contain-app");
	const elsewhere = join(TREE, "contain-elsewhere", "Second.app");
	mkdirSync(join(elsewhere, "Contents", "MacOS"), { recursive: true });
	writeFileSync(join(elsewhere, "Contents", "Info.plist"), "<plist/>");
	writeFileSync(join(elsewhere, "Contents", "MacOS", "Local Operator"), "");
	mkdirSync(join(dest, "Zipped.app"), { recursive: true });
	symlinkSync(
		join(elsewhere, "Contents"),
		join(dest, "Zipped.app", "Contents"),
	);
	const escaped = {
		realpath: join(dest, "Zipped.app"),
		executable: join(dest, "Zipped.app", "Contents", "MacOS", "Local Operator"),
	};
	assert.match(
		extractedContainmentProblem(escaped, dest) ?? "",
		/Info\.plist resolves outside the extracted bundle/,
	);
	const realDest = join(TREE, "contain-real");
	const real = fakeApp("ContainReal");
	mkdirSync(realDest, { recursive: true });
	cpSync(real, join(realDest, "ContainReal.app"), { recursive: true });
	const ok = resolveAppBundle(join(realDest, "ContainReal.app"));
	assert.equal(extractedContainmentProblem(ok, realDest), null);
	// The bundle itself pointing outside the extraction dir is refused too.
	assert.match(
		extractedContainmentProblem({ ...ok, realpath: real }, realDest) ?? "",
		/bundle resolves outside/,
	);
});

test("R3-2: the informational codesign is bounded by min(--timeout left, 60 s) and records its duration", () => {
	assert.equal(CODESIGN_CAP_MS, 60_000);
	assert.deepEqual(
		codesignVerdict("/x.app", { platform: "linux", timeoutMs: 1 }),
		{
			ran: false,
			reason: "not darwin",
		},
	);
	// On this host /usr/bin/codesign does not exist: the spawn fails at once,
	// which still exercises the bound and the recorded fields.
	const capped = codesignVerdict("/x.app", {
		platform: "darwin",
		timeoutMs: 290_000,
	});
	assert.equal(capped.boundMs, 60_000);
	assert.equal(capped.valid, false);
	assert.equal(typeof capped.durationMs, "number");
	assert.equal(capped.timedOut, false);
	assert.equal(
		codesignVerdict("/x.app", { platform: "darwin", timeoutMs: 5_000 }).boundMs,
		5_000,
	);
});

test("R3-3: a quarantined zip or bundle is refused on darwin; unreadable refuses; elsewhere not checked", () => {
	const reader = (answer) => () => answer;
	assert.match(
		quarantineProblem("/dl/x.zip", {
			platform: "darwin",
			read: reader({ value: "0083;65f0;Safari;" }),
		}) ?? "",
		/com\.apple\.quarantine \(0083;65f0;Safari;\).*xattr -d com\.apple\.quarantine/,
	);
	assert.match(
		quarantineProblem("/dl/x.zip", {
			platform: "darwin",
			read: reader({ unreadable: "timed out" }),
		}) ?? "",
		/could not read com\.apple\.quarantine/,
	);
	assert.equal(
		quarantineProblem("/dl/x.zip", {
			platform: "darwin",
			read: reader({ value: null }),
		}),
		null,
	);
	assert.equal(
		quarantineProblem("/dl/x.zip", {
			platform: "linux",
			read: () => assert.fail("not read off darwin"),
		}),
		null,
	);
});

test(
	"R3-5: the zip is hashed again at extraction; one that changed since preflight is refused",
	{ skip: HAVE_ZIP_TOOLS ? false : "zip/unzip not on PATH" },
	() => {
		fakeApp("Rehash");
		const zip = zipTree(TREE, ["Rehash.app"], join(TREE, "rehash.zip"));
		const sha = createHash("sha256").update(readFileSync(zip)).digest("hex");
		const rig = mkdtempSync(join(TREE, "rehash-rig-"));
		const app = releaseZipApp(
			{ path: zip, basename: "rehash.zip", sha256: sha },
			rig,
			{
				roots: operatorRoots({ homes: [join(TREE, "nohome")] }),
				timeoutMs: 30_000,
				platform: "linux",
			},
		);
		assert.equal(app.zip.sha256, sha);
		assert.equal(app.zip.hashedAt, "extraction");
		const rig2 = mkdtempSync(join(TREE, "rehash-rig-"));
		assert.throws(
			() =>
				releaseZipApp(
					{ path: zip, basename: "rehash.zip", sha256: "0".repeat(64) },
					rig2,
					{
						roots: operatorRoots({ homes: [join(TREE, "nohome")] }),
						timeoutMs: 30_000,
						platform: "linux",
					},
				),
			(error) =>
				error instanceof Refusal &&
				/changed between preflight and extraction/.test(error.message),
		);
		assert.equal(
			existsSync(join(rig2, "app")),
			false,
			"nothing extracted from a changed zip",
		);
	},
);

it(
	"R3-4: a failed removal of the extracted bundle still writes the receipt and the closing line",
	{
		skip:
			HAVE_ZIP_TOOLS && process.getuid?.() !== 0
				? false
				: "needs zip/unzip and a non-root user",
	},
	async () => {
		fakeApp("Sticky");
		// A read-only directory holding a file: rmSync cannot unlink inside it.
		const locked = join(TREE, "Sticky.app", "Contents", "Resources", "locked");
		mkdirSync(locked, { recursive: true });
		writeFileSync(join(locked, "pinned"), "x");
		chmodSync(locked, 0o555);
		const zip = zipTree(TREE, ["Sticky.app"], join(TREE, "sticky.zip"));
		chmodSync(locked, 0o755);
		const rigRoot = join(TREE, "sticky-rig");
		const out = join(TREE, "sticky-out");
		const run = await runHarnessAsync([
			"--app-zip",
			zip,
			"--out",
			out,
			"--rig-root",
			rigRoot,
			"--capture",
			"capturepage",
			"--lop",
			fakeLop(),
			"--scene",
			"library",
			"--theme",
			"dark",
		]);
		const rig = rigOf(rigRoot);
		trackPids(rig);
		const extractedLocked = join(
			rig,
			"app",
			"Sticky.app",
			"Contents",
			"Resources",
			"locked",
		);
		try {
			assert.equal(run.status, 0, run.all);
			assert.match(
				run.stdout,
				/\[mac-proof\] captured: 1 frame\(s\); receipt /,
			);
			const receipt = JSON.parse(
				readFileSync(join(out, "receipt.json"), "utf8"),
			);
			assert.equal(receipt.app.extracted.kept, join(rig, "app"));
			assert.match(receipt.app.extracted.reason, /removal failed: .*EACCES/);
		} finally {
			if (existsSync(extractedLocked)) chmodSync(extractedLocked, 0o755);
		}
	},
);

test("R3-6/Q3-4: the fallback recipe that can `exit 8`/`exit 9` runs in one subshell", () => {
	const doc = readFileSync(
		join(process.cwd(), "docs", "mac-proof-capture.md"),
		"utf8",
	);
	const block = doc
		.split("```")
		.find((chunk) => chunk.startsWith("sh\n") && chunk.includes("exit 8"));
	assert.ok(block, "the fallback block exists");
	const lines = block
		.split("\n")
		.filter((l) => l.trim() && !l.trim().startsWith("#"));
	assert.equal(lines[1], "(", "opens a subshell before any command");
	assert.equal(lines.at(-1), ")", "closes it after the last command");
});

/* ------------------------------------------------- #1938 review/QA round 1 */

test("R1-1: every parsed ps/lsof runs under LC_ALL=C and LANG=C, and C lstart parses", () => {
	const env = cLocaleEnv({
		PATH: "/bin",
		LANG: "en_GB.UTF-8",
		LC_ALL: "de_DE.UTF-8",
		LC_TIME: "fr_FR.UTF-8",
	});
	assert.equal(env.LC_ALL, "C");
	assert.equal(env.LANG, "C");
	assert.equal(env.PATH, "/bin", "the rest of the env is kept");
	// Source pin: no `ps`/`lsof` spawn in the harness without the C env. A new
	// one that forgets it fails here, not on a day-first Mac.
	const src = readFileSync(
		new URL("./mac-proof-capture.mjs", import.meta.url),
		"utf8",
	);
	const spawns = [...src.matchAll(/spawnSync\(\s*"(ps|lsof)"[\s\S]*?\);/g)];
	assert.ok(spawns.length >= 7, `found ${spawns.length} ps/lsof spawns`);
	for (const [call] of spawns) assert.match(call, /env: cLocaleEnv\(\)/, call);
	// The real `ps` under the C env, with the operator's locale set to a
	// day-first one: the start comes out in the order the parser reads.
	const ps = spawnSync(
		"ps",
		["-o", "pid=,pgid=,lstart=,command=", "-p", String(process.pid)],
		{
			encoding: "utf8",
			env: cLocaleEnv({
				...process.env,
				LANG: "en_GB.UTF-8",
				LC_ALL: "en_GB.UTF-8",
				LC_TIME: "de_DE.UTF-8",
			}),
		},
	);
	assert.equal(ps.status, 0, ps.stderr);
	const parsed = parsePsFactsLine(ps.stdout.split("\n")[0]);
	assert.equal(parsed.pid, process.pid);
	assert.match(
		parsed.start,
		/^[A-Z][a-z]{2} [A-Z][a-z]{2} +\d+ \d\d:\d\d:\d\d \d{4}$/,
	);
	assert.equal(parsed.startUnparsed, undefined);
});

test("R1-1: a day-first lstart line keeps its pid with identity UNKNOWN, never dropped", () => {
	const c = parsePsFactsLine(
		"  4242  4242 Mon Nov 16 10:00:00 2026 /usr/bin/x --flag",
	);
	assert.deepEqual(c, {
		pid: 4242,
		pgid: 4242,
		start: "Mon Nov 16 10:00:00 2026",
		cwd: null,
		text: "/usr/bin/x --flag",
	});
	for (const line of [
		"  4242  4240 Mon 16 Nov 10:00:00 2026 /usr/bin/x HOME=/r", // en_GB
		"  4242  4240 Mo 16 Nov 10:00:00 2026 /usr/bin/x HOME=/r", // de_DE
		"  4242  4240 lun. 16 nov. 10:00:00 2026 /usr/bin/x HOME=/r", // fr_FR
	]) {
		const f = parsePsFactsLine(line);
		assert.equal(f.pid, 4242, line);
		assert.equal(f.pgid, 4240);
		assert.equal(f.start, null);
		assert.equal(f.startUnparsed, true);
		assert.match(
			f.text,
			/\/usr\/bin\/x HOME=\/r$/,
			"the matcher still sees the command and env",
		);
	}
	assert.equal(parsePsFactsLine(""), null);
	assert.equal(parsePsFactsLine("   "), null);
});

test("R1-1: a RECORDED pid with an UNKNOWN identity is still reaped (by pid) and noted, never skipped", async () => {
	const elsewhere = join(TREE, "unknown-elsewhere");
	mkdirSync(elsewhere, { recursive: true });
	const [scrubbed, stranger] = idleFixtures(2, {
		cwd: elsewhere,
		env: { PATH: process.env.PATH },
	});
	try {
		const matches = rigMatcher({
			rig: join(TREE, "unknown-rig", "mac-proof-uuuuuu"),
		});
		assert.equal(
			matches(processFacts(scrubbed.pid)),
			false,
			"content alone would skip it",
		);
		// What rememberIdentities records when the start did not parse.
		const identities = new Map([[scrubbed.pid, UNKNOWN_START]]);
		const unknownStart = new Set();
		const left = await killRigMatched([scrubbed.pid, stranger.pid], matches, {
			identities,
			unknownStart,
		});
		assert.deepEqual(left, []);
		assert.equal(
			alive(scrubbed.pid),
			false,
			"the unknown-identity recorded pid is reaped",
		);
		assert.equal(
			alive(stranger.pid),
			true,
			"an unrecorded non-matching pid is untouched",
		);
		assert.deepEqual(
			[...unknownStart],
			[scrubbed.pid],
			"the receipt gets the pid",
		);
	} finally {
		for (const k of [scrubbed, stranger]) k.kill("SIGKILL");
	}
});

/** A tree shaped like the real release: its 20 symlinks, verbatim (v0.57.3 arm64 central directory). */
function releaseShapedTree(dest) {
	const app = join(dest, "Local Operator.app", "Contents");
	const file = (p) => {
		mkdirSync(join(p, ".."), { recursive: true });
		writeFileSync(p, "");
	};
	const link = (target, path) => {
		mkdirSync(join(path, ".."), { recursive: true });
		symlinkSync(target, path);
	};
	file(join(app, "Info.plist"));
	writeFileSync(
		join(app, "Info.plist"),
		"<plist><dict><key>CFBundleExecutable</key><string>Local Operator</string></dict></plist>",
	);
	file(join(app, "MacOS", "Local Operator"));
	const frameworks = {
		"Electron Framework": [
			"Electron Framework",
			"Helpers",
			"Libraries",
			"Resources",
		],
		Mantle: ["Mantle", "Resources"],
		ReactiveObjC: ["ReactiveObjC", "Resources"],
		Squirrel: ["Resources", "Squirrel"],
	};
	let links = 0;
	for (const [name, tops] of Object.entries(frameworks)) {
		const fw = join(app, "Frameworks", `${name}.framework`);
		for (const top of tops) {
			if (top === name) file(join(fw, "Versions", "A", top));
			else mkdirSync(join(fw, "Versions", "A", top), { recursive: true });
			link(`Versions/Current/${top}`, join(fw, top));
			links++;
		}
		link("A", join(fw, "Versions", "Current"));
		links++;
	}
	const py = join(app, "Resources", "python-runtime-seed", "arm64");
	for (const [dir, name, target] of [
		["bin", "python", "python3.14"],
		["bin", "python3", "python3.14"],
		["bin", "python3-config", "python3.14-config"],
		["lib/pkgconfig", "python3-embed.pc", "python-3.14-embed.pc"],
		["lib/pkgconfig", "python3.pc", "python-3.14.pc"],
		["share/man/man1", "python3.1", "python3.14.1"],
	]) {
		file(join(py, dir, target));
		link(target, join(py, dir, name));
		links++;
	}
	return links;
}

test("R1-3: every symlink in the extracted tree must resolve inside it; the real release's 20 pass", () => {
	const dest = join(TREE, "symlink-real");
	assert.equal(releaseShapedTree(dest), 20);
	assert.equal(extractedSymlinkProblem(dest), null);
	// app.asar pointed at another installed app: refused.
	const outside = join(
		TREE,
		"symlink-outside",
		"Other.app",
		"Contents",
		"Resources",
	);
	mkdirSync(outside, { recursive: true });
	writeFileSync(join(outside, "app.asar"), "");
	const escaped = join(TREE, "symlink-escaped");
	releaseShapedTree(escaped);
	symlinkSync(
		join(outside, "app.asar"),
		join(escaped, "Local Operator.app", "Contents", "Resources", "app.asar"),
	);
	assert.match(
		extractedSymlinkProblem(escaped) ?? "",
		/app\.asar resolves outside the extracted tree/,
	);
	// A relative link that climbs out, and a dangling one, are refused too.
	const climbs = join(TREE, "symlink-climbs");
	releaseShapedTree(climbs);
	symlinkSync(
		"../../../../symlink-outside",
		join(climbs, "Local Operator.app", "Contents", "Frameworks", "x"),
	);
	assert.match(extractedSymlinkProblem(climbs) ?? "", /resolves outside/);
	const dangling = join(TREE, "symlink-dangling");
	releaseShapedTree(dangling);
	symlinkSync(
		"nowhere",
		join(dangling, "Local Operator.app", "Contents", "Frameworks", "gone"),
	);
	assert.match(extractedSymlinkProblem(dangling) ?? "", /does not resolve/);
});

test(
	"R1-3: releaseZipApp refuses (exit 2) a zip whose app.asar links outside; the release-shaped zip passes",
	{ skip: !HAVE_ZIP_TOOLS && "zip/unzip not on PATH" },
	() => {
		const src = join(TREE, "r13-src");
		releaseShapedTree(src);
		const good = zipTree(
			src,
			["Local Operator.app"],
			join(TREE, "r13-good.zip"),
		);
		const roots = [join(TREE, "r13-not-a-root")];
		const ok = releaseZipApp({ path: good }, join(TREE, "r13-rig-ok"), {
			roots,
			timeoutMs: 60_000,
		});
		assert.equal(ok.kind, "release-zip");
		const outside = join(TREE, "r13-outside.asar");
		writeFileSync(outside, "");
		symlinkSync(
			outside,
			join(src, "Local Operator.app", "Contents", "Resources", "app.asar"),
		);
		const bad = zipTree(src, ["Local Operator.app"], join(TREE, "r13-bad.zip"));
		assert.throws(
			() =>
				releaseZipApp({ path: bad }, join(TREE, "r13-rig-bad"), {
					roots,
					timeoutMs: 60_000,
				}),
			(error) =>
				error instanceof Refusal &&
				error.code === 2 &&
				/app\.asar resolves outside/.test(error.message),
		);
	},
);

test(
	"R1-2 (#1936 Q3-2/Q3-3): .. or absolute entries, and an unpacked total over the cap, refuse before extraction",
	{ skip: !HAVE_ZIP_TOOLS && "zip/unzip not on PATH" },
	() => {
		assert.equal(APP_ZIP_UNPACKED_CAP_BYTES, 2 * 1024 ** 3);
		assert.ok(
			APP_ZIP_UNPACKED_CAP_BYTES > 427_528_786 * 5,
			"5x the measured v0.57.3 arm64 unpacked total",
		);
		const src = join(TREE, "q32-src");
		mkdirSync(join(src, "X.app", "Contents"), { recursive: true });
		writeFileSync(join(src, "X.app", "Contents", "Info.plist"), "<plist/>");
		writeFileSync(join(src, "evil"), "x");
		const clean = zipTree(src, ["X.app"], join(TREE, "q32-clean.zip"));
		assert.equal(appZipListingProblem(clean, { timeoutMs: 30_000 }), null);
		// `zip` stores `../evil` verbatim when given that path from a subdir.
		const dotdot = join(TREE, "q32-dotdot.zip");
		const z = spawnSync("zip", ["-q", dotdot, "Info.plist", "../../evil"], {
			cwd: join(src, "X.app", "Contents"),
			encoding: "utf8",
		});
		assert.equal(z.status, 0, z.stderr);
		assert.match(
			spawnSync("unzip", ["-Z1", dotdot], { encoding: "utf8" }).stdout,
			/^\.\.\/\.\.\/evil$/m,
		);
		assert.match(
			appZipListingProblem(dotdot, { timeoutMs: 30_000 }) ?? "",
			/absolute path or a \.\. segment \("\.\.\/\.\.\/evil"\)/,
		);
		const dest = join(TREE, "q32-dest");
		assert.throws(
			() =>
				releaseZipApp({ path: dotdot }, join(TREE, "q32-rig"), {
					roots: [],
					timeoutMs: 30_000,
				}),
			(error) =>
				error instanceof Refusal &&
				/refused before extraction/.test(error.message),
		);
		assert.equal(
			existsSync(join(TREE, "q32-rig", "app")),
			false,
			"nothing was extracted",
		);
		assert.equal(existsSync(dest), false);
		// Absolute: `zip` strips a leading slash, so craft one - rename a stored
		// entry `Xabs/evil` to `/abs/evil` in both headers (same length; the CRC
		// covers the data, not the name).
		mkdirSync(join(src, "Xabs"), { recursive: true });
		writeFileSync(join(src, "Xabs", "evil"), "x");
		const absZip = zipTree(
			src,
			["X.app", "Xabs/evil"],
			join(TREE, "q32-abs.zip"),
		);
		const bytes = readFileSync(absZip);
		const from = Buffer.from("Xabs/evil");
		let at = bytes.indexOf(from);
		let renamed = 0;
		while (at >= 0) {
			bytes[at] = "/".charCodeAt(0);
			renamed++;
			at = bytes.indexOf(from, at + 1);
		}
		assert.equal(renamed, 2, "local header + central directory");
		writeFileSync(absZip, bytes);
		assert.match(
			spawnSync("unzip", ["-Z1", absZip], { encoding: "utf8" }).stdout,
			/^\/abs\/evil$/m,
		);
		assert.match(
			appZipListingProblem(absZip, { timeoutMs: 30_000 }) ?? "",
			/absolute path or a \.\. segment \("\/abs\/evil"\)/,
		);
		// The cap reads the listing's unpacked total.
		assert.match(
			appZipListingProblem(clean, { timeoutMs: 30_000, capBytes: 1 }) ?? "",
			/over the 1 B cap/,
		);
	},
);

/* -------------------------- the download scene: the harness's one write */

const NOTES = "line one of the fixture\nline two of fixture\n";
const NOTES_SHA = createHash("sha256").update(NOTES).digest("hex");
const downloadArgs = (extra = []) => [
	"--app",
	"/x.app",
	"--out",
	"/tmp/x",
	"--session",
	"ce618964c88e",
	"--scene",
	"download",
	"--theme",
	"dark",
	...extra,
];
function manifestFile(name, files) {
	const path = join(TREE, `${name}.json`);
	writeFileSync(path, JSON.stringify({ files }));
	return path;
}

test("download: refused off --backend-config-root (attach lands in the operator's ~/Downloads), with one theme, plain names", () => {
	assert.throws(
		() =>
			validateOptions(
				parseArgs(
					downloadArgs([
						"--backend",
						"attach",
						"--backend-url",
						"http://127.0.0.1:5555",
					]),
				),
			),
		/refuses --backend attach.*operator's real ~\/Downloads/,
	);
	assert.throws(
		() => validateOptions(parseArgs(downloadArgs())),
		/--scene download needs --backend-config-root.*got --backend isolated/,
	);
	const cr = ["--backend-config-root", "/rig/config"];
	assert.doesNotThrow(() => validateOptions(parseArgs(downloadArgs(cr))));
	assert.throws(
		() =>
			validateOptions(
				parseArgs([...downloadArgs(cr), "--theme", "dark,light"]),
			),
		/exactly one --theme/,
	);
	for (const bad of ["../x", "a/b", 'q"', "a\\b", "..", "\u0007"])
		assert.throws(
			() =>
				validateOptions(
					parseArgs([...downloadArgs(cr), "--download-file", bad]),
				),
			/--download-file must be/,
			bad,
		);
	assert.throws(
		() =>
			parseArgs([
				...downloadArgs(cr),
				"--download-file",
				"notes.md",
				"--download-file",
				"image-1.png",
			]),
		/more than once \(one file per run\)/,
	);
	assert.throws(
		() =>
			validateOptions(
				parseArgs([...downloadArgs(cr), "--manifest", "relative.json"]),
			),
		/--manifest must be an absolute path/,
	);
	// The download flags without the scene are a mistake, not a no-op.
	assert.throws(
		() =>
			validateOptions(
				parseArgs([
					"--app",
					"/x.app",
					"--out",
					"/tmp/x",
					"--download-file",
					"notes.md",
				]),
			),
		/apply only to --scene download/,
	);
	assert.throws(
		() =>
			validateOptions(
				parseArgs([
					"--app",
					"/x.app",
					"--out",
					"/tmp/x",
					"--scene",
					"download",
					"--backend-config-root",
					"/rig/config",
					"--theme",
					"dark",
				]),
			),
		/need --session/,
	);
});

test("download: the steps use shipped verbs only, require an enabled Download entry, and never press Save as", () => {
	const shipped = new Set([
		"navigate",
		"setTheme",
		"press",
		"state",
		"waitFor",
		"openCanvas",
		"skipOnboarding",
		"shutter",
	]);
	const { steps } = buildSteps({
		...parseArgs(downloadArgs(["--backend-config-root", "/rig/config"])),
		capture: "capturepage",
	});
	assert.ok(steps.every((s) => shipped.has(s.verb)));
	const scene = downloadSceneSteps();
	assert.deepEqual(steps.slice(-scene.length - 1, -1), scene);
	assert.equal(steps.at(-1).payload.label, "download-dark");
	// Defaults to the authorised fixture, also when parseArgs left null.
	assert.equal(DOWNLOAD_FILE_DEFAULT, "notes.md");
	assert.deepEqual(downloadSceneSteps(null), downloadSceneSteps("notes.md"));
	const presses = scene.filter((s) => s.verb === "press");
	assert.deepEqual(
		presses.map((s) => s.payload.selector),
		[
			'[data-tour-tag="file-row"] button[aria-haspopup="menu"][aria-label*="notes.md"][aria-expanded="false"]',
			DOWNLOAD_ITEM_SELECTOR,
		],
	);
	assert.equal(
		DOWNLOAD_ITEM_SELECTOR,
		'[role="menu"] [data-remote-action="download"]:not([data-disabled])',
	);
	assert.ok(
		scene.every((s) => s.optional !== true),
		"no optional step",
	);
	// The entry is REQUIRED before it is pressed, and success is required after.
	const at = scene.findIndex(
		(s) => s.verb === "press" && s.payload.selector === DOWNLOAD_ITEM_SELECTOR,
	);
	assert.equal(scene[at - 1].verb, "waitFor");
	assert.equal(scene[at - 1].payload.selector, DOWNLOAD_ITEM_SELECTOR);
	assert.equal(
		scene.at(-1).payload.selector,
		'[data-sonner-toast][data-type="success"]',
	);
	assert.equal(scene.at(-2).payload.timeoutMs, DOWNLOAD_OUTCOME_WAIT_MS);
	assert.equal(downloadStepsProblem(steps), null);
	for (const selector of [
		'[data-remote-action="save-as"]',
		"[data-remote-action]",
		'[data-remote-action^="down"]',
		'[data-remote-action="copy-image"]',
		'[data-remote-action="open-folder"]',
		"button[aria-label='Save as…']",
	])
		assert.match(
			downloadStepsProblem([
				...steps,
				{ verb: "press", payload: { selector } },
			]) ?? "",
			/never presses|only remote action/,
			selector,
		);
	// Waiting on Save as is harmless; only a press is a write.
	assert.equal(
		downloadStepsProblem([
			{
				verb: "waitFor",
				payload: { selector: '[data-remote-action="save-as"]' },
			},
		]),
		null,
	);
	assert.match(
		downloadFailureHint(
			`step 12 verb=waitFor error: nothing matches ${DOWNLOAD_ITEM_SELECTOR} after 5000ms of waiting`,
		) ?? "",
		/no enabled Download entry.*never falls back to Save as/,
	);
	assert.equal(downloadFailureHint("step 3 verb=navigate error: x"), null);
});

test("download: the harness's daemon client still refuses the download POST (the app sends it, never the harness)", () => {
	assert.match(
		daemonRequestProblem(
			"POST",
			"/v1/desktop/sessions/ce618964c88e/files/f1/download",
		) ?? "",
		/./,
	);
	assert.ok(
		DAEMON_ROUTES.every((r) => r.method === "GET"),
		JSON.stringify(DAEMON_ROUTES),
	);
});

test("download: the manifest entry is picked by name; a non-file, a missing entry or a bad entry refuses", () => {
	const good = manifestFile("m-good", [
		{ filename: "image-1.png", bytes: 194, sha256: "a".repeat(64) },
		{ filename: "notes.md", bytes: 46, sha256: NOTES_SHA },
	]);
	assert.deepEqual(manifestEntry(good, "notes.md"), {
		filename: "notes.md",
		bytes: 46,
		sha256: NOTES_SHA,
	});
	assert.throws(() => manifestEntry(TREE, "notes.md"), /not a regular file/);
	assert.throws(
		() => manifestEntry(join(TREE, "absent.json"), "notes.md"),
		/does not exist/,
	);
	assert.throws(
		() => manifestEntry(good, "tone.wav"),
		/no entry for tone\.wav/,
	);
	const notJson = join(TREE, "m-bad.json");
	writeFileSync(notJson, "{");
	assert.throws(() => manifestEntry(notJson, "notes.md"), /not JSON/);
	assert.throws(
		() =>
			manifestEntry(manifestFile("m-nolist", []).replace(/$/, ""), "notes.md"),
		/no entry/,
	);
	assert.throws(
		() =>
			manifestEntry(
				manifestFile("m-twice", [
					{ filename: "notes.md", bytes: 46, sha256: NOTES_SHA },
					{ filename: "notes.md", bytes: 46, sha256: NOTES_SHA },
				]),
				"notes.md",
			),
		/more than once/,
	);
	assert.throws(
		() =>
			manifestEntry(
				manifestFile("m-shape", [
					{ filename: "notes.md", bytes: "46", sha256: "x" },
				]),
				"notes.md",
			),
		/64-hex sha256 and an integer bytes/,
	);
});

test("download: destinations are vetted (symlink, outside, inside ~/Downloads, already present) and the landing is compared", () => {
	const dev = join(TREE, "dl-dev");
	const home = join(dev, "home");
	const config = join(dev, "config");
	const operatorDownloads = join(TREE, "dl-operator", "Downloads");
	mkdirSync(join(home, "Downloads"), { recursive: true });
	mkdirSync(config, { recursive: true });
	mkdirSync(operatorDownloads, { recursive: true });
	const opts = {
		downloadFile: null,
		manifest: manifestFile("m-dest", [
			{
				filename: "notes.md",
				bytes: Buffer.byteLength(NOTES),
				sha256: NOTES_SHA,
			},
		]),
		backendConfigRoot: config,
	};
	const plan = downloadPreflight(opts, {
		backendHome: home,
		operatorDownloads,
	});
	assert.deepEqual(
		plan.destinations.map((d) => [d.dir, d.exists]),
		[
			[join(home, "Downloads"), true],
			[join(config, "downloads"), false],
		],
	);
	assert.equal(plan.manifest.entry.sha256, NOTES_SHA);
	// A symlinked downloads folder (e.g. to the real ~/Downloads) is refused.
	const linked = join(TREE, "dl-linked");
	mkdirSync(join(linked, "home"), { recursive: true });
	mkdirSync(join(linked, "config"), { recursive: true });
	symlinkSync(operatorDownloads, join(linked, "home", "Downloads"));
	assert.throws(
		() =>
			downloadDestinations({
				backendHome: join(linked, "home"),
				configRoot: join(linked, "config"),
				operatorDownloads,
			}),
		/is a symlink/,
	);
	// A rig sited inside the operator's ~/Downloads.
	const nested = join(operatorDownloads, "rig");
	mkdirSync(join(nested, "home", "Downloads"), { recursive: true });
	mkdirSync(join(nested, "config"), { recursive: true });
	assert.throws(
		() =>
			downloadDestinations({
				backendHome: join(nested, "home"),
				configRoot: join(nested, "config"),
				operatorDownloads,
			}),
		/inside the operator's ~\/Downloads/,
	);
	// A file already there: the backend would reuse it and land nothing new.
	const pre = join(TREE, "dl-pre");
	mkdirSync(join(pre, "home", "Downloads"), { recursive: true });
	mkdirSync(join(pre, "config"), { recursive: true });
	writeFileSync(join(pre, "home", "Downloads", "notes.md"), NOTES);
	assert.throws(
		() =>
			downloadPreflight(
				{ ...opts, backendConfigRoot: join(pre, "config") },
				{ backendHome: join(pre, "home"), operatorDownloads },
			),
		/already exists in the rig/,
	);

	// The landing: nothing, a match, a mismatch, a (1) variant, two files.
	const before = new Map(
		plan.destinations.map((d) => [d.dir, listNames(d.dir)]),
	);
	const rigRoots = [home, config];
	const none = inspectLanding(plan, before, { rigRoots });
	assert.match(none.problem, /no notes\.md appeared in the rig/);
	assert.equal(none.result.verdict, "FAIL");
	writeFileSync(join(home, "Downloads", "unrelated.txt"), "x");
	assert.match(
		inspectLanding(plan, before, { rigRoots }).problem,
		/no notes\.md/,
	);
	writeFileSync(join(home, "Downloads", "notes.md"), NOTES);
	const pass = inspectLanding(plan, before, { rigRoots });
	assert.equal(pass.problem, null);
	assert.deepEqual(
		{
			destination: pass.result.destination,
			insideRig: pass.result.insideRig,
			bytes: pass.result.bytes,
			sha256: pass.result.sha256,
			compared: pass.result.compared,
			verdict: pass.result.verdict,
			manifest: pass.result.manifest.entry,
		},
		{
			destination: join(home, "Downloads", "notes.md"),
			insideRig: true,
			bytes: Buffer.byteLength(NOTES),
			sha256: NOTES_SHA,
			compared: "match",
			verdict: "PASS",
			manifest: {
				filename: "notes.md",
				bytes: Buffer.byteLength(NOTES),
				sha256: NOTES_SHA,
			},
		},
	);
	writeFileSync(join(home, "Downloads", "notes.md"), `${NOTES}tampered`);
	const bad = inspectLanding(plan, before, { rigRoots });
	assert.match(
		bad.problem,
		new RegExp(`the manifest says ${Buffer.byteLength(NOTES)} B sha256 `),
	);
	assert.equal(bad.result.compared, "mismatch");
	assert.equal(bad.result.verdict, "FAIL");
	writeFileSync(join(home, "Downloads", "notes (1).md"), NOTES);
	assert.match(
		inspectLanding(plan, before, { rigRoots }).problem,
		/more than one new download landed/,
	);
	// Without a manifest the receipt says nothing was compared.
	const loose = { ...plan, manifest: null };
	const looseBefore = new Map([
		[join(home, "Downloads"), listNames(join(home, "Downloads"))],
		[join(config, "downloads"), { exists: false, names: [] }],
	]);
	mkdirSync(join(config, "downloads"));
	writeFileSync(join(config, "downloads", "notes.md"), NOTES);
	const fallback = inspectLanding(loose, looseBefore, { rigRoots });
	assert.equal(fallback.problem, null);
	assert.equal(
		fallback.result.destination,
		join(config, "downloads", "notes.md"),
	);
	assert.equal(fallback.result.compared, "not compared (no --manifest)");
	assert.deepEqual(landingNames("notes.md").slice(0, 3), [
		"notes.md",
		"notes (1).md",
		"notes (2).md",
	]);
	assert.equal(landingNames("README").at(-1), "README (99)");
});

test("download: any new name in the operator's ~/Downloads is a stray; names only", () => {
	const dir = join(TREE, "dl-stray", "Downloads");
	assert.deepEqual(listNames(dir), { exists: false, names: [] });
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "b.pdf"), "x");
	writeFileSync(join(dir, "a.txt"), "x");
	const before = listNames(dir);
	assert.deepEqual(before, { exists: true, names: ["a.txt", "b.pdf"] });
	assert.deepEqual(strayDownloadsProblem(before, listNames(dir)), {
		newEntries: [],
		problem: null,
	});
	writeFileSync(join(dir, "notes.md"), NOTES);
	const stray = strayDownloadsProblem(before, listNames(dir));
	assert.deepEqual(stray.newEntries, ["notes.md"]);
	assert.match(
		stray.problem,
		/new entry appeared in the operator's ~\/Downloads.*notes\.md/,
	);
	// A folder that did not exist at start and does at end: all of it is new.
	assert.deepEqual(
		strayDownloadsProblem(
			{ exists: false, names: [] },
			{ exists: true, names: ["x"] },
		).newEntries,
		["x"],
	);
	// The passwd home, never $HOME (a rig may set HOME).
	assert.equal(operatorDownloadsDir("/Users/u"), join("/Users/u", "Downloads"));
	assert.equal(
		operatorDownloadsDir(),
		join(os.userInfo().homedir, "Downloads"),
	);
});

test("download: a --manifest that is a directory refuses with exit 2 before any lop process", () => {
	const relayPort = 20000 + Math.floor(Math.random() * 20000);
	const device = rigDevice(
		"dl-refuse",
		`values:\n  network:\n    port: ${relayPort}\n`,
	);
	const run = runHarness([
		"--app",
		fakeApp("DlRefuse"),
		"--out",
		join(TREE, "dl-refuse-out"),
		"--rig-root",
		join(TREE, "dl-refuse-rig"),
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--backend-config-root",
		device.config,
		"--session",
		"ce618964c88e",
		"--scene",
		"download",
		"--theme",
		"dark",
		"--manifest",
		TREE,
	]);
	assert.equal(run.status, 2, run.all);
	assert.match(run.all, /--manifest .* is not a regular file/);
	assert.ok(
		!existsSync(join(device.config, "fake-relay-seen.json")),
		"no relay",
	);
	assert.ok(!existsSync(join(TREE, "dl-refuse-rig")), "no rig was made");
	// attach: refused by the flags alone, nothing spawned, no rig.
	const attach = runHarness([
		"--app",
		fakeApp("DlRefuse"),
		"--out",
		join(TREE, "dl-refuse-out2"),
		"--rig-root",
		join(TREE, "dl-refuse-rig2"),
		"--capture",
		"capturepage",
		"--session",
		"ce618964c88e",
		"--scene",
		"download",
		"--theme",
		"dark",
		"--backend",
		"attach",
		"--backend-url",
		"http://127.0.0.1:5555",
	]);
	assert.equal(attach.status, 2, attach.all);
	assert.match(attach.all, /refuses --backend attach/);
	assert.ok(!existsSync(join(TREE, "dl-refuse-rig2")));
});

/** One config-root download run against the fake app + fake lop. */
async function downloadRun(
	name,
	{ manifestSha = NOTES_SHA, post = true } = {},
) {
	const relayPort = 20000 + Math.floor(Math.random() * 20000);
	const device = rigDevice(
		name,
		`values:\n  network:\n    port: ${relayPort}\n`,
	);
	mkdirSync(join(device.home, "Downloads"));
	writeFileSync(
		join(device.config, "fake-sessions.json"),
		JSON.stringify([{ id: "ce618964c88e", locality: "remote" }]),
	);
	writeFileSync(
		join(device.config, "fake-download.json"),
		JSON.stringify({ name: "notes.md", text: NOTES }),
	);
	const manifest = manifestFile(`${name}-manifest`, [
		{
			filename: "notes.md",
			bytes: Buffer.byteLength(NOTES),
			sha256: manifestSha,
		},
	]);
	const rigRoot = join(TREE, `${name}-rig`);
	const out = join(TREE, `${name}-out`);
	const run = await runHarnessAsync([
		"--app",
		fakeApp(`Dl${name}`, { downloadPost: post }),
		"--out",
		out,
		"--rig-root",
		rigRoot,
		"--capture",
		"capturepage",
		"--lop",
		fakeLop(),
		"--backend-config-root",
		device.config,
		"--session",
		"ce618964c88e",
		"--scene",
		"download",
		"--theme",
		"dark",
		"--manifest",
		manifest,
		"--peer-wait",
		"30",
	]);
	const rig = rigOf(rigRoot);
	trackPids(rig, device.config);
	const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
	const requests = JSON.parse(
		readFileSync(join(device.config, "fake-serve-requests.json"), "utf8"),
	);
	return { run, receipt, requests, device, manifest };
}

it("download e2e: the app's POST lands notes.md in the rig; the receipt records path, bytes, sha256, manifest and ~/Downloads", async () => {
	const { run, receipt, requests, device, manifest } =
		await downloadRun("dl-ok");
	assert.equal(run.status, 0, run.all);
	const landed = join(device.home, "Downloads", "notes.md");
	assert.equal(readFileSync(landed, "utf8"), NOTES);
	assert.equal(receipt.download.destination, landed);
	assert.equal(receipt.download.insideRig, true);
	assert.equal(receipt.download.bytes, Buffer.byteLength(NOTES));
	assert.equal(receipt.download.sha256, NOTES_SHA);
	assert.equal(receipt.download.compared, "match");
	assert.equal(receipt.download.verdict, "PASS");
	assert.deepEqual(receipt.download.manifest, {
		path: manifest,
		entry: {
			filename: "notes.md",
			bytes: Buffer.byteLength(NOTES),
			sha256: NOTES_SHA,
		},
	});
	assert.match(
		receipt.download.route,
		/^POST \/v1\/desktop\/sessions\/<session>\/files\/<file id>\/download/,
	);
	assert.equal(
		receipt.download.operatorDownloads.path,
		join(os.userInfo().homedir, "Downloads"),
	);
	assert.deepEqual(receipt.download.operatorDownloads.newEntries, []);
	// Exactly one write, and it came from the app; everything else was a GET.
	const writes = requests.filter((r) => !r.startsWith("GET "));
	assert.deepEqual(writes, [
		"POST /v1/desktop/sessions/ce618964c88e/files/f1/download",
	]);
	assert.ok(existsSync(join(TREE, "dl-ok-out", "download-dark.png")));
});

it("download e2e: a landed file whose sha256 differs from the manifest fails the run (exit 1)", async () => {
	const { run, receipt } = await downloadRun("dl-sha", {
		manifestSha: "0".repeat(64),
	});
	assert.equal(run.status, 1, run.all);
	assert.match(run.all, /the manifest says \d+ B sha256 0{64}/);
	assert.equal(receipt.download.compared, "mismatch");
	assert.equal(receipt.download.verdict, "FAIL");
	assert.equal(receipt.download.sha256, NOTES_SHA);
});

it("download e2e: no file landing in the rig fails the run (exit 1)", async () => {
	const { run, receipt } = await downloadRun("dl-none", { post: false });
	assert.equal(run.status, 1, run.all);
	assert.match(run.all, /no notes\.md appeared in the rig/);
	assert.equal(receipt.download.verdict, "FAIL");
	assert.equal(receipt.download.destination, null);
});

/* ---------------------------------- end to end, as one bounded concurrent group */

describe(
	"end to end against the fake app and fake lop",
	{ concurrency: E2E_CONCURRENCY },
	() => {
		for (const args of e2eCases) test(...args);
	},
);

/*
 * ---------------------------------------------------------------------------
 * Scene waits on SETTLED data (79's be9379d8 Mac run) and the file-preview
 * scene. The app under capture is v0.59.2, so every selector is anchored to that
 * tag's source: the anchors below are frozen here (file:line + the text on that
 * line) so the selector check runs in any clone, and the full-checkout test
 * re-reads each line from the tag itself. A SOURCE-LEVEL proof plus a DOM proof
 * on fixtures shaped like that markup (jsdom); the live Mac run is the frame proof.
 * ---------------------------------------------------------------------------
 */
const V0592_ANCHORS = Object.freeze([
	// [file, line, text on that line at v0.59.2, the selector fragment it backs]
	[
		"src/renderer/src/features/chat/components/canvas/index.tsx",
		836,
		'data-tour-tag="canvas-container"',
		'[data-tour-tag="canvas-container"]',
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		811,
		'data-tour-tag="files-scroller"',
		'[data-tour-tag="files-scroller"]',
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		860,
		'<p className={cn("text-heading text-ink")}>',
		"> div > p",
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		875,
		'<p className={cn("max-w-prose text-body-sm text-ink-muted")}>',
		"p + :is(p, button)",
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		882,
		'<p className={cn("max-w-80 text-body-sm text-ink-muted")}>',
		"p + :is(p, button)",
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		887,
		'<Button variant="outline" size="sm" onClick={index.refresh}>',
		"p + :is(p, button)",
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		1073,
		'<span className={cn("text-meta text-ink-dim")}>',
		"span.text-ink-dim",
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		1080,
		'title={t("ui.canvas.files.attachmentsPartialReason")}',
		":not([title])",
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		1437,
		'data-tour-tag="file-row"',
		'[data-tour-tag="file-row"]',
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		1533,
		'data-tour-tag="file-row"',
		'[data-tour-tag="file-row"]',
	],
	// F1: index rows vs attachment rows, told apart by the row id.
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		1438,
		"data-file-id={doc.id}",
		"[data-file-id]",
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		1534,
		"data-file-id={doc.id}",
		"[data-file-id]",
	],
	[
		"src/renderer/src/features/chat/components/canvas/attachment-items.ts",
		41,
		'export const ATTACHMENT_ID_PREFIX = "attachment:";',
		'[data-file-id^="attachment:"]',
	],
	[
		"src/renderer/src/features/chat/components/canvas/attachment-items.ts",
		140,
		"id: `${ATTACHMENT_ID_PREFIX}${item.key}`,",
		'[data-file-id^="attachment:"]',
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		1552,
		"title={tooltip}",
		"[title^=",
	],
	[
		"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
		1553,
		'onClick={tiled && item.row.media === "image" ? onExpand : onOpen}',
		'button[aria-haspopup="menu"]',
	],
	[
		"src/renderer/src/features/chat/components/remote-file-actions-menu.tsx",
		218,
		"<DropdownMenuTrigger asChild>",
		'button[aria-haspopup="menu"]',
	],
	[
		"src/renderer/src/features/chat/components/remote-file-actions-menu.tsx",
		262,
		"data-remote-action={action.id}",
		'[data-remote-action="show-in-canvas"]',
	],
	// The VALUE `action.id` takes for the canvas entry (F3: values, not names).
	[
		"src/renderer/src/features/chat/components/remote-file-actions-menu.tsx",
		130,
		'case "show-in-canvas":',
		'[data-remote-action="show-in-canvas"]',
	],
	[
		"src/renderer/src/features/chat/components/canvas/image-preview.tsx",
		129,
		"alt={document.title}",
		"img[alt=",
	],
	[
		"src/renderer/src/features/chat/components/canvas/image-preview.tsx",
		240,
		"alt={document.title}",
		"img[alt=",
	],
	[
		"src/renderer/src/shared/components/common/image-lightbox.tsx",
		716,
		'data-image-viewport=""',
		":not([data-image-viewport] img)",
	],
	[
		"src/renderer/src/features/library/components/library-page.tsx",
		789,
		'data-library-page=""',
		"[data-library-page]",
	],
	[
		"src/renderer/src/features/library/components/library-page.tsx",
		1002,
		'data-library-building=""',
		"[data-library-building]",
	],
	[
		"src/renderer/src/features/library/components/library-page.tsx",
		1019,
		'data-library-results=""',
		"[data-library-results]",
	],
	[
		"src/renderer/src/features/library/components/library-page.tsx",
		1021,
		"aria-busy={listing.isLoading || listing.isFetching}",
		'[aria-busy="false"]',
	],
	[
		"src/renderer/src/features/library/components/library-card.tsx",
		521,
		'data-library-skeleton=""',
		"[data-library-skeleton]",
	],
	["src/main/dev-driver-script.ts", 65, '"press",', "press"],
	["src/main/dev-driver-script.ts", 67, '"waitFor",', "waitFor"],
	[
		"src/renderer/src/dev-driver/install.ts",
		263,
		'element.dispatchEvent(new MouseEvent("click"',
		"press",
	],
	[
		"src/renderer/src/dev-driver/install.ts",
		903,
		"const present = document.querySelector(selector) !== null;",
		"waitFor",
	],
]);

/** Every selector the three scenes' waits and presses use, at the default preview file. */
function sceneSelectors() {
	const preview = filePreviewSceneSteps(PREVIEW_FILE_DEFAULT);
	return [
		FILES_READY,
		SCENE_READY.library,
		...preview
			.filter((s) => s.payload?.selector)
			.map((s) => s.payload.selector),
	].join("\n");
}

test("v0.59.2 anchors: every selector fragment is backed by a frozen tag line, and every verb is shipped", () => {
	const all = sceneSelectors();
	for (const [file, line, , fragment] of V0592_ANCHORS)
		if (!["press", "waitFor"].includes(fragment))
			assert.ok(
				all.includes(fragment),
				`${file}:${line} backs ${fragment}, which no selector uses`,
			);
	// And the other way: each attribute a selector names is one an anchor names.
	const attrs = new Set(
		all.match(/\[(?:data-[a-z-]+|aria-[a-z]+|role|title|alt)/g),
	);
	const anchored = [...V0592_ANCHORS, ...RADIX_ANCHORS]
		.map((a) => a[3])
		.join("\n");
	for (const attr of attrs)
		assert.ok(anchored.includes(attr), `${attr} has no v0.59.2 anchor`);
	const shipped = new Set([
		"navigate",
		"setTheme",
		"press",
		"state",
		"waitFor",
		"openCanvas",
		"skipOnboarding",
		"shutter",
	]);
	const { steps } = buildSteps({
		scenes: ["files", "file-preview", "library"],
		themes: ["dark", "light"],
		session: "ce618964c88e",
		capture: "capturepage",
	});
	assert.ok(steps.every((s) => shipped.has(s.verb)));
});

/*
 * F3: VALUE-level coverage. The test above checks attribute NAMES, so a
 * selector reading `[data-tour-tag="file-rows"]` or `[data-file-id^="attachmnt:"]`
 * would still pass it. Here every `[attr op "value"]` token the scene waits and
 * presses use must be, verbatim, the fragment of an anchor whose frozen v0.59.2
 * line SHOWS that value - the literal string, or for a boolean ARIA value an
 * expression assigned to that attribute (React renders it "true"/"false").
 * `title`/`alt` values are exempt: they are the --preview-file name, not markup
 * (their exact-name behaviour is pinned by the file-preview tests).
 */
test("v0.59.2 anchors: every attribute VALUE a selector matches is one a frozen tag line shows", () => {
	const anchors = [...V0592_ANCHORS, ...RADIX_ANCHORS];
	const tokens = new Set(sceneSelectors().match(/\[[a-z-]+[\^$*]?="[^"]*"\]/g));
	let checked = 0;
	for (const token of tokens) {
		const [, attr, value] = token.match(/^\[([a-z-]+)[\^$*]?="([^"]*)"\]$/);
		if (attr === "title" || attr === "alt") continue;
		const backing = anchors.filter((a) => a[3] === token);
		assert.ok(backing.length, `${token} is no anchor's fragment`);
		const shown = backing.some(
			([, , text]) =>
				text.includes(`"${value}"`) ||
				(["true", "false"].includes(value) && text.includes(`${attr}={`)),
		);
		assert.ok(shown, `no anchor line for ${token} shows the value ${value}`);
		checked++;
	}
	// The tokens this PR introduced, named so a refactor cannot drop them unseen.
	for (const token of [
		'[data-tour-tag="files-scroller"]',
		'[data-tour-tag="file-row"]',
		'[data-file-id^="attachment:"]',
		'[data-remote-action="show-in-canvas"]',
		'[aria-busy="false"]',
		'[aria-haspopup="menu"]',
		'[role="menu"]',
	])
		assert.ok(tokens.has(token), `${token} is in a scene selector`);
	assert.ok(checked >= 7, `checked ${checked} valued tokens`);
	// And the check bites: a misspelt value has no anchor.
	assert.equal(
		anchors.some((a) => a[3] === '[data-tour-tag="file-rows"]'),
		false,
	);
});

/*
 * The menu's own attributes come from Radix, not from app source: the
 * versions v0.59.2's pnpm-lock.yaml pins (radix-ui 1.6.7 ->
 * @radix-ui/react-dropdown-menu 2.1.24 / react-menu) render them. Checked
 * against the INSTALLED package when it is that pinned version.
 */
const RADIX_DROPDOWN = "@radix-ui/react-dropdown-menu@2.1.24";
const RADIX_ANCHORS = Object.freeze([
	[
		"@radix-ui/react-dropdown-menu/dist/index.mjs",
		null,
		'"aria-haspopup": "menu"',
		'[aria-haspopup="menu"]',
	],
	[
		"@radix-ui/react-menu/dist/index.mjs",
		null,
		'role: "menu"',
		'[role="menu"]',
	],
	[
		"@radix-ui/react-menu/dist/index.mjs",
		null,
		'"data-disabled": disabled ? "" : void 0',
		"[data-disabled]",
	],
]);

test("Radix anchors: the pinned dropdown renders aria-haspopup, role=menu and data-disabled", () => {
	const lock = readFileSync(
		new URL("../pnpm-lock.yaml", import.meta.url),
		"utf8",
	);
	assert.ok(
		lock.includes(`'${RADIX_DROPDOWN}'`),
		`the lockfile pins ${RADIX_DROPDOWN}`,
	);
	const dropdown = join(process.cwd(), "node_modules/.pnpm");
	const dir = readdirSync(dropdown).find((d) => d.startsWith("radix-ui@1.6.7"));
	assert.ok(dir, "radix-ui@1.6.7 is installed");
	for (const [file, , text] of RADIX_ANCHORS) {
		const source = readFileSync(
			join(dropdown, dir, "node_modules", file),
			"utf8",
		);
		assert.ok(source.includes(text), `${file} renders ${text}`);
	}
});

test("v0.59.2 anchors match the tag's own source, line for line (full checkout)", (t) => {
	const repo = new URL("..", import.meta.url).pathname;
	if (
		spawnSync("git", ["cat-file", "-e", "v0.59.2^{commit}"], { cwd: repo })
			.status !== 0
	) {
		// A LOCAL-ONLY guarantee (F3). CI checks out with `fetch-depth: 2` and no
		// tags (.github/workflows/ci.yml), so in CI this test always skips and the
		// selectors are bound by the frozen anchors and the name- and value-level
		// tests above - which prove the selectors agree with the anchor TEXT, not
		// that the text is still what v0.59.2 says. That second half is checked
		// here, where the anchors are edited: a full local checkout with tags.
		// Said loudly, never a silent pass.
		t.skip(
			"v0.59.2 is not in this clone (shallow, no tags); the line-for-line re-read runs in a full checkout",
		);
		return;
	}
	const cache = new Map();
	for (const [file, line, text] of V0592_ANCHORS) {
		if (!cache.has(file)) {
			const shown = spawnSync("git", ["show", `v0.59.2:${file}`], {
				cwd: repo,
				encoding: "utf8",
			});
			assert.equal(shown.status, 0, `git show v0.59.2:${file}`);
			cache.set(file, shown.stdout.split("\n"));
		}
		assert.ok(
			cache.get(file)[line - 1].includes(text),
			`v0.59.2:${file}:${line} no longer reads ${text}`,
		);
	}
});

/* Fixtures shaped like v0.59.2's markup (finder-files-view.tsx :811-:895, :912-:1089, :1533-:1553). */
const fileRows = (ids) =>
	ids
		.map(
			(id) =>
				`<div data-tour-tag="file-row" data-file-id="${id}"><button title="${id}">x</button></div>`,
		)
		.join("");
// The Attachments <section> has no attribute of its own (:912-915).
const attachmentsSection = (...ids) =>
	`<section><h3><button>Attachments<span class="text-meta text-ink-muted">${ids.length}</span></button></h3><ul data-tour-tag="files-grid"><li><div class="grid">${fileRows(ids)}</div></li></ul></section>`;
const imagesSection = (...ids) =>
	`<section><h3><button>Images<span class="text-meta text-ink-muted">${ids.length}</span></button></h3><ul data-tour-tag="files-grid"><li><div class="grid">${fileRows(ids)}</div></li></ul></section>`;
const chatHeader = '<header data-chat-region="header"></header>';
const filesShell = (inner) =>
	`${chatHeader}<section data-tour-tag="canvas-container"><section data-tour-tag="files-scroller">${inner}</section></section>`;
const FILES_FACES = Object.freeze({
	loading: [
		filesShell('<div><p class="text-heading">Loading session files…</p></div>'),
		false,
	],
	building: [
		filesShell(
			'<div><p class="text-heading">Building the file index…</p></div>',
		),
		false,
	],
	empty: [
		filesShell(
			'<div><p class="text-heading">No files yet</p><p class="max-w-80">Files the agent creates…</p></div>',
		),
		true,
	],
	error: [
		filesShell(
			'<div><p class="text-heading">Could not load session files</p><button>Retry</button></div>',
		),
		true,
	],
	unsupported: [
		filesShell(
			'<div><p class="text-heading">Remote files are unavailable here</p><p class="max-w-prose">How to fix</p><button>Retry</button></div>',
		),
		true,
	],
	rows: [
		filesShell(
			'<section><h3><button>Images<span class="text-meta text-ink-muted">1</span></button></h3><ul><div data-tour-tag="file-row" data-file-id="remote:f_1"><button title="/Users/o/image-1.png\nOn mac">i</button></div></ul></section>',
		),
		true,
	],
	"rows, attachments still loading": [
		filesShell(
			'<section><h3><button>Attachments<span class="text-meta text-ink-muted">0</span><span class="text-meta text-ink-dim">Loading session files…</span></button></h3></section><section><ul><div data-tour-tag="file-row" data-file-id="remote:f_1"></div></ul></section>',
		),
		false,
	],
	"rows, attachments partial": [
		filesShell(
			'<section><h3><button>Attachments<span class="text-meta text-ink-dim" title="why">May be incomplete</span></button></h3></section><section><ul><div data-tour-tag="file-row" data-file-id="remote:f_1"></div></ul></section>',
		),
		true,
	],
	// F1 (the reviewer's jsdom repro): attachments arrived, the INDEX is still
	// loading - the Attachments section has no caption, the count line is blank
	// (:693), and its rows carry the same data-tour-tag. Must NOT pass.
	"attachments only (index still loading)": [
		filesShell(attachmentsSection("attachment:k1", "attachment:k2")),
		false,
	],
	"attachments + index rows": [
		filesShell(
			`${attachmentsSection("attachment:k1")}${imagesSection("artifact:9277c383aa", "remote:f_2")}`,
		),
		true,
	],
	"index rows only (local session)": [
		filesShell(imagesSection("/Users/me/work/image-1.png")),
		true,
	],
	"a row with no data-file-id": [
		filesShell(
			'<section><ul><div data-tour-tag="file-row"></div></ul></section>',
		),
		false,
	],
	// F2: the two v0.59.2 states where a button follows a loading/building
	// heading. They DO pass - pinned so the comment's claim stays true - and the
	// harness cannot reach either (fresh profile: no filter; 20 s wait: far
	// before the 60th building poll).
	"building + Continue (after 60 polls; unreachable in 20 s)": [
		filesShell(
			'<div><p class="text-heading">Building the file index…</p><button>Continue</button></div>',
		),
		true,
	],
	"loading + Clear (an active filter; unreachable on a fresh profile)": [
		filesShell(
			'<div><p class="text-heading">Loading session files…</p><button>Clear</button></div>',
		),
		true,
	],
});
const matches = (html, selector) =>
	new JSDOM(html).window.document.querySelector(selector) !== null;

test("files: the wait passes on rows, the empty state or an explicit error, and never on a loading face", () => {
	for (const [face, [html, settled]] of Object.entries(FILES_FACES))
		assert.equal(matches(html, FILES_READY), settled, face);
	const { steps } = buildSteps({
		scenes: ["files"],
		themes: ["light"],
		session: "ce618964c88e",
		capture: "screencapture",
		windowWaitS: 0,
	});
	const shutter = steps.findIndex((s) => s.payload?.label === "files-light");
	assert.deepEqual(steps[shutter - 1], {
		verb: "waitFor",
		payload: { selector: FILES_READY, timeoutMs: 20000 },
		timeoutMs: 25000,
	});
});

test("files: the base step list (no data wait) would have shuttered the loading face 79 photographed", () => {
	// Quoted from origin/main 53d86477e3 `buildSteps({scenes:["files"]})`, the
	// steps behind 79's files-light.png ("Loading session files…"):
	const base = [
		{ verb: "navigate", payload: "/chat" },
		{ verb: "openCanvas", payload: { view: "files" } },
		{ verb: "waitFor", payload: { selector: '[data-chat-region="header"]' } },
		{ verb: "shutter", payload: { label: "files-light", capture: "external" } },
	];
	const loading = FILES_FACES.loading[0];
	assert.equal(
		matches(loading, base[2].payload.selector),
		true,
		"the base wait passes on the loading face",
	);
	assert.equal(matches(loading, FILES_READY), false, "the new wait does not");
});

test("library: the wait needs settled results; the base header wait passed over the skeleton", () => {
	const page = (busy, inner = "", header = "") =>
		`<div data-library-page><header data-library-header>${header}</header><section data-library-results aria-busy="${busy}">${inner}</section></div>`;
	const faces = {
		skeleton: [page("true", "<div data-library-skeleton></div>"), false],
		"refetching (busy)": [
			page("true", '<div data-library-card-id="la_0000000000000001"></div>'),
			false,
		],
		"indexing (building line)": [
			page(
				"false",
				'<div data-library-card-id="la_0000000000000001"></div>',
				"<div data-library-building></div>",
			),
			false,
		],
		cards: [
			page("false", '<div data-library-card-id="la_0000000000000001"></div>'),
			true,
		],
		empty: [page("false", "<div><p>Nothing here yet</p></div>"), true],
	};
	for (const [face, [html, settled]] of Object.entries(faces))
		assert.equal(matches(html, SCENE_READY.library), settled, face);
	// origin/main 53d86477e3's library wait, `[data-library-page] [data-library-header]`:
	assert.equal(
		matches(faces.skeleton[0], "[data-library-page] [data-library-header]"),
		true,
	);
});

test("file-preview: Files settled -> the row's menu -> Show in canvas -> the painted canvas picture", () => {
	const steps = filePreviewSceneSteps("image-1.png");
	assert.deepEqual(
		steps.map((s) => s.verb),
		["navigate", "openCanvas", "waitFor", "press", "press", "waitFor"],
	);
	assert.deepEqual(steps[1].payload, { view: "files" });
	assert.equal(steps[2].payload.selector, FILES_READY);
	assert.ok(
		steps.every((s) => s.optional !== true),
		"no optional step: a miss fails the run",
	);
	const [trigger, entry, preview] = [steps[3], steps[4], steps[5]].map(
		(s) => s.payload.selector,
	);
	const entry1 = (
		title,
		menu = '<div><button aria-haspopup="menu" data-t="menu">⋯</button></div>',
		id = "remote:f_1",
		t = "menu",
	) =>
		`<div data-tour-tag="file-row" data-file-id="${id}"><button title="${title}">x</button>${menu.replace('data-t="menu"', `data-t="${t}"`)}</div>`;
	const row = (title, menu, id) =>
		`<section data-tour-tag="files-scroller">${entry1(title, menu, id)}</section>`;
	const pick = (html, sel) =>
		new JSDOM(html).window.document
			.querySelector(sel)
			?.getAttribute("data-t") ?? null;
	assert.equal(
		pick(row("/Users/o/work/image-1.png\nOn mac"), trigger),
		"menu",
		"owner's path row",
	);
	assert.equal(
		pick(row("image-1.png · 9277c383 · Image"), trigger),
		"menu",
		"artifact row",
	);
	assert.equal(
		pick(row("/Users/o/image-2.png"), trigger),
		null,
		"another picture",
	);
	// F4 / QA Q1-2: the EXACT name - a prefix or suffix of it is another file.
	for (const [title, want, why] of [
		["/Users/o/image-1.png.bak\nOn mac", null, ".bak beside it"],
		["/Users/o/image-1.png.orig", null, ".orig, last line"],
		[
			"image-1.png.bak · 9277c383 · Generated image, kept in this session",
			null,
			"artifact .bak",
		],
		["/Users/o/copy image-1.png", null, "a longer name ending in it"],
		["/Users/o/image-1.png", "menu", "local path row, one line"],
		["image-1.png\nOn mac", "menu", "bare owner path, then the device line"],
		["image-1.png", "menu", "bare name, one line"],
		[
			"image-1.png · 9277c383 · Generated image, kept in this session",
			"menu",
			"artifact tooltip (artifact-identity.ts:200-211)",
		],
	])
		assert.equal(pick(row(title), trigger), want, why);
	// The .bak row FIRST in the list no longer wins the press.
	assert.equal(
		pick(
			`<section data-tour-tag="files-scroller">${entry1("/Users/o/image-1.png.bak", undefined, "remote:f_0", "bak")}${entry1("/Users/o/image-1.png\nOn mac", undefined, "remote:f_1", "real")}</section>`,
			trigger,
		),
		"real",
	);
	// F1: an attachment row of the same name is the person's upload, never pressed.
	assert.equal(
		pick(row("/Users/me/image-1.png", undefined, "attachment:k1"), trigger),
		null,
		"attachment row",
	);
	assert.equal(
		pick(
			row("/Users/o/image-1.png", "<div><button>Expand</button></div>"),
			trigger,
		),
		null,
		"no menu, no press",
	);
	const menu = (disabled) =>
		`<div role="menu"><div role="menuitem" data-remote-action="show-in-canvas" ${disabled ? 'data-disabled=""' : ""} data-t="show"></div></div>`;
	assert.equal(pick(menu(false), entry), "show");
	assert.equal(
		pick(menu(true), entry),
		null,
		"a disabled entry (above the relay ceiling) fails the run",
	);
	const canvas = (inner) =>
		`<section data-tour-tag="canvas-container">${inner}</section>`;
	assert.equal(
		matches(canvas('<img alt="image-1.png" src="blob:x">'), preview),
		true,
		"painted in the canvas",
	);
	assert.equal(
		matches(canvas('<div><p>Opening…</p></div><img alt="">'), preview),
		false,
		"still opening; grid thumbnails have an empty alt",
	);
	assert.equal(
		matches(
			`${canvas("")}<div data-image-viewport><img alt="image-1.png"></div>`,
			preview,
		),
		false,
		"the lightbox is not the canvas",
	);
	assert.equal(steps[5].payload.selector, filePreviewSelector("image-1.png"));
});

test("file-preview: a name that would change the selector is refused, and the scene needs --session", () => {
	assert.equal(previewFileProblem("image-1.png"), null);
	for (const bad of [
		'a"]',
		"a\\b",
		"dir/a.png",
		"a\nb",
		"",
		".hidden",
		"x".repeat(129),
	])
		assert.ok(previewFileProblem(bad), JSON.stringify(bad));
	assert.throws(() => filePreviewSceneSteps('x"] , *'), Refusal);
	const opts = parseArgs([
		"--app",
		"/Applications/Local Operator.app",
		"--out",
		"/tmp/x",
		"--scene",
		"file-preview",
	]);
	assert.equal(opts.previewFile, PREVIEW_FILE_DEFAULT);
	assert.throws(() => validateOptions(opts), /file-preview.*need --session/);
	const named = parseArgs([
		"--app",
		"/Applications/Local Operator.app",
		"--out",
		"/tmp/x",
		"--session",
		"ce618964c88e",
		"--scene",
		"file-preview",
		"--preview-file",
		'a"b',
	]);
	assert.throws(
		() => validateOptions(named),
		/--preview-file must be a plain file name/,
	);
	const { steps } = buildSteps({
		scenes: ["file-preview"],
		themes: ["dark", "light"],
		session: "ce618964c88e",
		capture: "screencapture",
		previewFile: "clip-2.png",
	});
	assert.deepEqual(
		steps.filter((s) => s.verb === "shutter").map((s) => s.payload.label),
		["file-preview-dark", "file-preview-light"],
	);
	assert.ok(
		steps.some(
			(s) => s.payload?.selector === filePreviewSelector("clip-2.png"),
		),
	);
});

test("provenance: a peer library row passes; a local row or a row with a local path fails", () => {
	const listing = (id) => ({ result: { rows: id ? [{ id }] : [] } });
	const peer = {
		result: {
			id: "la_00000000000000aa",
			ref: { type: "path", path: null },
			origin: "generated",
			remote: { device_id: "d1", device_name: "Mac" },
		},
	};
	assert.deepEqual(
		libraryProvenanceCheck(listing("la_00000000000000aa"), peer),
		{
			assetId: "la_00000000000000aa",
			remote: true,
			localPath: false,
			source: "generated",
			pass: true,
		},
	);
	const local = {
		result: {
			...peer.result,
			remote: null,
			ref: { type: "path", path: "/rig/home/a.png" },
		},
	};
	const r1 = libraryProvenanceCheck(listing("la_00000000000000aa"), local);
	assert.equal(r1.pass, false);
	assert.match(r1.problem, /not a peer row/);
	const pathed = {
		result: { ...peer.result, ref: { type: "path", path: "/rig/home/a.png" } },
	};
	const r2 = libraryProvenanceCheck(listing("la_00000000000000aa"), pathed);
	assert.equal(r2.pass, false);
	assert.match(r2.problem, /has a local path/);
	assert.equal(r2.localPath, true);
	// S1: the receipt is public - no device id/name, no absolute local path,
	// not even in `problem`.
	for (const result of [
		libraryProvenanceCheck(listing("la_00000000000000aa"), peer),
		r1,
		r2,
	]) {
		const json = JSON.stringify(result);
		for (const leak of ['"d1"', "Mac", "/rig/home"])
			assert.ok(!json.includes(leak), `${leak} in ${json}`);
	}
	assert.equal(libraryProvenanceCheck(listing(null), null).pass, false);
	assert.equal(
		libraryProvenanceCheck(listing("la_00000000000000aa"), null).pass,
		false,
	);
});

test("provenance: the previewed row must be a peer row in a session the rig does not hold", () => {
	const listing = (row) => ({
		result: {
			rows: [
				{ id: "f_other", name: "notes.md", remote: true },
				...(row ? [row] : []),
			],
		},
	});
	const peerRow = {
		id: "f_1",
		name: "image-1.png",
		remote: true,
		origin_device: { id: "d1", name: "Mac" },
	};
	assert.deepEqual(
		imagePreviewCheck({
			listing: listing(peerRow),
			name: "image-1.png",
			sessionOnRig: false,
		}),
		{
			assetId: "f_1",
			remote: true,
			matchingRows: 1,
			originDeviceKnown: true,
			sessionOnRig: false,
			pass: true,
		},
	);
	// S2: whether an origin device is known, never which one.
	assert.ok(
		!/d1|Mac/.test(
			JSON.stringify(
				imagePreviewCheck({
					listing: listing(peerRow),
					name: "image-1.png",
					sessionOnRig: false,
				}),
			),
		),
	);
	// F4: exact name; a `.bak` beside it is another file, and two rows with the
	// name (two folders) fail the run - the frame cannot say which it shows.
	const bak = { ...peerRow, id: "f_0", name: "image-1.png.bak" };
	assert.equal(
		imagePreviewCheck({
			listing: { result: { rows: [bak, peerRow] } },
			name: "image-1.png",
			sessionOnRig: false,
		}).assetId,
		"f_1",
	);
	assert.match(
		imagePreviewCheck({
			listing: { result: { rows: [bak] } },
			name: "image-1.png",
			sessionOnRig: false,
		}).problem,
		/no file row named image-1.png/,
	);
	const twice = imagePreviewCheck({
		listing: { result: { rows: [peerRow, { ...peerRow, id: "f_2" }] } },
		name: "image-1.png",
		sessionOnRig: false,
	});
	assert.equal(twice.pass, false);
	assert.equal(twice.matchingRows, 2);
	assert.match(twice.problem, /2 file rows are named image-1.png/);
	const localRow = { id: "f_1", name: "image-1.png" };
	assert.match(
		imagePreviewCheck({
			listing: listing(localRow),
			name: "image-1.png",
			sessionOnRig: false,
		}).problem,
		/not remote/,
	);
	const onRig = imagePreviewCheck({
		listing: listing(peerRow),
		name: "image-1.png",
		sessionOnRig: true,
	});
	assert.equal(onRig.pass, false);
	assert.match(onRig.problem, /present in the rig's own <config>\/sessions/);
	assert.match(
		imagePreviewCheck({
			listing: listing(peerRow),
			name: "image-1.png",
			sessionOnRig: null,
		}).problem,
		/attach mode/,
	);
	assert.match(
		imagePreviewCheck({
			listing: listing(null),
			name: "image-1.png",
			sessionOnRig: false,
		}).problem,
		/no file row named image-1.png/,
	);
});

test("provenance readers: allowlisted GETs only, against a real HTTP daemon, and the session dir is read off disk", async () => {
	const seen = [];
	const server = createHttpServer((req, res) => {
		seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
		const body = req.url.startsWith("/v1/desktop/library/assets?")
			? { result: { rows: [{ id: "la_00000000000000aa" }] } }
			: req.url === "/v1/desktop/library/assets/la_00000000000000aa"
				? {
						result: {
							id: "la_00000000000000aa",
							ref: { path: null },
							origin: "generated",
							remote: { device_id: "d1" },
						},
					}
				: req.url.startsWith("/v1/desktop/sessions/ce618964c88e/files?")
					? {
							result: {
								rows: [{ id: "f_1", name: "image-1.png", remote: true }],
							},
						}
					: null;
		res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
		res.end(JSON.stringify(body ?? {}));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	const cfg = mkdtempSync(join(os.tmpdir(), "mac-proof-prov-"));
	try {
		const lib = await readLibraryProvenance(base, "tok", { timeoutMs: 5000 });
		assert.equal(lib.pass, true);
		const absent = await readImagePreview(base, "tok", {
			session: "ce618964c88e",
			name: "image-1.png",
			configRoot: cfg,
			timeoutMs: 5000,
		});
		assert.equal(absent.pass, true);
		assert.equal(absent.sessionOnRig, false);
		mkdirSync(join(cfg, "sessions", "ce618964c88e"), { recursive: true });
		const present = await readImagePreview(base, "tok", {
			session: "ce618964c88e",
			name: "image-1.png",
			configRoot: cfg,
			timeoutMs: 5000,
		});
		assert.equal(present.pass, false);
		assert.equal(present.sessionOnRig, true);
		assert.deepEqual(seen, [
			"GET /v1/desktop/library/assets?scope=final&limit=1 Bearer tok",
			"GET /v1/desktop/library/assets/la_00000000000000aa Bearer tok",
			"GET /v1/desktop/sessions/ce618964c88e/files?q=image-1.png&limit=50 Bearer tok",
			"GET /v1/desktop/sessions/ce618964c88e/files?q=image-1.png&limit=50 Bearer tok",
		]);
	} finally {
		server.close();
		rmSync(cfg, { recursive: true, force: true });
	}
	// The three new routes: exactly one id segment each, only their query keys, GET only.
	for (const ok of [
		"/v1/desktop/library/assets?scope=final&limit=1",
		"/v1/desktop/library/assets/la_00000000000000aa",
		"/v1/desktop/sessions/ce618964c88e/files?q=image-1.png&limit=50",
	])
		assert.equal(daemonRequestProblem("GET", ok), null, ok);
	for (const [method, path] of [
		["PATCH", "/v1/desktop/library/assets/la_00000000000000aa"],
		["GET", "/v1/desktop/library/assets/la_00000000000000aa/content"],
		["GET", "/v1/desktop/library/assets/la_00000000000000aa/chat"],
		["GET", "/v1/desktop/library/assets/la_short"],
		["GET", "/v1/desktop/library/assets?q=x"],
		["GET", "/v1/desktop/sessions/ce618964c88e/files?cursor=x"],
		["GET", "/v1/desktop/sessions/CE618964C88E/files"],
		["GET", "/v1/desktop/sessions/ce618964c88e/x/files"],
		["GET", "/v1/desktop/sessions/ce618964c88e/files/f_1"],
		["POST", "/v1/desktop/sessions/ce618964c88e/files"],
		// S3: an encoded slash is not a separator - the `{id}` segment must
		// match the id pattern whole, `%2F` and all.
		["GET", "/v1/desktop/library/assets/la_00000000000000aa%2Fcontent"],
		["GET", "/v1/desktop/library/assets%2Fla_00000000000000aa"],
		["GET", "/v1/desktop/sessions/ce618964c88e%2Ffiles"],
		["GET", "/v1/desktop/sessions%2Fce618964c88e/files"],
		// S3: empty segments (a doubled or trailing slash) change the segment count.
		["GET", "/v1/desktop/library/assets//la_00000000000000aa"],
		["GET", "/v1/desktop/library/assets/la_00000000000000aa/"],
		["GET", "/v1/desktop/library/assets/"],
		["GET", "/v1/desktop/sessions//ce618964c88e/files"],
		["GET", "/v1/desktop/sessions/ce618964c88e//files"],
		["GET", "/v1/desktop/sessions/ce618964c88e/files/"],
		// S3: dot-segments resolving OFF an allowed route, plain or encoded.
		["GET", "/v1/desktop/library/assets/la_00000000000000aa/.."],
		["GET", "/v1/desktop/sessions/ce618964c88e/files/.."],
		["GET", "/v1/desktop/library/assets/%2e%2e/la_00000000000000aa"],
		["GET", "/v1/desktop/sessions/%2E%2E/ce618964c88e/files"],
		["GET", "/v1/desktop/sessions/ce618964c88e/files/%2e%2e/x"],
		[
			"GET",
			"/v1/desktop/library/assets/la_00000000000000aa/../../../sessions/ce618964c88e/runs",
		],
	])
		assert.ok(
			daemonRequestProblem(method, path),
			`${method} ${path} must be refused`,
		);
	// S3: a dot-segment that resolves ONTO an allowed route is judged by its
	// resolution - which is exactly what `daemonRequest` sends (it fetches
	// `new URL(path, base)`, the same WHATWG resolution), so the daemon never
	// sees a path the allowlist did not judge.
	for (const [path, sent] of [
		[
			"/v1/desktop/library/assets/./la_00000000000000aa",
			"/v1/desktop/library/assets/la_00000000000000aa",
		],
		[
			"/v1/desktop/library/assets/x/../la_00000000000000aa",
			"/v1/desktop/library/assets/la_00000000000000aa",
		],
		[
			"/v1/desktop/sessions/ce618964c88e/./files",
			"/v1/desktop/sessions/ce618964c88e/files",
		],
	]) {
		assert.equal(daemonRequestProblem("GET", path), null, path);
		assert.equal(new URL(path, "http://127.0.0.1").pathname, sent);
		assert.equal(daemonRequestProblem("GET", sent), null, sent);
	}
});
