import { AgentReasoning, TraceLine } from "@features/chat/components/trace";
import type {
	AgentExecutionRecord,
	LocalOperatorClient,
} from "@shared/api/local-operator";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import { Spinner } from "@shared/components/common/spinner";
import { apiConfig } from "@shared/config";
import { useStreamingMessage } from "@shared/hooks/use-streaming-message";
import { cn } from "@shared/lib/utils";
import { useStreamingMessagesStore } from "@shared/store/streaming-messages-store";
import { getLanguageFromExtension } from "@shared/utils/file-utils";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useCallback, useMemo, useRef } from "react";
import { MarkdownRenderer, StreamingMarkdown } from "../markdown-renderer";
import { AudioAttachment } from "./audio-attachment";
import { CodeBlock } from "./code-block";
import { ErrorBlock } from "./error-block";
import { FileAttachment } from "./file-attachment";
import { ImageAttachment } from "./image-attachment";
import { LogBlock } from "./log-block";
import { OutputBlock } from "./output-block";
import { VideoAttachment } from "./video-attachment";

// Module-level helpers for attachment handling to keep hook deps clean and stable
const isWebUrl = (path: string): boolean =>
	path.startsWith("http://") || path.startsWith("https://");

const IMAGE_EXTENSIONS = [
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

const VIDEO_EXTENSIONS = [
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

const AUDIO_EXTENSIONS = [
	".mp3",
	".wav",
	".ogg",
	".aac",
	".flac",
	".m4a",
	".aiff",
];

const hasExtension = (path: string, extensions: string[]): boolean => {
	const lowerPath = path.toLowerCase();
	return extensions.some((ext) => lowerPath.endsWith(ext));
};

const getAttachmentUrl = (
	client: LocalOperatorClient,
	path: string,
): string => {
	if (path.startsWith("http")) return path;
	const normalizedPath = path.startsWith("file://") ? path : `file://${path}`;
	if (hasExtension(path, IMAGE_EXTENSIONS))
		return client.static.getImageUrl(normalizedPath);
	if (hasExtension(path, VIDEO_EXTENSIONS))
		return client.static.getVideoUrl(normalizedPath);
	if (hasExtension(path, AUDIO_EXTENSIONS))
		return client.static.getAudioUrl(normalizedPath);
	return path;
};

/**
 * Props for the StreamingMessage component
 */
type StreamingMessageProps = {
	messageId: string;
	autoConnect?: boolean;
	onComplete?: (message: AgentExecutionRecord) => void;
	onUpdate?: (message: AgentExecutionRecord) => void;
	children?: React.ReactNode;
	className?: string;
	conversationId?: string;
	refetchOnComplete?: boolean;
	styleProps?: Record<string, unknown>;
};

/**
 * Renders a message as it streams in.
 *
 * The old shape of this component was two modes: while streaming, a one-line
 * ellipsised pill, and on completion, the whole message at once. The pill was
 * the fix for a real problem — the websocket sends the entire accumulated
 * record on every frame, and mounting a markdown renderer per frame is O(n^2)
 * over a message — but the fix was to not render the text at all.
 *
 * `StreamingMarkdown` solves the same problem honestly: closed blocks are
 * parsed once and memoised, and the block still being written renders as plain
 * text, so text is visible as it arrives at a cost bounded by what arrived,
 * not by the length of the message. The mode switch is gone, and with it the
 * preview pill, the expand-in-place affordance, and the per-chunk
 * `scrollIntoView` that used to fight the column-reverse overflow anchor —
 * the container sticks to the bottom on its own, and a reader scrolled up is
 * left alone.
 *
 * `compactInProgress` from the call site is deliberately ignored: collapsing
 * was what hid the text. The heavy detail — code, stdout, logs — stays behind
 * a disclosure per the trace hierarchy, which is all the compact mode was
 * ever meant to keep out of the way.
 */
export const StreamingMessage = ({
	messageId,
	autoConnect = true,
	onComplete,
	onUpdate,
	children,
	className,
	conversationId,
	refetchOnComplete = true,
	styleProps,
}: StreamingMessageProps) => {
	const storeMessage = useStreamingMessagesStore(
		(state) => state.streamingMessages[messageId] ?? null,
	);
	const isStoreMessageComplete = storeMessage?.isComplete ?? false;

	const {
		message: wsMessage,
		status,
		isLoading,
		isRefetching,
		error,
	} = useStreamingMessage({
		messageId,
		autoConnect,
		onComplete,
		onUpdate,
		conversationId,
		refetchOnComplete,
	});

	const isActivelyStreaming = useMemo(
		() => status === "connected" && !isStoreMessageComplete,
		[status, isStoreMessageComplete],
	);

	const lastValidMessageRef = useRef<AgentExecutionRecord | null>(null);

	const message = useMemo(() => {
		if (wsMessage) {
			lastValidMessageRef.current = wsMessage;
			return wsMessage;
		}

		if (storeMessage?.content) {
			lastValidMessageRef.current = storeMessage.content;
			return storeMessage.content;
		}

		return lastValidMessageRef.current || null;
	}, [wsMessage, storeMessage]);

	const fileLanguage = getLanguageFromExtension(message?.file_path || "");

	const hasToolDetail = Boolean(
		message?.code ||
			message?.content ||
			message?.replacements ||
			message?.stdout ||
			message?.stderr ||
			message?.logging,
	);

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
			// Not `alert()`: a blocking OS modal for a file that moved is heavier
			// than the failure. See `error-view` for where each kind of failure
			// belongs.
			showErrorToast(
				`Could not open ${filePath.split("/").pop()}. The file may have been moved, renamed, or deleted.`,
			);
		}
	}, []);

	const files = message?.files ?? [];
	const imageFiles = useMemo(
		() => files.filter((file) => hasExtension(file, IMAGE_EXTENSIONS)),
		[files],
	);
	const videoFiles = useMemo(
		() => files.filter((file) => hasExtension(file, VIDEO_EXTENSIONS)),
		[files],
	);
	const audioFiles = useMemo(
		() => files.filter((file) => hasExtension(file, AUDIO_EXTENSIONS)),
		[files],
	);
	const otherFiles = useMemo(
		() =>
			files.filter(
				(file) =>
					!hasExtension(file, IMAGE_EXTENSIONS) &&
					!hasExtension(file, VIDEO_EXTENSIONS) &&
					!hasExtension(file, AUDIO_EXTENSIONS),
			),
		[files],
	);

	return (
		<div className={cn("relative break-words", className)}>
			{children}

			{isRefetching && (
				<p className="mt-1 flex items-center gap-2 text-meta text-ink-muted">
					<Spinner size="sm" />
					Refreshing message data...
				</p>
			)}

			{message?.thinking && (
				<AgentReasoning label="Reasoning" content={message.thinking} />
			)}

			{message?.message &&
				(isStoreMessageComplete ? (
					// The completed message renders in one piece. The streaming split
					// is an approximation for live text — paragraph order around blank
					// runs and link reference definitions are only guaranteed by a
					// whole-document parse, and at completion there is exactly one.
					<MarkdownRenderer content={message.message} styleProps={styleProps} />
				) : (
					<StreamingMarkdown
						content={message.message}
						styleProps={styleProps}
					/>
				))}

			{status === "connected" && !message?.message && (
				<div className="flex justify-start">
					<Spinner size="lg" label="Waiting for the agent" />
				</div>
			)}

			{/* The in-flight step is the same object as a completed one, so it is
			 * the same component: `TraceLine`, running, with the payload behind
			 * its own disclosure. It used to be a second expander with a round
			 * icon tile, its own duplicate label table, and a spinner beside the
			 * label — two of the three things § 7 names outright ("prefer one
			 * disclosure idiom app-wide", "never show a spinner and a trace line
			 * for the same action"). The line's running verb carries the state. */}
			{hasToolDetail && (
				<TraceLine
					className="mt-2"
					action={message?.action}
					filePath={message?.file_path}
					files={message?.files}
					running={isActivelyStreaming}
					failed={Boolean(message?.stderr)}
					details={
						<>
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
						</>
					}
				/>
			)}

			{imageFiles.length > 0 && (
				<div className="my-4">
					{imageFiles.map((file) => (
						<ImageAttachment
							key={`${messageId}-${file}`}
							file={file}
							src={getUrl(file)}
							onClick={handleFileClick}
							conversationId={conversationId ?? ""}
						/>
					))}
				</div>
			)}

			{videoFiles.length > 0 && (
				<div className="mb-4">
					{videoFiles.map((file) => (
						<VideoAttachment
							key={`${messageId}-${file}`}
							file={file}
							src={getUrl(file)}
							onClick={handleFileClick}
							conversationId={conversationId ?? ""}
						/>
					))}
				</div>
			)}

			{audioFiles.length > 0 && (
				<div className="mb-4">
					{audioFiles.map((file) => (
						<AudioAttachment
							key={`${messageId}-${file}`}
							content={getUrl(file)}
							isUser={false}
						/>
					))}
				</div>
			)}

			{otherFiles.length > 0 && (
				<div className="mt-4">
					{otherFiles.map((file) => (
						<FileAttachment
							key={`${messageId}-${file}`}
							file={file}
							onClick={handleFileClick}
							conversationId={conversationId ?? ""}
						/>
					))}
				</div>
			)}

			{error && (
				<div className="mt-2 rounded-sm bg-danger-wash border border-danger-border p-3 text-body-sm text-ink">
					<p className="font-medium">Connection error</p>
					<p>{error.message}</p>
				</div>
			)}

			{isLoading && !isActivelyStreaming && (
				<p className="mt-2 flex items-center gap-2 text-body-sm text-ink-muted">
					<Spinner size="sm" />
					Loading message data...
				</p>
			)}
		</div>
	);
};

StreamingMessage.displayName = "StreamingMessage";
