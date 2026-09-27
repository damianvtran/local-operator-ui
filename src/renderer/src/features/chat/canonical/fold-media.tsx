/**
 * What a condensed action group shows of the images its run produced.
 *
 * ## The problem this is the answer to
 *
 * A collapsed group UNMOUNTS its rows (`Disclosure` renders `isOpen && children`),
 * and a tool row draws its screenshots under itself. So the artifact a command
 * wrote went with the rows: the operator's report is exactly this — a condensed
 * group whose header reads `1 file · 1 shell · 1 edit` and whose picture is
 * reachable only by expanding the group. #537 gave the condensed row its
 * metadata (the counts, the span, the call in flight); this is the same
 * principle applied to OUTPUT rather than to metadata.
 *
 * ## Why thumbnails, and why this ceiling
 *
 * The tension is what a condensed group is FOR: a forty-call turn stays readable
 * because the fold is one line. Two failure modes bracket the answer:
 *
 * - a full figure per group (the row's own `max-h-[240px]`) destroys the
 *   compactness — one image makes an image-bearing group ~13x the height of a
 *   no-image one, and the reader who condensed a long turn to scan it now scrolls
 *   past figures instead;
 * - a filename, or a count with the picture behind a press, keeps the operator's
 *   complaint: the artifact is still not on screen.
 *
 * So every image is drawn, at the smallest size this system already draws a
 * picture (`ImageAttachment`'s `thumbnail`, the attachment frame's own 64px
 * floor), and a press on one expands it to full size through the same
 * `ImageLightbox` every other picture in the app uses. That is a bounded,
 * countable cost — the strip is one row of thumbnails, and one image and three
 * images cost the SAME height in a column this wide — paid only by groups that
 * actually produced an image. See the module's own note on the wrap below for
 * the case that is not constant height, and why it is not hidden behind a
 * scroller instead.
 *
 * ## Wrap, not a horizontal scroller
 *
 * A scroller would make the height constant for any count, and it is the wrong
 * trade here: the transcript is a vertical scroller, a horizontal one inside it
 * is reachable only by a gesture the reader has no reason to try, and a group
 * with eight screenshots would then say "I have more" without saying how many or
 * showing them. Wrapping shows every image the run produced and grows only when
 * the column genuinely cannot hold another tile (4+ at this size in the
 * transcript's 760px column). The pathological case is one more row of 64px
 * tiles per four images, which is a truthful cost for a run that really did
 * produce that many pictures.
 *
 * ## Where it sits, and why it is not the rows' own media
 *
 * The strip is a SIBLING of the fold, not a second rendering of the rows: while
 * the fold is open the rows draw their own pictures (`TranscriptRow`'s `media`),
 * and the strip is not rendered at all, so one picture is never on screen twice.
 * Its `ml-5` is `Disclosure`'s `CONTENT_INDENT` — the same one chevron column the
 * rows inside the fold hang off — so a picture sits where the row that produced
 * it would have put it.
 *
 * ## The live window and the settled one
 *
 * The strip is rendered in BOTH of a group's condensed windows — while the
 * section is live and after it settles — from the same element, in the same
 * place, keyed by the image's own id. A picture that lands mid-run therefore
 * appears once and stays: the settle transition swaps the header's live clause
 * and nothing in this subtree, which is asserted as DOM-node identity in
 * `scripts/trace-fold-behaviour.test.mjs` because a still cannot show a
 * non-remount.
 */

import { cn } from "@shared/lib/utils";
import { CanonicalImage } from "./canonical-image";
import type { TranscriptImage } from "./transcript-reducer";
import type { AttachmentScope } from "./use-attachment-url";

export type FoldMediaProps = {
	/** The run's images, in row order (`foldImages`). */
	images: readonly TranscriptImage[];
	/** The conversation the run's rows belong to; see `CanonicalImage`. */
	scope: AttachmentScope | null;
};

export const FoldMedia = ({ images, scope }: FoldMediaProps) => (
	/*
	 * A LIST, because that is what it is: the run's pictures are N of one thing,
	 * and a screen reader reaching the strip after the header hears "list, 3
	 * items" and a name for what the list is, rather than a run of identically
	 * named "Expand Screenshot" buttons attached to no set. `role="group"` says
	 * the same thing with a hand-rolled role on a `<div>` and no item count.
	 */
	<ul
		aria-label={
			images.length === 1
				? "1 screenshot from this run"
				: `${images.length} screenshots from this run`
		}
		data-fold-media=""
		className={cn("mt-1 ml-5 flex flex-wrap items-center gap-2")}
	>
		{images.map((image, index) => (
			/*
			 * `flex leading-none` on the item, and both halves are load-bearing: a
			 * picture is drawn inside an `inline-block` wrapper (shared with every
			 * other caller, so this component cannot change it), and an inline-block
			 * sits on a LINE BOX whose strut is the inherited line-height — measured
			 * at 4.7px of empty ground under a 66px frame, on a strip whose whole
			 * point is that it is 64px tall. `flex` blockifies the wrapper and
			 * `leading-none` collapses the strut, so the item is the frame's own
			 * height and the row is 66px rather than 70.7.
			 */
			<li key={image.id} className={cn("flex leading-none")}>
				<CanonicalImage
					image={image}
					scope={scope}
					size="thumbnail"
					label={images.length === 1 ? "Screenshot" : `Screenshot ${index + 1}`}
				/>
			</li>
		))}
	</ul>
);
