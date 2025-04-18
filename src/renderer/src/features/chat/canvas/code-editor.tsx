import { Box } from "@mui/material";
import { loadLanguageExtensions } from "@renderer/utils/load-language-extensions";
import { basicLight } from "@uiw/codemirror-theme-basic";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { type FC, useEffect, useState } from "react";
import type { CanvasDocument } from "./types";

type CodeEditorProps = {
	/**
	 * The document to display
	 */
	document: CanvasDocument;
};

/**
 * Content component for the markdown canvas
 * Displays the markdown content with syntax highlighting
 */
export const CodeEditor: FC<CodeEditorProps> = ({ document }) => {
	const [value, setValue] = useState<CanvasDocument | null>(null);
	const [languageExtensions, setLanguageExtensions] = useState<Extension[]>([]);

	useEffect(() => {
		if (document.id !== value?.id) {
			setValue(document);
			const newLangExtension = loadLanguageExtensions(document.title);

			if (!newLangExtension) return;
			setLanguageExtensions([newLangExtension]);
		}
	}, [document, value?.id]);

	return (
		<Box
			sx={({ typography }) => ({
				flexGrow: 1,
				fontSize: typography.pxToRem(12),
				overflow: "auto",

				"& > *": {
					height: "100%",
				},
			})}
		>
			<CodeMirror
				value={value?.content ?? ""}
				height="100%"
				theme={basicLight}
				editable={false}
				extensions={languageExtensions}
			/>
		</Box>
	);
};
