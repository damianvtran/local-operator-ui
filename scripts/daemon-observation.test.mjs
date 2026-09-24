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
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
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
const RE_PROBE_EVIDENCE = /(no answer to probe|probe \d+ of \d+)/;
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
	/**
	 * The status `/v1/desktop/claim` answers. `404` models an install that predates
	 * the handshake, whose claim ROUTE does not exist - the one refusal a status
	 * names unambiguously, because the daemon's own contract for this route never
	 * answers 404 (design § 1.6, § 2 S3).
	 */
	claimStatus = 200,
	/**
	 * Whether the record publishes a GOVERNED plane: `desktop: true` with
	 * `claim_key: ""`, which is what the daemon writes when SOMEBODY ELSE claimed the
	 * plane or its spawner governed it through the environment (`registry.py`). It is
	 * the discriminator between "another program has this" and "the plane is simply
	 * unclaimed", and nothing read it before this change (design § 1.5).
	 */
	recordGoverned = false,
}) {
	const root = mkdtempSync(join(tmpdir(), `daemon-observation-${instanceId}-`));
	const runDir = join(root, "run", "serve");
	mkdirSync(runDir, { recursive: true });
	process.env.LOCAL_OPERATOR_CONFIG_DIR = root;

	/*
	 * What the daemon at this port answers RIGHT NOW, as a value a case can change.
	 *
	 * The parameters above are the daemon this app adopts; `replaceUnderApp` below
	 * is the same address after a `lop` build swap, which is the shape the
	 * 2026-09-18 report had. Mutable state rather than a second scene because the
	 * ADDRESS and the process answering it are the same throughout - only the
	 * identity, the plane and the credential change, and those are exactly what a
	 * successor swaps.
	 */
	const live = {
		instanceId,
		acceptedBearer,
		healthStatus,
		sessionsStatus,
		claimStatus,
	};

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
			if (live.healthStatus !== 200) {
				// No identity: the real daemon answers a status without one while it is
				// not ready, which is exactly what makes this case invisible to an
				// identity check.
				json(live.healthStatus, { detail: "not ready" });
				return;
			}
			json(200, {
				status: 200,
				message: "ok",
				result: {
					version,
					instance_id: live.instanceId,
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
			if (live.claimStatus === 404) {
				json(404, { detail: "Not Found" });
				return;
			}
			json(200, { status: 200 });
			return;
		}
		if (path === "/v1/desktop/sessions") {
			const presented = (req.headers.authorization ?? "").replace(
				"Bearer ",
				"",
			);
			/*
			 * The PLANE first, the credential second - the order the daemon's own
			 * `require_desktop` decides them in, and the order that separates the two
			 * refusals a case here has to tell apart: a `503` says the plane is shut
			 * (nothing is admitted, whatever is presented), while a `401` says the plane
			 * is open and this credential is not the one it accepts.
			 */
			if (live.sessionsStatus !== 200) {
				json(live.sessionsStatus, {
					detail:
						"Desktop controls require a backend started by the desktop app.",
				});
				return;
			}
			// The bearer this daemon accepts: the record's own claim key for a
			// key-governed daemon, and the token its spawner passed in the environment
			// for one governed that way (`claim_key: ""`). A 200 here is what makes
			// this daemon adoptable at all (an unauthenticated 200 is not).
			if (presented !== live.acceptedBearer) {
				json(401, { detail: "Unauthorized" });
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

	/*
	 * `publishRecord: false` is the operator's own 09:17 shape: a daemon is
	 * serving the configured address, and the record directory holds nothing
	 * describing it (`[discovery] no valid daemon among 0 record(s)`). Discovery
	 * therefore reports "nothing to attach to", which is exactly the answer that
	 * used to be read as "the port is free".
	 */
	const publishRecordFile = (
		recordInstanceId,
		recordClaimKey,
		desktop = recordGoverned,
	) => {
		// The record the daemon itself publishes: staged-once, 0600, keyed by pid, with
		// the heartbeat the reader's liveness classification is made from.
		const now = Date.now() / 1000;
		writeFileSync(
			join(runDir, `${child.pid}.json`),
			JSON.stringify({
				pid: child.pid,
				host: "127.0.0.1",
				port,
				instance_id: recordInstanceId,
				version,
				source_ref: "",
				prefix: "/tmp/observation-prefix",
				install_kind: "uv-tool",
				desktop,
				claim_key: recordClaimKey,
				started_at: now - 10,
				heartbeat_at: now,
			}),
			{ mode: 0o600 },
		);
	};
	if (publishRecord) publishRecordFile(instanceId, claimKey);

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
		async replaceUnderApp({
			instanceId: nextInstanceId,
			acceptedBearer: nextBearer = live.acceptedBearer,
			sessionsStatus: nextSessions = live.sessionsStatus,
			/**
			 * Whether the successor has published ITS record yet. False models the
			 * seconds between the new process binding the port and its own record
			 * landing: `/health` already names it while the record directory still
			 * describes the process it replaced.
			 */
			publishRecord: publishSuccessorRecord = true,
		}) {
			live.instanceId = nextInstanceId;
			live.acceptedBearer = nextBearer;
			live.sessionsStatus = nextSessions;
			if (publishSuccessorRecord) publishRecordFile(nextInstanceId, nextBearer);
		},
		async dispose() {
			await closeServer();
			await stopChild();
			rmSync(root, { recursive: true, force: true });
		},
		/**
		 * The daemon RELOADS IN PLACE: same process, same pid, same listener, same
		 * accepted bearer - a NEW `instance_id`, and its record republished under it.
		 *
		 * Distinct from `replaceUnderApp` on purpose, because the two are different
		 * events: that one is a successor (a different process that refuses the
		 * credential this app holds), and this one is `os.execve`
		 * (`local_operator/server/reload.py`), whose whole point is that nothing but
		 * the process IMAGE changes. `desktop: true` with `claim_key: ""` is what
		 * such a reload republishes when the plane is governed through the
		 * environment - the shape a daemon spawned by the app always has.
		 */
		async reloadInPlace({
			instanceId: nextInstanceId,
			acceptedBearer: nextBearer = live.acceptedBearer,
			/**
			 * What the reloaded process republishes as its claim key. `""` is the
			 * env-governed shape (the spawner's token is the only credential that opens
			 * the plane); a fresh key models a reload that lost the in-memory claim
			 * latch and republished one - both are things `execve` can produce, and the
			 * adopted daemon's recovery differs between them.
			 */
			claimKey = "",
			desktop = true,
		}) {
			live.instanceId = nextInstanceId;
			live.acceptedBearer = nextBearer;
			publishRecordFile(nextInstanceId, claimKey, desktop);
			return nextInstanceId;
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
		const settled = first.manager.getStatusSnapshot();
		/*
		 * The finding's own property, asserted where it is decidable: a request that
		 * never reached the daemon leaves NO transport evidence, which is what
		 * `lastTransportAt` records.
		 *
		 * The STATE is a different question, and it is not wall-clock stable: a probe
		 * that expires its 2s budget is the `unanswered` class by design (`nine`
		 * consecutive misses before it may detach, because a daemon in the middle of
		 * a long turn answers nothing for seconds at a time). Measured on a loaded CI
		 * runner, three probes each expired their budget and left the state at
		 * `degraded` - legitimately, for the budget's own reason - while the same
		 * three were refused on a quiet one and detached. So the state is allowed to
		 * be either here and the SENTENCE has to name which, while the evidence that
		 * outranks both may not move at all.
		 */
		assert.equal(
			settled.lastTransportAt,
			null,
			"a request that was never sent is not an answer, so no transport evidence may be stamped from it",
		);
		if (settled.state === "degraded") {
			/*
			 * Either arm is legitimate on a loaded runner, and both name their own
			 * evidence: a probe that was refused below the detach threshold reads
			 * "(probe 2 of 3)", and one that expired its budget reads "no answer to
			 * probe N". Neither may read as an answer, which is what the assertion
			 * below this one holds.
			 */
			assert.match(
				settled.detail,
				RE_PROBE_EVIDENCE,
				"a degraded state has to name the evidence that produced it rather than an answer",
			);
		} else {
			assert.equal(
				settled.state,
				"detached",
				"a request that was never sent may not hold the connection open against three refused probes",
			);
		}
		assert.doesNotMatch(
			settled.detail,
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

/*
 * Which install the app runs, and where that answer comes from.
 *
 * The DECISION (`checkLocalOperatorExists`) and the SPAWN
 * (`resolveGlobalConsole`) have to name the same install, and both have to be
 * able to name it from a launchd-shaped environment: the app is started by
 * LaunchServices, whose PATH is `/usr/bin:/bin:/usr/sbin:/sbin`, and
 * `~/.local/bin` - where uv and pipx link their console scripts, and where
 * `lop-update` installs - is not on it. The shell probe this pair used to share
 * answered "not found globally" for exactly that reason, so the app fell through
 * to its own bundled environment and ran a backend the operator never updates
 * (measured 2026-09-16: bundled 0.55.9 against the installed 0.55.10).
 *
 * The shell probe is kept IN this case rather than described, because its empty
 * answer is the bug: if a later change reinstates it, the assertion that has to
 * fail is the one about the decision, not a sentence in a comment.
 */
const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const ENTRY_POINT = "from local_operator.cli import main";
/** A console script, as uv writes one: an interpreter shebang and the entry point. */
const consoleScript = (interpreter) => `#!${interpreter}\n${ENTRY_POINT}\n`;

test("the install is named without a shell, and the decision agrees with the spawn", async () => {
	const savedPath = process.env.PATH;
	const savedHome = process.env.HOME;
	/*
	 * The PATH a GUI-launched app is given, and the home the electron stub hands
	 * `app.getPath("home")` - the same one `homedir()` must answer, so an install
	 * written under the fixture home is both searched for and eligible for the
	 * legacy-environment refusal.
	 */
	process.env.PATH = LAUNCHD_PATH;
	process.env.HOME = HOME;
	const binDir = join(HOME, ".local", "bin");
	const shim = join(binDir, "local-operator");
	const lopShim = join(binDir, "lop");
	const manager = new BackendServiceManager();
	managers.add(manager);
	try {
		mkdirSync(binDir, { recursive: true });
		writeFileSync(shim, consoleScript(process.execPath));

		assert.equal(
			spawnSync("/bin/sh", ["-c", "command -v local-operator"], {
				env: process.env,
				encoding: "utf8",
			}).stdout.trim(),
			"",
			"the shell probe must find nothing here: that empty answer is the bug this case exists for",
		);
		assert.equal(
			await manager.checkLocalOperatorExists(),
			true,
			"the install is on this machine's disk, and the decision has to reach it without a shell",
		);
		assert.equal(
			await manager.resolveGlobalConsole(),
			shim,
			"and the spawn has to name the same script the decision counted",
		);

		/*
		 * The fallback name, for an install whose older console script is gone. The
		 * exact path is asserted only where nothing else on the machine can answer to
		 * `local-operator` first: a Homebrew or /usr/local copy would win the search
		 * ahead of this synthetic `lop`, and the assertion would then be about the
		 * machine rather than about the rule.
		 */
		rmSync(shim, { force: true });
		writeFileSync(lopShim, consoleScript(process.execPath));
		const anotherInstall = ["/opt/homebrew/bin", "/usr/local/bin"].some((dir) =>
			existsSync(join(dir, "local-operator")),
		);
		assert.equal(
			await manager.checkLocalOperatorExists(),
			true,
			"`lop` alone is still the operator's install, not a reason to use the bundled environment",
		);
		if (!anotherInstall) {
			assert.equal(
				await manager.resolveGlobalConsole(),
				lopShim,
				"and the fallback name is the one that gets spawned",
			);
		}

		/*
		 * A launcher whose shebang points into the app's own PRE-SPLIT environment is
		 * not the operator's install: it is the environment the app replaced, and the
		 * app prepares a split one instead of adopting what it left behind. Asserted
		 * on macOS alone, because that is where the refusal is applied - the directory
		 * it names is the macOS application-support one.
		 */
		if (process.platform === "darwin") {
			writeFileSync(
				shim,
				consoleScript(
					join(
						HOME,
						"Library",
						"Application Support",
						"Local Operator",
						"local-operator-venv",
						"bin",
						"python3",
					),
				),
			);
			assert.equal(
				await manager.checkLocalOperatorExists(),
				false,
				"a launcher inside the app's own former environment must not be adopted as the operator's install",
			);
		}
	} finally {
		process.env.PATH = savedPath;
		process.env.HOME = savedHome;
		rmSync(binDir, { recursive: true, force: true });
		await manager.stop(false).catch(() => {});
	}
});

/**
 * The report of 2026-09-18, end to end: a daemon replaced under a running app.
 *
 * `lop`'s build swap starts a successor on the SAME port with a fresh claim key
 * and a desktop plane that is shut until an app claims it. The app, which was
 * paired with the process that just went away, holds the credential of a process
 * that no longer exists - so every gated call it makes is refused, while
 * `/health` and the public capability op keep answering. That traffic was the
 * trap: each refusal was stamped as a successful request, which cleared the
 * identity-failure count, so the app never detached, never re-discovered and
 * never re-claimed, and it reported "This app is not paired with the running
 * Local Operator server" until the app itself was restarted. The state machine's
 * own guards are `daemon-health-state.test.mjs`'s; these two drive the CALL SITE
 * - the manager, against real HTTP - because that is where the refusal was
 * counted as a pairing.
 */
test("a daemon replaced under the app is re-paired without a restart (2026-09-18)", async () => {
	const scene = await daemonScene({
		instanceId: "instance-0.59.0",
		acceptedBearer: "old-claim-key",
		claimKey: "old-claim-key",
	});
	try {
		const { manager } = await adoptAtStartup(scene);
		const attached = manager.getStatusSnapshot();
		assert.equal(attached.state, "attached");
		assert.equal(attached.instanceId, "instance-0.59.0");

		// The successor: same address, new identity, its own record and claim key,
		// and a plane that refuses the credential this app is still holding.
		await scene.replaceUnderApp({
			instanceId: "instance-0.59.4",
			acceptedBearer: "successor-claim-key",
		});

		// The successor refuses the credential this app holds for the process it
		// replaced - the pre-condition of this case, asserted once.
		const refused = await manager.requestDesktop({
			op: "sessions.list",
			limit: 1,
		});
		assert.equal(
			refused.status,
			401,
			"the successor refuses the credential this app holds for the process it replaced",
		);
		// and the renderer's capability poll, which the plane answers without
		// admitting anyone - liveness, never a pairing
		const capabilities = await manager.requestDesktop({ op: "capabilities" });
		assert.equal(capabilities.status, 200);
		/*
		 * ONE tick is enough now, and that is the point of the 2026-09-21 change.
		 *
		 * Before it, the app had to accumulate three consecutive answered
		 * contradictions before it detached, and only `detached` reached
		 * re-discovery - so this case drove `DEGRADED_AFTER_FAILURES` of them. The
		 * pairing record says the pairing is broken on the FIRST answered
		 * contradiction (`probeAttachedDaemon` sets `cause: "successor"` there), and
		 * `checkBackendHealth` now consults it, so re-discovery runs at once - which
		 * is also what makes the band's Retry do something the moment a user presses
		 * it rather than waiting out three probes (design § 6.2).
		 */
		await manager.checkBackendHealth();

		const healed = await waitFor(() => {
			const snapshot = manager.getStatusSnapshot();
			return snapshot.state === "attached" &&
				snapshot.instanceId === "instance-0.59.4"
				? snapshot
				: null;
		}, "the app to re-discover the successor, claim its plane and re-attach");
		assert.equal(healed.pid, scene.pid);
		assert.ok(
			scene.seen.some((request) => request.path === "/v1/desktop/claim"),
			"re-pairing IS the claim handshake, so the successor must have been asked for it - before this fix the app never detached, so it never asked",
		);
		await manager.stop(false);
	} finally {
		await scene.dispose();
	}
});

test("a successor whose plane is SHUT detaches the app rather than holding it attached", async () => {
	const scene = await daemonScene({
		instanceId: "instance-0.59.0",
		acceptedBearer: "old-claim-key",
		claimKey: "old-claim-key",
	});
	try {
		const { manager } = await adoptAtStartup(scene);
		assert.equal(manager.getStatusSnapshot().state, "attached");
		/*
		 * The same swap, caught in the window before the successor's own record
		 * lands (`publishRecord: false`), so discovery has nothing it may attach
		 * to yet and the app's only correct answer is `detached` - the state that
		 * re-discovers. What it may NOT do is stay `attached` to a pid that is gone
		 * on the strength of the refusals it keeps collecting.
		 */
		await scene.replaceUnderApp({
			instanceId: "instance-0.59.4",
			acceptedBearer: "successor-claim-key",
			sessionsStatus: 503,
			publishRecord: false,
		});
		for (let i = 0; i < DEGRADED_AFTER_FAILURES; i++) {
			const refused = await manager.requestDesktop({
				op: "sessions.list",
				limit: 1,
			});
			assert.equal(
				refused.status,
				503,
				"a shut plane refuses every gated route, whatever credential is presented",
			);
			await manager.requestDesktop({ op: "capabilities" });
			await manager.checkBackendHealth();
		}
		const settled = manager.getStatusSnapshot();
		assert.equal(
			settled.state,
			"detached",
			"three answered contradictions detach, which is what re-discovery and a fresh claim are reached from",
		);
		assert.equal(settled.failures, DEGRADED_AFTER_FAILURES);
		assert.doesNotMatch(
			settled.detail,
			RE_CONNECTED_TO_THE_DAEMON,
			"and the row may no longer describe the replaced process as the daemon this app is connected to",
		);
		await manager.stop(false);
	} finally {
		await scene.dispose();
	}
});

/*
 * The three pairing causes this change introduced, produced by real loopback
 * daemons rather than by a hand-built status (design § 7). Each is a DIFFERENT
 * fact with a different sentence, and telling them apart is the whole point: they
 * reached the operator as one sentence about restarting the app so it could manage
 * its own server.
 */
test("S2: a plane another program governs reports `governed-elsewhere`", async () => {
	const scene = await daemonScene({
		instanceId: "instance-governed",
		// The record a governed plane leaves: no key for us, and `desktop: true`.
		claimKey: "",
		recordGoverned: true,
	});
	try {
		const { manager, adopted } = await adoptAtStartup(scene);
		assert.equal(
			adopted,
			false,
			"this app may not drive another program's plane",
		);
		const snapshot = manager.getStatusSnapshot();
		assert.deepEqual(
			snapshot.pairing,
			{ available: false, cause: "governed-elsewhere" },
			"the record's own `desktop: true` with no key is the governed discriminator",
		);
		assert.equal(
			snapshot.desktopAvailable,
			false,
			"the derived boolean is the record's, so the two cannot disagree",
		);
	} finally {
		await scene.die();
	}
});

test("S3: a claim route that does not exist reports `pre-handshake`", async () => {
	const scene = await daemonScene({
		instanceId: "instance-pre-handshake",
		claimStatus: 404,
	});
	try {
		const { manager, adopted } = await adoptAtStartup(scene);
		assert.equal(adopted, false);
		assert.deepEqual(
			manager.getStatusSnapshot().pairing,
			{ available: false, cause: "pre-handshake" },
			"a missing claim route names an INSTALL older than the handshake",
		);
	} finally {
		await scene.die();
	}
});

test("S4: a plane that refuses this app's bearer reports `credential-refused`", async () => {
	const scene = await daemonScene({
		instanceId: "instance-refused-bearer",
		// The plane is open and answers; the key this record publishes is not the one it
		// accepts, which is what a refusal of OUR credential looks like.
		acceptedBearer: "f".repeat(64),
	});
	try {
		const { manager, adopted } = await adoptAtStartup(scene);
		assert.equal(adopted, false);
		assert.deepEqual(
			manager.getStatusSnapshot().pairing,
			{ available: false, cause: "credential-refused" },
			"a refusal is a pairing cause, and re-claiming is the repair",
		);
	} finally {
		await scene.die();
	}
});

/*
 * ===========================================================================
 * A RELOAD IS NOT A REPLACEMENT (2026-09-20)
 * ===========================================================================
 *
 * `lop-update` moves the daemon it serves onto the new build with `os.execve`:
 * the pid, the listener fd, the working directory and the ENVIRONMENT all
 * survive, the successor re-runs the ASGI lifespan - where `instance_id` is
 * minted again (`server/app.py`) - and it republishes its serve record under the
 * new id (`server/registry.py`). On the operator's machine that daemon was this
 * app's OWN CHILD (app pid 1968, child pid 2082, spawned with
 * `LOCAL_OPERATOR_DESKTOP_TOKEN`, logged at 12:27 as "Registered this app's own
 * daemon"), and `lop-update` moved it in place twice that afternoon.
 *
 * The app read the new instance id as a successor. It published
 * `pairing: { available: false, cause: "successor" }`, which renders as "The
 * Local Operator server was replaced while this app was running. Pairing with
 * the new one." - a band that sat on screen for hours over a connection that was
 * still authenticated to that same process, with every gated route answering
 * 200. Recovery could not clear it either: `recoverFromDetachment` returns at its
 * live owned-child guard (deliberately - that guard is what stops a second daemon
 * being spawned over a live child), so the band's Retry (`reconnectNow()`) was
 * inert and only an app restart cleared it.
 *
 * These cases drive the REAL manager, over real loopback HTTP and real record
 * files, against a daemon it SPAWNED ITSELF - `startOwned()` through a fixture
 * launch plan, so `this.process` is a live ChildProcess handle for the pid the
 * record names, which is the whole of what the re-anchor rests on. The daemon it
 * merely ADOPTS is A3, and that case is there to keep the reasoning honest rather
 * than because it is broken.
 *
 * The fixture daemon is a real process - a node script the manager spawns, the
 * same way it spawns `lop serve` - and its "reload" is the event in the one place
 * the app can tell them apart: the same pid, port, listener and accepted bearer,
 * with a new instance id and a republished record. What it cannot reproduce is
 * the `execve` itself; the evidence script
 * `scripts/reload-reanchor-evidence.mjs` runs that against a real `lop serve`.
 */
const RE_OWNED_SERVE_LAUNCH = /^\.\/owned-serve-launch$/;
const RE_OWNED_FIXTURE_SOURCES =
	/^(electron|logger-fixture|config-fixture|owned-launch-fixture)$/;

/**
 * The daemon `lop serve` would have been, as one real child process.
 *
 * It publishes a serve record, answers the routes this app reads, and can be
 * told to reload in place over `/fixture/reload`. The route list is deliberately
 * the narrow set the app's own paths touch - `/health` for identity,
 * `/v1/desktop/sessions` for the gated read whose 200 is what "still paired"
 * means, `/v1/capabilities` for the poll the renderer runs while a plane is shut
 * - plus `/fixture/state`, which is the TEST's window (health-request count and
 * the identity in force) and not something the app ever asks for.
 */
const OWNED_DAEMON_FIXTURE = `
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const port = Number(process.env.FIXTURE_PORT);
const runDir = join(process.env.FIXTURE_CONFIG_ROOT, "run", "serve");
/*
 * The bearer this app spawned the daemon with. A reload preserves the
 * environment, so it stays the accepted one across it - which is the point: the
 * same process keeps serving the same plane, and the record it republishes says
 * so (desktop: true, claim_key: "").
 */
const bearer = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN || "";
const version = process.env.FIXTURE_VERSION || "0.61.1";
let instanceId = process.env.FIXTURE_INSTANCE || "instance-before-reload";
let startedAt = Date.now() / 1000;
let healthCount = 0;
/*
 * Withheld identity, set by the /fixture/not-a-daemon route. The app reads a
 * /health answer with no instance_id as "not-a-daemon", which is one of the
 * shapes that STILL contradicts: the residue the observation suite pins below,
 * where a live child this app spawned is declined by the discovery guard.
 */
let identityWithheld = false;
mkdirSync(runDir, { recursive: true });

const publish = () =>
	writeFileSync(
		join(runDir, process.pid + ".json"),
		JSON.stringify({
			pid: process.pid,
			host: "127.0.0.1",
			port,
			instance_id: instanceId,
			version,
			source_ref: "",
			prefix: "/tmp/owned-fixture-prefix",
			install_kind: "uv-tool",
			desktop: true,
			claim_key: "",
			reloadable: true,
			started_at: startedAt,
			heartbeat_at: Date.now() / 1000,
		}),
		{ mode: 0o600 },
	);
publish();
setInterval(publish, 2000);

const json = (res, status, body) => {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
};

createServer((req, res) => {
	const path = (req.url || "").split("?")[0];
	if (path === "/health") {
		healthCount += 1;
		json(res, 200, {
			status: 200,
			message: "ok",
			result: identityWithheld
				? {}
				: {
						version,
						instance_id: instanceId,
						pid: process.pid,
						prefix: "/tmp/owned-fixture-prefix",
						install_kind: "uv-tool",
					},
		});
		return;
	}
	if (path === "/v1/capabilities") {
		json(res, 200, { status: 200, result: { desktop_available: true } });
		return;
	}
	if (path === "/v1/desktop/claim") {
		json(res, 200, { status: 200 });
		return;
	}
	if (path === "/fixture/state") {
		json(res, 200, { pid: process.pid, instanceId, healthCount });
		return;
	}
	if (path === "/fixture/not-a-daemon") {
		identityWithheld = true;
		json(res, 200, { withheld: true });
		return;
	}
	if (path === "/fixture/reload") {
		/*
		 * IN PLACE. The process, the port, the listener and the environment are all
		 * untouched; the identity is minted again and the record is republished,
		 * which is what the far side of an execve produces for this app to read.
		 */
		instanceId = randomUUID();
		startedAt = Date.now() / 1000;
		publish();
		json(res, 200, { instanceId });
		return;
	}
	if (path === "/v1/desktop/sessions") {
		const presented = String(req.headers.authorization || "").replace(
			"Bearer ",
			"",
		);
		if (presented !== bearer) {
			json(res, 401, { detail: "Unauthorized" });
			return;
		}
		json(res, 200, {
			status: 200,
			result: { sessions: [], truncated: false, limit: 1 },
		});
		return;
	}
	json(res, 404, { detail: "Not Found" });
}).listen(port, "127.0.0.1");
`;

/**
 * The same manager, with the SPAWN it makes in `startOwned()` handed a fixture
 * daemon instead of an installed `lop`.
 *
 * Three substitutions, each of which keeps a real thing out of the run:
 * `./config` and `./logger` for the reasons the file's header gives, and
 * `./owned-serve-launch` because the alternative is spawning the operator's own
 * installed build onto a port of this test's choosing. The substitution replaces
 * the LAUNCH PLAN only: everything downstream of it - the real `spawn`, the real
 * readiness poll, `captureServe`, `registerOwnedDaemon`, the armed probe loop -
 * is the shipping code, which is what makes the owned-child handle in these cases
 * mean what it means in the app.
 */
const ownedBundle = await build({
	stdin: {
		contents:
			'export { BackendServiceManager } from "./src/main/backend/backend-service.ts";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "owned-daemon-fixtures",
			setup(builder) {
				builder.onResolve({ filter: RE_ELECTRON }, () => ({
					path: "electron",
					namespace: "owned-fixture",
				}));
				for (const [filter, name] of [
					[RE_LOGGER, "logger-fixture"],
					[RE_CONFIG, "config-fixture"],
					[RE_OWNED_SERVE_LAUNCH, "owned-launch-fixture"],
				]) {
					builder.onResolve({ filter }, (args) =>
						args.importer.endsWith("main/backend/backend-service.ts")
							? { path: name, namespace: "owned-fixture" }
							: undefined,
					);
				}
				builder.onLoad(
					{
						filter: RE_OWNED_FIXTURE_SOURCES,
						namespace: "owned-fixture",
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
							"config-fixture": `
								export const backendConfig = {
									get VITE_LOCAL_OPERATOR_API_URL() { return globalThis.__testConfiguredUrl; },
									VITE_DISABLE_BACKEND_MANAGER: "false",
								};
							`,
							/*
							 * The plan only. `interpreters` is ignored on purpose: the app's
							 * own-venv branch is what `checkLocalOperatorExists = false`
							 * selects, and this case is not about which interpreter a real
							 * install would name (`scripts/owned-serve-lifecycle.test.mjs`).
							 *
							 * The `CMUX_*` scrub is not decoration: an inherited
							 * `CMUX_WORKSPACE_ID` once let a headless test rename the
							 * operator's real cmux workspaces, and this spawn inherits this
							 * process's environment.
							 */
							"owned-launch-fixture": `
								export const consoleInterpreter = () => process.execPath;
								export const windowsInterpreterCandidates = async () => [];
								export const windowsPathInterpreterCandidates = async () => [];
								export const ownedServeLaunch = async (interpreters, port, env) => {
									const childEnv = { ...env, FIXTURE_PORT: String(port), FIXTURE_CONFIG_ROOT: globalThis.__ownedFixtureRoot };
									for (const key of Object.keys(childEnv)) {
										if (key.startsWith("CMUX_")) Reflect.deleteProperty(childEnv, key);
									}
									return { command: process.execPath, args: [globalThis.__ownedFixtureScript], env: childEnv };
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

const { BackendServiceManager: OwnedBackendServiceManager } = await import(
	`data:text/javascript;base64,${Buffer.from(ownedBundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The real loader starts a login shell to read the operator's rc files. Nothing
 * here needs that answer - the environment this child gets is stated by the case
 * that spawns it - and a test may not go looking through the operator's shell
 * configuration to find one.
 */
OwnedBackendServiceManager.prototype.loadShellEnvironment = async () => {};

/** An ephemeral port, released for the child that will bind it. */
async function freePort() {
	const probe = createNetServer();
	await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
	const { port } = probe.address();
	await new Promise((resolve) => probe.close(resolve));
	return port;
}

/**
 * A daemon this app SPAWNS, so `this.process` is a live ChildProcess handle for
 * the pid its record names - the fact the re-anchor rests on.
 *
 * Everything in the run is the shipping path except the launch plan: the spawn,
 * the readiness poll, the registration against the record the child published,
 * and the armed probe loop are all real.
 */
async function ownedDaemonScene({
	version = "0.61.1",
	instanceId = "instance-before-reload",
} = {}) {
	const root = mkdtempSync(join(tmpdir(), "daemon-observation-owned-"));
	// One root for both halves: the record the child publishes is the record the
	// manager reads, and no other case's record is a candidate.
	process.env.LOCAL_OPERATOR_CONFIG_DIR = root;
	globalThis.__ownedFixtureRoot = root;
	globalThis.__ownedFixtureScript = join(root, "owned-daemon-fixture.mjs");
	writeFileSync(globalThis.__ownedFixtureScript, OWNED_DAEMON_FIXTURE);

	const address = `http://127.0.0.1:${await freePort()}`;
	globalThis.__testConfiguredUrl = address;

	const { intervals, value: manager } = await withRecordedProbeLoop(
		async () => {
			const started = new OwnedBackendServiceManager();
			managers.add(started);
			started.shellEnv = {
				...process.env,
				LOCAL_OPERATOR_CONFIG_DIR: root,
				FIXTURE_CONFIG_ROOT: root,
				FIXTURE_VERSION: version,
				FIXTURE_INSTANCE: instanceId,
			};
			/*
			 * The install DECISION is not the subject and must not name the operator's
			 * real `lop` install. `false` selects the app's own-venv branch, and the
			 * substituted launch plan ignores the interpreter that branch names - so
			 * this rig never reads, spawns or writes anything of the operator's.
			 */
			started.checkLocalOperatorExists = async () => false;
			assert.equal(
				await started.start({ quiet: true }),
				true,
				"the rig has to end up OWNING a daemon: every case below is about the process this app spawned",
			);
			return started;
		},
	);

	return {
		root,
		address,
		manager,
		intervals,
		async state() {
			const response = await fetch(`${address}/fixture/state`);
			return response.json();
		},
		/** Reload in place. Returns the identity the same process mints for it. */
		async reloadInPlace() {
			const response = await fetch(`${address}/fixture/reload`);
			const body = await response.json();
			return body.instanceId;
		},
		/**
		 * Make the SAME live process answer `/health` without an identity, which the
		 * app reads as `not-a-daemon`. Deliberately not a reload: this is the residue
		 * that must keep contradicting.
		 */
		async answerAsNonDaemon() {
			const response = await fetch(`${address}/fixture/not-a-daemon`);
			return response.json();
		},
		async dispose() {
			await manager.stop(false).catch(() => {});
			rmSync(root, { recursive: true, force: true });
		},
	};
}

/**
 * Run ONE armed tick, the way the app's own 10 s interval does.
 *
 * The recorded callback IS the function a real tick runs, so calling it here is
 * the tick the app would have run, ten seconds early and deterministically. The
 * settle is measured rather than guessed: the child's own health-request count
 * first (the probe reached the daemon), then the state machine's `updatedAt`,
 * which every `observe()` writes (the verdict was folded).
 *
 * @returns whether a probe was made at all. A tick can make none - the app
 * spends it PACED, returning from `recoverFromDetachment()` while the reattach
 * backoff holds - and that is the app's own behaviour rather than a rig failure,
 * so it is reported and left to the case's own assertions to judge. A rig that
 * threw here instead would report "the tick never reached the daemon" for a
 * connection that is broken in the way the case exists to describe.
 */
async function tickArmedProbe(scene) {
	const counterBefore = (await scene.state()).healthCount;
	const clockBefore = scene.manager.getStatusSnapshot().updatedAt;
	const loop = scene.intervals.find((entry) => entry.ms === PROBE_INTERVAL_MS);
	assert.ok(loop, "startOwned() must have armed the probe loop");
	loop.fn();
	const deadline = Date.now() + 2_000;
	let probed = false;
	while (Date.now() < deadline) {
		if ((await scene.state()).healthCount > counterBefore) {
			probed = true;
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	if (!probed) return false;
	await waitFor(
		() => scene.manager.getStatusSnapshot().updatedAt > clockBefore,
		"the tick's probe to be folded into the state machine",
	);
	return true;
}

test("a reload in place of the daemon this app spawned keeps the app attached and paired (2026-09-20)", async () => {
	const scene = await ownedDaemonScene();
	try {
		const { manager } = scene;
		const pushes = [];
		manager.onStatusChange((snapshot) => pushes.push(snapshot));

		const before = manager.getStatusSnapshot();
		assert.equal(
			before.state,
			"attached",
			"the rig must start from a live, owned attachment",
		);
		assert.equal(before.owned, true);
		assert.equal(before.pid, manager.getOwnedPid());
		assert.equal(before.pairing.available, true);
		assert.equal(
			(await scene.state()).pid,
			manager.getOwnedPid(),
			"and the process the record names is the one this app spawned",
		);

		const reloadedInstanceId = await scene.reloadInPlace();
		assert.notEqual(
			reloadedInstanceId,
			before.instanceId,
			"the reload must be visible as a new instance id, or this case tests nothing",
		);
		assert.equal(
			(await scene.state()).pid,
			manager.getOwnedPid(),
			"and it is the SAME process that answers after it: that is what makes a reload a reload",
		);

		const sequence = [];
		for (let tick = 1; tick <= 5; tick++) {
			const probed = await tickArmedProbe(scene);
			const snapshot = manager.getStatusSnapshot();
			sequence.push({
				tick,
				state: snapshot.state,
				pairing: snapshot.pairing.available
					? "paired"
					: `cause: ${snapshot.pairing.cause}`,
				instanceId: snapshot.instanceId,
				probed,
			});
		}

		const after = manager.getStatusSnapshot();
		assert.equal(
			after.state,
			"attached",
			`the app is still talking to the process it started, so it must stay attached. Observed: ${JSON.stringify(sequence)}`,
		);
		assert.equal(
			after.pairing.available,
			true,
			`a reload is not a replacement: the same process still holds this app's credential. Observed: ${JSON.stringify(sequence)}`,
		);
		assert.equal(
			after.instanceId,
			reloadedInstanceId,
			`and the app must adopt the identity the reload minted, or every later probe contradicts it again. Observed: ${JSON.stringify(sequence)}`,
		);
		assert.equal(after.pid, manager.getOwnedPid());
		assert.equal(after.owned, true);
		assert.equal(
			pushes.filter((snapshot) => snapshot.pairing.cause === "successor")
				.length,
			0,
			`no successor pairing may reach the renderer: that state is the band the operator photographed. Observed: ${JSON.stringify(pushes.map((snapshot) => [snapshot.state, snapshot.pairing.cause]))}`,
		);
		assert.equal(
			pushes.filter(
				(snapshot) =>
					snapshot.state === "detached" || snapshot.state === "degraded",
			).length,
			0,
			"and the connection never even left `attached`, because nothing was ever lost",
		);
	} finally {
		await scene.dispose();
	}
});

test("the live evening, reproduced: an admitted read between probes is why the app's log held no detach line (2026-09-20)", async () => {
	/*
	 * The app did not sit still while it was telling the operator its server had
	 * been replaced: it was listing sessions and streaming a transcript, and it
	 * logged NO "Backend detached:" line all afternoon.
	 *
	 * This case is that sequence, and it settles the question the log could not.
	 * The suspects were the transport-evidence gate and `observeUnanswered` - and
	 * neither is it. The probe ANSWERED every time (an identity-mismatch is an
	 * answer, so no unanswered miss was ever counted), and the gate never got a
	 * chance to matter, because the count is cleared by something stronger: the
	 * app's OWN request, admitted by the same plane, runs
	 * `recordTransportSuccess()` -> which a `degraded` machine answers by zeroing
	 * the failure count and returning to `attached`
	 * (`daemon-health-state.test.mjs`, "an ADMITTED request still clears the count,
	 * which is what a pairing is"). So the three CONSECUTIVE contradictions that
	 * `DEGRADED_AFTER_FAILURES` requires were never reached: the state oscillated
	 * between one contradiction and a cleared count, `checkBackendHealth` never
	 * saw `detached`, and `recoverFromDetachment` - the only path that could have
	 * repaired the pairing - was never entered at all. The band stayed up and its
	 * Retry had nothing to trigger, which is exactly what the operator saw.
	 *
	 * Before the fix, the failure message on this case carries that sequence: the
	 * state walks `degraded` -> `attached` -> `degraded` and the pairing reads
	 * `successor` from the first tick on.
	 */
	const scene = await ownedDaemonScene();
	try {
		const { manager } = scene;
		const pushes = [];
		manager.onStatusChange((snapshot) => pushes.push(snapshot));
		await scene.reloadInPlace();

		const sequence = [];
		for (let tick = 1; tick <= 4; tick++) {
			const probed = await tickArmedProbe(scene);
			/*
			 * The renderer's own traffic between probes. It is admitted because the
			 * token is the same process's - the load-bearing fact of this whole
			 * change - and the fixture refuses anything else with a 401.
			 */
			const read = await manager.requestDesktop({
				op: "sessions.list",
				limit: 1,
			});
			assert.equal(
				read.status,
				200,
				"the daemon this app spawned still admits this app's credential across a reload, which is why the band was false as well as stuck",
			);
			const snapshot = manager.getStatusSnapshot();
			sequence.push({
				tick,
				state: snapshot.state,
				failures: snapshot.failures,
				pairing: snapshot.pairing.available
					? "paired"
					: `cause: ${snapshot.pairing.cause}`,
				probed,
			});
		}

		const after = manager.getStatusSnapshot();
		assert.equal(
			after.state,
			"attached",
			`the live state was never detached, and with the fix it is never even degraded. Observed: ${JSON.stringify(sequence)}`,
		);
		assert.equal(after.failures, 0);
		assert.equal(
			after.pairing.available,
			true,
			`the pairing the renderer reads must stay the true one. Observed: ${JSON.stringify(sequence)}`,
		);
		assert.equal(
			pushes.filter((snapshot) => snapshot.state === "detached").length,
			0,
			"no detach, so no `Backend detached:` line: this is the reproduced explanation for the empty log the report could not account for",
		);
		assert.equal(
			pushes.filter((snapshot) => snapshot.pairing.cause === "successor")
				.length,
			0,
		);
	} finally {
		await scene.dispose();
	}
});

test("the banner's Retry clears a stuck successor pairing on an owned child (2026-09-20)", async () => {
	const scene = await ownedDaemonScene();
	try {
		const { manager } = scene;
		const reloadedInstanceId = await scene.reloadInPlace();

		/*
		 * The state the operator's app was found in, built from the machine's OWN
		 * vocabulary rather than from a hand-written snapshot: the answered
		 * contradiction published the successor pairing (`probeAttachedDaemon`), and
		 * the three contradictions a machine with no admitted traffic between probes
		 * reaches detached it. The pairing is seeded here because a fix that no
		 * longer produces it cannot produce it for a test either; everything the
		 * repair then does is the fixing code's own.
		 */
		manager.daemonState.setPairing({
			available: false,
			cause: "successor",
		});
		for (let i = 0; i < DEGRADED_AFTER_FAILURES; i++) {
			manager.daemonState.observe({
				kind: "contradicted",
				detail: `Another process is answering at ${scene.address}`,
			});
		}
		const stuck = manager.getStatusSnapshot();
		assert.equal(
			stuck.state,
			"detached",
			"the rig must start from the reported state",
		);
		assert.equal(stuck.pairing.cause, "successor");

		const pushes = [];
		manager.onStatusChange((snapshot) => pushes.push(snapshot));
		// The renderer's verb, exactly: this is what the band's Retry runs.
		const healed = await manager.reconnectNow();

		assert.equal(
			healed.state,
			"attached",
			"the Retry has to clear the state it was offered for",
		);
		assert.equal(
			healed.pairing.available,
			true,
			"and the pairing with it: the same process is still the one holding this app's credential",
		);
		assert.equal(
			healed.instanceId,
			reloadedInstanceId,
			"the app adopts the identity the reload minted",
		);
		assert.equal(healed.pid, manager.getOwnedPid());
		assert.ok(
			pushes.some(
				(snapshot) =>
					snapshot.state === "attached" && snapshot.pairing.available,
			),
			"and the renderer is TOLD, rather than the repair living only in main",
		);
	} finally {
		await scene.dispose();
	}
});

test("the residue: an owned child that answers as a non-daemon still reaches the guard, and the Retry cannot clear it (2026-09-20)", async () => {
	const scene = await ownedDaemonScene();
	try {
		const { manager } = scene;
		const ownedPid = manager.getOwnedPid();
		const before = manager.getStatusSnapshot();

		await scene.answerAsNonDaemon();
		const probed = await tickArmedProbe(scene);

		/*
		 * THE RESIDUE, PINNED RATHER THAN ONLY DESCRIBED. The re-anchor covers the
		 * shape where the SAME process answers under a new `instance_id`. A live owned
		 * child that answers without an identity (`not-a-daemon`), or one that names a
		 * different pid, still contradicts, still reaches the contradiction arm in
		 * `recoverFromDetachment()`, and still returns at that method's live owned-child
		 * guard - because `discoverAndAttach()` below it can answer `false` and fall
		 * through to `start({ quiet: true })`, spawning a second daemon over a child
		 * that is demonstrably still serving. So the band's Retry is inert for this
		 * shape too and only an app restart clears it. That limit is deliberate and is
		 * asserted here so a later reader finds it as a case rather than as a claim.
		 */
		const contradicted = manager.getStatusSnapshot();
		assert.equal(
			probed,
			true,
			"the probe has to answer and reach the state machine, or this case tests nothing",
		);
		assert.equal(
			contradicted.pairing.available,
			false,
			"a live child answering as a non-daemon is a contradiction, so the band is up",
		);
		assert.equal(contradicted.pairing.cause, "successor");

		const healthBefore = (await scene.state()).healthCount;
		const pushes = [];
		manager.onStatusChange((snapshot) => pushes.push(snapshot));
		// The renderer's verb, exactly: this is what the band's Retry runs.
		const after = await manager.reconnectNow();

		assert.equal(
			after.pairing.available,
			false,
			"the Retry cannot clear this shape: nothing is adopted, so the band stays",
		);
		assert.equal(after.pairing.cause, "successor");
		assert.equal(
			after.instanceId,
			before.instanceId,
			"and it stays on the identity it had, rather than adopting an answer that is not one",
		);
		assert.equal(
			manager.getOwnedPid(),
			ownedPid,
			"the point of the guard: no second daemon is spawned over the live child",
		);
		assert.equal(
			(await scene.state()).pid,
			ownedPid,
			"and the child this app spawned is still the process serving",
		);
		assert.ok(
			(await scene.state()).healthCount > healthBefore,
			"the Retry did probe the live child rather than returning without looking",
		);
		assert.equal(
			pushes.filter((snapshot) => snapshot.pairing.available).length,
			0,
			"nothing in the sequence claims a pairing, so the band is the honest rendering",
		);
	} finally {
		await scene.dispose();
	}
});

test("A3: an ADOPTED daemon that reloads in place recovers without a restart, by re-discovery", async () => {
	/*
	 * A guard on the reasoning rather than a requirement of the fix: the claim is
	 * that the adopted shape ALREADY recovers, so the re-anchor correctly stays
	 * owned-only and the pid-recycling hole that an adopted daemon could open in
	 * the weaker rule is never opened at all.
	 *
	 * Both halves of the claim are driven here, because "the reload republishes a
	 * record the app can open" is two different facts:
	 *
	 *   - the plane stays env-governed (`claim_key: ""`, `desktop: true`) and this
	 *     app holds the credential an earlier run persisted, so the re-discovery
	 *     pass opens it with that token;
	 *   - the reload loses the in-memory claim latch and republishes a NEW key, so
	 *     the app re-claims the plane with it.
	 */
	const token = "a".repeat(64);
	const reMintedKey = "b".repeat(64);
	const tokenFile = join(HOME, "userData", "desktop-token");

	for (const [label, { claimKey, acceptedBearer }] of [
		["the plane stays env-governed", { claimKey: "", acceptedBearer: token }],
		[
			"the reload republishes a claim key",
			{ claimKey: reMintedKey, acceptedBearer: reMintedKey },
		],
	]) {
		const scene = await daemonScene({
			instanceId: "instance-adopted-before-reload",
			claimKey: "",
			acceptedBearer: token,
		});
		globalThis.__testConfiguredUrl = scene.address;
		mkdirSync(join(HOME, "userData"), { recursive: true });
		writeFileSync(tokenFile, token, { mode: 0o600 });
		const { manager, intervals } = await adoptAtStartup(scene);
		try {
			assert.equal(
				manager.getStatusSnapshot().state,
				"attached",
				`the rig must start adopted and attached (${label})`,
			);
			assert.equal(manager.getStatusSnapshot().owned, false);

			const reloadedInstanceId = "instance-adopted-after-reload";
			await scene.reloadInPlace({
				instanceId: reloadedInstanceId,
				claimKey,
				acceptedBearer,
			});

			/*
			 * No admitted read between these probes: this is the ordinary adopted
			 * shape, where three answered contradictions are what a machine with no
			 * traffic of its own reaches.
			 */
			for (let i = 0; i < DEGRADED_AFTER_FAILURES; i++) {
				const loop = intervals.find((entry) => entry.ms === PROBE_INTERVAL_MS);
				assert.ok(loop, "adoption must have armed the probe loop");
				const clockBefore = manager.getStatusSnapshot().updatedAt;
				const seenBefore = scene.seen.length;
				loop.fn();
				await waitFor(
					() => scene.seen.length > seenBefore,
					"the tick's probe to reach the daemon",
				);
				await waitFor(
					() => manager.getStatusSnapshot().updatedAt > clockBefore,
					"the tick's probe to be folded",
				);
			}

			const healed = await waitFor(() => {
				const snapshot = manager.getStatusSnapshot();
				return snapshot.state === "attached" &&
					snapshot.instanceId === reloadedInstanceId
					? snapshot
					: null;
			}, `the adopted daemon's reload to be re-attached (${label})`);

			assert.equal(healed.pairing.available, true, label);
			assert.equal(
				manager.getOwnedPid(),
				null,
				`nothing may be spawned over a daemon this app does not own (${label})`,
			);
			assert.equal(healed.pid, scene.pid, label);
		} finally {
			rmSync(tokenFile, { force: true });
			await manager.stop(false).catch(() => {});
			await scene.dispose();
		}
	}
});

test("the operator's report: an ADOPTED daemon that reloads in place never re-discovers while admitted traffic keeps clearing the count (2026-09-21)", async () => {
	/*
	 * THE LIVE EVENING OF 2026-09-21, in the shape the operator's own
	 * `backend-service.log` records: this app ADOPTED a daemon it did NOT spawn
	 * (pid 1276, owned:false), that daemon reloaded IN PLACE (`lop-update`,
	 * `os.execve` - same pid, same port, new instance_id, republished record), and
	 * every gate route kept admitting this app's credential.
	 *
	 * The band "The Local Operator server was replaced while this app was running.
	 * Pairing with the new one." sat from ~20:08 to 21:20:31, and the log holds NO
	 * "Backend detached:" line in that window - which is the whole clue. The
	 * probe answers `identity-mismatch` (an ANSWER, not a miss), so exactly ONE
	 * `contradicted` observation is folded per tick; but this app is also reading
	 * from the same daemon (the renderer's presence beat and session reads), and
	 * each ADMITTED answer runs `recordTransportSuccess()`, which clears the
	 * failure count and revives `degraded` -> `attached`. The three CONSECUTIVE
	 * contradictions `DEGRADED_AFTER_FAILURES` requires are therefore never
	 * reached, `checkBackendHealth` never sees `detached`, and
	 * `recoverFromDetachment` - the only path that re-discovers and re-pairs - is
	 * never entered. The pairing cause stays `successor` for as long as the app is
	 * left open.
	 *
	 * A3 (above) drives the same reload WITHOUT the interleaved admitted traffic,
	 * which is exactly why A3 passes today: its three contradictions accumulate
	 * and detach. This case is the operator's shape, and it is the one that was
	 * broken.
	 */
	const token = "d".repeat(64);
	const tokenFile = join(HOME, "userData", "desktop-token");
	mkdirSync(join(HOME, "userData"), { recursive: true });
	writeFileSync(tokenFile, token, { mode: 0o600 });

	const scene = await daemonScene({
		instanceId: "instance-adopted-before",
		claimKey: "",
		acceptedBearer: token,
	});
	globalThis.__testConfiguredUrl = scene.address;
	const { manager, intervals } = await adoptAtStartup(scene);
	try {
		const adopted = manager.getStatusSnapshot();
		assert.equal(
			adopted.state,
			"attached",
			"the rig must start adopted and attached",
		);
		assert.equal(
			adopted.owned,
			false,
			"adopted, not spawned: this is the operator's shape",
		);

		const reloadedInstanceId = "instance-adopted-after";
		await scene.reloadInPlace({
			instanceId: reloadedInstanceId,
			claimKey: "",
			acceptedBearer: token,
		});

		const loop = intervals.find((entry) => entry.ms === PROBE_INTERVAL_MS);
		assert.ok(loop, "adoption must have armed the probe loop");

		const sequence = [];
		for (let tick = 1; tick <= 5; tick++) {
			const clockBefore = manager.getStatusSnapshot().updatedAt;
			const seenBefore = scene.seen.length;
			loop.fn();
			await waitFor(
				() => scene.seen.length > seenBefore,
				"the tick's probe to reach the daemon",
			);
			await waitFor(
				() => manager.getStatusSnapshot().updatedAt > clockBefore,
				"the tick's probe to be folded",
			);
			/*
			 * The renderer's own traffic between probes - the presence beat and a
			 * session read - which the SAME plane admits (the reload preserved this
			 * app's credential). This is the load-bearing detail of the report: it
			 * is what clears the contradiction count and keeps the app `attached`.
			 */
			const read = await manager.requestDesktop({
				op: "sessions.list",
				limit: 1,
			});
			assert.equal(
				read.status,
				200,
				"the reloaded daemon still admits this app's credential: the pairing is real even though main reports it broken",
			);
			const snapshot = manager.getStatusSnapshot();
			sequence.push({
				tick,
				state: snapshot.state,
				failures: snapshot.failures,
				pairing: snapshot.pairing.available
					? "paired"
					: `cause: ${snapshot.pairing.cause}`,
				instanceId: snapshot.instanceId,
			});
		}

		const settled = manager.getStatusSnapshot();
		assert.equal(
			settled.state,
			"attached",
			`admitted traffic keeps reviving the connection, so it never detaches. Observed: ${JSON.stringify(sequence)}`,
		);
		assert.equal(
			settled.instanceId,
			reloadedInstanceId,
			`left alone, the app must re-discover the reloaded daemon and adopt its new identity without a restart. Observed: ${JSON.stringify(sequence)}`,
		);
		assert.equal(
			settled.pairing.available,
			true,
			`and the pairing it reports must be the true one. Observed: ${JSON.stringify(sequence)}`,
		);
		assert.equal(
			manager.getOwnedPid(),
			null,
			"nothing may be spawned over a daemon this app does not own",
		);

		/* The Retry half, which pins the delta: the operator's manual press DOES
		 * clear it, by running `recoverFromDetachment()` directly. */
		const healed = await manager.reconnectNow();
		assert.equal(healed.state, "attached");
		assert.equal(healed.pairing.available, true);
		assert.equal(healed.instanceId, reloadedInstanceId);
	} finally {
		rmSync(tokenFile, { force: true });
		await manager.stop(false).catch(() => {});
		await scene.dispose();
	}
});
