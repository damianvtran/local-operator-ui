import { Box, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";

/**
 * Props for the OutputBlock component
 */
export type OutputBlockProps = {
	output: string;
	isUser: boolean;
};

const CodeContainer = styled(Box)({
	marginBottom: 16,
	width: "100%",
});

const SectionLabel = styled(Typography)(({ theme }) => ({
	display: "block",
	marginBottom: 4,
	color: theme.palette.text.secondary,
}));

const OutputContainer = styled(Box)(({ theme }) => ({
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
	maxHeight: "300px",
	overflow: "auto",
	whiteSpace: "pre",
	width: "100%",
	boxShadow: `0 2px 6px ${alpha(
		theme.palette.common.black,
		theme.palette.mode === "dark" ? 0.15 : 0.1,
	)}`,
	color: theme.palette.text.primary,
	overflowX: "auto",
	display: "flex",
	flexDirection: "column-reverse",
	"&::-webkit-scrollbar": {
		width: "6px",
		height: "6px",
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
	"&::-webkit-scrollbar-corner": {
		backgroundColor: alpha(
			theme.palette.mode === "dark"
				? theme.palette.common.black
				: theme.palette.grey[200],
			theme.palette.mode === "dark" ? 0.3 : 0.5,
		),
	},
}));

/**
 * Component for displaying command output
 *
 * @param output - The output string to display.
 * @param isUser - Whether the output is from the user.
 * @returns The output block component.
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
