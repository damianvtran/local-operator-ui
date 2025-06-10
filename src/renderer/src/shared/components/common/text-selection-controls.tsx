import { Box, CircularProgress, IconButton, Tooltip } from "@mui/material";
import { alpha, styled } from "@mui/material/styles";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { useSpeechStore } from "@shared/store/speech-store";
import {
	ClipboardCopy,
	Copy,
	Edit3,
	MessageSquareReply,
	Square,
	Volume2,
} from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";

// Props for the TextSelectionControls component
type TextSelectionControlsProps = {
	targetRef: React.RefObject<HTMLElement>;
	// Config for buttons
	showSpeech?: boolean;
	showCopy?: boolean;
	showReply?: boolean;
	showEdit?: boolean;
	// Props for speech
	agentId?: string;
	// Props for reply
	conversationId?: string;
	// Callback for edit
	onEdit?: (selection: string, rect: DOMRect) => void;
};

// Styled wrapper for the control buttons
const ControlsWrapper = styled(Box)(({ theme }) => ({
	position: "absolute",
	backgroundColor: theme.palette.background.paper,
	borderRadius: "4px",
	boxShadow: theme.shadows[3],
	zIndex: 10,
	padding: 4,
	border: `1px solid ${theme.palette.divider}`,
}));

// Styled IconButton for controls
const StyledIconButton = styled(IconButton)(({ theme }) => ({
	color: theme.palette.text.secondary,
	width: "34px",
	height: "34px",
	padding: 0,
	margin: 0,
	"&:hover": {
		color: theme.palette.primary.main,
		backgroundColor: alpha(theme.palette.primary.main, 0.1),
	},
}));

export const TextSelectionControls: FC<TextSelectionControlsProps> = ({
	targetRef,
	showSpeech,
	showCopy,
	showReply,
	showEdit,
	agentId,
	conversationId,
	onEdit,
}) => {
	const [selection, setSelection] = useState<{
		text: string;
		html: string;
		rect: DOMRect | null;
		range: Range | null;
	}>({ text: "", html: "", rect: null, range: null });
	const { playSpeech, stopSpeech, loadingMessageId, playingMessageId } =
		useSpeechStore();
	const { data: credentialsData, isLoading: isLoadingCredentials } =
		useCredentials();
	const { addReply } = useConversationInputStore();

	const isRadientApiKeyConfigured = useMemo(
		() => credentialsData?.keys?.includes("RADIENT_API_KEY"),
		[credentialsData?.keys],
	);

	const canEnableSpeechFeature = useMemo(
		() => isRadientApiKeyConfigured && !isLoadingCredentials,
		[isRadientApiKeyConfigured, isLoadingCredentials],
	);

	const [currentSelectionId, setCurrentSelectionId] = useState<string | null>(
		null,
	);
	const isPlaying = playingMessageId && playingMessageId === currentSelectionId;
	const isLoading = loadingMessageId && loadingMessageId === currentSelectionId;

	const handleMouseUp = useCallback(() => {
		if (!targetRef.current) {
			setSelection({ text: "", html: "", rect: null, range: null });
			return;
		}

		const sel = window.getSelection();
		if (
			sel &&
			sel.rangeCount > 0 &&
			!sel.isCollapsed &&
			targetRef.current.contains(sel.anchorNode)
		) {
			const range = sel.getRangeAt(0);
			const rect = range.getBoundingClientRect();
			const text = sel.toString().trim();
			const container = document.createElement("div");
			container.appendChild(range.cloneContents());
			const html = container.innerHTML;

			if (text) {
				setSelection({ text, html, rect, range });
			} else {
				setSelection({ text: "", html: "", rect: null, range: null });
			}
		} else {
			setSelection({ text: "", html: "", rect: null, range: null });
		}
	}, [targetRef]);

	useEffect(() => {
		const handleMouseUpEvent = () => {
			// Use a timeout to allow the selection to finalize before checking it
			setTimeout(handleMouseUp, 0);
		};

		document.addEventListener("mouseup", handleMouseUpEvent);
		return () => {
			document.removeEventListener("mouseup", handleMouseUpEvent);
		};
	}, [handleMouseUp]);

	useEffect(() => {
		const handleScrollAndResize = () => {
			if (selection.range) {
				const rect = selection.range.getBoundingClientRect();
				setSelection((s) => ({ ...s, rect }));
			}
		};

		window.addEventListener("scroll", handleScrollAndResize, true);
		window.addEventListener("resize", handleScrollAndResize, true);

		return () => {
			window.removeEventListener("scroll", handleScrollAndResize, true);
			window.removeEventListener("resize", handleScrollAndResize, true);
		};
	}, [selection.range]);

	const handlePlay = () => {
		if (agentId && selection.text) {
			const newSelectionId = uuidv4();
			setCurrentSelectionId(newSelectionId);
			playSpeech(newSelectionId, agentId, selection.text);
		}
	};

	const handleStop = () => {
		stopSpeech();
	};

	const handleCopy = () => {
		if (selection.html) {
			const htmlBlob = new Blob([selection.html], { type: "text/html" });
			const textBlob = new Blob([selection.text], { type: "text/plain" });
			const item = new ClipboardItem({
				"text/html": htmlBlob,
				"text/plain": textBlob,
			});
			navigator.clipboard.write([item]).finally(() => {
				setSelection({ text: "", html: "", rect: null, range: null });
			});
		} else {
			handleCopyWithoutFormatting();
		}
	};

	const handleCopyWithoutFormatting = () => {
		if (selection.text) {
			navigator.clipboard.writeText(selection.text).finally(() => {
				setSelection({ text: "", html: "", rect: null, range: null });
			});
		}
	};

	const handleReply = () => {
		if (selection.text && conversationId) {
			addReply(conversationId, {
				id: uuidv4(),
				text: selection.text,
			});
			setSelection({ text: "", html: "", rect: null, range: null });
		}
	};

	const handleEdit = () => {
		if (selection.text && selection.rect && onEdit) {
			onEdit(selection.text, selection.rect);
			setSelection({ text: "", html: "", rect: null, range: null });
		}
	};

	if (!selection.rect || !selection.text) {
		return null;
	}

	const containerRect = targetRef.current?.getBoundingClientRect();
	if (!containerRect) return null;

	const style = {
		top: selection.rect.top - containerRect.top - 52, // Position above selection
		left: selection.rect.left - containerRect.left, // Align with the left of the selection
	};

	return (
		<ControlsWrapper style={style} onMouseDown={(e) => e.preventDefault()}>
			{showSpeech &&
				(isPlaying ? (
					<Tooltip title="Stop" placement="top">
						<StyledIconButton size="small" onClick={handleStop}>
							<Square size={14} />
						</StyledIconButton>
					</Tooltip>
				) : (
					<Tooltip
						title={
							isLoading
								? "Loading"
								: !canEnableSpeechFeature
									? "Sign in to Radient in the settings page to enable text to speech"
									: "Speak Aloud"
						}
						placement="top"
					>
						<span>
							<StyledIconButton
								size="small"
								onClick={handlePlay}
								disabled={isLoading || !agentId || !canEnableSpeechFeature}
							>
								{isLoading ? (
									<CircularProgress size={14} />
								) : (
									<Volume2 size={14} />
								)}
							</StyledIconButton>
						</span>
					</Tooltip>
				))}
			{showCopy && (
				<>
					<Tooltip title="Copy" placement="top">
						<StyledIconButton size="small" onClick={handleCopy}>
							<Copy size={14} />
						</StyledIconButton>
					</Tooltip>
					<Tooltip title="Copy without formatting" placement="top">
						<StyledIconButton size="small" onClick={handleCopyWithoutFormatting}>
							<ClipboardCopy size={14} />
						</StyledIconButton>
					</Tooltip>
				</>
			)}
			{showReply && (
				<Tooltip title="Reply" placement="top">
					<StyledIconButton size="small" onClick={handleReply}>
						<MessageSquareReply size={14} />
					</StyledIconButton>
				</Tooltip>
			)}
			{showEdit && (
				<Tooltip title="Ask for an Edit" placement="top">
					<StyledIconButton size="small" onClick={handleEdit}>
						<Edit3 size={14} />
					</StyledIconButton>
				</Tooltip>
			)}
		</ControlsWrapper>
	);
};
