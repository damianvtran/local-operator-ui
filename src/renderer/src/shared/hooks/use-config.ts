/**
 * Hook for fetching configuration from the Local Operator API
 *
 * This hook is special and does not use the connectivity gate
 * since it's used by the connectivity gate itself to determine the hosting provider.
 */

import {
	type ConfigResponse,
	createLocalOperatorClient,
} from "@shared/api/local-operator";
import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { apiConfig } from "@shared/config";
import { useQuery } from "@tanstack/react-query";

/**
 * Query key for configuration
 */
export const configQueryKey = ["config"];

/**
 * Hook for fetching configuration from the Local Operator API
 *
 * @returns Query result with configuration data, loading state, error state, and refetch function
 */
export const useConfig = () => {
	return useQuery({
		// Always enable this query since it's needed for connectivity checks
		enabled: true,
		queryKey: configQueryKey,
		queryFn: async (): Promise<ConfigResponse | null> => {
			// No toast on failure, for the same reason as `use-credentials`: this
			// is the probe the connectivity gate itself runs, so it fires on mount
			// from every surface at once and its failure is a standing condition,
			// not an event. Raising a toast per caller quoting the raw exception
			// ("Failed to fetch") put a browser string on top of the conversation
			// while the persistent connectivity banner was already saying the true
			// thing once. The error still propagates to callers.
			const client = createLocalOperatorClient(apiConfig.baseUrl);
			const response = await client.config.getConfig();

			if (response.status >= 400) {
				// An envelope that carries its own failure status, from a transport
				// that returned 2xx. Thrown with that status attached for the same
				// reason `config-api` does: a plain `Error` classifies as "nothing
				// answered", so a server that answered and refused would be reported
				// to the user as one that is not running.
				throw new DesktopControlError(
					response.status,
					response.message || "Failed to fetch configuration",
				);
			}

			return response.result as ConfigResponse;
		},
		// Prevent automatic refetches on window focus
		refetchOnWindowFocus: false,
		// Prevent stale time to avoid unnecessary refetches
		staleTime: 5000,
		// This is the query in issue 89's title, and it inherited the client's
		// `retry: 1`. When the desktop transport's deadline rejects, that default
		// re-waits the ENTIRE deadline a second time -- 30s, then 30s again --
		// which is 60s of unbroken spinner before the error state can render. The
		// deadline already means "we waited the whole budget and nothing came
		// back"; asking again on a path known to be dead cannot learn more. A
		// failure that carries a real HTTP status came from a backend that DID
		// answer, so it keeps the retry.
		retry: retryDesktopQuery,
	});
};
