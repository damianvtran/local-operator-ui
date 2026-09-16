#!/usr/bin/env node
/**
 * Evidence run for the daemon-attach robustness work: the app's real modules
 * against a real `lop serve` daemon and a controlled slow one.
 *
 * WHY this is a script and not a test. The node-runner suites pin the RULES
 * (`daemon-health-state`, `daemon-observation`, `session-stream-token`); this
 * drives the shipped manager in one process, prints every raw observation, and
 * is the artifact a reviewer reads beside the PR. It never runs concurrently
 * with the app's matrix because it starts real daemons.
 *
 * It is deliberately runnable against BOTH trees - the base commit and the
 * head - because that is what makes it before/after evidence rather than a
 * claim: the same script, the same daemon, two trees.
 *
 *     node scripts/attach-robustness-evidence.mjs           # in a tree
 *
 * Everything is throwaway: `HOME` and `LOCAL_OPERATOR_CONFIG_DIR` point at one
 * temporary root, ports are ephemeral, and the process environment is
 * allowlisted so no inherited desktop bearer, workspace id or provider
 * credential reaches a child. The operator's own daemons, sessions, records and
 * app are never touched - no `pkill`, no shared port, no shared record
 * directory.
 *
 * The four cells, each one a symptom from the operator's report:
 *
 *   1. attach-or-honest-copy: a daemon this app did not spawn, answering the
 *      configured port, which this app holds no credential for.
 *   2. re-attach across an app restart: the daemon the PREVIOUS run spawned and
 *      left serving, addressed with the credential that run persisted.
 *   3. a daemon answering the configured origin, with no record describing it:
 *      the 09:17 spawn-onto-an-occupied-port sequence.
 *   4. a flap: a daemon whose `/health` exceeds one probe's budget while its
 *      session reads keep answering - the state the operator's machine was
 *      actually in while the UI said "Server is offline".
 */

import { execFileSync, spawn } from "node:child_process";
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
const ROOT = mkdtempSync(join(tmpdir(), "lop-ui-attach-evidence-"));
const RUN_DIR = join(ROOT, "run", "serve");
const EMPTY_ROOT = mkdtempSync(join(tmpdir(), "lop-ui-attach-empty-"));
mkdirSync(RUN_DIR, { recursive: true });

// An allowlist, not a copy: inherited desktop bearers and runtime adoption
// flags would change what these cells measure.
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
	// Nothing here may raise a window or a banner: this runs on the operator's
	// desktop while they work.
	LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
});

const say = (label, value) => {
	console.log(`\n$ ${label}`);
	if (value !== undefined && value !== "") console.log(String(value).trimEnd());
};
const line = (text) => console.log(text);

/** The app's own modules, bundled with electron, config and the logger stubbed. */
const bundleResult = await build({
	stdin: {
		/*
		 * Namespace exports, not named ones, and that is load-bearing: this script
		 * is run against the BASE tree as well as the head, and `daemon-status` on
		 * the base does not export `UNANSWERED_BEFORE_DETACHED` at all. A named
		 * import there would fail to bundle, so the two columns of this evidence
		 * could not come from one script - which is the whole of what makes it a
		 * before/after rather than two claims.
		 */
		contents: [
			'export * as manager from "./src/main/backend/backend-service";',
			'export * as status from "./src/main/backend/daemon-status";',
			'export * as shared from "./src/shared/backend-status";',
			'export * as discovery from "./src/main/backend/discovery";',
		].join("\n"),
		resolveDir: REPO,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "electron-fixture",
			setup(builder) {
				builder.onResolve({ filter: /^electron$/ }, () => ({
					path: "electron",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /^electron$/, namespace: "fixture" }, () => ({
					contents: `
					export const app = {
						getPath: (name) => (name === "home" ? process.env.HOME : globalThis.__evidenceUserData),
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
				}));
			},
		},
		{
			// The real module loads `.env` through dotenv, whose CommonJS require
			// cannot survive an ESM bundle from a data: URL. Only the two values the
			// manager reads are replaced, both from this process's own state, so the
			// manager's logic stays the shipping logic.
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
							VITE_DISABLE_BACKEND_MANAGER: "false",
						};
						export const apiConfig = { get baseUrl() { return globalThis.__evidenceConfiguredUrl; } };
					`,
						loader: "js",
					}),
				);
			},
		},
		{
			// The real logger appends into the operator's application-support
			// directory. Evidence must not touch it, and the manager's own lines are
			// part of what this run is for, so they go to stdout.
			name: "logger-fixture",
			setup(builder) {
				const emit = (level) => (message) =>
					console.log(`[app:${level}] ${String(message)}`);
				builder.onResolve({ filter: /^\.\/logger$/ }, () => ({
					path: "logger",
					namespace: "logger-fixture",
				}));
				builder.onLoad(
					{ filter: /^logger$/, namespace: "logger-fixture" },
					() => ({
						contents: `
					export const LogFileType = { INSTALLER: "installer", BACKEND: "backend", UPDATE_SERVICE: "update", OAUTH: "oauth" };
					export const logger = {
						info: (m) => console.log("[app:info] " + String(m)),
						warn: (m) => console.log("[app:warn] " + String(m)),
						error: (m) => console.log("[app:error] " + String(m)),
						debug: (m) => console.log("[app:debug] " + String(m)),
						verbose: (m) => console.log("[app:debug] " + String(m)),
					};
				`,
						loader: "js",
					}),
				);
			},
		},
	],
});

const modules = await import(
	`data:text/javascript;base64,${Buffer.from(bundleResult.outputFiles[0].text).toString("base64")}`
);
const BackendServiceManager = modules.manager.BackendServiceManager;
const PROBE_INTERVAL_MS = modules.status.PROBE_INTERVAL_MS;
/*
 * The base tree's only "misses before detach" constant is the probe-failure
 * threshold, because it does not distinguish a probe that failed from a probe
 * that never answered. Reading it here is what lets one script state both
 * columns in each tree's own terms.
 */
const UNANSWERED_BEFORE_DETACHED =
	modules.status.UNANSWERED_BEFORE_DETACHED ??
	modules.status.DEGRADED_AFTER_FAILURES;
const { isServerReachable, serverBannerCopy } = modules.shared;
const { HEALTH_PATH, CLAIM_PATH } = modules.discovery;

/** The desktop credential this app's own daemon is governed by. */
const TOKEN = "d".repeat(64);

/*
 * The app-data directory is a getter so the cells can be given their own: cell
 * 3 measures what happens when an app holds NO credential (the capability path
 * declines, and the spawn gate is what is left), and it must not inherit the
 * credential cell 2 wrote.
 */
const APP_DATA = join(ROOT, "userData");
globalThis.__evidenceUserData = APP_DATA;

process.chdir(ROOT);

const children = [];
const servers = [];
const extraRoots = [];
const managers = new Set();

function startRealDaemon(configRoot = ROOT) {
	const child = spawn("lop", ["serve", "--port", "0"], {
		env: {
			...process.env,
			LOCAL_OPERATOR_CONFIG_DIR: configRoot,
			// The spawn environment the app hands its own child. This is what makes
			// the daemon env-governed, i.e. its record publishes `claim_key: ""` and
			// the spawner's token is the only credential that opens it.
			LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
			LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
			LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(child);
	let log = "";
	child.stdout.on("data", (data) => {
		log += data;
	});
	child.stderr.on("data", (data) => {
		log += data;
	});
	return { child, text: () => log };
}

async function waitForRecord(child, runDir, timeoutMs = 40_000) {
	const file = join(runDir, `${child.pid}.json`);
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(file)) {
			try {
				return JSON.parse(readFileSync(file, "utf8"));
			} catch {
				/* a torn read mid-publish is expected */
			}
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`no record for pid ${child.pid} within ${timeoutMs}ms`);
}

const redact = (record) => ({
	...record,
	claim_key: record.claim_key
		? `<redacted, ${record.claim_key.length} chars>`
		: "",
});

const stopChild = async (child) => {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	await new Promise((resolve) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve();
		}, 5_000);
		child.on("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
};

/** What every cell reports about the manager's own view of the connection. */
function report(manager) {
	const snapshot = manager.getStatusSnapshot();
	const copy = serverBannerCopy(snapshot);
	return {
		state: snapshot.state,
		reachable: isServerReachable(snapshot.state),
		reconnecting: snapshot.reconnecting,
		unanswered: snapshot.unanswered ?? "(not reported by this tree)",
		banner: copy ? `${copy.title} ${copy.detail ?? ""}`.trim() : "(no banner)",
		detail: snapshot.detail,
		owned_pid: manager.getOwnedPid(),
	};
}

const show = (label, value) => say(label, JSON.stringify(value, null, 2));

let daemon;
let flap;
try {
	console.log(
		`# Evidence root: ${ROOT} (isolated HOME and config; env allowlisted)`,
	);
	console.log(`# Node ${process.version}, ${process.platform} ${process.arch}`);
	say(
		"lop --version",
		execFileSync("lop", ["--version"], { encoding: "utf8" }),
	);

	// ------------------------------------------------------- 1. a real daemon
	say("LOCAL_OPERATOR_CONFIG_DIR=<root> lop serve --port 0", "(starting)");
	daemon = startRealDaemon();
	const record = await waitForRecord(daemon.child, RUN_DIR);
	say(
		`serve record run/serve/${daemon.child.pid}.json (claim key redacted)`,
		JSON.stringify(redact(record), null, 2),
	);
	const address = `http://127.0.0.1:${record.port}`;

	globalThis.__evidenceConfiguredUrl = address;
	const first = new BackendServiceManager();
	managers.add(first);
	say(
		"cell 1 - attach-or-honest-copy: checkExistingBackend() with no credential",
		`adopted=${await first.checkExistingBackend()}`,
	);
	show("cell 1 - the app's own view", report(first));

	// ------------------------------------------- 2. re-attach across restarts
	/*
	 * The previous run's credential. The daemon above was spawned exactly as the
	 * app spawns one - governed by TOKEN in its environment - so this is the
	 * daemon a previous run left serving, and the file is what that run left
	 * behind for the next one to open it with.
	 */
	mkdirSync(APP_DATA, { recursive: true });
	writeFileSync(join(APP_DATA, "desktop-token"), TOKEN, { mode: 0o600 });
	const second = new BackendServiceManager();
	managers.add(second);
	say(
		"cell 2 - re-attach across an app restart: the same read, with the previous run's persisted credential",
		`adopted=${await second.checkExistingBackend()}`,
	);
	show("cell 2 - the app's own view", report(second));
	const reads = await second.requestDesktop({
		op: "sessions.list",
		limit: 500,
	});
	say(
		"cell 2 - sessions.list through the desktop plane",
		`HTTP ${reads.status} ${JSON.stringify(reads.body ?? reads)}`,
	);

	// ---------------------------- 3. spawning onto a port a daemon answers
	/*
	 * The 09:17 shape: the daemon is serving the configured address and the app's
	 * config root holds no record describing it (`no valid daemon among 0
	 * record(s)`), which is what discovery reported while the spawn ran.
	 */
	process.env.LOCAL_OPERATOR_CONFIG_DIR = EMPTY_ROOT;
	globalThis.__evidenceConfiguredUrl = address;
	// Its own app data with no credential in it: this cell is about the spawn, not
	// about a token.
	const cellThreeData = mkdtempSync(join(tmpdir(), "lop-ui-attach-cell3-"));
	extraRoots.push(cellThreeData);
	globalThis.__evidenceUserData = cellThreeData;
	const third = new BackendServiceManager();
	managers.add(third);
	say("cell 3 - the configured origin, with no record describing it", address);
	// A real bind, from this process, of the port the daemon is serving: the
	// EADDRINUSE any child of the app would hit.
	const collision = await new Promise((resolve) => {
		const probe = createServer(() => {});
		probe.on("error", (error) => resolve(error.code));
		probe.listen(record.port, "127.0.0.1", () => {
			probe.close(() => resolve("bound - the port was free"));
		});
	});
	say("cell 3 - what a second listener on that port gets", collision);
	say(
		"cell 3 - start(), which is the spawn attempt itself",
		`returned ${await third.start({ quiet: true })}`,
	);
	say(
		"cell 3 - child processes this app holds afterwards",
		`owned_pid=${third.getOwnedPid()}`,
	);
	show("cell 3 - the app's own view", report(third));

	// ---------------------------------------------------- 4. the flap
	/*
	 * A daemon whose `/health` exceeds one probe's budget while its session
	 * reads answer immediately - one long agent turn, modelled. The record is a
	 * real 0600 file in a real config root and the HTTP is real loopback, so what
	 * the probe loop reads is a real socket; only the latency is orchestrated.
	 */
	const flapRoot = mkdtempSync(join(tmpdir(), "lop-ui-attach-flap-"));
	extraRoots.push(flapRoot);
	const flapRun = join(flapRoot, "run", "serve");
	mkdirSync(flapRun, { recursive: true });
	const flapState = { slowHealth: false, healthDelayMs: 3_500, reads: [] };
	const flapServer = createServer((request, response) => {
		const path = (request.url ?? "").split("?")[0];
		const json = (status, body) => {
			response.writeHead(status, { "Content-Type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (path === HEALTH_PATH) {
			const answer = () =>
				json(200, {
					status: 200,
					result: {
						version: record.version,
						instance_id: "flap-instance",
						pid: process.pid,
						prefix: record.prefix,
						install_kind: "uv-tool",
					},
				});
			// The whole point of the cell: the probe's 2 s budget expires while the
			// daemon is serving everything else.
			if (flapState.slowHealth) setTimeout(answer, flapState.healthDelayMs);
			else answer();
			return;
		}
		if (path === CLAIM_PATH) {
			json(200, { status: 200 });
			return;
		}
		if (path === "/v1/capabilities") {
			json(200, { status: 200, result: { desktop_available: true } });
			return;
		}
		if (path === "/v1/desktop/sessions") {
			flapState.reads.push(Date.now());
			json(200, { result: { sessions: [], truncated: false, limit: 1 } });
			return;
		}
		if (path.endsWith("/events")) {
			response.writeHead(401, { "Content-Type": "application/json" });
			response.end("{}");
			return;
		}
		json(404, {});
	});
	servers.push(flapServer);
	await new Promise((resolve) => flapServer.listen(0, "127.0.0.1", resolve));
	const flapPort = flapServer.address().port;
	const flapKey = "e".repeat(64);
	writeFileSync(
		join(flapRun, `${process.pid}.json`),
		JSON.stringify({
			pid: process.pid,
			host: "127.0.0.1",
			port: flapPort,
			instance_id: "flap-instance",
			version: record.version,
			source_ref: "",
			prefix: record.prefix,
			install_kind: "uv-tool",
			desktop: false,
			claim_key: flapKey,
			started_at: Date.now() / 1000 - 10,
			heartbeat_at: Date.now() / 1000,
		}),
		{ mode: 0o600 },
	);
	process.env.LOCAL_OPERATOR_CONFIG_DIR = flapRoot;
	globalThis.__evidenceConfiguredUrl = `http://127.0.0.1:${flapPort}`;
	const flapped = new BackendServiceManager();
	managers.add(flapped);
	say(
		"cell 4 - flap: attach to a daemon whose /health will start exceeding the probe budget",
		`adopted=${await flapped.checkExistingBackend()}`,
	);
	// The daemon goes "busy": every probe now expires, every read still answers.
	flapState.slowHealth = true;
	flapState.reads.length = 0;
	const ticks = [];
	for (let tick = 1; tick <= UNANSWERED_BEFORE_DETACHED + 1; tick++) {
		// The read the operator's app was completing throughout the incident.
		const read = await flapped.requestDesktop({
			op: "sessions.list",
			limit: 500,
		});
		await flapped.checkBackendHealth();
		const snapshot = flapped.getStatusSnapshot();
		ticks.push({
			tick,
			sessions_read: read.status,
			state: snapshot.state,
			reachable: isServerReachable(snapshot.state),
			unanswered: snapshot.unanswered ?? "(not reported by this tree)",
			banner: serverBannerCopy(snapshot)?.title ?? "(no banner)",
		});
	}
	show(
		`cell 4 - ${UNANSWERED_BEFORE_DETACHED + 1} probe ticks, each with a successful read`,
		ticks,
	);
	line(
		`\n(cell 4 with the probe cadence: ${PROBE_INTERVAL_MS} ms; the operator's renderer logs "Server is offline" for the first tick whose reachable is false)`,
	);
} finally {
	for (const manager of managers) await manager.stop(false).catch(() => {});
	for (const server of servers) {
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(resolve)).catch(() => {});
	}
	if (daemon) await stopChild(daemon.child);
	for (const child of children) await stopChild(child);
	rmSync(ROOT, { recursive: true, force: true });
	rmSync(EMPTY_ROOT, { recursive: true, force: true });
	for (const dir of extraRoots) rmSync(dir, { recursive: true, force: true });
}
