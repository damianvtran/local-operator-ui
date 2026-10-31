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

/**
 * The edge and plate an agent's picture wears, defined once.
 *
 * WHY IT SITS ON THE ROOT, NOT THE IMAGE (design review round 1, D1). `Avatar`
 * clips every child to a circle (`overflow-hidden rounded-full`). A border on
 * the square `<img>` is painted on the square and then clipped, so only four
 * arcs survive - measured at 59% of the circumference on the roster's 16px mark,
 * with a gap at every diagonal, and worse at 40px. A border on the root is the
 * circle's own boundary: continuous at every size, on every ground.
 *
 * WHY THE PLATE IS ON THE ROOT TOO (design review round 1, D2). The fallback's
 * `sunken` unmounts as soon as a picture loads, so a transparent PNG used to
 * show the pane's ground rather than the plate the rows promised. The root keeps
 * the fill behind every arm - picture, missing picture, undecodable picture -
 * and the 1px edge reads against whatever the row paints behind it, which is the
 * OUTER pairing `docs/branding.md` requires for `border-control`.
 *
 * WHY A COMPONENT AND NOT A CLASS CONSTANT PER CALL SITE. One list of agent
 * marks is drawn at five sizes - the roster row and the rail at 16px, the
 * transcript's turn mark at 20px, the agents sidebar at 32px, the settings field
 * at 40px - and five copies of a class string drift. `AgentAvatar` is the one
 * spelling; a surface that draws a picture of an agent uses it.
 *
 * It deliberately does NOT replace `Avatar`: Team Bridge's initial plates and
 * the account row are borderless by the operator's ask (2026-10-26), and their
 * pins assert that no edge comes back.
 *
 * With `border-box` sizing the 1px border does not change the mark's OUTER
 * box (16, 20, 32 or 40px), which is what keeps row heights and line measures
 * unchanged.
 */
export const AgentAvatar = forwardRef<
	ElementRef<typeof AvatarPrimitive.Root>,
	ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
	/*
	 * COMPOSED, not restated: the root's geometry, radius and clipping stay
	 * `Avatar`'s one definition, and this wrapper adds only the plate. A second
	 * copy of the base classes is a second circle that can drift.
	 */
	<Avatar
		ref={ref}
		className={cn("border border-control bg-sunken", className)}
		{...props}
	/>
));
AgentAvatar.displayName = "AgentAvatar";
