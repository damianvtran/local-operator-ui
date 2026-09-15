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
import { showErrorToast } from "@shared/utils/toast-manager";
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
import {
	DirectoryIndicator,
	type DirectoryIndicatorHandle,
	type DirectoryWritePath,
} from "./directory-indicator";
import { ReplyPreview } from "./reply-preview";
import type { RunDetails } from "./run-details";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import {
	type CompletionRow,
	SlashSuggestionsPopup,
	completionFor,
	handleSlashKeyDown,
	useSlashCompletion,
} from "./slash-commands";
import { pointerPickRuns } from "./slash-contract";
/*
 * `SlashDispatchOutcome` is imported as a TYPE only: the composer hands a
 * spliced command line to the page's dispatcher and must know whether it ran to
 * decide what the box holds afterwards, but it must not own any part of how the
 * command runs.
 */
import type { SlashDispatchOutcome } from "./slash-dispatch";
import { planSlashSubmission } from "./slash-submit";
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
	 */
	canonicalStop?: { active: boolean; onStop: () => void };
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
	initialSuggestions?: string[];
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
	 * the composer borrows it rather than growing a second one. Used for the two
	 * outcomes a user cannot read off the box: a mid-draft name-list command
	 * whose list cannot answer, and a staged reassembly that did NOT send.
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
 * outside this component's render, and `aria-label="Message"` is the same
 * handle the answer options are found by.
 */
const composerBox = (): HTMLTextAreaElement | null =>
	document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');

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

		const MAX_SUGGESTIONS = 7;

		const suggestions = useMemo(() => {
			if (!initialSuggestions || initialSuggestions.length === 0) return [];
			if (initialSuggestions.length <= MAX_SUGGESTIONS) {
				return initialSuggestions;
			}
			// Randomly select MAX_SUGGESTIONS unique suggestions
			const shuffled = [...initialSuggestions].sort(() => Math.random() - 0.5);
			return shuffled.slice(0, MAX_SUGGESTIONS);
		}, [initialSuggestions]);

		const onSubmit = useMemo(
			() => async (message: string, onEchoPainted?: () => void) => {
				// Assembled by the same function the composer compares against, so the
				// string sent, stored, guarded and reasoned about by the copy is one
				// string on the reply path too. Building the prefix inline here put it
				// downstream of every comparison and deadlocked Restore - see
				// `buildSendPayload`.
				const accepted = await onSendMessage(
					buildSendPayload(message, replies),
					attachments.map((a) => a.path),
					onEchoPainted,
					// The typed text, beside the composed payload: the gate answer path
					// resolves an option ordinal against THIS, never against the string
					// the reply prefix produced.
					message,
				);
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
				if (conversationId) {
					clearReplies(conversationId);
					clearAttachments(conversationId);
				}
			},
			[
				onSendMessage,
				attachments,
				replies,
				conversationId,
				clearReplies,
				clearAttachments,
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
		});

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
		const slash = useSlashCompletion({
			inputValue: newMessage,
			selectionStart: caret,
			sessionId: slashSessionId,
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
		// biome-ignore lint/correctness/useExhaustiveDependencies: the value is the trigger, the ref is what is written
		useLayoutEffect(() => {
			const field = textareaRef.current;
			const at = pendingCaret.current;
			if (!field || at === null) return;
			pendingCaret.current = null;
			field.setSelectionRange(at, at);
		}, [newMessage, textareaRef]);

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
			(draft: string, at: number) =>
				planSlashSubmission({
					draft,
					caret: at,
					commandNames: slash.commandNames,
					promptCommands: slash.promptCommands,
					nameListCommands: slash.nameListCommands,
					enabled: slash.available && Boolean(onSlashCommand),
				}),
			[
				slash.commandNames,
				slash.promptCommands,
				slash.nameListCommands,
				slash.available,
				onSlashCommand,
			],
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
					pendingCaret.current = plan.caret;
					setNewMessage(plan.text);
					setCaret(plan.caret);
					onSlashNote?.(`Staged ${plan.text.trim()}. Enter again runs it.`);
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
				pendingCaret.current = completion.caret;
				setNewMessage(completion.text);
				setCaret(completion.caret);
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
				 * instead of only completing the word. The keyboard never runs a command
				 * row - `handleSlashKeyDown` hands every one of them `run: false` - so
				 * that half is the pointer path only.
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
				const plan = planFor(completion.text, completion.caret);
				if (plan.kind === "send") return;
				await applyPlan(plan, newMessage, caret);
			},
			[
				newMessage,
				caret,
				slash,
				setNewMessage,
				onSlashCommand,
				planFor,
				applyPlan,
			],
		);
		// biome-ignore lint/correctness/useExhaustiveDependencies: `textareaRef.current` is read at event time, not at render time - the caret position only has meaning for the keypress being handled, so listing the ref's current value as a dependency would rebuild this handler on every caret move while still reading the same live node.
		const handleComposerKeyDown = useCallback(
			(event: KeyboardEvent<HTMLTextAreaElement>) => {
				if (handleSlashKeyDown(event, slash, handleSlashPick)) {
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
				 */
				if (
					event.key === "Enter" &&
					!event.shiftKey &&
					!event.nativeEvent.isComposing
				) {
					const plan = planFor(newMessage, caret);
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
				handleKeyDown,
				planFor,
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

		useImperativeHandle(ref, () => ({
			focusInput: () => {
				/*
				 * Handing focus over is the moment the box becomes ours again, so a
				 * pointer interaction from BEFORE this call stops counting as the
				 * user's. See `composerPointerTouched`.
				 */
				composerPointerTouched = false;
				textareaRef.current?.focus();
			},
			openWorkingDirectoryMenu: () => {
				cwdChipRef.current?.openMenu();
			},
		}));

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
			 * The SAME planner the Enter key consults, so the Send button and the
			 * key cannot disagree about whether a draft is a command — and every
			 * non-`send` verdict is applied here, so the message path below is only
			 * ever reached for prose. It does not re-examine the text: that is what
			 * turned `/usage` on line 1 into a command that claimed line 2.
			 */
			const plan = planFor(newMessage, caret);
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

		const handleSuggestionClick = async (suggestion: string) => {
			if (isInputDisabled) return;
			const accepted = await onSendMessage(
				suggestion,
				attachments.map((a) => a.path),
			);
			if (accepted === false) return;
			if (conversationId) {
				clearAttachments(conversationId);
			}
			setNewMessage("");
		};

		const shortcutText = useMemo(() => {
			if (platform === "darwin") {
				return "Cmd+Shift+S";
			}
			return "Ctrl+Shift+S";
		}, [platform]);

		const handleRemoveReply = (replyId: string) => {
			if (conversationId) {
				removeReply(conversationId, replyId);
			}
		};

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
		 * Whether the empty-chat prompt belongs in the band.
		 *
		 * Derived here rather than written into the JSX so the wrapper below does not
		 * have to repeat the condition three times: the wrapper is always rendered and
		 * only the prompt's presence is conditional. See the wrapper's own comment for
		 * why that matters (QA round 1, Q4 - focus dropped to `<body>` when a press on
		 * the plan chip narrowed the column across `isSmallView`).
		 */
		const showEmptyChatPrompt =
			messages.length === 0 && !isHydrating && !isSmallView;

		const inputContent = (
			<form onSubmit={handleSubmit} className="w-full">
				{/*
				 * The session's status row, ABOVE the alert and therefore above the box:
				 * `docs/composer-status-tabs.md` § 2.1. The alert is a transient failure
				 * that points at the composer; this row is persistent ambient context, so
				 * it sits outboard of the transient one. Band order, top to bottom: row,
				 * alert, box.
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
				<div
					className={cn(
						COMPOSER_BOX,
						isSmallView ? "gap-2 rounded-md p-2" : "gap-3 rounded-frame p-4",
						CHAT_MEASURE,
						// The slash popup anchors above this box without shifting it.
						"relative",
					)}
					data-tour-tag="chat-input-textarea"
				>
					{/*
					 * The popup is a CHILD of this box and renders `absolute
					 * bottom-full`, i.e. deliberately outside the box's content area,
					 * above it. It is NOT portaled, unlike the Radix menus and
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
						<textarea
							ref={textareaRef}
							className={cn(
								"w-full resize-none overflow-y-auto bg-transparent",
								"text-ink outline-none placeholder:text-ink-dim",
								// The disabled state STEPS COLOUR rather than fading
								// (branding: disabled changes colour, never opacity), and
								// without this the only signal was `cursor: not-allowed`
								// after the user had already typed into a field that will
								// not accept anything.
								"disabled:text-ink-disabled disabled:placeholder:text-ink-disabled",
								isSmallView
									? "max-h-24 px-1.5 py-1 text-body-sm"
									: "max-h-28 px-2 py-1.5 text-body",
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
								// Only the empty -> non-empty edge: the whole point is one
								// statement of intent per composed message, and the
								// consumer's latch should not be asked to absorb a
								// per-character call it can only discard.
								if (!newMessage && e.target.value) onComposerInput?.();
								setNewMessage(e.target.value);
								setCaret(e.target.selectionStart);
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
								if (Date.now() - alertShownAt.current >= ALERT_READ_DWELL_MS)
									sendError?.onDismiss?.();
							}}
							onSelect={(e) =>
								setCaret((e.target as HTMLTextAreaElement).selectionStart)
							}
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
							aria-expanded={slash.open}
							aria-controls={slash.open ? slash.listId : undefined}
							aria-activedescendant={slash.activeDescendantId ?? undefined}
						/>
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

				{messages.length === 0 && !isHydrating && !isSmallView && (
					<div className={cn("mt-6", CHAT_MEASURE)}>
						{/* Neutral chips. Twelve accent-washed pills was the accent
						 * budget spent four times over on the one screen that has no
						 * content to compete with them; as quiet outlines they read as
						 * what they are — examples, not the primary action. Raycast and
						 * Linear's command palettes hold suggestions at exactly this
						 * weight. */}
						<div className="flex flex-wrap justify-center gap-2">
							{suggestions.map((suggestion) => (
								<Button
									key={suggestion}
									variant="outline"
									size="sm"
									className="h-auto max-w-full whitespace-normal break-words px-3 py-1 text-body-sm text-ink-muted hover:bg-elevated hover:text-ink"
									onClick={() => handleSuggestionClick(suggestion)}
									disabled={isInputDisabled || isRecording || isTranscribing}
								>
									{suggestion}
								</Button>
							))}
						</div>
					</div>
				)}
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
					messages.length === 0 && !isHydrating ? "grow" : "shrink-0",
					// The horizontal inset is the SHARED one and is the same at every
					// width, because it is half of a shared edge: see
					// `CHAT_COLUMN_INSET`. Only the VERTICAL padding compacts in the
					// small view -- vertical space is what a short window is short of,
					// and compacting it moves no edge the transcript also owns.
					CHAT_COLUMN_INSET,
					isSmallView ? "pb-1 pt-0.5" : "pb-4 pt-2",
				)}
				data-lo-composer-band={true}
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
				 */}
				<div
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
