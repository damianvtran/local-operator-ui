import { Box, useTheme, styled } from "@mui/material";
import { TextSelectionControls } from "@shared/components/common/text-selection-controls";
import { loadLanguageExtensions } from "@shared/utils/load-language-extensions";
import { basicDark, basicLight } from "@uiw/codemirror-theme-basic";
import CodeMirror, {
	type Extension,
	type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { type FC, useCallback, useEffect, useState, useRef } from "react";
import { useDebounce } from "../../../../shared/hooks/use-debounce";
import type { CanvasDocument } from "../../types/canvas";
import { InlineEdit } from "./inline-edit";

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
	const [inlineEdit, setInlineEdit] = useState<{
		selection: string;
		position: { top: number; left: number };
	} | null>(null);
	const editorRef = useRef<ReactCodeMirrorRef>(null);

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

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "k") {
			event.preventDefault();
			const view = editorRef.current?.view;
			if (view) {
				const { from, to } = view.state.selection.main;
				const selection = view.state.doc.sliceString(from, to);
				if (selection) {
					const rect = view.coordsAtPos(from);
					if (rect) {
						setInlineEdit({
							selection,
							position: { top: rect.bottom, left: rect.left },
						});
					}
				}
			}
		}
	};

	const handleApplyChanges = (newContent: string) => {
		setContent(newContent);
		if (onContentChange) {
			onContentChange(newContent);
		}
		setInlineEdit(null);
	};

	const handleEdit = (selection: string, rect: DOMRect) => {
		setInlineEdit({
			selection,
			position: { top: rect.bottom, left: rect.left },
		});
	};

	return (
		<CodeEditorContainer onKeyDown={handleKeyDown}>
			<CodeMirror
				value={content}
				height="100%"
				theme={codeEditorTheme}
				editable={editable}
				extensions={languageExtensions}
				onChange={handleContentChange}
				ref={editorRef}
			/>
			<TextSelectionControls
				targetRef={editorRef as React.RefObject<HTMLElement>}
				showEdit
				onEdit={handleEdit}
			/>
			{inlineEdit && document.path && (
				<InlineEdit
					selection={inlineEdit.selection}
					position={inlineEdit.position}
					filePath={document.path}
					onClose={() => setInlineEdit(null)}
					onApplyChanges={handleApplyChanges}
				/>
			)}
		</CodeEditorContainer>
	);
};
