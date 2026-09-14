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

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "lop-ui-daemon-evidence-"));
const RUN_DIR = join(ROOT, "run", "serve");
mkdirSync(RUN_DIR, { recursive: true });

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
				'export { BackendServiceManager, LocalOperatorStartupMode } from "./src/main/backend/backend-service";',
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
					builder.onLoad({ filter: /^electron$/, namespace: "fixture" }, () => ({
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
					}));
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
					builder.onLoad({ filter: /^backend-config$/, namespace: "config-fixture" }, () => ({
						contents: `
							export const backendConfig = {
								get VITE_LOCAL_OPERATOR_API_URL() { return globalThis.__evidenceConfiguredUrl; },
								get VITE_DISABLE_BACKEND_MANAGER() { return process.env.VITE_DISABLE_BACKEND_MANAGER ?? "false"; },
							};
							export const apiConfig = { get baseUrl() { return globalThis.__evidenceConfiguredUrl; } };
						`,
						loader: "js",
					}));
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
					builder.onLoad({ filter: /^logger$/, namespace: "logger-fixture" }, () => ({
						contents: `
							export const LogFileType = { INSTALLER: "installer", BACKEND: "backend", UPDATE_SERVICE: "update", OAUTH: "oauth" };
							const emit = (level) => (message, _type, ...rest) =>
								console.log("[app:" + level + "]", String(message));
							export const logger = { info: emit("info"), warn: emit("warn"), error: emit("error"), debug: emit("debug"), verbose: emit("debug") };
						`,
						loader: "js",
					}));
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
function startRealDaemon(label) {
	const child = spawn("lop", ["serve", "--port", "0"], {
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(child);
	let log = "";
	child.stdout.on("data", (d) => (log += d));
	child.stderr.on("data", (d) => (log += d));
	return { child, text: () => log };
}

/** Wait for a daemon's own record (keyed by its pid) to appear. */
async function waitForRecord(child, timeoutMs = 30_000) {
	const file = join(RUN_DIR, `${child.pid}.json`);
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

const redact = (record) => ({
	...record,
	claim_key: record.claim_key ? `<redacted, ${record.claim_key.length} chars>` : "",
});

// `--max-time` so a listener that accepts a connection and never answers shows
// up as a timeout in the evidence rather than hanging the run.
const curl = (args) =>
	spawnSync("curl", ["-sS", "-i", "-m", "10", ...args], { encoding: "utf8" })
		.stdout ?? "";

const stopChild = async (child) => {
	if (child.exitCode !== null) return;
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

try {
	console.log(`# Evidence root: ${ROOT} (isolated; LOCAL_OPERATOR_CONFIG_DIR)`);

	// ---------------------------------------------------------------- real daemon
	say("LOCAL_OPERATOR_CONFIG_DIR=%s lop serve --port 0", ROOT);
	daemon1 = startRealDaemon("daemon1");
	const record1 = await waitForRecord(daemon1.child);
	say(`cat ${RUN_DIR}/${daemon1.child.pid}.json`, JSON.stringify(redact(record1), null, 2));
	line(`\n(reported version: ${record1.version}; install_kind: ${record1.install_kind})`);

	say(`curl -sS ${`http://${record1.host}:${record1.port}`}/health`);
	line(curl([`http://${record1.host}:${record1.port}/health`]));

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
	line(curl([`${base}/v1/capabilities`]));
	say("# a WRONG key is refused with 401, before anything has claimed the plane", "");
	line(
		curl([
			"-X",
			"POST",
			"-H",
			"Authorization: Bearer not-the-key",
			"-H",
			"Content-Type: application/json",
			"-d",
			"{}",
			`${base}/v1/desktop/claim`,
		]),
	);
	say("curl -X POST /v1/desktop/claim with the record's key (native caller, no Origin)", "");
	line(
		curl([
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
	say("# a second claim is refused by the latch (409): the plane is already governed", "");
	line(
		curl([
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
	say(`curl -sS ${base}/v1/capabilities   # after the claim`, "");
	line(curl([`${base}/v1/capabilities`]));

	await stopChild(daemon1.child);
	line(`\n(daemon 1 stopped; its record is left on disk for the next phase)`);

	// ------------------------------------------------- manager: attach, not spawn
	line("\n\n# ===== the app's BackendServiceManager, against a real daemon =====");
	daemon2 = startRealDaemon("daemon2");
	const record2 = await waitForRecord(daemon2.child);
	line(`(daemon 2: pid ${daemon2.child.pid} at ${record2.host}:${record2.port}, v${record2.version}, claim_key ${record2.claim_key ? "published" : "absent"})`);

	stranger = createServer((_req, res) => {
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ status: 200, message: "ok", result: { hello: "world" } }));
	});
	servers.push(stranger);
	await new Promise((r) => stranger.listen(0, "127.0.0.1", r));
	const managerStrangerUrl = `http://127.0.0.1:${stranger.address().port}`;
	globalThis.__evidenceConfiguredUrl = managerStrangerUrl;
	say(`VITE_LOCAL_OPERATOR_API_URL=${managerStrangerUrl}  (an unrelated listener; a real daemon exists elsewhere)`, "");
	process.env.LOCAL_OPERATOR_CONFIG_DIR = ROOT;
	delete process.env.VITE_DISABLE_BACKEND_MANAGER;
	const managerModule = await bundleManagerModule(1);
	const manager = new managerModule.BackendServiceManager();
	const started = await manager.start();
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
	line("(no child was spawned: owned_pid is null, and the log above has no 'Starting backend service with')");

	say("manager.stop(false)   # attached to a daemon this app did not start", "");
	await manager.stop(false);
	line(
		`daemon 2 pid after stop(false): ${discovery.pidLiveness(daemon2.child.pid)} (must stay alive - the app did not spawn it)`,
	);
	line(
		`daemon 2 record still on disk: ${existsSync(join(RUN_DIR, `${daemon2.child.pid}.json`))} (nothing on disk was touched)`,
	);

	// ----------------------------------- the disable flag no longer means "assume"
	line("\n\n# ===== VITE_DISABLE_BACKEND_MANAGER=true: discover, never spawn or kill =====");
	process.env.VITE_DISABLE_BACKEND_MANAGER = "true";
	const disabledModule = await bundleManagerModule(2);
	const disabledManager = new disabledModule.BackendServiceManager();
	const discovered = await disabledManager.checkExistingBackend();
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
	say("with NO daemon at all, manager.start() under the flag", `-> ${noneStarted}`);
	line(JSON.stringify(noneManager.getStatusSnapshot(), null, 2));
	line(
		"(it reports the state and keeps looking; the old early return claimed a backend existed and skipped discovery entirely)",
	);
	// Stop its probe loop, or the interval keeps this process alive.
	await noneManager.stop(false);
	process.env.LOCAL_OPERATOR_CONFIG_DIR = ROOT;
	rmSync(noDaemonRoot, { recursive: true, force: true });

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
	line(JSON.stringify(withDead.rejected.filter((r) => r.subject === deadFile), null, 2));
	line(`picked instead: ${withDead.picked?.address}`);
	line(`reaped: ${JSON.stringify(discovery.reapStaleRecords(withDead.reapable))}`);
	line(`record gone now: ${!existsSync(deadFile)}`);

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
	line(JSON.stringify(withWedged.rejected.filter((r) => r.subject === wedgedFile), null, 2));
	line(`offered for reaping: ${withWedged.reapable.includes(wedgedFile)} (a live process keeps its record)`);
	line(`picked instead: ${withWedged.picked?.address}`);
	rmSync(wedgedFile, { force: true });

	// (c) an unrelated listener on the port the env var names
	stranger = createServer((_req, res) => {
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ status: 200, message: "ok", result: { hello: "world" } }));
	});
	servers.push(stranger);
	await new Promise((r) => stranger.listen(0, "127.0.0.1", r));
	const strangerUrl = `http://127.0.0.1:${stranger.address().port}`;
	say(`VITE_LOCAL_OPERATOR_API_URL=${strangerUrl}  (an unrelated listener answering 200)`, "");
	line(`curl: ${curl([`${strangerUrl}/health`])}`);
	const withStranger = await discovery.discoverDaemons({
		env: { LOCAL_OPERATOR_CONFIG_DIR: ROOT },
		configuredUrl: strangerUrl,
		log: () => {},
	});
	line(JSON.stringify(withStranger.rejected.filter((r) => r.subject === strangerUrl), null, 2));
	line(
		`\n(the old probe accepted a 200 here - that is the bug; the identity check refuses it)`,
	);
	line(`picked: ${withStranger.picked?.address} (a daemon whose identity the record proves)`);

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
	say("two live daemons: v0.44.66 (the configured URL) and v0.54.46 (a real daemon)", "");
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
	line(`with preferredPrefix=/tmp/old-bundled-venv: picked ${cliRanked.picked?.address} (v${cliRanked.picked?.record.version})`);
	rmSync(oldFile, { force: true });
} finally {
	for (const child of children) await stopChild(child);
	for (const server of servers) await new Promise((r) => server.close(r));
	rmSync(ROOT, { recursive: true, force: true });
	console.log(`\n# cleaned up: ${ROOT}`);
}
