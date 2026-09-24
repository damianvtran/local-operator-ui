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

/** What a submit reported back to the composer. See `SEND_HELD`. */
export type SendOutcome = undefined | boolean;

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

export const COMPOSER_PLACEHOLDER = {
	unavailable: "This conversation is gone",
	busy: "Agent is busy",
	answer: "Answer the question above",
	sending: "Sending your message",
	waiting: "Waiting for the agent",
	idle: "Ask me for help",
} as const;

/**
 * The one sentence the box's placeholder slot carries, first match wins.
 *
 * The READ of the order: a conversation this machine does not have outranks every
 * other reading (`isInputDisabled` is true for one, so the gone-state sentence has
 * to be asked first or a reader of a missing conversation is told `Agent is busy`
 * about a turn nobody is running - design round 2, D3); then the box's own
 * refusal; then a gate that is waiting to be answered; then THIS pane's send; then
 * the agent; then the invitation.
 */
export const composerPlaceholder = (state: {
	/** The conversation is not on this machine. */
	unavailable: boolean;
	/** `isLoading && currentJobId` - the box is refused, with its own sentence. */
	inputDisabled: boolean;
	/** A pending `ask` gate is waiting for an answer in this pane. */
	awaitingAnswer: boolean;
	/** A send this pane issued has not settled. */
	sendingUnsettled: boolean;
	/** A send has been issued and the agent has not painted anything yet. */
	awaitingReply: boolean;
}): string => {
	if (state.unavailable) return COMPOSER_PLACEHOLDER.unavailable;
	if (state.inputDisabled) return COMPOSER_PLACEHOLDER.busy;
	if (state.awaitingAnswer) return COMPOSER_PLACEHOLDER.answer;
	if (state.sendingUnsettled) return COMPOSER_PLACEHOLDER.sending;
	if (state.awaitingReply) return COMPOSER_PLACEHOLDER.waiting;
	return COMPOSER_PLACEHOLDER.idle;
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
	const beginInFlight = useConversationInputStore((s) => s.beginInFlight);
	const adoptReturnedText = useConversationInputStore(
		(s) => s.adoptReturnedText,
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

	/*
	 * THE FAILED MESSAGE COMES BACK HERE.
	 *
	 * A send that did not settle either queues its text on this row (`pendingText`,
	 * written by the store's return path) or, on the New-chat flip, leaves it in the
	 * row the flip replaced - both of which `adoptReturnedText` resolves into one
	 * merged value. The merge is against the text the store holds rather than the
	 * box above, deliberately: outside a capture the two are the same text, and
	 * inside one the store's copy is the one that was never overwritten by mask
	 * cells.
	 *
	 * Three guards, each for a different failure. `initializedRef` means this
	 * composer has taken charge of this conversation (a mount for another
	 * conversation must not adopt this one's payload). `draftHeld` is the masked
	 * capture: adopting text into a box the capture owns would put a returned
	 * message inside a credential it is not part of - the capture's own write at
	 * its end then merges over it, which is the same reason the keystroke path
	 * declines while it is open. And the effect re-runs on the row, so a return that
	 * arrives while the user is typing lands as soon as this composer can take it
	 * rather than being dropped.
	 */
	const pendingReturn = useConversationInputStore((s) =>
		conversationId
			? s.inputByConversation[conversationId]?.pendingText
			: undefined,
	);
	useEffect(() => {
		if (!hydrated || !conversationId) return;
		if (pendingReturn === undefined) return;
		if (initializedRef.current !== conversationId) return;
		if (draftHeld) return;
		const merged = adoptReturnedText(conversationId);
		if (merged === null) return;
		lastPushedRef.current = merged;
		/*
		 * No caret move: the composer's own caret effect owns that, and the box
		 * ends where the merged text does, which is where the user's next keystroke
		 * continues from (their own sentence follows the returned one).
		 */
		setInputValue(merged);
	}, [pendingReturn, hydrated, conversationId, draftHeld, adoptReturnedText]);

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
			if (initializedRef.current !== conversationId) return;
			setInputValue((current) => clearSubmittedText(current, submitted));
			if (conversationId)
				beginInFlight(
					conversationId,
					{
						text: submitted,
						attachments: staged?.attachments ?? [],
						replies: staged?.replies ?? [],
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
			/*
			 * The echo trigger RECORDS and the post-await fallback does not, and the
			 * difference is the whole of the quit-mid-flight fix: the payload is held
			 * as in flight only while its outcome is unknown. A `clearOnce()` after
			 * the await runs for a send that has already settled - a slash command, a
			 * gate answer, an accepted message with no echo - and recording there
			 * would leave a durable "unconfirmed" record over a message the owner
			 * took, which a restart would then hand back to the user as unsent.
			 */
			const outcome = await onSubmit?.(submitted, () => clearOnce(true));
			if (outcome === false) {
				/*
				 * THE FAILURE ARM'S WHOLE JOB IS TO NOT UNDO THE STORE'S WORK. The
				 * payload is already back in this composer's store row - text, chips
				 * and staged quotes - written there by the store's own return path
				 * (`returnPayloadToComposer`), because a restore performed HERE only
				 * works while this component stays mounted: on the New-chat path the
				 * identity flip unmounts it mid-send, which is how the user ended up
				 * told to fix a message the box no longer showed (UX round 3, U14).
				 *
				 * So: no local restore, no `retireDraft` (it would wipe the text the
				 * store has just handed back), and no `addSubmittedMessage`. The text
				 * reaches the box through the adoption effect below, which merges it
				 * with whatever the user typed during the flight.
				 */
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
		 */
		clearOnce();
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
