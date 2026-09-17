/**
 * The local calendar day, re-read exactly when it turns over.
 *
 * WHY THIS EXISTS, and it is a defect the always-visible stamp introduced
 * rather than one it inherited. `formatTurnTimestamp` decides "today" against a
 * `now` it is handed, and the stamp used to read that at render with no timer
 * behind it. A user row is `memo`ised and a settled conversation re-renders
 * only when a record or a prop changes, so an app left open overnight kept
 * printing a bare `3:42 PM` for a turn that had become yesterday's - and a bare
 * clock time reads as today. The hover-only stamp this feature reverses
 * computed its text on hover, so it could not go stale this way; an
 * always-on stamp can, which is why the boundary needs an owner
 * (review round 1, R5).
 *
 * ONE TIMER FOR THE WHOLE APP, not one per stamp. `turn-timestamp.tsx`'s own
 * performance contract forbids a per-second tick: a transcript paints per token
 * while a turn streams, and a stamp that woke every second would put a render
 * behind each of them for a value that changes once a day. The store below
 * therefore arms a single `setTimeout` to the next local midnight on the first
 * subscriber and clears it when the last one leaves, so a mounted transcript
 * costs one timer and one render per day, and an unmounted one costs neither.
 *
 * LOCAL MIDNIGHT, NOT A 24-HOUR DELAY: `nextLocalDayStart` builds the next
 * calendar day with `setDate(+1)` and floors it, so a 23-hour and a 25-hour day
 * (a DST transition) both land on the following 00:00 rather than an hour off.
 *
 * THE SNAPSHOT IS A NUMBER rather than a `Date`, because it is compared by
 * identity in `useSyncExternalStore`: a fresh `Date` per read would re-render
 * every subscriber forever.
 */

import { useSyncExternalStore } from "react";

/** The start of `ms`'s own local calendar day, in epoch milliseconds. */
export const localDayStart = (ms: number): number => {
	const day = new Date(ms);
	day.setHours(0, 0, 0, 0);
	return day.getTime();
};

/**
 * Milliseconds from `ms` to the next local midnight.
 *
 * Strictly positive: at exactly midnight it returns a whole day rather than
 * zero, so a subscriber that arrives on the boundary schedules the NEXT one and
 * cannot spin.
 */
export const msUntilNextLocalDay = (ms: number): number => {
	const next = new Date(ms);
	next.setHours(0, 0, 0, 0);
	next.setDate(next.getDate() + 1);
	return Math.max(1, next.getTime() - ms);
};

let snapshot = localDayStart(Date.now());
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const arm = (): void => {
	/*
	 * RE-ARMED ON EVERY SUBSCRIBE rather than only when no timer is pending, and
	 * the difference is not tidiness: the deadline is a function of the clock, so
	 * a timer armed before a suspend/resume, a `TZ` change, or a test's mocked
	 * clock would keep the OLD deadline and the day would never turn for the new
	 * subscriber. Clearing first keeps the one-timer property (a transcript
	 * mounting six stamps re-arms six times and still holds one timer) while
	 * making the pending deadline always the current clock's.
	 */
	if (timer !== null) clearTimeout(timer);
	timer = setTimeout(() => {
		timer = null;
		snapshot = localDayStart(Date.now());
		for (const listener of listeners) listener();
		// Re-arm for the day after this one. The subscribers are still mounted
		// (they are what keeps the timer alive), so the store stays armed until
		// the last of them unsubscribes.
		arm();
	}, msUntilNextLocalDay(Date.now()));
	// A pending midnight must not hold the process or the app open on its own.
	timer.unref?.();
};

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	snapshot = localDayStart(Date.now());
	arm();
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};
};

const read = (): number => snapshot;

/**
 * The start of the current local day, as a value a component can depend on.
 *
 * Re-renders its caller once per calendar day, at midnight, and only while it
 * is mounted.
 */
export const useCalendarDay = (): number =>
	useSyncExternalStore(subscribe, read, read);

/**
 * The current instant for a stamp, which is the day boundary plus a fixed
 * offset.
 *
 * `formatTurnTimestamp` only asks its `now` two questions - is this the same
 * calendar day, and is this the same calendar year - so the only part of `now`
 * a stamp can observe is the day (and, at the year boundary, the day too). A
 * value pinned a second past midnight therefore answers both exactly as `new
 * Date()` would, while being stable across renders, which is what lets a
 * memoised row skip work. The year is carried through so a stamp from a
 * previous December still resolves its year branch correctly.
 */
export const nowAtDayBoundary = (dayStart: number): Date =>
	new Date(dayStart + 1000);

/** The `now` a stamp should format against, recomputed on each local midnight. */
export const useStampNow = (): Date => nowAtDayBoundary(useCalendarDay());
