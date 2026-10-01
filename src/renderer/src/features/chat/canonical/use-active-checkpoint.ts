/**
 * The rail's reader-side cue: the checkpoint the reader is LOOKING AT, and the
 * record ids the store holds (design round 1, D2 + U1).
 *
 * Derived from the transcript's own store and layout because that is where the
 * two meet: `loadedIds` is the record ids this store holds (everything else in
 * the manifest wears the light "unloaded" arm), and `activeId` is the last
 * loaded checkpoint whose row has crossed the reading line - the scroller's top
 * edge PLUS the top-fade depth, because the jump lands a target at exactly that
 * inset (design round 1's D1 correction: a line at `top + 1` fails a landing at
 * `top + INSET` and lights the tick BEFORE the target) - with the two ENDS OF
 * THE SCROLLER resolved by their own arms, because the line rule alone cannot
 * light them (see the ends note below). The position
 * read is viewport-based (rects, not scrollTop) so it holds under either scroll
 * direction, and it is rAF-throttled: a scroll frame asks the DOM for the
 * loaded checkpoints' tops (bounded by the mounted window, not by the
 * manifest) and sets state only when the answer CHANGES.
 *
 * THE ENDS, NOT ONLY THE LINE (operator report, 2026-09-29). Measured live with
 * `--scoped-case rail-cue-probe`: at the BOTTOM the last loaded checkpoint's row
 * sits INSIDE the final viewport whenever the tail after it is shorter than one,
 * so it has never crossed the top edge and every tick within the last screenful
 * of content is unreachable for the cue - on the 6-turn fixture the active mark
 * was the SECOND checkpoint (`qn0002`) while the rail's last tick (`qn0006`) sat
 * four marks away; on the 402-mark fixture it was `u0196` against a last tick of
 * `n0200`. The operator's read - "off by a screen" - is exact: the arm is off by
 * up to one viewport. So a read that finds the scroller AT an end resolves to
 * that end's checkpoint: bottom -> the LAST loaded checkpoint with a mounted
 * row, top -> the FIRST. The ends are read per read (leading and settle), so a
 * view pinned at the bottom keeps the arm across appends and prepends.
 *
 * THE SCROLLER'S OWN ENDS ARITHMETIC. The transcript's scroller rests at its
 * BOTTOM at `scrollTop === 0`, with its span above held NEGATIVE (the app's own
 * inverted layout - `scrollTop` runs [-max, 0]), so "at the bottom" is
 * `|scrollTop| <= EPS` and "at the top" is `|scrollTop + max| <= EPS`. EPS
 * tolerates a fractional scrollTop sitting a fraction short of the arithmetic
 * end; it is 2px, the fraction measured in the probe (top read back exactly
 * -max; bottom exactly 0).
 *
 * THE SETTLE RE-READ (UX round 1, N1). A gesture that ends while the walk's
 * pages are still landing leaves the leading read - one animation frame behind
 * the last scroll event - looking at a transient: measured live, one -1600 px
 * wheel left the cue null for the whole rest window while a fresh read of the
 * SAME settled state found `u0188` (the read was timed wrong, not answered
 * wrong). The listener therefore arms a trailing read a settle window after
 * the LAST event as well, so a gesture that ends on such a transient still
 * lands on one active mark; the leading read stays - it is what keeps the cue
 * tracking live DURING the gesture.
 *
 * WHY IT IS ITS OWN MODULE: this contract is stated in time (when a read runs
 * relative to the event stream), and a claim about timing can only be pinned
 * where the clock is controllable - `scripts/use-active-checkpoint.test.mjs`
 * drives this hook under fake timers and jsdom, which the wiring inlined in a
 * component this size could not offer.
 */

import { TRANSCRIPT_TOP_FADE_PX } from "@shared/lib/transcript-fade";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Checkpoint } from "../../../../../shared/desktop-contract";

/**
 * How long after the last scroll event the cue re-reads the settled state.
 *
 * 160 ms: long enough for the walk's own page landings and the reader-position
 * compensation that follows a wheel into unloaded history (the live repro's
 * page had landed by +103 ms), short enough to be one gesture's tail rather
 * than a second gesture to the reader. A page landing WITHOUT a scroll does
 * not need this timer - the loaded set is the effect's dependency, so that
 * path re-reads on its own.
 */
export const ACTIVE_CUE_SETTLE_MS = 160;

/**
 * How close to an END of the scroller counts as AT that end.
 *
 * The transcript's scroller rests at its bottom at `scrollTop === 0` with its
 * span above held negative, so a fractional scrollTop can sit a fraction short
 * of the arithmetic end; 2px covers the fraction measured in the probe rather
 * than letting rounding decide which tick is lit. See the ends note in the
 * module header.
 */
export const ACTIVE_CUE_EDGE_EPSILON_PX = 2;

/** The one field the cue needs from a transcript row. */
export interface ActiveCueRow {
	record: { id: string };
}

/**
 * The cue for a region, over the rows and manifest a caller holds. Returns
 * both halves the rail consumes, so the store's id set has one derivation.
 */
export const useActiveCheckpoint = (
	regionRef: RefObject<HTMLElement | null>,
	rows: readonly ActiveCueRow[],
	checkpoints: readonly Checkpoint[],
): { activeId: string | null; loadedIds: ReadonlySet<string> } => {
	const [activeCheckpointId, setActiveCheckpointId] = useState<string | null>(
		null,
	);
	/*
	 * THE LOADED SET'S IDENTITY COMES FROM ITS CONTENT, NOT FROM `rows` (UI
	 * perf audit A2). `rows` is a fresh array on every streaming flush, so a memo
	 * keyed on it rebuilt the Set — and the filtered checkpoint list, the scan
	 * callback and the effect that attaches the scroll listener downstream of it
	 * — on every frame even when no id had moved. The resident window grows and
	 * shrinks only at its two ENDS (pages load tail-first and contiguously), so
	 * the count plus the first and last ids name the set exactly: a prepend or an
	 * append moves an end, a session switch moves all three, and no other event
	 * can add or remove an id without one of them moving.
	 */
	const loadedIdSignature = useMemo(
		() =>
			`${rows.length}\u0000${rows[0]?.record.id ?? ""}\u0000${
				rows[rows.length - 1]?.record.id ?? ""
			}`,
		[rows],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the Set is rebuilt from `rows` only when the content signature above moves; a `rows` dependency would rebuild it on every flush, which is the per-update cost this memo exists to remove.
	const loadedCheckpointIds = useMemo(
		() => new Set(rows.map((row) => row.record.id)),
		[loadedIdSignature],
	);
	const loadedCheckpoints = useMemo(
		() =>
			checkpoints.filter((checkpoint) =>
				loadedCheckpointIds.has(checkpoint.id),
			),
		[checkpoints, loadedCheckpointIds],
	);
	const syncActiveCheckpoint = useCallback(() => {
		const region = regionRef.current;
		if (region === null) return;
		const top = region.getBoundingClientRect().top;
		let best: string | null = null;
		let bestTop = Number.NEGATIVE_INFINITY;
		let first: string | null = null;
		let last: string | null = null;
		for (const checkpoint of loadedCheckpoints) {
			const element = region.querySelector(
				`[data-record-id="${CSS.escape(checkpoint.id)}"]`,
			);
			if (element === null) continue;
			if (first === null) first = checkpoint.id;
			last = checkpoint.id;
			const elementTop = element.getBoundingClientRect().top;
			if (
				elementTop <= top + TRANSCRIPT_TOP_FADE_PX + 1 &&
				elementTop > bestTop
			) {
				bestTop = elementTop;
				best = checkpoint.id;
			}
		}
		/*
		 * The ends, over the same mounted set the line rule walks: at an end the
		 * line rule cannot light the extreme marks (module header's ends note),
		 * and the arm is re-picked every read, so a view pinned at an end keeps
		 * it across appends and prepends. `last` is the last COMPLETED
		 * checkpoint by construction - `loadedCheckpoints` is the manifest's own
		 * list, and a live or partial turn carries no manifest entry.
		 */
		const span = region.scrollHeight - region.clientHeight;
		const atBottom = Math.abs(region.scrollTop) <= ACTIVE_CUE_EDGE_EPSILON_PX;
		const atTop =
			Math.abs(region.scrollTop + span) <= ACTIVE_CUE_EDGE_EPSILON_PX;
		if (atBottom) best = last;
		else if (atTop) best = first;
		setActiveCheckpointId((previous) => (previous === best ? previous : best));
	}, [regionRef, loadedCheckpoints]);
	/*
	 * The scroll listener reads the scan through a ref (UI perf audit A2): the
	 * listener must be attached ONCE per region, but the scan it calls changes
	 * whenever the loaded set does. Reading the latest scan from a ref is what
	 * lets the two effects below have stable dependencies — the alternative, the
	 * single effect keyed on `syncActiveCheckpoint`, is what detached and
	 * re-attached the listener on every flush. The ref write is during render,
	 * as `rowsRef`/`widenInputs` in `canonical-transcript.tsx` do, so the listener
	 * always sees the scan of the last committed render.
	 */
	const syncRef = useRef(syncActiveCheckpoint);
	syncRef.current = syncActiveCheckpoint;
	/*
	 * The listener, attached once per region. Its rAF leading read and its 160ms
	 * trailing read are unchanged (the header's N1 measurement); only the
	 * attachment cadence moved.
	 */
	useEffect(() => {
		const region = regionRef.current;
		if (region === null) return;
		let frame = 0;
		let settle = 0;
		const onScroll = () => {
			if (frame === 0) {
				frame = window.requestAnimationFrame(() => {
					frame = 0;
					syncRef.current();
				});
			}
			/*
			 * The trailing read: re-armed by every event, so it fires once the
			 * stream goes idle. See the header's N1 note for the measurement.
			 */
			window.clearTimeout(settle);
			settle = window.setTimeout(() => {
				settle = 0;
				syncRef.current();
			}, ACTIVE_CUE_SETTLE_MS);
		};
		region.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			region.removeEventListener("scroll", onScroll);
			if (frame !== 0) window.cancelAnimationFrame(frame);
			window.clearTimeout(settle);
		};
	}, [regionRef]);
	/*
	 * The LOAD's own read, kept separate from the listener because it has a
	 * different clock: a page that lands without a scroll must still re-read (the
	 * loaded set is this effect's dependency), and it is now the only thing that
	 * re-runs per loaded-set change — the mount read rides on it too.
	 */
	useEffect(() => {
		syncActiveCheckpoint();
	}, [syncActiveCheckpoint]);
	return { activeId: activeCheckpointId, loadedIds: loadedCheckpointIds };
};
