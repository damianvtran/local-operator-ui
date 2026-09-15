/**
 * The palette's keyboard doors, mounted for the whole session.
 *
 * TWO gestures, one owner, because the two halves are wired differently and a
 * change to one of them can silently kill the other. Both are answered here so
 * that "where does the palette open from" has one answer instead of two.
 *
 * - **Cmd/Ctrl+K** — one `keydown` listener on `window`, non-capturing, which is
 *   what makes the "an editor got here first" rule in `palette-shortcut.ts` work:
 *   React's handlers run as the event bubbles through the root container, so a
 *   canvas editor that preventDefaults Cmd+K is already saying "claimed" by the
 *   time this listener sees the event.
 * - **Cmd/Ctrl+P** — an IPC message from main's `before-input-event` hook
 *   (`src/main/index.ts`), which is where it has always been: that hook fires
 *   before the renderer sees the key at all, so a renderer listener could not
 *   answer it, and main has already swallowed the press by the time it sends.
 *   The subscription lives here rather than beside the palette's mount because
 *   main's half keeps working whether or not anything listens — a dropped
 *   subscription is a chord that does nothing and says nothing (round 1, R-1).
 *
 * The K listener is registered once and toggles through the store rather than
 * closing over `isCommandPaletteOpen`, so a keypress never sees a stale flag and
 * the effect never re-registers while the user is typing.
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useEffect } from "react";
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
	 * The older gesture, from the process that owns it.
	 *
	 * `on` returns its own unsubscribe, which is what the app shell used to call
	 * here; it is not optional and must not be dropped, or a session that mounts
	 * this twice (a StrictMode remount, a second window) toggles twice per press
	 * and the palette never opens.
	 */
	useEffect(() => {
		const unsubscribe = window.electron.ipcRenderer.on(
			"toggle-command-palette",
			toggleCommandPalette,
		);
		return () => {
			unsubscribe?.();
		};
	}, [toggleCommandPalette]);
}
