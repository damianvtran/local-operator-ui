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
	if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	return `${Math.round(bytes / 1000)} KB`;
}

/**
 * The refusal sentence for an over-budget message, or null when it fits.
 *
 * Two sentences because the remedy differs: images can be sent separately,
 * text has to be split. Both name what happened, what it means, and what to
 * do, in that order - `docs/branding.md` § 8. Neither quotes a status code or
 * an exception, because neither is something the user can act on.
 */
export function messageBudgetRefusal(
	text: string,
	images: WireImage[],
	budget: number = DESKTOP_MESSAGE_BUDGET_BYTES,
): string | null {
	const total = messageBodyBytes(text, images);
	if (total <= budget) return null;
	const limit = formatByteSize(budget);
	if (images.length) {
		// Attribute the overflow to the images when there are any: they are what
		// the user can remove, and after the downscale ladder has already run,
		// images large enough to still overflow are the dominant term.
		const imageBytes = total - messageBodyBytes(text, []);
		return `These images total ${formatByteSize(imageBytes)}, more than the ${limit} one message can carry. Remove an image, or send them in a second message.`;
	}
	return `This message is ${formatByteSize(total)} of text, more than the ${limit} one message can carry. Split it across two messages.`;
}
