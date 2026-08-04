import { cn } from "@shared/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import { type ButtonHTMLAttributes, forwardRef } from "react";

/**
 * The button.
 *
 * ## Why the `cva` variant order is `size` then `variant`
 *
 * `cva` emits variant groups in declaration order, and `cn` resolves conflicts
 * last-one-wins. `link` has to neutralise the box its size gave it (`h-auto`,
 * `p-0`), so `variant` must be emitted after `size` or a link would render as
 * a 32px-tall padded box. Nothing else overlaps: sizes own the box, variants
 * own the colour.
 *
 * ## Why `danger` is not a solid red fill
 *
 * The palette contract has no `onDanger` role, so a solid danger fill would
 * have to guess its own ink — which is the failure mode this port exists to
 * remove, since MUI's `augmentColor` guessed it twelve different ways. The
 * `danger` / `dangerWash` / `dangerBorder` triple is the shape the contrast
 * contract actually verifies, so destructive reads as a red-bordered control
 * that fills with the danger wash rather than as a red slab.
 *
 * ## Focus
 *
 * Not declared here. `styles/index.css` gives every `:focus-visible` element a
 * 2px accent outline at 2px offset; a per-component ring would be a second
 * source of truth for the same pixel.
 */
const buttonVariants = cva(
	[
		"inline-flex shrink-0 select-none items-center justify-center",
		"whitespace-nowrap font-medium",
		// Colour-only transition. Hover is a colour step: nothing lifts, scales
		// or translates.
		"transition-colors duration-fast ease-out-quart",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0",
	],
	{
		variants: {
			size: {
				sm: "h-7 gap-1.5 rounded-sm px-2.5 text-meta [&_svg]:size-3.5",
				md: "h-8 gap-2 rounded-md px-3 text-body-sm [&_svg]:size-4",
				lg: "h-9.5 gap-2 rounded-md px-4 text-body [&_svg]:size-4",
				icon: "size-8 rounded-md [&_svg]:size-4",
				"icon-sm": "size-7 rounded-sm [&_svg]:size-3.5",
				"icon-lg": "size-9.5 rounded-md [&_svg]:size-5",
			},
			variant: {
				primary: [
					"bg-accent text-on-accent",
					"hover:bg-accent-hover active:bg-accent-active",
					"disabled:bg-sunken disabled:text-ink-disabled",
				],
				secondary: [
					"border border-control bg-surface text-ink",
					"hover:bg-elevated",
					"disabled:border-hairline disabled:bg-sunken disabled:text-ink-disabled",
				],
				outline: [
					"border border-control text-ink",
					"hover:bg-accent-wash",
					"disabled:border-hairline disabled:bg-transparent disabled:text-ink-disabled",
				],
				ghost: [
					"text-ink-muted",
					"hover:bg-accent-wash hover:text-ink",
					"disabled:bg-transparent disabled:text-ink-disabled",
				],
				danger: [
					"border border-danger-border text-danger",
					"hover:bg-danger-wash",
					"disabled:border-hairline disabled:bg-transparent disabled:text-ink-disabled",
				],
				link: [
					"h-auto rounded-xs p-0 text-accent underline-offset-4",
					"hover:text-accent-hover hover:underline",
					"disabled:text-ink-disabled disabled:no-underline",
				],
			},
		},
		defaultVariants: { variant: "secondary", size: "md" },
	},
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
	VariantProps<typeof buttonVariants> & {
		/**
		 * Render the single child element instead of a `button`, keeping every
		 * class and handler. This is how a button becomes a router `Link` or an
		 * anchor without a second styling path existing for the same look.
		 */
		asChild?: boolean;
	};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, type, ...props }, ref) => {
		// Branched rather than aliased to one `Comp` because the two elements do
		// not take the same props: `type` is meaningful on a button and invalid
		// on the anchor or Link that `asChild` usually renders.
		if (asChild) {
			return (
				<Slot.Root
					ref={ref}
					className={cn(buttonVariants({ variant, size }), className)}
					{...props}
				/>
			);
		}

		return (
			<button
				ref={ref}
				// Default to `button`. An untyped button inside a form submits it,
				// and that only shows up on the one screen that has a form.
				type={type ?? "button"}
				className={cn(buttonVariants({ variant, size }), className)}
				{...props}
			/>
		);
	},
);
Button.displayName = "Button";

export { buttonVariants };
