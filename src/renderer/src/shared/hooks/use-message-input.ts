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
  conversationId?: string;
  onSubmit?: (message: string) => void;
  scrollToBottom?: () => void;
};

/**
 * Hook for managing message input with robust per-conversation persistence and log-based history navigation.
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

  // Hydration state
  const [hydrated, setHydrated] = useState(
    (useConversationInputStore.persist as unknown as { hasHydrated: () => boolean }).hasHydrated?.() ?? false
  );
  const initializedRef = useRef<string | undefined>(undefined);
  const [inputValue, setInputValue] = useState<string>("");

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

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftMessageRef = useRef<string>("");

  // Store state for this conversation
  const submittedMessages = conversationId
    ? getSubmittedMessages(conversationId)
    : [];
  const historyIndex = conversationId
    ? getCurrentHistoryIndex(conversationId)
    : null;

  // On mount or conversation change, set inputValue to the correct state (draft or log message)
  useEffect(() => {
    if (!hydrated) return;
    if (conversationId) {
      const draft = getCurrentInput(conversationId);
      if (historyIndex !== null && submittedMessages.length > 0) {
        setInputValue(submittedMessages[historyIndex] || "");
      } else {
        setInputValue(draft);
      }
      initializedRef.current = conversationId;
      draftMessageRef.current = "";
    } else {
      setInputValue("");
      initializedRef.current = undefined;
      draftMessageRef.current = "";
    }
  }, [conversationId, hydrated, getCurrentInput, historyIndex, submittedMessages]);

  // Only sync inputValue to the store if hydrated and inputValue is not being initialized from the store
  useEffect(() => {
    if (!hydrated) return;
    if (!conversationId) return;
    if (initializedRef.current === conversationId) return;
    setCurrentInput(conversationId, inputValue);
  }, [conversationId, inputValue, setCurrentInput, hydrated]);

  // Handle input change: always reset history navigation and update draft
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

  // Handle form submission
  const handleSubmit = useCallback(() => {
    if (!inputValue.trim() || !conversationId) return;
    onSubmit?.(inputValue);
    addSubmittedMessage(conversationId, inputValue);
    setInputValue("");
    setCurrentInput(conversationId, "");
    resetCurrentHistoryIndex(conversationId);
    draftMessageRef.current = "";
    if (scrollToBottom) {
      setTimeout(() => {
        scrollToBottom();
      }, 150);
    }
  }, [inputValue, conversationId, onSubmit, addSubmittedMessage, setCurrentInput, resetCurrentHistoryIndex, scrollToBottom]);

  // Cursor position helpers
  const getCursorPosition = useCallback((): { line: number; totalLines: number } => {
    const textarea = textareaRef.current;
    if (!textarea) return { line: 0, totalLines: 1 };
    const text = textarea.value;
    const selectionStart = textarea.selectionStart;
    const textUpToCursor = text.substring(0, selectionStart);
    const linesUpToCursor = (textUpToCursor.match(/\n/g) || []).length + 1;
    const totalLines = (text.match(/\n/g) || []).length + 1;
    return { line: linesUpToCursor, totalLines };
  }, []);
  const isCursorAtFirstLine = useCallback((): boolean => getCursorPosition().line === 1, [getCursorPosition]);
  const isCursorAtLastLine = useCallback((): boolean => {
    const { line, totalLines } = getCursorPosition();
    return line === totalLines;
  }, [getCursorPosition]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!conversationId) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
        return;
      }
      if (!submittedMessages.length) return;
      if (e.key === "ArrowUp" && isCursorAtFirstLine()) {
        e.preventDefault();
        if (historyIndex === null) {
          draftMessageRef.current = inputValue;
          setCurrentHistoryIndex(conversationId, submittedMessages.length - 1);
          setInputValue(submittedMessages[submittedMessages.length - 1] || "");
        } else if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setCurrentHistoryIndex(conversationId, newIndex);
          setInputValue(submittedMessages[newIndex] || "");
        }
        setTimeout(() => {
          if (textareaRef.current) {
            const length = textareaRef.current.value.length;
            textareaRef.current.selectionStart = length;
            textareaRef.current.selectionEnd = length;
          }
        }, 0);
      }
      if (e.key === "ArrowDown" && isCursorAtLastLine()) {
        e.preventDefault();
        if (historyIndex !== null) {
          if (historyIndex < submittedMessages.length - 1) {
            const newIndex = historyIndex + 1;
            setCurrentHistoryIndex(conversationId, newIndex);
            setInputValue(submittedMessages[newIndex] || "");
          } else {
            resetCurrentHistoryIndex(conversationId);
            setInputValue(draftMessageRef.current);
            draftMessageRef.current = "";
          }
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

  return {
    inputValue,
    setInputValue: handleChange,
    handleKeyDown,
    handleSubmit,
    textareaRef,
  };
};
