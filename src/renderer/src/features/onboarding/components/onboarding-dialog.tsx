/**
 * OnboardingDialog Component
 *
 * The frame every onboarding step renders inside: a title, an optional step
 * indicator row, the step itself, and the actions.
 *
 * It is deliberately plain. This is the first screen a new user sees, so the
 * only things drawing attention are the words and the primary action — the
 * panel is one ground step above the scrim with the system's single overlay
 * shadow, and the two hairlines that remain are the ones separating the fixed
 * header and footer from content that scrolls under them.
 */

import { Dialog, DialogContent, DialogTitle } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { type ReactNode, useRef } from "react";

/**
 * Props for the OnboardingDialog component
 */
export type OnboardingDialogProps = {
	/**
	 * Whether the dialog is open
	 */
	open: boolean;
	/**
	 * Dialog title content (can be string or JSX)
	 */
	title?: ReactNode;
	/**
	 * Progress for the current flow, rendered on the title's row at its right
	 * edge. Omitted on the steps that come before the numbered flow.
	 */
	stepIndicators?: ReactNode;
	/**
	 * Dialog main content
	 */
	children: ReactNode;
	/**
	 * Dialog action buttons (e.g., next, back)
	 */
	actions?: ReactNode;
	/**
	 * Extra classes for the dialog panel
	 */
	className?: string;
};

/**
 * OnboardingDialog component
 *
 * @param props - OnboardingDialogProps
 * @returns ReactNode
 */
export const OnboardingDialog = ({
	open,
	title,
	stepIndicators,
	children,
	actions,
	className,
}: OnboardingDialogProps): ReactNode => {
	const contentRef = useRef<HTMLDivElement>(null);

	return (
		/*
		 * Not dismissable, and it takes three separate refusals to say so:
		 * `onOpenChange` ignores every close request, and escape and
		 * outside-pointer are cancelled so Radix does not animate a close that
		 * will not happen. Setup has to finish or be skipped step by step —
		 * there is no partial state the app can start in.
		 */
		<Dialog open={open}>
			<DialogContent
				showClose={false}
				onEscapeKeyDown={(event) => event.preventDefault()}
				onPointerDownOutside={(event) => event.preventDefault()}
				onInteractOutside={(event) => event.preventDefault()}
				/*
				 * Focus starts on the step itself, not on whatever happens to be the
				 * first focusable thing in it. Radix's default reached the step
				 * indicator dots, which opened one of their tooltips the instant the
				 * dialog appeared. The step body is focusable only programmatically,
				 * so this also gives the arrow keys something to scroll.
				 */
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					contentRef.current?.focus();
				}}
				className={cn(
					/*
					 * 560px, down from 660. The choice step was the only one that
					 * wanted the width; every other step is a two-field form, and a
					 * 612px-wide box for "Your name" is a web signup page rather than
					 * a desktop setup dialog. Raycast, Cron and Things all run first
					 * run at roughly this measure — wide enough for a sentence of
					 * explanation, narrow enough that one decision fills the frame.
					 */
					"max-h-[calc(100vh-4rem)] max-w-140 gap-0 overflow-hidden p-0",
					className,
				)}
			>
				{/*
				 * Title and progress share one row. They were two stacked bands, so
				 * the eye crossed a title, a rule, a row of dots and then finally
				 * the step — three horizontal divisions before any content. The
				 * progress belongs beside the title because it qualifies it.
				 */}
				{(title || stepIndicators) && (
					<div className="flex shrink-0 items-center justify-between gap-4 border-hairline border-b px-6 py-4">
						{title ? (
							<DialogTitle className="text-title">{title}</DialogTitle>
						) : (
							<DialogTitle className="sr-only">Setup</DialogTitle>
						)}
						{stepIndicators}
					</div>
				)}

				{/*
				 * `outline-none!` because this element is focused programmatically on
				 * open, and Chrome counts a scripted `.focus()` as focus-visible when
				 * the last input was not a pointer — so the app's accent ring was
				 * drawn around the whole scrolling body of the dialog, appearing as a
				 * 2px green line directly under the title on the first frame a new
				 * user ever sees. It is a scroll container, not a control; the ring
				 * marks nothing actionable.
				 *
				 * The `!` is required rather than tidy: the ring is re-asserted by an
				 * unlayered `html :focus-visible` rule injected by the MUI baseline,
				 * which outranks every Tailwind utility regardless of specificity.
				 * See docs/branding.md § 8, "MUI wins specificity fights".
				 */}
				<div
					ref={contentRef}
					tabIndex={-1}
					className="min-h-0 flex-1 overflow-y-auto px-6 py-6 outline-none!"
				>
					{children}
				</div>

				{actions && (
					<div className="shrink-0 border-hairline border-t px-6 py-4">
						{actions}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
};
