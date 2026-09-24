/**
 * The provider sign-in flow's rules, driven through the real module with
 * scripted backends.
 *
 * WHY THIS FILE EXISTS. The browser opened only on a SECOND click for every
 * browser provider (design audit D1, UX walk U1): the panel opened the page only
 * when the `POST /v1/auth/login` reply already carried `auth_url`, and on every
 * released backend the URL arrives 0.13-1.18 s later, on a poll. The fix moved
 * the rules into `sign-in-flow.ts`, and each test below is one of them, run
 * against the backend shape that exposed it:
 *
 * - the OLD backend (start answers `starting` with no URL; the URL arrives on
 *   a poll) and the NEW one (start waits and answers with the URL) both open
 *   the page exactly once, with no Reopen;
 * - a URL repeated on every poll opens once (dedup by operation and URL);
 * - a 404 from the status read stops polling and settles as expired;
 * - a supersede (the backend ends the old operation `cancelled` with "Replaced
 *   by a new sign-in.") settles as cancelled, not failed;
 * - an older backend's 409 is resolved by adopting the live operation (same
 *   provider) or cancelling it and starting again (other provider).
 *
 * The poll here is the REAL `pollAuthOperation`, fed by a scripted `read`, so
 * the 404 stop is exercised through the code that ships. Timers are Node's
 * mock timers, so no test waits on the wall clock.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/providers/sign-in-flow";',
			'export { pollAuthOperation, AUTH_OPERATION_POLL_MS } from "./src/renderer/src/shared/api/local-operator/auth-operation";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
	tsconfig: "tsconfig.web.json",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const {
	createSignInFlow,
	effectiveOperation,
	resetSignInRegistry,
	pollAuthOperation,
	AUTH_OPERATION_POLL_MS,
	DesktopControlError,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const URL_A = "https://claude.ai/oauth/authorize?state=a";

/** One operation snapshot in the wire shape (`AuthOperation`). */
const op = (id, state, extra = {}) => ({
	id,
	provider: "anthropic",
	state,
	message: "",
	auth_url: null,
	instructions: null,
	input_required: false,
	prompt_id: null,
	expires_in: 540,
	...extra,
});

/** Let every queued microtask (and the promise chains behind them) run. */
const settle = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

/**
 * A scripted backend. `start` answers from `startReplies`, `read` answers from
 * `reads` (the last one repeats), and every call is recorded.
 */
function backend({ startReplies = [], reads = [] } = {}) {
	const calls = { start: [], read: [], cancel: [], open: [] };
	let readIndex = 0;
	return {
		calls,
		deps: {
			start: async (provider) => {
				calls.start.push(provider);
				const next = startReplies.shift();
				if (next instanceof Error) throw next;
				return next;
			},
			read: async (id) => {
				calls.read.push(id);
				const next = reads[Math.min(readIndex, reads.length - 1)];
				readIndex += 1;
				if (next instanceof Error) throw next;
				return next;
			},
			cancel: async (id) => {
				calls.cancel.push(id);
				return {};
			},
			open: async (id, reopen) => {
				calls.open.push({ id, reopen });
			},
		},
	};
}

/** A flow wired to the real poller, whose reads go to the scripted backend. */
function flowFor(scripted) {
	const states = [];
	const succeeded = [];
	const flow = createSignInFlow({
		...scripted.deps,
		poll: (id, onUpdate, options) =>
			pollAuthOperation(id, onUpdate, { ...options, read: scripted.deps.read }),
		onChange: (state) => states.push(state),
		onSucceeded: (operation) => succeeded.push(operation),
	});
	return { flow, states, succeeded };
}

test("OLD backend: the URL arrives on the first poll and opens once, with no Reopen", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const scripted = backend({
		startReplies: [op("op-1", "starting")],
		reads: [op("op-1", "waiting", { auth_url: URL_A })],
	});
	const { flow } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	assert.deepEqual(
		scripted.calls.open,
		[{ id: "op-1", reopen: false }],
		"the first poll carrying auth_url opened the page, on the first click",
	);
	assert.equal(flow.getState().opened, true);
	// Four more polls report the same URL; main is never asked again.
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(AUTH_OPERATION_POLL_MS);
		await settle();
	}
	assert.equal(scripted.calls.read.length, 5, "the poll kept running");
	assert.equal(scripted.calls.open.length, 1, "the same URL is opened once");
	flow.dispose();
});

test("NEW backend: the start reply carries the URL and it opens before any poll", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const scripted = backend({
		startReplies: [op("op-2", "waiting", { auth_url: URL_A })],
		reads: [op("op-2", "waiting", { auth_url: URL_A })],
	});
	const { flow } = flowFor(scripted);
	await flow.start("anthropic");
	// The start reply alone: the open is claimed synchronously from it.
	assert.deepEqual(scripted.calls.open, [{ id: "op-2", reopen: false }]);
	await settle();
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS);
	await settle();
	assert.equal(
		scripted.calls.open.length,
		1,
		"the poll's same URL is not reopened",
	);
	flow.dispose();
});

test("a NEW url for the same operation is a page the user has not seen, so it opens", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const scripted = backend({
		startReplies: [op("op-3", "waiting", { auth_url: URL_A })],
		reads: [op("op-3", "waiting", { auth_url: `${URL_A}&again=1` })],
	});
	const { flow } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	assert.equal(scripted.calls.open.length, 2);
	flow.dispose();
});

test("an open the app could not make is a fallback, and 'opened' stays false", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const scripted = backend({
		startReplies: [op("op-4", "waiting", { auth_url: URL_A })],
		reads: [op("op-4", "waiting", { auth_url: URL_A })],
	});
	scripted.deps.open = async () => {
		throw new Error("The sign-in page could not be opened. Try again.");
	};
	const { flow } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	const state = flow.getState();
	assert.equal(state.phase, "active", "the flow keeps running");
	assert.equal(state.opened, false, "the panel must not say it opened a page");
	assert.equal(state.openFailed, true);
	flow.dispose();
});

test("a 404 from the status read stops the poll and settles as expired", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const scripted = backend({
		startReplies: [op("op-5", "starting")],
		reads: [
			op("op-5", "waiting", { auth_url: URL_A }),
			new DesktopControlError(
				404,
				"This sign-in is no longer available. Start again.",
			),
		],
	});
	const { flow } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS);
	await settle();
	const state = flow.getState();
	assert.equal(state.phase, "settled");
	assert.equal(state.operation.state, "expired");
	const readsAtStop = scripted.calls.read.length;
	for (let i = 0; i < 5; i++) {
		t.mock.timers.tick(AUTH_OPERATION_POLL_MS * 2);
		await settle();
	}
	assert.equal(
		scripted.calls.read.length,
		readsAtStop,
		"no read after the 404",
	);
	flow.dispose();
});

test("a transient failure (not 404) keeps polling, so a network blip strands nothing", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const scripted = backend({
		startReplies: [op("op-6", "starting")],
		reads: [
			new DesktopControlError(
				null,
				"Desktop controls could not reach the backend process.",
			),
			op("op-6", "waiting", { auth_url: URL_A }),
		],
	});
	const { flow } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	assert.equal(flow.getState().phase, "active");
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS * 2);
	await settle();
	assert.equal(scripted.calls.open.length, 1, "the retry read opened the page");
	flow.dispose();
});

test("a supersede settles as cancelled with the backend's sentence, not as a failure", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const scripted = backend({
		startReplies: [op("op-7", "waiting", { auth_url: URL_A })],
		reads: [op("op-7", "cancelled", { message: "Replaced by a new sign-in." })],
	});
	const { flow, succeeded } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	const state = flow.getState();
	assert.equal(state.phase, "settled");
	assert.equal(state.operation.state, "cancelled");
	assert.equal(state.operation.message, "Replaced by a new sign-in.");
	assert.equal(succeeded.length, 0);
	flow.dispose();
});

test("success reports the operation once, with the backend's defaults receipt intact", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const defaults = {
		hosting: "anthropic",
		model: "claude-opus-5-5",
		model_name: "Claude Opus 5.5",
		receipt: "New chats use Claude Opus 5.5.",
	};
	const scripted = backend({
		startReplies: [op("op-8", "starting")],
		reads: [
			op("op-8", "waiting", { auth_url: URL_A }),
			op("op-8", "succeeded", { defaults_applied: defaults }),
		],
	});
	const { flow, succeeded } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS);
	await settle();
	assert.equal(succeeded.length, 1);
	assert.deepEqual(flow.getState().operation.defaults_applied, defaults);
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS * 4);
	await settle();
	assert.equal(
		scripted.calls.read.length,
		2,
		"a terminal state stops the poll",
	);
	flow.dispose();
});

test("an OLDER backend's 409 for the SAME provider adopts the live operation", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	// Panel 1 starts a flow, then unmounts mid-flow (dispose stops polling only).
	const first = backend({
		startReplies: [op("op-9", "waiting", { auth_url: URL_A })],
		reads: [op("op-9", "waiting", { auth_url: URL_A })],
	});
	const one = flowFor(first);
	await one.flow.start("anthropic");
	await settle();
	one.flow.dispose();
	// Panel 2 starts the same provider; the old backend refuses with 409.
	const second = backend({
		startReplies: [
			new DesktopControlError(
				409,
				"A sign-in is already active. Finish or cancel it first.",
			),
		],
		reads: [op("op-9", "waiting", { auth_url: URL_A })],
	});
	const two = flowFor(second);
	await two.flow.start("anthropic");
	await settle();
	const state = two.flow.getState();
	assert.equal(state.phase, "active", "the live flow was adopted, not refused");
	assert.equal(state.operation.id, "op-9");
	assert.equal(state.error, null);
	assert.deepEqual(second.calls.cancel, [], "adopting cancels nothing");
	two.flow.dispose();
});

test("an OLDER backend's 409 for ANOTHER provider cancels the stale flow and starts again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const first = backend({
		startReplies: [op("op-10", "waiting", { auth_url: URL_A })],
		reads: [op("op-10", "waiting", { auth_url: URL_A })],
	});
	const one = flowFor(first);
	await one.flow.start("anthropic");
	await settle();
	one.flow.dispose();
	const second = backend({
		startReplies: [
			new DesktopControlError(
				409,
				"A sign-in is already active. Finish or cancel it first.",
			),
			op("op-11", "waiting", { auth_url: "https://auth.openai.com/x" }),
		],
		reads: [
			op("op-10", "waiting", { auth_url: URL_A }),
			op("op-11", "waiting", { auth_url: "https://auth.openai.com/x" }),
		],
	});
	const two = flowFor(second);
	await two.flow.start("openai");
	await settle();
	assert.deepEqual(second.calls.cancel, ["op-10"]);
	assert.deepEqual(second.calls.start, ["openai", "openai"]);
	assert.equal(two.flow.getState().operation.id, "op-11");
	two.flow.dispose();
});

test("a 409 this renderer knows nothing about shows the backend's own sentence", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const scripted = backend({
		startReplies: [
			new DesktopControlError(
				409,
				"A sign-in is already active. Finish or cancel it first.",
			),
		],
	});
	const { flow } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	const state = flow.getState();
	assert.equal(state.phase, "settled");
	assert.equal(
		state.error,
		"A sign-in is already active. Finish or cancel it first.",
	);
	flow.dispose();
});

test("Cancel ends the backend flow and a late poll cannot repaint the panel", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const scripted = backend({
		startReplies: [op("op-12", "waiting", { auth_url: URL_A })],
		reads: [op("op-12", "waiting", { auth_url: URL_A })],
	});
	const { flow } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	await flow.cancel();
	assert.deepEqual(scripted.calls.cancel, ["op-12"]);
	assert.equal(flow.getState().phase, "idle");
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS * 3);
	await settle();
	assert.equal(flow.getState().phase, "idle", "no poll outlived the cancel");
	flow.dispose();
});

test("Reopen asks main to open again even for the same URL", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const scripted = backend({
		startReplies: [op("op-13", "waiting", { auth_url: URL_A })],
		reads: [op("op-13", "waiting", { auth_url: URL_A })],
	});
	const { flow } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	await flow.reopen();
	assert.deepEqual(scripted.calls.open, [
		{ id: "op-13", reopen: false },
		{ id: "op-13", reopen: true },
	]);
	flow.dispose();
});

test("RELEASED backend: a success that regressed to 'waiting' still settles as succeeded", async (t) => {
	/*
	 * Measured on released backends for Anthropic and Z.AI: the paste future's
	 * `finally` rewrites `state` to "waiting" after the run settled, so the
	 * snapshot reads waiting + "Sign-in complete." forever. Without the message
	 * rule the panel spins until the user gives up.
	 */
	t.mock.timers.enable({ apis: ["setTimeout"] });
	resetSignInRegistry();
	const scripted = backend({
		startReplies: [op("op-14", "starting")],
		reads: [
			op("op-14", "waiting", { auth_url: URL_A }),
			op("op-14", "waiting", { message: "Sign-in complete." }),
		],
	});
	const { flow, succeeded } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS);
	await settle();
	assert.equal(flow.getState().phase, "settled");
	assert.equal(flow.getState().operation.state, "succeeded");
	assert.equal(succeeded.length, 1);
	const reads = scripted.calls.read.length;
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS * 4);
	await settle();
	assert.equal(scripted.calls.read.length, reads, "the poll stopped");
	flow.dispose();
});

test("a spent deadline is expired whatever the state says; a live one is not", () => {
	assert.equal(
		effectiveOperation(op("x", "waiting", { expires_in: 0 })).state,
		"expired",
	);
	assert.equal(
		effectiveOperation(op("x", "input_required", { expires_in: 0 })).state,
		"expired",
	);
	assert.equal(
		effectiveOperation(op("x", "waiting", { expires_in: 30 })).state,
		"waiting",
	);
	assert.equal(
		effectiveOperation(
			op("x", "waiting", {
				message: "Sign-in expired. Start again when you are ready.",
			}),
		).state,
		"expired",
	);
	assert.equal(
		effectiveOperation(
			op("x", "waiting", { message: "Complete sign-in in your browser." }),
		).state,
		"waiting",
		"the live flow's own sentence is not a terminal one",
	);
	assert.equal(
		effectiveOperation(op("x", "starting", { expires_in: 0 })).state,
		"starting",
	);
});
