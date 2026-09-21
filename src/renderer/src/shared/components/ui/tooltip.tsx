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

/**
 * How long the pointer must rest on a trigger before the panel opens.
 *
 * Named and exported because it is the app's ONE answer to "the pointer has
 * decided to stay": the conversation row's title pan
 * (`chat-row-title.tsx`) waits out the same interval before it starts moving, so
 * that a sweep across the list starts neither a flyout nor a pan. The two must
 * move together, which is what importing this instead of restating `400` buys.
 */
export const TOOLTIP_DELAY_MS = 400;

export type TooltipProviderProps = ComponentPropsWithoutRef<
	typeof TooltipPrimitive.Provider
>;

export const TooltipProvider = ({
	delayDuration = TOOLTIP_DELAY_MS,
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
		// The hook `styles/index.css` uses to disable the POSITIONER Radix wraps
		// this in. The panel's own `pointer-events-none` below is not enough: the
		// wrapper has the same box and takes the pointer itself, which is what
		// made the composer's readings unclickable under a tooltip (QA round 2,
		// Q1). An attribute rather than a class because the rule must match the
		// wrapper's CHILD, and a utility class on this element would still leave
		// the selector needing something stable to look for.
		data-lo-tooltip-panel=""
		sideOffset={sideOffset}
		className={cn(
			"z-50 max-w-64 rounded-sm border border-hairline bg-elevated px-2 py-1",
			"text-meta text-ink shadow-overlay",
			/*
			 * NEVER a pointer target.
			 *
			 * A tooltip describes the thing under the pointer; it is not itself
			 * something to point at. Radix's default closes the panel when the pointer
			 * ENTERS the content (which is how a hoverable panel stays reachable), and
			 * a panel that cannot take the pointer has no such moment - a call site that
			 * wants the panel gone when the pointer leaves its trigger passes
			 * `disableHoverableContent` (see the prop's note in `TooltipProps`).
			 * Without this the panel is a live hit
			 * target floating over whatever it covers, and `elementFromPoint`			 * returns the TOOLTIP for a control the user can plainly see: the
			 * working-directory chip's panel sat over the composer's readings and
			 * swallowed clicks on the model reading at every width below the wrap
			 * threshold (UX round 2, U6), and over the message field's first line,
			 * where a click left `activeElement` on `body` instead of placing the
			 * caret (U7).
			 *
			 * This is the fix rather than another `side`, because a side is a
			 * guess about what is nearby: `side="right"` covered the readings,
			 * `side="top"` covered them at the wrapped widths, and the next layout
			 * change moves the collision again. A panel that cannot be clicked
			 * cannot swallow a click on ANY side, so it closes round 1's U3 and
			 * round 2's U6 by the same property instead of trading one for the
			 * other. Nothing inside a tooltip is interactive in this app - the
			 * primitive has no affordance for it, and Radix's own guidance is
			 * that a tooltip's content must not be.
			 */
			"pointer-events-none",
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
	/**
	 * How far the panel is kept from the window's edges, in px.
	 *
	 * Radix's own clamp shifts a panel that would fall outside the viewport, and with
	 * no padding a panel can sit flush with the edge - measured on the conversation
	 * row's flyout at the list's last row: 806..868.2 against an 868px viewport
	 * (design round 1, D4). 8px is one hairline-and-a-bit, which is what reads as
	 * "inside" rather than "against".
	 */
	collisionPadding?: TooltipContentProps["collisionPadding"];
	/**
	 * Close the panel when the pointer leaves the trigger, rather than keeping it open
	 * for a pointer travelling towards the content.
	 *
	 * WHAT THE DEFAULT ACTUALLY DOES, because the comment this replaces assumed the
	 * opposite: with `disableHoverableContent` false, Radix's trigger only CLEARS the
	 * open timer on `pointerleave` (`onTriggerLeave`) - it closes on the pointer
	 * entering the content, which is what makes a hoverable panel reachable. Every
	 * panel in this app is `pointer-events: none` (below), so that state is
	 * unreachable here and the default leaves a panel painted after the pointer has
	 * gone: measured on the row's flyout, still drawn 2.5s after the pointer left the
	 * row, describing a row it was no longer over (design round 1, D2).
	 *
	 * It is per-call rather than a default because it is a claim about the CALL SITE's
	 * panel: the row's flyout must leave when its row does, while a tooltip over a
	 * control nobody has asked to close on leave is not this change's to relitigate.
	 */
	disableHoverableContent?: boolean;
	delayDuration?: number;
	/** Render the child bare, with no tooltip at all. */
	disabled?: boolean;
	/** Applied to the tooltip panel, not to the trigger. */
	className?: string;
	/* No `defaultOpen`: it was added here to photograph tooltip strings, then
	   the story that needed it opened the tooltip by focusing the trigger
	   instead - the path a keyboard user takes, which photographs the real
	   thing rather than a forced state. An unused prop on a primitive with 115
	   call sites is an invitation to fake pointer state in a component test. */
};

export const Tooltip = ({
	content,
	children,
	side = "top",
	align = "center",
	sideOffset,
	delayDuration,
	disableHoverableContent = false,
	collisionPadding,
	disabled = false,
	className,
}: TooltipProps) => {
	const hasProvider = useContext(TooltipProviderPresence);

	if (disabled || content === null || content === undefined || content === "") {
		return <>{children}</>;
	}

	const tooltip = (
		<TooltipRoot
			delayDuration={delayDuration}
			disableHoverableContent={disableHoverableContent}
		>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipPortal>
				<TooltipContent
					side={side}
					align={align}
					sideOffset={sideOffset}
					collisionPadding={collisionPadding}
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
