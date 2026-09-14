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
import {
	type CompletionAttention,
	type SessionBinding,
	type SessionCatalogueStatus,
	mergeCompletionAttention,
} from "../../../../shared/desktop-session-contract";

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
	pending?: boolean;
	error?: string;
	errorCode?: string;
	submittedText?: string;
	submittedAttachments?: string[];
	submittedImages?: ChatImage[];
	submittedMode?: "prompt" | "steer";
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
export const SEND_UNCONFIRMED_MESSAGE =
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
 * The composer needs no code-specific remedy for it - the standard retry hint
 * is already true (the text never left the box) - but `chat-page` needs the
 * code to retire the notice when the window it describes closes, the same way
 * `unresolved_attachment` retires its own on an observable condition.
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
 * do - the composer appends its own "Your message is still in the composer.
 * Send it again." because the text genuinely never left the box.
 */
export const SESSION_UNVALIDATED_MESSAGE =
	"This chat is not ready for messages yet, so the message was not sent.";

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
 * The precedence is `id ?? draftKey` and NOT the reverse. A draft learns its
 * session id mid-send (the store patches it before the message POST), so
 * keying on the draft made admission a REMOUNT: the subscription opened during
 * the engage wait was discarded, a second SSE handshake was paid, and the
 * backend recomputed a full snapshot before the stream's first frame — all
 * landing exactly where the user expects to see the message they just sent.
 * The draft key and the session id name the same conversation from either side
 * of admission, so keying on the session makes the flip a no-op.
 *
 * The reverse direction still remounts, correctly: "New chat" stages a draft
 * with no session id, so `id` is undefined and the new draft key wins. That IS
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
		error: undefined,
	});
	// Declared outside the try because the catch needs it to address the echo:
	// `draft` is the pre-send snapshot, so reading `draft.sessionId` there would
	// miss a session this very call created and leave its echo unretractable.
	let id = sessionId ?? draft.sessionId;
	try {
		if (!id) {
			id =
				(await store.createSession(
					input.cwd,
					draft.target,
					draft.createRequestId,
				)) ?? undefined;
			if (!id)
				throw new UserFacingError(
					useCanonicalSessionsStore.getState().error ?? "Chat could not start.",
				);
			store.updateDraft(key, { sessionId: id });
		}
		// From here the outcome is unknowable on failure: the owner may have
		// admitted the command before the response was lost.
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
			text,
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
		await desktopResult({
			op: "sessions.message",
			sessionId: id,
			requestId: draft.admissionRequestId,
			text,
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
			...(refusedBeforeAdmission ? { admissionAttempted: false } : {}),
			errorCode:
				error instanceof Error &&
				"code" in error &&
				typeof error.code === "string"
					? error.code
					: undefined,
			error: userFacingMessage(error, SEND_UNCONFIRMED_MESSAGE),
		});
		throw error;
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
	 * is the first (see `openSession`). The second is a live frame from the
	 * session's own stream - proof it exists, arriving earlier than the read when
	 * the backend is slow, and the ONLY bound when the read never answers at all;
	 * `confirmSessionLive` is how the panel reports that frame. A window bounded
	 * only by the read would refuse every send from the panel for as long as a
	 * hung read lasts, which is the state the deleted pending banner used to give
	 * an escape from (UX round 2, U8).
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
	) => Promise<string | null>;
	setActiveSession: (sessionId: string | null) => void;
	/**
	 * Close the read window because proof of the session's existence arrived.
	 *
	 * See `validatingSessionId` for why this is the window's second bound: the
	 * read's answer opens it too, but a live frame can arrive first, and when the
	 * read never answers this is the only thing that stops the panel refusing
	 * sends forever. Guarded on the id, so a snapshot belonging to an abandoned
	 * target cannot vouch for the session the user is actually on.
	 */
	confirmSessionLive: (sessionId: string | null) => void;
	openSession: (sessionId: string) => Promise<boolean>;
	stageDraft: (target?: ChatTarget, fresh?: boolean) => string;
	updateDraft: (key: string, patch: Partial<ChatDraft>) => void;
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
		attention: mergeCompletionAttention(
			current?.attention,
			incoming.attention,
			incoming.session_id,
		),
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
export const useCanonicalSessionsStore = create<CanonicalSessionsState>()(
	persist(
		(set, get) => ({
			sessions: [],
			activeSessionId: null,
			activeDraftKey: null,
			drafts: {},
			sessionByAgent: {},
			validatingSessionId: null,
			navigationError: null,
			loading: false,
			truncated: false,
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
					}));
				} catch (error) {
					if (generation === refreshGeneration)
						set({
							loading: false,
							error:
								error instanceof Error
									? error.message
									: "Chats could not refresh. Retry to reconnect.",
						});
				}
			},
			createSession: async (cwd, target, requestId = crypto.randomUUID()) => {
				try {
					const result = await desktopResult<{
						session_id: string;
						binding: CanonicalSessionRow["binding"];
					}>({
						op: "sessions.create",
						requestId,
						cwd,
						...(target ? { target } : {}),
					});
					get().upsertSession({
						session_id: result.session_id,
						cwd,
						binding: result.binding,
					});
					return result.session_id;
				} catch (error) {
					set({
						error:
							error instanceof Error
								? error.message
								: "Chat could not start. Retry with the same draft.",
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
			openSession: async (sessionId) => {
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
					 * The return value is what routes: `select` navigates to
					 * `/chat/<id>` only for a `true`, and without this guard a slow first
					 * read would rewrite the URL back to the session the user has already
					 * left. The commit above was latest-wins by construction - an older
					 * read cannot re-commit an older target - so this is the URL half of
					 * the same rule, not a second one.
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
							 * what suppresses the URL rewrite on success (`select` navigates
							 * only on a `true`). A send landing mid-read would therefore make a
							 * successful switch report `false` and leave `/chat/<old>` in the
							 * address bar while the panel showed the new chat; and on failure it
							 * would skip this rollback entirely, leaving the user on a target
							 * the read has just proved is gone. Re-validating the write is the
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
							navigationError:
								error instanceof Error
									? error.message
									: "Chat could not open. Retry.",
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
