/**
 * Radient Choice Step Component
 *
 * The first thing a new user is asked: let Radient Pass supply the models, or
 * bring your own provider keys. Two cards, one recommendation, no third option
 * dressed up as one.
 */

import radientLogo from "@assets/radient-icon-1024x1024.png";
import { Badge } from "@shared/components/ui";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import { ChevronRight, Wrench } from "lucide-react";
import type { FC } from "react";
import { useCallback } from "react";

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
		<div className="flex flex-col gap-5">
			{/*
			 * No introductory line. The dialog title already says "Choose your
			 * setup"; a paragraph underneath saying "Choose how you would like to
			 * get started" restated it in more words, and the first thing a new
			 * user read was a sentence carrying no information.
			 *
			 * Both options are buttons, not clickable divs: they are the two
			 * things this screen exists to do, so they are reachable by keyboard
			 * and announced as choices. The whole card is the target — a card with
			 * a "choose this" link inside it has two hit areas and one of them is
			 * smaller than it looks. The chevron is an affordance, not a second
			 * target, which is why the verb line the cards used to carry is gone:
			 * text styled like a link inside a button invites a click that lands
			 * on the same handler anyway.
			 */}
			<div className="flex flex-col gap-3">
				{/*
				 * DELIBERATE THEME EXCEPTION — do not "fix" this to the active theme.
				 *
				 * This card brands a third-party account rather than the app, so it
				 * paints in Radient's own palette whichever theme the user picked.
				 * `themes.generated.css` emits one `[data-theme="<id>"]` block per
				 * palette as a plain attribute selector, plus a re-declaration of
				 * the Tailwind role variables for scoped subtrees, so the attribute
				 * here re-points the whole palette for this card alone and the
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
					className="flex items-center gap-4 rounded-lg border border-accent bg-surface p-4 text-left transition-colors duration-base ease-out-quart hover:bg-elevated"
				>
					<img
						src={radientLogo}
						alt=""
						aria-hidden="true"
						className="size-10 shrink-0 object-contain"
					/>
					<span className="flex min-w-0 flex-1 flex-col gap-1">
						{/* The recommendation is a fact about the option, so it is a
						    label on the option rather than another sentence under it.
						    Inside `data-theme="radient"` the accent badge is Radient
						    blue, which is the point of the scope. */}
						<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
							<span className="text-heading text-ink">
								Get started free with{" "}
								<span className="text-accent">Radient Pass</span>
							</span>
							<Badge variant="accent" shape="pill">
								Recommended
							</Badge>
						</span>
						<span className="text-body-sm text-ink-muted">
							One pass for every model and tool, with a model picked per step so
							simple work does not pay for the largest one. No credit card.
						</span>
					</span>
					<ChevronRight
						size={16}
						className="shrink-0 text-ink-dim"
						aria-hidden="true"
					/>
				</button>

				<button
					type="button"
					onClick={handleDiyChoice}
					className="flex items-center gap-4 rounded-lg border border-hairline bg-surface p-4 text-left transition-colors duration-base ease-out-quart hover:bg-elevated"
				>
					{/* Sized to the Radient mark's optical weight, not to its box, so
					    the two rows start on the same vertical line. */}
					<Wrench
						size={24}
						strokeWidth={1.5}
						className="mx-2 shrink-0 text-ink-dim"
						aria-hidden="true"
					/>
					<span className="flex min-w-0 flex-1 flex-col gap-1">
						<span className="text-heading text-ink">Use your own keys</span>
						<span className="text-body-sm text-ink-muted">
							Bring keys for OpenRouter, OpenAI, Anthropic, Google, Tavily or
							FAL, and keep billing with each provider.
						</span>
					</span>
					<ChevronRight
						size={16}
						className="shrink-0 text-ink-dim"
						aria-hidden="true"
					/>
				</button>
			</div>

			{/* Left-aligned with everything above it. A centred caption under a
			    left-aligned stack is the sort of drift that reads as unfinished. */}
			<p className="text-ink-dim text-meta">
				You can change this later in Settings.
			</p>
		</div>
	);
};
