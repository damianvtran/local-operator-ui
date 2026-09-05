/**
 * @file use-radient-prices-query.ts
 * @description
 * React Query hook for fetching Radient default credit prices.
 */

import { radientProxy } from "@shared/api/radient/proxy";
import type { PricesResponse } from "@shared/api/radient/types";
import { useQuery } from "@tanstack/react-query";

// Query keys for Radient prices data
export const radientPricesKeys = {
	all: ["radient-prices"] as const,
	prices: () => [...radientPricesKeys.all, "prices"] as const,
};

/**
 * Hook for fetching Radient default credit prices using React Query.
 * This endpoint is public and doesn't require authentication.
 *
 * @returns Query result with prices data, loading state, and error state.
 */
export const useRadientPricesQuery = () => {
	// Query for the prices information
	const pricesQuery = useQuery({
		// Use the defined query key
		queryKey: radientPricesKeys.prices(),
		// The query function calls the fetchPrices method from the client
		queryFn: async () => {
			try {
				// Prices are public upstream; the proxy still routes them so the
				// renderer has one Radient path.
				return await radientProxy<PricesResponse>({ operation: "prices" });
			} catch (error) {
				console.error("Failed to fetch Radient prices:", error);
				// Re-throw the error to be handled by react-query
				throw error;
			}
		},
		// This data is fairly static, so we can set a longer stale time
		staleTime: 1000 * 60 * 60, // 1 hour
		// Refetch only on mount or if stale, not on window focus or interval
		refetchOnWindowFocus: false,
		refetchOnMount: true,
		refetchInterval: false,
		// Retry on failure a few times
		retry: 3,
	});

	return {
		// Prices data (default_new_credits, default_registration_credits)
		prices: pricesQuery.data,

		// Loading and error states from react-query
		isLoading: pricesQuery.isLoading,
		isFetching: pricesQuery.isFetching,
		error: pricesQuery.error,

		// Raw query object for advanced usage if needed
		pricesQuery,
	};
};
