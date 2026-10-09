/**
 * Connect Provider Step Component
 *
 * Step 1 of 3 (design audit section 5): four featured rows -- the
 * recommendation, the two subscriptions most people already pay for, and one
 * key provider -- with the rest behind a "More providers" disclosure that
 * names what it holds. The 18-card grid used
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
		{/*
		 * Instructional, and it names the choices (first-run onboarding, U7/D11):
		 * the recommended route first and why, then the two subscriptions people
		 * already pay for, then where everything else is - so a user who came for
		 * xAI or a local model knows where to look before scanning the list.
		 *
		 * The prose does NOT re-list the brands (design round 1, D6): the
		 * disclosure's own trigger is derived from the census and names them, so two
		 * enumerations on one screen could disagree with each other and with the
		 * rows. The prose says where the rest are; the trigger says who they are -
		 * and it does not describe itself (design round 2, D11): "which names what
		 * it holds" was a description of a description, on a screen whose next line
		 * already names it.
		 */}
		<p className="text-body text-ink-muted">
			Local Operator needs an AI account to work. Radient is the easiest: one
			browser sign-in and nothing to paste. Already pay for ChatGPT or Claude?
			Sign in with that instead. Anything else is under More providers.
		</p>
		<ProviderGrid
			context="dialog"
			featuredOnly
			onDone={onContinue}
			/*
			 * Step 2 IS the model step, so the receipt's "Change" and the step's own
			 * Continue are the same move: the receipt showed no way to change the
			 * model it named inside onboarding (code round 1, m5).
			 */
			onChangeModel={onContinue}
		/>
	</div>
);
