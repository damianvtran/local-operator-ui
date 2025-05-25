import { Box, styled } from "@mui/material";
import { getHtmlUrl } from "@shared/api/local-operator/static-api";
import { apiConfig } from "@shared/config";
import { useMemo } from "react";
import type { FC } from "react";
import type { CanvasDocument } from "../../types/canvas";

type HtmlPreviewProps = {
	/**
	 * The HTML document to preview
	 */
	document: CanvasDocument;
};

/**
 * Styled iframe container for HTML preview
 */
const IframeContainer = styled(Box)(({ theme }) => ({
	height: "100%",
	width: "100%",
	display: "flex",
	flexDirection: "column",
	backgroundColor: theme.palette.background.paper,
}));

/**
 * Styled iframe for HTML content
 */
const HtmlIframe = styled("iframe")(({ theme }) => ({
	width: "100%",
	height: "100%",
	border: "none",
	backgroundColor: theme.palette.background.paper,
	borderRadius: theme.shape.borderRadius,
}));

/**
 * HTML Preview Component
 *
 * Renders HTML content in an iframe using the Local Operator static HTML endpoint
 * This simulates opening the HTML file in a local browser by serving it through the API
 */
export const HtmlPreview: FC<HtmlPreviewProps> = ({ document }) => {
	/**
	 * Create a URL for the HTML document using the static HTML endpoint
	 * This serves the file through the Local Operator API, simulating opening it in a browser
	 */
	const htmlUrl = useMemo(() => {
		return getHtmlUrl(apiConfig.baseUrl, document.path);
	}, [document.path]);

	console.log(htmlUrl);

	return (
		<IframeContainer>
			<HtmlIframe
				src={htmlUrl}
				title={`HTML Preview: ${document.title}`}
				sandbox="allow-scripts allow-same-origin allow-forms"
			/>
		</IframeContainer>
	);
};
