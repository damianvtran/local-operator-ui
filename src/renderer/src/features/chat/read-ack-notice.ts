import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import type {
	ReadAckNotice,
	ReadAckNoticeKind,
} from "@shared/store/canonical-sessions-store";
import { STORE_BUSY_CODE } from "../../../../shared/desktop-session-contract";

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
 * THE RECEIPT WRITES ITS OWN SENTENCES, and that is the rule this module was
 * corrected to keep (design round 1, D1; UX round 2, U3). The give-up toast used
 * to open with the refusal painted verbatim through `userFacingMessage`, and the
 * refusal is the STORE LADDER's copy, written for the composer: the contention arm
 * ends "Try again in a moment", the 507 arm instructs the reader about "the
 * message" they were sending - a thing a read receipt does not have - and the
 * third arm ends up addressing an outage when the backend answered 200 and simply
 * did not settle the completion. Rendered, that was two retry instructions in one
 * toast, up to 248 characters and six lines (the design round's frames `11` and
 * `20`). So the sentences below are this app's, keyed on the CLASS of the refusal
 * rather than on its prose: whether the store was busy, whether it refused at all,
 * or whether there was no transport refusal to report. Nothing here echoes the
 * backend's sentence.
 *
 * TWO CHANNELS, ONE HOME. The row's clause is the pointer's and the keyboard's
 * (the flyout, and a description the row's `aria-describedby` names), and the
 * toast is the announcement that survives the reader navigating away - the same
 * lane the bulk receipt's own failure uses one control up. Both come from THIS
 * file so a rewording cannot land in one and miss the other; what differs between
 * them is register, and the register differs BETWEEN the two row channels too:
 * the flyout continues the status line's lowercase, comma-and-dot punctuation,
 * while a description is announced on its own after the row's name and needs to
 * be a sentence (`D4`: `aria-describedby` joins its targets with nothing but a
 * space, so a clause written for the flyout runs into whatever it follows).
 */

/**
 * The move that releases a deferred receipt.
 *
 * It is true because the press is what resets the ladder (`readAckRearm`): the
 * operator's own remedy for a mark that did not clear, which is the act this
 * whole feature is about. ONE spelling, used by both channels and by the toast,
 * because the design round's finding `D1` was exactly two instructions for one
 * act.
 */
const RETRY_REMEDY = "click the chat to try again";

/** The remedy above as its own sentence, which is how a toast ends. */
const RETRY_REMEDY_SENTENCE = "Click the chat to try again.";

/**
 * The row's clause per state - the FLYOUT's register.
 *
 * Each names the state and, where one exists, the move that ends it:
 *
 * - `pending` — the app is retrying now (a contention budget, the ladder's flat
 *   window). The register is the bulk lane's sentence SHAPE - one lowercase clause,
 *   no sentence punctuation - and the state it names is new: the bulk control's own
 *   in-flight cue is a glyph rather than a phrase (`LoaderCircle` beside an
 *   unchanged label), so this clause is the panel's first in-flight SENTENCE
 *   (design round 1, D6: the note used to describe that cue as a phrase).
 * - `offscreen` — the one refusal a press cannot repair. The anchor hit test is
 *   the definition of "shown", so a completion whose result is off screen is
 *   never receipted, and scrolling is the move that both shows it and releases
 *   the receipt (the next tick finds it and the mark clears on its own).
 * - `unsettled` — the ladder has pushed the cadence out to its ceiling, so the
 *   app has stopped retrying promptly. THE REMEDY ONLY (design round 1, `D2`):
 *   the state is already on the line four words earlier - the mark glyph and the
 *   `, unread` tail, both drawn from `unreadMarkKind` - and `SILENT_REMEDY`, the
 *   clause this one is shaped after, carries the remedy and nothing else.
 */
export const READ_ACK_NOTICE_CLAUSE: Record<ReadAckNoticeKind, string> = {
	pending: "marking read",
	offscreen: "scroll to the result to mark this chat read",
	unsettled: RETRY_REMEDY,
};

/**
 * The row's own DESCRIPTION per state - the keyboard and screen-reader channel.
 *
 * A sentence rather than the flyout's clause, and that is `D4`'s fix: the row's
 * `aria-describedby` can name two elements (a wedged row's remedy and this), and
 * the browser joins them with a space, so the clause form read as one utterance -
 * `/stop if it stays silent not marked read · click the chat to try again`. Each
 * string below stands on its own, with or without a neighbour, and none of them
 * carries the flyout's ` · ` separator (a description is announced straight after
 * the name, where a leading separator would be read as punctuation that is
 * already implied - the rule `SILENT_REMEDY`'s own span states).
 */
export const READ_ACK_NOTICE_DESCRIPTION: Record<ReadAckNoticeKind, string> = {
	pending: "Marking this chat read.",
	offscreen: "Scroll to the result to mark this chat read.",
	unsettled: `Not marked read. ${RETRY_REMEDY_SENTENCE}`,
};

/**
 * The clause and description for one row, or `null` when the receipt has nothing
 * to say about it.
 *
 * Takes the row's id rather than the row, so the caller cannot ask a question
 * about a notice and a row that disagree: the notice names one conversation and
 * every row asks whether it is that one. Both strings come back together so the
 * two channels cannot be rendered for different states - the panel's row reads
 * this once and uses it for the flyout, the description and the `id` that
 * description needs.
 */
export const readAckCopy = (
	notice: ReadAckNotice | null,
	sessionId: string,
): { clause: string; description: string } | null =>
	notice && notice.sessionId === sessionId
		? {
				clause: READ_ACK_NOTICE_CLAUSE[notice.kind],
				description: READ_ACK_NOTICE_DESCRIPTION[notice.kind],
			}
		: null;

/**
 * WHICH KIND OF REFUSAL a give-up arm is reporting, from the failure's CLASS
 * rather than its prose.
 *
 * - `busy` — the store refused for CONTENTION (`store_busy`), which is the arm
 *   whose remedy is the attempt itself and the only one the reader can act on by
 *   pressing.
 * - `refused` — the store refused for anything else (a full disk, an unopenable
 *   store). The reader is told the write did not happen; the store ladder's own
 *   instructions are not repeated, because they are addressed to a message.
 * - `unreported` — no transport refusal reached this message: the hook's own
 *   reason for a 200 whose body did not settle the completion, or a failure that
 *   is not a desktop refusal at all. Claiming the backend did not answer here
 *   would be false (UX round 2, U3's first arm: the daemon answered).
 */
type ReadAckRefusal = "busy" | "refused" | "unreported";

const refusalOf = (reason: unknown): ReadAckRefusal => {
	if (!(reason instanceof DesktopControlError)) return "unreported";
	return reason.code === STORE_BUSY_CODE ? "busy" : "refused";
};

/**
 * The sentence the give-up arm is announced with.
 *
 * Two facts, in the shape the bulk receipt's own failure uses in the same lane -
 * what happened to the write, and what it means for the reader - plus the remedy,
 * so a reader who never hovers the row still has the move. It says nothing about
 * the backend's own words, and nothing about a message, because a read receipt
 * has none.
 */
export const readAckNoticeSentence = (notice: ReadAckNotice): string => {
	switch (refusalOf(notice.reason)) {
		case "busy":
			return `The store is busy, so the unread mark was not cleared. ${RETRY_REMEDY_SENTENCE}`;
		case "refused":
			return `The store could not be written, so the unread mark was not cleared. ${RETRY_REMEDY_SENTENCE}`;
		default:
			return `The unread mark was not cleared. ${RETRY_REMEDY_SENTENCE}`;
	}
};
