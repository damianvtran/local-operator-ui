import { cn } from "@shared/lib/utils";
import { type HTMLAttributes, forwardRef } from "react";
import { Badge, countLabel } from "./badge";

/**
 * AttentionBadge — THE one mark for a count of things waiting on the user, in
 * the sidebar and inside Team Bridge.
 *
 * WHY ONE COMPONENT (operator, 2026-10-28). The operator pointed at the
 * Notifications row's filled accent circle and asked for that style on EVERY
 * sidebar attention count: Aida, Browser, Mesh and Team Bridge wore the
 * borderless `attentionQuiet` register, which was easy to miss. This REVERSES
 * notifications decision D5 (2026-10-25, PR #1415), which deliberately gave the
 * filled `emphasis` pill to Notifications alone; the operator has now decided
 * every attention count gets it. The earlier per-row switch
 * (`attentionEmphasis`) is gone so the register cannot drift row by row again -
 * a call site passes a NUMBER, never a variant, class or cap.
 *
 * THE RULE THIS ENCODES (AGENTS.md design guidance): attention counts use this
 * shared accent badge; plain totals (a team's session count, a section's item
 * count, a search's match count) stay the subtle `ink-dim` numeral. A total is
 * a fact about size; an attention count is a request for the user's action, and
 * only the second earns the accent.
 *
 * WHAT IT IS. The `emphasis` Badge variant (`accent` fill, `on-accent` digit,
 * no border) at the `count` pill geometry - the Notifications badge's exact
 * size, weight and contrast, which `scripts/contrast-contract.mjs` row
 * "rail attention badge (emphasis)" asserts on every palette and rail ground.
 * The accent is a role, so each of the fifty-nine themes supplies its own.
 *
 * THE CAP IS 99 ("99+") INLINE, 9 ("9+") IN THE CORNER. `countLabel` leaves
 * the cap to the caller because it is a host geometry fact; every inline host
 * of this mark is a sidebar or rail row whose trailing column was sized for
 * three glyphs, and every corner host is the collapsed strip's 16px icon, so
 * both caps live here once, keyed on `placement`, instead of at each call site.
 * The accessible name is the caller's: a row states the exact number in its
 * own label, which is why the mark itself is usually inside an `aria-hidden`
 * span.
 *
 * `placement="corner"` is the collapsed strip's corner mark (#1083): 14px tall,
 * pinned by the host over the icon's top-end corner, so the glyph stays the
 * button's only in-flow content. `inline` is the expanded row's trailing mark.
 *
 * THE CORNER CAPS AT 9 ("9+"), NOT 99 (design follow-up to #1465, D1). On a 16px
 * icon a three-glyph `99+` mark (27.4px wide) covered the top 6px of the whole
 * glyph - 37.5 % of the Bell and the More ellipsis - so in the 56px strip the
 * row was recognisable only by its position. Two glyphs at most (~20px) keep the
 * mark a corner annotation rather than a lid. Nothing is lost: the strip control's
 * accessible name and tooltip state the exact number, and the expanded row keeps
 * the `99+` cap because its trailing column has the room.
 *
 * A count of zero or less draws nothing: a badge reading `0` would be a mark
 * that says nothing is being asked.
 *
 * THE QUIET REGISTER (`register="quiet"`) IS THE SECOND KIND OF COUNT, and it
 * exists so a host never reaches for a Badge variant itself (design review
 * round 1 on the Team Bridge unread work, D1). The rule above splits counts in
 * two: accent for ATTENTION, the subtle numeral for a TOTAL. A MUTED
 * conversation's unread is a total - it is shown so the reader can see it, and
 * deliberately kept out of the sidebar badge, because a mute is the reader
 * saying "do not interrupt me". Drawing it in the accent pill made the loudest
 * mark on the rail the one the badge had been told not to count, so a reader
 * reconciling the badge against the pills saw two accents beside a 0.
 *
 * The register is a SEMANTIC flag, not a style: what it changes is the variant
 * (`attentionQuiet`: borderless, `elevated` ground, `ink-dim` numeral), while
 * the geometry and the `99+` cap stay this component's - the call site still
 * passes a number and nothing else. `data-attention-register` states which
 * register was drawn, so a rendered test can classify the marks it sees rather
 * than re-reading the class names.
 */
export type AttentionBadgeProps = Omit<
	HTMLAttributes<HTMLSpanElement>,
	"children"
> & {
	count: number;
	placement?: "inline" | "corner";
	register?: "attention" | "quiet";
};

/** The digits the badge spells before it caps to `99+`. */
export const ATTENTION_BADGE_CAP = 99;

/** The collapsed strip's corner mark caps lower, to `9+` (see above). */
export const ATTENTION_BADGE_CORNER_CAP = 9;

export const AttentionBadge = forwardRef<HTMLSpanElement, AttentionBadgeProps>(
	(
		{
			count,
			placement = "inline",
			register = "attention",
			className,
			...props
		},
		ref,
	) => {
		if (!(count > 0)) return null;
		return (
			<Badge
				ref={ref}
				variant={register === "quiet" ? "attentionQuiet" : "emphasis"}
				shape="pill"
				size="count"
				data-attention-badge=""
				data-attention-register={register}
				className={cn(
					placement === "corner" && "h-3.5 min-w-3.5 px-0.75 leading-none",
					className,
				)}
				{...props}
			>
				{countLabel(
					count,
					placement === "corner"
						? ATTENTION_BADGE_CORNER_CAP
						: ATTENTION_BADGE_CAP,
				)}
			</Badge>
		);
	},
);
AttentionBadge.displayName = "AttentionBadge";
