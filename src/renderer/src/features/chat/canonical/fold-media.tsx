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
 * (a ~128px-TALL picture) puts a group at ~155px and a three-group turn at ~465px,
 * past the ~338.7px one EXPANDED group costs - the budget broken to buy legibility
 * that is still marginal at 128px. That price is the one measured AFTER the fold
 * onto main, which took a child off the disclosure body and so took its 8px `gap-2`
 * out from between folded rows: the open state is 16px shorter than the 354.7px this
 * comment first quoted, and the re-taken frames in
 * `docs/evidence/chat-trace-fold/{expanded,image-expanded}` are that measurement
 * rather than a restatement of it. The tile this file draws is a step up from 98x66
 * and nowhere near that: 117x78 (3:2, the fixtures' own aspect), a condensed group
 * of `header 20 + gap 8 + 78` = 106px, three image-bearing groups 318px, inside the
 * 338.7px budget.
 *
 * ## One row, capped, with the count said out loud
 *
 * The strip is one row of 117px tiles on an 8px gutter - `gap-2` in the class list -
 * and it is CAPPED at FIVE slots: four tiles and the `+N` count, which is the slot
 * the fifth picture would have taken, since the count is text rather than a picture
 * and is what makes the row fit the narrowest column this renders in (the rig's
 * measured 556px of strip at a 640px window). See `FOLD_MEDIA_LIMIT` for the
 * arithmetic, in strip and in window terms. Past the cap the last slot is `+N`
 * rather than another picture, so the height is bounded at 106px for any count:
 * without the cap a run of 25-30 screenshots cost ~391px, more than the 338.7px
 * expanded group it was meant to save (design review round 1, D3). The count slot
 * is a CONTROL - see `onRevealMore` - because past the cap it is the only route to
 * the pictures the row did not draw.
 *
 * THE VISIBLE LABEL IS COMPACT AND THE NAME IS NOT: the control reads `+4` and its
 * accessible name (and title) is `+4 more images` - the NAME CONTAINS THE VISIBLE
 * LABEL, which WCAG 2.5.3 requires of a symbol-only label (see the call site's own
 * comment). The short form is what funds the larger tile (the old full-noun label
 * was 111.1-118.9px, `+4` is 33.6px, and four 117px tiles plus the long label would
 * need a ~703px window), and it is the precedent the canvas filter already sets
 * (`canvas-file-viewer.tsx`: `Images +1` visible, every selected group in the name).
 * The accessible name is the count's honest carrier - the noun never leaves it - and
 * the same sentence is the `title` for a pointer reader, who would otherwise have a
 * bare `+4` with no statement of what is being counted; the header's own `· 8 images`
 * clause says it in text beside it.
 *
 * THE BOUND THE ROW IS SIZED ON IS A COUNT, NOT A GUARANTEE: `+99` is the widest
 * label a realistic run prints, and the row holds it with 14.6px of the 556px
 * column to spare. A three-digit remainder (`+999`) still measures inside the
 * column (549.2px, slack 6.8), but nothing CLAMPS the printed digits: a run of
 * 1004 pictures prints `+1000` and wraps - the same class of failure the old
 * full-noun label had, one order of magnitude further out, and not reachable in
 * the fixtures. Stating it as a bound rather than as a ceiling is the honest
 * form; clamping the digits would be a copy decision this component does not own.
 *
 * The count is also a clause in the condensed header itself (`· 2 images`), which
 * costs no height at all, and it is what keeps a sighted reader from being offered
 * LESS than a screen-reader user - the strip's accessible name has carried the
 * number since the first cut, which is an inversion worth not shipping.
 *
 * ## A uniform slot, and an edge that appears when it is needed
 *
 * Every tile is the same fixed 115x76 canvas inside a 1px reserved border (117x78),
 * and the picture is `object-contain` inside it, so a phone-shaped capture no longer
 * draws narrow beside landscapes and a mixed-orientation row stays a grid (design
 * review round 1, D4). AT REST THE TILE HAS NO EDGE: the operator asked for the ring
 * to go, and the tile is a well (`bg-media-surface`, 6px radius) carrying the
 * picture. The edge is `border-control` and it returns on hover and on keyboard
 * focus - the state in which the tile is a control - through a border whose pixel
 * is reserved at rest (`border-transparent`), so the edge appearing never reflows
 * the row. THE FILL IS THE RESTING EXTENT, AND IT CARRIES A FLOOR: the ring was
 * the tile's only >=3:1 carrier of its own extent, no rung of the fill ladder could
 * replace it (the best ground step any palette has is 1.33:1), and a picture whose
 * canvas is the page's own tone (the `image-tones` fixtures) measures ~1.0:1 against
 * the page - so the tile's well is `mediaSurface`, the fill role authored to
 * branding section 2's findability floor (ΔE00 >= 4.0 off the canvas, with a >= 2.5
 * L* half), where the shared `sunken` step measured as low as 2.00. The floor is the
 * 1px-mark one because that is the whole of what a filling picture shows of the
 * well - a ring at the picture's edge and corners - while a letterboxed portrait
 * shows it as the mats it sits between. A FAILED tile keeps its edge
 * (`BrokenAttachment compact`), because there the state is the information and
 * there is no picture to give the tile an extent - and it keeps the shared
 * `sunken` well beside that edge.
 *
 * HOVER IS AN INNER ZOOM, AND IT IS A KNOWN EXCEPTION to branding section 4
 * ("Nothing lifts, scales, or translates on hover"): the operator asked for a
 * subtle lift/zoom on the tile, and the one form that cannot break layout is the
 * picture scaling INSIDE a frame that clips it - the tile's silhouette and its
 * neighbours never move. The bound is the gutter (8px on a 117px tile: 1.068), and
 * the value is 1.04, `origin-center`, `duration-fast`. It is `motion-safe:` only:
 * under `prefers-reduced-motion: reduce` there is NO zoom and the hover cue is the
 * edge alone, so the cue that always reads is a state (an edge present), not a
 * movement.
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
import { foldMediaRows, foldMediaSlots } from "../canonical/trace-fold-model";
import { CanonicalImage } from "./canonical-image";
import type { TranscriptImage } from "./transcript-reducer";
import type { AttachmentScope } from "./use-attachment-url";

export type FoldMediaProps = {
	/** The run's images, in row order (`foldImages`). */
	images: readonly TranscriptImage[];
	/** The conversation the run's rows belong to; see `CanonicalImage`. */
	scope: AttachmentScope | null;
	/**
	 * What the `+N` control DOES when pressed: open the enclosing fold.
	 *
	 * REQUIRED, because past the cap this slot is the only route to the pictures
	 * the row did not draw, and an inert count is the dead end the round-1 UX
	 * pass found (`U1`: the muted chip sat exactly where a reader expects "show
	 * the rest" and did nothing). The fold's owner passes its own toggle, so the
	 * strip never toggles anything it does not own - the same separation the
	 * thumbnails keep (a tile expands, never opens the fold).
	 *
	 * THE CALLER ALSO OWNS WHERE FOCUS GOES (UX round 1, U2): pressing this control
	 * unmounts the strip - and the control with it - so a keyboard reader's focus
	 * would fall to `<body>` and the next Tab would restart at the document's first
	 * stop. The fold's trigger stays mounted and is the control that closes the group
	 * again, so the caller's `expand` hands focus to it in the same handler; this
	 * component cannot, because it never holds the trigger.
	 */
	onRevealMore: () => void;
	/**
	 * Where the row starts: `content` (the default) keeps `Disclosure`'s content
	 * indent; `flush` starts at the caller's text edge, for the turn bar - see
	 * the file header.
	 */
	indent?: "content" | "flush";
	/**
	 * Whether the strip may exceed its cap: show every picture the run holds.
	 *
	 * TRUE only for the spanning bar's sole image-bearing group (U8): the press
	 * that opened the bar was the reader asking for `the rest`, and a group that
	 * holds the same set must not charge a second press for it - so the cap
	 * comes off THERE and nowhere else. The cap still bounds every strip whose
	 * cost the reader has not explicitly asked to pay, which is why this is a
	 * caller's fact rather than a number this component reads for itself.
	 */
	uncapped?: boolean;
};

export const FoldMedia = ({
	images,
	scope,
	onRevealMore,
	uncapped = false,
	indent = "content",
}: FoldMediaProps) => {
	const { shown, more } = foldMediaSlots(images.length, { uncapped });
	/*
	 * Row lengths, which only matter once the tiles need more than one row: the
	 * capped strip is at most four tiles and the count on ONE flex row, and the
	 * uncapped one is a four-column GRID so it never strands a single tile (design
	 * round, D5: the old strip wrapped 7+1 at 1280px, and a plain four-per-row wrap
	 * still strands one at 5, 9, 13 ...). `foldMediaRows` owns the rule - the last
	 * two rows are rebalanced when the remainder is one - and the grid is how an
	 * uneven row is expressed without a spacer element: the first tile of every row
	 * is pinned to column 1, so a short row simply leaves its tail cells empty and
	 * the next tile starts the next line. No extra `li` exists to be counted as a
	 * picture, and the list keeps exactly one item per tile.
	 */
	const rows = foldMediaRows(shown);
	const gridded = rows.length > 1;
	const rowStarts = new Set<number>();
	for (let start = 0, r = 0; r < rows.length; r += 1) {
		rowStarts.add(start);
		start += rows[r];
	}
	const tiles = images.slice(0, shown).map((image, index) => (
		/*
		 * `flex leading-none` on the item, and both halves are load-bearing: a
		 * picture is drawn inside an `inline-block` wrapper (shared with every
		 * other caller, so this component cannot change it), and an inline-block
		 * sits on a LINE BOX whose strut is the inherited line-height -
		 * measured at 4.7px of empty ground under a 66px frame, on a strip
		 * whose whole point is that it is one tile tall. `flex` blockifies the
		 * wrapper and `leading-none` collapses the strut, so the item is the
		 * frame's own height and the row is 78px rather than ~83.
		 */
		<li
			key={image.id}
			className={cn(
				"flex leading-none",
				gridded && rowStarts.has(index) && "col-start-1",
			)}
		>
			<CanonicalImage
				image={image}
				scope={scope}
				size="thumbnail"
				label={images.length === 1 ? "Image" : `Image ${index + 1}`}
			/>
		</li>
	));
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
				/*
				 * `mt-2`, the same 8px as the gutter: the strip has ONE spacing constant.
				 * It was 4px above against 8px between tiles, which read as an accident
				 * rather than a rhythm (design round, section 2.3).
				 */
				"mt-2 gap-2",
				/*
				 * Capped: one flex row of tiles and the count. Uncapped past four tiles:
				 * a four-column grid of the tile's own width (117px, the frame box), so
				 * every row is the same 492px wide and the wrap count does not depend on
				 * the column. The grid does not wrap to fewer columns on a narrow strip -
				 * it is 492px + the indent, and the app's minimum window (800px) leaves
				 * 716px of strip - where the flex row it replaces wrapped to whatever fit.
				 */
				gridded
					? "grid grid-cols-[repeat(4,max-content)] items-start"
					: "flex flex-wrap items-center",
				indent === "content" ? "ml-5" : "ml-0",
			)}
		>
			{tiles}
			{more > 0 && (
				/*
				 * THE COUNT IS THE CONTROL. Past the cap this slot is the only route to
				 * the pictures the row did not draw, so it OPENS the enclosing fold
				 * rather than sitting as text a reader cannot act on (UX round 1, U1);
				 * the fold then draws the remainder itself. The shared `Button` rather
				 * than hand-rolled classes: hover, pressed and the focus ring are the
				 * app's own.
				 *
				 * `outline`, not `secondary` (design round, D3): the `bg-surface` fill
				 * was the pill beside four near-square tiles and bought nothing (surface
				 * against canvas is ~1.1:1), while `border-control` is the resting cue the
				 * earlier UX round required (U9) - a `ghost` at rest reads as a caption,
				 * and this is a control. It is the Badge's own `outline` triple, so the
				 * count joins that family with no box change.
				 *
				 * THE VISIBLE LABEL IS `+N` AND THE NAME IS THE SENTENCE. The full noun
				 * made the control 111-119px, which is what capped the tile at ~101px;
				 * `+4` is 34px and is what lets the tile be 117px (see `FOLD_MEDIA_LIMIT`
				 * for the arithmetic). The accessible name is where the count and its noun
				 * live, for a reader who cannot see position and form: `4 more images`,
				 * and the same string as the `title` for the pointer reader, who would
				 * otherwise have a bare `+4`. The precedent is `canvas-file-viewer.tsx`
				 * (`Images +1` visible, every group in the name).
				 */
				<li
					key="fold-media-more"
					className={cn("flex h-[78px] items-center leading-none")}
				>
					<Button
						variant="outline"
						size="sm"
						onClick={onRevealMore}
						/*
						 * THE NAME CONTAINS THE VISIBLE LABEL, and that is a
						 * requirement rather than a courtesy (WCAG 2.5.3, label in
						 * name, Level A): a speech user reading `+4` off the screen
						 * says "plus four", and a name of `4 more images` matches
						 * nothing they could have said. The `+` is in both, so the
						 * visible string is a substring of the name, and the noun
						 * still travels with the count for a reader who cannot see
						 * the symbol's position in the row.
						 */
						aria-label={`+${more} more image${more === 1 ? "" : "s"}`}
						/*
						 * The SAME sentence as the name, `+` included: the pointer reader
						 * meets the same string a speech user reads off the screen, and the
						 * visible label is a substring of both (WCAG 2.5.3).
						 */
						title={`+${more} more image${more === 1 ? "" : "s"}`}
					>
						{`+${more}`}
					</Button>
				</li>
			)}
		</ul>
	);
};
