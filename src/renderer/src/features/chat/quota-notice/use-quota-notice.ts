/**
 * @file use-quota-notice.ts
 * @description
 * The composer's read of the pre-emptive quota notice: one query against
 * `GET /v1/desktop/quota-notice`, the local dismiss state, and the resend
 * action's press lifecycle.
 *
 * WHERE THIS RUNS. The line mounts on the EMPTY chat band only (see the mount
 * in `message-input.tsx`), so "enabled only on an empty session" is expressed
 * by the mount rather than by a prop: the read cannot run on a session with
 * content. `refetchOnMount`/a remount per conversation identity (the chat page
 * keys the session panel by identity) is what makes "refetch on session open"
 * true without a session parameter.
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
	type QuotaResendState,
	type QuotaResendView,
	classifyResendFailure,
	quotaNoticeActions,
	quotaNoticeDismissed,
	quotaNoticeShows,
	quotaNoticeSignature,
	quotaResendView,
	readQuotaNoticeDismissal,
	writeQuotaNoticeDismissal,
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
 * misreport an EXPIRED cooldown as `idle`.
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
			refreshing: boolean;
			onOpenUrl: (url: string) => void;
			onRefresh: () => void;
			onResend: () => void;
			onDismiss: () => void;
	  };

export function useQuotaNotice(): QuotaNoticeModel {
	const { client, provided } = useOptionalQueryClient();
	const capabilities = useDesktopCapabilities();
	const featureEnabled = desktopFeatureEnabled(
		capabilities.data,
		"quota_notice",
	);

	/*
	 * The selection, restated from `useDefaultModel` (see the file docstring):
	 * the config store is what both the route's fallback and the renderer read,
	 * so the two cannot disagree about which account is being checked.
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
	const provider = config.data?.values?.hosting || null;
	const model = config.data?.values?.model_name || null;

	/*
	 * THE READ WAITS FOR THE CONFIG to answer, because its key carries the
	 * selection: a read on the pre-config key (`\"\"`) would fetch one answer for
	 * an unresolved selection and a second the moment the values land — two
	 * backend probes for one session open, which is the load the design
	 * measures. `isFetched` (settled, error or success) rather than
	 * `data !== undefined`: a failed config read still proceeds, so the route's
	 * own config fallback answers the same question.
	 */
	const notice = useQuery(
		quotaNoticeQueryOptions(
			provider,
			model,
			provided && featureEnabled && config.isFetched,
		),
		client,
	);
	const refetchNotice = notice.refetch;

	const census = useQuery(
		credentialCensusOptions(provided && featureEnabled),
		client,
	);

	/*
	 * FOCUS, WHILE A NOTICE IS VISIBLE (the design's own wording). A hidden or
	 * silent answer is not re-asked on focus; a shown one is, so a top-up made
	 * in another window clears the warning without a restart.
	 */
	const showsNotice = quotaNoticeShows(notice.data);
	useEffect(() => {
		if (!provided || !featureEnabled || !showsNotice) return;
		const onFocus = () => void refetchNotice();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [provided, featureEnabled, showsNotice, refetchNotice]);

	/*
	 * AFTER LOGIN. The census read above is the signal: a credential landing or
	 * leaving changes the string, and the notice's evidence is about exactly
	 * that set. The first observation only SEEDS the ref -- a mount is not a
	 * login -- so this cannot double-ask beside `refetchOnMount`.
	 */
	const censusSignal = credentialCensusSignal(census.data);
	const lastCensusSignal = useRef<string | null>(null);
	useEffect(() => {
		if (!provided || !featureEnabled) return;
		if (censusSignal === null) return;
		const previous = lastCensusSignal.current;
		lastCensusSignal.current = censusSignal;
		if (previous !== null && previous !== censusSignal) void refetchNotice();
	}, [provided, featureEnabled, censusSignal, refetchNotice]);

	/*
	 * THE EXPLICIT RE-ASK. The wire's `refresh` actions ("I topped up", "I
	 * verified", "Check again") and the 409 arm below both mean "ask again and
	 * mean it": the forced fetch bypasses the route's cache floor, and its
	 * answer is written into the cache the line reads, so the two cannot hold
	 * different stories. A failed re-ask changes nothing -- the last answer
	 * stands, because a failed probe proves nothing about the account.
	 */
	const [refreshing, setRefreshing] = useState(false);
	const refreshingRef = useRef(false);
	const refreshNotice = useCallback(() => {
		if (!provided || !featureEnabled || refreshingRef.current) return;
		refreshingRef.current = true;
		setRefreshing(true);
		void (async () => {
			try {
				/*
				 * A DIRECT read rather than `fetchQuery`: react-query's fetch path
				 * answers from a fresh cache entry without touching the route, which
				 * is the opposite of what this press means. The answer is written
				 * back with `setQueryData`, so the line reads one cache row whichever
				 * call produced it.
				 */
				const answer = await desktopResult<QuotaNotice>({
					op: "quota.notice",
					refresh: true,
					...(provider ? { provider } : {}),
					...(model ? { model } : {}),
				});
				client.setQueryData(quotaNoticeQueryKey(provider, model), answer);
			} catch {
				/* See above: the last answer stands. */
			} finally {
				refreshingRef.current = false;
				setRefreshing(false);
			}
		})();
	}, [provided, featureEnabled, client, provider, model]);

	/*
	 * THE RESEND PRESS, its phases and its clock. `nowMs` ticks only while a
	 * deadline is live (the 120 s cooldown after `sent`/`rate_limited`), which
	 * is what re-enables the button when the window passes; the phase's own
	 * sentences and the disabled rule live in `quota-notice.ts` so they are
	 * testable without waiting anything out.
	 */
	const [resendState, setResendState] = useState<QuotaResendState>({
		kind: "idle",
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

	const sendResend = useCallback(() => {
		if (!provided) return;
		const view = quotaResendView(resendState, Date.now());
		if (view.disabled || !view.offered) return;
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
				setResendState({
					kind: "sent",
					until: Date.now() + QUOTA_RESEND_COOLDOWN_MS,
				});
			} catch (error) {
				const failure = classifyResendFailure(error);
				if (failure.kind === "rate_limited") {
					setResendState({
						kind: "rate_limited",
						until: Date.now() + QUOTA_RESEND_COOLDOWN_MS,
					});
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
					/* Retryable (a blip, an upstream failure): the press stays offered. */
					setResendState({ kind: "idle" });
				}
			}
		})();
	}, [provided, resendState, refreshNotice]);

	/* The dismissal: local, per (provider, state), re-armed by a state change. */
	const [storedDismissal, setStoredDismissal] = useState<string | null>(() =>
		readQuotaNoticeDismissal(),
	);
	const answer = quotaNoticeShows(notice.data) ? notice.data : null;
	const signature = answer
		? quotaNoticeSignature(answer.provider || provider || "", answer.state)
		: "";
	const dismissed = quotaNoticeDismissed(storedDismissal, signature);
	const dismiss = useCallback(() => {
		if (!signature) return;
		writeQuotaNoticeDismissal(signature);
		setStoredDismissal(signature);
	}, [signature]);

	const resend = quotaResendView(resendState, nowMs);
	if (answer === null || dismissed) return { visible: false };
	return {
		visible: true,
		state: answer.state,
		provider: answer.provider || provider || "",
		body: answer.body,
		actions: quotaNoticeActions(answer.actions, resend.offered),
		resend,
		resendPhase: resendState.kind,
		refreshing,
		onOpenUrl: (url: string) => {
			void openUrlTarget(url);
		},
		onRefresh: refreshNotice,
		onResend: sendResend,
		onDismiss: dismiss,
	};
}
