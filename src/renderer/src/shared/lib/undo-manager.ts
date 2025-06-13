/**
 * Custom Undo/Redo Manager for contenteditable elements
 * 
 * Provides reliable undo/redo functionality that works with both user-initiated
 * and programmatic changes to contenteditable elements.
 */

type UndoManagerOptions = {
  maxHistory?: number;
  debounceDelay?: number;
  onStateChange?: (canUndo: boolean, canRedo: boolean) => void;
};

type HistoryState = {
  content: string;
  timestamp: number;
  selection?: {
    startContainer: string;
    startOffset: number;
    endContainer: string;
    endOffset: number;
  };
};

export class UndoManager {
  private history: HistoryState[] = [];
  private pointer = -1;
  private maxHistory: number;
  private debounceDelay: number;
  private element: HTMLElement;
  private mutationObserver: MutationObserver;
  private isUndoingOrRedoing = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private keyboardListener: (event: KeyboardEvent) => void;
  private beforeInputListener: (event: InputEvent) => void;
  private mutationHandler: (mutations: MutationRecord[]) => void;
  private isConnected = false;
  private onStateChange?: (canUndo: boolean, canRedo: boolean) => void;

  constructor(element: HTMLElement, options: UndoManagerOptions = {}) {
    this.element = element;
    this.maxHistory = options.maxHistory || 100;
    this.debounceDelay = options.debounceDelay || 500;
    this.onStateChange = options.onStateChange;

    // Bind event handlers
    this.keyboardListener = this.handleKeyDown.bind(this);
    this.beforeInputListener = this.handleBeforeInput.bind(this);
    this.mutationHandler = this.handleMutation.bind(this);

    // Initialize mutation observer
    this.mutationObserver = new MutationObserver(this.mutationHandler);
  }

  /**
   * Connect the undo manager to start listening for changes
   */
  public connect(): void {
    if (this.isConnected) return;

    // Add initial state if history is empty
    if (this.history.length === 0) {
        this.addState(this.element.innerHTML);
    }

    this.element.addEventListener('beforeinput', this.beforeInputListener);
    this.mutationObserver.observe(this.element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    document.addEventListener('keydown', this.keyboardListener);
    this.isConnected = true;
  }

  /**
   * Disconnect the undo manager to stop listening for changes
   */
  public disconnect(): void {
    if (!this.isConnected) return;

    this.element.removeEventListener('beforeinput', this.beforeInputListener);
    this.mutationObserver.disconnect();
    document.removeEventListener('keydown', this.keyboardListener);
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    
    this.isConnected = false;
  }

  /**
   * Notify state change callback
   */
  private notifyStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange(this.canUndo(), this.canRedo());
    }
  }

  /**
   * Add a new state to the history stack
   */
  private addState(content: string): void {
    if (this.isUndoingOrRedoing) {
      return;
    }

    // Don't add duplicate states
    if (this.history.length > 0 && this.history[this.pointer]?.content === content) {
      return;
    }

    // When a new state is added, clear the "redo" history
    if (this.pointer < this.history.length - 1) {
      this.history = this.history.slice(0, this.pointer + 1);
    }

    const selection = this.serializeSelection();
    const state: HistoryState = {
      content,
      timestamp: Date.now(),
      selection,
    };

    this.history.push(state);

    // Enforce history limit
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    } else {
      this.pointer++;
    }

    this.notifyStateChange();
  }

  /**
   * Add state with debouncing to batch rapid changes
   */
  private addStateDebounced(content: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.addState(content);
      this.debounceTimer = null;
    }, this.debounceDelay);
  }

  /**
   * Serialize the current selection for restoration
   */
  private serializeSelection(): HistoryState['selection'] | undefined {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return undefined;

    const range = selection.getRangeAt(0);
    
    try {
      return {
        startContainer: this.getNodePath(range.startContainer),
        startOffset: range.startOffset,
        endContainer: this.getNodePath(range.endContainer),
        endOffset: range.endOffset,
      };
    } catch (error) {
      console.warn('Failed to serialize selection:', error);
      return undefined;
    }
  }

  /**
   * Get a path to a node for serialization
   */
  private getNodePath(node: Node): string {
    const path: number[] = [];
    let current = node;

    while (current && current !== this.element) {
      const parent = current.parentNode;
      if (!parent) break;

      const index = Array.from(parent.childNodes).indexOf(current as ChildNode);
      path.unshift(index);
      current = parent;
    }

    return path.join(',');
  }

  /**
   * Restore selection from serialized state
   */
  private restoreSelection(selectionState?: HistoryState['selection']): void {
    if (!selectionState) return;

    try {
      const startContainer = this.getNodeFromPath(selectionState.startContainer);
      const endContainer = this.getNodeFromPath(selectionState.endContainer);

      if (!startContainer || !endContainer) return;

      const range = document.createRange();
      range.setStart(startContainer, Math.min(selectionState.startOffset, startContainer.textContent?.length || 0));
      range.setEnd(endContainer, Math.min(selectionState.endOffset, endContainer.textContent?.length || 0));

      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (error) {
      console.warn('Failed to restore selection:', error);
      // Fallback: try to place cursor at a reasonable position instead of end
      this.restoreSelectionFallback(selectionState);
    }
  }

  /**
   * Get a node from a serialized path
   */
  private getNodeFromPath(path: string): Node | null {
    if (!path) return null;

    const indices = path.split(',').map(Number);
    let current: Node = this.element;

    for (const index of indices) {
      if (!current.childNodes[index]) return null;
      current = current.childNodes[index];
    }

    return current;
  }

  /**
   * Fallback selection restoration when exact restoration fails
   */
  private restoreSelectionFallback(selectionState: HistoryState['selection']): void {
    if (!selectionState) {
      this.placeCursorAtBeginning();
      return;
    }

    try {
      // Try to find a text node at approximately the same position
      const walker = document.createTreeWalker(
        this.element,
        NodeFilter.SHOW_TEXT,
        null
      );

      let textNode: Node | null = walker.nextNode();
      let currentOffset = 0;
      const targetOffset = selectionState.startOffset;

      while (textNode) {
        const textLength = textNode.textContent?.length || 0;
        if (currentOffset + textLength >= targetOffset) {
          // Found a suitable text node
          const range = document.createRange();
          const localOffset = Math.min(targetOffset - currentOffset, textLength);
          range.setStart(textNode, localOffset);
          range.collapse(true);

          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
          return;
        }
        currentOffset += textLength;
        textNode = walker.nextNode();
      }

      // If all else fails, place cursor at the beginning of the first text node
      walker.currentNode = this.element;
      textNode = walker.nextNode();
      if (textNode) {
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.collapse(true);

        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } else {
        // Last resort: place cursor at the beginning of the element
        this.placeCursorAtBeginning();
      }
    } catch (error) {
      console.warn('Fallback selection restoration failed:', error);
      this.placeCursorAtBeginning();
    }
  }

  /**
   * Place cursor at the beginning of the content
   */
  private placeCursorAtBeginning(): void {
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(this.element);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /**
   * Apply a state from history
   */
  private applyState(state: HistoryState): void {
    this.isUndoingOrRedoing = true;
    this.mutationObserver.disconnect();

    // Clear any pending debounced state additions
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.element.innerHTML = state.content;
    this.restoreSelection(state.selection);

    // Reconnect observer
    this.mutationObserver.observe(this.element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });

    this.isUndoingOrRedoing = false;
  }

  /**
   * Undo the last action
   */
  public undo(): boolean {
    if (!this.canUndo()) return false;

    this.pointer--;
    this.applyState(this.history[this.pointer]);
    this.notifyStateChange();
    return true;
  }

  /**
   * Redo the next action
   */
  public redo(): boolean {
    if (!this.canRedo()) return false;

    this.pointer++;
    this.applyState(this.history[this.pointer]);
    this.notifyStateChange();
    return true;
  }

  /**
   * Check if undo is possible
   */
  public canUndo(): boolean {
    return this.pointer > 0;
  }

  /**
   * Check if redo is possible
   */
  public canRedo(): boolean {
    return this.pointer < this.history.length - 1;
  }

  /**
   * Get current history state for debugging
   */
  public getHistoryState(): { length: number; pointer: number } {
    return {
      length: this.history.length,
      pointer: this.pointer,
    };
  }

  /**
   * Clear all history
   */
  public clearHistory(): void {
    this.history = [];
    this.pointer = -1;
    this.addState(this.element.innerHTML);
  }

  /**
   * Reset the manager for a new document
   */
  public resetForNewDocument(newElement: HTMLElement): void {
    // Disconnect from old element
    this.disconnect();
    
    // Update element reference
    this.element = newElement;
    
    // Clear history and start fresh
    this.history = [];
    this.pointer = -1;
    
    // Reconnect to new element
    this.connect();
    
    // Add initial state for new document
    this.addState(this.element.innerHTML);
    
    // Notify state change
    this.notifyStateChange();
  }

  /**
   * Handle beforeinput events (user-initiated changes)
   */
  private handleBeforeInput(): void {
    // Save state before user input
    this.addState(this.element.innerHTML);
  }

  /**
   * Handle mutation events (programmatic changes)
   */
  private handleMutation(mutations: MutationRecord[]): void {
    // Only process mutations if they're not from undo/redo operations
    if (this.isUndoingOrRedoing) return;

    // Check if there were actual content changes
    const hasContentChanges = mutations.some(mutation => 
      mutation.type === 'childList' || 
      mutation.type === 'characterData' ||
      (mutation.type === 'attributes' && mutation.attributeName !== 'data-highlight')
    );

    if (hasContentChanges) {
      // Use debounced state addition for programmatic changes
      this.addStateDebounced(this.element.innerHTML);
    }
  }

  /**
   * Handle keyboard shortcuts
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // Only handle events when the target is within our element
    if (!this.element.contains(event.target as Node)) return;

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCtrlOrCmd = isMac ? event.metaKey : event.ctrlKey;

    if (!isCtrlOrCmd) return;

    if (event.key === 'z' && !event.shiftKey) {
      // Undo
      event.preventDefault();
      event.stopPropagation();
      this.undo();
    } else if ((event.key === 'y') || (event.key === 'z' && event.shiftKey)) {
      // Redo
      event.preventDefault();
      event.stopPropagation();
      this.redo();
    }
  }

  /**
   * Force save current state (useful before programmatic changes)
   */
  public saveCurrentState(): void {
    this.addState(this.element.innerHTML);
  }

  /**
   * Check if the manager is currently connected
   */
  public isConnectedToElement(): boolean {
    return this.isConnected;
  }
}
