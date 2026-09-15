#!/usr/bin/env node
/**
 * Evidence run for daemon discovery: the app's real modules against real
 * daemons.
 *
 * WHY this is a script and not a test. The node-runner tests in
 * `scripts/daemon-discovery.test.mjs` pin the RULES with synthetic records; this
 * drives the shipped electron-free modules against a real `lop serve` daemon on
 * an isolated config root and prints the raw output, which is the evidence a
 * reviewer and QA judge. It is deliberately not part of `test:desktop`: it
 * starts real daemons and a fake one, so it must never run concurrently with the
 * app's matrix.
 *
 * Everything runs in a throwaway config root (`LOCAL_OPERATOR_CONFIG_DIR`) on
 * ephemeral ports. The operator's own daemons, sessions and app are never
 * touched - no `pkill`, no shared port, no shared record directory.
 *
 *     node scripts/daemon-discovery-evidence.mjs
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "lop-ui-daemon-evidence-"));
const RUN_DIR = join(ROOT, "run", "serve");
mkdirSync(RUN_DIR, { recursive: true });
// An allowlist prevents inherited desktop bearers, CMUX workspace IDs, LOP
// runtime adoption flags and provider credentials from entering any subprocess.
// HOME also isolates caches: CONFIG_DIR alone only redirects configuration.
const inherited = new Set([
	"PATH",
	"PATHEXT",
	"SystemRoot",
	"ComSpec",
	"TMPDIR",
	"TEMP",
	"TMP",
	"LANG",
	"LC_ALL",
	"TERM",
]);
for (const name of Object.keys(process.env)) {
	if (!inherited.has(name)) delete process.env[name];
}
Object.assign(process.env, {
	HOME: ROOT,
	LOCAL_OPERATOR_CONFIG_DIR: ROOT,
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
});

const say = (label, value) => {
	console.log(`\n$ ${label}`);
	if (value !== undefined) console.log(String(value).trimEnd());
};
const line = (text) => console.log(text);

/** The app's own modules, bundled with electron and the logger stubbed out. */
async function bundleManagerModule(buildIndex) {
	const result = await build({
		stdin: {
			contents:
				'export { BackendServiceManager, LocalOperatorStartupMode } from "./src/main/backend/backend-service"; export { PROBE_INTERVAL_MS } from "./src/main/backend/daemon-status";',
			resolveDir: REPO,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		// A differing banner gives each build its own data URL, hence its own
		// module instance - which is what lets one process exercise the manager
		// under two different `VITE_DISABLE_BACKEND_MANAGER` values, since the
		// config is read once at module load.
		banner: { js: `/* evidence build ${buildIndex} */` },
		plugins: [
			{
				name: "electron-fixture",
				setup(builder) {
					builder.onResolve({ filter: /^electron$/ }, () => ({
						path: "electron",
						namespace: "fixture",
					}));
					builder.onLoad(
						{ filter: /^electron$/, namespace: "fixture" },
						() => ({
							contents: `
							export const app = {
								getPath: (name) => (name === "home" ? process.env.HOME : "${ROOT}/userData"),
								whenReady: async () => {},
								on: () => {},
								quit: () => {},
							};
							export const dialog = {
								showErrorBox: (title, message) => console.log("[dialog]", title, "|", message),
								showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
							};
							export default { app, dialog };
						`,
							loader: "js",
						}),
					);
				},
			},
			{
				/*
				 * The config module is substituted because it loads `.env` through
				 * dotenv, whose CommonJS `require` cannot survive an ESM bundle
				 * loaded from a data: URL. Only the two values the manager reads are
				 * replaced, both from the environment, so the manager's own logic is
				 * still the shipping logic.
				 */
				name: "config-fixture",
				setup(builder) {
					builder.onResolve({ filter: /^\.\/config$/ }, (args) =>
						args.importer.endsWith("backend/backend-service.ts")
							? { path: "backend-config", namespace: "config-fixture" }
							: undefined,
					);
					builder.onLoad(
						{ filter: /^backend-config$/, namespace: "config-fixture" },
						() => ({
							contents: `
							export const backendConfig = {
								get VITE_LOCAL_OPERATOR_API_URL() { return globalThis.__evidenceConfiguredUrl; },
								get VITE_DISABLE_BACKEND_MANAGER() { return process.env.VITE_DISABLE_BACKEND_MANAGER ?? "false"; },
							};
							export const apiConfig = { get baseUrl() { return globalThis.__evidenceConfiguredUrl; } };
						`,
							loader: "js",
						}),
					);
				},
			},
			{
				// The real logger writes into the operator's application-support
				// directory. Evidence must not touch the operator's environment, so
				// the manager's log lines go to stdout instead - which also makes
				// them part of the raw evidence.
				name: "logger-fixture",
				setup(builder) {
					builder.onResolve({ filter: /^\.\/logger$/ }, () => ({
						path: "logger",
						namespace: "logger-fixture",
					}));
					builder.onLoad(
						{ filter: /^logger$/, namespace: "logger-fixture" },
						() => ({
							contents: `
							export const LogFileType = { INSTALLER: "installer", BACKEND: "backend", UPDATE_SERVICE: "update", OAUTH: "oauth" };
							const emit = (level) => (message, _type, ...rest) =>
								console.log("[app:" + level + "]", String(message));
							export const logger = { info: emit("info"), warn: emit("warn"), error: emit("error"), debug: emit("debug"), verbose: emit("debug") };
						`,
							loader: "js",
						}),
					);
				},
			},
		],
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
	);
}

const discoveryBundle = await build({
	stdin: {
		contents: 'export * from "./src/main/backend/discovery";',
		resolveDir: REPO,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const discovery = await import(
	`data:text/javascript;base64,${Buffer.from(discoveryBundle.outputFiles[0].text).toString("base64")}`
);

const env = { ...process.env, LOCAL_OPERATOR_CONFIG_DIR: ROOT };
// The manager's config module loads `.env` from the working directory; running
// from the throwaway root keeps this run away from any real one.
process.chdir(ROOT);

const children = [];
/** Every listener this script opens, so cleanup closes them all - including the
 * one a later phase replaces by rebinding the same variable. */
const servers = [];
function startRealDaemon(label, configRoot = ROOT) {
	const child = spawn("lop", ["serve", "--port", "0"], {
		env: { ...env, LOCAL_OPERATOR_CONFIG_DIR: configRoot },
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(child);
	let log = "";
	child.stdout.on("data", (d) => {
		log += d;
	});
	child.stderr.on("data", (d) => {
		log += d;
	});
	return { child, text: () => log };
}

/** Wait for a daemon's own record (keyed by its pid) to appear. */
async function waitForRecord(child, timeoutMs = 30_000, runDir = RUN_DIR) {
	const file = join(runDir, `${child.pid}.json`);
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(file)) {
			try {
				return JSON.parse(readFileSync(file, "utf8"));
			} catch {
				/* torn read mid-publish is expected */
			}
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`no record for pid ${child.pid} within ${timeoutMs}ms`);
}

/** Wait for the first status push `matches`, or fail with what was seen. */
async function waitForPush(pushes, matches, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = pushes.find(matches);
		if (found) return found;
		if (Date.now() > deadline) {
			throw new Error(
				`no matching status push within ${timeoutMs}ms; saw ${JSON.stringify(pushes.map((push) => push.state))}`,
			);
		}
		await new Promise((r) => setTimeout(r, 100));
	}
}

const redact = (record) => ({
	...record,
	claim_key: record.claim_key
		? `<redacted, ${record.claim_key.length} chars>`
		: "",
});

// `--max-time` so a listener that accepts a connection and never answers shows
// up as a timeout in the evidence rather than hanging the run.
const curl = async (args, expectedStatus = 200) => {
	// Native async HTTP also lets this process's negative-case server answer.
	// Bearers stay in memory, never process argv or a temporary curl config.
	const headers = {};
	let method = "GET";
	let body;
	for (let i = 0; i < args.length - 1; i++) {
		if (args[i] === "-X") method = args[++i];
		else if (args[i] === "-d") body = args[++i];
		else if (args[i] === "-H") {
			const value = args[++i];
			const colon = value.indexOf(":");
			headers[value.slice(0, colon)] = value.slice(colon + 1).trim();
		}
	}
	const response = await fetch(args.at(-1), {
		method,
		headers,
		body,
		redirect: "error",
		signal: AbortSignal.timeout(10_000),
	});
	assert.equal(
		response.status,
		expectedStatus,
		`${method} ${new URL(args.at(-1)).pathname}`,
	);
	return `HTTP ${response.status}\n${await response.text()}`;
};

const stopChild = async (child) => {
	// A child killed by a signal reports `exitCode === null` with `signalCode`
	// set, and it is just as gone: without this the wait below ends on its 5s
	// failsafe instead of on the exit that already happened.
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	await new Promise((r) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			r();
		}, 5_000);
		child.on("exit", () => {
			clearTimeout(timer);
			r();
		});
	});
};

let daemon1;
let daemon2;
let fakeOld;
let stranger;
let zombieParent;
let zombieRoot;
let zombieRunDir;

try {
	console.log(
		`# Evidence root: ${ROOT} (isolated HOME and config; environment allowlisted)`,
	);

	// ---------------------------------------------------------------- real daemon
	say("LOCAL_OPERATOR_CONFIG_DIR=%s lop serve --port 0", ROOT);
	daemon1 = startRealDaemon("daemon1");
	const record1 = await waitForRecord(daemon1.child);
	say(
		`read redacted record for pid ${daemon1.child.pid}`,
		JSON.stringify(redact(record1), null, 2),
	);
	line(
		`\n(reported version: ${record1.version}; install_kind: ${record1.install_kind})`,
	);

	say(`curl -sS ${`http://${record1.host}:${record1.port}`}/health`);
	line(await curl([`http://${record1.host}:${record1.port}/health`]));

	// ----------------------------------------------------------------- discovery
	const first = await discovery.discoverDaemons({
		env: { LOCAL_OPERATOR_CONFIG_DIR: ROOT },
		configuredUrl: `http://127.0.0.1:${record1.port}`,
		log: (message) => line(`[discovery] ${message}`),
	});
	say("discovery.discoverDaemons(...)  // the app's own module", "");
	line(
		JSON.stringify(
			{
				picked: first.picked && {
					address: first.picked.address,
					instance_id: first.picked.record.instance_id,
					version: first.picked.identity.version,
					prefix: first.picked.identity.prefix,
					source: first.picked.source,
				},
				identity_matches_record:
					first.picked?.identity.instanceId === record1.instance_id,
				candidates: first.candidates.length,
				rejected: first.rejected,
			},
			null,
			2,
		),
	);

	// ---------------------------------------------------------------- claim route
	const base = `http://${record1.host}:${record1.port}`;
	const claimKey = record1.claim_key;
	say(`curl -sS ${base}/v1/capabilities   # before any claim`, "");
	line(await curl([`${base}/v1/capabilities`]));
	say(
		"# a WRONG key is refused with 401, before anything has claimed the plane",
		"",
	);
	line(
		await curl(
			[
				"-X",
				"POST",
				"-H",
				"Authorization: Bearer not-the-key",
				"-H",
				"Content-Type: application/json",
				"-d",
				"{}",
				`${base}/v1/desktop/claim`,
			],
			401,
		),
	);
	say(
		"curl -X POST /v1/desktop/claim with the record's key (native caller, no Origin)",
		"",
	);
	line(
		await curl([
			"-X",
			"POST",
			"-H",
			`Authorization: Bearer ${claimKey}`,
			"-H",
			"Content-Type: application/json",
			"-d",
			"{}",
			`${base}/v1/desktop/claim`,
		]),
	);
	say(
		"# a second claim is refused by the latch (409): the plane is already governed",
		"",
	);
	line(
		await curl(
			[
				"-X",
				"POST",
				"-H",
				`Authorization: Bearer ${claimKey}`,
				"-H",
				"Content-Type: application/json",
				"-d",
				"{}",
				`${base}/v1/desktop/claim`,
			],
			409,
		),
	);
	say(`curl -sS ${base}/v1/capabilities   # after the claim`, "");
	line(await curl([`${base}/v1/capabilities`]));

	await stopChild(daemon1.child);
	assert.equal(existsSync(join(RUN_DIR, `${daemon1.child.pid}.json`)), false);
	line("\n(daemon 1 stopped; its record was unpublished)");

	// ------------------------------------------------- manager: attach, not spawn
	line(
		"\n\n# ===== the app's BackendServiceManager, against a real daemon =====",
	);
	daemon2 = startRealDaemon("daemon2");
	const record2 = await waitForRecord(daemon2.child);
	line(
		`(daemon 2: pid ${daemon2.child.pid} at ${record2.host}:${record2.port}, v${record2.version}, claim_key ${record2.claim_key ? "published" : "absent"})`,
	);

	stranger = createServer((_req, res) => {
		res.setHeader("Content-Type", "application/json");
		res.end(
			JSON.stringify({
				status: 200,
				message: "ok",
				result: { hello: "world" },
			}),
		);
	});
	servers.push(stranger);
	await new Promise((r) => stranger.listen(0, "127.0.0.1", r));
	const managerStrangerUrl = `http://127.0.0.1:${stranger.address().port}`;
	globalThis.__evidenceConfiguredUrl = managerStrangerUrl;
	say(
		`VITE_LOCAL_OPERATOR_API_URL=${managerStrangerUrl}  (an unrelated listener; a real daemon exists elsewhere)`,
		"",
	);
	process.env.LOCAL_OPERATOR_CONFIG_DIR = ROOT;
	// biome-ignore lint/performance/noDelete: an ABSENT variable is not an empty one; `process.env.X = undefined` stores the string "undefined"
	delete process.env.VITE_DISABLE_BACKEND_MANAGER;
	const managerModule = await bundleManagerModule(1);
	const manager = new managerModule.BackendServiceManager();
	const started = await manager.start();
	assert.equal(started, true);
	assert.equal(manager.getOwnedPid(), null);
	assert.equal(manager.getStatusSnapshot().instanceId, record2.instance_id);
	say("manager.start()", `-> ${started}`);
	line(
		JSON.stringify(
			{
				startup_mode: manager.getStartupMode(),
				using_external_backend: manager.isUsingExternalBackend(),
				owned_pid: manager.getOwnedPid(),
				status: manager.getStatusSnapshot(),
			},
			null,
			2,
		),
	);
	line(
		`\n(daemon 2 pid alive after start(): ${discovery.pidLiveness(daemon2.child.pid) === "alive"})`,
	);
	line(
		"(no child was spawned: owned_pid is null, and the log above has no 'Starting backend service with')",
	);

	say(
		"manager.stop(false)   # attached to a daemon this app did not start",
		"",
	);
	await manager.stop(false);
	assert.equal(discovery.pidLiveness(daemon2.child.pid), "alive");
	line(
		`daemon 2 pid after stop(false): ${discovery.pidLiveness(daemon2.child.pid)} (must stay alive - the app did not spawn it)`,
	);
	line(
		`daemon 2 record still on disk: ${existsSync(join(RUN_DIR, `${daemon2.child.pid}.json`))} (nothing on disk was touched)`,
	);

	// ----------------------------------- the disable flag no longer means "assume"
	line(
		"\n\n# ===== VITE_DISABLE_BACKEND_MANAGER=true: discover, never spawn or kill =====",
	);
	process.env.VITE_DISABLE_BACKEND_MANAGER = "true";
	const disabledModule = await bundleManagerModule(2);
	const disabledManager = new disabledModule.BackendServiceManager();
	const discovered = await disabledManager.checkExistingBackend();
	assert.equal(
		discovered,
		true,
		"a fresh manager authenticates with the previously claimed record key",
	);
	assert.equal(disabledManager.getOwnedPid(), null);
	assert.equal(disabledManager.getStatusSnapshot().state, "attached");
	const sessions = await disabledManager.requestDesktop({
		op: "sessions.list",
		limit: 1,
	});
	/*
	 * A 200 with the sessions payload is the proof that matters here: this app
	 * never held the record's claim key before (this manager was built fresh, as
	 * a restarted app would be), yet the daemon accepted the bearer. The 409 the
	 * claim route answered earlier only means "already claimed" - it is not
	 * evidence that somebody ELSE owns the plane, which is why re-attaching is
	 * correct and treating 409 as a foreign owner would strand the app.
	 */
	assert.equal(
		sessions.status,
		200,
		"the restarted app can actually use authenticated desktop controls",
	);
	const sessionsBody = sessions.body;
	assert.ok(
		Array.isArray(sessionsBody?.result?.sessions),
		`the authenticated read returned a sessions payload, got ${JSON.stringify(sessionsBody)?.slice(0, 200)}`,
	);
	line(
		`\n# the restart's own authenticated read: HTTP ${sessions.status}, ${sessionsBody.result.sessions.length} session(s)`,
	);
	say("manager.checkExistingBackend() with the flag set", `-> ${discovered}`);
	line(
		JSON.stringify(
			{
				status: disabledManager.getStatusSnapshot(),
				owned_pid: disabledManager.getOwnedPid(),
			},
			null,
			2,
		),
	);
	// An EMPTY config root, kept set for the whole call: discovery reads the
	// environment when it runs, not when the manager is constructed.
	const noDaemonRoot = mkdtempSync(join(tmpdir(), "lop-ui-daemon-none-"));
	const noneModule = await bundleManagerModule(3);
	process.env.LOCAL_OPERATOR_CONFIG_DIR = noDaemonRoot;
	const noneManager = new noneModule.BackendServiceManager();
	const noneStarted = await noneManager.start();
	assert.equal(noneStarted, false);
	assert.equal(noneManager.getOwnedPid(), null);
	assert.equal(noneManager.getStatusSnapshot().state, "detached");
	say(
		"with NO daemon at all, manager.start() under the flag",
		`-> ${noneStarted}`,
	);
	line(JSON.stringify(noneManager.getStatusSnapshot(), null, 2));
	line(
		"(it reports the state and keeps looking; the old early return claimed a backend existed and skipped discovery entirely)",
	);
	await disabledManager.stop(false);
	// Stop its probe loop, or the interval keeps this process alive.
	await noneManager.stop(false);
	process.env.LOCAL_OPERATOR_CONFIG_DIR = ROOT;
	rmSync(noDaemonRoot, { recursive: true, force: true });

	// ------------------------------------------- an explicit REMOTE target
	line(
		"\n\n# ===== an explicit non-loopback target is never replaced by a local daemon =====",
	);
	// biome-ignore lint/performance/noDelete: an ABSENT variable is not an empty one; `process.env.X = undefined` stores the string "undefined"
	delete process.env.VITE_DISABLE_BACKEND_MANAGER;
	// 127.0.0.2 is loopback but NOT the address the app treats as "local" (that
	// set is localhost/127.0.0.1/[::1]), so this takes the remote branch without
	// needing a host on the internet. Nothing listens on port 9, so the probe
	// fails fast and the app must report that rather than starting its own.
	globalThis.__evidenceConfiguredUrl = "http://127.0.0.2:9";
	const remoteModule = await bundleManagerModule(4);
	const remoteManager = new remoteModule.BackendServiceManager();
	const remoteStarted = await remoteManager.start();
	assert.equal(remoteStarted, false);
	assert.equal(
		remoteManager.getOwnedPid(),
		null,
		"no local daemon may be substituted for a remote target",
	);
	const remoteStatus = remoteManager.getStatusSnapshot();
	assert.equal(remoteStatus.state, "detached");
	/*
	 * The snapshot's `url` is null while detached by contract, so the configured
	 * target is read from the manager itself: the point is that discovery must
	 * not have rewritten it to a local port and adopted something of its own.
	 */
	assert.equal(
		remoteManager.backendUrl,
		"http://127.0.0.2:9",
		"the configured target is not rewritten to a local port",
	);
	assert.match(remoteStatus.detail, /remote/i);
	say(
		"manager.start() with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.2:9",
		`-> ${remoteStarted}`,
	);
	line(JSON.stringify(remoteStatus, null, 2));
	line(
		`(daemon 2 pid alive, untouched: ${discovery.pidLiveness(daemon2.child.pid) === "alive"})`,
	);
	await remoteManager.stop(false);

	// ------------------------------- the daemon this app SPAWNS is not a stranger
	line(
		"\n\n# ===== the daemon this app STARTS is registered with the state machine =====",
	);
	/*
	 * The first review round's MAJOR finding, driven end to end on the path every
	 * user without a global `lop` takes: the ordinary fixed-port spawn returned
	 * `true` without ever calling `daemonState.attach()`, so the snapshot described
	 * an app with NO daemon - `owned: false`, url/pid/version null - and Settings
	 * printed "Unknown (update required)" for a backend the app had started
	 * seconds ago.
	 *
	 * An EMPTY config root (no record at all, so discovery has nothing to adopt)
	 * and a free configured port are the whole setup. The child is real: this is
	 * `local-operator serve` on a loopback port inside a throwaway HOME.
	 */
	const ownedRoot = mkdtempSync(join(tmpdir(), "lop-ui-daemon-owned-"));
	const probe = createServer();
	servers.push(probe);
	await new Promise((r) => probe.listen(0, "127.0.0.1", r));
	const ownedPort = probe.address().port;
	await new Promise((r) => probe.close(r));
	globalThis.__evidenceConfiguredUrl = `http://127.0.0.1:${ownedPort}`;
	process.env.LOCAL_OPERATOR_CONFIG_DIR = ownedRoot;
	const ownedModule = await bundleManagerModule(6);
	const ownedManager = new ownedModule.BackendServiceManager();
	const ownedStarted = await ownedManager.start();
	const ownedStatus = ownedManager.getStatusSnapshot();
	say(
		`manager.start() with an empty config root and VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:${ownedPort}`,
		`-> ${ownedStarted}`,
	);
	line(JSON.stringify(ownedStatus, null, 2));
	assert.equal(ownedStarted, true);
	assert.equal(
		ownedStatus.owned,
		true,
		"the daemon this app spawned must be reported as owned",
	);
	assert.equal(ownedStatus.state, "attached");
	assert.equal(ownedStatus.pid, ownedManager.getOwnedPid());
	assert.ok(ownedStatus.version, "the row needs a version, not 'Unknown'");
	assert.equal(ownedStatus.url, `http://127.0.0.1:${ownedPort}`);
	assert.ok(
		ownedStatus.instanceId,
		"an instance id, so a later probe can prove it is the same process",
	);
	line(
		`\nthe Settings row would print: ${ownedStatus.version} \u00b7 ${new URL(ownedStatus.url).host}`,
	);
	line(
		`owned_pid ${ownedManager.getOwnedPid()} === snapshot pid ${ownedStatus.pid}: ${ownedManager.getOwnedPid() === ownedStatus.pid}`,
	);
	/*
	 * CONTROL for the adopted-path measurement further down, and the reason it
	 * can be read: the SAME instrument (a push subscription and a wall clock) on
	 * the path that was always armed, so a slow or absent correction there
	 * cannot be blamed on a reader that never worked. Nothing ticks by hand -
	 * the kill is the whole input - and the app's own replacement that follows a
	 * dead child is driven to completion, because `stop()` below is what proves
	 * the handle it now owns is the one it kills.
	 */
	const ownedPid = ownedManager.getOwnedPid();
	const ownedPushes = [];
	ownedManager.onStatusChange((snapshot) =>
		ownedPushes.push({
			at: Date.now(),
			state: snapshot.state,
			detail: snapshot.detail,
		}),
	);
	const ownedKilledAt = Date.now();
	// Killed by the handle this app spawned, the way an external SIGKILL arrives
	// (crash, OOM, the operator's `kill`), never by a pattern.
	ownedManager.process.kill("SIGKILL");
	const ownedNoticed = await waitForPush(
		ownedPushes,
		(snapshot) => snapshot.state !== "attached",
		ownedModule.PROBE_INTERVAL_MS * 2 + 8_000,
	);
	say(
		`owned path: daemon pid ${ownedPid} SIGKILLed, no manual tick`,
		`noticed in ${ownedNoticed.at - ownedKilledAt} ms (state ${ownedNoticed.state}, ${ownedPushes.length} push event(s))`,
	);
	line(`detail: ${ownedNoticed.detail}`);
	assert.equal(
		ownedNoticed.state,
		"detached",
		"the owned path must notice a killed child on its own tick",
	);
	assert.ok(
		ownedNoticed.at - ownedKilledAt < ownedModule.PROBE_INTERVAL_MS * 2,
		`the owned control has to be noticed within two probe intervals, took ${ownedNoticed.at - ownedKilledAt} ms`,
	);
	const ownedReplacement = await waitForPush(
		ownedPushes,
		(snapshot) => snapshot.state === "attached",
		ownedModule.PROBE_INTERVAL_MS * 3 + 20_000,
	);
	const replacementPid = ownedManager.getOwnedPid();
	assert.notEqual(
		replacementPid,
		ownedPid,
		"a dead child of ours is replaced, and the replacement is the handle stop() must now kill",
	);
	line(
		`then a replacement the app started: pid ${replacementPid} at ${ownedManager.getStatusSnapshot().url} (re-attached in ${ownedReplacement.at - ownedKilledAt} ms)`,
	);

	/*
	 * And the child it started is still OURS to stop: kill only this handle, by
	 * pid, and leave nothing of this run behind.
	 */
	await ownedManager.stop(false);
	let stopped = discovery.pidLiveness(ownedPid);
	for (let i = 0; i < 50 && stopped === "alive"; i++) {
		await new Promise((r) => setTimeout(r, 200));
		stopped = discovery.pidLiveness(ownedPid);
	}
	line(
		`\n(app's own daemon pid ${ownedPid} after stop(): ${stopped}, killed by handle, not by pattern)`,
	);
	let replacementStopped = discovery.pidLiveness(replacementPid);
	for (let i = 0; i < 50 && replacementStopped === "alive"; i++) {
		await new Promise((r) => setTimeout(r, 200));
		replacementStopped = discovery.pidLiveness(replacementPid);
	}
	line(
		`(the replacement pid ${replacementPid} after the same stop(): ${replacementStopped}, so the kill followed the handle and not the number)`,
	);
	assert.equal(replacementStopped, "dead");
	process.env.LOCAL_OPERATOR_CONFIG_DIR = ROOT;
	rmSync(ownedRoot, { recursive: true, force: true });

	// --------------- the app that ADOPTS a daemon at startup keeps observing it
	line(
		"\n\n# ===== an app that ADOPTS a daemon at startup keeps observing it =====",
	);
	/*
	 * QA round 3, Q-1 (and review round 3, R3-1) on the real app: the startup
	 * path every user without a running app takes - discovery finds the daemon
	 * the operator's TUI started and `start()` is never called - so whatever
	 * observes that daemon has to be armed by the ADOPTION itself. On the old
	 * head nothing armed it, and the app reported `attached` (naming a dead pid)
	 * for 150 s after the daemon was killed, with zero push events, because the
	 * renderer's own 5 s `/health` poll is gone on this path too.
	 *
	 * Nothing here ticks by hand: adoption is the setup and the kill is the only
	 * input, which is what makes the elapsed time a measurement of the app's own
	 * observation rather than of this script's.
	 */
	const adoptedRoot = mkdtempSync(join(tmpdir(), "lop-ui-daemon-adopted-"));
	const adoptedRunDir = join(adoptedRoot, "run", "serve");
	mkdirSync(adoptedRunDir, { recursive: true });
	const adoptedDaemon = startRealDaemon("daemon 3 (adopted at startup)", adoptedRoot);
	const adoptedRecord = await waitForRecord(
		adoptedDaemon.child,
		30_000,
		adoptedRunDir,
	);
	const adoptedPid = adoptedDaemon.child.pid;
	globalThis.__evidenceConfiguredUrl = `http://${adoptedRecord.host}:${adoptedRecord.port}`;
	/*
	 * A config root of its own, so this case adopts the daemon it started and not
	 * whichever other daemon of this run ranks higher - discovery prefers a
	 * record to the configured URL, which is the ranking behaviour the section
	 * above demonstrates.
	 */
	process.env.LOCAL_OPERATOR_CONFIG_DIR = adoptedRoot;
	const observeModule = await bundleManagerModule(8);
	const observer = new observeModule.BackendServiceManager();
	const adoptedPushes = [];
	observer.onStatusChange((snapshot) =>
		adoptedPushes.push({
			at: Date.now(),
			state: snapshot.state,
			detail: snapshot.detail,
		}),
	);
	const adopted = await observer.checkExistingBackend();
	assert.equal(
		adopted,
		true,
		"the daemon the script started is found and adopted, exactly as at startup",
	);
	const adoptedSnapshot = observer.getStatusSnapshot();
	assert.equal(adoptedSnapshot.state, "attached");
	assert.equal(adoptedSnapshot.pid, adoptedPid);
	assert.equal(adoptedSnapshot.owned, false);
	say("manager.checkExistingBackend()   # index.ts:1054's startup call", "");
	line(JSON.stringify(adoptedSnapshot, null, 2));
	line(
		`(no child was spawned: owned_pid ${observer.getOwnedPid()} - this app did not start it)`,
	);
	// A healthy daemon must leave the snapshot alone, so the transition timed
	// below cannot be a settle that was going to happen anyway. Adoption itself
	// publishes the attached state once - that push is the baseline.
	const baselinePushes = adoptedPushes.length;
	assert.equal(baselinePushes, 1, "adoption publishes the attached state once");
	await new Promise((r) => setTimeout(r, 3_000));
	assert.equal(observer.getStatusSnapshot().state, "attached");
	assert.equal(
		adoptedPushes.length,
		baselinePushes,
		"a healthy daemon produces no further pushes",
	);

	const adoptedKilledAt = Date.now();
	// SIGKILL, by handle: the crash the report measured, not a stop this app asked
	// for (which would be the quit path's job and a different code path).
	adoptedDaemon.child.kill("SIGKILL");
	await new Promise((r) => adoptedDaemon.child.on("exit", r));
	assert.equal(discovery.pidLiveness(adoptedPid), "dead");
	const adoptedNoticed = await waitForPush(
		adoptedPushes,
		(snapshot) => snapshot.state !== "attached",
		observeModule.PROBE_INTERVAL_MS * 2 + 8_000,
	);
	const adoptedElapsed = adoptedNoticed.at - adoptedKilledAt;
	say(
		`daemon pid ${adoptedPid} SIGKILLed after startup; no tick called by hand`,
		`noticed in ${adoptedElapsed} ms (state ${adoptedNoticed.state}, ${adoptedPushes.length} push event(s))`,
	);
	line(`detail: ${adoptedNoticed.detail}`);
	assert.equal(
		adoptedNoticed.state,
		"detached",
		"an adopted daemon that is gone must not leave the app on `attached`",
	);
	assert.ok(
		adoptedElapsed < observeModule.PROBE_INTERVAL_MS * 2,
		`the adopted path must notice a killed daemon within two probe intervals, took ${adoptedElapsed} ms`,
	);
	assert.match(adoptedNoticed.detail, /process is gone/);
	assert.equal(
		observer.getOwnedPid(),
		null,
		"the app did not spawn a daemon to replace one it never started",
	);
	line(
		"(the dead daemon's record is refused, never re-attached, and no daemon is started in its place)",
	);
	await observer.stop(false);
	process.env.LOCAL_OPERATOR_CONFIG_DIR = ROOT;
	rmSync(adoptedRoot, { recursive: true, force: true });

	// ------------------------------------------------------------- negatives
	line("\n\n# ===== negative cases =====");

	// (a) a record whose pid is dead
	const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
	const deadPid = dead.pid;
	await new Promise((r) => dead.on("exit", r));
	const deadFile = join(RUN_DIR, `${deadPid}.json`);
	writeFileSync(
		deadFile,
		JSON.stringify({
			pid: deadPid,
			host: "127.0.0.1",
			port: 65533,
			instance_id: "instance-of-a-dead-process",
			version: "0.54.46",
			source_ref: "",
			prefix: "/tmp/gone",
			install_kind: "uv-tool",
			desktop: false,
			claim_key: "",
			started_at: Date.now() / 1000 - 600,
			heartbeat_at: Date.now() / 1000 - 600,
		}),
	);
	say(`a record whose pid (${deadPid}) is gone`, "");
	const withDead = await discovery.discoverDaemons({
		env: { LOCAL_OPERATOR_CONFIG_DIR: ROOT },
		log: () => {},
	});
	line(
		JSON.stringify(
			withDead.rejected.filter((r) => r.subject === deadFile),
			null,
			2,
		),
	);
	line(`picked instead: ${withDead.picked?.address}`);
	line(
		`reaped: ${JSON.stringify(discovery.reapStaleRecords(withDead.reapable))}`,
	);
	line(`record gone now: ${!existsSync(deadFile)}`);
	/*
	 * WHERE it went, which is the whole point: the backend's own reaper MOVES a
	 * proven-dead record into `<run dir>/reaped/<pid>.json` so the attention
	 * classifier can still answer "why did this run die". A reaper that unlinked
	 * instead turned a diagnosable death into the no-evidence case that mechanism
	 * exists to prevent, and this app reaps the same files.
	 */
	const sidecar = join(RUN_DIR, "reaped", `${deadPid}.json`);
	line(`kept as evidence at reaped/${deadPid}.json: ${existsSync(sidecar)}`);
	line(
		`its bytes: ${existsSync(sidecar) ? readFileSync(sidecar, "utf8").slice(0, 120) : "(none)"}`,
	);

	// (b) a stale heartbeat on a LIVE pid
	const wedgedFile = join(RUN_DIR, `${process.pid}.json`);
	writeFileSync(
		wedgedFile,
		JSON.stringify({
			pid: process.pid,
			host: "127.0.0.1",
			port: 65534,
			instance_id: "instance-wedged",
			version: "0.54.46",
			source_ref: "",
			prefix: "/tmp/wedged",
			install_kind: "uv-tool",
			desktop: false,
			claim_key: "",
			started_at: Date.now() / 1000 - 600,
			heartbeat_at: Date.now() / 1000 - 600,
		}),
	);
	say(`a record with a live pid (${process.pid}) and a 600s-old heartbeat`, "");
	const withWedged = await discovery.discoverDaemons({
		env: { LOCAL_OPERATOR_CONFIG_DIR: ROOT },
		log: () => {},
	});
	line(
		JSON.stringify(
			withWedged.rejected.filter((r) => r.subject === wedgedFile),
			null,
			2,
		),
	);
	line(
		`offered for reaping: ${withWedged.reapable.includes(wedgedFile)} (a live process keeps its record)`,
	);
	line(`picked instead: ${withWedged.picked?.address}`);
	/*
	 * And it is reported as its OWN fact, not merely as "blocked": a surface told
	 * only `blocksSpawn` rendered a daemon that is running as an outage, which is
	 * the remaining way this app told a user their server was offline while a
	 * process was still there.
	 */
	line(`reported as wedged records: ${JSON.stringify(withWedged.wedged)}`);
	line(
		`blocks spawn (a live process is not spawned over): ${withWedged.blocksSpawn}`,
	);
	rmSync(wedgedFile, { force: true });

	// (b2) a ZOMBIE pid: exited, never reaped, and signal 0 still says "alive"
	/*
	 * `registry.py::pid_alive(check_zombie=True)` counts a zombie dead, and
	 * `scan` spends that probe on exactly the records whose heartbeat has gone
	 * quiet. A reader using signal 0 alone called such a record `wedged`, and a
	 * wedged record blocks spawning - so a corpse whose parent never reaped it
	 * meant the app could neither attach nor start its own daemon, forever.
	 *
	 * The zombie is real rather than simulated: a Python parent forks a child that
	 * exits immediately and then does NOT wait for it, which is the only way to
	 * keep an unreaped pid alive to be probed. Its record gets a config root of its
	 * own, so `blocksSpawn` here is a fact about the corpse and nothing else - the
	 * live daemon 2 elsewhere in this run leaves its own (correctly blocking)
	 * record behind.
	 */
	zombieRoot = mkdtempSync(join(tmpdir(), "lop-ui-daemon-zombie-"));
	zombieRunDir = join(zombieRoot, "run", "serve");
	mkdirSync(zombieRunDir, { recursive: true });
	zombieParent = spawn(
		"python3",
		[
			"-c",
			"import os, sys, time\npid = os.fork()\nif pid == 0:\n    os._exit(0)\nprint(pid, flush=True)\ntime.sleep(120)\n",
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	children.push(zombieParent);
	let zombiePidRaw = "";
	const zombiePid = await new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("the zombie's parent never printed a pid")),
			30_000,
		);
		zombieParent.stdout.setEncoding("utf8");
		zombieParent.stdout.on("data", (chunk) => {
			zombiePidRaw += chunk;
			const match = zombiePidRaw.match(/\d+/);
			if (match) {
				clearTimeout(timer);
				resolve(Number(match[0]));
			}
		});
	});
	assert.equal(
		discovery.pidLiveness(zombiePid),
		"alive",
		"signal 0 cannot tell a zombie from a live process",
	);
	assert.equal(discovery.isZombie(zombiePid), true);
	assert.equal(discovery.pidLiveness(zombiePid, { checkZombie: true }), "dead");
	const zombieFile = join(zombieRunDir, `${zombiePid}.json`);
	writeFileSync(
		zombieFile,
		JSON.stringify({
			pid: zombiePid,
			host: "127.0.0.1",
			port: 65532,
			instance_id: "instance-of-a-zombie",
			version: "0.54.46",
			source_ref: "",
			prefix: "/tmp/zombie",
			install_kind: "uv-tool",
			desktop: false,
			claim_key: "",
			started_at: Date.now() / 1000 - 600,
			heartbeat_at: Date.now() / 1000 - 600,
		}),
	);
	say(
		`the zombie's record alone in a config root, with a 600s-old heartbeat`,
		"",
	);
	const withZombie = await discovery.discoverDaemons({
		env: { LOCAL_OPERATOR_CONFIG_DIR: zombieRoot },
		log: () => {},
	});
	line(
		JSON.stringify(
			withZombie.rejected.filter((r) => r.subject === zombieFile),
			null,
			2,
		),
	);
	assert.equal(
		withZombie.rejected.find((r) => r.subject === zombieFile)?.reason,
		"pid-dead",
		"a zombie is dead, not wedged",
	);
	/*
	 * The claim that matters: with a corpse in the record directory, the app may
	 * still start its own daemon. Before the zombie probe, this record classified
	 * `wedged`, and a wedged record forbids spawning - so the app could neither
	 * attach to the daemon it described nor start one, for as long as the zombie's
	 * parent declined to reap it.
	 */
	assert.equal(
		withZombie.blocksSpawn,
		false,
		"a corpse must not keep the app from starting its own daemon",
	);
	line(
		`blocks spawn: ${withZombie.blocksSpawn} (it does NOT, so the app can start its own daemon)`,
	);
	line(
		`moved aside by the reap: ${JSON.stringify(discovery.reapStaleRecords(withZombie.reapable))}`,
	);
	assert.ok(
		existsSync(join(zombieRunDir, "reaped", `${zombiePid}.json`)),
		"and the corpse's record is kept as evidence, not deleted",
	);
	await stopChild(zombieParent);
	rmSync(zombieRoot, { recursive: true, force: true });

	// (c) an unrelated listener on the port the env var names
	stranger = createServer((_req, res) => {
		res.setHeader("Content-Type", "application/json");
		res.end(
			JSON.stringify({
				status: 200,
				message: "ok",
				result: { hello: "world" },
			}),
		);
	});
	servers.push(stranger);
	await new Promise((r) => stranger.listen(0, "127.0.0.1", r));
	const strangerUrl = `http://127.0.0.1:${stranger.address().port}`;
	say(
		`VITE_LOCAL_OPERATOR_API_URL=${strangerUrl}  (an unrelated listener answering 200)`,
		"",
	);
	line(`curl: ${await curl([`${strangerUrl}/health`])}`);
	const withStranger = await discovery.discoverDaemons({
		env: { LOCAL_OPERATOR_CONFIG_DIR: ROOT },
		configuredUrl: strangerUrl,
		log: () => {},
	});
	line(
		JSON.stringify(
			withStranger.rejected.filter((r) => r.subject === strangerUrl),
			null,
			2,
		),
	);
	line(
		"\n(the old probe accepted a 200 here - that is the bug; the identity check refuses it)",
	);
	line(
		`picked: ${withStranger.picked?.address} (a daemon whose identity the record proves)`,
	);

	// (d) an older build on the port the env var names
	fakeOld = createServer((req, res) => {
		res.setHeader("Content-Type", "application/json");
		res.end(
			JSON.stringify({
				status: 200,
				message: "ok",
				result: {
					version: "0.44.66",
					instance_id: "instance-old-build",
					pid: process.pid,
					prefix: "/tmp/old-bundled-venv",
					install_kind: "pip",
				},
			}),
		);
	});
	servers.push(fakeOld);
	await new Promise((r) => fakeOld.listen(0, "127.0.0.1", r));
	const oldPort = fakeOld.address().port;
	const oldFile = join(RUN_DIR, "old-build.json");
	writeFileSync(
		oldFile,
		JSON.stringify({
			pid: process.pid,
			host: "127.0.0.1",
			port: oldPort,
			instance_id: "instance-old-build",
			version: "0.44.66",
			source_ref: "",
			prefix: "/tmp/old-bundled-venv",
			install_kind: "pip",
			desktop: false,
			claim_key: "",
			started_at: Date.now() / 1000,
			heartbeat_at: Date.now() / 1000,
		}),
	);
	say(
		"two live daemons: v0.44.66 (the configured URL) and v0.54.46 (a real daemon)",
		"",
	);
	const ranked = await discovery.discoverDaemons({
		env: { LOCAL_OPERATOR_CONFIG_DIR: ROOT },
		configuredUrl: `http://127.0.0.1:${oldPort}`,
		log: () => {},
	});
	line(
		JSON.stringify(
			ranked.candidates.map((c) => ({
				address: c.address,
				version: c.record.version,
				source: c.source,
			})),
			null,
			2,
		),
	);
	line(`picked: ${ranked.picked?.address} (v${ranked.picked?.record.version})`);
	line(
		"\n(the configured URL ranks LAST, so the newer daemon is preferred; and with preferredPrefix naming the v0.44.66 install's prefix the same ranking prefers the CLI's own install)",
	);
	const cliRanked = await discovery.discoverDaemons({
		env: { LOCAL_OPERATOR_CONFIG_DIR: ROOT },
		configuredUrl: `http://127.0.0.1:${oldPort}`,
		preferredPrefix: "/tmp/old-bundled-venv",
		log: () => {},
	});
	line(
		`with preferredPrefix=/tmp/old-bundled-venv: picked ${cliRanked.picked?.address} (v${cliRanked.picked?.record.version})`,
	);
	rmSync(oldFile, { force: true });
	// ------------------------- an outage does not become a duplicate daemon
	// LAST, because it kills daemon 2 - the live daemon the negative cases above
	// rank against and rely on.
	line(
		"\n\n# ===== a transient outage never silently starts a second daemon =====",
	);
	globalThis.__evidenceConfiguredUrl = `http://${record2.host}:${record2.port}`;
	const outageModule = await bundleManagerModule(5);
	const outageManager = new outageModule.BackendServiceManager();
	assert.equal(
		await outageManager.start(),
		true,
		"attached to the real daemon first",
	);
	assert.equal(
		outageManager.getStatusSnapshot().instanceId,
		record2.instance_id,
	);
	say("daemon 2 is killed, then three health probes run", "");
	const killedPid = daemon2.child.pid;
	await stopChild(daemon2.child);
	assert.equal(discovery.pidLiveness(killedPid), "dead");
	const states = [];
	for (let i = 0; i < 3; i++) {
		await outageManager.checkBackendHealth();
		states.push(outageManager.getStatusSnapshot().state);
	}
	say("state after each of three failed probes", JSON.stringify(states));
	assert.equal(states.at(-1), "detached");
	assert.equal(
		outageManager.getOwnedPid(),
		null,
		"an external daemon that is gone is reported, never replaced by one this app starts",
	);
	line(
		`owned_pid: ${outageManager.getOwnedPid()} (a daemon this app did not start is never replaced)`,
	);
	await outageManager.stop(false);
} finally {
	for (const child of children) await stopChild(child);
	for (const server of servers) await new Promise((r) => server.close(r));
	rmSync(ROOT, { recursive: true, force: true });
	console.log(`\n# cleaned up: ${ROOT}`);
}
