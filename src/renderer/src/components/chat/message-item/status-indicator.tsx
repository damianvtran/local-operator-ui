import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { StatusIndicatorProps } from "./types";

/**
 * Styled component for status indicators
 * Changes appearance based on the status type
 */
const StyledStatusIndicator = styled(Box, {
	shouldForwardProp: (prop) => prop !== "status",
})<{ status?: string }>(({ status, theme }) => ({
	marginTop: 8,
	display: "inline-block",
	paddingLeft: 8,
	paddingRight: 8,
	paddingTop: 4,
	paddingBottom: 4,
	borderRadius: "4px",
	fontSize: "0.75rem",
	backgroundColor:
		status === "error"
			? theme.palette.error.dark
			: status === "success"
				? theme.palette.success.dark
				: theme.palette.info.dark,
	color: "white",
	boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
}));

/**
 * Component for displaying status indicators
 * Shows the status of a message (error, success, etc.)
 */
export const StatusIndicator: FC<StatusIndicatorProps> = ({ status }) => {
	if (!status) return null;

	return (
		<StyledStatusIndicator status={status}>{status}</StyledStatusIndicator>
	);
};
