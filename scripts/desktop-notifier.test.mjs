import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { build } from "esbuild";

/**
 * Delivery-sink tests for the main-process notifier.
 *
 * Bundled in memory from the shipped TypeScript, the same way
 * `desktop-contract.test.mjs` does, so this guards the real module rather than
 * a transcription of it. The electron fixture supplies a FAKE `Notification`
 * that records its constructor arguments: the point of these tests is not that
 * "a notification happened" but that the exact strings the backend composed
 * reached the OS boundary unchanged, and that the ones which must NOT reach it
 * never got there.
 *
 * The ordering assertions (T-U2, T-U3) are the load-bearing ones. A toast the
 * focus gate suppresses must not have claimed cross-surface delivery first, or
 * the completion is marked delivered while nobody was told and no other
 * surface can ever tell them. See docs/design/descriptive-notifications.md 7.3.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/desktop-notifier";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "electron-fixture",
			setup(builder) {
				builder.onResolve({ filter: /^electron$/ }, () => ({
					path: "electron",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `
			export class Notification {
				static isSupported() { return globalThis.__notifySupported; }
				constructor(options) { this.options = options; globalThis.__toasts.push(options); }
				on(event, handler) { this.handlers ??= {}; this.handlers[event] = handler; }
				show() { globalThis.__shown.push(this); }
			}
		`,
					loader: "js",
				}));
			},
		},
	],
});
const { DesktopNotifier } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "123456abcdef";
const TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A composed completion frame, exactly the shape the bridge puts on the wire. */
function completionFrame(overrides = {}) {
	return {
		session_id: SESSION,
		epoch: "abc123",
		seq: 7,
		type: "notification",
		payload: {
			contract: 1,
			kind: "complete",
			title: "Quarterly revenue model",
			status: "Complete",
			body: "Rebuilt the forecast with the Q3 actuals and reconciled the variance.",
			body_is_snippet: true,
			title_is_session_name: true,
			dedupe_key: `complete:${SESSION}:${TOKEN}`,
			completion_token: TOKEN,
			session_name: "Quarterly revenue model",
			focus_policy: "when_unfocused",
			...overrides,
		},
	};
}

function eventFrame(type) {
	return {
		session_id: SESSION,
		epoch: "abc123",
		seq: 11,
		type: "event",
		payload: { type },
	};
}

/**
 * Build a notifier with a recording request sender.
 *
 * `claimed` decides what `sessions.notified` answers; `reject` makes the send
 * throw, which is the transport failure the notifier must fail closed on.
 */
function harness({ claimed = true, status = 200, reject = false } = {}) {
	const requests = [];
	const notifier = new DesktopNotifier(
		() => null,
		async (input) => {
			requests.push(input);
			if (reject) throw new Error("backend unreachable");
			return { status, body: { result: { claimed } } };
		},
	);
	return { notifier, requests };
}

/** Report a window as visible+focused, the only state that gates a completion. */
async function focusWindow(notifier, requests) {
	await notifier.heartbeat(1, {
		sessionId: SESSION,
		subscriptionId: "a".repeat(32),
		visible: true,
		focused: true,
	});
	// The lease is not part of what these tests measure; drop it so `requests`
	// reads as the notification path's traffic alone.
	requests.length = 0;
}

beforeEach(() => {
	globalThis.__toasts = [];
	globalThis.__shown = [];
	globalThis.__notifySupported = true;
});

// T-U1
test("a composed notification reaches the OS with the backend's strings verbatim", async () => {
	const { notifier, requests } = harness();
	const frame = completionFrame();
	notifier.observe(SESSION, frame);
	// The claim is a real await inside `observe`'s fire-and-forget promise.
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(globalThis.__toasts.length, 1);
	assert.equal(globalThis.__shown.length, 1, "the toast was actually shown");
	const toast = globalThis.__toasts[0];
	assert.equal(toast.title, frame.payload.title);
	// Status leads the body: it is the word the user reads in under a second
	// and it must survive on the platforms where `subtitle` does not exist.
	assert.equal(
		toast.body,
		`${frame.payload.status} — ${frame.payload.body}`,
		"status and body are joined, and neither is re-worded",
	);
	assert.equal(toast.silent, false);
	assert.deepEqual(requests, [
		{ op: "sessions.notified", sessionId: SESSION, completionToken: TOKEN },
	]);
});

// T-U2
test("a focused window suppresses the toast AND never takes the claim", async () => {
	const { notifier, requests } = harness();
	await focusWindow(notifier, requests);

	notifier.observe(SESSION, completionFrame());
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(globalThis.__toasts.length, 0);
	// The ordering guarantee. A claim taken here would mark the completion
	// delivered while nobody was told, and no other surface could ever tell
	// them: `claim_delivery` returns false from then on, for good.
	assert.deepEqual(requests, [], "the focus gate runs BEFORE the claim");
});

// T-U2, the other half: `always` is what a gate carries, and it ignores focus.
test("focus_policy 'always' toasts even with a focused window", async () => {
	const { notifier, requests } = harness();
	await focusWindow(notifier, requests);

	notifier.observe(
		SESSION,
		completionFrame({ focus_policy: "always", kind: "ask" }),
	);
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(globalThis.__toasts.length, 1);
});

// T-U3
test("two frames with one dedupe_key produce one toast and one claim", async () => {
	const { notifier, requests } = harness();
	notifier.observe(SESSION, completionFrame());
	notifier.observe(SESSION, completionFrame({ title: "renamed since" }));
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(globalThis.__toasts.length, 1);
	assert.equal(
		requests.length,
		1,
		"the dedupe map collapses before the HTTP claim",
	);

	// A DIFFERENT completion is a different key even on the same session and
	// the same bridge epoch: keying on `session:epoch:seq` is what re-toasted a
	// completion that a reconnect merely re-delivered.
	const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
	notifier.observe(
		SESSION,
		completionFrame({
			completion_token: other,
			dedupe_key: `complete:${SESSION}:${other}`,
		}),
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(globalThis.__toasts.length, 2);
});

// T-U4
test("a lost claim produces no toast", async () => {
	const { notifier, requests } = harness({ claimed: false });
	notifier.observe(SESSION, completionFrame());
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(requests.length, 1, "the claim was attempted");
	assert.equal(
		globalThis.__toasts.length,
		0,
		"another surface owns this completion",
	);
});

// T-U5
test("a rejected or failing claim fails closed", async () => {
	for (const options of [{ reject: true }, { status: 500 }, { status: 404 }]) {
		globalThis.__toasts = [];
		const { notifier } = harness(options);
		notifier.observe(SESSION, completionFrame());
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(
			globalThis.__toasts.length,
			0,
			`failing open would duplicate the banner on every surface: ${JSON.stringify(options)}`,
		);
	}
});

// T-U6
test("with notification_contract >= 1 an agent_end event raises nothing", async () => {
	const { notifier, requests } = harness();
	notifier.setNotificationContract(1);

	notifier.observe(SESSION, eventFrame("agent_end"));
	notifier.observe(SESSION, eventFrame("turn_end"));
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(globalThis.__toasts.length, 0, "the backend owns every toast");
	assert.deepEqual(requests, []);

	// The latch: a backend swapped underneath a running app can compose before
	// the capability read is refreshed, so a frame in hand closes the legacy
	// path on its own.
	const { notifier: fresh } = harness();
	fresh.observe(SESSION, completionFrame());
	await new Promise((resolve) => setImmediate(resolve));
	globalThis.__toasts = [];
	fresh.observe(SESSION, eventFrame("agent_end"));
	assert.equal(
		globalThis.__toasts.length,
		0,
		"a composed frame latches the gate",
	);
});

// T-U7
test("on the legacy path agent_end toasts and turn_end never does", async () => {
	const { notifier } = harness();
	assert.equal(globalThis.__toasts.length, 0);

	// `turn_end` is ONE MODEL CALL finishing. An agentic turn is many of them,
	// and toasting each was the reported defect. It is dropped on every backend
	// version, which is why this assertion sits on the legacy path too.
	notifier.observe(SESSION, eventFrame("turn_end"));
	assert.equal(globalThis.__toasts.length, 0);

	notifier.observe(SESSION, eventFrame("agent_end"));
	assert.equal(globalThis.__toasts.length, 1, "an old backend keeps a signal");
	assert.equal(globalThis.__toasts[0].title, "Turn complete");
	// No status on the canned copy, so no stray separator leaks into the body.
	assert.equal(globalThis.__toasts[0].body, "The agent finished its turn.");
});

// T-U7, boundary: an unfetchable capability must land on legacy, not silence.
test("an absent or malformed capability value falls back to the legacy path", async () => {
	for (const value of [undefined, null, 0, "1", Number.NaN]) {
		globalThis.__toasts = [];
		const { notifier } = harness();
		notifier.setNotificationContract(value);
		notifier.observe(SESSION, eventFrame("agent_end"));
		assert.equal(
			globalThis.__toasts.length,
			1,
			`a missing capability is a transient HTTP failure far more often than an old backend: ${String(value)}`,
		);
	}
});

// T-U8
test("an unknown future frame type is ignored without throwing", async () => {
	const { notifier, requests } = harness();
	for (const frame of [
		{
			session_id: SESSION,
			epoch: "abc123",
			seq: 3,
			type: "something_new",
			payload: {},
		},
		{ session_id: SESSION, type: "heartbeat" },
		{ session_id: SESSION, type: "gap" },
		{
			session_id: SESSION,
			epoch: "abc123",
			seq: 4,
			type: "attention",
			payload: {},
		},
	]) {
		assert.doesNotThrow(() => notifier.observe(SESSION, frame));
	}
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(globalThis.__toasts.length, 0);
	assert.deepEqual(requests, []);
});

// T-U8, the other direction of skew: an unsupported platform stays silent.
test("no toast and no claim when the platform cannot notify", async () => {
	globalThis.__notifySupported = false;
	const { notifier, requests } = harness();
	notifier.observe(SESSION, completionFrame());
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(globalThis.__toasts.length, 0);
	assert.deepEqual(requests, [], "isSupported is checked before the claim");
});

// T-U9
test("an untitled 'ask' gate says Question, not Approval needed", () => {
	const { notifier } = harness();
	const gate = (kind, title) => ({
		session_id: SESSION,
		epoch: "abc123",
		seq: 2,
		type: "frontend.update",
		payload: {
			epoch: "abc123",
			sequence: 2,
			changes: {
				pending_gate: {
					request_id: `req-${kind}-${title}`,
					kind,
					title,
					detail: "Which environment should this deploy to?",
					options: [],
					secret: false,
					question_index: 0,
					question_total: 1,
				},
			},
		},
	});

	// The defect: an untitled question announced an approval, so the user went
	// looking for a yes/no button and found a question.
	notifier.observe(SESSION, gate("ask", ""));
	assert.equal(globalThis.__toasts.at(-1).title, "Question");

	notifier.observe(SESSION, gate("approval", ""));
	assert.equal(globalThis.__toasts.at(-1).title, "Approval needed");

	// A real title still wins over both fallbacks.
	notifier.observe(SESSION, gate("ask", "Choose a deploy target"));
	assert.equal(globalThis.__toasts.at(-1).title, "Choose a deploy target");
	// A gate carries no status, so the detail is the body with no separator.
	assert.equal(
		globalThis.__toasts.at(-1).body,
		"Which environment should this deploy to?",
	);
});

// T-U10
test("the notification path never emits sessions.seen", async () => {
	const { notifier, requests } = harness();
	notifier.observe(SESSION, completionFrame());
	notifier.observe(
		SESSION,
		completionFrame({ kind: "error", dedupe_key: "e1" }),
	);
	notifier.observe(SESSION, eventFrame("agent_end"));
	await new Promise((resolve) => setImmediate(resolve));

	// Notifying is not reading. A delivery claim that advanced the read
	// watermark would clear the sidebar's unseen mark for a session the user
	// never opened, which is why these are two separate watermarks and two
	// separate ops.
	assert.ok(requests.length > 0, "the path did emit something");
	for (const request of requests) {
		assert.notEqual(request.op, "sessions.seen");
		assert.equal(request.op, "sessions.notified");
	}
});

test("refreshNotificationContract reads the capability and survives failure", async () => {
	for (const [response, expected] of [
		[
			{
				status: 200,
				body: { result: { features: { notification_contract: 1 } } },
			},
			0,
		],
		[{ status: 200, body: { result: { features: {} } } }, 1],
		[{ status: 503, body: null }, 1],
		["throw", 1],
	]) {
		globalThis.__toasts = [];
		const notifier = new DesktopNotifier(
			() => null,
			async () => {
				if (response === "throw") throw new Error("unreachable");
				return response;
			},
		);
		await notifier.refreshNotificationContract();
		notifier.observe(SESSION, eventFrame("agent_end"));
		// `expected` is the legacy-toast count: 0 once the backend claims the
		// contract, 1 in every degraded case, because silence loses completions.
		assert.equal(
			globalThis.__toasts.length,
			expected,
			JSON.stringify(response),
		);
	}
});
