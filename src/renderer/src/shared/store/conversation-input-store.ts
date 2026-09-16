/**
 * Conversation Input Store
 *
 * Manages the current input draft, a log of last submitted messages, and the current history navigation index per conversation.
 * Used to persist input state and provide robust up-arrow navigation for message input.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Represents a reply to a message
 */
export type Reply = {
	id: string;
	text: string;
};

export type Attachment = {
	id: string;
	path: string;
};

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
	/**
	 * The current index for up/down navigation in the submittedMessages log (null = not navigating)
	 */
	currentHistoryIndex: number | null;
	/**
	 * A list of replies to be sent with the next message
	 */
	replies: Reply[];
	/**
	 * A list of attachments to be sent with the next message
	 */
	attachments: Attachment[];
	/**
	 * How many characters of `currentInput` are characters an Esc unredacted back
	 * into the composer as PLAIN TEXT, or 0/absent when the draft holds none.
	 *
	 * §6 persists the Esc-restored characters deliberately — they are the
	 * operator's prose by then — and design round 2's D2 found the other half of
	 * that decision missing: the DISCLOSURE did not survive with them, so a reload
	 * brought back a composer holding a secret with no notice, no arm and no pill,
	 * and one Enter exposed it. §5 says that state must never be silent, so the
	 * count travels with the draft it describes and the composer re-raises the
	 * same sentence on restore.
	 *
	 * A count rather than a sentence, because every phrase the app says about this
	 * state is built by one authority (`unredactedNotice`) and a stored string
	 * would be a second copy of the words. A count is also all the disclosure
	 * needs: the notice says how many characters, never which.
	 */
	unredactedChars?: number;
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
	 * Adds a reply to the list of replies for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param reply - The reply to add
	 */
	addReply: (conversationId: string, reply: Reply) => void;

	/**
	 * Removes a reply from the list of replies for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param replyId - The ID of the reply to remove
	 */
	removeReply: (conversationId: string, replyId: string) => void;

	/**
	 * Clears all replies for a conversation
	 * @param conversationId - The ID of the conversation
	 */
	clearReplies: (conversationId: string) => void;

	addAttachment: (conversationId: string, attachment: Attachment) => void;

	removeAttachment: (conversationId: string, attachmentId: string) => void;

	clearAttachments: (conversationId: string) => void;

	/**
	 * Set the current input value for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param value - The input value to set
	 * @param unredactedChars - How many characters of `value` were unredacted by an
	 * Esc cancel; see {@link ConversationInputState.unredactedChars}. Defaulted to
	 * 0 by every caller that is not the composer's own capture write, so a plain
	 * draft write states "this draft discloses nothing" rather than leaving a
	 * previous disclosure pinned to text it no longer describes.
	 */
	setCurrentInput: (
		conversationId: string,
		value: string,
		unredactedChars?: number,
	) => void;

	/**
	 * How many characters of a conversation's draft are disclosed plain text.
	 * @returns 0 when the conversation holds no draft, or holds one that
	 * discloses nothing.
	 */
	getUnredactedChars: (conversationId: string) => number;

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
	 * Get the current history navigation index for a conversation
	 * @param conversationId - The ID of the conversation
	 * @returns The current history index or null if not navigating
	 */
	getCurrentHistoryIndex: (conversationId: string) => number | null;

	/**
	 * Set the current history navigation index for a conversation
	 * @param conversationId - The ID of the conversation
	 * @param index - The index to set (null = not navigating)
	 */
	setCurrentHistoryIndex: (
		conversationId: string,
		index: number | null,
	) => void;

	/**
	 * Reset the history navigation index for a conversation (set to null)
	 * @param conversationId - The ID of the conversation
	 */
	resetCurrentHistoryIndex: (conversationId: string) => void;

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
export const useConversationInputStore = create<ConversationInputStoreState>()(
	persist(
		(set, get) => ({
			inputByConversation: {},

			addReply: (conversationId, reply) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [],
				};
				const existingReplies = Array.isArray(existing.replies)
					? existing.replies
					: [];
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							replies: [...existingReplies, reply],
						},
					},
				});
			},

			removeReply: (conversationId, replyId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							replies: existing.replies.filter((r) => r.id !== replyId),
						},
					},
				});
			},

			clearReplies: (conversationId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							replies: [],
						},
					},
				});
			},

			addAttachment: (conversationId, attachment) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [],
				};
				const existingAttachments = Array.isArray(existing.attachments)
					? existing.attachments
					: [];
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							attachments: [...existingAttachments, attachment],
						},
					},
				});
			},

			removeAttachment: (conversationId, attachmentId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							attachments: existing.attachments.filter(
								(a) => a.id !== attachmentId,
							),
						},
					},
				});
			},

			clearAttachments: (conversationId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							attachments: [],
						},
					},
				});
			},

			setCurrentInput: (conversationId, value, unredactedChars = 0) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [],
				};
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							currentInput: value,
							/*
							 * AN EMPTY DRAFT DISCLOSES NOTHING, enforced here rather than at each
							 * writer so it cannot be forgotten by one of them: the sentence says
							 * "N characters are now PLAIN TEXT in the composer", and a box holding
							 * no characters cannot be holding N of them. That is reachable
							 * through the ordinary edit path — the operator selects all and
							 * deletes, which writes the empty draft with the disclosure still in
							 * hand — and a restored notice over an empty box is a claim about
							 * nothing.
							 */
							unredactedChars: value ? unredactedChars : 0,
						},
					},
				});
			},

			getUnredactedChars: (conversationId) =>
				get().inputByConversation[conversationId]?.unredactedChars || 0,

			getCurrentInput: (conversationId) => {
				return get().inputByConversation[conversationId]?.currentInput || "";
			},

			addSubmittedMessage: (conversationId, message) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [],
				};
				// Avoid duplicate consecutive entries
				const last =
					existing.submittedMessages[existing.submittedMessages.length - 1];
				const newMessages =
					message && message !== last
						? [
								...existing.submittedMessages.slice(
									-MAX_SUBMITTED_MESSAGES + 1,
								),
								message,
							]
						: existing.submittedMessages;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							submittedMessages: newMessages,
						},
					},
				});
			},

			getSubmittedMessages: (conversationId) => {
				return (
					get().inputByConversation[conversationId]?.submittedMessages || []
				);
			},

			clearSubmittedMessages: (conversationId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							submittedMessages: [],
						},
					},
				});
			},

			getCurrentHistoryIndex: (conversationId) => {
				return (
					get().inputByConversation[conversationId]?.currentHistoryIndex ?? null
				);
			},

			/**
			 * Set the current history navigation index for a conversation, clamped to valid range.
			 * @param conversationId - The ID of the conversation
			 * @param index - The index to set (null = not navigating)
			 */
			setCurrentHistoryIndex: (conversationId, index) => {
				const existing = get().inputByConversation[conversationId] || {
					currentInput: "",
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [],
				};
				const messages = existing.submittedMessages;
				let clampedIndex: number | null = null;
				if (typeof index === "number" && messages.length > 0) {
					clampedIndex = Math.max(0, Math.min(index, messages.length - 1));
				}
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							currentHistoryIndex: clampedIndex,
						},
					},
				});
			},

			resetCurrentHistoryIndex: (conversationId) => {
				const existing = get().inputByConversation[conversationId];
				if (!existing) return;
				set({
					inputByConversation: {
						...get().inputByConversation,
						[conversationId]: {
							...existing,
							currentHistoryIndex: null,
						},
					},
				});
			},

			clearAll: (conversationId) => {
				const { [conversationId]: _, ...rest } = get().inputByConversation;
				set({
					inputByConversation: rest,
				});
			},
		}),
		{
			name: "conversation-input-store",
			partialize: (state) => ({
				inputByConversation: state.inputByConversation,
			}),
		},
	),
);
