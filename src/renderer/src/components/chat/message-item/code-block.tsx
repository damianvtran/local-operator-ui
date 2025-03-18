import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { createGlobalStyle } from "styled-components";
import { CollapsibleSection } from "./collapsible-section";
import type { CodeBlockProps } from "./types";

const CodeContainer = styled(Box)({
	marginBottom: 16,
	width: "100%",
});

const SectionLabel = styled(Typography)(({ theme }) => ({
	display: "block",
	marginBottom: 4,
	color: theme.palette.text.secondary,
}));

// Global style to ensure Roboto Mono is applied to syntax highlighter
const SyntaxHighlighterStyles = createGlobalStyle`
  .react-syntax-highlighter-code-block * {
    font-family: 'Roboto Mono', monospace !important;
  }
`;

/**
 * Component for displaying code with syntax highlighting
 * Can be collapsible for action type executions
 */
export const CodeBlock: FC<CodeBlockProps> = ({
	code,
	isUser,
	isAction = false,
}) => {
	if (!code) return null;

	const codeContent = (
		<>
			<SyntaxHighlighterStyles />
			<SyntaxHighlighter
				language="python"
				style={atomOneDark}
				customStyle={{
					borderRadius: "8px",
					fontSize: "0.85rem",
					width: "100%",
					boxShadow: "0 2px 6px rgba(0, 0, 0, 0.2)",
					padding: "0.75rem",
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
		</>
	);

	// If it's an action type execution, make it collapsible
	if (isAction) {
		return (
			<CollapsibleSection title="Code" defaultCollapsed={true} isUser={isUser}>
				{codeContent}
			</CollapsibleSection>
		);
	}

	// Otherwise, render normally
	return (
		<CodeContainer>
			<SectionLabel variant="caption">Code</SectionLabel>
			{codeContent}
		</CodeContainer>
	);
};
