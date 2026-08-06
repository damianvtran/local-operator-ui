import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect } from "react";
/* Also imported by the Storybook preview; kept here so the file is honest
   about what it needs to render, and so it renders if run in isolation. */
import "../../../styles/index.css";
import { OnboardingModal } from "./onboarding-modal";

/*
 * The sign-in step's credit amounts come from a real fetch to the live Radient
 * API, so twelve committed frames were racing the network: between two
 * captures of identical source, `radient-sign-in/localOperatorDark` flipped
 * from resolved values to two inline spinners mid-sentence. The numbers are
 * also third-party content that can change without a commit here.
 *
 * Stubbed at the boundary, the way the schedules story does it, so the frames
 * show one known set of values every time.
 */
const PRICES = {
	default_new_credits: 5,
	default_registration_credits: 10,
};

const originalFetch = window.fetch;
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = typeof input === "string" ? input : input.toString();
	if (url.includes("/v1/prices")) {
		return new Response(
			JSON.stringify({ status: 200, message: "ok", result: PRICES }),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	}
	return originalFetch(input, init);
}) as typeof window.fetch;

/**
 * The first-run flow, one story per step.
 *
 * ## Why every step has its own story
 *
 * The flow is eight screens and only three of them used to be reachable here,
 * so the four form steps — where the control heights, the label rhythm and the
 * help-text register actually live — were reviewed by clicking through the
 * running app or not at all. Pacing is a property of the sequence, and you
 * cannot judge a sequence you can only enter at one end.
 *
 * ## Why `data-theme` goes on `documentElement`
 *
 * The dialog portals to `document.body`, outside any wrapper a story could
 * render. With the theme only on a wrapper every `--lo-*` read inside the
 * portal resolves to nothing and the panel comes out unstyled — while the page
 * behind it looks correct, which makes it slow to diagnose. The preview frame
 * in `.storybook/preview.tsx` puts it on the root for every story.
 *
 * ## What is not real here
 *
 * There is no backend, so the steps that read credentials, models or public
 * agents render their loading or empty branch. That is the honest thing to
 * screenshot: those branches are states a real user hits too.
 */
type StoryArgs = {
	step: OnboardingStep;
};

const OnboardingFrame = ({ step }: StoryArgs) => {
	useLayoutEffect(() => {
		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(step);
		// Cleared so the modal's session-restore effect does not jump the flow
		// to Create agent on every re-render of a story.
		window.sessionStorage.removeItem("mock-radient-session");
	}, [step]);

	return <OnboardingModal open={true} />;
};

const meta: Meta<StoryArgs> = {
	title: "Onboarding/OnboardingModal",
	parameters: { layout: "fullscreen" },
	argTypes: {
		step: { control: "select", options: Object.values(OnboardingStep) },
	},
	args: { step: OnboardingStep.RADIENT_CHOICE },
	render: ({ step }) => <OnboardingFrame step={step} />,
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** The first screen: two options, one recommended, nothing else. */
export const Default: Story = {};

/** What Radient Pass is, and the two ways in. */
export const RadientSignIn: Story = {
	args: { step: OnboardingStep.RADIENT_SIGNIN },
};

/** First step of the do-it-yourself path. Two fields, one optional. */
export const UserProfile: Story = {
	args: { step: OnboardingStep.USER_PROFILE },
};

/** A select and a password field at the large control size. */
export const ModelCredential: Story = {
	args: { step: OnboardingStep.MODEL_CREDENTIAL },
};

/** The one skippable step in the flow. */
export const SearchApi: Story = { args: { step: OnboardingStep.SEARCH_API } };

/** Two dependent selects; renders its loading branch without a backend. */
export const DefaultModel: Story = {
	args: { step: OnboardingStep.DEFAULT_MODEL },
};

/** The last decision. Without a backend this shows the load-failure branch. */
export const CreateAgent: Story = {
	args: { step: OnboardingStep.CREATE_AGENT },
};

/** The end of the flow, and the one place the accent is spent on celebration. */
export const Congratulations: Story = {
	args: { step: OnboardingStep.CONGRATULATIONS },
};
