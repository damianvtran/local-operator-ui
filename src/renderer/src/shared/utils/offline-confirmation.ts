/**
 * How many negative readings, and how far apart, before the app says offline.
 *
 * WHY A NEGATIVE READING IS NOT EVIDENCE ON ITS OWN. Chromium fires `offline`
 * on any connectivity TRANSITION - a Wi-Fi roam between access points, a
 * wake from sleep, a resolver switching - while traffic is still flowing, and
 * `navigator.onLine` answers about the local interface rather than about the
 * network behind it. Measured on this machine's own update log: 90 transport
 * failures over four days that were each followed five minutes later by a
 * check that succeeded, and a user who was online throughout. Painting a
 * banner from one sample of that signal tells a person their machine is
 * disconnected when it is not, which is the same defect as the raw transport
 * alert this change exists to remove - a claim the app cannot support, on the
 * screen of someone whose work is fine.
 *
 * WHAT MAKES IT EVIDENCE: the SAME answer from a reading taken after a grace.
 * The first negative reading starts the clock and reports nothing; a second,
 * at or past `OFFLINE_CONFIRMATION_GRACE_MS`, is what the banner is allowed to
 * act on. A positive reading clears immediately - there is no reason to make a
 * user wait to be told their connection is back - and the grace is measured
 * from the FIRST negative reading rather than from the most recent one, so a
 * poll that re-runs cannot push the deadline back and hold a genuinely offline
 * machine unreported. A few seconds is the whole cost in the honest case,
 * which is why the grace is the poll interval the caller already uses.
 *
 * Pure, and total: it folds readings and returns what the surface may say, so
 * the rule can be driven in a test without a browser and a story can render
 * what the rule decided.
 */

/** How long a negative reading must persist before it may be reported. */
export const OFFLINE_CONFIRMATION_GRACE_MS = 5_000;

export interface OfflineConfirmation {
	/** When the current run of negative readings started, or null. */
	firstNegativeAt: number | null;
}

/** Nothing observed: the state before any reading, and after a positive one. */
export const noOfflineConfirmation = (): OfflineConfirmation => ({
	firstNegativeAt: null,
});

export interface ConnectivityReading {
	/** The reading itself. */
	isOnline: boolean;
	/** When it was taken. */
	at: number;
}

/**
 * Fold one reading in.
 *
 * `report` is the surface's answer: may it say this machine is offline? A
 * positive reading always answers no, and a negative one answers yes only once
 * it has held for the grace.
 */
export function observeConnectivityReading(
	state: OfflineConfirmation,
	reading: ConnectivityReading,
): { state: OfflineConfirmation; report: boolean } {
	if (reading.isOnline) {
		return { state: noOfflineConfirmation(), report: false };
	}
	if (state.firstNegativeAt === null) {
		return { state: { firstNegativeAt: reading.at }, report: false };
	}
	return {
		state,
		report: reading.at - state.firstNegativeAt >= OFFLINE_CONFIRMATION_GRACE_MS,
	};
}

/**
 * How long until this run of negative readings has held long enough.
 *
 * The caller schedules its confirming re-read with this rather than with the
 * full grace, so a re-render that re-runs the effect shortens the wait instead
 * of restarting it - the failure being a machine that is genuinely offline
 * never reaching the grace because each poll pushed it away.
 */
export function msUntilOfflineReportable(
	state: OfflineConfirmation,
	now: number,
): number {
	if (state.firstNegativeAt === null) return OFFLINE_CONFIRMATION_GRACE_MS;
	return Math.max(
		0,
		state.firstNegativeAt + OFFLINE_CONFIRMATION_GRACE_MS - now,
	);
}
