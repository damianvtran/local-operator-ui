/**
 * What the desktop does with a routed `/compact`'s receipt, and what it does
 * when the pass declines.
 *
 * Both facts live here, apart from the dispatcher that uses them, for one
 * reason: they are the two halves of this command that have no other surface.
 * The receipt is the only thing the runtime says on the way out, and a DECLINE
 * says nothing at all — so these two decisions are the difference between a
 * command that reports and one that appears to do nothing, and both have to be
 * testable without a browser.
 */

/**
 * The terminal host's optimistic receipt for a pass that STARTS
 * (`session/runtime/serving.py:4652` returns exactly this `SlashResult`, ellipsis
 * character included).
 *
 * It is the ONE receipt `/compact` swallows: the working line and the settled
 * info line are the ported surfaces, and a note would announce the same thing a
 * third time. Keyed on this TEXT rather than on the notice's shape, because the
 * shape also describes the answers that must NOT be swallowed — a refusal the
 * runtime reports in the same tone was being dropped, which is the "a command
 * that appears to do nothing" failure this whole branch exists to avoid (review
 * round 1, R2; the guard for it is `scripts/compact-receipt.test.mjs`).
 */
export const COMPACT_START_NOTICE = "compacting context…";

/** Whether a receipt is that optimistic start notice, and nothing else. */
export function isCompactStartNotice(text: unknown): boolean {
	return typeof text === "string" && text.trim() === COMPACT_START_NOTICE;
}

/**
 * When a routed `/compact` re-reads the session's history tail, in
 * milliseconds after the receipt, and why there are exactly two.
 *
 * THE FINDING (UX round 2, U6 = QA round 2, Q2). A DECLINED pass writes a
 * durable `compaction_refused` row and emits no events, so the pane that asked
 * for it never learns anything: the composer empties, the transcript is
 * untouched and there is no dialog left to close. Both rounds measured zero
 * `/v1/desktop/sessions/*` requests in the window after the command, on an empty
 * pane and on one with history — so it is "never arrived", not "arrived and was
 * dropped" — while the durable row is readable at about 1.5 s and paints on the
 * next read.
 *
 * WHY TWO, AND WHY THESE. The runtime runs the attempt in a background task
 * after answering, and the refusal is written when that task finishes: measured
 * at 1.47 s from a routed command, so a single immediate read races it. The
 * first delay is therefore just past that measurement and the second is a
 * generous backstop for a busier machine; two reads is the bound, so a runtime
 * that never writes the row costs two cheap tail reads and nothing else. It is
 * NOT a polling loop: nothing is scheduled after the second read, and a read
 * that finds the outcome stops the schedule early.
 */
export const COMPACT_TAIL_READ_DELAYS_MS = [1500, 5000] as const;

/**
 * Ask for the tail at most twice, stopping as soon as the outcome is on screen.
 *
 * The stop condition is the whole point of the shape: `read` resolves true when
 * the page it applied carried a compaction outcome, so a pass that settled (or
 * declined) before the first delay costs exactly one read and a pass that
 * settled on the live channel costs two. A rejected read is not exceptional —
 * the rows already painted are still correct and the next delay is the retry —
 * and the caller is expected to fire this without awaiting it.
 *
 * `wait` is injectable so the schedule is testable without a clock.
 */
export async function refreshCompactionOutcome(
	read: () => Promise<boolean>,
	wait: (ms: number) => Promise<void> = (ms) =>
		new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
	for (const delay of COMPACT_TAIL_READ_DELAYS_MS) {
		await wait(delay);
		try {
			if (await read()) return;
		} catch {
			// Swallowed on purpose, and it is not a silent failure: this is a
			// best-effort read of a row that is already durable, the transcript on
			// screen is still correct without it, and the second delay is the retry.
		}
	}
}
