/**
 * Hook for fetching credentials from the Local Operator API
 *
 * This hook is gated by connectivity checks to ensure the server is online
 * and the user has internet connectivity if required by the hosting provider.
 */

import { createLocalOperatorClient } from "@shared/api/local-operator";
import { useDesktopCapabilities } from "@shared/api/local-operator/desktop-hooks";
import type { CredentialListResult } from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config";
import { radientSpeechBlock } from "@shared/lib/speech-gate";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useConnectivityGate } from "./use-connectivity-gate";
import { useRadientAuth } from "./use-radient-auth";

/**
 * Query key for credentials
 */
export const credentialsQueryKey = ["credentials"];

/**
 * Hook for fetching credentials from the Local Operator API
 *
 * @returns Query result with credentials data, loading state, error state, and refetch function
 */
export const useCredentials = () => {
	// Use the connectivity gate to check if the query should be enabled
	// Bypass internet check for credential queries as they only need local server connectivity
	const { shouldEnableQuery, getConnectivityError } = useConnectivityGate();

	// Get the connectivity error if any
	const connectivityError = getConnectivityError();

	// Log connectivity error if present
	useEffect(() => {
		if (connectivityError) {
			console.error(
				"Credentials connectivity error:",
				connectivityError.message,
			);
		}
	}, [connectivityError]);

	return useQuery({
		// Only enable the query if server is online (bypass internet check)
		enabled: shouldEnableQuery({ bypassInternetCheck: true }),
		queryKey: credentialsQueryKey,
		queryFn: async (): Promise<CredentialListResult | null> => {
			// No toast on failure, deliberately.
			//
			// Nine of this hook's ten call sites are capability probes: the chat
			// composer asking whether speech is configured, a message row asking
			// whether "speak aloud" should be enabled. When the local server is
			// down every one of them fails at once, and this used to raise a
			// toast quoting the raw exception — "Failed to fetch" — floating over
			// the conversation. That is the wrong channel three times over: the
			// user did not ask for it, the persistent connectivity banner already
			// says the server is offline, and an exception string is not an error
			// message (docs/branding.md § 8: what happened, what it means, what
			// to do).
			//
			// The failure still propagates as a query error, which is what the
			// one call site that is *about* credentials — the settings page —
			// already renders inline.
			const client = createLocalOperatorClient(apiConfig.baseUrl);
			const response = await client.credentials.listCredentials();

			if (response.status >= 400) {
				throw new Error(response.message || "Failed to fetch credentials");
			}

			return response.result as CredentialListResult;
		},
		// Prevent automatic refetches on window focus
		refetchOnWindowFocus: false,
		// Prevent stale time to avoid unnecessary refetches
		staleTime: 5000,
	});
};

/**
 * The credentials probe, read as a capability question.
 *
 * Nine of this hook's ten call sites only want to know whether a Radient key
 * is present so they can enable a button. They all used to derive that from
 * `data?.keys` alone, which cannot tell "no key is configured" apart from
 * "the probe never ran because the server is down" — both produce no keys.
 * THE SESSION IS THE FIRST SATISFIER, THE FILE THE SECOND (issue #674). The
 * legacy `/v1/credentials` list is the `credentials.env` file; a Radient
 * sign-in lands in the backend's auth store instead, which is the store the
 * backend's own speech and transcription routes resolve first
 * (`resolve_radient_credential`: auth store, then the legacy key). Reading the
 * file alone therefore left a signed-in user's mic and speech controls
 * disabled while the backend they guard would have served the request — and
 * the disabled copy told the user to sign in to the account they were signed
 * in to.
 *
 * ONE QUALIFICATION ON "THE BACKEND'S PRECEDENCE" (agent review round 1, NIT):
 * the backend consults the auth store first only for a CANONICAL Radient
 * destination. A non-canonical `RADIENT_API_BASE_URL` (a legacy gateway
 * deployment) resolves the legacy key alone and never reads the session —
 * `resolve_radient_credential`'s first branch. That branch has no channel to
 * this renderer (the base URL lives in the daemon's environment), so the app
 * cannot distinguish the two deployments: on the non-canonical one the
 * session tier here would enable a control the backend then refuses — a
 * false-enable this file cannot detect, stated rather than assumed away.
 *
 * The capability reads: the local server must be up (the connectivity gate's
 * reading; with it down neither tier can serve the request, and the offline
 * sentence and banner describe exactly that state), and then the session OR
 * the legacy key. The session stands on its own — both reads travel the same
 * desktop transport, so a failed file list beside an ANSWERED account read
 * does not erase a live session (design/UX round 1 rework) — while the file
 * probe's own failure closes the key branch.
 *
 * THE BLOCK IS THE COPY'S INPUT, NOT A SECOND GATE. `speechBlock` classifies
 * the same reading for the disabled tooltip (`@shared/lib/speech-gate`), where
 * `sign-in` is reachable only when the account read ANSWERED no: an outage or
 * an in-flight read must not send a signed-in user to the settings page.
 *
 * AND THE FEATURE NEGOTIATION IS THE LADDER'S FIRST INPUT (design round 2,
 * D6): the account read is DISABLED until the capabilities read answers, and a
 * disabled query reports no data and no error — so on a cold mount, and
 * through every capabilities outage, the account's `signed-out` is silence
 * rather than an answer, and it classified as a sign-in for exactly that
 * window. The block therefore reads the negotiation's own state (`pending` ->
 * `checking`, `error` -> `could-not-check`) before the account classes.
 *
 * `isPending && fetchStatus === "idle"` is react-query's shape for a query the
 * connectivity gate disabled: pending forever, never fetching.
 */
export const useRadientCredentialProbe = () => {
	const { data, isError, isPending, fetchStatus, refetch } = useCredentials();
	const {
		isAuthenticated,
		accountRead,
		/* `unavailable` = the backend cannot serve Radient at all. */
		unavailable: accountUnavailable,
	} = useRadientAuth();
	const { isServerOnline } = useConnectivityGate();
	const capabilities = useDesktopCapabilities();

	/**
	 * The capabilities read's own state, for the block's gate arm: `pending`
	 * before anything has asked, `error` when the negotiation itself failed —
	 * in both windows the account read was never able to ask, and its silence
	 * must not become a sentence about the account (design round 2, D6).
	 */
	const capabilitiesState: "pending" | "error" | "answered" =
		capabilities.isPending
			? "pending"
			: capabilities.isError
				? "error"
				: "answered";

	/** The legacy question: the credentials file lists a Radient API key. */
	const hasRadientApiKey = Boolean(data?.keys?.includes("RADIENT_API_KEY"));

	/**
	 * The session question: the account read ANSWERED with a signed-in account.
	 * `isAuthenticated` is `!!data && !loading` on that query, so a read that
	 * failed or never ran cannot satisfy it — a refused or signed-out session
	 * does not enable speech, and its remedy (sign in again) is the copy the
	 * disabled control already carries.
	 */
	const hasRadientSession = isAuthenticated;

	/** The probe could not answer. Offline, not unconfigured. */
	const isUnavailable = isError || (isPending && fetchStatus === "idle");

	/*
	 * A RADIENT AUTH CHANGE RE-RUNS THE FILE PROBE.
	 *
	 * The session tier flips the capability by itself — its read is the account
	 * query, which every sign-in funnel already invalidates — but the file list
	 * has no funnel: a provisioned or replaced `RADIENT_API_KEY` lands beside a
	 * sign-in, and a surface mounted across the change would keep the pre-sign-in
	 * answer until something else happened to refetch it. Watching the session
	 * transition covers every path that moves it (the provider grid, the connect
	 * dialog, onboarding and the account section all land as this boolean
	 * flipping), including re-sign-ins the file probe was never told about.
	 *
	 * Nothing is refetched on the first mount: whatever stale read exists, the
	 * query's own initial fetch is already the fresh one.
	 */
	const previousSession = useRef(isAuthenticated);
	useEffect(() => {
		if (previousSession.current === isAuthenticated) return;
		previousSession.current = isAuthenticated;
		void refetch();
	}, [isAuthenticated, refetch]);

	/**
	 * The capability, in the backend's own precedence: a live Radient session
	 * first, the legacy key after it. The local server's own state gates both —
	 * with it unreachable neither tier can serve the request the control is
	 * asking about — while a file-list failure closes only the KEY branch: the
	 * account read travels the same transport, so its answer is the session
	 * tier's own witness.
	 */
	const canUseRadientSpeech =
		isServerOnline &&
		(hasRadientSession || (hasRadientApiKey && !isUnavailable));

	/**
	 * Why the control is off, for the tooltip: the one classification all four
	 * speech surfaces render from (`@shared/lib/speech-gate`). Always present
	 * (there is a reason even when the capability holds; a surface renders it
	 * only on the disabled arm).
	 */
	const speechBlock = radientSpeechBlock({
		serverOnline: isServerOnline,
		accountRead,
		accountUnavailable,
		capabilitiesState,
	});

	return {
		hasRadientApiKey,
		hasRadientSession,
		/** The probe could not answer. Offline, not unconfigured. */
		isUnavailable,
		/** Whether a speech surface (dictation, speak-aloud) may be enabled. */
		canUseRadientSpeech,
		/** The disabled tooltip's class (see speech-gate.ts). */
		speechBlock,
	};
};
