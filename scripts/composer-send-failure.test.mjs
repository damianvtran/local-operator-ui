import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * What a FAILED send does now, pinned at the seam the app runs it through.
 *
 * The store and the composer's own store are bundled and executed in memory, with
 * only two things faked: the network (`desktopResult`) and the transcript's echo
 * registry (`use-canonical-session`, which is React and a live EventSource). That
 * is the same fixture `canonical-chat.test.mjs` uses, and it is the right level
 * for these claims - the classifier, the retry rule and the return path are all
 * store decisions, and a browser would only add the composer's rendering of them.
 *
 * The three claims this file exists for:
 *
 *  1. which of the three outcome classes a failure is, and what the notice says
 *     about it (`sendFailureClass`, `sendFailureCopy`);
 *  2. that an UNCHANGED resend after an unknown outcome is an idempotent replay
 *     under the same request id, and that an EDITED one is a new message that is
 *     never refused (`admitChatDraft`'s replay rule);
 *  3. that every failure puts the message back in the composer of the
 *     conversation that sent it - text, chips and staged quotes - through one
 *     store write, and that nothing is handed back when the message turns out to
 *     have been delivered after all.
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
const calls = [];
globalThis.__canonicalRequest = async (request) => {
	calls.push(request);
	const queued = responses.shift();
	if (queued instanceof Error) throw queued;
	return queued ?? {};
};
globalThis.__responses = [];
const responses = globalThis.__responses;
const echoes = [];
globalThis.__canonicalEcho = (event) => {
	echoes.push(event);
	// The real registry answers "was that still our own echo", which is the one
	// fact the send path reads back from it. A fixture that always said
	// "retracted" would make the delivered-after-all case unreachable here, so the
	// answer is scripted per id - see `__ownerRow`.
	if (event.kind === "retractLocal")
		return globalThis.__ownerHasIt ? "owner" : "retracted";
	return undefined;
};

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store"; export {useConversationInputStore, mergeReturnedText, mergeReturnedPayload, composerHoldsExactly, rehydrateInputRows} from "./src/renderer/src/shared/store/conversation-input-store"; export {DesktopControlError, UserFacingError} from "@shared/api/local-operator/desktop-api"; export {RUNTIME_BUSY_CODE, RUNTIME_RETIRING_CODE} from "./src/shared/desktop-contract";',
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
			name: "send-failure-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = request => globalThis.__canonicalRequest(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				/*
				 * The echo seam, stubbed rather than aliased: the real module is
				 * React and a live EventSource, and the store's contract with it is
				 * these three calls. `retractLocalEcho` reports the ONE answer the
				 * send path branches on, so the delivered-after-all case is
				 * reachable without a browser.
				 */
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export const echoPendingUser = (sessionId, id, text, images) =>
	globalThis.__canonicalEcho({ kind: "echo", sessionId, id, text, images });
export const retractPendingUser = (sessionId, id) =>
	globalThis.__canonicalEcho({ kind: "retract", sessionId, id });
export const retractLocalEcho = (sessionId, id) =>
	globalThis.__canonicalEcho({ kind: "retractLocal", sessionId, id });
export const discardPendingEchoes = (sessionId) =>
	globalThis.__canonicalEcho({ kind: "discard", sessionId });`,
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
	admitChatDraft,
	composerIdentityFor,
	mergeReturnedPayload,
	mergeReturnedText,
	rehydrateInputRows,
	retryWillFail,
	sendFailureClass,
	sendFailureCopy,
	SEND_FAILURE_COPY,
	useCanonicalSessionsStore,
	useConversationInputStore,
	UserFacingError,
	DesktopControlError,
	LEADING_SLASH_CODE,
	RUNTIME_BUSY_CODE,
	RUNTIME_RETIRING_CODE,
	SESSION_UNVALIDATED_CODE,
	STORE_OUT_OF_SPACE_CODE,
	UNREADABLE_ATTACHMENT_CODE,
} = module;

const SESSION = "111111111111";

function reset() {
	calls.length = 0;
	echoes.length = 0;
	responses.length = 0;
	globalThis.__ownerHasIt = false;
	useCanonicalSessionsStore.setState({
		sessions: [],
		activeSessionId: SESSION,
		activeDraftKey: null,
		drafts: {},
		sessionByAgent: {},
		validatingSessionId: null,
		error: null,
	});
	useConversationInputStore.setState({ inputByConversation: {} });
}

const key = `send:${SESSION}`;
const input = {
	text: "Review this",
	attachments: [],
	images: [],
	mode: "prompt",
	cwd: "/tmp",
};

/** Stage the composer's own row the way a keystroke and an attach would. */
function stageComposer(identity, { text = "", paths = [], replies = [] } = {}) {
	const store = useConversationInputStore.getState();
	if (text) store.setCurrentInput(identity, text);
	for (const path of paths)
		store.addAttachment(identity, { id: `chip-${path}`, path });
	for (const reply of replies) store.addReply(identity, reply);
}

function draftRow() {
	return useCanonicalSessionsStore.getState().drafts[key];
}

function composerRow(identity) {
	return useConversationInputStore.getState().inputByConversation[identity];
}

/* ------------------------------------------------------------------ classes */

test("every failure class resolves once, and the notice says which it is", () => {
	const cases = [
		// not sent: the message provably never reached the session.
		[new DesktopControlError(413, "too large", undefined), "not_sent", false],
		[new DesktopControlError(422, "bad schema", undefined), "not_sent", false],
		[
			new DesktopControlError(422, "bad", undefined, LEADING_SLASH_CODE),
			"not_sent",
			false,
		],
		[
			new DesktopControlError(503, "busy", undefined, RUNTIME_BUSY_CODE),
			"not_sent",
			true,
		],
		[
			new DesktopControlError(
				409,
				"retiring",
				undefined,
				RUNTIME_RETIRING_CODE,
			),
			"not_sent",
			true,
		],
		[
			new UserFacingError("not ready", SESSION_UNVALIDATED_CODE),
			"not_sent",
			true,
		],
		[
			new UserFacingError("no space", STORE_OUT_OF_SPACE_CODE),
			"not_sent",
			false,
		],
		[
			new UserFacingError("unreadable", UNREADABLE_ATTACHMENT_CODE),
			"not_sent",
			false,
		],
		// unknown: the app cannot say, so the claim is kept for a replay.
		[new DesktopControlError(504, "deadline", undefined), "unknown", true],
		[
			new DesktopControlError(503, "no answer", undefined, "transport.failed"),
			"unknown",
			true,
		],
		[
			new DesktopControlError(
				503,
				"hop lost",
				undefined,
				"runtime_unreachable",
			),
			"unknown",
			true,
		],
		[new DesktopControlError(409, "conflict", undefined), "unknown", true],
		[
			new DesktopControlError(401, "refused", undefined, "pairing.refused"),
			"unknown",
			false,
		],
		[new Error("boom"), "unknown", true],
		// gone: the conversation is not there, so only the content is salvageable.
		[new DesktopControlError(404, "not found", undefined), "gone", false],
	];
	for (const [error, klass, retry] of cases) {
		assert.equal(sendFailureClass(error), klass, `class of ${error.message}`);
		const copy = sendFailureCopy(error);
		assert.equal(copy.retry, retry, `retry of ${error.message}`);
		assert.equal(typeof copy.message, "string");
		assert.ok(copy.message.length > 0);
	}
});

test("the copy table is one place, and none of it speaks the app's own vocabulary", () => {
	const table = Object.values(SEND_FAILURE_COPY).join(" ");
	for (const jargon of ["held", "admission", "claim", "owner", "request id"]) {
		assert.ok(
			!table.toLowerCase().includes(jargon),
			`the notice copy says "${jargon}", which is our word rather than the user's`,
		);
	}
	// The four arms this change writes, verbatim.
	assert.equal(
		sendFailureCopy(new DesktopControlError(504, "deadline")).message,
		"Couldn't confirm your message was sent.",
	);
	assert.equal(
		sendFailureCopy(
			new DesktopControlError(503, "down", undefined, "transport.failed"),
		).message,
		"Couldn't reach Local Operator. Your message may not have been sent.",
	);
	assert.equal(
		sendFailureCopy(new DesktopControlError(404, "gone")).message,
		"This conversation no longer exists, so your message wasn't sent.",
	);
	assert.equal(
		sendFailureCopy(
			new DesktopControlError(503, "busy", undefined, RUNTIME_BUSY_CODE),
		).message,
		"The agent is busy, so your message wasn't sent.",
	);
});

test("Retry is withheld exactly where a press cannot work", () => {
	for (const code of [
		LEADING_SLASH_CODE,
		UNREADABLE_ATTACHMENT_CODE,
		STORE_OUT_OF_SPACE_CODE,
	])
		assert.equal(retryWillFail(code), true, code);
	for (const code of [
		RUNTIME_BUSY_CODE,
		RUNTIME_RETIRING_CODE,
		SESSION_UNVALIDATED_CODE,
	])
		assert.equal(
			retryWillFail(code),
			false,
			`${code} has a sentence that invites the press`,
		);
});

/* --------------------------------------------------------------- retry rule */

test("an unchanged resend after an unknown outcome is an idempotent replay", async () => {
	reset();
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(admitChatDraft(key, input, SESSION));
	const first = draftRow();
	assert.equal(first.admissionAttempted, true, "the claim is kept");
	assert.equal(first.pending, false);
	const requestId = first.admissionRequestId;
	const pinnedImages = first.submittedImages;
	const before = calls.length;

	responses.push({ ok: true });
	const id = await admitChatDraft(key, input, SESSION);
	const sent = calls
		.slice(before)
		.filter((request) => request.op === "sessions.message");
	assert.equal(id, SESSION);
	assert.equal(sent.length, 1);
	assert.equal(
		sent[0].requestId,
		requestId,
		"an unchanged retry must reuse the request id, or the owner cannot de-duplicate it",
	);
	assert.deepEqual(
		sent[0].images,
		undefined,
		"the pinned image set travels with the replay",
	);
	assert.equal(pinnedImages.length, 0);
	assert.equal(draftRow(), undefined, "a delivered send retires the row");
});

test("an edited resend is a new message: a new id, no refusal", async () => {
	reset();
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(admitChatDraft(key, input, SESSION));
	const first = draftRow().admissionRequestId;

	const before = calls.length;
	responses.push({ ok: true });
	await admitChatDraft(key, { ...input, text: "Review that instead" }, SESSION);
	const sent = calls
		.slice(before)
		.filter((request) => request.op === "sessions.message");
	assert.equal(sent.length, 1);
	assert.notEqual(
		sent[0].requestId,
		first,
		"an edited message is a new message, so it needs its own id",
	);
	assert.equal(sent[0].text, "Review that instead");
});

test("the replay sends the pinned RENDERED text, not a re-render of the box", async () => {
	reset();
	let renders = 0;
	const beforeAdmission = async () => `rendered-${++renders}`;
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(
		admitChatDraft(key, input, SESSION, undefined, beforeAdmission),
	);
	const before = calls.length;
	responses.push({ ok: true });
	await admitChatDraft(key, input, SESSION, undefined, beforeAdmission);
	const sent = calls
		.slice(before)
		.filter((request) => request.op === "sessions.message");
	assert.equal(
		renders,
		1,
		"the substitution seam is not re-entered on a replay: the receipt is keyed on the body it produced",
	);
	assert.equal(sent[0].text, "rendered-1");
});

/* --------------------------------------------------------------- return path */

test("a failure puts the text, the chips and the quotes back in the composer", async () => {
	reset();
	stageComposer(SESSION, {
		text: "Review this",
		paths: ["/tmp/a.png"],
		replies: [{ id: "r1", text: "quoted" }],
	});
	// The echo empties the composer and takes the whole payload with it, which is
	// the state the failure has to undo.
	useConversationInputStore.getState().beginInFlight(
		SESSION,
		{
			text: "Review this",
			attachments: [{ id: "chip-/tmp/a.png", path: "/tmp/a.png" }],
			replies: [{ id: "r1", text: "quoted" }],
		},
		true,
	);
	assert.equal(composerRow(SESSION).currentInput, "");

	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(admitChatDraft(key, input, SESSION));

	const row = composerRow(SESSION);
	assert.equal(row.pendingText, "Review this", "the text comes back");
	assert.deepEqual(
		row.attachments.map((chip) => chip.path),
		["/tmp/a.png"],
		"so do the chips",
	);
	assert.deepEqual(
		row.replies.map((reply) => reply.id),
		["r1"],
		"and the staged quotes",
	);
	assert.equal(
		row.inFlight,
		undefined,
		"the in-flight record is consumed by the return",
	);
});

test("a delivered-after-all failure hands nothing back and resolves as a success", async () => {
	reset();
	stageComposer(SESSION, { text: "Review this" });
	useConversationInputStore
		.getState()
		.beginInFlight(
			SESSION,
			{ text: "Review this", attachments: [], replies: [] },
			true,
		);
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	// The owner's row for that id is already painted by the time the response is
	// lost, so the retraction reports "owner" rather than "retracted" (the
	// fixture's one scripted fact - see `__canonicalEcho`).
	globalThis.__ownerHasIt = true;
	const resolved = await admitChatDraft(key, input, SESSION);
	assert.equal(resolved, SESSION);
	assert.equal(
		composerRow(SESSION)?.pendingText,
		undefined,
		"nothing is handed back for a message that landed",
	);
	assert.equal(draftRow(), undefined, "and the claim retires");
});

test("the New-chat flip returns the payload under the session id, not the draft key", async () => {
	reset();
	const draftKey = "draft:22222222-2222-2222-2222-222222222222";
	stageComposer(draftKey, {
		text: "Review this",
		paths: ["/tmp/b.png"],
		replies: [{ id: "r2", text: "quoted" }],
	});
	responses.push({ session_id: SESSION }); // sessions.create
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(admitChatDraft(draftKey, input, undefined));
	const row = composerRow(SESSION);
	assert.equal(row?.pendingText, "Review this");
	assert.deepEqual(
		row?.attachments.map((chip) => chip.path),
		["/tmp/b.png"],
	);
	assert.deepEqual(
		row?.replies.map((reply) => reply.id),
		["r2"],
	);
	assert.equal(
		composerRow(draftKey),
		undefined,
		"the identity the pane replaced is not left holding a copy",
	);
	assert.equal(composerIdentityFor(draftKey, SESSION), SESSION);
});

/* --------------------------------------------------------------------- merge */

test("a return merges under the user's typing, and is idempotent", () => {
	assert.equal(mergeReturnedText("", "A"), "A");
	assert.equal(mergeReturnedText("B", ""), "B");
	assert.equal(mergeReturnedText("B", "A"), "A\n\nB");
	assert.equal(mergeReturnedText("A\n\nB", "A"), "A\n\nB");
	const merged = mergeReturnedPayload(
		{
			text: "B",
			attachments: ["/tmp/b.png"],
			replies: [{ id: "r2", text: "two" }],
		},
		{
			text: "A",
			attachments: ["/tmp/a.png"],
			replies: [{ id: "r1", text: "one" }],
		},
	);
	assert.deepEqual(merged.attachments, ["/tmp/a.png", "/tmp/b.png"]);
	assert.deepEqual(
		merged.replies.map((reply) => reply.id),
		["r1", "r2"],
	);
	assert.equal(merged.text, "A\n\nB");
	// Applied twice, the same return changes nothing.
	const again = mergeReturnedPayload(merged, {
		text: "A",
		attachments: ["/tmp/a.png"],
		replies: [{ id: "r1", text: "one" }],
	});
	assert.equal(again.text, "A\n\nB");
	assert.deepEqual(again.attachments, ["/tmp/a.png", "/tmp/b.png"]);
});

/* --------------------------------------------------------------- persistence */

test("a restart returns an interrupted send to its composer", () => {
	const persisted = {
		111111111111: {
			currentInput: "",
			submittedMessages: [],
			currentHistoryIndex: null,
			replies: [],
			attachments: [],
			inFlight: {
				text: "typed mid-flight",
				attachments: ["/tmp/late.png"],
				replies: [],
			},
		},
	};
	const rows = rehydrateInputRows(persisted, () => "fresh-chip");
	assert.equal(rows["111111111111"].inFlight, undefined);
	assert.equal(rows["111111111111"].pendingText, "typed mid-flight");
	assert.deepEqual(
		rows["111111111111"].attachments.map((chip) => chip.path),
		["/tmp/late.png"],
	);
});
