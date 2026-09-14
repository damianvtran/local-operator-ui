import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { ArrowDown } from "lucide-react";
import { useCallback } from "react";
import type { FC } from "react";

/**
 * Props for the ScrollToBottomButton component
 */
type ScrollToBottomButtonProps = {
	/**
	 * Whether the button should be visible
	 */
	visible: boolean;

	/**
	 * Callback function to scroll to the bottom
	 */
	onClick: () => void;

	/**
	 * Optional className for additional styling
	 */
	className?: string;

	bottomDistance?: number;

	/**
	 * True when messages arrived while the reader was scrolled up. The
	 * button grows a label so the reader learns there is something new
	 * without the transcript moving under them.
	 */
	hasNewActivity?: boolean;
};

/**
 * ScrollToBottomButton Component
 *
 * A minimal floating button that appears when the user scrolls up in chat.
 *
 * The button is positioned absolutely within its container, allowing it to
 * move with the container rather than being fixed on the screen.
 */
export const ScrollToBottomButton: FC<ScrollToBottomButtonProps> = ({
	visible,
	onClick,
	className,
	bottomDistance = 160,
	hasNewActivity = false,
}) => {
	const handleClick = useCallback(() => {
		onClick();
	}, [onClick]);

	return (
		<div
			className={cn(
				"pointer-events-none absolute inset-x-0 z-40 flex items-center justify-center",
				"transition-opacity duration-base ease-out-quart",
				visible ? "opacity-100" : "opacity-0",
				className,
			)}
			style={{ bottom: bottomDistance }}
			aria-hidden={!visible}
		>
			<Button
				variant="secondary"
				size={hasNewActivity ? "sm" : "icon"}
				className={cn(
					"rounded-full shadow-overlay",
					/*
					 * Pointer events follow VISIBILITY here, not the wrapper.
					 *
					 * The wrapper above disables them (`pointer-events-none`) and this button
					 * re-enabled them unconditionally, which is the right thing for the visible
					 * state and a trap for the invisible one: hit-testing ignores opacity, so
					 * hidden the button was a real 32x32 target sitting somewhere over the
					 * transcript. Where it sat was wherever `bottomDistance` put it, and in this
					 * component's own use that band is the composer: at the column floor the
					 * composer's status row lands on it, and `elementFromPoint` at the goal
					 * chip's centre answered "Scroll to bottom" - pressing the chip there did
					 * nothing at all, in the width this row was designed for (QA round 1, Q1;
					 * the same hidden button also covered part of the expanded goal body at
					 * the wide column).
					 *
					 * `invisible` on the wrapper was the other candidate and is rejected: the
					 * wrapper fades out (`transition-opacity`), and `visibility: hidden` takes
					 * effect immediately, so the fade would be replaced by a pop. The pointer
					 * switch is the half that matters: seconds after the state changes, the
					 * fading control is not something the user is aiming at.
					 */
					visible ? "pointer-events-auto" : "pointer-events-none",
				)}
				aria-label={
					hasNewActivity ? "New activity, scroll to bottom" : "Scroll to bottom"
				}
				onClick={handleClick}
				tabIndex={visible ? 0 : -1}
			>
				<ArrowDown aria-hidden="true" />
				{hasNewActivity ? "New activity" : null}
			</Button>
		</div>
	);
};
