import {
	type LocalOperatorClient,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { Button, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
import { FileUp } from "lucide-react";
import { type FC, memo, useMemo, useState } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { FileViewerState, OpenInOsButton } from "./file-viewer-state";

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
 */
const VideoPreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	const [failed, setFailed] = useState(false);
	const client = useMemo<LocalOperatorClient>(
		() => createLocalOperatorClient(apiConfig.baseUrl),
		[],
	);
	const url = useMemo(
		() => client.static.getVideoUrl(document.path),
		[client, document.path],
	);

	return (
		<div className={cn("flex h-full w-full flex-col bg-canvas")}>
			<div
				className={cn(
					"flex min-h-8 shrink-0 items-center justify-between gap-2",
					"border-hairline border-b bg-surface px-2 py-1.5",
				)}
			>
				<span className={cn("truncate text-body-sm text-ink")}>
					{document.title}
				</span>
				<Tooltip content="Open in default app">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Open in default app"
						onClick={() => window.api.openFile(document.path)}
					>
						<FileUp aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>
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
