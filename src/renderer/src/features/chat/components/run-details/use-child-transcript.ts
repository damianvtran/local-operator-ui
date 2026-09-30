/**
 * The child reader's loader (`docs/run-sidebar.md` § 5.3, § 5.4).
 *
 * A child's transcript is a file on disk behind a read-only route, not a stream,
 * so this hook is a PAGER plus a CADENCE. The two are separable and both are
 * stated here because the cadence is the part with a real cost: `read_transcript_page`
 * is a sequential scan of the whole file that retains `limit + 1` rows
 * (`session/transcript.py:361-428`), so every refetch parses the child's entire
 * transcript and the only thing keeping that affordable is asking rarely.
 *
 * The cadence, in full:
 *
 * - **A tail read on open**, so the reader starts at the newest rows.
 * - **A tail read when the child's pulse changes**, coalesced to at most one per
 *   second. The pulse is bumped on `subagent_start|progress|end`, which is the
 *   boundary the backend writes the file at — so a child that thinks for ninety
 *   seconds costs ONE read rather than ninety.
 * - **One final read when the child settles**, and then no read at all: a settled
 *   child's file does not grow, and a timer for a file that cannot change is the
 *   defect this hook exists to not have.
 * - **A 5s fallback poll** while the reader is open on a LIVE child. This is a
 *   safety net for a degraded stream (`frontend.update` deltas can arrive shed,
 *   `frontend_state.py:3064-3084`), not the mechanism — if it is what you are
 *   watching, the pulse is broken.
 * - **Nothing at all while the reader is closed**: the hook is mounted by the
 *   reader, and the reader unmounts when no child is open.
 *
 * Paging (`loadOlder`) is the parent's own shape (`use-canonical-session.ts:607-650`):
 * a stale-request guard, a `loadingOlder` flag that cannot re-enter, a
 * `before_id` cursor, and a resolver that reports failure by resolving `false`
 * rather than rejecting — which is the contract `CanonicalTranscript` needs to
 * count failures and stop retrying on its own (clause G).
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopChildTranscriptPage } from "../../../../../../shared/desktop-session-contract";
import type { LoadOlderOutcome } from "../../canonical/load-older";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyHistoryPage,
} from "../../canonical/transcript-reducer";

/** At most one pulse-driven read per second, whatever the pulse's own rate. */
const PULSE_MIN_INTERVAL_MS = 1_000;
/** The safety net for a degraded stream: see the file docstring. */
const FALLBACK_POLL_MS = 5_000;
/** The page size, matching the parent's own older-page read. */
const PAGE_LIMIT = 100;

export type ChildTranscriptState =
	| "loading"
	| "ready"
	| "pending"
	| "gone"
	| "error";

export type ChildTranscriptHandle = {
	/** The route's own tri-state, or this hook's `loading`/`error` around it. */
	state: ChildTranscriptState;
	/** A FRESH transcript state, never the parent's: see `applyHistoryPage`'s note. */
	transcript: TranscriptState;
	loadingOlder: boolean;
	/**
	 * The last "load earlier" ask FAILED and nothing has been applied since - the
	 * child reader's own copy of what `CanonicalSessionView.olderFailed` is for the
	 * parent. `CanonicalTranscript` paints the failed row from it, and it is the
	 * only thing that can: the pump no longer keeps a failed flag of its own.
	 */
	olderFailed: boolean;
	/** Resolves `false` rather than rejecting, per the paging contract. */
	loadOlder: () => Promise<boolean>;
	/** The same ask, answering what happened (`LoadOlderOutcome`); never rejects. */
	loadOlderDetailed: () => Promise<LoadOlderOutcome>;
};

export function useChildTranscript({
	sessionId,
	childId,
	/** How many `subagent_*` events this viewer has seen for this child. */
	pulse,
	/** Whether the child is still open, which is what keeps the timers alive. */
	live,
}: {
	sessionId: string | null;
	childId: string | null;
	pulse: number;
	live: boolean;
}): ChildTranscriptHandle {
	const [transcript, setTranscriptState] =
		useState<TranscriptState>(EMPTY_TRANSCRIPT);
	const [state, setState] = useState<ChildTranscriptState>("loading");
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [olderFailed, setOlderFailed] = useState(false);

	/*
	 * The transcript as the LATEST write left it, readable outside a render.
	 *
	 * Every write goes through `setTranscript` below, which computes the next value
	 * from this ref and only then hands it to React. That is what lets
	 * `loadOlderDetailed` report `newRecords`/`exhausted` from the page it applied:
	 * the numbers used to be assigned inside a `setState` updater, which React runs
	 * eagerly only when its queue is empty, so a report read on the next line could
	 * be the initial zero (loader-continuity round 1, R1-5). The writers are all
	 * event-handler/async paths that run one at a time on the main thread, so the
	 * ref is never behind the state it mirrors.
	 */
	const transcriptRef = useRef<TranscriptState>(EMPTY_TRANSCRIPT);
	const setTranscript = useCallback(
		(
			update:
				| TranscriptState
				| ((previous: TranscriptState) => TranscriptState),
		) => {
			const next =
				typeof update === "function" ? update(transcriptRef.current) : update;
			transcriptRef.current = next;
			setTranscriptState(next);
		},
		[],
	);

	/*
	 * The identity a read belongs to. `applyHistoryPage` MERGES, so a page that
	 * lands after the reader has moved to another child would splice one child's
	 * conversation into another's — the same hazard the parent's own loader guards
	 * against, and the reason every write below is gated on this key rather than
	 * on the effect having been cleaned up.
	 */
	const key = `${sessionId ?? ""}:${childId ?? ""}`;
	const keyRef = useRef(key);
	keyRef.current = key;
	/*
	 * A per-VIEW generation of that key, bumped whenever it changes, for the same
	 * reason the parent's loader has one (round 1, R1-3): a page still out for
	 * child A when the reader goes A -> B -> A matches A by key, lands on A's freshly
	 * reset transcript (`oldestId` null) and seeds its cursor from a deep page,
	 * leaving the rows between it and the tail unreachable. Comparing the epoch
	 * makes "the same child" mean "the same visit to it".
	 */
	const epochRef = useRef({ key, epoch: 0 });
	if (epochRef.current.key !== key)
		epochRef.current = { key, epoch: epochRef.current.epoch + 1 };

	// The last tail read, for the 1 Hz cap. Ref rather than state: it decides
	// whether to schedule a read, and changing it must not re-render the reader.
	const lastTailRef = useRef(0);
	// The pending coalesced read, if one is scheduled.
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	/*
	 * Stable across renders because it only ever touches a ref, and three effects
	 * depend on it: a function recreated per render would either be a dependency
	 * that changes every render (re-running the effects that call it) or one the
	 * linter has to be silenced about, and both are worse than a `useCallback`
	 * over a ref.
	 */
	const clearTimer = useCallback(() => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	/**
	 * Merge one page into the reader's own state.
	 *
	 * This used to RESTORE `hasMore` after every merge, because a tail page's
	 * `has_more: false` is a statement about the tail, not about the rows already
	 * paged in above it, and `applyHistoryPage` took it literally - the "load
	 * earlier" affordance vanished under a reader who had just used it. The
	 * reducer now owns that rule (a tail-type read moves neither the cursor nor
	 * `hasMore` unless it reaches strictly older), so the restore is redundant -
	 * and it would be WRONG for a continuation: `previous.hasMore || ...` forces
	 * `true` back over the final page's honest `has_more: false`, and a child
	 * could then never reach its start. `pagedBefore` is passed only by the
	 * older-page ask; every tail read leaves it undefined.
	 */
	const merge = useCallback(
		(
			previous: TranscriptState,
			page: DesktopChildTranscriptPage,
			options?: { pagedBefore?: string },
		) => applyHistoryPage(previous, page, options),
		[],
	);

	const readTail = useCallback(async (): Promise<void> => {
		if (!sessionId || !childId) return;
		const requested = `${sessionId}:${childId}`;
		lastTailRef.current = Date.now();
		try {
			const page = await desktopResult<DesktopChildTranscriptPage>({
				op: "subagents.transcript",
				sessionId,
				childId,
				limit: PAGE_LIMIT,
			});
			if (keyRef.current !== requested) return;
			setState(page.state);
			setTranscript((previous) => merge(previous, page));
		} catch {
			/*
			 * A failed read is an outcome, not a crash: the route answers `404` for
			 * a child the parent's roster does not name (including the launch-
			 * coalesce window, where the retry is expected to succeed), and the
			 * reader says so in one line rather than blanking the body it already
			 * has. `error` is deliberately not `gone` — one is "we could not read",
			 * the other is "there is nothing to read".
			 */
			if (keyRef.current !== requested) return;
			setState("error");
		}
	}, [childId, merge, sessionId, setTranscript]);

	/** Schedule a tail read, coalescing to one per second. */
	const scheduleTail = useCallback(() => {
		if (timerRef.current !== null) return;
		const wait = Math.max(
			0,
			PULSE_MIN_INTERVAL_MS - (Date.now() - lastTailRef.current),
		);
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			void readTail();
		}, wait);
	}, [readTail]);

	// A new child starts from scratch: a fresh `TranscriptState`, the loading
	// state, and an immediate tail read. This is also the reader's FIRST read, so
	// the two are one effect rather than two that could disagree about whether
	// anything has been fetched.
	useEffect(() => {
		// A failure - and an in-flight flag - belong to the child they happened on.
		// The flag matters because a request abandoned by a switch never clears it
		// (its `finally` only writes for the view that is still on screen), so
		// without this the NEW child opens showing "Loading earlier messages" with
		// nothing out.
		setOlderFailed(false);
		setLoadingOlder(false);
		if (!sessionId || !childId) {
			setTranscript(EMPTY_TRANSCRIPT);
			setState("loading");
			return;
		}
		clearTimer();
		lastTailRef.current = 0;
		setTranscript(EMPTY_TRANSCRIPT);
		setState("loading");
		void readTail();
		return clearTimer;
	}, [childId, clearTimer, readTail, sessionId, setTranscript]);

	// The pulse: one read per beat, capped — and only while the child is LIVE.
	//
	// `live` is in the gate rather than only in the settle effect below for the
	// reason the settle effect exists: a settled child's file cannot grow, so a
	// pulse arriving after it settled (a late `subagent_end`, or any `subagent_*`
	// event for a child the roster now reports as settled) must not cost a
	// whole-file re-scan of a transcript that has stopped changing. The first
	// render for a child runs this too, which is harmless — `scheduleTail` will not
	// schedule inside the second the open read already spent.
	useEffect(() => {
		if (!sessionId || !childId || !live) return;
		if (pulse === 0) return;
		scheduleTail();
	}, [childId, live, pulse, scheduleTail, sessionId]);

	// The settle read, and the end of the timers. `live` false means the child has
	// settled: one more read picks up whatever the last batch wrote, and then
	// nothing runs again — no interval, no pulse, because a settled child's file
	// cannot grow.
	const wasLive = useRef(live);
	useEffect(() => {
		if (!sessionId || !childId) return;
		if (wasLive.current && !live) {
			clearTimer();
			void readTail();
		}
		wasLive.current = live;
	}, [childId, clearTimer, live, readTail, sessionId]);

	// The fallback poll, only while the reader is open on a LIVE child with the
	// pulse's own route already having answered once. It is here rather than in the
	// pulse because its whole job is to cover the pulse failing.
	useEffect(() => {
		if (!sessionId || !childId || !live) return;
		const timer = window.setInterval(() => void readTail(), FALLBACK_POLL_MS);
		return () => window.clearInterval(timer);
	}, [childId, live, readTail, sessionId]);

	const loadOlderDetailed = useCallback(async (): Promise<LoadOlderOutcome> => {
		if (!sessionId || !childId) return { kind: "nothing-to-load" };
		const epoch = epochRef.current.epoch;
		const stillHere = () => epochRef.current.epoch === epoch;
		const held = transcriptRef.current;
		const before = held.oldestId;
		if (!held.hasMore || !before) return { kind: "nothing-to-load" };
		setLoadingOlder(true);
		try {
			const page = await desktopResult<DesktopChildTranscriptPage>({
				op: "subagents.transcript",
				sessionId,
				childId,
				beforeId: before,
				limit: PAGE_LIMIT,
			});
			// A page that resolves after the reader moved (or left and came back)
			// describes a transcript that is no longer on screen.
			if (!stillHere()) return { kind: "stale" };
			setState(page.state);
			/*
			 * The same continuation rule as the parent's loader, and the same
			 * guard: `pagedBefore` is asserted only while the cursor is still where
			 * this ask started, so a tail read that landed while the page was out
			 * cannot have the cursor dragged to a position the reader has left
			 * (loader-continuity R1/R4). Without it, a page of only silent or
			 * already-held rows left the cursor where it was and the next ask
			 * repeated this one. Read from the ref, at the moment of the merge, so
			 * the guard sees a tail read that landed while the page was out.
			 */
			const previous = transcriptRef.current;
			const merged = merge(
				previous,
				page,
				previous.oldestId === before ? { pagedBefore: before } : undefined,
			);
			setTranscript(merged);
			setOlderFailed(false);
			return {
				kind: "applied",
				newRecords: Math.max(
					0,
					merged.records.length - previous.records.length,
				),
				exhausted: !merged.hasMore,
			};
		} catch {
			// Only a request that failed for the view still on screen is a failure the
			// reader can act on; a rejection for one they left says nothing about this
			// one, exactly as `stale` does not.
			if (!stillHere()) return { kind: "stale" };
			setOlderFailed(true);
			return { kind: "failed", reason: "request" };
		} finally {
			if (stillHere()) setLoadingOlder(false);
		}
	}, [childId, merge, sessionId, setTranscript]);
	const loadOlder = useCallback(
		async (): Promise<boolean> =>
			(await loadOlderDetailed()).kind === "applied",
		[loadOlderDetailed],
	);

	return {
		state,
		transcript,
		loadingOlder,
		olderFailed,
		loadOlder,
		loadOlderDetailed,
	};
}
