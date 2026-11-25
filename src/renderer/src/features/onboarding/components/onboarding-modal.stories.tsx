import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useLayoutEffect } from "react";
/* Also imported by the Storybook preview; kept here so the file is honest
   about what it needs to render, and so it renders if run in isolation. */
import "../../../styles/index.css";
import type { IntroMode } from "./onboarding-intro";
import { OnboardingModal } from "./onboarding-modal";

/**
 * The first-run flow, one story per step.
 *
 * ## Why every step has its own story
 *
 * The flow is an intro, up to four steps and a conversation. Pacing is a property of the sequence, and you
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
	/** `skip` by default so a step story photographs the step, not the intro. */
	introMode?: IntroMode;
};

const OnboardingFrame = ({ step, introMode = "skip" }: StoryArgs) => {
	useLayoutEffect(() => {
		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(step);
	}, [step]);

	return <OnboardingModal open={true} introMode={introMode} />;
};

const meta: Meta<StoryArgs> = {
	title: "Onboarding/OnboardingModal",
	parameters: { layout: "fullscreen" },
	argTypes: {
		step: { control: "select", options: Object.values(OnboardingStep) },
	},
	args: { step: OnboardingStep.CONNECT_PROVIDER },
	render: ({ step, introMode }) => (
		<OnboardingFrame step={step} introMode={introMode} />
	),
};

export default meta;
type Story = StoryObj<StoryArgs>;

/**
 * The intro's FINAL frame, held: mark and helix at full strength, the welcome
 * line, and the skip hint. `hold` freezes the timeline so the capture is
 * deterministic.
 */
export const Intro: Story = { args: { introMode: "hold" } };

/**
 * The live timeline: intro, then the hand-off into sign-in at 2.2 s (any key or
 * click skips). Under reduced motion this opens straight on sign-in.
 */
export const IntroLive: Story = { args: { introMode: "auto" } };

/** Sign in, with no backend: the census is loading, so the buttons wait. */
export const Default: Story = {};

/** Step 2 without a backend: its loading branch. See `sign-in-states.stories.tsx`
 * for the bridge-backed frames of every answer this step can give. */
export const DefaultModel: Story = {
	args: { step: OnboardingStep.DEFAULT_MODEL },
};

/** Web search against a backend WITHOUT Aida: three options, then "Finish". */
export const Search: Story = { args: { step: OnboardingStep.SEARCH } };

/** Module-level so the bridge effect's dependency stays referentially stable. */
const NO_PROVIDERS: DesktopProvider[] = [];

/*
 * A desktop transport that answers the two reads the last step makes about her:
 * the capability (`features.aida`) and her status document with a configured
 * name. Installed per render and restored on unmount, for the reason
 * `provider-setup.stories.tsx` gives beside its own bridge. Any other op is a
 * loud failure rather than a quiet spinner.
 */
const AidaBridge = ({
	name,
	greetingState,
	providers = NO_PROVIDERS,
	children,
}: {
	name: string;
	/** The census `providers.list` serves; empty (a first run) by default. */
	providers?: DesktopProvider[];
	/**
	 * The ledger's state word, when the story is about it. OMITTED BY DEFAULT so
	 * the fixtures that predate the ledger photograph the tolerant path - an older
	 * backend's payload keeps the sentence that shipped.
	 */
	greetingState?: string | null;
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
							greeted: greetingState === "delivered",
							...(greetingState ? { greeting_state: greetingState } : {}),
							name,
						});
					case "providers.list":
						return ok({ providers });
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
	}, [name, greetingState, providers]);
	return children;
};

/**
 * The bookend, when setup ends in her conversation (first-run onboarding,
 * U1/D12): the helix back at full strength, "Meet Aida" as the display heading,
 * and the primary reading "Meet Aida" with her LIVE name from the status
 * document. The ghost names where it goes - "Skip to chat".
 */
export const MeetAida: Story = {
	args: { step: OnboardingStep.MEET },
	render: ({ step }) => (
		<AidaBridge name="Aida">
			<OnboardingFrame step={step} />
		</AidaBridge>
	),
};

/**
 * The bookend on an install whose greeting is already SETTLED - delivered, or
 * skipped by someone who chose not to be greeted: the sentence states what the
 * button does and does not promise a first hello the user has already had (code
 * review round 1's contract addendum, point 1; `aidaOwesGreeting`).
 */
export const MeetAidaDelivered: Story = {
	args: { step: OnboardingStep.MEET },
	render: ({ step }) => (
		<AidaBridge name="Aida" greetingState="delivered">
			<OnboardingFrame step={step} />
		</AidaBridge>
	),
};

/**
 * Radient signed in: the flags `providers.list` reports for a machine whose
 * store holds a Radient credential (same shape as `SIGNED_IN_CENSUS` in
 * `provider-setup.stories.tsx`), and nothing else connected.
 */
const RADIENT_CONNECTED_CENSUS: DesktopProvider[] = [
	{
		id: "radient",
		name: "Radient",
		storage_id: "radient",
		search_aliases: [],
		auth_methods: [],
		local: false,
		credential_optional: false,
		has_credential: true,
		configured: true,
		stored_credentials: 1,
		base_url: "https://api.radienthq.com/v1",
	},
];

/**
 * Sign-in once Radient is connected (design + QA round 1, ledger L14): the
 * panel reads "Signed in", the heading and sentence switch to the connected
 * copy, and the progress track has no web-search segment - Radient already
 * covers search, so the walk is sign-in, model, Meet Aida. This is the frame
 * the search-skip decision (`decideIncludeSearch`) is reviewed against.
 */
export const RadientConnected: Story = {
	render: ({ step }) => (
		<AidaBridge name="Aida" providers={RADIENT_CONNECTED_CENSUS}>
			<OnboardingFrame step={step} />
		</AidaBridge>
	),
};
