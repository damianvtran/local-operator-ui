/**
 * Hook for gating React Query hooks based on connectivity status
 *
 * This hook provides a wrapper for React Query hooks that checks:
 * 1. If the server is online
 * 2. If the user is connected to the internet (when hosting provider is not "Ollama")
 *
 * If either check fails, the query will be disabled and an error will be thrown.
 */

import { useConnectivityStatus } from "./use-connectivity-status";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Hook for gating React Query hooks based on connectivity status
 *
 * @returns An object with a function to check if a query should be enabled
 */
export const useConnectivityGate = () => {
	const {
		isServerOnline,
		isOnline,
		hostingProvider,
		shouldCheckInternet,
		hasConnectivityIssue,
		connectivityIssue,
		isLoading,
	} = useConnectivityStatus();

	const queryClient = useQueryClient();

	// When connectivity status changes, invalidate all queries except connectivity-related ones
	useEffect(() => {
		if (!isLoading && hasConnectivityIssue) {
			// Invalidate all queries except connectivity-related ones
			queryClient.invalidateQueries({
				predicate: (query) => {
					const queryKey = query.queryKey[0];
					return (
						queryKey !== "server-health" &&
						queryKey !== "internet-connectivity" &&
						queryKey !== "config"
					);
				},
			});
		}
	}, [hasConnectivityIssue, isLoading, queryClient]);

	/**
	 * Check if a query should be enabled based on connectivity status
	 *
	 * @param options - Options for the connectivity gate
	 * @returns Whether the query should be enabled
	 */
	const shouldEnableQuery = (options?: {
		/** Whether to bypass the server check */
		bypassServerCheck?: boolean;
		/** Whether to bypass the internet check */
		bypassInternetCheck?: boolean;
	}) => {
		// If still loading connectivity status, disable the query
		if (isLoading) {
			return false;
		}

		// Check server connectivity unless bypassed
		if (!options?.bypassServerCheck && !isServerOnline) {
			return false;
		}

		// For local server operations, we should always bypass the internet check
		// since the server runs locally and doesn't require internet connectivity
		const isLocalServerOperation = true; // Assume all operations are local server operations

		// Check internet connectivity unless bypassed, using Ollama, or it's a local server operation
		if (
			!options?.bypassInternetCheck &&
			!isLocalServerOperation &&
			shouldCheckInternet &&
			!isOnline
		) {
			return false;
		}

		// All checks passed, enable the query
		return true;
	};

	/**
	 * Get the error message for the current connectivity issue
	 *
	 * @returns The error message or null if no issue
	 */
	const getConnectivityError = (): Error | null => {
		if (isLoading) {
			return null;
		}

		if (!isServerOnline) {
			return new Error("Server is offline. Please check your connection.");
		}

		// For local server operations, we should not return an error for internet connectivity
		// since the server runs locally and doesn't require internet connectivity
		const isLocalServerOperation = true; // Assume all operations are local server operations

		if (!isLocalServerOperation && shouldCheckInternet && !isOnline) {
			return new Error(
				`Internet connection is required for the configured hosting provider (${hostingProvider}).`,
			);
		}

		return null;
	};

	return {
		shouldEnableQuery,
		getConnectivityError,
		isServerOnline,
		isOnline,
		hostingProvider,
		shouldCheckInternet,
		hasConnectivityIssue,
		connectivityIssue,
		isLoading,
	};
};
