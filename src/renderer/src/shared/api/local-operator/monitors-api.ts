/**
 * Local Operator API - the monitor surface's desktop client.
 *
 * The machine-wide monitor routes, through the authenticated desktop contract
 * rather than a bare `fetch`: cancelling a standing watch is a write the desktop
 * plane gates behind its bearer and same-origin check, exactly as the wakes
 * family beside it is, and the listing sits behind the same bearer.
 *
 * TWO READERS, TWO SOURCES, on purpose. The run pane's section and the
 * composer's chip render the SESSION's own canonical field (`frontend.monitors`,
 * through `run-detail-model.ts`'s `deriveMonitors`): they are about one open
 * conversation and that field is pushed. The Schedules page asks a different
 * question - every standing watch on this machine, including sessions nobody has
 * open - which only the monitor index answers, so it reads `list()` (#1898; the
 * TUI band and the phone's Schedules view read the same route). Both feed the
 * same deriver, so the rows cannot disagree. The arm op arrives with the form
 * that uses it.
 */
import type {
	DesktopMonitorEntry,
	DesktopMonitorListingRow,
	DesktopMonitorWriteReceipt,
	DesktopMonitorsListResponse,
} from "../../../../../shared/desktop-contract";
import { desktopResult } from "./desktop-api";

/**
 * Re-exported so a consumer of this module reads one import for one operation
 * family: the receipt type is the contract's (it describes the wire), and a
 * second definition here is how the pane and the wire would come to disagree.
 */
export type {
	DesktopMonitorEntry,
	DesktopMonitorListingRow,
	DesktopMonitorWriteReceipt,
	DesktopMonitorsListResponse,
};

/**
 * The listing's one cache entry, here in the shared layer rather than beside
 * the Schedules page's hook: the run pane's cancel (`use-monitor-controls.ts`)
 * invalidates it too, so a watch cancelled from a conversation leaves the page,
 * and a key both features import cannot live in either without one feature
 * importing the other.
 */
export const MONITORS_LIST_KEY = ["desktop", "monitors", "list"] as const;

export const MonitorsApi = {
	/**
	 * Every conversation on this machine that has monitors, with its watches.
	 *
	 * Dormant rows are included (the route's default, stated rather than relied
	 * on): a stopped conversation's watches are PARKED, not gone, and the page
	 * says so rather than dropping the row - the wake client's own rule.
	 */
	async list(): Promise<DesktopMonitorsListResponse> {
		return desktopResult<DesktopMonitorsListResponse>({
			op: "monitors.list",
			includeDormant: true,
		});
	},

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
