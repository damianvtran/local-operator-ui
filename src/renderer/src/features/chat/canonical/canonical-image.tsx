/**
 * One image on a canonical transcript row.
 *
 * A thin wrapper, deliberately: `ImageAttachment` already draws every state an
 * attachment can be in — reserved box, `opacity-0` until decode, no spinner,
 * `BrokenAttachment` with a named failure — and a second image component beside
 * an established one is the defect docs/branding.md § 9 opens with. All this
 * adds is where the `src` comes from, which is the only thing that differs
 * between a legacy message (a file path on disk) and a canonical one (base64 on
 * the wire, or a digest in the attachment store).
 *
 * The unavailable state is `BrokenAttachment` rather than an empty gap, and
 * that is the same argument the TUI makes for its own `▨ image unavailable`
 * receipt (`tui/widgets/image_block.py:24-29`): "the reader learns an image WAS
 * here, which is the fact the empty space would have hidden." It carries
 * `ATTACHMENT_UNAVAILABLE_COPY` rather than that component's default sentence:
 * a canonical image is a digest in the app's own store, not a path on disk, so
 * the moved/renamed/deleted cause is one this row cannot know — see the copy's
 * own comment in `attachment-frame.tsx`.
 *
 * Sizing follows the TUI's ledger rule — one shared height ceiling with the
 * width following each image's own aspect — so a column of mixed screenshots
 * reads as rows rather than as a scrapbook. The ceiling is `ImageAttachment`'s
 * existing `max-h-[240px] object-contain`, taken as-is rather than re-derived
 * from the TUI's 18 rows x 16px = 288px: consistency with the legacy view beside
 * it is worth more than matching a number from a surface with different cells.
 */

import { cn } from "@shared/lib/utils";
import {
	ATTACHMENT_UNAVAILABLE_COPY,
	AttachmentFrame,
	BrokenAttachment,
} from "../components/message-item/attachment-frame";
import { ImageAttachment } from "../components/message-item/image-attachment";
import type {
	ImageAttachmentProps,
	ImageSize,
} from "../components/message-item/image-attachment";
import {
	type ImageGroupContext,
	ImageGroupLightbox,
} from "./image-group-lightbox";
import type { TranscriptImage } from "./transcript-reducer";
import { type AttachmentScope, useAttachmentUrl } from "./use-attachment-url";

export type CanonicalImageProps = {
	image: TranscriptImage;
	/**
	 * The conversation the row was read from, as `{ sessionId, childId }`.
	 *
	 * The scope rather than a bare session id because the bytes live behind a
	 * route scoped to the transcript that references them, and a child's page is
	 * a conversation of its own — the parent's route refuses a child's digests
	 * (`use-attachment-url.ts`'s `AttachmentScope`).
	 */
	scope: AttachmentScope | null;
	/**
	 * What to call this attachment when it cannot be shown. The row above
	 * already names the action, so this is a position rather than a filename —
	 * a canonical image has no filename to give.
	 */
	label: string;
	/**
	 * The size the picture is drawn at.
	 *
	 * Defaults to `ImageAttachment`'s own `full` ceiling, so every existing
	 * caller renders exactly what it rendered before. A caller showing a
	 * transcript image as an INDEX into the picture rather than as the picture
	 * itself — the condensed action group — asks for `thumbnail` and keeps the
	 * click that expands it.
	 */
	size?: ImageSize;
	/**
	 * The set this picture belongs to, for the viewer's left/right walk.
	 *
	 * Present, the press opens the GROUP carousel: this picture fitted, its
	 * siblings a strip below and the arrows a step away (`ImageGroupLightbox`
	 * owns the position; the SET is this descriptor). Omitted, the press opens
	 * the single-image overlay it always has — which is what a tile with no set
	 * to walk (a legacy attachment, a markdown image) wants.
	 *
	 * The descriptor rather than a rendered overlay, so a surface says WHICH set
	 * the tile is in and never has to build a carousel: `fold-media.tsx` and the
	 * transcript rows pair it with `index`, and the wiring lives here.
	 */
	group?: ImageGroupContext;
	/**
	 * Repoints the press away from the overlay, for the filmstrip's SELECT tiles
	 * (see `ImageAttachment`'s `press`): a select renders no overlay and steps
	 * the open one instead.
	 */
	press?: NonNullable<ImageAttachmentProps["press"]>;
	/** Path actions over a retained copy (`ImageAttachment`'s `pathActions`). */
	pathActions?: ImageAttachmentProps["pathActions"];
};

export const CanonicalImage = ({
	image,
	scope,
	label,
	size,
	group,
	press,
	pathActions,
}: CanonicalImageProps) => {
	const source = useAttachmentUrl(image, scope);
	if (source.state === "resolving") {
		const reserved = (
			/*
			 * A RESERVED BOX, not a receipt, while the bytes are on their way.
			 *
			 * The alternative - painting the unavailable sentence and letting it
			 * swap to the picture - is what this state exists to end: in the condensed
			 * group's strip the cold path is the normal path (a collapsed fold unmounts
			 * the rows that would have warmed the cache), so every durable screenshot
			 * opened its life as a sentence-shaped block that reflowed into a 78px tile
			 * a frame later (agent review round 1, P3).
			 *
			 * The tile reserves its EXACT box, because the tile's box is fixed by
			 * construction (115x76 inside a 1px border: 117x78) and that is what makes the first paint free. The
			 * `full` size reserves only the frame's own floor - its ceiling depends on
			 * an aspect the transcript row does not carry, so a full picture still
			 * settles to its own height, exactly as every other durable picture has.
			 *
			 * Non-select placeholders are `aria-hidden`: announcing an empty box
			 * and then the arriving picture repeats the same name. A filmstrip
			 * select is different: its action/position remains meaningful before
			 * bytes arrive, so the branch below keeps a real named select button.
			 */
			<AttachmentFrame
				boundary={size === "thumbnail" ? "control" : "hairline"}
				/* The tile's own measured box, for the same reason the receipt spells
					   it in pixels: a reserved slot has to be the size of the picture that
					   is coming, or the strip reflows when it lands. */
				className={size === "thumbnail" ? "h-[78px] w-[117px]" : undefined}
				/*
				 * Named for the rigs the way `data-fold-media` is: the reserved box has no
				 * picture and no text, so `scripts/chat-image-expand.test.mjs` can only
				 * tell it from the receipt by a marker. It states which state it is rather
				 * than which element, so the test fails when the STATE changes, not when
				 * the markup does.
				 */
				data-attachment-reserved=""
			/>
		);
		// A filmstrip SELECT is still an action while bytes are pending: the
		// reader may choose this slot before its request settles. Non-select
		// transcript placeholders keep their existing aria-hidden treatment.
		return press ? (
			<button
				type="button"
				aria-label={press.label}
				title={press.title}
				aria-current={press.current || undefined}
				className="group/tile inline-block max-w-full cursor-zoom-in rounded-sm leading-none"
				onClick={press.onPress}
			>
				{reserved}
			</button>
		) : (
			<div className={cn("inline-block max-w-full")} aria-hidden={true}>
				{reserved}
			</div>
		);
	}
	if (source.state === "missing") {
		return (
			<BrokenAttachment
				name={label}
				compact={size === "thumbnail"}
				detail={ATTACHMENT_UNAVAILABLE_COPY}
			/>
		);
	}
	const src = source.url;
	return (
		<div className={cn("inline-block max-w-full")}>
			<ImageAttachment
				// `file` is what the component names the attachment and what its
				// actions menu classifies. Neither shape a canonical image can take is
				// a path — `data:` and `blob:` — so the menu offers the kinds' own
				// actions (`Copy image`, and the canvas branch a `data:` URI can
				// honour) and never the path-shaped ones there is nothing on disk to
				// serve. The old guard here refused the menu for both kinds outright;
				// the `blob:` half of it exists because THIS caller needed it — every
				// durable image is a blob, and the guard originally covered only
				// `data:`, so the menu did appear and offered to show a blob handle
				// in Finder.
				file={src}
				src={src}
				// A canonical image has no on-disk path, so there is nothing here for a
				// click to open — which is why the click once did NOTHING at all on this
				// surface, the operator's own report. It expands now, and that behaviour
				// lives inside `ImageAttachment` rather than being passed in, so this
				// caller (and every future one) gets it without asking.
				//
				// `label` is also what the picture is CALLED. Left to derive itself
				// from the URL it would be the blob's UUID, which is what a screen
				// reader announced. It is also the expanded overlay's own name.
				label={label}
				size={size}
				conversationId={scope?.sessionId ?? ""}
				/*
				 * The cell the filmstrip's select tiles need: the press runs the
				 * caller's handler and THIS component renders no overlay then (see
				 * `ImageAttachment`). Passing it through here rather than mounting
				 * `ImageAttachment` directly in the strip keeps one tile component.
				 */
				press={press}
				pathActions={pathActions}
				/*
				 * The group door. The overlay is built HERE, not passed rendered,
				 * because the layer's open state and the tile's focus-restore control
				 * belong to `ImageAttachment` and reach a caller only through this
				 * factory: the carousel reuses both without owning either, and the
				 * single-image default below stays the path of a tile with no set.
				 */
				overlay={
					group
						? (controls) => (
								<ImageGroupLightbox
									images={group.images}
									index={group.index}
									labelFor={group.labelFor}
									scope={scope}
									open={controls.open}
									onOpenChange={controls.onOpenChange}
									restoreFocusTo={controls.restoreFocusTo}
								/>
							)
						: undefined
				}
			/>
		</div>
	);
};
