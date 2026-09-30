import assert from "node:assert/strict";
import { test } from "node:test";
import {
	FakeJournal,
	PAGE_LIMIT,
	Reader,
	kindOf,
	loadModules,
	shape,
} from "./loader-journal-fixture.mjs";

/*
 * THE PAGER CURSOR IS A FIRST-CLASS FACT, NOT AN ACCIDENT OF WHICH ENTRY
 * HAPPENS TO BE A RECORD.
 *
 * Operator report: "I can't scroll past that" - the reader sat three pages deep
 * in a 1233-entry conversation, three "load earlier" asks each fetched the same
 * page, nothing changed on screen, and the pump believed every ask succeeded.
 * Reproduced against the real journal with the backend's own page reader and the
 * real reducer (design spec `loader-state-machine.md` section 0, cases E5/E6/E7);
 * this file is that reproduction made permanent on a journal whose entry KINDS
 * follow the real one (`fixtures/loader-journal-shape.json`, no private text).
 *
 * The mechanism, in one paragraph: `applyHistoryPage` derived the cursor by
 * looking the page's first entry up among the store's RECORDS. At 7 of the 11
 * page boundaries of that journal the entry is not a record (a silent
 * `session_spend.v1` custom, or a `tool` entry that is keyed `tool:<callId>`), so
 * the lookup failed and the rule fell through to "adopt the page's first entry" -
 * which for a re-applied TAIL page is the newest page's first entry. The cursor
 * jumped back to the tail, every later ask re-fetched rows the reader already
 * held, the reducer returned an identical state, and the ask resolved `true`.
 */

const { reducer: m } = await loadModules();

const journal = () => FakeJournal.fromShape();

/** Pages of the journal as a cold reader walking back would receive them. */
function walk(j) {
	const pages = [];
	let before = null;
	for (;;) {
		const page = j.page(before);
		pages.push(page);
		if (!page.has_more || page.entries.length === 0) break;
		before = page.entries[0].id;
	}
	return pages;
}

/** Apply pages 0..k the way the loader does (page 0 first, the rest as continuations). */
function readerDeep(pages, k) {
	let s = m.applyHistoryPage(m.EMPTY_TRANSCRIPT, pages[0]);
	for (let i = 1; i <= k; i++)
		s = m.applyHistoryPage(s, pages[i], {
			pagedBefore: pages[i - 1].entries[0].id,
		});
	return s;
}

test("the fixture reproduces the real journal's boundary mix", () => {
	// A precondition, not a behaviour: if the generator stopped putting silent and
	// tool entries on the page boundaries, every case below would pass vacuously.
	const j = journal();
	assert.equal(j.length, shape.entries);
	const pages = walk(j);
	assert.equal(pages.length, Math.ceil(shape.entries / PAGE_LIMIT));
	const boundaries = pages.slice(1).map((page) => kindOf(page.entries[0]));
	const nonRecord = boundaries.filter(
		(kind) => kind === "tool" || kind === "custom:session_spend.v1",
	);
	assert.ok(
		nonRecord.length >= 5,
		`boundaries that are not message records: ${JSON.stringify(boundaries)}`,
	);
});

test("E5a: re-applying a changed tail page never moves the cursor of a reader k pages deep", () => {
	const j = journal();
	const pages = walk(j);
	// The tail must have CHANGED (a live turn landed): an identical tail page is
	// swallowed by the reducer's no-change early return and proves nothing.
	j.append(["user", "assistant:0:1"]);
	const grownTail = j.page(null);
	const regressed = [];
	for (let k = 1; k < pages.length; k++) {
		const s = readerDeep(pages, k);
		const after = m.applyHistoryPage(s, grownTail); // snapshot / reconcile: no keepPaging
		if (after.oldestId !== s.oldestId || after.hasMore !== s.hasMore)
			regressed.push(
				`k=${k} cursor ${String(s.oldestId).slice(-6)}->${String(after.oldestId).slice(-6)} hasMore ${s.hasMore}->${after.hasMore}`,
			);
	}
	assert.deepEqual(
		regressed,
		[],
		"a tail-type read regressed the cursor of a reader who was already deeper",
	);
});

test("E5b: a fully loaded conversation does not grow a dead 'load earlier' after a tail re-apply", () => {
	const pages = walk(journal());
	const s = readerDeep(pages, pages.length - 1);
	assert.equal(s.hasMore, false, "precondition: everything is loaded");
	const after = m.applyHistoryPage(s, pages[0]);
	assert.equal(
		after.hasMore,
		false,
		"hasMore flipped false -> true on a reconnect snapshot",
	);
	assert.equal(after.oldestId, s.oldestId, "the cursor regressed to the tail");
});

test("E5c: a continuation page of only silent entries still advances the cursor", () => {
	const pages = walk(journal());
	let s = m.applyHistoryPage(m.EMPTY_TRANSCRIPT, pages[0]);
	const silent = {
		entries: Array.from({ length: PAGE_LIMIT }, (_, i) => ({
			id: `silent-${String(i).padStart(6, "0")}`,
			ts: 1_780_000_000 + i,
			type: "custom",
			payload: { custom_type: "session_spend.v1", details: {} },
		})),
		has_more: true,
		cursor_missing: false,
	};
	const anchor = s.oldestId;
	const after = m.applyHistoryPage(s, silent, { pagedBefore: anchor });
	assert.equal(
		after.oldestId,
		silent.entries[0].id,
		"the next ask would repeat the same before_id: an all-silent page did not move the cursor",
	);
	assert.equal(after.hasMore, true);
	s = after;
});

test("E5d: a continuation page whose rows are all already held still advances the cursor", () => {
	const pages = walk(journal());
	// Page 2's rows are held (a wider earlier read), but the cursor is still at
	// page 1's first entry - the state a regression leaves behind.
	let s = readerDeep(pages, 1);
	s = m.applyHistoryPage(s, pages[2], { keepPaging: true });
	const cursor = s.oldestId;
	assert.equal(
		cursor,
		pages[1].entries[0].id,
		"precondition: cursor at page 1",
	);
	const after = m.applyHistoryPage(s, pages[2], { pagedBefore: cursor });
	assert.equal(
		after.oldestId,
		pages[2].entries[0].id,
		"an already-held page returned the identical state and the cursor stayed put",
	);
});

test("E6: after a reconnect re-applies a changed tail, the reader still reaches the start without repeating an ask", async () => {
	const j = journal();
	const reader = new Reader(m, j).open();
	for (let i = 0; i < 3; i++) await reader.loadOlder();
	// The conversation grows (a live turn), the socket reconnects, and the
	// snapshot applies the NEW tail page (`use-canonical-session.ts`, no keepPaging).
	j.append([
		"user",
		"assistant:0:1",
		"custom:session_spend.v1",
		"assistant:0:1",
	]);
	reader.reapplyTail();

	const from = reader.requests.length;
	const asks = await reader.loadAll(24);
	const mine = reader.requests.slice(from);
	const repeated = mine.filter(
		(request, i) => i > 0 && request.before === mine[i - 1].before,
	);
	assert.deepEqual(
		repeated.map((r) => String(r.before).slice(-6)),
		[],
		"consecutive asks carried the same before_id: the dead zone",
	);
	assert.equal(reader.transcript.hasMore, false, "never reached the start");
	assert.ok(
		asks <= Math.ceil(j.length / PAGE_LIMIT),
		`took ${asks} asks for ${j.length} entries`,
	);
	// Everything the journal would render is held, none of it twice.
	const held = new Set(reader.transcript.records.map((r) => r.id));
	for (const id of reader.fullRecordIds())
		assert.ok(held.has(id), `record ${id} never loaded`);
});

test("compact_file deleting the cursor entry: the next click continues from where the reader was", async () => {
	/*
	 * `compact_file` keeps every MESSAGE entry and only the newest
	 * `session_spend.v1` (spec section 0, E7): 5 of the real journal's 12 page
	 * boundaries are droppable. The backend then answers the vanished `before_id`
	 * with `cursor_missing` plus THE CURRENT TAIL. The pre-fix re-anchor went to
	 * the tail page's own first entry, so a reader N pages deep re-walked N
	 * already-held pages one click at a time.
	 */
	const j = journal();
	const reader = new Reader(m, j).open();
	// Go deep enough that the cursor lands on a droppable spend entry.
	let deep = 0;
	while (reader.transcript.hasMore && deep < 12) {
		await reader.loadOlder();
		deep += 1;
		const cursor = j.entries.find((e) => e.id === reader.transcript.oldestId);
		if (
			deep >= 3 &&
			cursor &&
			kindOf(cursor) === "custom:session_spend.v1" &&
			cursor.id !==
				j.entries.findLast((e) => kindOf(e) === "custom:session_spend.v1").id
		)
			break;
	}
	const cursorId = reader.transcript.oldestId;
	assert.equal(
		kindOf(j.entries.find((e) => e.id === cursorId)),
		"custom:session_spend.v1",
		"precondition: the cursor is a droppable spend entry",
	);
	assert.ok(reader.transcript.hasMore, "precondition: not at the start yet");
	const heldBefore = reader.transcript.records.length;

	const gone = j.compact();
	assert.ok(gone.includes(cursorId), "compaction removed the reader's cursor");

	const outcome = await reader.loadOlder();
	assert.equal(outcome.kind, "applied", JSON.stringify(outcome));
	assert.ok(
		reader.transcript.records.length > heldBefore,
		`the click after compaction loaded nothing new (${heldBefore} -> ${reader.transcript.records.length} records): it re-fetched a page the reader already held`,
	);

	await reader.loadAll(24);
	assert.equal(reader.transcript.hasMore, false);
	const held = new Set(reader.transcript.records.map((r) => r.id));
	for (const id of reader.fullRecordIds())
		assert.ok(held.has(id), `record ${id} never loaded after compaction`);
});
