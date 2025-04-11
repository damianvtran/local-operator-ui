/**
 * @file auth-providers.tsx
 * @description
 * Combined authentication providers for the application.
 * Wraps the application with Google, Microsoft, and Radient authentication providers.
 */

import type { FC, ReactNode } from "react";
import { GoogleAuthProvider } from "./google-auth-provider";
import { MicrosoftAuthProvider } from "./microsoft-auth-provider";
import { RadientAuthProvider } from "./radient-auth-provider";
import { useFeatureFlags } from "../feature-flags";

// We no longer need to re-export the useRadientUser hook
// The useRadientUserQuery hook is now exported from the hooks directory

export type AuthProvidersProps = {
	/**
	 * The children to render inside the providers
	 */
	children: ReactNode;
	/**
	 * Optional Google client ID to override the one from config
	 */
	googleClientId?: string;
	/**
	 * Optional Microsoft client ID to override the one from config
	 */
	microsoftClientId?: string;
	/**
	 * Optional Microsoft tenant ID to override the one from config
	 */
	microsoftTenantId?: string;
};

/**
 * Combined Authentication Providers
 *
 * Wraps the application with Google, Microsoft, and Radient authentication providers.
 * Uses the client IDs and tenant ID from the environment variables by default.
 */
export const AuthProviders: FC<AuthProvidersProps> = ({
	children,
	googleClientId,
	microsoftClientId,
	microsoftTenantId,
}) => {
	const { isEnabled } = useFeatureFlags();
	const isRadientPassEnabled = isEnabled("radient-pass-onboarding");

	if (!isRadientPassEnabled) {
		return <>{children}</>;
	}

	return (
		<GoogleAuthProvider clientId={googleClientId}>
			<MicrosoftAuthProvider
				clientId={microsoftClientId}
				tenantId={microsoftTenantId}
			>
				<RadientAuthProvider>{children}</RadientAuthProvider>
			</MicrosoftAuthProvider>
		</GoogleAuthProvider>
	);
};
