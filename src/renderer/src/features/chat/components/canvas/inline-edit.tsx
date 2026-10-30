import { createLocalOperatorClient } from "@shared/api/local-operator";
import { TranscriptionApi } from "@shared/api/local-operator/transcription-api";
import {
	emptyTranscriptionMessage,
	isTransientTranscriptionFailure,
	transcriptionFailureMessage,
	transcriptionFailureRowMessage,
} from "@shared/api/local-operator/transcription-failure";
import type {
	AgentEditFileRequest,
	EditDiff,
} from "@shared/api/local-operator/types";
import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { Spinner } from "@shared/components/common/spinner";
import { Button, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { useConfig } from "@shared/hooks/use-config";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import { joinTranscript } from "@shared/hooks/use-message-input";
import { useRecordingShortcutLabel } from "@shared/hooks/use-recording-shortcut";
import {
	SpeechToTextPriority,
	resolvePushToTalkBinding,
	setDictationActive,
	useSpeechToTextManager,
} from "@shared/hooks/use-speech-to-text-manager";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { speechUnavailableReason } from "@shared/lib/speech-gate";
import { cn } from "@shared/lib/utils";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import type { Attachment } from "@shared/store/conversation-input-store";
import { normalizePath } from "@shared/utils/path-utils";
import {
	showErrorToast,
	showInfoToast,
	showSuccessToast,
} from "@shared/utils/toast-manager";
import {
	Check,
	ChevronLeft,
	ChevronRight,
	CircleAlert,
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

/**
 * A take short enough to hold no words is discarded rather than transcribed -
 * the same floor the composer applies: both doors speak the manager's
 * `{ start, stop }` contract, and a release that beats `getUserMedia` settles
 * into a ~0 ms take, so "discard" is the only outcome that does not ship an
 * empty request for a press that captured nothing.
 */
const MIN_DICTATION_CLIP_MS = 250;

/**
 * The take in flight, and the marks a release or abort can leave on it before
 * the recorder exists.
 */
type RecordingAttempt = {
	startedAt: number | null;
	released: boolean;
	aborted: boolean;
};

type InlineEditProps = {
	selection: string;
	position: { top: number; left: number };
	filePath: string;
	fileContent: string;
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
 * The shortcut caps carry their own glyph size — `KeyboardShortcut` draws icons at
 * the 12px its text is set in — and the button's own `[&_svg]:size-3.5` (14px,
 * from `Button`'s `sm` size) would inflate them to the button's icon slot. The
 * override is scoped to the caps rather than to the button, so anything else the
 * button may render later still takes the button's own size; and it matches the
 * cap's own 12px rather than the 10px this used to force, which is the size the
 * shared component was raised to (design round 1, D5 — "one cap size" did not
 * hold on this surface while the selector pinned 10).
 */
const SHORTCUT_BUTTON = cn("whitespace-nowrap [&_kbd_svg]:size-3");

export const InlineEdit: FC<InlineEditProps> = ({
	selection,
	position,
	filePath,
	fileContent,
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
	useI18nLocale();
	const [prompt, setPrompt] = useState("");
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const { lastChatAgentId } = useAgentSelectionStore();
	const { data: config } = useConfig();
	const agentToUse = agentId || lastChatAgentId;

	const [isRecording, setIsRecording] = useState(false);
	const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
	const [isTranscribing, setIsTranscribing] = useState(false);
	/**
	 * THE TAKE THAT OUTLIVED ITS FAILURE (#1087), canvas side.
	 *
	 * `audioBlob` is cleared only on success, so after a failure the bytes needed
	 * to try again are still in hand - but until now the only thing that said so
	 * was a toast, which dismisses, and nothing on the surface could spend them.
	 * The operator was left re-recording a take the app already had.
	 *
	 * `dictationFailure` is that offer's copy and `dictationRetry` is the nudge
	 * that re-arms it. A retry is the first attempt's own path - the effect below
	 * re-runs `handleSendAudio` from the retained blob - never a second send path
	 * beside it, which is the rule the composer states and keeps for the same
	 * reason: two send paths drifted into two retry bursts on the #1087 rig.
	 */
	const [dictationFailure, setDictationFailure] = useState<string | null>(null);
	const [dictationRetry, setDictationRetry] = useState(0);
	/*
	 * THE BURST BELONGS TO THIS POPOVER (#1087 review round 1, F4). Closing the
	 * editor unmounts it and aborts the controller; a newer send supersedes it.
	 * Without this the burst kept issuing requests after the editor was gone and
	 * applied the transcript to state nothing was showing.
	 */
	const transcriptionAbortRef = useRef<AbortController | null>(null);
	useEffect(
		() => () => {
			transcriptionAbortRef.current?.abort();
		},
		[],
	);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const [platform, setPlatform] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const isCancelledRef = useRef(false);
	const containerRef = useRef<HTMLDivElement>(null);
	/**
	 * The take in flight: the ONE recorder this component owns, plus the marks a
	 * release or abort can leave on it before the recorder exists.
	 *
	 * WHY THE ATTEMPT IS A REF AND NOT THE STATE HANDLERS (review round 1, M1).
	 * The first shape queued a release in a boolean and consumed it by calling
	 * `handleConfirmRecording()` from `handleStartRecording`'s own closure - the
	 * instance created with `deps: [canEnableRecordingFeature]`, whose
	 * `isRecording` is `false` forever - so the consume was a NO-OP: the recorder
	 * started and kept going, and only a manual Confirm/Cancel ended it. The
	 * abort arm was equally dead: it called `handleCancelRecording()`, whose
	 * guard is also `isRecording` (false until the recorder is up), so an abort
	 * before the start did nothing at all. Settling BY THE REF means the outcome
	 * does not depend on a render having happened: a mark left on the attempt is
	 * read back the moment `start()` returns, whatever a closure remembers.
	 */
	const recordingAttemptRef = useRef<RecordingAttempt | null>(null);

	useEffect(() => {
		setDictationActive("canvas-inline-edit", isRecording);
		return () => setDictationActive("canvas-inline-edit", false);
	}, [isRecording]);

	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.focus();
		}
	}, []);

	// Handle escape key to close inline edit
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			/* Whatever is layered on top of this has first claim on Escape.
			   Radix's dismissable layer calls `preventDefault` but not
			   `stopPropagation` - MUI's Modal used to do both - so the same
			   keystroke that closes a dialog opened over the canvas also
			   arrives here, and with a review pending it ran `onRejectAll` and
			   discarded the agent's diffs on the way out. Two keystrokes from
			   an ordinary state: Cmd+N over an open inline edit, then Escape.

			   This yields to ANY dismissable layer, not only dialogs - a Radix
			   tooltip is one, so a mouse resting on one of this popover's own
			   buttons costs an extra Escape press. That is the correct trade
			   and it is how every other Radix surface in the app behaves:
			   dismissal is layered, and here it also makes a destructive
			   reject-all harder to fire by accident. */
			if (event.defaultPrevented) return;
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

	/*
	 * THE SAME CAPABILITY THE COMPOSER READS (issue #674): a Radient sign-in
	 * counts, not only the legacy key. This surface used to gate on the raw key
	 * list and `!isLoading`, so — unlike the composer — it folded "could not
	 * ask" into the sign-in sentence and told a signed-in user to sign in. The
	 * shared probe answers both questions once, and the shared copy table
	 * (`@shared/lib/speech-gate`) states the reason for a disabled control —
	 * offline, checking, or the account's own answer (issue #674).
	 */
	const { canUseRadientSpeech, speechBlock } = useRadientCredentialProbe();
	const canEnableRecordingFeature = canUseRadientSpeech;

	const shortcutText = useRecordingShortcutLabel(
		platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux",
	);

	const acceptAllTooltipText =
		platform === "darwin"
			? t("ui.canvas.inline_edit.apply_all_enter")
			: t("ui.canvas.inline_edit.apply_all_ctrl_enter");

	const acceptAllShortcut = useMemo(() => {
		if (platform === "darwin") {
			return "⌘+Enter";
		}
		return "Ctrl+Enter";
	}, [platform]);

	/**
	 * Stop the take the current attempt owns, keeping it only when it is long
	 * enough to hold words and was not aborted. A recorder that is already
	 * INACTIVE makes this a no-op (review round 1, m1 class): the manager's abort
	 * and this component's own Enter/Escape listener can both answer one press,
	 * and `stop()` on a stopped recorder throws `InvalidStateError`.
	 */
	const settleRecordingAttempt = useCallback((reason: "release" | "abort") => {
		const recorder = mediaRecorderRef.current;
		if (!recorder) {
			recordingAttemptRef.current = null;
			return;
		}
		const startedAt = recordingAttemptRef.current?.startedAt ?? null;
		const elapsed =
			startedAt === null
				? Number.POSITIVE_INFINITY
				: performance.now() - startedAt;
		recordingAttemptRef.current = null;
		if (recorder.state === "inactive") {
			setIsRecording(false);
			return;
		}
		if (reason === "abort" || elapsed < MIN_DICTATION_CLIP_MS) {
			// Discard: stop the tracks and drop the chunks without building a blob,
			// so a discarded take never reaches the transcription request.
			recorder.onstop = () => {
				if (recorder.stream) {
					for (const track of recorder.stream.getTracks()) {
						track.stop();
					}
				}
				setAudioBlob(null);
				audioChunksRef.current = [];
			};
		}
		recorder.stop();
		setIsRecording(false);
	}, []);

	const handleStartRecording = useCallback(async () => {
		if (!canEnableRecordingFeature) return;
		/*
		 * ONE RECORDER AT A TIME, the same guard the composer carries (review round
		 * 1, M2's class): a second engagement inside the `getUserMedia` window would
		 * overwrite the pending attempt and leave the first recorder with nothing
		 * pointing at it.
		 */
		if (recordingAttemptRef.current) return;
		if (navigator?.mediaDevices?.getUserMedia) {
			recordingAttemptRef.current = {
				startedAt: null,
				released: false,
				aborted: false,
			};
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: true,
				});
				mediaRecorderRef.current = new MediaRecorder(stream);
				audioChunksRef.current = [];

				mediaRecorderRef.current.ondataavailable = (event) => {
					audioChunksRef.current.push(event.data);
				};

				/*
				 * The blob is built on THIS recorder's own stop, and the discard arm of
				 * `settleRecordingAttempt` replaces this handler before stopping - so
				 * "which end the take met" is decided by the stop path, never by a
				 * closure's memory of the state.
				 */
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
				const attempt = recordingAttemptRef.current;
				if (attempt) attempt.startedAt = performance.now();
				setIsRecording(true);
				setAudioBlob(null); // Clear previous blob
				/*
				 * RELEASED OR ABORTED BEFORE THE RECORDER EXISTED: settle it now rather
				 * than orphan it. The take is ~0 ms old, so the minimum-clip rule discards
				 * it - the correct outcome for a press that captured nothing.
				 */
				if (attempt?.released || attempt?.aborted) {
					settleRecordingAttempt(attempt.aborted ? "abort" : "release");
				}
			} catch (err) {
				recordingAttemptRef.current = null;
				console.error("Error accessing microphone:", err);
				showErrorToast(
					t(
						"ui.canvas.inline_edit.error_accessing_microphone_please_ensure_microphone_permissions_are_gran",
					),
				);
			}
		} else {
			console.error("This runtime exposes no MediaRecorder");
			/* Not "your browser": this is a desktop app, and the person reading
			   this did not choose a browser and cannot change it. */
			showErrorToast(
				t("ui.canvas.inline_edit.dictation_is_not_available_on_this_device"),
			);
		}
	}, [canEnableRecordingFeature, settleRecordingAttempt]);

	const handleConfirmRecording = useCallback(() => {
		settleRecordingAttempt("release");
	}, [settleRecordingAttempt]);

	const handleCancelRecording = useCallback(() => {
		settleRecordingAttempt("abort");
	}, [settleRecordingAttempt]);

	/**
	 * The hold contract's stop (the manager's `{ start, stop }`). Before the
	 * recorder exists the mark is left on the ATTEMPT and settled by
	 * `handleStartRecording` when `start()` returns - the release arm confirms
	 * (subject to the clip floor), the abort arm discards; after it exists, the
	 * same settle runs here.
	 */
	const handleStopRecording = useCallback(
		(reason: "release" | "abort" = "release") => {
			const attempt = recordingAttemptRef.current;
			if (!attempt) return;
			if (attempt.startedAt === null) {
				if (reason === "abort") attempt.aborted = true;
				else attempt.released = true;
				return;
			}
			settleRecordingAttempt(reason);
		},
		[settleRecordingAttempt],
	);

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
		/*
		 * ONE BURST AT A TIME, bounded to this popover (#1087 review round 1, F4).
		 * The editor unmounts on Escape/X, and a burst that kept running would
		 * still apply its transcript to state nobody is looking at.
		 */
		transcriptionAbortRef.current?.abort();
		const controller = new AbortController();
		transcriptionAbortRef.current = controller;

		try {
			setIsTranscribing(true);
			/*
			 * THE SAME RETRY THE COMPOSER TAKES (#1087). The canvas's dictation is a
			 * second surface over the same relay, and the sentence both surfaces show is
			 * chosen once (`transcriptionFailureMessage`); leaving this call on the
			 * single-attempt path would have made that shared sentence's "temporary"
			 * claim true on one surface and not the other. The take is re-sent from the
			 * bytes already in hand, so nothing is re-recorded here either.
			 */
			const response = await TranscriptionApi.createTranscriptionWithRetry(
				apiConfig.baseUrl,
				{
					file: new File([audioBlob], "recording.webm", {
						type: "audio/webm",
					}),
				},
				{
					signal: controller.signal,
					onRetry: ({ attempt, total, delayMs, error }) => {
						console.warn(
							`Transcription attempt ${attempt}/${total} failed with a transient upstream fault; retrying in ${delayMs} ms.`,
							error,
						);
					},
				},
			);
			if (response.result?.text) {
				const newText = response.result?.text || "";
				/*
				 * The same boundary rule the composer's transcript writer uses (design
				 * round 1, D2): plain concatenation landed the words flush against a
				 * prompt that did not end in whitespace.
				 */
				setPrompt((p) => joinTranscript(p, newText));
			} else {
				// A successful, empty transcript is said out loud rather than silently
				// dropping the take (UX round 1, U3).
				showInfoToast(emptyTranscriptionMessage());
			}
			setAudioBlob(null); // Clear the blob after sending
			// A take that went through puts the offer away, so a stale sentence cannot
			// sit over a transcript that already arrived.
			setDictationFailure(null);
		} catch (error) {
			/*
			 * AN ABORTED BURST IS NOT A FAILURE TO REPORT: the editor is gone, or a
			 * newer take replaced this one. A toast about it would outlive the state
			 * it describes.
			 */
			if (controller.signal.aborted) return;
			// The raw server message stays on the console; the surface names the cause
			// in a sentence a person can act on (see
			// `transcriptionFailureMessage`), because "please try again" cannot fix
			// an account with no credits or a refused sign-in.
			console.error("Error transcribing audio:", error);
			/*
			 * THE SENTENCE IS KEPT, NOT JUST SHOWN, AND ONLY WHEN RETRYING CAN HELP
			 * (#1087 review round 1, F1/F2; design round 1, D4).
			 *
			 * The toast dismisses, so the row exists to carry the offer past it. But
			 * a refusal cannot be fixed by sending the same bytes again, and a row
			 * whose only control reproduces the refusal is the "try again" lie this
			 * copy exists to delete - the composer already gates on the same class.
			 * So the row is the transient class's, and the toast is the refusal's.
			 */
			const transient = isTransientTranscriptionFailure(error);
			setDictationFailure(
				transient ? transcriptionFailureRowMessage(error) : null,
			);
			if (!transient) showErrorToast(transcriptionFailureMessage(error));
		} finally {
			if (transcriptionAbortRef.current === controller) {
				setIsTranscribing(false);
			}
		}
	}, [audioBlob]);

	useEffect(() => {
		/*
		 * `dictationRetry` is READ ONLY AS A TRIGGER, which is why it appears here
		 * rather than in the body: the retained take is already in `audioBlob`, so a
		 * retry has no other way to ask for a second attempt than to be a value this
		 * effect depends on. Reading it is the whole of its job.
		 */
		void dictationRetry;
		if (audioBlob) {
			handleSendAudio();
		}
	}, [audioBlob, handleSendAudio, dictationRetry]);

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

			/*
			 * THE `Space` KEYUP ARM IS GONE: the hold contract's release now ends a
			 * hold (`handleStopRecording`) and a second confirm from here would call
			 * `stop()` on an already-stopped recorder, which throws.
			 */
			window.addEventListener("keydown", handleKeyDown);

			return () => {
				window.removeEventListener("keydown", handleKeyDown);
			};
		}

		return undefined;
	}, [isRecording, handleConfirmRecording, handleCancelRecording]);

	// Register with speech-to-text manager
	useSpeechToTextManager(
		"inline-edit",
		SpeechToTextPriority.INLINE_EDIT,
		{ start: handleStartRecording, stop: handleStopRecording },
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
			const newAttachments = result.filePaths.map((path: string) => ({
				id: crypto.randomUUID(),
				path: normalizePath(path),
			}));
			setAttachments((prev) => [...prev, ...newAttachments]);
		}
	};

	const handleRemoveAttachment = (id: string) => {
		setAttachments((prev) => {
			const removed = prev.find((attachment) => attachment.id === id);
			if (removed?.path.startsWith("blob:")) URL.revokeObjectURL(removed.path);
			return prev.filter((attachment) => attachment.id !== id);
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
								setAttachments((prev) => [
									...prev,
									{ id: crypto.randomUUID(), path: e.target?.result as string },
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
		if (!agentToUse) {
			showErrorToast(t("ui.canvas.inline_edit.please_select_an_agent_first"));
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
				// The open buffer can be unsaved or outside the agent workspace.
				// Send it explicitly so the server never needs host-file access.
				file_content: fileContent,
				edit_prompt: prompt,
				selection,
				// The legacy edit route takes paths; the composer's chips carry ids for
				// their keys, which that wire has no notion of.
				attachments: attachments.map((attachment) => attachment.path),
			};

			const response = await client.chat.editFileWithAgent(agentToUse, request);

			if (isCancelledRef.current) {
				return;
			}

			if (response.result && response.result.edit_diffs.length > 0) {
				onApplyChanges(response.result.edit_diffs);
			} else {
				showSuccessToast(t("ui.canvas.inline_edit.no_changes_were_needed"));
				onClose();
			}
		} catch (error) {
			if (!isCancelledRef.current) {
				console.error("Failed to edit file:", error);
				showErrorToast(t("ui.canvas.inline_edit.failed_to_edit_file"));
			}
		} finally {
			setIsLoading(false);
		}
	}, [
		config,
		filePath,
		fileContent,
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
							{t("ui.canvas.inline_edit.change")} {reviewState.currentIndex + 1}{" "}
							{t("ui.canvas.inline_edit.of")} {reviewState.diffs.length}
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
							aria-label={t("ui.canvas.inline_edit.review_progress")}
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
									? t("ui.canvas.inline_edit.reviewing_now")
									: isAccepted
										? t("ui.canvas.inline_edit.accepted")
										: isDecided
											? t("ui.canvas.inline_edit.rejected")
											: t("ui.canvas.inline_edit.not_reviewed_yet");
								return (
									<li
										// biome-ignore lint/suspicious/noArrayIndexKey: a diff is a plain find/replace pair with no id, and two identical replacements in one response are legitimate; position is the only stable identity.
										key={index}
										aria-label={t("ui.canvas.inline_edit.change_125665", {
											index: index + 1,
											state: state,
										})}
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
						<Tooltip content={t("ui.canvas.inline_edit.stop_reviewing")}>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.canvas.inline_edit.stop_reviewing")}
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
							<Tooltip content={t("ui.canvas.inline_edit.previous_change")}>
								<span>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={t("ui.canvas.inline_edit.previous_change")}
										onClick={() => onNavigateDiff("prev")}
										disabled={reviewState.currentIndex === 0}
									>
										<ChevronLeft aria-hidden="true" />
									</Button>
								</span>
							</Tooltip>
							<Tooltip content={t("ui.canvas.inline_edit.next_change")}>
								<span>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={t("ui.canvas.inline_edit.next_change")}
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
							{/* Neutral, not danger: rejecting a suggestion keeps the user's own
							    text, so nothing is destroyed and nothing is irreversible. Red
							    here would be the loudest thing on the surface for the safer of
							    the two choices. */}
							<Button variant="secondary" size="sm" onClick={onRejectDiff}>
								<X aria-hidden="true" />
								{t("ui.canvas.inline_edit.reject")}
							</Button>
							<Button variant="primary" size="sm" onClick={onAcceptDiff}>
								<Check aria-hidden="true" />
								{t("ui.canvas.inline_edit.accept")}
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
							{t("ui.canvas.inline_edit.reject_all")}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={onApplyAll}
							aria-label={acceptAllTooltipText}
							className={SHORTCUT_BUTTON}
						>
							<KeyboardShortcut shortcut={acceptAllShortcut} />
							{t("ui.canvas.inline_edit.accept_all")}
						</Button>
					</div>
				</div>
			) : (
				<>
					<Tooltip content={t("ui.canvas.inline_edit.close")}>
						<span className={cn("absolute top-2 end-2 z-[1301]")}>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.canvas.inline_edit.close")}
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
								className={cn("me-1 font-medium text-body-sm text-ink-muted")}
							>
								{t("ui.canvas.inline_edit.processing_audio")}
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
								"w-full resize-none overflow-y-auto bg-transparent py-1 pe-9 ps-1.5",
								"max-h-40 text-body-sm text-ink outline-none",
								"placeholder:text-ink-dim disabled:text-ink-disabled",
							)}
							rows={1}
							placeholder={t("ui.canvas.inline_edit.ask_for_an_edit")}
							aria-label={t("ui.canvas.inline_edit.edit_instructions")}
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
					{/*
					 * THE OFFER, BELOW THE FIELD RATHER THAN IN ITS PLACE (#1087 review
					 * round 1, F1; design round 1, D4).
					 *
					 * This row used to be the third arm of the ternary above, so ANY failure
					 * replaced the `<textarea>`: the operator's typed prompt disappeared,
					 * the field could not be typed into, and the only exit (close) unmounted
					 * the editor and lost the prompt with no other store. The composer never
					 * had that bug - it renders the row BELOW its input - so the two surfaces
					 * of one relay disagreed about whether the field survives a failure.
					 * It is additive here now: the textarea stays mounted and editable, and
					 * this row explains the failed take beside it.
					 *
					 * Transient failures only, and only while the bytes are still there to
					 * spend (`audioBlob`): the composer gates on both, and a refusal has no
					 * retry that could change its answer.
					 */}
					{dictationFailure !== null &&
						!isTranscribing &&
						audioBlob !== null && (
							<div
								data-dictation-retry
								className={cn("flex items-center gap-2 px-1.5 py-1")}
							>
								{/* An error register, not the metadata one (design round 1, D6). */}
								<CircleAlert
									aria-hidden="true"
									className={cn("size-3.5 shrink-0 text-danger")}
								/>
								<span className={cn("text-body-sm text-ink-muted")}>
									{dictationFailure}
								</span>
								<Button
									type="button"
									size="sm"
									variant="link"
									/*
									 * A real target and a visible affordance (design round 1, D3),
									 * matching the composer's control: the `link` variant's
									 * `h-auto p-0` collapses to the text line box, and the
									 * underline only appeared on hover.
									 */
									className={cn("h-7 shrink-0 px-2 underline")}
									disabled={isTranscribing || audioBlob === null}
									onClick={() => {
										/*
										 * Clear first, then nudge: the row goes away the moment the
										 * retry is accepted, and the effect above re-runs the one send
										 * path from the retained blob. Without a blob there is nothing
										 * to spend, so the button stays disabled rather than becoming
										 * a control that does nothing.
										 */
										setDictationFailure(null);
										setDictationRetry((n) => n + 1);
									}}
								>
									{t("ui.common.actions.retry")}
								</Button>
							</div>
						)}
					{/* Attach and dictate are the same two affordances the chat
					    composer carries, so they read the same: neutral until you
					    reach for them, with the accent left for the primary action.
					    See the note at `message-input.tsx`'s action row.

					    THEIR HOVER GOES DOWN, NOT UP (`surface`, where the chat
					    composer's buttons use `elevated`): this row's own ground IS
					    `elevated` — the floating box at the top of this file — so an
					    `elevated` hover would measure ΔE00 0 against it. That
					    collapse predates the pane's move (flagged in the
					    canvas-elevated round, where it was listed as the pane's), and
					    the step that survives every palette is the one below. */}
					<div className={cn("flex items-center justify-between gap-2")}>
						<div className={cn("flex items-center gap-2")}>
							<Tooltip content={t("ui.canvas.inline_edit.add_attachments")}>
								<span>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={t("ui.canvas.inline_edit.add_attachments")}
										className="text-ink-dim hover:bg-surface hover:text-ink"
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
											? speechUnavailableReason("recording", speechBlock)
											: shortcutText === null
												? t("ui.canvas.inline_edit.start_recording")
												: t("ui.canvas.inline_edit.start_recording_or_hold", {
														shortcuttext: shortcutText,
														label: resolvePushToTalkBinding().label,
													})
									}
								>
									<span>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t("ui.canvas.inline_edit.start_recording")}
											className="text-ink-dim hover:bg-surface hover:text-ink"
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
									<Tooltip
										content={t("ui.canvas.inline_edit.confirm_recording_enter")}
									>
										<span>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={t(
													"ui.canvas.inline_edit.confirm_recording",
												)}
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
									<Tooltip
										content={t("ui.canvas.inline_edit.cancel_recording_esc")}
									>
										<span>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={t("ui.canvas.inline_edit.cancel_recording")}
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
								<Tooltip content={t("ui.canvas.inline_edit.edit")}>
									<span>
										<Button
											variant="primary"
											size="icon-sm"
											aria-label={t("ui.canvas.inline_edit.edit")}
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
									<Spinner
										size="sm"
										label={t("ui.canvas.inline_edit.editing")}
									/>
									<Tooltip content={t("ui.canvas.inline_edit.cancel_edit")}>
										<span>
											<Button
												variant="danger"
												size="icon-sm"
												aria-label={t("ui.canvas.inline_edit.cancel_edit")}
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
