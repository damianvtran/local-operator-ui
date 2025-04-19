import { Box } from "@mui/material";
import { type FC, memo, useCallback, useMemo } from "react";
import { createLocalOperatorClient } from "../../../api/local-operator";
import { apiConfig } from "../../../config";
import { ActionHighlight } from "./action-highlight";
import { BackgroundBlock } from "./background-block";
import { CodeBlock } from "./code-block";
import { CollapsibleMessage } from "./collapsible-message";
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
import { SecurityCheckHighlight } from "./security-check-highlight";
import { StatusIndicator } from "./status-indicator";
import type { MessageItemProps } from "./types";
import { VideoAttachment } from "./video-attachment";

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
 * Memoized message item component to prevent unnecessary re-renders
 * Only re-renders when the message content changes
 */
export const MessageItem: FC<MessageItemProps> = memo(
	({ message, onMessageComplete, isLastMessage, conversationId }) => {
		// Hide messages with action DONE, execution_type "action", and task_classification "conversation"
		// These are redundant to the response execution_type messages
		// Also hide messages with no content (no message, files, code, stdout, stderr, or logging)
		const shouldHide =
			((message.action === "DONE" || message.action === "ASK") &&
				message.execution_type === "action" &&
				message.task_classification === "conversation") ||
			(!message.message &&
				(!message.files || message.files.length === 0) &&
				!message.code &&
				!message.stdout &&
				!message.stderr &&
				!message.logging &&
				message.is_complete);

		if (shouldHide) {
			return null;
		}
		const isUser = message.role === "user";
		const isAction = message.execution_type === "action";
		const isSecurityCheck = message.execution_type === "security_check";
		const shouldUseBackgroundBlock =
			message.execution_type === "reflection" ||
			message.execution_type === "action";

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
		 * Shows an error message if the file can't be opened
		 * @param filePath - The path or URL of the file to open
		 */
		const handleFileClick = useCallback(async (filePath: string) => {
			try {
				// If it's a web URL
				if (isWebUrl(filePath)) {
					// Open in default browser
					await window.api.openExternal(filePath);
				} else {
					// It's a local file, open with default application
					// Remove file:// prefix if present
					const normalizedPath = filePath.startsWith("file://")
						? filePath.substring(7)
						: filePath;

					await window.api.openFile(normalizedPath);
				}
			} catch (error) {
				console.error("Error opening file:", error);

				// Show an error message to the user
				// This could be replaced with a toast notification if available
				alert(
					`Unable to open file: ${filePath}. The file may be incomplete, deleted, or moved.`,
				);
			}
		}, []);

		if (shouldUseBackgroundBlock && message.message) {
			return (
				<BackgroundBlock
					content={message.message}
					action={message.action}
					executionType={message.execution_type || "action"}
					isUser={isUser}
					code={message.code}
					stdout={message.stdout}
					stderr={message.stderr}
					logging={message.logging}
					files={message.files}
					conversationId={conversationId}
				/>
			);
		}

		return (
			<MessageContainer isUser={isUser}>
				<MessageAvatar isUser={isUser} />

				{isSecurityCheck ? (
					<SecurityCheckHighlight isUser={isUser}>
						<MessagePaper
							isUser={isUser}
							content={message.message}
							message={message}
							onMessageComplete={onMessageComplete}
							isLastMessage={isLastMessage ?? false}
						>
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

							{/* Render video attachments if any */}
							{message.files && message.files.length > 0 && (
								<Box sx={{ mb: 2 }}>
									{message.files
										.filter((file) => isVideo(file))
										.map((file) => (
											<VideoAttachment
												key={`${message.id}-${file}`}
												file={file}
												src={getUrl(file)}
												onClick={handleFileClick}
											/>
										))}
								</Box>
							)}

							{/* Only render message content when not streaming */}
							{message.message &&
								!(message.is_streamable && !message.is_complete) && (
									<MessageContent content={message.message} isUser={isUser} />
								)}

							{/* Determine if we have any collapsible content */}
							{(() => {
								const hasCollapsibleContent =
									isSecurityCheck &&
									(message.code ||
										message.stdout ||
										message.stderr ||
										message.logging);

								// Content to be rendered inside the collapsible section
								const contentBlocks = (
									<>
										{/* Render code with syntax highlighting */}
										{message.code && (
											<CodeBlock code={message.code} isUser={isUser} />
										)}

										{/* Render stdout */}
										{message.stdout && (
											<OutputBlock output={message.stdout} isUser={isUser} />
										)}

										{/* Render stderr */}
										{message.stderr && (
											<ErrorBlock error={message.stderr} isUser={isUser} />
										)}

										{/* Render logging */}
										{message.logging && (
											<LogBlock log={message.logging} isUser={isUser} />
										)}
									</>
								);

								// If it's a security check with collapsible content, wrap in CollapsibleMessage
								if (hasCollapsibleContent) {
									return (
										<CollapsibleMessage
											defaultCollapsed={true}
											hasContent={hasCollapsibleContent}
										>
											{contentBlocks}
										</CollapsibleMessage>
									);
								}

								// Otherwise, render content normally
								return contentBlocks;
							})()}

							{/* Status indicator if present */}
							{message.status && <StatusIndicator status={message.status} />}

							{/* Render non-media file attachments if any */}
							{message.files && message.files.length > 0 && (
								<Box sx={{ mt: 2 }}>
									{message.files
										.filter((file) => !isImage(file) && !isVideo(file))
										.map((file) => (
											<FileAttachment
												key={`${message.id}-${file}`}
												file={file}
												onClick={handleFileClick}
												conversationId={conversationId}
											/>
										))}
								</Box>
							)}

							{/* Message timestamp */}
							<MessageTimestamp timestamp={message.timestamp} isUser={isUser} />
						</MessagePaper>
					</SecurityCheckHighlight>
				) : (
					<ActionHighlight
						action={message.action || "CODE"}
						taskClassification={message.task_classification || ""}
						isUser={isUser}
						executionType={message.execution_type}
					>
						<MessagePaper
							isUser={isUser}
							content={message.message}
							message={message}
							onMessageComplete={onMessageComplete}
							isLastMessage={isLastMessage ?? false}
						>
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

							{/* Render video attachments if any */}
							{message.files && message.files.length > 0 && (
								<Box sx={{ mb: 2 }}>
									{message.files
										.filter((file) => isVideo(file))
										.map((file) => (
											<VideoAttachment
												key={`${message.id}-${file}`}
												file={file}
												src={getUrl(file)}
												onClick={handleFileClick}
											/>
										))}
								</Box>
							)}

							{/* Only render message content when not streaming */}
							{message.message &&
								!(message.is_streamable && !message.is_complete) && (
									<MessageContent content={message.message} isUser={isUser} />
								)}

							{/* Determine if we have any collapsible content */}
							{(() => {
								const hasCollapsibleContent =
									isAction &&
									(message.code ||
										message.stdout ||
										message.stderr ||
										message.logging);

								// Content to be rendered inside the collapsible section
								const contentBlocks = (
									<>
										{/* Render code with syntax highlighting */}
										{message.code && (
											<CodeBlock code={message.code} isUser={isUser} />
										)}

										{/* Render stdout */}
										{message.stdout && (
											<OutputBlock output={message.stdout} isUser={isUser} />
										)}

										{/* Render stderr */}
										{message.stderr && (
											<ErrorBlock error={message.stderr} isUser={isUser} />
										)}

										{/* Render logging */}
										{message.logging && (
											<LogBlock log={message.logging} isUser={isUser} />
										)}
									</>
								);

								// If it's an action type with collapsible content, wrap in CollapsibleMessage
								if (hasCollapsibleContent) {
									return (
										<CollapsibleMessage
											defaultCollapsed={true}
											hasContent={hasCollapsibleContent}
										>
											{contentBlocks}
										</CollapsibleMessage>
									);
								}

								// Otherwise, render content normally
								return contentBlocks;
							})()}

							{/* Status indicator if present */}
							{message.status && <StatusIndicator status={message.status} />}

							{/* Render non-media file attachments if any */}
							{message.files && message.files.length > 0 && (
								<Box sx={{ mt: 2 }}>
									{message.files
										.filter((file) => !isImage(file) && !isVideo(file))
										.map((file) => (
											<FileAttachment
												key={`${message.id}-${file}`}
												file={file}
												onClick={handleFileClick}
												conversationId={conversationId}
											/>
										))}
								</Box>
							)}

							{/* Message timestamp */}
							<MessageTimestamp timestamp={message.timestamp} isUser={isUser} />
						</MessagePaper>
					</ActionHighlight>
				)}
			</MessageContainer>
		);
	},
	(prevProps, nextProps) => {
		// Custom comparison function for memo
		// Re-render if any of these properties have changed
		return (
			prevProps.message.id === nextProps.message.id &&
			prevProps.message.message === nextProps.message.message &&
			prevProps.message.status === nextProps.message.status &&
			prevProps.message.is_complete === nextProps.message.is_complete &&
			prevProps.message.is_streamable === nextProps.message.is_streamable
		);
	},
);
