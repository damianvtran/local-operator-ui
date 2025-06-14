import { faPaperPlane, faPaperclip } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	IconButton,
	TextField,
	Tooltip,
	Typography,
	alpha,
	darken,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { TranscriptionApi } from "@shared/api/local-operator/transcription-api";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config/api-config";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useMessageInput } from "@shared/hooks/use-message-input";
import {
	SpeechToTextPriority,
	useSpeechToTextManager,
} from "@shared/hooks/use-speech-to-text-manager";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { normalizePath } from "@shared/utils/path-utils";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Check, Mic, Square, X } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ChangeEvent, ClipboardEvent, FormEvent } from "react";
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

/**
 * Type for the imperative handle to expose focusInput method
 */
export type MessageInputHandle = {
	focusInput: () => void;
};

/**
 * Outer container that wraps the entire input area
 */
const InputOuterContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isSmallView",
})<{ isSmallView?: boolean }>(({ theme, isSmallView }) => ({
	width: "100%",
	flexGrow: 1,
	flexShrink: 0,
	minHeight: 0,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	padding: isSmallView ? theme.spacing(0.5) : theme.spacing(1),
	paddingLeft: isSmallView ? theme.spacing(1) : theme.spacing(2),
	paddingRight: isSmallView ? theme.spacing(1) : theme.spacing(2),
	paddingBottom: isSmallView ? theme.spacing(1) : theme.spacing(2),
	backgroundColor: theme.palette.messagesView.background,
}));

/**
 * Constrains the input area to the same max width as messages
 * and centers it horizontally
 *
 * When the text input inside is focused, increase border thickness and style
 * without changing the container size by using outline instead of border change
 */
const InputInnerContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isSmallView",
})<{ isSmallView?: boolean }>(({ theme, isSmallView }) => ({
	width: "100%",
	maxWidth: "900px",
	margin: "0 auto",
	display: "flex",
	flexDirection: "column",
	gap: isSmallView ? theme.spacing(1) : theme.spacing(1.5),
	outline: "none",
	borderRadius: isSmallView
		? theme.shape.borderRadius * 2
		: theme.shape.borderRadius * 4,
	border: `1px solid ${alpha(theme.palette.divider, theme.palette.mode === "light" ? 0.3 : 0.1)}`,
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.background.paper, 0.9)
			: alpha(theme.palette.background.paper, 0.6),
	padding: isSmallView ? theme.spacing(1) : theme.spacing(2),
	transition: "box-shadow 0.2s ease-in-out, outline 0.2s ease-in-out",
	boxSizing: "border-box",
	[theme.breakpoints.down("sm")]: {
		maxWidth: "100%",
	},
	[theme.breakpoints.between("sm", "md")]: {
		maxWidth: "90%",
	},
	[theme.breakpoints.up("md")]: {
		maxWidth: "900px",
	},
	// When the input inside is focused, add an outline instead of increasing border thickness
	"&:has(.MuiOutlinedInput-root.Mui-focused)": {
		outline: `2px solid ${theme.palette.primary.main}`,
		outlineOffset: "0px",
		boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.2)}`,
	},
}));

const SuggestionsContainer = styled(Box)(({ theme }) => ({
	width: "100%",
	maxWidth: "900px",
	margin: "0 auto",
	marginTop: theme.spacing(4),
	[theme.breakpoints.down("sm")]: {
		maxWidth: "100%",
	},
	[theme.breakpoints.between("sm", "md")]: {
		maxWidth: "90%",
	},
	[theme.breakpoints.up("md")]: {
		maxWidth: "900px",
	},
}));

/**
 * Styled suggestion chip button
 */
const SuggestionChip = styled(Button)(({ theme }) => ({
	borderRadius: 999,
	textTransform: "none",
	fontSize: "0.85rem",
	paddingLeft: theme.spacing(1.5),
	paddingRight: theme.spacing(1.5),
	paddingTop: theme.spacing(0.5),
	paddingBottom: theme.spacing(0.5),
	whiteSpace: "normal", // allow wrapping instead of nowrap
	wordBreak: "break-word", // break long words if needed
	variant: "outlined",
	size: "small",
	maxWidth: "100%", // ensure chip doesn't overflow container
	...(theme.palette.mode === "light" && {
		backgroundColor: alpha(theme.palette.primary.main, 0.15),
		color: darken(theme.palette.primary.main, 0.4),
		borderColor: alpha(theme.palette.primary.main, 0.5),
		"&:hover": {
			backgroundColor: alpha(theme.palette.primary.main, 0.25),
			borderColor: alpha(theme.palette.primary.main, 0.7),
		},
	}),
}));

/**
 * Styled text input with no visible border
 *
 * This component customizes the MUI TextField to remove all borders,
 * including the default outlined border, focused border, and hover border.
 *
 * Also customizes the scrollbar appearance when multiline text causes overflow.
 */
const StyledTextField = styled(TextField, {
	shouldForwardProp: (prop) => prop !== "isSmallView",
})<{ isSmallView?: boolean }>(({ theme, isSmallView }) => ({
	flex: 1,
	"& .MuiOutlinedInput-root": {
		backgroundColor: "transparent",
		padding: isSmallView ? "4px 6px" : "6px 8px",
		fontSize: isSmallView ? "0.9rem" : "1rem",
		display: "flex",
		alignItems: "center",
		"& fieldset": {
			border: "none",
		},
		"&:hover fieldset": {
			border: "none",
		},
		"&.Mui-focused fieldset": {
			border: "none",
		},
		"&.Mui-focused": {
			backgroundColor: "transparent",
			boxShadow: "none",
		},
		"&:hover": {
			backgroundColor: "transparent",
		},
	},
	"& .MuiInputBase-input": {
		color: theme.palette.text.primary,
		overflowY: "auto",
	},
	"& .MuiInputBase-input::placeholder": {
		color:
			theme.palette.mode === "light"
				? alpha(theme.palette.text.secondary, 0.7)
				: alpha(theme.palette.text.secondary, 0.5),
		opacity: 1,
	},
}));

/**
 * Container for buttons below the input
 */
const ButtonsRow = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: theme.spacing(1),
}));

/**
 * Styled attachment button
 */
const AttachmentButton = styled(IconButton, {
	shouldForwardProp: (prop) => prop !== "isSmallView",
})<{ isSmallView?: boolean }>(({ theme, isSmallView }) => ({
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.primary.main, 0.1)
			: alpha(theme.palette.primary.main, 0.15),
	color: theme.palette.primary.main,
	width: isSmallView ? 32 : 40,
	height: isSmallView ? 32 : 40,
	borderRadius: "100%",
	transition: "all 0.2s ease-in-out",
	"&:hover": {
		backgroundColor:
			theme.palette.mode === "light"
				? alpha(theme.palette.primary.main, 0.2)
				: alpha(theme.palette.primary.main, 0.25),
		transform: "scale(1.1)",
	},
	"&:active": {
		transform: "scale(1)",
	},
	"&.Mui-disabled": {
		backgroundColor: alpha(theme.palette.action.disabled, 0.1),
		color: theme.palette.action.disabled,
	},
}));

/**
 * Styled send/stop button
 */
const SendButton = styled(Button, {
	shouldForwardProp: (prop) => prop !== "isSmallView",
})<{ isSmallView?: boolean }>(({ theme, isSmallView }) => ({
	minWidth: isSmallView ? 32 : 40,
	height: isSmallView ? 32 : 40,
	borderRadius: "100%",
	padding: 0,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	transition: "all 0.2s ease-in-out",
	"&:hover": {
		transform: "scale(1.1)",
	},
	"&:active": {
		transform: "scale(1)",
	},
	"&.Mui-disabled": {
		backgroundColor: alpha(theme.palette.action.disabled, 0.1),
		color: alpha(theme.palette.common.white, 0.5),
	},
}));

/**
 * Container for empty state with title and centered input
 */
const EmptyStateContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	padding: theme.spacing(4),
	gap: theme.spacing(2),
}));

/**
 * Styled empty state title text
 */
const EmptyStateTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.25rem",
	fontWeight: 500,
	color: theme.palette.text.secondary,
	textAlign: "center",
	marginBottom: theme.spacing(1),
	[theme.breakpoints.up("sm")]: {
		fontSize: "1.5rem",
		marginBottom: theme.spacing(2),
	},
}));

/**
 * Styled transcription loading indicator
 */
const TranscriptionIndicator = styled(Box)(({ theme }) => ({
	flex: 1,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	minHeight: "50px",
	padding: theme.spacing(1, 2),
	borderRadius: theme.shape.borderRadius,
	color: theme.palette.primary.dark,
	gap: theme.spacing(1),
}));

const TranscriptionText = styled(Typography)(({ theme }) => ({
	fontSize: "0.875rem",
	fontWeight: 500,
	marginRight: theme.spacing(1.5),
	color: theme.palette.text.secondary,
}));

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
		const {
			inputByConversation,
			removeReply,
			clearReplies,
			addAttachment,
			removeAttachment,
			clearAttachments,
		} = useConversationInputStore();
		const replies = useMemo(
			() =>
				(conversationId && inputByConversation[conversationId]?.replies) || [],
			[inputByConversation, conversationId],
		);
		const attachments = useMemo(
			() =>
				(conversationId && inputByConversation[conversationId]?.attachments) ||
				[],
			[inputByConversation, conversationId],
		);
		const [isRecording, setIsRecording] = useState(false);
		const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
		const [isTranscribing, setIsTranscribing] = useState(false);
		const mediaRecorderRef = useRef<MediaRecorder | null>(null);
		const audioChunksRef = useRef<Blob[]>([]);
		const [platform, setPlatform] = useState("");

		const fileInputRef = useRef<HTMLInputElement>(null);

		const { data: credentialsData, isLoading: isLoadingCredentials } =
			useCredentials();

		const isRadientApiKeyConfigured = useMemo(
			() => credentialsData?.keys?.includes("RADIENT_API_KEY"),
			[credentialsData?.keys],
		);

		const canEnableRecordingFeature = useMemo(
			() => isRadientApiKeyConfigured && !isLoadingCredentials,
			[isRadientApiKeyConfigured, isLoadingCredentials],
		);

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
				console.error("getUserMedia not supported on your browser!");
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

		const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
			if (e.target.files && e.target.files.length > 0) {
				const newAttachments = Array.from(e.target.files).map((file) => {
					const filePath = file.name;
					if (filePath) {
						return normalizePath(filePath);
					}
					return URL.createObjectURL(file);
				});
				if (conversationId) {
					for (const path of newAttachments) {
						addAttachment(conversationId, { id: uuidv4(), path });
					}
				}
				if (fileInputRef.current) {
					fileInputRef.current.value = "";
				}
			}
		};

		const handleRemoveAttachment = (id: string) => {
			if (conversationId) {
				removeAttachment(conversationId, id);
			}
		};

		const triggerFileInput = () => {
			fileInputRef.current?.click();
		};

		const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
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
			<form onSubmit={handleSubmit} style={{ width: "100%" }}>
				<InputInnerContainer isSmallView={isSmallView}>
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
						<TranscriptionIndicator>
							<TranscriptionText variant="body2">
								Processing audio
							</TranscriptionText>
							<WaveformAnimation />
						</TranscriptionIndicator>
					) : (
						<StyledTextField
							fullWidth
							placeholder={
								isInputDisabled ? "Agent is busy" : "Ask me for help"
							}
							isSmallView={isSmallView}
							value={newMessage}
							onChange={(e) => setNewMessage(e.target.value)}
							onKeyDown={handleKeyDown}
							onPaste={handlePaste}
							multiline
							maxRows={4}
							variant="outlined"
							inputRef={textareaRef}
							disabled={isInputDisabled}
							inputProps={{
								"data-tour-tag": "chat-input-textarea",
							}}
						/>
					)}

					<ButtonsRow>
						{/* Left side: attachment button */}
						<Box display="flex" alignItems="center" gap={1}>
							<input
								type="file"
								ref={fileInputRef}
								onChange={handleFileSelect}
								style={{ display: "none" }}
								disabled={isInputDisabled || isRecording || isTranscribing}
								multiple
							/>
							<Tooltip title="Attach file">
								<span>
									<AttachmentButton
										onClick={triggerFileInput}
										color="primary"
										size="small"
										aria-label="Attach file"
										data-tour-tag="chat-input-attach-file-button"
										disabled={isInputDisabled || isRecording || isTranscribing}
										isSmallView={isSmallView}
									>
										<FontAwesomeIcon icon={faPaperclip} fontSize={iconSize} />
									</AttachmentButton>
								</span>
							</Tooltip>
							{conversationId && (
								<DirectoryIndicator
									agentId={conversationId}
									currentWorkingDirectory={agentData?.current_working_directory}
								/>
							)}
						</Box>

						{/* Right side: microphone, send or stop button */}
						<Box display="flex" alignItems="center" gap={1}>
							{!isRecording &&
								!isTranscribing &&
								!(isLoading && currentJobId) && (
									<Tooltip
										title={
											!canEnableRecordingFeature
												? "Sign in to Radient in the settings page to enable audio recording"
												: `Start recording (${shortcutText} or hold Space)`
										}
									>
										<span>
											<IconButton
												onClick={handleStartRecording}
												color="primary"
												size="small"
												aria-label="Start recording"
												disabled={isLoading || !canEnableRecordingFeature}
											>
												<Mic
													size={iconSize * 1.1}
													style={{
														width: iconSize * 1.4,
														height: iconSize * 1.4,
														padding: "2px",
													}}
												/>
											</IconButton>
										</span>
									</Tooltip>
								)}
							{isRecording && (
								<>
									<Tooltip title="Confirm recording (Enter)">
										<span>
											<IconButton
												onClick={handleConfirmRecording}
												color="success"
												size="small"
												aria-label="Confirm recording"
												disabled={isLoading}
											>
												<Check size={iconSize} />
											</IconButton>
										</span>
									</Tooltip>
									<Tooltip title="Cancel recording (Esc)">
										<span>
											<IconButton
												onClick={handleCancelRecording}
												color="error"
												size="small"
												aria-label="Cancel recording"
												disabled={isLoading}
											>
												<X size={iconSize} />
											</IconButton>
										</span>
									</Tooltip>
								</>
							)}
							{isLoading && currentJobId ? (
								<Tooltip title="Stop agent">
									<span>
										<SendButton
											type="button"
											variant="contained"
											color="error"
											onClick={() => onCancelJob?.(currentJobId)}
											aria-label="Stop agent"
											isSmallView={isSmallView}
										>
											<Square size={iconSize} />
										</SendButton>
									</span>
								</Tooltip>
							) : (
								!isRecording &&
								!isTranscribing && (
									<Tooltip title="Send message">
										<span>
											<SendButton
												type="submit"
												variant="contained"
												color="primary"
												disabled={
													isLoading ||
													(!newMessage.trim() && attachments.length === 0)
												}
												aria-label="Send message"
												isSmallView={isSmallView}
											>
												<FontAwesomeIcon
													icon={faPaperPlane}
													fontSize={iconSize * 0.8}
												/>
											</SendButton>
										</span>
									</Tooltip>
								)
							)}
						</Box>
					</ButtonsRow>
				</InputInnerContainer>

				{messages.length === 0 && !isSmallView && (
					<SuggestionsContainer>
						<Box
							sx={{
								display: "flex",
								flexWrap: "wrap",
								gap: 1,
								marginTop: 1.5,
								justifyContent: "center",
							}}
						>
							{suggestions.map((suggestion) => (
								<SuggestionChip
									key={suggestion}
									variant="outlined"
									size="small"
									onClick={() => handleSuggestionClick(suggestion)}
									disabled={isInputDisabled || isRecording || isTranscribing}
								>
									{suggestion}
								</SuggestionChip>
							))}
						</Box>
					</SuggestionsContainer>
				)}
			</form>
		);

		return (
			<InputOuterContainer isSmallView={isSmallView}>
				{messages.length === 0 && !isSmallView ? (
					<EmptyStateContainer>
						<EmptyStateTitle variant="h6">
							What can I help you with today?
						</EmptyStateTitle>
						{inputContent}
					</EmptyStateContainer>
				) : (
					inputContent
				)}
				<ScrollToBottomButton
					visible={isFarFromBottom}
					onClick={scrollToBottom}
					bottomDistance={isSmallView ? 120 : 160}
				/>
			</InputOuterContainer>
		);
	},
);

MessageInput.displayName = "MessageInput";
