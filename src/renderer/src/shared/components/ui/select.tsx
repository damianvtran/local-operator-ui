import { cn } from "@shared/lib/utils";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	forwardRef,
} from "react";

/**
 * Select.
 *
 * The trigger is deliberately identical to `Input` — same height, same
 * `border-control` edge, same `surface` fill — because a select and a text
 * field are the same kind of thing to the person filling in the form, and a
 * form where the two controls disagree about their own height is the most
 * common way a settings screen looks unfinished.
 *
 * The panel matches `DropdownMenu`: `elevated`, one shadow, `accent-wash`
 * highlight. Two overlay panels that look different is a bug, not a choice.
 */

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
	ElementRef<typeof SelectPrimitive.Trigger>,
	ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
	<SelectPrimitive.Trigger
		ref={ref}
		className={cn(
			"flex h-8 w-full items-center justify-between gap-2 rounded-md",
			"border border-control bg-surface px-3 text-body-sm text-ink",
			"transition-colors duration-fast ease-out-quart",
			"[&>span]:truncate",
			// Scoped away from the disabled state for the same reason as the
			// checked colours in `checkbox.tsx`: Tailwind emits `data-[disabled]:*`
			// first, so an unscoped placeholder rule wins over it and a disabled
			// select keeps live placeholder ink.
			"data-[placeholder]:not-data-[disabled]:text-ink-dim",
			"aria-invalid:border-danger",
			"data-[disabled]:border-hairline data-[disabled]:bg-sunken data-[disabled]:text-ink-disabled",
			className,
		)}
		{...props}
	>
		{children}
		<SelectPrimitive.Icon asChild>
			<ChevronDown
				className="size-4 shrink-0 text-ink-dim"
				aria-hidden="true"
			/>
		</SelectPrimitive.Icon>
	</SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

const SelectScrollUpButton = forwardRef<
	ElementRef<typeof SelectPrimitive.ScrollUpButton>,
	ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.ScrollUpButton
		ref={ref}
		className={cn(
			"flex cursor-default items-center justify-center py-1 text-ink-dim",
			className,
		)}
		{...props}
	>
		<ChevronUp className="size-4" aria-hidden="true" />
	</SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = "SelectScrollUpButton";

const SelectScrollDownButton = forwardRef<
	ElementRef<typeof SelectPrimitive.ScrollDownButton>,
	ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.ScrollDownButton
		ref={ref}
		className={cn(
			"flex cursor-default items-center justify-center py-1 text-ink-dim",
			className,
		)}
		{...props}
	>
		<ChevronDown className="size-4" aria-hidden="true" />
	</SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = "SelectScrollDownButton";

export const SelectContent = forwardRef<
	ElementRef<typeof SelectPrimitive.Content>,
	ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
	<SelectPrimitive.Portal>
		<SelectPrimitive.Content
			ref={ref}
			position={position}
			className={cn(
				"relative z-50 max-h-96 min-w-32 overflow-hidden rounded-md",
				// No entrance animation; see the note at the top of `tooltip.tsx`.
				"border border-hairline bg-elevated shadow-overlay",
				position === "popper" &&
					"data-[side=bottom]:mt-1.5 data-[side=top]:mb-1.5",
				className,
			)}
			{...props}
		>
			<SelectScrollUpButton />
			<SelectPrimitive.Viewport
				className={cn(
					"p-1",
					// Match the trigger's width so the panel does not jump narrower
					// than the control that opened it. Height is left to content.
					position === "popper" &&
						"w-full min-w-(--radix-select-trigger-width)",
				)}
			>
				{children}
			</SelectPrimitive.Viewport>
			<SelectScrollDownButton />
		</SelectPrimitive.Content>
	</SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectLabel = forwardRef<
	ElementRef<typeof SelectPrimitive.Label>,
	ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.Label
		ref={ref}
		className={cn("px-2 py-1.5 pl-8 text-meta text-ink-dim", className)}
		{...props}
	/>
));
SelectLabel.displayName = "SelectLabel";

export const SelectItem = forwardRef<
	ElementRef<typeof SelectPrimitive.Item>,
	ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
	<SelectPrimitive.Item
		ref={ref}
		className={cn(
			"relative flex w-full select-none items-center gap-2 rounded-sm py-1.5 pr-2 pl-8",
			"text-body-sm text-ink transition-colors duration-fast",
			"data-[highlighted]:bg-accent-wash",
			"data-[disabled]:pointer-events-none data-[disabled]:text-ink-disabled",
			className,
		)}
		{...props}
	>
		<span className="absolute left-2 flex size-4 items-center justify-center">
			<SelectPrimitive.ItemIndicator>
				<Check className="size-4 text-accent" aria-hidden="true" />
			</SelectPrimitive.ItemIndicator>
		</span>
		<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
	</SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";

export const SelectSeparator = forwardRef<
	ElementRef<typeof SelectPrimitive.Separator>,
	ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.Separator
		ref={ref}
		className={cn("-mx-1 my-1 h-px bg-hairline", className)}
		{...props}
	/>
));
SelectSeparator.displayName = "SelectSeparator";

export { SelectScrollUpButton, SelectScrollDownButton };
