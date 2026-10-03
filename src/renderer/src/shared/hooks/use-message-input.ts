/**
 * Whether this composer has to be SEEDED from the conversation it is showing.
 *
 * The question the effect below means to ask, and the reason it was not asking
 * it: its dependency array was `[conversationId, hydrated, getCurrentInput,
 * historyIndex, submittedMessages]`, so it also ran on every submit SETTLE -
 * `addSubmittedMessage` installs a new array identity and `retireDraft` nulls the
 * history index, both in the same turn - and then re-seeded the box from
 * `getCurrentInput`, which `retireDraft` had just written to `""`. That is the
 * measured destruction of text typed while a send was in flight: 16 of 16
 * characters at one hold, 5 of 16 at another (the report's Flow 2 control run),
 * with the caret still in the box. It is a DIFFERENT writer from the documented
 * clear (`clearOnce`/`clearSubmittedText`), whose whole purpose is that an echo
 * landing late must not clear what the user has typed since - which is exactly
 * the guarantee the second writer was breaking.
 *
 * So the gate is the conversation identity the effect claims to key on: seed
 * when this composer has not seeded for THIS conversation, and never again while
 * it is the same one. A remount still seeds (a fresh hook instance has no
 * `lastInitialisedRef`), which is what keeps the history branch reachable - the
 * ArrowUp/ArrowDown path writes the box in the key handler itself, so an index
 * that is live across a remount is the only case that branch is for.
 *
 * Pure and exported so the rule is asserted without a DOM, in the shape
 * `ask-answer.ts`'s predicates are.
 */
export const shouldReinitialiseComposer = (
	initialisedFor: string | undefined,
	conversationId: string | undefined,
	hydrated: boolean,
): boolean => hydrated && initialisedFor !== conversationId;

/**
 * Hook for managing message input with robust per-conversation persistence and log-based history navigation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
// The chip objects this module writes back when a refusal hands a payload over
// are minted here rather than carried from the send, exactly as the composer's
// own restore writes them (`message-input.tsx`'s `addAttachment(conversationId,
// { id: uuidv4(), path })`): only the PATHS are the payload - the store records
// paths and the guard compares paths - so an id is an identity for the row, not
// part of what was sent.
// The one filename rule, rather than a second copy of it: the sentence this
// module builds names a file, and every other surface that names one goes
// through here. A RELATIVE specifier across the same boundary, because the
// `@features` alias is a tsconfig path that some of the suites bundling this
// module by hand do not declare - and a unit of the renderer should not become
// unbundleable by a test just because it needed a filename.
import {
	type Attachment,
	type Reply,
	useConversationInputStore,
} from "../store/conversation-input-store";

/**
 * A failed send whose text must NOT be put back in the composer.
 *
 * The other failure answer is `false`, which means "refused before admission":
 * nothing reached the owner, so the composer is where the text belongs. This one
 * is its opposite. The outcome is unknowable - the owner may have admitted the
 * command before the response was lost - and the optimistic echo is deliberately
 * kept painted in the transcript for exactly that reason, so writing the same
 * text back into the box would show the user one message twice, with no way to
 * tell which copy is real and a Failure copy that names only the box (design
 * round 1's D1). The retry belongs to the claim the store is already holding:
 * the composer offers "Restore message" from it, and a resend replays the
 * same request id, so nothing can duplicate on the owner.
 */
/*
 * `undefined` is "no send happened" (a slash command, a gate answer) and a
 * boolean is what the composer's own Send answers: `false` when the payload was
 * NOT accepted, `true` when it settled. The third member this union used to carry
 * is gone with the held claim: a failure is always the payload coming back to the
 * composer, which the STORE does now, so the hook has nothing left to distinguish.
 */

/**
 * An accepted send that went OFF THE RECORD rather than into the conversation.
 *
 * The aside destination (`/btw`, and a composer send while the panel is
 * attached) is the one accepted outcome whose text must neither be restored on
 * failure nor written to the per-conversation history log.
 *
 * NOT RECORDED, because the aside's whole promise is that it leaves no trace:
 * `submittedMessages` is persisted to `localStorage`
 * (`conversation-input-store.ts`) and loaded back by Up-arrow as though the
 * question had been sent to the thread, which is exactly what
 * `aside-store.ts`'s own header refuses for anything durable ("a store that
 * wrote to `localStorage` would be the one place an off-record exchange outlived
 * its session"). The `/btw <question>` door never touched that log either, so
 * which door the user came through must not decide whether the question outlives
 * the app.
 *
 * NOT RESTORED on failure, and that is a decision rather than an omission. Its
 * difference from `false`: a `false` outcome means nothing reached the owner, so
 * the box is where the text belongs. Here the ask WAS registered — the panel is
 * painting the question and its stream entry exists — so the failure is
 * unknowable to this composer, and the refusal is stated on the
 * panel that owns the exchange, with the question still painted above it. A
 * restore writes only into an EMPTY box (`restoreSubmittedText`), so whether the
 * text came back would depend on whether the user had started typing again — a
 * race with no visible rule, and one that would silently lose the half of it the
 * user cared about.
 *
 * WHAT IT DOES DO is retire the BOX: the text leaves at the PRESS, not at the
 * answer, which is what keeps the follow-up that replaced it out of the question
 * already asked.
 *
 * AND IT CARRIES THE ASK'S OWN ANSWER, which is the one thing a string could not
 * say. The box retiring at the press is the whole point (review round 1, F1), so
 * this outcome is composed before the POST has answered and cannot know whether
 * the ask will be answered or refused — while the composer's PAYLOAD (the staged
 * reply chips and the credential map) must be retired on success and KEPT on
 * failure, exactly as a refused send keeps it (review round 2, F6). The ask's
 * own promise is therefore handed over inside this outcome, and the composer
 * settles the payload on it rather than on the press.
 *
 * NESTED RATHER THAN RETURNED, deliberately: `useMessageInput` AWAITS what
 * `onSubmit` returns, so returning the ask's promise would hold the box's clear
 * and the composer's `admitting` state for the whole POST — the defect F1 names.
 * A plain object settles the await in the press's own microtask, and the promise
 * inside it is read afterwards, when it has something to say.
 */
export type OffRecordAsk = {
	/** The ask itself: resolved when it is answered, rejected when it is refused. */
	offRecord: Promise<unknown>;
};

/** What a submit reported back to the composer. See `OffRecordAsk`. */
export type SendOutcome = undefined | boolean | OffRecordAsk;

/**
 * Whether an accepted submit went off the record, and which ask it was.
 *
 * A guard rather than a comparison, because the outcome is an object now: the
 * four failures this tree has already been bitten by are all comparisons against
 * a value that changed shape (`recordsSubmittedMessage` treating an object as
 * "an ordinary accepted send" would write an off-record question to the
 * persisted log — the F2 defect, back through a different door).
 */
export const isOffRecordAsk = (outcome: SendOutcome): outcome is OffRecordAsk =>
	typeof outcome === "object" && outcome !== null;

/**
 * Settle the composer's payload on an off-record ask's own answer.
 *
 * AN ASK THAT IS ANSWERED CONSUMED WHAT IT CARRIED, and a REFUSED one did not
 * (review round 2, F6). The staged reply chips and the credential map are retired
 * by an accepted send because the text went out with them; an aside ask that the
 * owner refused put nothing anywhere — the panel keeps the question and states
 * the refusal under it — so the refusal rule applies instead and the payload
 * stays, exactly as it does after a `false` outcome. `retire` is the composer's
 * own retirement (`message-input.tsx`), so this module owns the decision and the
 * composer owns what the decision does.
 *
 * Exported and pure so the rule is assertable, which is the whole reason it is a
 * function at all: the call site is a React component a node test cannot mount,
 * and the failure arm is the one that has to be pinned (the success arm is what
 * the press did before this change, so only a test can tell the two apart).
 */
export function settleOffRecordPayload(
	outcome: OffRecordAsk,
	retire: () => void,
): void {
	void outcome.offRecord.then(retire, () => {});
}

/**
 * Whether an accepted submit is written to the per-conversation history log.
 *
 * Exported and pure so the off-record rule is pinned by a test rather than
 * argued from its call site — the shape `clearSubmittedText` below uses for the
 * text transitions, and for the same reason (a rule stated in one place and
 * bypassed in another is what review UX-1's U2 was).
 *
 * The two failure answers are not recorded either, and for their own documented
 * reasons: `false` put the text back in the box, so the log would hold a message
 * that was never sent. The off-record ask is not recorded either, which is the
 */
export const recordsSubmittedMessage = (outcome: SendOutcome): boolean =>
	outcome !== false && !isOffRecordAsk(outcome);

/**
 * Which text a composer transition may write over what the user has typed.
 *
 * BOTH transitions go through these, because they are one question asked twice:
 * the send's text may only move while the box holds EXACTLY what the send left
 * in it. Anything else in the box was typed by the user while the request was in
 * flight, and replacing it - or appending the old message to it - is text loss.
 * Exported and pure so the rule is pinned by a test rather than argued from its
 * call sites: review UX-1's U2 was this rule stated in one place (the adopt path
 * below) and bypassed in another (the refusal restore).
 */
export const clearSubmittedText = (
	current: string,
	submitted: string,
): string => (current === submitted ? "" : current);

/**
 * WHETHER A SEND'S SETTLE MAY RETIRE THE PERSISTED DRAFT (QA round 1, Q-2).
 *
 * The settle runs seconds after the echo, and every write since - keystrokes,
 * a landing transcript - lives in the SAME persisted register (`handleChange`
 * pushes each one). The unconditional clear wiped that newer copy while the
 * box kept it on screen, and the next landing then appended against the
 * emptied register and REPLACED the visible text ("send -> dictate -> dictate",
 * measured in 3 of 4 QA runs). A settle that finds the register already empty,
 * or still holding exactly the payload it sent, retires it; anything else is
 * the user's and not this send's to clear.
 *
 * Pure and exported so the rule is asserted at node level (the shape
 * `shouldReinitialiseComposer` takes in the same file).
 */
export const retireDraftApplies = (
	persisted: string,
	submitted: string,
): boolean => persisted === "" || persisted === submitted;

/**
 * WHETHER THE HISTORY WALK MAY ENGAGE FROM THIS COMPOSER'S CONTENT (issue #673).
 *
 * The Slack/Discord convention this box means to follow: the arrow reaches for
 * history only from an EMPTY composer. What shipped instead gated the recall on
 * the CARET's line, so any caret on line 1 mid-edit took the branch - `prevent`
 * ate the native caret move, the draft was swapped for a recalled message, and
 * recovering the sentence meant a full walk round trip, which is why the
 * misfire read as data loss.
 *
 * With ANY content the arrow is the textarea's own caret movement, at every
 * caret position: this predicate reads the CONTENT alone, so there is no caret
 * argument for a caller to get subtly wrong. The walk, once engaged, is a
 * different question and is asked elsewhere: the box then HOLDS a recalled
 * message (non-empty by construction), so a rule reading the content would
 * block the very walk it exists to protect.
 *
 * Pure and exported so the rule is asserted without a DOM, in the shape
 * `retireDraftApplies` above takes.
 *
 * A DELIBERATE DIVERGENCE FROM THE HARNESS, stated here because the harness
 * still does the other thing: the TUI's composer gates the same key on the
 * CARET (`editor.py`'s `_caret_at_top_edge()`) and keeps recall-with-draft,
 * stashing the draft on the way out. The desktop instead requires the EMPTY
 * box — the convention issue #673 asks for, matching Slack and Discord, where
 * history is reachable from a blank composer so a half-written prompt is never
 * swapped or stashed without the user meaning it. Two consequences that follow
 * from reading the VALUE rather than its trim: a whitespace-only box counts as
 * content (one character), so a stray space blocks recall until the box is
 * truly empty; and the walk's stash can now only ever hold `""`.
 */
export const historyRecallEngages = (value: string): boolean => value === "";

/**
 * The boundary between a draft and a transcript that lands on it (design round
 * 1, D2; UX round 1, U2). Plain concatenation glued "overhaul" to "dictated"
 * on the exact landing path this change re-publishes, and the joined word
 * shipped as the sent message; the baseline records show it carried, which is
 * why it is fixed HERE rather than deferred - this PR is the path's owner now.
 *
 * One space is added when the two sides would otherwise touch: the draft is
 * non-empty and does not end in whitespace, and the transcript does not begin
 * with it. Nothing changes when either side already had a boundary, so a draft
 * ending in a space and a transcript starting with one both join exactly as
 * before.
 */
export const joinTranscript = (draft: string, text: string): string => {
	if (!draft) return text;
	if (/\s$/.test(draft) || /^\s/.test(text)) return draft + text;
	return `${draft} ${text}`;
};

/*
 * THE BOX'S ONE SENTENCE PER STATE (chat redesign §G1/§G3).
 *
 * Two of these are new copy (the `noProvider` line is main's, folded in
 * unchanged) and one is deleted, and the deletion is the point: `Waiting for the agent` was the running-turn sentence, and it was the app
 * narrating a fact the transcript's own working line states three inches above -
 * while saying nothing about the two things a reader actually needs there, that
 * typing steers the running turn and that Esc stops it. §G3 replaces it with the
 * sentence that teaches both, and the affordance line in `idle` does the same job
 * for the two grammars the box accepts (`@` and `/`), which nothing on screen
 * mentioned before.
 */
export const COMPOSER_PLACEHOLDER = {
	unavailable: "This conversation is gone",
	busy: "Agent is busy",
	answer: "Type your own answer…",
	/*
	 * A SECRET ASK'S OWN SENTENCE, and it is not `answer`'s: the ordinary
	 * answer arm invites typing into this box, which is exactly what a secret
	 * question refuses (`message-input.tsx`'s `secretAnswer` term). So this one
	 * points at the dock's masked field instead — the only surface the value
	 * may pass through — and it is read BEFORE `inputDisabled`'s, because "Agent
	 * is busy" would be false about the state: the agent is waiting, not busy.
	 */
	secretAnswer: "Answer the secret request above",
	/*
	 * The exit is named beside the verb for the reason the `@` list's own line
	 * names its ("Nothing to insert · Esc closes").
	 */
	aside: "Ask off the record — Esc closes the aside",
	sending: "Sending your message",
	/**
	 * WHILE A TAKE IS LIVE, THE BOX'S OWN KEYS ARE THE RECORDING'S (UX round 1,
	 * U1). Enter confirms the take and Esc cancels it - rung 4 of the interrupt
	 * ladder, "Esc during a recording cancels the recording and never the turn" -
	 * so the mid-turn sentence below ("Esc stops") would be a promise about the
	 * wrong thing. Read before every other reading, because none of them can be
	 * true at once with a live take the user started: the recording owns the
	 * press until it ends.
	 *
	 * The KEYS are not named here. This sentence shows only while the field is
	 * EMPTY, and naming them made the empty-field state say them TWICE - once
	 * here and once in the recording block's own label row, which is the copy
	 * that survives a draft (agent/design/UX review round 1, F1/D1/U1). The
	 * label row is the one, stable place for the affordance; this placeholder
	 * keeps only the state's name.
	 */
	recording: "Recording",
	waiting: "Steer the agent. Enter sends now · Esc stops",
	/**
	 * Nothing connected: the invitation would be a lie, and this is the one
	 * sentence that names the action instead (design audit section 6).
	 */
	noProvider: "Connect a provider to start chatting",
	idle: "Ask anything. @ adds files, / runs commands",
} as const;

/**
 * The one sentence the box's placeholder slot carries, first match wins.
 *
 * The READ of the order: a conversation this machine does not have outranks every
 * other reading (`isInputDisabled` is true for one, so the gone-state sentence has
 * to be asked first or a reader of a missing conversation is told `Agent is busy`
 * about a turn nobody is running - design round 2, D3); then a gate that takes a
 * SECRET, whose sentence names the dock's field because the box refuses input for
 * it and pointing is all this slot can usefully do; then the box's own refusal;
 * then a gate that is waiting to be answered; then an attached aside; then THIS
 * pane's send; then the agent; then the invitation.
 *
 * THE ASIDE TERM SITS AFTER THE REFUSALS AND AFTER THE GATE, and both sides
 * of that position are load-bearing. After the refusals, because a box that takes
 * no keystrokes must not be invited to take one: "Ask off the record" over a
 * read-only composer is a promise nothing can keep. After `awaitingAnswer`,
 * because while a question card is unanswered the press does NOT reach the aside
 * - the gate branch outranks it in `chat-page.tsx`, since a parked gate must
 * stay answerable from the box that is about to send the aside text (the card's
 * buttons are the pointer path; the composer's yes/no/ordinal path is the
 * keyboard one) while the aside keeps its exchange on screen - and the surface
 * whose whole job is naming the destination cannot name the wrong one.
 *
 * AHEAD OF BOTH SEND-STATE SENTENCES, for the same reason: while the panel is
 * attached the next Enter goes to the aside whatever the conversation is doing,
 * so the box names where the press goes rather than what an earlier send is
 * doing - the transcript's working line already says that.
 */
export const composerPlaceholder = (state: {
	/** The conversation is not on this machine. */
	unavailable: boolean;
	/** `isLoading && currentJobId` - the box is refused, with its own sentence. */
	inputDisabled: boolean;
	/** A pending `ask` gate is waiting for an answer in this pane. */
	awaitingAnswer: boolean;
	/**
	 * A pending `ask` gate that takes a SECRET, whose answer goes in the dock's
	 * masked field instead of this box (see `message-input.tsx`'s
	 * `secretAnswer`). Read before `inputDisabled`: see the sentence's own note.
	 */
	secretAnswer: boolean;
	/** The `/btw` aside is attached, so the press asks it rather than the thread. */
	asideAttached: boolean;
	/** A send this pane issued has not settled. */
	sendingUnsettled: boolean;
	/** A send has been issued and the agent has not painted anything yet. */
	awaitingReply: boolean;
	/**
	 * No model provider is connected. LAST of the readings, because it is the
	 * only one that is not about this turn: a send in flight, a pending question
	 * or a refused box are all things the user is doing right now, and telling
	 * them to connect a provider while the agent is answering above the box
	 * would be the composer arguing with the transcript.
	 */
	noProvider?: boolean;
	/**
	 * The host's own sentence for the INVITATION slot, when it has one (the mini
	 * view's copy of the idle line). Only the invitation: every state sentence
	 * below still outranks it, because those describe facts about the box rather
	 * than an invitation to use it.
	 */
	idle?: string;
	/**
	 * The HOST's own sentence for the states the host owns (design review round 1,
	 * D1/D5).
	 *
	 * WHY THIS OUTRANKS `inputDisabled`/`sendingUnsettled`/`awaitingReply`, and
	 * only those: "Agent is busy" and "Sending your message" are facts about a
	 * CHAT purpose. A host that refuses input for its own reason (the Agents page's
	 * dirty-edit gate, a backend without the capability) or that has its own
	 * request outstanding says its own words there, while every other sentence —
	 * `unavailable`, `secretAnswer`, the invitation — still outranks this one.
	 * ABSENT MEANS NOTHING CHANGES: no chat mount passes it.
	 */
	hostLine?: string | null;
	/**
	 * The ASK lane's own sentence, while the composer is answering a queued ask.
	 *
	 * Ranked ABOVE `awaitingAnswer`/`sendingUnsettled`/`awaitingReply`, and that is
	 * the point rather than a preference: in ask mode this box's Enter posts the
	 * ANSWER whatever the turn is doing, so the turn's own sentences ("Steer the
	 * agent. Enter sends now. Esc stops.") name actions the key does not perform and
	 * omit the one it does - a live turn does not change where the text goes (UX
	 * round 1, U2, measured: the box held `restart it` under the steer sentence and
	 * the press posted `/answers`).
	 *
	 * Still BELOW the refusals above it: an unreachable conversation, a masked
	 * capture and a refused box are facts about the box itself, and a mode sentence
	 * printed over them would invite a press the box cannot take.
	 */
	askMode?: string;
}): string => {
	if (state.unavailable) return COMPOSER_PLACEHOLDER.unavailable;
	if (state.secretAnswer) return COMPOSER_PLACEHOLDER.secretAnswer;
	if (
		state.hostLine &&
		(state.inputDisabled || state.sendingUnsettled || state.awaitingReply)
	)
		return state.hostLine;
	if (state.inputDisabled) return COMPOSER_PLACEHOLDER.busy;
	if (state.askMode) return state.askMode;
	if (state.awaitingAnswer) return COMPOSER_PLACEHOLDER.answer;
	if (state.asideAttached) return COMPOSER_PLACEHOLDER.aside;
	if (state.sendingUnsettled) return COMPOSER_PLACEHOLDER.sending;
	if (state.awaitingReply) return COMPOSER_PLACEHOLDER.waiting;
	if (state.noProvider) return COMPOSER_PLACEHOLDER.noProvider;
	return state.idle ?? COMPOSER_PLACEHOLDER.idle;
};

/**
 * The disclosure a caller with no capture to report hands over: nothing.
 *
 * A named function rather than an inline `() => 0` default, so the identity is
 * stable across renders — the hook carries `draftUnredacted` in a `useCallback`
 * dependency list, and a fresh closure per render would rebuild the keystroke
 * handler on every keystroke.
 */

/** One instance, for the reason `EMPTY_PATHS` gives above. */
const EMPTY_REPLIES: readonly Reply[] = [];

/** One instance, for the same reason. */
const EMPTY_CHIPS: readonly Attachment[] = [];

/**
 * The two halves of a draft a composer STAGES beside its own text.
 *
 * The box holds the words; this holds what travels WITH them - the files
 * (`conversation-input-store`'s `attachments`) and the quotes (`replies`). One
 * payload in three registers, which is what makes it wrong for any of them to
 * leave the composer on a different trigger: `buildSendPayload` turns the
 * replies into the payload's prefix and the send encodes images from the file
 * paths, so what is on screen and what is on the wire are the same list. */
export type StagedPayload = {
	replies: readonly Reply[];
	attachments: readonly Attachment[];
};

/**
 * The staged halves a conversation is holding RIGHT NOW.
 *
 * Read at submit rather than subscribed to, because the question is "what did
 * THIS send carry" and the answer has to be frozen at the press: a chip the user
 * attaches while the request is in flight is their next payload, not this one.
 *
 * AND THE SNAPSHOT IS WHAT THE CLEAR USES, which is the other half of that
 * sentence: `clearStagedPayload` removes exactly the ENTRIES in here - by id,
 * through the store's own removers - so the chips a press froze are the blast
 * radius of the clear and a file attached during the flight is outside it. The
 * two halves cannot disagree, because one answer serves both questions.
 */
export const stagedPayloadOf = (conversationId: string): StagedPayload => {
	const row =
		useConversationInputStore.getState().inputByConversation[conversationId];
	return {
		replies: row?.replies ?? EMPTY_REPLIES,
		attachments: row?.attachments ?? EMPTY_CHIPS,
	};
};

/**
 * Retire exactly the entries in a snapshot, through the store's own removers.
 *
 * RESTORED BY THE FOLD (`origin/main` = `f9d92ac1e`), and it is main's own helper:
 * the aside's settlement is the one caller that has to clear the staged halves
 * WITHOUT recording them as in flight, because an off-record ask that is ANSWERED
 * consumed them and one that is REFUSED keeps them (see `settleOffRecordPayload`).
 * `inFlight` is a statement about a message on the wire, so the ask's halves cannot
 * go through it - which is why `clearOnce` (this branch's single store update, for
 * the sends that are on the wire) and this function both exist rather than one of
 * them standing in for the other.
 */
export const clearStagedPayload = (
	conversationId: string,
	staged: StagedPayload,
): void => {
	const store = useConversationInputStore.getState();
	for (const reply of staged.replies)
		store.removeReply(conversationId, reply.id);
	for (const attachment of staged.attachments)
		store.removeAttachment(conversationId, attachment.id);
};

/**
 * The disclosure a caller with no capture to report hands over: nothing.
 *
 * A named function rather than an inline `() => 0` default, so the identity is
 * stable across renders - the hook carries `draftUnredacted` in a `useCallback`
 * dependency list, and a fresh closure per render would rebuild the keystroke
 * handler on every keystroke.
 */
const noDisclosure = () => 0;

/**
 * Options for the useMessageInput hook
 */
type UseMessageInputOptions = {
	conversationId?: string;
	/**
	 * True while a MASKED credential capture is open (§6).
	 *
	 * The persisted draft is not written in that window, and the reason is on
	 * disk rather than in taste: `conversation-input-store` is `persist`ed to
	 * localStorage, and what a capture leaves in the buffer is mask cells with the
	 * value held outside the document. A draft write during the capture would put
	 * `••••` on disk with nothing behind it — dead text the operator can never use
	 * when the draft is restored, and text that looks like a secret without being
	 * one. So the store keeps the last NON-CAPTURING value and the capture is
	 * in-flight state, exactly as the TUI's encoder keeps the value out of a
	 * spilled draft (`local_operator/tui/session_drafts.py`).
	 */
	draftHeld?: boolean;
	/**
	 * How many characters of the current draft are characters an Esc unredacted
	 * back into the composer as PLAIN TEXT, or 0 (§5, §6).
	 *
	 * Written WITH the draft on every write this hook makes, because the two are
	 * one fact: the persisted characters are on disk (that is what §6 decided), and
	 * the disclosure that says so has to travel with them or a reload restores a
	 * secret into an ordinary-looking composer. Design round 2's D2 is exactly
	 * that: the live state disclosed itself, the restored one did not, and the very
	 * next Enter exposed the characters.
	 *
	 * The count comes from the composer, which is the only thing that knows it (the
	 * cancel's own answer), and it rides here rather than being written by the
	 * composer separately so the two halves cannot be written apart — the same
	 * reason `draftHeld` gates the write in this hook instead of at each caller.
	 *
	 * A FUNCTION OF THE VALUE BEING WRITTEN, not a number (UX round 3, U12). The
	 * write happens inside the keystroke's own handler, so a number captured at
	 * render time still describes the text BEFORE that keystroke: that is how four
	 * backspaces left `unredactedChars: 11` persisted beside a seven-character
	 * remnant, and how typing ordinary prose re-persisted a stale count that a
	 * reload then rendered as a sentence about nothing. Asking with the value is
	 * what lets the composer answer "this text discloses nothing" for the text the
	 * operator just produced, and it keeps that answer in one place
	 * (`disclosureOver`) instead of in a second reader of the same fact.
	 */
	draftUnredacted?: (value: string) => number;
	/**
	 * See `useMessageInput`'s own note: a host that paints no transcript relies on
	 * its accepted send to retire its box, because it has no echo to do it.
	 */
	transcriptless?: boolean;
	/**
	 * Submits the message.
	 *
	 * `onEchoPainted` is the seam that lets the composer clear itself at the
	 * moment the text is actually on screen rather than at the moment the request
	 * left. Callers that have no transcript to be painted into (the legacy chat
	 * path, the composer's own fixtures) may ignore it; the box is then cleared
	 * when the submit settles, which is what that path always did.
	 */
	onSubmit?: (
		message: string,
		onEchoPainted?: () => void,
	) => SendOutcome | Promise<SendOutcome>;
	scrollToBottom?: () => void;
};

/**
 * The slice of zustand's persist API this hook reads, which some hosts do not
 * have. See the hydration block inside `useMessageInput` for why its absence is
 * a state to render in rather than an error.
 */
type ConversationInputPersistence = {
	hasHydrated: () => boolean;
	onHydrate: (fn: () => void) => () => void;
	onFinishHydration: (fn: () => void) => () => void;
};

/**
 * Hook for managing message input with robust per-conversation persistence and log-based history navigation.
 */
export const useMessageInput = ({
	conversationId,
	onSubmit,
	scrollToBottom,
	draftHeld = false,
	draftUnredacted = noDisclosure,
	/*
	 * Whether the host paints NO transcript for this box (UX exploration, U1).
	 *
	 * The box's text is normally retired by the ECHO: the row appears in the
	 * transcript and `clearOnce` empties the box in the same commit. A host with
	 * no transcript has no echo, so its accepted send must retire the box itself —
	 * see the gate on `clearOnce` — and only such a host passes this. Absent means
	 * the echo path, i.e. every chat composer, byte-identical.
	 */
	transcriptless = false,
}: UseMessageInputOptions) => {
	// Store selectors
	const getCurrentInput = useConversationInputStore((s) => s.getCurrentInput);
	const setCurrentInput = useConversationInputStore((s) => s.setCurrentInput);
	const addSubmittedMessage = useConversationInputStore(
		(s) => s.addSubmittedMessage,
	);
	const getSubmittedMessages = useConversationInputStore(
		(s) => s.getSubmittedMessages,
	);
	const getCurrentHistoryIndex = useConversationInputStore(
		(s) => s.getCurrentHistoryIndex,
	);
	const setCurrentHistoryIndex = useConversationInputStore(
		(s) => s.setCurrentHistoryIndex,
	);
	const resetCurrentHistoryIndex = useConversationInputStore(
		(s) => s.resetCurrentHistoryIndex,
	);
	const beginInFlight = useConversationInputStore((s) => s.beginInFlight);
	const adoptReturnedText = useConversationInputStore(
		(s) => s.adoptReturnedText,
	);

	/*
	 * Hydration state.
	 *
	 * THE PERSIST API IS NOT ALWAYS THERE, AND RENDERING WITHOUT IT IS A STATE
	 * THIS HOOK ALREADY PROMISES TO HANDLE - the effect below has always had the
	 * branch for it (no persist API: settle the box as hydrated and let the store
	 * live in memory). Zustand only attaches `api.persist` when its storage
	 * factory RETURNED a storage; with the middleware's default
	 * `() => localStorage` a host that evaluates this store where `localStorage`
	 * is not a global - a DOM-less desktop-suite harness, an SSR render, a window
	 * with storage disabled - takes the middleware's no-storage branch and hands
	 * back the bare store. Reading `.hasHydrated` THROUGH the missing API is what
	 * took the whole page down the first time a composer mounted OUTSIDE chat
	 * (`AgentsPage` -> `ConfigComposer` -> `MessageInput`, in
	 * `agent-class-toggle.test.mjs`): the effect tolerated it, this line did not.
	 * `conversation-input-sync.ts` reads the same API optionally, so the tolerance
	 * is the house rule, not an accommodation here: no persistence means no
	 * restored draft, never a broken page.
	 */
	const [hydrated, setHydrated] = useState(
		(
			useConversationInputStore.persist as unknown as
				| ConversationInputPersistence
				| undefined
		)?.hasHydrated?.() ?? false,
	);
	const initializedRef = useRef<string | undefined>(undefined);
	/*
	 * The conversation this composer last SEEDED its box from, beside
	 * `initializedRef` rather than instead of it: that one answers "has this hook
	 * adopted the conversation?" and is read by `clearOnce` and the draft-sync
	 * effect, while this one answers "has it seeded the box?" - the question the
	 * seeding effect below has to ask to stop running on every submit settle.
	 * Only `shouldReinitialiseComposer` writes it.
	 */
	const lastInitialisedRef = useRef<string | undefined>(undefined);
	const [inputValue, setInputValue] = useState<string>("");

	useEffect(() => {
		const persist = useConversationInputStore.persist as unknown as
			| ConversationInputPersistence
			| undefined;
		let unsubHydrate: (() => void) | undefined;
		let unsubFinish: (() => void) | undefined;
		if (
			persist &&
			typeof persist.onHydrate === "function" &&
			typeof persist.onFinishHydration === "function"
		) {
			unsubHydrate = persist.onHydrate(() => setHydrated(false));
			unsubFinish = persist.onFinishHydration(() => setHydrated(true));
			setHydrated(persist.hasHydrated());
		} else {
			setHydrated(true);
		}
		return () => {
			unsubHydrate?.();
			unsubFinish?.();
		};
	}, []);

	// Refs
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const draftMessageRef = useRef<string>("");

	// The draft as the STORE currently holds it. `inputValue` is local state
	// seeded from the store on mount, so a write from outside this hook -- a
	// failed send handing the user's prompt back -- changed the store and left
	// the textarea empty. Subscribing makes an external restore visible.
	const storedDraft = useConversationInputStore((s) =>
		conversationId
			? (s.inputByConversation[conversationId]?.currentInput ?? "")
			: "",
	);
	// The last value this hook itself pushed, so a local keystroke echoing back
	// through the store is not mistaken for an external write and re-applied.
	const lastPushedRef = useRef<string>("");

	// Store state for this conversation
	const submittedMessages = conversationId
		? getSubmittedMessages(conversationId)
		: [];
	const historyIndex = conversationId
		? getCurrentHistoryIndex(conversationId)
		: null;

	// On mount or conversation change, set inputValue to the correct state (draft or log message)
	useEffect(() => {
		if (
			!shouldReinitialiseComposer(
				lastInitialisedRef.current,
				conversationId,
				hydrated,
			)
		)
			return;
		lastInitialisedRef.current = conversationId;
		if (conversationId) {
			const draft = getCurrentInput(conversationId);
			if (historyIndex !== null && submittedMessages.length > 0) {
				setInputValue(submittedMessages[historyIndex] || "");
			} else {
				setInputValue(draft);
			}
			initializedRef.current = conversationId;
			draftMessageRef.current = "";
		} else {
			setInputValue("");
			initializedRef.current = undefined;
			draftMessageRef.current = "";
		}
	}, [
		conversationId,
		hydrated,
		getCurrentInput,
		historyIndex,
		submittedMessages,
	]);

	// Only sync inputValue to the store if hydrated and inputValue is not being initialized from the store
	useEffect(() => {
		if (!hydrated) return;
		if (!conversationId) return;
		if (initializedRef.current === conversationId) return;
		setCurrentInput(conversationId, inputValue);
	}, [conversationId, inputValue, setCurrentInput, hydrated]);

	// Adopt a draft written from outside this hook. Guarded on both sides: only
	// when the store genuinely differs from what we last pushed, and only into
	// an EMPTY composer, so a restore can never overwrite something the user has
	// started typing.
	useEffect(() => {
		if (!hydrated || !conversationId) return;
		if (storedDraft === lastPushedRef.current) return;
		lastPushedRef.current = storedDraft;
		if (storedDraft && !inputValue) setInputValue(storedDraft);
	}, [storedDraft, hydrated, conversationId, inputValue]);

	/*
	 * THE STORE IS THE AUTHOR OF THE BOX'S TEXT, AND THIS IS THE ONLY CHANNEL THAT
	 * SAYS SO.
	 *
	 * Two writers, one value. This hook holds the text being TYPED INTO (its own
	 * state, which is what makes a keystroke cheap); the row holds the text the app
	 * owns - what the return path hands back, what the migration moves, what `Clear`
	 * empties and what the delivery reconciliation clears. Before this, a store
	 * write reached the box only through `pendingText`, adopted on mount and on
	 * arrival, so everything else the store did to the text was invisible: Clear
	 * emptied the row and left the words on screen (they then glued onto the next
	 * message and went out as one bubble), a late delivery's silent clear emptied
	 * the row and left the words, and the returned payload of a send that failed
	 * while this composer was remounted could not correct an already-mounted box.
	 * All four are the same defect: the store had no way to say "I wrote the box"
	 * (review round 1, B2/M1/Q-1/U3).
	 *
	 * `textRevision` is that sentence, and a counter rather than a value because a
	 * value cannot carry it: a keystroke writes the same string back, and a masked
	 * capture deliberately does not write at all.
	 *
	 * The MOUNT's first read is not a write: the initialiser above has already
	 * seeded the box from this same row, and re-setting it would move the caret to
	 * the end of a draft the user has just started editing. What IS handled on the
	 * first read is a payload waiting to be adopted (`pendingText`), because the row
	 * keeps the returned text there rather than in `currentInput` while the merge
	 * waits for a composer that can take it.
	 */
	const pendingReturn = useConversationInputStore((s) =>
		conversationId
			? s.inputByConversation[conversationId]?.pendingText
			: undefined,
	);
	/*
	 * Read as a NUMBER, with the row's own absence of one meaning zero: a row no store
	 * write has touched yet and a row whose writer has not been written are the same
	 * thing here, and `undefined` cannot serve as the "not primed" marker below
	 * without making the FIRST real store write look like the mount read.
	 */
	const textRevision = useConversationInputStore((s) =>
		conversationId
			? (s.inputByConversation[conversationId]?.textRevision ?? 0)
			: 0,
	);
	const storeText = useConversationInputStore((s) =>
		conversationId
			? s.inputByConversation[conversationId]?.currentInput
			: undefined,
	);
	/** `null` until the mount read has been taken: see the effect below. */
	const seenTextRevision = useRef<number | null>(null);
	useEffect(() => {
		if (!hydrated || !conversationId) return;
		/*
		 * A composer that has not taken charge of this conversation must not adopt
		 * another one's payload; `initializedRef` is the same gate the initialiser
		 * uses.
		 */
		if (initializedRef.current !== conversationId) return;
		const previousRevision = seenTextRevision.current;
		seenTextRevision.current = textRevision;
		const first = previousRevision === null;
		/*
		 * THE RETURNED MESSAGE COMES HOME FIRST, on the mount read as well as on a
		 * later one: the row keeps returned text OUT of `currentInput` until a
		 * composer can take it (`pendingText`), so the initialiser above cannot have
		 * seeded it and this is the only thing that ever puts it in the box.
		 */
		if (pendingReturn !== undefined) {
			/*
			 * The masked capture keeps the box: adopting into it would put a returned
			 * message inside a secret the user is composing. The capture's own write at
			 * its end is what puts the merged value back.
			 */
			if (draftHeld) return;
			const merged = adoptReturnedText(conversationId);
			if (merged === null) return;
			lastPushedRef.current = merged;
			setInputValue(merged);
			return;
		}
		/*
		 * Everything ELSE the store wrote is mirrored verbatim - an emptied box above
		 * all - and only when the revision says the store is the author of the change.
		 * The mount's own read is not a change: the initialiser has already seeded the
		 * box from this same row, and re-setting it would move the caret to the end of
		 * a draft the user has just started editing.
		 */
		if (first || textRevision === previousRevision) return;
		if (draftHeld) return;
		const boxed = storeText ?? "";
		if (boxed === inputValue) return;
		lastPushedRef.current = boxed;
		setInputValue(boxed);
	}, [
		textRevision,
		storeText,
		pendingReturn,
		hydrated,
		conversationId,
		draftHeld,
		inputValue,
		adoptReturnedText,
	]);

	// Handle input change: always reset history navigation and update draft
	const handleChange = useCallback(
		(value: string) => {
			setInputValue(value);
			if (conversationId) {
				// THE ONE GATE ON THE DRAFT WRITE (§6): while a masked capture is open
				// the box belongs to the operator's keystrokes and the persisted draft
				// keeps whatever it last held. `lastPushedRef` is left alone with it, so
				// the adoption effect below still sees the store's value as its own and
				// cannot mistake it for a restore somebody else made.
				if (draftHeld) return;
				lastPushedRef.current = value;
				setCurrentInput(conversationId, value, draftUnredacted(value));
				resetCurrentHistoryIndex(conversationId);
			}
		},
		[
			conversationId,
			setCurrentInput,
			resetCurrentHistoryIndex,
			draftHeld,
			draftUnredacted,
		],
	);

	const submittingRef = useRef(false);
	/*
	 * THE TRANSCRIPT'S OWN WRITE, AND THE WINDOW IT MUST RESPECT.
	 *
	 * A dictation lands in the box from OUTSIDE the keystroke channel, asynchronously,
	 * and it can land in the one window where the box and the row are both mid-send:
	 * between the press and the clear that retires the sent text. Two defects live in
	 * that window, and they are the reason this pair exists rather than a plain write:
	 *
	 *   - the clear runs AFTER the transcript's write but computes from a value
	 *     captured before it, so it either discards the fresh text or resurrects the
	 *     sent message beside it (`setNewMessage(newMessage + newText)` reads the
	 *     pre-press closure - both outcomes were reachable);
	 *   - the transcript is simply lost when the clear lands second.
	 *
	 * So a transcript that arrives while `sendClearPendingRef` is set waits in
	 * `pendingTranscriptRef`, and `clearOnce` - the ONE function that retires a sent
	 * payload from this box - composes the clear and the transcript into a single
	 * write. The waiting text is attached to the SEND's clear and to nothing else, so
	 * it cannot outlive it.
	 */
	const pendingTranscriptRef = useRef("");
	const sendClearPendingRef = useRef(false);

	/**
	 * Append `text` to the draft through the same writer a keystroke uses, so the
	 * row and the box move together. Kept separate from `appendTranscriptText`
	 * because `clearOnce` needs the raw append without the waiting rule.
	 */
	const appendToDraft = useCallback(
		(text: string) => {
			if (!conversationId || !text) return;
			if (draftHeld) {
				// The masked capture owns the box: append to it without touching the row,
				// exactly as a keystroke inside the capture does (§6). The capture's own
				// write at its end is what reconciles the merged value.
				setInputValue((current) => joinTranscript(current, text));
				return;
			}
			handleChange(joinTranscript(getCurrentInput(conversationId), text));
		},
		[conversationId, draftHeld, getCurrentInput, handleChange],
	);

	/**
	 * The transcription path's writer: a transcript either joins the box now or
	 * waits for the send's own clear - never both, and never against a stale copy
	 * of the box (see the refs above for the window and its two defects).
	 */
	const appendTranscriptText = useCallback(
		(text: string) => {
			if (!text) return;
			if (sendClearPendingRef.current) {
				pendingTranscriptRef.current += text;
				return;
			}
			appendToDraft(text);
		},
		[appendToDraft],
	);
	/*
	 * A SEND THIS COMPOSER MADE IS STILL UNACKNOWLEDGED, which is a state the
	 * composer owes the user a sentence about (the placeholder in
	 * `message-input.tsx`): the box is emptied at the echo, so between the press
	 * and the settle the composer can be showing an empty field with no statement
	 * at all about the message that has just left it.
	 *
	 * Owned here as well as read from the store, deliberately: this one is a fact
	 * about THIS composer's press - true from the press, false once the submit
	 * settles whichever way it settled, and available on the arms where no store
	 * row ever exists (a slash command, a gate answer, a legacy send) - while the
	 * row is the half that survives the identity flip and is fed in beside it
	 * (`chat-page`'s `admitting` is neither: it is a `useState` of the panel the
	 * flip replaces, which is what review round 2's R2-1 found).
	 */
	const [sendInFlight, setSendInFlight] = useState(false);
	// Admission, not the keypress, retires a draft. A refused send hands its text
	// back to the box; an UNCONFIRMED one leaves its text with the claim that
	// carries the retry, so nothing the user typed is lost either way.
	const handleSubmit = useCallback(async () => {
		if (!inputValue.trim() || !conversationId) return;
		/*
		 * A SECOND PRESS IS REPORTED, NOT SWALLOWED.
		 *
		 * This guard used to `return` and say nothing, so a user who pressed Enter
		 * again while their last message was still going out got no acknowledgement at
		 * all - indistinguishable from a dead key, and the one place the composer's own
		 * "still sending" sentence was supposed to appear (review round 1, U6: the line
		 * never showed on a second press, because the press never reached the sentence).
		 *
		 * The press is therefore handed on like any other, and the PANE's send lock
		 * answers it: that lock is the single gate on "a send is already out", it is
		 * where the sentence lives, and its refusal returns `false` - which this
		 * function reads as "the payload stays in the box", exactly as it does for every
		 * other refusal. If the lock no longer holds the send (the microtask between the
		 * pane's own `finally` and this one) the press is admitted as a normal send
		 * instead, which is why this is a delegation rather than a second path.
		 *
		 * `submittingRef` still guards THIS hook's own re-entry, and the send-in-flight
		 * flag still describes the real send: the second call does not take ownership of
		 * either.
		 */
		const alreadySubmitting = submittingRef.current;
		submittingRef.current = true;
		if (!alreadySubmitting) {
			setSendInFlight(true);
			// The press opens the window a transcript must respect, and the clear
			// below (or the refusal arm) closes it. A DELEGATED second press opens
			// nothing: it owns no clear, and a flag it raised would strand the next
			// transcript with no writer left to collect it.
			sendClearPendingRef.current = true;
		}
		/*
		 * THE TEXT LEAVES THE BOX WHEN THE TRANSCRIPT RECEIVES IT, NOT BEFORE.
		 *
		 * The clear used to run right here, one line before the await, on the
		 * argument that `admitChatDraft` paints the echo synchronously so the text
		 * moves box -> transcript in a single frame. That is true on the
		 * existing-session path and false on the New-chat one: a staged draft has
		 * no session id until `sessions.create` returns, so the echo cannot exist
		 * for the whole create hop (p50 142 ms, max 409 ms at load 433-445, UX
		 * round 1's measurement), and the user spent that hop looking at a box the
		 * app had already emptied and a transcript that had nothing in it - which
		 * reads as the message having been thrown away.
		 *
		 * So the clear is no longer the submit's to time. `onEchoPainted` fires when
		 * the echo has been applied to a mounted transcript, and on THAT path it is
		 * the only clear: synchronously with the echo, so the box empties in the same
		 * commit the row appears (still one frame).
		 *
		 * It is NOT the only clear in this file, and on the New-chat path it is not
		 * the one the user sees. There the drain delivers the callback into the
		 * composer the identity flip has already unmounted - the store patches the
		 * session id and fires the echo before this hook resumes - so the clear it
		 * requests lands on a component that is gone. What ends the interval is that
		 * the replacement panel never held the text and paints the echo in its first
		 * state (U3). The `clearOnce()` after the await below is the fallback for
		 * every send that never echoes at all - a slash command, a gate answer, the
		 * legacy model path - and it is what a harness holding ONE mounted composer
		 * observes on the buffered path (round 7, F1). Both triggers clear once per
		 * submit, and neither of them clears anything but the payload this submit is
		 * carrying.
		 *
		 * The payload is still captured ONCE and threaded through every consumer
		 * below. Re-reading `inputValue` after a clear yields "", which would
		 * submit an empty message and make the store's unchanged-payload guard
		 * compare every retry against "" and refuse it. One value, one meaning.
		 *
		 * THE OTHER HALVES OF THAT PAYLOAD MOVE ON THE SAME TRIGGER, which is the
		 * second half of this rule and the reason `clearOnce` is where both happen.
		 * The chip row and the staged quotes used to leave only when the send's
		 * promise SETTLED, while the text left at the echo - so the whole in-flight
		 * window showed the user's message with its attachment in the transcript AND
		 * the chip for that attachment in the composer. One file apparently sent
		 * twice, on a send that appears to have half-happened. Captured here beside
		 * the text, so all three registers are recognisably ONE payload, and taken
		 * by the one call above, so no later edit can put them on two clocks (see
		 * `clearStagedPayload`).
		 */
		const submitted = inputValue;
		/*
		 * Frozen at the press, like the text: a chip the user attaches while the
		 * request is in flight belongs to their NEXT message, and a refusal must not
		 * hand it back as though it had been sent.
		 */
		const staged = conversationId ? stagedPayloadOf(conversationId) : undefined;
		/*
		 * One clear per submit, whichever of its two triggers gets there first,
		 * and only over the payload this submit is actually carrying: an echo that
		 * lands late - or on a composer that has since been remounted - must not
		 * clear something the user has typed or attached in the meantime.
		 *
		 * BOTH HALVES LEAVE HERE, in this one call. The text is the box's and the
		 * chips are the store row's, but they are one payload and they leave on one
		 * clock - which is the defect this trigger exists for, not two clearers that
		 * agree today (see `clearStagedPayload`).
		 */
		let cleared = false;
		/*
		 * Set only for an OFF-RECORD ask, whose staged halves are not the press's to
		 * take: an answered ask consumed them and a refused one did not (review round
		 * 2, F6), so they are settled on the ask's own answer below and `clearOnce`
		 * takes the text alone. Without this the post-await `clearOnce()` - the one
		 * trigger an ask ever reaches, since it paints no echo - would retire a staged
		 * reply at the press, and a refusal would leave the user without the quote
		 * the panel's refusal sentence invites them to send again.
		 */
		let stagedSettledByAsk = false;
		/*
		 * Declared OUTSIDE the try because the box's own retirement is decided after
		 * it, from the outcome: see `recordsSubmittedMessage` for the one accepted
		 * outcome that is deliberately not written to the history log.
		 */
		let outcome: SendOutcome;
		/*
		 * One clear per submit, whichever of its two triggers gets there first, and
		 * only over the payload this submit is actually carrying: an echo that lands
		 * late - or on a composer that has since been remounted - must not clear
		 * something the user has typed or attached in the meantime.
		 *
		 * ONE STORE UPDATE TAKES ALL THREE REGISTERS, which is why the chips and the
		 * quotes are cleared here beside the text rather than by three separate
		 * callers that agree today: they are one payload, they leave on one clock,
		 * and `inFlight` is the record of what left (see `beginInFlight`).
		 */
		const clearOnce = (record = false) => {
			if (cleared && !record) return;
			cleared = true;
			/*
			 * THE TRANSCRIPT'S WAIT ENDS HERE, composed into this one clear.
			 * The two writes must land as one: the clear decides what of the sent
			 * text survives (usually nothing), and the transcript was captured
			 * WHILE that was still undecided. Written separately they can take
			 * each other's work back; written together, the box ends up holding
			 * exactly the transcript beside whatever the clear kept.
			 */
			const pendingTranscript = pendingTranscriptRef.current;
			if (pendingTranscript) pendingTranscriptRef.current = "";
			sendClearPendingRef.current = false;
			/*
			 * A TRANSCRIPTLESS HOST'S BOX IS THE ONLY COPY OF WHAT IT SENT (UX
			 * exploration, U1 — a BLOCKER, because this page's sends WRITE the agent
			 * and team registries: a box that keeps its text makes the next Enter a
			 * second run, and a second run is a second write).
			 *
			 * WHY THE EARLY RETURN CANNOT APPLY THERE. It exists because a composer
			 * that never took charge of the row has nothing to clear — the row is
			 * another mount's, and the echo it paints is the transcript's. A host
			 * that paints NO transcript has no echo to clear the box on: the
			 * post-await clear is its ONLY clear, so returning here leaves the sent
			 * text in the box and the next Enter re-sends it.
			 *
			 * GATED ON `transcriptless`, so chat is byte-identical: every chat
			 * composer still retires its text on the echo, through this same branch.
			 */
			if (!transcriptless && initializedRef.current !== conversationId) {
				// This composer never took charge of the row, so it has nothing to
				// clear - but the row is still the transcript's home and the next
				// mount paints from it.
				if (pendingTranscript) appendToDraft(pendingTranscript);
				return;
			}
			setInputValue((current) => clearSubmittedText(current, submitted));
			if (conversationId)
				beginInFlight(
					conversationId,
					{
						text: submitted,
						attachments: stagedSettledByAsk ? [] : (staged?.attachments ?? []),
						replies: stagedSettledByAsk ? [] : (staged?.replies ?? []),
						/*
						 * A value typed into a MASKED capture never reaches disk (§6):
						 * the record carries the flag and `partialize` blanks the text,
						 * so a restart in that window restores the files and the quotes
						 * without a credential that was never stored.
						 */
						volatileText: draftHeld,
					},
					record,
				);
			if (pendingTranscript) appendToDraft(pendingTranscript);
		};
		/*
		 * The persisted draft is retired as the send settles, not as it starts,
		 * because until then the text is still this composer's: the box is holding
		 * it, or a refusal is about to put it back.
		 */
		const retireDraft = () => {
			/*
			 * ONLY THE COPY THE SEND ACTUALLY RETIRED (QA round 1, Q-2; the rule and
			 * its reasoning live on `retireDraftApplies`). A register holding
			 * something newer than this send - typed or dictated since the press -
			 * is the user's, and clearing it both lost the persisted copy and made
			 * the next landing REPLACE the box's visible text.
			 */
			if (
				conversationId &&
				!retireDraftApplies(getCurrentInput(conversationId), submitted)
			)
				return;
			lastPushedRef.current = "";
			setCurrentInput(conversationId, "");
			resetCurrentHistoryIndex(conversationId);
			draftMessageRef.current = "";
		};
		try {
			/*
			 * The echo trigger RECORDS and the post-await fallback does not, and the
			 * difference is the whole of the quit-mid-flight fix: the payload is held
			 * as in flight only while its outcome is unknown. A `clearOnce()` after
			 * the await runs for a send that has already settled - a slash command, a
			 * gate answer, an accepted message with no echo - and recording there
			 * would leave a durable "unconfirmed" record over a message the owner
			 * took, which a restart would then hand back to the user as unsent.
			 */
			outcome = await onSubmit?.(submitted, () => clearOnce(true));
			if (outcome === false) {
				/*
				 * THE FAILURE ARM'S WHOLE JOB IS TO NOT UNDO THE STORE'S WORK, and since
				 * S4 the store's work is the ROW's: a post-paint failure keeps the
				 * message in the conversation, with the class's sentence and remedies on
				 * it, and deliberately does NOT hand the payload back to the composer.
				 *
				 * So: no local restore, no `retireDraft` (it would wipe a box the user
				 * may have typed into since - the box was already emptied at the press,
				 * which is where the text left for the transcript), and no
				 * `addSubmittedMessage`. A restore performed HERE would only work while
				 * this component stays mounted, and on the New-chat path the identity
				 * flip unmounts it mid-send (UX round 3, U14) - which is also why a
				 * second home was the wrong shape for this fact to begin with.
				 *
				 * AND THE TRANSCRIPT'S WINDOW ENDS HERE TOO: this refusal keeps the
				 * text in the box and runs no clear, so a transcript that arrived
				 * meanwhile would otherwise wait for a writer that never comes.
				 */
				sendClearPendingRef.current = false;
				const strandedTranscript = pendingTranscriptRef.current;
				if (strandedTranscript) {
					pendingTranscriptRef.current = "";
					appendToDraft(strandedTranscript);
				}
				return;
			}
		} finally {
			/*
			 * Only the call that owns the send clears its state: a delegated second
			 * press settles the moment the pane refuses it, and clearing here would take
			 * the wait down while the first send is still going out - which is the fact
			 * the sentence it just raised is about.
			 */
			if (!alreadySubmitting) {
				submittingRef.current = false;
				/*
				 * The wait ends with the submit, whichever way it ended. Deliberately not
				 * with the echo: between the echo and the settle the message IS on screen
				 * and the send is still unconfirmed, which is the window the composer's
				 * sentence is about.
				 */
				setSendInFlight(false);
			}
		}

		/*
		 * Nothing echoed and nothing is being held: an accepted send with no echo at
		 * all - a slash command, a gate answer, the legacy model path - still has to
		 * retire the box. When the echo did clear it, this is a no-op.
		 *
		 * An off-record ask retires its TEXT here like any accepted send (the box is
		 * handed back at the press, F1) and its staged halves on the ask's answer,
		 * by the same identity rule the echo's clear uses - so a quote staged while
		 * the aside was answering is the user's next payload, not this ask's.
		 */
		if (isOffRecordAsk(outcome)) {
			stagedSettledByAsk = true;
			if (conversationId && staged)
				settleOffRecordPayload(outcome, () =>
					clearStagedPayload(conversationId, staged),
				);
		}
		clearOnce();
		/*
		 * AND THE HISTORY LOG IS FOR THE CONVERSATION'S OWN SENDS ONLY: an off-record
		 * ask retires the box exactly like any other accepted send, but leaves no
		 * entry for Up-arrow to recall and nothing on disk. See `OffRecordAsk`.
		 */
		if (recordsSubmittedMessage(outcome))
			addSubmittedMessage(conversationId, submitted);
		// Cleared BEFORE the store write so a synchronous restore inside
		// `onSubmit` is not immediately overwritten by this submit's own clear.
		retireDraft();
		if (scrollToBottom) {
			// Use requestAnimationFrame to ensure DOM updates before scrolling
			requestAnimationFrame(() => {
				scrollToBottom();
			});
		}
	}, [
		inputValue,
		conversationId,
		onSubmit,
		addSubmittedMessage,
		setCurrentInput,
		resetCurrentHistoryIndex,
		scrollToBottom,
		beginInFlight,
		draftHeld,
		/*
		 * The transcript's flush rides this submit's clear (see `clearOnce`),
		 * and `retireDraft` reads this register to decide what its settle may
		 * retire (QA round 1, Q-2) - so both are dependencies of this callback
		 * in the literal sense the lint gate enforces.
		 */
		appendToDraft,
		getCurrentInput,
		/*
		 * U1: `clearOnce` reads it to decide whether an accepted send retires the
		 * box itself (a transcriptless host has no echo to do it), so the lint gate
		 * is right that it belongs here.
		 */
		transcriptless,
	]);

	// Cursor position helpers
	const getCursorPosition = useCallback((): {
		line: number;
		totalLines: number;
	} => {
		const textarea = textareaRef.current;
		if (!textarea) return { line: 0, totalLines: 1 };
		const text = textarea.value;
		const selectionStart = textarea.selectionStart;
		const textUpToCursor = text.substring(0, selectionStart);
		const linesUpToCursor = (textUpToCursor.match(/\n/g) || []).length + 1;
		const totalLines = (text.match(/\n/g) || []).length + 1;
		return { line: linesUpToCursor, totalLines };
	}, []);
	const isCursorAtFirstLine = useCallback(
		(): boolean => getCursorPosition().line === 1,
		[getCursorPosition],
	);
	const isCursorAtLastLine = useCallback((): boolean => {
		const { line, totalLines } = getCursorPosition();
		return line === totalLines;
	}, [getCursorPosition]);

	// Keyboard navigation
	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (!conversationId) return;
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSubmit();
				return;
			}
			if (!submittedMessages.length) return;
			if (e.key === "ArrowUp") {
				/*
				 * THE ENGAGEMENT RULE IS THE CONTENT'S, NOT THE CARET'S (issue #673).
				 * A recall INITIATES only from an empty composer; a draft never takes it,
				 * at any caret position, so `preventDefault` cannot eat a caret move or
				 * swap the user's sentence out (the rule and its reasoning live on
				 * `historyRecallEngages`). The first-line test below is the WALK's, not
				 * the engagement's: once engaged the box holds recalled text, and the
				 * arrow keeps walking from the first line exactly as it always has.
				 */
				if (historyIndex === null) {
					if (!historyRecallEngages(inputValue)) return;
				} else if (!isCursorAtFirstLine()) {
					return;
				}
				e.preventDefault();
				if (historyIndex === null) {
					draftMessageRef.current = inputValue;
					setCurrentHistoryIndex(conversationId, submittedMessages.length - 1);
					setInputValue(submittedMessages[submittedMessages.length - 1] || "");
				} else if (historyIndex > 0) {
					const newIndex = historyIndex - 1;
					setCurrentHistoryIndex(conversationId, newIndex);
					setInputValue(submittedMessages[newIndex] || "");
				}
				setTimeout(() => {
					if (textareaRef.current) {
						const length = textareaRef.current.value.length;
						textareaRef.current.selectionStart = length;
						textareaRef.current.selectionEnd = length;
					}
				}, 0);
			}
			if (e.key === "ArrowDown" && isCursorAtLastLine()) {
				/*
				 * THE CAPTURE IS THE WALK'S, NOT THE CARET'S (issue #764). This arm can
				 * only WALK a recall the ArrowUp arm already engaged; with none there is
				 * nothing here for it to do, and yet `preventDefault` ran unconditionally
				 * inside the last-line guard — which counts LOGICAL lines, so a wrapped
				 * single-paragraph draft is on its "last line" at every caret position
				 * and the key was swallowed at all of them. The engagement rule is the
				 * ArrowUp arm's and lives on the CONTENT (`historyRecallEngages`); this
				 * arm hands the key back before `preventDefault`, on the walk's own state
				 * rather than a content test: the walked box HOLDS recalled text
				 * (non-empty by construction), so reading the content here would block
				 * the very walk it exists to protect.
				 */
				if (historyIndex === null) return;
				e.preventDefault();
				if (historyIndex !== null) {
					if (historyIndex < submittedMessages.length - 1) {
						const newIndex = historyIndex + 1;
						setCurrentHistoryIndex(conversationId, newIndex);
						setInputValue(submittedMessages[newIndex] || "");
					} else {
						resetCurrentHistoryIndex(conversationId);
						setInputValue(draftMessageRef.current);
						draftMessageRef.current = "";
					}
					setTimeout(() => {
						if (textareaRef.current) {
							const length = textareaRef.current.value.length;
							textareaRef.current.selectionStart = length;
							textareaRef.current.selectionEnd = length;
						}
					}, 0);
				}
			}
		},
		[
			handleSubmit,
			isCursorAtFirstLine,
			isCursorAtLastLine,
			historyIndex,
			inputValue,
			submittedMessages,
			conversationId,
			setCurrentHistoryIndex,
			resetCurrentHistoryIndex,
		],
	);

	return {
		inputValue,
		setInputValue: handleChange,
		handleKeyDown,
		handleSubmit,
		textareaRef,
		/*
		 * The transcription path's writer, and the ONLY way a transcript reaches
		 * this box: it either joins the draft now or waits for the send's own
		 * clear, so it can never race the clear that is retiring the sent text
		 * (see the refs at the top of this hook).
		 */
		appendTranscriptText,
		/*
		 * A send this composer made has not settled yet. Exposed because it is
		 * the composer's own press, and the placeholder that states it is the
		 * composer's to render (see the state's declaration above for why it is
		 * not read from the transcript).
		 */
		sendInFlight,
	};
};
