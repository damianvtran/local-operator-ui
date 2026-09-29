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
 * ## What this is: a PRESENCE CUE, not a reader of the pictures
 *
 * This is the claim the design round rewrote, and it is worth stating in the
 * component rather than only in a review thread: the tile's ceiling is 64px, so a
 * picture is reduced to at most 64 rows of pixels whatever its source resolution.
 * A flat colour field survives that; an axis label, a UI label or a line of text
 * does not — measured on this lane's own real capture, an 11px label lands at
 * 0.75px at tile size. So the strip's job is to say **that a group produced
 * something and roughly where it sits in the run**, and the things a 64px tile
 * cannot carry — how many there are, which one is which — are carried by TEXT:
 * the count in the condensed header, the name in each tile's accessible label,
 * and the row itself when the reader opens the group.
 *
 * Raising the tile until text is legible was measured and rejected: roughly 2x
 * (a ~128px picture) puts a group at ~155px and a three-group turn at ~465px,
 * past the ~338.7px one EXPANDED group costs — the budget broken to buy
 * legibility that is still marginal at 128px. That price is the one measured
 * AFTER the fold onto main, which took a child off the disclosure body and so
 * took its 8px `gap-2` out from between folded rows: the open state is 16px
 * shorter than the 354.7px this comment first quoted, and the re-taken frames in
 * `docs/evidence/chat-trace-fold/{expanded,image-expanded}` are that measurement
 * rather than a restatement of it.
 *
 * ## One row, capped, with the count said out loud
 *
 * The strip is one row of 98px tiles on an 8px gutter — `gap-2` in the class
 * list, and eight ground pixels between the tile boxes in the committed frames —
 * and it is CAPPED at FIVE slots: four tiles and the `+N more` count, which is
 * the slot the fifth picture would have taken, since the count is text rather
 * than a picture and is what makes the row fit the narrowest column this renders
 * in (the rig's measured 576px at a 640px window; the live window's own column is
 * 638px). See `FOLD_MEDIA_LIMIT`. Past the cap the last slot is `+N more` rather
 * than another picture, so the height is bounded at 91px for any count: without
 * the cap a run of 25-30 screenshots cost ~391px, more than the 338.7px expanded
 * group it was meant to save (design review round 1, D3). The count slot is a
 * CONTROL - see `onRevealMore` - because past the cap it is the only route to
 * the pictures the row did not draw.
 *
 * The count is also a clause in the condensed header itself (`· 2 images`), which
 * costs no height at all, and it is what keeps a sighted reader from being offered
 * LESS than a screen-reader user — the strip's accessible name has carried the
 * number since the first cut, which is an inversion worth not shipping.
 *
 * ## A uniform slot, and the control edge
 *
 * Every tile is the same fixed 96x64 canvas and the picture is `object-contain`
 * inside it, so a phone-shaped capture no longer draws 36px wide beside 96px
 * landscapes and a mixed-orientation row stays a grid (design review round 1, D4).
 * The frame's edge is `border-control`, not the decorative hairline: a tile IS a
 * focusable button, so its boundary is a legibility requirement — branding § 2's
 * sole-boundary rule, measured by the contrast contract at 3:1 on every ground.
 * The hairline was 1.25:1 against the light transcript, which left a light-canvas
 * screenshot with no visible extent at all (design review round 1, D2).
 *
 * ## Where it sits, and why it is not the rows' own media
 *
 * The strip is a SIBLING of the fold, not a second rendering of the rows: while
 * the fold is open the rows draw their own pictures (`TranscriptRow`'s `media`),
 * and the strip is not rendered at all, so one picture is never on screen twice.
 * Its alignment is the caller's: `indent="content"` (the default) is
 * `Disclosure`'s `CONTENT_INDENT`, the chevron column the rows inside the fold
 * hang off, so a picture sits where the row that produced it would have put it;
 * `indent="flush"` is for the turn BAR, whose header has no chevron gutter on
 * the left - with the indent the tiles there hung in a column neither the bar's
 * text nor the answer used (design round 1, D2).
 *
 * ## The live window and the settled one
 *
 * The strip is rendered in BOTH of a group's condensed windows — while the
 * section is live and after it settles — from the same element, in the same
 * place, keyed by the image's own id. A picture that lands mid-run therefore
 * appears once and stays: the settle transition swaps the header's live clause
 * and nothing in this subtree, which is asserted as DOM-node identity on the real
 * `<img>` in `scripts/chat-image-expand.test.mjs` because a still cannot show a
 * non-remount.
 */

import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { foldMediaSlots } from "../canonical/trace-fold-model";
import { CanonicalImage } from "./canonical-image";
import type { TranscriptImage } from "./transcript-reducer";
import type { AttachmentScope } from "./use-attachment-url";

export type FoldMediaProps = {
	/** The run's images, in row order (`foldImages`). */
	images: readonly TranscriptImage[];
	/** The conversation the run's rows belong to; see `CanonicalImage`. */
	scope: AttachmentScope | null;
	/**
	 * What `+N more images` DOES when pressed: open the enclosing fold.
	 *
	 * REQUIRED, because past the cap this slot is the only route to the pictures
	 * the row did not draw, and an inert count is the dead end the round-1 UX
	 * pass found (`U1`: the muted chip sat exactly where a reader expects "show
	 * the rest" and did nothing). The fold's owner passes its own toggle, so the
	 * strip never toggles anything it does not own - the same separation the
	 * thumbnails keep (a tile expands, never opens the fold).
	 */
	onRevealMore: () => void;
	/**
	 * Where the row starts: `content` (the default) keeps `Disclosure`'s content
	 * indent; `flush` starts at the caller's text edge, for the turn bar - see
	 * the file header.
	 */
	indent?: "content" | "flush";
};

export const FoldMedia = ({
	images,
	scope,
	onRevealMore,
	indent = "content",
}: FoldMediaProps) => {
	const { shown, more } = foldMediaSlots(images.length);
	return (
		/*
		 * A LIST, because that is what it is: the run's pictures are N of one
		 * thing, and a reader reaching the strip after the header hears how many
		 * and what the set is, rather than a run of identically named "Expand
		 * Image" buttons attached to no set. `role="list"` is not decoration:
		 * Tailwind's preflight sets `list-style: none` on `ul`, and WebKit drops
		 * list semantics for a list without markers, so the role is what keeps the
		 * count in the name (design review round 1, P5).
		 */
		<ul
			/*
			 * `role="list"` on a `ul` is redundant in HTML and load-bearing in WebKit,
			 * which drops list semantics for a list whose markers are suppressed — and
			 * Tailwind's preflight sets `list-style: none` on every `ul` in this app, so
			 * Safari/VoiceOver would otherwise read the tiles as loose buttons with no
			 * set name and no count, which is the opposite of what this `aria-label`
			 * says (agent review round 1, P5). Both suppressions below are that one
			 * fact: the first is the redundant-role rule, and the second fires because
			 * an explicit role makes the element/role pairing ambiguous to a static
			 * checker that cannot see the WebKit rule it exists for.
			 */
			/* biome-ignore lint/a11y/noRedundantRoles: WebKit drops the implicit list role when `list-style: none` is set, so the explicit one is what carries the count to VoiceOver. */
			/* biome-ignore lint/a11y/useSemanticElements: the element already IS the one the rule suggests - the explicit role is the WebKit fix above, not a substitute for `ul`. */
			role="list"
			/*
			 * ONE NOUN for one object, and `image` is the one that wins: it is the word
			 * `foldMediaClause` already puts in the visible header of this same row, the
			 * word this list's own name uses, and the record's own noun
			 * (`TranscriptImage`) - an attachment a run produced need not be a capture.
			 * The per-tile name says the same word plus the position (`Image 2`), so the
			 * clause, the set and the buttons agree; the earlier cut's "Screenshot N"
			 * (kept once to match every other picture button) read wrong on the charts
			 * this strip exists to index (UX round 1, U4), and the row's own pictures
			 * take the same noun.
			 */
			aria-label={
				images.length === 1
					? "1 image from this run"
					: `${images.length} images from this run`
			}
			data-fold-media=""
			className={cn(
				"mt-1 flex flex-wrap items-center gap-2",
				indent === "content" ? "ml-5" : "ml-0",
			)}
		>
			{images.slice(0, shown).map((image, index) => (
				/*
				 * `flex leading-none` on the item, and both halves are load-bearing: a
				 * picture is drawn inside an `inline-block` wrapper (shared with every
				 * other caller, so this component cannot change it), and an inline-block
				 * sits on a LINE BOX whose strut is the inherited line-height —
				 * measured at 4.7px of empty ground under a 66px frame, on a strip
				 * whose whole point is that it is 64px tall. `flex` blockifies the
				 * wrapper and `leading-none` collapses the strut, so the item is the
				 * frame's own height and the row is 66px rather than 70.7.
				 */
				<li key={image.id} className={cn("flex leading-none")}>
					<CanonicalImage
						image={image}
						scope={scope}
						size="thumbnail"
						label={images.length === 1 ? "Image" : `Image ${index + 1}`}
					/>
				</li>
			))}
			{more > 0 && (
				/*
				 * THE COUNT IS THE CONTROL. Past the cap this slot is the only route to
				 * the pictures the row did not draw, so it OPENS the enclosing fold
				 * rather than sitting as text a reader cannot act on (UX round 1, U1);
				 * the fold then draws the remainder itself. The shared `Button` rather
				 * than hand-rolled classes: hover, pressed and the focus ring are the
				 * app's own, and it is keyboard-reachable by construction. The noun
				 * joins the count, so `+4 more images` cannot read as more actions or
				 * lines.
				 */
				<li
					key="fold-media-more"
					className={cn("flex h-16 items-center leading-none")}
				>
					<Button variant="ghost" size="sm" onClick={onRevealMore}>
						{`+${more} more image${more === 1 ? "" : "s"}`}
					</Button>
				</li>
			)}
		</ul>
	);
};
