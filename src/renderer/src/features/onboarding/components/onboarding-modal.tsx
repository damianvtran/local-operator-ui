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
 *
 * SETUP ENDS IN A CONVERSATION WITH AIDA (first-run onboarding, U1/A2). The
 * operator's rule: after setup the user lands INSIDE her conversation and SHE
 * speaks first. The last step's primary button is "Meet <her name>", and its
 * press is the attended request (`greet`) that ensures her session and arms her
 * hidden greeting - the only place the desktop asks for it, so a background
 * launch never does. Every other way out (Skip, Escape, the close button, a
 * backend without her) lands in the chat as before.
 */

import {
	aidaGreetFailure,
	aidaGreetHeldNotice,
	aidaOwesGreeting,
} from "@features/aida/aida-control";
import { useAidaControl, useAidaTarget } from "@features/aida/use-aida-target";
import { openConversation } from "@features/chat/open-conversation";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
	useDesktopProviders,
} from "@shared/api/local-operator/desktop-hooks";
import { Button, Tooltip } from "@shared/components/ui";
import { hasConnectedProvider } from "@shared/hooks/first-time-user";
import { cn } from "@shared/lib/utils";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OnboardingDialog } from "./onboarding-dialog";
import type { OnboardingPanelWidth } from "./onboarding-dialog";
import { onboardingFooter } from "./onboarding-footer";
import { ConnectProviderStep } from "./steps/connect-provider-step";
import { DefaultModelStep } from "./steps/default-model-step";
import { ExtrasStep } from "./steps/extras-step";

/*
 * One title per step, each naming the single thing that step is for. These
 * double as the accessible names of the progress segments, so they have to
 * survive being read on their own, out of order.
 */
const stepTitles: Record<OnboardingStep, string> = {
	/*
	 * "AI account", not "model provider" (first-run onboarding, D11/U7): the
	 * heading the TUI's setup splash and `/login` picker share, in the words a
	 * first-time user already has.
	 */
	[OnboardingStep.CONNECT_PROVIDER]: "Connect an AI account",
	[OnboardingStep.DEFAULT_MODEL]: "Your default model",
	[OnboardingStep.EXTRAS]: "Web search (optional)",
};

/**
 * The title a step is read under, which for the LAST step is what the step ends
 * in rather than what it contains (design round 1, D4).
 *
 * "Web search (optional)" named the body while the primary action had become
 * `Meet <name>`, so the one screen that ends setup was titled after its smallest
 * part. With her available the title names her; without her the step really does
 * end in web search, so the shipped title stands.
 *
 * A function rather than a second table: `stepTitles` is also the accessible
 * name of each progress segment, and two spellings of one title is how the track
 * and the panel end up disagreeing about what step 3 is.
 */
function stepTitle(step: OnboardingStep, aidaName: string | null): string {
	if (step === OnboardingStep.EXTRAS && aidaName)
		return `Web search, then meet ${aidaName}`;
	return stepTitles[step];
}

/**
 * The numbered sequence, in order (design audit section 5). Three steps: the
 * model access the app cannot work without, the model it bought, and the
 * extras that are genuinely optional. "Create your first agent" and the
 * congratulations screen are gone -- the first failed on a clean install
 * (UX U11) and the second is folded into Finish, which lands in the chat.
 */
const STEP_SEQUENCE: OnboardingStep[] = [
	OnboardingStep.CONNECT_PROVIDER,
	OnboardingStep.DEFAULT_MODEL,
	OnboardingStep.EXTRAS,
];

/**
 * The panel measure each step is laid out at -- EMPTY, because every step takes
 * the same one.
 *
 * It used to map step 1 to a wider `grid` measure, and the dialog narrowed from
 * about 960px to 560px when Continue was pressed: the title, the step indicator
 * and the close button all jumped inward mid-flow (design round 1 D6). One
 * measure for the flow is the fix, and an empty map is how that is stated rather
 * than left to each call site to remember.
 *
 * EXPORTED because it is a rule CI has to be able to check:
 * `scripts/provider-grid-pin.test.mjs` asserts it is empty and that the single
 * measure is clamped, so a step added later cannot quietly widen the dialog.
 */
export const STEP_PANEL_WIDTH: Partial<
	Record<OnboardingStep, OnboardingPanelWidth>
> = {};

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
	/*
	 * Whether step 1 has done its job. Read from the census, the same predicate
	 * the first-run gate uses, so "Continue" appears exactly when a provider is
	 * connected and never before (design D6: an enabled Next with nothing
	 * connected let a user finish setup into a chat that could not run).
	 */
	const providers = useDesktopProviders(open);
	const connected = hasConnectedProvider(providers.data ?? []);
	/*
	 * Whether setup can end in her conversation: the capability gate the rail's
	 * row uses (`features.aida`, fail-closed - the UI must not call her route on
	 * a backend without it) AND the install's own switch, read from the status
	 * document, so a backend with her switched off finishes into the chat with
	 * no button promising someone who will never answer.
	 */
	const capabilities = useDesktopCapabilities();
	const aidaCapable = desktopFeatureEnabled(capabilities.data, "aida", 1);
	const aida = useAidaTarget(open && aidaCapable);
	const aidaAvailable = aidaCapable && aida.data?.enabled === true;
	/*
	 * `.trim() ||` rather than `??`: whitespace is a name the backend can hold
	 * (a rename to "   " is a string), and `??` would render "Meet " on the first
	 * screen a user ever sees (design round 1, D5). An empty or blank name falls
	 * back to the shipped default here, exactly as the sidebar's row does.
	 */
	const aidaName = aida.data?.name?.trim() || "Aida";
	/*
	 * Whether step 3 may promise that she speaks first. Read from the same status
	 * document as the name, off the ledger's state word; a backend that predates
	 * the field returns `owed`'s behaviour rather than silence (`aidaOwesGreeting`).
	 */
	const aidaOwesHello = aidaOwesGreeting(aida.data);
	const aidaControl = useAidaControl();
	/*
	 * One resolved title table for the panel and the track, so the two cannot
	 * spell step 3 differently (see `stepTitle`). Memoized because the track maps
	 * over it on every render.
	 */
	const resolvedTitles = useMemo(() => {
		const name = aidaAvailable ? aidaName : null;
		return Object.fromEntries(
			STEP_SEQUENCE.map((step) => [step, stepTitle(step, name)]),
		) as Record<OnboardingStep, string>;
	}, [aidaAvailable, aidaName]);
	const [meeting, setMeeting] = useState(false);
	/** Step 2 registers the write a PROPOSED default needs on Continue. */
	const beforeContinue = useRef<(() => Promise<void>) | null>(null);
	/*
	 * And what it still needs from the user before Continue can mean anything.
	 * A step that can be walked past with nothing chosen lands the user in a chat
	 * that cannot run (QA round 1 Q3, UX U1), so the step says what is missing
	 * here and Continue is disabled for exactly as long as it is missing it.
	 */
	const [stepBlock, setStepBlock] = useState<string | null>(null);
	const registerStepBlock = useCallback((reason: string | null) => {
		setStepBlock(reason);
	}, []);
	const [stepContinuing, setContinuing] = useState(false);
	/*
	 * Busy is either half: step 2's config write, or "Meet <name>" waiting on
	 * `greet`. One flag, because the footer's rule is the same for both - the
	 * primary is disabled while its own press is in flight.
	 */
	const continuing = stepContinuing || meeting;
	const registerBeforeContinue = useCallback(
		(run: (() => Promise<void>) | null) => {
			beforeContinue.current = run;
		},
		[],
	);

	/*
	 * A persisted mid-flow step from before this flow existed (the six-step
	 * flow, or the old Radient-gated one) must not strand the modal on an
	 * unknown step: any value outside the current sequence falls back to the
	 * first step.
	 */
	useEffect(() => {
		if (!STEP_SEQUENCE.includes(currentStep)) {
			setCurrentStep(OnboardingStep.CONNECT_PROVIDER);
		}
	}, [currentStep, setCurrentStep]);

	const [visitedSteps, setVisitedSteps] = useState<Set<OnboardingStep>>(
		new Set<OnboardingStep>(),
	);
	useEffect(() => {
		setVisitedSteps((prev) => {
			if (prev.has(currentStep)) return prev;
			const updated = new Set(prev);
			updated.add(currentStep);
			return updated;
		});
	}, [currentStep]);

	const dialogTitle = resolvedTitles[currentStep] ?? "First-time setup";

	/**
	 * Leave setup and land in the chat. Used by Finish, by "Skip for now" and
	 * by Escape / the close button: all three end setup, and the empty chat's
	 * connect card is what a user who skipped sees next (design section 6), so
	 * skipping is never a trap (UX U9).
	 */
	const finish = useCallback(() => {
		completeModalOnboarding();
		navigate("/chat");
	}, [completeModalOnboarding, navigate]);

	/**
	 * "Meet <name>": ask her to say hello, then open her conversation.
	 *
	 * ORDER: `greet` first, then the switch. The answer carries her session id
	 * (`greet` ensures it, so one call is enough), and opening before it answers
	 * would land on a conversation that may not exist yet. Setup is completed in
	 * the same press either way, so the modal closes onto wherever we land.
	 *
	 * THE GREETING ITSELF IS NOT AWAITED: it is a hidden wake whose reply streams
	 * into the conversation on its own, and the trigger never paints
	 * (`wakeIsHidden` in the transcript reducer). What the user sees is her
	 * conversation opening, then her first message arriving in it.
	 *
	 * A REFUSAL NEVER STRANDS THE USER: every failure lands in the chat with the
	 * sentence `aidaGreetFailure` composes for it (see there for the three cases).
	 */
	const meetAida = useCallback(async () => {
		setMeeting(true);
		try {
			const state = await aidaControl("greet");
			completeModalOnboarding();
			if (!state.session_id) {
				/*
				 * UNREACHABLE BY THE CONTRACT (`greet` ensures her session), and handled
				 * here rather than thrown (code review round 1, R6): a throw lands in the
				 * catch below, which re-describes it through `aidaGreetFailure` and appends
				 * the transport's own fallback sentence - so the user read "could not be
				 * opened" followed by "could not reach the backend" on a path where the
				 * backend answered 200. `/chat/null` is a pane showing nothing, so the
				 * landing is the chat either way; only this sentence belongs to it.
				 */
				navigate("/chat");
				showErrorToast(
					`${aidaName}'s conversation could not be opened, so you are in a new chat instead.`,
				);
				return;
			}
			void openConversation(navigate, state.session_id);
			const notice = aidaGreetHeldNotice(state, aidaName);
			if (notice) showInfoToast(notice);
		} catch (error) {
			completeModalOnboarding();
			navigate("/chat");
			const failure = aidaGreetFailure(error, aidaName);
			if (failure?.kind === "info") showInfoToast(failure.text);
			else if (failure) showErrorToast(failure.text);
		} finally {
			setMeeting(false);
		}
	}, [aidaControl, aidaName, completeModalOnboarding, navigate]);

	const handleNext = useCallback(async () => {
		const index = STEP_SEQUENCE.indexOf(currentStep);
		if (
			currentStep === OnboardingStep.DEFAULT_MODEL &&
			beforeContinue.current
		) {
			setContinuing(true);
			try {
				await beforeContinue.current();
			} catch {
				// `useUpdateConfig` already toasted the reason; stay on the step.
				setContinuing(false);
				return;
			}
			setContinuing(false);
		}
		if (index >= 0 && index < STEP_SEQUENCE.length - 1) {
			setCurrentStep(STEP_SEQUENCE[index + 1]);
		} else if (aidaAvailable) {
			await meetAida();
		} else {
			finish();
		}
	}, [currentStep, setCurrentStep, finish, aidaAvailable, meetAida]);

	const handleBack = useCallback(() => {
		const index = STEP_SEQUENCE.indexOf(currentStep);
		if (index > 0) setCurrentStep(STEP_SEQUENCE[index - 1]);
	}, [currentStep, setCurrentStep]);

	const stepContent = useMemo(() => {
		switch (currentStep) {
			case OnboardingStep.CONNECT_PROVIDER:
				return (
					<ConnectProviderStep
						onContinue={() => setCurrentStep(OnboardingStep.DEFAULT_MODEL)}
					/>
				);
			case OnboardingStep.DEFAULT_MODEL:
				return (
					<DefaultModelStep
						onBeforeContinue={registerBeforeContinue}
						onBlockReason={registerStepBlock}
					/>
				);
			case OnboardingStep.EXTRAS:
				return (
					<ExtrasStep
						aidaName={aidaAvailable ? aidaName : null}
						oweGreeting={aidaOwesHello}
					/>
				);
			default:
				return null;
		}
	}, [
		currentStep,
		setCurrentStep,
		registerBeforeContinue,
		registerStepBlock,
		aidaAvailable,
		aidaName,
		aidaOwesHello,
	]);

	const isFirst = currentStep === OnboardingStep.CONNECT_PROVIDER;
	const isLast = currentStep === OnboardingStep.EXTRAS;

	/*
	 * Footer per step (design section 5):
	 * - step 1: ghost "Skip for now" on the left until something is connected,
	 *   then primary "Continue" on the right -- never an enabled Next over
	 *   nothing;
	 * - step 2: Back, then primary "Continue";
	 * - step 3: Back, then ghost "Skip" and primary "Finish" - or, when she is
	 *   available, ghost "Skip to chat" and primary "Meet <name>" (first-run
	 *   onboarding, U1/D12). The ghost names where it goes because "Skip" beside
	 *   "Meet Aida" reads as skipping her, which it is, and the reader should
	 *   know that before pressing it.
	 */
	const footer = onboardingFooter(currentStep, stepBlock, continuing);
	const dialogActions = (
		<div className="flex w-full flex-col gap-2">
			{footer.reason ? (
				<p className="text-ink-dim text-meta">{footer.reason}</p>
			) : null}
			<div className="flex w-full items-center justify-between gap-3">
				<div>
					{isFirst ? (
						<Button variant="ghost" size="lg" onClick={finish}>
							Skip for now
						</Button>
					) : (
						<Button variant="secondary" size="lg" onClick={handleBack}>
							Back
						</Button>
					)}
				</div>
				<div className="flex items-center gap-3">
					{isLast ? (
						<Button
							variant="ghost"
							size="lg"
							onClick={finish}
							disabled={meeting}
						>
							{aidaAvailable ? "Skip to chat" : "Skip"}
						</Button>
					) : null}
					{!isFirst || connected ? (
						<Button
							variant="primary"
							size="lg"
							onClick={() => void handleNext()}
							disabled={footer.primaryDisabled}
						>
							{isLast
								? aidaAvailable
									? `Meet ${aidaName}`
									: "Finish"
								: "Continue"}
						</Button>
					) : null}
				</div>
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
								<Tooltip content={resolvedTitles[step]}>
									{/*
									 * A real button, so the track is tabbable and each step's
									 * name is announced. `aria-disabled` rather than
									 * `disabled`: a disabled button swallows pointer events,
									 * and the tooltip is the only place the name is written.
									 */}
									<button
										type="button"
										aria-label={resolvedTitles[step]}
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
	}, [currentStep, visitedSteps, setCurrentStep, resolvedTitles]);

	return (
		<OnboardingDialog
			open={open}
			onDismiss={finish}
			title={dialogTitle}
			stepIndicators={finalStepIndicatorsProp}
			actions={dialogActions}
			width={STEP_PANEL_WIDTH[currentStep] ?? "single"}
		>
			{stepContent}
		</OnboardingDialog>
	);
};
