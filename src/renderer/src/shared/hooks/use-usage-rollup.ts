import { radientProxy } from "@shared/api/radient/proxy";
import type {
	UsageRollupRequestParams,
	UsageRollupResponse,
} from "@shared/api/radient/types";
/**
 * React Query hook for fetching Radient usage rollup data through the backend
 * proxy. Query fields are the proxy's allow-list for the usage operation.
 */
import { useQuery } from "@tanstack/react-query";
import { useRadientUserQuery } from "./use-radient-user-query";

const QUERY_KEY_BASE = ["radient", "usageRollup"];

export const useUsageRollup = (
	params: UsageRollupRequestParams,
	options?: { enabled?: boolean },
) => {
	const { user, isAuthenticated } = useRadientUserQuery();
	const tenantId = user?.account?.tenant_id;
	const isEnabled = isAuthenticated && !!tenantId && (options?.enabled ?? true);

	return useQuery<UsageRollupResponse, Error>({
		queryKey: [...QUERY_KEY_BASE, tenantId, params],
		queryFn: async () => {
			if (!tenantId) throw new Error("Tenant ID not available");
			const query: Record<string, string> = {};
			for (const [key, value] of Object.entries(params)) {
				if (value !== undefined && value !== null) query[key] = String(value);
			}
			const result = await radientProxy<UsageRollupResponse>({
				operation: "usage",
				tenantId,
				query,
			});
			if (!result) throw new Error("Invalid usage rollup response format");
			return result;
		},
		enabled: isEnabled,
		staleTime: 5 * 60 * 1000,
		refetchOnWindowFocus: true,
	});
};
