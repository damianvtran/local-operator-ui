/** Canonical sessions are the only conversation identities. Profile names stage
 * drafts; the legacy agent mapping is retained only to resolve old deep links. */
import {
	DesktopControlError,
	UserFacingError,
	desktopResult,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import type { ChatTarget } from "@shared/api/local-operator/profile-hooks";
// The echo seam, not the hook itself: these are module-level functions over a
// registry of mounted transcripts, so the store never touches React state and
// the dependency stays one-way (the hook does not import this store).
import {
	discardPendingEchoes,
	echoPendingUser,
	retractLocalEcho,
	retractPendingUser,
} from "@shared/hooks/use-canonical-session";
/*
 * The composer's own store, imported for the ONE return path (`returnPayload`)
 * and for `ChatDraft`'s read of what was sent. Direction is deliberate and
 * already the one this module's callers use: the composer store holds no
 * session state, so nothing here can cycle through it.
 */
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_LOST_SIGHT_CODE,
	DESKTOP_REFUSAL_CODE,
	DESKTOP_REFUSAL_SENTENCE,
	type DesktopModelSelection,
	type DesktopRequest,
	RUNTIME_BUSY_CODE,
	RUNTIME_RETIRING_CODE,
	isDesktopRefusalCode,
} from "../../../../shared/desktop-contract";
import {
	type CanonicalFrontendState,
	type CompletionAttention,
	type CompletionAttentionAckReceipt,
	type SessionBinding,
	type SessionCatalogueStatus,
	type SessionOpenedBy,
	mergeCompletionAttention,
} from "../../../../shared/desktop-session-contract";
import type { LaunchTarget } from "../../../../shared/open-session";

export type CanonicalSessionRow = {
	session_id: string;
	title?: string | null;
	cwd?: string | null;
	updated_at?: number | null;
	preview?: string | null;
	attention?: CompletionAttention;
	live_state?: string;
	pending?: string | null;
	active?: boolean;
	/**
	 * The backend's pin state for this conversation, as the catalogue row carried
	 * it. Declared explicitly beside `active`/`status` because this row type's
	 * index signature would otherwise type every read of it `unknown` at the one
	 * place that writes it optimistically (`setSessionPin`).
	 *
	 * The wire row's `pinned` is ALWAYS present (`SessionCatalogueRow` in
	 * `desktop-session-contract.ts` says why that matters here): the merge below
	 * is `{...current, ...incoming}`, so an omitted key would leave this app's
	 * optimistic `true` immortal after an unpin made somewhere else - the
	 * terminal, or another window.
	 */
	pinned?: boolean;
	/**
	 * The backend's ARCHIVE state for this conversation, as the catalogue row
	 * carried it. Declared explicitly beside `active`/`status` because this row
	 * type's index signature would otherwise type every read of it `unknown` at the
	 * one place that writes it optimistically (`setSessionArchived`).
	 *
	 * The wire row's `archived` is ALWAYS present (`SessionCatalogueRow` in
	 * `desktop-session-contract.ts` says why that matters here): the merge below is
	 * `{...current, ...incoming}`, so an omitted key would leave this app's
	 * optimistic `true` immortal after an unarchive made somewhere else.
	 */
	archived?: boolean;
	status?: SessionCatalogueStatus;
	/**
	 * The feed's stamp for `status`, as the catalogue row carried it.
	 *
	 * Declared here as well as on the wire row (`SessionCatalogueRow` in
	 * `desktop-session-contract.ts`) because the client's row is what the two
	 * writers are ordered on, and an index signature alone would make every read of
	 * them `unknown` at the one place that compares them. Optional on both sides
	 * and absent together: no stamp means the backend has published none for this
	 * session, which is not the same as revision 0.
	 */
	status_revision?: number;
	status_epoch?: string;
	/**
	 * How many subagents this session owns that are RUNNING, and how many are
	 * waiting for capacity, as the catalogue row carried them.
	 *
	 * Declared here as well as on the wire row (`SessionCatalogueRow` in
	 * `desktop-session-contract.ts`, whose comment carries the `null` semantics)
	 * for the reason `pinned`/`archived`/`status_revision` above are: this row type
	 * has an index signature, so without a declaration here every read of these two
	 * keys is `unknown` and the next reader casts - and `row.subagents_queued === 0`
	 * over `unknown` is exactly where a `null` {"does not report"} becomes a `0`
	 * {"none"}. The renderer draws no count of its own: the numbers reach the user
	 * inside `status.label` (see `chat-session-status.tsx`), and this declaration
	 * exists so the keys are typed wherever someone does read them.
	 */
	subagents_running?: number | null;
	subagents_queued?: number | null;
	binding?: SessionBinding;
	/**
	 * Who opened this conversation, when an agent rather than the operator did.
	 *
	 * Declared rather than left to the index signature below for the reason the two
	 * stamps above are: every read of an undeclared key on this type is `unknown`,
	 * and the sidebar's row draws a marker from this one. It needs no write site of
	 * its own - the catalogue map spreads the wire row's fields onto this one, so
	 * the value arrives with the read that fetched it, and a backend that sends no
	 * `opened_by` leaves it `undefined` and the marker undrawn.
	 */
	opened_by?: SessionOpenedBy | null;
	[key: string]: unknown;
};
type BackendSessionRow = Omit<CanonicalSessionRow, "session_id"> & {
	id: string;
	name: string;
	mtime: number;
};
/**
 * A pin press the backend did not accept, and what to say about it.
 *
 * Carries the INTENT rather than the row, so the retry re-sends the same desired
 * state the user asked for and nothing else: a retry that re-read the row would
 * send whatever the catalogue says NOW, which after a merge could be the value
 * the failed press failed to change.
 */
/**
 * What this client knows about one conversation's pin, and WHEN it learned it.
 *
 * The `at` stamp is the currency that keeps two writers ordered. Without it the
 * fact outranks every later answer, so a pin made here and removed on the other
 * surface leaves the row reading pinned and the next press sends the state the
 * backend already holds - round 2's Qr2-1 with the polarity reversed, against
 * the two-way claim this work exists for. With it, an answer that SPEAKS about
 * the id (the catalogue page, the search answer) supersedes a fact older than the
 * answer's own request, while a fact written after that request survives it -
 * which is the half that stops an answer in flight across a press from undoing
 * the press. The stamp is taken when the REQUEST starts, never when its answer
 * lands: comparing arrival times would let an answer that predates a press
 * supersede it, the same defect on a shorter clock.
 */
export type PinFact = {
	pinned: boolean;
	/** The sequence this write took, which orders it against every request. */
	at: number;
	/*
	 * What a ROW needs to be drawn, carried WITH the fact (design round 4, D17; UX round 4,
	 * U14). The panel may have to draw a pinned conversation its catalogue page does not
	 * carry, and a fact that were only a boolean would leave it drawing nothing at all - a
	 * pin the terminal and the backend both hold and the app silently under-reports, which
	 * is the state the round refused. Taken from the row the press acted on, or from the
	 * seed the press carried when the store held no row.
	 */
	title?: string;
	updated_at?: number;
};

export type PinFailure = {
	sessionId: string;
	/** The desired state that was refused, not the state on screen. */
	pinned: boolean;
	/**
	 * The conversation's title as the row carried it when the user pressed, so the
	 * sentence names the row they pressed rather than one a later catalogue read
	 * has retitled or dropped.
	 */
	title: string;
	/**
	 * The backend's own sentence for the refusal, EMPTY when the failure was not
	 * one either this transport or the backend authored - a runtime exception's
	 * `message` is a stack-trace fragment, and putting it on screen states the
	 * failure in the language of the crash (`userFacingMessage` says the same
	 * thing for the same reason). Empty means the store's own sentence is the
	 * whole truth about what happened.
	 */
	detail: string;
};
/**
 * What this client knows about one conversation's archive state, and when.
 *
 * See `archiveFacts` on the state for why the stamp exists; this is the shape it
 * is stored in. Deliberately narrower than the pin's own fact: a pin has to
 * describe a conversation the page cannot carry, because pinning moves a row
 * OUT of the flat list into a section of its own and the row must still be
 * drawn. Archiving moves a row nowhere - the archived row is simply not drawn by
 * default - so a fact here needs no `title`/`updated_at` to reconstruct a row
 * from, and the one surface that must report the state without a row (the open
 * conversation's header pill) reads the boolean.
 */
export type ArchiveFact = {
	archived: boolean;
	/** The request sequence this write took, which orders it against every read. */
	at: number;
	/**
	 * Whether the write this fact was written by has been ANSWERED. False between the
	 * press and the daemon's sentence, and that window is what the offer's retirement
	 * rule has to respect.
	 *
	 * WHY A FIELD RATHER THAN A SECOND RECORD: it is the same lifecycle. The press writes
	 * the fact (optimistic, unanswered), the answer settles it (accepted) or deletes it
	 * (refused), and a read newer than both keeps the fact exactly as it stands - so the
	 * flag travels with the value it belongs to and cannot drift from it. A reader that
	 * needs to know whether the client is still WAITING asks this, and the one that does is
	 * `archive-undo.ts`'s retirement subscription.
	 *
	 * WHAT IT IS FOR, measured on the control beside the one U3 was about (agent review
	 * round 2, R2-1): the retirement rule reads this fact first, so an OPTIMISTIC fact makes
	 * the rule say "the conversation no longer holds the state the offer was taken from"
	 * before anything has been refused. The offer is therefore retired at the press, the
	 * lane is dismissed - and a refusal arriving in its place is raised on the id that was
	 * just dismissed, which sonner destroys inside its own unmount window. Undo, the
	 * header's own restore control and `/unarchive` all write this route, so the gate belongs
	 * to the fact rather than to any one caller.
	 */
	answered: boolean;
};
/**
 * The undo offer a successful archive stands, and what pressing Undo would take
 * back.
 *
 * A plain record rather than a callback: every surface offers the same act -
 * unarchive THIS conversation - so the press is the panel's own call to the same
 * store action (`setSessionArchived(id, false, title)`), and the offer does not
 * have to carry a closure from whichever surface happened to make it. That is what
 * lets the offer be retired from outside the component that drew it.
 */
export type ArchiveUndoOffer = {
	sessionId: string;
	/** The name to quote, when the surface that offered it had one. */
	title?: string;
	/** The state the offer was taken from: what the press would take back. */
	archived: boolean;
	/**
	 * The write stamp this offer was raised under, so the LANE can tell it apart from a
	 * refusal by CURRENCY rather than by kind (agent review round 3, R3-1 = UX round 3, U7).
	 * Without it the lane preferred the refusal unconditionally, and because `archiveFailure`
	 * is only cleared for its own conversation, one refused archive meant every later
	 * successful archive's offer was never drawn.
	 */
	at: number;
};

/**
 * A conversation THIS WINDOW must not draw, and when it learned so.
 *
 * TWO WRITERS, ONE RULE. The first is a delete this window performed: dropping the
 * row from `sessions` is not enough to delete anything, because every read this
 * store issues REPLACES membership from its own answer, so a catalogue page whose
 * request started before the delete - and there is nearly always one, because the
 * page is read on mount, on focus, on visibility, on every catalogue revision and
 * by the 30 s safety poll - lands afterwards and puts the row straight back,
 * drawing a conversation the user permanently removed, clickable and re-deletable.
 * The second is the conversation's own STREAM answering not-found while the view
 * was still validating a switch onto it (`confirmSessionMissing`, which replaced
 * `openSession`'s guard read): the conversation is gone, and a pane that rolled back to a "Start a chat"
 * landing - or, after a reload, to a fresh draft bound to a dead id - explains
 * nothing about why (QA round 1, Q1). Both writers mean the same thing to every
 * reader: this id may not be drawn, it may not hydrate a transcript, and its pane
 * lands on the missing-session notice.
 *
 * THE STAMP IS THE ARCHIVE FACT'S OWN CURRENCY (`answerSeq`, taken at the WRITE,
 * compared against the sequence a read took when its REQUEST STARTED), and it is
 * what orders the record against every read in flight.
 *
 * A TOMBSTONE IS SETTLED BY A RESURRECTION, NOT BY A PAGE (agent review round 2,
 * R2-1). It used to be settled by any page that outranked it and did not carry the
 * id - which said nothing about the search answers still live, so a cached answer
 * asked before the delete drew the row again, deterministically, with no race. It
 * now goes only when a page that outranks it CARRIES the id back (something
 * recreated the conversation). A page that outranks it and does not carry the id
 * is what the tombstone predicted and changes nothing.
 *
 * A SEARCH ANSWER NEVER SETTLES IT, for the same reason: search answers are cached
 * per query for 30 s (`session-search.ts`), so one already in hand can name the id
 * long after the delete. Every join filters against this record (`searchChats`,
 * `ArchiveView.forgotten`), in the sidebar and in the command palette alike.
 *
 * The title is kept only so a surface that has to NAME the conversation after the
 * row is gone can still do so - the pane's header is the one that needs it, and
 * "Untitled chat" over a conversation the user just deleted names nothing. The
 * not-found writer has no title to give: it never read one.
 */
export type ForgottenFact = {
	/** The request sequence the delete took, which orders it against every read. */
	at: number;
	/** The conversation's name as the row held it, for a surface that must name it. */
	title?: string;
};
/**
 * An archive press the backend did not accept, and what to say about it.
 *
 * Carries the INTENT rather than the row, so a retry re-sends the same desired
 * state the user asked for and nothing else: a retry that re-read the row would
 * send whatever the catalogue says NOW, which is the value the failed press
 * failed to change.
 */
export type ArchiveFailure = {
	sessionId: string;
	/**
	 * The write stamp the refusal was raised under (see `ArchiveUndoOffer.at`): the lane draws
	 * whichever of its two messages is NEWER, and this is what says which that is.
	 */
	at: number;
	/** The desired state that was refused, not the state on screen. */
	archived: boolean;
	/**
	 * The conversation's title as the row carried it at the press, so the sentence
	 * names the row the user pressed rather than one a later catalogue read has
	 * retitled or dropped.
	 */
	title: string;
	/**
	 * The backend's own sentence for the refusal, EMPTY when the failure was not
	 * one either this transport or the backend authored - a runtime exception's
	 * `message` is a stack-trace fragment, and putting it on screen states the
	 * failure in the language of the crash (`userFacingMessage` says the same
	 * thing for the same reason). Empty means the store's own sentence is the
	 * whole truth about what happened.
	 */
	detail: string;
};
export type ChatDraft = {
	key: string;
	target?: ChatTarget;
	createRequestId: string;
	admissionRequestId: string;
	sessionId?: string;
	/**
	 * The model the FIRST turn of this draft will be born on, or absent when the
	 * user never picked one.
	 *
	 * DRAFT state, and deliberately nothing else: it is read by the pane's
	 * `sessions.preview` (so the readings on screen are this model's) and by
	 * `sessions.create` on send (so the first turn runs on it). It is never
	 * written to the host's settings — choosing a model for one conversation must
	 * not move the machine's default — which is why it lives on the row rather
	 * than behind `settings.edit`.
	 *
	 * Absent and `null` mean the same thing to every reader here (`model == null`
	 * in both), and `null` is what the store records when a choice is cleared so
	 * that the row states the intent rather than the absence of a key.
	 */
	model?: DesktopModelSelection | null;
	pending?: boolean;
	error?: string;
	errorCode?: string;
	submittedText?: string;
	submittedAttachments?: string[];
	submittedImages?: ChatImage[];
	submittedMode?: "prompt" | "steer";
	/**
	 * The text this request actually put on the wire, pinned at the first attempt.
	 *
	 * It is NOT always `submittedText`: the composer's `beforeAdmission` seam
	 * substitutes stored credentials and per-message context into the text before
	 * it leaves, so a replay that re-rendered would be a same-id request whose
	 * body hashes differently - which the receipt journal refuses as a conflict
	 * (409), turning a Retry into a permanent failure for a message that may well
	 * have landed. Pinned, the replay is byte-identical by construction (risk R3).
	 */
	submittedRendered?: string;
	/**
	 * Whether the notice's `Retry` is honest for `error`, as the classifier decided
	 * it (`sendFailureCopy`), recorded here because the ROW outlives the component
	 * that raised the notice.
	 *
	 * WHY THE ROW HAS TO CARRY IT. A later mount reads `error` (a sentence) and
	 * `errorCode` and has no Error in hand, so the pane used to answer the same
	 * question from "is there an error on screen" - which is true for every
	 * failure this store records, so `Retry` was hidden on exactly the arms it
	 * exists for (the unknown outcome, where the same id replays) and offered on
	 * the late-delivery arm, where pressing it duplicates the message. One
	 * decision, taken where the failure was classified, read by whoever renders.
	 */
	errorRetry?: boolean;
	/**
	 * Set once a message the PREVIOUS release held outside the composer has been
	 * moved back into it (`migrateHeldClaim`), so the move happens once however
	 * many times a pane mounts over the row.
	 */
	migratedHeld?: boolean;
	/**
	 * THE RELEASED APP'S OWN CLAIM MARKER, and the only field that identifies a row
	 * that app left behind.
	 *
	 * Nothing in this build writes it. It is read exactly once, by
	 * `migrateHeldClaim`, to answer "was this row written by the app that held a
	 * failed message OUTSIDE the composer?" - because the fields a legacy held row
	 * shares with this build's own failure rows (`submittedText`,
	 * `admissionAttempted`, a not-pending row) are the same fields, and keying the
	 * migration on those alone made it fire on every fresh failure, wipe the replay
	 * identity and hand the same message back twice. A row this build wrote carries
	 * no `heldClaimCode`, so it can never be treated as legacy - which is the
	 * property the migration needs and the one the old gate did not have.
	 */
	heldClaimCode?: string;
	/**
	 * True only once an admission request has actually been ISSUED, i.e. its
	 * outcome is genuinely unknown to us. This is what the unchanged-payload
	 * guard keys on: a send that failed BEFORE admission (session creation
	 * refused, provider unconfigured) admitted nothing, so holding the composer
	 * to that exact text would lock a conversation over a failure we know did
	 * not land. Only a request that may already be executing must be retried
	 * byte-for-byte.
	 */
	admissionAttempted?: boolean;
};
export type ChatImage = {
	data_b64: string;
	mime_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
};

/**
 * Shown when a send failed with nothing user-facing to say - a runtime
 * exception rather than a backend rejection. Stated once and shared, because
 * the page-level fallback and this one are the same sentence about the same
 * event and drifted apart when they were two literals.
 */

/**
 * The app's own sentence for a REFUSAL, and the error's own for everything else.
 *
 * WHY THIS IS NOT A BARE `userFacingMessage` CALL (measured, review round 3): the
 * translator composes the desktop transport's refusal vocabulary, and the store's
 * errors are not all refusals - a session the server does not know arrives as the
 * app's own "Unknown session." and routing it through the translator replaced it
 * with the generic fallback, which is the same class of mistake in the other
 * direction (three session-switch cases caught it). A transport refusal has a
 * `DesktopControlError`; anything else keeps the message it was given.
 */
const storeErrorMessage = (error: unknown, fallback: string): string =>
	error instanceof DesktopControlError
		? userFacingMessage(error, fallback)
		: error instanceof Error
			? error.message
			: fallback;

/**
 * The read window's refusal, as a category.
 *
 * A send addressed to a session whose own stream has not yet delivered its
 * snapshot is refused by the store, because the commit puts the view on that
 * session before anything has confirmed it still exists. A code rather than a
 * string comparison on the copy: the sentence below is expected to be reworded,
 * and matching prose would silently stop matching.
 *
 * Two consumers read it, and neither can key off the copy. `chat-page` retires
 * the notice when the window it describes closes, the same way
 * `unresolved_attachment` retires its own on an observable condition. And the
 * composer WITHHOLDS its generic retry hint for this code: the hint is the
 * alert's "what to do" half, and "send it again" is refused by this same window
 * for exactly as long as the notice is on screen, so the sentence carries its
 * own statement of the wait instead (UX round 3, U9).
 */
export const SESSION_UNVALIDATED_CODE = "session_unvalidated";

/**
 * What a send refused by the read window says, in the composer's own row.
 *
 * This refusal used to be silent, which is a real defect and not a stylistic
 * one: the user pressed Enter and the app did nothing at all - no request, no
 * line, no explanation - for as long as the read took, and when the backend
 * was dead that was the rest of the session (UX round 2, U8). The refusal
 * itself is right; saying nothing about it was not.
 *
 * The words follow branding section 8: what happened (the message was not
 * sent), what it means (this chat is not ready for messages yet), and what to
 * do. The "what to do" half is the sentence itself rather than the composer's
 * generic "Your message is still in the composer. Send it again.", which is
 * suppressed for this code (see above).
 *
 * WHO STILL READS IT, since the click stopped issuing a guard read (agent review
 * round 2, R2-3). The chat pane no longer refuses a press inside the window: it
 * HOLDS it until the conversation's stream answers (`chat-page`'s `send`). So
 * this sentence is reached from two places only: `admitChatDraft`'s own refusal,
 * for any caller that does not hold (the store keeps the rule for every door),
 * and the pane's fallback when its stream gave up but carried no statement of
 * its own - the stream's own lost-connection sentence is preferred there, so
 * the composer and the transcript cannot disagree (design round 1, D3).
 */
export const SESSION_UNVALIDATED_MESSAGE =
	"This chat is not ready for messages yet, so the message was not sent. Sending works once it is ready.";

/**
 * A send refused because its text STARTS WITH A SLASH.
 *
 * The backend's own policy: `local_operator/server/routes/desktop_sessions.py`
 * refuses any message whose text `lstrip().startswith("/")`, because a leading
 * slash means "command" and a command travels on a different endpoint. A
 * multi-line draft the planner correctly classified as PROSE (`/usage` on line
 * one, the message on line two, caret at the end) therefore reaches the messages
 * endpoint carrying that first line and is refused there — and no amount of
 * resending can make it work: the same bytes meet the same rule forever (UX
 * round 2, U13).
 *
 * A code rather than a match on the refusal's copy, for the same reason the two
 * above are: the sentence is the transport's shared 422 string ("...invalid
 * fields."), used by refusals this does not describe, and prose is expected to
 * be reworded. The condition that identifies THIS refusal is the payload the
 * store sent, which the store holds.
 */
export const LEADING_SLASH_CODE = "leading_slash_message";

/**
 * What a send refused for its leading slash says, in the composer's own row.
 *
 * The refusal's own copy is the transport's sentence about a malformed request,
 * which names a cause the user cannot act on, and the composer's generic retry
 * hint ("Send it again") points at the one action that can never succeed here.
 * What is true is that the user's draft is still in the composer and has two
 * fixes, both in front of them — so the sentence names them (branding section 8:
 * what happened, what it means, what to do).
 */
export const LEADING_SLASH_MESSAGE =
	"A message can't start with / — that is a command. Move it below your text, or send it on its own.";

/**
 * Whether a refused send is the leading-slash policy refusal.
 *
 * Keyed on the PAYLOAD the store sent rather than on the refusal's copy: the 422
 * carries the transport's shared sentence, and matching prose would silently
 * stop matching when it is reworded. `trimStart` mirrors the backend's `lstrip`.
 * Restricted to 422 because that is the only status the policy raises — a
 * leading-slash draft that failed for some OTHER reason (a lost response, a dead
 * owner) has admitted nothing and may well succeed on a resend, so it must keep
 * the generic hint.
 *
 * A 422 that ALREADY carries a code yields to it, and this is not a nicety: the
 * leading-slash policy has no code on the wire (its `detail` is a plain string;
 * see `LEADING_SLASH_CODE`), so a coded 422 is by construction a DIFFERENT,
 * specific refusal the transport has already classified - an unknown command, an
 * invalid cwd. Letting this general rule overwrite that swapped a precise
 * diagnosis for a vague one that described a request we had not sent (round 5,
 * R13). The two conditions are complementary: the stage gate at the call site
 * says the message request failed, and this says the policy is the reason.
 *
 * The caller must still establish that the failing request WAS the message
 * request - `sessions.create` shares that try and its 422 never carried this
 * text anywhere. See the `inFlight` gate in `admitChatDraft`.
 */
export function isLeadingSlashRefusal(error: unknown, text: string): boolean {
	return (
		error instanceof DesktopControlError &&
		error.status === 422 &&
		error.code === undefined &&
		text.trimStart().startsWith("/")
	);
}

/**
 * A send refused because an attachment it was carrying could not be read.
 *
 * The refusal itself is the renderer's own (`unreadableAttachmentRefusal`), and
 * the sentence carries its own remedy, so what this code is FOR is the two
 * decisions that must not be made from the copy: the composer withholds its
 * generic "Send it again" hint for it (see `retryWillFail`), and a code is
 * how that survives a rewording.
 *
 * A code rather than a fact about the message for one more reason, and it is a
 * defect this round measured (design round 4, D13): `chat-page` reads
 * `activeError = sendError || draft.error` and
 * `activeErrorCode = sendErrorCode ?? draft.errorCode`, so a refusal that leaves
 * the code UNSET here inherits whatever code the draft was last left holding -
 * an earlier leading-slash refusal, say - and the same sentence then renders
 * with the hint in one session and without it in another. Setting the code at
 * the refusal makes the alert's hint a function of the refusal instead of a
 * function of the conversation's history.
 */
export const UNREADABLE_ATTACHMENT_CODE = "attachment_read_failed";

/**
 * A send refused because the backend could not write its store: the disk is
 * full.
 *
 * WHY ONE `sqlite3.Error` HAD TO BECOME THREE ANSWERS. The backend's desktop
 * routes caught the BASE class - `sqlite3.Error` - and mapped every member of it
 * to one 503 reading "Read state is busy right now. It will catch up on its
 * own.", so lock contention, an unopenable database, a corrupted one and a full
 * volume were a single branch, and the sentence described the only one of them
 * that is transient. On 2026-09-17 this machine's boot volume hit 0 bytes free
 * at 09:56; SQLite could not allocate its journal or WAL, and a send carrying an
 * IMAGE was refused with that sentence plus this composer's own generic hint,
 * "Your message is still in the composer. Send it again." - the one action that
 * cannot help on a full disk, and the one the operator repeated. The image is
 * what crossed the threshold first because it is by far the largest write in the
 * flow: attachment bytes plus a much bigger transcript append, while a few-KB
 * text send still landed. It went away when disk space came back, which is the
 * correlation the report describes.
 *
 * A code rather than a reading of the copy, for the same reason as its siblings
 * above: the sentence is expected to be reworded, and matching prose would
 * silently stop matching. What the code decides is the one thing the copy cannot
 * carry - whether the composer's generic retry hint is TRUE.
 *
 * The SENTENCE is the BACKEND's, rendered verbatim from the error body's
 * `message` field (`desktopResult` reads `detail.code`/`detail.message` for any
 * status). Naming the volume and the remedy is a fact about the machine that only
 * the process which touched the store has, so authoring a second copy here would
 * be a second place for it to drift from the one the user is shown. The renderer
 * half of the fix is that this code SURVIVES to the alert - it is what
 * `retryWillFail` below reads - and that the sentence is not replaced by a
 * generic one on the way (pinned in `scripts/canonical-chat.test.mjs`).
 *
 * The notice does NOT retire on a timer, and that is deliberate: the read
 * window's notice can, because the window it names closes on an observable
 * condition, while a full disk does not heal itself. It clears when the
 * refusal's remedy actually happened - the next send that lands (`finishDraft`)
 * - or when the user edits the draft, as every other send refusal does.
 */
export const STORE_OUT_OF_SPACE_CODE = "store_out_of_space";

/**
 * A send refused because the backend's store could not be read or written at all
 * - unopenable, corrupted, "file is not a database" - which is every
 * `sqlite3.Error` that is not contention and not a full volume.
 *
 * The remedy is NOT a retry: the same store is in the same state on the next
 * attempt, so resending the same bytes is refused for the same reason, and the
 * hint the composer would otherwise render under this sentence would be the
 * incident's own false instruction in a different costume. The sentence the user
 * reads says so and points at the machine; a code is what withholds the hint
 * that contradicts it.
 *
 * `store_busy` - the third arm, genuine lock contention - deliberately has no
 * constant in this file: it keeps the backend's existing sentence AND the
 * composer's retry hint, because there a retry is exactly the right advice. The
 * split exists so that "send it again" becomes true-for-contention and
 * false-for-a-failed-store, so nothing in the renderer changes for it.
 */
export const STORE_UNAVAILABLE_CODE = "store_unavailable";

/**
 * Whether this refusal is the STORE's own verdict on the write - the two arms
 * that are not contention.
 *
 * ONE PREDICATE FOR ONE FACT, with two consumers, because the two of them must
 * not disagree about it on one screen. The fact is what a store failure KNOWS
 * that the other refusals do not: the write did not happen. Every other refusal
 * in this list is silent about the request's fate - the transport may have lost
 * the response, the owner may have admitted it - which is why their shared held
 * claim says the outcome is "not knowable" and conditions the retry on a reply
 * arriving.
 *
 * For these two codes that sentence is simply wrong, and it is wrong in the
 * incident's own direction: it tells the operator to wait for a reply that the
 * failed write makes impossible while the transcript above shows their message
 * painted (UX round 1, U4). So the composer reads this predicate for the two
 * places the difference lands:
 *
 *   - the held line states the known fact instead of the unknowable-outcome
 *     sentence (see the alert's `storeWriteRefused` branch);
 *   - the generic retry hint is withheld, by `retryWillFail` below, which
 *     is a SEPARATE question - "is the retry the remedy" - and is kept separate
 *     here: one predicate per fact, so a code can be added to either list for
 *     its own reason without silently answering the other question.
 *
 * `store_busy` is deliberately NOT a member: contention is a refusal whose
 * outcome really is unknowable, and it keeps the shared held sentence for the
 * same reason it keeps the retry hint.
 */
export function isStoreWriteRefusal(code: string | undefined): boolean {
	return code === STORE_OUT_OF_SPACE_CODE || code === STORE_UNAVAILABLE_CODE;
}

/**
 * The composer's code for an option press that did not reach the owner.
 *
 * WHY THE PRESS NEEDS A CODE AT ALL, and why it is not the transport's. An
 * option press reports through the same alert as a typed send, and that alert
 * reads `activeErrorCode = sendErrorCode ?? draft.errorCode` — so a report that
 * leaves the code unset inherits whatever failure the DRAFT was last left
 * holding (design round 4, D13, which measured the inheritance on the attachment
 * refusal). Two things then go wrong on the same screen: a stale
 * `unresolved_attachment` code puts that remedy's own buttons under a sentence
 * about an option press, and a stale code for which the retry hint is WITHHELD
 * leaves the sentence bare while the same sentence renders with the hint in
 * another session.
 *
 * It is a code of its own rather than `undefined` even though the press that
 * carries it has already failed, because the questions the composer asks of a
 * code are exactly the two that must not be answered by history: is the retry
 * the remedy (it is not — the question this press named is gone, and there is
 * nothing to press again; see `retryWillFail`), and which remedies belong
 * under this sentence (none of the draft's).
 */
export const ANSWER_NOT_SENT_CODE = "answer_not_sent";

/**
 * Whether pressing Retry could possibly work for a refusal.
 *
 * The notice row offers `Retry` and `Clear`, and this decides whether the first
 * of those renders at all. A remedy the app will refuse again the instant it is
 * pressed is worse than no remedy: the operator's own case on 2026-09-17 - drop
 * the image that pushed the write over the threshold - was measured as an
 * instruction/refusal loop, 11 presses and 11 identical refusals (UX round 1,
 * U2).
 *
 * FIVE refusals cannot be answered by pressing again, each for its own reason.
 * The leading-slash policy refuses THIS TEXT forever; an attachment that cannot
 * be read is still unreadable on the next attempt, because the same chip is
 * still attached; a store that is out of space or unreadable is in the same
 * state on the next attempt too. The fifth is not a send refusal at all: an
 * option press that failed carries `ANSWER_NOT_SENT_CODE`, where there is no
 * text to send and the question it answered has moved on, so a Retry would name
 * a box that has nothing to do with the failure. It is in this list rather than
 * in a second one because this predicate answers one question (is Retry the
 * remedy) and that is the answer the failure owns.
 *
 * THREE TERMS THIS PREDICATE USED TO CARRY ARE GONE, and the copy table is why.
 * The read window (`session_unvalidated`) and the retiring owner
 * (`runtime_retiring`) each have a sentence of their own now that tells the user
 * to try again - "This chat isn't ready yet" and "Try again in a moment" - so a
 * press is exactly what those sentences invite, and a Retry beside an invitation
 * to press is one instruction, not two. The third is the unchanged-payload
 * guard's code, which no longer exists: an edited resend is a NEW message under a
 * new request id and is never refused (see `admitChatDraft`).
 *
 * `runtime_busy` was never on this list and still is not: the app has spent its
 * internal repeats by the time the composer sees it, and the owner's own
 * sentence asks for the press.
 *
 * One function rather than call-site comparisons, so the composer reads the rule
 * instead of listing the codes, and so `scripts/canonical-chat.test.mjs` can
 * execute it against the store that raises them.
 */
export function retryWillFail(code: string | undefined): boolean {
	return (
		code === LEADING_SLASH_CODE ||
		code === UNREADABLE_ATTACHMENT_CODE ||
		code === STORE_OUT_OF_SPACE_CODE ||
		code === STORE_UNAVAILABLE_CODE ||
		code === ANSWER_NOT_SENT_CODE
	);
}

/**
 * Which of the three outcome classes a failed send belongs to.
 *
 * The distinction the composer acts on: whether the message provably never
 * reached the session ("not sent"), whether the app cannot say ("unknown"), or
 * whether the conversation it addressed is gone ("gone"). Only "unknown" keeps
 * the request id and the pinned payload for an idempotent replay; only "not
 * sent" and "gone" can be retried as a fresh message without any risk of two
 * rows.
 */
export type SendFailureClass = "not_sent" | "unknown" | "gone";

/**
 * A 409 the daemon answered with a sentence and no code.
 *
 * Both arms the route produces this way are refusals the app can act on or wait
 * out; which one it is, is decided by `sendFailureClass`'s caller-supplied fact
 * rather than by the text.
 */
function isCodelessConflict(error: unknown): boolean {
	return (
		error instanceof DesktopControlError &&
		error.status === 409 &&
		sendFailureCode(error) === undefined
	);
}

export function sendFailureClass(
	error: unknown,
	/**
	 * Whether an EARLIER attempt under this message's request id could have been
	 * admitted (`ChatDraft.admissionAttempted`). It is what tells the two 409s the
	 * daemon answers without a code apart - see `isCodelessConflict`.
	 */
	priorAttemptUnresolved = false,
): SendFailureClass {
	if (isRefusedBeforeAdmission(error)) return "not_sent";
	/*
	 * THE CODELESS 409, SPLIT IN TWO BY ONE FACT THE STORE ALREADY HOLDS.
	 *
	 * The daemon answers two quite different things with `409` and no code: a
	 * RECEIPT CONFLICT (this request id already has a receipt, so the attempt under
	 * it may well have been admitted - an unknown outcome, and the app must not
	 * pretend to know) and a REFUSAL OF THE BODY, which is what the sender-side
	 * budget ladder raises when the text has eaten the frame's room for its images
	 * (`attach_client.py`'s `OversizedRequest`, a `ValueError`, answered by the
	 * route's `raise HTTPException(409, str(error))`).
	 *
	 * QA proved the arm reachable in one step and the defect real (round 2, Q2-1):
	 * two ~3.4 MB images plus 199,000 characters, and the composer showed "Couldn't
	 * confirm your message was sent. Sending it again is safe." with Retry over a
	 * refusal the daemon had just explained - and the press re-posted the identical
	 * body for ever, which is the one thing this design exists to stop.
	 *
	 * The fact that separates them is not in the sentence and must not be read out
	 * of it (matching prose is how a rule stops matching): a receipt conflict can
	 * only exist for an id the journal has SEEN, and the store knows whether it has
	 * ever left an attempt under this id unresolved. No earlier attempt - or one the
	 * daemon answered with a stated refusal, which is what `admissionAttempted`
	 * being false means - and the only thing a 409 can be is a refusal of this body,
	 * decided before any receipt existed. That reading also cannot loop: the refusal
	 * offers no press, so the same bytes cannot be re-posted by a control.
	 */
	if (isCodelessConflict(error) && !priorAttemptUnresolved) return "not_sent";
	/*
	 * A 404 is its own class rather than a refusal: the conversation the message
	 * was addressed to does not exist, so the content is worth keeping and copying
	 * but the press cannot be repeated against it.
	 */
	if (error instanceof DesktopControlError && error.status === 404)
		return "gone";
	return "unknown";
}

/**
 * The code a caught send failure carries, if it carries one.
 *
 * The two typed readers first, then the GENERIC one, because a code is not only
 * raised by this app's own error classes: `unresolved_attachment` arrives as a
 * plain `Error` with a `code` property, and the send path has always read it that
 * way. Narrowing this to the typed classes silently dropped that code - and with
 * it the composer's decision to withhold a Retry it cannot honour - so the
 * fallback is load-bearing rather than defensive.
 */
export function sendFailureCode(error: unknown): string | undefined {
	if (error instanceof DesktopControlError) return error.code;
	if (error instanceof UserFacingError) return error.code;
	if (error && typeof error === "object" && "code" in error) {
		const code = (error as { code?: unknown }).code;
		if (typeof code === "string") return code;
	}
	return undefined;
}

/**
 * The sentences this app writes for a failed send.
 *
 * ONE TABLE, so a reviewer reads the copy in one place and a test can snapshot
 * it (see `sendFailureCopy`). Each says what happened and what to do about it,
 * in that order (`docs/branding.md` § 8), and none of them uses the app's own
 * vocabulary for the send machinery: no "held", no "admission", no "owner",
 * no "request". The user's mental model is a message that did or did not leave.
 */
export const SEND_FAILURE_COPY = {
	/**
	 * Unknown outcome, the default arm.
	 *
	 * TWO CLAUSES, and the second is the UX round's finding (U7): the timeout arm
	 * told the user what the app could not establish and left them to guess whether
	 * a press was safe. It is - the same request id replays, and the owner's receipt
	 * de-duplicates it - so the sentence says so rather than leaving the safest
	 * action unstated.
	 */
	unconfirmed:
		"Couldn't confirm your message was sent. Sending it again is safe.",
	/** Unknown, and the specific fact is that nothing answered. */
	unreachable:
		"Couldn't reach Local Operator. Your message may not have been sent.",
	/** The owner took the request and is not free yet. */
	busy: "The agent is busy, so your message wasn't sent.",
	/** The owner is leaving; its own advice is to come back in a moment. */
	retiring:
		"Local Operator is restarting, so your message wasn't sent. Try again in a moment.",
	/** The read window's refusal: the app has not confirmed the chat yet. */
	notReady: "This chat isn't ready yet, so your message wasn't sent.",
	/** 422 with no code the app can act on. */
	generic: "Your message wasn't sent.",
	/** 404: the conversation is gone, so only the content is salvageable. */
	gone: "This conversation no longer exists, so your message wasn't sent.",
	/**
	 * The send lock (A1/A2). A muted statement of fact rather than a failure: the
	 * text is still in the box because the press never became a send.
	 */
	sendLock: "Your last message is still sending.",
	/** The same lock, with the question that explains it on screen. */
	gateLock: "Answer the question above first.",
	/**
	 * The late confirmation: a message handed back to the composer turned out to
	 * have been delivered after all, and the box had been edited since, so its
	 * text is the user's own and stays. Muted, no actions.
	 */
	lateDelivery: "Your earlier message was delivered.",
	/*
	 * AND THE ONE THAT NAMES WHAT IS IN THE BOX (review round 2, D4). The plain
	 * sentence above is true whatever the box holds, which is what the `overlap` arm
	 * needs - the user edited inside the delivered words and no boundary between
	 * theirs and the message's is knowable. Where the delivered message HAS come out
	 * of the box (`draft-only`), the user is looking at their own unsent line under a
	 * sentence about a different message, and saying so is the difference between
	 * "the app lost my draft" and "the app kept it": measured in round 1 as the
	 * auto-clear that looked like the app losing the text (Q-4).
	 */
	lateDeliveryDraft:
		"Your earlier message was delivered. What's here now hasn't been sent.",
	/*
	 * AND THE ARM WHERE THE DELIVERED WORDS ARE STILL IN THE BOX (review round 3,
	 * D8). The prefix test cannot remove them - the user edited inside them, so no
	 * boundary between their words and the message's is knowable - and the plain
	 * sentence above says nothing about the box, so a user whose next Send carries
	 * the sentence they already sent gets no warning that it will. Their files do
	 * not travel again (the chips come out by identity), which is exactly why the
	 * copy has to carry the rest: this is the one duplicate the app cannot prevent,
	 * so it names it.
	 */
	lateDeliveryOverlap:
		"Your earlier message was delivered. Its words are still in the box, so sending again would repeat them.",
} as const;

/**
 * The sentence and register for a press the app cannot take yet, from the one
 * table: `gateLock` when the run is visibly waiting on a question, `sendLock`
 * otherwise.
 *
 * A function rather than two literals because two callers answer the same press -
 * the composer, which can see that a flight is open, and the pane, which refuses
 * one that reaches it anyway - and UX round 3 (U6) is what the drift costs: a
 * press that produced nothing on screen, which is what makes a user press again
 * over a box that by then holds both messages.
 */
export function pressLockCopy(
	/*
	 * The frontend's own field, typed from its own state so a caller cannot hand
	 * this a truthiness the pane would read differently: both the pane's two
	 * refusals and the composer's press answer from this one value.
	 */
	pendingGate: CanonicalFrontendState["pending_gate"] | undefined,
): string {
	return pendingGate ? SEND_FAILURE_COPY.gateLock : SEND_FAILURE_COPY.sendLock;
}

export const RETRY_LABEL = "Retry";
export const CLEAR_LABEL = "Clear";

/**
 * One sentence and at most two actions, for one failed send.
 *
 * `message` is only ever overridden where the sentence belongs to somebody else
 * and is already right: the backend's own refusal text (a disk that is full names
 * the volume it is full on), a pairing sentence, the budget refusal raised in the
 * composer with the sizes in it, or the unreadable-attachment refusal that names
 * the file. Those keep their words and are given this app's CONTROL SET rather
 * than rewritten - the fix this table exists for is the notice's shape and the
 * block on different messages, not the provenance of one honest sentence.
 *
 * `retry` is whether pressing Retry can work. It is false for every arm whose
 * message cannot leave as it stands (a slash-prefixed draft, a file that cannot
 * be read, a store that will not take the write) and for every arm the press
 * cannot reach again (a conversation that is gone, a pairing state, a payload
 * too large for the wire). It is true for the unknown class, where the same id
 * replays, and for the three not-sent arms whose own new sentence tells the user
 * to try again.
 *
 * AND A RETRY REBUILDS ITS PAYLOAD FROM THE BOX (QA round 3, Q3-1). After a
 * failure whose returned message was merged in front of the user's own line, the
 * press carries both lines - one message, one request id, one row, and the
 * delivered words come out of the box once the delivery is known, so this is not
 * the duplicate the change exists to remove. It is worth knowing all the same:
 * the retry is "send what the box holds", not "send what failed", which is
 * exactly why the box's contents are the user's to edit before they press it.
 */
export function sendFailureCopy(
	error: unknown,
	/**
	 * The code to classify by, when the caller has already reclassified the
	 * failure. `admitChatDraft` does exactly that for a leading-slash 422 - the
	 * transport's own code says "invalid fields", this app's says "the slash is
	 * the problem" - and it is the same code the row records, so the sentence and
	 * the code a composer branches on can never disagree (see the store's catch).
	 */
	codeOverride?: string,
	/**
	 * See `sendFailureClass`: whether an earlier attempt under this request id could
	 * have been admitted. Defaulted, so every existing caller - including the pane's
	 * own classification of a failure it caught - answers as it always did.
	 */
	priorAttemptUnresolved = false,
): {
	message: string;
	retry: boolean;
	code?: string;
} {
	const klass = sendFailureClass(error, priorAttemptUnresolved);
	const code = codeOverride ?? sendFailureCode(error);
	const fallback = userFacingMessage(error, SEND_FAILURE_COPY.generic);
	if (klass === "gone")
		return { message: SEND_FAILURE_COPY.gone, retry: false, code };
	if (klass === "not_sent") {
		if (code === RUNTIME_BUSY_CODE)
			return { message: SEND_FAILURE_COPY.busy, retry: true, code };
		if (code === RUNTIME_RETIRING_CODE)
			return { message: SEND_FAILURE_COPY.retiring, retry: true, code };
		if (code === SESSION_UNVALIDATED_CODE)
			return { message: SEND_FAILURE_COPY.notReady, retry: true, code };
		if (code === LEADING_SLASH_CODE)
			return { message: LEADING_SLASH_MESSAGE, retry: false, code };
		/*
		 * Everything else keeps the sentence the refusal itself carries: the
		 * unreadable attachment names the file, the budget refusal carries the
		 * sizes, a store refusal names the volume, and the transport's own 413/422
		 * text names the request it refused. Those sentences are already the ones
		 * this app wants, and rewriting them would only move copy away from the
		 * fact it describes.
		 */
		return { message: fallback, retry: false, code };
	}
	if (code === DESKTOP_REFUSAL_CODE.transportFailed)
		return { message: SEND_FAILURE_COPY.unreachable, retry: true, code };
	if (isDesktopRefusalCode(code))
		return { message: DESKTOP_REFUSAL_SENTENCE[code], retry: false, code };
	/*
	 * THE TRANSPORT'S DEADLINE IS THE ARM THE OPERATOR REPORTED, and this is the
	 * line that answers it. Its sentence (`desktop-contract.ts`, "The app waits up
	 * to 20 seconds for this request, and it was still running when the app stopped
	 * waiting. It may or may not have reached the server; check the result before
	 * repeating it.") is prose about the APP's patience, addressed to nobody: it was
	 * the long red sentence sitting over an empty composer. The composer says what
	 * happened to the user's message instead, and the deadline keeps its own wording
	 * for every other operation that reaches it.
	 */
	if (code === DESKTOP_DEADLINE_EXCEEDED_CODE)
		return {
			message: SEND_FAILURE_COPY.unconfirmed,
			retry: !retryWillFail(code),
			code,
		};
	/*
	 * THE DAEMON'S OWN HOP FAILURE IS AN UNKNOWN OUTCOME, AND THE TABLE SAYS SO
	 * (review round 1, M8/U4/Q-3). `runtime_unreachable` is the daemon reporting
	 * that it could not establish whether the request reached the owner - the
	 * contract's own words for it, and why it is not a refusal - which is the
	 * unknown class exactly. Relaying its body instead put the machinery on screen:
	 * "Session owner is unavailable. Reconnect and reconcile before retrying." is
	 * two sentences, names the owner and a reconcile the user cannot run, and is the
	 * kind of sentence the table exists to replace. The press is offered because a
	 * same-id resend is safe (`retryWillFail` is false for it), which is what the
	 * sentence's second clause promises.
	 */
	if (code === DESKTOP_LOST_SIGHT_CODE.runtimeUnreachable)
		return { message: SEND_FAILURE_COPY.unconfirmed, retry: true, code };
	/*
	 * A CODE WITH NO SENTENCE OF THIS APP'S OWN: the backend named its own reason
	 * (`store_busy` - "Read state is busy right now. It will catch up on its own."),
	 * so its sentence is kept. Replacing it with a vaguer one of this app's would
	 * drop the only fact the user has to act on, and the code is what makes this
	 * distinguishable from a bare throw, whose text is a leaked exception.
	 */
	if (code) return { message: fallback, retry: !retryWillFail(code), code };
	/*
	 * And the last arm: a failure with no code at all - a raw throw, or a response
	 * that never arrived. There is nothing to quote, so the app states what it knows.
	 */
	return {
		message: SEND_FAILURE_COPY.unconfirmed,
		retry: !retryWillFail(code),
		code,
	};
}

/**
 * The one place a composer value becomes a send PAYLOAD.
 *
 * The unchanged-payload guard compares byte-for-byte, because a retry of a
 * request that may already be executing has to be an idempotent replay. The
 * composer meanwhile has to decide what to SAY about that guard - whether the
 * held message is on screen, whether Restore is worth offering, whether the
 * abandon control would destroy typed text. Those were two comparisons over two
 * different strings (`===` in the guard, `.trim() ===` in the composer), and a
 * whitespace-only edit fell into the gap between them: the guard refused the
 * send while the composer believed the box already held the payload, so it
 * suppressed BOTH escapes and left only the control that empties the box.
 * Trailing space, leading space and a trailing newline all reproduced it -
 * including the trailing-newline case the trim was originally written for.
 *
 * So the trim moves to the payload boundary instead of living in the copy
 * logic. Every send normalizes here, every stored `submittedText` is therefore
 * already normalized, and the composer compares normalized against normalized.
 * The guard and the copy cannot disagree about what "the same message" means,
 * because there is now only one string. Whitespace at the ends is not content
 * the owner needs preserved; the interior is untouched.
 */
export function normalizeSendText(text: string): string {
	return text.trim();
}

/**
 * The composer's whole value - reply markup included - as the ONE payload
 * string.
 *
 * `normalizeSendText` closed the gap between the guard and the copy for the
 * bare box, but the reply prefix was assembled downstream of every comparison
 * the composer makes: the box held `text` while the store stored and guarded
 * `<reply-to>…</reply-to>\n<text>`. Two strings for one payload again, and this
 * time the second one deadlocked the escape built to answer the first. Restore
 * writes the held payload back, the next send re-prefixes it into
 * `<reply-to>…</reply-to>\n<reply-to>…</reply-to>\n<text>`, the guard refuses
 * the mismatch, and the composer - now seeing its own held text in the box -
 * withdraws Restore and says "Send it again", which is false and stays false.
 *
 * So assembly lives at the boundary, above the guard rather than beside the
 * send call. The composer builds its comparison basis from the same function
 * with the same replies, so `heldInBox` asks the question the store answers.
 * Replies survive a failed send (`clearReplies` runs only once a send is
 * accepted), so the basis is stable across every retry of one claim.
 *
 * NOT idempotent over its own output, and deliberately so: the markup is
 * generated from the reply LIST, so feeding a payload back in with the same
 * list prefixes it twice. That is the invariant Restore has to honour - it
 * hands back a finished payload, so it clears the chips whose content that
 * payload already carries, leaving assembly here a no-op on the next send.
 * Normalizing after the join rather than before keeps one definition of
 * "empty" for a box whose only content is a reply.
 */
export function buildSendPayload(
	text: string,
	replies: readonly { text: string }[],
): string {
	if (replies.length === 0) return normalizeSendText(text);
	const replyContent = replies
		.map((reply) => `<reply-to>${reply.text}</reply-to>`)
		.join("\n");
	return normalizeSendText(`${replyContent}\n${text}`);
}

/**
 * Which draft a chat view owns. A staged draft is keyed by its own key, but once
 * a session exists `draftKey` is null and the send draft lives under
 * `send:<id>` — reading only `draftKey` there left a failed send's retained text
 * unreachable. It lives here, beside the drafts it addresses, so the rule is
 * exercised by the store tests rather than duplicated in an untested component.
 */
export function draftIdentityFor(
	draftKey: string | null,
	sessionId: string | null | undefined,
): string | null {
	return draftKey ?? (sessionId ? `send:${sessionId}` : null);
}

/**
 * What React keys the chat panel on, and therefore what makes it remount.
 *
 * The precedence is `id ?? draftKey` and NOT the reverse, because the two name
 * the same conversation from either side of admission and the SESSION id is the
 * durable one: a pane keyed by the session is the pane the stream, the composer
 * and the echo registry all address, whether the reader reached it from the
 * sidebar or staged it as a draft.
 *
 * THE FLIP IS A REMOUNT, and that is load-bearing rather than incidental. A
 * draft learns its session id mid-send (the store patches it before the message
 * POST), so the key moves `draft:<uuid>` -> `<sessionId>` and the panel is
 * unmounted and mounted again at exactly the moment the user is waiting for the
 * message they just sent. The optimistic echo is therefore seeded into the NEW
 * panel's first frame (`seedPendingEchoes` in `use-canonical-session.ts`): the
 * delivery that follows arrives through a mount effect, one commit too late, and
 * that gap is the one that file documents at length.
 *
 * AN EARLIER REVISION OF THIS COMMENT CLAIMED THE FLIP WAS A NO-OP. It is not,
 * and the seeding above exists because of it: an answer that reads as "nothing
 * happens here" is how a reader concludes the echo registry has no draft-path
 * case to fix (review rounds 1 R6 and 2 R2-1, which is why the sentence is
 * stated rather than removed).
 *
 * The reverse direction remounts as well, and correctly: "New chat" stages a
 * draft with no session id, so `id` is undefined and the draft key wins. That IS
 * a different conversation and must not inherit the previous transcript.
 *
 * Extracted rather than inlined in the component for the same reason
 * `draftIdentityFor` was: the rule is then exercised by the store tests.
 */
export function panelIdentityFor(
	draftKey: string | null,
	sessionId: string | null | undefined,
): string | undefined {
	return sessionId ?? draftKey ?? undefined;
}

/**
 * The SESSION a chat view is showing, from the fields it derives that from.
 *
 * `chat-page.tsx` reads `draft?.sessionId` when a draft is staged and
 * `activeSessionId` otherwise - and the first term is not a detail: `stageDraft`
 * leaves `activeSessionId` at the session the reader was in, so a rule that read
 * only `activeSessionId` would answer with the OLD session id on both sides of a
 * New-chat pick. It is also the id the pane hands the panel (`sessionId={id}`),
 * so a second copy of this expression anywhere is a pane keyed on one session
 * while the panel under it reads another.
 *
 * Extracted beside `panelIdentityFor` for that rule's own reason: more than one
 * caller needs the same answer, and a rule that only exists inside one component
 * is a rule the others drift from.
 */
export function panelSessionIdOfView(
	activeDraftKey: string | null,
	draftSessionId: string | null | undefined,
	activeSessionId: string | null | undefined,
): string | undefined {
	return activeDraftKey
		? (draftSessionId ?? undefined)
		: (activeSessionId ?? undefined);
}

/**
 * The pane's own KEY - `panelIdentityFor` applied to the session id above.
 *
 * The pane keys its panel on this, which is what makes it the right answer to
 * "did the flow move the view": a surface that is not the pane (the command
 * palette's close-time restore, which yields when a pick moved the view) can ask
 * for it without keeping a second copy of the expression that computes it - and
 * a second copy is how the two sides of that comparison come to describe
 * different panes.
 */
export function panelIdentityOfView(
	activeDraftKey: string | null,
	draftSessionId: string | null | undefined,
	activeSessionId: string | null | undefined,
): string | undefined {
	return panelIdentityFor(
		activeDraftKey,
		panelSessionIdOfView(activeDraftKey, draftSessionId, activeSessionId),
	);
}

/**
 * Whether a send failed BEFORE the owner could have admitted anything.
 *
 * ONE definition, read by everything that has to act on the answer. Inside this
 * module it drives both the echo's retraction and the `admissionAttempted`
 * un-latch, which must not drift apart - they are two answers to the same
 * question. Outside it, the composer reads it to decide whether a failed send's
 * text belongs BACK in the box (`false` here) or must stay out of it because the
 * message may be on the owner and an echo of it is still painted in the
 * transcript (`true`). A second copy of this predicate is how the two consumers
 * come to disagree about one failure.
 *
 * FOUR FAMILIES, and each is a refusal raised before the prompt can reach the
 * session, so the message provably does not exist on the owner.
 *
 * 1. 413 and 422, which are ours and are raised before `fetch` is even called
 *    (the reasoning is spelled out on the un-latch below).
 * 2. The read window's refusal, raised before the draft is touched.
 * 3. A `runtime_busy` 503 - the owner telling a control call to come back. The
 *    app already repeats that request under its own id (`messageWithBusyResend`),
 *    so this arm decides only what a send looks like once those repeats are
 *    spent, and the answer the owner gave is still "I did not take it".
 * 4. A `runtime_retiring` 409 - the owner is leaving (a build handover, a
 *    signalled stop, a `/move`) and refuses the turn as it latches. The
 *    sentence the far side composes for it says "The message was not admitted".
 *    INERT TODAY: that refusal arrives as a plain string `detail` with no
 *    `code`, so this term cannot fire until the backend half lands (see
 *    `RUNTIME_RETIRING_CODE` for the capture). It is kept because the answer is
 *    already right for the day the code arrives, and because dropping it would
 *    make that day a silent regression.
 *
 * WHAT MUST STAY ON THE OTHER SIDE, because the defect this class fixes has a
 * mirror image that is worse: treated as unknowable, a provably-unadmitted
 * refusal makes the app claim it cannot tell whether the message landed - and
 * treated as admitted-nothing, a genuinely-unknown outcome makes a message the
 * agent may be answering vanish and invites a duplicate send. So a bare 409
 * (receipt conflict, an attachment ladder arm), a bare 503, a `runtime_unreachable`
 * (the hop failure whose ack may have been the only thing lost), a transport
 * failure and the unchanged-payload guard all stay UNKNOWABLE, and are keyed on
 * the codes above rather than on a status or a `retryable` flag that other
 * refusals share.
 */
export function isRefusedBeforeAdmission(error: unknown): boolean {
	if (error instanceof DesktopControlError) {
		/*
		 * Ours, before `fetch`: 413 is the byte-budget guard in
		 * `src/main/desktop-transport.ts` and 422 is the `safeParse` ahead of it, so
		 * neither has a response to have been ambiguous about. 422 is also
		 * reachable from the backend (an unknown command, a malformed body) and
		 * still belongs here: a validation refusal is decided before the prompt is
		 * admitted, so no work started either way.
		 */
		if (error.status === 413 || error.status === 422) return true;
		/*
		 * The two codes the OWNER answers with, per the note above. Read as codes and
		 * not as a status or a flag: the same status carries refusals whose admission
		 * is genuinely unknown (a conflicting receipt's 409), and `retryable` is not a
		 * statement about admission in EITHER direction - the `runtime_busy` body the
		 * app does act on carries `retryable: true` while establishing that nothing was
		 * admitted, so it is neither a safe positive nor a safe negative
		 * (`RUNTIME_RETIRING_CODE` carries the captured bodies).
		 */
		return (
			error.code === RUNTIME_BUSY_CODE ||
			error.code === RUNTIME_RETIRING_CODE ||
			/*
			 * Decided in MAIN, before `fetch` is called at all: the request never
			 * left the machine, so a message the app hedged about was never sent
			 * anywhere. Keyed on the CODE rather than a status, because this
			 * ladder's other members (401/403 `pairing.refused`,
			 * `pairing.plane-closed`) do reach the daemon and say nothing about
			 * whether a message was admitted.
			 */
			error.code === DESKTOP_REFUSAL_CODE.noCredential ||
			/*
			 * The store-write refusals, whose own codes already state that the
			 * write did not happen - which is why the sentence beside them used to
			 * promise the payload was being kept for a retry it never needed.
			 */
			isStoreWriteRefusal(error.code)
		);
	}
	/*
	 * The read window's own refusal belongs in this answer, not beside it. It is
	 * raised before anything is written to the draft and before the transport is
	 * reached, so "nothing reached the owner" is exactly as true of it as of a
	 * 413 - and the composer reads this one predicate to decide whether the text
	 * goes back in the box (`false`) or the outcome is unknowable and the notice says
	 * so. A second copy of that judgement at the call site is how the
	 * two come to disagree about one refusal.
	 */
	/*
	 * And the two refusals that come from THIS side of the wire as
	 * `UserFacingError`s: the read window, which the store raises before the
	 * draft is touched, and a store-write refusal the app itself synthesised. A
	 * store write that did not happen is the same fact whichever class carries
	 * it, so it is read by the same predicate rather than by a second one.
	 */
	return (
		error instanceof UserFacingError &&
		(error.code === SESSION_UNVALIDATED_CODE ||
			error.code === UNREADABLE_ATTACHMENT_CODE ||
			isStoreWriteRefusal(error.code))
	);
}

/**
 * Put an unconfirmed message back in the composer that sent it.
 *
 * THE ONE PATH A FAILED SEND TAKES BACK. Every failure class ends here - a
 * provable refusal, an unknown outcome, a conversation that is gone - so there is
 * one written record of what "hand the payload back" means rather than a restore
 * in the composer hook (which only works while the component that sent it stays
 * mounted), a prop threaded down from the pane, and the pane's own adoption
 * effect. That trio is what the operator's screen showed: an empty box, a
 * paragraph explaining that a message was being kept somewhere else, and two
 * links to get it back.
 *
 * `from` is the identity the composer had when it pressed Enter and `to` the one
 * the conversation lives under NOW. They differ on the New-chat path, where the
 * session is created inside the send and the pane's identity flips from the draft
 * key to the session id: the composer that pressed is unmounted by the time the
 * failure lands, so anything it still held moves across with the payload (see
 * `returnInFlight`). Nothing is left behind an identity no pane will show again.
 *
 * A STORE WRITE, not a returned value, deliberately: in the third case the user
 * has navigated to another conversation and the message is simply waiting in that
 * conversation's composer when they come back, which is one of the things the
 * operator asked for.
 */
export function returnPayloadToComposer(from: string, to: string): void {
	useConversationInputStore.getState().returnInFlight(from, to);
}

/**
 * The composer identity a send for `key` was made under.
 *
 * The pane's own key (`panelIdentityFor`) and the composer's conversation id are
 * the same expression, which is why this is a call rather than a second rule: a
 * draft pane is keyed by its draft key until the session exists, and by the
 * session id after that.
 */
export function composerIdentityFor(
	key: string,
	sessionId: string | null | undefined,
): string {
	/*
	 * AND THE `send:` FORM NAMES ITS SESSION (review round 2, R1). A draft for an
	 * EXISTING conversation is keyed `send:<sessionId>` (`draftIdentityFor`), and
	 * the released app wrote no `sessionId` beside it - only the create branch did.
	 * Reading that key as a draft key left the id undefined, so this answered with
	 * the KEY itself, which is an identity no composer is ever keyed by: the
	 * released app's claim went to an orphan row, and the migration then cleared
	 * `submittedText`, so the message was unrecoverable and the notice's Retry
	 * pressed against an empty box.
	 */
	const named = key.startsWith("send:") ? key.slice("send:".length) : null;
	return (
		panelIdentityFor(
			key.startsWith("draft:") ? key : null,
			sessionId ?? named,
		) ?? key
	);
}

/**
 * Move a message the PREVIOUS release held outside the composer back into it.
 *
 * The released app kept an unconfirmed message in a separate claim on the draft
 * row (`submittedText`, `submittedAttachments`) with an explicit "Restore
 * message" link, and an updated app must not strand one of those: the user would
 * have a chat whose composer says nothing about the message they typed, with no
 * link left to bring it back. The replay fields stay (they are the wire identity
 * a Retry replays under); the payload moves to the composer and the old claim
 * fields go.
 *
 * RUN FROM THE PANE, NOT FROM HYDRATION, and that is deliberate on two counts.
 * Hydration order between this store and `conversation-input-store` is an import
 * order the app does not control, so a migration that wrote into the input store
 * during one of those hydrations could be overwritten by the other. And a pane is
 * the only place with the fact the migration needs anyway: the conversation is
 * still on screen, so a row for a DELETED conversation is never resurrected into
 * a live composer (risk R6). Idempotent by the `migratedHeld` stamp, so a pane
 * that mounts twice moves it once.
 *
 * Returns whether it moved anything, for the caller that wants to know.
 */
export function migrateHeldClaim(
	key: string,
	draft: ChatDraft | undefined,
): boolean {
	if (!draft || draft.migratedHeld || draft.pending) return false;
	/*
	 * THE ROW MUST BE THE RELEASED APP'S, and this is the guard whose absence was a
	 * blocker (review round 1's B1). Everything else this migration used to test -
	 * `submittedText` present, `admissionAttempted`, not pending - is true of a
	 * FAILURE THIS BUILD JUST RECORDED, so the effect that runs it on every draft
	 * change fired on its own fresh rows: it handed the payload back a second time
	 * (doubling the text after a New-chat flip, and writing to an identity the
	 * composer does not read), then cleared `submittedText`/`submittedAttachments` -
	 * the replay identity - so the next Retry went out under the old request id with
	 * a DIFFERENT body (the receipt journal refuses that as a 409, and the app then
	 * reports an unknown outcome for ever), an edited message reused the old id, and
	 * a legacy row's payload could arrive twice.
	 *
	 * `heldClaimCode` is the released app's own claim marker and this build never
	 * writes it (see the field), which makes the test "was this row left behind by
	 * the app that held the message outside the composer" rather than "does this row
	 * look like a failure".
	 */
	/*
	 * AND A CLAIM WITH NO CODE IS STILL THE RELEASED APP'S (review round 2, R3).
	 * Keying the whole gate on `heldClaimCode` alone rejected the released app's own
	 * rows whenever the failure behind them carried no code at all - its renderer
	 * raised `DesktopControlError(null, ...)` for its own deadline and for a failed
	 * IPC - and the message stayed in `submittedText` with no reader and a Retry
	 * over an empty box.
	 *
	 * So the test is the row's SHAPE, and the field that carries it is `errorRetry`:
	 * this build writes it on every failure it records (see the catch in
	 * `admitChatDraft`, the only writer besides this function), and the released app
	 * never wrote it, because it did not exist. A row that has none, and looks like a
	 * released claim in every other way, IS one.
	 */
	/*
	 * AND `submittedRendered`, WHICH IS THE MARKER THIS BUILD WRITES WITH THE LATCH
	 * (review round 3, R2-2). `errorRetry` alone is `undefined` for every row that
	 * left this build WITHOUT reaching its catch: the pin writes `submittedText` and
	 * the latch writes `admissionAttempted` together with `submittedRendered` before
	 * the wire, and a quit before the answer is a row with no `errorRetry` at all.
	 * Treated as a released claim, it handed the payload back (harmlessly) and then
	 * cleared `submittedText` - which is what `replay` reads - while keeping the id,
	 * so the next send went out under an id the owner may already hold a receipt for
	 * and with a body the credential seam re-derived: the receipt-conflict hazard
	 * this pin exists to prevent, on the one arm whose whole point is that the app
	 * cannot tell whether the message was admitted.
	 *
	 * `submittedRendered` is absent from the released build (`v0.30.25` never wrote
	 * it), so the pair below separates the two rows: a released claim has neither
	 * field, this build's interrupted row carries the rendered pin.
	 */
	const releasedClaim =
		draft.heldClaimCode !== undefined ||
		(draft.errorRetry === undefined && draft.submittedRendered === undefined);
	if (!releasedClaim) return false;
	if (!draft.admissionAttempted || draft.submittedText === undefined)
		return false;
	const identity = composerIdentityFor(key, draft.sessionId);
	useConversationInputStore.getState().returnPayload(identity, {
		// The wrappers of any staged reply travel INSIDE this text, because the
		// released claim stored the assembled payload. Acceptable for a one-time
		// move, and it is what makes the migrated draft byte-equal to the claim:
		// pressing Retry replays it under the same request id rather than
		// becoming a second message.
		text: draft.submittedText,
		attachments: draft.submittedAttachments ?? [],
		replies: [],
	});
	useCanonicalSessionsStore.getState().updateDraft(key, {
		migratedHeld: true,
		submittedText: undefined,
		submittedAttachments: undefined,
		/*
		 * THE LEGACY SENTENCE GOES WITH THE CLAIM IT DESCRIBED. The released app
		 * wrote the transport's deadline prose ("The app waits up to 20 seconds for
		 * this request...") into `error`, and leaving it there put a sentence this
		 * app no longer produces over the returned draft - review round 1's U7/Q-7
		 * found it on the first migrated row. The payload is in the composer and its
		 * outcome is unknown, so the row states the table's sentence for that class
		 * and offers the press that answers it.
		 */
		error: SEND_FAILURE_COPY.unconfirmed,
		/*
		 * THE CLAIM'S OWN CODE, kept rather than dropped (review round 2, NIT): it is
		 * what the notice's controls are derived from, and a row that records an
		 * unknown outcome while throwing away the only fact that says WHICH unknown
		 * outcome it was is a row the next reader has to guess about.
		 */
		errorCode: draft.heldClaimCode,
		/*
		 * And the press from that code, through the same rule every other row uses
		 * (`retryWillFail`), rather than the hard-wired `true` this used to write. A
		 * released claim whose code names a refusal the app can act on must not offer
		 * a Retry that meets it again.
		 */
		errorRetry: !retryWillFail(draft.heldClaimCode),
		/*
		 * And the marker that makes the move once-only, whatever the row's shape: a
		 * pane that mounts twice finds `migratedHeld`, and a row written by THIS build
		 * - interrupted before its catch ran, so it carries no `errorRetry` - fails the
		 * `submittedRendered` half of the shape test above and never gets here at all
		 * (review round 3, R2-2).
		 */
		heldClaimCode: undefined,
	});
	return true;
}

/**
 * Whether the payload a composer holds is the one the claim was issued for.
 *
 * The retry rule's one comparison, and it is over the payload the OWNER will
 * see: the normalized text (the composer's `buildSendPayload` output, reply
 * wrappers and all) and the attachment PATHS in order.
 *
 * PATHS rather than the encoded images beside them, deliberately. Images travel
 * as re-encoded bytes, and the encoder is not promised to be byte-stable across
 * attempts - so comparing them would make a Retry that re-encoded the same file
 * report itself as a different message, and the same-id replay it is entitled to
 * would become a fresh send under a fresh id (two rows for one message). The
 * paths are the user's own list, so a changed list is genuinely a changed
 * message, which is exactly what the comparison has to detect.
 */
function payloadMatchesClaim(
	claim: ChatDraft,
	text: string,
	attachments: readonly string[],
): boolean {
	if (claim.submittedText !== text) return false;
	const claimed = claim.submittedAttachments ?? [];
	if (claimed.length !== attachments.length) return false;
	return claimed.every((path, index) => path === attachments[index]);
}

/**
 * Whether a send addressed to `sessionId` is inside the validation window.
 *
 * Extracted and exported for the same reason `draftIdentityFor` and
 * `panelIdentityFor` are: a rule that only exists inside one component is a rule
 * nothing exercises. `scripts/session-switch.test.mjs` drives a real
 * `openSession` and asserts the refusal through the store it belongs to, so a
 * regression in the gate - dropping a term, or comparing the wrong id - fails a
 * case instead of shipping.
 *
 * The window has no live term of its own here because it does not need one any
 * more: `confirmSessionLive` closes it when the session's stream proves the
 * session exists, so a second condition at the call site would be a second
 * answer to a question the store already answers (see `validatingSessionId`).
 */
export function isSessionUnvalidated(
	validatingSessionId: string | null,
	sessionId: string | null | undefined,
): boolean {
	return Boolean(sessionId) && validatingSessionId === sessionId;
}

/**
 * How many times a send that met a BUSY owner is repeated before the refusal is
 * handed to the composer, and the longest single wait between two attempts.
 *
 * `runtime_busy` (see `RUNTIME_BUSY_CODE`) is the daemon refusing a control call
 * in ~3 s because the session's owner is alive and not answering - mid-turn in a
 * long synchronous step, typically - and saying a resend with the same
 * `request_id` is safe. A short-lived busy owner is the common case, so the app
 * absorbs a few of those itself instead of showing the user a failure for
 * something that clears on its own: three resends at the backend's own
 * `retry_after_ms` (2 s today) is about 15 s of patience end to end, the same
 * order as the 15 s the old control bind spent waiting before it gave up, and
 * each attempt answers fast, so the whole loop never approaches the renderer's
 * own 20 s per-request deadline. Past that the refusal reaches the composer, which
 * hands the text BACK to the box rather than holding it against the transcript:
 * each attempt failed before admission, so the code is one of
 * `isRefusedBeforeAdmission`'s and the send does not latch. Holding it would
 * describe the operator's own message as one whose fate cannot be known, which is
 * the one thing this owner has just said it is not.
 *
 * The cap on one wait is there because the hint comes off the wire: a backend
 * that asked for a minute must not park a send that long with nothing on screen
 * but the pending echo.
 */
const BUSY_RESENDS = 3;
const BUSY_RESEND_MAX_WAIT_MS = 5_000;
const BUSY_RESEND_DEFAULT_WAIT_MS = 2_000;

/**
 * `sessions.message`, repeated on `runtime_busy` with the SAME request.
 *
 * The request object is reused whole - same `requestId`, same text, images and
 * `mode` - because the backend's receipt is keyed on a hash of the whole body
 * (`desktop_receipts.py`): a resend that differed in any field would be a 409,
 * and one with a fresh id could deliver twice. Every other failure is thrown on
 * the first attempt, untouched, so the classification in `admitChatDraft`'s
 * catch sees exactly what it saw before this existed.
 */
async function messageWithBusyResend(
	request: Extract<DesktopRequest, { op: "sessions.message" }>,
): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await desktopResult(request);
			return;
		} catch (error) {
			if (
				attempt >= BUSY_RESENDS ||
				!(error instanceof DesktopControlError) ||
				error.code !== RUNTIME_BUSY_CODE
			)
				throw error;
			const wait = Math.min(
				Math.max(0, error.retryAfterMs ?? BUSY_RESEND_DEFAULT_WAIT_MS),
				BUSY_RESEND_MAX_WAIT_MS,
			);
			await new Promise((resolve) => setTimeout(resolve, wait));
		}
	}
}

/** Create and admission are intentionally separate receipts. A response lost
 * between them retains its exact IDs and payload; retry never reallocates or
 * deletes work that may already have been admitted by the owner. */
export async function admitChatDraft(
	key: string,
	input: {
		text: string;
		attachments: string[];
		images: ChatImage[];
		mode: "prompt" | "steer";
		cwd: string;
	},
	sessionId?: string,
	/**
	 * Called when the optimistic echo is applied to a mounted transcript, i.e.
	 * when the message is actually on screen. Passed straight to
	 * `echoPendingUser`; the composer is the only caller that has anything to do
	 * with the answer (see `PendingEcho` in `use-canonical-session`).
	 */
	onEchoPainted?: () => void,
	/**
	 * The seam between "the session exists" and "the message is admitted".
	 *
	 * It exists for one caller and one reason: a CREDENTIAL handed over in a
	 * conversation's FIRST message. The composer must store the value into the
	 * session's tool environment before the message that cites it leaves, §9's
	 * whole point — but on a draft pane the session is created INSIDE this call,
	 * so before it there is genuinely nothing to store into and the store's only
	 * honest answer is "no session to reach". The most likely first use of the
	 * feature (a brand-new chat whose first message hands over an API key)
	 * therefore could not work at all, and degraded silently to the not-stored
	 * citation (UX round 1, U2; code review round 1, MINOR-4).
	 *
	 * Called with the id this call has resolved — the one it created, or the one
	 * it was handed — and BEFORE the optimistic echo and the transport, which is
	 * the only window in which the answer can still change what is sent. The
	 * returned string, when there is one, is what the echo paints and what the
	 * message carries; `undefined` keeps `input.text`.
	 *
	 * It runs after `sessions.create` and before `admissionAttempted`, so a
	 * throw here is still "nothing was admitted": the composer gets its text
	 * back rather than a held claim about a message the owner never saw.
	 */
	beforeAdmission?: (sessionId: string) => Promise<string | undefined>,
): Promise<string | null> {
	const store = useCanonicalSessionsStore.getState();
	/*
	 * THE VALIDATION WINDOW'S GATE, and it lives here rather than at the call
	 * site because "a message may not be admitted against a session nothing has
	 * confirmed yet" is a property of admission, not of one screen's send button.
	 *
	 * The commit puts the view on the target before its stream has said whether
	 * it still exists, and `validatingSessionId` is that window (closed by the
	 * stream's first snapshot). A message admitted inside it would be addressed
	 * to a session that may be gone - so it is refused here, before the draft is
	 * latched and before the transport is reached, which is also what makes the
	 * refusal a `false` at the composer rather than a held claim (see
	 * `isRefusedBeforeAdmission`).
	 *
	 * `UserFacingError` rather than a bare `null`, deliberately. `null` is this
	 * function's answer for "the same send is already in flight" and for the
	 * unchanged-payload guard, and the composer cannot tell the three apart from
	 * it - which is exactly how this refusal stayed silent for a whole review
	 * round (UX round 2, U8). The error carries the sentence the composer shows.
	 *
	 * Only a send that NAMES a session can be refused: creating one addresses no
	 * existing target, so the create path is untouched.
	 */
	if (isSessionUnvalidated(store.validatingSessionId, sessionId))
		throw new UserFacingError(
			SESSION_UNVALIDATED_MESSAGE,
			SESSION_UNVALIDATED_CODE,
		);
	const previous = store.drafts[key];
	if (previous?.pending) return null;
	// Normalized once, here, and used for the guard, the stored claim and the
	// wire alike - see `normalizeSendText`. Comparing or sending `input.text`
	// anywhere below would reopen the gap between what the guard enforces and
	// what the composer says about it.
	const text = normalizeSendText(input.text);
	/*
	 * ONE SEND IN FLIGHT, AND ONE COMPARISON - the two facts this function's exit
	 * rests on, which is why they are stated together.
	 *
	 * ONE SEND IN FLIGHT per pane: the draft row carries the request id, and two
	 * concurrent admissions would race on it. Left as the store's own silent `null`,
	 * because the composer's send lock already reports it in words and this arm is
	 * the second press inside the same keystroke.
	 *
	 * WHAT USED TO BE HERE, AND WHY IT IS GONE. A guard compared this payload with
	 * the claim's and REFUSED any difference - which is what put a paragraph about a
	 * different message being impossible on the operator's screen, and made a
	 * composer the custodian of a message the app was holding. The protection it
	 * existed for is real and needs no block: an UNCHANGED resend must be an
	 * idempotent replay under the same request id (the owner de-duplicates by
	 * `command_id`, and the receipt journal by a hash of the whole body), while a
	 * CHANGED one is a different message - a new message by definition - and goes out
	 * under a new id. So what follows is a replay DECISION, not a refusal, and nothing
	 * the user can type is ever rejected because of what was sent before.
	 *
	 * AND THE COMPARISON IS OVER THE LAST ATTEMPT WHATEVER ITS CLASS. The old gate
	 * also required `admissionAttempted`, the latch for an UNKNOWN outcome, which
	 * meant the arms where the backend refused the request outright got a fresh
	 * request id for an unchanged re-send. That is the case the id exists to cover:
	 * the owner de-duplicates by it, and a busy owner that had in fact queued the
	 * command would answer the re-send as a SECOND message. So the payload decides
	 * (normalized text and attachment paths, in order - see `payloadMatchesClaim`),
	 * not the class: the same message replays under the id it was first issued with,
	 * and an edited one is a new message with its own.
	 */
	const replay =
		previous?.submittedText !== undefined &&
		payloadMatchesClaim(previous, text, input.attachments);
	const draft: ChatDraft = previous ?? {
		key,
		createRequestId: crypto.randomUUID(),
		admissionRequestId: crypto.randomUUID(),
	};
	/*
	 * WHAT IS PINNED ON A REPLAY, AND WHY ANY OF IT IS. `mode` reads like a
	 * delivery instruction rather than payload, and it MUST be pinned once an
	 * admission has been issued: the server keys its receipt on a sha256 of the
	 * WHOLE request body, `mode` included (desktop_receipts.py), and refuses a
	 * same-id retry whose body hashes differently with a 409 ReceiptConflict. So
	 * the lost-response case - admitted, response never arrived, session now
	 * streaming, UI recomputes busy and would say "steer" - would retry as a
	 * different body, 409 forever, and report a failure for a message that landed.
	 *
	 * An EDITED payload is a new message: it rotates the request id and takes this
	 * attempt's own values rather than the previous claim's, so the claim cannot
	 * outlive the message it described.
	 */
	const images = replay
		? (previous?.submittedImages ?? input.images)
		: input.images;
	const mode = replay ? (previous?.submittedMode ?? input.mode) : input.mode;
	/*
	 * And the id follows the same rule: the last attempt's id when this is the same
	 * message, a fresh one when it is not. A first send has no previous payload, so it
	 * keeps the id the draft was staged with (`stageDraft`'s own mint) - that is the id
	 * the echo is painted under and the one the owner gives the durable row, and
	 * re-minting it here would key the echo to one UUID and the request to another.
	 */
	const admissionRequestId =
		previous?.submittedText === undefined || replay
			? (previous?.admissionRequestId ?? crypto.randomUUID())
			: crypto.randomUUID();
	store.updateDraft(key, {
		...draft,
		/*
		 * `true` only on a replay. A fresh send is a request that has not been
		 * issued yet - the latch below is what sets this flag - so leaving the
		 * previous claim's value in place would hold a claim over a message this
		 * attempt has not sent.
		 */
		admissionAttempted: replay,
		admissionRequestId,
		submittedRendered: replay ? previous?.submittedRendered : undefined,
		migratedHeld: previous?.migratedHeld,
		pending: true,
		submittedText: text,
		submittedAttachments: input.attachments,
		submittedImages: images,
		submittedMode: mode,
		/*
		 * The last attempt's sentence and code go with it: a retry that leaves a
		 * stale refusal on screen over a request that is now in flight reads as the
		 * failure having repeated itself, and the notice is re-raised by whatever
		 * this attempt's outcome is.
		 */
		error: undefined,
		errorCode: undefined,
	});
	/*
	 * Whether the message request was ISSUED - the store's own latch, read at the
	 * catch to decide whether an owner row could possibly exist. Local rather than
	 * re-read from the row there, because the row is written twice below (the pin,
	 * then the latch) and a third read at the catch is a third chance to disagree
	 * with itself.
	 */
	let attempted = replay;
	// Declared outside the try because the catch needs it to address the echo:
	// `draft` is the pre-send snapshot, so reading `draft.sessionId` there would
	// miss a session this very call created and leave its echo unretractable.
	let id = sessionId ?? draft.sessionId;
	/*
	 * WHICH REQUEST THE FAILURE CAME FROM, and the reason this is recorded rather
	 * than inferred at the catch.
	 *
	 * The classification below asks one question - "was the user's message
	 * refused for its leading slash?" - and only `sessions.message` can answer
	 * it. `sessions.create` shares this try because a send to a NEW conversation
	 * has to create one first, but its 422 is about the CREATE fields (`cwd`,
	 * `target`), and the draft text it would be classified against never left the
	 * renderer: the request ops were `['sessions.create']`. Classifying that
	 * failure by the draft's shape told a user whose directory was invalid to
	 * "move it below your text" - the app confidently naming the wrong cause,
	 * which is the exact class of defect U13 exists to remove, so reintroducing
	 * it on the display path we had just repaired would be worse than never
	 * having repaired it (round 5, R13).
	 *
	 * Reaching the message request is therefore the PRECONDITION of the slash
	 * classification, not the draft's shape - and this variable is the only thing
	 * that can satisfy it. It is set immediately before the request it names, so
	 * a failure raised anywhere earlier (including a create that "succeeded"
	 * without returning an id) stays on the create side by default.
	 */
	let inFlight: "sessions.create" | "sessions.message" | null = null;
	try {
		if (!id) {
			inFlight = "sessions.create";
			id =
				(await store.createSession(
					input.cwd,
					draft.target,
					draft.createRequestId,
					// The pane's own pick, or nothing at all: a draft that was never
					// picked from omits the field from the create body entirely.
					draft.model ?? null,
				)) ?? undefined;
			if (!id)
				throw new UserFacingError(
					useCanonicalSessionsStore.getState().error ?? "Chat could not start.",
				);
			store.updateDraft(key, { sessionId: id });
		}
		// From here the outcome is unknowable on failure: the owner may have
		// admitted the command before the response was lost.
		// THE SEAM, before the echo and before the wire: see `beforeAdmission`.
		// `text` stays the payload IDENTITY for the guard below (it is the string
		// the composer will send again on a retry, markers and all), while
		// `rendered` is what the operator sees echoed and what the owner receives.
		/*
		 * A REPLAY DOES NOT RE-RENDER, and skips the credential seam with it. The
		 * pinned text IS the body the first attempt sent, so re-running a
		 * substitution over it could only change the body the receipt is keyed on
		 * - and the values it would substitute are already inside the message the
		 * owner has (or has not) admitted.
		 */
		/*
		 * THE SEAM RUNS WHENEVER NOTHING HAS BEEN RENDERED YET, replay or not.
		 *
		 * The pin exists so a REPLAY is byte-identical to the body the owner's
		 * receipt is keyed on - and a row created before the create hop answered has
		 * no pin, because the seam had no session to substitute into. Reading the pin
		 * alone sent the raw composer text on that retry: the credential markers went
		 * to the model verbatim ("[Credential #1, 19 chars]") and the credential was
		 * never stored into the session that the retry had just created - review round
		 * 1's M4/m5. So the pin is used when there is one, and the seam runs when
		 * there is not: nothing was rendered, so there is no body to keep identical.
		 */
		const rendered =
			replay && previous?.submittedRendered !== undefined
				? previous.submittedRendered
				: beforeAdmission
					? ((await beforeAdmission(id)) ?? text)
					: text;
		attempted = true;
		/*
		 * The rendered text is pinned in the same update that latches the attempt,
		 * so a replay has nothing left to re-derive: see the pinning note above for
		 * what a re-render costs (a same-id request whose body hashes differently,
		 * refused as a receipt conflict).
		 */
		store.updateDraft(key, {
			admissionAttempted: true,
			submittedRendered: rendered,
		});
		/*
		 * Paint the message BEFORE the await, not after it.
		 *
		 * This is the whole felt-latency fix: the message request spends ~1.15 s
		 * engaging a cold runtime on a session nobody warmed, and until now the
		 * user's text sat in the composer for all of it with nothing on screen.
		 * The echo is synchronous, so the text moves from box to transcript in
		 * one frame regardless of what the backend costs.
		 *
		 * "Synchronous" is exact only when a transcript for this session is already
		 * mounted. On the New-chat path there is none - the panel keyed on the id
		 * this block is about to mint does not exist yet - so the echo buffers and
		 * lands when that panel mounts, one create hop later. `onEchoPainted` is
		 * what keeps the composer honest there: the box holds the text until the
		 * echo is actually painted rather than until this line runs. What that means
		 * mechanically is worth spelling out, because the callback does NOT clear the
		 * box the user is looking at: the drain delivers it into the composer this
		 * `updateDraft` has already unmounted, and the interval ends because the panel
		 * that replaces it never held the text and seeds its first state from the
		 * buffer (U3, `seedPendingEchoes`).
		 *
		 * Keyed by `admissionRequestId` — the id the owner gives the durable row
		 * — so this coalesces with `message_start` instead of duplicating it.
		 * See `appendPendingUser`.
		 */
		echoPendingUser(
			id,
			admissionRequestId,
			rendered,
			images.map((image, index) => ({
				// Same id shape `extractImages` gives the owner's row, so the
				// coalesced record keeps its image keys across the swap.
				id: `${admissionRequestId}:${index}`,
				data: image.data_b64,
				attachment: null,
				mimeType: image.mime_type,
			})),
			onEchoPainted,
		);
		inFlight = "sessions.message";
		await messageWithBusyResend({
			op: "sessions.message",
			sessionId: id,
			requestId: admissionRequestId,
			text: rendered,
			images: images.length ? images : undefined,
			mode,
		});
		store.finishDraft(key, id);
		// A send that landed retires every message about the send that did not.
		// `createSession` records its failure page-level and only `fetchSessions`/
		// `openSession` ever cleared it, so a successful retry left a stale "Chat
		// could not start." standing over a working conversation.
		useCanonicalSessionsStore.setState({ error: null });
		return id;
	} catch (error) {
		// One owner for one failure. `createSession` sets the page-level `error`
		// AND rethrows, so the same sentence rendered twice - once at the top of
		// the chat column and once at the composer. The composer's copy is the
		// actionable one (it sits on the text that failed and carries Retry and
		// Clear), so the send takes the message over and clears the other.
		useCanonicalSessionsStore.setState({ error: null });
		/*
		 * WHICH OF THE THREE OUTCOMES THIS IS, decided once and read by every
		 * branch below: `not_sent` (the message provably never reached the
		 * session), `unknown` (it may have, and the app cannot tell) and `gone`
		 * (the conversation is not there). See `sendFailureClass`.
		 */
		/*
		 * ONE FACT, ABOUT THE ID THIS REQUEST ACTUALLY CARRIED (review round 3,
		 * R2-1). `previous.admissionAttempted` is the PRE-SEND snapshot, and an
		 * edited payload rotates `admissionRequestId` in this same call - so read on
		 * its own it can describe an id this attempt no longer uses. Read that way, a
		 * codeless 409 on a FRESH id took the unknown branch for the sentence while the
		 * row latched `not_sent`: one failure, two classes, and the sentence "Sending
		 * it again is safe." offering a Retry that re-posted a body the daemon had just
		 * refused.
		 *
		 * `replay` is the retry rule's OWN answer about the id - a replay reuses the id
		 * it was first issued with, an edit mints a new one - so the fact below is true
		 * only for an attempt that went out under an id an earlier attempt had already
		 * used and left unresolved. That is exactly the receipt conflict the
		 * codeless-409 split exists to tell from a refusal of this body, and it is the
		 * value both classifications now read.
		 */
		const replayedAttempt = replay && previous?.admissionAttempted === true;
		const klass = sendFailureClass(error, replayedAttempt);
		// Gated on the request that actually failed: a create-stage 422 is about
		// the create fields and must keep its own diagnosis (round 5, R13).
		const leadingSlash =
			inFlight === "sessions.message" && isLeadingSlashRefusal(error, text);
		const failureCode = leadingSlash
			? LEADING_SLASH_CODE
			: sendFailureCode(error);
		// One call, so the sentence the row keeps and the control it offers cannot
		// come from two classifications of the same failure.
		const copy = sendFailureCopy(error, failureCode, replayedAttempt);
		/*
		 * DID IT LAND AFTER ALL? Only a failure with an UNKNOWN outcome can be
		 * answered this way, and only when the id the owner would have used is
		 * already painted as a row that is not ours.
		 *
		 * `retractLocalEcho` removes the record only while it is still this app's
		 * own optimistic echo (`local: true`, stamped by `appendPendingUser`). A
		 * user record without that flag is the OWNER's - its `message_start` or a
		 * durable history row - which means the message was admitted, the failure
		 * was the response to it, and nothing should be handed back: the send
		 * succeeded. The three direct answers matter, because the third one has
		 * nothing to report: with no transcript mounted the retraction is QUEUED
		 * exactly as the echo was, and the reconciliation in the pane decides it
		 * when the panel mounts (see `SessionPanel`'s delivered effect).
		 */
		let delivered = false;
		if (id && attempted) {
			if (klass === "unknown") {
				delivered = retractLocalEcho(id, admissionRequestId) === "owner";
			} else {
				retractPendingUser(id, admissionRequestId);
			}
		}
		/*
		 * WHAT A FAILURE LEAVES ON THE ROW: the LATCH only for an unknown outcome, and
		 * the payload basis for every class.
		 *
		 * `admissionAttempted` is the fact the PANE reads - `sendUnsettledForSession`
		 * shows a send as in flight from it, and the pane's reconciliation looks for the
		 * owner's row under the id it names - so it stays exactly what it says: an
		 * admission was issued and its outcome is not known. A refusal the backend
		 * stated is not that, and does not latch.
		 *
		 * The payload fields stay because they are the COMPARISON BASIS the retry rule
		 * reads (`payloadMatchesClaim`), not a claim anybody has to release: the copy the
		 * user acts on is in the composer, and this row's copy is a fingerprint. Dropping
		 * them here would make an unchanged re-send a fresh request id, which is the one
		 * thing the owner's de-duplication needs to not happen.
		 */
		store.updateDraft(key, {
			pending: false,
			admissionAttempted: klass === "unknown" && attempted,
			errorCode: failureCode,
			/*
			 * The row's own sentence comes from the SAME table the composer renders,
			 * with the code this catch reclassified (a leading-slash 422). Recording
			 * `userFacingMessage` here instead was wrong for every unknown outcome: a
			 * raw throw or a lost response has no sentence of its own, and the generic
			 * fallback says "Your message wasn't sent." - a claim about a request the
			 * app has just said it cannot see. The row is what a remounted composer
			 * reads, so the notice must survive that remount unchanged.
			 */
			error: copy.message,
			/*
			 * And the control the sentence goes with, decided by the same call: see
			 * `errorRetry` for why the row carries it rather than the pane deriving it.
			 */
			errorRetry: copy.retry,
		});
		/*
		 * THE ONE RETURN PATH, for all three classes, and it is the point of this
		 * change: whatever happened to the request, the user's message is back in
		 * the composer of the conversation that sent it - text, chips and staged
		 * replies - with one sentence and at most Retry and Clear beside it. There
		 * is no second copy of it anywhere and nothing to restore.
		 *
		 * `from` is the identity the composer pressed under and `to` the one the
		 * conversation has now; on the New-chat path they differ, and the payload
		 * that was staged under the draft key moves across with it.
		 */
		if (!delivered) {
			const to = id ?? draft.sessionId;
			const composerKey = composerIdentityFor(key, to);
			returnPayloadToComposer(
				panelIdentityFor(
					key.startsWith("draft:") ? key : null,
					draft.sessionId,
				) ?? composerKey,
				composerKey,
			);
			throw leadingSlash
				? new DesktopControlError(
						422,
						LEADING_SLASH_MESSAGE,
						error,
						LEADING_SLASH_CODE,
					)
				: error;
		}
		/*
		 * Delivered after all: the send is a success, so the composer stays empty,
		 * nothing is handed back, and the draft row retires exactly as it does on
		 * the acknowledged path. The pane's reconciliation would reach the same
		 * answer a moment later from the transcript; resolving here is what saves
		 * the user a frame in which their message appeared to have failed when it
		 * had not.
		 */
		// `delivered` is only ever set with an id in hand (the branch above), so
		// this is the compiler's need and not a second decision.
		if (id) {
			store.finishDraft(key, id);
			useConversationInputStore
				.getState()
				.settleInFlight([composerIdentityFor(key, id)]);
			return id;
		}
		return null;
	}
}

/**
 * One press of a conversation, as the read receipt's re-arm reads it.
 *
 * A RECORD OF THE PRESS, not a flag that a receipt is wanted: the reader has to
 * answer two questions with it - WHICH conversation the operator just opened,
 * and WHETHER it is a press it has already honoured - and a boolean answers
 * neither (`readAckRearm` on the state states the whole rule).
 */
export type ReadAckRearm = { sessionId: string; revision: number };

/**
 * What the read receipt is doing, as the ROW can draw it.
 *
 * Three states rather than two because the reader has to be able to tell two of
 * them apart, and the reason the receipt exists is that they were the same
 * screen: `pending` is the app retrying now (a contention budget, the ladder's
 * flat window), `offscreen` is the one state a press cannot repair (the
 * completion's result is not on screen, and the anchor hit test - the
 * definition of shown - refuses until it is), and `unsettled` is the ladder's
 * own ceiling, where the app is no longer retrying promptly. `unsettled` and
 * `pending` are the pair an operator could not distinguish before: both kept the
 * mark and said nothing, one of them while retrying twice a second and the other
 * once a minute (UX round 1, U1).
 */
export type ReadAckNoticeKind = "pending" | "offscreen" | "unsettled";

/**
 * The read receipt's own observable state for one conversation.
 *
 * THE RECEIPT'S SECOND JOB. This row's mark is drawn from the backend's state,
 * and until this change the only trace of an acknowledgement that had NOT landed
 * was a `console.warn` - a developer channel - so a receipt the store had
 * refused twice a second and one it had given up retrying looked identical to a
 * row nobody had ever clicked (the operator's own report, and UX round 1's U1:
 * the mark simply stayed). This is the fact the panel draws instead.
 *
 * WHY ONE RECORD AND NOT A MAP. `useCompletionView` runs one loop per open
 * conversation, so there is one conversation a receipt can be waiting on at a
 * time; a second loop replaces the first's statement exactly as a second press
 * replaces the first's stamp (`readAckRearm` above is one record for the same
 * reason). A row that is not this conversation's renders nothing from it.
 *
 * THE LIFETIME IS THE LOOP'S, and the loop clears it on every path out -
 * settled, superseded, dependency change, unmount - because the statement is
 * "the app is trying for this completion" and it stops being true when the
 * attempt no longer exists. This is deliberately the opposite of
 * `readAckRearm`'s "not a timer" rule rather than an exception to it: that rule
 * keeps a GESTURE from being invented, and this record never claims one - it
 * reports what the app did next, which is why the toast (the reader-facing arm)
 * is fired once per budget instead of once per render, and why nothing here is
 * persisted either (`partialize` names its keys).
 */
export type ReadAckNotice = {
	sessionId: string;
	kind: ReadAckNoticeKind;
	/**
	 * Advances on every CHANGE of the pair above, so a reader can tell a new
	 * statement from the same statement seen again - the role `revision` plays for
	 * the press. The panel's toast is keyed on it, which is what keeps the give-up
	 * arm to one announcement per budget rather than one per render.
	 */
	revision: number;
	/**
	 * The refusal, for `unsettled` only, exactly as the transport raised it - a
	 * FACT rather than a sentence: the panel CLASSIFIES it and composes this app's
	 * own sentence for the class at the one call site that says sentences
	 * (`features/chat/read-ack-notice.ts`) - the only place here that turns a
	 * desktop failure into words, and the only one that knows a store refusal from a
	 * refusal the store never saw. Absent for the two states that are not about a
	 * refusal.
	 */
	reason?: unknown;
};

type CanonicalSessionsState = {
	sessions: CanonicalSessionRow[];
	activeSessionId: string | null;
	activeDraftKey: string | null;
	drafts: Record<string, ChatDraft>;
	sessionByAgent: Record<string, string>;
	/**
	 * The session the view has moved onto that its own stream has not yet
	 * confirmed exists.
	 *
	 * A send addressed to it is refused (`SESSION_UNVALIDATED_MESSAGE`, the
	 * composer keeps the text) rather than issued at a session that may be gone.
	 * The window used to be closed by a `sessions.get` guard read issued at the
	 * click; that read is gone from the click path (see `openSession`), because
	 * it was a second facade acquire racing the stream for the same bridge
	 * locks and it held the composer shut for 2-20 s behind a busy owner.
	 *
	 * ITS BOUNDS NOW. The stream's first `snapshot` frame closes it -
	 * `confirmSessionLive`, reported by `chat-page` - and that is the same frame
	 * that paints the messages, so the transcript and a working composer arrive
	 * in one commit. A 404 on the subscription ends it the other way
	 * (`confirmSessionMissing`): the id is tombstoned and the pane lands on the
	 * missing-session notice, whose composer refuses on `conversationUnavailable`. Any other terminal stream failure
	 * leaves it open, which is right: the pane states `unavailable` and its Retry,
	 * and a send at a conversation nothing has proven reachable should not be
	 * issued. Switching away (`openSession`, `stageDraft`, `setActiveSession`)
	 * clears or replaces it.
	 *
	 * A window is opened only for a switch that MOVES the view: `openSession`
	 * returns early when the target is already active and no draft is staged. The
	 * one shape that escapes it - the active row clicked while a draft IS staged,
	 * a real move because it leaves the draft - opens a window on a session the
	 * panel is already showing, where the stream effect's `[sessionId,
	 * canonical.status]` deps do not change; `chat-page` therefore also reports
	 * a stream that is ALREADY live when the window opens (its effect reads this
	 * field too), so that shape is closed in the same commit.
	 */
	validatingSessionId: string | null;
	/**
	 * A pin press that did not survive, held until the user presses again.
	 *
	 * The optimistic write is reverted with this, and both halves are the point:
	 * a glyph left lit on a failed write is a claim about durable state the store
	 * does not hold, and a SILENT revert is the "the pin keeps un-pinning itself"
	 * report all over again. It is one record rather than a log because there is
	 * one row under the pointer: a second failure replaces the first, which is
	 * what that user is looking at.
	 */
	pinFailure: PinFailure | null;
	/**
	 * The client's own pin state for conversations its catalogue page may not hold.
	 *
	 * WHY THIS EXISTS BESIDE `sessions`. `replaceSessionRows` rebuilds the row list
	 * from the page payload alone, deliberately: the page is the authority on which
	 * conversations exist, and a row kept past it would be one the backend had
	 * deleted. But `sessions.list` is CAPPED (500 rows, reported as `truncated`),
	 * while the search answer is asked of the whole store - so a conversation the
	 * user just pinned from a search hit is in neither: its row is inserted by
	 * `setSessionPin` and then dropped by the catalogue refresh that very write
	 * triggers. The row then falls back to the cached wire hit, which reports the
	 * state the search last saw, and the next press re-sends the state already
	 * applied - QA round 2's Qr2-1, measured: wire `pinned: true`, store file
	 * holding the id, DOM row `aria-pressed="false"`, and the follow-up press
	 * sending `true` again.
	 *
	 * A pin is a fact this client wrote and the backend confirmed, so it is held
	 * here rather than inferred from a page that cannot carry it. `searchChats`
	 * renders it for a row the catalogue does not list, and the press inverts it,
	 * which is what makes the control's state and the press's direction the same
	 * fact (the round's own requirement).
	 *
	 * Cleared nowhere on purpose: it is one boolean per conversation this window
	 * has pinned, which is bounded by what the user pressed, and a row that
	 * reappears in a later page carries the wire's `pinned` over it by load order
	 * (`mergeRow`: the incoming row wins).
	 */
	pinFacts: Record<string, PinFact>;
	/**
	 * The answer counter every fact and every request is stamped against.
	 *
	 * One monotonic sequence over every state-changing event on this client: each
	 * request takes the next value when it STARTS, and each write takes the next
	 * value when it LANDS. So `fact.at < answerSeq-of-this-request` means the
	 * answer is newer than the write and may supersede it, and the reverse order
	 * means the write is newer and the answer must not touch it (`PinFact` has the
	 * reasoning). Writes take their own value rather than reading the current one
	 * so that two writes can never share a stamp and mistake each other for
	 * themselves.
	 */
	answerSeq: number;
	/**
	 * Apply the backend's pin state to one row, optimistically.
	 *
	 * Optimistic rather than refetch-and-wait: `sessions.list` is a WHOLE
	 * catalogue read (measured at ~120 ms median for 200 rows, and the sidebar
	 * asks for 500), so a refetch per press would be visibly slower than the
	 * state change it is confirming. On success the row is reconciled with the
	 * answer's own `pinned`, so a response that disagreed would still win; on
	 * failure the row is put back and `pinFailure` says what happened.
	 *
	 * Returns whether the press stands, for a caller that wants to act on it.
	 */
	/**
	 * Pin or unpin, and INSERT the row when the store does not hold it yet.
	 *
	 * WHY the seed. A conversation reached through the search answer - a hit for a
	 * session this client's page does not list - has no row here, so a press used to
	 * write the backend and change nothing this panel could read: the sidebar kept
	 * drawing the synthesized row from the cached WIRE hit, whose `pinned` no store
	 * write updates, and the next press re-sent the state already applied (QA round 2,
	 * Qr2-1: a pin that could not be undone from the row it was made on).
	 *
	 * So the press carries enough of the row to hold it: from that moment the STORE's
	 * `pinned` is what the control renders and what the press inverts, and the wire hit
	 * is only what a conversation the store has never held is drawn from.
	 */
	beginAnswer: () => number;
	applySearchAnswer: (
		seq: number,
		hits: { id: string; pinned?: boolean }[],
	) => void;
	setSessionPin: (
		sessionId: string,
		pinned: boolean,
		seed?: { title?: string; updated_at?: number },
	) => Promise<boolean>;
	/**
	 * Which reads the daemon could not answer on the last successful session
	 * list, in the daemon's own vocabulary (`liveness`, `wakes`, `attention`), or
	 * empty when it answered every one of them.
	 *
	 * WHY it is carried rather than dropped on the floor. A swallowed liveness
	 * read publishes `active: false` for every row, and the sidebar renders that
	 * as "Nothing running right now." - a claim about the machine derived from a
	 * read that FAILED. The field is additive and optional: a daemon that
	 * predates it sends nothing, this stays empty, and every surface renders
	 * exactly as it did before it existed.
	 */
	statusUnavailable: string[];
	/**
	 * One counter, shared by every read this store issues, that orders answers
	 * against writes (see `archiveFacts`).
	 *
	 * A MONOTONIC STAMP RATHER THAN A CLOCK, for the reason `refreshGeneration`
	 * above is a stamp: a clock is comparable across two writers only if they share
	 * one, and the press and the request are already in one process, so a counter
	 * says exactly what is needed - "this read was asked about after that write" -
	 * with no skew to reason about.
	 */
	loading: boolean;
	truncated: boolean;
	error: string | null;
	cwd: string;
	setCwd: (cwd: string) => void;
	/**
	 * What THIS CLIENT knows about one conversation's archive state, and WHEN it
	 * learned it, keyed by session id.
	 *
	 * A fact exists because the write is OPTIMISTIC: the row leaves the list the
	 * moment the user presses, and every read that follows - a search answer served
	 * from the cache, a catalogue page whose request started before the press - was
	 * asked before the backend held the new state. The `at` stamp is the currency
	 * that orders them: an answer that SPEAKS about the id (`applySearchAnswer`, or
	 * a newer page) supersedes a fact older than the answer's own request, while a
	 * fact written after that request survives it. Without the stamp the fact would
	 * outrank every later answer, so an unarchive made in the terminal would leave
	 * the conversation hidden here forever - the two-way claim this work exists for.
	 *
	 * The stamp is taken when the REQUEST STARTS, never when its answer lands:
	 * comparing arrival times would let an answer that predates a press supersede
	 * it, which is the same defect on a shorter clock.
	 */
	archiveFacts: Record<string, ArchiveFact>;
	/**
	 * The conversations THIS WINDOW must not draw, keyed by session id (see
	 * `ForgottenFact`): the ones it permanently deleted, and the ones a read proved
	 * are gone. Written by `forgetSession` (from the delete) and by
	 * `confirmSessionMissing` when a switch's own stream answers not-found.
	 *
	 * Read by three surfaces, all of them for the same reason - a delete must not be
	 * undone by an answer that predates it: the catalogue page filters its rows
	 * through it, the search joins (the sidebar's and the palette's) drop the hits
	 * that name a forgotten id (a cached answer can outlive the delete by its 30 s
	 * `staleTime`), and the pane reads it to land on the existing missing-session
	 * notice instead of a writable draft bound to an id that is gone.
	 *
	 * SETTLED BY A RESURRECTION AND NOTHING ELSE: a page that outranks the record and
	 * carries the id back (agent review round 2, R2-1).
	 */
	forgotten: Record<string, ForgottenFact>;
	/**
	 * The last archive press the backend did not accept, or null.
	 *
	 * Rendered in the panel's own register - at the panel's root, in the notices cluster
	 * above its regions - rather than in a toast
	 * (the pin's own refusal went the same way): the sentence belongs where the
	 * control is, and the control is on the row the user just pressed.
	 */
	archiveFailure: ArchiveFailure | null;
	/**
	 * The undo offer a successful archive stands, or null.
	 *
	 * IN THE STORE, AND RENDERED IN THE PANEL, rather than in a toast, and the
	 * reason is measurable rather than aesthetic (design round 2, D12). The offer is
	 * a box with the word Undo in it, and the toast lane puts it over the composer:
	 * measured in both palettes, the toast occupied x 1001..1360.5, y 789..842.5
	 * while the Send control sits at x 1307..1339, y 803..835 - the offer's own
	 * Undo box lands exactly where Send was, for the offer's whole life (up to
	 * 15 s). Two constraints cannot both be met by a toast: an offer must NEVER
	 * overlap the composer's interactive controls, and it must sit on the surface
	 * that performed the action - and the archive is performed from the sidebar
	 * (a row's control, the header's menu, a typed command), never from the
	 * composer. A sidebar register satisfies both by construction: it is inside the
	 * panel, so it cannot reach the composer, and it is drawn above both regions - the
	 * one place every assembly mode renders.
	 *
	 * The RETIREMENT RULE is unchanged and lives with the offer
	 * (`features/chat/archive-undo.ts`): the offer stands while the conversation
	 * still holds the state the offer was taken from, and it is retired the moment
	 * this client knows it does not.
	 */
	archiveUndo: ArchiveUndoOffer | null;
	/**
	 * Record - or clear - the undo offer a successful archive stands.
	 *
	 * The offer's own module owns WHEN it is retired; this is only the write.
	 */
	setArchiveUndo: (offer: ArchiveUndoOffer | null) => void;
	/**
	 * Clear the refusal once its message's turn in the panel's lane is over.
	 *
	 * THE WRITE ONLY, matching `setArchiveUndo` above rather than adding a third policy: the
	 * panel owns the drawing decision (which message is the newest word, and so when an older
	 * one has been superseded), and U10 is what happens when the VALUE outlives its message -
	 * the refusal was re-printed every time a newer message retired, because the clock cleared
	 * the drawing and not the value. Nothing else reads this field: what reverts the row is the
	 * fact `setSessionArchived` already recorded, and what announces it is the control's own
	 * flip, so clearing the sentence takes no affordance with it.
	 */
	clearArchiveFailure: () => void;
	/**
	 * The conversation a danger dialog is asking about, or null.
	 *
	 * In the STORE rather than in the component that draws the dialog, because two
	 * surfaces ask the same question and must reach ONE dialog: the header's session
	 * menu, and a typed `/delete` (which is dispatched from the composer, a
	 * different subtree). A second dialog would be a second confirmation flow to
	 * keep in step with the first.
	 */
	deleteCandidate: string | null;
	/**
	 * Archive or unarchive one conversation: the optimistic write, its currency
	 * stamp, and the revert-and-report path when the backend refuses.
	 *
	 * `title` is only what a failure SENTENCE needs to name the row the user
	 * pressed, since a conversation this client does not list has no row to read a
	 * title off.
	 */
	setSessionArchived: (
		sessionId: string,
		archived: boolean,
		title?: string,
	) => Promise<boolean>;
	/**
	 * Delete ONE conversation, permanently. Never optimistic: the row is dropped
	 * only after the backend confirms, and the drop is recorded as a TOMBSTONE
	 * (`forgotten`) rather than as a plain removal from the array, because an answer
	 * whose request started before the delete would otherwise restore the row.
	 */
	deleteSession: (
		sessionId: string,
	) => Promise<{ ok: true } | { ok: false; detail: string; guarded: boolean }>;
	requestSessionDelete: (sessionId: string | null) => void;
	fetchSessions: (limit?: number) => Promise<void>;
	createSession: (
		cwd: string,
		target?: ChatTarget,
		requestId?: string,
		/** The draft's own model pick, when it has one; omitted otherwise. */
		model?: DesktopModelSelection | null,
	) => Promise<string | null>;
	setActiveSession: (sessionId: string | null) => void;
	/**
	 * Close the validation window because the session's own stream proved it
	 * exists (its `snapshot` landed).
	 *
	 * The window's only positive bound now - see `validatingSessionId`. Guarded
	 * on the id, so a snapshot belonging to an abandoned target cannot vouch for
	 * the session the user is actually on.
	 */
	confirmSessionLive: (sessionId: string | null) => void;
	/**
	 * The validation window's NEGATIVE bound: the session's own stream answered
	 * 404, so the conversation is gone. Tombstones it (`forgetSession`) and closes
	 * the window, leaving the view on the target so the missing-session notice
	 * explains it - the arm `openSession`'s guard read used to take on its own
	 * not-found. Guarded on the window's id for the same reason as
	 * `confirmSessionLive`: only a switch still waiting on its proof may be told
	 * the answer, so a 404 on some later reconnect is left to the stream's own
	 * `missing` state rather than rewriting the catalogue.
	 */
	confirmSessionMissing: (sessionId: string | null) => void;
	/**
	 * The operator's own gesture: "I am looking at this conversation now".
	 *
	 * WHY IT IS A GESTURE AND NOT A TIMER. Nothing about a mount, a focus change
	 * or the passage of time says a person is reading a result, and the receipt
	 * `useCompletionView` sends is a claim that they are - so the only thing that
	 * can re-arm a receipt the retry ladder had pushed out is an act with the
	 * operator behind it. Every call to `openSession` stamps it, which is exactly
	 * the act the reported defect is about: "click into it = mark it read".
	 *
	 * WHICH OPENS STAMP IT, named rather than implied (agent review round 1, N2;
	 * UX review round 1, N1). A press is the common case and not the only one: the
	 * sidebar's row selection, the palette's selection and a scheduled row's "open
	 * in chat" all reach `openSession`, and so does the route-to-store reconcile
	 * behind a deep link, a Back, or any external `/chat/<id>` write
	 * (`chat-page.tsx`'s route effect, `open-conversation.ts`,
	 * `schedules-page.tsx`). Saying so here rather than leaving the narrower claim
	 * in place is the honest form of the rule, because what makes all of them
	 * admissible is what the stamp CANNOT do: it releases a deferral and resets a
	 * budget, and it touches no attempt gate - readiness, selection, focus and the
	 * rendered-anchor hit test are all still asked at attempt time. It cannot
	 * receipt a result nobody was shown, and every one of those paths IS this app
	 * showing the operator that conversation.
	 *
	 * ONE RECORD, not a log, for the reason `pinFailure` is one: there is one row
	 * under the pointer, and a second press replaces the first rather than
	 * queueing behind it. The `revision` is what makes two presses of the SAME row
	 * two events rather than one truthy value.
	 *
	 * Deliberately NOT persisted (`partialize` names its keys): a press that
	 * happened before a reload was honoured by the process that saw it, and a
	 * restored stamp would be a gesture this window never witnessed.
	 */
	readAckRearm: ReadAckRearm | null;
	/**
	 * Stamp one press of a conversation for the read receipt's re-arm.
	 *
	 * Called by `openSession` on EVERY open, including the open of the row the view
	 * is already on (the field above names the callers, since a press is not the
	 * only one). That re-open is a no-op for the switch itself (see the action's own
	 * comment) and the one shape the reported defect turns on: the operator's remedy
	 * for a mark that did not clear is to click the row again, and an acknowledgement
	 * whose retry had been pushed out by the shared ladder is what that click has to
	 * release.
	 */
	rearmReadAck: (sessionId: string) => void;
	/**
	 * What the read receipt is doing for one conversation, or nothing.
	 *
	 * Written by `useCompletionView` while it has a loop for that conversation, and
	 * read by the sidebar's rows - the surface the mark is on. See `ReadAckNotice`
	 * for the states, the lifetime rule and why there is exactly one record.
	 */
	readAckNotice: ReadAckNotice | null;
	/**
	 * Publish the receipt's own state for one conversation.
	 *
	 * IDENTITY-PRESERVING on an unchanged `(sessionId, kind)` pair, because the
	 * caller is a 500 ms poll: a notice that is published on every tick would
	 * re-render every row of the panel twice a second, and an operator who has left
	 * the receipt deferred wants exactly nothing to happen. A CHANGED pair (a new
	 * kind, or another conversation) advances `revision`, which is what a reader
	 * compares to tell a new statement from the same one seen again - the role
	 * `rearmReadAck`'s own revision plays for the press.
	 */
	publishReadAckNotice: (
		sessionId: string,
		kind: ReadAckNoticeKind,
		reason?: unknown,
	) => void;
	/**
	 * Withdraw the receipt's state for one conversation, if it is that one's.
	 *
	 * Guarded on the id rather than clearing unconditionally, because the writer is
	 * a loop that outlives renders and can be torn down after the view has moved
	 * on: an unconditional clear would let the receipt of an abandoned conversation
	 * delete the statement of the one the operator is looking at now.
	 */
	clearReadAckNotice: (sessionId: string) => void;
	/**
	 * Merge one machine-wide `attention` frame into its row.
	 *
	 * This is the unseen mark's ARRIVAL path. It used to be a 5 s
	 * `sessions.list` poll, which re-read a transcript-tail preview per row to
	 * learn one boolean; the feed now carries the delta as it happens, so the
	 * mark lands on the event instead of on a timer.
	 *
	 * A frame for a session the catalogue does not know is DROPPED rather than
	 * inserted: the feed's frames are live-only and the catalogue's membership is
	 * a separate question (a new session directory is what the `catalogue`
	 * invalidation exists for). Inserting here would create a row with no title,
	 * no binding and no status — a sidebar entry for something the user cannot
	 * identify.
	 */
	applyAttention: (sessionId: string, attention: CompletionAttention) => void;
	/**
	 * Merge MANY attention states in one commit, for the bulk receipt.
	 *
	 * The session id comes from each state's own `conversation_id`
	 * (`session/<id>`) rather than from a caller argument, because a bulk answer
	 * carries nothing else that names the row: the buckets are `superseded`/`unknown`
	 * ids and post-write states, and pairing them positionally with the request
	 * would make the response's order part of the contract, which it is not. A
	 * state whose conversation is not in the catalogue is DROPPED, on the same
	 * membership rule `applyAttention` above documents, and a state that merges to
	 * what the row already holds is identity-equal and re-renders nothing.
	 *
	 * One `set`, so a batch of N acknowledgements is ONE commit and one repaint:
	 * N separate `applyAttention` calls would re-render the 500-row sidebar N
	 * times for one user gesture.
	 */
	applyAttentionMany: (states: CompletionAttention[]) => void;
	/**
	 * Clear the unread marks THIS CLIENT holds, in one call.
	 *
	 * The set is enumerated from the store's own rows and is TOKEN-bound: a row
	 * is sent only when it is DRAWING an outstanding completion mark
	 * (`unreadMarkKind`) AND carries a `completion_token`, so the batch names
	 * exactly the completions this client rendered — a completion published after
	 * the render is not in it and stays unread, a mark with no token (which names
	 * no completion) is neither sent nor counted, and a row whose live state has
	 * taken it over (busy, wedged, a parked gate) is not in the batch at all:
	 * acknowledging a completion the reader was never shown would clear a mark
	 * that could then never appear, because an acknowledgement is the only thing
	 * that clears `unseen`.
	 *
	 * NOTHING IS WRITTEN LOCALLY UNTIL THE ANSWER ARRIVES. There is no optimistic
	 * clear at any point, which is what makes a failed request leave nothing to
	 * roll back, and the answer's `read` bucket is the only thing applied — a
	 * `superseded` or `unknown` row stays unread, because the backend refused it
	 * and the user's marks must not disagree with the store that owns them. The
	 * counters are returned rather than toasted here so the SURFACE decides the
	 * copy, and it can name the remainder instead of claiming everything cleared.
	 */
	markAllRead: () => Promise<{
		attempted: number;
		cleared: number;
		superseded: number;
		unknown: number;
	}>;
	/**
	 * Apply one `session_status` frame to its row, and retire a dead epoch's stamps.
	 *
	 * This is the STATUS's arrival path, the counterpart of `applyAttention`
	 * above and for the same reason: the row's status used to be delivered only by
	 * a whole-catalogue read, so an answered gate or a completed turn waited for
	 * the 30 s safety poll (or a window focus, or the chat page's own marker
	 * effect on the one row it is showing). The frame carries the backend's
	 * DERIVED pair, so nothing here derives anything — it writes the value and the
	 * stamp, and the stamp is what lets a slower list response be ordered against
	 * it rather than racing it.
	 *
	 * THIS ACTION ORDERS NOTHING, deliberately: frames arrive in publication order
	 * on one socket, which is the transport's guarantee to keep and not a fact
	 * worth re-deriving here. A frame is therefore trusted as it arrives, and the
	 * epoch gate below is not an ordering rule but a restart's bookkeeping - the
	 * only place a restart can make two counters incomparable. Adding a per-row
	 * revision comparison HERE would be a second implementation of an order the
	 * client already receives in order, and it would have to invent an answer for
	 * the gaps a socket does not promise to close.
	 *
	 * `epoch` is the emitting feed PROCESS's, and a frame carrying an epoch this
	 * store has not stamped rows with before means every row's stamp was minted by
	 * a process that is gone. Their revisions are counters from a dead run, so
	 * they are retired before the write. What that buys is stamp HYGIENE, and it is
	 * worth being precise about it, because the obvious justification is wrong: a
	 * row left holding a dead epoch's counter would NOT have pinned anything,
	 * since `heldStatusOver` requires epoch equality before it compares a single
	 * number, and a live response is stamped with the live process's epoch - so
	 * the response wins with or without this reset. What the reset prevents is a
	 * row advertising a counter that no live process will ever mint: state that
	 * reads as ordering evidence and is not, which is what a future reader would
	 * reason from. It does decide an order in one narrow case, and the decision
	 * goes the other way: a list response from the dead process that lands AFTER a
	 * frame from that same dead process is refused without the reset (correctly -
	 * it is the older of the two) and accepted with it, because the stamp it would
	 * have been compared against is gone. Taken knowingly: a dead process's answer
	 * is being superseded by a live one either way, and hygiene is the better trade
	 * against the alternative of leaving dead counters on screen.
	 *
	 * A frame for a session the catalogue does not know is DROPPED, exactly as an
	 * attention frame is: insertion would make a sidebar row with no title and no
	 * binding, and membership is the catalogue's question.
	 */
	applySessionStatus: (
		sessionId: string,
		status: SessionCatalogueStatus,
		revision: number,
		epoch: string,
	) => void;
	openSession: (sessionId: string) => Promise<boolean>;
	stageDraft: (target?: ChatTarget, fresh?: boolean) => string;
	updateDraft: (key: string, patch: Partial<ChatDraft>) => void;
	/**
	 * Record — or clear — the model a NEW conversation will be born on.
	 *
	 * A dedicated action rather than a bare `updateDraft("model")` because of the
	 * receipt: the server keys its at-most-once receipt on a hash of the WHOLE
	 * create body (`desktop_receipts.py`), so re-sending the same
	 * `createRequestId` with a different `model` is a 409 forever. A changed
	 * selection is therefore a changed intent, and it gets a fresh request id —
	 * scoped to the pre-session state, since once a session exists the create is
	 * already behind us and its id must stay pinned for an idempotent replay.
	 */
	setDraftModel: (key: string, model: DesktopModelSelection | null) => void;
	finishDraft: (key: string, sessionId: string) => void;
	/**
	 * Abandon a stuck send. The retained payload is the user's own text, so the
	 * only safe owner of that decision is the user: we drop our claim that the
	 * next send must match it, and never touch the session or its transcript.
	 */
	discardDraft: (key: string) => void;
	bindSession: (legacyAgentId: string, sessionId: string) => void;
	upsertSession: (row: CanonicalSessionRow) => void;
};

function mergeRow(
	current: CanonicalSessionRow | undefined,
	incoming: CanonicalSessionRow,
): CanonicalSessionRow {
	return {
		...current,
		...incoming,
		// Settled as a WHOLE, and before the guard: a spread cannot tell a stamp
		// from half of one, and `heldStatusOver` overrides this when the row's own
		// pair is the one that outranks the incoming row.
		...statusStamp(current, incoming),
		...heldStatusOver(incoming, current),
		attention: mergeCompletionAttention(
			current?.attention,
			incoming.attention,
			incoming.session_id,
		),
	};
}

/**
 * The kind of completion mark a row is DRAWING, or null when it draws none.
 *
 * THE ONE DECISION behind every "unread" word and number on the sidebar: the
 * glyph and its ink, the accessible name's `, unread`, the row's tooltip, and
 * the bulk control's count all ask this function. Two derivations of one fact
 * is precisely how the reported defect happened — the count read
 * `attention.unseen` alone while the glyph read a code as well, so a session
 * that finished a turn and then started another was counted under a control
 * whose row was drawing a spinner, and clicking it acknowledged a completion
 * nobody was ever shown (an acknowledgement is the only thing that clears
 * `unseen`, so that mark could never appear afterwards).
 *
 * IT READS `status.code`, and that is the point rather than a detail. The
 * runtime's `CatalogEntry.shows_completion_mark` (`local_operator/session/
 * catalog.py`) is the single arbiter of "does an unread completion win the
 * glyph, or does live state", and `status_code` is its stable transport
 * spelling: a parked gate publishes `approval`/`answer`, `wedged` and `busy`
 * publish themselves, and the unseen completion publishes `complete` / `error`
 * / `interrupted` only where the mark wins. A row's `status.code` therefore IS
 * that precedence, already decided by the side that owns it — re-deciding it
 * here from `live_state`/`pending`/`unseen` would be a SECOND derivation of one
 * fact, which is the drift this function exists to remove.
 *
 * `unseen` is still read, and it is not redundant: it is a LEVEL, not an edge —
 * true from the moment a turn completes until somebody READS that session,
 * because resuming does not acknowledge it — so the code alone cannot say
 * whether the mark still stands. On its own it is not enough either: that is
 * the defect.
 *
 * `error` and `interrupted` draw marks. They are the "error X indicators" a
 * reader counts, the runtime ranks them as outstanding completions
 * (`session/creation.py::session_category`), and it labels them "Unseen error"
 * / "Unseen interruption" — so they belong on the counted side even though the
 * glyph they carry is their own code's. A code this build does not know draws
 * no mark, and neither does an ABSENT status (a locally created row carries
 * none until the next catalogue read): unknown is not unread.
 */
export type UnreadMarkKind = "complete" | "error" | "interrupted";

export const unreadMarkKind = (
	row: CanonicalSessionRow,
): UnreadMarkKind | null => {
	if (row.attention?.unseen !== true) return null;
	const code = row.status?.code;
	return code === "complete" || code === "error" || code === "interrupted"
		? code
		: null;
};

/**
 * The rows a bulk acknowledgement can NAME, in the store's own terms.
 *
 * The single home of this predicate, and it lives here rather than in the
 * feature module that consumes it because the STORE'S action is the other half
 * of the fact: DESIGN §3.3 pins that "the count the control shows and the set
 * `markAllRead` sends are the same fact", and two hand-written literals are how
 * one fact becomes two — silently, and in the direction that costs the user,
 * because the number on screen would stop being the set the request carries.
 * `features/chat/mark-all-read.ts` re-exports it for the surface.
 *
 * A DRAWN MARK AND a `completion_token`, the mark half being `unreadMarkKind`:
 * the control's number is then exactly the rows a reader can see a mark on,
 * which is the property the report that produced this fix asked for — "the
 * mark as read function always reflects indicators that people are actually
 * seeing in the UI". Counting `unseen` alone reached rows whose live state had
 * taken the row over, and a mark with no token names no completion at all, so
 * the backend has nothing to match it against and would answer `unknown` for
 * it: sending that would only inflate the batch, and counting it would put a
 * number in the label that no click can honour.
 */
export const unreadAckableRows = (
	rows: CanonicalSessionRow[],
): CanonicalSessionRow[] =>
	rows.filter((row) => {
		if (unreadMarkKind(row) === null) return false;
		const token = row.attention?.completion_token;
		return typeof token === "string" && token.length > 0;
	});

/** How many rows a click would name; zero hides the control entirely. */
export const unreadAckableCount = (rows: CanonicalSessionRow[]): number =>
	unreadAckableRows(rows).length;

/**
 * Merge one attention state into the row it names, in one commit.
 *
 * Shared by the single-frame path (`applyAttention`) and the bulk receipt
 * (`applyAttentionMany`) so the three rules that decide whether a write happens
 * at all cannot drift between them: a state for a session the catalogue does not
 * hold is DROPPED rather than inserted (insertion would make a sidebar row with
 * no title and no binding, and membership is the catalogue's question — the rule
 * `applySessionStatus` states at length), the merge goes through the same
 * revision guard, and an UNCHANGED merge returns the SAME array so a beat that
 * carried nothing new re-renders nothing.
 *
 * Returning the array rather than a whole state keeps the caller's `set`
 * responsible for the state object, which is what lets the bulk path fold N rows
 * into ONE repaint instead of N.
 */
const mergeAttentionInto = (
	sessions: CanonicalSessionRow[],
	sessionId: string,
	attention: CompletionAttention,
): CanonicalSessionRow[] => {
	const index = sessions.findIndex((row) => row.session_id === sessionId);
	if (index < 0) return sessions;
	const row = sessions[index];
	const merged = mergeCompletionAttention(row.attention, attention, sessionId);
	if (merged === row.attention) return sessions;
	const next = sessions.slice();
	next[index] = { ...row, attention: merged };
	return next;
};

/**
 * The receipt's re-arm stamp, advanced by one press of a conversation.
 *
 * A COUNTER rather than a timestamp, for the same reason `answerSeq` is one: the
 * reader asks "is this a press I have NOT already honoured?", and `Date.now()`
 * answers only when two presses land in different milliseconds - which two
 * clicks of the same row, or a click and the route effect behind it, do not
 * promise. A revision that only ever moves forward answers it exactly.
 */
const rearmedReadAck = (
	current: ReadAckRearm | null,
	sessionId: string,
): ReadAckRearm => ({
	sessionId,
	revision: (current?.revision ?? 0) + 1,
});

/**
 * The stamp the merged row carries, as a PAIR or not at all.
 *
 * `status_epoch` names the process and `status_revision` is that process's counter
 * for this session, so half a stamp is not weaker evidence - it is unusable, and
 * the plain spread above would MINT it: `{...current, ...incoming}` on an
 * incoming row carrying an epoch and no revision leaves the current row's
 * revision sitting under the incoming epoch, so the row advertises
 * `(new epoch, old revision)` - an epoch that never counted that high - and the
 * guard then refuses that many of the new epoch's own list updates. That is the
 * mirror of the flap the guard exists to stop, arriving through the one path the
 * guard cannot see: it compares stamps it can read, and a minted one reads as
 * perfectly good evidence.
 *
 * Latent rather than live in the wire contract's own terms - the backend stamps
 * both keys or neither, and `SessionCatalogueRow` says they are omitted together -
 * which is exactly why it is worth holding up on this side. A complete incoming
 * stamp wins (the row it came from was read later), and a partial one contributes
 * nothing, which leaves the current row's complete pair in place under the rule
 * this merge already has for every other field: an absent key is not a claim.
 */
function statusStamp(
	current: CanonicalSessionRow | undefined,
	incoming: CanonicalSessionRow,
): Partial<CanonicalSessionRow> {
	const pair = (
		row: CanonicalSessionRow | undefined,
	): Partial<CanonicalSessionRow> | undefined =>
		typeof row?.status_revision === "number" &&
		typeof row?.status_epoch === "string"
			? { status_revision: row.status_revision, status_epoch: row.status_epoch }
			: undefined;
	return pair(incoming) ?? pair(current) ?? {};
}

/**
 * The three fields a guarded row keeps, or nothing when the incoming row wins.
 *
 * THE GUARD EXISTS BECAUSE TWO WRITERS NOW PRODUCE ONE VALUE, and one of them
 * is slow by construction: `sessions.list` is a whole-catalogue read (measured
 * at ~120 ms median for 200 rows, and the sidebar asks for 500) while a
 * `session_status` frame is a few hundred bytes. A list response computes its
 * rows BEFORE it is serialised, so the normal path is: the frame for a gate
 * answer lands first, and the list that was already in flight - deliberately
 * fired by the chat page's own marker effect on the very transition being sped
 * up - arrives afterwards carrying the PRE-answer status. Without this the
 * sidebar would show the corrected row and then flick back for one poll cycle,
 * which reads as the status being unreliable rather than late.
 *
 * The comparison only holds a value when the two stamps are COMPARABLE: the
 * same epoch (one live process's counters) and a strictly greater revision on
 * the row than on the incoming list. Everything else falls through to the
 * incoming row, and each of those cases is a real one:
 *
 * - `status_revision`/`status_epoch` absent on the incoming row: an older
 *   backend, or one that has published nothing for this session. There is
 *   nothing to order against, so the list is the only writer and wins.
 * - the epochs differ: the response was produced by the process now serving us
 *   (its epoch is the feed's, and a restart is what changes it), so its stamp
 *   block is the live one even where its revision reads lower.
 * - the incoming revision is >= the row's: the list is at least as fresh.
 * - the row holds a stamp but no status: a stamp with nothing under it cannot be
 *   the reason the list's status is refused.
 */
function heldStatusOver(
	incoming: CanonicalSessionRow,
	current: CanonicalSessionRow | undefined,
): Partial<CanonicalSessionRow> {
	const sameEpoch =
		typeof current?.status_epoch === "string" &&
		current.status_epoch === incoming.status_epoch;
	const held = current?.status_revision;
	const arrived = incoming.status_revision;
	const fresherFrame =
		current?.status !== undefined &&
		sameEpoch &&
		typeof held === "number" &&
		typeof arrived === "number" &&
		held > arrived;
	if (!fresherFrame) return {};
	return {
		status: current?.status,
		status_revision: current?.status_revision,
		status_epoch: current?.status_epoch,
	};
}
/**
 * The stamped records a read newer than `floor` still owns.
 *
 * Used for the ARCHIVE facts (`archiveFacts`), where it is the whole rule: this app
 * asks the list route for the archived rows too (`include_archived: true`), so a
 * page speaks about the archived set as a whole and a fact older than its request
 * is settled by it - absence from that page means "unarchived or gone" rather than
 * "not mentioned".
 *
 * It is deliberately NOT the rule for the delete tombstones any more, and the
 * reason is the same one `archiveFacts` does not have: the archive is a value the
 * page always speaks about, while a tombstone is an id the page can only speak
 * about by CARRYING it. A page that outranks a tombstone and does not carry the id
 * is exactly what the tombstone predicts, so it settles nothing (agent review round
 * 2, R2-1 - settling it there let a cached search answer put the deleted
 * conversation back). The tombstones are settled at the call site, by a
 * resurrection: a page that outranks the record AND carries the id.
 *
 * Returns the SAME object when nothing is dropped, so a page that settles nothing
 * does not re-render every row it carried.
 */
function factsNewerThan<T extends { at: number }>(
	facts: Record<string, T>,
	floor: number,
): Record<string, T> {
	const kept: Record<string, T> = {};
	let dropped = false;
	for (const [id, fact] of Object.entries(facts)) {
		if (fact.at < floor) {
			dropped = true;
			continue;
		}
		kept[id] = fact;
	}
	return dropped ? kept : facts;
}

/**
 * The state a delete leaves behind: the row is gone, anything this client
 * remembered about it is gone, and a TOMBSTONE is left in its place.
 *
 * The archive fact goes with the row because both describe a conversation the
 * backend no longer holds - a surviving fact would resurrect the row's state on
 * the next answer that mentioned the id (a search hit, say), which is the one
 * thing the frozen contract says a delete must not do.
 *
 * The tombstone is what makes the delete STICK against the reads in flight
 * (`ForgottenFact`): absence from the array is not a claim, because the next page
 * replaces membership wholesale.
 *
 * `activeSessionId` IS DELIBERATELY LEFT ALONE. Deleting the conversation you
 * have open must land the pane on its EXISTING missing-session state rather than
 * on a blank one, and that state is reached by the pane asking about an id the
 * daemon no longer has - which is why the tombstone is also what the pane reads
 * to know the answer before the wire gives it (`chat-content.tsx`). Clearing the
 * selection here instead would replace it with a pane that explains nothing,
 * which is the second missing-session state this change is told not to invent.
 */
function forgetSession<T extends SessionForgetState>(
	state: T,
	sessionId: string,
): Partial<T> {
	const facts = { ...state.archiveFacts };
	delete facts[sessionId];
	/*
	 * Stamped like a press, AND ADVANCING THE COUNTER, which is one decision rather
	 * than two: a write takes the sequence the next request will take, so a page
	 * asked for afterwards carries a greater value and OUTRANKS the tombstone, while
	 * a page asked for before it cannot. Outranking is not settling: under the rule
	 * this record's own docstring states (design round 2, R2-1) a page settles a
	 * tombstone only by CARRYING the id back, so what the advance buys is the
	 * RESURRECTION arm - a page that really does bring the conversation back is
	 * newer than the delete only if the delete advanced past it.
	 *
	 * THIS PARAGRAPH USED TO SAY the advance existed so the tombstone would not
	 * "outlive the very answer that proves the conversation is gone", citing three
	 * suite failures. That was the pre-R2-1 rule, and it is the opposite of what
	 * this code now wants: a tombstone that outlives a page which does not carry the
	 * id is exactly the protection a cached search answer needs (agent review round
	 * 3, R3-1). Stamping without advancing still leaves the next read at the same
	 * value (`fact.at < floor` is false), which is why the advance stays.
	 */
	const at = state.answerSeq + 1;
	return {
		sessions: state.sessions.filter((row) => row.session_id !== sessionId),
		archiveFacts: facts,
		answerSeq: at,
		forgotten: {
			...state.forgotten,
			[sessionId]: {
				at,
				title:
					state.sessions.find((row) => row.session_id === sessionId)?.title ??
					undefined,
			},
		},
		deleteCandidate:
			state.deleteCandidate === sessionId ? null : state.deleteCandidate,
	} as Partial<T>;
}

type SessionForgetState = {
	sessions: CanonicalSessionRow[];
	archiveFacts: Record<string, ArchiveFact>;
	forgotten: Record<string, ForgottenFact>;
	/** The stamp counter the tombstone's `at` is taken from (see `answerSeq`). */
	answerSeq: number;
	deleteCandidate: string | null;
};

/** Full list responses replace membership; a disappeared row is not immortal.
 * Stream updates use upsert separately and never imply a complete inventory. */
export function replaceSessionRows(
	current: CanonicalSessionRow[],
	incoming: CanonicalSessionRow[],
): CanonicalSessionRow[] {
	const byId = new Map(current.map((row) => [row.session_id, row]));
	return [
		...new Map(
			incoming.map((row) => [
				row.session_id,
				mergeRow(byId.get(row.session_id), row),
			]),
		).values(),
	];
}
let refreshGeneration = 0;
/*
 * Mount, transition, poll and focus triggers can overlap while every caller reads
 * the same catalogue. Serialize those reads to preserve the store's global
 * generation ordering. Calls in flight invalidate that answer and collapse into
 * one trailing read using the most recently requested page limit.
 */
let sessionRefresh: {
	limit: number;
	invalidated: boolean;
	promise: Promise<unknown>;
} | null = null;

function coalesceSessionCatalogueRequest<T>(
	limit: number,
	request: (limit: number) => Promise<T>,
): Promise<T> {
	const active = sessionRefresh;
	if (active) {
		active.invalidated = true;
		active.limit = limit;
		return active.promise as Promise<T>;
	}

	const flight = {
		limit,
		invalidated: false,
		promise: null as unknown as Promise<T>,
	};
	sessionRefresh = flight;
	flight.promise = (async () => {
		try {
			while (true) {
				flight.invalidated = false;
				let answer: T;
				try {
					answer = await request(flight.limit);
				} catch (error) {
					if (flight.invalidated) continue;
					throw error;
				}
				if (flight.invalidated) continue;
				// Clear synchronously with the final validity check so an invalidation
				// cannot land after the loop decides to stop and go unserved.
				if (sessionRefresh === flight) sessionRefresh = null;
				return answer;
			}
		} finally {
			if (sessionRefresh === flight) sessionRefresh = null;
		}
	})();
	return flight.promise;
}

/**
 * What main asked THIS window to open, resolved through the shared reader.
 *
 * Read from the preload's `desktop.initialSession`/`initialCatalogue`, which come
 * from THIS process's own argv (`webPreferences.additionalArguments`, set only
 * when main created the window for a notification click). It is a VALUE rather
 * than an event on purpose (B3): a recreated window rehydrates its persisted
 * `activeSessionId` and paints that conversation in the first frame, so an id
 * that arrives as a post-load IPC shows the user the wrong conversation and
 * then swaps it — which reads as a click that landed on the wrong row.
 *
 * IT RESOLVES THREE INTENTS, NOT TWO (review round 2, R2-1). "Restore", "open
 * this conversation" and "open the catalogue" are genuinely different answers,
 * and the third used to be indistinguishable from the first: both arrived as
 * `initialSession: null`, so a window created for a burst digest restored
 * whatever was last read.
 *
 * Guarded because this module is imported in contexts with no `window` (the node
 * test harness), where the answer is simply "no launch argument".
 */
function launchTarget(): LaunchTarget {
	try {
		const desktop = window.api?.desktop;
		if (!desktop) return { kind: "restore" };
		// A named conversation outranks the catalogue, the same precedence the
		// argv reader applies: naming one is the more specific instruction.
		if (desktop.initialSession) {
			return { kind: "session", sessionId: desktop.initialSession };
		}
		if (desktop.initialCatalogue) return { kind: "catalogue" };
		return { kind: "restore" };
	} catch {
		return { kind: "restore" };
	}
}

/** The launched conversation's id, or null — which includes the catalogue. */
function launchSession(): string | null {
	const target = launchTarget();
	return target.kind === "session" ? target.sessionId : null;
}
/**
 * The launch argument OUTRANKS the persisted conversation.
 *
 * Main was asked for this conversation BY NAME, and the window exists to show
 * it; the persisted id is merely what the user last read, which on a
 * click-created window is exactly the wrong one. Overriding here rather than in
 * an effect is what makes it true of the FIRST render — a layout effect would
 * already have committed the wrong conversation to the DOM, and any effect
 * after paint is the flash this exists to prevent (B3).
 *
 * THE CATALOGUE OUTRANKS IT TOO (review round 2, R2-1). `activeSessionId: null`
 * is how this store models "no conversation selected", i.e. the list — so a
 * window main created for a burst digest must land there rather than on the
 * persisted conversation. Missing this branch is what made a windowless digest
 * click restore the last conversation instead of opening the catalogue.
 *
 * Named and exported rather than inlined in the store's `persist` options
 * because it is the rule B3 rests on: hydration is what would otherwise put the
 * persisted id back, and no test can reach that path without a browser's
 * storage. Called by `persist` exactly as before.
 */
export function mergePersistedSession(
	persisted: unknown,
	current: CanonicalSessionsState,
): CanonicalSessionsState {
	const merged = {
		...current,
		...(persisted as Partial<CanonicalSessionsState> | undefined),
	};
	const target = launchTarget();
	if (target.kind === "session") {
		return { ...merged, activeSessionId: target.sessionId };
	}
	if (target.kind === "catalogue") {
		return { ...merged, activeSessionId: null };
	}
	return merged;
}

export const useCanonicalSessionsStore = create<CanonicalSessionsState>()(
	persist(
		(set, get) => ({
			sessions: [],
			// Seeded from the launch argument when there is one, so the very first
			// render is already the requested conversation rather than the persisted
			// one. `merge` below holds the same line against hydration, which would
			// otherwise put the persisted id back.
			activeSessionId: launchSession(),
			activeDraftKey: null,
			drafts: {},
			sessionByAgent: {},
			validatingSessionId: null,
			pinFailure: null,
			pinFacts: {},
			answerSeq: 0,
			// Null rather than a stamp at zero: no press has been made in this window,
			// and the receipt's re-arm reads "no press" as exactly that.
			readAckRearm: null,
			// Null rather than a kind at zero, for the same reason: no loop has said
			// anything about a receipt in this window, and the rows read absence as
			// "nothing to say" rather than as a state they should draw.
			readAckNotice: null,
			loading: false,
			truncated: false,
			statusUnavailable: [],
			archiveFacts: {},
			forgotten: {},
			archiveFailure: null,
			archiveUndo: null,
			deleteCandidate: null,
			error: null,
			cwd: "~",
			setCwd: (cwd) => set({ cwd }),
			fetchSessions: async (limit = 500) => {
				const generation = ++refreshGeneration;
				/*
				 * The page is an answer too, so it carries the same currency for BOTH
				 * writers: taken when the REQUEST starts, so a page already in flight
				 * across a press cannot supersede that press - the pin's (`PinFact`) or
				 * the archive's (`archiveFacts`).
				 */
				const answerAt = get().answerSeq + 1;
				set({ answerSeq: answerAt });
				set({ loading: true, error: null });
				try {
					const result = await coalesceSessionCatalogueRequest(
						limit,
						(pageLimit) =>
							desktopResult<{
								sessions: BackendSessionRow[];
								truncated?: boolean;
								/**
								 * The reads the daemon could not answer, additive and optional. A
								 * daemon that sends nothing here is one that answered all of them.
								 */
								degraded?: string[];
							}>({
								op: "sessions.list",
								limit: pageLimit,
								/*
								 * THE ARCHIVED ROWS ARE ASKED FOR AND THEN HIDDEN HERE, rather than left
								 * out by the route. The default `false` is a promise to clients that
								 * predate archiving - they must keep the list they had, and this app
								 * asks for them, so it must be the one to decide what is drawn:
								 *
								 *   - `visibleRows` partitions them out of EVERY default list, so the
								 *     surface is the one the brief asks for (Active, Previous and the
								 *     flat list all exclude them);
								 *   - the open conversation's own state is known after a reload even
								 *     when the conversation was archived elsewhere (from the terminal, or
								 *     from another window) - without this, a restored archived session
								 *     would look ordinary and offer no unarchive at all, which is
								 *     precisely the "archived with no way back" trap the design record
								 *     names in Claude desktop's behaviour;
								 *   - and a row found by the "Include archived" search can be restored
								 *     from its own control even when the hit's own page never carried it.
								 *
								 * The cost this carries, stated rather than discovered: archived rows
								 * compete for the page's 500-row cap like any other row, so a store with
								 * more than 500 conversations where most are archived can push live rows
								 * off the page. The route cannot answer both questions at once today,
								 * and the alternative - hiding the archived set from this client
								 * entirely - fails the two bullets above.
								 */
								include_archived: true,
							}),
					);
					if (generation !== refreshGeneration) return;
					const rows = result.sessions.map(({ id, name, mtime, ...rest }) => ({
						...rest,
						session_id: id,
						title: name,
						updated_at: mtime,
					}));
					set((state) => {
						/*
						 * A page newer than the write settles the WHOLE pinned set, not only
						 * the rows it happens to carry.
						 *
						 * It used to keep the facts for conversations the page could not
						 * carry, because on a paged client that was the only way a pin made
						 * here stayed visible for a conversation past the page. The list
						 * route now APPENDS every pinned conversation below the newest
						 * `limit` rows, so the page speaks for the pinned set as a whole -
						 * and under that contract silence means the opposite: a conversation
						 * is absent from a newer page because it is unpinned or gone.
						 *
						 * Constraint this carries: it assumes a daemon that appends off-page
						 * pinned rows. A daemon without that increment would hide an off-page
						 * pin until it was unpinned - which is why the two halves ship as one
						 * stack and why the capability stays `session_pins: 1` on both.
						 */
						const facts = { ...state.pinFacts };
						for (const [id, fact] of Object.entries(facts)) {
							if (fact.at >= answerAt) continue;
							delete facts[id];
						}
						/*
						 * AND THE TOMBSTONES ARE SETTLED BY A RESURRECTION, NEVER BY A PAGE THAT
						 * MERELY FAILS TO CARRY THE ID (agent review round 2, R2-1).
						 *
						 * A page asked for after a delete answers complete membership, so it used
						 * to settle every tombstone it did not carry. That is the same "absence is
						 * not a claim" mistake this file keeps having to undo, one door over: the
						 * page settling the tombstone says nothing about the SEARCH ANSWERS that
						 * are still live, and one of them can be asked BEFORE the delete and
						 * answered after it (`session-search.ts` caches per query for 30 s, and the
						 * store takes no more than four page triggers). With the tombstone gone
						 * the join drew a permanently deleted conversation again - deterministically,
						 * with no race: search the row, delete it, let any page land, and the cached
						 * answer still names the id.
						 *
						 * So the tombstone goes only when the read that outranks it carries the id
						 * BACK. That is a resurrection - something recreated the conversation, so
						 * this window's record of its absence is stale and false - and it is the
						 * one read that really does speak about the id. A page that outranks the
						 * tombstone and does NOT carry the id changes nothing, because it is
						 * already what the tombstone says; keeping it is what holds the join and
						 * the pane steady against every answer already in flight.
						 *
						 * The rows are filtered through the SETTLED record, which is the arm that
						 * stops a page asked for BEFORE the delete (it carries the id, it just
						 * carries a stale membership) re-adding the row.
						 */
						const carried = new Set(rows.map((row) => row.session_id));
						let revived = false;
						const forgotten: Record<string, ForgottenFact> = {
							...state.forgotten,
						};
						for (const [id, fact] of Object.entries(forgotten)) {
							if (fact.at < answerAt && carried.has(id)) {
								delete forgotten[id];
								revived = true;
							}
						}
						const tombstones = revived ? forgotten : state.forgotten;
						const page = rows.filter(
							(row) => tombstones[row.session_id] === undefined,
						);
						/*
						 * AND THE ROWS, not only the facts (review round 4, M1; QA Qr4-1).
						 * `replaceSessionRows` rebuilds membership and values from the page
						 * alone, so a page whose request STARTED before a press would hand the
						 * panel the pre-press value - the row visibly regresses under a control
						 * the reader just used - and would DROP a row the press inserted for a
						 * conversation the page cannot carry. A write newer than the page's own
						 * request outranks it, exactly as it outranks the page's facts above:
						 * the row keeps the value the write put there, and it keeps its place
						 * until a page requested AFTER the write arrives to settle it.
						 */
						const protectedRows = state.sessions.filter(
							(row) =>
								tombstones[row.session_id] === undefined &&
								(state.pinFacts[row.session_id]?.at ?? -1) >= answerAt,
						);
						let next = replaceSessionRows(state.sessions, page);
						for (const held of protectedRows) {
							const fact = state.pinFacts[held.session_id];
							const at = next.findIndex(
								(row) => row.session_id === held.session_id,
							);
							if (at === -1) next = [...next, { ...held, pinned: fact.pinned }];
							else next[at] = { ...next[at], pinned: fact.pinned };
						}
						/*
						 * AND THE ARCHIVE'S OWN SETTLING, on the same page and the same stamp,
						 * but a DIFFERENT rule about silence: this app asks the list route for
						 * the archived rows (`include_archived: true`), so the page speaks about
						 * the archived set as a whole and absence means "unarchived or gone"
						 * rather than "not mentioned" (`factsNewerThan`).
						 *
						 * THE PAGE NO LONGER WRITES THE FACT'S VALUE ONTO THE ROWS (design round 8,
						 * D27). It used to, to stop a page asked for before a press regressing the
						 * row the reader just archived - and with the two row-facing readers taking
						 * the ANSWERED view (`chat-archived.ts`'s `answeredArchiveRows` for membership,
						 * the sidebar's `archiveFactValues` for the row's drawn value), that
						 * protection is structural: a surviving fact outranks the page in both readers
						 * whatever the rows carry. What stays here is the CURRENCY, which is what
						 * settles a fact older than the request it answers.
						 */
						const archiveFactSet = factsNewerThan(state.archiveFacts, answerAt);
						return {
							sessions: next,
							pinFacts: facts,
							archiveFacts: archiveFactSet,
							forgotten: tombstones,
							loading: false,
							truncated: result.truncated === true,
							/*
							 * Read only from an answer that arrived: a failed read leaves the last
							 * known list in place (and says so through `error`), so the marker that
							 * belonged to those rows is the honest thing to keep beside them.
							 */
							statusUnavailable: Array.isArray(result.degraded)
								? result.degraded.filter((read) => typeof read === "string")
								: [],
						};
					});
				} catch (error) {
					if (generation === refreshGeneration)
						set({
							loading: false,
							/*
							 * THROUGH THE APP'S OWN SENTENCE, not the transport's. This stored
							 * `error.message` raw, so a daemon-authored refusal - the 503 whose
							 * prose the operator photographed - reached the sidebar and the pane
							 * as this app's diagnosis for the whole window a re-pair takes
							 * (measured at 18.3 s; UX round 2, U1). The send path already
							 * composed ours; this is the store's error value doing the same.
							 */
							error: storeErrorMessage(
								error,
								"Chats could not refresh. Retry to reconnect.",
							),
						});
				}
			},
			setArchiveUndo: (offer) => {
				set({ archiveUndo: offer });
			},
			clearArchiveFailure: () => {
				set({ archiveFailure: null });
			},
			setSessionArchived: async (sessionId, archived, title) => {
				/*
				 * STAMPED, AND A PRESS CHANGES THE INTENT RATHER THAN THE LIST (design round 8, D27).
				 * The fact is still written optimistically - it is what tells every reader where this
				 * conversation is GOING - but the press no longer patches `sessions`, and that patch was
				 * what removed the row. THE ROW CARRIES THE ANSWERED STATE, THE FACT CARRIES THE
				 * INTENDED ONE: the two row-facing readers take only answered facts (the list's one
				 * filter and the row's own drawn value, both through `chat-archived.ts`'s answered
				 * view), so a press may change what a conversation is about to be without changing
				 * what the list holds.
				 *
				 * WHY THAT IS THE FIX RATHER THAN A TIDIER SHAPE, at QA round 4's own numbers: the row's
				 * departure shortens the list's content by its own height while the box is still the
				 * band-0 one, so `scrollHeight - clientHeight` goes NEGATIVE, the browser clamps the
				 * reader's `scrollTop` to the new extent, and nothing gives it back when the row
				 * returns - the `8.5 -> 0` QA measured. The same dip exists on the SUCCESS path
				 * (`224.5` of content against a `248` box) whenever the departure and the band that
				 * answers it land in different commits, which is why the offer below is raised in the
				 * same update as the fact's settlement. Taking the departure out of the press takes the
				 * dip out of the state, which is arithmetic rather than a race a write could lose.
				 *
				 * THE PRESS'S ACKNOWLEDGEMENT IS WHAT THIS COSTS, stated rather than implied: the row the
				 * reader pressed stays drawn for the round trip - 2-4 ms on this app's own daemon, and
				 * the whole in-flight window on a stalled one, where the press reads as inert until the
				 * card lands. Design D28 records the register that should pay it (the row's own control,
				 * which the reader is already on); it is not invented here.
				 *
				 * THE ASSUMPTION THE STAMP RESTS ON IS OWED TO QA, and this is where it is
				 * written down rather than assumed silently. A press takes the sequence the
				 * NEXT request will take, so every reader that starts after it carries a
				 * stamp greater than the fact's and settles it (`factsNewerThan`). That is
				 * sound only if a read WHOSE REQUEST STARTED AFTER THIS PRESS observes the
				 * write - i.e. if the daemon applies `POST .../archive` before it answers a
				 * read issued afterwards. Over two connections and more than one worker that
				 * is the route's business, not this client's: if it does not hold, an answer
				 * can say `archived: false`, the fact is settled, and the row reappears
				 * until the next page. QA settles what the sibling route guarantees; the
				 * client's half (stamp, membership, refusal register) is what is exercised here.
				 */
				const at = get().answerSeq + 1;
				/*
				 * THE FACT THIS PRESS REPLACES, kept so a refusal can put it back (see the catch arm). With
				 * membership and the row's drawn value both read from the fact, the fact IS the client's
				 * knowledge - so deleting the press's own write without restoring what it stood for would
				 * leave a conversation the daemon holds archived reading as live (`row.archived` is the wire's
				 * value, and the wire's last word was the page BEFORE the accepted archive). Measured on this
				 * walk's refused-undo step: the row came back into a list that excludes archived rows.
				 */
				const previousFact = get().archiveFacts[sessionId] ?? null;
				const rowTitle =
					title ??
					get().sessions.find((row) => row.session_id === sessionId)?.title;
				set((state) => ({
					answerSeq: at,
					archiveFacts: {
						...state.archiveFacts,
						/* UNANSWERED until the write's own sentence arrives (`ArchiveFact.answered`). */
						[sessionId]: { archived, at, answered: false },
					},
				}));
				/*
				 * A PRESS DOES NOT RETIRE THE REFUSAL ABOUT ITS OWN CONVERSATION, and this is a
				 * correction rather than a detail: the version that shipped cleared it here, and
				 * the clear is what took the RETRY's own answer off the screen.
				 *
				 * The lane has ONE stable id for both of its messages (`ARCHIVE_TOAST_ID` in
				 * `chat-sidebar.tsx`), so a refusal that follows a dismissal of that id within
				 * sonner's own unmount window is merged into the entry that is being removed and
				 * destroyed with it - measured against the installed sonner 2.0.3 in jsdom
				 * (2026-09-21): created on the dismissed id, the toast is painted at +50ms and
				 * gone by +600ms, while the same create 600ms later mounts normally. A fast
				 * daemon answers the retry in 2-4ms, which is squarely inside that window, so the
				 * clearing above left "Retry" doing nothing at all: the message was dismissed and
				 * the refusal that replaced it never mounted (UX report round 1, U3).
				 *
				 * WHAT RETIRES IT INSTEAD, in this order: a refusal that lands replaces the one on
				 * screen through the SAME id (sonner updates the mounted toast in place, which is
				 * what one-message-at-a-time means here); an accepted archive supersedes it with
				 * the offer (`offerArchiveUndo` in `archive-undo.ts`); an accepted unarchive has no
				 * successor and clears it below; and any other press leaves it alone, because the
				 * sentence describes the last answer to a press on that conversation rather than a
				 * state the newer press has already settled.
				 */
				try {
					await desktopResult<{ session_id: string; archived: boolean }>({
						op: "sessions.archive",
						sessionId,
						archived,
					});
					/*
					 * AND THE WRITE IS ANSWERED: the fact is settled, which is what retires the offer
					 * that press raised (`ArchiveFact.answered`), and the refusal it was written over is
					 * cleared in the same update - the two halves cannot be separated without leaving a
					 * window in which the offer is retired and the refusal it replaced is still the
					 * store's newest word about that conversation.
					 *
					 * AND THE OFFER IS RAISED HERE TOO, IN THIS SAME UPDATE (design round 8, D27's second
					 * clause). It used to be raised a microtask later by whichever caller pressed - the
					 * row's `.then`, the header's, `/archive`'s - i.e. in a SECOND React commit, and the
					 * commit between them is the one that measures `224.5` of content against a `248` box:
					 * the departure on the success path took the extent negative, the browser clamped the
					 * reader, and the band arrived too late to give the position back. Raised with the
					 * settlement, the departure and its band are one commit, and their arithmetic runs the
					 * other way (`band - rowHeight = 58 - 32 = +26px` of headroom), so the reader's place
					 * is reachable on every accepted press. The guard is `archived === true`, which is
					 * also what keeps the unarchive path offerless: the row comes back into the list,
					 * which is its own visible trace (UX round 1, U2).
					 *
					 * AND THE REFUSAL THIS CONVERSATION'S OWN LAST PRESS LEFT IS RETIRED IN THE SAME
					 * UPDATE, for an archive as well as for an unarchive: the lane holds one message under
					 * one id, so raising the offer is what takes the refusal off the screen, and clearing it
					 * in a second update would leave a window in which the store holds neither message and
					 * the panel dismisses the lane - the create-then-destroy mechanism UX round 1, U3 is
					 * about. `archive-undo.ts` raised the offer and cleared the refusal together for exactly
					 * this reason; both are here now, and the offer's own retirement watch stays with its
					 * module (`useArchiveUndoRetirement`).
					 *
					 * Currency, like the refusal arm below: only the newest press for this conversation
					 * may settle it. An older press's acceptance is an answer about a state the newer
					 * press has already replaced.
					 */
					set((state) => {
						const fact = state.archiveFacts[sessionId];
						const superseded = fact?.at !== at;
						return {
							archiveFacts: superseded
								? state.archiveFacts
								: {
										...state.archiveFacts,
										[sessionId]: { archived, at, answered: true },
									},
							/*
							 * AN ACCEPTED ARCHIVE STANDS THE OFFER, an accepted unarchive clears it (it has no
							 * successor action) - and a SUPERSEDED settlement touches the lane not at all,
							 * because the newer press owns both the fact and the message about it.
							 */
							archiveUndo: superseded
								? state.archiveUndo
								: archived
									? {
											sessionId,
											/* `rowTitle` is the row's own title, which the wire may answer as null. */
											title: rowTitle ?? undefined,
											archived: true,
											at,
										}
									: null,
							archiveFailure:
								state.archiveFailure?.sessionId === sessionId
									? null
									: state.archiveFailure,
						};
					});
					return true;
				} catch (error) {
					set((state) => {
						/*
						 * A REFUSED PRESS IS REVERTED ONLY IF IT IS STILL THE NEWEST WRITE for
						 * this conversation. A second press made while the first was in flight
						 * owns the row now, and reverting on the older one's failure would undo
						 * the newer press - the failure of a request the user has already moved
						 * on from is not a statement about what is on screen.
						 *
						 * THE REVERT IS THE FACT, AND RESTORING IT IS THE WHOLE OF IT (design round 8, D27): the
						 * press patched neither `sessions` nor any other row state, so a refused write puts back
						 * the fact it REPLACED - or, when there was none, leaves none. Both row-facing readers
						 * then read what they read before the press, which is the same observable claim the version
						 * that patched the row made. Deleting the fact instead would be a revert to the WIRE's
						 * value, and the wire's last word about this conversation predates the accepted write the
						 * fact was standing for: measured on the walk's refused-undo step, the row came back into
						 * a list that excludes archived rows because the client forgot it had archived it.
						 *
						 * What used to be guarded, and still is, is the REPORT: this guard returned the state
						 * untouched once, which dropped the refusal with it - so a write that really was refused
						 * was answered on screen only when no catalogue answer had settled the fact first. Measured
						 * against the real store (the fixture shape `scripts/session-archive-delete.test.mjs` uses,
						 * 2026-09-21): press, then a page whose request STARTS after the press answers before the
						 * write's rejection, and `archiveFailure` stays `null` - the press silently does nothing,
						 * the one outcome the refusal exists to prevent. The panel's list read is a 5s poll and
						 * every catalogue frame, so that ordering is ordinary rather than exotic.
						 *
						 * The message is a fact about the press (the write was refused) while the fact's own
						 * restoration is a fact about the intent, and the two have different owners: the sentence
						 * belongs to the last press that was actually answered, and a superseded press owns
						 * neither.
						 */
						const superseded = state.archiveFacts[sessionId]?.at !== at;
						const facts = { ...state.archiveFacts };
						if (!superseded) {
							/*
							 * AND WHAT GOES BACK IS AN ANSWERED FACT OR NOTHING (agent review round 5, R5-2).
							 *
							 * Restoring `previousFact` verbatim put back an UNANSWERED intent whenever the press
							 * being refused had displaced one that was still in flight - and the two row-facing
							 * readers skip unanswered facts, so the restore wrote a fact that could not be read at
							 * all. Reproduced on this suite's own fixture with two presses before either answer:
							 * press 1 (archive) is displaced by press 2 (unarchive), press 1's acceptance arrives
							 * first and bails as superseded, and press 2's refusal then restored
							 * `{archived:true, at:2, answered:false}`, leaving the client with no readable
							 * knowledge of an archive the daemon had just ACCEPTED.
							 *
							 * THE RULE: a refusal puts back the fact it replaced only when that fact had been
							 * ANSWERED. An unanswered fact is a press's INTENT, and this client cannot vouch for an
							 * intent whose own answer may already have been discarded by the currency rule beside
							 * this one - so it removes its own write instead.
							 */
							if (previousFact?.answered === true) {
								facts[sessionId] = previousFact;
							} else {
								delete facts[sessionId];
								/*
								 * AND THE CLIENT ASKS RATHER THAN KEEPING NEITHER: with that intent gone this window
								 * knows nothing about the conversation's archive state while the daemon does, so the
								 * page is read again. Without it the row reads the wire's stale value until the 5s
								 * poll - the whole of the window in which a reader would act on it. A press with no
								 * fact behind it has nothing to re-learn, so only a displaced intent asks.
								 */
								if (previousFact !== null) void get().fetchSessions();
							}
						}
						return {
							archiveFacts: superseded ? state.archiveFacts : facts,
							/*
							 * THE REFUSAL TAKES ITS OWN STAMP, AND THE COUNTER MOVES WITH IT. Both lane messages
							 * used to be stamped from the SAME counter (the refusal took `state.answerSeq` as it
							 * stood), so a refusal landing in the answer that re-raised an offer TIED with it -
							 * and a tie is exactly the state the lane's rule now resolves in the refusal's favour
							 * (see the drawn-message rule and its comment in `chat-sidebar.tsx`). Advancing the
							 * counter here makes a refusal that lands LAST strictly newer, which is what its own
							 * sentence says it is: the last press the daemon actually answered.
							 */
							answerSeq: state.answerSeq + 1,
							archiveFailure: {
								sessionId,
								/*
								 * THE STAMP IS THE CURRENCY THE LANE READS (agent review round 3, R3-1). Taken from
								 * `answerSeq` at the landing: a later successful archive's offer carries a higher
								 * one, which is what lets the lane draw the newer message instead of preferring
								 * the refusal forever.
								 */
								at: state.answerSeq + 1,
								archived,
								title: rowTitle || "Untitled chat",
								/*
								 * The backend's own sentence when there is one. A transport failure
								 * that reached nothing keeps an empty detail and the sentence around
								 * it states the fact: the row did not move.
								 */
								detail:
									error instanceof DesktopControlError && error.message
										? error.message
										: "",
							},
						};
					});
					return false;
				}
			},
			deleteSession: async (sessionId) => {
				try {
					await desktopResult<{ session_id: string; deleted: boolean }>({
						op: "sessions.delete",
						sessionId,
						/* The user's own answer to the danger dialog, on the wire. */
						confirmed: true,
					});
					set((state) => forgetSession(state, sessionId));
					return { ok: true };
				} catch (error) {
					const status =
						error instanceof DesktopControlError ? error.status : null;
					const code =
						error instanceof DesktopControlError ? (error.code ?? null) : null;
					/*
					 * A 404 IS THE OUTCOME THE USER ASKED FOR, and it is not reported as a
					 * failure: the route answers it for an id this daemon does not have, so the
					 * conversation the user asked to remove is not there to remove. The row is
					 * dropped for the same reason a confirmed delete drops it - otherwise the
					 * panel would keep drawing a conversation the backend has just denied
					 * holding, and the next page would take it away anyway.
					 */
					if (status === 404) {
						set((state) => forgetSession(state, sessionId));
						return { ok: true };
					}
					/*
					 * THE TOKEN, NOT THE STATUS (agent review round 4, R4-3). 409 is one arm of
					 * the route's ladder for FOUR guards - a live session, an armed wake, unread
					 * mail, and a guard whose store could not be read - and the backend's own
					 * docstring says the split is deliberate: the code "names the condition (a
					 * client keys on it)" while the SENTENCE names the specific remedy. That arm
					 * is shared with unrelated refusals (`AttachmentUnavailable`,
					 * `ProfileRegistryUnavailable`, the generic `HTTPException(409, ...)`), so
					 * keying on the status would claim a delete guard for any of them;
					 * `DesktopControlError.code` carries `detail.code` and `session_delete_refused`
					 * is the daemon's own token for exactly this condition.
					 *
					 * So this field is named for the condition the client can see (a guard
					 * refused) rather than for a cause it cannot infer, which is what QA round 3's
					 * Q11 measured: a wake refusal used to be reported as `live` and drawn with
					 * advice about stopping a session.
					 *
					 * The backend's sentence is the one that names the guard - quoted rather than
					 * paraphrased here, because a client that re-words a guard it does not own
					 * drifts from the route the moment the route changes. Every other failure
					 * keeps whatever sentence the transport or the daemon authored.
					 */
					return {
						ok: false,
						guarded: code === "session_delete_refused",
						detail:
							error instanceof DesktopControlError && error.message
								? error.message
								: "The conversation could not be deleted.",
					};
				}
			},
			requestSessionDelete: (sessionId) => set({ deleteCandidate: sessionId }),
			createSession: async (
				cwd,
				target,
				requestId = crypto.randomUUID(),
				model?: DesktopModelSelection | null,
			) => {
				try {
					const result = await desktopResult<{
						session_id: string;
						binding: CanonicalSessionRow["binding"];
					}>({
						op: "sessions.create",
						requestId,
						cwd,
						...(target ? { target } : {}),
						/*
						 * Omitted, not nulled, when the user picked nothing: the wire body then
						 * stays byte-identical to the one this app sent before the draft's chips
						 * could open, which is what makes the capability additive for every
						 * caller that never used it.
						 */
						...(model ? { model } : {}),
					});
					get().upsertSession({
						session_id: result.session_id,
						cwd,
						binding: result.binding,
					});
					return result.session_id;
				} catch (error) {
					// Same rule as `fetchSessions` above: the app states the refusal's own
					// consequence rather than repeating the server's words (UX round 2, U1).
					set({
						error: storeErrorMessage(
							error,
							"Chat could not start. Retry with the same draft.",
						),
					});
					throw error;
				}
			},
			setActiveSession: (activeSessionId) => {
				set({
					activeSessionId,
					activeDraftKey: null,
					validatingSessionId: null,
				});
			},
			/*
			 * A guard rather than an assignment: a live frame belongs to the session
			 * that streamed it, and the view may already be somewhere else. Clearing
			 * unconditionally here would let an abandoned target's own snapshot vouch
			 * for a window the user is no longer waiting in.
			 */
			confirmSessionLive: (sessionId) => {
				if (sessionId && get().validatingSessionId === sessionId)
					set({ validatingSessionId: null });
			},
			confirmSessionMissing: (sessionId) => {
				if (!sessionId || get().validatingSessionId !== sessionId) return;
				set({
					validatingSessionId: null,
					...forgetSession(get(), sessionId),
				});
			},
			rearmReadAck: (sessionId) => {
				set((state) => ({
					readAckRearm: rearmedReadAck(state.readAckRearm, sessionId),
				}));
			},
			publishReadAckNotice: (sessionId, kind, reason) => {
				set((state) => {
					const notice = state.readAckNotice;
					// Identity, not equality: the writer is a 500 ms poll, and a state that
					// re-renders every row twice a second for a statement that has not
					// changed is the cost this guard exists to avoid (see the action's doc).
					if (notice?.sessionId === sessionId && notice.kind === kind)
						return state;
					return {
						readAckNotice: {
							sessionId,
							kind,
							revision: (notice?.revision ?? 0) + 1,
							reason,
						},
					};
				});
			},
			clearReadAckNotice: (sessionId) => {
				set((state) =>
					state.readAckNotice?.sessionId === sessionId
						? { readAckNotice: null }
						: state,
				);
			},
			applyAttention: (sessionId, attention) => {
				set((state) => {
					const sessions = mergeAttentionInto(
						state.sessions,
						sessionId,
						attention,
					);
					// Identity, not equality: an unchanged merge must not re-render every
					// row of a 500-row sidebar for a beat that carried nothing new.
					return sessions === state.sessions ? state : { ...state, sessions };
				});
			},
			applyAttentionMany: (states) => {
				set((state) => {
					let sessions = state.sessions;
					for (const attention of states) {
						/*
						 * The identity is DERIVED from the state's own namespaced
						 * `conversation_id`, never taken from the caller: the bulk answer's
						 * buckets name conversations rather than positions, so pairing
						 * them with the request positionally would make the response's order
						 * part of the contract. A state whose id is not a `session/<id>`
						 * conversation, or whose session left the catalogue, is dropped by
						 * `mergeAttentionInto` — it returns the same array, and the loop
						 * carries on without a write.
						 */
						const conversationId = attention?.conversation_id;
						// The namespace is the backend's own (`session/<id>`), written as the
						// literal the rest of this tree compares against rather than
						// invented as a second constant.
						if (
							typeof conversationId !== "string" ||
							!conversationId.startsWith("session/")
						)
							continue;
						sessions = mergeAttentionInto(
							sessions,
							conversationId.slice("session/".length),
							attention,
						);
					}
					return sessions === state.sessions ? state : { ...state, sessions };
				});
			},
			markAllRead: async () => {
				/*
				 * Enumerated from the STORE rather than from the rendered list, which is
				 * what makes the control's own count and this batch the same fact: a
				 * search filter over the sidebar cannot make a visible count disagree
				 * with the set that is sent. The predicate itself is `unreadAckableRows`
				 * — the ONE home of that rule, so the surface's label and this request
				 * cannot drift apart.
				 */
				const items = unreadAckableRows(get().sessions).map((row) => ({
					sessionId: row.session_id,
					completionToken: row.attention?.completion_token as string,
				}));
				/*
				 * Nothing unread is not an empty request: `items` has a 1-item floor on
				 * the wire, and a batch of zero would clear nothing while still costing
				 * a round trip and a store write. Resolving without a request is also
				 * what keeps the caller's receipt honest — zero attempted, zero cleared.
				 */
				if (items.length === 0)
					return { attempted: 0, cleared: 0, superseded: 0, unknown: 0 };
				const receipt = await desktopResult<CompletionAttentionAckReceipt>({
					op: "attention.seen",
					items,
				});
				get().applyAttentionMany(receipt.read);
				return {
					attempted: items.length,
					cleared: receipt.read.length,
					superseded: receipt.superseded.length,
					unknown: receipt.unknown.length,
				};
			},
			applySessionStatus: (sessionId, status, revision, epoch) => {
				set((state) => {
					const index = state.sessions.findIndex(
						(row) => row.session_id === sessionId,
					);
					/*
					 * EVERY STAMP FROM ANOTHER EPOCH IS RETIRED, not every stamp when the
					 * epoch merely moved: a row stamped with THIS epoch (a list response
					 * produced by the process now serving us, which can land before the
					 * first frame of its epoch) holds a live counter, and dropping it would
					 * hand a later, staler list the win it is being denied.
					 */
					let retired = false;
					const sessions = state.sessions.map((row) => {
						if (
							(row.status_epoch === undefined &&
								row.status_revision === undefined) ||
							row.status_epoch === epoch
						)
							return row;
						retired = true;
						// Omitted rather than set to `undefined`: "no stamp" is an absent key,
						// which is what the list merge and the wire both read.
						const {
							status_revision: _revision,
							status_epoch: _epoch,
							...rest
						} = row;
						return rest;
					});
					if (index < 0) return retired ? { ...state, sessions } : state;
					const row = sessions[index];
					// Identity, not equality: an unchanged frame must not re-render every
					// row of a 500-row sidebar for a level that carried nothing new.
					const unchanged =
						row.status?.code === status.code &&
						row.status?.label === status.label &&
						row.status_revision === revision &&
						row.status_epoch === epoch;
					if (unchanged && !retired) return state;
					if (!unchanged)
						sessions[index] = {
							...row,
							status,
							status_revision: revision,
							status_epoch: epoch,
						};
					return { ...state, sessions };
				});
			},
			openSession: async (sessionId) => {
				/*
				 * RE-SELECTING THE ROW THE VIEW IS ALREADY ON IS A NO-OP.
				 *
				 * The window below has two closing bounds and only one of them is
				 * reachable for a session that is already active: the live frame is
				 * reported by an effect keyed on the session and its stream status
				 * (`chat-page`), and neither changes when the same row is clicked again -
				 * so the frame that already arrived is never reported for the new window,
				 * and the read's latency (up to its own deadline) is the only thing that
				 * closes it. That window refuses sends and reports why, which is a refusal
				 * the user cannot act on, for a switch that moves nothing: the view, the
				 * draft and the URL are already at the target, so `true` - the answer that
				 * says the switch stands - is the right one.
				 *
				 * `activeDraftKey` is part of the condition rather than decoration: a
				 * staged draft is a different view of the same session (the sidebar does
				 * not mark the row while one is staged), so a click that leaves it is a
				 * real move and still runs the whole switch.
				 *
				 * THE PRESS STILL STAMPS THE RECEIPT'S RE-ARM on both arms, which is the one
				 * thing this action does that is NOT a no-op when the target is already
				 * active. The press is the operator's own statement that they are looking
				 * at this conversation now, and the acknowledgement of its completed result
				 * is what that statement has to release: a retry the shared ladder had
				 * pushed out (a `store_busy` refusal it did not classify, today) left the
				 * row's mark standing over a result the operator was looking at, and their
				 * only remedy - clicking the row again - was read as "nothing happened"
				 * (the reported defect). `readAckRearm` states why it is one record and not
				 * a log; `useCompletionView` is the only reader.
				 */
				if (get().activeSessionId === sessionId && !get().activeDraftKey) {
					get().rearmReadAck(sessionId);
					return true;
				}
				/*
				 * COMMIT, AND LET THE CONVERSATION'S OWN STREAM VALIDATE IT.
				 *
				 * This used to await a `sessions.get` guard read behind the commit, and
				 * that read was the gate on sending: `validatingSessionId` stayed set
				 * until it answered. It was a SECOND full facade acquire on the backend
				 * for every click (`GET /v1/desktop/sessions/{id}`), racing the stream's
				 * own acquire for the same bridge locks - 30-60 ms on a healthy owner,
				 * 4 s behind a silent one, and 17-20 s behind a control call in flight,
				 * where it hit the renderer's own deadline (the desktop load diagnosis,
				 * D-F3). The stream answers the same question with nothing extra: its
				 * first `snapshot` frame proves the session exists (`confirmSessionLive`,
				 * reported by `chat-page`), and a 404 on the subscription proves it does
				 * not (`use-canonical-session`'s `missing` arm, which the pane already
				 * renders as the one missing-session notice).
				 *
				 * What that changes, stated because each was a property of the old read:
				 *
				 * - THE WINDOW stays. A send addressed to a session nothing has confirmed
				 *   is still refused with `SESSION_UNVALIDATED_MESSAGE`; the window is
				 *   now closed by the snapshot, which is the frame that paints the
				 *   messages, so "messages on screen" and "the composer sends" land in
				 *   the same commit rather than one round trip apart.
				 * - A GONE TARGET still tombstones, from the stream instead of the read: a
				 *   404 on the subscription raises `view.missing`, and `chat-page` reports
				 *   it through `confirmSessionMissing`, which is the old not-found arm
				 *   verbatim (`forgetSession`, window closed, view left on the target).
				 *   A deep link to a deleted conversation still lands on the notice.
				 * - THERE IS NO ROLLBACK. A transient failure used to put the view back
				 *   on the outgoing conversation with a sentence; now the target pane
				 *   states it itself - the stream's own `reconnecting`/`unavailable`
				 *   notice with its Retry - which is the conversation the user asked
				 *   for, rather than the one they left. `navigationError` had no other
				 *   writer, so it goes with it.
				 * - The return value is `true`: the switch stands the moment it is made,
				 *   and nothing later can disprove it into a URL restore. It stays a
				 *   Promise so the three entrances (`open-conversation.ts`, the schedules
				 *   page and the route effect) keep their shape.
				 *
				 * The generation counter (`navigationGeneration`) goes with the read:
				 * its only reader was this action's own "is my read still current?"
				 * check, and with no read in flight there is nothing for a newer
				 * navigation to supersede. Latest-wins is now the plain `set` below.
				 */
				set({
					activeSessionId: sessionId,
					activeDraftKey: null,
					validatingSessionId: sessionId,
					error: null,
				});
				// The same stamp as the no-op arm above, for the same reason: this press is
				// the operator's statement that they are looking at this conversation now.
				get().rearmReadAck(sessionId);
				return true;
			},
			stageDraft: (target, fresh = false) => {
				const key =
					!fresh && target
						? `draft:${target.kind}:${target.name}`
						: `draft:${crypto.randomUUID()}`;
				const existing = get().drafts[key];
				set((state) => ({
					activeDraftKey: key,
					validatingSessionId: null,
					error: null,
					drafts: {
						...state.drafts,
						[key]: existing ?? {
							key,
							target,
							createRequestId: crypto.randomUUID(),
							admissionRequestId: crypto.randomUUID(),
						},
					},
				}));
				return key;
			},
			updateDraft: (key, patch) =>
				set((state) => {
					// A PARTIAL patch onto a row that is gone must not resurrect it.
					// This was a blind spread onto `state.drafts[key]`, so when a draft
					// was abandoned while its admission was still in flight, the settling
					// request's catch rebuilt the row from the patch alone - without
					// `key`, `createRequestId` or `admissionRequestId`. The next send
					// then went to the wire with `requestId: undefined`, which the closed
					// IPC schema rejects, and that refusal re-armed this store's own
					// unchanged-payload guard: every later send failed against a healthy
					// backend with no causal link to the click that caused it. Discard is
					// deliberate and outranks the outcome of the request it abandoned.
					//
					// The condition is identity, not existence, because this setter is
					// also the legitimate CREATE path: `admitChatDraft` opens a send for
					// an already-existing session by patching a `send:<id>` key that has
					// no row yet, and that patch carries the whole identity. So a patch
					// that can stand on its own as a draft may create one; a fragment
					// like `{pending, error}` may only ever update something already
					// there.
					const present = state.drafts[key];
					const complete =
						patch.key !== undefined &&
						patch.createRequestId !== undefined &&
						patch.admissionRequestId !== undefined;
					if (!present && !complete) return {};
					return {
						drafts: {
							...state.drafts,
							[key]: { ...state.drafts[key], ...patch },
						},
					};
				}),
			setDraftModel: (key, model) =>
				set((state) => {
					/*
					 * A pick on a pane whose row is gone records nothing: the pane was
					 * discarded while the picker was open, and this must not resurrect it
					 * (the same rule `updateDraft` states for a partial patch).
					 */
					const present = state.drafts[key];
					if (!present) return {};
					return {
						drafts: {
							...state.drafts,
							[key]: {
								...present,
								model,
								/*
								 * A new at-most-once key for a changed create body, and only while there
								 * is still no session: once one exists the create has already been made
								 * and its id must stay pinned so a replay of that request stays an
								 * idempotent replay rather than a second conversation. The admission id
								 * is NOT re-minted here — it addresses the message, not the model, and
								 * `admitChatDraft` owns when that becomes load-bearing.
								 */
								...(present.sessionId
									? {}
									: { createRequestId: crypto.randomUUID() }),
							},
						},
					};
				}),
			finishDraft: (key, sessionId) =>
				set((state) => {
					/*
					 * The message is on the owner, so nothing about it is in flight
					 * or waiting to be reconciled any more. Done here rather than by
					 * the caller because every path that ends a send successfully
					 * comes through this action, including the reconciler that
					 * discovers a late delivery after a restart.
					 */
					useConversationInputStore
						.getState()
						.settleInFlight([composerIdentityFor(key, sessionId)]);
					const drafts = { ...state.drafts };
					delete drafts[key];
					return {
						drafts,
						...(state.activeDraftKey === key
							? { activeDraftKey: null, activeSessionId: sessionId }
							: {}),
					};
				}),
			discardDraft: (key) =>
				set((state) => {
					const drafts = { ...state.drafts };
					/*
					 * Abandoning the message also drops any echo buffered for its
					 * session. The buffer holds the text and its images as base64
					 * until a panel mounts, and a discarded draft is the case where
					 * one may never do - so this is the user's deletion being
					 * honoured in memory, not just in the store.
					 *
					 * THE SESSION ID LIVES IN TWO PLACES DEPENDING ON HOW THE DRAFT
					 * WAS MADE, and reading only one of them made this a no-op for
					 * the commonest send. A draft staged from "New chat" is keyed
					 * `draft:<uuid>` and LEARNS its session id mid-send, so the row
					 * carries it. A send from an existing conversation is keyed
					 * `send:<sessionId>` by `draftIdentityFor` and the id is passed
					 * to `admitChatDraft` as an argument - it is never written to
					 * the row, so `drafts[key].sessionId` is undefined there and the
					 * abandoned echo survived with its text and attachments.
					 *
					 * Both shapes are read, row first: the row is authoritative when
					 * present, and the key is the fallback that covers the send path.
					 */
					const abandoned =
						drafts[key]?.sessionId ??
						(key.startsWith("send:") ? key.slice("send:".length) : undefined);
					if (abandoned) discardPendingEchoes(abandoned);
					delete drafts[key];
					/*
					 * Clear the pointer as well as the draft, the way
					 * `finishDraft` does. Deleting only the entry leaves
					 * `activeDraftKey` naming a draft that no longer exists, and
					 * every consumer reads that pointer as "a draft is being
					 * composed": the sidebar's New chat row highlights itself with
					 * `aria-current="page"` for a discarded agent draft the user
					 * never opened, and the session rows keep suppressing their own
					 * highlight. Unlike `finishDraft` there is no session to become
					 * active - a discarded draft never became one - so the selection
					 * is left where it was.
					 */
					return {
						drafts,
						...(state.activeDraftKey === key ? { activeDraftKey: null } : {}),
					};
				}),
			bindSession: (_legacyAgentId, sessionId) =>
				get().setActiveSession(sessionId),
			/*
			 * The pin press, in the order the two writes have to happen: the row moves
			 * first (the feedback IS the state, and a spinner on a 24px control in a
			 * list reads as a stall), then the backend answers, then the answer is
			 * what the row holds.
			 *
			 * WHAT THE ANSWER BEING AUTHORITATIVE BUYS, given the optimistic write
			 * already put the value on screen: a backend that refused to move - the
			 * 51st pin dropping the oldest instead of this one, a store that
			 * could not write - is not something this client can predict, so the
			 * reconcile below is not a no-op check, it is the only place the row can
			 * learn it was wrong. Both directions on failure: the value goes back to
			 * what the row held BEFORE the press (read here, not derived from the
			 * incoming state, so a concurrent catalog read cannot make the revert
			 * write a third value), and `pinFailure` states it.
			 */
			/**
			 * Take the sequence for an answer that is ABOUT TO BE REQUESTED.
			 *
			 * Called by the search hook when its request starts, so the number describes
			 * the moment the question was asked rather than the moment the answer came
			 * back: an answer in flight across a press must not be able to supersede it.
			 */
			beginAnswer: () => {
				const seq = get().answerSeq + 1;
				set({ answerSeq: seq });
				return seq;
			},
			/**
			 * Apply a search answer's own pin state to the facts it speaks about.
			 *
			 * This is the supersession half of the currency rule (`PinFact`): a fact older
			 * than the request that produced this answer gives way to the answer, so a pin
			 * removed on the other surface stops reading pinned here as soon as this client
			 * asks again. A fact written AFTER the request started is left alone, and a hit
			 * that carries no `pinned` says nothing and therefore supersedes nothing.
			 */
			applySearchAnswer: (seq, hits) =>
				set((state) => {
					let facts: Record<string, PinFact> | null = null;
					/*
					 * The ROW gives way too, not only the fact. A press on a conversation the
					 * catalogue page cannot carry INSERTS a row (see `setSessionPin`), and that
					 * row carries the pressed state until something speaks about it - a fact
					 * swept away while its row kept the stale pin would leave the panel saying
					 * exactly what the review said it must not. So an answer newer than the
					 * press writes the answer's own value onto the row as well.
					 */
					let rows: typeof state.sessions | null = null;
					/*
					 * THE ARCHIVE FACTS, settled by the same answer under the same rule about
					 * silence: only the ids this answer SPEAKS about, because a search answers
					 * a question about one query and an id it does not mention is not evidence
					 * of anything - unlike the catalogue page, which asked for the archived set
					 * and can settle it whole (see the settle block in `fetchSessions`).
					 */
					let archiveFacts: Record<string, ArchiveFact> | null = null;
					for (const hit of hits) {
						/*
						 * THE ARCHIVE HALF FIRST, and OUTSIDE the pin's own guard below. A hit
						 * that describes no pin still SPEAKS about the conversation - it names an
						 * id, which is the whole of what the archive rule needs - so gating both
						 * halves on `pinned` would leave an archived fact alive through every
						 * answer that happened not to describe a pin.
						 */
						const archivedFact = state.archiveFacts[hit.id];
						if (archivedFact !== undefined && archivedFact.at < seq) {
							archiveFacts = archiveFacts ?? { ...state.archiveFacts };
							delete archiveFacts[hit.id];
						}
						if (typeof hit.pinned !== "boolean") continue;
						const fact = state.pinFacts[hit.id];
						if (fact !== undefined && fact.at >= seq) continue;
						if (fact !== undefined) {
							facts = facts ?? { ...state.pinFacts };
							delete facts[hit.id];
						}
						if (
							state.sessions.some(
								(row) => row.session_id === hit.id && row.pinned !== hit.pinned,
							)
						) {
							rows = rows ?? state.sessions.map((row) => ({ ...row }));
							for (const row of rows) {
								if (row.session_id === hit.id) row.pinned = hit.pinned === true;
							}
						}
					}
					if (facts === null && rows === null && archiveFacts === null)
						return {};
					return {
						...(facts === null ? {} : { pinFacts: facts }),
						...(rows === null ? {} : { sessions: rows }),
						...(archiveFacts === null ? {} : { archiveFacts }),
					};
				}),
			setSessionPin: async (sessionId, pinned, seed) => {
				const before = get().sessions.find(
					(row) => row.session_id === sessionId,
				);
				/*
				 * What this client knew BEFORE the press, which is what a refused write
				 * reverts to. The fact outranks the row's own field: for a conversation the
				 * catalogue page does not carry, the row is the cached wire hit and is not
				 * evidence, while the fact is this client's own last confirmed state. `null`
				 * rather than `false` for "no fact", because reverting must not MINT one: a
				 * row the catalogue does not carry and this window never pinned has nothing
				 * to put back.
				 */
				const factBefore = get().pinFacts[sessionId] ?? null;
				/*
				 * What the CONTROL RENDERED before the press, which is what a refused write has
				 * to put back. The row's own field wins when the store holds the row - it is
				 * what the glyph was drawn from - and the client's fact is the only witness for
				 * a conversation the catalogue page does not carry, where the row is the cached
				 * wire hit and says nothing about what was on screen.
				 */
				const held =
					before === undefined
						? (factBefore?.pinned ?? false)
						: before.pinned === true;
				/*
				 * A row the store does not hold is INSERTED from the seed rather than left
				 * absent: the map below is a no-op without it, and a press whose result the
				 * panel cannot read is the failure this exists to prevent. `updated_at` is
				 * the wire's own mtime when the hit carried one, so the row sorts where the
				 * search said it belongs rather than at the top of the list.
				 */
				const seedRow: CanonicalSessionRow | null =
					before === undefined && seed !== undefined
						? {
								session_id: sessionId,
								title: seed.title || "Untitled chat",
								updated_at: seed.updated_at,
								pinned,
							}
						: null;
				/*
				 * The stamp this write owns: a FRESH sequence, taken rather than read. Every
				 * later handler asks whether it is still the latest write for this conversation
				 * before it touches anything, and two presses in flight on one row settle in the
				 * order they were MADE (review round 4, m2). Reading the sequence instead of
				 * taking one left two presses in the same tick sharing a stamp, so neither could
				 * tell that the other had happened.
				 */
				const stamp = get().beginAnswer();
				/*
				 * What a row needs if the panel has to DRAW this conversation later: the title
				 * from the row the press acted on, or from the seed when the store held none.
				 * Carried on the fact so a held pin is never the invisible half of the set
				 * (design round 4, D17).
				 */
				const title = before?.title ?? seed?.title;
				const updated_at = before?.updated_at ?? seed?.updated_at;
				set((state) => ({
					sessions:
						seedRow === null
							? state.sessions.map((row) =>
									row.session_id === sessionId ? { ...row, pinned } : row,
								)
							: [...state.sessions, seedRow],
					// The fact as well as the row: the row can be dropped by the next
					// catalogue page (see `pinFacts`), and the fact cannot. Stamped with the
					// sequence current NOW, so an answer requested after this press supersedes
					// it and an answer requested before it does not.
					pinFacts: {
						...state.pinFacts,
						[sessionId]: { pinned, at: stamp, title, updated_at },
					},
					// A press retires the previous press's sentence: the notice is about the
					// row under the pointer, and two of them would be a log.
					pinFailure: null,
				}));
				try {
					const answer = await desktopResult<{
						session_id: string;
						pinned: boolean;
					}>({ op: "sessions.pin", sessionId, pinned });
					let settled = false;
					set((state) => {
						/*
						 * A LATER PRESS OWNS THE ROW NOW. `setSessionPin` stamps each write, and a
						 * second press on the same row replaces the fact - so an answer whose
						 * stamp is no longer the fact's belongs to a press the user has already
						 * superseded, and applying it would settle the row on the stale half of
						 * two in-flight writes (review round 4, m2).
						 */
						const current = state.pinFacts[sessionId];
						if (current === undefined || current.at !== stamp) return {};
						settled = true;
						return {
							sessions: state.sessions.map((row) =>
								row.session_id === sessionId
									? { ...row, pinned: answer.pinned === true }
									: row,
							),
							pinFacts: {
								...state.pinFacts,
								[sessionId]: {
									...current,
									pinned: answer.pinned === true,
								},
							},
						};
					});
					return settled;
				} catch (error) {
					set((state) => {
						/*
						 * A later press's write is not this call's to revert, for the same
						 * reason an earlier press's answer is not this call's to apply.
						 */
						const current = state.pinFacts[sessionId];
						if (current !== undefined && current.at !== stamp) return {};
						// The fact goes back to what it was, or goes away: a revert that MINTED
						// one would claim this window knows the state of a conversation it has
						// only just failed to write.
						const facts = { ...state.pinFacts };
						// The fact follows the row: a revert that restored a fact DISAGREEING
						// with the row it just put back would leave the two saying opposite
						// things about the same conversation. The stamp is kept where the fact
						// survived and taken fresh where a fact is minted, so a revert cannot
						// make a fact look older than the write it is about.
						if (factBefore === null && before === undefined) {
							delete facts[sessionId];
						} else {
							/*
							 * The stamp goes back with the value: the fact describes the state the
							 * control was showing again, and it must not look older than the press
							 * whose refusal it records.
							 */
							facts[sessionId] = {
								pinned: held,
								at: Math.max(factBefore?.at ?? 0, stamp),
								title: factBefore?.title ?? title,
								updated_at: factBefore?.updated_at ?? updated_at,
							};
						}
						return {
							sessions: state.sessions.map((row) =>
								row.session_id === sessionId ? { ...row, pinned: held } : row,
							),
							pinFacts: facts,
							pinFailure: {
								sessionId,
								pinned,
								title: before?.title || "this chat",
								detail: userFacingMessage(error, ""),
							},
						};
					});
					return false;
				}
			},
			upsertSession: (row) =>
				set((state) => {
					const present = state.sessions.some(
						(item) => item.session_id === row.session_id,
					);
					return {
						sessions: present
							? state.sessions.map((item) =>
									item.session_id === row.session_id
										? mergeRow(item, row)
										: item,
								)
							: [...state.sessions, row],
					};
				}),
		}),
		{
			name: "canonical-sessions-storage",
			merge: mergePersistedSession,
			partialize: (state) => ({
				sessionByAgent: state.sessionByAgent,
				activeSessionId: state.activeSessionId,
				activeDraftKey: state.activeDraftKey,
				cwd: state.cwd,
				/*
				 * THE TOMBSTONES GO WITH IT, SO THE UI'S OWN GONE-STATE SURVIVES A
				 * RELOAD (QA round 2's Q1, second half).
				 *
				 * A daemon that keeps answering 200 for a conversation it has just been
				 * told to delete - which is what QA measured, and what the round sent to
				 * the backend - leaves the client nothing to read the deletion from after
				 * a reload: the stream opens, the transcript hydrates, and the pane
				 * offers a writable composer over a conversation the user removed. What
				 * THIS window did, it knows, and that is a durable fact about its own act
				 * rather than a claim about the store: persisting it is what lets the pane
				 * land on the missing-session notice on the first paint after a reload.
				 *
				 * `at` IS DELIBERATELY NOT PERSISTED, and 0 is the correct value for a
				 * restored one: the stamp orders a tombstone against reads that were in
				 * flight INSIDE one process, and a reload has none. Written as 0, any page
				 * the fresh process asks for outranks the record, so the resurrection rule
				 * still revives a conversation the store really does carry again - a
				 * restored tombstone self-heals on the first page that lists the id, while
				 * a page that omits it leaves the id hidden, which is the same rule the
				 * live process applies one second earlier.
				 */
				forgotten: Object.fromEntries(
					Object.entries(state.forgotten).map(([id, fact]) => [
						id,
						{ at: 0, title: fact.title },
					]),
				),
				drafts: Object.fromEntries(
					Object.entries(state.drafts).map(([key, draft]) => [
						key,
						{ ...draft, pending: false },
					]),
				),
			}),
		},
	),
);
