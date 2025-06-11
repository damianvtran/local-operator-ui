import { keyframes } from "@emotion/react";
import { Avatar, Box, Typography, styled } from "@mui/material";
import type {
	AgentExecutionRecord,
	JobStatus,
} from "@shared/api/local-operator/types";
import { useStreamingMessagesStore } from "@shared/store/streaming-messages-store";
import { Bot } from "lucide-react";
import { type FC, memo } from "react"; // Import memo

// Define the animations
const dotAnimation = keyframes`
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
`;

const textStrobeAnimation = keyframes`
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
`;

// Styled components
const LoadingContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isSmallView",
})<{ isSmallView?: boolean }>(({ isSmallView }) => ({
	display: "flex",
	alignItems: "center",
	gap: isSmallView ? 8 : 0,
}));

const AgentAvatar = styled(Avatar)(({ theme }) => ({
	backgroundColor: theme.palette.icon.background,
	color: theme.palette.icon.text,
	boxShadow: "none",
	border: "none",
}));

const ContentContainer = styled(Box)(() => ({
	display: "flex",
	flexDirection: "column",
	gap: 8,
	maxWidth: "calc(100% - 60px)",
}));
const StatusContainer = styled(Box)(() => ({
	display: "flex",
	alignItems: "center",
	gap: 8,
}));

const StatusText = styled(Typography, {
	shouldForwardProp: (prop) => prop !== "isSmallView",
})<{ isSmallView?: boolean }>(({ theme, isSmallView }) => ({
	color: theme.palette.text.secondary,
	display: "flex",
	marginLeft: isSmallView ? 0 : 16,
	fontSize: isSmallView ? "0.75rem" : "1rem",
	position: "relative",
	animation: `${textStrobeAnimation} 3s ease-in-out infinite`,
}));

const StatusTextContent = styled("span")(() => ({
	wordBreak: "break-word",
	display: "inline",
}));

const StatusControls = styled("span")(() => ({
	display: "inline-flex",
	alignItems: "center",
	marginLeft: 4,
	whiteSpace: "nowrap",
}));

const DotContainer = styled("span")(() => ({
	display: "inline-flex",
	alignItems: "center",
	position: "relative",
	zIndex: 2,
	marginLeft: 4,
}));

const Dot = styled("span")<{ delay: number }>(({ theme, delay }) => ({
	width: 4,
	height: 4,
	borderRadius: "50%",
	backgroundColor: theme.palette.text.secondary,
	margin: "0 1px",
	animation: `${dotAnimation} 1.4s infinite ease-in-out`,
	animationDelay: `${delay}s`,
}));

/**
 * Get a user-friendly text representation of a job status
 *
 * @param status - The job status
 * @returns A user-friendly text representation
 */
const getStatusText = (status: JobStatus): string => {
	switch (status) {
		case "pending":
			return "Waiting to start";
		case "processing":
			return "Thinking";
		case "completed":
			return "Finishing up";
		case "failed":
			return "Had trouble";
		case "cancelled":
			return "Had to stop";
		default:
			return "Thinking";
	}
};

/**
 * Get detailed status text based on execution type and action
 *
 * @param status - The job status
 * @param execution - The current execution record
 * @returns A detailed status text
 */
const getDetailedStatusText = (
	status: JobStatus | null | undefined,
	execution: AgentExecutionRecord,
): string => {
	// If we have an action, use that for more specific status
	if (execution.action) {
		switch (execution.action) {
			case "CODE":
				return "Executing code";
			case "WRITE":
				return "Writing content";
			case "EDIT":
				return "Editing content";
			case "READ":
				return "Reading content";
			case "ASK":
				return "Formulating a question";
			case "DONE":
				return "Completing the task";
			case "BYE":
				return "Ending the conversation";
		}
	}

	// If no action but we have execution type, use that
	if (execution.execution_type) {
		switch (execution.execution_type) {
			case "plan":
				return "Planning my approach";
			case "action":
				return "Thinking";
			case "reflection":
				return "Reflecting on next steps";
			case "response":
				return "Writing a response";
			case "security_check":
				return "Performing security checks";
			case "classification":
				return "Thinking about my response";
			case "system":
				return "Processing system tasks";
			case "user_input":
				return "Processing your input";
		}
	}

	// Fall back to basic status
	return status ? getStatusText(status) : "thinking";
};

/**
 * Loading indicator component that displays the current status of a job
 * and execution details if available. Only shows when the current message is not streaming.
 *
 * @param status - Optional job status to display
 * @param agentName - Optional agent name to display
 * @param currentExecution - Optional current execution details
 * @param scrollToBottom - Optional function to scroll to the bottom of the chat
 * @param conversationId - Optional conversation ID to check for streaming messages
 */
export const LoadingIndicator: FC<{
	status?: JobStatus | null;
	agentName?: string;
	currentExecution?: AgentExecutionRecord | null;
	conversationId?: string;
	isSmallView?: boolean;
}> = memo(({ status, currentExecution, isSmallView }) => {
	const { getStreamingMessage } = useStreamingMessagesStore();
	const streamingMessage = getStreamingMessage(currentExecution?.id || "");
	const isStreaming = !!streamingMessage && !streamingMessage.isComplete;

	if (isStreaming) {
		// Don't show while streaming
		return null;
	}

	if (currentExecution?.action) {
		// Don't show while action is running
		return null;
	}

	let statusText: string;

	if (currentExecution) {
		if (currentExecution.message) {
			statusText = currentExecution.message;
		} else {
			statusText = getDetailedStatusText(status, currentExecution);
		}
	} else if (status) {
		statusText = getStatusText(status);
	} else {
		statusText = "Thinking";
	}

	return (
		<LoadingContainer isSmallView={isSmallView}>
			{!isSmallView && (
				<AgentAvatar>
					<Bot size={22} />
				</AgentAvatar>
			)}

			<ContentContainer>
				<StatusContainer>
					<StatusText variant="body2" isSmallView={isSmallView}>
						<StatusTextContent>{statusText}</StatusTextContent>
						<StatusControls>
							<DotContainer>
								<Dot delay={0} />
								<Dot delay={0.2} />
								<Dot delay={0.4} />
							</DotContainer>
						</StatusControls>
					</StatusText>
				</StatusContainer>
			</ContentContainer>
		</LoadingContainer>
	);
});
