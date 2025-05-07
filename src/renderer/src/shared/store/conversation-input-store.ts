/**
 * Conversation Input Store
 *
 * Manages the current input draft and a log of last submitted messages per conversation.
 * Used to persist input state and provide robust up-arrow navigation for message input.
 */

import { create } from "zustand";

/**
 * State for a single conversation's input
 */
type ConversationInputState = {
  /**
   * The current in-progress message in the input box
   */
  currentInput: string;
  /**
   * The log of last submitted messages (most recent last)
   */
  submittedMessages: string[];
};

/**
 * Store state interface
 */
type ConversationInputStoreState = {
  /**
   * State by conversation ID
   */
  inputByConversation: Record<string, ConversationInputState>;

  /**
   * Set the current input value for a conversation
   * @param conversationId - The ID of the conversation
   * @param value - The input value to set
   */
  setCurrentInput: (conversationId: string, value: string) => void;

  /**
   * Get the current input value for a conversation
   * @param conversationId - The ID of the conversation
   * @returns The current input value or empty string if none exists
   */
  getCurrentInput: (conversationId: string) => string;

  /**
   * Add a submitted message to the log for a conversation
   * @param conversationId - The ID of the conversation
   * @param message - The submitted message to add
   */
  addSubmittedMessage: (conversationId: string, message: string) => void;

  /**
   * Get the log of submitted messages for a conversation
   * @param conversationId - The ID of the conversation
   * @returns The array of submitted messages (most recent last)
   */
  getSubmittedMessages: (conversationId: string) => string[];

  /**
   * Clear the submitted message log for a conversation
   * @param conversationId - The ID of the conversation
   */
  clearSubmittedMessages: (conversationId: string) => void;

  /**
   * Clear all input state for a conversation
   * @param conversationId - The ID of the conversation
   */
  clearAll: (conversationId: string) => void;
};

/**
 * Maximum number of submitted messages to keep in the log per conversation
 */
const MAX_SUBMITTED_MESSAGES = 20;

/**
 * Zustand store implementation
 */
export const useConversationInputStore = create<ConversationInputStoreState>((set, get) => ({
  inputByConversation: {},

  setCurrentInput: (conversationId, value) => {
    set((state) => {
      const existing = state.inputByConversation[conversationId] || {
        currentInput: "",
        submittedMessages: [],
      };
      return {
        inputByConversation: {
          ...state.inputByConversation,
          [conversationId]: {
            ...existing,
            currentInput: value,
          },
        },
      };
    });
  },

  getCurrentInput: (conversationId) => {
    return get().inputByConversation[conversationId]?.currentInput || "";
  },

  addSubmittedMessage: (conversationId, message) => {
    set((state) => {
      const existing = state.inputByConversation[conversationId] || {
        currentInput: "",
        submittedMessages: [],
      };
      // Avoid duplicate consecutive entries
      const last = existing.submittedMessages[existing.submittedMessages.length - 1];
      const newMessages =
        message && message !== last
          ? [
              ...existing.submittedMessages.slice(-MAX_SUBMITTED_MESSAGES + 1),
              message,
            ]
          : existing.submittedMessages;
      return {
        inputByConversation: {
          ...state.inputByConversation,
          [conversationId]: {
            ...existing,
            submittedMessages: newMessages,
          },
        },
      };
    });
  },

  getSubmittedMessages: (conversationId) => {
    return get().inputByConversation[conversationId]?.submittedMessages || [];
  },

  clearSubmittedMessages: (conversationId) => {
    set((state) => {
      const existing = state.inputByConversation[conversationId];
      if (!existing) return state;
      return {
        inputByConversation: {
          ...state.inputByConversation,
          [conversationId]: {
            ...existing,
            submittedMessages: [],
          },
        },
      };
    });
  },

  clearAll: (conversationId) => {
    set((state) => {
      const { [conversationId]: _, ...rest } = state.inputByConversation;
      return {
        inputByConversation: rest,
      };
    });
  },
}));
