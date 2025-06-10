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
};

/**
 * Container component for message items
 * Handles the layout direction based on whether the message is from the user or assistant
 * Provides increased spacing for assistant messages to account for action banners
 */
const StyledContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isUser" && prop !== "isSmallView",
})<{ isUser: boolean; isSmallView?: boolean }>(({ isUser, isSmallView }) => ({
	display: "flex",
	flexDirection: isUser ? "row-reverse" : "row",
	alignItems: "flex-start",
	gap: isSmallView ? 8 : 16,
	marginBottom: isSmallView ? 8 : 12,
}));

/**
 * Container component for message items
 * Handles the layout direction based on whether the message is from the user or assistant
 */
export const MessageContainer: FC<MessageContainerProps> = ({
	isUser,
	children,
	isSmallView,
}) => {
	return (
		<StyledContainer isUser={isUser} isSmallView={isSmallView}>
			{children}
		</StyledContainer>
	);
};
