/**
 * Answering a pending `ask` gate: the ordinal rule, the one-answer-in-flight
 * lock, and the request that leaves for the owner.
 *
 * ## Why this lives here and not in the wire contract
 *
 * This is composer behaviour, not a wire shape. `desktop-session-contract.ts`
 * holds "the canonical backend wire shapes" by its own header, and a rule about
 * how this app reinterprets what a user typed is not one of them — the backend
 * neither sends nor validates it. It sits beside `chat-title.ts` instead, with
 * the other chat-local text rules (code review round 1, R-NIT).
 *
 * The same reasoning is what puts the rest of the answer path here rather than
 * only inside `chat-page.tsx`: the lock and the request body are properties of
 * this path rather than of that component, and while they were reachable only
 * through a rendered component nothing could assert either of them. See
 * `answerGateOption`.
 *
 * ## Why this exists
 *
 * The gate card numbers its options `1.`, `2.`, `3.` — the ordering the model
 * wrote, and the shortcut the terminal card teaches (digits 1-9 jump to an
 * option). A user reading that list and typing `1` into the composer means
 * "the first one". Before this, the composer sent the literal string `"1"` as
 * the answer, and the model received a bare numeral with no way to tell which
 * option it indexed — the wire contract is "answer with the label the model
 * wrote", so a positional numeral is not an answer at all, it is noise that
 * happens to parse.
 *
 * So the numerals were a promise the app did not keep: visible, meaningful to
 * the reader, and silently discarded. Either they had to go, or typing one had
 * to do what it looks like it does. It does now, and the clickable options put
 * the same resolution behind a pointer.
 *
 * ## The rules, and why each is narrow
 *
 * - **`ask` gates with options only.** An approval carries no options and is
 *   answered yes/no; a `secret` ask carries empty options, so nothing matches.
 * - **The ordinal, optionally as the card prints it.** `"1"` resolves, and so
 *   does `"1."` — because `1.` is exactly what the card draws, so the most
 *   literal transcription of the option's own mark was the one spelling that
 *   missed. The UX round measured that trap: a user typing `1.` got `1.`
 *   delivered to the model as prose, with no signal their pick was not a pick
 *   (UX round 1, U5; code review round 1, R-MINOR). Surrounding whitespace is
 *   likewise forgiven, since it carries no meaning the user intended.
 * - **Still only an ordinal, and nothing else.** `"1 of them"` and
 *   `"option 1"` do not resolve. Anything with other characters in it is prose
 *   the user meant literally, and rewriting prose into a label the user did
 *   not choose would be worse than the bug this fixes.
 * - **`1`-`9` only, and only in range.** Nine is where the card's own numerals
 *   stop being a shortcut in the terminal; past that a digit is ambiguous with
 *   the first digit of a longer number. Out of range falls through unchanged —
 *   typing `7` against three options is not an option pick, and answering the
 *   seventh of three is not something this can invent.
 *
 * Everything else passes through untouched, so a question whose real answer IS
 * a number ("how many retries?") still sends what the user typed — that gate
 * carries no options, which is the case the first rule already excludes.
 *
 * ## Why the TYPED text, never the composed payload
 *
 * Callers must hand this what the user typed, before any prefix is applied.
 * The composer sends `buildSendPayload(message, replies)`, which with a staged
 * reply is `"<reply-to>…</reply-to>\n2"` — not a bare ordinal, so the resolver
 * passed it through and the owner received the reply-wrapped numeral as the
 * answer VALUE. An ask gate is one-shot, so the model then acted on that
 * string. That was the MAJOR of code review round 1, and it is why `send`
 * takes a separate `typed` argument rather than re-deriving one by stripping
 * the prefix back off: a resolution rule that has to parse the payload format
 * is one payload change away from silently reopening the same hole.
 */

import {
	DesktopControlError,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
/*
 * The press's own composer code, kept with the composer alert's other codes
 * rather than here: `withholdsRetryHint` is the predicate that reads it, and a
 * code it cannot see is a code that does not withhold the hint (design round 1,
 * D2 — see `answerReport`'s note).
 */
import {
	ANSWER_NOT_SENT_CODE,
	UNCONFIRMED_SEND_CODE,
} from "@shared/store/canonical-sessions-store";
import {
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_LOST_SIGHT_CODE,
	DESKTOP_REFUSAL_CODE,
} from "../../../../shared/desktop-contract";
import type { DesktopRequest } from "../../../../shared/desktop-contract";
import type { PendingDesktopGate } from "../../../../shared/desktop-session-contract";

/**
 * A bare option ordinal: one digit, never zero, optionally carrying the period
 * the card itself prints, and tolerant of surrounding whitespace.
 */
const BARE_OPTION_ORDINAL = /^([1-9])\.?$/;

export function resolveNumericAnswer(
	gate: Pick<PendingDesktopGate, "kind" | "options">,
	text: string,
): string {
	if (gate.kind !== "ask" || gate.options.length === 0) return text;
	const match = BARE_OPTION_ORDINAL.exec(text.trim());
	if (!match) return text;
	const index = Number.parseInt(match[1], 10) - 1;
	const option = gate.options[index];
	// `text`, not the trimmed match: a value this does not resolve must reach
	// the backend exactly as the user typed it, including its whitespace.
	return option ? option.label : text;
}

/**
 * What `send` should put on the wire for a typed answer.
 *
 * The decision, in one place and as a function of all three inputs, so it can be
 * asserted rather than read out of a component. It existed inline in
 * `chat-page.tsx` as `resolveNumericAnswer(gate, typed ?? content)`, and the
 * round-1 fix for it (passing the typed text instead of the composed payload)
 * was correct but carried no regression guard: reverting `typed ?? content` to
 * `content` re-opened the MAJOR and left the suite green, because nothing in it
 * could reach the call site (code review round 2, F1).
 *
 * The three states it has to keep distinct, and which the tests pin:
 *
 * - **A staged reply with a bare ordinal.** `typed` is `"2"` while `payload` is
 *   `"<reply-to>…</reply-to>\n2"`. The answer is the second option's LABEL. This
 *   is the case the round-1 MAJOR was about, and the reason the typed text is
 *   threaded down here at all.
 * - **A bare ordinal the composer itself wrapped**, i.e. no separate typed text
 *   (the suggestion grid, or any caller that composes no prefix). `typed` is
 *   undefined, so the payload stands in — and a reply-wrapped payload is not a
 *   bare ordinal, so it passes through UNRESOLVED rather than being rewritten
 *   into an option the user did not pick.
 * - **Anything else.** Prose, an out-of-range digit, a gate with no options: the
 *   typed text reaches the wire exactly as typed.
 */
export const answerValue = (
	gate: Pick<PendingDesktopGate, "kind" | "options">,
	typed: string | undefined,
	payload: string,
): string => resolveNumericAnswer(gate, typed ?? payload);

/**
 * Whether a forward `Tab` in the composer should be diverted onto the pending
 * gate's first option.
 *
 * ## Why the composer overrides forward Tab at all
 *
 * The gate renders in the transcript, which is BEFORE the composer in DOM order,
 * so forward Tab out of the composer walks the sidebar and never reaches the
 * question the user was just shown (UX round 1, U1: 24 real forward Tabs never
 * found it). Diverting the forward key, while a live option exists, is what makes
 * the composer and the options one closed cycle.
 *
 * ## Why it is GUARDED, and why the guard is here
 *
 * Shipped ungated, it was a one-way door: with any question pending, forward Tab
 * out of the composer could not leave the composer forward at all — not from an
 * empty box, not from a caret mid-word — so the chips, the sidebar and every
 * other control after the composer became unreachable in that direction until
 * the question was answered (UX round 2, U7; code review round 2, F2). Tab is how
 * a keyboard user leaves a text field, and a question can stay pending for a long
 * time. So the diversion asks for all four of:
 *
 * - **unmodified Tab.** `Shift+Tab` keeps its native meaning, and so does every
 *   chord (`Ctrl+Tab` switches tabs at the OS/window level).
 * - **the composer has content, and the caret is at the END of it.** A bare box
 *   and a mid-draft caret are both "leave this field" — the user is moving on,
 *   not asking to answer.
 * - **a live, enabled option exists.** Checked by the caller, which owns the DOM;
 *   the query is what makes a held or absent card behave natively.
 *
 * Lives here rather than inline in the handler for the same reason
 * `answerGateOption` does: nothing in a test could reach a decision written
 * inside a React component with no DOM, and the round-1 remediation's claim that
 * this rule was asserted in `scripts/ask-options.test.mjs` was simply false.
 */
export const shouldTabIntoAnswerOptions = (
	event: Pick<
		KeyboardEvent,
		"key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey"
	>,
	composer: {
		value: string;
		selectionStart: number | null;
		selectionEnd: number | null;
	},
	hasLiveOption: boolean,
): boolean => {
	if (!hasLiveOption) return false;
	if (event.key !== "Tab") return false;
	if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey)
		return false;
	if (composer.value.trim().length === 0) return false;
	const { selectionStart, selectionEnd } = composer;
	if (selectionStart === null || selectionEnd === null) return false;
	// No selection, and the caret hard against the last character: anything else
	// is a user mid-edit asking to move on.
	return (
		selectionStart === selectionEnd && selectionEnd === composer.value.length
	);
};

/**
 * Whether the ask gate's focus restore may move focus off the composer.
 *
 * The composer is a legitimate way to answer an ask - the card's own hint says
 * "type 1-9 and send" - so the restore moves a box only while it is still
 * exactly where the press left it. Three things have to hold, and each is a way
 * the user can have taken it back:
 *
 * - **The composer holds focus at all.** Otherwise the user has moved on, and
 *   the gate has no business moving them.
 * - **The box is empty.** A draft means they are writing, and the composer stays
 *   usable through a hold by design; a focused box with content is a follow-up,
 *   not an idle hand-off.
 * - **No pointer has landed in it** since that hand-off. This is the half the
 *   first two cannot see: a click into an EMPTY box leaves it empty and focused,
 *   which is indistinguishable from the press's own hand-off. Without it, a
 *   multi-question gate advancing on its own schedule takes the caret, the
 *   characters the user then types reach nothing, and the next `Space` presses
 *   the option that stole focus - posting it as their answer to the NEXT
 *   question (UX round 4, U13).
 *
 * Pure over its inputs, and here rather than inside the component, so the
 * decision can be asserted without a DOM - the same move `shouldTabIntoAnswerOptions`
 * above makes and for the same reason (code review round 4, n6). `message-input.tsx`
 * reads the live DOM and calls this; the test calls it with a stand-in object.
 */
export const composerFocusIsOurs = (
	composer: HTMLTextAreaElement | null,
	activeElement: Element | null,
	pointerTouched: boolean,
): boolean =>
	composer !== null &&
	activeElement === composer &&
	composer.value.length === 0 &&
	!pointerTouched;

/**
 * One send-or-answer in flight at a time.
 *
 * ## Why this is an object and not the bare `useRef<boolean>` it replaces
 *
 * The property the careful comments in `chat-page.tsx` claim — that a click
 * cannot race a typed send, that a double click cannot post two answers — rests
 * on the check and the claim happening in ONE synchronous run, with no `await`
 * between them. Nothing exercised it: the round-1 review found the test that
 * claims this asserting a `disabled` prop and never reaching the race at all.
 * Making the lock a named thing is what lets a test hold it and try to
 * interleave, and it gives both call sites one implementation instead of two
 * hand-copied check-set pairs that can drift apart.
 */
export type SendLock = {
	/** Whether a send or an answer is currently out. Read-only to callers. */
	readonly held: boolean;
	/** Claim the lock, or report that someone else holds it. Never awaits. */
	tryAcquire(): boolean;
	/** Give the lock back. Safe to call when it is not held. */
	release(): void;
};

export const createSendLock = (): SendLock => {
	let held = false;
	return {
		get held() {
			return held;
		},
		tryAcquire() {
			if (held) return false;
			held = true;
			return true;
		},
		release() {
			held = false;
		},
	};
};

/**
 * The transport's own error code, when the failure carries one.
 *
 * One extraction of `"code" in error`, so the two catches that report a failed
 * send cannot disagree about it. They did: the typed-send path read the code and
 * the click path did not, so `activeErrorCode` — which is what the composer's
 * alert uses to decide whether it can offer a remedy such as "Restore it" — was
 * blind to every failure that came from pressing an option (code review round 1,
 * R-MINOR).
 */
export const errorCodeOf = (error: unknown): string | undefined =>
	error instanceof Error && "code" in error && typeof error.code === "string"
		? error.code
		: undefined;

/**
 * The sentence for a press whose question another front end settled first.
 *
 * This is the wording the app shipped, and it is TRUE — in the one state it is
 * now allowed to render in: the route refused with a codeless `409` AND the live
 * session has no pending gate at all. Nothing else can have removed that gate:
 * a press the owner took answers `2xx` (see `answerRefusedWithoutACode`), so a
 * refusal means this press did not settle it, and a gate that is gone means
 * somebody did. "Somewhere else" is then a fact rather than a guess.
 *
 * It used to be rendered for every bare `409`, which is where it became false:
 * the same route raises the epoch-rollover and question-index refusals in the
 * same shape, and in those the question was still pending (measured — code review
 * round 1, MAJOR-1). Those two now have their own arms below.
 */
export const SETTLED_ELSEWHERE_MESSAGE =
	"That question was already answered somewhere else, so your answer was not sent.";

/**
 * The sentence for a press whose question the ask had already moved past.
 *
 * The multi-question case: the gate is still pending, but it is the NEXT
 * question — a different `question_index` under the same `request_id` — so the
 * owner refuses an answer addressed to the previous one. The wording names both
 * halves because the app cannot see which happened (another front end answered
 * the question, or the ask advanced on its own schedule) and both are true of
 * the user's situation: the question they answered is not the question on screen.
 */
export const QUESTION_MOVED_ON_MESSAGE =
	"That question had already been settled or moved on, so your answer was not sent.";

/**
 * The sentence for a press addressed to a runtime instance that is gone.
 *
 * The app's own voice, and both halves of that are deliberate (design round 2,
 * D9; UX round 2, U8).
 *
 * The app HOLDS the fact it needs: the press carried an owner epoch, the live
 * epoch is different, so the runtime that would have answered it has been
 * replaced. It does not need the backend's sentence — "This answer belongs to an
 * earlier session owner" names an owner the user has never met, says nothing
 * they can picture, and reads as alarming on a first pass in a way nothing on
 * screen supports. The family's other sentences name a cause the reader can see
 * ("already answered somewhere else", "already been settled or moved on") and
 * close on the same consequence; this one now does too.
 *
 * AND IT IS THE SAME SENTENCE ON BOTH SURFACES. A rollover refusal arrives with
 * the gate still painted (measured: the question is still pending and still
 * answerable), so the card arm is the one a plain press reaches — while the
 * composer arm is the one a race reaches. Rendering the backend's raw `detail` on
 * one and an authored sentence on the other made the copy a function of whether
 * the state push beat the refusal, which is a fact no user can see (UX round 2,
 * U8). `answerReport` now chooses the sentence from the outcome class first and
 * the surface second, so this string is what both surfaces carry.
 */
export const ANSWER_LOST_TO_RECONNECT_MESSAGE =
	"Your answer was not sent. The app reconnected to a new runtime instance, so the question was not answered here.";

/**
 * The sentence for a press whose fate is genuinely UNKNOWN.
 *
 * A failure that carried no HTTP response at all — the transport died, the
 * request timed out, a runtime exception was thrown — says nothing about what
 * the owner did with the request. It may never have arrived; it may have been
 * admitted and settled, with only its response lost. Measured on the UX round's
 * own flow (a 1.5 s response hold, the backend killed at +160 ms): the owner HAD
 * kept the pressed label, the answer log recorded `status: 200` and an
 * `answeredAt`, `deliveredAt` never happened, and the composer said "Your answer
 * was not sent" while the model was already acting on it — the same false report
 * this branch exists to remove, reachable through the transport instead of
 * through the DOM (UX round 1, U1).
 *
 * So this arm does not claim an outcome. It states what is known (the request's
 * fate was never established) and that the rest is not knowable, which is the
 * register the app already uses for the same reason elsewhere
 * (`SEND_UNCONFIRMED_MESSAGE` in `canonical-sessions-store.ts`, and the main
 * process's own deadline detail — "It may or may not have reached the server;
 * check the result before repeating it").
 *
 * `--drop-answers` (a response that never starts) and `--hold-answers-ms` (a
 * request the app gives up on) are the two rig knobs that reach it.
 *
 * ## Why it is the sentence the CARD arm carries too (UX round 2, U7; QA Q1)
 *
 * The register is a property of the OUTCOME, not of the surface that happens to
 * be painted. The card arm used to take the definite not-sent sentence for every
 * failure, so the deadline shape — which leaves the card up *precisely because*
 * the request is still in flight — printed "Your answer was not sent" and then
 * denied it in the next clause ("It may or may not have reached the server"),
 * and then the card unmounted with the report. One error class, two opposite
 * claims, decided by a render fact. `answerReport` now picks the sentence first
 * and the destination second, so an unknowable outcome says so wherever it is
 * reported.
 */
export const ANSWER_UNCONFIRMED_LEAD =
	"Whether your answer landed is not knowable.";

/**
 * The whole sentence: the unknown register, then the app's own reason.
 *
 * The reason is kept because the two failures that reach this arm say different
 * things and both are worth reading — the transport's own "Desktop controls could
 * not reach the backend process" and the deadline's "the app waits up to 20
 * seconds for this request … check the result before repeating it", which already
 * tells the user not to press again blindly.
 */
export const answerUnconfirmedMessage = (error: unknown): string =>
	`${ANSWER_UNCONFIRMED_LEAD} ${userFacingMessage(
		error,
		"The request could not be completed.",
	)}`;

/**
 * Whether this failure is the answer route refusing, carrying no typed code.
 *
 * ## What the STATUS establishes, and what it does not
 *
 * The route answers a bare `409` for EVERY answer the owner will not take, and
 * the entailment runs one way only: a settlement IS a bare `409` — measured on
 * the committed rig (`harness/probe-answer-exclusivity.py`: two concurrent
 * answers with DIFFERENT labels plus a third after the gate settles, six
 * rounds, exactly one `2xx` per gate and always the label `owner-answer.json`
 * records the owner as having taken, a bare `409` for the concurrent loser and
 * the late answer alike) — but a bare `409` is NOT necessarily a settlement.
 * The same route raises the epoch-rollover and question-index refusals in the
 * same shape and with no code, which is why the three sentences are chosen from
 * the live facts in `PressFrame` rather than from the status (see
 * `answerReport`). The absent `code` is why this test reads
 * `status === 409 && code === undefined`: a CODED 409 comes from the relay and
 * attachment ladders instead (`errors()` and its 413/422 neighbours in
 * `desktop_sessions.py`), and those are not this.
 *
 * What the predicate is fit for is therefore the SENTENCE, which is written to
 * be true of the whole set, and never a claim about which member it was.
 *
 * ## Why the status is nevertheless the only instrument here
 *
 * The exclusivity is the owner's own rather than an inference from the status:
 * `serving.py`'s `_resolve_pending` pops the future off `_pending_futures` on
 * the owner's loop inside `settle()`, so the caller that pops it is the only one
 * that can settle, and a second answer to the same question is refused;
 * `attached.py`'s `answer_gate` refuses a request_id the bridge no longer
 * projects; and `desktop_sessions.py`'s `answer` maps both refusals onto that
 * 409. A `2xx` therefore means OUR value is the one the owner applied, which is
 * the property everything below rests on.
 */
export const answerRefusedWithoutACode = (error: unknown): boolean =>
	error instanceof DesktopControlError &&
	error.status === 409 &&
	error.code === undefined;

/**
 * The card's own not-sent sentence, for a failure that is not that refusal.
 *
 * Since the card can be gone by the time the outcome lands — the whole subject
 * of `answerReport` — this sentence now has TWO surfaces, so one expression
 * builds it and the card and the composer cannot disagree about what happened to
 * the same press. The consequence-first order (what happened, then the reason)
 * is `userFacingMessage`'s caller contract for an authored failure; a runtime
 * exception never reaches it as copy, which is why the fallback is a sentence
 * rather than `error.message`.
 */
export const unsentAnswerMessage = (error: unknown): string =>
	`Your answer was not sent. ${userFacingMessage(
		error,
		"The request could not be completed.",
	)}`;

/**
 * What one option press reports, and WHERE it reports it.
 *
 * ## Why the press's OUTCOME decides this, and never the card
 *
 * This used to be decided by reading the DOM: the verdict was "is the card this
 * press was made on still on screen?". A press that WON was therefore reported
 * lost whenever its own success had already removed that card — which is the
 * case, not a corner: the two channels have no ordering between them. Resolving
 * the gate makes the owner push frontend state, which unmounts the card, and the
 * answer POST settles on its own schedule. The margin is a few hundred
 * milliseconds either way and it is a FRESH SAMPLE every time the rig is run — the
 * committed records have read the delivery leading the clearing, and the clearing
 * leading the delivery by a quarter of a second — so the point is not the number
 * but that no number is stable: any margin that size inverts under load, and
 * inverted it told the user their answer was not sent while the model was already
 * acting on it.
 *
 * `answeredAt` and `deliveredAt` in each `click-result.json` are the measurements,
 * and they are the ones to read rather than a figure quoted here: prose that names
 * the millisecond figures is wrong the moment the set is re-taken, which is what
 * round 2's MINOR-2 caught in this very comment (it had quoted one sweep's
 * numbers).
 *
 * The outcome cannot be raced that way and needs no proxy for it — see
 * `answerRefusedWithoutACode` for the measurement that shows a `2xx` is our
 * value and a refusal is not. So a `sent` outcome is silence: the owner has this
 * press, and saying anything at all is the bug this replaces.
 *
 * ## The four cases, and why each goes where it goes
 *
 * - `refused` — nothing was sent (the lock was held, the gate is not an ask, the
 *   session has no owner epoch), so nothing is said here; the surface that holds
 *   the lock is the one that reports.
 * - `sent` — silence, and the caller settles the card's own hold.
 * - `failed` with the PRESSED card still on screen and still the pressed
 *   question — the refusal belongs on the surface the press was made on: it is
 *   unmissable there and cannot be repeated, because the card holds its options
 *   disabled until the gate moves.
 * - `failed` otherwise — the composer carries it, because the composer is the
 *   only surface that survives a gate change.
 *
 * ## The three bare `409`s are told apart by LIVE facts, not by the status
 *
 * A codeless `409` from this route is three different events (code review round
 * 1, MAJOR-1; the bodies are on `SETTLED_ELSEWHERE_MESSAGE`), and a sentence that
 * names one of them for all three is false in two. The app cannot read the
 * backend's reason out of the status — `desktop-contract.ts` refuses to read a
 * `409` as a category at all, on the grounds that only the answering process can
 * say which — but it does not have to guess, because it holds the two facts that
 * separate them:
 *
 *   - **The owner epoch this press addressed against the live one.** A rollover
 *     mints a new epoch (`frontend_state.py`) and the request carries the old
 *     one, so the answer is refused with the question still pending — measured:
 *     `409 {"detail":"This answer belongs to an earlier session owner"}` on a
 *     gate that was still live and still answerable. Different epoch ⇒ the press
 *     was addressed to a dead runtime instance, and nothing about another front
 *     end can be claimed.
 *   - **The key of the gate the app is painting against the press's own.** Same
 *     `request_id`, different `question_index` ⇒ the ask advanced and refused an
 *     answer addressed to the previous question (`409 {"detail":"the answer does
 *     not match the current question"}`). No gate at all ⇒ something settled it,
 *     and since a press the owner took answers `2xx`, that something was not this
 *     press — which is what makes "answered somewhere else" a fact here.
 *
 * ## Why the report carries a code of its own (design round 1, D2)
 *
 * `chat-page`'s alert reads `activeErrorCode = sendErrorCode ?? draft.errorCode`,
 * so a report that leaves the code UNSET inherits whatever code the draft was
 * last left holding — and the same sentence then renders with the generic "Send
 * it again" hint in one session and without it in another, or with a stale
 * attachment remedy's buttons under a sentence about an option press. That is
 * the inheritance defect already recorded for the attachment refusal, and this
 * path had it too. So a composer report always names a code: the transport's own
 * when the failure carried one, `ANSWER_NOT_SENT_CODE` when it did not, and
 * `UNCONFIRMED_SEND_CODE` for the arm whose outcome is genuinely unknown — all
 * three listed by `withholdsRetryHint`, because "Send it again" is not the remedy
 * for a press whose question is gone and not a promise this app can make for one
 * it never heard back about.
 */
export type AnswerReport =
	/** Nothing was sent, so the lock holder reports it. */
	| { readonly to: "refused" }
	/** The owner took this press: say nothing, and settle the card's hold. */
	| { readonly to: "sent" }
	/**
	 * The pressed card is still on screen, so it carries the sentence — the same
	 * one the composer would carry, chosen from the outcome rather than from the
	 * surface (see `answerReport`).
	 */
	| { readonly to: "card"; readonly refused: string }
	/** The card is gone, so the composer carries the report. */
	| {
			readonly to: "composer";
			readonly message: string;
			/**
			 * Never absent, so the alert's own hint and remedies are a function of
			 * THIS report rather than of the draft's last failure (see the type's
			 * note above).
			 */
			readonly code: string;
	  };

/**
 * The live facts about a press, read when its outcome lands.
 *
 * Everything here is a value the app holds NOW rather than the render-closure
 * snapshot the press started in, and that distinction is the whole reason this
 * type exists: the closure the async handler resumes with is the one the press
 * was made in, so reading the gate or the epoch from it compares the press with
 * itself — the inert conjunct this branch deleted. `chat-page.tsx` carries these
 * in refs for exactly that reason.
 *
 * `cardOnScreen` is the one DOM fact, and it is a fact about the RENDER rather
 * than about the press: it is true for any `Answer options` card, so on its own
 * it is satisfied by the next question's card, which cannot render this press's
 * refusal. `liveGateKey` is what makes it the PRESSED card's.
 */
export type PressFrame = {
	/** `request_id:question_index` of the gate the app is painting, or null. */
	readonly liveGateKey: string | null;
	/** The same key for the gate this press addressed. */
	readonly pressedGateKey: string;
	/**
	 * The owner epoch the press carried, and the one the app holds now. Both are
	 * nullable because `ownerEpoch` is null until the frontend snapshot lands —
	 * and a press that reached the route always carried a non-null one, since
	 * `answerGateOption` refuses without an epoch before it sends.
	 */
	readonly sentEpoch: string | null;
	readonly liveEpoch: string | null;
	/** Whether an `Answer options` card is on screen at all. */
	readonly cardOnScreen: boolean;
};

const TRANSPORT_LOST_SIGHT_CODES: ReadonlySet<string> = new Set([
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_REFUSAL_CODE.transportFailed,
	DESKTOP_LOST_SIGHT_CODE.runtimeUnreachable,
]);

/**
 * Whether this failure says nothing at all about what the owner did.
 *
 * Four shapes, and each is a way the app can lose sight of the request without
 * the OWNER refusing it:
 *
 * - **No HTTP response at all** — a runtime exception, or a `DesktopControlError`
 *   whose `status` is `null` (the transport returned no response).
 * - **The app's own DEADLINE** (`deadline_exceeded`) — this process stopped
 *   waiting on a backend that may still be working, which the main process's own
 *   sentence already says: "It may or may not have reached the server; check the
 *   result before repeating it" (measured: `--hold-answers-ms` renders it).
 * - **The app's own TRANSPORT failure** (`transport.failed`) — main could not
 *   complete the request, so nothing was established about whether it arrived.
 * - **The DAEMON's own hop failure** (`runtime_unreachable`) — the daemon could
 *   not hand the answer to the session's owner, and that frame is write-then-await
 *   -ack, so the request may have arrived and settled with only its ack lost
 *   (`DESKTOP_LOST_SIGHT_CODE` carries the path). This is the same fact
 *   `transport.failed` carries one hop up, and treating the two differently was
 *   round 2's MAJOR-1: the app classified main's lost request as unknowable and
 *   the daemon's as a refusal, so an owner that kept the answer and lost its ack
 *   produced the definite sentence.
 *
 * What is deliberately NOT here is a status the BACKEND chose as a REFUSAL: a
 * `503` with `pairing.plane-closed` (the daemon will not admit this app), a
 * `401/403`, a coded `409` — those were answered, and the answer was a refusal.
 * `pairing.no-credential` is excluded for the opposite reason to the three codes
 * above: main refused to send the request at all.
 */
export const answerOutcomeIsUnknown = (error: unknown): boolean =>
	!(error instanceof DesktopControlError) ||
	error.status === null ||
	(error.code !== undefined && TRANSPORT_LOST_SIGHT_CODES.has(error.code));

/**
 * The report for one option press, from its outcome plus the live facts.
 *
 * ## The sentence is chosen by the OUTCOME, the destination by the FRAME
 *
 * That order is the whole of round 2's U7/Q1, and it is why this function reads
 * as two steps rather than one: the register a failure is entitled to is a
 * property of the failure, and a surface that happens to be painted cannot change
 * it. Deciding the destination first meant the card arm took the definite not-sent
 * sentence for every failure — so the deadline shape, which leaves the card up
 * *precisely because* the request is still in flight, printed "Your answer was not
 * sent" and then denied it in its next clause ("It may or may not have reached the
 * server").
 *
 * The frame still decides WHETHER a failure is reported and WHERE, which is the
 * split this branch exists to make: the pressed card is removed BY the press that
 * won, so no reading of the card can decide whether a press won. Its two halves are
 * asserted together (`cardOnScreen && liveGateKey === pressedGateKey`) rather than
 * separately, because either alone is satisfied by a state this report cannot use:
 * a card on screen may be the NEXT question's (design round 1, D1), and a live gate
 * with the card gone is a render that has not painted yet.
 */
export const answerReport = (
	outcome: AnswerOutcome,
	frame: PressFrame,
): AnswerReport => {
	if (outcome.status === "refused") return { to: "refused" };
	if (outcome.status === "sent") return { to: "sent" };
	const sentence = pressSentenceFor(outcome.error, frame);
	if (frame.cardOnScreen && frame.liveGateKey === frame.pressedGateKey)
		return { to: "card", refused: sentence };
	return {
		to: "composer",
		message: sentence,
		code: composerCodeFor(outcome.error),
	};
};

/**
 * What a press that did not land says, whichever surface carries it.
 *
 * The order of the tests is the argument, not an implementation detail:
 *
 * 1. **An outcome the app cannot know** — no HTTP response at all, its own
 *    `deadline_exceeded` or `transport.failed`, or the daemon's
 *    `runtime_unreachable` — says so and nothing more (`answerOutcomeIsUnknown`).
 * 2. **A codeless `409` from a DIFFERENT epoch** — the press was addressed to a
 *    runtime instance that is gone, so nothing about who answered the question is
 *    established and the app must not claim another front end did. It says what it
 *    knows in its own voice (`ANSWER_LOST_TO_RECONNECT_MESSAGE`), which is also
 *    what the card carries for the same refusal (UX round 2, U8).
 * 3. **A codeless `409` with no gate pending** — something settled the question,
 *    and it was not this press (a press the owner took answers `2xx`).
 * 4. **A codeless `409` with a gate that is not the pressed question** — the ask
 *    advanced past the question this press answered.
 * 5. **A codeless `409` with the pressed question STILL LIVE** — the one state the
 *    first four do not name, and the one that falls through to the backend's own
 *    reason below. A `409` never settled OUR value, so the not-sent half holds; and
 *    with the gate still current the app has nothing better to say than what the
 *    route said (agent review round 2, NIT-4).
 * 6. Everything else — a status the backend really sent as a refusal (a `503` with
 *    `pairing.plane-closed`, a coded `409` from the relay or attachment ladders),
 *    where "your answer was not sent" is what the backend just said.
 */
const pressSentenceFor = (error: unknown, frame: PressFrame): string => {
	if (answerOutcomeIsUnknown(error)) return answerUnconfirmedMessage(error);
	if (answerRefusedWithoutACode(error)) {
		if (frame.liveEpoch !== frame.sentEpoch)
			return ANSWER_LOST_TO_RECONNECT_MESSAGE;
		if (frame.liveGateKey === null) return SETTLED_ELSEWHERE_MESSAGE;
		if (frame.liveGateKey !== frame.pressedGateKey)
			return QUESTION_MOVED_ON_MESSAGE;
	}
	return unsentAnswerMessage(error);
};

/**
 * The code the composer's alert reads for a press report.
 *
 * Three arms, one per question the alert asks of a code, and each stated by the
 * failure that owns it: the transport's own code where there is one (so a coded
 * refusal keeps its own remedies), `UNCONFIRMED_SEND_CODE` where the outcome is
 * unknown (the app's existing code for exactly that, whose own sentence is about
 * a send it could not confirm), and `ANSWER_NOT_SENT_CODE` otherwise (the
 * definite loss: the question is gone and there is nothing to press again).
 */
const composerCodeFor = (error: unknown): string => {
	/*
	 * The unknown arm is decided FIRST, and it overrides a carried code on purpose
	 * (UX round 1, U1). Its carried codes are `deadline_exceeded` and
	 * `transport.failed`, and neither is in `withholdsRetryHint` — so keeping one
	 * would put "Send it again" under a sentence whose own reason says "check the
	 * result before repeating it". `UNCONFIRMED_SEND_CODE` is the app's existing
	 * code for exactly this state and withholds the hint.
	 */
	if (answerOutcomeIsUnknown(error)) return UNCONFIRMED_SEND_CODE;
	return errorCodeOf(error) ?? ANSWER_NOT_SENT_CODE;
};

/** The `sessions.answer` request, as the wire contract defines it. */
export type GateAnswerRequest = Extract<
	DesktopRequest,
	{ op: "sessions.answer" }
>;

/**
 * What became of one option press.
 *
 * `refused` means the request was never sent — the gate is not an ask, the
 * session or owner cannot be addressed, or another send/answer already holds the
 * lock. It is distinct from `failed`, which means the request WAS sent and the
 * transport threw; only the second is worth putting in front of the user, since
 * the first is the one-answer-in-flight property working.
 */
export type AnswerOutcome =
	| { status: "sent" }
	| { status: "refused" }
	| { status: "failed"; request: GateAnswerRequest; error: unknown };

/**
 * Send one option's label as the answer to the pending `ask` gate.
 *
 * This is `send`'s gate branch with the transport injected, extracted so it can
 * be exercised without a DOM: the round-1 review's point was that nothing
 * asserted the body this path emits nor the lock that keeps it to one request,
 * because both lived inside a component that needs a browser to render.
 * `chat-page.tsx` calls it with `desktopResult`; the test calls it with a
 * recorder.
 *
 * The lock is taken BEFORE the build and released in a `finally`, and there is
 * no `await` between the test and the claim — that ordering is the whole
 * one-answer-in-flight guarantee, not an implementation detail.
 */
export const answerGateOption = async (
	deps: {
		gate: Pick<PendingDesktopGate, "kind" | "request_id" | "question_index">;
		sessionId?: string | null;
		epoch?: string | null;
		label: string;
		lock: SendLock;
	},
	send: (request: GateAnswerRequest) => Promise<unknown>,
): Promise<AnswerOutcome> => {
	const { gate, sessionId, epoch, label, lock } = deps;
	// Preconditions first. Taking the lock before these would leave the composer
	// disabled on a request that was never sent, which is how a gate with no owner
	// epoch used to brick the composer until a reload.
	if (gate.kind !== "ask" || !sessionId || !epoch) return { status: "refused" };
	if (!lock.tryAcquire()) return { status: "refused" };
	const request: GateAnswerRequest = {
		op: "sessions.answer",
		sessionId,
		epoch,
		requestId: gate.request_id,
		// The option's LABEL, never its index: the wire contract is "answer with
		// the label the model wrote" (`ask_picker.py`: "It answers with TEXT, not
		// an index"), and the free-text row the terminal card carries can return a
		// string that was never in `options`, which an index cannot express.
		value: label,
		questionIndex: gate.question_index,
	};
	try {
		await send(request);
		return { status: "sent" };
	} catch (error) {
		return { status: "failed", request, error };
	} finally {
		lock.release();
	}
};
