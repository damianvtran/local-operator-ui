/**
 * The REAL posthog-js (installed 1.235.6) through the renderer's actual
 * options (`buildPosthogOptions`), on a document whose URL carries a
 * conversation route and a username in its path (review round 1, Q1/R2).
 *
 * Why the real library and not only the unit test in
 * `telemetry-consent.test.mjs`: the leak QA found came from properties
 * posthog-js adds that a hand-written fixture did not know about
 * (`$session_entry_url`, `$initial_person_info`, device defaults). Only the
 * library itself can show what it would queue. A final `before_send` step
 * records the event and returns null, so nothing leaves the test.
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
const built = await build({
	entryPoints: [
		join(repo, "src/renderer/src/shared/analytics/telemetry-controller.ts"),
	],
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	plugins: [
		{
			// The controller must not import posthog-js at runtime (node bundles).
			name: "refuse-posthog",
			setup(b) {
				b.onResolve({ filter: /^posthog-js(\/.*)?$/ }, (args) => ({
					errors: [{ text: `posthog-js runtime import from ${args.importer}` }],
				}));
			},
		},
	],
});
const dir = mkdtempSync(join(tmpdir(), "telemetry-allowlist-"));
let mod;
try {
	const path = join(dir, "bundle.mjs");
	writeFileSync(path, built.outputFiles[0].text);
	mod = await import(pathToFileURL(path).href);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

/*
 * The packaged app loads from `file://`, but jsdom gives `file://` an opaque
 * origin with no localStorage, and the options' `persistence: "localStorage"`
 * is part of what is under test. So the same leak-shaped parts (a username in
 * the path, a conversation id in the hash route) ride on an http origin.
 */
const ROUTE_URL =
	"https://app.local/Users/jane/Applications/Local%20Operator/out/renderer/index.html#/chat/synthetic-conv-42";

test("real posthog-js: app_active leaves with only allow-listed properties", async () => {
	const require = createRequire(join(repo, "package.json"));
	const { JSDOM, ResourceLoader } = require("jsdom");
	// An Electron-on-macOS user agent, so posthog-js derives `$os`/`$os_version`
	// as it does in the app (jsdom's default UA names no OS) and the test can
	// prove those allowed dimensions survive while `$raw_user_agent` does not.
	const userAgent =
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) LocalOperator/0.63.1 Chrome/138.0.0.0 Electron/37.0.0 Safari/537.36";
	const dom = new JSDOM(
		"<!doctype html><html><head><title>Secret.pdf</title></head><body></body></html>",
		{
			url: ROUTE_URL,
			pretendToBeVisual: true,
			resources: new ResourceLoader({ userAgent }),
		},
	);
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
	// posthog-js keeps timers alive forever; the test owns and clears them
	// (same pattern as `autocapture-privacy.test.mjs`).
	const timers = { setTimeout, setInterval };
	const started = [];
	globalThis.setTimeout = (...args) => {
		const h = timers.setTimeout(...args);
		started.push(h);
		return h;
	};
	globalThis.setInterval = (...args) => {
		const h = timers.setInterval(...args);
		started.push(h);
		return h;
	};
	try {
		const posthog = require("posthog-js").default;
		const queued = [];
		const options = mod.buildPosthogOptions({ apiHost: "https://127.0.0.1:9" });
		posthog.init("phc_test_never_sent", {
			...options,
			advanced_disable_decide: true,
			advanced_disable_flags: true,
			request_batching: false,
			before_send: [
				...options.before_send,
				(event) => {
					queued.push(JSON.parse(JSON.stringify(event)));
					return null; // recorded; nothing leaves the test
				},
			],
		});
		posthog.register({ app_version: "0.63.1" });
		posthog.capture(mod.APP_ACTIVE_EVENT);
		posthog.capture("provider_connected", {
			provider: "openai",
			method: "api_key",
			note: "x",
		});
		posthog.capture("$pageview");
		posthog.capture("unlisted_event", { anything: 1 });

		assert.deepEqual(
			queued.map((e) => e.event),
			["app_active", "provider_connected"],
			"only allow-listed events reach the queue",
		);
		const [active, product] = queued;
		const allowed = new Set([...mod.ALLOWED_BASE_PROPERTIES, "$geoip_disable"]);
		for (const key of Object.keys(active.properties)) {
			assert.ok(allowed.has(key), `unexpected property ${key}`);
		}
		assert.equal(active.properties.$geoip_disable, true);
		assert.equal(active.properties.app_version, "0.63.1");
		assert.equal(active.properties.token, "phc_test_never_sent");
		assert.ok(active.properties.distinct_id, "anonymous id present");
		assert.equal(active.properties.$os, "Mac OS X");
		assert.ok(active.properties.$os_version, "$os_version present");
		assert.ok(active.uuid, "uuid kept");
		assert.equal("$set" in active, false);
		assert.equal("$set_once" in active, false);
		const body = JSON.stringify(queued);
		for (const leak of [
			"synthetic-conv-42",
			"/Users/jane",
			"Secret.pdf",
			"$session_entry_url",
			"$initial_person_info",
			"$raw_user_agent",
			"$screen_height",
			"$viewport_width",
			"$timezone",
			"$browser_language",
			"$session_id",
			"$current_url",
			"Intel Mac OS X 10_15_7) AppleWebKit",
		]) {
			assert.equal(body.includes(leak), false, `leaked ${leak}`);
		}
		assert.deepEqual(
			Object.keys(product.properties)
				.filter((k) => !allowed.has(k))
				.sort(),
			["method", "provider"],
			"a product event keeps only its enumerated properties",
		);
	} finally {
		for (const h of started) {
			clearTimeout(h);
			clearInterval(h);
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
