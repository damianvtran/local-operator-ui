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
 * `contract` is what `capabilities` reports, so a test can stand up a backend
 * that advertises the composed contract without reaching past the public API.
 */
function harness({
	claimed = true,
	status = 200,
	reject = false,
	contract = undefined,
} = {}) {
	const requests = [];
	const notifier = new DesktopNotifier(
		() => null,
		async (input) => {
			requests.push(input);
			if (reject) throw new Error("backend unreachable");
			if (input?.op === "capabilities") {
				return {
					status: 200,
					body: {
						result: {
							features:
								contract === undefined
									? {}
									: { notification_contract: contract },
						},
					},
				};
			}
			return { status, body: { result: { claimed } } };
		},
	);
	return { notifier, requests };
}

/**
 * A sender that is DEAD until `up()` is called, then answers as a backend
 * advertising the composed notification contract.
 *
 * This is the cold-start harness R1 needed and the original could not express.
 * Every other harness here constructs a sender that is already answering,
 * which is precisely why the whole suite missed a capability read issued
 * before `backendService.start()` had minted the desktop token: against an
 * always-up sender that read succeeds and the gate closes, while on the
 * shipped self-managed path it hit a dead port and the legacy toast stayed
 * live. `requests` records only what actually reached a live backend.
 */
function coldBackend({ contract = 1 } = {}) {
	const requests = [];
	const attempts = [];
	let live = false;
	const notifier = new DesktopNotifier(() => null, async (input) => {
		attempts.push(input);
		if (!live) throw new Error("connect ECONNREFUSED 127.0.0.1:1111");
		requests.push(input);
		if (input?.op === "capabilities") {
			return {
				status: 200,
				body: { result: { features: { notification_contract: contract } } },
			};
		}
		return { status: 200, body: { result: { claimed: true } } };
	});
	return { notifier, requests, attempts, up: () => { live = true; } };
}

/** Let every queued microtask and the probe's retry timers drain. */
async function settle(ms = 1200) {
	await new Promise((resolve) => setTimeout(resolve, ms));
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

// T-U13 — M1. A failed claim must not burn the dedupe key.
test("a transport-failed claim leaves the completion retryable", async () => {
	for (const failure of [{ reject: true }, { status: 503 }, { status: 422 }]) {
		globalThis.__toasts = [];
		// Window A's claim fails; the completion is announced nowhere and the
		// backend never advanced `claim_delivery`, so it is still owed. Design
		// 7.5: a second Electron window on the same session replays a frame with
		// the SAME `dedupe_key`, which is the natural retry.
		let broken = true;
		const requests = [];
		const notifier = new DesktopNotifier(() => null, async (input) => {
			requests.push(input);
			if (broken) {
				if (failure.reject) throw new Error("backend unreachable");
				return { status: failure.status, body: null };
			}
			return { status: 200, body: { result: { claimed: true } } };
		});

		notifier.observe(SESSION, completionFrame());
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(globalThis.__toasts.length, 0, "still fails closed on the toast");

		broken = false;
		notifier.observe(SESSION, completionFrame());
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(
			requests.length,
			2,
			`the retry re-attempted the claim: ${JSON.stringify(failure)}`,
		);
		assert.equal(
			globalThis.__toasts.length,
			1,
			`the completion reached a surface on retry: ${JSON.stringify(failure)}`,
		);
	}
});

// T-U13, the converse: a CLEAN loss keeps the key, because another surface
// genuinely owns that completion and re-attempting only re-loses the race.
test("a cleanly lost claim is not retried", async () => {
	const { notifier, requests } = harness({ claimed: false });
	notifier.observe(SESSION, completionFrame());
	await new Promise((resolve) => setImmediate(resolve));
	notifier.observe(SESSION, completionFrame());
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(requests.length, 1, "the backend answered; the key stays spent");
	assert.equal(globalThis.__toasts.length, 0);
});

// T-U14 — D2. The status leads only a model-written snippet.
test("the status leads a snippet body and never a house body", async () => {
	const { notifier } = harness();

	// A snippet does not say the outcome, so the category in front of it is the
	// only thing that does.
	notifier.observe(SESSION, completionFrame());
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		globalThis.__toasts.at(-1).body,
		"Complete — Rebuilt the forecast with the Q3 actuals and reconciled the variance.",
	);

	// A house body already names the state. "Complete — Task complete" asserted
	// one fact twice in the two lines a banner gets, and it is what every user
	// with the session-name privacy flag off received.
	notifier.observe(
		SESSION,
		completionFrame({
			body: "Task complete",
			body_is_snippet: false,
			dedupe_key: "complete:house:1",
			completion_token: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
		}),
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(globalThis.__toasts.at(-1).body, "Task complete");

	notifier.observe(
		SESSION,
		completionFrame({
			kind: "error",
			status: "Needs attention",
			body: "Stopped with an error",
			body_is_snippet: false,
			dedupe_key: "complete:house:2",
			completion_token: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
		}),
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(globalThis.__toasts.at(-1).body, "Stopped with an error");
});

// T-U6
test("with notification_contract >= 1 an agent_end event raises nothing", async () => {
	const { notifier, requests } = harness();
	notifier.setNotificationContract(1);

	notifier.observe(SESSION, eventFrame("agent_end"));
	notifier.observe(SESSION, eventFrame("turn_end"));
	await settle(50);

	assert.equal(globalThis.__toasts.length, 0, "the backend owns every toast");
	assert.deepEqual(requests, []);
});

// T-U11 — R1. The cold-start ordering, which the old harness could not express.
test("a capability read issued before the backend is up raises no legacy toast", async () => {
	const { notifier, attempts, up } = coldBackend();

	// Exactly the shipped sequence: the app asks while the backend is still
	// dead (this is what `app.whenReady()` used to do), the backend comes up,
	// then the turn's `agent_end` arrives on the stream BEFORE the composed
	// frame, which follows from the backend's 1 s attention poll.
	notifier.refreshNotificationContract();
	await settle();
	assert.ok(
		attempts.some((a) => a?.op === "capabilities"),
		"the read was attempted against the dead port",
	);

	// NO re-read here, deliberately: this test replays the wiring as it was,
	// where `app.whenReady()` issued the one and only capability read. Adding a
	// second read would test the new call site rather than the defect, and the
	// defect is that a single lost read leaves the gate reading "no contract"
	// forever. The notifier must recover from it on its own.
	up();

	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(50);
	notifier.observe(SESSION, completionFrame());
	await settle(50);

	// The old ordering produced two banners here: "Turn complete" from the
	// legacy path plus the composed one. That is the defect this PR exists to
	// remove, and it reproduced on the ordinary self-managed cold start.
	assert.deepEqual(
		globalThis.__toasts.map((t) => t.title),
		["Quarterly revenue model"],
		"one turn, one banner",
	);
});

// T-U11b — the same window without any re-read at all: the legacy toast must
// wait for an answer rather than assume there is no contract.
test("agent_end arriving before any capability answer does not toast on a composing backend", async () => {
	const { notifier, up } = coldBackend();

	// No explicit refresh: the notifier has never asked. A notifier that has
	// not asked is indistinguishable from one told "no contract", and guessing
	// "no contract" is exactly the double banner. It must ask, not guess.
	up();
	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(100);

	assert.equal(
		globalThis.__toasts.length,
		0,
		"the legacy toast is deferred until the contract read settles",
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
	await settle(50);
	assert.equal(globalThis.__toasts.length, 0);

	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(50);
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
		await settle(50);
		assert.equal(
			globalThis.__toasts.length,
			1,
			`a missing capability is a transient HTTP failure far more often than an old backend: ${String(value)}`,
		);
	}
});

// T-U12 — M2. The capability read is re-readable in BOTH directions, which is
// what replaced the one-way latch.
test("a downgrade to an older backend restores the legacy completion signal", async () => {
	// ONE notifier whose backend is swapped underneath it, which is the real
	// shape of the case: a health-check restart or external-backend discovery
	// replaces the process, the app does not.
	let features = { notification_contract: 1 };
	const notifier = new DesktopNotifier(() => null, async (input) =>
		input?.op === "capabilities"
			? { status: 200, body: { result: { features } } }
			: { status: 200, body: { result: { claimed: true } } },
	);

	await notifier.refreshNotificationContract();
	// A composed frame arrives and is delivered, so this run has genuinely seen
	// the new backend compose — the state the old one-way latch made permanent.
	notifier.observe(SESSION, completionFrame());
	await settle(50);
	assert.equal(globalThis.__toasts.length, 1);
	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(50);
	assert.equal(globalThis.__toasts.length, 1, "the new backend owns toasts");

	// Now an OLDER backend. Design 4.3 names this direction explicitly. Under
	// the one-way latch the session went silent on completions for the rest of
	// the run: the latch blocked the legacy path and the old backend emits no
	// composed frames, so nothing was left to tell the user anything.
	features = {};
	await notifier.refreshNotificationContract();
	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(50);
	assert.equal(
		globalThis.__toasts.length,
		2,
		"an old backend emits no composed frames, so its legacy signal must return",
	);
	assert.equal(globalThis.__toasts.at(-1).title, "Turn complete");
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

/** A `pending_gate` on a frontend update, the way a gate really arrives. */
function gateFrame(overrides = {}) {
	return {
		session_id: SESSION,
		epoch: "abc123",
		seq: 2,
		type: "frontend.update",
		payload: {
			epoch: "abc123",
			sequence: 2,
			changes: {
				pending_gate: {
					request_id: `req-${JSON.stringify(overrides)}`,
					kind: "ask",
					title: "",
					detail: "Which environment should this deploy to?",
					options: [],
					secret: false,
					question_index: 0,
					question_total: 1,
					...overrides,
				},
			},
		},
	};
}

// T-U15 — D3. A named gate takes the completion banner's shape, so the banner
// the user is BLOCKED on can be triaged without clicking it.
test("a gate carrying session_name titles the banner with the session", () => {
	const { notifier } = harness();

	notifier.observe(
		SESSION,
		gateFrame({
			kind: "approval",
			title: "Run database migration",
			detail: "This applies 00061 to the prod-2 cluster.",
			session_name: "Nightly ETL backfill",
		}),
	);
	assert.equal(globalThis.__toasts.at(-1).title, "Nightly ETL backfill");
	assert.equal(
		globalThis.__toasts.at(-1).body,
		"Run database migration: This applies 00061 to the prod-2 cluster.",
		"the gate's own title leads the detail",
	);

	// An untitled ask keeps "Question" as the leading word, named or not.
	notifier.observe(
		SESSION,
		gateFrame({ session_name: "Quarterly revenue model" }),
	);
	assert.equal(globalThis.__toasts.at(-1).title, "Quarterly revenue model");
	assert.equal(
		globalThis.__toasts.at(-1).body,
		"Question: Which environment should this deploy to?",
	);
});

// T-U15b — D3, the other direction of skew. The field is additive and optional:
// absent on an older backend, empty when the backend's privacy flag is off.
// Both must render exactly as they did before this PR, and neither may make the
// app resolve the name itself — that would leak a name the user opted out of.
test("a gate with no session_name renders unchanged", () => {
	for (const nameless of [
		{},
		{ session_name: null },
		{ session_name: "" },
		{ session_name: "   " },
	]) {
		globalThis.__toasts = [];
		const { notifier } = harness();
		notifier.observe(
			SESSION,
			gateFrame({ kind: "approval", title: "Run database migration", ...nameless }),
		);
		assert.equal(
			globalThis.__toasts.at(-1).title,
			"Run database migration",
			JSON.stringify(nameless),
		);
		assert.equal(
			globalThis.__toasts.at(-1).body,
			"Which environment should this deploy to?",
		);
	}
});

// T-U16 — D6. An empty detail used to render a banner with a title and no body.
test("a gate with an empty detail still renders a body", () => {
	const { notifier } = harness();

	notifier.observe(SESSION, gateFrame({ detail: "" }));
	assert.equal(globalThis.__toasts.at(-1).title, "Question");
	assert.equal(globalThis.__toasts.at(-1).body, "Question");

	// A titled gate with no detail puts the title where the body is, so the
	// banner says what it is asking about rather than only its category.
	notifier.observe(
		SESSION,
		gateFrame({ kind: "approval", title: "Run database migration", detail: "  " }),
	);
	assert.equal(globalThis.__toasts.at(-1).title, "Approval needed");
	assert.equal(globalThis.__toasts.at(-1).body, "Run database migration");

	// Named, with nothing else: the session leads and the category is the body.
	notifier.observe(
		SESSION,
		gateFrame({ detail: "", session_name: "Nightly ETL backfill" }),
	);
	assert.equal(globalThis.__toasts.at(-1).title, "Nightly ETL backfill");
	assert.equal(globalThis.__toasts.at(-1).body, "Question");
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
	await settle(50);

	// Notifying is not reading. A delivery claim that advanced the read
	// watermark would clear the sidebar's unseen mark for a session the user
	// never opened, which is why these are two separate watermarks and two
	// separate ops.
	assert.ok(requests.length > 0, "the path did emit something");
	for (const request of requests) {
		assert.notEqual(request.op, "sessions.seen");
		// `capabilities` is the gate read the legacy path waits on, not a
		// notification; everything else on this path is the delivery claim.
		assert.ok(
			request.op === "sessions.notified" || request.op === "capabilities",
			`unexpected op on the notification path: ${request.op}`,
		);
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
		// The legacy toast waits on an ANSWERED contract read. A 200 answers
		// immediately; a 503 or a throw never answered, so the toast re-probes
		// (3 attempts, 250 ms apart) before falling back. Wait past that budget:
		// the fallback is what keeps a transient HTTP failure from losing a
		// completion, and the point of this test is that it still happens.
		await settle(1200);
		// `expected` is the legacy-toast count: 0 once the backend claims the
		// contract, 1 in every degraded case, because silence loses completions.
		assert.equal(
			globalThis.__toasts.length,
			expected,
			JSON.stringify(response),
		);
	}
});
