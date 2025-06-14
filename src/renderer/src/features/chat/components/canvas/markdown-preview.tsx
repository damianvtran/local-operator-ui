import { Box } from "@mui/material";
import type { FC } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { MarkdownRenderer } from "../markdown-renderer";

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
				padding: `${theme.spacing(2)} ${theme.spacing(4)}`,
				overflow: "auto",
			})}
		>
			<MarkdownRenderer content={document.content} />
		</Box>
	);
};
