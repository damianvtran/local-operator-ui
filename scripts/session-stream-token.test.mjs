import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * The event relay must follow the desktop token, and a watchdog restart must
 * not shoot the machine's other backends.
 *
 * WHY these two cases, and why they are one file: they are the same defect
 * seen from two sides of `BackendServiceManager`. The operator's report was
 * "every conversation opens with its title and an empty composer", and the log
 * beside it shows the sequence - a managed backend start at 10:53:40, then
 * `GET /v1/desktop/sessions/<id>/events` refused 401 from 10:56:36 while
 * `sessions?limit=500` and `sessions.get` stayed 200 in the same window, then
 * 200 again for everything after the app was restarted at 10:59:51. Two
 * rotations in that log are one cause: `start()` mints a new `desktopToken`
 * every time and the SSE relay only rebuilt when the URL changed, so an
 * in-place restart left it authenticating with the dead token. The same log
 * shows the restart announcing `(isRestart: false)` and taking the
 * final-shutdown path, whose Unix cleanup is a machine-wide
 * `pkill -f "local-operator serve"` - which killed peer sessions' servers, and
 * is why other app instances started reporting "Server is offline" seconds
 * later.
 *
 * The subject is therefore the REAL `BackendServiceManager` and the REAL
 * `DesktopStreamRelay`, driven against a real loopback HTTP fixture: a socket
 * either receives the live bearer or it does not. Only three things are
 * substituted, and each one keeps the machine safe rather than making the test
 * easier:
 *
 *   - `node:child_process` is replaced so no backend is ever spawned. Without
 *     this the manager would try to start a real server, and this box already
 *     runs one on port 1111 that belongs to the operator.
 *   - `./config` is replaced so `backendUrl` is the fixture's ephemeral port
 *     rather than the `.env` value. The real config module parses
 *     `process.cwd()/.env` with `override: true`, so without the substitution
 *     the manager would be pointed at 127.0.0.1:1111 - the operator's live
 *     backend. `VITE_DISABLE_BACKEND_MANAGER` is false here so the managed
 *     path (the one that rotates the token) actually runs.
 *   - `./logger` is replaced because the real one appends every line to
 *     `~/Library/Application Support/Local Operator/logs`, which is the log
 *     this test exists to explain. It records instead, which is also what lets
 *     the cleanup assertion below read "the final-shutdown path was not
 *     entered" rather than assume it.
 *
 * Anything else - the relay, its cache decision, the token mint, the stop
 * intent - is the shipping code.
 */

const HOME = mkdtempSync(join(tmpdir(), "session-stream-token-"));

/*
 * Discovery reads the rendezvous records under the config root, and the
 * operator's machine has one daemon record per process they have run there. A
 * test that read that directory would attach to (or reap) a real daemon's
 * record, so the root is isolated here: no records means discovery finds
 * nothing and the manager takes the deprecated pre-record path, which is the
 * path these four cases were written against.
 */
process.env.LOCAL_OPERATOR_CONFIG_DIR = HOME;

/**
 * The fixture's state, shared with the bundled module.
 *
 * `healthy` starts false so the FIRST `checkExistingBackend()` probe finds
 * nothing (a non-ok response returns false and the managed path runs); the
 * spawn fixture flips it true, so the post-spawn health loop that follows
 * succeeds immediately. That ordering is what a managed start looks like from
 * the manager's side.
 */
const state = {
	healthy: false,
	spawns: [],
	execs: [],
	eventsAuth: [],
	eventsStatus: [],
	/** The bearer this fixture's desktop vocabulary accepts, or null for none. */
	pairedToken: null,
	/** Every authenticated read it served, for the adoption assertions. */
	sessionsAuth: [],
};

/** The bundled module's view of that state. */
globalThis.__backendTestState = state;

const bundle = await build({
	stdin: {
		contents:
			'export { BackendServiceManager } from "./src/main/backend/backend-service.ts"; export { DesktopStreamRelay } from "./src/main/desktop-stream.ts"; export { DESKTOP_STREAM_DETAIL, streamFailureNotice } from "./src/shared/desktop-stream-notice.ts"; export { DEGRADED_AFTER_FAILURES } from "./src/main/backend/daemon-status.ts";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "main-process-fixtures",
			setup(builder) {
				// Launch identity has real-child coverage in owned-serve-lifecycle;
				// this fixture measures the spawn environment, not installation.
				builder.onResolve({ filter: /owned-serve-launch$/ }, () => ({
					path: "launch",
					namespace: "owned-launch-fixture",
				}));
				builder.onLoad(
					{ filter: /.*/, namespace: "owned-launch-fixture" },
					() => ({
						loader: "js",
						contents: `
					export const consoleInterpreter = () => "/fixture/python";
					export const windowsInterpreterCandidates = async () => ["/fixture/python"];
					export const windowsPathInterpreterCandidates = async () => ["/fixture/python"];
					export const ownedServeLaunch = async (interpreters, port, env) => ({ command: "bash", args: ["-c", 'exec "$@"', "owned-serve", interpreters[0], "-c", "from local_operator.cli import main; main()", "serve", "--port", String(port)], env });
				`,
					}),
				);

				/** Every substitution names its original, so a reader can see
				 * exactly what is not shipping code in this run. */
				const aliases = new Map([
					[/^electron$/, "electron-fixture"],
					[/^node:child_process$/, "child-process-fixture"],
				]);
				for (const [filter, name] of aliases) {
					builder.onResolve({ filter }, () => ({
						path: name,
						namespace: "fixture",
					}));
				}
				// Resolved by IMPORTER as well as specifier: `./logger` and
				// `./config` exist in other directories, and replacing the wrong
				// one would leave the real logger writing to the operator's log.
				const backendOnly = [
					[/^\.\/logger$/, "backend-logger-fixture"],
					[/^\.\/config$/, "backend-config-fixture"],
				];
				for (const [filter, name] of backendOnly) {
					builder.onResolve({ filter }, (args) =>
						args.importer.endsWith("main/backend/backend-service.ts")
							? { path: name, namespace: "fixture" }
							: undefined,
					);
				}
				builder.onLoad(
					{
						filter:
							/^(electron-fixture|child-process-fixture|backend-logger-fixture|backend-config-fixture)$/,
						namespace: "fixture",
					},
					(args) => {
						const sources = {
							"electron-fixture": `
									export const app = { getPath: (name) => name === "userData" ? ${JSON.stringify(join(HOME, "userData"))} : ${JSON.stringify(HOME)} };
									export const dialog = { showErrorBox: () => {} };
								`,
							"child-process-fixture": `
									/*
									 * A recording stand-in for node:child_process. It exists so no
									 * process is spawned: the manager's own spawn call is where a real
									 * backend would start on this machine.
									 *
									 * The exit listeners are split by registration, because stop()
									 * waits on a \`once("exit")\` promise while start() keeps a
									 * persistent \`on("exit")\` handler - firing the wrong one would
									 * leave stop() waiting for its full 10s timeout.
									 */
									function makeChild(env) {
 const persistent = new Map();
 const onceOnly = new Map();
 const listeners = new Map([["persistent", persistent], ["once", onceOnly]]);
										return {
											/*
											 * A pid that is genuinely ALIVE, because the manager
											 * checks liveness before it probes: a fixed pretend pid
											 * (4242) is usually nobody, and the manager would read
											 * that as "the daemon's process is gone" and detach on
											 * every tick - the fixture would be testing its own
											 * honesty about pids rather than the watchdog.
											 */
											pid: process.pid,
											// Real ChildProcess fields stay null until exit; undefined
											// would model a malformed fixture rather than a live child.
											exitCode: null,
											signalCode: null,
											stdout: null,
											stderr: null,
											killed: [],
											on(event, cb) {
												const list = listeners.get("persistent").get(event) ?? [];
												list.push(cb);
												listeners.get("persistent").set(event, list);
												return this;
											},
											once(event, cb) {
												const list = listeners.get("once").get(event) ?? [];
												list.push(cb);
												listeners.get("once").set(event, list);
												return this;
											},
											kill(signal) {
												this.signalCode = signal;
												this.killed.push(signal);
												const fire = (map) => {
													const cbs = map.get("exit") ?? [];
													map.set("exit", []);
													for (const cb of cbs) cb(0, signal);
												};
												fire(onceOnly);
												fire(persistent);
												return true;
											},
											/**
											 * The child DIED on its own, without anyone calling kill().
											 *
											 * This is Q-2's repro from the manager's side: a SIGKILL in the real
											 * app, whose exit handler is the PERSISTENT listener start()
											 * registered. Fired with a null code, which is what a SIGKILL
											 * reports and the one code that shows no error dialog.
											 */
											exitNow(code = null) {
												const cbs = [...(persistent.get("exit") ?? []), ...(onceOnly.get("exit") ?? [])];
 onceOnly.set("exit", []);
 this.exitCode = code;
 for (const cb of cbs) cb(code, null);
											},
										};
									}
									export function spawn(command, args, options) {
										const child = makeChild(options?.env ?? {});
										globalThis.__backendTestState.spawns.push({
											command,
											args,
											token: options?.env?.LOCAL_OPERATOR_DESKTOP_TOKEN ?? null,
											child,
										});
										// The backend this stands in for is up the moment it is
										// "spawned", which is what the health loop waits for.
										globalThis.__backendTestState.healthy = true;
										return child;
									}
									/**
									 * Imported by python-bytecode-cache (which every spawn env goes
									 * through). It only ever decides whether to echo a warning, so a null
									 * result is enough and nothing is executed.
									 */
									export function spawnSync() {
										return { status: 0, stdout: "", stderr: "" };
									}
									/**
									 * The probe \`isZombie\` makes on macOS (\`ps -o state= -p <pid>\`), and the
									 * only reason this stub needs an answer for it: discovery spends that
									 * probe on a record whose heartbeat has gone quiet. \`S\` is a live,
									 * non-zombie process state, which is the fail-closed answer the real
									 * probe gives on any doubt - so the manager's own logic stays the
									 * subject here rather than this fixture's idea of a process table.
									 */
									export function execFileSync() {
										return "S";
									}
									export function exec(command, options, callback) {
										const done = typeof options === "function" ? options : callback;
										globalThis.__backendTestState.execs.push(command);
										// Empty stdout: "local-operator is not installed globally", so
										// the venv branch is taken and the spawn above is the one
										// recorded. No command is ever really run.
										if (done) done(null, { stdout: "", stderr: "" });
										return { on() {}, kill() {} };
									}
									/**
									 * Imported by managed-python (through venv-paths, which the manager
									 * constructs from). Nothing on that path executes anything - the runtime
									 * copy and the prepared venv are the installer's job - so this is
									 * recorded and REJECTED rather than stubbed green: a future change that
									 * starts a real command from import or construction fails here instead
									 * of spawning on the operator's machine.
									 */
									export function execFile(command, args, options, callback) {
										const done = typeof options === "function" ? options : callback;
										globalThis.__backendTestState.execs.push(
											"execFile:" + command + " " + (args ?? []).join(" "),
										);
										const error = new Error(
											"this fixture runs no command: " + command,
										);
										if (done) done(error, "", "");
										return { on() {}, kill() {} };
									}
								`,
							"backend-logger-fixture": `
									export const LogFileType = {
										INSTALLER: "backend-installer.log",
										BACKEND: "backend-service.log",
										UPDATE_SERVICE: "update-service.log",
										OAUTH: "oauth-service.log",
									};
									const record = (level) => (...args) => {
										globalThis.__backendTestState.execs.push(
											"log:" + level + ":" + args.map(String).join(" "),
										);
									};
									export const logger = {
										info: record("info"),
										warn: record("warn"),
										error: record("error"),
										debug: record("debug"),
									};
								`,
							"backend-config-fixture": `
									/*
										* The URL is a GETTER, not a snapshot: the adoption tests have to point
										* a fresh manager at a different origin than a previous one used, and
									* backendUrl is derived from this value in the constructor. A frozen
									* property would silently reuse the first test's port and every
									* assertion after it would be made against the wrong server.
									*/
									export const backendConfig = {
									get VITE_LOCAL_OPERATOR_API_URL() {
										return globalThis.__backendTestUrl;
									},
									VITE_DISABLE_BACKEND_MANAGER: "false",
									};
								`,
						};
						return { contents: sources[args.path], loader: "js" };
					},
				);
			},
		},
	],
});

const SESSION = "92602660eb9e";

let server;
let url;
server = createServer(async (req, res) => {
	const path = (req.url ?? "").split("?")[0];
	if (path === "/health") {
		res.writeHead(state.healthy ? 200 : 503, {
			"Content-Type": "application/json",
		});
		res.end("{}");
		return;
	}
	/*
	 * The desktop vocabulary's authenticated read, in the shape
	 * `requestDesktop({ op: "sessions.list" })` asks for. It answers 200 only for
	 * the bearer this fixture was told to accept, which is what makes it able to
	 * separate "a process is healthy" from "this app may use it" - the
	 * distinction the adoption gate now rests on (QA round 1, Q-1).
	 */
	if (path === "/v1/desktop/sessions") {
		const presented = (req.headers.authorization ?? "").replace("Bearer ", "");
		state.sessionsAuth.push(presented);
		const ok = state.pairedToken !== null && presented === state.pairedToken;
		res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify(
				ok
					? { result: { sessions: [], truncated: false, limit: 1 } }
					: { detail: "Unauthorized" },
			),
		);
		return;
	}
	if (path.endsWith("/events")) {
		// The backend's own rule, and the whole point of the fixture: the
		// bearer must be the token the CURRENT backend process was started
		// with. Anything else is 401 and no stream.
		const live = state.spawns.at(-1)?.token ?? null;
		const presented = (req.headers.authorization ?? "").replace("Bearer ", "");
		state.eventsAuth.push(presented);
		const ok = live !== null && presented === live;
		state.eventsStatus.push(ok ? 200 : 401);
		if (!ok) {
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ detail: "Unauthorized" }));
			return;
		}
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		res.write(
			`data: ${JSON.stringify({
				type: "open",
				epoch: "e".repeat(16),
				seq: 0,
				payload: { subscription_id: "a".repeat(32), gap: false },
			})}\n\n`,
		);
		res.end();
		return;
	}
	res.writeHead(404, { "Content-Type": "application/json" });
	res.end("{}");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
url = `http://127.0.0.1:${server.address().port}`;
// Read by the bundled config fixture at import time above, which is why the
// server is listening before the bundle is imported.
globalThis.__backendTestUrl = url;

/*
 * Imported AFTER the fixture is listening, and that order is load-bearing: the
 * config fixture reads `globalThis.__backendTestUrl` while the module is being
 * evaluated, so importing first leaves `backendUrl` undefined and the manager
 * silently falls back to its `http://127.0.0.1:1111` default. Every assertion
 * below would then be made against whatever answers on the operator's own port.
 * The `backendUrl` assertion in the first test exists so that failure can only
 * ever be loud.
 */
const {
	BackendServiceManager,
	DesktopStreamRelay,
	DESKTOP_STREAM_DETAIL,
	streamFailureNotice,
	DEGRADED_AFTER_FAILURES,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

after(async () => {
	await new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
});

/** Wait for `check`, or fail with what was seen instead of hanging the run. */
async function waitFor(check, describe) {
	const deadline = Date.now() + 5000;
	for (;;) {
		const value = check();
		if (value) return value;
		if (Date.now() > deadline)
			throw new Error(`timed out waiting for ${describe}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/**
 * One subscription against a relay, resolved as the frames arrive. The relay
 * pushes frames asynchronously, so the assertion has to wait for the first one
 * rather than read a return value.
 */
function subscribeOnce(relay) {
	const frames = [];
	relay.subscribe({ sessionId: SESSION }, (frame) => frames.push(frame));
	return frames;
}

test("the relay authenticates with the token the current backend was started with", async () => {
	const manager = new BackendServiceManager();
	try {
		// The guard for the ordering trap described where this bundle is imported:
		// a manager pointed anywhere but the fixture would be talking to a real
		// backend, and this suite must never do that.
		assert.equal(manager.backendUrl, url);
		assert.equal(await manager.start(), true);
		const firstToken = state.spawns.at(-1)?.token;
		assert.match(
			firstToken ?? "",
			/^[a-f0-9]{64}$/,
			"a managed start must mint a desktop token for the spawned backend",
		);

		const before = subscribeOnce(manager.getStreamRelay());
		await waitFor(() => before.length > 0, "the first stream frame");
		assert.equal(
			state.eventsStatus.at(-1),
			200,
			"the first subscription must authenticate",
		);
		assert.equal(before[0].kind, "data");

		/*
		 * The operator's in-place restart: the URL does not change, only the
		 * token. This is the exact condition the URL-only relay cache key missed.
		 */
		state.healthy = false;
		await manager.stop(true);
		assert.equal(await manager.start(), true);
		const secondToken = state.spawns.at(-1)?.token;
		assert.notEqual(
			secondToken,
			firstToken,
			"a managed restart mints a new token, which is what makes the URL an insufficient cache key",
		);

		const after = subscribeOnce(manager.getStreamRelay());
		await waitFor(() => after.length > 0, "the post-restart stream frame");
		assert.deepEqual(
			state.eventsAuth.at(-1),
			secondToken,
			"the relay after an in-place restart must present the NEW token, not the retired one",
		);
		assert.equal(
			state.eventsStatus.at(-1),
			200,
			"the post-restart subscription must be accepted; a 401 here is the empty-conversation bug",
		);
		assert.equal(after[0].kind, "data");
	} finally {
		state.healthy = true;
		await manager.stop(true);
	}
});

test("a watchdog timeout never terminates a still-live owned daemon", async () => {
	const manager = new BackendServiceManager();
	try {
		state.healthy = false;
		assert.equal(await manager.start(), true);
		state.healthy = true;
		assert.ok(manager.process, "the managed start must leave a live process");

		const stopIntents = [];
		const realStop = manager.stop.bind(manager);
		manager.stop = (isRestart) => {
			stopIntents.push(isRestart);
			return realStop(isRestart);
		};
		// Failing samples, driven directly rather than by waiting out the probe
		// interval that would produce them.
		//
		// Bounded to the detach threshold deliberately. `checkHealth` is also the
		// method the replacement `start()` polls while it waits for its new
		// process, so a blanket `false` here would make a recovery spend its whole
		// retry budget (30s) before the test could finish - a property of the
		// stub, not of the manager.
		const realCheckHealth = manager.checkHealth.bind(manager);
		let samples = 0;
		manager.checkHealth = async () => {
			samples += 1;
			return samples <= DEGRADED_AFTER_FAILURES ? false : realCheckHealth();
		};

		manager.discoverAndAttach = async () => false;
		const execsBefore = state.execs.length;
		const spawnsBefore = state.spawns.length;
		// Three failing probes: the threshold before the state is `detached` and
		// recovery is allowed to act. One sample is `degraded`, which never
		// restarts anything - that is the point of the change.
		for (let i = 0; i < DEGRADED_AFTER_FAILURES; i++) {
			await manager.checkBackendHealth();
		}

		assert.deepEqual(
			stopIntents,
			[],
			"three timeouts do not authorize killing a live daemon or its active turns",
		);
		assert.equal(
			state.spawns.length,
			spawnsBefore,
			"no replacement on uncertainty",
		);
		const commands = state.execs.slice(execsBefore);
		assert.deepEqual(
			commands.filter((command) => command.includes("pkill")),
			[],
			"a watchdog restart must not run a machine-wide pkill: it kills peer sessions' servers and other instances' backends",
		);
		assert.equal(
			commands.some((command) => command.includes("additional cleanup")),
			false,
		);
	} finally {
		state.healthy = true;
		await manager.stop(true);
	}
});

/*
 * Q-1: adoption is a PAIRING decision, not a liveness probe.
 *
 * The old `checkExistingBackend()` adopted any healthy server on the configured
 * origin even with no desktop token, and on a failed first probe it fell back to
 * a hardcoded `http://localhost:1111` and rotated `backendUrl` onto it. Both
 * outcomes attach the app to a backend it cannot authenticate to - every session
 * list and every stream then 401s, which is the empty-conversation outcome this
 * PR exists to remove - and the fallback additionally let a rig configured for
 * an isolated port silently become a client of the operator's live server.
 *
 * These three cases pin the three arms of the replacement rule: an unpaired app
 * adopts nothing; a paired app adopts only after the server ACCEPTS its bearer;
 * a paired app whose bearer is refused adopts nothing and spawns its own
 * backend. The hardcoded origin itself cannot be exercised here - binding port
 * 1111 on this machine would take the operator's own backend - so the last
 * assertion pins its ABSENCE in the source instead of pretending to hit it.
 */
test("an unpaired app does not adopt a healthy backend it can never authenticate to (Q-1)", async () => {
	const saved = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
	delete process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
	try {
		// Healthy, answering on the CONFIGURED origin: under the old rule this is
		// exactly the state that was adopted with no credential at all.
		state.healthy = true;
		state.pairedToken = "a".repeat(64);
		const manager = new BackendServiceManager();
		assert.equal(manager.backendUrl, url);
		assert.equal(
			await manager.checkExistingBackend(),
			false,
			"a healthy server with no token for it is not adoptable: the app would attach to a backend that refuses every session and stream",
		);
		assert.equal(
			manager.isUsingExternalBackend(),
			false,
			"nothing was adopted, so the app starts its own backend as before",
		);
		// And it can: `start()` reaches a real spawn even though the configured
		// origin answers health, because adoption is what was declined.
		const spawnsBefore = state.spawns.length;
		assert.equal(await manager.start(), true);
		assert.equal(
			state.spawns.length,
			spawnsBefore + 1,
			"declining to adopt must fall through to a managed start",
		);
		assert.match(state.spawns.at(-1)?.token ?? "", /^[a-f0-9]{64}$/);
		await manager.stop(true);
	} finally {
		state.healthy = false;
		if (saved === undefined) delete process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
		else process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = saved;
	}
});

test("a paired app adopts the configured backend, and only once it accepts the token (Q-1)", async (t) => {
	const saved = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
	const pairingToken = "b".repeat(64);
	/*
	 * A manager that ATTACHES now arms the probe loop (round 3, Q-1), so it owns
	 * a live interval - and a case that adopts and walks away would hold this
	 * file's process open forever. Torn down from the test's own hook, so a
	 * failing assertion cannot leave it behind either.
	 */
	let adopting = null;
	t.after(async () => {
		if (adopting) await adopting.stop(true);
	});
	process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = pairingToken;
	try {
		state.healthy = true;
		// The server accepts the WRONG bearer first: a health 200 alone must not
		// be enough, which is the half the old code never checked.
		state.pairedToken = "c".repeat(64);
		state.sessionsAuth.length = 0;
		const refused = new BackendServiceManager();
		assert.equal(await refused.checkExistingBackend(), false);
		assert.equal(refused.isUsingExternalBackend(), false);
		assert.equal(
			state.sessionsAuth.at(-1),
			pairingToken,
			"the app has to actually present its bearer before it can claim the backend",
		);

		// Now the server holds the token the app was paired with.
		state.pairedToken = pairingToken;
		const manager = new BackendServiceManager();
		adopting = manager;
		assert.equal(await manager.checkExistingBackend(), true);
		assert.equal(
			manager.isUsingExternalBackend(),
			true,
			"a paired, authenticated backend is adopted - the legitimate external-backend path still works",
		);
		assert.equal(
			state.sessionsAuth.at(-1),
			pairingToken,
			"adoption follows a successful authenticated read",
		);
	} finally {
		state.healthy = false;
		state.pairedToken = null;
		if (saved === undefined) delete process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
		else process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = saved;
	}
});

test("adoption never probes an origin other than the one the app was configured with (Q-1)", async () => {
	// The fallback is deleted, and it cannot be exercised by binding the port it
	// used (1111 is the operator's live backend on this machine). Pinned in the
	// source instead, so a future edit that reintroduces a second origin fails
	// here rather than on a rig that silently adopts a stranger.
	const source = await readFile(
		new URL("../src/main/backend/backend-service.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		source,
		/localhost:1111|altUrl/,
		"no hardcoded fallback origin: a configured rig must never adopt a server on a different port",
	);
	/*
	 * The configured origin is the only address the adoption path may DIAL
	 * without a record to answer for it, and even there it must prove the
	 * daemon is the one a record described. Adoption is: enumerate the records,
	 * require `/health` to report the record's own `instance_id`, require a
	 * bearer the daemon accepts, and only then rotate onto it.
	 *
	 * The slice below is the RECORD-BACKED path - the sweep that enumerates and
	 * ranks the records, plus the candidate attach - and ends where the
	 * deprecated pre-record fallback is declared. It used to end at
	 * `authenticatesAgainst(`, which left `legacyFixedPortAdoption` outside the
	 * slice: that method DOES fetch `${backendUrl}${HEALTH_PATH}` directly (it
	 * has no record to answer for it, which is what makes it deprecated), so
	 * the message claimed more than the slice checked. The positive assertion
	 * after it pins where that one direct fetch is allowed to live.
	 */
	const adoption = source.slice(
		source.indexOf("async adoptFirstUsableDaemon"),
		source.indexOf("private async legacyFixedPortAdoption("),
	);
	assert.match(
		adoption,
		/probe|discoverDaemons/,
		"the record-backed adoption path must go through discovery, never a fetch of its own",
	);
	assert.doesNotMatch(
		adoption,
		/fetch\(/,
		"the record-backed adoption path must not fetch an origin directly: identity comes from the record, through the probe",
	);
	assert.doesNotMatch(
		adoption,
		/https?:\/\/[a-z0-9.:]+/i,
		"no literal origin to fall back to",
	);
	/*
	 * The one direct fetch adoption still makes, pinned to the method that is
	 * allowed to make it. Without this pairing the negative assertion above
	 * would be reworded again the moment somebody moved the fetch, because
	 * nothing states where it belongs: the pre-record fallback, reachable only
	 * when the record directory is empty.
	 */
	const legacyAdoption = source.slice(
		source.indexOf("private async legacyFixedPortAdoption("),
		source.indexOf("private async authenticatesAgainstBackend("),
	);
	assert.match(
		legacyAdoption,
		/fetch\(/,
		"the deprecated pre-record fallback is where a direct fetch belongs, because it has no record to identify the daemon with",
	);
	// The identity half of the rule, from the module that owns it.
	const discoverySource = await readFile(
		new URL("../src/main/backend/discovery.ts", import.meta.url),
		"utf8",
	);
	assert.match(
		discoverySource,
		/identity\.instanceId !== expectedInstanceId/,
		"a 200 is not identification: the answering instance must BE the recorded one",
	);
	assert.match(
		discoverySource,
		/process\.kill\(pid, 0\)/,
		"pid liveness is checked before any probe, so a dead daemon is never dialled",
	);
});

/*
 * Q-2: a backend child that EXITS is restored by the watchdog.
 *
 * `checkUnhealthyBackend()` used to return early once `this.process` was null,
 * and the `exit` handler nulls it - so a SIGKILLed backend was terminal: the
 * renderer's Retry could re-arm the stream and could never succeed. The
 * watchdog is the only thing in the app that owns the process lifecycle, so the
 * recovery belongs there; this drives the REAL manager through an exit and one
 * unhealthy sample, and asserts a replacement was spawned.
 */
test("a backend child that exited is restored by the watchdog (Q-2)", async () => {
	const manager = new BackendServiceManager();
	try {
		state.healthy = false;
		assert.equal(await manager.start(), true);
		const firstSpawn = state.spawns.at(-1);
		assert.ok(manager.process, "the managed start leaves a live process");

		// The child dies on its own: no kill() call, just the exit event a SIGKILL
		// reports. This is what `kill -9` looked like while the operator's app sat
		// on the failure and the Retry could not succeed.
		state.healthy = false;
		firstSpawn.child.exitNow(null);
		assert.equal(
			manager.process,
			null,
			"the exit handler nulls this.process - the state that used to be terminal",
		);

		const spawnsBefore = state.spawns.length;
		// The detach threshold, then the recovery it authorises: three failed
		// probes, not one.
		for (let i = 0; i < DEGRADED_AFTER_FAILURES; i++) {
			await manager.checkBackendHealth();
		}

		assert.equal(
			state.spawns.length,
			spawnsBefore + 1,
			"an exited backend must be replaced, or every window onto it is permanently dead",
		);
		assert.ok(
			manager.process,
			"the manager holds the replacement, so a stream re-armed by the Retry can now succeed",
		);
		assert.notEqual(
			state.spawns.at(-1)?.token,
			firstSpawn.token,
			"the replacement mints its own token, which is why the relay is keyed on it",
		);
	} finally {
		state.healthy = true;
		await manager.stop(true);
	}
});

/*
 * D1, pinned to the relay's OWN detail.
 *
 * The round-1 frame showed "The event stream ended." because the browser dev
 * proxy emits no status code, while the shipping Electron relay emits
 * "The event stream was refused (401)." for the same failure - so the reviewed
 * sentence and the shipped sentence were two different sentences, and the
 * shipped one was a bare HTTP status. These two cases take the detail the REAL
 * relay emits over a REAL socket and assert the sentence the reader gets, which
 * is the only form of that claim that is not an assertion about copy.
 */
test("the relay's own refusal detail is the shared vocabulary and maps to the shipped sentence (D1)", async () => {
	const relay = new DesktopStreamRelay(url, "d".repeat(64));
	try {
		const frames = subscribeOnce(relay);
		await waitFor(() => frames.length > 0, "the refusal frame");
		assert.equal(frames[0].kind, "error");
		assert.equal(
			frames[0].detail,
			DESKTOP_STREAM_DETAIL.refused(401),
			"the relay emits the module's constant, so a test can pin the copy to it instead of restating it",
		);
		const notice = streamFailureNotice(frames[0].detail);
		assert.equal(
			notice.statement,
			streamFailureNotice(DESKTOP_STREAM_DETAIL.ended).statement,
			"the packaged 401 and the browser proxy's ended must reach the reader as the same sentence",
		);
		assert.doesNotMatch(notice.statement, /401|refused|event stream/i);
	} finally {
		relay.dispose();
	}
});

test("an explicit remote target stays remote and never spawns a local fallback", async () => {
	const previousUrl = globalThis.__backendTestUrl;
	globalThis.__backendTestUrl = "https://127.0.0.2:9";
	const manager = new BackendServiceManager();
	try {
		const before = state.spawns.length;
		assert.equal(manager.backendUrl, "https://127.0.0.2:9");
		assert.equal(await manager.start({ quiet: true }), false);
		await manager.recoverFromDetachment();
		assert.equal(state.spawns.length, before);
		assert.equal(manager.getStatusSnapshot().state, "detached");
	} finally {
		await manager.stop(false);
		globalThis.__backendTestUrl = previousUrl;
	}
});

test("a missing external daemon never becomes a managed replacement", async () => {
	const manager = new BackendServiceManager();
	manager.isExternalBackend = true;
	manager.discoverAndAttach = async () => false;
	const before = state.spawns.length;
	await manager.recoverFromDetachment();
	assert.equal(state.spawns.length, before);
});

test("an announced build change leaves the daemon attached and its relay unchanged", async () => {
	const manager = new BackendServiceManager();
	const candidate = {
		address: url,
		file: "/synthetic/serve/record.json",
		source: "record",
		record: { pid: process.pid, retiring_from: "1.0.0", retiring_to: "1.0.1" },
		identity: {
			instanceId: "announcing",
			pid: process.pid,
			version: "1.0.0",
			prefix: "/synthetic",
			installKind: "uv-tool",
		},
	};
	await manager.attachTo(candidate);
	const relay = manager.getStreamRelay();
	assert.equal(manager.getStatusSnapshot().state, "attached");
	assert.equal(manager.getStreamRelay(), relay);
	await manager.stop(false);
});

test("a stream against a backend that is not listening reports the server, not the stream (Q-2)", async () => {
	// A port with nothing behind it: bound to learn the number, then released.
	const probe = createServer(() => {});
	await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
	const deadPort = probe.address().port;
	await new Promise((resolve) => probe.close(resolve));

	const relay = new DesktopStreamRelay(
		`http://127.0.0.1:${deadPort}`,
		"e".repeat(64),
	);
	try {
		const frames = subscribeOnce(relay);
		await waitFor(() => frames.length > 0, "the failure frame");
		assert.equal(
			frames[0].detail,
			DESKTOP_STREAM_DETAIL.serverDown,
			"nothing answering on the origin is the server being gone, which is what the reader is told (Q-2)",
		);
		assert.match(
			streamFailureNotice(frames[0].detail).statement,
			/server is not running/i,
		);
	} finally {
		relay.dispose();
	}
});
