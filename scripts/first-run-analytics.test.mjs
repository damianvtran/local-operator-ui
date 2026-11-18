/**
 * The first-run analytics vocabulary and its gates (QA round 1, Q7):
 * `first-run-reasons.ts` maps caught errors to closed categories, and
 * `product-events.ts` reports through one sink, `first_message_sent` once per
 * install. Plus the start-up band's `backend_status` shape and per-session
 * dedupe (review round 1, R2/R4) and its show rule (QA round 1, Q2/Q3), which
 * are the pure parts of `backend-startup-panel.tsx`.
 *
 * `posthog-js` is REFUSED by the bundle, not stubbed (merge gate, 2026-11-17):
 * `product-events.ts` is reached by many node-side test bundles, and importing
 * `posthog-js` there broke them (`location is not defined`, or unresolvable
 * under the "neutral" platform). The client is handed in by `main.tsx`, so the
 * default sink's gate is tested here with a fake client.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
			'export * from "./src/renderer/src/shared/analytics/first-run-reasons";',
			'export * from "./src/renderer/src/shared/analytics/product-events";',
			'export { startupPanelPhase, backendStatusEvent, claimBackendStatusReport, failedBandCopy } from "./src/renderer/src/shared/components/common/backend-startup-rules";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		].join("\n"),
		resolveDir: repo,
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	alias: {
		"@shared": join(repo, "src/renderer/src/shared"),
		"@features": join(repo, "src/renderer/src/features"),
		"@renderer": join(repo, "src/renderer/src"),
		"@assets": join(repo, "src/renderer/src/assets"),
	},
	plugins: [
		{
			name: "refuse-posthog",
			setup(b) {
				// Any `posthog-js` import reachable from these modules fails the
				// build, which is the regression this file guards.
				b.onResolve({ filter: POSTHOG_IMPORT }, (args) => ({
					errors: [
						{
							text: `posthog-js imported by ${args.importer}: hand the client in through registerProductEventClient instead`,
						},
					],
				}));
			},
		},
	],
	loader: {
		".css": "empty",
		".svg": "empty",
		".png": "empty",
		".webp": "empty",
	},
});
const dir = mkdtempSync(join(tmpdir(), "first-run-analytics-"));
let mod;
try {
	const path = join(dir, "bundle.mjs");
	writeFileSync(path, built.outputFiles[0].text);
	mod = await import(pathToFileURL(path).href);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

const memoryStorage = () => {
	const map = new Map();
	return {
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => map.set(key, String(value)),
	};
};

test("send failures map to their category by status, transport and reachability", () => {
	const s = mod.sendFailureReasonForStatus;
	assert.equal(s(null), "backend_unreachable");
	assert.equal(s(401), "unauthorized");
	assert.equal(s(403), "unauthorized");
	assert.equal(s(402), "insufficient_credits");
	assert.equal(s(404), "conversation_gone");
	assert.equal(s(429), "rate_limited");
	assert.equal(s(503), "backend_unreachable");
	assert.equal(s(500), "server_error");
	assert.equal(s(422), "refused");
	assert.equal(s(200), "unknown");
	const c = mod.categorizeSendFailure;
	assert.equal(c(new Error("anything"), false), "backend_unreachable");
	assert.equal(c(new TypeError("Failed to fetch")), "transport");
	assert.equal(c(new Error("some other bug")), "unknown");
	for (const reason of [
		c(new TypeError("Failed to fetch")),
		c(new Error("x")),
		s(418),
	])
		assert.ok(mod.SEND_FAILURE_REASONS.includes(reason), reason);
});

test("provider failures keep transport and reachability, and split refusals by stage", () => {
	const p = mod.categorizeProviderFailure;
	assert.equal(p(new TypeError("Failed to fetch"), "key"), "transport");
	assert.equal(p(new Error("x"), "start"), "unknown");
	const refused = Object.create(mod.DesktopControlError.prototype);
	refused.status = 422;
	assert.equal(p(refused, "key"), "key_rejected");
	assert.equal(p(refused, "start"), "start_refused");
	const gone = Object.create(mod.DesktopControlError.prototype);
	gone.status = null;
	assert.equal(p(gone, "key"), "backend_unreachable");
});

test("events go to the sink as plain copies; a throwing sink never fails the caller", () => {
	const seen = [];
	mod.setProductEventSink((name, properties) => seen.push([name, properties]));
	try {
		const props = { reason_category: "transport" };
		mod.trackProductEvent("message_send_failed", props);
		assert.deepEqual(seen, [["message_send_failed", props]]);
		assert.notEqual(seen[0][1], props, "a copy, not the caller's object");
		mod.setProductEventSink(() => {
			throw new Error("sink down");
		});
		assert.doesNotThrow(() =>
			mod.trackProductEvent("message_send_failed", props),
		);
		mod.setProductEventSink(null);
		assert.doesNotThrow(() =>
			mod.trackProductEvent("message_send_failed", props),
		);
	} finally {
		mod.setProductEventSink("default");
	}
});

test("the default sink captures only with a registered, initialised client on a reporting launch", () => {
	const seen = [];
	const fake = {
		__loaded: false,
		capture: (name, properties) => seen.push([name, properties]),
	};
	const props = { reason_category: "transport" };
	const hadWindow = "window" in globalThis;
	const priorWindow = globalThis.window;
	try {
		mod.setProductEventSink("default");
		globalThis.window = { api: { telemetryEnabled: true } };
		mod.trackProductEvent("message_send_failed", props);
		assert.equal(seen.length, 0, "no client registered: dropped");
		mod.registerProductEventClient(fake);
		mod.trackProductEvent("message_send_failed", props);
		assert.equal(seen.length, 0, "client not initialised: dropped");
		fake.__loaded = true;
		globalThis.window = { api: { telemetryEnabled: false } };
		mod.trackProductEvent("message_send_failed", props);
		assert.equal(seen.length, 0, "launch may not report: dropped");
		globalThis.window = { api: { telemetryEnabled: true } };
		mod.trackProductEvent("message_send_failed", props);
		assert.deepEqual(seen, [["message_send_failed", props]]);
	} finally {
		mod.registerProductEventClient(null);
		if (hadWindow) globalThis.window = priorWindow;
		else Reflect.deleteProperty(globalThis, "window");
	}
});

test("first_message_sent is reported once per install profile", () => {
	const seen = [];
	mod.setProductEventSink((name) => seen.push(name));
	try {
		const storage = memoryStorage();
		mod.trackFirstMessageSent(storage);
		mod.trackFirstMessageSent(storage);
		mod.trackFirstMessageSent(storage);
		assert.deepEqual(seen, ["first_message_sent"]);
		assert.equal(storage.getItem(mod.FIRST_MESSAGE_FLAG), "1");
		// A storage that throws still reports (at worst twice), never crashes.
		const broken = {
			getItem() {
				throw new Error("denied");
			},
			setItem() {
				throw new Error("denied");
			},
		};
		mod.trackFirstMessageSent(broken);
		assert.equal(seen.length, 2);
	} finally {
		mod.setProductEventSink("default");
	}
});

const failed = (over = {}) => ({
	phase: "failed",
	startedAt: 1_000,
	budgetMs: 30_000,
	attempt: 1,
	settledAt: 8_000,
	failure: {
		category: "crashed",
		exitCode: 1,
		signal: null,
		spawnErrorCode: null,
		stderrTail: "",
		message: "",
		...(over.failure ?? {}),
	},
	...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "failure")),
});

test("backend_status carries after_ready and no start-up duration for a post-ready death (R2)", () => {
	assert.deepEqual(mod.backendStatusEvent(failed()), {
		state: "failed",
		reason: "crashed",
		after_ready: false,
		elapsed_s: 7,
	});
	assert.deepEqual(
		mod.backendStatusEvent(
			failed({ settledAt: 1_801_000, failure: { afterReady: true } }),
		),
		{ state: "failed", reason: "crashed", after_ready: true, elapsed_s: null },
		"uptime never enters the start-up distribution",
	);
	assert.equal(
		mod.backendStatusEvent({ ...failed(), phase: "starting" }),
		null,
	);
});

test("backend_status is claimed once per attempt per renderer session (R4)", () => {
	const storage = memoryStorage();
	assert.equal(
		mod.claimBackendStatusReport("1:ready:1000:false", storage),
		true,
	);
	assert.equal(
		mod.claimBackendStatusReport("1:ready:1000:false", storage),
		false,
		"a reload reading the same snapshot does not report it again",
	);
	assert.equal(
		mod.claimBackendStatusReport("2:failed:9000:false", storage),
		true,
	);
	assert.equal(
		mod.claimBackendStatusReport("x", null),
		true,
		"no storage: report",
	);
});

test("the failed band shows while degraded unless a server answered after the failure (Q2/Q3)", () => {
	const startup = failed();
	const at = (state, lastTransportAt) =>
		mod.startupPanelPhase({ state, startup, lastTransportAt });
	assert.equal(at("detached", null), "failed");
	assert.equal(at("attached", null), null, "attached ends it");
	assert.equal(
		at("degraded", null),
		"failed",
		"held port: degraded, no answer (Q2)",
	);
	assert.equal(
		at("degraded", 5_000),
		"failed",
		"an answer from BEFORE the failure is not evidence against it (Q3)",
	);
	assert.equal(at("degraded", 9_000), null, "an answer after it ends it");
});

test("a post-ready death reads as stopped, not as a failed start (U2)", () => {
	const after = mod.failedBandCopy(failed({ failure: { afterReady: true } }));
	const before = mod.failedBandCopy(failed());
	assert.notEqual(after.title, before.title);
	assert.notEqual(after.reason, before.reason);
});
