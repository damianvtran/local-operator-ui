import { radientProxy } from "@shared/api/radient/proxy";
import type { CreditBalanceResult } from "@shared/api/radient/types";
/**
 * React Query hook for fetching Radient credit balance through the backend
 * proxy. The backend resolves the tenant's credential; the renderer supplies
 * only the tenant identifier from the account it already loaded.
 */
import { useQuery } from "@tanstack/react-query";
import { useRadientUserQuery } from "./use-radient-user-query";

const QUERY_KEY = ["radient", "creditBalance"];

export const useCreditBalance = (options?: { enabled?: boolean }) => {
	const { user, isAuthenticated } = useRadientUserQuery();
	const tenantId = user?.account?.tenant_id;
	const isEnabled = isAuthenticated && !!tenantId && (options?.enabled ?? true);

	return useQuery<CreditBalanceResult, Error>({
		queryKey: [QUERY_KEY, tenantId],
		queryFn: async () => {
			if (!tenantId) throw new Error("Tenant ID not available");
			const result = await radientProxy<CreditBalanceResult>({
				operation: "credits",
				tenantId,
			});
			if (!result || typeof result.balance !== "number") {
				throw new Error("Invalid credit balance response format");
			}
			return result;
		},
		enabled: isEnabled,
		staleTime: 5 * 60 * 1000,
		refetchOnWindowFocus: true,
	});
};
