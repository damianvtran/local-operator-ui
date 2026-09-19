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

/**
 * WHY this app is not paired with a daemon it can see.
 *
 * A boolean cannot be worded, so main used to hand the renderer one bit
 * (`desktopAvailable`) and every surface invented its own explanation for it. The
 * two explanations the operator saw side by side were both wrong and differently
 * wrong: the compatibility banner told them to make the app manage the server,
 * and the chat pane told them their server was out of date (design § 0).
 *
 * These are the CAUSES main can actually prove - each one is a different fact
 * with a different remedy, or with no remedy at all - and the renderer selects
 * the sentence from this value rather than from the status of a request.
 *
 * - `successor`: the process answering this address is not the one this app
 *   attached to (a `lop` build swap is the ordinary cause). Nothing is wrong
 *   with the daemon; the app has to pair with the new one.
 * - `governed-elsewhere`: the daemon's own serve record says its plane is
 *   governed (`desktop: true`) and publishes no claim key, and this app holds no
 *   pairing token of its own - so SOME other program claimed it. There is no
 *   remedy this app may offer (design § 2, S2).
 * - `pre-handshake`: the daemon predates the pairing handshake - no serve record
 *   at all, or a record whose claim route answered `404` - so it can never
 *   accept a claim from this app.
 * - `credential-refused`: the daemon answered and refused this app's bearer for a
 *   `/v1/desktop/` route. Re-claiming is the repair.
 * - `unpaired`: the app holds no credential for the daemon it can see and has not
 *   yet established which of the causes above applies. This is the honest
 *   fallback, and it is what a surface must use rather than guessing.
 */
export type DaemonPairingCause =
	| "successor"
	| "governed-elsewhere"
	| "pre-handshake"
	| "credential-refused"
	| "unpaired";

/**
 * Main's answer about this app's PAIRING with the daemon it can see.
 *
 * Structurally separate from the connection state because it is a different
 * question: an app can be `attached` and unpaired at the same time (the process
 * was replaced under it), and a daemon can be gone with the pairing question not
 * arising at all.
 *
 * `cause: null` MEANS PAIRED, and `available` is its boolean projection - the
 * two are one fact and must be set together, on every outcome including failure.
 * That is the whole repair of the defect this type replaces: `desktopAvailable`
 * was written with `true` at three sites and `false` at none, so after a
 * successor replaced the daemon the app went on reporting a pairing that no
 * longer existed, and the renderer's own capability answer disagreed with it
 * (design § 1.4).
 *
 * Produced where the facts are in hand - `attachIfUsable`'s claim and probe
 * branches, and `probeAttachedDaemon`'s identity verdicts - and RESET by
 * `DaemonStateMachine.attach()`, so a `cause` can never outlive the pairing it
 * described.
 */
export interface DaemonPairing {
	available: boolean;
	cause: DaemonPairingCause | null;
}

/** The one paired value, so no producer spells it two ways. */
export const DAEMON_PAIRED: DaemonPairing = { available: true, cause: null };

/** Unpaired with the cause not yet established (design § 2, S5). */
export const DAEMON_UNPAIRED: DaemonPairing = {
	available: false,
	cause: "unpaired",
};

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
	/**
	 * Whether the daemon accepts this app's bearer for the desktop plane.
	 *
	 * KEPT as a derived read of `pairing.available` for the callers that only need
	 * the bit, so nothing that already reads it changes meaning. It is never set
	 * independently: the two are one fact from one assignment (`snapshot()`),
	 * which is what stops the sticky-bit defect returning in a new shape.
	 */
	desktopAvailable: boolean;
	/**
	 * Whether this app is paired, and why not when it is not.
	 *
	 * The pairing truth, and the value every surface that WORDES this condition
	 * reads - a boolean cannot name a cause, and the two surfaces that guessed
	 * from one disagreed with each other and with the daemon (design § 0).
	 */
	pairing: DaemonPairing;
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
/**
 * Whether a long-lived relay must be rebuilt for the backend it is about to
 * serve.
 *
 * The ADDRESS is the obvious half and the CREDENTIAL is the half that was
 * missing. A relay takes its bearer once, at construction, and a re-pair leaves
 * the address identical while replacing the credential - the same port, a new
 * claim key - so a rebuild keyed on the URL alone keeps a relay that is refused
 * on every attempt: measured after the successor swap, the app was attached and
 * paired with the replacement while the sidebar still rendered "Not connected to
 * the backend - showing the last known state." more than a minute later, and it
 * never cleared (QA round 1 Q-2, design round 1 D3). The stream relay already
 * compared both; this is the same rule, stated once where both can read it.
 */
export function relayNeedsRebuild(
	current: { url: string; token: string | null },
	next: { url: string; token: string | null },
): boolean {
	return current.url !== next.url || current.token !== next.token;
}

/**
 * Whether pressing a re-pairing control could change this state at all.
 *
 * The compatibility band withholds its control for exactly these causes ("a
 * Retry would be a button that provably cannot work"), and the connectivity band
 * sits directly above it on the same screen - so it has to answer the same
 * question the same way, or one screen offers the verb the other has just
 * declared inert (design round 1, D2; UX round 1, U3).
 *
 * `governed-elsewhere` is the plane's own contract: a second claim is refused
 * even when it presents the correct key. `pre-handshake` is a route that does
 * not exist on that install.
 */
export function pairingHasRemedy(
	cause: DaemonPairingCause | null | undefined,
): boolean {
	return cause !== "governed-elsewhere" && cause !== "pre-handshake";
}

export function serverBannerCopy(
	snapshot: Pick<
		DaemonStatusSnapshot,
		"state" | "reconnecting" | "detail" | "pairing"
	> | null,
): { title: string; detail: string | null; retry: boolean } | null {
	/*
	 * No snapshot at all: this host has no desktop bridge (Storybook, a plain
	 * browser dev server), so the renderer probed `/health` itself. That answer is
	 * the weaker one - it cannot tell a gated route from a dead server - and
	 * "not connected" is the whole of what it can honestly support.
	 */
	if (!snapshot) {
		return {
			title: "Not connected to a Local Operator server.",
			detail: null,
			retry: true,
		};
	}
	const detail = snapshot.detail?.trim() ? snapshot.detail.trim() : null;
	/*
	 * The cause, and whether an act exists that could change it. `pairing` is
	 * absent on a snapshot from a build that predates the record, which is why the
	 * answer defaults to the permissive one: a surface may not withhold a control
	 * on the strength of a field it never read.
	 */
	const remedy = pairingHasRemedy(snapshot.pairing?.cause ?? null);
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
				retry: remedy,
			};
		case "detached":
			return snapshot.reconnecting
				? {
						/*
						 * The promise is withheld where it cannot be kept: a plane another
						 * program governs, or an install older than the handshake, is not a
						 * server this app will reconnect to by waiting.
						 */
						title: remedy
							? "Not connected to a Local Operator server. If one is still running, the app reconnects to it on its own."
							: "Not connected to a Local Operator server.",
						detail,
						retry: remedy,
					}
				: {
						/*
						 * The non-reconnecting arm answers the same question as the
						 * reconnecting one (UX round 2, U7): measured at main's 90 s
						 * boundary, both un-remediable causes switch to this title and
						 * this arm offered a Retry whose press asks `/health` and
						 * `/v1/capabilities` only - it changes nothing and says nothing.
						 * The promise in the title is kept, because the app really does
						 * keep looking; the control is withheld where no act exists.
						 */
						title:
							"The Local Operator server stopped. The app keeps looking for one and attaches to it when it appears.",
						detail,
						retry: remedy,
					};
		default:
			// attached / degraded / replaced / connecting: no banner. A missing probe
			// is not an outage, and the pre-first-probe state is not one either.
			return null;
	}
}
