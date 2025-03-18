import type {
	ActionType,
	ExecutionType,
} from "@renderer/api/local-operator/types";
import type { Message as BaseMessage } from "../types";

/**
 * Extended Message type that includes action and execution_type fields
 * from the AgentExecutionRecord
 */
export type Message = BaseMessage & {
	action?: ActionType;
	execution_type?: ExecutionType;
};

/**
 * Props for the MessageItem component
 */
export type MessageItemProps = {
	message: Message;
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
 * Props for the PlanReflectionBlock component
 */
export type PlanReflectionBlockProps = {
	content: string;
	executionType: ExecutionType;
	isUser: boolean;
};

/**
 * Props for the ActionHighlight component
 */
export type ActionHighlightProps = {
	children: React.ReactNode;
	action: ActionType;
	isUser: boolean;
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
