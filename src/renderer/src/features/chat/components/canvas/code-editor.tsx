import { Box, useTheme } from "@mui/material";
import { loadLanguageExtensions } from "@shared/utils/load-language-extensions";
import { basicDark, basicLight } from "@uiw/codemirror-theme-basic";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { type FC, useEffect, useState } from "react";
import type { CanvasDocument } from "../../types/canvas";

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
		if (document.id !== value?.id || document.content !== value?.content) {
			setValue(document);
			const newLangExtension = loadLanguageExtensions(document.title);

			if (newLangExtension) {
				setLanguageExtensions([newLangExtension]);
			}
		}
	}, [document, value?.id, value?.content]);

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

				"&::-webkit-scrollbar": {
					width: "8px",
				},
				"&::-webkit-scrollbar-thumb": {
					backgroundColor:
						theme.palette.mode === "dark"
							? "rgba(255, 255, 255, 0.1)"
							: "rgba(0, 0, 0, 0.2)",
					borderRadius: "4px",
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
