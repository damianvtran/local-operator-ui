import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import { cn } from "@shared/lib/utils";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { type FC, memo, useCallback, useState } from "react";
import { getFileTypeFromPath } from "../../utils/file-types";
import { isCanvasSupported } from "../../utils/is-canvas-supported";
import { AttachmentFrame, BrokenAttachment } from "./attachment-frame";

/**
 * Props for the ImageAttachment component (base)
 */
type BaseImageAttachmentProps = {
	file: string;
	src: string;
	/**
	 * What a click does. OMIT it for a picture with nothing to open: the frame
	 * then renders without the button, the pointer cursor and the "Click to
	 * open" title, rather than advertising an action that does not answer.
	 */
	onClick?: (file: string) => void;
	/**
	 * What to call this picture in `alt` and in the title.
	 *
	 * Defaults to the filename, which is right for a file on disk. A canonical
	 * image has no filename — `getFileName` on a blob URL yields the blob's
	 * UUID, so a screen reader announced a GUID — and passes a position
	 * ("Screenshot") instead.
	 */
	label?: string;
};

export type ImageAttachmentProps = BaseImageAttachmentProps & {
	conversationId: string;
};

/**
 * Extracts the filename from a path
 * @param path - The file path or URL
 * @returns The extracted filename
 */
const PATH_SEPARATOR_REGEX = /[/\\]/;
const getFileName = (path: string): string => {
	// Handle both local paths and URLs
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1];
};

/**
 * An image sent or produced in the conversation.
 *
 * Every state it can be in — decoding, decoded, unreadable — is drawn by
 * `attachment-frame`, so the box never collapses, never reflows the message
 * when the picture lands, and never falls through to the browser's own broken
 * image glyph.
 */
export const ImageAttachment: FC<ImageAttachmentProps> = memo(
	({ file, src, onClick, conversationId, label }) => {
		const [hasError, setHasError] = useState(false);
		const [isLoaded, setIsLoaded] = useState(false);
		const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
		const { setViewMode } = useCanvasStore();

		const handleShowInCanvas = useCallback(async () => {
			const title = getFileName(file);
			const fallbackAction = (err?: string) => {
				if (err) console.error("Error processing file:", err);
				// Optional: a picture with no handler has nothing to fall back TO.
				// It also has no file-actions menu, so this path is unreachable for
				// one — but the call has to be guarded for the type to hold.
				onClick?.(file);
			};

			const { setFiles, setOpenTabs, setSelectedTab } =
				useCanvasStore.getState();

			if (file.startsWith("data:")) {
				if (isCanvasSupported(title)) {
					const docId = file;
					const newDoc = {
						id: docId,
						title,
						path: docId,
						content: file,
						type: getFileTypeFromPath(file),
					};

					const state = useCanvasStore.getState();
					const conversationCanvasState = state.conversations?.[conversationId];
					const filesInState = conversationCanvasState?.files ?? [];
					const openTabsInState = conversationCanvasState?.openTabs ?? [];

					const updatedFiles = (() => {
						const idx = filesInState.findIndex((d) => d.id === docId);
						if (idx !== -1) {
							return [
								...filesInState.slice(0, idx),
								newDoc,
								...filesInState.slice(idx + 1),
							];
						}
						return [...filesInState, newDoc];
					})();
					setFiles(conversationId, updatedFiles);

					const existsTab = openTabsInState.some((t) => t.id === docId);
					const updatedTabs = existsTab
						? openTabsInState
						: [...openTabsInState, { id: docId, title }];
					setOpenTabs(conversationId, updatedTabs);
					setSelectedTab(conversationId, docId);
					setCanvasOpen(true);
					setViewMode(conversationId, "documents");
				} else {
					setCanvasOpen(true);
					setViewMode(conversationId, "files");
				}
			} else {
				const normalizedPath = file.startsWith("file://")
					? file.substring(7)
					: file;
				try {
					const result = await window.api.readFile(normalizedPath);

					if (result.success && isCanvasSupported(title)) {
						const docId = normalizedPath;
						const newDoc = {
							id: docId,
							title,
							path: normalizedPath,
							content: result.data,
							type: getFileTypeFromPath(file),
						};

						const state = useCanvasStore.getState();
						const conversationCanvasState =
							state.conversations?.[conversationId];
						const filesInState = conversationCanvasState?.files ?? [];
						const openTabsInState = conversationCanvasState?.openTabs ?? [];

						const updatedFiles = (() => {
							const idx = filesInState.findIndex((d) => d.id === docId);
							if (idx !== -1) {
								return [
									...filesInState.slice(0, idx),
									newDoc,
									...filesInState.slice(idx + 1),
								];
							}
							return [...filesInState, newDoc];
						})();
						setFiles(conversationId, updatedFiles);

						const existsTab = openTabsInState.some((t) => t.id === docId);
						const updatedTabs = existsTab
							? openTabsInState
							: [...openTabsInState, { id: docId, title }];
						setOpenTabs(conversationId, updatedTabs);
						setSelectedTab(conversationId, docId);
						setCanvasOpen(true);
						setViewMode(conversationId, "documents");
						return;
					}

					setCanvasOpen(true);
					setViewMode(conversationId, "files");
				} catch (error: unknown) {
					const message =
						error instanceof Error
							? error.message
							: String(error ?? "Unknown error reading file");
					return fallbackAction(message);
				}
			}
		}, [file, onClick, setCanvasOpen, setViewMode, conversationId]);

		const handleClick = () => {
			onClick?.(file);
		};

		const handleError = () => {
			setHasError(true);
		};

		// `blob:` belongs in this guard beside `data:`. Both are in-memory handles
		// with no path behind them, and a blob URL starts with neither of the other
		// two prefixes — so without it every durable transcript image grew a file
		// menu whose entries called `showItemInFolder`/`openFile` on a string that
		// is not a path, and whose "copy file path" put a dead handle on the
		// clipboard under a "copied" toast.
		const isLocalFile =
			!file.startsWith("data:") &&
			!file.startsWith("blob:") &&
			!file.startsWith("http");
		const normalizedPath = file.startsWith("file://")
			? file.substring(7)
			: file;

		// The picture's own name: a caller-supplied position for something with no
		// path, the filename otherwise.
		const name = label ?? getFileName(file);

		if (hasError) {
			return <BrokenAttachment name={name} />;
		}

		const picture = (
			<AttachmentFrame>
				<img
					className={cn(
						"max-h-[240px] max-w-full object-contain",
						// A shared height ceiling is the ledger rule, but at a phone
						// aspect (828x1792) it alone yields a 111px-wide slice in which
						// nothing is readable. A width floor lets a portrait capture
						// grow back toward the same box landscape images get, and
						// `object-contain` still forbids any stretching.
						"min-w-[7.5rem]",
						// The picture is invisible, not absent, until it decodes:
						// the frame has already reserved the box, so nothing moves
						// when it appears.
						isLoaded ? "opacity-100" : "opacity-0",
					)}
					src={src}
					alt={name}
					onLoad={() => setIsLoaded(true)}
					onError={handleError}
				/>
			</AttachmentFrame>
		);

		return (
			<div className="group relative inline-block">
				{onClick ? (
					<button
						type="button"
						className="block max-w-full cursor-pointer"
						onClick={handleClick}
						title={`Click to open ${name}`}
					>
						{picture}
					</button>
				) : (
					// No handler, so no button: a `cursor-pointer` and a "Click to
					// open" title on something inert is an affordance that lies, and
					// a focus stop that answers nothing costs a keyboard user a tab.
					<div className="block max-w-full">{picture}</div>
				)}
				{isLocalFile && (
					<div
						className="file-actions-menu invisible absolute top-1 right-1 z-[2] opacity-0 transition-[opacity,visibility] duration-fast ease-out-quart group-hover:visible group-hover:opacity-100"
						onClick={(e) => {
							e.stopPropagation();
						}}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<FileActionsMenu
							filePath={normalizedPath}
							tooltip="File actions"
							aria-label="File actions"
							onShowInCanvas={handleShowInCanvas}
						/>
					</div>
				)}
			</div>
		);
	},
);

ImageAttachment.displayName = "ImageAttachment";
