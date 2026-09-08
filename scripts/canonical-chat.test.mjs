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
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store"; export {desktopRequestSchema} from "./src/shared/desktop-contract"; export {desktopFeatureEnabled} from "./src/renderer/src/shared/api/local-operator/desktop-hooks";',
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
					contents:
						"export const desktopResult = request => globalThis.__canonicalRequest(request);",
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
	desktopRequestSchema,
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
	// Admission identity and payload must be replayed byte-for-byte; `mode` is a
	// delivery instruction and deliberately follows the CURRENT session state, so
	// a retry against a now-streaming session steers rather than queueing (F2).
	assert.deepEqual(
		{ ...messages[1], mode: undefined },
		{ ...firstMessage, mode: undefined },
	);
	assert.equal(messages[1].mode, "steer");
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

test("a retry after a streaming turn begins steers instead of queueing", async () => {
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
	await assert.rejects(
		admitChatDraft(key, { ...input, mode: "prompt" }),
		/provider unavailable/,
	);
	failAdmission = false;
	await admitChatDraft(key, { ...input, mode: "steer" });
	const admissions = calls.filter((call) => call.op === "sessions.message");
	assert.equal(admissions.at(-1).mode, "steer");
	assert.equal(admissions[0].requestId, admissions.at(-1).requestId);
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
