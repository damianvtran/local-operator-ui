/**
 * The per-child pulse: what the run panel's reader follows (`docs/run-sidebar.md`
 * § 5.3).
 *
 * Its own module rather than three lines inside `use-canonical-session.ts`, and
 * the reason is testability rather than tidiness. The reader's cadence is driven
 * by this counter changing — a tail read per beat, coalesced to at most 1 Hz,
 * stopping when the child settles — so the two rules that matter here are (a)
 * WHICH events count as a beat and (b) what a snapshot seeds, and both are pure
 * functions of wire shapes. Inside the hook they could only be asserted by
 * mounting React; here `scripts/subagent-pulse.test.mjs` bundles this module and
 * asserts them directly, against the same source the app runs.
 *
 * The hook keeps the state and the effects; this owns the arithmetic.
 */

/**
 * The three events that mean "this child's durable transcript may have grown".
 *
 * `subagent_start` and `subagent_end` bracket the child's life and
 * `subagent_progress` fires on tool starts/ends and message ends — the same
 * boundaries `harness/comms.py:1121-1145` writes the file at, which is why the
 * pulse is the right signal and a stream delta would not be.
 */
export const SUBAGENT_PULSE_EVENTS = new Set([
	"subagent_start",
	"subagent_progress",
	"subagent_end",
]);

/** One more beat for a child, preserving the map's identity when nothing moved. */
export const bumpSubagentPulse = (
	pulses: Readonly<Record<string, number>>,
	jobId: string,
): Record<string, number> => ({
	...pulses,
	[jobId]: (pulses[jobId] ?? 0) + 1,
});

/**
 * Seed the per-child pulses from a snapshot's retained live events.
 *
 * A COUNT rather than a flag, because the reader's cadence is driven by change
 * (`§ 5.3`): two beats that arrive inside one coalesced frame are one refetch, and
 * a boolean could not say whether anything happened at all between two polls.
 * Events without a `job_id` are skipped — the taxonomy gives every subagent event
 * one (`harness/types.py:1557-1602`), and a pulse filed under `""` would be a key
 * no reader can match to a child.
 *
 * SEEDING rather than merging on a snapshot is the caller's rule and the one
 * consequence worth stating here: a count is meaningful only against the snapshot
 * it was counted from, so the pulses this returns replace whatever the previous
 * snapshot's were.
 */
export const seedSubagentPulses = (
	liveEvents: unknown,
): Record<string, number> => {
	const pulses: Record<string, number> = {};
	if (!Array.isArray(liveEvents)) return pulses;
	for (const event of liveEvents) {
		if (!event || typeof event !== "object") continue;
		const record = event as Record<string, unknown>;
		if (!SUBAGENT_PULSE_EVENTS.has(String(record.type ?? ""))) continue;
		const jobId = typeof record.job_id === "string" ? record.job_id : "";
		if (!jobId) continue;
		pulses[jobId] = (pulses[jobId] ?? 0) + 1;
	}
	return pulses;
};
