/**
 * Onboarding Modal Component
 *
 * Main container for the first-time setup experience.
 * Manages the flow between different onboarding steps.
 */

import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Tooltip, Typography } from "@mui/material";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@renderer/store/onboarding-store";
import {
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { useFeatureFlagEnabled } from "posthog-js/react";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OnboardingDialog } from "./onboarding-dialog";
import {
	CongratulationsContainer,
	CongratulationsIcon,
	CongratulationsMessage,
	CongratulationsTitle,
	SkipButton,
	StepDot,
	StepIndicatorContainer,
} from "./onboarding-styled";
import { CreateAgentStep } from "./steps/create-agent-step";
import { DefaultModelStep } from "./steps/default-model-step";
import { ModelCredentialStep } from "./steps/model-credential-step";
import { RadientChoiceStep } from "./steps/radient-choice-step";
import { RadientSignInStep } from "./steps/radient-signin-step";
import { SearchApiStep } from "./steps/search-api-step";
import { UserProfileStep } from "./steps/user-profile-step";
import { WelcomeStep } from "./steps/welcome-step";

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
	const { currentStep, setCurrentStep, completeOnboarding } =
		useOnboardingStore();
	const navigate = useNavigate();

	// Check if the Radient Pass onboarding feature flag is enabled
	const isRadientPassEnabled = useFeatureFlagEnabled("radient-pass-onboarding");

	// Define the steps based on the feature flag and current step
	const steps = useMemo(() => {
		// If Radient Pass is enabled and we're on the choice or signin step,
		// don't show any steps since we don't know which path the user will choose
		if (
			isRadientPassEnabled &&
			(currentStep === OnboardingStep.RADIENT_CHOICE ||
				currentStep === OnboardingStep.RADIENT_SIGNIN)
		) {
			return [];
		}

		// If Radient Pass is enabled and we're past the signin step,
		// we're on the DIY path (the Radient Pass path would have completed onboarding)
		if (isRadientPassEnabled) {
			return [
				OnboardingStep.WELCOME,
				OnboardingStep.USER_PROFILE,
				OnboardingStep.MODEL_CREDENTIAL,
				OnboardingStep.SEARCH_API,
				OnboardingStep.DEFAULT_MODEL,
				OnboardingStep.CREATE_AGENT,
				OnboardingStep.CONGRATULATIONS,
			];
		}

		// Default path (no Radient Pass feature flag)
		return [
			OnboardingStep.WELCOME,
			OnboardingStep.USER_PROFILE,
			OnboardingStep.MODEL_CREDENTIAL,
			OnboardingStep.SEARCH_API,
			OnboardingStep.DEFAULT_MODEL,
			OnboardingStep.CREATE_AGENT,
			OnboardingStep.CONGRATULATIONS,
		];
	}, [isRadientPassEnabled, currentStep]);

	// Set the initial step based on the feature flag
	useEffect(() => {
		if (isRadientPassEnabled && currentStep === OnboardingStep.WELCOME) {
			setCurrentStep(OnboardingStep.RADIENT_CHOICE);
		}
	}, [isRadientPassEnabled, currentStep, setCurrentStep]);

	const stepTitles: Record<OnboardingStep, string> = {
		[OnboardingStep.RADIENT_CHOICE]: "Choose Your Setup Option",
		[OnboardingStep.RADIENT_SIGNIN]: "Sign in with a Radient Pass",
		[OnboardingStep.WELCOME]: "Welcome to Local Operator",
		[OnboardingStep.USER_PROFILE]: "Set Up Your Profile",
		[OnboardingStep.MODEL_CREDENTIAL]: "Add Model Provider Credentials",
		[OnboardingStep.SEARCH_API]: "Enable Web Search (Recommended)",
		[OnboardingStep.DEFAULT_MODEL]: "Choose Your Default Model",
		[OnboardingStep.CREATE_AGENT]: "Create Your First Agent",
		[OnboardingStep.CONGRATULATIONS]: "🎉 Setup Complete!",
	};

	const [visitedSteps, setVisitedSteps] = useState<Set<OnboardingStep>>(
		new Set([currentStep]),
	);

	useEffect(() => {
		setVisitedSteps((prev) => {
			if (prev.has(currentStep)) return prev;
			const updated = new Set(prev);
			updated.add(currentStep);
			return updated;
		});
	}, [currentStep]);

	/**
	 * Get the title for the current step
	 */
	const stepTitle = useMemo(() => {
		switch (currentStep) {
			case OnboardingStep.RADIENT_CHOICE:
				return "Welcome to Local Operator";
			case OnboardingStep.RADIENT_SIGNIN:
				return "Sign in with a Radient Pass";
			case OnboardingStep.WELCOME:
				return "Welcome to Local Operator";
			case OnboardingStep.USER_PROFILE:
				return "Set Up Your Profile";
			case OnboardingStep.MODEL_CREDENTIAL:
				return "Add Model Provider Credentials";
			case OnboardingStep.SEARCH_API:
				return "Enable Web Search (Recommended)";
			case OnboardingStep.DEFAULT_MODEL:
				return "Choose Your Default Model";
			case OnboardingStep.CREATE_AGENT:
				return "Create Your First Agent";
			case OnboardingStep.CONGRATULATIONS:
				return "🎉 Setup Complete!";
			default:
				return "🚀 First-Time Setup";
		}
	}, [currentStep]);

	/**
	 * Get the content for the current step
	 */
	const stepContent = useMemo(() => {
		switch (currentStep) {
			case OnboardingStep.RADIENT_CHOICE:
				return <RadientChoiceStep />;
			case OnboardingStep.RADIENT_SIGNIN:
				return <RadientSignInStep />;
			case OnboardingStep.WELCOME:
				return <WelcomeStep />;
			case OnboardingStep.USER_PROFILE:
				return <UserProfileStep />;
			case OnboardingStep.MODEL_CREDENTIAL:
				return <ModelCredentialStep />;
			case OnboardingStep.SEARCH_API:
				return <SearchApiStep />;
			case OnboardingStep.DEFAULT_MODEL:
				return <DefaultModelStep />;
			case OnboardingStep.CREATE_AGENT:
				return <CreateAgentStep />;
			case OnboardingStep.CONGRATULATIONS:
				return (
					<CongratulationsContainer>
						<CongratulationsIcon>
							<FontAwesomeIcon icon={faCheck} />
						</CongratulationsIcon>
						<CongratulationsTitle>🎉 You're all set! 🚀</CongratulationsTitle>
						<CongratulationsMessage>
							Amazing! Your Local Operator is now configured and ready to use.
							You can start chatting with your new AI assistant right away or
							explore more exciting features in the settings. Get ready for an
							incredible AI experience!
						</CongratulationsMessage>
					</CongratulationsContainer>
				);
			default:
				return null;
		}
	}, [currentStep]);

	/**
	 * Handle moving to the next step
	 */
	const handleNext = useCallback(() => {
		switch (currentStep) {
			case OnboardingStep.RADIENT_CHOICE:
				setCurrentStep(OnboardingStep.RADIENT_SIGNIN);
				break;
			case OnboardingStep.RADIENT_SIGNIN:
				// Skip to congratulations since this is a stub for now
				completeOnboarding();
				navigate("/chat");
				break;
			case OnboardingStep.WELCOME:
				setCurrentStep(OnboardingStep.USER_PROFILE);
				break;
			case OnboardingStep.USER_PROFILE:
				setCurrentStep(OnboardingStep.MODEL_CREDENTIAL);
				break;
			case OnboardingStep.MODEL_CREDENTIAL:
				setCurrentStep(OnboardingStep.SEARCH_API);
				break;
			case OnboardingStep.SEARCH_API:
				setCurrentStep(OnboardingStep.DEFAULT_MODEL);
				break;
			case OnboardingStep.DEFAULT_MODEL:
				setCurrentStep(OnboardingStep.CREATE_AGENT);
				break;
			case OnboardingStep.CREATE_AGENT:
				setCurrentStep(OnboardingStep.CONGRATULATIONS);
				break;
			case OnboardingStep.CONGRATULATIONS: {
				completeOnboarding();
				// Navigate to the chat view with the newly created agent after completing onboarding
				const createdAgentId = sessionStorage.getItem(
					"onboarding_created_agent_id",
				);
				if (createdAgentId) {
					navigate(`/chat/${createdAgentId}`);
					// Clear the stored agent ID
					sessionStorage.removeItem("onboarding_created_agent_id");
				} else {
					navigate("/chat");
				}
				break;
			}
			default:
				break;
		}
	}, [currentStep, setCurrentStep, completeOnboarding, navigate]);

	/**
	 * Handle moving to the previous step
	 */
	const handleBack = useCallback(() => {
		switch (currentStep) {
			case OnboardingStep.RADIENT_SIGNIN:
				setCurrentStep(OnboardingStep.RADIENT_CHOICE);
				break;
			case OnboardingStep.USER_PROFILE:
				setCurrentStep(OnboardingStep.WELCOME);
				break;
			case OnboardingStep.MODEL_CREDENTIAL:
				setCurrentStep(OnboardingStep.USER_PROFILE);
				break;
			case OnboardingStep.SEARCH_API:
				setCurrentStep(OnboardingStep.MODEL_CREDENTIAL);
				break;
			case OnboardingStep.DEFAULT_MODEL:
				setCurrentStep(OnboardingStep.SEARCH_API);
				break;
			case OnboardingStep.CREATE_AGENT:
				setCurrentStep(OnboardingStep.DEFAULT_MODEL);
				break;
			default:
				break;
		}
	}, [currentStep, setCurrentStep]);

	/**
	 * Handle skipping the current step (for optional steps)
	 */
	const handleSkip = useCallback(() => {
		if (currentStep === OnboardingStep.SEARCH_API) {
			setCurrentStep(OnboardingStep.DEFAULT_MODEL);
		} else if (currentStep === OnboardingStep.CREATE_AGENT) {
			setCurrentStep(OnboardingStep.CONGRATULATIONS);
		}
	}, [currentStep, setCurrentStep]);

	/**
	 * Determine if the current step can be skipped
	 */
	const canSkip =
		currentStep === OnboardingStep.SEARCH_API ||
		currentStep === OnboardingStep.CREATE_AGENT;

	/**
	 * Determine if the current step can go back
	 *
	 * Users cannot go back from the first step, which depends on whether
	 * the Radient Pass feature flag is enabled.
	 */
	const canGoBack = useMemo(() => {
		if (isRadientPassEnabled) {
			return (
				currentStep !== OnboardingStep.RADIENT_CHOICE &&
				currentStep !== OnboardingStep.CONGRATULATIONS
			);
		}
		return (
			currentStep !== OnboardingStep.WELCOME &&
			currentStep !== OnboardingStep.CONGRATULATIONS
		);
	}, [currentStep, isRadientPassEnabled]);

	/**
	 * Get the text for the next button
	 */
	const nextButtonText =
		currentStep === OnboardingStep.CONGRATULATIONS
			? "🚀 Get Started"
			: "Next →";

	// Check if an agent has been created during onboarding
	const hasCreatedAgent = Boolean(
		sessionStorage.getItem("onboarding_created_agent_id"),
	);

	// Create dialog title with step title
	const dialogTitle = (
		<Typography variant="h6" fontWeight={600}>
			{stepTitle}
		</Typography>
	);

	// Create dialog actions with back and next buttons
	const dialogActions = (
		<>
			<Box>
				{canGoBack ? (
					<SecondaryButton onClick={handleBack}>Back</SecondaryButton>
				) : (
					<Box /> // Empty box for spacing
				)}
			</Box>

			<Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
				{canSkip && <SkipButton onClick={handleSkip}>Skip</SkipButton>}
				<PrimaryButton
					onClick={handleNext}
					disabled={
						currentStep === OnboardingStep.CREATE_AGENT && !hasCreatedAgent
					}
				>
					{nextButtonText}
				</PrimaryButton>
			</Box>
		</>
	);

	const stepIndicators = (
		<StepIndicatorContainer>
			{steps.map((step) => {
				const isActive = currentStep === step;
				const isVisited = visitedSteps.has(step);
				const canNavigate = isVisited && step !== currentStep;

				return (
					<Tooltip key={step} title={stepTitles[step]} arrow>
						<Box
							onClick={() => {
								if (canNavigate) {
									setCurrentStep(step);
								}
							}}
						>
							<StepDot active={isActive} visited={isVisited} />
						</Box>
					</Tooltip>
				);
			})}
		</StepIndicatorContainer>
	);

	return (
		<OnboardingDialog
			open={open}
			title={dialogTitle}
			stepIndicators={stepIndicators}
			actions={dialogActions}
			dialogProps={{
				disableEscapeKeyDown: true,
			}}
		>
			{stepContent}
		</OnboardingDialog>
	);
};
