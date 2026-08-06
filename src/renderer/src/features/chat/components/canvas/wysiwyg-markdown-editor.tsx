import {
	htmlToMarkdown,
	markdownToHtml,
} from "@features/chat/components/canvas/wysiwyg-utils";
import type { EditDiff } from "@shared/api/local-operator/types";
import { FindReplaceWidget } from "@shared/components/common/find-replace-widget";
import { TextSelectionControls } from "@shared/components/common/text-selection-controls";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { useDebounce } from "@shared/hooks/use-debounce";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import type { UndoManager } from "@shared/lib/undo-manager";
import { cn } from "@shared/lib/utils";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUndoManagerStore } from "@shared/store/undo-manager-store";
import { showSuccessToast } from "@shared/utils/toast-manager";
import {
	Bold,
	Code,
	Ellipsis,
	Image,
	Italic,
	Link,
	List,
	ListOrdered,
	Quote,
	Redo,
	SquareCheckBig,
	Strikethrough,
	Table,
	Undo,
} from "lucide-react";
import { type FC, memo } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { InlineEdit } from "./inline-edit";
import { InsertImageDialog } from "./wysiwyg/insert-image-dialog";
import type { LinkDialogData } from "./wysiwyg/insert-link-dialog";
import { InsertLinkDialog } from "./wysiwyg/insert-link-dialog";
import { InsertTablePopover } from "./wysiwyg/insert-table-popover";
import { TextStyleDropdown } from "./wysiwyg/text-style-dropdown";

/**
 * Calculates the cursor position within the markdown content by converting HTML position to markdown position
 */
const getCursorPosition = (
	editorElement: HTMLElement,
	range: Range,
): number => {
	// Create a range from the start of the editor to the cursor position
	const preCaretRange = document.createRange();
	preCaretRange.selectNodeContents(editorElement);
	preCaretRange.setEnd(range.startContainer, range.startOffset);

	// Get the HTML content up to the cursor position
	const htmlBeforeCursor = preCaretRange.cloneContents();
	const tempDiv = document.createElement("div");
	tempDiv.appendChild(htmlBeforeCursor);

	// Convert the HTML before cursor to markdown
	const markdownBeforeCursor = htmlToMarkdown(tempDiv.innerHTML);

	// Return the length of the markdown content before cursor
	return markdownBeforeCursor.length;
};

/**
 * Formats selection with context for the edit API
 */
const formatSelectionWithContext = (
	fullContent: string,
	selectedText: string,
	cursorPosition?: number,
	editorElement?: HTMLElement | null,
	range?: Range,
): string => {
	if (editorElement && range && !range.collapsed) {
		const beforeRange = document.createRange();
		beforeRange.selectNodeContents(editorElement);
		beforeRange.setEnd(range.startContainer, range.startOffset);

		const afterRange = document.createRange();
		afterRange.selectNodeContents(editorElement);
		afterRange.setStart(range.endContainer, range.endOffset);

		const tempDiv = document.createElement("div");

		tempDiv.appendChild(range.cloneContents());
		const selectedHtml = tempDiv.innerHTML;
		tempDiv.innerHTML = "";

		tempDiv.appendChild(beforeRange.cloneContents());
		const beforeHtml = tempDiv.innerHTML;
		tempDiv.innerHTML = "";

		tempDiv.appendChild(afterRange.cloneContents());
		const afterHtml = tempDiv.innerHTML;
		tempDiv.innerHTML = "";

		const textBefore = htmlToMarkdown(beforeHtml);
		const selectedTextMd = htmlToMarkdown(selectedHtml);
		const textAfter = htmlToMarkdown(afterHtml);

		// Truncate text before and after to 120 chars max with ellipsis
		const truncatedTextBefore =
			textBefore.length > 120 ? `${textBefore.slice(-120)}` : textBefore;
		const truncatedTextAfter =
			textAfter.length > 120 ? `${textAfter.slice(0, 120)}` : textAfter;

		return `<text_before>${truncatedTextBefore}</text_before><selected_text>${selectedTextMd}</selected_text><text_after>${truncatedTextAfter}</text_after>`;
	}

	if (selectedText) {
		// Find the position of the selected text in the full content
		const selectionStart = fullContent.indexOf(selectedText);
		if (selectionStart === -1) {
			// Fallback if we can't find the selection
			return `<text_before></text_before><selected_text>${selectedText}</selected_text><text_after></text_after>`;
		}

		const textBefore = fullContent.substring(0, selectionStart);
		const textAfter = fullContent.substring(
			selectionStart + selectedText.length,
		);

		// Truncate text before and after to 120 chars max with ellipsis
		const truncatedTextBefore =
			textBefore.length > 120 ? `${textBefore.slice(-120)}` : textBefore;
		const truncatedTextAfter =
			textAfter.length > 120 ? `${textAfter.slice(0, 120)}` : textAfter;

		return `<text_before>${truncatedTextBefore}</text_before><selected_text>${selectedText}</selected_text><text_after>${truncatedTextAfter}</text_after>`;
	}

	if (cursorPosition !== undefined && cursorPosition >= 0) {
		// Empty selection at cursor position
		const textBefore = fullContent.substring(0, cursorPosition);
		const textAfter = fullContent.substring(cursorPosition);

		// Truncate text before and after to 120 chars max with ellipsis
		const truncatedTextBefore =
			textBefore.length > 120 ? `${textBefore.slice(-120)}` : textBefore;
		const truncatedTextAfter =
			textAfter.length > 120 ? `${textAfter.slice(0, 120)}` : textAfter;

		return `<text_before>${truncatedTextBefore}</text_before><selected_text></selected_text><text_after>${truncatedTextAfter}</text_after>`;
	}

	// Fallback
	return `<text_before>${fullContent}</text_before><selected_text></selected_text><text_after></text_after>`;
};

type WysiwygMarkdownEditorProps = {
	document: CanvasDocument;
	conversationId?: string;
	agentId?: string;
	/**
	 * Render the block-format menu open.
	 *
	 * For stories only, and it earns its place: `:hover` and a real click
	 * cannot be forced from markup, so every label inside this menu existed in
	 * no captured frame - which is how "IndentIncrease" and "IndentDecrease"
	 * reached the format list and survived a design round. The date-time
	 * picker carries the same affordance for the same reason.
	 */
	initialFormatMenuOpen?: boolean;
};

/**
 * Prose rules for the contentEditable subtree.
 *
 * These have to reach elements the component never renders: the editable
 * markup is produced by `markdownToHtml` and written straight into the DOM, so
 * there is no React node to hang a class on. Every rule here is a single
 * descendant selector, which is exactly what an arbitrary variant expresses —
 * so they live on the scroll container as `[&_blockquote]:…` rather than in a
 * second stylesheet that would have to be kept in sync by hand. Values follow
 * `markdown.css`, so the editor and the rendered preview read the same.
 */
const editorProseClasses = cn(
	// The editable surface itself.
	//
	// `outline-none` here is a deliberate exception to the rule that a
	// focusable element must show a ring or have a wrapper draw one. This
	// surface fills its entire pane, so a ring would trace the pane border and
	// say nothing about where typing goes; the caret is the focus indicator, as
	// it is in every text editor. The exception holds only because this is a
	// full-pane editing surface - it does not extend to the fields around it.
	"[&_[contenteditable]]:min-h-50 [&_[contenteditable]]:text-body [&_[contenteditable]]:leading-relaxed [&_[contenteditable]]:text-ink [&_[contenteditable]]:outline-none",
	// Find/replace, painted through the CSS Custom Highlight API. Highlight
	// pseudo-elements inherit down the tree, so declaring them on the container
	// covers every match inside it.
	"[&::highlight(find-highlight)]:bg-accent-wash [&::highlight(find-highlight)]:text-ink",
	"[&::highlight(current-find-highlight)]:bg-accent [&::highlight(current-find-highlight)]:text-on-accent",
	// Headings.
	"[&_:is(h1,h2,h3,h4,h5,h6)]:mt-4 [&_:is(h1,h2,h3,h4,h5,h6)]:mb-2 [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6):first-child]:mt-0",
	"[&_h1]:text-title [&_h2]:text-heading [&_h3]:text-heading [&_h4]:text-body [&_h5]:text-body [&_h6]:text-body-sm",
	// Paragraphs.
	"[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
	// Lists. A task list drops its marker because the checkbox is the marker.
	"[&_:is(ul,ol)]:my-2 [&_:is(ul,ol)]:pl-6 [&_ul_li]:list-disc [&_ol_li]:list-decimal [&_li]:my-1 [&_li.task-list-item]:list-none",
	// Quotes: a left rule and a ground step, no card.
	"[&_blockquote]:my-3 [&_blockquote]:rounded-r-xs [&_blockquote]:border-hairline [&_blockquote]:border-l-2 [&_blockquote]:bg-sunken [&_blockquote]:px-3 [&_blockquote]:py-2 [&_blockquote]:text-ink-muted",
	// Code. The `pre` already carries the ground; a nested `code` keeping its
	// own would paint a box inside a box.
	"[&_code]:rounded-xs [&_code]:bg-sunken [&_code]:bg-none [&_code]:p-0.5 [&_code]:font-mono [&_code]:text-mono-sm",
	"[&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-sm [&_pre]:bg-sunken [&_pre]:bg-none [&_pre]:p-3",
	"[&_pre_code]:bg-transparent [&_pre_code]:p-0",
	// Tables. Horizontal rules only: a full grid of cell borders turns a
	// three-row table in a document into a spreadsheet embedded in prose, which
	// is the wrong reading. The header earns a rule and semibold weight rather
	// than a fill, so the table has no boxes at all.
	"[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse",
	"[&_:is(th,td)]:border-hairline [&_:is(th,td)]:border-b [&_:is(th,td)]:py-1.5 [&_:is(th,td)]:pr-4 [&_:is(th,td)]:text-left [&_:is(th,td):last-child]:pr-0",
	"[&_th]:font-semibold [&_th]:text-ink-muted",
	"[&_tbody_tr:last-child_td]:border-b-0",
	// Links and images.
	"[&_a]:text-accent [&_a]:underline [&_a:hover]:text-accent-hover",
	"[&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-xs",
);

/**
 * The inline diff block shown while a suggested edit is under review.
 *
 * Built imperatively (it is injected into the contentEditable subtree), so the
 * classes are named here rather than set as inline styles — an inline
 * `background-color` would have to be a literal, which is how the old version
 * ended up with a red and a green that no theme could reach.
 *
 * Each half is labelled, not merely tinted. The two washes are quiet by
 * design, and simulated at deuteranopia severity 1.0 they meet at ΔE00 2.07
 * in the light palette and 2.35 in the dark — the same block printed twice,
 * on the surface where a person accepts or discards someone else's edit to
 * their own file. The label carries the distinction with no colour in it at
 * all, and it uses the wording `code-editor-diff.ts` already speaks rather
 * than a second vocabulary for the same idea.
 */
const DIFF_CONTAINER_CLASS = "my-3 overflow-hidden rounded-sm";
const DIFF_SIDE_CLASS = "flex gap-2 border-l-2 px-3 py-2";
const DIFF_REMOVED_CLASS = cn(
	DIFF_SIDE_CLASS,
	"border-danger-border bg-danger-wash",
);
const DIFF_ADDED_CLASS = cn(
	DIFF_SIDE_CLASS,
	"border-success-border bg-success-wash",
);
/*
 * A fixed gutter rather than a label-width one: reading the two halves against
 * each other is the whole job, and letting the column size itself would start
 * the old text and the new text at different left edges — "Remove" is wider
 * than "Add". `leading-relaxed` matches the prose beside it so the label sits
 * on the first line rather than above it.
 */
const DIFF_LABEL_CLASS =
	"w-16 shrink-0 select-none font-semibold text-meta leading-relaxed";

/**
 * One half of the review block: which side it is, then the markdown for it
 * rendered as prose.
 *
 * The label is real text, not an `aria-label` on a coloured box, so the same
 * words reach a screen reader and a sighted reader who cannot tell the two
 * washes apart. An empty side is skipped — a pure insertion has nothing to
 * remove, and an empty "- Remove" row would claim otherwise.
 */
const appendDiffSide = (
	container: HTMLElement,
	side: "remove" | "add",
	markdown: string,
) => {
	if (!markdown.trim()) return;
	const isRemove = side === "remove";

	const half = window.document.createElement("div");
	half.className = isRemove ? DIFF_REMOVED_CLASS : DIFF_ADDED_CLASS;

	const label = window.document.createElement("span");
	label.className = cn(
		DIFF_LABEL_CLASS,
		isRemove ? "text-danger" : "text-success",
	);
	label.textContent = isRemove ? "- Remove" : "+ Add";
	half.appendChild(label);

	const content = window.document.createElement("div");
	content.className = "min-w-0 flex-1";
	content.innerHTML = markdownToHtml(markdown);
	half.appendChild(content);

	container.appendChild(half);
};

/**
 * The whole review block for one proposed change.
 *
 * Named as a single group: the two halves are one proposal, and the floating
 * review toolbar already says which change of how many this is, so the block
 * needs a name rather than a visible heading repeating it.
 *
 * Exported for the `DiffReview` story, which used to re-draw this markup by
 * hand. A copy is only accurate until one of the two is edited, and the
 * evidence frames the design review is judged from come from that story.
 */
export const buildDiffContainer = (diff: EditDiff) => {
	const container = window.document.createElement("div");
	container.setAttribute("data-diff-container", "true");
	container.contentEditable = "false";
	container.className = DIFF_CONTAINER_CLASS;
	container.setAttribute("role", "group");
	container.setAttribute("aria-label", "Proposed change");
	appendDiffSide(container, "remove", diff.find);
	appendDiffSide(container, "add", diff.replace);
	return container;
};

/**
 * Find-match highlighting for browsers without `CSS.highlights`. Same two roles
 * the highlight pseudo-elements above use, so the fallback is indistinguishable.
 */
const FIND_MATCH_CLASS = "bg-accent-wash text-ink";
const FIND_CURRENT_MATCH_CLASS = "bg-accent text-on-accent";

/**
 * A formatting toggle that is on. A colour step, not a raised slab — and it
 * holds that colour on hover so the state does not read as a hover artefact.
 */
const ACTIVE_TOGGLE_CLASS =
	"bg-accent-wash text-accent hover:bg-accent-wash hover:text-accent";

/**
 * The two toggle groups. Both render the same button with the same pressed
 * treatment, so they are data rather than near-identical JSX blocks.
 *
 * `TEXT_FORMATS` is split into the pair that stays on the bar and the one that
 * moves into the overflow menu. Bold and italic are the two markdown carries
 * natively and the two everyone reaches for; strikethrough is a GFM extension
 * that round-trips correctly but is rare enough not to earn a permanent 28px
 * of a panel 440px wide at its narrowest.
 *
 * Underline is gone rather than demoted. It has no markdown, and the toolbar
 * did not merely fail to save it: `execCommand` emits `<u>`, `htmlToMarkdown`
 * writes `*text*`, and reopening the file renders `<em>`. A control that
 * silently turns a user's underline into italics is worse than no control,
 * because the document that comes back is not the one they wrote.
 */
const PRIMARY_TEXT_FORMATS = [
	{ value: "bold", label: "Bold (Ctrl+B)", Icon: Bold },
	{ value: "italic", label: "Italic (Ctrl+I)", Icon: Italic },
] as const;

const OVERFLOW_TEXT_FORMATS = [
	{ value: "strikethrough", label: "Strikethrough", Icon: Strikethrough },
] as const;

/*
 * Alignment is not offered, and the machinery for it is gone with the menu.
 *
 * It used to live in the overflow menu on the argument that a setting the file
 * cannot hold does not deserve permanent toolbar space - which conceded the
 * whole point and then shipped it anyway. `wysiwyg-utils` has no `text-align`
 * handling in either direction, so an aligned paragraph round-trips as a plain
 * one, and the menu drew an accent checkmark against the current alignment as
 * though it were persisted state. Align left appeared to work only because it
 * is the default.
 */

type TextType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

/**
 * WYSIWYG Markdown Editor Component
 *
 * Features:
 * - Rich text editing with markdown output
 * - Toolbar with formatting options
 * - Real-time markdown synchronization
 * - Table editing support
 * - List management
 * - Link and image insertion
 * - Keyboard shortcuts
 */
const WysiwygMarkdownEditorComponent: FC<WysiwygMarkdownEditorProps> = ({
	document,
	conversationId,
	agentId,
	initialFormatMenuOpen = false,
}) => {
	const [content, setContent] = useState(document.content);
	const [hasUserChanges, setHasUserChanges] = useState(false);
	const [currentTextType, setCurrentTextType] = useState<TextType>("paragraph");
	const [selectedFormats, setSelectedFormats] = useState<string[]>([]);
	const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
	const [linkDialogData, setLinkDialogData] = useState<LinkDialogData>({
		url: "",
		text: "",
	});
	const [isImageDialogOpen, setIsImageDialogOpen] = useState(false);
	const [tableAnchorEl, setTableAnchorEl] = useState<HTMLElement | null>(null);
	// The overflow menu's trigger doubles as the anchor for the table-size grid
	// launched from inside that menu.
	const overflowTriggerRef = useRef<HTMLButtonElement>(null);
	const [showFindReplace, setShowFindReplace] = useState(false);
	const [findReplaceMode, setFindReplaceMode] = useState<"find" | "replace">(
		"find",
	);
	const [searchQuery, setSearchQuery] = useState("");
	const [matchRanges, setMatchRanges] = useState<Range[]>([]);
	const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
	const [inlineEdit, setInlineEdit] = useState<{
		selection: string;
		position: { top: number; left: number };
		range: Range | null;
	} | null>(null);
	const [reviewState, setReviewState] = useState<{
		diffs: EditDiff[];
		currentIndex: number;
		approvedDiffs: EditDiff[];
		originalContent: string;
	} | null>(null);
	const selectionRef = useRef<Range | null>(null);
	const editorContentRef = useRef<HTMLDivElement>(null);
	const relativeContainerRef = useRef<HTMLDivElement>(null);
	const scrollPositionRef = useRef<number | null>(null);

	const debouncedContent = useDebouncedValue(content, 3000);
	const editorRef = useRef<HTMLDivElement>(null);
	const originalContentRef = useRef(document.content);
	const isInitialLoadRef = useRef(true);
	const [canUndo, setCanUndo] = useState(false);
	const [canRedo, setCanRedo] = useState(false);

	const { getOrCreateManager } = useUndoManagerStore();
	const undoManagerRef = useRef<UndoManager | null>(null);

	const findHighlightRegistry = "find-highlight";
	const currentFindHighlightRegistry = "current-find-highlight";

	useEffect(() => {
		if (window.CSS && CSS.highlights) {
			if (!CSS.highlights.has(findHighlightRegistry)) {
				CSS.highlights.set(findHighlightRegistry, new Highlight());
			}
			if (!CSS.highlights.has(currentFindHighlightRegistry)) {
				CSS.highlights.set(currentFindHighlightRegistry, new Highlight());
			}
		}
	}, []);

	const { updateOneFile } = useCanvasStore();
	const canvasState = useCanvasStore((state) =>
		conversationId ? state.conversations[conversationId] : undefined,
	);

	// Manual save function that bypasses debounce
	const handleManualSave = useCallback(() => {
		if (
			!document.path ||
			!hasUserChanges ||
			content === originalContentRef.current
		) {
			return;
		}

		window.api.saveFile(document.path, content);
		showSuccessToast("File saved");
		originalContentRef.current = content;
		setHasUserChanges(false);

		if (conversationId && canvasState) {
			updateOneFile(conversationId, { ...document, content });
		}
	}, [
		hasUserChanges,
		content,
		document,
		conversationId,
		canvasState,
		updateOneFile,
	]);

	const updateCurrentTextType = useCallback(() => {
		const selection = window.getSelection();
		if (!selection?.rangeCount) return;

		const range = selection.getRangeAt(0);
		let element: Node | null = range.startContainer;

		if (element.nodeType === Node.TEXT_NODE && element.parentElement) {
			element = element.parentElement;
		}

		while (
			element &&
			element !== editorRef.current &&
			element instanceof Element
		) {
			const tagName = element.tagName?.toLowerCase();
			if (tagName && ["h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName)) {
				setCurrentTextType(tagName as TextType);
				return;
			}
			element = element.parentElement;
		}

		setCurrentTextType("paragraph");
	}, []);

	const updateSelectedFormats = useCallback(() => {
		const formats: string[] = [];

		if (window.document.queryCommandState("bold")) formats.push("bold");
		if (window.document.queryCommandState("italic")) formats.push("italic");
		if (window.document.queryCommandState("strikeThrough"))
			formats.push("strikethrough");

		setSelectedFormats(formats);
	}, []);

	const handleContentChange = useCallback(() => {
		if (!editorRef.current) return;

		const htmlContent = editorRef.current.innerHTML;
		const markdownContent = htmlToMarkdown(htmlContent);

		setContent(markdownContent);

		if (isInitialLoadRef.current) {
			isInitialLoadRef.current = false;
		}

		if (markdownContent !== originalContentRef.current) {
			setHasUserChanges(true);
		}

		updateCurrentTextType();
		updateSelectedFormats();
	}, [updateCurrentTextType, updateSelectedFormats]);

	const clearHighlights = useCallback(() => {
		if (window.CSS && CSS.highlights) {
			CSS.highlights.get(findHighlightRegistry)?.clear();
			CSS.highlights.get(currentFindHighlightRegistry)?.clear();
		} else {
			// Fallback for browsers that don't support the Highlight API
			if (!editorRef.current) return;
			const highlights = editorRef.current.querySelectorAll(
				"span[data-highlight='true']",
			);
			for (const node of highlights) {
				const parent = node.parentNode;
				if (parent) {
					while (node.firstChild) {
						parent.insertBefore(node.firstChild, node);
					}
					parent.removeChild(node);
					parent.normalize();
				}
			}
		}
	}, []);

	const handleFind = useCallback(
		(query: string, startAfterRange?: Range, manageFocus = true) => {
			clearHighlights();
			setSearchQuery(query);
			if (!query || !editorRef.current) {
				setMatchRanges([]);
				setCurrentMatchIndex(-1);
				return 0;
			}

			const ranges: Range[] = [];
			const walker = window.document.createTreeWalker(
				editorRef.current,
				NodeFilter.SHOW_TEXT,
			);
			let node: Node | null = walker.nextNode();
			while (node) {
				const textNode = node as Text;
				const text = textNode.nodeValue;
				if (text) {
					let fromIndex = 0;
					let matchIndex = text
						.toLowerCase()
						.indexOf(query.toLowerCase(), fromIndex);
					while (matchIndex !== -1) {
						const range = window.document.createRange();
						range.setStart(textNode, matchIndex);
						range.setEnd(textNode, matchIndex + query.length);
						ranges.push(range);
						fromIndex = matchIndex + query.length;
						matchIndex = text
							.toLowerCase()
							.indexOf(query.toLowerCase(), fromIndex);
					}
				}
				node = walker.nextNode();
			}

			setMatchRanges(ranges);
			let newIndex = -1;

			if (ranges.length > 0) {
				if (startAfterRange) {
					for (let i = 0; i < ranges.length; i++) {
						if (
							startAfterRange.compareBoundaryPoints(
								Range.END_TO_START,
								ranges[i],
							) <= 0
						) {
							newIndex = i;
							break;
						}
					}
					if (newIndex === -1) {
						newIndex = 0;
					}
				} else {
					newIndex = 0;
				}

				setCurrentMatchIndex(newIndex);

				const activeRange = ranges[newIndex];

				if (window.CSS && CSS.highlights) {
					const findHighlights = new Highlight(...ranges);
					CSS.highlights.set(findHighlightRegistry, findHighlights);

					const currentHighlight = new Highlight(activeRange);
					CSS.highlights.set(currentFindHighlightRegistry, currentHighlight);
				} else {
					// Fallback to span-based highlighting
					for (let i = 0; i < ranges.length; i++) {
						const range = ranges[i];
						const highlightSpan = window.document.createElement("span");
						highlightSpan.dataset.highlight = "true";
						const isCurrent = i === newIndex;
						highlightSpan.className = isCurrent
							? FIND_CURRENT_MATCH_CLASS
							: FIND_MATCH_CLASS;
						range.surroundContents(highlightSpan);
					}
				}

				// Scroll to the active match
				const activeElement = window.document.activeElement;
				activeRange.startContainer.parentElement?.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});
				if (manageFocus) {
					if (
						activeElement instanceof HTMLElement &&
						activeElement !== window.document.body
					) {
						activeElement.focus({ preventScroll: true });
					}
				}
			} else {
				setCurrentMatchIndex(-1);
			}

			return ranges.length;
		},
		[clearHighlights],
	);

	const handleNavigate = useCallback(
		(direction: "next" | "prev") => {
			if (matchRanges.length === 0) return;

			const newIndex =
				direction === "next"
					? (currentMatchIndex + 1) % matchRanges.length
					: (currentMatchIndex - 1 + matchRanges.length) % matchRanges.length;

			setCurrentMatchIndex(newIndex);
			const activeRange = matchRanges[newIndex];

			if (window.CSS && CSS.highlights) {
				const currentHighlight = CSS.highlights.get(
					currentFindHighlightRegistry,
				);
				currentHighlight?.clear();
				currentHighlight?.add(activeRange);
			} else {
				// Fallback
				const highlights = editorRef.current?.querySelectorAll(
					"span[data-highlight='true']",
				);
				if (highlights) {
					highlights.forEach((h, i) => {
						const highlight = h as HTMLElement;
						highlight.className =
							i === newIndex ? FIND_CURRENT_MATCH_CLASS : FIND_MATCH_CLASS;
					});
				}
			}

			// Scroll to the active match
			const activeElement = window.document.activeElement;
			activeRange.startContainer.parentElement?.scrollIntoView({
				behavior: "smooth",
				block: "center",
			});
			if (
				activeElement instanceof HTMLElement &&
				activeElement !== window.document.body
			) {
				activeElement.focus({ preventScroll: true });
			}
		},
		[matchRanges, currentMatchIndex],
	);

	const handleReplace = useCallback(
		(replaceText: string): Promise<void> => {
			return new Promise((resolve) => {
				if (currentMatchIndex === -1 || !matchRanges[currentMatchIndex]) {
					resolve();
					return;
				}

				const range = matchRanges[currentMatchIndex];
				const selection = window.getSelection();
				if (selection) {
					selection.removeAllRanges();
					selection.addRange(range);
					window.document.execCommand("insertText", false, replaceText);
					// After execCommand, selection is collapsed at the end of insertion.
					const caretRange = selection.getRangeAt(0);

					// Defer find to separate it from the undo stack and focus back
					setTimeout(() => {
						handleFind(searchQuery, caretRange, false);
						resolve();
					}, 0);
				} else {
					resolve();
				}
			});
		},
		[currentMatchIndex, matchRanges, handleFind, searchQuery],
	);

	const handleReplaceAll = useCallback(
		(findText: string, replaceText: string) => {
			if (!findText || !editorRef.current) return;
			clearHighlights();

			const originalHtml = editorRef.current.innerHTML;
			const regex = new RegExp(
				findText.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"),
				"gi",
			);
			const newHtml = originalHtml.replace(regex, replaceText);

			if (originalHtml !== newHtml) {
				editorRef.current.focus();
				window.document.execCommand("selectAll", false);
				window.document.execCommand("insertHTML", false, newHtml);
			}

			setMatchRanges([]);
			setCurrentMatchIndex(-1);
		},
		[clearHighlights],
	);

	// Initialize editor content
	// biome-ignore lint/correctness/useExhaustiveDependencies: We need to run this effect only when the document is changed by the user
	useEffect(() => {
		if (editorRef.current && document.id) {
			// Set editor content
			const htmlContent = markdownToHtml(document.content);

			if (editorRef.current.innerHTML !== htmlContent) {
				editorRef.current.innerHTML = htmlContent;
			}

			setContent(document.content);
			setHasUserChanges(false);
			originalContentRef.current = document.content;
			isInitialLoadRef.current = true;
		}
	}, [document.id]);

	// Update content when lastAgentModified changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: We need to run this effect only when lastAgentModified changes
	useEffect(() => {
		if (document.lastAgentModified && editorRef.current) {
			const htmlContent = markdownToHtml(document.content);
			if (editorRef.current.innerHTML !== htmlContent) {
				editorRef.current.innerHTML = htmlContent;
				setContent(document.content);
				originalContentRef.current = document.content;
				setHasUserChanges(false);
				undoManagerRef.current?.saveCurrentState();
			}
		}
	}, [document.lastAgentModified]);

	// Manage UndoManager lifecycle
	useEffect(() => {
		const onStateChange = (canUndo: boolean, canRedo: boolean) => {
			setCanUndo(canUndo);
			setCanRedo(canRedo);
		};

		if (editorRef.current && document.id) {
			// Disconnect previous manager
			if (undoManagerRef.current) {
				undoManagerRef.current.disconnect();
			}

			// Get or create a manager for the new document
			const manager = getOrCreateManager(
				document.id,
				editorRef.current,
				onStateChange,
			);
			undoManagerRef.current = manager;

			// Connect the manager and update its state
			if (!manager.isConnectedToElement()) {
				manager.connect();
			}
			setCanUndo(manager.canUndo());
			setCanRedo(manager.canRedo());
		}

		return () => {
			// Disconnect the manager on cleanup
			if (undoManagerRef.current) {
				undoManagerRef.current.disconnect();
			}
		};
	}, [document.id, getOrCreateManager]);

	// Save content when debounced
	useEffect(() => {
		if (
			hasUserChanges &&
			!isInitialLoadRef.current &&
			debouncedContent !== originalContentRef.current &&
			document.path
		) {
			window.api.saveFile(document.path, debouncedContent);
			showSuccessToast("File saved");
			originalContentRef.current = debouncedContent;

			if (conversationId && canvasState) {
				updateOneFile(conversationId, {
					...document,
					content: debouncedContent,
				});
			}
		}
	}, [
		debouncedContent,
		hasUserChanges,
		conversationId,
		canvasState,
		document,
		updateOneFile,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: We need to run this effect when content changes to restore the scroll position.
	useEffect(() => {
		if (scrollPositionRef.current !== null && editorContentRef.current) {
			editorContentRef.current.scrollTop = scrollPositionRef.current;
			scrollPositionRef.current = null;
		}
	}, [content]);

	const handleSelectionChange = useCallback(() => {
		updateCurrentTextType();
		updateSelectedFormats();
	}, [updateCurrentTextType, updateSelectedFormats]);

	const debouncedSelectionChange = useDebounce(handleSelectionChange, 150);

	useEffect(() => {
		const handleSelection = () => {
			debouncedSelectionChange();
		};

		window.document.addEventListener("selectionchange", handleSelection);

		return () => {
			window.document.removeEventListener("selectionchange", handleSelection);
		};
	}, [debouncedSelectionChange]);

	const toggleList = useCallback(
		(type: "ordered" | "unordered" | "task") => {
			if (!editorRef.current) return;

			if (type === "ordered") {
				window.document.execCommand("insertOrderedList", false);
			} else {
				window.document.execCommand("insertUnorderedList", false);
			}

			if (type === "task") {
				const selection = window.getSelection();
				if (!selection?.rangeCount) return;

				const range = selection.getRangeAt(0);
				const listElement = (range.startContainer as HTMLElement).closest(
					"ul, ol",
				);

				if (listElement) {
					// If we're in an ordered list, convert it to an unordered one for tasks.
					if (listElement.tagName === "OL") {
						window.document.execCommand("insertUnorderedList", false);
					}

					const listItems = listElement.querySelectorAll("li");
					for (const li of listItems) {
						if (!li.querySelector('input[type="checkbox"]')) {
							li.classList.add("task-list-item");
							const checkbox = window.document.createElement("input");
							checkbox.type = "checkbox";
							li.prepend(checkbox, " ");
						}
					}
				}
			}

			handleContentChange();
			editorRef.current.focus();
		},
		[handleContentChange],
	);

	// Execute formatting command
	const executeCommand = useCallback(
		(command: string, value?: string) => {
			window.document.execCommand(command, false, value);
			handleContentChange();
			editorRef.current?.focus();
		},
		[handleContentChange],
	);

	// Handle text type change
	const handleTextTypeChange = useCallback(
		(type: TextType) => {
			if (type === "paragraph") {
				executeCommand("formatBlock", "p");
			} else {
				executeCommand("formatBlock", type);
			}
			setCurrentTextType(type);
		},
		[executeCommand],
	);

	const toggleBlockFormat = useCallback(
		(format: "blockquote" | "pre") => {
			const selection = window.getSelection();
			if (!selection?.rangeCount) return;

			let element: Node | null = selection.getRangeAt(0).startContainer;
			if (element.nodeType === Node.TEXT_NODE) {
				element = element.parentElement;
			}

			let isFormatted = false;
			while (element && element !== editorRef.current) {
				if (
					element instanceof HTMLElement &&
					element.tagName.toLowerCase() === format
				) {
					isFormatted = true;
					break;
				}
				element = element.parentElement;
			}

			if (isFormatted) {
				executeCommand("formatBlock", "p");
			} else {
				executeCommand("formatBlock", format);
			}
		},
		[executeCommand],
	);

	// Handle format toggle
	const handleFormatToggle = useCallback(
		(format: string) => {
			switch (format) {
				case "bold":
					executeCommand("bold");
					break;
				case "italic":
					executeCommand("italic");
					break;
				case "strikethrough":
					executeCommand("strikeThrough");
					break;
			}
		},
		[executeCommand],
	);

	// Insert link
	const insertLink = useCallback(() => {
		const selection = window.getSelection();
		if (!selection?.rangeCount) return;

		selectionRef.current = selection.getRangeAt(0).cloneRange();
		let element: Node | null = selection.anchorNode;

		while (element && element !== editorRef.current) {
			if (element.nodeName === "A") {
				const anchor = element as HTMLAnchorElement;
				setLinkDialogData({ url: anchor.href, text: anchor.innerText });
				setIsLinkDialogOpen(true);
				return;
			}
			element = element.parentNode;
		}

		setLinkDialogData({ url: "", text: selection.toString() });
		setIsLinkDialogOpen(true);
	}, []);

	const handleInsertLink = useCallback(
		(url: string, text: string) => {
			editorRef.current?.focus();
			const selection = window.getSelection();
			if (!selection || !selectionRef.current) return;

			selection.removeAllRanges();
			selection.addRange(selectionRef.current);

			const anchor = selection.anchorNode?.parentElement;
			if (anchor?.nodeName === "A") {
				anchor.setAttribute("href", url);
				anchor.textContent = text;
			} else {
				const linkHtml = `<a href="${url}">${text || url}</a>`;
				executeCommand("insertHTML", linkHtml);
			}

			handleContentChange();
		},
		[executeCommand, handleContentChange],
	);

	// Insert image
	const insertImage = useCallback(() => {
		const selection = window.getSelection();
		if (selection?.rangeCount) {
			selectionRef.current = selection.getRangeAt(0).cloneRange();
		}
		setIsImageDialogOpen(true);
	}, []);

	const handleInsertImage = useCallback(
		(url: string) => {
			editorRef.current?.focus();
			const selection = window.getSelection();
			if (!selection) return;

			if (selectionRef.current) {
				selection.removeAllRanges();
				selection.addRange(selectionRef.current);
			}

			if (url) {
				executeCommand("insertImage", url);
			}
			handleContentChange();
		},
		[executeCommand, handleContentChange],
	);

	// Insert table. Takes the anchor rather than an event because the control
	// that opens it is sometimes a menu item that unmounts as the menu closes,
	// and a popover anchored to a removed node has nothing to position against.
	const insertTable = useCallback((anchor: HTMLElement) => {
		const selection = window.getSelection();
		if (selection?.rangeCount) {
			selectionRef.current = selection.getRangeAt(0).cloneRange();
		}
		setTableAnchorEl(anchor);
	}, []);

	const handleInsertTable = useCallback(
		(rows: number, cols: number) => {
			if (rows > 0 && cols > 0) {
				editorRef.current?.focus();
				const selection = window.getSelection();
				if (!selection) return;

				if (selectionRef.current) {
					selection.removeAllRanges();
					selection.addRange(selectionRef.current);
				}

				const range = selection.getRangeAt(0);
				range.deleteContents();

				// Create a new paragraph for spacing
				const p1 = window.document.createElement("p");
				p1.innerHTML = "<br>";

				// Create the table element
				const table = window.document.createElement("table");
				const thead = table.createTHead();
				const tbody = table.createTBody();
				const headerRow = thead.insertRow();

				for (let j = 0; j < cols; j++) {
					const th = window.document.createElement("th");
					th.textContent = `Header ${j + 1}`;
					headerRow.appendChild(th);
				}

				for (let i = 0; i < rows; i++) {
					const bodyRow = tbody.insertRow();
					for (let j = 0; j < cols; j++) {
						const td = bodyRow.insertCell();
						td.textContent = `Cell ${i + 1}, ${j + 1}`;
					}
				}

				// Create another paragraph for spacing
				const p2 = window.document.createElement("p");
				p2.innerHTML = "<br>";

				// Insert the elements into the document
				range.insertNode(p2);
				range.insertNode(table);
				range.insertNode(p1);

				// Move the cursor to after the table
				range.setStartAfter(p2);
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);

				handleContentChange();
			}
		},
		[handleContentChange],
	);

	// Handle double-click on links to open in new tab
	const handleDoubleClick = useCallback((event: React.MouseEvent) => {
		const target = event.target as HTMLElement;

		// Check if the clicked element is a link or is within a link
		let linkElement: HTMLAnchorElement | null = null;
		if (target.tagName === "A") {
			linkElement = target as HTMLAnchorElement;
		} else {
			// Check if the target is within a link element using closest
			linkElement = target.closest?.("a") ?? null;
		}

		if (linkElement?.href) {
			event.preventDefault();
			window.open(linkElement.href, "_blank", "noopener,noreferrer");
		}
	}, []);

	const handleClick = useCallback(
		(event: React.MouseEvent) => {
			const target = event.target as HTMLInputElement;
			if (target.tagName === "INPUT" && target.type === "checkbox") {
				// Manually update the 'checked' attribute to reflect the new state.
				// The 'checked' property gives the current state post-click.
				if (target.checked) {
					target.setAttribute("checked", "");
				} else {
					target.removeAttribute("checked");
				}

				// The checked state is already updated by the browser, so we just need to
				// trigger our content change handler to convert the new HTML to markdown
				handleContentChange();
			}
		},
		[handleContentChange],
	);

	// Handle keyboard shortcuts
	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (event.key === "Tab") {
				/*
				 * Tab nests a list item, and does nothing anywhere else.
				 *
				 * `execCommand("indent")` on a paragraph emits a styled
				 * `<blockquote>`, which saves as `> text` - byte-identical to
				 * what Quote writes. A user pressing Tab, usually by accident,
				 * got a blockquote they did not ask for and could not tell apart
				 * from one they did. Inside a list the same command nests the
				 * item and round-trips through markdown correctly, which is the
				 * only reason this key still does anything.
				 *
				 * Outside a list this returns without `preventDefault`, so Tab
				 * moves focus out of the editor. That is deliberate and is the
				 * accessible behaviour - a contenteditable that swallows Tab is
				 * a keyboard trap (WCAG 2.1.2) and there was previously no way
				 * to leave this editor with the keyboard alone.
				 *
				 * BOTH ends of the range are tested, not the anchor. A drag from
				 * inside a list item into the paragraph after it is an ordinary
				 * selection, and testing one end let `indent` blockquote that
				 * paragraph - the exact defect this gate exists to prevent,
				 * reachable by a different route. `commonAncestorContainer` is
				 * the tempting one-liner and it is wrong: for a selection across
				 * two items it is the `<ul>`, which has no `li` ancestor, so
				 * indenting several items at once would stop working.
				 */
				const selection = window.getSelection();
				const range =
					selection && selection.rangeCount > 0
						? selection.getRangeAt(0)
						: null;
				/* A boundary in an ELEMENT container addresses a position between
				   that element's children, not the element itself. Selecting
				   across list items can leave the end boundary on the `<ul>` at
				   an offset - a triple-click does exactly this - and testing the
				   `<ul>` finds no `li`, so a legitimate multi-item indent would
				   stop working.

				   Blank children are stepped over on the way back. Serialised
				   HTML puts a whitespace text node between `</li>` and `</ul>`,
				   so the last child of a list is usually not a list item, and
				   resolving to it reintroduces the same failure one node along. */
				const boundaryNode = (container: Node, offset: number): Node => {
					if (container.nodeType !== Node.ELEMENT_NODE) return container;
					const children = container.childNodes;
					if (children.length === 0) return container;
					const isBlank = (node: Node) =>
						node.nodeType === Node.TEXT_NODE &&
						(node.textContent ?? "").trim() === "";
					let index = Math.min(offset, children.length - 1);
					while (index > 0 && isBlank(children[index])) index--;
					return children[index] ?? container;
				};
				const listItemFor = (node: Node | null): Element | null => {
					const element =
						node?.nodeType === Node.ELEMENT_NODE
							? (node as Element)
							: (node?.parentElement ?? null);
					return element?.closest("li") ?? null;
				};
				if (
					!range ||
					!listItemFor(boundaryNode(range.startContainer, range.startOffset)) ||
					!listItemFor(boundaryNode(range.endContainer, range.endOffset))
				) {
					return;
				}
				event.preventDefault();
				executeCommand(event.shiftKey ? "outdent" : "indent");
				return;
			}

			if (event.metaKey || event.ctrlKey) {
				switch (event.key) {
					case "f": {
						event.preventDefault();
						const selection = window.getSelection()?.toString();
						if (selection) {
							setSearchQuery(selection);
						}
						setFindReplaceMode(event.altKey ? "replace" : "find");
						setShowFindReplace(true);
						break;
					}
					case "b":
						event.preventDefault();
						handleFormatToggle("bold");
						break;
					case "i":
						event.preventDefault();
						handleFormatToggle("italic");
						break;
					/* No `case "u"`: `execCommand("underline")` emits `<u>`, which
					   the save path turns into `*text*` and reopens as italic. A
					   shortcut that silently rewrites the user's formatting as a
					   different one is worse than no shortcut. */
					case "s":
						event.preventDefault();
						handleManualSave();
						break;
					case "k": {
						event.preventDefault();
						const selection = window.getSelection();
						if (selection && selection.rangeCount > 0 && editorRef.current) {
							const range = selection.getRangeAt(0).cloneRange();
							const container = relativeContainerRef.current;
							if (!container) {
								break;
							}
							const containerRect = container.getBoundingClientRect();

							// Get cursor position for empty selections
							let cursorPosition: number | undefined;
							let rect: DOMRect;

							if (selection.isCollapsed) {
								try {
									cursorPosition = getCursorPosition(editorRef.current, range);

									// For collapsed selections, create a temporary text node to get accurate positioning
									const tempTextNode = window.document.createTextNode("\u200B"); // Zero-width space
									range.insertNode(tempTextNode);
									const tempRange = window.document.createRange();
									tempRange.selectNode(tempTextNode);
									rect = tempRange.getBoundingClientRect();

									// Clean up the temporary node
									tempTextNode.remove();

									// If the rect is still invalid, fall back to the original range
									if (rect.width === 0 && rect.height === 0) {
										rect = range.getBoundingClientRect();
									}
								} catch (error) {
									console.warn("Failed to calculate cursor position:", error);
									cursorPosition = undefined;
									rect = range.getBoundingClientRect();
								}
							} else {
								rect = range.getBoundingClientRect();
							}

							const selectedText = selection.toString();
							const formattedSelection = formatSelectionWithContext(
								content,
								selectedText,
								cursorPosition,
								editorRef.current,
								range,
							);

							setInlineEdit({
								selection: formattedSelection,
								position: {
									top: rect.top - containerRect.top,
									left: 0,
								},
								range,
							});
							selection.removeAllRanges();
						}
						break;
					}
					case "z":
						if (event.shiftKey) {
							event.preventDefault();
							if (undoManagerRef.current?.canRedo()) {
								undoManagerRef.current.redo();
								// Update content state after redo
								if (editorRef.current) {
									const htmlContent = editorRef.current.innerHTML;
									const markdownContent = htmlToMarkdown(htmlContent);
									setContent(markdownContent);
									setHasUserChanges(true);
								}
								setCanUndo(undoManagerRef.current.canUndo());
								setCanRedo(undoManagerRef.current.canRedo());
							}
						} else {
							event.preventDefault();
							if (undoManagerRef.current?.canUndo()) {
								undoManagerRef.current.undo();
								// Update content state after undo
								if (editorRef.current) {
									const htmlContent = editorRef.current.innerHTML;
									const markdownContent = htmlToMarkdown(htmlContent);
									setContent(markdownContent);
									setHasUserChanges(true);
								}
								setCanUndo(undoManagerRef.current.canUndo());
								setCanRedo(undoManagerRef.current.canRedo());
							}
						}
						break;
				}
			}

			// Handle Enter key in lists
			if (event.key === "Enter") {
				const selection = window.getSelection();
				if (!selection?.rangeCount) return;

				const range = selection.getRangeAt(0);
				const container = range.startContainer;
				const startElement =
					container.nodeType === Node.TEXT_NODE
						? container.parentElement
						: (container as Element);
				const listItem = startElement?.closest("li");

				if (listItem) {
					// If the list item is empty, break out of the list.
					if (listItem.textContent?.trim() === "") {
						event.preventDefault();
						executeCommand("outdent");
						executeCommand("formatBlock", "p");
						return;
					}

					// Handle creating new task list items.
					if (listItem.classList.contains("task-list-item")) {
						// Defer to let the browser create the new LI, then add a checkbox.
						setTimeout(() => {
							const newSelection = window.getSelection();
							if (!newSelection?.rangeCount) return;

							const newRange = newSelection.getRangeAt(0);
							const newStartContainer = newRange.startContainer;
							const newStartElement =
								newStartContainer.nodeType === Node.TEXT_NODE
									? newStartContainer.parentElement
									: (newStartContainer as Element);
							const newListItem = newStartElement?.closest("li");

							if (
								newListItem &&
								!newListItem.querySelector('input[type="checkbox"]')
							) {
								newListItem.classList.add("task-list-item");
								const checkbox = window.document.createElement("input");
								checkbox.type = "checkbox";
								newListItem.prepend(checkbox, " ");

								// Set the cursor position after the checkbox
								newRange.setStart(newListItem, 1);
								newRange.collapse(true);
								newSelection.removeAllRanges();
								newSelection.addRange(newRange);

								handleContentChange();
							}
						}, 0);
					}
				}
			}
		},
		[
			handleFormatToggle,
			executeCommand,
			content,
			handleManualSave,
			handleContentChange,
		],
	);

	const handleFinalizeChanges = (finalDiffs: EditDiff[]) => {
		if (!editorRef.current) return;

		let finalContent = reviewState?.originalContent ?? content;
		for (const diff of finalDiffs) {
			finalContent = finalContent.replace(diff.find, diff.replace);
		}

		editorRef.current.innerHTML = markdownToHtml(finalContent);
		setContent(finalContent);
		setHasUserChanges(true);
		setReviewState(null);
		setInlineEdit(null);
		selectionRef.current = null;
		undoManagerRef.current?.saveCurrentState();

		// Force save the changes immediately since they came from inline edit
		if (document.path && finalContent !== originalContentRef.current) {
			window.api.saveFile(document.path, finalContent);
			showSuccessToast("File saved");
			originalContentRef.current = finalContent;
			setHasUserChanges(false);

			if (conversationId && canvasState) {
				updateOneFile(conversationId, { ...document, content: finalContent });
			}
		}
	};

	/**
	 * Highlights a diff inline by mapping markdown positions to the corresponding HTML elements
	 * and inserting a diff container showing the old and new HTML representations.
	 *
	 * @param diff - The diff containing 'find' and 'replace' markdown strings.
	 * @param markdownContent - The full markdown content currently displayed.
	 */
	const showDiffInline = useCallback<
		(diff: EditDiff, markdownContent: string) => void
	>((diff, markdownContent) => {
		if (!editorRef.current) return;

		try {
			const normalizedMarkdown = markdownContent.replace(/\r\n/g, "\n");
			const normalizedFind = diff.find.replace(/\r\n/g, "\n");

			const startIndex = normalizedMarkdown.indexOf(normalizedFind);
			if (startIndex === -1) {
				console.error("Diff not found in markdown content", { diff });
				return;
			}

			const getLineNumber = (text: string, index: number) => {
				const lines = text.slice(0, index).split("\n");
				return lines.length;
			};

			const startLine = getLineNumber(normalizedMarkdown, startIndex);
			const endLine = getLineNumber(
				normalizedMarkdown,
				startIndex + normalizedFind.length,
			);

			// Look for elements with data-line attributes that match our line range
			const allElements =
				editorRef.current.querySelectorAll<HTMLElement>("[data-line]");
			const elementsInRange: HTMLElement[] = [];

			for (const el of allElements) {
				const lineAttr = el.getAttribute("data-line");
				if (!lineAttr) continue;

				const elementLine = Number.parseInt(lineAttr, 10);
				if (elementLine >= startLine && elementLine <= endLine) {
					elementsInRange.push(el);
				}
			}

			// If no elements found with exact line match, try to find elements containing the diff text
			if (elementsInRange.length === 0) {
				const allTextElements = editorRef.current.querySelectorAll<HTMLElement>(
					"p, h1, h2, h3, h4, h5, h6, li, td, th",
				);
				for (const el of allTextElements) {
					if (el.textContent?.includes(normalizedFind.trim())) {
						elementsInRange.push(el);
						break; // Take the first match
					}
				}
			}

			if (elementsInRange.length === 0) {
				console.warn("No HTML elements match diff range", {
					startLine,
					endLine,
					diff,
				});
				// Fallback: insert at the end of the editor
				const diffContainer = buildDiffContainer(diff);

				editorRef.current.appendChild(diffContainer);
				diffContainer.scrollIntoView({ behavior: "smooth", block: "center" });
				return;
			}

			const rangeObj = window.document.createRange();
			rangeObj.setStartBefore(elementsInRange[0]);
			rangeObj.setEndAfter(elementsInRange[elementsInRange.length - 1]);

			const diffContainer = buildDiffContainer(diff);

			rangeObj.deleteContents();
			rangeObj.insertNode(diffContainer);
			diffContainer.scrollIntoView({ behavior: "smooth", block: "center" });
		} catch (error) {
			console.error("Failed to show diff inline:", error, { diff });
		}
	}, []);

	useEffect(() => {
		if (!reviewState || !editorRef.current) return;
		const { diffs, currentIndex, approvedDiffs, originalContent } = reviewState;
		let contentToRender = originalContent;
		for (const { find, replace } of approvedDiffs) {
			contentToRender = contentToRender.replace(find, replace);
		}
		editorRef.current.innerHTML = markdownToHtml(contentToRender);

		// Delay to ensure DOM updates before highlighting
		setTimeout(() => showDiffInline(diffs[currentIndex], contentToRender), 0);
	}, [reviewState, showDiffInline]);

	const handleApplyChanges = (diffs: EditDiff[]) => {
		if (!editorRef.current) return;
		setReviewState({
			diffs,
			currentIndex: 0,
			approvedDiffs: [],
			originalContent: content,
		});
	};

	const handleEdit = (
		selection: string,
		rect: DOMRect,
		range: Range,
		close: () => void,
	) => {
		const container = relativeContainerRef.current;
		if (!container || !editorRef.current) {
			return;
		}
		const containerRect = container.getBoundingClientRect();

		// Calculate cursor position if no text is selected
		let cursorPosition: number | undefined;
		if (!selection && range.collapsed) {
			try {
				cursorPosition = getCursorPosition(editorRef.current, range);
			} catch (error) {
				console.warn(
					"Failed to calculate cursor position in handleEdit:",
					error,
				);
				cursorPosition = undefined;
			}
		}

		const formattedSelection = formatSelectionWithContext(
			content,
			selection,
			cursorPosition,
			editorRef.current,
			range,
		);

		setInlineEdit({
			selection: formattedSelection,
			position: {
				top: rect.top - containerRect.top,
				left: 0,
			},
			range,
		});
		close();
		window.getSelection()?.removeAllRanges();
	};

	return (
		<div
			className={cn(
				// A query container, so the toolbar can respond to how wide the
				// canvas panel has been dragged rather than to the window. A
				// viewport breakpoint is the wrong instrument inside a resizable
				// dock: it reports 1440px while the panel is 400px.
				"@container relative flex h-full w-full flex-col overflow-hidden bg-surface",
			)}
		>
			{/*
			 * The toolbar.
			 *
			 * It used to be nineteen controls in six groups behind five dividers,
			 * on `flex-wrap`, which meant it silently became two rows at 720px and
			 * was two rows at every width the panel actually opens at. A toolbar
			 * that reflows is the "2010 word processor" tell, and the fix is not a
			 * smaller gap — it is deciding which controls are worth permanent
			 * space.
			 *
			 * Eight are: block type, bold, italic, the three list kinds, link, and
			 * the overflow. Undo and redo pin to the right, because they act on
			 * the document rather than on the selection and every drawing app from
			 * Figma to Sketch reads left-to-right as tools-then-history.
			 *
			 * The overflow holds eight: strikethrough, the three list kinds,
			 * quote, code block, image and table. The lists appear in both
			 * places deliberately - they are frequent enough to earn a permanent
			 * button and structural enough that someone hunting for "make this a
			 * list" opens the menu first. Everything else there is one click
			 * away, which is what Craft, Dropbox Paper and Linear's editor all
			 * do rather than showing every command at once.
			 *
			 * Underline and the three alignments are in neither place and on no
			 * shortcut: neither survives a markdown round trip, so the editor no
			 * longer offers a control whose effect the next save discards.
			 * Indent and outdent are off the toolbar for the same reason as a
			 * paragraph, but they keep Tab and Shift+Tab inside a list, where
			 * the command nests an item and the round trip is clean.
			 *
			 * `flex-nowrap`: at the panel's 400px minimum the bar must clip or
			 * stack, and it does neither, because the list group steps out at
			 * 520px and everything left fits inside 400.
			 */}
			<div
				className={cn(
					// Groups are 8px apart and members 4px apart — both tier-one
					// values from the 4px ramp, so the rhythm alone carries the
					// grouping and the five vertical rules that used to are gone.
					"flex h-10 shrink-0 flex-nowrap items-center gap-2",
					// `surface`, the document's own ground: the toolbar acts on what
					// is below it, so it belongs to the document rather than to the
					// panel chrome above. The hairline is what stops it reading as
					// content.
					"border-hairline border-b bg-surface px-2",
				)}
			>
				<TextStyleDropdown
					currentTextType={currentTextType}
					onTextTypeChange={handleTextTypeChange}
				/>

				{/* Character formatting */}
				<div className={cn("flex shrink-0 items-center gap-1")}>
					{PRIMARY_TEXT_FORMATS.map(({ value, label, Icon }) => {
						const isActive = selectedFormats.includes(value);
						return (
							<Tooltip key={value} content={label}>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={label}
									aria-pressed={isActive}
									onClick={() => handleFormatToggle(value)}
									className={cn(isActive && ACTIVE_TOGGLE_CLASS)}
								>
									<Icon />
								</Button>
							</Tooltip>
						);
					})}
				</div>

				{/*
				 * Lists. Hidden below a 520px *panel* — a container query, not a
				 * viewport one, because the canvas is a resizable dock and its
				 * width has nothing to do with the size of the window. They stay
				 * reachable in the overflow menu at every width, which is why the
				 * menu lists them too.
				 */}
				<div
					className={cn(
						"flex shrink-0 items-center gap-1",
						"@max-[520px]:hidden",
					)}
				>
					<Tooltip content="Bullet list">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Bullet list"
							onClick={() => toggleList("unordered")}
						>
							<List />
						</Button>
					</Tooltip>
					<Tooltip content="Numbered list">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Numbered list"
							onClick={() => toggleList("ordered")}
						>
							<ListOrdered />
						</Button>
					</Tooltip>
					<Tooltip content="Checklist">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Checklist"
							onClick={() => toggleList("task")}
						>
							<SquareCheckBig />
						</Button>
					</Tooltip>
				</div>

				<div className={cn("flex shrink-0 items-center gap-1")}>
					<Tooltip content="Insert link">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Insert link"
							onClick={insertLink}
						>
							<Link />
						</Button>
					</Tooltip>

					{/* Everything else, grouped the way the menu reads */}
					<DropdownMenu defaultOpen={initialFormatMenuOpen}>
						<Tooltip content="More formatting">
							<DropdownMenuTrigger asChild>
								<Button
									ref={overflowTriggerRef}
									variant="ghost"
									size="icon-sm"
									aria-label="More formatting"
								>
									<Ellipsis />
								</Button>
							</DropdownMenuTrigger>
						</Tooltip>
						{/* w-44 (176px), not w-52: the old width was sized for
						    "Underline (Ctrl+U)" and "Align center", and both are
						    gone. The widest surviving label is "Numbered list" at
						    106px, which with the icon column and padding needs
						    176px and left 42% of a 208px menu empty. */}
						<DropdownMenuContent align="start" className={cn("w-44")}>
							{OVERFLOW_TEXT_FORMATS.map(({ value, label, Icon }) => (
								<DropdownMenuItem
									key={value}
									onSelect={() => handleFormatToggle(value)}
								>
									<Icon aria-hidden="true" />
									{label}
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={() => toggleList("unordered")}>
								<List aria-hidden="true" />
								Bullet list
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => toggleList("ordered")}>
								<ListOrdered aria-hidden="true" />
								Numbered list
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => toggleList("task")}>
								<SquareCheckBig aria-hidden="true" />
								Checklist
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onSelect={() => toggleBlockFormat("blockquote")}
							>
								<Quote aria-hidden="true" />
								Quote
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => toggleBlockFormat("pre")}>
								<Code aria-hidden="true" />
								Code block
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={insertImage}>
								<Image aria-hidden="true" />
								Insert image
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => {
									// The menu item is gone by the time the popover mounts,
									// so the table grid hangs off the trigger that opened
									// the menu.
									if (overflowTriggerRef.current) {
										insertTable(overflowTriggerRef.current);
									}
								}}
							>
								<Table aria-hidden="true" />
								Insert table
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				{/* History: document-scoped, so it sits opposite the selection tools */}
				<div className={cn("ml-auto flex shrink-0 items-center gap-1")}>
					<Tooltip content="Undo (Ctrl+Z)">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Undo"
							onClick={() => {
								if (undoManagerRef.current?.canUndo()) {
									undoManagerRef.current.undo();
									// Update content state after undo
									if (editorRef.current) {
										const htmlContent = editorRef.current.innerHTML;
										const markdownContent = htmlToMarkdown(htmlContent);
										setContent(markdownContent);
										setHasUserChanges(true);
									}
									setCanUndo(undoManagerRef.current.canUndo());
									setCanRedo(undoManagerRef.current.canRedo());
								}
							}}
							disabled={!canUndo}
						>
							<Undo />
						</Button>
					</Tooltip>
					<Tooltip content="Redo (Ctrl+Shift+Z)">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Redo"
							onClick={() => {
								if (undoManagerRef.current?.canRedo()) {
									undoManagerRef.current.redo();
									// Update content state after redo
									if (editorRef.current) {
										const htmlContent = editorRef.current.innerHTML;
										const markdownContent = htmlToMarkdown(htmlContent);
										setContent(markdownContent);
										setHasUserChanges(true);
									}
									setCanUndo(undoManagerRef.current.canUndo());
									setCanRedo(undoManagerRef.current.canRedo());
								}
							}}
							disabled={!canRedo}
						>
							<Redo />
						</Button>
					</Tooltip>
				</div>
			</div>

			<div
				ref={editorContentRef}
				className={cn(
					// 24px at the panel's narrowest, 32px once there is room. The old
					// flat 32px took 64px of a 400px panel.
					"flex-1 overflow-y-auto bg-surface px-6 py-6 @min-[560px]:px-8 @min-[560px]:py-8",
					editorProseClasses,
				)}
			>
				{/*
				 * A measure, not a full-bleed column. Dragged wide the panel is
				 * 1200px, and 14px body text set across 1136px is about 140
				 * characters a line — unreadable in the way a document nobody
				 * measured always is. 640px lands at roughly 80.
				 */}
				<div
					className={cn("relative mx-auto w-full max-w-160")}
					ref={relativeContainerRef}
				>
					<div
						ref={editorRef}
						contentEditable={!reviewState}
						onInput={handleContentChange}
						onKeyDown={handleKeyDown}
						onClick={handleClick}
						onDoubleClick={handleDoubleClick}
						suppressContentEditableWarning
						onBlur={() => {
							if (inlineEdit) {
								selectionRef.current = inlineEdit.range;
							}
						}}
					/>
					{inlineEdit?.range && !reviewState && (
						<span
							aria-hidden
							className={cn(
								"pointer-events-none absolute rounded-xs bg-accent-wash",
							)}
							style={{
								left:
									inlineEdit.range.getBoundingClientRect().left -
									(relativeContainerRef.current?.getBoundingClientRect().left ??
										0),
								top:
									inlineEdit.range.getBoundingClientRect().top -
									(relativeContainerRef.current?.getBoundingClientRect().top ??
										0),
								width: inlineEdit.range.getBoundingClientRect().width,
								height: inlineEdit.range.getBoundingClientRect().height,
							}}
						/>
					)}
					<TextSelectionControls
						targetRef={editorRef}
						scrollableContainerRef={editorContentRef}
						showSpeech
						showCopy
						showEdit
						showRefer={!!document.path}
						onEdit={handleEdit}
						agentId={agentId ?? undefined}
						filePath={document.path}
						conversationId={conversationId}
					/>
					{inlineEdit && document.path && (
						<InlineEdit
							selection={inlineEdit.selection}
							position={inlineEdit.position}
							filePath={document.path}
							onClose={() => {
								setInlineEdit(null);
								selectionRef.current = null;
								if (reviewState) {
									handleFinalizeChanges(reviewState.approvedDiffs);
								}
							}}
							onApplyChanges={handleApplyChanges}
							agentId={agentId}
							reviewState={reviewState}
							onApplyAll={() => {
								if (!reviewState) return;
								handleFinalizeChanges(reviewState.diffs);
							}}
							onRejectAll={() => {
								if (!reviewState) return;
								handleFinalizeChanges([]);
							}}
							onAcceptDiff={() => {
								if (!reviewState) return;
								const currentDiff = reviewState.diffs[reviewState.currentIndex];
								const newApprovedDiffs = [
									...reviewState.approvedDiffs,
									currentDiff,
								];
								if (reviewState.currentIndex >= reviewState.diffs.length - 1) {
									handleFinalizeChanges(newApprovedDiffs);
								} else {
									setReviewState({
										...reviewState,
										approvedDiffs: newApprovedDiffs,
										currentIndex: reviewState.currentIndex + 1,
									});
								}
							}}
							onRejectDiff={() => {
								if (!reviewState) return;
								if (reviewState.currentIndex >= reviewState.diffs.length - 1) {
									handleFinalizeChanges(reviewState.approvedDiffs);
								} else {
									setReviewState({
										...reviewState,
										currentIndex: reviewState.currentIndex + 1,
									});
								}
							}}
							onNavigateDiff={(direction) => {
								if (!reviewState) return;
								const newIndex =
									direction === "next"
										? reviewState.currentIndex + 1
										: reviewState.currentIndex - 1;
								if (newIndex >= 0 && newIndex < reviewState.diffs.length) {
									setReviewState({ ...reviewState, currentIndex: newIndex });
								}
							}}
						/>
					)}
				</div>
			</div>
			<FindReplaceWidget
				show={showFindReplace}
				initialMode={findReplaceMode}
				onClose={() => {
					setShowFindReplace(false);
					clearHighlights();
					editorRef.current?.focus();
				}}
				onFind={handleFind}
				onNavigate={handleNavigate}
				onReplace={handleReplace}
				onReplaceAll={handleReplaceAll}
				matchCount={matchRanges.length}
				currentMatch={currentMatchIndex + 1}
				containerClassName="top-14 right-4"
				findValue={searchQuery}
				onFindValueChange={setSearchQuery}
			/>
			<InsertLinkDialog
				open={isLinkDialogOpen}
				onClose={() => setIsLinkDialogOpen(false)}
				onInsert={handleInsertLink}
				initialData={linkDialogData}
			/>
			<InsertImageDialog
				open={isImageDialogOpen}
				onClose={() => setIsImageDialogOpen(false)}
				onInsert={handleInsertImage}
			/>
			<InsertTablePopover
				anchorEl={tableAnchorEl}
				onClose={() => setTableAnchorEl(null)}
				onInsert={handleInsertTable}
			/>
		</div>
	);
};

/**
 * Custom comparison function for memoization that only checks properties
 * that actually affect the rendering of the editor component.
 * This prevents unnecessary re-renders when metadata like lastModified changes
 * but the actual document content and title remain the same.
 */
const arePropsEqual = (
	prevProps: WysiwygMarkdownEditorProps,
	nextProps: WysiwygMarkdownEditorProps,
): boolean => {
	// Check if conversationId or agentId changed
	if (
		prevProps.conversationId !== nextProps.conversationId ||
		prevProps.agentId !== nextProps.agentId
	) {
		return false;
	}

	// Check document properties that affect rendering
	const prevDoc = prevProps.document;
	const nextDoc = nextProps.document;

	// These are the only document properties that affect the editor rendering
	return (
		prevDoc.id === nextDoc.id &&
		prevDoc.title === nextDoc.title &&
		prevDoc.content === nextDoc.content &&
		prevDoc.path === nextDoc.path &&
		prevDoc.type === nextDoc.type &&
		prevDoc.lastAgentModified === nextDoc.lastAgentModified
	);
};

export const WysiwygMarkdownEditor = memo(
	WysiwygMarkdownEditorComponent,
	arePropsEqual,
);
