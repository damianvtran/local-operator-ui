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
import { getCodeMirrorTheme } from "../../../../shared/themes/code-mirror-theme";
import type { CanvasDocument } from "../../types/canvas";
import { diffHighlight } from "./code-editor-diff";
import {
	adoptBuffer,
	closeBuffer,
	commitCanvasDocument,
	proposeBuffer,
	saveBuffer,
} from "./document-buffers";
import { isDocumentDirty } from "./file-freshness";
import { InlineEdit } from "./inline-edit";

/**
 * How long the reader's typing settles before an automatic save is asked for.
 *
 * The one-second debounce this editor has always used. It is a TRIGGER now, not a
 * payload: the owner writes its own current text when the timer fires, so the value
 * that reaches the file is the reader's latest, whatever the timer was armed over.
 */
const CODE_AUTOSAVE_MS = 1000;

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
	const originalContentRef = useRef(document.content);
	const isInitialLoadRef = useRef(true);
	const [languageExtensions, setLanguageExtensions] = useState<Extension[]>([]);
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
	 * THE BUFFER OWNER OWNS THIS DOCUMENT'S TEXT (round 4). This effect is the whole
	 * lifecycle contract the editor owes: register the document, and hand the owner a
	 * `commit` port for the store. The owner adopts the file's content whenever this
	 * buffer has nothing unsaved, publishes the dirty registry itself, and is the only
	 * thing that writes - so nothing below carries text anywhere.
	 */
	const latestDocumentRef = useRef(document);
	latestDocumentRef.current = document;
	useEffect(() => {
		adoptBuffer({
			documentId: document.id,
			path: document.path,
			text: document.content,
			mtimeMs: document.readMtimeMs,
			commit: (text, mtimeMs) => {
				if (!conversationId) return;
				const current = latestDocumentRef.current;
				commitCanvasDocument(conversationId, {
					...current,
					content: text,
					readMtimeMs: mtimeMs ?? current.readMtimeMs,
					lastAgentModified: mtimeMs ?? current.lastAgentModified,
				});
			},
		});
	}, [conversationId, document]);
	/*
	 * The unmount is one call. The owner flushes a write that should happen, commits
	 * the buffer through the port above so a close is a pause rather than a loss, and
	 * KEEPS the dirty flag while the document is held (code review round 4, R4-1) -
	 * which is why this editor no longer clears the registry itself, and why a held
	 * document's next activation cannot apply the file's version over the reader's
	 * words.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: an unmount cleanup, registered once per document; the owner holds the text and the store handoff.
	useEffect(() => () => closeBuffer(document.id), [document.id]);

	/*
	 * THE DEBOUNCE ONLY TRIGGERS; IT CARRIES NO TEXT (round 4). This used to hand
	 * `debouncedContent` to the write gate, which is exactly how a stale snapshot
	 * reached a file after a load, and how another document's bytes could reach this
	 * one. The owner reads its own current text at write time and returns `clean`
	 * without probing anything when there is nothing to write.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `content` is the TRIGGER, not a value the body reads - the owner writes its own current text, and the effect re-arms the debounce on every keystroke on purpose.
	useEffect(() => {
		if (!editable || !document.path) return;
		const timer = window.setTimeout(() => {
			void saveBuffer(document.id)
				.then((outcome) => {
					if (outcome.status === "failed") {
						console.error("Could not save the document:", outcome.error);
					}
				})
				.catch((error) => {
					console.error("Could not save the document:", error);
				});
		}, CODE_AUTOSAVE_MS);
		return () => window.clearTimeout(timer);
	}, [content, document.id, editable]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the body reaches this value through the owner and the callback it holds, so the dependency is deliberate: what the hook is watching is named here and nothing else re-registers it.
	const handleContentChange = useCallback(
		(value: string) => {
			setContent(value);
			if (isInitialLoadRef.current) {
				isInitialLoadRef.current = false;
			}
			/*
			 * THE READER'S TEXT, reported to its owner (I1). The owner recomputes the
			 * dirty flag from it (UX U11: an undo back to the file's own bytes clears
			 * it) and publishes the registry the freshness check consults.
			 */
			proposeBuffer(document.id, value);
			if (onContentChange) {
				onContentChange(value);
			}
		},
		[onContentChange],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the body reaches this value through the owner and the callback it holds, so the dependency is deliberate: what the hook is watching is named here and nothing else re-registers it.
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
	}, [document.id, inlineEdit, reviewState]);

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
		setReviewState(null);
		setInlineEdit(null);

		if (document.path && finalContent !== originalContentRef.current) {
			/*
			 * An inline edit's own finalize is a save the READER asked for by approving
			 * the diff, so it is EXPLICIT: the gate never refuses it on a version
			 * conflict, and the owner writes the reader's current buffer (I3).
			 */
			proposeBuffer(document.id, finalContent);
			void saveBuffer(document.id, { explicit: true });
		}
	};

	/*
	 * ⌘S EXISTS HERE NOW (QA round 3, Q10; code review round 3, A). The row tells a
	 * held reader "...or save to replace it", and on a `.py` document there was no
	 * such action at all: a real Meta+S changed nothing, so the only route out of
	 * the hold was the control that discards their words. This is the spreadsheet's
	 * handler, on the surface that lacked it - and the HTML viewer's edit mode is
	 * this same component, so it inherits it.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the body reaches this value through the owner and the callback it holds, so the dependency is deliberate: what the hook is watching is named here and nothing else re-registers it.
	useEffect(() => {
		if (!editable) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.key !== "s") return;
			event.preventDefault();
			/*
			 * I3, at the surface where it was measured: the chord writes the text the
			 * owner holds NOW, not the debounce's value as of up to a second ago. QA's
			 * Q13 was exactly this pair - Meta+S inside the debounce window saving the
			 * pre-edit buffer and then marking the document clean, so the autosave that
			 * would have written the words never ran either.
			 */
			proposeBuffer(document.id, content);
			void saveBuffer(document.id, { explicit: true });
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [content, document.id, document.path, editable]);

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
