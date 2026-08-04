import { createLocalOperatorClient } from "@shared/api/local-operator";
import { TranscriptionApi } from "@shared/api/local-operator/transcription-api";
import type {
	AgentEditFileRequest,
	EditDiff,
} from "@shared/api/local-operator/types";
import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { Spinner } from "@shared/components/common/spinner";
import { Button, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { useConfig } from "@shared/hooks/use-config";
import { useCredentials } from "@shared/hooks/use-credentials";
import {
	SpeechToTextPriority,
	useSpeechToTextManager,
} from "@shared/hooks/use-speech-to-text-manager";
import { cn } from "@shared/lib/utils";
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

/*
 * The popover is hand-positioned against a CodeMirror selection rectangle by
 * the caller, so it stays an absolutely-positioned element rather than moving
 * onto the `Popover` primitive — Radix would want an anchor element that does
 * not exist here. `z-[1300]` is kept verbatim: it has to clear the editor's own
 * layers and the canvas chrome, and no role token covers that.
 *
 * It is a genuine floating overlay, so it is the one place in this file that
 * earns `shadow-overlay`, on `elevated` above the editor's ground.
 */
const POPOVER = cn(
	"absolute z-[1300] box-border flex flex-col gap-3",
	"rounded-lg border border-hairline bg-elevated p-2 shadow-overlay",
	// This panel is the prompt field's visible frame, so it draws the field's
	// focus ring and the textarea suppresses its own - a ring inside this
	// border would read as a second frame. Scoped to `textarea` on purpose:
	// the panel also holds buttons, and ringing the whole panel when a button
	// takes focus would point at the wrong thing. `outline-solid` is required
	// because `outline-none` on the textarea pins `--tw-outline-style: none`.
	"has-[textarea:focus-visible]:outline-solid has-[textarea:focus-visible]:outline-2",
	"has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2",
);

/*
 * The review bar is narrower than the prompt. The prompt is a text field and
 * wants the room; the review bar sits on top of the very text it is asking you
 * to judge, so every pixel of width is a pixel of the change it hides.
 */
const POPOVER_PROMPT_WIDTH = "w-125";
const POPOVER_REVIEW_WIDTH = "w-90";

/*
 * The shortcut caps carry their own 10px glyphs; the button's `[&_svg]:size-3.5`
 * would inflate them to icon size, so the caps opt back out.
 */
const SHORTCUT_BUTTON = cn("whitespace-nowrap [&_svg]:size-2.5");

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
	const textareaRef = useRef<HTMLTextAreaElement>(null);
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
			return "Apply all (⌘+Enter)";
		}
		return "Apply all (Ctrl+Enter)";
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

	const handleAttachFile = async () => {
		const result = await window.electron.ipcRenderer.invoke(
			"show-open-dialog",
			{
				properties: ["openFile", "multiSelections"],
			},
		);

		if (!result.canceled && result.filePaths.length > 0) {
			const newAttachments = result.filePaths.map((path: string) =>
				normalizePath(path),
			);
			setAttachments((prev) => [...prev, ...newAttachments]);
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

	const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
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

	const containerHeight = containerRef.current?.offsetHeight || 0;
	const showAbove = position.top > containerHeight + 10;

	return (
		<div
			ref={containerRef}
			className={cn(
				POPOVER,
				reviewState ? POPOVER_REVIEW_WIDTH : POPOVER_PROMPT_WIDTH,
			)}
			style={{
				top: Math.max(0, position.top),
				left: position.left,
				transform: showAbove
					? "translateY(calc(-100% - 8px))"
					: "translateY(8px)",
			}}
		>
			{reviewState ? (
				<div className={cn("flex flex-col gap-2 p-1")}>
					{/*
					 * Row one: where you are, and what you have already decided.
					 *
					 * The count used to be a parenthetical inside a muted sentence —
					 * the quietest thing in the only approval interaction the app
					 * has. It is now the subject, at reading weight.
					 */}
					<div className={cn("flex items-center gap-3")}>
						<p className={cn("shrink-0 font-medium text-body-sm text-ink")}>
							Change {reviewState.currentIndex + 1} of{" "}
							{reviewState.diffs.length}
						</p>
						{/*
						 * One segment per change, carrying the decision already made
						 * on it. Accepts are recorded in `approvedDiffs`; anything
						 * behind the cursor that is not in there was rejected, so
						 * every segment's state is derivable rather than tracked
						 * twice. This is the only place the running tally exists.
						 *
						 * The current segment is twice as thick as the rest, because
						 * in the two brand palettes `accent` and `success` are both
						 * green and hue alone would not separate "reviewing this
						 * one" from "accepted that one". Undecided segments take
						 * `control` rather than `hairline`: hairline is decorative
						 * and has no contrast floor, and a progress track nobody can
						 * see is not a progress track.
						 */}
						<ol
							aria-label="Review progress"
							className={cn(
								"flex h-2 min-w-0 max-w-40 flex-1 items-center gap-1",
							)}
						>
							{reviewState.diffs.map((diff, index) => {
								const isCurrent = index === reviewState.currentIndex;
								const isDecided = index < reviewState.currentIndex;
								const isAccepted =
									isDecided && reviewState.approvedDiffs.includes(diff);
								const state = isCurrent
									? "Reviewing now"
									: isAccepted
										? "Accepted"
										: isDecided
											? "Rejected"
											: "Not reviewed yet";
								return (
									<li
										// biome-ignore lint/suspicious/noArrayIndexKey: a diff is a plain find/replace pair with no id, and two identical replacements in one response are legitimate; position is the only stable identity.
										key={index}
										aria-label={`Change ${index + 1}: ${state}`}
										className={cn(
											"min-w-2 flex-1 rounded-full",
											isCurrent ? "h-1 bg-accent" : "h-0.5",
											isAccepted && "bg-success",
											isDecided && !isAccepted && "bg-danger",
											!isCurrent && !isDecided && "bg-control",
										)}
									/>
								);
							})}
						</ol>
						<Tooltip content="Stop reviewing">
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Stop reviewing"
								onClick={handleXClick}
								className={cn("shrink-0")}
							>
								<X aria-hidden="true" />
							</Button>
						</Tooltip>
					</div>

					{/*
					 * Row two: the decision on the change in front of you.
					 *
					 * These two are the primary actions — you take one of them once
					 * per change — so they are labelled buttons, not a bare ✓ and ✕
					 * you have to hover to identify. Accept is the affirmative
					 * default and takes the accent; reject is the danger triple,
					 * which is a red-bordered control rather than a red slab.
					 */}
					<div className={cn("flex items-center justify-between gap-2")}>
						<div className={cn("flex items-center gap-0.5")}>
							<Tooltip content="Previous change">
								<span>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="Previous change"
										onClick={() => onNavigateDiff("prev")}
										disabled={reviewState.currentIndex === 0}
									>
										<ChevronLeft aria-hidden="true" />
									</Button>
								</span>
							</Tooltip>
							<Tooltip content="Next change">
								<span>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="Next change"
										onClick={() => onNavigateDiff("next")}
										disabled={
											reviewState.currentIndex >= reviewState.diffs.length - 1
										}
									>
										<ChevronRight aria-hidden="true" />
									</Button>
								</span>
							</Tooltip>
						</div>
						<div className={cn("flex items-center gap-2")}>
							<Button variant="danger" size="sm" onClick={onRejectDiff}>
								<X aria-hidden="true" />
								Reject
							</Button>
							<Button variant="primary" size="sm" onClick={onAcceptDiff}>
								<Check aria-hidden="true" />
								Accept
							</Button>
						</div>
					</div>

					{/*
					 * Row three: the escape hatches, deliberately subordinate.
					 *
					 * Deciding all three at once is the shortcut, not the job, so it
					 * reads at caption weight below the per-change pair rather than
					 * as the two largest buttons in the popover. Only these two have
					 * key bindings, so only these two wear caps.
					 */}
					<div
						className={cn(
							"flex items-center justify-end gap-1 border-hairline border-t pt-1.5",
						)}
					>
						<Button
							variant="ghost"
							size="sm"
							onClick={onRejectAll}
							className={SHORTCUT_BUTTON}
						>
							<KeyboardShortcut shortcut="Esc" />
							Reject all
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={onApplyAll}
							aria-label={acceptAllTooltipText}
							className={SHORTCUT_BUTTON}
						>
							<KeyboardShortcut shortcut={acceptAllShortcut} />
							Accept all
						</Button>
					</div>
				</div>
			) : (
				<>
					<Tooltip content="Close">
						<span className={cn("absolute top-2 right-2 z-[1301]")}>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Close"
								onClick={handleXClick}
								disabled={isLoading}
							>
								<X aria-hidden="true" />
							</Button>
						</span>
					</Tooltip>
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
						<div
							className={cn(
								"flex min-h-[50px] flex-1 items-center justify-center gap-2 px-4 py-2",
							)}
						>
							<span
								className={cn("mr-1 font-medium text-body-sm text-ink-muted")}
							>
								Processing audio
							</span>
							<WaveformAnimation />
						</div>
					) : (
						<textarea
							ref={textareaRef}
							className={cn(
								// `pr-9` keeps the first line clear of the absolutely
								// positioned close control, which used to sit on top of
								// whatever was typed.
								"w-full resize-none overflow-y-auto bg-transparent py-1 pr-9 pl-1.5",
								"max-h-40 text-body-sm text-ink outline-none",
								"placeholder:text-ink-dim disabled:text-ink-disabled",
							)}
							rows={1}
							placeholder="Ask for an edit"
							aria-label="Edit instructions"
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							onPaste={handlePaste}
							disabled={isLoading}
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
					<div className={cn("flex items-center justify-between gap-2")}>
						<div className={cn("flex items-center gap-2")}>
							<Tooltip content="Add attachments">
								<span>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="Add attachments"
										className={cn(
											"text-accent hover:bg-accent-wash hover:text-accent",
										)}
										onClick={handleAttachFile}
										disabled={
											isLoading ||
											isRecording ||
											isTranscribing ||
											!!reviewState
										}
									>
										<Paperclip aria-hidden="true" />
									</Button>
								</span>
							</Tooltip>
						</div>

						<div className={cn("flex items-center gap-2")}>
							{!isRecording && !isTranscribing && !isLoading && (
								<Tooltip
									content={
										!canEnableRecordingFeature
											? "Sign in to Radient in the settings page to enable audio recording"
											: `Start recording (${shortcutText} or hold Space)`
									}
								>
									<span>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Start recording"
											className={cn(
												"text-accent hover:bg-accent-wash hover:text-accent",
											)}
											onClick={handleStartRecording}
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
												size="icon-sm"
												aria-label="Confirm recording"
												className={cn(
													"text-success hover:bg-success-wash hover:text-success",
												)}
												onClick={handleConfirmRecording}
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
												size="icon-sm"
												aria-label="Cancel recording"
												className={cn(
													"text-danger hover:bg-danger-wash hover:text-danger",
												)}
												onClick={handleCancelRecording}
												disabled={isLoading}
											>
												<X aria-hidden="true" />
											</Button>
										</span>
									</Tooltip>
								</>
							)}
							{!isRecording && !isTranscribing && !isLoading && (
								<Tooltip content="Edit">
									<span>
										<Button
											variant="primary"
											size="icon-sm"
											aria-label="Edit"
											onClick={handleSubmit}
											disabled={!prompt.trim() && attachments.length === 0}
										>
											<Send aria-hidden="true" />
										</Button>
									</span>
								</Tooltip>
							)}
							{isLoading && (
								<>
									<Spinner size="sm" label="Editing" />
									<Tooltip content="Cancel edit">
										<span>
											<Button
												variant="danger"
												size="icon-sm"
												aria-label="Cancel edit"
												onClick={handleCancelEdit}
											>
												<Square aria-hidden="true" />
											</Button>
										</span>
									</Tooltip>
								</>
							)}
						</div>
					</div>
				</>
			)}
		</div>
	);
};
