/**
 * Background warming of Team Bridge timelines (bridge-instant-load S3).
 *
 *     node --test scripts/team-bridge-prefetch.test.mjs
 *
 * The operator's bar: "clicking into any conversation shouldn't really have a
 * loading time". A cold conversation waits one history read behind skeletons;
 * `team-bridge-prefetch.ts` warms the likely next clicks first. Asserted here:
 *
 * 1. A prefetch writes EXACTLY the key the timeline reads
 *    (`teamBridgeMessagesQueryOptions`) — no second cache.
 * 2. A timeline observer mounted after a prefetch answers from cache on its
 *    FIRST result: data present, not pending, and no further transport call.
 * 3. Concurrency never exceeds the bound, and every queued row is read once.
 * 4. A 429 stops the queue and holds further prefetches.
 * 5. Warm entries are never re-read (cold only), and candidates exclude
 *    previews/archived and put unread first.
 * 6. The read still passes the owner fence: a different signed-in account
 *    warms nothing.
 * 7. (PR #1869 round 1) A plan fits the cache's free room and never re-reads
 *    what the retention sweep dropped unseen (R1); intent goes to the front,
 *    hover is budgeted, press always wins (R2); the page can drop its queue
 *    (R3); a 429 holds only the account it hit (R4).
 *
 * WHAT IS MOCKED: only the preload transport (`window.api.desktop.request`).
 * The query client, keys, owner fence, API parser and window merge are the
 * shipped modules, bundled the way the sibling team-bridge suites run them.
 */
import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/team-bridge/team-bridge-prefetch";
			export { teamBridgeMessagesQueryOptions, sweepTeamBridgeChannelCache } from "./src/renderer/src/features/team-bridge/use-team-bridge";
			export { rememberChannelView, wasEvictedUnviewed, TEAM_BRIDGE_MAX_CONVERSATIONS } from "./src/renderer/src/features/team-bridge/team-bridge-channel-cache";
			export { teamBridgeKeys } from "./src/renderer/src/features/team-bridge/team-bridge-keys";
			export { radientUserKeys } from "./src/renderer/src/shared/hooks/radient-account-authority";
			export { QueryClient, QueryObserver } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["react", "react-dom"],
	loader: { ".css": "empty", ".svg": "empty", ".png": "empty" },
	tsconfig: "tsconfig.app.json",
	write: false,
	logLevel: "silent",
});
const compiledPath = `${process.cwd()}/scripts/team-bridge-prefetch-runtime.cjs`;
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;

const ACCOUNT = "acct_9f4c1e2d3a4b";
const TENANT = "org_a1b2c3";

const status = (accountId = ACCOUNT) => ({
	capability: 3,
	state: "ready",
	account_id: accountId,
	tenant_id: TENANT,
	surface_state: "C",
	visibility: {
		settings: true,
		inbox: true,
		account_door: true,
		onboarding: true,
	},
	update_required: false,
	local: { enabled: true, onboarding: "done", session: "sess_1" },
	status: null,
	consent: null,
	error: null,
	read_only: false,
});

const mount = (signedIn = ACCOUNT) => {
	const client = new m.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(m.radientUserKeys.user(), {
		account: { id: signedIn, email: "qa@example.test" },
	});
	client.setQueryData(m.teamBridgeKeys.statusFor(ACCOUNT), status());
	return client;
};

const page = (conversationId) => ({
	messages: [
		{
			id: `msg_${conversationId}`,
			conversation_id: conversationId,
			seq: 7,
			sender: {
				account_id: "acct_other",
				kind: "human",
				display_label: "Other",
			},
			body: `hello in ${conversationId}`,
			origin: "human",
			created_at: "2026-11-11T09:00:00.000Z",
		},
	],
	has_more: false,
});

/**
 * A controllable transport: each call is held until the test releases it, so
 * in-flight counts are observable. `answer(id)` decides the response.
 */
function transport(
	answer = (id) => ({ status: 200, body: { result: page(id) } }),
) {
	const calls = [];
	const pending = [];
	let inFlight = 0;
	let peak = 0;
	globalThis.window = {
		api: {
			desktop: {
				request: (request) => {
					calls.push(request);
					inFlight += 1;
					peak = Math.max(peak, inFlight);
					return new Promise((resolve) => {
						pending.push(() => {
							inFlight -= 1;
							resolve(answer(request.conversation_id));
						});
					});
				},
			},
		},
	};
	const flush = () => new Promise((resolve) => setImmediate(resolve));
	return {
		calls,
		get peak() {
			return peak;
		},
		async releaseAll() {
			for (let guard = 0; guard < 100; guard += 1) {
				await flush();
				if (pending.length === 0) {
					await flush();
					if (pending.length === 0) return;
				}
				for (const release of pending.splice(0)) release();
			}
		},
	};
}

const row = (id, overrides = {}) => ({
	id,
	tenant_id: TENANT,
	kind: "channel",
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: ACCOUNT,
	last_message_at: "2026-11-11T09:00:00.000Z",
	latest_seq: 7,
	members: [],
	last_read_seq: 7,
	unread_count: 0,
	muted: false,
	...overrides,
});

test("a prefetch fills exactly the key the timeline reads", async () => {
	const client = mount();
	const wire = transport();
	m.prefetchTeamBridgeConversations(client, ACCOUNT, [row("bcv_one")]);
	await wire.releaseAll();
	const key = m.teamBridgeMessagesQueryOptions(
		client,
		"bcv_one",
		TENANT,
		ACCOUNT,
	).queryKey;
	assert.deepEqual(key, m.teamBridgeKeys.messages("bcv_one", TENANT, ACCOUNT));
	const entry = client.getQueryData(key);
	assert.equal(entry.messages[0].body, "hello in bcv_one");
	assert.equal(wire.calls.length, 1);
	assert.equal(wire.calls[0].op, "team_bridge.messages.list");
	assert.equal(wire.calls[0].tenant_id, TENANT);
	/* Exactly one messages entry: nothing was written under a second key. */
	assert.equal(
		client
			.getQueryCache()
			.findAll({ queryKey: m.teamBridgeKeys.messagesPrefix }).length,
		1,
	);
	client.clear();
});

test("opening a prefetched conversation answers from cache with no loading state", async () => {
	const client = mount();
	const wire = transport();
	m.prefetchTeamBridgeConversations(client, ACCOUNT, [row("bcv_warm")]);
	await wire.releaseAll();
	const before = wire.calls.length;
	/* The timeline's own observer, with its own staleTime (as useTeamBridgeMessages). */
	const observer = new m.QueryObserver(client, {
		...m.teamBridgeMessagesQueryOptions(client, "bcv_warm", TENANT, ACCOUNT),
		staleTime: 30_000,
	});
	const first = observer.getCurrentResult();
	assert.equal(first.isPending, false, "no skeleton on the first frame");
	assert.equal(first.status, "success");
	assert.equal(first.data.messages[0].body, "hello in bcv_warm");
	const unsubscribe = observer.subscribe(() => {});
	await wire.releaseAll();
	assert.equal(wire.calls.length, before, "the click spent no read");
	unsubscribe();
	client.clear();
});

test("a cold conversation is still pending: the control for the case above", async () => {
	const client = mount();
	transport();
	const observer = new m.QueryObserver(client, {
		...m.teamBridgeMessagesQueryOptions(client, "bcv_cold", TENANT, ACCOUNT),
		staleTime: 30_000,
	});
	assert.equal(observer.getCurrentResult().isPending, true);
	client.clear();
});

test("concurrency stays within the bound and every row is read once", async () => {
	const client = mount();
	const wire = transport();
	const rows = Array.from({ length: 10 }, (_, index) => row(`bcv_${index}`));
	m.prefetchTeamBridgeConversations(client, ACCOUNT, rows);
	/* Queued twice (a page answer and the watcher's): still one read each. */
	m.prefetchTeamBridgeConversations(client, ACCOUNT, rows);
	assert.equal(wire.calls.length, m.TEAM_BRIDGE_PREFETCH_CONCURRENCY);
	await wire.releaseAll();
	assert.equal(wire.peak, m.TEAM_BRIDGE_PREFETCH_CONCURRENCY);
	assert.equal(wire.calls.length, 10);
	assert.equal(
		new Set(wire.calls.map((call) => call.conversation_id)).size,
		10,
	);
	client.clear();
});

test("warm entries are never re-read", async () => {
	const client = mount();
	const wire = transport();
	m.prefetchTeamBridgeConversations(client, ACCOUNT, [row("bcv_a")]);
	await wire.releaseAll();
	m.prefetchTeamBridgeConversations(client, ACCOUNT, [
		row("bcv_a"),
		row("bcv_b"),
	]);
	await wire.releaseAll();
	assert.deepEqual(
		wire.calls.map((call) => call.conversation_id),
		["bcv_a", "bcv_b"],
	);
	client.clear();
});

test("a 429 halts the queue and holds later prefetches", async () => {
	const client = mount();
	const wire = transport(() => ({
		status: 429,
		body: {
			detail: { code: "rate_limited", message: "slow", retry_after_seconds: 2 },
		},
	}));
	const rows = Array.from({ length: 8 }, (_, index) => row(`bcv_${index}`));
	m.prefetchTeamBridgeConversations(client, ACCOUNT, rows);
	await wire.releaseAll();
	/* The first wave was already in flight; nothing after it was dispatched. */
	assert.equal(wire.calls.length, m.TEAM_BRIDGE_PREFETCH_CONCURRENCY);
	m.prefetchTeamBridgeConversations(client, ACCOUNT, [row("bcv_later")]);
	m.prefetchTeamBridgeConversationNow(client, ACCOUNT, row("bcv_hover"));
	await wire.releaseAll();
	assert.equal(wire.calls.length, m.TEAM_BRIDGE_PREFETCH_CONCURRENCY);
	client.clear();
});

test("a different signed-in account warms nothing (owner fence still applies)", async () => {
	const client = mount("acct_someone_else");
	const wire = transport();
	m.prefetchTeamBridgeConversations(client, ACCOUNT, [row("bcv_private")]);
	await wire.releaseAll();
	assert.equal(wire.calls.length, 0, "refused before any transport call");
	const key = m.teamBridgeKeys.messages("bcv_private", TENANT, ACCOUNT);
	assert.equal(client.getQueryData(key), undefined);
	client.clear();
});

test("hover moves a queued row to the front", async () => {
	const client = mount();
	const wire = transport();
	const rows = Array.from({ length: 6 }, (_, index) => row(`bcv_${index}`));
	m.prefetchTeamBridgeConversations(client, ACCOUNT, rows);
	m.prefetchTeamBridgeConversationNow(client, ACCOUNT, rows[5]);
	await wire.releaseAll();
	const order = wire.calls.map((call) => call.conversation_id);
	assert.equal(order.indexOf("bcv_5"), m.TEAM_BRIDGE_PREFETCH_CONCURRENCY);
	assert.equal(order.length, 6);
	client.clear();
});

test("candidates: unread first, then recent; previews and archived skipped; bounded", () => {
	const rows = [
		row("bcv_old", { last_message_at: "2026-11-01T00:00:00.000Z" }),
		row("bcv_unread_old", {
			last_message_at: "2026-10-01T00:00:00.000Z",
			unread_count: 2,
		}),
		row("bcv_new", { last_message_at: "2026-11-10T00:00:00.000Z" }),
		row("bcv_archived", {
			status: "archived",
			last_message_at: "2026-11-11T00:00:00.000Z",
		}),
		row("bcv_preview", {
			discoverable: true,
			member: false,
			last_message_at: "2026-11-11T00:00:00.000Z",
		}),
	];
	assert.deepEqual(
		m.teamBridgePrefetchCandidates(rows).map((candidate) => candidate.id),
		["bcv_unread_old", "bcv_new", "bcv_old"],
	);
	assert.deepEqual(
		m
			.teamBridgePrefetchCandidates(rows, { recent: 1 })
			.map((candidate) => candidate.id),
		["bcv_unread_old", "bcv_new"],
	);
	const many = Array.from({ length: 40 }, (_, index) =>
		row(`bcv_${index}`, { unread_count: 1 }),
	);
	assert.equal(
		m.teamBridgePrefetchCandidates(many).length,
		m.TEAM_BRIDGE_PREFETCH_MAX,
	);
	assert.ok(m.TEAM_BRIDGE_PREFETCH_MAX < 20, "under the retention bound");
});

/* ---- PR #1869 round-1 remediation (R1-R4) ---- */

const messageKey = (client, id) =>
	JSON.stringify(
		m.teamBridgeMessagesQueryOptions(client, id, TENANT, ACCOUNT).queryKey,
	);
const cachedCount = (client) =>
	client
		.getQueryCache()
		.findAll({ queryKey: m.teamBridgeKeys.messagesPrefix })
		.filter((query) => query.state.data !== undefined).length;

test("R1: with many opened conversations, repeated list changes re-read nothing", async () => {
	const client = mount();
	const wire = transport();
	/* The reader has opened 12 conversations (warm + in the view order). */
	const viewed = Array.from({ length: 12 }, (_, i) => row(`bcv_r1_seen_${i}`));
	m.prefetchTeamBridgeConversations(client, ACCOUNT, viewed);
	await wire.releaseAll();
	for (const r of viewed) m.rememberChannelView(messageKey(client, r.id));
	const active = messageKey(client, viewed[0].id);
	const base = wire.calls.length;
	/* The same 12 candidates re-planned on every list answer, one sweep each
	   (the open timeline's data change), as in the reviewer's repro. */
	const candidates = Array.from({ length: 12 }, (_, i) =>
		row(`bcv_r1_guess_${i}`),
	);
	const perCycle = [];
	for (let cycle = 0; cycle < 4; cycle += 1) {
		const before = wire.calls.length;
		m.prefetchTeamBridgeConversations(client, ACCOUNT, candidates);
		await wire.releaseAll();
		m.sweepTeamBridgeChannelCache(client, active);
		perCycle.push(wire.calls.length - before);
		assert.ok(cachedCount(client) <= m.TEAM_BRIDGE_MAX_CONVERSATIONS);
	}
	/* Only the free room (20 - 12 = 8) is ever read, once; nothing is evicted
	   and so nothing is re-read. Before the fix: [12, 4, 4, 4]. */
	assert.deepEqual(perCycle, [8, 0, 0, 0]);
	assert.equal(wire.calls.length - base, 8);
	client.clear();
});

test("R1: an entry the sweep dropped unseen is not planned again until opened", async () => {
	const client = mount();
	const wire = transport();
	m.prefetchTeamBridgeConversations(client, ACCOUNT, [row("bcv_r1_drop")]);
	await wire.releaseAll();
	const key = messageKey(client, "bcv_r1_drop");
	/* 20 conversations opened after it push it out (unviewed ranks oldest). */
	const opened = Array.from({ length: 20 }, (_, i) => row(`bcv_r1_open_${i}`));
	for (const r of opened) {
		/* The timeline's own read (held by the transport until released). */
		const read = client.fetchQuery(
			m.teamBridgeMessagesQueryOptions(client, r.id, TENANT, ACCOUNT),
		);
		await wire.releaseAll();
		await read;
		m.rememberChannelView(messageKey(client, r.id));
	}
	m.sweepTeamBridgeChannelCache(client, messageKey(client, opened[0].id));
	assert.equal(client.getQueryData(JSON.parse(key)), undefined, "evicted");
	assert.equal(m.wasEvictedUnviewed(key), true);
	/* Free room again (the reader's entries go), yet the plan skips it. */
	client.removeQueries({ queryKey: m.teamBridgeKeys.messagesPrefix });
	const before = wire.calls.length;
	m.prefetchTeamBridgeConversations(client, ACCOUNT, [row("bcv_r1_drop")]);
	await wire.releaseAll();
	assert.equal(wire.calls.length, before, "no re-read of a dropped guess");
	/* Opened once, it is an ordinary candidate again. */
	m.rememberChannelView(key);
	m.prefetchTeamBridgeConversations(client, ACCOUNT, [row("bcv_r1_drop")]);
	await wire.releaseAll();
	assert.equal(wire.calls.length, before + 1);
	client.clear();
});

test("R2: a hovered row outside the plan is read next, ahead of the plan", async () => {
	const client = mount();
	const wire = transport();
	const rows = Array.from({ length: 9 }, (_, i) => row(`bcv_r2_${i}`));
	m.prefetchTeamBridgeConversations(client, ACCOUNT, rows);
	m.prefetchTeamBridgeConversationNow(client, ACCOUNT, row("bcv_r2_hover"));
	await wire.releaseAll();
	const order = wire.calls.map((call) => call.conversation_id);
	/* The first CONCURRENCY plan reads were already out; the hover is next.
	   Before the fix it was index 9 of 10 (pushed behind the plan). */
	assert.equal(
		order.indexOf("bcv_r2_hover"),
		m.TEAM_BRIDGE_PREFETCH_CONCURRENCY,
	);
	assert.equal(order.length, 10);
	client.clear();
});

test("R2: a pointer sweep across 30 rows spends at most the hover budget", async () => {
	const client = mount();
	const wire = transport();
	const rail = Array.from({ length: 30 }, (_, i) => row(`bcv_sweep_${i}`));
	for (const r of rail) m.prefetchTeamBridgeConversationNow(client, ACCOUNT, r);
	await wire.releaseAll();
	assert.ok(
		wire.calls.length <= m.TEAM_BRIDGE_PREFETCH_INTENT_BUDGET,
		`sweep issued ${wire.calls.length} reads`,
	);
	/* The newest hover (where the pointer stopped) is among them. */
	assert.ok(wire.calls.some((call) => call.conversation_id === "bcv_sweep_29"));
	/* Budget spent, a press still reads, and before any queued guess. */
	m.prefetchTeamBridgeConversations(
		client,
		ACCOUNT,
		Array.from({ length: 5 }, (_, i) => row(`bcv_sweep_plan_${i}`)),
	);
	const before = wire.calls.length;
	m.prefetchTeamBridgeConversationNow(
		client,
		ACCOUNT,
		row("bcv_sweep_pressed"),
		"press",
	);
	await wire.releaseAll();
	const after = wire.calls.slice(before).map((call) => call.conversation_id);
	assert.equal(after[0], "bcv_sweep_pressed", "press read first");
	/* Hover budget still spent: a further hover in the window reads nothing. */
	const spent = wire.calls.length;
	m.prefetchTeamBridgeConversationNow(client, ACCOUNT, row("bcv_sweep_late"));
	await wire.releaseAll();
	assert.equal(wire.calls.length, spent);
	client.clear();
});

test("R2: the hover budget refills after its window", async () => {
	const client = mount();
	const wire = transport();
	const realNow = Date.now;
	const t0 = realNow();
	Date.now = () => t0;
	try {
		for (let i = 0; i < 10; i += 1) {
			m.prefetchTeamBridgeConversationNow(
				client,
				ACCOUNT,
				row(`bcv_refill_${i}`),
			);
			await wire.releaseAll();
		}
		assert.equal(wire.calls.length, m.TEAM_BRIDGE_PREFETCH_INTENT_BUDGET);
		Date.now = () => t0 + m.TEAM_BRIDGE_PREFETCH_INTENT_WINDOW_MS + 1;
		m.prefetchTeamBridgeConversationNow(
			client,
			ACCOUNT,
			row("bcv_refill_next"),
		);
		await wire.releaseAll();
		assert.equal(wire.calls.length, m.TEAM_BRIDGE_PREFETCH_INTENT_BUDGET + 1);
	} finally {
		Date.now = realNow;
	}
	client.clear();
});

test("R3: cancelling drops queued guesses; in-flight reads finish", async () => {
	const client = mount();
	const wire = transport();
	const rows = Array.from({ length: 9 }, (_, i) => row(`bcv_r3_${i}`));
	m.prefetchTeamBridgeConversations(client, ACCOUNT, rows);
	m.cancelTeamBridgePrefetch(client);
	await wire.releaseAll();
	assert.equal(wire.calls.length, m.TEAM_BRIDGE_PREFETCH_CONCURRENCY);
	/* The dropped rows are not stuck as "queued": a later plan reads them. */
	m.prefetchTeamBridgeConversations(client, ACCOUNT, rows);
	await wire.releaseAll();
	assert.equal(wire.calls.length, 9);
	client.clear();
});

test("R4: a 429 on one account does not hold another account's prefetch", async () => {
	const OTHER = "acct_7b7b7b7b7b7b";
	const client = mount();
	let limited = true;
	const wire = transport((id) =>
		limited
			? {
					status: 429,
					body: {
						detail: {
							code: "rate_limited",
							message: "slow",
							retry_after_seconds: 2,
						},
					},
				}
			: { status: 200, body: { result: page(id) } },
	);
	m.prefetchTeamBridgeConversations(client, ACCOUNT, [row("bcv_r4_a")]);
	await wire.releaseAll();
	assert.equal(wire.calls.length, 1);
	limited = false;
	/* Account switch: B signed in, with its own bridge status. */
	client.setQueryData(m.radientUserKeys.user(), {
		account: { id: OTHER, email: "b@example.test" },
	});
	client.setQueryData(m.teamBridgeKeys.statusFor(OTHER), status(OTHER));
	m.prefetchTeamBridgeConversations(client, OTHER, [row("bcv_r4_b")]);
	await wire.releaseAll();
	assert.equal(wire.calls.length, 2, "B is not held by A's 429");
	assert.ok(
		client.getQueryData(m.teamBridgeKeys.messages("bcv_r4_b", TENANT, OTHER)),
	);
	/* A stays held. */
	m.prefetchTeamBridgeConversations(client, ACCOUNT, [row("bcv_r4_a2")]);
	await wire.releaseAll();
	assert.equal(wire.calls.length, 2);
	client.clear();
});
