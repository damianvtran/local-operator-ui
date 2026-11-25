import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
 * matters there — anything but an explicit `true` is off, and a build with no
 * key is off too — is the one place a forgotten `additionalArguments` entry
 * could re-open the leak.
 *
 * `import.meta.env` is DEFINED rather than left to the runtime: the renderer's
 * half imports the config singleton (`./app-config` → `load-config`), which
 * reads that object, and a bare node bundle has no such thing — the two calls
 * below read the same module with a different key inlined, which is the shape a
 * build-time variable actually has.
 */
async function bundleDataUrl(entry, env = {}) {
	const bundle = await build({
		stdin: {
			contents: `export * from "${entry}";`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		define: { "import.meta.env": JSON.stringify(env) },
	});
	return `data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`;
}

const {
	APP_VERSION_ARG,
	TELEMETRY_ARG,
	TELEMETRY_ENV,
	appVersionArguments,
	describeTelemetryLaunch,
	normalizeAppVersion,
	readAppVersionArgument,
	readTelemetryArgument,
	resolveTelemetryLaunch,
	telemetryArgument,
} = await import(await bundleDataUrl("./src/main/telemetry-launch"));

/** The key every launch in this file carries unless a case says otherwise. */
const KEY = "phc_test_project_key";

const { resolveTelemetryEnabled, telemetryEnabled } = await import(
	await bundleDataUrl("./src/renderer/src/shared/config/telemetry", {
		VITE_PUBLIC_POSTHOG_KEY: KEY,
	})
);

/*
 * The same module as a build that carries NO key, which is the case that used to
 * diverge: the renderer's key is inlined at build time while main decides from
 * the key its launch carries, so this is the shape in which the two processes
 * could answer differently about one build.
 */
const keylessRenderer = await import(
	await bundleDataUrl("./src/renderer/src/shared/config/telemetry", {
		VITE_PUBLIC_POSTHOG_KEY: "",
	})
);

/** The launch a person makes: nothing in the environment about telemetry. */
const normalLaunch = { env: {}, projectKey: KEY };

test("a launch that says nothing ALLOWS telemetry and defers to the user's consent", () => {
	const decision = resolveTelemetryLaunch(normalLaunch);
	// `enabled` here is the LAUNCH's half only (2026-11-24): telemetry is opt-in,
	// and `resolveEffectiveTelemetry` (scripts/telemetry-consent.test.mjs) ANDs
	// this with the user's consent, so an unset switch with no consent record is
	// still OFF. This half stays "allows" so a user who opts in is not refused.
	assert.equal(decision.enabled, true);
	// No problems and no line from the launch itself: nothing was set.
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
	assert.equal(
		resolveTelemetryEnabled({ fromBridge: true, projectKey: KEY }),
		true,
	);
	// The fail-closed half, and the reason `src/main/index.ts` writes the entry on
	// EVERY window: a bridge that is missing, an entry the preload could not
	// parse, and a window created by a path that forgot to compose it are all the
	// same answer here.
	for (const value of [undefined, false]) {
		assert.equal(
			resolveTelemetryEnabled({ fromBridge: value, projectKey: KEY }),
			false,
		);
	}
	// Imported outside a renderer (this test), the module resolves to off rather
	// than throwing on a `window` that does not exist.
	assert.equal(telemetryEnabled, false);
});

test("a build with no key mounts no client in the renderer either", () => {
	// The renderer's own key is `config.VITE_PUBLIC_POSTHOG_KEY`, inlined at
	// BUILD time, while main decides from the key its LAUNCH carries. A build made
	// with a blank key inlines "" (the schema's default only fills an ABSENT
	// value), so without this half a bridge saying `true` would mount the provider
	// over an empty key - `posthog.init("")`, neither the "no telemetry" answer
	// main gives for the same blank key nor a working client.
	for (const projectKey of ["", "   "]) {
		assert.equal(
			resolveTelemetryEnabled({ fromBridge: true, projectKey }),
			false,
			JSON.stringify(projectKey),
		);
	}
	// The same fact at the module level, from the bundle that really inlines a
	// blank key: the export both call sites read resolves to off.
	assert.equal(keylessRenderer.telemetryEnabled, false);
	// And the build that carries one is unaffected.
	assert.equal(
		resolveTelemetryEnabled({ fromBridge: true, projectKey: KEY }),
		true,
	);
	/*
	 * The renderer hands the controller the BUILD's key, and
	 * `createTelemetryController` refuses a blank key itself, so the key rule
	 * above is the one the live client obeys.
	 */
	const mainSource = readFileSync("src/renderer/src/main.tsx", "utf8");
	// Booted from main's LIVE consent, never the window-creation argv (R1).
	assert.match(
		mainSource,
		/bootTelemetry\(telemetry, window\.api\?\.telemetryConsent\);/,
	);
	assert.doesNotMatch(mainSource, /telemetry\.apply\(telemetryEnabled\)/);
	assert.match(mainSource, /projectKey: config\.VITE_PUBLIC_POSTHOG_KEY,/);
	// And no `PostHogProvider` mount is left to initialise a client on its own.
	assert.doesNotMatch(mainSource, /<PostHogProvider/);
});

test("the app's name for the switch and the tooling's are the same string", () => {
	assert.equal(
		SCRIPT_TELEMETRY_ENV,
		TELEMETRY_ENV,
		"scripts/telemetry-off.mjs and src/main/telemetry-launch.ts must agree: the name IS the contract, and nothing else would notice them drifting",
	);
});

/*
 * THE APP VERSION'S ROUTE TO THE RENDERER (2026-11-24). Every renderer event is
 * meant to carry `app_version` because `$lib_version` is posthog-js's version and
 * says nothing about which release sent the event. The value travels main →
 * `additionalArguments` → preload argv → `window.api.appVersion`, beside the
 * telemetry decision, because only argv is readable before posthog-js's first
 * event; these pin each hop.
 */
test("the app version round-trips through a renderer's argv", () => {
	for (const version of ["0.62.1", "1.0.0-beta.3", "0.63.0+build.7"]) {
		const argv = [
			"/Applications/Local Operator.app/Contents/MacOS/Local Operator Helper (Renderer)",
			"--type=renderer",
			telemetryArgument(true),
			...appVersionArguments(version),
		];
		assert.deepEqual(appVersionArguments(version), [
			`${APP_VERSION_ARG}=${version}`,
		]);
		assert.equal(readAppVersionArgument(argv), version);
	}
	// Whitespace around a real version is the version, not a refusal.
	assert.equal(normalizeAppVersion(" 0.62.1\n"), "0.62.1");
});

test("no usable version means no entry at all, never a placeholder", () => {
	// A bogus `app_version` would become its own row in every breakdown, naming no
	// release; absence is how "unknown" is spelled.
	for (const version of [
		"",
		"   ",
		null,
		undefined,
		"0.62.1 extra",
		"-rf",
		"../0.62.1",
		"0.62.1;rm",
		"9".repeat(65),
	]) {
		assert.deepEqual(appVersionArguments(version), [], String(version));
		assert.equal(normalizeAppVersion(version), null, String(version));
	}
	// The renderer side: an absent or malformed entry reads as null.
	assert.equal(readAppVersionArgument(["--type=renderer"]), null);
	assert.equal(readAppVersionArgument([`${APP_VERSION_ARG}=`]), null);
	assert.equal(readAppVersionArgument([`${APP_VERSION_ARG}=a b`]), null);
	// A prefix of the flag's name is not the flag.
	assert.equal(readAppVersionArgument([`${APP_VERSION_ARG}x=0.62.1`]), null);
});

test("main writes app.getVersion() on the always-written renderer entry, and the preload exposes it", () => {
	/*
	 * Source-level, like the provider-mount check above: the value must be the
	 * real Electron version (not a build-inlined package.json), it must ride on
	 * `telemetryWebPreferences` (which `rendererArgumentFlags` composes for every
	 * app window), and the preload must read it from its own argv rather than
	 * through the async IPC that resolves after the first pageview.
	 */
	const mainIndex = readFileSync("src/main/index.ts", "utf8");
	// The entry is the EFFECTIVE decision (launch AND consent) at window creation.
	assert.match(
		mainIndex,
		/function telemetryWebPreferences\(\)[^\n]*\{\s*return \{\s*additionalArguments: \[[\s\S]*?telemetryArgument\(telemetryConsentState\(\)\.effective\),\s*\.\.\.appVersionArguments\(app\.getVersion\(\)\),\s*\],/,
	);
	assert.match(
		mainIndex,
		/\.\.\.telemetryWebPreferences\(\)\.additionalArguments,/,
	);
	// Main constructs no analytics client of its own any more.
	assert.doesNotMatch(
		mainIndex,
		/from "posthog-node"|new PostHog\(|posthogClient/,
	);
	const preload = readFileSync("src/preload/index.ts", "utf8");
	assert.match(preload, /appVersion: readAppVersionArgument\(process\.argv\),/);
	// And the renderer registers it from that bridge inside posthog-js's
	// `loaded`, which runs before the initial pageview is scheduled.
	const rendererMain = readFileSync("src/renderer/src/main.tsx", "utf8");
	assert.match(
		rendererMain,
		/loaded: \(client\) => registerAppVersion\(client, bridgeAppVersion\(\)\),/,
	);
});
