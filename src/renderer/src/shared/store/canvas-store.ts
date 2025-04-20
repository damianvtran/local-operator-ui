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

import type { CanvasDocument } from "@features/chat/components/canvas/types"; // TODO: Should move this type to feature level

/**
 * State for a single conversation's canvas
 */
export type ConversationCanvasState = {
	isOpen: boolean;
	openTabs: CanvasTab[];
	selectedTabId: string | null;
	files: CanvasDocument[];
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
};

/**
 * Helper to always get a valid conversation canvas state
 */
const getConversationState = (
	conversations: Record<string, ConversationCanvasState>,
	conversationId: string,
): ConversationCanvasState =>
	conversations[conversationId] ?? { ...defaultConversationCanvasState };

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
		}),
		{
			name: "canvas-store",
		},
	),
);
