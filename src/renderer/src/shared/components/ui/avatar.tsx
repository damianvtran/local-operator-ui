import { cn } from "@shared/lib/utils";
import { Avatar as AvatarPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	forwardRef,
} from "react";

/**
 * Avatar.
 *
 * One of the three sanctioned uses of `rounded-full`.
 *
 * The fallback is `sunken` with muted ink rather than a generated colour per
 * user. Per-user hashed colours are a second accent hue by the back door, and
 * this system spends its one accent about three times a screen.
 */
export const Avatar = forwardRef<
	ElementRef<typeof AvatarPrimitive.Root>,
	ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
	<AvatarPrimitive.Root
		ref={ref}
		className={cn(
			"relative flex size-8 shrink-0 overflow-hidden rounded-full",
			className,
		)}
		{...props}
	/>
));
Avatar.displayName = "Avatar";

export const AvatarImage = forwardRef<
	ElementRef<typeof AvatarPrimitive.Image>,
	ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
	<AvatarPrimitive.Image
		ref={ref}
		className={cn("aspect-square size-full object-cover", className)}
		{...props}
	/>
));
AvatarImage.displayName = "AvatarImage";

export const AvatarFallback = forwardRef<
	ElementRef<typeof AvatarPrimitive.Fallback>,
	ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
	<AvatarPrimitive.Fallback
		ref={ref}
		className={cn(
			"flex size-full items-center justify-center rounded-full bg-sunken",
			"font-medium text-ink-muted text-meta",
			className,
		)}
		{...props}
	/>
));
AvatarFallback.displayName = "AvatarFallback";
