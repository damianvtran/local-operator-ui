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
