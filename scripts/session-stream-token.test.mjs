import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
};

/** The bundled module's view of that state. */
globalThis.__backendTestState = state;

const bundle = await build({
	stdin: {
		contents:
			'export { BackendServiceManager } from "./src/main/backend/backend-service.ts"; export { DesktopStreamRelay } from "./src/main/desktop-stream.ts";',
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
									const persistent = new Map();
									const onceOnly = new Map();
									function makeChild(env) {
										const listeners = new Map([["persistent", persistent], ["once", onceOnly]]);
										return {
											pid: 4242,
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
									export function exec(command, options, callback) {
										const done = typeof options === "function" ? options : callback;
										globalThis.__backendTestState.execs.push(command);
										// Empty stdout: "local-operator is not installed globally", so
										// the venv branch is taken and the spawn above is the one
										// recorded. No command is ever really run.
										if (done) done(null, { stdout: "", stderr: "" });
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
									export const backendConfig = {
										VITE_LOCAL_OPERATOR_API_URL: globalThis.__backendTestUrl,
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
const { BackendServiceManager } = await import(
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

test("a watchdog restart carries the restart intent and never takes the final-shutdown path", async () => {
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
		// One unhealthy sample, the condition the watchdog acts on, without
		// waiting out the 30s interval that samples it.
		manager.checkHealth = async () => false;

		const execsBefore = state.execs.length;
		await manager.checkUnhealthyBackend();

		assert.deepEqual(
			stopIntents,
			[true],
			"the watchdog must ask stop() for a RESTART; the no-argument form is the final-shutdown path",
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
