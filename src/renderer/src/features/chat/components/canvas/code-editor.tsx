import { search, searchKeymap } from "@codemirror/search";
import {
	Decoration,
	type DecorationSet,
	ViewPlugin,
	keymap,
} from "@codemirror/view";
import { Box, alpha, styled, useTheme } from "@mui/material";
import type { EditDiff } from "@shared/api/local-operator/types";
import { TextSelectionControls } from "@shared/components/common/text-selection-controls";
import { getSearchTheme } from "@shared/themes/search-theme";
import { loadLanguageExtensions } from "@shared/utils/load-language-extensions";
import CodeMirror, {
	type Extension,
	type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import {
	type FC,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useDebouncedValue } from "../../../../shared/hooks/use-debounced-value";
import { useCanvasStore } from "../../../../shared/store/canvas-store";
import { getCodeMirrorTheme } from "../../../../shared/themes/code-mirror-theme";
import type { CanvasDocument } from "../../types/canvas";
import { diffHighlight } from "./code-editor-diff";
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
	overflow: "auto",
	height: "100%",
	fontSize: theme.typography.pxToRem(13),
	fontFamily: "'Geist Mono', monospace",
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
	const [reviewState, setReviewState] = useState<{
		diffs: EditDiff[];
		currentIndex: number;
		approvedDiffs: EditDiff[];
		originalContent: string;
	} | null>(null);
	const editorRef = useRef<ReactCodeMirrorRef>(null);
	const [editorContainer, setEditorContainer] = useState<HTMLElement | null>(
		null,
	);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	const theme = useTheme();
	const searchTheme = useMemo(() => getSearchTheme(theme), [theme]);
	const codeEditorTheme = useMemo(() => getCodeMirrorTheme(theme), [theme]);
	const diffExtension = useMemo(
		() => diffHighlight(theme, reviewState),
		[theme, reviewState],
	);

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
					if (!inlineEdit || reviewState) {
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
	}, [inlineEdit, theme.palette.primary.main, reviewState]);

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
							top:
								Math.max(0, rect.bottom - containerRect.top) + scrollTop - 16,
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
		(diffs: EditDiff[]) => {
			const view = editorRef.current?.view;
			if (!view) return;

			// Keep the original content in the editor during review
			setReviewState({
				diffs,
				currentIndex: 0,
				approvedDiffs: [],
				originalContent: content,
			});

			// Force a view update to trigger diff highlighting
			setTimeout(() => {
				if (editorRef.current?.view) {
					editorRef.current.view.dispatch({});
				}
			}, 0);
		},
		[content],
	);

	const handleFinalizeChanges = (finalDiffs: EditDiff[]) => {
		const view = editorRef.current?.view;
		if (!view) return;

		let finalContent = reviewState?.originalContent ?? content;
		for (const diff of finalDiffs) {
			finalContent = finalContent.replace(diff.find, diff.replace);
		}

		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: finalContent },
		});

		setContent(finalContent);
		setHasUserChanges(true);
		setReviewState(null);
		setInlineEdit(null);

		if (document.path && finalContent !== originalContentRef.current) {
			window.api.saveFile(document.path, finalContent);
			originalContentRef.current = finalContent;
			setHasUserChanges(false);

			if (conversationId && canvasState) {
				const updatedFiles = canvasState.files.map((file) =>
					file.id === document.id
						? { ...file, content: finalContent }
						: file,
				);
				setFiles(conversationId, updatedFiles);
			}
		}
	};

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
				editable={editable && !reviewState}
				extensions={[
					codeEditorTheme,
					...languageExtensions,
					highlightPlugin,
					diffExtension,
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
					onClose={() => {
						setInlineEdit(null);
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
						const newApprovedDiffs = [...reviewState.approvedDiffs, currentDiff];
						if (reviewState.currentIndex >= reviewState.diffs.length - 1) {
							handleFinalizeChanges(newApprovedDiffs);
						} else {
							setReviewState({
								...reviewState,
								approvedDiffs: newApprovedDiffs,
								currentIndex: reviewState.currentIndex + 1,
							});
							// Force view update to show next diff
							setTimeout(() => {
								if (editorRef.current?.view) {
									editorRef.current.view.dispatch({});
								}
							}, 0);
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
							// Force view update to show next diff
							setTimeout(() => {
								if (editorRef.current?.view) {
									editorRef.current.view.dispatch({});
								}
							}, 0);
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
							// Force view update to show the navigated diff
							setTimeout(() => {
								if (editorRef.current?.view) {
									editorRef.current.view.dispatch({});
								}
							}, 0);
						}
					}}
				/>
			)}
		</CodeEditorContainer>
	);
};

export const CodeEditor = memo(CodeEditorComponent);
