/**
 * The per-session paint cache: the rows a conversation was last seen with, so a
 * notification click can paint it instead of showing a skeleton.
 *
 * WHY IT EXISTS. The click's target is "the user can read the transcript", and
 * the transcript otherwise arrives from the backend's snapshot — a subscribe, a
 * bridge acquire, a cold attach and a 100-row history page, 0.5-1.5 s on this
 * machine. The rows are already in this window's memory for any conversation
 * the user has looked at, so the fast path paints those first and lets the
 * authoritative snapshot reconcile them underneath.
 *
 * IT CANNOT EXIST FOR A RECREATED WINDOW, and saying so is part of the design
 * rather than a limitation to work around: closing the last window destroys the
 * renderer, and this cache lives in the renderer. A click that recreates a
 * window always takes the skeleton branch. That is what makes the two click
 * cases two different latency claims instead of one averaged one.
 *
 * WHAT IS NOT CACHED, each for a reason that is about correctness rather than
 * size:
 *
 * - **In-flight rows** (`dropLiveRecords`): a streaming assistant row or a
 *   running tool row painted from a cache is a line that will never advance,
 *   because the deltas that would advance it were consumed by the previous
 *   mount. The stale indicator is what stops a cached paint from reading as live
 *   state, but an indicator cannot make a half-written row honest.
 * - **`argsByCall`**: the session-scale call-id -> arguments map exists to label
 *   live rows whose arguments have not landed yet, and it is rebuilt by the
 *   reconcile page. Retained rows carry their own `args` on the tool record, so
 *   dropping the map costs the stale paint nothing it can display and keeps one
 *   session's call history from dominating the byte budget.
 * - **The title and the attention state**: both belong to something other than
 *   the rows. The title is the catalogue row's, which the store already holds
 *   (the same row the sidebar marks unread), so a cached copy could only ever
 *   disagree with it. The attention state rides on `frontend`, and `frontend`
 *   is null until the owner's snapshot precisely so that
 *   `useCompletionView`'s read receipt cannot act on a state nobody published —
 *   restoring a cached `attention` would mean restoring a fabricated epoch and
 *   sequence beside it. The rows are the only thing this cache can honestly
 *   restore, and they are the only thing the click's latency claim is about.
 * - **The scroll position**: until 2026-11-12 this list said "not cached" and
 *   the transcript scroller's bottom anchoring was enough, because a click path
 *   always arrives at the tail. A ROUTE SWITCH is not a click path: leaving
 *   `/chat` for `/team-bridge` unmounts the panel, so a reader who had scrolled
 *   up came back at the bottom (measured by QA: 0 of 12 scrolled returns kept
 *   their place). `scroll` below carries the place instead, as an anchor row
 *   rather than an offset, so rows inserted above it by the reconcile cannot
 *   move it (see `PaintedScroll`). Pinned-to-bottom is still the default and
 *   costs nothing: it is one branch and no id.
 * - **The turn's liveness**: `busy` carries the one bit the rows cannot - that
 *   a turn was running when this window last showed them - so a return to a
 *   running session does not paint idle chrome over it for the length of the
 *   revalidate. It is a FLAG, never the in-flight rows themselves: those still
 *   never enter the cache (a cached streaming row can never advance), and the
 *   snapshot overrides the flag the moment it lands.
 *
 * THE BOUND IS BYTES, NOT SESSIONS. A row is not a unit of size: measured over
 * the transcripts on this machine, the largest is 256 MB across 19,930 entries
 * (12.8 KB per entry) and the heaviest per-row session averages 65 KB per
 * entry, so a 100-row page ranges from ~1.3 MB to ~6.5 MB. A "keep 8 sessions"
 * bound would therefore let one heavy conversation hold tens of megabytes while
 * a light one held kilobytes. Sizes below are measured in the same unit the
 * bound is asserted in (`TextEncoder` bytes of the retained rows).
 */

import {
	type TranscriptState,
	dropLiveRecords,
} from "@features/chat/canonical/transcript-reducer";

/**
 * Total bytes across every cached conversation.
 *
 * An order of magnitude below the ~150 MB a resident renderer costs, which is
 * the trade this cache is on the right side of: it is only ever populated for
 * conversations the user has actually opened in THIS window, and a recreated
 * window starts empty.
 */
export const PAINT_CACHE_TOTAL_BYTES = 4 * 1024 * 1024;

/**
 * Bytes any ONE conversation may hold.
 *
 * Without it a heavy session's retained rows could consume the whole budget and
 * evict every other conversation, so the conversation the user is about to
 * click would be the one with no cached paint. Trimming keeps the NEWEST rows,
 * which are the ones at the bottom of the scroller and the ones a click lands
 * looking at.
 */
export const PAINT_CACHE_SESSION_BYTES = 1024 * 1024;

/**
 * Rows any one conversation may hold, as a second ceiling.
 *
 * Two independent ceilings because neither implies the other: the byte cap
 * bounds memory, and this bounds the work of rebuilding the id index on read
 * for a transcript of many tiny rows.
 */
export const PAINT_CACHE_MAX_ROWS = 200;

/**
 * The reader's place in the transcript when the pane last stopped showing it.
 *
 * IDENTITY AND OFFSET, NOT `scrollTop`. `scrollTop` is a position in a content
 * length that the reconcile changes: rows inserted above the viewport leave an
 * absolute offset pointing at different text. A row id plus its distance from
 * the scrollport's top survives that, because it names the text the reader was
 * looking at rather than a number the text happens to be at today.
 *
 * `pinned` is the ordinary case and the default: a reader at the tail is at
 * `scrollTop = 0` in this reversed scroller, and a return must keep them there
 * whatever arrives below.
 */
export type PaintedScroll =
	| { pinned: true }
	| { pinned: false; id: string; offsetPx: number };

/** The tail, as a value that can be compared without a fresh object per read. */
export const PINNED_SCROLL: PaintedScroll = { pinned: true };

export type PaintedConversation = {
	transcript: TranscriptState;
	/** `Date.now()` at write, for eviction order and for a test to read. */
	savedAt: number;
	/** The reader's place; see `PaintedScroll`. */
	scroll: PaintedScroll;
	/**
	 * Was a turn running the last time this paint was on screen?
	 *
	 * The one bit that separates "a finished conversation" from "a running one
	 * the reader looked away from", and the rows cannot carry it: the in-flight
	 * rows are dropped on write, so every cached transcript reads as settled.
	 * Consumed as a CLAIM about the recent past, not as state: the seeded mount
	 * says a turn was running, and the snapshot - the only authority - keeps or
	 * withdraws it in the same commit that replaces the rows.
	 */
	busy: boolean;
	/**
	 * UTF-8 bytes of the retained rows, as this cache measured them at write.
	 *
	 * Part of the READ contract because the open trace reports the size of the
	 * paint a click actually got (`paintBytes`), and re-measuring on the click path
	 * would encode the same rows a second time - in exactly the place this cache
	 * exists to keep cheap.
	 */
	bytes: number;
	/**
	 * Call ids whose label read the paint was still waiting on when it was stored.
	 *
	 * WHY THIS TRAVELS WITH THE ROWS. A cached tool row carries no arguments (the
	 * seed it came from holds `tool_execution_end` frames, which state none), so
	 * the row's object column falls back to the first line of the call's OUTPUT
	 * unless the paint says the command is still coming. That distinction cannot
	 * be recovered from the rows: a call whose read had finished and found nothing
	 * is a row whose stand-in is the terminal truth, and a call whose read was
	 * still outstanding is a row that is one answer away from its command. Cached
	 * without it, the first frame after a switch back paints result text where the
	 * command belongs and then repaints the row when the read lands - the jitter
	 * the hold exists to prevent, moved one mount later.
	 */
	owedLabels: ReadonlySet<string>;
	/**
	 * Call ids whose HOLD a refusal ended and whose mark was standing when stored.
	 *
	 * The sibling of `owedLabels`, for the same reason one mount later. A refused
	 * stand-down releases the row's hold and keeps its mark standing (round 4): the
	 * read path has refused, no read has named the call, and the call's OUTPUT is
	 * therefore not yet a fact - but neither is a command. The rows alone cannot say
	 * which of the two states a column is in, so a cache without this paints result
	 * text in the command column on a switch back's FIRST frame and then repaints the
	 * row when a later read lands: the jitter this branch exists for, one mount later
	 * on a route that has just refused to answer.
	 */
	markLabels: ReadonlySet<string>;
	/**
	 * Record ids a reconnect REPLAY put on the pane that no journal page had named
	 * when the paint was stored (`replayBornIds` in `use-canonical-session.ts`).
	 *
	 * WHY IT TRAVELS WITH THE ROWS (#876, review round 1's R1-1). A settled row a
	 * replay delivered is cached like any other, and the next mount seeds the pane
	 * from it. Without this set that mount counts the row as held - "the pane
	 * holds a journal row" - when it is only a row the discontinuity delivered, and
	 * a journal-tail page ending on it defers with no read over the rows between:
	 * the original hole, arriving through the cache. The rows still DISPLAY (the
	 * cached pane shows what it showed); only the claim that they are evidence of a
	 * held journal range is withheld.
	 *
	 * IN-MEMORY, LIKE THE CACHE: it dies with the renderer, so a restored id can
	 * only be stale within one window's lifetime, and the reader prunes it against
	 * the seeded index. A record written without the field restores as empty, which
	 * is the behaviour before this existed.
	 */
	replayBorn: ReadonlySet<string>;
	/**
	 * Whether these rows are the WHOLE conversation, as opposed to its newest
	 * suffix.
	 *
	 * WHY THE PANE NEEDS IT (P2 of the session-switch plan). The two ceilings
	 * below keep a suffix, and a heavy session's suffix is often shorter than the
	 * transcript pane. The column top-anchors a conversation that fits
	 * (`mb-auto`, canonical-transcript.tsx), which is right for a genuinely short
	 * conversation and wrong for a suffix: when the taller page lands, the column
	 * overflows, the auto margin resolves to zero, and every row bottom-packs -
	 * measured on a built renderer, the first visible row moved 200.6 px and the
	 * last 212.6 px in ONE frame, 26/26 and 16/16 runs at 500/700 KB tool results.
	 *
	 * TRUE ONLY WHEN NOTHING WAS DROPPED AND NO OLDER ROWS ARE OWED. "Owed" is
	 * read from what the pane knew at write, because this module never sees the
	 * backend: a page that said more rows exist (`hasMore`), no page at all (no
	 * `oldestId` - a live-only pane, or a mount this cache itself seeded, which
	 * clears the cursor), and a settings prune still waiting on its older native
	 * target (`profileHistoryPending`). A trim by either ceiling is a suffix by
	 * definition, so it is incomplete whatever the page said.
	 *
	 * A CLAIM ABOUT COVERAGE, NOT FRESHNESS: `stale` says these rows may be
	 * behind; this says they are not merely the tail of the conversation. The pane
	 * reads the two separately, and the layout takes completeness into account
	 * only while `stale` holds.
	 */
	complete: boolean;
};

type Entry = PaintedConversation;

const cache = new Map<string, Entry>();

/**
 * Places measured for a conversation whose paint has not been written yet.
 *
 * WHY THIS EXISTS (agent review C1 / QA Q1 on #1883). The transcript measures
 * its scroller in a LAYOUT cleanup and the session hook writes the paint in the
 * PASSIVE one that follows - so on a session's FIRST leave the position is
 * recorded before any entry exists. The old `writePaintScroll` was a no-op
 * without an entry, so `writePaint` found nothing to carry forward and stored
 * the tail: 4 of 4 first leaves from a scrolled-up conversation came back at the
 * bottom, while later leaves kept their place. A place is measured once per
 * leave and consumed by the write that follows it, so this holds at most one
 * small object per conversation and normally for a single commit.
 *
 * BOUNDED ANYWAY (PENDING_SCROLL_MAX). The one way an entry outlives its mount is
 * a conversation with no rows (the hook skips `writePaint` for those, and an
 * empty transcript has no place worth restoring), so a run of opened-and-left
 * empty conversations could otherwise leave one id behind each. Eviction is by
 * insertion order, the same rule the paint cache itself uses.
 */
const pendingScroll = new Map<string, PaintedScroll>();

/**
 * How many unwritten places may stand at once.
 *
 * Not a measured threshold: it bounds a map whose entries are an id and a
 * number, in a renderer that only ever needs the one the next `writePaint` will
 * read. Thirty-two is comfortably above the handful a reader produces between
 * two paints (one per leave) and small enough that the leftover-empty-session
 * case stays a rounding error beside the 4 MiB row budget. Exported so the
 * bound's test names the constant rather than a copy of its value.
 */
export const PENDING_SCROLL_MAX = 32;

/**
 * Why the last paint for an id left no entry, for the open trace's
 * `paintReason`.
 *
 * THE CACHE FORGETS, THE DIAGNOSTIC REMEMBERS. Every path that ends with no
 * entry under an id - a write whose rows were all in flight or all trimmed away,
 * and eviction dropping the oldest - deletes the key, so a later `readPaint`
 * cannot tell "this window never painted it" from "it was trimmed to nothing"
 * or "it was evicted". Those are different answers about the same click: a cache
 * that keeps nothing and one that was never asked look identical in a hit rate.
 * So the reason is kept beside the cache, and nothing that decides what to paint
 * reads it.
 */
export type PaintMiss = "empty-after-trim" | "evicted";

/**
 * How many miss notes to keep.
 *
 * Bounded because a session id comes from the backend and would otherwise be
 * remembered for every conversation this window ever painted. 64 is several
 * screens of recent switches - the whole window in which a revisit can be told
 * apart from a first open - and an aged-out note reads as `no-entry`, which is
 * the honest answer once the note is gone.
 */
const PAINT_MISS_NOTES = 64;
const misses = new Map<string, PaintMiss>();

function noteMiss(sessionId: string, reason: PaintMiss): void {
	// Delete before set so the re-inserted key is the newest, as the cache does.
	misses.delete(sessionId);
	misses.set(sessionId, reason);
	while (misses.size > PAINT_MISS_NOTES) {
		const oldest = misses.keys().next().value;
		if (oldest === undefined) break;
		misses.delete(oldest);
	}
}

/**
 * UTF-8 bytes of the retained rows, which is the unit the bounds are stated in.
 *
 * Only the ROWS: the anchor and the liveness flag beside them are one id and one
 * boolean against transcripts that bound in megabytes, and counting them would
 * make the retained suffix and the budget disagree about what a row costs.
 */
function measure(records: TranscriptState["records"]): number {
	if (records.length === 0) return 0;
	try {
		// `TextEncoder` counts BYTES; `JSON.stringify(...).length` counts UTF-16
		// code units and undercounts every non-ASCII character — and this app is
		// used by people whose transcripts are full of them, so a bound stated in
		// code units would be a bound that silently does not hold.
		return new TextEncoder().encode(JSON.stringify(records)).length;
	} catch {
		// A cyclic or otherwise unserialisable record means this conversation
		// cannot be cached at a known size, and an unknown size is not something
		// a byte bound can admit.
		return Number.POSITIVE_INFINITY;
	}
}

/**
 * The newest rows that fit both ceilings, oldest-first.
 *
 * Trimmed from the FRONT: the newest rows are what the reader is looking at,
 * and the reconcile page that follows is authoritative for everything older.
 */
function trimRecords(records: TranscriptState["records"]): {
	records: TranscriptState["records"];
	bytes: number;
	/** Whether either ceiling dropped a row; see `complete` on the entry. */
	trimmed: boolean;
} {
	const capped = records.slice(-PAINT_CACHE_MAX_ROWS);
	const trimmedByRows = capped.length < records.length;
	const bytes = measure(capped);
	if (bytes <= PAINT_CACHE_SESSION_BYTES)
		return { records: capped, bytes, trimmed: trimmedByRows };
	/*
	 * This write runs synchronously in the old pane's unmount cleanup and can
	 * block renderer work during a switch. Measuring every shrinking suffix encodes
	 * the same large rows: 200 heavy rows can encode over a gigabyte just to keep
	 * 1 MiB. Suffix sizes only decrease as rows are removed (an unserialisable
	 * row keeps the size infinite until it is removed), so search the first FIT
	 * using the SAME exact UTF-8 measure, not per-row estimates. The empty suffix
	 * is the known fitting endpoint, even when the newest row cannot be cached.
	 * At the 200-row ceiling this costs at most nine measurements, and small
	 * paints above still cost one. Keep the fitting size with its endpoint so
	 * the byte budget and retained suffix cannot disagree.
	 */
	let nonFit = 0;
	let fit = capped.length;
	let fitBytes = 0;
	while (fit - nonFit > 1) {
		const middle = Math.floor((nonFit + fit) / 2);
		const middleBytes = measure(capped.slice(middle));
		if (middleBytes > PAINT_CACHE_SESSION_BYTES) {
			nonFit = middle;
		} else {
			fit = middle;
			fitBytes = middleBytes;
		}
	}
	return { records: capped.slice(fit), bytes: fitBytes, trimmed: true };
}

/**
 * Whether the pane's rows covered the WHOLE conversation when the paint was
 * taken.
 *
 * READ FROM THE INPUT TRANSCRIPT, before the stored copy clears the paging
 * cursor: the cache cannot KEEP a cursor (see `writePaint`), but the question
 * this answers is what the pane itself knew at that instant.
 *
 * AN ABSENT CURSOR IS NOT A STATEMENT OF COVERAGE. A snapshot page that carries
 * rows defines `oldestId`; the field is null only until one does (a cleared or
 * never-loaded view whose rows are live ones) and on every mount this cache
 * seeded, because the stored transcript carries no cursor. `hasMore` is the
 * backend's own "there are older rows", and `profileHistoryPending` is a local
 * prune that still owes its older native target - both make what the pane holds a
 * window rather than the conversation.
 */
function coversWholeConversation(transcript: TranscriptState): boolean {
	if (transcript.oldestId === null) return false;
	if (transcript.hasMore) return false;
	if ((transcript.profileHistoryPending?.length ?? 0) > 0) return false;
	return true;
}

/**
 * Cache the painted conversation for `sessionId`.
 *
 * Called at the moment the panel stops showing it, which is the last moment its
 * rows are known to be the ones that were on screen. What is stored is the
 * DURABLE subset of that paint: see the in-flight filter below.
 */
export function writePaint(
	sessionId: string,
	input: {
		transcript: TranscriptState;
		/** The call ids still waiting on a label read; see `owedLabels`. */
		owedLabels?: ReadonlySet<string>;
		/**
		 * The call ids whose hold a refusal ended but whose mark was standing; see
		 * `markLabels` on `PaintedConversation`.
		 */
		markLabels?: ReadonlySet<string>;
		/** Replay-born record ids not yet named by a page; see `replayBorn`. */
		replayBorn?: ReadonlySet<string>;
		/**
		 * The reader's place, when the caller has it. Omitted means "keep what
		 * `writePaintScroll` recorded for this session": an entry's own value, or the
		 * one measured before any entry existed (the first leave - the transcript's
		 * layout cleanup runs before this passive one). Either way the anchor is
		 * normally written FIRST and must survive this function replacing the entry.
		 */
		scroll?: PaintedScroll;
		/**
		 * Whether a turn was running. Always supplied by the one caller that knows
		 * (the session hook derives it from the pane's own live reading at the same
		 * instant), because a carried-forward flag would resurrect a claim the last
		 * paint has no evidence for: absent means "settled", not "unchanged".
		 */
		busy?: boolean;
		/**
		 * The coverage claim to CARRY, for a pane that is still painting a cached
		 * paint when it writes. Such a pane's rows cannot answer
		 * `coversWholeConversation`: the stored transcript has no paging cursor
		 * (`oldestId` is cleared on the way in), so re-deriving would demote a
		 * complete short conversation to incomplete and the NEXT return would
		 * bottom-align it, then jump up when its page landed (agent review F1 / QA Q1,
		 * measured 253.1 px on a one-turn session). Supplied only while the pane is
		 * stale - the snapshot's page is the authority once it lands - and a trim
		 * still decides first (see `complete` below).
		 */
		complete?: boolean;
	},
): void {
	// In-flight rows are dropped HERE rather than asked of the caller. The
	// invariant is the cache's, not the call site's: a streaming assistant row or
	// a running tool row painted from a cache is a line that can never advance,
	// because the deltas that would advance it were consumed by the previous
	// mount. A caller that forgot would produce a permanently half-written row
	// that no caption can make honest.
	const { records, bytes, trimmed } = trimRecords(
		dropLiveRecords(input.transcript).records,
	);
	if (records.length === 0) {
		noteMiss(sessionId, "empty-after-trim");
		cache.delete(sessionId);
		// Nothing to place a reader in: a measured position for an empty
		// transcript is not a place this cache can keep.
		pendingScroll.delete(sessionId);
		return;
	}
	// `index` is rebuilt here rather than stored: it is a Map, so it cannot be
	// measured or serialised, and a stale index beside trimmed rows would be an
	// index into the old array — `removeRecord` would then delete the wrong row.
	const transcript: TranscriptState = {
		...input.transcript,
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		// The paging cursor is NOT cached. `oldestId`/`hasMore` describe the
		// backend's page boundaries for the rows this cache happens to hold, and a
		// trimmed or re-fetched set makes them wrong in a way that is worse than
		// absent: scrolling up during the stale window would splice the wrong
		// range. Cleared here and repopulated by the snapshot the paint is waiting
		// for.
		oldestId: null,
		// The cursor's stored instant goes with it: an id with a stale instant would
		// let a tail-type read "move" the cursor by comparing against a position
		// this cache no longer holds.
		oldestTs: 0,
		hasMore: false,
		argsByCall: new Map(),
	};
	const entry: Entry = {
		transcript,
		savedAt: Date.now(),
		bytes,
		/*
		 * Intersected with the rows that SURVIVED the trim and are still tool rows
		 * with something to stand in for: a call id whose row was dropped would
		 * otherwise be held on a mount that has no row to hold, and one whose row
		 * carries arguments needs no hold at all.
		 */
		owedLabels: carriedLabelsFor(records, input.owedLabels),
		/*
		 * Filtered by the same rule and for the same reason as `owedLabels`: a marked id
		 * whose row was trimmed away has nothing to mark, and one whose row carries
		 * arguments shows its command whatever this set says.
		 */
		markLabels: carriedLabelsFor(records, input.markLabels),
		/*
		 * Only ids whose row SURVIVED the in-flight drop and the trim: an id with no
		 * row here has nothing to withhold, and a stale one must not shadow a real
		 * row that later arrives under it.
		 */
		replayBorn: new Set(
			[...(input.replayBorn ?? [])].filter((id) => transcript.index.has(id)),
		),
		/*
		 * The reader's place, resolved in the order the writes can arrive: an
		 * explicitly supplied one, then the layout cleanup's measurement that has no
		 * entry to sit on yet (the first-leave case), then whatever this entry held
		 * before it was replaced. Consumed here rather than read twice, so a place
		 * cannot be restored by two paints.
		 *
		 * VALIDATED AGAINST THE ROWS THAT SURVIVED (agent review C5): an anchor on a
		 * row the in-flight drop or the trim removed would restore nothing and fall
		 * back to the tail silently. An anchor the retained rows cannot answer is the
		 * tail, and storing that is what makes the fallback a decision this module
		 * made rather than a surprise at mount.
		 */
		scroll: retainedScroll(
			input.scroll ??
				pendingScroll.get(sessionId) ??
				cache.get(sessionId)?.scroll ??
				PINNED_SCROLL,
			transcript.index,
		),
		busy: input.busy === true,
		/*
		 * A suffix is incomplete by construction, so the trim decides first and the
		 * pane's own page knowledge decides the rest. Dropping IN-FLIGHT rows does
		 * not count: those are rows that have not settled, so the page that follows
		 * can only add below what this paint shows - the direction new rows are
		 * allowed to arrive in.
		 *
		 * A CARRIED claim (a pane still stale at the write) is taken as-is rather
		 * than OR-ed with the derivation: the cache cleared that transcript's cursor
		 * on the way in, so the derivation can only ever say "incomplete" there and
		 * the seed's answer is the only coverage this paint ever had. The trim still
		 * wins: rows that arrived live during the stale window can push the paint
		 * over a ceiling, and what survives is then a suffix whatever the entry said.
		 */
		complete:
			!trimmed && (input.complete ?? coversWholeConversation(input.transcript)),
	};
	// The measurement belongs to THIS write; a later paint of this conversation
	// measures its own.
	pendingScroll.delete(sessionId);
	// Delete before set so the re-inserted key is the newest for eviction order.
	cache.delete(sessionId);
	cache.set(sessionId, entry);
	// A stored paint ANSWERS the question the note existed to answer.
	misses.delete(sessionId);
	evict();
}

/**
 * A carried label set, as it applies to the rows this cache actually holds.
 *
 * One filter for both sets (`owedLabels`, `markLabels`), because the question is
 * the same for each: does a row exist here that is in the set AND can still use
 * the answer? Only a tool row with no arguments can - a dropped row has nothing to
 * hold or mark, and a row with arguments shows its command whatever the set says.
 *
 * An absent set is empty rather than a wildcard: a caller that stores rows
 * without saying what was owed is claiming every row is settled, which paints
 * the stand-ins and is exactly what the field exists to stop. Only a caller that
 * HAD a hold can say it had one.
 */
function carriedLabelsFor(
	records: TranscriptState["records"],
	supplied: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
	if (!supplied || supplied.size === 0) return EMPTY_OWED;
	const kept = new Set<string>();
	for (const record of records) {
		if (record.kind !== "tool" || record.args) continue;
		if (!record.toolCallId) continue;
		if (!supplied.has(record.toolCallId)) continue;
		kept.add(record.toolCallId);
	}
	return kept.size > 0 ? kept : EMPTY_OWED;
}

/** The shared empty carried set, so an unchanged paint keeps its identity. */
const EMPTY_OWED: ReadonlySet<string> = new Set();

/**
 * A place the cached rows can still answer, or the tail.
 *
 * Pinned is already the tail and needs no lookup; a scrolled place needs its row
 * in the retained index, because the seeded mount restores by `data-record-id`
 * and a row this paint did not keep has no element to restore to.
 */
function retainedScroll(
	scroll: PaintedScroll,
	index: ReadonlyMap<string, number>,
): PaintedScroll {
	if (scroll.pinned) return PINNED_SCROLL;
	return index.has(scroll.id) ? scroll : PINNED_SCROLL;
}

/** The cached paint for `sessionId`, or null. Does not change eviction order. */
export function readPaint(sessionId: string): PaintedConversation | null {
	return cache.get(sessionId) ?? null;
}

/**
 * Why `sessionId` has no paint, when this cache can still say: `empty-after-trim`
 * (the last write had nothing durable to keep) or `evicted` (the byte bound
 * dropped it). Null when it never painted here, or the note has aged out - both
 * of which the trace reports as `no-entry`. Diagnostic only.
 */
export function paintMissReason(sessionId: string): PaintMiss | null {
	return misses.get(sessionId) ?? null;
}

/** Forget one conversation. Used when the backend says it is gone (M6). */
export function dropPaint(sessionId: string): void {
	misses.delete(sessionId);
	cache.delete(sessionId);
	// A place measured for the paint that will never be written describes rows
	// this window no longer holds.
	pendingScroll.delete(sessionId);
}

/**
 * Record the reader's place for a conversation.
 *
 * Called from the transcript's LAYOUT-effect cleanup, which runs while the
 * scroller is still in the document (measurement is still meaningful) and, on
 * unmount, BEFORE the session hook's passive cleanup calls `writePaint` - so
 * the entry this writes is usually the one `writePaint` is about to replace,
 * and `writePaint` carries the value forward for exactly that ordering.
 *
 * WITHOUT AN ENTRY THE PLACE IS KEPT FOR THE WRITE THAT FOLLOWS, not dropped. A
 * session's first leave has no entry yet (the paint is written one cleanup
 * later), and discarding the measurement there lost the reader's place on 4 of
 * 4 first leaves (C1/Q1). The pending map is consumed by `writePaint`, which is
 * also what keeps this from minting an entry with rows this module never saw.
 */
export function writePaintScroll(
	sessionId: string,
	scroll: PaintedScroll,
): void {
	const entry = cache.get(sessionId);
	if (entry) {
		entry.scroll = scroll;
		return;
	}
	// Delete before set so the re-inserted key is the newest for eviction order.
	pendingScroll.delete(sessionId);
	pendingScroll.set(sessionId, scroll);
	while (pendingScroll.size > PENDING_SCROLL_MAX) {
		const oldest = pendingScroll.keys().next().value;
		if (oldest === undefined) break;
		pendingScroll.delete(oldest);
	}
}

/**
 * Evict oldest-written first until the total fits.
 *
 * Insertion order is the eviction order (a `Map` preserves it), and every read
 * path leaves it alone: re-inserting on read would make eviction depend on
 * navigation history rather than on which paint is most likely to be wanted.
 */
function evict(): void {
	let total = 0;
	for (const entry of cache.values()) total += entry.bytes;
	while (total > PAINT_CACHE_TOTAL_BYTES && cache.size > 0) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		const entry = cache.get(oldest);
		cache.delete(oldest);
		// An evicted conversation's rows are gone; a place for the paint that was
		// never written describes the same gone rows.
		pendingScroll.delete(oldest);
		noteMiss(oldest, "evicted");
		total -= entry?.bytes ?? 0;
	}
}

/** Introspection for tests and for the byte-bound assertion. */
export function __paintCacheStats(): {
	sessions: number;
	bytes: number;
	rows: number;
} {
	let bytes = 0;
	let rows = 0;
	for (const entry of cache.values()) {
		bytes += entry.bytes;
		rows += entry.transcript.records.length;
	}
	return { sessions: cache.size, bytes, rows };
}

/** Drop everything. Test-only; nothing in the app needs to empty the cache. */
export function __resetPaintCache(): void {
	cache.clear();
	pendingScroll.clear();
	misses.clear();
}
