import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE OPERATOR'S REPORT, AS A STORE CONTRACT (2026-10-22): pressing a TEAM in
 * the sidebar to start a new chat landed on "This conversation is no longer on
 * this machine" with the composer replaced by "This conversation is gone",
 * under a header that said "New chat with <team>".
 *
 * The contradiction names the cause: the header reads `activeDraftKey` (a
 * staged draft, so `resolveChatTitle` returns "New chat with <name>"), while
 * the pane's identity reads `panelSessionIdOfView`, which prefers the DRAFT
 * ROW'S `sessionId`. A stable `draft:<kind>:<name>` row keeps that field after
 * a create, and `stageDraft` reuses the row - so a New-chat press can resolve a
 * conversation that is no longer there and the pane paints the terminal
 * missing state for an act that was never about a conversation.
 *
 * This suite pins the source rules: a New-chat press never inherits a
 * conversation pointer; a conversation deleted on this device retires the
 * drafts that named it (the message comes back as a new-chat draft); and the
 * pane's own 404 on a draft's remembered conversation retires the pointer
 * instead of leaving the terminal notice up. Every case the operator listed is
 * here, including the plain-AGENT path, because it shares this code.
 *
 * A STANDALONE FILE, like `drafts-clear-on-send.test.mjs`, because each suite
 * bundles its own store and the fixture is copied rather than shared. Keep the
 * two fixtures in step if either moves.
 */
/*
 * The plugin's filter literals, hoisted: `useTopLevelRegex` charges a literal
 * built per call, and this tree's lint ratchet holds changed files - this one
 * included - fully clean rather than charging them at the diff that touches
 * them.
 */
const RE_DESKTOP_API_MODULE = /@shared\/api\/local-operator\/desktop-api/;
const RE_CANONICAL_SESSION_HOOK = /@shared\/hooks\/use-canonical-session/;
const RE_INPUT_STORE_MODULE = /^@shared\/store\/conversation-input-store$/;
const RE_DESKTOP_HOOKS_MODULE = /@shared\/api\/local-operator\/desktop-hooks/;
const RE_QUERY_CLIENT_MODULE = /@shared\/api\/query-client/;
const RE_ANY = /.*/;

// Exercise the shipped store and closed IPC schema in memory. The transport
// fixture records effects; this is deterministic state evidence, not a browser.
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
const calls = [];
globalThis.__canonicalRequest = async (request) => {
	calls.push(request);
	return {};
};
// The optimistic echo's effects, recorded in order. The real seam is a
// registry of mounted transcripts in `use-canonical-session`; the store only
// ever calls the two functions, so recording them here is the same evidence
// without mounting React. Each entry also snapshots how many transport calls
// had been made when it happened, which is what pins the ORDERING claim: the
// echo must precede the `sessions.message` request, not merely accompany it.
const echoes = [];
globalThis.__canonicalEcho = (event) => {
	echoes.push({ ...event, callsAtTime: calls.length });
};
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store"; export {DesktopControlError} from "@shared/api/local-operator/desktop-api"; export {desktopRequestSchema} from "./src/shared/desktop-contract"; export {desktopFeatureEnabled} from "./src/renderer/src/shared/api/local-operator/desktop-hooks"; export {mergeReturnedText, mergeReturnedPayload} from "./src/renderer/src/shared/store/conversation-input-store";export { sendUnsettledForSession } from "./src/renderer/src/features/chat/canonical/working-line-model"; export { composerIdentityFor, panelIdentityFor as composerPanelIdentity } from "./src/renderer/src/shared/store/canonical-sessions-store"; export {useConversationInputStore} from "./src/renderer/src/shared/store/conversation-input-store"; export { rehydrateInputRows } from "./src/renderer/src/shared/store/conversation-input-store"; export { heldSendClaimsBySession, resolveHeldSendsFromServer } from "./src/renderer/src/features/chat/draft-resolution"; export { discardSuccessorIndex, untargetedDraftRows } from "./src/renderer/src/features/chat/draft-rows"; export { ARCHIVE_UNDO_TOAST_MS } from "./src/renderer/src/features/chat/archive-undo";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	/*
	 * The renderer's aliases are tsconfig paths, not node resolutions - the same
	 * pair `composer-send-failure.test.mjs` carries. The stub plugin below still
	 * wins for the modules it names (onResolve callbacks run before the
	 * resolver's own alias handling), so the transport stays the fixture's.
	 */
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			name: "canonical-transport-fixture",
			setup(builder) {
				builder.onResolve({ filter: RE_DESKTOP_API_MODULE }, () => ({
					path: "transport",
					namespace: "fixture",
				}));
				// The echo seam is stubbed rather than aliased to the real hook:
				// that module is React and a live EventSource, and the store's
				// contract with it is exactly these two calls.
				builder.onResolve({ filter: RE_CANONICAL_SESSION_HOOK }, () => ({
					path: "echo",
					namespace: "echo-fixture",
				}));
				/*
				 * The composer's own store is now a REAL dependency of the send path:
				 * the payload the USER asks back for (an `Edit` on a failed row, and the
				 * released app's flip move) is written there - S4's failure arm returns
				 * nothing, so this is the one route a payload home has left - and that
				 * is the route this suite has to see. Resolved to the same absolute
				 * file the bundle's own export names, so the instance the assertions
				 * read is the instance the store wrote to - a stubbed copy would be a
				 * second store and would prove nothing.
				 */
				builder.onResolve({ filter: RE_INPUT_STORE_MODULE }, () => ({
					path: `${process.cwd()}/src/renderer/src/shared/store/conversation-input-store.ts`,
				}));
				/*
				 * The two modules the store gained for QA's Q-1 (an unnamed catalogue read now
				 * sizes itself from the advertised capability). Both answer "no capability", the
				 * fail-closed direction, so every assertion in this suite still describes the
				 * legacy read it was written against.
				 */
				builder.onResolve({ filter: RE_DESKTOP_HOOKS_MODULE }, () => ({
					path: "capabilities",
					namespace: "capability-fixture",
				}));
				builder.onLoad(
					{ filter: RE_ANY, namespace: "capability-fixture" },
					() => ({
						contents:
							'export const desktopFeatureEnabled = () => false;\nexport const desktopKeys = { capabilities: ["desktop", "capabilities"] };',
						loader: "js",
					}),
				);
				builder.onResolve({ filter: RE_QUERY_CLIENT_MODULE }, () => ({
					path: "query-client",
					namespace: "query-fixture",
				}));
				builder.onLoad({ filter: RE_ANY, namespace: "query-fixture" }, () => ({
					contents: "export const queryClient = { getQueryData: () => null };",
					loader: "js",
				}));
				builder.onLoad({ filter: RE_ANY, namespace: "echo-fixture" }, () => ({
					contents: `export const paintPendingSend = (identity, send) =>
	globalThis.__canonicalEcho({ kind: "echo", identity, sessionId: identity, id: send.id, text: send.text, images: send.images });
export const movePendingSendIdentity = (from, to) =>
	globalThis.__canonicalEcho({ kind: "move", from, to });
export const replacePendingSendText = (identity, id, text) =>
	globalThis.__canonicalEcho({ kind: "replace", identity, id, text });
export const discardPendingSends = (identity) =>
	globalThis.__canonicalEcho({ kind: "discard", sessionId: identity });
export const pendingSendForView = () => null;
export const settlePendingSend = (identity, id) =>
	globalThis.__canonicalEcho({ kind: "settle", identity, id });
export const hasPendingSend = () => false;
export const retractPendingUser = (sessionId, id) =>
	globalThis.__canonicalEcho({ kind: "retract", sessionId, id });
/*
 * The send path's retraction of its OWN echo, and the answer it acts on: the row
 * is either still this app's echo (so the message is not on the owner's
 * transcript and the content belongs back with the user) or it is the OWNER's,
 * which means the message was delivered and the failure was the response to it.
 * The fixture answers with what the real registry would, from the flag it can see
 * on the row it was told about - the store's contract with this module is these
 * three calls, so the answer is part of the contract.
 */
export const retractLocalEcho = (sessionId, id) => {
	globalThis.__canonicalEcho({ kind: "retract-local", sessionId, id });
	return globalThis.__canonicalRowIsLocal?.(id) === false ? "owner" : "retracted";
};
export const peekLocalEcho = (sessionId, id) => {
	globalThis.__canonicalEcho({ kind: "peek-local", sessionId, id });
	return globalThis.__canonicalRowIsLocal?.(id) === false ? "owner" : "local";
};
// Recorded like the other two so a store change that stops evicting an
// abandoned draft's retained row is visible here as well; the registry's own
// bounds are asserted against the real registry in echo-delivery.test.mjs.
export const discardPendingEchoes = (sessionId) =>
	globalThis.__canonicalEcho({ kind: "discard", sessionId });`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				builder.onLoad({ filter: RE_ANY, namespace: "fixture" }, () => ({
					// Only `desktopResult` is faked - it is the network. The error
					// classes and `userFacingMessage` are re-exported from the real
					// module because the store's copy rules depend on their actual
					// behaviour: a stub that always returned `error.message` would let
					// a raw exception through here and still pass. The real
					// `DesktopControlError` also carries the `status` the 413/422
					// un-latch reads, so the size-refusal cases stay covered too.
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = request => globalThis.__canonicalRequest(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	useCanonicalSessionsStore: store,
	admitChatDraft,
	useConversationInputStore,
	rehydrateInputRows,
	heldSendClaimsBySession,
	resolveHeldSendsFromServer,
	discardSuccessorIndex,
	untargetedDraftRows,
	ARCHIVE_UNDO_TOAST_MS,
} = module;
function reset() {
	calls.length = 0;
	echoes.length = 0;
	store.setState({
		sessions: [],
		statusUnavailable: [],
		activeSessionId: "111111111111",
		activeDraftKey: null,
		drafts: {},
		validatingSessionId: null,
		error: null,
	});
}
/*
 * The store's fixture for "a stable team/agent row that already created a
 * conversation". Written by the create's answer (`updateDraft(key,
 * {sessionId})`) and left behind by a failed message or a quit before the ack;
 * `pending:false` is what `persist` writes for any in-flight row at reload.
 */
const DEAD = "deadbeef0001";
const STABLE_TEAM = "minerva-development";

function seedBoundDraft(kind = "team", name = STABLE_TEAM) {
	const key = `draft:${kind}:${name}`;
	store.setState({
		sessions: [],
		forgotten: {},
		activeSessionId: "111111111111",
		activeDraftKey: null,
		validatingSessionId: null,
		drafts: {
			[key]: {
				key,
				target: { kind, name },
				createRequestId: "create-1",
				admissionRequestId: "admit-1",
				sessionId: DEAD,
				pending: false,
				submittedText: "the message that failed",
				admissionAttempted: true,
				error: "Couldn't confirm your message was sent.",
				errorRetry: true,
			},
		},
	});
	useConversationInputStore.setState({ inputByConversation: {} });
	return key;
}

/** The id the pane would mount, from the same expression `chat-page` reads. */
function paneSessionId() {
	const state = store.getState();
	return module.panelSessionIdOfView(
		state.activeDraftKey,
		state.activeDraftKey
			? state.drafts[state.activeDraftKey]?.sessionId
			: undefined,
		state.activeSessionId,
	);
}

test("a New chat press for a team never inherits the conversation its old draft created", () => {
	reset();
	const stable = seedBoundDraft();
	const staged = store
		.getState()
		.stageDraft({ kind: "team", name: STABLE_TEAM });
	assert.equal(staged, stable, "the stable key contract is unchanged");
	assert.equal(
		store.getState().drafts[staged].sessionId,
		undefined,
		"the press's own row is a new chat: it carries no conversation pointer",
	);
	assert.equal(
		paneSessionId(),
		undefined,
		"and the pane resolves no conversation, which is what makes the header and the body agree",
	);
	const moved = Object.entries(store.getState().drafts).find(
		([key, draft]) => key !== staged && draft.sessionId === DEAD,
	);
	assert.ok(
		moved,
		"the failed message's retry row survives under the conversation it belongs to",
	);
	assert.equal(moved[1].submittedText, "the message that failed");
});

test("the first ever chat with a team resolves no conversation and keeps one stable row", () => {
	reset();
	const first = store
		.getState()
		.stageDraft({ kind: "team", name: STABLE_TEAM });
	assert.equal(paneSessionId(), undefined);
	const again = store
		.getState()
		.stageDraft({ kind: "team", name: STABLE_TEAM });
	assert.equal(again, first, "an unbound draft is still the same new chat");
	assert.equal(Object.keys(store.getState().drafts).length, 1);
});

test("a plain agent takes the same path, because it shares the code", () => {
	reset();
	const stable = seedBoundDraft("agent", "coder");
	const staged = store.getState().stageDraft({ kind: "agent", name: "coder" });
	assert.equal(staged, stable);
	assert.equal(store.getState().drafts[staged].sessionId, undefined);
	assert.equal(paneSessionId(), undefined);
});

test("switching teams and back cannot resurrect the retired conversation", () => {
	reset();
	seedBoundDraft();
	const other = store.getState().stageDraft({ kind: "team", name: "lopdev" });
	assert.equal(paneSessionId(), undefined);
	const back = store.getState().stageDraft({ kind: "team", name: STABLE_TEAM });
	assert.equal(
		paneSessionId(),
		undefined,
		"back is a new chat, not the dead id",
	);
	assert.notEqual(back, other);
});

test("deleting a conversation retires the draft that named it and hands the message back", async () => {
	reset();
	const stable = seedBoundDraft();
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.delete")
			return { session_id: DEAD, deleted: true };
		return {};
	};
	const outcome = await store.getState().deleteSession(DEAD);
	assert.deepEqual(outcome, { ok: true });
	assert.equal(
		store.getState().drafts[stable]?.sessionId,
		undefined,
		"no draft may keep pointing at the deleted conversation",
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[stable]
			?.pendingText,
		"the message that failed",
		"the message comes home to the box it will be sent from (adopted on mount)",
	);
	const staged = store
		.getState()
		.stageDraft({ kind: "team", name: STABLE_TEAM });
	assert.equal(paneSessionId(), undefined);
	assert.equal(staged, stable);
});

test("a restart's remembered draft is retired by its own missing verdict, not left on the notice", () => {
	reset();
	const stable = seedBoundDraft();
	/*
	 * The restart shape: the pointer is restored, so the pane mounts the
	 * remembered conversation before anything has been pressed.
	 */
	store.setState({ activeDraftKey: stable, activeSessionId: null });
	assert.equal(
		paneSessionId(),
		DEAD,
		"the restore is what puts the pane on the remembered conversation",
	);
	store.getState().retireDraftSession(stable);
	assert.equal(
		store.getState().drafts[stable]?.sessionId,
		undefined,
		"the 404 retires the pointer",
	);
	assert.equal(
		paneSessionId(),
		undefined,
		"and the pane falls through to a new chat",
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[stable]
			?.pendingText,
		"the message that failed",
	);
});

test("a relaunch unbinds a remembered draft whose conversation this window had tombstoned", () => {
	reset();
	const stable = seedBoundDraft();
	/*
	 * The pair a crash between the two writes of a delete - or a store written
	 * before this fix - leaves on disk: the tombstone survives, and so does the
	 * draft's pointer to it. `mergePersistedSession` is the only place that can
	 * correct it before the first painted frame.
	 */
	const merged = module.mergePersistedSession(
		{
			drafts: store.getState().drafts,
			forgotten: { [DEAD]: { at: 0 } },
			activeDraftKey: stable,
		},
		store.getState(),
	);
	assert.equal(
		merged.drafts[stable].sessionId,
		undefined,
		"the first frame after a relaunch is a new chat, not the notice",
	);
	assert.equal(
		module.panelSessionIdOfView(
			merged.activeDraftKey,
			merged.drafts[merged.activeDraftKey]?.sessionId,
			merged.activeSessionId,
		),
		undefined,
	);
	/*
	 * AND THE WORDS SURVIVE THE HYDRATION (agent review round 1's MINOR-1): the
	 * composer store has already hydrated when this merge runs, because this
	 * module imports it and it imports nothing from here.
	 */
	assert.equal(
		useConversationInputStore.getState().inputByConversation[stable]
			?.pendingText,
		"the message that failed",
	);
});

test("a verdict that lands mid-send does not retire the live claim", () => {
	reset();
	const stable = seedBoundDraft();
	useConversationInputStore.setState({
		inputByConversation: {
			[DEAD]: {
				currentInput: "typed while the failure stood",
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
			},
		},
	});
	store.setState({
		drafts: {
			...store.getState().drafts,
			[stable]: { ...store.getState().drafts[stable], pending: true },
		},
	});
	/*
	 * A 404 can arrive while the create's own message is still on the wire.
	 * `admitChatDraft` holds this key string and will settle under it, so the
	 * row must not be rewritten under the request (MAJOR-1).
	 */
	store.getState().retireDraftsForSession(DEAD);
	store.getState().retireDraftSession(stable);
	const row = store.getState().drafts[stable];
	assert.equal(
		row.sessionId,
		DEAD,
		"the pointer survives while a send is live",
	);
	assert.equal(row.pending, true);
	assert.equal(row.submittedText, "the message that failed");
	assert.equal(
		row.createRequestId,
		"create-1",
		"no request id is re-minted mid-send",
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[stable],
		undefined,
		"and nothing is moved into the new-chat box behind the live send",
	);
});

test("text typed under the conversation identity comes home with the claim", () => {
	reset();
	const stable = seedBoundDraft();
	useConversationInputStore.setState({
		inputByConversation: {
			[DEAD]: {
				currentInput: "and one more thing",
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
			},
		},
	});
	store.getState().retireDraftSession(stable);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[stable]
			?.pendingText,
		"the message that failed\n\nand one more thing",
		"the failed message first, then what was typed after it (MINOR-2)",
	);
});

test("pressing the team row while its own failed conversation is on screen is a no-op", () => {
	reset();
	const stable = seedBoundDraft();
	/*
	 * The reader is IN the failed conversation (opened from its row, so no draft
	 * is staged) and presses the highlighted team row. Before the fix this was a
	 * no-op; forking a blank chat under them would read as losing their failure
	 * (UX review round 1's U2).
	 */
	store.setState({ activeSessionId: DEAD, activeDraftKey: null });
	const staged = store
		.getState()
		.stageDraft({ kind: "team", name: STABLE_TEAM });
	assert.equal(staged, stable);
	assert.equal(
		store.getState().drafts[stable].sessionId,
		DEAD,
		"the press resolves the conversation already on screen, and it is alive",
	);
	assert.equal(
		Object.keys(store.getState().drafts).length,
		1,
		"nothing is moved aside",
	);
});

test("but a press from a fresh draft still forks when the last conversation happens to be that one", () => {
	reset();
	const stable = seedBoundDraft();
	/*
	 * `stageDraft` leaves `activeSessionId` at the conversation the reader came
	 * FROM, so an `activeSessionId` test alone would let the defect back in
	 * whenever that conversation is the bound row's.
	 */
	store.setState({ activeSessionId: DEAD, activeDraftKey: null });
	const fresh = store.getState().stageDraft(undefined, true);
	store.setState({ activeDraftKey: fresh, activeSessionId: DEAD });
	const staged = store
		.getState()
		.stageDraft({ kind: "team", name: STABLE_TEAM });
	assert.equal(staged, stable);
	assert.equal(
		store.getState().drafts[stable].sessionId,
		undefined,
		"a new chat is what the press asked for",
	);
	assert.ok(
		Object.values(store.getState().drafts).some(
			(row) => row.sessionId === DEAD && row.key !== stable,
		),
		"and the failed conversation's retry moved aside",
	);
});

test("a reloaded row's pending text comes home with the claim too", () => {
	reset();
	const stable = seedBoundDraft();
	/*
	 * The shape a reload leaves: the composer's own record of what was typed
	 * during the create hop is `pendingText` (`foldReturn` wrote it, and
	 * `rehydrateInputRows` does not adopt it). The move must adopt it first, or
	 * that half stays stranded under the conversation that is gone (agent review
	 * round 2's MINOR).
	 */
	useConversationInputStore.setState({
		inputByConversation: {
			[DEAD]: {
				currentInput: "",
				pendingText: "typed during the create hop",
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
			},
		},
	});
	store.getState().retireDraftSession(stable);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[stable]
			?.pendingText,
		"the message that failed\n\ntyped during the create hop",
	);
});

/*
 * THE OPERATOR'S SECOND REPORT (2026-10-23), AT THE STORE. A New chat with a
 * team keys a STABLE draft row, and the row's `draftRequestId` persists across
 * launches. A daemon that restarted (or a draft that expired) answers that
 * request's receipt by REPLAYING the id it minted the first time - an id its
 * registry no longer serves. The pane streams on `sessionId ?? draft.warmId`,
 * so its bridge 404s, and the renderer used to commit `missing` for an id a
 * DRAFT was standing on: "This conversation is no longer on this machine" under
 * a header that says "New chat with <team>".
 *
 * These three cases pin the store's half of the fix:
 *   - the dead warm is retired and the mint's request id re-minted, while every
 *     field that states the draft's INTENT (target, model, peer) and every
 *     composer word stay put, and a replay of the same verdict is a no-op;
 *   - a row that already points at a conversation is NOT this action's (its
 *     pointer belongs to `retireDraftsForSession`, and its warm is not the
 *     thing a stream 404 was about);
 *   - the missing notice's press lands on a new chat that carries the box.
 */
const TEAM_KEY = `draft:team:${STABLE_TEAM}`;
const WARM_DEAD = "warm-dead-0001";

/** A fresh team draft holding only what a replayed receipt gave it. */
function seedWarmDraft() {
	store.setState({
		sessions: [],
		forgotten: {},
		activeSessionId: null,
		activeDraftKey: TEAM_KEY,
		validatingSessionId: null,
		drafts: {
			[TEAM_KEY]: {
				key: TEAM_KEY,
				target: { kind: "team", name: STABLE_TEAM },
				model: {
					provider: "radient",
					model_id: "mock-model",
					reasoning_effort: null,
				},
				peer: "damians-macbook",
				createRequestId: "create-warm-1",
				admissionRequestId: "admit-warm-1",
				draftRequestId: "mint-request-1",
				warmId: WARM_DEAD,
			},
		},
	});
	useConversationInputStore.setState({
		inputByConversation: {
			[TEAM_KEY]: {
				currentInput: "half a sentence the user typed",
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
			},
		},
	});
}

test("a dead warm id is retired while the draft's own intent and words stay", () => {
	reset();
	seedWarmDraft();
	store.getState().retireDraftWarm(WARM_DEAD);
	const row = store.getState().drafts[TEAM_KEY];
	assert.equal(
		row.warmId,
		undefined,
		"the bridge id is gone: the next read of `streamId` opens nothing",
	);
	assert.notEqual(
		row.draftRequestId,
		"mint-request-1",
		"the mint's request id is re-minted, or its receipt would replay the dead id",
	);
	assert.equal(typeof row.draftRequestId, "string");
	assert.deepEqual(
		row.target,
		{ kind: "team", name: STABLE_TEAM },
		"the destination is the user's, not a fact about the dead runtime",
	);
	assert.equal(row.model?.model_id, "mock-model");
	assert.equal(row.peer, "damians-macbook");
	assert.equal(
		store.getState().activeDraftKey,
		TEAM_KEY,
		"the pane is still the new chat it always was",
	);
	assert.equal(
		useConversationInputStore.getState().getCurrentInput(TEAM_KEY),
		"half a sentence the user typed",
		"the composer's words are filed under the draft key and do not move",
	);
	const minted = row.draftRequestId;
	store.getState().retireDraftWarm(WARM_DEAD);
	assert.equal(
		store.getState().drafts[TEAM_KEY].draftRequestId,
		minted,
		"a second verdict about the same warm is a no-op, so a reconnect cannot re-mint",
	);
	assert.equal(store.getState().drafts[TEAM_KEY].warmId, undefined);
});

test("a row that points at a conversation is not retireDraftWarm's to touch", () => {
	reset();
	const stable = seedBoundDraft();
	store.setState((state) => ({
		drafts: {
			...state.drafts,
			[stable]: { ...state.drafts[stable], warmId: WARM_DEAD },
		},
	}));
	store.getState().retireDraftWarm(WARM_DEAD);
	const row = store.getState().drafts[stable];
	assert.equal(
		row.sessionId,
		DEAD,
		"the conversation pointer is `retireDraftsForSession`'s, not this action's",
	);
	assert.equal(row.warmId, WARM_DEAD, "and its warm is left where it was");
});

test("the missing notice's press lands on a new chat carrying the whole box, once", () => {
	reset();
	store.setState({
		activeSessionId: DEAD,
		activeDraftKey: null,
		drafts: {},
	});
	useConversationInputStore.setState({
		inputByConversation: {
			[DEAD]: {
				currentInput: "the words the dead conversation was holding",
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [{ id: "chip-1", path: "/tmp/report.pdf" }],
			},
		},
	});
	const key = store.getState().startNewChat(DEAD);
	assert.match(
		key,
		/^draft:/,
		"a plain new chat, the same row the shortcut stages",
	);
	assert.equal(store.getState().activeDraftKey, key);
	/*
	 * THE WHOLE-ROW MOVE (agent review round 1, R1-1): `returnInFlight` folds the
	 * payload into `pendingText`/`attachments` for the composer to adopt, so the
	 * claim is the *row*, not `currentInput` - the retired-draft path's own
	 * convention.
	 */
	const moved = useConversationInputStore.getState().inputByConversation[key];
	assert.equal(
		moved?.pendingText,
		"the words the dead conversation was holding",
		"the words follow the reader instead of being orphaned under the dead id",
	);
	assert.deepEqual(
		moved?.attachments.map((chip) => chip.path),
		["/tmp/report.pdf"],
		"and so does the chip: a file must not stay filed under a conversation that is gone",
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[DEAD],
		undefined,
		"a move, not a copy: the old key is gone, so nothing can resurrect it",
	);
	assert.equal(
		store.getState().drafts[key].target,
		undefined,
		"no destination is guessed from the conversation that is gone",
	);
	/*
	 * AND THE SELECTION IS CLEARED (QA round 1, Q1): a route or a relaunch that
	 * still names the dead conversation must not re-open it over an empty box.
	 */
	assert.equal(store.getState().activeSessionId, null);
	assert.equal(store.getState().validatingSessionId, null);
});

/*
 * THE ROW WHOSE WORDS ARE STILL WAITING TO BE ADOPTED (agent review round 2,
 * R2-2). `returnInFlight` folds `currentInput` and then deletes the source row,
 * so a row holding only `pendingText` - a returned payload that landed in the
 * same turn as the 404, or one whose adoption a masked capture skipped - would
 * be deleted with its words still in it. The press adopts first, exactly as the
 * retired-draft path does.
 */
test("a row still holding pendingText is adopted before the press deletes it", () => {
	reset();
	store.setState({
		activeSessionId: DEAD,
		activeDraftKey: null,
		drafts: {},
	});
	useConversationInputStore.setState({
		inputByConversation: {
			[DEAD]: {
				currentInput: "",
				pendingText: "words still waiting to be adopted",
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
			},
		},
	});
	const key = store.getState().startNewChat(DEAD);
	const moved = useConversationInputStore.getState().inputByConversation[key];
	assert.equal(
		moved?.pendingText,
		"words still waiting to be adopted",
		"the un-adopted words must follow the reader, not be deleted with the row",
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[DEAD],
		undefined,
		"and the adopted row is still a move, not a copy",
	);
});

/*
 * THE HOOK'S HALF, PINNED AT THE SOURCE. `useCanonicalSessionStream` cannot be
 * bundled here (it is React and a live stream), and the property that matters is
 * an ORDER: for a draft's bridge the 404 arm must return before the session
 * arm's `missing: true` commit, and the session arm must still make it. This
 * reads the shipped file, so it fails on the base tree and on any refactor that
 * re-merges the two arms. The behavioural half - the notice absent, the draft
 * intact and the send landing - is the `team-newchat` driver scene.
 */
test("the 404 arm tells a draft's bridge from a conversation, in that order", async () => {
	const { readFileSync } = await import("node:fs");
	const source = readFileSync(
		"src/renderer/src/shared/hooks/use-canonical-session.ts",
		"utf8",
	);
	const branch = source.indexOf(
		'if (event.kind === "error" && event.status === 404)',
	);
	assert.notEqual(branch, -1, "the 404 branch moved; re-read this pin");
	const tail = source.slice(branch);
	const draftArm = tail.indexOf("if (!isSession) {");
	const missingCommit = tail.indexOf("missing: true");
	assert.notEqual(draftArm, -1, "the draft arm is what this fix adds");
	assert.ok(
		draftArm < missingCommit,
		"the draft arm must be read BEFORE the session arm's missing commit",
	);
	const arm = tail.slice(draftArm, missingCommit);
	assert.match(
		arm,
		/retireDraftWarm\(/,
		"the dead warm is retired through the store action",
	);
	assert.match(
		arm,
		/return;/,
		"and the arm returns: no missing, no unavailable",
	);
	assert.doesNotMatch(arm, /missing: true/, "the draft arm never commits it");
	const sessionArm = tail.slice(
		Math.max(0, missingCommit - 400),
		missingCommit + 1200,
	);
	assert.match(
		sessionArm,
		/status: "unavailable"/,
		"the session arm still paints the terminal state for a conversation",
	);
});
