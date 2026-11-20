/**
 * The remote-compute wire, normalised.
 *
 * WHY NORMALISED RATHER THAN CAST. This family's rows are read on the one screen a
 * user opens to spend money and time, and a sparse or renamed field used to be able
 * to take a whole window down through the app root's error boundary when a
 * neighbouring feature cast its catalogue. Every function here therefore answers a
 * COMPLETE value: absent becomes `null`, a wrong type becomes `null`, and a row
 * without an identity is dropped rather than drawn with an empty key.
 *
 * WHAT `null` MEANS IN THIS FILE, because it is the field that carries every honest
 * gap: `null` is "the wire did not say", never "zero" and never "no". A run with no
 * `hold_usd` has not told us what it holds; a capacity entry with no `ready` has not
 * told us whether it can provision. The surfaces render the difference - a money
 * line that prints `$0.00` for an unstated hold is a claim nobody made.
 *
 * THE THREE CONTRACT FACTS THIS FILE PINS, because they shape every reader:
 *
 * - `GET /v1/desktop/remote-compute` answers `{enabled: false}` when this daemon
 *   does not carry the family. That answer is not an error and has no account,
 *   capacity or networks; it is the switch, and the picker's group does not exist.
 * - `pricing` is `null` today (the capacity route publishes no rates). Nothing here
 *   computes a rate, so no surface can print one: the run card shows the HOLD the
 *   server reports, which is the committed maximum, and the settled charge when the
 *   server settles it.
 * - `network_id` is `null` on a run until the server echoes the binding. The
 *   renderer must not paint a network the run is not recorded against, which is why
 *   the field is carried rather than derived from the picker's current choice.
 */

/** The three credential states the desktop already distinguishes for Radient. */
export type RemoteAccountState = "signed-in" | "signed-out" | "expired";

export type RemoteAccount = {
	state: RemoteAccountState;
	/** The account label the server offers (an email, or whatever it chose). */
	label: string;
};

/** One mesh network a run could be bound to, as the binding line names it. */
export type RemoteNetwork = {
	network_id: string;
	name: string;
	role: string;
};

/** One capacity the deployment can (or cannot) provision right now. */
export type RemoteCapacity = {
	/** The wire's tier token, matched by the surfaces rather than re-spelled. */
	tier: string;
	ready: boolean;
};

/**
 * One run, as the provider records it.
 *
 * `status` IS A STRING and stays one: the vocabulary belongs to the server, and a
 * client that closed it would turn a status it has not learned yet into a refused
 * row. `remoteRunStatus()` groups it for the card (in flight, settled, failed) and
 * the raw token is still what a settled row prints in mono.
 */
export type RemoteRun = {
	id: string;
	name: string;
	tier: string;
	status: string;
	/** Epoch milliseconds, from whichever spelling the wire used. */
	started_at: number | null;
	deadline_at: number | null;
	metered_seconds: number | null;
	/** What the run settled at; `null` until it settles. */
	charged_usd: number | null;
	/** What the run HOLDS while unsettled: the committed maximum. */
	hold_usd: number | null;
	network_id: string | null;
};

/**
 * The picker's one read.
 *
 * `server` is NOT part of this route: it is the runs route's own field saying
 * whether the answer came from the provider (`ok`), from this device's record
 * because the account is signed out, or from neither (`unavailable`). It lives here
 * because both reads feed one model, and a model that had to know which route a
 * field came from would be two models.
 */
export type RemoteComputeRead = {
	/** The family's own switch. `false` means the rest of this value is empty. */
	enabled: boolean;
	account: RemoteAccount | null;
	networks: RemoteNetwork[];
	capacity: RemoteCapacity[];
	/** Always `null` today; carried so no surface can invent a rate. */
	pricing: null;
	active: RemoteRun[];
	/**
	 * Whether this DEPLOYMENT offers the family, distinct from the user's own flag
	 * (`enabled`) and from the account. `null` means the answer did not say, and the
	 * picker treats that as STILL OFFERED: only an explicit `false` hides the row.
	 *
	 * A value nobody stated is not a refusal to serve - a deployment that answers
	 * `null` here is one whose read predates the field, and the model's own test pins
	 * the same reading (`remote-compute-model.test.mjs`). An earlier version of this
	 * comment described a loading state the model does not have (agent review n3).
	 */
	offered: boolean | null;
	/** The read's own outcome, from the runs route; `null` on the capability read. */
	server: RemoteRunsServer | null;
};

/**
 * Where the run rows came from, or why there are none.
 *
 * `disabled` is the family's switch being off, which is a different answer from
 * `unavailable`: nothing failed, this deployment simply runs no remote compute.
 */
export type RemoteRunsServer = "ok" | "signed-out" | "disabled" | "unavailable";

/**
 * `GET …/runs`: the rows, and the server's own verdict about them.
 *
 * The rows are NOT tagged individually here: the route's own row tags exist, but
 * `RemoteRun` carries no such field and the only source claim any surface makes is
 * the list-level `server` verdict - `signed-out` means these are this device's record
 * rather than the provider's (agent review n4).
 */
export type RemoteRunList = {
	runs: RemoteRun[];
	server: RemoteRunsServer;
};

/* ------------------------------------------------------------- the helpers */

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const records = (value: unknown): Raw[] =>
	Array.isArray(value) ? value.filter(isRecord) : [];

const text = (value: unknown): string =>
	typeof value === "string" ? value.trim() : "";

/**
 * A count or an amount, or `null`.
 *
 * `Number.isFinite` rather than a truthiness test: `0` is a real charge (a run that
 * settled under the minimum, or was cancelled before it metered) and a `0` read as
 * "nobody said" would hide it behind a `—`.
 */
const amount = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * An instant, in EPOCH MILLISECONDS, from either spelling the wire may use.
 *
 * The family's neighbours disagree here: the mesh sends seconds
 * (`last_seen_at: 1789400000`), and a JSON `datetime` arrives as an ISO string. The
 * threshold is the one that separates them without guessing - anything below
 * `1e12` is seconds (that is the year 33658 in milliseconds, and 2001 in seconds) -
 * so a value keeps its meaning whichever route answered.
 */
const instant = (value: unknown): number | null => {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
};

const accountState = (value: unknown): RemoteAccountState | null => {
	const raw = text(value);
	return raw === "signed-in" || raw === "signed-out" || raw === "expired"
		? raw
		: null;
};

const serverVerdict = (value: unknown): RemoteRunsServer => {
	const raw = text(value);
	return raw === "ok" ||
		raw === "signed-out" ||
		raw === "disabled" ||
		raw === "unavailable"
		? raw
		: "unavailable";
};

/* -------------------------------------------------------------- the readers */

/**
 * Whether a row states that its run was DELETED.
 *
 * THE ONE STATUS THIS CLIENT DOES NOT DRAW. A deleted run is not a phase of a run - it
 * is the run's absence - and the daemon says so in the status itself: a server row
 * whose status is `deleted`, and this device's own record after a `DELETE`, both
 * arrive as that token. Read as a phase it would be an unknown token, and an unknown
 * token is the SAFE reading here (`in-flight`: the clock runs, `Cancel` is offered),
 * which is exactly wrong for a row that no longer exists - the GUI would poll it,
 * offer to stop it, and print the server's raw token for it.
 *
 * THE COMPARISON IS CASE-INSENSITIVE because the token is a status, not a spelling -
 * `remoteRunPhase` lower-cases for the same reason - and it is exact rather than a
 * substring, so a `deleting` or `delete_requested` row is still a run.
 */
export function remoteRunDeleted(status: string): boolean {
	return status.toLowerCase() === "deleted";
}

/**
 * One run, or `null` when the row cannot be filed as one.
 *
 * TWO REASONS FOR `null`, and both are "there is no row to draw" rather than a
 * failure: an identity-less row has nothing to key it under, and a DELETED run is
 * gone (`remoteRunDeleted`).
 *
 * WHY THE DROP LIVES HERE. This function is the ONE place a run becomes a
 * `RemoteRun`: the runs list, the capability read's `active[]` and the single-run
 * envelope all come through it, so the card, the runs dialog, `liveRuns` and the
 * picker's count lose a deleted row together and no second reader has to remember
 * the rule. The envelope answering `null` is its existing "no row" answer - the same
 * one a cancel whose record was already cleaned up earns - so the card draws nothing
 * rather than a run the user deleted.
 */
export function remoteRun(value: unknown): RemoteRun | null {
	if (!isRecord(value)) return null;
	const id = text(value.id);
	if (!id) return null;
	const status = text(value.status);
	if (remoteRunDeleted(status)) return null;
	return {
		id,
		name: text(value.name),
		tier: text(value.tier),
		status,
		started_at: instant(value.started_at),
		deadline_at: instant(value.deadline_at),
		metered_seconds: amount(value.metered_seconds),
		charged_usd: amount(value.charged_usd),
		hold_usd: amount(value.hold_usd),
		network_id: text(value.network_id) || null,
	};
}

/** `GET …/runs`, normalised. A duplicate id is one run, not two rows. */
export function remoteRunList(value: unknown): RemoteRunList {
	const seen = new Set<string>();
	const runs: RemoteRun[] = [];
	for (const raw of records(isRecord(value) ? value.runs : value)) {
		const run = remoteRun(raw);
		if (!run || seen.has(run.id)) continue;
		seen.add(run.id);
		runs.push(run);
	}
	const server = isRecord(value) ? serverVerdict(value.server) : "unavailable";
	return { runs, server };
}

/**
 * `GET …/runs/{id}` and the two writes that answer with a row: the row, or `null`.
 *
 * BOTH SHAPES ARE READ, because the writes and the read differ: the read answers
 * `{run}`, and a cancel whose record was already gone answers `{run: null}` - which
 * is a real answer (the run stopped; the row was cleaned up), not an absence to
 * report as a failure. A bare row is accepted so a caller that already took the
 * envelope apart is not forced to re-wrap it.
 */
export function remoteRunEnvelope(value: unknown): RemoteRun | null {
	if (!isRecord(value)) return null;
	return remoteRun("run" in value ? value.run : value);
}

/**
 * `GET /v1/desktop/remote-compute`, normalised.
 *
 * `enabled` IS A BOOLEAN AND NOTHING ELSE COUNTS AS ON. The route's off answer is
 * literally `{"enabled": false}`; a missing field is not an on switch, because the
 * group's existence is the claim that the family is served.
 */
export function remoteComputeRead(value: unknown): RemoteComputeRead {
	const raw = isRecord(value) ? value : {};
	const enabled = raw.enabled === true;
	const networks: RemoteNetwork[] = [];
	const seen = new Set<string>();
	for (const row of records(raw.networks)) {
		const id = text(row.network_id);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		networks.push({
			network_id: id,
			name: text(row.name),
			role: text(row.role),
		});
	}
	const capacity: RemoteCapacity[] = [];
	for (const row of records(raw.capacity)) {
		const tier = text(row.tier);
		if (!tier) continue;
		// `ready` is tri-state on purpose: an entry that states no readiness is not a
		// ready one, and it is not a refused one either - it is carried as false and
		// the model treats a plan of all-false as "capacity unavailable", which is the
		// sentence that does not claim the provider went away.
		capacity.push({ tier, ready: row.ready === true });
	}
	const account = isRecord(raw.account)
		? accountState(raw.account.state)
		: null;
	return {
		enabled,
		account: account
			? {
					state: account,
					label: isRecord(raw.account) ? text(raw.account.label) : "",
				}
			: null,
		networks,
		capacity,
		pricing: null,
		active: records(raw.active)
			.map(remoteRun)
			.filter((run): run is RemoteRun => run !== null),
		offered: typeof raw.offered === "boolean" ? raw.offered : null,
		server: typeof raw.server === "string" ? serverVerdict(raw.server) : null,
	};
}

/* --------------------------------------------------------------- the status */

/** How a run's status is READ: while it can still change, or once it cannot. */
export type RemoteRunPhase = "in-flight" | "succeeded" | "failed" | "cancelled";

/**
 * The phases a run's own status tokens fall into.
 *
 * A CLOSED MAPPING OVER AN OPEN VOCABULARY, which is the deliberate shape: the
 * tokens below are the ones this client has been told about, and an unknown token
 * is `in-flight` (the safe reading - the card keeps polling and keeps offering
 * `Cancel`, where "settled" would hide a live run's controls). The raw token is
 * what the card PRINTS when it is not one of the known ones, in the mono step, so an
 * unrecognised status still reaches the reader instead of being translated into a
 * sentence nobody's server said.
 *
 * HOW IT IS READ AND WHETHER IT HAS A WORD ARE TWO QUESTIONS. A token can be known
 * to be UNFINISHED and still have no sentence of its own - `error` is exactly that
 * (`remoteRunStatusKnown` says why) - so the phase below is never inferred from
 * membership of the known set.
 *
 * `deleted` IS NOT AN ARM HERE ON PURPOSE: a deleted run is the run's absence rather
 * than a phase of it, and `remoteRun` drops the row before it is ever a `RemoteRun`
 * (see `remoteRunDeleted`). So the default arm below is never asked about it.
 */
export function remoteRunPhase(status: string): RemoteRunPhase {
	switch (status.toLowerCase()) {
		case "succeeded":
		case "success":
		case "complete":
		case "completed":
		case "done":
		/*
		 * A BARE `stopped` IS SETTLED, AND `stopped` IS ALL IT SAYS. It is what a
		 * deployment answers for a finished run that publishes the provider's terminal
		 * token without the outcome beside it (`stopped` + `outcome: succeeded |
		 * cancelled | failed`); this client reads the status alone, so there is no
		 * outcome here to resolve it by. Of the three settled phases, `succeeded` is the
		 * one whose word makes no claim the token did not: `card.status.succeeded` reads
		 * `Finished`, which is exactly what `stopped` states, where `failed` prints
		 * `Failed` over a run the deployment may well have completed (the live round 2
		 * run was `stopped`/`succeeded`). The alternatives are worse than the naming:
		 * in flight keeps the clock running, offers `Cancel` on a run that cannot spend
		 * and shows the hold instead of the charge - and, because this token is now
		 * KNOWN, `statusLabel` would fall to its in-flight default and print `Running`.
		 */
		case "stopped":
			return "succeeded";
		/*
		 * `error` IS NOT SETTLED: THE SWEEP RETRIES IT. The server's vocabulary calls the
		 * row "a provider failure the sweep retries", so the deployment may re-drive it
		 * and spend again on a later pass. Reading it as `failed` ended the run on this
		 * side while the server had not: polling stopped, `Cancel` went away, and `Forget`
		 * was offered over a run that could still cost money. In flight is the truthful
		 * reading - the clock runs, `Cancel` stays, and `liveRuns` counts the row.
		 */
		case "error":
			return "in-flight";
		/*
		 * `stopping` IS THE WINDOW AFTER A CANCEL PRESS AND BEFORE THE SETTLEMENT, and
		 * it stays in flight because the run can still spend and the clock must keep
		 * running. Read as settled it would hide `Cancel` in the beat it is being
		 * answered and take `Finished` for an outcome the server has not stated.
		 */
		case "stopping":
			return "in-flight";
		case "failed":
		case "timed-out":
		case "timed_out":
		case "timeout":
		case "expired":
			return "failed";
		case "cancelled":
		case "canceled":
			return "cancelled";
		default:
			return "in-flight";
	}
}

/**
 * Whether a run is being stopped: the beat between the press and the settlement.
 *
 * ONE RULE, TWO SURFACES. The card and the runs dialog both offer `Cancel`, and
 * both must stop inviting a second press for that whole beat - which is longer
 * than the request itself (`cancel.isPending`), because the run reports `stopping`
 * until the server settles it.
 */
export function remoteRunStopping(status: string): boolean {
	return status.toLowerCase() === "stopping";
}

/** Whether a status token is one this client can name. */
export function remoteRunStatusKnown(status: string): boolean {
	switch (status.toLowerCase()) {
		case "queued":
		case "pending":
		case "provisioning":
		case "starting":
		case "running":
		case "succeeded":
		case "success":
		case "complete":
		case "completed":
		case "done":
		case "failed":
		/*
		 * NOT KNOWN, AND THAT IS THE POINT: `error` is in flight and retryable
		 * (`remoteRunPhase`), and this client has no sentence for "failed, but the server
		 * will try again" - so the card prints the server's own token in the mono step
		 * rather than translating it into a word nobody's daemon said.
		 */
		case "timed-out":
		case "timed_out":
		case "timeout":
		case "expired":
		case "cancelled":
		case "canceled":
		/*
		 * KNOWN, because THIS surface is what causes it: a Cancel press is answered
		 * with `stopping`, so the card owes the press a sentence of its own rather than
		 * the raw-token fallback (design round 4, D15). The fallback keeps its job for
		 * tokens the client does not initiate (`error`, a future provider phase).
		 */
		case "stopping":
		/* The settled token a deployment may publish instead of an outcome; see
		 * `remoteRunPhase`. Known, because the card's mono fallback is for tokens this
		 * client cannot read at all. */
		case "stopped":
			return true;
		default:
			return false;
	}
}
