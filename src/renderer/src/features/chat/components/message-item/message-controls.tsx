import { Box, CircularProgress, IconButton, Tooltip } from "@mui/material";
import { alpha, styled } from "@mui/material/styles";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useSpeechStore } from "@shared/store/speech-store";
import { Copy, Square, Volume2 } from "lucide-react";
import type { FC } from "react";
import { useMemo, useState } from "react";

import type { SxProps, Theme } from "@mui/material";

// Props for the MessageControls component
type MessageControlsProps = {
	isUser: boolean;
	content?: string;
	sx?: SxProps<Theme>;
	messageId: string;
	agentId?: string;
};

// Styled container for the message controls
const ControlsContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<{ isUser: boolean }>(({ isUser }) => ({
	position: "absolute",
	bottom: isUser ? 8 : -12, // Position below the message
	display: "flex",
	alignItems: "center",
	justifyContent: isUser ? "flex-end" : "flex-start",
	width: "100%",
	opacity: 0,
	transition: "opacity 0.2s ease-in-out",
	zIndex: 1,
}));

// Styled wrapper for the control buttons
const ControlsWrapper = styled(Box)(() => ({
	display: "flex",
	alignItems: "flex-start",
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

/**
 * Component for message control buttons that appear on hover
 * Currently includes a copy button for copying message content
 */
export const MessageControls: FC<MessageControlsProps> = ({
	isUser,
	content,
	sx,
	messageId,
	agentId,
}) => {
	const [copied, setCopied] = useState(false);
	const { data: credentialsData, isLoading: isLoadingCredentials } =
		useCredentials();
	const {
		playSpeech,
		stopSpeech,
		replaySpeech,
		loadingMessageId,
		playingMessageId,
		audioCache,
	} = useSpeechStore();

	const isPlaying = playingMessageId === messageId;
	const isLoading = loadingMessageId === messageId;
	const hasAudio = audioCache.has(messageId);

	const isRadientApiKeyConfigured = useMemo(
		() => credentialsData?.keys?.includes("RADIENT_API_KEY"),
		[credentialsData?.keys],
	);

	const canEnableSpeechFeature = useMemo(
		() => isRadientApiKeyConfigured && !isLoadingCredentials,
		[isRadientApiKeyConfigured, isLoadingCredentials],
	);

	// Only show copy button for assistant messages
	const showCopyButton = content;

	/**
	 * Handles copying the message content to clipboard
	 */
	const handleCopy = async () => {
		try {
			// Make sure content is defined before copying
			if (content) {
				await navigator.clipboard.writeText(content);
				setCopied(true);
				setTimeout(() => setCopied(false), 2000); // Reset copied state after 2 seconds
			}
		} catch (error) {
			console.error("Failed to copy text:", error);
		}
	};

	const handlePlay = () => {
		if (agentId && content) {
			playSpeech(messageId, agentId, content);
		}
	};

	const handleReplay = () => {
		replaySpeech(messageId);
	};

	const handleStop = () => {
		stopSpeech();
	};

	return (
		<ControlsContainer isUser={isUser} className="message-controls" sx={sx}>
			{/* Only render the wrapper if there are buttons to show */}
			{showCopyButton && (
				<ControlsWrapper>
					<Tooltip title={copied ? "Copied!" : "Copy message"} placement="top">
						<StyledIconButton size="small" onClick={handleCopy}>
							<Copy size={16} />
						</StyledIconButton>
					</Tooltip>
					{!isUser &&
						(isPlaying ? (
							<Tooltip title="Stop" placement="top">
								<StyledIconButton size="small" onClick={handleStop}>
									<Square size={16} />
								</StyledIconButton>
							</Tooltip>
						) : (
							<Tooltip
								title={
									!canEnableSpeechFeature
										? "Sign in to Radient in the settings page to enable text to speech"
										: isLoading
											? "Loading"
											: hasAudio
												? "Replay Speech"
												: "Speak Aloud"
								}
								placement="top"
							>
								<span>
									<StyledIconButton
										size="small"
										onClick={hasAudio ? handleReplay : handlePlay}
										disabled={isLoading || !canEnableSpeechFeature}
									>
										{isLoading ? (
											<CircularProgress size={16} />
										) : (
											<Volume2 size={16} />
										)}
									</StyledIconButton>
								</span>
							</Tooltip>
						))}
				</ControlsWrapper>
			)}
			{/* Additional button wrappers can be added here in the future */}
		</ControlsContainer>
	);
};
