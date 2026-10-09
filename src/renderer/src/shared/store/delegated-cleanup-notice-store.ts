/**
 * Where the one-time delegated-cleanup notice lives between the answers that
 * carry it and the reader's dismissal.
 *
 * WHY A STORE. The backend serves this notice on EVERY `sessions.list` answer
 * until it is acknowledged: the GET is a non-consuming PEEK, and the reader's
 * dismissal posts `delegated-cleanup-notice/ack` (the write half lives beside
 * the lift in `desktop-api.ts`, `dismissDelegatedCleanupNotice`). Every answer
 * that carries the field must reach the SAME held copy regardless of which of
 * the list's five callers asked, so the field is lifted out of the response at
 * the transport (`desktopResult`) and held here rather than read by any one
 * component.
 *
 * WHY IT PERSISTS (unlike `update-notice-store`'s notices, which are facts about
 * one run). This one is a fact about the STORE, and the field stops arriving
 * only once a dismissal has acknowledged it: if a window is closed while the
 * notice is held, that window was never told, and a fresh window must still
 * meet it - here AND in a second window, which keeps seeing it on its own list
 * answers until the ack lands. It is held in `localStorage` until dismissed and
 * then removed, so the reader sees it at least once - at-least-once on the
 * client, over a server that serves it until told otherwise.
 *
 * A LATER NOTICE REPLACES AN UNDISMISSED ONE, never stacks: the server sends a
 * single notice per store, so a second arrival is a newer reading of the same
 * drain (higher `removed`, a flipped `in_progress`). An IDENTICAL arrival
 * changes nothing (see `receive`): on the peek contract every list answer
 * carries the field, and the sidebar polls, so a re-render per answer is what
 * that guard exists to prevent.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DelegatedCleanupNotice } from "../../../../shared/desktop-contract";

type DelegatedCleanupNoticeState = {
	notice: DelegatedCleanupNotice | null;
	receive: (notice: DelegatedCleanupNotice) => void;
	dismiss: () => void;
};

/**
 * Whether an arrival reads as the SAME notice as the held one, field for
 * field.
 *
 * The route is a peek, so every `sessions.list` answer carries the field while
 * the store is unacknowledged, and the sidebar polls on a seconds cadence.
 * Without this comparison each answer would replace the held object and
 * re-render the band - a flicker per poll. A DIFFERENT reading still replaces
 * (these seven fields are exactly what the band paints), which is the
 * newer-arrival case the header states.
 */
const sameNotice = (
	held: DelegatedCleanupNotice | null,
	arrival: DelegatedCleanupNotice,
): boolean =>
	held !== null &&
	held.message === arrival.message &&
	held.removed === arrival.removed &&
	held.max_age_hours === arrival.max_age_hours &&
	held.in_progress === arrival.in_progress &&
	held.first_removal_at === arrival.first_removal_at &&
	held.freed_bytes_estimate === arrival.freed_bytes_estimate &&
	held.record === arrival.record;

/**
 * Narrow an untrusted wire value to the notice, or `null`.
 *
 * The daemon is another process and its field is typed `dict` on the wire, so
 * the shape is checked rather than cast: `message` is the one field the band
 * cannot render without, and the numbers are read defensively because a notice
 * with a missing count is still worth showing.
 */
export function parseDelegatedCleanupNotice(
	value: unknown,
): DelegatedCleanupNotice | null {
	if (typeof value !== "object" || value === null) return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.message !== "string" || raw.message.trim() === "") return null;
	const num = (field: unknown, fallback: number) =>
		typeof field === "number" && Number.isFinite(field) ? field : fallback;
	return {
		message: raw.message,
		removed: num(raw.removed, 0),
		max_age_hours: num(raw.max_age_hours, 48),
		in_progress: raw.in_progress === true,
		first_removal_at:
			typeof raw.first_removal_at === "string" ? raw.first_removal_at : "",
		freed_bytes_estimate:
			typeof raw.freed_bytes_estimate === "number" &&
			Number.isFinite(raw.freed_bytes_estimate)
				? raw.freed_bytes_estimate
				: null,
		record: typeof raw.record === "string" ? raw.record : "",
	};
}

export const useDelegatedCleanupNoticeStore =
	create<DelegatedCleanupNoticeState>()(
		persist(
			(set) => ({
				notice: null,
				/*
				 * An identical re-arrival returns the HELD state, not a copy: zustand
				 * skips the notify when the next state is the same object, and the band
				 * holding the same reference does not re-render. A different arrival
				 * (a newer reading) replaces as it always did.
				 */
				receive: (notice) =>
					set((state) =>
						sameNotice(state.notice, notice) ? state : { notice },
					),
				/*
				 * HALF a dismissal: this drops the held copy only. The wire half - the
				 * ack that stops the server serving the field - is `desktop-api.ts`'s
				 * `dismissDelegatedCleanupNotice`, which is what the band and the tests
				 * drive; this alone leaves the field on every later answer, which is the
				 * failed-ack state (acceptable, not desired).
				 */
				dismiss: () =>
					set((state) => (state.notice === null ? state : { notice: null })),
			}),
			{
				name: "delegated-cleanup-notice",
				/*
				 * An EXPLICIT storage factory that REFUSES an absent store, rather than
				 * the middleware's default `() => localStorage` - the same guard its
				 * sibling `update-notice-store.ts` carries, for the same reason.
				 * Zustand's own degradation is keyed on `createJSONStorage` returning
				 * undefined, which it does only when the factory THROWS. Node's
				 * `localStorage` is a declared global that is `undefined` without
				 * `--localstorage-file`, so the default factory does not throw,
				 * `createJSONStorage` builds a wrapper around `undefined`, and the first
				 * write rejects asynchronously with "Cannot read properties of undefined
				 * (reading 'setItem')" - and this store's first write is `receive` from
				 * an ordinary list answer, so any harness without a DOM hits it the
				 * moment the notice arrives. Throwing here hands the middleware the
				 * answer it has a branch for: warn once and keep the store in memory. A
				 * notice that cannot be persisted is a notice that lasts the session,
				 * and that is strictly better than a broken band.
				 */
				storage: createJSONStorage(() => {
					if (typeof localStorage === "undefined" || localStorage === null) {
						throw new Error("no localStorage in this environment");
					}
					return localStorage;
				}),
				partialize: (state) => ({ notice: state.notice }),
			},
		),
	);
