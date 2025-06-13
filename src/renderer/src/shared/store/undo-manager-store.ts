import { create } from 'zustand';
import { UndoManager } from '@shared/lib/undo-manager';

type UndoManagerState = {
  managers: Map<string, UndoManager>;
  getManager: (documentId: string, element?: HTMLElement, onStateChange?: (canUndo: boolean, canRedo: boolean) => void) => UndoManager | null;
  createManager: (documentId: string, element: HTMLElement, onStateChange?: (canUndo: boolean, canRedo: boolean) => void) => UndoManager;
  removeManager: (documentId: string) => void;
  clearAllManagers: () => void;
};

export const useUndoManagerStore = create<UndoManagerState>((set, get) => ({
  managers: new Map(),

  getManager: (documentId: string, element?: HTMLElement, onStateChange?: (canUndo: boolean, canRedo: boolean) => void) => {
    const state = get();
    let manager = state.managers.get(documentId);
    
    if (!manager && element) {
      manager = state.createManager(documentId, element, onStateChange);
    }
    
    return manager || null;
  },

  createManager: (documentId: string, element: HTMLElement, onStateChange?: (canUndo: boolean, canRedo: boolean) => void) => {
    const state = get();
    
    // Clean up existing manager if any
    const existingManager = state.managers.get(documentId);
    if (existingManager) {
      existingManager.disconnect();
    }

    const manager = new UndoManager(element, {
      maxHistory: 50,
      debounceDelay: 250,
      onStateChange,
    });

    manager.connect();

    set(state => ({
      managers: new Map(state.managers).set(documentId, manager),
    }));

    return manager;
  },

  removeManager: (documentId: string) => {
    const state = get();
    const manager = state.managers.get(documentId);
    
    if (manager) {
      manager.disconnect();
      
      set(state => {
        const newManagers = new Map(state.managers);
        newManagers.delete(documentId);
        return { managers: newManagers };
      });
    }
  },

  clearAllManagers: () => {
    const state = get();
    
    // Disconnect all managers
    for (const manager of state.managers.values()) {
      manager.disconnect();
    }
    
    set({ managers: new Map() });
  },
}));
