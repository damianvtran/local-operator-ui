/**
 * The asset grid and list, and the card both share.
 *
 * THE CARD IS TWO CONTROLS, NOT ONE. The whole card selects the asset (a real
 * button, so keyboard order and focus are the browser's), and the overflow
 * menu is a sibling button pinned over the thumbnail. Nesting the menu trigger
 * inside the select button would put a button inside a button and leave the
 * menu's press ambiguous; the shared `rowCurrent` role paints the selected row
 * and `aria-pressed` states the same fact to a reader.
 *
 * FIXED GEOMETRY IS THE NO-LAYOUT-JUMP RULE: every thumbnail well is the same
 * aspect (16/10) in both the skeleton and the populated card, so the first page
 * arriving does not move the controls above it. The name and subtitle each get
 * a fixed line count, for the same reason - a long filename must not make its
 * card taller than its neighbours.
 */

import { SoundPlayer } from "@features/chat/canonical/sound-player";
import { rowCurrent } from "@features/chat/components/chat-sidebar";
import { Badge, Button } from "@shared/components/ui";
import { useEverInView } from "@shared/hooks/use-ever-in-view";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Heart, LoaderCircle, MessagesSquare, Star } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef } from "react";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import {
	useLibraryBytes,
	useLibraryWaveform,
	useObjectUrl,
} from "../hooks/use-library-queries";
import {
	assetDisplayName,
	assetSubtitle,
	formatBytes,
	formatDuration,
	originGroupLabelKey,
} from "../library-model";
import { LibraryAssetMenu } from "./library-asset-menu";
import { KindGlyph } from "./library-glyph";

export type LibraryCardActions = {
	onSelect: (id: string) => void;
	onAsk: (asset: DesktopLibraryAsset) => void;
	onEditMetadata: (asset: DesktopLibraryAsset) => void;
	onEditTags: (asset: DesktopLibraryAsset) => void;
	onToggleFavorite: (asset: DesktopLibraryAsset) => void;
	onOpenConversation: (sessionId: string) => void;
	onFilterSession: (sessionId: string) => void;
};

const OriginBadge: FC<{ group: string }> = ({ group }) => (
	<Badge variant={group === "generated" ? "accent" : "neutral"}>
		{t(originGroupLabelKey(group))}
	</Badge>
);

/** The image thumbnail, or the kind glyph when the backend serves no picture. */
const CardPicture: FC<{ asset: DesktopLibraryAsset; large?: boolean }> = ({
	asset,
	large = false,
}) => {
	/*
	 * THUMBNAIL READS WAIT UNTIL THE CARD IS NEAR THE VIEWPORT. The renderer
	 * starts a `library.thumbnail` IPC read per mounted image card, and a page
	 * is 60 cards; gating on the latch means a grid that is mostly below the
	 * fold reads the bytes a reader actually scrolls to. `300px` starts the
	 * read one row ahead so the picture is usually painted by the time the card
	 * arrives, and `useEverInView` latches so scrolling back never re-reads.
	 * The kind glyph stays until the bytes land, exactly as for a card with no
	 * picture at all.
	 */
	const [pictureRef, near] = useEverInView("300px");
	const wantsThumbnail = asset.kind === "image" && asset.exists && near;
	const thumbnail = useLibraryBytes(asset.id, "thumbnail", wantsThumbnail);
	const source = useObjectUrl(thumbnail.bytes, thumbnail.mimeType);
	return (
		<div
			ref={pictureRef}
			className={cn(
				"relative flex shrink-0 items-center justify-center overflow-hidden bg-canvas",
				large ? "aspect-[16/10] w-full" : "h-24 w-32",
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
				<KindGlyph
					kind={asset.kind}
					size={large ? 28 : 22}
					className="text-ink-dim"
				/>
			)}
		</div>
	);
};

const HighlightMark: FC = () => (
	<span
		className="absolute top-1.5 start-1.5 flex size-5 items-center justify-center rounded-full bg-elevated"
		title={t("ui.library.card.highlighted")}
	>
		<Star size={12} aria-hidden="true" className="fill-current text-accent" />
	</span>
);

/**
 * THE AT-REST FAVOURITE MARK, AND WHY IT IS A HEART RATHER THAN A STAR.
 *
 * The top-left badge this card already draws is a STAR for `highlighted` — the
 * librarian's own signal, not the user's. A favourite painted with the same
 * glyph in the same corner would be two meanings wearing one mark, which is the
 * defect the operator reported. The heart is the user's own press (the preview's
 * toggle and the card menu write `favorite`), shown at rest in the card's
 * trailing corner so a filter can be verified by looking, not by opening.
 *
 * It is NOT a control: the press lives in the menu and the preview, one door
 * each, and a third hit target on a card whose body is a select button is how a
 * tile ends up with two presses for one pixel.
 */
const FavoriteMark: FC = () => (
	<span
		className="flex size-5 shrink-0 items-center justify-center rounded-full bg-elevated"
		title={t("ui.library.menu.favorite")}
		data-library-favorite-mark=""
	>
		<Heart size={12} aria-hidden="true" className="fill-current text-accent" />
	</span>
);

const TagStrip: FC<{ asset: DesktopLibraryAsset }> = ({ asset }) => {
	if (asset.tags.length === 0) return null;
	const shown = asset.tags.slice(0, 2);
	return (
		<div className="flex flex-wrap items-center gap-1">
			{shown.map((tag) => (
				<Badge key={tag.id} variant="outline">
					{tag.name}
				</Badge>
			))}
			{asset.tags.length > shown.length && (
				<span className="text-meta text-ink-dim">
					+{asset.tags.length - shown.length}
				</span>
			)}
		</div>
	);
};

/**
 * The audio well: the card's picture slot holding the one shared sound player.
 *
 * WHY A WAVEFORM AND NOT A GLYPH. A sound card cannot be previewed by its
 * bytes, so the thumbnail well - the only place a card shows what the asset IS
 * - painted a speaker glyph and the reader had to open the drawer to hear it.
 * The player draws the stored envelope, plays in place, and seeks on the same
 * press every other sound seat uses; the drawer keeps the full-size player for
 * detail, not as the only way to listen.
 *
 * THE SAME TWO READS THE THUMBNAIL DOES, GATED THE SAME WAY. A page is 60
 * cards, so the content bytes and the peaks sidecar both wait for
 * `useEverInView`'s latch (`300px`, one row ahead) exactly as the image
 * thumbnail does; an unseen card costs no IPC. The well keeps the fixed 16/10
 * box in every state, so the bytes landing cannot move the grid, and the kind
 * glyph stays the fallback while there is no decodable source (a missing file,
 * a route the backend has not shipped yet).
 *
 * PEAKS ARE NOT A GATE. A 404 for the sidecar is a catalog fact, not a
 * failure: `peaks={null}` makes the player draw its flat scrubber, which is
 * still a working transport. Only bytes decide glyph-vs-player.
 */
const CardAudioWell: FC<{ asset: DesktopLibraryAsset }> = ({ asset }) => {
	const [wellRef, near] = useEverInView("300px");
	const wantsBytes = asset.exists && near;
	const content = useLibraryBytes(asset.id, "content", wantsBytes);
	const peaks = useLibraryWaveform(asset.id, wantsBytes);
	const source = useObjectUrl(
		content.bytes,
		content.mimeType || asset.ref.content_type,
	);
	return (
		<div
			ref={wellRef}
			data-library-audio-well=""
			className="relative flex aspect-[16/10] w-full shrink-0 items-center justify-center overflow-hidden bg-canvas px-2"
		>
			{source ? (
				<SoundPlayer
					variant="compact"
					ownerId={`sound:library:${asset.id}`}
					src={source}
					label={assetDisplayName(asset)}
					peaks={peaks}
					durationHint={asset.duration_s}
				/>
			) : (
				<KindGlyph kind={asset.kind} size={28} className="text-ink-dim" />
			)}
		</div>
	);
};

/** One grid tile. */
export const LibraryCard: FC<
	LibraryCardActions & { asset: DesktopLibraryAsset; selected: boolean }
> = ({ asset, selected, ...actions }) => {
	/*
	 * THE AUDIO CARD IS THREE SIBLING CONTROLS, NOT ONE. The player's transport
	 * buttons cannot live inside the select button: a button inside a button is
	 * invalid, focus order becomes ambiguous, and the play press would also
	 * select the asset and navigate the grid away from itself. So for audio the
	 * well (and its player) sits beside the select button instead of inside it,
	 * while the title area keeps the whole-card press. Every other kind keeps
	 * the original single-button card: their picture is inert, so nothing needs
	 * splitting. The overflow menu stays the third sibling, on both shapes.
	 */
	const audio = asset.kind === "audio";
	const details = (
		<div className="flex w-full flex-col gap-1 p-3">
			<span className="line-clamp-1 text-body-sm font-medium text-ink">
				{assetDisplayName(asset)}
			</span>
			<span className="line-clamp-1 text-meta text-ink-dim">
				{assetSubtitle(asset)}
			</span>
			<div className="flex items-center gap-2 text-meta text-ink-muted">
				<span className="truncate">{asset.kind}</span>
				<span aria-hidden="true">·</span>
				<span>{formatBytes(asset.size_bytes)}</span>
				{asset.duration_s ? (
					<>
						<span aria-hidden="true">·</span>
						<span>{formatDuration(asset.duration_s)}</span>
					</>
				) : null}
			</div>
			<TagStrip asset={asset} />
			{asset.occurrences[0]?.session_title && (
				<span className="flex min-w-0 items-center gap-1 text-meta text-ink-dim">
					<MessagesSquare size={12} aria-hidden="true" />
					<span className="truncate">{asset.occurrences[0].session_title}</span>
				</span>
			)}
			<div className="flex items-center justify-between gap-2 pt-1">
				<OriginBadge group={asset.origin_group} />
				<div className="flex items-center gap-2">
					{asset.session_count > 1 && (
						<span className="text-meta text-ink-dim">
							{t("ui.library.card.conversations", {
								count: asset.session_count,
							})}
						</span>
					)}
					{asset.favorite && <FavoriteMark />}
				</div>
			</div>
		</div>
	);
	const select = (
		<button
			type="button"
			onClick={() => actions.onSelect(asset.id)}
			aria-pressed={selected}
			className="flex w-full flex-1 flex-col text-start focus-visible:outline-offset-2"
		>
			{audio ? null : (
				<div className="relative">
					<CardPicture asset={asset} large />
					{asset.highlighted && <HighlightMark />}
				</div>
			)}
			{details}
		</button>
	);
	return (
		<article
			data-library-card-id={asset.id}
			data-glass-block=""
			className={cn(
				"group relative flex flex-col overflow-hidden rounded-lg border border-hairline bg-surface",
				selected && rowCurrent,
			)}
		>
			{audio && (
				<div className="relative">
					<CardAudioWell asset={asset} />
					{asset.highlighted && <HighlightMark />}
				</div>
			)}
			{select}
			<div className="invisible absolute top-1.5 end-1.5 group-focus-within:visible group-hover:visible [@media(pointer:coarse)]:visible">
				<LibraryAssetMenu
					asset={asset}
					onAsk={() => actions.onAsk(asset)}
					onEditMetadata={() => actions.onEditMetadata(asset)}
					onEditTags={() => actions.onEditTags(asset)}
					onToggleFavorite={() => actions.onToggleFavorite(asset)}
					onOpenConversation={actions.onOpenConversation}
					onFilterSession={actions.onFilterSession}
					triggerClassName="bg-elevated"
				/>
			</div>
		</article>
	);
};

/** One list row: the dense view for names and documents. */
export const LibraryRow: FC<
	LibraryCardActions & { asset: DesktopLibraryAsset; selected: boolean }
> = ({ asset, selected, ...actions }) => (
	<article
		data-library-card-id={asset.id}
		data-glass-block=""
		className={cn(
			"group relative flex items-center gap-3 rounded-md border border-hairline bg-surface px-3 py-2",
			selected && rowCurrent,
		)}
	>
		<button
			type="button"
			onClick={() => actions.onSelect(asset.id)}
			aria-pressed={selected}
			className="flex min-w-0 flex-1 items-center gap-3 text-start"
		>
			<CardPicture asset={asset} />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex items-center gap-1.5 truncate text-body-sm font-medium text-ink">
					{asset.highlighted && (
						<Star
							size={12}
							aria-hidden="true"
							className="shrink-0 fill-current text-accent"
						/>
					)}
					{assetDisplayName(asset)}
				</span>
				<span className="truncate text-meta text-ink-dim">
					{assetSubtitle(asset)}
				</span>
			</div>
			<div className="flex shrink-0 items-center gap-3 text-meta text-ink-muted">
				<TagStrip asset={asset} />
				<span>{asset.kind}</span>
				<span>{formatBytes(asset.size_bytes)}</span>
				<OriginBadge group={asset.origin_group} />
				{asset.favorite && <FavoriteMark />}
			</div>
		</button>
		<LibraryAssetMenu
			asset={asset}
			onAsk={() => actions.onAsk(asset)}
			onEditMetadata={() => actions.onEditMetadata(asset)}
			onEditTags={() => actions.onEditTags(asset)}
			onToggleFavorite={() => actions.onToggleFavorite(asset)}
			onOpenConversation={actions.onOpenConversation}
			onFilterSession={actions.onFilterSession}
		/>
	</article>
);

/** The grid, its pagination sentinel, and the loading tail. */
export const LibraryGrid: FC<
	LibraryCardActions & {
		assets: DesktopLibraryAsset[];
		selectedId: string | null;
		view: "grid" | "list";
		hasMore: boolean;
		loadingMore: boolean;
		onLoadMore: () => void;
	}
> = ({
	assets,
	selectedId,
	view,
	hasMore,
	loadingMore,
	onLoadMore,
	...actions
}) => {
	const sentinel = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the observer re-arms when the page tail or its availability changes.
	useEffect(() => {
		const node = sentinel.current;
		if (!node || !hasMore) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
			},
			{ rootMargin: "600px 0px" },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [hasMore, onLoadMore, assets.length]);

	return (
		<div className="flex flex-col gap-4">
			{view === "grid" ? (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(208px,1fr))] gap-4">
					{assets.map((asset) => (
						<LibraryCard
							key={asset.id}
							asset={asset}
							selected={asset.id === selectedId}
							{...actions}
						/>
					))}
				</div>
			) : (
				<div className="flex flex-col gap-1.5">
					{assets.map((asset) => (
						<LibraryRow
							key={asset.id}
							asset={asset}
							selected={asset.id === selectedId}
							{...actions}
						/>
					))}
				</div>
			)}
			<div ref={sentinel} className="flex justify-center py-6">
				{loadingMore && (
					<span className="flex items-center gap-2 text-body-sm text-ink-muted">
						<LoaderCircle
							size={14}
							aria-hidden="true"
							className="motion-safe:animate-spin"
						/>
						{t("ui.library.grid.loading_more")}
					</span>
				)}
				{!loadingMore && hasMore && (
					<Button variant="ghost" size="sm" onClick={onLoadMore}>
						{t("ui.library.grid.load_more")}
					</Button>
				)}
			</div>
		</div>
	);
};

/** The first-page skeleton: the same geometry as the populated grid. */
export const LibraryGridSkeleton: FC<{ view: "grid" | "list" }> = ({
	view,
}) => {
	if (view === "list") {
		return (
			<div
				className="flex flex-col gap-1.5"
				aria-hidden="true"
				data-library-skeleton=""
			>
				{Array.from({ length: 8 }, (_, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: a skeleton has no identity beyond its slot.
						key={index}
						className="flex h-28 items-center gap-3 rounded-md border border-hairline bg-surface px-3"
					>
						<div className="h-24 w-32 rounded-sm bg-sunken" />
						<div className="flex flex-1 flex-col gap-2">
							<div className="h-3 w-1/3 rounded-xs bg-sunken" />
							<div className="h-3 w-1/2 rounded-xs bg-sunken" />
						</div>
					</div>
				))}
			</div>
		);
	}
	return (
		<div
			className="grid grid-cols-[repeat(auto-fill,minmax(208px,1fr))] gap-4"
			aria-hidden="true"
			data-library-skeleton=""
		>
			{Array.from({ length: 12 }, (_, index) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: a skeleton has no identity beyond its slot.
					key={index}
					className="flex flex-col overflow-hidden rounded-lg border border-hairline bg-surface"
				>
					<div className="aspect-[16/10] bg-sunken" />
					<div className="flex flex-col gap-2 p-3">
						<div className="h-3 w-2/3 rounded-xs bg-sunken" />
						<div className="h-3 w-1/2 rounded-xs bg-sunken" />
						<div className="h-3 w-1/3 rounded-xs bg-sunken" />
					</div>
				</div>
			))}
		</div>
	);
};
