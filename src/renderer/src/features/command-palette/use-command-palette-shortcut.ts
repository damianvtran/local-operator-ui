/**
 * The palette's keyboard doors, mounted for the whole session.
 *
 * THREE gestures, ONE RULE (issue #850). `Cmd/Ctrl+K` opens the palette on chats
 * (`#`), `Cmd/Ctrl+P` opens it on everything (no seed), and `Cmd/Ctrl+Shift+P`
 * opens it on commands (`>`). What any of them DOES depends on where the palette
 * already is — a closed one opens, an open one showing that door's view closes,
 * an open one in another view switches — and that single rule is
 * `paletteDoorOutcome` in `palette-shortcut.ts`. This file is only the wiring:
 * which listener each chord arrives on, and the application of the decision to
 * the store.
 *
 * - **Cmd/Ctrl+K** — one `keydown` listener on `window`, non-capturing, which is
 *   what makes the "an editor got here first" rule in `palette-shortcut.ts` work:
 *   React's handlers run as the event bubbles through the root container, so a
 *   canvas editor that preventDefaults Cmd+K is already saying "claimed" by the
 *   time this listener sees the event.
 * - **Cmd/Ctrl+P and Cmd/Ctrl+Shift+P** — IPC messages from main's
 *   `before-input-event` hook (`src/main/index.ts`), which is where they have
 *   always been: that hook fires before the renderer sees the key at all, so a
 *   renderer listener could not answer them, and main has already swallowed the
 *   press by the time it sends. They are DISTINCT channels (issue #850): before
 *   this the hook did not look at Shift, so both chords arrived as one message
 *   and a third door was indistinguishable from the second.
 *
 * The subscriptions live here rather than beside the palette's mount because
 * main's half keeps working whether or not anything listens — a dropped
 * subscription is a chord that does nothing and says nothing (round 1, R-1).
 *
 * Every handler reads the store through `getState()` rather than closing over
 * `isCommandPaletteOpen`, so a keypress never sees a stale flag and the effects
 * never re-register while the user is typing.
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useEffect } from "react";
import type { PaletteDoor } from "./palette-shortcut";
import { paletteDoorOutcome, paletteShortcutIntent } from "./palette-shortcut";

/*
 * The channels main sends on, spelled here as literals for the same reason the
 * preload spells its own list that way: main and the renderer are separate
 * bundles, and the strings are the contract between them.
 */
const EVERYTHING_DOOR_CHANNEL = "toggle-command-palette";
const COMMANDS_DOOR_CHANNEL = "toggle-command-palette-commands";

/**
 * Apply a door's press to the live palette.
 *
 * The decision is pure (`paletteDoorOutcome`); this applies it. Deliberately a
 * module-level function reading the store, not a `useCallback` closing over
 * component state: a listener registered once would capture the first render's
 * closure, and the whole point is that a press sees the CURRENT palette.
 */
function applyPaletteDoor(door: PaletteDoor): void {
	const state = useUiPreferencesStore.getState();
	const outcome = paletteDoorOutcome(door, {
		open: state.isCommandPaletteOpen,
		query: state.commandPaletteQuery,
	});
	/*
	 * `toggleCommandPalette(seed)` is the store's own seeded open — it flips the
	 * flag AND writes the query in one commit, which is why the open arm uses it
	 * rather than `openCommandPalette()` followed by a second write.
	 */
	if (outcome.action === "open") state.toggleCommandPalette(outcome.query);
	else if (outcome.action === "close") state.closeCommandPalette();
	else state.setCommandPaletteQuery(outcome.query);
}

export function useCommandPaletteShortcut(): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const door = paletteShortcutIntent(event);
			if (!door) return;
			/*
			 * preventDefault is the point rather than a formality: the app's own
			 * prefixed gestures must not also reach whatever has focus — a
			 * CodeMirror buffer, the WYSIWYG editor, an input — while the palette
			 * is opening over them. It is also what keeps Cmd+K from ALSO being
			 * seen as a plain "k" by whatever the palette is about to cover.
			 */
			event.preventDefault();
			applyPaletteDoor(door);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	/*
	 * The two main-process doors, and the unsubscribe they return. The teardown is
	 * not optional: a session that mounts this twice (a StrictMode remount, a
	 * second window) would otherwise answer one press twice.
	 *
	 * The wrapper functions are load-bearing for the same reason they always were:
	 * `ipcRenderer.on` hands its listener the IPC event as the first argument, and
	 * passing `applyPaletteDoor` directly would try to read a door off that event.
	 */
	useEffect(() => {
		const unsubscribeEverything = window.electron.ipcRenderer.on(
			EVERYTHING_DOOR_CHANNEL,
			() => applyPaletteDoor("everything"),
		);
		const unsubscribeCommands = window.electron.ipcRenderer.on(
			COMMANDS_DOOR_CHANNEL,
			() => applyPaletteDoor("commands"),
		);
		return () => {
			unsubscribeEverything?.();
			unsubscribeCommands?.();
		};
	}, []);
}
