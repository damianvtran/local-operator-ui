import { getHtmlUrl } from "@shared/api/local-operator/static-api";
import { Button } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
import { type FC, memo, useCallback, useMemo, useState } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { CodeEditor } from "./code-editor";

type HtmlPreviewProps = {
	/**
	 * The HTML document to preview
	 */
	document: CanvasDocument;
	/**
	 * The conversation the document belongs to, so edit mode's saves update the
	 * canvas store the same way the code viewer's do.
	 */
	conversationId?: string;
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
 *
 * EDIT MODE IS THE CODE VIEWER, the same component the `code` documents get
 * (code review round 2, Q3). Round 1's fix gave this viewer its own copy of the
 * buffer - a `draft` this component seeded, echoed back into `CodeEditor` as
 * `document.content`, and reset whenever the store moved. That echo is what broke
 * it: `CodeEditor` cannot tell "the parent echoed my own typing" from "the store
 * changed underneath", so every keystroke looked like an external write, the
 * buffer was re-adopted, `hasUserChanges` was cleared, and the reader's edits were
 * neither saved nor protected - while the same typing in a `.py` document went
 * dirty and saved. Handing the REAL document over and letting `CodeEditor` own its
 * buffer is the fix, and it inherits the dirty registry, the autosave, the hold and
 * the M3 adopt guard that the other editors already have.
 *
 * The editor stays MOUNTED while previewing, hidden rather than unmounted: its
 * debounced save is one second wide, and unmounting inside that window drops the
 * reader's last words (code review round 2, residual sub-minor).
 *
 * THE VIEWER'S OWN RELOAD BUTTON IS GONE (design round 2, D8). The row above
 * stacks a re-read control on every viewer, and for this viewer the two did the
 * same thing 32px apart - the row's press re-keys the iframe below (the version
 * token includes both of the fields a re-read moves), so the preview is fetched
 * again either way. Two identical controls for one action is noise, and the row's
 * is the one that also serves the code, markdown and spreadsheet surfaces.
 */
const HtmlPreviewComponent: FC<HtmlPreviewProps> = ({
	document,
	conversationId,
}) => {
	const [isEditMode, setIsEditMode] = useState(false);

	const handleToggleMode = useCallback(() => {
		setIsEditMode((prev) => !prev);
	}, []);

	const htmlUrl = useMemo(
		() => getHtmlUrl(apiConfig.baseUrl, document.path),
		[document.path],
	);

	/*
	 * THE PREVIEW HAS TO BE RE-CREATED, NOT MERELY RE-FETCHED (code review round
	 * 1, M1). The iframe is keyed on the document's version - both fields, because
	 * an ordinary re-read moves `readMtimeMs` and a forced one moves
	 * `lastAgentModified` (the same reasoning as `video-preview.tsx`) - so a
	 * re-read that wrote the file's new bytes into the store re-creates it and the
	 * backend serves the new document. Before that it was keyed on a `Date.now()`
	 * state only this component could move, and this was the one viewer where the
	 * freshness line moved while the pane kept showing the old document.
	 */
	const version = `${document.readMtimeMs ?? 0}:${document.lastAgentModified ?? 0}`;

	return (
		<div className={cn("flex h-full w-full flex-col")}>
			<div
				className={cn(
					"flex min-h-8 items-center justify-end gap-1",
					"border-hairline border-b bg-surface px-2 py-1.5",
				)}
			>
				<Button
					variant="outline"
					size="sm"
					onClick={handleToggleMode}
					data-tour-tag="canvas-html-mode-toggle"
				>
					{isEditMode ? "Preview" : "Edit"}
				</Button>
			</div>
			<div className={cn("flex-1 overflow-hidden")}>
				<div className={cn("h-full", isEditMode ? null : "hidden")}>
					<CodeEditor document={document} conversationId={conversationId} />
				</div>
				{isEditMode ? null : (
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
