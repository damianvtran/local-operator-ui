import {
	htmlToMarkdown,
	markdownToHtml,
} from "@features/chat/components/canvas/wysiwyg-utils";
import {
	Box,
	Divider,
	IconButton,
	Paper,
	ToggleButton,
	ToggleButtonGroup,
	Toolbar,
	Tooltip,
} from "@mui/material";
import { alpha, styled } from "@mui/material/styles";
import type { EditDiff } from "@shared/api/local-operator/types";
import { FindReplaceWidget } from "@shared/components/common/find-replace-widget";
import { TextSelectionControls } from "@shared/components/common/text-selection-controls";
import { useDebounce } from "@shared/hooks/use-debounce";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import type { UndoManager } from "@shared/lib/undo-manager";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUndoManagerStore } from "@shared/store/undo-manager-store";
import { showSuccessToast } from "@shared/utils/toast-manager";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	Bold,
	Code,
	Image,
	Indent,
	Italic,
	Link,
	List,
	ListOrdered,
	Outdent,
	Quote,
	Redo,
	Strikethrough,
	Table,
	Underline,
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
};

const SelectionHighlight = styled("span")(({ theme }) => ({
	backgroundColor: theme.palette.action.hover,
	borderRadius: "2px",
}));

const EditorContainer = styled(Paper)(({ theme }) => ({
	position: "relative",
	display: "flex",
	flexDirection: "column",
	height: "100%",
	width: "100%",
	overflow: "hidden",
	backgroundColor: theme.palette.background.paper,
	border: `1px solid ${theme.palette.divider}`,
}));

const EditorToolbar = styled(Toolbar)(({ theme }) => ({
	minHeight: "48px !important",
	padding: "4px 8px",
	borderBottom: `1px solid ${theme.palette.divider}`,
	backgroundColor: theme.palette.background.default,
	gap: "2px",
	flexWrap: "wrap",
}));

const EditorContent = styled(Box)(({ theme }) => ({
	flex: 1,
	padding: "32px",
	overflowY: "auto",
	backgroundColor: theme.palette.background.paper,
	"& [contenteditable]": {
		outline: "none",
		minHeight: "200px",
		lineHeight: 1.6,
		fontSize: "1rem",
		color: theme.palette.text.primary,
		fontFamily: theme.typography.fontFamily,
	},
	"&::highlight(find-highlight)": {
		backgroundColor: "yellow",
		color: "black",
	},
	"&::highlight(current-find-highlight)": {
		backgroundColor: "orange",
		color: "black",
	},
	"& h1, & h2, & h3, & h4, & h5, & h6": {
		margin: "16px 0 8px 0",
		fontWeight: 600,
		"&:first-child": {
			marginTop: 0,
		},
	},
	"& h1": {
		fontSize: "1.5rem",
		borderBottom: `1px solid ${theme.palette.divider}`,
		paddingBottom: "8px",
	},
	"& h2": {
		fontSize: "1.3rem",
	},
	"& h3": {
		fontSize: "1.1rem",
	},
	"& p": {
		margin: "8px 0",
		"&:first-child": {
			marginTop: 0,
		},
		"&:last-child": {
			marginBottom: 0,
		},
	},
	"& ul, & ol": {
		paddingLeft: "24px",
		margin: "8px 0",
	},
	"& li": {
		margin: "4px 0",
	},
	"& blockquote": {
		borderLeft: `4px solid ${theme.palette.primary.main}`,
		paddingLeft: "16px",
		margin: "16px 0",
		fontStyle: "italic",
		backgroundColor: theme.palette.action.hover,
		borderRadius: "0 4px 4px 0",
		padding: "8px 16px",
	},
	"& code": {
		backgroundImage: "none",
		padding: "2px 2px",
		borderRadius: "4px",
		fontFamily: '"Geist Mono", "Roboto Mono", monospace',
		letterSpacing: "0.05em",
		fontSize: "0.8em",
	},
	"& pre": {
		backgroundColor: alpha(theme.palette.action.hover, 0.02),
		backgroundImage: "none",
		padding: "12px",
		borderRadius: "8px",
		overflow: "auto",
		border: `1px solid ${theme.palette.divider}`,
		margin: "12px 0",
		"& code": {
			backgroundColor: "transparent",
			padding: 0,
		},
	},
	"& table": {
		borderCollapse: "collapse",
		width: "100%",
		margin: "16px 0",
		border: `1px solid ${theme.palette.divider}`,
	},
	"& th, & td": {
		border: `1px solid ${theme.palette.divider}`,
		padding: "8px 12px",
		textAlign: "left",
	},
	"& th": {
		backgroundColor: theme.palette.action.hover,
		fontWeight: 600,
	},
	"& a": {
		color: theme.palette.primary.main,
		textDecoration: "underline",
		"&:hover": {
			color: theme.palette.primary.dark,
		},
	},
	"& img": {
		maxWidth: "100%",
		height: "auto",
		borderRadius: "4px",
		margin: "8px 0",
	},
}));

const ToolbarButton = styled(IconButton)(({ theme }) => ({
	width: "30px",
	height: "30px",
	padding: "2px",
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
	},
}));

const ToolbarDivider = styled(Divider)({
	height: "24px",
	margin: "0 4px",
});

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
}) => {
	const [content, setContent] = useState(document.content);
	const [hasUserChanges, setHasUserChanges] = useState(false);
	const [currentTextType, setCurrentTextType] = useState<TextType>("paragraph");
	const [selectedFormats, setSelectedFormats] = useState<string[]>([]);
	const [currentAlignment, setCurrentAlignment] = useState("left");
	const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
	const [linkDialogData, setLinkDialogData] = useState<LinkDialogData>({
		url: "",
		text: "",
	});
	const [isImageDialogOpen, setIsImageDialogOpen] = useState(false);
	const [tableAnchorEl, setTableAnchorEl] = useState<HTMLElement | null>(null);
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
		showSuccessToast("File saved successfully");
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
		if (window.document.queryCommandState("underline"))
			formats.push("underline");
		if (window.document.queryCommandState("strikeThrough"))
			formats.push("strikethrough");

		setSelectedFormats(formats);

		if (window.document.queryCommandState("justifyCenter")) {
			setCurrentAlignment("center");
		} else if (window.document.queryCommandState("justifyRight")) {
			setCurrentAlignment("right");
		} else {
			setCurrentAlignment("left");
		}
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
						highlightSpan.style.backgroundColor = isCurrent
							? "orange"
							: "yellow";
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
						highlight.style.backgroundColor =
							i === newIndex ? "orange" : "yellow";
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
			showSuccessToast("File saved successfully");
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
				case "underline":
					executeCommand("underline");
					break;
				case "strikethrough":
					executeCommand("strikeThrough");
					break;
			}
		},
		[executeCommand],
	);

	const handleAlignmentChange = useCallback(
		(_: React.MouseEvent<HTMLElement>, newAlignment: string | null) => {
			if (newAlignment) {
				const commandMap: { [key: string]: string } = {
					left: "justifyLeft",
					center: "justifyCenter",
					right: "justifyRight",
				};
				executeCommand(commandMap[newAlignment]);
				setCurrentAlignment(newAlignment);
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
		setIsImageDialogOpen(true);
	}, []);

	const handleInsertImage = useCallback(
		(url: string) => {
			if (url) {
				executeCommand("insertImage", url);
			}
		},
		[executeCommand],
	);

	// Insert table
	const insertTable = useCallback((event: React.MouseEvent<HTMLElement>) => {
		const selection = window.getSelection();
		if (selection?.rangeCount) {
			selectionRef.current = selection.getRangeAt(0).cloneRange();
		}
		setTableAnchorEl(event.currentTarget);
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

	// Handle keyboard shortcuts
	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (event.key === "Tab") {
				event.preventDefault();
				if (event.shiftKey) {
					executeCommand("outdent");
				} else {
					executeCommand("indent");
				}
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
					case "u":
						event.preventDefault();
						handleFormatToggle("underline");
						break;
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
				if (selection?.rangeCount) {
					const range = selection.getRangeAt(0);
					let element: Node | null = range.startContainer;

					if (element.nodeType === Node.TEXT_NODE && element.parentElement) {
						element = element.parentElement;
					}

					// Check if we're in a list item
					while (
						element &&
						element !== editorRef.current &&
						element instanceof Element
					) {
						if (element.tagName === "LI") {
							// If the list item is empty, break out of the list
							if (element.textContent?.trim() === "") {
								event.preventDefault();
								executeCommand("outdent");
								executeCommand("formatBlock", "p");
							}
							break;
						}
						element = element.parentElement;
					}
				}
			}
		},
		[handleFormatToggle, executeCommand, content, handleManualSave],
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
			showSuccessToast("File saved successfully");
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
				const diffContainer = window.document.createElement("div");
				diffContainer.setAttribute("data-diff-container", "true");
				diffContainer.contentEditable = "false";
				diffContainer.style.border = "2px solid #ccc";
				diffContainer.style.margin = "10px 0";
				diffContainer.style.padding = "10px";

				const oldDiv = window.document.createElement("div");
				oldDiv.innerHTML = markdownToHtml(diff.find);
				oldDiv.style.backgroundColor = "rgba(255, 0, 0, 0.1)";
				oldDiv.style.marginBottom = "5px";
				diffContainer.appendChild(oldDiv);

				const newDiv = window.document.createElement("div");
				newDiv.innerHTML = markdownToHtml(diff.replace);
				newDiv.style.backgroundColor = "rgba(0, 255, 0, 0.1)";
				diffContainer.appendChild(newDiv);

				editorRef.current.appendChild(diffContainer);
				diffContainer.scrollIntoView({ behavior: "smooth", block: "center" });
				return;
			}

			const rangeObj = window.document.createRange();
			rangeObj.setStartBefore(elementsInRange[0]);
			rangeObj.setEndAfter(elementsInRange[elementsInRange.length - 1]);

			const diffContainer = window.document.createElement("div");
			diffContainer.setAttribute("data-diff-container", "true");
			diffContainer.contentEditable = "false";

			const oldDiv = window.document.createElement("div");
			oldDiv.innerHTML = markdownToHtml(diff.find);
			oldDiv.style.backgroundColor = "rgba(255, 0, 0, 0.1)";
			diffContainer.appendChild(oldDiv);

			const newDiv = window.document.createElement("div");
			newDiv.innerHTML = markdownToHtml(diff.replace);
			newDiv.style.backgroundColor = "rgba(0, 255, 0, 0.1)";
			diffContainer.appendChild(newDiv);

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
		<EditorContainer elevation={1}>
			<EditorToolbar>
				{/* Text Type Selector */}
				<TextStyleDropdown
					currentTextType={currentTextType}
					onTextTypeChange={handleTextTypeChange}
				/>

				<ToolbarDivider orientation="vertical" />

				{/* Text Formatting */}
				<ToggleButtonGroup
					value={selectedFormats}
					onChange={(_, formats) => setSelectedFormats(formats)}
					size="small"
				>
					<ToggleButton
						value="bold"
						onClick={() => handleFormatToggle("bold")}
						size="small"
					>
						<Tooltip title="Bold (Ctrl+B)">
							<Bold size={14} />
						</Tooltip>
					</ToggleButton>
					<ToggleButton
						value="italic"
						onClick={() => handleFormatToggle("italic")}
						size="small"
					>
						<Tooltip title="Italic (Ctrl+I)">
							<Italic size={14} />
						</Tooltip>
					</ToggleButton>
					<ToggleButton
						value="underline"
						onClick={() => handleFormatToggle("underline")}
						size="small"
					>
						<Tooltip title="Underline (Ctrl+U)">
							<Underline size={14} />
						</Tooltip>
					</ToggleButton>
					<ToggleButton
						value="strikethrough"
						onClick={() => handleFormatToggle("strikethrough")}
						size="small"
					>
						<Tooltip title="Strikethrough">
							<Strikethrough size={14} />
						</Tooltip>
					</ToggleButton>
				</ToggleButtonGroup>

				<ToolbarDivider orientation="vertical" />

				{/* Lists and Quotes */}
				<Tooltip title="Bullet List">
					<ToolbarButton onClick={() => executeCommand("insertUnorderedList")}>
						<List size={14} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Numbered List">
					<ToolbarButton onClick={() => executeCommand("insertOrderedList")}>
						<ListOrdered size={14} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Indent">
					<ToolbarButton onClick={() => executeCommand("indent")}>
						<Indent size={14} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Outdent">
					<ToolbarButton onClick={() => executeCommand("outdent")}>
						<Outdent size={14} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Quote">
					<ToolbarButton onClick={() => toggleBlockFormat("blockquote")}>
						<Quote size={14} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Code Block">
					<ToolbarButton onClick={() => toggleBlockFormat("pre")}>
						<Code size={14} />
					</ToolbarButton>
				</Tooltip>

				<ToolbarDivider orientation="vertical" />

				<ToggleButtonGroup
					value={currentAlignment}
					exclusive
					onChange={handleAlignmentChange}
					size="small"
				>
					<ToggleButton value="left" size="small">
						<Tooltip title="Align Left">
							<AlignLeft size={14} />
						</Tooltip>
					</ToggleButton>
					<ToggleButton value="center" size="small">
						<Tooltip title="Align Center">
							<AlignCenter size={14} />
						</Tooltip>
					</ToggleButton>
					<ToggleButton value="right" size="small">
						<Tooltip title="Align Right">
							<AlignRight size={14} />
						</Tooltip>
					</ToggleButton>
				</ToggleButtonGroup>

				<ToolbarDivider orientation="vertical" />

				{/* Insert Elements */}
				<Tooltip title="Insert Link">
					<ToolbarButton onClick={insertLink}>
						<Link size={14} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Insert Image">
					<ToolbarButton onClick={insertImage}>
						<Image size={14} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Insert Table">
					<ToolbarButton onClick={insertTable}>
						<Table size={14} />
					</ToolbarButton>
				</Tooltip>

				<ToolbarDivider orientation="vertical" />

				{/* Undo/Redo */}
				<Tooltip title="Undo (Ctrl+Z)">
					<ToolbarButton
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
						<Undo size={14} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Redo (Ctrl+Shift+Z)">
					<ToolbarButton
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
						<Redo size={14} />
					</ToolbarButton>
				</Tooltip>
			</EditorToolbar>

			<EditorContent ref={editorContentRef}>
				<Box sx={{ position: "relative" }} ref={relativeContainerRef}>
					<div
						ref={editorRef}
						contentEditable={!reviewState}
						onInput={handleContentChange}
						onKeyDown={handleKeyDown}
						onDoubleClick={handleDoubleClick}
						suppressContentEditableWarning
						onBlur={() => {
							if (inlineEdit) {
								selectionRef.current = inlineEdit.range;
							}
						}}
					/>
					{inlineEdit?.range && !reviewState && (
						<SelectionHighlight
							style={{
								position: "absolute",
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
						/>
					)}
				</Box>
			</EditorContent>
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
				containerSx={{ top: "56px", right: "16px" }}
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
		</EditorContainer>
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
