/**
 * Weigh a chat message against the transport budget before it is admitted.
 *
 * Why the renderer and not main: main's guard is untargeted. By the time a body
 * reaches `desktop-transport.ts` the op is all that is left, so its 413 can
 * only say "too large" - it cannot say how large, or whether the text or the
 * images are the problem, or that removing one screenshot would fix it. Worse,
 * the refusal arrives after `admitChatDraft` has latched the draft, so the
 * advice to "send it again" was refused by the unchanged-payload guard and the
 * only exit was discarding the message.
 *
 * Doing it here, before admission, is what makes the error honest and the
 * composer still editable.
 */

import {
	DESKTOP_MESSAGE_BUDGET_BYTES,
	DESKTOP_MESSAGE_MAX_CHARS,
	desktopEndpoint,
} from "../../../../../shared/desktop-contract";
import type { WireImage } from "./bound-image";

/**
 * A session id that is only ever used to weigh a body.
 *
 * `sessionId` is a fixed 12-hex-character field, so any valid value serializes
 * to the same number of bytes - which lets a draft with no session yet be
 * measured exactly rather than estimated. It never leaves this module.
 */
const MEASUREMENT_SESSION_ID = "000000000000";
const MEASUREMENT_REQUEST_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Bytes the transport will weigh for this message.
 *
 * Built through `desktopEndpoint` rather than by hand so the measurement is
 * the same serialization the guard applies - the mismatch this whole change
 * exists to remove is two places computing "the size" differently.
 */
export function messageBodyBytes(text: string, images: WireImage[]): number {
	const target = desktopEndpoint({
		op: "sessions.message",
		sessionId: MEASUREMENT_SESSION_ID,
		requestId: MEASUREMENT_REQUEST_ID,
		text,
		images,
		mode: "prompt",
	});
	return new TextEncoder().encode(JSON.stringify(target.body)).length;
}

/**
 * Human-readable size: whole KB below 1 MB, one decimal in MB above it.
 *
 * KB/MB here are the units a person reads off a Finder window, so they are
 * powers of ten, not 1024s. Precision beyond one decimal is noise in a
 * sentence whose job is "this is too big by roughly this much".
 */
export function formatByteSize(bytes: number): string {
	// The MB branch starts at 999_500, not 1_000_000: `Math.round(999_500/1000)`
	// is 1000, so the KB branch would otherwise print "1000 KB" - a unit that
	// never appears anywhere else and reads as a ladder of 999 KB -> 1000 KB ->
	// 1.0 MB (review round 1, F7). Rounding up to "1.0 MB" is what a person
	// expects, and this is the refusal sentence's only number.
	if (bytes >= 999_500) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	return `${Math.round(bytes / 1000)} KB`;
}

/**
 * The refusal sentence for an over-budget slash command, or null when it fits.
 *
 * `sessions.command` shares the message budget (it is in `MESSAGE_OPS`) and
 * its `args` field accepts up to 200,000 characters of user-typed text, but
 * nothing weighed it before admission - the only guard was main's untargeted
 * backstop, which is the same schema-wider-than-its-check asymmetry this
 * change set out to remove (review round 1, F8).
 *
 * Separate from `messageBudgetRefusal` because the remedy differs: a command
 * has no images to drop and cannot be split across two sends, so the advice is
 * to shorten it or send the text as a message instead.
 */
export function commandBudgetRefusal(
	command: string,
	args: string,
	budget: number = DESKTOP_MESSAGE_BUDGET_BYTES,
): string | null {
	const target = desktopEndpoint({
		op: "sessions.command",
		sessionId: MEASUREMENT_SESSION_ID,
		requestId: MEASUREMENT_REQUEST_ID,
		command,
		args,
	});
	const total = new TextEncoder().encode(JSON.stringify(target.body)).length;
	if (total <= budget) return null;
	return `This command is ${formatByteSize(total)}, more than the ${formatByteSize(budget)} one command can carry. Shorten it, or put the text in a message instead.`;
}

/**
 * The refusal sentence for an over-budget message, or null when it fits.
 *
 * Sentences differ because the remedy differs: images can be sent separately,
 * text has to be split. All of them name what happened, what it means, and
 * what to do, in that order - `docs/branding.md` § 8. None quotes a status
 * code or an exception, because neither is something the user can act on.
 */
export function messageBudgetRefusal(
	text: string,
	images: WireImage[],
	budget: number = DESKTOP_MESSAGE_BUDGET_BYTES,
): string | null {
	// The CHARACTER ceiling is weighed first and separately, because it binds on
	// inputs the byte budget lets through: 400,000 characters of prose is ~400 KB
	// against an 880,000-byte budget, so the pre-flight passed it and the schema
	// parse inside `requestDesktop` refused it with "Invalid desktop operation." -
	// a sentence naming nothing actionable, for someone whose only mistake was
	// pasting a long document (review round 1, Q-2). Counted in JS characters
	// because that is what `z.string().max()` counts, so this check and the one it
	// front-runs agree on every input rather than only on ASCII.
	if (text.length > DESKTOP_MESSAGE_MAX_CHARS) {
		return `This message is ${text.length.toLocaleString()} characters, more than the ${DESKTOP_MESSAGE_MAX_CHARS.toLocaleString()} one message can carry. Split it across two messages.`;
	}
	const total = messageBodyBytes(text, images);
	if (total <= budget) return null;
	const limit = formatByteSize(budget);
	const textBytes = messageBodyBytes(text, []);
	const imageBytes = total - textBytes;
	// Attribute the overflow to whichever term actually DOMINATES it, not to
	// "there is at least one image". Branching on `images.length` alone told a
	// user with 950,000 chars of text and one 100-byte thumbnail to "remove an
	// image" to save "0 KB" - advice that cannot work (review round 1, F6).
	// Images stay the preferred remedy on a tie, since removing one is the
	// cheaper action than splitting prose.
	if (images.length && imageBytes >= textBytes) {
		return `These images total ${formatByteSize(imageBytes)}, more than the ${limit} one message can carry. Remove an image, or send them in a second message.`;
	}
	return `This message is ${formatByteSize(textBytes)} of text, more than the ${limit} one message can carry. Split it across two messages.`;
}
