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
	 * Optional step indicators (e.g., dots)
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
					"max-h-[calc(100vh-4rem)] max-w-165 gap-0 overflow-hidden p-0",
					className,
				)}
			>
				{title && (
					<DialogTitle className="shrink-0 border-hairline border-b px-6 py-4 text-title">
						{title}
					</DialogTitle>
				)}

				{stepIndicators && (
					<div className="shrink-0 px-6 pt-4">{stepIndicators}</div>
				)}

				<div
					ref={contentRef}
					tabIndex={-1}
					className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
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
