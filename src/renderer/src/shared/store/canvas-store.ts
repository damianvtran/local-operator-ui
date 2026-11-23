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
 * Type for the canvas view mode: which record the pane is showing.
 *
 * `goals` is additive and LAST (documents → files → variables → goals: from "what
 * you made" to "what you intended"). It is a session-scoped RECORD rather than an
 * artifact, which is the characterisation `variables` already broke — session state
 * extracted during the session, not a file — so the union extends without changing
 * what the switcher means. A conversation persisted at `variables` or `documents`
 * keeps its stored value: nothing here renumbers, so no migration is owed.
 *
 * `projects` is appended after `goals` on the same terms: the projects this
 * conversation is linked to, a record ABOUT the session held by the project
 * registry. The pane resolves a stored value against the views it offers, so a
 * build that drops a mode falls back to `documents` rather than drawing nothing.
 */
export type CanvasViewMode =
	| "documents"
	| "files"
	| "variables"
	| "goals"
	| "projects";

/**
 * The canvas's OWN views: every mode but `projects`, which the rail reaches
 * through a door of its own (the linked-projects item). The canvas door, its
 * chord and the header's canvas row open one of these, never Projects — see
 * `lastCanvasView` and `canvasDoorView` for why that has to be remembered.
 */
export type CanvasOwnViewMode = Exclude<CanvasViewMode, "projects">;

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
	/**
	 * The last NON-projects view this conversation's canvas showed (round-1 R1-1 /
	 * U1 / Q-1 of the projects view). The rail has two doors into one pane, and
	 * `viewMode` persists across a close, so after the Projects door closed the
	 * pane the Canvas door used to reopen it on Projects — unlit, and two presses
	 * from the files the user wanted. The canvas doors open THIS view whenever the
	 * stored one is `projects` (`canvasDoorView`), so the user lands back where
	 * they were (Files, Goals…), not on a fixed default. Optional: a persisted
	 * state from before this field reads as "never left documents".
	 */
	lastCanvasView?: CanvasOwnViewMode;
	/**
	 * The project open in the Projects view's detail, or null for the list
	 * (round-1 U4). Held here rather than in the viewer because the viewer
	 * unmounts on every view switch and close: a user reading an update who
	 * glances at Files, or closes and reopens the pane, returns to the record
	 * they were reading. Per conversation, so another chat never inherits it;
	 * the viewer drops it when the project is no longer linked here.
	 */
	selectedProjectId?: string | null;
	/** Backend identity guards draft promotion/rebinding under the same chat key. */
	selectedProjectSessionId?: string;
	/** Explicit Back suppresses singleton forwarding until the linked ID set changes. */
	projectListEscape?: string;
	spreadsheetData: Record<string, Record<string, Record<string, unknown>[]>>;
};

/**
 * The view a canvas door (rail item, chord, header row) opens for a
 * conversation: its stored view, unless that is `projects` — then the last of
 * the canvas's own views, defaulting to `documents`. Pure, so the rail's
 * toggle and the tests read one rule.
 */
export function canvasDoorView(
	conversation:
		| Pick<ConversationCanvasState, "viewMode" | "lastCanvasView">
		| undefined,
): CanvasOwnViewMode {
	if (!conversation) return "documents";
	if (conversation.viewMode !== "projects") return conversation.viewMode;
	return conversation.lastCanvasView ?? "documents";
}

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
	 * Set (or clear, with null) the project open in the Projects view's detail.
	 */
	setSelectedProject: (
		conversationId: string,
		projectId: string | null,
		sessionId?: string,
		backFromLinks?: string,
	) => void;
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
					const conv = getConversationState(
						state.conversations,
						conversationId,
					);
					const updatedFiles = conv.files.map((f) =>
						f.id === updatedFile.id ? updatedFile : f,
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
							/* Every own-view write is remembered, whoever made it (switcher,
							   door, file open), so `canvasDoorView` has it to return to. */
							...(viewMode === "projects" ? {} : { lastCanvasView: viewMode }),
						},
					},
				}));
			},
			setSelectedProject: (
				conversationId,
				projectId,
				sessionId,
				backFromLinks,
			) => {
				set((state) => ({
					conversations: {
						...state.conversations,
						[conversationId]: {
							...getConversationState(state.conversations, conversationId),
							selectedProjectId: projectId,
							selectedProjectSessionId: sessionId,
							projectListEscape: backFromLinks,
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
					const tabExists = conv.openTabs.some((tab) => tab.id === file.id);

					const updatedTabs = tabExists
						? conv.openTabs
						: [...conv.openTabs, { id: file.id, title: file.title }];

					// Check if the file already exists in files
					const fileExists = conv.files.some((f) => f.id === file.id);

					const updatedFiles = fileExists ? conv.files : [...conv.files, file];

					return {
						conversations: {
							...state.conversations,
							[conversationId]: {
								...conv,
								files: updatedFiles,
								openTabs: updatedTabs,
								selectedTabId: file.id,
								viewMode: "documents",
								lastCanvasView: "documents",
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
