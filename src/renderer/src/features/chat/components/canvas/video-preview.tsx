import {
	type LocalOperatorClient,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { cn } from "@shared/lib/utils";
import { type FC, memo, useMemo, useState } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { mimeTypeForPath } from "../../utils/file-kind";
import {
	FileViewerState,
	OpenInOsButton,
	ViewerChrome,
} from "./file-viewer-state";

/**
 * Video the agent produced, played in the panel.
 *
 * THE ROUTE GOES FIRST, and the exception is the point: a video wants Range
 * requests and partial reads, which Starlette's `FileResponse` implements on the
 * backend's `/v1/static/videos` route and a blob URL cannot — a blob would pull
 * the whole file through structured clone before the first frame appears. So for
 * a file the route can serve, nothing changed.
 *
 * THE BYTES COME SECOND, because the route can REFUSE. It is confined to the
 * daemon's configured roots (local-operator PR #2134), so a video outside them —
 * a render in `/tmp`, a `/var/folders` screen recording, a clip on another
 * volume — answers 403, and with the backend stopped the route answers nothing
 * at all. Either failure falls back to reading the file over the app's own
 * bridge as a blob (`use-file-blob-url`), which is what the other viewers
 * already do and what makes this one work for files the route will not serve.
 * The read is bounded by `MAX_FILE_READ_BYTES`; a file over that cap becomes one
 * of the states below rather than a spinner.
 *
 * The cost of the fallback is honest and visible: it reads the whole file, so
 * the first frame waits on the transfer. The failure after BOTH attempts is the
 * same state every other viewer shows and offers the OS — which for a video is
 * usually the better player anyway.
 *
 * ## A rewritten file reaches this player only through the URL
 *
 * Every other viewer re-reads because the canvas hands it a document carrying a
 * new mtime; this one, on the route, has no bytes to re-read, so the mtime has
 * to be spent on the request. Two things are needed and neither works alone:
 * the URL has to change, or Chromium answers from the response it already
 * holds, and the ELEMENT has to be re-created, because assigning `src` on a
 * playing element leaves the old media on screen until something makes the
 * browser re-evaluate it. Hence the `v=<mtime>` token (the route reads `path`
 * and ignores the extra parameter) and the `key` below. The bytes fallback
 * inherits both halves of that: its cache key is `path:mtime`, and its
 * component is keyed on the same version, so a re-read is a fresh element over
 * fresh bytes and a playback failure does not outlive the file it described.
 */
const VideoPreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	/*
	 * One switch, one direction. A route failure is permanent for this mount — a
	 * 403 will not un-refuse itself, and a stopped backend coming back is worth
	 * less than the certainty the bytes path already gives once it is chosen. A
	 * re-read that moves the mtime re-keys the element (and, for bytes, the
	 * cache) rather than re-trying the route.
	 */
	const [source, setSource] = useState<"route" | "bytes">("route");
	/*
	 * Read once, used for the route's token, the bytes component's key and the
	 * request's cache key: two spellings of "which version is this" would be a
	 * way for them to disagree.
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

	/* The letterbox wears the PANE's ground (`canvas/index.tsx`): it is the pane's
	   body behind the media, so it takes the drawer's rung rather than the
	   conversation's `canvas`, which would leave the pane's tone under a changed
	   bar. */
	return (
		<div className={cn("flex h-full w-full flex-col bg-elevated")}>
			<ViewerChrome path={document.path} />
			{source === "route" ? (
				<RouteVideo
					key={version}
					document={document}
					version={version}
					onUnavailable={() => setSource("bytes")}
				/>
			) : (
				<BytesVideo key={version} document={document} />
			)}
		</div>
	);
};

/**
 * The first attempt: the backend's media route, unchanged from when it was the
 * only attempt.
 */
const RouteVideo: FC<{
	document: CanvasDocument;
	version: string;
	onUnavailable: () => void;
}> = ({ document, version, onUnavailable }) => {
	const client = useMemo<LocalOperatorClient>(
		() => createLocalOperatorClient(apiConfig.baseUrl),
		[],
	);
	const url = useMemo(
		() => `${client.static.getVideoUrl(document.path)}&v=${version}`,
		[client, document.path, version],
	);

	/*
	 * HELD BACK UNTIL IT HAS SOMETHING TO SAY (design round 1, D4). For a file the
	 * route refuses - which is the case this PR exists for - the element errors
	 * within a millisecond and the bytes path takes over ~150ms later; painting
	 * the element in between put a dead `<video controls>` on screen for that
	 * interval. The element stays MOUNTED (it has to, to load) but invisible, and
	 * the quiet "Opening…" state the bytes path also shows holds the pane, so the
	 * route-to-bytes handover reads as one continuous wait. Keyed on `version`
	 * because a re-read re-creates the element and must hold it back again.
	 *
	 * An IPC-first order for out-of-root files was considered and not taken: the
	 * renderer does not know the daemon's served roots (the list is the core's,
	 * #2134), so choosing a path per file would be guessing, and getting it wrong
	 * for an in-root file would drop the Range streaming this order exists to keep.
	 */
	const [loaded, setLoaded] = useState(false);
	return (
		<div
			className={cn(
				"relative flex flex-1 items-center justify-center bg-sunken",
			)}
		>
			{loaded ? null : (
				<div className={cn("absolute inset-0")}>
					<FileViewerState quiet title="Opening…" />
				</div>
			)}
			{/* biome-ignore lint/a11y/useMediaCaption: the operator's own video file has no caption track to offer. */}
			<video
				key={version}
				src={url}
				controls
				preload="metadata"
				onLoadedMetadata={() => setLoaded(true)}
				onError={onUnavailable}
				className={cn(
					"max-h-full max-w-full object-contain",
					loaded ? null : "invisible",
				)}
			/>
		</div>
	);
};

/**
 * The second attempt: the same file over the app's own file bridge, as a blob.
 *
 * The failure copy follows the other viewers rather than inventing its own: a
 * file over the read cap says so (and offers the OS, which can play anything),
 * a file that is gone says that, and a read or a decode that failed for any
 * other reason is "could not be played".
 */
const BytesVideo: FC<{ document: CanvasDocument }> = ({ document }) => {
	const state = useFileBlobUrl(document.path, {
		mtimeMs: document.lastAgentModified,
		mimeType: mimeTypeForPath(document.path),
		sizeBytes: document.sizeBytes,
	});
	const [playbackFailed, setPlaybackFailed] = useState(false);

	if (state.status === "loading") {
		return <FileViewerState quiet title="Opening…" />;
	}
	if (state.status === "unavailable" || playbackFailed) {
		const tooLarge =
			state.status === "unavailable" && state.code === "too-large";
		const gone = state.status === "unavailable" && state.code === "not-found";
		return (
			<FileViewerState
				title={
					tooLarge
						? "Too large to preview"
						: gone
							? "File no longer exists"
							: "This video could not be played"
				}
				detail={
					state.status === "unavailable"
						? (state.message ?? document.path)
						: document.path
				}
			>
				<OpenInOsButton path={document.path} />
			</FileViewerState>
		);
	}
	return (
		<div className={cn("flex flex-1 items-center justify-center bg-sunken")}>
			{/* biome-ignore lint/a11y/useMediaCaption: the operator's own video file has no caption track to offer. */}
			<video
				src={state.url}
				controls
				preload="metadata"
				onError={() => setPlaybackFailed(true)}
				className={cn("max-h-full max-w-full object-contain")}
			/>
		</div>
	);
};

export const VideoPreview = memo(VideoPreviewComponent);
