import { Box, CircularProgress, Typography, styled } from "@mui/material";
import type { AgentExecutionRecord } from "@shared/api/local-operator";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import { RingLoadingIndicator } from "@shared/components/common/ring-loading-indicator";
import { apiConfig } from "@shared/config";
import { useStreamingMessage } from "@shared/hooks/use-streaming-message";
import { useStreamingMessagesStore } from "@shared/store/streaming-messages-store";
import { getLanguageFromExtension } from "@shared/utils/file-utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExpandableActionElement } from "../expandable-action-element";
import { MarkdownRenderer } from "../markdown-renderer";
import { AudioAttachment } from "./audio-attachment";
import { CodeBlock } from "./code-block";
import { ErrorBlock } from "./error-block";
import { ExpandableThinkingContent } from "./expandable-thinking-content";
import { FileAttachment } from "./file-attachment";
import { ImageAttachment } from "./image-attachment";
import { LogBlock } from "./log-block";
import { OutputBlock } from "./output-block";
import { VideoAttachment } from "./video-attachment";

// Module-level helpers for attachment handling to keep hook deps clean and stable
const isWebUrl = (path: string): boolean =>
	path.startsWith("http://") || path.startsWith("https://");

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

const getAttachmentUrl = (
	client: ReturnType<typeof createLocalOperatorClient>,
	path: string,
): string => {
	if (path.startsWith("http")) return path;
	const normalizedPath = path.startsWith("file://") ? path : `file://${path}`;
	if (isImage(path)) return client.static.getImageUrl(normalizedPath);
	if (isVideo(path)) return client.static.getVideoUrl(normalizedPath);
	if (isAudio(path)) return client.static.getAudioUrl(normalizedPath);
	return path;
};

const getStreamingPreviewText = (
	message: AgentExecutionRecord | null,
): string => {
	const cleanedMessage = message?.message
		?.replace(/\s+/g, " ")
		.replace(/(```\w+\s*)+$/g, "")
		.trim();

	if (cleanedMessage) {
		return cleanedMessage;
	}

	switch (message?.action) {
		case "CODE":
			return "Executing code";
		case "READ":
			return "Reading content";
		case "WRITE":
			return "Writing content";
		case "EDIT":
			return "Editing content";
		case "ASK":
			return "Formulating a question";
		default:
			return "Working on your request";
	}
};

const StreamingContainer = styled(Box)(() => ({
	position: "relative",
	overflow: "hidden",
	wordBreak: "break-word",
	overflowWrap: "break-word",
}));

const StatusIndicator = styled(Box)(({ theme }) => ({
	position: "absolute",
	top: 0,
	right: 0,
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(0.5),
	padding: theme.spacing(0.5),
	borderRadius: theme.shape.borderRadius,
	backgroundColor: theme.palette.background.paper,
	boxShadow: theme.shadows[1],
	zIndex: 1,
}));

/**
 * Props for the StreamingMessage component
 */
type StreamingMessageProps = {
	messageId: string;
	autoConnect?: boolean;
	onComplete?: (message: AgentExecutionRecord) => void;
	onUpdate?: (message: AgentExecutionRecord) => void;
	showStatus?: boolean;
	showOutput?: boolean;
	children?: React.ReactNode;
	onConnectionControls?: (controls: {
		connect: () => void;
		disconnect: () => void;
		refetch: () => void;
	}) => void;
	keepAlive?: boolean;
	sx?: React.CSSProperties | Record<string, unknown>;
	className?: string;
	conversationId?: string;
	refetchOnComplete?: boolean;
	styleProps?: Record<string, unknown>;
	compactInProgress?: boolean;
};

export const StreamingMessage = ({
	messageId,
	autoConnect = true,
	onComplete,
	onUpdate,
	showStatus = true,
	children,
	onConnectionControls,
	keepAlive = true,
	sx,
	className,
	conversationId,
	refetchOnComplete = true,
	styleProps,
	compactInProgress = false,
}: StreamingMessageProps) => {
	const storeMessage = useStreamingMessagesStore(
		(state) => state.streamingMessages[messageId] ?? null,
	);
	const isStoreMessageComplete = storeMessage?.isComplete ?? false;

	const {
		message: wsMessage,
		isStreamable,
		status,
		isLoading,
		isRefetching,
		error,
		connect,
		disconnect,
		refetch,
	} = useStreamingMessage({
		messageId,
		autoConnect,
		onComplete,
		onUpdate,
		keepAlive,
		conversationId,
		refetchOnComplete,
	});

	const lastLogTimeRef = useRef(0);
	const scrollRef = useRef<HTMLDivElement>(null);
	const shouldAutoScrollRef = useRef(true);
	const containerRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!scrollRef.current) return;
		let parent = scrollRef.current.parentElement;
		while (parent) {
			const { overflow, overflowY } = window.getComputedStyle(parent);
			if (
				overflow === "auto" ||
				overflow === "scroll" ||
				overflowY === "auto" ||
				overflowY === "scroll"
			) {
				containerRef.current = parent;
				break;
			}
			parent = parent.parentElement;
		}
		const handleScroll = () => {
			if (!containerRef.current) return;
			const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
			const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
			if (distanceFromBottom > 150) {
				shouldAutoScrollRef.current = false;
			} else {
				shouldAutoScrollRef.current = true;
			}
		};
		if (containerRef.current) {
			containerRef.current.addEventListener("scroll", handleScroll, {
				passive: true,
			});
		}
		return () => {
			if (containerRef.current) {
				containerRef.current.removeEventListener("scroll", handleScroll);
			}
		};
	}, []);

	useEffect(() => {
		if (wsMessage) {
			const now = Date.now();
			if (now - lastLogTimeRef.current > 500) {
				lastLogTimeRef.current = now;
			}
			if (
				scrollRef.current &&
				wsMessage.message &&
				shouldAutoScrollRef.current
			) {
				requestAnimationFrame(() => {
					scrollRef.current?.scrollIntoView({ behavior: "smooth" });
				});
			}
		}
	}, [wsMessage]);

	const isActivelyStreaming = useMemo(
		() => status === "connected" && !isStoreMessageComplete,
		[status, isStoreMessageComplete],
	);

	const lastValidMessageRef = useRef<AgentExecutionRecord | null>(null);

	const message = useMemo(() => {
		// Priority order for message data:
		// 1. WebSocket message (most current)
		// 2. Store message content (when streaming is complete)
		// 3. Last valid message (fallback)

		if (wsMessage) {
			lastValidMessageRef.current = wsMessage;
			return wsMessage;
		}

		if (isStoreMessageComplete && storeMessage?.content) {
			lastValidMessageRef.current = storeMessage.content;
			return storeMessage.content;
		}

		// If we have a complete message in the registry, use that
		if (storeMessage?.content) {
			lastValidMessageRef.current = storeMessage.content;
			return storeMessage.content;
		}

		return lastValidMessageRef.current || null;
	}, [wsMessage, storeMessage, isStoreMessageComplete]);

	const connectionControls = useMemo(
		() => ({
			connect,
			disconnect,
			refetch,
		}),
		[connect, disconnect, refetch],
	);

	useEffect(() => {
		if (onConnectionControls) {
			onConnectionControls(connectionControls);
		}
	}, [onConnectionControls, connectionControls]);

	const [isActionExpanded, setIsActionExpanded] = useState(!compactInProgress);
	const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
	const [isInProgressDetailsExpanded, setIsInProgressDetailsExpanded] =
		useState(!compactInProgress);

	useEffect(() => {
		if (!messageId) {
			return;
		}
		setIsActionExpanded(!compactInProgress);
		setIsThinkingExpanded(false);
		setIsInProgressDetailsExpanded(!compactInProgress);
	}, [messageId, compactInProgress]);

	const useCompactInProgressMode = compactInProgress && !isStoreMessageComplete;
	const showExpandedStreamingDetails =
		!useCompactInProgressMode || isInProgressDetailsExpanded;

	useEffect(() => {
		if (useCompactInProgressMode && isInProgressDetailsExpanded) {
			setIsActionExpanded(true);
		}
	}, [useCompactInProgressMode, isInProgressDetailsExpanded]);

	const compactPreviewText = useMemo(
		() => getStreamingPreviewText(message),
		[message],
	);

	const toggleInProgressDetails = useCallback(() => {
		if (!useCompactInProgressMode) return;
		setIsInProgressDetailsExpanded((prev) => !prev);
	}, [useCompactInProgressMode]);

	const compactSummaryLine = useMemo(() => {
		if (!useCompactInProgressMode) {
			return null;
		}

		return (
			<Box
				component="button"
				type="button"
				aria-expanded={isInProgressDetailsExpanded}
				onClick={toggleInProgressDetails}
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 1,
					cursor: "pointer",
					minHeight: 28,
					opacity: 0.9,
					mb: showExpandedStreamingDetails ? 1 : 0,
					padding: 0,
					width: "100%",
					border: "none",
					background: "transparent",
					textAlign: "left",
				}}
			>
				<Typography
					variant="body2"
					noWrap
					sx={{
						flex: 1,
						fontSize: "0.82rem",
						lineHeight: 1.35,
						color: "text.disabled",
					}}
				>
					{compactPreviewText}
				</Typography>
				{isActivelyStreaming && <CircularProgress size={12} thickness={4} />}
			</Box>
		);
	}, [
		useCompactInProgressMode,
		isInProgressDetailsExpanded,
		showExpandedStreamingDetails,
		compactPreviewText,
		isActivelyStreaming,
		toggleInProgressDetails,
	]);

	const statusIndicator = useMemo(() => {
		if (!showStatus || useCompactInProgressMode) return null;
		switch (status) {
			case "connecting":
			case "reconnecting":
				return (
					<StatusIndicator>
						<CircularProgress size={16} />
						<Typography variant="caption">
							{status === "connecting" ? "Connecting..." : "Reconnecting..."}
						</Typography>
					</StatusIndicator>
				);
			case "connected":
				return (
					<StatusIndicator>
						<Box
							sx={{
								width: 8,
								height: 8,
								borderRadius: "50%",
								backgroundColor: "success.main",
							}}
						/>
						<Typography variant="caption">Connected</Typography>
					</StatusIndicator>
				);
			case "disconnected":
				return (
					<StatusIndicator>
						<Box
							sx={{
								width: 8,
								height: 8,
								borderRadius: "50%",
								backgroundColor: "text.disabled",
							}}
						/>
						<Typography variant="caption">Disconnected</Typography>
					</StatusIndicator>
				);
			case "error":
				return (
					<StatusIndicator>
						<Box
							sx={{
								width: 8,
								height: 8,
								borderRadius: "50%",
								backgroundColor: "error.main",
							}}
						/>
						<Typography variant="caption">Error</Typography>
					</StatusIndicator>
				);
			default:
				return null;
		}
	}, [status, showStatus, useCompactInProgressMode]);

	const loadingIndicator = useMemo(() => {
		if (!isLoading && !isRefetching) return null;
		return (
			<Box sx={{ display: "flex", alignItems: "center", mt: 1 }}>
				<CircularProgress size={16} sx={{ mr: 1 }} />
				<Typography variant="body2">
					{isRefetching
						? "Refreshing message data..."
						: "Loading message data..."}
				</Typography>
			</Box>
		);
	}, [isLoading, isRefetching]);

	const messageContent = useMemo(() => {
		if (!message?.message) return null;
		return (
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
				<MarkdownRenderer content={message.message} styleProps={styleProps} />
			</Box>
		);
	}, [message?.message, styleProps]);

	const streamingLoader = useMemo(() => {
		if (status === "connected" && !message?.message) {
			return (
				<Box
					sx={{ width: "100%", display: "flex", justifyContent: "flex-start" }}
				>
					<RingLoadingIndicator size={30} />
				</Box>
			);
		}
		return null;
	}, [status, message?.message]);

	const errorDisplay = useMemo(() => {
		if (!error) return null;
		return (
			<Box
				sx={{
					mt: 1,
					p: 1,
					backgroundColor: "error.main",
					color: "error.contrastText",
					borderRadius: 1,
				}}
			>
				<Typography variant="subtitle2">Error:</Typography>
				<Typography variant="body2">{error.message}</Typography>
			</Box>
		);
	}, [error]);

	const handleActionExpand = () => setIsActionExpanded(true);
	const handleActionCollapse = (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsActionExpanded(false);
	};

	const handleThinkingExpand = () => setIsThinkingExpanded(true);
	const handleThinkingCollapse = (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsThinkingExpanded(false);
	};

	const hasCollapsibleContent = Boolean(
		message?.execution_type === "action" && message?.action,
	);

	const fileLanguage = getLanguageFromExtension(message?.file_path || "");

	const client = useMemo(
		() => createLocalOperatorClient(apiConfig.baseUrl),
		[],
	);
	const getUrl = useCallback(
		(path: string) => getAttachmentUrl(client, path),
		[client],
	);

	const handleFileClick = useCallback(async (filePath: string) => {
		try {
			if (isWebUrl(filePath)) {
				await window.api.openExternal(filePath);
			} else {
				const normalizedPath = filePath.startsWith("file://")
					? filePath.substring(7)
					: filePath;
				await window.api.openFile(normalizedPath);
			}
		} catch (error) {
			console.error("Error opening file:", error);
			alert(
				`Unable to open file: ${filePath}. The file may be incomplete, deleted, or moved.`,
			);
		}
	}, []);

	return (
		<StreamingContainer
			className={`${isStreamable ? "streamable-message" : ""} ${className || ""}`}
			sx={sx}
			data-streaming={isActivelyStreaming ? "true" : "false"}
		>
			{statusIndicator}
			{compactSummaryLine}

			{showExpandedStreamingDetails && (
				<>
					{children}
					{loadingIndicator}
					{message?.thinking && (
						<ExpandableThinkingContent
							thinking={message.thinking}
							isExpanded={isThinkingExpanded}
							onExpand={handleThinkingExpand}
							onCollapse={handleThinkingCollapse}
						/>
					)}
					{messageContent}
					{streamingLoader}

					{/* Use the shared expandable action element */}
					<ExpandableActionElement
						executionType={message?.execution_type || "action"}
						action={message?.action}
						isUser={false}
						isExpanded={isActionExpanded}
						onExpand={handleActionExpand}
						onCollapse={handleActionCollapse}
						hasCollapsibleContent={hasCollapsibleContent}
						isLoading={isActivelyStreaming}
					>
						{message?.code && (
							<CodeBlock
								code={message.code}
								isUser={false}
								flexDirection="column-reverse"
							/>
						)}
						{message?.content && (
							<CodeBlock
								header="Content"
								code={message.content}
								isUser={false}
								language={fileLanguage}
								flexDirection="column-reverse"
							/>
						)}
						{message?.replacements && (
							<CodeBlock
								header="Replacements"
								code={message.replacements}
								isUser={false}
								language="diff"
								flexDirection="column-reverse"
							/>
						)}
						{message?.stdout && (
							<OutputBlock output={message.stdout} isUser={false} />
						)}
						{message?.stderr && (
							<ErrorBlock error={message.stderr} isUser={false} />
						)}
						{message?.logging && (
							<LogBlock log={message.logging} isUser={false} />
						)}
					</ExpandableActionElement>

					{/* Live attachments during streaming - render BELOW the action element to match final layout */}
					{message?.files && message.files.length > 0 && (
						<Box sx={{ mb: 2, mt: 2 }}>
							{message.files
								.filter((file) => isImage(file))
								.map((file) => (
									<ImageAttachment
										key={`${messageId}-${file}`}
										file={file}
										src={getUrl(file)}
										onClick={handleFileClick}
										conversationId={conversationId ?? ""}
									/>
								))}
						</Box>
					)}

					{message?.files && message.files.length > 0 && (
						<Box sx={{ mb: 2 }}>
							{message.files
								.filter((file) => isVideo(file))
								.map((file) => (
									<VideoAttachment
										key={`${messageId}-${file}`}
										file={file}
										src={getUrl(file)}
										onClick={handleFileClick}
										conversationId={conversationId ?? ""}
									/>
								))}
						</Box>
					)}

					{message?.files &&
						message.files.length > 0 &&
						message.files.some((file) => isAudio(file)) && (
							<Box sx={{ mb: 2 }}>
								{message.files
									.filter((file) => isAudio(file))
									.map((file) => (
										<AudioAttachment
											key={`${messageId}-${file}`}
											content={getUrl(file)}
											isUser={false}
										/>
									))}
							</Box>
						)}

					{message?.files && message.files.length > 0 && (
						<Box sx={{ mt: 2 }}>
							{message.files
								.filter(
									(file) => !isImage(file) && !isVideo(file) && !isAudio(file),
								)
								.map((file) => (
									<FileAttachment
										key={`${messageId}-${file}`}
										file={file}
										onClick={handleFileClick}
										conversationId={conversationId ?? ""}
									/>
								))}
						</Box>
					)}

					{errorDisplay}
				</>
			)}
			<div ref={scrollRef} style={{ height: 1, width: 1, opacity: 0 }} />
		</StreamingContainer>
	);
};

StreamingMessage.displayName = "StreamingMessage";
