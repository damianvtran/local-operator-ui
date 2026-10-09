/**
 * Where the one-time delegated-cleanup notice lives between the response that
 * carried it and the reader's dismissal.
 *
 * WHY A STORE. The backend serves this notice AT MOST ONCE per store: reading it
 * flips `notice_acknowledged` on disk (`take_unannounced_delegated_notice`). The
 * response that carries it is the sidebar's poll, which nothing keeps, so a
 * component that rendered it straight from the response would lose it on the
 * next refresh - and the backend would never repeat it. The notice is therefore
 * lifted out of the response at the transport (`desktopResult`) and held here.
 *
 * WHY IT PERSISTS (unlike `update-notice-store`'s notices, which are facts about
 * one run). This one is a fact about the STORE, delivered exactly once: if the
 * window is closed before it is read, the server has already forgotten it, and
 * keeping it in memory only would make "you were told once" a lie. It is held
 * in `localStorage` until dismissed and then removed, so the reader sees it at
 * least once - at-least-once on the client is what an at-most-once server needs.
 *
 * A LATER NOTICE REPLACES AN UNDISMISSED ONE, never stacks: the server sends a
 * single notice per store, so a second arrival is a newer reading of the same
 * drain (higher `removed`, a flipped `in_progress`).
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
				receive: (notice) => set({ notice }),
				dismiss: () => set({ notice: null }),
			}),
			{
				name: "delegated-cleanup-notice",
				storage: createJSONStorage(() => localStorage),
				partialize: (state) => ({ notice: state.notice }),
			},
		),
	);
