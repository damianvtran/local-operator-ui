import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import type { Meta, StoryObj } from "@storybook/react";
import React from "react"; // Add React import
import { OnboardingModal } from "./onboarding-modal";

/**
 * Storybook stories for the OnboardingModal component.
 *
 * This showcases the full onboarding flow with mocked Zustand store state.
 * The onboarding steps are displayed inside a fullscreen modal with theme-aware styling.
 */
const meta: Meta<typeof OnboardingModal> = {
	title: "Onboarding/OnboardingModal",
	component: OnboardingModal,
	parameters: {
		layout: "fullscreen",
		viewport: {
			defaultViewport: "custom",
			viewports: {
				custom: {
					name: "Onboarding Window",
				},
			},
		},
	},
	decorators: [
		(Story) => {
			const state = useOnboardingStore.getState();
			state.resetOnboarding();
			// Default start step is now RADIENT_CHOICE
			state.setCurrentStep(OnboardingStep.RADIENT_CHOICE);

			// Clear the session to allow re-running the story
			window.sessionStorage.removeItem("mock-radient-session");

			return <Story />;
		},
	],
	tags: ["autodocs"],
};

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Default onboarding flow starting at the welcome step.
 */
export const Default: Story = {
	args: {
		open: true,
	},
};

/**
 * Onboarding flow showcasing the congratulations step.
 */
export const Congratulations: Story = {
	args: {
		open: true,
	},
	render: () => {
		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(OnboardingStep.CONGRATULATIONS);

		return <OnboardingModal open={true} />;
	},
};

/**
 * Onboarding flow showcasing the Radient sign-in step.
 */
export const RadientSignIn: Story = {
	args: {
		open: true,
	},
	render: () => {
		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(OnboardingStep.RADIENT_SIGNIN);

		return <OnboardingModal open={true} />;
	},
};

/**
 * Onboarding flow when Radient Pass (Provider Auth) is disabled.
 * The modal should automatically start at the User Profile step.
 */
export const RadientPassDisabled: Story = {
	args: {
		open: true,
	},
	render: () => {
		// Temporarily override the mock for this story
		// biome-ignore lint/suspicious/noExplicitAny: Mocking window API
		const originalCheck = (window as any).api.ipcRenderer
			.checkProviderAuthEnabled;
		// biome-ignore lint/suspicious/noExplicitAny: Mocking window API
		(window as any).api.ipcRenderer.checkProviderAuthEnabled = async () => {
			console.log(
				"[Storybook Mock Override] checkProviderAuthEnabled returning false",
			);
			return false;
		};

		// Reset state - start at RADIENT_CHOICE, the component should redirect
		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(OnboardingStep.RADIENT_CHOICE);

		// Restore the original mock when the component unmounts
		// biome-ignore lint/correctness/useExhaustiveDependencies: Effect runs once on mount/unmount
		React.useEffect(() => {
			return () => {
				// biome-ignore lint/suspicious/noExplicitAny: Mocking window API
				(window as any).api.ipcRenderer.checkProviderAuthEnabled =
					originalCheck;
				console.log(
					"[Storybook Mock Override] Restored checkProviderAuthEnabled",
				);
			};
		}, []); // Empty dependency array ensures this runs only on mount and unmount

		return <OnboardingModal open={true} />;
	},
};
