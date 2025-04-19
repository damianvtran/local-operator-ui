import { Box } from "@mui/material";
import type { FC } from "react";
import { MarkdownRenderer } from "../markdown-renderer";
import type { CanvasDocument } from "./types";

type MarkdownPreviewProps = {
	/**
	 * The document to display
	 */
	document: CanvasDocument;
};

export const MarkdownPreview: FC<MarkdownPreviewProps> = ({ document }) => {
	return (
		<Box
			sx={(theme) => ({
				padding: `0 ${theme.spacing(2)}`,
				overflow: "auto",
			})}
		>
			<MarkdownRenderer content={document.content} />
		</Box>
	);
};
