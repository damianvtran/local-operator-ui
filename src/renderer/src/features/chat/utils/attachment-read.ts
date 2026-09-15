/**
 * What to say when a send cannot read one of the attachments it is carrying.
 *
 * `encodeImageAttachments` in `chat-page.tsx` carries an attachment as an image
 * only when it can actually read the file. It used to skip the ones it could
 * not - and that skip was silent in every direction: the message went out a
 * picture short of what the composer showed, the user was told nothing, and on
 * a draft restored from a refusal the file is a file the user still believes
 * they are sending. Silent and partial is the worst shape a failure can take,
 * so the drop is reported and the send stops before admission instead (code
 * review round 8, MINOR-1 - the limit the previous round declared as "it fails
 * at send time with the transport's own error" was, as written, false).
 *
 * WHY THE RENDERER REFUSES RATHER THAN THE TRANSPORT. This is the same argument
 * `message-budget.ts` makes for the same reasons: by the time a body reaches
 * main the op is all that is left, so a transport-side failure can only report
 * a missing file as a malformed message. Worse, a refusal after
 * `admitChatDraft` has latched the draft is answered by the unchanged-payload
 * guard, so the user cannot drop the file and send again. Before admission, the
 * composer is still editable and the chip is still removable.
 *
 * WHAT IS DELIBERATELY NOT REFUSED, so the next reader does not "fix" it:
 *
 *  - A path that is not one of the four image types the runtime accepts is not
 *    carried by ANY send, in any state, restored or not - it is attached, it is
 *    recorded in the Files panel, and it is simply not part of the message body.
 *    That is by design (`encodeImageAttachments`' own note) and it is not a
 *    per-file failure of this send, so it has no place in this sentence.
 *  - A renderer with no `window.api.readFile` bridge cannot read any file at
 *    all. That is a fact about the context, not about one attachment, and a
 *    per-file sentence would send the user to re-attach a file for a condition
 *    they cannot act on.
 *
 * Both are named here rather than left implicit because each one is a way this
 * sentence could be claimed to cover more than it does.
 */

import { getFileName } from "./get-file-name";

/**
 * The refusal sentence for the attachments a send could not read, or null when
 * it could read all of them.
 *
 * It names the files, says what it means (they would not be in the message),
 * and gives both remedies - the same three-part shape every other refusal in
 * the renderer follows (`docs/branding.md` § 8), and the reason the files are
 * named at all: "your attachment was dropped" is only checkable against a name.
 */
export function unreadableAttachmentRefusal(
	files: readonly string[],
): string | null {
	if (files.length === 0) return null;
	const names = files.map(getFileName);
	if (names.length === 1)
		return `${names[0]} could not be read (it may have been moved or deleted), and this message would go out without it. Attach it again, or remove it from the draft.`;
	return `${names.length} attachments could not be read (they may have been moved or deleted), and this message would go out without them: ${names.join(", ")}. Attach them again, or remove them from the draft.`;
}
