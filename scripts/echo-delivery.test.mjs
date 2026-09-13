import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// The store persists through `zustand/middleware`, which reaches for
// localStorage at import time. Same shim as `canonical-chat.test.mjs`.
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/*
 * BLOCKER-1 (review round 1): does the optimistic echo actually REACH a
 * transcript on the New-chat path?
 *
 * Why this file exists beside `canonical-chat.test.mjs` rather than inside it:
 * that harness aliases the echo seam to a recorder that always records, which
 * is exactly what hid this defect. It proves the store CALLS `echoPendingUser`
 * with the right arguments — it does — and is structurally incapable of
 * observing that nothing was listening. So this file stubs the opposite side:
 * the REAL registry and the REAL `admitChatDraft` are both under test, and only
 * the network and React's scheduler are substituted.
 *
 * The timing model is the point. On the draft path the session id does not
 * exist until `createSession` returns, and the store patches that id and fires
 * the echo in ONE synchronous block — before React has committed the render
 * that mounts the panel, let alone flushed the passive effect that registers
 * its transcript. Registration is therefore modelled as a passive effect on a
 * macrotask (`setTimeout(0)`), which is strictly MORE generous than React's
 * actual commit timing: if the echo survives here it survives in the app.
 *
 * Pre-fix, this file reports the reviewer's measurement: draft send 0 landed /
 * 1 dropped / 0 painted, existing-session send 1/0/1.
 */
const bundle = await build({
	stdin: {
		contents: `
			export { admitChatDraft, useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { echoPendingUser, retractPendingUser, discardPendingEchoes, __registerEchoTarget } from "./src/renderer/src/shared/hooks/use-canonical-session";
			export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
			export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			name: "echo-delivery-fixture",
			setup(builder) {
				// ONLY the network is faked. The registry, the reducer and the store
				// are the shipped modules: the defect lived in how they compose, so
				// substituting any of them would substitute the thing under test.
				builder.onResolve({ filter: /local-operator\/desktop-api$/ }, () => ({
					path: "transport",
					namespace: "echo-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = (request) => globalThis.__echoRequest(request);
export const subscribeDesktopStream = () => () => {};`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				// React is never imported: the hook module is pulled in for its
				// module-level registry only, and a node bundle must not drag a
				// renderer in behind it.
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "echo-fixture-react",
				}));
				builder.onLoad(
					{ filter: /.*/, namespace: "echo-fixture-react" },
					() => ({
						contents: `export const useState = () => [undefined, () => {}];
export const useEffect = () => {};
export const useRef = (v) => ({ current: v });
export const useCallback = (f) => f;
export const useMemo = (f) => f();
export default {};`,
						loader: "js",
					}),
				);
			},
		},
	],
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	admitChatDraft,
	useCanonicalSessionsStore: store,
	echoPendingUser,
	retractPendingUser,
	discardPendingEchoes,
	__registerEchoTarget,
	EMPTY_TRANSCRIPT,
	DesktopControlError,
} = module;

const SESSION_ID = "222222222222";
// The ids the cross-session bound test buffers; named so `reset` can clear them.
const SCRATCH_SESSIONS = Array.from({ length: 40 }, (_, i) => `session-${i}`);
const input = {
	text: "Review this",
	attachments: [],
	images: [],
	mode: "prompt",
	cwd: "/tmp",
};

/**
 * A transcript that registers the way a mounted `SessionPanel` does: on a
 * macrotask after the store has already run, never synchronously with it.
 */
function mountTranscript(sessionId) {
	const painted = { current: EMPTY_TRANSCRIPT };
	return new Promise((resolve) => {
		setTimeout(() => {
			const unregister = __registerEchoTarget(sessionId, (mutate) => {
				painted.current = mutate(painted.current);
			});
			resolve({
				rows: () => painted.current.records.map((record) => record.text),
				unregister,
			});
		}, 0);
	});
}

function reset() {
	/*
	 * The echo buffer is MODULE state, so it outlives a store reset. Clearing it
	 * here keeps each test independent: without this, the bound tests below
	 * leave up to 16 buffered sessions behind and the next test's session can be
	 * evicted before it ever runs, which makes results depend on file order.
	 */
	for (const id of [SESSION_ID, "999999999999", ...SCRATCH_SESSIONS])
		discardPendingEchoes(id);
	store.setState({
		sessions: [],
		activeSessionId: null,
		activeDraftKey: null,
		drafts: {},
		sessionByAgent: {},
		pendingSessionId: null,
		error: null,
	});
}

test("a New-chat send paints into the transcript that mounts after the session exists", async () => {
	reset();
	/*
	 * THE HEADLINE CASE: New chat, type, Enter. No panel is mounted for this
	 * session when the echo fires, because the session did not exist a moment
	 * ago. Pre-fix this was measured at 0 painted; the composer had already
	 * cleared, so the user saw an empty box and an empty transcript for the
	 * whole ~1.15s engage.
	 */
	let mounted = null;
	globalThis.__echoRequest = async (request) => {
		if (request.op === "sessions.create") {
			// The panel for this session begins mounting as a consequence of the
			// store patching the id - i.e. strictly after the echo has been fired.
			mounted = mountTranscript(SESSION_ID);
			return { session_id: SESSION_ID, binding: null };
		}
		return { status: "admitted" };
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const requestId = store.getState().drafts[key].admissionRequestId;
	await admitChatDraft(key, input);

	const transcript = await mounted;
	assert.deepEqual(
		transcript.rows(),
		["Review this"],
		"the user's message must be painted once the transcript mounts - a dropped echo leaves a cleared composer over an empty transcript, which is worse than the lag it replaced",
	);
	transcript.unregister();
	// And it is keyed by the admission request id, so the owner's durable row
	// coalesces with it rather than painting the message a second time.
	assert.ok(requestId);
});

test("an existing-session send still paints immediately, with nothing queued", async () => {
	reset();
	// The path that already worked. It must keep working through the buffer:
	// a target registered BEFORE the echo is applied synchronously, never
	// deferred, because deferring would make a warm send flicker.
	const transcript = await mountTranscript(SESSION_ID);
	globalThis.__echoRequest = async () => ({ status: "admitted" });
	const key = `send:${SESSION_ID}`;
	await admitChatDraft(key, input, SESSION_ID);
	assert.deepEqual(transcript.rows(), ["Review this"]);
	transcript.unregister();
});

test("a pre-admission refusal retracts the echo even when it was queued", async () => {
	reset();
	/*
	 * The retraction has the same delivery problem as the paint it undoes: a 413
	 * or 422 resolves before the panel mounts, so an unqueued retraction would
	 * be dropped while the queued paint survived - leaving the transcript
	 * showing a message the backend provably never admitted, with the composer
	 * already restored. The user would see it in both places.
	 */
	let mounted = null;
	globalThis.__echoRequest = async (request) => {
		if (request.op === "sessions.create") {
			mounted = mountTranscript(SESSION_ID);
			return { session_id: SESSION_ID, binding: null };
		}
		throw new DesktopControlError(413, "This message is too large to send.");
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input));

	const transcript = await mounted;
	assert.deepEqual(
		transcript.rows(),
		[],
		"paint and retraction must be delivered in order, so a refused message does not survive in the transcript",
	);
	transcript.unregister();
});

test("an ambiguous failure keeps the queued echo painted", async () => {
	reset();
	// INV-C1 through the buffer: a 503 means the owner MAY have admitted the
	// turn, so the echo stays. Retracting it would make a message the agent is
	// about to answer vanish while it answers it.
	let mounted = null;
	globalThis.__echoRequest = async (request) => {
		if (request.op === "sessions.create") {
			mounted = mountTranscript(SESSION_ID);
			return { session_id: SESSION_ID, binding: null };
		}
		throw new DesktopControlError(503, "upstream unavailable");
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input));
	const transcript = await mounted;
	assert.deepEqual(transcript.rows(), ["Review this"]);
	transcript.unregister();
});

test("a queued echo is delivered once, not replayed onto a later mount", async () => {
	reset();
	// The buffer must be drained destructively. A retraction replayed after its
	// own paint had coalesced with the owner's durable row would delete a real
	// message, which is why the drain takes and deletes before applying.
	echoPendingUser(SESSION_ID, "req-queued", "queued once", []);
	const first = await mountTranscript(SESSION_ID);
	assert.deepEqual(first.rows(), ["queued once"]);
	first.unregister();

	const second = await mountTranscript(SESSION_ID);
	assert.deepEqual(
		second.rows(),
		[],
		"a remount must not repaint an echo the previous mount already consumed",
	);
	second.unregister();
});

test("an echo for a session nobody ever mounts does not leak into another", async () => {
	reset();
	// Addressing is still per session: the buffer is a delivery mechanism, not a
	// broadcast. A queued echo for an abandoned draft must never appear in the
	// next conversation the user opens.
	echoPendingUser("999999999999", "req-orphan", "orphaned", []);
	const transcript = await mountTranscript(SESSION_ID);
	assert.deepEqual(transcript.rows(), []);
	transcript.unregister();
	retractPendingUser("999999999999", "req-orphan");
});

test("the buffer bounds what it retains per session", async () => {
	reset();
	/*
	 * A RETENTION bound, not tidiness: each queued mutation closes over the
	 * message text and its images as base64, so an unbounded buffer keeps a
	 * user's content in renderer memory for the window's lifetime when a session
	 * never mounts. Oldest-first, because the newest paint is the one the user
	 * is waiting to see.
	 */
	for (let i = 0; i < 10; i++)
		echoPendingUser(SESSION_ID, `req-${i}`, `message ${i}`, []);
	const transcript = await mountTranscript(SESSION_ID);
	const rows = transcript.rows();
	assert.ok(
		rows.length <= 4,
		`the per-session buffer must be bounded, got ${rows.length} rows`,
	);
	assert.deepEqual(
		rows,
		["message 6", "message 7", "message 8", "message 9"],
		"the newest echoes survive - the oldest are the ones the user has stopped waiting for",
	);
	transcript.unregister();
});

test("the buffer bounds how many un-mounted sessions it holds", async () => {
	reset();
	// The other unbounded dimension: a user can stage drafts faster than panels
	// mount. Eviction is by insertion order, so the oldest un-mounted session -
	// the one least likely to ever be looked at - goes first.
	for (let i = 0; i < 40; i++)
		echoPendingUser(`session-${i}`, `req-${i}`, `text ${i}`, []);
	// The first session buffered must have been evicted by now.
	const evicted = await mountTranscript("session-0");
	assert.deepEqual(
		evicted.rows(),
		[],
		"the oldest un-mounted session must not still be retained after 40 others",
	);
	evicted.unregister();
	// The most recent one is still there, which is what keeps the bound useful
	// rather than merely safe.
	const kept = await mountTranscript("session-39");
	assert.deepEqual(kept.rows(), ["text 39"]);
	kept.unregister();
});

test("abandoning a draft drops whatever was buffered for it", async () => {
	reset();
	/*
	 * The user's deletion honoured in memory, not just in the store. A discarded
	 * draft is precisely the case where a panel may never mount, so without this
	 * the abandoned text and its attachments would outlive the row the user
	 * thinks they threw away.
	 */
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	store.setState((state) => ({
		drafts: {
			...state.drafts,
			[key]: { ...state.drafts[key], sessionId: SESSION_ID },
		},
	}));
	echoPendingUser(SESSION_ID, "req-abandoned", "abandoned text", []);
	store.getState().discardDraft(key);

	const transcript = await mountTranscript(SESSION_ID);
	assert.deepEqual(
		transcript.rows(),
		[],
		"an abandoned draft's echo must not be retained until some later mount",
	);
	transcript.unregister();
});

test("discarding echoes for one session leaves another untouched", async () => {
	reset();
	// The eviction is addressed, like the delivery it undoes.
	echoPendingUser(SESSION_ID, "req-keep", "keep me", []);
	discardPendingEchoes("999999999999");
	const transcript = await mountTranscript(SESSION_ID);
	assert.deepEqual(transcript.rows(), ["keep me"]);
	transcript.unregister();
});
