/**
 * The approval pair, and the words a typed answer is resolved through.
 *
 * WHY THIS IS A MODULE OF ITS OWN. `ask-answer.ts` reads the desktop API and the
 * canonical store, so anything that imports it drags two path aliases and a
 * store into the bundle. The two readers that need ONLY these words are the
 * composer's shape rule (`credential-capture.ts`, "is this text a reply the
 * answer door already accepts, so it can never be called a secret?") and
 * `scripts/soft-breaks.test.mjs`, which bundles `credential-capture.ts` from
 * source with no alias map. Splitting the words out keeps one definition of
 * "yes/no/1/2" for every reader without making a pure module depend on a store.
 *
 * The docblocks that follow are the ones the code has carried since the buttons
 * landed; only their home changed.
 */

import type { PendingDesktopGate } from "../../../../shared/desktop-session-contract";

/**
 * A bare option ordinal: one digit, never zero, optionally carrying the period
 * the card itself prints, and tolerant of surrounding whitespace.
 */
export const BARE_OPTION_ORDINAL = /^([1-9])\.?$/;

/**
 * The approval pair: the labels the card prints and a composer answer resolves
 * through `approvalAnswerValue` below, and the request `answerGateOption`
 * builds.
 *
 * ## Why an ORDERED array, and why resolution is positional
 *
 * `1.`/`2.` on the card are positions, and the ordinal path resolves through
 * this array, so the buttons, the numerals and the typed shortcut cannot drift
 * apart. `approvalVerdict` maps labels positionally, and it is the ONLY place a
 * label becomes the boolean: a third option added here resolves to `null`
 * everywhere at once — refused by `answerGateOption` rather than silently
 * posting a verdict nothing defined. An approval has exactly this many answers,
 * which is why the pair is not derived from any option list.
 *
 * ## The descriptions
 *
 * Short and factual, in the app's voice: they are the consequence line the
 * reader decides between, the register an `ask`'s model-authored options carry.
 * No "always allow" — the answer is the boolean alone, nothing is remembered,
 * so a control that implied a scope it cannot grant would be the app's own
 * lie.
 */
export const APPROVAL_OPTIONS: PendingDesktopGate["options"] = [
	{ label: "Approve", description: "Run the action and continue the turn." },
	{ label: "Deny", description: "Refuse the action; the turn continues." },
];

/**
 * The verdict an approval option's label carries, or `null` for any other
 * string.
 *
 * The buttons submit `option.label`, so this is what turns a press into the
 * boolean the route takes — and `answerGateOption` refuses a label this
 * returns `null` for rather than posting anything. See `APPROVAL_OPTIONS` for
 * why a third option fails closed through here.
 */
export const approvalVerdict = (label: string): boolean | null => {
	if (label === APPROVAL_OPTIONS[0]?.label) return true;
	if (label === APPROVAL_OPTIONS[1]?.label) return false;
	return null;
};

/**
 * The verdict a composer answer to an approval gate carries, or `null` when
 * the text is no answer to that gate at all.
 *
 * ## Why the words stay
 *
 * "Reply yes or no in the composer" shipped before the buttons did, the card's
 * hint and the TUI both teach it, and a yes/no the user already knows must not
 * stop working when the buttons arrive. The lists are the shipped ones,
 * unchanged, including their tolerance for `ok`/`allow` and `reject`/`cancel`.
 *
 * ## Why the ordinals are here
 *
 * The card draws `1.` `2.`, so a numeral the user can read and type must
 * resolve — the same rule `resolveNumericAnswer` states for the ask card, and
 * the same trap it records: a numeral the card draws but the app does not
 * accept is a lie. Resolution goes through `APPROVAL_OPTIONS`, so the
 * numerals, the buttons and the wire body share one ordering.
 *
 * Out of range falls through to `null` (`3` against two options is not a pick,
 * and this cannot invent a third answer), and a `null` renders the composer's
 * "reply yes or no" sentence — THROWN as a `UserFacingError` carrying
 * `ANSWER_NOT_SENT_CODE`, because nothing was sent and the unknown-outcome
 * sentence ("Couldn't confirm…", with a Retry) would be a claim this path
 * cannot make (agent review round 1, MAJOR-1) — never a value the route would
 * refuse later. Callers hand it the TYPED text beside the payload,
 * the discipline `answerValue` states above: with a staged reply the payload
 * is `"<reply-to>…</reply-to>\n2"`, and a resolution rule that had to parse
 * that format is one payload change away from failing silently.
 */
export const approvalAnswerValue = (text: string): boolean | null => {
	const value = text.trim().toLowerCase();
	if (["y", "yes", "approve", "ok", "allow"].includes(value)) return true;
	if (["n", "no", "deny", "reject", "cancel"].includes(value)) return false;
	const match = BARE_OPTION_ORDINAL.exec(text.trim());
	if (!match) return null;
	const option = APPROVAL_OPTIONS[Number.parseInt(match[1], 10) - 1];
	return option ? approvalVerdict(option.label) : null;
};
