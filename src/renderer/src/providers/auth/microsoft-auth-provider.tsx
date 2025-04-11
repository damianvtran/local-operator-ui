/**
 * @file microsoft-auth-provider.tsx
 * @description
 * Provider component for Microsoft OIDC authentication.
 * Wraps the application with MsalProvider from @azure/msal-react.
 */

import { MsalProvider } from "@azure/msal-react";
import { PublicClientApplication } from "@azure/msal-browser";
import { oauthConfig } from "@renderer/config";
import { useMemo, useRef, useEffect } from "react";
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

	// Capture initial clientId and tenantId in refs to ensure stability and satisfy linter.
	const initialClientIdRef = useRef(msClientId);
	const initialTenantIdRef = useRef(msTenantId);

	useEffect(() => {
		if (
			msClientId !== initialClientIdRef.current ||
			msTenantId !== initialTenantIdRef.current
		) {
			console.warn(
				"MicrosoftAuthProvider: clientId or tenantId changed after mount. This is not supported and may break authentication context.",
			);
		}
	}, [msClientId, msTenantId]);

	const msalInstance = useMemo(() => {
		if (!initialClientIdRef.current || !initialTenantIdRef.current) {
			return null;
		}

		// Create the MSAL instance with Electron-specific configuration
		const instance = new PublicClientApplication({
			auth: {
				clientId: initialClientIdRef.current,
				authority: `https://login.microsoftonline.com/${initialTenantIdRef.current}`,
				redirectUri: window.location.origin,
				navigateToLoginRequestUrl: false,
			},
			cache: {
				cacheLocation: "sessionStorage",
				storeAuthStateInCookie: false,
			},
			system: {
				// Use a more compatible hash handling for Electron
				allowRedirectInIframe: true,
			},
		});

		// Initialize the instance immediately
		// This is crucial to prevent the "uninitialized_public_client_application" error
		instance.initialize().catch((error) => {
			console.error("Failed to initialize MSAL instance:", error);
		});

		return instance;
	}, []);

	// If no MSAL instance is created, render children without the provider
	if (!msalInstance) {
		console.warn("Microsoft Auth Provider: No client ID or tenant ID provided");
		return <>{children}</>;
	}

	return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
};
