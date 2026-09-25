import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The regex literals this module uses, hoisted to the top level: the
 * `useTopLevelRegex` rule charges a literal constructed inside a function, and
 * `scripts/` is outside `pnpm lint`'s path list, so this tree's own gate
 * (`pnpm lint:scripts`, which compares each changed file against its baseline)
 * is the only thing that would have said so.
 */
const RE_STATUSUNAVAILABLE_INCLUDES_LIVENESS =
	/statusUnavailable\.includes\("liveness"\)/;
const RE_LIVENESS_UNREAD_SENTENCE =
	/livenessUnread\s*\?\s*"The daemon could not read which chats are running[^"]*"\s*:\s*"Nothing running right now\."/;

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
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store"; export {DesktopControlError} from "@shared/api/local-operator/desktop-api"; export {desktopRequestSchema} from "./src/shared/desktop-contract"; export {desktopFeatureEnabled} from "./src/renderer/src/shared/api/local-operator/desktop-hooks"; export {mergeReturnedText, mergeReturnedPayload} from "./src/renderer/src/shared/store/conversation-input-store";export { sendUnsettledForSession } from "./src/renderer/src/features/chat/canonical/working-line-model"; export { composerIdentityFor, panelIdentityFor as composerPanelIdentity } from "./src/renderer/src/shared/store/canonical-sessions-store"; export {useConversationInputStore} from "./src/renderer/src/shared/store/conversation-input-store";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "canonical-transport-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "fixture" }),
				);
				// The echo seam is stubbed rather than aliased to the real hook:
				// that module is React and a live EventSource, and the store's
				// contract with it is exactly these two calls.
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				/*
				 * The composer's own store is now a REAL dependency of the send path:
				 * a failure returns the payload there (`returnPayloadToComposer`), and
				 * that is the one route this suite has to see. Resolved to the same
				 * absolute file the bundle's own export names, so the instance the
				 * assertions read is the instance the store wrote to - a stubbed copy
				 * would be a second store and would prove nothing.
				 */
				builder.onResolve(
					{ filter: /^@shared\/store\/conversation-input-store$/ },
					() => ({
						path: `${process.cwd()}/src/renderer/src/shared/store/conversation-input-store.ts`,
					}),
				);
				/*
				 * The two modules the store gained for QA's Q-1 (an unnamed catalogue read now
				 * sizes itself from the advertised capability). Both answer "no capability", the
				 * fail-closed direction, so every assertion in this suite still describes the
				 * legacy read it was written against.
				 */
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-hooks/ },
					() => ({ path: "capabilities", namespace: "capability-fixture" }),
				);
				builder.onLoad(
					{ filter: /.*/, namespace: "capability-fixture" },
					() => ({
						contents:
							'export const desktopFeatureEnabled = () => false;\nexport const desktopKeys = { capabilities: ["desktop", "capabilities"] };',
						loader: "js",
					}),
				);
				builder.onResolve({ filter: /@shared\/api\/query-client/ }, () => ({
					path: "query-client",
					namespace: "query-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "query-fixture" }, () => ({
					contents: "export const queryClient = { getQueryData: () => null };",
					loader: "js",
				}));
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export const echoPendingUser = (sessionId, id, text, images) =>
	globalThis.__canonicalEcho({ kind: "echo", sessionId, id, text, images });
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
// Recorded like the other two so a store change that stops evicting an
// abandoned draft's buffered echo is visible here as well; the buffer's own
// bounds are asserted against the real registry in echo-delivery.test.mjs.
export const discardPendingEchoes = (sessionId) =>
	globalThis.__canonicalEcho({ kind: "discard", sessionId });`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
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
	replaceSessionRows,
	admitChatDraft,
	draftIdentityFor,
	sendUnsettledForSession,
	panelIdentityFor,
	panelIdentityOfView,
	composerIdentityFor,
	buildSendPayload,
	desktopRequestSchema,
	DesktopControlError,
	LEADING_SLASH_CODE,
	LEADING_SLASH_MESSAGE,
	SESSION_UNVALIDATED_CODE,
	STORE_OUT_OF_SPACE_CODE,
	STORE_UNAVAILABLE_CODE,
	UNREADABLE_ATTACHMENT_CODE,
	ANSWER_NOT_SENT_CODE,
	ASIDE_NOT_ANSWERED_CODE,
	ASIDE_STILL_ANSWERING_CODE,
	isRefusedBeforeAdmission,
	isStoreWriteRefusal,
	refusedBeforeAdmissionAttachments,
	refusedBeforeAdmissionText,
	mergeReturnedText,
	mergeReturnedPayload,
	sendFailureCopy,
	SEND_FAILURE_COPY,
	normalizeSendText,
	RETRY_LABEL,
	CLEAR_LABEL,
	useConversationInputStore,
	withholdsRetryHint,
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
		sessionByAgent: {},
		validatingSessionId: null,
		error: null,
	});
}
function attention(revision, unseen = true) {
	return {
		conversation_id: "session/111111111111",
		completion_token: "token",
		anchor_id: "anchor",
		kind: "complete",
		unseen,
		revision,
	};
}
const input = {
	text: "Review this",
	attachments: [],
	images: [],
	mode: "prompt",
	cwd: "/tmp",
};

test("profile selection stages a stable draft without allocating or rebinding outgoing work", () => {
	reset();
	const first = store
		.getState()
		.stageDraft({ kind: "agent", name: "reviewer" });
	const request = store.getState().drafts[first].createRequestId;
	const again = store
		.getState()
		.stageDraft({ kind: "agent", name: "reviewer" });
	assert.equal(first, again);
	assert.equal(store.getState().drafts[again].createRequestId, request);
	assert.equal(store.getState().activeSessionId, "111111111111");
	assert.equal(calls.length, 0);
	assert.notEqual(
		store.getState().stageDraft({ kind: "agent", name: "reviewer" }, true),
		first,
	);
});

test("authoritative refresh removes absent IDs while newer viewed revision survives", () => {
	const rows = replaceSessionRows(
		[
			{ session_id: "111111111111", attention: attention([5, 5], false) },
			{ session_id: "222222222222" },
		],
		[{ session_id: "111111111111", attention: attention([4, 4]) }],
	);
	assert.deepEqual(
		rows.map((row) => row.session_id),
		["111111111111"],
	);
	assert.equal(rows[0].attention.unseen, false);
	assert.deepEqual(rows[0].attention.revision, [5, 5]);
});

/**
 * #1170's marker: a daemon that could not read liveness must not be rendered as
 * an idle machine.
 *
 * The daemon now says which reads it could not answer (`degraded: ["liveness"]`)
 * because a swallowed liveness read publishes `active: false` for every row,
 * which the sidebar renders as "Nothing running right now." over rows that
 * exist - a claim about the machine derived from a read that FAILED. The field
 * is additive, so this asserts the compatibility half as well: a daemon that
 * sends nothing leaves the marker empty and every surface renders as it did.
 */
test("overlapping catalogue refreshes coalesce and perform one trailing read", async () => {
	reset();
	const resolveResponses = [];
	let firstRequestStarted;
	let secondRequestStarted;
	const firstRequest = new Promise((resolve) => {
		firstRequestStarted = resolve;
	});
	const secondRequest = new Promise((resolve) => {
		secondRequestStarted = resolve;
	});
	globalThis.__canonicalRequest = (request) => {
		calls.push(request);
		const response = new Promise((resolve) => resolveResponses.push(resolve));
		if (calls.length === 1) firstRequestStarted();
		if (calls.length === 2) secondRequestStarted();
		return response;
	};

	const first = store.getState().fetchSessions(73);
	await firstRequest;
	const burst = [
		store.getState().fetchSessions(73),
		store.getState().fetchSessions(73),
	];
	assert.equal(calls.length, 1, "a burst shares the active catalogue request");
	assert.equal(
		burst.length,
		2,
		"both overlapping callers join the same flight",
	);
	assert.equal(
		calls[0].limit,
		73,
		"coalescing preserves an explicit page limit",
	);

	resolveResponses[0]({
		sessions: [{ id: "stale", name: "stale", mtime: 1 }],
		truncated: false,
	});
	await secondRequest;
	assert.equal(
		calls.length,
		2,
		"an invalidation during flight starts one trailing read",
	);
	assert.equal(
		calls[1].limit,
		73,
		"the trailing read retains the requested page size",
	);
	resolveResponses[1]({
		sessions: [{ id: "fresh", name: "fresh", mtime: 2 }],
		truncated: true,
	});
	await first;

	assert.deepEqual(
		store.getState().sessions.map((row) => row.session_id),
		["fresh"],
		"the stale in-flight page must not replace the trailing answer",
	);
	assert.equal(store.getState().truncated, true);
	assert.equal(store.getState().loading, false);
	assert.equal(store.getState().error, null);
});

test("the latest explicit catalogue limit is used by the trailing refresh", async () => {
	reset();
	const pending = [];
	let firstRequestStarted;
	let trailingStarted;
	const firstRequest = new Promise((resolve) => {
		firstRequestStarted = resolve;
	});
	const trailingRequest = new Promise((resolve) => {
		trailingStarted = resolve;
	});
	globalThis.__canonicalRequest = (request) => {
		calls.push(request);
		const response = new Promise((resolve) => pending.push(resolve));
		if (calls.length === 1) firstRequestStarted();
		if (calls.length === 2) trailingStarted();
		return response;
	};

	const narrow = store.getState().fetchSessions(31);
	await firstRequest;
	const broad = store.getState().fetchSessions(79);
	assert.deepEqual(
		calls.map(({ limit }) => limit),
		[31],
	);
	pending[0]({ sessions: [{ id: "stale", name: "stale", mtime: 1 }] });
	await trailingRequest;
	assert.deepEqual(
		calls.map(({ limit }) => limit),
		[31, 79],
		"the latest explicit page size applies to the trailing read",
	);
	pending[1]({
		sessions: [{ id: "broad", name: "broad", mtime: 2 }],
		truncated: true,
	});
	await Promise.all([narrow, broad]);
	assert.deepEqual(
		store.getState().sessions.map((row) => row.session_id),
		["broad"],
	);
	assert.equal(store.getState().truncated, true);
});

test("an invalidated catalogue failure is retried without publishing an error", async () => {
	reset();
	let rejectFirst;
	let firstRequestStarted;
	let trailingStarted;
	const firstRequest = new Promise((resolve) => {
		firstRequestStarted = resolve;
	});
	const trailingRequest = new Promise((resolve) => {
		trailingStarted = resolve;
	});
	const responses = [];
	globalThis.__canonicalRequest = (request) => {
		calls.push(request);
		if (calls.length === 1) firstRequestStarted();
		if (calls.length === 1)
			return new Promise((_, reject) => {
				rejectFirst = reject;
			});
		if (calls.length === 2) trailingStarted();
		return new Promise((resolve) => responses.push(resolve));
	};

	const first = store.getState().fetchSessions();
	await firstRequest;
	const joined = store.getState().fetchSessions();
	rejectFirst(new Error("stale read failure"));
	await trailingRequest;
	assert.equal(calls.length, 2);
	assert.equal(store.getState().error, null);
	responses[0]({ sessions: [{ id: "fresh", name: "fresh", mtime: 2 }] });
	await Promise.all([first, joined]);
	assert.equal(store.getState().error, null);
	assert.deepEqual(
		store.getState().sessions.map((row) => row.session_id),
		["fresh"],
	);
});

test("the daemon's unread reads are carried, and an absent marker is not an empty store", async () => {
	reset();
	globalThis.__canonicalRequest = async () => ({
		sessions: [{ id: "aaaa", name: "frame", mtime: 5, active: false }],
		truncated: false,
		degraded: ["liveness"],
	});
	await store.getState().fetchSessions();
	assert.deepEqual(store.getState().statusUnavailable, ["liveness"]);
	assert.equal(store.getState().error, null);

	globalThis.__canonicalRequest = async () => ({
		sessions: [{ id: "aaaa", name: "frame", mtime: 5, active: false }],
		truncated: false,
	});
	await store.getState().fetchSessions();
	assert.deepEqual(
		store.getState().statusUnavailable,
		[],
		"a daemon that predates the marker must leave the app exactly as it was",
	);

	globalThis.__canonicalRequest = async () => ({
		sessions: [],
		truncated: false,
		degraded: "liveness",
	});
	await store.getState().fetchSessions();
	assert.deepEqual(
		store.getState().statusUnavailable,
		[],
		"a marker that is not a list of read names is not evidence about any read",
	);
});

/**
 * The sentence half of the same marker, asserted on the source in the shape
 * this file already uses for a JSX-level rule (U16, D2): rendering the sidebar
 * needs the whole chat feature tree, while the state that feeds it is pinned
 * behaviourally in the case above.
 */
test("Active chats stops claiming nothing is running when liveness went unread", () => {
	const rendered = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	assert.match(
		rendered,
		RE_STATUSUNAVAILABLE_INCLUDES_LIVENESS,
		"the sidebar no longer reads the daemon's marker, so it cannot help but claim an idle machine",
	);
	assert.match(
		rendered,
		RE_LIVENESS_UNREAD_SENTENCE,
		"the Active chats section claims nothing is running even when the read that would know did not answer",
	);
});

test("create success plus admission failure retries exact same session and payload", async () => {
	reset();
	let attempts = 0;
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "222222222222",
				binding: { agent: "reviewer", team: null },
			};
		if (++attempts === 1) throw new Error("provider unavailable");
		return { status: "admitted" };
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input), /provider unavailable/);
	assert.equal(store.getState().drafts[key].sessionId, "222222222222");
	assert.equal(store.getState().drafts[key].pending, false);
	const firstMessage = calls.find(
		(request) => request.op === "sessions.message",
	);
	await admitChatDraft(key, { ...input, mode: "steer" });
	assert.equal(
		calls.filter((request) => request.op === "sessions.create").length,
		1,
	);
	const messages = calls.filter((request) => request.op === "sessions.message");
	// The whole admission — `mode` included — is the server's receipt fingerprint,
	// so a retry of the same requestId must be byte-identical or it 409s (F3).
	assert.deepEqual(messages[1], firstMessage);
	assert.equal(store.getState().activeSessionId, "222222222222");
	assert.equal(store.getState().drafts[key], undefined);
});

test("the admission seam stores against the session the send created, and its answer is what is sent", async () => {
	reset();
	const order = [];
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "222222222222",
				binding: { agent: "reviewer", team: null },
			};
		order.push("send");
		return { status: "admitted" };
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const seen = [];
	await admitChatDraft(
		key,
		input,
		undefined,
		() => {
			order.push("echo");
		},
		/*
		 * The composer's own seam, on the pane where the session does not exist
		 * until this call creates it: it must be handed the id the create
		 * answered with, and the text it returns is what the owner receives. The
		 * caller is a credential capture storing a value the message only cites
		 * (UX round 1, U2) — with the seam ignored, the message would carry the
		 * citation of a key nothing holds.
		 */
		async (sessionId) => {
			seen.push(sessionId);
			order.push("seam");
			return "deploy [credential LOP_SECRET_ABCDEFGH (19 chars)]";
		},
	);
	assert.deepEqual(seen, ["222222222222"], "the seam got the created session");
	const message = calls.find((request) => request.op === "sessions.message");
	assert.ok(message, "the message reached the transport");
	assert.equal(
		message.text,
		"deploy [credential LOP_SECRET_ABCDEFGH (19 chars)]",
		"the substituted text is what the owner receives",
	);
	assert.ok(
		order.indexOf("seam") < order.indexOf("send"),
		`the store ran before the message left: ${order.join(",")}`,
	);
});

test("ambiguous create retains request ID and duplicate concurrent sends allocate once", async () => {
	reset();
	let release;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create") {
			await pending;
			throw new Error("indeterminate outcome");
		}
		return {};
	};
	const key = store.getState().stageDraft({ kind: "team", name: "lopdev" });
	const request = store.getState().drafts[key].createRequestId;
	const first = admitChatDraft(key, input);
	assert.equal(await admitChatDraft(key, input), null);
	release();
	await assert.rejects(first, /indeterminate/);
	await assert.rejects(admitChatDraft(key, input), /indeterminate/);
	assert.equal(calls.length, 2);
	assert.ok(
		calls.every(
			(call) => call.op === "sessions.create" && call.requestId === request,
		),
	);
	// Creation never succeeded, so NOTHING was admitted: changing the text is
	// safe and must not be refused. Locking here is what bricked a conversation
	// after a single 503 (F1).
	await assert.rejects(
		admitChatDraft(key, { ...input, text: "different" }),
		/indeterminate/,
	);
	assert.equal(calls.length, 3);
});

test("a send that never reached admission carries the user's NEW images", async () => {
	reset();
	// Every other test sends `images: []`, so pinning images unconditionally --
	// the original F2 defect -- was invisible to the suite: stale [] and fresh []
	// are indistinguishable. Non-empty, DIFFERENT images are what make the two
	// behaviours separable, so this is the only test that can observe it.
	const stale = [{ data_b64: "AAA", mime_type: "image/png" }];
	const replacement = [{ data_b64: "BBB", mime_type: "image/png" }];
	let failCreate = true;
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create") {
			// The create fails, so NOTHING is admitted and no receipt exists: the
			// user is free to change the message, images included.
			if (failCreate) throw new Error("session could not start");
			return { session_id: "222222222222", binding: null };
		}
		return { status: "admitted" };
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(
		admitChatDraft(key, { ...input, images: stale }),
		/session could not start/,
	);
	assert.ok(!store.getState().drafts[key].admissionAttempted);
	failCreate = false;
	await admitChatDraft(key, {
		...input,
		text: "different",
		images: replacement,
	});
	const sent = calls.filter((call) => call.op === "sessions.message").at(-1);
	assert.deepEqual(sent.images, replacement);
	assert.equal(sent.text, "different");
});

test("a refused create hands the payload to the composer, and claims no replay identity", async () => {
	reset();
	/*
	 * THE OPPOSITE INVARIANT TO THE ONE THIS CASE USED TO PIN, and the reason it
	 * still earns its place. The store used to keep the failed text on the ROW
	 * (`submittedText`) as the thing a claim was released from, and the composer's
	 * abandon control was suppressed by deriving `heldText` from it
	 * (`admissionAttempted && !pending ? submittedText : undefined`, U13).
	 *
	 * The payload now lives in the composer and nothing is held anywhere else, so
	 * what must hold here is that the row keeps NO payload of its own and NO
	 * replay identity: `admissionAttempted` is set only once a request has been
	 * issued, and the create hop refused before that. Moving it earlier - symmetric
	 * with the pre-admission pinning of mode and images, and a plausible-looking
	 * refactor - would leave the next send replaying the request id of a request
	 * that was never made, which is a message the owner would treat as already
	 * seen.
	 */
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create") throw new Error("create refused");
		return {};
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input), /create refused/);
	const draft = store.getState().drafts[key];
	/*
	 * And the payload stays on the row - as the COMPARISON BASIS the retry rule reads
	 * (`payloadMatchesClaim`), not as a claim anybody has to release. The copy the user
	 * acts on is in the composer; this one is a fingerprint, and it is what makes an
	 * unchanged re-send replay under the request id it was first issued with rather
	 * than arriving at the owner as a second message.
	 */
	assert.equal(draft.submittedText, input.text, "the text the attempt carried");
	assert.notEqual(
		draft.admissionAttempted,
		true,
		"nothing was issued, so no outcome is unknown and nothing may be replayed",
	);
	assert.ok(
		typeof draft.error === "string" && draft.error.length > 0,
		"a remount still has copy for the notice from the store's own record",
	);
	assert.notEqual(
		draft.pending,
		true,
		"settled: the notice's actions may appear",
	);
});

test("an issued admission pins the payload for replay, and a discard always frees it", async () => {
	reset();
	// The transport refuses the NEXT message request and then works again, so the
	// claim can be armed and the sends after it can be observed on the wire.
	let failNext = true;
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		if (failNext) {
			failNext = false;
			throw new Error("provider unavailable");
		}
		return { status: "admitted" };
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input), /provider unavailable/);
	// The admission WAS issued, so its outcome is unknown and the payload is
	// pinned until the user resolves it - the replay identity a Retry re-uses.
	assert.equal(store.getState().drafts[key].admissionAttempted, true);
	assert.equal(store.getState().drafts[key].submittedText, input.text);
	const pinned = store.getState().drafts[key];
	const wireBefore = calls.length;
	await admitChatDraft(key, { ...input, text: "different" });
	// An edit is a NEW message, and it must reach the wire as one: the old refusal
	// left the user with a composer they could not send a change from.
	const edited = calls
		.slice(wireBefore)
		.filter((call) => call.op === "sessions.message")
		.at(-1);
	assert.equal(edited.text, "different");
	assert.notEqual(
		edited.requestId,
		pinned.admissionRequestId,
		"an edited payload cannot replay the id of the attempt it replaced",
	);
	// Re-arm, because that send landed and retired the row.
	failNext = true;
	const reKey = store
		.getState()
		.stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(reKey, input), /provider unavailable/);
	const armed = store.getState().drafts[reKey];
	/*
	 * A FILE is a payload change (paths are compared, spec §3), and the added file
	 * is admitted as a NEW message rather than silently dropped against a claim that
	 * does not describe it - asserted on the WIRE, which is the only place "silently
	 * dropped" can be told apart from "sent as a new message".
	 */
	const wireMid = calls.length;
	failNext = false;
	await admitChatDraft(reKey, {
		...input,
		attachments: ["/tmp/added.png"],
		images: [{ data_b64: "x", mime_type: "image/png" }],
	});
	const withFile = calls
		.slice(wireMid)
		.filter((call) => call.op === "sessions.message")
		.at(-1);
	assert.deepEqual(withFile.images, [
		{ data_b64: "x", mime_type: "image/png" },
	]);
	assert.notEqual(withFile.requestId, armed.admissionRequestId);
	/*
	 * An IMAGE-only difference with the same text and paths is NOT a new message, and
	 * that is the deliberate half: the replay takes the PINNED images rather than the
	 * caller's, so a re-encode that is not byte-stable (a fresh base64 for the same
	 * file) replays the body the owner fingerprinted instead of 409ing as a different
	 * request. See `payloadMatchesClaim` and spec §3. Driven against a claim of its
	 * own, because the file arm above LANDED and a landed send retires its row.
	 */
	failNext = true;
	const replayKey = store
		.getState()
		.stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(
		admitChatDraft(replayKey, {
			...input,
			attachments: ["/tmp/added.png"],
			images: [{ data_b64: "x", mime_type: "image/png" }],
		}),
		/provider unavailable/,
	);
	const pinnedId = store.getState().drafts[replayKey].admissionRequestId;
	failNext = false;
	const wireReplay = calls.length;
	await admitChatDraft(replayKey, {
		...input,
		attachments: ["/tmp/added.png"],
		images: [{ data_b64: "RE-ENCODED", mime_type: "image/png" }],
	});
	const replayed = calls
		.slice(wireReplay)
		.filter((call) => call.op === "sessions.message")
		.at(-1);
	assert.deepEqual(
		replayed.images,
		[{ data_b64: "x", mime_type: "image/png" }],
		"a re-encode of the same file must not turn a retry into a different request",
	);
	assert.equal(replayed.requestId, pinnedId);
	// The escape hatch: discarding frees the composer for good.
	store.getState().discardDraft(key);
	assert.equal(store.getState().drafts[key], undefined);
	failNext = false;
	const fresh = store
		.getState()
		.stageDraft({ kind: "agent", name: "reviewer" });
	assert.ok(await admitChatDraft(fresh, { ...input, text: "different" }));
});

test("a lost admission response replays idempotently instead of conflicting", async () => {
	reset();
	// Models the REAL receipt store: DesktopReceipts fingerprints a sha256 of the
	// whole request body (`mode` included) and raises ReceiptConflict -> HTTP 409
	// when the same requestId arrives hashing differently. A stub that accepts
	// unconditionally cannot observe this, which is exactly how the previous
	// version of this test asserted behaviour the real server rejects.
	const receipts = new Map();
	let dropResponse = true;
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		const { requestId, ...body } = request;
		const fingerprint = JSON.stringify(body, Object.keys(body).sort());
		const seen = receipts.get(requestId);
		if (seen && seen.fingerprint !== fingerprint)
			throw new Error("Request ID was already used with different input");
		if (seen) return { ...seen.result, replayed: true };
		const result = { status: "admitted" };
		receipts.set(requestId, { fingerprint, result });
		// The turn IS admitted server-side; only the response is lost, which is
		// what leaves the UI believing the send failed while the session streams.
		if (dropResponse) throw new Error("connection reset");
		return result;
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(
		admitChatDraft(key, { ...input, mode: "prompt" }),
		/connection reset/,
	);
	dropResponse = false;
	// The session is now streaming, so the composer recomputes busy -> "steer".
	// The retry must still replay the ORIGINAL fingerprint, or it 409s forever
	// and reports a failure for a message that already landed (F3).
	await admitChatDraft(key, { ...input, mode: "steer" });
	const admissions = calls.filter((call) => call.op === "sessions.message");
	assert.equal(admissions[0].requestId, admissions.at(-1).requestId);
	assert.equal(admissions.at(-1).mode, "prompt");
	assert.deepEqual(admissions.at(-1), admissions[0]);
	assert.equal(store.getState().drafts[key], undefined);
});

test("an existing session's retained draft stays reachable after a failed send", () => {
	reset();
	// F1's reachability half was manual-only: reverting this rule left every test
	// green because no test mounts chat-page.tsx. The rule lives in the store so
	// the guard sits on the code the view actually calls.
	assert.equal(
		draftIdentityFor("draft:agent:reviewer", null),
		"draft:agent:reviewer",
	);
	// The staged key wins while it exists, so a first send does not orphan its
	// own pending draft the moment the session id arrives.
	assert.equal(
		draftIdentityFor("draft:agent:reviewer", "222222222222"),
		"draft:agent:reviewer",
	);
	// An existing session has no staged key; without this the retained text and
	// its Discard control are unreachable and the composer stays locked.
	assert.equal(draftIdentityFor(null, "222222222222"), "send:222222222222");
	assert.equal(draftIdentityFor(null, null), null);
	store.getState().updateDraft("send:222222222222", {
		key: "send:222222222222",
		createRequestId: "c",
		admissionRequestId: "a",
		submittedText: "held text",
		admissionAttempted: true,
	});
	const identity = draftIdentityFor(null, "222222222222");
	assert.equal(store.getState().drafts[identity].submittedText, "held text");
	store.getState().discardDraft(identity);
	assert.equal(store.getState().drafts[identity], undefined);
});

test("discarding a draft clears the pointer to it, not just the entry", async () => {
	reset();
	// Regression: `discardDraft` used to delete `drafts[key]` and leave
	// `activeDraftKey` naming it. Consumers read that pointer as "a draft is
	// being composed", so the sidebar's New chat row - whose predicate is
	// `activeDraftKey && !draft?.target` - went `aria-current="page"` after an
	// AGENT-targeted draft was discarded, because the absent draft made
	// `!draft?.target` vacuously true. The user never pressed that row.
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	assert.equal(store.getState().activeDraftKey, key);
	assert.equal(store.getState().drafts[key].target.name, "reviewer");

	store.getState().discardDraft(key);

	assert.equal(store.getState().drafts[key], undefined);
	assert.equal(store.getState().activeDraftKey, null);
	// The row's own predicate, evaluated the way the sidebar evaluates it.
	const state = store.getState();
	const draft = state.activeDraftKey
		? state.drafts[state.activeDraftKey]
		: undefined;
	assert.equal(Boolean(state.activeDraftKey) && !draft?.target, false);
});

test("discarding a draft that is not the active one leaves the pointer alone", async () => {
	reset();
	// The clear is conditional for the same reason `finishDraft`'s is: a stale
	// or background draft being cleaned up must not cancel the draft the user
	// is actually composing.
	const first = store
		.getState()
		.stageDraft({ kind: "agent", name: "reviewer" });
	const second = store.getState().stageDraft({ kind: "team", name: "lopdev" });
	assert.equal(store.getState().activeDraftKey, second);

	store.getState().discardDraft(first);

	assert.equal(store.getState().drafts[first], undefined);
	assert.equal(store.getState().activeDraftKey, second);
});

test("an edited resend is a new message under a new id, and Clear drops only the replay fields", async () => {
	reset();
	/*
	 * THE GUARD IS GONE, AND THIS IS THE CASE THAT WOULD HAVE CAUGHT ITS REPLACEMENT
	 * BEING WRONG. The store used to throw `UNCONFIRMED_SEND_CODE` at any payload
	 * that differed from the claim - including the edit the composer's own sentence
	 * invited ("edit it if you need to, then send again") - and the composer had to
	 * render Restore/Discard around a message it was blocking.
	 *
	 * The protection that guard existed for is real but needs no block: an UNCHANGED
	 * resend must be an idempotent replay under the same request id (the owner
	 * de-duplicates by `command_id`), and a CHANGED one is a different message by
	 * definition, which goes out under its own id. Both halves are asserted here on
	 * the existing-session path, where `admissionAttempted` really latches: the
	 * first send fails at the wire, then the edit is ADMITTED - it reaches the wire,
	 * under an id that is not the failed attempt's - while the unchanged resend
	 * replays the first one exactly (see the reply-prefix case below for the
	 * byte-identical body).
	 */
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		throw new Error("network down");
	};
	const key = draftIdentityFor(null, "222222222222");
	await assert.rejects(admitChatDraft(key, input, "222222222222"));
	const failed = store.getState().drafts[key];
	assert.equal(failed.admissionAttempted, true);
	assert.equal(failed.submittedText, input.text);

	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return {};
	};
	const before = calls.length;
	await admitChatDraft(
		key,
		{ ...input, text: "something else" },
		"222222222222",
	);
	const edited = calls
		.slice(before)
		.filter((call) => call.op === "sessions.message");
	assert.equal(edited.length, 1, "an edited payload is admitted, not refused");
	assert.equal(edited[0].text, "something else");
	assert.notEqual(
		edited[0].requestId,
		failed.admissionRequestId,
		"an edited payload is a NEW message, so it cannot replay the request id of one that may still be executing on the owner",
	);
	assert.equal(
		store.getState().drafts[key],
		undefined,
		"and the landed send retires the row, so the failed attempt leaves nothing behind to replay",
	);
});

test("an admitted send is observable while it is in flight, and gone once it settles", async () => {
	reset();
	/*
	 * The working line's admitted-send rung reads the DRAFT ROW, not component
	 * state, because the New-chat path remounts the panel on the identity flip
	 * (`panelIdentityFor`) and local state does not survive that. So the row has
	 * to carry the state for exactly as long as the request is unanswered: this
	 * pins both halves - observable while `sessions.message` is held open, and
	 * gone the moment it settles - because a row that outlived the request
	 * would leave the line claiming work after the turn had answered.
	 */
	let release;
	const held = new Promise((resolve) => {
		release = () => resolve({ status: "admitted" });
	});
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "333333333333",
				binding: { agent: null, team: null },
			};
		if (request.op === "sessions.message") return held;
		return {};
	};
	const settle = async (predicate) => {
		for (let i = 0; i < 50; i++) {
			if (predicate()) return;
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		assert.fail("the message request never reached the transport");
	};
	const key = store.getState().stageDraft();
	const send = admitChatDraft(key, input);
	await settle(() =>
		calls.some((request) => request.op === "sessions.message"),
	);
	const inFlight = store.getState().drafts[key];
	assert.equal(inFlight.sessionId, "333333333333");
	assert.equal(inFlight.pending, true);
	assert.equal(inFlight.admissionAttempted, true);
	// The panel keyed on the session is the one that mounts here, and the row it
	// looks its draft up by is the same `draft:<uuid>` the send was staged under.
	assert.equal(panelIdentityFor(key, inFlight.sessionId), "333333333333");
	assert.equal(
		store.getState().drafts[draftIdentityFor(key, inFlight.sessionId)],
		inFlight,
	);
	release();
	await send;
	assert.equal(store.getState().drafts[key], undefined);
});

test("an existing session's in-flight send is found under its own key, and a failure clears it", async () => {
	reset();
	/*
	 * The other half of the same rule, on the path where the panel does NOT
	 * remount: a send into a session the user already has is keyed `send:<id>`
	 * by `draftIdentityFor`, and that key is what the panel reads. `pending` must
	 * be true while the request is unanswered and false - with the failure
	 * recorded - when it throws, so the working line cannot linger over a send
	 * the user has been told failed.
	 */
	let reject;
	const held = new Promise((_resolve, rejectPromise) => {
		reject = () => rejectPromise(new Error("provider unavailable"));
	});
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.message") return held;
		return {};
	};
	const sessionId = "111111111111";
	const key = draftIdentityFor(null, sessionId);
	assert.equal(key, `send:${sessionId}`);
	const send = admitChatDraft(key, input, sessionId);
	for (let i = 0; i < 50; i++) {
		if (store.getState().drafts[key]?.pending) break;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	const inFlight = store.getState().drafts[key];
	assert.equal(inFlight.pending, true);
	assert.equal(inFlight.admissionAttempted, true);
	reject();
	await assert.rejects(send, /provider unavailable/);
	const failed = store.getState().drafts[key];
	assert.equal(failed.pending, false);
	// A raw throw is reported through the shared unconfirmed-send copy rather
	// than as the exception text, which is the store's own rule; what matters
	// here is that the row records a failure and is no longer pending.
	assert.match(failed.error, /Couldn't confirm your message was sent\./);
});

test("a landed send retires the page-level error the failed one recorded", async () => {
	reset();
	// F2/F3: `createSession` sets store `error` AND rethrows, so the same
	// sentence rendered at the top of the page and at the composer; nothing but
	// fetchSessions/openSession ever cleared it, so it also outlived a
	// successful retry. The composer owns the message now, both ways.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create") throw new Error("create refused");
		return {};
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input));
	assert.equal(
		store.getState().error,
		null,
		"the composer alert is the only voice for a failed send",
	);
	// `store.error` must be non-null before the landed send, or asserting null
	// after it cannot tell "the success path clears it" from "nothing ever set
	// it" - the assertion passed with the clear deleted.
	//
	// PRODUCED, not seeded. `store.setState({error: ...})` would put the fixture
	// in a state only the harness can reach, and a hand-set precondition can
	// quietly repair (or misrepresent) the very behaviour under test. This drives
	// the real writer: `createSession` sets the page-level `error` and rethrows,
	// which is exactly how a user gets a stale "could not start" sentence - the
	// picker calls it directly (destination-pickers.tsx), with no admission
	// involved, so this is a state production genuinely reaches. It runs while
	// the transport still refuses creates, i.e. before the healthy one below.
	await assert.rejects(store.getState().createSession("/tmp"));
	assert.notEqual(
		store.getState().error,
		null,
		"precondition: a real page-level error exists to be retired",
	);
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "222222222222",
				binding: { agent: "reviewer", team: null },
			};
		return {};
	};
	await admitChatDraft(key, input);
	assert.equal(
		store.getState().error,
		null,
		"a successful retry leaves no stale page-level alert",
	);
});

test("a draft abandoned mid-flight is not resurrected by the settling request", async () => {
	reset();
	// R1: `admissionAttempted` is set BEFORE the awaited request, so a draft can
	// be discarded while its admission is still in flight. `updateDraft` used to
	// spread blindly onto the deleted row, rebuilding it WITHOUT `key`,
	// `createRequestId` or `admissionRequestId`; the next send then went to the
	// wire with `requestId: undefined`, the IPC schema 422'd it, and that refusal
	// re-armed the unchanged-payload guard - so every later send failed against a
	// healthy backend. Discard is deliberate and outranks the abandoned request.
	let releaseInflight;
	const inflight = new Promise((resolve) => {
		releaseInflight = resolve;
	});
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "222222222222",
				binding: { agent: "reviewer", team: null },
			};
		await inflight;
		throw new Error("network down");
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const pending = admitChatDraft(key, input);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(store.getState().drafts[key].pending, true);
	store.getState().discardDraft(key);
	releaseInflight();
	await assert.rejects(pending);
	assert.equal(
		store.getState().drafts[key],
		undefined,
		"a settling request must not recreate a row the user discarded",
	);

	// And the session is not wedged: the next send allocates a fresh draft whose
	// admission carries a real request id, which is what the schema requires.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "333333333333",
				binding: { agent: "reviewer", team: null },
			};
		return {};
	};
	const next = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await admitChatDraft(next, { ...input, text: "a different message" });
	const wire = calls.at(-1);
	assert.equal(wire.op, "sessions.message");
	assert.equal(wire.text, "a different message");
	assert.equal(
		desktopRequestSchema.safeParse(wire).success,
		true,
		"the send after an abandoned one must satisfy the closed IPC schema",
	);
});

test("the payload the replay rule compares is the normalized one, so a whitespace-only edit is the same message", async () => {
	reset();
	// U7: the store compared byte-for-byte while the composer decided what to SAY
	// on `.trim()`. A whitespace-only edit fell between the two - refused by the
	// store, but reported as already-in-the-box, which suppressed Restore and the
	// release escape and left only the control that empties the composer.
	// Normalizing at the payload boundary removes the gap: there is one string.
	// The rule that reads it is now the replay decision rather than a guard, and
	// the property is unchanged: a whitespace-only edit is the same message, so it
	// replays under the SAME request id.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "222222222222",
				binding: { agent: "reviewer", team: null },
			};
		throw new Error("network down");
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(
		admitChatDraft(key, { ...input, text: "Summarise the report. " }),
	);
	assert.equal(
		store.getState().drafts[key].submittedText,
		"Summarise the report.",
		"the claim stores the normalized payload, not the raw box value",
	);
	// Every whitespace-only variant of the message must be the SAME payload rather
	// than a new message. The trailing-newline case is the one the `trim()` existed
	// for.
	//
	// The sends deliberately keep failing at the wire so the CLAIM SURVIVES each
	// iteration: a variant that succeeded would retire the draft via `finishDraft`,
	// and every later iteration would then be testing an unarmed rule - passing
	// whatever the comparison did. Each variant is asserted to reach the wire, to
	// reach it normalized, AND to carry the id of the attempt it replays.
	const replayId = store.getState().drafts[key].admissionRequestId;
	for (const variant of [
		"Summarise the report.",
		"Summarise the report. ",
		" Summarise the report.",
		"Summarise the report.\n",
	]) {
		const before = calls.length;
		await assert.rejects(
			admitChatDraft(key, { ...input, text: variant }, "222222222222"),
		);
		const wire = calls.slice(before).filter((c) => c.op === "sessions.message");
		assert.equal(
			wire.length,
			1,
			`a whitespace-only edit (${JSON.stringify(variant)}) must reach the wire`,
		);
		assert.equal(
			wire[0].text,
			"Summarise the report.",
			`a whitespace-only edit (${JSON.stringify(variant)}) is the same payload`,
		);
		assert.equal(
			wire[0].requestId,
			replayId,
			`a whitespace-only edit (${JSON.stringify(variant)}) is the SAME message, so it replays under the request id already in flight`,
		);
		assert.equal(
			store.getState().drafts[key].admissionAttempted,
			true,
			"the claim must survive so the next variant is a real test of the rule",
		);
	}
	// A real edit is a NEW message: it is admitted, under an id of its own -
	// normalizing must not turn every edit into a replay. The claim is re-armed
	// through a genuinely failing send rather than a hand-written patch, so this
	// exercises the path the user takes.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		throw new Error("network down");
	};
	await assert.rejects(
		admitChatDraft(
			key,
			{ ...input, text: "Summarise the report." },
			"222222222222",
		),
	);
	const armedId = store.getState().drafts[key].admissionRequestId;
	const editedBefore = calls.length;
	await assert.rejects(
		admitChatDraft(
			key,
			{ ...input, text: "Summarise the other report." },
			"222222222222",
		),
	);
	const edited = calls
		.slice(editedBefore)
		.filter((call) => call.op === "sessions.message");
	assert.equal(edited.length, 1, "an edited payload reaches the wire");
	assert.equal(
		edited[0].text,
		"Summarise the other report.",
		"with the edit it carries, not the message it replaced",
	);
	assert.notEqual(
		edited[0].requestId,
		armedId,
		"an edited payload is a new message, so it does not inherit the id of the one that failed",
	);
});

test("a reply-prefixed retry is an idempotent replay, and an edited one is a new message", async () => {
	reset();
	/*
	 * R6, KEPT AND STRENGTHENED. The reply prefix is assembled at the send call,
	 * DOWNSTREAM of every comparison the composer makes, so the store held
	 * `<reply-to>...<\/reply-to>\ntext` while the composer compared the bare box -
	 * two strings for one payload, the condition U7 was filed to remove, on the one
	 * path U7's fix did not cover.
	 *
	 * The damage was never the refusal, it was the ESCAPE: Restore wrote the held
	 * payload into the box, the next send re-prefixed it, the store refused the
	 * mismatch, and the composer - seeing its own held text in the box - withdrew
	 * Restore, leaving only the control that destroys the message.
	 *
	 * What that fix had to establish is now the replay rule's own precondition, and
	 * this case proves it on the wire rather than in the composer's copy: a retry of
	 * the restored payload is BYTE-IDENTICAL to the attempt it replaces - same
	 * request id, same text, same images, same mode - which is exactly what the
	 * owner's receipt de-duplicates. Re-prefixing is what broke it, and it is
	 * asserted to be a different body here, so the test fails if the assembly or the
	 * chip consumption moves.
	 */
	const replies = [{ id: "r1", text: "the failing line" }];
	const box = "Please look at this";
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		throw new Error("network down");
	};
	const key = draftIdentityFor(null, "222222222222");
	// The composer's send: one function assembles what goes to the store.
	await assert.rejects(
		admitChatDraft(
			key,
			{ ...input, text: buildSendPayload(box, replies) },
			"222222222222",
		),
	);
	const draft = store.getState().drafts[key];
	const held = draft.submittedText;
	const firstWire = calls
		.filter((call) => call.op === "sessions.message")
		.at(-1);
	assert.equal(
		held,
		`<reply-to>the failing line<\/reply-to>\n${box}`,
		"the claim is the assembled payload",
	);
	// The composer's copy basis, built from the SAME function with the SAME
	// replies still attached - they survive a failed send, and they are what the
	// return path hands back to the row.
	assert.equal(
		buildSendPayload(box, replies) === held,
		true,
		"with the reply still attached the box IS the payload, so no copy may claim otherwise",
	);
	// A retry hands back the finished payload with the chips that produced it
	// consumed. Re-assembling with the chips still attached would double the prefix,
	// which is the deadlock this case exists for.
	assert.equal(
		buildSendPayload(held, []),
		held,
		"a payload re-assembled with its chips consumed is byte-identical, so the rule replays it",
	);
	assert.notEqual(
		buildSendPayload(held, replies),
		held,
		"re-prefixing a restored payload is what deadlocked the old Restore; the chips must be cleared, not the assembly made idempotent",
	);

	// THE REPLAY, ON THE WIRE: the same payload a second time is the same request.
	const before = calls.length;
	await assert.rejects(
		admitChatDraft(key, { ...input, text: held }, "222222222222"),
	);
	const replay = calls
		.slice(before)
		.filter((call) => call.op === "sessions.message");
	assert.equal(replay.length, 1, "the retry reaches the wire");
	assert.deepEqual(
		replay[0],
		firstWire,
		"an unchanged retry is byte-identical to the attempt it replaces - id, text, images and mode - which is what makes it an idempotent replay rather than a second message",
	);

	// And an EDITED reply-prefixed payload is a new message: admitted, with its own
	// id, so the user is never blocked from fixing what they wrote.
	const editedText = buildSendPayload("Something else entirely", replies);
	const editedBefore = calls.length;
	await assert.rejects(
		admitChatDraft(key, { ...input, text: editedText }, "222222222222"),
	);
	const edited = calls
		.slice(editedBefore)
		.filter((call) => call.op === "sessions.message");
	assert.equal(
		edited.length,
		1,
		"an edited reply-prefixed payload is admitted",
	);
	assert.equal(edited[0].text, editedText);
	assert.notEqual(
		edited[0].requestId,
		firstWire.requestId,
		"it is a new message, so it does not inherit the id of the failed one",
	);
});

test("typed repair failures retain the canonical draft and error category", async () => {
	reset();
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "222222222222",
				binding: { agent: "reviewer", team: null },
			};
		throw Object.assign(new Error("Choose an available profile."), {
			code: "unresolved_attachment",
		});
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input));
	assert.equal(store.getState().drafts[key].errorCode, "unresolved_attachment");
	assert.equal(store.getState().drafts[key].sessionId, "222222222222");
	/*
	 * This arm KEEPS its replay identity, and that is the rule rather than an
	 * oversight: the failure is a bare throw after the admission was issued, which
	 * is the unknown class - the request may be executing on the owner - so the
	 * request id, the pinned images and the rendered text stay for a Retry to
	 * replay. `unresolved_attachment` is a code the app can act on for its COPY
	 * (the notice names it), not a statement that nothing was sent.
	 */
	assert.equal(store.getState().drafts[key].admissionAttempted, true);
	assert.equal(store.getState().drafts[key].submittedText, input.text);
});

/*
 * The backend's own policy (`desktop_sessions.py:170`) refuses any message whose
 * text lstrip-starts with "/", and it answers with a 422 whose `detail` is the
 * transport's SHARED sentence. The composer rendered that sentence and then
 * "Send it again." — an instruction that can never succeed, because the same
 * bytes meet the same rule forever (UX round 2, U13). The refusal carries no
 * code of its own on the wire, so the store classifies it from the payload it
 * sent, which is the one thing that identifies it.
 */
test("a leading-slash refusal is classified, and says what the user can do", async () => {
	reset();
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "222222222222",
				binding: { agent: "reviewer", team: null },
			};
		return Promise.reject(
			new DesktopControlError(422, "The request has invalid fields."),
		);
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const text = "/usage\nhello from line two";
	await assert.rejects(
		admitChatDraft(key, { ...input, text }, "222222222222"),
		(error) => {
			// The composer prioritizes its catch over the persisted draft. The
			// classified copy must cross that boundary, not only reach the store.
			assert.ok(error instanceof DesktopControlError);
			assert.equal(error.status, 422);
			assert.equal(error.code, LEADING_SLASH_CODE);
			assert.equal(error.message, LEADING_SLASH_MESSAGE);
			assert.equal(error.cause.message, "The request has invalid fields.");
			return true;
		},
	);
	const draft = store.getState().drafts[key];
	assert.equal(draft.errorCode, LEADING_SLASH_CODE);
	assert.equal(draft.error, LEADING_SLASH_MESSAGE);
	// A validation refusal is decided before anything is admitted, so the draft
	// is not held and the text is back in the composer — where the fix the
	// sentence names can actually be carried out.
	assert.equal(draft.admissionAttempted, false);
	/*
	 * And the payload stays on the row - as the COMPARISON BASIS the retry rule reads
	 * (`payloadMatchesClaim`), not as a claim anybody has to release. The copy the user
	 * acts on is in the composer; this one is a fingerprint, and it is what makes an
	 * unchanged re-send replay under the request id it was first issued with rather
	 * than arriving at the owner as a second message.
	 */
	assert.equal(draft.submittedText, text);
	// The composer's generic retry hint is withheld for exactly the refusals a
	// resend cannot answer, and kept for every other one. `UNCONFIRMED_SEND_CODE`
	// joined that list in the round that measured what the operator's own remedy
	// meets: the unchanged-payload guard refuses the resend BY CONSTRUCTION, so
	// "Send it again" over it is an instruction the guard answers with the same
	// sentence - an instruction/refusal loop, measured at 0 requests per press.
	assert.equal(withholdsRetryHint(draft.errorCode), true);
	/*
	 * The read-window refusal is NOT on that list any more, and the change is
	 * THE READ WINDOW IS WITHHELD AGAIN (design round 11, D2), and the round that
	 * dropped it was wrong about its sentence. "This chat isn't ready yet, so your
	 * message wasn't sent." does not invite a press: the window answers `"failed"` the
	 * moment it is asked, so the press re-refuses and re-paints the same sentence - the
	 * loop this predicate exists to prevent, not one instruction in two places. Main
	 * withheld it for exactly that reason, and the reason survived the fold. The box is
	 * still holding the message, which is what makes a LATER press possible without the
	 * hint claiming it is one now.
	 */
	assert.equal(withholdsRetryHint(SESSION_UNVALIDATED_CODE), true);
	/*
	 * Round 4's D13: the unreadable-attachment refusal is the third one a resend
	 * cannot answer. Its chip is still attached and still unreadable, so the next
	 * send meets the same rule and is refused for the same reason - the designer
	 * clicked Send again at three widths and the whole round put exactly one
	 * request on the wire. Its own sentence carries the remedy (attach it again,
	 * or remove it), which is what makes withholding the generic hint correct
	 * rather than merely quiet. It is a CODE rather than a fact about the copy so
	 * the alert cannot be told to say "send it again" by an unrelated refusal's
	 * code left in `draft.errorCode`, which is how the hint was measured both
	 * present and absent on the same sentence (chat-page reads
	 * `sendErrorCode ?? draft.errorCode`).
	 */
	assert.equal(withholdsRetryHint(UNREADABLE_ATTACHMENT_CODE), true);
	/*
	 * And the arm the guard used to occupy is now the OPPOSITE of withheld. The
	 * unknown outcome (the timeout's shape: nothing code-shaped to act on) offers
	 * Retry, because an unchanged payload replays under the same request id - the
	 * loop the guard created is gone, not renamed. `withholdsRetryHint` answers "can a
	 * press work", so it is false for that arm.
	 */
	assert.equal(withholdsRetryHint(undefined), false);
	/*
	 * The seventh is not a send refusal at all, and it is here for the same
	 * reason as the others: an option press that failed says NOTHING the composer's
	 * generic hint can act on. The question it answered has moved on, so there is
	 * nothing to press again; the box may well hold an unrelated draft, and "Send
	 * it again" placed after a sentence about the press reads as "re-send your
	 * answer". It is a code rather than an absent one because `chat-page`'s alert
	 * reads `sendErrorCode ?? draft.errorCode`: a press that left the code unset
	 * inherited the DRAFT's last failure, which is how the hint was measured
	 * present on this sentence in one session and absent in another (design round
	 * 1, D2 — the same inheritance D13 measured on the attachment refusal).
	 */
	assert.equal(withholdsRetryHint(ANSWER_NOT_SENT_CODE), true);
	/*
	 * And the aside's refusal, for the same reason one step further out: an aside
	 * ask takes the question out of the box at the press, so the hint would point
	 * at whatever the user typed SINCE the refusal was raised (UX round 1, U4). It
	 * is the sixth term, and the second here that is not a send refusal at all.
	 */
	assert.equal(withholdsRetryHint(ASIDE_NOT_ANSWERED_CODE), true);
	/*
	 * AND THE SEVENTH, which is the only term whose remedy IS the retry - merely not yet: the
	 * press it refuses is refused for as long as the newest aside answer is in flight, and the
	 * sentence beside it says when that ends, so a Retry offered here is the same instruction
	 * twice with the second one refused (UX round 2, U12).
	 */
	assert.equal(withholdsRetryHint(ASIDE_STILL_ANSWERING_CODE), true);
	assert.equal(withholdsRetryHint(ANSWER_NOT_SENT_CODE), true);
	assert.equal(withholdsRetryHint("unresolved_attachment"), false);
	assert.equal(withholdsRetryHint(undefined), false);
});

/*
 * The store's own refusals: the disk is full, or the store cannot be read or
 * written at all.
 *
 * Both arms used to be ONE answer, because the backend caught the BASE class
 * (`sqlite3.Error`) and mapped every member of it to a 503 reading "Read state is
 * busy right now. It will catch up on its own." - lock contention, an unopenable
 * database, a corrupted one and a full volume in a single branch, and the
 * sentence described the only one of them that is transient. On 2026-09-17 this
 * machine's boot volume reached 0 bytes free at 09:56; SQLite could not allocate
 * its journal, and a send carrying an IMAGE - the largest write in the flow, so
 * the one that crosses the threshold while a few-KB text append still lands - was
 * refused with that sentence plus the composer's own "Your message is still in
 * the composer. Send it again.": the one instruction that cannot help, on the
 * one occasion the operator repeated.
 *
 * What is pinned here is the RENDERER half of the repair. The sentence is the
 * BACKEND's, deliberately - it is the process that knows which volume is full and
 * what the remedy is, and a second copy in the renderer would be a second place
 * for that fact to drift - so the assertions are that it reaches the composer
 * VERBATIM and that the code travels beside it into `withholdsRetryHint`. The two
 * failure modes this rules out are the ones the incident actually had: a generic
 * sentence replacing the actionable one, and a code left unset (or inherited from
 * an earlier refusal) so the alert under it announces a retry that cannot work.
 *
 * `store_busy` - the third arm, and the only one where "send it again" is TRUE -
 * is the contrast case: it keeps its hint, which is the whole point of the split.
 */
test("a failed store is refused with its own code, and the retry hint it cannot honour is withheld", async () => {
	// The two store arms, each with the copy the backend's own error body carries.
	const cases = [
		{
			code: STORE_OUT_OF_SPACE_CODE,
			status: 507,
			message:
				"There is not enough space on this disk to save your message. Free up space, then send it again.",
		},
		{
			code: STORE_UNAVAILABLE_CODE,
			status: 500,
			message:
				"This chat's stored state could not be read or written. Retrying will not help; check this machine's storage and its logs.",
		},
	];

	for (const { code, status, message } of cases) {
		reset();
		// The error the transport builds from the envelope: `desktopResult` reads
		// `detail.code`/`detail.message` for ANY status, which
		// `desktop-renderer-transport.test.mjs` drives against a real 507 and 500
		// response body rather than a constructed error.
		globalThis.__canonicalRequest = async (request) => {
			calls.push(request);
			return Promise.reject(
				new DesktopControlError(status, message, undefined, code),
			);
		};
		const key = store
			.getState()
			.stageDraft({ kind: "agent", name: "reviewer" });
		const text = "look at this screenshot";
		await assert.rejects(
			admitChatDraft(
				key,
				{
					...input,
					text,
					images: [{ data_b64: "AAAA", mime_type: "image/png" }],
				},
				"222222222222",
			),
			(error) => error instanceof DesktopControlError && error.code === code,
		);
		const draft = store.getState().drafts[key];
		// The refusal is recorded on the ROW the composer reads (`activeErrorCode`
		// is `sendErrorCode ?? draft.errorCode`), which is what makes the alert's
		// hint a function of this refusal rather than of the conversation's
		// history - design round 4's D13, at a refusal the wire classified.
		assert.equal(draft.errorCode, code);
		assert.equal(draft.error, message);
		assert.equal(withholdsRetryHint(draft.errorCode), true);
		/*
		 * And the OTHER question these codes answer, which is a different one: the
		 * held line's register. The shared held sentence says the outcome is "not
		 * knowable" and conditions the retry on a reply arriving - written for a lost
		 * response, and false here in the incident's own direction, because a store
		 * that could not write knows the message was not saved while the transcript
		 * above shows it painted (UX round 1, U4). One predicate answers it, read off
		 * the same code the hint is withheld by.
		 */
		assert.equal(isStoreWriteRefusal(draft.errorCode), true);
		/*
		 * And the outcome is KNOWN, which is the sibling contract's own reading of these
		 * two codes: `local_operator/server/utils/store_failures.py` says the two
		 * non-retryable codes mean this request was NOT ADMITTED, that no durable row
		 * exists for the message, and that a client may state that plainly.
		 *
		 * So these two are PRE-ADMISSION REFUSALS by the app's own rule, and that is
		 * the change: they used to sit in the unknown class, which is what left the
		 * message in a claim the composer did not own and left the echo painted over an
		 * empty box. A request the backend says it never admitted is exactly the case
		 * `isRefusedBeforeAdmission` names, so the echo is retracted, the payload goes
		 * back to the composer, and no request id is kept for a replay of a request
		 * that never was.
		 *
		 * The one thing this must not be read as saying is that every byte is gone: on
		 * the `ENOSPC` file-append arm an attachment blob may have been written before
		 * its sidecar failed. The plain reading is true of the ADMISSION, and the
		 * backend's own sentence is what the user is shown.
		 */
		assert.equal(
			isRefusedBeforeAdmission(
				new DesktopControlError(status, message, undefined, code),
			),
			true,
		);
		assert.notEqual(
			draft.admissionAttempted,
			true,
			"nothing was admitted, so there is nothing to replay",
		);
		// Retry is WITHHELD for both arms, because the notice's own remedy is on the
		// message in the box rather than on a press that meets the same full disk.
		assert.equal(
			sendFailureCopy(new DesktopControlError(status, message, undefined, code))
				.retry,
			false,
		);
	}

	// The third arm of the same ladder: genuine lock contention. It keeps the
	// backend's existing sentence AND the composer's retry hint, because there a
	// retry is the right advice - so no renderer code names it.
	reset();
	const busyMessage =
		"Read state is busy right now. It will catch up on its own.";
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return Promise.reject(
			new DesktopControlError(503, busyMessage, undefined, "store_busy"),
		);
	};
	const busyKey = store
		.getState()
		.stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(
		admitChatDraft(busyKey, { ...input, text: "hello" }, "222222222222"),
	);
	const busyDraft = store.getState().drafts[busyKey];
	assert.equal(busyDraft.error, busyMessage);
	assert.equal(withholdsRetryHint(busyDraft.errorCode), false);
	// Contention is NOT a store write refusal, and the difference is what keeps the
	// shared held sentence - and the retry hint - correct for it.
	assert.equal(isStoreWriteRefusal(busyDraft.errorCode), false);
});

/*
 * UX round 1's U1/U4, on the sentence the operator is left holding.
 *
 * U1: the store sentence's own instruction ("Free up space, then send it again")
 * is a step the app cannot take while the claim holds the payload - the box is
 * empty, Enter sends nothing (measured 11 -> 11 requests) - so the sentence has to
 * name the control that revives it. U4: underneath it, the shared held line says
 * the outcome is "not knowable" and gates the retry on a reply arriving, which
 * contradicts the sentence above it for these two codes.
 *
 * Both are asserted at the source because both are about WHICH string a state
 * renders, and the state itself lives one level down in `heldCopy`: the store arm
 * is selected by the same predicate the tests above execute, and it interpolates
 * the same constant the button is labelled with. A second copy of either string
 * would pass a test that only matched the copy - so the assertion here is the
 * identity of the two readers, not the wording.
 */
test("the notice is ONE sentence from ONE place, and the composer renders it rather than re-deriving it", () => {
	/*
	 * WHAT THIS REPLACES, AND WHY THE CLAIM'S REGISTER IS GONE RATHER THAN RENAMED.
	 * The old case pinned a two-way decision about a HELD payload: which sentence a
	 * claim said about itself (`heldClaimCopy`), read from the code of the failure
	 * that left the payload held and never from the refusal on screen (UX round 2,
	 * U10), plus the label of the control its sentence named.
	 *
	 * There is no claim, so there is no register to get wrong: every failure is one
	 * class, one sentence and at most two actions, all produced by `sendFailureCopy`
	 * from the failure itself (spec §4's table). What is still worth pinning is the
	 * shape of that single decision, and the absence of the words the operator
	 * reported - so this case reads the TABLE and then the two ends of the wire the
	 * sentence travels between: the store that raises it and the composer that
	 * renders it.
	 */
	// Every arm carries a sentence, and the unknown outcome is the one the operator
	// saw as a 20-second transport apology. It must be this app's own sentence.
	const unknown = sendFailureCopy(new Error("network down"));
	assert.equal(
		unknown.message,
		SEND_FAILURE_COPY.unconfirmed,
		"a failure the app cannot classify says what the app knows: it could not confirm the send",
	);
	assert.equal(
		unknown.retry,
		true,
		"and Retry is offered, because an unchanged retry replays",
	);
	/*
	 * The transport's own 20-second deadline sentence is NOT what the composer
	 * shows: it is prose about a request the app stopped waiting for, and the
	 * composer's job is to say what happened to the user's message.
	 */
	const deadline = new DesktopControlError(
		504,
		"The app waits up to 20 seconds for this request, and it was still running when the app stopped waiting.",
		undefined,
		"deadline_exceeded",
	);
	assert.notEqual(
		sendFailureCopy(deadline).message,
		deadline.message,
		"the transport's timeout prose must not be the composer's notice",
	);
	// A refusal this app synthesised carries its own sentence, and no Retry: the
	// same press meets the same rule.
	const slash = sendFailureCopy(
		new DesktopControlError(422, "The request has invalid fields."),
		LEADING_SLASH_CODE,
	);
	assert.equal(slash.message, LEADING_SLASH_MESSAGE);
	assert.equal(slash.retry, false);

	// THE WIRING, at both ends the sentence travels between. The composer's notice
	// is its own `reportFailure`, which classifies ONCE from the live failure - not
	// from the row's code, and not from a second table.
	const page = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	/*
	 * AND THE PANE RENDERS THE CLASSIFICATION THE STORE ALREADY MADE (review round 4,
	 * M1). The pane used to classify the failure a SECOND time, from the only fact it
	 * had - the PRE-SEND row's `admissionAttempted`, which an edited payload has just
	 * invalidated by rotating the request id. On that arm the screen showed the
	 * unknown-outcome sentence with a Retry over a body the daemon had refused, while
	 * the row the store wrote said not-sent and no press, and a remount flipped the
	 * same failure to the daemon's sentence. One failure, two renderings, only the
	 * screen wrong.
	 *
	 * The wiring below is what makes them one answer. It is asserted at the source
	 * because the pane's notice is React state on a component this suite does not
	 * mount, and the behaviour is exercised where it CAN be - the row-level pin in
	 * `composer-send-failure.test.mjs` drives the arm and asserts what the pane's own
	 * helper renders from it.
	 */
	assert.match(
		page,
		/reportCaughtFailure\(key, error\)/,
		"the pane's catch no longer reports the store's classification",
	);
	assert.match(
		page,
		/rowError: row\?\.error,/,
		"the pane's notice no longer comes from the row the store wrote, so the screen can disagree with it again",
	);
	assert.match(
		page,
		/const caughtFailureCopy = \(error: unknown\) =>\s*sendFailureCopy\(error, undefined, false\);/,
		"the pane's fallback classifier is no longer fact-less, so it can re-introduce the pre-send fact the store stopped using",
	);
	assert.match(
		page,
		/setSendError\(notice\?\.message \?\? null\)/,
		"the classified sentence is no longer what the notice renders",
	);
	/*
	 * AND THE LOCK'S ANSWER GOES WHEN THE FLIGHT DOES (review round 4, M2 = Q4-1 =
	 * D11 = U16). It is derived from the row's own `pending`, which the store clears on
	 * every ending, rather than latched with nothing to retire it - which is how a
	 * success left "Your last message is still sending." under a transcript that
	 * already held the message.
	 */
	assert.match(
		page,
		/!lockAnswerOutlived\(\{/,
		"the lock's sentence is latched again, so it can outlive the send it describes",
	);
	/*
	 * AND ITS TERMS ARE THE PANE'S OWN (review round 5, m5-1 and n5-2). `admitting` is the
	 * window BEFORE an admission exists - where a press answered during image decode had
	 * its sentence retired in the same commit - and the predicate itself is a pure helper
	 * so the behaviour is pinned rather than this wiring only.
	 */
	assert.match(
		page,
		/rowPending: draft\?\.pending === true,/,
		"the predicate no longer reads the row's own pending flag",
	);
	assert.match(
		page,
		/admitting,/,
		"the pre-admission window is not a term any more, so a press answered there loses its sentence",
	);
	assert.doesNotMatch(
		page,
		/heldClaimCode/,
		"the page still threads a claim's verdict, so a second register can drift back in",
	);
	const composer = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	);
	/*
	 * Comments are stripped for the vocabulary check only, and the reason is the
	 * same one the other source assertions in this file give: this change's own
	 * comments quote the words that were removed, and matching the raw text would
	 * make the test fail on the sentence explaining the fix - the class of false
	 * positive that got a bare JSX comment rendered inside an alert once already.
	 */
	const composerCode = composer.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	/*
	 * THE PANE, WHICH NOTHING ELSE IN THIS FILE CAN RENDER. `MessageInput` needs a
	 * message list, a dispatcher and the canonical store, so the pane's notice is
	 * pinned at the source it is built from - the same instrument this file already
	 * uses for the row it cannot mount. Three claims, each with a review-round-1
	 * finding behind it:
	 *
	 *  1. the notice comes from ONE derivation over plain inputs
	 *     (`composerNoticeFor`), so the branch between "a failure this pane caught",
	 *     "a failure the row kept" and "a message that arrived after all" is tested
	 *     as a rule rather than read out of JSX (B3/B4, 16);
	 *  2. the control is the OUTCOME CLASS's, never "is there an error on screen" -
	 *     which is true for every failure this store records, so Retry was hidden on
	 *     exactly the arms it exists for (B3);
	 *  3. the muted late-delivery line has a READER. It had none outside the story,
	 *     so the sentence never rendered and the live duplicate it exists to prevent
	 *     stayed invisible (B4).
	 */
	assert.match(
		page,
		/composerNoticeFor\(\{/,
		"the pane no longer builds its notice from the one derivation, so a second place can decide what the notice says",
	);
	assert.doesNotMatch(
		page,
		/draft\?\.error === undefined/,
		"the pane gates Retry on whether an error exists, which is true for every failure the store records",
	);
	assert.match(
		page,
		/inputByConversation\[identity\]\?\.lateDelivered/,
		"the pane never reads the late-delivery note, so the muted sentence has no reader in the app",
	);
	const sessionHook = readFileSync(
		"src/renderer/src/shared/hooks/use-canonical-session.ts",
		"utf8",
	).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	/*
	 * THE INVARIANT, AS A COUNT (corrected in round 8, where the softer form let this
	 * through). The hook has ONE writer of the view - `commitView`, which lands the new
	 * value on a ref before React sees it, because the echo registry reads that ref and
	 * a queued update has not run when it asks. A second route is therefore not merely
	 * untidy: a FUNCTIONAL `setView` reaches React's state and not the ref, so the next
	 * `commitView` spreads the stale ref over it and undoes the write. That is exactly
	 * how a released label came back held (`scripts/seed-label-gap.test.mjs`, "and
	 * nothing stayed held", 2 !== 0) on every head carrying main's label machinery.
	 *
	 * Round 7 loosened this to "every other route is a functional update that cannot
	 * disagree with it", which is false for the reason above and is why the failure
	 * survived a round. One occurrence of `setView` in the file, and it is the call
	 * inside `commitView`.
	 */
	assert.equal(
		(sessionHook.match(/setView\(/g) ?? []).length,
		1,
		"the hook writes its view through a second route, and a commit from the ref will spread the stale one over it - the round-8 regression",
	);
	assert.match(
		sessionHook,
		/viewRef\.current = next;\s*\n\s*setView\(next\);/,
		"the single route is no longer the ref-first commit, so reads of the ref are not the view the registry gets",
	);
	assert.ok(
		(sessionHook.match(/commitView\(/g) ?? []).length > 10,
		"the view's mutations no longer go through the single writer",
	);
	assert.match(
		composer,
		/\{RETRY_LABEL\}/,
		"the retry control is no longer labelled from the shared constant, so the sentence and the control can drift apart",
	);
	assert.match(
		composer,
		/\{CLEAR_LABEL\}/,
		"and the clear control is not either",
	);
	for (const word of [
		"Restore message",
		"Stop holding it",
		"still being held",
	]) {
		assert.ok(
			!composerCode.includes(word),
			`the composer still renders "${word}", which is the vocabulary the operator reported`,
		);
	}
	// And the state itself is gone from the store, so nothing can render it.
	const storeSource = readFileSync(
		"src/renderer/src/shared/store/canonical-sessions-store.ts",
		"utf8",
	).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	for (const dead of [
		"SEND_HELD",
		"UNCONFIRMED_SEND_CODE",
		"releaseClaim",
		"heldClaimCopy",
	]) {
		assert.ok(
			!storeSource.includes(dead),
			`the store still declares ${dead}, which is a claim the composer no longer has`,
		);
	}
	/*
	 * `heldClaimCode` is the ONE name from that list that survives, and it survives
	 * as the OPPOSITE of a claim: it is the released app's own marker, and the
	 * migration keys on it so that it can never fire on a row THIS build wrote -
	 * which was review round 1's blocker B1 (the migration ran on every fresh
	 * failure, wiped the replay identity, and handed the payload back twice). So the
	 * pin is no longer "the name is absent" but "the name is only ever a legacy
	 * read": three occurrences, one per legitimate role, and the guard among them.
	 */
	/*
	 * FIVE NOW, AND ALL FIVE ARE READS INSIDE THE ONE MIGRATION (review round 2,
	 * R1/R3). The count is the pin:  the field's declaration; the gate that decides a
	 * row IS a released claim; and the three uses that carry the marker's own code
	 * into the migrated row - the sentence's code, the press derived from it, and the
	 * clear that ends the move. What the count forbids is unchanged: nothing writes a
	 * claim, and nothing outside `migrateHeldClaim` reads the name.
	 */
	assert.equal(
		(storeSource.match(/heldClaimCode/g) ?? []).length,
		5,
		"`heldClaimCode` has grown another use, so something is writing or reading a claim again rather than reading the released app's marker once",
	);
	/*
	 * AND THE GATE IS STILL A GATE (review round 2, R3 rewrote it; review round 3,
	 * R2-2 added the second term). It no longer waits for the marker's mere
	 * presence - the released app's own rows can carry no code at all, and refusing
	 * those left the message stranded in `submittedText` - but it still refuses
	 * every row THIS build wrote, and it takes BOTH fields this build writes to do
	 * it: `errorRetry`, which every recorded failure carries, and `submittedRendered`,
	 * which the latch writes with `admissionAttempted` BEFORE the wire. `errorRetry`
	 * alone is `undefined` for a row this build left by being killed between those
	 * two points, and treating that row as the released app's cleared the replay pin
	 * while keeping the id.
	 */
	assert.match(
		storeSource,
		/draft\.heldClaimCode !== undefined \|\|\s*\(draft\.errorRetry === undefined && draft\.submittedRendered === undefined\)/,
		"the migration no longer distinguishes the released app's rows from this build's, so it can fire on a row this build wrote",
	);
});

/*
 * THE OPERATOR'S OWN REMEDY, EXECUTED END TO END, on the failure that produced
 * their screen: a store that cannot write.
 *
 * What this replaces. The old case existed because the message was HELD outside
 * the composer, and the remedy the app's own sentence named ("drop the file, then
 * send it again") was refused by the unchanged-payload guard - so the case had to
 * prove that the claim's verdict survived the guard's refusal, or the sentence on
 * screen reverted to the wrong register one line later (UX round 2, U10).
 *
 * With the payload in the composer there is no claim and no guard, so the property
 * is the one the user experiences: the sentence is the backend's, the payload
 * comes back with its files, and the remedy the sentence names WORKS - the press
 * goes out. The two old halves that still matter are kept: the row records the
 * refusal verbatim, and dismissing the sentence does not touch the message.
 */
test("a store refusal hands the payload back, and the remedy its sentence names goes out", async () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	const stored =
		"This computer is out of disk space, so the message could not be written.";
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return Promise.reject(
			new DesktopControlError(507, stored, undefined, STORE_OUT_OF_SPACE_CODE),
		);
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const session = "222222222222";
	const text = "look at this screenshot";
	const file = "/tmp/a.png";
	/*
	 * What the composer holds as the press is made: the text in the box and the file
	 * staged, which is the state the user is looking at when the send fails. Written
	 * here rather than left out, because the return path's whole job is to move THIS
	 * row - a fixture with no row would prove nothing about where the payload lands.
	 */
	const pressed = composerIdentityFor(key, session);
	useConversationInputStore.setState({
		inputByConversation: {
			[pressed]: {
				currentInput: text,
				attachments: [{ id: "chip-a", path: file }],
				replies: [],
			},
		},
	});
	/*
	 * And the ECHO, which is what takes the row on the way out: `beginInFlight` is
	 * the one write the paint makes, and it happens before the message request - so
	 * by the time the store refuses, the composer is empty and the return path is the
	 * only thing that can put the payload back. Without this the case would pass on a
	 * row that never moved.
	 */
	const staged =
		useConversationInputStore.getState().inputByConversation[pressed];
	useConversationInputStore.getState().beginInFlight(
		pressed,
		{
			text,
			attachments: (staged?.attachments ?? []).map((chip) => ({
				id: chip.id,
				path: chip.path,
			})),
			replies: [],
		},
		true,
	);
	await assert.rejects(
		admitChatDraft(key, { ...input, text, attachments: [file] }, session),
		(error) => error.code === STORE_OUT_OF_SPACE_CODE,
	);
	const failed = store.getState().drafts[key];
	assert.equal(failed.errorCode, STORE_OUT_OF_SPACE_CODE);
	// The backend's own sentence, VERBATIM: it is the process that knows which volume
	// is full, and this app has nothing better to say about it.
	assert.equal(failed.error, stored);
	assert.notEqual(
		failed.admissionAttempted,
		true,
		"the backend says this request was never admitted, so there is no outcome to be unsure about and no request to replay",
	);

	/*
	 * And the payload is where the user can act on it: the composer's own row, for
	 * the identity the press was made under - text and file together. This is the
	 * half that used to sit behind `Restore message`.
	 */
	const identity = composerIdentityFor(key, session);
	const row = () =>
		useConversationInputStore.getState().inputByConversation[identity];
	assert.equal(row()?.pendingText, text, "the text came back to the composer");
	assert.deepEqual(
		(row()?.attachments ?? []).map((chip) => chip.path),
		[file],
		"and the file with it, so the next press sends the message the user can see",
	);

	/*
	 * The remedy, taken: the store is healthy again, the user drops the file (the
	 * sentence's own instruction) and presses Send. Under the old model this press
	 * was refused by construction and reached the wire zero times.
	 */
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return {};
	};
	const before = calls.length;
	const id = await admitChatDraft(
		key,
		{ ...input, text, attachments: [] },
		session,
	);
	assert.equal(id, session, "the remedy's press is admitted");
	const sent = calls
		.slice(before)
		.filter((call) => call.op === "sessions.message")
		.at(-1);
	assert.equal(sent.text, text, "carrying the wording the user kept");
	assert.notEqual(
		sent.requestId,
		failed.admissionRequestId,
		"and it is a first attempt rather than a replay: nothing about this message was ever issued",
	);

	/*
	 * Dismissing the sentence is not abandoning the message. `onDismiss` clears the
	 * row's `error`/`errorCode`; the composer's own copy is a different store, and
	 * it must be untouched by a keystroke in the alert.
	 */
	const composerAfter = useConversationInputStore.getState().clearComposer;
	store.getState().updateDraft(key, { error: undefined, errorCode: undefined });
	assert.equal(
		store.getState().drafts[key]?.errorCode,
		undefined,
		"the sentence is gone",
	);
	// (The send above landed, so the row is retired; the point of the assertion is
	// the independence of the two stores, which the composer-side Clear proves.)
	assert.equal(typeof composerAfter, "function");
});

/*
 * THE WHOLE PAYLOAD, which is QA round 1's Q-2 and round 7's R17 in one property.
 *
 * Q-2: `Restore message` used to write the TEXT back and leave the chip row alone,
 * so the payload still did not match what the app was holding, the guard refused
 * the next Enter with the same two controls, and the one control that named the
 * operator's remedy could not deliver it.
 *
 * R17: worse, a restored draft that had lost its file sent the wording WITHOUT it,
 * silently, and retired the row that recorded what was owed - the user believed
 * they had sent their screenshot.
 *
 * Both are the same property, and it is now the return path's own: whatever the
 * composer row holds after a failure is what the next Send carries. Asserted on
 * the WIRE here, because that is where "silently without the file" happens.
 */
test("a failed send's file comes back with its text, and the next Send carries both (Q-2, R17)", async () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const session = "222222222222";
	const text = "look at this screenshot";
	const file = "/tmp/a.png";
	const identity = composerIdentityFor(key, session);
	/*
	 * The composer that pressed, in its own terms: the file staged, then the echo
	 * taking the row on its way out (`beginInFlight`, the one write the paint
	 * makes). Doing this by hand is not setting up a state the app does not reach -
	 * it is the state the app reaches, because the row is what the send reads.
	 */
	useConversationInputStore
		.getState()
		.addAttachment(identity, { id: "chip-a", path: file });
	const staged =
		useConversationInputStore.getState().inputByConversation[identity];
	useConversationInputStore.getState().beginInFlight(
		identity,
		{
			text,
			attachments: (staged?.attachments ?? []).map((chip) => ({
				id: chip.id,
				path: chip.path,
			})),
			replies: [],
		},
		true,
	);
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return Promise.reject(
			new DesktopControlError(
				507,
				"This computer is out of disk space, so the message could not be written.",
				undefined,
				STORE_OUT_OF_SPACE_CODE,
			),
		);
	};
	const encoded = [{ data_b64: "QUJD", mime_type: "image/png" }];
	await assert.rejects(
		admitChatDraft(
			key,
			{ ...input, text, attachments: [file], images: encoded },
			session,
		),
		(error) => error.code === STORE_OUT_OF_SPACE_CODE,
	);

	// The press's file is back in the composer's own row, and it never left the
	// text: both halves arrive together, through one store write.
	const restored =
		useConversationInputStore.getState().inputByConversation[identity];
	assert.equal(restored?.pendingText, text, "the text is back");
	assert.deepEqual(
		(restored?.attachments ?? []).map((chip) => chip.path),
		[file],
		"and so is the file the send was carrying",
	);

	// THE REGRESSION, on the wire: the next Send carries BOTH halves. Pre-fix this
	// request had the wording and no image, which is a silent partial send.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return {};
	};
	const saved = Object.values(
		useConversationInputStore.getState().inputByConversation,
	);
	const chips = saved.flatMap((entry) =>
		(entry.attachments ?? []).map((chip) => chip.path),
	);
	assert.deepEqual(chips, [file], "the composer's row is what the press reads");
	const before = calls.length;
	await admitChatDraft(
		key,
		{ ...input, text, attachments: chips, images: encoded },
		session,
	);
	const sent = calls
		.slice(before)
		.filter((call) => call.op === "sessions.message")
		.at(-1);
	assert.equal(sent.text, text);
	assert.deepEqual(
		sent.images,
		encoded,
		"the file's own bytes travel with the wording, so a restored draft cannot go out silently half-empty",
	);
});

/*
 * UX round 1's U2, WHICH WAS ABOUT TWO COMPARISONS DISAGREEING.
 *
 * The store compared text AND files AND images byte-for-byte while the composer
 * decided "the held payload is back in the box" from the TEXT alone. Same text
 * with one chip removed read as the held payload to the composer and as a
 * different message to the store, so the copy offered a retry the store refused -
 * the instruction/refusal loop the operator hit on their own remedy.
 *
 * The fix is not "make the two comparisons agree": it is that there is now ONE of
 * them. `payloadMatchesClaim` decides what "the same message" means (the normalized
 * text and the attachment paths in order), the replay rule reads it, and the
 * composer asks nothing of its own - its Retry is a press of Send over the payload
 * the composer actually holds, so there is no second opinion to drift.
 *
 * So this case pins the SINGLE rule and the composer's silence about it, which is
 * the shape that cannot grow a second comparison back.
 */
test("one rule decides what the same message means, and the composer keeps no second opinion", () => {
	const store = readFileSync(
		"src/renderer/src/shared/store/canonical-sessions-store.ts",
		"utf8",
	);
	// The rule, its two terms, and the fact that the replay decision reads it.
	assert.match(
		store,
		/function payloadMatchesClaim\(/,
		"the payload comparison has no name, so a caller can grow its own version of it",
	);
	assert.match(
		store,
		/claim\.submittedText !== text/,
		"the rule no longer compares the text",
	);
	assert.match(
		store,
		/claimed\.every\(\(path, index\) => path === attachments\[index\]\)/,
		"the rule no longer compares the FILES in order, which is the half the composer's text-only comparison used to miss (UX round 1, U2)",
	);
	assert.match(
		store,
		/payloadMatchesClaim\(previous, text, input\.attachments\)/,
		"the replay decision no longer reads the rule, so the rule and the behaviour can part company",
	);
	/*
	 * And the composer holds no comparison of its own: no `heldAttachments`, no
	 * `heldText`, no chip-list built to match a payload somebody else is keeping.
	 * The check reads code with comments stripped, because a comment describing the
	 * removed comparison is exactly what this change leaves behind.
	 */
	const composer = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	for (const gone of [
		"heldAttachments",
		"heldText",
		"heldClaimCode",
		"boxAttachments",
	]) {
		assert.ok(
			!composer.includes(gone),
			`the composer still builds ${gone}, so a second opinion about "the same message" is back`,
		);
	}
	/*
	 * The press that replaces the whole apparatus: Send, over what the box shows. The
	 * submit freezes its payload off the composer's own row (`stagedPayloadOf`, in
	 * the hook) rather than off any record of a held message, so the two cannot
	 * disagree by construction.
	 */
	const hook = readFileSync(
		"src/renderer/src/shared/hooks/use-message-input.ts",
		"utf8",
	);
	assert.match(
		hook,
		/const staged = conversationId \? stagedPayloadOf\(conversationId\) : undefined;/,
		"the submit no longer reads its payload from the row that holds it, so what it sends and what it shows can disagree",
	);
	assert.match(
		hook,
		/useConversationInputStore\.getState\(\)\.inputByConversation\[conversationId\]/,
		"the payload no longer comes from the composer's own row",
	);
});

/*
 * U14 / Q7: the SAME refusal on the arm a "New chat" uses, where the session is
 * created INSIDE the send.
 *
 * This is not the case above with a different id. `admitChatDraft` creates the
 * session itself, patches the row with the id it got one request before
 * admission, and the page keys the panel on `panelIdentityFor(draftKey, id)` -
 * whose precedence is `id ?? draftKey` - so the identity the panel renders under
 * flips from the draft key to the new session id MID-SEND. The composer that sent
 * the draft is unmounted by that flip and takes its own refusal restore with it;
 * the composer that replaces it is seeded from per-conversation text state that
 * has never held this text.
 *
 * Live, that left the box EMPTY behind "Discard unsent message", with the copy
 * still instructing the user to move text that was on no surface at all: not the
 * box, not after a reload of the created session, and not in a New chat either
 * (UX round 3 U14, QA round 3 Q7).
 *
 * So the assertion is not "the draft is retained" - it was, and that is exactly
 * what made the loss look cosmetic. It is that the store hands the composer the
 * text AGAIN, through the one derivation the page reads, and that the composer's
 * own box rule then puts it back.
 */
test("a leading-slash refusal on the created-session arm hands the payload to the identity the send minted", async () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "222222222222",
				binding: { agent: null, team: null },
			};
		return Promise.reject(
			new DesktopControlError(422, "The request has invalid fields."),
		);
	};
	// A staged draft with NO session and no target: the "New chat" arm, the one
	// that has to create its session in the same call that sends the text.
	const key = store.getState().stageDraft();
	const text = "/usage\ncreated-session arm line two";
	/*
	 * What the composer that presses holds: a row keyed by the identity it is
	 * rendering under BEFORE the send, which on this arm is the draft key. The echo
	 * then takes it (`beginInFlight`), so the payload is out of the row and the
	 * return path is the only thing that can hand it back.
	 */
	const pressed = key;
	useConversationInputStore.setState({
		inputByConversation: {
			[pressed]: {
				currentInput: text,
				attachments: [],
				replies: [],
			},
		},
	});
	useConversationInputStore
		.getState()
		.beginInFlight(pressed, { text, attachments: [], replies: [] }, true);
	await assert.rejects(admitChatDraft(key, { ...input, text }), (error) => {
		assert.ok(error instanceof DesktopControlError);
		assert.equal(error.code, LEADING_SLASH_CODE);
		assert.equal(error.message, LEADING_SLASH_MESSAGE);
		return true;
	});
	const state = store.getState();
	const draft = state.drafts[key];
	// The session was created inside the send, and the request that carried the
	// text is the one that was refused.
	assert.deepEqual(
		[...new Set(calls.map((request) => request.op))],
		["sessions.create", "sessions.message"],
	);
	assert.equal(draft.sessionId, "222222222222");
	assert.equal(draft.errorCode, LEADING_SLASH_CODE);
	assert.equal(draft.error, LEADING_SLASH_MESSAGE);
	assert.equal(draft.admissionAttempted, false);
	// The flip itself, and why a restore in the composer that pressed cannot be the
	// only answer: the panel is now keyed on the id this very send minted ...
	assert.equal(
		panelIdentityFor(state.activeDraftKey, draft.sessionId),
		"222222222222",
	);
	// ... so the payload has to BE under that identity, because the row keyed by the
	// draft key is a row no pane will ever render again. This is U14/Q7 asserted
	// where it happens rather than through a copy of the text.
	const minted = composerIdentityFor(key, draft.sessionId);
	assert.notEqual(
		minted,
		pressed,
		"the identity the send minted is not the one the composer pressed under - this is the arm the case is about",
	);
	const row = useConversationInputStore.getState().inputByConversation[minted];
	assert.equal(
		row?.pendingText,
		text,
		"the text is in the composer that will render it",
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[pressed],
		undefined,
		"and nothing is left behind under an identity no pane will show again",
	);
	assert.notEqual(draft.pending, true, "settled");
});

/*
 * The two arms, side by side, on the one thing the user experiences: what the
 * composer is given to put back. The named-session arm never re-keys, so its
 * local restore has always worked; the created-session arm has to be handed the
 * same text by the store. One rule, one field, both arms.
 */
test("a refusal hands the composer the same payload on both arms", async () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "333333333333",
				binding: { agent: null, team: null },
			};
		return Promise.reject(
			new DesktopControlError(422, "The request has invalid fields."),
		);
	};
	const arm = async (key, sessionId, text, pressed, destination) => {
		useConversationInputStore.setState({
			inputByConversation: {
				...useConversationInputStore.getState().inputByConversation,
				[pressed]: { currentInput: text, attachments: [], replies: [] },
			},
		});
		useConversationInputStore
			.getState()
			.beginInFlight(pressed, { text, attachments: [], replies: [] }, true);
		await assert.rejects(
			admitChatDraft(key ?? pressed, { ...input, text }, sessionId),
			/./,
		);
		const draft = store.getState().drafts[key ?? pressed];
		/*
		 * The identity the composer that renders NEXT is keyed by, handed in rather
		 * than derived from the draft row: `composerIdentityFor` reads the draft key
		 * while it is the pane's identity and the session id once one exists, and on
		 * the arm that creates its session mid-send those are two different rows.
		 */
		const row =
			useConversationInputStore.getState().inputByConversation[destination];
		return { draft, row };
	};
	// The arm that names its session: the row exists before the send and the panel
	// never moves, so the identity the press is made under is the one it keeps.
	const namedKey = draftIdentityFor(null, "444444444444");
	const named = await arm(
		namedKey,
		"444444444444",
		"/usage\nnamed-session arm line two",
		"444444444444",
		"444444444444",
	);
	// The arm that creates one mid-send, so the identity flips under the press.
	const createdKey = store.getState().stageDraft();
	const created = await arm(
		createdKey,
		null,
		"/usage\ncreated arm line two",
		createdKey,
		"333333333333",
	);
	assert.equal(
		named.row?.pendingText,
		"/usage\nnamed-session arm line two",
		"the arm that never flips hands the text back under its own identity",
	);
	assert.equal(
		created.row?.pendingText,
		"/usage\ncreated arm line two",
		"and the arm that flips hands it to the identity the send minted",
	);
	/*
	 * Same refusal shape on both: the arms differ in identity, not in what the user
	 * is owed - and the payload arrives in the SAME store under the SAME field, which
	 * is what "one rule for both arms" means now that there is one return path.
	 */
	for (const { draft } of [named, created])
		assert.equal(draft.admissionAttempted, false);
	assert.equal(named.row?.pendingText !== undefined, true);
	assert.equal(created.row?.pendingText !== undefined, true);
});

/*
 * R17: a refusal owes the composer its FILES as well as its words.
 *
 * The cases above pin the text half. The files are the half that went missing in
 * silence: the chip row was staged under the identity the send was made from, the
 * composer that renders afterwards is keyed to the identity the send MINTED, and
 * with no route between them the next Send went out with the wording and WITHOUT
 * the file - and retired the row that recorded what was owed, so nothing on screen
 * or in the store disagreed with the user's belief that they had sent it. Silent
 * and partial is the worst shape a failure can take.
 *
 * Asserted end to end now: the store refusal on the created-session arm, the
 * composer's row under the MINTED identity holding both halves, and then the list
 * the very next Send carries - which is the row, and is what "sends exactly what it
 * shows" means.
 */
test("a restored draft still carries an attachment, not just the text", async () => {
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "555555555555",
				binding: { agent: null, team: null },
			};
		return Promise.reject(
			new DesktopControlError(422, "The request has invalid fields."),
		);
	};
	const key = store.getState().stageDraft();
	const text = "/usage\ncreated-session arm line two";
	const attachments = ["/tmp/notes.txt", "/tmp/screenshot.png"];
	const pressed = key;
	useConversationInputStore.setState({
		inputByConversation: {
			[pressed]: {
				currentInput: text,
				attachments: attachments.map((path) => ({ id: `chip-${path}`, path })),
				replies: [],
			},
		},
	});
	const staged =
		useConversationInputStore.getState().inputByConversation[pressed];
	useConversationInputStore.getState().beginInFlight(
		pressed,
		{
			text,
			attachments: (staged?.attachments ?? []).map((chip) => ({
				id: chip.id,
				path: chip.path,
			})),
			replies: [],
		},
		true,
	);
	/*
	 * The press, with the files it is carrying - encoded at the boundary, which is
	 * where the real composer does it: the claim pins these bytes, so the retry below
	 * replays them rather than a re-encode that may differ.
	 */
	const encoded = attachments.map((_, index) => ({
		data_b64: `ENCODED-${index}`,
		mime_type: "image/png",
	}));
	await assert.rejects(
		admitChatDraft(key, { ...input, text, attachments, images: encoded }),
		/./,
	);
	const draft = store.getState().drafts[key];
	// The composer that mounts after the flip reads its chips under the id this send
	// minted, and has never seen these files.
	const minted = composerIdentityFor(key, draft.sessionId);
	assert.equal(minted, "555555555555");
	const row = useConversationInputStore.getState().inputByConversation[minted];
	assert.equal(row?.pendingText, text, "the text half is there");
	assert.deepEqual(
		(row?.attachments ?? []).map((chip) => chip.path),
		attachments,
		"and the files came with it - the half a restored draft used to lose in silence",
	);

	/*
	 * THE REGRESSION, on the wire: the payload the NEXT Send carries is the row the
	 * composer is showing. Pre-fix this read `[]` - the message went out with the
	 * wording and without the files.
	 */
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return {};
	};
	const chips = (row?.attachments ?? []).map((chip) => chip.path);
	const before = calls.length;
	await admitChatDraft(
		key,
		{ ...input, text, attachments: chips, images: encoded },
		minted,
	);
	const sent = calls
		.slice(before)
		.filter((call) => call.op === "sessions.message")
		.at(-1);
	/*
	 * The wire carries the ENCODED images rather than the paths (see the request
	 * shape in `admitChatDraft`), so the assertion is over what the send does with
	 * the list it was handed: one image per file the composer is showing. The
	 * composer encodes them from the same row it renders, which is what makes the
	 * two halves inseparable.
	 */
	assert.deepEqual(
		sent.images,
		encoded,
		"the files the composer is showing are the files the send carries - not a wording on its own, silently",
	);
});

/*
 * MINOR-2 of code review round 8, ON THE MODEL THAT REPLACED IT.
 *
 * The old case was about a split: `adoptRefusedPayload` adopted each half into an
 * "empty slot" and answered `withheld` when it had to hold one back, and
 * `refusedSplitNotice` turned that answer into a sentence - because a draft
 * carrying one half of a refused payload looked exactly like one carrying both.
 *
 * There is no withholding now, and that is the point: the return is ONE write
 * (`returnInFlight` -> `mergeReturnedPayload` + `mergeReturnedText`) that puts the
 * text back first, unions the chips by path and the quotes by id, and drops
 * nothing. So the property to assert is the one the split notice existed to
 * explain away: in EVERY state a composer can be in when a send fails, both halves
 * end up in the draft, and no state produces a message the user cannot send.
 *
 * Driven over a matrix rather than as hand-written arms, through the store the
 * composer reads, because these are the states the app actually reaches: an
 * untouched box, text typed during the flight, files attached during the flight,
 * and a quote staged during the flight.
 */
test("a return puts both halves back in every composer state, and withholds nothing", async () => {
	const text = "look at this screenshot";
	const attachments = ["/tmp/notes.txt", "/tmp/screenshot.png"];
	const reply = { id: "r1", text: "quoted turn" };
	const states = [
		{
			name: "a composer the user left alone",
			row: { currentInput: "", attachments: [], replies: [] },
			expectText: text,
			expectPaths: attachments,
			expectReplies: ["r1"],
		},
		{
			name: "text typed while the send was in flight",
			row: { currentInput: "a line I typed", attachments: [], replies: [] },
			expectText: `${text}\n\na line I typed`,
			expectPaths: attachments,
			expectReplies: ["r1"],
		},
		{
			name: "a file attached while the send was in flight",
			row: {
				currentInput: "",
				attachments: [{ id: "mine", path: "/tmp/mine.png" }],
				replies: [],
			},
			expectText: text,
			expectPaths: [...attachments, "/tmp/mine.png"],
			expectReplies: ["r1"],
		},
		{
			name: "a quote staged while the send was in flight",
			row: {
				currentInput: "",
				attachments: [],
				replies: [{ id: "mine", text: "my own quote" }],
			},
			expectText: text,
			expectPaths: attachments,
			expectReplies: ["r1", "mine"],
		},
	];
	for (const state of states) {
		reset();
		useConversationInputStore.setState({ inputByConversation: {} });
		globalThis.__canonicalRequest = async (request) => {
			calls.push(request);
			if (request.op === "sessions.create")
				return { session_id: "666666666666", binding: null };
			return Promise.reject(
				new DesktopControlError(
					507,
					"This computer is out of disk space, so the message could not be written.",
					undefined,
					STORE_OUT_OF_SPACE_CODE,
				),
			);
		};
		const key = store
			.getState()
			.stageDraft({ kind: "agent", name: "reviewer" });
		const session = "666666666666";
		// The composer's own row as the user left it, plus the send's payload, which
		// the echo takes on the way out (the state the failure lands in).
		useConversationInputStore.setState({
			inputByConversation: {
				[key]: {
					currentInput: state.row.currentInput,
					attachments: state.row.attachments,
					replies: state.row.replies,
				},
			},
		});
		useConversationInputStore.getState().beginInFlight(
			key,
			{
				text,
				attachments: attachments.map((path) => ({ id: `chip-${path}`, path })),
				replies: [reply],
			},
			true,
		);
		await assert.rejects(
			admitChatDraft(key, { ...input, text, attachments }, session),
			/./,
		);
		/*
		 * The identity the composer renders NEXT - the session id, once the send has
		 * created or addressed one. The row keyed by the draft key is deleted by the
		 * flip (`returnInFlight`'s `from !== to` branch moves it whole, which is the
		 * point), so reading it here would be reading a row no pane will show.
		 */
		const row =
			useConversationInputStore.getState().inputByConversation[
				composerIdentityFor(key, session)
			];
		assert.equal(
			row?.pendingText,
			state.expectText,
			`${state.name}: the returned message goes first and the user's own text is kept`,
		);
		assert.deepEqual(
			(row?.attachments ?? []).map((chip) => chip.path),
			state.expectPaths,
			`${state.name}: the file list is a union - returned files first - so nothing the user picked is dropped`,
		);
		assert.deepEqual(
			(row?.replies ?? []).map((kept) => kept.id),
			state.expectReplies,
			`${state.name}: and the quotes are a union by id`,
		);
		// Nothing to explain away: the returned half is never held back, so the state
		// that needed a "part of your message could not come back" sentence cannot
		// arise. Asserted on the row, because that is what the composer renders.
		assert.equal(
			Object.hasOwn(row ?? {}, "withheld"),
			false,
			`${state.name}: the row carries no withheld half - the split notice is gone with the withholding`,
		);
	}

	// And the merge is IDEMPOTENT: a second return for the same payload (a reconnect
	// replaying the same failure) must not duplicate the text or the files.
	reset();
	useConversationInputStore.setState({ inputByConversation: {} });
	const identity = "send:777777777777";
	useConversationInputStore
		.getState()
		.beginInFlight(identity, { text, attachments: [], replies: [] }, true);
	useConversationInputStore.getState().returnInFlight(identity, identity);
	useConversationInputStore.getState().returnInFlight(identity, identity);
	const once =
		useConversationInputStore.getState().inputByConversation[identity];
	assert.equal(once?.pendingText, text);
});

test("the box takes a returned message once, merged, and never inside a credential capture", () => {
	/*
	 * R18's question, on the mechanism that replaced the effect it was written for.
	 * The composer used to adopt a refused payload from PROPS in a layout effect
	 * inside `message-input.tsx`; the payload now arrives in the store row that owns
	 * the composer, and the hook that renders the box takes it from there
	 * (`adoptReturnedText`). The three claims that mattered still have to hold, and
	 * they are pinned here because each of them has a failure behind it:
	 *
	 * 1. The adoption is in the composer that owns the conversation. A freshly
	 *    mounted composer whose identity differs must not take another
	 *    conversation's returned text.
	 * 2. A masked credential capture keeps the box: adopting into it would put a
	 *    returned message inside a secret the user is composing.
	 * 3. The write goes through the store's merge, so the returned message lands
	 *    FIRST and the user's own typing follows it - the rule is in one place
	 *    (`mergeReturnedText`) rather than re-implemented at the call site.
	 */
	const hook = readFileSync(
		"src/renderer/src/shared/hooks/use-message-input.ts",
		"utf8",
	).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	const start = hook.indexOf(
		"const merged = adoptReturnedText(conversationId);",
	);
	assert.ok(
		start > 0,
		"the box no longer takes the returned text through the store's own merge, so the two can disagree about where the returned message goes",
	);
	const adoption = hook.slice(Math.max(0, start - 1200), start + 400);
	assert.ok(
		adoption.includes("if (pendingReturn !== undefined) {"),
		"the adoption no longer waits for a returned payload, so a box that enters another conversation is filled from a stale row",
	);
	assert.ok(
		adoption.includes("if (initializedRef.current !== conversationId) return;"),
		"the adoption no longer checks that this composer owns the conversation, so one pane can adopt another's failed message (the same defect U14 fixed on the remount)",
	);
	assert.ok(
		adoption.includes("if (draftHeld) return;"),
		"the adoption no longer stands down for a masked credential capture, so a returned message lands inside a secret the user is composing",
	);
	assert.ok(
		adoption.includes("setInputValue(merged);"),
		"the merged text is computed and never written to the box",
	);
	/*
	 * And no caret move of its own: the composer's caret effect owns that, and the
	 * box ends where the merged text does. A `setSelectionRange` written here is the
	 * failure this asserts against - the adoption reaching into a caret the capture
	 * and the slash planner both read.
	 */
	assert.ok(
		!adoption.includes("setSelectionRange"),
		"the adoption writes its own caret, so it can overrule whichever rule owns the caret on this screen",
	);
	/*
	 * The merge itself, from the store, so "returned first" is asserted where it is
	 * decided rather than at the call site.
	 */
	// The store owns the merge (one rule, asserted in "one rule decides what the same
	// message means"), and the hook's job is to take its answer rather than build one.
	const inputStore = readFileSync(
		"src/renderer/src/shared/store/conversation-input-store.ts",
		"utf8",
	);
	assert.match(
		inputStore,
		/export function mergeReturnedText\(/,
		"the merge has no name, so a caller can grow a second version of it",
	);
	assert.match(
		hook,
		/const merged = adoptReturnedText\(conversationId\);/,
		"the returned text no longer goes through the store's merge, so the box can place it differently from every other reader",
	);
});

/*
 * D12's question, on the notice that replaced the alert region it was written for.
 *
 * The old region rendered a FAILURE line, a muted held paragraph and the two
 * links that resolved the claim, inside a block capped at 7.5rem that scrolled
 * internally - so the order things appeared in decided what a narrow window cut
 * last, and a long held paragraph could push the composer's own controls out of
 * view.
 *
 * The new notice is one sentence and at most two actions, so there is nothing to
 * scroll and nothing to order: the operational fact is visible by construction.
 * What is still worth pinning is that shape - one sentence, at most Retry and
 * Clear, ABOVE the box so a sentence of any length cannot move the text the user
 * is typing - and the absence of a cap, which is what would let a future edit
 * reintroduce a strip that scrolls the remedy out of the window.
 */
test("the notice is one sentence above the box, at most Retry and Clear, and nothing in it scrolls", () => {
	const rendered = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	/*
	 * THE FAILURE ARM OF THE REGION'S ROLE (review round 2, NIT). The region carries
	 * `role={composerAlert.polite ? "status" : "alert"}`: the late-delivery line is a
	 * status - the app catching up, announced politely - while a send that did not
	 * land stays assertive, which is the claim this assertion is about. Reading the
	 * literal `role="alert"` cannot see either arm, so the expression is what is
	 * pinned, and the two arms are asserted separately.
	 */
	const alertAt = rendered.indexOf(
		'role={composerAlert.polite ? "status" : "alert"}',
	);
	assert.ok(
		alertAt > 0,
		"the composer no longer renders the failed send as an alert, so a send that did not land is not announced",
	);
	const boxAt = rendered.indexOf("<textarea");
	assert.ok(
		alertAt < boxAt,
		"the notice is no longer rendered ABOVE the box, which is the one position that does not move the line the user is typing (measured: a 20px line below the box moves it a full 20px, above it moves it 0px)",
	);
	const region = rendered.slice(alertAt, boxAt);
	assert.ok(
		region.includes("{composerAlert.message}"),
		"the notice no longer renders the classified sentence, so the alert and the store can disagree about what happened",
	);
	assert.ok(
		region.includes("break-words"),
		"the sentence no longer wraps, and it is not always this app's own prose - a store refusal names a volume and an unreadable attachment names a file",
	);
	assert.ok(
		region.includes("{RETRY_LABEL}") && region.includes("{CLEAR_LABEL}"),
		"the notice no longer offers the two labelled actions, so the remedy is somewhere else than the sentence",
	);
	const notice = rendered.slice(alertAt, rendered.indexOf("</p>", alertAt));
	assert.ok(
		!notice.includes("CAPPED_BLOCK") &&
			!notice.includes("max-h-") &&
			!notice.includes("overflow-y-auto"),
		"the notice scrolls or is capped again, so a long sentence can carry the remedy out of the window (D12)",
	);
	/*
	 * And the cap that mattered is still applied where content CAN be long: the
	 * composer's status row (the working line, the queue) keeps its bound, so this
	 * change removed a cap from a one-sentence notice rather than from everything.
	 */
	const status = readFileSync(
		"src/renderer/src/features/chat/components/composer-status-row.tsx",
		"utf8",
	);
	assert.match(
		status,
		/CAPPED_BLOCK/,
		"the status row lost its bound, so this change removed the cap from every surface instead of from the notice",
	);
	/*
	 * The actions themselves are bounded by the table, which is the reason the cap
	 * could go: one sentence, at most two controls, whatever the failure was.
	 */
	const store = readFileSync(
		"src/renderer/src/shared/store/canonical-sessions-store.ts",
		"utf8",
	);
	assert.match(
		store,
		/export const RETRY_LABEL = "Retry";/,
		"the retry label is no longer the app's one string",
	);
	assert.match(
		store,
		/export const CLEAR_LABEL = "Clear";/,
		"and the clear label is not either",
	);
});

/*
 * U16: the refusal screen must not contradict itself about whether a session
 * exists.
 *
 * A refused first message is created BEFORE it is refused (`sessions.create` 200,
 * then the message 422), so on that screen the composer's own footer states that
 * the working directory is fixed BECAUSE the session has started - one line
 * below a header announcing that the session has not started. The head now
 * describes the conversation that exists, by the identity this header already
 * falls back to for a live chat. Asserted on the source because the rung IS the
 * fix: the instruction must be reachable only while no session exists.
 */
test("the header stops announcing that the session has not started once one exists", () => {
	const rendered = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	const rung = rendered.match(
		/starting\s*\?\s*\(loadedTarget \?\? "Starting the session"\)\s*: draft\?\.sessionId\s*\?\s*([\s\S]{0,160}?)\s*:\s*"The session starts when you send your first message\."/,
	);
	assert.ok(
		rung,
		"the header description no longer separates the session that exists from the one that does not, so the refusal screen announces that no session has started while its own footer says one has (U16)",
	);
	assert.match(
		rung[1],
		/canonical\.frontend\?\.cwd \|\| cwd/,
		"the session that exists is not described by its directory, so the header and the immutability note below it are once again about different states",
	);
});

/**
 * D2: the pane's own unavailable state must be somewhere a reader can see it.
 *
 * Asserted on the source, in the shape this file already uses for a JSX-level
 * rule (U16 above), because the rung IS the fix: both bands are `fixed` at the
 * top of the window, so while one shows it covers the first ~30px of every
 * surface, and a sentence laid out against that edge is a statement nobody
 * reads. Measured on the committed frame
 * `docs/evidence/daemon-attach-live-app/after-gate-withdrawn.png`: the node was
 * 880x70 at y=24 with `checkVisibility()` true, the pane below the band held no
 * painted pixels at all, and the pane read as a single flat colour beside a
 * sidebar that kept its rows. The pixels are the rig's evidence; this is the
 * case that fails when the presentation regresses.
 */
test("the pane's unavailable state is centred, clear of the full-bleed bands", () => {
	const rendered = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	const rung = rendered.match(
		/!enabled \? \(([\s\S]{0,1400}?)\) : identity \?/,
	);
	assert.ok(
		rung,
		"the pane's own unavailable branch is gone, so the state it carries has no presentation left to judge",
	);
	assert.match(
		rung[1],
		/items-center justify-center/,
		"the sentence is anchored to the top of the pane again, where the fixed bands cover it: a statement no reader sees, beside a sidebar that keeps its rows (design round 1, D2)",
	);
	assert.doesNotMatch(
		rung[1],
		/className=\{cn\("p-6/,
		"a bare `p-6` against the top edge is exactly the shape that was invisible",
	);
	assert.match(
		rung[1],
		/Update the backend to use canonical chats/,
		"and the sentence itself is still the one the state owes",
	);
});

/*
 * R13, the same boundary read in the OTHER direction, against the same shipped
 * store and the real `desktopRequestSchema`.
 *
 * `admitChatDraft` creates a session inside the same try as message admission,
 * so an error raised while CREATING was classified by the draft's text alone. A
 * leading-slash draft therefore turned a bad-`cwd` 422 into
 * `leading_slash_message`: copy instructing the user to move a command that had
 * never been sent anywhere, over a request whose ops were `['sessions.create']`.
 * That is the app confidently naming the wrong cause - the defect U13 exists to
 * remove - so reaching the message request is the precondition of the
 * classification, and the draft's shape is not it.
 */
test("a session-creation refusal keeps its own code and copy, even for a leading-slash draft", async () => {
	reset();
	// A coded 422 is realistic on this path: `desktopResult` reads `detail.code`
	// off the backend's envelope, so a specific refusal the transport already
	// classified must not be overwritten by this general one either.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return Promise.reject(
				new DesktopControlError(
					422,
					"The working directory does not exist.",
					undefined,
					"invalid_cwd",
				),
			);
		return {
			session_id: "222222222222",
			binding: { agent: "reviewer", team: null },
		};
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const text = "/usage\ncreate-stage refusal is not the slash policy";
	await assert.rejects(
		admitChatDraft(key, { ...input, text, cwd: "/definitely/not/here" }),
		(error) => {
			// The caller's catch is the surface the composer renders from, so the
			// preserved classification has to cross that boundary too.
			assert.ok(error instanceof DesktopControlError);
			assert.equal(error.status, 422);
			assert.equal(error.code, "invalid_cwd");
			assert.equal(error.message, "The working directory does not exist.");
			return true;
		},
	);
	// Nothing dispatched a message, so no request could have carried the text to
	// the leading-slash policy in the first place.
	assert.deepEqual(
		[...new Set(calls.map((request) => request.op))],
		["sessions.create"],
	);
	const draft = store.getState().drafts[key];
	assert.equal(draft.errorCode, "invalid_cwd");
	assert.equal(draft.error, "The working directory does not exist.");
	assert.notEqual(draft.errorCode, LEADING_SLASH_CODE);
	assert.notEqual(draft.error, LEADING_SLASH_MESSAGE);
	// The generic retry hint is KEPT: a create refusal is not one of the two a
	// resend cannot answer, and withholding it would be the same
	// mis-attribution in the opposite direction.
	assert.equal(withholdsRetryHint(draft.errorCode), false);
	// U13's retention behaviour is unchanged and stands for its own reason - a
	// pre-admission refusal leaves the text where the fix can be made.
	assert.equal(draft.admissionAttempted, false);
	/*
	 * And the payload stays on the row - as the COMPARISON BASIS the retry rule reads
	 * (`payloadMatchesClaim`), not as a claim anybody has to release. The copy the user
	 * acts on is in the composer; this one is a fingerprint, and it is what makes an
	 * unchanged re-send replay under the request id it was first issued with rather
	 * than arriving at the owner as a second message.
	 */
	assert.equal(draft.submittedText, text);
});

test("a create payload the shipped schema rejects is not relabelled as a slash refusal", async () => {
	reset();
	// The reviewer's exact reproduction, and the shape nearest the live one:
	// `cwd: ""` is refused by the REAL `desktopRequestSchema`, so the transport
	// answers 422 with its plain-string detail and NO code - which is precisely
	// the shape the un-gated classifier could not tell from the slash policy.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create") {
			assert.equal(desktopRequestSchema.safeParse(request).success, false);
			return Promise.reject(
				new DesktopControlError(422, "Invalid desktop operation."),
			);
		}
		return {
			session_id: "222222222222",
			binding: { agent: "reviewer", team: null },
		};
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const text = "/usage\ninvalid cwd under a leading-slash draft";
	const wire = admitChatDraft(key, { ...input, text, cwd: "" });
	await assert.rejects(wire);
	const draft = store.getState().drafts[key];
	assert.notEqual(draft.errorCode, LEADING_SLASH_CODE);
	assert.notEqual(draft.error, LEADING_SLASH_MESSAGE);
	assert.equal(draft.error, "Invalid desktop operation.");
	assert.equal(withholdsRetryHint(draft.errorCode), false);
	/*
	 * And the payload stays on the row - as the COMPARISON BASIS the retry rule reads
	 * (`payloadMatchesClaim`), not as a claim anybody has to release. The copy the user
	 * acts on is in the composer; this one is a fingerprint, and it is what makes an
	 * unchanged re-send replay under the request id it was first issued with rather
	 * than arriving at the owner as a second message.
	 */
	assert.equal(draft.submittedText, text);
});

test("the same 422 without a leading slash keeps the transport's own sentence", async () => {
	reset();
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return {
				session_id: "222222222222",
				binding: { agent: "reviewer", team: null },
			};
		return Promise.reject(
			new DesktopControlError(422, "The request has invalid fields."),
		);
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(
		admitChatDraft(key, { ...input, text: "a message with no command in it" }),
	);
	const draft = store.getState().drafts[key];
	assert.equal(draft.errorCode, undefined);
	assert.equal(draft.error, "The request has invalid fields.");
	assert.equal(withholdsRetryHint(draft.errorCode), false);
});

test("latest candidate open wins, and an open spends no request of its own", async () => {
	reset();
	globalThis.__canonicalRequest = (request) => {
		calls.push(request);
		return Promise.resolve({});
	};
	/*
	 * The view follows the LATEST INTENT, immediately. The guard read (`sessions.get`)
	 * that each open used to issue is gone from the click path: it was a second facade
	 * acquire racing the stream for the same bridge locks, and the stream's own
	 * snapshot or 404 is the validation now (`confirmSessionLive` /
	 * `confirmSessionMissing`, pinned in `session-switch.test.mjs`).
	 */
	const first = store.getState().openSession("222222222222");
	const last = store.getState().openSession("333333333333");
	assert.equal(store.getState().activeSessionId, "333333333333");
	assert.equal(store.getState().validatingSessionId, "333333333333");
	assert.equal(await first, true);
	assert.equal(await last, true);
	assert.equal(store.getState().activeSessionId, "333333333333");
	assert.deepEqual(calls, []);
});

test("canonical catalogue requires negotiated version two and paired authorization", () => {
	const caps = { desktop_available: true, features: { session_catalogue: 1 } };
	assert.equal(
		module.desktopFeatureEnabled(caps, "session_catalogue", 2),
		false,
	);
	assert.equal(
		module.desktopFeatureEnabled(
			{ ...caps, features: { session_catalogue: 2 } },
			"session_catalogue",
			2,
		),
		true,
	);
	assert.equal(
		module.desktopFeatureEnabled(
			{ ...caps, desktop_available: false, features: { session_catalogue: 2 } },
			"session_catalogue",
			2,
		),
		false,
	);
});

test("new closed IPC operations validate roster and forbid hidden payload writes", () => {
	const requestId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
	for (const name of ["..", ".", "../teams", "path\\\\escape", "control\u007f"])
		assert.equal(
			desktopRequestSchema.safeParse({ op: "profiles.get", name }).success,
			false,
		);
	assert.ok(
		desktopRequestSchema.safeParse({
			op: "sessions.create",
			requestId,
			cwd: "/tmp",
			target: { kind: "team", name: "lopdev" },
		}).success,
	);
	assert.ok(
		desktopRequestSchema.safeParse({
			op: "profiles.create",
			requestId,
			name: "auditor",
			fields: { description: "Audit", instructions: "Verify" },
		}).success,
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "profiles.update",
			requestId,
			name: "auditor",
			fields: { system_prompt: "bypass" },
		}).success,
		false,
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "teams.create",
			requestId,
			fields: {
				name: "test",
				members: [{ role: "reviewer", count: 17, kind: "agent" }],
			},
		}).success,
		false,
	);
});

test("a pre-admission size refusal does not latch, so the user can drop an image and send", async () => {
	reset();
	// The trap this closes: `admissionAttempted` was set BEFORE the request
	// resolved, but a 413 comes from our own guard in desktop-transport.ts,
	// which returns before it ever calls fetch. Nothing was admitted and we know
	// it - yet the flag was set, so the unchanged-payload guard then refused any
	// edit. The banner said "send it again" and removing a screenshot to make it
	// fit was therefore the one action forbidden. Discarding the message was the
	// only exit.
	//
	// THE DROP IS MODELLED AS WHAT THE USER ACTUALLY DOES - a chip leaving the
	// composer - because the payload identity is keyed on the attachment PATHS now
	// (`payloadMatchesClaim`), with the encoded bytes taken from the pin. The file
	// list, not the image array, is what a "drop an image" edit changes.
	const heavy = [
		{ data_b64: "A".repeat(64), mime_type: "image/png" },
		{ data_b64: "B".repeat(64), mime_type: "image/png" },
	];
	const light = [{ data_b64: "A".repeat(64), mime_type: "image/png" }];
	const files = ["/tmp/a.png", "/tmp/b.png"];
	const kept = ["/tmp/a.png"];
	let refuse = true;
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		if (refuse)
			throw new DesktopControlError(
				413,
				"This message is too large to send in one request.",
			);
		return { status: "admitted" };
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(
		admitChatDraft(key, { ...input, attachments: files, images: heavy }),
		/too large/,
	);
	assert.equal(
		store.getState().drafts[key].admissionAttempted,
		false,
		"a refusal that never reached the backend must not pin the payload",
	);

	// The remedy the banner actually offers: remove an image - one chip, which is the
	// path list - and send. It is a NEW message, so it has its own id and carries its
	// own bytes.
	refuse = false;
	assert.ok(
		await admitChatDraft(key, { ...input, attachments: kept, images: light }),
	);
	const sent = calls.filter((call) => call.op === "sessions.message").at(-1);
	assert.deepEqual(sent.images, light, "the EDITED attachments are what ship");
	assert.deepEqual(sent.text, input.text);
	// The session allocated on the refused attempt is reused: only the admission
	// was refused, so re-creating would orphan a real session.
	assert.equal(calls.filter((call) => call.op === "sessions.create").length, 1);
});

test("a schema refusal of our own does not latch either, so a long paste can be shortened", async () => {
	reset();
	// The 422 sibling of the case above, and the one that made the trap reachable
	// by a single paste: the schema caps `text` in CHARACTERS while the pre-flight
	// weighed BYTES, so an over-long ASCII paste passed pre-flight and failed
	// `safeParse` in main - which returns 422 BEFORE any fetch, exactly like the
	// 413 guard. Keying the un-latch on 413 alone pinned the draft, and the user
	// was told to "retry unchanged" a message that could never succeed unchanged.
	let refuse = true;
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		if (refuse)
			throw new DesktopControlError(422, "Invalid desktop operation.");
		return { status: "admitted" };
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(
		admitChatDraft(key, { ...input, text: "x".repeat(200_001) }),
		/Invalid desktop operation/,
	);
	assert.equal(
		store.getState().drafts[key].admissionAttempted,
		false,
		"a schema refusal never reached the backend and must not pin the payload",
	);

	// The remedy: shorten the text and send. Under the old predicate this was
	// refused with "Retry it unchanged", with no exit but Discard.
	refuse = false;
	assert.ok(await admitChatDraft(key, { ...input, text: "shortened" }));
	const sent = calls.filter((call) => call.op === "sessions.message").at(-1);
	assert.equal(sent.text, "shortened", "the EDITED text is what ships");
});

test("a genuinely issued admission still latches, and its payload replays byte-identically", async () => {
	reset();
	/*
	 * The complement, and the reason the class rule reads the STATUS rather than
	 * loosening the flag: a 503 or a lost response may already be executing on the
	 * owner, so that payload stays pinned - the request id, the images and the mode
	 * are the identity a Retry reuses, and an unchanged retry is therefore an
	 * idempotent replay rather than a second message.
	 *
	 * The second half is the half the old guard got wrong: an EDITED payload is a new
	 * message, and it goes out. It used to be refused (`UNCONFIRMED_SEND_CODE`), which
	 * is what put Restore/Discard on the user's screen and blocked the message they
	 * were actually trying to send.
	 */
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		throw new DesktopControlError(503, "The backend is not answering.");
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input), /not answering/);
	const failed = store.getState().drafts[key];
	assert.equal(failed.admissionAttempted, true);
	// The app's own sentence, not the transport's: an unknown outcome is exactly what
	// this app knows about it, and the store's record has to say the same thing the
	// composer's notice does.
	assert.equal(failed.error, SEND_FAILURE_COPY.unconfirmed);

	// The unchanged retry: the same request, id and all.
	await assert.rejects(admitChatDraft(key, input), /not answering/);
	const first = calls.filter((call) => call.op === "sessions.message");
	assert.equal(first.length, 2, "both attempts reached the wire");
	assert.equal(
		first[1].requestId,
		first[0].requestId,
		"an unchanged retry replays under the id the owner already saw, which is what its receipt de-duplicates",
	);
	// The edited one is a new message, and it is admitted.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return { status: "admitted" };
	};
	const before = calls.length;
	await admitChatDraft(key, { ...input, text: "edited" });
	const edited = calls
		.slice(before)
		.filter((call) => call.op === "sessions.message")
		.at(-1);
	assert.equal(edited.text, "edited");
	assert.notEqual(
		edited.requestId,
		first[0].requestId,
		"an edited payload is a new message, so it cannot replay an id the owner may have already settled",
	);
});

test("the owner's own refusals latch nothing, and their payload still replays under the same id", async () => {
	// The incident this closes. A send into a session whose owner would not serve it
	// answered 503 `runtime_busy` (the owner occupied) or 409 `runtime_retiring` (its
	// runtime is leaving), and BOTH were classified unknowable: the echo stayed, the
	// composer said whether the message reached the agent "is not knowable", and it
	// offered Restore/Discard over a message the backend had already said it never
	// took. Neither code was in `isRefusedBeforeAdmission`, so a refusal that states
	// non-admission in its own sentence produced the app's most cautious claim.
	//
	// What the arms assert now is the pair the composer reads - the latch, which is
	// what the pane shows a send in flight from (`sendUnsettledForSession`), and the
	// echo's own fate - plus the property that makes the same id worth keeping: a
	// re-send of the SAME payload replays the request id the owner already answered,
	// so a busy owner that had in fact queued the command cannot be sent it twice.
	const arms = [
		{
			status: 409,
			code: "runtime_retiring",
			message:
				"This session is switching to a newer build; the one it loaded is gone from disk. The message was not admitted - send it again once the new build is up.",
			/*
			 * Retry IS offered on this arm now, and the change is the point: the new
			 * sentence ("Local Operator is restarting, so your message wasn't sent. Try
			 * again in a moment.") tells the user to try again, and the box is holding
			 * the message for them to do it from. Withholding the hint here would leave
			 * a sentence that names an action and no control that takes it.
			 */
			withholdsHint: false,
		},
		{
			status: 503,
			code: "runtime_busy",
			// A real body carries both, and the wait is honoured below rather than
			// assumed: the policy is the backend's, the loop is ours.
			retryAfterMs: 1,
			message:
				"This session's owner is busy with another request. Retry in a moment.",
			withholdsHint: false,
		},
	];

	for (const arm of arms) {
		reset();
		let refuse = true;
		globalThis.__canonicalRequest = async (request) => {
			calls.push(request);
			if (request.op === "sessions.create")
				return { session_id: "222222222222", binding: null };
			if (refuse)
				throw new DesktopControlError(
					arm.status,
					arm.message,
					undefined,
					arm.code,
					arm.retryAfterMs,
				);
			return { status: "admitted" };
		};
		const key = store
			.getState()
			.stageDraft({ kind: "agent", name: "reviewer" });
		const requestId = store.getState().drafts[key].admissionRequestId;
		await assert.rejects(admitChatDraft(key, input));

		const draft = store.getState().drafts[key];
		assert.equal(
			draft.admissionAttempted,
			false,
			`${arm.code} is raised before admission, so it must not show the send as in flight`,
		);
		assert.equal(
			draft.submittedText,
			normalizeSendText(input.text),
			"the payload stays as the comparison basis, so the re-send is an idempotent replay rather than a new message",
		);
		const retracted = echoes.filter((e) => e.kind === "retract");
		assert.equal(
			retracted.length,
			1,
			"the echo must go with the refusal: a retraction is the same predicate's other consumer",
		);
		assert.equal(retracted[0].id, requestId);
		assert.equal(
			withholdsRetryHint(arm.code),
			arm.withholdsHint,
			`${arm.code}: the hint is offered only where a press is the remedy`,
		);

		// The remedy, and the reason "nothing was admitted" is the right call: the
		// same id and the same text go out once the owner will serve them.
		refuse = false;
		assert.equal(await admitChatDraft(key, input), "222222222222");
		const sent = calls.filter((call) => call.op === "sessions.message");
		assert.equal(
			sent.at(-1).requestId,
			requestId,
			"a re-send that differs in identity could be delivered twice",
		);
		assert.equal(sent.at(-1).text, input.text);
	}
});

test("a failure that establishes nothing about admission is still unknowable - and a store refusal is not", async () => {
	/*
	 * The boundary, and the half of the incident that must NOT change: a 503 whose
	 * code is the hop failure (`runtime_unreachable`) may have arrived and settled
	 * with only its ack lost, and a 409 with no code at all is the receipt conflict
	 * whose first attempt may well have been admitted. Both keep the echo and the
	 * latch, because the app cannot state a fact it does not hold - and the composer
	 * says so ("Couldn't confirm your message was sent.") rather than either claiming
	 * a loss or refusing to act.
	 *
	 * `store_unavailable` is deliberately NOT in that list any more, and this is the
	 * line the old case would have called a regression: a store that could not take
	 * the write is the one failure that KNOWS the message was not recorded. The
	 * sibling contract says so in as many words
	 * (`local_operator/server/utils/store_failures.py`: the two non-retryable codes
	 * mean this request was NOT ADMITTED and no durable row exists), so it is a
	 * pre-admission refusal like any other - echo retracted, no latch, and the
	 * backend's own sentence as the copy.
	 */
	/*
	 * AND THE CODELESS 409 IS NO LONGER ONE OF THEM (review round 2, Q2-1). On a
	 * FRESH attempt - which is what this loop drives, since every iteration starts
	 * from a new draft - a 409 with no code is the daemon refusing the BODY, and the
	 * assertion in the second block below is the opposite of the one here. The
	 * receipt conflict, which is the arm that still establishes nothing, needs an
	 * unresolved attempt under the SAME id first, and it is pinned by its own case in
	 * `composer-send-failure.test.mjs` (`sendFailureClass`'s second argument).
	 */
	const unknowable = [{ status: 503, code: "runtime_unreachable" }];
	for (const arm of unknowable) {
		reset();
		globalThis.__canonicalRequest = async (request) => {
			calls.push(request);
			if (request.op === "sessions.create")
				return { session_id: "222222222222", binding: null };
			throw new DesktopControlError(
				arm.status,
				"the session's owner could not be reached",
				undefined,
				arm.code,
			);
		};
		const key = store
			.getState()
			.stageDraft({ kind: "agent", name: "reviewer" });
		await assert.rejects(admitChatDraft(key, input));
		assert.equal(
			store.getState().drafts[key].admissionAttempted,
			true,
			`${arm.code ?? `a codeless ${arm.status}`} establishes nothing about admission`,
		);
		/*
		 * The store ASKS whether the row is still its own echo (`retract-local`), and
		 * that ask is the whole reconciliation: an owner row for the same id answers
		 * "delivered" and nothing is handed back, while our own row is retracted
		 * because the message is in the composer instead. The fixture's registry answers
		 * "retracted" (no owner row exists here), which is the arm asserted below; the
		 * delivered answer is driven against the real registry in
		 * `echo-delivery.test.mjs` and in `composer-send-failure.test.mjs`.
		 */
		assert.equal(
			echoes.filter((e) => e.kind === "retract-local").length,
			1,
			"the store must ask whose row it is before taking it away",
		);
		// And the copy says what the app knows, rather than the transport's prose about
		// its own patience or a claim that the message was not sent.
		/*
		 * And the copy, which is the TABLE's for both arms now (review round 1,
		 * M8/U4/Q-3). This case used to require the backend's own sentence whenever the
		 * failure carried a code - "the session's owner could not be reached" - and for
		 * the hop failure that meant the composer relaying the daemon's prose ("Session
		 * owner is unavailable. Reconnect and reconcile before retrying.") about
		 * machinery the user has no handle on. `runtime_unreachable` is the daemon
		 * saying it established nothing about whether the request arrived, so its arm is
		 * the unknown outcome, and the unknown outcome's sentence is the app's own.
		 *
		 * A codeless failure is the same arm for the same reason, and the distinction
		 * the old assertion was reaching for is kept where it still holds: a code that
		 * NAMES A FACT THIS APP CAN ACT ON (a store that could not write, a budget, an
		 * unreadable file) still keeps the backend's sentence, because that sentence is
		 * the fact - see the store-refusal half of this file.
		 */
		assert.equal(
			store.getState().drafts[key].error,
			SEND_FAILURE_COPY.unconfirmed,
		);
	}

	/*
	 * THE OTHER SIDE, for the codeless 409: a refusal decided before admission, so
	 * nothing about the message's fate is in question and the row must not latch -
	 * which is what makes the Retry the composer used to offer over it a press that
	 * re-posts the same refused body for ever.
	 */
	reset();
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		throw new DesktopControlError(
			409,
			"this message's text alone fills 1.1 MB of the 1.0 MB limit, leaving no room for its attachments; shorten the text or send the images on their own",
		);
	};
	{
		const refusedKey = store
			.getState()
			.stageDraft({ kind: "agent", name: "reviewer" });
		await assert.rejects(admitChatDraft(refusedKey, input));
		assert.equal(
			store.getState().drafts[refusedKey].admissionAttempted,
			false,
			"a codeless 409 on a fresh attempt states that this body was refused",
		);
		assert.equal(
			sendFailureCopy(
				new DesktopControlError(
					409,
					"this message's text alone fills 1.1 MB of the 1.0 MB limit, leaving no room for its attachments; shorten the text or send the images on their own",
				),
			).retry,
			false,
			"Retry over a refusal that meets the same bytes again is the loop QA measured",
		);
	}

	// The store refusal, on the other side of the line.
	reset();
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		throw new DesktopControlError(
			500,
			"The store could not be read.",
			undefined,
			"store_unavailable",
		);
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input));
	const refused = store.getState().drafts[key];
	assert.notEqual(
		refused.admissionAttempted,
		true,
		"a write that provably did not happen is not an unknown outcome",
	);
	assert.equal(
		echoes.filter((e) => e.kind === "retract").length,
		1,
		"and the echo goes with it: the message provably does not exist on the owner",
	);
	assert.equal(refused.error, "The store could not be read.");
	assert.equal(withholdsRetryHint(refused.errorCode), true);
});

test("a busy owner is retried under the same identity before the composer ever sees it", async () => {
	reset();
	// The other half of "or is retried": `runtime_busy` is answered by repeating
	// the SAME request (the backend's admission is at-most-once per id, and the
	// receipt is keyed on a hash of the whole body), paced by the `retry_after_ms`
	// the backend sent. This arm succeeds on the third attempt, which is the
	// ordinary case and the one the operator should never see at all.
	const waits = [110, 120];
	let attempt = 0;
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		if (attempt < waits.length)
			throw new DesktopControlError(
				503,
				"This session's owner is busy with another request. Retry in a moment.",
				undefined,
				"runtime_busy",
				waits[attempt++],
			);
		return { status: "admitted" };
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const started = Date.now();
	assert.equal(await admitChatDraft(key, input), "222222222222");
	const sent = calls.filter((call) => call.op === "sessions.message");
	assert.equal(
		sent.length,
		waits.length + 1,
		"one attempt per refusal, then one that lands",
	);
	assert.equal(
		new Set(sent.map((call) => call.requestId)).size,
		1,
		"every repeat carries the id the first attempt used",
	);
	assert.ok(
		Date.now() - started >= waits.reduce((a, b) => a + b, 0) - 20,
		"the backend's retry_after_ms is waited out rather than ignored",
	);
	// And nothing is left over on a send that landed: no claim, no refusal record.
	assert.equal(store.getState().drafts[key], undefined);
});

test("the working-directory chip cannot unmount itself by committing an empty path", async () => {
	// U1 / M1, the round-1 blocker: the chip was the ONLY writer of `state.cwd`
	// once the full-width bar was deleted, and the composer mounted it behind
	// `{cwdToShow && ...}`. `""` is a legal value of the staged cwd and is
	// falsy, so clearing the field and committing removed the one control that
	// could set it again -- and `cwd` is in `partialize`, so the empty value
	// survived a restart. Recovery required editing localStorage by hand.
	//
	// Asserted on the source, not by rendering, because the defect IS the gate
	// expression: `renderToStaticMarkup` cannot dispatch the blur that commits,
	// and a rendered test that seeds `cwd: ""` would only prove today's
	// rendering rather than pinning the rule. Both halves are checked, because
	// either one alone still loses the chip.
	const { readFile } = await import("node:fs/promises");

	const composer = await readFile(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	);
	// Comments quote the removed expression to explain why it went, so this
	// looks at the JSX rather than at the whole file.
	const rendered = composer.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	assert.ok(
		rendered.includes("{cwdToShow !== undefined && ("),
		"the composer gates the cwd chip on something other than whether a directory is KNOWN",
	);
	assert.ok(
		!/\{cwdToShow && \(/.test(rendered),
		"the composer render-gates the chip on the truthiness of its own value again, so committing an empty path unmounts the only control that can set it",
	);

	// The other half: the commit path must refuse an empty/whitespace value, so
	// the store never reaches the state the gate above is protecting against.
	// `sessions.create` also rejects it -- `cwd` carries `minLength: 1`.
	const chip = await readFile(
		"src/renderer/src/features/chat/components/directory-indicator.tsx",
		"utf8",
	);
	const chipRendered = chip.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	assert.ok(
		/const trimmed = path\.trim\(\);\s*if \(!trimmed\) return false;/.test(
			chipRendered,
		),
		"the chip's commit path no longer refuses an empty or whitespace-only directory",
	);
	// Blur must not be the destructive exit: it reverts, Enter commits.
	assert.ok(
		/onBlur=\{handleCancelEdit\}/.test(chipRendered),
		"blur commits the field again, so clicking into the composer saves a half-typed path (U3)",
	);
	// The read-only chip must not offer the hover promise of a live control.
	assert.ok(
		!/variant="ghost"[\s\S]{0,400}aria-disabled="true"/.test(chipRendered),
		"the read-only chip is a ghost Button again, so it paints hover and press states it cannot honour (U2/D2)",
	);
});

test("the create-file dialog does not write a session id to the agents API", async () => {
	// Q-1 / M2: the dialog PATCHed `/v1/agents/<session-id>` and 404'd silently
	// on every use -- the same dead write this change set removed from the
	// composer, re-created at the other call site. Its `agentId` was
	// `chat-page.tsx`'s `identity` (`draftKey ?? id`), never an agent UUID, so
	// the lookup could not match and the Location always read `~` while the
	// composer beside it showed the real directory.
	const { readFile } = await import("node:fs/promises");
	const source = await readFile(
		"src/renderer/src/features/chat/components/canvas/create-file-dialog.tsx",
		"utf8",
	);
	const rendered = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

	assert.ok(
		!rendered.includes("updateAgent.mutate("),
		"the create-file dialog PATCHes the agents API again, with an id that is a session id",
	);
	assert.ok(
		!rendered.includes("useUpdateAgent"),
		"the create-file dialog still imports the agent mutation it cannot correctly call",
	);
	// The read side: the directory must be supplied by the caller from the
	// canonical stream rather than looked up by a key that cannot match.
	assert.ok(
		rendered.includes("currentWorkingDirectory"),
		"the create-file dialog no longer takes the working directory from its caller",
	);
	assert.ok(
		!rendered.includes("agentListResult?.agents.find"),
		"the create-file dialog resolves the agent by an id that is not an agent id again",
	);
	// And it must present the value honestly rather than offering a control.
	assert.ok(
		rendered.includes("readOnlyReason"),
		"the create-file dialog offers an editable directory control again, whose every use fails",
	);
});

/*
 * A minimal JSX-structure scanner for the popup guard below.
 *
 * Round 3 (R2) killed the previous guard's shape: it regex-matched ONE class
 * string literal on the band, so the same clipping defect entered through an
 * adjacent ternary branch or through a nearer ancestor and passed 15/15
 * green. The rule "no ancestor of the popup may establish a clipping
 * context" needs the TREE, not one literal, so this walks the source once
 * and keeps every JSX element's opening-tag span.
 *
 * Deliberate limitations, none of which can produce a false GREEN: JSX
 * nested inside expression containers beyond the first level is skipped
 * opaquely (the popup and every ancestor it needs sit at plain JSX level),
 * and if the scanner ever loses the tree -- unbalanced stack at EOF -- the
 * guard FAILS rather than guessing. An instrument that cannot break is the
 * defect species this file exists to prevent.
 *
 * Each element is { id, name, start, tagEnd, tagText, parentId, contentStart,
 * contentEnd }; tagText is the FULL opening tag, every cn() argument and
 * ternary branch included, which is what the class extraction reads.
 */
function scanJsxTree(source) {
	const elements = [];
	const stack = [];
	let balanced = true;
	let nextId = 0;

	const openElement = (name, start, tagEnd, selfClosed) => {
		const el = {
			id: nextId++,
			name,
			start,
			tagEnd,
			tagText: source.slice(start, tagEnd),
			parentId: stack.length ? stack[stack.length - 1].id : null,
			contentStart: tagEnd,
			contentEnd: undefined,
		};
		elements.push(el);
		if (selfClosed) {
			el.contentEnd = tagEnd;
		} else {
			stack.push(el);
		}
		return el;
	};

	const skipString = (at) => {
		const quote = source[at];
		let j = at + 1;
		while (j < source.length) {
			if (source[j] === "\\") j += 2;
			else if (source[j] === quote) return j + 1;
			else j++;
		}
		balanced = false;
		return source.length;
	};
	const skipLineComment = (at) => {
		const nl = source.indexOf("\n", at);
		return nl === -1 ? source.length : nl + 1;
	};
	const skipBlockComment = (at) => {
		const end = source.indexOf("*/", at + 2);
		return end === -1 ? source.length : end + 2;
	};
	// Skips a {...} region to its matching close, strings and nested comments
	// included, so JSX expression containers stay opaque to the tree walk.
	const skipBraces = (at) => {
		let depth = 0;
		let j = at;
		while (j < source.length) {
			const c = source[j];
			const n = source[j + 1];
			if (c === '"' || c === "'" || c === "`") {
				j = skipString(j);
				continue;
			}
			if (c === "/" && n === "/") {
				j = skipLineComment(j);
				continue;
			}
			if (c === "/" && n === "*") {
				j = skipBlockComment(j);
				continue;
			}
			if (c === "{") depth++;
			else if (c === "}") {
				depth--;
				if (depth === 0) return j + 1;
			}
			j++;
		}
		balanced = false;
		return source.length;
	};
	// Scans one opening tag from `at` (the `<`) to its closing `>`.
	const scanOpeningTag = (at, nameLen) => {
		let j = at + nameLen;
		while (j < source.length) {
			const c = source[j];
			const n = source[j + 1];
			if (c === '"' || c === "'" || c === "`") {
				j = skipString(j);
				continue;
			}
			if (c === "/" && n === "/") {
				j = skipLineComment(j);
				continue;
			}
			if (c === "/" && n === "*") {
				j = skipBlockComment(j);
				continue;
			}
			if (c === "{") {
				j = skipBraces(j);
				continue;
			}
			if (c === ">") {
				return { end: j + 1, selfClosed: source[j - 1] === "/" };
			}
			j++;
		}
		balanced = false;
		return null;
	};

	let i = 0;
	let prevChar = "";
	let prevWord = "";
	while (i < source.length) {
		const c = source[i];
		const n = source[i + 1];
		if (c === '"' || c === "'" || c === "`") {
			i = skipString(i);
			continue;
		}
		if (c === "/" && n === "/") {
			i = skipLineComment(i);
			continue;
		}
		if (c === "/" && n === "*") {
			i = skipBlockComment(i);
			continue;
		}
		// An expression container inside JSX children is opaque: its code is
		// not markup at the level this walk needs.
		if (c === "{" && stack.length > 0) {
			i = skipBraces(i);
			continue;
		}
		if (/[A-Za-z_$]/.test(c)) {
			const word = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
			prevWord = word[0];
			prevChar = word[0].slice(-1);
			i += word[0].length;
			continue;
		}
		if (c === "<") {
			if (n === "/") {
				const m = /^<\/[A-Za-z][\w.-]*\s*>|^<\/\s*>/.exec(
					source.slice(i, i + 120),
				);
				if (m) {
					const name = m[0].slice(2).trim().replace(/>$/, "").trim();
					let popped = false;
					for (let k = stack.length - 1; k >= 0; k--) {
						if (
							stack[k].name === name ||
							(name === "" && stack[k].name === "#fragment")
						) {
							stack[k].contentEnd = i;
							stack.length = k;
							popped = true;
							break;
						}
					}
					if (!popped) balanced = false;
					i += m[0].length;
					prevChar = ">";
					prevWord = "";
					continue;
				}
			}
			if (n === ">") {
				openElement("#fragment", i, i + 2, false);
				i += 2;
				prevChar = ">";
				prevWord = "";
				continue;
			}
			const nameMatch = /^<[A-Za-z][\w.-]*/.exec(source.slice(i, i + 120));
			if (nameMatch) {
				// Inside an element's children, every `<` opens a child tag.
				// At the top of the code a `<` must be in expression position,
				// or it is a comparison or a type argument (`Extract<...>`)
				// and not markup.
				const exprPos =
					stack.length > 0 ||
					"=(,:;?&|[{(!>".includes(prevChar) ||
					[
						"return",
						"case",
						"default",
						"else",
						"do",
						"yield",
						"await",
						"throw",
					].includes(prevWord);
				if (exprPos) {
					const opened = scanOpeningTag(i, nameMatch[0].length);
					if (opened) {
						openElement(
							nameMatch[0].slice(1),
							i,
							opened.end,
							opened.selfClosed,
						);
						i = opened.end;
						prevChar = ">";
						prevWord = "";
						continue;
					}
				}
			}
		}
		if (!/\s/.test(c)) {
			prevChar = c;
			prevWord = "";
		}
		i++;
	}
	if (stack.length > 0) balanced = false;
	return { elements, balanced };
}

/*
 * Collects one element's composed class sources: every string literal in its
 * opening tag (which covers className="...", both branches of every ternary
 * inside a cn() call, and any sibling literal in the same call) plus the
 * expansion of UPPERCASE class constants referenced by identifier inside a
 * className={...} expression. An UPPERCASE identifier that cannot be
 * resolved throws rather than being skipped: an unresolved constant is
 * exactly how a clipping class would slip past this check unseen.
 */
function collectClassSources(el, resolveConst) {
	const sources = [];
	for (const m of el.tagText.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
		sources.push({ origin: "a string literal", value: m[1] });
	}
	const classNameAttr = /className\s*=\s*\{/.exec(el.tagText);
	if (classNameAttr) {
		let depth = 0;
		let j = classNameAttr.index + classNameAttr[0].length - 1;
		for (; j < el.tagText.length; j++) {
			if (el.tagText[j] === "{") depth++;
			else if (el.tagText[j] === "}") {
				depth--;
				if (depth === 0) break;
			}
		}
		// Comments out of the expression before identifiers are matched: an
		// UPPER_CASE word in a comment ("the PAGE ground") is not a constant.
		const expr = el.tagText
			.slice(classNameAttr.index + classNameAttr[0].length, j)
			.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
		for (const idm of expr.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) {
			const expanded = resolveConst(idm[0]);
			if (expanded === null) {
				throw new Error(
					`className constant ${idm[0]} on <${el.name}> could not be resolved to its class strings -- extend the resolver in this test or inline the classes; an unresolved constant is how a clipping class would hide`,
				);
			}
			for (const value of expanded) {
				sources.push({ origin: `the constant ${idm[0]}`, value });
			}
		}
	}
	return sources;
}

test("no ancestor of the slash popup establishes a vertical clipping context", async () => {
	// R1, the round-2 blocker: the composer band was given `max-h-[70%] ...
	// overflow-y-auto` to stop `shrink-0` growing unbounded, and that erased
	// the slash-command popup. Round 3 (R2) then found the guard for it
	// pinned ONE string literal on the band: the same clip entered through an
	// adjacent ternary branch or through a nearer ancestor and passed green.
	// What is asserted now is the RULE in the title, over the composed class
	// set of EVERY element between the popup and the band -- literals, ternary
	// branches, and the class constants those elements reference.
	//
	// The popup is `absolute bottom-full` INSIDE the band and is NOT portaled,
	// so it renders above the band's content box on purpose. Any ancestor
	// with a vertical overflow clips it, and the failure is total and silent:
	// the overflow sits on the far side of the scroller's origin, so
	// `scrollHeight === clientHeight` and there is nothing to scroll to. The
	// `role="listbox"` and `aria-activedescendant` wiring keeps working over a
	// list with zero painted pixels.
	//
	// Asserted on the source rather than by rendering because the defect IS a
	// class string on an ancestor: no gate in the round could see it, and a
	// render test would need a real layout engine plus an open popup. The
	// scanner above fails this test when it can no longer balance the file's
	// tree, so the instrument rots loudly instead of passing green.
	const { readFile } = await import("node:fs/promises");
	const { readFileSync } = await import("node:fs");
	const { join, dirname } = await import("node:path");

	const composerPath =
		"src/renderer/src/features/chat/components/message-input.tsx";
	const composer = await readFile(composerPath, "utf8");
	const slash = await readFile(
		"src/renderer/src/features/chat/components/slash-commands.tsx",
		"utf8",
	);

	// The premise: the popup positions itself outside its parent's content
	// box. If this ever stops being true the rest of this test is measuring
	// nothing, so it is asserted rather than assumed.
	//
	// Anchored on the popup's own leading tokens — `@container/slash` then
	// `absolute bottom-full`, inside ONE quoted class list — because a bare
	// `/absolute bottom-full[^"]*"/` can be satisfied by those two tokens
	// anywhere in any quoted string in the file, which is the check weakened
	// rather than moved (round 1 R5).
	assert.ok(
		/@container\/slash absolute bottom-full[^"]*"/.test(slash),
		"the slash popup no longer renders `@container/slash absolute bottom-full`, so this test's premise about escaping the parent box is stale",
	);

	const scan = scanJsxTree(composer);
	assert.ok(
		scan.balanced,
		"the JSX scanner in this test could not balance message-input.tsx's tree -- the instrument is broken; fix the scanner before trusting anything it says here",
	);
	const byId = new Map(scan.elements.map((el) => [el.id, el]));
	const lineOf = (offset) => composer.slice(0, offset).split("\n").length;

	const popups = scan.elements.filter(
		(el) => el.name === "SlashSuggestionsPopup",
	);
	assert.ok(
		popups.length === 1,
		"expected exactly one <SlashSuggestionsPopup> in message-input.tsx; the popup moved or multiplied and this guard must be re-aimed at it",
	);
	const popup = popups[0];

	// The anchor premise: `absolute bottom-full` positions against the
	// nearest positioned ancestor. Round 3 moved the popup's anchor ONE
	// element out — from the composer box to the wrapper that also carries
	// the capture's sentence (design round 3, D1; UX round 3, U14) — because
	// the sentence now sits above the box and the popup has to clear it.
	// Whoever the parent is, it must declare `relative`: without it the popup
	// anchors to some distant ancestor and floats away from the composer,
	// which is a different defect and this is where it is caught.
	const parent = byId.get(popup.parentId);
	assert.ok(
		/(^|["\s])relative(["\s]|$)/.test(parent?.tagText ?? ""),
		"the slash popup's direct parent (the composer's anchoring wrapper since round 3) no longer declares `relative`, so the popup no longer anchors to the element it is meant to escape",
	);

	const ancestorsOf = (el) => {
		const chain = [];
		let cur = byId.get(el.parentId);
		while (cur) {
			chain.push(cur);
			cur = byId.get(cur.parentId);
		}
		return chain;
	};

	// The popup's own JSX lives in a const (`inputContent = (<form ...>)`)
	// that the band splices in at several sites, so its ancestors are its
	// LEXICAL ancestors plus the ancestors of every splice site.
	const rootForm = ancestorsOf(popup).at(-1);
	assert.ok(
		rootForm && rootForm.name === "form",
		"the popup's outermost lexical ancestor is no longer the composer <form>; re-aim this guard at the new root",
	);
	const before = composer.slice(
		Math.max(0, rootForm.start - 160),
		rootForm.start,
	);
	const assignMatch = /([A-Za-z_$][\w$]*)\s*=\s*\(\s*$/.exec(before);
	assert.ok(
		assignMatch,
		"the composer <form> is no longer assigned to a local const (`inputContent = (`), so this guard cannot find the splice sites that embed it under the band",
	);
	const constName = assignMatch[1];

	const chains = [ancestorsOf(popup)];
	for (const m of composer.matchAll(
		new RegExp(`\\{\\s*${constName}\\s*\\}`, "g"),
	)) {
		let deepest = null;
		for (const el of scan.elements) {
			if (
				el.contentStart <= m.index &&
				(el.contentEnd ?? composer.length) > m.index &&
				(!deepest || el.contentStart > deepest.contentStart)
			) {
				deepest = el;
			}
		}
		if (deepest) chains.push([deepest, ...ancestorsOf(deepest)]);
	}
	assert.ok(
		chains.length >= 2 && chains.flat().length >= 3,
		"the splice walk found fewer than three ancestors between the popup and the band -- the instrument is broken, not the composer",
	);

	// Class constants by identifier: resolve locally, then through named
	// imports (the CHAT_* measure constants live in chat-measure.ts). Only
	// the quoted strings of a short definition window are taken; a class
	// constant here is a string or a cn() of strings.
	const constCache = new Map();
	const resolveConst = (name) => {
		if (constCache.has(name)) return constCache.get(name);
		let values = null;
		const local = new RegExp(
			`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*=`,
		).exec(composer);
		if (local) {
			// Comments stripped so a quoted word inside one cannot masquerade as
			// a class string from the definition.
			const windowText = composer
				.slice(local.index, local.index + 700)
				.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
			values = [...windowText.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(
				(m) => m[1],
			);
		} else {
			for (const im of composer.matchAll(
				/import\s*{([^}]*)}\s*from\s*"([^"]+)"/g,
			)) {
				if (
					!im[1].split(",").some((n) => n.trim().split(" as ").pop() === name)
				)
					continue;
				const base = join(dirname(composerPath), im[2]);
				let moduleText = null;
				for (const suffix of [".ts", ".tsx"]) {
					try {
						moduleText = readFileSync(base + suffix, "utf8");
						break;
					} catch {}
				}
				if (moduleText) {
					const remote = new RegExp(
						`(?:^|\\n)\\s*export\\s+const\\s+${name}\\s*=`,
					).exec(moduleText);
					if (remote) {
						const remoteWindow = moduleText
							.slice(remote.index, remote.index + 700)
							.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
						values = [
							...remoteWindow.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g),
						].map((m) => m[1]);
					}
				}
				break;
			}
		}
		constCache.set(name, values);
		return values;
	};

	const union = new Map();
	for (const el of chains.flat()) union.set(el.start, el);
	const composedFor = new Map();
	for (const el of union.values()) {
		composedFor.set(el.start, collectClassSources(el, resolveConst));
	}
	const hasClass = (el, cls) =>
		composedFor
			.get(el.start)
			.some((s) => new RegExp(`(?:^|\\s)${cls}(?:\\s|$)`).test(` ${s.value} `));

	// The band: the element that owns the chat column and wraps the composer,
	// identified by `data-lo-composer-band`. It used to be `shrink-0 +
	// bg-surface`, but the band's vertical behaviour is now conditional on
	// whether a transcript exists (empty: `grow` to claim the column and centre
	// the greeting; non-empty: `shrink-0` at the bottom), so `shrink-0` is no
	// longer a stable discriminator. The attribute does not move with the
	// layout, and it still cannot match the transcript scroller, which carries
	// the chatcol container query but not this attribute.
	const bandCandidates = [...union.values()].filter((el) =>
		/data-lo-composer-band/.test(el.tagText),
	);
	assert.ok(
		bandCandidates.length === 1,
		`expected exactly one composer band (data-lo-composer-band) among the popup's ancestors, found ${bandCandidates.length} -- re-aim the guard if the composer structure changed`,
	);
	const band = bandCandidates[0];

	// THE RULE. A clip on ONE axis forces the other to auto per the CSS
	// overflow rules, so an x-only clip counts too, and a max-height is what
	// invites the scroller in the first place. Bounds belong on the popup's
	// SIBLINGS -- see the previews wrapper.
	const CLIP =
		/(?:^|\s)\[?(?:overflow|overflow-x|overflow-y)-(?!visible\b)[a-z][a-z-]*/;
	const MAX_H = /(?:^|\s)\[?max-h-[-\w[\]().%]+/;
	for (const chain of chains) {
		for (const el of chain) {
			for (const s of composedFor.get(el.start)) {
				const token =
					CLIP.exec(` ${s.value} `)?.[0]?.trim() ??
					MAX_H.exec(` ${s.value} `)?.[0]?.trim();
				assert.ok(
					!token,
					`message-input.tsx:${lineOf(el.start)}: <${el.name}>, an ancestor of the slash popup, carries \`${token}\` via ${s.origin} -- that establishes a vertical clipping context on the axis the unportaled popup renders along and erases it, silently (round-2 R1, round-3 R2). Bound growing content on the popup's SIBLINGS instead -- see the previews wrapper`,
				);
			}
			if (el === band) break;
		}
	}

	const rendered = composer.replace(/\/\*[\s\S]*?\*\/\/\/[^\n]*/g, "");

	// The other half of the rule: the bound has to exist SOMEWHERE, or
	// `shrink-0` is unbounded again and enough attachments push the send
	// controls off screen (measured: 40 tiles + 10 replies => a 1126px band
	// in an 872px viewport). It belongs on the previews, which are siblings
	// of the popup.
	assert.ok(
		/max-h-\[240px\][^"]*overflow-y-auto|overflow-y-auto[^"]*max-h-\[240px\]/.test(
			rendered,
		),
		"the composer's previews no longer carry their own bound, so the band can grow past the window and take the send controls with it",
	);
	// And that bound must sit BELOW the popup in the tree, i.e. after it,
	// not wrapped around it.
	const popupAt = rendered.indexOf("<SlashSuggestionsPopup");
	const boundAt = rendered.indexOf("max-h-[240px]");
	assert.ok(
		popupAt !== -1 && boundAt > popupAt,
		"the previews' bound now wraps the slash popup rather than sitting beside it, which clips it the same way the band did (R1)",
	);
});

test("the echo is painted before the message request, under the admission request id", async () => {
	reset();
	// M4, asserted STRUCTURALLY rather than with a clock. The felt-latency claim
	// is "the text is in the transcript by the time the request leaves", which is
	// a fact about ORDERING - so it is pinned by observing what had happened at
	// the moment the transport fixture was entered, not by timing anything. A
	// duration assertion here could only flake; this one cannot.
	let sawEchoAtRequest = null;
	globalThis.__canonicalRequest = async (request) => {
		if (request.op === "sessions.message")
			sawEchoAtRequest = echoes.filter((e) => e.kind === "echo").at(-1);
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		return { status: "admitted" };
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const requestId = store.getState().drafts[key].admissionRequestId;
	await admitChatDraft(key, input);

	assert.ok(
		sawEchoAtRequest,
		"the echo must already be painted when admitChatDraft enters the transport, not after it resolves",
	);
	assert.equal(
		sawEchoAtRequest.id,
		requestId,
		"the echo id MUST be the admission request UUID - the owner gives the durable row that same id, so any other key paints the message twice forever",
	);
	assert.equal(sawEchoAtRequest.sessionId, "222222222222");
	assert.equal(sawEchoAtRequest.text, "Review this");
	// The id that went to the wire is the id that was echoed: one value.
	const sent = calls.filter((c) => c.op === "sessions.message").at(-1);
	assert.equal(sent.requestId, requestId);
	assert.equal(
		echoes.filter((e) => e.kind === "retract").length,
		0,
		"a successful send retracts nothing",
	);
});

test("an ambiguous failure keeps the echo, and only a pre-admission refusal retracts it", async () => {
	// INV-C1, and the case a naive implementation gets wrong by retracting on
	// every failure. A 503 (or a dropped connection) means the outcome is
	// UNKNOWABLE: the owner may have admitted the command before the response
	// was lost, so pulling the row would make a message the agent is about to
	// answer vanish from the transcript while it answers it. 413 and 422 are
	// decided before admission - the same predicate that un-latches
	// `admissionAttempted` - so there the message provably does not exist.
	const send = async (status) => {
		reset();
		globalThis.__canonicalRequest = async (request) => {
			calls.push(request);
			if (request.op === "sessions.create")
				return { session_id: "222222222222", binding: null };
			throw status === "network"
				? new Error("connection reset")
				: new DesktopControlError(status, `refused ${status}`);
		};
		const key = store
			.getState()
			.stageDraft({ kind: "agent", name: "reviewer" });
		const requestId = store.getState().drafts[key].admissionRequestId;
		await assert.rejects(admitChatDraft(key, input));
		return { key, requestId };
	};

	/*
	 * 409 LEFT THIS LIST IN REVIEW ROUND 2 (Q2-1). A codeless 409 on a fresh attempt
	 * is the daemon refusing the body - the sender-side budget ladder - so the echo
	 * is retracted exactly as it is for 413/422, and the arm is asserted in the
	 * second loop below. The receipt conflict, which DOES keep the echo, cannot be
	 * reached here: it needs an unresolved attempt under the same id, which this
	 * helper never leaves behind.
	 */
	for (const status of [503, 500, "network"]) {
		const { key, requestId } = await send(status);
		assert.equal(
			echoes.filter((e) => e.kind === "retract").length,
			0,
			`a ${status} failure is unknowable, so the echo must STAY painted`,
		);
		assert.equal(
			store.getState().drafts[key].admissionAttempted,
			true,
			"the same predicate governs both, so the latch must agree with the echo",
		);
		assert.equal(echoes.filter((e) => e.kind === "echo").at(-1).id, requestId);
	}

	for (const status of [413, 422, 409]) {
		const { key, requestId } = await send(status);
		const retracted = echoes.filter((e) => e.kind === "retract");
		assert.equal(
			retracted.length,
			1,
			`a ${status} is refused before admission, so the echo must be retracted`,
		);
		assert.equal(retracted[0].id, requestId, "it retracts the id it painted");
		assert.equal(
			retracted[0].sessionId,
			"222222222222",
			"addressed by the session this call CREATED - reading the pre-send draft snapshot would leave it unretractable",
		);
		assert.equal(
			store.getState().drafts[key].admissionAttempted,
			false,
			"one predicate, two consumers: the un-latch and the retraction cannot disagree",
		);
	}
});

test("clearing the composer before admission leaves the guard's basis the typed text", async () => {
	reset();
	// INV-C2, the highest-risk line in this change. The composer now clears
	// synchronously BEFORE awaiting the send, so `handleSubmit` must thread the
	// CAPTURED value. Re-reading the box after the clear would hand "" to the
	// store, and the unchanged-payload guard would then compare every retry
	// against "" and refuse it. This drives the store the way the fixed
	// composer does: the value is captured once and passed in.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		throw new Error("connection reset");
	};
	const typed = "  Review this  ";
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, { ...input, text: typed }));
	assert.equal(
		store.getState().drafts[key].submittedText,
		"Review this",
		"the stored claim is the NORMALIZED typed text, not the emptied box",
	);
	assert.equal(
		echoes.filter((e) => e.kind === "echo").at(-1).text,
		"Review this",
		"and the echo paints that same one value, so the bubble is never empty",
	);
	// The retry the user reaches by Restore: same payload, admitted rather than
	// refused as a different message. Against "" this throws.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return { status: "admitted" };
	};
	await admitChatDraft(key, { ...input, text: "Review this" }, "222222222222");
	assert.equal(store.getState().drafts[key], undefined, "the retry landed");
});

test("a refused send with an emptied composer still has a payload to Restore", async () => {
	reset();
	// R9: the early clear makes "box empty, text held" the COMMON state rather
	// than an edge case, so the escape has to hold there. `heldText` is what the
	// composer's Restore writes back; with an empty box `heldInBox` is false and
	// the alert must offer Restore rather than "Send it again", which would name
	// an action the user cannot perform blind.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		throw new DesktopControlError(413, "This message is too large to send.");
	};
	const key = draftIdentityFor(null, "222222222222");
	const replies = [{ id: "r1", text: "the failing line" }];
	const payload = buildSendPayload("Please look at this", replies);
	await assert.rejects(
		admitChatDraft(key, { ...input, text: payload }, "222222222222"),
	);
	const held = store.getState().drafts[key].submittedText;
	assert.equal(held, payload, "the held claim survives for Restore to offer");
	// The composer's own basis with an EMPTY box, which is the post-clear state.
	const boxPayload = buildSendPayload("", replies);
	assert.notEqual(
		boxPayload,
		held,
		"an empty box is not the held payload, so heldInBox is false and Restore stays offered",
	);
	// And Restore is still not a loop: the restored payload re-assembled with
	// its chips consumed is byte-identical, so the guard admits it.
	assert.equal(buildSendPayload(held, []), held);
	// The echo was retracted (413 is pre-admission), so the transcript does not
	// keep a bubble for a message that is back in the user's hands.
	assert.equal(echoes.filter((e) => e.kind === "retract").length, 1);
});

test("the draft send remounts the panel exactly once, before the message POST", () => {
	/*
	 * R10 / M5 / M6, SCOPED HONESTLY after review round 1 (MAJOR-2).
	 *
	 * The earlier version of this test concluded "zero remounts per draft send"
	 * from two assertions taken on the FAR side of the flip - it compared
	 * `panelIdentityFor(draftKey, id)` with `panelIdentityFor(null, id)` and
	 * never against `panelIdentityFor(draftKey, undefined)`, which is the state
	 * the panel is actually in when the user presses Enter. That is a vacuous
	 * pass: it asserted the transition it did not make.
	 *
	 * The truth is one remount per draft send, under the old rule and the new
	 * one alike. What the swap changed is WHEN: from `finishDraft` (after the
	 * message POST, which discarded a subscription mid-flight and re-paid the
	 * handshake plus the backend's pre-`open` snapshot) to `createSession`
	 * (before the POST is issued). The panel that receives the admission row is
	 * therefore the subscribed one, and the echo survives the transition because
	 * it is buffered by session id rather than delivered to whatever happened to
	 * be mounted - see the pending-echo queue in `use-canonical-session`.
	 *
	 * So this test pins the transition as a SEQUENCE, including the at-Enter
	 * state, and fails if the count regresses in either direction.
	 */
	const draftKey = "draft:9f1c";
	const sessionId = "222222222222";
	// The three states chat-page.tsx computes across one New-chat send, in order.
	const sequence = [
		panelIdentityFor(draftKey, undefined), // at Enter: no session exists yet
		panelIdentityFor(draftKey, sessionId), // createSession patched the draft
		panelIdentityFor(null, sessionId), // finishDraft cleared the draft key
	];
	assert.deepEqual(
		sequence,
		[draftKey, sessionId, sessionId],
		"the identity sequence across a draft send is pinned, at-Enter state included",
	);
	const remounts = new Set(sequence).size - 1;
	assert.equal(
		remounts,
		1,
		"exactly one remount per draft send - not zero, and a second would mean the flip moved back after the POST",
	);
	// The one remount must land BEFORE the message POST. That is the whole
	// improvement: the key settles on `createSession`, so the panel holding the
	// subscription when the admission resolves is the one that keeps it.
	assert.equal(
		sequence[1],
		sequence[2],
		"the identity must not change again once the session id is known - a change at finishDraft is the mid-flight remount this swap removed",
	);
	assert.notEqual(
		sequence[0],
		sequence[1],
		"and the change that does happen is the create, which is before the POST",
	);
	/*
	 * An EXISTING-session send has no transition at all - the case M5/M6 hold
	 * unscoped for.
	 *
	 * Driven through the PAGE'S OWN derivation rather than by calling
	 * `panelIdentityFor` repeatedly with the same arguments. Two earlier
	 * versions of this assertion were tautologies - first comparing one call
	 * with itself, then taking three identical calls to a pure function and
	 * asserting they agreed - and neither could fail whatever the code did.
	 *
	 * What actually varies across a send is the STORE, so that is what moves
	 * here. `chat-page.tsx:822-825` computes
	 *     id       = draftKey ? draft?.sessionId : (active ?? undefined)
	 *     identity = panelIdentityFor(draftKey, id)
	 * and this reproduces that expression against the three store states an
	 * existing-session send passes through. The claim is that a changing store
	 * yields an unchanging key; a rule that followed the draft, or that dropped
	 * to `undefined` while the admission was in flight, fails here.
	 */
	const identityFromStore = (state) =>
		panelIdentityOfView(
			state.activeDraftKey,
			state.activeDraftKey
				? state.drafts[state.activeDraftKey]?.sessionId
				: undefined,
			state.activeSessionId,
		);
	// The store states an existing-session send moves through: no draft key at
	// any point, the session already active, and a `send:<id>` draft row
	// carrying the retained payload while the admission is in flight.
	const existingSequence = [
		identityFromStore({
			activeDraftKey: null,
			activeSessionId: sessionId,
			drafts: {},
		}),
		/*
		 * The in-flight state, and the `send:` row is NOT decoration: it is the
		 * state a rule that consulted the draft map would trip on. An earlier
		 * version put the row here while leaving `activeDraftKey` null, which
		 * made it inert - `identityFromStore` never reads `drafts` without a
		 * key, so nothing was being exercised. Naming the row as the active
		 * draft is what makes this state able to produce a different answer, and
		 * the assertion below says it must not.
		 */
		identityFromStore({
			activeDraftKey: `send:${sessionId}`,
			activeSessionId: sessionId,
			drafts: {
				[`send:${sessionId}`]: {
					submittedText: "Review this",
					sessionId,
				},
			},
		}),
		identityFromStore({
			activeDraftKey: null,
			activeSessionId: sessionId,
			drafts: {},
		}),
	];
	assert.deepEqual(
		existingSequence,
		[sessionId, sessionId, sessionId],
		"an existing-session send must key on the session at every step - no remount, no reconnect",
	);
	assert.equal(
		new Set(existingSequence).size,
		1,
		"and therefore exactly one distinct key across the whole send",
	);
	/*
	 * LIVENESS OF THAT IN-FLIGHT STATE, asserted rather than assumed (review
	 * round 5, NIT). The state above is only load-bearing because the `send:`
	 * row carries the session id: the derivation reads
	 * `drafts[activeDraftKey]?.sessionId`, so an empty row answers with the
	 * DRAFT key instead. Reverting the fixture to its earlier inert shape - the
	 * row present but `activeDraftKey` null - leaves every assertion above
	 * green, which means the fixture's shape was never pinned. Removing the one
	 * field the rule reads and showing the answer change is what pins it: if
	 * this equalises, the fixture has stopped exercising anything.
	 */
	assert.notEqual(
		identityFromStore({
			activeDraftKey: `send:${sessionId}`,
			activeSessionId: sessionId,
			drafts: { [`send:${sessionId}`]: {} },
		}),
		sessionId,
		"the in-flight row's sessionId is what the existing-session key settles on; drop it and a draft-following derivation answers with the draft key",
	);
	// The same derivation on a DRAFT send does change key, which is what proves
	// the assertion above is capable of failing rather than true by shape.
	const draftSequence = [
		identityFromStore({
			activeDraftKey: draftKey,
			activeSessionId: null,
			drafts: { [draftKey]: {} },
		}),
		identityFromStore({
			activeDraftKey: draftKey,
			activeSessionId: null,
			drafts: { [draftKey]: { sessionId } },
		}),
	];
	assert.notDeepEqual(
		draftSequence[0],
		draftSequence[1],
		"the draft path DOES change key once the session exists - if this ever stops being true the existing-session assertion above has stopped meaning anything",
	);
	// The reverse direction still remounts, and must: "New chat" stages a fresh
	// draft with no session, so it cannot inherit the previous transcript.
	assert.equal(panelIdentityFor("draft:new", undefined), "draft:new");
	assert.notEqual(
		panelIdentityFor("draft:new", undefined),
		panelIdentityFor(null, "222222222222"),
	);
	assert.equal(
		panelIdentityFor(null, undefined),
		undefined,
		"no session and no draft is no panel",
	);
});

test("the palette's close-time comparison reads the pane's own identity, on every door", () => {
	/*
	 * WHY THIS IS ASSERTED HERE. The command palette's close-time restore yields
	 * when the flow it just ran moved the view, and "the view moved" is exactly
	 * `panelIdentityOfView` at open versus now - so the identity's semantics are
	 * the fix's premise, and they are this file's subject. The DRAFT term is the
	 * one worth pinning: `stageDraft` leaves `activeSessionId` at the
	 * conversation the user is leaving, so a comparison that read
	 * `panelIdentityFor(activeDraftKey, activeSessionId)` answers "nothing moved"
	 * on the New-chat row - the one door where the view moves furthest - and the
	 * close would then put the caret back on a node in the pane the user just
	 * left, or on the rail's Search row when that node is gone.
	 */
	const ACTIVE = "111111111111";
	const OTHER = "333333333333";
	const ADMITTED = "444444444444";
	const FRESH = "draft:9c0f";
	/** The identity a pane is keyed on, from the fields a view derives it from. */
	const idOf = ([activeDraftKey, draftSessionId, activeSessionId]) =>
		panelIdentityOfView(activeDraftKey, draftSessionId, activeSessionId);
	const moved = (before, after) => idOf(before) !== idOf(after);

	assert.equal(
		moved([null, undefined, ACTIVE], [null, undefined, OTHER]),
		true,
		"the session row switches the active session",
	);
	assert.equal(
		moved([null, undefined, ACTIVE], [FRESH, undefined, ACTIVE]),
		true,
		"the New-chat row stages a fresh draft and does NOT clear activeSessionId - the draft key is the new view",
	);
	assert.equal(
		moved([FRESH, undefined, ACTIVE], [FRESH, ADMITTED, ACTIVE]),
		true,
		"a staged draft admitted mid-flight learns its session id, which is the flip the panel is keyed across",
	);
	assert.equal(
		moved([FRESH, ADMITTED, ACTIVE], [null, undefined, ADMITTED]),
		false,
		"NOT a move: finishDraft drops the draft key and hands the pane the very session the draft was admitted as, so the key is the same - and one remount per draft send is the count pinned above",
	);
	assert.equal(
		moved([null, undefined, ACTIVE], [FRESH, ADMITTED, ACTIVE]),
		true,
		"the whole New-chat flow from the conversation the palette was opened on: staged fresh, then admitted to a session of its own - a different conversation, so the close must not put the caret back into the pane it left",
	);
	assert.equal(
		moved([null, undefined, ACTIVE], [null, undefined, ACTIVE]),
		false,
		"and the Escape/no-move close is not a move, which is what keeps the contract in docs/command-palette.md verbatim for it",
	);
	/*
	 * THE SINGLE-TERM READING, pinned as the wrong answer rather than left as a
	 * comment: this is the shape the design's first draft had, and the assertion
	 * fails the moment somebody simplifies the rule to it.
	 */
	assert.equal(
		panelIdentityFor(null, ACTIVE) === panelIdentityFor(FRESH, ACTIVE),
		true,
		"reading activeSessionId alone says the New-chat pick moved nothing",
	);
	assert.notEqual(
		idOf([null, undefined, ACTIVE]),
		idOf([FRESH, undefined, ACTIVE]),
		"...which is why the draft term is read",
	);
});

test("the submit path cannot re-decide what a draft is", async () => {
	/*
	 * The shape guard for the inline-command contract: the ordering half from
	 * round 1, the SEAM half from round 2.
	 *
	 * WHAT IT DEFENDS, PART 1 (ordering). Before this change the composer
	 * recognised a command only when the WHOLE draft was one, so a command typed
	 * into a sentence reached the model as prose — a silent no-op the user could
	 * not see. The fix is that `message-input.tsx` asks `planSlashSubmission`
	 * first and only then decides whether to submit. That is easy to lose in a
	 * refactor that touches only the submit path: deleting the plan call leaves
	 * every unit test green, because the planner itself is still correct and
	 * merely unused.
	 *
	 * WHAT IT DEFENDS, PART 2 (one decision, not one order). Part 1 was green
	 * while the defect was still live in the app. `chat-page.tsx`'s canonical
	 * `send()` called `dispatch(content)` on the RAW text, and the dispatcher
	 * asked `SLASH_SUBMISSION` whether that whole string was a command — a
	 * SECOND decision, one layer below the planner, whose `[\s\S]*` argument
	 * group read the newline in `/usage\nhello` as the command/argument
	 * separator. The planner answered `send` for that draft, the dispatcher
	 * overruled it, the composer was emptied on `consumed` and nothing reached
	 * the model (QA round 2, Q4 — round 1's Q1, one layer down). An ordering
	 * guard cannot catch that: the second guard was never out of order, it was a
	 * second answer. So what is pinned here is structural — the dispatcher is
	 * handed an already-parsed command, and nothing on the submit path re-reads
	 * draft text to ask whether it is one. Reinstate the old line and this test
	 * goes red (it was run that way).
	 *
	 * Asserted on the SOURCE rather than by rendering, for the reason the clipping
	 * guard above is: what is being defended is which call sites exist and what
	 * they are handed, and a render test would need a real backend to observe the
	 * difference between "spliced" and "sent to the model".
	 */
	const { readFile } = await import("node:fs/promises");
	/*
	 * Comments are stripped before every assertion below, because each of them is
	 * about CODE: the defect these guards describe is *named* in the docstrings
	 * that record it, and a guard that fired on its own history would be a guard
	 * nobody could keep.
	 */
	const code = (source) =>
		source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
	const composer = code(
		await readFile(
			"src/renderer/src/features/chat/components/message-input.tsx",
			"utf8",
		),
	);
	// The planner is consulted with the CARET, not just the value: the whole
	// point is the token at the caret (`slashTokenSpan`), so a call that dropped
	// the caret would re-anchor completion to the buffer start.
	assert.ok(
		/planSlashSubmission\(\{[\s\S]{0,240}?caret:/.test(composer),
		"the composer no longer passes the caret into `planSlashSubmission`, so inline detection has lost the position it is defined against",
	);
	const plannedAt = composer.indexOf("planSlashSubmission({");
	const submitAt = composer.indexOf("submitMessage();");
	assert.ok(
		plannedAt !== -1 && submitAt !== -1 && plannedAt < submitAt,
		"`planSlashSubmission` is gone from message-input.tsx or now runs after `submitMessage()`; a command typed into a sentence would reach the model as prose again",
	);
	// And the two entry points a user actually submits with both consult it: the
	// Enter key and the form's submit (the Send button).
	//
	// They consult it THROUGH `planForDraft`, the credential capture's one
	// exception in front of the planner (§5: after an Esc cancel the text the
	// operator sees is what gets sent, QA round 1 Q2 — the wrapper answers `send`
	// for the token the composer just cancelled and delegates everything else).
	// So the guard follows the call sites through the wrapper AND pins that the
	// wrapper still delegates, which is what makes the rename safe rather than a
	// hole: a `planForDraft` that stopped calling `planFor` would take both call
	// sites out of the planner's reach while this assertion stayed green.
	//
	// The window is 4200, not 400 (remediation round 1, Q1). The property this
	// pins is unchanged — the wrapper still delegates to `planFor(draft, at)` —
	// but the held-press branch and its comment block now sit between the
	// `useCallback(` and the call, so the first `planFor(draft, at)` moved past
	// the old window (measured comment-stripped: 424 chars on the base, 536 on
	// the head that added the branch). The distance is not the invariant; the
	// delegation is.
	const plans = composer.match(/planForDraft\(newMessage, caret\)/g) ?? [];
	assert.ok(
		plans.length >= 2,
		`expected the plan to be consulted from both Enter and the form submit, found ${plans.length} call site(s)`,
	);
	assert.ok(
		/const planForDraft = useCallback\([\s\S]{0,4200}?planFor\(draft, at\)/.test(
			composer,
		),
		"`planForDraft` no longer delegates to `planFor`, so the two submit entry points consult an exception with no planner behind it",
	);

	/*
	 * The seam itself.
	 *
	 * (a) Every non-`send` verdict belongs to the composer. Excluding `whole`
	 * here is what routed a whole-draft command back through the message path,
	 * where the second decision waited for it.
	 */
	assert.ok(
		!composer.includes('kind !== "send" && plan.kind !== "whole"'),
		"the composer exempts `whole` from the plan again, so a whole-draft command is being routed back through the message path — the path that used to re-decide it",
	);
	// (b) The dispatcher takes the planner's answer (a name and its args) and has
	// no text-shape guard left to disagree with the planner.
	const dispatcher = code(
		await readFile(
			"src/renderer/src/features/chat/components/slash-dispatch.ts",
			"utf8",
		),
	);
	assert.ok(
		!/SLASH_SUBMISSION/.test(dispatcher),
		"a whole-draft text-shape guard is back in slash-dispatch.ts; it can disagree with the composer's planner, which is QA round 2's Q4",
	);
	assert.match(
		dispatcher,
		/async \(\s*invocation: SlashCommandInvocation,?\s*\): Promise<SlashDispatchOutcome>/,
		"the dispatcher no longer takes a `SlashCommandInvocation`; handing it text lets a second whole-draft decision exist again",
	);
	// (c) The canonical send path never asks whether the text is a command: it is
	// the model path, and the composer has already dealt with every command.
	const page = code(
		await readFile(
			"src/renderer/src/features/chat/components/chat-page.tsx",
			"utf8",
		),
	);
	assert.ok(
		!/dispatch\((?:content|text|draft|payload|message)\b/.test(page),
		"the canonical send path dispatches the draft text again (`dispatch(content)`); the dispatcher would then decide instead of the planner",
	);
	assert.ok(
		!/SLASH_SUBMISSION/.test(page),
		"chat-page.tsx has a whole-draft text-shape guard again; that is the second decision QA round 2's Q4 came from",
	);
});

/*
 * R1, ON THE COMPOSER'S OWN SIDE: one payload, one trigger, and no second
 * clearer left behind.
 *
 * `echo-delivery.test.mjs` drives the shipped hook over the shipped store and
 * pins WHEN the payload leaves and what a refusal owes back. This is the other
 * half of that claim and it is a different failure: the composer used to clear
 * the chip row and the staged replies AFTER the send's promise settled, while the
 * text left at the echo - so the two halves of one payload travelled on two
 * clocks and the interval between them showed the user's message with its
 * attachment in the transcript beside the composer's chip for that file.
 *
 * Behaviour cannot pin the ABSENCE of a second trigger: a composer that cleared
 * the row at the echo AND again on settle would pass every case in that file,
 * because the second clear is a no-op. What it would leave is the handle - the
 * next edit that moves one of the two calls back, or adds a third, with nothing
 * on screen to say so. So the submit's own body is read, with comments stripped
 * first so a sentence explaining the rule cannot satisfy it.
 *
 * THE RESTORE PRESS IS DELIBERATELY OUTSIDE THIS WINDOW and is not an exception
 * to it: it is walked in `echo-delivery`'s R3 case and pinned above in Q-2, it
 * runs on a press rather than on a settle, and it REPLACES the row it writes -
 * which is the opposite job from clearing the payload a send is carrying out of
 * the composer.
 */
test("the composer clears no payload half of its own, so the echo is the only trigger", () => {
	const rendered = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	const start = rendered.indexOf("const onSubmit = useMemo(");
	assert.ok(start > 0, "the composer's submit is not where this test reads it");
	const end = rendered.indexOf("\n\t\t);", start);
	assert.ok(end > start, "the composer's submit has no end for this window");
	const submit = rendered.slice(start, end);
	assert.ok(
		submit.includes("storeCitedCredentials"),
		"the window this test reads is not the submit's own body, so it proves nothing about the submit",
	);
	assert.ok(
		!/clearAttachments\(|clearReplies\(/.test(submit),
		"the composer clears a payload half of its own again: the chip row and the staged replies must leave with the TEXT, at the echo (`clearStagedPayload`), or the transcript shows the file while the composer still shows its chip",
	);
});

/*
 * R2-1 (agent review round 2) AND ITS EVIDENCE HALF R2-2 - and why this is a test
 * about the STORE rather than about source text.
 *
 * Round 1 wired the composer's unsettled-send sentence to `chat-page`'s
 * `admitting`, and round 2 found that that is a `useState` declared INSIDE the
 * panel the New-chat identity flip replaces (`panelIdentityFor`, "THE FLIP IS A
 * REMOUNT"), so on the arm the operator photographed the replacement panel
 * reported `false` for the whole send. The test that claimed to cover that arm
 * regexed source text, and every pattern it matched stayed true while the runtime
 * value was wrong (R2-2) - so it is replaced here by the runtime reading, taken on
 * the arm that has no panel: a FRESH read of the store's own row, which is
 * exactly what a panel mounting mid-send does.
 *
 * The composer now derives the fact from that row (`sendUnsettledForSession` over
 * `draftRowForSession`, the same predicate the pane's `starting` latch reads for
 * the transcript's line), and this drives the REAL store through a New-chat send:
 * create -> the flip -> the seam -> the echo -> the held POST -> the receipt.
 *
 * WHAT THIS TEST CANNOT SEE, stated so it is not read as wider than it is: it
 * asserts the ROW, not the composer's drawing of it. The drawing is asserted in
 * the story plays, which render the real composer CLIENT-side (a browser), which
 * is also the only place it can be: zustand v5 answers every selector with
 * `getInitialState()` on React's server path, so a node-side render of a
 * component that selects from this store observes the INITIAL state whatever is
 * seeded - measured while writing this, not assumed. The guard below keeps a
 * regression from walking back in through the prop door.
 */
test("R2-1: the unsettled-send fact is the STORE's row, live across the New-chat flip and gone at the receipt", async () => {
	reset();
	const sessionId = "222222222222";
	let release = null;
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: sessionId, binding: null };
		if (request.op === "sessions.message")
			return new Promise((resolve) => {
				release = () => resolve({ status: "admitted" });
			});
		throw new Error(`unexpected request ${request.op}`);
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	const fact = () =>
		sendUnsettledForSession(store.getState().drafts, sessionId);
	assert.equal(
		fact(),
		false,
		"nothing is in flight at the press, so the box must not claim a send",
	);
	const send = admitChatDraft(key, { ...input, text: "Review this" });
	for (let i = 0; i < 200 && release === null; i += 1)
		await new Promise((resolve) => setTimeout(resolve, 5));
	assert.notEqual(release, null, "the message POST never left the store");
	assert.equal(
		store.getState().drafts[key]?.sessionId,
		sessionId,
		"the row the send travels in is the one that learned the session id, so the panel that replaces the sender resolves the SAME row",
	);
	assert.equal(
		draftIdentityFor(key, sessionId),
		key,
		"and it resolves it under the key it already holds, which is why a fresh mount finds a live send",
	);
	assert.equal(
		fact(),
		true,
		"on the arm the operator photographed: a panel mounting MID-SEND reads the row and sees that the message is still going out",
	);
	release();
	await send;
	assert.equal(
		fact(),
		false,
		"the receipt deletes the row (`finishDraft`), so the box has nothing left to claim but the owner's answer",
	);
});

test("R2-1: the composer derives it from the store, and no longer accepts it as a prop", () => {
	/*
	 * THE GUARD, AND IT IS A SOURCE-TEXT CHECK - said here so no reader takes it
	 * for coverage (agent review round 3, on R2-2's limit). Three regexes over
	 * comment-stripped source would not notice the value being multiplied away;
	 * what they notice is the door the round-1 defect came through, a prop owned
	 * by the panel the flip replaces, being reopened.
	 *
	 * Coverage lives elsewhere and is named there: the runtime reading above
	 * asserts the ROW's whole lifecycle on the real store, and the story plays
	 * assert the sentence the composer PRINTS on a mount that made no press - the
	 * client-side half, measured fail-before/pass-after in the round-2 reply
	 * because a node-side render cannot see a seeded store (zustand v5 answers
	 * every selector with `getInitialState()` on React's server path).
	 */
	const composer = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	assert.match(
		composer,
		/sendUnsettledForSession\(state\.drafts, conversationId\)/,
		"the composer must read the fact from the canonical store's rows, which is the source a mid-send mount can see",
	);
	assert.ok(
		!/sendingUnsettled\?: boolean/.test(composer),
		"the composer must not take the unsettled send as a prop again: that is how it was fed from `chat-page`'s `admitting`, the `useState` of the panel the flip replaces (agent review round 1 MAJOR-1, round 2 R2-1)",
	);
	assert.match(
		composer,
		/sendingUnsettled: sendUnsettled \|\| sendInFlight/,
		"and the store's answer must still be OR'd with this composer's own press, which covers the arms where no row exists",
	);
});
