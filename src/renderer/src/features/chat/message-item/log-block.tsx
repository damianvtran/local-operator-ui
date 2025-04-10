import { Box, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { LogBlockProps } from "./types";

const CodeContainer = styled(Box)({
	marginBottom: 16,
	width: "100%",
});

const SectionLabel = styled(Typography)(({ theme }) => ({
	display: "block",
	marginBottom: 4,
	color: theme.palette.text.secondary,
}));

const LogContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<{ isUser: boolean }>(({ isUser, theme }) => ({
	fontFamily: '"Roboto Mono", monospace',
	fontSize: "0.85rem",
	backgroundColor: alpha(
		theme.palette.mode === "dark"
			? theme.palette.common.black
			: theme.palette.grey[200],
		theme.palette.mode === "dark" ? 0.3 : 0.5,
	),
	borderRadius: "8px",
	padding: 12,
	maxHeight: "200px",
	overflow: "auto",
	whiteSpace: "pre-wrap",
	color: isUser ? theme.palette.info.main : theme.palette.info.light,
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
 * Component for displaying log messages
 */
export const LogBlock: FC<LogBlockProps> = ({ log, isUser }) => {
	if (!log || log === "[No logger output]") return null;

	return (
		<CodeContainer>
			<SectionLabel variant="caption">Logs</SectionLabel>
			<LogContainer isUser={isUser}>{log}</LogContainer>
		</CodeContainer>
	);
};
