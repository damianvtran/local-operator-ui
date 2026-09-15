/**
 * The palette's keyboard door, mounted for the whole session.
 *
 * One `keydown` listener on `window`, non-capturing, which is what makes the
 * "an editor got here first" rule in `palette-shortcut.ts` work: React's
 * handlers run as the event bubbles through the root container, so a canvas
 * editor that preventDefaults Cmd+K is already saying "claimed" by the time this
 * listener sees the event.
 *
 * The listener is registered once and toggles through the store rather than
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
}
