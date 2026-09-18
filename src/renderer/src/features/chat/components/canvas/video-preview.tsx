import {
	type LocalOperatorClient,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
import { type FC, memo, useMemo, useState } from "react";
import type { CanvasDocument } from "../../types/canvas";
import {
	FileViewerState,
	OpenInOsButton,
	ViewerChrome,
} from "./file-viewer-state";

/**
 * Video the agent produced, played in the panel.
 *
 * The one viewer that does NOT read bytes over IPC, and the exception is the
 * point: a video wants Range requests and partial reads, which Starlette's
 * `FileResponse` implements on the backend's `/v1/static/videos` route and a
 * blob URL cannot — a blob would pull the whole file through structured clone
 * before the first frame appears. So the media route stays, exactly as the
 * grid's video thumbnail already used it.
 *
 * The cost of that choice is honest and visible: this viewer needs the backend
 * running. When it is not, the media element's own error is what we have, so
 * `onError` turns it into the same state every other viewer shows and offers the
 * OS — which for a video is usually the better player anyway.
 *
 * ## A rewritten file reaches this player only through the URL
 *
 * Every other viewer re-reads because the canvas hands it a document carrying a
 * new mtime; this one has no bytes to re-read, so the mtime has to be spent on
 * the request. Two things are needed and neither works alone: the URL has to
 * change, or Chromium answers from the response it already holds, and the
 * ELEMENT has to be re-created, because assigning `src` on a playing element
 * leaves the old media on screen until something makes the browser re-evaluate
 * it. Hence the `v=<mtime>` token (the route reads `path` and ignores the extra
 * parameter) and the `key` below.
 */
const VideoPreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	const [failed, setFailed] = useState(false);
	const client = useMemo<LocalOperatorClient>(
		() => createLocalOperatorClient(apiConfig.baseUrl),
		[],
	);
	/*
	 * Read once, used for both the token and the key: two spellings of
	 * "which version is this" would be a way for them to disagree.
	 *
	 * BOTH FIELDS, because both move for a reason and a viewer keyed on one alone
	 * misses a case the control exists for (code review round 1, M2). An ordinary
	 * re-read moves `readMtimeMs`; a FORCED one - the file's bytes changed and its
	 * mtime did not, which is what `cp -p`, two writes inside one filesystem tick
	 * or a restored timestamp produce - moves `lastAgentModified` instead and
	 * deliberately leaves the file's own timestamp alone. Keyed on `readMtimeMs`
	 * only, that press re-created nothing and requested the same URL the element
	 * already held, so the reader's re-read was a no-op on screen.
	 */
	const version = `${document.readMtimeMs ?? 0}:${document.lastAgentModified ?? 0}`;
	const url = useMemo(
		() => `${client.static.getVideoUrl(document.path)}&v=${version}`,
		[client, document.path, version],
	);

	return (
		<div className={cn("flex h-full w-full flex-col bg-canvas")}>
			<ViewerChrome path={document.path} />
			{failed ? (
				<FileViewerState
					title="This video could not be played"
					detail={document.path}
				>
					<OpenInOsButton path={document.path} />
				</FileViewerState>
			) : (
				<div
					className={cn("flex flex-1 items-center justify-center bg-sunken")}
				>
					{/* biome-ignore lint/a11y/useMediaCaption: the operator's own video file has no caption track to offer. */}
					<video
						key={version}
						src={url}
						controls
						preload="metadata"
						onError={() => setFailed(true)}
						className={cn("max-h-full max-w-full object-contain")}
					/>
				</div>
			)}
		</div>
	);
};

export const VideoPreview = memo(VideoPreviewComponent);
