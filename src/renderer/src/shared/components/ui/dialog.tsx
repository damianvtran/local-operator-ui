import { cn } from "@shared/lib/utils";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	type HTMLAttributes,
	forwardRef,
} from "react";
import { Button } from "./button";

/**
 * Modal dialog.
 *
 * The overlay is `bg-scrim`, which is a per-theme role. A hardcoded black
 * alpha is the usual shortcut here and it is wrong in the six light themes,
 * where the scrim is a warm near-black at a lower alpha.
 *
 * The panel is `elevated` plus the one shadow in the system. A dialog is the
 * canonical case for that shadow: it has genuinely left the flow, so a
 * lightness step alone cannot say how far in front it is.
 *
 * Entrance is a fade. No zoom and no slide — the transform budget in this
 * system is for things arriving from off-screen (see `Sheet`), and a dialog
 * arrives in place.
 *
 * `DialogContent` renders its own close button. Pass `showClose={false}` for a
 * dialog whose only exits are its own footer actions.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = forwardRef<
	ElementRef<typeof DialogPrimitive.Overlay>,
	ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Overlay
		ref={ref}
		className={cn(
			// No entrance animation; see the note at the top of `tooltip.tsx`.
			"fixed inset-0 z-50 bg-scrim",
			className,
		)}
		{...props}
	/>
));
DialogOverlay.displayName = "DialogOverlay";

export type DialogContentProps = ComponentPropsWithoutRef<
	typeof DialogPrimitive.Content
> & {
	/** Show the corner close button. */
	showClose?: boolean;
};

export const DialogContent = forwardRef<
	ElementRef<typeof DialogPrimitive.Content>,
	DialogContentProps
>(({ className, children, showClose = true, ...props }, ref) => (
	<DialogPortal>
		<DialogOverlay />
		<DialogPrimitive.Content
			ref={ref}
			className={cn(
				"-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50",
				"flex w-full max-w-lg flex-col gap-4",
				"rounded-lg border border-hairline bg-elevated p-6 shadow-overlay",
				// No entrance animation; see the note at the top of `tooltip.tsx`.
				className,
			)}
			{...props}
		>
			{children}
			{showClose ? (
				<DialogPrimitive.Close asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						className="absolute top-4 right-4"
						aria-label="Close"
					>
						<X aria-hidden="true" />
					</Button>
				</DialogPrimitive.Close>
			) : null}
		</DialogPrimitive.Content>
	</DialogPortal>
));
DialogContent.displayName = "DialogContent";

export const DialogHeader = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex flex-col gap-1.5 pr-8", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

export const DialogFooter = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
			className,
		)}
		{...props}
	/>
);
DialogFooter.displayName = "DialogFooter";

export const DialogTitle = forwardRef<
	ElementRef<typeof DialogPrimitive.Title>,
	ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Title
		ref={ref}
		className={cn("text-heading text-ink", className)}
		{...props}
	/>
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = forwardRef<
	ElementRef<typeof DialogPrimitive.Description>,
	ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Description
		ref={ref}
		className={cn("text-body-sm text-ink-muted", className)}
		{...props}
	/>
));
DialogDescription.displayName = "DialogDescription";
