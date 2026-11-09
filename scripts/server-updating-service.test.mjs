/**
 * The server-update window, driven through the REAL `BackendServiceManager`.
 *
 * WHY A SEPARATE FILE (review round 1, m1/m2). `server-updating.test.mjs` pins
 * the state machine, the transport rewrite and the renderer in isolation, so the
 * glue between them - the fence branch of `requestDesktop` and
 * `requestDesktopMedia`, the one-push-per-episode rule, the expiry push, the
 * tick pushing when `updating` alone changes, and the post-cap relay - could be
 * reverted with every case there still green. This bundles the manager with the
 * same electron/logger/config fixtures `daemon-observation.test.mjs` uses, but
 * stubs `fetch` and swaps in a state machine with an injected clock: no daemon
 * is started, no port is opened and nothing waits out a real 60 s window.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

const RE_ELECTRON = /^electron$/;
const RE_FIXTURE = /^(electron|logger-fixture|config-fixture)$/;
const RE_LOGGER = /^\.\/logger$/;
const RE_CONFIG = /^\.\/config$/;

const HOME = mkdtempSync(join(tmpdir(), "server-updating-service-"));
after(() => rmSync(HOME, { recursive: true, force: true }));
Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_DESKTOP_TOKEN");
// Synthetic and unreachable: every request below is answered by the `fetch`
// stub, never by a socket.
globalThis.__testConfiguredUrl = "http://127.0.0.1:1";

const bundle = await build({
	stdin: {
		contents: [
			'export { BackendServiceManager } from "./src/main/backend/backend-service.ts";',
			'export { DaemonStateMachine, SERVER_UPDATING_CAP_MS, SERVER_UPDATING_EXTEND_MS } from "./src/main/backend/daemon-status.ts";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	logLevel: "silent",
	plugins: [
		{
			name: "main-process-fixtures",
			setup(builder) {
				builder.onResolve({ filter: RE_ELECTRON }, () => ({
					path: "electron",
					namespace: "fixture",
				}));
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
				builder.onLoad({ filter: RE_FIXTURE, namespace: "fixture" }, (args) => {
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
							const quiet = () => {};
							export const logger = { info: quiet, warn: quiet, error: quiet, debug: quiet, verbose: quiet };
						`,
						"config-fixture": `
							export const backendConfig = {
								get VITE_LOCAL_OPERATOR_API_URL() { return globalThis.__testConfiguredUrl; },
								get VITE_DISABLE_BACKEND_MANAGER() { return "false"; },
							};
						`,
					};
					return { contents: sources[args.path], loader: "js" };
				});
			},
		},
	],
});

const {
	BackendServiceManager,
	DaemonStateMachine,
	SERVER_UPDATING_CAP_MS,
	SERVER_UPDATING_EXTEND_MS,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const FENCE = "service is preparing a safe reload; retry shortly";
const PLANE_CLOSED =
	"Desktop controls require a backend started by the desktop app.";
const identity = {
	url: "http://127.0.0.1:1",
	pid: process.pid, // alive, so the tick's pid check never fires
	version: "0.0.0-synthetic",
	instanceId: "inst-synthetic-a",
};
const json = (status, body) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", "retry-after": "1" },
	});

/**
 * A manager with an injected clock and a push recorder. The private fields are
 * plain properties at runtime; replacing `daemonState` is the injection point
 * the class's own tests use for time, and `desktopToken` is what a claim sets.
 */
const scene = () => {
	const clock = { now: 5_000_000 };
	const manager = new BackendServiceManager();
	manager.daemonState = new DaemonStateMachine(() => clock.now);
	manager.daemonState.attach(identity, { owned: false });
	manager.desktopToken = "synthetic-not-a-real-token";
	const pushes = [];
	manager.onStatusChange((snapshot) => pushes.push(snapshot.updating === true));
	return { manager, clock, pushes };
};

const withFetch = async (respond, run) => {
	const original = globalThis.fetch;
	globalThis.fetch = async () => respond();
	try {
		return await run();
	} finally {
		globalThis.fetch = original;
	}
};

const list = { op: "sessions.list", limit: 1 };

test("requestDesktop: a fence opens the window with ONE push, and follow-on 503s carry the hint", async () => {
	const { manager, pushes } = scene();
	const first = await withFetch(
		() => json(503, { detail: FENCE }),
		() => manager.requestDesktop(list),
	);
	assert.equal(first.status, 503);
	assert.equal(first.body.detail.code, "transient.server-updating");
	assert.deepEqual(pushes, [true], "the episode's opening push");
	await withFetch(
		() => json(503, { detail: FENCE }),
		() => manager.requestDesktop(list),
	);
	assert.deepEqual(pushes, [true], "later fences extend without pushing");
	// The claimed daemon's plane-closed tail, inside the window: code kept,
	// display-only hint added (markUpdating, applied only while the window is open).
	const tail = await withFetch(
		() => json(503, { detail: PLANE_CLOSED }),
		() => manager.requestDesktop(list),
	);
	assert.equal(tail.body.detail.updating, true);
	assert.equal(tail.body.detail.message, PLANE_CLOSED);
	manager.serverUpdatingTimer && clearTimeout(manager.serverUpdatingTimer);
});

test("requestDesktop: outside the window a plane-closed 503 is relayed untouched (negative)", async () => {
	const { manager, pushes } = scene();
	const plain = await withFetch(
		() => json(503, { detail: PLANE_CLOSED }),
		() => manager.requestDesktop(list),
	);
	assert.equal(plain.body.detail, PLANE_CLOSED);
	assert.deepEqual(pushes, []);
});

test("requestDesktop: past the cap the fence is a real failure, never 'back in a moment' (M2)", async () => {
	const { manager, clock } = scene();
	const fence = () =>
		withFetch(
			() => json(503, { detail: FENCE }),
			() => manager.requestDesktop(list),
		);
	await fence();
	const start = clock.now;
	for (let t = 10_000; t < SERVER_UPDATING_CAP_MS; t += 10_000) {
		clock.now = start + t;
		assert.equal(
			(await fence()).body.detail.code,
			"transient.server-updating",
			`inside the window at ${t / 1000}s`,
		);
	}
	clock.now = start + SERVER_UPDATING_CAP_MS;
	const stalled = await fence();
	assert.equal(stalled.status, 503);
	assert.equal(stalled.body.detail.code, "transport.failed");
	assert.equal(stalled.body.detail.update_stalled, true);
	assert.equal(manager.getStatusSnapshot().updating, false);
	assert.equal(manager.serverUpdatingTimer, null, "no timer past the cap");
});

test("the expiry timer pushes the reverted snapshot when the window lapses", async () => {
	const { manager, clock, pushes } = scene();
	const fence = () =>
		withFetch(
			() => json(503, { detail: FENCE }),
			() => manager.requestDesktop(list),
		);
	await fence();
	const start = clock.now;
	// Land a fence 20 ms (fake) before the cap so the re-armed timer is ~70 ms real.
	clock.now = start + SERVER_UPDATING_CAP_MS - 20;
	await fence();
	clock.now = start + SERVER_UPDATING_CAP_MS;
	await new Promise((resolve) => setTimeout(resolve, 250));
	assert.deepEqual(pushes, [true, false], "opened, then lapsed");
});

test("the health tick pushes when ONLY `updating` changes (M1: spinner cleared on landing)", async () => {
	const { manager, pushes } = scene();
	await withFetch(
		() => json(503, { detail: FENCE }),
		() => manager.requestDesktop(list),
	);
	assert.deepEqual(pushes, [true]);
	// The reload landed: same pid, new instance id. The state was `attached`
	// before and after, and the detail is unchanged too - `updating` is the only
	// news, which the tick used to drop.
	const reloaded = { ...identity, instanceId: "inst-synthetic-b" };
	const before = manager.daemonState.snapshot().detail;
	manager.probeAttachedDaemon = async () => ({
		kind: "reanchored",
		identity: reloaded,
		detail: before,
	});
	manager.recoverBrokenPairing = async () => {};
	await manager.checkBackendHealth();
	assert.equal(manager.getStatusSnapshot().updating, false);
	assert.equal(pushes.at(-1), false, "the tick pushed the cleared window");
	manager.serverUpdatingTimer && clearTimeout(manager.serverUpdatingTimer);
});

test("an `identified` tick during the fence keeps the window (M1)", async () => {
	const { manager, pushes } = scene();
	await withFetch(
		() => json(503, { detail: FENCE }),
		() => manager.requestDesktop(list),
	);
	manager.probeAttachedDaemon = async () => ({ kind: "identified" });
	await manager.checkBackendHealth();
	assert.equal(manager.getStatusSnapshot().updating, true);
	assert.deepEqual(pushes, [true], "no flap");
	manager.serverUpdatingTimer && clearTimeout(manager.serverUpdatingTimer);
});

test("requestDesktopMedia: the fence opens the same window; past the cap it is a real failure (m2/M2)", async () => {
	const { manager, clock, pushes } = scene();
	const media = () =>
		withFetch(
			() => json(503, { detail: FENCE }),
			() =>
				manager.requestDesktopMedia(
					{ op: "speech.create", request: { text: "hello" } },
					null,
				),
		);
	const first = await media();
	assert.equal(first.kind, "error");
	assert.equal(first.code, "transient.server-updating");
	assert.deepEqual(pushes, [true]);
	// Liveness was recorded too - the same order as the JSON path.
	assert.notEqual(manager.getStatusSnapshot().lastTransportAt, null);
	clock.now += SERVER_UPDATING_CAP_MS;
	const stalled = await media();
	assert.equal(stalled.code, "transport.failed");
	assert.equal(manager.getStatusSnapshot().updating, false);
	assert.ok(SERVER_UPDATING_EXTEND_MS <= SERVER_UPDATING_CAP_MS);
});
