import { cn } from "@shared/lib/utils";
import { Label as LabelPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	forwardRef,
} from "react";

/**
 * Form label.
 *
 * Not on the original primitive list, added because leaving it out means every
 * migrated form invents one. It also does something a bare `label` cannot:
 * `Switch` and `Checkbox` render as `button`, which a native label will not
 * forward a click to, and Radix's Label wires that up.
 *
 * `peer-disabled:` picks up the disabled colour from the control it labels, so
 * the pair greys out together — provided the control carries `peer`. It has to
 * be reached that way because a label has no disabled state of its own.
 */
export const Label = forwardRef<
	ElementRef<typeof LabelPrimitive.Root>,
	ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
	<LabelPrimitive.Root
		ref={ref}
		className={cn(
			"inline-flex select-none items-center gap-2 font-medium text-body-sm text-ink",
			"peer-disabled:text-ink-disabled",
			className,
		)}
		{...props}
	/>
));
Label.displayName = "Label";
