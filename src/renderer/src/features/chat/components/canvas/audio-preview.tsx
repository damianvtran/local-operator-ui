import type { CanvasDocument } from "@features/chat/types/canvas";
import { mimeTypeForPath } from "@features/chat/utils/file-kind";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { cn } from "@shared/lib/utils";
import { type FC, memo } from "react";
import { FileViewerState, OpenInOsButton } from "./file-viewer-state";

/**
 * Audio the agent produced, played in the panel.
 *
 * Over IPC bytes like the image viewer, not the backend's `/v1/static/audio`
 * route. A short clip does not need Range requests, and the blob keeps the
 * viewer working with the backend stopped — which is the same reason the image
 * viewer reads bytes rather than asking the static route for a URL.
 *
 * The one thing this surface must not do is autoplay: a panel that starts
 * talking because a tile was clicked is a hostile surprise, and the controls are
 * the affordance that says "this plays when you say so".
 */
const AudioPreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	const state = useFileBlobUrl(document.path, {
		mtimeMs: document.lastAgentModified,
		mimeType: mimeTypeForPath(document.path),
		enabled: !document.path.startsWith("data:"),
	});

	return (
		<div className={cn("flex h-full w-full flex-col bg-canvas")}>
			<div
				className={cn(
					"flex min-h-8 shrink-0 items-center gap-2",
					"border-hairline border-b bg-surface px-2 py-1.5",
				)}
			>
				<span className={cn("truncate text-body-sm text-ink")}>
					{document.title}
				</span>
			</div>
			{state.status === "ready" ? (
				<div className={cn("flex flex-1 items-center justify-center p-6")}>
					{/* biome-ignore lint/a11y/useMediaCaption: the operator's own audio file has no caption track to offer. */}
					<audio
						src={state.url}
						controls
						preload="metadata"
						className={cn("w-full max-w-96")}
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
								: "This audio file could not be opened"
					}
					detail={document.path}
				>
					<OpenInOsButton path={document.path} />
				</FileViewerState>
			)}
		</div>
	);
};

export const AudioPreview = memo(AudioPreviewComponent);
