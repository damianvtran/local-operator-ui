/**
 * A byte count in the units a person reads: whole KB, one decimal in MB and GB.
 *
 * ONE SPELLING FOR THE SURFACES THAT STATE A SIZE: the message-budget
 * refusals and the update download's progress line, which used to print
 * `21504 KB of 21504 KB` for a bundle a person would call "21.5 MB" (issue
 * #660). Whole KB below a megabyte, one decimal in MB and GB, each rung
 * starting at its own 999_500 so a value the NEXT rung would round to 1000 is
 * never printed as `1000 KB` beside a `1.0 MB` that means the same size.
 *
 * WHY DECIMAL UNITS (1000s), stated because the repository also carries binary
 * spellings and this choice is load-bearing: these are the units a person
 * reads off a Finder window, and they are the units the budgets behind the
 * refusal sentences are expressed in (`DESKTOP_MESSAGE_BUDGET_BYTES` is a
 * decimal figure), so `KB` against a 1024 divisor would print one size at two
 * different numbers in two sentences of the same app. The surfaces that DO
 * reason in binary state their own units where their numbers are read: the
 * installer's logs (`update-install.ts`, MiB/GiB) and the tool-output counter
 * (`tool-row-model.ts::formatBytes`, a port of the terminal UI's spelling).
 *
 * PRECISION BEYOND ONE DECIMAL IS NOISE in a sentence whose job is "roughly
 * this much", and an exact count belongs where a reader who wants one goes:
 * the download row's tooltip (grouped, so the digits are readable; review
 * round 1, D6/U6) and the installer's logs.
 *
 * A leaf module with no imports on purpose: the message-budget suite bundles
 * it (`scripts/desktop-renderer-transport.test.mjs`) and the storybook builds
 * import it from the components that render sizes, so nothing it needs may
 * drag a component graph in with it.
 */

/**
 * Format `bytes` for display.
 *
 * The 999_500 rungs are not round numbers by accident: `Math.round(999_500 /
 * 1000)` is 1000, so a rung that escalated at 1_000_000 would print "1000 KB"
 * for a value the megabyte branch then also prints as "1.0 MB" - a ladder of
 * 999 KB -> 1000 KB -> 1.0 MB where the middle rung is a unit that appears
 * nowhere else (review round 1, F7, on the refusal sentence's only number).
 * Rounding up to "1.0 MB" is what a person expects. The GB rung extends the
 * same rule rather than inventing a second one: 999.5 MB rounds to "1000 MB"
 * without it, and #660's bundles are tens of megabytes today with GB-sized
 * artefacts one rung away.
 *
 * GB IS THE TOP RUNG, and that is a decision rather than an oversight (review
 * round 1, R-3): there is no TB rung, so a value large enough to round to
 * "1000.0 GB" - 999_950_000_000 and up - prints exactly that rather than
 * escalating to a unit no sentence in this app names. The never-print-1000
 * rule exists so one size does not get TWO spellings; with no successor there
 * is no second spelling, so the rule has nothing to resolve. (Nothing that
 * reaches this formatter is within three orders of magnitude of it: the
 * largest readouts are update artefacts in the tens of megabytes, next to
 * budgets smaller still.)
 */
export function formatByteSize(bytes: number): string {
	if (bytes >= 999_500_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	if (bytes >= 999_500) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	return `${Math.round(bytes / 1000)} KB`;
}
