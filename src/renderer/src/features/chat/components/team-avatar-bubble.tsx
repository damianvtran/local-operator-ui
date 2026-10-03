import { teamInitials } from "@shared/api/local-operator/team-initials";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@shared/components/ui/avatar";
import { badgeVariants } from "@shared/components/ui/badge";
import { Tooltip } from "@shared/components/ui/tooltip";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";

/**
 * A team, drawn as a compact initials bubble.
 *
 * WHY IT EXISTS. Full team names in the chat sidebar's session rows
 * (operator report, 2026-10-01) pushed the title out of the row: the trailing
 * slot is a share of the row's own width, so a name like `Local Operator
 * Development` cost the title as much as the title's own clip could pay, and a
 * row's title truncated harder the longer a reader's team name happened to be.
 * The bubble replaces the drawn name with a two-character mark (`teamInitials`)
 * whose cost does not depend on how long the name is, and puts the whole name
 * back on hover and on keyboard focus.
 *
 * THE NAME IS NEVER ONLY IN THE PIXELS. The mark is `role="img"` with
 * `aria-label={name}`, so it contributes the team's full display name to the
 * row's accessible name - the property the label it replaces had ("the
 * accessible name must never be narrower than the pixels"). The hover/focus
 * tooltip is the SAME string, and it is a tooltip rather than a `title`
 * attribute for the reason the row's flyout records: a native tooltip beside the
 * app's own is two pointer surfaces for one fact.
 *
 * IMAGE-READY, AND WHAT THAT MEANS CONCRETELY. `imageUrl` is the one field a
 * future generated team avatar plugs into. When it is a non-empty string the
 * picture renders inside the bubble; Radix's `AvatarImage` reports its own load
 * failure to the root, which is what swaps in the initials fallback, so an
 * absent URL, a 404, a blocked request and a decoding failure all land on the
 * same mark with no error state of ours to maintain. WHERE THE URL WILL COME
 * FROM: a team's catalogue record (a `teams.list` row's icon/image field, the
 * way `label` arrived in 2026-09-26's label split), produced by whatever flow
 * the operator runs to generate them - this component builds NO part of that
 * flow (no generation call, no upload, no cache) and reads only the field.
 * Callers that have no such field yet pass `null` and get the initials.
 *
 * THE MARK IS THE SHARED BADGE'S OWN COMPOSITION (operator round, 2026-10-02).
 * The report, verbatim: the ringed `LD`/`RD` bubbles "should probably be more
 * similar to the borderless bubble of the sidebar notification counts — slight
 * contrast vs backdrop, smaller more subtle text, in the case there's no
 * picture. Currently it looks kind of ugly." That bubble is the sidebar rail's
 * `attentionQuiet` register (`shared/components/navigation/sidebar-navigation.tsx`),
 * itself the result of an identical earlier round (2026-09-30: "borderless ...
 * smaller font size ... subtler font treatment ... instead of the janky
 * bubble"). It is why this is a COMPOSITION rather than a set of literals: the
 * face is `badgeVariants({ variant: "attentionQuiet", shape: "pill",
 * size: "count" })` - the very call the rail makes - so the two read as one
 * family today and cannot drift apart the way a copied class string does.
 *
 * WHAT CARRIES THE MARK NOW THAT THE EDGE IS GONE, which is the argument
 * `badge.tsx` already made for this register: the mark's information is the
 * INITIALS, and they keep their own floor (`ink-dim` on `elevated`, 5.01:1 worst
 * over the fifty-nine palettes); `elevated` is the whisper of a shape that groups
 * the letters as a MARK rather than as label text, and where that fill merges
 * with a row's ground the letters alone read - the deal the sidebar's own count
 * lines strike. The `border-control` edge existed because a `sunken` plate WAS
 * the whole boundary (it collides with the row states inside the field floor on
 * some palettes, `alucard` 0.44 on `rowSelected`); nothing about the initials is
 * lost with it, because the letters are what the row reads.
 *
 * THE MARK'S GEOMETRY IS THE BADGE'S, so the PICTURE renders inside that same
 * geometry: the `Avatar` takes the badge's height (`h-4`) and is sized by its own
 * content (`size-4` for a loaded picture, the initials' own width otherwise)
 * rather than by the old `size-5` circle.
 *
 * WHAT THAT DOES TO THE PICTURE CASE, stated whole because "20px -> 16px" is not
 * the whole of it: the thumbnail is still a circular crop, now 16px inside the
 * badge's 24x16 stadium - the badge's own `px-1` leaves a 4px collar of `elevated`
 * on each side of it. Measured off the rendered frame at head, in css: the mark is
 * x 24.0-48.0, and inside it the plate runs 24.0-28.0, the crop 28.0-44.0, and the
 * plate again 44.0-48.0 - 4.0 each side. Before, the 1px `border-control` sat ON
 * the 20px circle, so there was no collar at all. The picture's mechanism - Radix's
 * `AvatarImage` and the load error it reports back to the root - is untouched, and
 * its rendered size is the one thing about it this round moves.
 *
 * THE INITIALS GOT SUBTLER, NOT SMALLER, which is worth knowing because the
 * report asked for both: the glyphs keep the rail badge's own `text-meta-sm`
 * (11px; cap height 8.5-9.0 css, against the rail's own numeral at 8.0), because
 * moving the type step would break the shared `badgeVariants` call that makes the
 * two faces one family. So "smaller, more subtle" landed as subtler - weight
 * 500 -> 400 and `ink` -> `ink-dim` - and as a smaller MARK (20 -> 16px tall).
 *
 * WHY IT TAKES A `showTooltip` FLAG. The sidebar row is the case the tooltip
 * exists for: there the bubble is the ONLY thing naming the team, so hover and
 * keyboard focus have to give the name back. The chat header's identity chip
 * (requirement of the same request) draws the bubble LEADING the full name it
 * already spells out, so a tooltip there would add nothing and would put a
 * second pointer surface inside a control that already carries a `title` - the
 * doubling the row's flyout was built to avoid. The flag defaults ON (the
 * bubble's own contract) and the header turns it off with that reason written at
 * its call site.
 *
 * WHERE THE ROW'S FLYOUT GOES WHILE THE MARK SPEAKS is the CALLER's business, not
 * this component's. The mark sits inside the row's flyout trigger, so a hover
 * over it would otherwise open the row's card AND this tooltip - two pointer
 * surfaces for one hover. The sidebar's row reports the engagement (a wrapper
 * around this component carries the four pointer/focus handlers) and the sidebar
 * stands the flyout down for that row; this component is deliberately unaware of
 * it, so it can be placed anywhere a team needs a mark without dragging a rule
 * about someone else's overlay along.
 */
export type TeamAvatarBubbleProps = {
	/** The team's display name (`teamDisplayName`): initials are taken from it, and
	 * it is the whole of what the tooltip and the accessible name say. */
	name: string;
	/** A generated team avatar. Absent, empty or failing to load means initials. */
	imageUrl?: string | null;
	/** The team's slug, carried as `data-team-slug` for tests and evidence rigs to
	 * address one team's bubble by. Never read for display - the mark comes from
	 * `name`, which is what a reader would have read. */
	slug?: string;
	/** Whether hovering or focusing the bubble names the team. On for the sidebar
	 * row (the bubble is the only name there); off where the name is drawn beside
	 * it and the surrounding control owns the pointer surface. */
	showTooltip?: boolean;
	/** What a press or an Enter/Space on the mark does.
	 *
	 * The mark is a focus stop inside the row's `<button>`, and a focus stop that
	 * activates nothing is a dead one: UX round 1 (U1) measured Enter on it leaving
	 * `activeElement` on the mark with the row's click listener never firing, so a
	 * reader who tabbed onto it (the same gesture they use on the row's Pin and
	 * Manage controls, which DO act) got no answer. The sidebar passes the row's own
	 * press, so the mark's keyboard activation is the row's, guard included, rather
	 * than a second way of opening a conversation. */
	onActivate?: () => void;
	className?: string;
};

export const TeamAvatarBubble: FC<TeamAvatarBubbleProps> = ({
	name,
	imageUrl,
	slug,
	showTooltip = true,
	onActivate,
	className,
}) => {
	const initials = teamInitials(name);
	const mark = (
		<span
			/*
			 * The hooks this change's own tests and the evidence rigs address the
			 * bubble by, following the row's convention (`data-session-title`,
			 * `data-subagent-mark`). The slug is the stable identity; the initials
			 * are in the element's text for a DOM assertion to read.
			 */
			data-team-bubble
			data-team-slug={slug}
			/*
			 * A focusable READOUT rather than a control, the arrangement
			 * `session-status-strip.tsx` states for its own tooltip: what it opens
			 * is a reading (which team this is), never an action, so a `button`
			 * would announce a press that does not exist - and a second `button`
			 * inside the row's own `<button>` is invalid markup.
			 *
			 * WHERE THE PRECEDENT DOES NOT CARRY OVER, since it is the part a reader
			 * has to know: that readout stands on a strip, while this one is a
			 * descendant of the row's `<button>` (`data-chat-row`). A tabbable
			 * descendant of a button is the shape the HTML content model calls
			 * interactive content inside interactive content - legal in no browser's
			 * parser terms today (it parses, and Chromium walks it: the focus frame
			 * and the focus-ordering are both measured working), but a shape a reader
			 * should not "clean up" without paying for it. The alternative the
			 * reviewer offered - move the mark OUT of the button and put the row's
			 * team name into an `aria-label` on it - costs the property this row
			 * states above itself ("the accessible name must never be narrower than
			 * the pixels"): the row's name is composed from its own content, and
			 * every later slot that joins that content would have to be restated by
			 * hand. Kept, and disclosed rather than silently accepted (agent review
			 * round 1, R1-M4).
			 */
			tabIndex={showTooltip ? 0 : undefined}
			role="img"
			aria-label={name}
			/*
			 * Enter and Space, because a stop that only shows a reading still has an
			 * obvious answer to "what happens if I press it" inside a row: the row.
			 * Space is prevented because its default is a scroll.
			 */
			onKeyDown={(event) => {
				if (!onActivate) return;
				if (
					event.key !== "Enter" &&
					event.key !== " " &&
					event.key !== "Spacebar"
				)
					return;
				event.preventDefault();
				onActivate();
			}}
			/* The ring follows the circle: `outline` traces this box, and without a
			 * radius the app's 2px focus ring was a 28x28 SQUARE around a 20px round
			 * mark (design round 1, D2 - measured off the focus frame: corners 4px off
			 * the object). `styles/index.css` states the rule: an outline follows the
			 * element's own `border-radius` - which is now the badge's `shape="pill"`,
			 * so the ring and the mark's own corner move together rather than
			 * `rounded-full` being spelled a second time here. */
			className={cn(
				badgeVariants({
					variant: "attentionQuiet",
					shape: "pill",
					size: "count",
				}),
				className,
			)}
		>
			{/*
			 * THE PICTURE SITS IN THE MARK'S GEOMETRY rather than in a box of its own:
			 * the badge's height (`h-4`) is the avatar's, and the avatar is sized by its
			 * content - `size-4` for a loaded picture, the initials otherwise - so the
			 * mark's width follows the letters the way the rail's count badge does
			 * (`min-w-4` is the badge's floor and is on the root). `overflow-hidden` and
			 * `rounded-full` are the primitive's own, which is what clips the picture to
			 * the circle.
			 */}
			<Avatar className="h-4 w-fit">
				{/*
				 * `alt=""` on purpose: the accessible name is the outer span's
				 * `aria-label`, and a second name inside the same mark would be the
				 * same fact announced twice.
				 */}
				{imageUrl ? (
					<AvatarImage src={imageUrl} alt="" className="size-4" />
				) : null}
				{/*
				 * The fallback is TRANSPARENT and inherits the mark's ink and type step from
				 * the badge composition on the root (`bg-transparent font-normal
				 * text-inherit text-meta-sm`), rather than painting a plate of its own. The
				 * primitive's defaults (`bg-sunken`, `font-medium`, `text-ink-muted`,
				 * `text-meta`) are what these four override, so an absent URL, a 404, a
				 * blocked request and a decoding failure all land on ONE face - the badge's
				 * - which is the property this component's docstring states.
				 */}
				<AvatarFallback className="h-full w-auto bg-transparent font-normal text-inherit text-meta-sm">
					{initials}
				</AvatarFallback>
			</Avatar>
		</span>
	);
	if (!showTooltip) return mark;
	return (
		<Tooltip
			/*
			 * The same name, in a wrapper `aria-hidden` from assistive technology.
			 * Radix points the trigger's `aria-describedby` at this panel whenever it
			 * is open, so an unmarked body means the name arrives twice on one focus:
			 * once as the trigger's own label and again as its description (agent
			 * review round 1, R1-M6). The panel is the visual echo of a name the
			 * focusable element already carries, so the hide costs nothing a screen
			 * reader had - and the zero-size cost is why the precedent cited for the
			 * shape does not need it (its tooltip body is a longer reading than its
			 * label, so its two announcements differ).
			 */
			content={<span aria-hidden="true">{name}</span>}
		>
			{mark}
		</Tooltip>
	);
};
