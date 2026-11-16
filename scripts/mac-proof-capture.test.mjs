import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import {
	CREDENTIAL_SEGMENTS,
	DAEMON_ROUTES,
	FORBIDDEN_DAEMON_PATH,
	Refusal,
	SCREENCAPTURE_METHOD,
	appNames,
	backendUrlProblem,
	buildAppArgv,
	buildAppEnv,
	buildSteps,
	captureModeProblem,
	comparablePath,
	createSupervisor,
	credentialMaterial,
	daemonRequest,
	daemonRequestProblem,
	envGovernedBlockedMessage,
	frameMatchesWindow,
	killRigMatched,
	lopArgvProblem,
	operatorPathProblem,
	operatorRoots,
	parseArgs,
	physical,
	pngSize,
	portListenerOwned,
	processFacts,
	redactEnv,
	relayPortFromConfig,
	relayPortProblem,
	resolveAppBundle,
	rigMatcher,
	screenRecordingVerdict,
	selectServeRecord,
	validateOptions,
	windowModeProblem,
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
 *     `[window-mode]`/`[dev-driver]`/`[dev-driver-script]` protocol, IGNORES
 *     SIGTERM and RE-PARENTS a child carrying the profile) and a FAKE `lop serve`:
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
process.on("SIGTERM", () => {}); // a wedged app: the harness must escalate
const log = (line) => process.stdout.write(line + "\\n");
log("[window-mode] window mode " + mode + ": 1380x900, never shown, page throttling off");
log("[dev-driver] ARMED; frames are written to " + out);
log("[dev-driver-script] ARMED; steps from " + process.env.LOCAL_OPERATOR_UI_DEV_DRIVER_SCRIPT);
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
  const steps = JSON.parse(fs.readFileSync(process.env.LOCAL_OPERATOR_UI_DEV_DRIVER_SCRIPT, "utf8")).steps;
  log("[dev-driver-script] ready verbs=8");
  steps.forEach((step, i) => {
    const n = i + 1;
    if (behaviour.failVerb === step.verb) { log("[dev-driver-script] step=" + n + " verb=" + step.verb + " error: fake failure"); log("[dev-driver-script] FAILED step=" + n); return; }
    if (step.verb === "shutter") {
      const file = path.join(out, step.payload.label + ".png");
      fs.writeFileSync(file, Buffer.from("${PNG_1X1.toString("hex")}", "hex"));
      log("[dev-driver-script] SHUTTER label=" + step.payload.label + " capture=capturepage path=" + file + " width=1 height=1 visible=false focused=false");
      log("[dev-driver-script] step=" + n + " verb=shutter ok {}");
      return;
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
 */
function fakeLop() {
	const lop = join(TREE, "fake-lop");
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
  if (req.url.startsWith("/v1/desktop/sessions?")) {
    if (req.headers.authorization !== "Bearer " + process.env.LOCAL_OPERATOR_DESKTOP_TOKEN) { res.statusCode = 401; return res.end("{}"); }
    reads++;
    const file = path.join(config, "fake-sessions.json");
    const rows = reads >= 3 && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    return res.end(JSON.stringify({ status: 200, message: "ok", result: { sessions: rows } }));
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
	assert.doesNotMatch(probe, /CGRequestScreenCaptureAccess\(/);
	assert.match(
		source,
		/verdict === "unknown"[\s\S]{0,800}return EXIT\.BLOCKED/,
	);
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

test("isolated: our own lop serve + the fake app -> every frame, a receipt, no token leak, nothing left running", () => {
	const app = fakeApp("Isolated");
	const rigRoot = join(TREE, "iso-rig");
	const out = join(TREE, "iso-out");
	const seed = join(TREE, "iso-seed");
	mkdirSync(join(seed, "asks"), { recursive: true });
	writeFileSync(join(seed, "config.yml"), "synthetic: true\n");
	const run = runHarness([
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
	assert.ok(
		receipt.frames.every((f) => f.method === "capturePage: no vibrancy claim"),
	);
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

test("an app that announces a normal window is aborted and reaped", () => {
	const app = fakeApp("Normal", { reportMode: "normal" });
	const rigRoot = join(TREE, "normal-rig");
	const run = runHarness([
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

test("an app whose window takes focus, or whose step fails, is aborted before any frame", () => {
	for (const [name, behaviour, why] of [
		["Focused", { focused: true }, /took focus/],
		["StepFails", { failVerb: "setTheme" }, /setTheme\) failed/],
		["WrongSession", { activeSessionId: "aaaaaaaaaaaa" }, /not --session/],
	]) {
		const app = fakeApp(name, behaviour);
		const rigRoot = join(TREE, `${name}-rig`);
		const out = join(TREE, `${name}-out`);
		const run = runHarness([
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

test("attach: an env-governed daemon is BLOCKED (exit 3) and no app is launched; a claimed one attaches", async () => {
	// A fake daemon on a free port, with a serve record beside it.
	const lop = fakeLop();
	const cfg = join(TREE, "attach-daemon-cfg");
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
		const blocked = runHarness([
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
		const claimed = runHarness([
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
		"/v1/desktop/sessions",
	]);
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
	const device = rigDevice("cr-busyport", `network:\n  port: ${port}\n`);
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

test("a rig root and --out containing spaces capture normally (review r1 R1-2)", () => {
	const rigRoot = join(TREE, "proof runs", "rig root");
	const out = join(TREE, "proof runs", "out dir");
	const run = runHarness([
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

test("network.port: read from block YAML; unset or 4097 refuses", () => {
	assert.equal(relayPortFromConfig("network:\n  port: 4197\n"), 4197);
	assert.equal(
		relayPortFromConfig(
			"a: 1\nnetwork:\n  enabled: true\n  port: '4198' # rig\nb:\n  port: 9\n",
		),
		4198,
	);
	assert.equal(
		relayPortFromConfig("network:\n  peers:\n    port: 4000\n"),
		null,
		"a nested port is not network.port",
	);
	assert.equal(relayPortFromConfig("port: 4197\n"), null);
	assert.equal(
		relayPortFromConfig("network: {port: 4197}\n"),
		null,
		"flow style fails closed",
	);
	assert.match(relayPortProblem(null), /network\.port/);
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

test("config-root: relay on network.port, then serve, then the remote row; frames; every lop process reaped", () => {
	const relayPort = 20000 + Math.floor(Math.random() * 20000);
	const device = rigDevice("cr-ok", `network:\n  port: ${relayPort}\n`);
	writeFileSync(
		join(device.config, "fake-sessions.json"),
		JSON.stringify([{ id: "ce618964c88e", locality: "remote" }]),
	);
	const app = fakeApp("ConfigRoot");
	const rigRoot = join(TREE, "cr-ok-rig");
	const out = join(TREE, "cr-ok-out");
	const run = runHarness([
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

test("config-root: a session that never shows as remote fails the run before the app launches", () => {
	const relayPort = 20000 + Math.floor(Math.random() * 20000);
	const device = rigDevice("cr-miss", `network:\n  port: ${relayPort}\n`);
	writeFileSync(
		join(device.config, "fake-sessions.json"),
		JSON.stringify([{ id: "ce618964c88e", locality: "local" }]),
	);
	const rigRoot = join(TREE, "cr-miss-rig");
	const run = runHarness([
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
			rigDevice("cr-unset", "network:\n  enabled: true\n"),
			[],
			/network\.port/,
		],
		["no config.yml", rigDevice("cr-none", null), [], /network\.port/],
		["4097", rigDevice("cr-4097", "network:\n  port: 4097\n"), [], /4097/],
		[
			"real home",
			rigDevice("cr-home", "network:\n  port: 4555\n"),
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
	const busy = rigDevice("cr-busy", "network:\n  port: 4556\n");
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

test("--timeout and SIGTERM mid-run both reap the app, its re-parented helper, the daemon and its standby", async () => {
	const lop = fakeLop();
	const app = fakeApp("Hang", { hang: true });
	const common = ["--app", app, "--capture", "capturepage", "--lop", lop];

	// 1. The timeout path: a wedged app, --timeout 6 (whole-run: it includes the daemon start, so the app is up well before it).
	const timeoutRoot = join(TREE, "hang-timeout-rig");
	const timedOut = runHarness([
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

test("--timeout bounds the WHOLE run from harness start, not just the app phase", () => {
	// A config-root run whose remote row never appears: --peer-wait 30 would
	// wait 30 s, but the whole-run --timeout 3 stops it first, before any app
	// launch (review r1 R1-6, QA r1 Q4-3; before, `--timeout 5` measured 16 s).
	const relayPort = 20000 + Math.floor(Math.random() * 20000);
	const device = rigDevice("cr-wholerun", `network:\n  port: ${relayPort}\n`);
	const rigRoot = join(TREE, "cr-wholerun-rig");
	const out = join(TREE, "cr-wholerun-out");
	const began = Date.now();
	const run = runHarness([
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
