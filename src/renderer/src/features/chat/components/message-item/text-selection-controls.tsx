import { TextSelectionControls as BaseTextSelectionControls } from "@shared/components/common/text-selection-controls";
import type { FC } from "react";

// Props for the TextSelectionControls component
type TextSelectionControlsProps = {
	messageId: string;
	agentId?: string;
	targetRef: React.RefObject<HTMLElement>;
	isUser: boolean;
	conversationId: string;
};

export const TextSelectionControls: FC<TextSelectionControlsProps> = ({
	agentId,
	targetRef,
	isUser,
	conversationId,
}) => {
	if (isUser) {
		return null;
	}

	return (
		<BaseTextSelectionControls
			targetRef={targetRef}
			showSpeech
			showCopy
			showReply
			agentId={agentId}
			conversationId={conversationId}
		/>
	);
};
