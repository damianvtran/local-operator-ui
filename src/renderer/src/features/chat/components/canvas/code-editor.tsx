import { Box, useTheme, styled, alpha } from "@mui/material";
import { search, searchKeymap } from "@codemirror/search";
import { TextSelectionControls } from "@shared/components/common/text-selection-controls";
import { getSearchTheme } from "@shared/themes/search-theme";
import { loadLanguageExtensions } from "@shared/utils/load-language-extensions";
import { Decoration, ViewPlugin, type DecorationSet, keymap } from "@codemirror/view";
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
	memo,
} from "react";
import { useDebouncedValue } from "../../../../shared/hooks/use-debounced-value";
import { useCanvasStore } from "../../../../shared/store/canvas-store";
import { getCodeMirrorTheme } from "../../../../shared/themes/code-mirror-theme";
import type { CanvasDocument } from "../../types/canvas";
import { InlineEdit } from "./inline-edit";
import type { EditDiff } from "@shared/api/local-operator/types";

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
	overflow: "auto",
	height: "100%",
	fontSize: theme.typography.pxToRem(13),
	fontFamily: "'Geist Mono', monospace",

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
const CodeEditorComponent: FC<CodeEditorProps> = ({
	document,
	editable = true,
	onContentChange,
	conversationId,
	agentId,
}) => {
	const [content, setContent] = useState(document.content);
	const [hasUserChanges, setHasUserChanges] = useState(false);
	const originalContentRef = useRef(document.content);
	const isInitialLoadRef = useRef(true);
	const { setFiles } = useCanvasStore();
	const canvasState = useCanvasStore((state) =>
		conversationId ? state.conversations[conversationId] : undefined,
	);
	const [languageExtensions, setLanguageExtensions] = useState<Extension[]>([]);
	const debouncedContent = useDebouncedValue(content, 1000);
	const [inlineEdit, setInlineEdit] = useState<{
		selection: string;
		position: { top: number; left: number };
		range: globalThis.Range | null;
		from: number;
		to: number;
	} | null>(null);
	const editorRef = useRef<ReactCodeMirrorRef>(null);
	const [editorContainer, setEditorContainer] = useState<HTMLElement | null>(
		null,
	);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	const theme = useTheme();
	const searchTheme = useMemo(() => getSearchTheme(theme), [theme]);
	const codeEditorTheme = useMemo(() => getCodeMirrorTheme(theme), [theme]);

	useEffect(() => {
		if (editorRef.current) {
			// @ts-ignore
			setEditorContainer(editorRef.current.container);
		}
	});

	useEffect(() => {
		if (document.content !== originalContentRef.current) {
			setContent(document.content);
			setHasUserChanges(false);
			originalContentRef.current = document.content;
			isInitialLoadRef.current = true;
		}
	}, [document.content]);

	useEffect(() => {
		const newLangExtension = loadLanguageExtensions(document.title);
		if (newLangExtension) {
			setLanguageExtensions([newLangExtension]);
		}
	}, [document.title]);

	useEffect(() => {
		if (
			editable &&
			hasUserChanges &&
			!isInitialLoadRef.current &&
			debouncedContent !== originalContentRef.current &&
			document.path &&
			window.api.saveFile
		) {
			window.api.saveFile(document.path, debouncedContent);
			originalContentRef.current = debouncedContent;
			setHasUserChanges(false);

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
		document.path,
		document.id,
		editable,
		hasUserChanges,
		conversationId,
		canvasState,
		setFiles,
	]);

	const handleContentChange = useCallback(
		(value: string) => {
			setContent(value);
			if (isInitialLoadRef.current) {
				isInitialLoadRef.current = false;
			}
			if (value !== originalContentRef.current) {
				setHasUserChanges(true);
			}
			if (onContentChange) {
				onContentChange(value);
			}
		},
		[onContentChange],
	);

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
							0.9,
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
				const truncatedTextBefore =
					textBefore.length > 120 ? `${textBefore.slice(-120)}` : textBefore;
				const truncatedTextAfter =
					textAfter.length > 120 ? `${textAfter.slice(0, 120)}` : textAfter;

				const formattedSelection = `<text_before>${truncatedTextBefore}</text_before><selected_text>${selection}</selected_text><text_after>${truncatedTextAfter}</text_after>`;
				const rect = view.coordsAtPos(from);
				if (rect) {
					const container = scrollContainerRef.current;
					if (!container) return;
					const containerRect = container.getBoundingClientRect();
					const scrollTop = container.scrollTop;
					const selectionRange = window.getSelection()?.getRangeAt(0);
					setInlineEdit({
						selection: formattedSelection,
						position: {
							top: Math.max(0, rect.bottom - containerRect.top) + scrollTop - 16,
							left: 42,
						},
						range: selectionRange || null,
						from,
						to,
					});
				}
			}
		}
	};

	const handleApplyChanges = useCallback(
		(editDiffs: EditDiff[]) => {
			const view = editorRef.current?.view;
			if (view) {
				const newContent = editDiffs.reduce(
					(currentDoc, diff) => currentDoc.replace(diff.find, diff.replace),
					view.state.doc.toString(),
				);

				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: newContent },
				});
			}
			setInlineEdit(null);
		},
		[],
	);

	const handleEdit = useCallback(
		(
			selection: string,
			rect: DOMRect,
			range: globalThis.Range,
			close: () => void,
		) => {
			const container = scrollContainerRef.current;
			if (!container) return;
			const containerRect = container.getBoundingClientRect();
			const scrollTop = container.scrollTop;
			const view = editorRef.current?.view;
			if (view) {
				const { from, to } = view.state.selection.main;
				setInlineEdit({
					selection,
					position: {
						top: Math.max(0, rect.bottom - containerRect.top) + scrollTop - 16,
						left: 42,
					},
					range,
					from,
					to,
				});
				close();
			}
		},
		[],
	);

	return (
		<CodeEditorContainer onKeyDown={handleKeyDown} ref={scrollContainerRef}>
			<CodeMirror
				value={content}
				height="100%"
				theme="none"
				editable={editable}
				extensions={[
					codeEditorTheme,
					...languageExtensions,
					highlightPlugin,
					search({ top: true }),
					searchTheme,
					keymap.of(searchKeymap),
				]}
				onChange={handleContentChange}
				ref={editorRef}
			/>
			<TextSelectionControls
				targetRef={{ current: editorContainer }}
				scrollableContainerRef={scrollContainerRef}
				showSpeech
				showCopy
				showEdit
				showRefer={!!document.path}
				onEdit={handleEdit}
				conversationId={conversationId}
				agentId={agentId ?? undefined}
				filePath={document.path}
			/>
			{inlineEdit && document.path && (
				<InlineEdit
					selection={inlineEdit.selection}
					position={inlineEdit.position}
					filePath={document.path}
					onClose={() => setInlineEdit(null)}
					onApplyChanges={handleApplyChanges}
					agentId={agentId}
					reviewState={null}
					onAcceptDiff={() => {}}
					onRejectDiff={() => {}}
					onApplyAll={() => {}}
					onRejectAll={() => {}}
				/>
			)}
		</CodeEditorContainer>
	);
};

export const CodeEditor = memo(CodeEditorComponent);
