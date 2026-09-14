/**
 * Connect Provider Step Component
 *
 * First step of onboarding: one registry-backed grid of providers instead of
 * the old Radient-vs-bring-your-own two-gate. The user may connect a provider
 * here or continue and do it later; nothing on this screen is required to
 * move forward, which is why there is no validation callback to the modal.
 */

import { ProviderGrid } from "@features/providers/provider-grid";
import { useDesktopProviders } from "@shared/api/local-operator/desktop-hooks";
import { Alert, AlertDescription, AlertTitle } from "@shared/components/ui";
import { hasConnectedProvider } from "@shared/hooks/first-time-user";
import type { FC } from "react";
import { useMemo } from "react";

export const ConnectProviderStep: FC = () => {
	const providers = useDesktopProviders(true);
	// Onboarding only opens when no provider is connected, so this list is
	// normally empty on arrival. It fills when the user signs in on this step
	// and returns to the grid, or steps Back here from a later step -- and
	// then the step must say so, because the grid alone reads as a request
	// to sign in to something the user is already signed in to.
	const connected = useMemo(
		() =>
			(providers.data ?? [])
				.filter((provider) => hasConnectedProvider([provider]))
				.map((provider) => provider.name),
		[providers.data],
	);

	return (
		<div className="flex flex-col gap-5">
			{connected.length > 0 ? (
				<>
					<p className="text-body text-ink-muted">
						You can add another provider, or choose Next.
					</p>
					<Alert variant="success">
						<AlertTitle>Signed in to {formatList(connected)}</AlertTitle>
						<AlertDescription>
							Nothing more is needed here: choose Next to continue, or connect
							another provider below.
						</AlertDescription>
					</Alert>
				</>
			) : (
				<p className="text-body text-ink-muted">
					Pick the service your agents will think with. You can add or change
					providers later in Settings.
				</p>
			)}
			<ProviderGrid />
		</div>
	);
};

/** "A", "A and B", "A, B and C" -- the app's copy is English sentence case. */
function formatList(names: string[]): string {
	if (names.length <= 1) return names.join("");
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
