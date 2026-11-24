/**
 * @file onboarding-analytics.ts
 * @description
 * The first-run wizard's funnel events, behind one function each so the modal
 * cannot send a property the catalogue does not allow.
 *
 * ## Why
 *
 * Before this the wizard was a black box between "setup opened" and
 * `provider_connected` / `first_message_sent`: a user who gave up on the model
 * step and one who gave up on search looked identical. `viewed` and `completed`
 * per step make drop-off a subtraction (`docs/analytics-events.md`).
 *
 * ## Constraints
 *
 * - Properties are a step id and, optionally, a catalogue provider id or one of
 *   the closed search choices. Nothing a user typed can reach them: the payload
 *   is built from typed unions here, never from strings the caller composes.
 * - Goes through `trackProductEvent`, the app's one consent-gated capture path,
 *   so a launch that may not report sends nothing and a failure never throws.
 */

import { trackProductEvent } from "@shared/analytics/product-events";
import type { OnboardingStep } from "@shared/store/onboarding-store";

/** The search step's three answers, reported as its `provider`. */
export type SearchChoice = "free" | "radient" | "keys";

/** The payload both events carry, built here so tests can assert it exactly. */
export function onboardingStepPayload(
	step: OnboardingStep,
	provider?: string | null,
): { step: string; provider?: string } {
	return provider ? { step, provider } : { step };
}

/** A step became the visible one. */
export function trackOnboardingStepViewed(step: OnboardingStep): void {
	trackProductEvent("onboarding_step_viewed", onboardingStepPayload(step));
}

/**
 * The user left a step FORWARD. Skip/Back/Escape are deliberately not reported:
 * they are what the missing `completed` row means.
 */
export function trackOnboardingStepCompleted(
	step: OnboardingStep,
	provider?: string | null,
): void {
	trackProductEvent(
		"onboarding_step_completed",
		onboardingStepPayload(step, provider),
	);
}
