import { Box, Typography } from "@mui/material";
import { alpha, styled } from "@mui/material/styles";
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
  flexDirection?: "column" | "column-reverse";
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

/**
 * Wrapper for the syntax highlighter with max height and custom scrollbars.
 * 
 * @param theme - The MUI theme object injected by the styled utility.
 * @param flexDirection - The flex direction for the wrapper ("column" or "column-reverse").
 * @returns The style object for the BlockScrollWrapper.
 * @throws {Error} If theme is not provided by the styled utility.
 */
const BlockScrollWrapper = styled(Box, {
	shouldForwardProp: (prop) => prop !== "flexDirection",
})<{ flexDirection?: "column" | "column-reverse" }>(({ theme, flexDirection }) => {
		if (!theme) {
			throw new Error("Theme is required for BlockScrollWrapper styles.");
		}
		return {
			maxHeight: 320,
			overflowY: "auto",
			width: "100%",
      borderRadius: "8px",
			"&::-webkit-scrollbar": {
        width: "6px",
        height: "6px",
      },
      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.2)",
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
        backgroundColor: theme.palette.mode === "dark" 
          ? "#282c34" 
          : theme.palette.grey[200],
      },
      display: "flex",
			flexDirection: flexDirection || "column",
      whiteSpace: "pre",
		};
	},
);

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
export const CodeBlock: FC<CodeBlockProps> = ({ code, language, header, flexDirection = "column" }) => {
	if (!code) return null;

	return (
		<CodeContainer>
			<SectionLabel variant="caption">{header || "Code"}</SectionLabel>
			<SyntaxHighlighterStyles />
			<BlockScrollWrapper flexDirection={flexDirection}>
				<SyntaxHighlighter
					language={language || "python"}
					style={atomOneDark}
					customStyle={{
						borderRadius: "8px",
						fontSize: "0.85rem",
						width: "100%",
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
