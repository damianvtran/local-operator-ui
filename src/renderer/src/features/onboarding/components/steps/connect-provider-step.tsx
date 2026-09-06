/**
 * Connect Provider Step Component
 *
 * First step of onboarding: one registry-backed grid of providers instead of
 * the old Radient-vs-bring-your-own two-gate. The user may connect a provider
 * here or continue and do it later; nothing on this screen is required to
 * move forward, which is why there is no validation callback to the modal.
 */

import { ProviderGrid } from "@features/providers/provider-grid";
import type { FC } from "react";

export const ConnectProviderStep: FC = () => {
	return (
		<div className="flex flex-col gap-5">
			<p className="text-body text-ink-muted">
				Pick the service your agents will think with. You can add or change
				providers later in Settings.
			</p>
			<ProviderGrid />
		</div>
	);
};
