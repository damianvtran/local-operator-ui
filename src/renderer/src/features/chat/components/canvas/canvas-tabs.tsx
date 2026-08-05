import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Check, ChevronDown, X } from "lucide-react";
import { type FC, memo, useCallback, useEffect, useRef } from "react";
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
 * The two halves of the canvas tab relationship.
 *
 * The strip is here and the document panel is in `canvas/index.tsx`, so there
 * is no shared root to mint ids from the way Radix's `Tabs` would. `role="tab"`
 * used to name no region at all, which left a screen reader announcing a
 * selection whose target it could not describe.
 */
export const CANVAS_SELECTED_TAB_ID = "canvas-selected-tab";
export const CANVAS_DOCUMENT_PANEL_ID = "canvas-document-panel";

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
 * `surface`, and the strip's bottom hairline stops at nothing, so the selected
 * tab reads as continuous with the document below it. No indicator bar, no
 * opacity ramp, nothing that moves.
 *
 * ## Three things the strip has to survive a lot of tabs
 *
 * 1. **The close control is not always drawn.** Six tabs used to mean six ✕
 *    glyphs competing with the file names they belong to. It now appears on
 *    the selected tab and on hover or keyboard focus, which is what VS Code,
 *    Zed and Safari all do. Reserved width is unchanged either way, so
 *    revealing it never reflows the strip.
 * 2. **Overflow is scrolled, and says so.** The row scrolls horizontally with
 *    no scrollbar, and a mask fades the last few pixels so a clipped tab reads
 *    as "there is more" rather than as a rendering bug. The selected tab is
 *    scrolled into view when it changes.
 * 3. **There is a pinned way to reach any tab.** A single overflow menu sits
 *    outside the scrolling row, in a fixed place, listing every open document
 *    with the current one ticked — Zed's tab-bar overflow control. Scrolling
 *    sideways to find a file is a fallback, not the only route.
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

	// A tab selected from the overflow menu, or opened by the agent, is often
	// outside the scrolled viewport. `nearest` scrolls only when it has to, so
	// clicking a visible tab never shifts the strip under the cursor.
	useEffect(() => {
		if (!selectedId) return;
		tabRefs.current.get(selectedId)?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}, [selectedId]);

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
		<div className={cn("flex shrink-0 items-stretch border-hairline border-b")}>
			<div
				role="tablist"
				aria-label="Open documents"
				aria-orientation="horizontal"
				className={cn(
					"flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto bg-sunken px-1 py-1",
					// Native scrollbars steal 15px from a 32px strip and appear only
					// on some platforms, so the strip is scrolled without one and the
					// mask is what says the row continues.
					"[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
					"[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]",
				)}
			>
				{documents.map((doc, index) => {
					const isSelected = doc.id === selectedId;

					return (
						<div
							key={doc.id}
							role="presentation"
							// 24px inside the strip's `p-1` is the segmented-control
							// geometry `TabsList`/`TabsTrigger` already ship: same 32px
							// track, same 24px tab. A half-step taller here would be a
							// second tab height for no reason a user could name.
							className={cn(
								"group flex h-6 shrink-0 items-center rounded-sm pr-0.5",
								"transition-colors duration-fast ease-out-quart",
								isSelected ? "bg-surface" : "hover:bg-elevated",
							)}
						>
							<button
								type="button"
								role="tab"
								aria-selected={isSelected}
								// Both ends of the relationship are keyed on one pair of
								// constants rather than on the document id, for two
								// reasons. Document ids are file paths, and a path with a
								// space in it cannot be written into an id-reference list
								// at all. And the panel is rendered by `canvas/index.tsx`,
								// which derives its own selection from `activeDocumentId`
								// while this strip falls back to the first tab — keying on
								// "the selected one" is the only form the two cannot
								// disagree about. Exactly one tab is selected, so the id
								// stays unique, and the unselected tabs carry no
								// `aria-controls` because only the selected document's
								// panel is mounted.
								id={isSelected ? CANVAS_SELECTED_TAB_ID : undefined}
								aria-controls={
									isSelected ? CANVAS_DOCUMENT_PANEL_ID : undefined
								}
								tabIndex={isSelected ? 0 : -1}
								title={doc.path ?? doc.title}
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
									"max-w-45 truncate rounded-sm py-1 pr-1 pl-2",
									"text-left font-medium text-body-sm",
									"transition-colors duration-fast ease-out-quart",
									isSelected ? "text-ink" : "text-ink-muted",
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
									// Hidden until the tab is the one in play or the one
									// being pointed at. `pointer-events` rather than
									// `visibility` so the control stays keyboard-reachable
									// and reveals itself when it takes focus.
									!isSelected && [
										"pointer-events-none opacity-0",
										"group-hover:pointer-events-auto group-hover:opacity-100",
										"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
									],
								)}
							>
								<X aria-hidden="true" />
							</Button>
						</div>
					);
				})}
			</div>

			{documents.length > 1 && (
				<DropdownMenu>
					<Tooltip content="All open files">
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="All open files"
								// No vertical margin: `icon-sm` is 28px, which already
								// centres inside the 32px strip. Margins here would push
								// the row past the tab track and make the strip's height
								// depend on how many documents are open.
								className={cn("mr-1 shrink-0 self-center")}
							>
								<ChevronDown aria-hidden="true" />
							</Button>
						</DropdownMenuTrigger>
					</Tooltip>
					<DropdownMenuContent align="end" className={cn("max-w-80")}>
						{documents.map((doc) => (
							<DropdownMenuItem
								key={doc.id}
								onSelect={() => onChangeActiveDocument(doc.id)}
							>
								<Check
									aria-hidden="true"
									className={cn(doc.id !== selectedId && "invisible")}
								/>
								<span className={cn("truncate")}>{doc.title}</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
};

export const CanvasTabs = memo(CanvasTabsComponent);
