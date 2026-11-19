/**
 * Remote compute's reads and writes: react-query hooks, and the one place this
 * family's refusal envelope is turned into something a surface can act on.
 *
 * WHY REACT QUERY AND NOT A STORE, although the plan named the file `*-store.ts`:
 * every catalogue read in this app is a `useQuery` (`peers.list`, `networks.list`,
 * `profiles.list`), and a second caching idiom beside the established one is a
 * defect. The name is kept so the reader who looks for the store finds the file.
 *
 * THE REFUSAL ENVELOPE IS THIS FAMILY'S OWN, which is why `desktopResult` is not
 * used here. The desktop plane's generic refusal body is `{detail: …}`; remote
 * compute answers `{error: {code, message, retry_after?}}`, where `message` is ALREADY
 * the sentence a user should read (the server that refused translates it). Reading it
 * through the generic helper would have replaced that sentence with the placeholder
 * and thrown away the code the affordances are chosen by. So the family posts its own
 * calls through `desktopRequest` and raises `RemoteRefusal`, which carries the
 * server's sentence verbatim plus the two fields a remedy needs.
 *
 * THE POLLING, WITH ITS NUMBERS AND THEIR REASONS.
 *
 * - THE CAPABILITY READ AND THE RUN LIST: 30 s, the app's own catalogue cadence, and
 *   `refetchIntervalInBackground: false` so a window behind another one costs nothing.
 *   This read is a provider call on the daemon's side, so it is not free - the same
 *   argument the mesh store records for its own catalogue. It is also the cadence the
 *   picker's aggregate is allowed to be stale by: a run that finishes while the
 *   dropdown is open decrements on the next read, and the dropdown is not a
 *   notification surface (the card is).
 * - ONE LIVE RUN: 5 s, while it can still change. A run spends money per metered
 *   second and its hold and status are the facts a user watches, so a card is the one
 *   surface in this app that polls faster than the catalogue cadence - but only while
 *   it has something to say. The interval stops on the first settled status, and it
 *   stops anyway once the run's own `deadline_at` is more than `REMOTE_RUN_POLL_GRACE_MS`
 *   in the past: a run whose record stops moving is not worth an unbounded poll, and
 *   the card says it is no longer updating rather than spinning forever.
 * - NOTHING POLLS WHILE THE FAMILY IS OFF: every hook takes an `enabled` flag derived
 *   from the read's own answer, and the picker passes the answer rather than the
 *   literal `true` - an answered `{enabled: false}` is a group that does not exist,
 *   so it costs no further read while the popover stays open (agent review m2).
 * - A READ THAT KEEPS FAILING BACKS OFF, AND A 429'S OWN PACE WINS (agent review m1).
 *   `retry: false` stops react-query's immediate retries but says nothing about the
 *   INTERVAL, and a constant interval against a route answering 500 is an unbounded
 *   poll of a broken surface. So each polling read delays by its last `retry_after`
 *   when the refusal carried one, and otherwise doubles up to
 *   `REMOTE_POLL_MAX_DELAY_MS`, stopping after `REMOTE_POLL_MAX_FAILURES` consecutive
 *   failures - the run's own deadline cannot bound it, because that deadline arrives
 *   in the body that failed.
 */

import { retryDesktopMutation } from "@shared/api/local-operator/backend-error";
import {
	DesktopControlError,
	desktopRequest,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DesktopRequest } from "../../../../shared/desktop-contract";
import {
	type RemoteComputeRead,
	type RemoteRun,
	type RemoteRunList,
	remoteComputeRead,
	remoteRunEnvelope,
	remoteRunList,
	remoteRunPhase,
} from "./remote-compute-types";

export const remoteComputeKeys = {
	read: ["desktop", "remote_compute", "read"] as const,
	runs: ["desktop", "remote_compute", "runs"] as const,
	run: (runId: string) => ["desktop", "remote_compute", "runs", runId] as const,
};

/** The catalogue cadence this family's two listing reads ride. */
export const REMOTE_COMPUTE_POLL_MS = 30_000;

/**
 * The cadence an OPEN picker re-reads at.
 *
 * TEN SECONDS, THE READ'S OWN `staleTime`, not the catalogue's thirty. The picker is
 * the surface whose row decides whether a money action is offered at all, and UX round
 * 1 measured it offering `sign in to use` for 29.7 s while the daemon had already
 * answered `signed-in` (U2). A closed picker still costs the catalogue cadence, and
 * the read is shared by query key, so a card beside it rides whichever cadence is
 * already running.
 */
export const REMOTE_COMPUTE_OPEN_POLL_MS = 10_000;

/** One live run's cadence. See this file's header for why it is the only fast one. */
export const REMOTE_RUN_POLL_MS = 5_000;

/** Consecutive failed reads after which a polling read stops rather than spins. */
export const REMOTE_POLL_MAX_FAILURES = 5;

/** The ceiling a backing-off poll reaches before it stops. */
export const REMOTE_POLL_MAX_DELAY_MS = 5 * 60_000;

/**
 * How long after its own deadline a run is still polled.
 *
 * Not a liveness fence: a run that is still going past its deadline is a fact the
 * server owns, and this number exists only to bound a card's polling. Five minutes is
 * long enough to catch a settle that lands after the deadline refuses new work, and
 * short enough that a record nobody will ever update stops costing requests.
 */
export const REMOTE_RUN_POLL_GRACE_MS = 5 * 60_000;

/**
 * A refusal from this family, with the server's own sentence.
 *
 * `code` selects the AFFORDANCE and never the wording (see `remoteRemedy`), and
 * `retryAfterMs` is the route's own `Retry-After` in milliseconds - the countdown a
 * retry remedy shows comes from here or from nowhere.
 */
export class RemoteRefusal extends Error {
	readonly code: string;
	readonly retryAfterMs: number | null;

	constructor(code: string, message: string, retryAfterMs: number | null) {
		super(message);
		this.name = "RemoteRefusal";
		this.code = code;
		this.retryAfterMs = retryAfterMs;
	}
}

/**
 * `Retry-After`, in the body this family's route restates it in.
 *
 * THE BODY, NOT A HEADER, and that is the transport's shape rather than a choice:
 * `DesktopResponse` is `{status, body}` with no headers, and main's relay does not
 * forward them - it has to restate `Retry-After` in the body for any renderer to see
 * it (`src/main/desktop-transport.ts`). An earlier version took a header argument
 * that no caller could ever supply and documented a precedence the transport cannot
 * deliver; a branch that is unreachable is a claim, and this one was false (agent
 * review n1).
 *
 * The spelling is standardised in SECONDS; the body field is read in seconds and
 * returned in milliseconds, because every countdown here is milliseconds.
 */
function retryAfterMs(body: unknown): number | null {
	const raw =
		typeof body === "object" && body !== null && "retry_after" in body
			? (body as { retry_after?: unknown }).retry_after
			: undefined;
	if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
		return Math.round(raw * 1000);
	}
	return null;
}

/**
 * One call, in this family's envelope.
 *
 * A NON-2XX ANSWER THAT CARRIES `error` IS THE SERVER'S OWN SENTENCE and is raised as
 * `RemoteRefusal`; a non-2xx answer that does NOT is a transport or version problem and
 * keeps the generic helper's wording, because inventing a remedy for a body this
 * family does not recognise is how a user gets sent to a sign-in for a 404.
 */
export async function remoteCall<T>(request: DesktopRequest): Promise<T> {
	let response: { status: number; body: unknown };
	try {
		response = await desktopRequest(request);
	} catch (error) {
		if (error instanceof DesktopControlError) {
			throw new RemoteRefusal(
				"transport",
				userFacingMessage(error, t("ui.chat.remote_compute.store.transport")),
				error.retryAfterMs ?? null,
			);
		}
		throw error;
	}
	const body = response.body;
	if (response.status >= 200 && response.status < 300) {
		const result =
			typeof body === "object" && body !== null && "result" in body
				? (body as { result: unknown }).result
				: body;
		return result as T;
	}
	const envelope =
		typeof body === "object" && body !== null && "error" in body
			? (body as { error?: unknown }).error
			: null;
	if (typeof envelope === "object" && envelope !== null) {
		const shape = envelope as {
			code?: unknown;
			message?: unknown;
			retry_after?: unknown;
		};
		const code = typeof shape.code === "string" ? shape.code : "unknown";
		const message =
			typeof shape.message === "string" && shape.message.trim()
				? shape.message
				: t("ui.chat.remote_compute.store.refused");
		throw new RemoteRefusal(code, message, retryAfterMs(shape));
	}
	/*
	 * A 404 WITH NO BODY IS THE RUN, NOT THE ROUTE. The route set is fixed and the app
	 * reached it (the family's read answered), so a bodiless not-found names a record
	 * that is gone - which is the `not_found` code, and its remedy is a re-read rather
	 * than a retry.
	 */
	throw new RemoteRefusal(
		response.status === 404 ? "not_found" : "unrecognised",
		response.status === 404
			? t("ui.chat.remote_compute.card.not_found")
			: t("ui.chat.remote_compute.store.refused"),
		null,
	);
}

/**
 * How long a polling read waits before its next attempt.
 *
 * PURE AND EXPORTED so the numbers are testable without a timer. The order is the
 * one the route asked for: a refusal that stated `retry_after` wins over anything
 * this file would invent, because the server is the only party that knows when it
 * will be ready (a 429 measured at 7 s must not be re-asked at 5 s). Otherwise the
 * delay doubles from the caller's own cadence, and after
 * `REMOTE_POLL_MAX_FAILURES` consecutive failures the answer is `false` - a surface
 * that has failed five times is a surface whose next read will fail too, and the
 * user's own re-read (the retry affordance, a reopened picker) is what restarts it.
 */
export function remotePollDelayMs(input: {
	baseMs: number;
	failures: number;
	retryAfterMs: number | null;
}): number | false {
	const { baseMs, failures, retryAfterMs } = input;
	if (failures <= 0) return baseMs;
	if (failures >= REMOTE_POLL_MAX_FAILURES) return false;
	if (retryAfterMs !== null && retryAfterMs > 0) {
		return Math.min(retryAfterMs, REMOTE_POLL_MAX_DELAY_MS);
	}
	return Math.min(baseMs * 2 ** failures, REMOTE_POLL_MAX_DELAY_MS);
}

/** The delay for one query state, from the refusal it is carrying (if any). */
function pollDelay(
	state: { error: unknown; fetchFailureCount: number },
	baseMs: number,
): number | false {
	const error = state.error;
	return remotePollDelayMs({
		baseMs,
		failures: state.fetchFailureCount,
		retryAfterMs: error instanceof RemoteRefusal ? error.retryAfterMs : null,
	});
}

/**
 * `GET /v1/desktop/remote-compute`.
 *
 * `enabled` is the family's switch and the caller's own gate: a read that answers
 * `{enabled: false}` is a family this backend does not serve, and the picker's group
 * does not exist for it.
 *
 * `pollMs` is the caller's own cadence, because two callers want two: a control that
 * is OPEN is answered at `REMOTE_COMPUTE_OPEN_POLL_MS`, one that is only present at
 * the catalogue's thirty seconds.
 */
export function useRemoteComputeRead(
	enabled: boolean,
	{ pollMs = REMOTE_COMPUTE_POLL_MS } = {},
) {
	return useQuery({
		queryKey: remoteComputeKeys.read,
		enabled,
		queryFn: async () =>
			remoteComputeRead(
				await remoteCall<unknown>({ op: "remote_compute.read" }),
			),
		retry: false,
		staleTime: 10_000,
		refetchInterval: (query) =>
			enabled ? pollDelay(query.state, pollMs) : false,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
	});
}

/**
 * `GET …/runs`: every row the server holds, tagged by source.
 *
 * `server` is the answer's own verdict and one of its values is not a failure:
 * `signed-out` means these rows came from this device's record rather than the
 * provider, which is the state the list draws as "last known" instead of "empty".
 */
export function useRemoteRuns(enabled: boolean, { poll = true } = {}) {
	return useQuery({
		queryKey: remoteComputeKeys.runs,
		enabled,
		queryFn: async () =>
			remoteRunList(await remoteCall<unknown>({ op: "remote_compute.runs" })),
		retry: false,
		staleTime: 10_000,
		refetchInterval: (query) =>
			enabled && poll ? pollDelay(query.state, REMOTE_COMPUTE_POLL_MS) : false,
		refetchIntervalInBackground: false,
	});
}

/**
 * How long until this run should be read again, or `false` to stop.
 *
 * A PURE FUNCTION SO THE BOUND IS TESTABLE without a timer: settled statuses stop
 * immediately, and an in-flight run past its deadline stops `REMOTE_RUN_POLL_GRACE_MS`
 * after it. A run with no `deadline_at` keeps the live cadence - it has not told us
 * when it ends, and guessing an end would stop watching a run that is still spending.
 */
export function remoteRunPollMs(
	run: Pick<RemoteRun, "status" | "deadline_at">,
	now: number,
): number | false {
	if (remoteRunPhase(run.status) !== "in-flight") return false;
	if (
		run.deadline_at !== null &&
		now - run.deadline_at > REMOTE_RUN_POLL_GRACE_MS
	) {
		return false;
	}
	return REMOTE_RUN_POLL_MS;
}

/**
 * `GET …/runs/{id}`, on the card's own cadence.
 *
 * `now` IS AN INPUT rather than read inside the query, so the caller's ticking clock
 * (one interval per card) is what decides when the poll stops - a query function that
 * called `Date.now()` would answer a different interval on every render and React
 * Query would restart the timer with it.
 */
export function useRemoteRun(runId: string | null, now: number) {
	const queryClient = useQueryClient();
	return useQuery({
		queryKey: runId
			? remoteComputeKeys.run(runId)
			: ["desktop", "remote_compute", "run", "none"],
		enabled: Boolean(runId),
		queryFn: async () => {
			const run = remoteRunEnvelope(
				await remoteCall<unknown>({
					op: "remote_compute.run",
					runId: runId ?? "",
				}),
			);
			/*
			 * THE ROW THAT CAME BACK IS THE TRUTH, so it is also written where the LIST
			 * read keeps its rows: a card and the runs list showing two different
			 * statuses for one run is the class of disagreement this app avoids by
			 * settling the shared entry rather than keeping a private copy.
			 */
			if (run) {
				queryClient.setQueryData<RemoteRunList>(
					remoteComputeKeys.runs,
					(previous) =>
						previous
							? {
									...previous,
									runs: previous.runs.map((row) =>
										row.id === run.id ? run : row,
									),
								}
							: previous,
				);
			}
			return run;
		},
		retry: false,
		refetchInterval: (query) => {
			const data = query.state.data;
			const cadence = data ? remoteRunPollMs(data, now) : REMOTE_RUN_POLL_MS;
			/*
			 * A FAILED READ IS PACED BY ITS FAILURES, not by a cadence it cannot reach: a
			 * 404 on a run record used to be re-asked every five seconds for as long as
			 * the card was on screen (agent review m1). `false` here stops the loop.
			 */
			return cadence === false ? false : pollDelay(query.state, cadence);
		},
		refetchIntervalInBackground: false,
	});
}

/** What a start sends. `networkId` is only ever the sheet's own choice. */
export type RemoteRunStartInput = {
	directory: string;
	prompt: string;
	networkId: string;
	/** The caller's once-per-intent key: the SAME value is resent on a retry. */
	idempotencyKey?: string;
};

/**
 * `POST …/runs`.
 *
 * THE START IS NOT A POLL and never retries itself: an `idempotency_conflict` or a
 * `run_limit` is a sentence for the user, and a mutation that retried would spend
 * twice for one press. The `requestId` is the caller's, so a press that was refused
 * and re-pressed replays instead of starting a second run.
 */
export function useRemoteRunStart() {
	const queryClient = useQueryClient();
	return useMutation({
		/*
		 * A REFUSAL IS NOT RE-SENT (UX round 2, U8). The app's default is one retry per
		 * failed write, which is right for a transport hiccup and wrong for an answer: the
		 * daemon logged every refused start twice, ~1.08 s apart, and the sentence reached
		 * the sheet only after the second refusal's backoff - so a `run_limit` read as an
		 * unresponsive button for over a second, and a 429 spent a second unit of the
		 * server's own rate limit to learn what the first answer already said. Everything
		 * this family raises is a `RemoteRefusal`, including the case where nothing
		 * answered at all (`code: "transport"`), which is the one shape worth one more
		 * send; `retryDesktopMutation` still owns the policy for a `DesktopControlError`
		 * that escapes `remoteCall`.
		 */
		retry: (failureCount, error) =>
			error instanceof RemoteRefusal && error.code !== "transport"
				? false
				: retryDesktopMutation(failureCount, error),
		mutationFn: async (input: RemoteRunStartInput) => {
			const answer = await remoteCall<{ run?: unknown }>({
				op: "remote_compute.start",
				directory: input.directory,
				prompt: input.prompt,
				tier: "cloud_run",
				networkId: input.networkId,
				...(input.idempotencyKey
					? { idempotencyKey: input.idempotencyKey }
					: {}),
			});
			const run = remoteRunEnvelope(answer);
			if (!run) {
				throw new RemoteRefusal(
					"unrecognised",
					t("ui.chat.remote_compute.store.accepted_without_run"),
					null,
				);
			}
			return run;
		},
		onSuccess: (run) => {
			queryClient.setQueryData(remoteComputeKeys.run(run.id), run);
			void queryClient.invalidateQueries({ queryKey: remoteComputeKeys.runs });
			void queryClient.invalidateQueries({ queryKey: remoteComputeKeys.read });
		},
	});
}

/** `POST …/runs/{id}/cancel`: stops a run that can still spend. */
export function useRemoteRunCancel() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (runId: string) => {
			const answer = await remoteCall<{ run?: unknown } | null>({
				op: "remote_compute.cancel",
				runId,
			});
			// `{run: null}` is a real answer: the route stopped the run and the record
			// was already gone. The surfaces re-read rather than holding a stale row.
			return remoteRunEnvelope(answer);
		},
		onSettled: (_data, _error, runId) => {
			void queryClient.invalidateQueries({
				queryKey: remoteComputeKeys.run(runId),
			});
			void queryClient.invalidateQueries({ queryKey: remoteComputeKeys.runs });
			void queryClient.invalidateQueries({ queryKey: remoteComputeKeys.read });
		},
	});
}

/**
 * `DELETE …/runs/{id}`: forgets a run that can no longer spend.
 *
 * Offered only once a run has settled, because deleting a live one would leave a
 * process spending with no row on any surface to cancel it from.
 */
export function useRemoteRunDelete() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (runId: string) => {
			await remoteCall<unknown>({ op: "remote_compute.delete", runId });
			return runId;
		},
		onSuccess: (runId) => {
			queryClient.removeQueries({ queryKey: remoteComputeKeys.run(runId) });
			void queryClient.invalidateQueries({ queryKey: remoteComputeKeys.runs });
			void queryClient.invalidateQueries({ queryKey: remoteComputeKeys.read });
		},
	});
}

/** Whether a read answered the family at all, for a caller's own gate. */
export function remoteComputeServed(
	read: RemoteComputeRead | undefined,
): boolean {
	return read?.enabled === true;
}
