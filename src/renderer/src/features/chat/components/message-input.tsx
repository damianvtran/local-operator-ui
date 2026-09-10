import { TranscriptionApi } from "@shared/api/local-operator/transcription-api";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { Button, Skeleton, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config/api-config";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import { useMessageInput } from "@shared/hooks/use-message-input";
import {
	SpeechToTextPriority,
	useSpeechToTextManager,
} from "@shared/hooks/use-speech-to-text-manager";
import { cn } from "@shared/lib/utils";
import {
	type Attachment,
	type Reply,
	useConversationInputStore,
} from "@shared/store/conversation-input-store";
import { normalizePath } from "@shared/utils/path-utils";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Check, Mic, Paperclip, Send, Square, X } from "lucide-react";
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
import {
	CHAT_COLUMN_CONTAINER,
	CHAT_COLUMN_INSET,
	CHAT_MEASURE,
} from "../chat-measure";
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
};

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
			initialSuggestions,
			agentData,
			cwd,
			onChangeCwd,
			isSmallView = false,
			isHydrating = false,
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
				let messageWithReplies = message;
				if (replies.length > 0) {
					const replyContent = replies
						.map((r) => `<reply-to>${r.text}</reply-to>`)
						.join("\n");
					messageWithReplies = `${replyContent}\n${message}`;
				}
				const accepted = await onSendMessage(
					messageWithReplies,
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
					// `bg-surface`, not `bg-canvas`. `canvas` is the PAGE ground and
					// `surface` is the panel ground, so painting canvas inside the
					// surface-coloured chat column ran the elevation step backwards and
					// read as a hole punched through the panel to the page behind it.
					// On an empty chat this band holds the greeting, the composer and
					// the suggestion chips, so it covered most of the column - which is
					// the "large empty space with the wrong background colour". The
					// composer box keeps its own `border-control` edge (floored at 3:1
					// on all four grounds), so it stays legible without the band.
					//
					// `shrink-0` alone: `grow` on the same element contradicted it and
					// became actively harmful once the transcript stopped declaring
					// `h-full`, because the band would then claim the column's free
					// space instead of leaving it to the transcript.
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
					"flex w-full shrink-0 flex-col items-center justify-center bg-surface",
					// The horizontal inset is the SHARED one and is the same at every
					// width, because it is half of a shared edge: see
					// `CHAT_COLUMN_INSET`. Only the VERTICAL padding compacts in the
					// small view -- vertical space is what a short window is short of,
					// and compacting it moves no edge the transcript also owns.
					CHAT_COLUMN_INSET,
					isSmallView ? "pb-1 pt-0.5" : "pb-4 pt-2",
				)}
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
