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
 * subscriber, keeps it while later subscribers agree on the deadline (see
 * `arm`), and clears it when the last one leaves, so a mounted transcript
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
/*
 * What the pending timer was aimed at, and the two clocks' readings when it was
 * armed. Together they answer "is the pending timer still the right one?"
 * without touching it - see `arm`.
 */
let pendingDeadline = 0;
let armedWall = 0;
let armedMono = 0;
const listeners = new Set<() => void>();

/*
 * How far the wall clock may move against the monotonic one before the pending
 * timer is presumed stale. A second is far above the jitter of reading two
 * clocks back to back, and far below any suspend or clock step worth noticing.
 */
const CLOCK_DRIFT_TOLERANCE_MS = 1000;

/*
 * The monotonic clock a `setTimeout` delay is measured on. Absent in no runtime
 * this module ships to; the fallback only keeps a bare test runner from throwing,
 * and it makes every drift read 0 (so the deadline comparison alone decides).
 */
const monoNow = (): number =>
	typeof performance === "undefined" ? Date.now() : performance.now();

const arm = (): void => {
	/*
	 * THE DEADLINE IS RECOMPUTED ON EVERY SUBSCRIBE, AND THE TIMER IS REPLACED
	 * ONLY WHEN IT WOULD BE WRONG. The deadline is a function of the clock, so a
	 * timer armed before a suspend/resume, a `TZ` change, or a test's mocked clock
	 * can carry the OLD deadline and the day would never turn for the new
	 * subscriber - which is why every subscribe re-derives it. But re-arming
	 * unconditionally (what this did until the conversation-first-paint work)
	 * cost a `clearTimeout` + `setTimeout` pair per stamped row: a transcript
	 * mounting 61 rows did 61 scheduler round trips inside its one mount task to
	 * leave exactly the timer it started with (renderer profile §4 L2-d).
	 *
	 * The pending timer is kept when BOTH hold:
	 *   - the freshly computed deadline equals the one it was armed for (same
	 *     local day, same zone: a `TZ` change or a day turned while asleep moves
	 *     the next local midnight, so it fails this);
	 *   - the wall clock has not moved against the monotonic clock since it was
	 *     armed. A `setTimeout` delay runs on monotonic time, which does not
	 *     advance while the machine sleeps; a suspend that ends on the SAME day
	 *     keeps the deadline equal but leaves the timer due late by the length
	 *     of the sleep. That is the case the deadline alone cannot see, and the
	 *     drift check is what keeps the documented suspend property.
	 * Otherwise it is cleared first, so the one-timer property still holds.
	 */
	const now = Date.now();
	const deadline = now + msUntilNextLocalDay(now);
	const mono = monoNow();
	if (
		timer !== null &&
		deadline === pendingDeadline &&
		Math.abs(now - armedWall - (mono - armedMono)) <= CLOCK_DRIFT_TOLERANCE_MS
	) {
		return;
	}
	if (timer !== null) clearTimeout(timer);
	pendingDeadline = deadline;
	armedWall = now;
	armedMono = mono;
	timer = setTimeout(() => {
		timer = null;
		snapshot = localDayStart(Date.now());
		for (const listener of listeners) listener();
		// Re-arm for the day after this one. The subscribers are still mounted
		// (they are what keeps the timer alive), so the store stays armed until
		// the last of them unsubscribes.
		arm();
	}, deadline - now);
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
