import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The renderer's read-receipt loop, driven headlessly.
 *
 * This repo has no DOM test rig (no jsdom, no component testing library), and
 * the desktop IPC boundary cannot exist outside Electron -- so the two ends are
 * replaced the way scripts/desktop-contract.test.mjs stands in for `electron`,
 * and everything in between is the SHIPPED module: `useCompletionView`, its
 * verification of the answer, and the contract predicates it decides with.
 *
 * The fixtures are deliberately dumb:
 *
 *  - `react` supplies only `useEffect`, which RECORDS the effect so the test can
 *    run it once and step it by hand. The hook owns no other React surface.
 *  - The canonical store supplies the active session id the effect compares to.
 *  - The desktop transport supplies `desktopResult`, whose answer each case
 *    stages: a settled state, a no-op 200 whose body still says `unseen`, a
 *    superseded 409, or a state about another conversation.
 *  - The DOM is the handful of globals the hook reads: focus, visibility, the
 *    anchor's rect, and the element at its bottom edge.
 *
 * What is NOT covered here is the transport and the native foreground gate --
 * scripts/desktop-contract.test.mjs and scripts/desktop-renderer-transport.test.mjs
 * own those, with real loopback HTTP.
 */

const fixtures = {
	react: `
		export function useEffect(effect, _deps) {
			globalThis.__effects.push(effect);
			return effect;
		}
	`,
	"canonical-store": `
		export const activeSession = { activeSessionId: "abcdef123456" };
		export const useCanonicalSessionsStore = (selector) => selector(activeSession);
		useCanonicalSessionsStore.getState = () => activeSession;
	`,
	"desktop-api": `
		export function desktopResult(request) {
			return globalThis.__transport(request);
		}
	`,
};

const bundle = await build({
	stdin: {
		contents:
			'export { useCompletionView } from "./src/renderer/src/shared/hooks/use-completion-view";' +
			' export * from "./src/shared/desktop-session-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	tsconfig: "./tsconfig.app.json",
	plugins: [
		{
			name: "headless-fixtures",
			setup(builder) {
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "fixture",
				}));
				builder.onResolve(
					{ filter: /^@shared\/store\/canonical-sessions-store$/ },
					() => ({ path: "canonical-store", namespace: "fixture" }),
				);
				builder.onResolve(
					{ filter: /^@shared\/api\/local-operator\/desktop-api$/ },
					() => ({ path: "desktop-api", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
					contents: fixtures[args.path],
					loader: "js",
				}));
			},
		},
	],
});

// A NAMESPACE import rather than named bindings: the predicates this file pins
// are new, and referring to them through the module is what lets the same file
// run against a tree that predates them (where they are simply absent) instead
// of failing to load at all.
const contract = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { useCompletionView } = contract;
const receiptSettled = (...args) => contract.receiptSettled(...args, TOKEN);
const isSupersededReceipt = (...args) => contract.isSupersededReceipt(...args);

const SESSION = "abcdef123456";
const TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** The attention state a conversation asks about, before anyone has read it. */
function attention(extra = {}) {
	return {
		conversation_id: `session/${SESSION}`,
		completion_token: TOKEN,
		anchor_id: "result-1",
		kind: "complete",
		unseen: true,
		revision: [1, 0],
		supported: true,
		...extra,
	};
}

function frontend(extra = {}) {
	return {
		session_id: SESSION,
		streaming: false,
		attention: attention(),
		...extra,
	};
}

/**
 * Drive one hook instance: build the DOM, run the effect, and return a `tick`
 * that runs what the interval would have run.
 */
function mount(transport, { covered = null } = {}) {
	const element = {
		getBoundingClientRect: () => ({
			left: 0,
			top: 100,
			width: 200,
			height: 200,
			bottom: 300,
		}),
		contains: (node) => node === element,
	};
	const checks = [];
	globalThis.__effects = [];
	globalThis.__transport = transport;
	globalThis.document = {
		visibilityState: "visible",
		hasFocus: () => true,
		/* `covered` stages what is on top at the row's bottom edge: "centre" is the
		   measured collision with the app's own floating control, "all" is an
		   overlay that hides the row (a modal scrim). */
		elementFromPoint: (x) => {
			if (covered === "all") return { notTheRow: true };
			if (covered === "centre" && Math.abs(x - 100) < 1)
				return { notTheRow: true };
			return element;
		},
	};
	globalThis.CSS = { escape: (value) => String(value) };
	globalThis.innerWidth = 1000;
	globalThis.innerHeight = 800;
	globalThis.requestAnimationFrame = () => 0;
	globalThis.cancelAnimationFrame = () => {};
	globalThis.window = {
		setInterval: (check) => {
			checks.push(check);
			return checks.length;
		},
		clearInterval: () => {},
	};
	const root = { current: { querySelector: () => element } };

	return {
		/** Run the effect body once, as React does on mount. */
		start: (state = frontend()) => {
			const effect = useCompletionView(state, true, root);
			globalThis.__effects.pop()();
			return effect;
		},
		/** One interval tick, then let the answer's microtasks run. */
		tick: async () => {
			await checks.at(-1)();
			await new Promise((resolve) => setTimeout(resolve, 0));
		},
	};
}

test("a no-op acknowledgement does not stop the poll", async () => {
	// The shipped daemon answered a superseded token with a 200 whose body still
	// said `unseen` (see the findings file). Believing the resolved call stopped
	// every later attempt for that token, so the completion's mark stayed on over
	// a result the operator was looking at. `unseen` is the verdict, and anything
	// else keeps the loop alive.
	const calls = [];
	const harness = mount(async (request) => {
		calls.push(request);
		return attention();
	});
	harness.start();
	await harness.tick();
	assert.equal(calls.length, 1, "the first attempt was not made");
	await harness.tick();
	assert.equal(calls.length, 2, "a no-op answer stopped the retries");
});

test("a settled acknowledgement stops the poll, and only that does", async () => {
	const calls = [];
	const harness = mount(async (request) => {
		calls.push(request);
		return attention({ unseen: false, revision: [1, 1] });
	});
	harness.start();
	await harness.tick();
	await harness.tick();
	assert.equal(calls.length, 1, "a settled receipt was re-sent");
	assert.equal(calls[0].completionToken, TOKEN);
});

test("a superseded refusal is retried flat, then bounded and logged", async () => {
	// 409 `superseded_completion_token` is expected: the backend has moved past
	// the token this attempt rendered, and the state that arrives next names the
	// current one -- so the first attempts stay FLAT rather than backing off
	// behind a 60 s ceiling while the re-arm is imminent. What must not stand is
	// the unbounded version of that: a projection that never advances (a cold or
	// stalled stream) would be re-attempted twice a second for as long as the
	// conversation is open, with nothing recorded (agent review round 1, N3).
	const calls = [];
	const warnings = [];
	const harness = mount(async (request) => {
		calls.push(request);
		throw Object.assign(new Error("completion token superseded"), {
			status: 409,
			code: "superseded_completion_token",
		});
	});
	const warn = console.warn;
	console.warn = (...args) => warnings.push(args.map(String).join(" "));
	try {
		harness.start();
		for (let attempt = 0; attempt < 3; attempt += 1) await harness.tick();
		assert.equal(calls.length, 3, "the flat window before the bound changed");
		for (let attempt = 0; attempt < 2; attempt += 1) await harness.tick();
		assert.equal(
			calls.length,
			3,
			"a superseded refusal was retried past its bound",
		);
	} finally {
		console.warn = warn;
	}
	assert.equal(
		warnings.filter((line) => line.includes("receipt unresolved")).length,
		1,
		"the bound was not recorded, or was recorded more than once",
	);
});

test("a superseded refusal that the answer then settles is not delayed", async () => {
	// The bound must not cost the healthy path anything: while the projection is
	// catching up -- which is the ordinary case -- the retry stays flat, and the
	// attempt that is finally answered settles on the first try it gets.
	const calls = [];
	const harness = mount(async (request) => {
		calls.push(request);
		if (calls.length < 3) {
			throw Object.assign(new Error("completion token superseded"), {
				status: 409,
				code: "superseded_completion_token",
			});
		}
		return attention({ unseen: false, revision: [1, 1] });
	});
	harness.start();
	for (let attempt = 0; attempt < 4; attempt += 1) await harness.tick();
	assert.equal(
		calls.length,
		3,
		"the settled answer did not arrive on the third attempt",
	);
});

test("a control covering the row's centre does not refuse a visible result", async () => {
	// Measured on the real app (agent review round 1, R1): the "Scroll to bottom"
	// button sits at the transcript's bottom centre, over the last row's bottom
	// edge. A single sample there refused a result the reader was looking at for as
	// long as the conversation stayed open, so the probe samples across the row and
	// one free sample is enough.
	const calls = [];
	const harness = mount(
		async (request) => {
			calls.push(request);
			return attention({ unseen: false, revision: [1, 1] });
		},
		{ covered: "centre" },
	);
	harness.start();
	await harness.tick();
	assert.equal(
		calls.length,
		1,
		"a floating control over the row's centre refused the receipt",
	);
});

test("a row hidden by an overlay is still refused", async () => {
	// The other direction, so the relaxed probe cannot pass everything: an overlay
	// that really hides the row -- a modal scrim, spanning the viewport -- covers
	// every sample, and a reader who cannot see the result cannot receipt it.
	const calls = [];
	const harness = mount(
		async (request) => {
			calls.push(request);
			return attention({ unseen: false, revision: [1, 1] });
		},
		{ covered: "all" },
	);
	harness.start();
	await harness.tick();
	assert.equal(
		calls.length,
		0,
		"a row covered by an overlay was receipted anyway",
	);
});

test("the refusal code is pinned to the backend's documented wire value", () => {
	// The string belongs to the BACKEND (`SUPERSEDED_TOKEN_CODE` in
	// `local_operator/session/attention.py`, documented in docs/DESKTOP_API.md).
	// A renderer cannot import Python, so this copy cannot be bound
	// automatically -- pinning it HERE, as a literal, is what turns a change on
	// either side into a failing test rather than a client that quietly stops
	// recognising the refusal (agent review round 1, N2).
	assert.equal(
		contract.SUPERSEDED_COMPLETION_TOKEN_CODE,
		"superseded_completion_token",
		"the renderer no longer recognises the backend's superseded-token code",
	);
});

test("an answer about another conversation never settles this one", async () => {
	const calls = [];
	const harness = mount(async (request) => {
		calls.push(request);
		return attention({
			conversation_id: "session/ffffffffffff",
			unseen: false,
		});
	});
	harness.start();
	await harness.tick();
	await harness.tick();
	assert.equal(calls.length, 2, "a foreign state settled this conversation");
});

test("a real failure still backs off, so a wedged backend is not hammered", async () => {
	// The other side of the distinction: a backend that cannot answer at all must
	// keep the existing ceiling rather than retrying twice a second forever.
	const calls = [];
	const harness = mount(async (request) => {
		calls.push(request);
		throw Object.assign(new Error("backend unreachable"), { status: null });
	});
	harness.start();
	for (let attempt = 0; attempt < 5; attempt += 1) await harness.tick();
	// Three attempts, then the ceiling: the contrast with the superseded case
	// above, which makes all five.
	assert.equal(
		calls.length,
		3,
		"an unreachable backend was retried past its ceiling",
	);
});

test("the verdict is read from the state, not from the call resolving", () => {
	assert.equal(receiptSettled(attention({ unseen: false }), SESSION), true);
	assert.equal(receiptSettled(attention(), SESSION), false);
	assert.equal(receiptSettled(undefined, SESSION), false);
	assert.equal(receiptSettled(null, SESSION), false);
	assert.equal(receiptSettled("200 OK", SESSION), false);
	assert.equal(
		receiptSettled({ conversation_id: `session/${SESSION}` }, SESSION),
		false,
		"a state without a verdict settled the attempt",
	);
	assert.equal(
		receiptSettled(
			attention({ unseen: false, conversation_id: "session/other" }),
			SESSION,
		),
		false,
	);
	assert.equal(
		isSupersededReceipt(
			Object.assign(new Error("superseded"), {
				code: "superseded_completion_token",
			}),
		),
		true,
	);
	// Everything else keeps the backed-off cadence.
	for (const other of [
		Object.assign(new Error("unknown completion token"), {
			code: undefined,
			status: 409,
		}),
		Object.assign(new Error("not running"), { status: 503 }),
		Object.assign(new Error("unreachable"), { status: null }),
		new Error("bare"),
		undefined,
		null,
		"nope",
	]) {
		assert.equal(isSupersededReceipt(other), false, String(other));
	}
});

for (const outcome of ["unread", "wrong-token", "alternating"]) {
	test(`all unresolved ${outcome} answers share a retry budget and new tokens reset it`, async () => {
		let calls = 0;
		const warnings = [];
		let now = 0;
		const originalNow = Date.now;
		const originalWarn = console.warn;
		Date.now = () => now;
		console.warn = (...args) => warnings.push(args);
		try {
			const harness = mount(async () => {
				calls += 1;
				if (outcome === "alternating" && calls % 2) throw new Error("refused");
				return attention({
					unseen: outcome !== "wrong-token",
					completion_token: outcome === "wrong-token" ? "other" : TOKEN,
				});
			});
			harness.start();
			for (let tick = 0; tick < 240; tick++) {
				now += 500;
				await harness.tick();
			}
			assert.ok(calls <= 10, `${calls} attempts escaped the 120s bound`);
			assert.equal(warnings.length, 1);
			const previous = calls;
			harness.start(
				frontend({ attention: attention({ completion_token: "fresh" }) }),
			);
			await harness.tick();
			assert.equal(calls, previous + 1, "new token inherited old retry budget");
		} finally {
			Date.now = originalNow;
			console.warn = originalWarn;
		}
	});
}
