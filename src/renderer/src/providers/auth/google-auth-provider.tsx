/**
 * @file google-auth-provider.tsx
 * @description
 * Provider component for Google OAuth authentication.
 * Wraps the application with GoogleOAuthProvider from @react-oauth/google.
 */

import { GoogleOAuthProvider } from "@react-oauth/google";
import { oauthConfig } from "@renderer/config";
import type { FC, ReactNode } from "react";

type GoogleAuthProviderProps = {
	/**
	 * The children to render inside the provider
	 */
	children: ReactNode;
	/**
	 * Optional client ID to override the one from config
	 */
	clientId?: string;
};

/**
 * Google Authentication Provider
 *
 * Wraps the application with GoogleOAuthProvider to enable Google sign-in.
 * Uses the client ID from the environment variables by default.
 */
export const GoogleAuthProvider: FC<GoogleAuthProviderProps> = ({
	children,
	clientId,
}) => {
	const googleClientId = clientId || oauthConfig.googleClientId;

	// If no client ID is provided, render children without the provider
	if (!googleClientId) {
		console.warn("Google Auth Provider: No client ID provided");
		return <>{children}</>;
	}

	return (
		<GoogleOAuthProvider clientId={googleClientId}>
			{children}
		</GoogleOAuthProvider>
	);
};
