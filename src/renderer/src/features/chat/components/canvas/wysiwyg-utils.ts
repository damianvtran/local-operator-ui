import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { rehypeSourceMap } from "rehype-source-map";
import rehypeStringify from "rehype-stringify";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkStringify from "remark-stringify";

/**
 * Utility functions for converting between HTML and Markdown in the WYSIWYG editor
 */

const SCRIPT_TAG_REGEX = /<script[^>]*>.*?<\/script>/gis;
const STYLE_TAG_REGEX = /<style[^>]*>.*?<\/style>/gis;
const EVENT_HANDLER_REGEX = /on\w+="[^"]*"/gi;

/**
 * Convert markdown to HTML for display in the contentEditable div
 * This uses the unified ecosystem to provide a robust conversion with source maps
 */
export const markdownToHtml = (markdown: string): string => {
	const file = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkRehype)
		.use(rehypeSourceMap)
		.use(rehypeStringify)
		.processSync(markdown);

	return String(file);
};

/**
 * Convert HTML from contentEditable div back to markdown
 * This handles the conversion from rich text back to markdown syntax
 */
export const htmlToMarkdown = (html: string): string => {
	const file = unified()
		.use(rehypeParse)
		.use(rehypeRemark)
		.use(remarkGfm)
		.use(remarkStringify)
		.processSync(html);

	return String(file).trim();
};

/**
 * Clean HTML content to ensure it's safe and properly formatted
 */
export const cleanHtml = (inputHtml: string): string => {
	// Remove script tags and other potentially dangerous elements
	let cleanedHtml = inputHtml.replace(SCRIPT_TAG_REGEX, '');
	cleanedHtml = cleanedHtml.replace(STYLE_TAG_REGEX, '');
	cleanedHtml = cleanedHtml.replace(EVENT_HANDLER_REGEX, ''); // Remove event handlers
	
	return cleanedHtml;
};

/**
 * Get the current selection range in the editor
 */
export const getCurrentRange = (): Range | null => {
	const selection = window.getSelection();
	if (selection && selection.rangeCount > 0) {
		return selection.getRangeAt(0);
	}
	return null;
};

/**
 * Insert HTML at the current cursor position
 */
export const insertHtmlAtCursor = (html: string): void => {
	const range = getCurrentRange();
	if (range) {
		range.deleteContents();
		const fragment = range.createContextualFragment(html);
		range.insertNode(fragment);
		
		// Move cursor to end of inserted content
		range.collapse(false);
		const selection = window.getSelection();
		if (selection) {
			selection.removeAllRanges();
			selection.addRange(range);
		}
	}
};

/**
 * Check if the current selection is within a specific element type
 */
export const isSelectionInElement = (tagName: string): boolean => {
	const selection = window.getSelection();
	if (!selection?.rangeCount) return false;

	const range = selection.getRangeAt(0);
	let element: Node | null = range.startContainer;
	
	if (element.nodeType === Node.TEXT_NODE) {
		element = element.parentElement;
	}

	while (element) {
		if ((element as Element).tagName?.toLowerCase() === tagName.toLowerCase()) {
			return true;
		}
		element = element.parentElement;
	}

	return false;
};
