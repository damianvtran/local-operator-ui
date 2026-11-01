/** Synthetic transport only: cohort metadata motivates axes, never supplies bodies.
 * A frame is not a journal. Keep paging and readiness explicit so this experiment
 * cannot turn an unbounded journal into a purported backend response.
 */
export const POC1_CELLS = [
	{ name: "cold-short", cache: "cold" },
	{ name: "warm-short", cache: "warm" },
	{ name: "resident-reapply-2000", resident: 2000 },
	{ name: "user-512k", giant: "user" },
	{ name: "tool-512k", giant: "tool" },
	{ name: "manifest-16k", checkpoints: 16000 },
];
