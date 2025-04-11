/**
 * @file radient-auth-provider.tsx
 * @description
 * Provider component for Radient authentication.
 * Provides authentication state and user information for Radient services.
 */

import type { FC, ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { apiConfig } from "@renderer/config";
import { createRadientClient } from "@renderer/api/radient";
import type { AccountInfo, IdentityInfo } from "@renderer/api/radient/types";
import { getSession, hasValidSession } from "@renderer/utils/session-store";

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
 * Radient auth context type
 */
export type RadientAuthContextType = {
	/**
	 * The current user information, or null if not authenticated
	 */
	user: RadientUser | null;
	/**
	 * The session token, or null if not authenticated
	 */
	sessionToken: string | null;
	/**
	 * Whether the authentication is loading
	 */
	loading: boolean;
	/**
	 * Any error that occurred during authentication
	 */
	error: string | null;
	/**
	 * Refresh the user information
	 */
	refreshUser: () => Promise<void>;
};

// Create the Radient auth context with a default value
const RadientAuthContext = createContext<RadientAuthContextType | null>(null);

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
 * Provides authentication state and user information for Radient services.
 * Automatically checks for an existing session and loads user information.
 */
export const RadientAuthProvider: FC<RadientAuthProviderProps> = ({
	children,
}) => {
	const [user, setUser] = useState<RadientUser | null>(null);
	const [sessionToken, setSessionToken] = useState<string | null>(null);
	const [loading, setLoading] = useState<boolean>(true);
	const [error, setError] = useState<string | null>(null);

	// Create the Radient API client
	const radientClient = createRadientClient(apiConfig.radientBaseUrl);

	/**
	 * Fetch the user information using the session token
	 */
	const fetchUserInfo = useCallback(
		async (token: string) => {
			try {
				const userInfoResponse = await radientClient.getUserInfo(token);
				setUser({
					account: userInfoResponse.result.account,
					identity: userInfoResponse.result.identity,
				});
				setError(null);
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				console.error("Failed to fetch user info:", errorMessage);
				setError(`Failed to fetch user info: ${errorMessage}`);
				setUser(null);
			}
		},
		[radientClient],
	);

	/**
	 * Refresh the user information
	 */
	const refreshUser = useCallback(async () => {
		setLoading(true);
		const token = await getSession();
		if (token) {
			setSessionToken(token);
			await fetchUserInfo(token);
		} else {
			setSessionToken(null);
			setUser(null);
		}
		setLoading(false);
	}, [fetchUserInfo]);

	// Check for an existing session on mount
	useEffect(() => {
		let isMounted = true;
		const checkSession = async () => {
			if (!isMounted) return;

			setLoading(true);
			try {
				const hasSession = await hasValidSession();
				if (hasSession && isMounted) {
					const token = await getSession();
					if (token && isMounted) {
						// Only update if the token has changed
						if (token !== sessionToken) {
							setSessionToken(token);
							await fetchUserInfo(token);
						}
					}
				} else if (isMounted) {
					// Clear the session token and user if there's no valid session
					setSessionToken(null);
					setUser(null);
				}
			} catch (err) {
				if (!isMounted) return;

				const errorMessage = err instanceof Error ? err.message : String(err);
				console.error("Session check failed:", errorMessage);
				setError(`Session check failed: ${errorMessage}`);
			} finally {
				if (isMounted) {
					setLoading(false);
				}
			}
		};

		checkSession();

		// Cleanup function to prevent state updates after unmount
		return () => {
			isMounted = false;
		};
	}, [fetchUserInfo, sessionToken]);

	// Create the context value
	const contextValue: RadientAuthContextType = {
		user,
		sessionToken,
		loading,
		error,
		refreshUser,
	};

	return (
		<RadientAuthContext.Provider value={contextValue}>
			{children}
		</RadientAuthContext.Provider>
	);
};

/**
 * Hook to access the Radient auth context
 * @returns The Radient auth context
 * @throws Error if used outside of a RadientAuthProvider
 */
export const useRadientUser = (): RadientAuthContextType => {
	const context = useContext(RadientAuthContext);
	if (!context) {
		throw new Error("useRadientUser must be used within a RadientAuthProvider");
	}
	return context;
};
