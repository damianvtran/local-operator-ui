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
	const argv = [
		"/Applications/Local Operator.app/Contents/MacOS/Local Operator",
	];
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
	assert.notEqual(
		call,
		-1,
		"index.ts no longer registers the dev driver at all",
	);
	const guard = main.lastIndexOf("if (devDriverArming.armed", call);
	assert.notEqual(
		guard,
		-1,
		"registerDevDriverIPC is not behind the arming decision",
	);
	assert.ok(
		call - guard < 200,
		"the arming check and the registration drifted apart; re-read the guard",
	);
	assert.match(
		main.slice(guard, call),
		/if \(devDriverArming\.armed && devDriverArming\.outDir\)/,
		"the registration is not the armed branch's",
	);

	const ipc = readFileSync(
		join(process.cwd(), "src/main/dev-driver-ipc.ts"),
		"utf8",
	);
	// One `handle` per channel, and no third one appearing unnoticed.
	assert.equal(
		(ipc.match(/ipcMain\.handle\(/g) ?? []).length,
		2,
		"dev-driver-ipc.ts registers a channel count this file does not expect",
	);
	const preload = readFileSync(
		join(process.cwd(), "src/preload/index.ts"),
		"utf8",
	);
	assert.match(
		preload,
		/installDevDriverBridge\(\);/,
		"the preload no longer tries to install the bridge",
	);
});

/*
 * R1: the opt-in is a fact about the LAUNCH, so it is resolved from an
 * environment snapshot taken before this repository's own `.env` is folded in.
 *
 * `src/main/backend/config.ts` runs dotenv with `override: true` at import time,
 * so from that line onward `process.env` is "the launch, with a file at the cwd
 * folded in, and the file wins" — and reading the opt-in from it meant a
 * gitignored `.env` could arm a control surface on a trusted process and beat an
 * explicit `LOCAL_OPERATOR_UI_DEV_DRIVER=0` typed at the shell.
 *
 * These two cases are source assertions rather than imports, because the fold
 * happens at import time in a module that reaches Electron and cannot be loaded
 * in a bare `node --test` process. The property itself is measured on REAL boots
 * by `node scripts/renderer-driver.mjs --gate-check`, which now boots four
 * inert launches — nothing set anywhere, a cwd `.env` carrying the opt-in, and
 * that same file carrying it while the environment says `=0` — and asserts no
 * bridge, no channel, no frame and no banner in each. What is pinned here is the
 * wiring those boots depend on, because a refactor that moved the read back to
 * `process.env` would leave every other test in this file passing.
 */
test("the launch environment is snapshotted before the .env is folded in", () => {
	/*
	 * The snapshot itself lives in `./launch-env` — it has to, because `logger.ts`
	 * reads a launch fact and cannot import `config.ts` back without a cycle — so
	 * this case asserts the two halves of the ordering rather than one statement's
	 * position: `config.ts` imports the snapshot module STATICALLY (a dependency is
	 * evaluated before the importing module's body, so the copy is taken before the
	 * fold in that body), and the module it imports is a leaf that imports nothing.
	 */
	const config = readFileSync(
		join(process.cwd(), "src/main/backend/config.ts"),
		"utf8",
	);
	const snapshotImport = config.indexOf('from "./launch-env"');
	const fold = config.indexOf("dotenvConfig({");
	assert.notEqual(
		snapshotImport,
		-1,
		"backend/config.ts no longer imports the launch snapshot",
	);
	assert.notEqual(
		fold,
		-1,
		"backend/config.ts no longer calls dotenvConfig; re-read this test",
	);
	assert.ok(
		snapshotImport < fold,
		"the .env fold comes before the snapshot import, so the snapshot is not a record of the launch",
	);
	assert.match(
		config,
		/export \{ launchEnv \};/,
		"backend/config.ts no longer re-exports launchEnv, which is where the launch facts are resolved from",
	);

	const snapshot = readFileSync(
		join(process.cwd(), "src/main/backend/launch-env.ts"),
		"utf8",
	);
	assert.doesNotMatch(
		snapshot,
		/^import /m,
		"the snapshot module must stay a leaf: an import in it is how it stops being evaluated before the fold",
	);
	/*
	 * A copy, not a live view: `process.env` is mutated by the dotenv call in
	 * `config.ts`, and a snapshot that kept referring to it would carry the file's
	 * values anyway.
	 */
	assert.match(
		snapshot,
		/export const launchEnv: Record<string, string \| undefined> = \{\s*\.\.\.process\.env,?\s*\}/,
		"launchEnv is not a copy of process.env",
	);
});

test("both launch facts are resolved from that snapshot, not the folded process.env", () => {
	const main = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8");
	for (const resolver of [
		"resolveWindowLaunchPlan({",
		"resolveDevDriverArming({",
	]) {
		const at = main.indexOf(resolver);
		assert.notEqual(at, -1, `index.ts no longer calls ${resolver}`);
		assert.match(
			main.slice(at, at + 400),
			/\n\tenv: launchEnv,/,
			`${resolver} must read launchEnv: a cwd .env must not be able to arm the driver or set a window mode that raises a window`,
		);
	}
	assert.doesNotMatch(
		main,
		/env: process\.env,/,
		"a launch fact is resolved from process.env again, which is the folded one",
	);
});
