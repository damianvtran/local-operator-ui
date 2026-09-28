/**
 * How long an update wait may run before its surface adds a line saying so.
 *
 * WHY A SHARED CONSTANT AND NOT THREE LITERALS (UX U1, remediation round 1):
 * three surfaces now state the same fact - the checking card, the settings
 * button's pair and the download panel - and the numbers they speak about
 * differ (the check ladder is ~94s, the download's no-progress bound 90s), so
 * the THRESHOLD is what has to stay one value or the surfaces drift apart
 * silently. The delay is short enough that a normal check (seconds) never
 * shows the line, and long enough that it is not noise on the way to a fast
 * answer.
 *
 * The surfaces take a `slowWaitHintMs` override so a test or a story can
 * narrow it; the app omits it.
 */
export const SLOW_WAIT_HINT_MS = 12_000;
