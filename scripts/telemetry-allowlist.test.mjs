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

/*
 * EVERY REQUEST, NOT ONLY `/e/` (review round 2, Q4; 2026-11-24).
 *
 * `before_send` sees only captured events. posthog-js also builds requests of
 * its own (`/decide/` for flags and remote config, `/array/<token>/config`),
 * and in 1.235.6 the `/decide/` body carries `person_properties` from the
 * stored initial props: `$initial_current_url`, i.e. the full document URL with
 * the user's home path and the `#/chat/<id>` route. So this drives the real
 * client through the real controller with a recording `fetch` (and a recording
 * XHR, should a transport fall back) and inspects every URL and decoded body.
 *
 * Two cycles in one document: the first launch, then a RELOAD (a fresh
 * posthog-js module over the same localStorage, i.e. with the initial props
 * the first cycle persisted), including an opt-out and opt-in. The negative
 * control re-enables `/decide/` and flags and must see the leak, which proves
 * the recorder would catch it (if it did not, a clean result means nothing).
 */
const LEAKS = ["#/", "/Users/", "synthetic-conv"];

function decodeBody(body) {
	if (body == null) return "";
	if (typeof body !== "string") return String(body);
	// posthog-js Base64 compression: `data=<urlencoded base64 JSON>`.
	const m = /^data=(.*)$/s.exec(body);
	if (m) {
		try {
			return Buffer.from(decodeURIComponent(m[1]), "base64").toString("utf8");
		} catch {
			return body;
		}
	}
	return body;
}

async function runTwoCycles(url, overrides) {
	const require = createRequire(join(repo, "package.json"));
	const { JSDOM } = require("jsdom");
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url,
		pretendToBeVisual: true,
	});
	/*
	 * jsdom gives `file://` an opaque origin whose `localStorage` getter
	 * throws; Electron's `file://` renderer has a working one. Shim an
	 * in-memory Storage there, shared across both cycles like the real disk,
	 * so the packaged URL shape is exercised with persistence on.
	 */
	let storage;
	try {
		storage = dom.window.localStorage;
	} catch {
		const data = new Map();
		storage = {
			getItem: (k) => (data.has(k) ? data.get(k) : null),
			setItem: (k, v) => data.set(k, String(v)),
			removeItem: (k) => data.delete(k),
			clear: () => data.clear(),
			key: (i) => [...data.keys()][i] ?? null,
			get length() {
				return data.size;
			},
		};
		for (const name of ["localStorage", "sessionStorage"])
			Object.defineProperty(dom.window, name, {
				value: name === "localStorage" ? storage : { ...storage },
				configurable: true,
			});
	}
	const requests = [];
	class RecordingXHR {
		open(method, u) {
			this.u = String(u);
		}
		setRequestHeader() {}
		send(body) {
			requests.push({ url: this.u, body: decodeBody(body), via: "xhr" });
		}
	}
	const recordingFetch = async (u, init) => {
		let body = init?.body;
		// GZip compression sends a Blob; decode it so its content is inspected.
		if (body && typeof body === "object" && "arrayBuffer" in body) {
			const { gunzipSync } = require("node:zlib");
			const raw = Buffer.from(await body.arrayBuffer());
			try {
				body = gunzipSync(raw).toString("utf8");
			} catch {
				body = raw.toString("utf8");
			}
		}
		requests.push({ url: String(u), body: decodeBody(body), via: "fetch" });
		return new Response("{}", { status: 200 });
	};
	const globals = {
		self: dom.window,
		window: dom.window,
		document: dom.window.document,
		navigator: dom.window.navigator,
		location: dom.window.location,
		localStorage: dom.window.localStorage,
		sessionStorage: dom.window.sessionStorage,
		XMLHttpRequest: RecordingXHR,
		fetch: recordingFetch,
	};
	for (const k of [
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
	])
		globals[k] = dom.window[k];
	const saved = {};
	for (const [key, value] of Object.entries(globals)) {
		saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, {
			value,
			configurable: true,
			writable: true,
		});
	}
	const timers = { setTimeout, setInterval };
	const started = [];
	globalThis.setTimeout = (...a) => {
		const h = timers.setTimeout(...a);
		started.push(h);
		return h;
	};
	globalThis.setInterval = (...a) => {
		const h = timers.setInterval(...a);
		started.push(h);
		return h;
	};
	const entry = require.resolve("posthog-js");
	const launch = () => {
		// A reload is a fresh module: posthog-js captures `fetch`/`window` at
		// module load, so the cache entry is dropped for each cycle.
		delete require.cache[entry];
		const posthog = require("posthog-js").default;
		const options = {
			...mod.buildPosthogOptions({
				apiHost: "https://127.0.0.1:9",
				loaded: (c) => c.register({ app_version: "0.63.1" }),
			}),
			request_batching: false,
			...overrides,
		};
		return mod.createTelemetryController({
			client: posthog,
			projectKey: "phc_synthetic",
			options,
		});
	};
	const settle = () => new Promise((r) => timers.setTimeout(r, 60));
	try {
		launch().apply(true); // first launch, opted in
		await settle();
		const reloaded = launch(); // reload over the persisted initial props
		reloaded.apply(true);
		await settle();
		reloaded.apply(false);
		reloaded.apply(true);
		await settle();
		return requests;
	} finally {
		for (const h of started) {
			clearTimeout(h);
			clearInterval(h);
		}
		globalThis.setTimeout = timers.setTimeout;
		globalThis.setInterval = timers.setInterval;
		for (const key of Object.keys(globals)) {
			if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
			else delete globalThis[key];
		}
		delete require.cache[entry];
		dom.window.close();
	}
}

function leaksIn(requests) {
	const found = [];
	for (const r of requests) {
		for (const leak of LEAKS) {
			if (r.url.includes(leak) || r.body.includes(leak))
				found.push(`${new URL(r.url).pathname} carries ${leak}`);
		}
	}
	return found;
}

// The packaged app's real shape, and the http-origin twin whose localStorage
// works under jsdom (see ROUTE_URL above), so persisted initial props are hit.
const FILE_URL =
	"file:///Users/jane/Applications/Local%20Operator/out/renderer/index.html#/chat/synthetic-conv-42";

for (const url of [FILE_URL, ROUTE_URL]) {
	test(`real posthog-js: NO outgoing request carries the route or path (${new URL(url).protocol}) (Q4)`, async () => {
		const requests = await runTwoCycles(url, {});
		const paths = requests.map((r) => new URL(r.url).pathname);
		assert.ok(
			paths.every((p) => p.startsWith("/e/")),
			`only capture requests leave; saw ${JSON.stringify(paths)}`,
		);
		const active = requests.filter(
			(r) => r.url.includes("/e/") && r.body.includes('"app_active"'),
		);
		assert.ok(
			active.length >= 2,
			`app_active sent on launch and on reload (saw ${active.length})`,
		);
		assert.deepEqual(leaksIn(requests), []);
	});
}

/*
 * TWO barriers, both needed for the negative control to leak: `/decide/` must
 * be built (the `advanced_disable_*` switches) AND initial person info must be
 * stored (`save_referrer`/`save_campaign_params`; posthog-core.js 1.235.6 only
 * calls `set_initial_person_info` when either is on). Re-enabling only the
 * first sends `/decide/` with an empty `person_properties`, which is why the
 * options keep both off.
 */
test("negative control: with /decide/, flags and initial props re-enabled the recorder sees the leak (Q4)", async () => {
	const requests = await runTwoCycles(ROUTE_URL, {
		advanced_disable_decide: false,
		advanced_disable_feature_flags: false,
		advanced_disable_feature_flags_on_first_load: false,
		save_referrer: true,
		save_campaign_params: true,
	});
	const leaks = leaksIn(requests);
	assert.ok(
		leaks.some((l) => l.startsWith("/decide/")),
		`expected a /decide/ leak, got ${JSON.stringify(leaks)}`,
	);
});
