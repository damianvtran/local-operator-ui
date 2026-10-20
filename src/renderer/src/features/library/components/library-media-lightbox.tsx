/**
 * The Library preview's full-screen media viewer: the shared `ImageLightbox`
 * mounted over an image or clip, with the listing's other media as its group.
 *
 * WHY THIS EXISTS. The preview's picture was inert: the operator's item 7 is
 * "click the image or video in the details view to see it full screen, without
 * opening the full-screen details view". The distinction being drawn is a
 * viewer for the pixels, not a navigation to another surface — so the press
 * opens the one lightbox the chat and the project feed already use, and does
 * not touch the page's selection route.
 *
 * WHAT THIS MODULE OWNS, AND WHAT IT DELIBERATELY DOES NOT. The lightbox owns
 * the overlay, Escape, the close button, the focus trap and the focus return;
 * `ImageLightbox` already takes `mediaKind` ("image" | "video") and a `group`
 * (position, count, walk, strip) — see `project-update-assets.tsx` for the
 * precedent this borrows its shape from. So what is here is only the Library's
 * own vocabulary: which assets are siblings, where their bytes come from, and
 * the strip's tiles. A second overlay implementation would be the defect.
 *
 * THE ON-SCREEN ASSET KEEPS ITS ALREADY-RESOLVED URL. `MediaViewer` has the
 * current asset's object URL in hand; passing it in as `resolved` means opening
 * the lightbox costs no second content read. A sibling switched TO has not been
 * resolved yet, so that slide asks the same `useLibraryBytes`/`useObjectUrl`
 * pair every viewer here uses — a user-initiated slide change, not a second
 * fetch of the pixels already on screen.
 *
 * SIBLINGS ARE A DISPLAY-ORDER SNAPSHOT of the page's current listing (image
 * and video rows only), taken when the preview renders. The reader stays in
 * the lightbox when a strip tile is pressed: the selection route underneath is
 * the page's to change, and a viewer for the pixels must not move where the
 * reader is. One member renders no carousel chrome at all — `ImageLightbox`
 * decides that from the count, not from the caller.
 */

import { ImageLightbox } from "@shared/components/common/image-lightbox";
import { useEverInView } from "@shared/hooks/use-ever-in-view";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	clampGroupIndex,
	wrapGroupIndex,
} from "@shared/lib/image-viewer-model";
import { cn } from "@shared/lib/utils";
import type { FC, RefObject } from "react";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import { useLibraryBytes, useObjectUrl } from "../hooks/use-library-queries";
import { assetDisplayName } from "../library-model";
import { KindGlyph } from "./library-glyph";

/** The strip lane's tile: the project feed's 78px geometry, one surface over. */
const TILE_BOX = "h-[78px] w-[117px]";

/**
 * One sibling in the strip.
 *
 * THE THUMBNAIL READ IS `library-card.tsx`'s, deliberately: the backend has one
 * thumbnail route and inventing a second path here would be a second source of
 * the same picture. A clip has no `thumbnail` route to read (the card's own
 * gate says so), so its tile is the kind glyph — the same fallback a card with
 * no picture draws. The card's VIEWPORT GATE comes with it (agent review round
 * 1, M3): a page is 60 media rows and the strip maps every sibling at mount, so
 * an ungated read here issued one `library.thumbnail` IPC call per image the
 * moment the viewer opened. `useEverInView` starts a tile's read one tile ahead
 * of the strip's visible edge and latches, so scrolling the strip back never
 * re-reads - the same bound the grid's cards live under.
 */
const SiblingTile: FC<{
	asset: DesktopLibraryAsset;
	active: boolean;
	onSelect: () => void;
}> = ({ asset, active, onSelect }) => {
	const [tileRef, near] = useEverInView("300px");
	const thumbnail = useLibraryBytes(
		asset.id,
		"thumbnail",
		asset.kind === "image" && asset.exists && near,
	);
	const source = useObjectUrl(thumbnail.bytes, thumbnail.mimeType);
	/*
	 * NAMED BY THE ASSET, not by a new sentence. A per-tile label would need new
	 * English copy in seven shipped catalogues plus audited ledger receipts
	 * (`locale-parity` and `ledger-check` both run in the suite); the asset's own
	 * name is already the thing a reader needs to hear, and the active tile is
	 * marked by `aria-current`.
	 */
	const label = assetDisplayName(asset);
	return (
		<li
			ref={tileRef}
			className={cn(
				"flex shrink-0 rounded-sm leading-none",
				active && "ring-1 ring-ink",
			)}
		>
			<button
				type="button"
				aria-label={label}
				title={label}
				aria-current={active ? "true" : undefined}
				onClick={onSelect}
				data-library-lightbox-tile={asset.id}
				className="block cursor-pointer overflow-hidden rounded-sm leading-none"
			>
				<div
					className={cn(
						"flex items-center justify-center overflow-hidden bg-canvas",
						TILE_BOX,
					)}
				>
					{source ? (
						<img
							src={source}
							alt=""
							loading="lazy"
							decoding="async"
							className="size-full object-cover"
						/>
					) : (
						<KindGlyph kind={asset.kind} size={20} className="text-ink-dim" />
					)}
				</div>
			</button>
		</li>
	);
};

const SiblingStrip: FC<{
	siblings: readonly DesktopLibraryAsset[];
	index: number;
	onSelect: (index: number) => void;
}> = ({ siblings, index, onSelect }) => {
	return (
		<ul
			/* biome-ignore lint/a11y/noRedundantRoles: WebKit drops the implicit list role when `list-style: none` is set, so the explicit one is what carries the count. */
			/* biome-ignore lint/a11y/useSemanticElements: the element already IS the `ul` the rule suggests; the explicit role is the WebKit fix above. */
			role="list"
			data-library-lightbox-strip=""
			className="flex max-w-full items-center gap-2 overflow-x-auto px-2 py-1 leading-none"
		>
			{siblings.map((asset, tileIndex) => (
				<SiblingTile
					key={asset.id}
					asset={asset}
					active={tileIndex === index}
					onSelect={() => onSelect(tileIndex)}
				/>
			))}
		</ul>
	);
};

export type LibraryMediaLightboxProps = {
	/**
	 * Whether the overlay is on screen.
	 *
	 * THIS COMPONENT STAYS MOUNTED WHILE CLOSED, and that is what makes the focus
	 * return work: unmounting the `<Dialog>` from the caller's `onOpenChange(false)`
	 * tears the content down in the same commit, so Radix's `onCloseAutoFocus` never
	 * runs and focus falls to `<body>` — measured in the `MediaLightboxDismiss`
	 * story, which asserted `document.activeElement` against the trigger and got
	 * `<body>`. Closing through the `open` prop is the primitive's own path.
	 */
	open: boolean;
	/**
	 * The set, in the listing's display order, including the asset on screen.
	 * Never empty: `MediaViewer` falls back to the current asset alone.
	 */
	siblings: readonly DesktopLibraryAsset[];
	/** Zero-based position of the slide to show; the caller owns it. */
	index: number;
	onIndexChange: (index: number) => void;
	onClose: () => void;
	/** The control that opened this, so focus returns there on every exit. */
	restoreFocusTo: RefObject<HTMLElement | null>;
	/**
	 * The bytes `MediaViewer` already resolved for the asset it is showing.
	 * Matched by id, so a stale URL cannot be painted on a different slide.
	 */
	resolved: { assetId: string; url: string } | null;
};

export const LibraryMediaLightbox: FC<LibraryMediaLightboxProps> = ({
	open,
	siblings,
	index,
	onIndexChange,
	onClose,
	restoreFocusTo,
	resolved,
}) => {
	useI18nLocale();
	const position = clampGroupIndex(index, siblings.length);
	const asset = siblings[position];
	/*
	 * Only a slide other than the one the preview resolved fetches. `enabled`
	 * false leaves the hook's state empty, so returning to the original slide
	 * cannot paint the sibling's bytes under it.
	 */
	const resolvedHere = resolved?.assetId === asset.id;
	const content = useLibraryBytes(asset.id, "content", !resolvedHere);
	const fetched = useObjectUrl(
		content.bytes,
		content.mimeType || asset.ref.content_type,
	);
	const source = resolvedHere ? resolved?.url : (fetched ?? undefined);
	const name = assetDisplayName(asset);
	return (
		<ImageLightbox
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
			src={source}
			pending={
				/*
				 * NOTHING IS REALLY MISSING UNTIL THE READ HAS FAILED (agent review
				 * round 1, N5). A slide switched to starts at `loading: false`,
				 * `bytes: null`, so the disabled hook passes `src: undefined` for one
				 * render and the shared viewer would paint the caller's failure copy
				 * before the effect turns `loading` on. `src === undefined && !error`
				 * is the reserved box, not a failure.
				 */
				!resolvedHere &&
				(content.loading || (source === undefined && !content.error))
			}
			label={name}
			mediaKind={asset.kind === "video" ? "video" : "image"}
			mediaLabel="asset"
			restoreFocusTo={restoreFocusTo}
			layerAttributes={{ "data-library-lightbox": "" }}
			fallback={
				/*
				 * THE FALLBACK FOLLOWS A REAL FAILURE, never the unresolved frame (agent
				 * review round 1, N5). `content.error` is a read that failed; `source`
				 * being defined is the decode-failure path (`ImageLightbox` calls it
				 * when the bytes of a present URL will not paint), which must keep its
				 * copy. A slide that has not been read yet is neither, and is covered by
				 * `pending` above.
				 */
				content.error || source !== undefined ? (
					<p className="max-w-90 text-center text-body-sm text-ink-muted">
						{t("ui.library.preview.could_not_load")}
					</p>
				) : undefined
			}
			group={{
				index: position,
				count: siblings.length,
				onPrev: () =>
					onIndexChange(wrapGroupIndex(position, siblings.length, -1)),
				onNext: () =>
					onIndexChange(wrapGroupIndex(position, siblings.length, 1)),
				filmstrip:
					siblings.length > 1 ? (
						<SiblingStrip
							siblings={siblings}
							index={position}
							onSelect={onIndexChange}
						/>
					) : undefined,
			}}
		/>
	);
};
