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
	const notifier = new DesktopNotifier(
		() => null,
		async (input) => {
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
		},
	);
	return {
		notifier,
		requests,
		attempts,
		up: () => {
			live = true;
		},
	};
}

/**
 * A backend whose capability endpoint can be taken DOWN AFTER it has answered.
 *
 * `coldBackend` only goes dead -> live, which is the cold start. R2-1 is the
 * other direction and it is the one that reaches an ordinary run: a
 * health-check restart brings `/health` back (which is what gates the ready
 * hook) while `/v1/capabilities` is still warming, so the re-probe issued by
 * that hook fails on a backend that never stopped composing.
 *
 * The failure is returned as a 503 rather than thrown because that is what the
 * real transport does with it: `requestDesktop` catches the fetch error and
 * answers `{status: 503}` (`src/main/desktop-transport.ts`). A test that threw
 * here would exercise a path production cannot take.
 */
function restartableBackend({ contract = 1 } = {}) {
	const attempts = [];
	let capabilitiesUp = true;
	const notifier = new DesktopNotifier(
		() => null,
		async (input) => {
			attempts.push(input);
			if (input?.op === "capabilities") {
				if (!capabilitiesUp) {
					return {
						status: 503,
						body: { detail: "The backend could not complete this request." },
					};
				}
				return {
					status: 200,
					body: { result: { features: { notification_contract: contract } } },
				};
			}
			return { status: 200, body: { result: { claimed: true } } };
		},
	);
	return {
		notifier,
		attempts,
		capabilitiesDown: () => {
			capabilitiesUp = false;
		},
		capabilitiesUpAgain: () => {
			capabilitiesUp = true;
		},
	};
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
		const notifier = new DesktopNotifier(
			() => null,
			async (input) => {
				requests.push(input);
				if (broken) {
					if (failure.reject) throw new Error("backend unreachable");
					return { status: failure.status, body: null };
				}
				return { status: 200, body: { result: { claimed: true } } };
			},
		);

		notifier.observe(SESSION, completionFrame());
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(
			globalThis.__toasts.length,
			0,
			"still fails closed on the toast",
		);

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

// T-U15 — Q-1. The third kind of body, which the two-way split above missed.
test("the status leads the session's own failure text", async () => {
	const { notifier } = harness();

	// The backend's real shape for a classified failure: NOT a snippet (the
	// last assistant line would assert success beside a failed state), but not
	// a house constant either, so nothing in it names the outcome. This is the
	// default path — the same privacy flag that yields a session name yields
	// this text — and without the status it reads as routine log noise.
	notifier.observe(
		SESSION,
		completionFrame({
			kind: "error",
			status: "Needs attention",
			body: "anthropic: 429 rate_limit_error - credit balance too low",
			body_is_snippet: false,
			body_is_failure: true,
			dedupe_key: "complete:failure:1",
			completion_token: "ffffffff-ffff-4fff-8fff-ffffffffffff",
		}),
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		globalThis.__toasts.at(-1).body,
		"Needs attention — anthropic: 429 rate_limit_error - credit balance too low",
	);

	// The flag is additive and optional on the wire. A backend old enough to
	// send a failure summary without it degrades to the bare body rather than
	// throwing on the missing field.
	notifier.observe(
		SESSION,
		completionFrame({
			kind: "error",
			status: "Needs attention",
			body: "anthropic: 429 rate_limit_error - credit balance too low",
			body_is_snippet: false,
			dedupe_key: "complete:failure:2",
			completion_token: "ffffffff-ffff-4fff-8fff-fffffffffff0",
		}),
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		globalThis.__toasts.at(-1).body,
		"anthropic: 429 rate_limit_error - credit balance too low",
	);
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
	const notifier = new DesktopNotifier(
		() => null,
		async (input) =>
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

// T-U18 — R2-1. The restart that put the double banner back, and kept it back.
test("a failed re-probe never invalidates a contract the backend already answered", async () => {
	const { notifier, attempts, capabilitiesDown, capabilitiesUpAgain } =
		restartableBackend();

	// t0 — the ready hook fires on a healthy backend and the read answers.
	await notifier.refreshNotificationContract();
	notifier.observe(SESSION, completionFrame());
	await settle(50);
	assert.equal(
		globalThis.__toasts.length,
		1,
		"the composed frame is delivered",
	);
	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(50);
	assert.equal(
		globalThis.__toasts.length,
		1,
		"the composed backend owns the toast",
	);

	// t1 — a health-check restart. `/health` is what gates the ready hook, and
	// it recovers first; `/v1/capabilities` is still warming, so all three probe
	// attempts take the failure tail. The backend never stopped composing.
	capabilitiesDown();
	await notifier.refreshNotificationContract();
	const afterProbe = attempts.length;

	// t2 — the next turn on that same still-composing backend. Under the old
	// state machine the failed probe had reset the contract to 0 while leaving
	// `contractAnswered` true, so `awaitContract` declined to re-ask and the
	// legacy toast fired beside the composed frame — two banners for one turn,
	// and STICKY, because nothing cleared that pair until the next bounce.
	capabilitiesUpAgain();
	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(1200);
	assert.equal(
		globalThis.__toasts.length,
		1,
		"a failed probe taught nothing, so the answered contract still holds",
	);
	assert.equal(
		attempts.length,
		afterProbe,
		"and no re-ask was needed: the contract was never invalidated",
	);

	// The stickiness is the reason this is a blocker rather than a major, so it
	// is asserted rather than assumed: a second turn must not double either.
	notifier.observe(SESSION, completionFrame({ dedupe_key: "c2" }));
	await settle(50);
	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(1200);
	assert.deepEqual(
		globalThis.__toasts.map((t) => t.title),
		["Quarterly revenue model", "Quarterly revenue model"],
		"one banner per turn, on every subsequent turn",
	);
});

// T-U18b — R2-1's converse. Not writing on failure must not cost the downgrade
// path, which is the reason the reset existed at all (design 4.3).
test("a successful re-read still restores the legacy path on a downgrade", async () => {
	// A SUCCESSFUL read returning no key is what an old backend looks like, and
	// it is the only thing entitled to move the contract back to 0. T-U12 covers
	// the delivery side; this pins that the R2-1 fix did not break the mechanism
	// by making the failure tail inert.
	let features = { notification_contract: 1 };
	let fail = false;
	const notifier = new DesktopNotifier(
		() => null,
		async (input) =>
			input?.op === "capabilities"
				? fail
					? { status: 503, body: null }
					: { status: 200, body: { result: { features } } }
				: { status: 200, body: { result: { claimed: true } } },
	);

	await notifier.refreshNotificationContract();
	// A failing probe in between changes nothing, in either direction.
	fail = true;
	await notifier.refreshNotificationContract();
	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(1200);
	assert.equal(globalThis.__toasts.length, 0, "still on the composed backend");

	fail = false;
	features = {};
	await notifier.refreshNotificationContract();
	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(50);
	assert.equal(globalThis.__toasts.at(-1)?.title, "Turn complete");
});

// T-U19 — R2-2. Two ready hooks in one tick raced, and the loser won.
test("the newest capability read wins even when an older one settles last", async () => {
	// Probe #1 answers `contract = 1` but is SLOW; probe #2 is started after it
	// and fails fast against a blip. Ordering by settlement puts the failure
	// last; ordering by recency — which is what a generation guard buys — puts
	// probe #2 last and keeps it from being overruled by a read taken earlier.
	const order = [];
	let call = 0;
	const notifier = new DesktopNotifier(
		() => null,
		async (input) => {
			if (input?.op !== "capabilities")
				return { status: 200, body: { result: { claimed: true } } };
			call++;
			if (call === 1) {
				// Settles AFTER probe #2 has already finished all three attempts.
				await new Promise((resolve) => setTimeout(resolve, 900));
				order.push("slow-200");
				return {
					status: 200,
					body: { result: { features: { notification_contract: 1 } } },
				};
			}
			order.push(`fast-503-${call}`);
			return { status: 503, body: null };
		},
	);

	const first = notifier.refreshNotificationContract();
	const second = notifier.refreshNotificationContract();
	await Promise.all([first, second]);
	await settle(1200);

	assert.equal(
		order.at(-1),
		"slow-200",
		"the stale probe really did settle last, which is the race being pinned",
	);
	// Probe #2 is the newest read and it learned nothing, so the contract is
	// whatever it was before — 0, never answered — and the legacy path re-asks
	// rather than being handed a stale probe's answer.
	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(1200);
	assert.equal(
		globalThis.__toasts.length,
		1,
		"a never-answered contract falls back to the legacy toast, not to a stale 1",
	);
});

// T-U19b — the same guard from the other side: a directly SET contract is the
// newest reading, so an older in-flight probe must not settle on top of it.
test("a directly set contract is not overwritten by an older in-flight probe", async () => {
	const notifier = new DesktopNotifier(
		() => null,
		async (input) =>
			input?.op === "capabilities"
				? await new Promise((resolve) =>
						setTimeout(
							() =>
								resolve({ status: 200, body: { result: { features: {} } } }),
							300,
						),
					)
				: { status: 200, body: { result: { claimed: true } } },
	);

	const stale = notifier.refreshNotificationContract();
	notifier.setNotificationContract(1);
	await stale;
	await settle(50);

	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(1200);
	assert.equal(
		globalThis.__toasts.length,
		0,
		"the newer direct answer stands; the older probe's 200 does not overrule it",
	);
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
			gateFrame({
				kind: "approval",
				title: "Run database migration",
				...nameless,
			}),
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

// T-U16 — D6/D3-2. An empty detail used to render a banner with a title and no
// body, and then a bare tool name. Both fall back to the house vocabulary now,
// which is what `compose.py::gate_body` does with the same input.
test("a gate with an empty detail still renders a body", () => {
	const { notifier } = harness();

	notifier.observe(SESSION, gateFrame({ detail: "" }));
	assert.equal(globalThis.__toasts.at(-1).title, "Question");
	assert.equal(
		globalThis.__toasts.at(-1).body,
		"Waiting for your answer",
		"not 'Question' twice: the body says what is being waited on",
	);

	// D3-2, the case that reaches a real tool: `_describe_path_approval` returns
	// "" for a blank path argument, so a detail-less `write` approval is not a
	// malformed payload. It used to render the bare verb `write` as the entire
	// body — a word, where the backend deliberately shows a sentence.
	notifier.observe(
		SESSION,
		gateFrame({ kind: "approval", title: "write", detail: "" }),
	);
	assert.equal(globalThis.__toasts.at(-1).title, "write");
	assert.equal(globalThis.__toasts.at(-1).body, "Waiting for approval");

	notifier.observe(
		SESSION,
		gateFrame({
			kind: "approval",
			title: "Run database migration",
			detail: "  ",
		}),
	);
	assert.equal(globalThis.__toasts.at(-1).title, "Run database migration");
	assert.equal(globalThis.__toasts.at(-1).body, "Waiting for approval");

	// Named, with nothing else: the session leads and the house body follows.
	notifier.observe(
		SESSION,
		gateFrame({ detail: "", session_name: "Nightly ETL backfill" }),
	);
	assert.equal(globalThis.__toasts.at(-1).title, "Nightly ETL backfill");
	assert.equal(globalThis.__toasts.at(-1).body, "Waiting for your answer");
});

// T-U16b — D3-3. A whitespace-only title is truthy, so the fallback never fired
// and macOS filled the empty title line with the posting app's name.
test("a whitespace-only gate title falls back to the category", () => {
	const { notifier } = harness();

	notifier.observe(SESSION, gateFrame({ title: "   " }));
	assert.equal(globalThis.__toasts.at(-1).title, "Question");
	assert.equal(
		globalThis.__toasts.at(-1).body,
		"Which environment should this deploy to?",
	);

	notifier.observe(
		SESSION,
		gateFrame({
			kind: "approval",
			title: "\t\n",
			detail: "Delete the staging bucket.",
		}),
	);
	assert.equal(globalThis.__toasts.at(-1).title, "Approval needed");
	assert.equal(globalThis.__toasts.at(-1).body, "Delete the staging bucket.");
});

// T-U17 — D3-1. THE input the tools actually emit, which the round-2 fixture
// did not: for a tool approval the title IS the tool name and the detail
// already leads with it, so the naive join said the word twice.
//
// These vectors are `compose.py::gate_body`'s own, from
// `tests/unit/notifications/test_compose.py::test_a_gate_body_does_not_repeat_the_tool_name`.
// Duplicating them here is the only drift check available across the two
// repositories: if the backend's rule changes, this file is where the UI's copy
// of it is pinned.
test("a named tool approval does not repeat the tool name", () => {
	const { notifier } = harness();

	// `build_write_tool` has name="write" and `_approval_description` returns
	// `f"{action}: {target}"`, so this exact pair is what arrives.
	notifier.observe(
		SESSION,
		gateFrame({
			kind: "approval",
			title: "write",
			detail: "write: /Users/damian/notes.md",
			session_name: "Nightly ETL backfill",
		}),
	);
	assert.equal(globalThis.__toasts.at(-1).title, "Nightly ETL backfill");
	assert.equal(
		globalThis.__toasts.at(-1).body,
		"write: /Users/damian/notes.md",
		"not 'write: write: /Users/damian/notes.md'",
	);
	assert.equal(
		globalThis.__toasts.at(-1).body.match(/write:/g).length,
		1,
		"the action word appears once",
	);

	// `_describe_shell_approval` emits "run: <command>" under the title `bash`,
	// which does NOT overlap — so the prefix must still be applied. This is the
	// case the rule must not over-correct into dropping the tool name.
	notifier.observe(
		SESSION,
		gateFrame({
			kind: "approval",
			title: "bash",
			detail: "run: rm -rf build/",
			session_name: "Nightly ETL backfill",
		}),
	);
	assert.equal(
		globalThis.__toasts.at(-1).body,
		"bash: run: rm -rf build/",
		"a non-overlapping detail still gets the tool name",
	);

	// Case-insensitive, as the backend's `.lower()` comparison is.
	notifier.observe(
		SESSION,
		gateFrame({
			kind: "approval",
			title: "Edit",
			detail: "edit: /Users/d/src/app.ts",
			session_name: "Quarterly revenue model",
		}),
	);
	assert.equal(globalThis.__toasts.at(-1).body, "edit: /Users/d/src/app.ts");

	// The NAMELESS branch renders the same approval with the tool name on the
	// title line, so the body must not carry it a second time either.
	notifier.observe(
		SESSION,
		gateFrame({
			kind: "approval",
			title: "write",
			detail: "write: /Users/damian/notes.md",
		}),
	);
	assert.equal(globalThis.__toasts.at(-1).title, "write");
	assert.equal(
		globalThis.__toasts.at(-1).body,
		"write: /Users/damian/notes.md",
	);
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

/**
 * The launch plan's raise policy, threaded in as `windowRaise`.
 *
 * Why these cases: a headless run is an agent driving this app on the operator's
 * machine, and there are exactly two ways it could still interrupt them — a
 * banner delivered to a screen nobody is watching this app on, and a click on
 * that banner raising a window the mode promises never to show. The click path
 * is the one that needs the gate most, because `focusable: false` does NOT stop
 * a shown window from activating the app (measured on Electron 35.5.1 / macOS:
 * a non-focusable window, shown, made the app frontmost while `isFocused()`
 * stayed false). The only thing between a headless run and the operator's focus
 * is that nothing raises the window.
 */
function raiseHarness(windowRaise, host = undefined) {
	const calls = [];
	/*
	 * The trigger line each raise reports. Asserted rather than ignored because
	 * this path was indistinguishable from the second-instance one in the log
	 * file: the operator's report ("the app steals my focus whenever a chat
	 * completes") is only answerable if the line names WHO raised the window.
	 */
	const raises = [];
	const target = {
		id: 7,
		isDestroyed: () => false,
		show: () => calls.push("show"),
		showInactive: () => calls.push("showInactive"),
		focus: () => calls.push("focus"),
		isMinimized: () => false,
		restore: () => calls.push("restore"),
		webContents: { send: (channel) => calls.push(`send:${channel}`) },
	};
	const requests = [];
	const notifier = new DesktopNotifier(
		() => target,
		async (input) => {
			requests.push(input);
			return { status: 200, body: { result: { claimed: true } } };
		},
		windowRaise,
		host,
		(line) => raises.push(line),
	);
	return { notifier, calls, requests, target, raises };
}

test("a headless run delivers no banner on any path, and burns no claim", async () => {
	// The composed completion is the case that matters: its cross-surface claim
	// is taken "immediately before delivery" (design 7.3), so delivering nothing
	// has to mean claiming nothing, or the completion is marked delivered to a
	// surface that never showed it.
	const { notifier, requests } = raiseHarness("never");
	notifier.observe(SESSION, completionFrame());
	notifier.observe(SESSION, gateFrame());
	notifier.observe(SESSION, eventFrame("agent_end"));
	await settle(100);

	assert.equal(globalThis.__toasts.length, 0, "no toast on a headless run");
	assert.equal(globalThis.__shown.length, 0, "no banner reached the OS");
	assert.deepEqual(
		requests,
		[],
		"no capability read, no claim: nothing is burned",
	);
});

test("the same three paths do deliver in the ordinary mode", async () => {
	// The control for the test above: without it, a notifier that delivered
	// nothing at all would pass it.
	const { notifier, requests } = raiseHarness("focus");
	notifier.observe(SESSION, completionFrame());
	await settle(100);
	assert.equal(globalThis.__shown.length, 1, "the completion reached the OS");
	assert.equal(
		requests.filter((input) => input?.op === "sessions.notified").length,
		1,
		"and it took the cross-surface claim on the way",
	);
});

test("a clicked banner raises the window only as far as the plan allows", async () => {
	const cases = [
		// mode, what the click is allowed to do, and the trigger line it reports
		//
		// SEND FIRST, THEN RAISE (B3): naming the conversation before showing the
		// window is what stops the click flashing the conversation the window was
		// already on, which reads as a click that landed on the wrong row.
		[
			"focus",
			["send:desktop-open-conversation", "show", "focus"],
			["trigger=banner-click requested=focus applied=show+focus"],
		],
		[
			"inactive",
			["send:desktop-open-conversation", "showInactive"],
			["trigger=banner-click requested=inactive applied=showInactive"],
		],
	];
	for (const [mode, expected, expectedRaises] of cases) {
		globalThis.__toasts = [];
		globalThis.__shown = [];
		const { notifier, calls, raises } = raiseHarness(mode);
		notifier.observe(SESSION, completionFrame());
		await settle(100);
		const banner = globalThis.__shown[0];
		assert.ok(banner, `${mode}: the banner is delivered`);
		// A real click, through the handler the OS would call.
		banner.handlers.click();
		assert.deepEqual(calls, expected, `${mode}: the window was raised`);
		assert.deepEqual(raises, expectedRaises, `${mode}: the raise named its trigger`);
	}

	// `headless` is covered by the absence of the handler itself: no banner, so
	// nothing to click and no path to a window the mode never shows.
	globalThis.__toasts = [];
	globalThis.__shown = [];
	const { notifier, calls, raises } = raiseHarness("never");
	notifier.observe(SESSION, completionFrame());
	await settle(100);
	assert.equal(globalThis.__shown.length, 0);
	assert.deepEqual(calls, []);
	// And a mode that raises nothing reports nothing: a headless run's log stays
	// free of raises it did not make.
	assert.deepEqual(raises, []);
});

// ---------------------------------------------------------------- B1 and the feed
//
// The four cases below are the FIRST tests of the two things that made the
// operator's report unpredictable rather than merely wrong: the focus gate was
// window-scoped, and a click with no window was a bare `return`.

/** A second conversation, so "displayed" and "completing" can differ. */
const OTHER = "ffffffffffff";

/** One composed frame as the machine-wide feed puts it on the wire. */
function feedNotificationFrame(sessionId = SESSION, overrides = {}) {
	return {
		epoch: "feed1",
		seq: 4,
		type: "notification",
		session_id: sessionId,
		// The feed carries the bridge's payload VERBATIM, `dedupe_key` included.
		// If it ever stops doing that, the two paths stop collapsing into one
		// banner and this test is where that shows up.
		payload: { ...completionFrame().payload, ...overrides },
	};
}

test("a focused window does NOT suppress another conversation's completion", async () => {
	// The operator's own state: sitting in the app on session A while B finishes.
	// This was announced to nobody — the toast was suppressed by the focus gate
	// and rung 3 had already deferred to the desktop, so no other surface could
	// raise it either (B1).
	const { notifier, requests } = harness({ contract: 1 });
	await focusWindow(notifier, requests);
	notifier.observe(OTHER, feedNotificationFrame(OTHER));
	await settle(100);
	assert.equal(globalThis.__toasts.length, 1, "the other conversation banners");
	assert.equal(
		requests.filter((r) => r?.op === "sessions.notified").length,
		1,
		"and it claims delivery",
	);
});

test("a focused window displaying THAT conversation suppresses it, with no claim", async () => {
	// The one state where the completion is already on screen, so a banner would
	// tell the user what they are reading. Unchanged from before B1 — the
	// regression to guard against is over-correcting into a banner per turn.
	const { notifier, requests } = harness({ contract: 1 });
	await focusWindow(notifier, requests);
	notifier.observe(SESSION, feedNotificationFrame());
	await settle(100);
	assert.equal(globalThis.__toasts.length, 0);
	assert.equal(
		requests.filter((r) => r?.op === "sessions.notified").length,
		0,
		"a suppressed banner must not burn the cross-surface claim",
	);
});

test("a stale focus entry from a dead window suppresses nothing", async () => {
	// `forgetWindow` runs on `closed`, but a renderer process that dies takes its
	// webContents id with it and no `closed` event arrives. `webContents` ids are
	// not reused, so an unfiltered entry suppressed every completion for the life
	// of the process — the strongest candidate for the original report.
	const requests = [];
	const sender = async (input) => {
		requests.push(input);
		return { status: 200, body: { result: { claimed: true } } };
	};
	const heartbeat = (notifier) =>
		notifier.heartbeat(1, {
			sessionId: SESSION,
			subscriptionId: "a".repeat(32),
			visible: true,
			focused: true,
		});

	const stale = new DesktopNotifier(() => null, sender, "focus", {
		windowAlive: () => false,
		noteDisplayed: () => undefined,
		reopen: () => undefined,
	});
	await heartbeat(stale);
	stale.observe(SESSION, completionFrame());
	await settle(100);
	assert.equal(globalThis.__toasts.length, 1, "a dead window is not looking");

	// The same state with a LIVE window, so the test is about liveness rather
	// than about the notifier having forgotten how to suppress at all.
	globalThis.__toasts = [];
	globalThis.__shown = [];
	const live = new DesktopNotifier(() => null, sender, "focus", {
		windowAlive: () => true,
		noteDisplayed: () => undefined,
		reopen: () => undefined,
	});
	await heartbeat(live);
	live.observe(SESSION, completionFrame({ dedupe_key: "complete:x:live" }));
	await settle(100);
	assert.equal(globalThis.__toasts.length, 0);
});

test("the feed's frame and the bridge's frame with one dedupe_key raise one banner", async () => {
	// The design's whole no-double-toast argument, at the layer that enforces it:
	// main's local claim map, keyed on the backend's own string. Both sources
	// reach `observe` here exactly as they do in production.
	const { notifier, requests } = harness({ contract: 1 });
	notifier.observe(SESSION, completionFrame());
	notifier.observe(SESSION, feedNotificationFrame());
	await settle(100);
	assert.equal(globalThis.__toasts.length, 1, "one banner");
	assert.equal(
		requests.filter((r) => r?.op === "sessions.notified").length,
		1,
		"one delivery claim",
	);
});

test("a banner click with no window recreates one instead of doing nothing", async () => {
	// Defect C: `const target = this.window(); if (!target) return;`. On macOS
	// with the window closed and the app alive in the dock — matrix row 4, the
	// operator's exact case — the click did nothing at all.
	const reopened = [];
	const notifier = new DesktopNotifier(
		() => null,
		async () => ({ status: 200, body: { result: { claimed: true } } }),
		"focus",
		{
			windowAlive: () => true,
			noteDisplayed: () => undefined,
			reopen: (sessionId) => reopened.push(sessionId),
		},
	);
	// `always` bypasses the focus gate, which has no window to read here.
	notifier.observe(SESSION, completionFrame({ focus_policy: "always" }));
	await settle(100);
	const banner = globalThis.__shown[0];
	assert.ok(banner, "the banner is delivered with no window");
	banner.handlers.click();
	assert.deepEqual(
		reopened,
		[SESSION],
		"the click asks for the window to be recreated FOR THIS CONVERSATION",
	);
});

test("a burst digest's click opens the catalogue, not one arbitrary member", async () => {
	// R1-2. The backend caps per-tick banners and publishes ONE digest frame for
	// the remainder, with `burst_count`/`session_ids` on it and `session_id` set
	// to the LAST overflow member (a session frame has to name a session). The
	// click closure used `session_id`, so clicking "3 sessions finished" opened
	// one conversation nobody asked for — the "the click does not land where I
	// expected" defect, re-introduced on the busy path.
	const sent = [];
	const target = {
		id: 7,
		isDestroyed: () => false,
		show: () => undefined,
		showInactive: () => undefined,
		focus: () => undefined,
		isMinimized: () => false,
		restore: () => undefined,
		isFocused: () => false,
		isVisible: () => true,
		webContents: {
			send: (channel, payload) => sent.push({ channel, payload }),
		},
	};
	const notifier = new DesktopNotifier(
		() => target,
		async () => ({ status: 200, body: { result: { claimed: true } } }),
		"focus",
		{
			windowAlive: () => true,
			noteDisplayed: () => undefined,
			reopen: () => undefined,
		},
	);
	const OTHER = "bbbbbbbbbbbb";
	notifier.observe(
		SESSION,
		completionFrame({
			focus_policy: "always",
			burst_count: 3,
			session_ids: [SESSION, OTHER, "cccccccccccc"],
		}),
	);
	await settle(100);
	const banner = globalThis.__shown.at(-1);
	assert.ok(banner, "the digest is delivered as a banner");
	banner.handlers.click();
	const opened = sent.find((c) => c.channel === "desktop-open-conversation");
	assert.ok(opened, "the click opened something");
	assert.deepEqual(
		opened.payload,
		{ sessionId: null },
		"a digest names several conversations, so its click lands on the catalogue",
	);
});

test("a digest click with no window recreates the window on the catalogue", async () => {
	// The same routing on the windowless path (macOS, app alive in the dock):
	// `reopen(null)` means "a window, on the catalogue", which is the state the
	// store already models as no active session.
	const reopened = [];
	const notifier = new DesktopNotifier(
		() => null,
		async () => ({ status: 200, body: { result: { claimed: true } } }),
		"focus",
		{
			windowAlive: () => true,
			noteDisplayed: () => undefined,
			reopen: (sessionId) => reopened.push(sessionId),
		},
	);
	notifier.observe(
		SESSION,
		completionFrame({
			focus_policy: "always",
			burst_count: 4,
			session_ids: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"],
		}),
	);
	await settle(100);
	globalThis.__shown.at(-1).handlers.click();
	assert.deepEqual(reopened, [null], "the catalogue, not one of the burst's ids");
});

test("a single completion still routes its click to its own conversation", async () => {
	// The guard against over-matching: the digest detection must not swallow the
	// ordinary case. A frame with no `burst_count` and no `session_ids` is one
	// conversation, and its click must land on it.
	const sent = [];
	const target = {
		id: 7,
		isDestroyed: () => false,
		show: () => undefined,
		showInactive: () => undefined,
		focus: () => undefined,
		isMinimized: () => false,
		restore: () => undefined,
		isFocused: () => false,
		isVisible: () => true,
		webContents: {
			send: (channel, payload) => sent.push({ channel, payload }),
		},
	};
	const notifier = new DesktopNotifier(
		() => target,
		async () => ({ status: 200, body: { result: { claimed: true } } }),
		"focus",
		{
			windowAlive: () => true,
			noteDisplayed: () => undefined,
			reopen: () => undefined,
		},
	);
	notifier.observe(SESSION, completionFrame({ focus_policy: "always" }));
	await settle(100);
	globalThis.__shown.at(-1).handlers.click();
	const opened = sent.find((c) => c.channel === "desktop-open-conversation");
	assert.deepEqual(opened.payload, { sessionId: SESSION });
});

test("a click for a window that is gone takes the recreate path too", async () => {
	// A window reference that outlives its window: `mainWindow` is nulled on
	// `closed`, but a click that lands between the destroy and the null must not
	// send into a dead `webContents`.
	const reopened = [];
	const dead = { id: 9, isDestroyed: () => true, webContents: { send: () => {} } };
	const notifier = new DesktopNotifier(
		() => dead,
		async () => ({ status: 200, body: { result: { claimed: true } } }),
		"focus",
		{
			windowAlive: () => true,
			noteDisplayed: () => undefined,
			reopen: (sessionId) => reopened.push(sessionId),
		},
	);
	notifier.observe(SESSION, completionFrame({ focus_policy: "always" }));
	await settle(100);
	globalThis.__shown[0].handlers.click();
	assert.deepEqual(reopened, [SESSION]);
});

// -- review round 2: R2-3, R2-4, R2-5 --------------------------------------

/**
 * A window whose BrowserWindow id and webContents id DIFFER.
 *
 * That is the ordinary case, not a contrived one: Electron's two id spaces are
 * independent counters, the heartbeat is keyed on `event.sender.id` (a
 * webContents id) while `window.id` is a BrowserWindow id, and they drift apart
 * as soon as anything else creates a webContents — which the browser host does.
 * A fixture with one id shared between them could not express the defect.
 */
function splitIdWindow({ focused = true, visible = true } = {}) {
	return {
		id: 7,
		isDestroyed: () => false,
		isFocused: () => focused,
		isVisible: () => visible,
		isMinimized: () => false,
		webContents: { id: 107, send: () => undefined },
	};
}

function recordingSender() {
	const requests = [];
	const sender = async (input) => {
		requests.push(input);
		return { status: 200, body: { result: { claimed: true } } };
	};
	return { requests, sender };
}

test("presence reads the displayed conversation by the id the heartbeat wrote", async () => {
	/*
	 * REVIEW ROUND 2, R2-3. The writer keys the map on the webContents id and the
	 * accessor read `window.id` — the BrowserWindow id — so with the two unequal
	 * the machine-wide presence reported a focused, visible window showing
	 * NOTHING. The backend then could not recognise the conversation actually on
	 * screen and bannered it as a background completion.
	 */
	const { requests, sender } = recordingSender();
	const notifier = new DesktopNotifier(() => splitIdWindow(), sender, "focus", {
		windowAlive: () => true,
		noteDisplayed: () => undefined,
		reopen: () => undefined,
	});
	await notifier.heartbeat(107, {
		sessionId: SESSION,
		subscriptionId: "a".repeat(32),
		visible: true,
		focused: true,
	});
	aassertPresence(notifier, SESSION);
	// The lease traffic is not what this test measures, and reading it back keeps
	// the assertion below about the notification path.
	requests.length = 0;
});

function aassertPresence(notifier, expected) {
	assert.deepEqual(notifier.presence(), {
		sessionId: expected,
		window: { exists: true, focused: true, visible: true, minimized: false },
	});
}

test("a pane that leaves the conversation withdraws its report, identity-safely", async () => {
	/*
	 * REVIEW ROUND 2, R2-4. Navigating from a conversation to the catalogue stops
	 * the watch but leaves the window (and so the report) in place, so main kept
	 * renewing "showing A" every beat and the backend suppressed A's banner while
	 * no pane displayed it.
	 *
	 * The identity half is what makes the withdrawal safe: a cleanup runs after
	 * the pane has already changed, so clearing unconditionally would wipe the
	 * session a DEEPER pane has since subscribed to.
	 */
	const { requests, sender } = recordingSender();
	const notifier = new DesktopNotifier(() => splitIdWindow(), sender, "focus", {
		windowAlive: () => true,
		noteDisplayed: () => undefined,
		reopen: () => undefined,
	});
	const heartbeat = () =>
		notifier.heartbeat(107, {
			sessionId: SESSION,
			subscriptionId: "a".repeat(32),
			visible: true,
			focused: true,
		});
	await heartbeat();
	aassertPresence(notifier, SESSION);

	// An older pane's cleanup naming a DIFFERENT conversation must not clear this
	// one: that is the ordering hazard, and it is why the release is scoped.
	notifier.releaseWatch(107, OTHER);
	aassertPresence(notifier, SESSION);

	notifier.releaseWatch(107, SESSION);
	aassertPresence(notifier, "");
	// ...and a pane that comes back re-establishes it, so the withdrawal is a
	// withdrawal rather than a one-way latch.
	await heartbeat();
	aassertPresence(notifier, SESSION);
	requests.length = 0;
});

test("a report that stops arriving stops counting, without disabling delivery", async () => {
	/*
	 * R2-4's second half: a renderer that goes quiet — a wedged pane, a
	 * navigation that never beat again — must not go on asserting what is on
	 * screen. The window is still alive and can still raise a banner, which is
	 * the distinction: the DISPLAY claim expires, the app's ability to notify
	 * does not.
	 */
	const { requests, sender } = recordingSender();
	const notifier = new DesktopNotifier(() => splitIdWindow(), sender, "focus", {
		windowAlive: () => true,
		noteDisplayed: () => undefined,
		reopen: () => undefined,
	});
	const realNow = Date.now;
	let now = realNow();
	Date.now = () => now;
	try {
		await notifier.heartbeat(107, {
			sessionId: SESSION,
			subscriptionId: "a".repeat(32),
			visible: true,
			focused: true,
		});
		aassertPresence(notifier, SESSION);
		// Inside the TTL: still believed, so this is not an off-by-default field.
		now += 40_000;
		aassertPresence(notifier, SESSION);
		// Past it: the report is stale, and the window itself is unchanged.
		now += 10_000;
		aassertPresence(notifier, "");
	} finally {
		Date.now = realNow;
	}
	requests.length = 0;
});

test("a burst digest claims its members, and shows nothing when it wins none", async () => {
	/*
	 * REVIEW ROUND 2, R2-5 (backend #1116's R8). A digest carries no
	 * `completion_token`, so the single-frame claim branch skipped it and nothing
	 * marked its members delivered — an individual frame for one of them could
	 * then raise a SECOND banner for a completion the digest had already
	 * announced.
	 *
	 * Three cases, because "it claimed something" is not the contract: every
	 * member won, a PARTIAL race (the normal case), and a total loss.
	 */
	const memberTokens = [
		{ session_id: SESSION, completion_token: TOKEN },
		{ session_id: OTHER, completion_token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
	];
	const digest = (id) => ({
		epoch: "feed1",
		seq: 9,
		type: "notification",
		session_id: OTHER,
		payload: {
			...completionFrame().payload,
			dedupe_key: `burst:${id}`,
			completion_token: null,
			burst_count: 2,
			session_ids: [SESSION, OTHER],
			member_tokens: memberTokens,
		},
	});

	// (1) EVERY MEMBER WON: one toast, and one claim per member.
	const all = recordingSender();
	const winning = new DesktopNotifier(() => null, all.sender, "focus", {
		windowAlive: () => true,
		noteDisplayed: () => undefined,
		reopen: () => undefined,
	});
	winning.observe(OTHER, digest("a"));
	await settle(50);
	assert.equal(globalThis.__toasts.length, 1, "the digest banners");
	const claimed = all.requests.filter((r) => r?.op === "sessions.notified");
	assert.deepEqual(
		claimed.map((r) => [r.sessionId, r.completionToken]).sort(),
		memberTokens
			.map((m) => [m.session_id, m.completion_token])
			.sort(),
		"each member is claimed through the same call a single frame uses",
	);

	// (2) A PARTIAL RACE: the second member is already somebody else's. The
	// digest still announces the burst — the count is the backend's statement of
	// what happened — and it claims only what it won.
	globalThis.__toasts = [];
	const partialRequests = [];
	const partial = new DesktopNotifier(
		() => null,
		async (input) => {
			partialRequests.push(input);
			const lost = input?.completionToken === memberTokens[1].completion_token;
			return { status: 200, body: { result: { claimed: !lost } } };
		},
		"focus",
		{ windowAlive: () => true, noteDisplayed: () => undefined, reopen: () => undefined },
	);
	partial.observe(OTHER, digest("b"));
	await settle(50);
	assert.equal(globalThis.__toasts.length, 1, "a member somebody else delivered is not a reason to say nothing");

	// (3) EVERY MEMBER LOST: nothing is left to announce, and the dedupe key is
	// released so a later frame can still try rather than being swallowed for the
	// full TTL.
	globalThis.__toasts = [];
	const losing = new DesktopNotifier(
		() => null,
		async () => ({ status: 200, body: { result: { claimed: false } } }),
		"focus",
		{ windowAlive: () => true, noteDisplayed: () => undefined, reopen: () => undefined },
	);
	losing.observe(OTHER, digest("c"));
	await settle(50);
	assert.equal(globalThis.__toasts.length, 0, "every member belonged to another surface");
});

test("a burst digest from a backend without member_tokens still renders", async () => {
	/*
	 * REVIEW ROUND 4, R4-1. `member_tokens` is additive and optional on the wire
	 * (src/shared/desktop-session-contract.ts), and that file says in as many
	 * words what the pre-R8 shape does: "the digest still renders, its members are
	 * simply not arbitrated". It did not. The digest branch ran, `won` came back 0
	 * for the only reason there was nothing to try, and the frame was dropped
	 * before `show()` — no banner at all, for a shape the contract covers.
	 *
	 * Two assertions, because either alone would pass a wrong implementation: a
	 * banner is raised (the loss this fixes), and NO claim is sent (the shape has
	 * no members, so there is nothing to arbitrate and nothing to invent).
	 */
	const memberlessDigest = (id) => ({
		epoch: "feed1",
		seq: 9,
		type: "notification",
		session_id: OTHER,
		payload: {
			...completionFrame().payload,
			dedupe_key: `burst-memberless:${id}`,
			completion_token: null,
			burst_count: 2,
			session_ids: [SESSION, OTHER],
		},
	});
	globalThis.__toasts = [];
	const claims = recordingSender();
	const notifier = new DesktopNotifier(
		() => null,
		claims.sender,
		"focus",
		{ windowAlive: () => true, noteDisplayed: () => undefined, reopen: () => undefined },
	);
	notifier.observe(OTHER, memberlessDigest("a"));
	await settle(50);
	assert.equal(
		globalThis.__toasts.length,
		1,
		"a memberless digest has nothing to claim, so dropping it loses the banner the contract promises",
	);
	assert.equal(
		claims.requests.filter((r) => r?.op === "sessions.notified").length,
		0,
		"a memberless digest must not claim members it does not name",
	);
	/*
	 * (2) THE SAME SHAPE WITH A PAIR THAT IS PRESENT BUT EMPTY. `member_tokens` is
	 * a wire array, so `[{session_id: "", completion_token: ""}]` is type-legal and
	 * the claim loop skips it — which means this digest has nothing claimable and
	 * must render like the memberless one. Counting raw array entries instead sent
	 * it down the dropped path (review round 5, R5-2).
	 */
	globalThis.__toasts = [];
	const empty = recordingSender();
	const emptyNotifier = new DesktopNotifier(
		() => null,
		empty.sender,
		"focus",
		{ windowAlive: () => true, noteDisplayed: () => undefined, reopen: () => undefined },
	);
	emptyNotifier.observe(OTHER, {
		...memberlessDigest("b"),
		payload: {
			...memberlessDigest("b").payload,
			member_tokens: [{ session_id: "", completion_token: "" }],
		},
	});
	await settle(50);
	assert.equal(
		globalThis.__toasts.length,
		1,
		"a digest whose only member pair is empty has nothing to claim, so it must still be announced",
	);
	assert.equal(
		empty.requests.filter((r) => r?.op === "sessions.notified").length,
		0,
		"an empty pair is not a claimable member, so no claim may be sent for it",
	);
});

test("a ONE-MEMBER burst digest claims its member, and its click lands on it", async () => {
	/*
	 * REVIEW ROUND 3, R3-1 — the boundary of R2-5, and the size that was missing.
	 *
	 * The backend caps a tick's banners at `BURST_LIMIT = 3` and composes
	 * `_digest_payload` for the remainder WHATEVER ITS SIZE, so the commonest
	 * overflow is FOUR completions: three announced individually and one held
	 * back as a digest with `burst_count: 1`, one `session_ids` entry and one
	 * `member_tokens` pair. `isBurstDigest` asks `burst_count > 1 ||
	 * session_ids.length > 1`, so it answered FALSE for that frame: neither claim
	 * branch ran, no `sessions.notified` was sent, and the member stayed
	 * claimable — the duplicate-banner hole R2-5 closes, one completion wide. The
	 * existing digest fixtures hard-code `burst_count: 2`, the one size at which
	 * the predicate is true, so nothing in this suite could see it.
	 *
	 * The click half is asserted here as a DECISION rather than a leftover: a frame
	 * naming exactly one conversation lands on it, and only a multi-member digest
	 * opens the catalogue (the case above).
	 */
	const memberToken = { session_id: SESSION, completion_token: TOKEN };
	const oneMemberDigest = (id) => ({
		epoch: "feed1",
		seq: 9,
		type: "notification",
		session_id: SESSION,
		payload: {
			...completionFrame().payload,
			dedupe_key: `burst-one:${id}`,
			completion_token: null,
			burst_count: 1,
			session_ids: [SESSION],
			member_tokens: [memberToken],
		},
	});

	// (1) The member IS claimed, exactly once, through the same call a single
	// frame uses — the arbitration R2-5 promised, at the size it missed.
	const won = recordingSender();
	const claiming = new DesktopNotifier(() => null, won.sender, "focus", {
		windowAlive: () => true,
		noteDisplayed: () => undefined,
		reopen: () => undefined,
	});
	claiming.observe(SESSION, oneMemberDigest("a"));
	await settle(50);
	assert.equal(globalThis.__toasts.length, 1, "a one-member burst is still announced");
	assert.deepEqual(
		won.requests
			.filter((r) => r?.op === "sessions.notified")
			.map((r) => [r.sessionId, r.completionToken]),
		[[memberToken.session_id, memberToken.completion_token]],
		"the single member is claimed, so no other surface can announce it again",
	);

	// (2) Losing that claim says NOTHING, and releases the dedupe key so a later
	// regrouped digest can try rather than being swallowed for the full TTL.
	globalThis.__toasts = [];
	const losing = new DesktopNotifier(
		() => null,
		async () => ({ status: 200, body: { result: { claimed: false } } }),
		"focus",
		{ windowAlive: () => true, noteDisplayed: () => undefined, reopen: () => undefined },
	);
	losing.observe(SESSION, oneMemberDigest("b"));
	await settle(50);
	assert.equal(
		globalThis.__toasts.length,
		0,
		"another surface already delivered this member, so there is nothing left to announce",
	);

	// (3) The click: one member, one destination. `sessionId: null` is the
	// catalogue, and a frame with a single member must not take it.
	const sent = [];
	const target = {
		id: 7,
		isDestroyed: () => false,
		show: () => undefined,
		showInactive: () => undefined,
		focus: () => undefined,
		isMinimized: () => false,
		restore: () => undefined,
		isFocused: () => false,
		isVisible: () => true,
		webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
	};
	globalThis.__toasts = [];
	const routing = new DesktopNotifier(
		() => target,
		async () => ({ status: 200, body: { result: { claimed: true } } }),
		"focus",
		{ windowAlive: () => true, noteDisplayed: () => undefined, reopen: () => undefined },
	);
	routing.observe(SESSION, oneMemberDigest("c"));
	await settle(100);
	const banner = globalThis.__shown.at(-1);
	assert.ok(banner, "the one-member digest is delivered as a banner");
	banner.handlers.click();
	const opened = sent.find((c) => c.channel === "desktop-open-conversation");
	assert.deepEqual(
		opened?.payload,
		{ sessionId: SESSION },
		"a banner naming one conversation opens THAT conversation, not the catalogue",
	);
});
