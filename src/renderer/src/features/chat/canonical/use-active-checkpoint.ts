/**
 * The rail's reader-side cue: the checkpoint the reader is LOOKING AT, and the
 * record ids the store holds (design round 1, D2 + U1).
 *
 * Derived from the transcript's own store and layout because that is where the
 * two meet: `loadedIds` is the record ids this store holds (everything else in
 * the manifest wears the light "unloaded" arm), and `activeId` is the last
 * loaded checkpoint above the scroller's top edge - so the ladder's top arm
 * tracks the reading position instead of a counter. The position read is
 * viewport-based (rects, not scrollTop) so it holds under either scroll
 * direction, and it is rAF-throttled: a scroll frame asks the DOM for the
 * loaded checkpoints' tops (bounded by the mounted window, not by the
 * manifest) and sets state only when the answer CHANGES.
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

import { useCallback, useEffect, useMemo, useState } from "react";
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
	const loadedCheckpointIds = useMemo(
		() => new Set(rows.map((row) => row.record.id)),
		[rows],
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
		for (const checkpoint of loadedCheckpoints) {
			const element = region.querySelector(
				`[data-record-id="${CSS.escape(checkpoint.id)}"]`,
			);
			if (element === null) continue;
			const elementTop = element.getBoundingClientRect().top;
			if (elementTop <= top + 1 && elementTop > bestTop) {
				bestTop = elementTop;
				best = checkpoint.id;
			}
		}
		setActiveCheckpointId((previous) => (previous === best ? previous : best));
	}, [regionRef, loadedCheckpoints]);
	useEffect(() => {
		const region = regionRef.current;
		if (region === null) return;
		let frame = 0;
		let settle = 0;
		const onScroll = () => {
			if (frame === 0) {
				frame = window.requestAnimationFrame(() => {
					frame = 0;
					syncActiveCheckpoint();
				});
			}
			/*
			 * The trailing read: re-armed by every event, so it fires once the
			 * stream goes idle. See the header's N1 note for the measurement.
			 */
			window.clearTimeout(settle);
			settle = window.setTimeout(() => {
				settle = 0;
				syncActiveCheckpoint();
			}, ACTIVE_CUE_SETTLE_MS);
		};
		region.addEventListener("scroll", onScroll, { passive: true });
		syncActiveCheckpoint();
		return () => {
			region.removeEventListener("scroll", onScroll);
			if (frame !== 0) window.cancelAnimationFrame(frame);
			window.clearTimeout(settle);
		};
	}, [regionRef, syncActiveCheckpoint]);
	return { activeId: activeCheckpointId, loadedIds: loadedCheckpointIds };
};
