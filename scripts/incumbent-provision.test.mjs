import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { fstatSync, readFileSync, writeSync } from "node:fs";
import { test } from "node:test";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { provisionIncumbent } from "./incumbent-provision.mjs";

function rig({
	ignoresWindowMode = false,
	healthAt = Number.POSITIVE_INFINITY,
	exitAt = Number.POSITIVE_INFINITY,
	busy = false,
	backendSurvivesExit = false,
	ignoreTerm = false,
	exitBeforeTerm = false,
	cleanExitOnTerm = false,
	cooperative = false,
	inFlight,
	shutdownProbe,
	onSleep,
	defaultTimeouts = false,
} = {}) {
	let time = 0;
	let launchedAt;
	let cleanExitAt;
	const signalTarget = new EventEmitter();
	const requests = [];
	const launches = [];
	const signals = [];
	const child = Object.assign(new EventEmitter(), {
		pid: 417,
		exitCode: null,
		signalCode: null,
		kill(signal) {
			if (signal === "SIGTERM" && exitBeforeTerm) {
				this.exitCode = 0;
				return false; // The PID exited before the signal could be sent.
			}
			signals.push([this.pid, signal]);
			if (signal === "SIGTERM" && cleanExitOnTerm) cleanExitAt = time + 500;
			else if (signal === "SIGKILL" || !ignoreTerm) this.signalCode = signal;
			return true;
		},
	});
	return {
		requests,
		launches,
		signals,
		child,
		signalTarget,
		now: () => time,
		run: () =>
			provisionIncumbent({
				tag: "v0.57.8",
				paths: { executable: "/vm/incumbent", log: "/dev/null" },
				env: { HOME: "/vm/home" },
				spawn(executable, args, options) {
					// Model the pre-R4 app: closing the setup window quits only
					// if headless was recognised. Older apps ignore window mode.
					const windowMode = ignoresWindowMode
						? "normal"
						: args
								.find((arg) => arg.startsWith("--window-mode="))
								?.split("=")[1];
					launches.push({ executable, args, options, windowMode });
					if (windowMode === "headless") child.exitCode = 0;
					const [stdin, stdout, stderr] = options.stdio;
					assert.equal(stdin, "ignore");
					assert.equal(stdout, stderr);
					writeSync(stdout, "incumbent stdout\n");
					writeSync(stderr, "incumbent stderr\n");
					launchedAt = time;
					return child;
				},
				signalTarget,
				isLive: (child) => child.exitCode === null && child.signalCode === null,
				async fetch(url, options) {
					requests.push({ url, options });
					if (launchedAt !== undefined && requests.length === 2 && inFlight)
						return inFlight({ child, signalTarget, launches, options });
					if (signals.length && shutdownProbe) return shutdownProbe(options);
					const running = child.exitCode === null && child.signalCode === null;
					if (
						busy ||
						(launchedAt !== undefined &&
							time - launchedAt >= healthAt &&
							(running || backendSurvivesExit) &&
							!(cooperative && cleanExitAt !== undefined))
					)
						return { ok: true };
					throw new TypeError("fetch failed", {
						cause: { code: "ECONNREFUSED" },
					});
				},
				now: () => time,
				async sleep(ms) {
					// Let the async shutdown probe observe the closed port before
					// advancing the fake clock through the clean exit.
					if (cleanExitAt !== undefined) await new Promise(setImmediate);
					time += ms;
					onSleep?.({ signalTarget, signals });
					if (
						time >= cleanExitAt ||
						(launchedAt !== undefined && time - launchedAt >= exitAt)
					)
						child.exitCode = 0;
				},
				timeouts: defaultTimeouts
					? undefined
					: { readiness: 1000, exit: 500, term: 500, kill: 500 },
			}),
	};
}

test("observes backend health before initiating incumbent shutdown", async () => {
	const control = rig({ healthAt: 250 });
	const result = await control.run();
	assert.equal(result.verdict, "PASS");
	assert.ok(result.detail.includes("HTTP OK"), result.detail);
	assert.ok(result.detail.includes("signal SIGTERM"), result.detail);
	assert.equal(control.child.signalCode, "SIGTERM");
	assert.deepEqual(control.signals, [[417, "SIGTERM"]]);
	assert.deepEqual(control.launches[0].args, [
		"--window-mode=inactive",
		MOCK_KEYCHAIN_SWITCH,
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

test("a cooperative exit needs backend closure while the owned PID is still live", async () => {
	const control = rig({
		healthAt: 250,
		cleanExitOnTerm: true,
		cooperative: true,
	});
	const result = await control.run();
	assert.equal(result.verdict, "PASS", result.detail);
	assert.ok(
		result.detail.includes(
			"backend closed after SIGTERM while the incumbent was still alive",
		),
		result.detail,
	);
	assert.deepEqual(control.signals, [[417, "SIGTERM"]]);
});

test("a successful kill call and clean exit do not substitute for a shutdown witness", async () => {
	const control = rig({ healthAt: 250, cleanExitOnTerm: true });
	const result = await control.run();
	assert.equal(result.verdict, "FAIL", result.detail);
	assert.ok(
		result.detail.includes(
			"no attributable incumbent shutdown was witnessed (exit 0)",
		),
		result.detail,
	);
	assert.deepEqual(control.signals, [[417, "SIGTERM"]]);
});

test("R4: exit 0 before health fails rather than treating install exit as readiness", async () => {
	const control = rig({ healthAt: 250, exitAt: 250 });
	const result = await control.run();
	assert.equal(result.verdict, "FAIL");
	assert.ok(result.detail.includes("exit 0"), result.detail);
	assert.ok(result.detail.includes("no health seen"), result.detail);
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

test("an OK does not pass if the child exits before our SIGTERM can be sent", async () => {
	const control = rig({ healthAt: 250, exitBeforeTerm: true });
	const result = await control.run();
	assert.equal(result.verdict, "FAIL");
	assert.ok(
		result.detail.includes(
			"exited before readiness was confirmed or was not verifiably live (exit 0)",
		),
		result.detail,
	);
	assert.deepEqual(control.signals, []);
});

test("an older incumbent that ignores inactive mode can still provision", async () => {
	const control = rig({ ignoresWindowMode: true, healthAt: 250 });
	const result = await control.run();
	assert.equal(result.verdict, "PASS");
	assert.ok(result.detail.includes("HTTP OK"), result.detail);
	assert.equal(control.launches.length, 1);
	assert.equal(control.launches[0].windowMode, "normal");
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
		backendSurvivesExit: true,
	});
	const result = await control.run();
	assert.equal(result.verdict, "FAIL");
	assert.ok(result.detail.includes("HTTP OK observed"), result.detail);
	assert.ok(result.detail.includes("not verifiably closed"), result.detail);
	assert.ok(result.detail.includes("signal SIGTERM"), result.detail);
});

test("rejects an OK received after the incumbent exits during the probe", async () => {
	const control = rig({
		async inFlight({ child }) {
			const exited = Promise.withResolvers();
			child.once("exit", exited.resolve);
			child.exitCode = 0;
			child.emit("exit", 0, null);
			await exited.promise;
			return { ok: true };
		},
	});
	const result = await control.run();
	assert.equal(result.verdict, "FAIL");
	assert.ok(
		result.detail.includes("exited before readiness was confirmed (exit 0)"),
		result.detail,
	);
	assert.deepEqual(control.signals, []);
});

test(
	"Darwin: an unreaped Node child cannot confer readiness",
	{ skip: process.platform !== "darwin" },
	async () => {
		let child;
		let requests = 0;
		let beforeOK;
		const requestsToSignal = [];
		const result = await provisionIncumbent({
			tag: "node-zombie",
			paths: { executable: process.execPath, log: "/dev/null" },
			env: {},
			signalTarget: new EventEmitter(),
			spawn(executable, _args, options) {
				child = spawn(executable, ["-e", "process.exit(0)"], options);
				const kill = child.kill.bind(child);
				child.kill = (signal) => {
					requestsToSignal.push(signal);
					return kill(signal);
				};
				return child;
			},
			async fetch() {
				if (++requests === 2) {
					// Keep the JS event loop on this stack until Darwin marks the
					// child Z. Yielding here would let Node observe/reap it first.
					const deadline = performance.now() + 1_000;
					let state;
					do {
						state = spawnSync(
							"/bin/ps",
							["-o", "stat=", "-p", String(child.pid)],
							{
								encoding: "utf8",
							},
						).stdout.trim();
					} while (!state.startsWith("Z") && performance.now() < deadline);
					beforeOK = {
						state,
						exitCode: child.exitCode,
						signalCode: child.signalCode,
					};
					return { ok: true };
				}
				throw new TypeError("fetch failed", {
					cause: { code: "ECONNREFUSED" },
				});
			},
		});
		assert.ok(beforeOK?.state.startsWith("Z"), JSON.stringify(beforeOK));
		assert.equal(beforeOK.exitCode, null);
		assert.equal(beforeOK.signalCode, null);
		assert.equal(result.verdict, "FAIL", result.detail);
		assert.equal(requests, 2, result.detail);
		assert.ok(
			result.detail.includes("exited before readiness was confirmed"),
			result.detail,
		);
		assert.deepEqual(requestsToSignal, []);
		assert.equal(child.exitCode, 0);
		assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
	},
);

for (const signal of ["SIGTERM", "SIGINT"]) {
	test(`${signal} during provisioning reaps the exact PID and closes the log`, async () => {
		let fd;
		const control = rig({
			ignoreTerm: true,
			inFlight({ signalTarget, launches, options }) {
				fd = launches[0].options.stdio[1];
				return new Promise((resolve, reject) => {
					options.signal.addEventListener(
						"abort",
						() => reject(options.signal.reason),
						{ once: true },
					);
					queueMicrotask(() => {
						signalTarget.emit(signal);
						resolve({ ok: true }); // Negative control if the signal is not wired.
					});
				});
			},
		});
		const result = await control.run();
		assert.equal(result.verdict, "FAIL");
		assert.match(result.detail, new RegExp(`cancelled by ${signal}`));
		assert.deepEqual(control.signals, [
			[417, "SIGTERM"],
			[417, "SIGKILL"],
		]);
		assert.equal(control.child.signalCode, "SIGKILL");
		assert.equal(control.requests.length, 2);
		assert.throws(() => fstatSync(fd), { code: "EBADF" });
		assert.equal(control.signalTarget.listenerCount(signal), 0);
	});
}

test("cancellation aborts the shutdown probe and shortens normal shutdown grace", async () => {
	const probes = [];
	const control = rig({
		defaultTimeouts: true,
		ignoreTerm: true,
		healthAt: 250,
		shutdownProbe({ signal }) {
			probes.push(signal);
			return new Promise((_, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
			});
		},
		onSleep({ signalTarget, signals }) {
			if (signals.length === 1) signalTarget.emit("SIGTERM");
		},
	});
	const result = await control.run();
	assert.ok(result.detail.includes("cancelled by SIGTERM"), result.detail);
	assert.deepEqual(control.signals, [
		[417, "SIGTERM"],
		[417, "SIGKILL"],
	]);
	assert.equal(probes.length, 1);
	assert.equal(probes[0].reason.message, "cancelled by SIGTERM");
	assert.equal(control.now(), 1_500); // 250 to health + 250 to cancellation + 1000 TERM grace.
});

test("allows five minutes of installer setup followed by backend startup", async () => {
	const result = await rig({ defaultTimeouts: true, healthAt: 419_750 }).run();
	assert.equal(result.verdict, "PASS", result.detail);
});

test("candidate health gets the rebuild allowance even with an inherited marker", async () => {
	const source = readFileSync(
		new URL("./verify-signed-update.mjs", import.meta.url),
		"utf8",
	);
	assert.ok(
		!source.includes("selected external runtime reused"),
		"inherited marker must not be reported as reuse",
	);
	assert.ok(
		!source.includes("return existsSync(path) && JSON.parse"),
		"the marker must not be a gating wait",
	);
	assert.ok(source.includes("readiness.firstBootMs : readiness.secondBootMs"));
	assert.ok(source.includes("${readiness.selectionCaveat}"));
	const { candidateReadiness } = await import("./incumbent-provision.mjs");
	const plan = candidateReadiness(true);
	assert.equal(plan.firstBootMs, 720_000);
	assert.equal(plan.secondBootMs, 120_000);
	assert.ok(
		plan.selectionCaveat.includes(
			"inherited before candidate boot; not evidence",
		),
	);
	assert.ok(candidateReadiness(false).selectionCaveat.includes("no inherited"));
});
