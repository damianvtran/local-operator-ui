import { Box, IconButton, Tooltip } from "@mui/material";
import { alpha, styled } from "@mui/material/styles";
import { useSpeechStore } from "@shared/store/speech-store";
import { Square, Volume2 } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";

// Props for the TextSelectionControls component
type TextSelectionControlsProps = {
	messageId: string;
	agentId?: string;
	targetRef: React.RefObject<HTMLElement>;
};

// Styled wrapper for the control buttons
const ControlsWrapper = styled(Box)(({ theme }) => ({
	position: "absolute",
	display: "flex",
	alignItems: "flex-start",
	backgroundColor: theme.palette.background.paper,
	borderRadius: "4px",
	padding: "2px",
	boxShadow: theme.shadows[3],
	zIndex: 10,
}));

// Styled IconButton for controls
const StyledIconButton = styled(IconButton)(({ theme }) => ({
	color: theme.palette.text.secondary,
	width: "34px",
	height: "34px",
	"&:hover": {
		color: theme.palette.primary.main,
		backgroundColor: alpha(theme.palette.primary.main, 0.1),
	},
}));

export const TextSelectionControls: FC<TextSelectionControlsProps> = ({
	agentId,
	targetRef,
}) => {
	const [selection, setSelection] = useState<{
		text: string;
		rect: DOMRect | null;
	}>({ text: "", rect: null });
	const { playSpeech, stopSpeech, loadingMessageId, playingMessageId } =
		useSpeechStore();

	const [currentSelectionId, setCurrentSelectionId] = useState<string | null>(
		null,
	);
	const isPlaying = playingMessageId && playingMessageId === currentSelectionId;
	const isLoading = loadingMessageId && loadingMessageId === currentSelectionId;

	const handleMouseUp = useCallback(() => {
		if (!targetRef.current) {
			setSelection({ text: "", rect: null });
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

			if (text) {
				setSelection({ text, rect });
			} else {
				setSelection({ text: "", rect: null });
			}
		} else {
			setSelection({ text: "", rect: null });
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

	if (!selection.rect || !selection.text) {
		return null;
	}

	const containerRect = targetRef.current?.getBoundingClientRect();
	if (!containerRect) return null;

	const style = {
		top: selection.rect.top - containerRect.top - 40, // Position above selection
		left:
			selection.rect.left - containerRect.left + selection.rect.width / 2 - 20, // Center on selection
	};

	return (
		<ControlsWrapper style={style}>
			{isPlaying ? (
				<Tooltip title="Stop" placement="top">
					<StyledIconButton size="small" onClick={handleStop}>
						<Square size={16} />
					</StyledIconButton>
				</Tooltip>
			) : (
				<Tooltip title="Speak Aloud" placement="top">
					<StyledIconButton
						size="small"
						onClick={handlePlay}
						disabled={isLoading || !agentId}
					>
						<Volume2 size={16} />
					</StyledIconButton>
				</Tooltip>
			)}
		</ControlsWrapper>
	);
};
