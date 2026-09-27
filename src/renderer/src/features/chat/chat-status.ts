/*
 * The chat pane's ONE connection surface: what to draw, from what the app knows.
 *
 * WHY THIS IS A MODULE RATHER THAN A COMPONENT'S IF-CHAIN (chat redesign §F2,
 * design round 1's D3). The app had TWO banners in the shell root - a
 * connectivity band and a compatibility band - stacked above the window, each
 * with its own idea of what a lost daemon means and its own Retry. They sat over
 * the sidebar rail and under the traffic lights, and the same fact could be
 * stated twice on one screen in two different registers. §F2 collapses the
 * connection half to one strip with ONE message per root cause, and the rules
 * that decide which message are the part worth testing on their own: a component
 * that owns them can only be exercised by rendering it.
 *
 * The STATE vocabulary is `src/shared/backend-status.ts`'s, unmodified -
 * `connecting`/`attached`/`degraded`/`detached`/`replaced`/`wedged` describe the
 * connection, and `pairing` describes a server that answered and refused this
 * app. This module maps that vocabulary onto the four surfaces §F2 allows, and
 * the mapping in both directions is the whole file.
 */

import {
	type DaemonPairing,
	type DaemonPairingCause,
	type DaemonStatusSnapshot,
	isServerReachable,
	serverBannerCopy,
} from "../../../../shared/backend-status";

/**
 * The root causes the strip can state, and the one state it stays quiet for.
 *
 * `connecting` has no surface: §F2 draws nothing while the app is still finding
 * out, because a strip that flashes "can't reach the server" for the first two
 * hundred milliseconds of every launch is a strip nobody reads.
 */
export type ChatStatusKind =
	| "unreachable"
	| "credential-refused"
	| "degraded"
	| "internet-offline";

export type ChatStatusDisplay = {
	kind: ChatStatusKind;
	/**
	 * ONE live region, not five: `alert` for the two states that interrupt a send,
	 * `status` for the two that leave a working app (a degraded server is answering;
	 * an offline machine is a fact about the network rather than a fault).
	 */
	role: "alert" | "status";
	wash: "danger-wash" | "warning-wash";
	/** One sentence, and the only sentence: §F2's table, verbatim. */
	title: string;
	/**
	 * MAIN's own account of the path that was taken into this state - a refused
	 * credential, a probe answered by another process - or null. It is the strip's
	 * second line and never a second root cause.
	 */
	detail: string | null;
	/**
	 * The FACT main published, where the row has one: the pairing cause for the
	 * refused row, null elsewhere.
	 *
	 * IT EXISTS FOR THE KEY, NOT FOR THE COPY (UX round 1's U5): `chatStatusKey`
	 * keys dismissal and the Retry outcome on `kind` plus this, never on `detail`,
	 * because main re-spells the detail line for one unchanged condition - measured:
	 * two spellings of the same refusal, and a mid-scene refinement - and a key that
	 * moved with the prose voided a reader's dismissal and retired a press's own
	 * answer while nothing about the fact had changed.
	 */
	cause?: DaemonPairingCause | null;
	/** The one word the strip's action always carries. */
	action: "retry" | null;
	actionLabel: string | null;
	/** The dot the dismissed pill carries, per cause. */
	dot: "danger" | "warning";
};

/**
 * The one sentence per root cause (§F2's table, in code so it can be asserted).
 *
 * `internet-offline` is the row the spec's table does not have, and it is not a
 * fifth root cause: it is the same "you cannot send right now" fact with a
 * different subject, and saying "can't reach the Local Operator server" on a
 * machine whose network is gone would blame the wrong end of the wire - the
 * mistake `serverBannerCopy` was written to end. The state machine the app reads
 * distinguishes the two (`connectivityIssue`), so the strip must too.
 */
export const CHAT_STATUS_COPY = {
	unreachable: "Can't reach the Local Operator server. Sending will wait.",
	"credential-refused":
		"The running server refused this app's credential, so sign-in, settings and slash commands are unavailable.",
	degraded: "The server is answering slowly. Your messages are queued.",
	"internet-offline": "This machine is offline. Sending will wait.",
} as const satisfies Record<ChatStatusKind, string>;

/**
 * The shape `serverBannerCopy` reads, filled from the record this module is
 * given: the two optional fields are defaulted rather than guessed, so a snapshot
 * that predates them is passed through as "absent" instead of as a claim.
 *
 * `addressSubstitution` IS PASSED AS `null` ON PURPOSE, and this is a semantic
 * choice rather than a field the fold forgot. `serverBannerCopy` answers a
 * substitution BEFORE its state switch, because on the connectivity banner that
 * is a reachable server with something to say; this surface borrows the same
 * function only for its `detail` line, and it borrows it under ITS OWN title -
 * `credential-refused` when the server refused the credential, `unreachable`
 * when nothing is answering. Threading a live substitution through would let a
 * band sentence about the address the app is on be quoted under either of those
 * titles, which is two facts in one row. The address-substitution band is the
 * connectivity banner's to show; the strip's rows are §F2's root causes.
 *
 * The field is required rather than optional because main widened the parameter
 * to demand it, so the narrowing has to be stated here instead of being implied
 * by omission - a caller that later adds the field to `ChatStatusInput` gets a
 * type error until this decision is revisited rather than a silent behaviour
 * change.
 */
function snapshotOf(
	server: NonNullable<ChatStatusInput["server"]>,
): Pick<
	DaemonStatusSnapshot,
	"state" | "reconnecting" | "detail" | "pairing" | "addressSubstitution"
> {
	return {
		state: server.state,
		reconnecting: server.reconnecting ?? false,
		detail: server.detail ?? null,
		pairing: server.pairing ?? null,
		addressSubstitution: null,
	} as Pick<
		DaemonStatusSnapshot,
		"state" | "reconnecting" | "detail" | "pairing" | "addressSubstitution"
	>;
}

export type ChatStatusInput = {
	/** `useConnectivityStatus().connectivityIssue`: which half of the wire is down. */
	connectivityIssue: "server_offline" | "internet_offline" | null;
	/**
	 * `useConnectivityStatus().serverSnapshot`, main's own status record.
	 *
	 * Typed as the four fields this surface reads, with the two that a snapshot from
	 * an older build may not carry OPTIONAL - which is how `serverBannerCopy` reads
	 * them too, and why a state file can describe a wedged daemon without having to
	 * invent a detail line or a pairing record to say so.
	 */
	server:
		| (Pick<DaemonStatusSnapshot, "state"> & {
				reconnecting?: boolean;
				detail?: string | null;
				pairing?: DaemonPairing | null;
		  })
		| null;
	/** Whether the internet reading has been CONFIRMED, not merely observed once. */
	internetOffline: boolean;
};

/**
 * What the pane's status strip shows, or null when it shows nothing.
 *
 * THE ORDER IS THE ANSWER, and it is the one decision §F2 makes explicit: a
 * server that answered and refused this app's credential is a DIFFERENT fact
 * from a daemon whose process is gone, and when both readings are live the strip
 * states the one the reader can act on. The refused credential outranks
 * everything below it, because every other row's remedy is "try again" and this
 * one's is "this app is not allowed to talk to that server".
 */
export function chatStatusDisplay(
	input: ChatStatusInput,
): ChatStatusDisplay | null {
	const { server, connectivityIssue } = input;

	/*
	 * 1. The server answered and refused THIS APP'S CREDENTIAL. THE GATE IS THE
	 * CAUSE, NOT THE UNPAIRED BIT (design note § 0.1): `available === false` is
	 * true of five causes - successor, governed-elsewhere, pre-handshake,
	 * unpaired and this one - and this row painting its `credential-refused`
	 * copy over all five is half of the operator's two-bands-for-one-incident
	 * report (the strip said "refused this app's credential" while the
	 * compatibility banner said "replaced while this app was running"). The
	 * other four causes are the compatibility banner's rows: this surface stays
	 * silent for them, and the unreachable row retires with the same condition
	 * below.
	 *
	 * AND THE REFUSAL MUST BE A CURRENT FACT (UX round 1's U1). The daemon it
	 * describes may die while main's pairing record still says `credential-refused`,
	 * and this row then kept claiming "The daemon is running." over a dead process
	 * for as long as the record stood — while the pane's own log said the daemon
	 * was gone. `state !== "detached"` is the term that retires the row the moment
	 * the daemon is ABSENT, so the absence reaches the `unreachable` row below
	 * (which is the state the strip already renders for it).
	 *
	 * WHY THAT TERM AND NOT `isServerReachable` OR THE CONNECTIVITY READING: the
	 * live refusal's own state is `wedged` ("a daemon is running and this app
	 * deliberately did not attach to it" — `daemon-status.ts`'s `unattachable`
	 * arm), and BOTH of those other readings count `wedged` as not-online — the
	 * connectivity hook is `!isServerReachable(state)` and so reports
	 * `server_offline` throughout a live refusal, which is exactly the reading the
	 * walk that found U1 recorded. The absence itself is `detached`, the one state
	 * `pid-dead` and `no-candidate` produce.
	 *
	 * The absent `pairing` record is silence rather than a guess: a snapshot
	 * from a build that predates the field cannot state a cause, and the strip
	 * may not invent the refusal for it.
	 */
	if (
		server &&
		server.pairing?.cause === "credential-refused" &&
		server.state !== "detached"
	) {
		return {
			kind: "credential-refused",
			cause: "credential-refused",
			role: "alert",
			wash: "danger-wash",
			title: CHAT_STATUS_COPY["credential-refused"],
			detail: serverBannerCopy(snapshotOf(server))?.detail ?? null,
			/*
			 * RETRY, NOT `Sign in`, and this is a departure from §F2's table that the
			 * code has to make: the renderer has no sign-in path at all. The one act
			 * that re-pairs this app with a running server is
			 * `window.api.backend.reconnect()` - the same IPC the compatibility
			 * banner's own Retry calls - so a control labelled "Sign in" would name an
			 * act the app cannot perform, which is the "button that provably cannot
			 * work" this repo already refuses to ship. The strip's copy still tells the
			 * reader WHY their credential was refused.
			 */
			action: "retry",
			actionLabel: "Retry",
			dot: "danger",
		};
	}

	/*
	 * 2. The network is gone. Kept above the server rows deliberately: with no
	 * internet, every server probe fails for a reason the reader cannot fix on this
	 * machine, and reporting a server fault would send them to the wrong remedy.
	 * `internetOffline` is the CONFIRMED reading rather than a single observation -
	 * the app's own debounce - so a one-sample blip cannot paint a strip.
	 */
	if (connectivityIssue === "internet_offline" && input.internetOffline) {
		return {
			kind: "internet-offline",
			role: "status",
			wash: "warning-wash",
			title: CHAT_STATUS_COPY["internet-offline"],
			detail: null,
			action: "retry",
			actionLabel: "Retry",
			dot: "warning",
		};
	}

	/*
	 * 3. Degraded or reconnecting: a connection that is still there. A warning
	 * wash rather than a danger one, because nothing has failed - the app is
	 * telling the reader that a send will queue, which is a fact about latency.
	 *
	 * AND THE CONNECTION HAS TO BE THERE FOR THIS ROW TO BE TRUE (UX round 2;
	 * round 1's U3). `reconnecting` alone is not that fact: a daemon whose process
	 * is GONE is reported as `detached` with a retry in flight, and this row used
	 * to catch it and draw the degraded copy - "The server is answering slowly.
	 * Your messages are queued." - over a dead process. Measured in the running
	 * app: daemon killed, +14 s, and the strip still claimed a slow server while
	 * the Retry beside it answered "Still unreachable". The reachability predicate
	 * is the SAME one row 4 uses, so the two rows cannot disagree about whether
	 * anything is there to answer slowly.
	 */
	if (
		server !== null &&
		isServerReachable(server.state) &&
		(server.reconnecting === true || server.state === "degraded")
	) {
		return {
			kind: "degraded",
			role: "status",
			wash: "warning-wash",
			title: CHAT_STATUS_COPY.degraded,
			detail: null,
			action: "retry",
			actionLabel: "Retry",
			dot: "warning",
		};
	}

	/*
	 * 4. Nothing is answering, or a daemon is there that this app did not attach
	 * to (`wedged`). Both are `unreachable` on this surface - the reader's own
	 * position is the same in each - while main's `detail` says which path was
	 * taken, which is what keeps `detached` and `wedged` from being described
	 * alike.
	 *
	 * THE ROW RETIRES WHILE A PAIRING CAUSE THE STRIP DOES NOT STATE IS LIVE
	 * (design note § 2.2/§ 4/§ 5.3: successor, governed-elsewhere, pre-handshake
	 * and unpaired are "banner only", and § 5.3's cases assert this surface is
	 * silent for all of them). WHY THAT IS NOT THE NOTE'S OWN "no suppression"
	 * LINE READ IN REVERSE: that line states the BANNER's yield rules, and this
	 * is the strip's half of the same one-voice rule - without it the "exactly
	 * one band" promise does not hold in the states those causes actually occur
	 * in. Measured, on the governed scene the repo already committed
	 * (`docs/evidence/any-daemon-attach/after-frames-other-principal.json`):
	 * state `detached` beside cause `governed-elsewhere`, where this row would
	 * paint "Can't reach the Local Operator server" as a second band under the
	 * banner's own sentence. The two WARNING rows above keep firing: a degraded
	 * connection and an offline machine are separate facts the banner cannot
	 * state, and § 2.3 names that pair (`degraded`/`internet-offline` beside a
	 * pairing cause) as one that may legitimately co-render.
	 *
	 * AND IT IS WHERE THE REFUSED ROW FALLS THROUGH TO when the daemon it
	 * describes is gone (UX round 1's U1): the refusal is retired by the row-1 gate
	 * the moment the state is `detached`, and the reader's position — nothing is
	 * answering — is this row, with main's own detail as the second line.
	 */
	const pairing = server?.pairing ?? null;
	const unpairedElsewhere =
		pairing?.available === false && pairing.cause !== "credential-refused";
	const unreachable =
		!unpairedElsewhere &&
		(connectivityIssue === "server_offline" ||
			(server !== null && !isServerReachable(server.state)));
	if (unreachable) {
		return {
			kind: "unreachable",
			role: "alert",
			wash: "danger-wash",
			title: CHAT_STATUS_COPY.unreachable,
			detail: server
				? (serverBannerCopy(snapshotOf(server))?.detail ?? null)
				: null,
			action: "retry",
			actionLabel: "Retry",
			dot: "danger",
		};
	}

	/* 5. `connecting`, `attached`, `replaced`, or a healthy server: nothing to say. */
	return null;
}

/**
 * Whether a dismissal may stick (§F2: "the strip is dismissible to a pill").
 *
 * Dismissing is a statement about the CURRENT state, so it is keyed on the state
 * the reader dismissed rather than on a boolean they set once: a strip dismissed
 * while the server was unreachable must come back when the next root cause
 * appears, or the app has a permanent mute button for its own health.
 *
 * THE KEY IS THE FACT — `kind` plus main's CAUSE — NEVER MAIN'S PROSE (UX round
 * 1's U5). It used to carry `detail`, on the reading that the same kind reached
 * by a different path is a different fact; the drives that found U5 measured
 * what that meant in practice: main re-spells the detail line for ONE unchanged
 * condition (two spellings of the same refusal, plus a mid-scene refinement), so
 * the key moved with the prose — a reader's dismissal was voided and a fresh
 * Retry outcome was retired while nothing about the condition had changed. The
 * kind alone already separates the rows; the cause is carried beside it so the
 * refused row's key survives a copy change and still moves when the FACT moves
 * (the daemon dying moves it to `unreachable`, which re-arms a dismissed strip —
 * UX round 1's U1).
 */
export function chatStatusKey(
	display: ChatStatusDisplay | null,
): string | null {
	if (!display) return null;
	return `${display.kind}:${display.cause ?? ""}`;
}
