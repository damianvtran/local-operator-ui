import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import React, { type FC } from "react";
import { MarkdownRenderer } from "../markdown-renderer";
/**
 * Props for the MessageContent component
 */
export type MessageContentProps = {
	content?: string;
	isUser: boolean;
	styleProps?: Record<string, unknown>;
};

/**
 * Styled container for message content
 */
const ContentContainer = styled(Box)(() => ({
	marginBottom: 0,
}));

/**
 * Component for rendering message content with markdown support
 */
export const MessageContent: FC<MessageContentProps> = React.memo(
	({ content, styleProps }) => {
		if (!content) return null;

		return (
			<ContentContainer>
				<MarkdownRenderer content={content} styleProps={styleProps} />
			</ContentContainer>
		);
	},
);
