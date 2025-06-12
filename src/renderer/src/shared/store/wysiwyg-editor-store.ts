import { create } from "zustand";
import DiffMatchPatch from "diff-match-patch";
import type { patch_obj as Patch } from "diff-match-patch";

type HistoryEntry = {
	patches: Patch[];
	inversePatches: Patch[];
};

type DocumentHistory = {
	undoStack: HistoryEntry[];
	redoStack: HistoryEntry[];
	content: string;
};

type WysiwygEditorState = {
	documents: Record<string, DocumentHistory>;
	getDocumentHistory: (title: string) => DocumentHistory | undefined;
	setDocumentContent: (title: string, content: string) => void;
	addHistory: (
		title: string,
		patches: Patch[],
		inversePatches: Patch[],
	) => void;
	undo: (title: string) => string | undefined;
	redo: (title: string) => string | undefined;
	canUndo: (title: string) => boolean;
	canRedo: (title: string) => boolean;
};

export const useWysiwygEditorStore = create<WysiwygEditorState>((set, get) => {
	const dmp = new DiffMatchPatch();

	return {
		documents: {},

		getDocumentHistory: (title) => {
			return get().documents[title];
		},

	setDocumentContent: (title, content) => {
		set((state) => ({
			documents: {
				...state.documents,
				[title]: {
					...state.documents[title],
					undoStack: [],
					redoStack: [],
					content,
				},
			},
		}));
	},

	addHistory: (title, patches, inversePatches) => {
		set((state) => {
			const doc = state.documents[title];
			if (!doc) return state;

			const [newContent] = dmp.patch_apply(
				// biome-ignore lint/suspicious/noExplicitAny: diff-match-patch types are incorrect
				patches as any,
				doc.content,
			) as [string, boolean[]];

			const newUndoStack = [...doc.undoStack, { patches, inversePatches }];

			return {
				documents: {
					...state.documents,
					[title]: {
						...doc,
						content: newContent,
						undoStack: newUndoStack,
						redoStack: [],
					},
				},
			};
		});
	},

	undo: (title) => {
		let newContent: string | undefined;

		set((state) => {
			const doc = state.documents[title];
			if (!doc || doc.undoStack.length === 0) {
				return state;
			}

			const lastAction = doc.undoStack[doc.undoStack.length - 1];
			const [contentAfterUndo] = dmp.patch_apply(
				// biome-ignore lint/suspicious/noExplicitAny: diff-match-patch types are incorrect
				lastAction.inversePatches as any,
				doc.content,
			) as [string, boolean[]];
			newContent = contentAfterUndo;

			const newUndoStack = doc.undoStack.slice(0, -1);
			const newRedoStack = [lastAction, ...doc.redoStack];

			return {
				documents: {
					...state.documents,
					[title]: {
						...doc,
						content: newContent,
						undoStack: newUndoStack,
						redoStack: newRedoStack,
					},
				},
			};
		});

		return newContent;
	},

	redo: (title) => {
		let newContent: string | undefined;

		set((state) => {
			const doc = state.documents[title];
			if (!doc || doc.redoStack.length === 0) {
				return state;
			}

			const nextAction = doc.redoStack[0];
			const [contentAfterRedo] = dmp.patch_apply(
				// biome-ignore lint/suspicious/noExplicitAny: diff-match-patch types are incorrect
				nextAction.patches as any,
				doc.content,
			) as [string, boolean[]];
			newContent = contentAfterRedo;

			const newRedoStack = doc.redoStack.slice(1);
			const newUndoStack = [...doc.undoStack, nextAction];

			return {
				documents: {
					...state.documents,
					[title]: {
						...doc,
						content: newContent,
						undoStack: newUndoStack,
						redoStack: newRedoStack,
					},
				},
			};
		});

		return newContent;
	},

	canUndo: (title) => {
		const doc = get().documents[title];
		return doc ? doc.undoStack.length > 0 : false;
	},

	canRedo: (title) => {
		const doc = get().documents[title];
		return doc ? doc.redoStack.length > 0 : false;
	},
	};
});
