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
 *
 * `wedged` was added for the same reason one rung down: discovery refuses to
 * attach to a daemon whose process is alive but whose published heartbeat
 * stopped, and reporting that as `detached` told the user their server was
 * OFFLINE while a process was still running on the machine. It is a third
 * fact - not connected, not gone - and it needs its own state for the copy to
 * be able to say so.
 */

/** States a consumer may see. `connecting` is the pre-first-probe state. */
export type DaemonConnectionState =
	| "connecting"
	| "attached"
	| "degraded"
	| "detached"
	| "replaced"
	| "wedged";

/** IPC channel carrying an `invoke` of the current snapshot. */
export const BACKEND_STATUS_CHANNEL = "backend-status";

/** IPC push channel carrying a snapshot whenever it changes. */
export const BACKEND_STATUS_EVENT = "backend-status-changed";

/**
 * IPC channel asking MAIN to re-discover now, answering with a fresh snapshot.
 *
 * WHY this exists: the renderer's connectivity banner offers a Retry, and once
 * the liveness signal moved to main, re-reading the snapshot could not cause a
 * reconnection - the recovery timer was the only thing that could, so the
 * control was inert in the one state that offers it. This is the verb that
 * makes the button mean what it says.
 */
export const BACKEND_RECONNECT_CHANNEL = "backend-reconnect";

export interface DaemonStatusSnapshot {
	state: DaemonConnectionState;
	/**
	 * True while a `detached` connection is still inside main's reconnection
	 * window: the app is re-discovering, and a daemon that is still running is
	 * expected back, so a surface must not report this as "the server stopped".
	 *
	 * False for every other state, and false once the window has passed and the
	 * escalation is honest (`DaemonStateMachine.isReportablyGone`).
	 */
	reconnecting: boolean;
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
	/**
	 * Consecutive probes that ran out of budget with no answer at all.
	 *
	 * Beside the state rather than folded into it, for the same reason
	 * `capabilityStatus` is: it is the difference between "the daemon is gone" and
	 * "the daemon did not answer a 2 s budget", and that difference is the whole
	 * of the report this field exists to serve.
	 */
	unanswered: number;
	/**
	 * When one of this app's own requests against the daemon was last answered,
	 * or null. A recent value is main's proof that the connection is alive
	 * whatever the probes could not read.
	 */
	lastTransportAt: number | null;
	/** One sentence naming what the app actually observed. */
	detail: string;
	updatedAt: number;
}

/**
 * Whether a state is usable for backend queries.
 *
 * `degraded` is one or two missed probes on a connection that is still there -
 * disabling every query for that would turn a busy daemon into an offline app,
 * which is the visible half of the bug this work fixes.
 *
 * `detached` and `wedged` are both unusable, for different reasons, and a
 * surface must not describe them alike: `detached` is "we have no daemon",
 * `wedged` is "a daemon is running and this app deliberately did not attach to
 * it". Both render the connectivity banner; only `detached` is not connected to
 * a running server. See `serverBannerCopy`.
 */
export function isServerReachable(state: DaemonConnectionState): boolean {
	return state !== "detached" && state !== "wedged";
}

/**
 * The connectivity banner's copy for a server-status snapshot, or null when the
 * banner must not be shown at all.
 *
 * The sentences live here, beside the state vocabulary they describe, rather
 * than in the banner component: three of the states a lost daemon used to
 * collapse into one string reach this surface, and a copy table that cannot be
 * read next to the states it names is how "The server is offline" came to be
 * rendered for a daemon that was still serving.
 *
 * `detail` is MAIN's own sentence about what it observed, appended as the
 * second line when it is present: the title says which kind of state this is,
 * the detail says which of the paths into it was taken (a refused credential, a
 * probe answered by another process, a spawn this app is not allowed to make).
 */
export function serverBannerCopy(
	snapshot: Pick<
		DaemonStatusSnapshot,
		"state" | "reconnecting" | "detail"
	> | null,
): { title: string; detail: string | null } | null {
	/*
	 * No snapshot at all: this host has no desktop bridge (Storybook, a plain
	 * browser dev server), so the renderer probed `/health` itself. That answer is
	 * the weaker one - it cannot tell a gated route from a dead server - and
	 * "not connected" is the whole of what it can honestly support.
	 */
	if (!snapshot) {
		return { title: "Not connected to a Local Operator server.", detail: null };
	}
	const detail = snapshot.detail?.trim() ? snapshot.detail.trim() : null;
	/*
	 * WHAT the title may claim, and what it may not.
	 *
	 * The title says which KIND of state this is - the connection fact, true of
	 * every path into it. The detail says which path was taken. The `wedged`
	 * title used to assert one path ("has stopped publishing its own
	 * heartbeat"), which is a false sentence for the other producers: a daemon
	 * answering the configured address whose key this app may not use is running
	 * and healthy, and telling its user that it stopped publishing its heartbeat
	 * is the same class of mistake as calling it offline.
	 */
	switch (snapshot.state) {
		case "wedged":
			return {
				title:
					"A Local Operator server is running on this machine and this app is not attached to it.",
				detail,
			};
		case "detached":
			return snapshot.reconnecting
				? {
						title:
							"Not connected to a Local Operator server. If one is still running, the app reconnects to it on its own.",
						detail,
					}
				: {
						title:
							"The Local Operator server stopped. The app keeps looking for one and attaches to it when it appears.",
						detail,
					};
		default:
			// attached / degraded / replaced / connecting: no banner. A missing probe
			// is not an outage, and the pre-first-probe state is not one either.
			return null;
	}
}
