import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import type { Meta, StoryObj } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PostHogProvider } from "posthog-js/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { config } from "../../config";
import {
	OnboardingStep,
	useOnboardingStore,
} from "../../store/onboarding-store";
import theme from "@renderer/theme";
import { OnboardingModal } from "./onboarding-modal";
import { AuthProviders } from "../../providers/auth";

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
			state.setCurrentStep(OnboardingStep.WELCOME);

			const queryClient = new QueryClient();

			return (
				<QueryClientProvider client={queryClient}>
					<MemoryRouter>
						<PostHogProvider
							apiKey={config.VITE_PUBLIC_POSTHOG_KEY}
							options={{
								api_host: config.VITE_PUBLIC_POSTHOG_HOST,
								autocapture: false,
								capture_pageview: false,
							}}
						>
							<AuthProviders
								googleClientId={config.VITE_GOOGLE_CLIENT_ID}
								microsoftClientId={config.VITE_MICROSOFT_CLIENT_ID}
								microsoftTenantId={config.VITE_MICROSOFT_TENANT_ID}
							>
								<ThemeProvider theme={theme}>
									<CssBaseline />
									<Story />
								</ThemeProvider>
							</AuthProviders>
						</PostHogProvider>
					</MemoryRouter>
				</QueryClientProvider>
			);
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
