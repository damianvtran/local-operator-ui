import { cn } from "@shared/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { X } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	type HTMLAttributes,
	forwardRef,
} from "react";
import { Button } from "./button";

/**
 * Sheet, the edge drawer.
 *
 * Built on Radix Dialog rather than a second modal implementation: a drawer is
 * a dialog that enters from an edge, and having two focus traps and two scrim
 * behaviours in one app is how they drift apart.
 *
 * It does not slide, which was the original intent and turned out to be
 * unsafe. The reasoning is on the `sheetVariants` base below and in full at
 * the top of `tooltip.tsx`.
 *
 * No border on the outer edges: the panel meets the window frame there, and a
 * line drawn against the window edge is chrome with nothing on the far side.
 */

const sheetVariants = cva(
	[
		"fixed z-50 flex flex-col gap-4 bg-elevated p-6 shadow-overlay",
		// No slide-in. See the note at the top of `tooltip.tsx`: a play-pending
		// keyframe animation renders its `from` state, and a drawer's `from` is
		// off-screen, so the failure mode here is a drawer the user opened and
		// cannot see. The edge the panel is attached to already says which side
		// it came from, permanently, without depending on a frame being painted.
	],
	{
		variants: {
			side: {
				top: "inset-x-0 top-0 border-hairline border-b",
				bottom: "inset-x-0 bottom-0 border-hairline border-t",
				left: "inset-y-0 left-0 h-full w-3/4 max-w-sm border-hairline border-r",
				right:
					"inset-y-0 right-0 h-full w-3/4 max-w-sm border-hairline border-l",
			},
		},
		defaultVariants: { side: "right" },
	},
);

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetPortal = SheetPrimitive.Portal;

export const SheetOverlay = forwardRef<
	ElementRef<typeof SheetPrimitive.Overlay>,
	ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Overlay
		ref={ref}
		className={cn(
			// No entrance animation; see the note at the top of `tooltip.tsx`.
			"fixed inset-0 z-50 bg-scrim",
			className,
		)}
		{...props}
	/>
));
SheetOverlay.displayName = "SheetOverlay";

export type SheetContentProps = ComponentPropsWithoutRef<
	typeof SheetPrimitive.Content
> &
	VariantProps<typeof sheetVariants> & {
		/** Show the corner close button. */
		showClose?: boolean;
	};

export const SheetContent = forwardRef<
	ElementRef<typeof SheetPrimitive.Content>,
	SheetContentProps
>(
	(
		{ className, children, side = "right", showClose = true, ...props },
		ref,
	) => (
		<SheetPortal>
			<SheetOverlay />
			<SheetPrimitive.Content
				ref={ref}
				className={cn(sheetVariants({ side }), className)}
				{...props}
			>
				{children}
				{showClose ? (
					<SheetPrimitive.Close asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							className="absolute top-4 right-4"
							aria-label="Close"
						>
							<X aria-hidden="true" />
						</Button>
					</SheetPrimitive.Close>
				) : null}
			</SheetPrimitive.Content>
		</SheetPortal>
	),
);
SheetContent.displayName = "SheetContent";

export const SheetHeader = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex flex-col gap-1.5 pr-8", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

export const SheetFooter = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"mt-auto flex flex-col gap-2 sm:flex-row sm:justify-end",
			className,
		)}
		{...props}
	/>
);
SheetFooter.displayName = "SheetFooter";

export const SheetTitle = forwardRef<
	ElementRef<typeof SheetPrimitive.Title>,
	ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Title
		ref={ref}
		className={cn("text-heading text-ink", className)}
		{...props}
	/>
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = forwardRef<
	ElementRef<typeof SheetPrimitive.Description>,
	ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Description
		ref={ref}
		className={cn("text-body-sm text-ink-muted", className)}
		{...props}
	/>
));
SheetDescription.displayName = "SheetDescription";

export { sheetVariants };
