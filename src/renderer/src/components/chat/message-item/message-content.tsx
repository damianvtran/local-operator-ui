import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { MarkdownRenderer } from "../markdown-renderer";
import type { MessageContentProps } from "./types";

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
