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
	/** Images past the 2×2 grid; the last visible tile carries `+N`. */
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
					 * `overflow-hidden` group that would clip an outset ring.
					 */
					"focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus",
					single
						? "focus-visible:outline-offset-2"
						: "focus-visible:-outline-offset-2",
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
				{more > 0 && (
					<span
						aria-hidden="true"
						/* A raised label, not an alpha scrim: there is no scrim role, and
						   the picture under it stays legible as the set's fourth image. */
						className="absolute inset-0 flex items-center justify-center"
					>
						<span className="rounded-sm bg-elevated px-2 py-1 font-semibold text-[13px] text-ink">
							{`+${more}`}
						</span>
					</span>
				)}
			</button>
			{url && !more && (
				<div className={CLUSTER_CLASS} data-attachment-actions="">
					{/* Out of the tab order: the tile itself is the keyboard's open
					    control, and two stops with one name would read twice. */}
					<button
						type="button"
						tabIndex={-1}
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
							aria-label={t("ui.chat.image_actions.save_as")}
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
	/* A tiny source keeps its 64px box; there the glyph alone carries the
	   state and the sentence stays the accessible description. */
	const roomy = !box || (box.width >= 120 && box.height >= 88);
	const Icon = kind === "expired" ? Clock : ImageOff;
	return (
		<div
			role="img"
			aria-label={label}
			aria-describedby={copyId}
			style={boxStyle(box)}
			className={cn(
				"flex flex-col items-center justify-center gap-1 break-words bg-media-surface px-2 text-center text-[12px] text-ink-muted",
				box ? "rounded-md" : "size-full rounded-xs",
			)}
			{...attributes}
		>
			<Icon size={20} aria-hidden="true" className="shrink-0 text-ink-dim" />
			<span id={copyId} className={roomy ? undefined : "sr-only"}>
				{copy}
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
