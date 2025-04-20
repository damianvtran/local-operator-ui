/**
 * @file radient-auth-provider.tsx
 * @description
 * Provider component for Radient authentication.
 * This is now a simple wrapper around the React Query-based hooks.
 */

import { queryClient } from "@shared/api/query-client";
import type { AccountInfo, IdentityInfo } from "@shared/api/radient";
import { QueryClientProvider } from "@tanstack/react-query";
import type { FC, ReactNode } from "react";

/**
 * Radient user information type
 */
export type RadientUser = {
	/**
	 * The account information
	 */
	account: AccountInfo;
	/**
	 * The identity information
	 */
	identity: IdentityInfo;
};

/**
 * Props for the RadientAuthProvider component
 */
export type RadientAuthProviderProps = {
	/**
	 * The children to render inside the provider
	 */
	children: ReactNode;
};

/**
 * Radient Authentication Provider
 *
 * This is now a simple wrapper around the React Query provider.
 * All the authentication logic has been moved to the useRadientUserQuery hook.
 */
export const RadientAuthProvider: FC<RadientAuthProviderProps> = ({
	children,
}) => {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
};
