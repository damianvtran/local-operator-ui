import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * Contract checks for the renderer dev driver's opt-in.
 *
 * Why these cases: the driver exists so an agent can drive the real renderer
 * (see `docs/agent-driver.md`), and the property that makes it safe to ship in
 * the app is that a launch which did not ask for it is inert — no channel
 * registered, no bridge in the renderer, nothing to reach. That is a property of
 * `resolveDevDriverArming`, so it is asserted here in process: the module imports
 * nothing from Electron, exactly as `window-mode.ts` does not, which is what
 * makes a decision that normally needs a whole app testable in milliseconds.
 *
 * The real boot is measured too, by `node scripts/renderer-driver.mjs
 * --gate-check`: an unarmed launch must paint normally, expose no
 * `window.__loDevDriver`, and have main refuse `dev-driver-capture` with
 * Electron's own "No handler registered". This file cannot see any of that, and
 * does not pretend to — it pins the decision those boot assertions depend on.
 *
 * The module is bundled in memory from the shipped TypeScript, the same way
 * `window-mode.test.mjs` does, so these stay tests of the code that ships.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/dev-driver";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	DEV_DRIVER_ARG,
	DEV_DRIVER_CAPTURE,
	DEV_DRIVER_ENV,
	DEV_DRIVER_FACTS,
	DEV_DRIVER_OUT_ENV,
	DEV_DRIVER_WORLD_KEY,
	describeDevDriverArming,
	devDriverArgument,
	readDevDriverArgument,
	resolveDevDriverArming,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

const OUT = "/tmp/lo-dev-driver-frames";

/** The launch a person makes: no opt-in in the environment, an ordinary window. */
const normalLaunch = {
	env: {},
	windowMode: "normal",
};

test("a launch that did not ask for the driver is inert, and says nothing", () => {
	const arming = resolveDevDriverArming(normalLaunch);
	assert.equal(arming.armed, false);
	assert.equal(arming.outDir, null);
	// No problems, because nothing was set: the banner stays silent in a normal
	// launch rather than explaining a feature the operator did not invoke.
	assert.deepEqual(arming.problems, []);
	assert.equal(describeDevDriverArming(arming), null);
});

test("nothing arms the driver without the opt-in, in any window mode", () => {
	// The fail-closed claim, as a matrix rather than as one case. The signature
	// carries no argv at all now — the opt-in is ONE environment variable, and
	// `resolveDevDriverArming` cannot see a command line to be talked into by —
	// but this states the property for every input it CAN see.
	for (const windowMode of ["normal", "headless", "inactive"]) {
		for (const env of [
			{},
			{ [DEV_DRIVER_OUT_ENV]: OUT },
			{ [DEV_DRIVER_ENV]: "", [DEV_DRIVER_OUT_ENV]: OUT },
			{ [DEV_DRIVER_ENV]: "   ", [DEV_DRIVER_OUT_ENV]: OUT },
			{ [DEV_DRIVER_ENV]: "0", [DEV_DRIVER_OUT_ENV]: OUT },
		]) {
			const arming = resolveDevDriverArming({ env, windowMode });
			assert.equal(
				arming.armed,
				false,
				`armed with env=${JSON.stringify(env)} mode=${windowMode}`,
			);
		}
	}
});

test("a typo is refused loudly rather than ignored", () => {
	for (const value of ["yes", "on", "0", "false", "TRUEISH", "1 "]) {
		const arming = resolveDevDriverArming({
			...normalLaunch,
			env: { [DEV_DRIVER_ENV]: value, [DEV_DRIVER_OUT_ENV]: OUT },
			windowMode: "headless",
		});
		// "1 " trims to the accepted value, so it arms; everything else is refused
		// with a problem naming what IS accepted. Either way the value is never
		// silently obeyed.
		if (value.trim() === "1") {
			assert.equal(arming.armed, true, `${value} should arm`);
			continue;
		}
		assert.equal(arming.armed, false, `${value} must not arm`);
		assert.match(arming.problems.join(" "), /not an opt-in/);
		assert.match(arming.problems.join(" "), /1, true/);
	}
});

test("the opt-in alone does not arm: a frames directory is required", () => {
	for (const out of [undefined, "", "relative/frames", "./frames"]) {
		const arming = resolveDevDriverArming({
			...normalLaunch,
			env: { [DEV_DRIVER_ENV]: "1", [DEV_DRIVER_OUT_ENV]: out },
			windowMode: "headless",
		});
		assert.equal(arming.armed, false, `armed with out=${String(out)}`);
		assert.match(arming.problems.join(" "), /absolute frames directory/);
		// The refusal is printed: a driver run that silently has no bridge reads
		// exactly like a harness bug.
		assert.match(String(describeDevDriverArming(arming)), /not armed/);
	}
});

test("the driver never arms behind a window that could be raised", () => {
	const arming = resolveDevDriverArming({
		...normalLaunch,
		env: { [DEV_DRIVER_ENV]: "1", [DEV_DRIVER_OUT_ENV]: OUT },
	});
	assert.equal(arming.armed, false);
	assert.match(arming.problems.join(" "), /window-mode=headless/);
});

test("headless and inactive arm, and the banner names the frames directory", () => {
	for (const [source, env] of [
		["1", { [DEV_DRIVER_ENV]: "1", [DEV_DRIVER_OUT_ENV]: OUT }],
		["true", { [DEV_DRIVER_ENV]: "true", [DEV_DRIVER_OUT_ENV]: OUT }],
		["TRUE", { [DEV_DRIVER_ENV]: "TRUE", [DEV_DRIVER_OUT_ENV]: OUT }],
	]) {
		for (const windowMode of ["headless", "inactive"]) {
			const arming = resolveDevDriverArming({ env, windowMode });
			assert.equal(arming.armed, true, `${source} should arm in ${windowMode}`);
			assert.equal(arming.outDir, OUT);
			assert.deepEqual(arming.problems, []);
			assert.equal(
				describeDevDriverArming(arming),
				`[dev-driver] ARMED; frames are written to ${OUT}`,
			);
		}
	}
});

test("the preload's argument round-trips, and unintelligible is the same as absent", () => {
	const argv = ["/Applications/Local Operator.app/Contents/MacOS/Local Operator"];
	assert.equal(devDriverArgument(OUT), `${DEV_DRIVER_ARG}=${OUT}`);
	assert.deepEqual(readDevDriverArgument([...argv, devDriverArgument(OUT)]), {
		outDir: OUT,
	});
	for (const argvCase of [
		argv,
		[...argv, DEV_DRIVER_ARG],
		[...argv, `${DEV_DRIVER_ARG}=`],
		[...argv, `${DEV_DRIVER_ARG}=relative`],
		[...argv, `--something-else=${OUT}`],
	]) {
		assert.equal(
			readDevDriverArgument(argvCase),
			null,
			`argv ${JSON.stringify(argvCase)} must not yield a frames directory`,
		);
	}
});

test("the channel and world names are pinned, because a boot assertion greps them", () => {
	// `scripts/renderer-driver.mjs --gate-check` asserts Electron's own refusal
	// text for the capture channel, and the world key is what the renderer's
	// install module looks for. A rename that skipped this file would leave the
	// harness asserting a channel nothing registers any more — and passing.
	assert.equal(DEV_DRIVER_CAPTURE, "dev-driver-capture");
	assert.equal(DEV_DRIVER_FACTS, "dev-driver-facts");
	assert.equal(DEV_DRIVER_WORLD_KEY, "__loDevDriver");
	assert.equal(DEV_DRIVER_ARG, "--lo-dev-driver");
	assert.equal(DEV_DRIVER_ENV, "LOCAL_OPERATOR_UI_DEV_DRIVER");
	assert.equal(DEV_DRIVER_OUT_ENV, "LOCAL_OPERATOR_UI_DEV_DRIVER_OUT");
});

test("nothing in main registers a dev-driver channel outside the armed branch", () => {
	/*
	 * A structural guard, in the spirit of `window-mode.test.mjs`'s "no other
	 * file raises a window": the channels may only be registered by
	 * `registerDevDriverIPC`, and `index.ts` may only call it behind the arming
	 * decision. A future edit that registered a handler unconditionally would
	 * leave every other test in this file passing while a normal launch carried
	 * a reachable capture channel.
	 */
	const main = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8");
	const call = main.indexOf("registerDevDriverIPC({");
	assert.notEqual(call, -1, "index.ts no longer registers the dev driver at all");
	const guard = main.lastIndexOf("if (devDriverArming.armed", call);
	assert.notEqual(guard, -1, "registerDevDriverIPC is not behind the arming decision");
	assert.ok(
		call - guard < 200,
		"the arming check and the registration drifted apart; re-read the guard",
	);
	assert.match(
		main.slice(guard, call),
		/if \(devDriverArming\.armed && devDriverArming\.outDir\)/,
		"the registration is not the armed branch's",
	);

	const ipc = readFileSync(join(process.cwd(), "src/main/dev-driver-ipc.ts"), "utf8");
	// One `handle` per channel, and no third one appearing unnoticed.
	assert.equal(
		(ipc.match(/ipcMain\.handle\(/g) ?? []).length,
		2,
		"dev-driver-ipc.ts registers a channel count this file does not expect",
	);
	const preload = readFileSync(join(process.cwd(), "src/preload/index.ts"), "utf8");
	assert.match(
		preload,
		/installDevDriverBridge\(\);/,
		"the preload no longer tries to install the bridge",
	);
});
