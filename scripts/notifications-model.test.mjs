import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
 *  - the badge is unread_count + waiting_unread_count, while `waiting_count` keeps
 *    every pending ask in the group (core ``waiting_unread_count``);
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
			'export { createInViewReader, qualifiesInView, IN_VIEW_DWELL_MS } from "./src/renderer/src/features/notifications/in-view-read";',
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
	createInViewReader,
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
			groups
				.slice(1)
				.every((group) => group.items.every((row) => !isLiveAsk(row))),
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
	const a = item({
		session: { id: "s-a", title: "A" },
		updated_at: NOW - 5 * HOUR,
	});
	const b = item({
		session: { id: "s-b", title: "B" },
		updated_at: NOW - HOUR,
	});
	const a2 = item({
		session: { id: "s-a", title: "A" },
		updated_at: NOW - 3 * HOUR,
	});
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
		sessionDismissCount(
			[...rows, ask({ session: { id: "s-fraud", title: "x" } })],
			"s-fraud",
		),
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
		filterItems(all, { ...DEFAULT_FILTERS, priority: "normal_up" }).map(
			(row) => row.id,
		),
		[high.id, live.id],
	);
	assert.deepEqual(
		filterItems(all, { ...DEFAULT_FILTERS, from: "s-aida" }).map(
			(row) => row.id,
		),
		[live.id],
	);
});

test("range selection spans the row order in either direction", () => {
	const rows = [item(), item(), item(), item()];
	const picked = rangeSelect(rows, rows[3].id, rows[1].id, new Set());
	assert.deepEqual(
		[...picked].sort(),
		[rows[1].id, rows[2].id, rows[3].id].sort(),
	);
	assert.deepEqual(
		[...rangeSelect(rows, null, rows[0].id, new Set())],
		[rows[0].id],
	);
});

test("the badge is unread plus waiting, and absence is zero", () => {
	assert.equal(
		badgeCountOf({
			unread_count: 3,
			waiting_count: 9,
			waiting_unread_count: 2,
			high_water: 9,
		}),
		5,
		"the badge counts UNREAD asks: waiting_count keeps read asks in the group",
	);
	assert.equal(badgeCountOf(undefined), 0);
	assert.equal(badgeCountOf(null), 0);
});

test("provenance marks follow read_via, and an unread row has none", () => {
	assert.equal(seenMarkOf(item({ read: true, read_via: "watching" })), "live");
	assert.equal(
		seenMarkOf(item({ read: true, read_via: "in_view" })),
		"in_view",
	);
	assert.equal(seenMarkOf(item({ read: true, read_via: "explicit" })), null);
	assert.equal(seenMarkOf(item({ read: false, read_via: "in_view" })), null);
});

test("the wire: list, detail, read, dismiss and seen reach the contract's routes", () => {
	assert.deepEqual(
		desktopEndpoint({ op: "notifications.list", state: "unread", limit: 100 }),
		{ path: "/v1/desktop/notifications?state=unread&limit=100", method: "GET" },
	);
	assert.deepEqual(
		desktopEndpoint({
			op: "notifications.list",
			state: "all",
			sessionId: "abc123",
			source: "notify",
		}),
		{
			path: "/v1/desktop/notifications?state=all&source=notify&session_id=abc123",
			method: "GET",
		},
	);
	assert.deepEqual(
		desktopEndpoint({ op: "notifications.get", id: "ask:s1:a-1" }),
		{
			path: "/v1/desktop/notifications/ask%3As1%3Aa-1",
			method: "GET",
		},
	);
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
			target: {
				sessionId: "abc123",
				throughSeq: 41,
				observed: [{ id: "n_abcdefghijklmnop", revision: 3 }],
			},
		}).body,
		{
			op: "dismiss",
			session_id: "abc123",
			through_seq: 41,
			observed: [{ id: "n_abcdefghijklmnop", revision: 3 }],
		},
	);
	assert.deepEqual(
		desktopEndpoint({
			op: "notifications.read",
			verb: "read",
			target: {
				all: true,
				throughSeq: 41,
				observed: [{ id: "n_abcdefghijklmnop", revision: 3 }],
			},
		}).body,
		{
			op: "read",
			all: true,
			through_seq: 41,
			observed: [{ id: "n_abcdefghijklmnop", revision: 3 }],
		},
	);
	const seen = desktopEndpoint({
		op: "notifications.seen",
		items: [
			/*
			 * Per item (D13): the anchor's own visible-since travels with it, so the
			 * route can check it against that row's `updated_at` rather than letting
			 * a long-visible neighbour carry it.
			 */
			{
				id: "n_abcdefghijklmnop",
				revision: 2,
				anchorId: "toolu_1",
				visibleSinceMs: 5,
			},
		],
		evidence: {
			sessionId: "abc123",
			inputKind: "key",
			inputAtMs: 10,
			visibleSinceMs: 5,
		},
	});
	assert.equal(seen.path, "/v1/desktop/notifications/seen");
	assert.deepEqual(seen.body, {
		items: [
			{
				id: "n_abcdefghijklmnop",
				revision: 2,
				anchor_id: "toolu_1",
				visible_since_ms: 5,
			},
		],
		evidence: {
			surface: "desktop",
			session_id: "abc123",
			input_kind: "keydown",
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
		parse({
			op: "notifications.read",
			verb: "dismiss",
			target: { all: true, throughSeq: 1 },
		}),
		false,
		"the read op never carries a dismiss verb: the foreground guard names ops, not verbs",
	);
	assert.equal(
		parse({
			op: "notifications.read",
			verb: "read",
			target: { all: true, throughSeq: 9 },
		}),
		false,
		"a bulk target without observed tokens would be a fresh-watermark sweep",
	);
	assert.equal(
		parse({
			op: "notifications.read",
			verb: "read",
			target: {
				sessionId: "aaaaaaaaaaa1",
				throughSeq: 9,
				observed: [{ id: "n_abcdefghijklmnop", revision: 1 }],
			},
		}),
		true,
	);
	assert.equal(parse({ op: "notifications.get", id: "../../etc" }), false);
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
	const base = {
		visibleSinceMs: 1_000,
		uncovered: true,
		updatedAtMs: 500,
		unread: true,
	};
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

// Exercise the shipped coordinator, not just its predicate. The fake browser
// owns only DOM evidence and the clock; input, observer and timer paths are real.
test("in-view coordinator refuses covered input, missing anchors, synthetic input and interrupted dwell", () => {
	const originals = Object.fromEntries(
		[
			"window",
			"document",
			"IntersectionObserver",
			"setTimeout",
			"clearTimeout",
		].map((key) => [key, globalThis[key]]),
	);
	let clock = 10_000;
	let observer;
	let hit = null;
	const listeners = new Map();
	const timers = new Map();
	let timerId = 0;
	const registerEvent = (name, callback) => listeners.set(name, callback);
	globalThis.window = {
		addEventListener: registerEvent,
		removeEventListener: (name) => listeners.delete(name),
	};
	globalThis.document = {
		visibilityState: "visible",
		hasFocus: () => true,
		elementFromPoint: () => hit,
		addEventListener: registerEvent,
		removeEventListener: (name) => listeners.delete(name),
	};
	globalThis.IntersectionObserver = class {
		constructor(callback) {
			observer = callback;
		}
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	globalThis.setTimeout = (callback) => {
		const id = ++timerId;
		timers.set(id, callback);
		return id;
	};
	globalThis.clearTimeout = (id) => timers.delete(id);
	const posts = [];
	const reader = createInViewReader(
		(batch) => posts.push(batch),
		() => clock,
	);
	/*
	 * The pane that owns the line. The coordinator binds a qualifying input to
	 * the SAME rendered conversation, so an unrelated pane's click cannot
	 * acknowledge this transcript (R4): `closest` answers the owner for an input
	 * inside it, and null for anything else.
	 */
	const owner = { id: "owner-a" };
	const otherPane = { id: "owner-b" };
	const paneElement = (pane) => ({
		closest: (selector) =>
			selector === "[data-notification-owner]" ? pane : null,
	});
	const element = {
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }),
		contains: () => false,
		closest: (selector) =>
			selector === "[data-notification-owner]" ? owner : null,
	};
	const insideOtherPane = paneElement(otherPane);
	const fire = (name, trusted = true, target = element) =>
		listeners.get(name)?.({ isTrusted: trusted, target });
	const dwell = () => {
		clock += 1_000;
		const callbacks = [...timers.values()];
		timers.clear();
		for (const callback of callbacks) callback();
	};
	try {
		fire("keydown");
		dwell();
		assert.equal(posts.length, 0, "unrendered anchor never acknowledges");
		reader.register({
			id: "n_abcdefghijklmnop",
			revision: 1,
			anchorId: "call-1",
			updatedAtMs: 1,
			unread: true,
			element,
			owner,
		});
		observer([{ target: element, intersectionRatio: 0.49 }]);
		hit = element;
		fire("keydown");
		dwell();
		assert.equal(posts.length, 0, "scrolled-up / less than half visible");
		observer([{ target: element, intersectionRatio: 1 }]);
		hit = {};
		fire("keydown");
		hit = element;
		dwell();
		assert.equal(
			posts.length,
			0,
			"input behind modal cannot qualify when it closes",
		);
		fire("keydown", false);
		dwell();
		assert.equal(posts.length, 0, "synthetic event is not engagement");
		fire("keydown");
		fire("blur");
		dwell();
		assert.equal(posts.length, 0, "other-app activity interrupts dwell");
		/*
		 * R4: the same visible, uncovered anchor, the same trusted input, but the
		 * input landed in another pane. No receipt, because the operator's
		 * activity belongs to a different conversation.
		 */
		fire("keydown", true, insideOtherPane);
		dwell();
		assert.equal(
			posts.length,
			0,
			"trusted input in an unrelated pane cannot acknowledge this conversation",
		);
		fire("keydown");
		observer([{ target: element, intersectionRatio: 0 }]);
		clock += 1;
		observer([{ target: element, intersectionRatio: 1 }]);
		dwell();
		assert.equal(
			posts.length,
			0,
			"scroll out and back invalidates the old edge",
		);
		fire("keydown");
		dwell();
		assert.equal(
			posts.length,
			1,
			"fresh input on the uncovered visible revision qualifies",
		);
		assert.equal(posts[0].items[0].revision, 1);
	} finally {
		reader.dispose();
		for (const [key, value] of Object.entries(originals)) {
			if (value === undefined) delete globalThis[key];
			else globalThis[key] = value;
		}
	}
});

/*
 * DECISIONS D12 / CODE AUDIT DC1 — A FOCUS GAIN IS NEVER AN INPUT EDGE.
 *
 * The app raises its own window (a notification click, a hotkey, a second
 * launch) and an alt-tab glances past it; both produce a trusted `focus` event
 * with the composer or the transcript still `document.activeElement`. Accepting
 * that as the edge marked every visible unread line read after one second of
 * dwell - a long-idle return acknowledging things nobody engaged with. The four
 * arms below are the negatives the presence correction names, driven through the
 * shipped coordinator: two focus shapes, an input outside the owning pane, and a
 * second item scrolled far above the viewport.
 */
test("a focus gain marks nothing, and only the visible pane's line is read", () => {
	const originals = Object.fromEntries(
		[
			"window",
			"document",
			"IntersectionObserver",
			"setTimeout",
			"clearTimeout",
		].map((key) => [key, globalThis[key]]),
	);
	let clock = 10_000;
	let observer;
	let hit = null;
	const listeners = new Map();
	const timers = new Map();
	let timerId = 0;
	const registerEvent = (name, callback) => listeners.set(name, callback);
	globalThis.window = {
		addEventListener: registerEvent,
		removeEventListener: (name) => listeners.delete(name),
	};
	globalThis.document = {
		visibilityState: "visible",
		hasFocus: () => true,
		elementFromPoint: () => hit,
		activeElement: null,
		addEventListener: registerEvent,
		removeEventListener: (name) => listeners.delete(name),
	};
	globalThis.IntersectionObserver = class {
		constructor(callback) {
			observer = callback;
		}
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	globalThis.setTimeout = (callback) => {
		const id = ++timerId;
		timers.set(id, callback);
		return id;
	};
	globalThis.clearTimeout = (id) => timers.delete(id);
	const posts = [];
	const reader = createInViewReader(
		(batch) => posts.push(batch),
		() => clock,
	);
	const owner = { id: "owner-a" };
	const inside = (pane) => ({
		closest: (selector) =>
			selector === "[data-notification-owner]" ? pane : null,
	});
	const line = (top) => ({
		getBoundingClientRect: () => ({ left: 0, top, width: 100, height: 20 }),
		contains: () => false,
		closest: (selector) =>
			selector === "[data-notification-owner]" ? owner : null,
	});
	const visible = line(0);
	const scrolledAway = line(-4_000);
	const composer = inside(owner);
	const sidebar = inside(null);
	const fire = (name, trusted = true, target = visible) =>
		listeners.get(name)?.({ isTrusted: trusted, target });
	const dwell = () => {
		clock += 1_000;
		const callbacks = [...timers.values()];
		timers.clear();
		for (const callback of callbacks) callback();
	};
	try {
		/*
		 * The listener itself is gone, which is the property: no amount of focus
		 * shapes can reach `onEdge` if nothing is listening for them.
		 */
		assert.equal(
			listeners.has("focus"),
			false,
			"the coordinator must not listen for window focus at all",
		);
		reader.register({
			id: "n_abcdefghijklmnop",
			revision: 1,
			anchorId: "call-1",
			updatedAtMs: 1,
			unread: true,
			element: visible,
			owner,
		});
		reader.register({
			id: "n_bcdefghijklmnopq",
			revision: 1,
			anchorId: "call-2",
			updatedAtMs: 1,
			unread: true,
			element: scrolledAway,
			owner,
		});
		observer([
			{ target: visible, intersectionRatio: 1 },
			{ target: scrolledAway, intersectionRatio: 0 },
		]);
		hit = visible;
		// Arm 1: the operator returns after two idle hours; the window gains focus.
		clock += 2 * 3_600_000;
		globalThis.document.activeElement = composer;
		fire("focus", true, composer);
		dwell();
		assert.deepEqual(posts, [], "a focus gain after 2 h idle reads nothing");
		/*
		 * Arm 2: main raises the window itself (`window-raise.ts`). That is the
		 * same trusted event with the same active element, and it must also read
		 * nothing - the coordinator cannot tell the two apart, so neither counts.
		 */
		globalThis.window.focus?.();
		fire("focus", true, composer);
		dwell();
		assert.deepEqual(posts, [], "a programmatic window raise reads nothing");
		/*
		 * Arm 3: a pointer press in the SIDEBAR while the line is on screen. The
		 * gesture is real, the line is visible and uncovered, and it still reads
		 * nothing: the input did not land in the pane that owns the line (D12).
		 */
		fire("pointerdown", true, sidebar);
		dwell();
		assert.deepEqual(posts, [], "input outside the owning pane reads nothing");
		/*
		 * Arm 4: a real key inside the transcript. Only the VISIBLE line is read;
		 * the one scrolled four thousand pixels above is not, and the post carries
		 * that item's own `visibleSinceMs` (D13) rather than a batch-wide value.
		 */
		fire("keydown", true, visible);
		dwell();
		assert.equal(posts.length, 1, "a real key in the pane qualifies the line");
		assert.deepEqual(
			posts[0].items.map((entry) => entry.id),
			["n_abcdefghijklmnop"],
			"only the line that was on screen is posted",
		);
		assert.equal(
			posts[0].items[0].visibleSinceMs,
			10_000,
			"the post carries the item's own visible-since",
		);
		assert.equal(posts[0].inputKind, "key");
	} finally {
		reader.dispose();
		for (const [key, value] of Object.entries(originals)) {
			if (value === undefined) delete globalThis[key];
			else globalThis[key] = value;
		}
	}
});

/*
 * DECISIONS D16 / DESIGN AUDIT OD2 — ONE COUNT FORMULA.
 *
 * The rail badge is core's `unread_count + waiting_unread_count`; the Unread
 * chip is the number of rows the filter actually draws. For a queue where every
 * row is unread these are the SAME number, and the rendered pair that disagreed
 * (rail 4, chip 3, with one unread open ask) is exactly the fixture below. The
 * chip is derived from the arrays the rows come from, so it cannot drift from
 * what is on screen; this test pins the three readings together.
 */
test("the Unread chip, the rail badge and the visible rows agree on one fixture", () => {
	const updates = [item({ source: "notify" }), item({ source: "notify" })];
	const askRow = item({
		source: "ask",
		priority: "high",
		ask: { ask_id: "a-1", question: "Ship it?", status: "pending" },
	});
	const counts = {
		unread_count: updates.length,
		waiting_count: 1,
		waiting_unread_count: 1,
		high_water: 9,
	};
	// The reel draws the unread updates and the pending ask in the same view.
	const visibleRows = [
		...filterItems(updates, DEFAULT_FILTERS),
		...filterItems([askRow], DEFAULT_FILTERS),
	];
	assert.equal(visibleRows.length, 3, "three rows are on screen");
	assert.equal(
		badgeCountOf(counts),
		visibleRows.length,
		"the rail badge counts the same three rows the filter shows",
	);
	assert.equal(
		counts.waiting_unread_count + counts.unread_count,
		visibleRows.length,
		"one formula, spelled the way D16 states it",
	);
	// A read ask stays pending and stays in the waiting group; core's
	// `waiting_unread_count` drops it, so the badge follows the unread half only.
	const readAsk = { ...askRow, read: true };
	const afterRead = [
		...filterItems(updates, DEFAULT_FILTERS),
		...filterItems([readAsk], DEFAULT_FILTERS),
	];
	assert.equal(
		afterRead.length,
		visibleRows.length,
		"a read ask is still shown",
	);
	assert.equal(
		badgeCountOf({ ...counts, waiting_unread_count: 0 }),
		2,
		"the badge follows the unread half, which is what it counts",
	);
});

test("the scope walk is bought when a detail is open, whatever the grouping", () => {
	/*
	 * QA ROUND 3: the detail printed the loaded page's count under Time grouping
	 * while its confirm enumerated the whole conversation. The page bought the
	 * enumeration only for conversation grouping, so this predicate is the wiring
	 * the fix turns on: an OPEN DETAIL must ask for it under Time grouping too,
	 * and nothing else may start that walk for free.
	 */
	assert.equal(
		model.sessionScopeCountsEnabled("time", true),
		true,
		"an open detail under Time grouping must enumerate the scope",
	);
	assert.equal(
		model.sessionScopeCountsEnabled("conversation", false),
		true,
		"the conversation header prints it, so it must enumerate",
	);
	assert.equal(
		model.sessionScopeCountsEnabled("time", false),
		false,
		"nothing prints it, so the bounded walk is not paid for",
	);
});

test("a printed count is taken at the live high-water mark, never a frozen one", () => {
	/*
	 * CODE ROUND 4, R4-1. Two rules, both named exports the reader has to call:
	 * WHEN to buy the per-conversation walk (`sessionScopeCountsEnabled`) and UNDER
	 * WHAT BOUNDARY to take it (`scopeCountBoundary`). The reproduced drift was a
	 * frozen boundary - 129 against a confirm of 130 after the detail's own read,
	 * 129 against 131 after a late arrival, and a vanished button against 131 after
	 * mark-all-read - so this asserts the value the reader must use, not source text.
	 */
	assert.equal(
		model.sessionScopeCountsEnabled("time", true),
		true,
		"an open detail buys the walk under Time grouping too",
	);
	assert.equal(
		model.sessionScopeCountsEnabled("conversation", false),
		true,
		"the conversation header prints it, so it buys the walk",
	);
	assert.equal(
		model.sessionScopeCountsEnabled("time", false),
		false,
		"nothing prints it, so the bounded walk is not paid for",
	);
	for (const mark of [1, 130, 131, 4_096])
		assert.equal(
			model.scopeCountBoundary(mark),
			mark,
			"the count is taken at the live mark the confirm will use",
		);
	assert.equal(model.scopeCountBoundary(undefined), undefined);
});

/*
 * R5-1: THE REEL CAN REACH OLD ROWS. The R4-4 fix trimmed from the tail, which is
 * exactly where the cursor appends its next page - so every scroll near the bottom
 * fetched a page and discarded it, and nothing older than the newest window was ever
 * reachable again (8 fetches over 900 rows left rows 401-900 with the next-page flag
 * still true). These three tests drive the shipped model function; each fails on
 * `a2b3199441`, where `slideNotificationWindow` did not exist and the tail trim did.
 */

/** Page `page` (1 = newest) covering rows 900-801, 800-701, ... so failures read. */
const reelPage = (page) => ({
	page,
	waiting: page === 1 ? [{ id: "ask:aaaaaaaaaaa1:affff1" }] : [],
	high_water: 1000,
	unread_count: 12,
	items: Array.from({ length: 100 }, (_, index) => ({
		id: `n_p${page}_${index}`,
		row: 900 - (page - 1) * 100 - index,
	})),
});

test("R5-1a: 900 rows over 9 fetches stay reachable, once each, with no duplicates", () => {
	const limit = model.NOTIFICATIONS_PAGE_WINDOW;
	let pages = [];
	let pageParams = [];
	const hidden = { value: 0 };
	const scrolled = [];
	for (let page = 1; page <= 9; page += 1) {
		pages.push(reelPage(page));
		pageParams.push(
			page === 1 ? undefined : { cursor: `c${page}`, throughSeq: 1000 },
		);
		const window = model.slideNotificationWindow(
			pages,
			pageParams,
			limit,
			hidden.value,
		);
		hidden.value = window.hiddenNewer;
		/* The reader's viewport is the page it just scrolled into. */
		scrolled.push(...window.pages.at(-1).items.map((item) => item.row));
		/* Write the window back, as the hook does after every successful fetch. */
		pages = [...window.pages];
		pageParams = [...window.pageParams];
	}
	assert.equal(pages.length, limit, "the window is bounded");
	assert.equal(
		pages.at(-1).page,
		9,
		"the page just fetched SURVIVES: the cursor's own next page is never the one dropped",
	);
	assert.equal(pages[0].page, 1, "page one is pinned, with its waiting asks");
	assert.equal(pages[0].waiting.length, 1);
	const rows = [...new Set(scrolled)].sort((left, right) => right - left);
	assert.equal(rows.length, 900, "every row was reachable exactly once");
	assert.equal(rows[0], 900, "the newest row");
	assert.equal(rows.at(-1), 1, "the OLDEST row - unreachable before this fix");
});

test("R5-1b: deep scroll, a late arrival, then a refresh keep page one's facts and Mark all's asks", () => {
	const limit = model.NOTIFICATIONS_PAGE_WINDOW;
	let pages = [];
	let pageParams = [];
	const hidden = { value: 0 };
	for (let page = 1; page <= 9; page += 1) {
		pages.push(reelPage(page));
		pageParams.push(
			page === 1 ? undefined : { cursor: `c${page}`, throughSeq: 1000 },
		);
		const window = model.slideNotificationWindow(
			pages,
			pageParams,
			limit,
			hidden.value,
		);
		hidden.value = window.hiddenNewer;
		pages = [...window.pages];
		pageParams = [...window.pageParams];
	}
	assert.ok(
		model.slideNotificationWindow(pages, pageParams, limit, hidden.value)
			.hiddenNewer > 0,
		"the head of the scroll run is dropped, which is the state under test",
	);
	/*
	 * Refresh: page one refetches and now carries a late arrival and a second waiting
	 * ask. The window must keep BOTH kinds of fact - page one's (`waiting`, counts,
	 * boundary) and the deep pages' reachability.
	 */
	const fresh = {
		...reelPage(1),
		unread_count: 13,
		high_water: 1001,
		waiting: [
			{ id: "ask:aaaaaaaaaaa1:affff1" },
			{ id: "ask:aaaaaaaaaaa1:affff2" },
		],
		items: [
			{ id: "n_late", row: 1001, revision: 2 },
			...reelPage(1).items.slice(0, 99),
		],
	};
	const window = model.slideNotificationWindow(
		[fresh, ...pages.slice(1)],
		[pageParams[0], ...pageParams.slice(1)],
		limit,
		hidden.value,
	);
	assert.equal(window.pages[0].page, 1, "page one survives the refresh");
	assert.equal(
		window.pages[0].waiting.length,
		2,
		"both pending asks are still listed",
	);
	assert.equal(
		window.pages[0].high_water,
		1001,
		"Mark all read enumerates under 1001",
	);
	assert.equal(
		window.pages[0].unread_count,
		13,
		"the count is the refreshed one",
	);
	assert.equal(
		window.pages.at(-1).page,
		9,
		"the deepest page is still there, so older rows are still reachable",
	);
});

test("R5-1c: back to top drops the scroll pages and restores the newest row", () => {
	const limit = model.NOTIFICATIONS_PAGE_WINDOW;
	let pages = [];
	let pageParams = [];
	for (let page = 1; page <= 9; page += 1) {
		pages.push(reelPage(page));
		pageParams.push(page === 1 ? undefined : { cursor: `c${page}` });
		const window = model.slideNotificationWindow(pages, pageParams, limit);
		pages = [...window.pages];
		pageParams = [...window.pageParams];
	}
	const back = model.pinFirstPage(pages, pageParams);
	assert.equal(
		back.pages.length,
		1,
		"only page one is left, so the next read pages one",
	);
	assert.equal(back.pageParams.length, 1, "params stay aligned with pages");
	assert.equal(
		model.slideNotificationWindow(back.pages, back.pageParams, limit)
			.hiddenNewer,
		0,
		"nothing is hidden after the return, so the pill is gone",
	);
	assert.equal(
		back.pages[0].items[0].row,
		900,
		"the newest row is the top of the reel again",
	);
});

test("R5-1d: the drawer keeps its own 10-page window, not the reel's 5", () => {
	const pages = Array.from({ length: 11 }, (_, index) => ({
		page: index + 1,
		items: Array.from({ length: 20 }, (_, row) => ({ id: `p${index}_${row}` })),
	}));
	const window = model.slideNotificationWindow(
		pages,
		pages.map((_, index) => index),
		model.DRAWER_PAGE_WINDOW,
	);
	assert.equal(
		model.NOTIFICATIONS_PAGE_WINDOW,
		5,
		"the reel's bound is unchanged",
	);
	assert.equal(
		model.DRAWER_PAGE_WINDOW,
		10,
		"the drawer's bound is ten pages, not five",
	);
	assert.equal(window.pages.length, 10, "eleven pages fold to ten");
	assert.equal(
		window.pages[0].page,
		1,
		"the drawer's first page is still pinned",
	);
	assert.equal(window.pages.at(-1).page, 11, "the deepest page survives");
	assert.equal(
		window.hiddenNewer,
		20,
		"one page of rows left memory, and says so",
	);
	/* The 5-page window would have cut the drawer off at 500 rows. */
	const wrongly = model.slideNotificationWindow(
		pages,
		pages.map((_, index) => index),
		model.NOTIFICATIONS_PAGE_WINDOW,
	);
	assert.equal(
		wrongly.pages.length,
		5,
		"this is the bound QA measured on the drawer",
	);
});

test("Q12: a successful conversation dismiss removes the rows this window kept drawn", () => {
	/* After mark-all the rows stayed on screen, read but present; the dismissal then
	   covered all of them, and the list kept drawing ~101 rows against a server that
	   listed 0 for that conversation. */
	const drawn = new Set(
		Array.from({ length: 101 }, (_, index) => `n_keep${index}`),
	);
	const changed = [...drawn, "n_somewhere_else"];
	const leaving = model.coveredByWrite(drawn, changed);
	assert.equal(
		leaving.size,
		101,
		"every drawn row the write covered leaves the list",
	);
	assert.ok(
		!leaving.has("n_somewhere_else"),
		"an id this window never drew is ignored",
	);
	const kept = [...drawn].filter((id) => !leaving.has(id));
	assert.equal(kept.length, 0, "no row from that conversation remains drawn");
});

test("R5-2: the scope count is keyed by this conversation's rows, not the store's mark", () => {
	const own = (revision, read) => ({
		id: "n_own",
		revision,
		read,
		dismissed: false,
		session: { id: "aaaaaaaaaaa1" },
	});
	const foreign = (id, revision = 4, read = false) => ({
		id,
		revision,
		read,
		dismissed: false,
		session: { id: "bbbbbbbbbbb2" },
	});
	const before = model.scopeCountSignature(
		[own(3, false), foreign("n_other")],
		"aaaaaaaaaaa1",
	);
	assert.equal(
		model.scopeCountSignature(
			[own(3, false), foreign("n_other", 9, true)],
			"aaaaaaaaaaa1",
		),
		before,
		"a mark in another conversation must not buy a whole-store walk (30 reads for 3 marks before)",
	);
	assert.notEqual(
		model.scopeCountSignature(
			[own(4, true), foreign("n_other")],
			"aaaaaaaaaaa1",
		),
		before,
		"a change to THIS conversation does re-walk, which is what R4-1 needs",
	);
});

test("R4-7 / DC7: a confirmed read survives for a row the list only now supplies", () => {
	/*
	 * A mark-all or an Undo can confirm ids that were not on the loaded page. The
	 * token waits and is merged when the real row arrives: the confirmed read must not
	 * flip back to unread, and a NEWER revision the operator never saw must not be
	 * forced read.
	 */
	const confirmed = new Map([["n_known", 3]]);
	const rows = [
		{ id: "n_known", revision: 3, read: false, read_via: null },
		{ id: "n_newer", revision: 9, read: false, read_via: null },
	];
	const merged = model.mergeConfirmedReads(rows, confirmed);
	assert.equal(merged[0].read, true, "the confirmed revision is read");
	assert.equal(merged[0].read_via, "explicit");
	assert.equal(
		merged[1].read,
		false,
		"a row without a receipt is untouched, whatever else was confirmed",
	);
	const stale = model.mergeConfirmedReads(
		[{ id: "n_known", revision: 4, read: false, read_via: null }],
		confirmed,
	);
	assert.equal(
		stale[0].read,
		false,
		"a newer revision the operator never saw is not forced read",
	);
});
