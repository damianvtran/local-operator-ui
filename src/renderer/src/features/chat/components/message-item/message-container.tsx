import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC, ReactNode } from "react";

/**
 * Props for the MessageContainer component
 */
export type MessageContainerProps = {
	isUser: boolean;
	children: ReactNode;
	isSmallView?: boolean;
	compact?: boolean;
};

/**
 * Container component for message items
 * Handles the layout direction based on whether the message is from the user or assistant
 * Provides increased spacing for assistant messages to account for action banners
 */
const StyledContainer = styled(Box, {
	shouldForwardProp: (prop) =>
		prop !== "isUser" && prop !== "isSmallView" && prop !== "compact",
})<{ isUser: boolean; isSmallView?: boolean; compact?: boolean }>(
	({ isUser, isSmallView, compact }) => ({
		display: "flex",
		flexDirection: isUser ? "row-reverse" : "row",
		alignItems: "flex-start",
		gap: compact ? (isSmallView ? 6 : 10) : isSmallView ? 8 : 16,
		marginBottom: compact ? (isSmallView ? 6 : 8) : isSmallView ? 8 : 12,
	}),
);

/**
 * Container component for message items
 * Handles the layout direction based on whether the message is from the user or assistant
 */
export const MessageContainer: FC<MessageContainerProps> = ({
	isUser,
	children,
	isSmallView,
	compact,
}) => {
	return (
		<StyledContainer
			isUser={isUser}
			isSmallView={isSmallView}
			compact={compact}
		>
			{children}
		</StyledContainer>
	);
};
