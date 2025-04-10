import { Box, Typography, alpha } from "@mui/material";
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
	backgroundColor: alpha(
		theme.palette.error.main,
		theme.palette.mode === "dark" ? 0.1 : 0.05,
	),
	borderRadius: "8px",
	padding: 12,
	maxHeight: "200px",
	overflow: "auto",
	whiteSpace: "pre-wrap",
	color: isUser ? theme.palette.error.main : theme.palette.error.light,
	width: "100%",
	boxShadow: `0 2px 6px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.15 : 0.1)}`,
	"&::-webkit-scrollbar": {
		width: "6px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: alpha(
			theme.palette.mode === "dark"
				? theme.palette.common.white
				: theme.palette.common.black,
			0.1,
		),
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
