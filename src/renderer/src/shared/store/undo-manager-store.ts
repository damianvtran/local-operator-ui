import { create } from 'zustand';
import { UndoManager } from '@shared/lib/undo-manager';

type UndoManagerState = {
	managers: Map<string, UndoManager>;
	getOrCreateManager: (
		documentId: string,
		element: HTMLElement,
		onStateChange: (canUndo: boolean, canRedo: boolean) => void,
	) => UndoManager;
	removeManager: (documentId: string) => void;
	clearAllManagers: () => void;
};

export const useUndoManagerStore = create<UndoManagerState>((set, get) => ({
	managers: new Map(),

	getOrCreateManager: (
		documentId: string,
		element: HTMLElement,
		onStateChange: (canUndo: boolean, canRedo: boolean) => void,
	) => {
		const state = get();
		const existingManager = state.managers.get(documentId);
		if (existingManager) {
			return existingManager;
		}

		const manager = new UndoManager(element, {
			maxHistory: 50,
			debounceDelay: 350,
			onStateChange,
		});

		set((state) => ({
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
