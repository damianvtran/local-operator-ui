/**
 * One status move, as a function of its dependencies.
 *
 * WHY THIS IS A MODULE AND NOT INLINE IN THE PAGE (agent review F3; UX round 1,
 * U1, both reproduced against the installed react-query): the board shares one
 * `useUpdateProject` observer, and `mutate(vars, { onSuccess, onError })`
 * callbacks live on the OBSERVER - a second overlapping call displaces the
 * first call's callbacks, so the earlier move's refusal or success was never
 * surfaced. "A move that did not happen is never silent" has to hold PER CALL,
 * and a per-call outcome is a thing that can be tested without a DOM: this
 * function is the whole decision, and `projects-page.tsx` only wires it to the
 * toast, the dialog and the focus hand-off.
 *
 * The caller owns everything side-effectful - the PATCH itself, the busy
 * signal, the question slot, the toasts - so this stays a pure orchestration
 * over injected deps, and the tests drive it with deferred promises to
 * reproduce the overlap deterministically.
 */

import { type DoneGateRefusal, doneGateToastCopy } from "./project-model";
import { doneGateRefusalOf, projectMoveErrorCopy } from "./project-refusals";

/** What one finished move amounts to, for the caller to speak or act on. */
export type StatusMoveOutcome =
	/** The daemon accepted the PATCH. */
	| { kind: "moved" }
	/** The done-gate refusal, and this daemon can honour a forced close. */
	| { kind: "question"; refusal: DoneGateRefusal }
	/** Everything else: the sentence belongs in a toast. */
	| { kind: "spoken"; copy: string; refusal: DoneGateRefusal | null };

export type StatusMoveInput = {
	/** Send the PATCH: the caller's `update.mutateAsync`, unbound. Never rejects
	 * for a refusal - it does, and this function catches it. */
	move: () => Promise<unknown>;
	/** The daemon advertises `projects_force_done` (the capability gate). */
	forceDoneOffered: boolean;
	/**
	 * CLAIMS the single question slot and reports whether the claim landed,
	 * in ONE synchronous call (agent review R2-1). The check and the claim
	 * must be the same operation: two refusals can settle in one microtask
	 * checkpoint, and a caller that only CHECKS here and claims later (in its
	 * own `.then`) lets both decisions read an unclaimed slot - the second
	 * question then overwrites the first and the first refusal goes silent.
	 */
	claimQuestion: () => boolean;
};

/** How a failure is classified, for the two branches the caller renders. */
export async function runStatusMove(
	input: StatusMoveInput,
): Promise<StatusMoveOutcome> {
	try {
		await input.move();
		return { kind: "moved" };
	} catch (error) {
		const refusal = doneGateRefusalOf(error);
		/*
		 * The question needs BOTH halves: the coded refusal (an older daemon
		 * would 422 the forced retry, so its sentence-only refusal is spoken,
		 * never offered a force) and the capability that says this daemon can
		 * answer it. The slot is CLAIMED HERE, synchronously with the decision
		 * (R2-1): a claim deferred to the caller's reaction loses a same-tick
		 * second refusal.
		 */
		if (refusal?.coded && input.forceDoneOffered && input.claimQuestion())
			return { kind: "question", refusal };
		return {
			kind: "spoken",
			// The done-gate sentence is capped like the dialog's (UX round 1,
			// U4); every other refusal keeps the route's own words.
			copy: refusal ? doneGateToastCopy(refusal) : projectMoveErrorCopy(error),
			refusal,
		};
	}
}
