/**
 * Radient Sign In Step Component
 *
 * Provides options for users to sign in with Google or Microsoft
 * to set up their Radient Pass account.
 */

import { RadientAuthButtons } from "@shared/components/auth";
import { Spinner } from "@shared/components/common/spinner";
import { useRadientPricesQuery } from "@shared/hooks/use-radient-prices-query";
import type { FC } from "react";
/* Re-points the role variables inside `data-theme="radient"`; see the file. */
import "../../radient-brand.css";

/**
 * Props for the RadientSignInStep component
 */
type RadientSignInStepProps = {
	/**
	 * Optional callback when user successfully signs in with Radient Pass
	 */
	onSignInSuccess?: () => void;
};

/**
 * Radient Sign In Step Component
 *
 * Provides options for users to sign in with Google or Microsoft
 * to set up their Radient Pass account.
 */
export const RadientSignInStep: FC<RadientSignInStepProps> = ({
	onSignInSuccess,
}) => {
	const { prices, isLoading, error } = useRadientPricesQuery();

	/* The API returns dollars, and an em dash rather than "$..." when it
	   returns nothing: a placeholder shaped like a price reads as a price. */
	const newCredits =
		typeof prices?.default_new_credits === "number"
			? `$${prices.default_new_credits.toFixed(2)} USD`
			: "—";
	const registrationCredits =
		typeof prices?.default_registration_credits === "number"
			? `$${prices.default_registration_credits.toFixed(2)} USD`
			: "—";

	return (
		/*
		 * DELIBERATE THEME EXCEPTION — do not "fix" this to the active theme.
		 *
		 * This panel brands a third-party account, not the app, so it paints in
		 * Radient's own palette whichever theme the user has picked. The mechanism
		 * is `data-theme`: `themes.generated.css` emits one `[data-theme="<id>"]`
		 * block per palette, and those blocks are plain attribute selectors, so
		 * setting the attribute here re-points every `--lo-*` variable for this
		 * subtree only. Ordinary role utilities inside then resolve to Radient
		 * navy and Radient blue with no hex in sight.
		 *
		 * Taking the whole palette rather than only the blue is what keeps it
		 * readable: Radient blue is a soft #91B7E9 that measures around 2:1 on a
		 * light theme's white ground, and the previous version of this step put it
		 * there as body text. On its own navy ground it is a colour the contrast
		 * contract has already checked.
		 */
		<div
			data-theme="radient"
			className="flex flex-col gap-6 rounded-lg bg-surface p-6 text-ink"
		>
			<div className="flex flex-col gap-4 text-body text-ink-muted">
				<p>
					Radient Pass gives your agents{" "}
					<strong className="font-semibold text-accent">
						hundreds of models
					</strong>
					, updated in real time, plus web search, image generation and site
					crawling — all inside Local Operator.
				</p>
				<p>
					It is often cheaper than a single provider's API key, because Radient
					Automatic picks a model per step instead of sending everything to the
					largest one. The same pass works in other agentic tools such as Cline
					and Cursor.
				</p>
			</div>

			<p className="text-body text-ink-muted">
				You start with{" "}
				<span className="font-medium text-accent">
					{isLoading ? (
						<Spinner size="xs" className="align-middle" />
					) : (
						newCredits
					)}
				</span>{" "}
				of free credit, and unlock{" "}
				<span className="font-medium text-accent">
					{isLoading ? (
						<Spinner size="xs" className="align-middle" />
					) : (
						registrationCredits
					)}
				</span>{" "}
				more with your first payment.
			</p>

			{error && (
				<p className="text-danger text-meta">
					Credit amounts could not be loaded. Signing in still works.
				</p>
			)}

			<div className="flex flex-col items-center gap-4 py-2">
				{/* RadientAuthButtons owns its own layout and provider marks */}
				<RadientAuthButtons
					titleText=""
					descriptionText=""
					onSignInSuccess={onSignInSuccess}
				/>
			</div>

			<p className="text-center text-ink-dim text-meta">
				Your account signs you in and manages your Radient Pass subscription.
			</p>
		</div>
	);
};
