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
				padding: `0 ${theme.spacing(2)}`,
				overflow: "auto",

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
			})}
		>
			<MarkdownRenderer content={document.content} />
		</Box>
	);
};
