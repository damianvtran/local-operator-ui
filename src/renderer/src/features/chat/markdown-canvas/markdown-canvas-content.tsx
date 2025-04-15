import { EditorView } from "@codemirror/view";
import { Box } from "@mui/material";
import { basicSetup } from "codemirror";
import type { FC } from "react";
import { useEffect, useRef } from "react";
import type { MarkdownDocument } from "./types";

type MarkdownCanvasContentProps = {
	/**
	 * The document to display
	 */
	document: MarkdownDocument;
};

/**
 * Content component for the markdown canvas
 * Displays the markdown content with syntax highlighting
 * @deprecated
 */
export const MarkdownCanvasContent: FC<MarkdownCanvasContentProps> = ({
	document,
}) => {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const codeMirrorRef = useRef<EditorView | null>(null);

	useEffect(() => {
		if (!containerRef?.current) return; // Container is not yet setup

		cleanupCodeMirror();

		const fullHeightExtension = EditorView.theme({
			"&": {
				height: "100%",
			},
		});

		codeMirrorRef.current = new EditorView({
			doc: document.content,
			parent: containerRef.current,
			extensions: [basicSetup, fullHeightExtension],
		});

		return () => {
			cleanupCodeMirror();
		};
	}, [document.content]);

	const cleanupCodeMirror = () => {
		if (codeMirrorRef.current) {
			codeMirrorRef.current.destroy();
			codeMirrorRef.current = null;
		}
	};

	return (
		<Box
			ref={containerRef}
			sx={{
				height: "100%",
				width: "100%",
				// minHeight: "100%",
				// height: "90%",
				// minHeight: "90%",
				// height: '100px',
				// width: '100px',
				border: "3px solid rebeccapurple",
			}}
		/>
	);
};
