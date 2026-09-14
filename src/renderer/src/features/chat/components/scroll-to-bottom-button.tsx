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
				className="pointer-events-auto rounded-full shadow-overlay"
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
