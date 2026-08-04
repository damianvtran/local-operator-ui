import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { type FC, memo, useCallback, useState } from "react";
import { getFileTypeFromPath } from "../../utils/file-types";
import { isCanvasSupported } from "../../utils/is-canvas-supported";
import { InvalidAttachment } from "./invalid-attachment";

/**
 * Props for the ImageAttachment component (base)
 */
type BaseImageAttachmentProps = {
	file: string;
	src: string;
	onClick: (file: string) => void;
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
 * Component for displaying image attachments
 * Handles image loading errors and displays an InvalidAttachment component if the image fails to load
 */
export const ImageAttachment: FC<ImageAttachmentProps> = memo(
	({ file, src, onClick, conversationId }) => {
		const [hasError, setHasError] = useState(false);
		const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
		const { setViewMode } = useCanvasStore();

		const handleShowInCanvas = useCallback(async () => {
			const title = getFileName(file);
			const fallbackAction = (err?: string) => {
				if (err) console.error("Error processing file:", err);
				onClick(file);
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
			onClick(file);
		};

		const handleError = () => {
			setHasError(true);
		};

		const isLocalFile = !file.startsWith("data:") && !file.startsWith("http");
		const normalizedPath = file.startsWith("file://")
			? file.substring(7)
			: file;

		if (hasError) {
			return <InvalidAttachment file={file} />;
		}

		return (
			<div className="group relative inline-block">
				<button
					type="button"
					className="block cursor-pointer"
					onClick={handleClick}
					title={`Click to open ${getFileName(file)}`}
				>
					<img
						className="mb-2 max-h-[200px] max-w-full rounded-sm"
						src={src}
						alt={getFileName(file)}
						onError={handleError}
					/>
				</button>
				{isLocalFile && (
					<div
						className="file-actions-menu invisible absolute right-1 top-1 z-[2] opacity-0 transition-[opacity,visibility] duration-fast ease-out-quart group-hover:visible group-hover:opacity-100"
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
