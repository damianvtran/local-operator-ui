/**
 * Agent Selection Store
 *
 * Manages the last selected agent for chat and agents pages using Zustand.
 * Provides a persistent store to remember agent selections between sessions.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Agent selection state interface
 */
type AgentSelectionState = {
	/**
	 * Last selected agent ID for the chat page
	 */
	lastChatAgentId: string | null;

	/**
	 * Last selected agent ID for the agents page
	 */
	lastAgentsPageAgentId: string | null;

	/**
	 * Set the last selected agent ID for the chat page
	 * @param agentId - The agent ID to set
	 */
	setLastChatAgentId: (agentId: string | null) => void;

	/**
	 * Set the last selected agent ID for the agents page
	 * @param agentId - The agent ID to set
	 */
	setLastAgentsPageAgentId: (agentId: string | null) => void;

	/**
	 * Get the last selected agent ID for a specific page
	 * @param page - The page to get the agent ID for ('chat' or 'agents')
	 * @returns The last selected agent ID for the page or null if none exists
	 */
	getLastAgentId: (page: "chat" | "agents") => string | null;

	/**
	 * Clear the last selected agent ID for a specific page
	 * @param page - The page to clear the agent ID for ('chat' or 'agents')
	 */
	clearLastAgentId: (page: "chat" | "agents") => void;

	/**
	 * Clear an agent ID from all pages if it matches the given ID
	 * This is useful when an agent is deleted to ensure it's removed from all stores
	 * @param agentId - The agent ID to clear
	 */
	clearAgentFromAllPages: (agentId: string) => void;
};

/**
 * Agent selection store implementation using Zustand with persistence
 * Stores agent selection information in localStorage
 */
export const useAgentSelectionStore = create<AgentSelectionState>()(
	persist(
		(set, get) => ({
			lastChatAgentId: null,
			lastAgentsPageAgentId: null,

			setLastChatAgentId: (agentId) => {
				set({ lastChatAgentId: agentId });
			},

			setLastAgentsPageAgentId: (agentId) => {
				set({ lastAgentsPageAgentId: agentId });
			},

			getLastAgentId: (page) => {
				return page === "chat"
					? get().lastChatAgentId
					: get().lastAgentsPageAgentId;
			},

			clearLastAgentId: (page) => {
				if (page === "chat") {
					set({ lastChatAgentId: null });
				} else {
					set({ lastAgentsPageAgentId: null });
				}
			},

			clearAgentFromAllPages: (agentId) => {
				const state = get();
				const updates: Partial<
					Pick<AgentSelectionState, "lastChatAgentId" | "lastAgentsPageAgentId">
				> = {};

				// Check if the agent is selected in the chat page
				if (state.lastChatAgentId === agentId) {
					updates.lastChatAgentId = null;
				}

				// Check if the agent is selected in the agents page
				if (state.lastAgentsPageAgentId === agentId) {
					updates.lastAgentsPageAgentId = null;
				}

				// Only update state if there are changes
				if (Object.keys(updates).length > 0) {
					set(updates);
				}
			},
		}),
		{
			name: "agent-selection-storage",
		},
	),
);
