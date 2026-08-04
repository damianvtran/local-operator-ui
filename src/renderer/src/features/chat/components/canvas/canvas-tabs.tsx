import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { X } from "lucide-react";
import { type FC, memo, useCallback, useRef } from "react";
import type { CanvasDocument } from "../../types/canvas";

type CanvasTabsProps = {
	/**
	 * List of open documents
	 */
	documents: CanvasDocument[];

	/**
	 * ID of the currently active document
	 */
	activeDocumentId: string | null;

	/**
	 * Callback when a document tab is selected
	 */
	onChangeActiveDocument: (documentId: string) => void;

	/**
	 * Callback when a document tab is closed
	 */
	onCloseDocument: (documentId: string) => void;
};

/**
 * Tabs component for the markdown canvas
 * Displays a tab for each open document
 *
 * Hand-rolled rather than built on the `Tabs` primitive: each tab owns a close
 * button, and a button inside a button is invalid markup. This is the plain
 * button row the ARIA tabs pattern describes — roving tabindex, arrow keys,
 * `role="tab"` on the label and the close control as a sibling, not a child.
 *
 * Selection is a ground step: the strip is `sunken`, the selected tab is
 * `surface`. No indicator bar, no opacity ramp, nothing that moves.
 */
const CanvasTabsComponent: FC<CanvasTabsProps> = ({
	documents,
	activeDocumentId,
	onChangeActiveDocument,
	onCloseDocument,
}) => {
	const tabRefs = useRef(new Map<string, HTMLButtonElement>());

	// The active id can point at a document that has just been closed, so the
	// selection is derived rather than stored: falling back to the first tab
	// needs no effect and cannot render a frame with nothing selected.
	const selectedId =
		activeDocumentId && documents.some((doc) => doc.id === activeDocumentId)
			? activeDocumentId
			: (documents[0]?.id ?? null);

	const handleCloseTab = useCallback(
		(e: React.MouseEvent, documentId: string) => {
			e.stopPropagation(); // Prevent tab selection when closing
			onCloseDocument(documentId);
		},
		[onCloseDocument],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
			const last = documents.length - 1;
			let next: number;

			switch (event.key) {
				case "ArrowRight":
					next = index === last ? 0 : index + 1;
					break;
				case "ArrowLeft":
					next = index === 0 ? last : index - 1;
					break;
				case "Home":
					next = 0;
					break;
				case "End":
					next = last;
					break;
				default:
					return;
			}

			event.preventDefault();
			const nextDoc = documents[next];
			if (!nextDoc) return;
			tabRefs.current.get(nextDoc.id)?.focus();
			onChangeActiveDocument(nextDoc.id);
		},
		[documents, onChangeActiveDocument],
	);

	// If no documents, don't render tabs
	if (documents.length === 0) {
		return null;
	}

	return (
		<div
			role="tablist"
			aria-label="Markdown document tabs"
			aria-orientation="horizontal"
			className={cn(
				"flex w-full shrink-0 items-center gap-1 overflow-x-auto bg-sunken p-1",
			)}
		>
			{documents.map((doc, index) => {
				const isSelected = doc.id === selectedId;

				return (
					<div
						key={doc.id}
						role="presentation"
						className={cn(
							"flex shrink-0 items-center gap-0.5 rounded-sm pr-1",
							"transition-colors duration-fast ease-out-quart",
							isSelected && "bg-surface",
						)}
					>
						<button
							type="button"
							role="tab"
							aria-selected={isSelected}
							tabIndex={isSelected ? 0 : -1}
							title={doc.title}
							ref={(node) => {
								if (node) {
									tabRefs.current.set(doc.id, node);
								} else {
									tabRefs.current.delete(doc.id);
								}
							}}
							onClick={() => onChangeActiveDocument(doc.id)}
							onKeyDown={(event) => handleKeyDown(event, index)}
							className={cn(
								"max-w-[280px] truncate rounded-sm py-1.5 pl-2.5 pr-1",
								"text-left font-medium text-body-sm",
								"transition-colors duration-fast ease-out-quart",
								isSelected ? "text-ink" : "text-ink-muted hover:text-ink",
							)}
						>
							{doc.title}
						</button>

						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Close ${doc.title}`}
							onClick={(e) => handleCloseTab(e, doc.id)}
							className={cn(
								"size-5 [&_svg]:size-3",
								"hover:bg-danger-wash hover:text-danger",
							)}
						>
							<X aria-hidden="true" />
						</Button>
					</div>
				);
			})}
		</div>
	);
};

export const CanvasTabs = memo(CanvasTabsComponent);
