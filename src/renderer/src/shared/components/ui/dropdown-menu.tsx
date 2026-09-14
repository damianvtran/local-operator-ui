import { cn } from "@shared/lib/utils";
import { Check, ChevronRight, Circle } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	type HTMLAttributes,
	forwardRef,
} from "react";

/**
 * Dropdown menu.
 *
 * ## Why the highlight is `accent-wash` and not the next ground
 *
 * The panel is already `elevated`, the top of the ground ramp, so there is no
 * lighter step left to hover onto. `accentWash` is the role the contract
 * describes as "hover fills, active rows"; it is the tinted step that works
 * whichever ground the panel happens to sit over.
 *
 * ## Why items keep their focus outline
 *
 * The usual shadcn item sets `outline-hidden` and relies on `data-highlighted`
 * alone. Keyboard highlight and mouse hover then look identical, which is the
 * wrong trade for an app used from the keyboard. The panel's `p-1` is exactly
 * the 4px the base ring needs (2px outline at 2px offset), so the ring fits
 * inside the panel instead of being clipped by it.
 */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

/** Panel chrome, shared by the menu and its submenus. */
const panelClasses = [
	"z-50 min-w-32 overflow-hidden rounded-md border border-hairline bg-elevated p-1",
	// No entrance animation; see the note at the top of `tooltip.tsx`.
	"shadow-overlay",
];

/** Row chrome, shared by plain, checkbox, radio and submenu-trigger rows. */
const itemClasses = [
	"relative flex select-none items-center gap-2 rounded-sm px-2 py-1.5",
	"text-body-sm text-ink transition-colors duration-fast",
	"data-[highlighted]:bg-accent-wash",
	// Disabled is a colour change. `pointer-events-none` keeps the row from
	// swallowing a click meant for the panel behind it.
	"data-[disabled]:pointer-events-none data-[disabled]:text-ink-disabled",
	"[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
];

export const DropdownMenuSubTrigger = forwardRef<
	ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
	ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
		inset?: boolean;
	}
>(({ className, inset, children, ...props }, ref) => (
	<DropdownMenuPrimitive.SubTrigger
		ref={ref}
		className={cn(
			itemClasses,
			"data-[state=open]:bg-accent-wash",
			inset && "pl-8",
			className,
		)}
		{...props}
	>
		{children}
		<ChevronRight className="ml-auto text-ink-dim" aria-hidden="true" />
	</DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

export const DropdownMenuSubContent = forwardRef<
	ElementRef<typeof DropdownMenuPrimitive.SubContent>,
	ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
	<DropdownMenuPrimitive.SubContent
		ref={ref}
		className={cn(panelClasses, className)}
		{...props}
	/>
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

export const DropdownMenuContent = forwardRef<
	ElementRef<typeof DropdownMenuPrimitive.Content>,
	ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
	<DropdownMenuPrimitive.Portal>
		<DropdownMenuPrimitive.Content
			ref={ref}
			sideOffset={sideOffset}
			className={cn(panelClasses, className)}
			{...props}
		/>
	</DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = forwardRef<
	ElementRef<typeof DropdownMenuPrimitive.Item>,
	ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
		/** Align with the rows that carry a check or radio indicator. */
		inset?: boolean;
		/** Destructive row: red ink, red wash on highlight. */
		destructive?: boolean;
	}
>(({ className, inset, destructive, ...props }, ref) => (
	<DropdownMenuPrimitive.Item
		ref={ref}
		className={cn(
			itemClasses,
			inset && "pl-8",
			destructive && "text-danger data-[highlighted]:bg-danger-wash",
			className,
		)}
		{...props}
	/>
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuCheckboxItem = forwardRef<
	ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
	ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
	<DropdownMenuPrimitive.CheckboxItem
		ref={ref}
		checked={checked}
		className={cn(itemClasses, "pl-8", className)}
		{...props}
	>
		<span className="absolute left-2 flex size-4 items-center justify-center">
			<DropdownMenuPrimitive.ItemIndicator>
				<Check className="text-accent" aria-hidden="true" />
			</DropdownMenuPrimitive.ItemIndicator>
		</span>
		{children}
	</DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export const DropdownMenuRadioItem = forwardRef<
	ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
	ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
	<DropdownMenuPrimitive.RadioItem
		ref={ref}
		className={cn(itemClasses, "pl-8", className)}
		{...props}
	>
		<span className="absolute left-2 flex size-4 items-center justify-center">
			<DropdownMenuPrimitive.ItemIndicator>
				{/* The one legitimate `rounded-full` here: this is a status dot. */}
				<Circle className="size-2 fill-accent text-accent" aria-hidden="true" />
			</DropdownMenuPrimitive.ItemIndicator>
		</span>
		{children}
	</DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

export const DropdownMenuLabel = forwardRef<
	ElementRef<typeof DropdownMenuPrimitive.Label>,
	ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
		inset?: boolean;
	}
>(({ className, inset, ...props }, ref) => (
	<DropdownMenuPrimitive.Label
		ref={ref}
		className={cn(
			"px-2 py-1.5 text-meta text-ink-dim",
			inset && "pl-8",
			className,
		)}
		{...props}
	/>
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export const DropdownMenuSeparator = forwardRef<
	ElementRef<typeof DropdownMenuPrimitive.Separator>,
	ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
	<DropdownMenuPrimitive.Separator
		ref={ref}
		className={cn("-mx-1 my-1 h-px bg-hairline", className)}
		{...props}
	/>
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

/** Keyboard hint on the right of a row. Machine voice, so monospace. */
export const DropdownMenuShortcut = ({
	className,
	...props
}: HTMLAttributes<HTMLSpanElement>) => (
	<span
		className={cn("ml-auto font-mono text-ink-dim text-mono-sm", className)}
		{...props}
	/>
);
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";
