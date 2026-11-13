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
import {
	panelSessionIdOfView,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import {
	type ConsoleCommandIntent,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import type { NavigateFunction } from "react-router-dom";
import type { PendingAsk } from "../../../../shared/desktop-session-contract";
import {
	type AskAgentPlacement,
	askAgentPlacement,
	askCommandOf,
	askCommandRunnable,
} from "./ask-command";
import { type AskDismissals, askDismissals } from "./ask-open-policy";
import type { AskPresentation } from "./ask-queue";
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
 * whether anything was filed — the Run dialog keeps itself open with a reason
 * when it was not (agent review round 1, m3).
 *
 * BY QUESTION ID, NOT BY COMMAND TEXT (agent review round 1, n2): two questions
 * of one ask may carry the same string with different targets, and a match on
 * the text would gate the second by the first one's target.
 *
 * ORDER: the intent first, then the pane — the pane may mount on this very
 * `set()` and read the intent on its first effect. Opening the console claims
 * the right slot, which closes the ask drawer (one right pane at a time); the
 * composer's ask chip brings the card back.
 */
export function fileAskCommand(request: {
	sessionId: string;
	ask: PendingAsk;
	questionId: string;
	command: string;
	submit: boolean;
}): boolean {
	const question = request.ask.questions.find(
		(candidate) => candidate.id === request.questionId,
	);
	const hint = askCommandOf(question ?? null);
	if (hint === null || hint.command !== request.command) return false;
	if (
		request.submit &&
		!askCommandRunnable(hint, readAskAgentPlacement(request.sessionId))
	) {
		return false;
	}
	const ui = useUiPreferencesStore.getState();
	const filed = ui.requestConsoleCommand({
		sessionId: request.sessionId,
		command: hint.command,
		submit: request.submit,
		askId: request.ask.ask_id,
		questionId: request.questionId,
	});
	dropConsoleCommandOnLeave(filed);
	ui.setConsolePaneOpen(true);
	return true;
}

/** The slice of the conversation store the leave-drop reads. */
type ViewedConversation = {
	activeSessionId: string | null;
	activeDraftKey: string | null;
	drafts: Readonly<Record<string, { sessionId?: string | null } | undefined>>;
};

/** The conversation the chat view shows, by the store's own rule
 * (`panelSessionIdOfView`): an admitted draft shows its session, a fresh one
 * shows none, otherwise the active session. */
const viewedSessionId = (state: ViewedConversation): string | undefined =>
	panelSessionIdOfView(
		state.activeDraftKey,
		state.activeDraftKey ? state.drafts[state.activeDraftKey]?.sessionId : null,
		state.activeSessionId,
	);

/**
 * DROP THE PRESS IF THE USER LEAVES ITS CONVERSATION BEFORE IT IS PICKED UP
 * (QA round 1 Q1, agent review round 1 m2(b)).
 *
 * The repro: confirm Run…, switch conversation at once, and the command used to
 * wait in the store and run when the user came back — after the ask had
 * closed. A confirm is consent to run NOW, in the conversation it was made in.
 * So from the moment of filing, the first store change that shows the user
 * viewing anything else (another conversation, or a fresh New-chat draft —
 * read by the store's own `panelSessionIdOfView`, so an admitted draft that IS
 * this conversation is not leaving) clears this press by its nonce. The fleet press opens the target
 * conversation BEFORE filing (`openConversation` writes `activeSessionId`
 * synchronously), so its own switch is never read as leaving; a refused open
 * that restores the previous conversation IS leaving, and drops it.
 *
 * The watch ends on its own the moment the intent is no longer this press
 * (picked up, replaced, or dropped), so it never outlives one press. The stores
 * are parameters so the rule is testable without the app.
 */
export function dropConsoleCommandOnLeave(
	filed: Pick<ConsoleCommandIntent, "sessionId" | "nonce">,
	deps: {
		viewed: {
			getState: () => ViewedConversation;
			subscribe: (listener: (state: ViewedConversation) => void) => () => void;
		};
		ui: {
			getState: () => {
				consoleCommandIntent: Pick<ConsoleCommandIntent, "nonce"> | null;
				clearConsoleCommandIntent: (nonce: string) => void;
			};
			subscribe: (
				listener: (state: {
					consoleCommandIntent: Pick<ConsoleCommandIntent, "nonce"> | null;
				}) => void,
			) => () => void;
		};
	} = { viewed: useCanonicalSessionsStore, ui: useUiPreferencesStore },
): void {
	const isOurs = () =>
		deps.ui.getState().consoleCommandIntent?.nonce === filed.nonce;
	const left = (state: ViewedConversation) =>
		viewedSessionId(state) !== filed.sessionId;
	let stopViewed: (() => void) | null = null;
	let stopUi: (() => void) | null = null;
	const stop = () => {
		stopViewed?.();
		stopUi?.();
		stopViewed = null;
		stopUi = null;
	};
	stopUi = deps.ui.subscribe(() => {
		if (!isOurs()) stop();
	});
	stopViewed = deps.viewed.subscribe((state) => {
		if (!isOurs()) {
			stop();
			return;
		}
		if (left(state)) {
			stop();
			deps.ui.getState().clearConsoleCommandIntent(filed.nonce);
		}
	});
}

/**
 * The pane's submit guard, as a pure reading (`ConsolePane`'s
 * `allowCommandSubmit`): may this confirmed Run still press Enter NOW?
 *
 * Yes only while all three hold at pickup: the ask is in the conversation's
 * current view and still answerable (`canAnswer`), the question still carries
 * the SAME validated command, and Run is still allowed for the placement read
 * now. Anything missing — the ask gone, settled, expired, the command changed,
 * the agent moved to a peer — answers no, and the pane makes nothing.
 */
export function askCommandStillRunnable(request: {
	rows: readonly Pick<AskPresentation, "ask" | "canAnswer">[];
	intent: Pick<ConsoleCommandIntent, "askId" | "questionId" | "command">;
	placement: AskAgentPlacement;
}): boolean {
	const { intent } = request;
	if (intent.askId === undefined || intent.questionId === undefined)
		return false;
	const row = request.rows.find(
		(candidate) => candidate.ask.ask_id === intent.askId,
	);
	if (!row?.canAnswer) return false;
	const question = row.ask.questions.find(
		(candidate) => candidate.id === intent.questionId,
	);
	const hint = askCommandOf(question ?? null);
	if (hint === null || hint.command !== intent.command) return false;
	return askCommandRunnable(hint, request.placement);
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
		questionId: string;
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
		questionId: request.questionId,
		command: request.command,
		submit: request.submit,
	});
}
