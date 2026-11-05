/**
 * Publication of the trial screens is not authorization to start trials.
 * Keep this OFF until core #3386 is released/deployed and production
 * start, email and enrollment acceptance have been verified. Activation is a
 * later reviewed code change, never a setting or telemetry flag. Unsupported
 * backends happen to hide the offer, but that is not a durable activation hold.
 *
 * Only NEW starts are gated: existing trials must retain status, paused notices
 * and read-only protections regardless of this switch.
 */
export const TEAM_TRIAL_START_ENABLED = false;

export function requireTeamTrialStartEnabled(): void {
	if (!TEAM_TRIAL_START_ENABLED) {
		throw new Error("Team trial activation is not available in this release");
	}
}
