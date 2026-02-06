import { Box, Typography, alpha } from "@mui/material";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import type {
	ActionType,
	ExecutionType,
} from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config";
import { getLanguageFromExtension } from "@shared/utils/file-utils";
import {
	Book,
	Check,
	ChevronUp,
	Code2,
	HelpCircle,
	Lightbulb,
	MessageSquare,
	Pencil,
	PencilLine,
	Share2,
} from "lucide-react";
import { type FC, type ReactNode, useCallback, useMemo, useState } from "react";
import { ExpandableActionElement } from "../expandable-action-element";
import { MarkdownRenderer } from "../markdown-renderer";
import { AudioAttachment } from "./audio-attachment";
import { CodeBlock } from "./code-block";
import { ErrorBlock } from "./error-block";
import { FileAttachment } from "./file-attachment";
import { ImageAttachment } from "./image-attachment";
import { LogBlock } from "./log-block";
import { MessageControls } from "./message-controls";
import { MessageTimestamp } from "./message-timestamp";
import { OutputBlock } from "./output-block";
import { VideoAttachment } from "./video-attachment";

/**
 * Props for the ActionBlock component
 */
export type ActionBlockProps = {
	message: string;
	fileContent?: string;
	action?: ActionType;
	replacements?: string;
	executionType: ExecutionType;
	isUser: boolean;
	code?: string;
	stdout?: string;
	stderr?: string;
	logging?: string;
	files?: string[]; // URLs to attachments
	conversationId: string;
	filePath?: string;
	isLoading?: boolean;
	isSmallView?: boolean;
	compact?: boolean;
	messageId?: string;
	timestamp?: Date;
	agentId?: string;
};

const localOperatorClient = createLocalOperatorClient(apiConfig.baseUrl);

/**
 * Checks if a file is a web URL
 * @param path - The file path or URL to check
 * @returns True if the path is a web URL, false otherwise
 */
const isWebUrl = (path: string): boolean => {
	return path.startsWith("http://") || path.startsWith("https://");
};

/**
 * Checks if a file is an image based on its extension
 * @param path - The file path or URL to check
 * @returns True if the file is an image, false otherwise
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
 * @param path - The file path or URL to check
 * @returns True if the file is a video, false otherwise
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
 * Checks if a file is an audio file based on its extension
 * @param path - The file path or URL to check
 * @returns True if the file is an audio file, false otherwise
 */
const isAudio = (path: string): boolean => {
	const audioExtensions = [
		".mp3",
		".wav",
		".ogg",
		".aac",
		".flac",
		".m4a",
		".aiff",
	];
	const lowerPath = path.toLowerCase();
	return audioExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Gets the appropriate URL for an attachment
 * Uses the static image endpoint for local image files
 * and the static video endpoint for local video files
 * @param client - The Local Operator client
 * @param path - The file path or URL
 * @returns The URL to access the attachment
 */
const getAttachmentUrl = (
	client: ReturnType<typeof createLocalOperatorClient>,
	path: string,
): string => {
	// If it's a web URL, return it as is
	if (path.startsWith("http")) {
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

	if (isAudio(path)) {
		return client.static.getAudioUrl(normalizedPath);
	}

	// For other file types, return the original path
	return path;
};

const getCompactIcon = (
	action?: ActionType,
	executionType?: ExecutionType,
): ReactNode => {
	switch (action) {
		case "DONE":
			return <Check size={14} />;
		case "ASK":
			return <HelpCircle size={14} />;
		case "CODE":
			return <Code2 size={14} />;
		case "WRITE":
			return <Pencil size={12} />;
		case "EDIT":
			return <PencilLine size={14} />;
		case "READ":
			return <Book size={14} />;
		case "DELEGATE":
			return <Share2 size={14} />;
		default:
			return executionType === "plan" ? (
				<Lightbulb size={14} />
			) : executionType === "action" ? (
				<Code2 size={14} />
			) : (
				<MessageSquare size={14} />
			);
	}
};

/**
 * Component for displaying plan, reflection, and action execution types
 * Shows as a single line with truncation when collapsed
 * For action types, also shows code, output, and errors when expanded
 * Attachments (images and files) are always visible outside the collapsible element
 */
export const ActionBlock: FC<ActionBlockProps> = ({
	message,
	replacements,
	fileContent,
	action,
	executionType,
	isUser,
	code,
	stdout,
	stderr,
	logging,
	files,
	filePath,
	conversationId,
	isLoading,
	isSmallView,
	compact = false,
	messageId,
	timestamp,
	agentId,
}) => {
	const [isRowExpanded, setIsRowExpanded] = useState(!compact);
	const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);

	const markdownStyleProps = useMemo(
		() => ({
			fontSize: isSmallView ? "0.95rem" : "1.05rem",
			lineHeight: isSmallView ? 1.45 : 1.6,
		}),
		[isSmallView],
	);

	// Get the URL for an attachment
	const getUrl = useCallback(
		(path: string) => getAttachmentUrl(localOperatorClient, path),
		[],
	);

	/**
	 * Handles clicking on a file attachment
	 * Opens local files with the system's default application
	 * Opens web URLs in the default browser
	 * @param filePath - The path or URL of the file to open
	 */
	const handleFileClick = useCallback((filePath: string) => {
		try {
			// If it's a web URL
			if (isWebUrl(filePath)) {
				// Open in default browser
				window.api.openExternal(filePath);
			} else {
				// It's a local file, open with default application
				// Remove file:// prefix if present
				const normalizedPath = filePath.startsWith("file://")
					? filePath.substring(7)
					: filePath;

				window.api.openFile(normalizedPath);
			}
		} catch (error) {
			console.error("Error opening file:", error);
		}
	}, []);

	// Determine if we have any collapsible technical content
	const hasCollapsibleContent = Boolean(executionType === "action" && !!action);

	const fileLanguage = getLanguageFromExtension(filePath || "");

	/**
	 * Removes any trailing code block language markers (e.g., ```xml, ```tool_use)
	 * at the end of the string, including any trailing whitespace.
	 */
	const trimmedMessage = message
		? message.replace(/(```\w+\s*)+$/g, "").trimEnd()
		: message;
	const compactPreviewText = trimmedMessage
		? trimmedMessage.replace(/\s+/g, " ").trim()
		: action === "CODE"
			? "Executing code"
			: "Working on your request";
	const compactIcon = useMemo(
		() => getCompactIcon(action, executionType),
		[action, executionType],
	);

	const handleExpand = () => {
		setIsRowExpanded(true);
		setIsDetailsExpanded(true);
	};

	const handleCollapse = (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsDetailsExpanded(false);
		if (compact) {
			setIsRowExpanded(false);
		}
	};

	const handleCompactToggle = () => {
		if (!compact) return;
		setIsRowExpanded((previous) => {
			const next = !previous;
			setIsDetailsExpanded(next);
			return next;
		});
	};

	return (
		<Box sx={{ position: "relative", width: "100%" }}>
			{compact && !isRowExpanded && (
				<Box
					component="button"
					type="button"
					aria-expanded={false}
					onClick={handleCompactToggle}
					sx={{
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						width: "100%",
						border: "none",
						background: "transparent",
						padding: "2px 0",
						cursor: "pointer",
						textAlign: "center",
						minHeight: 28,
					}}
				>
					<Box
						sx={(theme) => ({
							display: "inline-flex",
							alignItems: "center",
							gap: 1,
							maxWidth: "100%",
							padding: "5px 10px",
							borderRadius: "999px",
							color: theme.palette.text.secondary,
							backgroundColor: alpha(
								theme.palette.common.black,
								theme.palette.mode === "dark" ? 0.14 : 0.04,
							),
						})}
					>
						<Box
							component="span"
							sx={{
								width: 20,
								height: 20,
								borderRadius: "100%",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								flexShrink: 0,
							}}
						>
							{compactIcon}
						</Box>
						<Typography
							variant="body2"
							noWrap
							component="span"
							sx={{
								maxWidth: "100%",
								color: "inherit",
								fontSize: "0.82rem",
								lineHeight: 1.35,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{compactPreviewText}
						</Typography>
					</Box>
				</Box>
			)}

			{(!compact || isRowExpanded) && (
				<>
					{/* Message content displayed outside and above the collapsible block */}
					{message && (
						<Box
							sx={{
								borderRadius: 2,
								color: (theme) => theme.palette.text.primary,
								width: "100%",
								wordBreak: "break-word",
								overflowWrap: "break-word",
								position: "relative",
								mb: 2,
							}}
						>
							<MarkdownRenderer
								content={trimmedMessage}
								styleProps={markdownStyleProps}
							/>
						</Box>
					)}

					{/* Use the shared expandable action element */}
					<ExpandableActionElement
						executionType={executionType}
						action={action}
						isUser={isUser}
						isExpanded={isDetailsExpanded}
						onExpand={handleExpand}
						onCollapse={handleCollapse}
						hasCollapsibleContent={hasCollapsibleContent}
						isLoading={isLoading ?? false}
					>
						{/* Technical details for action messages */}
						{code && <CodeBlock code={code} isUser={isUser} />}
						{fileContent && (
							<CodeBlock
								header="Content"
								code={fileContent}
								isUser={isUser}
								language={fileLanguage}
							/>
						)}
						{replacements && (
							<CodeBlock
								header="Replacements"
								code={replacements}
								isUser={isUser}
								language="diff"
							/>
						)}
						{stdout && <OutputBlock output={stdout} isUser={isUser} />}
						{stderr && <ErrorBlock error={stderr} isUser={isUser} />}
						{logging && <LogBlock log={logging} isUser={isUser} />}
					</ExpandableActionElement>

					{/* Render image attachments if any - always visible */}
					{files && files.length > 0 && (
						<Box sx={{ mb: 2, mt: 2 }}>
							{files
								.filter((file) => isImage(file))
								.map((file) => (
									<ImageAttachment
										key={`${file}`}
										file={file}
										src={getUrl(file)}
										onClick={handleFileClick}
										conversationId={conversationId}
									/>
								))}
						</Box>
					)}

					{/* Render video attachments if any - always visible */}
					{files && files.length > 0 && (
						<Box sx={{ mb: 2 }}>
							{files
								.filter((file) => isVideo(file))
								.map((file) => (
									<VideoAttachment
										key={`${file}`}
										file={file}
										src={getUrl(file)}
										onClick={handleFileClick}
										conversationId={conversationId}
									/>
								))}
						</Box>
					)}

					{/* Render audio attachments if any - always visible */}
					{files && files.length > 0 && files.some((file) => isAudio(file)) && (
						<Box sx={{ mb: 2 }}>
							{files
								.filter((file) => isAudio(file))
								.map((file) => (
									<AudioAttachment
										key={`${file}`}
										content={getUrl(file)}
										isUser={isUser}
									/>
								))}
						</Box>
					)}

					{/* Render non-media file attachments if any - always visible */}
					{files && files.length > 0 && (
						<Box sx={{ mt: 2 }}>
							{files
								.filter(
									(file) => !isImage(file) && !isVideo(file) && !isAudio(file),
								)
								.map((file) => (
									<FileAttachment
										key={`${file}`}
										file={file}
										onClick={handleFileClick}
										conversationId={conversationId}
									/>
								))}
						</Box>
					)}

					{isRowExpanded && messageId && timestamp && (
						<Box
							sx={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								gap: 1,
								mt: 1.25,
							}}
						>
							<MessageControls
								inline
								isUser={isUser}
								content={trimmedMessage}
								messageId={messageId}
								agentId={agentId || conversationId}
							/>
							<MessageTimestamp
								inline
								timestamp={timestamp}
								isUser={isUser}
								isSmallView={isSmallView}
							/>
						</Box>
					)}

					{compact && isRowExpanded && !hasCollapsibleContent && (
						<Box
							component="button"
							type="button"
							onClick={handleCompactToggle}
							aria-expanded={false}
							sx={(theme) => ({
								marginTop: 1.25,
								display: "inline-flex",
								alignItems: "center",
								gap: 0.5,
								padding: "4px 8px",
								borderRadius: 1,
								border: "none",
								cursor: "pointer",
								backgroundColor: alpha(
									theme.palette.common.black,
									theme.palette.mode === "dark" ? 0.12 : 0.04,
								),
								color: theme.palette.text.secondary,
							})}
						>
							<ChevronUp size={14} />
							<Typography variant="caption">Condense</Typography>
						</Box>
					)}
				</>
			)}
		</Box>
	);
};
