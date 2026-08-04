/**
 * Renders one conversation message according to the § 7 trace hierarchy
 * (docs/branding.md). One record is one Message; its kind decides the whole
 * presentation:
 *
 *  1. question   — `action === "ASK"`: the accent-washed AgentQuestion
 *     affordance. The only thing on screen that needs a decision.
 *  2. answer     — prose addressed to the user at full reading weight.
 *  3. trace      — `execution_type === "action"`: one quiet monospace line
 *     per action; the how-it-did-it (code, stdout, logs, diffs) sits behind
 *     the line itself, closed by default. No avatar, no card.
 *  4. security   — `execution_type === "security_check"`: retrospective
 *     warning notice, never a prompt.
 *  5. reasoning  — `plan` / `reflection` turns: hidden unless the
 *     `showAgentReasoning` preference is on (default off).
 *
 * The suppressed record keeps its old suppression: `ASK`/`DONE` with
 * `execution_type === "action"` and `task_classification === "conversation"`
 * render nothing — they duplicate the paired response record. In particular
 * the question never double-renders: the ASK the user sees arrives as the
 * `response`-typed record.
 */

import {
	type AgentExecutionRecord,
	type LocalOperatorClient,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { showErrorToast } from "@shared/utils/toast-manager";
import { type FC, memo, useCallback, useEffect } from "react";
import type { CanvasDocument } from "../../types/canvas";
import type { Message } from "../../types/message";
import { getFileTypeFromPath } from "../../utils/file-types";
import { getFileName } from "../../utils/get-file-name";
import { isMessageHidden } from "../../utils/message-grouping";
import {
	AgentQuestion,
	AgentReasoning,
	Disclosure,
	SecurityNotice,
	TraceLine,
} from "../trace";
import { AudioAttachment } from "./audio-attachment";
import { CodeBlock } from "./code-block";
import { ErrorBlock } from "./error-block";
import { FileAttachment } from "./file-attachment";
import { ImageAttachment } from "./image-attachment";
import { LogBlock } from "./log-block";
import { MessageContainer } from "./message-container";
import { MessageContent } from "./message-content";
import { MessageControls } from "./message-controls";
import { MessagePaper } from "./message-paper";
import { MessageTimestamp } from "./message-timestamp";
import { OutputBlock } from "./output-block";
import { VideoAttachment } from "./video-attachment";

const localOperatorClient = createLocalOperatorClient(apiConfig.baseUrl);

/**
 * Props for the MessageItem component
 */
export type MessageItemProps = {
	message: Message;
	conversationId: string;
	currentExecution?: AgentExecutionRecord | null;
	onMessageComplete?: () => void;
	isLastMessage: boolean;
	isSmallView?: boolean;
	/**
	 * The row opens an agent turn and carries the avatar. Computed by the
	 * grouping pass in `messages-view` so a hidden record never takes it.
	 */
	isTurnStart?: boolean;
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
 * @param path - The file path to check
 * @returns True if the file is an image, false otherwise
 */
const isImage = (path: string): boolean => {
	const imageExtensions = [
		".jpg",
		".jpeg",
		".png",
		".gif",
		".bmp",
		".webp",
		".svg",
	];
	const lowerPath = path.toLowerCase();
	return imageExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Checks if a file is a video based on its extension
 * @param path - The file path to check
 * @returns True if the file is a video, false otherwise
 */
const isVideo = (path: string): boolean => {
	const videoExtensions = [".mp4", ".webm", ".ogg", ".mov", ".avi", ".mkv"];
	const lowerPath = path.toLowerCase();
	return videoExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Checks if a file is an audio file based on its extension
 * @param path - The file path to check
 * @returns True if the file is an audio, false otherwise
 */
const isAudio = (path: string): boolean => {
	const audioExtensions = [
		".mp3",
		".wav",
		".ogg",
		".m4a",
		".flac",
		".aac",
		".wma",
	];
	const lowerPath = path.toLowerCase();
	return audioExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Gets the appropriate URL for an attachment
 * @param client - The Local Operator client
 * @param path - The file path or URL
 * @returns The URL to access the attachment
 */
const getAttachmentUrl = (
	client: LocalOperatorClient,
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

/**
 * One message. See the module comment for the kind → presentation table.
 */
export const MessageItem: FC<MessageItemProps> = memo(
	({
		message,
		onMessageComplete,
		isLastMessage,
		conversationId,
		currentExecution,
		isSmallView,
		isTurnStart = false,
	}) => {
		const addMentionedFilesBatch = useCanvasStore(
			(s) => s.addMentionedFilesBatch,
		);
		const showAgentReasoning = useUiPreferencesStore(
			(state) => state.showAgentReasoning,
		);

		useEffect(() => {
			if (message.files && message.files.length > 0 && conversationId) {
				const canvasDocuments = message.files
					.map((fileString): CanvasDocument | null => {
						if (fileString.startsWith("data:")) {
							return null;
						}

						const title = getFileName(fileString);
						const fileType = getFileTypeFromPath(fileString);
						const normalizedPath = fileString.startsWith("file://")
							? fileString.substring(7)
							: fileString;
						const id = normalizedPath;

						return {
							id,
							title,
							path: normalizedPath,
							content: normalizedPath, // Placeholder
							type: fileType,
						};
					})
					.filter(Boolean) as CanvasDocument[];

				if (canvasDocuments.length > 0) {
					addMentionedFilesBatch(conversationId, canvasDocuments);
				}
			}
		}, [message.files, conversationId, addMentionedFilesBatch]);

		// Get the URL for an attachment
		const getUrl = useCallback(
			(path: string) => getAttachmentUrl(localOperatorClient, path),
			[],
		);

		/**
		 * Handles clicking on a file attachment: web URLs open in the default
		 * browser, local files in their default application.
		 * @param filePath - The path or URL of the file to open
		 */
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
				// A native `alert()` is a modal the user has to dismiss before they
				// can do anything else, for a failure they did not cause and cannot
				// act on from the dialog. A user-initiated action that fails is
				// exactly what a toast is for; see `error-view` for the other half
				// of the policy.
				showErrorToast(
					`Could not open ${getFileName(filePath)}. The file may have been moved, renamed, or deleted.`,
				);
			}
		}, []);

		const isUser = message.role === "user";
		const executionType = message.execution_type;
		const isQuestion = message.action === "ASK";
		const isTrace = executionType === "action";
		const isSecurity = executionType === "security_check";
		const isReasoning =
			executionType === "plan" || executionType === "reflection";

		// The suppression rules live with the grouping pass, because the two
		// have to agree exactly: a record that renders nothing here must not
		// consume the turn's avatar or leave its gap behind in the list.
		if (isMessageHidden(message, showAgentReasoning)) {
			return null;
		}

		const running = isLastMessage && !!currentExecution;
		const files = message.files ?? [];
		const imageFiles = files.filter((file) => isImage(file));
		const videoFiles = files.filter((file) => isVideo(file));
		const audioFiles = files.filter((file) => isAudio(file));
		const otherFiles = files.filter(
			(file) => !isImage(file) && !isVideo(file) && !isAudio(file),
		);

		const renderMedia = (
			<>
				{imageFiles.length > 0 && (
					<div className="mb-2 flex flex-col gap-2">
						{imageFiles.map((file) => (
							<ImageAttachment
								key={`${message.id}-${file}`}
								file={file}
								src={getUrl(file)}
								onClick={handleFileClick}
								conversationId={conversationId}
							/>
						))}
					</div>
				)}
				{videoFiles.length > 0 && (
					<div className="mb-2 flex flex-col gap-2">
						{videoFiles.map((file) => (
							<VideoAttachment
								key={`${message.id}-${file}`}
								file={file}
								src={getUrl(file)}
								onClick={handleFileClick}
								conversationId={conversationId}
							/>
						))}
					</div>
				)}
				{audioFiles.length > 0 && (
					<div className="mb-2 flex flex-col gap-2">
						{audioFiles.map((file) => (
							<AudioAttachment
								key={`${message.id}-${file}`}
								content={getUrl(file)}
								isUser={isUser}
							/>
						))}
					</div>
				)}
				{otherFiles.length > 0 && (
					<div className="flex flex-col gap-2">
						{otherFiles.map((file) => (
							<FileAttachment
								key={`${message.id}-${file}`}
								file={file}
								onClick={handleFileClick}
								conversationId={conversationId}
							/>
						))}
					</div>
				)}
			</>
		);

		// ---------------------------------------------------------------- 1.
		// The question for the user. Rendered inside MessagePaper so the reply
		// preview, thinking disclosure and selection controls keep the same
		// wiring as any other assistant message.
		if (isQuestion) {
			return (
				<MessageContainer
					isUser={false}
					isSmallView={isSmallView}
					showAvatar={isTurnStart}
				>
					<MessagePaper
						isUser={false}
						content={message.message}
						message={message}
						onMessageComplete={onMessageComplete}
						isLastMessage={isLastMessage ?? false}
						isJobRunning={!!currentExecution}
						agentId={conversationId}
						isSmallView={isSmallView}
					>
						<AgentQuestion content={message.message} />
						{renderMedia}
					</MessagePaper>
				</MessageContainer>
			);
		}

		// ---------------------------------------------------------- 3 (5).
		// A completed action is one line. Adjacent trace rows are pulled to the
		// 4px tier by the grouping pass in `messages-view`, so a run of actions
		// reads as one quiet block rather than as spaced entries.
		if (isTrace) {
			const stdout = currentExecution?.stdout ?? message.stdout;
			const stderr = currentExecution?.stderr ?? message.stderr;
			const logging = currentExecution?.logging ?? message.logging;
			const narration = message.message
				? message.message.replace(/(```\w+\s*)+$/g, "").trim()
				: undefined;

			const technicalDetail = (
				<>
					{narration && (
						<p className="text-body-sm text-ink-muted">{narration}</p>
					)}
					{message.code && <CodeBlock code={message.code} isUser={isUser} />}
					{message.content && (
						<CodeBlock
							code={message.content}
							isUser={isUser}
							header="Content"
						/>
					)}
					{message.replacements && (
						<CodeBlock
							code={message.replacements}
							isUser={isUser}
							header="Replacements"
						/>
					)}
					{stdout && <OutputBlock output={stdout} isUser={isUser} />}
					{stderr && <ErrorBlock error={stderr} isUser={isUser} />}
					{logging && <LogBlock log={logging} isUser={isUser} />}
					{message.id && message.timestamp && (
						<div className="flex items-center justify-between gap-2 pt-1">
							<MessageControls
								inline
								isUser={isUser}
								content={narration}
								messageId={message.id}
								agentId={conversationId}
							/>
							<MessageTimestamp timestamp={message.timestamp} />
						</div>
					)}
				</>
			);
			const hasDetail = Boolean(
				message.code ||
					message.content ||
					message.replacements ||
					stdout ||
					stderr ||
					logging ||
					(message.id && message.timestamp),
			);

			return (
				<MessageContainer
					isUser={false}
					isSmallView={isSmallView}
					showAvatar={isTurnStart}
				>
					<TraceLine
						action={message.action}
						filePath={message.file_path}
						files={message.files}
						narration={narration}
						running={running}
						failed={Boolean(stderr)}
						details={hasDetail ? technicalDetail : undefined}
					/>
					{renderMedia}
				</MessageContainer>
			);
		}

		// --------------------------------------------------------------- 5.
		// Internal reasoning, shown only behind the preference and then only
		// behind the quiet disclosure. A turn whose entire content is
		// reasoning renders as a single quiet row.
		if (isReasoning) {
			const reasoningText = [message.message, message.thinking]
				.filter(Boolean)
				.join("\n\n");

			return (
				<MessageContainer
					isUser={false}
					isSmallView={isSmallView}
					showAvatar={isTurnStart}
				>
					<AgentReasoning content={reasoningText || undefined} />
					{files.length > 0 && <div className="mt-2">{renderMedia}</div>}
				</MessageContainer>
			);
		}

		// --------------------------------------------------------------- 4.
		// A security notice is retrospective: a warning notice, past tense,
		// no actions to take.
		if (isSecurity) {
			const details =
				message.code || message.stdout || message.stderr || message.logging ? (
					<>
						{message.code && <CodeBlock code={message.code} isUser={isUser} />}
						{message.stdout && (
							<OutputBlock output={message.stdout} isUser={isUser} />
						)}
						{message.stderr && (
							<ErrorBlock error={message.stderr} isUser={isUser} />
						)}
						{message.logging && (
							<LogBlock log={message.logging} isUser={isUser} />
						)}
					</>
				) : undefined;

			return (
				<MessageContainer
					isUser={false}
					isSmallView={isSmallView}
					showAvatar={isTurnStart}
				>
					<SecurityNotice content={message.message} details={details} />
					{files.length > 0 && <div className="mt-2">{renderMedia}</div>}
				</MessageContainer>
			);
		}

		// --------------------------------------------------------------- 2.
		// The answer: prose at full reading weight, plus any attachments.
		// Technical payload on a non-trace assistant record still goes
		// behind the one disclosure idiom rather than rendering inline.
		const technicalBlocks = (
			<>
				{message.code && <CodeBlock code={message.code} isUser={isUser} />}
				{message.stdout && (
					<OutputBlock output={message.stdout} isUser={isUser} />
				)}
				{message.stderr && (
					<ErrorBlock error={message.stderr} isUser={isUser} />
				)}
				{message.logging && <LogBlock log={message.logging} isUser={isUser} />}
			</>
		);
		const hasTechnicalBlocks = Boolean(
			message.code || message.stdout || message.stderr || message.logging,
		);

		return (
			<MessageContainer
				isUser={isUser}
				isSmallView={isSmallView}
				showAvatar={isTurnStart}
			>
				<MessagePaper
					isUser={isUser}
					content={message.message}
					message={message}
					onMessageComplete={onMessageComplete}
					isLastMessage={isLastMessage ?? false}
					isJobRunning={!!currentExecution}
					agentId={conversationId}
					isSmallView={isSmallView}
				>
					{renderMedia}
					{/* Render message content only once it is not mid-stream; the
					 * streaming component shows the arriving text instead. */}
					{message.message &&
						!(message.is_streamable && !message.is_complete) && (
							<MessageContent content={message.message} isUser={isUser} />
						)}
					{!isUser && hasTechnicalBlocks && (
						<Disclosure
							summary={<span className="text-meta">Technical details</span>}
							triggerClassName="mt-2 min-h-6 py-0.5"
							contentClassName="ml-5 mt-1 flex flex-col gap-2 pb-1"
						>
							{technicalBlocks}
						</Disclosure>
					)}
					{isUser && technicalBlocks}
				</MessagePaper>
			</MessageContainer>
		);
	},
);
