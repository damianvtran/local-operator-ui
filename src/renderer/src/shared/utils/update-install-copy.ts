import { t } from "../../../../i18n/messages";

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
			return t("ui.common.updates.install.verifying");
		case "staging":
			return t("ui.common.updates.install.staging");
		case "starting":
			return t("ui.common.updates.install.starting");
		default:
			return t("ui.common.updates.install.preparing");
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
	return t("ui.common.updates.install.succeeded", { version });
}

// Version reads are cached across language changes. Translate only their
// known presentation states at render time; actual versions and daemon URLs stay verbatim.
export function versionDisplay(value: string): string {
	switch (value) {
		case "Loading...":
			return t("ui.settings.updates.app_updates_section.state_loading");
		case "Not connected":
			return t("ui.settings.updates.app_updates_section.state_not_connected");
		case "Not attached":
			return t("ui.settings.updates.app_updates_section.state_not_attached");
		case "Version unknown":
			return t("ui.settings.updates.app_updates_section.state_version_unknown");
		case "Unknown (update required)":
			return t("ui.common.updates.error.version_unknown_required");
		case "Unavailable":
			return t("ui.settings.updates.app_updates_section.state_unavailable");
		default:
			return value;
	}
}
