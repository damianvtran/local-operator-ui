import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Download, FileOutput, FileText, FileType } from "lucide-react";
import type { FC } from "react";
import { useCallback } from "react";
import type { CanvasDocument, ExportFormat } from "../../types/canvas";

type CanvasToolbarProps = {
	/**
	 * The currently active document
	 */
	document: CanvasDocument;
};

/**
 * Toolbar component for the markdown canvas
 * Provides document actions like export
 *
 * @deprecated This component is not yet in use and may change in future releases.
 */
export const CanvasToolbar: FC<CanvasToolbarProps> = ({ document }) => {
	// Handle exporting document
	const handleExport = useCallback(
		(format: ExportFormat) => {
			// TODO: Implement actual export functionality
			console.log(`Exporting ${document.title} as ${format}`);

			// For PDF export, we could use a library like jsPDF
			// For DOCX export, we could use a library like html-docx-js

			// For now, we'll just download the markdown file
			const blob = new Blob([document.content], { type: "text/markdown" });
			const url = URL.createObjectURL(blob);
			const a = window.document.createElement("a");
			a.href = url;
			a.download = `${document.title}.md`;
			a.click();
			URL.revokeObjectURL(url);
		},
		[document],
	);

	return (
		<div
			className={cn(
				"flex items-center justify-between gap-2 bg-surface px-4 py-2",
			)}
		>
			<span className={cn("truncate font-medium text-body-sm text-ink")}>
				{document.title}
			</span>
			<div className={cn("flex shrink-0 items-center gap-1")}>
				{/* Download original markdown file */}
				<Tooltip content="Download markdown">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => handleExport("md" as ExportFormat)}
					>
						<Download aria-hidden="true" />
						Download
					</Button>
				</Tooltip>

				{/* Export menu */}
				<DropdownMenu>
					<Tooltip content="Export document">
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="sm">
								<FileOutput aria-hidden="true" />
								Export
							</Button>
						</DropdownMenuTrigger>
					</Tooltip>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onSelect={() => handleExport("pdf")}>
							<FileText aria-hidden="true" />
							Export as PDF
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => handleExport("docx")}>
							<FileType aria-hidden="true" />
							Export as DOCX
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
};
