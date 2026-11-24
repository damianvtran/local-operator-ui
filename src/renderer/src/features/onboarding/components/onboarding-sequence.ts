/**
 * @file onboarding-sequence.ts
 * @description
 * Which steps the first-run stage walks through, as pure functions a test can
 * hold without React.
 *
 * ## Why the sequence is derived rather than a constant
 *
 * The web search step exists to point agents at a search backend. Radient
 * already IS one (higher-volume search is part of the account), so asking a
 * Radient user to pick free search or paste a Brave key is a question whose
 * answer they gave on step 1 (operator, 2026-11-24: "a stage with entering an
 * API key for search ... should be skipped if the user signs in with Radient").
 * Meet Aida, likewise, only exists when her capability and switch say she will
 * answer. So the count is 2, 3 or 4 and the progress track reads the length of
 * whatever this returns.
 *
 * ## Why "include search" is LATCHED, not live
 *
 * Radient can connect while the user is ON the search step (the step offers it
 * as its middle option). A live predicate would yank the step out from under
 * them mid-sign-in and renumber the track. The modal therefore decides
 * `includeSearch` when the user leaves the default-model step, and re-decides
 * it only when they go back to sign-in, where the answer can legitimately
 * change (design spec § 1: "a step never disappears from under the user").
 */

import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import { OnboardingStep } from "@shared/store/onboarding-store";
import {
	RECOMMENDED_PROVIDER_ID,
	isConnectedRow,
} from "../../providers/provider-catalog";

export type SequenceInput = {
	/** Whether the search step is in the walk (latched; see the file note). */
	includeSearch: boolean;
	/** Whether setup can end in Aida's conversation. */
	aidaAvailable: boolean;
};

/** The ordered steps for one combination of facts. */
export function onboardingSequence({
	includeSearch,
	aidaAvailable,
}: SequenceInput): OnboardingStep[] {
	return [
		OnboardingStep.CONNECT_PROVIDER,
		OnboardingStep.DEFAULT_MODEL,
		...(includeSearch ? [OnboardingStep.SEARCH] : []),
		...(aidaAvailable ? [OnboardingStep.MEET] : []),
	];
}

/**
 * Whether the census shows a connected Radient account - the one fact that
 * takes the search step out of the walk.
 *
 * `isConnectedRow` with no default hosting: Radient is a cloud row, so the
 * predicate reduces to "has a credential or is configured", the same reading the
 * Connected block of the provider grid uses. A local/credential-optional row
 * never answers true here, which is right - only the hosted account carries
 * search.
 */
export function radientConnected(
	providers: readonly DesktopProvider[] | undefined,
): boolean {
	return (providers ?? []).some(
		(provider) =>
			provider.id === RECOMMENDED_PROVIDER_ID && isConnectedRow(provider, null),
	);
}

/**
 * Where a persisted step that is not in the live sequence should land.
 *
 * SEARCH is the one value with a successor: an install migrated from the old
 * `extras` step (now SEARCH) whose Radient is connected has no search step, and
 * the old step's other half was meeting Aida - so that is where it continues.
 * Anything else, or SEARCH with no Meet step either, starts over at sign-in:
 * the existing "unknown step" fallback.
 */
export function fallbackStep(
	step: OnboardingStep,
	sequence: readonly OnboardingStep[],
): OnboardingStep {
	if (sequence.includes(step)) return step;
	if (
		step === OnboardingStep.SEARCH &&
		sequence.includes(OnboardingStep.MEET)
	) {
		return OnboardingStep.MEET;
	}
	return OnboardingStep.CONNECT_PROVIDER;
}
