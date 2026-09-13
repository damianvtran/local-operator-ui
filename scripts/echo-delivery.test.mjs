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
			export { useMessageInput, SEND_HELD, clearSubmittedText, restoreSubmittedText } from "./src/renderer/src/shared/hooks/use-message-input";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
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
	SEND_HELD,
	clearSubmittedText,
	restoreSubmittedText,
	useConversationInputStore,
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

async function driveComposer({ onSubmit, initial = input.text }) {
	// The composer's persisted draft is module state and outlives a case.
	useConversationInputStore.setState({ inputByConversation: {} });
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

test("U2: a refused send restores the text only into an empty composer", async () => {
	const quiet = await driveComposer({
		onSubmit: ({ onEchoPainted }) => {
			onEchoPainted?.();
			return false;
		},
	});
	assert.equal(
		quiet.after,
		input.text,
		"a refusal with an untouched box must hand the message back",
	);

	const typed = await driveComposer({
		onSubmit: ({ onEchoPainted, type }) => {
			onEchoPainted?.();
			type("A second message");
			return false;
		},
	});
	assert.equal(
		typed.after,
		"A second message",
		"the refusal must not restore over text the user typed while waiting",
	);

	// The rule itself, shipped and pure, so a future edit to either transition
	// is read against the same rule rather than against the call site.
	assert.equal(clearSubmittedText(input.text, input.text), "");
	assert.equal(clearSubmittedText(`${input.text} and more`, input.text), `${input.text} and more`);
	assert.equal(restoreSubmittedText("", input.text), input.text);
	assert.equal(restoreSubmittedText("A second message", input.text), "A second message");
});

test("D1/U5: an unconfirmed send leaves its text to the claim, not to the box", async () => {
	const held = await driveComposer({
		onSubmit: ({ onEchoPainted }) => {
			onEchoPainted?.();
			return SEND_HELD;
		},
	});
	assert.equal(
		held.after,
		"",
		"putting the text back would show the one message twice while its echo stays painted",
	);
	assert.equal(
		held.storedDraft,
		"",
		"and the persisted draft is retired, or a later mount would adopt it back into the box",
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
	await admitChatDraft(
		`send:${SESSION_ID}`,
		input,
		SESSION_ID,
		() => {
			painted += 1;
		},
	);
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
