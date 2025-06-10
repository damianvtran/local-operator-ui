import { Box, useTheme, styled } from "@mui/material";
import { loadLanguageExtensions } from "@shared/utils/load-language-extensions";
import { basicDark, basicLight } from "@uiw/codemirror-theme-basic";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { type FC, useCallback, useEffect, useState } from "react";
import { useDebounce } from "../../../../shared/hooks/use-debounce";
import type { CanvasDocument } from "../../types/canvas";

type CodeEditorProps = {
	/**
	 * The document to display
	 */
	document: CanvasDocument;
	editable?: boolean;
	onContentChange?: (content: string) => void;
};

const CodeEditorContainer = styled(Box)(({ theme }) => ({
	flexGrow: 1,
	fontSize: theme.typography.pxToRem(12),
	overflow: "auto",
	height: "100%",

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
}));

/**
 * Content component for the markdown canvas
 * Displays the markdown content with syntax highlighting
 */
export const CodeEditor: FC<CodeEditorProps> = ({
	document,
	editable = true,
	onContentChange,
}) => {
	const [content, setContent] = useState(document.content);
	const [languageExtensions, setLanguageExtensions] = useState<Extension[]>([]);
	const debouncedContent = useDebounce(content, 1000);

	const theme = useTheme();

	useEffect(() => {
		setContent(document.content);
		const newLangExtension = loadLanguageExtensions(document.title);

		if (newLangExtension) {
			setLanguageExtensions([newLangExtension]);
		}
	}, [document]);

	useEffect(() => {
		if (
			editable &&
			debouncedContent !== document.content &&
			document.path &&
			window.api.saveFile
		) {
			window.api.saveFile(document.path, debouncedContent);
		}
	}, [debouncedContent, document.content, document.path, editable]);

	const handleContentChange = useCallback(
		(value: string) => {
			setContent(value);
			if (onContentChange) {
				onContentChange(value);
			}
		},
		[onContentChange],
	);

	const codeEditorTheme =
		theme.palette.mode === "light" ? basicLight : basicDark;

	return (
		<CodeEditorContainer>
			<CodeMirror
				value={content}
				height="100%"
				theme={codeEditorTheme}
				editable={editable}
				extensions={languageExtensions}
				onChange={handleContentChange}
			/>
		</CodeEditorContainer>
	);
};
