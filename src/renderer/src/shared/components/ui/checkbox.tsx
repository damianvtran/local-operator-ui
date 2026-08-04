import { cn } from "@shared/lib/utils";
import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	forwardRef,
} from "react";

/**
 * Checkbox.
 *
 * `border-control` is the whole control when unchecked, so it is the
 * structural role and not `hairline`. `rounded-xs` (2px) rather than a larger
 * step: on a 16px box anything above 2px starts reading as a circle, and a
 * circle means radio.
 *
 * The indeterminate state gets its own glyph. A dash and a tick are different
 * facts — "some of these" is not "all of these" — and a checkbox that shows a
 * tick for both is lying about what will happen on submit.
 */
export const Checkbox = forwardRef<
	ElementRef<typeof CheckboxPrimitive.Root>,
	ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, checked, ...props }, ref) => (
	<CheckboxPrimitive.Root
		ref={ref}
		checked={checked}
		className={cn(
			"inline-flex size-4 shrink-0 items-center justify-center rounded-xs",
			"border border-control bg-surface text-on-accent",
			"transition-colors duration-fast ease-out-quart",
			// `not-data-[disabled]` is load-bearing, not defensive. Tailwind emits
			// `data-[disabled]:*` BEFORE `data-[state=checked]:*`, so without the
			// exclusion a disabled-and-checked box keeps the accent fill and reads
			// as live. Making the two selectors mutually exclusive removes the
			// dependence on emission order entirely.
			"data-[state=checked]:not-data-[disabled]:border-accent data-[state=checked]:not-data-[disabled]:bg-accent",
			"data-[state=indeterminate]:not-data-[disabled]:border-accent data-[state=indeterminate]:not-data-[disabled]:bg-accent",
			"aria-invalid:border-danger",
			"data-[disabled]:border-hairline data-[disabled]:bg-sunken data-[disabled]:text-ink-disabled",
			className,
		)}
		{...props}
	>
		<CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
			{checked === "indeterminate" ? (
				<Minus className="size-3" strokeWidth={3} aria-hidden="true" />
			) : (
				<Check className="size-3" strokeWidth={3} aria-hidden="true" />
			)}
		</CheckboxPrimitive.Indicator>
	</CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
