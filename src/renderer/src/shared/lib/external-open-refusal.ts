import { showErrorToast } from "@shared/utils/toast-manager";
/**
 * The sentence a refused external open shows, and the listener that shows it
 * (round-2 R-4).
 *
 * WHY THIS EXISTS. Refusing to hand loopback/private URLs to the OS browser
 * (security review S-5) is right, but a user-clicked link that then did nothing
 * at all - a transcript link to `http://localhost:3000`, say - reads as a broken
 * app. The refusal has two carriers and they meet in this module: the toolbar's
 * Open awaits `window.api.openExternal` and reads the door's outcome; a markdown
 * anchor's click leaves through the main process's `window.open` door, which
 * pushes `external-open-refused`. Both end in the same toast, from this one
 * sentence.
 *
 * The loopback phrase is matched against the door's own reason text; that text
 * is pinned on the main side (`window-guards.test.mjs`'s refusal table), so the
 * two cannot drift into disagreeing about what "loopback or private" is.
 */
import { t } from "../../../../i18n";

/** The one sentence, per refusal class. */
export const externalOpenFailure = (reason: string): string =>
	reason.includes("loopback or private")
		? t("ui.notices.links.open_local_blocked")
		: t("ui.notices.links.open_failed");

/** Show the refusal `reason` as the shared sentence. */
export const showExternalOpenRefusal = (reason: string): void => {
	showErrorToast(externalOpenFailure(reason));
};

/**
 * Install the PUSHED half on the bridge (see the module comment), returning the
 * unsubscribe. A no-op outside Electron - Storybook and browser development have
 * no preload to subscribe to.
 */
export function installExternalOpenRefusalToasts(): () => void {
	const subscribe = window.api?.onExternalOpenRefused;
	if (typeof subscribe !== "function") return () => {};
	return subscribe((payload) => {
		showExternalOpenRefusal(payload.reason);
	});
}
