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
 * THE PENDING-SEND REGISTRY, and the claims about delivery it has to carry.
 *
 * The registry's one structural rule: a paint is delivered SYNCHRONOUSLY when a
 * transcript for the identity is mounted, RETAINED when none is, and drained by
 * whichever registers first - and it is then KEPT, because the three claims
 * below are about remounts (the identity flip, a switch away and back, a
 * reload) and a consumed entry cannot survive any of them. Resolution is what
 * drops an entry: a pane observing the owner's durable row, or the user
 * resolving a failure.
 *
 * The timing model is the point. On the draft path the session id does not
 * exist until `createSession` returns, and the store patches that id and
 * re-keys the entry in ONE synchronous block - before React has committed the
 * render that mounts the replacement panel, let alone flushed the passive
 * effect that registers its transcript. Registration is therefore modelled as a
 * passive effect on a macrotask (`setTimeout(0)`), which is strictly MORE
 * generous than React's actual commit timing: if the row survives here it
 * survives in the app. What changed with retention is what the NEXT mount sees:
 * the same row, seeded from the same entry, rather than nothing.
 */
const bundle = await build({
	stdin: {
		contents: `
			export { admitChatDraft, useCanonicalSessionsStore, draftIdentityFor, isRefusedBeforeAdmission } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { paintPendingSend, seedPendingSends, movePendingSendIdentity, replacePendingSendText, resolvePendingSend, resolveObservedPendingSends, hasPendingSend, settlePendingSend, pendingSendForView, discardPendingSends, retractPendingUser, __registerEchoTarget, streamChangeKeepsTranscript } from "./src/renderer/src/shared/hooks/use-canonical-session";
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
	paintPendingSend,
	seedPendingSends,
	movePendingSendIdentity,
	replacePendingSendText,
	resolvePendingSend,
	resolveObservedPendingSends,
	settlePendingSend,
	pendingSendForView,
	discardPendingSends,
	retractPendingUser,
	__registerEchoTarget,
	streamChangeKeepsTranscript,
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
	 * The registry is MODULE state, so it outlives a store reset. Clearing it
	 * here keeps each test independent: without this, the bound tests below
	 * leave retained entries behind and the next test's identity can be evicted
	 * before it ever runs, which makes results depend on file order.
	 */
	for (const id of [SESSION_ID, "999999999999", ...SCRATCH_SESSIONS])
		discardPendingSends(id);
	store.setState({
		sessions: [],
		activeSessionId: null,
		activeDraftKey: null,
		drafts: {},
		validatingSessionId: null,
		error: null,
	});
}

test("a New-chat send paints at the PRESS, before the create answers", async () => {
	reset();
	/*
	 * AC2, IN ONE READING: the row appears and the box empties in the same
	 * commit, before the session exists.
	 *
	 * The draft pane is mounted and registered under its OWN key - which is what
	 * `SessionPanel` does from the first keystroke (the hook's registration is
	 * keyed by the pane's identity, not by the stream id), so the paint at the
	 * press has somewhere to land synchronously. The create is HELD inside the
	 * request: while it is in flight the row must already be on the pane, and the
	 * composer must already have been told (`onEchoPainted` fires with the paint,
	 * in the same synchronous block) - the whole of the old dead-air window.
	 */
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const draftPane = await mountTranscript(key);
	let rowsWhileCreating = null;
	const paintedAt = [];
	let releaseCreate;
	const held = new Promise((resolve) => {
		releaseCreate = resolve;
	});
	globalThis.__echoRequest = async (request) => {
		if (request.op === "sessions.create") {
			// The create is in flight: read what the user would be looking at.
			rowsWhileCreating = draftPane.rows();
			await held;
			return { session_id: SESSION_ID, binding: null };
		}
		return { status: "admitted" };
	};
	const admission = admitChatDraft(key, input, undefined, () => {
		paintedAt.push("painted");
	});
	// `admitChatDraft` runs synchronously up to its first await - the create -
	// and the request fixture above ran before yielding, so both readings are
	// settled here without a tick of slack.
	assert.deepEqual(
		rowsWhileCreating,
		["Review this"],
		"the row is on the DRAFT pane while the create is still in flight",
	);
	assert.deepEqual(
		paintedAt,
		["painted"],
		"the composer is told at the press, so its text leaves with the paint",
	);
	releaseCreate();
	assert.equal(await admission, SESSION_ID);

	// THE FLIP: the row must survive the remount. The replacement panel's first
	// frame comes from the seed - the drain arrives one passive effect later -
	// and the entry was re-keyed to the session instead of being consumed.
	const flip = seedPendingSends(SESSION_ID, EMPTY_TRANSCRIPT);
	assert.deepEqual(
		flip.records.map((record) => record.text),
		["Review this"],
		"the flip's first frame already holds the row it was showing",
	);
	assert.ok(
		pendingSendForView(SESSION_ID) !== null,
		"and the claim is still open until the owner's row is observed",
	);
	const sessionPane = await mountTranscript(SESSION_ID);
	assert.deepEqual(
		sessionPane.rows(),
		["Review this"],
		"never zero, never two",
	);
	draftPane.unregister();
	sessionPane.unregister();
});

test("a New-chat send paints into the transcript that mounts after the session exists", async () => {
	reset();
	/*
	 * THE HEADLINE CASE: New chat, type, Enter. No panel is mounted for the
	 * session when the session is created, because it did not exist a moment
	 * ago - the press's paint was retained under the draft key and is re-keyed to
	 * the session in the store's own synchronous block. Pre-fix this was
	 * measured at 0 painted; the composer had already cleared, so the user saw an
	 * empty box and an empty transcript for the whole ~1.15s engage.
	 */
	let mounted = null;
	let entryAtPress = null;
	let rowAtPress = null;
	globalThis.__echoRequest = async (request) => {
		if (request.op === "sessions.create") {
			/*
			 * R3-4: read BOTH carriers at the press, while the create is in
			 * flight - the row is the fallback and the entry is what survives
			 * the receipt's row deletion, so the anchor must be on each. A paint
			 * that dropped `submittedAt` would blank the clock again after a
			 * remount while every other suite stayed green: this is the write's
			 * own pin, taken where `admitChatDraft` makes it.
			 */
			entryAtPress = pendingSendForView(key)?.submittedAt ?? null;
			rowAtPress = store.getState().drafts[key]?.submittedAt ?? null;
			// The panel for this session begins mounting as a consequence of the
			// store patching the id.
			mounted = mountTranscript(SESSION_ID);
			return { session_id: SESSION_ID, binding: null };
		}
		return { status: "admitted" };
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const requestId = store.getState().drafts[key].admissionRequestId;
	await admitChatDraft(key, input);
	assert.equal(
		typeof entryAtPress,
		"number",
		"the press writes its clock anchor onto the painted entry (R3-4)",
	);
	assert.equal(
		rowAtPress,
		entryAtPress,
		"the row and the entry carry the same press",
	);
	assert.equal(
		pendingSendForView(SESSION_ID)?.submittedAt,
		entryAtPress,
		"and the identity re-key carries the same anchor to the id the remount reads",
	);

	const transcript = await mounted;
	assert.deepEqual(
		transcript.rows(),
		["Review this"],
		"the user's message must be painted once the transcript mounts - a dropped row leaves a cleared composer over an empty transcript, which is worse than the lag it replaced",
	);
	transcript.unregister();
	// And it is keyed by the admission request id, so the owner's durable row
	// coalesces with it rather than painting the message a second time.
	assert.ok(requestId);
});

test("an existing-session send still paints immediately, with nothing retained", async () => {
	reset();
	// The path that already worked. It must keep working through the registry: a
	// target registered BEFORE the paint receives it synchronously, never
	// deferred, because deferring would make a warm send flicker.
	const transcript = await mountTranscript(SESSION_ID);
	globalThis.__echoRequest = async () => ({ status: "admitted" });
	const key = `send:${SESSION_ID}`;
	await admitChatDraft(key, input, SESSION_ID);
	assert.deepEqual(transcript.rows(), ["Review this"]);
	transcript.unregister();
});

test("a refusal the daemon states keeps the message on its row (S4: no return)", async () => {
	reset();
	/*
	 * THE BOUNDARY RULE, ON THE CLASS THAT MOST NEEDED IT. A 413 is a refusal the
	 * daemon STATES - the message was not admitted - and the old contract handed
	 * the whole payload back to the composer: one message in two homes, and the
	 * box's copy was the one that could be sent twice. S4 keeps it where the user
	 * can see it, on the row, with the class's sentence and remedies (the README
	 * for `docs/evidence/conversation-start/` carries the frame).
	 *
	 * So the half this case used to assert the OPPOSITE of is the row's survival:
	 * a retraction here would empty the transcript of a message the user still has
	 * to act on. The refusal is the row's statement to make, and the payload basis
	 * (`submittedText`) stays with it for `Send again`/`Edit`.
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
		["Review this"],
		"the message stays on its row: the refusal is the row's statement to make, and the payload basis rides with it",
	);
	transcript.unregister();
	/*
	 * AND NOTHING CAME HOME. The store no longer owns a path that could write the
	 * payload into a composer row (`returnPayloadToComposer` is gone with it), so
	 * no spelling of "where the text could be" holds it: not the box's own input,
	 * not the handed-back text.
	 */
	const composerRow =
		useConversationInputStore.getState().inputByConversation[SESSION_ID];
	assert.equal(
		composerRow?.pendingText ?? "",
		"",
		"no returned text for this failure - there is no return path any more",
	);
	assert.equal(
		composerRow?.currentInput ?? "",
		"",
		"and nothing typed into the box either",
	);
	const draft = store.getState().drafts[key];
	assert.equal(
		draft.submittedText,
		"Review this",
		"while the payload basis stays on the draft, where Send again and Edit read it",
	);
});

test("INV-C1: an ambiguous failure keeps its own echo, and the owner's row takes its place", async () => {
	reset();
	/*
	 * WHAT CHANGED, AND WHAT INV-C1 BECOMES (§F3's restore, agent review round 4's
	 * R17; S4). The rule this case pins is the RESTORED one: an unconfirmed send
	 * keeps the message on screen - the row wears the class's sentence and its
	 * remedies until the server's own answer resolves the claim. Since S4 the row
	 * is the message's ONLY home: the failure no longer hands the payload back to
	 * the composer, because one message in two homes is one message too many, and
	 * the box's copy was the one that could be sent twice (see the 413 case
	 * above).
	 *
	 * The second half is the coalescing the old case was protecting, and it is
	 * pinned here rather than assumed: the row is keyed by the admission request
	 * id - the id the owner gives the durable row - so the owner's own
	 * `message_start` for the same id REPLACES the echo in place rather than
	 * painting the message a second time.
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
		[input.text],
		"an unconfirmed send keeps its row: the message wears its own fate on screen while the composer holds the payload",
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
		"the owner's row arrives under the request id and takes the echo's place: one row, not two",
	);
	transcript.unregister();
});

test("a retained row is seeded to every later mount, and resolution is what ends it", async () => {
	reset();
	/*
	 * RETENTION, THE FLIP SIDE OF THE OLD TAKE-AND-DELETE RULE.
	 *
	 * The buffer this replaced consumed its entry at the first drain, which was
	 * right while the composer held the text: a remount - the identity flip, a
	 * switch away and back, a reload - would have re-painted a message the user
	 * had already watched leave. It is not right any more. The box empties at
	 * the PRESS, so a consumed entry would leave the message represented only by
	 * one pane's local state, and the next mount would show a conversation that
	 * never received it. The entry is therefore kept until it is RESOLVED, and
	 * the resolution signal is the owner's own row arriving in the pane: a
	 * NON-local user record under the same id (what `appendPendingUser`'s
	 * `local` flag distinguishes).
	 */
	paintPendingSend(SESSION_ID, {
		id: "req-retained",
		text: "retained once",
		images: [],
	});
	const first = await mountTranscript(SESSION_ID);
	assert.deepEqual(first.rows(), ["retained once"]);
	first.unregister();

	const second = await mountTranscript(SESSION_ID);
	assert.deepEqual(
		second.rows(),
		["retained once"],
		"a remount seeds the same row - the switch-away/back and reload cases depend on it",
	);

	// The owner's durable row for the id is the resolution.
	const resumed = applyEvent(
		second.state(),
		{
			type: "message_start",
			message: {
				id: "req-retained",
				role: "user",
				content: [{ type: "text", text: "retained once" }],
				tool_calls: [],
			},
		},
		1_760_000_000_000,
	);
	resolveObservedPendingSends(SESSION_ID, resumed);
	assert.equal(
		pendingSendForView(SESSION_ID),
		null,
		"the owner's row ends the claim",
	);
	second.unregister();

	const third = await mountTranscript(SESSION_ID);
	assert.deepEqual(
		third.rows(),
		[],
		"after resolution nothing is re-painted: the durable row is history's to deliver",
	);
	third.unregister();
});

test("a retained row for a session nobody ever mounts does not leak into another", async () => {
	reset();
	// Addressing is per identity: the registry is a delivery mechanism, not a
	// broadcast. A retained row for an abandoned draft must never appear in the
	// next conversation the user opens.
	paintPendingSend("999999999999", {
		id: "req-orphan",
		text: "orphaned",
		images: [],
	});
	const transcript = await mountTranscript(SESSION_ID);
	assert.deepEqual(transcript.rows(), []);
	transcript.unregister();
	retractPendingUser("999999999999", "req-orphan");
});

test("the registry bounds what it retains per identity", async () => {
	reset();
	/*
	 * A RETENTION bound, not tidiness: each entry holds the message text and its
	 * images as base64, and retention means that content outlives delivery, so
	 * an unbounded map keeps a user's content in renderer memory for the
	 * window's lifetime when a panel never mounts. Oldest-first, because the
	 * newest paint is the one the user is waiting to see.
	 */
	for (let i = 0; i < 10; i++)
		paintPendingSend(SESSION_ID, {
			id: `req-${i}`,
			text: `message ${i}`,
			images: [],
		});
	const transcript = await mountTranscript(SESSION_ID);
	const rows = transcript.rows();
	assert.ok(
		rows.length <= 4,
		`the per-identity bound must hold, got ${rows.length} rows`,
	);
	assert.deepEqual(
		rows,
		["message 6", "message 7", "message 8", "message 9"],
		"the newest rows survive - the oldest are the ones the user has stopped waiting for",
	);
	transcript.unregister();
});

test("the registry bounds how many identities it holds", async () => {
	reset();
	// The other unbounded dimension: a user can stage drafts faster than panels
	// mount. Eviction is by insertion order, so the oldest identity - the one
	// least likely to ever be looked at - goes first.
	for (let i = 0; i < 40; i++)
		paintPendingSend(`session-${i}`, {
			id: `req-${i}`,
			text: `text ${i}`,
			images: [],
		});
	// The first identity painted must have been evicted by now.
	const evicted = await mountTranscript("session-0");
	assert.deepEqual(
		evicted.rows(),
		[],
		"the oldest identity must not still be retained after 40 others",
	);
	evicted.unregister();
	// The most recent one is still there, which is what keeps the bound useful
	// rather than merely safe.
	const kept = await mountTranscript("session-39");
	assert.deepEqual(kept.rows(), ["text 39"]);
	kept.unregister();
});

test("abandoning a draft drops whatever was retained for it", async () => {
	reset();
	/*
	 * The user's deletion honoured in memory, not just in the store. A discarded
	 * draft is precisely the case where a panel may never mount, so without this
	 * the abandoned text and its attachments would outlive the row the user
	 * thinks they threw away.
	 *
	 * The DRAFT path, BOTH HOMES: the entry lives under the draft key while the
	 * create is in flight and under the session id after the re-key
	 * (`movePendingSendIdentity`), and a discard can land on either side of that
	 * hop - so both are painted here and both must go.
	 */
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	store.setState((state) => ({
		drafts: {
			...state.drafts,
			[key]: { ...state.drafts[key], sessionId: SESSION_ID },
		},
	}));
	paintPendingSend(key, {
		id: "req-abandoned-draft",
		text: "abandoned draft text",
		images: [],
	});
	paintPendingSend(SESSION_ID, {
		id: "req-abandoned",
		text: "abandoned text",
		images: [],
	});
	store.getState().discardDraft(key);

	const draftPane = await mountTranscript(key);
	assert.deepEqual(draftPane.rows(), [], "the pre-create home is dropped too");
	draftPane.unregister();
	const transcript = await mountTranscript(SESSION_ID);
	assert.deepEqual(
		transcript.rows(),
		[],
		"an abandoned draft's row must not be retained until some later mount",
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
	paintPendingSend(SESSION_ID, {
		id: "req-send-abandoned",
		text: "abandoned send",
		images: [],
	});
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
	paintPendingSend(SESSION_ID, {
		id: "req-keep",
		text: "keep me",
		images: [],
	});
	discardPendingSends("999999999999");
	const transcript = await mountTranscript(SESSION_ID);
	assert.deepEqual(transcript.rows(), ["keep me"]);
	transcript.unregister();
});

test("the mint's bridge id landing on a draft pane keeps the transcript the press painted", () => {
	reset();
	/*
	 * UX ROUND 1, U1, as the RULE that carries it: a draft pane's stream id moves
	 * `undefined` -> the id `sessions.draft` minted when the mint answers, and
	 * that swap used to read as "a different session" by
	 * `useCanonicalSessionStream`'s reset effect - which replaced the transcript
	 * with the new id's cache (a draft bridge has none) and took the press's row
	 * with it. Measured on the installed 0.63.2 daemon (`session_draft_warm`
	 * advertised) as the press reading `rows:0` with the row returning only at the
	 * flip: Enter beats the mint's answer by ~50-300 ms, which is the ordinary
	 * type-then-Enter cadence.
	 *
	 * The rule is exercised here rather than through a renderer because it is a
	 * pure function of the two ids and the bridge flag
	 * (`streamChangeKeepsTranscript`); the driver scene holds the end-to-end half
	 * on a warm-capable daemon.
	 */
	assert.equal(
		streamChangeKeepsTranscript(undefined, "7f5d0a3e-warm", false),
		true,
		"the mint's answer is not a session change: the row must survive it",
	);
	assert.equal(
		streamChangeKeepsTranscript("7f5d0a3e-warm", "7f5d0a3e-warm", false),
		true,
		"an unchanged id keeps the transcript trivially",
	);
	assert.equal(
		streamChangeKeepsTranscript(undefined, SESSION_ID, true),
		false,
		"a REAL session id still replaces the transcript - the rule's other arm",
	);
	assert.equal(
		streamChangeKeepsTranscript("7f5d0a3e-warm", undefined, false),
		true,
		"and a bridge id going away (a drop) keeps it for the same reason",
	);
});

test("the re-key runs before anything can await: from inside the seam, the session id already answers", async () => {
	reset();
	/*
	 * DESIGN section 8, R2, pinned where it can fail. The re-key must ride the
	 * patch's SYNCHRONOUS block: moved after an await - the seam below is the one
	 * the comment names - the replacement panel's first frame would be seeded from
	 * an empty registry and receive the row one passive effect later, which is the
	 * flash J1/J2 forbid. Nothing pinned that ordering before this case: a mutant
	 * that relocated `movePendingSendIdentity` past the seam kept every other test
	 * green (agent review round 1, MINOR).
	 *
	 * The reading is taken FROM INSIDE `beforeAdmission`, which runs after the
	 * create and before the wire: if the move slipped past this point the registry
	 * would still answer under the draft key here and this fails.
	 */
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const requestId = store.getState().drafts[key].admissionRequestId;
	let seenInsideSeam = null;
	globalThis.__echoRequest = async (request) => {
		if (request.op === "sessions.create")
			return { session_id: SESSION_ID, binding: null };
		return { status: "admitted" };
	};
	await admitChatDraft(key, input, undefined, undefined, async (sessionId) => {
		seenInsideSeam = pendingSendForView(sessionId)?.id ?? null;
		return undefined;
	});
	assert.equal(
		seenInsideSeam,
		requestId,
		"the move rides the sessionId patch's synchronous block: the registry already answers under the session id when the seam runs",
	);
});

test("a post-seed splice updates the row's text, and a re-seed replays the spliced text", async () => {
	reset();
	/*
	 * THE SEAM'S SPLICE, EXERCISED AGAINST THE REAL MODULE (agent review round 1,
	 * MINOR). `replacePendingSendText` is what rewrites the row after the
	 * credential seam - the same row, same id, corrected text - and
	 * `replaceLocalRecordText` is its only writer. `canonical-chat.test.mjs`
	 * records the call; nothing drove the real registry's splice. Both halves are
	 * pinned here: the mounted transcript updates in place, and a later mount
	 * re-seeds the SPLICED text rather than the pre-splice paint.
	 */
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const pane = await mountTranscript(key);
	paintPendingSend(key, {
		id: "req-splice",
		text: "raw [Credential #1, 19 chars]",
		images: [],
	});
	assert.deepEqual(pane.rows(), ["raw [Credential #1, 19 chars]"]);
	replacePendingSendText(key, "req-splice", "raw [stored secret]");
	assert.deepEqual(
		pane.rows(),
		["raw [stored secret]"],
		"the mounted row is spliced in place, not repainted",
	);
	assert.equal(
		pendingSendForView(key)?.text,
		"raw [stored secret]",
		"and the entry carries the spliced text, because every later seed reads it",
	);
	const remount = await mountTranscript(key);
	assert.deepEqual(
		remount.rows(),
		["raw [stored secret]"],
		"a re-seed replays the spliced text identically",
	);
	pane.unregister();
	remount.unregister();
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
	 * component that no longer exists (UX round 3, U14). The write moved through the
	 * store (`returnInFlight`, which is exactly this call), and the composer TAKES it
	 * here (`pendingText` -> the hook's adoption effect), merging rather than
	 * overwriting.
	 *
	 * WHO WRITES IT NOW (S4): nothing in the FAILURE arm. A post-paint failure is
	 * stated by its row, so no failure hands a payload home - the writers left are
	 * the user's own `Edit` on such a row (`returnPayload`), the flip's residual move
	 * for a released app's claim, and this adoption path. The rule pinned here is
	 * unchanged, and it is the reason the adoption path outlived the return: the box
	 * adopts a return that the STORE wrote, and what the user typed during the flight
	 * is kept - after the returned message, because theirs came second.
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

test("U3: a panel mounted over a retained row paints it in its first state", async () => {
	reset();
	paintPendingSend(SESSION_ID, {
		id: "req-seed",
		text: "seeded message",
		images: [],
	});
	/*
	 * What React reads for the panel's initial state. The remount on the New-chat
	 * path is the only moment this is needed and the only one it can be checked
	 * without a renderer: the drain below arrives one passive effect later, so a
	 * transcript seeded only by the drain had a first frame with nothing in it.
	 */
	const seeded = seedPendingSends(SESSION_ID, EMPTY_TRANSCRIPT);
	assert.deepEqual(
		seeded.records.map((record) => record.text),
		["seeded message"],
	);
	// The drain replays the same mutation over that state; it must land on the
	// SAME transcript rather than painting the message a second time.
	assert.equal(seedPendingSends(SESSION_ID, seeded).records.length, 1);
	const transcript = await mountTranscript(SESSION_ID);
	assert.deepEqual(transcript.rows(), ["seeded message"]);
	transcript.unregister();
});

test("a send threads its paint callback through `admitChatDraft`", async () => {
	reset();
	// The glue between the composer and the seam, and the only part of U1 that is
	// neither the seam's nor the composer's: `send` hands the callback to
	// `admitChatDraft`, which hands it to `paintPendingSend`. Verified with a
	// transcript already mounted, i.e. the path where the row is applied
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

test("the row's paint callback fires with the paint, on both delivery paths, and only once", async () => {
	reset();
	let drained = 0;
	paintPendingSend(SESSION_ID, {
		id: "req-queued",
		text: "queued",
		images: [],
		onPainted: () => {
			drained += 1;
		},
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
		"the composer is told at the moment a transcript receives the row, from the drain",
	);

	let direct = 0;
	paintPendingSend(SESSION_ID, {
		id: "req-direct",
		text: "immediate",
		images: [],
		onPainted: () => {
			direct += 1;
		},
	});
	assert.equal(
		direct,
		1,
		"and synchronously when a transcript is already mounted, so both updates share a commit",
	);
	transcript.unregister();

	// RETENTION RE-SEEDS, IT DOES NOT RE-FIRE. A later mount paints the same
	// rows again (the flip, a switch back, a reload), and the composer that asked
	// must not be told a second time: the callback is the one moment taking the
	// text out of the box was free, and it has passed.
	const later = await mountTranscript(SESSION_ID);
	assert.deepEqual(later.rows(), ["queued", "immediate"]);
	assert.equal(drained, 1, "a re-seeded row must not re-fire the callback");
	assert.equal(direct, 1, "on either delivery path");
	later.unregister();
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
 * calls it: `returnInFlight` is the one WRITE a payload coming home has left
 * (S4's failure arm returns nothing; the live writers are the user's `Edit` on a
 * failed row and the released app's flip move, and both reach the box through
 * this call), so a case that drives the hook with a custom `onSubmit` reproduces
 * the real route rather than a stand-in for it.
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

/* ======== the off-record arm: #479's one-clock clear meets the `/btw` aside */

/*
 * FOLD OF PR #482 ONTO #479, and the one place the two rules meet. #479 moved the
 * staged halves (chips and quotes) off the composer's settle and onto `clearOnce`,
 * so they leave with the text. #482's aside returns an OFF-RECORD outcome whose
 * text leaves at the press (F1) but whose staged halves must wait for the ask's
 * own answer: an answered ask consumed them, a refused one did not (review round
 * 2, F6). An ask never echoes, so the post-await `clearOnce()` is the only trigger
 * it reaches - and without the off-record arm that call took the quote at the
 * press and a refusal left the user without it.
 */
function deferredAsk() {
	let resolve;
	let reject;
	const offRecord = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { outcome: { offRecord }, resolve, reject };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

test("F6 x R1: an off-record ask takes the TEXT at the press and its staged halves only on the answer", async () => {
	const ask = deferredAsk();
	const settled = await driveComposer({
		prime: () => stagePayload(),
		onSubmit: () => ask.outcome,
	});
	assert.equal(settled.after, "", "the box is handed back at the press (F1)");
	assert.deepEqual(
		{ chips: settled.chips(), replies: settled.replies() },
		{ chips: [STAGED.chip], replies: [STAGED.reply] },
		"the ask has not been answered, so nothing says it consumed what it carried",
	);
	// A quote staged while the aside answers is the user's NEXT payload.
	useConversationInputStore
		.getState()
		.addReply(COMPOSER_ID, { id: "reply-late", text: SECOND.reply });
	ask.resolve("the answer");
	await flushMicrotasks();
	assert.deepEqual(
		{ chips: settled.chips(), replies: settled.replies() },
		{ chips: [], replies: [SECOND.reply] },
		"an answered ask retires exactly the entries it carried, by identity (#479's rule)",
	);
});

test("F6 x R1: a refused off-record ask keeps the staged halves it carried", async () => {
	const ask = deferredAsk();
	const settled = await driveComposer({
		prime: () => stagePayload(),
		onSubmit: () => ask.outcome,
	});
	ask.reject(new Error("the aside was refused"));
	await flushMicrotasks();
	assert.equal(
		settled.after,
		"",
		"a refused ask still does not put the text back",
	);
	assert.deepEqual(
		{ chips: settled.chips(), replies: settled.replies() },
		{ chips: [STAGED.chip], replies: [STAGED.reply] },
		"a refused ask put nothing anywhere, so the quote and the file stay for the next send",
	);
	assert.equal(
		settled.storedDraft,
		"",
		"and the persisted draft is retired as for any accepted press",
	);
});

test("R2-2/U5: a settled claim stops answering for the send that follows", async () => {
	reset();
	/*
	 * THE DISTINCTION THE ROUND-2 RE-SHOOT MEASURED, pinned (agent review round 2,
	 * R2-2): a resolution keeps the entry - it is the row's home - and marks it
	 * SETTLED, and `pendingSendForView` skips settled entries so a claim the
	 * server already answered can never be the "still going out" answer for the
	 * NEXT message on that conversation. Without the skip the resolved entry,
	 * being the oldest, was the one the pane's latch anchored to and the next
	 * send flew with no wait line at all.
	 */
	paintPendingSend(SESSION_ID, { id: "older", text: "First", images: [] });
	paintPendingSend(SESSION_ID, {
		id: "newer",
		text: "Second",
		images: [],
		/* The press's clock anchor rides the entry (agent review round 2, R2-5). */
		submittedAt: 1234,
	});
	assert.equal(pendingSendForView(SESSION_ID)?.id, "older");
	assert.equal(
		pendingSendForView(SESSION_ID)?.submittedAt,
		undefined,
		"an entry painted without an anchor has none - the field is the press's",
	);
	settlePendingSend(SESSION_ID, "older");
	assert.equal(
		pendingSendForView(SESSION_ID)?.id,
		"newer",
		"the settled entry must not answer over the one that is still alive",
	);
	assert.equal(
		pendingSendForView(SESSION_ID)?.submittedAt,
		1234,
		"and the anchor survives to the entry the pane's remount reads",
	);
	/* A settled entry is a row, not a claim: it still paints on the next mount. */
	assert.equal(
		seedPendingSends(SESSION_ID, EMPTY_TRANSCRIPT).records.some(
			(record) => record.id === "older",
		),
		true,
	);
	settlePendingSend(SESSION_ID, "newer");
	assert.equal(
		pendingSendForView(SESSION_ID),
		null,
		"with every claim answered, nothing answers `still going out`",
	);
});
