import { cn } from "@shared/lib/utils";
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
		<div className={cn("overflow-auto px-8 py-4")}>
			<MarkdownRenderer content={document.content} />
		</div>
	);
};
