import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { fstatSync, readFileSync, writeSync } from "node:fs";
import { test } from "node:test";
import { provisionIncumbent } from "./incumbent-provision.mjs";

function rig({
	ignoresWindowMode = false,
	healthAt = Number.POSITIVE_INFINITY,
	exitAt = Number.POSITIVE_INFINITY,
	busy = false,
	backendSurvivesExit = false,
	ignoreTerm = false,
	exitBeforeTerm = false,
	inFlight,
	onSleep,
	defaultTimeouts = false,
} = {}) {
	let time = 0;
	let launchedAt;
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
			if (signal === "SIGKILL" || !ignoreTerm) this.signalCode = signal;
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
				async fetch(url, options) {
					requests.push({ url, options });
					if (launchedAt !== undefined && requests.length === 2 && inFlight)
						return inFlight({ child, signalTarget, launches, options });
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
					onSleep?.({ signalTarget, signals });
					if (launchedAt !== undefined && time - launchedAt >= exitAt)
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
		result.detail.includes("exited before readiness was confirmed (exit 0)"),
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

test("cancellation shortens an already-running normal shutdown grace", async () => {
	const control = rig({
		defaultTimeouts: true,
		ignoreTerm: true,
		healthAt: 250,
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
