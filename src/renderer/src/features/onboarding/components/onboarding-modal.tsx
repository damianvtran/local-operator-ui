/**
 * Onboarding Modal Component
 *
 * Main container for the first-time setup experience.
 * Manages the flow between different onboarding steps.
 *
 * Provider connection is one registry-backed grid up front rather than the old
 * Radient-vs-bring-your-own gate: Radient is one card among the registry rows,
 * and a stored Radient credential in the backend AuthStore is what counts as
 * connected — not a renderer-held OAuth session.
 */

import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import { CircleCheck } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OnboardingDialog } from "./onboarding-dialog";
import { ConnectProviderStep } from "./steps/connect-provider-step";
import { CreateAgentStep } from "./steps/create-agent-step";
import { DefaultModelStep } from "./steps/default-model-step";
import { SearchApiStep } from "./steps/search-api-step";
import { UserProfileStep } from "./steps/user-profile-step";

/*
 * One title per step, each a plain verb phrase naming the single thing that
 * step asks for. The provider step names the outcome ("Connect a provider"),
 * not the machinery ("model provider credentials").
 *
 * These double as the accessible names of the progress segments, so they have
 * to survive being read on their own, out of order.
 */
const stepTitles: Partial<Record<OnboardingStep, string>> = {
	[OnboardingStep.CONNECT_PROVIDER]: "Connect a provider",
	// Verb-led, like the others, and not a repeat of the first field's own
	// label 60px below it — the step asks for a name and an optional email.
	[OnboardingStep.USER_PROFILE]: "Introduce yourself",
	[OnboardingStep.SEARCH_API]: "Turn on web search",
	[OnboardingStep.DEFAULT_MODEL]: "Pick a default model",
	[OnboardingStep.CREATE_AGENT]: "Create your first agent",
	[OnboardingStep.CONGRATULATIONS]: "You're all set",
};

/** The numbered sequence, in order. Connection precedes profile because the
 * model picker and web-search steps only make sense once a provider exists. */
const STEP_SEQUENCE: OnboardingStep[] = [
	OnboardingStep.CONNECT_PROVIDER,
	OnboardingStep.USER_PROFILE,
	OnboardingStep.SEARCH_API,
	OnboardingStep.DEFAULT_MODEL,
	OnboardingStep.CREATE_AGENT,
	OnboardingStep.CONGRATULATIONS,
];

/** Steps whose absence never blocks the flow. */
const SKIPPABLE = new Set([
	OnboardingStep.SEARCH_API,
	OnboardingStep.CREATE_AGENT,
]);

/**
 * Props for the OnboardingModal component
 */
type OnboardingModalProps = {
	/**
	 * Whether the modal is open
	 */
	open: boolean;
};

/**
 * Onboarding Modal Component
 *
 * Manages the first-time setup experience with multiple steps
 */
export const OnboardingModal: FC<OnboardingModalProps> = ({ open }) => {
	const { currentStep, setCurrentStep, completeModalOnboarding } =
		useOnboardingStore();
	const navigate = useNavigate();

	// State to track if the Create Agent step is valid (at least one agent added)
	const [isCreateAgentStepValid, setIsCreateAgentStepValid] = useState(false);

	/*
	 * A persisted mid-flow step from before this flow existed (or from the old
	 * Radient-gated flow) must not strand the modal on an unknown step: any
	 * value outside the current sequence falls back to the first step.
	 */
	useEffect(() => {
		if (!STEP_SEQUENCE.includes(currentStep)) {
			setCurrentStep(OnboardingStep.CONNECT_PROVIDER);
		}
	}, [currentStep, setCurrentStep]);

	// The profile prefill used to come from a renderer-held Radient session.
	// The backend AuthStore now owns that account; the field stays editable
	// here and nothing needs restoring at mount.

	// Track visited steps for navigation
	// Initialize empty, as currentStep might be undefined during hydration
	const [visitedSteps, setVisitedSteps] = useState<Set<OnboardingStep>>(
		new Set<OnboardingStep>(),
	);

	// Update visited steps when currentStep changes
	useEffect(() => {
		setVisitedSteps((prev) => {
			if (prev.has(currentStep)) return prev;
			const updated = new Set(prev);
			updated.add(currentStep);
			return updated;
		});
	}, [currentStep]);

	/**
	 * Get the main title for the dialog based on the current step
	 */
	const dialogTitle = useMemo(() => {
		if (!currentStep) return "Loading...";
		return stepTitles[currentStep] || "First-time setup";
	}, [currentStep]);

	/**
	 * Get the content component for the current step
	 */
	const stepContent = useMemo(() => {
		if (!currentStep) return null;

		switch (currentStep) {
			case OnboardingStep.CONNECT_PROVIDER:
				return <ConnectProviderStep />;
			case OnboardingStep.USER_PROFILE:
				return <UserProfileStep />;
			case OnboardingStep.SEARCH_API:
				return <SearchApiStep />;
			case OnboardingStep.DEFAULT_MODEL:
				return <DefaultModelStep />;
			case OnboardingStep.CREATE_AGENT:
				// Pass the validity callback
				return <CreateAgentStep onValidityChange={setIsCreateAgentStepValid} />;
			case OnboardingStep.CONGRATULATIONS:
				/*
				 * The one accent moment in the flow, spent here. Setup ending is the
				 * only thing in onboarding worth a colour, and it gets a single mark
				 * rather than the three stacked celebration glyphs this used to have.
				 */
				return (
					<div className="flex flex-col gap-4">
						<CircleCheck size={28} className="text-accent" aria-hidden="true" />
						<p className="text-body text-ink-muted">
							Local Operator is ready. Start a conversation with your new agent,
							or change anything you picked here later in Settings.
						</p>
					</div>
				);
			default:
				return null; // Should not happen
		}
	}, [currentStep]);

	/**
	 * Handle moving to the next step
	 */
	const handleNext = useCallback(() => {
		if (currentStep === OnboardingStep.CONGRATULATIONS) {
			completeModalOnboarding();
			// Navigate to the chat view, potentially with the newly created agent
			const createdAgentId = sessionStorage.getItem(
				"onboarding_created_agent_id",
			);
			if (createdAgentId) {
				navigate(`/chat/${createdAgentId}`);
				sessionStorage.removeItem("onboarding_created_agent_id");
			} else {
				navigate("/chat");
			}
			return;
		}
		const index = STEP_SEQUENCE.indexOf(currentStep);
		if (index >= 0 && index < STEP_SEQUENCE.length - 1) {
			setCurrentStep(STEP_SEQUENCE[index + 1]);
		}
	}, [currentStep, setCurrentStep, completeModalOnboarding, navigate]);

	/**
	 * Handle moving to the previous step
	 */
	const handleBack = useCallback(() => {
		const index = STEP_SEQUENCE.indexOf(currentStep);
		if (index > 0) {
			setCurrentStep(STEP_SEQUENCE[index - 1]);
		}
	}, [currentStep, setCurrentStep]);

	/**
	 * Handle skipping the current step (for optional steps)
	 */
	const handleSkip = useCallback(() => {
		handleNext();
	}, [handleNext]);

	const canSkip = SKIPPABLE.has(currentStep);

	/**
	 * The first step and the last screen have no Back.
	 */
	const canGoBack =
		currentStep !== OnboardingStep.CONNECT_PROVIDER &&
		currentStep !== OnboardingStep.CONGRATULATIONS;

	/**
	 * Get the text for the 'Next'/'Finish' button
	 */
	const nextButtonText =
		currentStep === OnboardingStep.CONGRATULATIONS ? "Get started" : "Next";

	// Connecting a provider is encouraged, never forced: the grid is skippable
	// in effect because Next always works. Only Create Agent gates on validity.
	const isNextDisabled =
		currentStep === OnboardingStep.CREATE_AGENT && !isCreateAgentStepValid;

	/*
	 * Back on the left, forward on the right, and the row keeps its height when
	 * there is no Back — `justify-between` with an empty first slot rather than
	 * a spacer element of a guessed width.
	 */
	const dialogActions = (
		<div className="flex w-full items-center justify-between gap-3">
			<div>
				{canGoBack && (
					<Button variant="secondary" size="lg" onClick={handleBack}>
						Back
					</Button>
				)}
			</div>

			<div className="flex items-center gap-3">
				{canSkip && (
					<Button variant="ghost" size="lg" onClick={handleSkip}>
						Skip
					</Button>
				)}
				<Button
					variant="primary"
					size="lg"
					onClick={handleNext}
					disabled={isNextDisabled}
				>
					{nextButtonText}
				</Button>
			</div>
		</div>
	);

	/*
	 * Progress, as a count and a track. Segments stay individually clickable
	 * back to visited steps. `rounded-xs` on a 4px bar rather than a pill:
	 * `rounded-full` is reserved, and `progress.tsx` already sets the
	 * precedent for a bar this size.
	 */
	const finalStepIndicatorsProp = useMemo(() => {
		if (!currentStep) {
			return null;
		}

		const activeIndex = STEP_SEQUENCE.indexOf(currentStep);

		return (
			<div className="flex shrink-0 items-center gap-3">
				<span className="whitespace-nowrap text-ink-dim text-meta">
					{activeIndex >= 0
						? `Step ${activeIndex + 1} of ${STEP_SEQUENCE.length}`
						: `${STEP_SEQUENCE.length} steps`}
				</span>
				{/* `list`, not a bare row of buttons: it has a length, and a screen
				    reader saying "6 items" is the same fact the count above shows. */}
				<ol className="flex items-center gap-1">
					{STEP_SEQUENCE.map((step, index) => {
						const isActive = currentStep === step;
						const isVisited = visitedSteps.has(step);
						const canNavigate = isVisited && !isActive;

						// Filled up to and including the current step, so the track
						// reads as distance covered rather than as lit dots.
						const isCovered = index <= activeIndex;

						return (
							<li key={step} className="flex">
								<Tooltip content={stepTitles[step]}>
									{/*
									 * A real button, so the track is tabbable and each step's
									 * name is announced. `aria-disabled` rather than
									 * `disabled`: a disabled button swallows pointer events,
									 * and the tooltip is the only place the name is written.
									 */}
									<button
										type="button"
										aria-label={stepTitles[step]}
										aria-current={isActive ? "step" : undefined}
										aria-disabled={!canNavigate}
										onClick={() => {
											if (canNavigate) {
												setCurrentStep(step);
											}
										}}
										/* The bar is 4px; the button around it is 16px, so the
										   thing you can hit and the thing you can see are not
										   the same size. */
										className="flex h-4 w-4 items-center"
									>
										<span
											className={cn(
												"h-1 w-full rounded-xs transition-colors duration-base ease-out-quart",
												/* `control`, not `hairline`: hairline is a line
												   weight and a 4px bar filled with it vanishes
												   against `elevated`. */
												isCovered ? "bg-accent" : "bg-control",
											)}
										/>
									</button>
								</Tooltip>
							</li>
						);
					})}
				</ol>
			</div>
		);
	}, [currentStep, visitedSteps, setCurrentStep]); // stepTitles is stable

	return (
		<OnboardingDialog
			open={open}
			title={dialogTitle}
			stepIndicators={finalStepIndicatorsProp}
			actions={dialogActions}
		>
			{stepContent}
		</OnboardingDialog>
	);
};
