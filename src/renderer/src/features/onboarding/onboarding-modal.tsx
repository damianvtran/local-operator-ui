/**
 * Onboarding Modal Component
 *
 * Main container for the first-time setup experience.
 * Manages the flow between different onboarding steps.
 */

import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, CircularProgress, Tooltip } from "@mui/material"; // Added CircularProgress
import { getUserInfo } from "@renderer/api/radient/auth-api";
import { apiConfig } from "@renderer/config";
import { useFeatureFlags } from "@renderer/providers/feature-flags";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@renderer/store/onboarding-store";
import { useUserStore } from "@renderer/store/user-store";
import { clearSession, getSession } from "@renderer/utils/session-store";
import { showErrorToast } from "@renderer/utils/toast-manager";
import {
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Define step titles outside the component for stability
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
	const { isEnabled } = useFeatureFlags();
	const isRadientPassFeatureFlagEnabled = isEnabled("radient-pass-onboarding");

	// State to track if provider auth (OAuth credentials) is configured in the backend
	const [isProviderAuthEnabled, setIsProviderAuthEnabled] = useState(false);
	// State to track loading status for the provider auth check
	const [isLoadingProviderAuth, setIsLoadingProviderAuth] = useState(true);

	// Determine if the full Radient Pass flow should be enabled (flag AND backend config)
	const isRadientPassFlowEnabled =
		isRadientPassFeatureFlagEnabled && isProviderAuthEnabled;

	// Track whether the user is using Radient Pass within the flow
	const [isUsingRadientPass, setIsUsingRadientPass] = useState(false);
	// Track the previous step to detect jumps (e.g., from sign-in to create agent)
	const previousStepRef = useRef<OnboardingStep | null>(null);

	// On mount, check if provider auth is enabled via IPC
	useEffect(() => {
		const checkAuth = async () => {
			setIsLoadingProviderAuth(true); // Start loading
			try {
				const enabled = await window.api.ipcRenderer.checkProviderAuthEnabled();
				setIsProviderAuthEnabled(enabled);
				console.log("Provider Auth Enabled Status:", enabled); // Log status
			} catch (error) {
				console.error("Error checking provider auth status:", error);
				// Assume disabled if there's an error
				setIsProviderAuthEnabled(false);
			} finally {
				setIsLoadingProviderAuth(false); // Finish loading
			}
		};
		checkAuth();
	}, []); // Run only once on mount

	// On mount (or when auth check completes), check for a persisted session, validate it, and fetch user info
	useEffect(() => {
		// Only run if provider auth check is complete
		if (isLoadingProviderAuth) return;

		const tryRestoreSession = async () => {
			const sessionData = await getSession();
			if (!sessionData) return; // No session, do nothing

			try {
				// Fetch user information from Radient API
				const userInfoResponse = await getUserInfo(
					apiConfig.radientBaseUrl,
					sessionData.accessToken,
				);
				const userInfo = userInfoResponse.result;

				// Update the user profile with name and email
				if (userInfo) {
					const updateProfile = useUserStore.getState().updateProfile;
					updateProfile({
						name: userInfo.account.name,
						email: userInfo.account.email,
					});

					// If Radient Pass flow is enabled and user is authenticated,
					// send them directly to create agent step and mark as using Radient Pass
					if (isRadientPassFlowEnabled) {
						setIsUsingRadientPass(true);
						setCurrentStep(OnboardingStep.CREATE_AGENT);
					} else {
						// Reset to appropriate starting step based on flow status
						setCurrentStep(
							isRadientPassFlowEnabled
								? OnboardingStep.RADIENT_CHOICE
								: OnboardingStep.WELCOME,
						);
					}
				} else {
					// If userInfo is null/undefined despite having a JWT, the token might be invalid/expired
					console.warn(
						"JWT found but failed to fetch user info. Clearing session.",
					);
					clearSession();
				}
			} catch (error) {
				console.error("Error validating session/fetching user info:", error);
				showErrorToast("Session validation failed. Please sign in again.");
				clearSession();
			}
		};
		tryRestoreSession();
	}, [
		setCurrentStep,
		isLoadingProviderAuth,
		isRadientPassFlowEnabled, // Add dependency
	]);

	// Update the previous step reference whenever currentStep changes
	useEffect(() => {
		previousStepRef.current = currentStep;
	}, [currentStep]);

	// Define the sequence of steps shown in the indicator based on the flow
	const steps = useMemo(() => {
		// If Radient Pass flow is enabled and we're on the choice or signin step,
		// don't show any steps in the indicator yet.
		if (
			isRadientPassFlowEnabled &&
			(currentStep === OnboardingStep.RADIENT_CHOICE ||
				currentStep === OnboardingStep.RADIENT_SIGNIN)
		) {
			return [];
		}

		// If user is using Radient Pass (and flow is enabled) and is at CREATE_AGENT or CONGRATULATIONS step,
		// only show those two steps in the indicator.
		if (
			isRadientPassFlowEnabled &&
			isUsingRadientPass &&
			(currentStep === OnboardingStep.CREATE_AGENT ||
				currentStep === OnboardingStep.CONGRATULATIONS)
		) {
			return [OnboardingStep.CREATE_AGENT, OnboardingStep.CONGRATULATIONS];
		}

		// DIY path (either Radient Pass flow is disabled, or user chose DIY)
		// Determine the correct first step for the DIY path
		const firstDiyStep = isRadientPassFlowEnabled
			? OnboardingStep.USER_PROFILE // Skip WELCOME/CHOICE if flow enabled but user chose DIY
			: OnboardingStep.WELCOME; // Start at WELCOME if flow disabled

		const diySteps = [
			firstDiyStep,
			// Conditionally add USER_PROFILE if it wasn't the first step
			...(firstDiyStep === OnboardingStep.WELCOME
				? [OnboardingStep.USER_PROFILE]
				: []),
			OnboardingStep.MODEL_CREDENTIAL,
			OnboardingStep.SEARCH_API,
			OnboardingStep.DEFAULT_MODEL,
			OnboardingStep.CREATE_AGENT,
			OnboardingStep.CONGRATULATIONS,
		];

		return diySteps;
	}, [isRadientPassFlowEnabled, currentStep, isUsingRadientPass]);

	// Adjust the current step based on the enabled flow after loading
	useEffect(() => {
		// Wait until provider auth status is loaded
		if (isLoadingProviderAuth) {
			return;
		}

		// If Radient Pass flow is enabled and user is currently on WELCOME, redirect to RADIENT_CHOICE
		if (isRadientPassFlowEnabled && currentStep === OnboardingStep.WELCOME) {
			setCurrentStep(OnboardingStep.RADIENT_CHOICE);
		}
		// If Radient Pass flow is *disabled* and user somehow lands on RADIENT_CHOICE or RADIENT_SIGNIN,
		// redirect them back to the standard WELCOME step.
		else if (
			!isRadientPassFlowEnabled &&
			(currentStep === OnboardingStep.RADIENT_CHOICE ||
				currentStep === OnboardingStep.RADIENT_SIGNIN)
		) {
			setCurrentStep(OnboardingStep.WELCOME);
		}

		// Detect if user has jumped from RADIENT_SIGNIN directly to CREATE_AGENT
		// This indicates they successfully used Radient Pass
		if (
			previousStepRef.current === OnboardingStep.RADIENT_SIGNIN &&
			currentStep === OnboardingStep.CREATE_AGENT
		) {
			setIsUsingRadientPass(true);
		}
	}, [
		isRadientPassFlowEnabled,
		currentStep,
		setCurrentStep,
		isLoadingProviderAuth, // Depend on loading state
	]);

	// Track visited steps for navigation
	const [visitedSteps, setVisitedSteps] = useState<Set<OnboardingStep>>(
		new Set([currentStep]),
	);

	useEffect(() => {
		setVisitedSteps((prev) => {
			// Don't modify if the step is already visited or if loading
			if (prev.has(currentStep) || isLoadingProviderAuth) return prev;
			const updated = new Set(prev);
			updated.add(currentStep);
			return updated;
		});
	}, [currentStep, isLoadingProviderAuth]); // Depend on loading state

	/**
	 * Get the main title for the dialog based on the current step
	 */
	const dialogTitle = useMemo(() => {
		// Use specific titles, fallback to the tooltip title
		switch (currentStep) {
			case OnboardingStep.RADIENT_CHOICE:
			case OnboardingStep.WELCOME:
				return "Welcome to Local Operator";
			case OnboardingStep.CONGRATULATIONS:
				return "🎉 Setup Complete!";
			default:
				// Use the title defined for tooltips if not overridden
				return stepTitles[currentStep] || "🚀 First-Time Setup";
		}
	}, [currentStep]); // Remove stepTitles from dependency array

	/**
	 * Get the content component for the current step
	 */
	const stepContent = useMemo(() => {
		switch (currentStep) {
			case OnboardingStep.RADIENT_CHOICE:
				return (
					<RadientChoiceStep
						onDoItYourself={() => {
							setIsUsingRadientPass(false); // Mark as DIY path
							setCurrentStep(OnboardingStep.USER_PROFILE);
						}}
						onRadientSignIn={() => {
							// No need to set isUsingRadientPass here, sign-in success handles it
							setCurrentStep(OnboardingStep.RADIENT_SIGNIN);
						}}
					/>
				);
			case OnboardingStep.RADIENT_SIGNIN:
				return (
					<RadientSignInStep
						onSignInSuccess={() => {
							// This callback is triggered by the component on successful sign-in
							// The useEffect hook watching previousStepRef handles setting isUsingRadientPass
							// No state change needed here directly, just navigate (which happens implicitly)
						}}
					/>
				);
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
				return null; // Should not happen
		}
	}, [currentStep, setCurrentStep]); // Only depends on currentStep and setCurrentStep

	/**
	 * Handle moving to the next step (standard flow)
	 */
	const handleNext = useCallback(() => {
		// Standard DIY flow transitions
		switch (currentStep) {
			case OnboardingStep.WELCOME: // Only reachable if Radient flow disabled
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
			case OnboardingStep.CREATE_AGENT: // Applies to both DIY and Radient Pass paths
				setCurrentStep(OnboardingStep.CONGRATULATIONS);
				break;
			case OnboardingStep.CONGRATULATIONS: {
				completeOnboarding();
				// Navigate to the chat view, potentially with the newly created agent
				const createdAgentId = sessionStorage.getItem(
					"onboarding_created_agent_id",
				);
				if (createdAgentId) {
					navigate(`/chat/${createdAgentId}`);
					sessionStorage.removeItem("onboarding_created_agent_id"); // Clean up
				} else {
					navigate("/chat"); // Fallback if no agent ID found
				}
				break;
			}
			// RADIENT_CHOICE and RADIENT_SIGNIN don't use the 'Next' button
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
				// If Radient Pass flow is enabled (meaning we came from CHOICE), go back to CHOICE.
				// Otherwise (flow disabled, came from WELCOME), go back to WELCOME.
				setCurrentStep(
					isRadientPassFlowEnabled
						? OnboardingStep.RADIENT_CHOICE
						: OnboardingStep.WELCOME,
				);
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
				// If using Radient Pass, back goes nowhere (handled by canGoBack)
				// If DIY, back goes to DEFAULT_MODEL
				if (!isUsingRadientPass) {
					setCurrentStep(OnboardingStep.DEFAULT_MODEL);
				}
				break;
			// Cannot go back from WELCOME, RADIENT_CHOICE, or CONGRATULATIONS
			default:
				break;
		}
	}, [
		currentStep,
		setCurrentStep,
		isRadientPassFlowEnabled,
		isUsingRadientPass,
	]); // Update dependencies

	/**
	 * Handle skipping the current step (for optional steps like Search API, Create Agent)
	 */
	const handleSkip = useCallback(() => {
		if (currentStep === OnboardingStep.SEARCH_API) {
			setCurrentStep(OnboardingStep.DEFAULT_MODEL);
		} else if (currentStep === OnboardingStep.CREATE_AGENT) {
			// Skipping Create Agent goes directly to Congratulations
			setCurrentStep(OnboardingStep.CONGRATULATIONS);
		}
	}, [currentStep, setCurrentStep]);

	/**
	 * Determine if the current step is skippable
	 */
	const canSkip =
		currentStep === OnboardingStep.SEARCH_API ||
		currentStep === OnboardingStep.CREATE_AGENT;

	/**
	 * Determine if the 'Back' button should be shown and enabled
	 */
	const canGoBack = useMemo(() => {
		// Cannot go back while loading
		if (isLoadingProviderAuth) {
			return false;
		}

		// Cannot go back from Congratulations
		if (currentStep === OnboardingStep.CONGRATULATIONS) {
			return false;
		}

		// If Radient Pass flow is enabled:
		if (isRadientPassFlowEnabled) {
			// Cannot go back from RADIENT_CHOICE
			if (currentStep === OnboardingStep.RADIENT_CHOICE) {
				return false;
			}
			// If using Radient Pass, cannot go back from CREATE_AGENT (first step after sign-in)
			if (isUsingRadientPass && currentStep === OnboardingStep.CREATE_AGENT) {
				return false;
			}
			// Otherwise, can go back (e.g., from SIGNIN to CHOICE, or within DIY steps)
			return true;
		}

		// If Radient Pass flow is disabled:
		// Cannot go back from the initial WELCOME step
		return currentStep !== OnboardingStep.WELCOME;
	}, [
		currentStep,
		isRadientPassFlowEnabled,
		isLoadingProviderAuth,
		isUsingRadientPass,
	]);

	/**
	 * Get the text for the 'Next'/'Finish' button
	 */
	const nextButtonText =
		currentStep === OnboardingStep.CONGRATULATIONS
			? "🚀 Get Started"
			: "Next →";

	// Check if an agent has been created (relevant for enabling Next on Create Agent step)
	const hasCreatedAgent = Boolean(
		sessionStorage.getItem("onboarding_created_agent_id"),
	);

	// Determine if the Next button should be disabled
	const isNextDisabled =
		// Disable on Create Agent step if no agent has been created yet
		currentStep === OnboardingStep.CREATE_AGENT && !hasCreatedAgent;

	// Render dialog actions (Back, Skip, Next buttons)
	const dialogActions = (
		<>
			{/* Back Button Area */}
			<Box sx={{ minWidth: "80px" }}>
				{" "}
				{/* Ensure space even if button hidden */}
				{canGoBack && (
					<SecondaryButton onClick={handleBack}>Back</SecondaryButton>
				)}
			</Box>

			{/* Skip/Next Button Area */}
			<Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
				{canSkip && <SkipButton onClick={handleSkip}>Skip</SkipButton>}
				{/* Hide Next button on choice/signin steps */}
				{currentStep !== OnboardingStep.RADIENT_CHOICE &&
					currentStep !== OnboardingStep.RADIENT_SIGNIN && (
						<PrimaryButton onClick={handleNext} disabled={isNextDisabled}>
							{nextButtonText}
						</PrimaryButton>
					)}
			</Box>
		</>
	);

	// Render step indicator dots
	const stepIndicators = (
		<StepIndicatorContainer>
			{steps.map((step) => {
				const isActive = currentStep === step;
				const isVisited = visitedSteps.has(step);
				// Allow navigation only to visited steps that are not the current one
				const canNavigate = isVisited && step !== currentStep;

				// Special case: Don't allow navigating back to CHOICE/SIGNIN via dots
				const isNonNavigableRadientStep =
					step === OnboardingStep.RADIENT_CHOICE ||
					step === OnboardingStep.RADIENT_SIGNIN;

				return (
					<Tooltip key={step} title={stepTitles[step]} arrow>
						{/* Use Box as Tooltip child requires DOM element */}
						<Box
							onClick={() => {
								if (canNavigate && !isNonNavigableRadientStep) {
									setCurrentStep(step);
								}
							}}
							sx={{ cursor: canNavigate ? "pointer" : "default" }} // Add pointer cursor
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
				disableEscapeKeyDown: true, // Prevent closing with Escape key
			}}
		>
			{/* Show loading indicator or step content */}
			{isLoadingProviderAuth ? (
				<Box
					sx={{
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						minHeight: "200px", // Ensure minimum height during load
						py: 4, // Add some padding
					}}
				>
					<CircularProgress /> {/* Use MUI spinner */}
				</Box>
			) : (
				stepContent // Render the actual step content
			)}
		</OnboardingDialog>
	);
};
