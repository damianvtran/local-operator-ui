import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle the renderer transport in memory, the same way the main-process
// contract test does, so this guard runs the shipped TS rather than a copy.
// The module is renderer code, so `window` is the only global it needs.
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
});
const source = bundle.outputFiles[0].text;

/**
 * Import a fresh copy of the transport with `window.api.desktop.request` bound
 * to `request`. A fresh copy per test keeps the module-level deadline constant
 * from leaking timer state between cases.
 */
async function loadTransport(request) {
	globalThis.window = { api: { desktop: { request } } };
	return import(
		`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`
	);
}

// Issue 89: `/v1/config` was accepted and never answered, so the IPC promise
// never settled. React Query's `retry` cannot help -- retry needs a settled
// rejection -- so `isConfigLoading` stayed true and Settings showed a spinner
// with no recovery. The contract this pins is that a desktop control which
// never settles becomes a REJECTION within the deadline, because only a
// rejection can reach an error state a user can act on.
test("a desktop control that never settles rejects instead of pending forever", async () => {
	const { desktopRequest, DesktopControlError } = await loadTransport(
		// The exact issue-89 fault: accepted, never answered, never rejected.
		() => new Promise(() => {}),
	);

	const started = Date.now();
	const outcome = await Promise.race([
		desktopRequest({ op: "config.get" }).then(
			(value) => ({ settled: value }),
			(error) => ({ error }),
		),
		// Longer than the transport's own 30s deadline, so a transport that
		// never bounds the request fails this test by timing out here instead
		// of hanging the run.
		new Promise((resolve) =>
			setTimeout(() => resolve({ pending: true }), 45000),
		),
	]);

	assert.ok(
		!outcome.pending,
		"desktopRequest never settled: the request is unbounded and Settings would spin forever",
	);
	assert.ok(
		outcome.error instanceof DesktopControlError,
		"a stalled control must reject as DesktopControlError so callers reach an error state",
	);
	// `null` is the transport's stated "no backend was reached" status. The
	// compatibility banner and the providers grid both read exactly this field
	// to say "not answering" rather than "needs an update".
	assert.equal(outcome.error.status, null);
	assert.ok(Date.now() - started < 45000);
});

// The deadline must not truncate a slow-but-working backend into a false
// failure, so a control that answers is passed through untouched.
test("a desktop control that answers is returned unchanged", async () => {
	const { desktopRequest } = await loadTransport(async () => ({
		status: 200,
		body: { result: { hosting: "openai" } },
	}));

	assert.deepEqual(await desktopRequest({ op: "config.get" }), {
		status: 200,
		body: { result: { hosting: "openai" } },
	});
});
