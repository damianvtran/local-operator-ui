import { Box, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css"; // Import KaTeX CSS

type MarkdownStyleProps = {
	fontSize?: string;
	lineHeight?: number | string;
	paragraphSpacing?: string;
	headingScale?: number;
	codeSize?: string;
};

type MarkdownRendererProps = {
	content: string;
	styleProps?: MarkdownStyleProps;
};

const MarkdownContent = styled(Box, {
	shouldForwardProp: (prop) =>
		![
			"fontSize",
			"lineHeight",
			"paragraphSpacing",
			"headingScale",
			"codeSize",
		].includes(prop as string),
})<MarkdownStyleProps>(
	({
		fontSize = "1.05rem",
		lineHeight = 1.6,
		paragraphSpacing = "8px",
		headingScale = 1,
		codeSize = "0.85em",
		theme,
	}) => ({
		wordBreak: "break-word",
		overflowWrap: "break-word",
		lineHeight,
		fontSize,
		color: theme.palette.text.primary,
		"& code": {
			fontFamily: '"Roboto Mono", monospace',
			backgroundColor:
				theme.palette.mode === "light"
					? alpha(theme.palette.grey[300], 0.7)
					: alpha(theme.palette.common.black, 0.3),
			padding: "3px 6px",
			borderRadius: "4px",
			fontSize: codeSize,
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
			color:
				theme.palette.mode === "light"
					? theme.palette.grey[900]
					: theme.palette.common.white,
		},
		"& pre": {
			backgroundColor:
				theme.palette.mode === "light"
					? alpha(theme.palette.grey[200], 0.7)
					: alpha(theme.palette.common.black, 0.3),
			padding: "16px",
			borderRadius: "8px",
			overflowX: "auto",
			fontFamily: '"Roboto Mono", monospace',
			fontSize: codeSize,
			margin: "12px 0",
			maxWidth: "100%",
			border: `1px solid ${
				theme.palette.mode === "light"
					? alpha(theme.palette.grey[400], 0.5)
					: alpha(theme.palette.common.white, 0.1)
			}`,
			boxShadow:
				theme.palette.mode === "light"
					? `0 2px 6px ${alpha(theme.palette.common.black, 0.05)}`
					: "none",
		},
		"& pre code": {
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
			backgroundColor: "transparent",
			padding: 0,
			borderRadius: 0,
			color:
				theme.palette.mode === "light"
					? theme.palette.grey[900]
					: theme.palette.common.white,
		},
		"& h1": {
			fontSize: `calc(1.5rem * ${headingScale})`,
			fontWeight: 600,
			margin: "20px 0 12px 0",
			borderBottom: `1px solid ${
				theme.palette.mode === "light"
					? alpha(theme.palette.grey[300], 0.7)
					: alpha(theme.palette.common.white, 0.1)
			}`,
			paddingBottom: "8px",
			color: theme.palette.text.primary,
		},
		"& h2": {
			fontSize: `calc(1.3rem * ${headingScale})`,
			fontWeight: 600,
			margin: "18px 0 10px 0",
			color: theme.palette.text.primary,
		},
		"& h3": {
			fontSize: `calc(1.1rem * ${headingScale})`,
			fontWeight: 600,
			margin: "16px 0 8px 0",
			color: theme.palette.text.primary,
		},
		"& ul": {
			paddingLeft: "24px",
			margin: "10px 0",
		},
		"& li": {
			margin: "4px 0",
		},
		"& a": {
			color: theme.palette.primary.main,
			textDecoration: "none",
			borderBottom: `1px dotted ${alpha(theme.palette.primary.main, 0.5)}`,
			transition: "all 0.2s ease",
			"&:hover": {
				textDecoration: "none",
				borderBottom: `1px solid ${theme.palette.primary.main}`,
				color: theme.palette.primary.light,
			},
		},
		"& strong": {
			fontWeight: 600,
			color:
				theme.palette.mode === "light"
					? theme.palette.grey[900]
					: theme.palette.common.white,
		},
		"& em": {
			fontStyle: "italic",
			color: theme.palette.text.primary,
		},
		"& br": {
			display: "block",
			content: '""',
			marginTop: "8px",
		},
		"& p:first-of-type": {
			marginTop: "2px",
		},
		"& p": {
			margin: `${paragraphSpacing} 0`,
			color: theme.palette.text.primary,
		},
		"& blockquote": {
			borderLeft: `4px solid ${
				theme.palette.mode === "light"
					? alpha(theme.palette.grey[400], 0.7)
					: alpha(theme.palette.primary.main, 0.5)
			}`,
			paddingLeft: "16px",
			margin: "16px 0",
			color: theme.palette.text.secondary,
			backgroundColor:
				theme.palette.mode === "light"
					? alpha(theme.palette.grey[100], 0.5)
					: alpha(theme.palette.background.paper, 0.2),
			borderRadius: "0 4px 4px 0",
			padding: "8px 16px",
		},
		"& table": {
			borderCollapse: "collapse",
			width: "100%",
			margin: "16px 0",
			border: `1px solid ${
				theme.palette.mode === "light"
					? alpha(theme.palette.grey[300], 0.7)
					: alpha(theme.palette.common.white, 0.1)
			}`,
		},
		"& th, & td": {
			border: `1px solid ${
				theme.palette.mode === "light"
					? alpha(theme.palette.grey[300], 0.7)
					: alpha(theme.palette.common.white, 0.1)
			}`,
			padding: "8px 12px",
			textAlign: "left",
		},
		"& th": {
			backgroundColor:
				theme.palette.mode === "light"
					? alpha(theme.palette.grey[200], 0.7)
					: alpha(theme.palette.common.black, 0.3),
			fontWeight: 600,
		},
		"& tr:nth-of-type(even)": {
			backgroundColor:
				theme.palette.mode === "light"
					? alpha(theme.palette.grey[100], 0.5)
					: alpha(theme.palette.common.black, 0.1),
		},
		// Math formula styling
		"& .math, & .math-inline, & .math-display": {
			color: theme.palette.text.primary,
		},
		"& .math-display": {
			margin: "16px 0",
			overflowX: "auto",
			padding: "8px 0",
		},
		// KaTeX specific styling for better theme integration
		"& .katex": {
			fontSize: "1.1em",
		},
	}),
);

/**
 * Converts plain URLs in text to markdown links if they're not already part of a markdown link,
 * ensuring that trailing quotes and sentence punctuation remain outside the hyperlink.
 *
 * @param text - The text to process.
 * @returns Text with plain URLs converted to markdown links, preserving trailing punctuation.
 */
const convertUrlsToMarkdownLinks = (text: string): string => {
	// Regex to match URLs that are not already part of markdown links.
	// Captures optional trailing punctuation (e.g., commas, periods, quotes, and parentheses)
	// in a separate group so that only the URL itself is hyperlinked.

	const markdownLinkRegex =
		/(?<!\]\()(https?:\/\/\S+?)([,.;:!?"'\)\]]+)?(?=\s|$)/g;

	if (markdownLinkRegex.test(text)) {
		return text;
	}

	const urlRegex = /(?<!\]\()(https?:\/\/\S+?)([,.;:!?"'\)\]]+)?(?=\s|$)/g;

	// Replace plain URLs with markdown links, appending any captured trailing punctuation.
	return text.replace(
		urlRegex,
		(_match, url, punctuation) => `[${url}](${url})${punctuation || ""}`,
	);
};

/**
 * Memoized component for rendering markdown content with styled HTML.
 * Features:
 * - Only re-renders when the content changes
 * - Automatically converts plain URLs to clickable links
 * - Supports GitHub Flavored Markdown (tables, strikethrough, task lists, etc.) via remark-gfm
 * - Supports mathematical expressions via remark-math and rehype-katex
 * - Handles light and dark mode styling for all markdown elements
 * - Opens external links in a new tab with proper security attributes
 *
 * @param content - The markdown content to render
 * @param styleProps - Optional styling properties to override default styles
 */
export const MarkdownRenderer: FC<MarkdownRendererProps> = memo(
	({ content, styleProps }) => {
		// Process the content to convert plain URLs to markdown links
		const processedContent = useMemo(() => {
			return convertUrlsToMarkdownLinks(content.trim());
		}, [content]);

		return (
			<MarkdownContent {...styleProps}>
				<ReactMarkdown
					remarkPlugins={[remarkGfm, remarkMath]}
					rehypePlugins={[rehypeKatex]}
					components={{
						a: ({ href, children }) => (
							<a href={href} target="_blank" rel="noopener noreferrer">
								{children}
							</a>
						),
					}}
				>
					{processedContent}
				</ReactMarkdown>
			</MarkdownContent>
		);
	},
);

export default MarkdownRenderer;
