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
import type { PendingAsk } from "../../../../shared/desktop-session-contract";
import {
	type AskAgentPlacement,
	askAgentPlacement,
	askCommandOf,
	askCommandRunnable,
} from "./ask-command";

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
