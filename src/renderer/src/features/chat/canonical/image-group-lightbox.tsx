/**
 * The group carousel: one picture expanded over the app, and the rest of its
 * group a left/right walk away.
 *
 * The operator's ask: "when clicking one image, provide LEFT/RIGHT navigation
 * WITHIN the image's group, plus a COLLAGE (thumbnail strip/filmstrip) of the
 * OTHER images in that group". The groups named are the ones the transcript
 * already draws — a condensed action group's run of images, a message's
 * attachments — and the boundary is the set the pressed picture belongs to, not
 * the conversation: a carousel that walked every image in a session would be
 * navigation the reader never asked for and cannot predict.
 *
 * ## Who owns what
 *
 * This component owns the POSITION (`selected`) and nothing else: the viewer
 * itself is the shared `ImageLightbox`, the visuals of a strip tile are
 * `CanonicalImage` (so a group whose bytes are only partly loaded shows the
 * reserved boxes and receipts the transcript's own strip shows, rather than a
 * second loading idiom), and the bytes are resolved by `useAttachmentUrl` —
 * the one resolver, reused for the selected picture and for every tile.
 *
 * ## The strip IS the prefetch, and that is deliberate
 *
 * The network model here is mount-driven: a tile that mounts resolves its own
 * bytes, and nothing resolves bytes no tile asks for. The strip mounts when the
 * layer opens (Radix unmounts dialog content while closed), so every picture the
 * strip shows begins resolving at open, in the same digest-keyed cache the
 * selected picture uses — a press onto a neighbour is served from a fetch that
 * started when the layer did, and a group larger than the strip's own viewport
 * stays lazy: nothing off the strip is fetched until the reader scrolls to it.
 * That is why there is no separate `prefetch` call: a prefetch loop would be a
 * second resolver wearing a third name.
 *
 * ## The cycle, stated so a future author does not "fix" it
 *
 * The strip's tiles ARE `CanonicalImage`s, so this module imports
 * `canonical-image.tsx`; that file renders THIS component as the overlay its
 * `group` prop opens. The two modules therefore reference each other — a cycle
 * that is safe because neither reads the other while modules evaluate: both
 * bindings are only touched inside component bodies, i.e. at render time, by
 * which point both modules have finished. Bundlers in this repo (esbuild, Vite,
 * rollup) all resolve it. The alternative — threading an overlay factory through
 * every surface — would put the wiring in three call sites instead of one and
 * give each of them the chance to forget it.
 */

import { ImageLightbox } from "@shared/components/common/image-lightbox";
import {
	clampGroupIndex,
	wrapGroupIndex,
} from "@shared/lib/image-viewer-model";
import { type FC, type RefObject, useState } from "react";
import {
	ATTACHMENT_UNAVAILABLE_COPY,
	BrokenAttachment,
} from "../components/message-item/attachment-frame";
import { CanonicalImage } from "./canonical-image";
import type { TranscriptImage } from "./transcript-reducer";
import { type AttachmentScope, useAttachmentUrl } from "./use-attachment-url";

/**
 * The group a picture was pressed in, as every surface hands it down.
 *
 * The descriptor is DATA — the set, the position, and the label rule — rather
 * than a factory, so the surfaces that own the arrays (`fold-media.tsx`, the
 * transcript rows) do not each have to know how a carousel is wired: they say
 * which set the tile belongs to, and `CanonicalImage` opens it.
 */
export type ImageGroupContext = {
	/** The group's pictures, in the order the surface drew them. */
	images: readonly TranscriptImage[];
	/** Where the pressed picture sits in that order. */
	index: number;
	/**
	 * What the overlay calls a picture, positionally — the SAME rule the calling
	 * surface labels its own tiles with, so "Image 2" in the strip and "Image 2"
	 * over the scrim are one sentence rather than two.
	 *
	 * Omitted for the majority of callers, whose rule is the default below; a
	 * surface with a different noun (the user row's "Attached image") passes its
	 * own.
	 */
	labelFor?: (image: TranscriptImage, index: number, count: number) => string;
};

/**
 * The default positional label, which the transcript's tool rows and condensed
 * strips already use: the wire's own `name` when an artifact carried one, the
 * per-COUNT scheme otherwise — a lone picture is "Image", never "Image 1".
 */
const defaultLabelFor = (
	image: TranscriptImage,
	index: number,
	count: number,
): string => image.name ?? (count === 1 ? "Image" : `Image ${index + 1}`);

/**
 * A picture the group does not have, for the index arithmetic to land on if a
 * surface ever hands over an empty group. It resolves to `missing` on the first
 * render (no `data`, no `attachment`), so the viewer draws the receipt instead
 * of crashing — groups in this app are built from pictures in hand, and this
 * exists only so a mistake paints rather than throws.
 */
const PLACEHOLDER_IMAGE: TranscriptImage = {
	id: "image-group:empty",
	data: null,
	attachment: null,
	mimeType: "image/png",
};

export type ImageGroupLightboxProps = {
	images: readonly TranscriptImage[];
	/**
	 * Where the press landed. The carousel OPENS on this picture, and it opens
	 * here again on every later open: a previous visit's position is not sticky,
	 * because the reader who presses tile 3 means tile 3 every time.
	 */
	index: number;
	scope: AttachmentScope | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	restoreFocusTo?: RefObject<HTMLElement | null>;
	labelFor?: (image: TranscriptImage, index: number, count: number) => string;
};

export const ImageGroupLightbox: FC<ImageGroupLightboxProps> = ({
	images,
	index,
	scope,
	open,
	onOpenChange,
	restoreFocusTo,
	labelFor = defaultLabelFor,
}) => {
	const count = images.length;
	const [selected, setSelected] = useState(() => clampGroupIndex(index, count));
	/*
	 * Re-seat on every OPEN, in the render phase rather than an effect: an effect
	 * would paint one frame of the previous visit's position before correcting
	 * itself (the pop this surface's comments keep coming back to), and the
	 * render-phase adjustment is React's own answer for "state derived from a
	 * prop that just changed".
	 */
	const [wasOpen, setWasOpen] = useState(open);
	if (wasOpen !== open) {
		setWasOpen(open);
		if (open) setSelected(clampGroupIndex(index, count));
	}
	/*
	 * The read-side clamp: a windowed transcript can unmount the rows behind a
	 * group while its carousel is open, so the stored position may name a
	 * picture that no longer exists. The STATE keeps the reader's raw position
	 * (so a group that grows back lands where they left it); every read goes
	 * through the clamp.
	 */
	const safeIndex = clampGroupIndex(selected, count);
	const image = images[safeIndex] ?? PLACEHOLDER_IMAGE;
	const label = labelFor(image, safeIndex, count);
	const source = useAttachmentUrl(image, scope);

	const onPrev = () => setSelected(wrapGroupIndex(safeIndex, count, -1));
	const onNext = () => setSelected(wrapGroupIndex(safeIndex, count, 1));

	/*
	 * The strip's tiles are the transcript's own tiles: the same slot, the same
	 * reserved and missing states, the same hover-and-focus edge — with the
	 * press repointed from "expand" to "show", because in here a tile does not
	 * open anything, it steps the carousel the reader is already in. The
	 * `aria-current` mark is the tile that IS the picture on screen, which is
	 * the same fact the strip's visual state carries (see the lightbox's strip
	 * note on how the current tile is marked).
	 */
	const filmstrip =
		count > 1 ? (
			/*
			 * A list, for the transcript strip's own reason (that comment carries
			 * the WebKit rule the explicit role is for): the reader hears a set
			 * with a count and a name, not loose buttons.
			 */
			<ul
				/*
				 * `role="list"` on a `ul` is redundant in HTML and load-bearing in WebKit,
				 * which drops list semantics where the markers are suppressed - and
				 * Tailwind's preflight sets `list-style: none` on every `ul` in this app.
				 * Both suppressions are that one fact, the exact pair `fold-media.tsx`
				 * carries for its own strip (that comment names the reviewer finding).
				 */
				/* biome-ignore lint/a11y/noRedundantRoles: WebKit drops the implicit list role when `list-style: none` is set, so the explicit one is what carries the count to VoiceOver. */
				/* biome-ignore lint/a11y/useSemanticElements: the element already IS the one the rule suggests - the explicit role is the WebKit fix above, not a substitute for `ul`. */
				role="list"
				aria-label={`${count} images`}
				data-image-filmstrip=""
				className="flex max-w-full items-center gap-2 overflow-x-auto p-1 leading-none"
			>
				{images.map((entry, tileIndex) => (
					<li key={entry.id} className="flex shrink-0 leading-none">
						<CanonicalImage
							image={entry}
							scope={scope}
							size="thumbnail"
							label={labelFor(entry, tileIndex, count)}
							press={{
								onPress: () => setSelected(tileIndex),
								/*
								 * Action and position in one name, the way the
								 * transcript's tiles say "Expand Image 2": the
								 * accessibility round that gave those tiles their
								 * action-name asked for the press's meaning to reach a
								 * reader, and "of 3" is what tells this one from its
								 * neighbours.
								 */
								label: `Show image ${tileIndex + 1} of ${count}`,
								title: `Show image ${tileIndex + 1} of ${count}`,
								current: tileIndex === safeIndex,
							}}
						/>
					</li>
				))}
			</ul>
		) : undefined;

	return (
		<ImageLightbox
			/*
			 * `undefined` while the bytes resolve, rather than a stale URL: the
			 * lightbox's `pending` state draws the reserved box for exactly this
			 * window, and swapping to the URL when it lands is one render, not a
			 * reload — both nodes sit in the same box.
			 */
			src={source.state === "ready" ? source.url : undefined}
			pending={source.state === "resolving"}
			label={label}
			open={open}
			onOpenChange={onOpenChange}
			restoreFocusTo={restoreFocusTo}
			/*
			 * The transcript's own failure treatment, following the SOURCE the way
			 * `canonical-image.tsx` states it: a canonical image is a digest in the
			 * app's own store, not a path on disk, so the sentence is the store's —
			 * "its stored copy is not available to this reader" — not the
			 * moved/renamed/deleted cause a path could honestly carry.
			 */
			fallback={
				<BrokenAttachment name={label} detail={ATTACHMENT_UNAVAILABLE_COPY} />
			}
			group={{ index: safeIndex, count, onPrev, onNext, filmstrip }}
		/>
	);
};
