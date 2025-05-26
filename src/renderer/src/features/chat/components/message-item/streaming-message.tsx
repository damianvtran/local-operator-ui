import { Box, CircularProgress, Typography, styled } from "@mui/material";
import type { AgentExecutionRecord } from "@shared/api/local-operator";
import { useStreamingMessage } from "@shared/hooks/use-streaming-message";
import { useStreamingMessagesStore } from "@shared/store/streaming-messages-store";
import { getLanguageFromExtension } from "@shared/utils/file-utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExpandableActionElement } from "../expandable-action-element";
import { MarkdownRenderer } from "../markdown-renderer";
import { CodeBlock } from "./code-block";
import { ErrorBlock } from "./error-block";
import { LogBlock } from "./log-block";
import { OutputBlock } from "./output-block";

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
				<MarkdownRenderer content={message.message} />
			</Box>
		);
	}, [message?.message]);

	const streamingLoader = useMemo(() => {
		if (status === "connected" && !message?.message) {
			return (
				<Box
					sx={{ width: "100%", display: "flex", justifyContent: "flex-start" }}
				>
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
									boxShadow: (theme) =>
										`0 0 5px ${theme.palette.primary.main}40`,
								},
								"50%": {
									boxShadow: (theme) =>
										`0 0 20px ${theme.palette.primary.main}80, 0 0 30px ${theme.palette.primary.main}40`,
								},
								"100%": {
									boxShadow: (theme) =>
										`0 0 5px ${theme.palette.primary.main}40`,
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
								borderRight: (theme) =>
									`2px solid ${theme.palette.primary.main}80`,
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
								borderLeft: (theme) =>
									`2px solid ${theme.palette.primary.main}60`,
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

	const [isExpanded, setIsExpanded] = useState(false);

	const handleExpand = () => setIsExpanded(true);
	const handleCollapse = (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsExpanded(false);
	};

	const hasCollapsibleContent = Boolean(
		message?.execution_type === "action" && message?.action,
	);

	const fileLanguage = getLanguageFromExtension(message?.file_path || "");

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

			{/* Use the shared expandable action element */}
			<ExpandableActionElement
				executionType={message?.execution_type || "action"}
				action={message?.action}
				isUser={false}
				isExpanded={isExpanded}
				onExpand={handleExpand}
				onCollapse={handleCollapse}
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
				{message?.logging && <LogBlock log={message.logging} isUser={false} />}
			</ExpandableActionElement>

			{errorDisplay}
			<div ref={scrollRef} style={{ height: 1, width: 1, opacity: 0 }} />
		</StreamingContainer>
	);
};

StreamingMessage.displayName = "StreamingMessage";
