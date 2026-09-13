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
 * Audio the agent produced, played in the panel.
 *
 * Over IPC bytes and a blob URL, like the image viewer and unlike the video one:
 * an audio file is small enough to hand over whole, and a blob URL works with
 * the backend stopped.
 *
 * The name bar carries `Open in default app` like its three siblings
 * (`ViewerChrome`). Before this bar, the strip carried the name and nothing else,
 * so this was the one media viewer with no way out to another application while it
 * worked - a wave file's natural home is often a player, and the only route there
 * lived in the error state.
 *
 * The player sits on `sunken`, the app's recess for a media surface, for the same
 * reason the image and video surfaces use it: the platform draws the audio pill
 * itself, and in the light palettes its own chrome (`backdrop-control`, near
 * white) measures 1.01:1 against `canvas` — the control had no perceivable
 * boundary at all, so it read as a waveform floating on the page rather than as a
 * control on a surface. `sunken` is the ground the panel already gives its other
 * two media surfaces, so the pill is bounded by a step the eye can see in every
 * palette (design round 1, D7).
 */
const AudioPreviewComponent: FC<{ document: CanvasDocument }> = ({
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
				<div
					className={cn(
						"flex flex-1 items-center justify-center bg-sunken p-6",
					)}
				>
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
					detail={state.message ?? document.path}
				>
					<OpenInOsButton path={document.path} />
				</FileViewerState>
			)}
		</div>
	);
};

export const AudioPreview = memo(AudioPreviewComponent);
