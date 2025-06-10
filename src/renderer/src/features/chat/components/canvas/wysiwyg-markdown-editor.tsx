import {
	Box,
	Toolbar,
	IconButton,
	Divider,
	Tooltip,
	ToggleButton,
	ToggleButtonGroup,
	Paper,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import {
	AlignLeft,
	AlignCenter,
	AlignRight,
	Bold,
	Code,
	Image,
	Italic,
	Link,
	List,
	ListOrdered,
	Quote,
	Redo,
	Strikethrough,
	Table,
	Underline,
	Undo,
} from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDebounce } from "@shared/hooks/use-debounce";
import { useCanvasStore } from "@shared/store/canvas-store";
import { showSuccessToast } from "@shared/utils/toast-manager";
import type { CanvasDocument } from "../../types/canvas";
import { markdownToHtml, htmlToMarkdown } from "@features/chat/components/canvas/wysiwyg-utils";
import { TextSelectionControls } from "@shared/components/common/text-selection-controls";
import { InlineEdit } from "./inline-edit";
import { InsertImageDialog } from "./wysiwyg/insert-image-dialog";
import type { LinkDialogData } from "./wysiwyg/insert-link-dialog";
import { InsertLinkDialog } from "./wysiwyg/insert-link-dialog";
import { InsertTablePopover } from "./wysiwyg/insert-table-popover";
import { TextStyleDropdown } from "./wysiwyg/text-style-dropdown";

/**
 * Calculates the cursor position within the text content of a contentEditable element
 */
const getCursorPosition = (editorElement: HTMLElement, range: Range): number => {
	// Create a range from the start of the editor to the cursor position
	const preCaretRange = document.createRange();
	preCaretRange.selectNodeContents(editorElement);
	preCaretRange.setEnd(range.startContainer, range.startOffset);
	
	// Get the text content up to the cursor position
	const textBeforeCursor = preCaretRange.toString();
	return textBeforeCursor.length;
};

/**
 * Formats selection with context for the edit API
 */
const formatSelectionWithContext = (fullContent: string, selectedText: string, cursorPosition?: number): string => {

	if (selectedText) {
		// Find the position of the selected text in the full content
		const selectionStart = fullContent.indexOf(selectedText);
		if (selectionStart === -1) {
			// Fallback if we can't find the selection
			return `<text_before></text_before><selected_text>${selectedText}</selected_text><text_after></text_after>`;
		}
		
		const textBefore = fullContent.substring(0, selectionStart);
		const textAfter = fullContent.substring(selectionStart + selectedText.length);

		// Truncate text before and after to 120 chars max with ellipsis
		const truncatedTextBefore = textBefore.length > 120 
			? `...${textBefore.slice(-120)}` 
			: textBefore;
		const truncatedTextAfter = textAfter.length > 120 
			? `${textAfter.slice(0, 120)}...` 
			: textAfter;
		
		return `<text_before>${truncatedTextBefore}</text_before><selected_text>${selectedText}</selected_text><text_after>${truncatedTextAfter}</text_after>`;
	}
	
	if (cursorPosition !== undefined && cursorPosition >= 0) {
		// Empty selection at cursor position
		const textBefore = fullContent.substring(0, cursorPosition);
		const textAfter = fullContent.substring(cursorPosition);
		
		// Truncate text before and after to 120 chars max with ellipsis
		const truncatedTextBefore = textBefore.length > 120 
			? `...${textBefore.slice(-120)}` 
			: textBefore;
		const truncatedTextAfter = textAfter.length > 120 
			? `${textAfter.slice(0, 120)}...` 
			: textAfter;
		
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
	padding: "0 8px",
	borderBottom: `1px solid ${theme.palette.divider}`,
	backgroundColor: theme.palette.background.default,
	gap: "4px",
	flexWrap: "wrap",
}));

const EditorContent = styled(Box)(({ theme }) => ({
	flex: 1,
	padding: "16px",
	overflowY: "auto",
	backgroundColor: theme.palette.background.paper,
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor:
			theme.palette.mode === "dark"
				? "rgba(255, 255, 255, 0.1)"
				: "rgba(0, 0, 0, 0.2)",
		borderRadius: "4px",
	},
	"& [contenteditable]": {
		outline: "none",
		minHeight: "200px",
		lineHeight: 1.6,
		fontSize: "1rem",
		color: theme.palette.text.primary,
		fontFamily: theme.typography.fontFamily,
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
		backgroundColor: theme.palette.action.hover,
		padding: "2px 4px",
		borderRadius: "4px",
		fontFamily: '"Roboto Mono", monospace',
		fontSize: "0.9em",
	},
	"& pre": {
		backgroundColor: theme.palette.action.hover,
		padding: "12px",
		borderRadius: "8px",
		overflow: "auto",
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
	width: "32px",
	height: "32px",
	padding: "4px",
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
export const WysiwygMarkdownEditor: FC<WysiwygMarkdownEditorProps> = ({
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
	const [linkDialogData, setLinkDialogData] = useState<LinkDialogData>({ url: "", text: "" });
	const [isImageDialogOpen, setIsImageDialogOpen] = useState(false);
	const [tableAnchorEl, setTableAnchorEl] = useState<HTMLElement | null>(null);
	const [inlineEdit, setInlineEdit] = useState<{
		selection: string;
		position: { top: number; left: number };
		range: Range | null;
	} | null>(null);
	const selectionRef = useRef<Range | null>(null);
	const editorContentRef = useRef<HTMLDivElement>(null);
	const relativeContainerRef = useRef<HTMLDivElement>(null);

	const debouncedContent = useDebounce(content, 1000);
	const editorRef = useRef<HTMLDivElement>(null);
	const originalContentRef = useRef(document.content);
	const isInitialLoadRef = useRef(true);
	const isMounted = useRef(false);

	const { setFiles } = useCanvasStore();
	const canvasState = useCanvasStore((state) =>
		conversationId ? state.conversations[conversationId] : undefined,
	);

	const updateCurrentTextType = useCallback(() => {
		const selection = window.getSelection();
		if (!selection?.rangeCount) return;

		const range = selection.getRangeAt(0);
		let element: Node | null = range.startContainer;
		
		if (element.nodeType === Node.TEXT_NODE && element.parentElement) {
			element = element.parentElement;
		}

		while (element && element !== editorRef.current && element instanceof Element) {
			const tagName = element.tagName?.toLowerCase();
			if (tagName && ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
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

	// Initialize editor content from markdown
	useEffect(() => {
		if (
			editorRef.current &&
			(!isMounted.current || document.content !== originalContentRef.current)
		) {
			isMounted.current = true;
			const htmlContent = markdownToHtml(document.content);
			editorRef.current.innerHTML = htmlContent;
			setContent(document.content);
			setHasUserChanges(false);
			originalContentRef.current = document.content;
			isInitialLoadRef.current = true;
		}
	}, [document.content]);

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
				const updatedFiles = canvasState.files.map((file) =>
					file.id === document.id
						? { ...file, content: debouncedContent }
						: file,
				);
				setFiles(conversationId, updatedFiles);
			}
		}
	}, [
		debouncedContent,
		hasUserChanges,
		document.path,
		document.id,
		conversationId,
		canvasState,
		setFiles,
	]);

	const handleSelectionChange = useCallback(() => {
		updateCurrentTextType();
		updateSelectedFormats();
	}, [updateCurrentTextType, updateSelectedFormats]);

	useEffect(() => {
		const handleSelection = () => {
			handleSelectionChange();
		};

		window.document.addEventListener("selectionchange", handleSelection);

		return () => {
			window.document.removeEventListener("selectionchange", handleSelection);
		};
	}, [handleSelectionChange]);

	// Execute formatting command
	const executeCommand = useCallback((command: string, value?: string) => {
		window.document.execCommand(command, false, value);
		handleContentChange();
		editorRef.current?.focus();
	}, [handleContentChange]);

	// Handle text type change
	const handleTextTypeChange = useCallback((type: TextType) => {
		if (type === "paragraph") {
			executeCommand('formatBlock', 'p');
		} else {
			executeCommand('formatBlock', type);
		}
		setCurrentTextType(type);
	}, [executeCommand]);

	const toggleBlockFormat = useCallback((format: "blockquote" | "pre") => {
		const selection = window.getSelection();
		if (!selection?.rangeCount) return;

		let element: Node | null = selection.getRangeAt(0).startContainer;
		if (element.nodeType === Node.TEXT_NODE) {
			element = element.parentElement;
		}

		let isFormatted = false;
		while (element && element !== editorRef.current) {
			if (element instanceof HTMLElement && element.tagName.toLowerCase() === format) {
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
	}, [executeCommand]);

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

	const handleInsertLink = useCallback((url: string, text: string) => {
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
	}, [executeCommand, handleContentChange]);

	// Insert image
	const insertImage = useCallback(() => {
		setIsImageDialogOpen(true);
	}, []);

	const handleInsertImage = useCallback((url: string) => {
		if (url) {
			executeCommand('insertImage', url);
		}
	}, [executeCommand]);

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

	// Handle keyboard shortcuts
	const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
		if (event.metaKey || event.ctrlKey) {
			switch (event.key) {
				case 'b':
					event.preventDefault();
					handleFormatToggle('bold');
					break;
				case 'i':
					event.preventDefault();
					handleFormatToggle('italic');
					break;
				case 'u':
					event.preventDefault();
					handleFormatToggle('underline');
					break;
				case 'k': {
					event.preventDefault();
					const selection = window.getSelection();
					if (selection && selection.rangeCount > 0 && editorRef.current) {
						const range = selection.getRangeAt(0).cloneRange();
						const rect = range.getBoundingClientRect();
						const container = relativeContainerRef.current;
						if (!container) {
							break;
						}
						const containerRect = container.getBoundingClientRect();
						
						// Get cursor position for empty selections
						let cursorPosition: number | undefined;
						if (selection.isCollapsed) {
							try {
								cursorPosition = getCursorPosition(editorRef.current, range);
							} catch (error) {
								console.warn('Failed to calculate cursor position:', error);
								cursorPosition = undefined;
							}
						}
						
						const selectedText = selection.toString();
						const formattedSelection = formatSelectionWithContext(content, selectedText, cursorPosition);

						setInlineEdit({
							selection: formattedSelection,
							position: {
								top: rect.top - containerRect.top,
								left: rect.left - containerRect.left,
							},
							range,
						});
						selection.removeAllRanges();
					}
					break;
				}
				case 'z':
					if (event.shiftKey) {
						event.preventDefault();
						executeCommand('redo');
					} else {
						event.preventDefault();
						executeCommand('undo');
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
				while (element && element !== editorRef.current && element instanceof Element) {
					if (element.tagName === 'LI') {
						// If the list item is empty, break out of the list
						if (element.textContent?.trim() === '') {
							event.preventDefault();
							executeCommand('outdent');
							executeCommand('formatBlock', 'p');
						}
						break;
					}
					element = element.parentElement;
				}
			}
		}
	}, [handleFormatToggle, executeCommand, content]);

	const handleApplyChanges = (newContent: string) => {
		if (editorRef.current && selectionRef.current) {
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(selectionRef.current);
			executeCommand("insertHTML", markdownToHtml(newContent));
			handleContentChange();
		}
		setInlineEdit(null);
		selectionRef.current = null;
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
				console.warn('Failed to calculate cursor position in handleEdit:', error);
				cursorPosition = undefined;
			}
		}
		
		const formattedSelection = formatSelectionWithContext(content, selection, cursorPosition);

		setInlineEdit({
			selection: formattedSelection,
			position: {
				top: rect.top - containerRect.top,
				left: rect.left - containerRect.left,
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
						onClick={() => handleFormatToggle('bold')}
						size="small"
					>
						<Tooltip title="Bold (Ctrl+B)">
							<Bold size={16} />
						</Tooltip>
					</ToggleButton>
					<ToggleButton
						value="italic"
						onClick={() => handleFormatToggle('italic')}
						size="small"
					>
						<Tooltip title="Italic (Ctrl+I)">
							<Italic size={16} />
						</Tooltip>
					</ToggleButton>
					<ToggleButton
						value="underline"
						onClick={() => handleFormatToggle('underline')}
						size="small"
					>
						<Tooltip title="Underline (Ctrl+U)">
							<Underline size={16} />
						</Tooltip>
					</ToggleButton>
					<ToggleButton
						value="strikethrough"
						onClick={() => handleFormatToggle('strikethrough')}
						size="small"
					>
						<Tooltip title="Strikethrough">
							<Strikethrough size={16} />
						</Tooltip>
					</ToggleButton>
				</ToggleButtonGroup>

				<ToolbarDivider orientation="vertical" />

				{/* Lists and Quotes */}
				<Tooltip title="Bullet List">
					<ToolbarButton onClick={() => executeCommand('insertUnorderedList')}>
						<List size={16} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Numbered List">
					<ToolbarButton onClick={() => executeCommand('insertOrderedList')}>
						<ListOrdered size={16} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Quote">
					<ToolbarButton
						onClick={() => toggleBlockFormat("blockquote")}
					>
						<Quote size={16} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Code Block">
					<ToolbarButton onClick={() => toggleBlockFormat("pre")}>
						<Code size={16} />
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
							<AlignLeft size={16} />
						</Tooltip>
					</ToggleButton>
					<ToggleButton value="center" size="small">
						<Tooltip title="Align Center">
							<AlignCenter size={16} />
						</Tooltip>
					</ToggleButton>
					<ToggleButton value="right" size="small">
						<Tooltip title="Align Right">
							<AlignRight size={16} />
						</Tooltip>
					</ToggleButton>
				</ToggleButtonGroup>

				<ToolbarDivider orientation="vertical" />

				{/* Insert Elements */}
				<Tooltip title="Insert Link">
					<ToolbarButton onClick={insertLink}>
						<Link size={16} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Insert Image">
					<ToolbarButton onClick={insertImage}>
						<Image size={16} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Insert Table">
					<ToolbarButton onClick={insertTable}>
						<Table size={16} />
					</ToolbarButton>
				</Tooltip>

				<ToolbarDivider orientation="vertical" />

				{/* Undo/Redo */}
				<Tooltip title="Undo (Ctrl+Z)">
					<ToolbarButton onClick={() => executeCommand('undo')}>
						<Undo size={16} />
					</ToolbarButton>
				</Tooltip>
				<Tooltip title="Redo (Ctrl+Shift+Z)">
					<ToolbarButton onClick={() => executeCommand('redo')}>
						<Redo size={16} />
					</ToolbarButton>
				</Tooltip>
			</EditorToolbar>

			<EditorContent ref={editorContentRef}>
				<Box sx={{ position: "relative" }} ref={relativeContainerRef}>
					<div
						ref={editorRef}
						contentEditable
						onInput={handleContentChange}
						onKeyDown={handleKeyDown}
						suppressContentEditableWarning
						onBlur={() => {
							if (inlineEdit) {
								selectionRef.current = inlineEdit.range;
							}
						}}
					/>
					{inlineEdit?.range && (
						<SelectionHighlight
							style={{
								position: "absolute",
								left:
									inlineEdit.range.getBoundingClientRect().left -
									(relativeContainerRef.current?.getBoundingClientRect().left ??
										0),
								top:
									inlineEdit.range.getBoundingClientRect().top -
									(relativeContainerRef.current?.getBoundingClientRect().top ?? 0),
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
						onEdit={handleEdit}
						agentId={agentId ?? undefined}
					/>
					{inlineEdit && document.path && (
						<InlineEdit
							selection={inlineEdit.selection}
							position={inlineEdit.position}
							filePath={document.path}
							onClose={() => {
								setInlineEdit(null);
								selectionRef.current = null;
							}}
							onApplyChanges={handleApplyChanges}
						/>
					)}
				</Box>
			</EditorContent>
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
