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
	retractPendingUser,
} from "@shared/hooks/use-canonical-session";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DesktopModelSelection } from "../../../../shared/desktop-contract";
import {
	type CompletionAttention,
	type CompletionAttentionAckReceipt,
	type SessionBinding,
	type SessionCatalogueStatus,
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
	binding?: SessionBinding;
	[key: string]: unknown;
};
type BackendSessionRow = Omit<CanonicalSessionRow, "session_id"> & {
	id: string;
	name: string;
	mtime: number;
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
	 * The code of the failure that LEFT the payload above held — the claim's own
	 * verdict, travelling with the payload.
	 *
	 * WHY IT IS A FIELD AND NOT `errorCode`. `errorCode` is a statement about the
	 * LAST attempt (and `onDismiss` clears it the moment the operator acknowledges
	 * the sentence), while this one is a statement about the payload the store is
	 * still holding — the two part company on the flow this whole change exists for:
	 * refusal, `Restore message`, drop the file, Enter. The unchanged-payload guard
	 * answers that press, so the code on screen becomes `UNCONFIRMED_SEND_CODE` and
	 * the composer's held line reverted to "whether it reached the agent is not
	 * knowable ... send again only if no reply arrives" — one screen after the app
	 * itself said "Nothing was saved", with the disk off the screen entirely (UX
	 * round 2, U10). The guard throws before this row is written, so nothing here
	 * can be blamed on the guard overwriting it: the information was never recorded
	 * against the claim in the first place.
	 *
	 * Written only for a failure that leaves a claim (post-admission), cleared when
	 * the claim ends (`releaseClaim`, `discardDraft`, `finishDraft`), and rewritten
	 * by each later failure of the same held payload — so it always describes the
	 * payload `submittedText` names, which is exactly what the composer's held line
	 * is allowed to assert.
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
 * The unconfirmed-send guard's category, so the composer can recognise its own
 * refusal and offer the two controls that actually resolve it (restore the held
 * payload, or discard the claim) instead of the generic "edit and send again"
 * tail, which is the one thing this guard refuses.
 *
 * A code rather than a string comparison on the message: the copy is expected
 * to be reworded, and matching on prose would silently stop matching.
 */
export const UNCONFIRMED_SEND_CODE = "unconfirmed_send";

/**
 * Shown when a send failed with nothing user-facing to say - a runtime
 * exception rather than a backend rejection. Stated once and shared, because
 * the page-level fallback and this one are the same sentence about the same
 * event and drifted apart when they were two literals.
 */
export /**
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

const SEND_UNCONFIRMED_MESSAGE =
	"The send could not be confirmed. Retry this draft.";

/**
 * The read window's refusal, as a category.
 *
 * A send addressed to a session whose guard read (`sessions.get`) has not
 * answered is refused by the store, because commit-first puts the view on that
 * session one round trip before anything has confirmed it still exists. Like
 * `UNCONFIRMED_SEND_CODE`, this is a code rather than a string comparison on
 * the copy: the sentence below is expected to be reworded, and matching prose
 * would silently stop matching.
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
 * suppressed for this code (see above): a retry is refused by the read window
 * for as long as the window lasts, and this sentence cannot outlive it, so
 * instructing a retry would name the one action that cannot succeed yet. What is
 * true is that the send works once the wait ends - the read's own answer, the
 * session's live frame, or the read's own deadline.
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
 * generic "Send it again" hint for it (see `withholdsRetryHint`), and a code is
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
 * `withholdsRetryHint` below reads - and that the sentence is not replaced by a
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
 *   - the generic retry hint is withheld, by `withholdsRetryHint` below, which
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
 * Whether a refusal's remedy is anything OTHER than "send it again".
 *
 * The composer's generic retry hint is the alert's "what to do" half, and it is
 * only ever rendered where it is true. Six refusals cannot be answered by
 * resending the same bytes: the read window refuses every send for as long as
 * its own notice is on screen, the leading-slash policy refuses this text
 * forever, an attachment that cannot be read is still unreadable on the next
 * attempt - the same chip is still attached, so the retry is refused for the
 * same reason until the chip is replaced or removed - a store that is out of
 * space or unreadable is in the same state on the next attempt too, and the
 * unchanged-payload guard's code is the sixth, and it is the one term that is
 * NOT the guard's whole story (agent review round 2, N1, which measured it): an
 * UNCHANGED resend of the held payload is admitted - that is what `Restore
 * message` exists to make possible - so the guard refuses the retry only when the
 * payload differs from the one it is holding, and by itself this code licenses no
 * statement about the hint. It is in the list as a BACKSTOP for a question the
 * composer answers more precisely and cannot always answer at all: its own
 * `heldInBox` test needs the held chip set, which is absent on the arm where the
 * store knows only the text, and an unknown chip set reads as "not the held
 * payload" - so on that arm the code is what keeps the hint off a screen whose
 * next press the guard refuses. The two directions are not symmetric: withholding
 * a hint that would have been true costs one redundant line (the payload is in the
 * box and Enter retries it), while rendering it over a refusal is an instruction
 * the app then refuses. Where the comparison IS available, `heldInBox` withholds
 * first and this term changes nothing - which is why the committed `altered-held`
 * frame would pass with either mechanism (N1).
 *
 * (UX round 3, U9; UX round 2, U13; design round 4, D13; the store split; UX
 * round 1, U2.) Each carries its own statement of what to do instead, and the
 * composer withholds the hint for all of them.
 *
 * The guard's own code is the one with a history of being left out, and where the
 * hint is not merely redundant but self-contradicting: the operator's own remedy on
 * 2026-09-17 - drop the image that pushed the write over the threshold - lands
 * exactly there, and read "Send it again" over a guard that then refused the press.
 * It went to the user as an infinite instruction/refusal loop, measured at 11 ->
 * 11 requests (UX round 1, U2).
 *
 * What the two store codes add to that list is a distinction the copy alone
 * cannot make: the third arm of the same backend ladder, `store_busy`, reads
 * much like them and IS worth retrying, so this predicate - not the sentence's
 * shape - is what tells the two apart.
 *
 * One function rather than two call-site comparisons, so the composer reads the
 * rule instead of listing the codes, and so `scripts/canonical-chat.test.mjs`
 * can execute it against the store that raises them.
 */
export function withholdsRetryHint(code: string | undefined): boolean {
	return (
		code === SESSION_UNVALIDATED_CODE ||
		code === LEADING_SLASH_CODE ||
		code === UNREADABLE_ATTACHMENT_CODE ||
		code === UNCONFIRMED_SEND_CODE ||
		code === STORE_OUT_OF_SPACE_CODE ||
		code === STORE_UNAVAILABLE_CODE
	);
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
 * 413 and 422 are raised before the prompt reaches the session (the reasoning is
 * spelled out on the un-latch below), so the message provably does not exist on
 * the owner. The read window's refusal is the third case and the same kind of
 * fact: it is raised before the draft is even touched, so nothing reached the
 * owner either. Every other failure is unknowable.
 */
export function isRefusedBeforeAdmission(error: unknown): boolean {
	return (
		(error instanceof DesktopControlError &&
			(error.status === 413 || error.status === 422)) ||
		/*
		 * The read window's own refusal belongs in this answer, not beside it. It
		 * is raised before anything is written to the draft and before the
		 * transport is reached, so "nothing reached the owner" is exactly as true
		 * of it as of a 413 - and the composer reads this one predicate to decide
		 * whether the text goes back in the box (`false`) or stays out because the
		 * outcome is unknowable (`SEND_HELD`). A second copy of that judgement at
		 * the call site is how the two come to disagree about one refusal.
		 */
		(error instanceof UserFacingError &&
			error.code === SESSION_UNVALIDATED_CODE)
	);
}

/**
 * Whether this row is one whose refusal owes the composer a payload BACK.
 *
 * ONE discriminator for BOTH halves of that payload - the text and the
 * attachments (round 7, R17). They are written together, before the request
 * (`admitChatDraft` stores `submittedText`, `submittedAttachments` and
 * `submittedImages` in one update), so a second copy of this rule is how one
 * half comes to be restored while the other is dropped in silence.
 */
function owesRefusedPayload(draft: ChatDraft | undefined): draft is ChatDraft {
	if (!draft) return false;
	return !draft.pending && !draft.admissionAttempted;
}

/**
 * The text a refused send owes the composer, for the refusals that admitted
 * nothing.
 *
 * `isRefusedBeforeAdmission` answers this question about the ERROR; this answers
 * it about the RECORD the store kept of it, and the composer needs the second
 * answer rather than the first: what it renders is the row, and the row outlives
 * the component that issued the send.
 *
 * WHY THE ISSUING COMPONENT CANNOT ANSWER IT. The other consumer of a refusal is
 * `use-message-input`'s restore, which writes the submitted text back into local
 * composer state, and that suffices on the arm that names a session: there the
 * draft's identity (`send:<id>`), the panel it is rendered in
 * (`panelIdentityFor`) and the composer's own text key all exist before the send
 * and are unchanged by it. It does NOT suffice on the arm a "New chat" uses. The
 * session is created INSIDE the same call, `admitChatDraft` patches the row with
 * its id one request before admission, and `panelIdentityFor`'s precedence is
 * `id ?? draftKey` - so the identity that keys the panel flips from the draft key
 * to the new session id MID-SEND. React answers a key change with an unmount, so
 * the restore's `setInputValue` lands on a composer that is gone, and the
 * composer that replaces it is seeded from its own per-conversation text state,
 * which is empty for a conversation id that did not exist when the send began.
 * The STORE loses nothing (`submittedText` is written before the request and the
 * row, with `activeDraftKey`, survives a reload), but no route put it back in the
 * box: the user was told to "move it below your text, or send it on its own" for
 * text no longer on screen, with only "Discard message" to act on. That is
 * real loss of a two-line message, reported live (UX round 3 U14, QA round 3 Q7).
 *
 * So the retention record is the source and the composer adopts it, which is one
 * definition of "this refusal owes the box this text" for BOTH arms rather than a
 * restore that only works while the component that made it stays mounted. The box
 * rule is `restoreSubmittedText`'s: only an EMPTY box is written, so text the user
 * typed while the send was in flight is never overwritten.
 *
 * `admissionAttempted` is the whole discriminator, and it is this store's own
 * un-latch rather than a second guess about the failure: a request that reached
 * the message and was refused before admission carries `admissionAttempted: false`
 * (see the catch in `admitChatDraft`), i.e. the text provably did not land. When
 * it is TRUE the message may already be on the owner with its echo deliberately
 * painted in the transcript, so the box must stay empty - that is the
 * `heldText`/Restore path, a different answer to a different fact.
 *
 * `error` is deliberately NOT a term. Dismissing the alert (`onDismiss`) clears
 * the copy and the code and keeps the payload: that is the user acknowledging the
 * SENTENCE, not abandoning the message they typed, and a dismissal that silently
 * made the text unreachable again would be this defect one keystroke later.
 * Discard, a successful send and `releaseClaim` are what end the record.
 *
 * WHAT IT DOES NOT ANSWER (round 7, R23). It reports the row's LAST refused
 * payload, not "the text this refusal owes". The read window's refusal is raised
 * before the draft is touched at all (`admitChatDraft`'s first gate), so on that
 * arm this returns `undefined` - or an older payload from a send that failed
 * earlier and was never abandoned - while a refusal is on screen. Nothing
 * misbehaves today (both of those arms leave the box non-empty, and a repeat of
 * the same payload short-circuits the effect), which is exactly why the limit is
 * written down here rather than left for the next reader to assume past.
 */
// The rule this text is put back THROUGH lives one layer up, in the composer
// hook (`@shared/hooks/use-message-input`'s `restoreSubmittedText`): the store
// owns which payload a refusal owes the box, and the composer owns the box.
export function refusedBeforeAdmissionText(
	draft: ChatDraft | undefined,
): string | undefined {
	if (!owesRefusedPayload(draft)) return undefined;
	return draft.submittedText;
}

/**
 * The attachments that same refusal owes the composer, on the same rule.
 *
 * WHY THEY NEED A ROUTE OF THEIR OWN. `submittedAttachments` is the user's file
 * list, written before the request like the text - and the composer reads its
 * chips from `inputByConversation[conversationId]`, which on the created-session
 * arm were staged under the PRE-FLIP identity. So the chip row is empty after
 * the flip and this field is the only survivor: pressing Send on the restored
 * text sent the message WITHOUT the file, said nothing, and `finishDraft` then
 * retired the row and the record with it. Silent and partial is the worst shape
 * a failure can take, and it is the failure the composer's own comment promises
 * cannot happen (`message-input.tsx`: "replies and attachments included" is true
 * only while the composer that sent them survives) - round 7, R17.
 *
 * PATHS, not the encoded `submittedImages` beside them: the send re-encodes
 * images from the composer's attachment paths (`encodeImageAttachments`), so a
 * re-adopted path restores the exact payload the refused send carried - pasted
 * images included, whose "path" is their own data URL. Re-adopting the encoded
 * set as well would give one file two representations that can disagree.
 */
export function refusedBeforeAdmissionAttachments(
	draft: ChatDraft | undefined,
): string[] | undefined {
	if (!owesRefusedPayload(draft)) return undefined;
	return draft.submittedAttachments;
}

/**
 * Whether a send addressed to `sessionId` is inside the guard read's window.
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
	 * THE READ WINDOW'S GATE, and it lives here rather than at the call site
	 * because "a message may not be admitted against a session nothing has
	 * confirmed yet" is a property of admission, not of one screen's send button.
	 *
	 * Commit-first (see `openSession`) puts the view on the target one round trip
	 * before `sessions.get` has said whether it still exists, and
	 * `validatingSessionId` is that window. A message admitted inside it would be
	 * addressed to a session that may be gone - so it is refused here, before the
	 * draft is latched and before the transport is reached, which is also what
	 * makes the refusal a `false` at the composer rather than a held claim (see
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
	if (
		previous?.admissionAttempted &&
		previous.submittedText !== undefined &&
		(previous.submittedText !== text ||
			JSON.stringify(previous.submittedAttachments) !==
				JSON.stringify(input.attachments) ||
			// Images are payload identity too. Comparing only text/attachments let a
			// retry that added an image pass the guard and then silently send the
			// FIRST attempt's images, dropping the new one with no error.
			JSON.stringify(previous.submittedImages ?? []) !==
				JSON.stringify(input.images))
	) {
		/*
		 * One action, and both remedies are controls rather than instructions.
		 *
		 * This used to read "Retry it unchanged, or discard it to send something
		 * different", which asked the user to reproduce a payload they could no
		 * longer see - the held text is not in the composer, that is precisely why
		 * this guard fired. Following it by hand is a loop: edit, send, refused,
		 * edit. So the sentence now states the situation only, and
		 * `UNCONFIRMED_SEND_CODE` lets the composer attach "Restore it" (puts the
		 * exact payload back, making an unchanged retry one keypress away) and
		 * discard. Copy never names an action the user has to perform blind.
		 */
		throw new UserFacingError(
			"The previous send has not been confirmed, and it does not match what is in the composer now.",
			UNCONFIRMED_SEND_CODE,
		);
	}
	const draft: ChatDraft = previous ?? {
		key,
		createRequestId: crypto.randomUUID(),
		admissionRequestId: crypto.randomUUID(),
	};
	// `mode` MUST be pinned once an admission has been issued, even though it
	// reads like a delivery instruction rather than payload. The server keys its
	// receipt on a sha256 of the WHOLE request body, `mode` included
	// (desktop_receipts.py), and raises ReceiptConflict -> HTTP 409 when a retry
	// of the same requestId hashes differently. So the lost-response case (turn
	// admitted, response never arrived, session now streaming, UI recomputes
	// busy=true) would retry as "steer", 409 forever, and report a failure for a
	// message that actually landed. Pinning keeps the retry an idempotent replay.
	const images = draft.admissionAttempted
		? (draft.submittedImages ?? input.images)
		: input.images;
	const mode = draft.admissionAttempted
		? (draft.submittedMode ?? input.mode)
		: input.mode;
	store.updateDraft(key, {
		...draft,
		pending: true,
		submittedText: text,
		submittedAttachments: input.attachments,
		submittedImages: images,
		submittedMode: mode,
		/*
		 * The SENTENCE is cleared here and the CODE is deliberately left alone, and
		 * the asymmetry is a decision rather than an oversight (review round 1,
		 * R-4, which asked for the choice to be stated).
		 *
		 * Clearing both would hand the two refusals that raise a sentence with NO
		 * code of their own - the send lock (`chat-page`'s "send it again in a
		 * moment") and the message-budget refusal - the answer `undefined`, and
		 * `withholdsRetryHint(undefined)` is false, so the composer's generic
		 * "Send it again" would render under the budget refusal, whose remedy is
		 * "remove an image or split the message". That is the D13 defect (a hint
		 * instructing the action the refusal forbids) reintroduced on a path this
		 * PR does not touch, one line below the fix for it.
		 *
		 * Leaving it alone has a cost, and it is the mirror image: a code-less
		 * refusal falling through after a store refusal inherits these codes and
		 * loses a hint that would have been TRUE there. It is the benign direction
		 * - the send-lock sentence carries its own retry instruction in words
		 * ("send it again in a moment"), so what is lost is a redundant line and
		 * never a wrong instruction - and the fix that would remove it entirely is
		 * for those two sites to carry codes of their own, which is a change to a
		 * third refusal family (its own copy and its own evidence) rather than a
		 * line of remediation here.
		 */
		error: undefined,
	});
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
		const rendered = beforeAdmission
			? ((await beforeAdmission(id)) ?? text)
			: text;
		store.updateDraft(key, { admissionAttempted: true });
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
			draft.admissionRequestId,
			rendered,
			images.map((image, index) => ({
				// Same id shape `extractImages` gives the owner's row, so the
				// coalesced record keeps its image keys across the swap.
				id: `${draft.admissionRequestId}:${index}`,
				data: image.data_b64,
				attachment: null,
				mimeType: image.mime_type,
			})),
			onEchoPainted,
		);
		inFlight = "sessions.message";
		await desktopResult({
			op: "sessions.message",
			sessionId: id,
			requestId: draft.admissionRequestId,
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
		/*
		 * ONE definition of "nothing was admitted", read by both consumers below.
		 *
		 * A second copy is how the retraction and the `admissionAttempted`
		 * un-latch drift apart, and they must not: they are answers to the same
		 * question. 413 and 422 are raised before the prompt reaches the session
		 * (the reasoning is spelled out on the un-latch below), so the message
		 * provably does not exist on the owner and the echo must go.
		 *
		 * Every OTHER failure keeps the echo painted, which looks wrong and is
		 * not: the outcome is unknowable, the owner may have admitted the command
		 * before the response was lost, and retracting would make a message the
		 * agent is about to answer vanish from the transcript. An echo that
		 * outlives a genuinely failed send is harmless — the SSE snapshot is
		 * authoritative and repaints from `applyHistoryPage`, while
		 * `dropLiveRecords` deliberately does not remove user rows.
		 */
		const refusedBeforeAdmission = isRefusedBeforeAdmission(error);
		if (refusedBeforeAdmission && id) {
			retractPendingUser(id, draft.admissionRequestId);
		}
		// One owner for one failure. `createSession` sets the page-level `error`
		// AND rethrows, so the same sentence rendered twice - once at the top of
		// the chat column and once at the composer. The composer's copy is the
		// actionable one (it sits on the text that failed and carries the
		// remedies), so the send takes the message over and clears the other.
		useCanonicalSessionsStore.setState({ error: null });
		// Gated on the request that actually failed: a create-stage 422 is about the
		// create fields and must keep its own diagnosis (round 5, R13).
		const leadingSlash =
			inFlight === "sessions.message" && isLeadingSlashRefusal(error, text);
		/*
		 * ONE resolution of the failure's code, read by the two fields below.
		 *
		 * A leading-slash refusal has no code of its own on the wire (the 422's
		 * `detail` is a plain string), so it is classified from the payload we sent.
		 * Every other refusal states itself. Resolved once because `errorCode` (this
		 * attempt's verdict, which a dismissal clears) and `heldClaimCode` (the
		 * claim's, which survives one) must not be two readings of one failure that
		 * can part - the claim would then carry a code no refusal ever produced.
		 */
		const failureCode = leadingSlash
			? LEADING_SLASH_CODE
			: error instanceof Error &&
					"code" in error &&
					typeof error.code === "string"
				? error.code
				: undefined;
		store.updateDraft(key, {
			pending: false,
			// 413 and 422 on this path both mean the message was refused BEFORE
			// anything was admitted, which is exactly the case the flag's own
			// contract above says it must NOT cover.
			//
			// Ours are raised before `fetch` is ever called
			// (`src/main/desktop-transport.ts`): 422 is the `safeParse` of our own
			// schema, which precedes the request, and 413 is the byte-budget guard
			// immediately after it. 413 can ONLY be ours - uvicorn enforces no body
			// limit and the frame validator maps its own refusal to 409.
			//
			// 422 is different and the earlier claim here that the backend "can
			// produce neither" was FALSE: `desktop_sessions.py` raises 422 directly
			// (unknown command, invalid loop) and pydantic answers 422 for any
			// malformed body before the route runs - an empty message and a
			// 900,001-byte body both return one (round 2, Q-8). Un-latching is still
			// correct for those, because a validation refusal is decided before the
			// prompt is admitted to the session, so no work started either way. The
			// reason to un-latch is "nothing was admitted", not "the status could
			// only have come from us", and an inaccurate claim about a limit is how
			// the original bug survived review.
			//
			// 422 is listed because the schema caps `text` in CHARACTERS while the
			// pre-flight weighs BYTES: a long ASCII paste can satisfy the byte budget
			// and still fail the schema, so a 422 reaches here for a message whose
			// only fault is length (round 1, R1). The pre-flight now refuses that
			// case up front, but the latch must not depend on one guard being
			// exhaustive - anything we refuse locally has admitted nothing.
			//
			// Latching here was a trap with no exit: the banner said "send it again",
			// the unchanged-payload guard then refused any edit, and images are part
			// of that identity check - so the one action that would make the message
			// fit, removing a screenshot, was the one action forbidden. The only way
			// out was discarding the message.
			...(refusedBeforeAdmission
				? // Nothing is held on this arm (the flag's own contract above says so), so the
					// claim's verdict goes with the claim. Left behind, it would describe a
					// payload the composer no longer has (`heldText` is gated on the same
					// flag), and the next held payload would inherit a failure that is not
					// its own.
					{ admissionAttempted: false, heldClaimCode: undefined }
				: // Post-admission: the payload above is held, and THIS is the failure that
					// left it held. The fix for UX round 2's U10 is that the composer's held
					// line reads this rather than whatever refusal is on screen later.
					{ heldClaimCode: failureCode }),
			/*
			 * This attempt's own verdict, and the sentence that states it.
			 *
			 * The sentence IS cleared on the next admission while this code is
			 * deliberately not (see the asymmetry's own note below); the code is what
			 * the composer's two predicates read.
			 */
			errorCode: failureCode,
			error: leadingSlash
				? LEADING_SLASH_MESSAGE
				: userFacingMessage(error, SEND_UNCONFIRMED_MESSAGE),
		});
		// The caller's catch takes precedence over the persisted draft error in
		// the composer. Carry the same classified sentence across that boundary,
		// preserving 422 so its pre-admission retention path still restores text.
		// Keeping the original as cause also preserves the transport diagnosis.
		throw leadingSlash
			? new DesktopControlError(
					422,
					LEADING_SLASH_MESSAGE,
					error,
					LEADING_SLASH_CODE,
				)
			: error;
	}
}
type CanonicalSessionsState = {
	sessions: CanonicalSessionRow[];
	activeSessionId: string | null;
	activeDraftKey: string | null;
	drafts: Record<string, ChatDraft>;
	sessionByAgent: Record<string, string>;
	/**
	 * The session whose guard read (`sessions.get`) has not answered yet.
	 *
	 * This is the one job the removed `pendingSessionId` still had that the view
	 * needs: it is what refuses a send addressed to a session the app has NOT yet
	 * confirmed exists. The read window used to be gated that way, and commit-first
	 * moved the read behind the commit without moving the target's validation, so
	 * the guarantee has to survive the reordering.
	 *
	 * TWO CLOSING BOUNDS, and both are the store's to keep. The read's own answer
	 * is the first (see `openSession`), and a read that never answers still closes
	 * the window: every desktop control runs under `withDeadline` at its op's own
	 * derived budget (`desktopRequestTimeoutMs`; see `desktop-api`), and that
	 * rejection
	 * takes the same rollback path as any other failed read. The second bound is a
	 * live frame from the session's own stream - proof it exists - and
	 * `confirmSessionLive` is how the panel reports it. It is kept because it is
	 * the EARLIER bound: on a read that is merely slow it opens the gate on the
	 * session's own proof instead of at the deadline, which is the wait the
	 * deleted pending banner used to give an escape from (UX round 2, U8).
	 *
	 * A window is opened only for a switch that MOVES the view: `openSession`
	 * returns early when the target is already active and no draft is staged. The
	 * one shape that escapes it - the active row clicked while a draft IS staged,
	 * a real move because it leaves the draft - opens a window on a session the
	 * panel is already showing, and there the live-frame bound cannot fire: the
	 * panel is keyed on the session once its draft learns the id
	 * (`panelIdentityFor`), so the stream effect's `[sessionId, canonical.status]`
	 * deps are unchanged across that click and a frame that already arrived is
	 * never re-reported. That window is bounded by the read alone - its answer, or
	 * its own `withDeadline` budget when it never answers.
	 *
	 * No banner, spinner or Escape handler sits on this path any more: re-basing
	 * the old "Opening chat…/Cancel" chrome on this field would paint that banner
	 * over a panel that has already switched - the wait it named is the panel's
	 * own hydration now - and the sidebar row's selected state is the
	 * acknowledgement. What this field DOES own on screen is the bounded sentence
	 * a refused send shows in the composer's own alert row (see
	 * `SESSION_UNVALIDATED_MESSAGE`), which lives exactly as long as the window
	 * does.
	 */
	validatingSessionId: string | null;
	/**
	 * A failure of the user's own NAVIGATION, held apart from `error`, which is the
	 * CATALOGUE's health.
	 *
	 * While both were one field the rollback's failure sentence was invisible: a
	 * failed switch rolls `activeSessionId` back, which re-fires the page's
	 * `fetchSessions` effect, and `fetchSessions` clears `error` when it starts
	 * (`:553`). Measured, the sentence was written and erased 4.5-8.1 ms later, and
	 * 0 of ~1,100 sampled frames contained it - so the switch's own safety net
	 * reported a failure to nobody. A five-second poll may clear the catalogue's
	 * health; only the user can clear this, by navigating again.
	 */
	navigationError: string | null;
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
	loading: boolean;
	truncated: boolean;
	error: string | null;
	cwd: string;
	setCwd: (cwd: string) => void;
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
	 * Close the read window because proof of the session's existence arrived.
	 *
	 * See `validatingSessionId` for why this is the window's second bound: the
	 * read's answer closes it too, and a read that never answers is closed by its
	 * own deadline, but on a slow read the frame is what keeps the refusal to
	 * the stream's latency instead of the deadline. Guarded on the id, so a
	 * snapshot belonging to an abandoned target cannot vouch for the session the
	 * user is actually on.
	 */
	confirmSessionLive: (sessionId: string | null) => void;
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
	/**
	 * Drop the unchanged-payload claim while KEEPING the draft row.
	 *
	 * `discardDraft` deletes the whole row, which is right when the user
	 * abandons the message. It is wrong for the case that produced this: the
	 * user typed something else and wants that to send. Deleting the row there
	 * would also drop `sessionId` and the request ids, so the retry would create
	 * a second session for a conversation that already has one. This releases
	 * exactly the claim - `admissionAttempted` and the submitted payload - and
	 * leaves identity intact.
	 */
	releaseClaim: (key: string) => void;
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
let navigationGeneration = 0;
let refreshGeneration = 0;

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
			navigationError: null,
			loading: false,
			truncated: false,
			statusUnavailable: [],
			error: null,
			cwd: "~",
			setCwd: (cwd) => set({ cwd }),
			fetchSessions: async (limit = 500) => {
				const generation = ++refreshGeneration;
				set({ loading: true, error: null });
				try {
					const result = await desktopResult<{
						sessions: BackendSessionRow[];
						truncated?: boolean;
						/**
						 * The reads the daemon could not answer, additive and optional. A
						 * daemon that sends nothing here is one that answered all of them.
						 */
						degraded?: string[];
					}>({ op: "sessions.list", limit });
					if (generation !== refreshGeneration) return;
					const rows = result.sessions.map(({ id, name, mtime, ...rest }) => ({
						...rest,
						session_id: id,
						title: name,
						updated_at: mtime,
					}));
					set((state) => ({
						sessions: replaceSessionRows(state.sessions, rows),
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
					}));
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
				++navigationGeneration;
				set({
					activeSessionId,
					activeDraftKey: null,
					validatingSessionId: null,
					navigationError: null,
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
				 */
				if (get().activeSessionId === sessionId && !get().activeDraftKey)
					return true;
				const generation = ++navigationGeneration;
				/*
				 * COMMIT FIRST, VALIDATE BEHIND THE COMMIT.
				 *
				 * This used to await the `sessions.get` guard read before touching
				 * `activeSessionId`, which put a whole IPC-plus-HTTP round trip on the
				 * critical path of every switch: the panel only mounted - and the
				 * transcript subscription only opened - AFTER the read came back, and
				 * until then the user kept looking at the conversation they were
				 * leaving with an "Opening chat…" banner over it. Measured on
				 * `scripts/session-switch-latency.mjs`, that serialisation is the whole
				 * of `click → committed` (0.1 ms of it is the store write; the rest is
				 * the read), and the hydration that follows is unchanged either way.
				 *
				 * So the intent is committed now and the read that used to gate it
				 * becomes what it always was for the user - a check whose result is
				 * never rendered. What it still owns is the FAILURE path, and that is
				 * the reason it cannot simply be deleted: `sessions.get` is the only
				 * thing that tells us the target exists. A read that fails puts the view
				 * back exactly where it was - previous session AND previous draft - so a
				 * switch to a session that is gone ends as an error with the outgoing
				 * conversation still on screen, never as a chat index that does not
				 * open.
				 *
				 * What is deliberately NOT dropped:
				 *
				 * - The generation guard, in both directions. A second click bumps
				 *   `navigationGeneration`, so a slow first read neither clears the
				 *   newer switch's state nor rolls it back when it fails.
				 * - The pending BANNER is gone, and with it the three sites that could no
				 *   longer render once this path stopped setting a pending id: the
				 *   "Opening chat…/Cancel" row over the panel, its Escape handler and the
				 *   sidebar row's spinner. Holding that banner would paint "Opening chat…"
				 *   over a panel that has already switched, beside the panel's own
				 *   hydration placeholder that says the same thing honestly; the sidebar
				 *   row's own selected state is the immediate acknowledgement, and it is a
				 *   property of the commit rather than of a timer.
				 *
				 * - What the pending id ALSO did is kept, under its real name. It gated a
				 *   send for the duration of the read, and commit-first moved the read
				 *   behind the commit rather than removing it, so `validatingSessionId`
				 *   carries that half: while the target's existence is unverified a send
				 *   addressed to it is refused (the composer keeps the text) instead of
				 *   being issued at a session that may be gone. Nothing paints it, so no
				 *   unreachable affordance comes back with it.
				 *
				 * The composer is enabled during HYDRATION, exactly as it already was:
				 * clearing the pending flag at the commit used to happen one round trip
				 * BEFORE the transcript arrived, so that window is not new, it just starts
				 * earlier. The READ window is the one that was gated, and that gate is the
				 * `validatingSessionId` refusal rather than a disabled composer, because
				 * the panel has already told the user they are in the target and the two
				 * can only disagree for one round trip.
				 */
				const previous = {
					activeSessionId: get().activeSessionId,
					activeDraftKey: get().activeDraftKey,
				};
				set({
					activeSessionId: sessionId,
					activeDraftKey: null,
					validatingSessionId: sessionId,
					navigationError: null,
					error: null,
				});
				try {
					await desktopResult({ op: "sessions.get", sessionId });
					/*
					 * A newer intent owns the view by the time this read answers, so this
					 * call reports `false`.
					 *
					 * The return value is what a caller acts on. `select` writes the URL at
					 * the click and uses a `false` from HERE to put it back where the store
					 * rolled back to; the command palette and `rebind` still navigate on a
					 * `true`. Reporting `true` for a superseded read would navigate the user
					 * to the session they have already left, and reporting `false` for a
					 * successful one would put the address bar back behind the view. The
					 * commit above was latest-wins by construction - an older read cannot
					 * re-commit an older target - so this is the same rule read outwards,
					 * not a second one.
					 */
					if (generation !== navigationGeneration) return false;
					// The read answered for THIS intent, so the target is no longer
					// unverified - and only this intent may clear the flag: a late success
					// must not vouch for a newer target nobody has read yet.
					if (get().validatingSessionId === sessionId)
						set({ validatingSessionId: null });
					return true;
				} catch (error) {
					// Only the latest intent may roll back: a user who has already
					// clicked elsewhere is not waiting on this read, and undoing their
					// switch would be a worse lie than the one this path exists to
					// avoid.
					if (generation === navigationGeneration)
						set({
							/*
							 * RE-VALIDATE THE SNAPSHOT AGAINST THE STORE IT IS WRITTEN INTO.
							 *
							 * `previous` was captured at the click and the guard read is an
							 * arbitrary window, so anything the user did inside it has already
							 * happened by the time this runs. The one thing that can happen to
							 * the OUTGOING draft is that it FINISHES: a send in flight when the
							 * row was clicked lands, `finishDraft` deletes the row and moves
							 * `activeSessionId` only while the view is still on that draft -
							 * which the commit above has just made false. Restoring the key
							 * verbatim then leaves the view on a draft row that no longer
							 * exists (`drafts[key]` undefined, the panel keyed on a dead draft),
							 * and a send from it mints a FRESH `createRequestId` (`:281-285`)
							 * and opens a SECOND session for a conversation that already has
							 * one - with the first now unreachable from the view. The identical
							 * interleaving on the pre-change store ended coherently, so that is
							 * a regression this path introduced rather than an inherited quirk.
							 *
							 * So the snapshot is a candidate, not an instruction: the draft half
							 * is restored only if its row survived. The SESSION half is restored
							 * unconditionally, because the read only ever disproved the TARGET -
							 * nothing happened to where the user came from.
							 *
							 * The alternative fix - bumping `navigationGeneration` in
							 * `finishDraft`/`discardDraft` so a stale rollback cannot win - is
							 * wrong for every caller of this guard, not merely this one. That
							 * counter means "a newer navigation owns the view", and it is ALSO
							 * what tells a caller the switch was superseded - the `false` that
							 * `select` answers by putting the URL back where the store is. A send
							 * landing mid-read would therefore make a successful switch report
							 * `false` and hand that caller a restore it does not owe; and on
							 * failure it would skip this rollback entirely, leaving the user on a
							 * target the read has just proved is gone. Re-validating the write is the
							 * fix that is correct for every caller.
							 *
							 * Deliberately NOT done: rebinding to whatever session the finished
							 * draft materialised. That id is passed to `finishDraft` and dropped
							 * with the row, so reading it here would need a second channel from
							 * `finishDraft` back into navigation - a field whose only writer is
							 * this rare interleaving. The fallback is coherent instead: with no
							 * draft and no previous session the page renders its "Start a chat"
							 * landing, and the session the send created is in the catalogue the
							 * sidebar is already re-reading.
							 */
							activeSessionId: previous.activeSessionId,
							activeDraftKey:
								previous.activeDraftKey !== null &&
								get().drafts[previous.activeDraftKey] !== undefined
									? previous.activeDraftKey
									: null,
							validatingSessionId: null,
							/*
							 * The third catch in this file, and the last one holding the
							 * transport's raw message: a refused desktop read greeted the
							 * user with the server's own sentence about itself (review round
							 * 3). Same seam as the other two.
							 */
							navigationError: storeErrorMessage(
								error,
								"Chat could not open. Retry.",
							),
						});
					return false;
				}
			},
			stageDraft: (target, fresh = false) => {
				++navigationGeneration;
				const key =
					!fresh && target
						? `draft:${target.kind}:${target.name}`
						: `draft:${crypto.randomUUID()}`;
				const existing = get().drafts[key];
				set((state) => ({
					activeDraftKey: key,
					validatingSessionId: null,
					navigationError: null,
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
			releaseClaim: (key) =>
				set((state) => {
					const draft = state.drafts[key];
					if (!draft) return {};
					const {
						admissionAttempted: _attempted,
						submittedText: _text,
						submittedAttachments: _attachments,
						submittedImages: _images,
						submittedMode: _mode,
						// The claim's own verdict ends with the claim it describes: it is a fact
						// about the payload being released, so keeping it past the release would
						// let the next held payload inherit this one's register (UX round 2,
						// U10's own failure mode, one level down).
						heldClaimCode: _claimCode,
						error: _error,
						errorCode: _errorCode,
						...kept
					} = draft;
					return {
						drafts: {
							...state.drafts,
							// A fresh admission id with the claim: the abandoned one may
							// still be executing on the owner, and reusing it would make the
							// next (different) message an idempotent REPLAY of the old
							// payload - the server keys its receipt on the request id and
							// would answer with the first attempt's result.
							[key]: { ...kept, admissionRequestId: crypto.randomUUID() },
						},
					};
				}),
			bindSession: (_legacyAgentId, sessionId) =>
				get().setActiveSession(sessionId),
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
