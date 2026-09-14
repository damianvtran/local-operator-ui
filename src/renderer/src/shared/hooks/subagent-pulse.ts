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
		const jobId = subagentPulseJobId(event);
		if (!jobId) continue;
		pulses[jobId] = (pulses[jobId] ?? 0) + 1;
	}
	return pulses;
};

/**
 * Which child one event is a beat for, or `null` when it is not a beat at all.
 *
 * The whole membership and identity rule in one place, because it is called from
 * two: the snapshot seed above and the live step below. Two copies of "is this a
 * pulse, and whose" is exactly the drift that lets a call site filter on a
 * slightly different set from the module's own.
 */
export const subagentPulseJobId = (event: unknown): string | null => {
	if (!event || typeof event !== "object") return null;
	const record = event as Record<string, unknown>;
	if (!SUBAGENT_PULSE_EVENTS.has(String(record.type ?? ""))) return null;
	return typeof record.job_id === "string" && record.job_id
		? record.job_id
		: null;
};

/**
 * The live half: one event applied to the pulse map.
 *
 * This is the function `use-canonical-session.ts` calls per stream event, and it
 * exists so that the WIRING is pinned rather than only the arithmetic. The
 * earlier split exported `bumpSubagentPulse` alone, which a test can bind by
 * value while the hook's own call-site filter drifts — the reviewer's nit in
 * round 2 (N-3): nothing failed if the snapshot stopped SEEDING or the live
 * branch filtered on a different event set. Here the event set, the id rule and
 * the bump are all reached through one exported step, and
 * `scripts/subagent-pulse.test.mjs` asserts its output by value.
 *
 * Identity is preserved when the event is not a beat: a frame that carries no
 * subagent event must not cost a render or a refetch, and returning a fresh
 * object would make every unrelated frame look like a change to the reader.
 */
export const applySubagentPulse = (
	pulses: Readonly<Record<string, number>>,
	event: unknown,
): Readonly<Record<string, number>> => {
	const jobId = subagentPulseJobId(event);
	return jobId ? bumpSubagentPulse(pulses, jobId) : pulses;
};
