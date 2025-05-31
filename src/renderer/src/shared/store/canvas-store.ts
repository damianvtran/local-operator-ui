import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Type for a single canvas tab (could be extended as needed)
 */
export type CanvasTab = {
	id: string;
	title: string;
	// Add more tab-specific fields as needed
};

// import type { CanvasDocument } from "@features/chat/components/canvas/types"; // TODO: Should move this type to feature level
import type { CanvasDocument } from "@features/chat/types/canvas"; // TODO: Should move this type to feature level

/**
 * Canvas view mode type
 */
export type CanvasViewMode = "documents" | "files" | "variables";

/**
 * State for a single conversation's canvas
 */
export type ConversationCanvasState = {
	isOpen: boolean;
	openTabs: CanvasTab[];
	selectedTabId: string | null;
	files: CanvasDocument[];
	mentionedFiles: CanvasDocument[];
	viewMode: CanvasViewMode;
};

/**
 * State for the entire canvas store, keyed by conversation ID
 */
export type CanvasStoreState = {
	conversations: Record<string, ConversationCanvasState>;
	/**
	 * Set the open status for a conversation's canvas
	 */
	setCanvasOpen: (conversationId: string, isOpen: boolean) => void;
	/**
	 * Set the open tabs for a conversation
	 */
	setOpenTabs: (conversationId: string, tabs: CanvasTab[]) => void;
	/**
	 * Set the selected tab for a conversation
	 */
	setSelectedTab: (conversationId: string, tabId: string | null) => void;
	/**
	 * Set the files for a conversation
	 */
	setFiles: (conversationId: string, files: CanvasDocument[]) => void;
	/**
	 * Set the mentioned files for a conversation
	 */
	setMentionedFiles: (
		conversationId: string,
		mentionedFiles: CanvasDocument[],
	) => void;
	/**
	 * Add a single mentioned file (deduplicated) for a conversation
	 */
	addMentionedFile: (conversationId: string, file: CanvasDocument) => void;
	/**
	 * Add multiple mentioned files (deduplicated) for a conversation
	 */
	addMentionedFilesBatch: (
		conversationId: string,
		files: CanvasDocument[],
	) => void;
	/**
	 * Set the view mode for a conversation's canvas
	 */
	setViewMode: (conversationId: string, viewMode: CanvasViewMode) => void;
	/**
	 * Reset the canvas state for a conversation
	 */
	resetConversationCanvas: (conversationId: string) => void;
};

/**
 * Default state for a conversation's canvas
 */
const defaultConversationCanvasState: ConversationCanvasState = {
	isOpen: false,
	openTabs: [],
	selectedTabId: null,
	files: [],
	mentionedFiles: [],
	viewMode: "documents", // Default to documents view
};

/**
 * Helper to always get a valid conversation canvas state
 */
const getConversationState = (
	conversations: Record<string, ConversationCanvasState>,
	conversationId: string,
): ConversationCanvasState => {
	const existing = conversations[conversationId];
	return existing
		? { ...defaultConversationCanvasState, ...existing }
		: { ...defaultConversationCanvasState };
};

/**
 * Zustand store for managing canvas state per conversation
 */
export const useCanvasStore = create<CanvasStoreState>()(
	persist(
		(set, _) => ({
			conversations: {},
			setCanvasOpen: (conversationId, isOpen) => {
				set((state) => ({
					conversations: {
						...state.conversations,
						[conversationId]: {
							...getConversationState(state.conversations, conversationId),
							isOpen,
						},
					},
				}));
			},
			setOpenTabs: (conversationId, tabs) => {
				set((state) => ({
					conversations: {
						...state.conversations,
						[conversationId]: {
							...getConversationState(state.conversations, conversationId),
							openTabs: tabs,
						},
					},
				}));
			},
			setSelectedTab: (conversationId, tabId) => {
				set((state) => ({
					conversations: {
						...state.conversations,
						[conversationId]: {
							...getConversationState(state.conversations, conversationId),
							selectedTabId: tabId,
						},
					},
				}));
			},
			setFiles: (conversationId, files) => {
				set((state) => ({
					conversations: {
						...state.conversations,
						[conversationId]: {
							...getConversationState(state.conversations, conversationId),
							files,
						},
					},
				}));
			},
			resetConversationCanvas: (conversationId) => {
				set((state) => {
					const newConversations = { ...state.conversations };
					newConversations[conversationId] = {
						...defaultConversationCanvasState,
					};
					return { conversations: newConversations };
				});
			},
			setMentionedFiles: (conversationId, mentionedFiles) => {
				set((state) => ({
					conversations: {
						...state.conversations,
						[conversationId]: {
							...getConversationState(state.conversations, conversationId),
							mentionedFiles,
						},
					},
				}));
			},
			addMentionedFile: (conversationId, file) => {
				set((state) => {
					const conv = getConversationState(
						state.conversations,
						conversationId,
					);
					const exists = conv.mentionedFiles.find((d) => d.id === file.id);
					const updated = exists
						? conv.mentionedFiles
						: [...conv.mentionedFiles, file];
					return {
						conversations: {
							...state.conversations,
							[conversationId]: {
								...conv,
								mentionedFiles: updated,
							},
						},
					};
				});
			},
			addMentionedFilesBatch: (conversationId, filesToAdd) => {
				set((state) => {
					const conv = getConversationState(
						state.conversations,
						conversationId,
					);
					const existingFileIds = new Set(conv.mentionedFiles.map((f) => f.id));
					const newFiles = filesToAdd.filter(
						(file) => !existingFileIds.has(file.id),
					);
					if (newFiles.length === 0) {
						return state; // No changes needed
					}
					return {
						conversations: {
							...state.conversations,
							[conversationId]: {
								...conv,
								mentionedFiles: [...conv.mentionedFiles, ...newFiles],
							},
						},
					};
				});
			},
			setViewMode: (conversationId, viewMode) => {
				set((state) => ({
					conversations: {
						...state.conversations,
						[conversationId]: {
							...getConversationState(state.conversations, conversationId),
							viewMode,
						},
					},
				}));
			},
		}),
		{
			name: "canvas-store",
		},
	),
);
