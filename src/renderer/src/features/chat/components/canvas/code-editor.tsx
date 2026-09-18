import { search, searchKeymap } from "@codemirror/search";
import {
	Decoration,
	type DecorationSet,
	ViewPlugin,
	keymap,
} from "@codemirror/view";
import type { EditDiff } from "@shared/api/local-operator/types";
import { TextSelectionControls } from "@shared/components/common/text-selection-controls";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { getTheme } from "@shared/themes";
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
import {
	clearDocumentDirty,
	documentAfterSelfWrite,
	isDocumentDirty,
	probeLocalFile,
	setDocumentDirty,
} from "./file-freshness";
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
	const [insertionPosition, setInsertionPosition] = useState<{
		diff: EditDiff;
		top: number;
	} | null>(null);
	const activeDiff = reviewState?.diffs[reviewState.currentIndex];
	const insertionPositionReady =
		activeDiff?.find !== "" || insertionPosition?.diff === activeDiff;
	const editorRef = useRef<ReactCodeMirrorRef>(null);
	const [editorContainer, setEditorContainer] = useState<HTMLElement | null>(
		null,
	);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	/* The theme registry is the app's own source of truth for a palette's mode
	   — `applyThemeToDocument` reads the same field to publish the document
	   `dark` class — so resolving it here avoids a second name-to-mode table.
	   Both theme getters are lookups over pre-built extensions, so neither
	   needs a memo. */
	const isDark = useUiPreferencesStore(
		(state) => getTheme(state.themeName).theme.palette.mode === "dark",
	);
	const searchTheme = getSearchTheme(isDark);
	const codeEditorTheme = getCodeMirrorTheme(isDark);
	const diffExtension = useMemo(
		() => diffHighlight(reviewState),
		[reviewState],
	);

	useEffect(() => {
		const view = editorRef.current?.view;
		const container = scrollContainerRef.current;
		if (!view || !container || !activeDiff || activeDiff.find !== "") return;
		let active = true;
		// The prompt's cursor anchor overlaps an insertion at that same cursor.
		// Measure the painted proposal (including wraps and font metrics) rather
		// than guessing its height from the replacement string. Until measured,
		// render the proposal alone so the first frame cannot hide it either.
		const measure = () =>
			view.requestMeasure({
				read: () => {
					const widget =
						view.dom.querySelector<HTMLElement>("[data-edit-diff]");
					return widget
						? widget.getBoundingClientRect().bottom -
								container.getBoundingClientRect().top +
								container.scrollTop +
								8
						: null;
				},
				write: (top) => {
					if (!active || top === null) return;
					setInsertionPosition((previous) =>
						previous?.diff === activeDiff && previous.top === top
							? previous
							: { diff: activeDiff, top },
					);
				},
			});
		const observer = new ResizeObserver(measure);
		observer.observe(view.contentDOM);
		observer.observe(container);
		view.scrollDOM.addEventListener("scroll", measure);
		measure();
		return () => {
			active = false;
			observer.disconnect();
			view.scrollDOM.removeEventListener("scroll", measure);
		};
	}, [activeDiff]);

	useEffect(() => {
		if (editorRef.current) {
			// @ts-ignore
			setEditorContainer(editorRef.current.container);
		}
	});

	useEffect(() => {
		if (document.content !== originalContentRef.current) {
			/*
			 * NOT WHILE THE READER'S OWN WORDS ARE IN THE BUFFER (code review round 1,
			 * M3). This effect is the other half of the freshness check's dirty gate:
			 * a check that started before the first keystroke can still land here with
			 * the file's bytes, and without this guard it replaced the typing on screen
			 * (and cleared the dirty flag that would have protected it) - losing
			 * characters that had not reached disk. The registry is asked, not the
			 * `hasUserChanges` state, because the check's own outcome may already have
			 * moved that state in the same commit.
			 */
			if (isDocumentDirty(document.id)) return;
			setContent(document.content);
			setHasUserChanges(false);
			originalContentRef.current = document.content;
			isInitialLoadRef.current = true;
		}
	}, [document.id, document.content]);

	useEffect(() => {
		const newLangExtension = loadLanguageExtensions(document.title);
		if (newLangExtension) {
			setLanguageExtensions([newLangExtension]);
		}
	}, [document.title]);

	/*
	 * Publish "this buffer differs from the file", for the canvas's freshness
	 * check to consult before it replaces anything.
	 *
	 * The store cannot answer this question and that is the whole reason the
	 * registry exists: between a keystroke and the debounced write below, the
	 * store still holds the OLD bytes, so a check driven by the store's own copy
	 * would see "nothing has changed here" and overwrite what is being typed.
	 * The unmount cleanup is the other half - a closed tab must not leave a
	 * suppression behind for the next document that reuses the path.
	 */
	useEffect(() => {
		setDocumentDirty(document.id, hasUserChanges);
	}, [document.id, hasUserChanges]);
	useEffect(() => () => clearDocumentDirty(document.id), [document.id]);

	useEffect(() => {
		if (
			editable &&
			hasUserChanges &&
			!isInitialLoadRef.current &&
			debouncedContent !== originalContentRef.current &&
			document.path &&
			window.api.saveFile
		) {
			/*
			 * The write and the baseline it produces are ONE step.
			 *
			 * The file's mtime changes because of our own save, and the canvas's
			 * freshness check compares a probe against exactly that value - so a save
			 * that did not advance it would make the next tick re-read the bytes we
			 * just wrote. The probe is the only thing that can say what the write's
			 * mtime IS (a renderer cannot `stat`, and `Date.now()` is this process's
			 * clock, not the file's), and it runs before the dirty flag clears: a
			 * check landing mid-save must not replace a buffer whose bytes are not
			 * yet on disk.
			 */
			void (async () => {
				try {
					await window.api.saveFile(document.path, debouncedContent);
					const probe = await probeLocalFile(document.path);
					originalContentRef.current = debouncedContent;
					setHasUserChanges(false);

					if (conversationId && canvasState) {
						const updatedFiles = canvasState.files.map((file) =>
							file.id === document.id
								? documentAfterSelfWrite(file, probe, debouncedContent)
								: file,
						);
						setFiles(conversationId, updatedFiles);
					}
				} catch (error) {
					/*
					 * The write failed, so nothing on disk matches the buffer: the dirty
					 * flag stays set (the next debounce tries again) and the check keeps
					 * out of the way.
					 */
					console.error("Could not save the document:", error);
				}
			})();
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
					// A cursor-only selection has no text to mark. In particular,
					// an empty live buffer must still open the edit popover.
					if (from === to) {
						this.decorations = Decoration.none;
						return;
					}
					const highlightMark = Decoration.mark({
						style: "background-color: var(--color-accent-wash)",
					});
					this.decorations = Decoration.set([highlightMark.range(from, to)]);
				}
			},
		);
	}, [inlineEdit, reviewState]);

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
					file.id === document.id ? { ...file, content: finalContent } : file,
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
		<div
			className={cn("relative h-full grow overflow-auto text-mono")}
			onKeyDown={handleKeyDown}
			ref={scrollContainerRef}
		>
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
			{inlineEdit && document.path && insertionPositionReady && (
				<InlineEdit
					fileContent={content}
					selection={inlineEdit.selection}
					position={
						activeDiff?.find === "" && insertionPosition?.diff === activeDiff
							? { ...inlineEdit.position, top: insertionPosition.top }
							: inlineEdit.position
					}
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
		</div>
	);
};

export const CodeEditor = memo(CodeEditorComponent);
