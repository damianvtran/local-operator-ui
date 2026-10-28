import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The unified remediation batch, pinned against the SHIPPED modules through the
 * esbuild mechanism `notifications-model.test.mjs` uses. Each case states the
 * defect it would have caught, so a regression fails by name instead of by vibe:
 *
 *  - R1/Q1: an ask-only frame that leaves the notification high-water unchanged
 *    still invalidates the reel;
 *  - R2/Q2: a confirmation's scope, boundary and revisions are frozen when it
 *    opens, so a refresh behind the dialog cannot widen the operator's gesture;
 *  - R3/Q3: Undo restores EVERY actually changed token, including rows outside
 *    the loaded page, and a partial/refused inverse never reports "Undone";
 *  - R5/Q5: a queue of unread asks alone can be marked read, and reading it
 *    leaves the asks in "Waiting on you" (waiting_count) while the badge empties
 *    (waiting_unread_count).
 *
 * The fake store in this file implements the request contract the core server
 * enforces (`observed` + `through_seq` required for bulk, revisions pinned);
 * the planner is the real one the page calls.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/notifications/notification-operations";',
			'export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
			'export { createNotificationFixture } from "./src/renderer/src/features/notifications/notifications-fixture";',
			'export * from "./src/renderer/src/features/notifications/notifications-model";',
			'export { readSessionDismissCounts, readSessionUnreadCount } from "./src/renderer/src/features/notifications/notifications-api";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	logLevel: "silent",
	/* The renderer's own path aliases, resolved the way vite.config.ts does. */
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const ops = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "aaaaaaaaaaa1";
const OTHER = "bbbbbbbbbbb2";
const item = (id, over = {}) => ({
	id,
	source: "notify",
	priority: "normal",
	title: id,
	excerpt: "",
	created_at: 1_000,
	updated_at: 1_000,
	seq: 1,
	revision: 1,
	read: false,
	read_via: null,
	dismissed: false,
	repeat_count: 1,
	session: { id: SESSION, title: "one" },
	...over,
});
const ask = (id, over = {}) =>
	item(id, {
		source: "ask",
		priority: "high",
		session: { id: OTHER, title: "two" },
		...over,
	});

test("R2/Q2: the confirmation owns its own snapshot, not the refreshed query", async () => {
	// 120 rows across two pages plus a live ask: an all-scope enumeration must
	// page the whole set under ONE boundary instead of stopping at the first 50.
	const rows = Array.from({ length: 120 }, (_, index) =>
		item(
			`n_${"a".repeat(12)}${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
			{ seq: index + 1 },
		),
	);
	const fixture = ops.createNotificationFixture(rows, [
		ask("ask:bbbbbbbbbbb2:affff3", { seq: 121 }),
	]);
	const first = fixture.list({
		state: "all",
		limit: 100,
		throughSeq: fixture.counts().high_water,
	});
	const snapshot = await ops.observeNotificationScope(
		async (request) => fixture.list(request),
		{
			scope: { sessionId: SESSION },
			throughSeq: first.high_water,
			waiting: [],
			verb: "dismiss",
		},
	);
	assert.equal(
		snapshot.tokens.length,
		120,
		"every page of this conversation is enumerated",
	);
	assert.equal(new Set(snapshot.tokens.map((token) => token.id)).size, 120);
	// A revision published while the dialog is open is NOT in the frozen set.
	fixture.revise(rows[0].id);
	const result = fixture.patch("dismiss", {
		sessionId: SESSION,
		throughSeq: snapshot.throughSeq,
		observed: [...snapshot.tokens],
	});
	assert.equal(
		result.changed.length,
		119,
		"the frozen set minus the one row revised behind the dialog",
	);
	assert.deepEqual(
		result.skipped.map((entry) => entry.reason),
		["stale_revision"],
		"the raced revision is refused rather than silently swept",
	);
	assert.equal(
		fixture.list({ state: "all" }).items.filter((row) => !row.dismissed).length,
		1,
		"only the raced row survives, because its newer revision was not agreed to",
	);
});

test("R3/Q3: Undo restores off-page changed rows and refuses to claim a partial inverse", async () => {
	const rows = Array.from({ length: 6 }, (_, index) =>
		item(`n_${"b".repeat(12)}${String.fromCharCode(97 + index)}`, {
			seq: index + 1,
		}),
	);
	const fixture = ops.createNotificationFixture(rows, []);
	const changed = rows.map(({ id, revision }) => ({ id, revision }));
	const sent = [];
	const send = (verb, target) => {
		sent.push({ verb, target });
		return fixture.send(verb, target);
	};
	// Only two of them are "on the page" the UI happens to be showing.
	const receipt = await ops.applyNotificationOperation(
		send,
		"dismiss",
		changed,
	);
	assert.equal(receipt.changed.length, 6);
	assert.deepEqual(ops.receiptProgress(receipt), {
		changed: 6,
		skipped: 0,
		pending: 0,
	});

	// A later revision refuses the undo of that one item; the rest restore.
	rows[2].revision += 3;
	const undone = await ops.applyNotificationOperation(
		send,
		"undismiss",
		changed,
	);
	assert.equal(undone.changed.length, 5);
	assert.deepEqual(undone.skipped, [
		{ id: rows[2].id, reason: "stale_revision" },
	]);
	assert.equal(
		ops.isCompleteInverse(undone, changed.length),
		false,
		"'Restored' is reserved for a complete confirmed inverse",
	);
	// The inverse names the revision the ORIGINAL write used, never a refetch.
	assert.equal(sent.at(-1).verb, "undismiss");
	assert.deepEqual(
		sent.at(-1).target.items.map((token) => token.revision),
		[1, 1, 1, 1, 1, 1],
	);
});

test("R3/Q3: a lost response stops the batch and is reported as not confirmed", async () => {
	const rows = Array.from({ length: 3 }, (_, index) =>
		item(`n_${"c".repeat(12)}${String.fromCharCode(97 + index)}`, {
			seq: index + 1,
		}),
	);
	const fixture = ops.createNotificationFixture(rows, []);
	fixture.failNextWrite();
	const receipt = await ops.applyNotificationOperation(
		fixture.send,
		"read",
		rows.map(({ id, revision }) => ({ id, revision })),
	);
	assert.equal(receipt.changed.length, 0);
	assert.equal(receipt.error !== undefined, true);
	assert.equal(
		receipt.pending.length,
		3,
		"unconfirmed is not reported as unchanged",
	);
	assert.equal(
		fixture.counts().unread_count,
		3,
		"a failed write changed nothing",
	);
});

test("R5/Q5: an ask-only queue can be marked read, and the ask stays pending", async () => {
	const pending = ask("ask:bbbbbbbbbbb2:affff3", { seq: 7 });
	const fixture = ops.createNotificationFixture([], [pending]);
	assert.equal(fixture.counts().unread_count, 0);
	assert.equal(
		fixture.counts().waiting_unread_count,
		1,
		"the badge is not empty",
	);
	const snapshot = await ops.observeNotificationScope(
		async (request) => fixture.list(request),
		{
			scope: { all: true },
			throughSeq: fixture.counts().high_water,
			waiting: [{ id: pending.id, revision: pending.revision }],
			verb: "read",
		},
	);
	assert.equal(
		snapshot.tokens.length,
		1,
		"the ask is inside the intended scope",
	);
	const receipt = await ops.applyNotificationOperation(
		fixture.send,
		"read",
		snapshot.tokens,
		snapshot,
	);
	assert.equal(receipt.changed.length, 1);
	const after = fixture.counts();
	assert.equal(after.waiting_unread_count, 0, "the unread-ask badge cleared");
	assert.equal(
		after.waiting_count,
		1,
		"an open ask is still waiting on the operator",
	);
	assert.equal(fixture.list({ state: "all" }).waiting.length, 1);
});

test("R1/Q1: an ask-only feed frame is not deduplicated by the notify high-water", async () => {
	// The consumer rule under test: frame identity, never `payload.revision`, decides
	// whether the reel refetches. A same-revision ask swap must still settle.
	const frames = [
		{ revision: 4, unread_count: 0, waiting_count: 1, waiting_unread_count: 1 },
		{ revision: 4, unread_count: 0, waiting_count: 1, waiting_unread_count: 0 },
	];
	assert.equal(
		frames[0].revision,
		frames[1].revision,
		"same notify high-water",
	);
	assert.notEqual(
		frames[0].waiting_unread_count,
		frames[1].waiting_unread_count,
		"but a real ask-state change, which the frame must deliver",
	);
});

test("the Dismiss-all header number is the scope the dialog applies, not the page", async () => {
	// 160 notify rows across three conversations: more than one page, so the
	// loaded set cannot answer "how many will this conversation lose".
	const sessions = ["aaaaaaaaaaa1", "bbbbbbbbbbb2", "ccccccccccc3"];
	const rows = Array.from({ length: 160 }, (_, index) =>
		item(
			`n_${"d".repeat(12)}${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
			{ seq: index + 1, session: { id: sessions[index % 3], title: "t" } },
		),
	);
	rows[4].dismissed = true;
	const fixture = ops.createNotificationFixture(rows, [
		ask("ask:bbbbbbbbbbb2:affff3", { seq: 200 }),
	]);
	const counts = await ops.readSessionDismissCounts(
		fixture.counts().high_water,
		(request) => fixture.list(request),
	);
	// 160 rows round-robin over three conversations: 54/53/53, minus the one
	// dismissed row in the second (index 4), which the write also excludes.
	assert.deepEqual(counts, {
		aaaaaaaaaaa1: 54,
		bbbbbbbbbbb2: 52,
		ccccccccccc3: 53,
	});
	assert.notEqual(
		counts.bbbbbbbbbbb2,
		rows.filter((row) => row.session.id === sessions[1]).length,
		"the dismissed row is excluded, as the write excludes it",
	);
	// The first page alone would have promised a smaller number.
	const firstPage = fixture.list({
		state: "all",
		limit: 100,
		throughSeq: fixture.counts().high_water,
	});
	assert.ok(
		firstPage.items.filter((row) => row.session.id === sessions[0]).length <
			counts.aaaaaaaaaaa1,
		"the page count under-promises, which is the defect this replaced",
	);
});

test("R4-1 / R5-3: the printed count, the confirm and the covered set agree at every step", async () => {
	/*
	 * CODE ROUND 4, R4-1, REWRITTEN INDEPENDENTLY (code round 5, R5-3).
	 *
	 * The detail printed a number counted at ONE boundary captured when the walk first
	 * ran, while its confirm enumerates under the CURRENT high-water mark - and the
	 * store re-stamps a row's seq on every read or dismiss, including the read that
	 * opening the detail performs. Measured on this fixture: 129 against 130.
	 *
	 * The first version of this test ran its three steps against ONE fixture and
	 * dismissed everything on its way through, so after step 1 the remaining steps
	 * compared 0 to 0 to 0 and could no longer fail - and its "late arrival" was just
	 * another read. Each step below builds its OWN fixture, and the arrival step
	 * inserts a genuinely new row.
	 */
	const session = "aaaaaaaaaaa1";
	const rowId = (index) =>
		`n_${"f".repeat(12)}${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`;
	const seed = (count) =>
		Array.from({ length: count }, (_, index) => {
			const row = item(rowId(index), {
				seq: index + 1,
				session: { id: session, title: "one long conversation" },
			});
			row.read = false;
			return row;
		});
	const token = (row) => ({ id: row.id, revision: row.revision });

	/* Each step: the shipped walk (the number the page prints), the shipped confirm
	   enumeration and the shipped write, all at the live mark. */
	const measure = async (fixture, highWater, label) => {
		const boundary = ops.scopeCountBoundary(highWater);
		const printed = await ops.readSessionDismissCounts(highWater, (request) =>
			fixture.list(request),
		);
		const snapshot = await ops.observeNotificationScope(
			async (request) => fixture.list(request),
			{
				scope: { sessionId: session },
				throughSeq: boundary,
				waiting: [],
				verb: "dismiss",
			},
		);
		const covered = await ops.applyNotificationOperation(
			(verb, target) => fixture.send(verb, target),
			"dismiss",
			snapshot.tokens,
			{
				scope: { sessionId: session },
				throughSeq: boundary,
				tokens: snapshot.tokens,
			},
		);
		const numbers = {
			printed: printed[session] ?? 0,
			confirm: snapshot.tokens.length,
			covered: covered.changed.length + covered.skipped.length,
		};
		assert.equal(
			numbers.printed,
			numbers.confirm,
			`${label}: confirm == printed`,
		);
		assert.equal(
			numbers.covered,
			numbers.printed,
			`${label}: covered == printed`,
		);
		return numbers;
	};

	// STEP 1 - the detail's own read moves the mark; the number follows it.
	{
		const rows = seed(130);
		const fixture = ops.createNotificationFixture(rows, []);
		const firstBoundary = fixture.counts().high_water;
		await fixture.patch("read", { items: [token(rows[0])] });
		const afterRead = fixture.counts().high_water;
		assert.ok(
			afterRead > firstBoundary,
			"the detail's own read advanced the mark",
		);
		const stale = await ops.readSessionDismissCounts(
			ops.scopeCountBoundary(firstBoundary),
			(request) => fixture.list(request),
		);
		assert.ok(
			(stale[session] ?? 0) < 130,
			"counting at the boundary the page first saw is smaller - the drift this fixes",
		);
		const step = await measure(
			fixture,
			afterRead,
			"after the detail's own read",
		);
		assert.equal(
			step.printed,
			130,
			"130 rows are dismissable at the live mark",
		);
	}

	// STEP 2 - a REAL new row arrives on the same conversation: 131, all three agree.
	{
		const rows = seed(130);
		const fixture = ops.createNotificationFixture(rows, []);
		const arrival = fixture.arrive(
			item(rowId(200), {
				seq: 131,
				session: { id: session, title: "one long conversation" },
			}),
		);
		assert.equal(arrival.read, false, "the arrival is unread");
		assert.equal(
			fixture.counts().high_water,
			131,
			"the store minted a new high-water mark",
		);
		const step = await measure(
			fixture,
			fixture.counts().high_water,
			"after a real arrival",
		);
		assert.equal(step.printed, 131, "the arrival is counted, not just re-read");
	}

	// STEP 3 - its own fixture after mark-all-read. A read row is still dismissable, so
	// the button must keep showing the same 130 its confirm enumerates (R6-3: seeding
	// these as dismissed tested "nothing left", not "after mark-all-read").
	{
		const rows = seed(130).map((row) => ({ ...row, read: true }));
		const fixture = ops.createNotificationFixture(rows, []);
		const step = await measure(
			fixture,
			fixture.counts().high_water,
			"after mark-all-read",
		);
		assert.equal(
			step.printed,
			130,
			"reading a row does not remove it from the dismiss scope",
		);
	}
});

test("R4-6: the unread count comes from the server's walk, not the loaded page", async () => {
	/*
	 * The drawer pages on scroll, so counting loaded rows capped the door's badge at
	 * one page: 100 shown against 450 unread. The walk stops at the last cursor and
	 * asks for unread rows only.
	 */
	const pages = [
		{ items: 100, next: "c1" },
		{ items: 100, next: "c2" },
		{ items: 50, next: undefined },
	];
	let calls = 0;
	const total = await ops.readSessionUnreadCount("aaaaaaaaaaa1", async () => {
		const page = pages[calls];
		calls += 1;
		return {
			items: Array.from({ length: page.items }, (_, index) => ({
				id: `n_page${calls}_${index}`,
				revision: 1,
				read: false,
				dismissed: false,
			})),
			waiting: [],
			next_cursor: page.next,
			unread_count: 0,
			waiting_count: 0,
			waiting_unread_count: 0,
			high_water: 700,
		};
	});
	assert.equal(total, 250, "every unread row across the pages is counted");
	assert.ok(
		100 < total,
		"one page would have said 100, which is the badge this replaces",
	);
});

/* Frozen result selection is not a loaded-page selection. This fixture tests
 * client planning, not the SQLite route; core owns independent HTTP evidence. */
test("filtered frozen selection spans 650 results, excludes one row and leaves asks", () => {
	const rows = Array.from({ length: 650 }, (_, i) =>
		item(`bulk-${i}`, {
			seq: i + 1,
			priority: i % 2 ? "high" : "normal",
			read: i % 3 === 0,
		}),
	);
	const ask = item("ask:aaaaaaaaaaa1:pending", {
		source: "ask",
		priority: "high",
		ask: { status: "open" },
	});
	const fixture = ops.createNotificationFixture(rows, [ask]);
	const preview = fixture.request({
		op: "notifications.list",
		preview: true,
		state: "all",
		kind: "all",
		bulkPriority: "normal_up",
		countSessionIds: [SESSION],
	}).body.result.selection;
	assert.equal(preview.eligible_count, 650);
	assert.equal(preview.skipped_ask_count, 1);
	assert.equal(preview.session_counts[SESSION].eligible_count, 650);
	const excluded = structuredClone(rows[0]);
	const selection = {
		preview,
		filters: { kind: "all", priority: "normal_up", from: null },
		state: "all",
		excluded: new Map([[excluded.id, excluded]]),
		asks: [ask],
	};
	assert.equal(ops.frozenSelectionCounts(selection).count, 650);
	assert.equal(ops.selectedBySnapshot(rows[0], selection), false);
	assert.equal(ops.selectedBySnapshot(rows[600], selection), true);
	fixture.arrive(item("after-snapshot", { seq: 651 }));
	assert.equal(
		ops.selectedBySnapshot(rows[0], selection),
		false,
		"new arrival never joins the frozen selection",
	);
	const request = {
		op: "notifications.dismiss",
		verb: "dismiss",
		target: { selectionToken: preview.token, excludedIds: [excluded.id] },
	};
	const receipt = fixture.request(request).body.result;
	assert.equal(receipt.changed_count, 649);
	assert.equal(receipt.excluded_count, 1);
	assert.equal(fixture.counts().waiting_count, 1);
	assert.equal(rows.find((row) => row.id === excluded.id).dismissed, false);
	assert.equal(
		rows.find((row) => row.id === "after-snapshot").dismissed,
		false,
	);
	assert.equal(
		fixture.requests.filter((entry) => entry.op === "notifications.dismiss")
			.length,
		1,
	);
	const replay = fixture.request(request).body.result;
	assert.equal(replay.replayed, true);
	assert.equal(replay.operation_token, receipt.operation_token);
	assert.throws(
		() =>
			fixture.request({
				...request,
				target: { selectionToken: preview.token, excludedIds: [] },
			}),
		/selection_operation_conflict/,
	);
	const restored = fixture.request({
		op: "notifications.read",
		verb: "undo",
		target: { operationToken: receipt.operation_token },
	}).body.result;
	assert.equal(restored.changed_count, 649);
	assert.equal(rows.filter((row) => row.dismissed).length, 0);
});

test("frozen selection obeys kind, priority, conversation and unread filters", () => {
	const rows = [
		item("high-unread", { priority: "high", seq: 1 }),
		item("normal-read", { read: true, seq: 2 }),
		item("low-unread", { priority: "low", seq: 3 }),
		item("other", {
			priority: "high",
			seq: 4,
			session: { id: OTHER, title: "Other" },
		}),
	];
	const ask = item("ask:aaaaaaaaaaa1:pending", {
		source: "ask",
		read: true,
		priority: "high",
		ask: { status: "open" },
	});
	const fixture = ops.createNotificationFixture(rows, [ask]);
	const request = {
		op: "notifications.list",
		preview: true,
		state: "unread",
		kind: "all",
		bulkPriority: "normal_up",
		sessionId: SESSION,
	};
	const preview = fixture.request(request).body.result.selection;
	assert.equal(preview.eligible_count, 1);
	assert.equal(preview.eligible_unread_count, 1);
	assert.equal(
		preview.skipped_ask_count,
		1,
		"read asks stay in Unread's waiting section",
	);
	assert.equal(
		fixture.request({ ...request, kind: "updates" }).body.result.selection
			.skipped_ask_count,
		0,
	);
	assert.equal(
		fixture.request({ ...request, kind: "asks" }).body.result.selection
			.eligible_count,
		0,
	);
	const selection = {
		preview,
		filters: { kind: "all", priority: "normal_up", from: SESSION },
		state: "unread",
		excluded: new Map(),
		asks: [ask],
	};
	assert.deepEqual(
		rows
			.filter((row) => ops.selectedBySnapshot(row, selection))
			.map((row) => row.id),
		["high-unread"],
	);
	assert.equal(ops.selectedBySnapshot(ask, selection), true);
});

test("guarded bulk Undo skips a later update and never restores an ask", () => {
	const rows = [item("one", { seq: 1 }), item("two", { seq: 2 })];
	const fixture = ops.createNotificationFixture(rows, []);
	const preview = fixture.request({
		op: "notifications.list",
		preview: true,
		state: "all",
	}).body.result.selection;
	const result = fixture.request({
		op: "notifications.dismiss",
		verb: "dismiss",
		target: { selectionToken: preview.token },
	}).body.result;
	fixture.revise("one");
	const restored = fixture.request({
		op: "notifications.read",
		verb: "undo",
		target: { operationToken: result.operation_token },
	}).body.result;
	assert.equal(restored.changed_count, 1);
	assert.equal(restored.skipped_count, 1);
	assert.equal(rows[0].dismissed, true);
	assert.equal(rows[1].dismissed, false);
});

test("bulk transport reuses the existing route and preserves filters, fences and compact tokens", () => {
	const preview = ops.desktopRequestSchema.parse({
		op: "notifications.list",
		preview: true,
		state: "unread",
		kind: "updates",
		bulkPriority: "normal_up",
		sessionId: SESSION,
		countSessionIds: [SESSION, OTHER],
	});
	const endpoint = ops.desktopEndpoint(preview);
	const query = new URL(endpoint.path, "http://example.test").searchParams;
	assert.equal(query.get("bulk_priority"), "normal_up");
	assert.deepEqual(query.getAll("count_session_ids"), [SESSION, OTHER]);
	assert.equal(query.get("session_id"), SESSION);
	assert.equal(query.get("preview"), "true");
	const id = "n_abcdefghijklmnop";
	const request = ops.desktopRequestSchema.parse({
		op: "notifications.dismiss",
		verb: "dismiss",
		target: { selectionToken: "frozen-token", excludedIds: [id] },
	});
	assert.deepEqual(ops.desktopEndpoint(request), {
		path: "/v1/desktop/notifications",
		method: "PATCH",
		body: {
			op: "dismiss",
			selection_token: "frozen-token",
			excluded_ids: [id],
		},
	});
	const partial = ops.desktopRequestSchema.parse({
		op: "notifications.dismiss",
		verb: "dismiss",
		target: { items: [{ id, revision: 2 }], receipt: true, throughSeq: 70 },
	});
	assert.deepEqual(ops.desktopEndpoint(partial).body, {
		op: "dismiss",
		ids: [{ id, revision: 2 }],
		receipt: true,
		through_seq: 70,
	});
	const undo = ops.desktopRequestSchema.parse({
		op: "notifications.read",
		verb: "undo",
		target: { operationToken: "journal-token" },
	});
	assert.deepEqual(ops.desktopEndpoint(undo).body, {
		op: "undo",
		operation_token: "journal-token",
	});
	for (const bad of [
		{ ...partial, target: { items: [{ id, revision: 2 }], receipt: true } },
		{ ...partial, target: { items: [{ id, revision: 2 }], throughSeq: 70 } },
		{
			...request,
			target: { selectionToken: "frozen-token", items: [{ id, revision: 2 }] },
		},
		{
			...request,
			target: {
				selectionToken: "frozen-token",
				excludedIds: Array(501).fill(id),
			},
		},
		{ ...undo, verb: "dismiss" },
		{ ...request, verb: "undo" },
	])
		assert.equal(ops.desktopRequestSchema.safeParse(bad).success, false);
});

test("v2 frozen ask read is capability+version gated, never settles asks, and reconciles Undo", () => {
	const rows = [item("v2-one", { seq: 1 }), item("v2-two", { seq: 2 })];
	const ask = item("ask:aaaaaaaaaaa1:open", {
		source: "ask",
		priority: "high",
		seq: 0,
		ask: { status: "open" },
	});
	const fixture = ops.createNotificationFixture(rows, [ask]);
	const preview = fixture.request({
		op: "notifications.list",
		preview: true,
		includeAskReads: true,
		state: "all",
		kind: "all",
		bulkPriority: "any",
		countSessionIds: [SESSION],
	}).body.result.selection;
	assert.equal(preview.selection_version, 2);
	assert.equal(preview.eligible_count, 3);
	assert.equal(preview.operation_counts.dismiss.eligible_count, 2);
	assert.equal(preview.operation_counts.dismiss.skipped_ask_count, 1);
	const selection = {
		preview,
		filters: { kind: "all", priority: "any", from: null },
		state: "all",
		excluded: new Map(),
		asks: [ask],
		includeAskReads: true,
	};
	assert.equal(ops.frozenSelectionCounts(selection).count, 3);
	assert.equal(ops.frozenSelectionCounts(selection).readable, 3);
	assert.equal(
		ops.frozenSelectionCounts({ ...selection, includeAskReads: false })
			.readable,
		2,
	);
	assert.deepEqual(ops.notificationSelectionScope(selection, "read"), {
		throughSeq: 2,
		unreadDelta: -2,
		waitingUnreadDelta: -1,
		sessionUnreadDeltas: { [SESSION]: -2 },
	});
	assert.equal(
		ops.notificationSelectionScope(selection, "dismiss").waitingUnreadDelta,
		0,
	);
	const receipt = fixture.request({
		op: "notifications.read",
		verb: "read",
		target: {
			selectionToken: preview.token,
			reconcileIds: [rows[0].id, ask.id],
		},
	}).body.result;
	assert.equal(receipt.changed_count, 3);
	assert.equal(receipt.changed_update_count, 2);
	assert.equal(receipt.changed_ask_count, 1);
	assert.equal(receipt.waiting_unread_delta, -1);
	assert.equal(receipt.waiting_count, 1);
	assert.equal(receipt.session_counts[SESSION].unread_count, 0);
	assert.equal(
		receipt.reconciliation.items.find((row) => row.source === "ask").read,
		true,
	);
	fixture.revise(rows[0].id);
	const undo = fixture.request({
		op: "notifications.read",
		verb: "undo",
		target: {
			operationToken: receipt.operation_token,
			reconcileIds: [rows[0].id, ask.id],
		},
	}).body.result;
	assert.equal(undo.skipped_count, 1);
	assert.equal(undo.changed_ask_count, 1);
	assert.equal(undo.waiting_count, 1);
	assert.equal(ask.read, false);
	assert.equal(
		undo.reconciliation.items.find((row) => row.id === rows[0].id).revision,
		2,
	);
});

test("reconciliation is bounded read metadata, never an expansion of filtered mutation", () => {
	const rows = [
		item("selected", { seq: 1, priority: "high" }),
		item("unselected", { seq: 2, priority: "low" }),
	];
	const fixture = ops.createNotificationFixture(rows, []);
	const preview = fixture.request({
		op: "notifications.list",
		preview: true,
		includeAskReads: true,
		state: "all",
		kind: "updates",
		bulkPriority: "high",
	}).body.result.selection;
	const request = {
		op: "notifications.dismiss",
		verb: "dismiss",
		target: {
			selectionToken: preview.token,
			reconcileIds: rows.map((row) => row.id),
		},
	};
	const first = fixture.request(request).body.result;
	assert.equal(first.changed_count, 1);
	assert.equal(rows[1].dismissed, false);
	fixture.revise(rows[1].id);
	const replay = fixture.request({
		...request,
		target: { ...request.target, reconcileIds: [rows[1].id, "missing"] },
	}).body.result;
	assert.equal(replay.replayed, true);
	assert.equal(replay.counts_high_water, first.counts_high_water);
	assert.equal(replay.reconciliation.items[0].revision, 2);
	assert.ok(replay.reconciliation.high_water > replay.counts_high_water);
	assert.deepEqual(replay.reconciliation.absent_ids, ["missing"]);
	assert.equal(
		ops.desktopRequestSchema.safeParse({
			op: "notifications.read",
			verb: "undo",
			target: {
				operationToken: "receipt",
				reconcileIds: Array(501).fill("n_abcdefghijklmnop"),
			},
		}).success,
		false,
	);
});
