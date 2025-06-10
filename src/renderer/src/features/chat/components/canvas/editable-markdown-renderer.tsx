import { Box, Paper, TextareaAutosize } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type FC, useEffect, useState } from "react";
import { useDebounce } from "../../../../shared/hooks/use-debounce";
import type { CanvasDocument } from "../../types/canvas";
import { MarkdownRenderer } from "../markdown-renderer";

type EditableMarkdownRendererProps = {
	document: CanvasDocument;
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

const StyledTextarea = styled(TextareaAutosize)(({ theme }) => ({
	width: "100%",
	height: "100% !important",
	border: "none",
	outline: "none",
	backgroundColor: "transparent",
	resize: "none",
	fontFamily: '"Roboto Mono", monospace',
	fontSize: "0.9rem",
	color: theme.palette.text.primary,
	lineHeight: 1.5,
	flex: 1,
}));

export const EditableMarkdownRenderer: FC<EditableMarkdownRendererProps> = ({
	document,
}) => {
	const [content, setContent] = useState(document.content);
	const debouncedContent = useDebounce(content, 1000);

	useEffect(() => {
		setContent(document.content);
	}, [document.content]);

	useEffect(() => {
		if (debouncedContent !== document.content && document.path) {
			window.api.saveFile(document.path, debouncedContent);
		}
	}, [debouncedContent, document.content, document.path]);

	const handleContentChange = (
		event: React.ChangeEvent<HTMLTextAreaElement>,
	) => {
		setContent(event.target.value);
	};

	return (
		<EditorContainer elevation={0}>
			<EditorPane>
				<StyledTextarea value={content} onChange={handleContentChange} />
			</EditorPane>
			<PreviewPane>
				<MarkdownRenderer content={content} />
			</PreviewPane>
		</EditorContainer>
	);
};
