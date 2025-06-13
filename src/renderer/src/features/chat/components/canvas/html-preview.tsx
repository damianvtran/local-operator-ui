import { Box, Button, IconButton, styled } from "@mui/material";
import { getHtmlUrl } from "@shared/api/local-operator/static-api";
import { apiConfig } from "@shared/config";
import { RefreshCw as RefreshIcon } from "lucide-react";
import { type FC, memo, useCallback, useMemo, useState } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { CodeEditor } from "./code-editor";

type HtmlPreviewProps = {
	/**
	 * The HTML document to preview
	 */
	document: CanvasDocument;
};

const PreviewContainer = styled(Box)({
	height: "100%",
	width: "100%",
	display: "flex",
	flexDirection: "column",
});

const ControlsBar = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "flex-end",
	gap: "4px",
	padding: "6px 8px",
	borderBottom: `1px solid ${theme.palette.divider}`,
	backgroundColor: theme.palette.background.paper,
	minHeight: "32px",
}));

const StyledButton = styled(Button)(({ theme }) => ({
	height: "32px",
	minWidth: "64px",
	padding: "0 8px",
	fontSize: "0.8rem",
	fontWeight: 500,
	borderRadius: "6px",
	textTransform: "none",
	border: `1px solid ${theme.palette.divider}`,
	backgroundColor: theme.palette.background.paper,
	color: theme.palette.text.primary,
	boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
	transition: "all 0.15s ease-in-out",
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
		borderColor: theme.palette.action.hover,
		boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px 0 rgb(0 0 0 / 0.06)",
	},
	"&:active": {
		transform: "translateY(0.5px)",
	},
}));

const StyledIconButton = styled(IconButton)(({ theme }) => ({
	width: "32px",
	height: "32px",
	padding: "4px",
	borderRadius: "6px",
	border: `1px solid ${theme.palette.divider}`,
	backgroundColor: theme.palette.background.paper,
	color: theme.palette.text.secondary,
	boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
	transition: "all 0.15s ease-in-out",
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
		borderColor: theme.palette.action.hover,
		color: theme.palette.text.primary,
		boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px 0 rgb(0 0 0 / 0.06)",
	},
	"&:active": {
		transform: "translateY(0.5px)",
	},
	"& svg": {
		width: "12px",
		height: "12px",
	},
}));

/**
 * Styled iframe for HTML content
 */
const HtmlIframe = styled("iframe")(({ theme }) => ({
	width: "100%",
	height: "100%",
	border: "none",
	backgroundColor: theme.palette.background.paper,
	borderRadius: "0",
}));

/**
 * HTML Preview Component
 *
 * Renders HTML content in an iframe using the Local Operator static HTML endpoint
 * This simulates opening the HTML file in a local browser by serving it through the API
 */
const HtmlPreviewComponent: FC<HtmlPreviewProps> = ({ document }) => {
	const [isEditMode, setIsEditMode] = useState(false);
	const [content, setContent] = useState(document.content);
	const [key, setKey] = useState(Date.now());

	const handleToggleMode = useCallback(() => {
		setIsEditMode((prev) => !prev);
		if (!isEditMode) {
			setKey(Date.now());
		}
	}, [isEditMode]);

	const handleRefresh = useCallback(() => {
		setKey(Date.now());
	}, []);

	const htmlUrl = useMemo(
		() => getHtmlUrl(apiConfig.baseUrl, document.path),
		[document.path],
	);

	return (
		<PreviewContainer>
			<ControlsBar>
				<StyledButton onClick={handleToggleMode}>
					{isEditMode ? "Preview" : "Edit"}
				</StyledButton>
				<StyledIconButton onClick={handleRefresh}>
					<RefreshIcon />
				</StyledIconButton>
			</ControlsBar>
			<Box sx={{ flexGrow: 1, overflow: "hidden" }}>
				{isEditMode ? (
					<CodeEditor
						document={{ ...document, content }}
						onContentChange={setContent}
					/>
				) : (
					<HtmlIframe
						key={key}
						src={htmlUrl}
						title={`HTML Preview: ${document.title}`}
						sandbox="allow-scripts allow-same-origin allow-forms"
					/>
				)}
			</Box>
		</PreviewContainer>
	);
};

export const HtmlPreview = memo(HtmlPreviewComponent);
