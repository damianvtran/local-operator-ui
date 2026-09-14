/**
 * The session's active processing time, as the status band spells it.
 *
 * ## Why this is a port and not a formatter
 *
 * `format_duration` is `local_operator/tui/widgets/tool_card.py:449`, and this
 * is the same function in TypeScript, domain for domain. The strip's other
 * three readings are each a documented port of a specific Python symbol for
 * the same reason: two spellings of one number is how a desktop app and a
 * terminal come to disagree about what the same session did.
 *
 * ## The two rules that look like details and are not
 *
 * **Bounded at six cells over the whole domain.** The widest strings are
 * `59m59s`, `23h59m` and `99d23h`; from a hundred days it is `100d+`. The
 * Python docstring records what an unbounded hours field cost there (a row
 * pushed past the terminal's edge, review round 15); here the bound is what
 * makes the reading affordable to render WHOLE at every width, which is the
 * premise of the design decision that duration is never truncated (D17).
 *
 * **A duration does not survive truncation.** `59m…` is not a number a reader
 * can reconstruct — `100h4m`, `100h40m` and `100h45m` all clip to the same
 * string — and this figure is load-bearing exactly when it is largest, because
 * "has this been running for days" is the question a clock exists to answer.
 * So the days branch is a branch rather than a clamp, and the cap says `100d+`
 * rather than `99d+`: a cap has to name the bound it actually fired at, or the
 * number appears to get smaller as it grows.
 */

/** Seconds in the units this splits on, named so the arithmetic reads. */
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

/**
 * `9s` / `41m1s` / `1h2m` / `4d5h`, bounded at six cells.
 *
 * Units are dropped once they stop carrying information: past an hour the
 * seconds are noise, and a whole minute is `5m` rather than `5m0s`. Sub-second
 * work renders as `0s` rather than vanishing, so a finished turn always leaves
 * a mark — the caller decides whether a turn HAPPENED (see `durationReading`),
 * and this decides how to spell one that did.
 */
export function formatDuration(seconds: number): string {
	const total = Math.trunc(
		Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
	);
	if (total < MINUTE) return `${total}s`;
	if (total < HOUR) {
		const minutes = Math.trunc(total / MINUTE);
		const secs = total % MINUTE;
		return secs ? `${minutes}m${secs}s` : `${minutes}m`;
	}
	if (total < DAY) {
		const hours = Math.trunc(total / HOUR);
		const minutes = Math.trunc((total % HOUR) / MINUTE);
		return minutes ? `${hours}h${minutes}m` : `${hours}h`;
	}
	const days = Math.trunc(total / DAY);
	// The cap, so the width is bounded BY CONSTRUCTION rather than by how large
	// anyone expected the input to get.
	if (days > 99) return "100d+";
	const hours = Math.trunc((total % DAY) / HOUR);
	return hours ? `${days}d${hours}h` : `${days}d`;
}

/** What the strip needs to render the reading, or `null` for "render none". */
export type DurationReading = {
	/** The banked seconds, before this render's open edge is added. */
	banked: number;
	/**
	 * The in-flight turn's start, as epoch MILLISECONDS for `Date.now()`, or
	 * `null` when no turn is running.
	 *
	 * Milliseconds rather than the wire's seconds because every clock in this
	 * app is `Date.now()`-based (`tool-row.tsx`'s row clock included), and one
	 * conversion at the edge is cheaper to keep right than two call sites doing
	 * it differently.
	 */
	startedAt: number | null;
};

/**
 * The reading's inputs, or `null` when there is nothing to show.
 *
 * `null` is returned for a session that has banked nothing and is running
 * nothing — a fresh session, and a draft, which is the same input and is why
 * the draft needs no branch of its own (D21). `0s` there would claim a turn
 * completed in under a second, which is the same kind of claim `$0.00` makes
 * about a session that has spent nothing.
 *
 * A session that is RUNNING is never `null`, even at zero banked seconds: work
 * is happening, and the reading appearing at the start of the first turn is
 * the point.
 */
export function durationReading(
	activeDurationS: number | null | undefined,
	activityStartedAt: number | null | undefined,
): DurationReading | null {
	const banked =
		typeof activeDurationS === "number" && Number.isFinite(activeDurationS)
			? Math.max(0, activeDurationS)
			: 0;
	const running =
		typeof activityStartedAt === "number" && Number.isFinite(activityStartedAt)
			? activityStartedAt
			: null;
	if (banked <= 0 && running === null) return null;
	// The wire carries epoch SECONDS (`FrontendSessionState.activity_started_at`).
	return { banked, startedAt: running === null ? null : running * 1000 };
}

/**
 * The tooltip's second line, and the sentence the `aria-label` carries.
 *
 * It names what the number is NOT, because that is the misreading available:
 * a figure beside a context window and a spend reads as "how long this
 * conversation has been open", and it is not — a conversation left open
 * overnight banks nothing.
 */
export const DURATION_EXPLANATION =
	"Time the agent has spent working in this conversation. Time waiting between turns is not counted.";

/**
 * The same fact, shorter, for the `aria-label`.
 *
 * Two strings rather than one because they are read in different conditions.
 * The tooltip is read at leisure beside the value it explains, so it can afford
 * the full sentence; the label is spoken in one breath after the number and is
 * re-read on every focus, so design decision 2.5 (D17) spells it with a
 * semicolon and no repetition. Keeping one string for both, which is what
 * round 2 shipped, makes the screen-reader case pay for the tooltip's leisure.
 */
export const DURATION_LABEL_EXPLANATION =
	"Time spent working; waiting is not counted.";
