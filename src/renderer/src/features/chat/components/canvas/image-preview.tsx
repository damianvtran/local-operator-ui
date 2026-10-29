import {
	fetchAttachmentBlob,
	useAttachmentSource,
} from "@features/chat/canonical/use-attachment-url";
import type { CanvasDocument } from "@features/chat/types/canvas";
import { artifactFileName } from "@features/chat/utils/artifact-identity";
import { mimeTypeForPath } from "@features/chat/utils/file-kind";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { type FC, memo, useState } from "react";
import { ImageActionsMenu } from "../image-actions-menu";
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
}) =>
	document.artifact ? (
		<ArtifactImagePreview document={document} />
	) : (
		<PathImagePreview document={document} />
	);

/**
 * A generated picture, shown from the attachment store by digest.
 *
 * The path viewer above reads a file over the file bridge; an artifact has no
 * file, so this one resolves `document.artifact.digest` through the transcript's
 * own resolver (`useAttachmentSource`) - the same blob cache, the same refcount,
 * and a picture already open in the chat costs no second fetch. Same chrome and
 * same states as the path viewer, so the four media viewers still read as one
 * surface; what differs is only what is absent: there is no `Open in default
 * app` (the OS cannot open a store entry), and the `Show in canvas` entry is
 * absent for the usual reason (this IS the canvas). `Save as...` takes its place
 * as the way out of the app.
 */
const ArtifactImagePreview: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	useI18nLocale();
	const artifact = document.artifact;
	const source = useAttachmentSource(
		{
			data: null,
			attachment: artifact?.digest ?? null,
			mimeType: artifact?.contentType ?? "image/png",
		},
		artifact
			? { sessionId: artifact.sessionId, childId: artifact.childId ?? null }
			: null,
	);
	const [undecodableUrl, setUndecodableUrl] = useState<string | null>(null);
	const readyUrl = source.state === "ready" ? source.url : null;
	const url =
		readyUrl !== null && readyUrl !== undecodableUrl ? readyUrl : null;
	return (
		<div
			/* The pane owns the ground; a viewer body is a plane, not a second one. */
			data-glass-plane="clear"
			className={cn("flex h-full min-h-0 w-full flex-1 flex-col bg-elevated")}
		>
			<ViewerChrome>
				{artifact ? (
					<ImageActionsMenu
						file={document.path}
						src={url ?? undefined}
						label={document.title}
						mediaKind="image"
						saveName={artifactFileName(artifact)}
						resolveBytes={() =>
							fetchAttachmentBlob(
								{
									sessionId: artifact.sessionId,
									childId: artifact.childId ?? null,
								},
								artifact.digest,
							)
						}
					/>
				) : null}
			</ViewerChrome>
			{url !== null ? (
				<div className={cn("flex min-h-0 flex-1 items-center justify-center")}>
					<img
						src={url}
						alt={document.title}
						onError={() => setUndecodableUrl(url)}
						className={cn("h-full w-full bg-sunken object-contain")}
					/>
				</div>
			) : source.state === "resolving" ? (
				<FileViewerState quiet title={t("ui.common.viewer.opening")} />
			) : (
				<FileViewerState
					title={
						readyUrl !== null
							? t("ui.canvas.image_preview.this_image_could_not_be_shown")
							: t(
									"ui.canvas.image_preview.this_image_is_no_longer_in_the_session",
								)
					}
					detail={document.title}
				/>
			)}
		</div>
	);
};

const PathImagePreview: FC<{ document: CanvasDocument }> = ({ document }) => {
	useI18nLocale();
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
				? t("ui.canvas.image_preview.too_large_to_preview")
				: state.code === "not-found"
					? t("ui.canvas.image_preview.file_no_longer_exists")
					: t("ui.canvas.image_preview.this_image_could_not_be_opened")
			: t("ui.canvas.image_preview.this_image_could_not_be_shown");

	return (
		/* The letterbox wears the PANE's ground (`canvas/index.tsx`): it is the pane's
		   body behind the media, so it takes the drawer's rung rather than the
		   conversation's `canvas`, which would leave the pane's tone under a changed
		   bar. */
		<div
			/* The pane owns the ground; a viewer body is a plane, not a second one. */
			data-glass-plane="clear"
			className={cn("flex h-full min-h-0 w-full flex-1 flex-col bg-elevated")}
		>
			<ViewerChrome path={document.path}>
				{/*
				 * The image viewer's own actions, beside the chrome's open button.
				 * The menu's `file` is the document's path — the viewer is
				 * path-backed by construction — and `src` is whatever the picture is
				 * painted from, so `Copy image` resolves the bytes this reader is
				 * actually looking at. The canvas entry is absent by design: this IS
				 * the canvas, and `Show in canvas` on a document already in it is a
				 * second way to say one thing.
				 */}
				<ImageActionsMenu
					file={document.path}
					src={url ?? document.path}
					label={document.title}
				/>
			</ViewerChrome>
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
				<FileViewerState quiet title={t("ui.common.viewer.opening")} />
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
