/**
 * The palette's keyboard doors, mounted for the whole session.
 *
 * TWO gestures, TWO jobs, one owner each, because the two halves are wired
 * differently and a change to one of them can silently kill the other. Both are
 * answered here so that "where does the palette open from" has one answer
 * instead of two.
 *
 * - **Cmd/Ctrl+K** — one `keydown` listener on `window`, non-capturing, which is
 *   what makes the "an editor got here first" rule in `palette-shortcut.ts` work:
 *   React's handlers run as the event bubbles through the root container, so a
 *   canvas editor that preventDefaults Cmd+K is already saying "claimed" by the
 *   time this listener sees the event. It opens the palette as it always did: no
 *   seed, every source, the browse list that teaches the prefixes.
 * - **Cmd/Ctrl+P** — an IPC message from main's `before-input-event` hook
 *   (`src/main/index.ts`), which is where it has always been: that hook fires
 *   before the renderer sees the key at all, so a renderer listener could not
 *   answer it, and main has already swallowed the press by the time it sends.
 *   Since issue #659 it opens the palette SEEDED to its conversations source
 *   (`CONVERSATION_SWITCHER_SEED`) — the quick switcher, not a second copy of
 *   Cmd/Ctrl+K — and since review round 2 (U5) it MOVES an already-open
 *   palette to that view rather than closing it: "switcher" muscle memory
 *   expects the scope to change, and a close would cost the chord two presses
 *   to do the one thing it exists to do. Closing stays a press away (Escape,
 *   Cmd/Ctrl+K, a click out). The subscription lives here rather than beside
 *   the palette's mount because main's half keeps working whether or not
 *   anything listens — a dropped subscription is a chord that does nothing and
 *   says nothing (round 1, R-1).
 *
 * The K listener is registered once and toggles through the store rather than
 * closing over `isCommandPaletteOpen`, so a keypress never sees a stale flag and
 * the effect never re-registers while the user is typing.
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useEffect } from "react";
import { CONVERSATION_SWITCHER_SEED } from "./palette-search";
import type { PaletteShortcutIntent } from "./palette-shortcut";
import { paletteShortcutIntent } from "./palette-shortcut";

export type { PaletteShortcutIntent };

export function useCommandPaletteShortcut(): void {
	const toggleCommandPalette = useUiPreferencesStore(
		(state) => state.toggleCommandPalette,
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (paletteShortcutIntent(event) !== "toggle") return;
			/*
			 * preventDefault is the point rather than a formality: the app's own
			 * prefixed gestures must not also reach whatever has focus — a
			 * CodeMirror buffer, the WYSIWYG editor, an input — while the palette
			 * is opening over them.
			 */
			event.preventDefault();
			toggleCommandPalette();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [toggleCommandPalette]);

	/*
	 * The Cmd/Ctrl+P door, and what it asks for (issue #659): the palette
	 * seeded to its conversations source, so this chord is a conversation quick
	 * switcher rather than a second copy of Cmd/Ctrl+K. The wrapper is
	 * load-bearing on two counts - `ipcRenderer.on` hands its listener the IPC
	 * event as the first argument, and a direct reference would try to seed the
	 * query with that event; and the unsubscribe `on` returns is not optional -
	 * a session that mounts this twice (a StrictMode remount, a second window)
	 * would otherwise toggle twice per press and the palette would never open.
	 */
	useEffect(() => {
		const openConversationSwitcher = () => {
			/*
			 * WHILE THE PALETTE IS ALREADY OPEN, the switcher key moves it to the
			 * conversations view instead of closing it (review/UX round 1, U5),
			 * re-applying the seed exactly the way the toggle applies it — so a
			 * palette already showing `#retention` returns to all chats. Read
			 * through `getState()` for the same reason the K handler toggles
			 * through the store: a press must never see a stale flag.
			 */
			const state = useUiPreferencesStore.getState();
			if (state.isCommandPaletteOpen)
				state.setCommandPaletteQuery(CONVERSATION_SWITCHER_SEED);
			else state.toggleCommandPalette(CONVERSATION_SWITCHER_SEED);
		};
		const unsubscribe = window.electron.ipcRenderer.on(
			"toggle-command-palette",
			openConversationSwitcher,
		);
		return () => {
			unsubscribe?.();
		};
	}, []);
}
