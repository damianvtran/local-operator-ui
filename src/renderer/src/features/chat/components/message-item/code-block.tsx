import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { createGlobalStyle } from "styled-components";

/**
 * Props for the CodeBlock component
 */
export type CodeBlockProps = {
	code: string;
	isUser: boolean;
	language?: string;
	header?: string;
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

// Wrapper for the syntax highlighter with max height and custom scrollbars
const BlockScrollWrapper = styled(Box)(({ theme }) => ({
	maxHeight: 320,
	overflow: "auto",
	width: "100%",
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor:
			theme.palette.mode === "dark"
				? "rgba(255, 255, 255, 0.1)"
				: "rgba(0, 0, 0, 0.2)",
		borderRadius: "4px",
	},
}));

// Global style to ensure Roboto Mono is applied to syntax highlighter
const SyntaxHighlighterStyles = createGlobalStyle`
  .react-syntax-highlighter-code-block * {
    font-family: 'Roboto Mono', monospace !important;
  }
`;

/**
 * Component for displaying code with syntax highlighting
 *
 * @param code - The code string to display
 * @param isUser - Whether the code is from the user
 * @param language - Optional language for syntax highlighting
 * @param header - Optional header for the code block
 * @returns The rendered code block or null if no code is provided
 */
export const CodeBlock: FC<CodeBlockProps> = ({ code, language, header }) => {
	if (!code) return null;

	return (
		<CodeContainer>
			<SectionLabel variant="caption">{header || "Code"}</SectionLabel>
			<SyntaxHighlighterStyles />
			<BlockScrollWrapper>
				<SyntaxHighlighter
					language={language || "python"}
					style={atomOneDark}
					customStyle={{
						borderRadius: "8px",
						fontSize: "0.85rem",
						width: "100%",
						boxShadow: "0 2px 6px rgba(0, 0, 0, 0.2)",
						padding: "0.75rem",
						margin: 0,
					}}
					codeTagProps={{
						style: {
							fontFamily: '"Roboto Mono", monospace !important',
						},
					}}
					className="react-syntax-highlighter-code-block"
					wrapLines={true}
					wrapLongLines={true}
				>
					{code}
				</SyntaxHighlighter>
			</BlockScrollWrapper>
		</CodeContainer>
	);
};
