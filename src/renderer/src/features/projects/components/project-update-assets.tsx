/**
 * One update's evidence, as a grid of the SAME attachment components the chat
 * renders — not a second viewer.
 *
 * WHY A GRID AND WHY THESE COMPONENTS. The project feed used to draw an image
 * with `ImageAttachment`'s default (a solitary picture that expands to a
 * single-image lightbox) and every other attachment as a file row. That is two
 * readers for one entry and a wall of pictures with no way to walk them. An
 * update is a REPORT: its pictures are one set produced by one action, and the
 * operator's ask is the transcript's own behaviour — a tile that opens a
 * gallery of that set, with a filmstrip. So the tiles are the shipped
 * `ImageAttachment` (`size="thumbnail"`), the menu is the shared
 * `FileActionsMenu`, the sound is the canonical `SoundPlayer`, and the overlay
 * is the shared `ImageLightbox`. This module owns only the project-shaped
 * wiring: path-backed bytes (`useFileBlobUrl`), the per-update set, and the
 * legacy `data` classification.
 *
 * WHAT COUNTS AS WHICH KIND. An explicit kind from the backend (`image`,
 * `audio` or `video`) is used as written. Every other row is classified by
 * extension (`fileKind`, the one classifier) — which covers both the legacy
 * `data` rows written before those kinds existed and today's markdown/PDF
 * rows, so a `.wav` is still a player and a `.mp4` is still a clip.
 *
 * LAZINESS IS THE FEED'S CONTRACT. A project with forty updates of three
 * attachments opens without reading a hundred and twenty files. Every tile
 * reserves its exact slot on first render and mounts its byte reader only when
 * `useEverInView` has seen it near the viewport (latched, so scrolling back
 * does not re-read). `loading="lazy"`/`decoding="async"` are on the pictures
 * `ImageAttachment` draws. The video thumb still costs one whole-file read when
 * its tile is admitted (`useFileBlobUrl` reads the stored bytes; `preload` is
 * about the element's fetch, not the bridge), and `preload="metadata"` only
 * keeps the element from starting a second fetch afterwards.
 *
 * SOUNDS HAVE NO PEAKS HERE. Peaks are a generated-media artefact (the speech
 * store's waveform); a project attachment is a file on disk with no stored
 * waveform, and inventing one would be a second truth. `SoundPlayer`'s flat
 * scrubber is the designed fallback for exactly that case, and no
 * `durationHint` is passed because the player reads the real duration from the
 * element's metadata.
 *
 * LIGHTBOX OWNERSHIP. One gallery per update, owned here. The tile press passes
 * `ImageAttachment`'s `press` override, which suppresses that component's own
 * single-image overlay; the grid opens the one `ImageLightbox` with the update's
 * image+video set as its group. The chat carousel (`image-group-lightbox`) is
 * the behavioural precedent, not the implementation: it resolves canonical
 * attachment digests through `useAttachmentUrl`, while this surface has file
 * paths and mixed media (a video slide), so the shared `ImageLightbox` is
 * extended with `mediaKind` rather than forked.
 */

import { SoundPlayer } from "@features/chat/canonical/sound-player";
import { FileGlyph } from "@features/chat/canonical/supplement-file-actions";
import { fileKind, mimeTypeForPath } from "@features/chat/utils/file-kind";
import { isMarkdownFile } from "@features/chat/utils/is-markdown-file";
import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import { ImageLightbox } from "@shared/components/common/image-lightbox";
import { useEverInView } from "@shared/hooks/use-ever-in-view";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { wrapGroupIndex } from "@shared/lib/image-viewer-model";
import { cn } from "@shared/lib/utils";
import { Play } from "lucide-react";
import type { FC } from "react";
import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopProjectAttachment } from "../../../../../shared/desktop-control-contract";
import {
	AttachmentFrame,
	BrokenAttachment,
} from "../../chat/components/message-item/attachment-frame";
import { ImageAttachment } from "../../chat/components/message-item/image-attachment";
import { attachmentSizeText } from "../project-model";
import { ProjectFilePreviewDialog } from "./project-file-preview-dialog";

/** The four renderings an attachment can take on this surface. */
type ProjectAssetKind = "image" | "video" | "audio" | "file";

const PATH_SEPARATOR_REGEX = /[/\\]/;
const attachmentName = (attachment: DesktopProjectAttachment): string => {
	if (attachment.name) return attachment.name;
	const parts = attachment.path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1] || t("ui.projects.project_updates.attachment");
};

/**
 * Classify one row: the writer's explicit kind first, the extension second
 * (legacy rows say `data` for sounds and clips), the file tile third.
 */
export function projectAssetKind(
	attachment: DesktopProjectAttachment,
): ProjectAssetKind {
	const declared = attachment.kind.trim().toLowerCase();
	if (declared === "image" || declared === "video" || declared === "audio") {
		return declared;
	}
	const inferred = fileKind(attachment.name || attachment.path);
	if (inferred === "image" || inferred === "video" || inferred === "audio") {
		return inferred;
	}
	return "file";
}

/** The one byte-reader call site's options, shared by the tile and the layer. */
const blobOptions = (attachment: DesktopProjectAttachment) => {
	const stamp = Date.parse(attachment.added_at);
	return {
		mimeType: mimeTypeForPath(attachment.name || attachment.path),
		sizeBytes: attachment.bytes,
		/*
		 * THE SHARED CACHE KEY. A holder without an mtime is keyed per holder, so
		 * the tile, every filmstrip tile and the lightbox each read the file
		 * again. A stored copy is immutable and `added_at` is its identity, so
		 * the stamp names the same bytes for every holder and they share one
		 * read. A malformed stamp falls back to the per-holder path deliberately:
		 * re-reading is the safe answer to "I cannot prove this is the same
		 * file".
		 */
		...(Number.isFinite(stamp) ? { mtimeMs: stamp } : {}),
	};
};

/** The stable identity of an attachment: the same file added twice is two rows. */
const assetKey = (attachment: DesktopProjectAttachment): string =>
	`${attachment.path}:${attachment.added_at}`;

/** The chat tile's own total box (117x78), shared with every media slot. */
const MEDIA_BOX = "h-[78px] w-[117px]";

/**
 * The chat grid's hover reveal (`supplement-image-grid.tsx`'s `OVERLAY_REVEAL`,
 * repeated here rather than imported: that module is the chat feature's
 * canonical surface and importing it would pull its Finder-thumbnail pipeline
 * into the projects bundle). Hidden with pointer events off, brought back by
 * hover, by keyboard focus anywhere in the tile, and kept while its menu is
 * open — so hidden and unreachable are not the same thing.
 */
const ASSET_ACTIONS_REVEAL =
	"pointer-events-none absolute top-1 end-1 z-[2] flex opacity-0 transition-opacity duration-fast ease-out-quart group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100";

/** The reserved state every lazy tile shows before its bytes are admitted. */
const ReservedTile: FC<{ kind: "image" | "video" | "file" | "audio" }> = ({
	kind,
}) =>
	kind === "audio" ? (
		<div className="h-11 w-[242px] max-w-full rounded-sm border border-hairline bg-sunken" />
	) : (
		<AttachmentFrame boundary="control" className={MEDIA_BOX} />
	);

const ProjectImageTileBody: FC<{
	attachment: DesktopProjectAttachment;
	onOpen: () => void;
}> = ({ attachment, onOpen }) => {
	useI18nLocale();
	const name = attachmentName(attachment);
	const state = useFileBlobUrl(attachment.path, blobOptions(attachment));
	if (state.status === "ready") {
		const openLabel = t("ui.projects.project_updates.open_name", {
			name: String(name),
		});
		return (
			<ImageAttachment
				file={attachment.path}
				src={state.url}
				label={name}
				conversationId=""
				size="thumbnail"
				press={{
					onPress: onOpen,
					label: openLabel,
					title: openLabel,
				}}
			/>
		);
	}
	if (state.status === "loading") {
		return (
			<AttachmentFrame boundary="control" className={MEDIA_BOX}>
				<span className="sr-only">
					{t("ui.projects.project_updates.loading")}
					{name}
				</span>
			</AttachmentFrame>
		);
	}
	return <BrokenAttachment name={name} compact={true} />;
};

/**
 * One picture tile. The outer div is the grid slot and the observation anchor;
 * the body (and with it `useFileBlobUrl`) mounts only once the slot is near.
 */
const ProjectImageTile: FC<{
	attachment: DesktopProjectAttachment;
	onOpen: () => void;
}> = ({ attachment, onOpen }) => {
	const [anchorRef, near] = useEverInView();
	return (
		<div
			ref={anchorRef}
			/*
			 * `flex`, not `block`: `ImageAttachment`'s root is an inline-block, and
			 * in a block wrapper the line box left a 1px baseline tail (measured
			 * 79px against the 78px frame). A flex container blockifies the child,
			 * so the slot is exactly the frame.
			 */
			className="group relative flex leading-none"
			data-project-asset-tile="image"
		>
			{near ? (
				<ProjectImageTileBody attachment={attachment} onOpen={onOpen} />
			) : (
				<ReservedTile kind="image" />
			)}
		</div>
	);
};

const ProjectVideoTileBody: FC<{
	attachment: DesktopProjectAttachment;
	onOpen: () => void;
}> = ({ attachment, onOpen }) => {
	useI18nLocale();
	const name = attachmentName(attachment);
	const state = useFileBlobUrl(attachment.path, blobOptions(attachment));
	if (state.status !== "ready") {
		return state.status === "loading" ? (
			<ReservedTile kind="video" />
		) : (
			<BrokenAttachment name={name} compact={true} />
		);
	}
	const playLabel = t("ui.projects.project_updates.play_name", {
		name: String(name),
	});
	return (
		<>
			<button
				type="button"
				className="group/tile block cursor-pointer rounded-sm"
				aria-label={playLabel}
				title={playLabel}
				onClick={onOpen}
			>
				<AttachmentFrame
					boundary="control"
					className={cn(MEDIA_BOX, "relative")}
				>
					<video
						src={state.url}
						preload="metadata"
						muted={true}
						playsInline={true}
						className={cn(
							"h-[76px] w-[115px] object-contain",
							// The chat thumbnail's own hover step: the picture enlarges
							// inside the fixed frame, so the slot never moves.
							"motion-safe:transition-transform motion-safe:duration-fast motion-safe:ease-out-quart",
							"motion-safe:group-hover/tile:scale-[1.04]",
						)}
						data-project-video-thumb=""
					/>
					{/*
					 * The play glyph is the tile's resting affordance (the picture
					 * itself is often its first frame, which reads as a still). It
					 * is decorative: the button's own name already says "Play".
					 */}
					<span className="pointer-events-none absolute inset-0 flex items-center justify-center">
						<Play
							className="size-6 text-ink"
							fill="currentColor"
							aria-hidden="true"
						/>
					</span>
				</AttachmentFrame>
			</button>
		</>
	);
};

const ProjectVideoTile: FC<{
	attachment: DesktopProjectAttachment;
	onOpen: () => void;
}> = ({ attachment, onOpen }) => {
	const [anchorRef, near] = useEverInView();
	return (
		<div
			ref={anchorRef}
			className="group relative block leading-none"
			data-project-asset-tile="video"
		>
			{near ? (
				<ProjectVideoTileBody attachment={attachment} onOpen={onOpen} />
			) : (
				<ReservedTile kind="video" />
			)}
			{/* The actions outlive the bytes: a moved clip keeps its menu. */}
			<div className={ASSET_ACTIONS_REVEAL}>
				<FileActionsMenu
					filePath={attachment.path}
					aria-label={t("ui.projects.project_updates.file_actions_for_name", {
						name: String(attachmentName(attachment)),
					})}
				/>
			</div>
		</div>
	);
};

const ProjectSoundTileBody: FC<{
	attachment: DesktopProjectAttachment;
}> = ({ attachment }) => {
	useI18nLocale();
	const name = attachmentName(attachment);
	const state = useFileBlobUrl(attachment.path, blobOptions(attachment));
	if (state.status !== "ready") {
		return state.status === "loading" ? (
			<ReservedTile kind="audio" />
		) : (
			<BrokenAttachment name={name} />
		);
	}
	return (
		<div className="w-[242px] max-w-full rounded-sm border border-hairline bg-surface px-2">
			<SoundPlayer
				ownerId={`project-sound:${attachment.path}`}
				src={state.url}
				label={name}
				peaks={null}
				variant="compact"
			/>
		</div>
	);
};

/**
 * A sound spans two 117px columns. The player's compact row is the chat's own
 * width budget (a 44px control plus a scrubber); one column would leave the
 * scrubber too short to aim at, and the cap stops the tile growing with the
 * feed's spare width.
 */
const ProjectSoundTile: FC<{ attachment: DesktopProjectAttachment }> = ({
	attachment,
}) => {
	const [anchorRef, near] = useEverInView();
	return (
		<div
			ref={anchorRef}
			className="group relative block leading-none sm:col-span-2"
			data-project-asset-tile="audio"
		>
			{near ? (
				<ProjectSoundTileBody attachment={attachment} />
			) : (
				<ReservedTile kind="audio" />
			)}
			<div className={ASSET_ACTIONS_REVEAL}>
				<FileActionsMenu
					filePath={attachment.path}
					aria-label={t("ui.projects.project_updates.file_actions_for_name", {
						name: String(attachmentName(attachment)),
					})}
				/>
			</div>
		</div>
	);
};

/** Whether this file has an in-app reader (markdown, JSON, plain text/log). */
const previewsInApp = (attachment: DesktopProjectAttachment): boolean => {
	const path = attachment.name || attachment.path;
	if (isMarkdownFile(path)) return true;
	const kind = fileKind(path);
	return kind === "text" || kind === "code";
};

const ProjectFileTile: FC<{
	attachment: DesktopProjectAttachment;
	/**
	 * The door the reader used, so the preview can hand focus back to the tile
	 * even when the press came from the ellipsis menu (whose content unmounts).
	 */
	onPreview: (trigger: HTMLElement | null) => void;
}> = ({ attachment, onPreview }) => {
	useI18nLocale();
	const name = attachmentName(attachment);
	const size = attachmentSizeText(attachment.bytes);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const previewable = previewsInApp(attachment);
	const label = previewable
		? t("ui.projects.project_updates.preview_name", { name: String(name) })
		: t("ui.projects.project_updates.open_name", { name: String(name) });
	return (
		<div className="group relative inline-block" data-project-asset-tile="file">
			<button
				ref={buttonRef}
				type="button"
				className="group/tile block cursor-pointer rounded-sm"
				aria-label={label}
				title={name}
				onClick={() => {
					if (previewable) {
						onPreview(buttonRef.current);
						return;
					}
					// PDFs, spreadsheets and binary documents have no reader on this
					// surface (and no canvas pane to fall back to), so the OS app is
					// the honest door — the same act the menu's "Open file" performs.
					void window.api?.openFile(attachment.path);
				}}
			>
				<AttachmentFrame
					boundary="control"
					className={cn(MEDIA_BOX, "flex-col gap-0.5 px-2 py-1 text-center")}
				>
					<FileGlyph path={attachment.path} />
					<span className="w-full truncate text-meta text-ink">{name}</span>
					{size && (
						<span className="text-meta text-ink-muted tabular-nums">
							{size}
						</span>
					)}
				</AttachmentFrame>
			</button>
			<div className={ASSET_ACTIONS_REVEAL}>
				<FileActionsMenu
					filePath={attachment.path}
					aria-label={t("ui.projects.project_updates.file_actions_for_name", {
						name: String(name),
					})}
					onPreview={
						previewable ? () => onPreview(buttonRef.current) : undefined
					}
				/>
			</div>
		</div>
	);
};

type MediaAsset = {
	attachment: DesktopProjectAttachment;
	kind: "image" | "video";
};

/**
 * One filmstrip tile. Image tiles are the shipped `ImageAttachment` in its
 * select mode (press steps the gallery, opens nothing); a video tile is the
 * same 117x78 frame with the clip's metadata thumbnail, because
 * `ImageAttachment` is a picture component and painting a video through it
 * would be the second viewer this module exists to avoid.
 *
 * Bytes resolve per tile on admission: the strip starts with reserved slots
 * and each tile reads its own file, exactly like the feed. The dialog already
 * holds the selected asset's bytes, but a second `useFileBlobUrl` holder for
 * the same path resolves from the shared blob cache rather than the bridge.
 */
const FilmstripTile: FC<{
	asset: MediaAsset;
	current: boolean;
	index: number;
	count: number;
	onSelect: () => void;
	scrollIntoView: boolean;
}> = ({ asset, current, index, count, onSelect, scrollIntoView }) => {
	useI18nLocale();
	const [anchorRef, near] = useEverInView();
	const slotRef = useRef<HTMLLIElement>(null);
	const name = attachmentName(asset.attachment);

	useEffect(() => {
		if (!current || !scrollIntoView) return;
		slotRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [current, scrollIntoView]);

	return (
		<li
			ref={slotRef}
			className={cn(
				"flex shrink-0 rounded-sm leading-none",
				current && "ring-1 ring-ink",
			)}
		>
			<div ref={anchorRef} className="group relative">
				{near ? (
					<FilmstripTileBody
						asset={asset}
						onSelect={onSelect}
						current={current}
						index={index}
						count={count}
					/>
				) : (
					<button
						type="button"
						aria-label={t("ui.projects.project_updates.show_asset_name", {
							name: String(name),
							index: String(index + 1),
							count: String(count),
						})}
						className="group/tile inline-block cursor-pointer rounded-sm leading-none"
						onClick={onSelect}
					>
						<AttachmentFrame
							boundary="control"
							className={MEDIA_BOX}
							data-attachment-reserved=""
						/>
					</button>
				)}
			</div>
		</li>
	);
};

const FilmstripTileBody: FC<{
	asset: MediaAsset;
	current: boolean;
	index: number;
	count: number;
	onSelect: () => void;
}> = ({ asset, current, index, count, onSelect }) => {
	useI18nLocale();
	const name = attachmentName(asset.attachment);
	const state = useFileBlobUrl(
		asset.attachment.path,
		blobOptions(asset.attachment),
	);
	const label = t("ui.projects.project_updates.show_asset_name", {
		name: String(name),
		index: String(index + 1),
		count: String(count),
	});
	if (asset.kind === "image" && state.status === "ready") {
		return (
			<ImageAttachment
				file={asset.attachment.path}
				src={state.url}
				label={name}
				conversationId=""
				size="thumbnail"
				press={{
					onPress: onSelect,
					label,
					title: label,
					current,
				}}
			/>
		);
	}
	if (state.status !== "ready") {
		return state.status === "loading" ? (
			<button
				type="button"
				aria-label={label}
				className="group/tile inline-block cursor-pointer rounded-sm leading-none"
				onClick={onSelect}
			>
				<AttachmentFrame boundary="control" className={MEDIA_BOX} />
			</button>
		) : (
			<BrokenAttachment name={name} compact={true} />
		);
	}
	return (
		<button
			type="button"
			className="group/tile block cursor-pointer rounded-sm"
			aria-label={label}
			title={label}
			aria-current={current ? "true" : undefined}
			onClick={onSelect}
		>
			<AttachmentFrame boundary="control" className={cn(MEDIA_BOX, "relative")}>
				<video
					src={state.url}
					preload="metadata"
					muted={true}
					playsInline={true}
					className={cn(
						"h-[76px] w-[115px] object-contain",
						// The chat thumbnail's own hover step: the picture enlarges
						// inside the fixed frame, so the slot never moves.
						"motion-safe:transition-transform motion-safe:duration-fast motion-safe:ease-out-quart",
						"motion-safe:group-hover/tile:scale-[1.04]",
					)}
				/>
				<span className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<Play
						className="size-4 text-ink"
						fill="currentColor"
						aria-hidden="true"
					/>
				</span>
			</AttachmentFrame>
		</button>
	);
};

const ProjectMediaFilmstrip: FC<{
	media: readonly MediaAsset[];
	index: number;
	onSelect: (index: number) => void;
}> = ({ media, index, onSelect }) => {
	useI18nLocale();
	return (
		<ul
			/* biome-ignore lint/a11y/noRedundantRoles: WebKit drops the implicit list role when `list-style: none` is set, so the explicit one is what carries the count. */
			/* biome-ignore lint/a11y/useSemanticElements: the element already IS the `ul` the rule suggests; the explicit role is the WebKit fix above. */
			role="list"
			aria-label={t("ui.projects.project_updates.attachments")}
			data-project-asset-filmstrip=""
			className="flex max-w-full items-center gap-2 overflow-x-auto px-2 py-1 leading-none"
		>
			{media.map((asset, tileIndex) => (
				<FilmstripTile
					key={assetKey(asset.attachment)}
					asset={asset}
					current={tileIndex === index}
					index={tileIndex}
					count={media.length}
					onSelect={() => onSelect(tileIndex)}
					scrollIntoView={index === tileIndex}
				/>
			))}
		</ul>
	);
};

/**
 * The update's one gallery. Path-backed bytes resolve through
 * `useFileBlobUrl`; the shared lightbox draws the frame and the carousel.
 * Wrapping is `wrapGroupIndex`, the shared rule the chat carousel uses, so
 * pressing left on the first slide lands on the last in both surfaces.
 */
const ProjectMediaLightbox: FC<{
	media: readonly MediaAsset[];
	index: number;
	onIndexChange: (index: number) => void;
	onClose: () => void;
	/** The pressed tile, so every exit returns focus where the reader was. */
	restoreFocusTo: RefObject<HTMLElement | null>;
}> = ({ media, index, onIndexChange, onClose, restoreFocusTo }) => {
	useI18nLocale();
	const asset = media[index];
	const name = attachmentName(asset.attachment);
	const state = useFileBlobUrl(
		asset.attachment.path,
		blobOptions(asset.attachment),
	);
	const filmstrip =
		media.length > 1 ? (
			<ProjectMediaFilmstrip
				media={media}
				index={index}
				onSelect={onIndexChange}
			/>
		) : undefined;

	return (
		<ImageLightbox
			open={true}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
			src={state.status === "ready" ? state.url : undefined}
			pending={state.status === "loading"}
			label={name}
			mediaKind={asset.kind}
			mediaLabel="asset"
			restoreFocusTo={restoreFocusTo}
			fallback={<BrokenAttachment name={name} />}
			group={{
				index,
				count: media.length,
				onPrev: () => onIndexChange(wrapGroupIndex(index, media.length, -1)),
				onNext: () => onIndexChange(wrapGroupIndex(index, media.length, 1)),
				filmstrip,
			}}
		/>
	);
};

export type ProjectUpdateAssetsProps = {
	attachments: DesktopProjectAttachment[];
};

/**
 * The feed's attachment grid for one update. Text stays ABOVE this component
 * (`project-updates.tsx` owns the entry), so the grid never reorders a
 * paragraph under its evidence.
 */
export const ProjectUpdateAssets: FC<ProjectUpdateAssetsProps> = ({
	attachments,
}) => {
	useI18nLocale();
	const assets = useMemo(
		() =>
			attachments.map((attachment) => ({
				attachment,
				kind: projectAssetKind(attachment),
			})),
		[attachments],
	);
	const media = useMemo<MediaAsset[]>(
		() =>
			assets.filter(
				(asset): asset is MediaAsset =>
					asset.kind === "image" || asset.kind === "video",
			),
		[assets],
	);
	const [openKey, setOpenKey] = useState<string | null>(null);
	const [previewing, setPreviewing] = useState<DesktopProjectAttachment | null>(
		null,
	);
	/*
	 * The control that opened each layer, captured at press time. Radix's modal
	 * path restores focus to a DialogTrigger this composition does not have, so
	 * without these a close lands on `<body>` and the reader's next Tab starts
	 * from the top of the app (UX, measured in the live app).
	 */
	const galleryFocusRef = useRef<HTMLElement | null>(null);
	const previewFocusRef = useRef<HTMLElement | null>(null);
	const openedIndex = openKey
		? media.findIndex((asset) => assetKey(asset.attachment) === openKey)
		: -1;

	/**
	 * One entry can carry several distinct files with the same path (a rerun
	 * that re-attaches its output), so the key includes the stamp. The lamp is
	 * the FIRST match, which is the one the reader pressed.
	 */
	const selectAsset = (attachment: DesktopProjectAttachment) => {
		const active = document.activeElement;
		galleryFocusRef.current = active instanceof HTMLElement ? active : null;
		setOpenKey(assetKey(attachment));
	};
	const openPreview = (
		attachment: DesktopProjectAttachment,
		trigger: HTMLElement | null = null,
	) => {
		const active = document.activeElement;
		previewFocusRef.current =
			trigger ?? (active instanceof HTMLElement ? active : null);
		setPreviewing(attachment);
	};

	return (
		<>
			<div
				/*
				 * FOUR TO A ROW on a wide surface: the 117px column is chat's tile
				 * width, and 4 x 117 + 3 x 8 = 492. `auto-fill` still wraps to fewer
				 * columns when the feed is narrower; the cap is what stops a wide
				 * detail page from stretching one update's evidence across six
				 * columns, which the operator asked not to do.
				 */
				className="grid max-w-[492px] grid-cols-[repeat(auto-fill,117px)] items-start gap-2"
				data-project-asset-grid=""
			>
				{assets.map(({ attachment, kind }) => {
					if (kind === "image") {
						return (
							<ProjectImageTile
								key={assetKey(attachment)}
								attachment={attachment}
								onOpen={() => selectAsset(attachment)}
							/>
						);
					}
					if (kind === "video") {
						return (
							<ProjectVideoTile
								key={assetKey(attachment)}
								attachment={attachment}
								onOpen={() => selectAsset(attachment)}
							/>
						);
					}
					if (kind === "audio") {
						return (
							<ProjectSoundTile
								key={assetKey(attachment)}
								attachment={attachment}
							/>
						);
					}
					return (
						<ProjectFileTile
							key={assetKey(attachment)}
							attachment={attachment}
							onPreview={(trigger) => openPreview(attachment, trigger)}
						/>
					);
				})}
			</div>
			{openedIndex >= 0 && (
				<ProjectMediaLightbox
					media={media}
					index={openedIndex}
					onIndexChange={(next) => {
						const nextAsset = media[next];
						if (nextAsset) setOpenKey(assetKey(nextAsset.attachment));
					}}
					onClose={() => setOpenKey(null)}
					restoreFocusTo={galleryFocusRef}
				/>
			)}
			<ProjectFilePreviewDialog
				open={previewing !== null}
				attachment={previewing}
				onClose={() => setPreviewing(null)}
				restoreFocusTo={previewFocusRef}
			/>
		</>
	);
};

ProjectUpdateAssets.displayName = "ProjectUpdateAssets";
