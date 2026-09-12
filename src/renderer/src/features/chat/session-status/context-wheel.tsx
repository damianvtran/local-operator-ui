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

export type ContextWheelProps = {
	reading: ContextReading;
	className?: string;
};

export const ContextWheel: FC<ContextWheelProps> = ({ reading, className }) => {
	// `no-reading` and `window-unknown` both draw the track alone: without a
	// denominator there is no fraction to sweep, and sweeping a guessed one is
	// the invented-window lie `context_spelling` refuses in words.
	const fraction = reading.fraction;
	return (
		<svg
			width={SIZE}
			height={SIZE}
			viewBox={`0 0 ${SIZE} ${SIZE}`}
			className={cn("shrink-0", className)}
			aria-hidden="true"
			focusable="false"
		>
			<title>Context window usage</title>
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
				className="stroke-control"
			/>
			{fraction !== null && fraction > 0 && (
				<circle
					cx={SIZE / 2}
					cy={SIZE / 2}
					r={RADIUS}
					fill="none"
					strokeWidth={STROKE}
					strokeLinecap="round"
					strokeDasharray={CIRCUMFERENCE}
					strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
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
