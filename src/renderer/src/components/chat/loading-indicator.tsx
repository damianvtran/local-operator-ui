import { keyframes } from "@emotion/react";
import {
	faChevronDown,
	faChevronUp,
	faRobot,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Avatar, Box, Button, Typography, styled } from "@mui/material";
import type {
	AgentExecutionRecord,
	JobStatus,
} from "@renderer/api/local-operator/types";
import { useScrollToBottom } from "@renderer/hooks/use-scroll-to-bottom";
import type { FC } from "react";
import { useEffect, useState } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { createGlobalStyle } from "styled-components";

// Global style to ensure Roboto Mono is applied to syntax highlighter
const SyntaxHighlighterStyles = createGlobalStyle`
  .loading-syntax-highlighter * {
    font-family: 'Roboto Mono', monospace !important;
  }
`;

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
const LoadingContainer = styled(Box)(() => ({
	display: "flex",
	alignItems: "center",
	gap: 0,
}));

const AgentAvatar = styled(Avatar)(({ theme }) => ({
	backgroundColor: "rgba(56, 201, 106, 0.2)",
	color: theme.palette.primary.main,
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

const StatusText = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	display: "flex",
	marginLeft: 16,
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

const CodeToggleButton = styled(Button)(({ theme }) => ({
	color: theme.palette.text.secondary,
	padding: "0 4px",
	minWidth: "auto",
	textTransform: "none",
	marginLeft: 8,
	height: "auto",
	fontSize: "0.75rem",
	lineHeight: 1,
	opacity: 0.7,
	borderRadius: "12px",
	transition: "all 0.2s ease",
	position: "relative",
	zIndex: 2,
	"&:hover": {
		backgroundColor: "transparent",
		opacity: 1,
		color: theme.palette.primary.light,
	},
	"& .MuiButton-startIcon": {
		marginRight: 2,
		marginLeft: 0,
	},
}));

const CodeContainer = styled(Box)(() => ({
	maxWidth: "100%",
	marginLeft: 16,
	marginTop: 8,
}));

/**
 * Component for displaying code with syntax highlighting in the loading indicator
 */
const LoadingCodeBlock: FC<{ code: string }> = ({ code }) => {
	if (!code) return null;

	return (
		<Box
			sx={{
				width: "100%",
				maxHeight: "300px",
				overflow: "auto",
				"&::-webkit-scrollbar": {
					width: "6px",
					height: "6px",
				},
				"&::-webkit-scrollbar-thumb": {
					backgroundColor: "rgba(255, 255, 255, 0.1)",
					borderRadius: "3px",
				},
				"&::-webkit-scrollbar-corner": {
					backgroundColor: "rgba(0, 0, 0, 0.3)",
				},
				borderRadius: "8px",
			}}
		>
			<SyntaxHighlighterStyles />
			<SyntaxHighlighter
				language="python"
				style={atomOneDark}
				customStyle={{
					fontSize: "0.85rem",
					width: "100%",
					boxShadow: "0 2px 6px rgba(0, 0, 0, 0.2)",
					padding: "0.75rem",
					margin: 0, // Remove margin to make it more compact
				}}
				codeTagProps={{
					style: {
						fontFamily: '"Roboto Mono", monospace !important',
					},
				}}
				className="loading-syntax-highlighter"
				wrapLines={true}
				wrapLongLines={true}
			>
				{code}
			</SyntaxHighlighter>
		</Box>
	);
};

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
 * and execution details if available
 *
 * @param status - Optional job status to display
 * @param agentName - Optional agent name to display
 * @param currentExecution - Optional current execution details
 * @param scrollToBottom - Optional function to scroll to the bottom of the chat
 */
export const LoadingIndicator: FC<{
	status?: JobStatus | null;
	agentName?: string;
	currentExecution?: AgentExecutionRecord | null;
	scrollToBottom?: () => void;
}> = ({ status, currentExecution, scrollToBottom }) => {
	// Get detailed status text based on current execution if available
	const statusText = currentExecution
		? getDetailedStatusText(status, currentExecution)
		: status
			? getStatusText(status)
			: "Thinking";

	// Get code snippet if available
	const codeSnippet = currentExecution?.code || null;

	// Get message if available
	const message = currentExecution?.message || null;

	// State to track if code is expanded
	const [isCodeExpanded, setIsCodeExpanded] = useState(false);

	// Use the scroll to bottom hook with status and execution as dependencies
	// This will automatically scroll to bottom when status changes if user is near bottom
	const { ref, scrollToBottom: scrollToBottomHook } = useScrollToBottom(
		[status, currentExecution, message],
		300, // Default threshold
		50, // Default button threshold
	);

	// Effect to scroll to bottom when code is expanded
	useEffect(() => {
		if (codeSnippet && isCodeExpanded) {
			// Use requestAnimationFrame to ensure the DOM has been updated
			requestAnimationFrame(() => {
				// Use the hook's scrollToBottom if available, otherwise use the prop
				if (scrollToBottomHook) {
					scrollToBottomHook();
				} else if (scrollToBottom) {
					scrollToBottom();
				}
			});
		}
	}, [codeSnippet, isCodeExpanded, scrollToBottom, scrollToBottomHook]);

	// Toggle code expansion
	const toggleCodeExpansion = () => {
		setIsCodeExpanded((prev) => !prev);
	};

	return (
		<LoadingContainer>
			{/* Invisible div for scroll reference */}
			<div ref={ref} style={{ height: 0, width: 0 }} />
			<AgentAvatar>
				<FontAwesomeIcon icon={faRobot} size="sm" />
			</AgentAvatar>

			<ContentContainer>
				<StatusContainer>
					<StatusText variant="body2">
						<StatusTextContent>
							{message ? message : `${statusText}`}
						</StatusTextContent>
						<StatusControls>
							<DotContainer>
								<Dot delay={0} />
								<Dot delay={0.2} />
								<Dot delay={0.4} />
							</DotContainer>

							{codeSnippet && (
								<CodeToggleButton
									onClick={toggleCodeExpansion}
									size="small"
									variant="text"
									startIcon={
										<FontAwesomeIcon
											icon={isCodeExpanded ? faChevronUp : faChevronDown}
											size="xs"
											style={{ fontSize: "0.75rem" }}
										/>
									}
								>
									{isCodeExpanded ? "(Hide code)" : "(Show code)"}
								</CodeToggleButton>
							)}
						</StatusControls>
					</StatusText>
				</StatusContainer>

				{codeSnippet && isCodeExpanded && (
					<CodeContainer>
						<LoadingCodeBlock code={codeSnippet} />
					</CodeContainer>
				)}
			</ContentContainer>
		</LoadingContainer>
	);
};
