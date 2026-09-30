import { cn } from "@shared/lib/utils";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	forwardRef,
} from "react";

/**
 * Context menu.
 *
 * ## WHY THIS FILE IS A ONE-TO-ONE MIRROR OF `dropdown-menu.tsx`
 *
 * The two panels are the same object drawn for two openers: a menu anchored to
 * a control, and a menu anchored to a point. `docs/branding.md` § 9 item 1 is
 * "is there an existing primitive in `shared/components/ui/`? Use it. A second
 * button implementation is a defect." The primitive for a menu already exists,
 * so this file adds no chrome of its own: `panelClasses` and `itemClasses` are
 * copied VERBATIM from `dropdown-menu.tsx`, which is what keeps one radius, one
 * ground, one highlight role and one disabled treatment across every menu in
 * the app. If a chrome class in that file changes, this file changes with it -
 * the alternative is two panels that drift a pixel at a time.
 *
 * The classes are duplicated rather than imported because `dropdown-menu.tsx`
 * keeps them module-private, and lifting them into a shared module would edit
 * ten existing call sites for a change no user can see. That trade is worth
 * reversing the moment a third menu arrives: at three, export them.
 *
 * ## WHY THE PANEL CARRIES `data-titlebar-no-drag`
 *
 * The same reason `DropdownMenuContent` does: a menu can be portalled under the
 * titlebar lane, and a control inside a drag region must opt out or the window
 * moves under the pointer. `styles/index.css` states the rule for controls; the
 * attribute is the opt-out.
 *
 * ## WHY THE HIGHLIGHT IS `accent-wash`, AND WHY ITEMS KEEP THEIR FOCUS OUTLINE
 *
 * Both are `dropdown-menu.tsx`'s decisions, inherited unchanged and not
 * re-derived here: the panel is already `elevated` (the top of the ground ramp),
 * so there is no lighter step to hover onto, and an item that relied on
 * `data-highlighted` alone would make keyboard highlight and mouse hover look
 * identical - the wrong trade for an app used from the keyboard. The panel's
 * `p-1` is exactly the 4px the base ring needs.
 */

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;
export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

/** Panel chrome, copied from `dropdown-menu.tsx`'s `panelClasses`. */
const panelClasses = [
	"z-50 min-w-32 overflow-hidden rounded-md border border-hairline bg-elevated p-1",
	// No entrance animation; see the note at the top of `tooltip.tsx`.
	"shadow-overlay",
];

/** Row chrome, copied from `dropdown-menu.tsx`'s `itemClasses`. */
const itemClasses = [
	"relative flex select-none items-center gap-2 rounded-sm px-2 py-1.5",
	"text-body-sm text-ink transition-colors duration-fast",
	"data-[highlighted]:bg-accent-wash",
	// Disabled is a colour change. `pointer-events-none` keeps the row from
	// swallowing a click meant for the panel behind it.
	"data-[disabled]:pointer-events-none data-[disabled]:text-ink-disabled",
	// The `:not(.size-2)` carve-out is the radio dot's, and arrives here with the
	// rest of the class string rather than by omission - see `dropdown-menu.tsx`.
	"[&_svg]:pointer-events-none [&_svg:not(.size-2)]:size-4 [&_svg]:shrink-0",
];

export const ContextMenuContent = forwardRef<
	ElementRef<typeof ContextMenuPrimitive.Content>,
	ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
	<ContextMenuPrimitive.Portal>
		<ContextMenuPrimitive.Content
			ref={ref}
			data-titlebar-no-drag=""
			sideOffset={sideOffset}
			className={cn(panelClasses, className)}
			{...props}
		/>
	</ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = "ContextMenuContent";

export const ContextMenuItem = forwardRef<
	ElementRef<typeof ContextMenuPrimitive.Item>,
	ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
		/** Align with rows carrying a check or radio indicator. */
		inset?: boolean;
		/** Destructive row: red ink, red wash on highlight. */
		destructive?: boolean;
	}
>(({ className, inset, destructive, ...props }, ref) => (
	<ContextMenuPrimitive.Item
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
ContextMenuItem.displayName = "ContextMenuItem";
