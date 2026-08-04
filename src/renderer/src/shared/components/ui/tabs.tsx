import { cn } from "@shared/lib/utils";
import { Tabs as TabsPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	type FC,
	type ReactNode,
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

export type TabPanelProps = {
	/** Id the selecting tab's `aria-controls` points at. */
	id: string;
	/** Id of the tab that selects this panel. */
	labelledBy: string;
	children: ReactNode;
};

/**
 * The panel half of a hand-rolled tab relationship.
 *
 * `role="tab"` with nothing to point at leaves a screen reader announcing "tab,
 * selected" without naming the region that was selected. Two places in the app
 * need that region and neither can use `TabsContent`: the chat view tabs and
 * the canvas document tabs both render their strip and their content from
 * different components, so the panel is not a descendant of a `Tabs` root.
 *
 * It generates no box, and that is the whole reason it can be dropped in. Both
 * call sites hand their content straight to a flex column that sizes it, and a
 * real wrapper changes that sizing — measured in Chromium against the canvas
 * column, a `flex grow flex-col` box moved the code editor from 326px to 398px
 * and the preview panes from 398px to 326px. Which of those is correct is a
 * layout question and not this element's business, so `display: contents`
 * leaves the parent-child flex relationship untouched. Chromium still exposes
 * it as a `tabpanel` and still resolves its name through `aria-labelledby`;
 * confirmed in the accessibility tree rather than assumed.
 *
 * No `tabIndex`: the ARIA tabs pattern only makes the panel a tab stop when it
 * holds nothing focusable, and both of these hold editors and message actions.
 */
export const TabPanel: FC<TabPanelProps> = ({ id, labelledBy, children }) => (
	<div
		className="contents"
		role="tabpanel"
		id={id}
		aria-labelledby={labelledBy}
	>
		{children}
	</div>
);
