/**
 * The one aggregate working line, at the foot of the transcript.
 *
 * The TUI's `WorkingBlock` (`tui/widgets/transcript.py:2410-2686`) is a single
 * row pinned under the last tool card: a braille spinner, the current ACTIVITY,
 * two spaces, then a clock in a reserved slot. This is that row.
 *
 * Three properties are load-bearing and each was got wrong by an earlier
 * design somewhere:
 *
 * 1. **It says what kind of work, not the word "working".** "thinking",
 *    "responding", the model's own stated intent, or `running N tools`. The
 *    label is derived from events the backend actually sends (`intent` rides
 *    `tool_execution_start`; a streaming assistant record is what "responding"
 *    means) rather than invented, because a narration the backend never sent is
 *    a claim the rows above it immediately contradict.
 * 2. **The clock times the PHASE, not the turn.** A batch shedding calls one by
 *    one keeps re-deriving its label, and restarting the clock on every label
 *    change would leave it permanently near zero — which is the one thing this
 *    row knows that nothing else on screen does. So it restarts only when the
 *    PHASE changes (`thinking` → `running` → `responding`), never merely
 *    because the phrase did.
 * 3. **No trailing ellipsis.** The clock already says it is ongoing, and a
 *    ticking number beside a "…" is the same fact twice.
 *
 * It must not restate a running tool row. That row shows the ARGUMENTS — what
 * actually ran — and its own execution time; this row shows the KIND of work
 * and the age of the phase. Two different facts, deliberately not the same
 * words.
 *
 * It is the QUIETEST thing on screen, not the loudest. The TUI reference the
 * operator sent is explicit that the working line sits below the rows in the
 * hierarchy, and it shipped inverted: the label was `ink-muted` (8.48:1)
 * against the tool summaries' `ink-dim` (5.46:1), and proportional against
 * their monospace, so it broke the machine-voice column the rows establish and
 * took first attention on every frame. It now matches the summaries in both ink
 * and typeface. Liveness is carried by the two things that MOVE — the spinner
 * and the clock — which is the correct channel for it: motion draws the eye
 * without a static word having to shout.
 *
 * Reduced motion: the spinner holds frame 0 and only the clock moves, which is
 * the TUI's own static behaviour (`_STATIC_FRAME_MS`). It is why the clock
 * carries liveness rather than the spinner — when the animation is gone, a
 * number that changes every second is all that is left saying the app is alive.
 *
 * That freeze is implemented HERE, in JS, and it has to be: the global cap in
 * `styles/index.css` bounds `animation-duration` and `transition-duration`, and
 * this spinner is neither. It is a `setInterval` swapping a text node, which no
 * media query can reach. The file previously claimed the CSS cap covered it,
 * and a reduced-motion user got the full 12.5fps cycle.
 */

import { useMediaQuery } from "@shared/hooks/use-media-query";
import { cn } from "@shared/lib/utils";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "./tool-row-model";

/**
 * The eight braille frames, the same tuple the TUI's status band, session
 * picker and subagent view all use (`transcript.py:2469`). Braille rather than
 * a rotating ring because it is one character wide, needs no accent, and reads
 * as motion rather than as a control — the app's `Spinner` is an affordance
 * that says "a request is in flight", and this is a state that says "the agent
 * is working", which is a different thing on a different rail.
 */
const SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"] as const;

/** 80ms per frame — 12.5fps, the TUI's `_SPIN_MS`. */
const SPIN_MS = 80;

/**
 * The clock ticks at 1Hz because it displays whole seconds; a faster interval
 * would repaint the row for a string that did not change.
 */
const CLOCK_MS = 1000;

export type WorkingLineProps = {
	/**
	 * What the agent is doing, in the user's terms and without an ellipsis:
	 * "thinking", "responding", the model's intent, or `running 3 tools`.
	 */
	activity: string;
	/**
	 * The phase this activity belongs to. The clock restarts when THIS changes
	 * and not when `activity` alone does — see (2) above. A batch of calls is
	 * one phase however many times its label is re-derived.
	 */
	phase: string;
	className?: string;
};

export const WorkingLine = ({
	activity,
	phase,
	className,
}: WorkingLineProps) => {
	const [frame, setFrame] = useState(0);
	const [elapsed, setElapsed] = useState(0);
	// Read in JS because the thing being suppressed is a JS timer. The Tailwind
	// variant carrying the same query is `motion-reduce:`, and the two have to
	// move together — but no variant can stop an interval.
	const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	// Wall-clock start of the phase, held in a ref so a re-render for a label
	// change (which happens on every tool settling in a batch) cannot reset it.
	const started = useRef(Date.now());
	const currentPhase = useRef(phase);
	if (currentPhase.current !== phase) {
		currentPhase.current = phase;
		started.current = Date.now();
		// Render the new phase at 0s rather than one tick late: the first frame
		// of a phase is the one a reader is most likely to be looking at.
		setElapsed(0);
	}

	useEffect(() => {
		// The clock runs in both modes: it is the liveness channel that survives
		// the spinner being frozen, and it changes a number rather than animating.
		const clock = window.setInterval(
			() => setElapsed(Math.floor((Date.now() - started.current) / 1000)),
			CLOCK_MS,
		);
		if (reduceMotion) {
			// Hold frame 0 rather than wherever the cycle happened to be when the
			// preference changed, so the static state is the same glyph every time.
			setFrame(0);
			return () => window.clearInterval(clock);
		}
		const spin = window.setInterval(
			() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
			SPIN_MS,
		);
		return () => {
			window.clearInterval(spin);
			window.clearInterval(clock);
		};
	}, [reduceMotion]);

	return (
		<div
			className={cn("flex items-center gap-2", className)}
			data-lo-working-line={true}
			// One live region for the whole turn, `polite` so it does not
			// interrupt: a screen reader user gets "running 3 tools" once when the
			// phase changes, not the clock read out every second — which is why the
			// clock and the spinner are both `aria-hidden` inside it.
			//
			// `aria-live` alone rather than `role="status"`: the role is the
			// shorthand for exactly this attribute, and on a `div` it is also what
			// `useSemanticElements` flags. One of the two is redundant, and the
			// attribute is the one that says what it does.
			aria-live="polite"
		>
			<span
				aria-hidden={true}
				className={cn(
					// `ink-muted` rather than `ink-dim`: at 12px the animated portion of
					// a braille cell measures 4x10px, which read as a speck beside the
					// label rather than as motion. Motion is the channel that should
					// draw the eye here — the label is deliberately quiet — so the one
					// moving element is the one that gets the weight.
					"w-[1ch] shrink-0 select-none font-mono text-ink-muted text-mono-sm",
				)}
			>
				{SPINNER_FRAMES[frame]}
			</span>
			<span
				className={cn("min-w-0 truncate font-mono text-ink-dim text-mono-sm")}
			>
				{activity}
			</span>
			<span
				aria-hidden={true}
				className={cn(
					// Reserved slot, so the label beside it does not shift as the
					// clock grows from `9s` to `1m57s` — the TUI reserves eight cells
					// for exactly this and the widest string it can hold is six.
					"w-[6ch] shrink-0 font-mono text-ink-dim text-mono-sm tabular-nums",
				)}
			>
				{formatDuration(elapsed)}
			</span>
		</div>
	);
};
