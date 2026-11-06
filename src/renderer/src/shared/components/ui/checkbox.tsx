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
/** Shared paint contract: used by the ordinary root or the opt-in inner mark. */
const checkboxPaint = [
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
];

type CheckboxProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
	/** Real32px pointer root (44px coarse), retaining the shared16px paint. */
	hitArea?: "default" | "comfortable";
};

export const Checkbox = forwardRef<
	ElementRef<typeof CheckboxPrimitive.Root>,
	CheckboxProps
>(({ className, checked, hitArea = "default", ...props }, ref) => {
	const comfortable = hitArea === "comfortable";
	return (
		<CheckboxPrimitive.Root
			ref={ref}
			checked={checked}
			className={cn(
				/*
				 * Notification selection formerly enlarged the painted root to24px.
				 * Keep ONE semantic/interactive Radix root, but move its unchanged
				 * paint onto the indicator for this opt-in. Empty target space must
				 * activate the same checkbox, not stop clicks in an inert wrapper.
				 * Geometry/outline clipping still require real-render validation.
				 */
				comfortable
					? "inline-flex size-8 shrink-0 items-center justify-center rounded-xs border-0 bg-transparent pointer-coarse:size-11"
					: checkboxPaint,
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				/* forceMount paints the unchecked boundary too; hide only its glyph. */
				forceMount={comfortable || undefined}
				data-checkbox-paint={comfortable ? "" : undefined}
				aria-invalid={comfortable ? props["aria-invalid"] : undefined}
				className={cn(
					"flex items-center justify-center text-current",
					comfortable && checkboxPaint,
					comfortable && "data-[state=unchecked]:[&>svg]:invisible",
				)}
			>
				{/* Keep the brand's14px standard-stroke tick/dash; do not shrink text. */}
				{checked === "indeterminate" ? (
					<Minus className="size-3.5" aria-hidden="true" />
				) : (
					<Check className="size-3.5" aria-hidden="true" />
				)}
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
});
Checkbox.displayName = "Checkbox";
