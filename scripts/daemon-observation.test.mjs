/**
 * An app that ADOPTS a daemon at startup must keep watching it.
 *
 * WHY this file exists beside the two daemon suites that were already green.
 * `daemon-health-state.test.mjs` drives the state machine's own rules and
 * `daemon-discovery.test.mjs` drives discovery's; neither owns the ARRANGEMENT
 * between them - who arms the probe loop, and what a recovery probe's verdict
 * does to the machine - and that arrangement was wrong in two directions at
 * once (QA round 3 Q-1/Q-2, review round 3 R3-1):
 *
 *   - the loop was armed only from `startOwned()`, while `src/main/index.ts`
 *     calls `checkExistingBackend()` at startup and calls `start()` only when
 *     discovery found NOTHING - so an app that adopted the operator's daemon
 *     never probed at all. Measured: a daemon killed after startup left the app
 *     reporting `attached`, naming the dead pid, for 150 s with zero push
 *     events; nothing re-discovered a daemon started later without an app
 *     restart, and the connectivity banner (whose only entry is an unreachable
 *     state) could not appear, so the Retry that would have recovered it was
 *     unreachable.
 *   - `recoverFromDetachment()` folded its probe into the state machine only on
 *     the `identified` branch, so the one recovery verb the renderer owns -
 *     `reconnectNow()`, the banner's Retry - returned the stale `attached` it
 *     was asked to refresh, while an action against the same daemon answered
 *     503.
 *
 * The subject is the REAL `BackendServiceManager` against real loopback HTTP and
 * real record files, in a config root of its own per case. Two substitutions,
 * each of which keeps this machine safe rather than making the test easier:
 *
 *   - `./config` is replaced, because the real module parses the repository's
 *     `.env` and would point the manager at the operator's own backend;
 *   - `./logger` is replaced, because the real one appends to the operator's
 *     application-support log.
 *
 * The probe loop is RECORDED rather than scheduled (`withRecordedProbeLoop`):
 * the manager arms it with the global `setInterval`, so the recorded callback is
 * exactly the function a real 10 s tick runs, and calling it here is the tick
 * the app would have run - ten seconds early and deterministically. Nothing is
 * ever scheduled, which is also what keeps a case that fails mid-way from
 * leaving a live timer behind to hold the runner open. The real-timer
 * measurement of the same path (kill the daemon, wait out the interval, watch
 * the push) lives in `scripts/daemon-discovery-evidence.mjs`, which drives it
 * against a real `lop serve` daemon.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * The regex literals this module uses, hoisted to the top level: the
 * `useTopLevelRegex` rule charges a literal constructed inside a function,
 * and `scripts/` is outside `pnpm lint`'s path list, so this tree's own gate
 * is the only thing that would have said so.
 *
 * The `Reflect.deleteProperty` calls below are the `delete` operator spelled
 * the way the lint rule allows. It is not a style choice: assigning
 * `undefined` to a `process.env` key sets the STRING "undefined" instead of
 * unsetting it, which hands a child a different environment than the test
 * means to give it (measured: three cases in this tree failed exactly so).
 */
const RE_ANSWERED_A_REQUEST = /answered a request/;
const RE_ANSWERED_WITHOUT_PROVING_I =
	/answered without proving it is a Local Operator daemon/;
const RE_CONFIG = /^\.\/config$/;
const RE_CONNECTED_TO_THE_DAEMON = /Connected to the daemon/;
const RE_ELECTRON = /^electron$/;
const RE_ELECTRON_LOGGER_FIXTURE_CO =
	/^(electron|logger-fixture|config-fixture)$/;
const RE_IT_KEEPS_PROBING_FOR_A_SER =
	/It keeps probing for a server it can open/;
const RE_LOGGER = /^\.\/logger$/;
const RE_PROCESS_IS_GONE = /process is gone/;
const RE_REFUSES_THIS_APP = /refused this app's credential/;
const RE_503 = /503/;
const RE_THIS_APP_WAS_NOT_GIVEN_THE =
	/This app was not given the key to that server, so it did not start a second one/;
const RE_VITE_DISABLE_BACKEND_MANAG = /VITE_DISABLE_BACKEND_MANAGER/;

/*
 * A pairing token in the operator's environment would let the adoption path
 * reach a daemon no record describes. Every case here goes through the record's
 * own claim key, so the ambient pairing credentials go first.
 */
Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_DESKTOP_TOKEN");
Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_DESKTOP_ORIGINS");

const CLAIM_KEY = "c".repeat(64);
const HOME = mkdtempSync(join(tmpdir(), "daemon-observation-"));
/** Every manager this file builds, so teardown can dispose of one whose test
 * failed before its own stop. */
const managers = new Set();

const bundle = await build({
	stdin: {
		contents:
			'export { BackendServiceManager } from "./src/main/backend/backend-service.ts"; export { PROBE_INTERVAL_MS, DEGRADED_AFTER_FAILURES } from "./src/main/backend/daemon-status.ts";',
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
				builder.onResolve({ filter: RE_ELECTRON }, () => ({
					path: "electron",
					namespace: "fixture",
				}));
				// Resolved by IMPORTER as well as specifier: `./config` and
				// `./logger` exist in other directories, and substituting the wrong
				// one would leave the real logger writing to the operator's log.
				for (const [filter, name] of [
					[RE_LOGGER, "logger-fixture"],
					[RE_CONFIG, "config-fixture"],
				]) {
					builder.onResolve({ filter }, (args) =>
						args.importer.endsWith("main/backend/backend-service.ts")
							? { path: name, namespace: "fixture" }
							: undefined,
					);
				}
				builder.onLoad(
					{
						filter: RE_ELECTRON_LOGGER_FIXTURE_CO,
						namespace: "fixture",
					},
					(args) => {
						const sources = {
							electron: `
								export const app = {
									getPath: (name) => name === "home" ? ${JSON.stringify(HOME)} : ${JSON.stringify(join(HOME, "userData"))},
									whenReady: async () => {},
									on: () => {},
									quit: () => {},
								};
								export const dialog = { showErrorBox: () => {}, showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
								export default { app, dialog };
							`,
							"logger-fixture": `
								export const LogFileType = { INSTALLER: "installer", BACKEND: "backend", UPDATE_SERVICE: "update", OAUTH: "oauth" };
								const emit = () => () => {};
								export const logger = { info: emit(), warn: emit(), error: emit(), debug: emit(), verbose: emit() };
							`,
							/*
							 * The URL is a GETTER: every case points a fresh manager at the
							 * daemon it started, and `backendUrl` is derived from this value
							 * in the constructor. A frozen property would silently reuse
							 * the previous case's daemon.
							 */
							"config-fixture": `
								export const backendConfig = {
									get VITE_LOCAL_OPERATOR_API_URL() { return globalThis.__testConfiguredUrl; },
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

const { BackendServiceManager, PROBE_INTERVAL_MS, DEGRADED_AFTER_FAILURES } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

after(async () => {
	/*
	 * A TERMINAL stop (not `stop(true)`, the restart), and then once more after a
	 * settle.
	 *
	 * A restart deliberately keeps observing, so a tick whose recovery was still
	 * in flight can arm the loop again after the stop - correct in the app, where
	 * the manager is going to keep running, and fatal to a test process, whose
	 * only other handle is the runner. `stop(false)` sets the shutting-down flag
	 * that a later `discoverAndAttach()` bails on, which is what closes that
	 * window; the settle and the second stop are the net under a test that failed
	 * before reaching its own stop at all.
	 */
	for (const manager of managers) await manager.stop(false).catch(() => {});
	await new Promise((resolve) => setTimeout(resolve, 2_500));
	for (const manager of managers) await manager.stop(false).catch(() => {});
	rmSync(HOME, { recursive: true, force: true });
});

/** Wait for `check`, or fail with what was seen rather than hang the run. */
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
 * One case's world: its own config root (so no other case's record is a
 * candidate), a real loopback daemon answering like one, and the live process
 * its record names - so `pidLiveness` has a real process to lose.
 */
async function daemonScene({
	instanceId,
	version = "0.55.2",
	publishRecord = true,
	/** The bearer this daemon accepts; `claimKey: ""` is an env-governed one. */
	acceptedBearer = CLAIM_KEY,
	claimKey = CLAIM_KEY,
	/**
	 * The status `/health` answers. Not 200 models a daemon that is starting up,
	 * unhealthy or shutting down - and, from the spawn gate's side, ANY listener
	 * holding the socket, because a status is not an identity but it is an
	 * occupant (review round 1, F-2).
	 */
	healthStatus = 200,
	/**
	 * The status `/v1/desktop/sessions` answers for a bearer it DOES accept.
	 * Not 200 models the daemon #1170 makes possible: alive, serving, and unable
	 * to read its session store, which it reports as a 503 rather than as an empty
	 * listing the client cannot tell from a genuinely empty store.
	 */
	sessionsStatus = 200,
}) {
	const root = mkdtempSync(join(tmpdir(), `daemon-observation-${instanceId}-`));
	const runDir = join(root, "run", "serve");
	mkdirSync(runDir, { recursive: true });
	process.env.LOCAL_OPERATOR_CONFIG_DIR = root;

	const child = spawn(
		process.execPath,
		["-e", "setInterval(() => {}, 1000);"],
		{
			stdio: "ignore",
		},
	);
	const seen = [];
	const server = createServer((req, res) => {
		const path = (req.url ?? "").split("?")[0];
		seen.push({ path, method: req.method });
		const json = (status, body) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (path === "/health") {
			if (healthStatus !== 200) {
				// No identity: the real daemon answers a status without one while it is
				// not ready, which is exactly what makes this case invisible to an
				// identity check.
				json(healthStatus, { detail: "not ready" });
				return;
			}
			json(200, {
				status: 200,
				message: "ok",
				result: {
					version,
					instance_id: instanceId,
					pid: child.pid,
					prefix: "/tmp/observation-prefix",
					install_kind: "uv-tool",
				},
			});
			return;
		}
		if (path === "/v1/capabilities") {
			json(200, { status: 200, result: { desktop_available: true } });
			return;
		}
		if (path === "/v1/desktop/claim") {
			json(200, { status: 200 });
			return;
		}
		if (path === "/v1/desktop/sessions") {
			const presented = (req.headers.authorization ?? "").replace(
				"Bearer ",
				"",
			);
			// The bearer this daemon accepts: the record's own claim key for a
			// key-governed daemon, and the token its spawner passed in the environment
			// for one governed that way (`claim_key: ""`). A 200 here is what makes
			// this daemon adoptable at all (an unauthenticated 200 is not).
			if (presented !== acceptedBearer) {
				json(401, { detail: "Unauthorized" });
				return;
			}
			if (sessionsStatus !== 200) {
				json(sessionsStatus, { detail: "session store unreadable" });
				return;
			}
			json(200, { result: { sessions: [], truncated: false, limit: 1 } });
			return;
		}
		if (path.endsWith("/events")) {
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.end();
			return;
		}
		res.writeHead(404, { "Content-Type": "application/json" });
		res.end("{}");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;

	const now = Date.now() / 1000;
	/*
	 * `publishRecord: false` is the operator's own 09:17 shape: a daemon is
	 * serving the configured address, and the record directory holds nothing
	 * describing it (`[discovery] no valid daemon among 0 record(s)`). Discovery
	 * therefore reports "nothing to attach to", which is exactly the answer that
	 * used to be read as "the port is free".
	 */
	if (publishRecord)
		writeFileSync(
			join(runDir, `${child.pid}.json`),
			JSON.stringify({
				pid: child.pid,
				host: "127.0.0.1",
				port,
				instance_id: instanceId,
				version,
				source_ref: "",
				prefix: "/tmp/observation-prefix",
				install_kind: "uv-tool",
				desktop: false,
				claim_key: claimKey,
				started_at: now - 10,
				heartbeat_at: now - 1,
			}),
			{ mode: 0o600 },
		);

	const stopChild = async () => {
		if (child.exitCode !== null || child.signalCode !== null) return;
		const exited = new Promise((resolve) => child.on("exit", resolve));
		child.kill("SIGKILL");
		await exited;
	};
	const closeServer = async () => {
		if (!server.listening) return;
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(resolve));
	};

	return {
		root,
		port,
		address: `http://127.0.0.1:${port}`,
		pid: child.pid,
		seen,
		/**
		 * The daemon stops accepting connections while its PROCESS stays alive.
		 *
		 * This is the shape the transport-evidence rule exists for, and the only one
		 * that isolates it: a refused socket on a live pid is the ordinary evidence of
		 * absence, so the state machine is allowed to act on three of them - unless
		 * this app's own request was answered recently. `die()` cannot test that,
		 * because it kills the pid too and a gone pid bypasses the gate deliberately.
		 */
		async fallSilent() {
			await closeServer();
		},
		/**
		 * The daemon dies the way it died in the report: its process is gone and
		 * nothing answers on its port any more. Both halves matter - the pid is
		 * the evidence the state machine acts on, and the closed port is what any
		 * later probe (and the pre-record fallback) must fail against.
		 */
		async die() {
			await closeServer();
			await stopChild();
		},
		async dispose() {
			await closeServer();
			await stopChild();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

/**
 * Drive `body` with the loop's timer RECORDED instead of scheduled.
 *
 * `startHealthCheck()` arms the loop with the global `setInterval`, so the
 * recorded callback is the function a real tick runs.
 */
async function withRecordedProbeLoop(body) {
	const realSetInterval = globalThis.setInterval;
	const realClearInterval = globalThis.clearInterval;
	const intervals = [];
	globalThis.setInterval = (fn, ms) => {
		const token = { recorded: true };
		intervals.push({ fn, ms, token });
		return token;
	};
	globalThis.clearInterval = () => {};
	try {
		return { intervals, value: await body() };
	} finally {
		globalThis.setInterval = realSetInterval;
		globalThis.clearInterval = realClearInterval;
	}
}

/** Adopt the running daemon exactly as `src/main/index.ts` does at startup. */
async function adoptAtStartup(scene) {
	globalThis.__testConfiguredUrl = scene.address;
	const { intervals, value } = await withRecordedProbeLoop(async () => {
		const manager = new BackendServiceManager();
		managers.add(manager);
		const adopted = await manager.checkExistingBackend();
		return { manager, adopted };
	});
	return { ...value, intervals };
}

test("an adopted daemon arms the probe loop (Q-1)", async () => {
	const scene = await daemonScene({ instanceId: "instance-adopted-loop" });
	try {
		const { manager, adopted, intervals } = await adoptAtStartup(scene);
		assert.equal(adopted, true, "the running daemon must be adopted");
		assert.equal(manager.getStatusSnapshot().state, "attached");
		assert.equal(
			intervals.length,
			1,
			"the startup adoption path must arm the loop exactly once: `index.ts` calls `checkExistingBackend()` and never `start()` when a daemon was found, so an unarmed loop left the app on `attached` for a daemon that had been dead for minutes",
		);
		assert.equal(
			intervals[0].ms,
			PROBE_INTERVAL_MS,
			"and at the probe cadence the owned path uses",
		);
		await manager.stop(false);
	} finally {
		await scene.dispose();
	}
});

test("a daemon killed after startup is noticed by the tick adoption armed (Q-1)", async () => {
	const scene = await daemonScene({ instanceId: "instance-killed-after" });
	try {
		const { manager, intervals } = await adoptAtStartup(scene);
		const pushes = [];
		manager.onStatusChange((snapshot) => pushes.push(snapshot));

		await scene.die();
		assert.equal(
			pushes.length,
			0,
			"nothing has ticked yet: the snapshot is still what adoption published",
		);

		// The armed loop's own callback - the same function a real 10 s tick runs,
		// not a probe this test makes by hand. It is fire-and-forget by design,
		// so the correction is awaited rather than read off the callback.
		intervals[0].fn();
		const snapshot = await waitFor(
			() =>
				manager.getStatusSnapshot().state === "attached"
					? null
					: manager.getStatusSnapshot(),
			"the armed tick to record the daemon's death",
		);

		assert.equal(
			snapshot.state,
			"detached",
			"the dead daemon must not stay `attached`",
		);
		assert.doesNotMatch(
			snapshot.detail,
			RE_CONNECTED_TO_THE_DAEMON,
			"and the row must stop describing a dead process as the daemon it is connected to",
		);
		assert.equal(snapshot.failures, DEGRADED_AFTER_FAILURES);
		assert.match(snapshot.detail, RE_PROCESS_IS_GONE);
		assert.ok(
			pushes.some((pushed) => pushed.state === "detached"),
			"the renderer has to be PUSHED the correction: a state that only moves in main is still a stale row",
		);
		assert.equal(
			manager.getOwnedPid(),
			null,
			"a daemon this app did not start is never replaced by one it starts",
		);
		await manager.stop(false);
	} finally {
		await scene.dispose();
	}
});

test("the banner's Retry corrects a stale attachment instead of returning it (Q-2)", async () => {
	const scene = await daemonScene({ instanceId: "instance-stale-retry" });
	try {
		const { manager } = await adoptAtStartup(scene);
		assert.equal(manager.getStatusSnapshot().state, "attached");
		await scene.die();

		const pushes = [];
		manager.onStatusChange((snapshot) => pushes.push(snapshot));
		// Exactly what `src/main/index.ts`'s BACKEND_RECONNECT_CHANNEL runs for the
		// banner's Retry, with no tick in between - the state QA drove a real
		// renderer action against, where the verb answered `attached` while
		// `sessions.list` answered 503.
		const snapshot = await manager.reconnectNow();

		assert.notEqual(
			snapshot.state,
			"attached",
			"a Retry that answers `attached` for a daemon whose process is gone is the row claiming online while every action fails",
		);
		assert.equal(snapshot.state, "detached");
		assert.match(snapshot.detail, RE_PROCESS_IS_GONE);
		assert.equal(
			snapshot.failures,
			DEGRADED_AFTER_FAILURES,
			"the probe's verdict is recorded with the weight the tick gives it, not as a single degraded sample",
		);
		assert.ok(
			pushes.some((pushed) => pushed.state === "detached"),
			"and the corrected state is pushed, so a renderer that called the verb renders what main observed",
		);
		await manager.stop(false);
	} finally {
		await scene.dispose();
	}
});

/*
 * The operator's 09:17 sequence: a daemon serving the configured address, no
 * record describing it, and an app that answered by starting another one.
 *
 *   [discovery] rejected http://127.0.0.1:1111: identity-mismatch (...)
 *   [discovery] no valid daemon among 0 record(s)
 *   Backend stderr: Error: cannot bind http://127.0.0.1:1111: [Errno 48] Address already in use
 *
 * Every child of that storm died with EADDRINUSE and was left an orphan, and
 * the pair repeated every ~10 s while the daemon on that port answered the
 * app's own reads. Discovery's answer ("nothing I may attach to") was being
 * read as the spawner's question ("this port is free"), and they are not the
 * same question.
 */

test("a daemon answering 503 is not a credential refusal, and is not spawned over", async () => {
	const scene = await daemonScene({
		instanceId: "instance-unreadable-store",
		sessionsStatus: 503,
	});
	const manager = new BackendServiceManager();
	managers.add(manager);
	try {
		const started = await manager.start({ quiet: true });
		assert.equal(
			started,
			false,
			"nothing was adopted, so nothing may be reported as serving this app",
		);
		assert.equal(
			manager.getOwnedPid(),
			null,
			"a daemon is answering on that port: spawning a replacement could only die with EADDRINUSE, and it lands on a daemon that is alive",
		);
		const snapshot = manager.getStatusSnapshot();
		assert.equal(
			snapshot.capabilityStatus,
			null,
			"a 503 is not a credential refusal: recording one is the false verdict that declined the candidate and reached the spawn path",
		);
		assert.doesNotMatch(
			snapshot.detail,
			RE_REFUSES_THIS_APP,
			"the sentence may not tell the operator their credential was refused when the daemon simply could not read its store",
		);
		assert.equal(
			snapshot.state,
			"wedged",
			"a daemon IS running and this app is not attached to it, which is not `detached` (the banner renders that as offline)",
		);
		assert.match(
			snapshot.detail,
			RE_503,
			"the copy names the evidence the state came from",
		);
	} finally {
		await manager.stop(false);
		await scene.dispose();
	}
});

test("a daemon answering the configured origin is never spawned over (EADDRINUSE storm)", async () => {
	const scene = await daemonScene({
		instanceId: "instance-occupied-port",
		publishRecord: false,
	});
	globalThis.__testConfiguredUrl = scene.address;
	const manager = new BackendServiceManager();
	managers.add(manager);
	try {
		const started = await manager.start({ quiet: true });
		assert.equal(
			started,
			false,
			"this app may not claim a daemon it holds no credential for, and it may not start a second one on that port",
		);
		assert.equal(
			manager.getOwnedPid(),
			null,
			"no child was spawned: the port answers, so a spawn could only die with EADDRINUSE",
		);
		const snapshot = manager.getStatusSnapshot();
		assert.equal(
			snapshot.state,
			"wedged",
			"a daemon IS running: this is not `detached`, which is what the banner renders as offline",
		);
		assert.match(
			snapshot.detail,
			RE_THIS_APP_WAS_NOT_GIVEN_THE,
			"the copy names the path into the state, not a generic failure",
		);
		assert.match(
			snapshot.detail,
			RE_IT_KEEPS_PROBING_FOR_A_SER,
			"and the one future this app can actually reach",
		);
		/*
		 * Design round 1, D7 asked for these three to be set in machine voice
		 * instead of prose. Whether the snapshot exposes them AT ALL for this state
		 * is the question that half hangs on - `url`/`pid`/`version` come from
		 * `identity`, which the unattachable path does not set - so it is measured
		 * here rather than assumed. Printed on a verification run; the assertion
		 * below is what the measurement produced.
		 */
		console.log(
			"IDENTITY",
			JSON.stringify({
				url: snapshot.url,
				pid: snapshot.pid,
				version: snapshot.version,
			}),
		);
		assert.doesNotMatch(snapshot.detail, RE_VITE_DISABLE_BACKEND_MANAG);
		assert.equal(
			manager.isUsingExternalBackend(),
			false,
			"nothing was adopted, so nothing is pretending to be the backend",
		);
	} finally {
		await manager.stop(false);
		await scene.dispose();
	}
});

test("an address that answers a status other than 200 is OCCUPIED, not free (F-2)", async () => {
	const scene = await daemonScene({
		instanceId: "instance-unready-port",
		publishRecord: false,
		healthStatus: 503,
	});
	globalThis.__testConfiguredUrl = scene.address;
	const manager = new BackendServiceManager();
	managers.add(manager);
	try {
		const started = await manager.start({ quiet: true });
		assert.equal(
			started,
			false,
			"a listener that answers 503 holds the socket, so a child started there could only die with EADDRINUSE - and the token minted before the spawn would already have overwritten the credential for whatever is serving",
		);
		assert.equal(
			manager.getOwnedPid(),
			null,
			"nothing was started over that answer",
		);
		const snapshot = manager.getStatusSnapshot();
		assert.match(
			snapshot.detail,
			RE_ANSWERED_WITHOUT_PROVING_I,
			"the copy states the fact it observed rather than naming a daemon it could not identify",
		);
		assert.match(
			snapshot.detail,
			RE_IT_KEEPS_PROBING_FOR_A_SER,
			"and the one step this app actually takes about it (design round 1, D7)",
		);
		assert.match(snapshot.detail, new RegExp(scene.address));
		/*
		 * `degraded`, not `detached`: an address that answered is not evidence of
		 * absence either, so this is the usable state and never the banner.
		 */
		assert.equal(snapshot.state, "degraded");
	} finally {
		await manager.stop(false);
		await scene.dispose();
	}
});

test("an unanswered desktop call is not evidence the daemon answered (F-1)", async () => {
	/*
	 * The pair, measured at the CALL SITE rather than at the state machine: three
	 * refused probes against a live pid are the ordinary evidence of absence, and
	 * whether the app may act on them is decided by whether one of its own
	 * requests was answered recently.
	 *
	 * The failing arm uses a call the transport refuses BEFORE it opens a socket
	 * (an unknown op fails the schema), which is the shape the review reproduced:
	 * `requestDesktop` RESOLVES for that, so a `.then()` alone - the old call site -
	 * counted a request the daemon never saw as "the daemon answered a request 0s
	 * ago", which held the state at `degraded`. `checkBackendHealth` only recovers
	 * from `detached`/`wedged`, so that was also the state nothing recovers from.
	 */
	const failing = await daemonScene({ instanceId: "instance-unanswered-call" });
	globalThis.__testConfiguredUrl = failing.address;
	const first = await adoptAtStartup(failing);
	try {
		assert.equal(first.manager.getStatusSnapshot().state, "attached");
		const refused = await first.manager.requestDesktop({});
		assert.equal(
			refused.status,
			422,
			"the fixture for this arm is a call the transport refuses locally",
		);
		await failing.fallSilent();
		for (let i = 0; i < DEGRADED_AFTER_FAILURES; i++) {
			await first.manager.checkBackendHealth();
		}
		const detached = first.manager.getStatusSnapshot();
		assert.equal(
			detached.state,
			"detached",
			"a request that was never sent may not hold the connection open against three refused probes",
		);
		assert.doesNotMatch(
			detached.detail,
			RE_ANSWERED_A_REQUEST,
			"and the sentence must not claim a daemon answered a request it never saw",
		);
	} finally {
		await first.manager.stop(false);
		await failing.dispose();
	}

	/* The control: the same three probes, with one ANSWERED call before them. */
	const answering = await daemonScene({ instanceId: "instance-answered-call" });
	globalThis.__testConfiguredUrl = answering.address;
	const second = await adoptAtStartup(answering);
	try {
		const answered = await second.manager.requestDesktop({
			op: "capabilities",
		});
		assert.equal(answered.status, 200, "the fixture answers this one");
		await answering.fallSilent();
		for (let i = 0; i < DEGRADED_AFTER_FAILURES; i++) {
			await second.manager.checkBackendHealth();
		}
		const held = second.manager.getStatusSnapshot();
		assert.equal(
			held.state,
			"degraded",
			"a daemon that answered a request seconds ago is serving, whatever the probes could not read",
		);
		assert.match(held.detail, RE_ANSWERED_A_REQUEST);
	} finally {
		await second.manager.stop(false);
		await answering.dispose();
	}
});

test("a launch re-attaches to the daemon the previous run left running, via the persisted credential", async () => {
	const token = "a".repeat(64);
	const tokenFile = join(HOME, "userData", "desktop-token");
	// The daemon the previous run spawned: env-governed from birth, so its record
	// publishes NO claim key and the spawner's token is the only credential that
	// can ever open it.
	const scene = await daemonScene({
		instanceId: "instance-reattach",
		claimKey: "",
		acceptedBearer: token,
	});
	globalThis.__testConfiguredUrl = scene.address;
	rmSync(tokenFile, { force: true });
	const withoutToken = new BackendServiceManager();
	managers.add(withoutToken);
	let reattaching;
	try {
		/*
		 * The BEFORE half: no persisted credential, which is what every launch had
		 * before this change. The daemon answers, the record names it, and the app
		 * still declines it - so `src/main/index.ts` starts a second one.
		 */
		assert.equal(
			await withoutToken.checkExistingBackend(),
			false,
			"with no token there is nothing this app can open an env-governed daemon with",
		);
		assert.equal(
			withoutToken.getStatusSnapshot().state,
			"connecting",
			"and a capability refusal moves no state: the daemon is running",
		);

		// The AFTER half: the credential the previous run persisted. The token is read
		// at CONSTRUCTION, which is the whole point - `src/main/index.ts` asks whether
		// there is a daemon to adopt before it ever considers starting one.
		mkdirSync(join(HOME, "userData"), { recursive: true });
		writeFileSync(tokenFile, token, { mode: 0o600 });
		reattaching = new BackendServiceManager();
		managers.add(reattaching);
		assert.equal(
			await reattaching.checkExistingBackend(),
			true,
			"the daemon this app spawned and left running must be adopted on the next launch",
		);
		assert.equal(reattaching.getStatusSnapshot().state, "attached");
		assert.equal(
			reattaching.getStatusSnapshot().owned,
			false,
			"a re-attached daemon is discovered, not a child of this process",
		);
		assert.equal(
			reattaching.getOwnedPid(),
			null,
			"and nothing was spawned onto its port",
		);
		assert.ok(
			scene.seen.filter((entry) => entry.path === "/v1/desktop/sessions")
				.length > 0,
			"the daemon was read through, not merely probed",
		);
	} finally {
		rmSync(tokenFile, { force: true });
		await withoutToken.stop(false);
		await reattaching?.stop(false).catch(() => {});
		await scene.dispose();
	}
});
