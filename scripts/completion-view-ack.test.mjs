import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The renderer's read-receipt loop, driven headlessly.
 *
 * This repo has no DOM test rig (no jsdom, no component testing library), and
 * the desktop IPC boundary cannot exist outside Electron -- so the ends are
 * replaced the way scripts/desktop-contract.test.mjs stands in for `electron`,
 * and everything in between is the SHIPPED module: `useCompletionView`, its
 * verification of the answer, and the contract predicates it decides with.
 *
 * The fixtures are deliberately dumb:
 *
 *  - `react` supplies `useEffect`, which RECORDS the effect so the test can run
 *    it once and step it by hand, and `useRef`, which is keyed by call order the
 *    way React keys a component's hooks. The hook owns no other React surface.
 *  - The canonical store is the REAL one (below), because the fact these cases
 *    are about is a ROW's state: the mark the sidebar draws lives on a store row,
 *    and "the answer clears it" is only a claim about the shipped code if the
 *    merge that writes it is the shipped merge.
 *  - The desktop transport supplies `desktopResult`, whose answer each case
 *    stages: a settled state, a no-op 200 whose body still says `unseen`, a
 *    superseded 409, a `503 store_busy`, or a state about another conversation.
 *  - The DOM is the handful of globals the hook reads: focus, visibility, the
 *    anchor's rect, and the element at its bottom edge.
 *
 * What is NOT covered here is the transport and the native foreground gate --
 * scripts/desktop-contract.test.mjs and scripts/desktop-renderer-transport.test.mjs
 * own those, with real loopback HTTP.
 */

/* ------------------------------------------------------------------ store */

// The store's persistence needs a `localStorage`, and `desktopResult` is the
// network: the same two fixtures `attention-seen.test.mjs` and
// `session-status-feed.test.mjs` use.
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
// Never reached by these cases (no store action here asks the network), and set
// so a store module that does ask fails loudly rather than hanging.
globalThis.__storeRequest = async () => {
	throw new Error("the receipt harness serves no store request");
};

const storeBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store";',
		resolveDir: process.cwd(),
	},
	alias: {
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "receipt-store-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "receipt-store-fixture" }),
				);
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "receipt-store-fixture" }),
				);
				// Only `desktopResult` is faked -- it is the network. The error classes
				// are the real ones, because the store's error-copy rules depend on
				// their actual behaviour.
				builder.onLoad(
					{ filter: /.*/, namespace: "receipt-store-fixture" },
					(args) => ({
						contents: {
							transport: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
								`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
							)}
export const desktopResult = request => globalThis.__storeRequest(request);`,
							echo: `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const discardPendingEchoes = () => undefined;`,
						}[args.path],
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
});
const storeModule = await import(
	`data:text/javascript;base64,${Buffer.from(storeBundle.outputFiles[0].text).toString("base64")}`
);
const store = storeModule.useCanonicalSessionsStore;
// Handed to the hook bundle's fixture below, so both bundles share ONE store
// instance: the hook's writes are the ones these cases then read back.
globalThis.__store = store;

/* ------------------------------------------------------------------- hook */

const fixtures = {
	react: `
		export function useEffect(effect, _deps) {
			globalThis.__effects.push(effect);
			return effect;
		}
		/**
		 * Keyed by call order within a render, so a re-render hands the hook the
		 * SAME ref object React would. The store the hook reads is the live one,
		 * through getState() -- the form the shipped hook uses at attempt time.
		 */
		export function useRef(initial) {
			const index = globalThis.__refCursor++;
			return (globalThis.__refs[index] ??= { current: initial });
		}
	`,
	"canonical-store": `
		export const useCanonicalSessionsStore = Object.assign(
			(selector) => selector(globalThis.__store.getState()),
			{ getState: () => globalThis.__store.getState() },
		);
	`,
	"desktop-api": `
		export { DesktopControlError } from ${JSON.stringify(
			`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
		)};
		export function desktopResult(request) {
			return globalThis.__transport(request);
		}
	`,
};

const bundle = await build({
	stdin: {
		contents:
			'export { useCompletionView } from "./src/renderer/src/shared/hooks/use-completion-view";' +
			' export * from "./src/shared/desktop-session-contract";' +
			' export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
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
					// The `desktop-api` fixture re-exports the REAL error classes by
					// absolute path, so this namespace needs a resolve directory.
					resolveDir: process.cwd(),
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
const { useCompletionView, DesktopControlError } = contract;
const receiptSettled = (...args) => contract.receiptSettled(...args, TOKEN);

const SESSION = "abcdef123456";
const OTHER = "ffffffffffff";
const TOKEN = "[redacted]";

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

/** A catalogue row, as the sidebar draws its mark from. */
function row(attentionState, over = {}) {
	return {
		session_id: SESSION,
		title: "Reconcile",
		status: { code: "complete", label: "Unseen completion" },
		attention: attentionState,
		...over,
	};
}

/** The store row's attention, i.e. what the sidebar is drawing. */
const rowAttention = (sessionId = SESSION) =>
	store.getState().sessions.find((item) => item.session_id === sessionId)
		?.attention;

/** A `503 store_busy` refusal, as the transport raises it. */
const storeBusy = (retryAfterMs) =>
	new DesktopControlError(
		503,
		"Read state is busy right now, so nothing was written. Try again in a moment.",
		undefined,
		"store_busy",
		retryAfterMs,
	);

/** A `409 superseded_completion_token` refusal, as the transport raises it. */
const superseded = () =>
	new DesktopControlError(
		409,
		"This completion is no longer the conversation's current one.",
		undefined,
		"superseded_completion_token",
	);

/**
 * Drive one hook instance: build the DOM, run the effect, and return a `tick`
 * that runs what the interval would have run.
 */
function mount(
	transport,
	{ covered = null, innerHeight = 800, anchor = true } = {},
) {
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
	/*
	 * THE INTERVAL TABLE IS THE REAL ONE, and that is a fix in its own right
	 * (agent review round 1, M2): `clearInterval` used to be installed as a no-op
	 * here and `tick` stepped only the NEWEST callback, so an interval this hook
	 * leaked - a dropped `stop()`, a missing effect cleanup - was invisible to
	 * every case in the file, while "loop lifetime" is one of the things this PR
	 * claims. The fixture keeps the ids it hands out and deletes the ones the hook
	 * clears, so `live()` answers how many intervals the loop actually holds; the
	 * teardown cases at the bottom of this file are what read it.
	 */
	const intervals = new Map();
	let nextTimerId = 0;
	/** Every selector this mount's DOM probe has asked for. */
	const queries = [];
	globalThis.__effects = [];
	// One array per MOUNT, cleared cursor per render: this is one component
	// instance, and a ref is per instance rather than per render.
	globalThis.__refs = [];
	globalThis.__refCursor = 0;
	// The store is the real one and therefore shared by every case in this file, so
	// each mount starts from a known baseline: the conversation under test is the
	// one on screen (`useCompletionView` refuses an attempt for a session the view
	// is not on), with no rows and no press behind it.
	store.setState({
		sessions: [],
		activeSessionId: SESSION,
		activeDraftKey: null,
		readAckRearm: null,
		readAckNotice: null,
	});
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
	globalThis.innerHeight = innerHeight;
	globalThis.requestAnimationFrame = () => 0;
	globalThis.cancelAnimationFrame = () => {};
	/*
	 * BOTH SPELLINGS REACH THE SAME TABLE, and this is the half that made a leak
	 * invisible rather than merely unasserted: the hook creates its interval with
	 * `window.setInterval` and clears it with the BARE `clearInterval`, so a fixture
	 * that installed only the `window` one left the clear landing on Node's own
	 * timer table - the loop kept ticking after `stop()` and nothing could see it
	 * (agent review round 1, M2).
	 */
	globalThis.clearInterval = (id) => {
		intervals.delete(id);
	};
	globalThis.window = {
		setInterval: (check) => {
			nextTimerId += 1;
			intervals.set(nextTimerId, check);
			return nextTimerId;
		},
		clearInterval: (id) => {
			intervals.delete(id);
		},
	};
	const root = {
		current: {
			// Recorded, not just answered: the SELECTOR is what says which completion
			// an attempt hit-tested, and "the anchor hit test is the definition of
			// shown" is only a claim about the token actually sent if the row it asked
			// for is the one that token names.
			querySelector: (selector) => {
				queries.push(selector);
				return anchor ? element : null;
			},
		},
	};

	/** One render of the component that calls the hook. */
	const render = (state = frontend(), ready = true) => {
		globalThis.__refCursor = 0;
		return useCompletionView(state, ready, root);
	};
	/**
	 * The cleanup of the effect run in flight, as React holds it.
	 *
	 * Held per MOUNT rather than per case, because that is what React does: the
	 * next run of the effect calls the previous run's cleanup before its body, and
	 * an unmount calls it and nothing else.
	 */
	let effectCleanup = null;

	return {
		render,
		/**
		 * A render that (RE)RUNS the loop's effect: the previous run's cleanup, then
		 * the body, which is React's own order for a dependency change.
		 */
		start: (state = frontend(), ready = true) => {
			effectCleanup?.();
			render(state, ready);
			effectCleanup = globalThis.__effects.pop()() ?? null;
			return effectCleanup;
		},
		/**
		 * The cleanup alone, as an unmount performs it - the selection leaving.
		 */
		unmount: () => {
			effectCleanup?.();
			effectCleanup = null;
		},
		/**
		 * The ids of every interval this loop created and has not cleared.
		 *
		 * The instrument the teardown cases read, and the reason the fixture keeps a
		 * real interval table: a leaked interval used to leave no trace at all.
		 */
		live: () => [...intervals.keys()],
		/** Every anchor selector this mount's hit test has asked for. */
		queries: () => [...queries],
		/** One interval tick, then let the answer's microtasks run. */
		tick: async () => {
			// THE LIVE interval, not the newest callback ever registered: a stopped loop
			// has nothing to step, which is itself the thing several cases below are
			// about.
			const check = [...intervals.values()].at(-1);
			if (check) await check();
			await new Promise((resolve) => setTimeout(resolve, 0));
		},
		/** Put a catalogue row in the store, as the sidebar would have it. */
		seed: (rows) => store.setState({ sessions: rows }),
		/**
		 * The operator's own gesture: a press that opens a conversation.
		 *
		 * The stamp is written by `openSession` in the shipped tree; the call is made
		 * through `rearmReadAck` directly here so a case can stage the gesture
		 * without the store's other work. A tree that predates the action has none
		 * (which is the defect the press cases exist for), so it is called
		 * defensively -- the same shape the namespace import above uses.
		 */
		press: (sessionId = SESSION) => {
			store.getState().rearmReadAck?.(sessionId);
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

test("the settled answer clears the row, with no feed frame to publish it", async () => {
	// THE ANSWER, APPLIED. `unseen` is cleared by an acknowledgement and by
	// nothing else, and the row's mark is drawn from the STORE row
	// (`unreadMarkKind`) -- which the machine-wide feed was the only writer of.
	// So a receipt that succeeded while the feed's own read was failing left the
	// mark standing over a result the backend had marked read, and the operator's
	// click read as "nothing happened" (the reported defect). The answer to this
	// request IS that state, and the row's merge is revision-guarded, so applying
	// it can only bring the row up to what this client was just told.
	const calls = [];
	const harness = mount(async (request) => {
		calls.push(request);
		return attention({ unseen: false, revision: [1, 1] });
	});
	harness.seed([row(attention())]);
	assert.equal(rowAttention().unseen, true, "the fixture did not start unread");
	harness.start();
	await harness.tick();
	assert.equal(calls.length, 1, "the first attempt was not made");
	assert.equal(
		rowAttention()?.unseen,
		false,
		"a settled answer left the row's completion mark standing",
	);
});

test("a staler feed frame cannot undo the applied answer", async () => {
	// The other half of applying it: the store's own guard. Applying this client's
	// answer must not hand a later, older frame the win - a delayed `attention`
	// frame still saying "unseen" at an older revision keeps the row read.
	const harness = mount(async () =>
		attention({ unseen: false, revision: [1, 1] }),
	);
	harness.seed([row(attention())]);
	harness.start();
	await harness.tick();
	assert.equal(
		rowAttention()?.unseen,
		false,
		"the answer did not clear the row",
	);
	store.getState().applyAttention(SESSION, attention({ unseen: true }));
	assert.equal(
		rowAttention()?.unseen,
		false,
		"a staler frame resurrected a completion this client had acknowledged",
	);
});

test("a 503 store_busy is retried on the prompt budget, honouring retry_after_ms", async () => {
	// CONTENTION IS NOT A GENERIC FAILURE. The backend refuses `/seen` with
	// `503 {"code": "store_busy"}` while another writer holds the store's lock, and
	// that clears by itself in the same second-scale window the send path already
	// absorbs -- while the shared ladder's first three attempts are flat and its
	// ceiling is a minute. The operator's own log is the measurement: three
	// refusals, ONE attempt each, minutes apart, with the mark still on the row.
	const calls = [];
	const warnings = [];
	let now = 1_000_000;
	const originalNow = Date.now;
	const originalWarn = console.warn;
	Date.now = () => now;
	console.warn = (...args) => warnings.push(args.map(String).join(" "));
	try {
		const harness = mount(async (request) => {
			calls.push(request);
			if (calls.length <= 2) throw storeBusy(40);
			return attention({ unseen: false, revision: [1, 1] });
		});
		harness.seed([row(attention())]);
		harness.start();
		await harness.tick();
		assert.equal(calls.length, 1, "the first attempt was not made");
		now += 39;
		await harness.tick();
		assert.equal(
			calls.length,
			1,
			"the retry ignored the backend's own retry_after_ms",
		);
		now += 1;
		await harness.tick();
		assert.equal(
			calls.length,
			2,
			"the retry did not happen when the wait was out",
		);
		now += 40;
		await harness.tick();
		assert.equal(calls.length, 3, "the settled answer never arrived");
		assert.equal(
			rowAttention()?.unseen,
			false,
			"the settled answer did not clear the row",
		);
		now += 600_000;
		await harness.tick();
		assert.equal(calls.length, 3, "a settled receipt was re-sent");
		assert.deepEqual(
			warnings,
			[],
			"contention was reported as an unresolved refusal",
		);
	} finally {
		Date.now = originalNow;
		console.warn = originalWarn;
	}
});

test("a store that stays busy is retried a bounded number of times, then takes the ceiling", async () => {
	// The other direction, so the busy path cannot become an unbounded poll: the
	// prompt budget is SPENT and the refusal then joins the shared ladder, whose
	// ceiling is ~1 attempt/minute. A store that cannot recover is therefore not
	// hammered twice a second for as long as the conversation stays open, and the
	// bound is recorded once, as the generic path already records it.
	const calls = [];
	const warnings = [];
	let now = 0;
	/** Attempt counts either side of a moment, on the clock the hook reads. */
	const attemptsBefore = (at) => calls.filter((stamp) => stamp <= at).length;
	const attemptsAfter = (at) => calls.filter((stamp) => stamp > at).length;
	const originalNow = Date.now;
	const originalWarn = console.warn;
	Date.now = () => now;
	console.warn = (...args) => warnings.push(args.map(String).join(" "));
	try {
		const harness = mount(async () => {
			calls.push(now);
			throw storeBusy();
		});
		harness.start();
		// Ten minutes of ticks at the poll cadence, with the clock the hook reads.
		for (let tick = 0; tick < 1_200; tick += 1) {
			now += 500;
			await harness.tick();
		}
	} finally {
		Date.now = originalNow;
		console.warn = originalWarn;
	}
	/*
	 * STRUCTURAL RATHER THAN A MAGIC TOTAL: the prompt budget spends itself in the
	 * first minute (five prompt retries, then the ladder's own flat window), and what
	 * is left is the shared ceiling - so the count decays by an ORDER OF MAGNITUDE
	 * between the first minute and the last, which is the property that says a store
	 * that cannot recover is not hammered. The measured shape at these constants:
	 * 13 attempts in the first 60 s, 1 in the last, 22 over the ten minutes.
	 */
	assert.ok(
		calls.length <= 30,
		`${calls.length} attempts escaped the busy budget and the shared ceiling`,
	);
	assert.ok(
		attemptsBefore(60_000) >= 10,
		"the prompt contention budget was not spent up front",
	);
	assert.ok(
		attemptsBefore(60_000) > attemptsAfter(540_000) * 4,
		"the cadence did not decay onto the shared ceiling",
	);
	assert.equal(
		warnings.filter((line) => line.includes("receipt unresolved")).length,
		1,
		"the bound was not recorded, or was recorded more than once",
	);
});

test("a superseded refusal ends the loop instead of spending the ladder", async () => {
	// TERMINAL, NOT A TURN ON THE LADDER (agent review round 1, M1). The refusal
	// says the completion this attempt named is no longer the conversation's
	// current one, and the state that supersedes it arrives BY THE FEED - so
	// another attempt with the same token cannot settle, however many it gets. The
	// shipped behaviour (three flat attempts, then the shared ladder's ceiling) is
	// what let a stale stream pin a receipt to a token the backend had abandoned,
	// with the mark still on the row and nothing but a `console.warn` to show for
	// it. What replaces it: this loop stops, and the loop that forms around the
	// state that supersedes the token is the one that acknowledges it.
	const calls = [];
	const warnings = [];
	const harness = mount(async (request) => {
		calls.push(request);
		throw superseded();
	});
	harness.seed([row(attention())]);
	const warn = console.warn;
	console.warn = (...args) => warnings.push(args.map(String).join(" "));
	try {
		harness.start();
		assert.equal(harness.live().length, 1, "the loop did not start");
		await harness.tick();
		assert.equal(calls.length, 1, "the first attempt was not made");
		// Twenty more ticks is ten minutes of the poll cadence: nothing further may go
		// out, because this loop has nothing left to say.
		for (let tick = 0; tick < 20; tick += 1) await harness.tick();
		assert.equal(calls.length, 1, "a superseded refusal was retried");
		assert.deepEqual(
			[],
			harness.live(),
			"the loop outlived the refusal that ended it",
		);
	} finally {
		console.warn = warn;
	}
	assert.deepEqual(
		[],
		warnings,
		"a superseded refusal was reported as an unresolved receipt",
	);
	assert.equal(
		store.getState().readAckNotice,
		null,
		"a superseded refusal left a state on the row",
	);
});

test("only the backend's own superseded refusal is terminal", async () => {
	// The CLASS gate, the same one `isStoreBusy` applies and for the same reason:
	// `DesktopControlError.code` is a vetted wire category while `Error.code` on a
	// Node failure is `ENOENT` and friends - so a transport error that happens to
	// carry the string is an ordinary failure and keeps its ladder, rather than
	// ending a loop the backend never refused.
	const calls = [];
	const harness = mount(async (request) => {
		calls.push(request);
		throw Object.assign(new Error("not the backend's statement"), {
			status: 409,
			code: "superseded_completion_token",
		});
	});
	harness.start();
	for (let attempt = 0; attempt < 5; attempt += 1) await harness.tick();
	assert.equal(
		calls.length,
		3,
		"a transport error carrying the code skipped the ladder",
	);
});

test("the feed's newer completion is the token an attempt carries", async () => {
	// THE RE-READ, and the half of M1 the terminal arm depends on. The two channels
	// are independent by construction (the backend's durable store and its feed
	// versus the session stream's own copy), and the contract names the FEED as the
	// arrival path for the state that supersedes a stale token. With the feed ahead,
	// the loop's subject is the newer of the two, so the attempt acknowledges the
	// completion the app now names rather than the one the stream still holds - and
	// the anchor it hit-tests is that completion's own row, which is what keeps the
	// re-read from acknowledging anything blindly.
	const calls = [];
	const harness = mount(async (request) => {
		calls.push(request);
		return attention({
			completion_token: "fresh",
			unseen: false,
			revision: [2, 1],
		});
	});
	// The ROW (the feed's copy) already names the newer completion; the stream does not.
	const newer = attention({
		completion_token: "fresh",
		anchor_id: "result-2",
		revision: [2, 0],
	});
	harness.seed([row(newer)]);
	harness.start(frontend());
	await harness.tick();
	assert.equal(calls.length, 1, "the attempt was not made");
	assert.equal(
		calls[0].completionToken,
		"fresh",
		"the attempt re-sent the token the stream still named",
	);
	assert.ok(
		(harness.queries().at(-1) ?? "").includes("result-2"),
		"the attempt hit-tested an anchor that is not the completion it sent",
	);
	assert.equal(
		rowAttention()?.unseen,
		false,
		"the answer did not clear the row",
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

test("a closed window is not a reader, and opening it again is not a gesture", async () => {
	// The honesty rule the whole hook is built around, pinned from the attempt
	// side now that the gates are asked per attempt: focus and visibility are read
	// AT THE ATTEMPT, so a window the user is not looking at never receipts - and
	// the loop is still alive underneath, so neither a blur nor a hide can end it.
	const calls = [];
	const harness = mount(async (request) => {
		calls.push(request);
		return attention({ unseen: false, revision: [1, 1] });
	});
	harness.seed([row(attention())]);
	harness.start();
	globalThis.document.hasFocus = () => false;
	await harness.tick();
	assert.equal(calls.length, 0, "an unfocused window receipted a completion");
	globalThis.document.visibilityState = "hidden";
	globalThis.document.hasFocus = () => true;
	await harness.tick();
	assert.equal(calls.length, 0, "a hidden window receipted a completion");
	globalThis.document.visibilityState = "visible";
	await harness.tick();
	assert.equal(
		calls.length,
		1,
		"the loop did not survive the window being closed and reopened",
	);
});

test("the refusal code is pinned to the backend's documented wire values", () => {
	// The strings belong to the BACKEND (`SUPERSEDED_TOKEN_CODE` in
	// `local_operator/session/attention.py`, `STORE_BUSY` in
	// `local_operator/session/store_failures.py`, both documented in
	// docs/DESKTOP_API.md). A renderer cannot import Python, so these copies
	// cannot be bound automatically -- pinning them HERE, as literals, is what
	// turns a change on either side into a failing test rather than a client that
	// quietly stops recognising the refusal (agent review round 1, N2).
	assert.equal(
		contract.SUPERSEDED_COMPLETION_TOKEN_CODE,
		"superseded_completion_token",
		"the renderer no longer recognises the backend's superseded-token code",
	);
	assert.equal(
		contract.STORE_BUSY_CODE,
		"store_busy",
		"the renderer no longer recognises the backend's store-contention code",
	);
});

test("an answer about another conversation never settles this one", async () => {
	const calls = [];
	const harness = mount(async (request) => {
		calls.push(request);
		return attention({
			conversation_id: `session/${OTHER}`,
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

test("the loop survives a gate that was closed when it was created", async () => {
	// WHAT MAY NOT DECIDE WHETHER THE LOOP EXISTS. The gates that decide whether an
	// ATTEMPT may go out used to be asked once, in the effect body -- so a `ready`
	// that was false at that instant created NO interval at all, and the retry that
	// should have followed the first refusal never happened until something else
	// re-ran the effect. The pane finishing its validate is a re-render, not a
	// change to what this loop is ABOUT (an unread completion), so the interval is
	// created with the rest of the state unread and each attempt asks the gate
	// again.
	const calls = [];
	const harness = mount(async (request) => {
		calls.push(request);
		return attention();
	});
	harness.start(frontend(), false);
	await harness.tick();
	assert.equal(
		calls.length,
		0,
		"an attempt went out while the pane was not ready",
	);
	harness.render(frontend(), true);
	await harness.tick();
	assert.equal(
		calls.length,
		1,
		"the loop died with the gate that was closed when it was created",
	);
});

test("a newer completion mid-loop gets a fresh budget, not the older token's wait", async () => {
	// The state can move on to a newer completion while this loop is alive. A render
	// that changes the token re-creates the loop (the effect's deps); the same rule
	// has to hold for the change the tick sees first, or the reader waits out a
	// minute the ladder built for a token the backend no longer names -- which is
	// what a superseded refusal means.
	const calls = [];
	let now = 0;
	const originalNow = Date.now;
	const originalWarn = console.warn;
	Date.now = () => now;
	console.warn = () => {};
	try {
		const harness = mount(async (request) => {
			calls.push(request);
			return attention();
		});
		harness.start();
		for (let attempt = 0; attempt < 3; attempt += 1) {
			now += 500;
			await harness.tick();
		}
		assert.equal(calls.length, 3, "the flat window did not run");
		assert.equal(now, 1_500);
		harness.render(
			frontend({ attention: attention({ completion_token: "fresh" }) }),
		);
		now += 500;
		await harness.tick();
		assert.equal(
			calls.length,
			4,
			"the newer completion waited out the older token's ladder",
		);
		assert.equal(
			calls.at(-1).completionToken,
			"fresh",
			"the attempt re-sent a token the backend had moved past",
		);
	} finally {
		Date.now = originalNow;
		console.warn = originalWarn;
	}
});

test("the operator's own press re-arms an attempt the ladder had pushed out", async () => {
	// "CLICK INTO IT = MARK IT READ" is the operator's stated expectation, and the
	// press of a row is the only act that says they are looking at this result now.
	// Backoff had pushed the next attempt a minute out, and re-opening the session
	// left that deferred attempt exactly where it was -- so the operator's remedy
	// for a mark that did not clear did nothing at all (the reported defect).
	const calls = [];
	let now = 0;
	const originalNow = Date.now;
	const originalWarn = console.warn;
	Date.now = () => now;
	console.warn = () => {};
	try {
		const harness = mount(async (request) => {
			calls.push(request);
			return attention();
		});
		harness.start();
		// Three flat attempts, then the shared ladder's first step.
		for (let attempt = 0; attempt < 6; attempt += 1) {
			now += 500;
			await harness.tick();
		}
		const before = calls.length;
		assert.equal(before, 4, "the fixture did not reach the backed-off ladder");
		now += 1_000;
		await harness.tick();
		assert.equal(
			calls.length,
			before,
			"the ladder did not defer the retry at all",
		);
		harness.press();
		await harness.tick();
		assert.equal(
			calls.length,
			before + 1,
			"the press did not release the deferred attempt",
		);
	} finally {
		Date.now = originalNow;
		console.warn = originalWarn;
	}
});

test("a press of another conversation does not release this one's attempt", async () => {
	// The re-arm names a conversation rather than setting a flag, and this is the
	// case that says why: the sidebar is a list of rows, so a press that released
	// every waiting receipt would acknowledge one conversation for another's
	// gesture.
	const calls = [];
	let now = 0;
	const originalNow = Date.now;
	const originalWarn = console.warn;
	Date.now = () => now;
	console.warn = () => {};
	try {
		const harness = mount(async (request) => {
			calls.push(request);
			return attention();
		});
		harness.start();
		for (let attempt = 0; attempt < 6; attempt += 1) {
			now += 500;
			await harness.tick();
		}
		const before = calls.length;
		now += 1_000;
		await harness.tick();
		assert.equal(calls.length, before, "the ladder did not defer the retry");
		harness.press(OTHER);
		await harness.tick();
		assert.equal(
			calls.length,
			before,
			"a press of another conversation released this one's attempt",
		);
	} finally {
		Date.now = originalNow;
		console.warn = originalWarn;
	}
});

test("re-opening the conversation the view is already on stamps the re-arm", async () => {
	// The gesture reaches the store through `openSession`, which is a NO-OP for a
	// switch onto the row the view is already on -- and that is exactly the press
	// an operator makes when a mark did not clear. The switch is a no-op; the
	// stamp is the half that must not be, and two presses must be two events
	// rather than one truthy value.
	store.setState({
		sessions: [row(attention())],
		activeSessionId: SESSION,
		activeDraftKey: null,
		readAckRearm: null,
	});
	await store.getState().openSession(SESSION);
	assert.equal(
		store.getState().readAckRearm?.sessionId,
		SESSION,
		"re-opening the active conversation did not stamp the receipt's re-arm",
	);
	assert.equal(
		store.getState().readAckRearm?.revision,
		1,
		"the press was not the first one",
	);
	await store.getState().openSession(SESSION);
	assert.equal(
		store.getState().readAckRearm?.revision,
		2,
		"two presses of the same row were one event",
	);
});

test("opening another conversation stamps that conversation", async () => {
	// A switch onto a different row is the ordinary case, and the stamp must name
	// the row the operator pressed rather than whatever was open.
	store.setState({
		sessions: [row(attention()), row(attention(), { session_id: OTHER })],
		activeSessionId: SESSION,
		activeDraftKey: null,
		readAckRearm: null,
	});
	await store.getState().openSession(OTHER);
	assert.equal(store.getState().activeSessionId, OTHER);
	assert.equal(
		store.getState().readAckRearm?.sessionId,
		OTHER,
		"the switch did not stamp the row the operator pressed",
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

/* ------------------------------------------------ the receipt's visible state */

/*
 * WHAT THE ROW CAN DRAW (UX round 1, U1), and the arms that make the three
 * states distinguishable rather than three names for one screen. `useCompletionView`
 * publishes `readAckNotice` while it has a loop for a conversation, and the
 * sidebar's row renders the clause; the sentence for the give-up arm is fired
 * into the panel's toast lane by the same panel (one home for the words:
 * `features/chat/read-ack-notice.ts`). What is asserted here is the STATE, which
 * is the half that lives in this tree's shipped hook - the row's rendering and
 * the toast are the sidebar's, and `scripts/mark-all-read-control.test.mjs`
 * drives that panel.
 */

test("a store that keeps refusing publishes the in-flight cue, then the give-up state", async () => {
	// THE DEFECT U1 IS ABOUT: after the contention budget and the shared ladder the
	// only trace of an unacknowledged receipt was a `console.warn`, so "the app is
	// still trying" and "the app gave up" were the same screen, pixel for pixel,
	// with the mark on the row in both. `pending` is the first and `unsettled` the
	// second; the transition between them is the moment the ladder reaches its
	// ceiling, and the refusal rides along so the panel can say what the store said.
	const calls = [];
	const warnings = [];
	let now = 1_000_000;
	const originalNow = Date.now;
	const originalWarn = console.warn;
	Date.now = () => now;
	console.warn = (...args) => warnings.push(args.map(String).join(" "));
	try {
		const harness = mount(async (request) => {
			calls.push(request);
			throw storeBusy();
		});
		harness.start();
		assert.equal(
			store.getState().readAckNotice,
			null,
			"a state was published before anything was attempted",
		);
		now += 500;
		await harness.tick();
		assert.equal(calls.length, 1, "the first attempt was not made");
		const first = store.getState().readAckNotice;
		assert.equal(first?.kind, "pending", "the in-flight cue was not published");
		assert.equal(first?.sessionId, SESSION, "the cue did not name the row");
		// Through the contention budget and into the ladder's flat window the state
		// stays "trying" - which is the point of having two of them - and the
		// ceiling is what changes it.
		for (let tick = 0; tick < 40; tick += 1) {
			now += 500;
			await harness.tick();
		}
		const givenUp = store.getState().readAckNotice;
		assert.equal(
			givenUp?.kind,
			"unsettled",
			"the give-up state was never published",
		);
		assert.equal(givenUp?.sessionId, SESSION);
		assert.ok(
			givenUp?.reason instanceof DesktopControlError,
			"the refusal was not carried for the panel's own sentence",
		);
		assert.ok(
			givenUp.revision > first.revision,
			"the give-up state was published as the same statement",
		);
		assert.equal(
			warnings.filter((line) => line.includes("receipt unresolved")).length,
			1,
			"the ladder's own record changed with it",
		);
	} finally {
		Date.now = originalNow;
		console.warn = originalWarn;
	}
});

test("the receipt's state goes when the answer lands", async () => {
	// The other end of the lifetime rule: the statement is "the app is trying for
	// this completion", so the answer that clears the mark retires it. A clause
	// left behind would be a second, stale sentence about a receipt that succeeded.
	const calls = [];
	let now = 2_000_000;
	const originalNow = Date.now;
	const originalWarn = console.warn;
	Date.now = () => now;
	console.warn = () => {};
	try {
		const harness = mount(async (request) => {
			calls.push(request);
			if (calls.length === 1) throw storeBusy(10);
			return attention({ unseen: false, revision: [1, 1] });
		});
		harness.seed([row(attention())]);
		harness.start();
		now += 500;
		await harness.tick();
		assert.equal(
			store.getState().readAckNotice?.kind,
			"pending",
			"the retry published nothing",
		);
		now += 10;
		await harness.tick();
		assert.equal(calls.length, 2, "the released attempt did not go out");
		assert.equal(
			rowAttention()?.unseen,
			false,
			"the answer did not clear the row",
		);
		assert.equal(
			store.getState().readAckNotice,
			null,
			"the row kept a state for a receipt that landed",
		);
	} finally {
		Date.now = originalNow;
		console.warn = originalWarn;
	}
});

test("a result below the fold says so, and heals when the reader scrolls to it", async () => {
	// U2: THE ONE PRESS THAT CAN NEVER SUCCEED. The anchor hit test is the
	// definition of "shown", so a completion whose result is off screen is never
	// receipted - and the operator's own remedy (press the row again) cannot
	// satisfy a precondition they cannot see, while the store is healthy and the
	// loop is alive. Nothing is weakened for it: the state names itself and names
	// the move that works, and performing that move is what releases the receipt.
	const calls = [];
	const harness = mount(
		async (request) => {
			calls.push(request);
			return attention({ unseen: false, revision: [1, 1] });
		},
		// The fixture's anchor row ends at y 298; a 200px viewport puts it below the
		// fold, which is the state the reader is in when they have scrolled up.
		{ innerHeight: 200 },
	);
	harness.seed([row(attention())]);
	harness.start();
	await harness.tick();
	assert.equal(calls.length, 0, "a result below the fold was receipted");
	assert.equal(
		store.getState().readAckNotice?.kind,
		"offscreen",
		"the refusal was silent",
	);
	globalThis.innerHeight = 800;
	await harness.tick();
	assert.equal(
		calls.length,
		1,
		"the receipt did not go out once the result was shown",
	);
	assert.equal(
		store.getState().readAckNotice,
		null,
		"the clause outlived the state it named",
	);
});

test("a completion whose anchor row is not rendered says so too", async () => {
	// The other shape of "not on screen": the result is not in the DOM at all,
	// because the transcript pages its window and this anchor is outside it. The
	// press cannot repair it either, and the same clause names the same move -
	// scrolling toward the result is what both shows it and releases the receipt.
	const calls = [];
	const harness = mount(
		async (request) => {
			calls.push(request);
			return attention({ unseen: false, revision: [1, 1] });
		},
		{ anchor: false },
	);
	harness.seed([row(attention())]);
	harness.start();
	await harness.tick();
	assert.equal(calls.length, 0, "an unrendered result was receipted");
	assert.equal(
		store.getState().readAckNotice?.kind,
		"offscreen",
		"the refusal was silent",
	);
});

test("a non-finite retry_after_ms does not disarm the wait gate", async () => {
	// N1: `Math.max(0, NaN)` is `NaN`, and `Date.now() < NaN` is false - so a
	// non-finite field would make the gate that defers the retry stop gating and
	// the prompt budget be spent at the poll cadence. The transport only sets the
	// field behind `Number.isFinite`, so this is about a future writer of it.
	const calls = [];
	let now = 3_000_000;
	const originalNow = Date.now;
	const originalWarn = console.warn;
	Date.now = () => now;
	console.warn = () => {};
	try {
		const harness = mount(async (request) => {
			calls.push(request);
			throw storeBusy(Number.NaN);
		});
		harness.start();
		now += 500;
		await harness.tick();
		assert.equal(calls.length, 1, "the first attempt was not made");
		now += 999;
		await harness.tick();
		assert.equal(calls.length, 1, "a non-finite wait made the retry immediate");
		now += 1;
		await harness.tick();
		assert.equal(calls.length, 2, "the default wait did not hold");
	} finally {
		Date.now = originalNow;
		console.warn = originalWarn;
	}
});

test("the ladder's warning is once per budget, and a press earns a new budget", async () => {
	// N4: the warning fired on the `attempts === 3` crossing alone, which is once
	// per window only while nothing resets the counter inside one - and a press
	// resets everything. So a reader whose press bought a second budget earned a
	// second bound for the same refusal, and the cases asserting one warning held
	// only because none of them pressed mid-window. The rule is once per BUDGET,
	// and a budget is what a press creates.
	const calls = [];
	const warnings = [];
	let now = 4_000_000;
	const originalNow = Date.now;
	const originalWarn = console.warn;
	Date.now = () => now;
	console.warn = (...args) => warnings.push(args.map(String).join(" "));
	try {
		const harness = mount(async (request) => {
			calls.push(request);
			throw Object.assign(new Error("backend unreachable"), { status: null });
		});
		harness.start();
		for (let tick = 0; tick < 8; tick += 1) {
			now += 500;
			await harness.tick();
		}
		assert.equal(
			warnings.length,
			1,
			"the first budget's bound was not recorded once",
		);
		harness.press();
		await harness.tick();
		assert.equal(
			warnings.length,
			1,
			"the press's own attempt warned before its ladder was spent",
		);
		for (let tick = 0; tick < 8; tick += 1) {
			now += 500;
			await harness.tick();
		}
		assert.equal(
			warnings.length,
			2,
			"the second budget's bound was not recorded once",
		);
	} finally {
		Date.now = originalNow;
		console.warn = originalWarn;
	}
});

test("an attempt whose render is gone lands nothing", async () => {
	// N3, answered by construction rather than by comment: the token is a
	// dependency, so a state that moves on while an attempt is out tears the loop
	// down and creates another - which means two `/seen` calls can be in flight for
	// one conversation, about two different tokens. The OLDER one is about a
	// subject nothing is watching any more, so its answer is dropped: it neither
	// writes the row nor publishes a state for a receipt the app has stopped
	// making, and the newer loop is the authority from the moment it exists.
	const pending = [];
	const harness = mount(
		(request) =>
			new Promise((resolve) => {
				pending.push({ request, resolve });
			}),
	);
	harness.seed([row(attention())]);
	harness.start();
	await harness.tick();
	assert.equal(pending.length, 1, "the first attempt did not go out");
	assert.equal(pending[0].request.completionToken, TOKEN);
	const newer = attention({ completion_token: "fresh", revision: [2, 0] });
	harness.seed([row(newer)]);
	harness.start();
	await harness.tick();
	assert.deepEqual(
		pending.map((entry) => entry.request.completionToken),
		[TOKEN, "fresh"],
		"the re-created loop did not attempt the state that superseded the token",
	);
	pending[1].resolve(
		attention({ completion_token: "fresh", unseen: false, revision: [2, 1] }),
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(
		rowAttention()?.unseen,
		false,
		"the newer answer did not clear the row",
	);
	pending[0].resolve(attention({ unseen: true }));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(
		rowAttention()?.unseen,
		false,
		"an attempt whose render was gone undid the newer read",
	);
	assert.equal(
		store.getState().readAckNotice,
		null,
		"an attempt whose render was gone announced a receipt nothing is making",
	);
});

test("the loop's interval is torn down with its selection", async () => {
	// M2, which closed a hole in this FILE rather than in the hook: the fixture
	// installed `clearInterval` as a no-op and stepped only the newest callback, so
	// a dropped `stop()` (or a missing effect cleanup) leaked one 500 ms interval
	// per dependency change and passed every case above. The interval table is real
	// now, and this is the case that fails when the loop outlives its selection.
	const harness = mount(async () => attention());
	harness.start();
	assert.equal(
		harness.live().length,
		1,
		"the loop did not create its interval",
	);
	const first = harness.live();
	// A dependency change - the state moving on to a newer completion - is React
	// calling this cleanup and then the body again. The old interval must go.
	harness.start(
		frontend({ attention: attention({ completion_token: "fresh" }) }),
	);
	assert.equal(
		harness.live().length,
		1,
		"a dependency change left the old loop's interval live",
	);
	assert.notDeepEqual(
		first,
		harness.live(),
		"the interval that survived is the one the old loop created",
	);
	harness.unmount();
	assert.deepEqual(harness.live(), [], "the interval outlived the selection");
});
