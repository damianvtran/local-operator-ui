/**
 * @file onboarding-footer.ts
 * @description
 * The onboarding footer's decision, as one pure function: what a step's block
 * means for the button the user presses to leave it.
 *
 * ## Why
 *
 * The block a step reports is only worth having if the footer obeys it, and both
 * halves were inline in the component, so a review round's mutant -- the modal
 * ignoring the block and letting Continue through -- survived the suite (review
 * round 2 R2-M3). The rule is small but it is the difference between "setup cannot
 * finish without a model" and "setup finishes and the first message fails", so it
 * is stated once, here, where a test can hold it.
 */

import { OnboardingStep } from "@shared/store/onboarding-store";

export type OnboardingFooter = {
	/** Whether the step is refusing to advance. */
	blocked: boolean;
	/** The sentence the footer shows under the buttons, when it is blocked. */
	reason: string | null;
	/** Whether the primary button is disabled (`continuing` is its own reason). */
	primaryDisabled: boolean;
};

/**
 * The steps that can refuse to advance. Step 2 needs a model; the search step
 * refuses while its Radient option is chosen but not signed in, because Finish
 * would otherwise apply Free under a radio that says Radient (UX round 1, U2).
 * Sign-in has its own gate (Continue appears only once something connects) and
 * Meet has nothing to block on, so a stray block never strands the user there.
 */
const BLOCKING_STEPS: ReadonlySet<OnboardingStep> = new Set([
	OnboardingStep.DEFAULT_MODEL,
	OnboardingStep.SEARCH,
]);

export function onboardingFooter(
	step: OnboardingStep,
	stepBlock: string | null,
	continuing = false,
): OnboardingFooter {
	const blocked = BLOCKING_STEPS.has(step) && stepBlock !== null;
	return {
		blocked,
		reason: blocked ? stepBlock : null,
		primaryDisabled: continuing || blocked,
	};
}
