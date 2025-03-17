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
import { useEffect, useState } from "react";
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
	// Track the online status with useState
	const [isOnlineState, setIsOnlineState] = useState(navigator.onLine);

	// Set up event listeners for online/offline events
	useEffect(() => {
		const handleOnline = () => {
			setIsOnlineState(true);
		};

		const handleOffline = () => {
			setIsOnlineState(false);
		};

		// Add event listeners
		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);

		// Clean up event listeners on unmount
		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	return useQuery({
		queryKey: internetConnectivityQueryKey,
		queryFn: async () => {
			// First check our state which is updated by event listeners
			if (!isOnlineState) {
				return false;
			}

			// Also check navigator.onLine for basic connectivity
			if (!navigator.onLine) {
				return false;
			}

			// For a more reliable check, use the browser's fetch API with a timeout
			// to detect if we can make network requests
			try {
				// Create an AbortController to implement timeout
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 3000); // Shorter timeout for faster detection

				// Try multiple reliable endpoints to ensure we're really checking internet connectivity
				// and not just a single service being down
				const endpoints = [
					"https://1.1.1.1/cdn-cgi/trace", // Cloudflare DNS
				];

				// Try each endpoint until one succeeds
				for (const endpoint of endpoints) {
					try {
						await fetch(endpoint, {
							method: "HEAD",
							mode: "no-cors",
							cache: "no-store",
							signal: controller.signal,
						});

						clearTimeout(timeoutId);
						return true;
					} catch (e) {
						// Try the next endpoint
					}
				}

				clearTimeout(timeoutId);
				return false;
			} catch (error) {
				return false;
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

	// Add event listeners for online/offline events
	useEffect(() => {
		// Function to handle online event
		const handleOnline = () => {
			// Immediately refetch to confirm
			refetchInternetStatus();
		};

		// Function to handle offline event
		const handleOffline = () => {
			// Immediately refetch to confirm
			refetchInternetStatus();
		};

		// Add event listeners
		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);

		// Clean up event listeners on unmount
		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, [refetchInternetStatus]);

	// Determine if there's a connectivity issue
	// We need to check both server and internet connectivity
	// Internet connectivity is only required for certain hosting providers (not Ollama)
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
