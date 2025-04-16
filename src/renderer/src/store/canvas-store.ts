import { v4 as uuidv4 } from "uuid";
import { create } from "zustand";
import type { MarkdownDocument } from "../features/chat/markdown-canvas/types";

interface MarkdownCanvasState {
	// Whether the markdown canvas is open
	isOpen: boolean;

	// List of open documents
	documents: MarkdownDocument[];

	// ID of the active document
	activeDocumentId: string | null;

	// Whether to auto-open markdown attachments
	autoOpenMarkdownAttachments: boolean;

	// Actions
	openCanvas: () => void;
	closeCanvas: () => void;
	openDocument: (title: string, content: string, path: string) => void;
	closeDocument: (documentId: string) => void;
	setActiveDocument: (documentId: string) => void;
	toggleAutoOpenMarkdownAttachments: () => void;
}

/**
 * Store for managing the markdown canvas state
 */
export const useMarkdownCanvasStore = create<MarkdownCanvasState>(
	(set, get) => ({
		// Initial state
		isOpen: false,
		documents: [],
		activeDocumentId: null,
		autoOpenMarkdownAttachments: true,

		// Actions
		openCanvas: () => set({ isOpen: true }),

		closeCanvas: () => set({ isOpen: false }),

		openDocument: (title, content, path) => {
			const { documents } = get();

			// Check if document with same path already exists
			const existingDocIndex = documents.findIndex((doc) => doc.path === path);

			console.log("existingDocIndex", existingDocIndex);

			if (existingDocIndex >= 0) {
				// If it exists, just make it active
				set({ activeDocumentId: documents[existingDocIndex].id, isOpen: true });
			} else {
				// Otherwise create a new document
				const newDocument: MarkdownDocument = {
					id: uuidv4(),
					title,
					content,
					path,
					lastModified: new Date(),
				};

				set((state) => ({
					documents: [...state.documents, newDocument],
					activeDocumentId: newDocument.id,
					isOpen: true,
				}));
			}
		},

		closeDocument: (documentId) => {
			const { documents, activeDocumentId } = get();

			// Remove the document
			const updatedDocuments = documents.filter((doc) => doc.id !== documentId);

			// If we're closing the active document, set the active document to the first remaining document
			if (activeDocumentId === documentId) {
				const newActiveId =
					updatedDocuments.length > 0 ? updatedDocuments[0].id : null;

				set({
					documents: updatedDocuments,
					activeDocumentId: newActiveId,
					// If no documents left, close the canvas
					isOpen: updatedDocuments.length > 0 ? get().isOpen : false,
				});
			} else {
				set({ documents: updatedDocuments });
			}
		},

		setActiveDocument: (documentId) => {
			set({ activeDocumentId: documentId });
		},

		toggleAutoOpenMarkdownAttachments: () => {
			set((state) => ({
				autoOpenMarkdownAttachments: !state.autoOpenMarkdownAttachments,
			}));
		},
	}),
);
