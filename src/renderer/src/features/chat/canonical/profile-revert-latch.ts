/**
 * The profile-revert press latch: one action id is dispatched once, synchronously.
 *
 * WHY A LATCH AND NOT REACT STATE (QA round 1, Q2). The reproduced defect: two
 * presses in the same batch — a double click, or two rows for the same action —
 * both read the pre-render state and both sent an identical `sessions.answer`.
 * React state is a claim about the NEXT paint; a claim that must hold BEFORE the
 * first `await` needs a store that is written synchronously, which is what this
 * Set is. It is claimed before the request is built, never after it resolves.
 *
 * WHY MODULE SCOPE. The same action id can be reachable from more than one mounted
 * row (a transcript row and the approvals rail can describe one record). A latch
 * owned by a component would let the second mount send the same revert again, so
 * the guard lives with the module that dispatches.
 *
 * IT IS DELIBERATELY NOT PERSISTED. A reload starts a fresh process and a fresh
 * set; the backend's own receipt is what makes a spent action id answer nothing,
 * this only stops the duplicate the UI could produce inside one process.
 */

export type ProfileRevertLatch = {
	/**
	 * Claim an action id. `true` means THIS caller may dispatch; `false` means it
	 * was already claimed in this process and nothing may be sent.
	 */
	claim: (actionId: string) => boolean;
	/** Test-only visibility into what has been claimed. */
	has: (actionId: string) => boolean;
};

export function createProfileRevertLatch(): ProfileRevertLatch {
	const claimed = new Set<string>();
	return {
		claim: (actionId) => {
			if (!actionId) return false;
			if (claimed.has(actionId)) return false;
			claimed.add(actionId);
			return true;
		},
		has: (actionId) => claimed.has(actionId),
	};
}

/** The one latch the app's profile-revert dispatch uses. */
export const profileRevertLatch = createProfileRevertLatch();
