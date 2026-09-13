import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

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
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store"; export {DesktopControlError} from "@shared/api/local-operator/desktop-api"; export {desktopRequestSchema} from "./src/shared/desktop-contract"; export {desktopFeatureEnabled} from "./src/renderer/src/shared/api/local-operator/desktop-hooks";',
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
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export const echoPendingUser = (sessionId, id, text, images) =>
	globalThis.__canonicalEcho({ kind: "echo", sessionId, id, text, images });
export const retractPendingUser = (sessionId, id) =>
	globalThis.__canonicalEcho({ kind: "retract", sessionId, id });
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
	panelIdentityFor,
	buildSendPayload,
	desktopRequestSchema,
	DesktopControlError,
	UNCONFIRMED_SEND_CODE,
} = module;
function reset() {
	calls.length = 0;
	echoes.length = 0;
	store.setState({
		sessions: [],
		activeSessionId: "111111111111",
		activeDraftKey: null,
		drafts: {},
		sessionByAgent: {},
		pendingSessionId: null,
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

test("a refused create retains the text but holds no claim to release", async () => {
	reset();
	// U13: the composer suppresses its abandon control when a send failed with
	// no claim held (`onReleaseHeld` undefined) - nothing is being enforced, so
	// an abandon there could only empty a composer under a label naming a
	// message the user cannot see. That branch is live only while `heldText`
	// derives undefined, and chat-page derives it as
	// `admissionAttempted && !pending ? submittedText : undefined`. This pins
	// those inputs as the store leaves them after a refused create:
	// `admissionAttempted` is set only AFTER create succeeds, so moving it
	// earlier - symmetric with the pre-admission pinning of mode/images, and a
	// plausible-looking refactor - would arm a claim over a send nothing is
	// enforcing, resurrect the abandon control U13 removed, and go red here.
	// The derivation is restated rather than imported because the component's
	// memo is not reachable from this store-level harness; if the component's
	// input ever changes, this line is what to revisit.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create") throw new Error("create refused");
		return {};
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input), /create refused/);
	const draft = store.getState().drafts[key];
	assert.equal(
		draft.submittedText,
		input.text,
		"the failed text is retained for the alert to sit on",
	);
	assert.ok(
		typeof draft.error === "string" && draft.error.length > 0,
		"a remount still has copy for the alert from the store's own record",
	);
	assert.notEqual(draft.pending, true, "settled: the escapes may appear");
	assert.notEqual(
		draft.admissionAttempted,
		true,
		"create never succeeded, so no admission outcome is unknown",
	);
	const heldText =
		draft.admissionAttempted && !draft.pending
			? draft.submittedText
			: undefined;
	assert.equal(
		heldText,
		undefined,
		"no claim: the composer's release control stays suppressed (U13)",
	);
});

test("only an issued admission pins the payload, and a discard always frees it", async () => {
	reset();
	let failAdmission = true;
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		if (failAdmission) throw new Error("provider unavailable");
		return { status: "admitted" };
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input), /provider unavailable/);
	// The admission WAS issued, so its outcome is unknown and the payload is
	// pinned until the user resolves it.
	assert.equal(store.getState().drafts[key].admissionAttempted, true);
	await assert.rejects(
		admitChatDraft(key, { ...input, text: "different" }),
		/not been confirmed/,
	);
	// Adding an image is a payload change too and must not be silently dropped.
	await assert.rejects(
		admitChatDraft(key, {
			...input,
			images: [{ data_b64: "x", mime_type: "image/png" }],
		}),
		/not been confirmed/,
	);
	// The escape hatch: discarding frees the composer for good.
	store.getState().discardDraft(key);
	assert.equal(store.getState().drafts[key], undefined);
	failAdmission = false;
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

test("an issued admission refuses an edited resend and names itself so the composer can offer the right escape", async () => {
	reset();
	// The invariant the composer's copy depends on. It shipped once saying "edit
	// it if you need to, then send again" against a store that throws on exactly
	// that, because no test pinned the guard's behaviour on the existing-session
	// path: `createSession` fails FIRST on the new-chat path, leaving
	// `admissionAttempted` false, so editing legitimately works there and the
	// copy looked true. Asserted here on the path where the flag really latches.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		throw new Error("network down");
	};
	const key = draftIdentityFor(null, "222222222222");
	await assert.rejects(admitChatDraft(key, input, "222222222222"));
	assert.equal(store.getState().drafts[key].admissionAttempted, true);
	assert.equal(store.getState().drafts[key].submittedText, input.text);
	// An edited resend is refused, and carries the category the composer keys on
	// to render Restore/abandon instead of "send it again".
	await assert.rejects(
		admitChatDraft(key, { ...input, text: "something else" }, "222222222222"),
		(error) => error.code === UNCONFIRMED_SEND_CODE,
	);
	// Releasing the claim keeps the row - and so the session id - but lets a
	// DIFFERENT message through. Discarding the row instead would allocate a
	// second session for a conversation that already has one.
	const before = store.getState().drafts[key];
	store.getState().releaseClaim(key);
	const after = store.getState().drafts[key];
	assert.equal(after.sessionId, before.sessionId);
	assert.equal(after.admissionAttempted, undefined);
	assert.equal(after.submittedText, undefined);
	assert.equal(after.error, undefined);
	// A fresh admission id: the abandoned request may still be executing, and
	// reusing its id would make the next send an idempotent replay of the old
	// payload rather than a new message.
	assert.notEqual(after.admissionRequestId, before.admissionRequestId);
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return {};
	};
	await admitChatDraft(
		key,
		{ ...input, text: "something else" },
		"222222222222",
	);
	assert.equal(
		calls.at(-1).text,
		"something else",
		"a released claim admits the new payload, not the held one",
	);
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

test("the payload the guard compares is the normalized one, so a whitespace-only edit is the same message", async () => {
	reset();
	// U7: the guard compares byte-for-byte while the composer decided what to SAY
	// on `.trim()`. A whitespace-only edit fell between the two - refused by the
	// guard, but reported as already-in-the-box, which suppressed Restore and the
	// release escape and left only the control that empties the composer.
	// Normalizing at the payload boundary removes the gap: there is one string.
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
		"the held claim stores the normalized payload, not the raw box value",
	);
	// Every whitespace-only variant of the held message must be admitted as the
	// SAME payload rather than refused as a different one. The trailing-newline
	// case is the one the removed `trim()` existed for.
	//
	// The sends deliberately keep failing at the wire so the CLAIM SURVIVES each
	// iteration: a variant that succeeded would retire the draft via
	// `finishDraft`, and every later iteration would then be testing an unarmed
	// guard - passing whatever the comparison did. Each variant is asserted to
	// reach the wire (so the guard admitted it) and to reach it normalized.
	for (const variant of [
		"Summarise the report.",
		"Summarise the report. ",
		" Summarise the report.",
		"Summarise the report.\n",
	]) {
		const before = calls.length;
		await assert.rejects(
			admitChatDraft(key, { ...input, text: variant }, "222222222222"),
			(error) =>
				error.code !== UNCONFIRMED_SEND_CODE ||
				new Error(
					`whitespace-only edit ${JSON.stringify(variant)} was refused as a different message`,
				),
			`a whitespace-only edit (${JSON.stringify(variant)}) must not trip the guard`,
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
			store.getState().drafts[key].admissionAttempted,
			true,
			"the claim must survive so the next variant is a real guard test",
		);
	}
	// A real edit is still refused, and still names itself so the composer can
	// offer the right escape - normalization must not weaken the guard. The claim
	// is re-armed through a genuinely failing send rather than a hand-written
	// patch, so this exercises the path the user takes.
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
	await assert.rejects(
		admitChatDraft(
			key,
			{ ...input, text: "Summarise the other report." },
			"222222222222",
		),
		(error) => error.code === UNCONFIRMED_SEND_CODE,
	);
});

test("a refused reply-prefixed send still offers Restore, and Restore is not a loop", async () => {
	reset();
	// R6: the reply prefix was assembled at the send call, DOWNSTREAM of every
	// comparison the composer makes. So the store held and guarded
	// `<reply-to>…</reply-to>\ntext` while the composer compared the bare box -
	// two strings for one payload, the exact condition U7 was filed to remove,
	// on the one path the U7 fix did not cover.
	//
	// The damage was not the refusal but the ESCAPE: Restore writes the held
	// payload into the box, the next send re-prefixes it, the guard refuses the
	// mismatch, and the composer - seeing its own held text in the box -
	// withdraws Restore and says "Send it again", which is false forever. The
	// only remaining control destroys the message.
	//
	// Driven through the real store with the composer's own predicate basis, so
	// reverting either half (assembly at the boundary, or the composer building
	// its basis the same way) turns this red.
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
	const held = store.getState().drafts[key].submittedText;
	assert.equal(
		held,
		`<reply-to>the failing line</reply-to>\n${box}`,
		"the held claim is the assembled payload",
	);
	// The composer's copy basis, built from the SAME function with the SAME
	// replies still attached - they survive a failed send. Pre-fix this compared
	// the bare box, so `heldInBox` was false here and the alert was coherent;
	// the defect only surfaced one step later, which is why the assertion that
	// matters is the one after Restore.
	assert.equal(
		buildSendPayload(box, replies) === held,
		true,
		"with the reply still attached the box IS the held payload, so the copy must not claim otherwise",
	);
	// Restore hands back the finished payload and consumes the chips that
	// produced it. Re-assembling with the chips still attached would double the
	// prefix - the deadlock - so the invariant is asserted directly.
	const afterRestore = buildSendPayload(held, []);
	assert.equal(
		afterRestore,
		held,
		"a restored payload re-assembled with its chips consumed is byte-identical, so the guard admits it",
	);
	assert.notEqual(
		buildSendPayload(held, replies),
		held,
		"re-prefixing a restored payload is what deadlocked Restore; the chips must be cleared, not the assembly made idempotent",
	);
	// And the store agrees: the restored payload is admitted as the same
	// message rather than refused as a different one.
	const before = calls.length;
	await assert.rejects(
		admitChatDraft(key, { ...input, text: afterRestore }, "222222222222"),
		(error) =>
			error.code !== UNCONFIRMED_SEND_CODE ||
			new Error(
				"a restored reply-prefixed payload was refused as a different message - Restore is a dead end",
			),
		"Restore must hand back something the guard accepts",
	);
	assert.equal(
		calls.slice(before).filter((c) => c.op === "sessions.message").length,
		1,
		"the restored payload must reach the wire",
	);
	// The refusal path still works: a genuinely different message under the same
	// claim is refused and names itself, so the composer offers Restore rather
	// than pretending the send will land.
	await assert.rejects(
		admitChatDraft(
			key,
			{ ...input, text: buildSendPayload("Something else entirely", replies) },
			"222222222222",
		),
		(error) => error.code === UNCONFIRMED_SEND_CODE,
		"an edited reply-prefixed resend is still refused",
	);
	assert.equal(
		store.getState().drafts[key].submittedText,
		held,
		"the claim survives the refusal, so Restore still has a payload to offer",
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
	assert.equal(store.getState().drafts[key].submittedText, input.text);
	assert.equal(store.getState().drafts[key].sessionId, "222222222222");
});

test("latest candidate open wins and a failed open retains outgoing session", async () => {
	reset();
	const resolutions = new Map();
	globalThis.__canonicalRequest = (request) => {
		calls.push(request);
		return new Promise((resolve, reject) =>
			resolutions.set(request.sessionId, { resolve, reject }),
		);
	};
	const first = store.getState().openSession("222222222222");
	const last = store.getState().openSession("333333333333");
	assert.equal(store.getState().activeSessionId, "111111111111");
	resolutions.get("333333333333").resolve({});
	assert.equal(await last, true);
	resolutions.get("222222222222").resolve({});
	assert.equal(await first, false);
	assert.equal(store.getState().activeSessionId, "333333333333");
	const failed = store.getState().openSession("444444444444");
	resolutions.get("444444444444").reject(new Error("unavailable"));
	assert.equal(await failed, false);
	assert.equal(store.getState().activeSessionId, "333333333333");
	assert.ok(calls.every((request) => request.op === "sessions.get"));
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
	// edit. The banner said "send it again", images are part of the payload
	// identity, and removing a screenshot to make it fit was therefore the one
	// action forbidden. Discarding the message was the only exit.
	const heavy = [
		{ data_b64: "A".repeat(64), mime_type: "image/png" },
		{ data_b64: "B".repeat(64), mime_type: "image/png" },
	];
	const light = [{ data_b64: "A".repeat(64), mime_type: "image/png" }];
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
		admitChatDraft(key, { ...input, images: heavy }),
		/too large/,
	);
	assert.equal(
		store.getState().drafts[key].admissionAttempted,
		false,
		"a refusal that never reached the backend must not pin the payload",
	);

	// The remedy the banner actually offers: remove an image and send.
	refuse = false;
	assert.ok(await admitChatDraft(key, { ...input, images: light }));
	const sent = calls.filter((call) => call.op === "sessions.message").at(-1);
	assert.deepEqual(sent.images, light, "the EDITED attachments are what ship");
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

test("a genuinely issued admission still latches, because its outcome is unknown", async () => {
	reset();
	// The complement, and the reason the fix reads the STATUS rather than
	// loosening the flag: a 503 or a lost response may already be executing on
	// the owner, so that payload must stay pinned for a byte-identical replay.
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		throw new DesktopControlError(503, "The backend is not answering.");
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(admitChatDraft(key, input), /not answering/);
	assert.equal(store.getState().drafts[key].admissionAttempted, true);
	await assert.rejects(
		admitChatDraft(key, { ...input, text: "edited" }),
		/not been confirmed/,
	);
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
	assert.ok(
		/"absolute bottom-full[^"]*"/.test(slash),
		"the slash popup no longer renders `absolute bottom-full`, so this test's premise about escaping the parent box is stale",
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
	// nearest positioned ancestor, which the source documents is the composer
	// box itself. If that `relative` goes, the popup anchors to some distant
	// ancestor and floats away from the composer -- a different defect, and
	// this is where it is caught.
	const parent = byId.get(popup.parentId);
	assert.ok(
		parent && parent.tagText.includes('"relative"'),
		"the composer box (the slash popup's direct parent) no longer declares `relative`, so the popup no longer anchors to the box it is meant to escape",
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

	for (const status of [503, 409, 500, "network"]) {
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

	for (const status of [413, 422]) {
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
		panelIdentityFor(
			state.activeDraftKey,
			state.activeDraftKey
				? state.drafts[state.activeDraftKey]?.sessionId
				: (state.activeSessionId ?? undefined),
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
		identityFromStore({
			activeDraftKey: null,
			activeSessionId: sessionId,
			drafts: { [`send:${sessionId}`]: { submittedText: "Review this" } },
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
