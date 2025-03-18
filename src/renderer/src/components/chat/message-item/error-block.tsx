import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { ErrorBlockProps } from "./types";

const CodeContainer = styled(Box)({
	marginBottom: 16,
	width: "100%",
});

const SectionLabel = styled(Typography)(({ theme }) => ({
	display: "block",
	marginBottom: 4,
	color: theme.palette.error.light,
}));

const ErrorContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<{ isUser: boolean }>(({ isUser, theme }) => ({
	fontFamily: '"Roboto Mono", monospace',
	fontSize: "0.85rem",
	backgroundColor: "rgba(255, 0, 0, 0.1)",
	borderRadius: "8px",
	padding: 12,
	maxHeight: "200px",
	overflow: "auto",
	whiteSpace: "pre-wrap",
	color: isUser ? theme.palette.error.main : theme.palette.error.light,
	width: "100%",
	boxShadow: "0 2px 6px rgba(0, 0, 0, 0.15)",
	"&::-webkit-scrollbar": {
		width: "6px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		borderRadius: "3px",
	},
}));

/**
 * Component for displaying error messages
 */
export const ErrorBlock: FC<ErrorBlockProps> = ({ error, isUser }) => {
	if (!error || error === "[No error output]") return null;

	return (
		<CodeContainer>
			<SectionLabel variant="caption">Error</SectionLabel>
			<ErrorContainer isUser={isUser}>{error}</ErrorContainer>
		</CodeContainer>
	);
};
