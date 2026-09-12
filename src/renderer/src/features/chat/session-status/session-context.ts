/**
 * The context reading: how full the window is, how to spell it, and how warm
 * the ring should be.
 *
 * ONE module owns this for the whole app, and like `session-cost.ts` it is a
 * port rather than a design. Sources, by symbol:
 *
 *   - `CONTEXT_COLOR_BANDS` (`local_operator/tui/widgets/status_line.py:555`)
 *   - `CONTEXT_COLOR_WINDOW_BANDS` (`status_line.py:562`)
 *   - `CONTEXT_COLOR_BASE` and `_CONTEXT_COLOR_RANK` (`status_line.py:578-582`)
 *   - `context_semantic_color` (`status_line.py:585-620`)
 *   - `context_spelling` and `CONTEXT_FORMS` (`status_line.py:623-660`)
 *   - `format_context_tokens` (`local_operator/session/frontend_state.py:3712`)
 *   - `format_window` (`local_operator/session/frontend_state.py:3729`)
 *
 * ## Why the colour is a union of two ladders
 *
 * Straight from `context_semantic_color`'s own reasoning. An ABSOLUTE token
 * ladder is what makes a very large window legible — re-sending 300k tokens
 * every request is slow and expensive whether the window is 1M or 200k, and a
 * purely proportional ramp would leave a 1M session looking calm at exactly
 * the size that costs most per turn. A PROPORTIONAL ladder is what makes a
 * small window legible, and without it the reading was inert on most models:
 * at 200k and below the absolute rungs are unreachable, so the ring would stay
 * calm through 100% full with compaction already overdue.
 *
 * Both are evaluated and the WARMER wins. `window <= 0` (unknown) falls back
 * to the absolute ladder alone, since a percentage needs a denominator — the
 * same rule the spelling follows.
 *
 * ## What would make this mirror wrong
 *
 * - Either band tuple changing its thresholds or its rungs. The fractions are
 *   set just under and at the compaction trigger's own `threshold_percent`
 *   default of 0.80, so moving that default without moving these leaves the
 *   top rung no longer coinciding with the pass becoming due.
 * - The comparison becoming `>=`. It is strictly greater-than on BOTH ladders
 *   so a value sitting exactly on a boundary keeps the calmer colour and a
 *   number hovering there does not flicker between two hues.
 * - `context_spelling` refusing a rounded `0%` differently. A child holding
 *   three thousand tokens is not holding none, so a sub-1% reading spells
 *   `<0.1%` rather than rounding to zero — the same refusal `format_cost`
 *   makes of a confident `$0.0000`.
 *
 * ## What this module does NOT port
 *
 * The TUI's `nodec` and `short` forms exist because its subagent ROWS are
 * cells narrower than its band. This app renders one reading in a tooltip with
 * room to spell it, so only `full` is ported; adding the other two without a
 * surface that needs them would be two spellings nobody compares.
 *
 * `scripts/session-status.test.mjs` asserts the ladders, the union, the
 * boundary behaviour and the spellings against the Python semantics.
 */

/**
 * The semantic rungs, warmest first — `_CONTEXT_COLOR_RANK`.
 *
 * The Python names ARE the palette's semantic roles in the TUI ("signal" is
 * its blue, "label" its purple, "danger" its red). This app's roles are named
 * differently, so the rungs carry their TUI names here and
 * `session-status-strip.tsx` maps each to a role — one mapping, stated once,
 * rather than the port quietly renaming a source symbol.
 */
export type ContextRung = "danger" | "label" | "signal";

/** `_CONTEXT_COLOR_RANK`: warmest-first, so a union resolves by index. */
const RANK: readonly ContextRung[] = ["danger", "label", "signal"];

/** `CONTEXT_COLOR_BASE`: the calm reading below every band. */
export const CONTEXT_COLOR_BASE: ContextRung = "signal";

/**
 * `CONTEXT_COLOR_BANDS`: absolute token counts, largest first.
 *
 * Absolute because the cost they warn about is absolute — 300k tokens is slow
 * and expensive to re-send whether the window is 1M or 200k.
 */
export const CONTEXT_COLOR_BANDS: readonly (readonly [number, ContextRung])[] =
	[
		[500_000, "danger"],
		[200_000, "label"],
	];

/**
 * `CONTEXT_COLOR_WINDOW_BANDS`: fractions of the window, applied as a UNION
 * with the absolute ladder above.
 */
export const CONTEXT_COLOR_WINDOW_BANDS: readonly (readonly [
	number,
	ContextRung,
])[] = [
	[0.8, "danger"],
	[0.55, "label"],
];

/**
 * `context_semantic_color(tokens, window)` — the warmer of the two ladders.
 *
 * `window <= 0` falls back to the absolute ladder alone. Both comparisons are
 * strictly greater-than; see the module header for why.
 */
export function contextSemanticColor(tokens: number, window = 0): ContextRung {
	let color: ContextRung = CONTEXT_COLOR_BASE;
	for (const [threshold, candidate] of CONTEXT_COLOR_BANDS) {
		if (tokens > threshold) {
			color = candidate;
			break;
		}
	}
	if (window > 0) {
		for (const [fraction, candidate] of CONTEXT_COLOR_WINDOW_BANDS) {
			if (tokens > window * fraction) {
				// Warmest wins: rank is warmest-first, so a lower index is warmer.
				if (RANK.indexOf(candidate) < RANK.indexOf(color)) color = candidate;
				break;
			}
		}
	}
	return color;
}

/**
 * `format_context_tokens`: `12.4k` / `1.2m` style, plain under 1k.
 *
 * Lower-case `m` here and capital `M` in `formatWindow` below is not a typo on
 * either side — it is the Python, where a MEASUREMENT and a LABEL are spelled
 * differently on purpose.
 */
export function formatContextTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return String(tokens);
}

/**
 * `format_window`: abbreviate the denominator — `1M`, `200k`.
 *
 * A whole window renders without a decimal, because the denominator is a
 * label rather than a measurement.
 */
export function formatWindow(window: number): string {
	if (window >= 1_000_000) {
		const scaled = window / 1_000_000;
		return scaled === Math.trunc(scaled)
			? `${scaled.toFixed(0)}M`
			: `${scaled.toFixed(1)}M`;
	}
	if (window >= 1_000) {
		const scaled = window / 1_000;
		return scaled === Math.trunc(scaled)
			? `${scaled.toFixed(0)}k`
			: `${scaled.toFixed(1)}k`;
	}
	return String(window);
}

/**
 * `context_spelling(tokens, window, form="full")`.
 *
 * Empty when there is nothing to report, so every caller's segment disappears
 * on the same test. A percentage needs a denominator: with no window the spend
 * is reported against an explicit unknown (`12.4k/—`) rather than against an
 * invented one.
 */
export function contextSpelling(tokens: number, window: number): string {
	if (tokens <= 0) return "";
	if (window <= 0) return `${formatContextTokens(tokens)}/\u2014`;
	const percent = (tokens / window) * 100;
	// A rounded `0%` over a non-zero reading is refused, for the same reason a
	// confident `$0.0000` over real spend is.
	if (percent < 0.05) return `<0.1%/${formatWindow(window)}`;
	return `${percent.toFixed(1)}%/${formatWindow(window)}`;
}

/** The four states a context reading can be in, named so the UI can branch. */
export type ContextStatus =
	/** No reading has arrived — a session that has not answered yet. */
	| "no-reading"
	/** Tokens are known, the window is not: a percentage is impossible. */
	| "window-unknown"
	/** Both known, and the tokens figure is the provider's settled receipt. */
	| "measured"
	/** Both known, and the tokens figure is the harness's own estimate. */
	| "estimate";

export type ContextReading = {
	status: ContextStatus;
	tokens: number | null;
	window: number | null;
	/** Occupancy in 0..1, or null when no percentage is possible. */
	fraction: number | null;
	/** The rung, from the union of the two ladders. */
	rung: ContextRung;
	/** `context_spelling`'s `full` form, or `""` when there is nothing to say. */
	spelling: string;
};

export type ContextInput = {
	context_tokens?: number | null;
	context_window?: number | null;
	context_is_estimate?: boolean | null;
	/**
	 * `max_context_window` off the effective `ModelSpec`, when the owner sends
	 * one. The reading is measured against the ACTIVE budget
	 * (`context_window`); this is carried only so the tooltip can name the
	 * model's ceiling when the two differ, which is the case a user reads as
	 * "why is my 1M model showing 200k".
	 */
	max_context_window?: number | null;
};

/**
 * One context reading, resolved from the canonical fields.
 *
 * Every unknown is a STATE rather than a zero: the ring renders an empty track
 * for `no-reading`, and `window-unknown` renders absolute tokens with no arc,
 * because an arc without a denominator is a fraction of nothing.
 */
export function contextReading(state: ContextInput): ContextReading {
	const rawTokens = state.context_tokens;
	const tokens =
		typeof rawTokens === "number" && Number.isFinite(rawTokens) && rawTokens > 0
			? rawTokens
			: null;
	const rawWindow = state.context_window;
	const window =
		typeof rawWindow === "number" && Number.isFinite(rawWindow) && rawWindow > 0
			? rawWindow
			: null;
	const rung = contextSemanticColor(tokens ?? 0, window ?? 0);
	if (tokens === null) {
		return {
			status: "no-reading",
			tokens: null,
			window,
			fraction: null,
			rung: CONTEXT_COLOR_BASE,
			spelling: "",
		};
	}
	if (window === null) {
		return {
			status: "window-unknown",
			tokens,
			window: null,
			fraction: null,
			rung,
			spelling: contextSpelling(tokens, 0),
		};
	}
	return {
		// The estimate marker is EXPLICIT rather than implied by a rounded
		// number: `context_is_estimate` is the owner's own statement about
		// whether the figure came from a provider receipt or from the harness's
		// count, and a user deciding whether to compact deserves to know which.
		status: state.context_is_estimate ? "estimate" : "measured",
		tokens,
		window,
		// Clamped so a saturated window cannot draw an arc past its own circle.
		// The NUMBER is not clamped: a reading over 100% is a real state and the
		// tooltip must still say so.
		fraction: Math.min(tokens / window, 1),
		rung,
		spelling: contextSpelling(tokens, window),
	};
}

/**
 * The lines the wheel's tooltip carries.
 *
 * The ring is one glyph and can only carry the rung; everything the reading
 * actually says lives here. Returned as lines rather than a sentence because
 * the tooltip renders the percentage at reading weight and the rest as
 * metadata, which a single string cannot express.
 */
export function contextTooltipLines(
	reading: ContextReading,
	maxWindow?: number | null,
): string[] {
	if (reading.status === "no-reading")
		return [
			"Context",
			"No reading yet. The first turn reports what the request carried.",
		];
	const lines: string[] = [];
	if (reading.status === "window-unknown") {
		lines.push(reading.spelling);
		lines.push(
			`${formatContextTokens(reading.tokens ?? 0)} tokens in use. The window this model allows is not known, so there is no percentage to show.`,
		);
		return lines;
	}
	const tokens = reading.tokens ?? 0;
	const window = reading.window ?? 0;
	lines.push(reading.spelling);
	lines.push(
		`${tokens.toLocaleString()} of ${window.toLocaleString()} tokens (${formatWindow(window)} window)`,
	);
	// Only when it DIFFERS: repeating the same number under a different label
	// reads as two facts and is one.
	if (typeof maxWindow === "number" && maxWindow > 0 && maxWindow !== window)
		lines.push(`Model maximum: ${formatWindow(maxWindow)}`);
	if (reading.status === "estimate")
		lines.push(
			"estimate - counted by the app, not reported by the provider yet",
		);
	return lines;
}
