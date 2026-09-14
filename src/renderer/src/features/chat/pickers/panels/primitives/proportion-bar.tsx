import { cn } from "@shared/lib/utils";

/**
 * The share meter.
 *
 * Geometry and semantics are a port of the `/usage` provider meter, which is
 * the only one in the tree that has been measured in all twelve themes. The
 * three things it settled, and which this primitive therefore owns once rather
 * than once per panel:
 *
 * - **The track is `border-control`, not `hairline`.** Without a perceivable
 *   container the meter stops reading as a meter at BOTH extremes: `sunken` on
 *   `surface` measures 1.11:1 in the dark brand palette, so a 0% row drew a
 *   blank card and a 100% row a bare coloured rule with no container around it.
 *   This is the structural weight rather than the decorative one, because the
 *   track is the reference the fill is measured against.
 * - **An unmeasurable value gets a dotted rule, not an empty track.** An empty
 *   track is pixel-identical to a bar at zero, which is a claim that nothing
 *   was spent. The rule is `ink-dim` rather than `ink-disabled`: it is the
 *   whole distinction between "reports nothing" and "at zero", and
 *   `ink-disabled` is the one role exempt from a contrast floor.
 * - **A non-zero fraction always fills at least a sliver.** A bar that rounds
 *   1% away draws empty for something that has started spending, which is the
 *   one reading the bar exists to prevent.
 *
 * What it must not be: `Progress`. That widget animates its own datum and has
 * no unmeasurable state, and this datum is static — motion here would be
 * decoration on a number that is not changing.
 */

export type ProportionBarProps = {
	/** 0..1, or null when unmeasurable. Values outside 0..1 are clamped. */
	fraction: number | null;
	tone?: "accent" | "success" | "warning" | "danger";
	/** The track's width class, so every bar in one table shares a column. */
	className?: string;
	/** The text alternative; the bar itself is `aria-hidden`. */
	srLabel: string;
	/** `gauge` is the taller single-value form used by the context window. */
	size?: "row" | "gauge";
};

const FILL_CLASS: Record<NonNullable<ProportionBarProps["tone"]>, string> = {
	accent: "bg-accent",
	success: "bg-success",
	warning: "bg-warning",
	danger: "bg-danger",
};

export const ProportionBar = ({
	fraction,
	tone = "accent",
	className,
	srLabel,
	size = "row",
}: ProportionBarProps) => {
	const track = cn(
		"overflow-hidden rounded-xs border border-control bg-sunken",
		size === "gauge" ? "h-2" : "h-1.5",
	);
	if (fraction === null || Number.isNaN(fraction)) {
		// The dotted rule replaces the track entirely: an outlined empty track
		// would still read as a container holding nothing, which is the claim
		// this branch exists to refuse.
		return (
			<span className={cn("block w-24", className)}>
				<span
					className={cn("block border-ink-dim border-t border-dotted")}
					aria-hidden="true"
				/>
				<span className="sr-only">{srLabel}</span>
			</span>
		);
	}
	const clamped = Math.min(1, Math.max(0, fraction));
	const width = `${Math.max(clamped * 100, clamped > 0 ? 1 : 0)}%`;
	return (
		<span className={cn("block w-24", className)}>
			<span className={track} aria-hidden="true">
				<span
					className={cn("block h-full", FILL_CLASS[tone])}
					style={{ width }}
				/>
			</span>
			<span className="sr-only">{srLabel}</span>
		</span>
	);
};
