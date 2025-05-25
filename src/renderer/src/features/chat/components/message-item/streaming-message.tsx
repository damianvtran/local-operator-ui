import { Box, CircularProgress, Typography, styled, alpha, Collapse, Tooltip } from "@mui/material";
import type { AgentExecutionRecord, ExecutionType } from "@shared/api/local-operator";
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
import {
	Check,
	BookOpen,
	Code2,
	Pencil,
	PencilLine,
	Lightbulb,
	Share2,
	HelpCircle,
	ChevronDown,
	ChevronUp,
  MessageSquare,
} from "lucide-react";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { MarkdownRenderer } from "../markdown-renderer";

// --- Styled components (adapted to match @action-block.tsx) ---

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

const BlockHeader = styled(Box, {
	shouldForwardProp: (prop) =>
		prop !== "executionType" && prop !== "isUser" && prop !== "isExpanded",
})<{ executionType: ExecutionType; isUser: boolean; isExpanded: boolean }>(
	({ theme, isExpanded }) => ({
		cursor: "pointer",
		"&:hover": {
			opacity: 0.9,
		},
		display: "flex",
		alignItems: "center",
		padding: "4px 12px 4px 8px",
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
	marginRight: 6,
	width: 28,
	height: 28,
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
}));

const BlockTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
}));

const BlockContent = styled(Box)(({ theme }) => ({
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
	overflow: "hidden",
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
		theme.palette.mode === "dark" ? 0.10 : 0.03
	),
	transition: `all 0.2s ${theme.transitions.easing.easeInOut}`,
	"&:hover": {
		backgroundColor: alpha(
			theme.palette.common.black,
			theme.palette.mode === "dark" ? 0.15 : 0.07
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
}: StreamingMessageProps) => {
	const { getStreamingMessage, isMessageStreamingComplete } =
		useStreamingMessagesStore();

	const storeMessage = getStreamingMessage(messageId);
	const isStoreMessageComplete = isMessageStreamingComplete(messageId);

	const handleComplete = useCallback(
		(completedMessage: AgentExecutionRecord) => {
			if (onComplete) {
				onComplete(completedMessage);
			}
		},
		[onComplete],
	);

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
		if (isActivelyStreaming && wsMessage) {
			lastValidMessageRef.current = wsMessage;
			return wsMessage;
		}
		const result =
			storeMessage?.content || wsMessage || lastValidMessageRef.current;
		if (result) {
			lastValidMessageRef.current = result;
		}
		return result;
	}, [isActivelyStreaming, wsMessage, storeMessage]);

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
		return <MarkdownRenderer content={message.message} />;
	}, [message?.message]);

	const streamingLoader = useMemo(() => {
		if (status === "connected" && !message?.message) {
			return (
        <Box sx={{ width: "100%", display: "flex", justifyContent: "flex-start" }}>
          <Box 
            sx={{ 
              mt: 1, 
              mb: 1, 
              display: "flex", 
              justifyContent: "center", 
              alignItems: "center",
              height: 30,
              width: 30,
              position: "relative",
              "@keyframes outerPulse": {
                "0%": { 
                  transform: "scale(1)",
                  opacity: 0.8,
                },
                "50%": { 
                  transform: "scale(1.1)",
                  opacity: 0.4,
                },
                "100%": { 
                  transform: "scale(1)",
                  opacity: 0.8,
                },
              },
              "@keyframes innerRotate": {
                "0%": { transform: "rotate(0deg)" },
                "100%": { transform: "rotate(360deg)" },
              },
              "@keyframes middleRotate": {
                "0%": { transform: "rotate(0deg)" },
                "100%": { transform: "rotate(-360deg)" },
              },
              "@keyframes glow": {
                "0%": { 
                  boxShadow: (theme) => `0 0 5px ${theme.palette.primary.main}40`,
                },
                "50%": { 
                  boxShadow: (theme) => `0 0 20px ${theme.palette.primary.main}80, 0 0 30px ${theme.palette.primary.main}40`,
                },
                "100%": { 
                  boxShadow: (theme) => `0 0 5px ${theme.palette.primary.main}40`,
                },
              },
            }}
          >
            {/* Outer pulsing ring */}
            <Box
              sx={{
                position: "absolute",
                width: 30,
                height: 30,
                borderRadius: "50%",
                border: (theme) => `2px solid ${theme.palette.primary.main}60`,
                animation: "outerPulse 2s ease-in-out infinite",
              }}
            />
            
            {/* Middle rotating ring */}
            <Box
              sx={{
                position: "absolute",
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: () => "2px solid transparent",
                borderTop: (theme) => `2px solid ${theme.palette.primary.main}`,
                borderRight: (theme) => `2px solid ${theme.palette.primary.main}80`,
                animation: "middleRotate 1.5s linear infinite",
              }}
            />
            
            {/* Inner fast rotating ring */}
            <Box
              sx={{
                position: "absolute",
                width: 15,
                height: 15,
                borderRadius: "50%",
                border: () => "2px solid transparent",
                borderTop: (theme) => `2px solid ${theme.palette.primary.main}`,
                borderLeft: (theme) => `2px solid ${theme.palette.primary.main}60`,
                animation: "innerRotate 1s linear infinite",
              }}
            />
            
            {/* Central glowing core */}
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: (theme) => theme.palette.primary.main,
                animation: "glow 2s ease-in-out infinite",
              }}
            />
          </Box>
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

	const [isExpanded, setIsExpanded] = useState(false);

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
				return <Check size={16} />;
			case "ASK":
				return <HelpCircle size={16} />;
			case "CODE":
				return <Code2 size={16} />;
			case "WRITE":
				return <Pencil size={14} />;
			case "EDIT":
				return <PencilLine size={16} />;
			case "READ":
				return <BookOpen size={16} />;
			case "DELEGATE":
				return <Share2 size={16} />;
			default:
				return message?.execution_type === "plan"
					? <Lightbulb size={16} />
					: message?.execution_type === "action"
						? <Code2 size={16} />
						: <MessageSquare size={16} />;
		}
	};

	const hasCollapsibleContent =
		message?.execution_type === "action" &&
		(message?.code || message?.stdout || message?.stderr || message?.logging || message?.content || message?.replacements);

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
			{streamingLoader}

			{/* Collapsible technical details block */}
			{hasCollapsibleContent && (
				<>
					<BlockHeader
						executionType={message?.execution_type || "action"}
						isUser={false}
						isExpanded={isExpanded}
						onClick={isExpanded ? handleCollapse : handleExpand}
					>
						<BlockIcon>
							{getIcon()}
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
							<BlockTitle>
								{getTitle()}
							</BlockTitle>
							{!isExpanded ? (
								<Tooltip title="View Details">
									<BlockContent>
										<ChevronDown size={22} style={{ marginTop: 4 }} />
									</BlockContent>
								</Tooltip>
							) : (
								<Tooltip title="Collapse Details">
									<BlockContent>
										<ChevronUp size={22} style={{ marginTop: 4 }} />
									</BlockContent>
								</Tooltip>
							)}
						</Box>
					</BlockHeader>
					<Collapse in={isExpanded} timeout="auto">
						<ExpandedContent>
							{message?.code && <CodeBlock code={message.code} isUser={false} />}
							{message?.content && <CodeBlock code={message.content} isUser={false} />}
							{message?.replacements && <CodeBlock code={message.replacements} isUser={false} language="diff" />}
							{message?.stdout && <OutputBlock output={message.stdout} isUser={false} />}
							{message?.stderr && <ErrorBlock error={message.stderr} isUser={false} />}
							{message?.logging && <LogBlock log={message.logging} isUser={false} />}
							<CollapseButton onClick={handleCollapse}>
								<ChevronUp size={18} />
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
			<div ref={scrollRef} style={{ height: 1, width: 1, opacity: 0 }} />
		</StreamingContainer>
	);
};

StreamingMessage.displayName = "StreamingMessage";
