import { Box, Paper, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";

// Create a Paper component with custom styling
const StyledPaper = styled(Paper)(({ theme }) => ({
	[theme.breakpoints.down("sm")]: {
		maxWidth: "85%",
	},
	[theme.breakpoints.between("sm", "md")]: {
		maxWidth: "75%",
	},
	[theme.breakpoints.up("md")]: {
		maxWidth: "65%",
	},
	width: "auto",
	padding: 16,
	borderRadius: 8,
	wordBreak: "break-word",
	overflowWrap: "break-word",
	position: "relative",
}));

// Props for the MessagePaper component
type MessagePaperProps = {
	isUser: boolean;
	elevation?: number;
	children: React.ReactNode;
};

/**
 * Paper component for message content
 * Handles styling based on whether the message is from the user or assistant
 * For a modern AI chat app look, assistant messages don't have a paper boundary
 */
export const MessagePaper: FC<MessagePaperProps> = ({
	isUser,
	elevation = isUser ? 2 : 0,
	children,
}) => {
	const theme = useTheme();

	// For user messages, we keep the paper boundary
	if (isUser) {
		return (
			<StyledPaper
				elevation={elevation}
				sx={{
					backgroundColor: theme.palette.userMessage.background,
					border: `1px solid ${theme.palette.userMessage.border}`,
					boxShadow: theme.palette.userMessage.shadow,
					color: theme.palette.text.primary,
				}}
			>
				{children}
			</StyledPaper>
		);
	}

	// For assistant messages, we remove the paper boundary and just show text on background
	// Take up the full width of the constraint for a modern chat app look
	return (
		<Box
			sx={{
				borderRadius: 2,
				color: theme.palette.text.primary,
				width: "calc(100% - 52px)", // Take full width minus padding
				wordBreak: "break-word",
				overflowWrap: "break-word",
				position: "relative",
			}}
		>
			{children}
		</Box>
	);
};
