/**
 * Connect Provider Step Component
 *
 * Step 1 of 3 (design audit section 5): four featured rows -- the
 * recommendation, the two subscriptions most people already pay for, and one
 * key provider -- with the rest behind "More providers". The 18-card grid used
 * to scroll inside a 560-640px dialog body and crop at the footer (design D6).
 *
 * The step never lets a user continue into nothing: the modal's footer shows
 * "Continue" only once the census reports a connected provider, and a panel's
 * own success action ("Continue") moves on directly.
 */

import { ProviderGrid } from "@features/providers/provider-grid";
import type { FC } from "react";

type ConnectProviderStepProps = {
	/** A sign-in panel's success action moves straight to step 2. */
	onContinue?: () => void;
};

export const ConnectProviderStep: FC<ConnectProviderStepProps> = ({
	onContinue,
}) => (
	<div className="flex flex-col gap-5">
		<p className="text-body text-ink-muted">
			Your agents need a model to think with. Sign in with an account you
			already have, or add an API key.
		</p>
		<ProviderGrid context="dialog" featuredOnly onDone={onContinue} />
	</div>
);
