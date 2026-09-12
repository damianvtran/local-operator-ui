import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import type { ContextReading, ContextRung } from "./session-context";

/**
 * The context wheel: one ring saying how full the window is.
 *
 * A ring rather than a bar because this is a FRACTION of a fixed budget, not
 * progress toward a finish. `Progress` is the app's bar and it is the wrong
 * instrument here — a bar implies a task completing, and a full context window
 * is not an accomplishment. A ring at control scale also costs 16px of a
 * toolbar rather than a full row, which is what lets the reading sit beside
 * the model and the spend instead of competing with them.
 *
 * ## Colour
 *
 * The rung comes from `session-context.ts`, which mirrors the TUI's
 * `context_semantic_color`. That function names the TUI palette's own
 * semantics — `signal` (blue) for the calm reading, `label` (purple) for a
 * context worth noticing, `danger` (red) for one at or past the point where
 * compaction is due. This app's palette contract has no `label` role, so the
 * three map onto the three semantics that carry the same MEANINGS here:
 *
 *   signal -> `info`     "here is a fact", the neutral reading
 *   label  -> `warning`  worth noticing, with headroom left
 *   danger -> `danger`   at or past the compaction trigger
 *
 * Naming the mapping in one place is the point. A component that reached for
 * a hue directly would be the second source of truth this system exists to
 * prevent, and the TUI's rung names are kept in the model file so the port can
 * be asserted against the Python without either side renaming a symbol.
 *
 * ## Colour is never the only channel
 *
 * The arc's LENGTH carries the reading on its own, which is what makes the
 * wheel legible to a user who cannot separate the three hues — the same rule
 * the tool rows follow, where an outcome is a tick, a cross or a slashed
 * circle and tint is only the second channel. The tooltip spells the number
 * out in full, and the `aria-label` carries it for a screen reader.
 */

/** TUI rung -> this palette's semantic. See the header for the mapping. */
const RUNG_STROKE: Record<ContextRung, string> = {
	signal: "stroke-info",
	label: "stroke-warning",
	danger: "stroke-danger",
};

/**
 * Geometry. 14px box, 1.75px stroke, so the ring sits between the 12px and
 * 16px icon steps and matches the stroke weight of the lucide glyphs beside
 * it (lucide's default 2 on a 24px grid renders at 1.17px at 14px; a ring has
 * no interior detail to lose, so it holds a touch more).
 *
 * The radius is inset by half the stroke so the ring's OUTER edge lands on the
 * box, rather than half the stroke hanging outside it and clipping.
 */
const SIZE = 14;
const STROKE = 1.75;
const RADIUS = SIZE / 2 - STROKE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/**
 * The smallest arc the ring will draw for a non-zero reading.
 *
 * 6% of 38.5px is 2.3px of travel past the 1.75px cap, which is the point at
 * which a sweep is visible as a sweep rather than as the cap alone.
 */
const MIN_DRAWN_FRACTION = 0.06;

export type ContextWheelProps = {
	reading: ContextReading;
	className?: string;
};

export const ContextWheel: FC<ContextWheelProps> = ({ reading, className }) => {
	// `no-reading` and `window-unknown` both draw the track alone: without a
	// denominator there is no fraction to sweep, and sweeping a guessed one is
	// the invented-window lie `context_spelling` refuses in words.
	const fraction = reading.fraction;
	const hasArc = fraction !== null && fraction > 0;
	/*
	 * What gets DRAWN, floored so that "some" never renders as "none".
	 *
	 * At r = 6.125 the circumference is 38.5px, so a real 3.4% reading is a
	 * 1.31px arc under a 1.75px round cap - the cap is wider than the arc it
	 * terminates, and the ring was pixel-for-pixel indistinguishable from the
	 * empty one (4 coloured pixels of 90 inked, against 0; design round 1, D4).
	 * An honest-unknown state that looks identical to a real low reading is the
	 * same honesty failure the wheel exists to avoid, with the arguments
	 * reversed.
	 *
	 * The floor is on the DRAWING only. The percentage beside it, the tooltip
	 * and the aria-label all carry the unclamped number, exactly as the
	 * saturated case already documents for the other end of the scale: the
	 * geometry is a second channel for a reading the text states precisely.
	 */
	const drawnFraction = hasArc ? Math.max(fraction, MIN_DRAWN_FRACTION) : 0;
	return (
		<svg
			width={SIZE}
			height={SIZE}
			viewBox={`0 0 ${SIZE} ${SIZE}`}
			className={cn("shrink-0", className)}
			aria-hidden="true"
			focusable="false"
		>
			{/*
			 * The track is `border-control`, not `hairline`.
			 *
			 * With no reading yet the track is the wheel's ONLY mark, so it is the
			 * sole visual boundary of the control and takes the structural role
			 * with its 3:1 floor on all four grounds. A hairline here is exactly
			 * the conflation docs/branding.md § 2 names: it would leave the empty
			 * wheel bounded at around 1.2:1, which is a control with no edge.
			 */}
			<circle
				cx={SIZE / 2}
				cy={SIZE / 2}
				r={RADIUS}
				fill="none"
				strokeWidth={STROKE}
				/*
				 * The track's ROLE depends on whether an arc is over it, because
				 * its job does.
				 *
				 * With no arc, the track is the control's sole boundary and must
				 * clear the 3:1 structural floor against every ground it renders on
				 * - which is `surface` AND the reading button's `accentWash` hover.
				 * `borderControl` cleared the first (3.65:1 worst) and failed the
				 * second on iceberg at 2.89:1 (design round 1, D6), so the empty
				 * track takes `inkDim`: the same role the inert reading's text
				 * already uses, and 5.11:1 / 4.49:1 worst-case on the two grounds.
				 *
				 * With an arc, the boundary that carries the reading is arc against
				 * TRACK, not track against ground: "how far has it swept" is read by
				 * seeing where the arc ends. At `borderControl` that pair measured
				 * 1.05:1 on neon and 1.46-1.58:1 in the two brand themes - an arc
				 * and a track of near-identical luminance (design round 1, D1). The
				 * track therefore recedes to `sunken`, which is § 2's named role for
				 * a track and lifts the same pair to 4.59-8.52:1.
				 *
				 * No single value satisfies both: a track 3:1 from the arc AND 3:1
				 * from the ground needs about 9:1 between arc and ground, and the
				 * best theme here has 7.33:1 (measured across all twelve). Since the
				 * populated ring's own arc clears 4.65:1 against the ground, the
				 * control keeps a perceivable edge either way, so switching is the
				 * option that satisfies every floor that is reachable at all rather
				 * than trading one failure for another.
				 */
				className={cn(hasArc ? "stroke-sunken" : "stroke-ink-dim")}
			/>
			{hasArc && (
				<circle
					cx={SIZE / 2}
					cy={SIZE / 2}
					r={RADIUS}
					fill="none"
					strokeWidth={STROKE}
					strokeLinecap="round"
					strokeDasharray={CIRCUMFERENCE}
					strokeDashoffset={CIRCUMFERENCE * (1 - drawnFraction)}
					// Starts at twelve o'clock and sweeps clockwise, which is how
					// every dial a reader has met behaves. An SVG circle starts at
					// three o'clock, so the rotation is geometry and not decoration.
					transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
					className={cn(RUNG_STROKE[reading.rung])}
				/>
			)}
		</svg>
	);
};
