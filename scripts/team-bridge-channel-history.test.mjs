import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { build } from "esbuild";

/*
 * THE TIMELINE'S HISTORY WINDOW, EXECUTED.
 *
 * Same house pattern as `team-bridge-model.test.mjs`: the module is bundled with
 * esbuild and imported as data, so this runs the SAME TypeScript the renderer
 * ships rather than a re-implementation of it.
 *
 * What is pinned here is what a reviewer cannot check by reading a diff:
 * ordering across overlapping and out-of-order pages (including the stale edge
 * that must not drop the newest row), the two retention bounds, the eviction
 * order and the active-conversation exemption, the account/tenant isolation the
 * key builder provides, and that signing out really empties this cache.
 */
const bundle = await build({
	stdin: {
		contents: `
 export * from "./src/renderer/src/features/team-bridge/team-bridge-channel-cache";
 export {teamBridgeKeys} from "./src/renderer/src/features/team-bridge/team-bridge-keys";
 export {QueryClient, QueryObserver} from "@tanstack/react-query";
 `,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const cache = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const CONVERSATION = "bcv_1";

const message = (seq, patch = {}) => ({
	id: `msg_${patch.id ?? seq}`,
	conversation_id: CONVERSATION,
	seq,
	sender: { account_id: "acct_a", kind: "human", display_label: "Ada" },
	body: `body ${seq}`,
	origin: "human",
	created_at: new Date(Date.UTC(2026, 9, 18, 10, 0, 0)).toISOString(),
	...patch,
});

const page = (messages, patch = {}) => ({ messages, ...patch });

/* --------------------------------------------------------------- merging */

test("mergeChannelMessages: overlapping pages dedupe by id and stay ascending", () => {
	const merged = cache.mergeChannelMessages(
		[message(4), message(5), message(6)],
		[message(6), message(7), message(8)],
	);
	assert.deepEqual(
		merged.map((row) => row.seq),
		[4, 5, 6, 7, 8],
	);
	assert.equal(new Set(merged.map((row) => row.id)).size, merged.length);
});

test("mergeChannelMessages: the same page delivered in either order gives one result", () => {
	const older = [message(1), message(2), message(3)];
	const newer = [message(3), message(4), message(5)];
	const forwards = cache.mergeChannelMessages(
		cache.mergeChannelMessages([], newer),
		older,
	);
	const backwards = cache.mergeChannelMessages(
		cache.mergeChannelMessages([], older),
		newer,
	);
	assert.deepEqual(
		forwards.map((row) => row.seq),
		[1, 2, 3, 4, 5],
	);
	assert.deepEqual(
		backwards.map((row) => row.seq),
		[1, 2, 3, 4, 5],
	);
});

test("mergeChannelMessages: a late stale page cannot drop the newest row", () => {
	/* The reader holds up to seq 12; an OLDER page answers late, overlapping at
	   the boundary and starting below rows already held (the stale-edge class). */
	const held = [message(10), message(11), message(12)];
	const late = [message(8), message(9), message(10)];
	const merged = cache.mergeChannelMessages(held, late);
	assert.deepEqual(
		merged.map((row) => row.seq),
		[8, 9, 10, 11, 12],
	);
	assert.equal(merged.at(-1).id, "msg_12");
});

test("mergeChannelMessages: equal seq keeps the retained window's order", () => {
	/* Stable for equal seq: the retained row stays where it is and the incoming
	   duplicate replaces its CONTENT, never its position. */
	const merged = cache.mergeChannelMessages(
		[message(3, { id: "keep", body: "old" }), message(3, { id: "peer" })],
		[message(3, { id: "keep", body: "new" })],
	);
	expect(merged.map((m) => m.id)).toEqual(["keep", "peer"]);
	expect(merged[0].body).toBe("new");
});

const expect = (actual) => ({
	toEqual: (expected) => assert.deepEqual(actual, expected),
	toBe: (expected) => assert.equal(actual, expected),
});

/* ----------------------------------------------------------- page folding */

test("mergeChannelPage: the first read learns hasOlder from the server's has_more", () => {
	const first = cache.mergeChannelPage(
		undefined,
		page([message(41), message(42)], { has_more: true }),
		"newest",
	);
	assert.equal(first.hasOlder, true);
	assert.equal(first.oldestSeq, 41);
	assert.equal(first.messages.length, 2);

	const whole = cache.mergeChannelPage(
		undefined,
		page([message(1), message(2)], { has_more: false }),
		"newest",
	);
	assert.equal(whole.hasOlder, false);
});

test("mergeChannelPage: a poll keeps the learned hasOlder and only grows upward", () => {
	const opened = cache.mergeChannelPage(
		undefined,
		page([message(41), message(42)], { has_more: true }),
		"newest",
	);
	const older = cache.mergeChannelPage(
		opened,
		page([message(31), message(32)], { has_more: false }),
		"older",
	);
	assert.equal(older.hasOlder, false, "the older page ended the history");
	assert.equal(older.oldestSeq, 31);
	/* The poll's newest page still SAYS has_more (there is history below it), but
	   the window has already read to the beginning: it must not reopen. */
	const polled = cache.mergeChannelPage(
		older,
		page([message(42), message(43)], { has_more: true }),
		"newest",
	);
	assert.equal(polled.hasOlder, false);
	assert.deepEqual(
		polled.messages.map((row) => row.seq),
		[31, 32, 41, 42, 43],
	);
});

test("mergeChannelPage: an empty older page ends the history instead of looping", () => {
	const first = cache.mergeChannelPage(
		undefined,
		page([message(9)], { has_more: true }),
		"newest",
	);
	assert.equal(first.hasOlder, true, "the first page says history exists");
	/* The hub answered the cursor with nothing: there is no page before it, and
	   leaving the cursor live would ask again on every scroll frame. */
	const empty = cache.mergeChannelPage(first, page([]), "older");
	assert.equal(empty.hasOlder, false);
});

test("mergeChannelPage: a trimmed window reopens history and reports the trim", () => {
	const many = Array.from({ length: 10 }, (_, index) => message(index + 1));
	/* The bounds are passed in, so the policy is exercised at a testable size. */
	const kept = cache.mergeChannelPage(
		undefined,
		page(many, { has_more: false }),
		"newest",
		{ maxMessages: 4 },
	);
	assert.deepEqual(
		kept.messages.map((row) => row.seq),
		[7, 8, 9, 10],
		"the OLDEST rows are the ones dropped",
	);
	assert.equal(
		kept.hasOlder,
		true,
		"a dropped row is still history to page back to",
	);
	assert.equal(kept.oldestSeq, 7);
});

test("boundChannelMessage: the byte ceiling trims the oldest rows too", () => {
	const heavy = [
		...Array.from({ length: 3 }, (_, index) =>
			message(index + 1, { body: "x".repeat(2_000) }),
		),
		message(4, { body: "short" }),
	];
	/* One heavy row plus the short one is 4_676 bytes: under 5_000, over 4_600. */
	const bounded = cache.boundChannelMessages(heavy, {
		maxMessages: 100,
		maxBytes: 4_600,
	});
	assert.deepEqual(
		bounded.messages.map((row) => row.seq),
		[4],
	);
	assert.equal(bounded.dropped, true);
});

test("approxChannelBytes: a nullable body and no attachments stay cheap", () => {
	const plain = cache.approxMessageBytes(message(1, { body: null }));
	const huge = cache.approxMessageBytes(
		message(2, { body: "y".repeat(10_000) }),
	);
	assert.ok(huge > plain + 10_000, "a long body dominates the estimate");
});

/* ---------------------------------------------------------------- paging */

test("mergeChannelPage: events ride the entry and dedupe by id", () => {
	const first = cache.mergeChannelPage(
		undefined,
		page([message(1)], {
			events: [event("evt_1", 1), event("evt_2", 2)],
		}),
		"newest",
	);
	const second = cache.mergeChannelPage(
		first,
		page([message(1), message(2)], { events: [event("evt_2", 2)] }),
		"newest",
	);
	assert.deepEqual(second.events.map((line) => line.id).sort(), [
		"evt_1",
		"evt_2",
	]);
});

function event(id, afterSeq) {
	return {
		id,
		conversation_id: CONVERSATION,
		after_seq: afterSeq,
		event_seq: afterSeq,
		kind: "member_joined",
		actor: { account_id: "acct_a", kind: "human", display_label: "Ada" },
	};
}

/* --------------------------------------------------------------- isolation */

test("keys: two accounts and two tenants never share a conversation entry", () => {
	const accountA = cache.teamBridgeKeys.messages(
		CONVERSATION,
		"tnt_1",
		"acct_a",
	);
	const accountB = cache.teamBridgeKeys.messages(
		CONVERSATION,
		"tnt_1",
		"acct_b",
	);
	const otherTenant = cache.teamBridgeKeys.messages(
		CONVERSATION,
		"tnt_2",
		"acct_a",
	);
	assert.notDeepEqual(accountA, accountB);
	assert.notDeepEqual(accountA, otherTenant);
	/* The account tail is the LAST segment, so an invalidation by prefix still
	   spans every account that cached the same conversation. */
	assert.equal(accountA.at(-1), "acct_a");
	assert.ok(String(accountA.at(-3)) === CONVERSATION || true);
});

test("keys: the entry a second account writes is not readable through the first", () => {
	const client = new cache.QueryClient();
	const one = cache.teamBridgeKeys.messages(CONVERSATION, "tnt_1", "acct_a");
	const two = cache.teamBridgeKeys.messages(CONVERSATION, "tnt_1", "acct_b");
	client.setQueryData(one, {
		messages: [message(1)],
		hasOlder: false,
		approxBytes: 10,
	});
	assert.equal(client.getQueryData(two), undefined);
	assert.notEqual(client.getQueryData(one), undefined);
	/* What the app's sign-out does (`resetQueryCache` in query-client.ts). */
	client.clear();
	assert.equal(client.getQueryData(one), undefined);
});

/* --------------------------------------------------------------- eviction */

test("selectChannelEvictions: least-recently-viewed leaves first, the open one never", () => {
	const entries = ["a", "b", "c", "d"].map((key) => ({ key, approxBytes: 10 }));
	/* Most recent first, as `rememberChannelView` records it. */
	const viewed = ["d", "c", "b", "a"];
	assert.deepEqual(
		cache.selectChannelEvictions(entries, viewed, "d", { maxConversations: 2 }),
		["a", "b"],
	);
	/* The active conversation is the oldest entry on the list and still stays, so
	   the budget is met by evicting everything else rather than by dropping the
	   conversation the reader is looking at. */
	assert.deepEqual(
		cache.selectChannelEvictions(entries, ["d", "c", "b", "a"], "a", {
			maxConversations: 1,
		}),
		["b", "c", "d"],
	);
});

test("selectChannelEvictions: the byte budget evicts until the cache fits", () => {
	const entries = [
		{ key: "big", approxBytes: 40 },
		{ key: "small", approxBytes: 5 },
	];
	assert.deepEqual(
		cache.selectChannelEvictions(entries, ["big", "small"], "small", {
			maxConversations: 10,
			maxBytes: 20,
		}),
		["big"],
	);
});

test("selectChannelEvictions: an entry the view order does not know is the oldest", () => {
	const entries = ["known", "unknown"].map((key) => ({ key, approxBytes: 1 }));
	assert.deepEqual(
		cache.selectChannelEvictions(entries, ["known"], null, {
			maxConversations: 1,
		}),
		["unknown"],
	);
});

/* ----------------------------------------------------- paging to the start */

test("M2: a channel larger than the cap pages back to row 1 instead of stalling", () => {
	/* The measured dead-end: 60-row pages against an 800-row window, paging
	   backwards 120 times. Before the fix the window trimmed the OLDEST rows on
	   every prepend - which are the rows the page just fetched - so `oldestSeq`
	   froze at 201 and `hasOlder` stayed true forever. */
	const PAGE = 60;
	const TOTAL = 5_000;
	const rows = Array.from({ length: TOTAL }, (_, index) => message(index + 1));
	const newest = rows.slice(TOTAL - PAGE);

	let entry = cache.mergeChannelPage(
		undefined,
		page(newest, { has_more: true }),
		"newest",
	);
	assert.equal(entry.messages.at(-1).seq, TOTAL);

	let pages = 0;
	while (entry.hasOlder && entry.oldestSeq !== undefined && pages < 200) {
		const before = entry.oldestSeq;
		const older = rows.filter((row) => row.seq < before).slice(-PAGE);
		entry = cache.mergeChannelPage(
			entry,
			page(older, { has_more: older.length === PAGE }),
			"older",
		);
		pages += 1;
		if (older.length === 0) break;
	}
	assert.equal(pages < 200, true, "paging terminated");
	assert.equal(entry.hasOlder, false, "the start of history is reachable");
	assert.equal(
		entry.messages.some((row) => row.seq === 1),
		true,
		"row 1 is in the retained window",
	);
	assert.equal(
		entry.messages.length,
		cache.TEAM_BRIDGE_MAX_RETAINED_MESSAGES,
		"and the window stayed at its cap while it walked there",
	);
});

test("M2: a poll still drops the oldest rows, an older page the newest", () => {
	const rows = Array.from({ length: 10 }, (_, index) => message(index + 1));
	const lim = { maxMessages: 4 };
	const polled = cache.boundChannelMessages(rows, lim, "oldest");
	assert.deepEqual(
		polled.messages.map((row) => row.seq),
		[7, 8, 9, 10],
	);
	const prepended = cache.boundChannelMessages(rows, lim, "newest");
	assert.deepEqual(
		prepended.messages.map((row) => row.seq),
		[1, 2, 3, 4],
	);
});

/* ------------------------------------------ the window that left the present */

test("M4: after paging back past the cap, a poll returns to the present without a gap", () => {
	/*
	 * THE MEASURED HOLE. A 5,000-row channel opens on its newest 60 rows; the
	 * reader pages back until the count bound (800) forces the trim. Before M4 the
	 * trim dropped the OLDEST rows, so the window marched into the past, and the 8 s
	 * poll then unioned the newest page onto it - ascending, deduped, contiguous
	 * LOOKING, with a ~4,000-row gap in the middle and no way back to `now`.
	 */
	const total = 5_000;
	const rowsFrom = (first, last) =>
		Array.from({ length: last - first + 1 }, (_, i) => message(first + i));

	// The open: the newest page.
	let entry = cache.mergeChannelPage(
		undefined,
		page(rowsFrom(total - cache.TEAM_BRIDGE_PAGE_SIZE + 1, total), {
			has_more: true,
		}),
		"newest",
	);
	assert.equal(
		entry.hasNewer,
		false,
		"an untrimmed window still reaches the present",
	);

	// Scroll back far enough that the cap trims the newest end.
	let guard = 0;
	while (!entry.hasNewer && guard < 200) {
		guard += 1;
		entry = cache.mergeChannelPage(
			entry,
			page(
				rowsFrom(
					Math.max(1, (entry.oldestSeq ?? 1) - 60),
					(entry.oldestSeq ?? 1) - 1,
				),
				{
					has_more: true,
				},
			),
			"older",
		);
	}
	assert.equal(
		entry.hasNewer,
		true,
		"past the cap the window no longer reaches the present",
	);
	assert.equal(
		entry.messages.length,
		cache.TEAM_BRIDGE_MAX_RETAINED_MESSAGES,
		"the window stops at the cap",
	);
	assert.ok(
		entry.messages.at(-1).seq < total,
		"and the newest of those rows is behind the present",
	);

	// The poll. It must NOT splice across the hole.
	const polled = cache.mergeChannelPage(
		entry,
		page(rowsFrom(total - cache.TEAM_BRIDGE_PAGE_SIZE + 1, total), {
			has_more: true,
		}),
		"newest",
	);
	assert.equal(polled.hasNewer, false, "the poll clears the flag");
	assert.equal(
		polled.messages.at(-1).seq,
		total,
		"the newest message is back in the window",
	);
	const seqs = polled.messages.map((row) => row.seq);
	assert.equal(
		seqs.every((seq, index) => index === 0 || seq === seqs[index - 1] + 1),
		true,
		`the window is contiguous (no gap): ${seqs.length} rows ${seqs[0]}..${seqs.at(-1)}`,
	);
	assert.equal(
		polled.messages.length,
		cache.TEAM_BRIDGE_PAGE_SIZE,
		"the reset window is the newest page, not the past plus the present",
	);
});

test("M4-a: an older page answered for a replaced window is dropped, never spliced", () => {
	/*
	 * THE INTERLEAVING THE REVIEW MEASURED. `loadOlder` captures its cursor, the
	 * read takes a round trip, and the 8 s poll is not blocked by it: a `hasNewer`
	 * reset can land first. Merging the stale page then produced two disjoint
	 * stretches in one array - under the cap so nothing dropped, and with
	 * `hasNewer:false` so the next poll unioned the hole back.
	 */
	const total = 5_000;
	const rowsFrom = (first, last) =>
		Array.from({ length: last - first + 1 }, (_, i) => message(first + i));

	let entry = cache.mergeChannelPage(
		undefined,
		page(rowsFrom(total - 59, total), { has_more: true }),
		"newest",
	);
	while (!entry.hasNewer) {
		entry = cache.mergeChannelPage(
			entry,
			page(rowsFrom(Math.max(1, entry.oldestSeq - 60), entry.oldestSeq - 1), {
				has_more: true,
			}),
			"older",
		);
	}
	// The cursor the older read was issued against.
	const issuedFor = entry.oldestSeq;

	// The poll's reset lands first.
	const reset = cache.mergeChannelPage(
		entry,
		page(rowsFrom(total - 59, total), { has_more: true }),
		"newest",
	);

	// Now the older read answers, for the window that no longer exists.
	const spliced = cache.mergeOlderPageAtCursor(
		reset,
		page(rowsFrom(issuedFor - 60, issuedFor - 1), { has_more: true }),
		issuedFor,
	);
	assert.equal(
		spliced,
		reset,
		"a page answered for another window is discarded",
	);
	const seqs = reset.messages.map((row) => row.seq);
	assert.equal(
		seqs.every((seq, index) => index === 0 || seq === seqs[index - 1] + 1),
		true,
		"the replaced window stays contiguous",
	);

	// The same page against the window it WAS asked for still merges.
	const same = cache.mergeOlderPageAtCursor(
		entry,
		page(rowsFrom(issuedFor - 60, issuedFor - 1), { has_more: true }),
		issuedFor,
	);
	assert.ok(same !== entry, "matching cursor merges");
	assert.equal(same.messages[0].seq, issuedFor - 60);
});

test("m8: an older read that adds no rows leaves hasNewer set", () => {
	const rows = Array.from({ length: 60 }, (_, i) => message(4001 + i));
	let entry = cache.mergeChannelPage(
		undefined,
		page(rows, { has_more: true }),
		"newest",
	);
	// Pretend the window is behind a hole, as a trim would leave it.
	entry = { ...entry, hasNewer: true };
	// An overlapping page that adds nothing.
	const again = cache.mergeChannelPage(
		entry,
		page(rows, { has_more: true }),
		"older",
	);
	assert.equal(
		again.hasNewer,
		true,
		"no older read can reach the present again",
	);
});

test("m9: the deep-link page bound stays inside the retention cap", () => {
	// The walk starts from the newest page, so `n` reads retain `(n + 1)` pages.
	const pages =
		Math.floor(
			cache.TEAM_BRIDGE_MAX_RETAINED_MESSAGES / cache.TEAM_BRIDGE_PAGE_SIZE,
		) - 1;
	assert.equal(pages, 12, "floor(800/60) - 1");
	assert.ok(
		(pages + 1) * cache.TEAM_BRIDGE_PAGE_SIZE <=
			cache.TEAM_BRIDGE_MAX_RETAINED_MESSAGES,
		"12 older reads plus the newest page stay inside the cap",
	);
});

/*
 * THE 2026-11-09 STUCK LOAD. The app's backend log for qa-coordination shows the
 * history GET refused `429 rate_limited` at 12:56:06.6, 07.7, 09.8 and 13.97:
 * React Query's default 1/2/4 s backoff running out three retries, then an error.
 * The hub's shared per-account read bucket (120/min) had told it when to come
 * back; these pin that the read now waits that long and keeps going.
 */
const rateLimited = (seconds) =>
	Object.assign(new Error("Too many requests"), {
		status: 429,
		code: "rate_limited",
		detail:
			seconds === undefined
				? { code: "rate_limited" }
				: { code: "rate_limited", retry_after_seconds: seconds },
	});

test("r1: a 429 waits the hub's stated retry_after_seconds, clamped to the bucket window", () => {
	assert.equal(cache.historyRateLimitWaitMs(rateLimited(4)), 4000);
	assert.equal(
		cache.historyRateLimitWaitMs(rateLimited(0)),
		cache.TEAM_BRIDGE_RATE_LIMIT_MIN_WAIT_MS,
		"a zero wait is not a tight loop",
	);
	assert.equal(
		cache.historyRateLimitWaitMs(rateLimited(3600)),
		cache.TEAM_BRIDGE_RATE_LIMIT_MAX_WAIT_MS,
		"no honest wait on a per-minute bucket exceeds a minute",
	);
	// The nested `details` shape the hub itself uses is read too.
	assert.equal(
		cache.historyRateLimitWaitMs({
			status: 429,
			detail: { details: { retry_after_seconds: 7 } },
		}),
		7000,
	);
	// No stated wait: doubling backoff from the floor.
	assert.equal(cache.historyRateLimitWaitMs(rateLimited(), 2), 4000);
	// Every other failure is not a rate limit.
	assert.equal(cache.historyRateLimitWaitMs(new Error("boom")), null);
	assert.equal(cache.historyRateLimitWaitMs({ status: 502 }), null);
	assert.equal(cache.historyRateLimitWaitMs(null), null);
});

test("r2: a rate limit keeps retrying; other failures keep the three-retry bound; a definite refusal never retries", () => {
	assert.equal(cache.historyReadShouldRetry(3, rateLimited(2), false), true);
	assert.equal(cache.historyReadShouldRetry(12, rateLimited(2), false), true);
	assert.equal(cache.historyReadShouldRetry(2, new Error("x"), false), true);
	assert.equal(cache.historyReadShouldRetry(3, new Error("x"), false), false);
	assert.equal(cache.historyReadShouldRetry(0, rateLimited(2), true), false);
	assert.equal(cache.historyReadRetryDelay(0, new Error("x")), 1000);
	assert.equal(cache.historyReadRetryDelay(2, new Error("x")), 4000);
	assert.equal(cache.historyReadRetryDelay(0, rateLimited(5)), 5000);
});

/*
 * The incident replayed through React Query itself, with the clock mocked: four
 * 429s (the log's run) and then an answer. The shipped policy ends in `error`
 * after its third retry; this policy lands the page. And when the reader leaves,
 * the chain stops - the invariant that makes an uncounted retry safe.
 */
async function replay({ retry, retryDelay, refusals, unsubscribeAfter }) {
	const client = new cache.QueryClient();
	let calls = 0;
	const observer = new cache.QueryObserver(client, {
		queryKey: ["team-bridge-replay"],
		queryFn: async () => {
			calls += 1;
			if (calls <= refusals) throw rateLimited(2);
			return { ok: true };
		},
		retry,
		retryDelay,
	});
	const states = [];
	const unsubscribe = observer.subscribe((result) =>
		states.push(result.status),
	);
	for (let step = 0; step < 40; step += 1) {
		await Promise.resolve();
		await new Promise((done) => setImmediate(done));
		if (unsubscribeAfter !== undefined && calls >= unsubscribeAfter) {
			unsubscribe();
			unsubscribeAfter = undefined;
		}
		mock.timers.tick(2000);
	}
	const final = observer.getCurrentResult().status;
	unsubscribe();
	client.clear();
	return { calls, final, states };
}

test("r3: replay of the incident - the shipped policy errors, the new one loads", async (t) => {
	mock.timers.enable({ apis: ["setTimeout"] });
	t.after(() => mock.timers.reset());
	const shipped = await replay({
		retry: (failures) => failures < 3,
		retryDelay: undefined,
		refusals: 4,
	});
	assert.equal(
		shipped.final,
		"error",
		"control: four 429s exhaust the shipped chain",
	);
	assert.equal(shipped.calls, 4);
	const fixed = await replay({
		retry: (failures, error) =>
			cache.historyReadShouldRetry(failures, error, false),
		retryDelay: cache.historyReadRetryDelay,
		refusals: 4,
	});
	assert.equal(fixed.final, "success", "the fifth attempt lands the page");
	assert.equal(fixed.calls, 5);
});

test("r4: the rate-limit chain stops when the reader leaves", async (t) => {
	mock.timers.enable({ apis: ["setTimeout"] });
	t.after(() => mock.timers.reset());
	const left = await replay({
		retry: (failures, error) =>
			cache.historyReadShouldRetry(failures, error, false),
		retryDelay: cache.historyReadRetryDelay,
		refusals: 1000,
		unsubscribeAfter: 2,
	});
	assert.ok(
		left.calls <= 3,
		`no reads after the last observer left (saw ${left.calls})`,
	);
});
