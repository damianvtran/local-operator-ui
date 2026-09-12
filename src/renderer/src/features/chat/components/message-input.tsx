import { TranscriptionApi } from "@shared/api/local-operator/transcription-api";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { ErrorBoundary } from "@shared/components/common/error-boundary";
import { Button, Skeleton, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config/api-config";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import { useMessageInput } from "@shared/hooks/use-message-input";
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
	useMemo,
	useRef,
	useState,
} from "react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import { v4 as uuidv4 } from "uuid";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import {
	CHAT_COLUMN_CONTAINER,
	CHAT_COLUMN_INSET,
	CHAT_MEASURE,
} from "../chat-measure";
import { SessionStatusStrip } from "../session-status/session-status-strip";
import type { Message } from "../types/message";
import { AttachmentsPreview } from "./attachments-preview";
import { AudioRecordingIndicator } from "./audio-recording-indicator";
import { DirectoryIndicator } from "./directory-indicator";
import { ReplyPreview } from "./reply-preview";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import {
	type SlashCommandMeta,
	SlashSuggestionsPopup,
	completeSlashToken,
	handleSlashKeyDown,
	useSlashCommands,
} from "./slash-commands";
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
	actions?: { label: string; onClick: () => void }[];
	/**
	 * The exact payload the store will hold the next send to, when it is holding
	 * one. Supplied rather than described so the composer can put it back: the
	 * guard wants a byte-identical retry of a message that is no longer on
	 * screen, which is not something a user can reproduce by hand.
	 */
	heldText?: string;
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
	) => undefined | boolean | Promise<undefined | boolean>;
	isLoading: boolean;
	conversationId?: string;
	messages: Message[];
	currentJobId?: string | null;
	onCancelJob?: (jobId: string) => void;
	isFarFromBottom?: boolean;
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
	 * `onChangeCwd` is present only while the session is still a draft: a cwd is
	 * fixed at `sessions.create` and the backend exposes no way to move a live
	 * one, so the chip renders read-only once the session exists rather than
	 * offering a control that cannot succeed.
	 */
	cwd?: string;
	onChangeCwd?: (cwd: string) => void;
	isSmallView?: boolean;
	/**
	 * History has not resolved yet, so "no messages" is not yet a FACT.
	 * The empty state is a claim about the conversation; making it before the
	 * transcript loads is how a populated chat flashed "no messages yet" and
	 * then repainted (design D7).
	 */
	isHydrating?: boolean;
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
		onCommand?: (line: string) => void;
	};
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
 * Type for the imperative handle to expose focusInput method
 */
export type MessageInputHandle = {
	focusInput: () => void;
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
			conversationId,
			messages,
			currentJobId,
			onCancelJob,
			isFarFromBottom = false,
			hasNewActivity = false,
			scrollToBottom = () => {},
			canonicalStop,
			sendError,
			initialSuggestions,
			agentData,
			cwd,
			onChangeCwd,
			isSmallView = false,
			isHydrating = false,
			sessionStatus,
		},
		ref,
	) => {
		/*
		 * The canonical session's cwd is the answer where there is one; the legacy
		 * agent record is the fallback so the old backend path keeps its chip.
		 */
		const cwdToShow = cwd ?? agentData?.current_working_directory;
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
			() => async (message: string) => {
				// Assembled by the same function the composer compares against, so the
				// string sent, stored, guarded and reasoned about by the copy is one
				// string on the reply path too. Building the prefix inline here put it
				// downstream of every comparison and deadlocked Restore - see
				// `buildSendPayload`.
				const accepted = await onSendMessage(
					buildSendPayload(message, replies),
					attachments.map((a) => a.path),
				);
				if (accepted === false) return false;
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
		const slash = useSlashCommands(newMessage, caret);
		const slashListId = slash.listId;
		const handleSlashPick = useCallback(
			(command: SlashCommandMeta) => {
				setNewMessage(
					completeSlashToken(
						newMessage,
						slash.tokenEnd,
						command.name,
						command.arguments,
					),
				);
				slash.close();
			},
			[newMessage, slash, setNewMessage],
		);
		const handleComposerKeyDown = useCallback(
			(event: KeyboardEvent<HTMLTextAreaElement>) => {
				if (handleSlashKeyDown(event, slash, handleSlashPick)) {
					event.preventDefault();
					return;
				}
				handleKeyDown(event);
			},
			[slash, handleSlashPick, handleKeyDown],
		);

		useImperativeHandle(ref, () => ({
			focusInput: () => {
				textareaRef.current?.focus();
			},
		}));

		const isInputDisabled = Boolean(isLoading && currentJobId);

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

		const inputContent = (
			<form onSubmit={handleSubmit} className="w-full">
				{(abandonNotice ||
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
							"flex max-h-32 flex-col gap-1 overflow-y-auto text-body-sm text-danger",
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
							 */
							<p className={cn("text-ink-muted")}>
								An unsent message is still being held, so a different message
								cannot be sent yet.
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
					<SlashSuggestionsPopup
						state={slash}
						onPick={handleSlashPick}
						anchorRef={textareaRef}
					/>
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
								isSmallView
									? "max-h-24 px-1.5 py-1 text-body-sm"
									: "max-h-28 px-2 py-1.5 text-body",
							)}
							placeholder={
								isInputDisabled ? "Agent is busy" : "Ask me for help"
							}
							value={newMessage}
							onChange={(e) => {
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
							onPaste={handlePaste}
							rows={1}
							disabled={isInputDisabled}
							aria-label="Message"
							role="combobox"
							aria-expanded={slash.open}
							aria-controls={slash.open ? slashListId : undefined}
							aria-activedescendant={
								slash.open && slash.matches[slash.active]
									? `${slashListId}-${slash.matches[slash.active].name}`
									: undefined
							}
						/>
					)}

					{/*
					 * The session's readings, on their own row above the controls.
					 *
					 * Its own row rather than four more items in the button row below:
					 * that row is already over budget at the 220px column floor (see
					 * the working-directory chip's shrink notes, design round 2 D11),
					 * and these four readings describe the SESSION where the row below
					 * describes the message being composed. A crash in the strip must
					 * not take the composer down with it — the readings are metadata
					 * and the ability to type is not — so it renders inside an error
					 * boundary with an empty fallback: a missing strip is a degradation
					 * a user can work through, and a fallback panel here would be a
					 * bigger interruption than the thing it reports.
					 */}
					{sessionStatus && (
						<ErrorBoundary fallback={null}>
							<SessionStatusStrip
								frontend={sessionStatus.frontend}
								onCommand={sessionStatus.onCommand}
							/>
						</ErrorBoundary>
					)}

					{/* § 2 budgets the accent at about three spends per screen and the
					 * composer was taking three on its own — attach, microphone and
					 * send — before the suggestion chips added a dozen more. Send is
					 * the primary action and keeps it; the two secondary tools are
					 * neutral until you reach for them. */}
					<div className="flex min-w-0 items-center justify-between gap-2">
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
						 */}
						<div className="flex min-w-0 items-center gap-1">
							<Tooltip content="Attach file">
								<span>
									<Button
										variant="ghost"
										size={isSmallView ? "icon-sm" : "icon"}
										className="text-ink-dim hover:bg-elevated hover:text-ink"
										onClick={handleAttachFile}
										aria-label="Attach file"
										data-tour-tag="chat-input-attach-file-button"
										disabled={isInputDisabled || isRecording || isTranscribing}
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
									currentWorkingDirectory={cwdToShow}
									onChangeDirectory={onChangeCwd}
									readOnlyReason={
										onChangeCwd
											? undefined
											: "Working directory is set when the session starts and cannot be changed afterwards. Start a new chat to use a different folder."
									}
								/>
							)}
						</div>

						{/* Right side: microphone, send or stop button */}
						<div className="flex items-center gap-1">
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
					messages.length === 0 ? "grow" : "shrink-0",
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
				{messages.length === 0 && isHydrating && !isSmallView ? (
					// Hydrating: we do not yet know whether this conversation is
					// empty, so neither the greeting nor a transcript can be
					// asserted. Suppressing the greeting alone left the pane BLANK
					// (design D22) -- correct but mute, and on a slow or remote
					// backend that blankness is the whole first impression. A
					// skeleton in the greeting's own place says "loading" without
					// claiming which of the two answers is coming.
					<div className="flex w-full flex-col items-center justify-center gap-6 py-4">
						{/* `<output>` rather than a div with role="status": it carries
						 * the same implicit live-region semantics as a native element,
						 * which is what the a11y lint asks for. */}
						<output
							className="flex w-full flex-col items-center gap-3"
							aria-label="Loading conversation"
						>
							<Skeleton className="h-7 w-64" />
							<span className="sr-only">Loading conversation…</span>
						</output>
						{inputContent}
					</div>
				) : messages.length === 0 && !isSmallView ? (
					<div className="flex w-full flex-col items-center justify-center gap-6 py-4">
						<h2 className="text-center text-ink text-title">
							What can I help you with today?
						</h2>
						{inputContent}
					</div>
				) : (
					inputContent
				)}
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
