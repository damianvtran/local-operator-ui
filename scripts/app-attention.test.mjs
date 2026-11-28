import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

// Source-backed, builtins only. No renderer, Electron, dependency tree or
// backend is started. This proves projection/transport contracts, not OS pixels.
const root = new URL("../src/", import.meta.url);
const allowed = new Set([
	"main/app-attention-projection.ts",
	"main/app-attention-service.ts",
	"main/app-icon-badge.ts",
	"shared/app-attention-queued-asks.ts",
	"shared/completion-attention.ts",
	"shared/team-bridge-poll.ts",
]);
const cache = new Map();
async function moduleUrl(relative) {
	if (cache.has(relative)) return cache.get(relative);
	assert.ok(allowed.has(relative), `unexpected dependency ${relative}`);
	const path = new URL(relative, root);
	let source = stripTypeScriptTypes(readFileSync(path, "utf8"), {
		mode: "transform",
	});
	for (const match of [...source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)]) {
		const target = new URL(`${match[1]}.ts`, path).href.slice(root.href.length);
		source = source.replace(match[0], `from "${await moduleUrl(target)}"`);
	}
	const result = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
	cache.set(relative, result);
	return result;
}
const { AppAttentionProjection } = await import(
	await moduleUrl("main/app-attention-projection.ts")
);
const { AppAttentionService } = await import(
	await moduleUrl("main/app-attention-service.ts")
);
const { createAppIconBadge } = await import(
	await moduleUrl("main/app-icon-badge.ts")
);
const { unreadCompletionKind, isUnreadAckableCompletion } = await import(
	await moduleUrl("shared/completion-attention.ts")
);
const {
	queuedAskSessionIds,
	parseQueuedAskSessionIds,
	acceptQueuedAskReport,
	nextQueuedAskReport,
	statusFrameMovesQueuedAskClaim,
	MAX_QUEUED_ASK_SESSIONS,
} = await import(await moduleUrl("shared/app-attention-queued-asks.ts"));
const attention = (
	unseen = true,
	token = "completion-1",
	revision = [1, 0],
) => ({
	conversation_id: "session/synthetic",
	completion_token: token,
	anchor_id: null,
	kind: "complete",
	unseen,
	revision,
});
const inbox = (unread, waiting = 0, waitingUnread = 0, revision = 1) => ({
	revision,
	unread_count: unread,
	waiting_count: waiting,
	waiting_unread_count: waitingUnread,
});
const open = (payload = {}, epoch = "epoch-a") => ({
	type: "open",
	epoch,
	seq: 1,
	payload,
});
const frame = (
	type,
	seq,
	payload,
	session_id = "synthetic",
	epoch = "epoch-a",
) => ({ type, seq, payload, session_id, epoch });
const flush = () => new Promise(setImmediate);

test("live regression: rail 10 + Aida 1 + Bridge 0 ignores 124 historical completions", () => {
	let last;
	const p = new AppAttentionProjection((snapshot) => {
		last = snapshot;
	});
	p.setAidaSession("synthetic");
	const receipts = { "session/synthetic": attention() };
	const statuses = { "session/synthetic": { code: "complete", revision: 1 } };
	for (let i = 0; i < 124; i++) {
		receipts[`session/historical-${i}`] = attention(true, `old-${i}`);
		statuses[`session/historical-${i}`] = { code: "complete", revision: 1 };
	}
	p.observe(
		open({
			notifications: inbox(10),
			attention: receipts,
			attention_status: statuses,
		}),
	);
	assert.equal(last.unreadCount, 11);
	assert.equal(last.pending, false);
	p.observe(frame("attention", 2, attention(false, "completion-1", [1, 1])));
	assert.equal(last.unreadCount, 10, "reading Aida clears only her one pill");
	p.setAidaSession(null);
	assert.equal(last.unreadCount, 10, "hidden/disabled Aida contributes zero");
});

test("empty inbox plus historical completions stays clear through the real native adapter", () => {
	const writes = [];
	const badge = createAppIconBadge({
		platform: "darwin",
		setDockBadge: (label) => writes.push(label),
		describe: () => "synthetic description",
	});
	const p = new AppAttentionProjection((snapshot, enabled) => {
		badge.update(snapshot, enabled);
	});
	p.setAidaSession("synthetic");
	const receipts = {};
	const statuses = {};
	for (let i = 0; i < 124; i++) {
		receipts[`session/historical-${i}`] = attention(true, `old-${i}`);
		statuses[`session/historical-${i}`] = { code: "complete", revision: 1 };
	}
	p.observe(
		open({
			notifications: inbox(0),
			attention: receipts,
			attention_status: statuses,
		}),
	);
	assert.equal(badge.readForScene().unreadCount, 0);
	assert.equal(badge.readForScene().pending, false);
	assert.deepEqual(
		writes,
		[""],
		"historical receipts must not paint any badge",
	);
});

test("rail sum 11 clears to zero through the real projection and native adapter", () => {
	const writes = [];
	const badge = createAppIconBadge({
		platform: "darwin",
		setDockBadge: (label) => writes.push(label),
		describe: () => "synthetic description",
	});
	const p = new AppAttentionProjection((snapshot, enabled) => {
		badge.update(snapshot, enabled);
	});
	p.setAidaSession("synthetic");
	p.observe(
		open({
			notifications: inbox(10),
			attention: { "session/synthetic": attention() },
			attention_status: {
				"session/synthetic": { code: "complete", revision: 1 },
			},
		}),
	);
	assert.equal(writes.at(-1), "11");
	p.observe(frame("attention", 2, attention(false, "completion-1", [1, 1])));
	assert.equal(writes.at(-1), "10");
	p.observe(frame("notifications", 3, inbox(0, 0, 0, 2)));
	assert.equal(badge.readForScene().unreadCount, 0);
	assert.equal(badge.readForScene().pending, false);
	assert.deepEqual(writes, ["", "11", "10", ""]);
});

test("shared sidebar predicate: only unseen terminal receipts with token are ackable", () => {
	for (const code of ["complete", "error", "interrupted"]) {
		const row = { status: { code }, attention: attention() };
		assert.equal(unreadCompletionKind(row), code);
		assert.equal(isUnreadAckableCompletion(row), true);
		assert.equal(
			isUnreadAckableCompletion({ ...row, attention: attention(false) }),
			false,
		);
		assert.equal(
			isUnreadAckableCompletion({ ...row, attention: attention(true, "") }),
			false,
		);
	}
	for (const code of [
		undefined,
		"running",
		"busy",
		"approval",
		"answer",
		"wedged",
		"unknown",
	]) {
		assert.equal(
			isUnreadAckableCompletion({ status: { code }, attention: attention() }),
			false,
		);
	}
});

test("canonical ask/read/pending, independent completion, duplicate banner/Aida/legacy aliases", () => {
	const output = [];
	const p = new AppAttentionProjection((snapshot) => output.push(snapshot));
	p.setAidaSession("synthetic");
	p.observe(
		open({
			notifications: inbox(1, 1, 1),
			attention: { "session/synthetic": attention() },
			attention_status: {
				"session/synthetic": { code: "complete", revision: 1 },
			},
		}),
	);
	assert.deepEqual(output.at(-1), { unreadCount: 3, pending: true });
	p.observe(
		frame("notification", 2, {
			kind: "complete",
			dedupe_key: "same-completion",
		}),
	);
	p.observe(
		frame("notification", 3, {
			kind: "ask",
			dedupe_key: "same-ask-legacy-mirror",
		}),
	);
	assert.equal(
		output.at(-1).unreadCount,
		3,
		"presentations do not add units; Aida uses the same session set",
	);
	p.observe(frame("notifications", 4, inbox(1, 1, 0, 2)));
	assert.deepEqual(
		output.at(-1),
		{ unreadCount: 2, pending: true },
		"reading does not settle the ask",
	);
	p.observe(frame("attention", 5, attention(false, "completion-1", [1, 1])));
	assert.deepEqual(
		output.at(-1),
		{ unreadCount: 1, pending: true },
		"completion read does not consume independent notify item",
	);
	p.observe(frame("notifications", 6, inbox(0, 1, 0, 3)));
	assert.deepEqual(output.at(-1), { unreadCount: 0, pending: true });
	p.observe(frame("notifications", 7, inbox(0, 0, 0, 4)));
	assert.deepEqual(output.at(-1), { unreadCount: 0, pending: false });
});

test("startup unknown status, gate takeover, reordered receipts and identity fencing", () => {
	const output = [];
	const p = new AppAttentionProjection((snapshot) => output.push(snapshot));
	p.setAidaSession("synthetic");
	p.observe(open({ attention: { "session/synthetic": attention() } }));
	assert.equal(
		output.at(-1).unreadCount,
		0,
		"unknown terminal eligibility is not guessed",
	);
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
	const p = new AppAttentionProjection((snapshot) => {
		last = snapshot;
	});
	p.setAidaSession("synthetic");
	p.observe(open({ notifications: inbox(3) }));
	const version = p.currentInboxVersion;
	p.observe(frame("notifications", 2, inbox(0, 0, 0, 2)));
	p.setInboxSnapshot(inbox(3), version, p.currentGeneration);
	assert.equal(last.unreadCount, 0);
});

test("successful READ traffic never triggers reconciliation; only proven writes do", async () => {
	const requests = [];
	const service = new AppAttentionService({
		request: async (input) => {
			requests.push(input);
			return { status: 200, body: { result: {} } };
		},
		publish: () => {},
		clear: () => {},
	});
	for (const op of [
		"team_bridge.status",
		"team_bridge.unread",
		"team_bridge.directory",
		"team_bridge.conversations.list",
		"team_bridge.messages.list",
		"team_bridge.unread.events",
		"notifications.list",
		"approvals.list",
	])
		service.observeResponse({ op }, { status: 200 });
	assert.equal(requests.length, 0);
	service.observeResponse({ op: "team_bridge.read" }, { status: 403 });
	assert.equal(requests.length, 0);
	service.observeResponse({ op: "team_bridge.read" }, { status: 200 });
	assert.equal(requests[0].op, "team_bridge.status");
	service.stop();
	await flush();
});

test("service resolves the enabled Aida rail and rechecks it after local control writes", async () => {
	let enabled = true;
	const output = [];
	const requests = [];
	const service = new AppAttentionService({
		request: async (input) => {
			requests.push(input.op);
			const result =
				input.op === "capabilities"
					? { features: { aida: 1, notifications: 1 } }
					: input.op === "aida.status"
						? { enabled, session_id: "synthetic" }
						: input.op === "notifications.count"
							? inbox(10)
							: input.op === "team_bridge.status"
								? { state: "signed_out", account_id: null }
								: {};
			return { status: 200, body: { result } };
		},
		publish: (snapshot) => output.push(snapshot),
		clear: () => {},
	});
	service.observe(
		open({
			attention: { "session/synthetic": attention() },
			attention_status: {
				"session/synthetic": { code: "complete", revision: 1 },
			},
		}),
	);
	await flush();
	assert.equal(output.at(-1).unreadCount, 11);
	enabled = false;
	service.observeResponse({ op: "aida.control" }, { status: 200 });
	await flush();
	assert.equal(output.at(-1).unreadCount, 10);
	assert.equal(requests.filter((op) => op === "aida.status").length, 2);
	enabled = true;
	service.observeResponse({ op: "settings.edit" }, { status: 200 });
	await flush();
	assert.equal(output.at(-1).unreadCount, 11);
	assert.equal(requests.filter((op) => op === "aida.status").length, 3);
	service.stop();
});

test("a pending Guard consent in the HTTP approvals list does not light the native attention mark; an ordinary approval still does", async () => {
	// RFC v0.9 §5.2.3: the Guard prompt "never takes focus" and sends no push, so
	// it should not surface through the Dock/taskbar dot either. SCOPE OF THIS PIN:
	// the HTTP list only. A live `approvals` feed frame with `pending: true` still
	// lights the mark, because the host's `_approval_snapshot` counts every
	// `requested` record, the guard mirror included (S-3; a host-side open item).
	// The gear's corner count is the prompt's own mark. The row is identified the way the host serves it: by
	// the typed block's `operation` (there is no `kind` key on the wire).
	const guard = {
		approval_id: "ap_guard",
		state: "requested",
		typed_approval: { operation: "guard_consent" },
	};
	const device = { approval_id: "ap_device", state: "requested" };
	const run = async (rows) => {
		const output = [];
		const service = new AppAttentionService({
			request: async (input) => {
				const result =
					input.op === "capabilities"
						? { features: { approvals: 1 } }
						: input.op === "approvals.list"
							? { approvals: rows }
							: input.op === "team_bridge.status"
								? { state: "signed_out", account_id: null }
								: {};
				return { status: 200, body: { result } };
			},
			publish: (snapshot) => output.push(snapshot),
			clear: () => {},
		});
		service.observe(open({}));
		await flush();
		service.stop();
		return output.at(-1);
	};
	assert.equal((await run([guard]))?.pending ?? false, false);
	assert.equal((await run([device]))?.pending, true, "control: the mark works");
	assert.equal(
		(await run([guard, device]))?.pending,
		true,
		"a Guard row beside an ordinary approval changes nothing for the ordinary one",
	);
});

test("Bridge uses one authorized account total and rejects a write-racing stale snapshot", async () => {
	const output = [];
	const requests = [];
	let release;
	let reads = 0;
	const service = new AppAttentionService({
		request: async (input) => {
			requests.push(input);
			if (input.op === "capabilities")
				return { status: 200, body: { result: { features: {} } } };
			if (input.op === "team_bridge.status")
				return {
					status: 200,
					body: { result: { state: "ready", account_id: "synthetic-account" } },
				};
			if (input.op === "team_bridge.unread") {
				assert.deepEqual(input, { op: "team_bridge.unread", scope: "account" });
				if (++reads === 1)
					return new Promise((resolve) => {
						release = () =>
							resolve({
								status: 200,
								body: {
									result: {
										total: 7,
										organizations: Array.from({ length: 12 }, () => ({
											unread: 99,
										})),
									},
								},
							});
					});
				return { status: 200, body: { result: { total: 0 } } };
			}
			return { status: 200, body: { result: { settings: [] } } };
		},
		publish: (snapshot) => output.push(snapshot),
		clear: () => {},
	});
	service.invalidate();
	await flush();
	assert.equal(typeof release, "function");
	service.observeResponse({ op: "team_bridge.read" }, { status: 200 });
	release();
	await flush();
	assert.equal(
		output.some((snapshot) => snapshot.unreadCount === 7),
		false,
	);
	assert.equal(output.at(-1).unreadCount, 0);
	assert.equal(
		requests.some((input) => input.op === "team_bridge.unread.events"),
		false,
		"proposed endpoint is not called without capability",
	);
	service.stop();
});

test("snapshot cursor reserved before reads preserves the queued newer level", () => {
	let last;
	const p = new AppAttentionProjection((snapshot) => {
		last = snapshot;
	});
	p.setAidaSession("synthetic");
	p.observe({ ...open({ notifications: inbox(4, 0, 0, 1) }), seq: 10 });
	p.observe(frame("notifications", 11, inbox(0, 0, 0, 2)));
	assert.equal(last.unreadCount, 0);
	p.observe(frame("notifications", 12, inbox(9, 0, 0, 1)));
	assert.equal(
		last.unreadCount,
		0,
		"stale authority revision still cannot restore a count",
	);
});

test("stop gates every projection publisher and cancelled-quit resume re-arms", async () => {
	const output = [];
	const service = new AppAttentionService({
		request: async () => ({ status: 503 }),
		publish: (snapshot) => output.push(snapshot),
		clear: () => {},
	});
	service.projection.setBrowserPending(true);
	service.stop();
	const stoppedAt = output.length;
	service.projection.setBrowserPending(false);
	service.observe(open({ notifications: inbox(99) }));
	service.reset();
	assert.equal(
		output.length,
		stoppedAt,
		"late feed/browser/HTTP work cannot repaint after stop",
	);
	service.resume();
	assert.ok(output.length > stoppedAt);
	service.stop();
	await flush();
});

test("unknown principal verification discards count without immediate retry storm", async () => {
	let statuses = 0;
	const requests = [];
	const output = [];
	const service = new AppAttentionService({
		request: async (input) => {
			requests.push(input);
			if (input.op === "team_bridge.status")
				return ++statuses === 1
					? {
							status: 200,
							body: { result: { state: "ready", account_id: "synthetic-a" } },
						}
					: { status: 503 };
			if (input.op === "team_bridge.unread")
				return { status: 200, body: { result: { total: 99 } } };
			return { status: 200, body: { result: { features: {}, settings: [] } } };
		},
		publish: (snapshot) => output.push(snapshot),
		clear: () => {},
	});
	service.invalidate();
	await flush();
	assert.equal(statuses, 2);
	assert.equal(
		output.some((snapshot) => snapshot.unreadCount === 99),
		false,
	);
	service.stop();
});

test("auth and signed-out account changes clear Bridge contribution synchronously", async () => {
	let last;
	const service = new AppAttentionService({
		request: async () => ({ status: 503 }),
		publish: (snapshot) => {
			last = snapshot;
		},
		clear: () => {},
	});
	for (const input of [
		{ op: "auth.logout" },
		{ op: "agent_messages.settings.put" },
		{ op: "accounts.remove", accountId: 1, confirmed: true },
	]) {
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
	const service = new AppAttentionService({
		request: async (input) => {
			requests.push(input);
			if (input.op === "team_bridge.status")
				return {
					status: 200,
					body: { result: { state: "ready", account_id: "synthetic-a" } },
				};
			if (input.op === "team_bridge.unread")
				return { status: 200, body: { result: { total: 3 } } };
			return { status: 200, body: { result: { features: {}, settings: [] } } };
		},
		publish: () => {},
		clear: () => {},
	});
	service.invalidate();
	await flush();
	t.mock.timers.tick(29_999);
	await flush();
	assert.equal(
		requests.filter((input) => input.op === "team_bridge.unread").length,
		1,
	);
	t.mock.timers.tick(1);
	await flush();
	assert.equal(
		requests.filter((input) => input.op === "team_bridge.unread").length,
		2,
	);
	assert.equal(
		requests.filter((input) => input.op === "capabilities").length,
		1,
		"fallback is Bridge-only",
	);
	assert.equal(
		requests.filter((input) => input.op === "settings.list").length,
		1,
		"fallback cannot refresh settings/inbox/approvals",
	);
	assert.ok(
		requests
			.filter((input) => input.op === "team_bridge.unread")
			.every(
				(input) => input.scope === "account" && input.tenant_id === undefined,
			),
	);
	service.stop();
});

test("capability without UI-schema admission never starts proposed long poll", async () => {
	const requests = [];
	const service = new AppAttentionService({
		request: async (input) => {
			requests.push(input);
			if (input.op === "capabilities")
				return {
					status: 200,
					body: { result: { features: { team_bridge_unread_events: 1 } } },
				};
			if (input.op === "team_bridge.status")
				return {
					status: 200,
					body: { result: { state: "ready", account_id: "synthetic-a" } },
				};
			if (input.op === "team_bridge.unread")
				return {
					status: 200,
					body: { result: { total: 0, cursor: "9223372036854775807" } },
				};
			return { status: 200, body: { result: { settings: [] } } };
		},
		publish: () => {},
		clear: () => {},
		supportsUnreadEvents: false,
	});
	service.invalidate();
	await flush();
	assert.equal(
		requests.some((input) => input.op === "team_bridge.unread.events"),
		false,
	);
	service.stop();
});

test("fast 204 long-poll response waits at least one second before renewal", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
	let polls = 0;
	const service = new AppAttentionService({
		request: async (input) => {
			if (input.op === "capabilities")
				return {
					status: 200,
					body: { result: { features: { team_bridge_unread_events: 1 } } },
				};
			if (input.op === "team_bridge.status")
				return {
					status: 200,
					body: { result: { state: "ready", account_id: "synthetic-a" } },
				};
			if (input.op === "team_bridge.unread")
				return { status: 200, body: { result: { total: 0, cursor: "2" } } };
			if (input.op === "team_bridge.unread.events") {
				polls++;
				return { status: 204 };
			}
			return { status: 200, body: { result: { settings: [] } } };
		},
		publish: () => {},
		clear: () => {},
		supportsUnreadEvents: true,
	});
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
	const service = new AppAttentionService({
		request: async (input) => {
			requests.push(input);
			if (input.op === "team_bridge.status")
				return {
					status: 200,
					body: { result: { state: "ready", account_id: "synthetic-a" } },
				};
			if (input.op === "team_bridge.unread")
				return { status: 200, body: { result: { total: 7 } } };
			return { status: 200, body: { result: { features: {}, settings: [] } } };
		},
		publish: (snapshot) => output.push(snapshot),
		clear: () => {},
	});
	service.invalidate();
	await flush();
	assert.equal(output.at(-1).unreadCount, 7);
	const calls = requests.length;
	const publications = output.length;
	const accountRead = (id) => ({
		status: 200,
		body: { result: { data: { msg: "ok", result: { account: { id } } } } },
	});
	service.observeResponse(
		{ op: "radient.request", control: { operation: "account" } },
		accountRead("synthetic-a"),
	);
	service.observeResponse(
		{ op: "radient.request", control: { operation: "account.agents" } },
		{ status: 200, body: { result: { data: { result: { agents: [] } } } } },
	);
	service.observeResponse(
		{ op: "agent_messages.status" },
		{
			status: 200,
			body: { result: { state: "ready", account_id: "synthetic-a" } },
		},
	);
	service.observeResponse({ op: "auth.status" }, { status: 200 });
	await flush();
	assert.equal(requests.length, calls);
	assert.equal(output.length, publications);
	assert.equal(output.at(-1).unreadCount, 7);
	service.observeResponse(
		{ op: "radient.request", control: { operation: "account" } },
		accountRead("synthetic-b"),
	);
	assert.equal(
		output.at(-1).unreadCount,
		0,
		"a returned different principal fences before refetch",
	);
	service.stop();
	await flush();
});

test("approval HTTP snapshot cannot overwrite a newer settle feed level", () => {
	let last;
	const p = new AppAttentionProjection((snapshot) => {
		last = snapshot;
	});
	p.setAidaSession("synthetic");
	p.observe(open({ approvals_pending: true }));
	const version = p.currentMeshVersion;
	p.observe(frame("approvals", 2, { pending: false }));
	p.setMeshSnapshot(true, version, p.currentGeneration);
	assert.equal(last.pending, false);
	p.observe(
		frame("approvals", 99, { pending: true }, "synthetic", "old-epoch"),
	);
	assert.equal(
		last.pending,
		false,
		"old epoch approvals are not current authority",
	);
	p.setMeshSnapshot(true, p.currentMeshVersion, p.currentGeneration);
	assert.equal(last.pending, true);
});

test("feed open replaces native level without an intermediate clear", () => {
	const output = [];
	let clears = 0;
	const service = new AppAttentionService({
		request: async () => ({ status: 503 }),
		publish: (snapshot) => output.push(snapshot),
		clear: () => {
			clears++;
		},
	});
	service.observe(open({ notifications: inbox(5) }));
	output.length = 0;
	service.observe(open({ notifications: inbox(2) }, "epoch-b"));
	assert.deepEqual(output, [{ unreadCount: 2, pending: false }]);
	assert.equal(clears, 0);
	service.stop();
});

test("retired completion is acknowledgeable when canonical status is interrupted", () => {
	let last;
	const p = new AppAttentionProjection((snapshot) => {
		last = snapshot;
	});
	p.setAidaSession("synthetic");
	const retired = { ...attention(true, "retire-for-build"), kind: "retired" };
	p.observe(open({}));
	p.observe(frame("attention", 2, retired));
	p.observe(frame("session_status", 3, { code: "interrupted", revision: 1 }));
	assert.equal(
		last.unreadCount,
		1,
		"retired is a completion receipt, not session removal",
	);
	p.observe(
		open(
			{
				attention: { "session/synthetic": retired },
				attention_status: {
					"session/synthetic": { code: "interrupted", revision: 1 },
				},
			},
			"epoch-b",
		),
	);
	assert.equal(
		last.unreadCount,
		1,
		"reconnect agrees with the live shared predicate",
	);
	p.observe(
		frame(
			"attention",
			2,
			{ ...retired, unseen: false, revision: [1, 1] },
			"synthetic",
			"epoch-b",
		),
	);
	assert.equal(last.unreadCount, 0);
});

test("transient Bridge status preserves the last authorized same-account total", async () => {
	let state = "ready";
	let last;
	const service = new AppAttentionService({
		request: async (input) => {
			if (input.op === "team_bridge.status")
				return {
					status: 200,
					body: {
						result: {
							state,
							account_id: state === "signed_out" ? null : "synthetic-a",
						},
					},
				};
			if (input.op === "team_bridge.unread")
				return { status: 200, body: { result: { total: 4 } } };
			return { status: 200, body: { result: { features: {}, settings: [] } } };
		},
		publish: (snapshot) => {
			last = snapshot;
		},
		clear: () => {},
	});
	try {
		service.invalidate();
		await flush();
		assert.equal(last.unreadCount, 4);
		for (state of ["unavailable", "update_required"]) {
			service.invalidate();
			await flush();
			assert.equal(
				last.unreadCount,
				4,
				`${state} is unknown, not verified sign-out`,
			);
		}
		state = "signed_out";
		service.invalidate();
		await flush();
		assert.equal(last.unreadCount, 0, "verified sign-out still clears");
	} finally {
		service.stop();
	}
});

test("lifecycle and consent successful writes invalidate the account aggregate", async () => {
	const requests = [];
	const service = new AppAttentionService({
		request: async (input) => {
			requests.push(input);
			return { status: 503 };
		},
		publish: () => {},
		clear: () => {},
	});
	try {
		for (const op of [
			"team_bridge.conversations.lifecycle",
			"team_bridge.conversations.consent",
		]) {
			requests.length = 0;
			service.observeResponse({ op }, { status: 403 });
			await flush();
			assert.equal(requests.length, 0, "a refused write changes no authority");
			service.observeResponse({ op }, { status: 200 });
			await flush();
			assert.ok(
				requests.some((input) => input.op === "team_bridge.status"),
				op,
			);
			assert.equal(
				requests.some(
					(input) =>
						input.op === "settings.list" || input.op === "capabilities",
				),
				false,
			);
		}
	} finally {
		service.stop();
	}
});

/*
 * A QUEUED ASK IS COUNTED ONCE, NEVER AS A BLOCKING GATE.
 *
 * The harness files a non-blocking queued ask under status code `answer`, the same
 * code a question the agent is parked on carries, so the feed alone made an idle
 * conversation with one queued ask read as "needs you" (dock/tray pending). These
 * cases pin the window's claim as the discriminator: an `answer` beside a queued id
 * is already counted by the window's badge, an `answer` without one is a gate, and
 * an `approval` is a gate whatever else is queued.
 */
const answer = (code = "answer", revision = 1) => ({ code, revision });

/** An open frame only populates a conversation's level when it carries a
 * receipt for it (`attention`), so the status map alone would name nobody. */
const levels = (statuses) => ({
	attention: Object.fromEntries(
		Object.keys(statuses).map((identity) => [identity, attention()]),
	),
	attention_status: statuses,
});

const settledProjection = () => {
	const seen = [];
	const projection = new AppAttentionProjection((snapshot) =>
		seen.push(snapshot),
	);
	return { projection, seen, last: () => seen.at(-1) };
};

test("a queued ask is counted once and never as a blocking gate", () => {
	const { projection, last } = settledProjection();
	projection.setQueuedAskSessions(["s-queued"]);
	projection.observe(open(levels({ "session/s-queued": answer() })));
	assert.equal(
		last().pending,
		false,
		"the window already counts that queued ask in its own badge",
	);
	projection.setQueuedAskSessions([]);
	assert.equal(
		last().pending,
		true,
		"with no queued ask behind it, the same status is a question that needs you",
	);
});

test("an answer status with no queued ask for that conversation is a gate", () => {
	const { projection, last } = settledProjection();
	projection.observe(open(levels({ "session/s-blocking": answer() })));
	assert.equal(last().pending, true);
	projection.setQueuedAskSessions(["s-other"]);
	assert.equal(
		last().pending,
		true,
		"another conversation's ask masks nothing",
	);
});

test("an approval stays a gate beside a queued ask", () => {
	const { projection, last } = settledProjection();
	projection.setQueuedAskSessions(["s-approval"]);
	projection.observe(
		open(levels({ "session/s-approval": answer("approval") })),
	);
	assert.equal(last().pending, true);
});

test("the gate total is the same whether the claim or the status arrives first", () => {
	const claimFirst = settledProjection();
	claimFirst.projection.setQueuedAskSessions(["s-a"]);
	claimFirst.projection.observe(open(levels({ "session/s-a": answer() })));

	const statusFirst = settledProjection();
	statusFirst.projection.observe(open(levels({ "session/s-a": answer() })));
	assert.equal(statusFirst.last().pending, true);
	statusFirst.projection.setQueuedAskSessions(["s-a"]);

	assert.equal(claimFirst.last().pending, false);
	assert.equal(
		statusFirst.last().pending,
		claimFirst.last().pending,
		"a set that arrives after its status must reach the same total",
	);
});

test("the gate total stays correct across status deltas and claim changes", () => {
	const { projection, last } = settledProjection();
	projection.setQueuedAskSessions(["s-a", "s-c"]);
	projection.observe(
		open(
			levels({
				"session/s-a": answer(),
				"session/s-b": answer(),
				"session/s-c": answer("approval"),
			}),
		),
	);
	// s-b (answer, no queued ask) and s-c (approval, queued ask) are gates.
	assert.equal(last().pending, true);
	projection.setQueuedAskSessions(["s-a", "s-b", "s-c"]);
	assert.equal(
		last().pending,
		true,
		"s-b's claim removes its gate; s-c's approval keeps its own",
	);
	projection.observe(frame("session_status", 2, answer("commit", 2), "s-c"));
	assert.equal(
		last().pending,
		false,
		"no gate survives now that both are masked",
	);
	projection.observe(frame("session_status", 3, answer(), "s-b"));
	assert.equal(
		last().pending,
		false,
		"a status delta must not re-add a masked gate",
	);
	projection.setQueuedAskSessions(["s-a"]);
	assert.equal(
		last().pending,
		true,
		"dropping s-b and s-c from the claim restores both their gates",
	);
	projection.observe(frame("session_status", 4, answer("complete", 3), "s-b"));
	assert.equal(
		last().pending,
		false,
		"s-b left answer, so only s-c's gate is left",
	);
});

test("a stale generation cannot set the queued-ask claim", () => {
	const { projection, last } = settledProjection();
	const stale = projection.currentGeneration;
	projection.reset();
	projection.setQueuedAskSessions(["s-a"], stale);
	projection.observe(open(levels({ "session/s-a": answer() })));
	assert.equal(
		last().pending,
		true,
		"the pre-reset generation's claim is ignored",
	);
	projection.setQueuedAskSessions(["s-a"], projection.currentGeneration);
	assert.equal(last().pending, false);
});

test("a full reset drops the claim; an epoch replacement keeps it", () => {
	const { projection, last } = settledProjection();
	projection.setQueuedAskSessions(["s-a"]);
	projection.observe(open(levels({ "session/s-a": answer() })));
	assert.equal(last().pending, false);
	// The open frame's own replacement, exactly as `observe("open")` performs it:
	// conversation ids survive a reconnect, so their queued asks are still counted
	// once - dropping the claim here would flash every queued-ask row as a gate.
	projection.reset(false);
	projection.observe(open(levels({ "session/s-a": answer() }), "epoch-b"));
	assert.equal(
		last().pending,
		false,
		"the claim survives an epoch replacement",
	);
	// A real reset (sign-out, backend change) does drop it, and main re-asks the
	// window for a fresh claim afterwards.
	projection.reset();
	projection.observe(open(levels({ "session/s-a": answer() }), "epoch-c"));
	assert.equal(last().pending, true);
});

test("the renderer's report is validated before main believes it", () => {
	assert.deepEqual(
		parseQueuedAskSessionIds([]),
		[],
		"an empty claim is a claim",
	);
	assert.deepEqual(
		[...parseQueuedAskSessionIds(["b", "a", "b"])].sort(),
		["a", "b"],
		"a duplicate is redundant, not malformed",
	);
	for (const refusal of [
		null,
		undefined,
		"s-a",
		{ ids: ["s-a"] },
		[""],
		["s-a", 7],
		["s-a", null],
		["x".repeat(257)],
		Array.from({ length: MAX_QUEUED_ASK_SESSIONS + 1 }, (_, i) => `s-${i}`),
	])
		assert.equal(
			parseQueuedAskSessionIds(refusal),
			null,
			`refuses ${JSON.stringify(refusal)?.slice(0, 40)}`,
		);
	assert.equal(
		parseQueuedAskSessionIds(
			Array.from({ length: MAX_QUEUED_ASK_SESSIONS }, (_, i) => `s-${i}`),
		).length,
		MAX_QUEUED_ASK_SESSIONS,
		"the bound itself is accepted",
	);
});

test("the window derives its id set from answerable counts only", () => {
	assert.deepEqual(queuedAskSessionIds(null), []);
	assert.deepEqual(queuedAskSessionIds(undefined), []);
	assert.deepEqual(queuedAskSessionIds(new Map()), []);
	assert.deepEqual(
		queuedAskSessionIds(
			new Map([
				["b", 1],
				["a", 3],
			]),
		),
		["a", "b"],
		"sorted, so a row reorder is not a change worth an IPC call",
	);
	assert.deepEqual(
		queuedAskSessionIds(
			new Map([
				["nan", Number.NaN],
				["zero", 0],
				["negative", -2],
				["fraction", 1.5],
				["", 2],
			]),
		),
		[],
		"a count that is not a positive safe integer says nothing about a queued ask",
	);
});

test("main refuses a report that is not from the main window's main frame", () => {
	const origin = (overrides = {}) => ({
		windowGone: false,
		senderIsMainWindow: true,
		senderIsMainFrame: true,
		...overrides,
	});
	assert.deepEqual(acceptQueuedAskReport(origin(), ["s-a"]), {
		apply: true,
		ids: ["s-a"],
	});
	assert.deepEqual(
		acceptQueuedAskReport(origin(), []),
		{ apply: true, ids: [] },
		"an empty claim must land - it is how a stale id un-masks a gate",
	);
	for (const refusal of [
		origin({ windowGone: true }),
		origin({ senderIsMainWindow: false }),
		origin({ senderIsMainFrame: false }),
	])
		assert.deepEqual(
			acceptQueuedAskReport(refusal, ["s-a"]),
			{ apply: false },
			`refuses ${JSON.stringify(refusal)}`,
		);
	for (const refusal of [
		null,
		undefined,
		"s-a",
		{ ids: [] },
		[7],
		[""],
		["x".repeat(257)],
		Array.from({ length: MAX_QUEUED_ASK_SESSIONS + 1 }, (_, i) => `s-${i}`),
	])
		assert.deepEqual(
			acceptQueuedAskReport(origin(), refusal),
			{ apply: false },
			`refuses ${JSON.stringify(refusal)?.slice(0, 40)}`,
		);
});

test("an unread window says nothing, and an unchanged claim is not re-sent", () => {
	assert.equal(
		nextQueuedAskReport(null, "s-a"),
		null,
		"a reload must not wipe a claim main holds (round-1 m3)",
	);
	assert.deepEqual(
		nextQueuedAskReport(new Map(), null),
		{ ids: [], key: "" },
		"an authoritative empty answer IS a claim",
	);
	assert.equal(
		nextQueuedAskReport(new Map(), ""),
		null,
		"the same set is not worth a second IPC call",
	);
	assert.deepEqual(
		nextQueuedAskReport(
			new Map([
				["b", 1],
				["a", 2],
			]),
			"",
		),
		{
			ids: ["a", "b"],
			key: "a\u0000b",
		},
	);
	assert.equal(
		nextQueuedAskReport(
			new Map([
				["b", 1],
				["a", 2],
			]),
			"a\u0000b",
		),
		null,
		"a row reorder is not a change",
	);
	assert.deepEqual(
		nextQueuedAskReport(new Map([["a", 1]]), null),
		{ ids: ["a"], key: "a" },
		"main's resync makes the window re-state the set it already knew",
	);
});

test("a status frame re-reads the index only when the claim could have moved", () => {
	const claimed = new Set(["s-a"]);
	assert.equal(
		statusFrameMovesQueuedAskClaim("s-new", "answer", claimed),
		true,
		"a queued ask is filed under `answer`, so a new one lands on that code",
	);
	assert.equal(
		statusFrameMovesQueuedAskClaim("s-a", "active", claimed),
		true,
		"the claimed ask may have been answered elsewhere",
	);
	assert.equal(
		statusFrameMovesQueuedAskClaim("s-a", "answer", claimed),
		true,
		"still parked: whether it still holds an ask is what the re-read settles",
	);
	assert.equal(
		statusFrameMovesQueuedAskClaim("s-b", "active", claimed),
		false,
		"not claimed and not on `answer`: nothing about the claim moved",
	);
	assert.equal(statusFrameMovesQueuedAskClaim("s-b", "", claimed), false);
});

test("the status edge is wired from the transport to the claim's owner", () => {
	/*
	 * A SHAPE PIN, not a behaviour test: the decisions above are pure, but the two
	 * lines that join them to the feed cannot be reached without a renderer. What
	 * is pinned is that the `session_status` branch still publishes the edge and
	 * the claim's owner still invalidates the fleet-asks key on it - the wiring a
	 * refactor could drop while every pure assertion above stayed green.
	 */
	const transport = readFileSync(
		new URL(
			"../src/renderer/src/shared/hooks/use-desktop-feed.ts",
			import.meta.url,
		),
		"utf8",
	);
	assert.match(transport, /publishSessionStatusTransition\(frame\)/);
	const hook = readFileSync(
		new URL(
			"../src/renderer/src/features/chat/use-queued-ask-attention.ts",
			import.meta.url,
		),
		"utf8",
	);
	assert.match(hook, /sessionStatusTransitions\.subscribe/);
	assert.match(
		hook,
		/invalidateQueries\(\{ queryKey: FLEET_ASKS_QUERY_KEY \}\)/,
		"the frame re-reads the index instead of a background poll",
	);
	/* Round-1 m1: the handler's own frame check, where the event lives. */
	const main = readFileSync(
		new URL("../src/main/index.ts", import.meta.url),
		"utf8",
	);
	assert.match(
		main,
		/senderIsMainFrame:/,
		"the handler hands the frame check in",
	);
	assert.match(
		main,
		/senderFrame === window\.webContents\.mainFrame/,
		"a report is refused unless it is the main window's MAIN FRAME",
	);
});

test("the notifications edge is wired from the transport to the claim's owner", () => {
	/*
	 * ROUND-2 M-A'S SHAPE PIN. A status frame rings only when the harness's
	 * `status_dedupe_key` moves, so an ask filed into a conversation already on
	 * `answer`/`approval` never rings it; the `notifications` frame is the
	 * harness's own doorbell for the asks index, and the claim must follow it.
	 * Pinned at the two joints a refactor could drop while every pure assertion
	 * above stayed green: the transport still publishes the frame to the record,
	 * and the claim's owner still re-reads the SAME key on it - with nothing
	 * between the two, because the frame names counts, not asks.
	 */
	const transport = readFileSync(
		new URL(
			"../src/renderer/src/shared/hooks/use-desktop-feed.ts",
			import.meta.url,
		),
		"utf8",
	);
	assert.match(transport, /publishNotificationsFrame\(frame\)/);
	const hook = readFileSync(
		new URL(
			"../src/renderer/src/features/chat/use-queued-ask-attention.ts",
			import.meta.url,
		),
		"utf8",
	);
	assert.match(
		hook,
		/notificationsFrameRecord\.subscribe\(\s*invalidateClaim\s*\)/,
		"every notifications frame re-reads the index, unfiltered: it names no ask",
	);
	assert.match(
		hook,
		/const invalidateClaim = \(\) =>\s*void client\.invalidateQueries\(\{ queryKey: FLEET_ASKS_QUERY_KEY \}\)/,
		"and that re-read is the fleet-asks key the claim derives from",
	);
	assert.match(
		hook,
		/stopNotifications\(\);/,
		"the listener is torn down with the effect that opened it",
	);
});
