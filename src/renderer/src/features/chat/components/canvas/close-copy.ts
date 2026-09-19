/**
 * THE CLOSE'S SENTENCE, in a module of its own so the suites can hold it to account.
 *
 * WHY IT IS SEPARATE. `close-report.ts` is the module that shows this sentence, and
 * it needs the toast channel and the canvas store - React and sonner - which a
 * headless suite cannot pull into its bundle. What the reader is told about words
 * that could not be saved is exactly the kind of copy a later edit moves by
 * accident, so the sentence lives where a test can read it: no imports here, and
 * `scripts/canvas-tab-close.test.mjs` asserts the words; the driven run
 * (`--scene canvas-freshness`) asserts the same sentence reaching the screen.
 *
 * WHAT IT SAYS, and why each clause is load-bearing (UX round 1, U1):
 *
 * - **"Closed <name>."** names what just happened, because the tab it happened to
 *   has gone by the time this is read.
 * - **"Your edits could not be saved"** is the state, not the outcome: the only
 *   reason this sentence exists is that the write was refused, failed or
 *   superseded, and a reader who is told "kept" without being told why will read it
 *   as "saved".
 * - **"kept until the app quits"** is the BOUNDARY. The words live in module state,
 *   so they survive the close and do not survive a quit; both other readings -
 *   "safe for good" and "gone" - are reasonable guesses at a silence.
 * - **"opening it again brings them back"** is the way back, which is the one thing
 *   the reader can act on, and it is true of this session only - which the clause
 *   before it has already said.
 */
export const keptWordsMessage = (title: string): string =>
	`Closed ${title}. Your edits could not be saved, and are kept until the app quits — opening it again brings them back.`;
