import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The operator's own reports, as store contracts (2026-09-26): "drafts seem to
 * be staying in local-operator-ui after sending them", and "coming back to
 * start a new chat with a team and seeing the old message that I already sent
 * populated in there" - one leak seen from two seats. The composer writes its
 * in-flight record under the PANE's identity at the echo's paint, which on a
 * staged draft is the DRAFT KEY; settling only the post-flip session identity
 * left that record to fold back into the box at the next launch
 * (`rehydrateInputRows`), where a stable `draft:team:<name>` key is reopened by
 * the next New chat with that team. This suite pins the store half: sent means
 * fully cleared, durable across a relaunch, non-resurfacing for a stable key,
 * and the held-claim sweep that concludes claims without their pane.
 *
 * A STANDALONE FILE, NOT MORE TESTS IN `canonical-chat.test.mjs`, for a
 * measured reason: that file carries 97 pre-existing `biome check` diagnostics
 * (90 `useTopLevelRegex`, 7 `noUnusedVariables`), and `pnpm lint:scripts` is a
 * ratchet - a file a change touches must come out fully lint-clean, so adding
 * eight tests there would charge this fix a five-thousand-line regex move.
 * The fixture below is the same one, copied from that file rather than shared,
 * because the suites are standalone by construction (each bundles its own
 * store); keep the two in step if the fixture moves.
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
const RE_SEND_UNCONFIRMED = /Couldn't confirm your message was sent\./;
const input = {
	text: "Review this",
	attachments: [],
	images: [],
	mode: "prompt",
	cwd: "/tmp",
};

/*
 * THE OPERATOR'S OWN REPORTS, AS STORE CONTRACTS (2026-09-26): "drafts seem to
 * be staying in local-operator-ui after sending them", and "coming back to
 * start a new chat with a team and seeing the old message that I already sent
 * populated in there". Both were one leak seen from two seats: the composer
 * writes its in-flight record under the PANE's identity at the echo's paint,
 * which on a staged draft is the DRAFT KEY - and settling only the post-flip
 * session identity left that record to fold back into the box at the next
 * launch (`rehydrateInputRows`), where a stable `draft:team:<name>` key is
 * reopened by the next New chat with that team.
 */
test("a landed draft send retires the composer record under the pre-send key, so a relaunch cannot re-adopt it", async () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "333333333333",
				binding: { agent: null, team: null },
			};
		return {};
	};
	const key = store.getState().stageDraft({ kind: "team", name: "minervadev" });
	/*
	 * What the composer records at the echo's paint (use-message-input's
	 * `clearOnce(true)` -> `beginInFlight(..., record: true)`): the in-flight
	 * payload lands under the DRAFT KEY because the identity flip has not
	 * happened yet - the create's answer re-keys the panel later.
	 */
	useConversationInputStore
		.getState()
		.beginInFlight(
			key,
			{ text: "Can you check our google drive", attachments: [], replies: [] },
			true,
		);
	await admitChatDraft(key, input);
	assert.equal(
		store.getState().drafts[key],
		undefined,
		"the draft row retires",
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[key],
		undefined,
		"and the pre-send composer row goes with it (nothing is in flight anywhere)",
	);
	/*
	 * THE RELAUNCH, which is where the operator saw the message come back. A
	 * persisted in-flight record is folded into the composer by
	 * `rehydrateInputRows`; with the record settled there is nothing to fold,
	 * under either identity.
	 */
	const resurrected = rehydrateInputRows(
		useConversationInputStore.getState().inputByConversation,
	);
	assert.equal(resurrected[key], undefined);
	assert.equal(resurrected["333333333333"]?.pendingText, undefined);
});

test("a landed draft send carries text typed during the create hop to the new conversation", async () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	let key = null;
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create") {
			// The user types on while the create is in flight: it lands under the
			// draft key, the identity the pane has until the answer re-keys it.
			useConversationInputStore
				.getState()
				.setCurrentInput(key, "and the alert one too");
			return {
				session_id: "333333333333",
				binding: { agent: null, team: null },
			};
		}
		return {};
	};
	key = store.getState().stageDraft({ kind: "team", name: "minervadev" });
	// A stale folded return under the same key, the shape a previous launch's
	// rehydrate wrote: it must not survive the send either.
	useConversationInputStore.setState({
		inputByConversation: {
			[key]: {
				currentInput: "",
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
				pendingText: "an older sent message",
				returned: {
					text: "an older sent message",
					chipIds: [],
					replyIds: [],
				},
			},
		},
	});
	await admitChatDraft(key, input);
	const moved =
		useConversationInputStore.getState().inputByConversation["333333333333"];
	assert.equal(
		moved?.pendingText,
		"and the alert one too",
		"the user's own words crossed the flip",
	);
	assert.equal(
		moved?.pendingText?.includes("an older sent message") ?? false,
		false,
		"and the stale return did not ride along",
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[key],
		undefined,
		"the pre-send row is gone rather than half-cleared",
	);
});

test("discarding a draft clears its composer row, so a stable key starts empty next time", () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	const key = store.getState().stageDraft({ kind: "team", name: "radientdev" });
	useConversationInputStore
		.getState()
		.setCurrentInput(key, "the deleted draft's text");
	useConversationInputStore
		.getState()
		.addSubmittedMessage(key, "an older send");
	store.getState().discardDraft(key);
	assert.equal(store.getState().drafts[key], undefined);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[key],
		undefined,
		"the composer-side row went with the draft",
	);
	/*
	 * AND THE NEXT DRAFT UNDER THE SAME KEY STARTS EMPTY: a team/agent draft's
	 * key is STABLE, so this is the exact path that used to bring the deleted
	 * draft's text back.
	 */
	const again = store
		.getState()
		.stageDraft({ kind: "team", name: "radientdev" });
	assert.equal(again, key, "the team key is stable");
	assert.equal(
		useConversationInputStore.getState().inputByConversation[again]
			?.currentInput ?? "",
		"",
	);
});

test("the batch discard clears exactly the keys it is given, in one update", () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	const first = store
		.getState()
		.stageDraft({ kind: "team", name: "minervadev" });
	const second = store.getState().stageDraft({ kind: "agent", name: "coder" });
	const kept = store.getState().stageDraft({ kind: "team", name: "lopdev" });
	for (const key of [first, second, kept])
		useConversationInputStore
			.getState()
			.setCurrentInput(key, `text for ${key}`);
	store.getState().openDraft(second);
	let updates = 0;
	const unsubscribe = store.subscribe(() => {
		updates += 1;
	});
	store.getState().discardDrafts([first, second]);
	unsubscribe();
	assert.equal(
		updates,
		1,
		"one write for the whole clear, so the list repaints once",
	);
	assert.deepEqual(Object.keys(store.getState().drafts), [kept]);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[first],
		undefined,
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[second],
		undefined,
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[kept]
			?.currentInput,
		`text for ${kept}`,
		"a key that was not named is untouched",
	);
	assert.equal(
		store.getState().activeDraftKey,
		null,
		"the pointer clears when the batch takes the open draft",
	);
});

/*
 * THE LAUNCH SWEEP (`draft-resolution.ts`), the half the pane paths could not
 * reach: the operator's five lingering `Draft:` rows each had a session the
 * reader had stopped visiting, so the reads that resolve a held claim - the
 * pane's snapshot and its history walk - never ran for them again.
 */
const HELD_SESSION = "ad10bf7245e4";
const HELD_KEY = "draft:82a3e60a-c954-45ed-b3c4-e19272f10dc4";
const HELD_RECORD = "e2a3e60a0000000000000000000000a1";

/** The claim row the operator's store carried: attempted, not pending, unlost text. */
const heldClaimRow = (key = HELD_KEY, sessionId = HELD_SESSION) => ({
	key,
	sessionId,
	createRequestId: "c1",
	admissionRequestId: HELD_RECORD,
	admissionAttempted: true,
	pending: false,
	submittedText: "Can you check our google drive",
	error: "Couldn't confirm your message was sent.",
	errorCode: "deadline_exceeded",
	errorRetry: true,
});

/** The composer residue the same store carried: the leak, already folded once. */
const heldComposerRow = () => ({
	currentInput: "",
	submittedMessages: [],
	currentHistoryIndex: null,
	replies: [],
	attachments: [],
	pendingText: "Can you check our google drive",
	returned: {
		text: "Can you check our google drive",
		chipIds: [],
		replyIds: [],
	},
});

test("the sweep resolves a delivered claim nobody visits, and the message leaves the composer", async () => {
	reset();
	store.setState({ drafts: { [HELD_KEY]: heldClaimRow() } });
	useConversationInputStore.setState({
		inputByConversation: { [HELD_KEY]: heldComposerRow() },
	});
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		assert.equal(request.op, "sessions.history");
		assert.equal(request.sessionId, HELD_SESSION);
		assert.equal(
			request.beforeId,
			undefined,
			"the sweep asks for the tail-most page",
		);
		return {
			entries: [{ id: HELD_RECORD, ts: 1, type: "user", payload: {} }],
			has_more: false,
			cursor_missing: false,
		};
	};
	const outcome = await resolveHeldSendsFromServer();
	assert.deepEqual(outcome, { visited: 1, resolved: 1, healed: 0 });
	const row = store.getState().drafts[HELD_KEY];
	assert.notEqual(row, undefined, "the row stays - it is the message's home");
	assert.equal(row.submittedText, undefined, "the claim's text is gone");
	assert.equal(row.admissionAttempted, undefined);
	assert.equal(row.error, undefined, "and the failure's copy with it");
	const composer =
		useConversationInputStore.getState().inputByConversation[HELD_KEY];
	assert.equal(
		composer?.pendingText,
		undefined,
		"the delivered message leaves the box rather than waiting to be adopted",
	);
	assert.equal(composer?.returned, undefined);
	// And nothing is left for a relaunch to fold back in.
	const resurrected = rehydrateInputRows(
		useConversationInputStore.getState().inputByConversation,
	);
	assert.equal(resurrected[HELD_KEY]?.pendingText, undefined);
});

test("a sweep that does not find the message leaves the claim and its retry material alone", async () => {
	reset();
	store.setState({ drafts: { [HELD_KEY]: heldClaimRow() } });
	useConversationInputStore.setState({
		inputByConversation: { [HELD_KEY]: heldComposerRow() },
	});
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return {
			entries: [
				{
					id: "ffffffffffffffffffffffffffffffff",
					ts: 2,
					type: "user",
					payload: {},
				},
			],
			has_more: false,
			cursor_missing: false,
		};
	};
	const outcome = await resolveHeldSendsFromServer();
	assert.deepEqual(
		outcome,
		{ visited: 1, resolved: 0, healed: 0 },
		"silence off one tail page is not a 'did not land' this reader can stand behind",
	);
	const row = store.getState().drafts[HELD_KEY];
	assert.equal(row.submittedText, "Can you check our google drive");
	assert.equal(row.admissionAttempted, true);
	assert.match(row.error, RE_SEND_UNCONFIRMED);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[HELD_KEY]
			?.pendingText,
		"Can you check our google drive",
		"and the retry material is untouched",
	);
});

test("a session whose history cannot be read resolves nothing", async () => {
	reset();
	store.setState({ drafts: { [HELD_KEY]: heldClaimRow() } });
	globalThis.__canonicalRequest = async () => {
		throw new Error("the transport is down");
	};
	const outcome = await resolveHeldSendsFromServer();
	assert.deepEqual(outcome, { visited: 1, resolved: 0, healed: 0 });
	assert.equal(
		store.getState().drafts[HELD_KEY].submittedText,
		"Can you check our google drive",
	);
});

test("the sweep's claim set is the unsettled claims that have a session to ask", () => {
	const claims = heldSendClaimsBySession({
		"draft:no-session": {
			key: "draft:no-session",
			admissionAttempted: true,
			submittedText: "never got a session id",
		},
		"draft:pending": {
			key: "draft:pending",
			sessionId: "aaaa00000000",
			admissionAttempted: true,
			pending: true,
			submittedText: "still in flight",
		},
		"draft:unattempted": {
			key: "draft:unattempted",
			sessionId: "aaaa00000000",
			submittedText: "typed, never sent",
		},
		"send:bbbb00000000": {
			key: "send:bbbb00000000",
			admissionAttempted: true,
			submittedAt: 900,
			submittedText: "in flight",
		},
		"draft:held": {
			key: "draft:held",
			sessionId: "aaaa00000000",
			admissionAttempted: true,
			pending: false,
			submittedAt: 100,
			submittedText: "Can you check our google drive",
		},
	});
	/*
	 * OLDEST CLAIM FIRST (agent review round 1's R5): the stamped claim above is
	 * NEWER than `draft:held`'s, so its session waits and held's is visited first -
	 * the cap cannot starve the row that has been lingering longest.
	 */
	assert.deepEqual([...claims.keys()], ["aaaa00000000", "bbbb00000000"]);
	assert.deepEqual(claims.get("bbbb00000000"), ["send:bbbb00000000"]);
	assert.deepEqual(claims.get("aaaa00000000"), ["draft:held"]);
});

test("a discard raises one offer carrying exactly what the write removed, and the restore puts it back", () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	const key = store.getState().stageDraft({ kind: "team", name: "minervadev" });
	store.setState({
		drafts: {
			...store.getState().drafts,
			[key]: {
				...store.getState().drafts[key],
				admissionAttempted: true,
				pending: false,
				sessionId: "6b736ae921df",
				submittedText: "Can you review user-dashboard",
			},
		},
	});
	useConversationInputStore.setState({
		inputByConversation: {
			[key]: {
				currentInput: "",
				submittedMessages: ["an earlier message"],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
				pendingText: "Can you review user-dashboard",
				returned: {
					text: "Can you review user-dashboard",
					chipIds: [],
					replyIds: [],
				},
			},
		},
	});
	const before = store.getState().drafts[key];
	store.getState().discardDraft(key);
	/*
	 * ONE SLOT, AND IT HOLDS THE EXACT STATE THE WRITE REMOVED (design round 1's
	 * D1): the entry as it stood and the composer row `clearAll` dropped, so an
	 * Undo has something to restore FROM.
	 */
	const offer = store.getState().draftsUndo;
	assert.equal(offer.keys.length, 1);
	assert.equal(offer.keys[0], key);
	assert.deepEqual(offer.drafts[key], before);
	assert.equal(
		offer.composer[key].pendingText,
		"Can you review user-dashboard",
		"the payload's only surviving home between the write and the restore",
	);
	assert.equal(store.getState().drafts[key], undefined);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[key],
		undefined,
	);
	store.getState().restoreDraftsUndo();
	assert.deepEqual(
		store.getState().drafts[key],
		before,
		"the draft entry comes back as it stood",
	);
	const row = useConversationInputStore.getState().inputByConversation[key];
	assert.equal(row.pendingText, "Can you review user-dashboard");
	assert.deepEqual(row.submittedMessages, ["an earlier message"]);
	assert.equal(
		row.textRevision,
		1,
		"the restore announces itself as a store write, so a mounted composer adopts the text (R9/U7b)",
	);
	assert.equal(
		store.getState().draftsUndo,
		null,
		"and the offer retires on the press",
	);
});

test("the batch's offer restores every key it ruled, in the order it retired them", () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	const first = store.getState().stageDraft();
	const second = store.getState().stageDraft();
	const kept = store.getState().stageDraft({ kind: "agent", name: "coder" });
	for (const key of [first, second])
		useConversationInputStore
			.getState()
			.setCurrentInput(key, `text for ${key}`);
	store.getState().discardDrafts([first, second]);
	const offer = store.getState().draftsUndo;
	assert.deepEqual(offer.keys, [first, second]);
	assert.deepEqual(Object.keys(store.getState().drafts), [kept]);
	store.getState().restoreDraftsUndo();
	assert.deepEqual(
		Object.keys(store.getState().drafts).sort(),
		[first, kept, second].sort(),
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[first]
			.currentInput,
		`text for ${first}`,
	);
	assert.equal(store.getState().draftsUndo, null);
});

test("a restore never overwrites newer state: a re-staged key and a typed row both win", () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	const stable = store.getState().stageDraft({ kind: "team", name: "lopdev" });
	useConversationInputStore.getState().setCurrentInput(stable, "the old text");
	const beforeEntry = store.getState().drafts[stable];
	store.getState().discardDraft(stable);
	/*
	 * The reader re-stages the SAME stable key inside the offer's lifetime and types
	 * their own words; the offer is then pressed. Their newer state is the thing an
	 * undo must not overwrite (`restoreDraftsUndo`'s own rule).
	 */
	const again = store.getState().stageDraft({ kind: "team", name: "lopdev" });
	assert.equal(
		again,
		stable,
		"the key is stable, which is what makes the guard load-bearing",
	);
	useConversationInputStore.getState().setCurrentInput(stable, "the new text");
	store.getState().restoreDraftsUndo();
	assert.equal(
		useConversationInputStore.getState().inputByConversation[stable]
			.currentInput,
		"the new text",
	);
	assert.notEqual(
		store.getState().drafts[stable].createRequestId,
		beforeEntry.createRequestId,
		"the re-staged entry survives: the key existed again, so the snapshot did not overwrite it",
	);
});

test("a live send hop is stated on the row, which is what withholds the acts", () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	const inFlight = store.getState().stageDraft();
	const settled = store.getState().stageDraft();
	useConversationInputStore
		.getState()
		.setCurrentInput(settled, "a settled row, typed and waiting");
	store.setState({
		drafts: {
			...store.getState().drafts,
			[inFlight]: {
				...store.getState().drafts[inFlight],
				admissionAttempted: true,
				pending: true,
				submittedText: "still in flight",
			},
		},
	});
	/*
	 * UX round 1's U2, remediation: the CONTROL is withheld for a live hop (sidebar:
	 * `disabled={row.pending}`, and the batch passes only settled keys), so what the
	 * store owes the reader is the marker itself - `untargetedDraftRows` must say
	 * which rows are mid-send, including the create-hop shape (no sessionId yet,
	 * text carried by the claim). The store's own discard semantics are unchanged
	 * and stay pinned where they were documented (`canonical-chat.test.mjs`: a
	 * deliberate discard still outranks the abandoned request).
	 */
	const rows = untargetedDraftRows(
		store.getState().drafts,
		useConversationInputStore.getState().inputByConversation,
		new Set(),
	);
	assert.equal(
		rows.find((row) => row.key === inFlight)?.pending,
		true,
		"the live hop is stated",
	);
	assert.equal(rows.find((row) => row.key === settled)?.pending, false);
});

test("a second discard replaces the first offer, one slot", () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	const first = store.getState().stageDraft();
	const second = store.getState().stageDraft();
	store.getState().discardDraft(first);
	const firstAt = store.getState().draftsUndo.at;
	store.getState().discardDraft(second);
	const offer = store.getState().draftsUndo;
	assert.deepEqual(offer.keys, [second]);
	assert.ok(
		offer.at > firstAt,
		"a later raise is a new offer, not the old one re-stamped",
	);
});

test("the caret successor is read by key, from the list as it stood before the write", () => {
	/*
	 * THE BEHAVIOUR THE HANDLER NEEDS, exercised as arithmetic rather than pinned as
	 * a regex (agent review round 1's R2 = design round 1's D2): the old expression
	 * indexed the discard BUTTON among `[data-draft-row]` elements, so it always
	 * returned -1 and the caret always landed on the first row.
	 */
	assert.equal(
		discardSuccessorIndex(["a", "b", "c"], "b"),
		1,
		"the row that slid up",
	);
	assert.equal(discardSuccessorIndex(["a", "b", "c"], "a"), 0);
	assert.equal(
		discardSuccessorIndex(["a", "b", "c"], "c"),
		2,
		"the last row's own position",
	);
	assert.equal(
		discardSuccessorIndex([], "gone"),
		0,
		"a key that is already gone reads as the top",
	);
	assert.equal(discardSuccessorIndex(["a", "b"], "missing"), 0);
});

test("the discard offer's life has one home, sonner's duration of the archive family", () => {
	/*
	 * DESIGN ROUND 2'S D6 measured the drafts offer living 15.2 s of card against a
	 * recorded eight, because it had reached for a retirement SUBSCRIPTION's bound (a
	 * number nobody sees) instead of a display life. The fix that followed made the
	 * offer's own module export a second eight-second clock; the clock is gone with the
	 * lane (2026-09-27: the offer is an ordinary sonner toast whose life is the
	 * library's own `duration`, pausable while the reader holds it). What survives is
	 * the rule that motivated D6: ONE number for both offers, `ARCHIVE_UNDO_TOAST_MS`,
	 * with no second clock beside it.
	 */
	const draftsUndo = readFileSync(
		"src/renderer/src/features/chat/drafts-undo.ts",
		"utf8",
	)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
	assert.equal(
		/(_MS\b|CEILING)/.test(draftsUndo),
		false,
		"the offer's life must not grow a second clock: sonner's duration is it, imported from archive-undo.ts",
	);
	assert.equal(ARCHIVE_UNDO_TOAST_MS, 8_000);
});
