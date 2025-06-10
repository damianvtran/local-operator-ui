import { Box, useTheme, styled, alpha } from "@mui/material";
import { TextSelectionControls } from "@shared/components/common/text-selection-controls";
import { loadLanguageExtensions } from "@shared/utils/load-language-extensions";
import { basicDark, basicLight } from "@uiw/codemirror-theme-basic";
import { Decoration, ViewPlugin, type DecorationSet } from "@codemirror/view";
import CodeMirror, {
	type Extension,
	type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import {
	type FC,
	useCallback,
	useEffect,
	useState,
	useRef,
	useMemo,
} from "react";
import { useDebounce } from "../../../../shared/hooks/use-debounce";
import type { CanvasDocument } from "../../types/canvas";
import { InlineEdit } from "./inline-edit";

type CodeEditorProps = {
	/**
	 * The document to display
	 */
	document: CanvasDocument;
	editable?: boolean;
	onContentChange?: (content: string) => void;
	conversationId?: string;
	agentId?: string;
};

const CodeEditorContainer = styled(Box)(({ theme }) => ({
	flexGrow: 1,
	position: "relative",
	fontSize: theme.typography.pxToRem(12),
	overflow: "auto",
	height: "100%",

	"& > *": {
		height: "100%",
	},

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
}));

/**
 * Content component for the markdown canvas
 * Displays the markdown content with syntax highlighting
 */
export const CodeEditor: FC<CodeEditorProps> = ({
	document,
	editable = true,
	onContentChange,
	conversationId,
	agentId,
}) => {
	const [content, setContent] = useState(document.content);
	const [languageExtensions, setLanguageExtensions] = useState<Extension[]>([]);
	const debouncedContent = useDebounce(content, 1000);
	const [inlineEdit, setInlineEdit] = useState<{
		selection: string;
		position: { top: number; left: number };
		range: globalThis.Range | null;
		from: number;
		to: number;
	} | null>(null);
	const editorRef = useRef<ReactCodeMirrorRef>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	const theme = useTheme();

	useEffect(() => {
		setContent(document.content);
		const newLangExtension = loadLanguageExtensions(document.title);

		if (newLangExtension) {
			setLanguageExtensions([newLangExtension]);
		}
	}, [document]);

	useEffect(() => {
		if (
			editable &&
			debouncedContent !== document.content &&
			document.path &&
			window.api.saveFile
		) {
			window.api.saveFile(document.path, debouncedContent);
		}
	}, [debouncedContent, document.content, document.path, editable]);

	const handleContentChange = useCallback(
		(value: string) => {
			setContent(value);
			if (onContentChange) {
				onContentChange(value);
			}
		},
		[onContentChange],
	);

	const codeEditorTheme =
		theme.palette.mode === "light" ? basicLight : basicDark;

	const highlightPlugin = useMemo(() => {
		return ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;

				constructor() {
					this.decorations = Decoration.none;
				}

				update() {
					if (!inlineEdit) {
						this.decorations = Decoration.none;
						return;
					}
					const { from, to } = inlineEdit;
					const highlightMark = Decoration.mark({
						style: `background-color: ${alpha(
							theme.palette.primary.main,
							0.3,
						)}`,
					});
					this.decorations = Decoration.set([highlightMark.range(from, to)]);
				}
			},
		);
	}, [inlineEdit, theme.palette.primary.main]);

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "k") {
			event.preventDefault();
			const view = editorRef.current?.view;
			if (view) {
				const { from, to } = view.state.selection.main;
				const selection = view.state.doc.sliceString(from, to);
				const fullContent = view.state.doc.toString();
				
				// Format selection with context for the edit API
				const textBefore = fullContent.substring(0, from);
				const textAfter = fullContent.substring(to);
				
				// Truncate text before and after to 120 chars max with ellipsis
				const truncatedTextBefore = textBefore.length > 120 
					? `...${textBefore.slice(-120)}` 
					: textBefore;
				const truncatedTextAfter = textAfter.length > 120 
					? `${textAfter.slice(0, 120)}...` 
					: textAfter;
				
				const formattedSelection = `<text_before>${truncatedTextBefore}</text_before><selected_text>${selection}</selected_text><text_after>${truncatedTextAfter}</text_after>`;
				const rect = view.coordsAtPos(from);
				if (rect) {
					const container = scrollContainerRef.current;
					if (!container) return;
					const containerRect = container.getBoundingClientRect();
					const selectionRange = window.getSelection()?.getRangeAt(0);
					setInlineEdit({
						selection: formattedSelection,
						position: {
							top: Math.max(0, rect.bottom - containerRect.top),
							left: rect.left - containerRect.left,
						},
						range: selectionRange || null,
						from,
						to,
					});
				}
			}
		}
	};

	const handleApplyChanges = (newContent: string) => {
		const view = editorRef.current?.view;
		if (view && inlineEdit) {
			view.dispatch({
				changes: { from: inlineEdit.from, to: inlineEdit.to, insert: newContent },
			});
		}
		setInlineEdit(null);
	};

	const handleEdit = (
		selection: string,
		rect: DOMRect,
		range: globalThis.Range,
		close: () => void,
	) => {
		const container = scrollContainerRef.current;
		if (!container) return;
		const containerRect = container.getBoundingClientRect();
		const view = editorRef.current?.view;
		if (view) {
			const { from, to } = view.state.selection.main;
			setInlineEdit({
				selection,
				position: {
					top: rect.bottom - containerRect.top,
					left: rect.left - containerRect.left,
				},
				range,
				from,
				to,
			});
			close();
		}
	};

	return (
		<CodeEditorContainer onKeyDown={handleKeyDown} ref={scrollContainerRef}>
			<CodeMirror
				value={content}
				height="100%"
				theme={codeEditorTheme}
				editable={editable}
				extensions={[...languageExtensions, highlightPlugin]}
				onChange={handleContentChange}
				ref={editorRef}
			/>
			<TextSelectionControls
				targetRef={editorRef as React.RefObject<HTMLElement>}
				scrollableContainerRef={scrollContainerRef}
				showSpeech
				showCopy
				showEdit
				onEdit={handleEdit}
				conversationId={conversationId}
				agentId={agentId ?? undefined}
			/>
			{inlineEdit && document.path && (
				<InlineEdit
					selection={inlineEdit.selection}
					position={inlineEdit.position}
					filePath={document.path}
					onClose={() => setInlineEdit(null)}
					onApplyChanges={handleApplyChanges}
				/>
			)}
		</CodeEditorContainer>
	);
};
