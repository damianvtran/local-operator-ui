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
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					// `DesktopControlError` carries the status, and the store now reads
					// it: a 413 is our own pre-fetch size guard, so nothing was admitted
					// and the draft must not latch. A fixture that dropped the class
					// would make that branch untestable, so it mirrors the real shape.
					contents: `
			export const desktopResult = request => globalThis.__canonicalRequest(request);
			export class DesktopControlError extends Error {
				constructor(status, message, cause, code) {
					super(message);
					this.name = "DesktopControlError";
					this.status = status;
					this.cause = cause;
					this.code = code;
				}
			}
		`,
					loader: "js",
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
	desktopRequestSchema,
	DesktopControlError,
} = module;
function reset() {
	calls.length = 0;
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
	assert.equal(
		calls.filter((call) => call.op === "sessions.create").length,
		1,
	);
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
		if (refuse) throw new DesktopControlError(422, "Invalid desktop operation.");
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
