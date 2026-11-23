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
			'export { checkLocalProvider } from "./src/renderer/src/features/providers/local-provider-check";',
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

/*
 * `message_send_failed` on 0.59.2 counted main's no-token refusal, the
 * request deadline and the daemon's runtime hop failure as `backend_unreachable`
 * (null status / 503), so a false outage read as a real one. The diagnosis keeps
 * the old category wherever no structured code says otherwise, and reports the
 * status and code only from closed allowlists.
 */
test("send diagnosis splits false outages by structured code and keeps old outcomes", () => {
	const d = mod.diagnoseSendFailure;
	const E = (status, code) =>
		new mod.DesktopControlError(
			status,
			"private sentence alice@example.com",
			undefined,
			code,
		);
	// Structured codes that contradict the status bucket.
	assert.deepEqual(d(E(null, "pairing.no-credential")), {
		reason_category: "unauthorized",
		http_status: "none",
		error_code: "pairing.no-credential",
	});
	assert.deepEqual(d(E(504, "deadline_exceeded")), {
		reason_category: "transport",
		http_status: 504,
		error_code: "deadline_exceeded",
	});
	assert.deepEqual(
		d(E(null, "deadline_exceeded")).reason_category,
		"transport",
	);
	assert.deepEqual(d(E(null, "transport.failed")).reason_category, "transport");
	// A missing provider/model arrives as this code with only a sentence to tell
	// it from a runtime crash: it is the server answering, not an outage, and the
	// sentence is deliberately not read.
	const noProvider = new mod.DesktopControlError(
		503,
		"No model provider is configured",
		undefined,
		"runtime_unreachable",
	);
	assert.deepEqual(d(noProvider), {
		reason_category: "runtime_unavailable",
		http_status: 503,
		error_code: "runtime_unreachable",
	});
	// Old outcomes retained where no code distinguishes them.
	assert.deepEqual(d(E(null)), {
		reason_category: "backend_unreachable",
		http_status: "none",
		error_code: "none",
	});
	assert.equal(d(E(503)).reason_category, "backend_unreachable");
	assert.equal(
		d(E(503, "runtime_busy")).reason_category,
		"backend_unreachable",
	);
	assert.equal(d(E(503, "runtime_busy")).error_code, "runtime_busy");
	assert.deepEqual(d(E(422)), {
		reason_category: "refused",
		http_status: 422,
		error_code: "none",
	});
	assert.equal(d(E(401)).reason_category, "unauthorized");
	assert.equal(d(E(500)).reason_category, "server_error");
	// A detached server outranks the code.
	assert.equal(
		d(E(null, "pairing.no-credential"), false).reason_category,
		"backend_unreachable",
	);
	// Non-DesktopControlError failures keep their category, carry no status/code.
	assert.deepEqual(d(new TypeError("Failed to fetch")), {
		reason_category: "transport",
		http_status: "none",
		error_code: "none",
	});
	assert.deepEqual(
		d(Object.assign(new Error("x"), { code: "pairing.refused" })),
		{
			reason_category: "unknown",
			http_status: "none",
			error_code: "none",
		},
	);
});

test("send diagnosis never passes an arbitrary code, status or message through", () => {
	const d = mod.diagnoseSendFailure;
	const hostile = [
		"alice@example.com",
		"sk-live-1234567890",
		"/Users/alice/secret.txt",
		"gpt-4o-mini",
		"user_8f2c1d",
		"RUNTIME_UNREACHABLE",
		"runtime_unreachable ",
		{ toString: () => "runtime_unreachable" },
		42,
	];
	for (const code of hostile) {
		const out = d(
			new mod.DesktopControlError(503, String(code), undefined, code),
		);
		assert.equal(out.error_code, "other", String(code));
		assert.equal(out.reason_category, "backend_unreachable");
	}
	assert.equal(
		d(new mod.DesktopControlError(500, "x", undefined, "")).error_code,
		"none",
	);
	for (const status of [418, 599, 200, 3.5, "503", Number.NaN])
		assert.equal(
			d(new mod.DesktopControlError(status, "x")).http_status,
			"other",
			String(status),
		);
	const allowedStatus = new Set([
		...mod.SEND_FAILURE_HTTP_STATUSES,
		"none",
		"other",
	]);
	const allowedCode = new Set([
		...mod.SEND_FAILURE_ERROR_CODES,
		"none",
		"other",
	]);
	for (const status of [null, 400, 404, 418, 503, 504])
		for (const code of [undefined, "deadline_exceeded", "alice@example.com"]) {
			const out = d(
				new mod.DesktopControlError(
					status,
					"Alice's prompt text",
					undefined,
					code,
				),
			);
			assert.deepEqual(Object.keys(out).sort(), [
				"error_code",
				"http_status",
				"reason_category",
			]);
			assert.ok(mod.SEND_FAILURE_REASONS.includes(out.reason_category));
			assert.ok(allowedStatus.has(out.http_status));
			assert.ok(allowedCode.has(out.error_code));
			assert.ok(!JSON.stringify(out).includes("Alice"));
		}
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

/*
 * Base convergence after #1963: #1962 rebuilt the local-model check into a
 * diagnosis and #1963 instrumented the old one, in the same handler. The merge
 * keeps one emit per probe; this pins it, so a second instrumentation of the
 * same check (or a listing read that reports too) shows up as a count.
 */
test("local_model_check: exactly one row per probe, none without an address", async () => {
	const seen = [];
	mod.setProductEventSink((name, properties) => seen.push([name, properties]));
	const ollama = { id: "ollama", base_url: "http://localhost:11434/v1" };
	const io = (probe, listModels = async () => ["qwen3:8b"]) => ({
		probe,
		listModels,
	});
	try {
		const ready = await mod.checkLocalProvider(
			ollama,
			io(async () => ({ reachable: true, detail: "A server answered (200)." })),
		);
		assert.equal(ready.kind, "ready");
		assert.deepEqual(seen, [
			[
				"local_model_check",
				{ provider: "ollama", result: "reachable", reason: "none" },
			],
		]);

		seen.length = 0;
		// A listing that fails after a reachable probe is not a second row.
		await mod.checkLocalProvider(
			ollama,
			io(
				async () => ({ reachable: true, detail: "A server answered (200)." }),
				async () => {
					throw new Error("listing down");
				},
			),
		);
		assert.equal(seen.length, 1);

		seen.length = 0;
		const down = await mod.checkLocalProvider(
			ollama,
			io(async () => ({ reachable: false, detail: "No server answered." })),
		);
		assert.equal(down.kind, "not_running");
		assert.deepEqual(seen, [
			[
				"local_model_check",
				{ provider: "ollama", result: "unreachable", reason: "not_answering" },
			],
		]);

		seen.length = 0;
		const failed = await mod.checkLocalProvider(
			ollama,
			io(async () => {
				throw new TypeError("Failed to fetch");
			}),
		);
		assert.equal(failed.kind, "check_failed");
		assert.equal(seen.length, 1);
		assert.equal(seen[0][1].result, "error");
		assert.ok(
			mod.LOCAL_MODEL_CHECK_REASONS.includes(seen[0][1].reason),
			`reason ${seen[0][1].reason} is in the declared vocabulary`,
		);

		seen.length = 0;
		let probed = false;
		const none = await mod.checkLocalProvider(
			{ id: "openai-compatible", base_url: null },
			io(async () => {
				probed = true;
				return { reachable: true, detail: "" };
			}),
		);
		assert.equal(none.kind, "no_address");
		assert.equal(probed, false);
		assert.deepEqual(seen, []);
	} finally {
		mod.setProductEventSink("default");
	}
});
