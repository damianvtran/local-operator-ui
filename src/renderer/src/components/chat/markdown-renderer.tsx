import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";

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
	}) => ({
		wordBreak: "break-word",
		overflowWrap: "break-word",
		lineHeight,
		fontSize,
		"& code": {
			fontFamily: '"Roboto Mono", monospace',
			backgroundColor: "rgba(0, 0, 0, 0.3)",
			padding: "3px 6px",
			borderRadius: "4px",
			fontSize: codeSize,
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
			color: "#e6e6e6",
		},
		"& pre": {
			backgroundColor: "rgba(0, 0, 0, 0.3)",
			padding: "16px",
			borderRadius: "8px",
			overflowX: "auto",
			fontFamily: '"Roboto Mono", monospace',
			fontSize: codeSize,
			margin: "12px 0",
			maxWidth: "100%",
			border: "1px solid rgba(255, 255, 255, 0.1)",
		},
		"& pre code": {
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
			backgroundColor: "transparent",
			padding: 0,
			borderRadius: 0,
		},
		"& h1": {
			fontSize: `calc(1.5rem * ${headingScale})`,
			fontWeight: 600,
			margin: "20px 0 12px 0",
			borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
			paddingBottom: "8px",
		},
		"& h2": {
			fontSize: `calc(1.3rem * ${headingScale})`,
			fontWeight: 600,
			margin: "18px 0 10px 0",
		},
		"& h3": {
			fontSize: `calc(1.1rem * ${headingScale})`,
			fontWeight: 600,
			margin: "16px 0 8px 0",
		},
		"& ul": {
			paddingLeft: "24px",
			margin: "10px 0",
		},
		"& li": {
			margin: "4px 0",
		},
		"& a": {
			color: "#90caf9",
			textDecoration: "none",
			borderBottom: "1px dotted rgba(144, 202, 249, 0.5)",
			transition: "all 0.2s ease",
			"&:hover": {
				textDecoration: "none",
				borderBottom: "1px solid #90caf9",
				color: "#bbdefb",
			},
		},
		"& strong": {
			fontWeight: 600,
			color: "#e6e6e6",
		},
		"& em": {
			fontStyle: "italic",
			color: "#e0e0e0",
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
 * Memoized component for rendering markdown content with styled HTML
 * Only re-renders when the content changes
 * Automatically converts plain URLs to clickable links
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
