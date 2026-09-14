import { cn } from "@shared/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { type HTMLAttributes, forwardRef } from "react";

/**
 * Card — a panel that groups related content.
 *
 * ## Why there is a `plain` variant
 *
 * The default draws a `hairline` edge as well as taking the `surface` step,
 * because the grounds are only guaranteed to be 1.03:1 apart and that is a
 * depth cue, not a boundary. But a grid of eight bordered cards is eight
 * boxes' worth of chrome, and the fix for a busy panel is almost always
 * removing a border rather than tightening the spacing. `plain` is the
 * borderless card for those grids; `outline` is the unfilled one for a card
 * sitting directly on `surface`, where a second `surface` fill says nothing.
 *
 * No hover state and no shadow. A card is not a control, and it has not left
 * the flow. Make the thing inside it the affordance.
 */
const cardVariants = cva("flex flex-col rounded-lg", {
	variants: {
		variant: {
			surface: "border border-hairline bg-surface",
			plain: "bg-surface",
			outline: "border border-hairline",
		},
		padding: {
			none: "",
			sm: "gap-3 p-3",
			md: "gap-4 p-4",
			lg: "gap-4 p-6",
		},
	},
	defaultVariants: { variant: "surface", padding: "md" },
});

export type CardProps = HTMLAttributes<HTMLDivElement> &
	VariantProps<typeof cardVariants>;

export const Card = forwardRef<HTMLDivElement, CardProps>(
	({ className, variant, padding, ...props }, ref) => (
		<div
			ref={ref}
			className={cn(cardVariants({ variant, padding }), className)}
			{...props}
		/>
	),
);
Card.displayName = "Card";

export const CardHeader = forwardRef<
	HTMLDivElement,
	HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div ref={ref} className={cn("flex flex-col gap-1", className)} {...props} />
));
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<
	HTMLHeadingElement,
	HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
	<h3 ref={ref} className={cn("text-heading text-ink", className)} {...props} />
));
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<
	HTMLParagraphElement,
	HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
	<p
		ref={ref}
		className={cn("text-body-sm text-ink-muted", className)}
		{...props}
	/>
));
CardDescription.displayName = "CardDescription";

export const CardContent = forwardRef<
	HTMLDivElement,
	HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn("text-body-sm text-ink", className)}
		{...props}
	/>
));
CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<
	HTMLDivElement,
	HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn("flex items-center gap-2", className)}
		{...props}
	/>
));
CardFooter.displayName = "CardFooter";

export { cardVariants };
