/**
 * @file use-quota-notice.ts
 * @description
 * The composer's read of the pre-emptive quota notice: one query against
 * `GET /v1/desktop/quota-notice`, the local dismiss map, and the two presses
 * the line offers (resend, re-read).
 *
 * WHERE THIS RUNS. The line mounts on the EMPTY chat band only (see the mount
 * in `message-input.tsx`), so "enabled only on an empty session" is expressed
 * by the mount rather than by a prop: the read cannot run on a session with
 * content. `staleTime: 0` below plus a remount per conversation identity (the
 * chat page keys the session panel by identity) is what makes "refetch on
 * session open" true without a session parameter.
 *
 * WHICH MODEL IS CHECKED (review R1-M1 / Q3). The pane's OWN selection, when
 * this document has one — the same `effective_model ?? selected_model` pair
 * the model chip labels itself from — falling back to the `["config"]`
 * machine default only when there is none (a transcriptless or unresolved
 * pane). The fallback is the reason the config read stays here: the route
 * falls back to the same store, so the two cannot name different accounts,
 * but the config default is the WRONG account the moment a pane has picked a
 * session model, and a notice about the default's balance over a send that
 * will use another provider is worse than no notice. `selection` is passed by
 * the mount; the key includes both halves, so a model change re-asks.
 *
 * WHY THE READ DOES NOT WAIT FOR A FOCUS FLOOR (Q2's ruling). The route is
 * cache-first with its own forced-refresh floor on the server (#2128), so the
 * cost of a focus storm here is HTTP round trips to the local backend, not
 * upstream probes; no client-side floor was added, and the design says only
 * "when the window regains focus while a notice is visible". The focus effect
 * below therefore asks on every focus WHILE A NOTICE IS VISIBLE, and asks
 * nothing otherwise.
 *
 * LIFT DISCIPLINE. The shared composer mounts in documents with no
 * `QueryClientProvider` (the mini view), where `useQuery` cannot be called at
 * all. Every read here therefore goes through `useOptionalQueryClient` and is
 * gated `provided`, and the config and census reads are RESTATED -- same key,
 * same fetch, same options -- rather than reached through `useDefaultModel` /
 * `useDesktopProviders`, which mount plain `useQuery`s. That is the convention
 * `slash-commands.tsx` documents for its own restatements, and the reason it
 * exists is the same: one cache entry serves every surface, and a document
 * without a provider must not fetch from the inert fallback.
 *
 * WHAT THE READ IS NOT. It never retries a 404: an older backend answers the
 * route with one, and the notice's contract is "show nothing", not "retry" or
 * "update the backend" (the capability gate usually prevents the call at all;
 * this is the race's belt).
 */

import { openUrlTarget } from "@features/chat/utils/link-open";
import { CONFIG_QUERY_KEY } from "@features/providers/use-provider-status";
import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { ConfigApi } from "@shared/api/local-operator/config-api";
import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { ConfigResponse } from "@shared/api/local-operator/types";
import { radientProxy } from "@shared/api/radient/proxy";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	DesktopProvider,
	QuotaNotice,
	QuotaNoticeAction,
} from "../../../../../shared/desktop-contract";
import {
	QUOTA_RESEND_COOLDOWN_MS,
	type QuotaNoticeDismissals,
	type QuotaRefreshCue,
	type QuotaResendState,
	type QuotaResendView,
	advanceQuotaNoticeDismissals,
	classifyResendFailure,
	forgetQuotaResendEpisode,
	quotaNoticeActions,
	quotaNoticeDismissed,
	quotaNoticeShows,
	quotaRefreshSentence,
	quotaResendEpisodeFor,
	quotaResendView,
	readQuotaNoticeDismissals,
	rememberQuotaResendEpisode,
	writeQuotaNoticeDismissals,
} from "./quota-notice";
import type { QuotaNoticeShownState } from "./quota-notice";

/**
 * The notice query's identity: the provider and model under review.
 *
 * The key carries the selection (rather than only the request carrying it) for
 * the design's own reason: a model change must re-ask, and a key is the one
 * mechanism that makes that true without an effect watching for it. `""` stands
 * in for "not resolved yet" so the key stays stable and string-safe.
 */
export const quotaNoticeQueryKey = (
	provider: string | null,
	model: string | null,
) => ["desktop", "quota-notice", provider ?? "", model ?? ""] as const;

/**
 * The pane's own model selection, as the mount hands it over. The pair is the
 * wire's own vocabulary (`{provider, model_id}`), the same shape
 * `CanonicalModel` carries, rather than a display string the hook would have
 * to split.
 */
export type QuotaNoticeSelection = {
	provider: string;
	model_id: string;
} | null;

/**
 * The query, exactly as the hook issues it. Exported so a test can drive the
 * real options through react-query rather than a restatement of them.
 */
export const quotaNoticeQueryOptions = (
	provider: string | null,
	model: string | null,
	enabled: boolean,
) =>
	({
		queryKey: quotaNoticeQueryKey(provider, model),
		queryFn: async (): Promise<QuotaNotice | null> => {
			try {
				return await desktopResult<QuotaNotice>({
					op: "quota.notice",
					...(provider ? { provider } : {}),
					...(model ? { model } : {}),
				});
			} catch (error) {
				/*
				 * The old-backend answer, read as "nothing to say" rather than as a
				 * failure: a 404 must neither surface nor retry. Everything else is
				 * a real failure and propagates.
				 */
				if (error instanceof DesktopControlError && error.status === 404) {
					return null;
				}
				throw error instanceof Error ? error : new Error(String(error));
			}
		},
		enabled,
		/*
		 * `staleTime: 0` (review R1-m2). The app default is five minutes, so the
		 * docstring's "refetch on session open" through `refetchOnMount` was only
		 * true once the cache had aged out: three New chat remounts produced zero
		 * requests. The read is cheap by construction (the route is cache-first),
		 * so a mount asks, deliberately, every time — the state this line exists
		 * to catch changes precisely between sessions.
		 */
		staleTime: 0,
		/*
		 * Focus is handled by the hook's own listener, which asks only while a
		 * notice is VISIBLE (the design's own rule): the app default (`true`)
		 * would re-ask on every focus even with nothing to show.
		 */
		refetchOnWindowFocus: false,
		retry: retryDesktopQuery,
	}) as const;

/**
 * The credential census, restated (see the file docstring) -- the same key,
 * fetch, `staleTime` and retry as `useDesktopProviders`.
 */
const credentialCensusOptions = (enabled: boolean) =>
	({
		queryKey: desktopKeys.providers,
		queryFn: () =>
			desktopResult<{ providers: DesktopProvider[] }>({
				op: "providers.list",
			}).then((result) => result.providers ?? []),
		enabled,
		staleTime: 30_000,
		retry: retryDesktopQuery,
	}) as const;

/**
 * What a census answer says about the credential SET, as one comparable string.
 *
 * The login trigger: `provider-detail.tsx` invalidates `desktopKeys.providers`
 * on every credential write (sign-in success included), so a census whose
 * credential-bearing fields changed is the app's own signal that "after login"
 * has happened. Comparing the SET rather than `dataUpdatedAt` is deliberate --
 * a plain re-read of unchanged rows must not re-ask the notice.
 */
export const credentialCensusSignal = (
	rows: readonly DesktopProvider[] | undefined,
): string | null =>
	rows === undefined
		? null
		: rows
				.map(
					(row) =>
						`${row.id}:${row.has_credential === true ? 1 : 0}:${row.stored_credentials ?? 0}`,
				)
				.join("|");

/**
 * The line's whole model: the answer by value, plus the handlers by reference.
 * A discriminated union on `visible` so the component cannot read a field a
 * hidden notice does not have.
 *
 * `resendPhase` is the raw phase, beside `resend`'s rendered facts: a capture
 * settles on the phase by name, and deriving it back from the facts would
 * misreport an EXPIRED cooldown as `idle`. `statusSentence` is the one status
 * slot's text — the resend press's outcome when it has one, else the re-read's
 * cue (U1/U2) — which is what keeps a single `<output>` authoritative.
 */
export type QuotaNoticeModel =
	| { visible: false }
	| {
			visible: true;
			state: QuotaNoticeShownState;
			provider: string;
			body: string;
			actions: QuotaNoticeAction[];
			resend: QuotaResendView;
			resendPhase: QuotaResendState["kind"];
			statusSentence: string | null;
			refreshing: boolean;
			onOpenUrl: (url: string) => void;
			onRefresh: () => void;
			onResend: () => void;
			onDismiss: () => void;
	  };

export function useQuotaNotice(
	selection: QuotaNoticeSelection = null,
): QuotaNoticeModel {
	const { client, provided } = useOptionalQueryClient();
	const capabilities = useDesktopCapabilities();
	const featureEnabled = desktopFeatureEnabled(
		capabilities.data,
		"quota_notice",
	);

	/*
	 * The selection: the pane's own pick when the mount passed one, else the
	 * machine default restated from `useDefaultModel` (see the file docstring).
	 * The config read is also the enable gate's second half below, because a
	 * selection that has not resolved yet must not spend a read on the `""` key.
	 */
	const config = useQuery(
		{
			queryKey: CONFIG_QUERY_KEY,
			queryFn: async (): Promise<ConfigResponse | null> => {
				const response = await ConfigApi.getConfig("");
				return (response.result as ConfigResponse) ?? null;
			},
			enabled: provided && featureEnabled,
			staleTime: 5000,
			refetchOnWindowFocus: false,
			retry: retryDesktopQuery,
		},
		client,
	);
	const provider = selection?.provider ?? config.data?.values?.hosting ?? null;
	const model = selection?.model_id ?? config.data?.values?.model_name ?? null;

	/*
	 * THE READ WAITS FOR THE CONFIG to answer, because its key carries the
	 * selection: a read on the pre-config key (`""`) would fetch one answer for
	 * an unresolved selection and a second the moment the values land — two
	 * backend probes for one session open, which is the load the design
	 * measures. `isFetched` (settled, error or success) rather than
	 * `data !== undefined`: a failed config read still proceeds, so the route's
	 * own config fallback answers the same question. A PANE SELECTION does not
	 * wait on it — the selection is not the config — but the gate reads the
	 * same either way, and a pane's own `frontend` arriving with the session is
	 * the only latency it can pay.
	 */
	const notice = useQuery(
		quotaNoticeQueryOptions(
			provider,
			model,
			provided && featureEnabled && (selection !== null || config.isFetched),
		),
		client,
	);
	const refetchNotice = notice.refetch;

	const census = useQuery(
		credentialCensusOptions(provided && featureEnabled),
		client,
	);

	/*
	 * The dismissal map, per PROVIDER (review R1-M2/U3/N3): one entry per
	 * provider, the state it dismissed. See `advanceQuotaNoticeDismissals` for
	 * the re-arm rule the effect below applies.
	 */
	const [dismissals, setDismissals] = useState<QuotaNoticeDismissals>(() =>
		readQuotaNoticeDismissals(),
	);

	const answer = quotaNoticeShows(notice.data) ? notice.data : null;
	/*
	 * The answer's OWN identity, taken even from a non-shown state so the
	 * re-arm rule sees `ok`/`unknown` too (that is the whole point of it), and
	 * falling back to the requested pair when the wire left the provider empty.
	 */
	const answerProvider = notice.data?.provider || provider || "";
	const answerState = notice.data?.state ?? "";

	/*
	 * THE RE-ARM, applied to every answer this hook ever sees. An entry whose
	 * provider now reads a DIFFERENT state is spent and is cleared, so
	 * `depleted -> ok -> depleted` shows the line again on the second
	 * depletion (U3/R1-M2). The same-state case deliberately keeps the entry:
	 * a refetch, a focus regain or a session revisit with the verdict
	 * unchanged is not a new episode.
	 */
	useEffect(() => {
		if (!notice.data || answerProvider.length === 0 || answerState.length === 0)
			return;
		const next = advanceQuotaNoticeDismissals(
			dismissals,
			answerProvider,
			answerState,
		);
		if (next !== dismissals) {
			writeQuotaNoticeDismissals(next);
			setDismissals(next);
		}
	}, [notice.data, answerProvider, answerState, dismissals]);

	const dismissed = quotaNoticeDismissed(
		dismissals,
		answerProvider,
		answerState,
	);
	const dismiss = useCallback(() => {
		if (answer === null || answerProvider.length === 0) return;
		const next = { ...dismissals, [answerProvider]: answer.state };
		writeQuotaNoticeDismissals(next);
		setDismissals(next);
	}, [answer, answerProvider, dismissals]);

	/*
	 * THE RE-READ PRESS AND ITS CUE (review U2). A direct read rather than
	 * `fetchQuery`: react-query's fetch path answers from a fresh cache entry
	 * without touching the route, which is the opposite of what this press
	 * means. The answer is written back with `setQueryData` so the line reads
	 * one cache row whichever call produced it — and the cue compares the
	 * state BEFORE against the state AFTER, because "no change yet" is the
	 * answer a user pressing "I topped up" most often gets and the one they
	 * cannot otherwise read.
	 */
	const [refreshing, setRefreshing] = useState(false);
	const [refreshCue, setRefreshCue] = useState<QuotaRefreshCue>("idle");
	const refreshingRef = useRef(false);
	const refreshNotice = useCallback(() => {
		if (!provided || !featureEnabled || refreshingRef.current) return;
		refreshingRef.current = true;
		setRefreshing(true);
		setRefreshCue("checking");
		const before = answerState;
		void (async () => {
			try {
				const produced = await desktopResult<QuotaNotice>({
					op: "quota.notice",
					refresh: true,
					...(provider ? { provider } : {}),
					...(model ? { model } : {}),
				});
				client.setQueryData(quotaNoticeQueryKey(provider, model), produced);
				setRefreshCue(produced.state === before ? "unchanged" : "idle");
			} catch {
				/* The last answer stands — and the cue says the check failed. */
				setRefreshCue("failed");
			} finally {
				refreshingRef.current = false;
				setRefreshing(false);
			}
		})();
	}, [provided, featureEnabled, client, provider, model, answerState]);

	/*
	 * THE RESEND PRESS, its phases and its clock. `nowMs` ticks only while a
	 * deadline is live (the 120 s cooldown after `sent`/`rate_limited`), which
	 * is what re-enables the button when the window passes; the phase's own
	 * sentences and the disabled rule live in `quota-notice.ts` so they are
	 * testable without waiting anything out.
	 *
	 * The phase's SETTLED OUTCOMES outlive the mount (`quotaResendEpisodeFor`)
	 * so a New chat remount cannot re-offer a button whose mail just went out
	 * (U8). A press in flight is deliberately not stored — it dies with the
	 * component, and a remount should offer the button rather than claim a
	 * press nobody can observe.
	 */
	const [resendState, setResendState] = useState<QuotaResendState>(() => {
		const episode = quotaResendEpisodeFor(provider ?? "", Date.now());
		return episode ? { ...episode } : { kind: "idle" };
	});
	const [nowMs, setNowMs] = useState(() => Date.now());
	const resendDeadline =
		resendState.kind === "sent" || resendState.kind === "rate_limited"
			? resendState.until
			: null;
	useEffect(() => {
		if (resendDeadline === null) return;
		const timer = setInterval(() => setNowMs(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [resendDeadline]);

	/*
	 * Adopt a live episode once the provider resolves (the initializer above
	 * saw `""` when the selection had not landed yet). `kind === "idle"` only:
	 * a phase this mount already moved past is this mount's answer.
	 */
	useEffect(() => {
		if (!provider || resendState.kind !== "idle") return;
		const episode = quotaResendEpisodeFor(provider, Date.now());
		if (episode) setResendState({ ...episode });
	}, [provider, resendState.kind]);

	/*
	 * A SENTENCE MUST NOT OUTLIVE ITS STATE (review U4, applied to both
	 * presses): when the verdict MOVES — including to a state with no resend
	 * action at all — the resend phase returns to rest and the re-read's cue is
	 * spent. Keyed on the answer's provider+state and compared against the
	 * LAST-SEEN pair rather than reset on every answer, for two ordered reasons:
	 * a same-state refetch must keep a live "Sent…" sentence and its cooldown,
	 * and the FIRST answer after a remount (the pair moving from `""` to the
	 * real one) is not a state change — resetting there would wipe the episode
	 * the adoption effect above had just restored.
	 */
	const lastAnswerSignature = useRef<string | null>(null);
	useEffect(() => {
		if (answerProvider.length === 0 || answerState.length === 0) return;
		const signature = `${answerProvider}\n${answerState}`;
		const previous = lastAnswerSignature.current;
		lastAnswerSignature.current = signature;
		if (previous === null || previous === signature) return;
		/*
		 * The remembered press outcome belongs to the episode that just ended
		 * (U4): without this, the adoption effect above would read the still-live
		 * cooldown back in from the module map and restore the sentence the reset
		 * had just cleared. A cooldown survives a REMOUNT; never a state change.
		 */
		forgetQuotaResendEpisode(previous.split("\n")[0] ?? "");
		setResendState({ kind: "idle" });
		setRefreshCue("idle");
	}, [answerProvider, answerState]);

	/*
	 * THE IN-FLIGHT REF (review Q1). Three clicks dispatched in ONE task (no
	 * event-loop turn) all read the same render-time phase, so the disabled
	 * state lands too late for the second and third: QA measured three ops and
	 * three request ids. The ref is synchronous, like `refreshingRef` in the
	 * re-read above, and is the only guard the process needs — the disabled
	 * state keeps real clicks out afterwards.
	 */
	const resendRef = useRef(false);
	const sendResend = useCallback(() => {
		const view = quotaResendView(resendState, Date.now());
		if (!provided || resendRef.current || view.disabled || !view.offered)
			return;
		resendRef.current = true;
		setResendState({ kind: "sending" });
		void (async () => {
			try {
				/*
				 * A fresh `request_id` per press, per the proxy's rule: a retry
				 * after a refusal is a NEW question, and the receipt's at-most-once
				 * protection is what makes a double press one mail at most.
				 */
				await radientProxy({
					operation: "signup.resend",
					requestId: crypto.randomUUID(),
				});
				const episode = {
					kind: "sent" as const,
					until: Date.now() + QUOTA_RESEND_COOLDOWN_MS,
				};
				rememberQuotaResendEpisode(answerProvider, episode);
				setResendState(episode);
			} catch (error) {
				const failure = classifyResendFailure(error);
				if (failure.kind === "rate_limited") {
					const episode = {
						kind: "rate_limited" as const,
						until: Date.now() + QUOTA_RESEND_COOLDOWN_MS,
					};
					rememberQuotaResendEpisode(answerProvider, episode);
					setResendState(episode);
				} else if (failure.kind === "nothing_to_resend") {
					/*
					 * Nothing waiting to be re-sent: the account verified (or never
					 * had a grant), and the verified/no-grant COPY is the server's
					 * -- this client does not author it. So the switch is a forced
					 * re-read; whatever the verdict answers next is what the line
					 * shows.
					 */
					setResendState({ kind: "idle" });
					refreshNotice();
				} else if (failure.kind === "degraded") {
					setResendState({ kind: "degraded" });
				} else {
					/*
					 * Retryable (a blip, an upstream failure): the button stays
					 * offered and the outcome is REMEMBERED, so a remount still
					 * says what happened (U1) instead of silently re-arming.
					 */
					rememberQuotaResendEpisode(answerProvider, { kind: "failed" });
					setResendState({ kind: "failed" });
				}
			} finally {
				resendRef.current = false;
			}
		})();
	}, [provided, resendState, answerProvider, refreshNotice]);

	/*
	 * AFTER LOGIN. `provider-detail.tsx` invalidates the census on every
	 * credential write, so a census answer whose credential-bearing fields
	 * CHANGED since the last one is the app's own "a sign-in just completed"
	 * signal. Comparing the set rather than the timestamp is what keeps an
	 * unchanged re-read from re-asking.
	 */
	const censusSignal = credentialCensusSignal(census.data);
	const lastCensusSignal = useRef<string | null>(null);
	useEffect(() => {
		if (censusSignal === null) return;
		const previous = lastCensusSignal.current;
		lastCensusSignal.current = censusSignal;
		if (previous !== null && previous !== censusSignal) {
			void refetchNotice();
		}
	}, [censusSignal, refetchNotice]);

	/*
	 * FOCUS WHILE A NOTICE IS VISIBLE. The design's own trigger; no client
	 * floor, deliberately (see the file docstring).
	 */
	const showsNotice = quotaNoticeShows(notice.data);
	useEffect(() => {
		if (!showsNotice) return;
		const onFocus = () => {
			void refetchNotice();
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [showsNotice, refetchNotice]);

	const resend = quotaResendView(resendState, nowMs);
	/*
	 * ONE STATUS SLOT. The resend press's outcome wins while it has one (it
	 * describes the press the user just made); otherwise the re-read's cue.
	 * They cannot both be live in practice, and a single slot is what keeps
	 * the row's geometry stable when either appears.
	 */
	const statusSentence = resend.sentence ?? quotaRefreshSentence(refreshCue);

	if (answer === null || dismissed) return { visible: false };
	return {
		visible: true,
		state: answer.state,
		provider: answerProvider,
		body: answer.body,
		actions: quotaNoticeActions(answer.actions, resend.offered),
		resend,
		resendPhase: resendState.kind,
		statusSentence,
		refreshing,
		onOpenUrl: (url: string) => {
			void openUrlTarget(url);
		},
		onRefresh: refreshNotice,
		onResend: sendResend,
		onDismiss: dismiss,
	};
}
