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
 * - a capability refusal is recorded BESIDE the state and never moves it;
 * - `degraded` never restarts anything, and `detached` always re-discovers
 *   before anything is started, so a slow daemon is never replaced by a second
 *   one;
 * - an EXTERNAL daemon is never restarted or replaced at all - if it is gone,
 *   the app says so and offers to start one.
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
	| { kind: "retiring"; detail: string }
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
			case "retiring":
				// 503 daemon-retiring: this daemon is handing over to a successor.
				this.capabilityStatus = 503;
				this.failures = 0;
				this.state = this.state === "detached" ? "detached" : "degraded";
				this.detail = observation.detail;
				break;
			case "heartbeat-stale":
				this.state = this.state === "detached" ? "detached" : "degraded";
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
