/**
 * Hook for gating React Query hooks based on connectivity status
 *
 * This hook provides a wrapper for React Query hooks that checks:
 * 1. If the server is online - if not, queries will be disabled
 * 2. If the user is connected to the internet (when hosting provider is not "Ollama") -
 *    this only affects the banner display and does not disable queries to the local backend
 *
 * Only server offline issues will disable queries to the backend.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useConnectivityStatus } from "./use-connectivity-status";

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
		refetchInternetStatus,
	} = useConnectivityStatus();

	const queryClient = useQueryClient();

	// Add direct event listeners for online/offline events to ensure immediate response
	useEffect(() => {
		const handleOnline = () => {
			// Immediately refetch internet status when online event fires
			refetchInternetStatus();

			// Invalidate and refetch all queries to ensure they're updated with new connectivity status
			queryClient.invalidateQueries({
				// Force refetch to ensure queries are updated with new connectivity status
				refetchType: "all",
			});
		};

		const handleOffline = () => {
			// Immediately refetch internet status when offline event fires
			refetchInternetStatus();

			// Invalidate and refetch all queries except connectivity-related ones
			// to ensure they're updated with the new connectivity status
			queryClient.invalidateQueries({
				predicate: (query) => {
					const queryKey = query.queryKey[0];
					return (
						queryKey !== "server-health" &&
						queryKey !== "internet-connectivity" &&
						queryKey !== "config"
					);
				},
				// Force refetch to ensure queries are updated with new connectivity status
				refetchType: "active",
			});
		};

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);

		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, [refetchInternetStatus, queryClient]);

	/**
	 * Refresh what the server's absence paused, at the moment it comes back.
	 *
	 * WHY this replaced "invalidate when the server goes offline". That invalidation
	 * ran on the way DOWN, with `refetchType: "active"`, against queries whose own
	 * gate had just disabled them - so a flap re-ran reads that could only fail,
	 * replaced rendered rows with an error, and discarded in-flight work at exactly
	 * the moment the daemon was least able to answer. The user's report is the
	 * result: after a reload nothing loaded, and only a later reload brought the
	 * conversations back. Nothing here cancels anything on the way down: the reads
	 * that are already rendered stay rendered, and what the app owes the user on
	 * the way back up is a re-read.
	 */
	const wasOffline = useRef(false);
	useEffect(() => {
		if (isLoading) return;
		if (!isServerOnline) {
			wasOffline.current = true;
			return;
		}
		if (!wasOffline.current) return;
		wasOffline.current = false;
		queryClient.invalidateQueries({
			predicate: (query) => {
				const queryKey = query.queryKey[0];
				return (
					queryKey !== "server-health" &&
					queryKey !== "internet-connectivity" &&
					queryKey !== "config"
				);
			},
			// Bounded by the server's own return, not by a schedule: main has just
			// reported a live connection, so these reads are the ones that can be
			// answered now.
			refetchType: "active",
		});
	}, [isServerOnline, isLoading, queryClient]);

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
		// This is the only check that should disable queries to the backend
		if (!options?.bypassServerCheck && !isServerOnline) {
			return false;
		}

		// Internet connectivity should not disable queries to the local backend
		// The banner will still show for internet connectivity issues when needed

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

		// Only return an error for server offline issues
		// This is the only condition that should prevent queries to the backend
		if (!isServerOnline) {
			return new Error("Server is offline. Please check your connection.");
		}

		// Internet connectivity issues should show a banner but not return an error
		// for local backend queries

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
