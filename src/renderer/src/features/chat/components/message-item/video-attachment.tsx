import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { type FC, memo, useCallback, useState } from "react";
import { getFileTypeFromPath } from "../../utils/file-types";
import { getFileName } from "../../utils/get-file-name";
import { isCanvasSupported } from "../../utils/is-canvas-supported";
import { InvalidAttachment } from "./invalid-attachment";

/**
 * Props for the VideoAttachment component (base)
 */
type BaseVideoAttachmentProps = {
	file: string;
	src: string;
	onClick: (file: string) => void;
};

export type VideoAttachmentProps = BaseVideoAttachmentProps & {
	conversationId: string;
};

/**
 * Component for displaying video attachments
 * Renders a video player with controls and preview functionality
 * Handles video loading errors and displays an InvalidAttachment component if the video fails to load
 */
export const VideoAttachment: FC<VideoAttachmentProps> = memo(
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
					onClick(file);
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
				{/* Local recordings have no caption track to offer; an empty track
				 * would be a fabricated affordance, so this is a documented
				 * exception rather than a fake source. */}
				{/* biome-ignore lint/a11y/useMediaCaption: no caption source exists for locally recorded files */}
				<video
					className="mb-2 max-h-[300px] max-w-full cursor-pointer rounded-sm"
					src={src}
					controls
					preload="metadata"
					tabIndex={0}
					onClick={handleClick}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							handleClick();
						}
					}}
					onError={handleError}
					title={`Click to open ${getFileName(file)}`}
				/>
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

VideoAttachment.displayName = "VideoAttachment";
