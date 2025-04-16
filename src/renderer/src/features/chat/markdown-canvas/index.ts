/**
 * Markdown Canvas Feature
 *
 * This module exports components and utilities for the Markdown Canvas feature,
 * which allows users to view and manage markdown documents within the chat interface.
 */

// Export main components
export { MarkdownCanvas } from "./markdown-canvas";
export { MarkdownCanvasTabs } from "./markdown-canvas-tabs";
export { MarkdownCanvasToolbar } from "./markdown-canvas-toolbar";
export { MarkdownCanvasFileBrowser } from "./markdown-canvas-file-browser";

// Export types
export type { MarkdownDocument, ExportFormat } from "./types";

// Export message item with markdown canvas support
export { MessageItemWithMarkdownCanvas } from "../message-item/index-with-markdown-canvas";
export { MessagesViewWithMarkdownCanvas } from "../messages-view-with-markdown-canvas";
export { ChatContentWithMarkdownCanvas } from "../chat-content-with-markdown-canvas";

// Export markdown file attachment
export {
	MarkdownFileAttachment,
	isMarkdownFile,
} from "../message-item/markdown-file-attachment";
