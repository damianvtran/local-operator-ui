/**
 * @file microsoft-auth-provider.tsx
 * @description
 * Provider component for Microsoft OIDC authentication.
 * Wraps the application with MsalProvider from @azure/msal-react.
 */

import { MsalProvider } from "@azure/msal-react";
import { PublicClientApplication } from "@azure/msal-browser";
import { oauthConfig } from "@renderer/config";
import { useMemo } from "react";
import type { FC, ReactNode } from "react";

type MicrosoftAuthProviderProps = {
	/**
	 * The children to render inside the provider
	 */
	children: ReactNode;
	/**
	 * Optional client ID to override the one from config
	 */
	clientId?: string;
	/**
	 * Optional tenant ID to override the one from config
	 */
	tenantId?: string;
};

/**
 * Microsoft Authentication Provider
 *
 * Wraps the application with MsalProvider to enable Microsoft sign-in.
 * Uses the client ID and tenant ID from the environment variables by default.
 * If no client ID or tenant ID is provided, renders children without the provider.
 */
export const MicrosoftAuthProvider: FC<MicrosoftAuthProviderProps> = ({
	children,
	clientId,
	tenantId,
}) => {
	const msClientId = clientId || oauthConfig.microsoftClientId;
	const msTenantId = tenantId || oauthConfig.microsoftTenantId;

	// Create MSAL instance if client ID and tenant ID are provided
	const msalInstance = useMemo(() => {
		if (!msClientId || !msTenantId) {
			return null;
		}

		return new PublicClientApplication({
			auth: {
				clientId: msClientId,
				authority: `https://login.microsoftonline.com/${msTenantId}`,
				redirectUri: window.location.origin,
			},
			cache: {
				cacheLocation: "sessionStorage",
				storeAuthStateInCookie: false,
			},
		});
	}, [msClientId, msTenantId]);

	// If no MSAL instance is created, render children without the provider
	if (!msalInstance) {
		console.warn("Microsoft Auth Provider: No client ID or tenant ID provided");
		return <>{children}</>;
	}

	return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
};
