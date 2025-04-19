import { Box, useTheme } from "@mui/material";
import { loadLanguageExtensions } from "@renderer/utils/load-language-extensions";
import { basicDark, basicLight } from "@uiw/codemirror-theme-basic";
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

	const theme = useTheme();

	useEffect(() => {
		if (document.id !== value?.id) {
			setValue(document);
			const newLangExtension = loadLanguageExtensions(document.title);

			if (!newLangExtension) return;
			setLanguageExtensions([newLangExtension]);
		}
	}, [document, value?.id]);

	const codeEditorTheme =
		theme.palette.mode === "light" ? basicLight : basicDark;

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
				theme={codeEditorTheme}
				editable={false}
				extensions={languageExtensions}
			/>
		</Box>
	);
};
