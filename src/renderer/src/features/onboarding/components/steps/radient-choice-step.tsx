/**
 * Radient Choice Step Component
 *
 * The first thing a new user is asked: let Radient Pass supply the models, or
 * bring your own provider keys. Two cards, one recommendation, no third option
 * dressed up as one.
 */

import radientLogo from "@assets/radient-icon-1024x1024.png";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import { ArrowRight, Wrench } from "lucide-react";
import type { FC } from "react";
import { useCallback } from "react";
/* Re-points the role variables inside `data-theme="radient"`; see the file. */
import "../../radient-brand.css";

type RadientChoiceStepProps = {
	/**
	 * Called when the user selects the DIY option.
	 */
	onDoItYourself?: () => void;
	/**
	 * Called when the user selects the Radient Pass option.
	 */
	onRadientSignIn?: () => void;
};

export const RadientChoiceStep: FC<RadientChoiceStepProps> = ({
	onDoItYourself,
	onRadientSignIn,
}) => {
	const { setCurrentStep } = useOnboardingStore();

	/**
	 * Handle selection of the Radient Pass option
	 */
	const handleRadientPassChoice = useCallback(() => {
		if (onRadientSignIn) {
			onRadientSignIn();
		} else {
			setCurrentStep(OnboardingStep.RADIENT_SIGNIN);
		}
	}, [onRadientSignIn, setCurrentStep]);

	/**
	 * Handle selection of the DIY option
	 */
	const handleDiyChoice = useCallback(() => {
		if (onDoItYourself) {
			onDoItYourself();
		} else {
			// Navigate to User Profile as Welcome step is removed
			setCurrentStep(OnboardingStep.USER_PROFILE);
		}
	}, [onDoItYourself, setCurrentStep]);

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body text-ink-muted">
				Choose how you would like to get started.
			</p>

			{/*
			 * Both options are buttons, not clickable divs: they are the two things
			 * this screen exists to do, so they are reachable by keyboard and
			 * announced as choices. The whole card is the target — a card with a
			 * "choose this" link inside it has two hit areas and one of them is
			 * smaller than it looks.
			 */}
			<div className="flex flex-col gap-4">
				{/*
				 * DELIBERATE THEME EXCEPTION — do not "fix" this to the active theme.
				 *
				 * This card brands a third-party account rather than the app, so it
				 * paints in Radient's own palette whichever theme the user picked.
				 * `themes.generated.css` emits one `[data-theme="<id>"]` block per
				 * palette as a plain attribute selector, so the attribute here
				 * re-points every `--lo-*` variable for this subtree alone and the
				 * ordinary role utilities below resolve to Radient navy and blue.
				 * Taking the whole palette, rather than only the blue, is what keeps
				 * it readable: Radient blue measures about 2:1 on a light theme's
				 * white ground, and on its own navy ground it is a pairing the
				 * contrast contract has already checked.
				 */}
				<button
					type="button"
					data-theme="radient"
					onClick={handleRadientPassChoice}
					className="flex flex-col items-start gap-4 rounded-lg border border-accent bg-surface p-6 text-left transition-colors duration-base ease-out-quart hover:bg-elevated"
				>
					<div className="flex w-full items-start justify-between gap-4">
						<div className="flex flex-col gap-1">
							<h3 className="text-title text-ink">
								Get started free with{" "}
								<span className="text-accent">Radient Pass</span>
							</h3>
							<p className="font-medium text-body-sm text-ink-muted">
								Recommended for most people
							</p>
						</div>
						<img
							src={radientLogo}
							alt=""
							aria-hidden="true"
							className="size-16 shrink-0 object-contain"
						/>
					</div>

					<p className="text-body text-ink-muted">
						One pass for every tool and model, with Radient Automatic picking a
						model per step so simple work does not pay for the largest one. Two
						clicks, no credit card.
					</p>

					<span className="flex items-center gap-1.5 font-medium text-accent text-body-sm">
						Choose Radient Pass
						<ArrowRight size={14} aria-hidden="true" />
					</span>
				</button>

				<button
					type="button"
					onClick={handleDiyChoice}
					className="flex flex-col items-start gap-4 rounded-lg border border-hairline bg-surface p-6 text-left transition-colors duration-base ease-out-quart hover:bg-elevated"
				>
					<div className="flex w-full items-start justify-between gap-4">
						<div className="flex flex-col gap-1">
							<h3 className="text-title text-ink">Use your own keys</h3>
							<p className="font-medium text-body-sm text-ink-muted">
								For people who already have provider accounts
							</p>
						</div>
						<Wrench
							size={24}
							strokeWidth={1.5}
							className="shrink-0 text-ink-dim"
							aria-hidden="true"
						/>
					</div>

					<p className="text-body text-ink-muted">
						Bring API keys for OpenRouter, OpenAI, Anthropic, Google, Tavily or
						FAL, and keep billing with each provider.
					</p>

					<span className="flex items-center gap-1.5 font-medium text-body-sm text-ink-muted">
						Set up my own keys
						<ArrowRight size={14} aria-hidden="true" />
					</span>
				</button>
			</div>

			<p className="text-center text-ink-dim text-meta">
				You can change this later in Settings.
			</p>
		</div>
	);
};
