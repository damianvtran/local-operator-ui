import { Box } from "@mui/material";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import type {
	ActionType,
	ExecutionType,
} from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config";
import {
	type FC,
	useCallback,
	useMemo,
	useState,
} from "react";
import { ExpandableActionElement } from "../expandable-action-element";
import { MarkdownRenderer } from "../markdown-renderer";
import { CodeBlock } from "./code-block";
import { ErrorBlock } from "./error-block";
import { FileAttachment } from "./file-attachment";
import { ImageAttachment } from "./image-attachment";
import { LogBlock } from "./log-block";
import { OutputBlock } from "./output-block";
import { VideoAttachment } from "./video-attachment";

/**
 * Props for the ActionBlock component
 */
export type ActionBlockProps = {
	message: string;
	content?: string;
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
};

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

	// For other file types, return the original path
	return path;
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
	content,
	action,
	executionType,
	isUser,
	code,
	stdout,
	stderr,
	logging,
	files,
	conversationId,
}) => {
	const [isExpanded, setIsExpanded] = useState(false);

	const handleExpand = () => {
		setIsExpanded(true);
	};

	const handleCollapse = (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsExpanded(false);
	};

	// Create a Local Operator client using the API config
	const client = useMemo(() => {
		return createLocalOperatorClient(apiConfig.baseUrl);
	}, []);

	// Get the URL for an attachment
	const getUrl = useCallback(
		(path: string) => getAttachmentUrl(client, path),
		[client],
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
	const hasCollapsibleContent = Boolean(
		executionType === "action" && (code || stdout || stderr || logging || replacements || content)
	);

	return (
		<Box sx={{ position: "relative", width: "100%" }}>
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
					<MarkdownRenderer content={message} />
				</Box>
			)}

			{/* Use the shared expandable action element */}
			<ExpandableActionElement
				executionType={executionType}
				action={action}
				isUser={isUser}
				isExpanded={isExpanded}
				onExpand={handleExpand}
				onCollapse={handleCollapse}
				hasCollapsibleContent={hasCollapsibleContent}
			>
				{/* Technical details for action messages */}
				{code && <CodeBlock code={code} isUser={isUser} />}
				{content && <CodeBlock code={content} isUser={isUser} />}
				{replacements && (
					<CodeBlock
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
							/>
						))}
				</Box>
			)}

			{/* Render non-media file attachments if any - always visible */}
			{files && files.length > 0 && (
				<Box sx={{ mt: 2 }}>
					{files
						.filter((file) => !isImage(file) && !isVideo(file))
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
		</Box>
	);
};
