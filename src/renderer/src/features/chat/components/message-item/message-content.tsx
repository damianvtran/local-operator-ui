import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { MarkdownRenderer } from "../markdown-renderer";
/**
 * Props for the MessageContent component
 */
export type MessageContentProps = {
	content?: string;
	isUser: boolean;
};

/**
 * Styled container for message content
 */
const ContentContainer = styled(Box)(() => ({
	marginBottom: 16,
}));

/**
 * Component for rendering message content with markdown support
 */
export const MessageContent: FC<MessageContentProps> = ({ content }) => {
	if (!content) return null;

	return (
		<ContentContainer>
			<MarkdownRenderer content={content} />
		</ContentContainer>
	);
};
