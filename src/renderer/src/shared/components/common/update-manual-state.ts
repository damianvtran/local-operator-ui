/**
 * The version rules the update notices decide by, kept out of the component.
 *
 * Pure TypeScript with no React or DOM imports, so `pnpm test:desktop` bundles
 * this file directly and drives the rules (the same way the transcript reducer
 * is driven). That matters here because these rules decide whether a by-hand
 * instruction stays on screen, and that behaviour has been wrong twice - the
 * panel used to stay up after a successful upgrade (review U2), and then could
 * not clear at all for a source build (review U12) - neither time from a
 * rendering bug, and both times only reachable by clicking through the app.
 */

/** A version tag's leading `v`, which the app and the server do not agree on. */
const LEADING_V = /^v/i;

/**
 * Is `version` at or beyond `target`?
 *
 * The offer and the by-hand panel both clear when the server is no longer
 * BEHIND the version they named, and they used to require an exact match - so a
 * release that moved on between the offer and the check left the notice
 * instructing the user to do what they had just done (review U12). Dotted
 * numerics compared numerically; a pre-release suffix on either side that is not
 * an exact match counts as "not beyond", which keeps the instruction on screen
 * rather than clearing over a real gap.
 */
export const atLeastVersion = (version: string, target: string): boolean => {
	const strip = (value: string) => value.trim().replace(LEADING_V, "");
	const reported = strip(version);
	const wanted = strip(target);
	if (reported === wanted) return true;
	if (reported.includes("-") || wanted.includes("-")) return false;
	const left = reported.split(".").map(Number);
	const right = wanted.split(".").map(Number);
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const a = left[index] ?? 0;
		const b = right[index] ?? 0;
		if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
		if (a > b) return true;
		if (a < b) return false;
	}
	return true;
};

/**
 * What the by-hand panel is waiting for.
 *
 * Both facts travel in the manual-required event - the version it named and
 * whether the install follows this machine's checkout - because the panel's own
 * copy tells the user to run a command and check again, and the panel has to be
 * able to tell when that is done.
 */
export type ManualUpdateExpectation = {
	/** The version the panel named, or null when it could not name one. */
	target: string | null;
	/** True when the install follows a source tree rather than the release. */
	sourceBuild: boolean;
};

/**
 * Does a check's answer complete the by-hand instruction?
 *
 * `reported` is the server version that answer is about: the running version for
 * an "an update is available" answer (the panel named a version it wants the
 * server to REACH, and the published release moving on meanwhile must not keep
 * the panel up), or the running version for a "nothing newer" answer.
 *
 * A source build is the one case the version cannot decide: the panel has said
 * its version is the checkout's rather than the release's, so no answer to any
 * version check will ever equal the version it named - and a release newer than
 * the one it named is the same gap seen from the other side. The check the user
 * asked for therefore ends the instruction on its own (review U12, round 3).
 *
 * A panel that named no version cannot be satisfied here: with something still
 * newer available there is work left to do, so it stays up rather than clearing
 * on a check that proves nothing about it.
 */
export const manualPanelClearedByCheck = (input: {
	/** The server version the check reported, when it reported one. */
	reported?: string | null;
	expectation: ManualUpdateExpectation;
}): boolean => {
	const { target, sourceBuild } = input.expectation;
	if (sourceBuild) return true;
	if (target == null) return false;
	return input.reported != null && atLeastVersion(input.reported, target);
};

/**
 * Does an "an update is available" answer end the by-hand instruction?
 *
 * Only when the check was the user's own. The producer marks the answers to a
 * check the user asked for (`manual`), because the periodic 5-minute check and
 * the start-up check must not dismiss a panel out from under the reader - and
 * unlike the "nothing newer" answer, which is only ever sent for a check the
 * user asked for, this one is sent for both (review U12, round 3).
 */
export const manualPanelClearedByAvailable = (input: {
	/** True when this answer is the answer to a check the user asked for. */
	manual?: boolean;
	/** The version the server is running now. */
	currentVersion?: string | null;
	expectation: ManualUpdateExpectation;
}): boolean =>
	input.manual === true &&
	manualPanelClearedByCheck({
		reported: input.currentVersion,
		expectation: input.expectation,
	});
