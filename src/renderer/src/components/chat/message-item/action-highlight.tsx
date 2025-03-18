import { faCheck, faQuestion } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { ActionHighlightProps } from "./types";

const HighlightContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "action" && prop !== "isUser",
})<{ action: string; isUser: boolean }>(({ action }) => ({
	position: "relative",
	padding: "16px",
	borderRadius: "8px",
	marginBottom: "16px",
	boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
	border: `1px solid ${
		action === "DONE" ? "rgba(76, 175, 80, 0.5)" : "rgba(33, 150, 243, 0.5)"
	}`,
	backgroundColor:
		action === "DONE" ? "rgba(76, 175, 80, 0.1)" : "rgba(33, 150, 243, 0.1)",
	transition: "all 0.2s ease",
	"&:hover": {
		boxShadow: "0 6px 16px rgba(0, 0, 0, 0.2)",
	},
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
		action === "DONE" ? theme.palette.success.main : theme.palette.info.main,
	color: "#fff",
	display: "flex",
	alignItems: "center",
	gap: "4px",
	boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
}));

/**
 * Component for highlighting DONE and ASK action types
 * Adds a prominent visual styling to indicate user interaction
 */
export const ActionHighlight: FC<ActionHighlightProps> = ({
	children,
	action,
	isUser,
}) => {
	// Only apply special highlighting for DONE and ASK actions
	if (action !== "DONE" && action !== "ASK") {
		return <>{children}</>;
	}

	return (
		<HighlightContainer action={action} isUser={isUser}>
			<ActionBadge action={action}>
				<FontAwesomeIcon
					icon={action === "DONE" ? faCheck : faQuestion}
					size="xs"
				/>
				{action === "DONE" ? "COMPLETED" : "QUESTION"}
			</ActionBadge>
			{children}
		</HighlightContainer>
	);
};
