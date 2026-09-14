/**
 * Radient default credit prices, through the backend proxy.
 *
 * Prices are public upstream, but the renderer still routes them through the
 * desktop proxy so there is exactly one Radient path and no renderer-owned
 * client or base URL to keep in step with the backend's credential handling.
 */

import { radientProxy } from "@shared/api/radient/proxy";
import type { PricesResponse } from "@shared/api/radient/types";
import { useQuery } from "@tanstack/react-query";

// Query keys for Radient prices data
export const radientPricesKeys = {
	all: ["radient-prices"] as const,
	prices: () => [...radientPricesKeys.all, "prices"] as const,
};

export const useRadientPricesQuery = () => {
	const pricesQuery = useQuery({
		queryKey: radientPricesKeys.prices(),
		queryFn: () => radientProxy<PricesResponse>({ operation: "prices" }),
		// Prices change rarely; an hour avoids re-fetching on every settings
		// visit without letting a price change go unnoticed for a session.
		staleTime: 1000 * 60 * 60,
		refetchOnWindowFocus: false,
		refetchOnMount: true,
		refetchInterval: false,
		retry: 3,
	});

	return {
		prices: pricesQuery.data,
		isLoading: pricesQuery.isLoading,
		isFetching: pricesQuery.isFetching,
		error: pricesQuery.error,
		pricesQuery,
	};
};
