import type { Reply } from "@shared/store/conversation-input-store";
import { v4 as uuidv4 } from "uuid";

export const parseReplies = (
	content: string,
): { replies: Reply[]; remainingContent: string } => {
	const replyRegex = /<reply-to>(.*?)<\/reply-to>/g;
	const replies: Reply[] = [];
	let lastIndex = 0;

	let match: RegExpExecArray | null;
	match = replyRegex.exec(content);
	while (match !== null) {
		replies.push({ id: uuidv4(), text: match[1] });
		lastIndex = match.index + match[0].length;
		match = replyRegex.exec(content);
	}

	const remainingContent = content.slice(lastIndex).trim();

	return { replies, remainingContent };
};
