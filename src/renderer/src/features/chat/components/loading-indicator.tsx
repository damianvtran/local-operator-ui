import type {
	AgentExecutionRecord,
	JobStatus,
} from "@shared/api/local-operator/types";
import { cn } from "@shared/lib/utils";
import { useStreamingMessagesStore } from "@shared/store/streaming-messages-store";
import { type FC, memo } from "react";
import { MessageAvatar } from "./message-item/message-avatar";
import { AGENT_GUTTER } from "./message-item/message-container";

/**
 * The waiting dots stagger their pulses with inline delays rather than three
 * separate keyframe definitions, which is all the Emotion version was doing.
 * Under reduced motion the base layer caps every animation, so the dots sit
 * still at full opacity — "thinking" is already carried by the text.
 */
const DELAY_BY_INDEX = [0, 200, 400] as const;

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

	return status ? getStatusText(status) : "thinking";
};

/**
 * The agent is working but has produced nothing to show yet.
 *
 * It sits on the agent rail — the same 40px gutter every agent row uses — and
 * carries the avatar, because it *is* the opening of an agent turn: the first
 * real row of that turn replaces it in place. Before this it drew a 40px
 * avatar of its own and indented the text another 16px, putting the status on
 * a left edge no other row in the list shared.
 *
 * @param status - Optional job status to display
 * @param agentName - Optional agent name to display
 * @param currentExecution - Optional current execution details
 * @param conversationId - Optional conversation ID to check for streaming messages
 * @param isSmallView - Whether to render the compact variant
 * @param className - Spacing, supplied by the list that owns the rhythm
 */
export const LoadingIndicator: FC<{
	status?: JobStatus | null;
	agentName?: string;
	currentExecution?: AgentExecutionRecord | null;
	conversationId?: string;
	isSmallView?: boolean;
	className?: string;
}> = memo(({ status, currentExecution, isSmallView, className }) => {
	const currentExecutionId = currentExecution?.id ?? "";
	const streamingMessage = useStreamingMessagesStore(
		(state) => state.streamingMessages[currentExecutionId] ?? null,
	);
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
		<div
			className={cn("relative w-full", !isSmallView && AGENT_GUTTER, className)}
		>
			{!isSmallView && <MessageAvatar className="absolute top-0 left-0" />}
			<p
				className={cn(
					"flex min-h-7 items-center break-words text-ink-muted",
					isSmallView ? "text-meta" : "text-body",
				)}
			>
				{statusText}
				<span className="ml-1 inline-flex items-center">
					{DELAY_BY_INDEX.map((delay) => (
						<span
							key={delay}
							className="mx-px size-1 animate-pulse rounded-full bg-ink-dim"
							style={{ animationDelay: `${delay}ms` }}
						/>
					))}
				</span>
			</p>
		</div>
	);
});

LoadingIndicator.displayName = "LoadingIndicator";
