/**
 * How the transcript draws a settled turn: the reader's choice, the default,
 * and the one place a stored value is judged (issue #756).
 *
 * WHY A MODULE RATHER THAN A FIELD AND AN INLINE CHECK. The mode is read by
 * three surfaces — the collapse plan that partitions a run, the Appearance
 * control in Settings, and the conversation menu the reader finds it in — and
 * `localStorage` is not the setter's path out: zustand's persist middleware
 * rehydrates PAST the setters, so a value written by an older build, by hand, or
 * by a future build that renamed a token arrives unvalidated. The module is the
 * single place that answers "what is this token?", the pattern
 * `chat-sidebar-view.ts`'s `parseSidebarView` and `sidebar-split.ts`'s
 * `parseSidebarRegions` already set for the same reason.
 *
 * THE TWO MODES, in the vocabulary `turn-segments.ts` uses:
 *
 * - `by-turn` (the default) is the shipped condensation: a settled run keeps
 *   only the rows its visibility invariant requires — the response closes, the
 *   run's last close, the reader's own rows, the `stop`-declared rows and the
 *   pinned markers — and hides the rest behind per-span bars.
 * - `by-response` widens that visible set to EVERY settled text-bearing row, so
 *   a turn that answered, was continued past, and answered again shows both
 *   answers in place, with the turn's elected answer still the one row the
 *   caption and the foot key on. The tool work between responses still
 *   condenses, so this is the TUI's register (everything the agent said, the
 *   final response identifiable) rather than an undifferentiated wall.
 *
 * WHAT IT IS NOT: it never reorders rows, never reshapes the visibility
 * invariant, and never elects a second answer. `by-turn` must behave
 * byte-for-byte as it did before this module existed; see `partitionRun`.
 */

/** How a settled turn's transcript rows are drawn. */
export type TranscriptDisplayMode = "by-turn" | "by-response";

/** The shipped mode: today's condensation, and the fallback for anything else. */
export const DEFAULT_TRANSCRIPT_DISPLAY_MODE: TranscriptDisplayMode = "by-turn";

/**
 * Every mode, in the order the control draws them, with the label the reader
 * sees. Exported so the settings row and the conversation menu cannot disagree
 * about what the modes are called or which order they read in.
 */
export const TRANSCRIPT_DISPLAY_MODE_OPTIONS: readonly {
	value: TranscriptDisplayMode;
	label: string;
}[] = [
	{ value: "by-turn", label: "By turn" },
	{ value: "by-response", label: "By response" },
];

/**
 * Judge a stored or hand-built value, answering the default for anything that is
 * not a mode this build knows.
 *
 * UNKNOWN IS THE DEFAULT, deliberately, rather than an error: a token from a
 * build that renamed one, a tampered blob, or a value a fixture forgot must all
 * land on the shipped behaviour — the same "unknown is absent" rule
 * `reportsCompletedThought` states for a missing `stopReason`, and the reason
 * this is a narrowing function rather than a cast.
 */
export function parseTranscriptDisplayMode(
	value: unknown,
): TranscriptDisplayMode {
	for (const option of TRANSCRIPT_DISPLAY_MODE_OPTIONS) {
		if (value === option.value) return option.value;
	}
	return DEFAULT_TRANSCRIPT_DISPLAY_MODE;
}

/** The label for a mode, for prose that names the active one (never undefined). */
export function transcriptDisplayModeLabel(
	mode: TranscriptDisplayMode,
): string {
	return (
		TRANSCRIPT_DISPLAY_MODE_OPTIONS.find((option) => option.value === mode)
			?.label ?? TRANSCRIPT_DISPLAY_MODE_OPTIONS[0].label
	);
}
