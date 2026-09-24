import {
	DesktopControlError,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import {
	type ReadAckNotice,
	type ReadAckNoticeKind,
	isStoreWriteRefusal,
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
 * refusal is the store LADDER's copy, written for whichever caller the store
 * serves: the contention arm ends "Try again in a moment", and the full-volume arm
 * is an instruction about a volume (the receipt route composes its own - `
 * receipts_refusal` in the sibling's `desktop_sessions.py`, "so nothing was
 * written. Free some space on the volume holding … then try again." - because the
 * classifier's sentence, which the evidence rig `scripts/store-refusal-copy.mjs`
 * pins, is about "the message" a send carries and a receipt clear does not). Two
 * instructions in one toast either way, and the third arm ended up addressing an
 * outage when the backend had answered 200 and simply did not settle the
 * completion; painted, that ran to 248 characters and six lines in the design
 * round's frame `20`. So the sentences below are this app's, keyed on the CLASS of
 * the refusal rather than on its prose (see `refusalOf`).
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
 * - `busy` — the store refused for CONTENTION (`store_busy`): the arm whose remedy
 *   is the attempt itself, and the only one the reader can act on by pressing.
 * - `refused` — the store refused for a reason OF ITS OWN: a full volume or a store
 *   that cannot be opened, which are the two codes the store's classifier exports
 *   (`isStoreWriteRefusal`). GATED ON THOSE CODES RATHER THAN ON "not busy" (agent
 *   review round 3, MAJOR 1): the transport raises `DesktopControlError`s of the
 *   same shape that no store saw - a dead preload bridge, an old backend with no
 *   `sessions.seen`, the pairing plane's own refusal, this app's deadline - and
 *   placing those here made the panel say the write was refused by a store it never
 *   reached, which was a regression against the copy this module replaced.
 * - `unreachable` — a desktop refusal that is nobody's store: the transport's own
 *   sentence is true of all of them and is what the reader gets (through
 *   `userFacingMessage`, the app's single translator for this class, which composes
 *   the pairing refusals from their code rather than echoing a daemon's prose).
 * - `unreported` — no transport refusal reached this message at all: the hook's own
 *   reason for a 200 whose body did not settle the completion, or a failure that is
 *   not a desktop refusal. Naming any cause here would be a claim the app cannot
 *   support (UX round 2, U3's first arm: the daemon answered).
 */
type ReadAckRefusal = "busy" | "refused" | "unreachable" | "unreported";

const refusalOf = (reason: unknown): ReadAckRefusal => {
	if (!(reason instanceof DesktopControlError)) return "unreported";
	if (reason.code === STORE_BUSY_CODE) return "busy";
	if (isStoreWriteRefusal(reason.code)) return "refused";
	return "unreachable";
};

/**
 * WHAT THE UNREACHABLE ARM SAYS when the transport hands it a refusal with no
 * sentence of its own.
 *
 * Reachable but not the production shape: every arm that raises a code-less
 * `DesktopControlError` gives it a message ("Desktop controls could not reach the
 * backend process.", `desktop-api.ts`), so this is the floor rather than the copy.
 */
const UNREACHABLE_FALLBACK = "The app could not reach the backend.";

/**
 * The sentence per CLASS of refusal.
 *
 * A `Record` keyed on the class rather than a `switch` with a `default` (agent
 * review round 3, NIT 1): a fifth class is a compile error here instead of an arm
 * that silently inherits whichever sentence the default happened to hold, which is
 * the shape MAJOR 1 was an instance of. Two facts per arm, in the shape the bulk
 * receipt's own failure uses in this same lane - what happened to the write, and
 * what it means for the reader - plus the remedy, so a reader who never hovers the
 * row still has the move; and the noun is the app's own (`read state`, the phrase
 * the backend's ladder arm uses one surface away) rather than "the store", which
 * this panel never introduces (design round 2, D10).
 */
const READ_ACK_SENTENCE: Record<ReadAckRefusal, (reason: unknown) => string> = {
	busy: () =>
		`The read state is busy, so the unread mark was not cleared. ${RETRY_REMEDY_SENTENCE}`,
	refused: () =>
		`The read state could not be written, so the unread mark was not cleared. ${RETRY_REMEDY_SENTENCE}`,
	unreachable: (reason) =>
		`${userFacingMessage(reason, UNREACHABLE_FALLBACK)} The unread mark was not cleared. ${RETRY_REMEDY_SENTENCE}`,
	unreported: () => `The unread mark was not cleared. ${RETRY_REMEDY_SENTENCE}`,
};

/** The sentence the give-up arm is announced with, for the refusal it met. */
export const readAckNoticeSentence = (notice: ReadAckNotice): string =>
	READ_ACK_SENTENCE[refusalOf(notice.reason)](notice.reason);
