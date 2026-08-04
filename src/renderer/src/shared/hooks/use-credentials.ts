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
import { useEffect } from "react";
import { useConnectivityGate } from "./use-connectivity-gate";

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
 */
export const useRadientCredentialProbe = () => {
	const { data, isError, isPending, fetchStatus } = useCredentials();

	return {
		hasRadientApiKey: Boolean(data?.keys?.includes("RADIENT_API_KEY")),
		/** The probe could not answer. Offline, not unconfigured. */
		isUnavailable: isError || (isPending && fetchStatus === "idle"),
	};
};
