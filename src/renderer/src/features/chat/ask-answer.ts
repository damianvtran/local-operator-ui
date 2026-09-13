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
 * What the user is told when their press did not become the gate's answer.
 *
 * The gate can move out from under a press in two ways, and both end with the
 * user's answer NOT being the one the owner took:
 *
 * - the transport refused it (`failed`) because the question was no longer
 *   pending — the backend's own 409;
 * - the transport ACCEPTED it (`sent`) with a 200 after another front end had
 *   already answered — the case measured on the committed rig, where the app's
 *   delayed POST came back `200`, the owner kept the other front end's answer,
 *   and the user was told nothing at all (QA round 2, F-A; UX round 2, U9).
 *
 * The second is why this is a function of the gate's movement rather than of the
 * status code: a 200 is not proof that OUR answer was the one taken, and the
 * only thing the app can compare is whether the gate it pressed still stands.
 * That comparison is sound because the two orderings differ — measured on the
 * rig, a normal answer's POST response lands BEFORE its card clears (124ms
 * against 200ms), so a press that won still sees its own gate. The caller
 * therefore counts "the ask moved on to its next question" as the press still
 * standing, because that is what our own answer to question N looks like: a
 * surviving ask can only have advanced.
 *
 * `null` for a `refused` outcome: nothing was sent, and the holder of the lock
 * is the one that reports. `null` while the gate still stands: the card owns the
 * outcome then, which is where the press happened.
 */
export const lostAnswerMessage = (
	outcome: AnswerOutcome,
	pressStillStands: boolean,
): string | null => {
	if (pressStillStands) return null;
	if (outcome.status === "refused") return null;
	return "That question was already answered somewhere else, so your answer was not sent.";
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
