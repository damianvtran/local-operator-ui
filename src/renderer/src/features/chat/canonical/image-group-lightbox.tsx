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
 * ## Demand is a strip-viewport boundary, not a transcript-page boundary
 *
 * Every known image keeps its stable slot, but only visible slots, the selected
 * picture and its wrapped neighbours mount CanonicalImage/useAttachmentUrl.
 * Inline bytes are already known and render immediately. One observer rooted
 * in this strip admits cold offscreen tiles when scrolling reveals them.
 * Admission latches until close so scrolling back never drops a resolver's
 * blob holder and starts a second request. No second resolver or pager exists.
 *
 * The original implementation mounted every known tile at open. R1-3 corrected
 * its false lazy-loading comment, not the missing demand behavior; the manager
 * caught that gap before merge. This completes the original on-demand ask.
 * Unknown transcript pages remain the transcript loader's responsibility.
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
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	clampGroupIndex,
	wrapGroupIndex,
} from "@shared/lib/image-viewer-model";
import { cn } from "@shared/lib/utils";
import {
	type FC,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { t } from "../../../../../i18n/messages";
import {
	AttachmentFrame,
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
): string =>
	image.name ??
	(count === 1
		? t("ui.chat.canonical.image_group_lightbox.image")
		: t("ui.chat.canonical.image_group_lightbox.image_value", {
				value: index + 1,
			}));

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

/** A cold tile's outer box keeps the settled CanonicalImage layout height.
 * Live browser measurement: reserved frame 117x78, settled wrapper 117x79
 * (the inline baseline). Reserving 79px only for durable tiles avoids the 1px
 * pending-to-ready row change without repainting existing inline/receipt tiles.
 * The inner AttachmentFrame remains the existing 117x78 treatment. */
const StableColdSlot = ({
	cold,
	children,
}: { cold: boolean; children: ReactNode }) => {
	useI18nLocale();
	return cold ? (
		<div className="flex h-[79px] w-[117px] items-start leading-none">
			{children}
		</div>
	) : (
		children
	);
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
	useI18nLocale();
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

	/*
	 * The strip, the layer and the walk, in one place: the refs are the two
	 * elements a walk may have to move FOCUS between (design round 1, D1-3).
	 */
	const stripRef = useRef<HTMLUListElement | null>(null);
	const layerRef = useRef<HTMLDivElement>(null);
	/*
	 * The strip's layer mounts a COMMIT AFTER `open` flips (Radix's presence
	 * keeps its content out of the first open commit — measured: the scroll
	 * effect ran with open=true and the strip not yet in the document), so an
	 * effect keyed on `open` cannot see the strip on the open that matters.
	 * The attach callback fires when the `ul` actually mounts, and the state
	 * bump is what re-runs the scroll effect then.
	 */
	const [stripMounted, setStripMounted] = useState(false);
	const attachStrip = useCallback((node: HTMLUListElement | null) => {
		stripRef.current = node;
		setStripMounted(node !== null);
	}, []);
	/*
	 * WHERE FOCUS GOES WHEN THE WALK MOVES THE PICTURE. A strip tile that held
	 * focus must not keep reading as the current one: the walk follows the picture
	 * to the new tile's own control where one exists — the slot's stable index,
	 * not its localized label, names the target before the re-render — and where it
	 * does not (a picture with no bytes draws a receipt, which has no control to take
	 * focus) focus leaves the tiles for the layer instead, so no stale tile wears
	 * a ring the walk did not put there. The check is `fromStrip` rather than
	 * "always": a reader pointing at the frame keeps their focus on the frame.
	 */
	const focusFor = (index: number) => {
		const tile = stripRef.current?.querySelector<HTMLButtonElement>(
			`[data-image-slot="${index + 1}"] button`,
		);
		if (tile) tile.focus();
		else layerRef.current?.focus();
	};
	const walk = (step: number) => {
		const next = wrapGroupIndex(safeIndex, count, step);
		const fromStrip =
			stripRef.current?.contains(document.activeElement) ?? false;
		setSelected(next);
		if (fromStrip) focusFor(next);
	};
	const onPrev = () => walk(-1);
	const onNext = () => walk(1);

	/* A data identity, not the array reference: callers may rebuild arrays each
	 * render. Include scope and digests so eligibility cannot leak into a new
	 * group that reused positions or ids. Closing starts a fresh admission set. */
	const demandIdentity = JSON.stringify([
		scope?.sessionId,
		scope?.childId,
		images.map((entry) => [entry.id, entry.attachment, entry.mimeType]),
	]);
	const [admission, setAdmission] = useState(() => ({
		identity: demandIdentity,
		open,
		indices: new Set<number>(),
	}));
	if (admission.identity !== demandIdentity || admission.open !== open) {
		setAdmission({
			identity: demandIdentity,
			open,
			indices: new Set<number>(),
		});
	}
	const admit = useCallback(
		(indices: readonly number[]) => {
			setAdmission((previous) => {
				// A queued observer callback from the old group must not admit this one.
				if (!open || previous.identity !== demandIdentity || !previous.open)
					return previous;
				if (indices.every((index) => previous.indices.has(index)))
					return previous;
				const next = new Set(previous.indices);
				for (const index of indices) next.add(index);
				return { ...previous, indices: next };
			});
		},
		[demandIdentity, open],
	);
	const previousIndex = wrapGroupIndex(safeIndex, count, -1);
	const nextIndex = wrapGroupIndex(safeIndex, count, 1);
	useEffect(() => {
		if (open) admit([safeIndex, previousIndex, nextIndex]);
	}, [open, safeIndex, previousIndex, nextIndex, admit]);
	useEffect(() => {
		const strip = stripRef.current;
		if (
			!open ||
			!stripMounted ||
			!strip ||
			typeof IntersectionObserver === "undefined"
		)
			return;
		// One observer for all slots. Missing observer support keeps the safe
		// selected/neighbour path; it never silently falls back to eager fetching.
		let live = true;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!live) return;
				admit(
					entries
						.filter((entry) => entry.isIntersecting)
						.map(
							(entry) =>
								Number((entry.target as HTMLElement).dataset.imageSlot) - 1,
						),
				);
			},
			{ root: strip },
		);
		for (const slot of strip.querySelectorAll("[data-image-slot]"))
			observer.observe(slot);
		return () => {
			live = false;
			observer.disconnect();
		};
	}, [open, stripMounted, admit]);
	const eligible = (entry: TranscriptImage, index: number) =>
		Boolean(entry.data) ||
		!entry.attachment ||
		index === safeIndex ||
		index === previousIndex ||
		index === nextIndex ||
		(admission.identity === demandIdentity &&
			admission.open &&
			admission.indices.has(index));
	/*
	 * The current slot is scrolled into view on every move (design round 1,
	 * D1-5): the strip scrolls (`max-w` + `overflow-x-auto`), so a walk can move
	 * the current off its viewport; the slot marker is on the `li` so the receipt
	 * slot — which has no button — scrolls too. `scrollIntoView` is optional-called
	 * because jsdom does not implement it and the suite mounts this strip.
	 */
	/* biome-ignore lint/correctness/useExhaustiveDependencies: `stripMounted` is the mount signal this effect exists to wait for (the strip's layer mounts a commit after `open`), and it is deliberately not read in the body - the ref is. */
	useEffect(() => {
		const slot =
			stripRef.current?.querySelector(`[data-image-slot="${safeIndex + 1}"]`) ??
			stripRef.current;
		slot?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
	}, [stripMounted, safeIndex]);

	/*
	 * The strip's tiles are the transcript's own tiles: the same slot, the same
	 * reserved and missing states, the same hover-and-focus edge — with the
	 * press repointed from "expand" to "show", because in here a tile does not
	 * open anything, it steps the carousel the reader is already in. The
	 * `aria-current` mark is the tile that IS the picture on screen; its VISIBLE
	 * half lives on the SLOT (`ring-ink` on the `li`), so the mark survives
	 * the states where a slot has no control at all - the receipt for a picture
	 * with no bytes (design round 1's D1-1 and UX round 1's U1-1 settled it
	 * there).
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
				ref={attachStrip}
				aria-label={t("ui.chat.canonical.image_group_lightbox.count_images", {
					count,
				})}
				data-image-filmstrip=""
				/*
				 * `px-2` rather than `p-1` (design round 1, D1-6): the focus ring needs
				 * 4px of slack and `overflow-x-auto` clips at the padding box, so at
				 * `p-1` a tile landing flush under a scroll clips its own ring's outer
				 * edge - measured live: the ring's edge and the clip box coincided at
				 * x=452.5. `py-1` keeps the strip's measured height.
				 */
				className="flex max-w-full items-center gap-2 overflow-x-auto px-2 py-1 leading-none"
			>
				{images.map((entry, tileIndex) => (
					<li
						key={entry.id}
						data-image-slot={tileIndex + 1}
						className={cn(
							/*
							 * scrollIntoView reveals the border box, not the ring's 1px
							 * outset. Reserve that pixel at BOTH inline ends so walking
							 * or wrapping onto an endpoint cannot clip the current mark
							 * (Q2-1/U2-1: slot.right == port.right, and symmetrically left).
							 * Scroll margin changes reveal geometry, never tile layout.
							 */
							"flex shrink-0 scroll-mx-px rounded-sm leading-none",
							/*
							 * THE VISIBLE CURRENT MARK, on the SLOT (design round 1's D1-1,
							 * UX round 1's U1-1). Two findings meet here. D1-1: the mark used
							 * to be the tile's `border-control` edge, which measures 1.52-2.36:1
							 * on every light palette's scrim.
							 *
							 * U1-1: a mark living on the tile's own control vanished exactly when
							 * the walk landed on a picture with no bytes, because a receipt has no
							 * button - the slot carries it for every state the slot can be in.
							 *
							 * THE ROLE IS `ink`, and the relay that got here is worth keeping: the
							 * first fix reached for `ink-muted` on its ratio over ONE scrim
							 * composite (over `canvas`), where it clears 59/59 at a 3.02:1 floor
							 * case. But the scrim dims whatever the app has OPEN under it - the
							 * strip's lane can sit over a code block, a hovered row, a find-match -
							 * so the ring's real ground is the scrim over each of the eight state
							 * grounds, and `ink-muted` FAILS 3 of those 59x8 composites
							 * (kanagawaLotus: 2.78:1 over `sunken`, 2.82 over `accentWash`). `ink`
							 * is the one role that clears the floor over EVERY composite (worst:
							 * everforestLight over `sunken`, 3.37:1), and
							 * `scripts/contrast-contract.mjs` now asserts it there ("the lightbox's
							 * own ground").
							 *
							 * A ring is a box-shadow, so nothing here moves layout, and the tile's
							 * own hover/focus edge stays its control language - the CURRENT fact
							 * out-ranks it on the slot instead of tying it.
							 */
							tileIndex === safeIndex && "ring-1 ring-ink",
						)}
					>
						<StableColdSlot cold={Boolean(entry.attachment) && !entry.data}>
							{eligible(entry, tileIndex) ? (
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
										label: t(
											"ui.chat.canonical.image_group_lightbox.show_image_value_of_count",
											{ value: tileIndex + 1, count: count },
										),
										title: t(
											"ui.chat.canonical.image_group_lightbox.show_image_value_of_count",
											{ value: tileIndex + 1, count: count },
										),
										current: tileIndex === safeIndex,
									}}
								/>
							) : (
								<button
									type="button"
									aria-label={t(
										"ui.chat.canonical.image_group_lightbox.show_image_value_of_count",
										{ value: tileIndex + 1, count: count },
									)}
									title={t(
										"ui.chat.canonical.image_group_lightbox.show_image_value_of_count",
										{ value: tileIndex + 1, count: count },
									)}
									className="group/tile inline-block max-w-full cursor-zoom-in rounded-sm leading-none"
									onClick={() => {
										admit([tileIndex]);
										setSelected(tileIndex);
									}}
								>
									<AttachmentFrame
										boundary="control"
										className="h-[78px] w-[117px]"
										data-attachment-reserved=""
										data-attachment-deferred=""
									/>
								</button>
							)}
						</StableColdSlot>
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
				<BrokenAttachment
					name={label}
					detail={t(
						"ui.chat.message.attachment_frame.could_not_be_displayed_its_stored_copy_is_not_available",
					)}
				/>
			}
			layerRef={layerRef}
			group={{ index: safeIndex, count, onPrev, onNext, filmstrip }}
		/>
	);
};
