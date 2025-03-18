import { Box } from "@mui/material";
import { type FC, memo, useCallback, useMemo } from "react";
import { createLocalOperatorClient } from "../../../api/local-operator";
import { apiConfig } from "../../../config";
import { ActionHighlight } from "./action-highlight";
import { CodeBlock } from "./code-block";
import { ErrorBlock } from "./error-block";
import { FileAttachment } from "./file-attachment";
import { ImageAttachment } from "./image-attachment";
import { LogBlock } from "./log-block";
import { MessageAvatar } from "./message-avatar";
import { MessageContainer } from "./message-container";
import { MessageContent } from "./message-content";
import { MessagePaper } from "./message-paper";
import { MessageTimestamp } from "./message-timestamp";
import { OutputBlock } from "./output-block";
import { PlanReflectionBlock } from "./plan-reflection-block";
import { StatusIndicator } from "./status-indicator";
import type { MessageItemProps } from "./types";

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
 * Gets the appropriate URL for an attachment
 * Uses the static image endpoint for local image files
 * @param client - The Local Operator client
 * @param path - The file path or URL
 * @returns The URL to access the attachment
 */
const getAttachmentUrl = (
	client: ReturnType<typeof createLocalOperatorClient>,
	path: string,
): string => {
	// If it's an image and looks like a local file path
	if (isImage(path) && !path.startsWith("http")) {
		// Check if path already has file:// protocol
		const normalizedPath = path.startsWith("file://") ? path : `file://${path}`;
		// Use the static image endpoint
		return client.static.getImageUrl(normalizedPath);
	}
	// Otherwise return the original path
	return path;
};

/**
 * Memoized message item component to prevent unnecessary re-renders
 * Only re-renders when the message content changes
 */
export const MessageItem: FC<MessageItemProps> = memo(
	({ message }) => {
		const isUser = message.role === "user";
		const isAction = message.execution_type === "action";
		const isPlanOrReflection =
			message.execution_type === "plan" ||
			message.execution_type === "reflection";

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
				// Could add a toast notification here to inform the user
			}
		}, []);

		// If it's a plan or reflection execution type, render the special block
		if (isPlanOrReflection && message.message) {
			return (
				<PlanReflectionBlock
					content={message.message}
					executionType={message.execution_type || "action"}
					isUser={isUser}
				/>
			);
		}

		return (
			<MessageContainer isUser={isUser}>
				<MessageAvatar isUser={isUser} />

				<ActionHighlight action={message.action || "CODE"} isUser={isUser}>
					<MessagePaper isUser={isUser}>
						{/* Render image attachments if any */}
						{message.files && message.files.length > 0 && (
							<Box sx={{ mb: 2 }}>
								{message.files
									.filter((file) => isImage(file))
									.map((file) => (
										<ImageAttachment
											key={`${message.id}-${file}`}
											file={file}
											src={getUrl(file)}
											onClick={handleFileClick}
										/>
									))}
							</Box>
						)}

						{/* Render message content with markdown support */}
						{message.message && (
							<MessageContent content={message.message} isUser={isUser} />
						)}

						{/* Render code with syntax highlighting */}
						{message.code && (
							<CodeBlock
								code={message.code}
								isUser={isUser}
								isAction={isAction}
							/>
						)}

						{/* Render stdout */}
						{message.stdout && (
							<OutputBlock
								output={message.stdout}
								isUser={isUser}
								isAction={isAction}
							/>
						)}

						{/* Render stderr */}
						{message.stderr && (
							<ErrorBlock
								error={message.stderr}
								isUser={isUser}
								isAction={isAction}
							/>
						)}

						{/* Render logging */}
						{message.logging && (
							<LogBlock
								log={message.logging}
								isUser={isUser}
								isAction={isAction}
							/>
						)}

						{/* Status indicator if present */}
						{message.status && <StatusIndicator status={message.status} />}

						{/* Render non-image file attachments if any */}
						{message.files && message.files.length > 0 && (
							<Box sx={{ mt: 2 }}>
								{message.files
									.filter((file) => !isImage(file))
									.map((file) => (
										<FileAttachment
											key={`${message.id}-${file}`}
											file={file}
											onClick={handleFileClick}
										/>
									))}
							</Box>
						)}

						{/* Message timestamp */}
						<MessageTimestamp timestamp={message.timestamp} isUser={isUser} />
					</MessagePaper>
				</ActionHighlight>
			</MessageContainer>
		);
	},
	(prevProps, nextProps) => {
		// Custom comparison function for memo
		// Only re-render if the message ID or content has changed
		return (
			prevProps.message.id === nextProps.message.id &&
			prevProps.message.message === nextProps.message.message &&
			prevProps.message.status === nextProps.message.status
		);
	},
);
