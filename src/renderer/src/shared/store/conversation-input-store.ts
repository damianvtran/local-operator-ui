/**
 * Conversation Input Store
 *
 * Manages the current input draft, a log of last submitted messages, and the current history navigation index per conversation.
 * Used to persist input state and provide robust up-arrow navigation for message input.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Represents a reply to a message
 */
export type Reply = {
	id: string;
	text: string;
};

export type Attachment = {
	id: string;
	path: string;
};

/**
 * State for a single conversation's input
 */
type ConversationInputState = {
	/**
	 * The current in-progress message in the input box
	 */
	currentInput: string;
	/**
	 * The log of last submitted messages (most recent last)
	 */
	submittedMessages: string[];
	/**
	 * The current index for up/down navigation in the submittedMessages log (null = not navigating)
	 */
	currentHistoryIndex: number | null;
	/**
	 * A list of replies to be sent with the next message
	 */
	replies: Reply[];
	/**
	 * A list of attachments to be sent with the next message
	 */
	attachments: Attachment[];
	/**
	 * How many characters of `currentInput` are characters an Esc unredacted back
	 * into the composer as PLAIN TEXT, or 0/absent when the draft holds none.
	 *
	 * §6 persists the Esc-restored characters deliberately — they are the
	 * operator's prose by then — and design round 2's D2 found the other half of
	 * that decision missing: the DISCLOSURE did not survive with them, so a reload
	 * brought back a composer holding a secret with no notice, no arm and no pill,
	 * and one Enter exposed it. §5 says that state must never be silent, so the
	 * count travels with the draft it describes and the composer re-raises the
	 * same sentence on restore.
	 *
	 * A count rather than a sentence, because every phrase the app says about this
	 * state is built by one authority (`unredactedNotice`) and a stored string
	 * would be a second copy of the words. A count is also all the disclosure
	 * needs: the notice says how many characters, never which.
	 */
	unredactedChars?: number;
	/**
	 * The message that left this composer and has not been confirmed yet.
	 *
	 * WHY IT EXISTS. The composer empties at the echo (the transcript shows the
	 * message from that moment), so between the echo and the settle the payload
	 * lives nowhere the user can edit it. A quit or a crash inside that window used
	 * to restore the text without its files (the chips had already left the row),
	 * and a failed send had to keep a second copy of the payload elsewhere to hand
	 * back. Written in the same store update that clears the box, so there is no
	 * instant at which the payload is in neither place.
	 *
	 * Removed on success (`settleInFlight`). On failure, and on the first hydrate
	 * after a restart (nothing is in flight in a fresh process), it is RETURNED to
	 * the composer (`returnInFlight`), which is the only way unsent content ever
	 * comes back.
	 */
	inFlight?: SentPayload;
	/**
	 * The last payload handed back to this composer, kept so the delivery
	 * reconciliation can tell whether the box still holds exactly that message
	 * (clear it silently) or the user has since edited it (say it was delivered and
	 * leave their text alone). Dropped by the next send, by Clear and by the
	 * reconciliation itself.
	 *
	 * A REFERENCE TO WHAT THE ROW HOLDS, not a second copy of it: see
	 * `ReturnedPayload`.
	 */
	returned?: ReturnedPayload;
	/**
	 * The revision of the box's TEXT as the STORE wrote it last, bumped by every
	 * store-side write to what the user sees in the textarea.
	 *
	 * WHY A REVISION RATHER THAN COMPARING STRINGS. The composer's text lives in
	 * two places - this row (persisted, and the copy the return path and the
	 * migration write) and the hook's own state (the copy being typed into) - and a
	 * store-side write used to reach the box only through one narrow channel
	 * (`pendingText`, adopted on mount and on arrival) or not at all. That is why
	 * `Clear` and the late-delivery clear emptied the row and left the words on
	 * screen to be sent again glued to the next message, and why a write from the
	 * store could not correct an already-mounted box. The counter says "the store
	 * wrote this box" in a way a value cannot: a keystroke writes the same string
	 * back, a capture declines to write at all, and the hook only ever re-seeds the
	 * textarea when the STORE is the author of the change.
	 */
	textRevision?: number;
	/**
	 * True when the merged `pendingText` was written while a masked credential
	 * capture was open: it may BE the credential, so it must never reach disk
	 * (`partialize` drops it - see `volatileText` on the payload for the rule).
	 */
	volatilePendingText?: boolean;
	/**
	 * Returned text the box has not taken in yet.
	 *
	 * WHY THE TEXT WAITS AND THE CHIPS DO NOT. Chips and quotes are read straight
	 * from this row, so merging them here is the whole of their return. The text
	 * also lives in the composer hook's own state, which is the copy the user is
	 * typing into; the hook takes this over (`adoptReturnedText`) as soon as it is
	 * mounted for this conversation and not inside a masked credential capture.
	 * Merging into `currentInput` at return time instead would merge against a
	 * copy that is stale during a capture (the capture does not persist its
	 * keystrokes), and the capture's own write at its end would then overwrite
	 * the returned message.
	 */
	pendingText?: string;
	/**
	 * Set when a message this composer gave back turned out to have been delivered
	 * after all, but the box had been edited since so it could not simply be
	 * cleared. Drives the muted "Your earlier message was delivered." line, and
	 * goes on the next edit, send or Clear.
	 */
	lateDelivered?: LateDeliveryBox;
	/**
	 * THE DELIVERED MESSAGE'S OWN TEXT, beside the flag that says it is still in the box
	 * (review round 5, U17).
	 *
	 * `returned` cannot be where the retirement rule reads it: every state that RAISES
	 * `lateDelivered` writes `returned: undefined` - the hand-back has been resolved by
	 * then - while `returned` is only non-null on the path that clears the flag. The
	 * rule therefore read an empty string and retired the sentence on the FIRST ordinary
	 * keystroke, while the delivered words were still in the box verbatim: the exact
	 * repeat the sentence exists to warn about, reached after it had already retired
	 * itself. Carrying the text here is what lets `overlapStillTrue` answer the question
	 * it is named for.
	 */
	lateDeliveredText?: string;
};

/**
 * The last payload handed back to a composer, as a REFERENCE to what the row
 * holds rather than a second copy of it.
 *
 * WHAT WENT WRONG WITH THE BY-VALUE VERSION (review round 1, B5). This record
 * kept `attachments` and `replies` by value, and the row it described keeps the
 * same lists for the user to see and edit - so every pasted screenshot (a `data:`
 * URL, megabytes of base64) was serialised into `localStorage` TWICE, once as a
 * chip and once as this record. On a large payload that crossed the store's
 * quota: the write threw `QuotaExceededError`, the persisted row was left
 * half-written, and every reload after it showed "Something went wrong" - on a
 * payload a pristine build persisted without trouble. Measured by QA (Q-6) as a
 * merge blocker.
 *
 * So the record names what it put there - the ids of the chips it restored, in its
 * own order, and the ids of the staged quotes - and `composerHoldsExactly` asks the
 * row whether those are still exactly the things it holds. The bytes live once,
 * the predicate is the same, and a user who removes a chip (or attaches another)
 * still reads as EDITED, which is the answer that matters.
 */
export type ReturnedPayload = {
	/** The normalised text the message carried, before reply wrapping. */
	text: string;
	/** The ids of the chips this return restored, in payload order. */
	chipIds: string[];
	/** The ids of the staged quotes this return restored, in payload order. */
	replyIds: string[];
	/** See `SentPayload.volatileText`: the text must not reach disk. */
	volatileText?: boolean;
};

/**
 * Which box a late-delivery note sits over, once a handed-back message turned out
 * to have been delivered after all.
 *
 * `draft-only` is the ordinary case and the one the sentence may speak about: the
 * delivered message has been TAKEN OUT of the box (see `stripDeliveredPayload`),
 * so what is left is only what the user wrote after pressing Send - "what's here
 * now hasn't been sent" is then a fact rather than a reassurance.
 *
 * `overlap` is the case that cannot be separated: the user edited INSIDE the
 * delivered words, so which half is theirs is not knowable, and guessing would be
 * worse than leaving the box alone. The note says only that the earlier message
 * arrived, which is true either way.
 */
export type LateDeliveryBox = "draft-only" | "overlap";

/**
 * One message as the composer held it when it was sent: the box text before any
 * reply wrapping or credential substitution, the chip paths, and the staged
 * quotes. Everything needed to put the composer back exactly as it was.
 */
export type SentPayload = {
	text: string;
	attachments: string[];
	replies: Reply[];
	unredactedChars?: number;
	/**
	 * True when `text` was written while a masked credential capture was open, so
	 * it must never reach disk (`partialize` blanks it). Held in memory only; a
	 * restart in that window returns the files and quotes but not the text.
	 */
	volatileText?: boolean;
};

/**
 * Merge a returned message into what the composer holds now.
 *
 * The failed message came FIRST, so it goes first; anything typed during the
 * flight follows after a blank line and is never overwritten. Chips are a union
 * by path and quotes a union by id, returned first. Nothing is ever withheld, so
 * there is no "part of your message could not come back" state to explain.
 *
 * IDEMPOTENT: applying the same return twice (a hydrate after a crash that
 * happened after the return was written, for example) changes nothing the
 * second time. A merged box is by construction not byte-equal to the claim, so
 * its Send goes out as a new message - which it is.
 */
export function mergeReturnedText(current: string, returned: string): string {
	if (returned === "") return current;
	if (current === "") return returned;
	if (current === returned || current.startsWith(`${returned}\n\n`))
		return current;
	return `${returned}\n\n${current}`;
}

export function mergeReturnedPayload(
	current: {
		text: string;
		attachments: readonly string[];
		replies: readonly Reply[];
	},
	returned: {
		text: string;
		attachments: readonly string[];
		replies: readonly Reply[];
	},
): { text: string; attachments: string[]; replies: Reply[] } {
	const paths = [...returned.attachments];
	for (const path of current.attachments)
		if (!paths.includes(path)) paths.push(path);
	const replies = [...returned.replies];
	for (const reply of current.replies)
		if (!replies.some((kept) => kept.id === reply.id)) replies.push(reply);
	return {
		text: mergeReturnedText(current.text, returned.text),
		attachments: paths,
		replies,
	};
}

const EMPTY_ROW: ConversationInputState = {
	currentInput: "",
	submittedMessages: [],
	currentHistoryIndex: null,
	replies: [],
	attachments: [],
};

/**
 * Fold a payload back into a row: chips and quotes now, text through
 * `pendingText` (see that field for why the text waits).
 *
 * Chip ids are minted fresh for returned paths, because the chip the payload
 * left with was removed at the echo and a reused id could collide with a chip
 * attached since.
 */
function foldReturn(
	row: ConversationInputState,
	payload: SentPayload,
	mintId: () => string,
): ConversationInputState {
	const attachments = [...(row.attachments ?? [])];
	/*
	 * ONE CHIP PER SENT SLOT, AND THE REFERENCE IS THE CHIP ITSELF (review round 2's
	 * convergent blocker). This used to build the chips first and then name them by
	 * looking each payload path up with `chips.find(chip => chip.path === path)`,
	 * which is a lookup by PATH in a list that may hold the same path twice - the
	 * paste handler does not de-dupe, so the same screenshot pasted twice is two
	 * chips with one path. Both slots then named the FIRST chip, the row's own
	 * untouched payload did not match the record of it (`composerHoldsExactly`
	 * compares identities), the late-delivery arm was read as "edited", and the box
	 * kept the words that had just been delivered: the next Enter sent them again as
	 * a second row. So the mapping is built AS the chips are, positionally, and a
	 * path the row already holds names THAT chip - once, never twice.
	 */
	const returnedChips: Attachment[] = [];
	const returnedChipIds: string[] = [];
	const claimed = new Set<string>();
	for (const path of payload.attachments) {
		const kept = attachments.find(
			(chip) => chip.path === path && !claimed.has(chip.id),
		);
		if (kept) {
			claimed.add(kept.id);
			returnedChipIds.push(kept.id);
			continue;
		}
		const minted = { id: mintId(), path };
		returnedChips.push(minted);
		returnedChipIds.push(minted.id);
	}
	const replies = [...(row.replies ?? [])];
	const returnedReplies = payload.replies.filter(
		(reply) => !replies.some((kept) => kept.id === reply.id),
	);
	const text = payload.text;
	/*
	 * The chip and quote IDS the payload's paths and quotes now live under, read
	 * back off the row this fold has just built. A path already present keeps its
	 * existing chip (and therefore answers with that chip's id), which is what makes
	 * the reference equal to the payload it describes rather than to the ids this
	 * call happened to mint.
	 */
	const chips = [...returnedChips, ...attachments];
	const mergedReplies = [...returnedReplies, ...replies];
	return {
		...row,
		attachments: chips,
		replies: mergedReplies,
		textRevision: (row.textRevision ?? 0) + 1,
		/*
		 * Conservation, not precision: if ANY of the merged text was written inside a
		 * masked capture then the whole of it stays off disk. Losing a non-secret
		 * draft on restart is the cheap direction; writing a credential is not.
		 */
		volatilePendingText:
			row.volatilePendingText === true || payload.volatileText === true,
		pendingText:
			text === ""
				? row.pendingText
				: mergeReturnedText(row.pendingText ?? "", text),
		// The disclosure travels with the characters it describes (see
		// `unredactedChars`), so a returned draft re-raises it.
		unredactedChars: Math.max(
			row.unredactedChars ?? 0,
			payload.unredactedChars ?? 0,
		),
		returned: {
			text,
			chipIds: returnedChipIds,
			replyIds: payload.replies
				.map((reply) => mergedReplies.find((kept) => kept.id === reply.id)?.id)
				.filter((id): id is string => id !== undefined),
			volatileText: payload.volatileText,
		},
		inFlight: undefined,
		lateDelivered: undefined,
	};
}

/**
 * Whether the `overlap` note is still true of the box the user is now typing in.
 *
 * The sentence says the DELIVERED message's words are still in the composer, which
 * stops being true the moment the user deletes them - and a promise about a box
 * that no longer exists is worse than no sentence at all because the user can see
 * it is not there (UX round 4, U17). Only the `overlap` arm is asked: on
 * `draft-only` the delivered words have already left the box, so that note is about
 * the delivery rather than the contents and stays true however the box changes.
 */
function overlapStillTrue(row: ConversationInputState, next: string): boolean {
	/*
	 * `lateDeliveredText`, not `returned.text`: the two are never both set - see the
	 * field's own note for why reading `returned` here retired the sentence on the first
	 * keystroke. A row with neither cannot answer the question, so the note stays rather
	 * than retiring on an empty string.
	 */
	const delivered = row.lateDeliveredText ?? row.returned?.text;
	if (!delivered) return true;
	if (next.includes(delivered)) return true;
	/*
	 * AND A LONGER SHARE COUNTS, because the arm this rule exists for is the one where the
	 * user corrected a WORD inside the delivered text (UX round 5, U17): the sentence
	 * claims that message's words are still in the box, and a phrase of them being there
	 * is what makes that true - while a whole-string test reads a one-word correction as
	 * "gone" and retires the warning on the first keystroke, which is how the duplicate it
	 * exists to prevent was reached after the warning had already gone.
	 *
	 * A run rather than a similarity score: it is cheap, it needs no threshold to tune,
	 * and it answers the question the copy asks. The run is a THIRD of the delivered text,
	 * floored at 8 characters and capped at 24: a correction of one word inside a short
	 * message has to survive (that is the arm the round measured), while the cap keeps a
	 * long message from matching some ordinary phrase the user happens to type. The probe
	 * is bounded so a very long message costs a fixed number of substring searches rather
	 * than a quadratic one.
	 */
	const KEEP_RUN = Math.max(8, Math.min(24, Math.floor(delivered.length / 3)));
	/*
	 * EVERY OFFSET, AND THE WHOLE TEXT (review round 6, m6-1 = U19). The first version
	 * stepped by 8 over the first 400 characters, which has two holes the round measured:
	 * a run of exactly `KEEP_RUN` starting at an offset the step does not land on was read
	 * as absent (a 26-character delivered text: offset 0 kept, offset 4 retired), and a
	 * fragment that survived only in the TAIL of a long message was never tested at all.
	 * Both directions matter and only one is allowed to be wrong: a deletion removes every
	 * run, so the ending that retires the note is unchanged by closing them.
	 */
	for (let i = 0; i + KEEP_RUN <= delivered.length; i++)
		if (next.includes(delivered.slice(i, i + KEEP_RUN))) return true;
	return false;
}

/**
 * What the composer row holds right now, as one comparable payload - the text
 * the box will show once any pending return is adopted.
 */
function effectivePayload(row: ConversationInputState) {
	return {
		text: mergeReturnedText(row.currentInput ?? "", row.pendingText ?? ""),
		attachments: (row.attachments ?? []).map((chip) => chip.path),
		replies: row.replies ?? [],
	};
}

/**
 * Whether the composer row still holds exactly the message it was given back.
 *
 * The comparison is over IDENTITY and not over bytes: the record names the chips
 * and quotes it restored (see `ReturnedPayload`), and the row is asked whether
 * those are still the things it holds - all of them, in order, and nothing else.
 * A chip the user removed, a chip they added, a chip they removed and re-attached
 * (a new id) and any edit to the text all answer `false`, which is the "edited
 * since" arm the muted notice exists for.
 */
export function composerHoldsExactly(
	row: ConversationInputState | undefined,
	returned: ReturnedPayload | undefined,
): boolean {
	if (!row || !returned) return false;
	const now = effectivePayload(row);
	const chips = row.attachments ?? [];
	const replies = row.replies ?? [];
	return (
		now.text.trim() === returned.text.trim() &&
		chips.length === returned.chipIds.length &&
		chips.every((chip, i) => chip.id === returned.chipIds[i]) &&
		replies.length === returned.replyIds.length &&
		replies.every((reply, i) => reply.id === returned.replyIds[i])
	);
}

/**
 * The persisted rows as a fresh process should see them.
 *
 * Nothing is in flight in a new process, so every persisted `inFlight` is a
 * message whose send was interrupted by a quit or a crash: it goes back into
 * its composer. If it was in fact delivered, the conversation's reconciliation
 * clears it again the moment the transcript shows the message.
 *
 * Pure and exported so a test can run it over a captured serialized state.
 */
export function rehydrateInputRows(
	rows: Record<string, ConversationInputState> | undefined,
	mintId: () => string = () => crypto.randomUUID(),
): Record<string, ConversationInputState> {
	const out: Record<string, ConversationInputState> = {};
	for (const [id, row] of Object.entries(rows ?? {})) {
		out[id] = row.inFlight ? foldReturn(row, row.inFlight, mintId) : row;
	}
	return out;
}

/**
 * Store state interface
 */
type ConversationInputStoreState = {
	/**
	 * State by conversation ID
	 */
	inputByConversation: Record<string, ConversationInputState>;

	/**
	 * Adds a reply to the list of replies for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param reply - The reply to add
	 */
	addReply: (conversationId: string, reply: Reply) => void;

	/**
	 * Removes a reply from the list of replies for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param replyId - The ID of the reply to remove
	 */
	removeReply: (conversationId: string, replyId: string) => void;

	/**
	 * Clears all replies for a conversation
	 * @param conversationId - The ID of the conversation
	 */
	clearReplies: (conversationId: string) => void;

	addAttachment: (conversationId: string, attachment: Attachment) => void;

	removeAttachment: (conversationId: string, attachmentId: string) => void;

	clearAttachments: (conversationId: string) => void;

	/**
	 * Set the current input value for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param value - The input value to set
	 * @param unredactedChars - How many characters of `value` were unredacted by an
	 * Esc cancel; see {@link ConversationInputState.unredactedChars}. Defaulted to
	 * 0 by every caller that is not the composer's own capture write, so a plain
	 * draft write states "this draft discloses nothing" rather than leaving a
	 * previous disclosure pinned to text it no longer describes.
	 */
	setCurrentInput: (
		conversationId: string,
		value: string,
		unredactedChars?: number,
	) => void;

	/**
	 * How many characters of a conversation's draft are disclosed plain text.
	 * @returns 0 when the conversation holds no draft, or holds one that
	 * discloses nothing.
	 */
	getUnredactedChars: (conversationId: string) => number;

	/**
	 * Get the current input value for a conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The current input value or empty string if none exists
	 */
	getCurrentInput: (conversationId: string) => string;

	/**
	 * Add a submitted message to the log for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param message - The submitted message to add
	 */
	addSubmittedMessage: (conversationId: string, message: string) => void;

	/**
	 * Get the log of submitted messages for a conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The array of submitted messages (most recent last)
	 */
	getSubmittedMessages: (conversationId: string) => string[];

	/**
	 * Clear the submitted message log for a conversation
	 * @param conversationId - The ID of the conversation
	 */
	clearSubmittedMessages: (conversationId: string) => void;

	/**
	 * Get the current history navigation index for a conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The current history index or null if not navigating
	 */
	getCurrentHistoryIndex: (conversationId: string) => number | null;

	/**
	 * Set the current history navigation index for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param index - The index to set (null = not navigating)
	 */
	setCurrentHistoryIndex: (
		conversationId: string,
		index: number | null,
	) => void;

	/**
	 * Reset the history navigation index for a conversation (set to null)
	 * @param conversationId - The ID of the conversation
	 */
	resetCurrentHistoryIndex: (conversationId: string) => void;

	/**
	 * Clear all input state for a conversation
	 * @param conversationId - The ID of the conversation
	 */
	clearAll: (conversationId: string) => void;

	/**
	 * Move the composer's payload into `inFlight` and empty the composer, in one
	 * update: text (only if the box still holds exactly what was sent), the chips
	 * and the quotes that went with it. `record: false` is the plain retire for a
	 * send that never echoes (a slash command, a gate answer): nothing is left in
	 * flight because nothing can fail back into the box.
	 */
	beginInFlight: (
		conversationId: string,
		payload: {
			text: string;
			attachments: readonly Attachment[];
			replies: readonly Reply[];
			volatileText?: boolean;
		},
		record?: boolean,
	) => void;

	/** The send landed: nothing is in flight or waiting to be reconciled. */
	settleInFlight: (conversationIds: readonly string[]) => void;

	/**
	 * Hand an unconfirmed message back to its composer.
	 *
	 * `from` is the identity the composer had when it sent, `to` the one the
	 * conversation lives under now - they differ after the New-chat identity flip
	 * (`draft:<uuid>` becomes the session id). Whatever the `from` row still holds
	 * moves across with the in-flight payload, so nothing is stranded under an
	 * identity no pane will show again.
	 */
	returnInFlight: (from: string, to: string) => void;

	/**
	 * Take any returned text into the box: merges it with the text the composer
	 * holds now, writes the result back, and returns it for the hook to show.
	 * `null` when nothing was waiting.
	 */
	adoptReturnedText: (conversationId: string) => string | null;

	/**
	 * Put a payload back into a composer that has no send in flight - the one-time
	 * migration of a message the previous release held outside the composer.
	 */
	returnPayload: (conversationId: string, payload: SentPayload) => void;

	/**
	 * A message that was handed back turned out to be delivered. When the
	 * composer still holds exactly that message it is emptied silently; otherwise
	 * the user's edits are kept and `lateDelivered` is raised.
	 */
	reconcileDelivered: (conversationId: string) => void;

	/** Clear: text, chips, quotes, any waiting return and the delivered note. */
	clearComposer: (conversationId: string) => void;

	/**
	 * Drop the late-delivery note. It is a statement about one message, so it
	 * goes on the first thing the user does with the composer (an edit, a send, a
	 * clear) rather than on a timer.
	 */
	dismissLateDelivery: (conversationId: string) => void;
};

/**
 * Take the delivered message OUT of a box that is not exactly it.
 *
 * THE RULE THE SECONG DUPLICATE SURVIVED ON (review round 2, R2/U1, one defect the
 * reviewer and the UX round found from two directions). A handed-back message that
 * turns out to have been delivered leaves the box holding the message that has
 * just gone - the merge wrote it first - plus whatever the user typed after it.
 * Keeping both is what made the next press a SECOND row carrying the delivered
 * words, and the only way to send the user's own line was to send the whole box.
 * So the delivered text, and the chips and quotes it restored, come back OUT - by
 * IDENTITY, so a chip the user attached afterwards is untouched - and what is left
 * is the user's own draft.
 *
 * The text is only removable while it is still the block the merge wrote: a user
 * who edited inside the delivered words has made a new message of them, and
 * guessing which half is which would be worse than leaving it (see
 * `LateDeliveryBox`). On that arm the delivered WORDS stay in the box and the
 * delivered CHIPS AND QUOTES still come out - their ids are known, so they are not
 * unknowable - and the note says which box the user is looking at
 * (`lateDeliveryOverlap`), because a next Send there repeats the sentence they
 * already sent and only the copy can warn about it (review round 3, m1 + D8).
 */
function stripDeliveredPayload(
	row: ConversationInputState,
	returned: ReturnedPayload,
): { row: ConversationInputState; box: LateDeliveryBox } {
	const placed = returned.text;
	const boxed = mergeReturnedText(
		row.currentInput ?? "",
		row.pendingText ?? "",
	);
	let text = boxed;
	let box: LateDeliveryBox = "overlap";
	if (placed === "") {
		box = "draft-only";
	} else if (boxed.startsWith(placed)) {
		/*
		 * A PREFIX IS THE WHOLE TEST, and no separator is assumed. The user types
		 * after the returned message wherever their caret is - straight on, or after
		 * one Enter, or after two - and `mergeReturnedText` only writes the blank line
		 * when IT composed the merge. Requiring that exact separator made the ordinary
		 * case (the caret at the end of the returned text, typing straight on) read as
		 * "edited", which is the arm the duplicate survives in. What is left after the
		 * delivered text is the user's own draft, however they spaced it, so only the
		 * line breaks IMMEDIATELY after it are dropped - never their indentation.
		 *
		 * A CHOSEN LIMIT, and it is the user's own overwrite that meets it (review
		 * round 3, m2): a user who selects all and retypes a line whose opening happens
		 * to be the delivered message's opening loses that opening here, because a
		 * prefix match cannot tell "typed after" from "typed the same thing again".
		 * Nothing untrue follows - what remains really is unsent - so this is a boundary
		 * worth knowing rather than a case worth guessing at, and the alternative
		 * (byte-comparing spacing the user may have moved) fails the ordinary arm this
		 * test exists for.
		 */
		text = boxed.slice(placed.length).replace(/^\n+/, "");
		box = "draft-only";
	}
	const chipIds = new Set(returned.chipIds);
	const replyIds = new Set(returned.replyIds);
	return {
		row: {
			...row,
			currentInput: text,
			pendingText: undefined,
			attachments: (row.attachments ?? []).filter(
				(chip) => !chipIds.has(chip.id),
			),
			replies: (row.replies ?? []).filter((reply) => !replyIds.has(reply.id)),
			/*
			 * The disclosure rides the characters it describes: the characters that
			 * carried it are the ones being taken out.
			 */
			unredactedChars: placed === "" ? (row.unredactedChars ?? 0) : 0,
		},
		box,
	};
}

/**
 * Maximum number of submitted messages to keep in the log per conversation
 */
const MAX_SUBMITTED_MESSAGES = 20;

/**
 * Zustand store implementation
 */
export const useConversationInputStore = create<ConversationInputStoreState>()(
	persist(
		(set, get) => ({
			inputByConversation: {},

			addReply: (conversationId, reply) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [],
				};
				const existingReplies = Array.isArray(existing.replies)
					? existing.replies
					: [];
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							replies: [...existingReplies, reply],
						},
					},
				});
			},

			removeReply: (conversationId, replyId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							replies: existing.replies.filter((r) => r.id !== replyId),
						},
					},
				});
			},

			clearReplies: (conversationId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							replies: [],
						},
					},
				});
			},

			addAttachment: (conversationId, attachment) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [],
				};
				const existingAttachments = Array.isArray(existing.attachments)
					? existing.attachments
					: [];
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							attachments: [...existingAttachments, attachment],
						},
					},
				});
			},

			removeAttachment: (conversationId, attachmentId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							attachments: existing.attachments.filter(
								(a) => a.id !== attachmentId,
							),
						},
					},
				});
			},

			clearAttachments: (conversationId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							attachments: [],
						},
					},
				});
			},

			setCurrentInput: (
				conversationId: string,
				value: string,
				unredactedChars = 0,
			) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [],
				};
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							/*
							 * THE `overlap` SENTENCE RETIRES WITH THE WORDS IT DESCRIBES (UX round 4,
							 * U17). It says the delivered message's words are still in the box,
							 * which stops being true the moment the user deletes them - and a
							 * sentence about a box that no longer exists is the app describing a
							 * state the user can see is not there. Only the `overlap` arm clears
							 * this way: on `draft-only` the delivered words are already out, so the
							 * note is about the DELIVERY and stays true however the box changes.
							 */
							lateDelivered:
								existing.lateDelivered === "overlap" &&
								!overlapStillTrue(existing, value)
									? undefined
									: existing.lateDelivered,
							currentInput: value,
							/*
							 * AN EMPTY DRAFT DISCLOSES NOTHING, enforced here rather than at each
							 * writer so it cannot be forgotten by one of them: the sentence says
							 * "N characters are now PLAIN TEXT in the composer", and a box holding
							 * no characters cannot be holding N of them. That is reachable
							 * through the ordinary edit path — the operator selects all and
							 * deletes, which writes the empty draft with the disclosure still in
							 * hand — and a restored notice over an empty box is a claim about
							 * nothing.
							 */
							unredactedChars: value ? unredactedChars : 0,
						},
					},
				});
			},

			getUnredactedChars: (conversationId) =>
				get().inputByConversation[conversationId]?.unredactedChars || 0,

			getCurrentInput: (conversationId) => {
				return get().inputByConversation[conversationId]?.currentInput || "";
			},

			addSubmittedMessage: (conversationId, message) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [],
				};
				// Avoid duplicate consecutive entries
				const last =
					existing.submittedMessages[existing.submittedMessages.length - 1];
				const newMessages =
					message && message !== last
						? [
								...existing.submittedMessages.slice(
									-MAX_SUBMITTED_MESSAGES + 1,
								),
								message,
							]
						: existing.submittedMessages;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							submittedMessages: newMessages,
						},
					},
				});
			},

			getSubmittedMessages: (conversationId) => {
				return (
					get().inputByConversation[conversationId]?.submittedMessages || []
				);
			},

			clearSubmittedMessages: (conversationId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							submittedMessages: [],
						},
					},
				});
			},

			getCurrentHistoryIndex: (conversationId) => {
				return (
					get().inputByConversation[conversationId]?.currentHistoryIndex ?? null
				);
			},

			/**
			 * Set the current history navigation index for a conversation, clamped to valid range.
			 * @param conversationId - The ID of the conversation
			 * @param index - The index to set (null = not navigating)
			 */
			setCurrentHistoryIndex: (conversationId, index) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [],
				};
				const messages = existing.submittedMessages;
				let clampedIndex: number | null = null;
				if (typeof index === "number" && messages.length > 0) {
					clampedIndex = Math.max(0, Math.min(index, messages.length - 1));
				}
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							currentHistoryIndex: clampedIndex,
						},
					},
				});
			},

			resetCurrentHistoryIndex: (conversationId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							currentHistoryIndex: null,
						},
					},
				});
			},

			clearAll: (conversationId) => {
				const { [conversationId]: _, ...rest } = get().inputByConversation;
				set({
					inputByConversation: rest,
				});
			},

			beginInFlight: (conversationId, payload, record = true) => {
				const row = get().inputByConversation[conversationId] ?? EMPTY_ROW;
				const chipIds = new Set(payload.attachments.map((chip) => chip.id));
				const replyIds = new Set(payload.replies.map((reply) => reply.id));
				const textLeaves = row.currentInput === payload.text;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...row,
							currentInput: textLeaves ? "" : row.currentInput,
							unredactedChars: textLeaves ? 0 : row.unredactedChars,
							/*
							 * The echo took the text out of the box, so the store is the author of a
							 * box write and says so - the composer that pressed clears itself on the
							 * echo's paint (see `onEchoPainted`), and this is what reaches a composer
							 * that was remounted under the press, where nothing else would.
							 */
							textRevision: textLeaves
								? (row.textRevision ?? 0) + 1
								: row.textRevision,
							attachments: (row.attachments ?? []).filter(
								(chip) => !chipIds.has(chip.id),
							),
							replies: (row.replies ?? []).filter(
								(reply) => !replyIds.has(reply.id),
							),
							inFlight: record
								? {
										text: payload.text,
										attachments: payload.attachments.map((chip) => chip.path),
										replies: [...payload.replies],
										unredactedChars: textLeaves ? row.unredactedChars : 0,
										volatileText: payload.volatileText,
									}
								: row.inFlight,
							// A new send supersedes the last returned message and its note.
							returned: undefined,
							lateDelivered: undefined,
						},
					},
				});
			},

			settleInFlight: (conversationIds) => {
				const rows = { ...get().inputByConversation };
				let changed = false;
				for (const id of conversationIds) {
					const row = rows[id];
					if (!row || (!row.inFlight && !row.returned)) continue;
					rows[id] = { ...row, inFlight: undefined, returned: undefined };
					changed = true;
				}
				if (changed) set({ inputByConversation: rows });
			},

			returnInFlight: (from, to) => {
				const rows = { ...get().inputByConversation };
				const source = rows[from];
				const payload = source?.inFlight ?? rows[to]?.inFlight;
				let target = rows[to] ?? EMPTY_ROW;
				if (from !== to && source) {
					/*
					 * The identity flip: the pane that sent is gone, and anything its row
					 * still holds (text that never reached the echo, chips attached during
					 * the create hop) belongs to the conversation that now exists.
					 */
					target = foldReturn(
						target,
						{
							text: source.currentInput ?? "",
							attachments: (source.attachments ?? []).map((chip) => chip.path),
							replies: source.replies ?? [],
							unredactedChars: source.unredactedChars,
						},
						() => crypto.randomUUID(),
					);
					target = { ...target, returned: rows[to]?.returned };
					delete rows[from];
				}
				if (payload)
					target = foldReturn(target, payload, () => crypto.randomUUID());
				if (!payload && from === to) return;
				rows[to] = target;
				set({ inputByConversation: rows });
			},

			adoptReturnedText: (conversationId) => {
				const row = get().inputByConversation[conversationId];
				if (row?.pendingText === undefined) return null;
				// Against the persisted text rather than the hook's state: the hook's
				// state is one render behind on a fresh mount (its initialiser has
				// only just asked for the persisted value), and outside a capture the
				// two are the same text because every keystroke writes it here.
				const merged = mergeReturnedText(
					row.currentInput ?? "",
					row.pendingText,
				);
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...row,
							currentInput: merged,
							pendingText: undefined,
							/*
							 * A store-side write of the box, so the revision moves: the hook
							 * mirrors it, which is what makes the adopted text the textarea's
							 * text rather than a value held in one place and shown in another.
							 */
							textRevision: (row.textRevision ?? 0) + 1,
						},
					},
				});
				return merged;
			},

			returnPayload: (conversationId, payload) => {
				const row = get().inputByConversation[conversationId] ?? EMPTY_ROW;
				if (row.inFlight) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: foldReturn(row, payload, () =>
							crypto.randomUUID(),
						),
					},
				});
			},

			reconcileDelivered: (conversationId) => {
				const row = get().inputByConversation[conversationId];
				if (!row) return;
				/** Nothing of anybody's on screen: no chips, no quotes, no text. */
				const empty = (candidate: ConversationInputState) =>
					(candidate.currentInput ?? "") === "" &&
					(candidate.attachments ?? []).length === 0 &&
					(candidate.replies ?? []).length === 0;
				const hadPayload =
					row.returned !== undefined || row.inFlight !== undefined;
				/*
				 * TWO ARMS, and both are about what is ON SCREEN. A row handed the payload
				 * back compares against the record of it (`composerHoldsExactly`); a row
				 * with nothing handed back - the send never came home, or the user cleared
				 * it - is silent when the composer holds nothing of anybody's, which is the
				 * same "nothing to clear, nothing to say" answer without a payload to
				 * compare against.
				 *
				 * AND A THIRD THAT IS NOW SEPARATED FROM BOTH (review round 2, R2/U1). A
				 * row that is NOT the delivered payload is not necessarily "edited": it is
				 * usually the delivered message PLUS the user's own next line, because the
				 * merge wrote the message first and the user kept typing. Clearing that box
				 * would take their words away; keeping it whole gave the next press the
				 * delivered words to send a second time, and the round reproduced exactly
				 * that (row a9cbe9bf, then c47f3028). So the delivered payload comes OUT -
				 * see `stripDeliveredPayload` - and the note says which of the two boxes it
				 * is over, because only one of them can be told "what's here now hasn't
				 * been sent".
				 */
				const exact = row.returned
					? composerHoldsExactly(row, row.returned)
					: empty(row);
				const stripped = row.returned
					? stripDeliveredPayload(row, row.returned)
					: null;
				const cleared: ConversationInputState = {
					...row,
					currentInput: "",
					unredactedChars: 0,
					attachments: [],
					replies: [],
					pendingText: undefined,
					returned: undefined,
					inFlight: undefined,
					lateDelivered: undefined,
					/*
					 * AND ITS TEXT WITH IT (review round 7, R7-1). The gate in `partialize` keys
					 * on `volatilePendingText`, which this row RESETS, so a copy left here
					 * outlives the flag that guarded it: the masked-capture secret was measured
					 * landing in localStorage and staying there through every later write, with
					 * the note gone. `dismissLateDelivery` already drops the pair; this is the
					 * same shape on the two paths that clear a row without dismissing a note.
					 */
					lateDeliveredText: undefined,
					volatilePendingText: undefined,
					textRevision: (row.textRevision ?? 0) + 1,
				};
				const kept: ConversationInputState =
					stripped && !empty(stripped.row)
						? {
								...stripped.row,
								returned: undefined,
								inFlight: undefined,
								// Conservation, not precision: any text still in the box that was
								// written inside a masked capture keeps the whole row off disk.
								volatilePendingText:
									(stripped.row.currentInput ?? "") === ""
										? undefined
										: row.volatilePendingText,
								lateDelivered: stripped.box,
								/*
								 * The words this arm is ABOUT, carried so the note can be retired
								 * when the user deletes them and only then (U17).
								 */
								lateDeliveredText:
									stripped.box === "overlap" ? row.returned?.text : undefined,
								// The box itself moved, so the hook has to be told - the same
								// revision channel every other store-side write uses.
								textRevision: (row.textRevision ?? 0) + 1,
							}
						: {
								...row,
								returned: undefined,
								inFlight: undefined,
								// Only worth saying when something of that message is still on
								// screen for the user to wonder about.
								/*
								 * AND THE NEUTRAL SENTENCE WHEN THE TEXT IS UNKNOWN (review round 7,
								 * Q7-1). This arm is reached with `hadPayload` true and no `returned`
								 * payload - the in-flight shape - and the `overlap` copy claims that
								 * the delivered message's words are still in the box. With nothing to
								 * compare, that claim cannot be made, so the note the user gets is the
								 * muted delivered one: same fact, no claim about the box. Reusing the
								 * shipped string rather than adding one keeps this inside the copy the
								 * design round has already signed off.
								 */
								lateDelivered:
									hadPayload && row.returned?.text
										? "overlap"
										: hadPayload
											? "draft-only"
											: undefined,
								lateDeliveredText: hadPayload ? row.returned?.text : undefined,
							};
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]:
							exact || (stripped !== null && empty(stripped.row))
								? cleared
								: kept,
					},
				});
			},

			dismissLateDelivery: (conversationId) => {
				const row = get().inputByConversation[conversationId];
				if (!row?.lateDelivered) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...row,
							lateDelivered: undefined,
							lateDeliveredText: undefined,
						},
					},
				});
			},

			clearComposer: (conversationId) => {
				const row = get().inputByConversation[conversationId];
				if (!row) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...row,
							currentInput: "",
							unredactedChars: 0,
							attachments: [],
							replies: [],
							pendingText: undefined,
							volatilePendingText: undefined,
							returned: undefined,
							inFlight: undefined,
							lateDelivered: undefined,
							// Cleared for the same reason as the reconciled row: the flag this
							// copy was gated on is reset here, so the copy goes with it (R7-1).
							lateDeliveredText: undefined,
							/*
							 * THE BOX ITSELF, not only the row: the press promises the composer
							 * empties, and the words are in the textarea the hook owns. Without
							 * this the text stayed on screen with the chips and the notice gone,
							 * and the next press sent it glued to whatever was typed after it
							 * (review round 1, B2/Q-1/U3).
							 */
							textRevision: (row.textRevision ?? 0) + 1,
						},
					},
				});
			},
		}),
		{
			name: "conversation-input-store",
			/*
			 * NEVER A CREDENTIAL ON DISK. A payload written while a masked capture was
			 * open keeps its text in memory only - the same rule the keystroke path
			 * follows (`draftHeld`). `pendingText` is derived from a payload that
			 * already passed this gate, so it needs no second one.
			 */
			partialize: (state) => ({
				inputByConversation: Object.fromEntries(
					Object.entries(state.inputByConversation).map(([id, row]) => {
						let next = row;
						/*
						 * A CREDENTIAL IS NEVER WRITTEN, on any of the three paths a payload's
						 * text can be on: in flight, handed back, or waiting to be adopted.
						 * The capture's own text can BE the secret the user was mid-way
						 * through entering, so all three are blanked rather than left to the
						 * one gate the keystroke path has (review round 1, m1).
						 */
						if (next.inFlight?.volatileText)
							next = { ...next, inFlight: { ...next.inFlight, text: "" } };
						if (next.returned?.volatileText)
							next = { ...next, returned: { ...next.returned, text: "" } };
						if (next.volatilePendingText)
							next = { ...next, pendingText: undefined };
						/*
						 * AND THE DELIVERED TEXT, which is the same class of copy (review round 6,
						 * M6-1). `lateDeliveredText` was added beside `lateDelivered` so the note
						 * could be retired in the right company, and the raise sites clear
						 * `returned` - the record whose `volatileText` flag is what blanks the
						 * payload above. So without this line the delivered text outlives the gate
						 * that was guarding it: measured A/B on one store sequence, the secret
						 * present in this field and absent at the head before it. Dropping the text
						 * leaves the note itself alone, and a note with no text to compare keeps
						 * saying what it says - the conservative direction.
						 */
						if (next.volatilePendingText)
							next = { ...next, lateDeliveredText: undefined };
						return [id, next];
					}),
				),
			}),
			// Every hydrate is a fresh process: see `rehydrateInputRows`.
			merge: (persisted, current) => ({
				...current,
				inputByConversation: rehydrateInputRows(
					(persisted as Partial<ConversationInputStoreState> | undefined)
						?.inputByConversation,
				),
			}),
		},
	),
);
