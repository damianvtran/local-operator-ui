import { create } from "zustand";
import type { DrawerTab } from "./components/drawer-updates";

/**
 * The single ask door changes mounts when its scope changes (session body in
 * chat-content, fleet body in the shell). Carry the tab across that handoff,
 * rather than losing an Updates press while the old mount unmounts. Null uses
 * the open's default; callers clear it when closing or changing conversation.
 */
export const useNotificationDrawerTab = create<{
	tab: DrawerTab | null;
	setTab: (tab: DrawerTab | null) => void;
}>((set) => ({ tab: null, setTab: (tab) => set({ tab }) }));

/**
 * The drawer's back-to-top chip, handed from the list to the tab row (design round 6,
 * D2). The Updates list owns the scroll and the paged window, so it knows the count
 * and how to go back; the tab row is a sibling the chat drawer renders, so it cannot
 * receive props from the list. As a band above the list or an overlay on it the chip
 * cost the narrow drawer most of its 47 px scroll port at 200 % text; in the tab row
 * it costs the list nothing. Only one drawer is open at a time, so one slot is enough.
 * `backToTop` is null whenever no list is publishing (unmounted, or at the top).
 */
export const useDrawerBackToTop = create<{
	count: number;
	backToTop: (() => void) | null;
	publish: (count: number, backToTop: (() => void) | null) => void;
}>((set) => ({
	count: 0,
	backToTop: null,
	publish: (count, backToTop) => set({ count, backToTop }),
}));
