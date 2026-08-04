import { cn } from "@shared/lib/utils";
import { Tabs as TabsPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	forwardRef,
} from "react";

/**
 * Tabs, as a segmented control.
 *
 * The track is `sunken` and the active tab is `surface`, so selection is the
 * same lightness step the rest of the system uses for elevation rather than a
 * new idiom (an underline, a coloured bar) that only appears here.
 *
 * The track's `p-1` is not decoration: 4px is exactly what the base focus ring
 * needs (2px outline at 2px offset), so a tabbed-to trigger shows its ring
 * inside the track instead of having it clipped.
 */

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
	ElementRef<typeof TabsPrimitive.List>,
	ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.List
		ref={ref}
		className={cn(
			"inline-flex h-8 w-fit items-center gap-1 rounded-md bg-sunken p-1",
			className,
		)}
		{...props}
	/>
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
	ElementRef<typeof TabsPrimitive.Trigger>,
	ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Trigger
		ref={ref}
		className={cn(
			"inline-flex h-6 items-center justify-center gap-1.5 whitespace-nowrap",
			"rounded-sm px-3 font-medium text-body-sm text-ink-muted",
			"transition-colors duration-fast ease-out-quart",
			"hover:text-ink",
			"data-[state=active]:bg-surface data-[state=active]:text-ink",
			"data-[disabled]:text-ink-disabled",
			"[&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
			className,
		)}
		{...props}
	/>
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
	ElementRef<typeof TabsPrimitive.Content>,
	ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Content
		ref={ref}
		className={cn("mt-4", className)}
		{...props}
	/>
));
TabsContent.displayName = "TabsContent";
