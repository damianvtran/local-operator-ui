import { useCallback, useEffect, useRef, useState } from "react";

export const useScrollToBottom = (
  buttonThreshold = 50,
  externalContainerRef?: React.RefObject<HTMLDivElement>,
  contentKey?: unknown,
) => {
  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = externalContainerRef || internalContainerRef;

  const [isFarFromBottom, setIsFarFromBottom] = useState(false);
  const isHandlingScrollRef = useRef(false);
  const lastUpdateTimeRef = useRef(0);
  const prevContentKeyRef = useRef<unknown>(contentKey);

  /**
   * Recalculate whether we're far from bottom and update visibility.
   * Throttles updates to at most once per 100ms.
   */
  const updateScrollPosition = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = Math.abs(scrollTop);
    const canScroll = scrollHeight > clientHeight;
    const shouldShow = canScroll && distanceFromBottom > buttonThreshold;
    const now = Date.now();

    if (
      shouldShow !== isFarFromBottom &&
      now - lastUpdateTimeRef.current > 100
    ) {
      lastUpdateTimeRef.current = now;
      setIsFarFromBottom(shouldShow);
    }
  }, [buttonThreshold, containerRef, isFarFromBottom]);

  /**
   * Smoothly scroll to bottom (scrollTop = 0 in column-reverse layouts).
   */
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: 0, behavior: "smooth" });
    // Recheck after the animation kicks off
    requestAnimationFrame(updateScrollPosition);
  }, [containerRef, updateScrollPosition]);

  /**
   * Handle user-initiated scroll events.
   * Uses requestAnimationFrame to batch updates and avoid recursion.
   */
  const handleScroll = useCallback(() => {
    if (!containerRef.current || isHandlingScrollRef.current) return;
    isHandlingScrollRef.current = true;
    requestAnimationFrame(() => {
      updateScrollPosition();
      isHandlingScrollRef.current = false;
    });
  }, [containerRef, updateScrollPosition]);

  /**
   * Set up scroll listener, reset on conversation switch,
   * and perform initial checks for new content.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Reset button state when switching conversations
    if (prevContentKeyRef.current !== contentKey) {
      setIsFarFromBottom(false);
      lastUpdateTimeRef.current = 0;
      prevContentKeyRef.current = contentKey;
    }

    container.addEventListener("scroll", handleScroll, { passive: true });

    // Initial checks to account for layout/render timing
    const rafId = requestAnimationFrame(updateScrollPosition);
    const timeoutId = window.setTimeout(updateScrollPosition, 100);
    const longTimeoutId = window.setTimeout(updateScrollPosition, 500);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
      clearTimeout(longTimeoutId);
    };
  }, [containerRef, contentKey, handleScroll, updateScrollPosition]);

  /**
   * Recalculate on window resize.
   */
  useEffect(() => {
    const onResize = () => {
      updateScrollPosition();
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [updateScrollPosition]);

  /**
   * Recalculate whenever content size changes.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      updateScrollPosition();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [containerRef, updateScrollPosition]);

  return {
    containerRef,
    isFarFromBottom,
    scrollToBottom,
  };
};
