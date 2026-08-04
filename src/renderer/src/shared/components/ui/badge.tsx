import { cn } from "@shared/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import { type HTMLAttributes, forwardRef } from "react";

/**
 * Badge — a small, static label. Not a control: if it can be clicked or
 * dismissed it is a button or a chip, and it should look like one.
 *
 * Every variant is a `wash` fill with the matching semantic ink, which is the
 * exact triple the contrast contract verifies (`fill` + `border` + `ink`
 * against `canvas` and `surface`). Solid semantic fills are absent on purpose:
 * there is no `onSuccess` role to put on top of one.
 *
 * `shape="pill"` is one of the three places `rounded-full` is allowed.
 */
const badgeVariants = cva(
	[
		"inline-flex w-fit shrink-0 items-center gap-1 border px-2 py-0.5",
		"whitespace-nowrap font-medium text-meta",
		"[&_svg]:pointer-events-none [&_svg]:size-3 [&_svg]:shrink-0",
	],
	{
		variants: {
			variant: {
				neutral: "border-hairline bg-sunken text-ink-muted",
				accent: "border-accent bg-accent-wash text-accent",
				success: "border-success-border bg-success-wash text-success",
				warning: "border-warning-border bg-warning-wash text-warning",
				danger: "border-danger-border bg-danger-wash text-danger",
				info: "border-info-border bg-info-wash text-info",
				outline: "border-control bg-transparent text-ink",
			},
			shape: {
				rounded: "rounded-sm",
				pill: "rounded-full",
			},
		},
		defaultVariants: { variant: "neutral", shape: "rounded" },
	},
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> &
	VariantProps<typeof badgeVariants> & {
		/** Render the single child element instead of a `span`. */
		asChild?: boolean;
	};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
	({ className, variant, shape, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot.Root : "span";
		return (
			<Comp
				ref={ref}
				className={cn(badgeVariants({ variant, shape }), className)}
				{...props}
			/>
		);
	},
);
Badge.displayName = "Badge";

export { badgeVariants };
