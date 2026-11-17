/**
 * `src/main/net-tos-guard.ts`: a socket type-of-service failure must reject a
 * request, never crash the main process (nodejs/undici#6075, PostHog D8).
 *
 * Two layers:
 *   - deterministic: the wrapper's contract against a stubbed original (absorb
 *     ONLY `syscall: "setTypeOfService"`, stay chainable, rethrow anything else,
 *     install once);
 *   - real path: this runtime's own `fetch` against a server that resets every
 *     connection, the reproduction from the upstream issue. The unguarded run is
 *     a control and is only REPORTED (the race fires a few times in 300, not
 *     every time); the guarded run must show zero uncaught exceptions.
 *
 * Removal probe: when the control prints `uncaught=0` across repeated runs on
 * the shipped Electron (`ELECTRON_RUN_AS_NODE=1 <electron> --test` on this file)
 * the bundled undici carries #5547 and the guard can go.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: ["src/main/net-tos-guard.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const guardSource = bundle.outputFiles[0].text;
const loadGuard = () =>
	import(
		`data:text/javascript;base64,${Buffer.from(guardSource).toString("base64")}#${Math.random()}`
	);

function einval() {
	const error = new Error("setTypeOfService EINVAL");
	error.code = "EINVAL";
	error.errno = -22;
	error.syscall = "setTypeOfService";
	return error;
}

test("absorbs only setTypeOfService failures, stays chainable, installs once", async () => {
	const proto = net.Socket.prototype;
	const pristine = proto.setTypeOfService;
	let next = null;
	proto.setTypeOfService = function stub() {
		if (next) throw next;
		return this;
	};
	try {
		const { installTypeOfServiceGuard, isTypeOfServiceFailure } =
			await loadGuard();
		const absorbed = [];
		let loggerDown = false;
		assert.equal(
			installTypeOfServiceGuard((e) => {
				absorbed.push(e);
				if (loggerDown) throw new Error("logger down");
			}),
			true,
		);
		const wrapped = proto.setTypeOfService;
		// A second install (another module instance) must not double-wrap.
		assert.equal(installTypeOfServiceGuard(), true);
		assert.equal(proto.setTypeOfService, wrapped);

		const socket = new net.Socket();
		next = einval();
		assert.equal(socket.setTypeOfService(0), socket);
		assert.equal(absorbed.length, 1);
		assert.equal(isTypeOfServiceFailure(absorbed[0]), true);

		// A logger that throws must not resurrect the crash.
		loggerDown = true;
		next = einval();
		assert.equal(socket.setTypeOfService(0), socket);
		assert.equal(absorbed.length, 2);

		// Anything else still propagates: no programming error is hidden.
		next = new TypeError("bad tos");
		assert.throws(() => socket.setTypeOfService(0), TypeError);
		next = null;
		socket.destroy();
	} finally {
		proto.setTypeOfService = pristine;
		delete proto[Symbol.for("local-operator.net-tos-guard")];
	}
});

/* The upstream reproduction, as a child so an uncaught exception in the
 * unguarded control cannot take this runner down. */
const REPRO = `
const { createServer } = require("node:http");
const { once } = require("node:events");
(async () => {
	if (process.env.GUARD_SOURCE) {
		const m = await import("data:text/javascript;base64," + process.env.GUARD_SOURCE);
		m.installTypeOfServiceGuard();
	}
	const server = createServer();
	server.on("connection", (s) => s.resetAndDestroy());
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	let uncaught = 0;
	process.on("uncaughtException", (e) => { if (e.syscall === "setTypeOfService") uncaught++; else throw e; });
	let rejected = 0;
	for (let i = 0; i < 300; i++) {
		await fetch("http://127.0.0.1:" + server.address().port + "/").catch(() => { rejected++; });
	}
	server.close();
	process.stdout.write(JSON.stringify({ rejected, uncaught }));
})();
`;

function runRepro(guarded) {
	const env = { ...process.env };
	for (const key of Object.keys(env)) if (key.startsWith("CMUX_")) delete env[key];
	if (guarded) env.GUARD_SOURCE = Buffer.from(guardSource).toString("base64");
	const result = spawnSync(process.execPath, ["-e", REPRO], {
		env,
		encoding: "utf8",
		timeout: 120_000,
	});
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

test("real fetch against resetting server: guarded run has no uncaught EINVAL", () => {
	const control = runRepro(false);
	const guarded = runRepro(true);
	console.log(
		`node=${process.versions.node} undici=${process.versions.undici} control uncaught=${control.uncaught} guarded uncaught=${guarded.uncaught} guarded rejected=${guarded.rejected}/300`,
	);
	assert.equal(guarded.uncaught, 0);
	// Every request still FAILS - the guard turns a crash into a rejection, it
	// does not make a dead socket succeed.
	assert.equal(guarded.rejected, 300);
});
