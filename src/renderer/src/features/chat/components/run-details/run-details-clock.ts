/**
 * The run-details clock: the one figure in the panel that is a function of when
 * it is read.
 *
 * A running child's elapsed label is measured from `start_time`, so it freezes
 * the moment the wire goes quiet — and the wire DOES go quiet. `frontend.update`
 * is published only when the runtime has a field delta to send (`_frontend()` in
 * the backend's session bridge), and the stream's only periodic frame is a 15s
 * heartbeat, which the renderer's frame loop drops deliberately
 * (`use-canonical-session.ts`: `if (frame.type === "heartbeat") continue`) —
 * precisely so that an idle session does not repaint. Without a clock of its
 * own, a child thinking for ninety seconds would read the same number for
 * ninety seconds. The TUI re-derives its own roster at 1Hz for the same reason,
 * and this is that decision, in the same place.
 *
 * Scoped to the surface that draws a number rather than hoisted, exactly as the
 * tool row's clock is scoped to its own `StatusCluster` (`trace/tool-row.tsx`):
 * a ticker in a parent repaints every memoised row — and the transcript beside
 * it — once a second to move one number. There are two such surfaces in this
 * pane and one clock between them: the roster's rows (`useRunDetailsClock`) and
 * the reader's own header (`useChildRowClock`), which the pane mounts in place of
 * the roster rather than beside it, so only one interval is ever running. The
 * panel is the only surface that draws an elapsed value at all (the trigger's
 * tooltip carries counts, not durations), and it mounts only while the pane is
 * open. So an idle session, a settled panel and the legacy path — which has no
 * canonical stream and therefore no model — hold no timer.
 */

import { useEffect, useState } from "react";
import {
	type RunDetails,
	type SubagentRow,
	hasLiveChildClock,
	retimeChildRow,
	retimeRunDetails,
} from "./run-detail-model";

/** 1Hz: the label it moves carries whole seconds, so a faster clock is churn. */
const CLOCK_MS = 1000;

/**
 * The interval BOTH clocks share: one 1Hz tick, alive only while the figure it
 * moves is on screen.
 *
 * Extracted rather than written twice because the two consumers are the two
 * halves of one rule (`§ 5.1`, `§ 5.3`): the roster's rows and the reader's own
 * header draw the same elapsed value from the same model, and a second interval
 * with its own seed and its own cleanup is how the two would come to disagree
 * about when a clock is live.
 *
 * The seed is the instant the model was MEASURED at rather than `Date.now()`: a
 * story pins `nowMs` so its frames are reproducible, and a tick seeded from the
 * wall clock would print the months between for such a fixture. It is also why
 * the caller adds `(tickMs - measuredAtRealMs)` to `measuredAtMs` rather than
 * reading the clock directly.
 */
const useClockTick = (active: boolean, seedRealMs: number): number => {
	const [tickMs, setTickMs] = useState(seedRealMs);
	useEffect(() => {
		if (!active) return;
		const read = () => setTickMs(Date.now());
		read();
		const timer = window.setInterval(read, CLOCK_MS);
		return () => window.clearInterval(timer);
	}, [active]);
	return tickMs;
};

export function useRunDetailsClock(details: RunDetails): RunDetails {
	/*
	 * Only a row that has been launched and has not settled has a clock that is
	 * still running; the predicate is the model's, so what it means is asserted in
	 * `run-detail-model.test.mjs` rather than only claimed here. A settled child is
	 * measured against its own `settled_at` and a child with no launch time at all
	 * shows no duration, so neither of them can go stale — and neither of them
	 * justifies a timer.
	 *
	 * The TOOL jobs are asked the same question, and that is a change this file's
	 * section owes: the pane now draws a running `bash` job's elapsed label in the
	 * Jobs section (`run-detail-jobs.tsx`), so a session whose only live work is a
	 * backgrounded shell would otherwise have a frozen clock on screen — a
	 * timestamp that says `3s` forty seconds in, which is worse than no clock at
	 * all. `retimeRunDetails` re-measures that list on the same tick for the same
	 * reason, so the two halves cannot disagree.
	 *
	 * What this file adds is the timer's LIFETIME, not its rule: the interval is
	 * created when something live is on screen and cleared when the panel
	 * closes or the last child settles. That part is a behaviour and is
	 * exercised against the running panel rather than asserted here.
	 */
	const ticking =
		hasLiveChildClock(details.subagents) || hasLiveChildClock(details.jobs);
	const tickMs = useClockTick(ticking, details.measuredAtRealMs);
	if (!ticking) return details;
	/*
	 * Real time since the model was measured, added to the model's OWN instant.
	 * Reading the wall clock directly would work for a live session and report
	 * the months between for a story, whose fixture pins `nowMs` (see
	 * `RunDetails.measuredAtMs`).
	 */
	return retimeRunDetails(
		details,
		details.measuredAtMs + (tickMs - details.measuredAtRealMs),
	);
}

/**
 * The READER's clock: the same tick, for the one row a reader's header draws.
 *
 * The reader is mounted by the pane rather than by the roster's body, so it is
 * not on `useRunDetailsClock`'s path — and a running child's header sat on the
 * label the wire last published for it while the roster beside it ticked (round
 * 1, Q3: six samples of `running 3s` over 20 s, and `2m3s` only once the child
 * settled). It reuses the same model rule and the same interval rather than a
 * second clock of its own: `retimeChildRow` is the one-row half of
 * `retimeRunDetails`, and the predicate below is the row-level form of
 * `hasLiveChildClock`.
 *
 * ONE ticker is alive at a time in practice, which is why this is not the
 * "ticker in a parent" this file's docstring refuses: the pane renders the
 * reader OR the roster, never both, so the two hooks never run together.
 * Rendering the reader from a retimed list up at the pane would instead repaint
 * the child's whole transcript once a second to move one number.
 */
export function useChildRowClock(
	row: SubagentRow,
	/**
	 * The instants the model was measured at, from the pane's `RunDetails`. They
	 * are the reader's only tie to the model's clock: the row's own `startSeconds`
	 * is epoch seconds off the wire, and a story's `nowMs` is pinned, so a label
	 * derived from `Date.now()` alone would be right for a live session and wrong
	 * for every frame of the set.
	 */
	anchors: { measuredAtMs: number; measuredAtRealMs: number },
): SubagentRow {
	const ticking = row.startSeconds !== null && row.settledSeconds === null;
	const tickMs = useClockTick(ticking, anchors.measuredAtRealMs);
	if (!ticking) return row;
	return retimeChildRow(
		row,
		anchors.measuredAtMs + (tickMs - anchors.measuredAtRealMs),
	);
}
