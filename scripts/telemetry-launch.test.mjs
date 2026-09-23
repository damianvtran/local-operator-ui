import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { TELEMETRY_ENV as SCRIPT_TELEMETRY_ENV } from "./telemetry-off.mjs";

/**
 * Contract checks for the telemetry switch.
 *
 * Why these cases: the property that makes this switch worth having is that a
 * run which is not a person using the app sends NOTHING, while the shipped app
 * keeps sending everything. Both halves are decisions taken from plain values in
 * `src/main/telemetry-launch.ts`, which imports nothing from Electron (exactly
 * as `window-mode.ts` and `dev-driver.ts` do not), so they are asserted here in
 * milliseconds instead of by booting an app — the real boots are the evidence on
 * the pull request, and this file is what a later refactor fails.
 *
 * The module is bundled in memory from the shipped TypeScript, the same way
 * `window-mode.test.mjs` and `dev-driver-gate.test.mjs` do, so these stay tests
 * of the code that ships. The renderer's half
 * (`shared/config/telemetry.ts`) is bundled the same way, because the rule that
 * matters there — anything but an explicit `true` is off — is the one place a
 * forgotten `additionalArguments` entry could re-open the leak.
 */
async function bundleDataUrl(entry) {
	const bundle = await build({
		stdin: {
			contents: `export * from "${entry}";`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	return `data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`;
}

const {
	TELEMETRY_ARG,
	TELEMETRY_ENV,
	describeTelemetryLaunch,
	readTelemetryArgument,
	resolveTelemetryLaunch,
	telemetryArgument,
} = await import(await bundleDataUrl("./src/main/telemetry-launch"));

const { resolveTelemetryEnabled, telemetryEnabled } = await import(
	await bundleDataUrl("./src/renderer/src/shared/config/telemetry")
);

/** The key every launch in this file carries unless a case says otherwise. */
const KEY = "phc_test_project_key";

/** The launch a person makes: nothing in the environment about telemetry. */
const normalLaunch = { env: {}, projectKey: KEY };

test("a launch that says nothing keeps its telemetry, and says nothing about it", () => {
	const decision = resolveTelemetryLaunch(normalLaunch);
	assert.equal(decision.enabled, true);
	// No problems and no line, because nothing was set: a normal launch must not
	// explain a feature its user did not invoke, and the evidence for "a real
	// user still reports" is that this decision is byte-for-byte what it was.
	assert.deepEqual(decision.problems, []);
	assert.equal(decision.offReason, null);
	assert.equal(describeTelemetryLaunch(decision), null);
});

test("every accepted off spelling switches both processes off", () => {
	for (const value of ["off", "OFF", "0", "false", "no", " off "]) {
		const decision = resolveTelemetryLaunch({
			env: { [TELEMETRY_ENV]: value },
			projectKey: KEY,
		});
		assert.equal(decision.enabled, false, `${TELEMETRY_ENV}=${value}`);
		assert.deepEqual(decision.problems, [], `${TELEMETRY_ENV}=${value}`);
		assert.match(
			describeTelemetryLaunch(decision) ?? "",
			/\[telemetry\] off: switched off by/,
			`${TELEMETRY_ENV}=${value} must be reported as the run's own choice`,
		);
	}
});

test("every accepted on spelling keeps it, spelled out loud or not at all", () => {
	for (const value of ["on", "ON", "1", "true", "yes", " true "]) {
		const decision = resolveTelemetryLaunch({
			env: { [TELEMETRY_ENV]: value },
			projectKey: KEY,
		});
		assert.equal(decision.enabled, true, `${TELEMETRY_ENV}=${value}`);
		assert.deepEqual(decision.problems, [], `${TELEMETRY_ENV}=${value}`);
	}
});

test("a value the app does not understand is refused loudly, and lands on off", () => {
	for (const value of ["of", "flase", "disable", "nope", "2"]) {
		const decision = resolveTelemetryLaunch({
			env: { [TELEMETRY_ENV]: value },
			projectKey: KEY,
		});
		// FAIL-CLOSED. This is the asymmetry with `window-mode.ts`, which keeps its
		// `normal` fallback for a typo because the alternative there is a silently
		// hidden window; here the alternative is a run's events in a
		// customer-facing dashboard, so the typo resolves to the quiet state.
		assert.equal(decision.enabled, false, `${TELEMETRY_ENV}=${value}`);
		assert.equal(decision.problems.length, 1, `${TELEMETRY_ENV}=${value}`);
		const line = describeTelemetryLaunch(decision) ?? "";
		// Loudly: the line names the value that was not understood AND the values
		// that would have been, so a harness that sent nothing is told why.
		assert.match(line, new RegExp(value), line);
		assert.match(line, /off, 0, false, no/, line);
		assert.match(line, /on, 1, true, yes/, line);
	}
});

test("an empty value is not a choice, in either direction", () => {
	// A stale shell export or a `.env` line in the empty shape. It is not read as
	// "off" the way the notification switch reads its own empty case, because
	// these two defaults point the other way: the app's analytics are a real
	// user's, and deleting them because a shell exported nothing is the failure
	// this direction avoids.
	for (const value of ["", "   "]) {
		const decision = resolveTelemetryLaunch({
			env: { [TELEMETRY_ENV]: value },
			projectKey: KEY,
		});
		assert.equal(decision.enabled, true, JSON.stringify(value));
		assert.deepEqual(decision.problems, []);
	}
});

test("a build with no project key means no client, not a crash", () => {
	for (const projectKey of ["", "   "]) {
		const decision = resolveTelemetryLaunch({
			env: {},
			projectKey,
		});
		assert.equal(decision.enabled, false);
		assert.deepEqual(
			decision.problems,
			[],
			"a blank key is a build fact rather than a refused input",
		);
		assert.match(
			describeTelemetryLaunch(decision) ?? "",
			/no PostHog project key/,
		);
	}
	// The crash this replaces, measured against the shipped dependency:
	// `new PostHog("")` throws "You must pass your PostHog project's api key." at
	// module load, which for the app means a main-process error dialog before
	// `whenReady`. `enabled: false` is what keeps the constructor from ever being
	// reached — the caller constructs the client only on `true`.
});

test("the switch wins over a key, and the key over nothing", () => {
	const both = resolveTelemetryLaunch({
		env: { [TELEMETRY_ENV]: "off" },
		projectKey: KEY,
	});
	assert.equal(both.enabled, false);
	const keyless = resolveTelemetryLaunch({
		env: { [TELEMETRY_ENV]: "on" },
		projectKey: "",
	});
	assert.equal(keyless.enabled, false);
});

test("the renderer's reader and main's writer spell one vocabulary", () => {
	assert.equal(telemetryArgument(true), `${TELEMETRY_ARG}=on`);
	assert.equal(telemetryArgument(false), `${TELEMETRY_ARG}=off`);
	assert.deepEqual(readTelemetryArgument([telemetryArgument(true)]), {
		enabled: true,
	});
	assert.deepEqual(readTelemetryArgument([telemetryArgument(false)]), {
		enabled: false,
	});
	// Everything a preload could fail to understand reads as "say nothing":
	// absent, valueless, or a word that is neither.
	for (const argv of [
		[],
		[TELEMETRY_ARG],
		[`${TELEMETRY_ARG}=`],
		[`${TELEMETRY_ARG}=ON`],
		[`${TELEMETRY_ARG}=yes`],
		["--window-mode=headless"],
	]) {
		assert.equal(readTelemetryArgument(argv), null, JSON.stringify(argv));
	}
});

test("the renderer reports nothing unless it was told, explicitly, on", () => {
	assert.equal(resolveTelemetryEnabled(true), true);
	// The fail-closed half, and the reason `src/main/index.ts` writes the entry on
	// EVERY window: a bridge that is missing, an entry the preload could not
	// parse, and a window created by a path that forgot to compose it are all the
	// same answer here.
	for (const value of [undefined, false]) {
		assert.equal(resolveTelemetryEnabled(value), false);
	}
	// Imported outside a renderer (this test), the module resolves to off rather
	// than throwing on a `window` that does not exist.
	assert.equal(telemetryEnabled, false);
});

test("the app's name for the switch and the tooling's are the same string", () => {
	assert.equal(
		SCRIPT_TELEMETRY_ENV,
		TELEMETRY_ENV,
		"scripts/telemetry-off.mjs and src/main/telemetry-launch.ts must agree: the name IS the contract, and nothing else would notice them drifting",
	);
});
