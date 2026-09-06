/**
 * @file radient-auth-buttons.tsx
 * @description
 * Radient sign-in, rendered as the backend provider detail for the `radient`
 * registry row. The old Google/Microsoft OIDC buttons ran an Electron-owned
 * flow that exchanged tokens in the renderer; sign-in now belongs to the
 * backend auth operations, so this component offers exactly the methods the
 * registry reports for Radient and nothing it does not support.
 */

import { ProviderDetail } from "@features/providers/provider-detail";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
	useDesktopProviders,
} from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Alert } from "@shared/components/ui";
import { radientUserKeys } from "@shared/hooks/use-radient-user-query";
import { useQueryClient } from "@tanstack/react-query";
import type { FC } from "react";

const RADIENT_PROVIDER_ID = "radient";

type RadientAuthButtonsProps = {
	/** Called once the backend reports a stored Radient credential. */
	onSignInSuccess?: () => void;
	/** Called after the credential lands, for model/credential refetches. */
	onAfterCredentialUpdate?: () => void;
	titleText?: string;
	descriptionText?: string;
};

export const RadientAuthButtons: FC<RadientAuthButtonsProps> = ({
	onSignInSuccess,
	onAfterCredentialUpdate,
	titleText = "Sign in to Radient",
	descriptionText = "Connect your Radient account to use Radient services.",
}) => {
	const queryClient = useQueryClient();
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "auth");
	const providers = useDesktopProviders(enabled);
	const radient = providers.data?.find(
		(provider) => provider.id === RADIENT_PROVIDER_ID,
	);

	if (capabilities.isSuccess && !enabled) {
		return (
			<Alert variant="warning">
				Signing in needs a newer Local Operator backend. Update the backend and
				restart the app.
			</Alert>
		);
	}

	if (providers.isLoading || capabilities.isLoading) {
		return (
			<div className="flex h-24 items-center justify-center">
				<Spinner size="md" label="Loading sign-in options" />
			</div>
		);
	}

	if (!radient) {
		return (
			<Alert variant="warning">
				Radient is not available from this backend's provider registry.
			</Alert>
		);
	}

	return (
		<div className="mx-auto w-full max-w-md">
			{titleText && (
				<p className="mb-2 text-center text-heading text-ink">{titleText}</p>
			)}
			{descriptionText && (
				<p className="mb-6 text-center text-body-sm text-ink-muted">
					{descriptionText}
				</p>
			)}
			<ProviderDetail
				provider={radient}
				onConnected={() => {
					// The stored credential is the sign-in; refetch the account so
					// consumers flip to authenticated without a window reload.
					void queryClient.invalidateQueries({
						queryKey: radientUserKeys.all,
					});
					onAfterCredentialUpdate?.();
					onSignInSuccess?.();
				}}
			/>
		</div>
	);
};
