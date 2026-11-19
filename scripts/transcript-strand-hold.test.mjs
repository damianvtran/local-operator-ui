import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * A SEND WHOSE ROWS THE READER'S WINDOW AGES PAST: the exchange must render in
 * its own time slot, not pinned under everything the pane loads afterwards.
 *
 * THE REPORT (operator, 2026-10-11): in session `9c59d684d16b` the "push it to
 * my private github" exchange (19:00) rendered at the TRAILING edge of the
 * conversation — below content more than 40 minutes newer — on every re-open.
 * The store's journal was correctly ordered; the terminal state was the tail
 * block's. A desktop send mints a provisional echo (`appendPendingUser`) and
 * the hold discharges ONLY by carriage — a merge carrying the echo's own
 * durable row. For a send that ages out of the loaded window before any such
 * merge arrives, none ever comes: tail reads never reach its row, a
 * `history_delta` excludes it (the send WAS streamed, so "rows that were never
 * streamed here" filters it out), and `sealDisjointBlock` refuses echoes while
 * dropping the durable block around them. The block then holds the exchange
 * below ALL placed rows — forever.
 *
 * THE FIX THESE PIN (`releasedEchoes`, `transcript-reducer.ts`): a CONTIGUOUS
 * OWNER WINDOW (a page read; never a delta, never a seed) whose OLDEST entry is
 * strictly newer than the echo's stamp — the window is journal-older than its
 * whole range, so the send cannot be "after everything here" — with
 * an owner-stated row older than the echo and ANY row newer than it already
 * in the pane, falsifies the hold's ranking premise and the echo ranks by its
 * own stamp. The newer row may itself be another local echo, not acceptance
 * evidence. The scan uses the PRE-merge pane: a first newer row supplied by
 * this page qualifies only on a later page read, pinned below. The window does
 * NOT have to lie beyond everything the pane holds: the operator's own pane
 * was CURRENT — it streamed the send's replies and the rows after them while
 * they looked — and a rule keyed on the pane being behind never fired for
 * that shape (the manager's `replay4.mjs`, pinned below). Carriage still
 * returns the owner's exact slot. These tests pin the discharge, the
 * live-tail shape, the named skew trade-off, the healthy carriage path it
 * must not regress, the delta door it must not open, and the healing page
 * that lands the owner's row into the slot.
 *
 * THE FIXTURE IS THE REAL SESSION, not a hand-made one.
 * `scripts/fixtures/stranded-send-order.json` is session `9c59d684d16b`'s
 * journal (`~/.local-operator/sessions/9c59d684d16b/transcript.jsonl`, 913
 * lines) and the page payloads the manager captured from the operator's live
 * backend for the same session. Windows are named by JOURNAL LINE, 1-based:
 *
 *   - `held` is lines 306..400 (idx 305..399) — the pane's held page before the
 *     send, taken from the same session's `chain-3` capture (lines 306..405)
 *     sliced to the entries that existed when the pane still showed them;
 *   - `send` is line 401 (idx 400) — the message itself, `40313bde-5907-42fc-
 *     97d7-40687c7e9517` at 19:00:41.97;
 *   - `exchange` is lines 402..435 (idx 401..434) — the live stream's rows, the
 *     exchange the operator's session produced, folded as LIVE events (their
 *     record ids, tool call ids and clocks are the journal's own);
 *   - `stream` is lines 436..621 (idx 435..620) — the rows the pane streamed
 *     AFTER the exchange while the send was still held (the operator's pane
 *     was watching live when they looked), folded as live events the same way;
 *     the live-tail pin below folds these after the exchange, which is the
 *     manager's `replay4.mjs` shape;
 *   - `newer` is lines 506..605 (idx 505..604, 19:06:05..19:24:03) and
 *     `newer2` is lines 606..705 (idx 605..704, 19:29:14..20:03:08) — the
 *     entirely-newer page reads, `chain-1` and `chain-0` captured verbatim
 *     (payloads, `has_more`, order). These are the reads that landed over the
 *     stranded exchange and pinned it under 40+ minutes of newer content.
 *
 * THE TRANSFORMS APPLIED TO THE JOURNAL/PAGE BYTES, all of them, because a
 * file presented as the journal verbatim has to say what it changed: ids, `ts`,
 * entry `type`, roles, tool call ids, tool names, `stop_reason`, `duration_s`
 * and order are untouched. Text blocks have newlines collapsed to single spaces
 * and are truncated to 60 characters; a `tool_calls` argument member whose JSON
 * is longer than 60 characters is dropped (the argument OBJECT is kept, its
 * long strings are not); `provider_payload` is narrowed to `duration_s`;
 * `usage` is dropped; painting custom rows are verbatim, payload included. The
 * SILENT custom types (`frontend_state_checkpoint_v1`, `session_state`,
 * `hub_communication`, `wake_schedule`, `prune` — `SILENT_CUSTOM_TYPES`, which
 * project to NO record) are narrowed to their identity (id/ts/type/
 * custom_type) because their payloads are 80-100 KB each and paint nothing; no
 * assertion here depends on them. Only arrangement, ids and `ts` are asserted,
 * and none of them depends on the narrowing.
 *
 * WHAT THIS PROVES: the record ORDER the shipped reducer ends with for that
 * real held page, that real streamed exchange and those real page reads —
 * including the `sealDisjointBlock` the reconcile path runs after them, and the
 * load-earlier page that carries the send and returns it to its exact slot.
 * WHAT IT DOES NOT PROVE: anything about the pixels —
 * `docs/evidence/chat-stranded-hold-order/` carries the rendered pair, captured
 * with this repo's own `scripts/capture-evidence.mjs` from
 * `stranded-hold-order.stories.tsx`, which renders both orders over this same
 * fixture. A fresh app open of a copied session CANNOT show the disorder and is
 * not a substitute for the pair: the disorder is born of the send and lives in
 * the in-memory transcript state, so the pair over this fixture through the
 * production component is the faithful capture (the README says so in the
 * reader's words).
 *
 * THE ts-COLLISION PIN (operator ask, same report): where a re-sort could
 * invert a message and its own sidecar — an equal-or-micro-earlier sidecar `ts`
 * like `session_spend.v1`'s, rounded to the same millisecond — the pair must
 * keep journal order in every reachable merge/re-read order. The audit these
 * pin with measurements:
 *
 *   - `session_spend.v1` rows ARE the reported shape AND NEVER BECOME RECORDS:
 *     a journal entry with `type: "custom"` and no supplement envelope is
 *     dropped by `durableRecord` (measured on this fixture's own spend row,
 *     `d8294bce8b874bb5925de8c069864b33`, ts 98 ms EARLIER than the assistant
 *     row it follows — it paints nothing, so its ts can invert nothing);
 *   - among RECORD-PRODUCING sidecar classes, the strict-earlier `ts` shape is
 *     not reachable: a fleet scan of 3,320 session journals (2026-10-11) found
 *     ZERO adjacent record-producing pairs whose `ts` steps backwards — tool
 *     results trail their call by +0.01..+2 ms and supplements follow their
 *     anchor by +300..500 ms — so the reachable collision is the SAME-MS TIE
 *     (a sub-millisecond offset rounds to one instant), and ties keep the
 *     order they already had: the position the row was admitted at, which is
 *     journal order when the pair is first admitted together. These pins do
 *     NOT cover a newer sidecar admitted by a tail page before its earlier
 *     anchor arrives on a backward page. The architect reported a surviving
 *     inversion in that shape; journal-ordinal handling is a separate required
 *     follow-up, not something these replay pins prove. The tests
 *     below pin the tie stable across a page, a re-read, a seed replay and a
 *     delta;
 *   - the one shape that DOES invert a strict-earlier pair (a same-page
 *     [message, sidecar] sorted by `ts` alone, measured: the sidecar lands
 *     above its message) is the sort doing what the doctrine says it does —
 *     "a row the seed dates from a real clock belongs where that time
 *     belongs" — and no reachable producer stamps a record-producing sidecar
 *     before its message, per the scan above. A forced tie-break for the
 *     relation (sidecar after message) would have to be a comparator case,
 *     and the doctrine refuses exactly that class: the relations are not a
 *     total order, and "any pairwise rule that honours both asks closes a
 *     cycle" (`withTimeOrder`'s docblock). Recorded, not special-cased.
 */

const bundle = await build({
	stdin: {
		contents:
			'export { EMPTY_TRANSCRIPT, applyEvent, applyHistoryPage, appendPendingUser, sealDisjointBlock } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
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
const reducer = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	EMPTY_TRANSCRIPT,
	applyEvent,
	applyHistoryPage,
	appendPendingUser,
	sealDisjointBlock,
} = reducer;

const FIXTURE = JSON.parse(
	readFileSync(
		new URL("./fixtures/stranded-send-order.json", import.meta.url),
		"utf8",
	),
);

const SEND_ID = FIXTURE.send.id;

/** One history page in the wire shape `applyHistoryPage` reads. */
const pageOf = ({ entries }) => ({
	entries,
	has_more: true,
	cursor_missing: false,
});

/**
 * A journal row as the live events the stream delivered.
 *
 * The mapping mirrors the runtime's own frames for these rows (the shapes in
 * the manager's `sse-frames.json` capture): an assistant row starts, its
 * declared calls start, and a row with content settles with the journal's own
 * text; a tool row settles with its result; a user row starts and ends. Each
 * frame is applied at the row's own journal instant (`ts` in ms) — the
 * reader's arrival clock for a live row is the moment it landed, and these
 * rows landed as they were journaled.
 */
const foldRows = (state, rows) => {
	let next = state;
	for (const row of rows) {
		const now = Math.round(row.ts * 1000);
		const p = row.payload ?? {};
		if (p.role === "assistant") {
			const call = {
				role: "assistant",
				content: [],
				tool_calls: [],
				tool_call_id: null,
				tool_name: null,
				is_error: false,
				stop_reason: null,
				usage: null,
				input_mode: null,
				input_path: null,
				provider_payload: null,
				id: row.id,
			};
			next = applyEvent(next, { type: "message_start", message: call }, now);
			for (const declared of p.tool_calls ?? []) {
				next = applyEvent(
					next,
					{
						type: "tool_execution_start",
						tool_call_id: declared.id,
						tool_name: declared.name,
						args: declared.arguments,
					},
					now,
				);
			}
			if (p.content?.length) {
				next = applyEvent(
					next,
					{ type: "message_end", message: { ...p, id: row.id } },
					now,
				);
			}
		}
		if (p.role === "tool") {
			next = applyEvent(
				next,
				{
					type: "tool_execution_end",
					tool_call_id: p.tool_call_id,
					tool_name: p.tool_name,
					result: { content: p.content, is_error: false },
				},
				now,
			);
		}
		if (p.role === "user") {
			next = applyEvent(
				next,
				{
					type: "message_start",
					message: { role: "user", content: p.content ?? [], id: row.id },
				},
				now,
			);
			next = applyEvent(
				next,
				{ type: "message_end", message: { ...p, id: row.id } },
				now,
			);
		}
	}
	return next;
};

/** The record id a journal row paints under: tool rows key by their call. */
const recordKeyOf = (row) => {
	const p = row.payload ?? {};
	return p.role === "tool" && p.tool_call_id
		? `tool:${p.tool_call_id}`
		: row.id;
};

/** The exchange's record ids, which the tail block must be holding. */
const exchangeKeys = () => [SEND_ID, ...FIXTURE.exchange.rows.map(recordKeyOf)];

/**
 * The page that CARRIES the send — the one read that ends the hold by
 * carriage. Its entries are the session's own `chain-3` window (journal lines
 * 306..405): the `held` page's entries are that window's head and the send and
 * its first four replies are its tail, so the composition here is the page
 * itself, spelled from the fixture's own windows.
 */
const carryingPage = () => ({
	entries: [
		...FIXTURE.held.entries,
		{
			id: FIXTURE.send.id,
			ts: FIXTURE.send.ts,
			type: "message",
			payload: {
				kind: "message",
				role: "user",
				content: [{ type: "text", text: FIXTURE.send.text }],
			},
		},
		...FIXTURE.exchange.rows.slice(0, 4),
	],
	has_more: true,
	cursor_missing: false,
});

/** The state every test starts from: the held page, the send, its exchange. */
const strand = () => {
	let state = applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(FIXTURE.held));
	state = appendPendingUser(
		state,
		SEND_ID,
		FIXTURE.send.text,
		[],
		Math.round(FIXTURE.send.ts * 1000),
	);
	state = foldRows(state, FIXTURE.exchange.rows);
	return state;
};

/** The operator's ACTUAL shape: the send, its exchange, and the stream after it. */
const liveTail = () => foldRows(strand(), FIXTURE.stream.rows);

const ids = (state) => state.records.map((r) => r.id);
const positionOf = (state, id) => state.records.findIndex((r) => r.id === id);

test("the stranded exchange leaves the tail block and renders in its time slot, seal and all", () => {
	let state = strand();
	// The premise the disorder needs: the hold is standing, and every row the
	// exchange painted is being kept in the block.
	const echoBefore = state.records.find((r) => r.id === SEND_ID);
	assert.equal(
		echoBefore.provisional,
		true,
		"the send is held before the window",
	);
	assert.equal(echoBefore.local, true, "and it is still this app's echo");

	// The entirely-newer page reads land, as the session's reconcile walk read
	// them: both windows are strictly beyond everything the pane holds.
	state = applyHistoryPage(state, pageOf(FIXTURE.newer));
	state = applyHistoryPage(state, pageOf(FIXTURE.newer2));
	const echo = state.records.find((r) => r.id === SEND_ID);
	assert.equal(
		echo.provisional,
		undefined,
		"the window that lies beyond the pane discharges the hold",
	);
	assert.equal(
		echo.local,
		true,
		"delivery is untouched: the row is still this app's unconfirmed echo",
	);

	/*
	 * THE REPORT, as an order assertion: every row of the exchange sits BEFORE
	 * every row of both newer windows. On the base reducer this fails — the
	 * echo and the streamed exchange land at the trailing edge, under rows
	 * 40+ minutes newer (the manager's `replay2.mjs` is this exact shape).
	 */
	const newerKeys = new Set([
		...FIXTURE.newer.entries.map((e) => e.id),
		...FIXTURE.newer2.entries.map((e) => e.id),
	]);
	const firstNewer = state.records.findIndex((r) => newerKeys.has(r.id));
	const exchangePositions = exchangeKeys()
		.filter((id) => state.index.has(id))
		.map((id) => positionOf(state, id));
	assert.ok(firstNewer > 0, "the newer windows are painted");
	for (const [at, position] of exchangePositions.entries())
		assert.ok(
			position < firstNewer,
			`exchange row ${at} renders in its slot (position ${position} < first newer at ${firstNewer})`,
		);

	// And the seal the reconcile path runs after the walk must not take the
	// reader's own message with it, nor re-pin it: the echo survives, at its
	// slot, and the surviving list is time-ordered.
	const sealed = sealDisjointBlock(
		state,
		{
			id: FIXTURE.newer.entries[0].id,
			ts: Math.round(FIXTURE.newer.entries[0].ts * 1000),
		},
		new Set(FIXTURE.newer.entries.map((e) => e.id)),
	);
	const sealedEcho = sealed.records.find((r) => r.id === SEND_ID);
	assert.ok(sealedEcho, "the seal keeps the reader's own message");
	const sealedFirstNewer = sealed.records.findIndex((r) => newerKeys.has(r.id));
	assert.ok(
		positionOf(sealed, SEND_ID) < sealedFirstNewer,
		"after the seal the echo still renders above the newer windows, not at the trailing edge",
	);
	for (let i = 1; i < sealed.records.length; i++)
		assert.ok(
			sealed.records[i].ts >= sealed.records[i - 1].ts,
			`the surviving order is time-ordered (decrease at ${i}: ${sealed.records[i - 1].id} -> ${sealed.records[i].id})`,
		);

	// Loading backwards over the stranded region heals it into the journal
	// slot: the carrying page lands the owner's own row (carriage), which
	// replaces the echo — `local` and `provisional` both gone — between the
	// held page's rows and the send's first reply.
	const healed = applyHistoryPage(sealed, pageOf(carryingPage()));
	const carried = healed.records.find((r) => r.id === SEND_ID);
	assert.equal(carried.local, undefined, "the owner's row replaces the echo");
	assert.equal(carried.provisional, undefined);
	const sendPos = positionOf(healed, SEND_ID);
	const heldPresent = FIXTURE.held.entries
		.map(recordKeyOf)
		.filter((key) => healed.index.has(key));
	const lastHeldPos = Math.max(
		...heldPresent.map((key) => positionOf(healed, key)),
	);
	assert.ok(
		sendPos > lastHeldPos,
		"the carried send sits after the last held row still painted",
	);
	const replyKeys = new Set(
		FIXTURE.exchange.rows.map(recordKeyOf).filter((key) => key !== SEND_ID),
	);
	for (const [at, record] of healed.records.entries())
		if (replyKeys.has(record.id))
			assert.ok(
				at > sendPos,
				`exchange row ${record.id} renders after the carried send`,
			);
});

/*
 * THE LIVE-TAIL PIN (manager's replay4, and the operator's actual shape).
 *
 * The operator's pane was CURRENT when they looked: it streamed the send's
 * replies and the rows after them, so the entirely-newer page reads landed on
 * a pane whose OWN newest row was newer still. The round-1 rule required the
 * window's oldest to lie strictly beyond every row the pane holds, which a
 * current pane never satisfies (its newest row is "now" while every window's
 * oldest is minutes back) — this shape stayed pinned on that rule, and stays
 * pinned on the base, while the window's oldest is strictly newer than the
 * echo's stamp all along: the window is journal-older than its whole range,
 * so the send cannot be "after everything here". Whether the window lands
 * beyond the pane or among rows it already streamed is immaterial to that
 * proof.
 */
test("a CURRENT pane streaming past the send is released too: the live-tail shape", () => {
	let state = liveTail();
	assert.equal(
		state.records.find((r) => r.id === SEND_ID).provisional,
		true,
		"the send starts held",
	);
	state = applyHistoryPage(state, pageOf(FIXTURE.newer));
	state = applyHistoryPage(state, pageOf(FIXTURE.newer2));
	const echo = state.records.find((r) => r.id === SEND_ID);
	assert.equal(
		echo.provisional,
		undefined,
		"the first entirely-newer window releases the hold",
	);
	/*
	 * The rows to clear: the windows' records the stream never carried (the
	 * `newer2` half past the stream's own cut, journal 621..704). Every
	 * exchange row must render before the first of them, and the released
	 * order must carry no ts inversion at all — on the base the exchange sits
	 * under those rows and the list steps back in ts at the echo.
	 */
	const streamedKeys = new Set([
		...FIXTURE.exchange.rows.map(recordKeyOf),
		...FIXTURE.stream.rows.map(recordKeyOf),
	]);
	const windowOnly = FIXTURE.newer2.entries
		.map(recordKeyOf)
		.filter((key) => state.index.has(key) && !streamedKeys.has(key));
	assert.ok(
		windowOnly.length > 0,
		"the fixture carries window rows the stream never had",
	);
	const firstWindowOnly = Math.min(
		...windowOnly.map((key) => positionOf(state, key)),
	);
	for (const row of FIXTURE.exchange.rows) {
		const key = recordKeyOf(row);
		if (!state.index.has(key)) continue;
		assert.ok(
			positionOf(state, key) < firstWindowOnly,
			`exchange row ${key} renders before the newer windows' rows`,
		);
	}
	for (let at = 1; at < state.records.length; at += 1)
		assert.ok(
			state.records[at].ts >= state.records[at - 1].ts,
			"the released order carries no ts inversion",
		);
});

/*
 * THE NAMED SKEW TRADE-OFF (`releasedEchoes`' docblock names it beside the
 * rule): an owner whose clock runs AHEAD of this renderer's can stamp a
 * PRE-send page row past the pane's own span while the pane already carries a
 * post-send row. The window's oldest is journal-older than the send, but its
 * STAMP is newer, and the discharge cannot see the journal — it ranks by the
 * stamps, so that pre-send row sits below the echo. This is the SAME end
 * state the pre-fix code reached the moment a carriage dissolved the block
 * ("everything sorts by owner instants" once no provisional row remains);
 * the discharge only moves that flip earlier. It is pinned so the cost is
 * named rather than discovered, and so the shapes where NOTHING about the
 * send is provable stay fail-safe on the other conjuncts (their own pins are
 * in `transcript-reducer.test.mjs`).
 */
test("the named skew trade: a pre-send row stamped past the pane ranks by its stamp", () => {
	const CLIENT_NOW = TIE_MS;
	const cached = {
		id: "cached-before",
		ts: (CLIENT_NOW - 300_000) / 1000,
		type: "message",
		payload: {
			kind: "message",
			...assistant("cached-before", "an older answer"),
		},
	};
	const skewed = {
		id: "skewed-pre-send",
		ts: (CLIENT_NOW + 40_000) / 1000,
		type: "message",
		payload: {
			kind: "message",
			...assistant("skewed-pre-send", "journaled before the send"),
		},
	};
	let state = applyHistoryPage(EMPTY_TRANSCRIPT, pageOf({ entries: [cached] }));
	state = appendPendingUser(state, "trade-send", "sent now", [], CLIENT_NOW);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistant("trade-answer", "") },
		CLIENT_NOW + 3_000,
	);
	state = applyHistoryPage(state, pageOf({ entries: [skewed] }));
	assert.equal(
		state.records.find((r) => r.id === "trade-send").provisional,
		undefined,
		"the window (oldest newer than the echo's stamp, pane spanning the send) discharges",
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["cached-before", "trade-send", "trade-answer", "skewed-pre-send"],
		"the skewed pre-send row ranks by its stamp — the named trade",
	);
	// The destination the pre-fix code reached at carriage is this same order:
	// once no provisional row remains, everything sorts by owner instants.
	state = applyHistoryPage(
		state,
		pageOf({
			entries: [
				{
					id: "trade-send",
					ts: (CLIENT_NOW + 1_000) / 1000,
					type: "message",
					payload: { kind: "message", ...user("trade-send", "sent now") },
				},
			],
		}),
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["cached-before", "trade-send", "trade-answer", "skewed-pre-send"],
		"carriage lands the owner's row and the order is the one the trade already showed",
	);
});

// These are documentation pins for the existing pre-merge scan, not a heal:
// incoming rows cannot witness their own release, and delivery is independent.
test("the first newer page keeps the hold until a later qualifying page read", () => {
	const now = TIE_MS;
	const entry = (id, ts) => ({
		id,
		ts: ts / 1000,
		type: "message",
		payload: { kind: "message", ...assistant(id, "owner row") },
	});
	let state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf({ entries: [entry("quiet-before", now - 50_000)] }),
	);
	state = appendPendingUser(state, "quiet-send", "send", [], now);
	const newer = pageOf({ entries: [entry("quiet-newer", now + 200_000)] });
	state = applyHistoryPage(state, newer);
	assert.equal(
		state.records.find((r) => r.id === "quiet-send").provisional,
		true,
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["quiet-before", "quiet-newer", "quiet-send"],
	);
	state = applyHistoryPage(state, newer);
	assert.equal(
		state.records.find((r) => r.id === "quiet-send").provisional,
		undefined,
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["quiet-before", "quiet-send", "quiet-newer"],
	);
	assert.strictEqual(
		applyHistoryPage(state, newer),
		state,
		"the later replay is idempotent",
	);
});

test("another pending echo can supply the newer-side witness without proving acceptance", () => {
	const now = TIE_MS;
	const entry = (id, ts) => ({
		id,
		ts: ts / 1000,
		type: "message",
		payload: { kind: "message", ...assistant(id, "owner row") },
	});
	let state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		pageOf({ entries: [entry("two-before", now - 50_000)] }),
	);
	state = appendPendingUser(state, "two-first", "first send", [], now);
	state = appendPendingUser(
		state,
		"two-second",
		"second send",
		[],
		now + 100_000,
	);
	state = applyHistoryPage(
		state,
		pageOf({ entries: [entry("two-newer", now + 200_000)] }),
	);
	const first = state.records.find((r) => r.id === "two-first");
	assert.equal(
		first.provisional,
		undefined,
		"the second local echo witnesses the newer side",
	);
	assert.equal(first.local, true, "release is not delivery confirmation");
	assert.equal(
		state.records.find((r) => r.id === "two-second").provisional,
		true,
		"the latest echo has no pre-merge newer witness",
	);
	assert.deepEqual(
		state.records.map((r) => r.id),
		["two-before", "two-first", "two-newer", "two-second"],
	);
});

test("the window that carries the send ends the hold as it always did", () => {
	let state = strand();
	state = applyHistoryPage(state, pageOf(carryingPage()));
	const echo = state.records.find((r) => r.id === SEND_ID);
	assert.equal(echo.local, undefined, "the durable row replaces the echo");
	assert.equal(echo.provisional, undefined, "the hold ends by carriage");
	const sendPos = positionOf(state, SEND_ID);
	const heldPresent = FIXTURE.held.entries
		.map(recordKeyOf)
		.filter((key) => state.index.has(key));
	assert.ok(
		sendPos > Math.max(...heldPresent.map((key) => positionOf(state, key))),
		"the send lands after the rows that preceded it",
	);
	const firstReplyKey = FIXTURE.exchange.rows
		.map(recordKeyOf)
		.find((key) => state.index.has(key));
	assert.ok(firstReplyKey, "the exchange painted at least one row");
	assert.ok(
		sendPos < positionOf(state, firstReplyKey),
		"and before its own first reply",
	);
});

test("a delta is not a window: its newer rows cannot discharge the hold", () => {
	let state = strand();
	/*
	 * A `history_delta` is a FILTERED id set — "rows that were never streamed
	 * here" — and the send WAS streamed, so the filter excludes it while it can
	 * carry post-send rows. That is exactly the door the discharge must not
	 * open: `applyHistoryPage` is called with `statedByOwner: false` for a
	 * non-reset delta, and the discharge refuses it.
	 */
	state = applyEvent(
		state,
		{
			type: "history_delta",
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "a row entirely newer than the send" },
					],
					tool_calls: [],
					id: "delta-newer-row",
				},
			],
		},
		Math.round(FIXTURE.newer.entries.at(-1).ts * 1000) + 60_000,
	);
	const echo = state.records.find((r) => r.id === SEND_ID);
	assert.equal(echo.provisional, true, "the delta cannot discharge the hold");
	assert.ok(
		positionOf(state, "delta-newer-row") > positionOf(state, SEND_ID),
		"and its row joins the block below the echo, as before",
	);
});

/*
 * THE ts-COLLISION PIN.
 *
 * The pair under test is a message and its same-millisecond sidecar — the
 * sidecar's own `ts` a hair EARLIER, rounding to the message's instant (the
 * shape `session_spend.v1` carries; see the file header for why that exact row
 * paints nothing and which record-producing pairs are reachable). The order to
 * keep is the journal's: message, then sidecar. Ties keep the position the row
 * was admitted at, and every admission path admits the journal order — a page
 * in entry order, a seed in event order, a delta in its `messages` order — so
 * the pair must hold across a first read, a re-read, a seed replay and a delta
 * merge alike.
 */
const CLIENT_NOW = 1_790_000_000_000;
const TIE_MS = CLIENT_NOW;
const assistant = (id, text) => ({
	role: "assistant",
	content: text ? [{ type: "text", text }] : [],
	tool_calls: [],
	id,
});
const user = (id, text) => ({
	role: "user",
	content: [{ type: "text", text }],
	tool_calls: [],
	id,
});
const tiedMessage = {
	id: "tied-message",
	ts: TIE_MS / 1000,
	type: "message",
	payload: {
		kind: "message",
		role: "assistant",
		content: [{ type: "text", text: "the message" }],
		tool_calls: [{ id: "call-sidecar", name: "bash", arguments: {} }],
	},
};
const tiedSidecar = {
	id: "tied-sidecar",
	// 0.4 ms EARLIER than the message and rounded to the same instant.
	ts: (TIE_MS - 0.4) / 1000,
	type: "message",
	payload: {
		kind: "message",
		role: "tool",
		content: [{ type: "text", text: "the sidecar's result" }],
		tool_call_id: "call-sidecar",
		tool_name: "bash",
	},
};

test("a page-admitted message and its same-millisecond sidecar keep order through replays", () => {
	assert.equal(
		Math.round(tiedMessage.ts * 1000),
		Math.round(tiedSidecar.ts * 1000),
		"the fixture is a tie: the sidecar's sub-millisecond lead rounds away",
	);
	const page = pageOf({ entries: [tiedMessage, tiedSidecar] });
	// The tool row's RECORD KEY is its call (`tool:<call_id>`), and that is the
	// spelling every order assertion below reads.
	const order = ["tied-message", "tool:call-sidecar"];
	let state = applyHistoryPage(EMPTY_TRANSCRIPT, page);
	assert.deepEqual(ids(state), order, "the page read paints journal order");

	// A re-read of the same page changes no order (and is the same state).
	const again = applyHistoryPage(state, page);
	assert.deepEqual(ids(again), order, "the re-read keeps the order");

	// A reconnect seed replaying the same rows keeps the order.
	state = applyEvent(
		state,
		{
			type: "message_start",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "the message" }],
				tool_calls: [{ id: "call-sidecar", name: "bash", arguments: {} }],
				id: "tied-message",
			},
		},
		CLIENT_NOW + 5_000,
	);
	assert.deepEqual(ids(state), order, "the seed replay keeps the order");

	// A delta carrying the same pair keeps the order.
	state = applyEvent(
		state,
		{
			type: "history_delta",
			messages: [
				{ ...tiedMessage.payload, id: "tied-message" },
				{ ...tiedSidecar.payload, id: "tied-sidecar" },
			],
		},
		CLIENT_NOW + 6_000,
	);
	assert.deepEqual(ids(state), order, "the delta keeps the order");

	// The pair does not participate in any inversion either: re-applying BOTH
	// merges must still leave the journal order standing.
	state = applyHistoryPage(state, page);
	assert.deepEqual(
		ids(state),
		order,
		"a full re-read after every merge keeps the order",
	);
});

test("the operator's named sidecar class paints no record at all", () => {
	/*
	 * `session_spend.v1`: `type: "custom"` with no supplement envelope, so
	 * `durableRecord` returns null — the row never enters the record list, in
	 * a page OR a delta. This is the fixture's own spend row, whose `ts` is
	 * 98 ms EARLIER than the assistant row it follows (journal line 436): a
	 * ts-sort can only invert pairs that are IN the list.
	 */
	const spend = FIXTURE.exchange.rows.find(
		(row) => row.payload?.custom_type === "session_spend.v1",
	);
	assert.ok(spend, "the fixture carries the real spend row");
	const before = applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(FIXTURE.held));
	const after = applyHistoryPage(before, pageOf({ entries: [spend] }));
	assert.equal(
		after.records.length,
		before.records.length,
		"a silent custom paints no record through the page door",
	);
	assert.equal(after.index.has(spend.id), false);
});
