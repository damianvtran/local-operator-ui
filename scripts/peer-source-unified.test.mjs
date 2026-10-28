import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE UNIFIED PEER-SOURCE CONSUMER'S CONTRACT CELLS.
 *
 * WHAT THIS FILE IS. The architect's executable repro of 2026-10-13
 * (`s1-native-reducer-repro.mjs`/`.json`, scratchpad of session
 * 4f1b4dd131d8) drove the SHIPPED reducer against the S1 head (6775d9b43f)
 * and pinned four readings, all reproduced byte-for-byte in this session's
 * scratchpad (`red-baseline-6775d9b43f.json`):
 *
 *   1. a facts-only lookup STRIPPED a held echo's provisional/local flags and
 *      stamped coordinates onto it (and the authority page stamped a stale
 *      body with the new generation while discarding the fresh one);
 *   2. a recovery delta's declared family was IGNORED - the new text was
 *      painted under the OLD coordinate with no debt and no demand, and the
 *      repair guard could block forever;
 *   3. a `reset` delta dropped an UNRELATED held row;
 *   4. a family arriving before any domain minted nothing, so the guard
 *      blocked it permanently.
 *
 * The cells below are those readings, flipped: each one names the RED reading
 * it pins and asserts the corrected behavior through the shipped functions,
 * because the corrected behavior is the specification the freeze is judged
 * against. The lane rules apply to DECLARED peer commits
 * (`peerSource`/`applyPeerSourceFacts`/`applyPeerSourcePayload`, or a delta
 * carrying the family keys); the local lane's inherited semantics have their
 * own control cells at the bottom and are expected to be byte-compatible.
 *
 * HOW. Same harness as `transcript-journal-order.test.mjs`: the shipped
 * modules bundled in memory by esbuild, plain state-in/state-out cells.
 * Assertions are on the transcript a commit produced and on the requests a
 * sweep dispatched - never on a helper's internals.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/transcript-reducer"; export * from "./src/renderer/src/features/chat/canonical/journal-order"; export * from "./src/renderer/src/features/chat/canonical/journal-order-repair"; export * from "./src/shared/desktop-contract"; export * from "./src/shared/journal-order-query";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@shared/i18n": "./src/i18n",
	},
	write: false,
});
const R = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const msg = (id, role = "user", text = id) => ({
	id,
	role,
	content: [{ type: "text", text }],
	tool_calls: [],
});
const row = (id, seq, ts = 100 - (seq ?? 0), payload = msg(id)) => ({
	id,
	type: "message",
	ts,
	payload,
	journal_seq: seq,
});
const page = (entries, generation = "scope-A", extra = {}) => ({
	entries,
	has_more: false,
	cursor_missing: false,
	...(generation === undefined ? {} : { journal_generation: generation }),
	journal_order_state: "ready",
	...extra,
});
/** A payload-subset entry: fresh body + the same-read coordinate. */
const entry = (id, text, seq, ts = 100) => ({
	id,
	type: "message",
	ts,
	payload: msg(id, "user", text),
	...(seq === undefined ? {} : { journal_seq: seq }),
});
const open = () =>
	R.applyHistoryPage(R.EMPTY_TRANSCRIPT, page([row("seed", 0)]), {
		authoritative: true,
		peerSource: true,
	});
const byId = (state, id) => state.records.find((record) => record.id === id);

/* ------------------------------------------------ 1. facts are not a body */

test("RED-1 flipped: a facts-only lookup neither reattests nor releases; the payload body does both", () => {
	let state = open();
	state = R.appendPendingUser(state, "held", "held echo", [], 1000);
	const orderRead = R.journalOrderRead(state);
	state = R.applyJournalOrderLookup(
		state,
		page([], "scope-A", { journal_ordinals: { held: 3 } }),
	);
	/*
	 * RED reading 1: the S1 lookup wrote `sourceEntryId`/`journalSeq`/
	 * `journalGeneration` onto the hold and deleted `provisional`/`local` on
	 * coordinates alone. Facts rank; nothing about a body changed.
	 */
	const heldAfterFacts = byId(state, "held");
	assert.equal(heldAfterFacts.provisional, true);
	assert.equal(heldAfterFacts.local, true);
	assert.equal(heldAfterFacts.sourceEntryId, undefined);
	assert.equal(heldAfterFacts.journalSeq, undefined);
	assert.equal(heldAfterFacts.journalGeneration, undefined);
	// The fact still ranks it (placement is the lookup's whole purpose) and the
	// body is on the debt book.
	assert.deepEqual(R.journalBodyOwedIds(state), ["held"]);
	assert.equal(R.journalOrderRead(state).revision, orderRead.revision);
	/*
	 * The payload subset: fresh body + same-read coordinate, ONE commit. It is
	 * the body read that releases the hold and writes the verified stamp.
	 */
	state = R.applyPeerSourcePayload(
		state,
		page([entry("held", "held echo", 3)], "scope-A", {
			source_present_ids: ["held"],
			source_missing_ids: [],
			source_unavailable_ids: [],
			source_remaining_ids: [],
		}),
	);
	const admitted = byId(state, "held");
	assert.equal(admitted.provisional, undefined);
	assert.equal(admitted.local, undefined);
	assert.equal(admitted.journalSeq, 3);
	assert.equal(admitted.journalGeneration, "scope-A");
	assert.deepEqual(R.journalBodyOwedIds(state), []);
});

test("RED-1 flipped (authority): the page's fresh body is never discarded for the old one, and rotation owes every loaded row", () => {
	let state = open();
	// Rotation: the owner rebuilt under scope-B; the authority bootstrap may
	// install the domain but must not stamp the LOADED body with it.
	state = R.applyPeerSourceFacts(state, page([], "scope-B"), {
		authoritative: true,
	});
	assert.equal(state.journalGeneration, "scope-B");
	const seed = byId(state, "seed");
	assert.equal(seed.text, "seed");
	assert.equal(seed.journalGeneration, "scope-A"); // its body was read under A
	assert.deepEqual(R.journalBodyOwedIds(state), ["seed"]);
	// Only the payload body admits it, under B, with its own coordinate.
	state = R.applyPeerSourcePayload(
		state,
		page([entry("seed", "seed", 0)], "scope-B", {
			source_present_ids: ["seed"],
		}),
	);
	assert.equal(byId(state, "seed").journalGeneration, "scope-B");
	assert.deepEqual(R.journalBodyOwedIds(state), []);
});

/* --------------------------------------- 2. the declared family, consumed */

test("RED-2 flipped: an accepted family admits atomically with true entry times and settles without any supporting wake", () => {
	let state = open();
	state = R.applyEvent(
		state,
		{
			type: "history_delta",
			messages: [msg("same", "user", "DELTA NEW BODY")],
			journal_generation: "scope-A",
			journal_ordinals: { same: 9 },
			entry_times: { same: 1700000100 },
		},
		5000,
	);
	const admitted = byId(state, "same");
	assert.equal(admitted.text, "DELTA NEW BODY");
	assert.equal(admitted.journalSeq, 9);
	assert.equal(admitted.journalGeneration, "scope-A");
	// The owner-stamped entry time, not the arrival second.
	assert.equal(admitted.ts, 1_700_000_100_000);
	assert.equal(state.orderNeedsReconcile ?? false, false);
	assert.deepEqual(R.journalBodyOwedIds(state), []);
});

test("RED-2 flipped: a family-less peer row keeps its fresh text but NO rank claim, owed until a verified body read", () => {
	let state = open();
	state = R.applyEvent(
		state,
		{
			type: "history_delta",
			messages: [
				msg("gap", "user", "unattested text"),
				msg("seed", "user", "seed replaced by the gap replay"),
			],
		},
		5000,
	);
	const painted = byId(state, "gap");
	assert.equal(painted.text, "unattested text");
	assert.equal(painted.journalGeneration, undefined);
	assert.equal(painted.journalSeq, undefined);
	assert.deepEqual(R.journalBodyOwedIds(state), ["gap", "seed"]);
	// And a row whose OLD admission would have covered the NEW text loses it
	// (the stale stamp must not survive a replaced body).
	assert.equal(byId(state, "seed").text, "seed replaced by the gap replay");
	assert.equal(byId(state, "seed").journalGeneration, undefined);
});

test("RED-2 flipped (mismatch): another domain's family paints owed bodies and mints the bootstrap demand instead of mixing ranks", () => {
	let state = open();
	state = R.applyEvent(
		state,
		{
			type: "history_delta",
			messages: [msg("newgen", "user", "NEW GENERATION BODY")],
			journal_generation: "scope-B",
			journal_ordinals: { newgen: 4 },
			entry_times: { newgen: 1700000100 },
		},
		5000,
	);
	const painted = byId(state, "newgen");
	assert.equal(painted.text, "NEW GENERATION BODY");
	assert.equal(painted.journalGeneration, undefined);
	assert.equal(painted.journalSeq, undefined);
	assert.equal(painted.ts, 5000); // arrival; the unaccepted family's time is not used
	assert.equal(state.orderNeedsReconcile, true);
	assert.equal(state.orderWantedGeneration, "scope-B");
	assert.ok(R.journalBodyOwedIds(state).includes("newgen"));
	// The coalesced authority read installs; the payload admits under it.
	state = R.applyPeerSourceFacts(state, page([], "scope-B"), {
		authoritative: true,
	});
	assert.equal(state.journalGeneration, "scope-B");
	state = R.applyPeerSourcePayload(
		state,
		page([entry("newgen", "NEW GENERATION BODY", 4, 1700000100)], "scope-B", {
			source_present_ids: ["newgen"],
		}),
	);
	const fresh = byId(state, "newgen");
	assert.equal(fresh.journalGeneration, "scope-B");
	assert.equal(fresh.journalSeq, 4);
	assert.equal(fresh.ts, 1_700_000_100_000);
});

/* --------------------------------------------------- 3. reset preservation */

test("RED-3 flipped: a peer reset preserves unrelated held rows; the local lane keeps the inherited replacement", () => {
	const build = (peerSource) => {
		let state = R.applyHistoryPage(R.EMPTY_TRANSCRIPT, page([row("same", 2)]), {
			authoritative: true,
			peerSource,
		});
		state = R.appendPendingUser(state, "held", "held echo", [], 1000);
		return R.applyEvent(
			state,
			{
				type: "history_delta",
				reset: true,
				messages: [msg("same", "user", "RESET NEW BODY")],
				...(peerSource
					? {
							journal_generation: "scope-A",
							journal_ordinals: { same: 9 },
							entry_times: { same: 1700000100 },
						}
					: {}),
			},
			5000,
		);
	};
	const peer = build(true);
	assert.ok(peer.records.some((record) => record.id === "held"));
	assert.equal(byId(peer, "held").provisional, true);
	const same = byId(peer, "same");
	assert.equal(same.text, "RESET NEW BODY");
	assert.equal(same.journalSeq, 9); // the reset's accepted family admits atomically
	assert.equal(same.ts, 1_700_000_100_000);
	const local = build(false);
	// The inherited local behavior is documented, not inherited into the lane.
	assert.ok(!local.records.some((record) => record.id === "held"));
});

/* --------------------------------------------- 4. the bootstrap demand */

test("RED-4 flipped: a family before any domain mints the bootstrap demand; the repair guard sees debt, not a block", () => {
	const state = R.applyEvent(
		R.EMPTY_TRANSCRIPT,
		{
			type: "history_delta",
			messages: [msg("new-raw", "user", "new row")],
			journal_generation: "g1",
			journal_ordinals: { "new-raw": 9 },
			entry_times: { "new-raw": 1700000100 },
		},
		5000,
	);
	assert.equal(state.orderNeedsReconcile, true);
	assert.equal(state.orderWantedGeneration, "g1");
	assert.deepEqual(R.journalBodyOwedIds(state), ["new-raw"]);
	const guardWouldReturn =
		!state.orderNeedsReconcile &&
		(!state.journalGeneration || R.journalLookupIds(state).length === 0);
	assert.equal(guardWouldReturn, false);
});

/* ------------------------------------ 5. missing / unavailable / remaining */

test("proven-missing settles as void without fabrication; unavailable and remaining stay owed and distinct", () => {
	let state = R.applyHistoryPage(
		R.EMPTY_TRANSCRIPT,
		page([row("a", 1), row("b", 2), row("c", 3)]),
		{ authoritative: true, peerSource: true },
	);
	state = R.applyEvent(
		state,
		{ type: "history_delta", messages: [msg("a"), msg("b"), msg("c")] },
		5000,
	);
	assert.deepEqual(R.journalBodyOwedIds(state).sort(), ["a", "b", "c"]);
	state = R.applyPeerSourcePayload(
		state,
		page([], "scope-A", {
			source_present_ids: [],
			source_missing_ids: ["a"],
			source_unavailable_ids: ["b"],
			source_remaining_ids: ["c"],
		}),
	);
	// missing: settled, and never re-asked without a new causal fact
	assert.deepEqual(R.journalBodyOwedIds(state).sort(), ["b", "c"]);
	assert.ok(state.journalSourceVoid.has("a"));
	assert.ok(!R.journalLookupIds(state).includes("a"));
	// unavailable/remaining: still owed, still distinct from absence
	assert.ok(R.journalLookupIds(state).includes("b"));
	assert.ok(R.journalLookupIds(state).includes("c"));
	// and nothing was fabricated onto the missing row: it keeps only its own
	// sourceEntryId (its identity, written by the merge every delta row passes
	// through) and NO coordinate the missing answer never gave it.
	const a = byId(state, "a");
	assert.equal(a.journalGeneration, undefined);
	assert.equal(a.journalSeq, undefined);
});

test("a ready answer retires the truthful-unavailable latch; unsupported does not arm anything", () => {
	let state = R.markSourceUnavailable(open(), true);
	assert.equal(state.journalSourceUnavailable, true);
	state = R.applyPeerSourceFacts(state, page([], "scope-A"), {
		authoritative: false,
	});
	assert.equal(state.journalSourceUnavailable, undefined);
	// unsupported is intrinsic: the reducer was never told to arm it, and the
	// commit of an unsupported answer must not invent one.
	state = R.applyPeerSourceFacts(
		{ ...state, journalSourceUnavailable: undefined },
		{
			entries: [],
			has_more: false,
			cursor_missing: false,
			journal_order_state: "unsupported",
		},
		{ authoritative: false },
	);
	assert.equal(state.journalSourceUnavailable, undefined);
});

/* --------------------------------------------------- 6. the sweep's walk */

test("the peer sweep walks facts before bodies, honours the explicit smaller-batch retry once, and a none-sweep dispatches nothing", async () => {
	let state = open();
	state = R.applyEvent(
		state,
		{ type: "history_delta", messages: [msg("gap"), msg("gap2")] },
		5000,
	);
	const dispatched = [];
	const deps = {
		getTranscript: () => state,
		isCurrent: () => true,
		read: async (requested, kind) => {
			dispatched.push({ kind, requested });
			/*
			 * THE RESPONSE IS THE SHAPE THE LOOP'S `page`/`commit` CONTRACT
			 * DECLARES: `{kind, page}`. A bare page here made `page(response)` read
			 * `response.journal_order_state` off a page and then hand `undefined` to
			 * `applyPeerSourcePayload`, so the sweep saw one apply and completed
			 * (leading here to the one-read `['lookup']` outcome).
			 */
			if (kind === "lookup")
				return {
					kind,
					page: page([], "scope-A", {
						journal_ordinals: Object.fromEntries(
							requested.map((id) => [id, 200]),
						),
					}),
				};
			if (dispatched.filter((call) => call.kind === "payload").length === 1)
				return {
					kind,
					page: page([], "scope-A", {
						source_present_ids: [],
						source_missing_ids: [],
						source_unavailable_ids: [],
						source_remaining_ids: requested,
						source_retry_ids: requested.slice(0, 1),
					}),
				};
			return {
				kind,
				page: page(
					requested.map((id) => entry(id, id, 200)),
					"scope-A",
					{ source_present_ids: requested },
				),
			};
		},
		page: (response) => response.page,
		lookupPath: "/v1/desktop/sessions/aaaaaaaaaaaa",
		commit: (response, revision, orderRead) => {
			if (R.currentOrderRevision(state) !== revision) return;
			if (response.kind === "payload")
				state = R.applyPeerSourcePayload(state, response.page, orderRead);
			else if (response.kind === "lookup")
				state = R.applyPeerSourceFacts(state, response.page, {
					authoritative: false,
				});
		},
		sweep: (s) => {
			const shape = (kind, query) => ({
				kind,
				path: `/v1/desktop/sessions/aaaaaaaaaaaa${kind === "authority" ? "" : "/history"}`,
				query,
			});
			if (s.orderNeedsReconcile === true)
				return shape("authority", new URLSearchParams({ journal_order: "1" }));
			if (typeof s.journalGeneration !== "string")
				return shape("none", new URLSearchParams());
			if (R.journalFactsNeeded(s).length > 0)
				return shape(
					"lookup",
					new URLSearchParams({ source_read: "metadata" }),
				);
			if (R.journalBodyOwedIds(s).length > 0)
				return shape(
					"payload",
					new URLSearchParams({ source_read: "payload" }),
				);
			return shape("none", new URLSearchParams());
		},
	};
	const outcome = await R.repairJournalOrder(deps);
	assert.equal(outcome.kind, "complete");
	assert.deepEqual(
		dispatched.map((call) => call.kind),
		["lookup", "payload", "payload"],
	);
	// the retry carried the owner's explicit smaller batch, not the full set
	assert.deepEqual(dispatched[2].requested, ["gap"]);
	// ...and everything it left budget-deferred stays owed, distinct from missing
	assert.deepEqual(R.journalBodyOwedIds(state), ["gap2"]);
	// A SETTLED conversation dispatches NOTHING - never a dead authority read.
	const beforeNone = dispatched.length;
	const settledState = open();
	const settled = await R.repairJournalOrder({
		...deps,
		getTranscript: () => settledState,
		commit: () => {},
	});
	assert.equal(settled.kind, "complete");
	assert.equal(dispatched.length, beforeNone);
});

/* ------------------------------------------------------- 7. local controls */

test("local control: the authority commit keeps its inherited stamping and release, and the local lookup is not the peer's", () => {
	let state = R.applyHistoryPage(R.EMPTY_TRANSCRIPT, page([row("a", 1)]), {
		authoritative: true,
	});
	state = R.appendPendingUser(state, "held", "held echo", [], 1000);
	state = R.applyJournalOrderMetadata(
		state,
		page([], "scope-A", { journal_ordinals: { held: 5 } }),
		R.journalOrderRead(state),
	);
	const held = byId(state, "held");
	assert.equal(held.journalSeq, 5);
	assert.equal(held.journalGeneration, "scope-A");
	assert.equal(held.provisional, undefined);
	assert.equal(state.journalPeerSource, undefined);
});

test("local control: an undeclared merge carries no peer state onto the transcript", () => {
	const state = R.applyHistoryPage(
		R.EMPTY_TRANSCRIPT,
		page([row("plain", 1)], "scope-A"),
		{ authoritative: true },
	);
	assert.equal(state.journalPeerSource, undefined);
	assert.equal(state.journalBodyOwed, undefined);
	assert.equal(state.journalSourceVoid, undefined);
	assert.deepEqual(R.journalBodyOwedIds(state), []);
});

/* ------------------------------------------------------ 8. wire discipline */

test("the payload purpose is emitted only with its domain fence; metadata keeps its optional one", () => {
	const withFence = R.desktopEndpoint({
		op: "sessions.history",
		sessionId: "aaaaaaaaaaaa",
		journalOrder: true,
		sourceRead: "payload",
		expectedJournalGeneration: "gen",
	});
	assert.ok(withFence.path.includes("source_read=payload"));
	assert.ok(withFence.path.includes("expected_journal_generation=gen"));
	const withoutFence = R.desktopEndpoint({
		op: "sessions.history",
		sessionId: "aaaaaaaaaaaa",
		journalOrder: true,
		sourceRead: "payload",
	});
	assert.ok(!withoutFence.path.includes("source_read"));
	const metadata = R.desktopEndpoint({
		op: "sessions.history",
		sessionId: "aaaaaaaaaaaa",
		journalOrder: true,
		sourceRead: "metadata",
	});
	assert.ok(metadata.path.includes("source_read=metadata"));
});
