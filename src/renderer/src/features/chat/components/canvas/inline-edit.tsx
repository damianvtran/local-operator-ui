import {
	Box,
	Button,
	CircularProgress,
	IconButton,
	Paper,
	TextField,
	Tooltip,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import { TranscriptionApi } from "@shared/api/local-operator/transcription-api";
import type {
	AgentEditFileRequest,
	EditDiff,
} from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config";
import { useConfig } from "@shared/hooks/use-config";
import { useCredentials } from "@shared/hooks/use-credentials";
import {
	SpeechToTextPriority,
	useSpeechToTextManager,
} from "@shared/hooks/use-speech-to-text-manager";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import { normalizePath } from "@shared/utils/path-utils";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import {
	Check,
	ChevronLeft,
	ChevronRight,
	Mic,
	Paperclip,
	Send,
	Square,
	X,
} from "lucide-react";
import {
	type ChangeEvent,
	type ClipboardEvent,
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { AttachmentsPreview } from "../attachments-preview";
import { AudioRecordingIndicator } from "../audio-recording-indicator";
import { WaveformAnimation } from "../waveform-animation";

type InlineEditProps = {
	selection: string;
	position: { top: number; left: number };
	filePath: string;
	onClose: () => void;
	onApplyChanges: (editDiffs: EditDiff[]) => void;
	agentId?: string;
	reviewState: {
		diffs: EditDiff[];
		currentIndex: number;
		approvedDiffs: EditDiff[];
	} | null;
	onApplyAll: () => void;
	onRejectAll: () => void;
	onAcceptDiff: () => void;
	onRejectDiff: () => void;
	onNavigateDiff: (direction: "next" | "prev") => void;
};

const InputInnerContainer = styled(Paper)(({ theme }) => ({
	position: "absolute",
	zIndex: 1300, // Ensure it's above other elements
	width: 500,
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(1.5),
	outline: "none",
	borderRadius: theme.shape.borderRadius * 2,
	border: `1px solid ${theme.palette.divider}`,
	backgroundColor: theme.palette.background.paper,
	backgroundImage: "none",
	padding: theme.spacing(1),
	transition: "box-shadow 0.2s ease-in-out, outline 0.2s ease-in-out",
	boxSizing: "border-box",
}));

const CloseButton = styled(IconButton)(({ theme }) => ({
	position: "absolute",
	top: theme.spacing(1),
	right: theme.spacing(1),
	width: 28,
	height: 28,
	zIndex: 1301,
	color: theme.palette.text.secondary,
	"&:hover": {
		backgroundColor: alpha(theme.palette.action.hover, 0.1),
		color: theme.palette.text.primary,
	},
}));

const StyledTextField = styled(TextField)(({ theme }) => ({
	flex: 1,
	"& .MuiOutlinedInput-root": {
		backgroundColor: "transparent",
		padding: "4px 6px",
		fontSize: "0.875rem",
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
		fontSize: "0.875rem",
		color:
			theme.palette.mode === "light"
				? alpha(theme.palette.text.secondary, 0.7)
				: alpha(theme.palette.text.secondary, 0.5),
		opacity: 1,
	},
}));

const ButtonsRow = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: theme.spacing(1),
	padding: 0,
}));

const AttachmentButton = styled(IconButton)(({ theme }) => ({
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.primary.main, 0.1)
			: alpha(theme.palette.primary.main, 0.15),
	color: theme.palette.primary.main,
	width: 28,
	height: 28,
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

const SendButton = styled(IconButton)(({ theme }) => ({
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.primary.main, 0.1)
			: alpha(theme.palette.primary.main, 0.15),
	color: theme.palette.primary.main,
	width: 28,
	height: 28,
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

const ReviewHeader = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	justifyContent: "space-between",
	padding: theme.spacing(0.5, 2, 1, 1),
	gap: theme.spacing(1),
	height: "64px",
}));

const ReviewPrompt = styled(Typography)(({ theme }) => ({
	flexGrow: 1,
	fontSize: "0.875rem",
	color: theme.palette.text.secondary,
}));

export const InlineEdit: FC<InlineEditProps> = ({
	selection,
	position,
	filePath,
	onClose,
	onApplyChanges,
	agentId,
	reviewState,
	onApplyAll,
	onRejectAll,
	onAcceptDiff,
	onRejectDiff,
	onNavigateDiff,
}) => {
	const [prompt, setPrompt] = useState("");
	const [attachments, setAttachments] = useState<string[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const { lastChatAgentId } = useAgentSelectionStore();
	const { data: config } = useConfig();
	const agentToUse = agentId || lastChatAgentId;

	const [isRecording, setIsRecording] = useState(false);
	const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const [platform, setPlatform] = useState("");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const textareaRef = useRef<HTMLInputElement>(null);
	const isCancelledRef = useRef(false);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.focus();
		}
	}, []);

	// Handle escape key to close inline edit
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				if (isLoading) {
					handleCancelEdit();
				} else if (reviewState) {
					onRejectAll();
				} else if (!isRecording && !isTranscribing) {
					onClose();
				}
			}

			if (reviewState) {
				if (event.metaKey || event.ctrlKey) {
					if (event.key === "Enter") {
						event.preventDefault();
						onApplyAll();
					}
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [
		onClose,
		isLoading,
		isRecording,
		isTranscribing,
		reviewState,
		onApplyAll,
		onRejectAll,
	]);

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

	const shortcutText = useMemo(() => {
		if (platform === "darwin") {
			return "⌘+Shift+S";
		}
		return "Ctrl+Shift+S";
	}, [platform]);

	const acceptAllTooltipText = useMemo(() => {
		if (platform === "darwin") {
			return "Apply All (⌘+Enter)";
		}
		return "Apply All (Ctrl+Enter)";
	}, [platform]);

	const acceptAllShortcut = useMemo(() => {
		if (platform === "darwin") {
			return "⌘+Enter";
		}
		return "Ctrl+Enter";
	}, [platform]);

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

	const handleCancelEdit = useCallback(() => {
		isCancelledRef.current = true;
		setIsLoading(false);
		onClose();
	}, [onClose]);

	const handleXClick = useCallback(() => {
		if (isLoading) {
			handleCancelEdit();
		} else {
			onClose();
		}
	}, [isLoading, handleCancelEdit, onClose]);

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
				setPrompt((p) => p + newText);
			}
			setAudioBlob(null); // Clear the blob after sending
		} catch (error) {
			console.error("Error transcribing audio:", error);
			showErrorToast("Error transcribing audio. Please try again.");
		} finally {
			setIsTranscribing(false);
		}
	}, [audioBlob]);

	useEffect(() => {
		if (audioBlob) {
			handleSendAudio();
		}
	}, [audioBlob, handleSendAudio]);

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

	// Register with speech-to-text manager
	useSpeechToTextManager(
		"inline-edit",
		SpeechToTextPriority.INLINE_EDIT,
		handleStartRecording,
		() =>
			Boolean(
				!isLoading &&
					!isRecording &&
					!isTranscribing &&
					canEnableRecordingFeature,
			),
	);

	const triggerFileInput = () => {
		fileInputRef.current?.click();
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
			setAttachments((prev) => [...prev, ...newAttachments]);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		}
	};

	const handleRemoveAttachment = (index: number) => {
		setAttachments((prev) => {
			const newAttachments = [...prev];
			if (newAttachments[index].startsWith("blob:")) {
				URL.revokeObjectURL(newAttachments[index]);
			}
			newAttachments.splice(index, 1);
			return newAttachments;
		});
	};

	const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
		const items = event.clipboardData?.items;
		if (items) {
			for (let i = 0; i < items.length; i++) {
				if (items[i].type.indexOf("image") !== -1 || items[i].kind === "file") {
					const file = items[i].getAsFile();
					if (file) {
						const reader = new FileReader();
						reader.onload = (e) => {
							if (e.target?.result) {
								setAttachments((prev) => [...prev, e.target?.result as string]);
							}
						};
						reader.readAsDataURL(file);
					}
				}
			}
		}
	};

	const handleSubmit = useCallback(async () => {
		if (!agentToUse) {
			showErrorToast("Please select an agent first.");
			return;
		}
		setIsLoading(true);
		isCancelledRef.current = false; // Reset on new submission
		try {
			const client = createLocalOperatorClient(apiConfig.baseUrl);
			const request: AgentEditFileRequest = {
				hosting: config?.values.hosting || "default",
				model: config?.values.model_name || "default",
				file_path: filePath,
				edit_prompt: prompt,
				selection,
				attachments,
			};

			const response = await client.chat.editFileWithAgent(agentToUse, request);

			if (isCancelledRef.current) {
				return;
			}

			if (response.result && response.result.edit_diffs.length > 0) {
				onApplyChanges(response.result.edit_diffs);
			} else {
				showSuccessToast("No changes were needed.");
				onClose();
			}
		} catch (error) {
			if (!isCancelledRef.current) {
				console.error("Failed to edit file:", error);
				showErrorToast("Failed to edit file.");
			}
		} finally {
			setIsLoading(false);
		}
	}, [
		config,
		filePath,
		prompt,
		selection,
		attachments,
		agentToUse,
		onClose,
		onApplyChanges,
	]);

	const iconSize = 18;

	const containerHeight = containerRef.current?.offsetHeight || 0;
	const showAbove = position.top > containerHeight + 10;

	return (
		<InputInnerContainer
			ref={containerRef}
			elevation={4}
			sx={{
				top: Math.max(0, position.top),
				left: position.left,
				transform: showAbove
					? "translateY(calc(-100% - 8px))"
					: "translateY(8px)",
			}}
		>
			<CloseButton onClick={handleXClick} disabled={isLoading}>
				<X size={18} />
			</CloseButton>

			{reviewState ? (
				<ReviewHeader>
					<ReviewPrompt>
						{prompt ||
							`Reviewing Changes (${reviewState.currentIndex + 1}/${
								reviewState.diffs.length
							})`}
					</ReviewPrompt>
					<Box sx={{ width: "100%", display: "flex", alignItems: "center", gap: 1, justifyContent: "flex-end" }}>
						<Tooltip title="Previous">
							<span>
								<IconButton
									onClick={() => onNavigateDiff("prev")}
									size="small"
									disabled={reviewState.currentIndex === 0}
								>
									<ChevronLeft size={14} />
								</IconButton>
							</span>
						</Tooltip>
						<Tooltip title="Next">
							<span>
								<IconButton
									onClick={() => onNavigateDiff("next")}
									size="small"
									disabled={
										reviewState.currentIndex >= reviewState.diffs.length - 1
									}
								>
									<ChevronRight size={14} />
								</IconButton>
							</span>
						</Tooltip>
						<Box sx={{ borderLeft: 1, borderColor: "divider", height: 18, mx: 0.5 }} />
						<Tooltip title="Reject this change">
							<IconButton onClick={onRejectDiff} color="error" size="small">
								<X size={14} />
							</IconButton>
						</Tooltip>
						<Tooltip title="Accept this change">
							<IconButton onClick={onAcceptDiff} color="success" size="small">
								<Check size={14} />
							</IconButton>
						</Tooltip>
						<Box sx={{ borderLeft: 1, borderColor: "divider", height: 18, mx: 0.5 }} />
						<Tooltip title="Reject All (Esc)">
							<Button
								onClick={onRejectAll}
								color="error"
								size="small"
								startIcon={<KeyboardShortcut shortcut="Esc" />}
								sx={{ textTransform: "none", fontSize: "0.8rem", padding: "2px 4px", whiteSpace: "nowrap" }}
							>
								Reject All
							</Button>
						</Tooltip>
						<Tooltip title={acceptAllTooltipText}>
							<Button
								onClick={onApplyAll}
								color="success"
								size="small"
								startIcon={<KeyboardShortcut shortcut={acceptAllShortcut} />}
								sx={{ textTransform: "none", fontSize: "0.8rem", padding: "2px 4px", whiteSpace: "nowrap" }}
							>
								Accept All
							</Button>
						</Tooltip>
					</Box>
				</ReviewHeader>
			) : (
				<>
					{attachments.length > 0 && (
						<AttachmentsPreview
							attachments={attachments}
							onRemoveAttachment={handleRemoveAttachment}
							disabled={isLoading || isRecording || isTranscribing}
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
							multiline
							maxRows={8}
							placeholder="Ask for an edit..."
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							onPaste={handlePaste}
							disabled={isLoading}
							inputRef={textareaRef}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									if (prompt.trim() || attachments.length > 0) {
										handleSubmit();
									}
								}
							}}
						/>
					)}
					<ButtonsRow>
						<Box display="flex" alignItems="center" gap={1}>
							<input
								type="file"
								ref={fileInputRef}
								onChange={handleFileSelect}
								style={{ display: "none" }}
								disabled={isLoading || isRecording || isTranscribing}
								multiple
							/>
							<Tooltip title="Add attachments">
								<AttachmentButton
									onClick={triggerFileInput}
									disabled={
										isLoading || isRecording || isTranscribing || !!reviewState
									}
								>
									<Paperclip size={iconSize} />
								</AttachmentButton>
							</Tooltip>
						</Box>

						<Box display="flex" alignItems="center" gap={1}>
							{!isRecording && !isTranscribing && !isLoading && (
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
											<Mic size={iconSize} />
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
							{!isRecording && !isTranscribing && !isLoading && (
								<Tooltip title="Edit">
									<div>
										<SendButton
											onClick={handleSubmit}
											disabled={!prompt.trim() && attachments.length === 0}
										>
											<Send size={iconSize} />
										</SendButton>
									</div>
								</Tooltip>
							)}
							{isLoading && (
								<Tooltip title="Cancel Edit">
									<Box sx={{ position: "relative", display: "inline-flex" }}>
										<CircularProgress
											size={28}
											sx={{
												color: (theme) =>
													alpha(theme.palette.primary.main, 0.5),
												position: "absolute",
												transform: "translate(-50%, -50%)",
												transformOrigin: "center",
											}}
										/>
										<IconButton
											onClick={handleCancelEdit}
											color="primary"
											aria-label="Cancel edit"
											sx={{ width: 28, height: 28 }}
										>
											<Square size={14} />
										</IconButton>
									</Box>
								</Tooltip>
							)}
						</Box>
					</ButtonsRow>
				</>
			)}
		</InputInnerContainer>
	);
};
