/**
 * The designed states of an image attachment.
 *
 * An `<img>` on its own has three failure modes the conversation surface kept
 * hitting, and none of them was designed:
 *
 *  1. **Broken.** A missing or unreadable source falls back to the browser's
 *     torn-page glyph plus the alt text, drawn at the OS's own colours. It is
 *     the single loudest piece of chrome the app could accidentally render.
 *  2. **Tiny.** A pasted 8x6 image drew at 8x6 physical pixels — a speck at the
 *     top of a message bubble that reads as damage rather than as content.
 *  3. **Reflow.** With no reserved box, the message jumps by the image's height
 *     the moment it decodes, and in a `column-reverse` list that yanks the
 *     text the reader is on.
 *
 * The frame fixes all three the way Slack, Notion and Things do: a reserved
 * box on the recessed ground, the picture contained inside it, a quiet
 * placeholder while it decodes, and a *legible sentence* if it never arrives.
 * The frame never collapses below `min-h-16`, so an 8px image is a small
 * picture centred in a tile rather than a speck.
 *
 * No spinner while loading. A local file decodes in a frame or two and a
 * spinner would flash; the recessed ground already says "something belongs
 * here".
 */

import { cn } from "@shared/lib/utils";
import { ImageOff } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type AttachmentFrameProps = {
	/**
	 * The picture, or nothing at all for a frame that only RESERVES its box - the
	 * condensed group's tile while its bytes are on their way, which is a state
	 * that has to occupy the same slot as the picture it is waiting for.
	 */
	children?: ReactNode;
	className?: string;
	/**
	 * The frame's edge.
	 *
	 * `hairline` is the decoration an illustration sits behind. `control` is for the
	 * frame that IS a control - the condensed action group's tile - and it is
	 * BORDERLESS AT REST: the operator asked for the ring to go, so the tile is a
	 * well with a 1px border that is `transparent` (reserved, so the edge appearing
	 * does not move a neighbour), and `border-control` returns on hover and on
	 * keyboard focus of the enclosing `group/tile` button - the states in which it
	 * is a control being used. Both are named groups, so the edge answers to the
	 * tile's own button and not to an outer `group` (the picture's file-actions
	 * wrapper is one).
	 *
	 * THE RESTING EXTENT IS THE FILL, AND IT CARRIES A FLOOR. With the ring gone
	 * the tile's extent at rest is its own fill, and the shared `sunken` step could
	 * not carry it: a picture whose own canvas is the page's tone has ~1.0:1
	 * against the page (the `image-tones` fixtures), the well behind it measured
	 * ~1.07:1, and as a ΔE00 step the shared well fell below 4.0 on 55 of the 59
	 * palettes - as low as 2.00 (iceberg, `neonNoir`). The `control` boundary
	 * therefore wears `mediaSurface`, the role authored for exactly this slot:
	 * `sunken` stepped away from `canvas` until the fill clears a ΔE00 4.0 floor
	 * off it (see the role's doc in the palette contract), so a page-toned
	 * picture's tile separates at rest - by the ~1px ring the well shows at a
	 * filling picture's edge and corners, and by the letterbox mats a contained
	 * portrait sits between. `border-control` remains the stronger cue and still
	 * returns where the tile is a control (hover, keyboard focus). THE RETURNING
	 * EDGE'S 3:1 IS THE GROUND'S, NOT THE FILL'S (design round 1, D1):
	 * `border-control` is asserted against the four grounds - >= 3.01 measured
	 * across the fleet, and the outer side is the side the tile's silhouette is
	 * read against - and deliberately NOT against `mediaSurface`, where it
	 * measures below 3:1 on 10 light palettes (2.78 worst, `catppuccinLatte`);
	 * no floor or claim is attached to that inner pair.
	 * `docs/evidence/chat-media-slot-fill/letterbox-hover/` carries the hovered
	 * state as a frame.
	 */
	boundary?: "hairline" | "control";
} & Omit<ComponentPropsWithoutRef<"div">, "children" | "className">;

/**
 * The reserved box every attachment picture sits in. `sunken` is the ground
 * that means "a well", which is exactly what a media slot is - and the
 * `control` boundary's well is `mediaSurface`, the role authored for it: a
 * step away from `canvas`, because there the fill IS the tile's extent (see
 * the boundary doc above). The `hairline` frame keeps the shared `sunken`.
 */
export const AttachmentFrame = ({
	children,
	className,
	boundary = "hairline",
	...rest
}: AttachmentFrameProps) => (
	<div
		className={cn(
			"flex max-w-full items-center justify-center overflow-hidden",
			"min-h-16 min-w-16 rounded-sm",
			boundary === "control"
				? [
						"bg-media-surface",
						"border border-transparent",
						"transition-colors duration-fast ease-out-quart",
						"group-hover/tile:border-control group-focus-visible/tile:border-control",
					]
				: ["border border-hairline", "bg-sunken"],
			className,
		)}
		{...rest}
	>
		{children}
	</div>
);

export type BrokenAttachmentProps = {
	/** Shown so the reader knows *which* attachment failed. */
	name: string;
	/**
	 * Whether the receipt is drawn in a TILE rather than in the flow.
	 *
	 * The condensed action group's strip is one 78px tile tall by construction, so the
	 * prose form of this receipt (`w-fit`, a sentence) cannot live in it: it would
	 * blow the strip's own height budget for the one state that has no picture to
	 * show. Compact keeps the receipt boundable - the same 117x78 slot a working
	 * tile occupies, the same control edge - and keeps it NAMEABLE by carrying the
	 * name and the sentence as one `aria-label`, so a reader is told which
	 * attachment failed rather than being shown an unlabelled icon.
	 */
	compact?: boolean;
	/**
	 * The sentence after the name.
	 *
	 * A parameter because the two callers know different amounts, and a single
	 * sentence cannot be true for both. `BrokenAttachment`'s original caller is
	 * the LEGACY message view, which reads image FILE PATHS off disk: for it, a
	 * failed read really is usually a name that moved, so `ATTACHMENT_MOVED_COPY`
	 * is the honest default. A canonical image is not a path at all — it is a
	 * digest in a content-addressed store — and asserting the moved/renamed/
	 * deleted cause there is asserting something the reader cannot know (the
	 * store is written by the app and pruned by the app; a missing digest means
	 * a pruned or never-written entry, and the route's 404 does not say which).
	 * That is why the canonical caller overrides it.
	 */
	detail?: string;
	className?: string;
};

/**
 * The default sentence: the cause a legacy on-disk path usually has.
 */
export const ATTACHMENT_MOVED_COPY =
	"could not be displayed. It may have been moved, renamed, or deleted.";

/**
 * What a digest-backed row can honestly say when its bytes do not arrive.
 *
 * It states the fact (the read failed) and stops, because the two causes the
 * wire can produce — an entry the store never held and one it pruned — are
 * indistinguishable from a 404, and no third-party "may have" clause makes a
 * cause this code cannot observe honest.
 */
export const ATTACHMENT_UNAVAILABLE_COPY =
	"could not be displayed. Its stored copy is not available to this reader.";

/**
 * What the reader sees instead of a torn-page glyph.
 *
 * Voice rule: what happened, what it means, what to do. The name says which
 * file, the sentence says the app could not read it and why that usually
 * happens. It is the neutral ground rather than a `danger` wash — a file that
 * moved is not an error the user made, and painting it red would put it above
 * the agent's own output in the § 7 hierarchy.
 */
export const BrokenAttachment = ({
	name,
	detail = ATTACHMENT_MOVED_COPY,
	className,
	compact = false,
}: BrokenAttachmentProps) =>
	compact ? (
		<div
			className={cn(
				/*
				 * The TILE's own measured box (117x78), spelled in pixels: a working tile
				 * is that size because its picture sets a 115x76 content box and the frame
				 * adds its own 1px border, so the receipt has to match the TOTAL or the slot
				 * would change size exactly when a picture fails. `h-[76px] w-[115px]` here
				 * would be the 115x76 content box and not the 117x78 total - 2px off in both
				 * directions - and `box-content` measured as a class with no effect in
				 * the render, so the numbers the tile actually has are the honest ones.
				 *
				 * IT KEEPS ITS EDGE while a working tile does not, and it keeps the shared
				 * `sunken` fill while a working tile wears `mediaSurface`: a card in a STATE
				 * keeps its edge because the state is the information, the receipt has no
				 * picture to give it an extent - its only content is a `size-4` glyph - and
				 * the fill role's trade (the fill as the whole boundary) does not apply to
				 * it. Adopting the fill anyway would put the glyph's `ink-dim` under its
				 * 5.0:1 floor on several light palettes (4.63:1 worst, `catppuccinLatte`),
				 * so the receipt stays on the shared well. It is also not a tab stop
				 * (`role="img"`).
				 */
				"flex h-[78px] w-[117px] items-center justify-center rounded-sm border border-control bg-sunken",
				className,
			)}
			/*
			 * The whole receipt as one name: the icon says nothing on its own, and the
			 * alternative (visible prose in a 78px strip) is the state this pass is
			 * about - a tile with no boundary to read. `role="img"` rather than a bare
			 * div because the box IS the picture that failed, and that is what a
			 * reader gets to walk past.
			 */
			role="img"
			aria-label={`${name} ${detail}`}
			/*
			 * The title is the SAME sentence for the pointer reader: at 78px there is no
			 * room for it as prose and the glyph alone reads as "still loading", so the
			 * tooltip is the only way to reach the reason without a screen reader (UX
			 * round 1, U5). The count clause still counts this picture - the run DID
			 * produce it; what failed is this reader's copy, and that is what the
			 * sentence says.
			 */
			title={`${name} ${detail}`}
		>
			<ImageOff className="size-4 shrink-0 text-ink-dim" aria-hidden={true} />
		</div>
	) : (
		<div
			className={cn(
				"flex w-fit max-w-full items-center gap-2.5 rounded-sm border border-hairline bg-sunken px-3 py-2",
				className,
			)}
		>
			<ImageOff className="size-4 shrink-0 text-ink-dim" aria-hidden={true} />
			<span className="min-w-0 text-body-sm text-ink-muted">
				<span className="truncate font-mono text-ink text-mono-sm">{name}</span>
				{` ${detail}`}
			</span>
		</div>
	);
