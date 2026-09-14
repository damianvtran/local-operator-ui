import { cn } from "@shared/lib/utils";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	forwardRef,
} from "react";

/**
 * Popover.
 *
 * Same panel as the dropdown menu and the select: `elevated`, hairline edge,
 * the one shadow. It differs only in padding, because a popover holds content
 * rather than a list of rows.
 */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = forwardRef<
	ElementRef<typeof PopoverPrimitive.Content>,
	ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 6, ...props }, ref) => (
	<PopoverPrimitive.Portal>
		<PopoverPrimitive.Content
			ref={ref}
			align={align}
			sideOffset={sideOffset}
			className={cn(
				"z-50 w-72 rounded-md border border-hairline bg-elevated p-4",
				// No entrance animation; see the note at the top of `tooltip.tsx`.
				"text-body-sm text-ink shadow-overlay",
				className,
			)}
			{...props}
		/>
	</PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";
