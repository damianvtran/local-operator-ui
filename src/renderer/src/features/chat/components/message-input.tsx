import { TranscriptionApi } from "@shared/api/local-operator/transcription-api";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { Button, Tooltip } from "@shared/components/ui";
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
import type { ClipboardEvent, FormEvent } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Message } from "../types/message";
import { AttachmentsPreview } from "./attachments-preview";
import { AudioRecordingIndicator } from "./audio-recording-indicator";
import { DirectoryIndicator } from "./directory-indicator";
import { ReplyPreview } from "./reply-preview";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import { WaveformAnimation } from "./waveform-animation";

/**
 * Props for the MessageInput component
 */
type MessageInputProps = {
	onSendMessage: (content: string, attachments: string[]) => void;
	isLoading: boolean;
	conversationId?: string;
	messages: Message[];
	currentJobId?: string | null;
	onCancelJob?: (jobId: string) => void;
	isFarFromBottom?: boolean;
	scrollToBottom?: () => void;
	initialSuggestions?: string[];
	agentData?: AgentDetails | null;
	isSmallView?: boolean;
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
			scrollToBottom = () => {},
			initialSuggestions,
			agentData,
			isSmallView = false,
		},
		ref,
	) => {
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
			() => (message: string) => {
				let messageWithReplies = message;
				if (replies.length > 0) {
					const replyContent = replies
						.map((r) => `<reply-to>${r.text}</reply-to>`)
						.join("\n");
					messageWithReplies = `${replyContent}\n${message}`;
				}
				onSendMessage(
					messageWithReplies,
					attachments.map((a) => a.path),
				);
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
				console.error("This browser cannot record audio");
				showErrorToast("Audio recording is not supported on your browser.");
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
				const handleKeyDown = (event: KeyboardEvent) => {
					if (event.key === "Enter") {
						event.preventDefault();
						handleConfirmRecording();
					} else if (event.key === "Escape") {
						event.preventDefault();
						handleCancelRecording();
					}
				};

				const handleKeyUp = (event: KeyboardEvent) => {
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

		const handleSuggestionClick = (suggestion: string) => {
			if (isInputDisabled) return;
			onSendMessage(
				suggestion,
				attachments.map((a) => a.path),
			);
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

		const iconSize = isSmallView ? 16 : 18;

		const inputContent = (
			<form onSubmit={handleSubmit} className="w-full">
				<div
					className={cn(
						COMPOSER_BOX,
						isSmallView ? "gap-2 rounded-md p-2" : "gap-3 rounded-frame p-4",
						"w-full max-w-full sm:max-w-[90%] md:max-w-[900px]",
					)}
					data-tour-tag="chat-input-textarea"
				>
					{replies.length > 0 && (
						<ReplyPreview replies={replies} onRemoveReply={handleRemoveReply} />
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
							onChange={(e) => setNewMessage(e.target.value)}
							onKeyDown={handleKeyDown}
							onPaste={handlePaste}
							rows={1}
							disabled={isInputDisabled}
							aria-label="Message"
						/>
					)}

					{/* § 2 budgets the accent at about three spends per screen and the
					 * composer was taking three on its own — attach, microphone and
					 * send — before the suggestion chips added a dozen more. Send is
					 * the primary action and keeps it; the two secondary tools are
					 * neutral until you reach for them. */}
					<div className="flex items-center justify-between gap-2">
						{/* Left side: attachment button */}
						<div className="flex items-center gap-1">
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
										<Paperclip size={iconSize} aria-hidden="true" />
									</Button>
								</span>
							</Tooltip>
							{conversationId && (
								<DirectoryIndicator
									agentId={conversationId}
									currentWorkingDirectory={agentData?.current_working_directory}
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
												<Mic size={iconSize} aria-hidden="true" />
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
												<Check size={iconSize} aria-hidden="true" />
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
												<X size={iconSize} aria-hidden="true" />
											</Button>
										</span>
									</Tooltip>
								</>
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
											<Square size={iconSize} aria-hidden="true" />
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
												<Send
													size={Math.round(iconSize * 0.8)}
													aria-hidden="true"
												/>
											</Button>
										</span>
									</Tooltip>
								)
							)}
						</div>
					</div>
				</div>

				{messages.length === 0 && !isSmallView && (
					<div className="mx-auto mt-6 w-full max-w-full sm:max-w-[90%] md:max-w-[900px]">
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
					"flex w-full shrink-0 grow flex-col items-center justify-center bg-canvas",
					isSmallView ? "px-1 pb-1 pt-0.5" : "px-4 pb-4 pt-2",
				)}
			>
				{messages.length === 0 && !isSmallView ? (
					<div className="flex w-full flex-col items-center justify-center gap-6 p-4">
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
				/>
			</div>
		);
	},
);

MessageInput.displayName = "MessageInput";
