import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Notifications "Dismiss all" + list/detail performance, pinned against the
 * SHIPPED modules (same esbuild mechanism as notifications-operations.test.mjs).
 *
 *  - The toast "Invalid desktop operation." on Dismiss all: the preview's
 *    `countSessionIds` hint carried core's `network-credentials` pseudo-session
 *    (and a stray non-hex id), and main's transport (`desktop-transport.ts`)
 *    refused the whole request on the schema before core saw it. The stub
 *    bridge below applies that exact check, so the first test reproduces the
 *    failure on the old code and dispatches on the new.
 *  - Session-scoped notification ops admit the pseudo-session (detail facts,
 *    per-conversation dismiss) and nothing looser.
 *  - `include_session_counts` reaches the wire, and core's `session_counts`
 *    replaces the whole-inbox walk when present.
 *  - The per-id detail cache is LRU-bounded.
 *  - Click-to-read: the row and counts flip before the PATCH answers, a
 *    refusal rolls back, an in-flight detail read survives the write, and the
 *    receipt's counts land without refetching (never backwards).
 *  - Convergence with the sidebar-details D4 fix: a settled write flips the
 *    open detail's flag without re-reading the body the pane is showing.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { desktopEndpoint, desktopRequestSchema, NOTIFICATION_PSEUDO_SESSION_IDS } from "./src/shared/desktop-contract";',
			'export { applyWriteToDetails, beginOptimisticWrite, writeReceiptCount, DETAIL_CACHE_MAX, notificationCountHints, notificationKeys, previewNotificationSelection, readNotificationsFacts, sessionDismissCountsFromFacts, touchNotificationDetail } from "./src/renderer/src/features/notifications/notifications-api";',
			'export { reconcileWindowWithFacts } from "./src/renderer/src/features/notifications/notifications-model";',
			'export { QueryClient, QueryObserver } from "@tanstack/react-query";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	logLevel: "silent",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const api = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "aaaaaaaaaaa1";
const OTHER = "bbbbbbbbbbb2";
const PSEUDO = "network-credentials";
const JUNK = "qa-badge-1700000000";
const CANONICAL = /^[a-f0-9]{12}$/;

/*
 * The preload bridge as main answers it: schema refusal is the 422 the page
 * toasts as "Invalid desktop operation." (desktop-transport.ts), anything else
 * is recorded and answered.
 */
const sent = [];
globalThis.window = {
	api: {
		desktop: {
			request: async (request) => {
				const parsed = api.desktopRequestSchema.safeParse(request);
				if (!parsed.success)
					return {
						status: 422,
						body: { detail: "Invalid desktop operation." },
					};
				sent.push(parsed.data);
				return {
					status: 200,
					body: {
						result: {
							selection: { token: "t", count: 3, session_counts: {} },
						},
					},
				};
			},
		},
	},
};

test("Dismiss all's preview dispatches with a pseudo-session and a junk id on the page", async () => {
	sent.length = 0;
	const selection = await api.previewNotificationSelection(
		{ kind: "all", priority: "any", from: null },
		"unread",
		[SESSION, PSEUDO, JUNK, SESSION, OTHER],
	);
	assert.equal(selection.token, "t");
	assert.equal(sent.length, 1);
	assert.deepEqual(sent[0].countSessionIds, [SESSION, OTHER]);
	const query = new URL(
		api.desktopEndpoint(sent[0]).path,
		"http://example.test",
	).searchParams;
	assert.deepEqual(query.getAll("count_session_ids"), [SESSION, OTHER]);
});

test("count hints keep canonical ids only, deduplicated, capped at the contract's 50", () => {
	const many = Array.from({ length: 60 }, (_, i) =>
		i.toString(16).padStart(12, "0"),
	);
	const hints = api.notificationCountHints([PSEUDO, ...many, many[0], JUNK]);
	assert.equal(hints.length, 50);
	assert.equal(hints[0], many[0]);
	assert.ok(hints.every((id) => CANONICAL.test(id)));
	// The hints always satisfy the schema, whatever the page held.
	assert.equal(
		api.desktopRequestSchema.safeParse({
			op: "notifications.list",
			preview: true,
			countSessionIds: hints,
		}).success,
		true,
	);
});

test("session-scoped notification ops admit core's pseudo-session and nothing looser", () => {
	assert.deepEqual([...api.NOTIFICATION_PSEUDO_SESSION_IDS], [PSEUDO]);
	const facts = {
		op: "notifications.list",
		state: "all",
		source: "notify",
		sessionId: PSEUDO,
		limit: 100,
	};
	assert.equal(api.desktopRequestSchema.safeParse(facts).success, true);
	const dismissSession = (sessionId) => ({
		op: "notifications.dismiss",
		verb: "dismiss",
		target: { sessionId, throughSeq: 9, observed: [] },
	});
	assert.equal(
		api.desktopRequestSchema.safeParse(dismissSession(PSEUDO)).success,
		true,
	);
	assert.equal(
		api.desktopEndpoint(api.desktopRequestSchema.parse(dismissSession(PSEUDO)))
			.body.session_id,
		PSEUDO,
	);
	for (const bad of [JUNK, "network-credentials/..", "", "AAAAAAAAAAA1"]) {
		assert.equal(
			api.desktopRequestSchema.safeParse({ ...facts, sessionId: bad }).success,
			false,
			bad,
		);
		assert.equal(
			api.desktopRequestSchema.safeParse(dismissSession(bad)).success,
			false,
			bad,
		);
	}
	// The count hint stays canonical-only: an older core 422s a pseudo-session.
	assert.equal(
		api.desktopRequestSchema.safeParse({
			op: "notifications.list",
			countSessionIds: [PSEUDO],
		}).success,
		false,
	);
});

test("the facts read asks core for session counts in the same answer", async () => {
	sent.length = 0;
	await api.readNotificationsFacts("all");
	assert.equal(sent.length, 1);
	const query = new URL(
		api.desktopEndpoint(sent[0]).path,
		"http://example.test",
	).searchParams;
	assert.equal(query.get("include_session_counts"), "true");
	assert.equal(query.get("limit"), "100");
	assert.equal(query.get("state"), "all");
});

test("core's session_counts replace the walk; an older core's answer falls back", () => {
	assert.equal(
		api.sessionDismissCountsFromFacts({ items: [], high_water: 4 }),
		undefined,
	);
	assert.equal(api.sessionDismissCountsFromFacts(undefined), undefined);
	assert.deepEqual(
		api.sessionDismissCountsFromFacts({
			items: [],
			high_water: 4,
			session_counts: {
				[SESSION]: { undismissed: 130, unread: 7 },
				[PSEUDO]: { undismissed: 2, unread: 2 },
			},
		}),
		{ [SESSION]: 130, [PSEUDO]: 2 },
	);
});

test("the per-id detail cache evicts the least recently used beyond its bound", () => {
	const client = new api.QueryClient();
	const base32 = "abcdefghijklmnopqrstuvwxyz234567";
	const ids = Array.from(
		{ length: api.DETAIL_CACHE_MAX + 1 },
		(_, i) => `n_${base32[i % 32]}${base32[Math.floor(i / 32)]}aaaa`,
	);
	for (const each of ids.slice(0, api.DETAIL_CACHE_MAX)) {
		client.setQueryData(api.notificationKeys.detail(each), {
			item: { id: each },
		});
		api.touchNotificationDetail(client, each);
	}
	// Re-using the first id makes the second the least recently used.
	api.touchNotificationDetail(client, ids[0]);
	const last = ids[api.DETAIL_CACHE_MAX];
	client.setQueryData(api.notificationKeys.detail(last), {
		item: { id: last },
	});
	api.touchNotificationDetail(client, last);
	assert.ok(client.getQueryData(api.notificationKeys.detail(ids[0])));
	assert.equal(
		client.getQueryData(api.notificationKeys.detail(ids[1])),
		undefined,
	);
	assert.ok(client.getQueryData(api.notificationKeys.detail(last)));
	const cached = client
		.getQueryCache()
		.findAll({ queryKey: ["desktop", "notifications", "detail"] }).length;
	assert.equal(cached, api.DETAIL_CACHE_MAX);
	client.clear();
});

const row = (over = {}) => ({
	id: "n_aaaaaaaa",
	source: "notify",
	priority: "normal",
	title: "t",
	excerpt: "",
	created_at: 1,
	updated_at: 1,
	seq: 5,
	revision: 1,
	read: false,
	read_via: null,
	dismissed: false,
	repeat_count: 1,
	session: { id: SESSION, title: "one" },
	...over,
});
const seed = () => {
	const client = new api.QueryClient();
	const facts = {
		items: [row()],
		observed: [{ id: "n_aaaaaaaa", revision: 1 }],
		unread_count: 1,
		waiting_count: 0,
		waiting_unread_count: 0,
		high_water: 5,
	};
	client.setQueryData(api.notificationKeys.facts("all"), facts);
	client.setQueryData(api.notificationKeys.count, {
		unread_count: 1,
		waiting_count: 0,
		waiting_unread_count: 0,
		high_water: 5,
	});
	const get = () => client.getQueryData(api.notificationKeys.facts("all"));
	return { client, get };
};

test("click-to-read paints read before the PATCH answers, and a refusal rolls back", async () => {
	const { client, get } = seed();
	try {
		// The write's promise never needs to settle for the row to flip.
		const tx = await api.beginOptimisticWrite(client, "read", [
			{ id: "n_aaaaaaaa", revision: 1 },
		]);
		assert.equal(get().items[0].read, true);
		assert.equal(get().unread_count, 0);
		assert.equal(
			client.getQueryData(api.notificationKeys.count).unread_count,
			0,
		);
		tx(); // the mutation's onError rollback
		assert.equal(get().items[0].read, false);
		assert.equal(get().unread_count, 1);
		assert.equal(
			client.getQueryData(api.notificationKeys.count).unread_count,
			1,
		);
	} finally {
		client.clear();
	}
});

test("a read does not cancel the detail body it was opened with", async () => {
	const { client } = seed();
	try {
		let finish;
		const body = client.fetchQuery({
			queryKey: api.notificationKeys.detail("n_aaaaaaaa"),
			queryFn: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
			retry: false,
		});
		await api.beginOptimisticWrite(client, "read", [
			{ id: "n_aaaaaaaa", revision: 1 },
		]);
		finish({ item: { id: "n_aaaaaaaa" } });
		/* Bounded: a cancelled fetch must FAIL this test, never leave it pending. */
		let timer;
		const answer = await Promise.race([
			body.then(
				(value) => value,
				(error) => ({ cancelled: String(error?.name ?? error) }),
			),
			new Promise((resolve) => {
				timer = setTimeout(() => resolve({ timedOut: true }), 1_000);
			}),
		]);
		clearTimeout(timer);
		assert.deepEqual(answer, { item: { id: "n_aaaaaaaa" } });
	} finally {
		client.clear();
	}
});

test("the receipt's counts land without a refetch and never move backwards", () => {
	const { client } = seed();
	try {
		api.writeReceiptCount(client, {
			unread_count: 0,
			waiting_count: 0,
			waiting_unread_count: 0,
			high_water: 6,
		});
		assert.equal(
			client.getQueryData(api.notificationKeys.count).unread_count,
			0,
		);
		// A newer frame (high-water 9) then a late receipt (8): the frame wins.
		client.setQueryData(api.notificationKeys.count, {
			unread_count: 3,
			waiting_count: 0,
			waiting_unread_count: 0,
			high_water: 9,
		});
		api.writeReceiptCount(client, {
			unread_count: 1,
			waiting_count: 0,
			waiting_unread_count: 0,
			high_water: 8,
		});
		assert.equal(
			client.getQueryData(api.notificationKeys.count).unread_count,
			3,
		);
	} finally {
		client.clear();
	}
});

/*
 * R1-1: the LRU never evicts a detail a mounted pane is observing. Hovering 50
 * other rows while one is open used to drop the open body back to loading.
 */
test("the detail LRU skips a query that is being observed", () => {
	const client = new api.QueryClient();
	const id = (i) => `n_obs${String(i).padStart(4, "0")}`;
	const open = id(0);
	client.setQueryData(api.notificationKeys.detail(open), {
		item: { id: open },
	});
	api.touchNotificationDetail(client, open);
	const observer = new api.QueryObserver(client, {
		queryKey: api.notificationKeys.detail(open),
		queryFn: () => new Promise(() => {}),
		staleTime: Number.POSITIVE_INFINITY,
	});
	const unsubscribe = observer.subscribe(() => {});
	try {
		// Hover-prefetch 60 other rows: far past the cap, the open one never touched.
		for (let i = 1; i <= 60; i++) {
			client.setQueryData(api.notificationKeys.detail(id(i)), {
				item: { id: id(i) },
			});
			api.touchNotificationDetail(client, id(i));
		}
		assert.deepEqual(
			client.getQueryData(api.notificationKeys.detail(open)),
			{ item: { id: open } },
			"the observed detail survived eviction",
		);
		// The bound still holds: the open one counts inside the cap.
		const cached = client
			.getQueryCache()
			.findAll({ queryKey: ["desktop", "notifications", "detail"] }).length;
		assert.equal(cached, api.DETAIL_CACHE_MAX);
		// Once nobody observes it, it is evictable again.
		unsubscribe();
		client.setQueryData(api.notificationKeys.detail(id(61)), {
			item: { id: id(61) },
		});
		api.touchNotificationDetail(client, id(61));
		assert.equal(
			client.getQueryData(api.notificationKeys.detail(open)),
			undefined,
		);
	} finally {
		unsubscribe();
		client.clear();
	}
});

/*
 * Q1: the window drops rows the server stopped listing inside the facts' covered
 * range - and nothing else.
 */
const at = (i, over = {}) =>
	row({ id: `n_rec${i}`, seq: i, updated_at: i * 10, ...over });
test("a facts answer reconciles rows dismissed elsewhere out of the window", () => {
	const window = [{ items: [at(9), at(8), at(7), at(3)] }];
	// Core dismissed n_rec8 elsewhere; page one covers down to n_rec7 (has more).
	const facts = {
		items: [at(10), at(9), at(7)],
		waiting: [],
		next_cursor: "70.n_rec7",
		high_water: 12,
	};
	const next = api.reconcileWindowWithFacts(window, facts, "all");
	const byId = Object.fromEntries(next[0].items.map((item) => [item.id, item]));
	assert.equal(byId.n_rec8.dismissed, true, "dismissed elsewhere");
	assert.equal(byId.n_rec8.seq, 12, "fenced at the facts' high water");
	assert.equal(byId.n_rec9.dismissed, false);
	assert.equal(byId.n_rec7.dismissed, false);
	assert.equal(
		byId.n_rec3.dismissed,
		false,
		"below the covered range: unknown",
	);
	// A complete page (no cursor) covers everything below it too.
	const all = api.reconcileWindowWithFacts(
		window,
		{ ...facts, next_cursor: null },
		"all",
	);
	assert.equal(all[0].items.find((i) => i.id === "n_rec3").dismissed, true);
	// Nothing to do → null, so the caller skips the cache write.
	assert.equal(
		api.reconcileWindowWithFacts(next, facts, "all"),
		null,
		"idempotent",
	);
});

test("reconciliation leaves local writes, own dismissals and newer copies alone", () => {
	const facts = {
		items: [at(10)],
		waiting: [],
		next_cursor: null,
		high_water: 12,
	};
	const window = [
		{
			items: [
				at(9), // a pending/ahead local write (Undo restoring it)
				at(8, { dismissed: true }), // the operator's own dismiss: Undo flips it back
				at(13), // newer than the facts answer: it cannot speak for it
				at(7, { id: "n_ask", source: "ask" }), // listed under waiting
			],
		},
	];
	const next = api.reconcileWindowWithFacts(
		window,
		{ ...facts, waiting: [at(7, { id: "n_ask", source: "ask" })] },
		"all",
		new Set(["n_rec9"]),
	);
	assert.equal(next, null);
});

test("in the Unread view a row read or dismissed elsewhere stops counting as unread", () => {
	const facts = {
		items: [at(10)],
		waiting: [],
		next_cursor: null,
		high_water: 12,
	};
	const window = [{ items: [at(9), at(8, { read: true })] }];
	const next = api.reconcileWindowWithFacts(window, facts, "unread");
	const [first, second] = next[0].items;
	assert.equal(first.read, true, "no longer unread, still drawn");
	assert.equal(first.dismissed, false);
	assert.equal(
		second,
		window[0].items[1],
		"the operator's own read is untouched",
	);
});

test("a settled write flips the open detail's flag without re-reading its body", async () => {
	/*
	 * Upstream's sidebar-details D4 fix invalidated the detail after every
	 * optimistic write; with the pane observing it that re-read the body just
	 * drawn on each click (opening an unread item is itself a read). The flag
	 * flip must land, the entry must go stale for its next reader, and the
	 * observed query must NOT refetch.
	 */
	const client = new api.QueryClient();
	const id = "n_aaaaaaaa";
	let reads = 0;
	const observer = new api.QueryObserver(client, {
		queryKey: api.notificationKeys.detail(id),
		queryFn: async () => {
			reads += 1;
			return { item: { id, revision: 1, read: false, dismissed: false } };
		},
		staleTime: 60_000,
		retry: false,
	});
	const unsubscribe = observer.subscribe(() => {});
	try {
		await client.fetchQuery({
			queryKey: api.notificationKeys.detail(id),
			queryFn: async () => {
				reads += 1;
				return { item: { id, revision: 1, read: false, dismissed: false } };
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		const before = reads;
		api.applyWriteToDetails(client, "read", [id]);
		await new Promise((resolve) => setTimeout(resolve, 20));
		const query = client
			.getQueryCache()
			.find({ queryKey: api.notificationKeys.detail(id), exact: true });
		assert.equal(query.state.data.item.read, true);
		assert.equal(query.isStale(), true);
		assert.equal(reads, before, "the observed detail was re-read");
		api.applyWriteToDetails(client, "dismiss", [id]);
		assert.equal(query.state.data.item.dismissed, true);
	} finally {
		unsubscribe();
		client.clear();
	}
});
