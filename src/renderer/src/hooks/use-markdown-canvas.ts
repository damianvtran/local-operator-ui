import { useCallback, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { MarkdownDocument } from "../features/chat/markdown-canvas/types";

/**
 * Hook for managing the markdown canvas state
 * Provides functions for opening, closing, and managing markdown documents
 */
export const useMarkdownCanvas = () => {
	// State for tracking if the canvas is open
	const [isMarkdownCanvasOpen, setIsMarkdownCanvasOpen] = useState(false);

	// State for storing open documents
	const [documents, setDocuments] = useState<MarkdownDocument[]>([]);

	// State for tracking the active document
	const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);

	/**
	 * Open the markdown canvas
	 */
	const openMarkdownCanvas = useCallback(() => {
		setIsMarkdownCanvasOpen(true);
	}, []);

	/**
	 * Close the markdown canvas
	 */
	const closeMarkdownCanvas = useCallback(() => {
		setIsMarkdownCanvasOpen(false);
	}, []);

	/**
	 * Open a markdown document in the canvas
	 * If the document is already open, it will be made active
	 */
	const openMarkdownDocument = useCallback(
		(title: string, content: string, path: string) => {
			// Check if document with same path already exists
			const existingDocIndex = documents.findIndex((doc) => doc.path === path);

			if (existingDocIndex >= 0) {
				// If it exists, just make it active
				setActiveDocumentId(documents[existingDocIndex].id);
			} else {
				// Otherwise create a new document
				const newDocument: MarkdownDocument = {
					id: uuidv4(),
					title,
					content,
					path,
					lastModified: new Date(),
				};

				setDocuments((prev) => [...prev, newDocument]);
				setActiveDocumentId(newDocument.id);
			}

			// Make sure the canvas is open
			setIsMarkdownCanvasOpen(true);
		},
		[documents],
	);

	/**
	 * Close a markdown document
	 * If it's the active document, another document will be made active if available
	 */
	const closeMarkdownDocument = useCallback(
		(documentId: string) => {
			// Remove the document
			setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));

			// If we're closing the active document, set the active document to the first remaining document
			if (activeDocumentId === documentId) {
				const remainingDocs = documents.filter((doc) => doc.id !== documentId);
				setActiveDocumentId(
					remainingDocs.length > 0 ? remainingDocs[0].id : null,
				);

				// If no documents left, close the canvas
				if (remainingDocs.length === 0) {
					setIsMarkdownCanvasOpen(false);
				}
			}
		},
		[documents, activeDocumentId],
	);

	/**
	 * Get the active document
	 */
	const getActiveDocument = useCallback(() => {
		return documents.find((doc) => doc.id === activeDocumentId) || null;
	}, [documents, activeDocumentId]);

	return {
		isMarkdownCanvasOpen,
		openMarkdownCanvas,
		closeMarkdownCanvas,
		documents,
		activeDocumentId,
		openMarkdownDocument,
		closeMarkdownDocument,
		getActiveDocument,
	};
};
