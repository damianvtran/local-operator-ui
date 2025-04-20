import { faCheck, faQuestion } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC, ReactNode } from "react";
import type { ActionType, ExecutionType } from "@shared/api/local-operator/types";

/**
 * Props for the ActionHighlight component
 */
export type ActionHighlightProps = {
	children: ReactNode;
	action: ActionType;
	taskClassification: string;
	isUser: boolean;
	executionType?: ExecutionType;
};

const HighlightContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "action" && prop !== "isUser",
})<{ action: string; isUser: boolean }>(() => ({
	marginBottom: "16px",
}));

const ActionBadge = styled(Box, {
	shouldForwardProp: (prop) => prop !== "action",
})<{ action: string }>(({ theme, action }) => ({
	padding: "4px 8px",
	borderRadius: "12px",
	fontSize: "0.7rem",
	fontWeight: "bold",
	backgroundColor:
		action === "DONE"
			? alpha(theme.palette.actionHighlight.done.border, 1.0)
			: alpha(theme.palette.actionHighlight.ask.border, 1.0),
	color: "#fff",
	display: "flex",
	alignItems: "center",
	justifyContent: "flex-end",
	gap: "4px",
	boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
	marginBottom: "8px", // Add space between badge and content
	alignSelf: "flex-end", // Align to the right
	width: "fit-content", // Only take up as much width as needed
}));
/**
 * Component for highlighting DONE and ASK action types
 * Adds a prominent visual styling to indicate user interaction or final responses
 */
export const ActionHighlight: FC<ActionHighlightProps> = ({
	children,
	action,
	isUser,
	taskClassification,
	executionType,
}) => {
	// Highlight messages that are:
	// 1. Action is DONE or ASK
	// 2. Task classification is not conversation or continue
	// 3. Execution type is response
	const shouldHighlight =
		(action === "DONE" || action === "ASK") &&
		taskClassification !== "conversation" &&
		taskClassification !== "continue" &&
		executionType === "response";

	// Only apply special highlighting when conditions are met
	if (!shouldHighlight) {
		return <>{children}</>;
	}

	return (
		<HighlightContainer action={action} isUser={isUser}>
			<ActionBadge action={action}>
				<FontAwesomeIcon
					icon={action === "DONE" ? faCheck : faQuestion}
					size="xs"
				/>
				{action === "DONE" ? "COMPLETE" : "QUESTION"}
			</ActionBadge>
			{children}
		</HighlightContainer>
	);
};
