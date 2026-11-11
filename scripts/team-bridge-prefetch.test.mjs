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
			export { teamBridgeMessagesQueryOptions } from "./src/renderer/src/features/team-bridge/use-team-bridge";
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

const status = () => ({
	capability: 3,
	state: "ready",
	account_id: ACCOUNT,
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
