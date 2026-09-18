import { getHtmlUrl } from "@shared/api/local-operator/static-api";
import { Button, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
import { RefreshCw as RefreshIcon } from "lucide-react";
import { type FC, memo, useCallback, useEffect, useMemo, useState } from "react";
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
	const [key, setKey] = useState(Date.now());
	/*
	 * EDIT MODE'S BUFFER IS THE STORE'S UNTIL THE READER TYPES (code review round
	 * 1, M1). This used to be `useState(document.content)` - a copy seeded once -
	 * and `CodeEditor` was handed that copy, so a re-read that wrote the file's new
	 * bytes into the store left the editor showing the bytes it was seeded with.
	 * `null` means "whatever the document says": the buffer follows every store
	 * write (a freshness apply, this panel's own save) until a keystroke takes it
	 * over, and the effect below hands it back when the store's bytes move again.
	 *
	 * The dirty registry is what keeps that from clobbering typing: `CodeEditor`
	 * publishes unsaved state from here exactly as it does in the code viewer, so
	 * an automatic apply is suppressed while this buffer has the reader's words in
	 * it.
	 */
	const [draft, setDraft] = useState<string | null>(null);

	useEffect(() => {
		// The store's bytes moved: they are the truth now, so the draft steps aside.
		setDraft(null);
	}, [document.content]);

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

	/*
	 * THE PREVIEW HAS TO BE RE-CREATED, NOT MERELY RE-FETCHED (code review round
	 * 1, M1). The iframe used to be keyed on a `Date.now()` this component owns,
	 * which only its own Reload and Edit buttons move - so a re-read that wrote the
	 * file's new bytes into the store changed nothing on screen, and the one viewer
	 * whose bytes are fetched by the BACKEND was the one the freshness line could
	 * not reach.
	 *
	 * Both fields, because both move for a reason: `readMtimeMs` moves for an
	 * ordinary re-read, `lastAgentModified` for a forced one - where the bytes
	 * changed and the file's own timestamp did not, which is the case the control
	 * exists for (the same reasoning as `video-preview.tsx`, M2).
	 */
	const version = `${document.readMtimeMs ?? 0}:${document.lastAgentModified ?? 0}:${key}`;

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
						document={{ ...document, content: draft ?? document.content }}
						onContentChange={setDraft}
					/>
				) : (
					<iframe
						key={version}
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
