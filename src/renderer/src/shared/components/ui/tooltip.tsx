import { cn } from "@shared/lib/utils";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	type ReactNode,
	createContext,
	forwardRef,
	useContext,
} from "react";

/**
 * Tooltips.
 *
 * Two APIs on purpose. `TooltipRoot` / `TooltipTrigger` / `TooltipContent` are
 * the Radix parts for anything unusual; `Tooltip` is a one-element wrapper
 * that takes `content` and a child, which is the shape the ~hundreds of MUI
 * `<Tooltip title=...>` call sites already have. Giving the port a 1:1 target
 * is what keeps it mechanical.
 *
 * ## The provider
 *
 * Radix throws if a `Tooltip.Root` mounts with no `Tooltip.Provider` above it,
 * so the wrapper cannot simply assume one. It also must not unconditionally
 * mount its own: a nested provider shadows the app-level one, and the only
 * thing the app-level one exists for — `skipDelayDuration`, the grace period
 * that lets you sweep across a toolbar without re-waiting on every button —
 * needs the providers to be shared. So `TooltipProvider` publishes a flag and
 * the wrapper self-provides only when nothing above it did.
 *
 * ## No arrow, and no entrance animation — here or in any overlay
 *
 * The arrow is omitted because position already carries the association, and
 * it is one more piece of chrome on the app's single most-repeated element.
 *
 * The animation is omitted for a harder reason, and the same reasoning
 * removed it from the dropdown, select, popover, dialog and sheet.
 * `animate-in fade-in-0` is a keyframe animation whose `from` state is
 * `opacity: 0`. While such an animation is play-pending — waiting for the
 * first frame after mount — Chrome renders the `from` value, so an overlay
 * that mounts in a document which is not painting stays at opacity 0
 * indefinitely. Observed directly: a controlled-open menu reported
 * `playState: "running", startTime: null, currentTime: 0` with a computed
 * `opacity: 0`, in a browser with `prefers-reduced-motion: no-preference`.
 *
 * That is the exact defect `styles/index.css` refuses to allow under reduced
 * motion ("a cancelled animation can strand an element on its `from`
 * keyframe"), and a tooltip, menu or dialog is not decorative — content that
 * can be invisible is a correctness bug, not a polish one. 120ms of fade is
 * not worth a state where the user cannot see the menu they opened.
 */

const TooltipProviderPresence = createContext(false);

export type TooltipProviderProps = ComponentPropsWithoutRef<
	typeof TooltipPrimitive.Provider
>;

export const TooltipProvider = ({
	delayDuration = 400,
	skipDelayDuration = 300,
	children,
	...props
}: TooltipProviderProps) => (
	<TooltipPrimitive.Provider
		delayDuration={delayDuration}
		skipDelayDuration={skipDelayDuration}
		{...props}
	>
		<TooltipProviderPresence.Provider value={true}>
			{children}
		</TooltipProviderPresence.Provider>
	</TooltipPrimitive.Provider>
);
TooltipProvider.displayName = "TooltipProvider";

export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipPortal = TooltipPrimitive.Portal;

export type TooltipContentProps = ComponentPropsWithoutRef<
	typeof TooltipPrimitive.Content
>;

export const TooltipContent = forwardRef<
	ElementRef<typeof TooltipPrimitive.Content>,
	TooltipContentProps
>(({ className, sideOffset = 6, ...props }, ref) => (
	<TooltipPrimitive.Content
		ref={ref}
		sideOffset={sideOffset}
		className={cn(
			"z-50 max-w-64 rounded-sm border border-hairline bg-elevated px-2 py-1",
			"text-meta text-ink shadow-overlay",
			/*
			 * No entrance animation. See the note at the top of this file: an
			 * overlay whose `from` keyframe is invisible can be left invisible.
			 */
			className,
		)}
		{...props}
	/>
));
TooltipContent.displayName = "TooltipContent";

export type TooltipProps = {
	/** The tooltip body. Nothing renders when this is empty. */
	content: ReactNode;
	/** The element the tooltip describes. Receives the trigger props. */
	children: ReactNode;
	side?: TooltipContentProps["side"];
	align?: TooltipContentProps["align"];
	sideOffset?: TooltipContentProps["sideOffset"];
	delayDuration?: number;
	/** Render the child bare, with no tooltip at all. */
	disabled?: boolean;
	/** Applied to the tooltip panel, not to the trigger. */
	className?: string;
};

export const Tooltip = ({
	content,
	children,
	side = "top",
	align = "center",
	sideOffset,
	delayDuration,
	disabled = false,
	className,
}: TooltipProps) => {
	const hasProvider = useContext(TooltipProviderPresence);

	if (disabled || content === null || content === undefined || content === "") {
		return <>{children}</>;
	}

	const tooltip = (
		<TooltipRoot delayDuration={delayDuration}>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipPortal>
				<TooltipContent
					side={side}
					align={align}
					sideOffset={sideOffset}
					className={className}
				>
					{content}
				</TooltipContent>
			</TooltipPortal>
		</TooltipRoot>
	);

	return hasProvider ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>;
};
Tooltip.displayName = "Tooltip";
