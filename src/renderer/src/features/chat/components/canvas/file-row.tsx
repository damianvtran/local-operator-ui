import { rowCurrent } from "@features/chat/components/chat-sidebar";
import type {
	CanvasDocument,
	CanvasDocumentType,
} from "@features/chat/types/canvas";
import { stripFileUrl } from "@features/chat/utils/canvas-document";
import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import { Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	Archive,
	AudioLines,
	Code,
	File,
	FileImage,
	FileSpreadsheet,
	FileText,
	FileVideo,
	Presentation,
	ScrollText,
} from "lucide-react";
import { memo } from "react";
import type { Ref } from "react";
import type { FileRow } from "./file-rows";

/**
 * One file, as a row.
 *
 * A row is a line of a list, not a card: no elevation, no `border-control` (that
 * role is the sole boundary of a CONTROL, and a row is not one), no second line.
 * The name is the content — the thing the tile grid pushed under a 96px
 * thumbnail band — and the directory appears beside it only where identity needs
 * it (a basename two rows share). Everything else the row can say lives in one
 * right-hand slot: the size the probe answered, or the receipt for a file that
 * is gone.
 *
 * WHY THE ROW CARRIES NO `aria-label`. Its accessible name is its own text —
 * name, directory, size or receipt — and that is the whole design: an
 * `aria-label` would REPLACE that text, so a missing file would stop announcing
 * "No longer on disk" and a clashing basename would stop announcing the
 * directory that tells the two apart. What the label would have added is the
 * full path, which is the tooltip's job and stays there.
 *
 * THE MENU COMES AFTER THE BUTTON IN THE DOM, which is the grid's own keyboard
 * fix kept: the row's first Tab stop must be the file, not a menu. Absolute
 * positioning keeps the visual order (trailing) while the focus order moves onto
 * the control the row is for, and the row reserves the menu's 28px with its own
 * right padding so revealing it covers nothing.
 */

/**
 * The type glyph for a row's leading visual.
 *
 * The extension lists in `utils/file-kind.ts` are deliberately not consulted:
 * they once disagreed with the classifier, so a HEIC row painted a thumbnail
 * under a type that said the app did not know the format. The type is the one
 * answer.
 */
const getIconForFileType = (type?: CanvasDocumentType) => {
	switch (type) {
		case "image":
			return FileImage;
		case "video":
			return FileVideo;
		case "pdf":
			return ScrollText;
		case "markdown":
		case "text": // Grouping text-like types
			return FileText;
		case "html":
		case "code": // Grouping code-like types
			return Code;
		case "archive":
			return Archive;
		case "document": // Word, ODT etc.
			return FileText;
		case "spreadsheet": // Excel, ODS etc.
			return FileSpreadsheet;
		case "presentation": // PowerPoint, ODP etc.
			return Presentation;
		case "audio":
			return AudioLines;
		default:
			return File; // Generic file icon
	}
};

/**
 * The size slot, hidden when the list is too narrow to show three columns.
 *
 * `@max-[34rem]/fileslist:hidden` is a container query on the list rather than a
 * viewport breakpoint, for the reason the grid's own comment records: the dock
 * resizes 400–1200px independently of the window, so `sm:` was once true at a
 * 1440px window while the panel was 400px wide. Below the threshold the name
 * gets the width instead; the RECEIPT in this slot is never hidden, because
 * "this file is not there" is the fact that decides what the user does next.
 */
const SIZE_META = "@max-[34rem]/fileslist:hidden";

export type FileRowItemProps = {
	row: FileRow;
	/**
	 * Resolves a row's path to a URL the renderer may load. Only media rows use
	 * it; it is a prop rather than a client built here so the panel owns the one
	 * client and every row shares it.
	 */
	getUrl: (path: string) => string;
	/** This file is the one open in the Documents view. */
	current: boolean;
	onOpen: (document: CanvasDocument) => void;
	/**
	 * Set on the FIRST row only, so the search field can hand the keyboard to the
	 * list (Escape on an empty field, ArrowDown from the field). A ref rather than
	 * a DOM query: the rows are React's, and asking the document for the first
	 * button is a second opinion about which one it is.
	 */
	buttonRef?: Ref<HTMLButtonElement>;
};

const FileRowItemComponent = ({
	row,
	getUrl,
	current,
	onOpen,
	buttonRef,
}: FileRowItemProps) => {
	const { document } = row;
	/*
	 * The full path, not the name. The name is already on the row, and where two
	 * rows share one the path is the only thing that tells them apart — so the
	 * tooltip resolves the collision rather than repeating the name (design round
	 * 1, D1). A `data:` document has no path to show and keeps its name.
	 */
	const tooltip = document.path.startsWith("data:")
		? document.title
		: document.path;
	const isLocalFile =
		!document.path.startsWith("data:") && !document.path.startsWith("http");
	const Icon = getIconForFileType(document.type);

	return (
		<li className={cn("group relative")} data-tour-tag="file-row">
			<Tooltip content={tooltip}>
				<button
					ref={buttonRef}
					type="button"
					onClick={() => onOpen(document)}
					/*
					 * `pr-8` reserves the trailing 28px the actions menu occupies, so
					 * the two never overlap; the hover ground still spans the whole row,
					 * which is what makes it read as a row rather than as a chip.
					 */
					className={cn(
						"flex h-9 w-full items-center gap-2 rounded-sm py-0 pr-8 pl-2 text-left",
						"transition-colors duration-fast ease-out-quart",
						"hover:bg-elevated",
						// The shared current-row role, applied rather than re-spelled: it
						// is declared once in the chat panel and its `hover:` half is what
						// stops the hover step above from repainting a row the user is IN
						// (design D22, and `scripts/chat-sidebar-selection.test.mjs` fails
						// on a second spelling of its terms).
						current && rowCurrent,
					)}
				>
					<span className={cn("flex w-7 shrink-0 items-center justify-center")}>
						{row.media === "image" ? (
							<img
								src={getUrl(document.path)}
								// The row's own text already names the file, so the thumbnail is
								// decorative here: an alt of the name would announce it twice.
								alt=""
								loading="lazy"
								decoding="async"
								className={cn("size-7 rounded-sm bg-sunken object-cover")}
							/>
						) : row.media === "video" ? (
							// biome-ignore lint/a11y/useMediaCaption: a user's own attached video has no caption track to offer.
							<video
								src={getUrl(document.path)}
								preload="metadata"
								className={cn("size-7 rounded-sm bg-sunken object-cover")}
							/>
						) : (
							/*
							 * No `bg-sunken` tile behind the glyph. A ground step that
							 * measures ΔE00 1.23–1.89 against its neighbour in four palettes
							 * is a box that is not there, and `ink-dim` is the caption and
							 * placeholder ink — a row's type marker is not a caption.
							 */
							<Icon
								size={16}
								aria-hidden="true"
								className={cn(
									row.missing ? "text-ink-disabled" : "text-ink-muted",
								)}
							/>
						)}
					</span>
					{/*
					 * `flex-1` with a zero basis: the name takes the row's free space and
					 * is the LAST thing to give any up, because the directory beside it has
					 * an automatic basis and absorbs the shrink first. What must not be cut
					 * is the name's head — that is what the reader is scanning.
					 */}
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-body-sm",
							// A file that is gone steps one ink down, because a one-line row
							// has no second line left to say so: at full `ink` the row reads
							// as openable until the reader reaches the receipt.
							row.missing ? "text-ink-muted" : "text-ink",
						)}
					>
						{row.name}
					</span>
					{row.showParent && row.parent ? (
						<span
							className={cn(
								"min-w-0 shrink truncate text-mono-sm text-ink-dim",
							)}
						>
							{row.parent}
						</span>
					) : null}
					{/*
					 * One slot, two facts, and the receipt wins it at every width a size
					 * would otherwise take: a size is a fact the user can get back, "this
					 * file is not there" decides what they do next.
					 */}
					{row.missing ? (
						<span className={cn("shrink-0 text-meta text-ink-dim")}>
							No longer on disk
						</span>
					) : row.size ? (
						<span
							className={cn(
								"shrink-0 text-meta text-ink-dim tabular-nums",
								SIZE_META,
							)}
						>
							{row.size}
						</span>
					) : null}
				</button>
			</Tooltip>
			{isLocalFile && (
				<div
					className={cn(
						"absolute top-1/2 right-1 z-10 -translate-y-1/2",
						/*
						 * Revealed on hover or keyboard focus, like every other row action
						 * in the app, and `group-focus-within` is what keeps it reachable
						 * by keyboard at all: an element that never appears cannot be
						 * tabbed to.
						 */
						"pointer-events-none opacity-0",
						"group-hover:pointer-events-auto group-hover:opacity-100",
						"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
					)}
				>
					<FileActionsMenu
						filePath={stripFileUrl(document.path)}
						tooltip="File actions"
						aria-label="File actions"
						onShowInCanvas={() => onOpen(document)}
					/>
				</div>
			)}
		</li>
	);
};

export const FileRowItem = memo(FileRowItemComponent);
