import { useRef, useEffect } from 'react';
import type { DependencyList } from 'react';

/**
 * Custom hook to scroll to the bottom of a container when the content changes
 * @returns A ref to attach to the element to scroll to
 */
export const useScrollToBottom = (dependencies: DependencyList = []) => {
  const ref = useRef<HTMLDivElement>(null);
  
  // Scroll to bottom when dependencies change
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, dependencies);
  
  return ref;
};
