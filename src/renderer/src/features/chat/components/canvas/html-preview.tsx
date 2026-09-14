import { getHtmlUrl } from "@shared/api/local-operator/static-api";
import { Button, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
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

/**
 * HTML Preview Component
 *
 * Renders HTML content in an iframe using the Local Operator static HTML endpoint
 * This simulates opening the HTML file in a local browser by serving it through the API
 *
 * The iframe is a separate document: our Tailwind classes and `--color-*` vars do
 * not reach inside it, so only the chrome around it is styled here. The page keeps
 * whatever styling its own markup declares.
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
		<div className={cn("flex h-full w-full flex-col")}>
			<div
				className={cn(
					"flex min-h-8 items-center justify-end gap-1",
					"border-hairline border-b bg-surface px-2 py-1.5",
				)}
			>
				<Button variant="outline" size="sm" onClick={handleToggleMode}>
					{isEditMode ? "Preview" : "Edit"}
				</Button>
				<Tooltip content="Reload preview">
					<Button
						variant="ghost"
						size="icon"
						onClick={handleRefresh}
						aria-label="Reload preview"
					>
						<RefreshIcon />
					</Button>
				</Tooltip>
			</div>
			<div className={cn("flex-1 overflow-hidden")}>
				{isEditMode ? (
					<CodeEditor
						document={{ ...document, content }}
						onContentChange={setContent}
					/>
				) : (
					<iframe
						key={key}
						src={htmlUrl}
						title={`HTML Preview: ${document.title}`}
						sandbox="allow-scripts allow-same-origin allow-forms"
						className={cn("h-full w-full border-0 bg-surface")}
					/>
				)}
			</div>
		</div>
	);
};

export const HtmlPreview = memo(HtmlPreviewComponent);
