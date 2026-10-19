/** The buffer owner's commit path is never entered by the Library baseline
 * test; this stub keeps the store's module import from touching localStorage. */
export const useCanvasStore = {
	getState: () => ({ conversations: [] }),
};
