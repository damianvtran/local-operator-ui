import { cn } from "@shared/lib/utils";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	forwardRef,
} from "react";

/**
 * Radio group: one choice out of a list, with roving focus.
 *
 * WHY A WRAPPER EXISTS NOW. The notification-sound list is the first surface
 * that needs a single-choice list whose arrow keys move AND select (the macOS
 * alert-list model, settings spec §3.4). Radix ships that behaviour; this file
 * gives it the house paint, as `checkbox.tsx` does for its sibling.
 *
 * THE MARK, and why each colour is the one it is (measured over all 59
 * palettes, settings spec §9):
 *
 *  - At rest the ring is `border-control`, the sole boundary of the control
 *    (3.13:1 worst on `canvas`, rosePineDawn).
 *  - On a HOVERED ROW the ring must step to `border-ink-muted`:
 *    `border-control` on `row-hover` falls under 3:1 in 5 palettes
 *    (catppuccinMocha 2.92). The row owns the hover, so the caller passes the
 *    hover step (`group-hover/row:border-ink-muted`) through `className`; the
 *    primitive cannot know which ancestor is the row.
 *  - Checked: `border-accent` with an 8px `bg-accent` dot (4.49:1 worst on
 *    `row-hover`, tokyoNight; non-text floor 3:1).
 *
 * `rounded-full` is the status-dot exception the Switch thumb takes: a squared
 * radio reads as a checkbox. Disabled is a colour step, never opacity
 * (docs/branding.md § 6).
 */
export const RadioGroup = forwardRef<
	ElementRef<typeof RadioGroupPrimitive.Root>,
	ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
	<RadioGroupPrimitive.Root
		ref={ref}
		className={cn("flex flex-col", className)}
		{...props}
	/>
));
RadioGroup.displayName = "RadioGroup";

export const RadioGroupItem = forwardRef<
	ElementRef<typeof RadioGroupPrimitive.Item>,
	ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
	<RadioGroupPrimitive.Item
		ref={ref}
		className={cn(
			"inline-flex size-4 shrink-0 items-center justify-center rounded-full",
			"border border-control bg-transparent",
			"transition-colors duration-fast ease-out-quart",
			// `not-data-[disabled]` for the reason `checkbox.tsx` records: Tailwind
			// emits `data-[disabled]:*` before `data-[state=checked]:*`.
			"data-[state=checked]:not-data-[disabled]:border-accent",
			"data-[disabled]:border-hairline data-[disabled]:bg-sunken",
			className,
		)}
		{...props}
	>
		<RadioGroupPrimitive.Indicator className="flex items-center justify-center">
			<span
				aria-hidden="true"
				className="size-2 rounded-full bg-accent in-data-[disabled]:bg-ink-disabled"
			/>
		</RadioGroupPrimitive.Indicator>
	</RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = "RadioGroupItem";
