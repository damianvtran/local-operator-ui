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
			export { admitChatDraft, useCanonicalSessionsStore, draftIdentityFor, isRefusedBeforeAdmission } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { echoPendingUser, retractPendingUser, discardPendingEchoes, __registerEchoTarget, seedPendingEchoes } from "./src/renderer/src/shared/hooks/use-canonical-session";
			export { useMessageInput, COMPOSER_PLACEHOLDER, composerPlaceholder, clearSubmittedText, stagedPayloadOf } from "./src/renderer/src/shared/hooks/use-message-input";
			export { useConversationInputStore, mergeReturnedText, mergeReturnedPayload } from "./src/renderer/src/shared/store/conversation-input-store";
			export { EMPTY_TRANSCRIPT, applyEvent } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
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
				/*
				 * React is never imported by the DELIVERY fixtures - the hook module is
				 * pulled in for its module-level registry there, and a node bundle must
				 * not drag a renderer in behind it. The COMPOSER cases at the foot of
				 * this file do run the hook, through a cell-based stand-in installed
				 * per case: one cell per hook call, a setter that re-renders, and the
				 * value each closure sees. Read late, because a case installs its own.
				 */
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "echo-fixture-react",
				}));
				builder.onLoad(
					{ filter: /.*/, namespace: "echo-fixture-react" },
					() => ({
						contents: `const R = () => globalThis.__reactRuntime;
export const useState = (...a) => R().useState(...a);
export const useEffect = (...a) => R().useEffect(...a);
export const useLayoutEffect = (...a) => R().useLayoutEffect(...a);
export const useInsertionEffect = () => {};
export const useRef = (...a) => R().useRef(...a);
export const useCallback = (...a) => R().useCallback(...a);
export const useMemo = (...a) => R().useMemo(...a);
export const useSyncExternalStore = (...a) => R().useSyncExternalStore(...a);
export const useDebugValue = () => {};
export const createElement = () => ({});
export const Fragment = Symbol("fragment");
export default { useState, useEffect, useLayoutEffect, useInsertionEffect, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, createElement, Fragment };`,
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
	draftIdentityFor,
	isRefusedBeforeAdmission,
	useCanonicalSessionsStore: store,
	echoPendingUser,
	retractPendingUser,
	discardPendingEchoes,
	__registerEchoTarget,
	seedPendingEchoes,
	useMessageInput,
	COMPOSER_PLACEHOLDER,
	composerPlaceholder,
	clearSubmittedText,
	mergeReturnedText,
	mergeReturnedPayload,
	stagedPayloadOf,
	useConversationInputStore,
	EMPTY_TRANSCRIPT,
	applyEvent,
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
				/*
				 * The transcript itself, for a case that has to apply an OWNER frame
				 * (the durable row that answers an unconfirmed echo) rather than only
				 * read what the echo painted.
				 */
				state: () => painted.current,
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
		validatingSessionId: null,
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

test("INV-C1: an ambiguous failure retracts its own echo, and the owner's row brings it back", async () => {
	reset();
	/*
	 * WHAT CHANGED, AND WHAT INV-C1 BECOMES. The old rule kept the painted echo on a
	 * 503, on the argument that retracting it would make a message the agent is
	 * about to answer vanish while it answers it.
	 *
	 * That argument was made when the alternative was an EMPTY composer: the echo
	 * was the only copy of the message the user could see, so it had to stay. Now
	 * the failure hands the whole payload back to the composer, which is the copy
	 * the user acts on (Retry replays it under the same request id), so the echo is
	 * retracted - one copy on screen rather than two, and no row that claims a
	 * delivery nobody has confirmed.
	 *
	 * The second half is the half the old case was protecting, and it is pinned
	 * here rather than assumed: the row comes BACK the moment the owner's own
	 * `message_start` for the same id arrives, because the echo was keyed by the
	 * admission request id - which is the id the owner gives the durable row. So
	 * the message the agent is answering reappears as the row it actually is, and
	 * the store's reconciliation clears the composer (see
	 * `composer-send-failure.test.mjs`, "a delivered-after-all failure ...").
	 */
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
	/*
	 * The id the echo was keyed by, read off the draft the press left behind: this
	 * is the id the owner gives the durable row, which is what lets the case below
	 * be about coalescing rather than about two unrelated rows.
	 */
	const requestId = store.getState().drafts[key]?.admissionRequestId ?? "";
	assert.deepEqual(
		transcript.rows(),
		[],
		"an unconfirmed send leaves no echo behind: the message is in the composer, and this app has not confirmed anything",
	);

	/*
	 * The owner's durable row, applied through the real reducer the live feed uses.
	 * `applyEvent` is the same entry a `message_start` frame takes, so this is the
	 * contract's own shape rather than a hand-built record.
	 */
	const resumed = applyEvent(
		transcript.state(),
		{
			type: "message_start",
			message: {
				id: requestId,
				role: "user",
				content: [{ type: "text", text: input.text }],
				tool_calls: [],
			},
		},
		1,
	);
	assert.deepEqual(
		resumed.records.map((record) => record.text),
		[input.text],
		"the owner's row arrives under the request id, so the message the agent is answering is back on screen",
	);
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
	 *
	 * The DRAFT path: keyed `draft:<uuid>`, and the row learns its session id
	 * mid-send, so the id is on the row.
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

test("abandoning a send from an existing conversation also drops its echo", async () => {
	reset();
	/*
	 * THE COMMONEST SEND, and the one the first version of this eviction missed
	 * entirely (review R3-5 / QA Q8).
	 *
	 * The key comes from the SHIPPED `draftIdentityFor` rather than a literal
	 * written here, because the defect was precisely a disagreement between the
	 * key's shape and where the code looked for the session id: a `send:<id>`
	 * draft never stores `sessionId` on the row - it is passed to
	 * `admitChatDraft` as an argument - so an eviction reading only the row was
	 * a silent no-op and the abandoned message kept its text and base64 images
	 * until that session next mounted.
	 *
	 * Driving the real rule means a future change to how send drafts are keyed
	 * fails this test instead of quietly reopening the leak.
	 */
	const key = draftIdentityFor(null, SESSION_ID);
	assert.equal(key, `send:${SESSION_ID}`, "the shipped key rule, not a guess");
	store.setState((state) => ({
		// The row as a real send creates it: a retained payload, and NO session id.
		drafts: { ...state.drafts, [key]: { submittedText: "abandoned send" } },
	}));
	assert.equal(
		store.getState().drafts[key].sessionId,
		undefined,
		"a send draft genuinely carries no session id - this is why reading the row alone failed",
	);
	echoPendingUser(SESSION_ID, "req-send-abandoned", "abandoned send", []);
	store.getState().discardDraft(key);

	const transcript = await mountTranscript(SESSION_ID);
	assert.deepEqual(
		transcript.rows(),
		[],
		"abandoning a send must evict its buffered echo, or the message the user discarded paints when the session is next opened",
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

/* ===================================================================== composer */

/*
 * UX round 1's U1/U2 and design round 1's D1 are claims about the COMPOSER's own
 * state: when the box empties, and what it holds after a failed send. Nothing in
 * this repository executed `useMessageInput` - the reviewer said so, and it is
 * why the clobber pinned below survived five rounds - because these harnesses
 * have no DOM and no renderer.
 *
 * So the composer is driven through the cell-based React stand-in above. What it
 * models is what the claims rest on: one cell per hook call, a setter that
 * re-renders (and BAILS OUT on an unchanged value, as React does - the hook's
 * own effects depend on that), dep-gated effects, and the value each closure
 * sees. What it does NOT model is React's scheduler, its batching or its commit
 * timing, so nothing here may claim anything about a frame: the box's contents
 * at a moment, never what was painted when.
 */
const COMPOSER_ID = `send:${SESSION_ID}`;

/** One composer, driven through one submit. */
function makeComposerRuntime() {
	const cells = [];
	let cursor = 0;
	let effects = [];
	const runtime = { render: () => null };
	const rerender = () => {
		cursor = 0;
		effects = [];
		const out = runtime.render();
		const flushed = effects;
		effects = [];
		for (const fn of flushed) fn?.();
		return out;
	};
	runtime.rerender = rerender;
	const slot = () => {
		const index = cursor++;
		if (!cells[index]) cells[index] = {};
		return cells[index];
	};
	const unchanged = (was, now) =>
		was !== undefined &&
		now !== undefined &&
		was.length === now.length &&
		was.every((value, index) => Object.is(value, now[index]));

	globalThis.__reactRuntime = {
		useState: (init) => {
			const cell = slot();
			if (!("state" in cell))
				cell.state = typeof init === "function" ? init() : init;
			return [
				cell.state,
				(value) => {
					const next = typeof value === "function" ? value(cell.state) : value;
					if (Object.is(next, cell.state)) return;
					cell.state = next;
					rerender();
				},
			];
		},
		useRef: (init) => {
			const cell = slot();
			if (!("ref" in cell)) cell.ref = { current: init };
			return cell.ref;
		},
		useCallback: (fn, deps) => {
			const cell = slot();
			if (!cell.fn || !unchanged(cell.deps, deps)) {
				cell.fn = fn;
				cell.deps = deps;
			}
			return cell.fn;
		},
		useMemo: (fn, deps) => {
			const cell = slot();
			if (!("value" in cell) || !unchanged(cell.deps, deps)) {
				cell.value = fn();
				cell.deps = deps;
			}
			return cell.value;
		},
		useEffect: (fn, deps) => {
			const cell = slot();
			if (unchanged(cell.deps, deps)) return;
			cell.cleanup?.();
			cell.deps = deps;
			effects.push(() => {
				cell.cleanup = fn();
			});
		},
		useLayoutEffect: (fn, deps) => {
			const cell = slot();
			if (unchanged(cell.deps, deps)) return;
			cell.cleanup?.();
			cell.deps = deps;
			effects.push(() => {
				cell.cleanup = fn();
			});
		},
		useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
	};
	return runtime;
}

async function driveComposer({ onSubmit, initial = input.text, prime }) {
	// The composer's persisted draft is module state and outlives a case.
	useConversationInputStore.setState({ inputByConversation: {} });
	/*
	 * Run after the wipe and before the typing, so a case can stage the chip row
	 * the way a real press leaves it (the hooks write through the same store, so
	 * a `prime` that ran first would be erased by the reset above).
	 */
	if (prime) prime();
	const runtime = makeComposerRuntime();
	let composer;
	runtime.render = () => {
		composer = useMessageInput({
			conversationId: COMPOSER_ID,
			onSubmit: (message, onEchoPainted) =>
				onSubmit({
					message,
					onEchoPainted,
					type: (value) => composer.setInputValue(value),
					box: () => composer.inputValue,
				}),
		});
		return composer;
	};
	runtime.rerender();
	// Typing goes through the hook's own change handler, so the box and the
	// persisted draft move together the way they do under a real keypress.
	composer.setInputValue(initial);
	runtime.rerender();
	const before = composer.inputValue;
	await composer.handleSubmit();
	return {
		before,
		after: composer.inputValue,
		storedDraft:
			useConversationInputStore.getState().inputByConversation[COMPOSER_ID]
				?.currentInput ?? "",
		/*
		 * The composer's OTHER half, read the way the composer reads it
		 * (`message-input.tsx` selects `attachments`/`replies` out of the same
		 * row), and read through paths rather than chip ids because a chip's id is
		 * an identity for the row rather than part of any payload.
		 */
		chips: () =>
			(
				useConversationInputStore.getState().inputByConversation[COMPOSER_ID]
					?.attachments ?? []
			).map((chip) => chip.path),
		replies: () =>
			(
				useConversationInputStore.getState().inputByConversation[COMPOSER_ID]
					?.replies ?? []
			).map((reply) => reply.text),
		/*
		 * Whether the durable record of an unconfirmed send is gone. It exists so a
		 * quit or a crash mid-flight restores the whole message; a failure that put
		 * the message back in the composer has no reason to keep it, and keeping it
		 * would hand the same message back a second time after a restart.
		 */
		inFlightGone:
			useConversationInputStore.getState().inputByConversation[COMPOSER_ID]
				?.inFlight === undefined,
	};
}

test("U1: the composer holds the text until the echo is painted, and empties with it", async () => {
	const seen = {};
	await driveComposer({
		onSubmit: ({ onEchoPainted, box }) => {
			seen.atSubmit = box();
			// The old composer cleared here, one line before the await, which is
			// what left the user looking at an empty box for the create hop.
			onEchoPainted?.();
			seen.atPaint = box();
			return true;
		},
	});
	assert.equal(
		seen.atSubmit,
		input.text,
		"the box must still hold the message while the send is in flight",
	);
	assert.equal(
		seen.atPaint,
		"",
		"the clear happens in the same call as the paint, so the text moves in one step",
	);
});

test("F1: a send whose echo never paints still retires the box (post-settle fallback)", async () => {
	/*
	 * Round 7, F1. The buffered path's callback is delivered to a composer the
	 * identity flip has already unmounted, so no test that drives the callback
	 * can tell whether the post-settle fallback after the await is still there:
	 * deleting it kept this file green. This case drives the path that has no
	 * echo at all - a slash command, a gate answer, the legacy model path - and
	 * is the shipped test that fails when that fallback is removed.
	 */
	const settled = await driveComposer({ onSubmit: () => true });
	assert.equal(
		settled.after,
		"",
		"a send that never echoes must still clear the box once it settles",
	);
	assert.equal(
		settled.storedDraft,
		"",
		"and retire the persisted draft, or a later mount adopts the text back",
	);
});

test("U2: a failed send hands the message back through the store, under the user's typing", async () => {
	/*
	 * WHAT CHANGED, AND WHY THIS CASE IS DRIVEN FROM THE STORE'S ROW. The hook used
	 * to restore the text itself, into an EMPTY box only - a rule that could not
	 * survive the New-chat identity flip, because the composer that pressed Enter is
	 * unmounted by the time the failure lands and the restore was a `setState` on a
	 * component that no longer exists (UX round 3, U14). The failure now returns the
	 * payload through the store (`returnPayloadToComposer`, which is exactly this
	 * `returnInFlight` call), and the composer TAKES it here (`pendingText` -> the
	 * hook's adoption effect), merging rather than overwriting.
	 *
	 * So the hook's own half of the rule is what this case pins: the box adopts a
	 * return that the STORE wrote, and what the user typed during the flight is kept
	 * - after the returned message, because theirs came second.
	 */
	const quiet = await driveComposer({
		onSubmit: ({ onEchoPainted }) => {
			onEchoPainted?.();
			returnInFlight();
			return false;
		},
	});
	assert.equal(
		quiet.after,
		input.text,
		"a failure with an untouched box must hand the message back",
	);
	assert.equal(
		quiet.inFlightGone,
		true,
		"and the in-flight record is consumed by the return, or a restart would hand the same message back twice",
	);

	const typed = await driveComposer({
		onSubmit: ({ onEchoPainted, type }) => {
			onEchoPainted?.();
			type("A second message");
			returnInFlight();
			return false;
		},
	});
	assert.equal(
		typed.after,
		`${input.text}\n\nA second message`,
		"the user's own typing is never overwritten, and the returned message goes FIRST because it was sent first",
	);

	// The merge itself, shipped and pure, so a future edit to either transition is
	// read against the same rule rather than against the call site.
	assert.equal(clearSubmittedText(input.text, input.text), "");
	assert.equal(
		clearSubmittedText(`${input.text} and more`, input.text),
		`${input.text} and more`,
	);
	assert.equal(mergeReturnedText("", input.text), input.text);
	assert.equal(
		mergeReturnedText("A second message", input.text),
		`${input.text}\n\nA second message`,
	);
});

test("D1/U5: an unconfirmed send hands its text back to the box, and keeps nothing else", async () => {
	/*
	 * THE CASE THE OPERATOR REPORTED, ported. The old answer on this arm was to
	 * retire the box and keep the message in a claim, with the echo deliberately
	 * left painted as the only copy the user could see - which is what put the
	 * "still being held" paragraph and the Restore link on their screen, over an
	 * empty composer, and blocked any different message.
	 *
	 * The new answer is that the text comes back. The echo is retracted by the
	 * send path when the outcome is unknown (retracted only while it is still this
	 * app's own echo: an owner row for the same id means the message was delivered,
	 * and that arm is pinned in `composer-send-failure.test.mjs`), so there is one
	 * copy of the message on screen rather than two.
	 */
	const held = await driveComposer({
		onSubmit: ({ onEchoPainted }) => {
			onEchoPainted?.();
			returnInFlight();
			return false;
		},
	});
	assert.equal(
		held.after,
		input.text,
		"the text belongs back in the box: nothing else holds a copy of it any more",
	);
	assert.equal(
		held.storedDraft,
		input.text,
		"and it is written to the persisted draft, so a later mount shows the same message rather than an empty box",
	);
	assert.equal(
		held.inFlightGone,
		true,
		"an unknown outcome is not a reason to keep a durable record of a message the composer already holds",
	);
});

test("U3: a panel mounted over a buffered echo paints it in its first state", async () => {
	reset();
	echoPendingUser(SESSION_ID, "req-seed", "seeded message", []);
	/*
	 * What React reads for the panel's initial state. The remount on the New-chat
	 * path is the only moment this is needed and the only one it can be checked
	 * without a renderer: the drain below arrives one passive effect later, so a
	 * transcript seeded only by the drain had a first frame with nothing in it.
	 */
	const seeded = seedPendingEchoes(SESSION_ID, EMPTY_TRANSCRIPT);
	assert.deepEqual(
		seeded.records.map((record) => record.text),
		["seeded message"],
	);
	// The drain replays the same mutation over that state; it must land on the
	// SAME transcript rather than painting the message a second time.
	assert.equal(seedPendingEchoes(SESSION_ID, seeded).records.length, 1);
	const transcript = await mountTranscript(SESSION_ID);
	assert.deepEqual(transcript.rows(), ["seeded message"]);
	transcript.unregister();
});

test("a send threads its paint callback through `admitChatDraft`", async () => {
	reset();
	// The glue between the composer and the seam, and the only part of U1 that is
	// neither the seam's nor the composer's: `send` hands the callback to
	// `admitChatDraft`, which hands it to `echoPendingUser`. Verified with a
	// transcript already mounted, i.e. the path where the echo is applied
	// synchronously and so the caller can clear in the same commit.
	const transcript = await mountTranscript(SESSION_ID);
	globalThis.__echoRequest = async () => ({ status: "admitted" });
	let painted = 0;
	await admitChatDraft(`send:${SESSION_ID}`, input, SESSION_ID, () => {
		painted += 1;
	});
	assert.deepEqual(transcript.rows(), [input.text]);
	assert.equal(painted, 1, "the composer is told exactly once, at the paint");
	transcript.unregister();

	// And the predicate that decides whether a failed send's text belongs back in
	// the box (false) or stays out of it (true, `SEND_HELD` at the call site).
	// One definition, read by the retraction, the un-latch and the composer.
	assert.equal(
		isRefusedBeforeAdmission(new DesktopControlError(413, "too large")),
		true,
	);
	assert.equal(
		isRefusedBeforeAdmission(new DesktopControlError(422, "invalid")),
		true,
	);
	assert.equal(
		isRefusedBeforeAdmission(new DesktopControlError(503, "unknown")),
		false,
		"503 is the ambiguous failure whose echo is deliberately kept",
	);
	assert.equal(isRefusedBeforeAdmission(new Error("fetch failed")), false);
});

test("the echo's paint callback fires with the paint, on both delivery paths", async () => {
	reset();
	let drained = 0;
	echoPendingUser(SESSION_ID, "req-queued", "queued", [], () => {
		drained += 1;
	});
	assert.equal(
		drained,
		0,
		"nothing is mounted yet, so nothing has been painted - and the composer must not be told otherwise",
	);
	const transcript = await mountTranscript(SESSION_ID);
	assert.deepEqual(transcript.rows(), ["queued"]);
	assert.equal(
		drained,
		1,
		"the composer is told at the moment a transcript receives the echo, from the drain",
	);

	let direct = 0;
	echoPendingUser(SESSION_ID, "req-direct", "immediate", [], () => {
		direct += 1;
	});
	assert.equal(
		direct,
		1,
		"and synchronously when a transcript is already mounted, so both updates share a commit",
	);
	transcript.unregister();
});

/* =========================================== one payload, one moment (R1-R3) */

/*
 * The composer stages THREE registers of ONE payload: the words in the box, the
 * staged replies `buildSendPayload` turns into the payload's `<reply-to>`
 * prefix, and the chips whose paths the send encodes. The chip row and the
 * replies used to leave on a LATER clock than the text - when the send's promise
 * settled, while the text left at the echo - so for the whole in-flight window
 * the transcript showed the user's message with its attachment while the
 * composer still showed the chip for that file. One file apparently sent twice,
 * on a send that appears to have half-happened. These cases pin BOTH the trigger
 * and what a refusal owes back, in the fixture that runs the shipped hook over
 * the shipped store rather than a recorder standing in for it.
 *
 * WHAT THEY CAN AND CANNOT CLAIM: this harness models the hook's cells, not
 * React's scheduler (see the section note above the composer harness), so each
 * case states what the row HOLDS at the moment of the paint callback - which is
 * exactly the claim, because both writes happen inside that one call. Nothing
 * here says what a frame looked like.
 */

/** The row as the composer reads it: chip paths and quote texts, in order. */
function composerRow(conversationId = COMPOSER_ID) {
	const row =
		useConversationInputStore.getState().inputByConversation[conversationId];
	return {
		chips: (row?.attachments ?? []).map((chip) => chip.path),
		replies: (row?.replies ?? []).map((reply) => reply.text),
	};
}

/** The row a press leaves behind: one file, one staged quote. */
const STAGED = { chip: "/tmp/a.png", reply: "quoted turn" };

/*
 * What a failed send does to the composer, called from a case the way the store
 * calls it: `returnInFlight` is the ONE path a failure takes back
 * (`returnPayloadToComposer` is this call with the store's identity in front of
 * it), so a case that drives the hook with a custom `onSubmit` reproduces the
 * real route rather than a stand-in for it.
 */
function returnInFlight(conversationId = COMPOSER_ID) {
	useConversationInputStore
		.getState()
		.returnInFlight(conversationId, conversationId);
}

function stagePayload(conversationId = COMPOSER_ID) {
	const inputStore = useConversationInputStore.getState();
	inputStore.clearReplies(conversationId);
	inputStore.clearAttachments(conversationId);
	inputStore.addAttachment(conversationId, { id: "chip-a", path: STAGED.chip });
	inputStore.addReply(conversationId, { id: "reply-1", text: STAGED.reply });
}

test("R1: the chip row and the staged replies leave with the text, at the paint", async () => {
	const seen = {};
	await driveComposer({
		prime: () => stagePayload(),
		onSubmit: ({ onEchoPainted, box }) => {
			seen.atPress = { box: box(), ...composerRow() };
			onEchoPainted?.();
			seen.atPaint = { box: box(), ...composerRow() };
			return true;
		},
	});
	assert.deepEqual(
		seen.atPress,
		{
			box: input.text,
			chips: [STAGED.chip],
			replies: [STAGED.reply],
		},
		"all three registers must still be in the composer while the send is in flight",
	);
	assert.deepEqual(
		seen.atPaint,
		{ box: "", chips: [], replies: [] },
		"the chip row and the staged replies must leave in the SAME call as the text, or the transcript shows the file while the composer still shows its chip",
	);
});

test("R1: a clear at the paint cannot change what the request carries", async () => {
	/*
	 * The other half of the same decision, and the reason it is safe: the row the
	 * composer reads is cleared at the echo, so anything that read the ROW after
	 * that moment would see nothing. The request is built from the arguments the
	 * press handed over - `buildSendPayload` for the words and the reply prefix,
	 * `encodeImageAttachments` for the file paths - and this drives the real
	 * `admitChatDraft` with a mounted transcript and a paint callback that clears
	 * the row for real, then reads what reached the wire.
	 */
	reset();
	const order = [];
	const sent = [];
	globalThis.__echoRequest = async (request) => {
		order.push(request.op);
		sent.push(request);
		return { status: "admitted" };
	};
	const transcript = await mountTranscript(SESSION_ID);
	stagePayload();
	const images = [{ data_b64: "QUJD", mime_type: "image/png" }];
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await admitChatDraft(
		key,
		{ ...input, attachments: [STAGED.chip], images },
		SESSION_ID,
		() => {
			order.push("cleared");
			/*
			 * The composer's clear at the paint, through the store that owns the row:
			 * one update takes the text, the chips and the quotes, and it is the same
			 * update that leaves the durable record of an unconfirmed send complete
			 * (`inFlight`) rather than text-without-its-files.
			 */
			useConversationInputStore
				.getState()
				.beginInFlight(COMPOSER_ID, stagedPayloadOf(COMPOSER_ID), true);
		},
	);
	const message = sent.find((request) => request.op === "sessions.message");
	assert.equal(
		order.indexOf("cleared") < order.indexOf("sessions.message"),
		true,
		"the clear must land BEFORE the message request, or this case proves nothing about a payload read after it",
	);
	assert.deepEqual(
		message.images,
		images,
		"the encoded images must come from the paths the press passed, not from a row a clear can empty",
	);
	assert.equal(
		message.text,
		input.text,
		"and the words must be the press's, for the same reason",
	);
	assert.deepEqual(
		composerRow().chips,
		[],
		"the composer's row IS empty by the time the request is issued, which is what makes the two assertions above a proof rather than a coincidence",
	);
	/*
	 * And the shape the operator reported, at the one moment both surfaces are
	 * readable: the transcript holds the message while the composer's row is
	 * empty. Both halves of the payload moved together, so there is no window in
	 * which the message is on screen and its chip is still in the composer.
	 */
	assert.deepEqual(
		transcript.rows(),
		[input.text],
		"the message is painted in the transcript at the moment its chip row is already empty",
	);
	transcript.unregister();
});

test("R2: a refusal puts BOTH halves back, whichever way it arrived", async () => {
	// The refusal that lands after the echo: the row was taken on the way out and
	// must come back WITH the text, or the obvious next Enter sends the wording
	// without the file.
	const afterEcho = await driveComposer({
		prime: () => stagePayload(),
		onSubmit: ({ onEchoPainted }) => {
			onEchoPainted?.();
			// The store's return, which is what a refusal does after the echo - the
			// hook no longer restores the box itself.
			returnInFlight();
			return false;
		},
	});
	assert.equal(
		afterEcho.after,
		input.text,
		"the refused text belongs back in the box",
	);
	assert.deepEqual(
		afterEcho.chips(),
		[STAGED.chip],
		"a refusal that arrives after the echo must bring the file back with the text",
	);
	assert.deepEqual(
		afterEcho.replies(),
		[STAGED.reply],
		"and the staged quote, which the payload's own prefix is built from",
	);

	// The refusal that never echoed (the send lock, the budget, an unreadable
	// file): nothing left, so nothing may be written and the row is untouched.
	const neverLeft = await driveComposer({
		prime: () => stagePayload(),
		onSubmit: () => false,
	});
	assert.equal(
		neverLeft.after,
		input.text,
		"an untouched box keeps the message",
	);
	assert.deepEqual(
		neverLeft.chips(),
		[STAGED.chip],
		"and the chips that never left the row",
	);
	assert.deepEqual(
		neverLeft.replies(),
		[STAGED.reply],
		"and the staged replies",
	);
});

test("R2: a chip the user attaches while waiting joins the returned one, and is never overwritten", async () => {
	const typed = await driveComposer({
		prime: () => stagePayload(),
		onSubmit: ({ onEchoPainted }) => {
			onEchoPainted?.();
			useConversationInputStore
				.getState()
				.addAttachment(COMPOSER_ID, { id: "chip-new", path: "/tmp/new.png" });
			returnInFlight();
			return false;
		},
	});
	/*
	 * BOTH, and that is the change: the old rule restored into an EMPTY row only,
	 * which protected the user's own attach by WITHHOLDING the returned file - a
	 * silent partial payload, the class of defect this whole change exists to
	 * remove. A union by path loses nothing, puts the returned file first (it was
	 * sent first) and leaves the user's attach untouched.
	 */
	assert.deepEqual(
		typed.chips(),
		[STAGED.chip, "/tmp/new.png"],
		"the returned file and the one attached during the flight are both in the row",
	);
	assert.deepEqual(
		typed.replies(),
		[STAGED.reply],
		"and the replies follow the same union rule on their own row",
	);
});

test("R3: an unknown outcome returns BOTH halves, and the retry is the Send that follows", async () => {
	/*
	 * THE ASYMMETRY THIS CASE USED TO PIN IS GONE, deliberately. Text and files
	 * were restored by opposite routes - the text was withheld (its copy was
	 * painted in the transcript) while the chip came back, because the
	 * unchanged-payload guard compared both and a claim missing its file would
	 * refuse the very retry the Restore link offered.
	 *
	 * With the guard removed there is no asymmetry to get wrong: an unchanged
	 * resend replays the same request id, an edited one is a new message, and both
	 * halves of the payload return together through one store write. What this case
	 * pins now is that they come back TOGETHER, and that nothing is left behind in
	 * the durable record for a restart to hand back a second time.
	 */
	const held = await driveComposer({
		prime: () => stagePayload(),
		onSubmit: ({ onEchoPainted, box }) => {
			onEchoPainted?.();
			assert.equal(
				box(),
				"",
				"the box empties at the echo, which is the window this arm is about",
			);
			returnInFlight();
			return false;
		},
	});
	assert.equal(
		held.after,
		input.text,
		"the text comes back with the files, so one press of Send carries the whole message again",
	);
	assert.deepEqual(
		held.chips(),
		[STAGED.chip],
		"and the chip the send was carrying",
	);
	assert.deepEqual(held.replies(), [STAGED.reply], "and the staged quote");
	assert.equal(
		held.inFlightGone,
		true,
		"with nothing left for a restart to restore",
	);
});

test("R1: a send that never echoes still takes both halves once it settles", async () => {
	const settled = await driveComposer({
		prime: () => stagePayload(),
		onSubmit: () => true,
	});
	assert.equal(
		settled.after,
		"",
		"the box retires on the post-settle fallback",
	);
	assert.deepEqual(
		settled.chips(),
		[],
		"and the chip row goes with it, in the same fallback - a slash command leaves no other trace that the file was spent",
	);
	assert.deepEqual(settled.replies(), [], "and the staged replies");
});

test("the staged-payload rules are the store route's two transitions", async () => {
	/*
	 * One function per transition, both on the store that owns the row: the echo
	 * takes text, chips and quotes in ONE update (`beginInFlight`, which is what
	 * makes the durable record of an unconfirmed message complete rather than
	 * text-without-its-files), and a failure puts the payload back through the
	 * other one (`returnInFlight`). The union rules live in `mergeReturnedPayload`
	 * and are asserted directly, so a second copy of them cannot appear beside the
	 * call site.
	 */
	assert.deepEqual(
		mergeReturnedPayload(
			{ text: "", attachments: [], replies: [] },
			{
				text: "",
				attachments: [STAGED.chip],
				replies: [{ id: "r1", text: "q" }],
			},
		),
		{
			text: "",
			attachments: [STAGED.chip],
			replies: [{ id: "r1", text: "q" }],
		},
	);
	const union = mergeReturnedPayload(
		{
			text: "typed during the flight",
			attachments: ["/tmp/mine.png"],
			replies: [{ id: "r2", text: "mine" }],
		},
		{
			text: "the message that failed",
			attachments: [STAGED.chip],
			replies: [{ id: "r1", text: "q" }],
		},
	);
	assert.equal(
		union.text,
		"the message that failed\n\ntyped during the flight",
		"the returned message goes first and the user's own text is kept",
	);
	assert.deepEqual(
		union.attachments,
		[STAGED.chip, "/tmp/mine.png"],
		"and both file lists survive, returned first",
	);
	assert.deepEqual(
		union.replies.map((reply) => reply.id),
		["r1", "r2"],
	);

	// The two transitions, over the real store and the real row.
	const inputStore = useConversationInputStore.getState();
	useConversationInputStore.setState({ inputByConversation: {} });
	stagePayload();
	assert.deepEqual(
		stagedPayloadOf(COMPOSER_ID),
		{
			attachments: [{ id: "chip-a", path: STAGED.chip }],
			replies: [{ id: "reply-1", text: STAGED.reply }],
		},
		"the press's snapshot must be the row itself, so a failure hands back exactly what the send carried",
	);
	assert.deepEqual(composerRow().chips, [STAGED.chip]);
	useConversationInputStore.getState().beginInFlight(
		COMPOSER_ID,
		{
			text: input.text,
			attachments: stagedPayloadOf(COMPOSER_ID).attachments,
			replies: stagedPayloadOf(COMPOSER_ID).replies,
		},
		true,
	);
	assert.deepEqual(composerRow(), { chips: [], replies: [] });
	returnInFlight();
	assert.deepEqual(composerRow(), {
		chips: [STAGED.chip],
		replies: [STAGED.reply],
	});
	assert.equal(
		useConversationInputStore.getState().inputByConversation[COMPOSER_ID]
			?.roundTrip,
		undefined,
	);
	assert.equal(typeof inputStore.clearAttachments, "function");
});

/* ============ the composer's sentence: the window, and what it may not claim */

/*
 * AGENT REVIEW ROUND 1, MAJOR-1, AND QA ROUND 1's Q-1 - the same defect from two
 * directions, and the reason this rule is a function rather than a chain inline
 * in the band's JSX.
 *
 * `Sending your message` was written to say "this send is still going out" and
 * placed BELOW `awaitingReply`, on the argument that `awaitingReply` is "set only
 * once admission answered". That argument is wrong about the timing: the store
 * writes `admissionAttempted: true` BEFORE the echo and before the wire
 * (`canonical-sessions-store.ts`, "THE SEAM"), and the pane's rung is up from
 * there until the owner paints - so on a real send BOTH terms are true in the
 * window the sentence exists for, and the chain answered with
 * `Waiting for the agent`. QA executed both revisions with the props the app
 * actually passes (`awaitingReply={true}`) and read exactly that, which is also
 * why the story that showed the sentence was a state the live app cannot be in.
 *
 * The order is now the rule: while a send this pane issued has not settled, the
 * box says the message is on its way out; once it has settled and the agent is
 * answering, that sentence takes over. The earlier terms keep their windows.
 *
 * WHAT THIS CANNOT PIN, stated so the test is not read as wider than it is: that
 * the term is fed by the PANE (`chat-page`'s `admitting`, which survives the
 * New-chat identity flip) is a wiring fact, and it is pinned on the wiring in
 * `canonical-chat.test.mjs`. Here the rule is asked with the app's own prop
 * values, including the one QA proved impossible before this round.
 */
test("MAJOR-1/Q-1: an unsettled send outranks `awaitingReply`, and the order is the rule", () => {
	const earlier = {
		unavailable: false,
		inputDisabled: false,
		awaitingAnswer: false,
	};
	/*
	 * The window the sentence was written for: the echo has landed (so the box is
	 * empty), the request is out, the owner has painted nothing.
	 */
	assert.equal(
		composerPlaceholder({
			...earlier,
			sendingUnsettled: true,
			awaitingReply: true,
		}),
		COMPOSER_PLACEHOLDER.sending,
		"a send that has not settled must be able to say so with `awaitingReply` true - that is the app's own value on the canonical path, and reading it as `Waiting for the agent` is the defect QA executed",
	);
	/* And the moment after it settles, with the agent still answering. */
	assert.equal(
		composerPlaceholder({
			...earlier,
			sendingUnsettled: false,
			awaitingReply: true,
		}),
		COMPOSER_PLACEHOLDER.waiting,
		"once the send has settled the agent's sentence takes over, which is the half the operator asked for as the pair to this one",
	);
	assert.equal(
		composerPlaceholder({
			...earlier,
			sendingUnsettled: false,
			awaitingReply: false,
		}),
		COMPOSER_PLACEHOLDER.idle,
		"and with no send in flight and nothing being answered the box invites a message again",
	);
	/* The three earlier terms keep the windows they had. */
	assert.equal(
		composerPlaceholder({
			...earlier,
			unavailable: true,
			sendingUnsettled: true,
			awaitingReply: true,
		}),
		COMPOSER_PLACEHOLDER.unavailable,
		"a conversation this machine does not have stays the first reading (design round 2, D3)",
	);
	assert.equal(
		composerPlaceholder({
			...earlier,
			inputDisabled: true,
			sendingUnsettled: true,
			awaitingReply: true,
		}),
		COMPOSER_PLACEHOLDER.busy,
		"a refused box keeps its own sentence",
	);
	assert.equal(
		composerPlaceholder({
			...earlier,
			awaitingAnswer: true,
			sendingUnsettled: true,
			awaitingReply: true,
		}),
		COMPOSER_PLACEHOLDER.answer,
		"and a pending question is what the box is for, whatever is in flight",
	);
});

/* ============ the clear's blast radius: what it takes, and what it must not */

/*
 * AGENT REVIEW ROUND 1, MINOR-1; QA Q-2; UX U2 - one defect, three reporters.
 *
 * `clearOnce` cleared the WHOLE row (`clearReplies` + `clearAttachments`) while
 * the text half of the same call was equality-guarded, so a file attached during
 * the press->echo window was wiped silently. QA measured it: press with a file
 * staged, attach a second one 250ms later against a 700ms echo, and the head read
 * `2chip -> 0chip` where the base kept both. UX's phrasing is the one to keep:
 * "my words stayed, my file vanished".
 *
 * The rule now: the clear removes the ENTRIES the press captured, by identity
 * (`removeAttachment`/`removeReply`), so its blast radius is exactly the payload
 * it belongs to. Both arms are covered here, because MINOR-1 reaches the clear
 * through the OTHER trigger (a send that never echoes settles and takes the
 * post-await `clearOnce`), and that arm is the one where the box is typeable and
 * live the whole time.
 */
const SECOND = { chip: "/tmp/second.png", reply: "a quote staged later" };

test("MINOR-1/Q-2/U2: a file attached while the send is going out survives the echo", async () => {
	let rowAtPaint = null;
	await driveComposer({
		prime: () => stagePayload(),
		onSubmit: ({ onEchoPainted }) => {
			// The user attaches a second file while the send is in flight, i.e.
			// inside the window this change makes the clear land in.
			useConversationInputStore
				.getState()
				.addAttachment(COMPOSER_ID, { id: "chip-late", path: SECOND.chip });
			onEchoPainted?.();
			rowAtPaint = composerRow();
			return true;
		},
	});
	assert.deepEqual(
		rowAtPaint.chips,
		[SECOND.chip],
		"the chip the user attached during the flight is their NEXT payload: the echo must take the file this send carried and leave the one it did not",
	);
	assert.deepEqual(
		rowAtPaint.replies,
		[],
		"while the quote this submit DID carry still leaves with it - the rule is per entry, not per row",
	);
});

test("MINOR-1: a quote staged while the send is going out survives it too", async () => {
	let rowAtPaint = null;
	await driveComposer({
		prime: () => stagePayload(),
		onSubmit: ({ onEchoPainted }) => {
			useConversationInputStore
				.getState()
				.addReply(COMPOSER_ID, { id: "reply-late", text: SECOND.reply });
			onEchoPainted?.();
			rowAtPaint = composerRow();
			return true;
		},
	});
	assert.deepEqual(
		rowAtPaint.replies,
		[SECOND.reply],
		"a quote staged during the flight is not this send's and must not be taken by its clear",
	);
	assert.deepEqual(
		rowAtPaint.chips,
		[],
		"and the file this send carried still leaves",
	);
});

test("MINOR-1: the fallback trigger obeys the same rule, on the arm where the box stays live", async () => {
	/*
	 * A send that never echoes - a slash command, a gate answer, the legacy model
	 * path - settles and takes the post-await `clearOnce()`. That is the arm
	 * MINOR-1 names, and it is the one where the user has the whole flight to keep
	 * typing and attaching.
	 */
	const settled = await driveComposer({
		prime: () => stagePayload(),
		onSubmit: ({ type }) => {
			type("next message");
			useConversationInputStore
				.getState()
				.addAttachment(COMPOSER_ID, { id: "chip-late", path: SECOND.chip });
			return true;
		},
	});
	assert.equal(
		settled.after,
		"next message",
		"the words typed during the flight are the user's (the text half's own rule, unchanged)",
	);
	assert.deepEqual(
		settled.chips(),
		[SECOND.chip],
		"and the file attached during it is theirs too: the settle may not take more than the payload it settled",
	);
});
