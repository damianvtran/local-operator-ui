/**
 * Hook for fetching credentials from the Local Operator API
 *
 * This hook is gated by connectivity checks to ensure the server is online
 * and the user has internet connectivity if required by the hosting provider.
 */

import { createLocalOperatorClient } from "@shared/api/local-operator";
import type { CredentialListResult } from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config";
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
 * The two need different copy: one sends the reader to the settings page, the
 * other tells them the feature is waiting on the server. Sending someone to
 * fix an account that is not broken is the worse mistake, so the ambiguity is
 * resolved once, here, rather than at each call site.
 *
 * `isPending && fetchStatus === "idle"` is react-query's shape for a query the
 * connectivity gate disabled: pending forever, never fetching.
 *
 * THE SESSION IS THE FIRST SATISFIER, THE FILE THE SECOND (issue #674). The
 * legacy `/v1/credentials` list is the `credentials.env` file; a Radient
 * sign-in lands in the backend's auth store instead, which is the store the
 * backend's own speech and transcription routes resolve first
 * (`resolve_radient_credential`: auth store, then the legacy key). Reading the
 * file alone therefore left a signed-in user's mic and speech controls
 * disabled while the backend they guard would have served the request — and
 * the disabled copy told the user to sign in to the account they were signed
 * in to. The capability mirrors the backend's precedence now: a live Radient
 * session first, the legacy key after it, the offline case stated over both.
 */
export const useRadientCredentialProbe = () => {
	const { data, isError, isPending, fetchStatus, refetch } = useCredentials();
	const { isAuthenticated } = useRadientAuth();

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
	 * first, the legacy key after it — and the offline term over both, because
	 * with the server unreachable neither tier can serve the request the control
	 * is asking about (a sign-in does not make the media relay reachable).
	 */
	const canUseRadientSpeech =
		(hasRadientSession || hasRadientApiKey) && !isUnavailable;

	return {
		hasRadientApiKey,
		hasRadientSession,
		/** The probe could not answer. Offline, not unconfigured. */
		isUnavailable,
		/** Whether a speech surface (dictation, speak-aloud) may be enabled. */
		canUseRadientSpeech,
	};
};
