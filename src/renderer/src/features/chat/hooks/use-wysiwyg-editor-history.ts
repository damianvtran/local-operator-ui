import { useCallback, useEffect, useRef } from "react";
import { useWysiwygEditorStore } from "@shared/store/wysiwyg-editor-store";
import DiffMatchPatch from "diff-match-patch";
import { useDebounce } from "@shared/hooks/use-debounce";

type UseWysiwygEditorHistoryParams = {
	documentTitle: string;
	documentContent: string;
	onContentChange: (newContent: string) => void;
};

export const useWysiwygEditorHistory = ({
	documentTitle,
	documentContent,
	onContentChange,
}: UseWysiwygEditorHistoryParams) => {
	const {
		getDocumentHistory,
		setDocumentContent,
		addHistory,
		undo: undoFromStore,
		redo: redoFromStore,
	} = useWysiwygEditorStore();

	const dmp = useRef(new DiffMatchPatch());
	const isApplyingHistory = useRef(false);
	const lastKnownContent = useRef(documentContent);
	const isInitialized = useRef(false);

	const initializeDocument = useCallback(() => {
		if (isInitialized.current) return;
		
		const history = getDocumentHistory(documentTitle);
		if (!history) {
			setDocumentContent(documentTitle, documentContent);
			lastKnownContent.current = documentContent;
			isInitialized.current = true;
		} else {
			lastKnownContent.current = history.content;
			isInitialized.current = true;
		}
	}, [documentTitle, documentContent, getDocumentHistory, setDocumentContent]);

	useEffect(() => {
		initializeDocument();
	}, [initializeDocument]);

	const addToHistory = useCallback(
		(newContent: string) => {
			if (isApplyingHistory.current) {
				isApplyingHistory.current = false;
				return;
			}

			if (!isInitialized.current) {
				return;
			}

			if (lastKnownContent.current === newContent) {
				return;
			}

			const patches = dmp.current.patch_make(
				lastKnownContent.current,
				newContent,
			);
			if (patches.length === 0) return;

			const inversePatches = dmp.current.patch_make(
				newContent,
				lastKnownContent.current,
			);

			// biome-ignore lint/suspicious/noExplicitAny: diff-match-patch types are incorrect
			addHistory(documentTitle, patches as any, inversePatches as any);
			lastKnownContent.current = newContent;
		},
		[addHistory, documentTitle],
	);

	const debouncedAddToHistory = useDebounce(
		(...args: unknown[]) => {
			const newContent = args[0] as string;
			addToHistory(newContent);
		},
		500,
	);

	useEffect(() => {
		if (isInitialized.current) {
			debouncedAddToHistory(documentContent);
		}
	}, [documentContent, debouncedAddToHistory]);

	const undo = useCallback(() => {
		const newContent = undoFromStore(documentTitle);
		if (newContent !== undefined) {
			isApplyingHistory.current = true;
			lastKnownContent.current = newContent;
			onContentChange(newContent);
		}
	}, [undoFromStore, documentTitle, onContentChange]);

	const redo = useCallback(() => {
		const newContent = redoFromStore(documentTitle);
		if (newContent !== undefined) {
			isApplyingHistory.current = true;
			lastKnownContent.current = newContent;
			onContentChange(newContent);
		}
	}, [redoFromStore, documentTitle, onContentChange]);

	const canUndo = useWysiwygEditorStore(
		(state) => state.canUndo(documentTitle),
	);
	const canRedo = useWysiwygEditorStore(
		(state) => state.canRedo(documentTitle),
	);

	return { undo, redo, canUndo, canRedo, addToHistory: debouncedAddToHistory };
};
