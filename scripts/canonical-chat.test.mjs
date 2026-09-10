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
	// identified by shrink-0 + bg-surface -- the discriminator QA used, which
	// deliberately does not match the transcript scroller that also carries
	// the chatcol container query.
	const bandCandidates = [...union.values()].filter(
		(el) => hasClass(el, "shrink-0") && hasClass(el, "bg-surface"),
	);
	assert.ok(
		bandCandidates.length === 1,
		`expected exactly one composer band (shrink-0 + bg-surface) among the popup's ancestors, found ${bandCandidates.length} -- re-aim the guard if the composer structure changed`,
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
