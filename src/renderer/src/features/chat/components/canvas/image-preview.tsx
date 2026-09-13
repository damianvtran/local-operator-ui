import type { CanvasDocument } from "@features/chat/types/canvas";
import { mimeTypeForPath } from "@features/chat/utils/file-kind";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { cn } from "@shared/lib/utils";
import { type FC, memo } from "react";
import { FileViewerState, OpenInOsButton } from "./file-viewer-state";

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
 */
const ImagePreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	const state = useFileBlobUrl(document.path, {
		mtimeMs: document.lastAgentModified,
		mimeType: mimeTypeForPath(document.path),
		enabled: !document.path.startsWith("data:"),
	});

	if (state.status === "ready")
		return (
			<img
				src={state.url}
				alt={document.title}
				className={cn("h-full w-full bg-sunken object-contain")}
			/>
		);

	if (state.status === "loading")
		return <FileViewerState quiet title="Opening…" />;

	return (
		<FileViewerState
			title={
				state.code === "too-large"
					? "Too large to preview"
					: state.code === "not-found"
						? "File no longer exists"
						: "This image could not be opened"
			}
			detail={document.path}
		>
			<OpenInOsButton path={document.path} />
		</FileViewerState>
	);
};

export const ImagePreview = memo(ImagePreviewComponent);
