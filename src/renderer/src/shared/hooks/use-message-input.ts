/**
 * Hook for managing message input with robust per-conversation persistence and log-based history navigation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useConversationInputStore } from "../store/conversation-input-store";

/**
 * Options for the useMessageInput hook
 */
type UseMessageInputOptions = {
  /**
   * The ID of the current conversation
   */
  conversationId?: string;

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
 * Hook for managing message input with robust per-conversation persistence and log-based history navigation.
 *
 * @param options - Configuration options
 * @returns Object with input state and handlers
 */
export const useMessageInput = ({
  conversationId,
  onSubmit,
  scrollToBottom,
}: UseMessageInputOptions) => {
  // Store selectors
  const getCurrentInput = useConversationInputStore((s) => s.getCurrentInput);
  const setCurrentInput = useConversationInputStore((s) => s.setCurrentInput);
  const addSubmittedMessage = useConversationInputStore((s) => s.addSubmittedMessage);
  const getSubmittedMessages = useConversationInputStore((s) => s.getSubmittedMessages);
  const getCurrentHistoryIndex = useConversationInputStore((s) => s.getCurrentHistoryIndex);
  const setCurrentHistoryIndex = useConversationInputStore((s) => s.setCurrentHistoryIndex);
  const resetCurrentHistoryIndex = useConversationInputStore((s) => s.resetCurrentHistoryIndex);

  // Robust hydration state using subscription to persist events
  const [hydrated, setHydrated] = useState(
    (useConversationInputStore.persist as unknown as { hasHydrated: () => boolean }).hasHydrated?.() ?? false
  );
  const initializedRef = useRef<string | undefined>(undefined);
  const [inputValue, setInputValue] = useState<string>("");

  // Always subscribe to hydration events at the top level
  useEffect(() => {
    const persist = useConversationInputStore.persist as unknown as {
      onHydrate: (fn: () => void) => () => void;
      onFinishHydration: (fn: () => void) => () => void;
      hasHydrated: () => boolean;
    };
    let unsubHydrate: (() => void) | undefined;
    let unsubFinish: (() => void) | undefined;
    if (persist && typeof persist.onHydrate === "function" && typeof persist.onFinishHydration === "function") {
      unsubHydrate = persist.onHydrate(() => setHydrated(false));
      unsubFinish = persist.onFinishHydration(() => setHydrated(true));
      setHydrated(persist.hasHydrated());
    } else {
      setHydrated(true);
    }
    return () => {
      unsubHydrate?.();
      unsubFinish?.();
    };
  }, []);

  // Reference to the textarea element
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Ref to store the draft message when navigating history
  const draftMessageRef = useRef<string>("");

  // Get the submitted messages log and navigation index for this conversation
  const submittedMessages = conversationId
    ? getSubmittedMessages(conversationId)
    : [];
  const historyIndex = conversationId
    ? getCurrentHistoryIndex(conversationId)
    : null;

  /**
   * Handle input change
   */
  const handleChange = useCallback(
    (value: string) => {
      setInputValue(value);
      if (conversationId) {
        setCurrentInput(conversationId, value);
        resetCurrentHistoryIndex(conversationId);
      }
    },
    [conversationId, setCurrentInput, resetCurrentHistoryIndex]
  );

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(() => {
    if (!inputValue.trim() || !conversationId) return;

    // Call the onSubmit callback
    onSubmit?.(inputValue);

    // Add to submitted messages log
    addSubmittedMessage(conversationId, inputValue);

    // Clear the input
    setInputValue("");
    setCurrentInput(conversationId, "");

    // Reset history navigation
    resetCurrentHistoryIndex(conversationId);
    draftMessageRef.current = "";

    // Scroll to bottom when sending a message, with a slight delay
    if (scrollToBottom) {
      setTimeout(() => {
        scrollToBottom();
      }, 150);
    }
  }, [inputValue, conversationId, onSubmit, addSubmittedMessage, setCurrentInput, resetCurrentHistoryIndex, scrollToBottom]);

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
   * Handle keyboard events for up/down navigation
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!conversationId) return;

      // Handle Enter key for submission
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
        return;
      }

      // Skip if no submitted messages
      if (!submittedMessages.length) {
        return;
      }

      // Handle arrow up for history navigation
      if (e.key === "ArrowUp" && isCursorAtFirstLine()) {
        e.preventDefault();

        // Save current input if starting navigation
        if (historyIndex === null) {
          draftMessageRef.current = inputValue;
          // Start from the most recent message
          setCurrentHistoryIndex(conversationId, submittedMessages.length - 1);
          setInputValue(submittedMessages[submittedMessages.length - 1] || "");
        }
        // Navigate to previous message if not at the beginning
        else if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setCurrentHistoryIndex(conversationId, newIndex);
          setInputValue(submittedMessages[newIndex] || "");
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
          if (historyIndex < submittedMessages.length - 1) {
            const newIndex = historyIndex + 1;
            setCurrentHistoryIndex(conversationId, newIndex);
            setInputValue(submittedMessages[newIndex] || "");
          }
          // Return to draft message if at the end
          else {
            resetCurrentHistoryIndex(conversationId);
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
      submittedMessages,
      conversationId,
      setCurrentHistoryIndex,
      resetCurrentHistoryIndex,
    ]
  );

  // On mount or conversation change, sync input value and navigation index from store
  useEffect(() => {
    if (!hydrated) return;
    if (conversationId) {
      const storeValue = getCurrentInput(conversationId);
      setInputValue(storeValue);
      initializedRef.current = conversationId;
      draftMessageRef.current = "";
    } else {
      setInputValue("");
      initializedRef.current = undefined;
      draftMessageRef.current = "";
    }
  }, [conversationId, hydrated, getCurrentInput]);

  // Only sync inputValue to the store if hydrated and inputValue is not being initialized from the store
  useEffect(() => {
    if (!hydrated) return;
    if (!conversationId) return;
    // Don't sync to store if this is the first initialization for this conversation
    if (initializedRef.current === conversationId) return;
    setCurrentInput(conversationId, inputValue);
  }, [conversationId, inputValue, setCurrentInput, hydrated]);

  return {
    inputValue,
    setInputValue: handleChange,
    handleKeyDown,
    handleSubmit,
    textareaRef,
  };
};
