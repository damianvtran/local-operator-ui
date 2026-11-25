/**
 * OnboardingStage
 *
 * The frame first-run setup renders in: the WHOLE WINDOW, from the intro to the
 * last step (onboarding refresh, 2026-11; design spec § 2).
 *
 * ## Why a stage and not a dialog
 *
 * Setup used to be a 640px panel over a black scrim, which framed it as a
 * settings form - the operator's words were "flat and unexciting", with "too
 * much use of rounded cards". A stage lets the new-chat helix (the brand's own
 * motif, already shipping behind the composer) open setup and then carry on as
 * the header of every step, so the first screen a user sees and the first chat
 * they land in share one visual language.
 *
 * ## What it keeps from the dialog
 *
 * The Radix `Dialog`, in its `stage` variant: the focus trap, `aria-modal`,
 * Escape and the title wiring all still come from it. It is NOT a floating
 * surface (no `data-lo-floating`, no shadow, no plate), and it is opaque even
 * with Window glass on, because there is no app content behind setup yet.
 *
 * ## Layout (spec § 2.1)
 *
 * A 32px drag band (macOS traffic lights sit over it, so nothing interactive
 * goes there), the persistent horizon slot, the step's title and subtitle, ONE
 * scrolling 30rem column, and a pinned footer. The column is top-anchored, so
 * the horizon never moves when a step's content height changes.
 *
 * `data-onboarding-modal` stays on the content: the renderer driver's state
 * probe (`src/renderer/src/dev-driver/install.ts`) answers "is the first-run
 * wizard up?" by looking for it.
 */

import "../onboarding-stage.css";
import {
	BackendStartupPanel,
	startupPanelPhase,
} from "@shared/components/common/backend-startup-panel";
import { NewChatHorizon } from "@shared/components/composer/new-chat-horizon";
import { Dialog, DialogContent, DialogTitle } from "@shared/components/ui";
import { useServerHealth } from "@shared/hooks/use-connectivity-status";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { type ReactNode, type RefObject, forwardRef, useRef } from "react";
import type { StagePhase } from "./onboarding-intro";
import { ONBOARDING_COLUMN_WIDTH } from "./onboarding-layout";

/**
 * The stage's h1: the dialog's accessible title, at the step's size.
 *
 * THE SIZE GOES THROUGH `DialogTitle`'s OWN `className`, never the `asChild`
 * child's (design round 1, D2). Radix's `Slot` CONCATENATES the two class lists,
 * so `text-heading` (the primitive's default) and `text-display` both landed on
 * the h1 and the stylesheet's order picked `text-heading`: the Meet Aida bookend
 * rendered at 16px. `DialogTitle` merges its className through `cn`, whose
 * tailwind-merge knows the type ramp, so the size asked for here is the only one
 * left.
 */
export const StageTitle = forwardRef<
	HTMLHeadingElement,
	{ size: "title" | "display"; children: ReactNode }
>(({ size, children }, ref) => (
	<DialogTitle
		asChild
		className={cn(
			"font-medium text-ink outline-none!",
			size === "display" ? "text-display" : "text-title",
		)}
	>
		<h1 ref={ref} tabIndex={-1}>
			{children}
		</h1>
	</DialogTitle>
));
StageTitle.displayName = "StageTitle";

export type OnboardingStageProps = {
	open: boolean;
	/** Where the intro timeline is (`useStageIntro`). */
	phase: StagePhase;
	/** Whether the intro was skipped, which compresses the hand-off. */
	skipped?: boolean;
	/**
	 * The Meet Aida bookend: the helix returns to full strength and the mark to
	 * its intro size, the visual echo of the opening (spec § 4.2, Meet Aida).
	 */
	bookend?: boolean;
	/** The step's title; also the dialog's accessible name. */
	title: ReactNode;
	/** One or two lines under the title. */
	subtitle?: ReactNode;
	/** `display` for the bookend's larger heading. */
	titleSize?: "title" | "display";
	/** Focused after the hand-off and on each step change, so it is announced. */
	headingRef?: RefObject<HTMLHeadingElement>;
	/** Bumped on step change: the body re-enters (only after the hand-off). */
	stepKey: string;
	/** Whether the body should play its step-change entrance. */
	animateStep?: boolean;
	/** The progress track, centred in the footer. */
	stepIndicators?: ReactNode;
	/** The step body. Omitted on the bookend, which has none. */
	children?: ReactNode;
	/** Footer start slot (Skip / Back). */
	footerStart?: ReactNode;
	/** Footer end slot (primary, and the last step's ghost). */
	footerEnd?: ReactNode;
	/** A sentence above the footer when the step refuses to advance. */
	footerNote?: ReactNode;
	/** Escape: ends setup (as before; the close button is gone). */
	onDismiss?: () => void;
};

/**
 * The app's start-up band, inside the stage (UX round 1, U3). The shell's copy
 * sits behind the modal, inert; drawn here too, Restart stays reachable when
 * the server dies while setup is open.
 */
const OnboardingStartupBand = () => {
	const { data } = useServerHealth();
	const snapshot = data?.snapshot ?? null;
	if (!snapshot || !startupPanelPhase(snapshot)) return null;
	return <BackendStartupPanel snapshot={snapshot} />;
};

export const OnboardingStage = ({
	open,
	phase,
	skipped = false,
	bookend = false,
	title,
	subtitle,
	titleSize = "title",
	headingRef,
	stepKey,
	animateStep = false,
	stepIndicators,
	children,
	footerStart,
	footerEnd,
	footerNote,
	onDismiss,
}: OnboardingStageProps): ReactNode => {
	const rootRef = useRef<HTMLDivElement>(null);
	const intro = phase === "intro";

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onDismiss?.();
			}}
		>
			<DialogContent
				ref={rootRef}
				variant="stage"
				data-onboarding-modal=""
				data-lo-onboarding-stage=""
				data-phase={phase}
				data-skipped={skipped ? "" : undefined}
				data-bookend={bookend ? "" : undefined}
				showClose={false}
				/* No scrim: the stage is opaque and covers the window itself. */
				overlayClassName="bg-transparent"
				tabIndex={-1}
				onEscapeKeyDown={(event) => {
					// During the intro a key SKIPS it (see `useStageIntro`); Escape
					// must not also end setup on the same press.
					if (!onDismiss || intro) event.preventDefault();
				}}
				/* There is no "outside" any more; keep refusing it regardless. */
				onPointerDownOutside={(event) => event.preventDefault()}
				onInteractOutside={(event) => event.preventDefault()}
				/*
				 * Focus starts on the stage itself, never on the first focusable: a
				 * focus ring flashing on arrival breaks the opening, and Enter on an
				 * autofocused "Continue with Radient" would open a browser blind. The
				 * heading takes focus once the steps are showing (the modal).
				 */
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					rootRef.current?.focus();
				}}
				/* `outline-none!`: a scripted focus counts as focus-visible after a
				   key press, and the ring would frame the whole window. The `!` beats
				   the MUI baseline's unlayered rule (docs/branding.md § 8). */
				className="outline-none!"
			>
				<div className="onboarding-stage__atmosphere" aria-hidden="true" />
				{/*
				 * The drag band. Empty on purpose: a control inside a drag region
				 * is swallowed as a window drag. No `onContextMenu` either - the system
				 * menu on right-click is what a frameless window needs there.
				 */}
				<div
					data-titlebar-drag=""
					aria-hidden="true"
					className="absolute inset-x-0 top-0 h-8"
				/>

				<div className="onboarding-stage__horizon">
					<NewChatHorizon
						quiet={false}
						dimmed={!intro && !bookend}
						suppressed={false}
						paperSelector="[data-lo-onboarding-stage]"
					/>
				</div>

				{/* The intro's words: decorative timing aside, the welcome is real
				    text and is read once, then hidden with the rest of the intro. */}
				<div className="onboarding-stage__intro" aria-hidden={!intro}>
					<p className="onboarding-stage__intro-title text-display text-ink">
						{t("ui.onboarding.intro.title")}
					</p>
					<p className="onboarding-stage__intro-sub text-body text-ink-muted">
						{t("ui.onboarding.intro.subtitle")}
					</p>
				</div>
				<p
					className="onboarding-stage__intro-hint text-ink-dim text-meta"
					aria-hidden="true"
				>
					{t("ui.onboarding.intro.skip_hint")}
				</p>

				<div
					className="onboarding-stage__steps flex min-h-0 flex-1 flex-col"
					aria-hidden={intro ? true : undefined}
				>
					{/* Clear of the drag band, the horizon slot and a 24px gap. */}
					<div
						className="shrink-0"
						style={{ height: "calc(var(--stage-rest-top) + 40px + 24px)" }}
					/>
					<OnboardingStartupBand />
					<header
						data-stage-enter="header"
						className="flex shrink-0 flex-col items-center gap-2 px-8 text-center"
						key={`header-${stepKey}`}
						data-stage-step-enter={animateStep ? "" : undefined}
					>
						<StageTitle ref={headingRef} size={titleSize}>
							{title}
						</StageTitle>
						{subtitle ? (
							<p className="line-clamp-3 max-w-[34rem] text-body text-ink-muted">
								{subtitle}
							</p>
						) : null}
					</header>
					{/*
					 * The ONE scroll container. Top-anchored; edge cues mark content
					 * past either edge. Short windows (800x600) scroll here while the
					 * footer, and so the primary action, stays pinned.
					 */}
					<div
						className="mt-8 min-h-0 flex-1 overflow-y-auto px-8 pb-6"
						data-lo-pane-edge-cues=""
					>
						{children ? (
							<div
								key={`body-${stepKey}`}
								data-stage-enter="body"
								data-stage-step-enter={animateStep ? "" : undefined}
								className={cn("mx-auto", ONBOARDING_COLUMN_WIDTH)}
							>
								{children}
							</div>
						) : null}
					</div>
					<footer
						data-stage-enter="footer"
						className="flex shrink-0 flex-col gap-2 px-6 pb-4"
					>
						{footerNote ? (
							<p className="text-center text-ink-dim text-meta">{footerNote}</p>
						) : null}
						{/* Three columns so the track is centred whatever the two
						    sides hold; the end slot reserves 104px so Continue
						    appearing on step 1 does not shift the track. */}
						<div className="grid min-h-14 grid-cols-[1fr_auto_1fr] items-center gap-3">
							<div className="flex justify-start">{footerStart}</div>
							<div className="flex justify-center">{stepIndicators}</div>
							<div className="flex min-w-[104px] flex-wrap items-center justify-end gap-2">
								{footerEnd}
							</div>
						</div>
					</footer>
				</div>
			</DialogContent>
		</Dialog>
	);
};
