/**
 * Local Operator API - the monitor surface's desktop client.
 *
 * One operation against the machine-wide monitor routes, through the
 * authenticated desktop contract rather than a bare `fetch`: cancelling a
 * standing watch is a write the desktop plane gates behind its bearer and
 * same-origin check, exactly as the wakes family beside it is. It is the same
 * question the run pane's own section asks with a press, so it reads as the
 * wakes client's sibling.
 *
 * The READ is deliberately not here. The pane's section and the composer's chip
 * render the SESSION's own canonical field (`frontend.monitors`, through
 * `run-detail-model.ts`'s `deriveMonitors`), and the design's §12 row states the
 * desktop contract as "the `monitors` field + command routes" - so a listing op
 * would have no reader, and the arm op arrives with the form that uses it.
 */
import type { DesktopMonitorWriteReceipt } from "../../../../../shared/desktop-contract";
import { desktopResult } from "./desktop-api";

/**
 * Re-exported so a consumer of this module reads one import for one operation
 * family: the receipt type is the contract's (it describes the wire), and a
 * second definition here is how the pane and the wire would come to disagree.
 */
export type { DesktopMonitorWriteReceipt };

export const MonitorsApi = {
	/**
	 * Cancel one monitor, leaving the conversation in place.
	 *
	 * The receipt is returned rather than discarded, and unlike `WakesApi.remove`
	 * it is not a read the caller should treat as the outcome's evidence: the
	 * route can refuse (409/422/503) and it can answer an already-gone watch with
	 * a 404, so the caller re-reads the conversation's canonical state either way
	 * and the payload's own facts (`remaining`, `monitor_id`) are there for
	 * whoever needs them.
	 */
	async cancel(
		sessionId: string,
		monitorId: string,
	): Promise<DesktopMonitorWriteReceipt> {
		return desktopResult<DesktopMonitorWriteReceipt>({
			op: "monitors.cancel",
			sessionId,
			monitorId,
		});
	},
};
