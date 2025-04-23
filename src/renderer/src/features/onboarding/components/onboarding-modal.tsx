/**
 * Onboarding Modal Component
 *
 * Main container for the first-time setup experience.
 * Manages the flow between different onboarding steps.
 */

import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, CircularProgress, Tooltip, useTheme } from "@mui/material"; // Added CircularProgress and useTheme
import { getUserInfo } from "@shared/api/radient/auth-api";
// Import buttons from the local styled components file
import { apiConfig } from "@shared/config";
import { radientUserKeys } from "@shared/hooks/use-radient-user-query";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import { useUserStore } from "@shared/store/user-store";
import { clearSession, getSession } from "@shared/utils/session-store";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OnboardingDialog } from "./onboarding-dialog";
import {
	CongratulationsContainer,
	CongratulationsIcon,
	CongratulationsMessage,
	CongratulationsTitle,
	PrimaryButton, // Import from local styled components
	SecondaryButton, // Import from local styled components
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
// WelcomeStep is removed

// Define step titles outside the component for stability
// Use Partial<> as not all steps might have explicit titles defined here anymore
const stepTitles: Partial<Record<OnboardingStep, string>> = {
	[OnboardingStep.RADIENT_CHOICE]: "Choose Your Setup Option",
	[OnboardingStep.RADIENT_SIGNIN]: "Sign in with a Radient Pass",
	// [OnboardingStep.WELCOME]: "Welcome to Local Operator", // Removed
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
	const theme = useTheme(); // Get theme for spacing
	const { currentStep, setCurrentStep, completeOnboarding } =
		useOnboardingStore();
	const navigate = useNavigate();

	// Feature flag 'radient-pass-onboarding' is now GA (always enabled)

	// State to track if provider auth (OAuth credentials) is configured in the backend
	const [isProviderAuthEnabled, setIsProviderAuthEnabled] = useState(false); // Assume disabled initially
	// State to track loading status for the provider auth check
	const [isLoadingProviderAuth, setIsLoadingProviderAuth] = useState(true); // Start loading

	// Determine if the full Radient Pass flow should be enabled (backend config only)
	const isRadientPassFlowEnabled = isProviderAuthEnabled;

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

	// Get the query client for invalidating queries
	const queryClient = useQueryClient();

	// On mount (or when auth check completes), check for a persisted session, validate it, and fetch user info
	useEffect(() => {
		// Only run if provider auth check is complete
		if (isLoadingProviderAuth) return;

		const tryRestoreSession = async () => {
			const sessionData = await getSession();
			if (!sessionData) {
				return; // No session, do nothing
			}

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

					// If Radient Pass flow is enabled (provider auth configured) and user is authenticated,
					// send them directly to create agent step and mark as using Radient Pass
					if (isRadientPassFlowEnabled) {
						setIsUsingRadientPass(true);
						setCurrentStep(OnboardingStep.CREATE_AGENT);
					} else {
						// If Radient Pass flow is *not* enabled (provider auth not configured),
						// but user somehow authenticated (e.g., old session), start them at User Profile.
						// This shouldn't normally happen if provider auth is off, but handles edge cases.
						setCurrentStep(OnboardingStep.USER_PROFILE);
					}

					// Invalidate queries to ensure fresh data
					queryClient.invalidateQueries({ queryKey: radientUserKeys.all });
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
	}, [setCurrentStep, isLoadingProviderAuth, isRadientPassFlowEnabled, queryClient]);

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
			return []; // No indicator needed during choice/signin
		}

		// If user is using Radient Pass (flow is enabled) and is at CREATE_AGENT or CONGRATULATIONS step,
		// only show those two steps in the indicator.
		if (
			isRadientPassFlowEnabled &&
			isUsingRadientPass &&
			(currentStep === OnboardingStep.CREATE_AGENT ||
				currentStep === OnboardingStep.CONGRATULATIONS)
		) {
			return [OnboardingStep.CREATE_AGENT, OnboardingStep.CONGRATULATIONS];
		}

		// DIY path (either Radient Pass flow is disabled, or user chose DIY from Radient Choice)
		// The DIY path always starts visually from User Profile now.
		const diySteps = [
			OnboardingStep.USER_PROFILE,
			OnboardingStep.MODEL_CREDENTIAL,
			OnboardingStep.SEARCH_API,
			OnboardingStep.DEFAULT_MODEL,
			OnboardingStep.CREATE_AGENT,
			OnboardingStep.CONGRATULATIONS,
		];

		return diySteps;
	}, [isRadientPassFlowEnabled, currentStep, isUsingRadientPass]);

	// Track visited steps for navigation - Moved before usage in useEffect
	const [visitedSteps, setVisitedSteps] = useState<Set<OnboardingStep>>(
		new Set([currentStep]),
	);

	// Adjust the initial step based on the enabled flow after loading
	useEffect(() => {
		// Wait until provider auth status is loaded and ensure we are on the initial step
		if (
			isLoadingProviderAuth ||
			visitedSteps.size > 1 || // Only adjust if it's the very first load
			currentStep === OnboardingStep.CREATE_AGENT // Don't adjust if already jumped via session restore
		) {
			return;
		}

		// If Radient Pass flow is enabled (provider auth configured), start at RADIENT_CHOICE.
		if (isRadientPassFlowEnabled) {
			// Only set if not already there (e.g., due to session restore logic)
			if (currentStep !== OnboardingStep.RADIENT_CHOICE) {
				setCurrentStep(OnboardingStep.RADIENT_CHOICE);
			}
		}
		// If Radient Pass flow is *disabled* (provider auth not configured),
		// skip choice/signin and start directly at USER_PROFILE.
		else {
			// Only set if not already there
			if (currentStep !== OnboardingStep.USER_PROFILE) {
				setCurrentStep(OnboardingStep.USER_PROFILE);
			}
		}
	}, [
		// Cleaned up dependencies based on Biome suggestions and actual usage
		isRadientPassFlowEnabled,
		currentStep, // Need currentStep to check if redirection is needed
		setCurrentStep, // Need setCurrentStep to perform redirection
		isLoadingProviderAuth, // Need loading state to gate the effect
		visitedSteps.size, // Need size to check if it's the first load
	]);

	// Detect if user has jumped from RADIENT_SIGNIN directly to CREATE_AGENT
	// This indicates they successfully used Radient Pass
	useEffect(() => {
		if (
			previousStepRef.current === OnboardingStep.RADIENT_SIGNIN &&
			currentStep === OnboardingStep.CREATE_AGENT
		) {
			setIsUsingRadientPass(true);
		}
	}, [currentStep]); // Only depends on currentStep

	// Update visited steps when currentStep changes
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
				return "Choose Your Setup Option"; // More specific title
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
				return <RadientSignInStep />;
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
	 * Handle moving to the next step (DIY flow)
	 */
	const handleNext = useCallback(() => {
		// DIY flow transitions (Radient Choice/Signin don't use 'Next')
		switch (currentStep) {
			// case OnboardingStep.WELCOME: // Removed
			// 	setCurrentStep(OnboardingStep.USER_PROFILE);
			// 	break;
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
				// If Radient Pass flow is disabled, we started here, so back is disabled (handled by canGoBack).
				if (isRadientPassFlowEnabled) {
					setCurrentStep(OnboardingStep.RADIENT_CHOICE);
				}
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
				// If using Radient Pass, back goes nowhere (handled by canGoBack).
				// If DIY, back goes to DEFAULT_MODEL.
				if (!isUsingRadientPass) {
					setCurrentStep(OnboardingStep.DEFAULT_MODEL);
				}
				break;
			// Cannot go back from RADIENT_CHOICE or CONGRATULATIONS (and WELCOME is removed)
			default:
				break; // No action for other steps like RADIENT_CHOICE, CONGRATULATIONS
		}
	}, [
		currentStep,
		setCurrentStep,
		isRadientPassFlowEnabled,
		isUsingRadientPass,
	]);

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

		// Cannot go back from Congratulations (Duplicate check removed)
		if (currentStep === OnboardingStep.CONGRATULATIONS) {
			return false;
		}

		// Cannot go back from RADIENT_CHOICE (the new starting point when enabled)
		if (currentStep === OnboardingStep.RADIENT_CHOICE) {
			return false;
		}

		// If Radient Pass flow is enabled:
		if (isRadientPassFlowEnabled) {
			// If using Radient Pass, cannot go back from CREATE_AGENT (first step after sign-in)
			if (isUsingRadientPass && currentStep === OnboardingStep.CREATE_AGENT) {
				return false;
			}
			// Otherwise, can go back (e.g., from SIGNIN to CHOICE, or within DIY steps after USER_PROFILE)
			return true;
		}

		// If Radient Pass flow is disabled:
		// Cannot go back from USER_PROFILE (the starting point when disabled)
		if (currentStep === OnboardingStep.USER_PROFILE) {
			return false;
		}
		// Otherwise, can go back within the remaining DIY steps
		return true;
	}, [
		currentStep,
		isRadientPassFlowEnabled, // Still needed to determine logic paths
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
	// Render dialog actions (Back, Skip, Next buttons) - Adjusted layout
	const dialogActions = (
		<Box
			sx={{
				display: "flex",
				justifyContent: "space-between", // Space out Back and Next/Skip
				width: "100%",
				alignItems: "center",
				gap: theme.spacing(1.5), // Consistent gap
			}}
		>
			{/* Back Button Area - Use flex-start alignment */}
			<Box sx={{ display: "flex", justifyContent: "flex-start" }}>
				{canGoBack ? (
					<SecondaryButton onClick={handleBack}>Back</SecondaryButton>
				) : (
					<Box sx={{ minWidth: 100 }} /> // Placeholder to maintain alignment
				)}
			</Box>

			{/* Skip/Next Button Area - Use flex-end alignment */}
			<Box
				sx={{
					display: "flex",
					justifyContent: "flex-end",
					gap: theme.spacing(1.5), // Consistent gap
					alignItems: "center",
				}}
			>
				{canSkip && <SkipButton onClick={handleSkip}>Skip</SkipButton>}
				{/* Hide Next button on choice/signin steps */}
				{currentStep !== OnboardingStep.RADIENT_CHOICE &&
					currentStep !== OnboardingStep.RADIENT_SIGNIN && (
						<PrimaryButton onClick={handleNext} disabled={isNextDisabled}>
							{nextButtonText}
						</PrimaryButton>
					)}
			</Box>
		</Box>
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
					// @ts-ignore - Ignore potential TS issue with Tooltip wrapping custom component
					<Tooltip key={step} title={stepTitles[step]} arrow>
						{/* Wrap StepDot directly if it forwards refs, otherwise use a Box */}
						{/* The updated StepDot handles cursor styling internally */}
						<StepDot
							active={isActive}
							visited={isVisited}
							onClick={() => {
								// Navigation logic remains the same
								if (canNavigate && !isNonNavigableRadientStep) {
									setCurrentStep(step);
								}
							}}
						/>
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
						minHeight: "250px", // Consistent min height
						py: theme.spacing(4), // Use theme spacing
					}}
				>
					<CircularProgress />
				</Box>
			) : (
				stepContent // Render the actual step content
			)}
		</OnboardingDialog>
	);
};
