import { Box } from "@mui/material";
import type { FC } from "react";
import type { CanvasDocument } from "./types";
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
				padding: `0 ${theme.spacing(2)}`,
				overflow: "auto",
				background: theme.palette.common.white,
			})}
		>
			<MarkdownRenderer content={document.content} />
		</Box>
	);
};
