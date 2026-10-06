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
/*
 * THE QUOTA IS PART OF THE FIXTURE, not a convenience: a browser's `localStorage`
 * is roughly 5 MB per origin and throws `QuotaExceededError` past it, and that
 * throw is what turned a large pasted screenshot into "Something went wrong" on
 * every reload (review round 1, B5/Q-6). A stub that accepts anything cannot see
 * the defect, so this one behaves like the store does.
 */
const LOCAL_STORAGE_QUOTA = 5 * 1024 * 1024;
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => {
		if (typeof value === "string" && value.length > LOCAL_STORAGE_QUOTA) {
			const error = new Error("QuotaExceededError");
			error.name = "QuotaExceededError";
			throw error;
		}
		values.set(key, value);
	},
	removeItem: (key) => values.delete(key),
};
const calls = [];
globalThis.__canonicalRequest = async (request) => {
	calls.push(request);
	// The catalogue read the create's answer now issues (S5): answered here rather
	// than queued, because it is not a send and every queue in this file is
	// written for the send path alone.
	if (request.op === "sessions.list") return { sessions: [], truncated: false };
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
	// fact the send path reads back from it. A fixture that always said "local"
	// would make the delivered-after-all case unreachable here, so the answer is
	// scripted per id - see `__ownerHasIt`.
	//
	// AND "unseen" IS THE THIRD ANSWER, not a synonym for "local" (issue #847):
	// the real `peekLocalEcho` says it when no transcript is mounted to hold the
	// id, and the repaint guard's read depends on the difference - a reload has an
	// empty registry and an empty transcript, not a row of ours. Derived from the
	// registry below rather than scripted, so the one fixture can stand for both
	// states: an entry means a pane is holding our echo, no entry means nothing is.
	if (event.kind === "peekLocal")
		return globalThis.__ownerHasIt
			? "owner"
			: globalThis.__pendingSendRegistry.has(event.sessionId)
				? "local"
				: "unseen";
	return undefined;
};

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store"; export {useConversationInputStore, mergeReturnedText, mergeReturnedPayload, composerHoldsExactly, rehydrateInputRows} from "./src/renderer/src/shared/store/conversation-input-store"; export {caughtFailureNotice, composerNoticeFor, lockAnswerOutlived, retryOfferedForFailureCode} from "./src/renderer/src/features/chat/composer-notice"; export {DesktopControlError, UserFacingError} from "@shared/api/local-operator/desktop-api"; export {RUNTIME_BUSY_CODE, RUNTIME_RETIRING_CODE, DESKTOP_DEADLINE_EXCEEDED_CODE} from "./src/shared/desktop-contract";',
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
				 * these calls. `peekLocalEcho` reports the ONE answer the send path
				 * branches on, so the delivered-after-all case is reachable without a
				 * browser.
				 */
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					/*
					 * The registry is a REAL little Map now, not a recorder (S6): the restart
					 * adapter's guard (`pendingSendForView`) and its paint share it, and a
					 * recorder could not tell "the press already painted this row" from
					 * "nothing is retained" - which is exactly the reload the S6 case stages.
					 * Every recorded echo is byte-identical to before; the Map only backs
					 * the reads.
					 */
					contents: `const registry = new Map();
globalThis.__pendingSendRegistry = registry;
export const paintPendingSend = (identity, send) => {
	globalThis.__canonicalEcho({ kind: "echo", sessionId: identity, id: send.id, text: send.text, images: send.images });
	let entries = registry.get(identity);
	if (!entries) { entries = new Map(); registry.set(identity, entries); }
	entries.set(send.id, {
		identity,
		id: send.id,
		text: send.text,
		images: send.images,
		settled: send.settled,
	});
};
export const settlePendingSend = (identity, id) => {
	const entry = registry.get(identity)?.get(id);
	if (entry) entry.settled = true;
};
export const hasPendingSend = (identity, id) => Boolean(registry.get(identity)?.has(id));
export const pendingSendForView = (identity) => {
	/*
	 * THE SETTLED SKIP IS PART OF THE RULE THE FIXTURE STANDS FOR (agent review
	 * round 2, R2-2): the real predicate answers the oldest entry that is NOT
	 * settled, because a resolved claim stays in the registry to keep painting its
	 * row. A fixture that returned the settled entry would let a regression pass
	 * here while the app showed no wait line at all.
	 */
	const entries = registry.get(identity);
	if (!entries) return null;
	const first = [...entries.values()].find((entry) => entry.settled !== true);
	return first ?? null;
};
export const movePendingSendIdentity = (from, to) => {
	globalThis.__canonicalEcho({ kind: "move", from, to });
	if (from === to) return;
	const entries = registry.get(from);
	if (!entries) return;
	registry.delete(from);
	const destination = registry.get(to) ?? new Map();
	for (const [id, entry] of entries) { entry.identity = to; destination.set(id, entry); }
	registry.set(to, destination);
};
export const replacePendingSendText = (identity, id, text) => {
	globalThis.__canonicalEcho({ kind: "replace", sessionId: identity, id, text });
	const entry = registry.get(identity)?.get(id);
	if (entry) entry.text = text;
};
export const resolvePendingSend = (identity, id) => {
	const entries = registry.get(identity);
	if (!entries) return;
	entries.delete(id);
	if (entries.size === 0) registry.delete(identity);
};
/*
 * THE REPAINT GUARD'S OTHER HALF (design review round 1's D1): the real
 * retractLocalEcho resolves the entry AND takes down a LOCAL record. No
 * transcript is mounted in this fixture, so the record half is a no-op and the
 * answer is "queued" - the module's own answer for exactly that state.
 */
export const retractLocalEcho = (sessionId, id) => {
	globalThis.__canonicalEcho({ kind: "retractLocal", sessionId, id });
	resolvePendingSend(sessionId, id);
	return "queued";
};
export const discardPendingSends = (sessionId) => {
	globalThis.__canonicalEcho({ kind: "discard", sessionId });
	registry.delete(sessionId);
};
export const retractPendingUser = (sessionId, id) =>
	globalThis.__canonicalEcho({ kind: "retract", sessionId, id });
export const peekLocalEcho = (sessionId, id) =>
	globalThis.__canonicalEcho({ kind: "peekLocal", sessionId, id });
export const discardPendingEchoes = (sessionId) => {
	globalThis.__canonicalEcho({ kind: "discard", sessionId });
	registry.delete(sessionId);
};`,
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
	composerHoldsExactly,
	composerIdentityFor,
	caughtFailureNotice,
	composerNoticeFor,
	lockAnswerOutlived,
	migrateHeldClaim,
	retryOfferedForFailureCode,
	mergeReturnedPayload,
	mergeReturnedText,
	rehydrateInputRows,
	resynthesisePendingSend,
	withholdsRetryHint,
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
	DESKTOP_DEADLINE_EXCEEDED_CODE,
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
		validatingSessionId: null,
		error: null,
	});
	useConversationInputStore.setState({ inputByConversation: {} });
	// The registry is process state: a case starts in a fresh process's shape.
	globalThis.__pendingSendRegistry.clear();
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
		/*
		 * The read window is not sent AND NOT PRESSABLE (design round 11, D2): the window
		 * answers "failed" the moment it is asked, so the press re-refuses into the same
		 * sentence - the classifier withholds it, and the row now asks the predicate rather
		 * than restating its answer as a literal.
		 */
		[
			new UserFacingError("not ready", SESSION_UNVALIDATED_CODE),
			"not_sent",
			false,
		],
		[
			new UserFacingError("no space", STORE_OUT_OF_SPACE_CODE),
			"not_sent",
			false,
		],
		/*
		 * THE CODELESS 409 IS SPLIT, so it is listed by the fact that decides it
		 * rather than as one arm (review round 2, Q2-1): with nothing unresolved under
		 * the id, a 409 the daemon answered with a sentence is a refusal of THIS body
		 * - the sender-side budget ladder's shape - and the same status AFTER an
		 * unresolved attempt is the receipt conflict, which stays unknown (pinned by
		 * its own case below and in `sendFailureClass`'s docblock).
		 */
		[
			new DesktopControlError(409, "no room for its attachments"),
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
		/*
		 * The receipt conflict, and it is the FOURTH column that makes it one: the
		 * status is the same as the row above it and the difference is a fact the
		 * store holds - an attempt under this id is already out there, so the message
		 * may have been admitted and the app must not pretend to know it was not.
		 */
		[
			new DesktopControlError(409, "conflict", undefined),
			"unknown",
			true,
			true,
		],
		[
			new DesktopControlError(401, "refused", undefined, "pairing.refused"),
			"unknown",
			false,
		],
		[new Error("boom"), "unknown", true],
		// gone: the conversation is not there, so only the content is salvageable.
		[new DesktopControlError(404, "not found", undefined), "gone", false],
	];
	for (const [error, klass, retry, priorAttemptUnresolved = false] of cases) {
		assert.equal(
			sendFailureClass(error, priorAttemptUnresolved),
			klass,
			`class of ${error.message}`,
		);
		const copy = sendFailureCopy(error, undefined, priorAttemptUnresolved);
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
		"Couldn't confirm your message was sent. Sending it again is safe.",
	);
	/*
	 * AND THE SECOND CLAUSE IS THE POINT OF THE SENTENCE (UX round 1, U7). The
	 * timeout arm used to say only what the app could not establish, which left the
	 * one safe action - press Retry - unstated. The claim is asserted as a property
	 * rather than as prose: the unknown arm's sentence tells the user a resend is
	 * safe, and no other arm claims the same thing about a message that provably did
	 * not leave.
	 */
	assert.match(
		sendFailureCopy(new DesktopControlError(504, "deadline")).message,
		/sending it again is safe/i,
		"the unknown-outcome notice no longer says that a resend is safe",
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
		/*
		 * The read window is the fourth (design round 11, D2): its sentence does NOT
		 * invite a press, because the window answers "failed" the moment it is asked and
		 * the press re-refuses into the same sentence.
		 */
		SESSION_UNVALIDATED_CODE,
		/*
		 * And the answers route's busy refusal is the fifth (design round 1 on that
		 * change, D5). The old note here read "`runtime_busy` has a sentence that
		 * invites the press", and that sentence — the backend's "Retrying is safe" —
		 * is exactly what the design round removed from the wire. What is left is the
		 * press's own facts: the app has already repeated the request under its own
		 * bounded budget, and the composer's only retry control is Send over the
		 * BOX, which is not the question that failed.
		 */
		RUNTIME_BUSY_CODE,
	])
		assert.equal(withholdsRetryHint(code), true, code);
	assert.equal(
		withholdsRetryHint(RUNTIME_RETIRING_CODE),
		false,
		"the retiring owner's sentence does invite the press",
	);
	/*
	 * AND THE SEND PATH STILL OFFERS IT, WHICH IS NOT A CONTRADICTION (design round 1
	 * on the answers route, D5). `withholdsRetryHint` answers for a PRESS; a send's
	 * Retry acts on the message still in the box, which is the thing the refusal is
	 * about. Pinned side by side so neither answer can be "fixed" into the other:
	 * the two surfaces read the same code and must not be given one verdict.
	 */
	assert.equal(
		sendFailureCopy(
			new DesktopControlError(
				503,
				"This session's owner is busy with another request. Retry in a moment.",
				undefined,
				RUNTIME_BUSY_CODE,
			),
		).retry,
		true,
		"a refused SEND hands the text back to the box, so Retry is the remedy there",
	);
	/*
	 * AND THE ONE CALLER THAT RECONCILES THE TWO LISTS IS DRIVEN, not just read
	 * (agent review round 1, MINOR-1). `RUNTIME_BUSY_CODE` sits in this set - which
	 * answers "can a press work for this failure", consulted for a SEND - while
	 * `withholdsRetryHint` withholds for a press, and the difference is only safe
	 * because `composerNoticeFor` ANDs the pane's own verdict with the set: the
	 * sentence on screen never comes from the set alone. Both arms are exercised
	 * here so the pair of answers is a pinned behaviour rather than a coincidence
	 * two files happen to share.
	 */
	const busyCode = RUNTIME_BUSY_CODE;
	const sendArm = composerNoticeFor({
		error: SEND_FAILURE_COPY.busy,
		code: busyCode,
		// What `sendFailureCopy` classifies for a refused send.
		retry: sendFailureCopy(
			new DesktopControlError(503, "busy", undefined, busyCode),
		).retry,
		muted: false,
		rowError: undefined,
		rowCode: undefined,
		rowRetry: undefined,
		lateDelivered: false,
	});
	assert.equal(
		sendArm?.retry,
		true,
		"the send's own verdict survives the set that also withholds for a press",
	);
	const pressArm = composerNoticeFor({
		error: "Your answer isn't confirmed yet. The agent is busy.",
		code: busyCode,
		// What the press's report carries, typed `false` on the arm itself.
		retry: false,
		muted: true,
		rowError: undefined,
		rowCode: undefined,
		rowRetry: undefined,
		lateDelivered: false,
	});
	assert.equal(
		pressArm?.retry,
		false,
		"the same code on a press is withheld, because the AND is what decides",
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

/* --------------------------------------------------- the boundary rule (S4) */

test("a failure hands NOTHING back to the composer: the row is the message's home", async () => {
	reset();
	stageComposer(SESSION, {
		text: "Review this",
		paths: ["/tmp/a.png"],
		replies: [{ id: "r1", text: "quoted" }],
	});
	// The paint empties the composer and takes the whole payload with it, which
	// is the state this case starts from.
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
	await assert.rejects(
		admitChatDraft(key, { ...input, attachments: ["/tmp/a.png"] }, SESSION),
	);

	/*
	 * THE BOUNDARY RULE, ON THE BOX (S4): everything the store rethrows was raised
	 * after the paint, so the payload does NOT come home. The message is on its
	 * row in the conversation, with the class's sentence and the two controls that
	 * resolve it; the composer is not a second home for it. The old contract
	 * returned text, chips and quotes to this row - that is the #495 behaviour
	 * this change supersedes, and the reason it had to go is that the box's copy
	 * was the one that could be sent a second time.
	 */
	const row = composerRow(SESSION);
	assert.equal(row.pendingText, undefined, "no text comes back");
	assert.deepEqual(row.attachments, [], "and no chips");
	assert.deepEqual(row.replies, [], "and no quotes");
	assert.equal(
		row.inFlight,
		undefined,
		"the attempt is settled, not returned: nothing comes home, and nothing keeps claiming to be in flight",
	);
	/*
	 * AND THE PAYLOAD BASIS IS ON THE DRAFT ROW, which is where the row-line's
	 * `Send again` replays from and its `Edit` restores from - the one copy the
	 * two surfaces read instead of a second copy in the box.
	 */
	const draft = draftRow();
	assert.equal(draft.submittedText, "Review this");
	assert.deepEqual(draft.submittedAttachments, ["/tmp/a.png"]);
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

test("the New-chat flip leaves the payload on the draft row, under the identity the send minted", async () => {
	reset();
	const draftKey = "draft:22222222-2222-2222-2222-222222222222";
	stageComposer(draftKey, {
		text: "Review this",
		paths: ["/tmp/b.png"],
		replies: [{ id: "r2", text: "quoted" }],
	});
	// The press: the draft pane's composer hands the payload over and empties - the
	// state the failure used to hand everything back to.
	useConversationInputStore.getState().beginInFlight(
		draftKey,
		{
			text: "Review this",
			attachments: [{ id: "chip-/tmp/b.png", path: "/tmp/b.png" }],
			replies: [{ id: "r2", text: "quoted" }],
		},
		true,
	);
	responses.push({ session_id: SESSION }); // sessions.create
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(
		admitChatDraft(
			draftKey,
			{ ...input, attachments: ["/tmp/b.png"] },
			undefined,
		),
	);
	/*
	 * S4's boundary rule on the draft path: the failure belongs to the row, so
	 * neither identity's composer gets the payload. The DRAFT-KEY row is the one
	 * that used to collect it in the released app (the R1 finding this case was
	 * built for), and the SESSION-ID row used to collect it after the flip - this
	 * asserts both stay empty, and that the identity the send minted is still the
	 * one the pane and the registry agree on (`composerIdentityFor`).
	 */
	assert.equal(
		composerRow(draftKey),
		undefined,
		"the pressed identity's row is gone: its leftovers moved with the flip (U14/Q7), and nothing is stranded under an identity no pane will show again",
	);
	assert.equal(
		composerRow(SESSION)?.pendingText,
		undefined,
		"and the minted row holds no returned text: the transcript row is the message's home",
	);
	const draft = useCanonicalSessionsStore.getState().drafts[draftKey];
	assert.equal(draft.submittedText, "Review this");
	assert.deepEqual(draft.submittedAttachments, ["/tmp/b.png"]);
	assert.equal(composerIdentityFor(draftKey, SESSION), SESSION);
});

/*
 * T6: A RELOAD. The registry is process state and starts empty in a fresh
 * process; the draft row's claim fields persist. The row must come back - S4
 * made it the message's home, and a reload that lost it would leave the
 * conversation silently empty with the payload no longer coming home either.
 *
 * THE ADAPTER'S SHAPE IS THE FAILED ROW, NOT "STILL-PENDING" (agent review
 * round 1, NIT). §4d's wording offers a still-pending case and one cannot exist:
 * `pending` is stripped at persist, so a mid-send reload has no claim to
 * re-paint and the message is still in the box (the `inFlight` fold); what
 * re-paints is a failure this build recorded and the user has not resolved, or
 * - D2 below - a claim the server RESOLVED.
 */
test("a failed row is re-synthesised after a reload, under the id the durable row would carry", async () => {
	reset();
	const draftKey = "draft:33333333-3333-3333-3333-333333333333";
	responses.push({ session_id: SESSION });
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(admitChatDraft(draftKey, { ...input }, undefined));
	const draft = useCanonicalSessionsStore.getState().drafts[draftKey];
	assert.equal(
		draft.admissionAttempted,
		true,
		"an unknown outcome: the claim survives on the row",
	);
	assert.equal(
		draft.submittedRendered,
		"Review this",
		"and the text the row showed is the pinned render - the seam ran before the wire",
	);
	// The reload: a fresh process retains nothing.
	globalThis.__pendingSendRegistry.clear();
	// The pane's mount pass, reading the row it is on screen with.
	assert.equal(
		resynthesisePendingSend(draftKey, draft),
		true,
		"the row comes back",
	);
	const identity = composerIdentityFor(draftKey, draft.sessionId);
	const restored = globalThis.__pendingSendRegistry
		.get(identity)
		?.get(draft.admissionRequestId);
	assert.equal(
		restored?.id,
		draft.admissionRequestId,
		"under the id the durable row would carry, so a later owner row coalesces with it",
	);
	assert.equal(
		restored?.text,
		"Review this",
		"with the text the row showed when it failed",
	);
	// Idempotent: the effect can run again without painting a second row.
	assert.equal(resynthesisePendingSend(draftKey, draft), false);
	// And the SHAPE guards, exercised with the registry empty again.
	globalThis.__pendingSendRegistry.clear();
	assert.equal(
		resynthesisePendingSend(draftKey, {
			...draft,
			errorRetry: undefined,
			submittedRendered: undefined,
		}),
		false,
		"a released-app row is not this adapter's to re-paint - `migrateHeldClaim` owns it",
	);
	assert.equal(
		resynthesisePendingSend(draftKey, {
			...draft,
			error: undefined,
			errorCode: undefined,
			errorRetry: undefined,
		}),
		false,
		"nor is a failure the user already resolved (the not-delivered Edit clears the sentence, and D2's record with it)",
	);
	assert.equal(
		resynthesisePendingSend(draftKey, draft),
		true,
		"while the unresolved failure still paints - the guards are about the shape, not the clear",
	);
});

/*
 * D2: A RELOAD AFTER THE CLAIM RESOLVED. The server's complete read has answered
 * the claim NO: `resolveHeldFromServer` clears `error`/`errorRetry`/`submittedText`
 * and records `undelivered` - the state whose row is the message's fate statement
 * and whose remedy is the §F3 line. Re-synthesising only from `error` +
 * `errorRetry` refused exactly this shape, so a second reload lost the row AND
 * the line, with the payload deliberately not in the composer: the message
 * surviving nowhere at all (design review round 1, D2).
 */
test("a resolved-undelivered row is re-synthesised after a reload, from the resolution's own record", () => {
	reset();
	const draftKey = "draft:44444444-4444-4444-4444-444444444444";
	const resolvedId = "66666666-6666-4666-8666-666666666666";
	// The shape `resolveHeldFromServer` writes: the failure's fields are gone
	// (the not-found arm destructures them away) and the record that replaces
	// them names the row the message will wear.
	const draft = {
		key: draftKey,
		admissionRequestId: "55555555-5555-4555-8555-555555555555",
		undelivered: {
			recordId: resolvedId,
			text: "Review this",
			attachments: ["/tmp/b.png"],
		},
	};
	assert.equal(
		resynthesisePendingSend(draftKey, draft),
		true,
		"the resolved row comes back, where the failure-shape guard alone refused it",
	);
	const identity = composerIdentityFor(draftKey, draft.sessionId);
	const restored = globalThis.__pendingSendRegistry
		.get(identity)
		?.get(resolvedId);
	assert.equal(
		restored?.text,
		"Review this",
		"with the resolution's text, under the id the durable row would carry",
	);
	assert.equal(
		resynthesisePendingSend(draftKey, draft),
		false,
		"and idempotently - the entry is what `already painted` means",
	);
	// The user's Edit retires the row AND the record (chat-page's retirement),
	// so nothing is left for the adapter to re-paint on the next load.
	globalThis.__pendingSendRegistry.clear();
	assert.equal(
		resynthesisePendingSend(draftKey, { ...draft, undelivered: undefined }),
		false,
		"a retired row leaves nothing to re-paint",
	);
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

/* ---------------------------------------------------------------------------
 * REVIEW ROUND 1 (the live findings, which are store findings underneath)
 * ------------------------------------------------------------------------- */

/*
 * B1. THE MIGRATION IS NOT ALLOWED TO FIRE ON THIS BUILD'S OWN ROW.
 *
 * Every clause below is a consequence the reviewers measured on the previous head,
 * all of them from one cause: the migration's gate was the SHAPE of a failure
 * (`submittedText` present, `admissionAttempted`, not pending), which is exactly
 * the shape this build writes when an outcome is unknown. So the pane's effect -
 * which runs on every draft change - moved the payload a second time, cleared the
 * replay identity, and left the row unable to say what its request id means.
 */
test("a failure this build recorded is never migrated as the released app's claim", async () => {
	reset();
	let renders = 0;
	const beforeAdmission = async () => `rendered-${++renders}`;
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(
		admitChatDraft(key, input, SESSION, undefined, beforeAdmission),
	);
	const first = draftRow();
	const requestId = first.admissionRequestId;
	const firstBody = calls
		.filter((r) => r.op === "sessions.message")
		.at(-1).text;
	assert.equal(renders, 1);

	/*
	 * The pane's own effect, run the way the pane runs it: on the row this send
	 * just wrote.
	 */
	assert.equal(
		migrateHeldClaim(key, first),
		false,
		"the migration fired on a row this build wrote, so it handed the message back twice and wiped the replay identity",
	);
	assert.equal(
		draftRow().submittedText,
		first.submittedText,
		"the replay identity must survive the pane's migration effect",
	);
	assert.equal(
		composerRow(composerIdentityFor(key, SESSION))?.pendingText,
		undefined,
		"the payload was handed back a second time",
	);

	/*
	 * 1. An UNCHANGED retry is the same request, body included - which is what the
	 *    owner's receipt journal de-duplicates on (a same-id request whose body
	 *    hashes differently is refused as a conflict, and the app then reports an
	 *    unknown outcome for ever).
	 */
	const before = calls.length;
	responses.push({ ok: true });
	await admitChatDraft(key, input, SESSION, undefined, beforeAdmission);
	const replay = calls.slice(before).filter((r) => r.op === "sessions.message");
	assert.equal(replay.length, 1);
	assert.equal(
		replay[0].requestId,
		requestId,
		"the request id is the one that was issued",
	);
	assert.equal(
		replay[0].text,
		firstBody,
		"the retry went out with a RE-RENDERED body under the first attempt's id, which the owner refuses as a conflict",
	);
	assert.equal(renders, 1, "a replay does not re-render the text");

	/*
	 * 2. And the row is gone: a delivered send retires it, so a THIRD press cannot
	 *    reuse the id for something new.
	 */
	assert.equal(draftRow(), undefined);
});

test("after an unknown outcome, a different message is a new request id", async () => {
	reset();
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(admitChatDraft(key, input, SESSION));
	const failed = draftRow().admissionRequestId;
	// The pane's migration effect, on the row this build just wrote.
	migrateHeldClaim(key, draftRow());

	const before = calls.length;
	responses.push({ ok: true });
	await admitChatDraft(key, { ...input, text: "A different message" }, SESSION);
	const sent = calls.slice(before).filter((r) => r.op === "sessions.message");
	assert.equal(sent.length, 1);
	assert.equal(sent[0].text, "A different message");
	assert.notEqual(
		sent[0].requestId,
		failed,
		"a DIFFERENT message went out under the failed message's id, which the owner refuses as a conflict - and if the first one landed, the conflict was then misread as a delivery and the new message was dropped with no notice at all",
	);
});

test("a row the released app left behind comes home once, with this app's sentence", () => {
	reset();
	/*
	 * The released app's own row, as its persistence wrote it: its claim marker, its
	 * payload, and the transport's 20-second sentence in `error` - the sentence the
	 * composer must not show (it describes a request the app stopped waiting for, and
	 * it is not this app's copy).
	 */
	const legacy = {
		key,
		createRequestId: "create-legacy",
		admissionRequestId: "admission-legacy",
		sessionId: SESSION,
		pending: false,
		admissionAttempted: true,
		submittedText: "kept outside the composer",
		submittedAttachments: [],
		heldClaimCode: "send_unconfirmed",
		error:
			"The app waits up to 20 seconds for this request, and it was still running when the app stopped waiting.",
	};
	useCanonicalSessionsStore.setState({ drafts: { [key]: legacy } });
	assert.equal(
		migrateHeldClaim(key, legacy),
		true,
		"the released app's row is the one it is for",
	);
	/*
	 * THE EXPECTATION IS THE LITERAL the composer is keyed by, and NOT
	 * `composerIdentityFor(key, SESSION)` (review round 2, R1). Computing it with the
	 * function under test made this pin circular: it agreed with whatever that
	 * function answered, including the orphan identity it answered for a `send:` key,
	 * so the defect it was meant to catch could not fail it.
	 */
	const row = composerRow(SESSION);
	assert.equal(row?.pendingText, "kept outside the composer");
	assert.equal(
		draftRow().heldClaimCode,
		undefined,
		"the claim marker goes with the claim",
	);
	assert.equal(draftRow().submittedText, undefined);
	assert.equal(
		draftRow().error,
		SEND_FAILURE_COPY.unconfirmed,
		"the released app's 20-second sentence is still on screen",
	);
	assert.equal(
		draftRow().errorRetry,
		true,
		"and the press that answers it is offered",
	);
	assert.equal(
		migrateHeldClaim(key, draftRow()),
		false,
		"the move happens once",
	);
});

/*
 * B5/Q-6. THE IMAGE BYTES ARE PERSISTED ONCE.
 *
 * The returned record kept the same paths the row keeps, so a pasted screenshot -
 * a `data:` URL, megabytes of base64 - went into `localStorage` twice: once as a
 * chip and once as the record of it. Past the quota the write threw, the row was
 * left half-written, and every reload showed the app's crash page. The test drives
 * the real persist write (`partialize` through the store's own storage) with the
 * quota the browser has.
 */
test("a returned payload does not duplicate the image bytes, so a large one still persists", () => {
	reset();
	const identity = composerIdentityFor(key, SESSION);
	const image = `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}`;
	const store = useConversationInputStore.getState();
	store.setCurrentInput(identity, "with a screenshot");
	store.addAttachment(identity, { id: "chip-1", path: image });
	/*
	 * Through the wire and back: the echo takes the payload out of the composer
	 * (`beginInFlight`), and the failure hands it back (`returnInFlight`).
	 */
	store.beginInFlight(identity, {
		text: "with a screenshot",
		// The chips as the composer held them: `beginInFlight` records their PATHS in
		// the in-flight payload, which is what the return path hands back.
		attachments: [{ id: "chip-1", path: image }],
		replies: [],
	});
	store.returnInFlight(identity, identity);

	const row = composerRow(identity);
	assert.deepEqual(
		row?.attachments.map((chip) => chip.path),
		[image],
		"the chip is back in the composer",
	);
	assert.equal(row?.pendingText, "with a screenshot");
	assert.equal(
		JSON.stringify(row?.returned).includes("data:image/png"),
		false,
		"the returned record carries the bytes as well as the chip",
	);
	/*
	 * And the persistence the app performs after that write: one copy of the bytes,
	 * under a quota that a second copy would breach.
	 */
	const persisted = values.get("conversation-input-store") ?? "";
	assert.ok(persisted.length > 0, "the row was persisted at all");
	assert.equal(
		persisted.split("data:image/png").length - 1,
		1,
		"the image bytes were persisted more than once, which is the throw that left the store unreadable and the app on its crash page",
	);
	assert.ok(persisted.length <= LOCAL_STORAGE_QUOTA);
	// And a reload of exactly that persisted state is a row the app can use.
	const rehydrated = rehydrateInputRows(
		JSON.parse(persisted).state.inputByConversation,
	);
	assert.deepEqual(
		rehydrated[identity].attachments.map((chip) => chip.path),
		[image],
	);
});

/*
 * m1. A CREDENTIAL IS NEVER WRITTEN, on any of the three paths its text can be on.
 *
 * The masked capture's own text can BE the secret the user is mid-way through
 * entering, and the return path copied it into `pendingText` and into the returned
 * record with no volatile flag - so a failure during a capture wrote the secret to
 * disk, where `partialize`'s single gate (the in-flight record) never reached it.
 */
test("a payload typed inside a masked capture never reaches disk when it comes back", () => {
	reset();
	const identity = composerIdentityFor(key, SESSION);
	const store = useConversationInputStore.getState();
	store.beginInFlight(identity, {
		text: "LOP_SECRET_ABCDEFGH",
		attachments: [],
		replies: [],
		volatileText: true,
	});
	store.returnInFlight(identity, identity);
	const persisted = values.get("conversation-input-store") ?? "";
	assert.equal(
		persisted.includes("LOP_SECRET_ABCDEFGH"),
		false,
		"a credential the user was still entering reached localStorage",
	);
	// In memory it is still theirs: the box gets the text back.
	assert.equal(composerRow(identity)?.pendingText, "LOP_SECRET_ABCDEFGH");
});

/*
 * M4/m5. THE CREDENTIAL SEAM RUNS WHEN NOTHING WAS EVER RENDERED.
 *
 * A conversation's first message stages a draft, and `sessions.create` answers
 * with the id the seam needs. When the CREATE hop fails there is no session, so the
 * seam never ran and nothing was pinned; reading the pin alone then sent the raw
 * composer text on the retry - credential markers to the model verbatim, and the
 * credential never stored into the session the retry had just created.
 */
test("a replay whose first attempt never rendered runs the credential seam", async () => {
	reset();
	const draftKey = "draft:33333333-3333-3333-3333-333333333333";
	let renders = 0;
	const beforeAdmission = async () => `stored: ${++renders}`;
	stageComposer(draftKey, { text: "[Credential #1, 19 chars]" });
	responses.push(new DesktopControlError(503, "create refused"));
	await assert.rejects(
		admitChatDraft(draftKey, input, undefined, undefined, beforeAdmission),
	);
	assert.equal(renders, 0, "the seam had no session to render into");

	const before = calls.length;
	responses.push({ session_id: SESSION });
	responses.push({ ok: true });
	await admitChatDraft(draftKey, input, undefined, undefined, beforeAdmission);
	assert.equal(
		renders,
		1,
		"the retry skipped the seam, so the credential was never stored and its marker went to the model",
	);
	const sent = calls.slice(before).filter((r) => r.op === "sessions.message");
	assert.equal(sent[0].text, "stored: 1");
	assert.equal(sent[0].text.includes("[Credential #1"), false);
});

/* ------------------------------------------------------------------- notice */

/*
 * B3/B4. THE NOTICE IS THE OUTCOME CLASS'S, AND IT IS DECIDED IN ONE PLACE.
 *
 * The pane used to gate Retry on "is there an error on screen" (`draft.error ===
 * undefined`), which is true for every failure the store records - so Retry was
 * hidden on the arms it exists for and offered on the late-delivery arm, where
 * pressing it duplicates the message. The rule now lives in `composerNoticeFor`,
 * over plain inputs, so it can be read here rather than only in the pane's JSX.
 */
test("the notice offers Retry where a press works, and never over a delivery", () => {
	// The unknown outcome, as the ROW records it: a sentence, and no code the app
	// can classify (the failure was a lost response, not a refusal).
	const unknown = composerNoticeFor({
		error: null,
		code: undefined,
		retry: false,
		muted: false,
		rowError: SEND_FAILURE_COPY.unconfirmed,
		rowCode: undefined,
		rowRetry: true,
		lateDelivered: false,
	});
	assert.equal(unknown?.message, SEND_FAILURE_COPY.unconfirmed);
	assert.equal(
		unknown?.retry,
		true,
		"Retry must be offered on the arm a replay answers",
	);
	assert.equal(unknown?.muted, false);

	/*
	 * A refusal that states the message was not admitted keeps the press out - and
	 * the row's own recorded decision is what is read, not a re-derivation.
	 */
	const refused = composerNoticeFor({
		error: null,
		code: undefined,
		retry: false,
		muted: false,
		rowError: "This message is too large to send. Remove an image or split it.",
		rowCode: undefined,
		rowRetry: false,
		lateDelivered: false,
	});
	assert.equal(refused?.retry, false);

	/*
	 * A row written before the decision was recorded falls back to its code, and the
	 * fallback is the same union `sendFailureCopy` offers a press for.
	 */
	for (const code of [
		DESKTOP_DEADLINE_EXCEEDED_CODE,
		"transport.failed",
		"runtime_unreachable",
		RUNTIME_BUSY_CODE,
		RUNTIME_RETIRING_CODE,
	])
		assert.equal(retryOfferedForFailureCode(code), true, code);
	for (const code of [
		LEADING_SLASH_CODE,
		UNREADABLE_ATTACHMENT_CODE,
		STORE_OUT_OF_SPACE_CODE,
		"pairing.no-credential",
		// Neither a press that works nor a press that re-refuses: it is not what the
		// read window needs, which is the window itself (design round 11, D2).
		SESSION_UNVALIDATED_CODE,
	])
		assert.equal(retryOfferedForFailureCode(code), false, code);
	assert.equal(
		retryOfferedForFailureCode(undefined),
		true,
		"an outcome nothing could name is pressable",
	);

	/*
	 * THE LATE DELIVERY WINS OVER ANY FAILURE TEXT STILL ON THE ROW, which is the
	 * state the previous head rendered as a "Couldn't confirm" sentence next to a
	 * Retry whose press would write a second user row (B4).
	 */
	const delivered = composerNoticeFor({
		error: null,
		code: undefined,
		retry: true,
		muted: false,
		rowError: SEND_FAILURE_COPY.unconfirmed,
		rowCode: undefined,
		rowRetry: true,
		lateDelivered: true,
	});
	/*
	 * The `overlap` arm names the box as well (review round 3, D8): the delivered
	 * words are still in there, so a Send would repeat the sentence the user has
	 * already sent, and only the copy can say so.
	 */
	assert.equal(delivered?.message, SEND_FAILURE_COPY.lateDeliveryOverlap);
	assert.equal(delivered?.muted, true);
	assert.equal(
		delivered?.retry,
		undefined,
		"nothing to press over a message that arrived",
	);

	// And nothing at all on a row with no failure.
	assert.equal(
		composerNoticeFor({
			error: null,
			code: undefined,
			retry: false,
			muted: false,
			rowError: undefined,
			rowCode: undefined,
			rowRetry: undefined,
			lateDelivered: false,
		}),
		undefined,
	);
});

/*
 * M8/U4/Q-3. THE DAEMON'S HOP FAILURE SPEAKS THE TABLE'S LANGUAGE.
 *
 * `runtime_unreachable` is the daemon saying it could not establish whether the
 * request reached the owner, so its arm is the unknown outcome. Relaying its own
 * body instead put "Session owner is unavailable. Reconnect and reconcile before
 * retrying." on the composer: two sentences, two pieces of the app's own
 * vocabulary, and an instruction the user cannot carry out (review round 1, M8).
 */
test("the hop failure's notice is this app's sentence, not the daemon's prose", () => {
	const copy = sendFailureCopy(
		new DesktopControlError(
			503,
			"Session owner is unavailable. Reconnect and reconcile before retrying.",
			undefined,
			"runtime_unreachable",
		),
	);
	assert.equal(
		copy.message,
		SEND_FAILURE_COPY.unconfirmed,
		"the composer relays the daemon's hop-failure prose again",
	);
	assert.equal(copy.retry, true, "and the press it promises is offered");
	for (const jargon of ["session owner", "reconcile"])
		assert.equal(
			copy.message.toLowerCase().includes(jargon),
			false,
			`the notice says "${jargon}"`,
		);
});

/* ------------------------------------------------- late delivery, and identity */

/*
 * THE CONVERGENT BLOCKER OF REVIEW ROUND 2, pinned at both of its halves.
 *
 * The reviewer (R2) and the UX round (U1) found the same defect from two
 * directions: after a message that was handed back turned out to have been
 * delivered, the box kept the words that had just gone, and the next press sent
 * them again as a SECOND row (reproduced live: a9cbe9bf, then c47f3028).
 *
 * The chip half is a lookup by path in a list that may hold the same path twice -
 * the paste handler does not de-dupe, so the same screenshot pasted twice is two
 * chips with one path - which made the row's own untouched payload read as EDITED
 * and sent the late-delivery arm down the "keep the box, say it arrived" branch.
 */

test("two chips that share a path are two chips, so an untouched box is exact", () => {
	reset();
	const store = useConversationInputStore.getState();
	/*
	 * The same file twice, exactly as the paste handler leaves it: one path, two
	 * chips, and a message that cites it twice.
	 */
	store.addAttachment(SESSION, { id: "chip-1", path: "/tmp/shot.png" });
	store.addAttachment(SESSION, { id: "chip-2", path: "/tmp/shot.png" });
	store.setCurrentInput(SESSION, "look at these");
	/*
	 * `beginInFlight` takes the CHIPS (it removes them from the row by identity and
	 * records their paths), which is the shape the composer's own echo write uses.
	 */
	store.beginInFlight(SESSION, {
		text: "look at these",
		attachments: [
			{ id: "chip-1", path: "/tmp/shot.png" },
			{ id: "chip-2", path: "/tmp/shot.png" },
		],
		replies: [],
	});
	store.returnInFlight(SESSION, SESSION);
	const row = useConversationInputStore.getState().inputByConversation[SESSION];
	assert.ok(row?.returned, "the payload did not come back");
	assert.equal(row.returned.chipIds.length, 2);
	assert.equal(
		new Set(row.returned.chipIds).size,
		2,
		"both sent slots named ONE chip, so the row's own untouched payload no longer matches the record of it",
	);
	assert.equal(
		composerHoldsExactly(row, row.returned),
		true,
		"an untouched box read as EDITED, which is what handed the late-delivery arm to the branch that keeps the delivered words",
	);
});

test("a late delivery takes the delivered message out of the box, not the user's line", () => {
	reset();
	const store = useConversationInputStore.getState();
	/*
	 * The live flow: Send, then type the next line while it is in flight, then the
	 * failure hands the payload back and the adoption merges it in front of what the
	 * user typed (`mergeReturnedText` puts the returned message FIRST).
	 */
	store.setCurrentInput(SESSION, "and here is my own next line");
	store.beginInFlight(SESSION, {
		text: "the message that went",
		attachments: [{ id: "chip-1", path: "/tmp/shot.png" }],
		replies: [],
	});
	store.returnInFlight(SESSION, SESSION);
	const merged = useConversationInputStore
		.getState()
		.adoptReturnedText(SESSION);
	assert.equal(merged, "the message that went\n\nand here is my own next line");
	// And then the owner's row arrives: it had been delivered after all.
	useConversationInputStore.getState().reconcileDelivered(SESSION);
	const row = useConversationInputStore.getState().inputByConversation[SESSION];
	assert.equal(
		row.currentInput,
		"and here is my own next line",
		"the delivered words are still in the box, where the next press sends them a second time",
	);
	assert.deepEqual(
		row.attachments ?? [],
		[],
		"the delivered message's chip is still attached",
	);
	assert.equal(
		row.lateDelivered,
		"draft-only",
		"the note must say the box now holds only the user's own draft, so the sentence can say so",
	);
	const lateNotice = composerNoticeFor({
		error: null,
		code: undefined,
		retry: false,
		muted: false,
		rowError: undefined,
		rowCode: undefined,
		rowRetry: undefined,
		lateDelivered: row.lateDelivered,
	});
	assert.equal(lateNotice.message, SEND_FAILURE_COPY.lateDeliveryDraft);
	/*
	 * AND IT IS ANNOUNCED, NOT ASSERTED (review round 2, NIT). The muted register
	 * holds two events: the send lock, which answers a press the user just made, and
	 * this one, which is the app catching up. Rendering both inside the failure's
	 * `role="alert"` made a screen reader interrupt itself to repeat the sentence the
	 * late delivery had just replaced.
	 */
	assert.equal(
		lateNotice.polite,
		true,
		"the late-delivery line must be a polite status, not an alert beside the failure it replaced",
	);
	assert.equal(
		composerNoticeFor({
			error: SEND_FAILURE_COPY.unconfirmed,
			code: undefined,
			retry: true,
			muted: false,
			rowError: undefined,
			rowCode: undefined,
			rowRetry: undefined,
			lateDelivered: undefined,
		}).polite,
		undefined,
		"a failure the user is waiting on stays assertive",
	);
});

test("the delivered words come out however the user spaced their own line", () => {
	reset();
	const store = useConversationInputStore.getState();
	for (const [typed, expected] of [
		// Straight on, caret at the end of the returned message.
		["and my own next line", "and my own next line"],
		// After one Enter, and after two - the two ways a person starts a new line.
		["\nand my own next line", "and my own next line"],
		["\n\nand my own next line", "and my own next line"],
		// Indentation is the user's, and stays: only the line breaks are the join.
		["\n  indented continuation", "  indented continuation"],
	]) {
		reset();
		const row = useConversationInputStore.getState();
		row.beginInFlight(SESSION, {
			text: "the message that went",
			attachments: [],
			replies: [],
		});
		row.returnInFlight(SESSION, SESSION);
		row.adoptReturnedText(SESSION);
		row.setCurrentInput(SESSION, `the message that went${typed}`);
		useConversationInputStore.getState().reconcileDelivered(SESSION);
		const after =
			useConversationInputStore.getState().inputByConversation[SESSION];
		assert.equal(
			after?.currentInput,
			expected,
			`typing ${JSON.stringify(typed)} after a late delivery left the box as ${JSON.stringify(after?.currentInput)}`,
		);
		assert.equal(after?.lateDelivered, "draft-only");
	}
	// A box the user EDITED inside the delivered words cannot be separated, and it
	// is left alone rather than guessed at.
	reset();
	const overlapStore = useConversationInputStore.getState();
	overlapStore.beginInFlight(SESSION, {
		text: "the message that went",
		attachments: [],
		replies: [],
	});
	overlapStore.returnInFlight(SESSION, SESSION);
	overlapStore.adoptReturnedText(SESSION);
	overlapStore.setCurrentInput(SESSION, "the message that WENT, fixed");
	useConversationInputStore.getState().reconcileDelivered(SESSION);
	const edited =
		useConversationInputStore.getState().inputByConversation[SESSION];
	assert.equal(edited?.currentInput, "the message that WENT, fixed");
	assert.equal(
		edited?.lateDelivered,
		"overlap",
		"a box that no longer starts with the delivered text must be left alone, and the note must not claim it holds nothing of that message",
	);
});

test("after a late delivery the next send carries only the user's own line", async () => {
	reset();
	const store = useConversationInputStore.getState();
	store.setCurrentInput(SESSION, "my own next line");
	store.beginInFlight(SESSION, {
		text: "already delivered",
		attachments: [],
		replies: [],
	});
	store.returnInFlight(SESSION, SESSION);
	store.adoptReturnedText(SESSION);
	useConversationInputStore.getState().reconcileDelivered(SESSION);
	const boxed =
		useConversationInputStore.getState().inputByConversation[SESSION]
			?.currentInput ?? "";
	assert.equal(boxed, "my own next line");
	const before = calls.length;
	responses.push({ ok: true });
	await admitChatDraft(key, { ...input, text: boxed }, SESSION);
	const sent = calls.slice(before).filter((r) => r.op === "sessions.message");
	assert.equal(sent.length, 1);
	assert.equal(
		sent[0].text,
		"my own next line",
		"the press sent the delivered words again: this is the duplicate the round reproduced",
	);
});

/* ------------------------------------------------- the daemon's codeless 409 */

/*
 * Q2-1, PROVEN LIVE BY QA AND FIXED HERE (review round 2).
 *
 * The daemon answers its sender-side budget refusal - the text has filled the
 * frame's room for its images - with `409` and a sentence and no code, which the
 * classification read as an unknown outcome: the composer showed "Couldn't confirm
 * your message was sent. Sending it again is safe." with Retry over a refusal it
 * had just explained, and the press re-posted the identical body for ever.
 *
 * The two arms are separated by the one fact that tells them apart and is already
 * recorded: a receipt conflict can only exist for an id the journal has seen, and
 * `admissionAttempted` says whether this app has ever left an attempt under this
 * id unresolved.
 */
test("a codeless 409 on a fresh attempt is a refusal: the daemon's sentence, no Retry", async () => {
	reset();
	/*
	 * The composer's own echo write, which is what puts the payload in flight: a real
	 * send is pressed from a mounted composer and this is the one write that paints
	 * it (`beginInFlight`), so the record of the attempt is the composer's own - the
	 * store's failure arm no longer touches this row either way (S4).
	 */
	const store = useConversationInputStore.getState();
	store.setCurrentInput(SESSION, input.text);
	store.beginInFlight(SESSION, {
		text: input.text,
		attachments: [],
		replies: [],
	});
	responses.push(
		new DesktopControlError(
			409,
			"this message's text alone fills 1.1 MB of the 1.0 MB limit, leaving no room for its attachments; shorten the text or send the images on their own",
		),
	);
	await assert.rejects(admitChatDraft(key, input, SESSION));
	const row = draftRow();
	assert.equal(
		row.errorCode,
		undefined,
		"the row was given a code the daemon never sent",
	);
	assert.equal(
		row.error,
		"this message's text alone fills 1.1 MB of the 1.0 MB limit, leaving no room for its attachments; shorten the text or send the images on their own",
		"the daemon's own sentence is the one fact the user has to act on",
	);
	assert.equal(
		row.errorRetry,
		false,
		"Retry is offered over a refusal that meets the same bytes again for ever - the loop QA measured",
	);
	assert.equal(row.admissionAttempted, false);
	const box = useConversationInputStore.getState().inputByConversation[SESSION];
	assert.equal(
		box?.pendingText,
		undefined,
		"nothing came home (S4): the row states the refusal and its Edit is the way back to the bytes",
	);
});

test("a codeless 409 after an unresolved attempt stays an unknown outcome", async () => {
	reset();
	/* An outcome the app could not establish: the latch, and no stated refusal. */
	const store = useConversationInputStore.getState();
	store.setCurrentInput(SESSION, input.text);
	store.beginInFlight(SESSION, {
		text: input.text,
		attachments: [],
		replies: [],
	});
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(admitChatDraft(key, input, SESSION));
	assert.equal(draftRow().admissionAttempted, true);
	/*
	 * And now the same id is replayed and the daemon answers a codeless 409 - which,
	 * with an attempt already out there, is the receipt conflict: the message may
	 * have been admitted, so it stays unknown and the press is offered.
	 */
	responses.push(
		new DesktopControlError(
			409,
			"Request ID was already used with different input",
		),
	);
	await assert.rejects(admitChatDraft(key, input, SESSION));
	assert.equal(
		draftRow().errorRetry,
		true,
		"a receipt conflict is not a refusal of this body: the attempt it conflicts with is the one whose fate is unknown",
	);
});

/*
 * R2-1, THE OTHER HALF OF THE CODELESS-409 SPLIT (review round 3).
 *
 * The fact that tells a receipt conflict from a refusal of the body is about the
 * id the attempt ACTUALLY CARRIES. `previous.admissionAttempted` is the pre-send
 * snapshot, and an edited payload rotates the id in the same call - so read on its
 * own it described an id this attempt no longer uses, and one failure got two
 * classes: the row latched `not_sent` while the sentence claimed an unknown
 * outcome and offered a Retry that re-posted a refused body.
 */
test("a codeless 409 on a FRESH id after an unresolved attempt is a refusal, and the row agrees with the sentence", async () => {
	reset();
	const store = useConversationInputStore.getState();
	store.setCurrentInput(SESSION, input.text);
	store.beginInFlight(SESSION, {
		text: input.text,
		attachments: [],
		replies: [],
	});
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(admitChatDraft(key, input, SESSION));
	const firstId = draftRow().admissionRequestId;
	assert.equal(draftRow().admissionAttempted, true);
	/*
	 * The user edits the returned message and presses again: the payload no longer
	 * matches the claim, so this is a new message under a new id - and an earlier
	 * attempt left unresolved under the OLD id says nothing about an id the
	 * journal has never seen.
	 */
	const edited = { ...input, text: "Review this, and the diff too" };
	responses.push(
		new DesktopControlError(
			409,
			"this message's text alone fills 1.1 MB of the 1.0 MB limit, leaving no room for its attachments; shorten the text or send the images on their own",
		),
	);
	await assert.rejects(admitChatDraft(key, edited, SESSION));
	const row = draftRow();
	assert.notEqual(
		row.admissionRequestId,
		firstId,
		"an edited payload went out under the id the earlier attempt had used",
	);
	assert.equal(
		row.admissionAttempted,
		false,
		"a refusal the daemon stated is not an attempt whose outcome is unknown",
	);
	assert.equal(
		row.errorRetry,
		false,
		"the press was offered over a body the daemon had just refused",
	);
	assert.doesNotMatch(
		row.error,
		/Sending it again is safe/,
		"the unknown-outcome sentence rendered over a refusal, which is one failure classified twice",
	);
});

/*
 * R2-2 (review round 3). `errorRetry === undefined` is true of every row this
 * build leaves WITHOUT reaching its catch - the pin and the latch are written
 * before the wire, and a quit before the answer writes no `errorRetry` - so the
 * shape gate accepted this build's own row as the released app's claim: it handed
 * the payload back and cleared `submittedText`, which is what `replay` reads,
 * while keeping the id. The next send then went out under an id the owner may
 * already hold a receipt for, with a body the credential seam re-derived.
 */
test("a row this build left at the latch is not migrated as the released app's claim", () => {
	reset();
	const row = {
		key,
		createRequestId: "create-1",
		admissionRequestId: "admit-1",
		admissionAttempted: true,
		submittedText: input.text,
		// Written with the latch, and absent from the released build entirely.
		submittedRendered: input.text,
	};
	assert.equal(
		migrateHeldClaim(key, row),
		false,
		"this build's own interrupted row was treated as the released app's claim",
	);
	assert.equal(
		row.submittedText,
		input.text,
		"the replay pin was cleared while the id stayed, so the next send would carry a re-derived body under an id the owner may hold",
	);
});

/*
 * M1 (review round 4), WHERE THE USER READS IT.
 *
 * R2-1 was fixed in the stored row and not on screen: the pane classified the same
 * failure a second time, from the pre-send row, so on this arm the row said not-sent
 * with no press while the screen said "Couldn't confirm your message was sent.
 * Sending it again is safe." with a Retry - and a remount flipped the same failure to
 * the daemon's sentence. The pin below drives the arm and asserts what the pane's own
 * helper renders from the row, then shows what the old path would have rendered, so a
 * regression to a second classification fails here rather than on a user's screen.
 */
test("the pane renders the store's classification, and not one of its own", async () => {
	reset();
	const store = useConversationInputStore.getState();
	store.setCurrentInput(SESSION, input.text);
	store.beginInFlight(SESSION, {
		text: input.text,
		attachments: [],
		replies: [],
	});
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	await assert.rejects(admitChatDraft(key, input, SESSION));
	const codeless = new DesktopControlError(
		409,
		"this message's text alone fills 1.1 MB of the 1.0 MB limit, leaving no room for its attachments; shorten the text or send the images on their own",
	);
	responses.push(codeless);
	await assert.rejects(
		admitChatDraft(
			key,
			{ ...input, text: "Review this, and the diff too" },
			SESSION,
		),
	);
	const row = draftRow();
	const shown = caughtFailureNotice({
		rowError: row.error,
		rowCode: row.errorCode,
		rowRetry: row.errorRetry,
		fallback: () => {
			throw new Error(
				"the store wrote a row for this failure, so the pane must not fall back to its own classifier",
			);
		},
	});
	assert.equal(
		shown?.message,
		row.error,
		"the pane renders a sentence the row does not carry",
	);
	assert.equal(
		shown?.retry,
		false,
		"the pane offers a press the row has already decided against",
	);
	assert.doesNotMatch(
		shown?.message ?? "",
		/Sending it again is safe/,
		"the unknown-outcome sentence rendered over a body the daemon refused",
	);
	/*
	 * AND THE DISCRIMINATOR: the fact-less pre-send classification the pane used to
	 * make (`previous?.admissionAttempted`, which is TRUE here because an earlier
	 * attempt under the OLD id went unresolved) renders something else entirely.
	 */
	const stale = sendFailureCopy(codeless, undefined, true);
	assert.notEqual(
		stale.message,
		shown?.message,
		"the pre-send fact would have rendered the same sentence, so this arm cannot see the defect it is for",
	);
	assert.equal(
		stale.retry,
		true,
		"the old path offered a Retry over a refusal, which is what the finding measured",
	);
});

/*
 * U17 (review round 5), BOTH ENDINGS, BEHAVIOURALLY.
 *
 * Round 4's fix retired the `overlap` sentence with the words it describes - but it
 * read `row.returned?.text`, and every state that RAISES the note is written with
 * `returned: undefined` (the hand-back has been resolved by then). So the rule always
 * saw an empty string and retired the sentence on the FIRST ordinary keystroke, while
 * the delivered words were still in the box verbatim: the duplicate the sentence exists
 * to warn about, reached after the warning had already gone. The delivered text now
 * rides beside the flag, and this pin drives both endings through the store's own
 * actions - the raise included, so the field cannot quietly stop being written.
 */
test("the overlap sentence retires with the delivered words, and not on any keystroke", () => {
	reset();
	const store = useConversationInputStore.getState();
	const delivered = "PS: board report draft about the numbers";
	const mine = "and this is my new question";
	/*
	 * The app's own return path, and then a user edit INSIDE the delivered words - which
	 * is what makes the boundary unknowable and raises the `overlap` arm rather than the
	 * `draft-only` one.
	 */
	/*
	 * The row the hand-back leaves: the delivered payload in `returned`, and a box the
	 * user has since edited INSIDE those words - which is what makes the boundary
	 * unknowable and raises `overlap` rather than `draft-only`.
	 */
	useConversationInputStore.setState({
		inputByConversation: {
			[SESSION]: {
				currentInput: `${delivered.replace("draft", "DRAFT")}\n\n${mine}`,
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
				returned: { text: delivered, attachments: [], replies: [] },
			},
		},
	});
	useConversationInputStore.getState().reconcileDelivered(SESSION);
	const row = () =>
		useConversationInputStore.getState().inputByConversation[SESSION];
	assert.equal(
		row().lateDelivered,
		"overlap",
		"the arm this pin is about was never reached",
	);
	assert.equal(
		row().lateDeliveredText,
		delivered,
		"the delivered text is not carried beside the note, so the retirement rule has nothing to read",
	);
	/*
	 * ONE ORDINARY KEYSTROKE, with the words still there verbatim: the sentence must stay.
	 */
	const typed = `${row().currentInput}!`;
	useConversationInputStore.getState().setCurrentInput(SESSION, typed);
	assert.equal(
		row().lateDelivered,
		"overlap",
		"the note retired while the delivered words were still in the box, which is the duplicate it exists to warn about",
	);
	assert.ok(
		typed.includes(delivered.replace("draft", "DRAFT")),
		"the pin's own box no longer holds the delivered words, so it is not measuring the arm it claims",
	);
	/*
	 * AND WHEN THE USER DELETES THEM, the note goes: it is a statement about a box that
	 * no longer exists.
	 */
	useConversationInputStore.getState().setCurrentInput(SESSION, mine);
	assert.equal(
		row().lateDelivered,
		undefined,
		"the note outlived the words it describes",
	);
});

/*
 * U19 (review round 6's m6-1, and QA measured this one live): the retention rule had two
 * holes - it stepped over offsets, so a run beginning at an offset the step missed read as
 * absent, and it only looked at the first 400 characters, so a fragment that survived in
 * the TAIL of a long message was never tested. The direction that matters is the one QA
 * walked: a fragment still visible, and the sentence gone.
 */
test("a surviving fragment keeps the sentence, at any offset and in the tail", () => {
	const cases = [
		{
			why: "a 12-character fragment starting at an offset the old step of 8 skipped (a third of this delivered text)",
			delivered: "re-run the failing case and paste the lines",
			edit: "see above: re-run the failing case and paste the lines",
		},
		{
			why: "a fragment that survives only in the TAIL of a long message",
			delivered: `${"the daemon logs a receipt for every admitted message and keeps it ".repeat(6)}the last twenty lines of the trace`,
			edit: "my own question now",
		},
	];
	for (const c of cases) {
		reset();
		useConversationInputStore.setState({
			inputByConversation: {
				[SESSION]: {
					currentInput: c.edit,
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [],
					returned: { text: c.delivered, attachments: [], replies: [] },
				},
			},
		});
		useConversationInputStore.getState().reconcileDelivered(SESSION);
		const row = () =>
			useConversationInputStore.getState().inputByConversation[SESSION];
		assert.equal(
			row().lateDelivered,
			"overlap",
			`${c.why}: the arm was not reached`,
		);
		if (c.delivered.length > 400) {
			/*
			 * The tail case keeps its fragment and NOTHING from the first 400 characters, so
			 * a rule that only scans them retires the sentence here.
			 */
			const tail = c.delivered.slice(-24);
			useConversationInputStore
				.getState()
				.setCurrentInput(SESSION, `${c.edit} ${tail}`);
		} else {
			useConversationInputStore
				.getState()
				.setCurrentInput(SESSION, `${c.edit}!`);
		}
		assert.equal(
			row().lateDelivered,
			"overlap",
			`${c.why}: the sentence retired on an edit that left the words on screen`,
		);
	}
});

/*
 * n5-2 AND m5-1 (review round 5), as one predicate with a behavioural pin.
 *
 * The lock answer's retirement was pinned only by a regex on the effect's source, and it
 * read only the row's `pending` - so a press answered in the window BEFORE an admission
 * exists (image decode, `awaitWindow`) had its sentence retired in the same commit.
 * `lockAnswerOutlived` is the whole rule now, so a term that goes missing fails here.
 */
test("the lock answer outlives exactly the states that hold a flight open", () => {
	const flying = {
		rowPending: false,
		admitting: false,
		gatePending: false,
		muted: true,
	};
	assert.equal(
		lockAnswerOutlived(flying),
		true,
		"a muted lock answer with nothing in flight is stale, and the screen is claiming a send that has ended",
	);
	assert.equal(
		lockAnswerOutlived({ ...flying, admitting: true }),
		false,
		"the pre-admission window is a flight: the row is not pending yet and the answer must stay",
	);
	assert.equal(lockAnswerOutlived({ ...flying, rowPending: true }), false);
	assert.equal(
		lockAnswerOutlived({ ...flying, gatePending: true }),
		false,
		"the gate's own lock belongs to the question on screen, not to a flight",
	);
	assert.equal(
		lockAnswerOutlived({ ...flying, muted: false }),
		false,
		"a real failure's sentence is not the lock's answer, and this rule must not touch it",
	);
});

/*
 * m5-2 (review round 5): the notice belongs to the attempt that produces it.
 *
 * The pane renders the row's sentence when the row has one, so a row still carrying an
 * OLDER failure's sentence showed that one for a throw that writes no row of its own -
 * measured as an unrelated "not ready" refusal rendering the earlier budget sentence. The
 * latch clears it, which is how the store says which attempt the sentence is about.
 */
test("an admission clears the notice the previous failure left on the row", async () => {
	reset();
	const store = useConversationInputStore.getState();
	store.setCurrentInput(SESSION, input.text);
	store.beginInFlight(SESSION, {
		text: input.text,
		attachments: [],
		replies: [],
	});
	responses.push(
		new DesktopControlError(
			409,
			"this message's text alone fills 1.1 MB of the 1.0 MB limit, leaving no room for its attachments; shorten the text or send the images on their own",
		),
	);
	await assert.rejects(admitChatDraft(key, input, SESSION));
	assert.ok(
		draftRow().error,
		"no failure was recorded, so this pin has nothing to clear",
		/*
		 * The next attempt, read at its latch: the notice is gone BEFORE the wire, so a throw
		 * this attempt never records cannot inherit the previous one's sentence.
		 */
	);
	responses.push(new DesktopControlError(504, "deadline_exceeded"));
	const pending = admitChatDraft(key, input, SESSION);
	await Promise.resolve();
	assert.equal(
		draftRow().error,
		undefined,
		"the new attempt kept the previous failure's sentence, so a throw with no row of its own would render it",
	);
	await assert.rejects(pending);
});

/*
 * R7-1 (review round 7), both CLEAR paths. The `partialize` gate keys on
 * `volatilePendingText`, and both of these rows RESET that flag - so a delivered-text copy
 * they leave behind outlives the check that was guarding it. Measured by the reviewer: the
 * masked-capture secret landed in localStorage and stayed there through every later write,
 * with the note gone. The raise path was already gated; these are the two paths that clear a
 * row without dismissing a note.
 */
test("clearing the composer drops the delivered-text copy with the flag it was gated on", () => {
	reset();
	useConversationInputStore.setState({
		inputByConversation: {
			[SESSION]: {
				currentInput: "",
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
				volatilePendingText: true,
				lateDelivered: "overlap",
				lateDeliveredText: "the words a masked capture pinned",
			},
		},
	});
	useConversationInputStore.getState().clearComposer(SESSION);
	const row = () =>
		useConversationInputStore.getState().inputByConversation[SESSION];
	assert.equal(
		row().volatilePendingText,
		undefined,
		"the flag the gate keys on is still set",
	);
	assert.equal(
		row().lateDeliveredText,
		undefined,
		"the delivered-text copy survived the clear that reset the flag gating it",
	);
});

test("the reconciled row drops the copy too, on the arm that empties it", () => {
	reset();
	const delivered = "the words a masked capture pinned";
	useConversationInputStore.setState({
		inputByConversation: {
			[SESSION]: {
				currentInput: "",
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
				volatilePendingText: true,
				lateDelivered: "overlap",
				lateDeliveredText: delivered,
				returned: { text: delivered, attachments: [], replies: [] },
			},
		},
	});
	useConversationInputStore.getState().reconcileDelivered(SESSION);
	const row = () =>
		useConversationInputStore.getState().inputByConversation[SESSION];
	assert.equal(
		row().volatilePendingText,
		undefined,
		"the flag the gate keys on is still set",
	);
	assert.equal(
		row().lateDeliveredText,
		undefined,
		"the cleared arm left the delivered-text copy behind",
	);
});

/*
 * Q7-1 (review round 7), RE-ROUTED BY DESIGN ROUND 9's D17. This arm is raised with no
 * `returned` payload - the in-flight shape - so the delivered text is UNKNOWN and nothing in
 * its routing has read `currentInput`. Neither box-describing sentence may be used here:
 * `overlap`'s says the delivered words are still in the box, `draft-only`'s says what is here
 * now has not been sent, and the app's deliberate text-loss rule can have left those words
 * exactly where they were - which is the direction of the claim that HIDES the repeat the copy
 * exists to warn about. The arm takes the sentence that is true whatever the box holds, and
 * the last two assertions are the swap's own guard: the rendered copy must BE that row, and it
 * must carry neither claim.
 */
test("a late delivery with no payload to compare says the sentence that claims nothing about the box", () => {
	reset();
	useConversationInputStore.setState({
		inputByConversation: {
			[SESSION]: {
				currentInput: "my own words",
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [],
				inFlight: {
					text: "the delivered message",
					attachments: [],
					replies: [],
				},
			},
		},
	});
	useConversationInputStore.getState().reconcileDelivered(SESSION);
	const row = useConversationInputStore.getState().inputByConversation[SESSION];
	assert.equal(
		row.lateDeliveredText,
		undefined,
		"this arm is only meaningful with no delivered text to compare, and it has one",
	);
	assert.equal(
		row.lateDelivered,
		"delivered",
		"the arm routes to a sentence that describes a box its routing never read",
	);
	const notice = composerNoticeFor({
		error: null,
		code: undefined,
		retry: false,
		muted: false,
		rowError: undefined,
		rowCode: undefined,
		rowRetry: undefined,
		lateDelivered: row.lateDelivered,
	});
	assert.equal(
		notice?.message,
		SEND_FAILURE_COPY.lateDelivery,
		"the delivered arm is not rendering the sentence that is true whatever the box holds",
	);
	assert.doesNotMatch(
		notice?.message ?? "",
		/What's here now|still in the box/,
		"the delivered arm's copy is claiming something about a box this arm never read",
	);
	assert.equal(notice?.muted, true, "a delivery is a quiet statement of fact");
});

/*
 * R8-1 (review round 8), the `kept` arm - and the one the round proved LEAKs where the other
 * two were fixed. It resets `volatilePendingText` when the box is empty while keeping the
 * delivered-text copy in the same object literal, so exactly where the flag becomes
 * `undefined` the `partialize` gate stops applying; the discriminant is any chip or quote of
 * the user's own in the row, which is what routes it here rather than to the emptied arm.
 * Reached through public actions only: a volatile return, the user deletes the text, a chip of
 * theirs stays, the transcript reconciles.
 *
 * The gate reads this field, so the field is what the pin asserts - and the note it leaves is
 * asserted too, because `stripped.box` is "overlap" even over an EMPTY box.
 */
test("the kept arm drops the delivered-text copy when it empties the flag, and does not claim an empty box", () => {
	reset();
	const delivered = "the words a masked capture pinned";
	useConversationInputStore.setState({
		inputByConversation: {
			[SESSION]: {
				currentInput: "",
				submittedMessages: [],
				currentHistoryIndex: null,
				replies: [],
				attachments: [{ path: "/tmp/kept-arm.png", name: "kept-arm.png" }],
				volatilePendingText: true,
				lateDelivered: "overlap",
				lateDeliveredText: delivered,
				returned: { text: delivered, attachments: [], replies: [] },
			},
		},
	});
	useConversationInputStore.getState().reconcileDelivered(SESSION);
	const row = () =>
		useConversationInputStore.getState().inputByConversation[SESSION];
	assert.equal(
		row().volatilePendingText,
		undefined,
		"the arm did not empty the flag, so this pin is not measuring the arm it names",
	);
	assert.equal(
		row().lateDeliveredText,
		undefined,
		"the copy outlived the flag that gates it - the leak the round measured, on the arm the other two fixes missed",
	);
	assert.equal(
		row().lateDelivered,
		"draft-only",
		"an empty box is being told the delivered words are still in it",
	);
});

/* ------------------------------------------------ the released app's claim */

/*
 * R1 AND R3, THE TWO HALVES OF THE MIGRATION THAT REVIEW ROUND 2 FOUND BROKEN.
 *
 * R1: a released claim for an EXISTING conversation is keyed `send:<sessionId>`
 * and carries no `sessionId` of its own (the released app wrote one only on its
 * create branch). `composerIdentityFor` resolved only `draft:` keys, so it
 * answered the KEY - an identity no composer is keyed by - and the message went to
 * an orphan row while the same pass cleared `submittedText`: unrecoverable, with a
 * Retry that pressed against an empty box.
 *
 * R3: the gate that made the migration safe also rejected the released app's own
 * rows whenever the failure behind them carried no code at all (its renderer
 * raised `DesktopControlError(null, ...)` for its own deadline and for a failed
 * IPC), which left exactly the same stranded state.
 */
test("a released claim for an existing conversation comes home under the session", () => {
	reset();
	const legacy = {
		key,
		createRequestId: "create-legacy",
		admissionRequestId: "admission-legacy",
		// NOTE: no `sessionId` - the released app wrote one only for a create.
		pending: false,
		admissionAttempted: true,
		submittedText: "kept outside the composer",
		submittedAttachments: ["/tmp/shot.png"],
		heldClaimCode: "send_unconfirmed",
		error: "The app waits up to 20 seconds for this request.",
	};
	useCanonicalSessionsStore.setState({ drafts: { [key]: legacy } });
	assert.equal(migrateHeldClaim(key, legacy), true);
	const row = useConversationInputStore.getState().inputByConversation[SESSION];
	assert.equal(
		row?.pendingText,
		"kept outside the composer",
		"the released claim went to the identity NO composer is keyed by, so the user cannot see or recover their message",
	);
	assert.deepEqual(
		row?.attachments.map((chip) => chip.path),
		["/tmp/shot.png"],
	);
});

test("a released claim whose failure carried no code is still the released app's", () => {
	reset();
	const legacy = {
		key,
		createRequestId: "create-legacy",
		admissionRequestId: "admission-legacy",
		sessionId: SESSION,
		pending: false,
		admissionAttempted: true,
		submittedText: "kept outside the composer",
		submittedAttachments: [],
		// The released app's own deadline, and no claim code: `errorRetry` is a field
		// this build invented, so its absence is the shape of every released row.
		error:
			"The app waits up to 20 seconds for this request, and it was still running when the app stopped waiting.",
	};
	useCanonicalSessionsStore.setState({ drafts: { [key]: legacy } });
	assert.equal(
		migrateHeldClaim(key, legacy),
		true,
		"a released claim with no code was refused, leaving the message in `submittedText` with no reader and a Retry over an empty box",
	);
	const row = useConversationInputStore.getState().inputByConversation[SESSION];
	assert.equal(row?.pendingText, "kept outside the composer");
	assert.equal(
		draftRow().errorCode,
		undefined,
		"the claim carried no code, so the row must not invent one",
	);
	assert.equal(
		draftRow().errorRetry,
		true,
		"an unknown outcome is pressable: the claim's own (absent) code says so",
	);
});
