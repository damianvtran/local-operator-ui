/**
 * The opt-in telemetry contract (2026-11-24): no consent record is OFF, the
 * launch switch can only take telemetry away, and the renderer's live client
 * starts/stops with the minimum options needed to count active users.
 * Bundled with esbuild like `telemetry-launch.test.mjs`; no Electron, no
 * posthog-js network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

async function load(entry, contents = `export * from "${entry}";`) {
	const bundle = await build({
		stdin: { contents, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		define: { "import.meta.env": "{}" },
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
}

const consent = await load("./src/main/telemetry-consent");
const launch = await load("./src/main/telemetry-launch");
// ONE bundle for the controller and the live state, so the test reads the same
// module instance the controller writes (separate bundles would each carry a copy).
const controller = await load(
	"",
	`export * from "./src/renderer/src/shared/analytics/telemetry-controller";
export { isTelemetryActive, setTelemetryActive } from "./src/renderer/src/shared/analytics/telemetry-state";`,
);
const liveState = controller;

const memFs = (files = {}) => ({
	files,
	readFile: (p) => (p in files ? files[p] : null),
	writeFile: (p, c) => {
		files[p] = c;
	},
});

test("no record, unreadable or malformed records are NOT consent", () => {
	for (const raw of [
		null,
		undefined,
		"",
		"  ",
		"{",
		"[]",
		"null",
		'{"optedIn":"true"}',
		'{"optedIn":1}',
		"{}",
	]) {
		assert.equal(
			consent.hasOptedIn(consent.parseTelemetryConsent(raw)),
			false,
			String(raw),
		);
	}
	const throwing = {
		readFile: () => {
			throw new Error("EACCES");
		},
		writeFile() {},
	};
	assert.equal(consent.readTelemetryConsent(throwing, "/x"), null);
	assert.equal(consent.readTelemetryConsent(memFs(), "/missing"), null);
});

test("a written choice round-trips, and opting out is kept as an explicit no", () => {
	const fs = memFs();
	const at = new Date("2026-11-24T12:00:00Z");
	consent.writeTelemetryConsent(fs, "/c.json", true, at);
	assert.deepEqual(consent.readTelemetryConsent(fs, "/c.json"), {
		optedIn: true,
		decidedAt: "2026-11-24T12:00:00.000Z",
	});
	consent.writeTelemetryConsent(fs, "/c.json", false, at);
	const record = consent.readTelemetryConsent(fs, "/c.json");
	assert.equal(record.optedIn, false);
	assert.equal(consent.hasOptedIn(record), false);
});

test("effective telemetry = launch allows AND opted in", () => {
	const yes = { optedIn: true, decidedAt: "" };
	const no = { optedIn: false, decidedAt: "" };
	const KEY = "phc_test";
	const unset = launch.resolveTelemetryLaunch({ env: {}, projectKey: KEY });
	const off = launch.resolveTelemetryLaunch({
		env: { [launch.TELEMETRY_ENV]: "off" },
		projectKey: KEY,
	});
	const keyless = launch.resolveTelemetryLaunch({ env: {}, projectKey: "" });
	// Fresh profile, unset switch: OFF (the new default).
	assert.equal(
		consent.resolveEffectiveTelemetry({
			launchAllows: unset.enabled,
			record: null,
		}).effective,
		false,
	);
	assert.equal(
		consent.resolveEffectiveTelemetry({
			launchAllows: unset.enabled,
			record: no,
		}).effective,
		false,
	);
	// Consent + key + unset switch: ON.
	assert.equal(
		consent.resolveEffectiveTelemetry({
			launchAllows: unset.enabled,
			record: yes,
		}).effective,
		true,
	);
	// The launch switch and a keyless build beat consent.
	for (const l of [off, keyless]) {
		const state = consent.resolveEffectiveTelemetry({
			launchAllows: l.enabled,
			record: yes,
		});
		assert.deepEqual(state, {
			optedIn: true,
			launchAllows: false,
			effective: false,
		});
	}
});

function fakeClient() {
	const calls = [];
	const c = {
		__loaded: false,
		optedOut: true,
		calls,
		init(key, options) {
			calls.push(["init", key]);
			c.__loaded = true;
			c.options = options;
		},
		capture(name) {
			if (!c.optedOut) calls.push(["capture", name]);
		},
		opt_in_capturing(o) {
			calls.push(["opt_in", o?.captureEventName]);
			c.optedOut = false;
		},
		opt_out_capturing() {
			calls.push(["opt_out"]);
			c.optedOut = true;
		},
		has_opted_out_capturing: () => c.optedOut,
		// posthog-js 1.235.6's reset() clears consent; model that so the order is tested.
		reset() {
			calls.push(["reset"]);
			c.optedOut = false;
		},
	};
	return c;
}

test("opt-in starts the client live, opt-out stops it, opt back in restarts", () => {
	const client = fakeClient();
	const ctl = controller.createTelemetryController({
		client,
		projectKey: "phc_k",
		options: {},
	});
	ctl.apply(false);
	assert.deepEqual(client.calls, [], "off from the start: never initialised");
	assert.equal(liveState.isTelemetryActive(), false);
	ctl.apply(true);
	assert.deepEqual(client.calls, [
		["init", "phc_k"],
		["opt_in", false],
		["capture", "app_active"],
	]);
	assert.equal(liveState.isTelemetryActive(), true);
	client.calls.length = 0;
	ctl.apply(false);
	assert.deepEqual(
		client.calls,
		[["reset"], ["opt_out"]],
		"reset BEFORE opt-out, or the opt-out is erased",
	);
	assert.equal(client.has_opted_out_capturing(), true);
	assert.equal(liveState.isTelemetryActive(), false);
	client.capture("anything");
	assert.deepEqual(
		client.calls,
		[["reset"], ["opt_out"]],
		"nothing captured after opt-out",
	);
	client.calls.length = 0;
	ctl.apply(true);
	assert.deepEqual(
		client.calls,
		[
			["opt_in", false],
			["capture", "app_active"],
		],
		"no second init",
	);
});

test("a blank build key never starts the client, whatever consent says", () => {
	const client = fakeClient();
	controller
		.createTelemetryController({ client, projectKey: " ", options: {} })
		.apply(true);
	assert.deepEqual(client.calls, []);
	liveState.setTelemetryActive(null);
});

test("posthog options are the active-user minimum: no replay, autocapture or exceptions", () => {
	const o = controller.buildPosthogOptions({ apiHost: "http://127.0.0.1:9" });
	assert.equal(o.disable_session_recording, true);
	assert.equal(o.autocapture, false);
	assert.equal(
		o.capture_exceptions,
		false,
		"false, not undefined: undefined defers to remote config",
	);
	assert.equal(o.capture_pageview, false);
	assert.equal(o.capture_heatmaps, false);
	assert.equal(o.capture_dead_clicks, false);
	assert.equal(o.disable_surveys, true);
	assert.equal(o.disable_external_dependency_loading, true);
	assert.equal(o.opt_out_capturing_by_default, true);
	assert.equal(o.persistence, "localStorage");
	assert.equal("session_recording" in o, false);
	assert.equal(o.before_send.length, 2);
	// Location/title properties never leave: in-app routes carry conversation ids.
	const ev = controller.stripLocationProperties({
		properties: {
			$current_url: "app://x/#/chat/abc",
			$pathname: "/",
			$title: "Secret.pdf",
			app_version: "1.0.0",
			$os: "Mac OS X",
		},
		$set_once: { $initial_current_url: "app://x/#/chat/abc" },
	});
	assert.deepEqual(ev.properties, { app_version: "1.0.0", $os: "Mac OS X" });
	assert.deepEqual(ev.$set_once, {});
});

test("main and the renderer source keep the contract wired", () => {
	const main = readFileSync("src/main/index.ts", "utf8");
	assert.doesNotMatch(main, /from "posthog-node"|new PostHog\(/);
	assert.match(main, /ipcMain\.handle\(TELEMETRY_CONSENT_SET_CHANNEL/);
	assert.match(
		main,
		/webContents\.send\(TELEMETRY_CONSENT_CHANGED_CHANNEL, state\)/,
	);
	const mini = readFileSync("src/main/mini-view.ts", "utf8");
	assert.match(
		mini,
		/telemetryArgument\(false\)/,
		"the mini-view stays explicitly off",
	);
	const renderer = readFileSync("src/renderer/src/main.tsx", "utf8");
	assert.match(renderer, /telemetryConsent\?\.onChange\(/);
	assert.doesNotMatch(renderer, /session_recording|capture_exceptions: true/);
});
