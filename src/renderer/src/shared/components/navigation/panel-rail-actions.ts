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
import { canvasDoorView, useCanvasStore } from "@shared/store/canvas-store";
import {
	type RightSlotRouteFacts,
	resolveDrawnRightSlotPane,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { DRAFT_CONSOLE_OWNER } from "../../../../../shared/console-owner";
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
 * The fields are optional because the arms that read them are the console's,
 * the ask's and the canvas's; the others act on store state alone, and a caller
 * that only drives one of those (the run trigger's click) does not fabricate
 * values for fields its action cannot read. An arm whose required field is absent
 * returns `false` — "did not act", the return value the callers use exactly for
 * the cases where the press could not mean anything.
 */
export type PanelRailActionContext = {
	/**
	 * The conversation this route is showing, as the VIEW reads it — on a draft
	 * whose first send has already created its transcript this is the created
	 * session's id (`panelSessionIdOfView`), before the message is admitted.
	 *
	 * IT IS NOT WHAT THE CONSOLE OPENS ON: that is `consoleOwner` below.
	 */
	sessionId?: string | null;
	/**
	 * WHICH CONSOLE THIS PRESS OPENS, from `consoleOwnerForView`: the pending
	 * local console's constant while the view is still a draft, the
	 * conversation's id otherwise.
	 *
	 * A FIELD OF ITS OWN, not a convenience (agent review round 2, R2a). A
	 * draft's first send patches the created transcript's id onto the draft row
	 * before the message is admitted (and keeps it through a refusal, so the
	 * retry addresses the same conversation), while the pane is still scoped to
	 * the pending owner. Read as `sessionId`, the press filed an open for a
	 * conversation the console has NOT been handed to yet — the closed drawer
	 * opened onto a pane that ignored the request, creating no shell and
	 * focusing nothing. The rail's door, the header's row and the chord all
	 * derive this from the same rule the pane does (`consoleOwnerForView`), so
	 * caller and pane cannot disagree.
	 *
	 * ASK AND CANVAS KEEP READING `sessionId`: conversation identity is not
	 * repurposed across arms.
	 *
	 * Absent is the legacy reading for callers with no draft view (the stories
	 * and fixtures): `sessionId ?? DRAFT_CONSOLE_OWNER`.
	 */
	consoleOwner?: string | null;
	/** Which queue the ask door opens (the scope the route's own door passes). */
	askScope?: AskScope;
	/**
	 * The canvas store's key for this conversation (the chat's `agentId`, NOT
	 * the session id — `canvas-store.ts` keys per conversation). The projects
	 * door needs it to pick the canvas's view; the canvas door reads it to step
	 * off that view. Every canvas door passes it — the rail, the header row and
	 * the chord (`runKeymapAction` derives it from the active conversation) —
	 * because a door without it would reopen on a stored Projects view (R1-1).
	 * Absent leaves the canvas arm a plain toggle and the projects arm inert.
	 */
	canvasConversationId?: string | null;
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
		case "canvas": {
			/*
			 * WHENEVER THE STORED VIEW IS PROJECTS, the canvas door is unlit and says
			 * "Open canvas", so its press OPENS the canvas's own views — whether the
			 * pane is drawn on Projects (switch the view, keep the pane) or closed
			 * (switch, then open). The closed case is round-1 R1-1/U1/Q-1: the
			 * Projects door's close (and the pane's own ✕) leave `viewMode` at
			 * `projects`, so a plain toggle reopened the pane on Projects with this
			 * door still unlit, and the chord alternated open-on-Projects/close and
			 * never reached files. The view is the last one the user had
			 * (`canvasDoorView`), written BEFORE the open so the first frame is it.
			 */
			const id = context.canvasConversationId;
			const conversation = id
				? useCanvasStore.getState().conversations[id]
				: undefined;
			if (id && conversation?.viewMode === "projects") {
				useCanvasStore.getState().setViewMode(id, canvasDoorView(conversation));
				if (resolveDrawnRightSlotPane(state) !== "canvas") {
					state.setCanvasOpen(true);
				}
				return true;
			}
			state.setCanvasOpen(!state.isCanvasOpen);
			return true;
		}
		case "projects": {
			/*
			 * A DOOR INTO THE CANVAS, not a pane: lit means "the canvas is drawn on
			 * its Projects view", so the press closes exactly that, and otherwise
			 * points the canvas at Projects and claims the slot (which also swaps
			 * out any other pane or the Asks drawer, `claimRightSlot`). The view is
			 * written BEFORE the claim so the pane's first frame is the list, never
			 * a flash of the documents view.
			 */
			const id = context.canvasConversationId;
			if (!id) return false;
			const canvas = useCanvasStore.getState();
			if (
				resolveDrawnRightSlotPane(state) === "canvas" &&
				canvas.conversations[id]?.viewMode === "projects"
			) {
				state.setCanvasOpen(false);
				return true;
			}
			canvas.setViewMode(id, "projects");
			state.setCanvasOpen(true);
			return true;
		}
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
			 * ON A DRAFT THE PANE OPENS ONTO A REAL TERMINAL (the pending local
			 * console), so the press files the same request a conversation's does —
			 * against the shared draft owner rather than a session id, because a draft
			 * has none and the shell must outlive this draft's key.
			 *
			 * IT USED TO TOGGLE ONLY, with a note that a draft "has no working
			 * directory to spawn one in". That is no longer true: the composer's staged
			 * directory is the draft's, and main starts the shell there.
			 */
			state.setConsolePaneOpen(true);
			/*
			 * THE REQUEST NAMES THE CONSOLE'S OWNER, NOT THE VIEW'S TRANSCRIPT
			 * (agent review round 2, R2a): on a draft whose send is held or refused
			 * those two differ, and a request filed against the transcript is one the
			 * mounted pane — scoped by `consoleOwnerForView` — ignores, which is a
			 * pane that opens and never creates or focuses the shell the user asked
			 * for. `?? DRAFT_CONSOLE_OWNER` keeps the legacy callers' meaning (a
			 * caller with no draft view has no wire owner, and the constant is the
			 * pending console's one spelling).
			 */
			state.requestConsoleOpen(
				context.consoleOwner ?? context.sessionId ?? DRAFT_CONSOLE_OWNER,
			);
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
