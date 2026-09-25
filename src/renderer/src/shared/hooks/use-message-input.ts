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
import { v4 as uuidv4 } from "uuid";
// The one filename rule, rather than a second copy of it: the sentence this
// module builds names a file, and every other surface that names one goes
// through here. A RELATIVE specifier across the same boundary, because the
// `@features` alias is a tsconfig path that some of the suites bundling this
// module by hand do not declare - and a unit of the renderer should not become
// unbundleable by a test just because it needed a filename.
import { getFileName } from "../../features/chat/utils/get-file-name";
import { isStoreWriteRefusal } from "../store/canonical-sessions-store";
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
export const SEND_HELD = "held";

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
 * unknowable in the way `SEND_HELD` describes, and the refusal is stated on the
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

/** What a submit reported back to the composer. See `SEND_HELD`. */
export type SendOutcome = undefined | boolean | typeof SEND_HELD | OffRecordAsk;

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
 * that was never sent, and `SEND_HELD` leaves the retry on the store's claim.
 */
export const recordsSubmittedMessage = (outcome: SendOutcome): boolean =>
	outcome !== false && outcome !== SEND_HELD && !isOffRecordAsk(outcome);

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

/** Put a refused send's text back, but only into an EMPTY composer. */
export const restoreSubmittedText = (
	current: string,
	submitted: string,
): string => (current === "" ? submitted : current);

/**
 * Put a refused send's ATTACHMENTS back, on the same rule as its text.
 *
 * The chip row a restored draft shows and the payload its next Send carries are
 * the same list, so an attachment the restored draft does not re-adopt is a file
 * the user believes they are sending and are not - the silent partial send of
 * round 7's R17. Restoring the PATHS is enough for that payload to come back
 * whole: the send re-encodes images from them (`encodeImageAttachments` in
 * `chat-page.tsx`).
 *
 * The rule is `restoreSubmittedText`'s, and it is the same rule for the same
 * reason: only into an EMPTY slot. A composer that already holds chips is
 * holding files the user just picked, and overwriting those is loss. Empty
 * answer means "adopt nothing", never "clear what is there".
 *
 * ONE ARM THIS RULE DOES NOT DECIDE, now that the echo takes the row on the way
 * out (`clearStagedPayload`): a chip the user removes DURING the flight leaves
 * the row empty as well, so a refusal that lands afterwards puts that chip back.
 * That is `restoreSubmittedText`'s own trade, made for the same reason - an
 * emptied slot is indistinguishable from one this app emptied - and it errs in
 * the recoverable direction: the other way is a file the user believes they are
 * sending.
 *
 * Exported and pure so the composer's own adoption can be pinned by a test
 * rather than argued from its call site, exactly as the two transitions above
 * are (`clearSubmittedText`'s own note).
 */
export const restoreSubmittedAttachments = (
	current: readonly Attachment[],
	submitted: readonly string[] | undefined,
): readonly string[] =>
	current.length === 0 && submitted ? submitted : EMPTY_PATHS;

/**
 * One instance, so the rule's negative answer is a stable value rather than a
 * fresh array on every render - the composer adopts on a render-synchronous
 * effect and an identity that changes per call is a re-run waiting to happen.
 */
const EMPTY_PATHS: readonly string[] = [];

/**
 * Put a refused send's staged REPLIES back, on the same rule as its text.
 *
 * A staged reply is not decoration: `buildSendPayload` writes it into the
 * payload's `<reply-to>` prefix, so a reply a restored draft does not re-adopt
 * is a quote the user believes they are sending and are not - the same silent
 * partial send `restoreSubmittedAttachments` above exists for, one half over.
 *
 * The rule is those two rules', for the same reason: only into an EMPTY slot. A
 * composer that already holds a staged reply is holding a quote the user just
 * staged, and `replies` is a list rather than a slot - so "empty" is the whole
 * list, because appending the refused send's quotes to a quote the user staged
 * afterwards would prefix a payload with a conversation that was never cited.
 */
export const restoreSubmittedReplies = (
	current: readonly Reply[],
	submitted: readonly Reply[] | undefined,
): readonly Reply[] =>
	current.length === 0 && submitted ? submitted : EMPTY_REPLIES;

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
 * ONE PAYLOAD, ONE MOMENT: every half a submit stages leaves the composer HERE.
 *
 * The clear itself is trivial. WHY IT IS A FUNCTION AND NOT TWO LINES AT ITS
 * CALL SITE is the whole of this change. The chip row used to be cleared after
 * the send's promise SETTLED while the text left at the ECHO
 * (`onEchoPainted`), so for the entire in-flight window - the image encode plus
 * the create hop - the transcript showed the user's message with its attachment
 * while the composer still showed the chip for that attachment. That reads as
 * one file sent twice, and as a send that half-happened. `clearOnce` now makes
 * one call that takes both, so no later edit can put the halves back on
 * different clocks.
 *
 * CARRIES, ENTRY BY ENTRY, is the third thing this function is: the removal goes
 * through the store's own `removeReply`/`removeAttachment` for the ids the press
 * captured, NOT through `clearReplies`/`clearAttachments`.
 *
 * WHY THE ROW IS CLEARED BY IDENTITY WHILE THE TEXT IS CLEARED BY EQUALITY. The
 * press->echo window is a LIVE window - the box stays typeable on purpose - so
 * anything the user adds during it belongs to their next message. A whole-row
 * clear took that too, silently: press with a file staged, attach a second one
 * while the send is going out, and the echo wiped both (QA round 1, Q-2; UX
 * round 1, U2 - "my words stayed, my file vanished"). The text half is guarded
 * the other way (`clearSubmittedText` compares the whole box) because a box has
 * ONE slot and there is no honest way to delete a prefix from it - the user's
 * own typed words are not itemised. A row IS itemised, so the exact items are
 * the honest unit here, and the two rules agree on the thing that matters: a
 * clear never takes more than the send it belongs to. A chip the user REMOVED
 * during the flight is simply absent from the row, and removing an absent id is
 * a no-op.
 *
 * CLEARING THE ROW EARLY IS SAFE FOR THE WIRE, and that is not obvious enough to
 * leave unsaid: the words and the reply prefix are assembled before the request
 * (`buildSendPayload`), and the images are encoded from the paths the caller
 * passed (`encodeImageAttachments` reads its ARGUMENT, not this store) - so the
 * only thing this clear can change is what the composer shows. Both halves are
 * pinned as tests rather than assumed: `echo-delivery.test.mjs` drives a real
 * `admitChatDraft` with a mounted transcript, clears the row from inside the
 * echo's paint callback, and reads what reached the wire; `submit-latency.test.mjs`
 * carries the structural row for the same claim.
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
 * Put a refused send's staged halves back, through the same two empty-slot rules
 * the store's own route uses (`adoptRefusedPayload`).
 *
 * NEEDED AS ITS OWN STEP because the echo now takes the row on the way out. A
 * refusal that lands after the optimistic paint (413 and 422, and every other
 * refusal thrown once `admissionAttempted` is set) would otherwise leave the
 * restored text in the box with no chip beside it: a resend carrying the wording
 * and not the file, silently, which is round 7's R17 one arm over. Deciding both
 * halves in one call is deliberate for the reason `adoptRefusedPayload` gives - a
 * draft carrying one half of a refused payload is not distinguishable on screen
 * from one carrying all of it.
 *
 * Neither half is touched when the row already holds the user's own content; see
 * the two rules above for why, and for the one arm each of them gets wrong.
 */
export const restoreStagedPayload = (
	conversationId: string,
	staged: StagedPayload,
): void => {
	const store = useConversationInputStore.getState();
	const row = store.inputByConversation[conversationId];
	const paths = restoreSubmittedAttachments(
		row?.attachments ?? EMPTY_CHIPS,
		staged.attachments.map((attachment) => attachment.path),
	);
	for (const path of paths)
		store.addAttachment(conversationId, { id: uuidv4(), path });
	for (const reply of restoreSubmittedReplies(
		row?.replies ?? EMPTY_REPLIES,
		staged.replies,
	))
		store.addReply(conversationId, reply);
};

/**
 * THE COMPOSER'S FIVE SENTENCES, and which window each one is true in.
 *
 * Extracted from the band's JSX because their ORDER is the rule, not the
 * strings: the chain was inline, so a term added at the wrong end of it looked
 * exactly like a term added anywhere else. It was: `Sending your message` was
 * written to say "this send is still going out" and put BELOW `Waiting for the
 * agent`, and on the path the operator reported the two are true at once - the
 * store's rung is up once the message request has been ISSUED
 * (`admissionAttempted`, written before the echo and before the wire), so on a
 * real send the box said the agent was answering while the request was still
 * going out (agent review round 1, MAJOR-1; QA Q-1, which executed it and read
 * `Waiting for the agent`).
 *
 * `sendingUnsettled` therefore sits ABOVE `awaitingReply`, and the two are not
 * "consecutive halves" of one window but of ONE SEND at different moments: while
 * the press has not settled, the honest sentence is that the message is on its
 * way out; once it has settled and the agent is answering, that one takes over.
 * "Further along wins" was the right principle - the earlier term was on the
 * wrong side of it.
 *
 * WHAT FEEDS `sendingUnsettled` IS NOT THIS COMPOSER'S OWN STATE ALONE, and the
 * second source is the STORE's draft row rather than anything a pane holds.
 * `sendInFlight` (below) is a `useState` in `useMessageInput`, so the New-chat
 * identity flip - which REPLACES the panel mid-wait, as the operator's own
 * screenshot shows - unmounts it with the composer that held it, and the
 * replacement renders the idle invitation over a send it cannot see (MAJOR-1's
 * second half). The store's row is the fact that survives: `draftRowForSession`
 * finds it from the session id alone, `admittedSendFor` decides it is in flight,
 * and it is the SAME predicate the transcript's working line is built from, so
 * the box and the line cannot disagree about whether a send is going out. The two
 * are OR'd: the row is the send both surfaces can see, and the hook's is the press
 * this composer made before that row exists at all (and on the arms - a legacy
 * one, a refused-draft one - where it never will).
 *
 * It is the row's OWN conversation (`pending` + `admissionAttempted` on a row that
 * addresses this session), which is the boundary that keeps another
 * conversation's send from making this composer say this.
 *
 * ROUND 2 CORRECTED THIS SOURCE, and the correction is worth stating because the
 * first attempt looked right: round 1 fed this from `chat-page`'s `admitting`,
 * which is a `useState` declared inside the panel the flip replaces, so the value
 * was false on the replacement for the whole send and the sentence was still
 * unreachable in the window it names (agent review round 2, R2-1). The lesson is
 * the one this file's own docs keep repeating: a fact of a SEND must not live in
 * the state of one of its readers.
 */
/*
 * THE BOX'S ONE SENTENCE PER STATE (chat redesign §G1/§G3).
 *
 * Two of these are new copy and one is deleted, and the deletion is the point:
 * `Waiting for the agent` was the running-turn sentence, and it was the app
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
	 * The exit is named beside the verb for the reason the `@` list's own line
	 * names its ("Nothing to insert · Esc closes").
	 */
	aside: "Ask off the record — Esc closes the aside",
	sending: "Sending your message",
	waiting: "Steer the agent. Enter sends now · Esc stops",
	idle: "Ask anything. @ adds files, / runs commands",
} as const;

/**
 * The one sentence the box's placeholder slot carries, first match wins.
 *
 * The READ of the order: a conversation this machine does not have outranks every
 * other reading (`isInputDisabled` is true for one, so the gone-state sentence has
 * to be asked first or a reader of a missing conversation is told `Agent is busy`
 * about a turn nobody is running - design round 2, D3); then the box's own
 * refusal; then a gate that is waiting to be answered; then an attached aside;
 * then THIS pane's send; then the agent; then the invitation.
 *
 * THE ASIDE TERM SITS AFTER THE TWO REFUSALS AND AFTER THE GATE, and both sides
 * of that position are load-bearing. After the refusals, because a box that takes
 * no keystrokes must not be invited to take one: "Ask off the record" over a
 * read-only composer is a promise nothing can keep. After `awaitingAnswer`,
 * because while a question card is unanswered the press does NOT reach the aside
 * - the gate branch outranks it in `chat-page.tsx`, since an `approval` gate has
 * no other answer path ("Reply yes or no in the composer") while the aside keeps
 * its exchange on screen - and the surface whose whole job is naming the
 * destination cannot name the wrong one.
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
	/** The `/btw` aside is attached, so the press asks it rather than the thread. */
	asideAttached: boolean;
	/** A send this pane issued has not settled. */
	sendingUnsettled: boolean;
	/** A send has been issued and the agent has not painted anything yet. */
	awaitingReply: boolean;
}): string => {
	if (state.unavailable) return COMPOSER_PLACEHOLDER.unavailable;
	if (state.inputDisabled) return COMPOSER_PLACEHOLDER.busy;
	if (state.awaitingAnswer) return COMPOSER_PLACEHOLDER.answer;
	if (state.asideAttached) return COMPOSER_PLACEHOLDER.aside;
	if (state.sendingUnsettled) return COMPOSER_PLACEHOLDER.sending;
	if (state.awaitingReply) return COMPOSER_PLACEHOLDER.waiting;
	return COMPOSER_PLACEHOLDER.idle;
};

/** The half of a refused payload a composer's own content kept out of the box. */
export type RefusedPayloadHalf = "text" | "files";

/** What one adoption of a refused payload does, and what it could not do. */
export type RefusedPayloadAdoption = {
	/** What the box holds once this adoption has run. */
	text: string;
	/** The chip paths to write to the composer's own row; empty when it took none. */
	paths: readonly string[];
	/**
	 * The owed files the draft is NOT carrying once this adoption has run.
	 *
	 * Owed paths that this adoption did not write AND that the composer's row does
	 * not already hold. Empty does not mean "this call restored every file" - see
	 * the decision below, where the named-session arm holds the file already - it
	 * means "the draft carries every file the refusal owed", which is the only
	 * question the sentence about them is allowed to answer.
	 */
	missingFiles: readonly string[];
	/** The owed half this composer's own content kept out, or null when none was. */
	withheld: RefusedPayloadHalf | null;
};

/**
 * ONE decision for BOTH halves of a refused payload, so they cannot part in
 * silence.
 *
 * The store answers "does this refusal owe the composer a payload" once
 * (`owesRefusedPayload`), and every field of that payload is written in one
 * pre-request update - so the text and the attachments arrive together and are
 * ONE thing. The composer used to undo that at its own call site: it gated the
 * chip write on the TEXT rule's outcome, so on the arm where the two rules
 * disagree it dropped the user's file with nothing said, and a later edit to
 * `restoreSubmittedText`'s empty-slot rule would silently have changed which
 * refusals restore files (code review round 8, MINOR-2). Both halves are
 * therefore decided here, by one call, from one payload.
 *
 * The pair is NOT adopted all-or-nothing - each half goes in through its own
 * empty-slot rule above, and a half whose slot already holds the user's own
 * content is left out, because overwriting that is loss. What changes is that
 * the composer is TOLD when the halves disagree: `withheld` names the owed half
 * the composer's own content kept out, and the composer says so (round 8's
 * MINOR-2 was precisely "a restored draft showing one half of the refused
 * payload without the other, and nothing on screen saying which").
 *
 * A "half" is owed only when the payload really carried it: an attachment-only
 * refusal owes no text, and a text-only refusal owes no files. That is why an
 * empty list is not a withheld half - there would be nothing to say.
 *
 * A HALF IS HELD ONLY WHEN THE DRAFT IS NOT CARRYING IT, which is not the same
 * question as "did this call write it" (UX round 5's U17, QA round 4's Q8). On a
 * NAMED session the composer is never remounted and its
 * chip row is never cleared, so the row already holds the very file the refused
 * send carried: the empty-slot rule above adopts nothing, and the first version
 * of this decision read that as "the file was withheld", printing a sentence
 * that told the user to attach a file that was on screen one line below it and
 * already in the next payload (`images: 1` on the wire). The rule the sentence
 * needs is about the DRAFT, not about this function's write, so the owed paths
 * are compared against what the row holds afterwards.
 */
export const adoptRefusedPayload = (
	box: string,
	/**
	 * The composer's own chip row, or `null` when it has none to write to (a
	 * composer with no conversation reads no attachments at all).
	 *
	 * The distinction is load-bearing rather than tidiness: with no row, a
	 * returned path is not adopted anywhere, and the files half counts as HELD -
	 * a sentence claiming the file came back would be false, and saying nothing
	 * would leave a restored text with no mention of the file it arrived with.
	 */
	chips: readonly Attachment[] | null,
	refusal: {
		text: string | undefined;
		attachments: readonly string[] | undefined;
	},
): RefusedPayloadAdoption => {
	const owedText = refusal.text ?? "";
	const text = restoreSubmittedText(box, owedText);
	const paths =
		chips === null
			? EMPTY_PATHS
			: restoreSubmittedAttachments(chips, refusal.attachments);
	const owedFiles = (refusal.attachments?.length ?? 0) > 0;
	const textOwed = owedText !== "";
	// What the draft carries ONCE THIS ADOPTION HAS RUN: what it wrote, plus what
	// the row already held - the named-session arm above, where the chip the
	// refusal names is the chip the composer never lost.
	const carried = new Set([
		...(chips ?? []).map((chip) => chip.path),
		...paths,
	]);
	const missingFiles = (refusal.attachments ?? EMPTY_PATHS).filter(
		(path) => !carried.has(path),
	);
	// Held, not merely unchanged: the half was owed and the adoption took it
	// nowhere, which happens exactly when the slot held the user's own content -
	// or, for the files, when this composer has no slot to offer at all, or when
	// the slot had to keep the user's own chips out of the way of the owed one.
	const textHeld = textOwed && text === box;
	const filesHeld = owedFiles && missingFiles.length > 0;
	/*
	 * Only a SPLIT is news. Both halves owed and exactly one held back is the
	 * state a user can misread as "the refused message came back" while it came
	 * back in part; a half held on its own is the ordinary empty-slot rule doing
	 * its job, and one half withheld beside another that was never owed is not a
	 * pair at all.
	 */
	const withheld =
		textOwed && owedFiles && textHeld !== filesHeld
			? textHeld
				? "text"
				: "files"
			: null;
	return { text, paths, missingFiles, withheld };
};

/**
 * The sentence for a split adoption, or null when there was nothing to say.
 *
 * It names the half the user is NOT getting back and the half they are, and
 * names the files by the same helper every other surface uses - "the file came
 * back" is only checkable against a name. Past tense on purpose: the sentence
 * records what the adoption DID, so removing the restored chip afterwards does
 * not turn it into a lie.
 *
 * `owed` and `missing` are both needed because the two arms name different
 * lists: the text arm names the files that came BACK (every owed one), and the
 * files arm names the ones the draft is not carrying. Naming the owed list in
 * the files arm told the user to re-attach a file that was already in the row
 * and in the payload (round 4, Q8/U17) - the same lie, one sentence over.
 *
 * "No free slot" was the first version's reason, and it is gone (round 4, D14):
 * it was the region's only machine noun, it described the row's internal shape
 * rather than the user's situation, and the helper's other arm already says the
 * ordinary thing in ordinary words. The files arm now names the reason the app
 * does teach: the composer is holding files the user picked.
 */
export const refusedSplitNotice = (
	withheld: RefusedPayloadHalf | null,
	owed: readonly string[] | undefined,
	missing: readonly string[] | undefined,
): string | null => {
	if (withheld === null) return null;
	// The two arms name different lists: the text arm names the files that came
	// BACK (every owed one), and the files arm names the ones the draft is not
	// carrying. `?? owed` so a caller that passes only the owed list still gets a
	// sentence rather than a trailing blank.
	const named = withheld === "text" ? owed : (missing ?? owed);
	const names = (named ?? []).map(getFileName);
	const one = names.length === 1;
	const list = names.join(", ");
	if (withheld === "text")
		return `The ${one ? "file" : "files"} ${list} from your refused message ${one ? "is" : "are"} attached again; its text was left out because the box already holds text you typed.`;
	return `The text of your refused message was restored, but not its ${one ? "file" : "files"} ${list} — the composer already holds files you picked, so attach ${one ? "it" : "them"} again if you still need ${one ? "it" : "them"}.`;
};

/**
 * The composer's restore control, as ONE string with two consumers.
 *
 * The held claim's sentence NAMES this control ("Choose Restore message ..."),
 * which is what makes the store sentence's own "send it again" performable while
 * the payload is out of the box (UX round 1, U1) — so the words exist here rather
 * than at the button, and the button interpolates the same constant. A second copy
 * at either site is how the sentence and the control come to name different
 * things. Exported from this module rather than from the composer so the suites
 * that bundle this module by hand (and not the composer's own tree) can pin the
 * pair.
 */
export const RESTORE_LABEL = "Restore message";

/**
 * The known fact a STORE refusal licenses, in the register the claim keeps it in.
 *
 * A store that could not write KNOWS the request was not admitted (`store_busy`
 * aside — contention is retryable), so "nothing was saved" is a fact and not a
 * guess, and the copy painted in the transcript is this app's own rather than the
 * agent's. The other register — "whether it reached the agent is not knowable" —
 * is written for a lost response and is FALSE here (UX round 1, U4).
 */
export const STORE_CLAIM_KNOWN_FACT =
	"Nothing was saved, and the copy above is this app's own rather than the agent's.";

/**
 * What a held claim says, decided by the CLAIM's own verdict.
 *
 * @param heldClaimCode - the code of the failure that LEFT this payload held
 *   (`ChatDraft.heldClaimCode`), never the code of the refusal that happens to be
 *   on screen. The two are different the moment the operator follows the app's
 *   own advice: `Restore message`, drop the file, Enter, and the unchanged-payload
 *   guard is what answers — and that refusal's code (`UNCONFIRMED_SEND_CODE`) is
 *   not a store write refusal, so reading the live code here silently reverted the
 *   claim to the lost-response register one screen after the app said "Nothing was
 *   saved", taking the disk off the screen with it (UX round 2, U10).
 * @param copyOnScreen - whether a copy of the held payload is painted in the
 *   transcript above (`heldCopyOnScreen`). The shared sentence POINTS at that copy,
 *   so the clause is dropped rather than asserted when the caller cannot answer.
 *   It has no effect on the store register, which does not point at anything.
 */
export const heldClaimCopy = (
	heldClaimCode: string | undefined,
	copyOnScreen: boolean,
): string => {
	/*
	 * THE REMEDY LEADS, AND IT IS A COMPLETE SENTENCE OF ITS OWN.
	 *
	 * Both observers of the narrow-window defect asked for this and for the same
	 * reason: the claim is the only prose on this screen that says what to DO, so
	 * the clause that does it has to be the first thing read. It was last, and at
	 * the app's own minimum window the backend's own sentence then ate the whole
	 * capped window — the remedy clause was the part cut off, and what remained
	 * ended on a full stop, so nothing read as truncated either (QA round 1's Q-1,
	 * design round 2's D5, agent review round 2's M1, UX round 2's U11). The line
	 * is now pinned outside the cap as well (see the composer's own note); the
	 * order is what makes it survive if a later edit puts it back under one.
	 *
	 * The fact's own wording is deliberate and reviewed (design round 2, D2): the
	 * retention reassurance stays "this app's own rather than the agent's", because
	 * whether the copy above is the operator's word or the agent's is the question
	 * the transcript echo raises.
	 */
	if (isStoreWriteRefusal(heldClaimCode))
		return `Choose ${RESTORE_LABEL} to put it back in the composer. ${STORE_CLAIM_KNOWN_FACT}`;
	return copyOnScreen
		? "A message is still being held, so a different message cannot be sent yet. Whether it reached the agent is not knowable - its copy is in the transcript above - so restore it and send again only if no reply arrives."
		: "A message is still being held, so a different message cannot be sent yet. Whether it reached the agent is not knowable, so restore it and send again only if no reply arrives.";
};

/**
 * The disclosure a caller with no capture to report hands over: nothing.
 *
 * A named function rather than an inline `() => 0` default, so the identity is
 * stable across renders — the hook carries `draftUnredacted` in a `useCallback`
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
 * Hook for managing message input with robust per-conversation persistence and log-based history navigation.
 */
export const useMessageInput = ({
	conversationId,
	onSubmit,
	scrollToBottom,
	draftHeld = false,
	draftUnredacted = noDisclosure,
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

	// Hydration state
	const [hydrated, setHydrated] = useState(
		(
			useConversationInputStore.persist as unknown as {
				hasHydrated: () => boolean;
			}
		).hasHydrated?.() ?? false,
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
		const persist = useConversationInputStore.persist as unknown as {
			onHydrate: (fn: () => void) => () => void;
			onFinishHydration: (fn: () => void) => () => void;
			hasHydrated: () => boolean;
		};
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
		if (!inputValue.trim() || !conversationId || submittingRef.current) return;
		submittingRef.current = true;
		setSendInFlight(true);
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
		const clearOnce = () => {
			if (cleared) return;
			cleared = true;
			if (initializedRef.current !== conversationId) return;
			setInputValue((current) => clearSubmittedText(current, submitted));
			if (conversationId && staged && !stagedSettledByAsk)
				clearStagedPayload(conversationId, staged);
		};
		/*
		 * The persisted draft is retired as the send settles, not as it starts,
		 * because until then the text is still this composer's: the box is holding
		 * it, or a refusal is about to put it back.
		 */
		const retireDraft = () => {
			lastPushedRef.current = "";
			setCurrentInput(conversationId, "");
			resetCurrentHistoryIndex(conversationId);
			draftMessageRef.current = "";
		};
		try {
			outcome = await onSubmit?.(submitted, clearOnce);
			if (outcome === false) {
				// A refusal is the ONE outcome that returns the text to the user's
				// editing: nothing was admitted, so the composer is where it belongs -
				// but only into an EMPTY box, since the user may have typed the next
				// message while this one was in flight and that text is theirs.
				/*
				 * AND THE CHIPS COME BACK WITH IT, which is why they are restored inside
				 * this same gate rather than beside it. The refusal may have arrived
				 * AFTER the echo (413/422, and everything thrown once admission was
				 * attempted), and the echo is what took the chip row - so without this
				 * the box would hold the restored wording beside an empty chip row, and
				 * the obvious next Enter would send the message without the file. The two
				 * halves are moved by the same condition on purpose: a restore that can
				 * put back one and not the other is the class of defect both rules
				 * above exist for.
				 */
				if (initializedRef.current === conversationId) {
					setInputValue((current) => restoreSubmittedText(current, submitted));
					if (conversationId && staged)
						restoreStagedPayload(conversationId, staged);
				}
				return;
			}
			if (outcome === SEND_HELD) {
				/*
				 * The message may be on the owner and its echo is still painted, so the
				 * text must not come back to the box - nor be adopted into it on a later
				 * mount, which is what retiring the persisted draft here prevents. The
				 * retry lives on the store's claim (`Restore message`), whose
				 * resend replays the same request id.
				 */
				/*
				 * THE FILES DO THE OPPOSITE, and that is not a contradiction. The
				 * unchanged-payload guard compares text AND files AND images, so a claim
				 * left holding a payload whose chip the echo had already taken would
				 * refuse the very retry `Restore message` exists to make possible (its
				 * press hands back the claim's own `submittedAttachments`). The text
				 * stays out because a copy of it is painted in the transcript; the chip
				 * comes back because nothing else can reproduce the file - and only into
				 * an empty row, so a chip the user attached since is untouched.
				 */
				if (
					conversationId &&
					staged &&
					initializedRef.current === conversationId
				)
					restoreStagedPayload(conversationId, staged);
				retireDraft();
				return;
			}
		} finally {
			submittingRef.current = false;
			/*
			 * The wait ends with the submit, whichever way it ended. Deliberately not
			 * with the echo: between the echo and the settle the message IS on screen
			 * and the send is still unconfirmed, which is the window the composer's
			 * sentence is about.
			 */
			setSendInFlight(false);
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
			if (e.key === "ArrowUp" && isCursorAtFirstLine()) {
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
		 * A send this composer made has not settled yet. Exposed because it is
		 * the composer's own press, and the placeholder that states it is the
		 * composer's to render (see the state's declaration above for why it is
		 * not read from the transcript).
		 */
		sendInFlight,
	};
};
