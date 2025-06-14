import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Type for a single canvas tab (could be extended as needed)
 */
export type CanvasTab = {
	id: string;
	title: string;
};

import type { CanvasDocument } from "@features/chat/types/canvas";

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
	spreadsheetData: Record<string, Record<string, Record<string, unknown>[]>>;
};

/**
 * State for the entire canvas store, keyed by conversation ID
 */
export type CanvasStoreState = {
	conversations: Record<string, ConversationCanvasState>;
	setSpreadsheetData: (
		conversationId: string,
		fileId: string,
		data: Record<string, Record<string, unknown>[]>,
	) => void;
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
	 * Set a single file for a conversation
	 */
	updateOneFile: (conversationId: string, file: CanvasDocument) => void;
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
	/**
	 * Add a file and select it
	 */
	addFileAndSelect: (conversationId: string, file: CanvasDocument) => void;
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
	spreadsheetData: {},
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
			setSpreadsheetData: (conversationId, fileId, data) => {
				set((state) => {
					const conv = getConversationState(
						state.conversations,
						conversationId,
					);
					return {
						conversations: {
							...state.conversations,
							[conversationId]: {
								...conv,
								spreadsheetData: {
									...conv.spreadsheetData,
									[fileId]: data,
								},
							},
						},
					};
				});
			},
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
      updateOneFile: (conversationId, updatedFile) => {
				set((state) => {
					const conv = getConversationState(state.conversations, conversationId);
					const updatedFiles = conv.files.map((f) => 
						f.id === updatedFile.id ? updatedFile : f
					);
					return {
						conversations: {
							...state.conversations,
							[conversationId]: {
								...conv,
								files: updatedFiles,
							},
						},
					};
				});
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
			addFileAndSelect: (conversationId, file) => {
				set((state) => {
					const conv = getConversationState(
						state.conversations,
						conversationId,
					);
			
					// Check if the file already exists in openTabs
					const tabExists = conv.openTabs.some(tab => tab.id === file.id);
			
					const updatedTabs = tabExists 
						? conv.openTabs 
						: [...conv.openTabs, { id: file.id, title: file.title }];
			
					// Check if the file already exists in files
					const fileExists = conv.files.some(f => f.id === file.id);
			
					const updatedFiles = fileExists
						? conv.files
						: [...conv.files, file];
			
					return {
						conversations: {
							...state.conversations,
							[conversationId]: {
								...conv,
								files: updatedFiles,
								openTabs: updatedTabs,
								selectedTabId: file.id,
								viewMode: "documents",
							},
						},
					};
				});
			},
		}),
		{
			name: "canvas-store",
		},
	),
);
