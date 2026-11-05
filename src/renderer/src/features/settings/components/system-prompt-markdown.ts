import {
	htmlToMarkdown,
	markdownToHtml,
} from "@features/chat/components/canvas/wysiwyg-utils";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm);

/** Compare meaning, not delimiter choice or loose-list whitespace. Unknown HTML
 * must never enter contenteditable: the shared serializer drops those nodes,
 * and rendering instruction-shaped tags as HTML can hide their contents. */
const signature = (markdown: string): string =>
	JSON.stringify(parser.parse(markdown), (key, value) => {
		if (key === "position" || key === "spread") return undefined;
		return value;
	});

export const canRichEditPrompt = (markdown: string): boolean => {
	try {
		const tree = parser.parse(markdown);
		if (JSON.stringify(tree).includes('"type":"html"')) return false;
		return (
			signature(markdown) ===
			signature(htmlToMarkdown(markdownToHtml(markdown)))
		);
	} catch {
		// A conversion failure is a source-editing opportunity, never permission
		// to replace instructions with a partial rendering.
		return false;
	}
};
