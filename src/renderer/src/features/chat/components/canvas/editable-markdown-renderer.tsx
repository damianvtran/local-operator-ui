import { Box, Paper } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { useDebounce } from "../../../../shared/hooks/use-debounce";
import { useCanvasStore } from "../../../../shared/store/canvas-store";
import { showSuccessToast } from "../../../../shared/utils/toast-manager";
import type { CanvasDocument } from "../../types/canvas";
import { MarkdownRenderer } from "../markdown-renderer";

type EditableMarkdownRendererProps = {
	document: CanvasDocument;
	conversationId?: string;
};

const EditorContainer = styled(Paper)(() => ({
	display: "flex",
	height: "100%",
	width: "100%",
	overflow: "hidden",
	backgroundColor: "transparent",
}));

const EditorPane = styled(Box)({
	flex: 1,
	padding: "16px",
	overflowY: "auto",
	height: "100%",
	display: "flex",
	flexDirection: "column",
});

const PreviewPane = styled(Box)(({ theme }) => ({
	flex: 1,
	padding: "16px",
	overflowY: "auto",
	borderLeft: `1px solid ${theme.palette.divider}`,
	height: "100%",
}));

const StyledTextarea = styled("textarea")(({ theme }) => ({
	width: "100%",
	height: "100%",
	border: "none",
	outline: "none",
	backgroundColor: "transparent",
	resize: "none",
	fontFamily: '"Roboto Mono", monospace',
	fontSize: "0.9rem",
	color: theme.palette.text.primary,
	lineHeight: 1.5,
	flex: 1,
	padding: 0,
	margin: 0,
	overflow: "auto",
}));

export const EditableMarkdownRenderer: FC<EditableMarkdownRendererProps> = ({
	document,
	conversationId,
}) => {
	const [content, setContent] = useState(document.content);
	const [hasUserChanges, setHasUserChanges] = useState(false);
	const debouncedContent = useDebounce(content, 1000);
	
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const previewRef = useRef<HTMLDivElement>(null);
	const isScrollingSyncRef = useRef(false);
	const originalContentRef = useRef(document.content);
	const isInitialLoadRef = useRef(true);

	const { setFiles } = useCanvasStore();
	const canvasState = useCanvasStore((state) =>
		conversationId ? state.conversations[conversationId] : undefined,
	);

	useEffect(() => {
		setContent(document.content);
		setHasUserChanges(false);
		originalContentRef.current = document.content;
		isInitialLoadRef.current = true;
	}, [document.content]);

	useEffect(() => {
		// Only save if there are actual user changes and it's not the initial load
		if (
			hasUserChanges && 
			!isInitialLoadRef.current && 
			debouncedContent !== originalContentRef.current && 
			document.path
		) {
			window.api.saveFile(document.path, debouncedContent);
			showSuccessToast("File saved successfully");
			originalContentRef.current = debouncedContent;

			// Update the canvas store with the new content
			if (conversationId && canvasState) {
				const updatedFiles = canvasState.files.map((file) =>
					file.id === document.id
						? { ...file, content: debouncedContent }
						: file,
				);
				setFiles(conversationId, updatedFiles);
			}
		}
	}, [debouncedContent, hasUserChanges, document.path, document.id, conversationId, canvasState, setFiles]);

	const handleContentChange = (
		event: React.ChangeEvent<HTMLTextAreaElement>,
	) => {
		const newContent = event.target.value;
		setContent(newContent);
		
		// Only mark as user changes if it's different from the original content
		// and we're past the initial load
		if (isInitialLoadRef.current) {
			isInitialLoadRef.current = false;
		}
		
		if (newContent !== originalContentRef.current) {
			setHasUserChanges(true);
		}
	};

	const syncScrollFromEditor = useCallback(() => {
		if (isScrollingSyncRef.current || !editorRef.current || !previewRef.current) return;
		
		isScrollingSyncRef.current = true;
		const editor = editorRef.current;
		const preview = previewRef.current;
		
		const scrollPercentage = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
		const targetScrollTop = scrollPercentage * (preview.scrollHeight - preview.clientHeight);
		
		preview.scrollTop = targetScrollTop;
		
		requestAnimationFrame(() => {
			isScrollingSyncRef.current = false;
		});
	}, []);

	const syncScrollFromPreview = useCallback(() => {
		if (isScrollingSyncRef.current || !editorRef.current || !previewRef.current) return;
		
		isScrollingSyncRef.current = true;
		const editor = editorRef.current;
		const preview = previewRef.current;
		
		const scrollPercentage = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
		const targetScrollTop = scrollPercentage * (editor.scrollHeight - editor.clientHeight);
		
		editor.scrollTop = targetScrollTop;
		
		requestAnimationFrame(() => {
			isScrollingSyncRef.current = false;
		});
	}, []);

	return (
		<EditorContainer elevation={0}>
			<EditorPane>
				<StyledTextarea 
					ref={editorRef}
					value={content} 
					onChange={handleContentChange}
					onScroll={syncScrollFromEditor}
				/>
			</EditorPane>
			<PreviewPane ref={previewRef} onScroll={syncScrollFromPreview}>
				<MarkdownRenderer content={content} />
			</PreviewPane>
		</EditorContainer>
	);
};
