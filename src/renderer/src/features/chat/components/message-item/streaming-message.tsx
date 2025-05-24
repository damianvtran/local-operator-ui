import { Box, CircularProgress, Typography, styled, alpha, Collapse, Tooltip } from "@mui/material";
import type { AgentExecutionRecord } from "@shared/api/local-operator";
import { useStreamingMessage } from "@shared/hooks/use-streaming-message";
import { useStreamingMessagesStore } from "@shared/store/streaming-messages-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeBlock } from "./code-block";
import { OutputBlock } from "./output-block";
import { ErrorBlock } from "./error-block";
import { LogBlock } from "./log-block";
import { FileAttachment } from "./file-attachment";
import { ImageAttachment } from "./image-attachment";
import { VideoAttachment } from "./video-attachment";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faBook,
	faCheck,
	faChevronUp,
	faCode,
	faEdit,
	faLightbulb,
	faPencilAlt,
	faQuestion,
	faShare,
	faCommentDots,
} from "@fortawesome/free-solid-svg-icons";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { MarkdownRenderer } from "../markdown-renderer";

// Styled components
const StreamingContainer = styled(Box)(() => ({
	position: "relative",
	overflow: "hidden",
	borderRadius: 8,
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

const BlockHeader = styled(Box, {
	shouldForwardProp: (prop) =>
		prop !== "executionType" && prop !== "isUser" && prop !== "isExpanded",
})<{ executionType: string; isUser: boolean; isExpanded: boolean }>(
	({ theme, isExpanded }) => ({
		cursor: "pointer",
		"&:hover": {
			opacity: 0.9,
		},
		display: "flex",
		alignItems: "center",
		padding: "4px 22px 4px 12px",
		backgroundColor: alpha(
			theme.palette.common.black,
			theme.palette.mode === "dark" ? 0.2 : 0.05,
		),
		borderRadius: isExpanded ? "8px 8px 0 0" : "8px",
		borderColor: theme.palette.divider,
		borderWidth: 1,
		borderStyle: "solid",
		borderBottomColor: isExpanded ? "transparent" : theme.palette.divider,
		transition: `background-color 0.3s ${theme.transitions.easing.easeInOut}, 
                   border-radius 0.3s ${theme.transitions.easing.easeInOut}`,
	}),
);

const BlockIcon = styled(Box)(({ theme }) => ({
	marginRight: 8,
	width: 40,
	height: 40,
	flexShrink: 0,
	borderRadius: "100%",
	backgroundColor: alpha(
		theme.palette.common.black,
		theme.palette.mode === "dark" ? 0.2 : 0.05,
	),
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	color: theme.palette.icon.text,
	transform: "scale(1) rotate(0deg)",
	transition: `transform 0.4s ${theme.transitions.easing.easeOut}`,
	"&.animate": {
		animation: "iconAppear 0.4s forwards",
	},
	"@keyframes iconAppear": {
		"0%": {
			transform: "scale(0.8) rotate(-10deg)",
		},
		"100%": {
			transform: "scale(1) rotate(0deg)",
		},
	},
}));

const BlockTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
	transform: "translateX(0)",
	transition: `transform 0.4s ${theme.transitions.easing.easeOut}`,
	"&.animate": {
		animation: "titleFadeIn 0.4s forwards",
	},
	"@keyframes titleFadeIn": {
		"0%": {
			transform: "translateX(-5px)",
		},
		"100%": {
			transform: "translateX(0)",
		},
	},
}));

const BlockContent = styled(Box)(({ theme }) => ({
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
	overflow: "hidden",
	transform: "translateY(0)",
	transition: `transform 0.4s ${theme.transitions.easing.easeOut}`,
	"&.animate": {
		animation: "contentFadeIn 0.4s forwards",
	},
	"@keyframes contentFadeIn": {
		"0%": {
			transform: "translateY(5px)",
		},
		"100%": {
			transform: "translateY(0)",
		},
	},
}));

const ExpandedContent = styled(Box)(({ theme }) => ({
	padding: "12px 16px",
	backgroundColor: alpha(
		theme.palette.common.black,
		theme.palette.mode === "dark" ? 0.2 : 0.05,
	),
	borderBottomLeftRadius: 8,
	borderBottomRightRadius: 8,
	borderColor: theme.palette.divider,
	borderWidth: 1,
	borderStyle: "solid",
	borderTop: "none",
	fontSize: "0.85rem",
	color: theme.palette.text.primary,
	marginLeft: 0,
}));

const CollapseButton = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	padding: "8px",
	marginTop: "8px",
	cursor: "pointer",
	borderRadius: "4px",
	backgroundColor: alpha(
		theme.palette.common.black,
		theme.palette.mode === "dark" ? 0.1 : 0.03,
	),
	transition: `all 0.2s ${theme.transitions.easing.easeInOut}`,
	"&:hover": {
		backgroundColor: alpha(
			theme.palette.common.black,
			theme.palette.mode === "dark" ? 0.15 : 0.05,
		),
		transform: "translateY(-1px)",
		boxShadow: `0 2px 4px ${alpha(theme.palette.common.black, 0.1)}`,
	},
	"&:active": {
		transform: "translateY(0px)",
		boxShadow: "none",
	},
}));

/**
 * Props for the StreamingMessage component
 */
type StreamingMessageProps = {
	/** Message ID to subscribe to */
	messageId: string;
	/** Whether to automatically connect to the WebSocket */
	autoConnect?: boolean;
	/** Callback when the message is complete */
	onComplete?: (message: AgentExecutionRecord) => void;
	/** Callback when the message is updated */
	onUpdate?: (message: AgentExecutionRecord) => void;
	/** Whether to show the status indicator */
	showStatus?: boolean;
	/** Whether to show the output sections */
	showOutput?: boolean;
	/** Children to render */
	children?: React.ReactNode;
	/** Callback to get connection controls */
	onConnectionControls?: (controls: {
		connect: () => void;
		disconnect: () => void;
		refetch: () => void;
	}) => void;
	/** Whether to keep the connection alive even after component unmounts */
	keepAlive?: boolean;
	/** Custom styles to apply to the container */
	sx?: React.CSSProperties | Record<string, unknown>;
	/** Custom class name to apply to the container */
	className?: string;
	/** Conversation ID this message belongs to (for updating the chat store) */
	conversationId?: string;
	/** Whether to refetch the message when complete */
	refetchOnComplete?: boolean;
};

/**
 * Component for displaying a streaming message
 *
 * This component uses the useStreamingMessage hook to subscribe to updates
 * for a specific message ID and display the streaming updates.
 * It also integrates with the streaming messages store to provide a seamless
 * transition between streaming and completed messages.
 */
export const StreamingMessage = ({
	messageId,
	autoConnect = true,
	onComplete,
	onUpdate,
	showStatus = true,
	children,
	onConnectionControls,
	keepAlive = true, // Default to keeping connection alive
	sx,
	className,
	conversationId,
	refetchOnComplete = true,
}: StreamingMessageProps) => {
	// Get streaming messages store functions
	const { getStreamingMessage, isMessageStreamingComplete } =
		useStreamingMessagesStore();

	// Get the streaming message from the store
	const storeMessage = getStreamingMessage(messageId);
	const isStoreMessageComplete = isMessageStreamingComplete(messageId);

	// Custom onComplete handler that will trigger a refetch
	const handleComplete = useCallback(
		(completedMessage: AgentExecutionRecord) => {
			// Call the original onComplete callback
			if (onComplete) {
				onComplete(completedMessage);
			}
		},
		[onComplete],
	);

	// Use our streaming message hook to handle WebSocket connections
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
		onComplete: handleComplete,
		onUpdate,
		keepAlive,
		conversationId,
		refetchOnComplete,
	});

	// Debug logging to help diagnose issues - but throttled to reduce console spam
	const lastLogTimeRef = useRef(0);

	// Add a scroll ref at the bottom of the streaming message for auto-scrolling
	const scrollRef = useRef<HTMLDivElement>(null);

	// Track if we should auto-scroll based on user's scroll position
	const shouldAutoScrollRef = useRef(true);

	// Track the container element for scroll position calculations
	const containerRef = useRef<HTMLElement | null>(null);

	// Find the scrollable container once when the component mounts
	useEffect(() => {
		if (!scrollRef.current) return;

		// Find the scrollable parent
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

		// Set up a one-time scroll handler to detect when user scrolls away
		const handleScroll = () => {
			if (!containerRef.current) return;

			const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
			const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

			// If user scrolls away from bottom, disable auto-scrolling
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

	// Handle streaming message updates
	useEffect(() => {
		if (wsMessage) {
			const now = Date.now();
			// Only log every 500ms to avoid excessive logging
			if (now - lastLogTimeRef.current > 500) {
				lastLogTimeRef.current = now;
			}

			// Only auto-scroll if we're near the bottom
			if (
				scrollRef.current &&
				wsMessage.message &&
				shouldAutoScrollRef.current
			) {
				// Use requestAnimationFrame for smoother scrolling
				requestAnimationFrame(() => {
					scrollRef.current?.scrollIntoView({ behavior: "smooth" });
				});
			}
		}
	}, [wsMessage]);

	// Determine which message to use - store or WebSocket
	// CRITICAL: During active streaming, ALWAYS prioritize the WebSocket message
	// for real-time updates, regardless of what's in the store
	const isActivelyStreaming = useMemo(
		() => status === "connected" && !isStoreMessageComplete,
		[status, isStoreMessageComplete],
	);

	// Always use the WebSocket message when actively streaming
	// This is the key change - we're not checking if wsMessage exists
	// because we want to show real-time updates even if they're empty at first
	// Use a ref to track the last valid message to prevent flickering
	const lastValidMessageRef = useRef<AgentExecutionRecord | null>(null);

	const message = useMemo(() => {
		// If we're actively streaming, ALWAYS use the WebSocket message
		if (isActivelyStreaming && wsMessage) {
			lastValidMessageRef.current = wsMessage;
			return wsMessage;
		}

		// If we're not streaming or the WebSocket message is null,
		// fall back to the store message or the last valid message
		const result =
			storeMessage?.content || wsMessage || lastValidMessageRef.current;

		// Update the last valid message ref if we have a result
		if (result) {
			lastValidMessageRef.current = result;
		}

		return result;
	}, [isActivelyStreaming, wsMessage, storeMessage]);

	// Stable reference to the connection controls - memoized to prevent unnecessary re-renders
	const connectionControls = useMemo(
		() => ({
			connect,
			disconnect,
			refetch,
		}),
		[connect, disconnect, refetch],
	);

	// Provide connection controls to parent component if needed
	useEffect(() => {
		if (onConnectionControls) {
			onConnectionControls(connectionControls);
		}
	}, [onConnectionControls, connectionControls]);

	// Memoized status indicator renderer - only re-render when status or showStatus changes
	const statusIndicator = useMemo(() => {
		if (!showStatus) return null;

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
	}, [status, showStatus]);

	// Memoize the loading indicator to prevent unnecessary re-renders
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

	// Memoize the message content to prevent unnecessary re-renders
	const messageContent = useMemo(() => {
		if (!message?.message) return null;
		return <MarkdownRenderer content={message.message} />;
	}, [message?.message]);

	// Skeleton loader for when we're connected but waiting for first token
	const skeletonLoader = useMemo(() => {
		// Only show skeleton when we're connected but don't have a message yet
		if (status === "connected" && !message?.message) {
			return (
				<Box sx={{ mt: 1, mb: 1 }}>
					<Box
						sx={{
							height: 16,
							width: "90%",
							backgroundColor: (theme) =>
								theme.palette.mode === "dark"
									? "rgba(255, 255, 255, 0.1)"
									: "rgba(0, 0, 0, 0.1)",
							borderRadius: 1,
							mb: 1,
							animation: "pulse 1.5s ease-in-out infinite",
							"@keyframes pulse": {
								"0%": { opacity: 0.6 },
								"50%": { opacity: 1 },
								"100%": { opacity: 0.6 },
							},
						}}
					/>
					<Box
						sx={{
							height: 16,
							width: "75%",
							backgroundColor: (theme) =>
								theme.palette.mode === "dark"
									? "rgba(255, 255, 255, 0.1)"
									: "rgba(0, 0, 0, 0.1)",
							borderRadius: 1,
							mb: 1,
							animation: "pulse 1.5s ease-in-out 0.2s infinite",
							"@keyframes pulse": {
								"0%": { opacity: 0.6 },
								"50%": { opacity: 1 },
								"100%": { opacity: 0.6 },
							},
						}}
					/>
					<Box
						sx={{
							height: 16,
							width: "60%",
							backgroundColor: (theme) =>
								theme.palette.mode === "dark"
									? "rgba(255, 255, 255, 0.1)"
									: "rgba(0, 0, 0, 0.1)",
							borderRadius: 1,
							animation: "pulse 1.5s ease-in-out 0.4s infinite",
							"@keyframes pulse": {
								"0%": { opacity: 0.6 },
								"50%": { opacity: 1 },
								"100%": { opacity: 0.6 },
							},
						}}
					/>
				</Box>
			);
		}
		return null;
	}, [status, message?.message]);

	// Memoize the error display to prevent unnecessary re-renders
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

	// --- Attachments logic (copied from action-block.tsx) ---
	const client = useMemo(() => {
		return createLocalOperatorClient(apiConfig.baseUrl);
	}, []);

	const getUrl = useCallback(
		(path: string) => {
			if (path.startsWith("http")) return path;
			const normalizedPath = path.startsWith("file://") ? path : `file://${path}`;
			const isImage = (p: string) => {
				const imageExtensions = [
					".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".tiff", ".tif", ".ico", ".heic", ".heif", ".avif", ".jfif", ".pjpeg", ".pjp",
				];
				const lowerPath = p.toLowerCase();
				return imageExtensions.some((ext) => lowerPath.endsWith(ext));
			};
			const isVideo = (p: string) => {
				const videoExtensions = [
					".mp4", ".webm", ".ogg", ".mov", ".avi", ".wmv", ".flv", ".mkv", ".m4v", ".3gp", ".3g2",
				];
				const lowerPath = p.toLowerCase();
				return videoExtensions.some((ext) => lowerPath.endsWith(ext));
			};
			if (isImage(path)) return client.static.getImageUrl(normalizedPath);
			if (isVideo(path)) return client.static.getVideoUrl(normalizedPath);
			return path;
		},
		[client],
	);

	const handleFileClick = useCallback((filePath: string) => {
		try {
			if (filePath.startsWith("http")) {
				window.api.openExternal(filePath);
			} else {
				const normalizedPath = filePath.startsWith("file://")
					? filePath.substring(7)
					: filePath;
				window.api.openFile(normalizedPath);
			}
		} catch (error) {
			console.error("Error opening file:", error);
		}
	}, []);

	// --- Collapsible technical details logic (copied from action-block.tsx) ---
	const [isExpanded, setIsExpanded] = useState(false);
	const [mounted, setMounted] = useState(false);
	const mountedRef = useRef(false);

	useEffect(() => {
		if (!mountedRef.current) {
			mountedRef.current = true;
			const timer = setTimeout(() => {
				setMounted(true);
			}, 50);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, []);

	useEffect(() => {
		setMounted(true);
	}, []);

	const handleExpand = () => setIsExpanded(true);
	const handleCollapse = (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsExpanded(false);
	};

	const getTitle = () => {
		switch (message?.action) {
			case "DONE":
				return "Task Complete";
			case "ASK":
				return "Asking a Question";
			case "CODE":
				return "Executing Code";
			case "WRITE":
				return "Writing Content";
			case "EDIT":
				return "Editing Content";
			case "READ":
				return "Reading Content";
			case "DELEGATE":
				return "Delegating Task";
			default:
				return message?.execution_type === "plan"
					? "Planning"
					: message?.execution_type === "action"
						? "Action"
						: "Reflection";
		}
	};

	const getIcon = () => {
		switch (message?.action) {
			case "DONE":
				return faCheck;
			case "ASK":
				return faQuestion;
			case "CODE":
				return faCode;
			case "WRITE":
				return faPencilAlt;
			case "EDIT":
				return faEdit;
			case "READ":
				return faBook;
			case "DELEGATE":
				return faShare;
			default:
				return message?.execution_type === "plan"
					? faLightbulb
					: message?.execution_type === "action"
						? faCode
						: faCommentDots;
		}
	};

	const hasCollapsibleContent =
		message?.execution_type === "action" &&
		(message?.code || message?.stdout || message?.stderr || message?.logging);

	return (
		<StreamingContainer
			className={`${isStreamable ? "streamable-message" : ""} ${className || ""}`}
			sx={sx}
			data-streaming={isActivelyStreaming ? "true" : "false"}
		>
			{statusIndicator}
			{children}
			{loadingIndicator}
			{messageContent}
			{skeletonLoader}

			{/* Collapsible technical details block */}
			{hasCollapsibleContent && (
				<>
					<BlockHeader
						executionType={message?.execution_type || "action"}
						isUser={false}
						isExpanded={isExpanded}
						onClick={isExpanded ? handleCollapse : handleExpand}
					>
						<BlockIcon className={mounted ? "animate" : ""}>
							<FontAwesomeIcon icon={getIcon()} size="sm" />
						</BlockIcon>
						<Box
							sx={{
								flexGrow: 1,
								position: "relative",
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
							}}
						>
							<BlockTitle
								variant="subtitle2"
								className={mounted ? "animate" : ""}
							>
								{getTitle()}
							</BlockTitle>
							{!isExpanded ? (
								<Tooltip title="View Details">
									<BlockContent className={mounted ? "animate" : ""}>
										<ChevronDown size={22} style={{ marginTop: 4 }} />
									</BlockContent>
								</Tooltip>
							) : (
								<Tooltip title="Collapse Details">
									<BlockContent className={mounted ? "animate" : ""}>
										<ChevronUp size={22} style={{ marginTop: 4 }} />
									</BlockContent>
								</Tooltip>
							)}
						</Box>
					</BlockHeader>
					<Collapse in={isExpanded} timeout="auto">
						<ExpandedContent className={isExpanded ? "animate" : ""}>
							{message?.code && <CodeBlock code={message.code} isUser={false} />}
							{message?.stdout && <OutputBlock output={message.stdout} isUser={false} />}
							{message?.stderr && <ErrorBlock error={message.stderr} isUser={false} />}
							{message?.logging && <LogBlock log={message.logging} isUser={false} />}
							<CollapseButton onClick={handleCollapse}>
								<FontAwesomeIcon icon={faChevronUp} size="sm" />
								<Typography variant="caption" sx={{ ml: 1 }}>
									Collapse
								</Typography>
							</CollapseButton>
						</ExpandedContent>
					</Collapse>
				</>
			)}

			{/* Attachments (images) */}
			{message?.files && message.files.length > 0 && (
				<Box sx={{ mb: 2, mt: 2 }}>
					{message.files
						.filter((file) => {
							const imageExtensions = [
								".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".tiff", ".tif", ".ico", ".heic", ".heif", ".avif", ".jfif", ".pjpeg", ".pjp",
							];
							const lowerPath = file.toLowerCase();
							return imageExtensions.some((ext) => lowerPath.endsWith(ext));
						})
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

			{/* Attachments (videos) */}
			{message?.files && message.files.length > 0 && (
				<Box sx={{ mb: 2 }}>
					{message.files
						.filter((file) => {
							const videoExtensions = [
								".mp4", ".webm", ".ogg", ".mov", ".avi", ".wmv", ".flv", ".mkv", ".m4v", ".3gp", ".3g2",
							];
							const lowerPath = file.toLowerCase();
							return videoExtensions.some((ext) => lowerPath.endsWith(ext));
						})
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

			{/* Attachments (non-media files) */}
			{message?.files && message.files.length > 0 && (
				<Box sx={{ mt: 2 }}>
					{message.files
						.filter((file) => {
							const imageExtensions = [
								".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".tiff", ".tif", ".ico", ".heic", ".heif", ".avif", ".jfif", ".pjpeg", ".pjp",
							];
							const videoExtensions = [
								".mp4", ".webm", ".ogg", ".mov", ".avi", ".wmv", ".flv", ".mkv", ".m4v", ".3gp", ".3g2",
							];
							const lowerPath = file.toLowerCase();
							return !imageExtensions.some((ext) => lowerPath.endsWith(ext)) &&
								!videoExtensions.some((ext) => lowerPath.endsWith(ext));
						})
						.map((file) => (
							<FileAttachment
								key={`${file}`}
								file={file}
								onClick={handleFileClick}
								conversationId={conversationId ?? ""}
							/>
						))}
				</Box>
			)}

			{errorDisplay}
			{/* Invisible element at the bottom for scroll targeting */}
			<div ref={scrollRef} style={{ height: 1, width: 1, opacity: 0 }} />
		</StreamingContainer>
	);
};

// Add display name for debugging
StreamingMessage.displayName = "StreamingMessage";
