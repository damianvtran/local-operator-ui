/**
 * The server-status signal, as one shared contract.
 *
 * WHY it lives in `shared/`. The renderer used to decide "is the server online"
 * by fetching `/health` itself, from the packaged app's `file://` document.
 * That made a CORS decision into a liveness signal: `#1093`/`#1097` in the
 * backend changed exactly that surface, and a daemon that refuses a
 * browser-originated request would be reported to the user as "server down"
 * while it was serving fine. The MAIN process is the honest source - it sends
 * no Origin, it holds the bearer, and it is the only process that knows whether
 * the daemon it attached to is still the daemon it attached to - so the
 * renderer consumes this snapshot over IPC instead.
 *
 * The state vocabulary is deliberately the connection's, not the transport's:
 * `degraded` is "the daemon has not answered two probes", `detached` is "we no
 * longer have a daemon", and a capability refusal (401/403/503 from a gated
 * route) is not a state at all - it is reported beside the state, because
 * rendering "may not use these controls" as "server down" is the conflation
 * this contract exists to prevent.
 */

/** States a consumer may see. `connecting` is the pre-first-probe state. */
export type DaemonConnectionState =
	| "connecting"
	| "attached"
	| "degraded"
	| "detached"
	| "replaced";

/** IPC channel carrying an `invoke` of the current snapshot. */
export const BACKEND_STATUS_CHANNEL = "backend-status";

/** IPC push channel carrying a snapshot whenever it changes. */
export const BACKEND_STATUS_EVENT = "backend-status-changed";

export interface DaemonStatusSnapshot {
	state: DaemonConnectionState;
	/** This app spawned the daemon, and is the only process that may stop it. */
	owned: boolean;
	/** Base URL of the daemon this app talks to, or null while detached. */
	url: string | null;
	instanceId: string | null;
	pid: number | null;
	version: string | null;
	prefix: string | null;
	installKind: string | null;
	/** Whether the daemon accepts this app's bearer for the desktop plane. */
	desktopAvailable: boolean;
	/** Consecutive identity-failing probes. */
	failures: number;
	/** Status of the last CAPABILITY refusal, if any (never a liveness signal). */
	capabilityStatus: number | null;
	/** One sentence naming what the app actually observed. */
	detail: string;
	updatedAt: number;
}

/**
 * Whether a state is usable for backend queries.
 *
 * Only `detached` is offline. `degraded` is one or two missed probes on a
 * connection that is still there - disabling every query for that would turn a
 * busy daemon into an offline app, which is the visible half of the bug this
 * work fixes.
 */
export function isServerReachable(state: DaemonConnectionState): boolean {
	return state !== "detached";
}
