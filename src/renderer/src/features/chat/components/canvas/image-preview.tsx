import type { CanvasDocument } from "@features/chat/types/canvas";
import { mimeTypeForPath } from "@features/chat/utils/file-kind";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { cn } from "@shared/lib/utils";
import { type FC, memo, useState } from "react";
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
 *
 * ## A file whose bytes arrived but cannot be PAINTED says so too
 *
 * A read failure was never the hard case: `useFileBlobUrl` answers `unavailable`
 * with a code, and the state below has always had a sentence for it. The case
 * that had none was the bytes landing and the element refusing them - a 0-byte
 * file, a text file with a `.png` name, a truncated write - where Chromium's
 * broken-image glyph was the entire answer: no title, no reason, and no way to
 * tell it from a picture that was still arriving. The tile in the composer had a
 * sentence for the same file (`Could not be previewed`) and the video viewer had
 * one for the same failure (`This video could not be played`), so this viewer was
 * the one surface out of step with its siblings (QA round 1, Q1). The latch below
 * mirrors the video viewer's `playbackFailed`: the element is not a way to
 * interrogate the bytes, so the fact is taken from the error it reports.
 */
const ImagePreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	const state = useFileBlobUrl(document.path, {
		mtimeMs: document.lastAgentModified,
		mimeType: mimeTypeForPath(document.path),
		sizeBytes: document.sizeBytes,
	});
	// Keyed on the URL it describes, so a rewritten file (a new blob) is judged
	// afresh rather than condemned by the old bytes' failure.
	const [undecodableUrl, setUndecodableUrl] = useState<string | null>(null);
	const readyUrl = state.status === "ready" ? state.url : null;
	/*
	 * `null` here is one of three facts: the read is still in flight, it failed,
	 * or the bytes landed and the element refused them. The branch below reads
	 * them apart, so the latch is compared once rather than answered twice - the
	 * last of the three is exactly the case where a URL was offered and is now
	 * condemned.
	 */
	const url =
		readyUrl !== null && readyUrl !== undecodableUrl ? readyUrl : null;

	/*
	 * One sentence at heading weight, from the same family as the video viewer's
	 * "could not be played": a read that failed keeps its own code's reason (they
	 * are different facts, and "too large" offers a different way out), and a
	 * picture that arrived and could not be shown is its own sentence rather than
	 * the read failure's — the file is there, and the panel is what could not
	 * paint it.
	 */
	const title =
		state.status === "unavailable"
			? state.code === "too-large"
				? "Too large to preview"
				: state.code === "not-found"
					? "File no longer exists"
					: "This image could not be opened"
			: "This image could not be shown";

	return (
		/* The letterbox wears the PANE's ground (`canvas/index.tsx`): it is the pane's
		   body behind the media, so it takes the drawer's rung rather than the
		   conversation's `canvas`, which would leave the pane's tone under a changed
		   bar. */
		<div className={cn("flex h-full w-full flex-col bg-elevated")}>
			<ViewerChrome path={document.path} />
			{url !== null ? (
				<div className={cn("flex min-h-0 flex-1 items-center justify-center")}>
					<img
						src={url}
						alt={document.title}
						onError={() => setUndecodableUrl(url)}
						className={cn("h-full w-full bg-sunken object-contain")}
					/>
				</div>
			) : state.status === "loading" ? (
				<FileViewerState quiet title="Opening…" />
			) : (
				<FileViewerState
					title={title}
					detail={
						state.status === "unavailable"
							? (state.message ?? document.path)
							: document.path
					}
				>
					<OpenInOsButton path={document.path} />
				</FileViewerState>
			)}
		</div>
	);
};

export const ImagePreview = memo(ImagePreviewComponent);
