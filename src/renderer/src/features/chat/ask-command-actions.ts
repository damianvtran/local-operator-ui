/**
 * The ask card's suggested-command doors, as the two drawer mounts use them.
 *
 * Both the session drawer (`chat-content.tsx`) and the fleet drawer
 * (`fleet-ask-drawer.tsx`) need the same two things: WHERE the agent of an
 * ask's conversation works (the placement that gates Run…), and a way to file
 * the one-shot console intent and open that conversation's terminal pane. They
 * live here so the two mounts cannot drift into two answers to either.
 *
 * READ AT CALL TIME FROM THE STORES, NOT SUBSCRIBED: the placement is read while
 * the panel renders its rows (it re-renders on the ask clock's tick and on every
 * frame) and again at the press, so a mount does not have to subscribe a large
 * component to the whole sessions catalogue for a fact that changes rarely.
 */
import { apiConfig } from "@shared/config";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { NavigateFunction } from "react-router-dom";
import type { PendingAsk } from "../../../../shared/desktop-session-contract";
import {
	type AskAgentPlacement,
	askAgentPlacement,
	askCommandOf,
	askCommandRunnable,
} from "./ask-command";
import { type AskDismissals, askDismissals } from "./ask-open-policy";
import { openConversation } from "./open-conversation";

/** Where the agent of `sessionId` works, relative to this computer, now. */
export function readAskAgentPlacement(
	sessionId: string | null | undefined,
): AskAgentPlacement {
	const { sessions, placementFacts } = useCanonicalSessionsStore.getState();
	return askAgentPlacement({
		sessionId,
		backendUrl: apiConfig.baseUrl,
		sessions,
		placementFacts,
	});
}

/**
 * File the console intent for `sessionId` and open its terminal pane.
 *
 * DEFENCE IN DEPTH, AT THE LAST STEP: the command must still be one of the
 * ask's own validated commands (so a caller cannot smuggle another string
 * through this door), and a `submit` is refused unless Run is still allowed for
 * the conversation's placement as read NOW — the card's gate is a rendering,
 * and the placement can change between the render and the confirm. Answers
 * whether anything was filed.
 *
 * ORDER: the intent first, then the pane — the pane may mount on this very
 * `set()` and read the intent on its first effect. Opening the console claims
 * the right slot, which closes the ask drawer (one right pane at a time); the
 * composer's ask chip brings the card back.
 */
export function fileAskCommand(request: {
	sessionId: string;
	ask: PendingAsk;
	command: string;
	submit: boolean;
}): boolean {
	const hint =
		request.ask.questions
			.map((question) => askCommandOf(question))
			.find((candidate) => candidate?.command === request.command) ?? null;
	if (hint === null) return false;
	if (
		request.submit &&
		!askCommandRunnable(hint, readAskAgentPlacement(request.sessionId))
	) {
		return false;
	}
	const ui = useUiPreferencesStore.getState();
	ui.requestConsoleCommand({
		sessionId: request.sessionId,
		command: hint.command,
		submit: request.submit,
	});
	ui.setConsolePaneOpen(true);
	return true;
}

/**
 * The FLEET drawer's press (decision D1): the card may belong to ANOTHER
 * conversation, so the press opens that conversation and then files the
 * intent for it.
 *
 * THREE STEPS, IN THIS ORDER, and the order is the fix for a measured defect:
 *
 *  1. Record the ask as waved off for its conversation (`askDismissals`).
 *     Entering a conversation with a pending ask runs the ask-open policy, whose
 *     `pending-on-open` verdict opens the session drawer — which claims the
 *     right slot back from the console the press is about to open. Measured in
 *     the built app (2026-11-13): the drawer came back over the terminal and the
 *     command was never typed. The record is the policy's own mechanism for
 *     "the user turned the surface away over live asks" — the in-conversation
 *     Insert writes the same record when the console replaces the drawer (rule
 *     4) — and it is held against THIS ask's id only, clearing itself once a
 *     frame shows the ask is no longer outstanding. The composer's ask chip
 *     still brings the card back at any time.
 *  2. Open the conversation (`openConversation`: the store write and the
 *     route, as a sidebar click does). The switch re-binds the right slot to
 *     that conversation synchronously (`right-slot-follower.ts`).
 *  3. File the intent and open the console (`fileAskCommand`) — now that
 *     conversation's pane, and the intent names it (the F-6 rule).
 *
 * The collaborators are parameters so the order is testable without a router.
 */
export function fileFleetAskCommand(
	request: {
		sessionId: string;
		ask: PendingAsk;
		command: string;
		submit: boolean;
		navigate: NavigateFunction;
	},
	deps: {
		dismissals: Pick<AskDismissals, "record">;
		open: (navigate: NavigateFunction, sessionId: string) => unknown;
		file: typeof fileAskCommand;
	} = {
		dismissals: askDismissals,
		open: openConversation,
		file: fileAskCommand,
	},
): boolean {
	deps.dismissals.record(request.sessionId, {
		outstandingIds: [request.ask.ask_id],
		listComplete: true,
	});
	void deps.open(request.navigate, request.sessionId);
	return deps.file({
		sessionId: request.sessionId,
		ask: request.ask,
		command: request.command,
		submit: request.submit,
	});
}
