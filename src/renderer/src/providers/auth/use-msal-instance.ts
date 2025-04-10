/**
 * @file use-msal-instance.ts
 * @description
 * Hook to access the MSAL instance from the MicrosoftAuthProvider context.
 */

import { useMsal } from "@azure/msal-react";
import {
	PublicClientApplication,
	type IPublicClientApplication,
} from "@azure/msal-browser";
import { oauthConfig } from "@renderer/config";

/**
 * Hook to access the MSAL instance from the MicrosoftAuthProvider context.
 * If the MSAL instance is not available (e.g., the provider is not present),
 * it will return undefined.
 *
 * @returns The MSAL instance or undefined if not available
 */
export const useMsalInstance = (): IPublicClientApplication | undefined => {
	try {
		// Try to get the MSAL instance from the context
		const { instance } = useMsal();
		return instance;
	} catch (error) {
		// If the context is not available, create a new instance if possible
		if (oauthConfig.microsoftClientId && oauthConfig.microsoftTenantId) {
			console.warn("MSAL context not available, creating a new instance");
			return new PublicClientApplication({
				auth: {
					clientId: oauthConfig.microsoftClientId,
					authority: `https://login.microsoftonline.com/${oauthConfig.microsoftTenantId}`,
					redirectUri: window.location.origin,
				},
				cache: {
					cacheLocation: "sessionStorage",
					storeAuthStateInCookie: false,
				},
			});
		}

		// If no client ID or tenant ID is available, return undefined
		console.warn(
			"MSAL context not available and no client ID or tenant ID provided",
		);
		return undefined;
	}
};
