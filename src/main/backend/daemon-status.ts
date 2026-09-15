/**
 * The daemon connection's state machine: what "down" is allowed to mean.
 *
 * The app used to have exactly one reaction to one failed probe - restart the
 * backend - on a 30 s tick, for a daemon that might have been mid-restart,
 * busy, or serving someone else's turn. Combined with the fact that a gated
 * route's `401`/`403`/`503` was read as "server down", that is most of "the UI
 * keeps telling me my server is down when it is running".
 *
 * The rules here (design §5) are the replacement, and each one exists to remove
 * a way of being wrong:
 *
 * - `/health` with a matching `instance_id` is the ONLY liveness signal;
 * - three consecutive identity-failing probes are needed before the state is
 *   `detached` - one 2 s timeout is not evidence that a server is gone;
 * - a daemon whose pid is gone is `detached` immediately, because that IS
 *   evidence;
 * - a daemon whose pid is ALIVE but whose published heartbeat stopped is
 *   `wedged`: discovery refuses to attach to it and refuses to spawn over it,
 *   and neither of those facts is "your server is offline";
 * - a capability refusal is recorded BESIDE the state and never moves it;
 * - an announced build change is recorded in the detail and moves nothing: the
 *   daemon keeps serving, and detaching over it would kill live work;
 * - `degraded` never restarts anything, and `detached` always re-discovers
 *   before anything is started, so a slow daemon is never replaced by a second
 *   one;
 * - an EXTERNAL daemon is never restarted or replaced at all - if it is gone,
 *   the app says so and offers to start one.
 *
 * Every observation and transition here has a producer in `backend-service.ts`
 * (the watchdog, the discovery branches, the claim handshake) - `heartbeat-stale`
 * from discovery's `wedged` records and `markReplaced` from the ephemeral-port
 * replacement, which are the two the first round found unproduced.
 * `mayManageDaemon()` is the one predicate with no caller yet: it answers "may
 * this app stop the daemon it is talking to", which is `owned`, and it is kept
 * as the read-side of that invariant rather than inlined wherever a caller
 * would otherwise test the flag directly.
 *
 * The owner axis (`owned` = the child this app spawned, `external` =
 * discovered) is orthogonal to the state and is carried as a flag, because
 * every rule above is different for the two.
 *
 * Electron-free like `discovery.ts`, so the state machine can be exercised
 * directly by the node-runner tests.
 */

import type {
	DaemonConnectionState,
	DaemonStatusSnapshot,
} from "../../shared/backend-status";

/** Consecutive identity-failing probes before `detached` (design §5). */
export const DEGRADED_AFTER_FAILURES = 3;

/** Probe cadence once attached. */
export const PROBE_INTERVAL_MS = 10_000;

/** Probe budget: a daemon that cannot answer in 2 s has not answered. */
export const PROBE_TIMEOUT_MS = 2_000;

/**
 * How long a `detached` connection is reported as "reconnecting" before the
 * status escalates to "the daemon stopped" - the point at which the honest
 * thing to tell the user is that it is gone, not that we are still trying.
 */
export const DETACHED_AFTER_MS = 90_000;

/** First re-discovery delay after detaching, doubling to a ceiling. */
export const REATTACH_BACKOFF_MS = 30_000;
export const REATTACH_BACKOFF_CEILING_MS = 300_000;

/** What one probe observed. */
export type ProbeObservation =
	| { kind: "identified" }
	| { kind: "heartbeat-stale"; detail: string }
	| { kind: "capability"; status: number; detail: string }
	| { kind: "build-announced"; detail: string }
	| { kind: "failed"; detail: string }
	| { kind: "pid-dead" }
	| { kind: "no-candidate"; detail: string };

export interface DaemonIdentity {
	url: string;
	instanceId: string;
	pid: number;
	version: string;
	prefix: string;
	installKind: string;
}

export class DaemonStateMachine {
	private state: DaemonConnectionState = "connecting";
	private owned = false;
	private identity: DaemonIdentity | null = null;
	private failures = 0;
	private capabilityStatus: number | null = null;
	private desktopAvailable = false;
	private detail = "Looking for a Local Operator daemon.";
	private updatedAt: number;
	private detachedSince: number | null = null;
	private backoffMs = REATTACH_BACKOFF_MS;

	constructor(private readonly now: () => number = Date.now) {
		this.updatedAt = now();
	}

	/** Adopt a validated daemon (`owned` says whether this app spawned it). */
	attach(identity: DaemonIdentity, options: { owned: boolean }): void {
		this.identity = identity;
		this.owned = options.owned;
		this.failures = 0;
		this.detachedSince = null;
		this.backoffMs = REATTACH_BACKOFF_MS;
		this.state = "attached";
		this.detail = `Connected to the daemon on ${identity.url} (pid ${identity.pid}, v${identity.version}).`;
		this.updatedAt = this.now();
	}

	/** This app started a successor for a daemon it owns. */
	markReplaced(identity: DaemonIdentity): void {
		this.attach(identity, { owned: true });
		this.state = "replaced";
		this.detail = `Started a replacement daemon on ${identity.url} (pid ${identity.pid}).`;
		this.updatedAt = this.now();
	}

	/** Record a capability answer - never a liveness answer. */
	setDesktopAvailable(available: boolean): void {
		this.desktopAvailable = available;
		this.updatedAt = this.now();
	}

	/**
	 * Fold one probe's observation into the state.
	 *
	 * The capability and retiring branches are the load-bearing ones: both
	 * answer with a status an HTTP client would call an error, and both mean the
	 * daemon is alive and talking.
	 */
	observe(observation: ProbeObservation): DaemonConnectionState {
		switch (observation.kind) {
			case "identified":
				this.failures = 0;
				this.capabilityStatus = null;
				this.detachedSince = null;
				this.backoffMs = REATTACH_BACKOFF_MS;
				this.state = "attached";
				this.detail = this.identity
					? `Connected to the daemon on ${this.identity.url} (pid ${this.identity.pid}, v${this.identity.version}).`
					: "Connected to the Local Operator daemon.";
				break;
			case "capability":
				// A gated route refused us. The daemon is up; this app simply may
				// not use that control. State and failure count are untouched on
				// purpose - that is the whole point of the branch.
				this.capabilityStatus = observation.status;
				this.detail = `${observation.detail} The daemon is running.`;
				break;
			case "build-announced":
				// `retiring_from`/`retiring_to` announce that the INSTALLED build
				// changed under a serving daemon. The backend keeps serving until a
				// verified idle-boundary handoff exists, so this is recorded and
				// nothing else: moving the state here would detach live streams and
				// cancel in-flight turns over an announcement, which is the failure
				// the backend correction exists to prevent. Not a capability refusal
				// either - no route refused us - so `capabilityStatus` stays as it is.
				this.detail = observation.detail;
				break;
			case "heartbeat-stale":
				/*
				 * A daemon whose process is alive and whose heartbeat stopped. It is
				 * reachable from discovery's `wedged` records only, which is why it is
				 * the state that names the fact rather than the failure:
				 * the daemon EXISTS, so "offline" would be a lie about the transport.
				 *
				 * It never overwrites a live attachment: a quiet record is some other
				 * record, and demoting a connection this app is using because somebody
				 * else's heartbeat lapsed would be the same over-reaction one rung up.
				 */
				if (this.state !== "attached" && this.state !== "replaced") {
					this.state = "wedged";
				}
				this.detail = observation.detail;
				break;
			case "failed":
				this.failures += 1;
				if (this.failures >= DEGRADED_AFTER_FAILURES) {
					this.enterDetached(observation.detail);
				} else {
					this.state = "degraded";
					this.detail = `${observation.detail} (probe ${this.failures} of ${DEGRADED_AFTER_FAILURES})`;
				}
				break;
			case "pid-dead":
				this.enterDetached("The daemon's process is gone.");
				break;
			case "no-candidate":
				this.enterDetached(observation.detail);
				break;
		}
		this.updatedAt = this.now();
		return this.state;
	}

	private enterDetached(detail: string): void {
		this.failures = DEGRADED_AFTER_FAILURES;
		this.state = "detached";
		if (this.detachedSince === null) this.detachedSince = this.now();
		this.detail = detail;
	}

	/** The delay before the next re-discovery, doubling to the ceiling. */
	nextBackoff(): number {
		const current = this.backoffMs;
		this.backoffMs = Math.min(this.backoffMs * 2, REATTACH_BACKOFF_CEILING_MS);
		return current;
	}

	/** True once a detach has lasted long enough to be reported as gone. */
	isReportablyGone(): boolean {
		return (
			this.state === "detached" &&
			this.detachedSince !== null &&
			this.now() - this.detachedSince >= DETACHED_AFTER_MS
		);
	}

	/** True when this app may stop or replace the daemon it is talking to. */
	mayManageDaemon(): boolean {
		return this.owned;
	}

	/**
	 * True while a `detached` connection is inside the reconnection window.
	 *
	 * The inverse of {@link isReportablyGone} for the states that are detached,
	 * published so a surface can word the same state two ways: "reconnecting"
	 * while a daemon that is still running is expected back, and "stopped" once
	 * that expectation has expired. A still cannot show a timer, so the snapshot
	 * has to carry which half of the window it is in.
	 */
	isReconnecting(): boolean {
		return this.state === "detached" && !this.isReportablyGone();
	}

	/** The instance id we attached to, which every later probe must match. */
	expectedInstanceId(): string | null {
		return this.identity?.instanceId ?? null;
	}

	getState(): DaemonConnectionState {
		return this.state;
	}

	getUrl(): string | null {
		return this.identity?.url ?? null;
	}

	snapshot(): DaemonStatusSnapshot {
		return {
			state: this.state,
			reconnecting: this.isReconnecting(),
			owned: this.owned,
			url: this.identity?.url ?? null,
			instanceId: this.identity?.instanceId ?? null,
			pid: this.identity?.pid ?? null,
			version: this.identity?.version ?? null,
			prefix: this.identity?.prefix ?? null,
			installKind: this.identity?.installKind ?? null,
			desktopAvailable: this.desktopAvailable,
			failures: this.failures,
			capabilityStatus: this.capabilityStatus,
			detail: this.detail,
			updatedAt: this.updatedAt,
		};
	}
}
