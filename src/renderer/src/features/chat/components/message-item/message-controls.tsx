import { Box, IconButton, Tooltip } from "@mui/material";
import { alpha, styled } from "@mui/material/styles";
import { Copy } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";

// Props for the MessageControls component
type MessageControlsProps = {
	isUser: boolean;
	content?: string;
};

// Styled container for the message controls
const ControlsContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<{ isUser: boolean }>(({ isUser }) => ({
	position: "absolute",
	bottom: isUser ? 12 : -12, // Position below the message
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
}) => {
	const [copied, setCopied] = useState(false);

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

	return (
		<ControlsContainer isUser={isUser} className="message-controls">
			{/* Only render the wrapper if there are buttons to show */}
			{showCopyButton && (
				<ControlsWrapper>
					<Tooltip title={copied ? "Copied!" : "Copy message"} placement="top">
						<StyledIconButton size="small" onClick={handleCopy}>
							<Copy size={16} />
						</StyledIconButton>
					</Tooltip>
				</ControlsWrapper>
			)}
			{/* Additional button wrappers can be added here in the future */}
		</ControlsContainer>
	);
};
