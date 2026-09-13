import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The switch's ORDERING, pinned rather than timed.
 *
 * `scripts/session-switch-latency.mjs` measures how long each phase of a switch
 * takes; this file pins the property that produced the number - that a switch
 * commits the target BEFORE the guard read answers, instead of after it. That
 * is a fact about order, not about duration, and a clock would only add flake
 * to a stronger assertion (the same division `submit-latency.test.mjs` draws
 * between its transport measurements and its structural claims).
 *
 * It FAILS on the pre-change store, and that is the point: with the read
 * awaited first, `activeSessionId` still names the outgoing session at the
 * moment of the click, which is exactly the serialisation the latency harness
 * measured as the whole of `click → committed`.
 *
 * What is also pinned here, because "commit optimistically" is only half a
 * design and the other half is what happens when the read says no:
 *
 * - the read is still ISSUED, for the latest intent only;
 * - a failed read puts the view back - session and draft - and says why;
 * - an older read cannot roll back a newer switch (the generation guard);
 * - an older read cannot claim success either, which is what keeps the URL
 *   from being rewritten to a session the user has already left.
 */

const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/** Every request the store made, and the scripted answers. */
const calls = [];
/** Set by each test: the answer for one `sessions.get`. */
let answer = async () => ({});

globalThis.__switchRequest = async (request) => {
	calls.push(request);
	if (request.op !== "sessions.get") return {};
	return answer(request);
};

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "switch-transport-fixture",
			setup(builder) {
				// Only the network is faked. The error classes are re-exported from
				// the real module, because the store's copy rules read `message` off
				// the shipped `DesktopControlError` shape and a stub that always
				// returned a bare string would let a raw exception through here and
				// still pass.
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = request => globalThis.__switchRequest(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				// The optimistic echo registry is a mounted-transcript concern; the
				// store only calls three functions on it, and none of them is on the
				// switch path. Stubbed so this file tests the store without mounting
				// React or opening an EventSource.
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export const echoPendingUser = () => {};
export const retractPendingUser = () => {};
export const discardPendingEchoes = () => {};`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});

const { useCanonicalSessionsStore: store } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const OUTGOING = "111111111111";
const TARGET = "222222222222";
const OTHER = "333333333333";

function reset({ draft = null } = {}) {
	calls.length = 0;
	answer = async () => ({});
	store.setState({
		sessions: [],
		activeSessionId: draft ? null : OUTGOING,
		activeDraftKey: draft,
		drafts: draft
			? {
					[draft]: {
						key: draft,
						createRequestId: "create",
						admissionRequestId: "admit",
					},
				}
			: {},
		sessionByAgent: {},
		pendingSessionId: null,
		error: null,
	});
}

/**
 * A read that stays open until `release` is called.
 *
 * `release(value)` resolves with it; `release(Promise.reject(...))` is how a
 * deferred FAILURE is injected - built here rather than at the call site so an
 * eager rejection cannot settle a read the test intends to still be in flight.
 */
function deferred() {
	let release;
	const promise = new Promise((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

test("the switch commits the target before the guard read answers", async () => {
	reset();
	const read = deferred();
	answer = () => read.promise;

	const pending = store.getState().openSession(TARGET);

	// The click's own frame. The outgoing session is already gone from the view:
	// this is the whole change, and it is why the assertion is here and not on a
	// duration.
	assert.equal(store.getState().activeSessionId, TARGET);
	assert.equal(store.getState().activeDraftKey, null);
	assert.equal(store.getState().pendingSessionId, null);
	assert.equal(store.getState().error, null);

	// The read is still issued - the guard was moved behind the commit, not
	// deleted - and it is still the thing that decides the result.
	assert.deepEqual(
		calls.map((request) => request.op),
		["sessions.get"],
	);
	assert.equal(calls[0].sessionId, TARGET);

	read.release({});
	assert.equal(await pending, true);
	assert.equal(store.getState().activeSessionId, TARGET);
});

test("a failed guard read puts the view back where it was, and says why", async () => {
	reset();
	answer = async () => {
		throw new Error("Unknown session.");
	};

	const ok = await store.getState().openSession(TARGET);

	assert.equal(ok, false);
	assert.equal(store.getState().activeSessionId, OUTGOING);
	assert.equal(store.getState().pendingSessionId, null);
	assert.equal(store.getState().error, "Unknown session.");
});

test("a failed read restores the draft the user was in, not just the session", async () => {
	reset({ draft: "draft:agent:reviewer" });
	answer = async () => {
		throw new Error("Unknown session.");
	};

	const ok = await store.getState().openSession(TARGET);

	assert.equal(ok, false);
	assert.equal(store.getState().activeDraftKey, "draft:agent:reviewer");
	assert.equal(store.getState().activeSessionId, null);
});

test("an older read cannot roll back a newer switch", async () => {
	reset();
	const first = deferred();
	const second = deferred();
	const reads = [first.promise, second.promise];
	answer = () => reads.shift();

	const firstSwitch = store.getState().openSession(TARGET);
	// The second click lands while the first read is still in flight.
	const secondSwitch = store.getState().openSession(OTHER);
	assert.equal(store.getState().activeSessionId, OTHER);

	// The first read now fails. It must not drag the view back to the outgoing
	// session: the user has already asked for something else, and this read is
	// not the one they are waiting on.
	first.release({});
	assert.equal(await firstSwitch, false);
	assert.equal(store.getState().activeSessionId, OTHER);

	/*
	 * The second read fails, and IT owns the rollback - to `TARGET`, because
	 * that is where the view was when the second click was made.
	 *
	 * This is the compound case: two consecutive failing reads inside one read's
	 * flight time, which needs a backend that refuses this session twice over.
	 * The rule is still "put back what the user was looking at", and after the
	 * first click that WAS the target - so the assertion is written to say what
	 * the rule is rather than what a single-failure test would assume. The error
	 * below is the part that matters: whatever is on screen, the user is told
	 * the last switch failed.
	 */
	second.release(Promise.reject(new Error("Unknown session.")));
	assert.equal(await secondSwitch, false);
	assert.equal(store.getState().activeSessionId, TARGET);
	assert.equal(store.getState().error, "Unknown session.");
});

test("a superseded read reports false, so the URL is never rewritten back", async () => {
	reset();
	const first = deferred();
	answer = async () => ({});

	const firstSwitch = store.getState().openSession(TARGET);
	const secondSwitch = store.getState().openSession(OTHER);

	first.release({});
	// `select` navigates on `true`; a late `true` here would navigate the user
	// back to the session they have left.
	assert.equal(await firstSwitch, false);
	assert.equal(await secondSwitch, true);
	assert.equal(store.getState().activeSessionId, OTHER);
});

test("cancelOpen abandons the switch without touching the commit", async () => {
	reset();
	const read = deferred();
	answer = () => read.promise;

	const pending = store.getState().openSession(TARGET);
	store.getState().cancelOpen();

	assert.equal(store.getState().pendingSessionId, null);

	read.release({});
	// Cancelled by a newer intent (the generation guard), so this call does not
	// claim success - but the commit it made is the user's, and nothing here
	// undoes it.
	assert.equal(await pending, false);
	assert.equal(store.getState().activeSessionId, TARGET);
});
