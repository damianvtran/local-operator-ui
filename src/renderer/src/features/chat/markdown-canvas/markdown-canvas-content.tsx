import { Box, styled } from "@mui/material";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MarkdownDocument } from "./types";


type MarkdownCanvasContentProps = {
	/**
	 * The document to display
	 */
	document: MarkdownDocument;
};

/**
 * Styled content container
 */
const ContentContainer = styled(Box)(({ theme }) => ({
	flexGrow: 1,
	overflow: "auto",
	padding: theme.spacing(3),
	backgroundColor: theme.palette.background.paper,
	"& pre": {
		margin: theme.spacing(2, 0),
		borderRadius: theme.shape.borderRadius,
	},
	"& code": {
		fontFamily: '"Roboto Mono", monospace',
	},
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

/**
 * Content component for the markdown canvas
 * Displays the markdown content with syntax highlighting
 */
export const MarkdownCanvasContent: FC<MarkdownCanvasContentProps> = ({
	document,
}) => {
	const [html, setHtml] = useState<string>("");

	// Reference to the content container for scrolling
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const test = async () => {
			const html = await codeToHtml(document.content, {
				lang: "markdown",
				theme: "vitesse-dark",
			});
			setHtml(html);
		};

		test();
	}, [document.content]);

	// Scroll to top when document changes
	useEffect(() => {
		if (contentRef.current) {
			contentRef.current.scrollTop = 0;
		}
	}, [document.id]);

	// Custom style props for the markdown renderer
	const styleProps = useMemo(
		() => ({
			fontSize: "1rem",
			lineHeight: 1.6,
			paragraphSpacing: "12px",
			headingScale: 1.1,
			codeSize: "0.9em",
		}),
		[],
	);

	return (
		<ContentContainer ref={contentRef}>
			<Box dangerouslySetInnerHTML={{ __html: html }} />
		</ContentContainer>
	);
};
