import { faCheck, faQuestion } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { ActionHighlightProps } from "./types";

const HighlightContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "action" && prop !== "isUser",
})<{ action: string; isUser: boolean }>(() => ({
	position: "relative",
	width: "calc(100% - 102px)",
	marginBottom: "16px",
	zIndex: 0, // Ensure container is below badge
}));

const ActionBadge = styled(Box, {
	shouldForwardProp: (prop) => prop !== "action",
})<{ action: string }>(({ theme, action }) => ({
	position: "absolute",
	top: "-10px",
	right: "16px",
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
	gap: "4px",
	boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
	zIndex: 1, // Ensure badge is above other content
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
