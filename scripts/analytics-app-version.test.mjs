/**
 * Every renderer PostHog event names the app release that sent it
 * (`src/renderer/src/shared/analytics/app-version.ts`).
 *
 * WHY THIS FILE. Until 2026-11-24 the only version on a desktop event was
 * `$lib_version` — posthog-js's own, 1.235.6 on v0.60.2, v0.61.0 and v0.62.1
 * alike — so a fix shipped for first-run could not be verified in the field.
 * The renderer now registers `app_version` as a super property from posthog-js's
 * `loaded` option. The claim that matters, and the one a posthog-js upgrade
 * could silently break, is ORDERING: `loaded` must run before the initial
 * `$pageview` is captured, or the first event of every launch goes out without
 * the version. That is asserted here against the REAL installed posthog-js in
 * jsdom, with the renderer's own `before_send` in the chain, rather than from a
 * reading of its source. A second `before_send` step records each event and
 * returns null, so nothing leaves the test.
 *
 * The argv half (main → preload → `window.api.appVersion`) is asserted in
 * `telemetry-launch.test.mjs`; the sanitizer's fail-closed path keeping the
 * property is in `autocapture-privacy.test.mjs`.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const repo = process.cwd();
const POSTHOG_IMPORT = /^posthog-js(\/.*)?$/;
const built = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/shared/analytics/app-version.ts";',
			'export { scrubCaptureResult } from "./src/renderer/src/shared/analytics/autocapture-privacy.ts";',
		].join("\n"),
		resolveDir: repo,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	plugins: [
		{
			// Only TYPES may come from posthog-js: node-side bundles cannot load it.
			name: "refuse-posthog",
			setup(b) {
				b.onResolve({ filter: POSTHOG_IMPORT }, (args) => ({
					errors: [{ text: `posthog-js runtime import from ${args.importer}` }],
				}));
			},
		},
	],
});
const dir = mkdtempSync(join(tmpdir(), "analytics-app-version-"));
let mod;
try {
	const path = join(dir, "bundle.mjs");
	writeFileSync(path, built.outputFiles[0].text);
	mod = await import(pathToFileURL(path).href);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

/** A recording client for the pure half: what was registered and cleared. */
function recordingClient() {
	const calls = [];
	return {
		calls,
		register(properties) {
			calls.push(["register", properties]);
		},
		unregister(property) {
			calls.push(["unregister", property]);
		},
	};
}

test("a version is registered as app_version; none clears a persisted one", () => {
	const real = recordingClient();
	mod.registerAppVersion(real, "0.62.1");
	assert.deepEqual(real.calls, [["register", { app_version: "0.62.1" }]]);
	assert.equal(mod.APP_VERSION_PROPERTY, "app_version");

	for (const missing of [null, undefined, "", "   "]) {
		const client = recordingClient();
		mod.registerAppVersion(client, missing);
		assert.deepEqual(
			client.calls,
			[["unregister", "app_version"]],
			`no placeholder for ${JSON.stringify(missing)}`,
		);
	}
});

test("a client that throws never takes start-up with it", () => {
	const broken = {
		register() {
			throw new Error("storage full");
		},
		unregister() {
			throw new Error("storage full");
		},
	};
	assert.doesNotThrow(() => mod.registerAppVersion(broken, "0.62.1"));
	assert.doesNotThrow(() => mod.registerAppVersion(broken, null));
});

test("outside an app window the bridge has no version", () => {
	// Node has no `window`: the guard, not a ReferenceError.
	assert.equal(mod.bridgeAppVersion(), null);
});

/*
 * THE REAL PATH: the installed posthog-js, initialised the way `main.tsx` does
 * it (`loaded` + the renderer's `before_send`), with `capture_pageview` ON so the
 * initial pageview is the SDK's own, not one the test fires.
 */
test("real posthog-js: the initial $pageview and every later event carry app_version", async () => {
	const require = createRequire(join(repo, "package.json"));
	const { JSDOM } = require("jsdom");
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "https://app.local/index.html#/chat",
		pretendToBeVisual: true,
	});
	const globals = [
		"self",
		"window",
		"document",
		"navigator",
		"location",
		"localStorage",
		"sessionStorage",
		"XMLHttpRequest",
		"Node",
		"Element",
		"HTMLElement",
		"MouseEvent",
		"Event",
		"ShadowRoot",
		"DocumentFragment",
		"getComputedStyle",
		"CustomEvent",
		"MutationObserver",
		"NodeFilter",
	];
	const saved = {};
	for (const key of globals) {
		saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, {
			value: dom.window[key],
			configurable: true,
			writable: true,
		});
	}
	/*
	 * posthog-js keeps its own timers (queue flushes, retries) alive forever; the
	 * test owns every one it starts and clears them in the `finally`, as
	 * `autocapture-privacy.test.mjs` does, so the file exits on its own.
	 */
	const timers = { setTimeout, setInterval };
	const started = [];
	globalThis.setTimeout = (...args) => {
		const handle = timers.setTimeout(...args);
		started.push(handle);
		return handle;
	};
	globalThis.setInterval = (...args) => {
		const handle = timers.setInterval(...args);
		started.push(handle);
		return handle;
	};
	const settle = () => new Promise((resolve) => timers.setTimeout(resolve, 50));
	try {
		const posthog = require("posthog-js").default;
		const launch = (name, version) => {
			const queued = [];
			const client = posthog.init(
				"phc_test_never_sent",
				{
					api_host: "https://127.0.0.1:9",
					advanced_disable_decide: true,
					advanced_disable_flags: true,
					disable_session_recording: true,
					capture_pageview: true,
					capture_pageleave: false,
					autocapture: true,
					rageclick: false,
					// localStorage, so the stale-version case below is a real
					// persisted super property and not a test double.
					persistence: "localStorage",
					request_batching: false,
					loaded: (ph) => mod.registerAppVersion(ph, version),
					before_send: [
						mod.scrubCaptureResult,
						(event) => {
							queued.push(event);
							return null; // recorded here; nothing leaves the test
						},
					],
				},
				name,
			);
			return { client, queued };
		};

		// Launch 1: a real version.
		const first = launch("launch_one", "0.62.1");
		await settle();
		assert.ok(first.queued.length >= 1, "the SDK captured its pageview");
		assert.equal(
			first.queued[0].event,
			"$pageview",
			"the initial pageview is the launch's first event",
		);
		assert.equal(first.queued[0].properties.app_version, "0.62.1");

		// A named product event and a real autocaptured click, same launch.
		first.client.capture("first_message_sent", { surface: "composer" });
		const button = dom.window.document.body.appendChild(
			dom.window.document.createElement("button"),
		);
		button.textContent = "Check again";
		button.dispatchEvent(
			new dom.window.MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				clientX: 1,
				clientY: 1,
			}),
		);
		const byName = Object.fromEntries(
			first.queued.map((event) => [event.event, event.properties]),
		);
		assert.equal(byName.first_message_sent?.app_version, "0.62.1");
		assert.equal(byName.$autocapture?.app_version, "0.62.1");
		assert.equal(byName.$autocapture?.$el_text, "Check again");
		// The library's own version is still there and is NOT the app's: the
		// reason this property exists.
		assert.notEqual(byName.$pageview.$lib_version, "0.62.1");

		/*
		 * Launch 2, same project key and so the same persisted store, but its
		 * bridge had no version. Negative control first: the property IS
		 * persisted, so without the `unregister` this launch would inherit 0.62.1.
		 */
		const persisted = Object.keys(dom.window.localStorage).find((key) =>
			dom.window.localStorage.getItem(key)?.includes('"app_version":"0.62.1"'),
		);
		assert.ok(persisted, "register persisted app_version across launches");
		const second = launch("launch_two", null);
		await settle();
		assert.equal(second.queued[0]?.event, "$pageview");
		assert.equal(
			"app_version" in second.queued[0].properties,
			false,
			JSON.stringify(second.queued[0].properties.app_version),
		);
	} finally {
		for (const handle of started) {
			clearTimeout(handle);
			clearInterval(handle);
		}
		globalThis.setTimeout = timers.setTimeout;
		globalThis.setInterval = timers.setInterval;
		for (const key of globals) {
			if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
			else delete globalThis[key];
		}
		dom.window.close();
	}
});
