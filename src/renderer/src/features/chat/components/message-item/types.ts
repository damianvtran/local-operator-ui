import type {
	ActionType,
	ExecutionType,
} from "@renderer/api/local-operator/types";
import type { Message } from "../../types";

/**
 * Props for the MessageItem component
 */
export type MessageItemProps = {
	message: Message;
	onMessageComplete?: () => void;
	isLastMessage?: boolean;
	conversationId: string;
};

/**
 * Props for styled components that need to know if the message is from the user
 */
export type StyledComponentProps = {
	isUser: boolean;
};

/**
 * Props for the CollapsibleSection component
 */
export type CollapsibleSectionProps = {
	title: string;
	children: React.ReactNode;
	defaultCollapsed?: boolean;
	isUser: boolean;
};

/**
 * Props for the BackgroundBlock component
 */
export type BackgroundBlockProps = {
	content: string;
	action?: ActionType;
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
 * Props for the ActionHighlight component
 */
export type ActionHighlightProps = {
	children: React.ReactNode;
	action: ActionType;
	taskClassification: string;
	isUser: boolean;
	executionType?: ExecutionType;
};

/**
 * Props for the SecurityCheckHighlight component
 */
export type SecurityCheckHighlightProps = {
	children: React.ReactNode;
	isUser: boolean;
};

/**
 * Props for the MessageAvatar component
 */
export type MessageAvatarProps = {
	isUser: boolean;
};

/**
 * Props for the MessageContainer component
 */
export type MessageContainerProps = {
	isUser: boolean;
	children: React.ReactNode;
};

/**
 * Props for the MessageContent component
 */
export type MessageContentProps = {
	content?: string;
	isUser: boolean;
};

/**
 * Props for the CodeBlock component
 */
export type CodeBlockProps = {
	code: string;
	isUser: boolean;
};

/**
 * Props for the OutputBlock component
 */
export type OutputBlockProps = {
	output: string;
	isUser: boolean;
};

/**
 * Props for the ErrorBlock component
 */
export type ErrorBlockProps = {
	error: string;
	isUser: boolean;
};

/**
 * Props for the LogBlock component
 */
export type LogBlockProps = {
	log: string;
	isUser: boolean;
};

/**
 * Props for the FileAttachment component
 */
export type FileAttachmentProps = {
	file: string;
	onClick: (file: string) => void;
};

/**
 * Props for the ImageAttachment component
 */
export type ImageAttachmentProps = {
	file: string;
	src: string;
	onClick: (file: string) => void;
};

/**
 * Props for the VideoAttachment component
 */
export type VideoAttachmentProps = {
	file: string;
	src: string;
	onClick: (file: string) => void;
};

/**
 * Props for the InvalidAttachment component
 */
export type InvalidAttachmentProps = {
	file: string;
};

/**
 * Props for the MessageTimestamp component
 */
export type MessageTimestampProps = {
	timestamp: Date;
	isUser: boolean;
};

/**
 * Props for the StatusIndicator component
 */
export type StatusIndicatorProps = {
	status: string;
};
