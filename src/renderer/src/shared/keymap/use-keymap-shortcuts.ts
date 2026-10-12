/**
 * The one keydown router for user-assignable shortcuts (issue #928).
 *
 * WHY A ROUTER AND NOT A LISTENER PER ACTION. Before this, each gesture owned
 * its own listener with its own modifier guard, and a user-assignable chord has
 * no owner to hang a listener on: any action may hold any chord tomorrow, so the
 * decision has to be made once, from the registry, per press. Mounted once in
 * `app.tsx` beside the palette's door (both have to exist for whatever surface
 * the window is showing).
 *
 * BUBBLE PHASE, NON-CAPTURING — `defaultPrevented` is the whole reason. React
 * handlers run as the event bubbles through the root container and a surface
 * that claims a key calls `preventDefault`; a CAPTURE-phase listener on
 * `document` would run before any of them and could not see the claim. The
 * palette's file states the same rule for `Cmd+K`. The named consequence is the
 * terminal: xterm consumes what the shell needs and calls `preventDefault()` +
 * `stopPropagation()`, so those presses never reach this listener — `Ctrl+J`
 * keeps meaning "newline" while a shell has focus, on the platforms whose
 * shell consumes it, and a press that travels no further simply does nothing.
 * The pane's own copy chord (`console-mirror.tsx`) is unaffected.
 *
 * PER EVENT, IN ORDER (the RFC's dispatch precedence, as code):
 *   1. `defaultPrevented` → return (an editor or overlay got here first);
 *   2. `repeat` / `isComposing` → return (holding a chord must not strobe, and
 *      an IME composition is not a gesture);
 *   3. no `metaKey || ctrlKey` → return; build the canonical chord; no match in
 *      the effective map → return;
 *   4. the press landed on an open dialog/menu/listbox → return (its surface
 *      owns its own keys);
 *   5. the action's door is absent → return WITHOUT `preventDefault` (nothing
 *      happened, so nothing is swallowed);
 *   6. `preventDefault()`, then run the action.
 *
 * The store is read through `getState()` at press time (the palette hook's own
 * idiom): a listener that closed over the bindings would answer with the render
 * it was born in after any settings change.
 */

import { pressLandsOnOverlay } from "@features/chat/keyboard-scopes";
import {
	panelRailDoorPresent,
	togglePanelRailItem,
} from "@shared/components/navigation/panel-rail-actions";
import {
	panelSessionIdOfView,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import {
	type RightSlotRouteFacts,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { useEffect } from "react";
import { chordFromEvent } from "./chord-capture";
import { buildChordMap } from "./keymap-chord";
import type { ActionId, ShortcutBindings } from "./keymap-registry";

/**
 * The press, as the decision reads it — structural, so a test can build one.
 * `KeyboardEvent` satisfies it.
 */
export type KeymapPress = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	repeat: boolean;
	isComposing: boolean;
	defaultPrevented: boolean;
	target: EventTarget | null;
};

/** Everything the decision reads besides the press itself. */
export type KeymapDispatchSource = {
	bindings: ShortcutBindings | undefined;
	route: RightSlotRouteFacts;
};

/**
 * The action a press should run, or `null` when the press is not ours — the
 * pure half of the router, in the RFC's precedence order. `null` means "do
 * nothing at all"; the caller may not preventDefault on it, because steps 1-5
 * are also the list of presses some other surface may still be entitled to.
 */
export function keymapEventAction(
	press: KeymapPress,
	source: KeymapDispatchSource,
): ActionId | null {
	if (press.defaultPrevented) return null;
	if (press.repeat || press.isComposing) return null;
	if (!(press.metaKey || press.ctrlKey)) return null;
	const chord = chordFromEvent(press);
	if (chord === null) return null;
	const actionId = buildChordMap(source.bindings).get(chord);
	if (actionId === undefined) return null;
	if (pressLandsOnOverlay(press.target)) return null;
	if (!panelRailDoorPresent(railIdOf(actionId), source.route)) return null;
	return actionId;
}

/**
 * The rail item an action drives.
 *
 * Every shipped id is `panel.<rail item>` by construction (the six actions ARE
 * the six doors), so the suffix IS the rail id — one vocabulary, sliced rather
 * than re-listed, so a seventh action cannot be added with the mapping left
 * behind. The cast is the price of the slice; a new id that is not a rail item
 * is a compile-time question for the registry's union.
 */
const railIdOf = (actionId: ActionId) =>
	actionId.slice("panel.".length) as Parameters<typeof togglePanelRailItem>[0];

/**
 * Run one action: the toggle functions are the rail's — one path, two doors
 * (the click and the chord cannot drift into two behaviours for one control).
 *
 * The console's conversation id is derived HERE, from the same
 * `panelSessionIdOfView` expression the pane keys on, because the dispatcher has
 * no rail props to read: a stale request against a switched conversation would
 * run a shell nobody asked for.
 */
function runKeymapAction(actionId: ActionId): void {
	const sessions = useCanonicalSessionsStore.getState();
	const draft = sessions.activeDraftKey
		? sessions.drafts[sessions.activeDraftKey]
		: undefined;
	const sessionId =
		panelSessionIdOfView(
			sessions.activeDraftKey,
			draft?.sessionId,
			sessions.activeSessionId,
		) ?? null;
	togglePanelRailItem(railIdOf(actionId), {
		sessionId,
		askScope: sessionId === null ? "fleet" : "session",
	});
}

export function useKeymapShortcuts(): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const state = useUiPreferencesStore.getState();
			const actionId = keymapEventAction(event, {
				bindings: state.shortcutBindings,
				route: state.rightSlotRoute,
			});
			if (actionId === null) return;
			event.preventDefault();
			runKeymapAction(actionId);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);
}
