import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { TranscriptionApi } from "@shared/api/local-operator/transcription-api";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { ErrorBoundary } from "@shared/components/common/error-boundary";
import { Button, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config/api-config";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import {
	SEND_HELD,
	type SendOutcome,
	adoptRefusedPayload,
	refusedSplitNotice,
	useMessageInput,
} from "@shared/hooks/use-message-input";
import {
	SpeechToTextPriority,
	useSpeechToTextManager,
} from "@shared/hooks/use-speech-to-text-manager";
import { cn } from "@shared/lib/utils";
import { buildSendPayload } from "@shared/store/canonical-sessions-store";
import {
	type Attachment,
	type Reply,
	useConversationInputStore,
} from "@shared/store/conversation-input-store";
import { normalizePath } from "@shared/utils/path-utils";
import {
	showErrorToast,
	showSuccessToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import {
	Check,
	CircleAlert,
	Mic,
	Paperclip,
	Send,
	Square,
	X,
} from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
	CanonicalFrontendState,
	CanonicalModel,
} from "../../../../../shared/desktop-session-contract";
import { composerFocusIsOurs, shouldTabIntoAnswerOptions } from "../ask-answer";
import {
	CAPPED_BLOCK,
	CHAT_COLUMN_CONTAINER,
	CHAT_COLUMN_INSET,
	CHAT_MEASURE,
} from "../chat-measure";
import {
	COMPOSER_TEXTAREA_SELECTOR,
	registerComposerFocus,
} from "../composer-field";
import type {
	DraftPickerDestination,
	DraftResolution,
} from "../draft-selection";
import { MOVE_UNAVAILABLE_REASON } from "../move-session";
import { DESTINATIONS } from "../pickers/picker-registry";
import { SessionStatusStrip } from "../session-status/session-status-strip";
import type { Message } from "../types/message";
import { AttachmentsPreview } from "./attachments-preview";
import { AudioRecordingIndicator } from "./audio-recording-indicator";
import { ComposerStatusRow } from "./composer-status-row";
/*
 * The composer's inline credential capture (design §1-§9). The pure module owns
 * every rule the gesture rests on — the arm predicate, the mask, the positional
 * mirror, the marker grammar, the citation rewrite — and this file only routes
 * keystrokes, pastes and the submit seam into it. See `credential-capture.ts`
 * for why that split is the point rather than tidiness.
 */
import {
	CREDENTIAL_ARMED_NOTICE,
	CREDENTIAL_EMPTY_SPAN_DRAFT_NOTICE,
	CREDENTIAL_EMPTY_SPAN_NOTICE,
	CREDENTIAL_STORE_TIMEOUT_MS,
	CREDENTIAL_TYPING_NOTICE,
	type CancelledToken,
	type Capture,
	type CredentialPayload,
	IDLE_CAPTURE,
	type UnredactedDisclosure,
	type UnstoredReason,
	applyDomEdit,
	armSpan,
	cancelTypedCredential,
	capturePasted,
	citedPayloads,
	credentialNamesFrom,
	holdsCancelledToken,
	isArmed,
	isTyping,
	mintTypedCredential,
	storedNotice,
	substituteCredentials,
	syncCapture,
	typeIntoCapture,
	unbackedMarkers,
	unredactedNotice,
	unredactedOverBuffer,
	unstoredNotice,
} from "./credential-capture";

/**
 * The id the capture's notice carries, so the field it describes can name it.
 *
 * One composer per pane and one notice per composer, so a constant is enough;
 * it is a constant rather than a prop because the relationship is between two
 * elements of THIS component and nothing outside it should need to know.
 */
const CREDENTIAL_NOTICE_ID = "composer-credential-notice";
import { sampleSuggestions } from "./composer-suggestions";
import { ComposerTipRow } from "./composer-tip";
import { CredentialOverlay, composerTextBox } from "./credential-overlay";

import {
	DirectoryIndicator,
	type DirectoryIndicatorHandle,
	type DirectoryWritePath,
} from "./directory-indicator";
import { MeasuredSuggestionStack } from "./measured-suggestion-stack";
import { ReplyPreview } from "./reply-preview";
import type { RunDetails } from "./run-details";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import {
	type CompletionRow,
	SlashSuggestionsPopup,
	handleSlashKeyDown,
	useSlashCompletion,
} from "./slash-commands";
import { completionFor } from "./slash-completion";
/*
 * `extensionFor` comes from the CONTRACT module rather than from the popup
 * component: the ambiguous Enter's splice is a pure function of the draft, the
 * caret and the word span, and living there is what lets
 * `scripts/slash-contract.test.mjs` bundle and execute the shipped function.
 */
import {
	extensionFor,
	pickArmsCommand,
	pointerPickRuns,
	reassembledNote,
	stagedNote,
} from "./slash-contract";
/*
 * `SlashDispatchOutcome` is imported as a TYPE only: the composer hands a
 * spliced command line to the page's dispatcher and must know whether it ran to
 * decide what the box holds afterwards, but it must not own any part of how the
 * command runs.
 */
import type { SlashDispatchOutcome } from "./slash-dispatch";
import { planSlashArming, planSlashSubmission } from "./slash-submit";
import type {
	SlashCommandInvocation,
	SlashSubmissionPlan,
} from "./slash-submit";
import { WaveformAnimation } from "./waveform-animation";

/**
 * A send that did not land, described for the composer that owns its text.
 *
 * Exported because the type is the contract between the page that KNOWS why a
 * send failed and the composer that shows it; `chat-content` only forwards it.
 */
export type ComposerSendError = {
	/**
	 * The failure, when there is one. Absent while only a retained claim needs
	 * showing - the claim outlives the alert (a keystroke dismisses the message
	 * but is not evidence the request did not land), and the user still has to
	 * be able to see that something is being held.
	 */
	message?: string;
	/**
	 * Suppress the generic "Your message is still in the composer. Send it
	 * again." hint for this failure.
	 *
	 * The hint is the alert's "what to do" half (branding section 8) and it is
	 * only ever true when the next send would be ACCEPTED. The read window's
	 * refusal is the case where it is not: the notice retires on the same
	 * condition that closes the window, so the retry is refused by the same rule
	 * for as long as the notice is on screen, and the sentence carries its own
	 * statement of the wait rather than an instruction to retry now (UX round 3,
	 * U9).
	 */
	withholdRetryHint?: boolean;
	actions?: { label: string; onClick: () => void }[];
	/**
	 * The exact payload the store will hold the next send to, when it is holding
	 * one. Supplied rather than described so the composer can put it back: the
	 * guard wants a byte-identical retry of a message that is no longer on
	 * screen, which is not something a user can reproduce by hand.
	 */
	heldText?: string;
	/**
	 * The payload a refusal that admitted NOTHING owes the box, when the store is
	 * still holding it (`refusedBeforeAdmissionText` in the canonical store).
	 *
	 * A separate field from `heldText` because they are opposite answers to
	 * opposite facts: a claim must stay OUT of the box (the message may be on the
	 * owner and its echo is painted), this one belongs back IN it.
	 *
	 * It has to be handed over rather than restored by the composer that sent it,
	 * which is what the local restore in `use-message-input` does: on the arm a
	 * "New chat" uses, the session is created inside the send and the panel is
	 * re-keyed onto the id that send minted, so the restoring composer is already
	 * unmounted and the one that replaces it has no copy of the text. The store's
	 * row is the surviving copy, and this is how it reaches the box.
	 */
	refusedText?: string;
	/**
	 * The attachments that same refusal owes the box, from the row that survives
	 * the composer the send unmounted (`refusedBeforeAdmissionAttachments`).
	 *
	 * Handed over with the text rather than restored from the composer's own
	 * store because they are one payload: the chips live in
	 * `inputByConversation[conversationId]` under the PRE-FLIP identity, so after
	 * the flip the composer that mounts has an empty chip row and no way to learn
	 * what the refused send carried. Restoring the text without them is a send
	 * that silently loses the user's file (round 7, R17).
	 */
	refusedAttachments?: string[];
	/** Retire the alert after the held text has been restored into the box. */
	onRestoreHeld?: () => void;
	/** Drop the claim AND the draft. The message is finished with. */
	onDiscard?: () => void;
	/** Drop the claim only, keeping the draft row and whatever is typed now. */
	onReleaseHeld?: () => void;
	/** Fired on the first keystroke after the failure, so a corrected draft never carries a stale alert. */
	onDismiss?: () => void;
};

/**
 * Props for the MessageInput component
 */
type MessageInputProps = {
	onSendMessage: (
		content: string,
		attachments: string[],
		/**
		 * Called when the send's optimistic echo reaches a transcript, i.e. when the
		 * text is on screen. Threaded through to `admitChatDraft`; a host with no
		 * echo to wait on (the legacy chat path) may ignore it.
		 *
		 * Read it as "the echo is in a transcript now", not as "your box was
		 * cleared": on the New-chat path the drain delivers it to the composer the
		 * identity flip has already unmounted, while the visible panel paints the
		 * echo in its first state. See `use-message-input.ts` (round 7, F1).
		 */
		onEchoPainted?: () => void,
		/*
		 * What the user actually TYPED, before `buildSendPayload` wraps it in any
		 * staged `<reply-to>` prefix.
		 *
		 * Only the pending-gate answer path reads it, and it exists because that
		 * path must decide whether the composer holds an option ordinal. With a
		 * reply staged, `content` is `"<reply-to>…</reply-to>\n2"`, which is not a
		 * bare ordinal — so the resolver passed it through and the owner received
		 * the whole wrapped string as the answer value (code review round 1,
		 * MAJOR). Passing the typed text beside the payload keeps that decision
		 * independent of how the payload is composed, instead of teaching the
		 * resolver to parse a prefix format it would then have to track forever.
		 */
		typed?: string,
		/**
		 * Called once the session the send is about to use EXISTS and before the
		 * message is admitted, and the only window in which the credential capture
		 * can store into a conversation that send is creating. See
		 * `admitChatDraft`'s `beforeAdmission` for the whole argument; a host that
		 * cannot offer the window simply ignores it, and the composer then keeps
		 * the pre-seam behaviour (an honest not-stored citation).
		 */
		beforeAdmission?: (sessionId: string) => Promise<string | undefined>,
	) => SendOutcome | Promise<SendOutcome>;
	isLoading: boolean;
	/**
	 * A send this composer made has been admitted and the owner has not answered
	 * it yet.
	 *
	 * Its own prop rather than a reuse of `isLoading`, because the two mean
	 * different things here and only one of them may change what the user can
	 * DO. `isInputDisabled` (below) is `isLoading && currentJobId` and it is what
	 * disables the box and swaps Send for Stop; a canonical turn deliberately
	 * keeps the composer live, because typing during a turn steers it and a
	 * pending gate is answered here. So this one changes the PLACEHOLDER only -
	 * the empty box says why pressing Enter does nothing instead of inviting a
	 * message it will refuse - and it gates no send: a send that would have gone
	 * through before still goes through (QA round 1 verified exactly that for
	 * the disabled Send control, and this prop adds no second gate).
	 */
	awaitingReply?: boolean;
	/**
	 * A question is pending and the composer is where it is answered.
	 *
	 * The card above says what is being asked and the reply it expects, and the
	 * box under it said "Ask me for help" - the one place the answer goes was the
	 * one place that did not mention the question (UX round 2, U8). This changes
	 * the PLACEHOLDER only, for the same reason `awaitingReply` does: an
	 * approval is answered by typing into this box, so the box must not invite
	 * something else, and no send is gated by it.
	 */
	awaitingAnswer?: boolean;
	/**
	 * Is a copy of the held payload painted in the transcript above?
	 *
	 * The held-claim sentence points at that copy, and pointing at one that is not
	 * there is worse than saying nothing: on the draft path the pane held no rows
	 * at all, so "its copy is in the transcript above" described a greeting and a
	 * suggestion chip (UX round 2, U3). `undefined` means the caller cannot
	 * answer, and the clause is then left out rather than assumed.
	 */
	heldCopyOnScreen?: boolean;
	conversationId?: string;
	messages: Message[];
	currentJobId?: string | null;
	onCancelJob?: (jobId: string) => void;
	isFarFromBottom?: boolean;
	/**
	 * The user started composing into an empty box.
	 *
	 * Called from the textarea's own onChange because that is the only place a
	 * keystroke is observable; the composer deliberately knows nothing about
	 * what it triggers. Its consumer warms the session's runtime so the send
	 * that follows does not pay a cold engage, and the latch that makes it fire
	 * once per session lives there (`useWarmSession`).
	 */
	onComposerInput?: () => void;
	/** New messages landed while the reader was scrolled up. */
	hasNewActivity?: boolean;
	scrollToBottom?: () => void;
	/**
	 * Canonical-session stop control. Unlike the legacy job cancel, a turn in
	 * flight does NOT disable the composer: typing during a turn steers it, and
	 * a pending gate is answered here. So the stop button sits beside Send
	 * rather than replacing it, and only while the owner is actually working.
	 *
	 * `active` is `busy` AND the backend's `session_interrupt` capability, folded
	 * at the call site rather than here so that the ESCAPE accelerator's own
	 * predicate can be the same expression (`use-interrupt-on-escape.ts`). An
	 * older backend therefore renders no control at all rather than one whose
	 * every press is refused: the button promises this session's CURRENT WORK,
	 * and the only other route this build has for stopping work is `/stop`, which
	 * ends the session - a different promise than the control makes.
	 */
	canonicalStop?: { active: boolean; onStop: () => void };
	/**
	 * Whether this session's backend negotiates `session_interrupt` at all.
	 *
	 * The control's SLOT exists whenever this is true, even while no turn runs:
	 * the reservation below is what keeps the dictation control out of the
	 * position a reflex second press lands on (UX round 1's U1, QA's Q1). It is
	 * the same capability `canonicalStop.active` is folded with at the call site,
	 * so the reservation cannot outlive the control it reserves for.
	 */
	canonicalStopAvailable?: boolean;
	/**
	 * What the last interrupt left running, or null for the common case.
	 *
	 * Deliberately NOT the `sendError` alert, which is the failure register: this
	 * sentence says a stop worked and names work that outlived it, so routed
	 * through the alert it would read as an error and take `role="alert"`'s
	 * assertive announcement for a press the user just made themselves. Muted ink
	 * and its own line, which is what `heldNotice` and `refusedNotice` do in that
	 * same region for the same reason.
	 */
	interruptNotice?: string | null;
	/**
	 * The last send that failed, rendered against this composer rather than at
	 * the top of the page.
	 *
	 * A failed send leaves the user's text in this textarea (see
	 * `useMessageInput.handleSubmit`, which retires a draft on admission and not
	 * on the keypress), so the failure and the message it names are the same
	 * object and belong in the same place. The previous banner rendered at the
	 * very top of the chat column, measured 709px away from the composer holding
	 * the text it was talking about, and re-printed that text into a read-only
	 * box - a second copy of an input the user could already edit.
	 *
	 * `actions` is the "what to do" half of the error contract (branding § 8):
	 * an errorCode that has a specific remedy supplies it here, so the remedy
	 * travels with the message instead of being stranded wherever the message
	 * used to render.
	 */
	sendError?: ComposerSendError;
	/**
	 * The label pool an empty chat samples from. `readonly` because the pool is
	 * a constant the caller owns: the composer draws a sample and never sorts,
	 * appends to or otherwise edits what it was handed.
	 */
	initialSuggestions?: readonly string[];
	agentData?: AgentDetails | null;
	/**
	 * Working directory for this conversation, and the way to change it.
	 *
	 * `cwdWritePath` describes the write path, and it is one value rather than a
	 * callback plus a flag because its two kinds answer differently and the chip
	 * must not be able to mix them: a DRAFT stages the directory
	 * `sessions.create` will use, and a LIVE session with `session_move` moved
	 * (see `useSessionMove`). Absent means the chip renders read-only, with
	 * `cwdReadOnlyReason` saying why - the honest state for an older backend or a
	 * session still being created, rather than a control whose every use fails.
	 */
	cwd?: string;
	cwdWritePath?: DirectoryWritePath;
	/**
	 * Why the chip is read-only here. Supplied per cause rather than assumed:
	 * `MOVE_UNAVAILABLE_REASON` is false on a session that is merely still being
	 * created, and the composer is the layer that knows which of the two it is
	 * looking at (agent review m1).
	 */
	cwdReadOnlyReason?: string;
	/**
	 * A directory move for this session has not been confirmed yet.
	 *
	 * Reaches the chip as `DirectoryIndicatorProps.pending`. It does change the
	 * chip's pixels - the folder glyph becomes the app's spinner, the tooltip and
	 * the live region carry the two pending sentences - because the state has to be
	 * visible on the surface the user is looking at rather than behind a hover
	 * (design review D2); the remaining anatomy is unchanged, so this is the app's
	 * existing in-flight treatment and not a new one.
	 */
	cwdPending?: boolean;
	/**
	 * Whether the backend has accepted the move in flight.
	 *
	 * The chip's two pending sentences make different claims: the first is true from
	 * the commit, the second is a statement about what the backend did. Timed, the
	 * second could announce a restart on a slow refusal; driven by the receipt, it
	 * cannot (UX review round 2, U3).
	 */
	cwdPendingAccepted?: boolean;
	isSmallView?: boolean;
	/**
	 * History has not resolved yet, so "no messages" is not yet a FACT.
	 * The empty state is a claim about the conversation; making it before the
	 * transcript loads is how a populated chat flashed "no messages yet" and
	 * then repainted (design D7).
	 */
	isHydrating?: boolean;
	/**
	 * The conversation is not on this machine (M6), so nothing typed here could
	 * be sent anywhere.
	 *
	 * A separate gate from `isHydrating`, which is about not knowing yet: this
	 * one is a known answer, and it is the one state where leaving the composer
	 * writable invites a doomed action. The transcript above it names the state
	 * and offers the way out; this only refuses the keystroke.
	 */
	unavailable?: boolean;
	/**
	 * Whether this pane can address a SESSION — the dispatcher's own question.
	 *
	 * The page builds one dispatcher per pane and hands it the canonical session id
	 * it may address (`chat-page.tsx`), so this is that answer, stated once beside
	 * the dispatcher instead of re-derived here. The composer needs it because two
	 * of its sentences are about what the NEXT Enter can do — the popup's arming
	 * line and the staged note — and a pane that cannot address a session answers
	 * both with the dispatcher's refusal clause rather than a promise.
	 *
	 * Optional, and absent means NO session to address: the only callers that leave
	 * it out are the story fixtures, and the honest reading of "nobody said" is the
	 * one that does not promise a run. It is deliberately NOT derived from
	 * `sessionStatus` (present on a draft pane, from the preview) or from
	 * `conversationId` (on a draft pane that is the PANE's identity, a non-empty
	 * string) — that derivation is exactly how the note came to promise a goal on
	 * the pane whose next Enter is refused (UX U1).
	 */
	paneHasSession?: boolean;
	/**
	 * The session's own readings — model, effort, context, spend — and the way
	 * to open each one's picker.
	 *
	 * Optional because the legacy (non-canonical) chat path has no canonical
	 * snapshot to read and no command dispatcher to hand back; there the strip
	 * simply does not mount. `onCommand` runs a slash command exactly as typing
	 * it would, which is what keeps the chips from becoming a second way to
	 * reach a picker. See `session-status/session-status-strip.tsx`.
	 */
	sessionStatus?: {
		frontend: CanonicalFrontendState | null;
		onCommand?: (invocation: SlashCommandInvocation) => void;
		/** The rungs `/effort` accepts; see `SessionStatusStripProps`. */
		effortEntities?: readonly unknown[];
		/** A chosen model the owner has not confirmed; see `SessionStatusStripProps`. */
		pendingModel?: CanonicalModel | null;
		/**
		 * This pane is a NEW conversation's draft: there is no session yet, so the
		 * readings come from `sessions.preview` and render inert unless the backend
		 * can select for a draft. See `SessionStatusStripProps["draft"]` for why the
		 * state is passed in rather than inferred from a missing dispatcher.
		 */
		draft?: boolean;
		/**
		 * Open a model or effort picker for this DRAFT pane's own selection.
		 *
		 * Absent unless the backend advertises the capability, which is what leaves
		 * the two readings inert with their existing copy on a backend that cannot
		 * honour a pick. See `SessionStatusStripProps["onOpenDraftPicker"]`.
		 */
		onOpenDraftPicker?: (destination: DraftPickerDestination) => void;
		/**
		 * Where a draft's resolution IS, while it has no reading yet; see
		 * `SessionStatusStripProps["draftResolution"]`.
		 */
		draftResolution?: DraftResolution;
	};
	/**
	 * Run the command the composer's planner pulled out of the draft, and report
	 * what happened to it.
	 *
	 * The SAME dispatcher the chips use, so a command cannot take a second route
	 * with its own outcome mapping. The composer owns the restore/splice decision
	 * afterwards because it is the only place that knows what it held before; when
	 * absent (the legacy chat path has no command dispatcher), nothing is ever
	 * spliced and the draft sends as prose.
	 *
	 * It is handed the planner's answer — a `SlashCommandInvocation` — rather than
	 * the draft: the decision about WHAT a draft submits is the planner's alone
	 * (see `slash-submit.ts`), and this signature is what makes a second such
	 * decision impossible.
	 */
	onSlashCommand?: (
		invocation: SlashCommandInvocation,
	) => Promise<SlashDispatchOutcome>;
	/**
	 * Say something in the composer's own note idiom.
	 *
	 * The dispatcher already owns that surface (`useSlashDispatch`'s `note`), so
	 * the composer borrows it rather than growing a second one. Used for the three
	 * outcomes a user cannot read off the box: a mid-draft name-list command whose
	 * list cannot answer, a staged reassembly that did NOT send, and a staged
	 * ARMING by a pick (the goal is set by the next Enter, not by this one).
	 */
	onSlashNote?: (text: string) => void;
	/**
	 * The run's derived model, for the status row's plan count.
	 *
	 * Passed in rather than derived here, and that is the point of the prop: the
	 * counts on this composer and the counts in the run pane have to be ONE
	 * derivation (`deriveRunDetails`), because a second call here is a second tally
	 * free to disagree with the pane's. `null` on every path with no canonical
	 * session, which is also what keeps the status row off a legacy pane.
	 */
	runDetails?: RunDetails | null;
};

/**
 * How long a send-failure alert stays put before the next keystroke retires it.
 *
 * Dismiss-on-edit is right - an alert over text the user has since fixed is the
 * defect this whole change replaces - but at zero delay it fired on the first
 * character, taking two sentences and up to three remedy buttons off screen
 * before they could be read. Long enough to read the first line, short enough
 * that a user who is deliberately rewriting never notices it.
 */
const ALERT_READ_DWELL_MS = 1500;

/**
 * `promise`, or a rejection once `ms` has passed.
 *
 * The credential store sits ON THE SUBMIT SEAM (§9), so an answer that never
 * comes cannot be waited for indefinitely: a never-resolving transport would
 * park the composer behind a spinner with the user's message inside it. The TUI
 * bounds the same wait with `CREDENTIAL_STORE_TIMEOUT_S` and degrades LOUDLY
 * rather than holding the box, and this is that bound. The timer is cleared on
 * both outcomes so a late answer cannot leave a rejection nobody handles.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	/*
	 * A FUNCTION DECLARATION, not a generic arrow, and that is not a style
	 * preference: `canonical-chat.test.mjs` walks this file with a minimal JSX
	 * scanner to assert that no ancestor of the slash popup clips it, and a
	 * `<T,>` arrow reads to that walker as an opening tag — it loses the tree
	 * and the guard fails closed with "the instrument is broken". The walker is
	 * right to refuse rather than guess; the cost here is one declaration.
	 */
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("credential store timed out")),
			ms,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/**
 * How long the "no longer holding it" confirmation stays after an escape.
 *
 * Long enough for an assertive region to announce it and for a sighted user to
 * catch why the alert changed, short enough that a resolved failure does not
 * leave standing text over a working composer.
 */
const ABANDON_NOTICE_MS = 4000;

const EMPTY_REPLIES: Reply[] = [];
const EMPTY_ATTACHMENTS: Attachment[] = [];

/**
 * The pending gate's first option that a user could actually reach, or null.
 *
 * A held card (an answer in flight, or one already answered) renders every option
 * `disabled`, so this matches nothing and the caller leaves the key event alone.
 */
const firstLiveAnswerOption = (): HTMLElement | null =>
	document.querySelector<HTMLElement>(
		'[aria-label="Answer options"] button:not([disabled])',
	);

/**
 * The composer's textarea, as the reader below finds it.
 *
 * Queried rather than read from a ref because the one caller
 * (`composerHoldsFocusUntouched`) runs from `chat-page.tsx`'s layout effect,
 * outside this component's render, and `COMPOSER_TEXTAREA_SELECTOR` is the same
 * handle the answer options are found by - and the same one the escape ladder's
 * field rule uses, which is why the name lives in a leaf module rather than
 * here (see `composer-field.ts`).
 */
const composerBox = (): HTMLTextAreaElement | null =>
	document.querySelector<HTMLTextAreaElement>(COMPOSER_TEXTAREA_SELECTOR);

/**
 * A staged quote's own remove control, as the removal's focus hand-off finds it.
 *
 * The accessible name is the handle rather than a `data-` attribute, because it
 * is the same one `reply-preview.tsx` labels the control with and the same one a
 * screen reader announces - a second name for the same button is how the
 * control and its selector stop meaning the same thing.
 */
const REPLY_CHIP_REMOVE_SELECTOR = '[aria-label="Remove reply"]';

/**
 * Whether the user has POINTED at the composer since it was last handed focus.
 *
 * A press on an option hands focus here (`chat-page.tsx`), which makes "the
 * composer holds focus" ambiguous between "we put it there" and "the user moved
 * on". Typing resolves that ambiguity on its own - a box with content is not
 * ours - but a CLICK into an empty box does not, and an ask gate advances on its
 * own schedule: the caret is taken, the characters typed next reach nothing, and
 * the following `Space` presses the option that stole focus and posts it as the
 * user's answer to the NEXT question (UX round 4, U13).
 *
 * Module scope rather than component state because the reader is called from
 * `chat-page.tsx`, outside this component. It is set by the textarea's own
 * `onPointerDown` - the interaction that says "I am about to type here" - and
 * cleared wherever this component hands focus over itself, so the flag means
 * "the user has taken it since we last gave it" rather than "the user has ever
 * touched it". Clearing at the hand-off rather than at the press is deliberate:
 * `focusInput` is the single place focus is given, including the press's own
 * hand-off, so a new call site cannot forget to reset it.
 */
let composerPointerTouched = false;

/**
 * Whether the composer holds focus with a box the user has neither typed in nor
 * pointed at.
 *
 * `chat-page.tsx` hands focus HERE at a keyboard press on an option, because the
 * pressed option is `disabled` the moment the press lands and a disabled control
 * cannot hold focus: the browser drops it to the document body, where it stays
 * for the whole request (UX round 3, U12). The decision itself - focus, an empty
 * box, and no pointer interaction since the hand-off - is `composerFocusIsOurs`
 * in `ask-answer.ts`, where it can be asserted without a DOM; this is only the
 * DOM read that feeds it.
 */
export const composerHoldsFocusUntouched = (): boolean =>
	composerFocusIsOurs(
		composerBox(),
		document.activeElement,
		composerPointerTouched,
	);

/**
 * Type for the imperative handle to expose focusInput method
 */
export type MessageInputHandle = {
	focusInput: () => void;
	/**
	 * Focus the working-directory chip and open its menu.
	 *
	 * The bare `/move` form's whole effect: the destination resolves in the
	 * composer's own control rather than in a dialog, so the command has to be able
	 * to reach it. A no-op when the chip is not mounted (no directory is known) or
	 * is read-only, which is why the dispatch branch checks the capability before
	 * asking.
	 */
	openWorkingDirectoryMenu: () => void;
};

/*
 * The composer boundary, defined once: one `border-control` edge on a
 * `bg-surface` ground. The focus ring is the base-layer `:focus-visible`
 * outline, promoted from the textarea to this box via `:has` so the whole
 * composer — previews and toolbar included — reads as one control; the
 * textarea suppresses its own outline so there is never a second ring inside
 * the box. No decorative shadow.
 */
const COMPOSER_BOX = cn(
	"mx-auto flex w-full flex-col border border-control bg-surface",
	"box-border transition-colors duration-fast ease-out-quart",
	// Scoped to `textarea`, not a bare `has-[:focus-visible]`.
	//
	// This box also contains the attach, model and send controls. Unscoped, it
	// ringed itself whenever any of those took focus, while the button drew its
	// own ring at the same time - a ring inside a ring, pointing at the box
	// when the user is on a button. The wrapper draws the ring for the FIELD it
	// frames; every other control in here is responsible for its own.
	//
	// `outline-solid` is required, not decorative: the textarea carries
	// `outline-none`, which pins `--tw-outline-style: none`, and that token
	// survives into this state - so the width from `outline-2` applied and no
	// outline ever painted, leaving the app's primary input with no keyboard
	// focus indicator.
	//
	// `outline-offset-2` matches the other three field wrappers; this one sat
	// at 0 and was the odd one out.
	"has-[textarea:focus-visible]:outline-solid has-[textarea:focus-visible]:outline-2",
	"has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2",
);

/**
 * MessageInput component
 */
export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(
	(
		{
			onSendMessage,
			isLoading,
			awaitingReply = false,
			awaitingAnswer = false,
			heldCopyOnScreen,
			conversationId,
			messages,
			currentJobId,
			onCancelJob,
			onComposerInput,
			isFarFromBottom = false,
			hasNewActivity = false,
			scrollToBottom = () => {},
			canonicalStop,
			canonicalStopAvailable = false,
			interruptNotice,
			sendError,
			initialSuggestions,
			agentData,
			cwd,
			cwdWritePath,
			cwdReadOnlyReason,
			cwdPending,
			cwdPendingAccepted,
			isSmallView = false,
			isHydrating = false,
			unavailable = false,
			sessionStatus,
			onSlashCommand,
			onSlashNote,
			paneHasSession: propPaneHasSession,
			runDetails,
		},
		ref,
	) => {
		/*
		 * The canonical session's cwd is the answer where there is one; the legacy
		 * agent record is the fallback so the old backend path keeps its chip.
		 */
		/*
		 * The canonical session's cwd is the answer where there is one; the legacy
		 * store's value is the fallback below it.
		 *
		 * The AGENT RECORD is a fallback only where the chip has no live write path.
		 * A live move commits against the SESSION, so the value it displays has to come
		 * from the session's own canonical source: falling back to the agent record
		 * would put a directory the session may not be in on an editable chip, one menu
		 * row away from being the path a move commits to (agent review n2). A draft is
		 * the case the backstop is for - its staged cwd starts from the agent's own
		 * default, so the two agree by construction - and the read-only chip keeps it
		 * for the same reason: it displays, and cannot commit.
		 */
		const cwdToShow =
			cwd ??
			(cwdWritePath?.kind === "move"
				? undefined
				: agentData?.current_working_directory);
		const removeReply = useConversationInputStore((state) => state.removeReply);
		const clearReplies = useConversationInputStore(
			(state) => state.clearReplies,
		);
		const addAttachment = useConversationInputStore(
			(state) => state.addAttachment,
		);
		const removeAttachment = useConversationInputStore(
			(state) => state.removeAttachment,
		);
		const clearAttachments = useConversationInputStore(
			(state) => state.clearAttachments,
		);
		const replies = useConversationInputStore(
			useCallback(
				(state) =>
					conversationId
						? (state.inputByConversation[conversationId]?.replies ??
							EMPTY_REPLIES)
						: EMPTY_REPLIES,
				[conversationId],
			),
		);
		const attachments = useConversationInputStore(
			useCallback(
				(state) =>
					conversationId
						? (state.inputByConversation[conversationId]?.attachments ??
							EMPTY_ATTACHMENTS)
						: EMPTY_ATTACHMENTS,
				[conversationId],
			),
		);
		const [isRecording, setIsRecording] = useState(false);
		const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
		const [isTranscribing, setIsTranscribing] = useState(false);
		const mediaRecorderRef = useRef<MediaRecorder | null>(null);
		const audioChunksRef = useRef<Blob[]>([]);
		const [platform, setPlatform] = useState("");
		/*
		 * When the current alert text appeared, for the read dwell above.
		 *
		 * A ref and not state: it is read inside an event handler and must never
		 * itself cause a render, least of all a render of the composer on every
		 * keystroke. Keyed on the message so a SECOND failure restarts the dwell -
		 * new text the user has not read yet, even though the region never
		 * unmounted.
		 */
		const alertShownAt = useRef(0);
		useEffect(() => {
			const message = sendError?.message;
			alertShownAt.current = message ? Date.now() : 0;
		}, [sendError?.message]);
		/*
		 * What to say once the claim is gone.
		 *
		 * Both escapes remove the very thing the alert was reporting, so the region
		 * unmounted the moment they were used: a sighted user sees the row vanish
		 * and infers it worked, but a screen-reader user gets SILENCE at the exact
		 * moment they need to know the thing blocking them is gone, with the next
		 * feedback being whatever the following send happens to produce. Keeping
		 * the assertive region mounted with a short confirmation closes that, and
		 * the confirmation names which of the two abandonments actually happened.
		 */
		const [abandonNotice, setAbandonNotice] = useState<string | null>(null);
		/*
		 * What the refusal's own adoption could not hand back.
		 *
		 * Set by the adoption effect below and only when the halves of the refused
		 * payload part - one owed half back, the other held out by content the user
		 * put in that slot themselves. A draft showing one half of the payload its
		 * alert is still describing reads exactly like a draft showing all of it, and
		 * that is the class of defect this branch exists to remove (round 8,
		 * MINOR-2). Muted ink like `heldNotice`: nothing failed here, the composer is
		 * stating what it did and did not restore.
		 */
		const [refusedNotice, setRefusedNotice] = useState<string | null>(null);
		/*
		 * A second Enter refused while the first send is still unacknowledged.
		 *
		 * The refusal itself is deliberate and the typed text is kept - the store
		 * holds the earlier payload byte-for-byte and the composer keeps whatever
		 * the user has typed since - but it was entirely SILENT: measured in the
		 * live app, the box kept its text, the Send control was greyed out and
		 * Enter did nothing at all, and on a delayed transport the refusal surfaced
		 * nine seconds later inside an alert about the EARLIER send, which reads as
		 * a server problem rather than as "one message at a time" (UX round 2, U6).
		 * The composer is deliberately live during the wait - a user may compose,
		 * and during a turn typing steers it - so Enter is the one action whose
		 * result has to be said out loud.
		 */
		const [heldNotice, setHeldNotice] = useState<string | null>(null);
		/*
		 * Retired with the wait it describes. A send that is no longer outstanding
		 * makes this sentence stale, and the notice is not an error: nothing has
		 * failed, the box is simply one message ahead of the conversation.
		 */
		useEffect(() => {
			if (!awaitingReply) setHeldNotice(null);
		}, [awaitingReply]);
		useEffect(() => {
			if (abandonNotice === null) return;
			const timer = setTimeout(() => setAbandonNotice(null), ABANDON_NOTICE_MS);
			return () => clearTimeout(timer);
		}, [abandonNotice]);
		// A new failure outranks the confirmation of the last one.
		useEffect(() => {
			if (sendError?.message) setAbandonNotice(null);
		}, [sendError?.message]);

		const { hasRadientApiKey, isUnavailable } = useRadientCredentialProbe();
		const canEnableRecordingFeature = hasRadientApiKey && !isUnavailable;

		// The probe cannot tell "no key" apart from "could not ask", so the
		// offline case is named separately rather than sending the user to the
		// settings page to fix an account that is not broken.
		const recordingUnavailableReason = isUnavailable
			? "Voice input is unavailable while Local Operator is offline"
			: "Sign in to Radient in the settings page to enable audio recording";

		/*
		 * Whether the empty-chat prompt belongs in the band.
		 *
		 * Derived here rather than written into the JSX so the wrapper below does not
		 * have to repeat the condition three times: the wrapper is always rendered and
		 * only the prompt's presence is conditional. See the wrapper's own comment for
		 * why that matters (QA round 1, Q4 - focus dropped to `<body>` when a press on
		 * the plan chip narrowed the column across `isSmallView`).
		 *
		 * Above the suggestion sample because that sample is drawn for the prompt's
		 * own mount rather than at the top of the composer's render: a resumed session
		 * that is never empty must not consume the opening sample the first empty chat
		 * of the session is pinned to.
		 */
		/*
		 * THE BAND CENTRES THE COMPOSER: one fact with two consumers, so one
		 * expression. `grow` is what claims the column, and `justify-center` then
		 * centres the group - which means anything added to that group moves all of
		 * it by HALF the addition, the sentence above the box included. That is why
		 * the sentence is mirrored below the group; the mirror's own comment, beside
		 * the sentence it mirrors, carries the measurement.
		 */
		const bandCentred = messages.length === 0 && !isHydrating;

		const showEmptyChatPrompt = bandCentred && !isSmallView;

		/*
		 * The empty chat's sample, drawn once and HELD for this composer's mount.
		 *
		 * A ref rather than the memo's deps, because `showEmptyChatPrompt` is not "a
		 * new chat": the canvas opening or the column crossing `isSmallView` flips it
		 * too, and re-running the draw there re-sampled the row under the reader's
		 * eye - by then the session's pin is consumed, so the second draw is a random
		 * four replacing the four being read (review round 1, R3). The mount is the
		 * unit that owns the sample in both directions: a genuinely new empty chat is
		 * a new identity, and the chat page keys the panel on that identity
		 * (`chat-page.tsx`), so a new chat remounts this composer and draws again.
		 *
		 * The draw still happens during render, and still only while the prompt is
		 * shown: a resumed session that is never empty must not consume the opening
		 * sample the first empty chat of the session is pinned to. Holding it also
		 * keeps the array identity stable across a gate flip, so
		 * `MeasuredSuggestionStack` does not re-measure for unchanged content.
		 */
		const heldSample = useRef<readonly string[] | null>(null);
		const suggestions = useMemo(() => {
			if (!initialSuggestions || initialSuggestions.length === 0) return [];
			/*
			 * Nothing is sampled while the prompt is hidden, and the session's FIRST
			 * draw is the pool's head, which is what makes a committed frame of this
			 * surface reproducible (`composer-suggestions.ts` has the whole
			 * argument).
			 */
			if (!showEmptyChatPrompt) return [];
			if (heldSample.current === null) {
				heldSample.current = sampleSuggestions(initialSuggestions);
			}
			return heldSample.current;
		}, [initialSuggestions, showEmptyChatPrompt]);

		// Node-valued callback refs follow conditional splash remounts; a stable
		// suggestion sample does not imply that the measured DOM is still alive.
		const [band, setBand] = useState<HTMLDivElement | null>(null);
		const [splash, setSplash] = useState<HTMLDivElement | null>(null);

		/*
		 * ---------------------------------------------------------------------
		 * The inline credential capture (§1-§9 of the design document)
		 * ---------------------------------------------------------------------
		 *
		 * THE VALUE LIVES HERE AND NOWHERE ELSE. `payloadsRef` is the map §6
		 * specifies — `{ index, key, value, marker }` keyed by the marker's index —
		 * held in a REF rather than in React state, because state is what gets
		 * serialised: `conversation-input-store` persists to localStorage and the
		 * draft mirror rides on it, so a value that reached either would land on
		 * disk. The buffer carries mask cells and, after Enter, a marker; neither
		 * carries a byte of the secret.
		 *
		 * `capture` is state as well as a ref: the overlay and the notice line have
		 * to repaint as the mode changes, and the ref is what the event handlers read
		 * so a handler built for one render cannot act on a stale capture.
		 *
		 * `unredactedChars` is the one disclosure the app makes, and it is the
		 * operator's
		 * own Esc: §5's notice that the characters are now plain text in the
		 * composer. The sentence is derived from the count at the render site rather
		 * than held as state, because it describes an EVENT and the state that follows
		 * it is an ordinary composer holding prose.
		 */
		const [capture, setCaptureState] = useState<Capture>(IDLE_CAPTURE);
		const captureRef = useRef<Capture>(IDLE_CAPTURE);
		const setCapture = useCallback((next: Capture) => {
			captureRef.current = next;
			setCaptureState(next);
		}, []);
		const payloadsRef = useRef(new Map<number, CredentialPayload>());
		const nextIndexRef = useRef(1);
		/*
		 * §5's disclosure, held as the COUNT of characters it is about AND the buffer
		 * those characters are in, rather than as the sentence or as a bare number.
		 * The sentence itself stays one authority (`unredactedNotice`).
		 *
		 * THE TEXT IS THE OTHER HALF, and round 3 is why (UX round 3, U12; code review
		 * round 3, MINOR 1). A count on its own is a claim somebody else can invalidate:
		 * the sentence says "N characters are now PLAIN TEXT in the composer", and after
		 * the operator's very next Backspace the box holds fewer than N — while the
		 * number was still written to the draft WITH the new text on every keystroke, so
		 * a reload brought the false sentence back (measured: four backspaces left the
		 * notice claiming 11 characters over a 7-character remnant, and a cleared box
		 * re-persisted the stale 7 under nine characters of ordinary prose). Pairing the
		 * count with the text it describes makes "does this draft disclose anything" a
		 * DERIVATION rather than a second fact to keep in step: the disclosure stands
		 * only while the box still holds that text, so ANY edit retires it and the
		 * rendered sentence and the persisted count fall together, in one rule, instead
		 * of one of them going stale in one direction (`setCurrentInput` zeroes it for an
		 * EMPTY value; this is the half that covers every other edit).
		 *
		 * A ref beside the state for the same reason `captureRef` exists: the
		 * CANCEL that produces this number writes it in the same tick as the buffer
		 * (`applyCapture` → `persistDraft`), and a closure still reading the render
		 * it was built in would persist the previous count — or none — which is
		 * exactly the class of defect design round 2's D2 filed.
		 */
		const [disclosure, setDisclosureState] =
			useState<UnredactedDisclosure | null>(null);
		const disclosureRef = useRef<UnredactedDisclosure | null>(null);
		const setDisclosure = useCallback((next: UnredactedDisclosure | null) => {
			disclosureRef.current = next;
			setDisclosureState(next);
		}, []);
		/*
		 * The disclosure AS IT APPLIES TO ONE BUFFER: 0 unless this is the text the
		 * count describes. Every writer of the draft asks THIS — including the
		 * keystroke path inside `useMessageInput`, which asks it about the value it is
		 * about to persist — so a count can never be written with text it does not
		 * describe (UX round 3, U12's repro B, which persisted `unredactedChars: 7`
		 * beside `just some prose`).
		 */
		const disclosureOver = useCallback(
			(buffer: string) =>
				unredactedOverBuffer(disclosureRef.current, buffer) ?? 0,
			[],
		);
		/*
		 * The buffer the CAPTURE itself last wrote, so a whole-buffer replacement can
		 * be told apart from the capture's own edit (see the teardown effect below).
		 * A ref rather than a derivation: the two writers land in one React commit,
		 * and the question is only ever "did the capture put this text here?".
		 */
		const captureOwnedBuffer = useRef<string | null>(null);
		/*
		 * The token an Esc cancel just left inert in the buffer (§5).
		 *
		 * It is what keeps the SUBMIT seam from re-reading the restored plaintext as
		 * the `/credential` COMMAND: the notice promices "Enter will expose them",
		 * and the dispatcher used to take the leading token instead — opening the
		 * picker and stripping the very characters the sentence was about (QA round
		 * 1, Q2). Held as the cancel's own arrival offset and text, so it stops
		 * applying the instant an edit moves the token (`holdsCancelledToken`).
		 */
		const cancelledToken = useRef<CancelledToken | null>(null);
		/*
		 * Set when a submit has succeeded, so the payload map is retired with the
		 * BUFFER rather than ahead of it. Clearing the map first left a window in
		 * which the raw `[Credential #1, 19 chars]` painted un-pilled and an Enter
		 * sent a citation nothing backed any more (code review round 1, MINOR-5).
		 */
		const retirePayloads = useRef(false);
		/*
		 * The names the session's store already holds, for the key guard (§8).
		 *
		 * Fetched when the capture ARMS and cached, because the desktop contract is
		 * asynchronously reachable while minting at Enter must stay synchronous —
		 * and a failed or still-running fetch must not block minting, so the mint
		 * consults whatever is cached and always unions this composer's own
		 * in-flight keys (design §7.2). Empty is the honest degrade: it narrows the
		 * collision guard to probability rather than failing a capture whose secret
		 * has already left the buffer.
		 */
		const sessionNamesRef = useRef<string[]>([]);
		const fetchedNamesFor = useRef<string | undefined>(undefined);
		/*
		 * The session a store can reach, or `undefined` for a draft pane.
		 *
		 * `sessionStatus` IS NOT THE QUESTION — its `draft` flag is (UX round 2, U8;
		 * QA round 2, Q5). The page supplies a status object for BOTH cases: a live
		 * session and a New-chat pane reading `sessions.preview` (`draft: true`,
		 * `chat-page.tsx`), because the status strip renders the draft's own readings
		 * from the preview. Testing the object for truthiness therefore answered "yes,
		 * there is a session" on exactly the pane where there is not one, and the
		 * composer stored against the pane's own non-session id: `desktopRequestSchema`
		 * refuses it locally (a session id must be twelve hex digits) with a 422 that
		 * never reaches the wire, the composer reads that 4xx as a store refusal, and
		 * the operator's FIRST message in a new chat arrived at the model as
		 * `[credential NOT stored — its value did not survive]` with a warning toast
		 * after the fact. Measured three times over three lanes: no
		 * `POST …/credentials` on the wire, an empty session store, and no child ever
		 * seeing a value — while the in-process pin passed, because it mounts the
		 * composer with no status object at all.
		 *
		 * `draft` is the authoritative "no session yet" signal, and it is the page's
		 * own: it is set in the two branches that have no `sessionId` and nowhere
		 * else. Absent (a live session, or the legacy path) means the pane can store
		 * directly.
		 */
		const credentialSessionId =
			sessionStatus && !sessionStatus.draft ? conversationId : undefined;

		/*
		 * The submit seam (§9): store what the text cites, then rewrite every
		 * citation.
		 *
		 * ORDER IS THE WHOLE OF IT. The citation the model receives is written from
		 * the store's ANSWER, so the model is never handed a name nothing holds —
		 * and a marker the user backspaced away is not cited, so its secret is never
		 * stored (the same rule that drops an uncited image).
		 *
		 * The value never touches the outgoing text: the citation names the key and
		 * states that its value cannot be read. That is the entire point of the
		 * substitution, and `substituteCredentials` is the one authority for its
		 * wording, shared with the tests.
		 */
		const storeCitedCredentials = useCallback(
			async (
				text: string,
				/*
				 * The session to store into, defaulting to the pane's own. The argument
				 * exists for ONE caller — the send that is creating the session — which
				 * has the id only inside the seam (`beforeAdmission`) because the create
				 * happens between the composer and the transport (UX round 1, U2).
				 */
				sessionId: string | undefined = credentialSessionId,
			): Promise<{ text: string; stored: string[]; refused: string[] }> => {
				/*
				 * Materialised ONCE, because the submit walks the map more than once (the
				 * cited set, the unbacked markers, the rewrite) and a `Map.values()`
				 * iterator answers only the first walk.
				 */
				const listed = [...payloadsRef.current.values()];
				const cited = citedPayloads(text, listed);
				/*
				 * AN UNBACKED MARKER IS A REASON TO RUN, WITH NO STORE CALL BEHIND IT
				 * (design round 2, D2 + UX round 2, U11). A restored draft's marker is
				 * part of a NORMAL message — nothing is stored for it, because its value
				 * did not survive — but the model must still not receive the
				 * composer-local `[Credential #N, M chars]`, so the rewrite has to
				 * happen exactly as it does for a citation. Without this the early
				 * return sent the bare marker verbatim, which is the silent failure
				 * `substituteCredentials` exists to remove.
				 */
				if (cited.length === 0 && unbackedMarkers(text, listed).length === 0)
					return { text, stored: [], refused: [] };
				const refused = new Map<number, UnstoredReason>();
				const stored: string[] = [];
				for (const payload of cited) {
					if (!sessionId) {
						// No session to reach (a draft pane with no seam), which is the TUI's
						// `null` answer: the round-trip could not be made at all.
						refused.set(payload.index, "unreachable");
						continue;
					}
					try {
						const answer = await withTimeout(
							desktopResult<{ data?: { ok?: boolean; reason?: string } }>({
								op: "sessions.credential",
								sessionId,
								action: "store",
								key: payload.key,
								value: payload.value,
							}),
							CREDENTIAL_STORE_TIMEOUT_MS,
						);
						if (answer?.data?.ok === false) {
							refused.set(
								payload.index,
								answer.data.reason === "empty-key" ? "rejected-key" : "lost",
							);
							continue;
						}
						stored.push(payload.key);
					} catch (error) {
						/*
						 * WHICH CAUSE, and how little this transport can say about it.
						 *
						 * The route collapses every store refusal into one 409
						 * (`server/routes/desktop_lifecycle.py:161-172`): the store's own
						 * `reason` never crosses the wire. What the status DOES separate is
						 * the two things a user acts on differently: a 4xx the route
						 * answered means the store was REACHED and said no, and anything
						 * else — a transport failure (status `null`), a 404 for a session
						 * this backend does not have — means the round-trip could not be
						 * made at all. With a key this composer minted, the reachable
						 * refusal is a blank VALUE, which is exactly the restored draft
						 * whose bytes do not survive (§6), hence `"lost"`.
						 */
						const status =
							error instanceof DesktopControlError ? error.status : null;
						refused.set(
							payload.index,
							status !== null && status >= 400 && status < 500
								? "lost"
								: "unreachable",
						);
					}
				}
				/*
				 * EVERY citation is rewritten, whether it stored or not — a marker left
				 * alone would send a composer-local `[Credential #1, 52 chars]` the
				 * model cannot use (`substitute_credentials`).
				 */
				return {
					text: substituteCredentials(text, listed, refused),
					stored,
					refused: [...refused.keys()].map(
						(index) =>
							listed.find((payload) => payload.index === index)?.key ??
							`#${index}`,
					),
				};
			},
			[credentialSessionId],
		);

		const onSubmit = useMemo(
			() => async (message: string, onEchoPainted?: () => void) => {
				// Assembled by the same function the composer compares against, so the
				// string sent, stored, guarded and reasoned about by the copy is one
				// string on the reply path too. Building the prefix inline here put it
				// downstream of every comparison and deadlocked Restore - see
				// `buildSendPayload`.
				/*
				 * A DRAFT PANE IS THE ONE PLACE THE STORE CANNOT RUN YET, and the most
				 * likely first use of this feature is exactly that pane (UX round 1, U2).
				 * `credentialSessionId` is undefined until a session exists, the session is
				 * created INSIDE the send, and the whole point of §9 is that the value is
				 * in the session's tool environment BEFORE the message citing it leaves.
				 * So when there is no session to reach, the store defers to the host's own
				 * `beforeAdmission` seam - the one window between `sessions.create`
				 * answering and `sessions.message` going out - and the payload it sends is
				 * the UNSUBSTITUTED text, so the seam still gets to write the citation
				 * after it has stored. `settled` carries the answer back out of the seam
				 * for the toasts, which cannot be raised before the send on this path
				 * because there is nothing to raise them about until it lands.
				 */
				let settled:
					| { text: string; stored: string[]; refused: string[] }
					| undefined;
				const seam = credentialSessionId
					? undefined
					: async (sessionId: string) => {
							settled = await storeCitedCredentials(message, sessionId);
							return settled.text;
						};
				// Assembled by the same function the composer compares against, so the
				// string sent, stored, guarded and reasoned about by the copy is one
				// string on the reply path too. Building the prefix inline here put it
				// downstream of every comparison and deadlocked Restore - see
				// `buildSendPayload`.
				const carried = seam
					? { text: message, stored: [], refused: [] }
					: await storeCitedCredentials(message);
				if (carried.stored.length > 0)
					showSuccessToast(storedNotice(carried.stored));
				/*
				 * THE OPERATOR HEARS IT TOO, on every refusal and not only the
				 * all-failed one. Warning rather than info: it reports a gesture that
				 * did not do what it looked like it did, and it names the retry that
				 * actually works — arming `/credential` and pasting again, because
				 * `/credential <KEY>` cannot reach any store (the space after the token
				 * opens a masked capture and the KEY is minted as a short secret).
				 */
				if (carried.refused.length > 0)
					showWarningToast(unstoredNotice(carried.refused));
				const accepted = await onSendMessage(
					// With the seam the payload travels with its MARKERS: the seam stores
					// first, substitutes second, and what leaves is the substituted text.
					buildSendPayload(carried.text, replies),
					attachments.map((a) => a.path),
					onEchoPainted,
					// The typed text, beside the composed payload: the gate answer path
					// resolves an option ordinal against THIS, never against the string
					// the reply prefix produced.
					message,
					seam,
				);
				// The deferred store's own receipts, raised now that they exist.
				if (accepted !== false && accepted !== SEND_HELD && settled) {
					if (settled.stored.length > 0)
						showSuccessToast(storedNotice(settled.stored));
					if (settled.refused.length > 0)
						showWarningToast(unstoredNotice(settled.refused));
				}
				/*
				 * Both failure answers leave the composer's own payload exactly as it is,
				 * replies and attachments included.
				 *
				 * `false` because the text is going back in the box and Enter must be able
				 * to resend it byte-identically. `SEND_HELD` because the store's claim
				 * still holds that payload and its guard compares against it: clearing the
				 * chips here would make the post-Restore resend a DIFFERENT payload, which
				 * the guard refuses - the deadlock Restore exists to escape.
				 */
				if (accepted === SEND_HELD) {
					setHeldNotice(
						"One message at a time - the current message is still on its way.",
					);
					return accepted;
				}
				if (accepted === false) return accepted;
				/*
				 * THE MAP IS CLEARED ONCE THE STORE HOLDS THE VALUES (§9.5), and only
				 * then: a REFUSED send keeps it, because the operator's unsent draft must
				 * not lose the value behind a pill they can still see. `SEND_HELD` is the
				 * same case — the message may be on the owner and its own retry lives on
				 * the store's claim, so the value has to stay until that resolves.
				 */
				/*
				 * THE MAP IS RETIRED ONCE THE STORE HOLDS THE VALUES (§9.5) AND THE BUFFER
				 * HAS STOPPED CITING THEM - the order matters, and getting it wrong was a
				 * real window: clearing the map first left the raw
				 * `[Credential #1, 19 chars]` on screen with nothing to paint it as a pill,
				 * and an Enter inside that window sent a citation no map entry backed any
				 * more (code review round 1, MINOR-5). `retirePayloads` is the request; the
				 * effect below performs it in the commit that empties the box, so the two
				 * cannot be seen apart. A REFUSED send keeps the map, because the
				 * operator's unsent draft must not lose the value behind a pill they can
				 * still see. `SEND_HELD` is the same case — the message may be on the owner
				 * and its own retry lives on the store's claim, so the value has to stay
				 * until that resolves.
				 */
				retirePayloads.current = true;
				setDisclosure(null);
				if (conversationId) {
					clearReplies(conversationId);
					clearAttachments(conversationId);
				}
				return accepted;
			},
			[
				onSendMessage,
				attachments,
				replies,
				conversationId,
				clearReplies,
				clearAttachments,
				storeCitedCredentials,
				// The seam's own decision reads it: with a session there is nothing to
				// defer, so only a new-chat pane hands the host a callback.
				credentialSessionId,
				// The disclosure is retired by the same submit that sends the text it
				// warns about (design round 2, D2's re-raise has this as its other half).
				setDisclosure,
			],
		);

		const {
			inputValue: newMessage,
			setInputValue: setNewMessage,
			handleKeyDown,
			handleSubmit: submitMessage,
			textareaRef,
		} = useMessageInput({
			conversationId,
			onSubmit,
			scrollToBottom,
			// §6: no persisted draft write while a masked capture is open.
			draftHeld: isTyping(capture),
			/*
			 * §5/§6's disclosure travels WITH the draft it describes, on every write
			 * this hook makes — including the keystrokes that follow the cancel, which
			 * is why it rides the hook rather than being written by the composer's own
			 * capture path alone. Design round 2's D2 was the missing half of §6's
			 * deliberate decision to persist the Esc-restored characters: the
			 * characters came back and the sentence that makes them legible did not.
			 *
			 * A FUNCTION OF THE VALUE rather than a number, because the write happens
			 * inside the keystroke's own handler: a number captured at render time still
			 * describes the text BEFORE that keystroke, which is exactly how the stale
			 * count reached the draft with text it did not describe (UX round 3, U12).
			 * The hook asks with the value it is about to write, and the one answer for
			 * "does this text disclose anything" is `disclosureOver`.
			 */
			draftUnredacted: disclosureOver,
		});

		/*
		 * What the sentence is about, AS OF THIS RENDER: the count when the box still
		 * holds the text the Esc produced, and `null` otherwise.
		 *
		 * THE RENDERED HALF of `unredactedOverBuffer`, the same rule `disclosureOver`
		 * wraps for the persisted half — one answer, asked with two buffers, instead of
		 * two predicates that have to be kept in step. What it buys is that the notice
		 * comes DOWN on the first edit (UX round 3, U12): the count and the buffer it
		 * was taken over are compared HERE, so the sentence cannot be rendered over
		 * text it does not describe, in the same commit as the edit that changed the
		 * text. The retirement effect further down clears the state itself (and so the
		 * store with it); this line is why the render cannot lag that effect by a
		 * commit, and the effect is why the state does not outlive the box.
		 */
		const unredactedChars = unredactedOverBuffer(disclosure, newMessage);

		// Slash completion reads the caret position, so it lives above the
		// textarea's own onChange rather than deriving position from the value.
		const [caret, setCaret] = useState(0);
		/*
		 * The live session this composer addresses, or undefined for a draft.
		 *
		 * `sessionStatus` is supplied by the page only when a canonical session
		 * exists, and in that case `conversationId` IS its id (the page opens the
		 * stream on the identity it passes down). So this is the one argument the
		 * argument list's entity source needs, and its ABSENCE is the honest
		 * "needs an open conversation" state rather than a query against a draft
		 * key that could only fail.
		 */
		const slashSessionId = sessionStatus ? conversationId : undefined;
		/*
		 * The pane's own answer, and the one the two arming sentences read: a draft
		 * pane supplies `sessionStatus` (from the preview) and holds a non-empty
		 * `conversationId` (the pane's identity), so "is this composer holding a
		 * session id" is TRUE on the very pane whose next Enter the dispatcher
		 * refuses (UX U1). The popup's line and the note are the surfaces on screen
		 * before and after that Enter, so both take the caller's answer.
		 */
		const paneHasSession = propPaneHasSession ?? false;
		const slash = useSlashCompletion({
			inputValue: newMessage,
			selectionStart: caret,
			sessionId: slashSessionId,
			paneHasSession,
			activeProfile: {
				team: sessionStatus?.frontend?.active_team,
				agent: sessionStatus?.frontend?.active_agent,
			},
		});

		/*
		 * A caret a programmatic edit asked for, written to the DOM once the new
		 * value has rendered.
		 *
		 * `setCaret` alone only moves a shadow of the position: the textarea's own
		 * selection stays where the browser left it, so a completion made under an
		 * IME or by a click would leave the caret at the old cell and the next
		 * keystroke would land in the middle of the completed word.
		 */
		const pendingCaret = useRef<number | null>(null);
		/*
		 * The last buffer React committed, so `applyCapture` can tell a write that
		 * MOVED the box from one that only re-affirmed it. Read by the caret rule
		 * below, which is the whole of the empty-span Escape fix.
		 */
		const bufferNow = useRef(newMessage);
		// biome-ignore lint/correctness/useExhaustiveDependencies: the value is the trigger, the ref is what is written
		useLayoutEffect(() => {
			bufferNow.current = newMessage;
			const field = textareaRef.current;
			const at = pendingCaret.current;
			if (!field || at === null) return;
			pendingCaret.current = null;
			field.setSelectionRange(at, at);
		}, [newMessage, textareaRef, setDisclosure]);

		/*
		 * ---------------------------------------------------------------------
		 * The capture's own routing: keys, the mirrored change path, and paste
		 * ---------------------------------------------------------------------
		 *
		 * THE ORDER IS THE TUI'S (`editor.py:2890`): a live capture is asked FIRST,
		 * ahead of the slash handler and ahead of the ordinary submit, because while
		 * the mask is up the only safe default is that no other handler sees the key
		 * at all. Enter mints rather than sends, Esc cancels rather than dismisses,
		 * and every printable character is absorbed. The keys it does not claim fall
		 * through untouched — the arrows, the modifiers, anything that is not a
		 * printable character — so caret movement keeps its ordinary meaning.
		 */
		/** What the mint consults: the session's names UNION this composer's keys. */
		const takenCredentialNames = useCallback(
			() => [
				...sessionNamesRef.current,
				...[...payloadsRef.current.values()].map((payload) => payload.key),
			],
			[],
		);

		/**
		 * §6's other half: the MARKER text reaches the persisted draft.
		 *
		 * The rule §6 states is that the marker text IS persisted — it holds no
		 * secret — while the draft is not written WHILE the masked capture is open.
		 * Only the first half was implemented: the write was gated on
		 * `draftHeld: isTyping(capture)` as derived at RENDER time, and the mint
		 * writes the new buffer through the same setter in the same tick, while the
		 * mask is still open. So the post-mint value was skipped and no later write
		 * followed: `localStorage` kept the PRE-capture `/credential `, and a remount
		 * restored a token with no pill — contradicting §6 and losing the operator's
		 * citation (QA round 1, Q1).
		 *
		 * Called from the capture's OWN writes, which is where that half of the rule
		 * belongs: `handleChange` cannot see them, because the capture's edits never
		 * went through the textarea. A masked state writes nothing — the whole point
		 * of `draftHeld` — and every state the capture ENDS in does, which is what
		 * makes the persisted draft agree with the box at the moments the box changes
		 * for a reason the operator did not type.
		 *
		 * THE ESC-RESTORED PLAINTEXT IS PERSISTED TOO, deliberately (UX round 1,
		 * U4). Leaving it out kept a secret off disk, which is defensible — but the
		 * draft then held the inert `/credential ` the operator had just cancelled,
		 * so a crash or a quit came back holding a token that looks like a capture
		 * and is not one, with their line gone. The module's own words for that state
		 * are the answer: after the unredact "it is their prose, not a credential",
		 * and the composer persists prose.
		 */
		const persistDraft = useCallback(
			(capture: Capture, buffer: string) => {
				if (!conversationId) return;
				if (isTyping(capture)) return;
				useConversationInputStore.getState().setCurrentInput(
					conversationId,
					buffer,
					// The capture's own writes go through the same one answer as the
					// keystroke path, so a cancel that restores nothing (or a mint, which
					// ends the disclosure) writes a draft that discloses nothing.
					disclosureOver(buffer),
				);
			},
			[conversationId, disclosureOver],
		);

		/**
		 * Write one settled credential state into the composer.
		 *
		 * The value map and the buffer are written together and never apart: a
		 * buffer updated without its map is a pill whose secret is gone, and a map
		 * updated without its buffer is a secret nothing cites.
		 */
		const applyCapture = useCallback(
			(next: {
				capture: Capture;
				buffer: string;
				caret: number;
				payload?: CredentialPayload | null;
			}) => {
				const payload = next.payload ?? null;
				if (payload) {
					payloadsRef.current.set(payload.index, payload);
					nextIndexRef.current = Math.max(
						nextIndexRef.current,
						payload.index + 1,
					);
				}
				/*
				 * THE CARET IS ONLY MOVED WHEN THE BUFFER MOVED WITH IT (design §5; UX
				 * round 1, U1). The two are one write in every state but one, and that
				 * one is the EMPTY-SPAN ESCAPE: with nothing masked there is nothing to
				 * restore, so `cancelTypedCredential` answers the buffer it was given —
				 * React bails out of the identical `setNewMessage`, the effect above
				 * never runs, and the position parked here was therefore never consumed.
				 * It stayed armed for the operator's NEXT character, which landed at the
				 * old offset with the caret snapped back one behind it — measured as
				 * "/credential ", Esc, "hello there" -> "/credential ello thereh", every
				 * character inserted before the previous one. The reference closes this
				 * by suspending the cancel's own edit from the sync
				 * (`_cancel_credential_typing`'s `_suspend_credential_sync`,
				 * `editor.py:6452`); the port has no sync on that path at all, so the
				 * equivalent is to not post a caret the buffer never asked for.
				 */
				if (next.buffer !== bufferNow.current) {
					pendingCaret.current = next.caret;
					setCaret(next.caret);
				}
				/*
				 * The capture's own write, so the teardown effect below can tell it apart
				 * from a whole-buffer replacement somebody else made.
				 */
				captureOwnedBuffer.current = next.buffer;
				// An armed capture is a NEW gesture: whatever the operator cancelled
				// before, this is not it any more.
				if (next.capture.arm) cancelledToken.current = null;
				setCapture(next.capture);
				setNewMessage(next.buffer);
				persistDraft(next.capture, next.buffer);
			},
			[persistDraft, setCapture, setNewMessage],
		);

		/*
		 * A WHOLE-BUFFER REPLACEMENT ENDS A LIVE CAPTURE, and this is the teardown
		 * the reference states twice over (`Editor.load_text`, `editor.py:7033-7099`:
		 * `_abandon_credential_typing("gone")` + `_disarm_credential("gone")`,
		 * naming "a history recall, a restored draft, a `/reload` hand-back, a
		 * sidebar session switch").
		 *
		 * What it looked like without it, reproduced against the real module (code
		 * review round 1, BLOCKER 1): with a masked capture open, an ArrowUp recalled
		 * a prompt into the box, the capture went on reporting TYPING, the operator's
		 * next characters were masked into the STALE value, and Enter minted
		 * `[Credential #1, 7 chars]` over the recalled prompt — deleting their text —
		 * with the stale secret then stored into whichever conversation was current.
		 * The buffer, the mask and the value had stopped describing the same thing,
		 * silently, in the one direction this feature must never fail.
		 *
		 * DROPPED RATHER THAN RE-SYNCED, which is the conservative half the reference
		 * chose: routing this through `syncCapture(..., "arrival")` re-anchors the arm
		 * onto whatever `/credential` the arriving text happens to contain, so a
		 * recalled prompt that merely MENTIONED the command swallowed the next
		 * ordinary paste as a secret, unrecoverably (review round 2, R6b/R6c; QA
		 * round 2, Q4). Failing toward "not armed" costs one retype; failing the
		 * other way cannot be undone.
		 *
		 * `captureOwnedBuffer` is what makes this an EXTERNAL write rather than every
		 * write: `applyCapture` stamps the buffer it wrote and the mirrored DOM change
		 * stamps the buffer it produced, so anything that arrives here without a
		 * stamp came from a history recall, a draft restore, a session switch, a
		 * transcription, a slash plan or a submit's clear — the four triggers the
		 * reference names plus the two this composer adds.
		 *
		 * A layout effect rather than a passive one, so the drop lands in the same
		 * commit as the text: no frame exists in which the buffer says one thing and
		 * the capture another, and no keystroke can arrive in between.
		 */
		useLayoutEffect(() => {
			if (captureOwnedBuffer.current === newMessage) return;
			captureOwnedBuffer.current = newMessage;
			if (!isArmed(captureRef.current)) return;
			setCapture(IDLE_CAPTURE);
			setDisclosure(null);
		}, [newMessage, setCapture, setDisclosure]);

		/*
		 * A CONVERSATION SWITCH RETIRES BOTH HALVES, the payload map included.
		 *
		 * The teardown above drops the capture, which is what stops a stale value
		 * being stored; the map is the other half, and it belongs to the buffer that
		 * is going away. Kept, a payload minted in conversation A can be cited by
		 * conversation B's restored draft the moment the two happen to contain the
		 * same marker text — and it would be stored into B, which is precisely the
		 * "stale value stored into whichever session is current" failure.
		 */
		// biome-ignore lint/correctness/useExhaustiveDependencies: the conversation id is the event; the refs are what is written
		useEffect(() => {
			captureRef.current = IDLE_CAPTURE;
			setCapture(IDLE_CAPTURE);
			payloadsRef.current.clear();
			nextIndexRef.current = 1;
			retirePayloads.current = false;
			cancelledToken.current = null;
			setDisclosure(null);
		}, [conversationId, setCapture, setDisclosure]);

		/*
		 * WHAT THE DRAFT SAYS ABOUT ITSELF, re-raised on arrival (design round 2,
		 * D2).
		 *
		 * §6 persists the Esc-restored characters deliberately — by then they are the
		 * operator's prose — and the teardown above clears this composer's own
		 * disclosure on a switch, which is right for a LIVE cancel and was the whole
		 * of the persisted state: the restored draft came back holding a secret with
		 * no notice, no arm and no pill, and one Enter exposed it. §5 says that state
		 * must never be silent, so the count now travels with the characters in the
		 * draft store and this raises the same sentence on the way back in.
		 *
		 * A subscription rather than a read of the hook's restored value, because the
		 * store is what is persisted and the store is written on every keystroke: the
		 * two are one fact (see `draftUnredacted`), and reading the store is what
		 * makes the disclosure survive a write it did not itself make.
		 *
		 * ROUND 3 STEPPED ON TWO THINGS HERE (UX round 3, U12; code review round 3,
		 * MINOR 3), and both come from the disclosure now being a count AND the text
		 * it describes:
		 *
		 *  - the raise is over the TEXT THE STORE ITSELF NAMES as the draft, and only
		 *    when the box actually holds it. Raising the bare number over whatever text
		 *    happened to be in the box is how a restored count ended up describing
		 *    characters the operator had already deleted.
		 *  - the question "does this draft disclose anything" is asked of the store's
		 *    own `getUnredactedChars`, which is the ONE owner of "0 when there is no
		 *    draft, or one that discloses nothing" — a second reader of the raw field
		 *    is a second rule, and the raw field is subscribed here only so that the
		 *    raise is reactive.
		 *
		 * Ordering is deliberate — this effect is declared AFTER the two that clear
		 * the state, so within the commit that switches conversation the clear runs
		 * first and this re-raises the incoming draft's own disclosure over it. A
		 * count of 0 (no draft, an empty draft, or a draft with nothing unredacted)
		 * is the common case and does nothing at all.
		 */
		const storedUnredactedChars = useConversationInputStore((s) =>
			conversationId ? s.getUnredactedChars(conversationId) : 0,
		);
		const storedDraftText = useConversationInputStore((s) =>
			conversationId ? s.getCurrentInput(conversationId) : "",
		);
		useEffect(() => {
			if (storedUnredactedChars <= 0) return;
			if (!storedDraftText || newMessage !== storedDraftText) return;
			if (disclosureRef.current?.over === storedDraftText) return;
			setDisclosure({ chars: storedUnredactedChars, over: storedDraftText });
		}, [storedUnredactedChars, storedDraftText, newMessage, setDisclosure]);

		/*
		 * ANY EDIT RETIRES THE DISCLOSURE (UX round 3, U12; code review round 3,
		 * MINOR 1). This is the half that was missing: the sentence described the text
		 * the Esc produced, and an edit produces different text — one Backspace left it
		 * claiming eleven characters over seven, and clearing the box left the rendered
		 * sentence up, because the old effect only ever RAISED (`if (stored <= 0)
		 * return`, and nothing else could lower it) while the next keystroke re-persisted
		 * the stale count beside the new prose. Retiring on the edit itself is what makes
		 * the rendered sentence and the persisted count agree: the derivation guards the
		 * render in this same commit, and this clears the state so the write that follows
		 * cannot carry it either.
		 *
		 * A layout effect, so the retirement lands before the browser paints the edited
		 * buffer, and declared after the restore effect so a restored draft is not
		 * retired by the adoption of its own text.
		 */
		useLayoutEffect(() => {
			const held = disclosureRef.current;
			if (held && held.over !== newMessage) setDisclosure(null);
		}, [newMessage, setDisclosure]);

		/*
		 * The map is retired with the BUFFER, never ahead of it (code review round
		 * 1, MINOR-5). `retirePayloads` is the submit's request; this is the commit
		 * that honours it, once nothing in the box still cites a payload — so the box
		 * can never paint a raw marker no map entry backs, and an Enter in that
		 * window can never send a dangling citation.
		 */
		// biome-ignore lint/correctness/useExhaustiveDependencies: the buffer is the event
		useEffect(() => {
			if (!retirePayloads.current) return;
			if (citedPayloads(newMessage, payloadsRef.current.values()).length > 0)
				return;
			payloadsRef.current.clear();
			nextIndexRef.current = 1;
			retirePayloads.current = false;
		}, [newMessage]);

		/*
		 * The session's stored names, fetched when the capture ARMS (§7.2).
		 *
		 * Fired once per session rather than per keystroke, and its failure is
		 * silent on purpose: the guard's job is to avoid silently REPLACING a live
		 * credential, and a name list that could not be read narrows it to
		 * probability — which is the state the TUI documents as the honest degrade —
		 * rather than being a reason to refuse a capture whose secret is already out
		 * of the buffer.
		 */
		useEffect(() => {
			if (capture.arm === null || !credentialSessionId) return;
			if (fetchedNamesFor.current === credentialSessionId) return;
			fetchedNamesFor.current = credentialSessionId;
			void desktopResult<unknown>({
				op: "sessions.credential",
				sessionId: credentialSessionId,
				action: "list",
			})
				.then((answer) => {
					sessionNamesRef.current = credentialNamesFrom(answer);
				})
				.catch(() => {
					/* Keep whatever is cached; see the comment above. */
				});
		}, [capture.arm, credentialSessionId]);

		/**
		 * The capture's answer to a SUBMIT — the ONE rule the key and the button
		 * share (design round 1, D1; QA round 1, Q4).
		 *
		 * The composer already states this invariant about its own planning
		 * ("the SAME planner the Enter key consults, so the Send button and the key
		 * cannot disagree"), and on this one state they did: `planFor` knows about
		 * slash commands and nothing about the capture, so Enter minted the pill and
		 * the Send button submitted the MASK CELLS as the message — the operator's
		 * secret unreachable, a citation the model cannot use, and the notice still
		 * claiming to mask a box that was now empty. Traced in the design round from
		 * the button's own DOM press.
		 *
		 * Three outcomes, and every one of them is one the operator can see:
		 *
		 * - a NON-EMPTY span mints, exactly as Enter does, and the send does not
		 *   happen (the pill is one keystroke from leaving, and the notice has been
		 *   saying what the gesture is);
		 * - an EMPTY span answers `false`, which falls through to the same planner
		 *   Enter falls through to, so `/credential ` + Send reaches the picker —
		 *   the door §1 keeps open for the store, the list and the forget verbs;
		 * - nothing open answers `false` and the send is an ordinary send.
		 *
		 * What is NOT an outcome any more: submitting mask cells, submitting a
		 * half-captured secret, or doing nothing at all with no explanation. The
		 * empty-span case used to be the quiet one — `/credential ` + Send reached
		 * `planFor`, which dispatched `/credential` with the mask cells as its
		 * arguments and let the dispatcher refuse it, leaving the box, the store and
		 * the screen exactly as they were.
		 */
		// biome-ignore lint/correctness/useExhaustiveDependencies: the caret comes from the LIVE field at event time, not from a render value; depending on it would rebuild the key handler on every caret move
		const submitCapture = useCallback((): boolean => {
			const current = captureRef.current;
			if (!isTyping(current)) return false;
			const minted = mintTypedCredential({
				capture: current,
				buffer: newMessage,
				caret: textareaRef.current?.selectionEnd ?? newMessage.length,
				index: nextIndexRef.current,
				taken: takenCredentialNames(),
			});
			// An empty span mints NOTHING and leaves the capture open, so this
			// submit is the ordinary one (§4).
			if (!minted.minted) return false;
			applyCapture(minted);
			setDisclosure(null);
			return true;
		}, [applyCapture, newMessage, takenCredentialNames, setDisclosure]);

		/*
		 * `true` when this keypress belonged to the capture.
		 *
		 * Returning `false` is a real answer and not a miss: an Enter over an EMPTY
		 * span falls through to submit, which is what `/credential ` + Enter means —
		 * the token reaches the dispatcher and the existing picker opens, which is
		 * how the store, the list and the forget verbs stay reachable (§1).
		 */
		const handleCredentialKeyDown = useCallback(
			(event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
				const current = captureRef.current;
				if (!isTyping(current)) return false;
				const field = event.currentTarget;
				const selection = {
					start: field.selectionStart ?? newMessage.length,
					end: field.selectionEnd ?? newMessage.length,
				};

				if (
					event.key === "Enter" &&
					!event.shiftKey &&
					!event.nativeEvent.isComposing
				) {
					return submitCapture();
				}

				if (event.key === "Escape") {
					const cancelled = cancelTypedCredential(current, newMessage);
					if (!cancelled.cancelled) return false;
					/*
					 * THE TOKEN THIS CANCEL LEAVES INERT, remembered so the SUBMIT seam can
					 * keep the promise the notice below makes (QA round 1, Q2). Enter on
					 * the restored draft used to reach the dispatcher, which read the
					 * leading `/credential` as the COMMAND: it opened the picker and
					 * stripped the restored characters out of the operator's sentence, so
					 * the text they were told they were about to expose was destroyed
					 * instead. Recorded at the cancel because the cancel is the only place
					 * that knows which token was the gesture.
					 *
					 * RECORDED FOR THE EMPTY-SPAN CANCEL TOO (UX round 2, U9), which is
					 * the round-2 correction: `null` there was justified by the NOTICE
					 * being suppressed — nothing was restored, so there is nothing to
					 * warn about — and that is true about the notice and false about the
					 * submit. With no token registered, `/credential ` + Esc +
					 * `mysecretname` + Enter dispatched the command, ate the operator's
					 * words as its argument and stripped them out of the box. What the
					 * cancel promises is that the gesture is OVER; the token is how the
					 * submit is told.
					 */
					cancelledToken.current = cancelled.token;
					/*
					 * THE ONE DISCLOSURE THE APP ANNOUNCES, because the frame cannot
					 * say it on its own: after the unredact the composer looks entirely
					 * ordinary while holding characters that are now plain text, and
					 * the very next Enter exposes them. The length is the count, never
					 * the value. An empty cancel owes no warning — it put nothing in
					 * the buffer — and the count travels with the draft it describes, so
					 * the same sentence comes back on a reload (design round 2, D2).
					 *
					 * SET BEFORE `applyCapture`, deliberately, because that call is what
					 * PERSISTS the draft: it asks `disclosureOver` for this buffer, and a
					 * cancel that wrote the characters first and the disclosure second would
					 * put a disclosure-free plaintext draft on disk — silently, and only
					 * after a reload, which is exactly the shape D2 filed. There is ONE such
					 * pair here: the remediation briefly had two, and the duplicate made the
					 * ordering invisible to the pin (code review round 3, MINOR 2).
					 */
					setDisclosure(
						cancelled.restored > 0
							? { chars: cancelled.restored, over: cancelled.buffer }
							: null,
					);
					applyCapture(cancelled);
					return true;
				}

				if (event.key === "Enter") {
					// shift+Enter. An explicit newline ENDS the capture rather than
					// being masked: the masked span is a contiguous run of cells and a
					// newline inside it desynchronises the mint's splice. Composing
					// prose around the pill is what the keystroke is for; a multi-line
					// secret arrives through the paste route instead.
					applyCapture(typeIntoCapture(current, newMessage, selection, "\n"));
					return true;
				}

				if (event.key === "Tab") {
					// Swallowed: a secret has no completions, and a literal tab inside
					// one is far more likely to be a reach for a picker that is not
					// there than an intent to leave the composer mid-capture.
					return true;
				}

				/*
				 * THE GATE IS PRINTABLE CHARACTERS, NEVER KEY NAMES. Textual spells
				 * punctuation keys as words (`minus`, `full_stop`), so a `len(key) == 1`
				 * gate masks letters and digits while every punctuation character falls
				 * straight into the document — measured in the TUI: the canary
				 * `zQ7-TYPED-LEAK-CANARY-4417` rendered as
				 * `•••-TYPED-LEAK-CANARY-4417`. Real credentials are full of `-`, `_`,
				 * `.` and `/`, so that gate leaked almost every actual secret while
				 * looking correct against an alphanumeric test value. Here the test is
				 * one code point of `event.key` with no modifier held, which is the
				 * printable payload rather than the key's name.
				 */
				const printable =
					Array.from(event.key).length === 1 &&
					!event.ctrlKey &&
					!event.metaKey &&
					!event.altKey &&
					!event.nativeEvent.isComposing;
				if (!printable) return false;
				applyCapture(
					typeIntoCapture(current, newMessage, selection, event.key),
				);
				return true;
			},
			[
				newMessage,
				applyCapture,
				// The submit rule the Enter branch shares with the Send button: one
				// function, so the two gestures cannot drift apart again. It carries
				// `takenCredentialNames` itself, which is why that is no longer a
				// dependency here.
				submitCapture,
				setDisclosure,
			],
		);

		/*
		 * THE BOX TAKES BACK A REFUSED SEND'S TEXT FROM THE STORE.
		 *
		 * `useMessageInput` already restores a refused send by writing the submitted
		 * text into its own state, and that is enough only while the composer that
		 * sent it is still mounted. It is NOT, on the arm a "New chat" uses: the send
		 * creates the session inside its own call, the page re-keys this panel onto
		 * the id that send minted, and React unmounts the composer whose state held
		 * the text. The replacement mounts empty, because the text is per-conversation
		 * local state and this conversation did not exist when the send began - so the
		 * refusal's own instruction ("move it below your text") pointed at text that
		 * was no longer anywhere on screen, and the only control left was Discard
		 * (UX round 3 U14, QA round 3 Q7).
		 *
		 * So the store's retained row supplies it (`refusedBeforeAdmissionText`) and
		 * this adopts it - the same rule, and the same `restoreSubmittedText`, that the
		 * local restore applies, now applied to a box that can be newly mounted: on a
		 * remount the refusal is adopted again, which is also what makes the text
		 * reachable after a reload instead of sitting in a persisted row no route
		 * renders. Only an EMPTY box is written, so anything typed while the send was
		 * in flight is never overwritten.
		 *
		 * THE CHIPS COME BACK WITH THE TEXT, on that same rule and for the same
		 * reason (`refusedBeforeAdmissionAttachments`). The user's files are staged in
		 * the conversation-input store under the PRE-FLIP identity, so the composer
		 * that mounts here has an empty chip row while the store's row still holds the
		 * list - and a resend of the adopted text therefore went out with the wording
		 * and WITHOUT the file, silently, and retired the row that recorded it (round
		 * 7, R17). Adopting the paths is what makes the restored draft send exactly
		 * what it shows: the chip row and the payload the next Send carries are the
		 * same list, and images are re-encoded from those paths by the send itself.
		 *
		 * BOTH HALVES GO THROUGH ONE DECISION (`adoptRefusedPayload`), not through the
		 * pair's two rules read independently: the chip write used to sit below the
		 * TEXT rule's early return, so on the arm where the two rules disagree - the
		 * box holds text the user typed, the chip row is empty - the refusal's file
		 * was dropped with nothing said, and a later edit to the text rule would have
		 * changed which refusals restore files without anything failing (round 8,
		 * MINOR-2). The decision adopts each half into its own empty slot - what a
		 * slot that already holds the user's own content keeps, the user keeps - and
		 * answers `withheld` when it had to hold one half back while taking the other.
		 * That answer is SAID on screen below, because a draft carrying one half of a
		 * refused payload looks exactly like a draft carrying all of it.
		 *
		 * The caret goes to the END of the restored text, which is where the user's
		 * was when they pressed Send - and it is not cosmetic here. The planner reads
		 * the token AT THE CARET (`slash-submit.ts`), so a newly mounted composer left
		 * at position 0 reads a leading `/usage` line as the command to RUN and the
		 * next Send splices it out instead of attempting the message: the refusal's
		 * own remedy would be the thing that swallowed it. At the end of the draft the
		 * text reads as prose, exactly as it did on the arm that never re-mounted, and
		 * the popup the box had opened at position 0 closes with it.
		 *
		 * A LAYOUT effect, because the adoption belongs to this commit's paint rather
		 * than to the one after it: as a passive effect the remounted composer painted
		 * an EMPTY box - with the refusal's copy already above it - for one frame
		 * before the text landed (round 7, R20). The caret write it feeds is a layout
		 * effect for the same reason.
		 *
		 * Guarded on the payload already being handed over, once per distinct payload
		 * and never twice for the same one: without that, emptying the box on purpose
		 * would re-fill it on the next render, and a dismissal - which keeps the
		 * payload and clears only the sentence - would do the same. The marker is
		 * therefore named for what it is: it records that this composer has CONSIDERED
		 * this payload, which on the arm where the box already holds the user's own
		 * text happens without the write landing. A marker claiming the write instead
		 * would have to move below the early return, and that placement is the re-fill
		 * above (round 7, R22).
		 */
		const refusedText = sendError?.refusedText;
		const refusedAttachments = sendError?.refusedAttachments;
		const consideredRefusedTextRef = useRef<string | undefined>(undefined);
		useLayoutEffect(() => {
			if (
				refusedText === undefined ||
				consideredRefusedTextRef.current === refusedText
			)
				return;
			consideredRefusedTextRef.current = refusedText;
			/*
			 * One call decides both halves of the payload, so neither can be restored
			 * on the other's outcome. `chips: null` when this composer has no
			 * conversation: then there is no row to write, and the decision must not
			 * report the files as adopted - the sentence below would be false.
			 */
			const adoption = adoptRefusedPayload(
				newMessage,
				conversationId ? attachments : null,
				{ text: refusedText, attachments: refusedAttachments },
			);
			if (conversationId)
				for (const path of adoption.paths)
					addAttachment(conversationId, { id: uuidv4(), path });
			/*
			 * A split is said out loud, once per payload, on the same commit as the
			 * adoption: the user is looking at a draft that carries ONE half of a
			 * message they sent, and nothing else on screen distinguishes that from
			 * a draft that carries both.
			 *
			 * The sentence names the FILES THE DRAFT IS NOT CARRYING
			 * (`adoption.missingFiles`), not every file the refusal owed. On the arm
			 * where the chip row still holds the file the refused send carried - a
			 * named session, where nothing cleared that row - the draft carries all
			 * of them, so there is nothing to say and no sentence is rendered at all
			 * (UX round 5 U17, QA round 4 Q8: the notice claimed a file had been
			 * withheld while its chip sat in the row and the very next send carried
			 * `images: 1`).
			 */
			setRefusedNotice(
				refusedSplitNotice(
					adoption.withheld,
					refusedAttachments,
					adoption.missingFiles,
				),
			);
			// The user's own text is what the box holds, so it keeps the caret too.
			if (adoption.text === newMessage) return;
			pendingCaret.current = adoption.text.length;
			setCaret(adoption.text.length);
			setNewMessage(adoption.text);
		}, [
			refusedText,
			refusedAttachments,
			newMessage,
			attachments,
			conversationId,
			addAttachment,
			setNewMessage,
		]);
		/*
		 * The sentence describes the draft this composer is showing, so it retires
		 * with the record it came from: a refusal the user has discarded or sent
		 * past owes this box nothing, and a split adoption for a payload that is no
		 * longer held is a sentence about a state that ended. The pair travels as one
		 * field-wise payload, so either half going is the record ending.
		 */
		useEffect(() => {
			if (refusedText === undefined && refusedAttachments === undefined)
				setRefusedNotice(null);
		}, [refusedText, refusedAttachments]);

		/*
		 * What Enter should do with this draft, decided by the pure planner — the ONLY
		 * place that answers it (see `slash-submit.ts`'s "one decision" note).
		 *
		 * Both halves of `enabled` matter: a command needs the feature ON and
		 * somewhere to hand it. With neither, the planner answers `send`, so nothing
		 * is ever spliced on a path that could not run it.
		 */
		const planFor = useCallback(
			(draft: string, at: number, gesture: "typed" | "pick" = "typed") =>
				planSlashSubmission({
					gesture,
					draft,
					caret: at,
					commandNames: slash.commandNames,
					promptCommands: slash.promptCommands,
					// The two halves of "this command's trailing text is its
					// argument": a free-text prompt, or a value chosen from a list.
					// Both are registry-derived; the planner takes the union — and
					// `armedOnlyCommands` narrows it further, from main's own arming
					// work, which this branch's rule composes with rather than
					// replaces.
					armedOnlyCommands: slash.armedOnlyCommands,
					valueArgumentCommands: slash.valueArgumentCommands,
					// The registry's own declaration of an argument, which is the
					// only one of the three vocabularies `/login`, `/logout`,
					// `/credential`, `/stop`, `/fast` and `/move` appear in.
					argumentCommands: slash.argumentCommands,
					nameListCommands: slash.nameListCommands,
					enabled: slash.available && Boolean(onSlashCommand),
				}),
			[
				slash.commandNames,
				slash.promptCommands,
				slash.armedOnlyCommands,
				slash.valueArgumentCommands,
				slash.argumentCommands,
				slash.nameListCommands,
				slash.available,
				onSlashCommand,
			],
		);

		/**
		 * Put a line in the box and say what the key DID NOT do.
		 *
		 * Both staging paths — a free-text command reassembled by Enter, and an
		 * armed-only command hoisted by a pick — write the box and the caret the same
		 * way, and both owe the user a sentence about a draft that changed under them.
		 * One helper, so a stage that silently rewrites what somebody typed cannot
		 * exist beside one that explains itself.
		 */
		const stage = useCallback(
			(text: string, at: number, note: string) => {
				pendingCaret.current = at;
				setNewMessage(text);
				setCaret(at);
				onSlashNote?.(note);
			},
			[onSlashNote, setNewMessage],
		);

		/**
		 * The planner, with §5's one exception in front of it.
		 *
		 * AFTER AN ESC CANCEL THE TEXT THE OPERATOR SEES IS WHAT GETS SENT (QA round
		 * 1, Q2). The notice the composer itself raises for that state promises
		 * "Enter will expose them", and Enter did the opposite: the restored draft
		 * still begins with `/credential`, so the planner read it as a COMMAND — the
		 * picker opened, nothing was sent or stored, and mid-prose the dispatcher
		 * stripped the restored characters out of the operator's sentence. The
		 * characters they were just told they were about to expose were destroyed.
		 *
		 * Scoped to the token the composer KNOWS it just cancelled, which is why the
		 * predicate is `holdsCancelledToken` rather than a flag: it matches the exact
		 * run at the exact arrival offset, so any edit that moves it ends the
		 * exception and the token is the dispatcher's again. That leaves today's
		 * behaviour for the case it exists for — `/credential <args>` submitted with
		 * no capture still routes through the dispatcher, which refuses the
		 * arguments, so a secret can never land in command text.
		 *
		 * An EMPTY-span cancel reports its token too (UX round 2, U9), so it is
		 * covered by the same rule: `/credential ` + Esc + `mysecretname` + Enter
		 * used to dispatch the command, eat those words as its argument and strip
		 * them out of the box. `/credential ` + Enter with NO escape at all is
		 * untouched — nothing was cancelled, so the planner still routes it to the
		 * picker, the door §1 keeps open for the store, the list and the forget
		 * verbs.
		 */
		const planForDraft = useCallback(
			(draft: string, at: number): SlashSubmissionPlan =>
				holdsCancelledToken(draft, cancelledToken.current)
					? { kind: "send" }
					: planFor(draft, at),
			[planFor],
		);

		/**
		 * Carry out a plan that is not a plain send, and decide what the box holds
		 * afterwards.
		 *
		 * EVERY non-`send` plan lands here, `whole` included: a whole-draft command is
		 * a consequence of the caret rule, not a different route, and giving it one
		 * (a submit that re-examined the raw text one layer down) is exactly how a
		 * two-line draft was dispatched as `/usage` with line 2 as its argument (QA
		 * round 2, Q4). The command is handed on as the planner parsed it, so nothing
		 * here can disagree with the planner about what the draft is.
		 *
		 * The outcome contract is the dispatcher's, unchanged: `consumed` means the
		 * command ran, so the token is gone and whatever survives it stays;
		 * `retained` and `not-a-command` mean it did NOT run, so the ORIGINAL draft
		 * comes back in full, token included. Restoring rather than deleting is the
		 * whole point — a splice that produced no note and no run would be a silent
		 * deletion of text the user typed.
		 */
		const applyPlan = useCallback(
			async (
				plan: Exclude<SlashSubmissionPlan, { kind: "send" }>,
				draft: string,
				at: number,
			) => {
				/*
				 * A non-`send` plan only exists with a dispatcher (`planFor` answers
				 * `send` without one), so this is a wiring guard rather than a runtime
				 * case: an optional call here would make a missing prop read as a
				 * refusal that restores the draft (round 1 NIT-3).
				 */
				const runSlashCommand = onSlashCommand;
				if (!runSlashCommand) return;
				if (plan.kind === "list-open") {
					// The roster owns the next Enter — but only while it can give a row.
					// While the list is up with rows in it, nothing is submitted and
					// nothing is rewritten: the TUI's own exception
					// (`editor.py:8219-8222`), the name is picked from the autofill
					// first. Dismissed or empty, the same plan was a DEAD Enter —
					// nothing ran, nothing sent, no note — so say what the key is
					// waiting for (round 1 UX U5).
					if (slash.open && slash.matches.length > 0) return;
					onSlashNote?.(
						`Type a name after /${plan.command.name}, or choose one from the list.`,
					);
					return;
				}
				if (plan.kind === "unrecognised") {
					// Reported through the SAME dispatch that owns the "did you mean"
					// note, then the ORIGINAL draft comes back whole: the misspelling
					// is the thing the user has to fix, so consuming it removes the
					// only copy of it (round 1 UX U8).
					await runSlashCommand(plan.command);
					pendingCaret.current = at;
					setNewMessage(draft);
					setCaret(at);
					return;
				}
				if (plan.kind === "reassemble") {
					// Staged, never submitted: the user reads the assembled line and
					// sends it themselves. The box changing IS the guard against
					// guessing which trailing words are a name — but a user who pressed
					// Enter twice has no other signal that their sentence MOVED and the
					// key did not send, so say it (round 1 UX U7).
					stage(
						plan.text,
						plan.caret,
						/*
						 * The REASSEMBLY's own sentence, from the helper that owns it: the quote's
						 * punctuation is `stagedSentence`'s (QA round 2, Q2-2) and the pane
						 * clause is the dispatcher's own, shared with the arming note — the
						 * clause this line was missing while its sibling already carried it
						 * (review F3). It keeps its own verb because the two answers are to
						 * different gestures: "again" is what tells a user who just pressed
						 * Enter that their sentence moved rather than sent (round 1 UX U7).
						 */
						reassembledNote(plan.text.trim(), paneHasSession),
					);
					return;
				}
				const outcome = await runSlashCommand(plan.command);
				if (outcome === "consumed") {
					const text = plan.kind === "whole" ? "" : plan.text;
					const next = plan.kind === "whole" ? 0 : plan.caret;
					pendingCaret.current = next;
					setNewMessage(text);
					setCaret(next);
					return;
				}
				pendingCaret.current = at;
				setNewMessage(draft);
				setCaret(at);
			},
			[
				onSlashCommand,
				onSlashNote,
				setNewMessage,
				slash.open,
				slash.matches.length,
				stage,
				// The reassembly's note carries the pane's own clause too (review F3):
				// the promise is conditioned on this pane being able to address a
				// session, which the dispatcher answers with the same value.
				paneHasSession,
			],
		);

		const handleSlashPick = useCallback(
			async (row: CompletionRow, disposition: { run: boolean }) => {
				const completion = completionFor(
					newMessage,
					caret,
					row,
					slash.commandNames,
					slash.argumentWords,
					slash.inline?.nameThenMessage ?? false,
				);
				if (!completion) return;
				slash.close();
				/*
				 * ARMED, when the pick named an armed-only command's own row on the key that
				 * ACTS — the one gesture that arms it, and the reason Enter needs no
				 * inference. The pick hoists the command to the front and STAGES the line, so
				 * the box shows exactly what the next Enter will run: the goal set and the
				 * text sent.
				 *
				 * `disposition.run` is the gate, and it is #221's own rule read back: the
				 * keyboard hands it `true` only for an unambiguous ENTER, and a pointer click
				 * passes it directly; Tab — the completion key, which "never runs" — hands it
				 * `false` and therefore never arms. That keeps this row's two meanings exactly
				 * as they read: Tab completes the word, Enter stages the line. (It is also the
				 * gate `tab-no-arm` photographs and the reason this line survived a merge
				 * that rewrote the composer around it.)
				 *
				 * The route is the ROW's (`pickArmsCommand`) and the line is the DRAFT's
				 * (`planSlashArming`), both read off the vocabulary the registry derives,
				 * so no command name and no destination is written into this path.
				 *
				 * `none` means there was nothing to arm — a bare `/goal` pick, where the
				 * completion below is the same write it has always been and the bare form
				 * still opens the goal read on the next Enter.
				 */
				// The `row.kind` test is the same rule `pickArmsCommand` applies, stated
				// here so the destination below is reachable without a cast.
				if (
					row.kind === "command" &&
					disposition.run &&
					pickArmsCommand(row, slash.armedOnlyCommands)
				) {
					const armed = planSlashArming({
						draft: completion.text,
						caret: completion.caret,
						commandNames: slash.commandNames,
						armedOnlyCommands: slash.armedOnlyCommands,
					});
					if (armed.kind === "armed") {
						/*
						 * The RECEIPT, and the one thing it may not guess at: the dispatcher
						 * refuses `/goal` on a pane with no conversation and the staged line goes
						 * with the refusal, so on a draft pane the note says what the pane can
						 * actually do instead of promising the goal will be set (UX U5 / design
						 * D5). `stagedNote` owns the sentence, keyed by the destination the row
						 * carries, so a second armed destination cannot inherit a false one.
						 */
						stage(
							armed.text,
							armed.caret,
							stagedNote(
								armed.text.trim(),
								row.command.destination,
								paneHasSession,
							),
						);
						return;
					}
				}
				/*
				 * THE SECOND ARMING DOOR (§1), and it has to be a SYNC rather than a plain
				 * write. Accepting `/credential` from the list inserts `/credential `, and
				 * that trailing space opens the capture — "the TUI gets this from
				 * `_apply_command`, so a hand-typed space and a picker-accepted space are
				 * one rule". Writing the text alone left the capture idle, so the paste
				 * that follows fell past the armed gate and landed VERBATIM in the
				 * document, the draft, the transcript and the prompt — the exact failure
				 * this feature exists to close, on the one route a user actually
				 * discovers, with nothing on screen to contradict it (code review round
				 * 1, MAJOR 2).
				 *
				 * `"completion"` is the origin that carries the arming power for it, and
				 * the module is where the two are one rule: a completion that is not the
				 * token's trailing space answers `IDLE` (or drops a live arm), a
				 * completion that is opens the span, and `/credential <key>` reached this
				 * way is masked rather than run. The stamp this write leaves is what the
				 * whole-buffer teardown reads: the capture performed this write, so it is
				 * not an arrival and the arm survives it.
				 */
				applyCapture({
					capture: syncCapture(
						captureRef.current,
						completion.text,
						completion.caret,
						"completion",
					),
					buffer: completion.text,
					caret: completion.caret,
				});
				/*
				 * RUN, when the pick named a row that runs and the gate let it through.
				 * The ambiguity gate is applied by `handleSlashKeyDown` for the keyboard
				 * and deliberately waived for a pointer click (`editor.py:8040`);
				 * `runs: false` is honoured here so no `/team` name can ever be run on
				 * the keystroke that chose it.
				 *
				 * The two row kinds answer "does a pick run this?" from different places,
				 * because they are different questions. An ARGUMENT row's own list
				 * declares it (`slash.inline.runs`: `/model` runs its choice, `/team` and
				 * `/theme` never do). A COMMAND row's DESTINATION declares it
				 * (`pointerPickRuns`), which is the rule that lets a click open a panel
				 * instead of only completing the word.
				 *
				 * That destination rule is the ONE predicate both gestures read, and it is
				 * read HERE rather than at either caller so a click and an unambiguous
				 * Enter cannot disagree about whether `/model` runs: the keyboard's own
				 * answer is the ambiguity gate alone, and a destination with an inline
				 * list refuses a run on both paths. It is also why `window.close`,
				 * `transcript.clear` and `session.compact` keep their TWO-Enter path — a
				 * single keystroke never detaches the app or clears the transcript view,
				 * which is the behaviour they already had.
				 */
				const shouldRun =
					disposition.run &&
					(row.kind === "command"
						? pointerPickRuns(
								row.command.destination,
								DESTINATIONS[row.command.destination],
							)
						: (slash.inline?.runs ?? false)) &&
					Boolean(onSlashCommand);
				if (!shouldRun) return;
				// Run through the SAME plan a submit takes, so a command picked
				// mid-draft splices out and leaves the prose, and a whole-draft
				// command reports its outcome exactly as typing it would.
				/*
				 * The PICK's gesture, stated: the row was chosen out of the popup, so the
				 * word is a command wherever it sits. Without this a click on `/loop` in
				 * the middle of a sentence completed the word and then did nothing —
				 * the planner read the draft as prose — while the footer promised the
				 * line would be staged (`Click stages /loop.`).
				 */
				const plan = planFor(completion.text, completion.caret, "pick");
				if (plan.kind === "send") return;
				await applyPlan(plan, newMessage, caret);
			},
			[
				newMessage,
				caret,
				slash,
				applyCapture,
				onSlashCommand,
				planFor,
				applyPlan,
				stage,
				// The staged note's promise is conditioned on whether this pane can run
				// anything yet (UX U5), so the callback reads the dispatcher's own answer
				// with the rest.
				paneHasSession,
			],
		);
		/*
		 * The AMBIGUOUS Enter's half of the pick path: grow the typed command word
		 * to the matches' common prefix and leave the popup open.
		 *
		 * A second entry point rather than a flag on `handleSlashPick`, because the
		 * two are genuinely different gestures: a pick APPLIES a row, closes the
		 * list and may run a command, while this one writes part of the word, keeps
		 * the list up and never acts on a row. Sharing one callback would mean a
		 * disposition that means "do not act" (`_extend_to_common_prefix`,
		 * `editor.py:8326-8345`).
		 *
		 * The caret is placed at the new END OF THE WORD rather than at the end of
		 * the draft, so a user narrowing a command in front of a written message
		 * keeps typing where they were.
		 */
		const handleSlashExtend = useCallback(
			(prefix: string) => {
				const extension = extensionFor(
					newMessage,
					caret,
					prefix,
					slash.commandNames,
				);
				if (!extension) return;
				pendingCaret.current = extension.caret;
				setNewMessage(extension.text);
				setCaret(extension.caret);
			},
			[newMessage, caret, slash.commandNames, setNewMessage],
		);
		// biome-ignore lint/correctness/useExhaustiveDependencies: `textareaRef.current` is read at event time, not at render time - the caret position only has meaning for the keypress being handled, so listing the ref's current value as a dependency would rebuild this handler on every caret move while still reading the same live node.
		const handleComposerKeyDown = useCallback(
			(event: KeyboardEvent<HTMLTextAreaElement>) => {
				/*
				 * A LIVE CAPTURE OWNS THE KEYS FIRST (§3), ahead of the slash handler and
				 * ahead of the submit: while the mask is up the safe default is that no
				 * other handler sees the key at all. The TUI routes it the same way.
				 */
				if (handleCredentialKeyDown(event)) {
					event.preventDefault();
					return;
				}
				if (
					handleSlashKeyDown(event, slash, handleSlashPick, handleSlashExtend)
				) {
					event.preventDefault();
					return;
				}
				// Forward Tab leaves the conversation for the sidebar; while a
				// question is waiting and the user is DONE with the box, the option
				// group is the thing they were just shown and is one press away in
				// this direction. The rule for "done with the box" is
				// `shouldTabIntoAnswerOptions` — unmodified Tab, content in the
				// composer, caret at the end, a live option to land on. Every other
				// Tab, and every Tab with an empty box or a caret mid-draft, keeps
				// its native meaning (UX round 2, U7; code review round 2, F2).
				const textarea = textareaRef.current;
				const target = firstLiveAnswerOption();
				if (
					target &&
					shouldTabIntoAnswerOptions(
						event,
						{
							value: newMessage,
							selectionStart: textarea?.selectionStart ?? null,
							selectionEnd: textarea?.selectionEnd ?? null,
						},
						true,
					)
				) {
					target.focus();
					event.preventDefault();
					return;
				}
				/*
				 * Enter is the submit key, and the planner is the only thing that decides
				 * what this draft submits: a command typed into a sentence is spliced out
				 * and run, a whole-draft command is run here too, and a free-text command
				 * is reassembled and STAGED. Only `send` falls through to the message
				 * path, which is the ONE answer that means "this is prose" — so a command
				 * can never be quietly turned back into prose by a later re-read of the
				 * text, and a draft the planner called prose can never be claimed by a
				 * command (QA round 2, Q4).
				 *
				 * Prose is also what an ARMED-ONLY command's word makes this draft, which
				 * is why `/goal` in a sentence falls through here instead of being moved
				 * to the front: that arming is the popup PICK's gesture, and only a pick
				 * produces the staged line that arms it.
				 */
				if (
					event.key === "Enter" &&
					!event.shiftKey &&
					!event.nativeEvent.isComposing
				) {
					const plan = planForDraft(newMessage, caret);
					if (plan.kind !== "send") {
						event.preventDefault();
						void applyPlan(plan, newMessage, caret);
						return;
					}
				}
				handleKeyDown(event);
			},
			[
				slash,
				handleSlashPick,
				handleSlashExtend,
				handleKeyDown,
				handleCredentialKeyDown,
				planForDraft,
				applyPlan,
				newMessage,
				caret,
			],
		);

		/*
		 * The chip's own ref, so the composer can be asked to open it.
		 *
		 * A bare `/move` focuses this chip and opens its menu instead of mounting a
		 * dialog that hosted a copy of it (design § 5.2, settled by the measured menu
		 * clipping inside the dialog): one control, one write path. The composer is the
		 * owner of the chip, so the request travels through its handle rather than
		 * through a store or an event, which keeps the "only one chip" rule true by
		 * construction.
		 */
		const cwdChipRef = useRef<DirectoryIndicatorHandle>(null);

		/*
		 * The one place focus is given to this box, and the reason it is one place:
		 * handing focus over is the moment the box becomes ours again, so a pointer
		 * interaction from BEFORE the call stops counting as the user's and the ask
		 * gate may hand focus here again. Both the imperative handle and the
		 * handler registry below (see `composer-field.ts`) publish THIS function
		 * rather than a copy, so a new call site cannot forget the reset.
		 */
		const focusInput = useCallback(() => {
			composerPointerTouched = false;
			textareaRef.current?.focus();
		}, [textareaRef]);

		useImperativeHandle(ref, () => ({
			focusInput,
			openWorkingDirectoryMenu: () => {
				cwdChipRef.current?.openMenu();
			},
		}));

		/*
		 * The composer's focus hand-off, published to the surfaces that are not
		 * handed this component's handle - today the transcript's Quote toolkit,
		 * which stages a quote and then wants the caret in the box (design round 1,
		 * D2; UX round 1, U1). Registered here rather than rebuilt there so that
		 * `focusInput` stays the single place focus is given, flag reset included;
		 * see `composer-field.ts`.
		 */
		useEffect(() => registerComposerFocus(focusInput), [focusInput]);

		/*
		 * Two reasons a composer refuses input, kept apart (design review round
		 * 1, D3). `unavailable` is a conversation this machine does not have, and
		 * the two used to share one placeholder, so the composer's only text read
		 * "Agent is busy" over a session that does not exist - a false statement
		 * about the state, in the one place the user is looking to find out what
		 * to do about it. They still share the disabled BEHAVIOUR (typing into a
		 * conversation that is gone is not a thing that can work); only the
		 * sentence differs.
		 */
		const isBusy = Boolean(isLoading && currentJobId);
		const isInputDisabled = unavailable || isBusy;

		/*
		 * Whether the suggestion chips are inert.
		 *
		 * The draft case is not the composer being disabled - the box is very much
		 * live - it is that a suggestion press REPLACES what the box holds, so while
		 * the user is mid-draft the chips are disabled rather than the press being
		 * allowed to clobber a sentence they are writing (round 1, U2). DISABLED, not
		 * hidden: the band must not move while they type, and a chip vanishing under
		 * a keystroke is a reflow they watch. The styling is the app's existing
		 * disabled contract, which is a colour change and never opacity - the
		 * disabled ink role, as `variant="ghost"` already carries.
		 *
		 * Defined here rather than beside the sample because it reads the box's
		 * CURRENT text, which `useMessageInput` owns further down.
		 */
		const suggestionsDisabled =
			isInputDisabled ||
			isRecording ||
			isTranscribing ||
			newMessage.trim().length > 0;

		/*
		 * Grow with the draft up to `max-h`, then scroll. Runs on every value
		 * change — typed, transcribed, or restored from the draft store —
		 * because a native textarea does not grow on its own.
		 *
		 * `newMessage`, `isRecording` and `isTranscribing` are triggers, not
		 * reads: the body only touches the ref, so the linter sees them as
		 * surplus. They are what tell the textarea to re-measure, and removing
		 * them leaves it stuck at its previous height after a transcription
		 * lands or a draft is restored.
		 */
		// biome-ignore lint/correctness/useExhaustiveDependencies: deps are re-measure triggers, not values read in the body
		useEffect(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.style.height = "auto";
			el.style.height = `${el.scrollHeight}px`;
		}, [newMessage, textareaRef, isRecording, isTranscribing]);

		useEffect(() => {
			if (!isInputDisabled && !isRecording && !isTranscribing) {
				const activeElement = document.activeElement;
				const isInputFocused =
					activeElement &&
					(activeElement.tagName === "INPUT" ||
						activeElement.tagName === "TEXTAREA");
				if (!isInputFocused) {
					textareaRef.current?.focus();
				}
			}
		}, [isInputDisabled, isRecording, isTranscribing, textareaRef]);

		useEffect(() => {
			window.electron.ipcRenderer
				.invoke("get-platform-info")
				.then((info) => {
					setPlatform(info.platform);
				})
				.catch((err) => {
					console.error("Failed to get platform info:", err);
				});
		}, []);

		const handleStartRecording = useCallback(async () => {
			if (!canEnableRecordingFeature) return;
			if (navigator?.mediaDevices?.getUserMedia) {
				try {
					const stream = await navigator.mediaDevices.getUserMedia({
						audio: true,
					});
					mediaRecorderRef.current = new MediaRecorder(stream);
					audioChunksRef.current = [];

					mediaRecorderRef.current.ondataavailable = (event) => {
						audioChunksRef.current.push(event.data);
					};

					mediaRecorderRef.current.onstop = () => {
						const completeAudioBlob = new Blob(audioChunksRef.current, {
							type: "audio/webm",
						});
						setAudioBlob(completeAudioBlob);
						// Stop all tracks on the stream to release the microphone
						for (const track of stream.getTracks()) {
							track.stop();
						}
					};

					mediaRecorderRef.current.start();
					setIsRecording(true);
					setAudioBlob(null); // Clear previous blob
				} catch (err) {
					console.error("Error accessing microphone:", err);
					showErrorToast(
						"Error accessing microphone. Please ensure microphone permissions are granted.",
					);
				}
			} else {
				console.error("This runtime exposes no MediaRecorder");
				/* Not "your browser": this is a desktop app, and the person reading
				   this did not choose a browser and cannot change it. */
				showErrorToast("Dictation is not available on this device.");
			}
		}, [canEnableRecordingFeature]);

		const handleConfirmRecording = useCallback(() => {
			if (mediaRecorderRef.current && isRecording) {
				mediaRecorderRef.current.stop();
				setIsRecording(false);
			}
		}, [isRecording]);

		const handleCancelRecording = useCallback(() => {
			if (mediaRecorderRef.current && isRecording) {
				// Redefine onstop to just stop the tracks and clean up, without processing audio
				mediaRecorderRef.current.onstop = () => {
					if (mediaRecorderRef.current?.stream) {
						for (const track of mediaRecorderRef.current.stream.getTracks()) {
							track.stop();
						}
					}
					setAudioBlob(null);
					audioChunksRef.current = [];
				};
				mediaRecorderRef.current.stop();
				setIsRecording(false);
			}
		}, [isRecording]);

		useEffect(() => {
			if (isRecording) {
				const handleKeyDown = (event: globalThis.KeyboardEvent) => {
					if (event.key === "Enter") {
						event.preventDefault();
						handleConfirmRecording();
					} else if (event.key === "Escape") {
						event.preventDefault();
						handleCancelRecording();
					}
				};

				const handleKeyUp = (event: globalThis.KeyboardEvent) => {
					if (event.code === "Space") {
						event.preventDefault();
						handleConfirmRecording();
					}
				};

				window.addEventListener("keydown", handleKeyDown);
				window.addEventListener("keyup", handleKeyUp);

				return () => {
					window.removeEventListener("keydown", handleKeyDown);
					window.removeEventListener("keyup", handleKeyUp);
				};
			}

			return undefined;
		}, [isRecording, handleConfirmRecording, handleCancelRecording]);

		const handleSendAudio = useCallback(async () => {
			if (!audioBlob) return;

			try {
				setIsTranscribing(true);
				const response = await TranscriptionApi.createTranscription(
					apiConfig.baseUrl,
					{
						file: new File([audioBlob], "recording.webm", {
							type: "audio/webm",
						}),
					},
				);
				if (response.result?.text) {
					const newText = response.result?.text || "";
					setNewMessage(newMessage + newText);
				}
				setAudioBlob(null); // Clear the blob after sending
			} catch (error) {
				console.error("Error transcribing audio:", error);
				showErrorToast("Error transcribing audio. Please try again.");
			} finally {
				setIsTranscribing(false);
			}
		}, [audioBlob, setNewMessage, newMessage]);

		// Automatically send audio for transcription when audioBlob is set
		useEffect(() => {
			if (audioBlob) {
				handleSendAudio();
			}
		}, [audioBlob, handleSendAudio]);

		// Register with speech-to-text manager
		useSpeechToTextManager(
			"message-input",
			SpeechToTextPriority.MESSAGE_INPUT,
			handleStartRecording,
			() =>
				Boolean(
					!isLoading &&
						!isRecording &&
						!isTranscribing &&
						canEnableRecordingFeature,
				),
		);

		const handleSubmit = (e: FormEvent) => {
			e.preventDefault();
			if (!newMessage.trim() && attachments.length === 0) return;
			/*
			 * THE CAPTURE IS ASKED FIRST, exactly as the key handler asks it, so the
			 * button and the key cannot disagree about an open masked span (design
			 * round 1, D1; QA round 1, Q4). `submitCapture` mints a non-empty span
			 * and returns `true`; it returns `false` for an empty one, which then
			 * takes the planner below to the picker — the same two outcomes Enter
			 * has, by construction, because it is the same function.
			 */
			if (submitCapture()) return;
			/*
			 * The SAME planner the Enter key consults, so the Send button and the
			 * key cannot disagree about whether a draft is a command — and every
			 * non-`send` verdict is applied here, so the message path below is only
			 * ever reached for prose. It does not re-examine the text: that is what
			 * turned `/usage` on line 1 into a command that claimed line 2.
			 */
			const plan = planForDraft(newMessage, caret);
			if (plan.kind !== "send") {
				void applyPlan(plan, newMessage, caret);
				return;
			}
			submitMessage();
		};

		const handleRemoveAttachment = (id: string) => {
			if (conversationId) {
				removeAttachment(conversationId, id);
			}
		};

		const handleAttachFile = async () => {
			const result = await window.electron.ipcRenderer.invoke(
				"show-open-dialog",
				{
					properties: ["openFile", "multiSelections"],
				},
			);

			if (!result.canceled && result.filePaths.length > 0) {
				if (conversationId) {
					for (const path of result.filePaths) {
						addAttachment(conversationId, {
							id: uuidv4(),
							path: normalizePath(path),
						});
					}
				}
			}
		};

		const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
			/*
			 * THE CREDENTIAL GATE IS THE FIRST BRANCH, ahead of every size and
			 * whitespace rule (`Editor._on_paste`). It is a MODE question — did the
			 * operator just type `/credential` here — and not a question about the
			 * payload: a one-line API key is nowhere near the thresholds an ordinary
			 * paste branch asks, so asking them first would insert the secret
			 * verbatim and the redaction would never happen at all.
			 */
			const pasted = event.clipboardData?.getData("text/plain") ?? "";
			if (pasted && captureRef.current.arm !== null) {
				const field = event.currentTarget;
				const captured = capturePasted({
					capture: captureRef.current,
					buffer: newMessage,
					caret: field.selectionEnd ?? newMessage.length,
					selection: {
						start: field.selectionStart ?? newMessage.length,
						end: field.selectionEnd ?? newMessage.length,
					},
					pasted,
					index: nextIndexRef.current,
					taken: takenCredentialNames(),
				});
				if (captured) {
					// ONE EDIT, and the browser's own paste does not also happen: the
					// capture is instant, never masked character by character, and a
					// secret must not exist in the document for even one frame.
					event.preventDefault();
					applyCapture(captured);
					setDisclosure(null);
					return;
				}
			}
			const items = event.clipboardData?.items;
			if (items) {
				for (let i = 0; i < items.length; i++) {
					if (
						items[i].type.indexOf("image") !== -1 ||
						items[i].kind === "file"
					) {
						const file = items[i].getAsFile();
						if (file) {
							const reader = new FileReader();
							reader.onload = (e) => {
								if (e.target?.result && conversationId) {
									addAttachment(conversationId, {
										id: uuidv4(),
										path: e.target.result as string,
									});
								}
							};
							reader.readAsDataURL(file);
						}
					}
				}
			}
		};

		/*
		 * A suggestion FILLS the composer; it does not send.
		 *
		 * WHAT CHANGED UNDER THIS HANDLER. It is byte-identical on `main`, where the
		 * pool was a toy assistant's errands (trending stocks, MNIST, space invaders)
		 * and one press spending a demo request on tokens was cheap. This change
		 * replaced that pool with imperative asks that carry real side effects on the
		 * user's machine - set up the mobile relay and tunnel, review the repo and
		 * open a pull request, create a team - so the cost of a single click moved
		 * with the copy without the interaction being revisited. The app's own
		 * convention on this same surface is the opposite one: the slash picker under
		 * the same composer COMPLETES rather than runs ("Enter completes the command.
		 * Click completes /approvals."). The composer's own Send therefore stays the
		 * single place a message leaves, and `onSendMessage` is no longer reachable
		 * from the band at all.
		 *
		 * It also closes the draft loss at its source. The old handler cleared the box
		 * AND the persisted per-conversation draft (`setNewMessage("")`), so a stray
		 * press while the user was writing erased their sentence with no undo
		 * (round 1, U2). Filling would still REPLACE such a draft, which is why the
		 * chips are disabled outright while the box holds one - see
		 * `suggestionsDisabled` above.
		 */
		const handleSuggestionClick = (suggestion: string) => {
			if (isInputDisabled) return;
			/*
			 * THE FILL TAKES THE TYPED PATH, in the textarea's own order, because a
			 * filled label has to behave exactly like the same sentence typed by hand
			 * and a separate shortcut here would be a second path that can drift from
			 * that one (review round 2, M3). Each step is the typed path's own:
			 *
			 * - `setNewMessage` IS `useMessageInput`'s `handleChange` (the hook returns
			 *   it under the `setInputValue` key), which is the one steady-state writer
			 *   of the persisted per-conversation draft. So a filled label reaches the
			 *   draft store and survives a composer remount on the same terms a
			 *   keystroke does; `scripts/suggestion-stack-react.test.mjs` runs it.
			 * - `onComposerInput?.()` is the empty -> non-empty edge the textarea's own
			 *   `onChange` fires (see its comment), and a chip press into an empty box is
			 *   that same edge - `suggestionsDisabled` guarantees the box is empty here.
			 *   Without it the press would skip the speculative session warm, so the send
			 *   that follows would pay the cold runtime spawn a typed sentence does not.
			 * - `pendingCaret`/`setCaret` is this file's convention for a programmatic
			 *   edit (`applyPlan` above): the value and the selection are written
			 *   together, so the caret is not left to whatever the browser does when the
			 *   DOM value is replaced. It lands at the END of the label, which is the
			 *   position "now edit what you just chose" means.
			 */
			if (!newMessage) onComposerInput?.();
			pendingCaret.current = suggestion.length;
			setNewMessage(suggestion);
			setCaret(suggestion.length);
			/*
			 * The press lands on the chip, so the chip holds focus. Handing it back to
			 * the box is what makes the interaction "complete this, then edit it"
			 * rather than "complete this, then hunt for where to type": the caret is in
			 * the sentence the user just chose, which is the same place the slash
			 * picker's completion leaves them.
			 */
			textareaRef.current?.focus();
		};

		/*
		 * WHAT THE COMPOSER SAYS ABOUT THE CAPTURE (§10: each state visible AND
		 * explained).
		 *
		 * The TUI's own two sentences, verbatim, plus the unredact warning:
		 *
		 * - TYPING is the state where the operator most needs words, because their
		 *   keystrokes are producing bullets instead of characters — alarming rather
		 *   than reassuring unless something says it is deliberate AND how it ends,
		 *   so the sentence names the mask and both keys. An EMPTY span is the same
		 *   state with the other Enter outcome, so it gets its own sentence rather
		 *   than the pill promise (UX round 2, U10 — see the constants);
		 * - ARMED is shown only while the token is still the caret's own tail, which
		 *   is exactly when a space would open the span. The TUI shows its armed
		 *   notice in the picker's row, which only exists during the argument phase
		 *   and so can never paint next to the token; a composer has no such row, and
		 *   a notice that stayed up after the operator typed four more words would be
		 *   describing a mode that is no longer one keystroke away;
		 * - UNREDACTED outranks ARMED and TYPING cannot coexist with it. It reports a
		 *   state the operator did not ask to be in (they asked to cancel) and the one
		 *   where the next Enter discloses a secret, so it is the warning tone rather
		 *   than muted ink — the same reason the TUI posts it as a warning. The
		 *   sentence is built from the count here rather than stored, so the notice a
		 *   RESTORE raises and the notice the cancel raised are the same words from the
		 *   same authority (design round 2, D2).
		 */
		const credentialNotice = isTyping(capture)
			? capture.value !== ""
				? CREDENTIAL_TYPING_NOTICE
				: credentialSessionId
					? CREDENTIAL_EMPTY_SPAN_NOTICE
					: CREDENTIAL_EMPTY_SPAN_DRAFT_NOTICE
			: unredactedChars !== null
				? unredactedNotice(unredactedChars)
				: capture.arm !== null &&
						// Measured at the END OF THE BUFFER rather than at the `caret` state,
						// and the difference is a race rather than a nicety: `caret` lags one
						// commit behind the keystroke that moved it, so a derivation that read it
						// here would flicker the armed notice on and off between renders — and in
						// the evidence play functions it did, producing a frame with the notice in
						// one theme and not in the next. The line's tail is the true subject of the
						// predicate (`CREDENTIAL_ARM` is anchored to the caret's own line end), and
						// the end of the buffer is that same tail in every state the operator can
						// be typing in.
						armSpan(newMessage, newMessage.length) !== null
					? CREDENTIAL_ARMED_NOTICE
					: null;

		const shortcutText = useMemo(() => {
			if (platform === "darwin") {
				return "Cmd+Shift+S";
			}
			return "Ctrl+Shift+S";
		}, [platform]);

		/*
		 * WHERE FOCUS GOES WHEN A STAGED QUOTE IS REMOVED (UX round 1, U2).
		 *
		 * `removeReply` unmounts the chip whose own remove control held focus, and the
		 * browser then drops focus to `document.body` - no ring anywhere on the page,
		 * measured after both a pointer press and a keyboard Enter. The reader's next
		 * act is either removing the next quote or writing, so focus goes to the chip
		 * that takes the removed one's place (the list closes upward, so that is the
		 * next chip, or the last one when the removed chip was last) and to the
		 * composer once nothing is staged.
		 *
		 * The index is recorded HERE and the focus applied in an effect below, because
		 * the button that should take focus does not exist until the store change has
		 * rendered: `removeReply` is synchronous and the DOM is not. Reaching for the
		 * next chip by index is what makes repeated removals one Tab apart, which is
		 * the thing the reader is doing when they hit this.
		 */
		const pendingChipFocus = useRef<number | null>(null);

		const handleRemoveReply = (replyId: string) => {
			if (!conversationId) return;
			pendingChipFocus.current = replies.findIndex(
				(reply) => reply.id === replyId,
			);
			removeReply(conversationId, replyId);
		};

		// biome-ignore lint/correctness/useExhaustiveDependencies: `replies` is the TRIGGER, not a value the body reads - the effect runs once per list change and reads the index the removal recorded, so listing the chips themselves would only re-run it against an already-cleared intent.
		useEffect(() => {
			const at = pendingChipFocus.current;
			if (at === null) return;
			pendingChipFocus.current = null;
			const chips = document.querySelectorAll<HTMLElement>(
				REPLY_CHIP_REMOVE_SELECTOR,
			);
			const next = chips[Math.min(at, chips.length - 1)];
			if (next) next.focus();
			else focusInput();
		}, [replies, focusInput]);

		/*
		 * What the alert should actually say and offer, given what is in the box.
		 *
		 * The page knows WHY the send failed and what payload the store is
		 * holding; only the composer knows the live textarea value, and every
		 * decision here turns on comparing the two. Deriving it in one place
		 * keeps the render branches from disagreeing about which of the two
		 * abandon behaviours is on offer - the case where they could is exactly
		 * the one that silently destroyed a user's typed message.
		 */
		const composerAlert = useMemo(() => {
			const held = sendError?.heldText;
			// The SAME string the guard compares. `buildSendPayload` is what turns a
			// composer value into a payload, so building the live box through it -
			// attached replies and all - asks exactly the question the store will
			// answer on the next send: would this be accepted as an unchanged retry?
			// Comparing anything else - the raw value, a `.trim()` applied only on
			// this side, or the bare box while a reply prefix is added downstream -
			// puts a class of edit in a gap where the guard refuses a send the copy
			// claims will work, and suppresses both escapes while it does so.
			const boxPayload = buildSendPayload(newMessage, replies);
			const heldInBox = held !== undefined && held === boxPayload;
			// Whether the box holds anything the user would lose. `boxPayload` and
			// not `newMessage.trim()` for the same reason: one definition of "empty".
			const boxEmpty = boxPayload === "";
			return {
				message: sendError?.message,
				/*
				 * "Send it again" is only true when the next send would be ACCEPTED.
				 *
				 * With a claim held and something else in the box, the store refuses
				 * on payload mismatch - so the sentence would be instructing the user
				 * into the very guard that is blocking them. It is also false with an
				 * empty box, where there is nothing left to send.
				 *
				 * `withholdRetryHint` is the same rule stated by the failure that owns
				 * it: the read window's refusal is refused AGAIN for as long as its
				 * own notice is on screen, so its sender withholds this hint and the
				 * sentence carries the wait instead (UX round 3, U9).
				 *
				 * `newMessage.trim()`, deliberately NOT `!boxEmpty`: this sentence
				 * promises Enter will send, and the submit path guards on the raw
				 * textarea (`use-message-input.ts`), which refuses a chip-only
				 * composer. `boxPayload` counts reply chips, so gating here on it
				 * rendered "Send it again" over a chip-only box while Enter was dead.
				 * The two predicates answer different questions and each must use the
				 * basis of its own consumer: `boxEmpty` - would a discard lose
				 * something visible; this - would the send Enter triggers run at all.
				 */
				retryHint:
					Boolean(sendError?.message) &&
					!sendError?.withholdRetryHint &&
					Boolean(newMessage.trim()) &&
					(held === undefined || heldInBox),
				// Only worth saying when the held message is not on screen; when it
				// is, the user can see it and Enter retries it.
				showHeld: held !== undefined && !heldInBox,
				actions: sendError?.actions ?? [],
				// Offered only when the box does not already hold the payload -
				// restoring what is already there does nothing.
				restore: held !== undefined && !heldInBox ? held : undefined,
				abandon: !sendError?.onDiscard
					? undefined
					: // Empty box or the held text itself: nothing of the user's is at
						// risk, so drop the whole draft. Anything else is a message they
						// have typed and not sent, and discarding it under a label naming
						// a DIFFERENT message is a destructive surprise - release just the
						// claim instead, when there is one to release.
						heldInBox || boxEmpty
						? ("discard" as const)
						: sendError?.onReleaseHeld
							? ("release" as const)
							: /*
								 * No claim and different text in the box: offer nothing.
								 *
								 * This is the create-failure branch - `submittedText` is set
								 * but no admission was ever issued, so `heldText` and with it
								 * `onReleaseHeld` are undefined. Nothing is being ENFORCED
								 * here: no guard refuses the next send, so an abandon control
								 * has no claim to release and its only remaining effect is to
								 * empty a composer under a label naming a message the user
								 * cannot see. Suppressing it costs them nothing; the alert
								 * still dismisses on the next keystroke.
								 */
								undefined,
				// Whether discarding would empty a composer the user can see text in.
				// The label has to name the cost: "Discard unsent message" over an
				// empty box drops an invisible claim and costs nothing, but the same
				// words over a full box destroy what is in it, and with `heldInBox`
				// true those are the SAME words for two different outcomes.
				discardClearsBox: !boxEmpty,
			};
		}, [sendError, newMessage, replies]);

		/*
		 * No `iconSize` here. Every glyph below sits inside a `Button`, and the
		 * button variants carry `[&_svg]:size-4` / `size-3.5`, which override an
		 * SVG's own width and height - so a `size` prop on these icons states an
		 * intent it cannot deliver and reads as the rendered value to anyone who
		 * greps for it. It cost two rounds of review on a Storybook stand-in that
		 * copied these numbers faithfully and drew a composer the app does not
		 * draw. The variant owns the size; the call sites no longer claim to.
		 */

		/*
		 * THE SENTENCE'S LINE, one class list with two consumers.
		 *
		 * The sentence above the composer box and the MIRROR of it below the
		 * composer's group (rendered on the centring band only; see the mirror's own
		 * comment in `inputContent`) have to measure the SAME height, because the
		 * whole device is that the group grows by one line on each side of the box and
		 * therefore recentres without moving it. Two copies of this list would be two
		 * definitions of that height, and the first edit to either - a padding step, a
		 * type step - would quietly rebuild the bounce the mirror removes.
		 */
		const credentialNoticeLine = cn(
			"block text-body-sm",
			// The same padding step the interrupt notice beside the composer uses, so
			// the two sentences share one text edge with the box's own contents.
			isSmallView ? "px-2 pb-1" : "px-4 pb-2",
			// The unredact is the one state where the next Enter discloses a
			// secret, so it takes the warning role rather than muted ink.
			unredactedChars !== null ? "text-warning" : "text-ink-muted",
		);

		const inputContent = (
			<form onSubmit={handleSubmit} className="w-full">
				{/*
				 * The session's status row, ABOVE the alert and therefore above the box:
				 * `docs/composer-status-tabs.md` § 2.1. The alert is a transient failure
				 * that points at the composer; this row is persistent ambient context, so
				 * it sits outboard of the transient one. Band order, top to bottom: row,
				 * alert, the interrupt notice, box - the fourth block is a transient too and
				 * therefore sits inboard of the row as well; see its own comment for why it
				 * is the alert's sibling rather than its child.
				 *
				 * KEYED ON THE CONVERSATION, and that is a requirement rather than
				 * tidiness: the composer is not remounted on a session switch, so a goal
				 * expanded in one conversation would arrive expanded in the next. The
				 * goal's expansion is deliberately not persisted (spec § 3.3), and this
				 * key is the whole reset mechanism.
				 *
				 * It returns null when the session has neither a goal nor a plan, so a
				 * legacy pane and a fresh draft reserve no height at all. It renders inside
				 * an error boundary with an empty fallback for the readings' own reason: a
				 * crash in metadata must not cost the ability to type.
				 */}
				<ErrorBoundary fallback={null}>
					<ComposerStatusRow
						key={conversationId}
						frontend={sessionStatus?.frontend}
						runDetails={runDetails}
						isSmallView={isSmallView}
						/*
						 * The row's last activity chip unmounts when its work settles. If
						 * that chip held focus the browser drops it to `<body>`, so the row
						 * hands it back HERE rather than finding the box itself: this is
						 * where the composer's own ref lives, and `textareaRef` is the same
						 * node the field renders (`UX round 1, U1`).
						 */
						onFocusComposer={() => textareaRef.current?.focus()}
					/>
				</ErrorBoundary>
				{(abandonNotice ||
					refusedNotice ||
					(!sendError && heldNotice) ||
					(sendError && (composerAlert.message || composerAlert.showHeld))) && (
					/*
					 * Above the box rather than inside it: the composer box is one
					 * control with one focus ring (`COMPOSER_BOX`), and folding an alert
					 * into it would put non-interactive prose and two extra buttons
					 * inside the thing that ring frames. Sharing `CHAT_MEASURE` — the same
					 * container-keyed track `COMPOSER_BOX` resolves — keeps the two
					 * edge-aligned at every width. Viewport-keyed classes that merely
					 * look equivalent drift from the container-keyed box in the
					 * 640–768px window band, and an alert half a box-width off reads as
					 * unrelated chrome rather than as this composer's own failure.
					 * That is what makes the two read as one unit.
					 *
					 * `role="alert"` and not `aria-live="polite"`: a send that did not
					 * land is the assertive case. The user has just pressed Enter and
					 * their next action depends on knowing it failed.
					 *
					 * Horizontal padding matches `COMPOSER_BOX`'s (`p-4` / `p-2`), not a
					 * smaller inset of its own: the two are read as one unit, and at
					 * `px-1` the error's first character sat 13px left of the message
					 * text it points at, giving a ragged edge between two lines that
					 * are meant to share a column.
					 *
					 * `max-h` with `overflow-y-auto` is a layout guard, not styling. The
					 * footer reserves whatever this renders, so an unbounded alert over
					 * a long retained draft pushed the composer - and the send button -
					 * below the viewport in a narrow column, leaving no way to send at
					 * all. Capped, the overflow scrolls inside the alert instead.
					 */
					<div
						role="alert"
						className={cn(
							CHAT_MEASURE,
							"flex flex-col gap-1 text-body-sm text-danger",
							/*
							 * The composer's whole-line cap, shared with the status row's goal body.
							 * Both blocks grow and then cap themselves, and both used `max-h-32`, which
							 * at the composer's own leading lands 8px into a seventh line - letter tops
							 * under a complete line, which reads as a rendering accident (design review
							 * round 1, D2). One device, decided once, in `chat-measure.ts`.
							 */
							CAPPED_BLOCK,
							isSmallView ? "px-2 pb-1" : "px-4 pb-2",
						)}
					>
						{abandonNotice && (
							// Rendered in the same region rather than replacing it, so the
							// escape is CONFIRMED where the problem was reported. Muted ink
							// and no icon: this is the resolved state, not a failure.
							<p className="text-ink-muted">{abandonNotice}</p>
						)}
						{!abandonNotice && composerAlert.message && (
							/*
							 * Icon and weight, not colour, are what rank this line.
							 *
							 * The alert carried no glyph and `font-weight: 400`, so hue was
							 * its ONLY signal - and `danger` is the highest-contrast ink in
							 * none of the twelve palettes, because the ink ramps order by
							 * design intent and `danger` is a hue role rather than a
							 * loudness rank. So any "danger must out-contrast its siblings"
							 * rule loses in some palette by construction: the 13px accent
							 * Restore control measured above the error in 9 of 12, worse
							 * than the inversion the previous round fixed on the abandon
							 * link. Colour alone was also the whole signal, which is a
							 * 1.4.1 problem independent of the ranking.
							 *
							 * `CircleAlert` at 14px in a `shrink-0` span, matching
							 * `message-item/invalid-attachment.tsx`, plus `font-medium`:
							 * two channels no palette can invert - the icon marks which
							 * line is the failure, and weight carries salience where the
							 * ratio contest cannot be won. `items-start` so the glyph sits
							 * on the first line of prose that wraps.
							 */
							<p className="flex items-start gap-1.5 font-medium">
								<span className="flex shrink-0 items-center pt-0.5">
									<CircleAlert size={14} aria-hidden="true" />
								</span>
								<span>
									{composerAlert.message}
									{/*
									 * The "what to do" half of the error contract (branding
									 * section 8), and it is only ever rendered where it is TRUE.
									 * It used to be appended unconditionally, including onto the
									 * unchanged-send guard - whose whole point is that an edited
									 * resend is refused - so the alert told the user to edit and
									 * send, then refused exactly that, forever. It now appears
									 * only when the box holds something the store will accept;
									 * the guard case gets controls instead.
									 */}
									{composerAlert.retryHint &&
										" Your message is still in the composer. Send it again."}
								</span>
							</p>
						)}
						{!abandonNotice && composerAlert.showHeld && (
							/*
							 * The held claim, stated because it is being ENFORCED.
							 *
							 * `admissionAttempted` makes the store refuse any send whose
							 * payload differs, and clearing the textarea does not drop it -
							 * deliberately, since a keystroke says nothing about a request
							 * that may be executing on the owner. Left unsaid, that produced
							 * the worst failure in the flow: the user select-all-deleted,
							 * saw nothing retained, typed something else, and was refused by
							 * a healthy backend with no link back to what they did.
							 *
							 * Rendered only when the box does NOT already hold the payload.
							 * When it does, the message is on screen and Enter retries it -
							 * saying so would be noise on the common path.
							 *
							 * The second half of the sentence states the UNCERTAINTY, which the
							 * failure copy does not: that copy is the backend's own refusal string
							 * (or the generic fallback) and reads as "nothing happened", while the
							 * branch's design keeps the echo painted precisely because the outcome
							 * is unknowable (design round 1's D1, UX round 1's U5). One register
							 * says "this failed", the other shows the message still in the
							 * transcript, so the held claim is the only place that can name the
							 * third possibility - and it has to name the retry too, or the two
							 * copies read as a duplicate rather than as one message with a
							 * remedy.
							 */
							<p className={cn("text-ink-muted")}>
								{heldCopyOnScreen === true
									? "An unsent message is still being held, so a different message cannot be sent yet. Whether it reached the agent is not knowable - its copy is in the transcript above - so restore it and send again only if no reply arrives."
									: "An unsent message is still being held, so a different message cannot be sent yet. Whether it reached the agent is not knowable, so restore it and send again only if no reply arrives."}
							</p>
						)}
						{!abandonNotice &&
							(composerAlert.actions.length > 0 ||
								composerAlert.restore ||
								composerAlert.abandon) && (
								/*
								 * `min-h-6` on the row, not on the buttons: the targets are 20px
								 * of text and sit directly above a 44px send button, which read
								 * as less important than they are. The row grows the hit area to
								 * the 24px comfortable minimum without changing the type size.
								 */
								<div
									className={cn("flex min-h-6 flex-wrap items-center gap-3")}
								>
									{composerAlert.actions.map((action) => (
										<Button
											key={action.label}
											type="button"
											variant="link"
											size="sm"
											// `underline` at rest: `link` underlines only on hover and
											// active, so these rendered as plain green words with no
											// border, box or underline - an affordance carried by
											// colour alone, which is not one.
											className={cn("cursor-pointer text-body-sm underline")}
											onClick={action.onClick}
										>
											{action.label}
										</Button>
									))}
									{composerAlert.restore && (
										/*
										 * Puts the held payload back in the box, which is the only
										 * way to satisfy a guard that demands a byte-identical
										 * retry of a message the user can no longer see. This
										 * replaces the old instruction to "edit it, then send
										 * again" - advice the guard itself refuses, and following
										 * it looped.
										 */
										<Button
											type="button"
											variant="link"
											size="sm"
											// `text-meta` (12px, `--text-meta: 0.75rem`), matching the abandon control rather
											// than the 13px prose: `variant="link"` paints `text-accent`,
											// which out-contrasts `danger` in 9 of 12 palettes, so at
											// body size the REMEDY read louder than the failure it
											// answers. Size is the axis that settles it; the accent hue
											// still marks it as the primary action of the two.
											className={cn("cursor-pointer text-meta underline")}
											onClick={() => {
												// The held payload already CARRIES the reply markup, so
												// the chips that produced it have been consumed. Leaving
												// them attached would re-prefix the restored text on the
												// next send, and the guard refuses that mismatch - the
												// deadlock Restore exists to escape. The referenced text
												// is not lost: it is in the box, in the payload, visible.
												if (conversationId) clearReplies(conversationId);
												setNewMessage(composerAlert.restore ?? "");
												sendError?.onRestoreHeld?.();
												textareaRef.current?.focus();
											}}
										>
											Restore unsent message
										</Button>
									)}
									{composerAlert.abandon && (
										/*
										 * One control, two behaviours, because the two cases lose
										 * different things. With the held payload in the box there
										 * is nothing else to protect, so this discards the draft.
										 * With something else typed, discarding would destroy that
										 * too - unprompted, under a label naming the OLD message -
										 * so it releases only the store's claim and leaves the new
										 * text alone. The label says which.
										 *
										 * `text-meta text-ink-dim`, down from `text-body-sm
										 * text-ink-muted`: as the latter this outweighed the
										 * failure it belongs to in 11 of 12 themes (radient 11.86:1
										 * against danger's 6.98:1), putting a destructive secondary
										 * at the top of the hierarchy. Now radient reads 7.41 and
										 * the worst remaining margin over danger is 0.43 rather
										 * than 4.88, with the 13px -> 12px size drop carrying the
										 * rest of the demotion.
										 *
										 * NOT fixed by mixing danger toward the ground, which was
										 * tried: it guarantees the ordering by construction but
										 * rendered the control at 1.05-1.47:1 in the dark palettes,
										 * i.e. an illegible destructive control - a worse defect
										 * than the one being fixed. Nor by brightening
										 * `text-danger`, which already clears AA everywhere and is
										 * contract-verified. The residual inversion is a palette
										 * question (the ink ramps are ordered by design intent, not
										 * by contrast against THIS ground) and is raised for design
										 * round 2 rather than papered over here.
										 */
										<Button
											type="button"
											variant="link"
											size="sm"
											className={cn(
												"cursor-pointer text-ink-dim text-meta underline",
											)}
											onClick={() => {
												if (composerAlert.abandon === "discard") {
													setNewMessage("");
													sendError?.onDiscard?.();
													setAbandonNotice("Unsent message discarded.");
												} else {
													sendError?.onReleaseHeld?.();
													// Names the outcome the user chose: the typed draft is
													// deliberately still there, only the claim is gone.
													setAbandonNotice(
														"No longer holding the unsent message.",
													);
												}
												// This control unmounts itself, and focus would fall to
												// `<body>` - where Enter sends nothing and typing lands
												// zero characters. It is the LAST step of the recovery
												// flow: the user has just been told they are free to
												// send, with the text on screen. Focus goes back to the
												// composer for the same reason Restore does it.
												textareaRef.current?.focus();
											}}
										>
											{composerAlert.abandon === "discard"
												? composerAlert.discardClearsBox
													? // The box holds the payload, so discarding empties
														// something the user can see. "this message" names
														// what is in front of them; "unsent message" reads as
														// the invisible claim and understates the cost.
														"Discard this message"
													: "Discard unsent message"
												: "Stop holding it"}
										</Button>
									)}
								</div>
							)}
						{/*
						 * THE MUTED CONTEXT COMES LAST, AFTER THE FAILURE AND ITS CONTROLS.
						 *
						 * The region caps itself and scrolls internally (see the region's own
						 * note on `max-h`), so its children are ranked in the only way a capped
						 * block can rank them: by what survives when they no longer all fit.
						 * The order was the notice first, and that is wrong in the one
						 * direction that costs a user something. Measured in the column the
						 * canvas pane leaves at a 1440px window: 388px of content in a 120px
						 * window, where the muted notice's seven wrapped lines filled the
						 * window on their own and the sentence naming the file that failed -
						 * and the remedy for it - began at offset 144, with not one line of it
						 * visible short of finding the region's thin internal scrollbar
						 * (design round 4, D12).
						 *
						 * So the failure, the state it is in and the controls that answer it
						 * render first, and what the composer did with the refused draft
						 * renders after them: the user's next action depends on the first and
						 * not on the second. The cap is untouched - it is what keeps the
						 * composer's top border and the send control on screen, measured at CSS
						 * y=540 in every state at 892px - so the fix is the order and never the
						 * height. `scripts/canonical-chat.test.mjs` pins the order;
						 * `scripts/composer-alert-geometry.mjs` measures what it buys at the
						 * narrowest reached width.
						 */}
						{!abandonNotice && refusedNotice && (
							// Also muted, and for the same reason: the refusal's own alert
							// above is the failure, and this line says what the composer did
							// with the payload that failure left behind - including, when the
							// halves part, which half is not in the draft.
							<p className="text-ink-muted">{refusedNotice}</p>
						)}
						{!abandonNotice && !sendError && heldNotice && (
							// Muted ink on purpose: the region as a whole is the danger
							// register, and nothing has failed here - the box is one message
							// ahead of the conversation, which is a fact about the wait.
							<p className="text-ink-muted">{heldNotice}</p>
						)}
					</div>
				)}
				{/*
				 * What an interrupt left running, and NOT in the alert above.
				 *
				 * The band order the status row's comment records becomes row, alert,
				 * notice, box, and the notice sits INBOARD of the alert because both are
				 * transient results of a press while the row above is ambient context.
				 * It is a sibling rather than a child of the alert region because that
				 * region is the FAILURE register: it carries `text-danger` and
				 * `role="alert"`, and this sentence says a stop WORKED. Sharing the
				 * region would both paint it as an error and inherit the alert's
				 * assertive announcement for a press the user made themselves - which is
				 * the same reason the notifier deliberately raises no banner for a
				 * completed `interrupted`. An `<output>` instead: it implies the same
				 * polite `status` role, and its own definition - the outcome of a user
				 * action - is this sentence exactly.
				 *
				 * Null in the common case by construction - see `interruptNotice` - so
				 * a stopped turn with nothing under it leaves the band's height alone.
				 * The padding steps are the alert's own, and they put this line one
				 * padding step (16px at the default rung, 8 at the small one) inside
				 * the box's OUTER edge - the same track the send-error alert resolves,
				 * and NOT the textarea's text edge, which is that plus the textarea's
				 * own step. Design round 1's D1 measured both (16/25 dev px at 1x,
				 * +17/+25.5 CSS live): the two lines stacked here therefore do not share
				 * a column with the placeholder beneath them, which is pre-existing and
				 * which moving would move the alert too.
				 */}
				{interruptNotice && (
					/*
					 * `<output>` rather than a `role="status"` div, and the element is doing
					 * real work rather than satisfying a linter: the role it implies IS
					 * `status` (polite, an atomic whole), and its definition - the result of
					 * a calculation or the outcome of a USER ACTION - is exactly this
					 * sentence. `block` is needed because the element defaults to inline and
					 * carries the padding steps the alert beside it uses.
					 */
					<output
						className={cn(
							CHAT_MEASURE,
							"block text-body-sm text-ink-muted",
							isSmallView ? "px-2 pb-1" : "px-4 pb-2",
						)}
					>
						{interruptNotice}
					</output>
				)}
				{/*
				 * THE SENTENCE AND THE BOX SHARE ONE ANCHORING ELEMENT, and that is the round-3
				 * fix for the composer's own layout around the capture (design round 3, D1; UX
				 * round 3, U14; code review round 3, MAJOR 1; QA round 3, Q1/Q2).
				 *
				 * Why the notice is not inside the box, in one measured paragraph: the composer
				 * is pinned by its BOTTOM edge, so anything added UNDER the box pushes the text
				 * up. Measured on a populated pane at 1380x868 with the same rig, a 20px line
				 * injected below the box moves `textarea.y` 757.00 -> 737.00 (a full 20.00px),
				 * while the same line above the box moves it 757.00 -> 757.00 (0.00px): the
				 * transcript above yields instead. That is what makes "the text the operator is
				 * typing does not move when the capture arms" hold, and it is why the manager's
				 * own candidate - the sentence below the box - was measured and rejected: it is
				 * the one position that costs the typed line the sentence's full height. (On an
				 * empty chat the band centres the composer rather than pinning it, so a line above
				 * the box moves the group by half its height; that pane is answered by the
				 * sentence's own MIRROR below the group - see the mirror's comment at the end of
				 * the form - which is what makes the experiment's answer 0.00px on both panes.)
				 *
				 * The wrapper is also the slash popup's anchor. The list renders `absolute
				 * bottom-full`, so anchoring it HERE - above the sentence - is what keeps the
				 * armed state's completion list from painting over the armed state's sentence;
				 * anchored to the box instead, the two occupy the same strip and the popup (a
				 * later sibling) wins.
				 *
				 * AND THE WRAPPER CARRIES THE MEASURE, which is a round-4 fix rather than
				 * tidiness (design round 4, D1). The popup's `left-0 right-0` resolves against
				 * its CONTAINING BLOCK, so moving the anchor from the box (which carries
				 * `CHAT_MEASURE`) to this wrapper silently re-pointed the list at the COLUMN:
				 * measured on the same story and the same viewport against live `origin/main`,
				 * the list was x 63..961 (w 898 - the box's own edge) on `main` and x 48..976
				 * (w 928) here, and in a 1332px column 241..1139 (898) became 48..1332 (1284),
				 * a 192px overhang on each side. A positioning wrapper that the thing it
				 * positions does not measure against is a second measure by accident, which is
				 * precisely what `chat-measure.ts` exists to prevent. The notice and the box
				 * keep their own `CHAT_MEASURE` because each is read as the composer in its own
				 * right (the notice's width is asserted on its own by the suites).
				 */}
				<div className={cn(CHAT_MEASURE, "relative w-full")}>
					{/*
					 * The popup is a CHILD of this anchoring wrapper and renders `absolute
					 * bottom-full`, i.e. deliberately outside the box's content area, above it.
					 * It is NOT portaled, unlike the Radix menus and
					 * tooltips: those get their portal AND their positioning from
					 * Popper, whereas this list is anchored to one element that never
					 * moves relative to its own containing block, so `bottom-full` on a
					 * `relative` parent is the whole positioning story and a portal
					 * would mean hand-rolling anchor tracking on scroll and resize --
					 * more machinery, and a mechanism this codebase has nowhere else
					 * (`createPortal` appears in no renderer file).
					 *
					 * The cost of staying unportaled is that ANY ancestor which
					 * establishes a vertical clipping context erases it, with no
					 * symptom other than an invisible list, because the overflow is on
					 * the far side of the scroller's origin so there is nothing to
					 * scroll to. That is exactly what an `overflow-y-auto` on the
					 * composer band did (round 2, R1). Keep every bound between here
					 * and the band on the popup's SIBLINGS, never on its ancestors.
					 */}
					<SlashSuggestionsPopup state={slash} onPick={handleSlashPick} />
					{/*
					 * The capture's own sentence, in the `<output>` register the interrupt notice
					 * above the composer already uses: the result of a user action, said politely.
					 *
					 * IT SITS ABOVE THE BOX, IN FLOW, AND COSTS THE TYPED LINE NOTHING. Both
					 * earlier rounds kept it INSIDE the composer and paid in the same currency -
					 * the composer's own height changed when the sentence arrived, so the line
					 * under the caret moved: round 1 reserved a 19.5px band above the textarea and
					 * still grew 4px on arming, round 2 moved it onto the 32px control row, where
					 * a 353.86px sentence in 296.55px of free row wrapped to two lines and grew the
					 * row 32 -> 39px at 1380, became a 168x78 block (and took the cwd chip's label
					 * from 236px to 96px) at 950, and a 76.7px-wide, 175.5px-tall ribbon with the
					 * row tripled at 800 - this app's own `WINDOW_MIN_WIDTH`.
					 *
					 * Here it takes the composer's whole width instead of the row's leftovers, so
					 * the wrapping is the sentence's own measure and not a ribbon, no control can
					 * be landed on, and the working-directory chip and the readings strip - the two
					 * neighbours whose widths used to decide the sentence's fate - are out of the
					 * argument entirely.
					 *
					 * WHAT IT COSTS ON THE CENTRING BAND, and what does not, because the numbers
					 * above are a decision and not a claim of perfection. On an EMPTY chat the band
					 * centres the composer (`grow` + `justify-center`), so a line added above the box
					 * moves the whole group by half its height: measured on the running app, this
					 * sentence moved the typed line 13.75px (`textarea.y` 402.25 idle -> 416.00
					 * masked, and back, twice while one command was typed) where live `origin/main`
					 * holds 402.25 throughout all eleven keystrokes. The MIRROR below the group is
					 * that fix (UX round 4, U16): the group grows by the sentence's line on BOTH
					 * sides of the box, so the centring shift cancels for the box, the status row,
					 * the tip row and the chips, and the greeting above yields the one line the
					 * sentence needs. Measured on the band rig at 1380x872, before and after: the
					 * field's `y` 393.40 idle -> 407.20 with the sentence on the reviewed head, and
					 * 393.40 -> 393.40 now; the tip row 500.4 -> 514.2 then and 500.4 -> 500.4 now,
					 * with no collision in either state. It renders on that band alone, because on a
					 * populated pane the band is bottom-anchored and a mirrored line below the box
					 * would push the typed line up by its full height - the defect U14/design D1
					 * removed.
					 *
					 * AN EMPTY SENTENCE RENDERS NO BOX AT ALL, so the idle composer reserves
					 * nothing and is geometrically the composer that was there before the gesture
					 * existed; `aria-describedby` is still set only while there is a sentence, so
					 * an idle composer is not described by an empty element (UX round 1, U7).
					 */}
					<output
						id={CREDENTIAL_NOTICE_ID}
						className={cn(
							CHAT_MEASURE,
							credentialNotice ? credentialNoticeLine : "hidden",
						)}
					>
						{credentialNotice}
					</output>
					<div
						className={cn(
							COMPOSER_BOX,
							isSmallView ? "gap-2 rounded-md p-2" : "gap-3 rounded-frame p-4",
							CHAT_MEASURE,
						)}
						data-tour-tag="chat-input-textarea"
					>
						{(replies.length > 0 || attachments.length > 0) && (
							/*
							 * The previews carry their own bound, on a SIBLING of the popup
							 * rather than on an ancestor of it.
							 *
							 * These two are the composer's only unbounded content: attachment
							 * tiles are 100px each and wrap, and replies stack, so a dozen
							 * attachments grew the band past the window and took the send
							 * controls off the bottom with nothing left to scroll them back
							 * (measured: 40 tiles + 10 replies made the band 1126px in an
							 * 872px viewport, send button off screen). Bounding them HERE
							 * bounds the band as a consequence -- 377px at every load -- so
							 * the band needs no max-height of its own and therefore no
							 * scroller, which is what keeps the slash popup above it
							 * reachable.
							 *
							 * This is the pattern the textarea below already uses
							 * (`max-h-28` plus its own `overflow-y-auto`): each growable part
							 * of the composer caps itself and scrolls internally, so no
							 * wrapper has to clip on behalf of its children. ~240px shows two
							 * full rows of tiles before scrolling.
							 */
							<div className="max-h-[240px] shrink-0 overflow-y-auto">
								{replies.length > 0 && (
									<ReplyPreview
										replies={replies}
										onRemoveReply={handleRemoveReply}
									/>
								)}
								{attachments.length > 0 && (
									<AttachmentsPreview
										attachments={attachments.map((a) => a.path)}
										onRemoveAttachment={(index) =>
											handleRemoveAttachment(attachments[index].id)
										}
										disabled={isInputDisabled || isRecording || isTranscribing}
									/>
								)}
							</div>
						)}

						{isRecording ? (
							<AudioRecordingIndicator isRecording={isRecording} />
						) : isTranscribing ? (
							<div className="flex flex-1 items-center justify-center gap-2 rounded-sm px-4 py-2 [min-height:50px]">
								<span className="mr-1 font-medium text-body-sm text-ink-muted">
									Processing audio
								</span>
								<WaveformAnimation />
							</div>
						) : (
							/*
							 * The textarea and its MIRROR, in one isolated wrapper.
							 *
							 * `isolate` is load-bearing rather than tidy: the overlay paints at
							 * `-z-10` so the pill sits UNDER the glyphs the textarea paints, and
							 * without a stacking context here a negative index paints behind the
							 * composer box's own `bg-surface` — i.e. no pill at all, with nothing
							 * on screen to say why (CSS 2.1 appendix E: negative-z children come
							 * before in-flow block backgrounds).
							 */
							<div className="relative isolate w-full">
								<CredentialOverlay
									text={newMessage}
									payloads={payloadsRef.current}
									capture={capture}
									fieldRef={textareaRef}
									isSmallView={isSmallView}
								/>
								<textarea
									ref={textareaRef}
									className={cn(
										// The box model comes from ONE place, shared with the mirror:
										// any drift between these two moves the pill off the characters
										// it sits under.
										composerTextBox(isSmallView),
										// `block`, and it is a fix rather than a style choice (design round 3,
										// D1; code review round 3, MAJOR 1's sibling; QA round 3, Q2). The
										// wrapper above is a block container, and a textarea left at its
										// default `inline-block` sits in a LINE BOX there — so the wrapper
										// measured 39.7px around a 34px field (the strut's descender space)
										// and the composer box came out 5.7px taller than `origin/main`'
										// in EVERY state, idle included (61.4..179.1 against 61.4..173.4),
										// moving the control row, the ring and the box's bottom edge.
										// On main the field is a direct child of the box's flex column and
										// is blockified by it, which is why there was nothing to see there;
										// the overlay's wrapper is what introduced the line box, so the
										// field states its own display rather than depending on a parent's
										// formatting context to do it.
										"block",
										isSmallView ? "max-h-24" : "max-h-28",
										"resize-none overflow-y-auto bg-transparent",
										"text-ink outline-none placeholder:text-ink-dim",
										// The disabled state STEPS COLOUR rather than fading
										// (branding: disabled changes colour, never opacity), and
										// without this the only signal was `cursor: not-allowed`
										// after the user had already typed into a field that will
										// not accept anything.
										"disabled:text-ink-disabled disabled:placeholder:text-ink-disabled",
									)}
									placeholder={
										/*
										 * The gone-state sentence is checked FIRST, ahead of the busy one, and
										 * that order is the whole point: `isInputDisabled` is true for a missing
										 * conversation too, so a reader of a conversation this machine does not have
										 * would be told "Agent is busy" about a turn nobody is running (design
										 * round 2, D3). The remaining terms are the U8 pair, unchanged.
										 */
										unavailable
											? "This conversation is gone"
											: isInputDisabled
												? "Agent is busy"
												: awaitingAnswer
													? // Names the thing the box is now for, without restating
														// the question card or the waiting line (§ 7 keeps one
														// liveness statement per turn, and the card owns it).
														"Answer the question above"
													: awaitingReply
														? "Waiting for the agent"
														: "Ask me for help"
									}
									value={newMessage}
									onChange={(e) => {
										/*
										 * THE MIRROR'S SECOND DOOR. Every buffer mutation that is NOT an
										 * intercepted keystroke arrives here — Backspace, Delete, a
										 * selection, a drop, an IME commit, and any paste that fell through
										 * — and `applyDomEdit` maps the edit onto the held value at the
										 * index the operator sees. The first door is the printable-key
										 * branch of `handleCredentialKeyDown`, which never lets the
										 * character reach the DOM at all; this one is the belt for the
										 * routes a keyboard gate cannot see.
										 *
										 * `origin` is "typing" because a change IS a keystroke-shaped
										 * event on this control — an arrival (a restored draft, a seed) is
										 * written through `setNewMessage` by its own caller, never through
										 * the DOM's change event for a textarea the user is in.
										 */
										const next = e.target.value;
										const at = e.target.selectionStart ?? next.length;
										const applied = applyDomEdit(
											captureRef.current,
											newMessage,
											next,
											at,
											"typing",
										);
										if (applied.buffer !== next) {
											// A real character reached the span through a route the
											// keyboard gate could not see, and it is already replaced by
											// its mask cell here.
											pendingCaret.current = applied.caret;
											setCaret(applied.caret);
										} else {
											setCaret(at);
										}
										if (applied.capture !== captureRef.current)
											setCapture(applied.capture);
										// Only the empty -> non-empty edge: the whole point is one
										// statement of intent per composed message, and the
										// consumer's latch should not be asked to absorb a
										// per-character call it can only discard.
										if (!newMessage && applied.buffer) onComposerInput?.();
										/*
										 * The capture's own write, stamped so the whole-buffer teardown can
										 * tell it from a replacement some other writer made. A DOM change
										 * reaches here without passing `applyCapture`, which is exactly why
										 * the stamp is not optional: without it, the operator's own
										 * keystroke would read as an external write and end the gesture it
										 * is in the middle of.
										 */
										captureOwnedBuffer.current = applied.buffer;
										// An abandoned capture (the drop and IME routes) settles the box
										// here rather than through `applyCapture`, so the §6 write has to
										// be asked for here too.
										persistDraft(applied.capture, applied.buffer);
										setNewMessage(applied.buffer);
										// Editing the text answers the alert. Leaving it up over a
										// draft the user has since changed is the defect this whole
										// change replaces, and moving the banner to the composer
										// would only have moved that defect closer to the eye.
										//
										// After a dwell, though: the message is two sentences plus up
										// to three controls, and a user who reaches straight for the
										// keyboard lost all of it before finishing the first word -
										// including the remedy buttons. The alert still goes on the
										// edit, just not before it can be read.
										if (
											Date.now() - alertShownAt.current >=
											ALERT_READ_DWELL_MS
										)
											sendError?.onDismiss?.();
									}}
									onSelect={(e) => {
										const field = e.target as HTMLTextAreaElement;
										/*
										 * A CARET REPORT THAT ARRIVES BEFORE THE COMPOSER'S OWN
										 * CARET WRITE LANDS IS A REPORT ABOUT THE CARET IT REPLACED.
										 *
										 * `applyCapture` parks the caret it is about to set in
										 * `pendingCaret` and the layout effect applies it with the
										 * buffer. A `select`/`selectionchange` still in flight from the
										 * PREVIOUS edit therefore reaches this handler between the state
										 * write and its commit, carrying the older buffer (the render
										 * closure has not moved yet) and the older offset — a pair that
										 * is internally consistent and describes a state the composer
										 * has already left. Re-syncing on it is how accepting the
										 * `/credential` row closed the span that completion had just
										 * opened: the report said "the caret is at 5, inside the token"
										 * while the capture was already open at 6, so `syncCapture` read
										 * a caret move out of the span.
										 *
										 * Skipping it is not a caret move being ignored: the offset that
										 * arrives is the one this write is replacing, and the pending
										 * value is applied by the layout effect either way. If the DOM
										 * already agrees — a report about the caret we just set — the
										 * marker is retired here so the guard cannot outlive its write.
										 */
										const pending = pendingCaret.current;
										if (pending !== null) {
											if (field.selectionStart === pending)
												pendingCaret.current = null;
											return;
										}
										setCaret(field.selectionStart);
										/*
										 * A CARET MOVE RE-SYNCS THE CAPTURE, and the origin says what a
										 * caret move may do: it may keep a latched arm, re-anchor it, and
										 * RE-OPEN a span the caret has returned to — but it may never ARM
										 * by itself. The TUI asks both questions at the same reactive
										 * (`watch_selection`), because a mouse click, an app-set
										 * selection and a completion's caret all move the caret with no
										 * caret key pressed: without the re-open, leaving and coming back
										 * left an armed token whose next typed character landed in
										 * PLAINTEXT; without the "may not arm" half, a click at the end of
										 * a restored draft would swallow the next paste.
										 */
										setCapture(
											syncCapture(
												captureRef.current,
												newMessage,
												field.selectionStart,
												"caret",
											),
										);
									}}
									onKeyDown={handleComposerKeyDown}
									onPointerDown={() => {
										/*
										 * "I am about to type here." An ask gate can advance while the
										 * user is on their way into this box, and the restore must not
										 * move them off it: the characters they type would reach
										 * nothing and the next `Space` would answer the next question
										 * (UX round 4, U13).
										 */
										composerPointerTouched = true;
									}}
									onPaste={handlePaste}
									rows={1}
									disabled={isInputDisabled}
									aria-label="Message"
									role="combobox"
									aria-describedby={
										credentialNotice ? CREDENTIAL_NOTICE_ID : undefined
									}
									aria-expanded={slash.open}
									aria-controls={slash.open ? slash.listId : undefined}
									aria-activedescendant={slash.activeDescendantId ?? undefined}
								/>
							</div>
						)}

						{/*
						 * The composer's controls and the session's readings, on ONE row.
						 *
						 * The readings used to have a row of their own above this one. They are
						 * inside it now, which is why this row wraps: above 750px of COLUMN the
						 * cluster sits inline, immediately after the working-directory chip, with
						 * the row's free space falling before the controls; below it the cluster
						 * takes the FIRST line in full (`basis-full`) and the controls keep the
						 * second. `justify-between` cannot express either — with three children it
						 * centres the middle one, which is the opposite of what the row needs — so
						 * the row uses `ml-auto` instead, on the controls group, which is the one
						 * child that always renders.
						 *
						 * That "always renders" is not a nicety, it is the round-1 blocker. The
						 * readings cluster returns `null` in three ordinary states (no `frontend`
						 * yet, nothing known at all, the error boundary's empty fallback), and
						 * while the margin lived on the cluster those states had NO live auto
						 * margin at all — the controls sat flush against the chip, mid-row, in
						 * this PR's own draft frame (design round 1.5, D7).
						 *
						 * `gap-y-2` is the drop between the wrapped line and the controls: 8px,
						 * the within-component step, tighter than the 12px this composer used
						 * when the readings were a separate row (§ 5).
						 *
						 * `flex-nowrap` above the threshold is NOT decoration. Wrapping happens
						 * on the items' CONTENT sizes, before any shrinking: a long model name (an
						 * aggregator slug is ~48 characters) makes the cluster wider than its
						 * share, so a still-wrapping row moves the microphone and send to a
						 * second line instead of truncating the name — the exact inversion of the
						 * yield order, where the name truncates first and the controls never
						 * move. Measured on the live composer at a 750px box: with the row free
						 * to wrap, the controls sat 24px below the readings; with `flex-nowrap`
						 * they stay on one line and the name gives up the width.
						 */}
						<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 @min-[750px]/chatcol:flex-nowrap">
							{/*
							 * The session's readings, inside the row rather than on a row of their
							 * own above it (R1).
							 *
							 * The DOM slot is FIRST, before the left group, so that the wrapped
							 * state's tab order matches its painted order: below 750 the cluster is
							 * the row's first line, and `order-first` only ever reordered the paint,
							 * leaving a keyboard user to walk down to attach and the chip and back
							 * UP to the readings (UX round 1, U4). Above 750 the strip's own
							 * `order-2` puts it back between the chip and the controls, and the
							 * controls' `order-3` keeps mic and send last.
							 *
							 * The two widths want OPPOSITE DOM orders and there is one DOM:
							 * wrapped, the cluster paints first and must be tabbed first;
							 * inline, it paints third and UX round 2 (U8) measured it still
							 * being tabbed first. One node cannot satisfy both, and a second
							 * render to fix the inline order would be a second layout to keep
							 * in step - the thing this row is built to avoid, and what the
							 * composer test pins. The wrapped width keeps the guarantee
							 * because that is where the mismatch is a visible jump back UP
							 * the row; inline the readings sit between the chip and the
							 * controls, so the tab lands one stop early rather than out of
							 * sequence. Recorded rather than silently chosen.
							 *
							 * A crash in the strip must not take the composer down with it — the
							 * readings are metadata and the ability to type is not — so it renders
							 * inside an error boundary with an empty fallback: a missing strip is a
							 * degradation a user can work through, and a fallback panel here would
							 * be a bigger interruption than the thing it reports. The row's other
							 * groups survive the same fallback untouched.
							 */}
							{sessionStatus && (
								<ErrorBoundary fallback={null}>
									<SessionStatusStrip
										frontend={sessionStatus.frontend}
										onCommand={sessionStatus.onCommand}
										effortEntities={sessionStatus.effortEntities}
										draft={sessionStatus.draft}
										onOpenDraftPicker={sessionStatus.onOpenDraftPicker}
										draftResolution={sessionStatus.draftResolution}
										pendingModel={sessionStatus.pendingModel}
									/>
								</ErrorBoundary>
							)}

							{/*
							 * The BUTTON LINE, as one flex item.
							 *
							 * Below 750px of column the readings take the row's first line
							 * and this is the second - and this wrapper is what makes "the
							 * second" mean one line rather than however many the items
							 * need. Without it the row's own `flex-wrap` broke the line on
							 * the items' CONTENT sizes: the chip's path is 202px at full
							 * length, so at a 240-336px column the chip did not get the
							 * chance to shrink and the microphone and send fell to a THIRD
							 * line (the composer grew 143.5 -> 179.5px at the floor, design
							 * round 1, D1 and code review round 1, MAJOR 2). A wrapping row
							 * cannot express "one line, and everything on it yields".
							 *
							 * Above the threshold it dissolves: `contents` hands its
							 * children back to the row, so the cluster's `order-2` puts the
							 * readings between the chip and the controls and the controls'
							 * `ml-auto` takes the free space - the same single auto margin
							 * as below, now between the cluster and mic/send (D7).
							 *
							 * `min-w-0` is what lets the chip inside actually shrink rather
							 * than pushing the group past the row: a flex item's automatic
							 * floor is its content.
							 */}
							<div className="flex w-full min-w-0 flex-nowrap items-center gap-x-2 @min-[750px]/chatcol:contents">
								{/*
								 * Left side: attachment button and the working-directory chip.
								 *
								 * `min-w-0` on this group AND on the row above it: a flex item's
								 * automatic minimum size is its CONTENT, so an intermediate
								 * wrapper that does not opt out of it refuses to shrink and the
								 * `min-w-0` further down never gets the chance to apply. With the
								 * canvas panel open the chat column collapses to its 220px floor
								 * and the chip's 260px cap alone drove the row 97px past the
								 * column's right edge (design round 2, D11); the chip carries the
								 * shrink, but only these two ancestors can let it happen.
								 *
								 * ABOVE the threshold this group does not shrink at all, and that is
								 * not a preference: the chip's own root is `shrink-0` there so a long
								 * model name truncates before the path yields (D9). With the chip
								 * refusing to shrink while its parent still could, the group shrank to
								 * 145.6px around a 260px chip and the path painted straight over the
								 * readings - visible in the 750px long-name frame, and invisible to
								 * `row.overflowX`, which reads 0 because the GROUP fits. The yield
								 * order needs both halves stated.
								 */}
								<div className="flex min-w-0 items-center gap-1 @min-[750px]/chatcol:shrink-0">
									<Tooltip content="Attach file">
										<span>
											<Button
												variant="ghost"
												size={isSmallView ? "icon-sm" : "icon"}
												className="text-ink-dim hover:bg-elevated hover:text-ink"
												onClick={handleAttachFile}
												aria-label="Attach file"
												data-tour-tag="chat-input-attach-file-button"
												disabled={
													isInputDisabled || isRecording || isTranscribing
												}
											>
												<Paperclip aria-hidden="true" />
											</Button>
										</span>
									</Tooltip>
									{/*
									 * Gated on whether a directory is KNOWN, not on whether it is
									 * truthy, and not on the session being idle.
									 *
									 * Two unsatisfiable-condition bugs in the same three lines,
									 * one after the other. The original `!canonicalStop` gate
									 * could never be true in the canonical chat - the stop
									 * control is passed unconditionally - so the chip was
									 * unreachable from v0.16.0 even though it was still mounted
									 * here. Replacing it with `{cwdToShow && ...}` then made the
									 * chip able to DELETE ITSELF: `""` is a legal value of the
									 * staged cwd, it is falsy, and this chip is the only writer
									 * of `state.cwd` now the full-width bar is gone. So clearing
									 * the field unmounted the one control that could set it
									 * again, and `cwd` is persisted, so the app came back from a
									 * restart still with no chip - unrecoverable without
									 * devtools.
									 *
									 * `!== undefined` is the honest question: undefined means "no
									 * directory is known for this conversation", which is the one
									 * case with nothing to render. An empty string means "known,
									 * and empty" - a state the chip has an affordance for, and
									 * the reason its `unset` branch is reachable again.
									 */}
									{cwdToShow !== undefined && (
										<DirectoryIndicator
											ref={cwdChipRef}
											currentWorkingDirectory={cwdToShow}
											writePath={cwdWritePath}
											pending={cwdPending}
											pendingAccepted={cwdPendingAccepted}
											readOnlyReason={
												cwdWritePath
													? undefined
													: (cwdReadOnlyReason ?? MOVE_UNAVAILABLE_REASON)
											}
										/>
									)}
								</div>

								{/*
								 * THE CAPTURE'S SENTENCE IS NOT IN THIS ROW ANY MORE (design round 3,
								 * D1; UX round 3, U14; code review round 3, MAJOR 1; QA round 3,
								 * Q1/Q2).
								 *
								 * Both earlier rounds kept it inside the composer, and both paid the
								 * same price: the composer's own height changed when the sentence
								 * arrived, so the line the operator was typing moved under their caret.
								 * Round 3 measured where that ends - 296.55px of free row against a
								 * ~353.86px sentence at 1380 (two lines, the row 32 -> 39px), a 168x78
								 * block and a 236 -> 96px cwd chip at 950, and at 800 a 76.7px ribbon
								 * 175.5px tall with the row tripled - and those are the numbers that say
								 * the row cannot hold a sentence of this length beside a chip, a
								 * readings strip and three controls.
								 *
								 * It now lives ABOVE the box, in the form's own flow, where the
								 * composer's pinned bottom edge cannot be pushed by it: the notice's own
								 * comment above the box carries the measurement that decides the
								 * placement. This slot stays as the pointer, because the obvious repair
								 * for a crowded row is to put the sentence back into it, and that repair
								 * has now been tried twice.
								 */}

								{/* Right side: microphone, send or stop button.
								 *
								 * `ml-auto` is the row's ONE live auto margin, at EVERY width, and it is
								 * here rather than on the readings on purpose (design round 1.5, D7):
								 * this group cannot return `null`, so the row's right-justification
								 * does not depend on whether a cluster that can vanish happens to be
								 * rendering. Below 750px of column it separates this group from the
								 * attached line above it; above, it holds the free space between the
								 * cluster and these controls, which is what leaves the readings
								 * immediately after the working-directory chip. A second live auto
								 * margin would share that space evenly and float the controls mid-row.
								 *
								 * `order-3` above the threshold is only needed because the strip's DOM
								 * slot is first (see above); it makes the paint [attach][chip]
								 * [readings][mic][send] out of a DOM whose first child is the cluster.
								 */}
								<div className="ml-auto flex items-center gap-1 @min-[750px]/chatcol:order-3">
									{!isRecording &&
										!isTranscribing &&
										!(isLoading && currentJobId) && (
											<Tooltip
												content={
													!canEnableRecordingFeature
														? recordingUnavailableReason
														: `Start recording (${shortcutText} or hold Space)`
												}
											>
												<span>
													<Button
														variant="ghost"
														size={isSmallView ? "icon-sm" : "icon"}
														className="text-ink-dim hover:bg-elevated hover:text-ink"
														onClick={handleStartRecording}
														aria-label="Start recording"
														disabled={isLoading || !canEnableRecordingFeature}
													>
														<Mic aria-hidden="true" />
													</Button>
												</span>
											</Tooltip>
										)}
									{isRecording && (
										<>
											<Tooltip content="Confirm recording (Enter)">
												<span>
													<Button
														variant="ghost"
														size={isSmallView ? "icon-sm" : "icon"}
														className="text-success hover:bg-success-wash hover:text-success"
														onClick={handleConfirmRecording}
														aria-label="Confirm recording"
														disabled={isLoading}
													>
														<Check aria-hidden="true" />
													</Button>
												</span>
											</Tooltip>
											<Tooltip content="Cancel recording (Esc)">
												<span>
													<Button
														variant="ghost"
														size={isSmallView ? "icon-sm" : "icon"}
														className="text-danger hover:bg-danger-wash hover:text-danger"
														onClick={handleCancelRecording}
														aria-label="Cancel recording"
														disabled={isLoading}
													>
														<X aria-hidden="true" />
													</Button>
												</span>
											</Tooltip>
										</>
									)}
									{/*
									 * THE SLOT IS RESERVED, not merely vacated.
									 *
									 * Without this, pressing Stop slides the dictation control 36px
									 * right - 32px of control plus the row's 4px gap - into the exact
									 * centre of the box the press just landed in, so a reflex second
									 * press starts a MICROPHONE RECORDING. Measured independently by
									 * UX round 1 (U1) and QA (Q1): the element at the Stop's own
									 * centre is `button[aria-label="Start recording"]` once the turn
									 * settles, and pressing there reports `recording_started: true`.
									 * A 120ms double press still hits Stop twice, which is what made
									 * it a trap rather than something a user notices.
									 *
									 * So an invisible, non-interactive box holds the position for as
									 * long as the backend negotiates `session_interrupt`, and the mic
									 * never occupies the Stop's centre. `aria-hidden`, no focus and no
									 * pointer events: this is geometry, not a control - nothing may be
									 * reachable, announced or pressed there. The cost, stated rather
									 * than hidden: the idle composer carries a one-control gap between
									 * the dictation control and Send.
									 *
									 * Gated on the same legacy condition the mic is (`isLoading &&
									 * currentJobId`), because that path hides the mic and renders its
									 * own `Stop agent` in this cluster; reserving a slot nothing will
									 * fill would move a control for no reason.
									 */}
									{canonicalStopAvailable &&
										!canonicalStop?.active &&
										!(isLoading && currentJobId) && (
											<span
												aria-hidden="true"
												data-interrupt-slot=""
												className={cn(
													"pointer-events-none",
													isSmallView ? "size-7" : "size-8",
												)}
											/>
										)}
									{canonicalStop?.active && (
										<Tooltip content="Stop this session's current work">
											<span>
												<Button
													variant="danger"
													size={isSmallView ? "icon-sm" : "icon"}
													type="button"
													onClick={canonicalStop.onStop}
													aria-label="Stop"
												>
													<Square aria-hidden="true" />
												</Button>
											</span>
										</Tooltip>
									)}
									{isLoading && currentJobId ? (
										<Tooltip content="Stop agent">
											<span>
												<Button
													variant="danger"
													size={isSmallView ? "icon-sm" : "icon"}
													type="button"
													onClick={() => onCancelJob?.(currentJobId)}
													aria-label="Stop agent"
												>
													<Square aria-hidden="true" />
												</Button>
											</span>
										</Tooltip>
									) : (
										!isRecording &&
										!isTranscribing && (
											<Tooltip content="Send message">
												<span>
													<Button
														variant="primary"
														size={isSmallView ? "icon-sm" : "icon"}
														type="submit"
														disabled={
															isLoading ||
															(!newMessage.trim() && attachments.length === 0)
														}
														aria-label="Send message"
													>
														<Send aria-hidden="true" />
													</Button>
												</span>
											</Tooltip>
										)
									)}
								</div>
							</div>
						</div>
					</div>
				</div>
				{/*
				 * The ambient tip line: inside the splash, below the box, above
				 * the chips.
				 *
				 * OUTSIDE `[data-lo-suggestion-stack]` deliberately. The stack's cap
				 * reads its own children as chips and derives rows from the boxes
				 * that share a top edge (`suggestion-stack.ts`), so a non-chip child
				 * there would be counted as one and corrupt the row model.
				 *
				 * Lying inside the splash is the other half of the same contract, and
				 * it is what keeps the cap arithmetic honest:
				 * `MeasuredSuggestionStack` measures
				 * `fixed = splash.height - stack.height`, so the row's own 32px
				 * (12px margin + 20px row) lands in the fixed budget automatically
				 * and the stack's allowance drops by exactly that much.
				 *
				 * The margin and the shared measure are the CALLER's, matching the
				 * suggestion wrapper below: a component does not own its outer
				 * margin, the container owns the gap (branding.md § 5).
				 */}
				{showEmptyChatPrompt && (
					<div className={cn("mt-3", CHAT_MEASURE)}>
						{/*
						 * The clock is suspended while the box holds a draft, so a text
						 * change in the peripheral field cannot pull the eye off what
						 * the user is typing; the row itself keeps painting.
						 */}
						<ComposerTipRow suspended={newMessage.trim().length > 0} />
					</div>
				)}
				{showEmptyChatPrompt && (
					<div className={cn("mt-6", CHAT_MEASURE)}>
						{/* Borderless chips, left-aligned on the measure. Twelve
						 * accent-washed pills was the accent budget spent four times over on
						 * the one screen that has no content to compete with them, and the
						 * neutral outline that replaced them still drew seven 3:1 boundaries
						 * — a control's edge, on what are examples rather than the primary
						 * action. As ghost controls they draw no boundary at all and read as
						 * what they are. Raycast and Linear's command palettes hold
						 * suggestions at exactly this weight. */}
						<MeasuredSuggestionStack
							band={band}
							splash={splash}
							suggestions={suggestions}
							disabled={suggestionsDisabled}
							onSelect={handleSuggestionClick}
							focusComposer={() => textareaRef.current?.focus()}
						/>
					</div>
				)}
				{/*
				 * THE SENTENCE'S MIRROR, on the band that CENTRES the composer and nowhere
				 * else (UX round 4, U16).
				 *
				 * THE DEFECT. On an empty chat the band claims the column and centres its
				 * group, so a line added anywhere in that group moves the whole of it by
				 * half the line - the composer the operator is typing in included, which is
				 * the pane the app OPENS on. Measured on the running app at 1380, real
				 * keystrokes: `textarea.y` 402.25 idle -> 416.00 armed, and it toggles twice
				 * while one command is typed - `/cred` 416.00, `/crede` 402.25,
				 * `/credential` 416.00 - where live `origin/main` holds 402.25 through all
				 * eleven keystrokes. The popup moves with it.
				 *
				 * WHY THE TWO OBVIOUS DEVICES DO NOT WORK HERE. Taking the sentence out of
				 * the flow adds no height, and is what this band wants - but on this band the
				 * sentence shares its strip with the completion list, which is `absolute
				 * bottom-full` above it in the same wrapper: with no line in the flow the
				 * list resolves to the sentence's own strip, and the list (a later sibling,
				 * `z-20`) wins. That sentence is the only thing that says what Enter will do
				 * (UX round 2, U10), so it cannot be the half that loses. Reserving the line
				 * while the sentence is ABSENT is no better: it moves the IDLE empty-chat
				 * composer, which is `origin/main`'s to the pixel today (402.25 on both trees
				 * at 1380), and an empty sentence rendering no box at all is a property the
				 * suites pin.
				 *
				 * THE DEVICE. Mirror the line BELOW the group instead, so the group grows by
				 * the line on both sides of the box: the centring shift cancels for
				 * everything between the two lines - the box, the status row, the tip row and
				 * the chips all sit at their idle y, and the sentence paints in the space the
				 * group's own top vacates. Both halves must measure the same height, which is
				 * why they share `credentialNoticeLine`. The clearance is structural rather
				 * than tuned: the greeting above yields exactly one line, so the sentence's
				 * top is always the idle gap below the greeting's bottom (32px: the splash's
				 * `gap-6` plus the form's `pt-2`), whatever the sentence's own height or the
				 * column's width.
				 *
				 * CONFINED TO THIS BAND, and that is a requirement rather than tidiness: on a
				 * populated pane the band is bottom-anchored (`shrink-0`, the box pinned by
				 * its bottom edge), so a mirrored line under the box would grow the band
				 * downward and push the typed line UP by the line's full height - the defect
				 * U14/D1 removed. There, the sentence stays in the flow, where the transcript
				 * above it yields instead.
				 *
				 * WHY IT IS INVISIBLE AND ARIA-HIDDEN rather than a spacer: it is the same
				 * sentence twice, so it must neither be announced (a screen reader would read
				 * the notice twice) nor painted (the sentence is already on screen, above the
				 * box). It carries no `id`, because `CREDENTIAL_NOTICE_ID` names one element
				 * and `aria-describedby` points at that one. And it renders `hidden` while
				 * there is no sentence, so the idle band still reserves nothing.
				 *
				 * WHAT IT COSTS, disclosed: the greeting yields one line (27.5px at 1380)
				 * when the sentence arrives, in place of the composer's half-line. Nothing
				 * else in the pane moves.
				 */}
				{bandCentred ? (
					<output
						aria-hidden="true"
						className={cn(
							CHAT_MEASURE,
							credentialNotice ? credentialNoticeLine : "hidden",
							"invisible",
						)}
					>
						{credentialNotice}
					</output>
				) : null}
			</form>
		);

		return (
			<div
				className={cn(
					// No ground of its own: this band inherits the chat column's, so
					// the two cannot drift apart. That invariant is the requirement,
					// not the role it names. It was written as `bg-surface` to MATCH a
					// column that was also `surface`, and the reason was sound - a
					// band painted on a different ground from its column reads as a
					// hole punched through the panel to the page behind it, and on an
					// empty chat this band holds the greeting, the composer and the
					// suggestion chips, so it covers most of the column (the reported
					// "large empty space with the wrong background colour"). Naming
					// the ground instead of the relationship is what went stale: the
					// column is `canvas` now, because it is the working surface (see
					// chat-content.tsx), and a hardcoded `bg-surface` here would have
					// re-opened that hole in reverse. The composer box keeps its own
					// `border-control` edge (floored at 3:1 on all four grounds), so
					// it stays legible whatever ground the band sits on.
					//
					// `shrink-0` alone: `grow` on the same element contradicted it and
					// became actively harmful once the transcript stopped declaring
					// `h-full`, because the band would then claim the column's free
					// space instead of leaving it to the transcript.
					//
					// That reasoning holds ONLY while a transcript exists to leave the
					// space to. With no messages there is nothing above this band but
					// an empty scroller, and `shrink-0` then pinned the greeting,
					// composer and chips to the bottom of the column under a large dark
					// void -- the operator's report. So the vertical behaviour is
					// conditional on the same fact that decides which content renders:
					// empty means `grow` (claim the column, `justify-center` centres the
					// group), non-empty means `shrink-0` (natural height at the bottom).
					// The transcript yields its own `grow` on the same condition, so the
					// two never split the free space between them.
					//
					// `data-lo-composer-band` is the band's stable identity. The
					// slash-popup guard in scripts/canonical-chat.test.mjs used to find
					// this element by `shrink-0 + bg-surface`, which the conditional
					// below makes state-dependent; an attribute that does not move with
					// the layout is what keeps that guard aimed at the band.
					//
					// NO `max-height` and NO `overflow` on this element, deliberately.
					//
					// `shrink-0` inside a now-`overflow-hidden` column really is
					// unbounded, and round 1 bounded it here with `max-h-[70%]` plus
					// `overflow-y-auto`. The bound was right and the scroller was a
					// blocker (round 2, R1): the slash popup is `absolute bottom-full`
					// inside this band and is not portaled, so a vertical clipping
					// context here erased it -- 8/8 hit-testable rows to 0/8 with an
					// ordinary transcript, and unrecoverable by scrolling because
					// `bottom-full` puts the overflow above the scroller's origin
					// (`scrollHeight === clientHeight`, so `maxScroll` is 0).
					//
					// What decides that is the BAND'S height, not the window's: on an
					// empty chat the greeting and chips make the band tall enough to
					// contain the popup, which is why the defect hid from a check that
					// only looked at the empty screen.
					//
					// The bound now lives on the previews inside the composer box, which
					// are the only unbounded content and are SIBLINGS of the popup, so
					// the band ends up bounded (377px at every load measured) without
					// any ancestor of the popup clipping. Do not re-add a bound here:
					// cap whatever new content grows, where it grows.
					CHAT_COLUMN_CONTAINER,
					"flex w-full flex-col items-center justify-center",
					/*
					 * The empty-chat band CLAIMS the column; every other state is natural
					 * height at the bottom. `isHydrating` is the third case and the reason
					 * this line is not simply `messages.length === 0`.
					 *
					 * A switch mounts this panel before the snapshot arrives, so the first
					 * frames have no messages - and taking the empty-chat band put the
					 * composer in the middle of the window (measured: composer top edge
					 * 468px -> 736px, 30% of a 900px window, when the transcript landed).
					 * "There is nothing here" is a CLAIM, and the hydration window is
					 * exactly the state where the app does not know it yet; the composer is
					 * therefore bottom-anchored at its settled geometry while hydrating, and
					 * the placeholder that stands in for the transcript is rendered where the
					 * transcript will be (`canonical-transcript.tsx`) rather than in this
					 * band. A switch into a session that really is empty is the only case
					 * that then moves, and that is the honest move.
					 */
					bandCentred ? "grow" : "shrink-0",
					// The horizontal inset is the SHARED one and is the same at every
					// width, because it is half of a shared edge: see
					// `CHAT_COLUMN_INSET`. Only the VERTICAL padding compacts in the
					// small view -- vertical space is what a short window is short of,
					// and compacting it moves no edge the transcript also owns.
					CHAT_COLUMN_INSET,
					isSmallView ? "pb-1 pt-0.5" : "pb-4 pt-2",
				)}
				data-lo-composer-band={true}
				ref={setBand}
			>
				{/*
				 * ONE wrapper at every state, and only its CLASSES change.
				 *
				 * This was a ternary between a centred `<div>` holding the greeting and
				 * `inputContent` bare, and the branch keys on `!isSmallView` - a COLUMN
				 * measurement (`chat-content.tsx`, <550px). So opening the run pane or the
				 * canvas narrows the column across that threshold and swaps the element
				 * TYPE at this position, which React resolves by unmounting the old subtree
				 * and mounting a new one. The status row lives inside `inputContent`, so a
				 * press on its plan chip - a control whose whole job is to narrow the column
				 * - replaced the very node the user had just pressed, and focus went to
				 * `<body>` (QA round 1, Q4: `focusout` with no following `focusin`, and the
				 * chip's dataset mark gone). On a populated transcript the node survives and
				 * nothing is dropped, which is why only the empty-transcript case failed.
				 *
				 * Rendering the wrapper always and moving the difference into its classes is
				 * the fix at the source: the subtree is never replaced, so no control inside
				 * it can be torn out from under a press. `w-full` in the non-prompt state is
				 * what keeps this neutral - the band is a centred flex COLUMN, and a plain
				 * unwidthed wrapper would shrink to its content instead of filling the column
				 * the way `inputContent`'s own `w-full` did.
				 *
				 * The splash ref the suggestion cap measures sits on THIS element, which
				 * is why the two halves compose rather than conflict: the prompt classes
				 * are the splash wrapper's own, so the node the cap measures, its
				 * geometry and its children are exactly what the ternary used to mount -
				 * the same node, now surviving a column crossing instead of being
				 * replaced by it. The cap's guard is unaffected: it also requires the
				 * stack node, which only exists with the prompt, so a wrapper that is
				 * non-null in every other state cannot arm the measurement.
				 */}
				<div
					ref={setSplash}
					className={cn(
						showEmptyChatPrompt
							? "flex w-full flex-col items-center justify-center gap-6 py-4"
							: "w-full",
					)}
				>
					{showEmptyChatPrompt ? (
						<h2 className="text-center text-ink text-title">
							What can I help you with today?
						</h2>
					) : null}
					{inputContent}
				</div>
				<ScrollToBottomButton
					visible={isFarFromBottom}
					onClick={scrollToBottom}
					bottomDistance={isSmallView ? 120 : 160}
					hasNewActivity={hasNewActivity}
				/>
			</div>
		);
	},
);

MessageInput.displayName = "MessageInput";
