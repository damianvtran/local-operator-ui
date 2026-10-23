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
