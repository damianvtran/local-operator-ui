#!/usr/bin/env node
/**
 * Evidence run for the reload re-anchor: the app's real modules against a real
 * `lop serve` that moves itself in place.
 *
 * WHY this is a script and not a test. The node-runner cases in
 * `scripts/daemon-observation.test.mjs` reproduce the event against a fixture
 * daemon (same pid, same port, same accepted bearer, a new `instance_id`); this
 * one runs the REAL thing - a real `lop serve`, spawned by the app's own
 * `startOwned()`, reloaded by a real `SIGUSR1` through
 * `local_operator/server/reload.py`, which is `os.execve` under a new
 * `instance_id` - and prints the raw readings, which is the artifact a reviewer
 * and QA read beside the PR. It never runs concurrently with the app's matrix
 * because it starts a real daemon.
 *
 * It is deliberately runnable against BOTH trees - the base commit and the head -
 * because that is what makes it before/after evidence rather than a claim: the
 * same script, the same daemon, two trees, and the two columns are printed by one
 * program rather than described by two.
 *
 *     node scripts/reload-reanchor-evidence.mjs
 *
 * THE RELOAD IS REAL, and this is the one seam it needs. A serving daemon
 * reloads onto the build the INSTALL POINTER names, and refuses when that is the
 * tree it is already running ("already running the build the pointer names").
 * `lop`'s own test seam for exactly this is `LOP_INSTALL_ROOT` - documented in
 * `update.current_install_root` as "the e2e stage has to be able to point a real
 * process at a generation without owning the host's pointer" - so this script
 * clones an installed generation into a scratch root and points the daemon it
 * spawns at the clone. The operator's own pointer is READ and never written, and
 * the clone is where the successor's own writes land.
 *
 * Everything else is throwaway: `HOME` and `LOCAL_OPERATOR_CONFIG_DIR` point at
 * one temporary root, the port is ephemeral, and the process environment is
 * allowlisted so no inherited desktop bearer, workspace id or provider credential
 * reaches a child. The operator's own daemons, sessions, records, install pointer
 * and app are never touched - no `pkill`, no shared port, no shared record
 * directory.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const REPO = fileURLToPath(new URL("..", import.meta.url));
/*
 * The home the INSTALL lives in, read before this process's own environment is
 * replaced: the app resolves its launcher from a home, and the reload target is a
 * directory under this one. `HOME` for everything this script SPAWNS is the
 * scratch root below.
 */
const INSTALLED_HOME = homedir();
const ROOT = mkdtempSync(join(tmpdir(), "lop-ui-reload-evidence-"));
const RUN_DIR = join(ROOT, "run", "serve");
mkdirSync(RUN_DIR, { recursive: true });

// An allowlist, not a copy: an inherited desktop bearer or runtime adoption flag
// would change what this run measures.
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
	if (!inherited.has(name)) Reflect.deleteProperty(process.env, name);
}
/*
 * The installers' own bin directory goes on PATH, and that is a fact about how
 * this script is launched rather than a convenience: a GUI-launched app does not
 * have `~/.local/bin` on its PATH either, which is why the app's own resolution
 * searches it explicitly (`commandSearchDirs`). Under a scratch `HOME` that
 * explicit home-relative search finds nothing, so the launcher has to be
 * reachable the other way both the app and a person's shell use.
 */
const launcherDir = join(INSTALLED_HOME, ".local", "bin");
process.env.PATH = `${launcherDir}:${process.env.PATH ?? ""}`;
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
const rule = (title) =>
	console.log(
		`\n${"─".repeat(4)} ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`,
	);

/** The app's own modules, bundled with electron, config and the logger stubbed. */
const bundleResult = await build({
	stdin: {
		contents: [
			'export * as manager from "./src/main/backend/backend-service";',
			'export * as status from "./src/main/backend/daemon-status";',
			'export * as install from "./src/main/update-install";',
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
			// The real module loads `.env` through dotenv, which cannot survive an ESM
			// bundle from a data: URL. Only the value the manager reads is replaced,
			// and it comes from this process's own state.
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
			// The real logger appends into the operator's application-support directory.
			// Evidence must not touch it, and the daemon's own reload line arrives through
			// this same logger, so both go to stdout.
			name: "logger-fixture",
			setup(builder) {
				builder.onResolve({ filter: /^\.\/logger$/ }, (args) =>
					args.importer.endsWith("backend/backend-service.ts")
						? { path: "logger", namespace: "logger-fixture" }
						: undefined,
				);
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
const DEGRADED_AFTER_FAILURES = modules.status.DEGRADED_AFTER_FAILURES;
const { resolveCommandPath } = modules.install;

const APP_DATA = join(ROOT, "userData");
globalThis.__evidenceUserData = APP_DATA;

const children = [];
const managers = new Set();

async function freePort() {
	const probe = createServer();
	await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
	const { port } = probe.address();
	await new Promise((resolve) => probe.close(resolve));
	return port;
}

const recordFile = (pid) => join(RUN_DIR, `${pid}.json`);
const readRecord = (pid) => {
	try {
		return JSON.parse(readFileSync(recordFile(pid), "utf8"));
	} catch {
		return null;
	}
};
const redact = (record) =>
	record === null
		? null
		: {
				...record,
				claim_key: record.claim_key
					? `<redacted, ${record.claim_key.length} chars>`
					: "",
			};
const reading = (snapshot) => ({
	state: snapshot.state,
	owned: snapshot.owned,
	pid: snapshot.pid,
	version: snapshot.version,
	instance_id: snapshot.instanceId,
	pairing: snapshot.pairing.available
		? "paired"
		: `cause: ${snapshot.pairing.cause}`,
	failures: snapshot.failures,
	detail: snapshot.detail,
});

/** The install's generations, and the version each one carries. */
function installedVersions() {
	const generationsDir = join(
		INSTALLED_HOME,
		".local",
		"share",
		"lop",
		"generations",
	);
	if (!existsSync(generationsDir)) return [];
	return readdirSync(generationsDir)
		.sort()
		.map((name) => {
			const root = join(generationsDir, name, "tools", "local-operator");
			const python = join(root, "bin", "python");
			if (!existsSync(python)) return null;
			try {
				const version = execFileSync(
					python,
					[
						"-c",
						"import importlib.metadata as m; print(m.version('local-operator'))",
					],
					{ encoding: "utf8", timeout: 60_000 },
				).trim();
				return { name, root, version };
			} catch {
				return null;
			}
		})
		.filter((entry) => entry !== null);
}

/** APFS clones where it can: a full install tree copies in about two seconds. */
function cloneTree(source, destination) {
	if (process.platform === "darwin") {
		execFileSync("cp", ["-Rc", source, destination]);
		return;
	}
	cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
}

rule("0. what this machine has installed");
const launcher =
	resolveCommandPath("local-operator", {
		env: process.env,
		home: INSTALLED_HOME,
	}) ?? resolveCommandPath("lop", { env: process.env, home: INSTALLED_HOME });
say(
	"the launcher the app resolves for its own spawn",
	launcher ?? "none found (this rig cannot run)",
);
assert.ok(
	launcher,
	"a global install is required: it is the daemon this app spawns",
);

const versions = installedVersions();
const currentGeneration = (() => {
	const pointer = join(INSTALLED_HOME, ".local", "share", "lop", "current");
	try {
		return readFileSync(pointer, "utf8").trim();
	} catch {
		return null;
	}
})();
say(
	"installed generations (oldest first)",
	versions.map((entry) => `${entry.name} -> ${entry.version}`).join("\n"),
);
assert.ok(versions.length > 0, "at least one installed generation is required");

/*
 * A FORWARD move, which is the shape `lop-update` produces: the daemon that is
 * running is one generation behind, and the reload lands it on the build the
 * INSTALL POINTER names. Both halves belong to this rig:
 *
 *   - a launcher for the previous generation goes FIRST on PATH, and the app's own
 *     resolution searches PATH first (`commandSearchDirs`), so the daemon it
 *     spawns is the older build. The daemon's own pointer is never the rig's to
 *     write: `LOP_INSTALL_ROOT` below is what the successor moves onto, the seam
 *     `update.current_install_root` documents for exactly this;
 *   - that target is a CLONE of the newest generation, so whatever the successor
 *     writes lands in the scratch root rather than in the operator's install.
 *
 * With only one generation installed there is nothing to move between, and the
 * run still exercises the recorded event at the same version - the identity is
 * what changes, which is the whole of what this evidence is about.
 */
const newest = versions[versions.length - 1];
const running =
	versions.filter((entry) => entry.version !== newest.version).at(-1) ?? newest;
const shimDir = join(ROOT, "previous-generation-bin");
mkdirSync(shimDir, { recursive: true });
for (const name of ["local-operator", "lop"]) {
	const source = join(running.root, "bin", name);
	if (existsSync(source)) symlinkSync(source, join(shimDir, name));
}
process.env.PATH = `${shimDir}:${process.env.PATH}`;

const cloneRoot = join(ROOT, "reload-target");
cloneTree(
	join(INSTALLED_HOME, ".local", "share", "lop", "generations", newest.name),
	cloneRoot,
);
const targetRoot = join(cloneRoot, "tools", "local-operator");
assert.ok(
	existsSync(join(targetRoot, "bin", "python")),
	"the clone must be runnable",
);
say("install pointer (READ, never written)", currentGeneration);
say(
	"the launcher this rig puts first on PATH",
	join(shimDir, "local-operator"),
);
say(
	"the reload that makes possible",
	`running build: ${running.version} (${running.name})\n  successor build: ${newest.version} (a clone of ${newest.name})\n  LOP_INSTALL_ROOT: ${targetRoot}`,
);
// The daemon this app spawns inherits this, which is what gives a real reload a
// real target without the operator's pointer being touched.
process.env.LOP_INSTALL_ROOT = targetRoot;

rule("1. the app starts and OWNS its daemon");
const port = await freePort();
globalThis.__evidenceConfiguredUrl = `http://127.0.0.1:${port}`;
const manager = new BackendServiceManager();
managers.add(manager);
say("configured address", globalThis.__evidenceConfiguredUrl);
say(
	"the manager's own resolution of the install",
	await manager.checkLocalOperatorExists(),
);
const started = await manager.start({ quiet: true });
say("start()", started);
const ownedPid = manager.getOwnedPid();
assert.ok(
	ownedPid,
	"the app must own the daemon for this evidence to be about the reported shape",
);
children.push(ownedPid);
say("the pid this app spawned and holds a ChildProcess handle for", ownedPid);
say(
	"the record that pid published",
	JSON.stringify(redact(readRecord(ownedPid)), null, 2),
);
const attached = manager.getStatusSnapshot();
say("snapshot after start", JSON.stringify(reading(attached), null, 2));
const firstInstanceId = attached.instanceId;

rule("2. the credential this app holds is admitted");
const before = await manager.requestDesktop({ op: "sessions.list", limit: 1 });
say(
	"GET /v1/desktop/sessions (this app's own bearer)",
	`HTTP ${before.status}`,
);

rule("3. the daemon moves itself IN PLACE (SIGUSR1 -> os.execve)");
say(
	"trigger",
	`kill -USR1 ${ownedPid}  (the reload signal a daemon publishes reloadable: true for)`,
);
process.kill(ownedPid, "SIGUSR1");
const reloaded = await (async () => {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		const record = readRecord(ownedPid);
		if (record && record.instance_id !== firstInstanceId) return record;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error("the daemon never republished a new instance_id within 90s");
})();
assert.equal(
	reloaded.pid,
	ownedPid,
	"a reload keeps the pid: this is the fact the re-anchor rests on",
);
say(
	"the record the SAME pid republished",
	JSON.stringify(redact(reloaded), null, 2),
);
say(
	"what changed",
	`instance_id ${firstInstanceId} -> ${reloaded.instance_id}\n  version ${attached.version} -> ${reloaded.version}\n  pid ${ownedPid} -> ${reloaded.pid}, and the process is the one this app spawned`,
);

rule(
	"4. the app's own probe loop, with the traffic the live app had between probes",
);
const sequence = [];
for (let tick = 1; tick <= DEGRADED_AFTER_FAILURES + 2; tick++) {
	await manager.checkBackendHealth();
	const read = await manager.requestDesktop({ op: "sessions.list", limit: 1 });
	const snapshot = manager.getStatusSnapshot();
	sequence.push({ tick, served: `HTTP ${read.status}`, ...reading(snapshot) });
	say(`tick ${tick}`, JSON.stringify(reading(snapshot)));
	say(
		`tick ${tick}: this app's own read, the same process, after the reload`,
		`HTTP ${read.status}`,
	);
}
say(
	"the sequence, as the app's own state machine recorded it",
	JSON.stringify(sequence, null, 2),
);

rule("5. the banner's Retry (reconnectNow)");
const healed = await manager.reconnectNow();
say("reconnectNow()", JSON.stringify(reading(healed), null, 2));

rule("verdict");
const verdicts = [
	`state after ${sequence.length} probes plus one Retry: ${healed.state}`,
	`pairing: ${healed.pairing.available ? "paired" : `cause: ${healed.pairing.cause}`}`,
	`identity adopted: ${healed.instanceId === reloaded.instance_id ? "yes" : `no (still ${healed.instanceId}, the daemon answers ${reloaded.instance_id})`}`,
	`successor pairing observed in the sequence: ${
		sequence.some((entry) => entry.pairing.startsWith("cause")) ? "YES" : "no"
	}`,
	`pid stayed the process this app spawned: ${healed.pid === ownedPid ? "yes" : "no"}`,
];
for (const verdict of verdicts) line(`  - ${verdict}`);
line(
	`\n  probe interval in this build: ${PROBE_INTERVAL_MS} ms; ` +
		`contradictions before detach: ${DEGRADED_AFTER_FAILURES}`,
);

await manager.stop(false).catch(() => {});
await new Promise((resolve) => setTimeout(resolve, 500));
rmSync(ROOT, { recursive: true, force: true });
say("teardown", `stopped the daemon this app owned and removed ${ROOT}`);
