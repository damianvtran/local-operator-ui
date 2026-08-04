import { cn } from "@shared/lib/utils";
import { Switch as SwitchPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	forwardRef,
} from "react";

/**
 * Switch.
 *
 * ## The two rules this bends, and why
 *
 * **`rounded-full`.** The radius ramp allows it on avatars, status dots and
 * pill badges. A switch is added here deliberately: the thumb is a status dot
 * by any other name, and squaring the track turns the control into something
 * that reads as a checkbox — which is a different promise, because a checkbox
 * is a form value and a switch takes effect immediately.
 *
 * **`transition-transform` on the thumb.** The motion rule bans transforms as
 * hover feedback. The thumb travelling is not feedback about the pointer, it
 * is the state change itself, and a switch that teleports gives the user no
 * way to see which way it went.
 *
 * The unchecked track carries a real `border-control` edge rather than relying
 * on `sunken` against the ground: `sunken` clears the grounds' 1.03:1
 * distinguishability floor, which is enough to read as depth and nowhere near
 * enough to be the sole boundary of a control.
 */
export const Switch = forwardRef<
	ElementRef<typeof SwitchPrimitive.Root>,
	ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
	<SwitchPrimitive.Root
		ref={ref}
		className={cn(
			"inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-control bg-sunken",
			"transition-colors duration-fast ease-out-quart",
			// See `checkbox.tsx`: Tailwind emits `data-[disabled]:*` before
			// `data-[state=checked]:*`, so the disabled fill has to be reached by a
			// mutually exclusive selector rather than by relying on order.
			"data-[state=checked]:not-data-[disabled]:border-accent data-[state=checked]:not-data-[disabled]:bg-accent",
			"data-[disabled]:border-hairline data-[disabled]:bg-sunken",
			className,
		)}
		{...props}
	>
		<SwitchPrimitive.Thumb
			className={cn(
				"pointer-events-none block size-4 rounded-full bg-ink-muted",
				"transition-transform duration-fast ease-out-quart",
				// The thumb still travels when disabled — its position is the value,
				// not a hover affordance — but it takes the disabled ink.
				"data-[state=checked]:translate-x-4",
				"data-[state=checked]:not-data-[disabled]:bg-on-accent",
				"data-[disabled]:bg-ink-disabled",
			)}
		/>
	</SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
