/**
 * The team section header the List, the Timeline and the Board share
 * (issue #703): a small-caps label and a quiet count on a hairline, in a
 * register of its own so a section can no longer be mistaken for a project row.
 *
 * WHAT WAS WRONG. Each surface hand-rolled the same band: `text-meta`, the team
 * name in `text-ink`, the count in `text-ink-muted`, on `canvas`. One type step
 * under a row's `text-body-sm text-ink` name, in the same ink family and the same
 * flush left edge, a header read as a row that had forgotten to react to hover -
 * the reporter's "you can hover a project but not a team name". Three copies of
 * the recipe was also how the three views could drift into three registers.
 *
 * THE REGISTER IS THE APP'S OWN SECTION LABEL, not a new one: `font-medium
 * text-ink-dim text-meta uppercase tracking-wide` is byte-for-byte the class list
 * of the chat sidebar's `sectionLabel()` and the view menu's `group()` (the
 * "muted small-caps group label", design-reviewed in PR #493), so a team header
 * reads as the same kind of thing as "Active chats" and "Group by". Type steps
 * are `docs/branding.md` §4's `text-meta`; the ink is §2's `ink-dim` (caption /
 * metadata), whose 5:1 floor `pnpm check-themes` already holds on `canvas`.
 * The COUNT stays in the same quiet ink: the old `ink-muted` count would now be
 * louder than the `ink-dim` name it annotates, inverting the hierarchy.
 *
 * THE HAIRLINE AND THE HEIGHT. The band is `h-8` (32px) - the board's pinned band
 * offset (`top-11`, the 44px column row plus this) is written against exactly that
 * number, so the shared component must not move it - with the label bottom-aligned
 * (`items-end pb-1`) above a `border-b border-hairline`, the view menu's own
 * group idiom (`pt-3` above, a small gap, the rule below). Bottom-aligning inside a
 * fixed height, rather than padding, is what lets the one component fit the
 * board's constant AND give the list and timeline the same air above the label.
 * The rule is a §2 "decorative" line (`hairline`, not `border-control`): it
 * bounds nothing that can be operated.
 *
 * A HEADER IS A LABEL, NOT AN ACTION - so it has no hover. There is no hover
 * ground, no pointer cursor (`cursor-default` states it rather than leaving the
 * I-beam over a heading the rows beside it make look clickable), nothing
 * focusable was added and nothing animates, so §9 items 6-7 (keyboard, reduced
 * motion) have nothing to check. The asymmetry the reporter read as broken is now
 * the register's intent: rows react because they open a project; a small-caps
 * label on a rule does not, in this app or any of the three views. Should a
 * collapse ever be ruled in, it belongs on this component's one element.
 *
 * THE STICKY CONTRACT STAYS WITH THE SURFACE. The band is a plain block here; each
 * view passes the pinning that is its own (`sticky top-0`, the board's `top-11`,
 * the timeline's h-scroll pin) through `className`, and `innerClassName`/
 * `innerStyle` for the box that holds name and count, because the board and the
 * timeline pin THAT box left while the band's ground and hairline keep masking
 * the full width. The `data-*` hooks (`data-project-team`, `data-board-team`) are
 * passed straight through to the band: they are the stories' and the rig's handle
 * on the sticky geometry.
 *
 * HEADING SEMANTICS: the label is an `<h3>`, the sidebar's level for a section
 * label, so a screen reader gets the section structure the visual grouping
 * already had. Same `cn` route as every className here, so a type step and an ink
 * role in one call cannot collide silently.
 */

import { cn } from "@shared/lib/utils";
import type { CSSProperties, FC, HTMLAttributes } from "react";
import { NO_TEAM_LABEL } from "../project-model";

export type TeamSectionHeaderProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	"children"
> & {
	/** The team's name, or `null` for the no-team section (drawn as "No team"). */
	team: string | null;
	/** How many projects the section holds. */
	count: number;
	/** Extra classes for the box that holds the name and the count. */
	innerClassName?: string;
	/** Inline style for that box (the timeline's fixed name column width). */
	innerStyle?: CSSProperties;
};

export const TeamSectionHeader: FC<TeamSectionHeaderProps> = ({
	team,
	count,
	className,
	innerClassName,
	innerStyle,
	...rest
}) => (
	<div
		{...rest}
		className={cn(
			"flex h-8 cursor-default items-end border-hairline border-b bg-canvas pb-1",
			className,
		)}
	>
		<span
			className={cn("flex min-w-0 items-center gap-2", innerClassName)}
			style={innerStyle}
		>
			<h3 className="truncate font-medium text-ink-dim text-meta uppercase tracking-wide">
				{team ?? NO_TEAM_LABEL}
			</h3>
			<span className="shrink-0 text-ink-dim text-meta">{count}</span>
		</span>
	</div>
);
