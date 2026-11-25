/**
 * THE PENDING LOCAL CONSOLE'S OWNER.
 *
 * A New Conversation has no session yet, but the console pane is open on it and
 * the user's press there means "give me a shell now", not "wait until I have sent
 * something". So the surface is born under THIS identifier, which no conversation
 * can ever be: it is a fixed string, not a session id, and every real session id
 * comes from the owner (a UUID) or from a draft's own key. The pane on a draft
 * reads and creates through it, and the surfaces it makes are therefore invisible
 * to every conversation's pane (each one filters the listing by its own session).
 *
 * WHY ONE IDENTIFIER FOR EVERY DRAFT rather than one per New Conversation press.
 * The requirement is that a shell survives the draft it was opened in: a second
 * New chat press mints a fresh draft key (`sidebar-navigation.tsx`), and a
 * per-key owner would strand the running shell under a key nothing will use
 * again. Whatever key the sidebar is on, the pane on a draft is looking at the
 * same pending console — which is also what makes "open the console, wander off
 * to a conversation, come back" land on the terminal that is still running.
 *
 * WHAT HAPPENS TO IT. A draft's FIRST SUCCESSFUL SEND names the conversation it
 * created, and main moves every surface from here onto that id
 * (`ConsoleHost.adoptPendingConsole`): the handle, the pty, its byte log and its
 * emulator state all stay, only the owner changes, so the pane of the new
 * conversation is showing the terminal the user was already typing into. A send
 * that FAILS adopts nothing — `finishDraft` is what triggers the move, and it
 * runs only on a message the owner accepted.
 *
 * IT IS NOT AN AGENT'S TO REACH. `requireOwned`'s fence is a session id, so this
 * constant would otherwise be a session an agent could claim (main's console
 * dispatch refuses it outright — `dispatchConsole`). Surfaces here are made by a
 * person at a pane, and they belong to a conversation only once that conversation
 * exists.
 */
export const DRAFT_CONSOLE_OWNER = "draft:local-console";

/**
 * Whether an owner identifier is the pending local console's.
 *
 * Exported as a predicate rather than compared inline in three processes because
 * the value must be spelled the same way wherever it is refused: main's agent
 * dispatch, main's adoption and the renderer's pane all ask this question, and a
 * second spelling of the constant is a hole one of them would miss.
 */
export const isDraftConsoleOwner = (
	sessionId: string | null | undefined,
): boolean => sessionId === DRAFT_CONSOLE_OWNER;

/**
 * Which console a chat pane is showing, from the two facts the pane has.
 *
 * A DRAFT VIEW OWNS THE PENDING CONSOLE EVEN WHEN A SESSION ID EXISTS FOR IT, and
 * that is the whole reason this is a function rather than `sessionId ?? DRAFT`.
 * A draft's first send creates the conversation BEFORE the message is admitted
 * (`canonical-sessions-store` patches the row's `sessionId` at the create's
 * answer, so a retry addresses the same session), which means the pane holds a
 * real session id for a row that is still an unsent, unadopted draft. Read as
 * `sessionId ?? DRAFT`, the pane would switch to the new conversation's console
 * the instant the create answered — empty, because main has not moved the
 * surfaces yet and must not until the send is accepted — and a REFUSED first
 * send would leave the user staring at “no console” while their shells are still
 * running under the pending owner (QA round 1's Q1, UX round 1's U1).
 *
 * THE OWNER FLIPS AT THE RETIRE, NOT AT THE CREATE: `draftView` is the page's
 * `activeDraftKey` (null once `finishDraft` retires the row), which the send path
 * also reads as “a staged new conversation is still the view”. So create,
 * in-flight admission and refusal all keep the pending owner on screen, and the
 * conversation's own pane takes over on the commit that shows the conversation.
 *
 * A LIVE SESSION IS NEVER THE PENDING OWNER: with no draft view the answer is the
 * session id, or null when the pane has neither (no console to scope).
 */
export function consoleOwnerForView(
	draftView: boolean,
	sessionId: string | null | undefined,
): string | null {
	if (draftView) return DRAFT_CONSOLE_OWNER;
	return sessionId ?? null;
}
