import type { Reply } from "@shared/store/conversation-input-store";
import { v4 as uuidv4 } from "uuid";

export const parseReplies = (
	content: string,
): { replies: Reply[]; remainingContent: string } => {
	const replyRegex = /<reply-to>(.*?)<\/reply-to>/g;
	const replies: Reply[] = [];
	let match: RegExpExecArray | null;

	// exec with a global regex is stateful. Each call advances lastIndex.
	// We need to loop through all matches to extract the reply text.
	for (;;) {
		match = replyRegex.exec(content);
		if (match === null) {
			break;
		}
		// This is the part of the match that is inside the tag
		replies.push({ id: uuidv4(), text: match[1] });
	}

	// After extracting all replies, we remove all reply tags from the content.
	// String.prototype.replace with a global regex will replace all occurrences.
	const remainingContent = content.replace(replyRegex, "").trim();

	return { replies, remainingContent };
};
