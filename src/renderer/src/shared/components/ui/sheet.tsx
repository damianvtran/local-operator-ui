import { useSuppressBrowserView } from "@shared/browser-view-policy";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { X } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	type HTMLAttributes,
	forwardRef,
} from "react";
import { t } from "../../../../../i18n/messages";
import { Button } from "./button";

/**
 * Sheet, the edge drawer.
 *
 * Built on Radix Dialog rather than a second modal implementation: a drawer is
 * a dialog that enters from an edge, and having two focus traps and two scrim
 * behaviours in one app is how they drift apart.
 *
 * It does not slide, which was the original intent and turned out to be
 * unsafe. The reasoning is on the `sheetVariants` base below and in full at
 * the top of `tooltip.tsx`.
 *
 * NO BORDER ON ANY EDGE (2026-11-06). The outer edges meet the window frame,
 * where a line would be chrome with nothing on the far side - and the inner edge,
 * which used to carry the hairline, is a floating surface's boundary like any
 * other, so it separates by `elevated` ground plus the one shadow's contact layer
 * rather than by a stroke. The panel wears `data-lo-floating` for the guard that
 * enforces this; the full argument is on `panelClasses` in `dropdown-menu.tsx`. A
 * drawer is a dialog that enters from an edge, and two boundary languages for one
 * class of surface is how they drift apart.
 */

const sheetVariants = cva(
	[
		"fixed z-50 flex flex-col gap-4 bg-elevated p-6 shadow-overlay",
		// No slide-in. See the note at the top of `tooltip.tsx`: a play-pending
		// keyframe animation renders its `from` state, and a drawer's `from` is
		// off-screen, so the failure mode here is a drawer the user opened and
		// cannot see. The edge the panel is attached to already says which side
		// it came from, permanently, without depending on a frame being painted.
	],
	{
		variants: {
			side: {
				top: "inset-x-0 top-0",
				bottom: "inset-x-0 bottom-0",
				start: "inset-y-0 start-0 h-full w-3/4 max-w-sm",
				end: "inset-y-0 end-0 h-full w-3/4 max-w-sm",
				left: "inset-y-0 left-0 h-full w-3/4 max-w-sm",
				right: "inset-y-0 right-0 h-full w-3/4 max-w-sm",
			},
		},
		defaultVariants: { side: "right" },
	},
);

/**
 * The sheet root, wrapped so the overlay policy can see whether it is OPEN.
 *
 * WHY THIS WRAPPER EXISTS, and it is the fix for a measured bug: Radix's
 * `Dialog.Root` renders its children unconditionally — the mount gate lives inside
 * `Dialog.Portal`/`Dialog.Content`, not in the root — so a component placed inside a
 * CLOSED `<Sheet>` still runs its body. Registering the browser view's suppression
 * from `SheetContent` therefore registered on every render of every always-present
 * `<Sheet open={false}>`, and the browser page stayed paused with no sheet on screen
 * (found with the `data-suppressed-by` attribute the paused state publishes, which
 * named `sheet:` while the DOM had no dialog at all). `open` is the thing the policy
 * needs, and this is the only component in the tree that has it.
 */
export const Sheet = ({
	open,
	...props
}: ComponentPropsWithoutRef<typeof SheetPrimitive.Root>) => {
	useSuppressBrowserView(open === true, "sheet");
	return <SheetPrimitive.Root open={open} {...props} />;
};
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetPortal = SheetPrimitive.Portal;

export const SheetOverlay = forwardRef<
	ElementRef<typeof SheetPrimitive.Overlay>,
	ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Overlay
		ref={ref}
		className={cn(
			// No entrance animation; see the note at the top of `tooltip.tsx`.
			"fixed inset-0 z-50 bg-scrim",
			className,
		)}
		{...props}
	/>
));
SheetOverlay.displayName = "SheetOverlay";

export type SheetContentProps = ComponentPropsWithoutRef<
	typeof SheetPrimitive.Content
> &
	VariantProps<typeof sheetVariants> & {
		/** Show the corner close button. */
		showClose?: boolean;
	};

export const SheetContent = forwardRef<
	ElementRef<typeof SheetPrimitive.Content>,
	SheetContentProps
>(
	(
		{ className, children, side = "right", showClose = true, ...props },
		ref,
	) => {
		useI18nLocale();
		return (
			<SheetPortal>
				<SheetOverlay />
				<SheetPrimitive.Content
					ref={ref}
					/*
					 * Not a drag surface; see the marker's note in `dialog.tsx` and the rule it
					 * is read by in `styles/index.css`. The sheet covers the lane's own strip on
					 * its side of the window, and the controls above that strip - its close, the
					 * brand row - reach the pointer only while the rect subtracts.
					 */
					data-titlebar-no-drag=""
					/*
					 * NOT A GLASS PANEL, for the reason recorded in `dialog.tsx`: a sheet is
					 * a modal too, so its ground composites the 50-59% fill over the modal
					 * scrim - the backdrop the overlay floor was not derived against - and
					 * the semantic inks lose their AA floor there (design round 1, D1,
					 * measured 3.36-3.80:1 in the light palette). It keeps the opaque
					 * `elevated` role and its shadow.
					 */
					data-lo-floating=""
					className={cn(sheetVariants({ side }), className)}
					{...props}
				>
					{children}
					{showClose ? (
						<SheetPrimitive.Close asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								className="absolute top-4 end-4"
								aria-label={t("ui.common.actions.close")}
							>
								<X aria-hidden="true" />
							</Button>
						</SheetPrimitive.Close>
					) : null}
				</SheetPrimitive.Content>
			</SheetPortal>
		);
	},
);
SheetContent.displayName = "SheetContent";

export const SheetHeader = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex flex-col gap-1.5 pe-8", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

export const SheetFooter = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"mt-auto flex flex-col gap-2 sm:flex-row sm:justify-end",
			className,
		)}
		{...props}
	/>
);
SheetFooter.displayName = "SheetFooter";

export const SheetTitle = forwardRef<
	ElementRef<typeof SheetPrimitive.Title>,
	ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Title
		ref={ref}
		className={cn("text-heading text-ink", className)}
		{...props}
	/>
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = forwardRef<
	ElementRef<typeof SheetPrimitive.Description>,
	ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Description
		ref={ref}
		className={cn("text-body-sm text-ink-muted", className)}
		{...props}
	/>
));
SheetDescription.displayName = "SheetDescription";

export { sheetVariants };
