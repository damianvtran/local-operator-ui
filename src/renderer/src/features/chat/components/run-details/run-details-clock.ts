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
 * Scoped to the panel rather than hoisted, exactly as the tool row's clock is
 * scoped to its own `StatusCluster` (`trace/tool-row.tsx`): a ticker in a parent
 * repaints every memoised row — and the transcript beside it — once a second to
 * move one number. The panel is the only surface that draws an elapsed value at
 * all (the trigger's tooltip carries counts, not durations), and it mounts only
 * while the popover is open, which the trigger gates on there being work to
 * show. So an idle session, a settled panel and the legacy path — which has no
 * canonical stream and therefore no model — hold no timer.
 */

import { useEffect, useState } from "react";
import { type RunDetails, retimeRunDetails } from "./run-detail-model";

/** 1Hz: the label it moves carries whole seconds, so a faster clock is churn. */
const CLOCK_MS = 1000;

export function useRunDetailsClock(details: RunDetails): RunDetails {
	/*
	 * Only a child that has been launched and has not settled has a clock that
	 * is still running. A settled child is measured against its own `settled_at`
	 * and a child with no launch time at all shows no duration, so neither of
	 * them can go stale — and neither of them justifies a timer.
	 */
	const ticking = details.subagents.some(
		(row) => row.startSeconds !== null && row.settledSeconds === null,
	);
	/*
	 * Seeded with the instant the model was measured at, not with `Date.now()`:
	 * until the first tick the two are the same thing, and seeding from the
	 * model means the first frame after a new wire delta shows that delta's own
	 * labels rather than a value re-derived against a clock the model has not
	 * caught up with.
	 */
	const [tickMs, setTickMs] = useState(() => details.measuredAtRealMs);
	useEffect(() => {
		if (!ticking) return;
		const read = () => setTickMs(Date.now());
		read();
		const timer = window.setInterval(read, CLOCK_MS);
		return () => window.clearInterval(timer);
	}, [ticking]);
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
