import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

// Source-backed, builtins only. No renderer, Electron, dependency tree or
// backend is started. This proves projection/transport contracts, not OS pixels.
const root = new URL("../src/", import.meta.url);
const allowed = new Set(["main/app-attention-projection.ts", "main/app-attention-service.ts", "shared/completion-attention.ts", "shared/team-bridge-poll.ts"]);
const cache = new Map();
async function moduleUrl(relative) {
	if (cache.has(relative)) return cache.get(relative);
	assert.ok(allowed.has(relative), `unexpected dependency ${relative}`);
	const path = new URL(relative, root);
	let source = stripTypeScriptTypes(readFileSync(path, "utf8"), { mode: "transform" });
	for (const match of [...source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)]) {
		const target = new URL(`${match[1]}.ts`, path).href.slice(root.href.length);
		source = source.replace(match[0], `from "${await moduleUrl(target)}"`);
	}
	const result = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
	cache.set(relative, result);
	return result;
}
const { AppAttentionProjection } = await import(await moduleUrl("main/app-attention-projection.ts"));
const { AppAttentionService } = await import(await moduleUrl("main/app-attention-service.ts"));
const { unreadCompletionKind, isUnreadAckableCompletion } = await import(await moduleUrl("shared/completion-attention.ts"));
const attention = (unseen = true, token = "completion-1", revision = [1, 0]) => ({ conversation_id: "session/synthetic", completion_token: token, anchor_id: null, kind: "complete", unseen, revision });
const inbox = (unread, waiting = 0, waitingUnread = 0, revision = 1) => ({ revision, unread_count: unread, waiting_count: waiting, waiting_unread_count: waitingUnread });
const open = (payload = {}, epoch = "epoch-a") => ({ type: "open", epoch, seq: 1, payload });
const frame = (type, seq, payload, session_id = "synthetic", epoch = "epoch-a") => ({ type, seq, payload, session_id, epoch });
const flush = () => new Promise(setImmediate);

test("shared sidebar predicate: only unseen terminal receipts with token are ackable", () => {
	for (const code of ["complete", "error", "interrupted"]) {
		const row = { status: { code }, attention: attention() };
		assert.equal(unreadCompletionKind(row), code);
		assert.equal(isUnreadAckableCompletion(row), true);
		assert.equal(isUnreadAckableCompletion({ ...row, attention: attention(false) }), false);
		assert.equal(isUnreadAckableCompletion({ ...row, attention: attention(true, "") }), false);
	}
	for (const code of [undefined, "running", "busy", "approval", "answer", "wedged", "unknown"]) {
		assert.equal(isUnreadAckableCompletion({ status: { code }, attention: attention() }), false);
	}
});

test("canonical ask/read/pending, independent completion, duplicate banner/Aida/legacy aliases", () => {
	const output = [];
	const p = new AppAttentionProjection((snapshot) => output.push(snapshot));
	p.observe(open({ notifications: inbox(1, 1, 1), attention: { "session/synthetic": attention() }, attention_status: { "session/synthetic": { code: "complete", revision: 1 } } }));
	assert.deepEqual(output.at(-1), { unreadCount: 3, pending: true });
	p.observe(frame("notification", 2, { kind: "complete", dedupe_key: "same-completion" }));
	p.observe(frame("notification", 3, { kind: "ask", dedupe_key: "same-ask-legacy-mirror" }));
	assert.equal(output.at(-1).unreadCount, 3, "presentations do not add units; Aida uses the same session set");
	p.observe(frame("notifications", 4, inbox(1, 1, 0, 2)));
	assert.deepEqual(output.at(-1), { unreadCount: 2, pending: true }, "reading does not settle the ask");
	p.observe(frame("attention", 5, attention(false, "completion-1", [1, 1])));
	assert.deepEqual(output.at(-1), { unreadCount: 1, pending: true }, "completion read does not consume independent notify item");
	p.observe(frame("notifications", 6, inbox(0, 1, 0, 3)));
	assert.deepEqual(output.at(-1), { unreadCount: 0, pending: true });
	p.observe(frame("notifications", 7, inbox(0, 0, 0, 4)));
	assert.deepEqual(output.at(-1), { unreadCount: 0, pending: false });
});

test("startup unknown status, gate takeover, reordered receipts and identity fencing", () => {
	const output = [];
	const p = new AppAttentionProjection((snapshot) => output.push(snapshot));
	p.observe(open({ attention: { "session/synthetic": attention() } }));
	assert.equal(output.at(-1).unreadCount, 0, "unknown terminal eligibility is not guessed");
	p.observe(frame("session_status", 2, { code: "complete", revision: 1 }));
	assert.equal(output.at(-1).unreadCount, 1);
	p.observe(frame("session_status", 3, { code: "approval", revision: 2 }));
	assert.deepEqual(output.at(-1), { unreadCount: 0, pending: true });
	p.observe(frame("session_status", 2, { code: "complete", revision: 1 }));
	assert.equal(output.at(-1).unreadCount, 0);
	const old = p.currentGeneration;
	p.reset();
	p.setBridgeUnread(99, old);
	assert.equal(output.at(-1).unreadCount, 0);
	p.observe(open({}, "epoch-b"));
	p.observe(frame("attention", 100, attention(), "synthetic", "epoch-a"));
	assert.equal(output.at(-1).unreadCount, 0);
	p.setBrowserPending(true);
	assert.deepEqual(output.at(-1), { unreadCount: 0, pending: true });
	p.setBrowserPending(false);
	p.setMeshPending(true, p.currentGeneration);
	assert.deepEqual(output.at(-1), { unreadCount: 0, pending: true });
	p.setMeshPending(false, p.currentGeneration);
	assert.equal(output.at(-1).pending, false);
});

test("HTTP inbox snapshot cannot overwrite a newer feed level", () => {
	let last;
	const p = new AppAttentionProjection((snapshot) => { last = snapshot; });
	p.observe(open({ notifications: inbox(3) }));
	const version = p.currentInboxVersion;
	p.observe(frame("notifications", 2, inbox(0, 0, 0, 2)));
	p.setInboxSnapshot(inbox(3), version, p.currentGeneration);
	assert.equal(last.unreadCount, 0);
});

test("successful READ traffic never triggers reconciliation; only proven writes do", async () => {
	const requests = [];
	const service = new AppAttentionService({ request: async (input) => { requests.push(input); return { status: 200, body: { result: {} } }; }, publish: () => {}, clear: () => {} });
	for (const op of ["team_bridge.status", "team_bridge.unread", "team_bridge.directory", "team_bridge.conversations.list", "team_bridge.messages.list", "team_bridge.unread.events", "notifications.list", "approvals.list"]) service.observeResponse({ op }, { status: 200 });
	assert.equal(requests.length, 0);
	service.observeResponse({ op: "team_bridge.read" }, { status: 403 });
	assert.equal(requests.length, 0);
	service.observeResponse({ op: "team_bridge.read" }, { status: 200 });
	assert.equal(requests[0].op, "team_bridge.status");
	service.stop();
	await flush();
});

test("Bridge uses one authorized account total and rejects a write-racing stale snapshot", async () => {
	const output = [], requests = [];
	let release, reads = 0;
	const service = new AppAttentionService({ request: async (input) => {
		requests.push(input);
		if (input.op === "capabilities") return { status: 200, body: { result: { features: {} } } };
		if (input.op === "team_bridge.status") return { status: 200, body: { result: { state: "ready", account_id: "synthetic-account" } } };
		if (input.op === "team_bridge.unread") {
			assert.deepEqual(input, { op: "team_bridge.unread", scope: "account" });
			if (++reads === 1) return new Promise((resolve) => { release = () => resolve({ status: 200, body: { result: { total: 7, organizations: Array.from({ length: 12 }, () => ({ unread: 99 })) } } }); });
			return { status: 200, body: { result: { total: 0 } } };
		}
		return { status: 200, body: { result: { settings: [] } } };
	}, publish: (snapshot) => output.push(snapshot), clear: () => {} });
	service.invalidate();
	await flush();
	assert.equal(typeof release, "function");
	service.observeResponse({ op: "team_bridge.read" }, { status: 200 });
	release();
	await flush();
	assert.equal(output.some((snapshot) => snapshot.unreadCount === 7), false);
	assert.equal(output.at(-1).unreadCount, 0);
	assert.equal(requests.some((input) => input.op === "team_bridge.unread.events"), false, "proposed endpoint is not called without capability");
	service.stop();
});


test("snapshot cursor reserved before reads preserves the queued newer level", () => {
	let last;
	const p = new AppAttentionProjection((snapshot) => { last = snapshot; });
	p.observe({ ...open({ notifications: inbox(4, 0, 0, 1) }), seq: 10 });
	p.observe(frame("notifications", 11, inbox(0, 0, 0, 2)));
	assert.equal(last.unreadCount, 0);
	p.observe(frame("notifications", 12, inbox(9, 0, 0, 1)));
	assert.equal(last.unreadCount, 0, "stale authority revision still cannot restore a count");
});

test("stop gates every projection publisher and cancelled-quit resume re-arms", async () => {
	const output = [];
	const service = new AppAttentionService({ request: async () => ({ status: 503 }), publish: (snapshot) => output.push(snapshot), clear: () => {} });
	service.projection.setBrowserPending(true);
	service.stop();
	const stoppedAt = output.length;
	service.projection.setBrowserPending(false);
	service.observe(open({ notifications: inbox(99) }));
	service.reset();
	assert.equal(output.length, stoppedAt, "late feed/browser/HTTP work cannot repaint after stop");
	service.resume();
	assert.ok(output.length > stoppedAt);
	service.stop();
	await flush();
});

test("unknown principal verification discards count without immediate retry storm", async () => {
	let statuses = 0;
	const requests = [];
	const output = [];
	const service = new AppAttentionService({ request: async (input) => {
		requests.push(input);
		if (input.op === "team_bridge.status") return ++statuses === 1
			? { status: 200, body: { result: { state: "ready", account_id: "synthetic-a" } } }
			: { status: 503 };
		if (input.op === "team_bridge.unread") return { status: 200, body: { result: { total: 99 } } };
		return { status: 200, body: { result: { features: {}, settings: [] } } };
	}, publish: (snapshot) => output.push(snapshot), clear: () => {} });
	service.invalidate();
	await flush();
	assert.equal(statuses, 2);
	assert.equal(output.some((snapshot) => snapshot.unreadCount === 99), false);
	service.stop();
});

test("auth and signed-out account changes clear Bridge contribution synchronously", async () => {
	let last;
	const service = new AppAttentionService({ request: async () => ({ status: 503 }), publish: (snapshot) => { last = snapshot; }, clear: () => {} });
	for (const input of [{ op: "auth.logout" }, { op: "agent_messages.settings.put" }, { op: "accounts.remove", accountId: 1, confirmed: true }]) {
		service.projection.setBridgeUnread(7, service.projection.currentGeneration);
		service.observeResponse(input, { status: 200 });
		assert.equal(last.unreadCount, 0);
	}
	service.stop();
	await flush();
});

test("fallback uses the shared 30 second account cadence, never organization fanout", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
	const requests = [];
	const service = new AppAttentionService({ request: async (input) => {
		requests.push(input);
		if (input.op === "team_bridge.status") return { status: 200, body: { result: { state: "ready", account_id: "synthetic-a" } } };
		if (input.op === "team_bridge.unread") return { status: 200, body: { result: { total: 3 } } };
		return { status: 200, body: { result: { features: {}, settings: [] } } };
	}, publish: () => {}, clear: () => {} });
	service.invalidate();
	await flush();
	t.mock.timers.tick(29_999);
	await flush();
	assert.equal(requests.filter((input) => input.op === "team_bridge.unread").length, 1);
	t.mock.timers.tick(1);
	await flush();
	assert.equal(requests.filter((input) => input.op === "team_bridge.unread").length, 2);
	assert.equal(requests.filter((input) => input.op === "capabilities").length, 1, "fallback is Bridge-only");
	assert.equal(requests.filter((input) => input.op === "settings.list").length, 1, "fallback cannot refresh settings/inbox/approvals");
	assert.ok(requests.filter((input) => input.op === "team_bridge.unread").every((input) => input.scope === "account" && input.tenant_id === undefined));
	service.stop();
});

test("capability without UI-schema admission never starts proposed long poll", async () => {
	const requests = [];
	const service = new AppAttentionService({ request: async (input) => {
		requests.push(input);
		if (input.op === "capabilities") return { status: 200, body: { result: { features: { team_bridge_unread_events: 1 } } } };
		if (input.op === "team_bridge.status") return { status: 200, body: { result: { state: "ready", account_id: "synthetic-a" } } };
		if (input.op === "team_bridge.unread") return { status: 200, body: { result: { total: 0, cursor: "9223372036854775807" } } };
		return { status: 200, body: { result: { settings: [] } } };
	}, publish: () => {}, clear: () => {}, supportsUnreadEvents: false });
	service.invalidate();
	await flush();
	assert.equal(requests.some((input) => input.op === "team_bridge.unread.events"), false);
	service.stop();
});

test("fast 204 long-poll response waits at least one second before renewal", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
	let polls = 0;
	const service = new AppAttentionService({ request: async (input) => {
		if (input.op === "capabilities") return { status: 200, body: { result: { features: { team_bridge_unread_events: 1 } } } };
		if (input.op === "team_bridge.status") return { status: 200, body: { result: { state: "ready", account_id: "synthetic-a" } } };
		if (input.op === "team_bridge.unread") return { status: 200, body: { result: { total: 0, cursor: "2" } } };
		if (input.op === "team_bridge.unread.events") { polls++; return { status: 204 }; }
		return { status: 200, body: { result: { settings: [] } } };
	}, publish: () => {}, clear: () => {}, supportsUnreadEvents: true });
	service.invalidate();
	await flush();
	assert.equal(polls, 1);
	t.mock.timers.tick(999);
	await flush();
	assert.equal(polls, 1);
	t.mock.timers.tick(1);
	await flush();
	assert.equal(polls, 2);
	service.stop();
});


test("same-principal account focus reads and account agent lists never clear or reconcile", async () => {
	const requests = [];
	const output = [];
	const service = new AppAttentionService({ request: async (input) => {
		requests.push(input);
		if (input.op === "team_bridge.status") return { status: 200, body: { result: { state: "ready", account_id: "synthetic-a" } } };
		if (input.op === "team_bridge.unread") return { status: 200, body: { result: { total: 7 } } };
		return { status: 200, body: { result: { features: {}, settings: [] } } };
	}, publish: (snapshot) => output.push(snapshot), clear: () => {} });
	service.invalidate();
	await flush();
	assert.equal(output.at(-1).unreadCount, 7);
	const calls = requests.length;
	const publications = output.length;
	const accountRead = (id) => ({ status: 200, body: { result: { data: { msg: "ok", result: { account: { id } } } } } });
	service.observeResponse({ op: "radient.request", control: { operation: "account" } }, accountRead("synthetic-a"));
	service.observeResponse({ op: "radient.request", control: { operation: "account.agents" } }, { status: 200, body: { result: { data: { result: { agents: [] } } } } });
	service.observeResponse({ op: "agent_messages.status" }, { status: 200, body: { result: { state: "ready", account_id: "synthetic-a" } } });
	service.observeResponse({ op: "auth.status" }, { status: 200 });
	await flush();
	assert.equal(requests.length, calls);
	assert.equal(output.length, publications);
	assert.equal(output.at(-1).unreadCount, 7);
	service.observeResponse({ op: "radient.request", control: { operation: "account" } }, accountRead("synthetic-b"));
	assert.equal(output.at(-1).unreadCount, 0, "a returned different principal fences before refetch");
	service.stop();
	await flush();
});

test("approval HTTP snapshot cannot overwrite a newer settle feed level", () => {
	let last;
	const p = new AppAttentionProjection((snapshot) => { last = snapshot; });
	p.observe(open({ approvals_pending: true }));
	const version = p.currentMeshVersion;
	p.observe(frame("approvals", 2, { pending: false }));
	p.setMeshSnapshot(true, version, p.currentGeneration);
	assert.equal(last.pending, false);
	p.observe(frame("approvals", 99, { pending: true }, "synthetic", "old-epoch"));
	assert.equal(last.pending, false, "old epoch approvals are not current authority");
	p.setMeshSnapshot(true, p.currentMeshVersion, p.currentGeneration);
	assert.equal(last.pending, true);
});

test("feed open replaces native level without an intermediate clear", () => {
	const output = [];
	let clears = 0;
	const service = new AppAttentionService({ request: async () => ({ status: 503 }), publish: (snapshot) => output.push(snapshot), clear: () => { clears++; } });
	service.observe(open({ notifications: inbox(5) }));
	output.length = 0;
	service.observe(open({ notifications: inbox(2) }, "epoch-b"));
	assert.deepEqual(output, [{ unreadCount: 2, pending: false }]);
	assert.equal(clears, 0);
	service.stop();
});


test("retired completion is acknowledgeable when canonical status is interrupted", () => {
	let last;
	const p = new AppAttentionProjection((snapshot) => { last = snapshot; });
	const retired = { ...attention(true, "retire-for-build"), kind: "retired" };
	p.observe(open({}));
	p.observe(frame("attention", 2, retired));
	p.observe(frame("session_status", 3, { code: "interrupted", revision: 1 }));
	assert.equal(last.unreadCount, 1, "retired is a completion receipt, not session removal");
	p.observe(open({ attention: { "session/synthetic": retired }, attention_status: { "session/synthetic": { code: "interrupted", revision: 1 } } }, "epoch-b"));
	assert.equal(last.unreadCount, 1, "reconnect agrees with the live shared predicate");
	p.observe(frame("attention", 2, { ...retired, unseen: false, revision: [1, 1] }, "synthetic", "epoch-b"));
	assert.equal(last.unreadCount, 0);
});

test("transient Bridge status preserves the last authorized same-account total", async () => {
	let state = "ready";
	let last;
	const service = new AppAttentionService({ request: async (input) => {
		if (input.op === "team_bridge.status") return { status: 200, body: { result: { state, account_id: state === "signed_out" ? null : "synthetic-a" } } };
		if (input.op === "team_bridge.unread") return { status: 200, body: { result: { total: 4 } } };
		return { status: 200, body: { result: { features: {}, settings: [] } } };
	}, publish: (snapshot) => { last = snapshot; }, clear: () => {} });
	try {
		service.invalidate();
		await flush();
		assert.equal(last.unreadCount, 4);
		for (state of ["unavailable", "update_required"]) {
			service.invalidate();
			await flush();
			assert.equal(last.unreadCount, 4, `${state} is unknown, not verified sign-out`);
		}
		state = "signed_out";
		service.invalidate();
		await flush();
		assert.equal(last.unreadCount, 0, "verified sign-out still clears");
	} finally { service.stop(); }
});

test("lifecycle and consent successful writes invalidate the account aggregate", async () => {
	const requests = [];
	const service = new AppAttentionService({ request: async (input) => { requests.push(input); return { status: 503 }; }, publish: () => {}, clear: () => {} });
	try {
		for (const op of ["team_bridge.conversations.lifecycle", "team_bridge.conversations.consent"]) {
			requests.length = 0;
			service.observeResponse({ op }, { status: 403 });
			await flush();
			assert.equal(requests.length, 0, "a refused write changes no authority");
			service.observeResponse({ op }, { status: 200 });
			await flush();
			assert.ok(requests.some((input) => input.op === "team_bridge.status"), op);
			assert.equal(requests.some((input) => input.op === "settings.list" || input.op === "capabilities"), false);
		}
	} finally { service.stop(); }
});
