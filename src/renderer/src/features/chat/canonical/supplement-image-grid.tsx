/**
 * The image-kind callouts of a supplement block, as a grid of thumbnail tiles
 * (operator decision 2026-10-16).
 *
 * WHY TILES AND NOT ROWS. A picture is judged by looking; a run that produced
 * figures is indexed worse by their filenames than by the figures themselves,
 * and the operator's own round ("grid for images") asked for the visual form on
 * this block. The tile is the app's established one — the 117x78 family the
 * condensed action group's strip (`fold-media.tsx`) and the Files grid
 * (`finder-files-view.tsx`) already draw — and it is deliberately the SAME
 * visual recipe in both places: `AttachmentFrame boundary="control"` owns the
 * well (fill `mediaSurface`, edge reserved transparent and returning as
 * `border-control` on hover and keyboard focus of the enclosing `group/tile`
 * button; both pinned in `scripts/contrast-contract.mjs`), and the reserved
 * box, the picture box and the failed receipt are the measured triples spelled
 * in those files — a fourth set of numbers here would be a second geometry.
 *
 * WHAT A TILE DOES. Clicking it is the row's own primary action — canvas when
 * the pane can show it, the OS otherwise — and its ellipsis is the row's own
 * menu, both riding `supplement-file-actions.tsx` (one implementation; see that
 * module's header for why it is not a fork). The trigger wears the floored chip
 * for a menu over picture pixels.
 *
 * THE READS ARE BOUNDED, AND THEY ARE THE EXISTING PIPELINE'S. A tile's bytes
 * arrive through `finder-thumbnails.ts`'s `useFinderThumbnail` — the shared
 * four-active-read queue, the 150-entry warm LRU, the 640px downscale, the
 * `blob-url-cache` ledger that owns revocation — not through a second reader.
 * Two facts make the reuse honest:
 *
 *   - the record's paths are the journal's PORTABLE spelling (never absolute),
 *     so the pipeline only sees the RESOLVED path: the tile probes through the
 *     same `probeFiles` boundary every file action uses (`cwd`, never the
 *     process's), and hands the document to the pipeline afterwards. A path
 *     that cannot resolve never reaches a read.
 *   - the read waits for the tile to be near the viewport (`useEverInView`,
 *     latched) exactly as a Files-grid row waits, so a folded/off-screen grid
 *     reads nothing.
 *
 * THE SET IS BOUNDED BY THE BLOCK ITSELF: these are the FEATURED files — core
 * already held the rest behind the featured cap (the `N more files` row the
 * section draws) — so the grid needs no cap of its own, and its columns wrap at
 * four per row (a 12-file cap costs three rows, never an unbounded read: each
 * tile reads at most once, behind the shared queue).
 *
 * THE GLYPH FALLBACK is the finder grid's own answer to a failed thumbnail
 * (`File size={16}` on the well): the file keeps its slot, the tile states the
 * KIND rather than showing damage, and the name travels in the button's
 * accessible label. It is the terminal state for BOTH failure classes — a path
 * the probe cannot resolve to an absolute target, and a read the pipeline
 * refuses — and never a reserved box: the box is the loading arm only, and a
 * DISABLED read never leaves the hook's initial `loading` (the disposition line
 * in the tile carries the mechanism; agent review round 1, R1). Here the
 * receipt keeps the `border-control`/`sunken` edge (pinned for this file)
 * because that is the only extent a picture-less tile has; a working tile's
 * extent is the `mediaSurface` fill.
 */

import { useEverInView } from "@shared/hooks/use-ever-in-view";
import { cn } from "@shared/lib/utils";
import { memo, useEffect, useMemo, useState } from "react";
import { useFinderThumbnail } from "../components/canvas/finder-thumbnails";
import { AttachmentFrame } from "../components/message-item/attachment-frame";
import type { CanvasDocument } from "../types/canvas";
import type { CanvasPane } from "../utils/canvas-pane";
import {
	FileActionsMenu,
	FileGlyph,
	useFileTargets,
} from "./supplement-file-actions";
import { type SupplementFile, fileRowParts } from "./supplement-model";

/**
 * The overlay's reveal, the Files grid's own string (`finder-files-view.tsx`'s
 * `REVEAL`): hidden with pointer events off, brought back by hover, by keyboard
 * focus anywhere in the tile, and kept while its menu is open — so being hidden
 * and being unreachable are not the same thing (the point `image-attachment.tsx`
 * argues at length).
 */
const OVERLAY_REVEAL =
	"pointer-events-none absolute top-1 end-1 flex opacity-0 transition-opacity duration-fast ease-out-quart group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100";

const SupplementImageTile = memo(function SupplementImageTile({
	file,
	cwd,
	pane,
}: {
	file: SupplementFile;
	cwd?: string | null;
	pane: CanvasPane | null;
}) {
	const { name, path } = fileRowParts(file);
	const displayName = name || path || file.path;
	const [anchorRef, near] = useEverInView();
	const [resolved, setResolved] = useState<string | null>(null);
	const [probed, setProbed] = useState(false);

	/*
	 * The resolution seam, the same one every action uses: portable journal path
	 * in, session-cwd-resolved absolute path out, and anything else stays
	 * unresolved (the glyph fallback below) rather than being read unrooted.
	 */
	useEffect(() => {
		let cancelled = false;
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

	/*
	 * The document the shared pipeline reads. Never an artifact (a supplement
	 * file is a path the turn wrote), so `finderOriginal` takes the
	 * `readFileBytes` leg — `path` is the RESOLVED path or the read is disabled
	 * below. `lastAgentModified` carries the record's mtime (seconds → ms) so
	 * the pipeline's cache key moves when the bytes do.
	 */
	const thumbnailDocument = useMemo<CanvasDocument>(
		() => ({
			id: `supplement:${file.path}`,
			title: displayName,
			path: resolved ?? file.path,
			content: "",
			type: "image",
			sizeBytes: file.sizeBytes,
			lastAgentModified: file.mtime ? file.mtime * 1000 : undefined,
		}),
		[file.path, displayName, file.sizeBytes, file.mtime, resolved],
	);
	const thumb = useFinderThumbnail(
		thumbnailDocument,
		near && resolved !== null,
	);
	const { press } = useFileTargets(file.path, cwd, pane);

	const ready = thumb.state === "ready" && typeof thumb.url === "string";
	/*
	 * THE THREE DISPOSITIONS, and the one trap this line exists to survive
	 * (agent review round 1, R1). `useFinderThumbnail`'s initial state IS
	 * `loading`, and a DISABLED read never leaves it - so `loading` alone cannot
	 * mean "in flight": with the read gated on `resolved !== null`, an
	 * unresolvable tile (no session cwd, a refused resolution, a probe throw)
	 * would sit on `loading` forever and, counted as deferred, would show the
	 * reserved box as its terminal state. That is the empty box the round-1
	 * review measured. The deferred arm therefore requires an ACTUAL read:
	 * `resolved !== null && loading` is the in-flight pair, `!probed` is the
	 * probe leg, and every terminal shape falls through to `failed` (the glyph
	 * receipt) - `resolved === null` however the probe ended, or the pipeline's
	 * own `unavailable`.
	 */
	const deferred = !probed || (resolved !== null && thumb.state === "loading");
	const failed =
		!deferred && (resolved === null || thumb.state === "unavailable");

	return (
		<li className="flex leading-none" data-supplement-image-tile="">
			<div className="group relative" ref={anchorRef}>
				<button
					type="button"
					/*
					 * `group/tile` is what `AttachmentFrame`'s returning edge keys on
					 * (the tile's own button, never an outer group), and `rounded-sm`
					 * lets the app's global focus ring follow the frame's radius —
					 * both the reasons `image-attachment.tsx` spells on its own tile.
					 */
					className="group/tile block cursor-pointer rounded-sm"
					aria-label={`Open ${displayName}`}
					title={file.path}
					onClick={() => void press()}
				>
					{ready ? (
						/*
						 * The picture box inside the frame's 1px reserved border: 115x76
						 * (117x78 total), `image-attachment.tsx`'s own thumbnail geometry,
						 * so a tile that is loading, loaded or failed is one slot.
						 */
						<AttachmentFrame boundary="control" className="h-[78px] w-[117px]">
							<img
								alt=""
								className="h-[76px] w-[115px] object-contain"
								src={thumb.url}
							/>
						</AttachmentFrame>
					) : failed ? (
						/*
						 * The glyph receipt: the failed-tile triple pinned for this file
						 * (`border-control` + `sunken` + the dim glyph), because with no
						 * picture the edge IS the tile's extent. The marker is what a
						 * capture rig can claim this state by.
						 */
						<span
							className="flex h-[78px] w-[117px] items-center justify-center rounded-sm border border-control bg-sunken text-ink-dim"
							data-supplement-image-fallback=""
						>
							<FileGlyph path={file.path} />
						</span>
					) : (
						/* The reserved box: the exact slot the picture will occupy. */
						<AttachmentFrame
							boundary="control"
							className="h-[78px] w-[117px]"
						/>
					)}
				</button>
				<div className={OVERLAY_REVEAL}>
					<FileActionsMenu
						overlay={true}
						actionPath={file.path}
						label={displayName}
						cwd={cwd}
						pane={pane}
					/>
				</div>
			</div>
		</li>
	);
});

export type SupplementImageGridProps = {
	/** The featured IMAGE-kind files, in record order. */
	files: readonly SupplementFile[];
	cwd?: string | null;
	pane: CanvasPane | null;
	/** The section's own pitch between this grid and the rows after it. */
	className?: string;
};

export const SupplementImageGrid = ({
	files,
	cwd,
	pane,
	className,
}: SupplementImageGridProps) => (
	/*
	 * A LIST, because that is what it is — the same argument `fold-media.tsx`
	 * makes for its strip: `role="list"` is not decoration, because Tailwind's
	 * preflight sets `list-style: none` and WebKit drops list semantics for a
	 * list without markers, so the role is what keeps the count in the name for
	 * a VoiceOver reader. The count and its noun mirror the strip's sentence.
	 */
	<ul
		/* biome-ignore lint/a11y/noRedundantRoles: WebKit drops the implicit list role when `list-style: none` is set, so the explicit one is what carries the count to VoiceOver. */
		/* biome-ignore lint/a11y/useSemanticElements: the element already IS the one the rule suggests - the explicit role is the WebKit fix above, not a substitute for `ul`. */
		role="list"
		aria-label={
			files.length === 1
				? "1 image from this run"
				: `${files.length} images from this run`
		}
		data-supplement-images=""
		className={cn("grid grid-cols-[repeat(4,max-content)] gap-2", className)}
	>
		{files.map((file) => (
			<SupplementImageTile key={file.path} file={file} cwd={cwd} pane={pane} />
		))}
	</ul>
);
