import type { CanvasDocument } from "@features/chat/types/canvas";
import { mimeTypeForPath } from "@features/chat/utils/file-kind";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { cn } from "@shared/lib/utils";
import { type FC, memo } from "react";
import {
	FileViewerState,
	OpenInOsButton,
	ViewerChrome,
} from "./file-viewer-state";

/**
 * An image the agent touched, in the panel rather than in another application.
 *
 * Over IPC bytes and a blob URL, not the backend's `/v1/static/images` route,
 * which is what the grid's THUMBNAIL uses. The two are not inconsistent: a
 * thumbnail is one small render of a name the reader is scanning, while the
 * viewer answers "show me this file", and it must keep answering with the
 * backend stopped — the panel's whole content is paths on this machine.
 *
 * `object-contain` on `bg-sunken` so a transparent PNG reads as transparent
 * rather than as the panel's own ground: `sunken` is the app's recess for "a
 * media surface", which is exactly what is behind it.
 *
 * The name bar is not decoration and not optional: without it the picture began
 * directly under the tab strip, and `Open in default app` - the action the other
 * three media viewers carry in their working state - was reachable here only from
 * the error state. That gap is the finding that produced `ViewerChrome`. (It
 * carries the action and not the name: the tab above already prints the name, and
 * a second copy 32 px below it was design round 1's D3.) The bar
 * now states the zero-size and unreadable cases the same way every other viewer
 * does, so the four read as one surface with four contents.
 */
const ImagePreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	const state = useFileBlobUrl(document.path, {
		mtimeMs: document.lastAgentModified,
		mimeType: mimeTypeForPath(document.path),
		sizeBytes: document.sizeBytes,
	});

	return (
		<div className={cn("flex h-full w-full flex-col bg-canvas")}>
			<ViewerChrome path={document.path} />
			{state.status === "ready" ? (
				<div className={cn("flex min-h-0 flex-1 items-center justify-center")}>
					<img
						src={state.url}
						alt={document.title}
						className={cn("h-full w-full bg-sunken object-contain")}
					/>
				</div>
			) : state.status === "loading" ? (
				<FileViewerState quiet title="Opening…" />
			) : (
				<FileViewerState
					title={
						state.code === "too-large"
							? "Too large to preview"
							: state.code === "not-found"
								? "File no longer exists"
								: "This image could not be opened"
					}
					detail={state.message ?? document.path}
				>
					<OpenInOsButton path={document.path} />
				</FileViewerState>
			)}
		</div>
	);
};

export const ImagePreview = memo(ImagePreviewComponent);
