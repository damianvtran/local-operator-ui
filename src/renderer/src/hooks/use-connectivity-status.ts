/**
 * Hook for checking connectivity status
 *
 * This hook checks:
 * 1. If the server is online (via health check)
 * 2. If the user is connected to the internet (when hosting provider is not "Ollama")
 */

import { HealthApi } from "@renderer/api/local-operator/health-api";
import { apiConfig } from "@renderer/config";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "./use-config";

/**
 * Query key for server health check
 */
export const serverHealthQueryKey = ["server-health"];

/**
 * Query key for internet connectivity check
 */
export const internetConnectivityQueryKey = ["internet-connectivity"];

/**
 * Hook for checking if the server is online
 *
 * @param refetchInterval - Interval in milliseconds to refetch health status (default: 5000 - 5 seconds)
 * @returns Query result with server health status
 */
export const useServerHealth = (refetchInterval = 5000) => {
	return useQuery({
		queryKey: serverHealthQueryKey,
		queryFn: async () => {
			try {
				await HealthApi.healthCheck(apiConfig.baseUrl);
				return true; // Server is online
			} catch (error) {
				return false; // Server is offline
			}
		},
		// Refetch at specified interval
		refetchInterval,
		// Enable background refetching
		refetchIntervalInBackground: true,
		// Don't retry on failure as this is expected when server is down
		retry: false,
		// Always refetch on window focus to get latest status
		refetchOnWindowFocus: true,
		// Use placeholderData instead of keepPreviousData (which is deprecated)
		placeholderData: (previousData) => previousData,
	});
};

/**
 * Hook for checking if the user is connected to the internet
 *
 * @param refetchInterval - Interval in milliseconds to refetch connectivity status (default: 5000 - 5 seconds)
 * @returns Query result with internet connectivity status
 */
export const useInternetConnectivity = (refetchInterval = 5000) => {
	return useQuery({
		queryKey: internetConnectivityQueryKey,
		queryFn: async () => {
			// First check navigator.onLine for basic connectivity
			if (!navigator.onLine) {
				return false;
			}

			// For a more reliable check, use the browser's fetch API with a timeout
			// to detect if we can make network requests
			try {
				// Create an AbortController to implement timeout
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 5000);

				// Try to connect to a reliable DNS server
				// This avoids depending on third-party websites
				await fetch("https://1.1.1.1/cdn-cgi/trace", {
					method: "HEAD",
					mode: "no-cors",
					cache: "no-store",
					signal: controller.signal,
				});

				clearTimeout(timeoutId);
				return true; // Internet is connected
			} catch (error) {
				// If fetch fails or times out, we're offline
				return false; // Internet is disconnected
			}
		},
		// Refetch at specified interval
		refetchInterval,
		// Enable background refetching
		refetchIntervalInBackground: true,
		// Don't retry on failure as this is expected when internet is down
		retry: false,
		// Always refetch on window focus to get latest status
		refetchOnWindowFocus: true,
		// Use placeholderData instead of keepPreviousData (which is deprecated)
		placeholderData: (previousData) => previousData,
	});
};

/**
 * Hook for checking overall connectivity status
 *
 * @param serverRefetchInterval - Interval for server health check (default: 5000 - 5 seconds)
 * @param internetRefetchInterval - Interval for internet connectivity check (default: 5000 - 5 seconds)
 * @returns Object with connectivity status information
 */
export const useConnectivityStatus = (
	serverRefetchInterval = 5000,
	internetRefetchInterval = 5000,
) => {
	// Get server health status
	const {
		data: isServerOnline = true, // Default to true to avoid false positives on initial load
		isLoading: isServerStatusLoading,
		refetch: refetchServerStatus,
	} = useServerHealth(serverRefetchInterval);

	// Get config to check hosting provider
	const { data: config, isLoading: isConfigLoading } = useConfig();

	// Get hosting provider from config
	const hostingProvider = config?.values.hosting || "";

	// Only check internet connectivity if hosting provider is not "Ollama"
	const shouldCheckInternet = hostingProvider.toLowerCase() !== "ollama";

	// Get internet connectivity status
	const {
		data: isOnline = true, // Default to true to avoid false positives on initial load
		isLoading: isInternetStatusLoading,
		refetch: refetchInternetStatus,
	} = useInternetConnectivity(internetRefetchInterval);

	// Determine if there's a connectivity issue
	const hasConnectivityIssue =
		!isServerOnline || (shouldCheckInternet && !isOnline);

	// Determine the specific issue
	const connectivityIssue = !isServerOnline
		? "server_offline"
		: shouldCheckInternet && !isOnline
			? "internet_offline"
			: null;

	return {
		isServerOnline,
		isOnline,
		hostingProvider,
		shouldCheckInternet,
		hasConnectivityIssue,
		connectivityIssue,
		isLoading:
			isServerStatusLoading ||
			(shouldCheckInternet && isInternetStatusLoading) ||
			isConfigLoading,
		refetchServerStatus,
		refetchInternetStatus,
	};
};
