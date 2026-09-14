/**
 * @file use-radient-user-query.ts
 * @description
 * Radient account state through the backend proxy.
 *
 * The backend AuthStore owns the Radient credential and its refresh; this
 * hook only asks the proxy who the signed-in account is. There is no renderer
 * session, no local token, no refresh mutation: a 409 from the proxy means no
 * Radient credential is stored, which is the signed-out state. Signing out
 * removes the stored provider account through the auth accounts route.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { radientProxy } from "@shared/api/radient/proxy";
import type { UserInfoResult } from "@shared/api/radient/types";
import { useUserStore } from "@shared/store/user-store";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// Query keys for Radient user data
export const radientUserKeys = {
	all: ["radient-user"] as const,
	user: () => [...radientUserKeys.all, "user"] as const,
};

type StoredAccount = {
	id: number;
	provider: string;
	type: string;
	identity_label: string;
	source: string;
	state: string;
};

function isSignedOut(error: unknown): boolean {
	// The proxy answers 409 with a fixed message when no Radient credential is
	// stored; that is the ordinary signed-out state, not a failure to surface.
	return error instanceof Error && /sign in to radient/i.test(error.message);
}

/**
 * Hook for the current Radient account, resolved by the backend.
 *
 * @returns Query result with user data, loading state, error state, and sign-out
 */
export const useRadientUserQuery = () => {
	const queryClient = useQueryClient();
	const { setIsSigningOut } = useUserStore();
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "radient");

	const userQuery = useQuery<UserInfoResult | null, Error>({
		queryKey: radientUserKeys.user(),
		queryFn: async () => {
			try {
				return await radientProxy<UserInfoResult>({ operation: "account" });
			} catch (error) {
				if (isSignedOut(error)) return null;
				throw error;
			}
		},
		enabled,
		staleTime: 30 * 1000,
		refetchOnWindowFocus: true,
		retry: (failureCount, error) => !isSignedOut(error) && failureCount < 2,
	});

	const isAuthenticated = !!userQuery.data && !userQuery.isLoading;
	// Kept for callers that distinguished "restoring" from "loading"; the
	// backend resolves the credential synchronously so the two collapse.
	const hasLocalSession = isAuthenticated;

	const signOutMutation = useMutation({
		onMutate: () => {
			setIsSigningOut(true);
		},
		mutationFn: async () => {
			const status = await desktopResult<{ accounts: StoredAccount[] }>({
				op: "accounts.list",
			});
			const radientAccounts = status.accounts.filter(
				(account) => account.provider === "radient",
			);
			for (const account of radientAccounts) {
				await desktopResult({
					op: "accounts.remove",
					accountId: account.id,
					confirmed: true,
				});
			}
			return true;
		},
		onSuccess: () => {
			queryClient.removeQueries({ queryKey: radientUserKeys.all });
			queryClient.invalidateQueries({ queryKey: desktopKeys.accounts });
			showSuccessToast("Successfully signed out");
			setIsSigningOut(false);
		},
		onError: (error) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			showErrorToast(`Failed to sign out: ${errorMessage}`);
			setIsSigningOut(false);
		},
	});

	const refreshUserMutation = useMutation({
		mutationFn: async () => {
			queryClient.invalidateQueries({ queryKey: radientUserKeys.all });
			return true;
		},
	});

	return {
		user: userQuery.data ?? undefined,
		isLoading: userQuery.isLoading,
		isRefetching: userQuery.isRefetching,
		error: userQuery.error,
		hasLocalSession,
		isAuthenticated,
		/** True when the backend cannot serve Radient at all (old backend). */
		unavailable: capabilities.isSuccess && !enabled,
		signOut: signOutMutation.mutate,
		refreshUser: refreshUserMutation.mutate,
		userQuery,
	};
};
