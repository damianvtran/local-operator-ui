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
 * The conditions are the ITEMS' mount gates, stated once (`chat-content`'s
 * `rightSlotRoute` is the published form of the same facts — see its note for
 * why the split is exactly these): run needs run details; console needs a
 * conversation; code review needs the capability and a conversation; the asks
 * item needs a host to offer the door (the fleet drawer's home is the shell, so
 * its offer is its own fact, not a route shape).
 */
export function panelRailDoorPresent(
	id: PanelRailItemId,
	route: RightSlotRouteFacts,
): boolean {
	switch (id) {
		case "run":
			return route.runDetails;
		case "console":
			return route.mounted && route.session;
		case "browser":
		case "canvas":
			return route.mounted;
		case "code":
			return route.mounted && route.session && route.codeReview;
		case "ask":
			return route.asksOffered;
	}
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
};

/**
 * Perform one rail item's press, live from the store, returning whether it
 * acted. The sequences are the ones the rail's items shipped with (each item's
 * own comment argued its half); the ask arm keeps the item's scope rule — a
 * press while THIS scope is open closes, a press while another scope is open
 * re-scopes — and the console arm keeps the two-step open the pane keys on.
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
			 * A CLOSE ALWAYS ACTS — the pane is on screen and the press means "put
			 * it away" even on a route whose conversation has gone (the claim can
			 * outlive the route; the slot's resolver is what refuses to draw it,
			 * and the same close the item's own press performs is the honest one).
			 */
			if (state.isConsolePaneOpen) {
				state.setConsolePaneOpen(false);
				return true;
			}
			if (context.sessionId === undefined || context.sessionId === null) {
				return false;
			}
			state.setConsolePaneOpen(true);
			state.requestConsoleOpen(context.sessionId);
			return true;
		}
		case "ask": {
			if (context.askScope === undefined) return false;
			state.setAskDrawerOpen(
				!(state.isAskDrawerOpen && state.askDrawerScope === context.askScope),
				context.askScope,
			);
			return true;
		}
	}
}
