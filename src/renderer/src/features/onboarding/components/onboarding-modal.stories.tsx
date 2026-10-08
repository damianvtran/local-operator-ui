import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useLayoutEffect } from "react";
/* Also imported by the Storybook preview; kept here so the file is honest
   about what it needs to render, and so it renders if run in isolation. */
import "../../../styles/index.css";
import { OnboardingModal } from "./onboarding-modal";

/**
 * The first-run flow, one story per step.
 *
 * ## Why every step has its own story
 *
 * The flow is three screens and a conversation. Pacing is a property of the sequence, and you
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
 * There is no backend, so the steps that read providers, credentials, models
 * or public agents render their loading or empty branch. That is the honest
 * thing to screenshot: those branches are states a real user hits too.
 */
type StoryArgs = {
	step: OnboardingStep;
};

const OnboardingFrame = ({ step }: StoryArgs) => {
	useLayoutEffect(() => {
		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(step);
	}, [step]);

	return <OnboardingModal open={true} />;
};

const meta: Meta<StoryArgs> = {
	title: "Onboarding/OnboardingModal",
	parameters: { layout: "fullscreen" },
	argTypes: {
		step: { control: "select", options: Object.values(OnboardingStep) },
	},
	args: { step: OnboardingStep.CONNECT_PROVIDER },
	render: ({ step }) => <OnboardingFrame step={step} />,
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** The first screen: the registry-backed provider grid. */
export const Default: Story = {};

/** Step 2 without a backend: its loading branch. See `sign-in-states.stories.tsx`
 * for the bridge-backed frames of every answer this step can give. */
export const DefaultModel: Story = {
	args: { step: OnboardingStep.DEFAULT_MODEL },
};

/** Step 3 against a backend WITHOUT Aida: web search, then "Finish". */
export const Extras: Story = { args: { step: OnboardingStep.EXTRAS } };

/*
 * A desktop transport that answers the two reads the last step makes about her:
 * the capability (`features.aida`) and her status document with a configured
 * name. Installed per render and restored on unmount, for the reason
 * `provider-setup.stories.tsx` gives beside its own bridge. Any other op is a
 * loud failure rather than a quiet spinner.
 */
const AidaBridge = ({
	name,
	children,
}: {
	name: string;
	children: ReactNode;
}): ReactNode => {
	useLayoutEffect(() => {
		const page = window as unknown as {
			api?: { desktop?: { request: (r: { op: string }) => Promise<unknown> } };
		};
		const api = page.api ?? {};
		page.api = api;
		const previous = api.desktop;
		api.desktop = {
			request: async (request) => {
				const ok = (result: unknown) => ({ status: 200, body: { result } });
				switch (request.op) {
					case "capabilities":
						return ok({
							desktop_contract: 1,
							desktop_available: true,
							desktop_auth: "bearer",
							features: { auth: 1, aida: 1 },
						});
					case "aida.status":
						return ok({
							enabled: true,
							session_id: null,
							paused: false,
							greeted: false,
							name,
						});
					case "providers.list":
						return ok({ providers: [] });
					default:
						throw new Error(
							`unexpected desktop op in this story: ${request.op}`,
						);
				}
			},
		};
		return () => {
			api.desktop = previous;
		};
	}, [name]);
	return children;
};

/**
 * Step 3 when setup ends in her conversation (first-run onboarding, U1/D12):
 * "Next: meet <name>" says what the primary does before it is pressed, the
 * primary reads "Meet <name>" with her LIVE name (here a renamed one, so the
 * frame proves it is read rather than spelled), and the ghost names where it
 * goes - "Skip to chat".
 */
export const ExtrasMeetAida: Story = {
	args: { step: OnboardingStep.EXTRAS },
	render: ({ step }) => (
		<AidaBridge name="Ada">
			<OnboardingFrame step={step} />
		</AidaBridge>
	),
};
