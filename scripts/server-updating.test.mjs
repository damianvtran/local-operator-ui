/**
 * "The server is updating" instead of failures while `lop update` reloads the
 * daemon in place.
 *
 * WHAT THIS PINS, and why each half matters:
 *
 *  - the fence predicate recognises local-operator's reload admission answer
 *    (`503 {"detail": "service is preparing a safe reload; retry shortly"}`,
 *    `server/reload.py`) and the coded form a future backend may send - and
 *    NOTHING else: a genuine plane-closed 503 must keep its real copy;
 *  - main rewrites the fence into the `serverUpdating` code and opens a bounded
 *    window in the daemon state machine; inside it missed probes do not move the
 *    state toward `detached`, and follow-on failures keep their code with a
 *    display-only hint (asks treat `transport.failed` as unknown-outcome, so a
 *    code rewrite could double-send);
 *  - the window closes on proof the update landed, and EXPIRES to today's real
 *    error behaviour at its cap - a daemon wedged behind its fence is still
 *    reported;
 *  - the renderer reads the code (and the hint) into one neutral sentence, a
 *    status-strip row with a spinner and no Retry, and an `updating` error kind.
 *
 * Pure logic, bundled in memory with an injected clock and a stubbed `fetch`:
 * nothing waits out a real interval and no daemon is started.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const load = async (contents) => {
	const bundle = await build({
		stdin: { contents, resolveDir: ROOT, loader: "ts" },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		alias: {
			"@shared": "./src/renderer/src/shared",
			"@features": "./src/renderer/src/features",
		},
		/*
		 * The renderer modules reach `window`-bound stores through their imports;
		 * nothing here renders, so those are left to resolve as the desktop suite's
		 * other renderer bundles do.
		 */
		logLevel: "silent",
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
};

const contract = await load('export * from "./src/shared/desktop-contract";');
const state = await load('export * from "./src/main/backend/daemon-status";');
const transport = await load('export * from "./src/main/desktop-transport";');
const renderer = await load(
	[
		'export { t } from "./src/i18n";',
		'export { DesktopControlError, UserFacingError, userFacingMessage, isServerUpdatingError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		'export { backendErrorKind, backendCompatibilityMessage, BACKEND_ERROR_REMEDY } from "./src/renderer/src/shared/api/local-operator/backend-error";',
		'export { chatStatusDisplay } from "./src/renderer/src/features/chat/chat-status";',
	].join("\n"),
);

const FENCE = "service is preparing a safe reload; retry shortly";
const PLANE_CLOSED =
	"Desktop controls require a backend started by the desktop app.";
const UPDATING_EN =
	"The Local Operator server is updating. It will be back in a moment.";

/* ------------------------------------------------------- the fence predicate */

test("the fence predicate: the legacy sentence and the coded form, on a 503 only", () => {
	const { isServeReloadFence, SERVE_RELOAD_FENCE_DETAIL } = contract;
	// The constant IS the backend's sentence, byte for byte (measured on a real
	// 0.101.37/0.101.38 reload, 2026-11-09).
	assert.equal(SERVE_RELOAD_FENCE_DETAIL, FENCE);
	assert.equal(isServeReloadFence(503, { detail: FENCE }), true);
	assert.equal(
		isServeReloadFence(503, {
			detail: {
				code: "serve_reloading",
				message: FENCE,
				retry_after_ms: 1000,
			},
		}),
		true,
	);
});

test("the fence predicate refuses everything that is not the fence", () => {
	const { isServeReloadFence } = contract;
	// A genuinely closed plane is NOT an update: its real copy must survive.
	assert.equal(isServeReloadFence(503, { detail: PLANE_CLOSED }), false);
	// The right sentence on the wrong status.
	assert.equal(isServeReloadFence(500, { detail: FENCE }), false);
	assert.equal(isServeReloadFence(200, { detail: FENCE }), false);
	// Near-misses and other shapes.
	assert.equal(isServeReloadFence(503, { detail: `${FENCE}.` }), false);
	assert.equal(isServeReloadFence(503, { detail: { code: "other" } }), false);
	assert.equal(isServeReloadFence(503, { detail: { message: FENCE } }), false);
	assert.equal(isServeReloadFence(503, null), false);
	assert.equal(isServeReloadFence(503, FENCE), false);
	assert.equal(isServeReloadFence(503, {}), false);
});

/* ------------------------------------------------- the state machine window */

const identity = {
	url: "http://127.0.0.1:7341",
	instanceId: "inst-synthetic-a",
	pid: 4242,
	version: "0.0.0-test",
	prefix: "/tmp/synthetic",
	installKind: "uv",
};

const machine = () => {
	const clock = { now: 1_000_000 };
	const m = new state.DaemonStateMachine(() => clock.now);
	m.attach(identity, { owned: false });
	return { m, clock };
};

test("the bound sits above the measured reload distribution", () => {
	// Measured n = 11, median 3.43 s, max 5.06 s (fence -> successor answer); the
	// backend's own worst fence is ~32 s. The window must exceed both.
	assert.ok(state.SERVER_UPDATING_EXTEND_MS > 5_060 + 30_000);
	assert.ok(state.SERVER_UPDATING_CAP_MS > 32_000 + 5_060 + 30_000);
	assert.ok(state.SERVER_UPDATING_CAP_MS >= state.SERVER_UPDATING_EXTEND_MS);
});

test("a fence answer opens the window once, and the snapshot says so", () => {
	const { m } = machine();
	assert.equal(m.snapshot().updating, false);
	assert.equal(m.noteServerUpdating(), true, "the first fence opens it");
	assert.equal(m.noteServerUpdating(), false, "later fences only extend it");
	assert.equal(m.isServerUpdating(), true);
	assert.equal(m.snapshot().updating, true);
});

test("each fence answer extends the window, and the cap bounds it", () => {
	const { m, clock } = machine();
	m.noteServerUpdating();
	// Extended by every fence, so a long reload never lapses mid-way: three
	// half-window steps (90 s) outlive one un-extended window (60 s)...
	for (let i = 0; i < 3; i++) {
		clock.now += state.SERVER_UPDATING_EXTEND_MS / 2;
		assert.equal(m.isServerUpdating(), true, `still updating at step ${i}`);
		m.noteServerUpdating();
	}
	// ...but never past the cap from the first sighting, however many fences.
	clock.now = 1_000_000 + state.SERVER_UPDATING_CAP_MS - 1;
	m.noteServerUpdating();
	assert.equal(m.isServerUpdating(), true);
	clock.now = 1_000_000 + state.SERVER_UPDATING_CAP_MS;
	assert.equal(m.isServerUpdating(), false, "the cap is a hard ceiling");
	// A fence after the cap does NOT reopen it: a daemon stuck behind its fence
	// is the condition the cap exists to report.
	m.noteServerUpdating();
	assert.equal(m.isServerUpdating(), false);
	assert.equal(m.snapshot().updating, false);
});

test("the window lapses without a fresh fence answer", () => {
	const { m, clock } = machine();
	m.noteServerUpdating();
	clock.now += state.SERVER_UPDATING_EXTEND_MS;
	assert.equal(m.isServerUpdating(), false);
	assert.equal(m.serverUpdatingUntil(), null);
});

test("proof the update landed closes the window: admitted answer, identified, reanchored, re-claim", () => {
	const closers = [
		["admitted answer", (m) => assert.equal(m.recordTransportSuccess(), true)],
		["identified", (m) => m.observe({ kind: "identified" })],
		[
			"reanchored",
			(m) =>
				m.observe({
					kind: "reanchored",
					identity: { ...identity, instanceId: "inst-synthetic-b" },
					detail: "reloaded in place",
				}),
		],
		["re-claim (attach)", (m) => m.attach(identity, { owned: false })],
	];
	for (const [name, close] of closers) {
		const { m } = machine();
		m.noteServerUpdating();
		close(m);
		assert.equal(m.isServerUpdating(), false, name);
		// And a NEW update after a landed one opens a fresh window.
		assert.equal(m.noteServerUpdating(), true, `${name}: reopens`);
	}
});

test("a mere liveness answer (a refusal) does not close the window", () => {
	const { m } = machine();
	m.noteServerUpdating();
	m.recordTransportAnswer();
	assert.equal(m.isServerUpdating(), true);
});

test("missed probes inside the window do not move toward detached; after it they do", () => {
	const { m, clock } = machine();
	m.noteServerUpdating();
	for (let i = 0; i < state.UNANSWERED_BEFORE_DETACHED + 2; i++) {
		m.observe({ kind: "unanswered", cause: "timeout", detail: "no answer" });
		m.observe({ kind: "failed", detail: "health failed" });
	}
	let snap = m.snapshot();
	assert.equal(snap.state, "attached", "an update is not a disconnect");
	assert.equal(snap.unanswered, 0);
	assert.equal(snap.failures, 0);
	// Expiry reverts to today's classification: the same misses now count.
	clock.now += state.SERVER_UPDATING_CAP_MS;
	m.observe({ kind: "failed", detail: "health failed" });
	snap = m.snapshot();
	assert.equal(snap.state, "degraded");
	assert.equal(snap.failures, 1);
});

test("the window never masks a dead pid or a contradiction", () => {
	const { m } = machine();
	m.noteServerUpdating();
	m.observe({ kind: "pid-dead" });
	assert.equal(m.getState(), "detached");
	const second = machine();
	second.m.noteServerUpdating();
	second.m.observe({ kind: "contradicted", detail: "another daemon" });
	assert.equal(second.m.snapshot().failures, 1, "re-claim still advances");
});

/* ------------------------------------------------------ main's transport */

const withFetch = async (respond, run) => {
	const original = globalThis.fetch;
	globalThis.fetch = async () => respond();
	try {
		return await run();
	} finally {
		globalThis.fetch = original;
	}
};
const json = (status, body) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", "retry-after": "1" },
	});

test("main rewrites the fence into the serverUpdating code and flags it", async () => {
	const outcome = await withFetch(
		() => json(503, { detail: FENCE }),
		() =>
			transport.requestDesktopOutcome(
				{ op: "sessions.list" },
				"http://127.0.0.1:7341",
				"synthetic-token",
			),
	);
	assert.equal(outcome.serverUpdating, true);
	assert.equal(outcome.answered, true);
	assert.equal(outcome.response.status, 503);
	assert.equal(
		outcome.response.body.detail.code,
		contract.DESKTOP_REFUSAL_CODE.serverUpdating,
	);
	assert.equal(outcome.response.body.detail.retry_after_ms, 1000);
});

test("a genuine plane-closed 503 is relayed untouched (negative)", async () => {
	const outcome = await withFetch(
		() => json(503, { detail: PLANE_CLOSED }),
		() =>
			transport.requestDesktopOutcome(
				{ op: "sessions.list" },
				"http://127.0.0.1:7341",
				"synthetic-token",
			),
	);
	assert.equal(outcome.serverUpdating, undefined);
	assert.deepEqual(outcome.response.body, { detail: PLANE_CLOSED });
});

test("markUpdating keeps every code and adds only the display hint", () => {
	const { markUpdating } = transport;
	const list = { op: "sessions.list" };
	// Plane-closed (bare string) becomes an object WITHOUT a code, so the renderer
	// still derives `pairing.plane-closed` from the status.
	const closed = markUpdating(list, {
		status: 503,
		body: { detail: PLANE_CLOSED },
	});
	assert.deepEqual(closed.body.detail, {
		message: PLANE_CLOSED,
		updating: true,
	});
	// transport.failed keeps its code (asks: unknown outcome, never a resend).
	const failed = markUpdating(list, {
		status: 503,
		body: {
			detail: {
				code: contract.DESKTOP_REFUSAL_CODE.transportFailed,
				message: "x",
			},
		},
	});
	assert.equal(
		failed.body.detail.code,
		contract.DESKTOP_REFUSAL_CODE.transportFailed,
	);
	assert.equal(failed.body.detail.updating, true);
	// Not marked: the deadline (its own advice must survive), the app's own
	// no-credential refusal, a non-desktop route, and a success.
	const deadline = {
		status: 504,
		body: { detail: { code: "deadline_exceeded" } },
	};
	assert.equal(markUpdating(list, deadline), deadline);
	const noCred = {
		status: 503,
		body: {
			detail: {
				code: contract.DESKTOP_REFUSAL_CODE.noCredential,
				message: "x",
			},
		},
	};
	assert.equal(markUpdating(list, noCred), noCred);
	const caps = { status: 503, body: { detail: PLANE_CLOSED } };
	assert.equal(markUpdating({ op: "capabilities" }, caps), caps);
	const ok = { status: 200, body: { result: [] } };
	assert.equal(markUpdating(list, ok), ok);
});

/* ------------------------------------------------------------ the renderer */

const { DesktopControlError, UserFacingError } = renderer;
const fenceError = () =>
	new DesktopControlError(
		503,
		"The Local Operator server is updating.",
		undefined,
		contract.DESKTOP_REFUSAL_CODE.serverUpdating,
		1000,
	);

test("userFacingMessage: the code and the hint both read as the update sentence", () => {
	assert.equal(
		renderer.userFacingMessage(fenceError(), "fallback"),
		UPDATING_EN,
	);
	const flagged = new DesktopControlError(
		503,
		PLANE_CLOSED,
		undefined,
		contract.DESKTOP_REFUSAL_CODE.planeClosed,
		undefined,
		{ message: PLANE_CLOSED, updating: true },
	);
	assert.equal(renderer.userFacingMessage(flagged, "fallback"), UPDATING_EN);
	assert.equal(flagged.code, contract.DESKTOP_REFUSAL_CODE.planeClosed);
	// Media path: a UserFacingError carrying the code.
	assert.equal(
		renderer.userFacingMessage(
			new UserFacingError("x", contract.DESKTOP_REFUSAL_CODE.serverUpdating),
			"fallback",
		),
		UPDATING_EN,
	);
});

test("a genuine plane-closed refusal outside the window keeps its real copy (negative)", () => {
	const closed = new DesktopControlError(
		503,
		PLANE_CLOSED,
		undefined,
		contract.DESKTOP_REFUSAL_CODE.planeClosed,
	);
	assert.equal(renderer.isServerUpdatingError(closed), false);
	assert.equal(
		renderer.userFacingMessage(closed, "fallback"),
		renderer.t("ui.common.errors.desktop_refusal.plane_closed"),
	);
	assert.equal(renderer.backendErrorKind(closed), "unreachable");
	assert.equal(renderer.isServerUpdatingError(new Error(FENCE)), false);
});

test("backendErrorKind: updating, with the update sentence and no remedy", () => {
	assert.equal(renderer.backendErrorKind(fenceError()), "updating");
	assert.equal(renderer.BACKEND_ERROR_REMEDY.updating, "");
	assert.equal(
		renderer.backendCompatibilityMessage({
			kind: "updating",
			unpaired: false,
			missing: [],
			answered: false,
		}),
		UPDATING_EN,
	);
});

/* --------------------------------------------------------- the status strip */

const server = (extra = {}) => ({
	state: "attached",
	reconnecting: false,
	detail: null,
	pairing: { available: true, cause: null },
	...extra,
});

test("the strip's updating row: neutral, a spinner, no Retry", () => {
	const display = renderer.chatStatusDisplay({
		connectivityIssue: null,
		server: server({ updating: true }),
		internetOffline: false,
	});
	assert.equal(display.kind, "updating");
	assert.equal(display.role, "status");
	assert.equal(display.wash, "info-wash");
	assert.equal(display.action, null);
	assert.equal(display.busy, true);
	assert.equal(display.title, UPDATING_EN);
});

test("updating outranks every failure row while the window is open", () => {
	const failing = [
		server({ updating: true, state: "detached" }),
		server({ updating: true, state: "degraded" }),
		server({
			updating: true,
			pairing: { available: false, cause: "credential-refused" },
		}),
	];
	for (const s of failing)
		assert.equal(
			renderer.chatStatusDisplay({
				connectivityIssue: "server_offline",
				server: s,
				internetOffline: false,
			}).kind,
			"updating",
		);
});

test("without the window the rows are exactly today's (negative)", () => {
	assert.equal(
		renderer.chatStatusDisplay({
			connectivityIssue: null,
			server: server({ state: "detached", updating: false }),
			internetOffline: false,
		}).kind,
		"unreachable",
	);
	assert.equal(
		renderer.chatStatusDisplay({
			connectivityIssue: null,
			server: server(),
			internetOffline: false,
		}),
		null,
	);
});
