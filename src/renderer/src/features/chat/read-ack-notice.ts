import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import type {
	ReadAckNotice,
	ReadAckNoticeKind,
} from "@shared/store/canonical-sessions-store";

/*
 * What the per-row read receipt says when it has not landed.
 *
 * WHY THIS IS A MODULE AND NOT TWO TEMPLATE LITERALS. The receipt's state is the
 * one thing about this feature the operator could not see (UX round 1's U1: a
 * receipt the store had refused twice a second and one the ladder had given up
 * retrying on left the same screen, the mark, and the difference went to
 * `console.warn`), so the words ARE the fix rather than a label on it. They are
 * composed here, out of the component, for the reason the panel's other decision
 * modules exist (`mark-all-read.ts`, `chat-search.ts`): a JSX condition and a
 * template literal are not things a test can drive, and this copy has to be
 * exactly right rather than approximately right.
 *
 * TWO CHANNELS, ONE HOME. The row's clause is the pointer's and the keyboard's
 * (it rides the row's flyout and its `aria-describedby`, the two channels
 * `SILENT_REMEDY` already uses), and the toast is the announcement that survives
 * the reader navigating away - the same lane, and the same sentence shape, the
 * bulk receipt's own failure uses one control up. Both come from THIS file so a
 * rewording cannot land in one and miss the other; what differs between them is
 * register (a clause on a row, a sentence in a toast), not fact.
 */

/**
 * The move that releases a deferred receipt.
 *
 * It is true because the press is what resets the ladder (`readAckRearm`): the
 * operator's own remedy for a mark that did not clear, which is the act this
 * whole feature is about.
 */
const RETRY_REMEDY = "click the chat to try again";

/**
 * The same remedy as a sentence, which is the toast's own ending.
 *
 * Spelled out rather than derived by capitalizing the fragment: the two are one
 * remedy in two registers (a clause on a row, a sentence in a toast), and a
 * `.toUpperCase()` on a shared string is the kind of cleverness that outlives
 * whoever needed it.
 */
const RETRY_REMEDY_SENTENCE = "Click the chat to try again.";

/**
 * The row's clause, one per state the loop can publish.
 *
 * Each names the state AND its remedy, because the state that needs the remedy
 * most is the one a reader cannot otherwise act on:
 *
 * - `pending` — the app is retrying now (a contention budget, the ladder's flat
 *   window). The register is the bulk control's in-flight cue, where the glyph
 *   steps down and the label keeps its ink.
 * - `offscreen` — the one refusal a press cannot repair. The anchor hit test is
 *   the definition of "shown", so a completion whose result is off screen is
 *   never receipted, and scrolling is the move that both shows it and releases
 *   the receipt (the next tick finds it and the mark clears on its own).
 * - `unsettled` — the ladder has pushed the cadence out to its ceiling. This is
 *   the arm U1 is about: the mark is still there and the app has stopped trying
 *   promptly, so the clause says so and names the press.
 */
export const READ_ACK_NOTICE_CLAUSE: Record<ReadAckNoticeKind, string> = {
	pending: "marking read",
	offscreen: "scroll to the result to mark this chat read",
	unsettled: `not marked read · ${RETRY_REMEDY}`,
};

/**
 * The clause for one row, or `null` when the receipt has nothing to say about it.
 *
 * Takes the row's id rather than the row, so the caller cannot ask a question
 * about a notice and a row that disagree: the notice names one conversation and
 * every row asks whether it is that one.
 */
export const readAckClause = (
	notice: ReadAckNotice | null,
	sessionId: string,
): string | null =>
	notice && notice.sessionId === sessionId
		? READ_ACK_NOTICE_CLAUSE[notice.kind]
		: null;

/**
 * The sentence the give-up arm is announced with.
 *
 * Two facts, in the shape `chat-sidebar.tsx` composes for the pile: what the
 * transport said (through the app's own translator, with the same fallback every
 * other desktop failure in this panel uses), and what it means for the reader -
 * because a refusal of a receipt is not a claim that the conversation is
 * unread, it is a claim that THIS mark did not move. The remedy closes it, so a
 * reader who never hovers the row still has the move.
 */
export const readAckNoticeSentence = (notice: ReadAckNotice): string =>
	`${userFacingMessage(notice.reason, "The backend did not answer.")} The unread mark was not cleared. ${RETRY_REMEDY_SENTENCE}`;
