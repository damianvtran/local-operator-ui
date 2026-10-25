/**
 * What to say when a send cannot carry one of the attachments it is holding.
 *
 * `encodeAttachments` carries a file only when it can actually read or upload
 * it. It used to skip the ones it could not - and that skip was silent in every
 * direction: the message went out a file short of what the composer showed, the
 * user was told nothing, and on a draft restored from a refusal the file is a
 * file the user still believes they are sending. Silent and partial is the
 * worst shape a failure can take, so the drop is reported and the send stops
 * before admission instead (code review round 8, MINOR-1).
 *
 * ONE SENTENCE BUILDER, THREE CAUSES (attachment contract v1 §6/§6b.2): a file
 * that could not be read, a file the daemon refused to store, and a file
 * addressed to a conversation another device owns. They share a builder rather
 * than growing three error surfaces because the user's action is the same in
 * all three - fix or remove the named file - and the send refuses in the same
 * place, before admission while the composer is still editable.
 *
 * WHY THE RENDERER REFUSES RATHER THAN THE TRANSPORT. This is the same argument
 * `message-budget.ts` makes for the same reasons: by the time a body reaches
 * main the op is all that is left, so a transport-side failure can only report
 * a missing file as a malformed message. Worse, a refusal after
 * `admitChatDraft` has latched the draft is answered by the unchanged-payload
 * guard, so the user cannot drop the file and send again. Before admission, the
 * composer is still editable and the chip is still removable.
 *
 * WHAT IS DELIBERATELY NOT REFUSED: nothing, any more. The old note exempted a
 * non-image path (not carried by any send) and a context with no read bridge.
 * Both now produce a reportable failure instead - the first because the file is
 * uploaded, the second because "this window cannot upload files" is still a file
 * the composer showed and the send would omit.
 */

import { DESKTOP_MESSAGE_MAX_FILES } from "../../../../../shared/attachment-upload";
import { DESKTOP_MESSAGE_MAX_IMAGES } from "../../../../../shared/desktop-contract";
import { getFileName } from "./get-file-name";

/** Trailing full stops, so a daemon sentence can join this one cleanly. */
const TRAILING_STOPS = /\.+$/;

/**
 * One file the send could not carry, in the terms the sentence needs.
 *
 * A bare string is accepted too, and means the READ failure: that is what every
 * caller passed before files could be uploaded, and `alert-*`-style
 * compatibility is cheap where the alternative is a test-only second spelling.
 */
export type AttachmentFailure =
	| string
	| {
			name: string;
			kind: "read" | "upload" | "remote";
			/** The daemon's own sentence for an upload refusal. */
			detail?: string;
	  };

const nameOf = (failure: AttachmentFailure): string =>
	typeof failure === "string" ? getFileName(failure) : failure.name;

/** `detail` without its own full stop, so the clause reads as one sentence. */
const clauseOf = (detail: string | undefined): string =>
	detail?.trim().replace(TRAILING_STOPS, "") ?? "";

const readClause = (name: string): string =>
	`${name} could not be read (it may have been moved or deleted)`;

const uploadClause = (name: string, detail: string | undefined): string => {
	const reason = clauseOf(detail);
	return reason
		? `${name} could not be attached (${reason})`
		: `${name} could not be attached`;
};

const remoteClause = (name: string): string =>
	`${name} cannot be attached because this conversation is owned by another device, and files are only attachable to conversations on this one`;

/**
 * The refusal sentence for the attachments a send could not carry, or null when
 * it carried all of them.
 *
 * It names the files, says what happened to the send, and gives both remedies -
 * the same three-part shape every other refusal in the renderer follows
 * (`docs/branding.md` section 8), and the reason the files are named at all:
 * "your attachment was dropped" is only checkable against a name.
 *
 * WHAT IT SAYS HAPPENED, precisely, because the first version got this wrong in
 * the one direction that matters (design round 4, D13): this refusal is raised
 * BEFORE admission, so nothing left the composer. It states that outcome: the
 * message was not sent, the draft is held.
 *
 * WHAT IT DOES NOT PROMISE. The refusal repeats for as long as the failing chip
 * is attached, so the composer's generic "Send it again" hint is withheld for
 * its code (`UNREADABLE_ATTACHMENT_CODE`, `canonical-sessions-store.ts`):
 * clicking Send again re-rendered this sentence and put no request on the wire.
 */
export function unreadableAttachmentRefusal(
	files: readonly AttachmentFailure[],
): string | null {
	if (files.length === 0) return null;
	const names = files.map(nameOf);
	const allRemote =
		files.length > 0 &&
		files.every(
			(failure) => typeof failure !== "string" && failure.kind === "remote",
		);
	const allRead = files.every(
		(failure) => typeof failure === "string" || failure.kind === "read",
	);
	/*
	 * The all-read arm keeps the sentences this builder has always produced,
	 * including the plural one that names the files once instead of repeating the
	 * clause per name. A mixed or upload-refused list falls through to the clause
	 * form, because there no single reason can be stated once truthfully.
	 */
	if (allRead) {
		if (names.length === 1)
			return `${names[0]} could not be read (it may have been moved or deleted), so this message was not sent. Attach it again, or remove it from the draft.`;
		return `${names.join(", ")} could not be read (they may have been moved or deleted), so this message was not sent. Attach them again, or remove them from the draft.`;
	}
	if (allRemote) {
		// One cause for every name, so the sentence states it once rather than
		// repeating "owned by another device" per file.
		const subject =
			names.length === 1
				? `${names[0]} cannot be attached`
				: `${names.join(", ")} cannot be attached`;
		return `${subject} because this conversation is owned by another device, and files are only attachable to conversations on this one. Send the message without ${
			names.length === 1 ? "it" : "them"
		}, or start the conversation here.`;
	}
	const clauses = files.map((failure) => {
		if (typeof failure === "string" || failure.kind === "read")
			return readClause(nameOf(failure));
		if (failure.kind === "remote") return remoteClause(failure.name);
		return uploadClause(failure.name, failure.detail);
	});
	const pronoun = names.length === 1 ? "it" : "them";
	return `${clauses.join("; ")}, so this message was not sent. Attach ${pronoun} again, or remove ${pronoun} from the draft.`;
}

/**
 * The refusal sentence for the images a draft stages beyond what one message
 * carries, or null when it stages none.
 *
 * The COUNT sibling of `unreadableAttachmentRefusal`, and it exists for the
 * same shape of failure one rung up: `encodeAttachments` sliced a draft to the
 * wire's ceiling silently, so a send went out with fewer images than the
 * composer showed and nothing named the difference - "silent and partial is the
 * worst shape a failure can take" (design round 1 on issue #790, D1).
 *
 * Both numbers are stated - the draft's own count and the ceiling - because
 * the remedy ("remove N") is only checkable against the screen.
 */
export function imageOverflowRefusal(dropped: number): string | null {
	if (dropped <= 0) return null;
	const cap = DESKTOP_MESSAGE_MAX_IMAGES;
	const total = cap + dropped;
	if (dropped === 1)
		return `This draft carries ${total} images and one message carries up to ${cap}, so this message was not sent. Remove the extra image, or send it in a second message.`;
	return `This draft carries ${total} images and one message carries up to ${cap}, so this message was not sent. Remove ${dropped} of them, or send them in a second message.`;
}

/**
 * The file-count sibling of `imageOverflowRefusal` (contract §6, `Prompt.files`
 * max 8). Same rule and same reason: the ceiling is the wire's, the draft is
 * the user's, and the difference is named rather than sliced away.
 */
export function fileOverflowRefusal(dropped: number): string | null {
	if (dropped <= 0) return null;
	const cap = DESKTOP_MESSAGE_MAX_FILES;
	const total = cap + dropped;
	if (dropped === 1)
		return `This draft carries ${total} files and one message carries up to ${cap}, so this message was not sent. Remove the extra file, or send it in a second message.`;
	return `This draft carries ${total} files and one message carries up to ${cap}, so this message was not sent. Remove ${dropped} of them, or send them in a second message.`;
}
