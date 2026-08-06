import { cn } from "@shared/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { type InputHTMLAttributes, forwardRef } from "react";

/**
 * Single-line text input.
 *
 * `border-control` is the sole boundary. That is the structural line role —
 * the one with a 3:1 floor on all four grounds — and an input's border is the
 * only thing telling a user where the field starts, so it is not decorative
 * and must not be `hairline`. The previous light theme bounded every input at
 * 1.25:1, which is the defect that made `borderControl` a required role.
 *
 * Invalid state keys off `aria-invalid`, so the thing that turns the border
 * red is the same thing that tells a screen reader the field is wrong. There
 * is no `error` prop, because a prop can be set without the ARIA and then the
 * field is red for sighted users only.
 *
 * Heights and radius track `Button` exactly — 28 / 32 / 36 at 6px corners.
 * A form is read as one row of controls, and the fastest way to make a
 * settings screen look unfinished is to let a field and the button beside it
 * disagree about their own height. See the size-ramp and radius notes in
 * `button.tsx`; this is the other half of the same decision.
 */
const inputVariants = cva(
	[
		"w-full rounded-sm border border-control bg-surface text-ink",
		"placeholder:text-ink-dim",
		"transition-colors duration-fast ease-out-quart",
		"aria-invalid:border-danger",
		// Disabled is a colour change, never opacity: an opacity fade would take
		// the field's own background with it and land on a different colour over
		// `surface` than over `sunken`.
		"disabled:border-hairline disabled:bg-sunken disabled:text-ink-disabled",
		"disabled:placeholder:text-ink-disabled",
		"file:border-0 file:bg-transparent file:font-medium file:text-ink",
	],
	{
		variants: {
			// Named `inputSize` and not `size`: `size` is a real numeric HTML
			// attribute on `input`, and shadowing it would silently drop it.
			inputSize: {
				sm: "h-7 px-2 text-meta focus-visible:outline-offset-1!",
				md: "h-8 px-3 text-body-sm",
				lg: "h-9 px-3 text-body",
			},
		},
		defaultVariants: { inputSize: "md" },
	},
);

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> &
	VariantProps<typeof inputVariants>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
	({ className, inputSize, type = "text", ...props }, ref) => (
		<input
			ref={ref}
			type={type}
			className={cn(inputVariants({ inputSize }), className)}
			{...props}
		/>
	),
);
Input.displayName = "Input";

export { inputVariants };
