/**
 * Hook for managing message input with history navigation
 */

import type { Message } from "@renderer/features/chat/types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

/**
 * Options for the useMessageInput hook
 */
type UseMessageInputOptions = {
	/**
	 * The ID of the current conversation
	 */
	conversationId?: string;

	/**
	 * All messages in the conversation
	 */
	messages: Message[];

	/**
	 * Callback when a message is submitted
	 */
	onSubmit?: (message: string) => void;

	/**
	 * Function to scroll to the bottom of the messages container
	 * Will be called when a message is submitted
	 */
	scrollToBottom?: () => void;
};

/**
 * Hook for managing message input with history navigation
 *
 * @param options - Configuration options
 * @returns Object with input state and handlers
 */
export const useMessageInput = ({
	conversationId,
	messages,
	onSubmit,
	scrollToBottom,
}: UseMessageInputOptions) => {
	// State for the current input value
	const [inputValue, setInputValue] = useState("");

	// Reference to the textarea element
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	// State to track history navigation
	const [historyIndex, setHistoryIndex] = useState<number | null>(null);

	// Ref to store the draft message when navigating history
	const draftMessageRef = useRef("");

	// Filter user messages
	const userMessages = messages.filter((msg) => msg.role === "user");

	/**
	 * Handle input change
	 */
	const handleChange = useCallback((value: string) => {
		setInputValue(value);
		// Reset history navigation when user types
		setHistoryIndex(null);
	}, []);

	/**
	 * Handle form submission
	 */
	const handleSubmit = useCallback(() => {
		if (!inputValue.trim()) return;

		// Call the onSubmit callback
		onSubmit?.(inputValue);

		// Clear the input
		setInputValue("");

		// Reset history navigation
		setHistoryIndex(null);
		draftMessageRef.current = "";

		// Scroll to bottom when sending a message
		if (scrollToBottom) {
			scrollToBottom();
		}
	}, [inputValue, onSubmit, scrollToBottom]);

	/**
	 * Get the current cursor position in the textarea
	 */
	const getCursorPosition = useCallback((): {
		line: number;
		totalLines: number;
	} => {
		const textarea = textareaRef.current;
		if (!textarea) return { line: 0, totalLines: 1 };

		const text = textarea.value;
		const selectionStart = textarea.selectionStart;

		// Count lines up to the cursor position
		const textUpToCursor = text.substring(0, selectionStart);
		const linesUpToCursor = (textUpToCursor.match(/\n/g) || []).length + 1;

		// Count total lines
		const totalLines = (text.match(/\n/g) || []).length + 1;

		return { line: linesUpToCursor, totalLines };
	}, []);

	/**
	 * Check if cursor is at the first line
	 */
	const isCursorAtFirstLine = useCallback((): boolean => {
		const { line } = getCursorPosition();
		return line === 1;
	}, [getCursorPosition]);

	/**
	 * Check if cursor is at the last line
	 */
	const isCursorAtLastLine = useCallback((): boolean => {
		const { line, totalLines } = getCursorPosition();
		return line === totalLines;
	}, [getCursorPosition]);

	/**
	 * Handle keyboard events
	 */
	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLDivElement>) => {
			// Handle Enter key for submission
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSubmit();
				return;
			}

			// Skip if no user messages
			if (userMessages.length === 0) {
				return;
			}

			// Handle arrow up for history navigation
			if (e.key === "ArrowUp" && isCursorAtFirstLine()) {
				e.preventDefault();

				// Save current input if starting navigation
				if (historyIndex === null) {
					draftMessageRef.current = inputValue;
					// Start from the most recent message
					setHistoryIndex(userMessages.length - 1);
					setInputValue(userMessages[userMessages.length - 1].message || "");
				}
				// Navigate to previous message if not at the beginning
				else if (historyIndex > 0) {
					const newIndex = historyIndex - 1;
					setHistoryIndex(newIndex);
					setInputValue(userMessages[newIndex].message || "");
				}

				// Set cursor position at the end in the next render
				setTimeout(() => {
					if (textareaRef.current) {
						const length = textareaRef.current.value.length;
						textareaRef.current.selectionStart = length;
						textareaRef.current.selectionEnd = length;
					}
				}, 0);
			}

			// Handle arrow down for history navigation
			if (e.key === "ArrowDown" && isCursorAtLastLine()) {
				e.preventDefault();

				// Only handle if we're navigating history
				if (historyIndex !== null) {
					// Navigate to next message if not at the end
					if (historyIndex < userMessages.length - 1) {
						const newIndex = historyIndex + 1;
						setHistoryIndex(newIndex);
						setInputValue(userMessages[newIndex].message || "");
					}
					// Return to draft message if at the end
					else {
						setHistoryIndex(null);
						setInputValue(draftMessageRef.current);
						draftMessageRef.current = "";
					}

					// Set cursor position at the end in the next render
					setTimeout(() => {
						if (textareaRef.current) {
							const length = textareaRef.current.value.length;
							textareaRef.current.selectionStart = length;
							textareaRef.current.selectionEnd = length;
						}
					}, 0);
				}
			}
		},
		[
			handleSubmit,
			isCursorAtFirstLine,
			isCursorAtLastLine,
			historyIndex,
			inputValue,
			userMessages,
		],
	);

	// Reset input and history when conversation changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: conversationId is intentionally the only dependency to reset state when conversation changes
	useEffect(() => {
		setInputValue("");
		setHistoryIndex(null);
		draftMessageRef.current = "";
	}, [conversationId]);

	return {
		inputValue,
		setInputValue: handleChange,
		handleKeyDown,
		handleSubmit,
		textareaRef,
	};
};
