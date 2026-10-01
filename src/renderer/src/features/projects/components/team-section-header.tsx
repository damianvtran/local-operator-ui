/**
 * The List view's team band (issue #703, RESHAPED on operator direction).
 *
 * WHAT THE OPERATOR ASKED FOR, and why this file is List-only now. The first
 * pass of #703 gave the List, the Timeline and the Board one shared register
 * (small-caps label on a hairline) and that is not what was wanted: "The headers
 * can remain with their current backgrounds on the board view btw it's just the
 * list view that needs better contrast", and "there should probably be some sort
 * of borderless chrome background with slight brightness contrast on the header
 * just for the list view to make it easier to visually divide." The Timeline and
 * the Board therefore ship exactly what `main` ships - their own bands, byte for
 * byte, reverted in this change - and this component is what the List alone
 * uses. The issue records the Timeline half as "not needed per operator
 * direction (List-only division; Timeline/Board unchanged)"; the Timeline's own
 * band is the next candidate, not this change.
 *
 * THE BAND IS A LIGHTNESS STEP, NOT A RULE. `bg-surface` is the ladder's own
 * canvas -> surface rung (docs/branding.md §2, "+2.5 to +5.0 L*"), measured by
 * the design consult across all 59 palettes: dL* min 2.53 / median 3.54 / max
 * 4.98, dE00 min 2.05 (`sage`, the fleet's lowest; `iceberg` 2.11) with no palette
 * under the contract's 2.0 field floor, and ink floors on the new fill of 8.15:1
 * (`ink`, catppuccinFrappe) and 6.56:1 (`ink-muted`) - so the label and its count
 * clear 4.5:1 everywhere and no palette role is added. That is the whole change:
 * "slight brightness contrast", one role.
 *
 * WHY THIS RUNG AND NOT ANOTHER. `elevated` is REJECTED because it is the rung a
 * ROW's own hover already uses (`hover:bg-elevated`), so a band on it would be
 * the same fill as a hovered row directly beneath it; `row-hover` is a state
 * role rather than chrome; `sunken` is the wrong direction (a well, not chrome
 * above the rows). Accepted consequence, stated so a later round does not "fix"
 * it: the ordering reads canvas (rows) < surface (band) < elevated (a hovered
 * row), so a hovered row sits one rung ABOVE the band for the moment the pointer
 * is on it - the band is static chrome and the hover is transient and local.
 *
 * BORDERLESS, AND WHY THAT IS THE POINT. No border, no hairline, no radius, no
 * shadow: elevation here is a lightness step, and a rule under a band that
 * already separates itself by fill is the "bare text with no visual division"
 * complaint inverted. The label is the same `text-meta` as the column strip and
 * sits on the same rail as the rows.
 *
 * THE LABEL IS THE TEAM'S OWN NAME, CASE PRESERVED. A `<h3>` (the chat sidebar's
 * level for a section label, so a screen reader gets the structure the visual
 * grouping already had) in `text-ink`, with NO `uppercase`, NO `tracking-wide`
 * and NO `font-medium`: a team name is user data, and a register that prints
 * "Aida" as "AIDA" is a defect rather than a style. The count stays in the
 * quieter `text-ink-muted` beside it.
 *
 * THE SECTION IS NAMED FOR ASSISTIVE TECHNOLOGY TOO, in the two places the
 * visual grouping does not reach (review round 1, U1 and U2): the count carries
 * an accessible name (`projectsCountLabel`, so the tally says what it counts
 * rather than announcing a bare "8" beside the team name), and the List passes
 * this heading's id down so the section's own `<ul>` can point at it with
 * `aria-labelledby` - which is what makes list navigation announce the section
 * it is in instead of an unnamed list of items. `headingId` is therefore
 * required, not optional: the association is the contract, and a caller that
 * omitted it would ship a heading no list can name.
 *
 * A BAND IS A LABEL, NOT AN ACTION. No hover fill, no pointer cursor
 * (`cursor-default` states it rather than leaving the I-beam over a heading the
 * rows beside it make look clickable), nothing focusable and nothing animating -
 * rows react because they open a project; a section label does not.
 *
 * THE MASKING CONTRACT. The List pins the band itself (`sticky top-0 z-10`
 * through `className`), and the band's opaque fill spans the same box as the
 * rows - the scrolling `<ul>`'s `px-6` inset, so the band and a row both run
 * x=24..1256 at the 1280px frame - which is what lets a row scroll fully under
 * it with no pixel escaping beside it. A solid role fill needs no
 * `backdrop-blur` and no scrim.
 *
 * The `data-project-team` hook rides through `...rest` to the band: it is the
 * stories' and the rig's handle on the sticky geometry.
 */

import { cn } from "@shared/lib/utils";
import type { FC, HTMLAttributes } from "react";
import { NO_TEAM_LABEL, projectsCountLabel } from "../project-model";

export type TeamSectionHeaderProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"children"
> & {
	/** The team's name, or `null` for the no-team section (drawn as "No team"). */
	team: string | null;
	/** How many projects the section holds. */
	count: number;
	/**
	 * The id the label's `<h3>` carries, so the section's own list can name
	 * itself with `aria-labelledby={headingId}`.
	 */
	headingId: string;
};

export const TeamSectionHeader: FC<TeamSectionHeaderProps> = ({
	team,
	count,
	headingId,
	className,
	...rest
}) => (
	<div
		{...rest}
		className={cn(
			"flex h-8 cursor-default items-center gap-2 bg-surface px-3 text-meta",
			className,
		)}
	>
		<h3 id={headingId} className="truncate text-ink">
			{team ?? NO_TEAM_LABEL}
		</h3>
		<span
			className="shrink-0 text-ink-muted"
			aria-label={projectsCountLabel(count)}
		>
			{count}
		</span>
	</div>
);
