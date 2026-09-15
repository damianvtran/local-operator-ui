/**
 * Hook for checking connectivity status
 *
 * This hook checks:
 * 1. If the server is online (via health check)
 * 2. If the user is connected to the internet (when hosting provider is not "Ollama")
 */

import { HealthApi } from "@shared/api/local-operator/health-api";
import { apiConfig, setDiscoveredBackendUrl } from "@shared/config";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { isServerReachable } from "../../../../shared/backend-status";
import type { DaemonStatusSnapshot } from "../../../../shared/backend-status";
import { useConfig } from "./use-config";

/**
 * Query key for server health check
 */
export const serverHealthQueryKey = ["server-health"];

/**
 * What the renderer knows about the server: the boolean every consumer gates on,
 * plus the snapshot it was derived from.
 *
 * The snapshot is carried rather than reduced to the boolean because the copy is
 * state-specific: `detached`, `wedged` and "reconnecting" need three different
 * sentences, and a surface given only `false` renders all three as "the server is
 * offline" - the sentence this change exists to remove.
 */
export type ServerHealthSignal = {
	online: boolean;
	snapshot: DaemonStatusSnapshot | null;
};

/**
 * Query key for internet connectivity check
 */
export const internetConnectivityQueryKey = ["internet-connectivity"];

/**
 * Hook for checking if the server is online
 *
 * The answer comes from the MAIN process (`window.api.backend`), not from a
 * fetch made here. The renderer used to read `/health` itself, from the
 * packaged app's `file://` document, which made a CORS decision - and, on a
 * claimed daemon, the origin allowlist - into a liveness signal: a change in
 * the backend's origin handling reported a healthy server as down, which is the
 * failure the daemon-discovery change exists to remove. Main sends no Origin
 * and holds the bearer, and it is the only process that knows whether the
 * daemon it attached to is still the daemon it attached to.
 *
 * A push subscription invalidates this query, so a state change is reflected
 * immediately instead of at the next poll; the interval stays as the safety net.
 *
 * The direct probe is kept as the FALLBACK for hosts with no desktop bridge
 * (Storybook, the browser dev server). It is a weaker answer - it cannot tell a
 * gated route from a dead server - and it is only reachable where there is no
 * main process to ask.
 *
 * @param refetchInterval - Interval in milliseconds to refetch health status (default: 5000 - 5 seconds)
 * @returns Query result with server health status
 */
export const useServerHealth = (refetchInterval = 5000) => {
	const queryClient = useQueryClient();

	useEffect(() => {
		const subscribe = window.api?.backend?.onStatusChange;
		if (!subscribe) return;
		return subscribe((snapshot) => {
			// Keep every direct renderer client on the daemon main is attached to:
			// discovery may have moved the app off the configured origin (that is
			// the point), and a renderer still dialling the old port would be a
			// second client of a second server.
			setDiscoveredBackendUrl(snapshot.url);
			void queryClient.invalidateQueries({ queryKey: serverHealthQueryKey });
		});
	}, [queryClient]);

	return useQuery({
		queryKey: serverHealthQueryKey,
		queryFn: async (): Promise<ServerHealthSignal> => {
			const bridge = window.api?.backend;
			if (bridge) {
				const snapshot = await bridge.getStatus();
				setDiscoveredBackendUrl(snapshot.url);
				// `degraded` is still a connection: one or two missed probes on a
				// daemon that is there. Only `detached` and `wedged` are not.
				return { online: isServerReachable(snapshot.state), snapshot };
			}
			try {
				await HealthApi.healthCheck(apiConfig.baseUrl);
				return { online: true, snapshot: null }; // Server is online
			} catch (_error) {
				return { online: false, snapshot: null }; // Server is offline
			}
		},
		// Refetch at specified interval
		refetchInterval,
		refetchIntervalInBackground: false,
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
 * Uses the browser's navigator.onLine property and online/offline events
 * to determine internet connectivity status.
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
			// Simply return the current online state from navigator.onLine
			// which is also kept in sync via the event listeners
			return isOnlineState && navigator.onLine;
		},
		// Refetch at specified interval
		refetchInterval,
		refetchIntervalInBackground: false,
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
 * @returns Object with connectivity status information
 */
export const useConnectivityStatus = (serverRefetchInterval = 5000) => {
	// Get server health status
	const {
		data: serverHealth,
		isLoading: isServerStatusLoading,
		refetch: refetchServerStatus,
	} = useServerHealth(serverRefetchInterval);
	// Default to true to avoid false positives on initial load.
	const isServerOnline = serverHealth?.online ?? true;
	// Null on a host with no desktop bridge, and while the first answer is in
	// flight: the banner then falls back to the sentence for "no bridge to ask".
	const serverSnapshot = serverHealth?.snapshot ?? null;

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
	} = useInternetConnectivity(serverRefetchInterval);

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
		serverSnapshot,
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
