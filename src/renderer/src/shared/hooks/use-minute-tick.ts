import { useSyncExternalStore } from "react";

/**
 * One minute-aligned clock for every RELATIVE stamp on screen.
 *
 * `display.message_timestamp_style = relative` makes a stamp's text a function
 * of the current time, so something has to re-render it. One timer per row would
 * be a timer per message in a long transcript; this is one store, one timeout
 * aimed at the next minute boundary, shared by every subscriber. It exists only
 * while a subscriber does: an absolute-style transcript never subscribes
 * (`useMinuteNow(false)`), so it pays nothing. Same shape as
 * `use-calendar-day.ts`, which stays the absolute stamps' clock.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let snapshot = 0;

const arm = (): void => {
	if (timer !== null) clearTimeout(timer);
	const now = Date.now();
	timer = setTimeout(
		() => {
			timer = null;
			snapshot = Date.now();
			for (const listener of listeners) listener();
			arm();
		},
		60_000 - (now % 60_000),
	);
	// A pending tick must not hold the process or the app open on its own.
	timer.unref?.();
};

const subscribe = (listener: () => void): (() => void) => {
	// Only the FIRST subscriber starts the clock. A later one must not move the
	// shared snapshot (it would re-render every mounted relative stamp off-cycle).
	if (listeners.size === 0) {
		snapshot = Date.now();
		arm();
	}
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};
};

const idleSubscribe = (): (() => void) => () => {};
const read = (): number => {
	// First render of the first relative stamp happens before `subscribe` has
	// run; an unset snapshot would make every age negative ("just now").
	if (snapshot === 0) snapshot = Date.now();
	return snapshot;
};
const idleRead = (): number => 0;

/**
 * The instant of the last minute tick, or 0 while `active` is false (no
 * subscription, no timer). Stable between ticks, so a memoised row is not
 * re-rendered for it.
 */
export const useMinuteNow = (active: boolean): number =>
	useSyncExternalStore(
		active ? subscribe : idleSubscribe,
		active ? read : idleRead,
		active ? read : idleRead,
	);
