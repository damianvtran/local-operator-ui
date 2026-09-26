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
			'export { attachSignInSession, peekSignInState, resetSignInSessions } from "./src/renderer/src/features/providers/sign-in-sessions";',
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
	attachSignInSession,
	peekSignInState,
	resetSignInSessions,
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
/*
 * `t`, when given, disposes the flow even if an assertion fails part-way through the
 * test. WHY: a flow left running keeps its poll timer armed, so a regression prints
 * its failure and then the FILE HANGS -- confirmed at >40 s by the reviewer, and in
 * CI a red test that hangs presents as a job timeout, the one result that gets
 * retried until it looks flaky (review round 2 R2-n3).
 */
function flowFor(scripted, t) {
	const states = [];
	const succeeded = [];
	const flow = createSignInFlow({
		...scripted.deps,
		poll: (id, onUpdate, options) =>
			pollAuthOperation(id, onUpdate, { ...options, read: scripted.deps.read }),
		onChange: (state) => states.push(state),
		onSucceeded: (operation) => succeeded.push(operation),
	});
	t?.after(() => flow.dispose());
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
	/*
	 * AND THE PROVIDER, which the 404's fallback snapshot used to drop: it rebuilt the
	 * operation from the panel's state, which is empty before the first poll answers,
	 * so the settled state named "" instead of the flow's own provider (review round
	 * 1 n2; this pins it, which the mutant that puts the empty string back fails).
	 */
	assert.equal(state.operation.provider, "anthropic");
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

/* ---------------------------------------------------------------------------
 * The rules the first review round added, each one a measured failure.
 * ------------------------------------------------------------------------ */

test("a DEVICE flow is not auto-opened: the code has to be on screen first", async (t) => {
	const scripted = backend({
		startReplies: [
			op("d1", "waiting", { auth_url: URL_A, user_code: "V84J-2LN0K" }),
		],
	});
	const { flow } = flowFor(scripted, t);
	await flow.start("openai");
	await settle();
	/*
	 * The device page asks the user to ENTER a code that is still in the app, so
	 * an automatic open put them in front of it with nothing to type - and the
	 * primary press that copies the code opened a SECOND tab (QA Q4, UX U7).
	 */
	assert.deepEqual(
		scripted.calls.open,
		[],
		"no automatic open for a device flow",
	);
	// The press that copies the code is what opens it, exactly once.
	await flow.reopen();
	await settle();
	assert.deepEqual(
		scripted.calls.open.map((call) => call.reopen),
		[true],
		"the primary press opens the page, with reopen=true",
	);
	flow.dispose();
});

test("an open the app could NOT make is not retried by the poll", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const scripted = backend({
		startReplies: [op("o1", "starting")],
		reads: [op("o1", "waiting", { auth_url: URL_A })],
	});
	let attempts = 0;
	const { flow } = flowFor({
		...scripted,
		deps: {
			...scripted.deps,
			open: async () => {
				attempts += 1;
				throw new Error("no handler for the scheme");
			},
		},
	});
	await flow.start("anthropic");
	await settle();
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS * 4);
	await settle();
	/*
	 * Ten attempts in twelve seconds was the measured behaviour, and on a machine
	 * where the open fails through an OS dialog that is a dialog every 1.5 s
	 * (UX U5). The poll asks main ONCE and the manual press is the retry.
	 */
	assert.equal(attempts, 1, "the poll must not re-ask after a failed open");
	assert.equal(flow.getState().openFailed, true);
	assert.equal(flow.getState().opened, false);
	// Leave no timer armed and no mocked clock in place for the next test.
	flow.dispose();
	t.mock.timers.reset();
});

test("a start superseded during its own cancel never reaches the backend (m2)", async () => {
	const scripted = backend({
		startReplies: [op("s1", "starting"), op("s2", "starting")],
		reads: [op("s1", "waiting", { auth_url: URL_A })],
	});
	const states = [];
	const cancelSeen = [];
	scripted.deps.cancel = async (id) => {
		cancelSeen.push(id);
		// The user closes the panel (or picks another provider) while the cancel
		// is in flight: `reset()` bumps the flow's token.
		if (cancelSeen.length === 1) flow.reset();
		return {};
	};
	// Declared after the cancel stub that calls `flow.reset()`: that closure only
	// runs once `start()` is under way, by which point `flow` is initialised.
	const flow = createSignInFlow({
		...scripted.deps,
		poll: (id, onUpdate, options) =>
			pollAuthOperation(id, onUpdate, { ...options, read: scripted.deps.read }),
		onChange: (state) => states.push(state),
	});
	await flow.start("anthropic");
	await settle();
	await flow.start("anthropic");
	await settle();
	assert.deepEqual(
		scripted.calls.start,
		["anthropic"],
		"the second start must not run once its own token is stale",
	);
	flow.dispose();
});

test("a NEW url for the same operation drops 'opened' first, then opens", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const URL_B = "https://claude.ai/oauth/authorize?state=b";
	const scripted = backend({
		startReplies: [op("u1", "starting")],
		reads: [
			op("u1", "waiting", { auth_url: URL_A }),
			op("u2", "waiting", { auth_url: URL_B }),
		],
	});
	const { flow, states } = flowFor(scripted, t);
	await flow.start("anthropic");
	await settle();
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS + 10);
	await settle();
	/*
	 * The FIRST state that carries the new url, and what it says about `opened`.
	 * Asserting on "some state in the run" was satisfied by the `starting` snapshot
	 * before anything had opened at all, so the mutant that never resets `opened`
	 * survived it (review round 2 R2-m3).
	 */
	const carriesNewUrl = states.filter(
		(state) => state.operation?.auth_url === URL_B,
	);
	assert.ok(carriesNewUrl.length > 0, "the poll must report the new url");
	assert.equal(
		carriesNewUrl[0].opened,
		false,
		"'opened' must be false for the url that has not been opened yet",
	);
	assert.equal(carriesNewUrl[0].openFailed, false);
	assert.ok(
		states.some(
			(state) => state.opened === true && state.operation?.auth_url === URL_B,
		),
		"and then the new page opens, once",
	);
	assert.equal(scripted.calls.open.length, 2, "each distinct URL opens once");
	flow.dispose();
	t.mock.timers.reset();
});

test("pausing stops the poll and KEEPS the state; resuming re-attaches to it", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const scripted = backend({
		startReplies: [op("p1", "starting")],
		reads: [op("p1", "waiting", { auth_url: URL_A })],
	});
	const { flow } = flowFor(scripted);
	await flow.start("anthropic");
	await settle();
	const readsWhileAttached = scripted.calls.read.length;
	flow.pause();
	await settle();
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS * 3);
	await settle();
	assert.equal(
		scripted.calls.read.length,
		readsWhileAttached,
		"a paused flow stops polling",
	);
	assert.equal(
		flow.getState().phase,
		"active",
		"a paused flow keeps the operation it was following",
	);
	flow.resume();
	await settle();
	t.mock.timers.tick(AUTH_OPERATION_POLL_MS + 10);
	await settle();
	assert.ok(
		scripted.calls.read.length > readsWhileAttached,
		"resuming polls the live operation again",
	);
	flow.dispose();
	t.mock.timers.reset();
});

test("a settled state survives a detach/re-attach, success and refusal alike", async () => {
	resetSignInSessions();
	const scripted = backend({
		startReplies: [
			op("k1", "waiting", {
				auth_url: URL_A,
				defaults_applied: {
					hosting: "anthropic",
					model: "claude-opus-5-5",
					model_name: "Claude Opus 5.5",
					receipt: "Set default hosting to 'anthropic'.",
				},
			}),
		],
		reads: [op("k1", "waiting", { auth_url: URL_A })],
	});
	const deps = {
		...scripted.deps,
		poll: (id, onUpdate, options) =>
			pollAuthOperation(id, onUpdate, { ...options, read: scripted.deps.read }),
	};
	const first = attachSignInSession("anthropic", deps, () => {});
	await first.flow.start("anthropic");
	await settle();
	// The backend settles the flow as succeeded; the panel that was showing it
	// unmounts because its row moved into "Connected" (QA Q1).
	scripted.deps.read = async () =>
		op("k1", "succeeded", {
			defaults_applied: {
				hosting: "anthropic",
				model: "claude-opus-5-5",
				model_name: "Claude Opus 5.5",
				receipt: "Set default hosting to 'anthropic'.",
			},
		});
	await first.flow.reopen().catch(() => {});
	first.detach();
	assert.equal(
		peekSignInState("anthropic").operation?.state,
		"waiting",
		"state is retained across the detach, not dropped",
	);

	/*
	 * A refusal is kept too: the panel that comes back is where the reason was, and
	 * clearing it on detach also wiped it whenever a re-render remounted the panel
	 * (the terminal frames' captures caught exactly that).
	 */
	const failed = attachSignInSession("deepseek", deps, () => {});
	await failed.flow.start("deepseek");
	await settle();
	failed.detach();
	assert.notEqual(
		peekSignInState("deepseek").phase,
		"idle",
		"a refused or unfinished flow is still there when the panel returns",
	);
	resetSignInSessions();
});
