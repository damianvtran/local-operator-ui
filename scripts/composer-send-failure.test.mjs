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
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store"; export {useConversationInputStore, mergeReturnedText, mergeReturnedPayload, composerHoldsExactly, rehydrateInputRows} from "./src/renderer/src/shared/store/conversation-input-store"; export {composerNoticeFor, retryOfferedForFailureCode} from "./src/renderer/src/features/chat/composer-notice"; export {DesktopControlError, UserFacingError} from "@shared/api/local-operator/desktop-api"; export {RUNTIME_BUSY_CODE, RUNTIME_RETIRING_CODE, DESKTOP_DEADLINE_EXCEEDED_CODE} from "./src/shared/desktop-contract";',
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
	composerHoldsExactly,
	composerIdentityFor,
	composerNoticeFor,
	migrateHeldClaim,
	retryOfferedForFailureCode,
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
	const row = composerRow(composerIdentityFor(key, SESSION));
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
		SESSION_UNVALIDATED_CODE,
	])
		assert.equal(retryOfferedForFailureCode(code), true, code);
	for (const code of [
		LEADING_SLASH_CODE,
		UNREADABLE_ATTACHMENT_CODE,
		STORE_OUT_OF_SPACE_CODE,
		"pairing.no-credential",
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
	assert.equal(delivered?.message, SEND_FAILURE_COPY.lateDelivery);
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
	assert.equal(
		composerNoticeFor({
			error: null,
			code: undefined,
			retry: false,
			muted: false,
			rowError: undefined,
			rowCode: undefined,
			rowRetry: undefined,
			lateDelivered: row.lateDelivered,
		}).message,
		SEND_FAILURE_COPY.lateDeliveryDraft,
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
