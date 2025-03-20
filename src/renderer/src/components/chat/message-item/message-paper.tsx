import { Paper, useTheme } from "@mui/material";
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
 * Adapts to the current theme (light or dark)
 */
export const MessagePaper: FC<MessagePaperProps> = ({
	isUser,
	elevation = isUser ? 2 : 1,
	children,
}) => {
	const theme = useTheme();
	const isDarkMode = theme.palette.mode === "dark";

	// Define colors based on theme
	const userBackgroundColor = isDarkMode
		? "rgba(56, 201, 106, 0.15)" // Green background in dark mode
		: "rgba(42, 164, 88, 0.12)"; // Slightly darker green in light mode for better contrast

	const userBorderColor = isDarkMode
		? "rgba(56, 201, 106, 0.3)" // Green border for user messages in dark mode
		: "rgba(42, 164, 88, 0.25)"; // Slightly darker green border in light mode

	const assistantBorderColor = isDarkMode
		? "rgba(255, 255, 255, 0.1)" // Light border in dark mode
		: "rgba(0, 0, 0, 0.1)"; // Dark border in light mode

	// Define shadow based on theme mode
	const userShadow = isDarkMode
		? "0 4px 12px rgba(0, 0, 0, 0.2)"
		: "0 4px 12px rgba(0, 0, 0, 0.1)";

	const assistantShadow = isDarkMode
		? "0 2px 8px rgba(0, 0, 0, 0.15)" // Darker shadow in dark mode
		: "0 2px 8px rgba(0, 0, 0, 0.05)"; // Lighter shadow in light mode

	return (
		<StyledPaper
			elevation={elevation}
			sx={{
				backgroundColor: isUser
					? userBackgroundColor // Theme-appropriate background for user messages
					: theme.palette.background.paper, // Theme-appropriate background for assistant
				border: isUser
					? `1px solid ${userBorderColor}`
					: `1px solid ${assistantBorderColor}`,
				boxShadow: isUser ? userShadow : assistantShadow,
				color: theme.palette.text.primary, // Use theme text color
			}}
		>
			{children}
		</StyledPaper>
	);
};
