/**
 * Team Bridge inline images (visual refresh SPEC §3.1, finding D1).
 *
 * WHY THIS EXISTS. The operator's report: images sat in a bordered card with a
 * "File" caption and an "N bytes" line, a document receipt rather than a
 * picture. Slack and Discord show the picture and nothing else, so here the
 * image IS the attachment: a 10px-rounded box on `bg-media-surface`, no border
 * at rest or on hover, no caption. Both authorities draw through this module -
 * the member byte relay (`team-bridge-attachments.tsx`) and the owner audit
 * (`audit-attachment-group.tsx`) - so the two transcripts cannot drift apart.
 *
 * WHY NOT `AttachmentFrame`. The chat frame's `control` boundary brings its
 * edge back on hover, which is the frame the operator asked to lose; adding a
 * third boundary to a component chat and projects share would change a
 * contract those surfaces do not need changed. This module owns the bridge's
 * tile instead and keeps the frame's two rules that still apply: the box is
 * reserved from the descriptor before any byte arrives (no reflow), and the
 * ground is `mediaSurface`, the role authored to separate from every page
 * ground at rest.
 *
 * Presentation only. Nothing here fetches, caches or decides authority; the
 * caller hands in a URL it already holds (or `null` while it waits).
 */
import { Skeleton } from "@shared/components/ui/skeleton";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Clock, Download, ImageIcon, ImageOff, Maximize2 } from "lucide-react";
import { type Ref, useEffect, useId, useState } from "react";

/** A reserved single-image box, or `null` for a grid cell that fills its slot. */
export type InlineImageBox = { width: number; height: number } | null;

/**
 * How long a tile waits before it says it is still waiting. A relay answers in
 * well under a second, and a glyph that appeared and vanished inside that time
 * would flicker on every scroll; a reader looking at an empty pulsing box for
 * longer than this deserves to know a picture belongs there.
 */
export const INLINE_IMAGE_HELD_MS = 1000;

function useHeld(waiting: boolean): boolean {
	const [held, setHeld] = useState(false);
	useEffect(() => {
		if (!waiting) {
			setHeld(false);
			return;
		}
		const timer = window.setTimeout(() => setHeld(true), INLINE_IMAGE_HELD_MS);
		return () => window.clearTimeout(timer);
	}, [waiting]);
	return held;
}

/** The reserved box as inline style; a grid cell takes its slot's size. */
function boxStyle(box: InlineImageBox) {
	return box
		? { width: box.width, height: box.height, maxWidth: "100%" }
		: undefined;
}

/*
 * THE ACTION CLUSTER leaves the flow (it floats over the picture), so it takes
 * the system's one shadow (`shadow-overlay`, branding §2 "Elevation") and an
 * `elevated` fill; it is the only chrome a tile shows and only on hover or
 * keyboard focus. `pointer-events-none` while hidden so an invisible button
 * never swallows the click meant for the picture under it.
 */
const CLUSTER_CLASS = cn(
	"pointer-events-none absolute end-2 top-2 flex gap-0.5 rounded-sm bg-elevated p-0.5 opacity-0 shadow-overlay",
	"transition-opacity duration-fast ease-out-quart",
	"group-hover/tile:pointer-events-auto group-hover/tile:opacity-100",
	"group-focus-within/tile:pointer-events-auto group-focus-within/tile:opacity-100",
);
/* Hover is a colour step, focus an outline (AGENTS.md, Design and branding). */
const CLUSTER_BUTTON_CLASS =
	"flex size-7 items-center justify-center rounded-xs text-ink-muted hover:bg-row-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

export function InlineImageTile({
	url,
	box,
	fit,
	label,
	openLabel,
	onOpen,
	onDownload,
	buttonRef,
	overflow,
	busy,
}: {
	/** `null` while the bytes are on their way: the reserved box is the state. */
	url: string | null;
	box: InlineImageBox;
	fit: "cover" | "contain";
	/** The picture's own name (`Image 2 of 4`), its `alt`. */
	label: string;
	/** The open control's name (`Open image 2 of 4`). */
	openLabel: string;
	onOpen: () => void;
	/** Omitted where this client offers no download (owner audit, #1634). */
	onDownload?: () => void;
	buttonRef?: Ref<HTMLButtonElement>;
	/**
	 * Images past the 2×2 grid. The group draws the visible `+N` label over
	 * the slot (so it survives a failed fourth tile); the tile uses the count
	 * only for its accessible name and to drop the action cluster.
	 */
	overflow?: number;
	/** `aria-busy` while loading, for the audit tile's existing contract. */
	busy?: boolean;
}) {
	const held = useHeld(!url);
	const single = box !== null;
	const more = overflow && overflow > 0 ? overflow : 0;
	/*
	 * LABEL IN NAME (WCAG 2.5.3): a `+3` tile is named `+3 more images`, the
	 * name chat's own picture strip uses, so a speech user saying what they see
	 * hits it. It still opens this picture and the lightbox walks on from it.
	 */
	const name = more
		? t("ui.chat.canonical.fold.more_images", {
				count: more,
				count_display: String(more),
			})
		: openLabel;
	return (
		<div
			className={cn(
				"group/tile relative max-w-full",
				single ? "rounded-md" : "size-full rounded-xs",
			)}
			style={boxStyle(box)}
		>
			<button
				ref={buttonRef}
				type="button"
				aria-label={name}
				title={name}
				aria-busy={busy}
				disabled={!url}
				onClick={onOpen}
				className={cn(
					"block size-full cursor-zoom-in overflow-hidden leading-none disabled:cursor-progress",
					single ? "rounded-md" : "rounded-xs",
					/* The letterbox ground once the picture is in. While it loads the
					   Skeleton paints the same role and pulses it; a fill under the
					   pulse would hide it. */
					url && "bg-media-surface",
					/*
					 * OUTSET on a single image: there is no border to sit the ring
					 * inside any more. INSET in a grid, whose shared 10px corner is an
					 * `overflow-hidden` group that would clip an outset ring. The inset
					 * needs `!`: `html :focus-visible`'s 2px offset in `styles/index.css`
					 * is unlayered, so it beats any `@layer utilities` class (QA round 1,
					 * Q1; the same fix as `browser-tab-strip.tsx`).
					 */
					"focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus",
					single
						? "focus-visible:outline-offset-2"
						: "focus-visible:-outline-offset-2!",
				)}
				data-attachment-reserved={url ? undefined : ""}
			>
				{url ? (
					<img
						src={url}
						alt={label}
						draggable={false}
						/*
						 * `scale-down` for the letterbox: contain for a large panorama,
						 * natural size for a picture smaller than its 64px-floored box,
						 * so a pasted icon is never upscaled into mush.
						 */
						className={cn(
							"size-full",
							fit === "cover" ? "object-cover" : "object-scale-down",
						)}
					/>
				) : (
					/* The reserved box pulses at its final size; after the held delay a
					   picture glyph says what is coming. Nothing here changes size. */
					<span className="relative flex size-full items-center justify-center">
						<Skeleton
							aria-hidden="true"
							className="absolute inset-0 rounded-none bg-media-surface"
						/>
						{held && (
							<ImageIcon
								size={20}
								aria-hidden="true"
								data-attachment-held=""
								className="relative text-ink-dim"
							/>
						)}
					</span>
				)}
			</button>
			{url && !more && (
				<div
					data-lo-floating=""
					className={CLUSTER_CLASS}
					data-attachment-actions=""
				>
					{/* Out of the tab order AND the accessibility tree: the tile itself
					    is the open control, and a second node with its name would be
					    read twice by a virtual cursor (agent review round 1, nit 2). */}
					<button
						type="button"
						tabIndex={-1}
						aria-hidden="true"
						aria-label={openLabel}
						title={openLabel}
						onClick={onOpen}
						className={CLUSTER_BUTTON_CLASS}
					>
						<Maximize2 size={16} aria-hidden="true" />
					</button>
					{onDownload && (
						<button
							type="button"
							/*
							 * NAMED PER IMAGE (agent review round 1, minor 5): in a set,
							 * a screen reader's button list must tell the Saves apart, so
							 * the name carries the picture's own label ("Save Image 2 of
							 * 4"); the tooltip stays the menu's plain "Save as…".
							 */
							aria-label={t("ui.common.forms.autocomplete_field.save", {
								label,
							})}
							title={t("ui.chat.image_actions.save_as")}
							onClick={onDownload}
							className={CLUSTER_BUTTON_CLASS}
						>
							<Download size={16} aria-hidden="true" />
						</button>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * A picture that will not be drawn: refused, withheld, expired, or failed.
 * The SAME box as the picture it stands in for, so a retry that succeeds does
 * not move the message below it. No border: the `mediaSurface` fill is the
 * extent, as it is for a working tile.
 */
export function InlineImageFailure({
	box,
	label,
	copy,
	kind = "unavailable",
	onRetry,
	retryLabel,
	attributes,
}: {
	box: InlineImageBox;
	label: string;
	copy: string;
	kind?: "unavailable" | "expired" | "failed";
	onRetry?: () => void;
	retryLabel?: string;
	attributes?: Partial<Record<`data-${string}`, string>>;
}) {
	const copyId = useId();
	/* A tiny source keeps its 64px box, and a grid cell (`box: null`) is one of
	   several: in both the glyph alone carries the state and the sentence stays
	   the accessible description (design round 1, D2: four cells each repeating
	   "Image unavailable" was the heaviest frame in the set). */
	const roomy = box !== null && box.width >= 120 && box.height >= 88;
	const Icon = kind === "expired" ? Clock : ImageOff;
	return (
		<div
			style={boxStyle(box)}
			className={cn(
				"flex flex-col items-center justify-center gap-1 break-words bg-media-surface px-2 text-center text-[12px] text-ink-muted",
				box ? "rounded-md" : "size-full rounded-xs",
			)}
			/* The `+N` overlay reads this to step aside to a corner (see
			   `InlineImageOverflow`). */
			data-image-failure=""
			{...attributes}
		>
			{/*
			 * `role="img"` wraps the glyph and the sentence only: an `img` has
			 * presentational children, so a Retry inside it could be flattened
			 * away by assistive tech (agent review round 1, minor 4). Retry is
			 * the image's sibling, a real button.
			 */}
			<span
				role="img"
				aria-label={label}
				aria-describedby={copyId}
				/* A glyph-only cell keeps its sentence for a sighted pointer too: the
				   copy is screen-reader-only there, and the bare glyph left no way to
				   tell "unavailable" from "expired" but its shape (#1659 design D4). */
				title={roomy ? undefined : copy}
				className="flex flex-col items-center gap-1"
			>
				<Icon size={20} aria-hidden="true" className="shrink-0 text-ink-dim" />
				<span id={copyId} className={roomy ? undefined : "sr-only"}>
					{copy}
				</span>
			</span>
			{onRetry && (
				<button
					type="button"
					onClick={onRetry}
					/* 24px tall hit area for a text control. */
					className="min-h-6 rounded-sm px-1.5 font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
				>
					{retryLabel}
				</button>
			)}
		</div>
	);
}

/**
 * The `+N` on the last visible grid tile (agent review round 1, M1). Drawn by
 * the GROUP over the slot rather than by the tile, so it shows whatever state
 * the fourth picture is in - a refused, expired or failed fourth tile used to
 * drop it and hide images 5+ with no cue. A raised label rather than an alpha
 * scrim: there is no scrim role, and the picture under it stays legible as
 * the set's fourth image. `aria-hidden`: the ready tile's name already says
 * "+N more images" (label in name), and a failed one keeps its own name.
 *
 * ON A FAILED FOURTH TILE IT MOVES TO THE TOP-END CORNER (#1659 review minor
 * 1). Centred, it covered the failure glyph and the top half of a retryable
 * tile's "Retry" text - the one recovery control in the cell. The slot's `<li>`
 * is the `group/slot`; `data-image-failure` on the failure tile is what the
 * corner placement keys on, so a picture keeps the centred label.
 */
export function InlineImageOverflow({ count }: { count: number }) {
	return (
		<span
			aria-hidden="true"
			data-attachment-overflow={String(count)}
			className="pointer-events-none absolute inset-0 flex items-center justify-center group-has-[[data-image-failure]]/slot:items-start group-has-[[data-image-failure]]/slot:justify-end group-has-[[data-image-failure]]/slot:p-1"
		>
			<span className="rounded-sm bg-elevated px-2 py-1 font-semibold text-[13px] text-ink">
				{`+${count}`}
			</span>
		</span>
	);
}
