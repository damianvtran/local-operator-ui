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
 * - a probe that did not ANSWER is weaker evidence still, and is counted
 *   separately (`UNANSWERED_BEFORE_DETACHED`): a busy daemon misses a 2 s
 *   budget while it serves every real request, and reading that as absence is
 *   the mechanism behind "the app says my server is offline while my server
 *   answers the TUI";
 * - a REAL answer wins over a probe's silence: while this app's own desktop
 *   requests are still succeeding (`recordTransportSuccess`), no miss - not
 *   even `UNANSWERED_BEFORE_DETACHED` of them - may move the connection to
 *   `detached`, because the transport and the probe demonstrably disagree and
 *   the transport is the one carrying the user's data;
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
import type { UnreachableCause } from "./discovery";

/** Consecutive identity-failing probes before `detached` (design §5). */
export const DEGRADED_AFTER_FAILURES = 3;

/**
 * Consecutive UNANSWERED probes before `detached`.
 *
 * Deliberately far higher than `DEGRADED_AFTER_FAILURES`, and for a different
 * reason: a failed probe HAD an answer, so it is evidence about the connection
 * (a stranger on the port, a non-daemon, a refused socket). A probe that ran out
 * its budget had no answer at all, and CPython serving one long turn - the
 * operator's ordinary condition, not an exotic one - is enough to miss several
 * in a row while every other request succeeds. Nine misses at the 10 s cadence
 * is 90 s of continuous silence, which no healthy daemon produces and which
 * still recovers a genuinely stopped one well inside the `DETACHED_AFTER_MS`
 * report window.
 */
export const UNANSWERED_BEFORE_DETACHED = 9;

/**
 * How long a successful desktop request keeps a probe's silence from counting.
 *
 * Three probe intervals: long enough that one answered read covers the misses
 * around it, short enough that a daemon which really did stop stops being
 * excused within the same minute a user would notice.
 */
export const TRANSPORT_EVIDENCE_MS = 30_000;

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
	| {
			/**
			 * A daemon is serving the address this app is configured for, and this app
			 * is not attaching to it. Distinct from `heartbeat-stale` because the
			 * REASON differs (no key, a key that was refused, an install without the
			 * claim route) - and because "a server is running, we did not attach" is
			 * the honest sentence for all of them, which is what the copy needs.
			 */
			kind: "unattachable";
			detail: string;
	  }
	| { kind: "capability"; status: number; detail: string }
	| { kind: "build-announced"; detail: string }
	| { kind: "failed"; detail: string }
	| {
			/** The probe ran out of budget with no answer at all. */
			kind: "unanswered";
			cause: UnreachableCause;
			detail: string;
	  }
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
	/** Consecutive probes that ran out of budget with no answer at all. */
	private unanswered = 0;
	/** When a desktop request was last answered, or null. */
	private lastTransportAt: number | null = null;

	constructor(private readonly now: () => number = Date.now) {
		this.updatedAt = now();
	}

	/** Adopt a validated daemon (`owned` says whether this app spawned it). */
	attach(identity: DaemonIdentity, options: { owned: boolean }): void {
		this.identity = identity;
		this.owned = options.owned;
		this.failures = 0;
		this.unanswered = 0;
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
				this.unanswered = 0;
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
					/*
					 * The evidence clause belongs here too, and it is not cosmetic: this arm
					 * is reached on a refusal BELOW the detach threshold, so without it a
					 * surface shows `degraded` (usable, "the daemon is serving") beside a
					 * sentence that says only "refused the connection" - the app's own
					 * answered request, which is the reason it is not reporting the daemon
					 * gone, goes unnamed. Measured on CI, on the answering arm of
					 * `scripts/daemon-observation.test.mjs`'s F-1 pair: state `degraded`,
					 * detail `http://127.0.0.1:34753 refused the connection (fetch failed)
					 * (probe 2 of 3)`.
					 */
					this.detail = `${observation.detail} (probe ${this.failures} of ${DEGRADED_AFTER_FAILURES}).${this.transportEvidenceSuffix("so it is serving")}`;
				}
				break;
			case "unanswered":
				this.observeUnanswered(observation.detail);
				break;
			case "unattachable":
				/*
				 * A daemon answered the address this app is configured for, and this app is
				 * not attaching to it. Same state as `heartbeat-stale` and for the same
				 * reason - the daemon EXISTS - but produced by a different path (a record
				 * with no key this app may use, a key the daemon refused, an install
				 * predating the claim route), which the detail names. It never overwrites a
				 * live attachment: a daemon answering a port this app is NOT using says
				 * nothing about the one it is.
				 */
				if (this.state !== "attached" && this.state !== "replaced") {
					this.state = "wedged";
				}
				this.detail = observation.detail;
				break;
			case "pid-dead":
				// Corroborated absence, and the one path that bypasses the
				// transport-evidence gate below: a process that is gone cannot be the
				// process answering this app's requests, so no answered request
				// contradicts this observation.
				this.enterDetached("The daemon's process is gone.", true);
				break;
			case "no-candidate":
				this.enterDetached(observation.detail);
				break;
		}
		this.updatedAt = this.now();
		return this.state;
	}

	/**
	 * Fold a probe that ran out of budget with no answer.
	 *
	 * Three rules, in order, and each one exists because the alternative was
	 * measured on the operator's machine:
	 *
	 *   1. A successful desktop request inside the evidence window means the
	 *      connection is ALIVE and the probe is the thing that is wrong. The state
	 *      does not move at all - not to `degraded`, because the app is talking to
	 *      its daemon right now - and the detail records both facts. This is the
	 *      rule that makes "no surface may say offline while the app is still
	 *      reading from it" true by construction rather than by each surface
	 *      remembering to check a second flag.
	 *   2. Without that evidence, misses accumulate as `degraded` (usable), which
	 *      is all a 2 s budget on a busy box justifies.
	 *   3. Only `UNANSWERED_BEFORE_DETACHED` consecutive misses detach, and the
	 *      detail says how many were counted, so the log line names the evidence.
	 */
	private observeUnanswered(detail: string): void {
		this.unanswered += 1;
		if (this.transportEvidenceFresh()) {
			this.detail = `${detail}${this.transportEvidenceSuffix("so it is serving and the probe's budget is what expired")} (no answer to probe ${this.unanswered}).`;
			return;
		}
		if (this.unanswered >= UNANSWERED_BEFORE_DETACHED) {
			this.enterDetached(detail);
			return;
		}
		this.state = "degraded";
		this.detail = `${detail} (no answer to probe ${this.unanswered} of ${UNANSWERED_BEFORE_DETACHED})`;
	}

	/**
	 * Record that a real request against the attached daemon was answered.
	 *
	 * WHY this is the state machine's business and not a caller's: the probe and
	 * the transport disagree regularly on a box running long turns - the probe
	 * has a 2 s budget, a session list has a 30 s one - and the one carrying the
	 * user's data is the transport. Recording it here is what lets
	 * {@link observeUnanswered} prefer it without every surface re-deriving the
	 * same fact.
	 *
	 * It revives `degraded` (the daemon just answered, so the missed probes are
	 * explained) and never a `detached` connection: coming back from those is
	 * `recoverFromDetachment`'s job, because that path also has to re-prove the
	 * daemon's IDENTITY before anything may use it.
	 *
	 * @returns whether the state actually moved, so the caller only pushes a
	 * snapshot when there is something new to push.
	 */
	recordTransportSuccess(): boolean {
		const moved = this.state === "degraded";
		this.lastTransportAt = this.now();
		this.unanswered = 0;
		if (moved) {
			this.failures = 0;
			this.state = this.identity ? "attached" : "connecting";
			this.detail = this.identity
				? `Connected to the daemon on ${this.identity.url} (pid ${this.identity.pid}, v${this.identity.version}).`
				: "Connected to the Local Operator daemon.";
		}
		this.updatedAt = this.now();
		return moved;
	}

	/** Whether a successful request is recent enough to outrank a probe. */
	private transportEvidenceFresh(): boolean {
		return (
			this.lastTransportAt !== null &&
			this.now() - this.lastTransportAt <= TRANSPORT_EVIDENCE_MS
		);
	}

	/**
	 * The clause a sentence owes when THIS app's own request is the evidence
	 * behind a connection the app has not detached from, or the empty string when
	 * there is no such evidence.
	 *
	 * Shared rather than copied: three arms carry it (a probe budget that expired,
	 * a refusal past the detach threshold, and a refusal short of it), and a third
	 * copy is how one of them came to say "refused the connection" while the app
	 * was still holding the connection open on the strength of its own answered
	 * request.
	 */
	private transportEvidenceSuffix(tail: string): string {
		if (!this.transportEvidenceFresh()) return "";
		const silentFor = Math.round(
			(this.now() - (this.lastTransportAt as number)) / 1000,
		);
		return ` The daemon answered a request ${silentFor}s ago, ${tail}.`;
	}

	private enterDetached(detail: string, corroborated = false): void {
		/*
		 * The last gate before a surface is allowed to say "offline". A daemon that
		 * answered one of this app's own requests seconds ago is not gone, whatever
		 * the probes could not read, and detaching on that evidence is how the app
		 * came to cancel the reads it was still completing. The caller's own
		 * recovery path re-proves identity on the next attempt, so refusing here
		 * costs nothing but the false sentence it prevents.
		 *
		 * `corroborated` is for observations that are themselves direct evidence -
		 * a pid that is gone - and for which no answered request can exist.
		 */
		if (!corroborated && this.transportEvidenceFresh()) {
			this.failures = 0;
			this.state = "degraded";
			this.detail = `${detail}${this.transportEvidenceSuffix("so this app is not reporting it as gone")}`;
			return;
		}
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
			/**
			 * Carried so a surface can explain a `degraded` connection in the same
			 * terms main used, rather than inventing a second reason for it. Both are
			 * also what a reader needs to tell a busy daemon from a gone one.
			 */
			unanswered: this.unanswered,
			lastTransportAt: this.lastTransportAt,
			detail: this.detail,
			updatedAt: this.updatedAt,
		};
	}
}
