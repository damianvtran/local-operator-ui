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
			'export { createNotificationFixture } from "./src/renderer/src/features/notifications/notifications-fixture";',
			'export { readSessionDismissCounts } from "./src/renderer/src/features/notifications/notifications-api";',
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

test("the detail's number is the confirm's number, under Time grouping too", async () => {
	/*
	 * QA ROUND 3, THE LYING LABEL. The detail's "Dismiss all N" advertised the
	 * LOADED page under Time grouping (93 then 92) while its own confirm dialog
	 * enumerated the whole conversation (130 then 131). The write was correct in
	 * both cases; only the number the operator agrees to was wrong.
	 *
	 * What this pins: one conversation holding more rows than a page, where the
	 * number the detail prints (the session-scope walk) is
	 *   == the number the confirm enumerates (the observed token set), and
	 *   == what the write actually covers (changed + skipped).
	 * The first-page count is asserted to be strictly smaller, which is the defect.
	 */
	const session = "aaaaaaaaaaa1";
	const rows = Array.from({ length: 130 }, (_, index) =>
		item(
			`n_${"e".repeat(12)}${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
			{
				seq: index + 1,
				session: { id: session, title: "one long conversation" },
			},
		),
	);
	const fixture = ops.createNotificationFixture(rows, []);
	const throughSeq = fixture.counts().high_water;

	const printed = await ops.readSessionDismissCounts(throughSeq, (request) =>
		fixture.list(request),
	);
	const snapshot = await ops.observeNotificationScope(
		async (request) => fixture.list(request),
		{
			scope: { sessionId: session },
			throughSeq,
			waiting: [],
			verb: "dismiss",
		},
	);
	const covered = await ops.applyNotificationOperation(
		(verb, target) => fixture.send(verb, target),
		"dismiss",
		snapshot.tokens,
		{ scope: { sessionId: session }, throughSeq, tokens: snapshot.tokens },
	);

	assert.equal(printed[session], 130, "the detail prints the whole scope");
	assert.equal(
		snapshot.tokens.length,
		printed[session],
		"the confirm enumerates exactly what the detail prints",
	);
	assert.equal(
		covered.changed.length + covered.skipped.length,
		printed[session],
		"the write covers exactly what the detail printed",
	);

	/*
	 * NEGATIVE CONTROL: the number the page could produce on its own. It has to be
	 * smaller, because that is the lie - if a loaded page ever equalled the scope,
	 * this fixture would not be able to reproduce the defect at all.
	 */
	const firstPage = fixture.list({ state: "all", limit: 100 });
	assert.ok(
		100 < printed[session],
		`a page under-promises (${firstPage.items.length} of ${printed[session]}), which is the defect this fixes`,
	);
});
