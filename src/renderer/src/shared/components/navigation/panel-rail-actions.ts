/**
 * The panel rail's presses, as functions two doors share (issue #928).
 *
 * WHY EXTRACTED. The rail's items and the keyboard router must perform the SAME
 * write for a given panel — the rail's own comment on the console says the open
 * request "tells it this open came from the user", and a second spelling of that
 * sequence for the chord is exactly how the two doors drift. So the toggle
 * sequences live here once; the rail's `onClick`s and `useKeymapShortcuts` both
 * call them, and the door-presence table below is what the dispatcher gates on
 * before it runs anything (a chord acts iff the rail item would render — the
 * item and the chord answer to one condition, or a user would meet a chord
 * whose door does not exist).
 */

import type { AskScope } from "@features/chat/ask-queue";
import {
	type RightSlotRouteFacts,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import type { PanelRailItemId } from "./panel-rail-model";

/**
 * Whether this route could render the rail item an action drives.
 *
 * EVERY DOOR IS PRESENT WHEREVER THE RAIL IS (the always-visible rail, D1): the
 * rail mounts with the chat surface, and on that surface all six doors render
 * whatever the conversation's state - a pane that cannot act yet opens to a
 * notice that says why. The function stays, taking the id, because the keymap
 * dispatcher gates on it (`use-keymap-shortcuts.ts`): the chord and the door
 * answer to one rule, so a chord can never act where its door is not drawn.
 */
export function panelRailDoorPresent(
	_id: PanelRailItemId,
	route: RightSlotRouteFacts,
): boolean {
	return route.mounted;
}

/**
 * What a toggle needs to know beyond the store.
 *
 * Both fields are optional because the arms that read them are the console's
 * and the ask's; the other four act on store state alone, and a caller that
 * only drives one of those (the run trigger's click) does not fabricate values
 * for fields its action cannot read. An arm whose required field is absent
 * returns `false` — "did not act", the return value the callers use exactly for
 * the cases where the press could not mean anything.
 */
export type PanelRailActionContext = {
	/** The conversation the console opens in; null on a draft. */
	sessionId?: string | null;
	/** Which queue the ask door opens (the scope the route's own door passes). */
	askScope?: AskScope;
	/**
	 * The press came from a keyboard chord, not from the item under the pointer
	 * or the keyboard's focus. Only the ask arm reads it: a chord leaves no door
	 * focused, so its open has to say it was the user's (`requestAskOpen`).
	 */
	via?: "chord";
};

/**
 * Perform one rail item's press, live from the store, returning whether it
 * acted. The sequences are the ones the rail's items shipped with (each item's
 * own comment argued its half); the ask arm keeps the item's scope rule — a
 * press while THIS scope is open closes, a press while another scope is open
 * re-scopes — and the console arm keeps the two-step open the pane keys on. The
 * ask arm's close is the PRESSED kind, so it empties the slot rather than giving
 * it back (#1079).
 */
export function togglePanelRailItem(
	id: PanelRailItemId,
	context: PanelRailActionContext = {},
): boolean {
	const state = useUiPreferencesStore.getState();
	switch (id) {
		case "browser":
			state.setBrowserPaneOpen(!state.isBrowserPaneOpen);
			return true;
		case "canvas":
			state.setCanvasOpen(!state.isCanvasOpen);
			return true;
		case "code":
			state.setCodeReviewPaneOpen(!state.isCodeReviewPaneOpen);
			return true;
		case "run":
			state.setRunPanelOpen(!state.isRunPanelOpen);
			return true;
		case "console": {
			/*
			 * THE ITEM IS A TOGGLE WHILE THE PANE IS OPEN, ALWAYS (U5/m-5).
			 *
			 * The branch's first cut made a press on history-only pane mean "create a
			 * terminal", so the rail stopped closing the pane and a keyboard user who
			 * pressed the chord to put it away got a new shell. Openness is the pane's
			 * own state, not liveness: an unlit item on an open history pane still hides
			 * the pane when pressed, and a CLOSED pane is the open that may create
			 * (`requestConsoleOpen` + `consoleOpenAction`). The lit paint stays keyed to
			 * a running surface, which is a different fact from the toggle.
			 */
			if (state.isConsolePaneOpen) {
				state.setConsolePaneOpen(false);
				return true;
			}
			/*
			 * ON A DRAFT THE PANE STILL OPENS (D1): it draws its own "needs a
			 * conversation" state, which is the answer to the press. Only a press with
			 * a conversation files the open request - that request is what tells the
			 * pane this open came from the user and spawns a console, and a draft has
			 * no working directory to spawn one in.
			 */
			state.setConsolePaneOpen(true);
			if (context.sessionId) state.requestConsoleOpen(context.sessionId);
			return true;
		}
		case "ask": {
			if (context.askScope === undefined) return false;
			/*
			 * WHICH KIND OF CLOSE THIS PRESS IS (#1079). The item is a toggle in its own
			 * scope, so one of its two arms closes - and EVERY CLOSE THE USER ASKS FOR IS
			 * "EMPTY THE SLOT", not a withdrawal, so this arm is one of five doors that
			 * ask it (the header menu's `Close asks` row, the drawer's X, the composer
			 * chip, and this item's own chord running the same code). The rule and the
			 * give-back it withholds are in `AskDrawerCloseOptions`. The rail's item is
			 * "the same door in both directions" (`panel-rail.tsx`), so its close must
			 * leave the slot empty the way every sibling item's does rather than hand the
			 * borrowed pane back - where the closes NOBODY ASKED FOR keep the give-back
			 * (UX round 1, U6), and those are the ones that pass no option: the empty
			 * queue's auto-close, the carried fleet drawer being retired, Escape inside
			 * the drawer.
			 *
			 * THE RE-SCOPE ARM IS UNCHANGED: a press while the OTHER scope's drawer is up
			 * opens this scope (the user asked for a panel, not for an empty slot), so it
			 * passes no option either.
			 */
			const open = !(
				state.isAskDrawerOpen && state.askDrawerScope === context.askScope
			);
			state.setAskDrawerOpen(
				open,
				context.askScope,
				open ? undefined : { dismissSlot: true },
			);
			/*
			 * A CHORD'S OPEN FILES A REQUEST (round-1 Q1/m1 of the always-visible rail).
			 * The rail item's press is read off focus - the drawer finds the item focused
			 * and treats the mount as the user's - but a chord leaves focus wherever it
			 * was, so without a request the drawer took the mount for a carried flag and
			 * auto-closed it over an empty or unsupported queue. Filed AFTER the open,
			 * the menu row's order, because the open supersedes any request in flight.
			 */
			if (open && context.via === "chord") {
				state.requestAskOpen(context.askScope, "chord");
			}
			return true;
		}
	}
}
