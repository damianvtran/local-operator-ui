import { Paper } from "@mui/material";
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
 */
export const MessagePaper: FC<MessagePaperProps> = ({
	isUser,
	elevation = isUser ? 2 : 1,
	children,
}) => {
	return (
		<StyledPaper
			elevation={elevation}
			sx={{
				backgroundColor: isUser
					? "rgba(66, 133, 244, 0.15)"
					: (theme) => theme.palette.background.paper,
				border: isUser
					? "1px solid rgba(66, 133, 244, 0.3)"
					: "1px solid rgba(255, 255, 255, 0.1)",
				boxShadow: isUser
					? "0 4px 12px rgba(0, 0, 0, 0.15)"
					: "0 2px 8px rgba(0, 0, 0, 0.1)",
				color: isUser ? (theme) => theme.palette.text.primary : "inherit",
			}}
		>
			{children}
		</StyledPaper>
	);
};
