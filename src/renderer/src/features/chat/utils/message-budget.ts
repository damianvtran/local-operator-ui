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
	DESKTOP_SYSTEM_PROMPT_BUDGET_BYTES,
	DESKTOP_SYSTEM_PROMPT_MAX_CHARS,
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
 * Render an overflow and the budget it broke so the two numbers cannot be
 * READ AS EQUAL.
 *
 * `formatByteSize` rounds to one decimal, which is the right precision for a
 * single size but makes a refusal refute itself when both operands round the
 * same way: the system-prompt budget is 1,100,000 bytes, so every overflow in
 * [1,100,001 ... 1,150,000] - a 50,000-byte window, 4.55% over, and the window
 * most real overflows land in - printed "is 1.1 MB, more than the 1.1 MB".
 * That sentence tells the user their prompt both fits and is refused, and
 * leaves them no way to know how much to cut (design round 1, D1). Ordinary
 * CJK prose reaches it at ~370,000 characters, which is an unremarkable thing
 * to paste.
 *
 * Shared by every refusal rather than patched into the one caller that bites
 * hardest, because the defect is in the RENDERING of a pair and all four
 * surfaces render one: the message, command and fork budget of 880,000 bytes
 * has the same collision in a 499-byte window. One helper keeps the surfaces
 * from drifting into two ways of stating the same comparison.
 *
 * Escalating precision is preferred over switching units because "1,110 KB"
 * would reintroduce the KB-above-1-MB ladder that round 1 removed (F7). Exact
 * bytes are the terminal fallback so the window closes completely rather than
 * shrinking: no precision separates two values that differ by one byte, and a
 * count of bytes is still an amount the user can act on.
 */
function formatByteSizePair(total: number, budget: number): [string, string] {
	const base = formatByteSize(total);
	if (base !== formatByteSize(budget)) return [base, formatByteSize(budget)];
	// Same unit on both sides throughout, so the sentence never asks the reader
	// to compare a KB against an MB.
	const inMb = base.endsWith("MB");
	const divisor = inMb ? 1_000_000 : 1000;
	const unit = inMb ? "MB" : "KB";
	for (const decimals of [2, 3]) {
		const totalText = (total / divisor).toFixed(decimals);
		const budgetText = (budget / divisor).toFixed(decimals);
		if (totalText !== budgetText) {
			return [`${totalText} ${unit}`, `${budgetText} ${unit}`];
		}
	}
	return [
		`${total.toLocaleString()} bytes`,
		`${budget.toLocaleString()} bytes`,
	];
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
	// Both ceilings, characters first, for the same reason `messageBudgetRefusal`
	// weighs both: `args` is declared `z.string().max(DESKTOP_MESSAGE_MAX_CHARS)`,
	// so a 400,000-character paste after a slash satisfies the byte budget and is
	// still refused by the schema parse inside `requestDesktop` with "Invalid
	// desktop operation." - the exact unactionable sentence this change exists to
	// remove, left standing on the sibling op when the message path was fixed
	// (round 2, Q-7 / N1). Characters are counted in JS units because that is what
	// `z.string().max()` counts, so this check and the one it front-runs agree on
	// every input rather than only on ASCII.
	if (args.length > DESKTOP_MESSAGE_MAX_CHARS) {
		return `This command is ${args.length.toLocaleString()} characters, more than the ${DESKTOP_MESSAGE_MAX_CHARS.toLocaleString()} one command can carry. Shorten it, or put the text in a message instead.`;
	}
	const target = desktopEndpoint({
		op: "sessions.command",
		sessionId: MEASUREMENT_SESSION_ID,
		requestId: MEASUREMENT_REQUEST_ID,
		command,
		args,
	});
	const total = new TextEncoder().encode(JSON.stringify(target.body)).length;
	if (total <= budget) return null;
	const [size, limit] = formatByteSizePair(total, budget);
	return `This command is ${size}, more than the ${limit} one command can carry. Shorten it, or put the text in a message instead.`;
}

/**
 * The refusal sentence for an over-budget agent system prompt, or null when it
 * fits.
 *
 * The budget for `legacy.agent.systemPrompt.update` was sized to its own
 * 1,000,000-character schema in round 1, but no pre-flight was added, so a
 * prompt heavy in escaped characters still reached main's backstop - and read
 * there as "Remove an image, or split the text across two messages" inside the
 * agent system-prompt editor, where none of those three things exist (round 2,
 * N4). The backstop copy is now scoped per op as well; this is the sized half,
 * which only a pre-flight can give because only here are the numbers still
 * known.
 *
 * Both ceilings, and BOTH fire on real input - the earlier claim here that a
 * character check "could never fire" inverted the common case and is why it is
 * spelled out now. For ordinary prose CHARACTERS bind first: 1,000,000 ASCII
 * characters serialize to ~1,000,020 bytes, comfortably under the 1,100,000
 * byte budget, so a 1,000,001-character paste is refused by the character cap
 * with the byte check never reached. Bytes bind on the other shape: text heavy
 * in escaped characters (NULs and control codes serialize to six bytes each),
 * where 200,000 characters is legal by count and ~1.2 MB on the wire. Neither
 * branch is dead, and an inaccurate comment about a limit is precisely how the
 * original bug survived review (`canonical-sessions-store.ts:406`).
 */
export function systemPromptBudgetRefusal(
	systemPrompt: string,
	budget: number = DESKTOP_SYSTEM_PROMPT_BUDGET_BYTES,
): string | null {
	if (systemPrompt.length > DESKTOP_SYSTEM_PROMPT_MAX_CHARS) {
		return `This system prompt is ${systemPrompt.length.toLocaleString()} characters, more than the ${DESKTOP_SYSTEM_PROMPT_MAX_CHARS.toLocaleString()} one agent can carry. Shorten it.`;
	}
	const total = new TextEncoder().encode(
		JSON.stringify({ system_prompt: systemPrompt }),
	).length;
	if (total <= budget) return null;
	const [size, limit] = formatByteSizePair(total, budget);
	return `This system prompt is ${size}, more than the ${limit} one agent can carry. Shorten it.`;
}

/**
 * The refusal sentence for an over-budget fork message, or null when it fits.
 *
 * `sessions.fork` carries the same 200,000-character text field as
 * `sessions.message` to the same session, and round 1 moved it onto the same
 * byte budget - but nothing weighed it before the request, so its own character
 * cap still died in `requestDesktop`'s `safeParse` as a bare "Invalid desktop
 * operation." surfaced through the picker as "The fork was not created" (round
 * 2, N2).
 *
 * Its own sentence rather than `messageBudgetRefusal`'s because the remedy is
 * different again: the fork's first message is optional, so the cheapest fix is
 * to send it in the new conversation once the fork exists, and "split it across
 * two messages" describes an affordance the picker does not have.
 */
export function forkBudgetRefusal(
	message: string,
	budget: number = DESKTOP_MESSAGE_BUDGET_BYTES,
): string | null {
	if (message.length > DESKTOP_MESSAGE_MAX_CHARS) {
		return `This first message is ${message.length.toLocaleString()} characters, more than the ${DESKTOP_MESSAGE_MAX_CHARS.toLocaleString()} one message can carry. Shorten it, or send it in the new conversation instead.`;
	}
	const target = desktopEndpoint({
		op: "sessions.fork",
		sessionId: MEASUREMENT_SESSION_ID,
		requestId: MEASUREMENT_REQUEST_ID,
		message,
		boundary: "next_safe",
	});
	const total = new TextEncoder().encode(JSON.stringify(target.body)).length;
	if (total <= budget) return null;
	const [size, limit] = formatByteSizePair(total, budget);
	return `This first message is ${size}, more than the ${limit} one message can carry. Shorten it, or send it in the new conversation instead.`;
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
	const textBytes = messageBodyBytes(text, []);
	const imageBytes = total - textBytes;
	// Attribute the overflow to whichever term actually DOMINATES it, not to
	// "there is at least one image". Branching on `images.length` alone told a
	// user with 950,000 chars of text and one 100-byte thumbnail to "remove an
	// image" to save "0 KB" - advice that cannot work (review round 1, F6).
	// Images stay the preferred remedy on a tie, since removing one is the
	// cheaper action than splitting prose.
	// The pair is formed against the term the sentence actually PRINTS, not
	// against `total`: this branch names the images' or the text's own size, so
	// that is the number the budget must be readably distinct from.
	if (images.length && imageBytes >= textBytes) {
		const [size, limit] = formatByteSizePair(imageBytes, budget);
		return `These images total ${size}, more than the ${limit} one message can carry. Remove an image, or send them in a second message.`;
	}
	const [size, limit] = formatByteSizePair(textBytes, budget);
	return `This message is ${size} of text, more than the ${limit} one message can carry. Split it across two messages.`;
}
