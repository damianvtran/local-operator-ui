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
 * Component for rendering message content with markdown support.
 *
 * The credential chips are the USER's half only, for the same reason the canonical
 * transcript's are: a citation is the app's own sentence about a value the reader
 * can no longer see, and this legacy path renders the same stored message text, so
 * the two paths must chip it or they disagree about the reader's own words. An
 * agent's answer keeps the plain render (`credentialCitations` defaults to false)
 * because a citation the model writes is prose about a credential rather than a
 * receipt the app issued.
 */
export const MessageContent: FC<MessageContentProps> = React.memo(
	({ content, isUser, styleProps }) => {
		if (!content) return null;

		return (
			<div className="mb-0">
				<MarkdownRenderer
					content={content}
					styleProps={styleProps}
					credentialCitations={isUser}
				/>
			</div>
		);
	},
);
