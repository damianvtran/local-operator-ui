import { cn } from "@shared/lib/utils";
import { Progress as ProgressPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	forwardRef,
} from "react";

/**
 * Determinate and indeterminate progress.
 *
 * `rounded-xs` on a 4px bar, not `rounded-full`: the pill radius is reserved,
 * and at this height 2px already reads as a rounded end.
 *
 * The indicator transitions its transform. That is inside the motion rule
 * rather than an exception to it — the rule bans transforms as *hover*
 * feedback, and this transform is the datum. A bar that teleports between
 * values cannot be read as progress at all.
 *
 * Passing `value={null}` gives the indeterminate state: Radix reports
 * `data-state="indeterminate"` to assistive tech, and the bar pulses instead
 * of claiming a position it does not know.
 */
export type ProgressProps = ComponentPropsWithoutRef<
	typeof ProgressPrimitive.Root
> & {
	/** Applied to the filled bar, which is otherwise unreachable from outside. */
	indicatorClassName?: string;
};

export const Progress = forwardRef<
	ElementRef<typeof ProgressPrimitive.Root>,
	ProgressProps
>(({ className, value, max = 100, indicatorClassName, ...props }, ref) => {
	const indeterminate = value === null || value === undefined;
	const pct = indeterminate
		? 100
		: Math.min(100, Math.max(0, (value / max) * 100));

	return (
		<ProgressPrimitive.Root
			ref={ref}
			value={value}
			max={max}
			className={cn(
				"relative h-1 w-full overflow-hidden rounded-xs bg-sunken",
				className,
			)}
			{...props}
		>
			<ProgressPrimitive.Indicator
				className={cn(
					"size-full flex-1 bg-accent transition-transform duration-base ease-out-quart",
					indeterminate && "animate-pulse",
					indicatorClassName,
				)}
				style={{ transform: `translateX(-${100 - pct}%)` }}
			/>
		</ProgressPrimitive.Root>
	);
});
Progress.displayName = "Progress";
