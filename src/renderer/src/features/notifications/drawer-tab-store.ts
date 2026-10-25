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
