import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeSync } from "node:fs";
import { test } from "node:test";
import { Script } from "node:vm";
import { headlessRefusal, provisionIncumbent } from "./incumbent-provision.mjs";

function rig({
	capable = true,
	bytecode = false,
	healthAt = Number.POSITIVE_INFINITY,
	exitAt = Number.POSITIVE_INFINITY,
	busy = false,
	backendSurvivesExit = false,
	ignoreTerm = false,
} = {}) {
	let time = 0;
	let launchedAt;
	const requests = [];
	const launches = [];
	const signals = [];
	const child = Object.assign(new EventEmitter(), {
		pid: 417,
		exitCode: null,
		signalCode: null,
		kill(signal) {
			signals.push([this.pid, signal]);
			if (signal === "SIGKILL" || !ignoreTerm) this.signalCode = signal;
			return true;
		},
	});
	return {
		requests,
		launches,
		signals,
		child,
		run: () =>
			provisionIncumbent({
				tag: "v0.57.8",
				paths: { executable: "/vm/incumbent", log: "/dev/null" },
				env: { HOME: "/vm/home" },
				checkHeadless: () =>
					headlessRefusal("/vm/incumbent/app.asar", (archive, entry) => {
						assert.equal(archive, "/vm/incumbent/app.asar");
						if (entry === "package.json")
							return Buffer.from('{"main":"./out/main/index.js"}');
						if (bytecode) {
							if (entry === "out/main/index.js")
								return Buffer.from(
									'require("./bytecode-loader.cjs");\nrequire("./index.jsc");',
								);
							assert.equal(entry, "out/main/index.jsc");
							return new Script(
								'const flags = ["--window-mode", "LOCAL_OPERATOR_UI_WINDOW_MODE", "[window-mode]"];',
							).createCachedData();
						}
						assert.equal(entry, "out/main/index.js");
						return Buffer.from(
							capable
								? "--window-mode LOCAL_OPERATOR_UI_WINDOW_MODE [window-mode]"
								: "an older main entry",
						);
					}),
				spawn(executable, args, options) {
					launches.push({ executable, args, options });
					const [stdin, stdout, stderr] = options.stdio;
					assert.equal(stdin, "ignore");
					assert.equal(stdout, stderr);
					writeSync(stdout, "incumbent stdout\n");
					writeSync(stderr, "incumbent stderr\n");
					launchedAt = time;
					return child;
				},
				async fetch(url, options) {
					requests.push({ url, options });
					const running = child.exitCode === null && child.signalCode === null;
					if (
						busy ||
						(launchedAt !== undefined &&
							time - launchedAt >= healthAt &&
							(running || backendSurvivesExit))
					)
						return { ok: true };
					throw new TypeError("fetch failed", {
						cause: { code: "ECONNREFUSED" },
					});
				},
				now: () => time,
				async sleep(ms) {
					time += ms;
					if (launchedAt !== undefined && time - launchedAt >= exitAt)
						child.exitCode = 0;
				},
				timeouts: { readiness: 1000, exit: 500, term: 500, kill: 500 },
			}),
	};
}

test("observes backend health and waits for the incumbent to exit", async () => {
	const control = rig({ bytecode: true, healthAt: 250, exitAt: 500 });
	const result = await control.run();
	assert.equal(result.verdict, "PASS");
	assert.ok(result.detail.includes("HTTP OK"), result.detail);
	assert.ok(result.detail.includes("exit 0"), result.detail);
	assert.equal(control.child.exitCode, 0);
	assert.deepEqual(control.signals, []);
	assert.deepEqual(control.launches[0].args, [
		"--window-mode=headless",
		"--use-mock-keychain",
	]);
	assert.equal(control.launches[0].options.env.HOME, "/vm/home");
	assert.equal(
		control.launches[0].options.env.LOCAL_OPERATOR_UI_TELEMETRY,
		"off",
	);
	assert.ok(
		control.requests.every(
			({ url, options }) =>
				url === "http://127.0.0.1:1111/health" && options.redirect === "error",
		),
	);
});

test("R4: exit 0 before health fails rather than treating install exit as readiness", async () => {
	const control = rig({ healthAt: 250, exitAt: 250 });
	const result = await control.run();
	assert.equal(result.verdict, "FAIL");
	assert.ok(result.detail.includes("exit 0"), result.detail);
	assert.ok(result.detail.includes("no health"), result.detail);
	assert.deepEqual(control.signals, []);
});

test("readiness timeout fails, and escalates if the owned PID ignores SIGTERM", async () => {
	const control = rig({ ignoreTerm: true });
	const result = await control.run();
	assert.equal(result.verdict, "FAIL");
	assert.ok(result.detail.includes("timed out after 1000 ms"), result.detail);
	assert.ok(result.detail.includes("no health"), result.detail);
	assert.deepEqual(control.signals, [
		[417, "SIGTERM"],
		[417, "SIGKILL"],
	]);
	assert.equal(control.child.signalCode, "SIGKILL");
});

test("health then linger still passes once the owned child is reaped", async () => {
	const control = rig({ healthAt: 250 });
	const result = await control.run();
	assert.equal(result.verdict, "PASS");
	assert.ok(result.detail.includes("HTTP OK"), result.detail);
	assert.ok(result.detail.includes("SIGTERM"), result.detail);
	assert.deepEqual(control.signals, [[417, "SIGTERM"]]);
});

test("a pre-window-mode signed app is blocked without running it", async () => {
	const control = rig({ capable: false });
	const result = await control.run();
	assert.equal(result.verdict, "BLOCKED");
	assert.ok(result.detail.includes("v0.57.8"), result.detail);
	assert.ok(
		result.detail.includes("lacks --window-mode support"),
		result.detail,
	);
	assert.deepEqual(control.launches, []);
});

test("a listener already on the health port cannot prove incumbent readiness", async () => {
	const control = rig({ busy: true });
	const result = await control.run();
	assert.equal(result.verdict, "FAIL");
	assert.ok(result.detail.includes("health port already"), result.detail);
	assert.ok(result.detail.includes("no health attributed"), result.detail);
	assert.deepEqual(control.launches, []);
});

test("a backend surviving the incumbent cannot satisfy the later candidate probe", async () => {
	const control = rig({
		healthAt: 250,
		exitAt: 500,
		backendSurvivesExit: true,
	});
	const result = await control.run();
	assert.equal(result.verdict, "FAIL");
	assert.ok(result.detail.includes("HTTP OK observed"), result.detail);
	assert.ok(result.detail.includes("not verifiably closed"), result.detail);
	assert.ok(result.detail.includes("exit 0"), result.detail);
});
