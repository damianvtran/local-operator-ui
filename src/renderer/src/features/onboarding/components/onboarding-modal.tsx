/**
 * Onboarding Modal Component
 *
 * The first-run setup experience: a full-window stage (`OnboardingStage`) that
 * opens on the brand mark and helix, hands the helix up into the sign-in step,
 * and walks the steps `onboardingSequence` derives - sign in, default model,
 * web search (only without Radient) and Meet Aida (only when she is available).
 *
 * Provider connection is registry-backed: a stored credential in the backend
 * AuthStore is what counts as connected - not a renderer-held OAuth session.
 *
 * SETUP ENDS IN A CONVERSATION WITH AIDA (first-run onboarding, U1/A2). The
 * operator's rule: after setup the user lands INSIDE her conversation and SHE
 * speaks first. The last step's primary button is "Meet <her name>", and its
 * press is the attended request (`greet`) that ensures her session and arms her
 * hidden greeting - the only place the desktop asks for it, so a background
 * launch never does. Every other way out (Skip, Escape, a backend without her)
 * lands in the chat as before.
 *
 * DROP-OFF IS MEASURED (stage refresh): every step reports
 * `onboarding_step_viewed` when it becomes the visible one and
 * `onboarding_step_completed` when the user leaves it forward
 * (`onboarding-analytics.ts`).
 */

import {
	aidaGreetFailure,
	aidaGreetHeldNotice,
	aidaOwesGreeting,
} from "@features/aida/aida-control";
import { useAidaControl, useAidaTarget } from "@features/aida/use-aida-target";
import { openConversation } from "@features/chat/open-conversation";
import { RECOMMENDED_PROVIDER_ID } from "@features/providers/provider-catalog";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
	useDesktopProviders,
} from "@shared/api/local-operator/desktop-hooks";
import { Button, Tooltip } from "@shared/components/ui";
import { hasConnectedProvider } from "@shared/hooks/first-time-user";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	type SearchChoice,
	trackOnboardingStepCompleted,
	trackOnboardingStepViewed,
} from "./onboarding-analytics";
import { OnboardingStage } from "./onboarding-dialog";
import { onboardingFooter } from "./onboarding-footer";
import { type IntroMode, useStageIntro } from "./onboarding-intro";
import {
	fallbackStep,
	onboardingSequence,
	radientConnected,
} from "./onboarding-sequence";
import {
	ConnectProviderStep,
	connectedSubscriptionBrands,
	stageConnected,
} from "./steps/connect-provider-step";
import { DefaultModelStep } from "./steps/default-model-step";
import { meetAidaCopy } from "./steps/meet-aida-step";
import { SearchApiStep } from "./steps/search-api-step";

/**
 * The name each step is read under on the progress track (its segments' accessible
 * names and tooltips). One table, so the track and the stage cannot disagree
 * about what a step is called.
 */
function trackTitle(step: OnboardingStep, aidaName: string): string {
	switch (step) {
		case OnboardingStep.CONNECT_PROVIDER:
			return t("ui.onboarding.modal.title.connect_provider");
		case OnboardingStep.DEFAULT_MODEL:
			return t("ui.onboarding.modal.title.default_model");
		case OnboardingStep.SEARCH:
			return t("ui.onboarding.modal.title.search");
		case OnboardingStep.MEET:
			return t("ui.onboarding.modal.title.meet", { name: aidaName });
		default:
			return t("ui.onboarding.modal.title.fallback");
	}
}

/**
 * Which provider a completed sign-in step reports: Radient when it is connected
 * (the recommendation is the fact worth counting), otherwise the first connected
 * cloud row. Ids only - never a label or anything typed.
 */
function connectedProviderId(
	providers: readonly { id: string; local?: boolean }[],
	isConnected: (id: string) => boolean,
): string | null {
	if (isConnected(RECOMMENDED_PROVIDER_ID)) return RECOMMENDED_PROVIDER_ID;
	return providers.find((row) => isConnected(row.id))?.id ?? null;
}

type OnboardingModalProps = {
	/** Whether setup is showing. */
	open: boolean;
	/**
	 * The intro's behaviour; `auto` in the product. Stories pass `hold` (the intro's
	 * final frame) or `skip` (straight to a step) so a capture is deterministic.
	 */
	introMode?: IntroMode;
};

export const OnboardingModal: FC<OnboardingModalProps> = ({
	open,
	introMode = "auto",
}) => {
	// Step children subscribe independently; they cannot refresh their parent's
	// retained title/progress elements, including while a step is unmounted.
	const locale = useI18nLocale();
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
	const census = providers.data ?? [];
	const connected = hasConnectedProvider(census);
	const radientOn = radientConnected(census);
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
	 * Whether the Meet step may promise that she speaks first. Read from the same
	 * status document as the name, off the ledger's state word; a backend that
	 * predates the field returns `owed`'s behaviour rather than silence.
	 */
	const aidaOwesHello = aidaOwesGreeting(aida.data);
	const aidaControl = useAidaControl();

	/*
	 * THE SEARCH LATCH (`onboarding-sequence.ts`). Live while the user is on the
	 * first two steps - where Radient connecting legitimately removes the step -
	 * and frozen from the moment they leave the model step, so a Radient sign-in
	 * completed ON the search step never pulls it out from under them.
	 */
	const [includeSearch, setIncludeSearch] = useState(() => !radientOn);
	const latchOpen =
		currentStep === OnboardingStep.CONNECT_PROVIDER ||
		currentStep === OnboardingStep.DEFAULT_MODEL;
	useEffect(() => {
		if (latchOpen) setIncludeSearch(!radientOn);
	}, [latchOpen, radientOn]);

	const sequence = useMemo(
		() => onboardingSequence({ includeSearch, aidaAvailable }),
		[includeSearch, aidaAvailable],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: locale invalidates translations resolved by trackTitle.
	const resolvedTitles = useMemo(
		() =>
			Object.fromEntries(
				sequence.map((step) => [step, trackTitle(step, aidaName)]),
			) as Record<OnboardingStep, string>,
		[sequence, aidaName, locale],
	);
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
	/** The search step's current answer, reported when it is completed. */
	const searchChoice = useRef<SearchChoice>("free");
	const onSearchChoice = useCallback((choice: SearchChoice) => {
		searchChoice.current = choice;
	}, []);

	/*
	 * A persisted step outside the live sequence - from an older flow, or a
	 * migrated `extras` whose search step Radient has since removed - moves to its
	 * successor (`fallbackStep`). WAITS for the facts the sequence is made of: a
	 * persisted Meet step must not be thrown back to sign-in in the instant
	 * before her status document answers.
	 */
	const sequenceSettled =
		!capabilities.isLoading && !(aidaCapable && aida.isLoading);
	useEffect(() => {
		if (!sequenceSettled) return;
		const next = fallbackStep(currentStep, sequence);
		if (next !== currentStep) setCurrentStep(next);
	}, [currentStep, sequence, sequenceSettled, setCurrentStep]);

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

	/*
	 * THE INTRO plays only when setup opens on its first step: a user resuming on
	 * step 3 is not welcomed into a sign-in they already did.
	 */
	const { phase, skipped } = useStageIntro(
		open,
		currentStep === OnboardingStep.CONNECT_PROVIDER,
		introMode,
	);

	/*
	 * `viewed` once per step the user actually SEES: not while the intro still
	 * hides the steps, and not twice for one visit.
	 */
	const lastViewed = useRef<OnboardingStep | null>(null);
	useEffect(() => {
		if (!open || phase === "intro" || !sequence.includes(currentStep)) return;
		if (lastViewed.current === currentStep) return;
		lastViewed.current = currentStep;
		trackOnboardingStepViewed(currentStep);
	}, [open, phase, currentStep, sequence]);

	/*
	 * Focus follows the step: the heading takes it after the hand-off and on
	 * every step change, so a screen reader announces where the user is and Tab
	 * starts from the top of the step. The body re-enters only on a CHANGE after
	 * the hand-off, never when the hand-off itself settles.
	 */
	const headingRef = useRef<HTMLHeadingElement>(null);
	const [animateStep, setAnimateStep] = useState(false);
	const shownStep = useRef(currentStep);
	useEffect(() => {
		if (phase !== "steps") return;
		if (shownStep.current !== currentStep) {
			shownStep.current = currentStep;
			setAnimateStep(true);
		}
		headingRef.current?.focus({ preventScroll: true });
	}, [phase, currentStep]);

	/**
	 * Leave setup and land in the chat. Used by Finish, by "Skip for now" and
	 * by Escape: all of them end setup, and the empty chat's connect card is
	 * what a user who skipped sees next (design section 6), so skipping is never
	 * a trap (UX U9).
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
					t("ui.onboarding.modal.error.aida_open_failed", { name: aidaName }),
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

	const isConnected = useCallback(
		(id: string) => stageConnected(census.find((row) => row.id === id)),
		[census],
	);

	const handleNext = useCallback(async () => {
		const index = sequence.indexOf(currentStep);
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
		trackOnboardingStepCompleted(
			currentStep,
			currentStep === OnboardingStep.CONNECT_PROVIDER
				? connectedProviderId(census, isConnected)
				: currentStep === OnboardingStep.SEARCH
					? searchChoice.current
					: null,
		);
		/*
		 * Leaving the model step is the moment the search latch closes (spec § 1).
		 * The sequence is recomputed HERE rather than read from state, because the
		 * state update would land a render after the step we are choosing.
		 */
		let walk = sequence;
		if (currentStep === OnboardingStep.DEFAULT_MODEL) {
			const latched = !radientOn;
			setIncludeSearch(latched);
			walk = onboardingSequence({ includeSearch: latched, aidaAvailable });
		}
		const at = walk.indexOf(currentStep);
		if (index >= 0 && at >= 0 && at < walk.length - 1) {
			setCurrentStep(walk[at + 1]);
		} else if (aidaAvailable) {
			await meetAida();
		} else {
			finish();
		}
	}, [
		currentStep,
		sequence,
		census,
		isConnected,
		radientOn,
		setCurrentStep,
		finish,
		aidaAvailable,
		meetAida,
	]);

	const handleBack = useCallback(() => {
		const index = sequence.indexOf(currentStep);
		if (index > 0) setCurrentStep(sequence[index - 1]);
	}, [currentStep, sequence, setCurrentStep]);

	const listFormat = useCallback(
		(items: string[]) => {
			try {
				return new Intl.ListFormat(locale, {
					type: "conjunction",
				}).format(items);
			} catch {
				return items.join(", ");
			}
		},
		[locale],
	);

	const radientRow =
		census.find((row) => row.id === RECOMMENDED_PROVIDER_ID) ?? null;

	const stepContent = (() => {
		switch (currentStep) {
			case OnboardingStep.CONNECT_PROVIDER:
				return (
					<ConnectProviderStep
						providers={providers.data}
						isLoading={providers.isLoading}
						isError={providers.isError}
						onRetry={() => void providers.refetch()}
						onContinue={() => void handleNext()}
						listFormat={listFormat}
					/>
				);
			case OnboardingStep.DEFAULT_MODEL:
				return (
					<DefaultModelStep
						onBeforeContinue={registerBeforeContinue}
						onBlockReason={registerStepBlock}
					/>
				);
			case OnboardingStep.SEARCH:
				return (
					<SearchApiStep
						showCredentialDescription={false}
						radient={radientRow}
						radientConnected={radientOn}
						onChoiceChange={onSearchChoice}
					/>
				);
			default:
				return null;
		}
	})();

	/*
	 * The stage's header per step. Sign-in changes with what is connected (spec
	 * § 5.1): "Sign in to get started" until something is, then "You're
	 * connected" with a sentence that says what else is worth adding.
	 */
	const brands = connectedSubscriptionBrands(census);
	const header = (() => {
		switch (currentStep) {
			case OnboardingStep.CONNECT_PROVIDER:
				if (radientOn)
					return {
						title: t("ui.onboarding.signin.title_connected"),
						subtitle: t("ui.onboarding.signin.subtitle_radient_connected"),
					};
				if (connected || brands.length > 0)
					return {
						title: t("ui.onboarding.signin.title_connected"),
						subtitle: t("ui.onboarding.signin.subtitle_connected"),
					};
				return {
					title: t("ui.onboarding.signin.title"),
					subtitle: t("ui.onboarding.signin.subtitle"),
				};
			case OnboardingStep.DEFAULT_MODEL:
				return {
					title: t("ui.onboarding.modal.title.default_model"),
					subtitle: t("ui.onboarding.default_model.intro"),
				};
			case OnboardingStep.SEARCH:
				return {
					title: t("ui.onboarding.modal.title.search"),
					subtitle: t("ui.onboarding.search.intro"),
				};
			case OnboardingStep.MEET:
				return meetAidaCopy(aidaName, aidaOwesHello);
			default:
				return { title: t("ui.onboarding.modal.title.fallback"), subtitle: "" };
		}
	})();

	const isFirst = currentStep === OnboardingStep.CONNECT_PROVIDER;
	const isLast = sequence.indexOf(currentStep) === sequence.length - 1;
	const isMeet = currentStep === OnboardingStep.MEET;

	/*
	 * Footer per step (spec § 2.1):
	 * - step 1: ghost "Skip for now" on the left; primary "Continue" on the right
	 *   once something is connected -- never an enabled Next over nothing;
	 * - later steps: ghost "Back" (the bordered secondary Back read as one more
	 *   card), then the primary;
	 * - the last step: ghost "Skip to chat" (or "Skip" without her) beside the
	 *   primary "Meet <name>" (or "Finish"). The ghost names where it goes
	 *   because "Skip" beside "Meet Aida" reads as skipping her, which it is.
	 */
	const footer = onboardingFooter(currentStep, stepBlock, continuing);
	const footerStart = isFirst ? (
		<Button variant="ghost" size="lg" onClick={finish}>
			{t("ui.onboarding.modal.action.skip_for_now")}
		</Button>
	) : (
		<Button variant="ghost" size="lg" onClick={handleBack}>
			{t("ui.onboarding.modal.action.back")}
		</Button>
	);
	const footerEnd = (
		<>
			{isLast && !isFirst ? (
				<Button variant="ghost" size="lg" onClick={finish} disabled={meeting}>
					{aidaAvailable
						? t("ui.onboarding.modal.action.skip_to_chat")
						: t("ui.onboarding.modal.action.skip")}
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
							? t("ui.onboarding.modal.action.meet", { name: aidaName })
							: t("ui.onboarding.modal.action.finish")
						: t("ui.onboarding.modal.action.continue")}
				</Button>
			) : null}
		</>
	);

	/*
	 * Progress as a track. Segments stay individually clickable back to visited
	 * steps; "Step N of M" is the list's accessible label rather than visible
	 * text - the track says it, and the stage has enough words already.
	 */
	const activeIndex = sequence.indexOf(currentStep);
	const stepIndicators = (
		<div className="flex items-center">
			<span className="sr-only" id="onboarding-step-of">
				{activeIndex >= 0
					? t("ui.onboarding.modal.step_of", {
							current: activeIndex + 1,
							total: sequence.length,
						})
					: t("ui.onboarding.modal.steps_total", { total: sequence.length })}
			</span>
			{/* `list`, not a bare row of buttons: it has a length, and a screen
			    reader saying "4 items" is the same fact the count states. */}
			<ol
				className="flex items-center gap-1"
				aria-labelledby="onboarding-step-of"
			>
				{sequence.map((step, index) => {
					const isActive = currentStep === step;
					const canNavigate = visitedSteps.has(step) && !isActive;
					// Filled up to and including the current step: distance covered.
					const isCovered = index <= activeIndex;
					return (
						<li key={step} className="flex">
							<Tooltip content={resolvedTitles[step]}>
								{/*
								 * A real button, so the track is tabbable and each step's
								 * name is announced. `aria-disabled` rather than `disabled`:
								 * a disabled button swallows pointer events, and the tooltip
								 * is the only place the name is written.
								 */}
								<button
									type="button"
									aria-label={resolvedTitles[step]}
									aria-current={isActive ? "step" : undefined}
									aria-disabled={!canNavigate}
									onClick={() => {
										if (canNavigate) setCurrentStep(step);
									}}
									/* A 24px hit box around a 2px bar. */
									className="flex h-6 w-6 items-center"
								>
									<span
										className={cn(
											"h-0.5 w-full rounded-[2px] transition-colors duration-base ease-out-quart",
											isCovered ? "bg-accent" : "bg-hairline",
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

	return (
		<OnboardingStage
			open={open}
			phase={phase}
			skipped={skipped}
			bookend={isMeet}
			title={header.title}
			subtitle={header.subtitle}
			titleSize={isMeet ? "display" : "title"}
			headingRef={headingRef}
			stepKey={currentStep}
			animateStep={animateStep}
			stepIndicators={stepIndicators}
			footerStart={footerStart}
			footerEnd={footerEnd}
			footerNote={footer.reason}
			onDismiss={finish}
		>
			{stepContent}
		</OnboardingStage>
	);
};
