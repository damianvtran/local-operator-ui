import { faRobot } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Avatar,
	Box,
	CircularProgress,
	Tooltip,
	Typography,
} from "@mui/material";
import type {
	AgentExecutionRecord,
	JobStatus,
} from "@renderer/api/local-operator/types";
import type { FC } from "react";

/**
 * Get a user-friendly text representation of a job status
 *
 * @param status - The job status
 * @returns A user-friendly text representation
 */
const getStatusText = (status: JobStatus): string => {
	switch (status) {
		case "pending":
			return "waiting to start";
		case "processing":
			return "thinking";
		case "completed":
			return "finishing up";
		case "failed":
			return "having trouble";
		case "cancelled":
			return "was cancelled";
		default:
			return "thinking";
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
				return "executing code";
			case "WRITE":
				return "writing content";
			case "EDIT":
				return "editing content";
			case "READ":
				return "reading content";
			case "ASK":
				return "formulating a question";
			case "DONE":
				return "completing the task";
			case "BYE":
				return "ending the conversation";
		}
	}

	// If no action but we have execution type, use that
	if (execution.execution_type) {
		switch (execution.execution_type) {
			case "plan":
				return "planning the approach";
			case "action":
				return "taking action";
			case "reflection":
				return "analyzing results";
			case "response":
				return "generating a response";
			case "security_check":
				return "performing security checks";
			case "classification":
				return "classifying the request";
			case "system":
				return "processing system tasks";
			case "user_input":
				return "processing your input";
		}
	}

	// Fall back to basic status
	return status ? getStatusText(status) : "thinking";
};

/**
 * Truncate code to a specified length with ellipsis
 *
 * @param code - The code to truncate
 * @param maxLength - Maximum length before truncation
 * @returns Truncated code string
 */
const truncateCode = (code: string, maxLength: number): string => {
	if (!code) return "";

	// Remove extra whitespace and newlines
	const cleanCode = code.trim().replace(/\s+/g, " ");

	if (cleanCode.length <= maxLength) {
		return cleanCode;
	}

	return `${cleanCode.substring(0, maxLength)}...`;
};

/**
 * Loading indicator component that displays the current status of a job
 * and execution details if available
 *
 * @param status - Optional job status to display
 * @param agentName - Optional agent name to display
 * @param currentExecution - Optional current execution details
 */
export const LoadingIndicator: FC<{
	status?: JobStatus | null;
	agentName?: string;
	currentExecution?: AgentExecutionRecord | null;
}> = ({ status, agentName = "Agent", currentExecution }) => {
	// Get detailed status text based on current execution if available
	const statusText = currentExecution
		? getDetailedStatusText(status, currentExecution)
		: status
			? getStatusText(status)
			: "thinking";

	// Get code snippet if available
	const codeSnippet = currentExecution?.code
		? truncateCode(currentExecution.code, 50)
		: null;

	// Get message if available
	const message = currentExecution?.message || null;

	return (
		<Box
			sx={{
				display: "flex",
				alignItems: "flex-start",
				gap: 2,
			}}
		>
			<Avatar
				sx={{
					bgcolor: "rgba(56, 201, 106, 0.2)",
					color: "primary.main",
				}}
			>
				<FontAwesomeIcon icon={faRobot} size="sm" />
			</Avatar>

			<Box
				sx={{
					bgcolor: "background.paper",
					p: 2,
					borderRadius: 2,
					border: "1px solid rgba(255, 255, 255, 0.1)",
					display: "flex",
					flexDirection: "column",
					gap: 1,
					maxWidth: "calc(100% - 60px)",
				}}
			>
				<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
					<CircularProgress size={16} color="primary" />
					<Typography variant="body2">
						{`${agentName} is ${statusText}...`}
					</Typography>
				</Box>

				{codeSnippet && (
					<Box
						sx={{
							bgcolor: "rgba(0, 0, 0, 0.2)",
							p: 1,
							borderRadius: 1,
							fontFamily: "monospace",
							fontSize: "0.8rem",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{/* @ts-ignore - MUI Tooltip type issue */}
						<Tooltip title={currentExecution?.code || ""} placement="bottom">
							<Typography variant="body2" sx={{ fontFamily: "monospace" }}>
								{codeSnippet}
							</Typography>
						</Tooltip>
					</Box>
				)}

				{message && (
					<Typography
						variant="body2"
						sx={{
							fontStyle: "italic",
							fontSize: "0.8rem",
							color: "text.secondary",
						}}
					>
						{message}
					</Typography>
				)}
			</Box>
		</Box>
	);
};
