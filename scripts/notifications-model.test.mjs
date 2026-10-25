import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The notifications reel's pure model and wire contract, against the SHIPPED
 * modules (the `sidebar-destinations.test.mjs` mechanism: esbuild over the real
 * TypeScript, so a signature change breaks this suite instead of drifting
 * behind a hand-copied fixture).
 *
 * What is pinned, and why each is a statement the page relies on:
 *  - "Waiting on you" is first in either grouping (design.md section 3);
 *  - a live ask never enters a bulk dismiss, and the count of skipped asks is
 *    what the selection bar promises (design section 6, contract section 2.3);
 *  - time buckets are calendar days, so the four groups partition every time;
 *  - the badge is unread_count + waiting_count (contract section 8.1);
 *  - provenance marks map read_via to "Seen live" / "Seen in conversation";
 *  - the request schema refuses a sweep without a high-water mark, and the
 *    read and dismiss halves are separate ops so main's foreground guard can
 *    name the read half alone (contract section 5.2).
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/notifications/notifications-model";',
			'export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
			'export { qualifiesInView, IN_VIEW_DWELL_MS } from "./src/renderer/src/features/notifications/in-view-read";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	logLevel: "silent",
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	badgeCountOf,
	desktopEndpoint,
	desktopRequestSchema,
	dismissPlan,
	filterItems,
	groupItems,
	isLiveAsk,
	rangeSelect,
	rowOrder,
	seenMarkOf,
	sessionDismissCount,
	timeBucketOf,
	DEFAULT_FILTERS,
	qualifiesInView,
	IN_VIEW_DWELL_MS,
} = model;

const NOW = new Date(2026, 9, 25, 15, 0, 0).getTime();
const HOUR = 3_600_000;

let seq = 0;
const item = (over = {}) => {
	seq += 1;
	return {
		id: `n_${"a".repeat(15)}${String.fromCharCode(97 + (seq % 26))}`,
		source: "notify",
		priority: "normal",
		title: `Item ${seq}`,
		excerpt: "",
		created_at: NOW - HOUR,
		updated_at: NOW - HOUR,
		seq,
		revision: 1,
		read: false,
		read_via: null,
		dismissed: false,
		repeat_count: 1,
		session: { id: "s-fraud", title: "radient fraud watch" },
		ask: null,
		...over,
	};
};
const ask = (over = {}) =>
	item({
		id: `ask:s-aida:a-${seq + 1}`,
		source: "ask",
		priority: "high",
		ask: { status: "open", question_count: 2, dismissible: true },
		session: { id: "s-aida", title: "Aida" },
		...over,
	});

test("time buckets are calendar days and partition every timestamp", () => {
	assert.equal(timeBucketOf(NOW - 1000, NOW), "today");
	const midnight = new Date(2026, 9, 25, 0, 0, 0).getTime();
	assert.equal(timeBucketOf(midnight, NOW), "today");
	assert.equal(timeBucketOf(midnight - 1, NOW), "yesterday");
	assert.equal(timeBucketOf(midnight - 24 * HOUR, NOW), "yesterday");
	assert.equal(timeBucketOf(midnight - 24 * HOUR - 1, NOW), "week");
	assert.equal(timeBucketOf(midnight - 7 * 24 * HOUR, NOW), "week");
	assert.equal(timeBucketOf(midnight - 7 * 24 * HOUR - 1, NOW), "older");
});

test("Waiting on you is first in both groupings and holds only live asks", () => {
	const update = item({ updated_at: NOW - 60_000 });
	const live = ask({ updated_at: NOW - 22 * 60_000 });
	const older = item({ updated_at: NOW - 30 * 24 * HOUR });
	for (const grouping of ["time", "conversation"]) {
		const groups = groupItems([update, older, live], [], grouping, NOW);
		assert.equal(groups[0].kind, "waiting", grouping);
		assert.deepEqual(
			groups[0].items.map((row) => row.id),
			[live.id],
		);
		assert.ok(
			groups.slice(1).every((group) => group.items.every((row) => !isLiveAsk(row))),
			`${grouping}: a live ask must not appear outside Waiting on you`,
		);
	}
	const byTime = groupItems([update, older, live], [], "time", NOW);
	assert.deepEqual(
		byTime.map((group) => group.key),
		["waiting", "today", "older"],
	);
	// The route's own `waiting` list pins too, without duplicating a row that
	// also arrived in `items`.
	const both = groupItems([live, update], [live], "time", NOW);
	assert.equal(rowOrder(both).filter((row) => row.id === live.id).length, 1);
});

test("conversation grouping orders sessions by their newest item", () => {
	const a = item({ session: { id: "s-a", title: "A" }, updated_at: NOW - 5 * HOUR });
	const b = item({ session: { id: "s-b", title: "B" }, updated_at: NOW - HOUR });
	const a2 = item({ session: { id: "s-a", title: "A" }, updated_at: NOW - 3 * HOUR });
	const groups = groupItems([a, b, a2], [], "conversation", NOW);
	assert.deepEqual(
		groups.map((group) => group.title),
		["B", "A"],
	);
	assert.deepEqual(
		groups[1].items.map((row) => row.id),
		[a2.id, a.id],
	);
});

test("a bulk dismiss skips live asks and says how many stay", () => {
	const rows = [item(), item(), ask(), item()];
	const plan = dismissPlan(rows);
	assert.equal(plan.dismissable.length, 3);
	assert.equal(plan.asksStaying, 1);
	assert.ok(plan.dismissable.every((row) => !isLiveAsk(row)));
	// An answered ask is an ordinary record once settled (not live).
	assert.equal(isLiveAsk(ask({ ask: { status: "answered" } })), false);
	assert.equal(
		sessionDismissCount([...rows, ask({ session: { id: "s-fraud", title: "x" } })], "s-fraud"),
		3,
	);
});

test("filters: kind, priority and source narrow the loaded set", () => {
	const high = item({ priority: "high" });
	const low = item({ priority: "low" });
	const live = ask();
	const all = [high, low, live];
	assert.equal(filterItems(all, DEFAULT_FILTERS).length, 3);
	assert.deepEqual(
		filterItems(all, { ...DEFAULT_FILTERS, kind: "asks" }).map((row) => row.id),
		[live.id],
	);
	assert.deepEqual(
		filterItems(all, { ...DEFAULT_FILTERS, priority: "normal_up" }).map((row) => row.id),
		[high.id, live.id],
	);
	assert.deepEqual(
		filterItems(all, { ...DEFAULT_FILTERS, from: "s-aida" }).map((row) => row.id),
		[live.id],
	);
});

test("range selection spans the row order in either direction", () => {
	const rows = [item(), item(), item(), item()];
	const picked = rangeSelect(rows, rows[3].id, rows[1].id, new Set());
	assert.deepEqual([...picked].sort(), [rows[1].id, rows[2].id, rows[3].id].sort());
	assert.deepEqual([...rangeSelect(rows, null, rows[0].id, new Set())], [rows[0].id]);
});

test("the badge is unread plus waiting, and absence is zero", () => {
	assert.equal(badgeCountOf({ unread_count: 3, waiting_count: 2, high_water: 9 }), 5);
	assert.equal(badgeCountOf(undefined), 0);
	assert.equal(badgeCountOf(null), 0);
});

test("provenance marks follow read_via, and an unread row has none", () => {
	assert.equal(seenMarkOf(item({ read: true, read_via: "watching" })), "live");
	assert.equal(seenMarkOf(item({ read: true, read_via: "in_view" })), "in_view");
	assert.equal(seenMarkOf(item({ read: true, read_via: "explicit" })), null);
	assert.equal(seenMarkOf(item({ read: false, read_via: "in_view" })), null);
});

test("the wire: list, detail, read, dismiss and seen reach the contract's routes", () => {
	assert.deepEqual(
		desktopEndpoint({ op: "notifications.list", state: "unread", limit: 100 }),
		{ path: "/v1/desktop/notifications?state=unread&limit=100", method: "GET" },
	);
	assert.deepEqual(
		desktopEndpoint({ op: "notifications.list", state: "all", sessionId: "abc123", source: "notify" }),
		{
			path: "/v1/desktop/notifications?state=all&source=notify&session_id=abc123",
			method: "GET",
		},
	);
	assert.deepEqual(desktopEndpoint({ op: "notifications.get", id: "ask:s1:a-1" }), {
		path: "/v1/desktop/notifications/ask%3As1%3Aa-1",
		method: "GET",
	});
	assert.deepEqual(desktopEndpoint({ op: "notifications.count" }), {
		path: "/v1/desktop/notifications/count",
		method: "GET",
	});
	assert.deepEqual(
		desktopEndpoint({
			op: "notifications.read",
			verb: "read",
			target: { items: [{ id: "n_abcdefghijklmnop", revision: 3 }] },
		}),
		{
			path: "/v1/desktop/notifications",
			method: "PATCH",
			body: { op: "read", ids: [{ id: "n_abcdefghijklmnop", revision: 3 }] },
		},
	);
	assert.deepEqual(
		desktopEndpoint({
			op: "notifications.dismiss",
			verb: "dismiss",
			target: { sessionId: "abc123", throughSeq: 41 },
		}).body,
		{ op: "dismiss", session_id: "abc123", through_seq: 41 },
	);
	assert.deepEqual(
		desktopEndpoint({
			op: "notifications.read",
			verb: "read",
			target: { all: true, throughSeq: 41 },
		}).body,
		{ op: "read", all: true, through_seq: 41 },
	);
	const seen = desktopEndpoint({
		op: "notifications.seen",
		items: [{ id: "n_abcdefghijklmnop", revision: 2, anchorId: "toolu_1" }],
		evidence: { sessionId: "abc123", inputKind: "key", inputAtMs: 10, visibleSinceMs: 5 },
	});
	assert.equal(seen.path, "/v1/desktop/notifications/seen");
	assert.deepEqual(seen.body, {
		items: [{ id: "n_abcdefghijklmnop", revision: 2, anchor_id: "toolu_1" }],
		evidence: {
			surface: "desktop",
			session_id: "abc123",
			input_kind: "key",
			input_at_ms: 10,
			visible_since_ms: 5,
		},
	});
});

test("the schema refuses a sweep with no high-water mark and a path-bearing id", () => {
	const parse = (request) => desktopRequestSchema.safeParse(request).success;
	assert.equal(
		parse({ op: "notifications.read", verb: "read", target: { all: true } }),
		false,
		"mark-all without throughSeq would clear items that arrive after the click",
	);
	assert.equal(
		parse({ op: "notifications.read", verb: "dismiss", target: { all: true, throughSeq: 1 } }),
		false,
		"the read op never carries a dismiss verb: the foreground guard names ops, not verbs",
	);
	assert.equal(
		parse({ op: "notifications.get", id: "../../etc" }),
		false,
	);
	assert.equal(
		parse({ op: "notifications.get", id: "n_abcdefghijklmnop" }),
		true,
	);
	assert.equal(
		parse({
			op: "notifications.read",
			verb: "read",
			target: { items: [{ id: "n_abcdefghijklmnop", revision: 1 }], all: true },
		}),
		false,
		"exactly one target",
	);
});

test("in-view read: every one of the five conditions is required (contract section 6.4)", () => {
	const base = { visibleSinceMs: 1_000, uncovered: true, updatedAtMs: 500, unread: true };
	const edge = 2_000;
	const fired = edge + IN_VIEW_DWELL_MS;
	assert.equal(qualifiesInView(base, edge, fired), true, "all five hold");
	assert.equal(
		qualifiesInView({ ...base, visibleSinceMs: null }, edge, fired),
		false,
		"(a) not visible now",
	);
	assert.equal(
		qualifiesInView({ ...base, uncovered: false }, edge, fired),
		false,
		"(b) covered by a modal or drawer",
	);
	assert.equal(
		qualifiesInView({ ...base, visibleSinceMs: edge + 1 }, edge, fired),
		false,
		"(c) the input came before the line was visible: a scroll that brought it in is not the edge",
	);
	assert.equal(
		qualifiesInView(base, edge, fired - 1),
		false,
		"(d) under the 1 s dwell: a scroll-past",
	);
	assert.equal(
		qualifiesInView({ ...base, updatedAtMs: edge }, edge, fired),
		false,
		"(e) a keyed update that landed at or after the edge was not seen",
	);
	assert.equal(
		qualifiesInView({ ...base, unread: false }, edge, fired),
		false,
		"a read item is never re-posted",
	);
});
