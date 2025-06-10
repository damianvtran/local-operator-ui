import {
	Box,
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
import type { AgentEditFileRequest } from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import { useConfig } from "@shared/hooks/use-config";
import { useCredentials } from "@shared/hooks/use-credentials";
import { normalizePath } from "@shared/utils/path-utils";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { Check, Mic, Paperclip, Send, X } from "lucide-react";
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
import { AttachmentsPreview } from "../attachments-preview";
import { AudioRecordingIndicator } from "../audio-recording-indicator";
import { WaveformAnimation } from "../waveform-animation";

type InlineEditProps = {
	selection: string;
	position: { top: number; left: number };
	filePath: string;
	onClose: () => void;
	onApplyChanges: (newContent: string) => void;
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
		scrollbarWidth: "thin",
		scrollbarColor: `${alpha(theme.palette.text.primary, 0.5)} transparent`,
		/* Firefox */
		"&::-webkit-scrollbar": {
			width: "8px",
			height: "8px",
		},
		"&::-webkit-scrollbar-track": {
			background: "transparent",
		},
		"&::-webkit-scrollbar-thumb": {
			backgroundColor: alpha(theme.palette.text.primary, 0.5),
			borderRadius: "4px",
		},
		"&::-webkit-scrollbar-thumb:hover": {
			backgroundColor: alpha(theme.palette.text.primary, 0.7),
		},
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

export const InlineEdit: FC<InlineEditProps> = ({
	selection,
	position,
	filePath,
	onClose,
	onApplyChanges,
}) => {
	const [prompt, setPrompt] = useState("");
	const [attachments, setAttachments] = useState<string[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const { lastChatAgentId } = useAgentSelectionStore();
	const { data: config } = useConfig();

	const [isRecording, setIsRecording] = useState(false);
	const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const spacebarTimerRef = useRef<NodeJS.Timeout | null>(null);
	const [platform, setPlatform] = useState("");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const textareaRef = useRef<HTMLInputElement>(null);

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
			return "Cmd+Shift+S";
		}
		return "Ctrl+Shift+S";
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

			window.addEventListener("keydown", handleKeyDown);

			return () => {
				window.removeEventListener("keydown", handleKeyDown);
			};
		}

		return undefined;
	}, [isRecording, handleConfirmRecording, handleCancelRecording]);

	useEffect(() => {
		const handleStartSpeechToText = (): void => {
			if (
				!isLoading &&
				!isRecording &&
				!isTranscribing &&
				canEnableRecordingFeature
			) {
				handleStartRecording();
			}
		};
		window.electron.ipcRenderer.on(
			"start-speech-to-text",
			handleStartSpeechToText,
		);

		return () => {
			window.electron.ipcRenderer.removeListener(
				"start-speech-to-text",
				handleStartSpeechToText,
			);
		};
	}, [
		canEnableRecordingFeature,
		handleStartRecording,
		isLoading,
		isRecording,
		isTranscribing,
	]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.code !== "Space" || spacebarTimerRef.current) {
				return;
			}

			const activeElement = document.activeElement as HTMLElement;
			if (
				activeElement &&
				(activeElement.tagName === "INPUT" ||
					activeElement.tagName === "TEXTAREA" ||
					activeElement.isContentEditable)
			) {
				return;
			}

			if (isRecording || isTranscribing || !canEnableRecordingFeature) {
				return;
			}

			event.preventDefault();

			spacebarTimerRef.current = setTimeout(() => {
				handleStartRecording();
			}, 1000);
		};

		const handleKeyUp = (event: KeyboardEvent): void => {
			if (event.code !== "Space") {
				return;
			}

			if (spacebarTimerRef.current) {
				clearTimeout(spacebarTimerRef.current);
				spacebarTimerRef.current = null;
			}

			if (isRecording) {
				handleConfirmRecording();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
			if (spacebarTimerRef.current) {
				clearTimeout(spacebarTimerRef.current);
			}
		};
	}, [
		isRecording,
		isTranscribing,
		canEnableRecordingFeature,
		handleStartRecording,
		handleConfirmRecording,
	]);

	const triggerFileInput = () => {
		fileInputRef.current?.click();
	};

	const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files.length > 0) {
			const newAttachments = Array.from(e.target.files).map((file) => {
				const filePath = file.path;
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
				if (
					items[i].type.indexOf("image") !== -1 ||
					items[i].kind === "file"
				) {
					const file = items[i].getAsFile();
					if (file) {
						const reader = new FileReader();
						reader.onload = (e) => {
							if (e.target?.result) {
								setAttachments((prev) => [
									...prev,
									e.target?.result as string,
								]);
							}
						};
						reader.readAsDataURL(file);
					}
				}
			}
		}
	};

	const handleSubmit = useCallback(async () => {
		if (!lastChatAgentId) {
			showSuccessToast("Please select an agent first.");
			return;
		}
		setIsLoading(true);
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

			const response = await client.chat.editFileWithAgent(
				lastChatAgentId,
				request,
			);

			if (response.result) {
				const originalContent = await window.api.readFile(filePath);
				if (originalContent.success) {
					let newContent = originalContent.data;
					for (const diff of response.result.edit_diffs) {
						newContent = newContent.replace(diff.find, diff.replace);
					}
					onApplyChanges(newContent);
					showSuccessToast("File edited successfully!");
				}
			}
		} catch (error) {
			console.error("Failed to edit file:", error);
			showSuccessToast("Failed to edit file.");
		} finally {
			setIsLoading(false);
			onClose();
		}
	}, [
		config,
		filePath,
		prompt,
		selection,
		attachments,
		lastChatAgentId,
		onApplyChanges,
		onClose,
	]);

	const iconSize = 18;

	return (
		<InputInnerContainer
			elevation={4}
			sx={{
				top: position.top,
				left: 0,
				transform: "translateY(calc(-100% - 8px))",
			}}
		>
			<CloseButton onClick={onClose} disabled={isLoading}>
				<X size={18} />
			</CloseButton>

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
					placeholder="Describe your edit..."
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					onPaste={handlePaste}
					disabled={isLoading}
					inputRef={textareaRef}
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
							disabled={isLoading || isRecording || isTranscribing}
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
					{!isRecording && !isTranscribing && (
						<Tooltip title={isLoading ? "Editing..." : "Edit"}>
							<div>
								<SendButton
									onClick={handleSubmit}
									disabled={isLoading || (!prompt.trim() && attachments.length === 0)}
								>
									<Send size={iconSize} />
								</SendButton>
							</div>
						</Tooltip>
					)}
				</Box>
			</ButtonsRow>
		</InputInnerContainer>
	);
};
