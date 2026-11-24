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
	rename: (from, to) => {
		files[to] = files[from];
		Reflect.deleteProperty(files, from);
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
		// Models posthog-js without `opt_out_capturing_by_default`: a fresh init is
		// opted in; a persisted opt-out from an earlier run survives init.
		optedOut: false,
		calls,
		init(key, options) {
			calls.push(["init", key]);
			c.__loaded = true;
			c.options = options;
		},
		_start_queue_if_opted_in() {
			calls.push(["resume_queue"]);
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
		[["opt_in", false], ["resume_queue"], ["capture", "app_active"]],
		"no second init; the paused queue is resumed before the event",
	);
});

test("a document loading with a persisted opt-out resumes its queue on opt-in", () => {
	// Regression (real-path, 2026-11-24): posthog-js leaves the request queue
	// paused when init sees an opt-out, and opt_in_capturing does not resume it.
	const client = fakeClient();
	client.init = (key) => {
		client.calls.push(["init", key]);
		client.__loaded = true;
		client.optedOut = true; // persisted from an earlier run
	};
	controller
		.createTelemetryController({ client, projectKey: "phc_k", options: {} })
		.apply(true);
	assert.deepEqual(client.calls, [
		["init", "phc_k"],
		["opt_in", false],
		["resume_queue"],
		["capture", "app_active"],
	]);
	controller.setTelemetryActive(null);
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
	// Q4 (round 2): no `/decide/` or remote-config request, and no stored
	// initial person info for one to carry.
	assert.equal(o.advanced_disable_decide, true);
	assert.equal(o.advanced_disable_feature_flags, true);
	assert.equal(o.advanced_disable_feature_flags_on_first_load, true);
	assert.equal(o.save_referrer, false);
	assert.equal(o.save_campaign_params, false);
	// Regression (real-path, 2026-11-24): opted-out-by-default init pauses the
	// request queue and opt-in never resumes it, so events never left.
	assert.equal("opt_out_capturing_by_default" in o, false);
	assert.equal(o.persistence, "localStorage");
	assert.equal("session_recording" in o, false);
	assert.equal(o.before_send.length, 2);
	assert.equal(o.before_send[1], controller.restrictToActiveUserSignal);
});

test("before_send keeps only allow-listed events and properties (Q1/R2)", () => {
	const leaked = {
		$current_url: "file:///Users/jane/app/index.html#/chat/abc",
		$session_entry_url: "file:///Users/jane/app/index.html#/chat/abc",
		$session_entry_pathname: "/Users/jane/app/index.html",
		$initial_person_info: { r: "$direct", u: "file:///…#/chat/abc" },
		$raw_user_agent: "Mozilla/5.0",
		$screen_height: 900,
		$viewport_width: 1280,
		$timezone: "Europe/London",
		$browser_language: "en-GB",
		$device_id: "d",
		$session_id: "s",
		$title: "Secret.pdf",
	};
	const base = {
		token: "phc_k",
		distinct_id: "anon",
		$lib: "web",
		$lib_version: "1.235.6",
		$time: 1,
		$insert_id: "i",
		$process_person_profile: false,
		app_version: "0.63.1",
		$os: "Mac OS X",
		$os_version: "15.0",
	};
	const ev = controller.restrictToActiveUserSignal({
		uuid: "u",
		event: "app_active",
		properties: { ...base, ...leaked },
		$set: { email: "x" },
		$set_once: { $initial_current_url: "file:///…#/chat/abc" },
	});
	assert.deepEqual(ev.properties, { ...base, $geoip_disable: true });
	assert.equal("$set" in ev, false);
	assert.equal("$set_once" in ev, false);
	assert.equal(ev.uuid, "u", "top-level bookkeeping survives");
	// A product event keeps its own enumerated properties, nothing more.
	const product = controller.restrictToActiveUserSignal({
		event: "provider_connected",
		properties: { ...base, provider: "openai", method: "api_key", ...leaked },
	});
	assert.deepEqual(product.properties, {
		...base,
		provider: "openai",
		method: "api_key",
		$geoip_disable: true,
	});
	// Unlisted events (pageviews, exceptions, autocapture, $opt_in) never leave.
	for (const name of [
		"$pageview",
		"$exception",
		"$autocapture",
		"$opt_in",
		"x",
	]) {
		assert.equal(
			controller.restrictToActiveUserSignal({ event: name, properties: base }),
			null,
			name,
		);
	}
	assert.equal(controller.restrictToActiveUserSignal(null), null);
	// Fails closed rather than throwing into posthog-js.
	const hostile = { event: "app_active" };
	Object.defineProperty(hostile, "properties", {
		get() {
			throw new Error("boom");
		},
	});
	assert.equal(controller.restrictToActiveUserSignal(hostile), null);
});

test("a choice is written atomically: temp file, then rename (R3)", () => {
	const fs = memFs({ "/c.json": '{"optedIn":true,"decidedAt":""}\n' });
	const order = [];
	const write = fs.writeFile;
	const rename = fs.rename;
	fs.writeFile = (p, c) => {
		order.push(["write", p]);
		write(p, c);
	};
	fs.rename = (a, b) => {
		order.push(["rename", a, b]);
		rename(a, b);
	};
	consent.writeTelemetryConsent(fs, "/c.json", false);
	assert.deepEqual(order, [
		["write", "/c.json.tmp"],
		["rename", "/c.json.tmp", "/c.json"],
	]);
	assert.equal(consent.readTelemetryConsent(fs, "/c.json").optedIn, false);
	assert.equal("/c.json.tmp" in fs.files, false);
	// A crash during the temp write leaves the previous record intact.
	const crashing = memFs({ "/c.json": '{"optedIn":true,"decidedAt":""}\n' });
	crashing.writeFile = () => {
		throw new Error("ENOSPC");
	};
	assert.throws(() =>
		consent.writeTelemetryConsent(crashing, "/c.json", false),
	);
	assert.equal(consent.readTelemetryConsent(crashing, "/c.json").optedIn, true);
});

function fakeSource(effective) {
	const listeners = new Set();
	let resolve;
	const pending = new Promise((r) => {
		resolve = r;
	});
	return {
		get: () => pending,
		answer: () => resolve({ effective }),
		onChange(l) {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		emit: (state) => {
			for (const l of listeners) l(state);
		},
	};
}

test("boot follows live consent, not launch argv: a reload keeps the current choice (R1)", async () => {
	const tick = () => new Promise((r) => setImmediate(r));
	globalThis.window = { api: { telemetryEnabled: true } }; // stale argv: "on"
	try {
		// Opted out since launch, then reloaded: argv still says on.
		let client = fakeClient();
		let src = fakeSource(false);
		controller.bootTelemetry(
			controller.createTelemetryController({
				client,
				projectKey: "phc_k",
				options: {},
			}),
			src,
		);
		assert.equal(
			liveState.isTelemetryActive(),
			false,
			"off before get() answers",
		);
		src.answer();
		await tick();
		assert.deepEqual(client.calls, [], "opt out + reload: never initialised");
		assert.equal(liveState.isTelemetryActive(), false);

		// Opted in since launch (argv off), then reloaded: starts.
		globalThis.window = { api: { telemetryEnabled: false } };
		liveState.setTelemetryActive(null);
		client = fakeClient();
		src = fakeSource(true);
		controller.bootTelemetry(
			controller.createTelemetryController({
				client,
				projectKey: "phc_k",
				options: {},
			}),
			src,
		);
		assert.deepEqual(client.calls, []);
		src.answer();
		await tick();
		assert.deepEqual(client.calls, [
			["init", "phc_k"],
			["capture", "app_active"],
		]);
		assert.equal(liveState.isTelemetryActive(), true);

		// A broadcast before get() resolves wins over the late answer.
		liveState.setTelemetryActive(null);
		client = fakeClient();
		src = fakeSource(true);
		controller.bootTelemetry(
			controller.createTelemetryController({
				client,
				projectKey: "phc_k",
				options: {},
			}),
			src,
		);
		src.emit({ effective: false });
		src.answer();
		await tick();
		assert.deepEqual(client.calls, [], "the newer opt-out stands");

		// No bridge: stays off even with argv on.
		globalThis.window = { api: { telemetryEnabled: true } };
		liveState.setTelemetryActive(null);
		client = fakeClient();
		controller.bootTelemetry(
			controller.createTelemetryController({
				client,
				projectKey: "phc_k",
				options: {},
			}),
			undefined,
		);
		assert.deepEqual(client.calls, []);
		assert.equal(liveState.isTelemetryActive(), false);
	} finally {
		Reflect.deleteProperty(globalThis, "window");
		liveState.setTelemetryActive(null);
	}
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
	assert.match(
		renderer,
		/bootTelemetry\(telemetry, window\.api\?\.telemetryConsent\)/,
	);
	assert.doesNotMatch(renderer, /session_recording|capture_exceptions: true/);
	// Q4 (round 2): flags are never read from PostHog, so the provider must
	// not reach posthog-js at all.
	const flags = readFileSync(
		"src/renderer/src/shared/providers/feature-flags/feature-flag-provider.tsx",
		"utf8",
	);
	assert.doesNotMatch(flags, /from "posthog-js/);
});
