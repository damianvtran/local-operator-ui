/**
 * @file language-dialog-store.ts
 * @description
 * The one door to "change the interface language" from anywhere in the app.
 *
 * ## Why a store rather than a route
 *
 * The command palette's row (i18n slice B2) is the door this store was built
 * for, and the same reasoning as `connect-provider-store.ts` applies: a route
 * would unmount the conversation, and the dialog is a focused question about
 * one setting rather than a destination. `LanguageDialog` is mounted once, in
 * the app shell, and answers whoever asks.
 *
 * OWNERSHIP IS UNCHANGED BY THE DOOR (the accepted proposal): the settings
 * page's row stays the canonical editor; this dialog is the same editor at
 * palette reach, writing the same backend setting through the same ops.
 */

import { create } from "zustand";

type LanguageDialogState = {
	open: boolean;
	openLanguage: () => void;
	closeLanguage: () => void;
};

export const useLanguageDialogStore = create<LanguageDialogState>()((set) => ({
	open: false,
	openLanguage: () => set({ open: true }),
	closeLanguage: () => set({ open: false }),
}));
