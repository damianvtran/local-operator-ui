import type {
	CanvasDocument,
	CanvasDocumentType,
} from "@features/chat/types/canvas";
import { getFileTypeFromPath } from "@features/chat/utils/file-types";
import { getFileName } from "@features/chat/utils/get-file-name";
import { isCanvasSupported } from "@features/chat/utils/is-canvas-supported";
import { isSpreadsheetFile } from "@features/chat/utils/is-spreadsheet-file";
import {
	type LocalOperatorClient,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import { Card, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
import { useCanvasStore } from "@shared/store/canvas-store";
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
import type { FC } from "react";
import { memo, useCallback, useMemo } from "react";

type CanvasFileViewerProps = {
	conversationId: string;
	// Callback to switch view in parent component
	onSwitchToDocumentView: (documentId: string) => void;
};

const defaultFiles: CanvasDocument[] = [];

/** Thumbnail band height, shared by the image, video and icon tiles. */
const THUMBNAIL = "h-35 w-full";

/**
 * Checks if a file is an image based on its extension
 */
const isImage = (path: string): boolean => {
	const imageExtensions = [
		".jpg",
		".jpeg",
		".png",
		".gif",
		".webp",
		".bmp",
		".svg",
		".tiff",
		".tif",
		".ico",
		".heic",
		".heif",
		".avif",
		".jfif",
		".pjpeg",
		".pjp",
	];
	const lowerPath = path.toLowerCase();
	return imageExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Checks if a file is a video based on its extension
 */
const isVideo = (path: string): boolean => {
	const videoExtensions = [
		".mp4",
		".webm",
		".ogg",
		".mov",
		".avi",
		".wmv",
		".flv",
		".mkv",
		".m4v",
		".3gp",
		".3g2",
	];
	const lowerPath = path.toLowerCase();
	return videoExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Gets the appropriate URL for an attachment using the static API
 */
const getAttachmentUrl = (
	client: LocalOperatorClient,
	path: string,
): string => {
	// If it's a web URL, return it as is
	if (path.startsWith("http")) {
		return path;
	}

	// For data URIs, return as is
	if (path.startsWith("data:")) {
		return path;
	}

	// For local files, normalize the path and use appropriate endpoint
	const normalizedPath = path.startsWith("file://") ? path : `file://${path}`;

	if (isImage(path)) {
		return client.static.getImageUrl(normalizedPath);
	}

	if (isVideo(path)) {
		return client.static.getVideoUrl(normalizedPath);
	}

	// For other file types, return the original path
	return path;
};

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

const CanvasFileViewerComponent: FC<CanvasFileViewerProps> = ({
	conversationId,
	onSwitchToDocumentView,
}) => {
	// Get files from the canvas store for this conversation
	const files = useCanvasStore((state): CanvasDocument[] => {
		const conv = state.conversations[conversationId];
		return conv?.mentionedFiles ?? defaultFiles;
	});

	// Canvas store actions
	const setFiles = useCanvasStore((s) => s.setFiles);
	const setOpenTabs = useCanvasStore((s) => s.setOpenTabs);
	const setSelectedTab = useCanvasStore((s) => s.setSelectedTab);
	const setViewMode = useCanvasStore((s) => s.setViewMode);

	// Memoize files to prevent unnecessary re-renders
	const memoizedFiles = useMemo<CanvasDocument[]>(() => {
		const filesByBaseName = files.reduce(
			(acc, file) => {
				const name = getFileName(file.path);
				// Prioritize files with absolute paths, assuming they are longer
				if (!acc[name] || file.path.length > acc[name].path.length) {
					acc[name] = file;
				}
				return acc;
			},
			{} as Record<string, CanvasDocument>,
		);
		return Object.values(filesByBaseName);
	}, [files]);

	// Create a Local Operator client using the API config
	const client = useMemo(() => {
		return createLocalOperatorClient(apiConfig.baseUrl);
	}, []);

	// Get the URL for an attachment
	const getUrl = useCallback(
		(path: string) => getAttachmentUrl(client, path),
		[client],
	);

	const handleFileClick = useCallback(
		async (fileDoc: CanvasDocument) => {
			const title = fileDoc.title;
			const fallbackAction = (err?: string) => {
				if (err) console.error("Error processing file:", err);
				// Fallback to OS open for non-canvas supported files
				try {
					if (fileDoc.path.startsWith("data:")) {
						console.warn(
							"Opening data URI with OS default is not directly supported here.",
							`${fileDoc.path.substring(0, 50)}...`,
						);
					} else {
						window.api.openFile(fileDoc.path);
					}
				} catch (error) {
					console.error("Error opening file natively:", error);
				}
			};

			if (fileDoc.path.startsWith("data:")) {
				// Handle base64 data URI
				if (isCanvasSupported(title) || isSpreadsheetFile(title)) {
					const docId = fileDoc.path; // Use the data URI itself as a unique ID
					const newDoc = {
						id: docId,
						title,
						path: docId, // Store data URI as path for consistency if needed
						content: fileDoc.path, // The content is the data URI itself
						type: getFileTypeFromPath(title),
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
					setViewMode(conversationId, "documents");
					onSwitchToDocumentView(docId);
				} else {
					// Not canvas supported, but it's a data URI.
					fallbackAction();
				}
			} else {
				// Handle file path
				const normalizedPath = fileDoc.path.startsWith("file://")
					? fileDoc.path.substring(7)
					: fileDoc.path;
				try {
					// Use base64 encoding for spreadsheet files, utf-8 for others
					const encoding = isSpreadsheetFile(title) ? "base64" : "utf-8";
					const result = await window.api.readFile(normalizedPath, encoding);

					if (
						result.success &&
						(isCanvasSupported(title) || isSpreadsheetFile(title))
					) {
						const docId = normalizedPath;
						const newDoc = {
							id: docId,
							title,
							path: normalizedPath,
							content: result.data,
							type: getFileTypeFromPath(title),
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
						setViewMode(conversationId, "documents");
						onSwitchToDocumentView(docId);
						return;
					}

					const errorMessage =
						!result.success && result.error
							? result.error instanceof Error
								? result.error.message
								: String(result.error)
							: "Unknown error reading file";
					return fallbackAction(errorMessage);
				} catch (error: unknown) {
					const message =
						error instanceof Error
							? error.message
							: String(error ?? "Unknown error reading file");
					return fallbackAction(message);
				}
			}
		},
		[
			conversationId,
			setFiles,
			setOpenTabs,
			setSelectedTab,
			setViewMode,
			onSwitchToDocumentView,
		],
	);

	if (files.length === 0) {
		return (
			<div
				className={cn(
					"flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
				)}
			>
				<h2 className={cn("text-heading text-ink")}>No files yet</h2>
				<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
					Files you attach to a message in this conversation appear here, ready
					to open.
				</p>
			</div>
		);
	}

	return (
		<div className={cn("h-full overflow-y-auto p-6")}>
			<div className={cn("grid grid-cols-2 gap-4 sm:grid-cols-3")}>
				{memoizedFiles.map((fileDoc) => {
					const IconComponent = getIconForFileType(fileDoc.type);
					const isLocalFile =
						!fileDoc.path.startsWith("data:") &&
						!fileDoc.path.startsWith("http");
					const normalizedPath = fileDoc.path.startsWith("file://")
						? fileDoc.path.substring(7)
						: fileDoc.path;
					return (
						<Card
							key={fileDoc.id}
							variant="plain"
							padding="none"
							className={cn("relative overflow-hidden")}
						>
							{isLocalFile && (
								<div className={cn("absolute top-1 right-1 z-10")}>
									<FileActionsMenu
										filePath={normalizedPath}
										tooltip="File actions"
										aria-label="File actions"
										onShowInCanvas={() => handleFileClick(fileDoc)}
									/>
								</div>
							)}
							<Tooltip content={fileDoc.title}>
								<button
									type="button"
									onClick={() => handleFileClick(fileDoc)}
									className={cn(
										"flex w-full flex-1 flex-col text-left",
										"transition-colors duration-fast ease-out-quart",
										"hover:bg-elevated",
									)}
								>
									{fileDoc.type === "image" ? (
										<img
											src={getUrl(fileDoc.path)}
											alt={fileDoc.title}
											className={cn(THUMBNAIL, "bg-sunken object-contain")}
										/>
									) : fileDoc.type === "video" ? (
										// biome-ignore lint/a11y/useMediaCaption: a user's own attached video has no caption track to offer.
										<video
											src={getUrl(fileDoc.path)}
											controls={true}
											preload="metadata"
											className={cn(THUMBNAIL, "bg-sunken object-contain")}
										/>
									) : (
										<span
											className={cn(
												THUMBNAIL,
												"flex items-center justify-center text-ink-muted",
											)}
										>
											<IconComponent size={48} strokeWidth={1} />
										</span>
									)}
									<span
										className={cn(
											"block w-full truncate px-3 py-2 text-meta text-ink-muted",
										)}
									>
										{getFileName(fileDoc.title)}
									</span>
								</button>
							</Tooltip>
						</Card>
					);
				})}
			</div>
		</div>
	);
};

export const CanvasFileViewer = memo(CanvasFileViewerComponent);
