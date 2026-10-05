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
 * - **`ask` gates with options only.** A `secret` ask carries empty options, so
 *   nothing matches, and an approval — which carries no wire options at all —
 *   is resolved by its own rule (`approvalAnswerValue`), never by this one.
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
	withBusyResends,
} from "@shared/store/canonical-sessions-store";
import {
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_LOST_SIGHT_CODE,
	DESKTOP_REFUSAL_CODE,
	RUNTIME_BUSY_CODE,
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
 * The two options an approval card offers.
 *
 * ## Why the client owns these labels
 *
 * The wire carries NO options for an approval: `PendingRequest` for
 * `kind="approval"` is a title (the tool name) and a detail (the action), and
 * the answer route takes a strict boolean. Unlike an ask — whose labels are the
 * model's and must travel back on the wire verbatim — there is no label the
 * daemon is waiting to hear. So the pair is the app's own vocabulary, and it
 * lives here, once, because three call sites need the same two strings in the
 * same order: the card's buttons (`canonical-transcript.tsx`), the ordinals the
 * card prints and a composer answer resolves through `approvalAnswerValue`
 * below, and the request `answerGateOption` builds.
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
 * lie. (Initial copy; the design round owns the final wording.)
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
 * Whether an `ask` gate takes a SECRET — ONE predicate for every consumer.
 *
 * The wire type says `secret: boolean` (`desktop-session-contract.ts`), but the
 * field is PUSHED and runtime-unvalidated, so a value that is not a boolean has
 * to have a meaning. This reads TRUTHINESS, and fails CLOSED: anything JS reads
 * as true takes the masked treatment (the dock's field, the closed composer,
 * the `answerGateSecret` door), because the cost of masking an ask that meant
 * "not secret" is a field the user answers normally, while the cost of the
 * other reading is a credential typed in clear into a surface that persists it
 * — the exposure this path exists to remove.
 *
 * It exists because the reading was once spelled THREE ways: the composer
 * closure tested `=== true`, the page's send refusal and the dock tested
 * truthiness, and `answerGateSecret` refused anything but `=== true`. For a
 * contract-violating truthy value that mix left the dock painting a masked
 * field and refusing the value while the composer stayed OPEN — the typing and
 * draft-persistence exposure this feature removes (agent review round 1,
 * NIT-1). Every site imports this now, so the consumers cannot disagree again.
 */
export const gateIsSecret = (
	gate: Pick<PendingDesktopGate, "secret"> | null | undefined,
): boolean => Boolean(gate?.secret);

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
 * The sentence for a press the route could not hand to a BUSY owner, after the
 * app's own repeats are spent.
 *
 * The answers route answers `503 {"code": "runtime_busy", "retryable": true,
 * "retry_after_ms": 2000}` when the session's owner is alive and not answering
 * its attach socket. Two things about that arm decide this copy, and both were
 * design round 1 on the backend change (D1/D2/D4/D5):
 *
 *  - IT MUST NOT CLAIM THE ANSWER WAS NOT SENT. The busy refusal is raised for
 *    `RuntimeUnresponsiveError` AND for an ack timeout on a live owner
 *    (`desktop_sessions.py`), and the second is the write-then-wait path this app
 *    records on `DESKTOP_REFUSAL_CODE.transportFailed`: the frame was written and
 *    only its acknowledgement was lost. So the answer may have been taken, and
 *    this arm takes the unknowable register, exactly as the deadline and lost-hop
 *    arms do. The app's own bounded repeat (`withBusyResends`, spent before this
 *    sentence can paint) is what makes that acceptable to say in the first place.
 *
 *    THE SEND PATH HOLDS THE SAME EXPOSURE, and its copy is not changed here
 *    (agent review round 1, MINOR-2, which corrected an earlier draft of this
 *    note). That draft rested the argument on "nothing was admitted is true of
 *    `runtime_busy` on `/messages`", and the merged ladder does not support it:
 *    the busy refusal is raised from the SHARED `errors()` ladder, whose second
 *    arm is the generic ack timeout on a live owner, and that ladder wraps
 *    `/v1/desktop/sessions/{id}/messages` too - where admission is itself an
 *    acked write (`AttachedSession.admit_prompt` ends in
 *    `request_ack_with_duplicate`). So a send can meet this code over a
 *    write-then-wait loss, where `SEND_FAILURE_COPY.busy`'s "your message wasn't
 *    sent" is as unprovable as the sentence this arm replaced. Nothing about the
 *    ANSWER path changes either way - that arm's classification and copy are right
 *    on both raise arms - and the send half is deferred rather than fixed
 *    silently, because it is a copy decision about a different surface.
 *  - IT MUST NOT CARRY THE BACKEND'S PROSE. The route's sentence on this arm is
 *    the unreachable one - "Reconnect and reconcile before retrying" - which
 *    names a control this screen does not have and tells the user to retry what
 *    the app has already retried. The app's own noun for this owner is "the
 *    agent" (`SEND_FAILURE_COPY.busy`), not "the session owner".
 *
 * "isn't confirmed yet" rather than "wasn't sent" is the whole finding, and
 * "yet" is load-bearing: the owner may still take it, and the app may still be
 * told so.
 *
 * ITS LEAD IS DELIBERATELY ITS OWN, not `ANSWER_UNCONFIRMED_LEAD` (agent review
 * round 1, NIT-1). The sibling arm composes its lead so the two "outcome is not
 * knowable" sentences cannot drift apart, and composing this one too would put
 * that longer register - "Whether your answer landed is not knowable." - in front
 * of a sentence the design round chose short for a measured reason: the band
 * wraps to two lines at the 172 px column and the shorter candidate is the one
 * that fits it (`composer-notice-arms`, the busy arm's three widths). The factual
 * claim is the same one the lead makes ("isn't confirmed YET"), stated in the
 * first person of a press rather than the passive; the drift risk the sibling's
 * composition guards against is one of wording between two sentences that say the
 * same thing, and here the wording is the point.
 */
export const ANSWER_BUSY_MESSAGE =
	"Your answer isn't confirmed yet. The agent is busy.";

/**
 * The sentence for a press addressed to a session the app could not reach at all.
 *
 * `runtime_unreachable` is the daemon's own hop failure: it could not hand the
 * request to the session's owner, so nothing is established about whether the
 * answer arrived (see `DESKTOP_LOST_SIGHT_CODE`). The LEAD is therefore already
 * right and is kept verbatim - it is photographed in the committed
 * `ask-options-live/unknown-composer` frames - and what changes is the reason:
 * the backend's "Session owner is unavailable. Reconnect and reconcile before
 * retrying" is replaced by a fact and a full stop.
 *
 * BOTH HALVES OF THE BACKEND SENTENCE HAD TO GO, and neither for style. "Session
 * owner" is the app's WIRE noun, which is why `mcp-failure.ts` matches the
 * backend's text for its MCP row and why that text must not be reworded (a
 * shipped renderer prefix-matches it, so a backend rewording is a UI regression
 * on every un-updated machine). "Reconnect and reconcile" names no control on
 * screen, and after the ownerless-attach work the app re-dials for reads on its
 * own - the instruction is stale as well as unactionable (design round 1, D3;
 * the refusal table's own rule against remedies the user cannot perform).
 *
 * It is composed from the shared lead rather than spelled out, so the two arms
 * that say "the outcome is not knowable" cannot drift apart in one word.
 */
export const ANSWER_SESSION_UNREACHABLE_MESSAGE = `${ANSWER_UNCONFIRMED_LEAD} The app could not reach this chat's session at all.`;

/**
 * Whether this failure is the answers route's retryable-busy refusal.
 *
 * Keyed on the CODE and never the status: a `503` on a `/v1/desktop/` route is
 * also how the desktop plane refuses this app (`pairing.plane-closed`), which IS
 * an answer about the request rather than a lost sight of it.
 */
export const answerOwnerIsBusy = (error: unknown): boolean =>
	error instanceof DesktopControlError && error.code === RUNTIME_BUSY_CODE;

/**
 * Whether this failure is the daemon's own hop failure to the session's owner.
 *
 * The sibling of `answerOwnerIsBusy`, and separate from it for the same reason
 * the two codes are separate: `runtime_busy` says the owner is there and not
 * answering, `runtime_unreachable` says the daemon could not get to it. One
 * sentence each, and neither may borrow the other's.
 */
export const answerSessionUnreachable = (error: unknown): boolean =>
	error instanceof DesktopControlError &&
	error.code === DESKTOP_LOST_SIGHT_CODE.runtimeUnreachable;

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
 * `ANSWER_UNCONFIRMED_CODE` for the arm whose outcome is genuinely unknown — all
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
	| {
			readonly to: "card";
			readonly refused: string;
			/**
			 * Whether the failure DEFINITELY did not send this answer, so the surface
			 * that kept the pressed value may send it again. `true` for every arm but
			 * `answerOutcomeIsUnknown`'s: a definite refusal was established by the
			 * owner (or by the app's own reading of a refusal that never settled our
			 * value), and the card arm's own frame says the pressed question is still
			 * the live one, so a retry carries the live epoch and cannot double-settle.
			 * `false` — the unknowable arm — keeps the hold: the answer may have
			 * landed, so repeating it could send it twice. The secret card is the one
			 * consumer (`question-dock.tsx`): its composer is closed, so a hold would
			 * strand the kept value with nothing able to send it.
			 */
			readonly retryable: boolean;
			/**
			 * The register, as a property of the ARM rather than of the surface that
			 * happens to render it: `true` only for the retryable-busy arm, which is a
			 * failure the app is absorbing rather than one the user must repair (design
			 * round 1, D4). The card paints it through `muted` on the same band the
			 * composer's alert reads.
			 */
			readonly muted: boolean;
	  }
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
			/** The arm's register; see the card arm's field. */
			readonly muted: boolean;
			/**
			 * ALWAYS `false`, and carried rather than left unset for the reason the
			 * code is: the alert reads a retry verdict it may inherit, and an earlier
			 * send's `true` would lay out a control row for a press that no press can
			 * fix. The composer's only retry control is Send over whatever the box
			 * holds (`chat-page.tsx`'s `onRetry`), and for an option press that is not
			 * the question that failed — the press's own retry is the option, or the
			 * app's bounded repeat, which has already been spent by the time this
			 * report exists (design round 1, D5: "the notice's control row is laid out
			 * for `retry: true` while `onRetry` is absent").
			 *
			 * Typed as the LITERAL `false` rather than `boolean` (agent review round 1,
			 * NIT-2): the invariant is compile-time rather than a runtime value a later
			 * edit could set to `true` at this one construction site.
			 */
			readonly retry: false;
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
	RUNTIME_BUSY_CODE,
]);

/**
 * Whether this failure says nothing at all about what the owner did.
 *
 * Five shapes, and each is a way the app can lose sight of the request without
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
 * - **The answers route's RETRYABLE-BUSY refusal** (`runtime_busy`) — the fifth
 *   shape, and the one that had to be argued rather than read off a code table.
 *   The route raises it for a live owner that is not answering AND for an ack
 *   timeout on that same live owner (`desktop_sessions.py`), and the second is
 *   the write-then-wait path the bullet above describes: the frame was written
 *   and only its acknowledgement was lost, so the answer may have been taken.
 *   Nothing-admitted is true of `runtime_busy` on `/messages` and is NOT true
 *   here, which is design round 1's D1 — the false "Your answer was not sent"
 *   this arm used to paint. It is in this set rather than in a branch of its own
 *   because the two things the set is read for are both correct for it: the
 *   sentence it is entitled to (an unknowable register, painted by
 *   `ANSWER_BUSY_MESSAGE`) and the verdict the kept value's retry hangs on (the
 *   hold stays — a repeat could send an answer that already landed).
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
	/*
	 * The register is read once, from the arm, and travels with the sentence to
	 * whichever surface paints it: the busy arm is a failure the app is still
	 * absorbing, every other arm is the user's to read as a failure (design round
	 * 1, D4).
	 */
	const muted = answerOwnerIsBusy(outcome.error);
	if (frame.cardOnScreen && frame.liveGateKey === frame.pressedGateKey)
		return {
			to: "card",
			refused: sentence,
			// The classification the KEPT VALUE's retry hangs on: definite arms are
			// established not-sent, the unknowable one is not (see the field's own
			// note on `AnswerReport`).
			retryable: !answerOutcomeIsUnknown(outcome.error),
			muted,
		};
	return {
		to: "composer",
		message: sentence,
		code: composerCodeFor(outcome.error),
		muted,
		/*
		 * `false` for every press, and SET rather than left to the alert's last
		 * failure: see the field's own note (design round 1, D5).
		 */
		retry: false,
	};
};

/**
 * What a press that did not land says, whichever surface carries it.
 *
 * The order of the tests is the argument, not an implementation detail:
 *
 * 1. **The answers route's retryable-busy refusal** (`runtime_busy`) — the owner
 *    is alive and not answering, and the frame is write-then-wait, so the app can
 *    neither say the answer landed nor say it did not. It says exactly that
 *    (`ANSWER_BUSY_MESSAGE`), and it is checked FIRST because it is also in
 *    `answerOutcomeIsUnknown`'s set (arm 3 below would otherwise claim it with the
 *    generic lead). Design round 1, D1/D4.
 * 2. **The daemon's hop failure to the owner** (`runtime_unreachable`) — also an
 *    unknowable arm, and again a sentence of its own rather than the backend's
 *    (`ANSWER_SESSION_UNREACHABLE_MESSAGE`), because the route's "Reconnect and
 *    reconcile before retrying" is stale and names no control this screen has.
 *    Design round 1, D3.
 * 3. **An outcome the app cannot know** — no HTTP response at all, its own
 *    `deadline_exceeded` or `transport.failed` — says so and nothing more
 *    (`answerOutcomeIsUnknown`).
 * 4. **A codeless `409` from a DIFFERENT epoch** — the press was addressed to a
 *    runtime instance that is gone, so nothing about who answered the question is
 *    established and the app must not claim another front end did. It says what it
 *    knows in its own voice (`ANSWER_LOST_TO_RECONNECT_MESSAGE`), which is also
 *    what the card carries for the same refusal (UX round 2, U8).
 * 5. **A codeless `409` with no gate pending** — something settled the question,
 *    and it was not this press (a press the owner took answers `2xx`).
 * 6. **A codeless `409` with a gate that is not the pressed question** — the ask
 *    advanced past the question this press answered.
 * 7. **A codeless `409` with the pressed question STILL LIVE** — the one state the
 *    first six do not name, and the one that falls through to the backend's own
 *    reason below. A `409` never settled OUR value, so the not-sent half holds; and
 *    with the gate still current the app has nothing better to say than what the
 *    route said (agent review round 2, NIT-4).
 * 8. Everything else — a status the backend really sent as a refusal (a `503` with
 *    `pairing.plane-closed`, a coded `409` from the relay or attachment ladders),
 *    where "your answer was not sent" is what the backend just said.
 */
/**
 * The code for a press whose outcome the app cannot establish.
 *
 * Its own code rather than the send's (which no longer exists as a category): the
 * two are statements about different acts, and the composer's decisions are made
 * from the notice the failure carries, so this is kept only as the code a reader
 * can branch on. `withholdsRetryHint` does not list it - a Retry on this arm is refused
 * by the notice's own `retry: false`, which is the answer of the failure that owns
 * it (an option whose question has moved on cannot be pressed again).
 */
export const ANSWER_UNCONFIRMED_CODE = "answer_unconfirmed";

const pressSentenceFor = (error: unknown, frame: PressFrame): string => {
	/*
	 * The two arms with a sentence of their OWN come first, and both are checked
	 * before the unknowable arm because both ARE unknowable outcomes - the busy arm
	 * is in that set, and `runtime_unreachable` always has been.
	 */
	if (answerOwnerIsBusy(error)) return ANSWER_BUSY_MESSAGE;
	if (answerSessionUnreachable(error))
		return ANSWER_SESSION_UNREACHABLE_MESSAGE;
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
 * refusal keeps its own remedies), `ANSWER_UNCONFIRMED_CODE` where the outcome is
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
	 * result before repeating it". `ANSWER_UNCONFIRMED_CODE` is the app's existing
	 * code for exactly this state and withholds the hint.
	 */
	if (answerOutcomeIsUnknown(error)) return ANSWER_UNCONFIRMED_CODE;
	return errorCodeOf(error) ?? ANSWER_NOT_SENT_CODE;
};

/**
 * The sentence for a typed send the composer REFUSES because the pending
 * question takes a secret.
 *
 * A `secret` ask is answered from the dock's own masked field
 * (`trace/question-dock.tsx`), and the composer is refused input for as long as
 * one waits — so this sentence is the one a door that still reaches
 * `chat-page.tsx`'s `send` (a suggestion chip, the stopped-turn Retry, any
 * programmatic route) is answered with. It says what happened, states the one
 * fact that makes the refusal make sense, and points at where the answer does
 * go — the register every authored refusal in this module owes the reader.
 * `ANSWER_NOT_SENT_CODE` travels WITH it (thrown as a `UserFacingError`), so
 * the composer's alert offers no press that cannot work, exactly as the
 * approval's "Reply yes or no" refusal does.
 */
export const SECRET_ANSWER_DOCKED_MESSAGE =
	"Your answer was not sent — a secret request is answered in the field above the composer.";

/** The `sessions.answer` request, as the wire contract defines it. */
export type GateAnswerRequest = Extract<
	DesktopRequest,
	{ op: "sessions.answer" }
>;

/**
 * What became of one option press.
 *
 * `refused` means the request was never sent — the gate is not an `ask` this
 * can address, the label is not one of an approval's pair, the session or owner
 * cannot be addressed, or another send/answer already holds the lock. It is
 * distinct from `failed`, which means the request WAS sent and the transport
 * threw; only the second is worth putting in front of the user, since the first
 * is the one-answer-in-flight property working.
 */
export type AnswerOutcome =
	| { status: "sent" }
	| { status: "refused" }
	| { status: "failed"; request: GateAnswerRequest; error: unknown };

/**
 * Send one option's label as the answer to the pending `ask` gate — or one of
 * the approval pair as the boolean answer to a pending `approval` gate.
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
 *
 * AN APPROVAL IS THE SAME ACT WITH A DIFFERENT BODY. Approve and Deny are
 * client-owned labels (`APPROVAL_OPTIONS`), the gate is still one-shot, so the
 * same lock, preconditions and `AnswerOutcome` apply; what changes is only what
 * leaves: `approved` as a strict boolean, and neither the label nor a question
 * index, because the wire for this kind takes a boolean alone and the daemon
 * route rejects `question_index` on it.
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
	//
	// The approval half is decided here too, and by the label: a press may only
	// carry one of `APPROVAL_OPTIONS`, so a label the pair does not know is the
	// same kind of refusal as an `ask` press that cannot be addressed — nothing
	// sent, nothing claimed. That is also what keeps a third, accidentally added
	// option from silently posting a verdict no rule defines.
	const verdict = gate.kind === "approval" ? approvalVerdict(label) : null;
	if ((gate.kind !== "ask" && verdict === null) || !sessionId || !epoch)
		return { status: "refused" };
	if (!lock.tryAcquire()) return { status: "refused" };
	const request: GateAnswerRequest =
		gate.kind === "approval"
			? {
					op: "sessions.answer",
					sessionId,
					epoch,
					requestId: gate.request_id,
					// THE BOOLEAN IS THE WHOLE BODY. The wire carries no options for
					// an approval, so there is no label to echo back, and the daemon
					// route rejects `question_index` on this kind — so neither `value`
					// nor `questionIndex` is set, and `approved` is the entire answer.
					approved: verdict === true,
				}
			: {
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
		/*
		 * THE APP'S OWN REPEAT, and the whole reason the busy arm's sentence can be
		 * silence-free rather than an instruction: a busy owner is not a failure the
		 * user has to read about, it is a moment the app waits out. The SAME
		 * `request` goes out again - the daemon's receipt is keyed on the body, and
		 * the answer route settles a repeat idempotently - so a press that landed
		 * while its ack was lost comes back as `sent` here rather than as a refusal
		 * (the backend change's retry-settled path, asserted there). Nothing is
		 * reported while it repeats; only the final refusal, if there is one,
		 * reaches `answerReport`.
		 */
		await withBusyResends(() => send(request));
		return { status: "sent" };
	} catch (error) {
		return { status: "failed", request, error };
	} finally {
		lock.release();
	}
};

/**
 * Send a TYPED secret as the answer to a pending `secret` ask gate.
 *
 * A SIBLING OF `answerGateOption`, not a second implementation of it: the same
 * `SendLock`, the same one-answer-in-flight guarantee, the same `AnswerOutcome`
 * and the same `sessions.answer` body the `ask` arm posts (`value` +
 * `questionIndex`). What differs is what it answers FROM — the dock's masked
 * field's typed value rather than an option label — and the preconditions that
 * make it the only path allowed to: the gate must actually be a secret ask, and
 * the value must actually be a value. `answerGateOption` cannot state either:
 * nothing in its preconditions reads the label it posts, and an empty string is
 * a legal "label" to it, so reusing it here would leave the empty-refusal and
 * the secret-only door as properties of the BUTTON that happens to be painted
 * rather than of the path.
 *
 * THE VALUE IS TRIMMED, and that is the parity pair's own rule rather than a
 * convenience: the phone card sends `freeText.trim()`
 * (`mobile/web/src/components/pending-card.tsx`) and the terminal picker
 * answers with `state.typed.strip()` (`tui/widgets/ask_picker.py`), because a
 * pasted token arrives with surrounding whitespace often enough that asking
 * the user to notice it is the defect — while whitespace INSIDE the value is
 * preserved, since `strip` is the two parity surfaces' whole rule too.
 *
 * NO ECHO, on purpose. The answer is not appended to the transcript: the owner
 * receives it as the question's answer and the press's own report
 * (`answerReport`) is the only user-visible consequence. That is what keeps a
 * credential out of the conversation record, and it is why this path must
 * never grow an optimistic echo the way a normal send has one.
 */
export const answerGateSecret = async (
	deps: {
		gate: Pick<
			PendingDesktopGate,
			"kind" | "request_id" | "question_index" | "secret"
		>;
		sessionId?: string | null;
		epoch?: string | null;
		value: string;
		lock: SendLock;
	},
	send: (request: GateAnswerRequest) => Promise<unknown>,
): Promise<AnswerOutcome> => {
	const { gate, sessionId, epoch, value, lock } = deps;
	// Preconditions first, for the reason `answerGateOption` states: taking the
	// lock for a request that was never sent leaves the submit control refused
	// until a reload.
	//
	// THIS DOOR IS FOR SECRET ASKS ALONE. A call aimed at any other gate — an
	// approval, an ask with options, a non-secret free-text ask — is the same
	// class of refusal as an approval label the pair does not know: nothing
	// sent, nothing claimed. The dock only ever wires it on `secret`, so a
	// refusal here is a door someone reached around the UI, and the safe
	// answer is to refuse rather than to post a typed string as an answer
	// whose rules this path does not know.
	//
	// The empty half is the field's own rule ("Send disabled while empty"),
	// stated a second time here so it is a property of the path: a value that
	// is nothing but whitespace is not an answer, and trimming before the
	// check is the same trim the wire value gets below.
	const trimmed = value.trim();
	// `gateIsSecret`, not `secret === true`: the SAME reading every other
	// consumer makes (agent review round 1, NIT-1), so a contract-violating
	// truthy value is masked, composer-closed and sendable through this door
	// rather than masked-but-unsendable (see `gateIsSecret`).
	if (gate.kind !== "ask" || !gateIsSecret(gate)) return { status: "refused" };
	if (!sessionId || !epoch || trimmed.length === 0)
		return { status: "refused" };
	if (!lock.tryAcquire()) return { status: "refused" };
	const request: GateAnswerRequest = {
		op: "sessions.answer",
		sessionId,
		epoch,
		requestId: gate.request_id,
		value: trimmed,
		questionIndex: gate.question_index,
	};
	try {
		// The same policy as the option path, and by the same argument: a secret is
		// an answer press too, and its owner can be just as busy.
		await withBusyResends(() => send(request));
		return { status: "sent" };
	} catch (error) {
		return { status: "failed", request, error };
	} finally {
		lock.release();
	}
};

/**
 * Send a QUEUED ask's whole answer — every question, atomically.
 *
 * A SIBLING of `answerGateOption`, for the reasons that method gives for its own
 * extraction (the body and the one-answer-in-flight lock must be assertable
 * without a DOM, and they cannot be while they live in a component). What
 * differs is the ADDRESS and the SHAPE:
 *
 * - **`ask_id`, not `request_id`.** A queued ask outlives the owner epoch that
 *   raised it, so this path deliberately carries no epoch - the route skips the
 *   epoch comparison for this shape and the single-winner rule lives on the ask
 *   log. Requiring one here would refuse exactly the case the feature exists for
 *   (a cold session whose asks are still open).
 * - **The WHOLE ask, not one question.** `answers` is keyed by question id, and
 *   the queue refuses a partial map, so a press that could only ever be refused
 *   is refused HERE, before the lock is taken - which is what keeps the Submit
 *   control honest rather than merely disabled-looking.
 *
 * The lock is taken before the build and released in a `finally`, with no
 * `await` between the test and the claim: that ordering is the whole
 * one-answer-in-flight guarantee, exactly as it is for the gate.
 */
export const answerQueuedAsk = async (
	deps: {
		taskId: string;
		answers: Record<string, string[]>;
		sessionId?: string | null;
		lock: SendLock;
	},
	send: (request: GateAnswerRequest) => Promise<unknown>,
): Promise<AnswerOutcome> => {
	const { taskId, answers, sessionId, lock } = deps;
	// Preconditions first, for the reason `answerGateOption` states: taking the lock
	// for a request that was never sent leaves the submit refused until a reload.
	if (!sessionId || !taskId) return { status: "refused" };
	if (Object.keys(answers).length === 0) return { status: "refused" };
	if (!lock.tryAcquire()) return { status: "refused" };
	const request: GateAnswerRequest = {
		op: "sessions.answer",
		sessionId,
		askId: taskId,
		answers,
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

/**
 * CHANGE a queued ask's recorded answer while the agent has not been handed it
 * (design §10, #1936).
 *
 * The sanctioned exception to the one-way rule, and the reason the user has a
 * door at all on a question they already answered: between the answer landing in
 * the log and the response row existing, the model has been told NOTHING, so the
 * answer is still the user's to change.
 *
 * THE PAYLOAD IS THE FIRST ANSWER'S, BYTE FOR BYTE, plus `revise: true` — the
 * WHOLE ask map keyed by question id, never a per-question amend. The design
 * names the value-equality trap this rules out: the intent cannot be read off the
 * values (equal is not a retry, different is not a revision), so the client states
 * it in a field, and an old registrant that never sees the op simply never
 * receives it.
 *
 * THE WINDOW IS THE BACKEND'S, NOT THIS CLIENT'S. This path does not test
 * `delivered` and does not compare the new map to the recorded one: `delivered`
 * is a deliberately sticky hint and the row is the real bound, so a client-side
 * pre-check would be a second opinion about a race it cannot see. The owner either
 * takes the revision or refuses it in its own sentence (the delivered refusal is
 * `already delivered — send a new message`), and that sentence is what the card
 * renders in place.
 */
export const reviseQueuedAsk = async (
	deps: {
		taskId: string;
		answers: Record<string, string[]>;
		sessionId?: string | null;
		lock: SendLock;
	},
	send: (request: GateAnswerRequest) => Promise<unknown>,
): Promise<AnswerOutcome> => {
	const { taskId, answers, sessionId, lock } = deps;
	// The same preconditions as the first-answer door, for the reason it gives:
	// taking the lock for a request that was never sent leaves the submit refused
	// until a reload. The empty-map term is here for the same reason it is there —
	// the queue refuses a partial or empty map, so a submit that could only ever be
	// refused is refused before the lock is claimed.
	if (!sessionId || !taskId) return { status: "refused" };
	if (Object.keys(answers).length === 0) return { status: "refused" };
	if (!lock.tryAcquire()) return { status: "refused" };
	const request: GateAnswerRequest = {
		op: "sessions.answer",
		sessionId,
		askId: taskId,
		answers,
		revise: true,
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

/**
 * Decline a QUEUED ask: the explicit "no answer — decide yourself".
 *
 * The same act as the blocking card's Esc, promoted to a control of its own
 * because a queued ask's Esc means COLLAPSE (design §5.0/§5.1 D5): the user's
 * "I am not answering this" has to be said on purpose rather than as a side
 * effect of wanting their transcript back.
 */
export const declineQueuedAsk = async (
	deps: { taskId: string; sessionId?: string | null; lock: SendLock },
	send: (request: GateAnswerRequest) => Promise<unknown>,
): Promise<AnswerOutcome> => {
	const { taskId, sessionId, lock } = deps;
	if (!sessionId || !taskId) return { status: "refused" };
	if (!lock.tryAcquire()) return { status: "refused" };
	const request: GateAnswerRequest = {
		op: "sessions.answer",
		sessionId,
		askId: taskId,
		decline: true,
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
