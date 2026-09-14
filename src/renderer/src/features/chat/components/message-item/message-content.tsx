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
 * Component for rendering message content with markdown support
 */
export const MessageContent: FC<MessageContentProps> = React.memo(
	({ content, styleProps }) => {
		if (!content) return null;

		return (
			<div className="mb-0">
				<MarkdownRenderer content={content} styleProps={styleProps} />
			</div>
		);
	},
);
