import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import type { OutputBlockProps } from "./types";

const CodeContainer = styled(Box)({
	marginBottom: 16,
	width: "100%",
});

const SectionLabel = styled(Typography)(({ theme }) => ({
	display: "block",
	marginBottom: 4,
	color: theme.palette.text.secondary,
}));

const OutputContainer = styled(Box)({
	fontFamily: '"Roboto Mono", monospace',
	fontSize: "0.85rem",
	backgroundColor: "rgba(0, 0, 0, 0.3)",
	borderRadius: "8px",
	padding: 12,
	maxHeight: "300px",
	overflow: "auto",
	whiteSpace: "pre",
	width: "100%",
	boxShadow: "0 2px 6px rgba(0, 0, 0, 0.15)",
	color: "inherit",
	overflowX: "auto",
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
});

/**
 * Component for displaying command output
 */
export const OutputBlock: FC<OutputBlockProps> = ({ output }) => {
	if (!output) return null;

	return (
		<CodeContainer>
			<SectionLabel variant="caption">Output</SectionLabel>
			<OutputContainer>{output}</OutputContainer>
		</CodeContainer>
	);
};
