/**
 * What the update panel says while an install is being prepared, and after one
 * lands.
 *
 * WHY THIS IS A MODULE OF ITS OWN. Both sentences describe work the app is doing
 * right now, and both used to be missing rather than wrong: the pre-quit wait (a
 * `codesign` over the installed bundle, a `hash` of the artifact, a full extraction
 * and a seal probe) showed a disabled button and nothing else, and a successful
 * install on the direct path showed nothing at all - the window came back in
 * seconds, so the app's return stopped being the report that the update had gone in
 * (UX U4, U5). The rules live here rather than inside the component so that the
 * wording is reviewable on its own and a test can drive every phase, including the
 * two the component cannot easily be put into.
 *
 * The phases are the main process's own (`InstallProgressPhase`, carried over
 * `update-install-progress`): three indivisible steps, no percentages, because a
 * percentage here would be invented rather than measured.
 */

/** The step the pre-quit install is on, as the main process reports it. */
export type InstallPhase = "verifying" | "staging" | "starting";

/**
 * The line the panel shows while an install the user just started is prepared.
 *
 * A null phase means `Install now` has been pressed but the main process has not
 * named a step yet - one tick of latency at most, and the honest sentence for it is
 * the one the button used to carry. The default is deliberately the vaguest of the
 * three: an unknown step must not claim to be a known one.
 */
export function installPhaseCopy(phase: InstallPhase | null): string {
	switch (phase) {
		case "verifying":
			return "Verifying the update against the app it will replace…";
		case "staging":
			return "Staging the update next to the app it will replace…";
		case "starting":
			return "Starting the installer. The app closes for a moment…";
		default:
			return "Preparing to install…";
	}
}

/**
 * The one line the app owes a user whose update just landed.
 *
 * The version is the one the install was for, which is also the version the app is
 * running by the time this is shown - so it is a reading, not a promise. It says
 * "updated", not "restarted" or "restart to finish": on the direct path the install
 * has completed and the app is back on the new build when this arrives.
 */
export function installSucceededCopy(version: string): string {
	return `Local Operator updated to v${version}.`;
}
