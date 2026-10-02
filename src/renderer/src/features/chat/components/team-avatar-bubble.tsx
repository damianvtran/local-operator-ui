import { teamInitials } from "@shared/api/local-operator/team-initials";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@shared/components/ui/avatar";
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
 * THE BUBBLE KEEPS ITS OWN EDGE, and the edge is on the ROOT rather than on the
 * fallback, which is a deliberate difference from the app's two other avatar
 * plates (`user-profile-sidebar.tsx`, `agents-sidebar.tsx`, whose fallback IS
 * the whole object). Here the picture REPLACES the fallback when it loads, so an
 * edge drawn on the fallback would vanish exactly when the mark stops being a
 * fill - and the edge is what keeps a `sunken` plate legible inside a row the
 * pointer or the selection has painted a rung over (`scripts/contrast-contract.mjs`
 * measures the pair against `rowHover` and `rowSelected`; that pair is
 * satisfiable only with the edge, because `sunken` and the row's states collide
 * inside the field floor on some palettes).
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
	className?: string;
};

export const TeamAvatarBubble: FC<TeamAvatarBubbleProps> = ({
	name,
	imageUrl,
	slug,
	showTooltip = true,
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
			 * would announce a press that does not exist. The tab stop is the
			 * honest form - without it the tooltip is reachable only by pointer -
			 * and it is why the rule's own remedy (dropping the tabindex) is the
			 * wrong one here. The tab stop exists only where a tooltip does: the
			 * header's bubble, which has none, adds no stop to that control.
			 */
			tabIndex={showTooltip ? 0 : undefined}
			role="img"
			aria-label={name}
			className={cn("inline-flex shrink-0", className)}
		>
			<Avatar className="size-5 border border-control">
				{/*
				 * `alt=""` on purpose: the accessible name is the outer span's
				 * `aria-label`, and a second name inside the same mark would be the
				 * same fact announced twice.
				 */}
				{imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
				<AvatarFallback className="bg-sunken text-ink text-meta-sm">
					{initials}
				</AvatarFallback>
			</Avatar>
		</span>
	);
	if (!showTooltip) return mark;
	return <Tooltip content={name}>{mark}</Tooltip>;
};
