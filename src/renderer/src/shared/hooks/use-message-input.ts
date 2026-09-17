/**
 * Hook for managing message input with robust per-conversation persistence and log-based history navigation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
// The one filename rule, rather than a second copy of it: the sentence this
// module builds names a file, and every other surface that names one goes
// through here. A RELATIVE specifier across the same boundary, because the
// `@features` alias is a tsconfig path that some of the suites bundling this
// module by hand do not declare - and a unit of the renderer should not become
// unbundleable by a test just because it needed a filename.
import { getFileName } from "../../features/chat/utils/get-file-name";
import {
	type Attachment,
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

/** What a submit reported back to the composer. See `SEND_HELD`. */
export type SendOutcome = undefined | boolean | typeof SEND_HELD;

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
 * holding files the user just picked, and overwriting those is loss - on the
 * named-session arm that is exactly the state (`conversationId` never changes,
 * so the chips were never cleared and there is nothing to restore). Empty answer
 * means "adopt nothing", never "clear what is there".
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
		if (!hydrated) return;
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
	// Admission, not the keypress, retires a draft. A refused send hands its text
	// back to the box; an UNCONFIRMED one leaves its text with the claim that
	// carries the retry, so nothing the user typed is lost either way.
	const handleSubmit = useCallback(async () => {
		if (!inputValue.trim() || !conversationId || submittingRef.current) return;
		submittingRef.current = true;
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
		 * observes on the buffered path (round 7, F1). Both triggers clear only the
		 * text this submit is carrying, once per submit.
		 *
		 * The payload is still captured ONCE and threaded through every consumer
		 * below. Re-reading `inputValue` after a clear yields "", which would
		 * submit an empty message and make the store's unchanged-payload guard
		 * compare every retry against "" and refuse it. One value, one meaning.
		 */
		const submitted = inputValue;
		/*
		 * One clear per submit, whichever of its two triggers gets there first,
		 * and only over the text this submit is actually carrying: an echo that
		 * lands late - or on a composer that has since been remounted - must not
		 * clear something the user has typed in the meantime.
		 */
		let cleared = false;
		const clearOnce = () => {
			if (cleared) return;
			cleared = true;
			if (initializedRef.current !== conversationId) return;
			setInputValue((current) => clearSubmittedText(current, submitted));
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
			const outcome = await onSubmit?.(submitted, clearOnce);
			if (outcome === false) {
				// A refusal is the ONE outcome that returns the text to the user's
				// editing: nothing was admitted, so the composer is where it belongs -
				// but only into an EMPTY box, since the user may have typed the next
				// message while this one was in flight and that text is theirs.
				if (initializedRef.current === conversationId)
					setInputValue((current) => restoreSubmittedText(current, submitted));
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
				retireDraft();
				return;
			}
		} finally {
			submittingRef.current = false;
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
	};
};
