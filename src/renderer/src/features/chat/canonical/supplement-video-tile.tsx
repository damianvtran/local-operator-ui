/**
 * A video-kind file in a supplement block, as an inline preview tile
 * (highlights deliverables, 2026-11-03).
 *
 * WHY A TILE AND NOT A ROW. The operator's ask was that the files an agent
 * produces "show up after the message" so they need not be hunted for on disk;
 * a video judged by its filename is exactly that hunt. The tile is the same
 * idea as the image grid one step further: the clip itself, MUTED and
 * click-to-play (`controls`, no autoplay — a transcript that starts playing on
 * scroll is noise), with the row's own name and actions menu under it.
 *
 * THE BYTES RIDE THE IMAGE TILES' PATH, not a new route: the portable journal
 * path is resolved through the same `probeFiles` seam (`cwd`, never the
 * process's), and the resolved file is read over the app's file bridge as a
 * blob (`useFileBlobUrl`, bounded by `MAX_FILE_READ_BYTES`, refcounted by the
 * shared blob ledger). The canvas viewer's Range-capable static route is NOT
 * used here: it is confined to the daemon's served roots (core #2134), and a
 * scratchpad deliverable — the case this change exists for — is usually
 * outside them. A clip over the read cap, or one that is gone, keeps its slot
 * as the glyph receipt and still opens through the menu.
 *
 * THE READ WAITS FOR THE VIEWPORT, latched (`useEverInView`), exactly as an
 * image tile's does: the reader component is mounted only once the tile is
 * near AND the path resolved, so a far-off or unresolvable tile reads nothing.
 */

import { useEverInView } from "@shared/hooks/use-ever-in-view";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { memo, useCallback, useEffect, useState } from "react";
import { AttachmentFrame } from "../components/message-item/attachment-frame";
import type { CanvasPane } from "../utils/canvas-pane";
import { mimeTypeForPath } from "../utils/file-kind";
import {
	FileActionsMenu,
	FileGlyph,
	useFileTargets,
} from "./supplement-file-actions";
import {
	type SupplementFile,
	displayText,
	fileRowParts,
} from "./supplement-model";

/*
 * 16:9 at the answer column's comfortable reading width (the receipt spells
 * the same three utilities out as a literal: the sidebar-selection scan must
 * read every element that paints `bg-sunken`, so that class is never built): big enough to judge a
 * clip, small enough that a two-video finish does not push the answer away.
 * One box for the reserved, playing and failed states, so a tile never reflows
 * when its bytes land.
 */
const TILE_BOX = "aspect-video w-full max-w-80";

/**
 * The inline tile's read ceiling (agent review round 1, R3): 32 MiB, half the
 * bridge's `MAX_FILE_READ_BYTES`. The tile holds the WHOLE clip as a blob while
 * its row stays mounted (the viewport latch never releases), so four featured
 * clips at the bridge cap would pin ~256 MiB in the renderer. A clip over this
 * is not previewed inline at all: it renders as a plain file row, whose open
 * action hands it to the canvas viewer (Range streaming) or the OS.
 */
export const VIDEO_TILE_MAX_BYTES = 32 * 1024 * 1024;

const VideoReader = ({
	resolved,
	file,
	onFailed,
}: {
	resolved: string;
	file: SupplementFile;
	onFailed: () => void;
}) => {
	const state = useFileBlobUrl(resolved, {
		mtimeMs: file.mtime ? file.mtime * 1000 : undefined,
		mimeType: mimeTypeForPath(resolved),
		sizeBytes: file.sizeBytes || undefined,
		maxBytes: VIDEO_TILE_MAX_BYTES,
	});
	useEffect(() => {
		if (state.status === "unavailable") onFailed();
	}, [state.status, onFailed]);
	if (state.status !== "ready") return null;
	return (
		// `muted` is also what exempts this element from the caption lint: a muted
		// preview is a silent picture until the reader unmutes it in the controls.
		<video
			src={state.url}
			controls
			muted
			playsInline
			preload="metadata"
			onError={onFailed}
			className="h-full w-full object-contain"
			data-supplement-video-player=""
		/>
	);
};

export const SupplementVideoTile = memo(function SupplementVideoTile({
	file,
	cwd,
	pane,
}: {
	file: SupplementFile;
	cwd?: string | null;
	pane: CanvasPane | null;
}) {
	useI18nLocale();
	const { name, path, size } = fileRowParts(file);
	const displayName = name || path || file.path;
	const [anchorRef, near] = useEverInView();
	const [resolved, setResolved] = useState<string | null>(null);
	const [probed, setProbed] = useState(false);
	const [failed, setFailed] = useState(false);
	const { press } = useFileTargets(file.path, cwd, pane);

	// The image tile's resolution seam, verbatim in shape: portable path in,
	// absolute path out, anything else is the glyph receipt.
	useEffect(() => {
		let cancelled = false;
		setFailed(false);
		const probe = window.api?.probeFiles;
		if (typeof probe !== "function") {
			setResolved(null);
			setProbed(true);
			return;
		}
		setResolved(null);
		setProbed(false);
		void (async () => {
			try {
				const [entry] = await probe([file.path], cwd ?? undefined);
				const target = entry?.resolved ?? "";
				if (!cancelled) setResolved(target.startsWith("/") ? target : null);
			} catch {
				if (!cancelled) setResolved(null);
			} finally {
				if (!cancelled) setProbed(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [file.path, cwd]);

	const markFailed = useCallback(() => setFailed(true), []);
	const receipt = failed || (probed && resolved === null);

	return (
		<div
			className="group flex w-full max-w-80 flex-col gap-1"
			data-supplement-video-tile=""
			ref={anchorRef}
		>
			{receipt ? (
				<span
					className="flex aspect-video w-full max-w-80 items-center justify-center rounded-sm border border-control bg-sunken text-ink-dim"
					data-supplement-video-fallback=""
				>
					<FileGlyph path={file.path} />
				</span>
			) : (
				<AttachmentFrame boundary="hairline" className={TILE_BOX}>
					{near && resolved !== null && (
						<VideoReader
							resolved={resolved}
							file={file}
							onFailed={markFailed}
						/>
					)}
				</AttachmentFrame>
			)}
			<div className="flex w-full items-center gap-2 text-meta">
				<FileGlyph path={file.path} />
				<button
					type="button"
					className="min-w-0 flex-1 truncate text-start text-ink hover:text-ink-dim"
					data-supplement-file=""
					title={file.path}
					onClick={() => {
						void press();
					}}
				>
					{displayText(displayName)}
					{/* The file row's own path suffix and size (design D4), so the
					 * tile's name line reads as one list with the rows under it. */}
					{path && path !== displayName && (
						<span className="ms-2 text-ink-muted">{displayText(path)}</span>
					)}
				</button>
				{size && <span className="shrink-0 text-ink-dim">{size}</span>}
				<FileActionsMenu
					actionPath={file.path}
					label={displayName}
					cwd={cwd}
					pane={pane}
				/>
			</div>
		</div>
	);
});
