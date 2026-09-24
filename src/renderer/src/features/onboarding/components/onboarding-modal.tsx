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

import { useDesktopProviders } from "@shared/api/local-operator/desktop-hooks";
import { Button, Tooltip } from "@shared/components/ui";
import { hasConnectedProvider } from "@shared/hooks/first-time-user";
import { cn } from "@shared/lib/utils";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OnboardingDialog } from "./onboarding-dialog";
import type { OnboardingPanelWidth } from "./onboarding-dialog";
import { ConnectProviderStep } from "./steps/connect-provider-step";
import { DefaultModelStep } from "./steps/default-model-step";
import { ExtrasStep } from "./steps/extras-step";

/*
 * One title per step, each naming the single thing that step is for. These
 * double as the accessible names of the progress segments, so they have to
 * survive being read on their own, out of order.
 */
const stepTitles: Record<OnboardingStep, string> = {
	[OnboardingStep.CONNECT_PROVIDER]: "Connect a model provider",
	[OnboardingStep.DEFAULT_MODEL]: "Your default model",
	[OnboardingStep.EXTRAS]: "A few optional extras",
};

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
	const [continuing, setContinuing] = useState(false);
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

	const dialogTitle = stepTitles[currentStep] ?? "First-time setup";

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
		} else {
			finish();
		}
	}, [currentStep, setCurrentStep, finish]);

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
				return <ExtrasStep />;
			default:
				return null;
		}
	}, [currentStep, setCurrentStep, registerBeforeContinue]);

	const isFirst = currentStep === OnboardingStep.CONNECT_PROVIDER;
	const isLast = currentStep === OnboardingStep.EXTRAS;

	/*
	 * Footer per step (design section 5):
	 * - step 1: ghost "Skip for now" on the left until something is connected,
	 *   then primary "Continue" on the right -- never an enabled Next over
	 *   nothing;
	 * - step 2: Back, then primary "Continue";
	 * - step 3: Back, then ghost "Skip" and primary "Finish".
	 */
	const blocked = currentStep === OnboardingStep.DEFAULT_MODEL && stepBlock !== null;
	const dialogActions = (
		<div className="flex w-full flex-col gap-2">
			{blocked ? (
				<p className="text-ink-dim text-meta">{stepBlock}</p>
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
					<Button variant="ghost" size="lg" onClick={finish}>
						Skip
					</Button>
				) : null}
				{!isFirst || connected ? (
					<Button
						variant="primary"
						size="lg"
						onClick={() => void handleNext()}
						disabled={continuing || blocked}
					>
						{isLast ? "Finish" : "Continue"}
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
